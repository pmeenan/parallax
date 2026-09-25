import createMscTranscoder from "parallax:msc-transcoder-factory";
import * as KTX2DecoderPackage from "@babylonjs/ktx2decoder";
import { MeshoptDecoder } from "meshoptimizer/decoder";
import {
  type RepresentativeCompressedStreamingFixtures,
  representativeCompressedStreamingFixtures,
} from "./representative-compressed-fixtures";
import {
  expectedStreamingDependencyDecodedBytes,
  interleavedPositionBounds,
  streamingTextureLevelBytes,
} from "./streaming-dependency-contract";
import type {
  DecodeDependencyRequest,
  DecodedStreamingDependency,
  StreamingMeshoptDependencyIndexEntry,
  StreamingMeshoptIndexDependencyIndexEntry,
  StreamingMeshoptVertexDependencyIndexEntry,
} from "./streaming-protocol";
import { streamingResourceCacheKey } from "./streaming-resource-key";

const MSC_TRANSCODER_WASM_ARTIFACT = "__MSC_TRANSCODER_WASM_ARTIFACT__";
const UASTC_RGBA_SRGB_WASM_ARTIFACT = "__UASTC_RGBA_SRGB_WASM_ARTIFACT__";
const UASTC_RGBA_UNORM_WASM_ARTIFACT = "__UASTC_RGBA_UNORM_WASM_ARTIFACT__";
const UASTC_BC7_WASM_ARTIFACT = "__UASTC_BC7_WASM_ARTIFACT__";
/** KTX2.EngineFormat.COMPRESSED_RGBA_BPTC_UNORM_EXT: the decoder's BC7 transcode result. */
const DECODED_BC7_ENGINE_FORMAT = 36492;
const ZSTD_DECODER_WASM_ARTIFACT = "__ZSTD_DECODER_WASM_ARTIFACT__";

export type { RepresentativeCompressedStreamingFixtures };
export { representativeCompressedStreamingFixtures };

export interface CompressedStreamingDecoder {
  decode(dependency: DecodeDependencyRequest): Promise<DecodedStreamingDependency>;
}

/** Only the legacy three-vertex fixture is still value-checked at runtime; versioned meshopt
 * payloads are validated when the build packs them (`validateVersionedMeshoptPayload`). */
export type CompressedStreamingDecodeFailureCode = "non-finite-vertex-attribute";

export class CompressedStreamingDecodeError extends Error {
  readonly code: CompressedStreamingDecodeFailureCode;
  readonly resourceId: string;

  constructor(code: CompressedStreamingDecodeFailureCode, resourceId: string, message: string) {
    super(message);
    this.name = "CompressedStreamingDecodeError";
    this.code = code;
    this.resourceId = resourceId;
  }
}

export function createCompressedStreamingDecoder(): CompressedStreamingDecoder {
  KTX2DecoderPackage.MSCTranscoder.JSModule = createMscTranscoder;
  KTX2DecoderPackage.MSCTranscoder.UseFromWorkerThread = false;
  KTX2DecoderPackage.WASMMemoryManager.LoadBinariesFromCurrentThread = true;
  KTX2DecoderPackage.MSCTranscoder.WasmModuleURL = new URL(
    MSC_TRANSCODER_WASM_ARTIFACT,
    import.meta.url,
  ).href;
  KTX2DecoderPackage.LiteTranscoder_UASTC_RGBA_SRGB.WasmModuleURL = new URL(
    UASTC_RGBA_SRGB_WASM_ARTIFACT,
    import.meta.url,
  ).href;
  KTX2DecoderPackage.LiteTranscoder_UASTC_RGBA_UNORM.WasmModuleURL = new URL(
    UASTC_RGBA_UNORM_WASM_ARTIFACT,
    import.meta.url,
  ).href;
  KTX2DecoderPackage.LiteTranscoder_UASTC_BC7.WasmModuleURL = new URL(
    UASTC_BC7_WASM_ARTIFACT,
    import.meta.url,
  ).href;
  // zstd supercompression, for UASTC levels and lossless RGBA8 maps (D-197). Compression
  // Streams have no zstd in Chrome 152 (RE-050), so the decoder uses the pinned wasm.
  KTX2DecoderPackage.ZSTDDecoder.WasmModuleURL = new URL(
    ZSTD_DECODER_WASM_ARTIFACT,
    import.meta.url,
  ).href;

  return Object.freeze({
    async decode(dependency: DecodeDependencyRequest): Promise<DecodedStreamingDependency> {
      const startedAt = performance.now();
      if (dependency.bytes.byteLength !== dependency.descriptor.bytes) {
        throw new Error(
          `Compressed dependency ${dependency.descriptor.resourceId} encoded size is invalid`,
        );
      }
      const expectedDecodedBytes = expectedStreamingDependencyDecodedBytes(dependency.descriptor);
      if (dependency.descriptor.format === "meshopt") {
        const descriptor = dependency.descriptor;
        // meshopt geometry is D-203's one client-decode exception: about 2.3× smaller to
        // download and install for a few milliseconds of decode-worker time per cell.
        await MeshoptDecoder.ready;
        const decoded = new Uint8Array(expectedDecodedBytes);
        MeshoptDecoder.decodeGltfBuffer(
          decoded,
          descriptor.decode.count,
          descriptor.decode.stride,
          new Uint8Array(dependency.bytes),
          descriptor.decode.mode,
        );
        const validateFiniteAttributes = (): void => {
          const attributes = new Float32Array(decoded.buffer);
          for (let index = 0; index < attributes.length; index += 1) {
            const value = attributes[index];
            if (value === undefined || !Number.isFinite(value)) {
              throw new CompressedStreamingDecodeError(
                "non-finite-vertex-attribute",
                descriptor.resourceId,
                `Meshopt dependency ${descriptor.resourceId} decoded a non-finite vertex attribute`,
              );
            }
          }
        };
        if ("version" in descriptor.decode) {
          // Finite attributes and index ranges were checked when the build packed this payload
          // (`validateVersionedMeshoptPayload`); installed bytes are hash-bound to that output.
          return descriptor.decode.mode === "ATTRIBUTES"
            ? Object.freeze({
                attributes: decoded.buffer,
                // The render thread draws this interleaved stream as-is and takes its culling
                // bounds from here, so it does no per-vertex work.
                ...interleavedPositionBounds(new Float32Array(decoded.buffer)),
                cacheKey: streamingResourceCacheKey(descriptor),
                descriptor: descriptor as StreamingMeshoptVertexDependencyIndexEntry,
                decodeMs: performance.now() - startedAt,
                decodedBytes: decoded.byteLength,
                encodedBytes: dependency.bytes.byteLength,
                format: "meshopt" as const,
                kind: "vertex-attributes" as const,
                resourceId: descriptor.resourceId,
                vertexCount: descriptor.decode.count,
              })
            : Object.freeze({
                cacheKey: streamingResourceCacheKey(descriptor),
                descriptor: descriptor as StreamingMeshoptIndexDependencyIndexEntry,
                decodeMs: performance.now() - startedAt,
                decodedBytes: decoded.byteLength,
                encodedBytes: dependency.bytes.byteLength,
                format: "meshopt" as const,
                indexCount: descriptor.decode.count,
                indices: decoded.buffer,
                kind: "indices" as const,
                resourceId: descriptor.resourceId,
              });
        }
        validateFiniteAttributes();
        return Object.freeze({
          cacheKey: streamingResourceCacheKey(descriptor),
          descriptor,
          decodeMs: performance.now() - startedAt,
          decodedBytes: decoded.byteLength,
          encodedBytes: dependency.bytes.byteLength,
          format: "meshopt" as const,
          kind: "legacy-positions" as const,
          positions: decoded.buffer,
          resourceId: descriptor.resourceId,
          vertexCount: descriptor.decode.count,
        });
      }

      const gpuFormat = dependency.descriptor.decode.format;
      const bytes = new Uint8Array(dependency.bytes);
      const rawLevels = validateRawKtx2Container(bytes, dependency.descriptor.decode);
      if (gpuFormat === "bc1" || (gpuFormat === "bc7" && rawLevels !== null)) {
        // BCn ships pre-encoded (D-201): the pinned decoder has no BCn passthrough (it treats
        // unknown colour models as ETC1S), so the levels are copied out exactly as stored. BC1
        // is never transcoded at runtime: UASTC→BC1 is a real BC1 encode, about 8× slower than
        // UASTC→BC7. A UASTC container requested as `bc7` still transcodes below.
        if (rawLevels === null || dependency.descriptor.decode.version !== 2)
          throw new Error(`BC1 dependency ${dependency.descriptor.resourceId} is not raw BC1`);
        const { width, height } = dependency.descriptor.decode;
        // Views, not copies: the container buffer travels on to the render worker intact.
        const mipmaps = rawLevels.map((level, index) =>
          Object.freeze({
            width: Math.max(1, Math.floor(width / 2 ** index)),
            height: Math.max(1, Math.floor(height / 2 ** index)),
            data: bytes.subarray(level.byteOffset, level.byteOffset + level.byteLength),
          }),
        );
        if (mipmaps.reduce((sum, mip) => sum + mip.data.byteLength, 0) !== expectedDecodedBytes)
          throw new Error(`KTX2 ${gpuFormat} mip chain is incomplete`);
        return Object.freeze({
          cacheKey: streamingResourceCacheKey(dependency.descriptor),
          descriptor: dependency.descriptor,
          decodeMs: performance.now() - startedAt,
          decodedBytes: expectedDecodedBytes,
          encodedBytes: dependency.bytes.byteLength,
          format: "ktx2" as const,
          height,
          resourceId: dependency.descriptor.resourceId,
          data: mipmaps[0]?.data ?? new Uint8Array(0),
          mipmaps: Object.freeze(mipmaps),
          width,
        });
      }
      // The pinned decoder handles the other containers: UASTC transcodes to BC7 blocks for
      // `bc7` descriptors or to RGBA8, and raw RGBA8 KTX2 (plain or zstd) copies through as
      // RGBA8. A raw container requested as `bc7` fails the transcoded-format check below.
      const bc7 = gpuFormat === "bc7";
      const decoded = await new KTX2DecoderPackage.KTX2Decoder().decode(
        bytes,
        {
          astc: false,
          bptc: bc7,
          etc1: false,
          etc2: false,
          pvrtc: false,
          s3tc: false,
        },
        bc7 ? {} : { forceRGBA: true },
      );
      const { width, height } = dependency.descriptor.decode;
      const base = decoded.mipmaps[0];
      if (
        base?.data === null ||
        base === undefined ||
        (bc7 && decoded.transcodedFormat !== DECODED_BC7_ENGINE_FORMAT) ||
        base.width !== width ||
        base.height !== height ||
        base.data.byteLength !== streamingTextureLevelBytes(gpuFormat, width, height)
      ) {
        throw new Error(
          `KTX2 dependency ${dependency.descriptor.resourceId} did not decode ${gpuFormat}`,
        );
      }
      const data = base.data.slice();
      const mipmaps =
        dependency.descriptor.decode.version === 2
          ? decoded.mipmaps.map((mip, level) => {
              if (
                mip.data === null ||
                mip.width !== Math.max(1, Math.floor(width / 2 ** level)) ||
                mip.height !== Math.max(1, Math.floor(height / 2 ** level)) ||
                mip.data.byteLength !== streamingTextureLevelBytes(gpuFormat, mip.width, mip.height)
              )
                throw new Error("KTX2 decoded mip dimensions are invalid");
              return Object.freeze({
                width: mip.width,
                height: mip.height,
                data: level === 0 ? data : mip.data.slice(),
              });
            })
          : undefined;
      if (
        mipmaps !== undefined &&
        (mipmaps.length !== dependency.descriptor.decode.mipLevelCount ||
          mipmaps.reduce((sum, mip) => sum + mip.data.byteLength, 0) !== expectedDecodedBytes)
      )
        throw new Error("KTX2 decoded mip chain is incomplete");
      return Object.freeze({
        cacheKey: streamingResourceCacheKey(dependency.descriptor),
        descriptor: dependency.descriptor,
        decodeMs: performance.now() - startedAt,
        decodedBytes: expectedDecodedBytes,
        encodedBytes: dependency.bytes.byteLength,
        format: "ktx2" as const,
        height,
        resourceId: dependency.descriptor.resourceId,
        data,
        ...(mipmaps === undefined ? {} : { mipmaps: Object.freeze(mipmaps) }),
        width,
      });
    },
  });
}

/** The vendor decoder copies raw RGBA8 levels but does not enforce our single-image, colour-space
 * or declared byte-range contract, and it cannot read BCn containers. Check raw containers against
 * the descriptor before decoding; return their level ranges, or null for a Basis payload. */
function validateRawKtx2Container(
  bytes: Uint8Array,
  expected: Extract<DecodeDependencyRequest["descriptor"], { format: "ktx2" }>["decode"],
): readonly Readonly<{ byteOffset: number; byteLength: number }>[] | null {
  if (bytes.byteLength < 80 || !KTX2DecoderPackage.KTX2FileReader.IsValid(bytes))
    throw new Error("Invalid KTX2 container");
  if (new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true) === 0)
    return null; // Basis payloads are validated by the transcoder and decoded mip checks.
  const reader = new KTX2DecoderPackage.KTX2FileReader(bytes);
  reader.parse();
  const header = reader.header;
  const levels = expected.version === 2 ? expected.mipLevelCount : 1;
  // VK_FORMAT_R8G8B8A8_{SRGB,UNORM} = 43/37, VK_FORMAT_BC1_RGB_{SRGB,UNORM}_BLOCK = 132/131 and
  // VK_FORMAT_BC7_{SRGB,UNORM}_BLOCK = 146/145. Pre-encoded BCn is stored plain, all levels.
  const srgb = expected.colorSpace === "srgb";
  const block = expected.format !== "rgba8";
  const vkFormat = { bc1: srgb ? 132 : 131, bc7: srgb ? 146 : 145, rgba8: srgb ? 43 : 37 }[
    expected.format
  ];
  if (
    header.vkFormat !== vkFormat ||
    (block && (header.supercompressionScheme !== 0 || header.levelCount !== levels)) ||
    reader.isInGammaSpace !== (expected.colorSpace === "srgb") ||
    header.typeSize !== 1 ||
    header.pixelWidth !== expected.width ||
    header.pixelHeight !== expected.height ||
    header.pixelDepth !== 0 ||
    header.layerCount !== 0 ||
    header.faceCount !== 1 ||
    levels === undefined ||
    header.levelCount < levels ||
    (header.supercompressionScheme !== 0 && header.supercompressionScheme !== 2)
  )
    throw new Error(`KTX2 ${expected.format} header does not match its descriptor`);
  for (const [index, level] of reader.levels.entries()) {
    const expectedBytes = streamingTextureLevelBytes(
      expected.format,
      Math.max(1, Math.floor(expected.width / 2 ** index)),
      Math.max(1, Math.floor(expected.height / 2 ** index)),
    );
    if (
      !Number.isSafeInteger(level.byteOffset) ||
      !Number.isSafeInteger(level.byteLength) ||
      level.byteOffset < 0 ||
      level.byteLength <= 0 ||
      level.byteOffset > bytes.byteLength - level.byteLength ||
      level.uncompressedByteLength !== expectedBytes ||
      (header.supercompressionScheme === 0 && level.byteLength !== expectedBytes)
    )
      throw new Error(`KTX2 ${expected.format} level ${index} is invalid`);
  }
  return reader.levels
    .slice(0, levels)
    .map((level) => Object.freeze({ byteOffset: level.byteOffset, byteLength: level.byteLength }));
}

export function validateRepresentativeMeshoptFixture(
  bytes: Uint8Array,
): StreamingMeshoptDependencyIndexEntry["decode"] {
  if (bytes.byteLength !== 66) throw new Error("Representative meshopt fixture bytes drifted");
  return Object.freeze({ count: 3, mode: "ATTRIBUTES", stride: 12 });
}
