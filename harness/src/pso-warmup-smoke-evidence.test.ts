import type {
  PsoWarmupTelemetrySnapshot,
  RenderRecoveryTelemetry,
  RenderTelemetrySnapshot,
} from "@parallax/engine";
import { describe, expect, it } from "vitest";
import { resolvePsoWarmupEvidence } from "./pso-warmup-smoke-evidence.js";
import { validatePsoWarmupRenderTelemetryRelationship } from "./pso-warmup-telemetry.js";
import { resolveExpectedPsoWarmupTraceIdentity } from "./pso-warmup-trace.js";

describe("PSO warmup smoke evidence", () => {
  it("accepts an ordinary no-failure Ready generation", () => {
    expect(resolvePsoWarmupEvidence(renderEvidence())).toMatchObject({ state: "measured" });
  });

  it("rejects recovered Ready when an earlier PSO failure remains retained", () => {
    const render = renderEvidence({
      recovery: recovery({ restartCount: 1, state: "recovered", workerGeneration: 2 }),
      retainedPsoWarmupFailure: {
        snapshot: compileFailureSnapshot(),
        workerGeneration: 1,
      },
    });
    expect(() => validatePsoWarmupRenderTelemetryRelationship(render)).not.toThrow();
    expect(resolvePsoWarmupEvidence(render)).toMatchObject({
      reason: expect.stringMatching(/retained a failed prior worker generation 1/),
      state: "invalid",
    });
  });

  it.each([
    ["zero", 0],
    ["current", 2],
    ["future", 3],
  ] as const)("rejects a %s retained worker generation", (_label, workerGeneration) => {
    const render = renderEvidence({
      recovery: recovery({ restartCount: 1, state: "recovered", workerGeneration: 2 }),
      retainedPsoWarmupFailure: {
        snapshot: compileFailureSnapshot(),
        workerGeneration,
      },
    });
    expect(() => validatePsoWarmupRenderTelemetryRelationship(render)).toThrow(
      /invalid worker generation|positive prior recovery generation/,
    );
    expect(resolvePsoWarmupEvidence(render).state).toBe("invalid");
  });

  it("rejects retained evidence reordered against render and recovery state", () => {
    const retained = {
      snapshot: compileFailureSnapshot(),
      workerGeneration: 1,
    };
    for (const render of [
      renderEvidence({
        recovery: recovery({ restartCount: 1, state: "restarting", workerGeneration: 2 }),
        retainedPsoWarmupFailure: retained,
        state: "ready",
      }),
      renderEvidence({
        recovery: recovery({ restartCount: 1, state: "recovered", workerGeneration: 2 }),
        retainedPsoWarmupFailure: retained,
        state: "recovering",
      }),
      renderEvidence({
        recovery: recovery({ restartCount: 1, state: "recovered", workerGeneration: 2 }),
        retainedPsoWarmupFailure: retained,
        state: "failed",
      }),
    ]) {
      expect(() => validatePsoWarmupRenderTelemetryRelationship(render)).toThrow(/contradicts/);
    }
  });
});

function renderEvidence(
  overrides: Partial<
    Pick<RenderTelemetrySnapshot, "psoWarmup" | "recovery" | "retainedPsoWarmupFailure" | "state">
  > = {},
): Pick<RenderTelemetrySnapshot, "psoWarmup" | "recovery" | "retainedPsoWarmupFailure" | "state"> {
  return {
    psoWarmup: readySnapshot(),
    recovery: recovery(),
    retainedPsoWarmupFailure: null,
    state: "ready",
    ...overrides,
  };
}

function recovery(overrides: Partial<RenderRecoveryTelemetry> = {}): RenderRecoveryTelemetry {
  return {
    lastCause: null,
    lastFailureMessage: null,
    lastRestartDurationMs: null,
    maximumAutomaticRestarts: 1,
    restartCount: 0,
    state: "not-needed",
    workerGeneration: 1,
    ...overrides,
  };
}

function readySnapshot(): PsoWarmupTelemetrySnapshot {
  const identity = resolveExpectedPsoWarmupTraceIdentity();
  return {
    buildCompatibilityDigest: identity.buildCompatibilityDigest,
    cacheHitCount: 1,
    cacheMissCount: 3,
    compiledCount: 3,
    contract: "pso-warmup-telemetry@1",
    deferredCount: 3,
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
    queueHighWater: 3,
    releaseDigest: null,
    requestedCount: 4,
    schemaVersion: 1,
    source: "privileged-embedded",
    state: "ready",
    totalDurationMs: 2,
    traceEntryCount: 3,
    traceSha256: identity.sha256,
  };
}

function compileFailureSnapshot(): PsoWarmupTelemetrySnapshot {
  const ready = readySnapshot();
  const entry = ready.entries[0];
  if (entry === undefined) throw new Error("Ready fixture has no PSO entry");
  return {
    ...ready,
    cacheMissCount: 1,
    deferredCount: 1,
    queueHighWater: 1,
    cacheHitCount: 0,
    compiledCount: 0,
    entries: [{ ...entry, compiled: false, requestCount: 1 }],
    failure: {
      class: "compile",
      detail: "Pipeline creation failed",
      entryId: entry.id,
      phase: "compile",
      requestIndex: 1,
      traceIndex: 0,
    },
    failureCount: 1,
    requestedCount: 1,
    state: "failed",
  };
}
