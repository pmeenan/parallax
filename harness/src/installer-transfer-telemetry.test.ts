import { idleInstallerTransferTelemetrySnapshot } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import { validateInstallerTransferTelemetrySnapshot } from "./installer-transfer-telemetry.js";

describe("independent installer-transfer telemetry validation", () => {
  it("accepts the exact idle current envelope and retained v6 semantics", () => {
    const current = idleInstallerTransferTelemetrySnapshot();
    expect(() => validateInstallerTransferTelemetrySnapshot(current)).not.toThrow();
    const {
      failureExpectedReleaseDigest: _failureExpectedReleaseDigest,
      failureSource: _failureSource,
      ...retainedV6
    } = current;
    expect(() =>
      validateInstallerTransferTelemetrySnapshot({ ...retainedV6, schemaVersion: 6 }, 6),
    ).not.toThrow();
  });

  it("retains explicit validation for historical v1 qualification evidence", () => {
    const {
      finalVerificationBytes: _finalVerificationBytes,
      finalVerificationPhase: _finalVerificationPhase,
      finalVerificationResourceCount: _finalVerificationResourceCount,
      finalVerificationTotalBytes: _finalVerificationTotalBytes,
      finalVerificationTotalResourceCount: _finalVerificationTotalResourceCount,
      failureResourceId: _failureResourceId,
      failureClass: _failureClass,
      failureEvidence: _failureEvidence,
      failureOperation: _failureOperation,
      failureExpectedReleaseDigest: _failureExpectedReleaseDigest,
      failureSource: _failureSource,
      operationRepairAttemptCount: _operationRepairAttemptCount,
      operationRepairedBytes: _operationRepairedBytes,
      operationRepairedResourceCount: _operationRepairedResourceCount,
      plannedResumeBytes: _plannedResumeBytes,
      ...current
    } = idleInstallerTransferTelemetrySnapshot();
    const historical = { ...current, schemaVersion: 1 };
    expect(() => validateInstallerTransferTelemetrySnapshot(historical, 1)).not.toThrow();
    expect(() =>
      validateInstallerTransferTelemetrySnapshot(
        {
          ...historical,
          failureCode: "shell-incompatible",
          failureMessage: "new in v2",
          state: "failed",
        },
        1,
      ),
    ).toThrow(/nullable/);
  });

  it("admits discard failure evidence only in v8", () => {
    const current = {
      ...idleInstallerTransferTelemetrySnapshot(),
      failureClass: "installer-store",
      failureCode: "store",
      failureEvidence: "store-discard-partial",
      failureMessage: "Installer store discard-partial failed",
      failureOperation: "install",
      failureResourceId: "resource-a",
      failureSource: "operation",
      state: "failed",
    } as const;
    expect(() => validateInstallerTransferTelemetrySnapshot(current)).not.toThrow();
    const {
      failureExpectedReleaseDigest: _failureExpectedReleaseDigest,
      failureSource: _failureSource,
      ...retainedV7
    } = current;
    expect(() =>
      validateInstallerTransferTelemetrySnapshot({ ...retainedV7, schemaVersion: 7 }, 7),
    ).toThrow(/postdates/);
  });

  it("rejects schema/key/counter/digest/state drift", () => {
    const valid = idleInstallerTransferTelemetrySnapshot();
    for (const invalid of [
      { ...valid, schemaVersion: 1 },
      { ...valid, extra: true },
      { ...valid, downloadedBytes: -1 },
      { ...valid, activeRequestId: 0 },
      { ...valid, activeReleaseDigest: "A".repeat(64) },
      { ...valid, state: "other" },
      { ...valid, persistedState: "false" },
      { ...valid, activeResourceCount: 0, activeResourceId: "resource" },
      { ...valid, concurrency: 0 },
      { ...valid, failureCode: "protocol", failureMessage: null, state: "failed" },
      { ...valid, failureCode: null, failureMessage: "failed", state: "failed" },
      {
        ...valid,
        failureCode: "integrity",
        failureMessage: "failed",
        failureResourceId: "A".repeat(64),
        state: "failed",
      },
      { ...valid, failureResourceId: "resource-a" },
      { ...valid, quotaProbeBytes: 0, quotaProbeCompleted: true },
    ]) {
      expect(() => validateInstallerTransferTelemetrySnapshot(invalid)).toThrow();
    }
  });

  it("accepts fractional durations and rejects non-finite or negative durations", () => {
    const valid = idleInstallerTransferTelemetrySnapshot();
    expect(() =>
      validateInstallerTransferTelemetrySnapshot({
        ...valid,
        lockWaitDurationMs: 0.125,
        operationDurationMs: 1.75,
      }),
    ).not.toThrow();
    for (const duration of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        validateInstallerTransferTelemetrySnapshot({
          ...valid,
          lockWaitDurationMs: duration,
        }),
      ).toThrow(/finite and non-negative/);
      expect(() =>
        validateInstallerTransferTelemetrySnapshot({
          ...valid,
          operationDurationMs: duration,
        }),
      ).toThrow(/finite and non-negative/);
    }
  });

  it("independently rejects forged repair accounting", () => {
    const valid = {
      ...idleInstallerTransferTelemetrySnapshot(),
      completedResourceCount: 1,
      downloadedBytes: 8,
      finalVerificationBytes: 8,
      finalVerificationPhase: "complete" as const,
      finalVerificationResourceCount: 1,
      finalVerificationTotalBytes: 8,
      finalVerificationTotalResourceCount: 1,
      integrityFailureCount: 1,
      operationRepairAttemptCount: 1,
      operationRepairedBytes: 8,
      operationRepairedResourceCount: 1,
      plannedDownloadBytes: 8,
      resourceCount: 1,
      state: "ready" as const,
      totalBytes: 8,
      verifiedBytes: 8,
    };
    expect(() => validateInstallerTransferTelemetrySnapshot(valid)).not.toThrow();
    expect(() =>
      validateInstallerTransferTelemetrySnapshot({
        ...valid,
        completedResourceCount: 3,
        verifiedBytes: 24,
      }),
    ).not.toThrow();
    for (const forged of [
      { operationRepairedResourceCount: 2 },
      { operationRepairedBytes: 9 },
      { operationRepairAttemptCount: 2 },
      { operationRepairedResourceCount: 0 },
      { completedResourceCount: 0 },
      { verifiedBytes: 7 },
      { finalVerificationPhase: "verifying" },
      { reusedBytes: 1 },
    ]) {
      expect(() => validateInstallerTransferTelemetrySnapshot({ ...valid, ...forged })).toThrow(
        /state\/progress/,
      );
    }
  });

  it("requires exact resource identity when integrity failures exceed completed repairs", () => {
    const repeatedCorruption = {
      ...idleInstallerTransferTelemetrySnapshot(),
      downloadedBytes: 8,
      failureCode: "integrity",
      failureClass: "installer-transfer",
      failureEvidence: "transfer-integrity",
      failureExpectedReleaseDigest: "a".repeat(64),
      failureMessage: "Resource failed integrity after its single repair cycle",
      failureOperation: "repair",
      failureResourceId: "resource-a",
      failureSource: "operation",
      integrityFailureCount: 2,
      operationRepairAttemptCount: 1,
      operationRepairedBytes: 8,
      operationRepairedResourceCount: 1,
      plannedDownloadBytes: 8,
      resourceCount: 1,
      state: "failed",
      totalBytes: 8,
    };
    expect(() => validateInstallerTransferTelemetrySnapshot(repeatedCorruption)).not.toThrow();
    for (const missingIdentity of [
      { ...repeatedCorruption, failureResourceId: null },
      {
        ...repeatedCorruption,
        failureResourceId: null,
        integrityFailureCount: 1,
        operationRepairAttemptCount: 0,
        operationRepairedBytes: 0,
        operationRepairedResourceCount: 0,
      },
    ]) {
      expect(() => validateInstallerTransferTelemetrySnapshot(missingIdentity)).toThrow(
        /state\/progress/,
      );
    }
  });
});
