import { describe, expect, it } from "vitest";
import {
  expectedStreamingDependencyDecodedBytes,
  interleavedPositionBounds,
  planStreamingCellMemoryReservation,
  streamingTextureLevelBytes,
  validateDecodedCellResponseAccounting,
  validateDecodedStreamingDependencies,
} from "../src/streaming/streaming-dependency-contract";
import type {
  DecodedStreamingDependency,
  StreamingCellIndexEntry,
  StreamingDependencyIndexEntry,
} from "../src/streaming/streaming-protocol";
import { streamingResourceCacheKey } from "../src/streaming/streaming-resource-key";

const texture = Object.freeze({
  bytes: 9,
  decode: Object.freeze({ colorSpace: "srgb", format: "rgba8", height: 2, width: 2 }),
  dependencies: Object.freeze([]),
  format: "ktx2",
  path: `immutable/representative-streaming-ktx2-${"a".repeat(64)}.ktx2`,
  resourceId: "game-specific-streaming-00-texture",
  sha256: "a".repeat(64),
}) satisfies StreamingDependencyIndexEntry;

const mesh = Object.freeze({
  bytes: 7,
  decode: Object.freeze({ count: 3, mode: "ATTRIBUTES", stride: 12 }),
  dependencies: Object.freeze([texture.resourceId]),
  format: "meshopt",
  path: `immutable/representative-streaming-meshopt-${"b".repeat(64)}.meshopt`,
  resourceId: "game-specific-streaming-01-mesh",
  sha256: "b".repeat(64),
}) satisfies StreamingDependencyIndexEntry;

const decoded = Object.freeze([
  Object.freeze({
    cacheKey: streamingResourceCacheKey(texture),
    decodeMs: 1,
    decodedBytes: 16,
    descriptor: texture,
    encodedBytes: 9,
    format: "ktx2",
    height: 2,
    resourceId: texture.resourceId,
    data: new Uint8Array(16),
    width: 2,
  }),
  Object.freeze({
    cacheKey: streamingResourceCacheKey(mesh),
    decodeMs: 2,
    decodedBytes: 36,
    descriptor: mesh,
    encodedBytes: 7,
    format: "meshopt",
    kind: "legacy-positions",
    positions: new ArrayBuffer(36),
    resourceId: mesh.resourceId,
    vertexCount: 3,
  }),
]) satisfies readonly DecodedStreamingDependency[];

describe("streaming dependency contract", () => {
  it("sizes BC1 levels in whole 8-byte blocks", () => {
    expect(streamingTextureLevelBytes("bc1", 4096, 4096)).toBe(8_388_608);
    expect(streamingTextureLevelBytes("bc1", 2, 1)).toBe(8);
    expect(streamingTextureLevelBytes("bc7", 2, 1)).toBe(16);
  });
  it("sizes BC7 levels in whole 16-byte blocks and requires a mip chain", () => {
    expect(streamingTextureLevelBytes("bc7", 4096, 4096)).toBe(4096 * 4096);
    expect(streamingTextureLevelBytes("bc7", 2, 1)).toBe(16);
    expect(streamingTextureLevelBytes("rgba8", 2, 1)).toBe(8);
    const bc7 = {
      ...texture,
      decode: { ...texture.decode, format: "bc7", height: 8, width: 16 },
    } as const;
    expect(() =>
      expectedStreamingDependencyDecodedBytes({
        ...bc7,
        decode: { ...bc7.decode, mipLevelCount: 5, version: 2 },
      }),
    ).not.toThrow();
    expect(
      expectedStreamingDependencyDecodedBytes({
        ...bc7,
        decode: { ...bc7.decode, mipLevelCount: 5, version: 2 },
      }),
    ).toBe(128 + 32 + 16 + 16 + 16);
    expect(() => expectedStreamingDependencyDecodedBytes(bc7)).toThrow(/mip chain/);
  });
  it("plans encoded, decoded, and overlap staging before allocation", () => {
    const entry = { bytes: 100 } as StreamingCellIndexEntry;
    expect(planStreamingCellMemoryReservation(entry, [texture, mesh])).toEqual({
      decodedBytes: 252,
      encodedBytes: 116,
      stagingBytes: 152,
      totalBytes: 520,
    });
    expect(() =>
      planStreamingCellMemoryReservation(
        { bytes: Number.MAX_SAFE_INTEGER } as StreamingCellIndexEntry,
        [texture],
      ),
    ).toThrow(/overflowed/);
  });

  it("accepts only exact ordered dependency response accounting", () => {
    expect(() => validateDecodedStreamingDependencies([texture, mesh], decoded)).not.toThrow();
    const mutations: readonly DecodedStreamingDependency[][] = [
      [decoded[1] as DecodedStreamingDependency, decoded[0] as DecodedStreamingDependency],
      [{ ...decoded[0], resourceId: "wrong" }, decoded[1]] as DecodedStreamingDependency[],
      [{ ...decoded[0], encodedBytes: 8 }, decoded[1]] as DecodedStreamingDependency[],
      [{ ...decoded[0], decodedBytes: 15 }, decoded[1]] as DecodedStreamingDependency[],
      [{ ...decoded[0], data: new Uint8Array(15) }, decoded[1]] as DecodedStreamingDependency[],
      [{ ...decoded[0], decodeMs: Number.NaN }, decoded[1]] as DecodedStreamingDependency[],
      [decoded[0], { ...decoded[1], vertexCount: 4 }] as DecodedStreamingDependency[],
    ];
    for (const mutation of mutations) {
      expect(() => validateDecodedStreamingDependencies([texture, mesh], mutation)).toThrow(
        /invalid/,
      );
    }
  });

  it("carries decode-worker position bounds with interleaved vertices", () => {
    const vertexDescriptor = Object.freeze({
      bytes: 7,
      decode: Object.freeze({ count: 2, mode: "ATTRIBUTES", stride: 32, version: 1 }),
      dependencies: Object.freeze([texture.resourceId]),
      format: "meshopt",
      path: `immutable/streaming-vertices-${"c".repeat(64)}.meshopt`,
      resourceId: "game-specific-streaming-02-vertices",
      sha256: "c".repeat(64),
    }) as StreamingDependencyIndexEntry;
    // position, normal, UV per vertex; only positions contribute to the bounds.
    const attributes = new Float32Array([-1, 2, 3, 9, 9, 9, 9, 9, 4, -5, 6, -9, -9, -9, -9, -9]);
    const bounds = interleavedPositionBounds(attributes);
    expect(bounds).toEqual({ boundMin: [-1, -5, 3], boundMax: [4, 2, 6] });
    const vertices = {
      attributes: attributes.buffer,
      ...bounds,
      cacheKey: streamingResourceCacheKey(vertexDescriptor),
      decodeMs: 1,
      decodedBytes: 64,
      descriptor: vertexDescriptor,
      encodedBytes: 7,
      format: "meshopt",
      kind: "vertex-attributes",
      resourceId: vertexDescriptor.resourceId,
      vertexCount: 2,
    } as DecodedStreamingDependency;
    expect(() =>
      validateDecodedStreamingDependencies([vertexDescriptor], [vertices]),
    ).not.toThrow();
    for (const mutation of [
      { boundMin: [5, -5, 3] },
      { boundMax: [4, 2, Number.NaN] },
      { boundMin: [-1, -5] },
      { boundMax: undefined },
    ]) {
      expect(() =>
        validateDecodedStreamingDependencies(
          [vertexDescriptor],
          [{ ...vertices, ...mutation } as DecodedStreamingDependency],
        ),
      ).toThrow(/invalid/);
    }
    expect(() => interleavedPositionBounds(new Float32Array(0))).toThrow(/no vertices/);
  });

  it("rejects non-finite cell timing and aggregate encoded-size drift", () => {
    const response = {
      cell: { id: "cell-1" } as never,
      decodeMs: 3,
      dependencies: decoded,
      encodedBytes: 116,
    };
    expect(() =>
      validateDecodedCellResponseAccounting("cell-1", 100, [texture, mesh], response),
    ).not.toThrow();
    expect(() =>
      validateDecodedCellResponseAccounting("cell-1", 100, [texture, mesh], {
        ...response,
        encodedBytes: 115,
      }),
    ).toThrow(/accounting/);
    expect(() =>
      validateDecodedCellResponseAccounting("cell-1", 100, [texture, mesh], {
        ...response,
        decodeMs: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(/accounting/);
  });
});
