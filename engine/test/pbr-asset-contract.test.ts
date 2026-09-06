import { describe, expect, it } from "vitest";
import {
  expectedStreamingDependencyDecodedBytes,
  validateDecodedStreamingDependencies,
} from "../src/streaming/streaming-dependency-contract";
import type {
  DecodedKtx2Dependency,
  StreamingKtx2DependencyIndexEntry,
} from "../src/streaming/streaming-protocol";
import { streamingResourceCacheKey } from "../src/streaming/streaming-resource-key";
import { type PbrAssetPlacement, validatePbrAssetPlacements } from "../src/world/pbr-asset";

const asset: PbrAssetPlacement = {
  schemaVersion: 1,
  lodDistancesMeters: [12, 32],
  id: "test",
  position: [0, 0, 0],
  rotationYRadians: 0,
  scale: [1, 1, 1],
  material: {
    baseColorResourceId: "base",
    normalResourceId: "normal",
    ormResourceId: "orm",
    baseColorFactor: [1, 1, 1],
    roughnessFactor: 1,
    metallicFactor: 0,
    normalScale: 1,
  },
  lods: [
    { vertexResourceId: "vertex", indexResourceId: "index" },
    { vertexResourceId: "vertex", indexResourceId: "index" },
    { vertexResourceId: "vertex", indexResourceId: "index" },
  ],
};
const texture: StreamingKtx2DependencyIndexEntry = {
  bytes: 10,
  decode: {
    colorSpace: "linear",
    format: "rgba8",
    height: 4,
    width: 4,
    version: 2,
    mipLevelCount: 3,
  },
  dependencies: [],
  format: "ktx2",
  path: "immutable/test.ktx2",
  resourceId: "normal",
  sha256: "a".repeat(64),
};

describe("PBR asset transport contract", () => {
  it("accepts finite legacy and explicit periodic sampling but rejects unknown modes", () => {
    for (const mode of [undefined, "clamp-to-edge", "repeat"]) {
      const material =
        mode === undefined ? asset.material : { ...asset.material, textureAddressMode: mode };
      expect(() => validatePbrAssetPlacements([{ ...asset, material }])).not.toThrow();
    }
    expect(() =>
      validatePbrAssetPlacements([
        { ...asset, material: { ...asset.material, textureAddressMode: "mirror-repeat" } },
      ]),
    ).toThrow(/address mode/);
  });
  it("rejects malformed transforms, unexpected fields, and missing material resources", () => {
    expect(() => validatePbrAssetPlacements([asset])).not.toThrow();
    for (const value of [
      null,
      [null],
      [{ ...asset, scale: [1, 0, 1] }],
      [{ ...asset, position: [0, Number.NaN, 0] }],
      [{ ...asset, rotationXRadians: Number.POSITIVE_INFINITY }],
      [{ ...asset, rotationZRadians: "0" }],
      [{ ...asset, surprise: 1 }],
      [{ ...asset, lods: [] }],
      [asset, asset],
    ])
      expect(() => validatePbrAssetPlacements(value)).toThrow();
    expect(() =>
      validatePbrAssetPlacements([{ ...asset, rotationXRadians: 0.12, rotationZRadians: -0.08 }]),
    ).not.toThrow();
    expect(() => validatePbrAssetPlacements([asset], undefined, [texture])).toThrow(/texture role/);
    expect(() =>
      validatePbrAssetPlacements([asset], { minimum: [1, 1, 1], maximum: [2, 2, 2] }),
    ).toThrow(/outside/);
  });
  it("accounts for all mip levels and separates linear sampling cache identity", () => {
    expect(expectedStreamingDependencyDecodedBytes(texture)).toBe(84);
    expect(streamingResourceCacheKey(texture)).not.toBe(
      streamingResourceCacheKey({ ...texture, decode: { ...texture.decode, colorSpace: "srgb" } }),
    );
    expect(() =>
      expectedStreamingDependencyDecodedBytes({
        ...texture,
        decode: { ...texture.decode, mipLevelCount: 2 },
      }),
    ).toThrow(/complete mip chain/);
    const rgba = new ArrayBuffer(64);
    const decoded: DecodedKtx2Dependency = {
      cacheKey: streamingResourceCacheKey(texture),
      descriptor: texture,
      decodeMs: 1,
      decodedBytes: 84,
      encodedBytes: 10,
      format: "ktx2",
      width: 4,
      height: 4,
      resourceId: texture.resourceId,
      rgba,
      mipmaps: [
        { width: 4, height: 4, rgba },
        { width: 2, height: 2, rgba: new ArrayBuffer(16) },
        { width: 1, height: 1, rgba: new ArrayBuffer(4) },
      ],
    };
    expect(() => validateDecodedStreamingDependencies([texture], [decoded])).not.toThrow();
    expect(() =>
      validateDecodedStreamingDependencies(
        [texture],
        [{ ...decoded, mipmaps: (decoded.mipmaps ?? []).slice(0, 2) }],
      ),
    ).toThrow(/mip chain/);
    expect(() =>
      validateDecodedStreamingDependencies([texture], [{ ...decoded, decodedBytes: 64 }]),
    ).toThrow(/identity/);
  });
});
