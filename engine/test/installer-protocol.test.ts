import { describe, expect, it } from "vitest";
import {
  idleInstallerTransferTelemetrySnapshot,
  parseInstallerRequest,
  parseInstallerResponse,
  parseInstallerSnapshot,
  parseInstallerTransferTelemetry,
} from "../src/install/installer-protocol";
import { unavailableInstallStoreTelemetrySnapshot } from "../src/storage/opfs-release-store";

describe("installer protocol v7", () => {
  it("accepts cumulative retry credit only with exact current release verification", () => {
    const ready = {
      ...idleInstallerTransferTelemetrySnapshot(),
      state: "ready",
      resourceCount: 400,
      totalBytes: 1000,
      completedResourceCount: 402,
      verifiedBytes: 1100,
      plannedDownloadBytes: 900,
      reusedBytes: 100,
      finalVerificationPhase: "complete",
      finalVerificationBytes: 1000,
      finalVerificationTotalBytes: 1000,
      finalVerificationResourceCount: 400,
      finalVerificationTotalResourceCount: 400,
    };
    expect(parseInstallerTransferTelemetry(ready)).toMatchObject({ completedResourceCount: 402 });
    for (const mismatch of [
      { completedResourceCount: 399 },
      { verifiedBytes: 999 },
      { finalVerificationBytes: 999 },
      { finalVerificationResourceCount: 399 },
      { finalVerificationPhase: "verifying" },
      { plannedDownloadBytes: 899 },
    ])
      expect(() => parseInstallerTransferTelemetry({ ...ready, ...mismatch })).toThrow();
  });
  it("accepts exact request/response variants", () => {
    const shellEntrypointPath = `immutable/app-${"c".repeat(64)}.js`;
    expect(parseInstallerRequest({ kind: "install", requestId: 1, shellEntrypointPath })).toEqual({
      kind: "install",
      requestId: 1,
      shellEntrypointPath,
    });
    const expectedReleaseDigest = "a".repeat(64);
    expect(
      parseInstallerRequest({
        expectedReleaseDigest,
        kind: "repair",
        requestId: 5,
        shellEntrypointPath,
      }),
    ).toEqual({ expectedReleaseDigest, kind: "repair", requestId: 5, shellEntrypointPath });
    expect(parseInstallerRequest({ kind: "cancel", requestId: 2, targetRequestId: 1 })).toEqual({
      kind: "cancel",
      requestId: 2,
      targetRequestId: 1,
    });
    expect(parseInstallerResponse({ kind: "ready", protocolVersion: 7 })).toEqual({
      kind: "ready",
      protocolVersion: 7,
    });
    expect(
      parseInstallerResponse({
        kind: "install-complete",
        readyBytes: 0,
        readyResourceCount: 0,
        releaseDigest: "a".repeat(64),
        requestId: 1,
      }),
    ).toMatchObject({ kind: "install-complete" });
    expect(
      parseInstallerRequest({ kind: "target-status", requestId: 3, shellEntrypointPath }),
    ).toEqual({
      kind: "target-status",
      requestId: 3,
      shellEntrypointPath,
    });
    expect(
      parseInstallerResponse({
        active: true,
        activeReleaseDigest: "a".repeat(64),
        kind: "target-status",
        releaseDigest: "a".repeat(64),
        requestId: 3,
      }),
    ).toMatchObject({ active: true, kind: "target-status" });
    expect(
      parseInstallerResponse({
        cancelled: false,
        kind: "cancel-complete",
        requestId: 4,
        targetRequestId: 1,
      }),
    ).toMatchObject({ cancelled: false, kind: "cancel-complete" });
  });

  it("rejects extra keys, invalid IDs, stale versions, and malformed failures", () => {
    expect(() =>
      parseInstallerRequest({
        kind: "install",
        requestId: 0,
        shellEntrypointPath: `immutable/app-${"c".repeat(64)}.js`,
      }),
    ).toThrow();
    expect(() =>
      parseInstallerRequest({
        kind: "install",
        requestId: 1,
        shellEntrypointPath: "../stale.js",
      }),
    ).toThrow(/entrypoint/);
    expect(() => parseInstallerRequest({ extra: true, kind: "snapshot", requestId: 1 })).toThrow(
      /unsupported/,
    );
    expect(() => parseInstallerResponse({ kind: "ready", protocolVersion: 1 })).toThrow();
    expect(() =>
      parseInstallerResponse({
        active: true,
        activeReleaseDigest: "a".repeat(64),
        kind: "target-status",
        releaseDigest: "b".repeat(64),
        requestId: 3,
      }),
    ).toThrow(/target-status/);
    expect(() =>
      parseInstallerResponse({
        code: "not-stable",
        kind: "failure",
        message: "bad",
        requestId: 1,
        resourceId: null,
      }),
    ).toThrow();
  });

  it("validates the exact installer-transfer telemetry surface", () => {
    const telemetry = {
      activeRequestId: null,
      activeReleaseDigest: null,
      activeResourceCount: 0,
      activeResourceId: null,
      cancellationCount: 0,
      checkpointBytes: 4_194_304,
      checkpointedBytes: 0,
      completedResourceCount: 0,
      concurrency: 1,
      downloadedBytes: 0,
      failureCode: null,
      failureClass: null,
      failureEvidence: null,
      failureExpectedReleaseDigest: null,
      failureMessage: null,
      failureOperation: null,
      failureResourceId: null,
      failureSource: null,
      finalVerificationBytes: 0,
      finalVerificationPhase: "idle",
      finalVerificationResourceCount: 0,
      finalVerificationTotalBytes: 0,
      finalVerificationTotalResourceCount: 0,
      hashedBytes: 0,
      httpRequestCount: 0,
      integrityFailureCount: 0,
      lockWaitDurationMs: 0,
      operationDurationMs: 0,
      operationRepairAttemptCount: 0,
      operationRepairedBytes: 0,
      operationRepairedResourceCount: 0,
      persistedState: null,
      plannedDownloadBytes: 0,
      plannedResumeBytes: 0,
      quotaAvailableBytes: null,
      quotaFailureCount: 0,
      quotaProbeBytes: 0,
      quotaProbeCompleted: false,
      quotaRequiredPeakBytes: 0,
      quotaTotalBytes: null,
      quotaUsageBytes: null,
      rangeRequestCount: 0,
      resourceCount: 0,
      resumedBytes: 0,
      retryCount: 0,
      reusedBytes: 0,
      schemaVersion: 9,
      state: "idle",
      totalBytes: 0,
      transportFailureCount: 0,
      validatorFailureCount: 0,
      verifiedBytes: 0,
    };
    expect(parseInstallerTransferTelemetry(telemetry)).toEqual(telemetry);
    expect(
      parseInstallerTransferTelemetry({
        ...telemetry,
        lockWaitDurationMs: 0.125,
        operationDurationMs: 7.75,
      }),
    ).toMatchObject({ lockWaitDurationMs: 0.125, operationDurationMs: 7.75 });
    expect(() => parseInstallerTransferTelemetry({ ...telemetry, extra: 1 })).toThrow(
      /unsupported/,
    );
    for (const duration of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        parseInstallerTransferTelemetry({ ...telemetry, lockWaitDurationMs: duration }),
      ).toThrow(/duration/);
      expect(() =>
        parseInstallerTransferTelemetry({ ...telemetry, operationDurationMs: duration }),
      ).toThrow(/duration/);
    }
  });

  it("recursively validates a worker-realistic snapshot", () => {
    const installStore = {
      ...unavailableInstallStoreTelemetrySnapshot(),
      lastOperationDurationMs: 0.375,
      state: "idle",
    } as const;
    const installerTransfer = {
      ...idleInstallerTransferTelemetrySnapshot(),
      lockWaitDurationMs: 0.25,
      operationDurationMs: 1.5,
    } as const;
    expect(parseInstallerSnapshot({ installStore, installerTransfer })).toEqual({
      installStore,
      installerTransfer,
    });
    for (const [key, value] of [
      ["finalVerificationBytes", 1],
      ["finalVerificationPhase", "verifying"],
      ["finalVerificationResourceCount", 1],
      ["finalVerificationTotalBytes", 1],
      ["finalVerificationTotalResourceCount", 1],
    ] as const) {
      expect(() =>
        parseInstallerSnapshot({
          installStore: { ...installStore, [key]: value },
          installerTransfer,
        }),
      ).toThrow();
    }
    const digest = "a".repeat(64);
    expect(() =>
      parseInstallerSnapshot({
        installStore: {
          ...installStore,
          activeReleaseDigest: "b".repeat(64),
          finalVerificationBytes: 1,
          finalVerificationPhase: "complete",
          finalVerificationResourceCount: 1,
          finalVerificationTotalBytes: 1,
          finalVerificationTotalResourceCount: 1,
          state: "idle",
        },
        installerTransfer: {
          ...installerTransfer,
          activeReleaseDigest: digest,
          completedResourceCount: 1,
          finalVerificationBytes: 1,
          finalVerificationPhase: "complete",
          finalVerificationResourceCount: 1,
          finalVerificationTotalBytes: 1,
          finalVerificationTotalResourceCount: 1,
          plannedDownloadBytes: 1,
          resourceCount: 1,
          state: "ready",
          totalBytes: 1,
          verifiedBytes: 1,
        },
      }),
    ).toThrow(/exact active/);
    const verifiedReady = {
      finalVerificationBytes: 5,
      finalVerificationPhase: "complete" as const,
      finalVerificationResourceCount: 2,
      finalVerificationTotalBytes: 5,
      finalVerificationTotalResourceCount: 2,
    };
    expect(
      parseInstallerSnapshot({
        installStore: {
          ...installStore,
          ...verifiedReady,
          activeReleaseDigest: digest,
          state: "ready",
        },
        installerTransfer: {
          ...installerTransfer,
          ...verifiedReady,
          activeReleaseDigest: digest,
          completedResourceCount: 2,
          plannedDownloadBytes: 5,
          resourceCount: 2,
          state: "ready",
          totalBytes: 5,
          verifiedBytes: 5,
        },
      }),
    ).toMatchObject({
      installerTransfer: { finalVerificationPhase: "complete", state: "ready" },
    });
    for (const forged of [
      { finalVerificationPhase: "verifying" as const },
      { resourceCount: 3 },
      { totalBytes: 6 },
    ]) {
      expect(() =>
        parseInstallerSnapshot({
          installStore: {
            ...installStore,
            ...verifiedReady,
            activeReleaseDigest: digest,
            state: "ready",
          },
          installerTransfer: {
            ...installerTransfer,
            ...verifiedReady,
            ...forged,
            activeReleaseDigest: digest,
            completedResourceCount: forged.resourceCount ?? 2,
            plannedDownloadBytes: 5,
            resourceCount: forged.resourceCount ?? 2,
            state: "ready",
            totalBytes: forged.totalBytes ?? 5,
            verifiedBytes: forged.totalBytes ?? 5,
          },
        }),
      ).toThrow();
    }
    expect(() =>
      parseInstallerSnapshot({
        installStore: { ...installStore, writtenBytes: "1" },
        installerTransfer,
      }),
    ).toThrow(/writtenBytes/);
    expect(() =>
      parseInstallerSnapshot({
        installStore: { ...installStore, extra: true },
        installerTransfer,
      }),
    ).toThrow(/unsupported or missing/);
    expect(() =>
      parseInstallerSnapshot({
        installStore: {
          ...installStore,
          currentResourceId: "resource",
        },
        installerTransfer,
      }),
    ).toThrow(/state relationship/);
    expect(() =>
      parseInstallerSnapshot({
        installStore,
        installerTransfer: { ...installerTransfer, operationDurationMs: Number.NaN },
      }),
    ).toThrow(/duration/);
    for (const malformedTransfer of [
      { activeResourceCount: 0, activeResourceId: "resource" },
      { concurrency: 0 },
      { failureCode: "protocol", failureMessage: null, state: "failed" },
      { failureCode: null, failureMessage: "failed", state: "failed" },
      {
        failureCode: "integrity",
        failureMessage: "failed",
        failureResourceId: "A".repeat(64),
        state: "failed",
      },
      { quotaProbeBytes: 0, quotaProbeCompleted: true },
    ]) {
      expect(() =>
        parseInstallerSnapshot({
          installStore,
          installerTransfer: { ...installerTransfer, ...malformedTransfer },
        }),
      ).toThrow();
    }
    const interruptedVerification = {
      finalVerificationBytes: 2,
      finalVerificationPhase: "verifying" as const,
      finalVerificationResourceCount: 1,
      finalVerificationTotalBytes: 5,
      finalVerificationTotalResourceCount: 2,
    };
    expect(
      parseInstallerSnapshot({
        installStore: {
          ...installStore,
          ...interruptedVerification,
          failureMessage: "verification failed",
          state: "failed",
        },
        installerTransfer: {
          ...installerTransfer,
          ...interruptedVerification,
          failureCode: "integrity",
          failureClass: "installer-transfer",
          failureEvidence: "transfer-integrity",
          failureExpectedReleaseDigest: "a".repeat(64),
          failureMessage: "verification failed",
          failureOperation: "repair",
          failureSource: "operation",
          resourceCount: 2,
          state: "failed",
          totalBytes: 5,
        },
      }),
    ).toMatchObject({
      installerTransfer: {
        finalVerificationPhase: "verifying",
        state: "failed",
      },
    });
    for (const duration of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        parseInstallerSnapshot({
          installStore: { ...installStore, lastOperationDurationMs: duration },
          installerTransfer,
        }),
      ).toThrow(/duration/);
    }
  });

  it("requires exact operation repair counter conservation", () => {
    const valid = {
      ...idleInstallerTransferTelemetrySnapshot(),
      downloadedBytes: 8,
      completedResourceCount: 1,
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
    expect(parseInstallerTransferTelemetry(valid)).toEqual(valid);
    expect(
      parseInstallerTransferTelemetry({
        ...valid,
        completedResourceCount: 0,
        verifiedBytes: 0,
      }),
    ).toMatchObject({
      completedResourceCount: 0,
      verifiedBytes: 0,
    });
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
      expect(() => parseInstallerTransferTelemetry({ ...valid, ...forged })).toThrow(
        /state relationship/,
      );
    }
  });

  it("requires exact resource identity when integrity failures exceed completed repairs", () => {
    const repeatedCorruption = {
      ...idleInstallerTransferTelemetrySnapshot(),
      downloadedBytes: 8,
      failureCode: "integrity" as const,
      failureClass: "installer-transfer" as const,
      failureEvidence: "transfer-integrity" as const,
      failureExpectedReleaseDigest: "a".repeat(64),
      failureMessage: "Resource failed integrity after its single repair cycle",
      failureOperation: "repair" as const,
      failureResourceId: "resource-a",
      failureSource: "operation" as const,
      integrityFailureCount: 2,
      operationRepairAttemptCount: 1,
      operationRepairedBytes: 8,
      operationRepairedResourceCount: 1,
      plannedDownloadBytes: 8,
      resourceCount: 1,
      state: "failed" as const,
      totalBytes: 8,
    };
    expect(parseInstallerTransferTelemetry(repeatedCorruption)).toEqual(repeatedCorruption);
    expect(() =>
      parseInstallerTransferTelemetry({
        ...repeatedCorruption,
        failureResourceId: null,
      }),
    ).toThrow(/state relationship/);
    expect(() =>
      parseInstallerTransferTelemetry({
        ...repeatedCorruption,
        integrityFailureCount: 1,
        operationRepairAttemptCount: 0,
        operationRepairedBytes: 0,
        operationRepairedResourceCount: 0,
        failureResourceId: null,
      }),
    ).toThrow(/state relationship/);
  });
});
