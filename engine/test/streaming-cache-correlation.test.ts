import { describe, expect, it } from "vitest";
import {
  compatibleStreamingCacheSnapshots,
  expectedStreamingDependencyGpuBytes,
  expectedStreamingEvictionFreedGpuBytes,
  projectStreamingCacheReleases,
  requireExactStreamingEvictionFreedGpuBytes,
} from "../src/streaming/streaming-cache-correlation";
import type {
  StreamingDependencyIndexEntry,
  StreamingResourceCacheTelemetry,
} from "../src/streaming/streaming-protocol";
import { createStreamingResourceCache } from "../src/streaming/streaming-resource-cache";

const descriptors = Object.freeze([
  Object.freeze({
    bytes: 9,
    decode: Object.freeze({ colorSpace: "srgb", format: "rgba8", height: 2, width: 2 }),
    dependencies: Object.freeze([]),
    format: "ktx2",
    path: `immutable/texture-${"a".repeat(64)}.ktx2`,
    resourceId: "texture",
    sha256: "a".repeat(64),
  }),
  Object.freeze({
    bytes: 12,
    decode: Object.freeze({ count: 3, mode: "ATTRIBUTES", stride: 12 }),
    dependencies: Object.freeze(["texture"]),
    format: "meshopt",
    path: `immutable/mesh-${"b".repeat(64)}.meshopt`,
    resourceId: "mesh",
    sha256: "b".repeat(64),
  }),
]) satisfies readonly StreamingDependencyIndexEntry[];

function snapshots(): readonly [StreamingResourceCacheTelemetry, StreamingResourceCacheTelemetry] {
  const cpu = createStreamingResourceCache<object>();
  const gpu = createStreamingResourceCache<object>();
  for (const descriptor of descriptors) {
    const cpuEntry = cpu.acquire(descriptor);
    cpu.fulfill(cpuEntry.key, {});
    const gpuEntry = gpu.acquire(descriptor);
    gpu.setOwnedBytes(gpuEntry.key, 0, expectedStreamingDependencyGpuBytes(descriptor));
    gpu.fulfill(gpuEntry.key, {});
  }
  return [cpu.snapshot(), gpu.snapshot()];
}

describe("streaming cache correlation", () => {
  it("accepts exact authoritative identities and rejects forged aggregate or resource bytes", () => {
    const [cpu, gpu] = snapshots();
    expect(compatibleStreamingCacheSnapshots(cpu, gpu, descriptors)).toBe(true);
    expect(
      compatibleStreamingCacheSnapshots(
        cpu,
        { ...gpu, liveDecodedBytes: gpu.liveDecodedBytes + 1 },
        descriptors,
      ),
    ).toBe(false);
    const first = gpu.resources[0];
    if (first === undefined) throw new Error("GPU cache fixture is absent");
    expect(
      compatibleStreamingCacheSnapshots(
        cpu,
        {
          ...gpu,
          liveDecodedBytes: gpu.liveDecodedBytes + 1,
          resources: [{ ...first, ownedBytes: first.ownedBytes + 1 }, ...gpu.resources.slice(1)],
        },
        descriptors,
      ),
    ).toBe(false);
  });

  it("projects repeated releases without mutating the authoritative CPU cache", () => {
    const cpu = createStreamingResourceCache<object>();
    const descriptor = descriptors[0];
    if (descriptor === undefined) throw new Error("Cache descriptor fixture is absent");
    const first = cpu.acquire(descriptor);
    cpu.fulfill(first.key, {});
    cpu.setOwnedBytes(first.key, 0, 0);
    cpu.acquire(descriptor);
    const before = cpu.snapshot();
    const projected = projectStreamingCacheReleases(before, [first.key, first.key]);

    expect(projected).toMatchObject({
      liveRefCount: 0,
      liveResourceCount: 0,
      releaseCount: 2,
      resources: [],
    });
    expect(cpu.snapshot()).toEqual(before);
    expect(() => projectStreamingCacheReleases(before, ["absent"])).toThrow(/release.*invalid/);
  });

  it("requires exact cell plus dependency GPU byte conservation on eviction", () => {
    const gpu = createStreamingResourceCache<object>();
    for (const descriptor of descriptors) {
      const acquired = gpu.acquire(descriptor);
      gpu.setOwnedBytes(acquired.key, 0, expectedStreamingDependencyGpuBytes(descriptor));
      gpu.fulfill(acquired.key, {});
    }
    const prior = gpu.snapshot();
    const first = prior.resources[0];
    if (first === undefined) throw new Error("GPU cache fixture is absent");
    gpu.release(first.cacheKey);
    const projected = gpu.snapshot();

    const exactFreedBytes = 7 + first.ownedBytes;
    expect(expectedStreamingEvictionFreedGpuBytes(7, prior, projected)).toBe(exactFreedBytes);
    expect(() =>
      requireExactStreamingEvictionFreedGpuBytes(exactFreedBytes, 7, prior, projected),
    ).not.toThrow();
    expect(() =>
      requireExactStreamingEvictionFreedGpuBytes(exactFreedBytes - 1, 7, prior, projected),
    ).toThrow(/inexact/);
    expect(() =>
      requireExactStreamingEvictionFreedGpuBytes(exactFreedBytes + 1, 7, prior, projected),
    ).toThrow(/inexact/);
    expect(() => expectedStreamingEvictionFreedGpuBytes(7, projected, prior)).toThrow(/invalid/);
    expect(() =>
      expectedStreamingEvictionFreedGpuBytes(Number.MAX_SAFE_INTEGER, prior, projected),
    ).toThrow(/overflows/);
  });
});
