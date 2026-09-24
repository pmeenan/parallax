import createMscTranscoder from "parallax:msc-transcoder-factory";
import * as KTX2DecoderPackage from "@babylonjs/ktx2decoder";
import { MeshoptDecoder } from "meshoptimizer/decoder";
import {
  type RepresentativeCompressedStreamingFixtures,
  representativeCompressedStreamingFixtures,
} from "./representative-compressed-fixtures";
import {
  expectedStreamingDependencyDecodedBytes,
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

export type CompressedStreamingDecodeFailureCode =
  | "non-finite-vertex-attribute"
  | "vertex-index-out-of-range";

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
          if (descriptor.decode.mode === "ATTRIBUTES") {
            validateFiniteAttributes();
          } else {
            const indices = new Uint32Array(decoded.buffer);
            for (let index = 0; index < indices.length; index += 1) {
              const value = indices[index];
              if (value === undefined || value >= descriptor.decode.vertexCount) {
                throw new CompressedStreamingDecodeError(
                  "vertex-index-out-of-range",
                  descriptor.resourceId,
                  `Meshopt dependency ${descriptor.resourceId} decoded an out-of-range vertex index`,
                );
              }
            }
          }
          return descriptor.decode.mode === "ATTRIBUTES"
            ? Object.freeze({
                attributes: decoded.buffer,
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
      validateRawKtx2Container(new Uint8Array(dependency.bytes), dependency.descriptor.decode);
      // The pinned decoder handles every container: UASTC transcodes to BC7 blocks for `bc7`
      // descriptors or to RGBA8, and raw RGBA8 KTX2 (plain or zstd) copies through as RGBA8.
      // A raw container requested as `bc7` fails the transcoded-format check below.
      const bc7 = gpuFormat === "bc7";
      const decoded = await new KTX2DecoderPackage.KTX2Decoder().decode(
        new Uint8Array(dependency.bytes),
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
                data: level === 0 ? data.buffer : mip.data.slice().buffer,
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
        data: data.buffer,
        ...(mipmaps === undefined ? {} : { mipmaps: Object.freeze(mipmaps) }),
        width,
      });
    },
  });
}

/** The vendor decoder copies raw levels but does not enforce our single-image, color-space or
 * declared byte-range contract. Keep those checks before decoding without owning a second codec. */
function validateRawKtx2Container(
  bytes: Uint8Array,
  expected: Extract<DecodeDependencyRequest["descriptor"], { format: "ktx2" }>["decode"],
): void {
  if (bytes.byteLength < 80 || !KTX2DecoderPackage.KTX2FileReader.IsValid(bytes))
    throw new Error("Invalid KTX2 container");
  if (new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true) === 0)
    return; // Basis payloads are validated by the transcoder and decoded mip checks.
  const reader = new KTX2DecoderPackage.KTX2FileReader(bytes);
  reader.parse();
  const header = reader.header;
  const levels = expected.version === 2 ? expected.mipLevelCount : 1;
  if (
    header.vkFormat !== (expected.colorSpace === "srgb" ? 43 : 37) ||
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
    throw new Error("KTX2 RGBA8 header does not match its descriptor");
  for (const [index, level] of reader.levels.entries()) {
    const expectedBytes = streamingTextureLevelBytes(
      "rgba8",
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
      throw new Error(`KTX2 RGBA8 level ${index} is invalid`);
  }
}

export function validateRepresentativeMeshoptFixture(
  bytes: Uint8Array,
): StreamingMeshoptDependencyIndexEntry["decode"] {
  if (bytes.byteLength !== 66) throw new Error("Representative meshopt fixture bytes drifted");
  return Object.freeze({ count: 3, mode: "ATTRIBUTES", stride: 12 });
}
