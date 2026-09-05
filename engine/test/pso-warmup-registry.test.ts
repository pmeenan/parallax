import { describe, expect, it } from "vitest";
import {
  createEmbeddedPsoWarmupTrace,
  createPsoWarmupRegistry,
  PSO_WARMUP_STANDARD_OPAQUE_ENTRY_ID,
  PSO_WARMUP_STANDARD_OPAQUE_STATE_DIGEST,
} from "../src/index";
import { PSO_WARMUP_PIPELINES } from "../src/render/pso-warmup-contract";

describe("PSO warmup registry", () => {
  it("progresses across a task boundary, compiles once, and deduplicates replay", async () => {
    let now = 10;
    let compileCount = 0;
    let yieldCount = 0;
    const registry = createPsoWarmupRegistry(createEmbeddedPsoWarmupTrace(), {
      now: () => now,
      yieldToBoot: async () => {
        yieldCount += 1;
        now += 2;
      },
    });
    await registry.request(
      PSO_WARMUP_STANDARD_OPAQUE_ENTRY_ID,
      PSO_WARMUP_STANDARD_OPAQUE_STATE_DIGEST,
      () => {
        compileCount += 1;
        now += 4;
      },
    );
    await registry.request(
      PSO_WARMUP_STANDARD_OPAQUE_ENTRY_ID,
      PSO_WARMUP_STANDARD_OPAQUE_STATE_DIGEST,
      () => {
        throw new Error("cache hit invoked compile");
      },
    );
    for (const entry of PSO_WARMUP_PIPELINES.slice(1))
      await registry.request(entry.id, entry.stateDigest, () => undefined);
    await registry.finish();

    expect({ compileCount, yieldCount }).toEqual({ compileCount: 1, yieldCount: 3 });
    expect(registry.snapshot()).toMatchObject({
      cacheHitCount: 1,
      cacheMissCount: 3,
      compiledCount: 3,
      deferredCount: 3,
      failureCount: 0,
      maximumCompileDurationMs: 4,
      queueHighWater: 1,
      requestedCount: 4,
      state: "ready",
      totalDurationMs: 10,
      traceEntryCount: 3,
    });
    expect(registry.snapshot().entries.slice(0, 1)).toEqual([
      {
        compileAttemptCount: 1,
        compileDurationMs: 4,
        compiled: true,
        id: PSO_WARMUP_STANDARD_OPAQUE_ENTRY_ID,
        requestCount: 2,
        stateDigest: PSO_WARMUP_STANDARD_OPAQUE_STATE_DIGEST,
      },
    ]);
  });

  it("fails closed for an unknown request or an omitted trace entry", async () => {
    const unknown = createPsoWarmupRegistry(createEmbeddedPsoWarmupTrace());
    await expect(unknown.request("unknown", "a".repeat(64), () => undefined)).rejects.toThrow(
      /unknown-entry/,
    );
    expect(unknown.snapshot()).toMatchObject({
      failure: { class: "unknown-entry", entryId: "unknown", requestIndex: 1 },
      failureCount: 1,
      state: "failed",
    });

    const missing = createPsoWarmupRegistry(createEmbeddedPsoWarmupTrace());
    await expect(missing.finish()).rejects.toThrow(/was not requested/);
    expect(missing.snapshot()).toMatchObject({ failureCount: 1, state: "failed" });
  });

  it("retains a schema-valid bounded ID for hostile unknown requests", async () => {
    for (const hostile of [
      `${PSO_WARMUP_STANDARD_OPAQUE_ENTRY_ID}!`,
      `${"a".repeat(127)}.${"x".repeat(300)}`,
      "../INVALID ENTRY",
    ]) {
      const registry = createPsoWarmupRegistry(createEmbeddedPsoWarmupTrace());
      await expect(registry.request(hostile, "a".repeat(64), () => undefined)).rejects.toThrow(
        /unknown-entry/,
      );

      const entryId = registry.snapshot().failure?.entryId;
      expect(entryId).toMatch(/^invalid-entry-sha256-[a-f0-9]{64}$/);
      expect(entryId).not.toBe(PSO_WARMUP_STANDARD_OPAQUE_ENTRY_ID);
      expect(entryId?.length).toBeLessThanOrEqual(128);
    }
  });

  it("retains compile failure as typed telemetry", async () => {
    const registry = createPsoWarmupRegistry(createEmbeddedPsoWarmupTrace());
    await expect(
      registry.request(
        PSO_WARMUP_STANDARD_OPAQUE_ENTRY_ID,
        PSO_WARMUP_STANDARD_OPAQUE_STATE_DIGEST,
        () => {
          throw new Error("compile failed");
        },
      ),
    ).rejects.toThrow("compile failed");
    expect(registry.snapshot()).toMatchObject({
      cacheMissCount: 1,
      compiledCount: 0,
      entries: [
        {
          compileAttemptCount: 1,
          compiled: false,
          requestCount: 1,
        },
      ],
      failure: {
        class: "compile",
        detail: "compile failed",
        entryId: PSO_WARMUP_STANDARD_OPAQUE_ENTRY_ID,
        requestIndex: 1,
        traceIndex: 0,
      },
      failureCount: 1,
      requestedCount: 1,
      state: "failed",
    });
  });

  it("bounds and sanitizes compile detail before telemetry publication", async () => {
    const registry = createPsoWarmupRegistry(createEmbeddedPsoWarmupTrace());
    await expect(
      registry.request(
        PSO_WARMUP_STANDARD_OPAQUE_ENTRY_ID,
        PSO_WARMUP_STANDARD_OPAQUE_STATE_DIGEST,
        () => {
          throw new Error(
            `failed\nat C:\\secret\\shader.wgsl https://secret.invalid/${"x".repeat(300)}`,
          );
        },
      ),
    ).rejects.toThrow(/compile failure/);
    const detail = registry.snapshot().failure?.detail;
    expect(detail).toBeTypeOf("string");
    expect(detail?.length).toBeLessThanOrEqual(240);
    expect(detail).not.toMatch(/[\r\n]|secret|https?:\/\//);
  });

  it("records only the digest returned by the observed compile boundary", async () => {
    const registry = createPsoWarmupRegistry(createEmbeddedPsoWarmupTrace());
    await registry.requestObserved(PSO_WARMUP_STANDARD_OPAQUE_ENTRY_ID, async () => {
      return PSO_WARMUP_STANDARD_OPAQUE_STATE_DIGEST;
    });
    for (const entry of PSO_WARMUP_PIPELINES.slice(1))
      await registry.request(entry.id, entry.stateDigest, () => undefined);
    await registry.finish();
    expect(registry.snapshot()).toMatchObject({ compiledCount: 3, state: "ready" });
  });

  it("fails closed when the observed compile boundary returns a different digest", async () => {
    const registry = createPsoWarmupRegistry(createEmbeddedPsoWarmupTrace());
    await expect(
      registry.requestObserved(PSO_WARMUP_STANDARD_OPAQUE_ENTRY_ID, async () => "a".repeat(64)),
    ).rejects.toThrow(/observed state digest is incompatible/);
    expect(registry.snapshot()).toMatchObject({
      cacheMissCount: 1,
      compiledCount: 0,
      failure: { class: "incompatibility", phase: "request-validation" },
      failureCount: 1,
      state: "failed",
    });
  });

  it("retains completed entry observations when a later request fails", async () => {
    const registry = createPsoWarmupRegistry(createEmbeddedPsoWarmupTrace());
    await registry.request(
      PSO_WARMUP_STANDARD_OPAQUE_ENTRY_ID,
      PSO_WARMUP_STANDARD_OPAQUE_STATE_DIGEST,
      () => undefined,
    );
    await expect(registry.request("unknown", "a".repeat(64), () => undefined)).rejects.toThrow(
      /unknown-entry/,
    );
    expect(registry.snapshot()).toMatchObject({
      compiledCount: 1,
      failureCount: 1,
      state: "failed",
    });
    expect(registry.snapshot().entries).toHaveLength(1);
  });
});
