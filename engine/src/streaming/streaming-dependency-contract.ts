import type {
  DecodeCellResponse,
  DecodedStreamingDependency,
  StreamingCellIndexEntry,
  StreamingDependencyIndexEntry,
} from "./streaming-protocol";
import { STREAMING_DEPENDENCY_DECODED_MAX_BYTES } from "./streaming-protocol";
import { streamingResourceCacheKey } from "./streaming-resource-key";

export interface StreamingCellMemoryReservation {
  readonly decodedBytes: number;
  readonly encodedBytes: number;
  readonly stagingBytes: number;
  readonly totalBytes: number;
}

export function expectedStreamingDependencyDecodedBytes(
  descriptor: StreamingDependencyIndexEntry,
): number {
  const decodedBytes =
    descriptor.format === "ktx2"
      ? expectedTextureBytes(descriptor)
      : safeProduct(descriptor.decode.count, descriptor.decode.stride);
  if (decodedBytes > STREAMING_DEPENDENCY_DECODED_MAX_BYTES) {
    throw new Error(`Streaming dependency ${descriptor.resourceId} decoded size exceeds its cap`);
  }
  return decodedBytes;
}

function expectedTextureBytes(
  descriptor: Extract<StreamingDependencyIndexEntry, { format: "ktx2" }>,
): number {
  const { width, height, version, mipLevelCount } = descriptor.decode;
  if (version !== 2) return safeProduct(width, height, 4);
  if (
    !Number.isSafeInteger(mipLevelCount) ||
    mipLevelCount !== Math.floor(Math.log2(Math.max(width, height))) + 1
  )
    throw new Error("Streaming texture requires a complete mip chain");
  return safeSum(
    Array.from({ length: mipLevelCount }, (_, level) =>
      safeProduct(
        Math.max(1, Math.floor(width / 2 ** level)),
        Math.max(1, Math.floor(height / 2 ** level)),
        4,
      ),
    ),
  );
}

export function planStreamingCellMemoryReservation(
  entry: StreamingCellIndexEntry,
  descriptors: readonly StreamingDependencyIndexEntry[],
): StreamingCellMemoryReservation {
  const dependencyEncodedBytes = safeSum(descriptors.map(({ bytes }) => bytes));
  const dependencyDecodedBytes = safeSum(descriptors.map(expectedStreamingDependencyDecodedBytes));
  const encodedBytes = safeSum([entry.bytes, dependencyEncodedBytes]);
  // UTF-8 cell JSON can coexist with its UTF-16 decode while dependency outputs are live.
  const decodedBytes = safeSum([safeProduct(entry.bytes, 2), dependencyDecodedBytes]);
  // decode-worker awaits each dependency before starting the next. Its KTX2
  // adapter copies the current decoder result, so only that dependency needs
  // additional decoded scratch. Completed outputs remain counted above; transfer
  // lists move their buffers rather than cloning the entire decoded cohort.
  // Keep the conservative additional encoded/cell view allowance.
  const stagingBytes = safeSum([
    encodedBytes,
    Math.max(0, ...descriptors.map(expectedStreamingDependencyDecodedBytes)),
  ]);
  return Object.freeze({
    decodedBytes,
    encodedBytes,
    stagingBytes,
    totalBytes: safeSum([encodedBytes, decodedBytes, stagingBytes]),
  });
}

export function validateDecodedStreamingDependencies(
  descriptors: readonly StreamingDependencyIndexEntry[],
  dependencies: readonly DecodedStreamingDependency[],
): void {
  if (!Array.isArray(dependencies) || dependencies.length !== descriptors.length) {
    throw new Error("Decoded streaming dependency count is invalid");
  }
  for (const [index, descriptor] of descriptors.entries()) {
    const dependency = dependencies[index];
    const expectedDecodedBytes = expectedStreamingDependencyDecodedBytes(descriptor);
    if (
      dependency === undefined ||
      dependency.cacheKey !== streamingResourceCacheKey(descriptor) ||
      streamingResourceCacheKey(dependency.descriptor) !== streamingResourceCacheKey(descriptor) ||
      dependency.resourceId !== descriptor.resourceId ||
      dependency.format !== descriptor.format ||
      dependency.encodedBytes !== descriptor.bytes ||
      dependency.decodedBytes !== expectedDecodedBytes ||
      !Number.isFinite(dependency.decodeMs) ||
      dependency.decodeMs < 0
    ) {
      throw new Error(`Decoded streaming dependency ${descriptor.resourceId} identity is invalid`);
    }
    if (descriptor.format === "ktx2") {
      if (
        dependency.format !== "ktx2" ||
        dependency.width !== descriptor.decode.width ||
        dependency.height !== descriptor.decode.height ||
        dependency.rgba.byteLength !== descriptor.decode.width * descriptor.decode.height * 4
      ) {
        throw new Error(`Decoded KTX2 dependency ${descriptor.resourceId} payload is invalid`);
      }
      if (descriptor.decode.version === 2) {
        if (
          !Array.isArray(dependency.mipmaps) ||
          dependency.mipmaps.length !== descriptor.decode.mipLevelCount ||
          dependency.mipmaps[0]?.rgba !== dependency.rgba ||
          dependency.mipmaps.some(
            (mip: { width: number; height: number; rgba: ArrayBuffer }, level: number) =>
              mip.width !== Math.max(1, Math.floor(descriptor.decode.width / 2 ** level)) ||
              mip.height !== Math.max(1, Math.floor(descriptor.decode.height / 2 ** level)) ||
              !(mip.rgba instanceof ArrayBuffer) ||
              mip.rgba.byteLength !== mip.width * mip.height * 4,
          )
        )
          throw new Error(`Decoded KTX2 dependency ${descriptor.resourceId} mip chain is invalid`);
      } else if (dependency.mipmaps !== undefined)
        throw new Error("Legacy KTX2 payload must not carry mipmaps");
    } else if ("version" in descriptor.decode && descriptor.decode.mode === "ATTRIBUTES") {
      if (
        dependency.format !== "meshopt" ||
        !("kind" in dependency) ||
        dependency.kind !== "vertex-attributes" ||
        dependency.vertexCount !== descriptor.decode.count ||
        dependency.attributes.byteLength !== expectedDecodedBytes
      ) {
        throw new Error(`Decoded meshopt vertex ${descriptor.resourceId} payload is invalid`);
      }
    } else if ("version" in descriptor.decode) {
      if (
        dependency.format !== "meshopt" ||
        !("kind" in dependency) ||
        dependency.kind !== "indices" ||
        dependency.indexCount !== descriptor.decode.count ||
        dependency.indices.byteLength !== expectedDecodedBytes
      ) {
        throw new Error(`Decoded meshopt index ${descriptor.resourceId} payload is invalid`);
      }
    } else if (
      dependency.format !== "meshopt" ||
      dependency.kind !== "legacy-positions" ||
      dependency.vertexCount !== descriptor.decode.count ||
      dependency.positions.byteLength !== expectedDecodedBytes
    ) {
      throw new Error(
        `Decoded legacy meshopt dependency ${descriptor.resourceId} payload is invalid`,
      );
    }
  }
}

export function validateDecodedCellResponseAccounting(
  expectedCellId: string,
  cellEncodedBytes: number,
  descriptors: readonly StreamingDependencyIndexEntry[],
  response: Pick<DecodeCellResponse, "cell" | "decodeMs" | "dependencies" | "encodedBytes">,
): void {
  const expectedEncodedBytes = safeSum([
    cellEncodedBytes,
    ...descriptors.map(({ bytes }) => bytes),
  ]);
  if (
    response.cell.id !== expectedCellId ||
    response.encodedBytes !== expectedEncodedBytes ||
    !Number.isFinite(response.decodeMs) ||
    response.decodeMs < 0
  ) {
    throw new Error(`Decoded streaming cell ${expectedCellId} accounting is invalid`);
  }
  validateDecodedStreamingDependencies(descriptors, response.dependencies);
}

function safeProduct(...factors: readonly number[]): number {
  let product = 1;
  for (const factor of factors) {
    if (
      !Number.isSafeInteger(factor) ||
      factor <= 0 ||
      product > Number.MAX_SAFE_INTEGER / factor
    ) {
      throw new Error("Streaming dependency size multiplication overflowed");
    }
    product *= factor;
  }
  return product;
}

function safeSum(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || sum > Number.MAX_SAFE_INTEGER - value) {
      throw new Error("Streaming dependency size addition overflowed");
    }
    sum += value;
  }
  return sum;
}
