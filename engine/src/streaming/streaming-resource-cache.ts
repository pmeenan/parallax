import type { StreamingDependencyIndexEntry } from "./streaming-protocol";
import { streamingResourceCacheKey } from "./streaming-resource-key";

export interface StreamingResourceCacheSnapshot {
  readonly acquireCount: number;
  readonly hitCount: number;
  readonly liveDecodedBytes: number;
  readonly liveEncodedBytes: number;
  readonly liveRefCount: number;
  readonly liveResourceCount: number;
  readonly missCount: number;
  readonly releaseCount: number;
  readonly resources: readonly Readonly<{
    readonly cacheKey: string;
    readonly format: "ktx2" | "meshopt";
    readonly ownedBytes: number;
    readonly refCount: number;
    readonly resourceId: string;
  }>[];
}

export interface StreamingResourceCacheAcquire<T> {
  readonly descriptor: StreamingDependencyIndexEntry;
  readonly key: string;
  readonly miss: boolean;
  readonly value: T | null;
}

export interface StreamingResourceCacheRelease<T> {
  readonly final: boolean;
  readonly value: T | null;
}

export interface StreamingResourceCache<T> {
  acquire(descriptor: StreamingDependencyIndexEntry): StreamingResourceCacheAcquire<T>;
  fulfill(key: string, value: T): void;
  setOwnedBytes(key: string, encodedBytes: number, decodedBytes: number): void;
  release(key: string): StreamingResourceCacheRelease<T>;
  require(key: string): StreamingResourceCacheAcquire<T>;
  snapshot(): StreamingResourceCacheSnapshot;
}

interface CacheEntry<T> {
  readonly descriptor: StreamingDependencyIndexEntry;
  readonly key: string;
  ownedDecodedBytes: number;
  ownedEncodedBytes: number;
  refCount: number;
  value: T | null;
}

export function createStreamingResourceCache<T>(): StreamingResourceCache<T> {
  const entries = new Map<string, CacheEntry<T>>();
  const keysByResourceId = new Map<string, string>();
  let acquireCount = 0;
  let hitCount = 0;
  let missCount = 0;
  let releaseCount = 0;

  const result = (entry: CacheEntry<T>, miss: boolean): StreamingResourceCacheAcquire<T> =>
    Object.freeze({ descriptor: entry.descriptor, key: entry.key, miss, value: entry.value });

  return Object.freeze({
    acquire(descriptor: StreamingDependencyIndexEntry): StreamingResourceCacheAcquire<T> {
      const key = streamingResourceCacheKey(descriptor);
      const existingKey = keysByResourceId.get(descriptor.resourceId);
      if (existingKey !== undefined && existingKey !== key) {
        throw new Error(
          `Streaming resource ${descriptor.resourceId} was acquired with an incompatible descriptor`,
        );
      }
      acquireCount += 1;
      const existing = entries.get(key);
      if (existing !== undefined) {
        existing.refCount += 1;
        hitCount += 1;
        return result(existing, false);
      }
      const entry: CacheEntry<T> = {
        descriptor,
        key,
        ownedDecodedBytes: 0,
        ownedEncodedBytes: 0,
        refCount: 1,
        value: null,
      };
      entries.set(key, entry);
      keysByResourceId.set(descriptor.resourceId, key);
      missCount += 1;
      return result(entry, true);
    },
    fulfill(key: string, value: T): void {
      const entry = entries.get(key);
      if (entry === undefined || entry.value !== null) {
        throw new Error(`Streaming resource cache fulfillment ${key} is invalid`);
      }
      entry.value = value;
    },
    release(key: string): StreamingResourceCacheRelease<T> {
      const entry = entries.get(key);
      if (entry === undefined || entry.refCount <= 0) {
        throw new Error(`Streaming resource cache release ${key} is invalid`);
      }
      entry.refCount -= 1;
      releaseCount += 1;
      if (entry.refCount > 0) return Object.freeze({ final: false, value: null });
      entries.delete(key);
      keysByResourceId.delete(entry.descriptor.resourceId);
      return Object.freeze({ final: true, value: entry.value });
    },
    setOwnedBytes(key: string, encodedBytes: number, decodedBytes: number): void {
      const entry = entries.get(key);
      if (
        entry === undefined ||
        !Number.isSafeInteger(encodedBytes) ||
        encodedBytes < 0 ||
        !Number.isSafeInteger(decodedBytes) ||
        decodedBytes < 0
      ) {
        throw new Error(`Streaming resource cache ownership ${key} is invalid`);
      }
      entry.ownedEncodedBytes = encodedBytes;
      entry.ownedDecodedBytes = decodedBytes;
    },
    require(key: string): StreamingResourceCacheAcquire<T> {
      const entry = entries.get(key);
      if (entry === undefined) throw new Error(`Streaming resource cache entry ${key} is absent`);
      return result(entry, false);
    },
    snapshot(): StreamingResourceCacheSnapshot {
      const liveEntries = [...entries.values()];
      return Object.freeze({
        acquireCount,
        hitCount,
        liveDecodedBytes: liveEntries.reduce((sum, entry) => sum + entry.ownedDecodedBytes, 0),
        liveEncodedBytes: liveEntries.reduce((sum, entry) => sum + entry.ownedEncodedBytes, 0),
        liveRefCount: liveEntries.reduce((sum, entry) => sum + entry.refCount, 0),
        liveResourceCount: liveEntries.length,
        missCount,
        releaseCount,
        resources: Object.freeze(
          liveEntries
            .map((entry) =>
              Object.freeze({
                cacheKey: entry.key,
                format: entry.descriptor.format,
                ownedBytes: entry.ownedDecodedBytes + entry.ownedEncodedBytes,
                refCount: entry.refCount,
                resourceId: entry.descriptor.resourceId,
              }),
            )
            .sort((left, right) => (left.cacheKey < right.cacheKey ? -1 : 1)),
        ),
      });
    },
  });
}
