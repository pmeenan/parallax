/**
 * Reader for uncompressed RGBA8 KTX2 textures, optionally zstd-supercompressed per level.
 * The pinned Babylon KTX2 decoder accepts only Basis payloads (UASTC/ETC1S); lossless maps
 * such as the photoreal paving normal (D-197) ship as RGBA8. The zstd decoder is injected so
 * the worker can use the pinned wasm decoder and tests can use Node's implementation.
 */

const KTX2_IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
export const KTX2_VK_FORMAT_UNDEFINED = 0;
export const KTX2_VK_FORMAT_R8G8B8A8_UNORM = 37;
export const KTX2_VK_FORMAT_R8G8B8A8_SRGB = 43;
const SUPERCOMPRESSION_NONE = 0;
const SUPERCOMPRESSION_ZSTD = 2;
const LEVEL_INDEX_OFFSET = 80;

export interface Ktx2Rgba8Level {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export type ZstdDecompress = (input: Uint8Array, uncompressedByteLength: number) => Uint8Array;

/** Returns the header's vkFormat, or throws when the bytes are not a KTX2 container. */
export function readKtx2VkFormat(bytes: Uint8Array): number {
  if (bytes.byteLength < LEVEL_INDEX_OFFSET || KTX2_IDENTIFIER.some((b, i) => bytes[i] !== b)) {
    throw new Error("Bytes are not a KTX2 container");
  }
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true);
}

export function decodeKtx2Rgba8(
  bytes: Uint8Array,
  expected: Readonly<{ width: number; height: number; srgb: boolean; levels: number }>,
  zstd: ZstdDecompress,
): Ktx2Rgba8Level[] {
  const vkFormat = readKtx2VkFormat(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (offset: number) => view.getUint32(offset, true);
  const u64 = (offset: number) => {
    const value = view.getBigUint64(offset, true);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("KTX2 offset is out of range");
    return Number(value);
  };
  const expectedFormat = expected.srgb
    ? KTX2_VK_FORMAT_R8G8B8A8_SRGB
    : KTX2_VK_FORMAT_R8G8B8A8_UNORM;
  const width = u32(20);
  const height = u32(24);
  const levelCount = u32(40);
  const scheme = u32(44);
  if (
    vkFormat !== expectedFormat ||
    u32(16) !== 1 ||
    width !== expected.width ||
    height !== expected.height ||
    u32(28) !== 0 ||
    u32(32) !== 0 ||
    u32(36) !== 1 ||
    levelCount < expected.levels ||
    (scheme !== SUPERCOMPRESSION_NONE && scheme !== SUPERCOMPRESSION_ZSTD) ||
    bytes.byteLength < LEVEL_INDEX_OFFSET + levelCount * 24
  ) {
    throw new Error("KTX2 RGBA8 header does not match its descriptor");
  }
  const levels: Ktx2Rgba8Level[] = [];
  for (let level = 0; level < expected.levels; level += 1) {
    const entry = LEVEL_INDEX_OFFSET + level * 24;
    const byteOffset = u64(entry);
    const byteLength = u64(entry + 8);
    const uncompressedByteLength = u64(entry + 16);
    const levelWidth = Math.max(1, width >> level);
    const levelHeight = Math.max(1, height >> level);
    if (
      uncompressedByteLength !== levelWidth * levelHeight * 4 ||
      byteOffset + byteLength > bytes.byteLength ||
      (scheme === SUPERCOMPRESSION_NONE && byteLength !== uncompressedByteLength)
    ) {
      throw new Error(`KTX2 RGBA8 level ${level} is invalid`);
    }
    const stored = bytes.subarray(byteOffset, byteOffset + byteLength);
    const rgba = scheme === SUPERCOMPRESSION_ZSTD ? zstd(stored, uncompressedByteLength) : stored;
    if (rgba.byteLength !== uncompressedByteLength) {
      throw new Error(`KTX2 RGBA8 level ${level} decompressed to the wrong size`);
    }
    levels.push(Object.freeze({ width: levelWidth, height: levelHeight, rgba }));
  }
  return levels;
}
