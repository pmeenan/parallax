import { describe, expect, it, vi } from "vitest";
import type { StreamingKtx2DependencyIndexEntry } from "../src/streaming/streaming-protocol";
import { createStreamingResourceCache } from "../src/streaming/streaming-resource-cache";

const descriptor = Object.freeze({
  bytes: 9,
  decode: Object.freeze({ colorSpace: "srgb", format: "rgba8", height: 2, width: 2 }),
  dependencies: Object.freeze([]),
  format: "ktx2",
  path: `immutable/representative-streaming-ktx2-${"a".repeat(64)}.ktx2`,
  resourceId: "game-specific-streaming-00-texture",
  sha256: "a".repeat(64),
}) satisfies StreamingKtx2DependencyIndexEntry;

describe("streaming resource cache", () => {
  it("deduplicates concurrent pending acquisition and disposes once at final release", () => {
    const cache = createStreamingResourceCache<{ dispose(): void }>();
    const dispose = vi.fn();
    const first = cache.acquire(descriptor);
    const concurrent = cache.acquire(descriptor);
    expect(first.miss).toBe(true);
    expect(concurrent).toMatchObject({ key: first.key, miss: false, value: null });
    cache.fulfill(first.key, { dispose });
    cache.setOwnedBytes(first.key, 9, 16);
    expect(cache.snapshot()).toMatchObject({
      acquireCount: 2,
      hitCount: 1,
      liveRefCount: 2,
      liveResourceCount: 1,
      missCount: 1,
      liveDecodedBytes: 16,
      liveEncodedBytes: 9,
      resources: [{ cacheKey: first.key, ownedBytes: 25, refCount: 2 }],
    });
    cache.setOwnedBytes(first.key, 0, 0);
    expect(cache.snapshot()).toMatchObject({
      liveDecodedBytes: 0,
      liveEncodedBytes: 0,
      liveResourceCount: 1,
      resources: [{ cacheKey: first.key, ownedBytes: 0, refCount: 2 }],
    });
    expect(cache.release(first.key)).toEqual({ final: false, value: null });
    const final = cache.release(first.key);
    expect(final.final).toBe(true);
    final.value?.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(cache.snapshot()).toMatchObject({ liveRefCount: 0, liveResourceCount: 0 });
    expect(() => cache.release(first.key)).toThrow(/invalid/);
  });

  it("cleans partial failure, rejects incompatible live identity, and misses after reload", () => {
    const cache = createStreamingResourceCache<object>();
    const first = cache.acquire(descriptor);
    expect(() => cache.acquire({ ...descriptor, bytes: 10 })).toThrow(/incompatible/);
    expect(cache.release(first.key)).toEqual({ final: true, value: null });
    const reload = cache.acquire(descriptor);
    expect(reload.miss).toBe(true);
    cache.fulfill(reload.key, {});
    expect(cache.release(reload.key).final).toBe(true);
    expect(cache.snapshot()).toMatchObject({
      acquireCount: 2,
      liveResourceCount: 0,
      missCount: 2,
      releaseCount: 2,
    });
  });
});
