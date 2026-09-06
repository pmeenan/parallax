import createMscTranscoder from "parallax:msc-transcoder-factory";
import * as KTX2DecoderPackage from "@babylonjs/ktx2decoder";
import { MeshoptDecoder } from "meshoptimizer/decoder";
import {
  type RepresentativeCompressedStreamingFixtures,
  representativeCompressedStreamingFixtures,
} from "./representative-compressed-fixtures";
import { expectedStreamingDependencyDecodedBytes } from "./streaming-dependency-contract";
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

      const decoded = await new KTX2DecoderPackage.KTX2Decoder().decode(
        new Uint8Array(dependency.bytes),
        {
          astc: false,
          bptc: false,
          etc1: false,
          etc2: false,
          pvrtc: false,
          s3tc: false,
        },
        { forceRGBA: true },
      );
      const base = decoded.mipmaps[0];
      if (
        base?.data === null ||
        base === undefined ||
        decoded.width !== dependency.descriptor.decode.width ||
        decoded.height !== dependency.descriptor.decode.height ||
        base.width !== dependency.descriptor.decode.width ||
        base.height !== dependency.descriptor.decode.height ||
        base.data.byteLength !== decoded.width * decoded.height * 4
      ) {
        throw new Error(`KTX2 dependency ${dependency.descriptor.resourceId} did not decode RGBA8`);
      }
      const rgba = base.data.slice();
      const mipmaps =
        dependency.descriptor.decode.version === 2
          ? decoded.mipmaps.map((mip, level) => {
              if (
                mip.data === null ||
                mip.width !== Math.max(1, Math.floor(decoded.width / 2 ** level)) ||
                mip.height !== Math.max(1, Math.floor(decoded.height / 2 ** level)) ||
                mip.data.byteLength !== mip.width * mip.height * 4
              )
                throw new Error("KTX2 decoded mip dimensions are invalid");
              return Object.freeze({
                width: mip.width,
                height: mip.height,
                rgba: level === 0 ? rgba.buffer : mip.data.slice().buffer,
              });
            })
          : undefined;
      if (
        mipmaps !== undefined &&
        (mipmaps.length !== dependency.descriptor.decode.mipLevelCount ||
          mipmaps.reduce((sum, mip) => sum + mip.rgba.byteLength, 0) !== expectedDecodedBytes)
      )
        throw new Error("KTX2 decoded mip chain is incomplete");
      return Object.freeze({
        cacheKey: streamingResourceCacheKey(dependency.descriptor),
        descriptor: dependency.descriptor,
        decodeMs: performance.now() - startedAt,
        decodedBytes: expectedDecodedBytes,
        encodedBytes: dependency.bytes.byteLength,
        format: "ktx2" as const,
        height: decoded.height,
        resourceId: dependency.descriptor.resourceId,
        rgba: rgba.buffer,
        ...(mipmaps === undefined ? {} : { mipmaps: Object.freeze(mipmaps) }),
        width: decoded.width,
      });
    },
  });
}

export function validateRepresentativeMeshoptFixture(
  bytes: Uint8Array,
): StreamingMeshoptDependencyIndexEntry["decode"] {
  if (bytes.byteLength !== 66) throw new Error("Representative meshopt fixture bytes drifted");
  return Object.freeze({ count: 3, mode: "ATTRIBUTES", stride: 12 });
}
