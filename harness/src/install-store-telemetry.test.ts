import { describe, expect, it } from "vitest";
import { validateInstallStoreTelemetrySnapshot } from "./install-store-telemetry.js";

describe("independent install-store telemetry validation", () => {
  it("accepts the explicit unavailable v3 envelope", () => {
    expect(() => validateInstallStoreTelemetrySnapshot(unavailable())).not.toThrow();
  });

  it("rejects schema drift, unsafe counters, extra keys, and false unavailable claims", () => {
    const valid = unavailable();
    expect(() => validateInstallStoreTelemetrySnapshot({ ...valid, schemaVersion: 2 })).toThrow(
      "unsupported schema",
    );
    expect(() =>
      validateInstallStoreTelemetrySnapshot({
        ...valid,
        writtenBytes: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow("non-negative safe integer");
    expect(() => validateInstallStoreTelemetrySnapshot({ ...valid, extra: true })).toThrow(
      "unsupported or missing",
    );
    expect(() => validateInstallStoreTelemetrySnapshot({ ...valid, writtenBytes: 1 })).toThrow(
      "must not claim",
    );
    expect(() =>
      validateInstallStoreTelemetrySnapshot({
        ...valid,
        currentResourceId: "resource",
        state: "idle",
      }),
    ).toThrow("inconsistent state");
    expect(() =>
      validateInstallStoreTelemetrySnapshot({
        ...valid,
        failureMessage: "failed",
        state: "idle",
      }),
    ).toThrow("inconsistent state");
    for (const drift of [
      { currentReleaseDigest: "a".repeat(64) },
      { currentResourceId: "resource" },
      { failureMessage: "failed" },
      { garbageCollectionRemaining: true },
      { lastOperationDurationMs: 0.01 },
    ]) {
      expect(() => validateInstallStoreTelemetrySnapshot({ ...valid, ...drift })).toThrow(
        "must not claim",
      );
    }
  });

  it("accepts fractional durations and rejects non-finite or negative durations", () => {
    const valid = {
      ...unavailable(),
      lastOperationDurationMs: 0.375,
      state: "idle",
    };
    expect(() => validateInstallStoreTelemetrySnapshot(valid)).not.toThrow();
    for (const duration of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        validateInstallStoreTelemetrySnapshot({
          ...valid,
          lastOperationDurationMs: duration,
        }),
      ).toThrow(/duration/);
    }
  });
});

function unavailable(): Record<string, unknown> {
  return {
    activeReleaseDigest: null,
    currentReleaseDigest: null,
    currentResourceId: null,
    currentCheckpointCount: 0,
    etagBoundPartialCount: 0,
    failureMessage: null,
    finalVerificationBytes: 0,
    finalVerificationPhase: "idle",
    finalVerificationResourceCount: 0,
    finalVerificationTotalBytes: 0,
    finalVerificationTotalResourceCount: 0,
    garbageCollectedBytes: 0,
    garbageCollectedEntries: 0,
    garbageCollectionRemaining: false,
    hashedBytes: 0,
    integrityFailures: 0,
    lastOperationDurationMs: 0,
    partialBytes: 0,
    partialResourceCount: 0,
    previousReleaseDigest: null,
    publicationCount: 0,
    checkpointWriteCount: 0,
    quotaExceededCount: 0,
    readyReleaseCount: 0,
    reconciliationCount: 0,
    recoveryCount: 0,
    resumedBytes: 0,
    reusedBytes: 0,
    rollbackCount: 0,
    schemaVersion: 3,
    stagedReleaseCount: 0,
    state: "unavailable",
    verifiedObjectBytes: 0,
    verifiedObjectCount: 0,
    writtenBytes: 0,
  };
}
