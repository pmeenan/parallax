import { expectedStreamingDependencyDecodedBytes } from "./streaming-dependency-contract";
import type {
  StreamingDependencyIndexEntry,
  StreamingResourceCacheTelemetry,
} from "./streaming-protocol";
import { streamingResourceCacheKey } from "./streaming-resource-key";

export function expectedStreamingDependencyGpuBytes(
  descriptor: StreamingDependencyIndexEntry,
): number {
  return descriptor.format === "ktx2"
    ? expectedStreamingDependencyDecodedBytes(descriptor)
    : "version" in descriptor.decode
      ? descriptor.decode.count * descriptor.decode.stride
      : descriptor.decode.count * (descriptor.decode.stride + 12 + 8 + 4);
}

export function compatibleStreamingCacheSnapshots(
  cpu: StreamingResourceCacheTelemetry,
  gpu: StreamingResourceCacheTelemetry,
  descriptors: readonly StreamingDependencyIndexEntry[],
): boolean {
  if (!validCacheSnapshot(cpu) || !validCacheSnapshot(gpu)) return false;
  if (
    cpu.acquireCount !== gpu.acquireCount ||
    cpu.hitCount !== gpu.hitCount ||
    cpu.liveRefCount !== gpu.liveRefCount ||
    cpu.liveResourceCount !== gpu.liveResourceCount ||
    cpu.missCount !== gpu.missCount ||
    cpu.releaseCount !== gpu.releaseCount ||
    cpu.liveDecodedBytes !== 0 ||
    cpu.liveEncodedBytes !== 0 ||
    gpu.liveEncodedBytes !== 0
  ) {
    return false;
  }
  const descriptorsByKey = new Map(
    descriptors.map((descriptor) => [streamingResourceCacheKey(descriptor), descriptor] as const),
  );
  if (descriptorsByKey.size !== descriptors.length) return false;
  for (const [index, cpuResource] of cpu.resources.entries()) {
    const gpuResource = gpu.resources[index];
    const descriptor = descriptorsByKey.get(cpuResource.cacheKey);
    if (
      gpuResource === undefined ||
      descriptor === undefined ||
      cpuResource.cacheKey !== gpuResource.cacheKey ||
      cpuResource.resourceId !== descriptor.resourceId ||
      gpuResource.resourceId !== descriptor.resourceId ||
      cpuResource.format !== descriptor.format ||
      gpuResource.format !== descriptor.format ||
      cpuResource.refCount !== gpuResource.refCount ||
      cpuResource.ownedBytes !== 0 ||
      gpuResource.ownedBytes !== expectedStreamingDependencyGpuBytes(descriptor)
    ) {
      return false;
    }
  }
  return true;
}

export function expectedStreamingEvictionFreedGpuBytes(
  residentCellGpuBytes: number,
  prior: StreamingResourceCacheTelemetry,
  projected: StreamingResourceCacheTelemetry,
): number {
  if (
    !Number.isSafeInteger(residentCellGpuBytes) ||
    residentCellGpuBytes < 0 ||
    !validCacheSnapshot(prior) ||
    !validCacheSnapshot(projected) ||
    prior.liveEncodedBytes !== 0 ||
    projected.liveEncodedBytes !== 0 ||
    projected.liveDecodedBytes > prior.liveDecodedBytes
  ) {
    throw new Error("Streaming GPU eviction accounting is invalid");
  }
  const freedGpuBytes =
    residentCellGpuBytes + (prior.liveDecodedBytes - projected.liveDecodedBytes);
  if (!Number.isSafeInteger(freedGpuBytes)) {
    throw new Error("Streaming GPU eviction accounting overflows");
  }
  return freedGpuBytes;
}

export function requireExactStreamingEvictionFreedGpuBytes(
  freedGpuBytes: number,
  residentCellGpuBytes: number,
  prior: StreamingResourceCacheTelemetry,
  projected: StreamingResourceCacheTelemetry,
): void {
  if (
    freedGpuBytes !== expectedStreamingEvictionFreedGpuBytes(residentCellGpuBytes, prior, projected)
  ) {
    throw new Error("Streaming GPU eviction freed-byte total is inexact");
  }
}

export function projectStreamingCacheReleases(
  snapshot: StreamingResourceCacheTelemetry,
  releaseKeys: readonly string[],
): StreamingResourceCacheTelemetry {
  if (
    !validCacheSnapshot(snapshot) ||
    snapshot.liveDecodedBytes !== 0 ||
    snapshot.liveEncodedBytes !== 0
  ) {
    throw new Error("Streaming CPU cache snapshot is invalid for release projection");
  }
  const resources = new Map<
    string,
    {
      cacheKey: string;
      format: "ktx2" | "meshopt";
      ownedBytes: number;
      refCount: number;
      resourceId: string;
    }
  >(snapshot.resources.map((resource) => [resource.cacheKey, { ...resource }]));
  let liveRefCount = snapshot.liveRefCount;
  let releaseCount = snapshot.releaseCount;
  for (const key of releaseKeys) {
    const resource = resources.get(key);
    if (resource === undefined || resource.refCount <= 0) {
      throw new Error(`Streaming resource cache release ${key} is invalid`);
    }
    resource.refCount -= 1;
    liveRefCount -= 1;
    releaseCount += 1;
    if (!Number.isSafeInteger(releaseCount)) {
      throw new Error("Streaming resource cache release count is invalid");
    }
    if (resource.refCount === 0) resources.delete(key);
  }
  return Object.freeze({
    ...snapshot,
    liveRefCount,
    liveResourceCount: resources.size,
    releaseCount,
    resources: Object.freeze(
      [...resources.values()]
        .map((resource) => Object.freeze(resource))
        .sort((left, right) => (left.cacheKey < right.cacheKey ? -1 : 1)),
    ),
  });
}

function validCacheSnapshot(snapshot: StreamingResourceCacheTelemetry): boolean {
  const scalars = [
    snapshot.acquireCount,
    snapshot.hitCount,
    snapshot.liveDecodedBytes,
    snapshot.liveEncodedBytes,
    snapshot.liveRefCount,
    snapshot.liveResourceCount,
    snapshot.missCount,
    snapshot.releaseCount,
  ];
  if (
    scalars.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    !Array.isArray(snapshot.resources) ||
    snapshot.resources.length !== snapshot.liveResourceCount
  ) {
    return false;
  }
  const keys = new Set<string>();
  let ownedBytes = 0;
  let refCount = 0;
  for (const resource of snapshot.resources) {
    if (
      resource.cacheKey === "" ||
      resource.resourceId === "" ||
      (resource.format !== "ktx2" && resource.format !== "meshopt") ||
      !Number.isSafeInteger(resource.ownedBytes) ||
      resource.ownedBytes < 0 ||
      !Number.isSafeInteger(resource.refCount) ||
      resource.refCount <= 0 ||
      keys.has(resource.cacheKey)
    ) {
      return false;
    }
    keys.add(resource.cacheKey);
    ownedBytes += resource.ownedBytes;
    refCount += resource.refCount;
    if (!Number.isSafeInteger(ownedBytes) || !Number.isSafeInteger(refCount)) return false;
  }
  return (
    refCount === snapshot.liveRefCount &&
    ownedBytes === snapshot.liveDecodedBytes + snapshot.liveEncodedBytes
  );
}
