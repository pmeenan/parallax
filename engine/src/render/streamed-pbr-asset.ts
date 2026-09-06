import {
  acquireTexture,
  createMeshFromData,
  createPbrMaterial,
  createTexture2DFromPixels,
  type EngineContext,
  getOrCreateSampler,
  setThinInstances,
  type Texture2D,
} from "@babylonjs/lite";
import type { PbrAssetPlacement } from "../world/pbr-asset";

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
  const mesh = createMeshFromData(
    engine,
    "streamed-pbr-warmup",
    new Float32Array([0, -1000, 0, 0, -1000, 1, 1, -1000, 0]),
    new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    new Uint32Array([0, 1, 2]),
    new Float32Array([0, 0, 0, 1, 1, 0]),
  );
  mesh.material = createStreamedPbrMaterial(textures, {
    baseColorFactor: [1, 1, 1],
    roughnessFactor: 1,
    metallicFactor: 0,
    normalScale: 0.35,
  });
  mesh.receiveShadows = true;
  setThinInstances(mesh, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), 1);
  return { mesh, textures };
}

export interface DecodedTextureMip {
  readonly width: number;
  readonly height: number;
  readonly rgba: ArrayBuffer;
}

/** Upload already decoded, installed mip bytes. No decoder, URL, or shader work here. */
export function uploadStreamedPbrTexture(
  engine: EngineContext,
  levels: readonly DecodedTextureMip[],
  srgb: boolean,
): Readonly<{ texture: Texture2D; gpuBytes: number }> {
  const first = levels[0];
  if (first === undefined) throw new Error("PBR texture has no mip levels");
  let gpuBytes = 0;
  for (const [index, mip] of levels.entries()) {
    if (
      mip.width !== Math.max(1, first.width >> index) ||
      mip.height !== Math.max(1, first.height >> index) ||
      mip.rgba.byteLength !== mip.width * mip.height * 4
    )
      throw new Error("PBR texture mip dimensions or byte length are invalid");
    gpuBytes += mip.rgba.byteLength;
  }
  if (levels.length !== 1 + Math.floor(Math.log2(Math.max(first.width, first.height))))
    throw new Error("PBR texture requires its complete authored mip chain");
  // Lite 1.12's public pixel uploader only allocates mip zero. This bounded device
  // seam uploads the decoded chain without adding a runtime mip-generation PSO.
  const device = Reflect.get(engine, "_device") as GPUDevice;
  const gpuTexture = device.createTexture({
    label: "streamed-pbr-mip-chain",
    size: { width: first.width, height: first.height },
    format: srgb ? "rgba8unorm-srgb" : "rgba8unorm",
    mipLevelCount: levels.length,
    // WebGPU GPUTextureUsage.TEXTURE_BINDING | COPY_DST; numeric flags keep this
    // engine module importable by the Node-side contract tests.
    usage: 0x04 | 0x02,
  });
  try {
    for (const [mipLevel, mip] of levels.entries())
      device.queue.writeTexture(
        { texture: gpuTexture, mipLevel },
        mip.rgba,
        { bytesPerRow: mip.width * 4, rowsPerImage: mip.height },
        { width: mip.width, height: mip.height },
      );
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
