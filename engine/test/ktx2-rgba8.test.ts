import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  decodeKtx2Rgba8,
  KTX2_VK_FORMAT_R8G8B8A8_SRGB,
  KTX2_VK_FORMAT_R8G8B8A8_UNORM,
  readKtx2VkFormat,
} from "../src/streaming/ktx2-rgba8";

const zstd = (input: Uint8Array, size: number) =>
  new Uint8Array(zstdDecompressSync(input, { maxOutputLength: size }));

/** Minimal KTX2 container: header, level index, then level payloads (no DFD needed). */
function container(
  vkFormat: number,
  width: number,
  levels: readonly Uint8Array[],
  scheme: 0 | 2,
): Uint8Array {
  const stored = levels.map((level) => (scheme === 2 ? zstdCompressSync(level) : level));
  const indexBytes = 80 + levels.length * 24;
  const total = indexBytes + stored.reduce((sum, level) => sum + level.byteLength, 0);
  const bytes = new Uint8Array(total);
  bytes.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  for (const [offset, value] of [
    [12, vkFormat],
    [16, 1],
    [20, width],
    [24, width],
    [28, 0],
    [32, 0],
    [36, 1],
    [40, levels.length],
    [44, scheme],
  ] as const)
    view.setUint32(offset, value, true);
  let cursor = indexBytes;
  for (const [level, payload] of stored.entries()) {
    const entry = 80 + level * 24;
    view.setBigUint64(entry, BigInt(cursor), true);
    view.setBigUint64(entry + 8, BigInt(payload.byteLength), true);
    view.setBigUint64(entry + 16, BigInt(levels[level]?.byteLength ?? 0), true);
    bytes.set(payload, cursor);
    cursor += payload.byteLength;
  }
  return bytes;
}

const chain = [
  Uint8Array.from({ length: 4 * 4 * 4 }, (_, i) => i),
  Uint8Array.from({ length: 2 * 2 * 4 }, (_, i) => 200 - i),
  Uint8Array.from([9, 8, 7, 6]),
];

describe("uncompressed RGBA8 KTX2 reader", () => {
  it("returns every level exactly, with or without zstd supercompression", () => {
    for (const scheme of [0, 2] as const) {
      const bytes = container(KTX2_VK_FORMAT_R8G8B8A8_UNORM, 4, chain, scheme);
      expect(readKtx2VkFormat(bytes)).toBe(KTX2_VK_FORMAT_R8G8B8A8_UNORM);
      const levels = decodeKtx2Rgba8(bytes, { width: 4, height: 4, srgb: false, levels: 3 }, zstd);
      expect(levels.map((level) => [level.width, level.height])).toEqual([
        [4, 4],
        [2, 2],
        [1, 1],
      ]);
      levels.forEach((level, index) => {
        expect(Array.from(level.rgba)).toEqual(Array.from(chain[index] ?? []));
      });
    }
  });

  it("rejects colour-space, size and payload mismatches", () => {
    const linear = container(KTX2_VK_FORMAT_R8G8B8A8_UNORM, 4, chain, 2);
    expect(() =>
      decodeKtx2Rgba8(linear, { width: 4, height: 4, srgb: true, levels: 3 }, zstd),
    ).toThrow(/descriptor/);
    expect(() =>
      decodeKtx2Rgba8(linear, { width: 8, height: 8, srgb: false, levels: 3 }, zstd),
    ).toThrow(/descriptor/);
    const srgb = container(KTX2_VK_FORMAT_R8G8B8A8_SRGB, 4, chain, 0);
    const truncated = srgb.slice(0, srgb.byteLength - 1);
    expect(() =>
      decodeKtx2Rgba8(truncated, { width: 4, height: 4, srgb: true, levels: 3 }, zstd),
    ).toThrow(/level/);
    expect(() => readKtx2VkFormat(new Uint8Array(100))).toThrow(/KTX2/);
    expect(() =>
      decodeKtx2Rgba8(
        linear,
        { width: 4, height: 4, srgb: false, levels: 3 },
        () => new Uint8Array(3),
      ),
    ).toThrow(/wrong size/);
  });
});
