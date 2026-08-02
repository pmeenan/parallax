import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { describe, expect, it, vi } from "vitest";
import {
  createInstallerRepairState,
  evaluateInstallerQuotaAdmission,
  INSTALLER_QUOTA_METADATA_RESERVE_BYTES,
  INSTALLER_QUOTA_PROBE_BYTES,
  InstallerStoreError,
  InstallerTransferError,
  type InstallerTransferObserver,
  type InstallerTransferPlatform,
  type InstallerTransferStore,
  repairInstallResource,
  transferInstallResources,
} from "../src/install/installer-transfer";
import type { InstallResource } from "../src/storage/install-manifest";
import type {
  IntegrityResult,
  PartialSnapshot,
  VerifiedObjectRef,
} from "../src/storage/opfs-release-store";
import { createOpfsReleaseStore } from "../src/storage/opfs-release-store";
import { InstallStoreIntegrityError } from "../src/storage/opfs-release-store-contract";
import { createMemoryInstallStorePlatform } from "../src/storage/opfs-release-store-platform";

const releaseDigest = "a".repeat(64);
const strongEtag = '"immutable-a"';
const baseUrl = "https://example.test/";
const resource: InstallResource = {
  bytes: 8,
  id: "resource-a",
  kind: "asset-pack",
  scope: "common",
  sha256: "b".repeat(64),
  source: "immutable/a.bin",
  target: "opfs",
};

function response(
  status: number,
  body: Uint8Array | ReadableStream<Uint8Array> | null,
  headers: Record<string, string> = {},
  source = resource.source,
): Response {
  const result = new Response(body as BodyInit | null, { headers, status });
  Object.defineProperty(result, "url", { value: `${baseUrl}${source}` });
  return result;
}

function rangeResponse(
  offset: number,
  bytes: Uint8Array,
  target = resource,
  etag = strongEtag,
): Response {
  return response(
    206,
    bytes,
    {
      "content-length": String(target.bytes - offset),
      "content-range": `bytes ${offset}-${target.bytes - 1}/${target.bytes}`,
      etag,
    },
    target.source,
  );
}

function fixture(initial = new Uint8Array()) {
  let durable = initial.slice();
  let etag: string | null = initial.byteLength === 0 ? null : strongEtag;
  const appendSizes: number[] = [];
  let discardCount = 0;
  const calls: RequestInit[] = [];
  const store: InstallerTransferStore = {
    async appendPartial(input): Promise<PartialSnapshot> {
      expect(input.expectedOffset).toBe(durable.byteLength);
      if (etag !== null) expect(input.strongEtag).toBe(etag);
      appendSizes.push(input.bytes.byteLength);
      etag ??= input.strongEtag;
      const next = new Uint8Array(durable.byteLength + input.bytes.byteLength);
      next.set(durable);
      next.set(input.bytes, durable.byteLength);
      durable = next;
      return {
        bytesCommitted: durable.byteLength,
        expectedBytes: resource.bytes,
        releaseDigest,
        resourceId: resource.id,
        strongEtag: etag,
      };
    },
    async finalizePartial(): Promise<VerifiedObjectRef> {
      if (durable.byteLength !== resource.bytes) throw new Error("incomplete");
      return reference();
    },
    async discardPartial(): Promise<void> {
      discardCount += 1;
      durable = new Uint8Array();
      etag = null;
    },
    async prepareResource() {
      return {
        bytesCommitted: durable.byteLength,
        expectedBytes: resource.bytes,
        state: "partial" as const,
        strongEtag: etag,
      };
    },
    verifyObject: vi.fn(
      async (): Promise<IntegrityResult> => ({
        bytes: resource.bytes,
        ok: true,
        sha256: resource.sha256,
      }),
    ),
  };
  const observer = observing();
  const platform: InstallerTransferPlatform = {
    clearTimeout: () => undefined,
    fetch: vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(init);
      return rangeResponse(
        durable.byteLength,
        Uint8Array.from({ length: 8 - durable.byteLength }, (_, index) => index),
      );
    }),
    now: () => 0,
    setTimeout: () => 1,
    sleep: vi.fn(async () => undefined),
  };
  return {
    appendSizes,
    calls,
    discardCount: () => discardCount,
    durable: () => durable,
    observer,
    platform,
    store,
  };
}

function reusedCorruptionFixture() {
  const test = fixture();
  const preparePartial = test.store.prepareResource.bind(test.store);
  let prepareCount = 0;
  test.store.prepareResource = vi.fn(async () => {
    prepareCount += 1;
    if (prepareCount === 1) {
      return {
        bytesCommitted: resource.bytes,
        expectedBytes: resource.bytes,
        reference: reference(),
        state: "verified" as const,
        strongEtag: null,
      };
    }
    return preparePartial(releaseDigest, resource.id);
  });
  let verificationCount = 0;
  test.store.verifyObject = vi.fn(async () => {
    verificationCount += 1;
    return verificationCount === 1
      ? { bytes: resource.bytes, ok: false, sha256: "c".repeat(64) }
      : { bytes: resource.bytes, ok: true, sha256: resource.sha256 };
  });
  return test;
}

function observing(): InstallerTransferObserver & {
  readonly counts: Record<string, number>;
} {
  const counts: Record<string, number> = {};
  const count = (name: string, amount = 1): void => {
    counts[name] = (counts[name] ?? 0) + amount;
  };
  return {
    checkpoint: (bytes) => count("checkpoint", bytes),
    counts,
    downloaded: (bytes) => count("downloaded", bytes),
    httpRequest: () => count("http"),
    integrityFailure: () => count("integrity"),
    resourceActive: () => count("active"),
    resourceComplete: () => count("complete"),
    resourceInactive: () => count("inactive"),
    repairCompletionCreditRevoked: () => {
      count("repairCreditRevoked");
      return true;
    },
    repairComplete: (_resourceId, bytes) => count("repairComplete", bytes),
    repairStarted: () => count("repairStarted"),
    resumed: (bytes) => count("resumed", bytes),
    retry: () => count("retry"),
    transportFailure: () => count("transport"),
    validatorFailure: () => count("validator"),
    verified: (bytes) => count("verified", bytes),
  };
}

function reference(): VerifiedObjectRef {
  return {
    bytes: resource.bytes,
    path: "parallax-install-v1/objects/common/sha256/bb/object.data",
    releaseDigest,
    resourceId: resource.id,
    scope: "common",
    sha256: resource.sha256,
  };
}

const input = (signal = new AbortController().signal) => ({
  baseUrl,
  policy: { checkpointBytes: 4, concurrency: 1, requestTimeoutMs: 10_000 },
  releaseDigest,
  resources: [resource],
  signal,
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("installer quota admission", () => {
  it("retains the flushed quota probe plus metadata as the minimum atomic requirement", () => {
    expect(evaluateInstallerQuotaAdmission(null, 0)).toEqual({
      estimateClearlyInsufficient: false,
      requiredPeakBytes: INSTALLER_QUOTA_PROBE_BYTES + INSTALLER_QUOTA_METADATA_RESERVE_BYTES,
    });
  });

  it("admits a multi-resource release larger than the estimate when each atomic resource fits", () => {
    const availableBytes = 10 * 1024 ** 3;
    const totalMissingBytes = 100 * 1024 ** 3;
    const largestUnverifiedResourceBytes = 256 * 1024 ** 2;

    const admission = evaluateInstallerQuotaAdmission(
      availableBytes,
      largestUnverifiedResourceBytes,
    );

    expect(totalMissingBytes).toBeGreaterThan(availableBytes);
    expect(admission).toEqual({
      estimateClearlyInsufficient: false,
      requiredPeakBytes: largestUnverifiedResourceBytes + INSTALLER_QUOTA_METADATA_RESERVE_BYTES,
    });
  });

  it("rejects when the largest next immutable resource requirement exceeds available", () => {
    const availableBytes = 10 * 1024 ** 3;
    const largestUnverifiedResourceBytes =
      availableBytes - INSTALLER_QUOTA_METADATA_RESERVE_BYTES + 1;

    expect(evaluateInstallerQuotaAdmission(availableBytes, largestUnverifiedResourceBytes)).toEqual(
      {
        estimateClearlyInsufficient: true,
        requiredPeakBytes: availableBytes + 1,
      },
    );
  });
});

describe("installer transfer executor", () => {
  it("uses Range from zero and checkpoints full chunks before exact verification", async () => {
    const test = fixture();
    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).resolves.toEqual({ readyBytes: 8, readyResourceCount: 1 });
    expect(new Headers(test.calls[0]?.headers).get("range")).toBe("bytes=0-");
    expect(new Headers(test.calls[0]?.headers).has("if-range")).toBe(false);
    expect(test.durable()).toHaveLength(8);
    expect(test.observer.counts).toMatchObject({
      checkpoint: 8,
      complete: 1,
      downloaded: 8,
      verified: 8,
    });
    expect(test.store.verifyObject).not.toHaveBeenCalled();
  });

  it("rehashes and admits a preexisting verified object without transferring it", async () => {
    const test = fixture();
    test.store.prepareResource = vi.fn(async () => ({
      bytesCommitted: resource.bytes,
      expectedBytes: resource.bytes,
      reference: reference(),
      state: "verified" as const,
      strongEtag: null,
    }));

    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).resolves.toEqual({ readyBytes: resource.bytes, readyResourceCount: 1 });

    expect(test.store.verifyObject).toHaveBeenCalledOnce();
    expect(test.store.verifyObject).toHaveBeenCalledWith(reference());
    expect(test.platform.fetch).not.toHaveBeenCalled();
    expect(test.observer.counts).toMatchObject({
      complete: 1,
      verified: resource.bytes,
    });
  });

  it("resumes from durable offset with exact persisted If-Range", async () => {
    const test = fixture(new Uint8Array([1, 2, 3, 4]));
    await transferInstallResources(test.store, test.platform, test.observer, input());
    const headers = new Headers(test.calls[0]?.headers);
    expect(headers.get("range")).toBe("bytes=4-");
    expect(headers.get("if-range")).toBe(strongEtag);
    expect(test.observer.counts.resumed).toBe(4);
    expect(test.observer.counts.downloaded).toBe(4);
  });

  it("discards a stale partial after If-Range returns 200 and restarts exactly once from zero", async () => {
    const test = fixture(new Uint8Array([1, 2, 3, 4]));
    test.platform.fetch = vi.fn(async (_url, init) => {
      test.calls.push(init);
      return test.calls.length === 1
        ? response(200, new Uint8Array(resource.bytes), { etag: '"immutable-b"' })
        : rangeResponse(0, new Uint8Array(resource.bytes), resource, '"immutable-b"');
    });

    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).resolves.toEqual({ readyBytes: resource.bytes, readyResourceCount: 1 });

    expect(test.discardCount()).toBe(1);
    expect(test.calls).toHaveLength(2);
    expect(new Headers(test.calls[0]?.headers).get("range")).toBe("bytes=4-");
    expect(new Headers(test.calls[0]?.headers).get("if-range")).toBe(strongEtag);
    expect(new Headers(test.calls[1]?.headers).get("range")).toBe("bytes=0-");
    expect(new Headers(test.calls[1]?.headers).has("if-range")).toBe(false);
    expect(test.observer.counts.resumed ?? 0).toBe(0);
    expect(test.observer.counts.downloaded).toBe(resource.bytes);
    expect(test.observer.counts.retry ?? 0).toBe(0);
    expect(test.observer.counts.validator ?? 0).toBe(0);
  });

  it("discards a stale partial after a resumed 206 changes its strong ETag", async () => {
    const test = fixture(new Uint8Array([1, 2, 3, 4]));
    test.platform.fetch = vi.fn(async (_url, init) => {
      test.calls.push(init);
      return test.calls.length === 1
        ? rangeResponse(4, new Uint8Array(4), resource, '"immutable-b"')
        : rangeResponse(0, new Uint8Array(resource.bytes), resource, '"immutable-b"');
    });

    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).resolves.toMatchObject({ readyBytes: resource.bytes });
    expect(test.discardCount()).toBe(1);
    expect(test.platform.fetch).toHaveBeenCalledTimes(2);
    expect(test.observer.counts.resumed ?? 0).toBe(0);
    expect(test.observer.counts.downloaded).toBe(resource.bytes);
  });

  it.each([
    [
      "wrong range",
      () =>
        response(206, new Uint8Array(4), {
          "content-length": "4",
          "content-range": "bytes 3-7/8",
          etag: '"immutable-b"',
        }),
    ],
    [
      "wrong length",
      () =>
        response(206, new Uint8Array(4), {
          "content-length": "3",
          "content-range": "bytes 4-7/8",
          etag: '"immutable-b"',
        }),
    ],
    [
      "wrong URL",
      () =>
        response(
          206,
          new Uint8Array(4),
          {
            "content-length": "4",
            "content-range": "bytes 4-7/8",
            etag: '"immutable-b"',
          },
          "immutable/other.bin",
        ),
    ],
    [
      "content encoding",
      () =>
        response(206, new Uint8Array(4), {
          "content-encoding": "gzip",
          "content-length": "4",
          "content-range": "bytes 4-7/8",
          etag: '"immutable-b"',
        }),
    ],
    [
      "null body",
      () =>
        response(206, null, {
          "content-length": "4",
          "content-range": "bytes 4-7/8",
          etag: '"immutable-b"',
        }),
    ],
    [
      "weak changed ETag",
      () =>
        response(206, new Uint8Array(4), {
          "content-length": "4",
          "content-range": "bytes 4-7/8",
          etag: 'W/"immutable-b"',
        }),
    ],
  ])("keeps a resumed 206 with changed validator and %s terminal without discarding", async (_label, makeResponse) => {
    const test = fixture(new Uint8Array([1, 2, 3, 4]));
    test.platform.fetch = vi.fn(async () => makeResponse());

    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).rejects.toMatchObject({ category: "validator", resourceId: resource.id });
    expect(test.discardCount()).toBe(0);
    expect(test.durable()).toHaveLength(4);
    expect(test.platform.fetch).toHaveBeenCalledOnce();
    expect(test.observer.counts.validator).toBe(1);
    expect(test.observer.counts.retry ?? 0).toBe(0);
    expect(test.observer.counts.resumed ?? 0).toBe(0);
  });

  it("preserves the matching partial and returns a typed store failure when stale discard fails", async () => {
    const test = fixture(new Uint8Array([1, 2, 3, 4]));
    test.store.discardPartial = vi.fn(async () => {
      throw new Error("injected discard failure");
    });
    test.platform.fetch = vi.fn(async () => response(200, new Uint8Array(resource.bytes)));

    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).rejects.toMatchObject({ operation: "discard-partial", resourceId: resource.id });
    expect(test.durable()).toHaveLength(4);
    expect(test.platform.fetch).toHaveBeenCalledOnce();
    expect(test.observer.counts.resumed ?? 0).toBe(0);
    expect(test.observer.counts.retry ?? 0).toBe(0);
  });

  it("makes a second stale validator mismatch terminal without a second discard", async () => {
    const test = fixture(new Uint8Array([1, 2, 3, 4]));
    test.store.discardPartial = vi.fn(async () => undefined);
    test.platform.fetch = vi.fn(async () => response(200, new Uint8Array(resource.bytes)));

    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).rejects.toMatchObject({ category: "validator", resourceId: resource.id });
    expect(test.store.discardPartial).toHaveBeenCalledOnce();
    expect(test.platform.fetch).toHaveBeenCalledTimes(2);
    expect(test.observer.counts.validator).toBe(1);
    expect(test.observer.counts.resumed ?? 0).toBe(0);
    expect(test.observer.counts.retry ?? 0).toBe(0);
  });

  it("flushes a short final checkpoint only when it reaches the exact resource size", async () => {
    const test = fixture();
    const shortFinalInput = {
      ...input(),
      policy: { checkpointBytes: 6, concurrency: 1, requestTimeoutMs: 10_000 },
    };
    await transferInstallResources(test.store, test.platform, test.observer, shortFinalInput);
    expect(test.appendSizes).toEqual([6, 2]);
  });

  it.each([
    ["200 fallback", () => response(200, new Uint8Array(8), { etag: strongEtag })],
    [
      "weak ETag",
      () =>
        response(206, new Uint8Array(8), {
          "content-length": "8",
          "content-range": "bytes 0-7/8",
          etag: 'W/"weak"',
        }),
    ],
    [
      "content encoding",
      () =>
        response(206, new Uint8Array(8), {
          "content-encoding": "gzip",
          "content-length": "8",
          "content-range": "bytes 0-7/8",
          etag: strongEtag,
        }),
    ],
    [
      "wrong range",
      () =>
        response(206, new Uint8Array(8), {
          "content-length": "8",
          "content-range": "bytes 1-7/8",
          etag: strongEtag,
        }),
    ],
  ])("fails terminally without retry on %s", async (_label, makeResponse) => {
    const test = fixture();
    test.platform.fetch = vi.fn(async () => makeResponse());
    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).rejects.toBeInstanceOf(InstallerTransferError);
    expect(test.observer.counts.retry ?? 0).toBe(0);
    expect(test.observer.counts.validator).toBe(1);
  });

  it.each([
    ["minimum", '"a"'],
    ["maximum", `"${"a".repeat(1024)}"`],
  ])("accepts the %s canonical strong ETag boundary", async (_label, etag) => {
    const test = fixture();
    test.platform.fetch = vi.fn(async () => rangeResponse(0, new Uint8Array(8), resource, etag));
    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).resolves.toMatchObject({ readyBytes: 8 });
    expect(test.appendSizes).toEqual([4, 4]);
  });

  it.each([
    ["empty", '""'],
    ["too long", `"${"a".repeat(1025)}"`],
    ["obs-text", '"\u0080"'],
    ["weak", 'W/"a"'],
    ["unquoted", "a"],
    ["unterminated", '"a'],
  ])("rejects a %s ETag before body consumption or store mutation", async (_label, etag) => {
    const test = fixture();
    let bodyCancelled = 0;
    test.platform.fetch = vi.fn(async () =>
      response(
        206,
        new ReadableStream<Uint8Array>({
          cancel() {
            bodyCancelled += 1;
          },
        }),
        {
          "content-length": "8",
          "content-range": "bytes 0-7/8",
          etag,
        },
      ),
    );
    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).rejects.toMatchObject({ category: "validator" });
    expect(bodyCancelled).toBe(1);
    expect(test.appendSizes).toEqual([]);
    expect(test.observer.counts.downloaded ?? 0).toBe(0);
    expect(test.observer.counts.retry ?? 0).toBe(0);
  });

  it("retries only the bounded transient set and rereads the checkpoint", async () => {
    const test = fixture();
    let attempt = 0;
    test.platform.fetch = vi.fn(async (_url, init) => {
      test.calls.push(init);
      attempt += 1;
      if (attempt === 1) return response(503, null);
      return rangeResponse(0, new Uint8Array(8));
    });
    await transferInstallResources(test.store, test.platform, test.observer, input());
    expect(test.observer.counts.retry).toBe(1);
    expect(test.platform.sleep).toHaveBeenCalledWith(250, expect.any(AbortSignal));
    expect(test.calls).toHaveLength(2);
  });

  it("stops after exactly three transient attempts with the fixed retry delays", async () => {
    const test = fixture();
    test.platform.fetch = vi.fn(async () => response(503, null));
    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).rejects.toMatchObject({ category: "transport" });
    expect(test.platform.fetch).toHaveBeenCalledTimes(3);
    expect(test.platform.sleep).toHaveBeenNthCalledWith(1, 250, expect.any(AbortSignal));
    expect(test.platform.sleep).toHaveBeenNthCalledWith(2, 1_000, expect.any(AbortSignal));
    expect(test.observer.counts.retry).toBe(2);
  });

  it("credits exactly one transport failure for each rejected fetch attempt", async () => {
    const test = fixture();
    test.platform.fetch = vi.fn(async () => Promise.reject(new TypeError("network offline")));

    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).rejects.toMatchObject({ category: "transport", resourceId: resource.id });

    expect(test.platform.fetch).toHaveBeenCalledTimes(3);
    expect(test.observer.counts.retry).toBe(2);
    expect(test.observer.counts.transport).toBe(3);
  });

  it("classifies three bounded first-byte stalls as exact transport evidence and cleans timers", async () => {
    vi.useFakeTimers();
    try {
      const test = fixture();
      test.platform.setTimeout = (callback, milliseconds) =>
        globalThis.setTimeout(callback, milliseconds);
      test.platform.clearTimeout = (handle) =>
        globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
      test.platform.fetch = vi.fn(async (_url, init) => {
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({
          start(streamController) {
            controller = streamController;
          },
        });
        const signal = init.signal;
        if (!(signal instanceof AbortSignal)) throw new Error("missing fetch abort signal");
        signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
        return response(
          206,
          body,
          {
            "content-length": String(resource.bytes),
            "content-range": `bytes 0-${resource.bytes - 1}/${resource.bytes}`,
            etag: strongEtag,
          },
          resource.source,
        );
      });

      const execution = transferInstallResources(test.store, test.platform, test.observer, {
        ...input(),
        policy: { checkpointBytes: 4, concurrency: 1, requestTimeoutMs: 10 },
      }).catch((error: unknown) => error);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await vi.advanceTimersByTimeAsync(10);
      }

      await expect(execution).resolves.toMatchObject({
        category: "transport",
        resourceId: resource.id,
      });
      expect(test.platform.fetch).toHaveBeenCalledTimes(3);
      expect(test.observer.counts.http).toBe(3);
      expect(test.observer.counts.retry).toBe(2);
      expect(test.observer.counts.transport).toBe(3);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows continuously progressing chunks to exceed one idle interval", async () => {
    vi.useFakeTimers();
    try {
      const test = fixture();
      const bodyStarted = deferred<ReadableStreamDefaultController<Uint8Array>>();
      test.platform.setTimeout = (callback, milliseconds) =>
        globalThis.setTimeout(callback, milliseconds);
      test.platform.clearTimeout = (handle) =>
        globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
      test.platform.fetch = vi.fn(async () =>
        response(
          206,
          new ReadableStream<Uint8Array>({
            start(controller) {
              bodyStarted.resolve(controller);
            },
          }),
          {
            "content-length": String(resource.bytes),
            "content-range": `bytes 0-${resource.bytes - 1}/${resource.bytes}`,
            etag: strongEtag,
          },
        ),
      );

      const startedAt = Date.now();
      const execution = transferInstallResources(test.store, test.platform, test.observer, {
        ...input(),
        policy: { checkpointBytes: 4, concurrency: 1, requestTimeoutMs: 10 },
      });
      const controller = await bodyStarted.promise;
      for (let chunk = 0; chunk < 4; chunk += 1) {
        await vi.advanceTimersByTimeAsync(9);
        controller.enqueue(new Uint8Array(2));
        await vi.advanceTimersByTimeAsync(0);
      }
      controller.close();

      await expect(execution).resolves.toEqual({
        readyBytes: resource.bytes,
        readyResourceCount: 1,
      });
      expect(Date.now() - startedAt).toBeGreaterThan(10);
      expect(test.platform.fetch).toHaveBeenCalledOnce();
      expect(test.observer.counts.retry ?? 0).toBe(0);
      expect(test.observer.counts.transport ?? 0).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a mid-body stall, resumes its durable checkpoint, and cleans the deadline", async () => {
    vi.useFakeTimers();
    try {
      const test = fixture();
      const firstBodyStarted = deferred<ReadableStreamDefaultController<Uint8Array>>();
      test.platform.setTimeout = (callback, milliseconds) =>
        globalThis.setTimeout(callback, milliseconds);
      test.platform.clearTimeout = (handle) =>
        globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
      let fetchCount = 0;
      test.platform.fetch = vi.fn(async (_url, init) => {
        fetchCount += 1;
        if (fetchCount > 1) {
          return rangeResponse(4, new Uint8Array(4));
        }
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({
          start(streamController) {
            controller = streamController;
            firstBodyStarted.resolve(streamController);
          },
        });
        const signal = init.signal;
        if (!(signal instanceof AbortSignal)) throw new Error("missing fetch abort signal");
        signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
        return response(206, body, {
          "content-length": String(resource.bytes),
          "content-range": `bytes 0-${resource.bytes - 1}/${resource.bytes}`,
          etag: strongEtag,
        });
      });

      const execution = transferInstallResources(test.store, test.platform, test.observer, {
        ...input(),
        policy: { checkpointBytes: 4, concurrency: 1, requestTimeoutMs: 10 },
      });
      const controller = await firstBodyStarted.promise;
      controller.enqueue(new Uint8Array(4));
      await vi.advanceTimersByTimeAsync(0);
      expect(test.durable()).toHaveLength(4);
      await vi.advanceTimersByTimeAsync(10);

      await expect(execution).resolves.toMatchObject({ readyBytes: resource.bytes });
      expect(test.platform.fetch).toHaveBeenCalledTimes(2);
      expect(test.observer.counts.transport).toBe(1);
      expect(test.observer.counts.retry).toBe(1);
      expect(test.observer.counts.resumed).toBe(4);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pending first body read without retry and removes timers and owner listeners", async () => {
    vi.useFakeTimers();
    try {
      const test = fixture();
      const owner = new AbortController();
      const addListener = vi.spyOn(owner.signal, "addEventListener");
      const removeListener = vi.spyOn(owner.signal, "removeEventListener");
      const bodyStarted = deferred<void>();
      test.platform.setTimeout = (callback, milliseconds) =>
        globalThis.setTimeout(callback, milliseconds);
      test.platform.clearTimeout = (handle) =>
        globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
      test.platform.fetch = vi.fn(async (_url, init) => {
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({
          start(streamController) {
            controller = streamController;
            bodyStarted.resolve();
          },
        });
        const signal = init.signal;
        if (!(signal instanceof AbortSignal)) throw new Error("missing fetch abort signal");
        signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
        return response(206, body, {
          "content-length": String(resource.bytes),
          "content-range": `bytes 0-${resource.bytes - 1}/${resource.bytes}`,
          etag: strongEtag,
        });
      });
      const cancellation = new DOMException("owner cancelled", "AbortError");
      const execution = transferInstallResources(
        test.store,
        test.platform,
        test.observer,
        input(owner.signal),
      );
      await bodyStarted.promise;
      owner.abort(cancellation);

      await expect(execution).rejects.toBe(cancellation);
      expect(test.observer.counts.transport ?? 0).toBe(0);
      expect(test.observer.counts.retry ?? 0).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(addListener).toHaveBeenCalledOnce();
      expect(removeListener).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["underflow", new Uint8Array(7)],
    ["overflow", new Uint8Array(9)],
  ])("rejects response body %s without retry", async (_label, body) => {
    const test = fixture();
    test.platform.fetch = vi.fn(async () => rangeResponse(0, body));
    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).rejects.toMatchObject({ category: "validator" });
    expect(test.observer.counts.retry ?? 0).toBe(0);
    expect(test.observer.counts.validator).toBe(1);
    expect(test.observer.counts.downloaded ?? 0).toBe(_label === "underflow" ? body.byteLength : 0);
  });

  it("treats finalization integrity failure as terminal without verified credit", async () => {
    const test = fixture();
    test.store.finalizePartial = vi.fn(async () => {
      throw new InstallStoreIntegrityError("Published object failed exact reread verification");
    });
    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).rejects.toMatchObject({ category: "integrity" });
    expect(test.store.verifyObject).not.toHaveBeenCalled();
    expect(test.observer.counts.integrity).toBe(1);
    expect(test.observer.counts.verified ?? 0).toBe(0);
    expect(test.observer.counts.complete ?? 0).toBe(0);
    expect(test.observer.counts.retry ?? 0).toBe(0);
  });

  it("repairs same-size reused corruption with one fresh zero-offset refetch", async () => {
    const test = reusedCorruptionFixture();
    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).resolves.toEqual({ readyBytes: resource.bytes, readyResourceCount: 1 });

    expect(test.platform.fetch).toHaveBeenCalledTimes(1);
    const headers = new Headers(test.calls[0]?.headers);
    expect(headers.get("range")).toBe("bytes=0-");
    expect(headers.has("if-range")).toBe(false);
    expect(test.observer.counts).toMatchObject({
      complete: 1,
      downloaded: resource.bytes,
      integrity: 1,
      repairComplete: resource.bytes,
      repairStarted: 1,
    });
    expect(test.observer.counts.resumed ?? 0).toBe(0);
    expect(test.observer.counts.retry ?? 0).toBe(0);
  });

  it("restores final-verification completion credit only after repair succeeds", async () => {
    const test = fixture();
    await expect(
      repairInstallResource(
        test.store,
        test.platform,
        test.observer,
        { ...input(), repairState: createInstallerRepairState() },
        resource,
        true,
      ),
    ).resolves.toEqual(reference());
    expect(test.observer.counts).toMatchObject({
      complete: 1,
      repairComplete: resource.bytes,
      repairCreditRevoked: 1,
      repairStarted: 1,
    });
  });

  it("revokes restored completion credit before rejecting repeated final corruption", async () => {
    const test = fixture();
    const repairState = createInstallerRepairState();
    let completedResourceCount = 1;
    let verifiedBytes = resource.bytes;
    const observer: InstallerTransferObserver = {
      ...test.observer,
      repairCompletionCreditRevoked: (resourceId, bytes) => {
        expect(resourceId).toBe(resource.id);
        completedResourceCount -= 1;
        verifiedBytes -= bytes;
        return test.observer.repairCompletionCreditRevoked(resourceId, bytes);
      },
      resourceComplete: (resourceId, bytes) => {
        completedResourceCount += 1;
        verifiedBytes += bytes;
        test.observer.resourceComplete(resourceId, bytes);
      },
    };
    const repairInput = { ...input(), repairState };

    await expect(
      repairInstallResource(test.store, test.platform, observer, repairInput, resource, true),
    ).resolves.toEqual(reference());
    expect({ completedResourceCount, verifiedBytes }).toEqual({
      completedResourceCount: 1,
      verifiedBytes: resource.bytes,
    });

    await expect(
      repairInstallResource(test.store, test.platform, observer, repairInput, resource, true),
    ).rejects.toMatchObject({
      category: "integrity",
      resourceId: resource.id,
    });
    expect({ completedResourceCount, verifiedBytes }).toEqual({
      completedResourceCount: 0,
      verifiedBytes: 0,
    });
    expect(test.platform.fetch).toHaveBeenCalledTimes(1);
    expect(test.observer.counts.repairCreditRevoked).toBe(2);
    expect(test.observer.counts.complete).toBe(1);
  });

  it("makes a second integrity failure after refetch terminal for the exact resource", async () => {
    const test = reusedCorruptionFixture();
    test.store.finalizePartial = vi.fn(async () => {
      throw new InstallStoreIntegrityError("Published object failed exact reread verification");
    });

    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).rejects.toMatchObject({
      category: "integrity",
      resourceId: resource.id,
    });
    expect(test.platform.fetch).toHaveBeenCalledTimes(1);
    expect(test.observer.counts.integrity).toBe(2);
    expect(test.observer.counts.repairStarted).toBe(1);
    expect(test.observer.counts.repairComplete ?? 0).toBe(0);
    expect(test.observer.counts.verified ?? 0).toBe(0);
    expect(test.observer.counts.complete ?? 0).toBe(0);
    expect(test.observer.counts.retry ?? 0).toBe(0);
  });

  it("keeps a validator failure during repair terminal without another body", async () => {
    const test = reusedCorruptionFixture();
    test.platform.fetch = vi.fn(async () => response(200, new Uint8Array(resource.bytes)));

    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).rejects.toMatchObject({
      category: "validator",
      resourceId: resource.id,
    });
    expect(test.platform.fetch).toHaveBeenCalledTimes(1);
    expect(test.observer.counts.repairStarted).toBe(1);
    expect(test.observer.counts.validator).toBe(1);
    expect(test.observer.counts.retry ?? 0).toBe(0);
  });

  it("preserves a durable repair checkpoint after quota denial", async () => {
    const test = reusedCorruptionFixture();
    const append = test.store.appendPartial.bind(test.store);
    const quota = new DOMException("quota", "QuotaExceededError");
    let appendCount = 0;
    test.store.appendPartial = vi.fn(async (appendInput) => {
      appendCount += 1;
      if (appendCount === 2) throw quota;
      return append(appendInput);
    });

    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).rejects.toMatchObject({
      message: quota.message,
      name: "QuotaExceededError",
      resourceId: resource.id,
    });
    await expect(test.store.prepareResource(releaseDigest, resource.id)).resolves.toMatchObject({
      bytesCommitted: 4,
      state: "partial",
      strongEtag,
    });
    expect(test.platform.fetch).toHaveBeenCalledTimes(1);
    expect(test.observer.counts.repairStarted).toBe(1);
    expect(test.observer.counts.retry ?? 0).toBe(0);
  });

  it("cancels repair without checkpointing its in-memory tail", async () => {
    const test = reusedCorruptionFixture();
    const owner = new AbortController();
    test.platform.fetch = vi.fn(async () => {
      let sent = false;
      return response(
        206,
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!sent) {
              sent = true;
              controller.enqueue(new Uint8Array([1, 2]));
              owner.abort(new DOMException("cancel repair", "AbortError"));
            }
          },
        }),
        {
          "content-length": String(resource.bytes),
          "content-range": `bytes 0-${resource.bytes - 1}/${resource.bytes}`,
          etag: strongEtag,
        },
      );
    });

    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input(owner.signal)),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(test.durable()).toHaveLength(0);
    expect(test.observer.counts.repairStarted).toBe(1);
    expect(test.observer.counts.repairComplete ?? 0).toBe(0);
    expect(test.observer.counts.retry ?? 0).toBe(0);
  });

  it("preserves actual append QuotaExceededError as typed after estimate admission", async () => {
    expect(evaluateInstallerQuotaAdmission(1024 ** 3, resource.bytes)).toMatchObject({
      estimateClearlyInsufficient: false,
    });
    const test = fixture();
    const quota = new DOMException("quota", "QuotaExceededError");
    test.store.appendPartial = vi.fn(async () => {
      throw quota;
    });
    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).rejects.toMatchObject({
      message: quota.message,
      name: "QuotaExceededError",
      resourceId: resource.id,
    });
    expect(test.platform.fetch).toHaveBeenCalledTimes(1);
    expect(test.platform.sleep).not.toHaveBeenCalled();
    expect(test.observer.counts.retry ?? 0).toBe(0);
    expect(test.observer.counts.transport ?? 0).toBe(0);
    expect(test.durable()).toHaveLength(0);
  });

  it("preserves finalizePartial QuotaExceededError after retaining durable checkpoints", async () => {
    const test = fixture();
    const quota = new DOMException("quota", "QuotaExceededError");
    test.store.finalizePartial = vi.fn(async () => {
      throw quota;
    });
    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).rejects.toMatchObject({
      message: quota.message,
      name: "QuotaExceededError",
      resourceId: resource.id,
    });
    expect(test.platform.fetch).toHaveBeenCalledTimes(1);
    expect(test.platform.sleep).not.toHaveBeenCalled();
    expect(test.observer.counts.retry ?? 0).toBe(0);
    expect(test.observer.counts.transport ?? 0).toBe(0);
    expect(test.observer.counts.verified ?? 0).toBe(0);
    expect(test.observer.counts.complete ?? 0).toBe(0);
    expect(test.store.verifyObject).not.toHaveBeenCalled();
    expect(test.durable()).toHaveLength(8);
  });

  it("classifies generic finalize failures as terminal store errors without verified credit", async () => {
    const test = fixture();
    test.store.finalizePartial = vi.fn(async () => {
      throw new Error("store unavailable");
    });
    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).rejects.toMatchObject({
      name: InstallerStoreError.name,
      operation: "finalize-partial",
      resourceId: resource.id,
    });
    expect(test.platform.fetch).toHaveBeenCalledTimes(1);
    expect(test.platform.sleep).not.toHaveBeenCalled();
    expect(test.observer.counts.retry ?? 0).toBe(0);
    expect(test.observer.counts.transport ?? 0).toBe(0);
    expect(test.observer.counts.verified ?? 0).toBe(0);
    expect(test.observer.counts.complete ?? 0).toBe(0);
    expect(test.store.verifyObject).not.toHaveBeenCalled();
  });

  it("classifies a reused-object verification failure as a terminal verify store error", async () => {
    const test = fixture();
    test.store.prepareResource = vi.fn(async () => ({
      bytesCommitted: resource.bytes,
      expectedBytes: resource.bytes,
      reference: reference(),
      state: "verified" as const,
      strongEtag: null,
    }));
    test.store.verifyObject = vi.fn(async () => {
      throw new Error("store unavailable");
    });

    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).rejects.toMatchObject({
      name: InstallerStoreError.name,
      operation: "verify-object",
      resourceId: resource.id,
    });
    expect(test.store.verifyObject).toHaveBeenCalledOnce();
    expect(test.platform.fetch).not.toHaveBeenCalled();
    expect(test.observer.counts.verified ?? 0).toBe(0);
    expect(test.observer.counts.complete ?? 0).toBe(0);
  });

  it("classifies a typed finalized-body hash mismatch as exact-resource integrity", async () => {
    const test = fixture();
    test.store.finalizePartial = vi.fn(async () => {
      throw new InstallStoreIntegrityError("Downloaded body failed exact SHA-256 verification");
    });
    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).rejects.toMatchObject({
      category: "integrity",
      name: InstallerTransferError.name,
      resourceId: resource.id,
    });
    expect(test.platform.fetch).toHaveBeenCalledTimes(1);
    expect(test.platform.sleep).not.toHaveBeenCalled();
    expect(test.observer.counts.retry ?? 0).toBe(0);
    expect(test.observer.counts.transport ?? 0).toBe(0);
    expect(test.observer.counts.verified ?? 0).toBe(0);
    expect(test.observer.counts.complete ?? 0).toBe(0);
    expect(test.store.verifyObject).not.toHaveBeenCalled();
  });

  it("propagates a real store finalize hash mismatch as exact-resource integrity", async () => {
    const expectedBytes = new Uint8Array([1, 2, 3, 4]);
    const corruptBytes = new Uint8Array([1, 2, 3, 5]);
    const integratedResource: InstallResource = {
      bytes: expectedBytes.byteLength,
      id: "integrated-resource",
      kind: "asset-pack",
      scope: "common",
      sha256: bytesToHex(sha256(expectedBytes)),
      source: "immutable/integrated.bin",
      target: "opfs",
    };
    const manifest = new TextEncoder().encode(
      `${JSON.stringify({
        gameId: "parallax",
        resources: [integratedResource],
        schemaVersion: 1,
      })}\n`,
    );
    const store = createOpfsReleaseStore(createMemoryInstallStorePlatform());
    const staged = await store.stageRelease(manifest);
    const observer = observing();
    const platform = platformWith(async () =>
      response(
        206,
        corruptBytes,
        {
          "content-length": String(corruptBytes.byteLength),
          "content-range": `bytes 0-${corruptBytes.byteLength - 1}/${corruptBytes.byteLength}`,
          etag: strongEtag,
        },
        integratedResource.source,
      ),
    );

    await expect(
      transferInstallResources(store, platform, observer, {
        baseUrl,
        policy: { checkpointBytes: 4, concurrency: 1, requestTimeoutMs: 10_000 },
        releaseDigest: staged.releaseDigest,
        resources: [integratedResource],
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      category: "integrity",
      name: InstallerTransferError.name,
      resourceId: integratedResource.id,
    });
    expect(observer.counts.retry ?? 0).toBe(0);
    expect(observer.counts.transport ?? 0).toBe(0);
    expect(observer.counts.verified ?? 0).toBe(0);
    expect(observer.counts.complete ?? 0).toBe(0);
  });

  it("revokes a corrupted active object, removes rejected repair residue, and retries without republishing", async () => {
    const expectedBytes = new Uint8Array([1, 2, 3, 4]);
    const corruptLocalBytes = new Uint8Array([4, 3, 2, 1]);
    const corruptServerBytes = new Uint8Array([9, 9, 9, 9]);
    const integratedResource: InstallResource = {
      bytes: expectedBytes.byteLength,
      id: "repeated-corruption-resource",
      kind: "asset-pack",
      scope: "common",
      sha256: bytesToHex(sha256(expectedBytes)),
      source: "immutable/repeated-corruption.bin",
      target: "opfs",
    };
    const manifest = new TextEncoder().encode(
      `${JSON.stringify({
        gameId: "parallax",
        resources: [integratedResource],
        schemaVersion: 1,
      })}\n`,
    );
    const memory = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(memory);
    const staged = await store.stageRelease(manifest);
    await store.appendPartial({
      bytes: expectedBytes,
      expectedOffset: 0,
      releaseDigest: staged.releaseDigest,
      resourceId: integratedResource.id,
      strongEtag,
    });
    const reference = await store.finalizePartial(staged.releaseDigest, integratedResource.id);
    await store.markReleaseReady(staged.releaseDigest);
    await store.publishRelease(staged.releaseDigest);
    const markerPath = reference.path.replace(/\.data$/u, ".verified.json");
    const readyPath = `parallax-install-v1/releases/${staged.releaseDigest}/ready.json`;
    const publishedPath = `parallax-install-v1/releases/${staged.releaseDigest}/published.json`;
    const readyBytes = await memory.read(readyPath);
    const publishedBytes = await memory.read(publishedPath);
    const commitsBefore = await memory.list("parallax-install-v1/commits", { recursive: true });
    await memory.remove(reference.path);
    await memory.append(reference.path, 0, corruptLocalBytes);

    const observer = observing();
    const corruptTransport = platformWith(async () =>
      response(
        206,
        corruptServerBytes,
        {
          "content-length": String(corruptServerBytes.byteLength),
          "content-range": `bytes 0-${corruptServerBytes.byteLength - 1}/${corruptServerBytes.byteLength}`,
          etag: strongEtag,
        },
        integratedResource.source,
      ),
    );
    await expect(
      transferInstallResources(store, corruptTransport, observer, {
        baseUrl,
        policy: { checkpointBytes: 4, concurrency: 1, requestTimeoutMs: 10_000 },
        releaseDigest: staged.releaseDigest,
        resources: [integratedResource],
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      category: "integrity",
      resourceId: integratedResource.id,
    });

    expect(await store.getSelection()).toEqual({
      activeReleaseDigest: null,
      previousReleaseDigest: null,
    });
    expect(await memory.read(markerPath)).toBeNull();
    expect(await memory.read(reference.path)).toEqual(corruptLocalBytes);
    expect(
      await memory.list(
        `parallax-install-v1/partials/${staged.releaseDigest}/${integratedResource.id}`,
        { recursive: true },
      ),
    ).toEqual([]);
    expect(await memory.read(readyPath)).toEqual(readyBytes);
    expect(await memory.read(publishedPath)).toEqual(publishedBytes);
    expect(await memory.list("parallax-install-v1/commits", { recursive: true })).toEqual(
      commitsBefore,
    );
    expect(store.snapshot()).toMatchObject({
      activeReleaseDigest: null,
      currentCheckpointCount: 0,
      partialBytes: 0,
      partialResourceCount: 0,
      publicationCount: 1,
      readyReleaseCount: 0,
      verifiedObjectCount: 0,
    });
    expect(observer.counts).toMatchObject({
      downloaded: corruptServerBytes.byteLength,
      integrity: 2,
      repairStarted: 1,
    });
    expect(observer.counts.repairComplete ?? 0).toBe(0);
    expect(observer.counts.retry ?? 0).toBe(0);

    const admission = await store.admitRepairRelease(staged.releaseDigest);
    expect(admission).toMatchObject({
      releaseDigest: staged.releaseDigest,
      resourceId: integratedResource.id,
      state: "repair-required",
    });
    const retryObserver = observing();
    const correctTransport = platformWith(async () =>
      response(
        206,
        expectedBytes,
        {
          "content-length": String(expectedBytes.byteLength),
          "content-range": `bytes 0-${expectedBytes.byteLength - 1}/${expectedBytes.byteLength}`,
          etag: strongEtag,
        },
        integratedResource.source,
      ),
    );
    const repairState = createInstallerRepairState();
    const repairInput = {
      baseUrl,
      policy: { checkpointBytes: 4, concurrency: 1, requestTimeoutMs: 10_000 },
      releaseDigest: staged.releaseDigest,
      repairState,
      resources: [integratedResource],
      signal: new AbortController().signal,
    } as const;
    await repairInstallResource(
      store,
      correctTransport,
      retryObserver,
      repairInput,
      integratedResource,
      false,
    );
    const completionStore = createOpfsReleaseStore(memory.reconstruct());
    const restartedAdmission = await completionStore.findRepairRelease(staged.releaseDigest);
    if (restartedAdmission === null) throw new Error("Restarted repair admission is absent");
    expect(restartedAdmission).toMatchObject({
      recordSha256: admission.recordSha256,
      state: "completion-pending",
    });
    await expect(completionStore.verifyRelease(staged.releaseDigest)).resolves.toMatchObject({
      ok: true,
    });
    await expect(completionStore.completeRepairRelease(restartedAdmission)).resolves.toEqual({
      activeReleaseDigest: staged.releaseDigest,
      previousReleaseDigest: null,
    });
    expect(await completionStore.verifyObject(reference)).toMatchObject({ ok: true });
    expect(await completionStore.getSelection()).toEqual({
      activeReleaseDigest: staged.releaseDigest,
      previousReleaseDigest: null,
    });
    expect(completionStore.snapshot().publicationCount).toBe(0);
    expect(await memory.list("parallax-install-v1/commits", { recursive: true })).toEqual(
      commitsBefore,
    );
    const repairRequest = vi.mocked(correctTransport.fetch).mock.calls[0];
    expect(repairRequest?.[0]).toBe(new URL(integratedResource.source, baseUrl).href);
    const repairHeaders = new Headers(repairRequest?.[1]?.headers);
    expect(repairHeaders.get("range")).toBe("bytes=0-");
    expect(repairHeaders.get("if-range")).toBeNull();
    expect(correctTransport.fetch).toHaveBeenCalledTimes(1);
  });

  it("accepts 416 only for an exact completed durable offset", async () => {
    const test = fixture(new Uint8Array(8));
    test.platform.fetch = vi.fn(async () =>
      response(416, new Uint8Array(), { "content-range": "bytes */8" }),
    );
    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input()),
    ).resolves.toMatchObject({ readyBytes: 8 });
  });

  it("cancels without retry and does not checkpoint the in-memory tail", async () => {
    const test = fixture();
    const owner = new AbortController();
    test.platform.fetch = vi.fn(async () => {
      let sent = false;
      return response(
        206,
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!sent) {
              sent = true;
              controller.enqueue(new Uint8Array([1, 2]));
              owner.abort(new DOMException("cancel", "AbortError"));
            }
          },
        }),
        {
          "content-length": "8",
          "content-range": "bytes 0-7/8",
          etag: strongEtag,
        },
      );
    });
    await expect(
      transferInstallResources(test.store, test.platform, test.observer, input(owner.signal)),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(test.durable()).toHaveLength(0);
    expect(test.observer.counts.retry ?? 0).toBe(0);
  });

  it("aborts sibling work and awaits in-flight store quiescence before rethrowing failure", async () => {
    const slow = {
      ...resource,
      bytes: 4,
      id: "resource-slow",
      sha256: "c".repeat(64),
      source: "immutable/slow.bin",
    };
    const failing = {
      ...resource,
      bytes: 4,
      id: "resource-failing",
      sha256: "d".repeat(64),
      source: "immutable/failing.bin",
    };
    const appendStarted = deferred<void>();
    const releaseAppend = deferred<void>();
    let durableMutations = 0;
    let finalizations = 0;
    const store = multiResourceStore(
      [slow, failing],
      async (resourceId) => {
        if (resourceId !== slow.id) return;
        appendStarted.resolve();
        await releaseAppend.promise;
        durableMutations += 1;
      },
      () => {
        finalizations += 1;
      },
    );
    const platform = platformWith(async (url) => {
      if (url.endsWith(slow.source)) {
        return rangeResponse(0, new Uint8Array(4), slow);
      }
      await appendStarted.promise;
      return response(200, null, {}, failing.source);
    });
    const observer = observing();
    const execution = transferInstallResources(store, platform, observer, {
      ...input(),
      policy: { checkpointBytes: 4, concurrency: 2, requestTimeoutMs: 10_000 },
      resources: [slow, failing],
    });
    let settled = false;
    void execution.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await appendStarted.promise;
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseAppend.resolve();
    await expect(execution).rejects.toMatchObject({
      category: "validator",
      resourceId: failing.id,
    });
    const mutationsAtReturn = durableMutations;
    await Promise.resolve();
    await Promise.resolve();
    expect(durableMutations).toBe(mutationsAtReturn);
    expect(durableMutations).toBe(1);
    expect(finalizations).toBe(0);
    expect(observer.counts.validator).toBe(1);
    expect(observer.counts.transport ?? 0).toBe(0);
  });

  it("quiesces an in-flight repair checkpoint before returning a sibling failure", async () => {
    const corrupt = {
      ...resource,
      bytes: 4,
      id: "resource-corrupt",
      sha256: "c".repeat(64),
      source: "immutable/corrupt.bin",
    };
    const failing = {
      ...resource,
      bytes: 4,
      id: "resource-failing-during-repair",
      sha256: "d".repeat(64),
      source: "immutable/failing-during-repair.bin",
    };
    const appendStarted = deferred<void>();
    const releaseAppend = deferred<void>();
    let durableMutations = 0;
    let finalizations = 0;
    const store = multiResourceStore(
      [corrupt, failing],
      async (resourceId) => {
        if (resourceId !== corrupt.id) return;
        appendStarted.resolve();
        await releaseAppend.promise;
        durableMutations += 1;
      },
      () => {
        finalizations += 1;
      },
    );
    const preparePartial = store.prepareResource.bind(store);
    let corruptPrepareCount = 0;
    store.prepareResource = vi.fn(async (targetReleaseDigest, resourceId) => {
      if (resourceId === corrupt.id && corruptPrepareCount++ === 0) {
        return {
          bytesCommitted: corrupt.bytes,
          expectedBytes: corrupt.bytes,
          reference: {
            bytes: corrupt.bytes,
            path: "parallax-install-v1/objects/common/sha256/cc/object.data",
            releaseDigest,
            resourceId: corrupt.id,
            scope: "common" as const,
            sha256: corrupt.sha256,
          },
          state: "verified" as const,
          strongEtag: null,
        };
      }
      return preparePartial(targetReleaseDigest, resourceId);
    });
    store.verifyObject = vi.fn(async (target) =>
      target.resourceId === corrupt.id
        ? { bytes: target.bytes, ok: false, sha256: "e".repeat(64) }
        : { bytes: target.bytes, ok: true, sha256: target.sha256 },
    );
    const platform = platformWith(async (url) => {
      if (url.endsWith(corrupt.source)) {
        return rangeResponse(0, new Uint8Array(corrupt.bytes), corrupt);
      }
      await appendStarted.promise;
      return response(200, null, {}, failing.source);
    });
    const observer = observing();
    const execution = transferInstallResources(store, platform, observer, {
      ...input(),
      policy: { checkpointBytes: 4, concurrency: 2, requestTimeoutMs: 10_000 },
      resources: [corrupt, failing],
    });
    let settled = false;
    void execution.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await appendStarted.promise;
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseAppend.resolve();

    await expect(execution).rejects.toMatchObject({
      category: "validator",
      resourceId: failing.id,
    });
    expect(durableMutations).toBe(1);
    expect(finalizations).toBe(0);
    expect(observer.counts.repairStarted).toBe(1);
    expect(observer.counts.repairComplete ?? 0).toBe(0);
    expect(observer.counts.validator).toBe(1);
  });

  it("awaits all sibling fetch and store work before returning owner cancellation", async () => {
    const slow = {
      ...resource,
      bytes: 4,
      id: "resource-cancel-store",
      sha256: "e".repeat(64),
      source: "immutable/cancel-store.bin",
    };
    const network = {
      ...resource,
      bytes: 4,
      id: "resource-cancel-network",
      sha256: "f".repeat(64),
      source: "immutable/cancel-network.bin",
    };
    const appendStarted = deferred<void>();
    const releaseAppend = deferred<void>();
    const fetchStarted = deferred<void>();
    let durableMutations = 0;
    const store = multiResourceStore([slow, network], async (resourceId) => {
      if (resourceId !== slow.id) return;
      appendStarted.resolve();
      await releaseAppend.promise;
      durableMutations += 1;
    });
    const platform = platformWith(async (url, init) => {
      if (url.endsWith(slow.source)) {
        return rangeResponse(0, new Uint8Array(4), slow);
      }
      fetchStarted.resolve();
      const signal = init.signal;
      if (!(signal instanceof AbortSignal)) throw new Error("missing fetch abort signal");
      return new Promise<Response>((_resolve, reject) => {
        const fail = () => reject(signal.reason);
        signal.addEventListener("abort", fail, { once: true });
        if (signal.aborted) fail();
      });
    });
    const owner = new AbortController();
    const observer = observing();
    const execution = transferInstallResources(store, platform, observer, {
      ...input(owner.signal),
      policy: { checkpointBytes: 4, concurrency: 2, requestTimeoutMs: 10_000 },
      resources: [slow, network],
    });
    let settled = false;
    void execution.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.all([appendStarted.promise, fetchStarted.promise]);
    const cancellation = new DOMException("owner cancelled", "AbortError");
    owner.abort(cancellation);
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseAppend.resolve();
    await expect(execution).rejects.toBe(cancellation);
    const mutationsAtReturn = durableMutations;
    await Promise.resolve();
    await Promise.resolve();
    expect(durableMutations).toBe(mutationsAtReturn);
    expect(durableMutations).toBe(1);
    expect(observer.counts.transport ?? 0).toBe(0);
  });

  it("preserves concurrent quota as primary and awaits blocked sibling checkpoint quiescence", async () => {
    const blocked = {
      ...resource,
      bytes: 4,
      id: "resource-quota-blocked",
      sha256: "1".repeat(64),
      source: "immutable/quota-blocked.bin",
    };
    const quotaResource = {
      ...resource,
      bytes: 4,
      id: "resource-quota-failing",
      sha256: "2".repeat(64),
      source: "immutable/quota-failing.bin",
    };
    const appendStarted = deferred<void>();
    const releaseAppend = deferred<void>();
    const quotaTaskInactive = deferred<void>();
    const quota = new DOMException("quota", "QuotaExceededError");
    let durableMutations = 0;
    let finalizations = 0;
    const store = multiResourceStore(
      [blocked, quotaResource],
      async (resourceId) => {
        if (resourceId === blocked.id) {
          appendStarted.resolve();
          await releaseAppend.promise;
          durableMutations += 1;
          return;
        }
        await appendStarted.promise;
        throw quota;
      },
      () => {
        finalizations += 1;
      },
    );
    const platform = platformWith(async (url) => {
      const target = url.endsWith(blocked.source) ? blocked : quotaResource;
      return rangeResponse(0, new Uint8Array(4), target);
    });
    const observer = observing();
    const countInactive = observer.resourceInactive;
    observer.resourceInactive = (resourceId) => {
      countInactive(resourceId);
      if (resourceId === quotaResource.id) quotaTaskInactive.resolve();
    };
    const execution = transferInstallResources(store, platform, observer, {
      ...input(),
      policy: { checkpointBytes: 4, concurrency: 2, requestTimeoutMs: 10_000 },
      resources: [blocked, quotaResource],
    });
    let settled = false;
    void execution.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.all([appendStarted.promise, quotaTaskInactive.promise]);
    expect(settled).toBe(false);
    releaseAppend.resolve();
    await expect(execution).rejects.toMatchObject({
      message: quota.message,
      name: "QuotaExceededError",
      resourceId: quotaResource.id,
    });
    expect(platform.fetch).toHaveBeenCalledTimes(2);
    expect(platform.sleep).not.toHaveBeenCalled();
    expect(observer.counts.retry ?? 0).toBe(0);
    expect(observer.counts.transport ?? 0).toBe(0);
    expect(durableMutations).toBe(1);
    expect(finalizations).toBe(0);
    const mutationsAtReturn = durableMutations;
    await Promise.resolve();
    await Promise.resolve();
    expect(durableMutations).toBe(mutationsAtReturn);
  });
});

function platformWith(
  fetchImplementation: (url: string, init: RequestInit) => Promise<Response>,
): InstallerTransferPlatform {
  return {
    clearTimeout: () => undefined,
    fetch: vi.fn(fetchImplementation),
    now: () => 0,
    setTimeout: () => 1,
    sleep: vi.fn(async () => undefined),
  };
}

function multiResourceStore(
  resources: readonly InstallResource[],
  beforeAppend: (resourceId: string) => Promise<void>,
  onFinalize: () => void = () => undefined,
): InstallerTransferStore {
  const byId = new Map(resources.map((entry) => [entry.id, entry]));
  const durable = new Map(resources.map((entry) => [entry.id, 0]));
  return {
    async appendPartial(input): Promise<PartialSnapshot> {
      const target = byId.get(input.resourceId);
      if (target === undefined) throw new Error("unknown test resource");
      expect(input.expectedOffset).toBe(durable.get(target.id));
      await beforeAppend(target.id);
      const next = (durable.get(target.id) ?? 0) + input.bytes.byteLength;
      durable.set(target.id, next);
      return {
        bytesCommitted: next,
        expectedBytes: target.bytes,
        releaseDigest,
        resourceId: target.id,
        strongEtag: input.strongEtag,
      };
    },
    async discardPartial(_releaseDigest, resourceId): Promise<void> {
      durable.set(resourceId, 0);
    },
    async finalizePartial(_releaseDigest, resourceId): Promise<VerifiedObjectRef> {
      const target = byId.get(resourceId);
      if (target === undefined) throw new Error("unknown test resource");
      onFinalize();
      return {
        bytes: target.bytes,
        path: `parallax-install-v1/objects/common/sha256/${target.sha256.slice(0, 2)}/object.data`,
        releaseDigest,
        resourceId: target.id,
        scope: "common",
        sha256: target.sha256,
      };
    },
    async prepareResource(_releaseDigest, resourceId) {
      const target = byId.get(resourceId);
      if (target === undefined) throw new Error("unknown test resource");
      return {
        bytesCommitted: durable.get(target.id) ?? 0,
        expectedBytes: target.bytes,
        state: "partial" as const,
        strongEtag: null,
      };
    },
    async verifyObject(reference): Promise<IntegrityResult> {
      return { bytes: reference.bytes, ok: true, sha256: reference.sha256 };
    },
  };
}
