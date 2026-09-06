import type { StreamingDependencyIndexEntry } from "./streaming-protocol";

export function streamingResourceCacheKey(descriptor: StreamingDependencyIndexEntry): string {
  const decode =
    descriptor.format === "ktx2"
      ? `v${descriptor.decode.version ?? 0}:rgba8:${descriptor.decode.colorSpace}:${descriptor.decode.width}x${descriptor.decode.height}${descriptor.decode.version === 2 ? `:mips=${descriptor.decode.mipLevelCount}` : ""}`
      : "version" in descriptor.decode
        ? descriptor.decode.mode === "ATTRIBUTES"
          ? `v${descriptor.decode.version}:${descriptor.decode.mode}:${descriptor.decode.layout}:${descriptor.decode.count}x${descriptor.decode.stride}`
          : `v${descriptor.decode.version}:${descriptor.decode.mode}:${descriptor.decode.indexFormat}:${descriptor.decode.count}x${descriptor.decode.stride}:vertices=${descriptor.decode.vertexCount}`
        : `${descriptor.decode.mode}:${descriptor.decode.count}x${descriptor.decode.stride}`;
  return [
    descriptor.resourceId,
    descriptor.sha256,
    descriptor.path,
    descriptor.bytes,
    descriptor.format,
    decode,
    descriptor.dependencies.join(","),
  ].join("|");
}
