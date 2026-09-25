import {
  acquireTexture,
  createMeshFromStorageBuffer,
  createPbrMaterial,
  createStorageBuffer,
  createTexture2DFromPixels,
  disposeMeshGpu,
  disposeStorageBuffer,
  type EngineContext,
  getOrCreateSampler,
  type Mesh,
  type StorageBuffer,
  setThinInstances,
  type Texture2D,
} from "@babylonjs/lite";
import { streamingTextureLevelBytes } from "../streaming/streaming-dependency-contract";
import type { StreamingTextureGpuFormat } from "../streaming/streaming-protocol";
import type { PbrAssetPlacement } from "../world/pbr-asset";
import type { WorldVec3 } from "../world/world-contract";

/** Streamed PBR vertices: float32 position, normal and UV, interleaved as meshopt decodes them. */
export const STREAMED_PBR_VERTEX_STRIDE = 32;
const STREAMED_PBR_ATTRIBUTE_OFFSETS = Object.freeze({ position: 0, normal: 12, uv: 24 });

/** One source mesh drawing straight from its two GPU allocations. It is never added to a
 * scene; placement clones share its geometry, and the owner disposes it after the clones.
 */
export interface StreamedPbrGeometry {
  readonly mesh: Mesh;
  readonly vertices: StorageBuffer;
  readonly indices: StorageBuffer;
  readonly gpuBytes: number;
}

/** Copy prepared decode-worker output to the GPU. The build validated the values (finite
 * attributes, in-range indices) and the decode worker computed the bounds, so the render thread
 * does no per-vertex work: two mapped-buffer copies and no retained CPU arrays.
 */
export function createStreamedPbrGeometry(
  engine: EngineContext,
  name: string,
  vertices: Readonly<{
    attributes: ArrayBuffer;
    vertexCount: number;
    boundMin: WorldVec3;
    boundMax: WorldVec3;
  }>,
  indices: Readonly<{ indices: ArrayBuffer; indexCount: number }>,
): StreamedPbrGeometry {
  if (
    !Number.isSafeInteger(vertices.vertexCount) ||
    vertices.vertexCount <= 0 ||
    vertices.attributes.byteLength !== vertices.vertexCount * STREAMED_PBR_VERTEX_STRIDE ||
    !Number.isSafeInteger(indices.indexCount) ||
    indices.indexCount <= 0 ||
    indices.indexCount % 3 !== 0 ||
    indices.indices.byteLength !== indices.indexCount * 4
  )
    throw new Error(`Streamed PBR geometry ${name} is invalid`);
  const vertexStorage = createStorageBuffer(engine, new Uint8Array(vertices.attributes), {
    label: `${name}-vertices`,
    vertex: true,
  });
  let indexStorage: StorageBuffer | null = null;
  try {
    indexStorage = createStorageBuffer(engine, new Uint8Array(indices.indices), {
      label: `${name}-indices`,
      index: true,
    });
    const mesh = createMeshFromStorageBuffer(engine, name, {
      storage: vertexStorage,
      indices: indexStorage,
      indexFormat: "uint32",
      indexCount: indices.indexCount,
      vertexCount: vertices.vertexCount,
      arrayStride: STREAMED_PBR_VERTEX_STRIDE,
      attributeOffsets: STREAMED_PBR_ATTRIBUTE_OFFSETS,
      boundMin: vertices.boundMin,
      boundMax: vertices.boundMax,
    });
    return Object.freeze({
      mesh,
      vertices: vertexStorage,
      indices: indexStorage,
      gpuBytes: vertexStorage.byteLength + indexStorage.byteLength,
    });
  } catch (error: unknown) {
    if (indexStorage !== null) disposeStorageBuffer(indexStorage);
    disposeStorageBuffer(vertexStorage);
    throw error;
  }
}

/** Call after every placement clone has left its scene. */
export function disposeStreamedPbrGeometry(geometry: StreamedPbrGeometry): void {
  disposeMeshGpu(geometry.mesh);
  disposeStorageBuffer(geometry.indices);
  disposeStorageBuffer(geometry.vertices);
}

export interface PbrSurfaceFactors {
  readonly baseColorFactor: readonly [number, number, number];
  readonly roughnessFactor: number;
  readonly metallicFactor: number;
  readonly normalScale: number;
}

/** Only geometry/material compatibility controls draw grouping; transforms and
 * LOD distances stay per placement. Canonical field order avoids JSON key-order
 * differences splitting equivalent material bindings.
 */
export function groupPbrAssetPlacements(
  placements: readonly PbrAssetPlacement[],
): PbrAssetPlacement[][] {
  const groups = new Map<string, PbrAssetPlacement[]>();
  for (const placement of placements) {
    const m = placement.material;
    const key = JSON.stringify([
      placement.lods.map((lod) => [lod.vertexResourceId, lod.indexResourceId]),
      m.baseColorResourceId,
      m.normalResourceId,
      m.ormResourceId,
      m.baseColorFactor,
      m.roughnessFactor,
      m.metallicFactor,
      m.normalScale,
      m.textureAddressMode ?? "clamp-to-edge",
    ]);
    const group = groups.get(key);
    if (group) group.push(placement);
    else groups.set(key, [placement]);
  }
  return [...groups.values()];
}

/** Borrow the cached GPU storage; only the material's sampler binding differs.
 * Lite counts texture references by GPUTexture, not Texture2D wrapper identity.
 * Renderable ownership acquires/releases these bindings; creating this borrowed
 * wrapper adds no independent lifetime or duplicate decoded/GPU allocation.
 */
export function withPbrTextureAddressMode(
  engine: EngineContext,
  texture: Texture2D,
  addressMode: "clamp-to-edge" | "repeat" = "clamp-to-edge",
): Texture2D {
  if (addressMode === "clamp-to-edge") return texture;
  return {
    ...texture,
    sampler: getOrCreateSampler(engine, {
      addressModeU: addressMode,
      addressModeV: addressMode,
      minFilter: "linear",
      magFilter: "linear",
      mipmapFilter: "linear",
      maxAnisotropy: 8,
    }),
  };
}

/** Ten percent hysteresis prevents repeated switches at a distance boundary. */
export function selectPbrAssetLod(
  distance: number,
  boundaries: readonly [number, number],
  previous: number,
): number {
  const near = boundaries[0] * (previous === 0 ? 1.1 : 0.9);
  const far = boundaries[1] * (previous === 2 ? 0.9 : 1.1);
  return distance <= near ? 0 : distance <= far ? 1 : 2;
}

/** All runtime surfaces and the warmup fixture use precisely the same PBR features. */
export function createStreamedPbrMaterial(
  textures: Readonly<{ baseColor: Texture2D; normal: Texture2D; orm: Texture2D }>,
  factors: PbrSurfaceFactors,
) {
  return createPbrMaterial({
    baseColorTexture: textures.baseColor,
    normalTexture: textures.normal,
    ormTexture: textures.orm,
    baseColorFactor: [...factors.baseColorFactor, 1],
    roughnessFactor: factors.roughnessFactor,
    metallicFactor: factors.metallicFactor,
    normalTextureScale: factors.normalScale,
    occlusionStrength: 1,
    enableSpecularAA: true,
  });
}

export function createPbrWarmupMesh(engine: EngineContext) {
  const textures = {
    baseColor: createTexture2DFromPixels(engine, new Uint8Array([180, 180, 180, 255]), 1, 1, {
      srgb: true,
    }),
    normal: createTexture2DFromPixels(engine, new Uint8Array([128, 128, 255, 255]), 1, 1),
    orm: createTexture2DFromPixels(engine, new Uint8Array([255, 220, 0, 255]), 1, 1),
  };
  // The warmup draws through the same interleaved slab layout as streamed geometry, so its
  // colour and depth pipelines are exactly the ones runtime placements use.
  const geometry = createStreamedPbrGeometry(
    engine,
    "streamed-pbr-warmup",
    {
      attributes: new Float32Array([
        0, -1000, 0, 0, 1, 0, 0, 0, 0, -1000, 1, 0, 1, 0, 0, 1, 1, -1000, 0, 0, 1, 0, 1, 0,
      ]).buffer,
      vertexCount: 3,
      boundMin: [0, -1000, 0],
      boundMax: [1, -1000, 1],
    },
    { indices: new Uint32Array([0, 1, 2]).buffer, indexCount: 3 },
  );
  const mesh = geometry.mesh;
  mesh.material = createStreamedPbrMaterial(textures, {
    baseColorFactor: [1, 1, 1],
    roughnessFactor: 1,
    metallicFactor: 0,
    normalScale: 0.35,
  });
  mesh.receiveShadows = true;
  setThinInstances(mesh, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), 1);
  return { geometry, mesh, textures };
}

export interface DecodedTextureMip {
  readonly width: number;
  readonly height: number;
  /** Texels in the texture's GPU format: RGBA8 rows or BC7/BC1 4 × 4 blocks. Often a view into
   * a larger container buffer; `writeTexture` copies exactly the view's range. */
  readonly data: Uint8Array;
}

/** Upload already decoded, installed mip bytes. No decoder, URL, or shader work here. */
export function uploadStreamedPbrTexture(
  engine: EngineContext,
  levels: readonly DecodedTextureMip[],
  format: StreamingTextureGpuFormat,
  srgb: boolean,
): Readonly<{ texture: Texture2D; gpuBytes: number }> {
  const first = levels[0];
  if (first === undefined) throw new Error("PBR texture has no mip levels");
  let gpuBytes = 0;
  for (const [index, mip] of levels.entries()) {
    if (
      mip.width !== Math.max(1, first.width >> index) ||
      mip.height !== Math.max(1, first.height >> index) ||
      mip.data.byteLength !== streamingTextureLevelBytes(format, mip.width, mip.height)
    )
      throw new Error("PBR texture mip dimensions or byte length are invalid");
    gpuBytes += mip.data.byteLength;
  }
  if (levels.length !== 1 + Math.floor(Math.log2(Math.max(first.width, first.height))))
    throw new Error("PBR texture requires its complete authored mip chain");
  const block = format !== "rgba8";
  const blockBytes = format === "bc7" ? 16 : 8;
  if (block && (first.width % 4 !== 0 || first.height % 4 !== 0))
    throw new Error("Block-compressed PBR texture base dimensions must be whole blocks");
  // Lite 1.31's public pixel uploader still only allocates mip zero. This bounded device
  // seam uploads the decoded chain without adding a runtime mip-generation PSO.
  const device = Reflect.get(engine, "_device") as GPUDevice;
  // Chrome-only on BC-capable desktop GPUs: no RGBA8 fallback for BC descriptors.
  if (block && !device.features.has("texture-compression-bc"))
    throw new Error("BC PBR textures require the texture-compression-bc device feature");
  const gpuTexture = device.createTexture({
    label: "streamed-pbr-mip-chain",
    size: { width: first.width, height: first.height },
    format: block
      ? `${format}-rgba-unorm${srgb ? "-srgb" : ""}`
      : srgb
        ? "rgba8unorm-srgb"
        : "rgba8unorm",
    mipLevelCount: levels.length,
    // WebGPU GPUTextureUsage.TEXTURE_BINDING | COPY_DST; numeric flags keep this
    // engine module importable by the Node-side contract tests.
    usage: 0x04 | 0x02,
  });
  try {
    for (const [mipLevel, mip] of levels.entries()) {
      // Block formats copy whole blocks: rows of 4 × 4 blocks, with sub-block mips padded.
      const blocksWide = Math.ceil(mip.width / 4);
      const blocksHigh = Math.ceil(mip.height / 4);
      device.queue.writeTexture(
        { texture: gpuTexture, mipLevel },
        mip.data,
        block
          ? { bytesPerRow: blocksWide * blockBytes, rowsPerImage: blocksHigh }
          : { bytesPerRow: mip.width * 4, rowsPerImage: mip.height },
        block
          ? { width: blocksWide * 4, height: blocksHigh * 4 }
          : { width: mip.width, height: mip.height },
      );
    }
    const texture: Texture2D = {
      texture: gpuTexture,
      view: gpuTexture.createView(),
      sampler: getOrCreateSampler(engine, {
        // Current PBR placements are finite modules with UVs in [0, 1]. Clamp
        // anisotropic footprints at the perimeter so unrelated opposite edges of
        // a nonperiodic source cannot bleed into the visible border.
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
        minFilter: "linear",
        magFilter: "linear",
        mipmapFilter: "linear",
        maxAnisotropy: 8,
      }),
      width: first.width,
      height: first.height,
    };
    acquireTexture(texture);
    return { texture, gpuBytes };
  } catch (error: unknown) {
    gpuTexture.destroy();
    throw error;
  }
}
