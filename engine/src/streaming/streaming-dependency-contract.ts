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
      ? safeProduct(descriptor.decode.width, descriptor.decode.height, 4)
      : safeProduct(descriptor.decode.count, descriptor.decode.stride);
  if (decodedBytes > STREAMING_DEPENDENCY_DECODED_MAX_BYTES) {
    throw new Error(`Streaming dependency ${descriptor.resourceId} decoded size exceeds its cap`);
  }
  return decodedBytes;
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
  // Transfer construction can retain one additional encoded/dependency-decoded view.
  const stagingBytes = safeSum([encodedBytes, dependencyDecodedBytes]);
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
        dependency.rgba.byteLength !== expectedDecodedBytes
      ) {
        throw new Error(`Decoded KTX2 dependency ${descriptor.resourceId} payload is invalid`);
      }
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
