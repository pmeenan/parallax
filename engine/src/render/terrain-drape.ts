import {
  acquireTexture,
  type EngineContext,
  getOrCreateSampler,
  type MaterialPlugin,
  type PluginTextureBinding,
  type Texture2D,
} from "@babylonjs/lite";
import type { GreyboxHeightfieldCollider } from "../world/world-contract";

/**
 * GPU terrain drape (D-204). Every streamed PBR material carries this plugin, so one pipeline
 * family serves both rigid and conforming placements. A conforming placement binds its cell's
 * drape texture: per detail sample, the ground height minus the placement's reference height
 * and the ground's x/z slopes. The vertex stage interpolates it bilinearly, exactly like
 * collision's `sampleHeightfieldBilinear`. It lifts the world position by the height, and
 * transforms the normal by that vertical shear. A rigid placement binds a 1 × 1 zero texture.
 */
export const TERRAIN_DRAPE_PLUGIN_NAME = "parallax-terrain-drape";

const TEXEL_CHANNELS = 4;

// Vertex-stage WGSL. It runs after the template has written the world position, clip position
// and world normal, in the colour and the depth-only (shadow caster) variants alike.
const DRAPE_VERTEX_WGSL = [
  "let drapeGrid=clamp((out.worldPos.xz-material.terrainDrapeOrigin.xy)*material.terrainDrapeOrigin.z,vec2<f32>(0.0),material.terrainDrapeExtent.xy);",
  "let drapeCell=min(floor(drapeGrid),max(material.terrainDrapeExtent.xy-vec2<f32>(1.0),vec2<f32>(0.0)));",
  "let drapeFraction=drapeGrid-drapeCell;",
  "let drapeTexel=vec2<i32>(drapeCell);",
  "let drapeLimit=vec2<i32>(material.terrainDrapeExtent.xy);",
  "let drape00=textureLoad(terrainDrapeTexture,drapeTexel,0);",
  "let drape10=textureLoad(terrainDrapeTexture,min(drapeTexel+vec2<i32>(1,0),drapeLimit),0);",
  "let drape01=textureLoad(terrainDrapeTexture,min(drapeTexel+vec2<i32>(0,1),drapeLimit),0);",
  "let drape11=textureLoad(terrainDrapeTexture,min(drapeTexel+vec2<i32>(1,1),drapeLimit),0);",
  "let drape=mix(mix(drape00,drape10,drapeFraction.x),mix(drape01,drape11,drapeFraction.x),drapeFraction.y);",
  "out.worldPos.y+=drape.x;",
  "out.clipPos=scene.viewProjection*vec4<f32>(out.worldPos,1.0);",
  "let drapeNormal=normalize(out.worldNormal);",
  "out.worldNormal=normalize(vec3<f32>(drapeNormal.x-drape.y*drapeNormal.y,drapeNormal.y,drapeNormal.z-drape.z*drapeNormal.y));",
].join("");

export interface TerrainDrapeField {
  readonly texture: Texture2D;
  /** World x/z of texel (0, 0) and texels per metre. */
  readonly originX: number;
  readonly originZ: number;
  readonly inverseSpacing: number;
  /** Largest texel coordinate on each axis: columns − 1 and rows − 1. */
  readonly maximumColumn: number;
  readonly maximumRow: number;
  readonly gpuBytes: number;
}

/** Central-difference ground slopes at a detail sample; one-sided at the field's edges. */
export function terrainDetailSlope(
  detail: GreyboxHeightfieldCollider,
  column: number,
  row: number,
): readonly [number, number] {
  const { columns, rows, sampleSpacingMeters: spacing } = detail;
  const height = (c: number, r: number): number => detail.heights[r * columns + c] ?? 0;
  const west = Math.max(0, column - 1);
  const east = Math.min(columns - 1, column + 1);
  const south = Math.max(0, row - 1);
  const north = Math.min(rows - 1, row + 1);
  return [
    (height(east, row) - height(west, row)) / ((east - west) * spacing),
    (height(column, north) - height(column, south)) / ((north - south) * spacing),
  ];
}

/** Drape texels (height above the reference, slope x, slope z, 0) as float16 bits. */
export function terrainDrapeTexels(
  detail: GreyboxHeightfieldCollider,
  referenceHeightMeters: number,
): Uint16Array {
  const texels = new Uint16Array(detail.columns * detail.rows * TEXEL_CHANNELS);
  for (let row = 0; row < detail.rows; row++)
    for (let column = 0; column < detail.columns; column++) {
      const index = (row * detail.columns + column) * TEXEL_CHANNELS;
      const [slopeX, slopeZ] = terrainDetailSlope(detail, column, row);
      texels[index] = float16Bits(
        (detail.heights[row * detail.columns + column] ?? 0) - referenceHeightMeters,
      );
      texels[index + 1] = float16Bits(slopeX);
      texels[index + 2] = float16Bits(slopeZ);
    }
  return texels;
}

const FLOAT32_SCRATCH = new Float32Array(1);
const FLOAT32_BITS = new Uint32Array(FLOAT32_SCRATCH.buffer);

/** Round-to-nearest-even float32 → float16 conversion, for finite drape values. */
export function float16Bits(value: number): number {
  FLOAT32_SCRATCH[0] = value;
  const bits = FLOAT32_BITS[0] ?? 0;
  const sign = (bits >>> 16) & 0x8000;
  const exponent = (bits >>> 23) & 0xff;
  const mantissa = bits & 0x7fffff;
  if (exponent === 0xff) throw new Error("Terrain drape values must be finite");
  const halfExponent = exponent - 127 + 15;
  if (halfExponent >= 0x1f) throw new Error("Terrain drape value exceeds float16 range");
  if (halfExponent <= 0) {
    if (halfExponent < -10) return sign;
    const full = mantissa | 0x800000;
    const shift = 14 - halfExponent;
    const half = full >>> shift;
    const remainder = full & ((1 << shift) - 1);
    const midpoint = 1 << (shift - 1);
    return sign | (half + (remainder > midpoint || (remainder === midpoint && half & 1) ? 1 : 0));
  }
  const half = (halfExponent << 10) | (mantissa >>> 13);
  const remainder = mantissa & 0x1fff;
  // Carry from the mantissa into the exponent is the correct rounding.
  return sign | (half + (remainder > 0x1000 || (remainder === 0x1000 && half & 1) ? 1 : 0));
}

function createDrapeTexture(
  engine: EngineContext,
  texels: Uint16Array,
  width: number,
  height: number,
): Texture2D {
  // Lite's public pixel uploader only takes RGBA8. The same bounded device seam as the
  // streamed PBR mip chains allocates the float16 field.
  const device = Reflect.get(engine, "_device") as GPUDevice;
  const gpuTexture = device.createTexture({
    label: "terrain-drape",
    size: { width, height },
    format: "rgba16float",
    // WebGPU GPUTextureUsage.TEXTURE_BINDING | COPY_DST.
    usage: 0x04 | 0x02,
  });
  device.queue.writeTexture(
    { texture: gpuTexture },
    texels,
    { bytesPerRow: width * TEXEL_CHANNELS * 2, rowsPerImage: height },
    { width, height },
  );
  const texture: Texture2D = {
    texture: gpuTexture,
    view: gpuTexture.createView(),
    // The drape reads texels with textureLoad; the sampler only satisfies the binding. A single
    // hardware-filtered sample was A/B tested (package 4 review) and showed no gain above noise.
    sampler: getOrCreateSampler(engine, { minFilter: "nearest", magFilter: "nearest" }),
    width,
    height,
  };
  acquireTexture(texture);
  return texture;
}

/** The cell's drape field for placements sharing one reference height. */
export function createTerrainDrapeField(
  engine: EngineContext,
  detail: GreyboxHeightfieldCollider,
  referenceHeightMeters: number,
): TerrainDrapeField {
  return Object.freeze({
    texture: createDrapeTexture(
      engine,
      terrainDrapeTexels(detail, referenceHeightMeters),
      detail.columns,
      detail.rows,
    ),
    originX: detail.origin[0],
    originZ: detail.origin[2],
    inverseSpacing: 1 / detail.sampleSpacingMeters,
    maximumColumn: detail.columns - 1,
    maximumRow: detail.rows - 1,
    gpuBytes: detail.columns * detail.rows * TEXEL_CHANNELS * 2,
  });
}

/** The zero field bound by rigid placements and the PSO warmup fixture. */
export function createRigidTerrainDrapeField(engine: EngineContext): TerrainDrapeField {
  return Object.freeze({
    texture: createDrapeTexture(engine, new Uint16Array(TEXEL_CHANNELS), 1, 1),
    originX: 0,
    originZ: 0,
    inverseSpacing: 1,
    maximumColumn: 0,
    maximumRow: 0,
    gpuBytes: TEXEL_CHANNELS * 2,
  });
}

export function createTerrainDrapePlugin(field: TerrainDrapeField): MaterialPlugin {
  return {
    name: TERRAIN_DRAPE_PLUGIN_NAME,
    getCustomCode: (shaderType) =>
      shaderType === "vertex" ? { CUSTOM_VERTEX_MAIN_END: DRAPE_VERTEX_WGSL } : null,
    getUniforms: () => ({
      ubo: [
        { name: "terrainDrapeOrigin", type: "vec4<f32>", visibility: "vertex" },
        { name: "terrainDrapeExtent", type: "vec4<f32>", visibility: "vertex" },
      ],
    }),
    getSamplers: () => [
      {
        texture: "terrainDrapeTexture",
        sampler: "terrainDrapeSampler",
        samplerType: "sampler_non_filtering",
        visibility: "vertex",
      },
    ],
    writeUbo: (data, offsets) => {
      const origin = (offsets.get("terrainDrapeOrigin") ?? 0) / 4;
      const extent = (offsets.get("terrainDrapeExtent") ?? 0) / 4;
      data[origin] = field.originX;
      data[origin + 1] = field.originZ;
      data[origin + 2] = field.inverseSpacing;
      data[origin + 3] = 0;
      data[extent] = field.maximumColumn;
      data[extent + 1] = field.maximumRow;
      data[extent + 2] = 0;
      data[extent + 3] = 0;
    },
    bindTextures: (out: PluginTextureBinding[]) => {
      out.push({ texture: field.texture });
    },
    getActiveTextures: (out: Texture2D[]) => {
      out.push(field.texture);
    },
  };
}
