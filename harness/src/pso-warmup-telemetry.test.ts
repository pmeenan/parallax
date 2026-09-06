import type { PsoWarmupTelemetrySnapshot } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import {
  validateExactPsoWarmupTelemetrySnapshot,
  validatePsoWarmupRetainedFailure,
  validatePsoWarmupTelemetrySnapshot,
} from "./pso-warmup-telemetry";
import { resolveExpectedPsoWarmupTraceIdentity } from "./pso-warmup-trace";

describe("independent PSO warmup telemetry validator", () => {
  it("accepts exact ready telemetry and rejects relationship or key drift", () => {
    const snapshot = exactSnapshot();
    expect(validateExactPsoWarmupTelemetrySnapshot(snapshot)).toBe(snapshot);
    expect(() => validatePsoWarmupTelemetrySnapshot({ ...snapshot, requestedCount: 3 })).toThrow(
      /relationships/,
    );
    expect(() => validatePsoWarmupTelemetrySnapshot({ ...snapshot, extra: true } as never)).toThrow(
      /unsupported or missing/,
    );
  });

  it("rejects arbitrary well-formed trace, compatibility, and entry hashes", () => {
    const snapshot = exactSnapshot();
    for (const mutated of [
      { ...snapshot, traceSha256: "a".repeat(64) },
      { ...snapshot, buildCompatibilityDigest: "b".repeat(64) },
      {
        ...snapshot,
        entries: [
          { ...snapshot.entries[0], stateDigest: "c".repeat(64) },
          ...snapshot.entries.slice(1),
        ],
      },
      {
        ...snapshot,
        entries: [
          { ...snapshot.entries[0], id: "babylon-lite.other-well-formed-entry" },
          ...snapshot.entries.slice(1),
        ],
      },
    ]) {
      expect(() =>
        validateExactPsoWarmupTelemetrySnapshot(mutated as PsoWarmupTelemetrySnapshot),
      ).toThrow(/exact trace identity/);
    }
  });

  it("accepts truthful failed replay counters and rejects contradictory compile evidence", () => {
    const failed = compileFailureSnapshot();
    expect(validatePsoWarmupTelemetrySnapshot(failed)).toBe(failed);
    expect(
      validatePsoWarmupRetainedFailure({
        snapshot: failed,
        workerGeneration: 2,
      }),
    ).toMatchObject({ workerGeneration: 2 });
    for (const mutation of [
      { compiledCount: 1 },
      { cacheMissCount: 0 },
      { requestedCount: 2 },
      { entries: [{ ...failed.entries[0], compiled: true }] },
      {
        failure: {
          ...failed.failure,
          requestIndex: 2,
        },
      },
    ]) {
      expect(() =>
        validatePsoWarmupTelemetrySnapshot({
          ...failed,
          ...mutation,
        } as PsoWarmupTelemetrySnapshot),
      ).toThrow();
    }
  });

  it("validates each exact failure class and rejects unsanitized or permissive fields", () => {
    const idle = {
      ...exactSnapshot(),
      cacheHitCount: 0,
      cacheMissCount: 0,
      compiledCount: 0,
      deferredCount: 0,
      entries: [],
      failureCount: 1,
      maximumCompileDurationMs: 0,
      queueHighWater: 0,
      requestedCount: 0,
      state: "failed" as const,
    };
    const failures: readonly NonNullable<PsoWarmupTelemetrySnapshot["failure"]>[] = [
      {
        class: "parse",
        detail: "Trace JSON is invalid",
        entryId: null,
        phase: "trace-parse",
        requestIndex: null,
        traceIndex: null,
      },
      {
        class: "incompatibility",
        detail: "Renderer identity differs",
        entryId: null,
        phase: "trace-validation",
        requestIndex: null,
        traceIndex: null,
      },
      {
        class: "unknown-entry",
        detail: "Trace entry is unknown",
        entryId: "unknown-entry",
        phase: "request-validation",
        requestIndex: 1,
        traceIndex: null,
      },
    ];
    const parseFailure = failures[0];
    if (parseFailure === undefined) throw new Error("PSO failure fixture is missing");
    for (const failure of failures) {
      expect(() => validatePsoWarmupTelemetrySnapshot({ ...idle, failure })).not.toThrow();
    }
    for (const detail of [
      "line one\nline two",
      "C:\\secret\\trace.json",
      "https://secret.invalid/trace",
      "x".repeat(241),
    ]) {
      expect(() =>
        validatePsoWarmupTelemetrySnapshot({
          ...idle,
          failure: { ...parseFailure, detail },
        }),
      ).toThrow(/bounded and sanitized/);
    }
    expect(() =>
      validatePsoWarmupTelemetrySnapshot({
        ...idle,
        failure: { ...parseFailure, extra: true },
      } as never),
    ).toThrow(/unsupported or missing/);
  });
});

function exactSnapshot(): PsoWarmupTelemetrySnapshot {
  const identity = resolveExpectedPsoWarmupTraceIdentity();
  return Object.freeze({
    buildCompatibilityDigest: identity.buildCompatibilityDigest,
    cacheHitCount: 1,
    cacheMissCount: identity.entries.length,
    compiledCount: identity.entries.length,
    contract: "pso-warmup-telemetry@1",
    deferredCount: identity.entries.length,
    entries: Object.freeze(
      identity.entries.map((entry, index) =>
        Object.freeze({
          compileAttemptCount: 1,
          compileDurationMs: 1,
          compiled: true,
          id: entry.id,
          requestCount: index === 0 ? 2 : 1,
          stateDigest: entry.stateDigest,
        }),
      ),
    ),
    failure: null,
    failureCount: 0,
    maximumCompileDurationMs: 1,
    queueHighWater: identity.entries.length,
    releaseDigest: null,
    requestedCount: identity.entries.length + 1,
    schemaVersion: 1,
    source: "privileged-embedded",
    state: "ready",
    totalDurationMs: 2,
    traceEntryCount: identity.entries.length,
    traceSha256: identity.sha256,
  });
}

function compileFailureSnapshot(): PsoWarmupTelemetrySnapshot {
  const ready = exactSnapshot();
  const entry = ready.entries[0];
  if (entry === undefined) throw new Error("Ready PSO fixture has no entry");
  return Object.freeze({
    ...ready,
    cacheMissCount: 1,
    deferredCount: 1,
    queueHighWater: 1,
    cacheHitCount: 0,
    compiledCount: 0,
    entries: Object.freeze([
      Object.freeze({
        ...entry,
        compiled: false,
        requestCount: 1,
      }),
    ]),
    failure: Object.freeze({
      class: "compile" as const,
      detail: "Pipeline creation failed",
      entryId: entry.id,
      phase: "compile" as const,
      requestIndex: 1,
      traceIndex: 0,
    }),
    failureCount: 1,
    requestedCount: 1,
    state: "failed" as const,
  });
}
