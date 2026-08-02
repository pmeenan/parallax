import {
  assertCanonicalInstallerFailureDiagnostic,
  INSTALLER_FAILURE_RULES,
  type InstallerFailureClass,
  type InstallerFailureCode,
  type InstallerFailureEvidence,
  type InstallerFailureOperation,
} from "@parallax/engine";
import { validateInstallStoreTelemetrySnapshot } from "./install-store-telemetry.js";

const KEYS = Object.freeze([
  "activeRequestId",
  "activeReleaseDigest",
  "activeResourceCount",
  "activeResourceId",
  "cancellationCount",
  "checkpointBytes",
  "checkpointedBytes",
  "completedResourceCount",
  "concurrency",
  "downloadedBytes",
  "failureCode",
  "failureClass",
  "failureEvidence",
  "failureExpectedReleaseDigest",
  "failureMessage",
  "failureOperation",
  "failureResourceId",
  "failureSource",
  "finalVerificationBytes",
  "finalVerificationPhase",
  "finalVerificationResourceCount",
  "finalVerificationTotalBytes",
  "finalVerificationTotalResourceCount",
  "hashedBytes",
  "httpRequestCount",
  "integrityFailureCount",
  "lockWaitDurationMs",
  "operationDurationMs",
  "operationRepairAttemptCount",
  "operationRepairedBytes",
  "operationRepairedResourceCount",
  "persistedState",
  "plannedDownloadBytes",
  "plannedResumeBytes",
  "quotaAvailableBytes",
  "quotaFailureCount",
  "quotaProbeBytes",
  "quotaProbeCompleted",
  "quotaRequiredPeakBytes",
  "quotaTotalBytes",
  "quotaUsageBytes",
  "rangeRequestCount",
  "resourceCount",
  "resumedBytes",
  "retryCount",
  "reusedBytes",
  "schemaVersion",
  "state",
  "totalBytes",
  "transportFailureCount",
  "validatorFailureCount",
  "verifiedBytes",
]);
const STATES = new Set([
  "cancelled",
  "cancelling",
  "disposed",
  "failed",
  "idle",
  "planning",
  "probing-quota",
  "ready",
  "transferring",
  "verifying",
  "waiting-lock",
]);
const V1_FAILURE_CODES = new Set([
  "cancelled",
  "cancel-target-invalid",
  "concurrent-install",
  "disposed",
  "install-manifest-invalid",
  "integrity",
  "protocol",
  "quota",
  "transport",
  "validator",
  "unknown",
]);
const V2_FAILURE_CODES = new Set([...V1_FAILURE_CODES, "shell-incompatible"]);
const SHA256 = /^[a-f0-9]{64}$/;
const RESOURCE_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const NULLABLE_COUNTERS = new Set([
  "activeRequestId",
  "quotaAvailableBytes",
  "quotaTotalBytes",
  "quotaUsageBytes",
]);
const NON_COUNTERS = new Set([
  "activeReleaseDigest",
  "activeResourceId",
  "failureCode",
  "failureClass",
  "failureEvidence",
  "failureExpectedReleaseDigest",
  "failureMessage",
  "failureOperation",
  "failureResourceId",
  "failureSource",
  "finalVerificationPhase",
  "lockWaitDurationMs",
  "operationDurationMs",
  "persistedState",
  "quotaProbeCompleted",
  "schemaVersion",
  "state",
]);

export function validateInstallerTransferTelemetrySnapshot(
  input: unknown,
  expectedSchemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 9,
): void {
  if (!isRecord(input)) throw new Error("installerTransfer telemetry must be an object");
  const actual = Object.keys(input).sort();
  const expected = KEYS.filter(
    (key) =>
      (expectedSchemaVersion >= 3 ||
        ![
          "finalVerificationBytes",
          "finalVerificationPhase",
          "finalVerificationResourceCount",
          "finalVerificationTotalBytes",
          "finalVerificationTotalResourceCount",
        ].includes(key)) &&
      (expectedSchemaVersion >= 4 ||
        ![
          "failureResourceId",
          "operationRepairAttemptCount",
          "operationRepairedBytes",
          "operationRepairedResourceCount",
          "plannedResumeBytes",
        ].includes(key)) &&
      (expectedSchemaVersion >= 5 || !["failureClass", "failureEvidence"].includes(key)),
  )
    .filter((key) => expectedSchemaVersion >= 6 || key !== "failureOperation")
    .filter((key) =>
      expectedSchemaVersion >= 9
        ? true
        : key !== "failureExpectedReleaseDigest" && key !== "failureSource",
    )
    .sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(
      `installerTransfer telemetry v${expectedSchemaVersion} has unsupported or missing keys`,
    );
  }
  if (expectedSchemaVersion < 8 && input.failureEvidence === "store-discard-partial") {
    throw new Error("installerTransfer telemetry failure evidence postdates its schema");
  }
  if (expectedSchemaVersion < 9 && input.failureCode === "repair-target-mismatch") {
    throw new Error("installerTransfer telemetry failure code postdates its schema");
  }
  if (
    input.schemaVersion !== expectedSchemaVersion ||
    typeof input.state !== "string" ||
    !STATES.has(input.state)
  ) {
    throw new Error("installerTransfer telemetry has an unsupported schema/state");
  }
  const failureCodes = expectedSchemaVersion === 1 ? V1_FAILURE_CODES : V2_FAILURE_CODES;
  for (const key of expected) {
    if (NON_COUNTERS.has(key)) continue;
    const value = input[key];
    if (NULLABLE_COUNTERS.has(key) && value === null) continue;
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      throw new Error(`installerTransfer telemetry ${key} must be a non-negative safe integer`);
    }
  }
  for (const key of ["lockWaitDurationMs", "operationDurationMs"]) {
    const value = input[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`installerTransfer telemetry ${key} must be finite and non-negative`);
    }
  }
  if (
    input.activeReleaseDigest !== null &&
    (typeof input.activeReleaseDigest !== "string" || !SHA256.test(input.activeReleaseDigest))
  ) {
    throw new Error("installerTransfer telemetry has invalid active release digest");
  }
  if (
    expectedSchemaVersion >= 9 &&
    input.failureExpectedReleaseDigest !== null &&
    (typeof input.failureExpectedReleaseDigest !== "string" ||
      !SHA256.test(input.failureExpectedReleaseDigest))
  ) {
    throw new Error("installerTransfer telemetry has invalid expected failure release digest");
  }
  if (
    input.activeResourceId !== null &&
    (typeof input.activeResourceId !== "string" || !RESOURCE_ID.test(input.activeResourceId))
  ) {
    throw new Error("installerTransfer telemetry has invalid active resource ID");
  }
  if (
    expectedSchemaVersion >= 4 &&
    input.failureResourceId !== null &&
    (typeof input.failureResourceId !== "string" || !RESOURCE_ID.test(input.failureResourceId))
  ) {
    throw new Error("installerTransfer telemetry has invalid failure resource ID");
  }
  if (
    (expectedSchemaVersion < 5 &&
      input.failureCode !== null &&
      (typeof input.failureCode !== "string" || !failureCodes.has(input.failureCode))) ||
    (expectedSchemaVersion >= 5 &&
      input.failureClass !== null &&
      typeof input.failureClass !== "string") ||
    (expectedSchemaVersion >= 5 &&
      input.failureEvidence !== null &&
      typeof input.failureEvidence !== "string") ||
    (expectedSchemaVersion >= 6 &&
      input.failureOperation !== null &&
      typeof input.failureOperation !== "string") ||
    (expectedSchemaVersion >= 9 &&
      input.failureSource !== null &&
      input.failureSource !== "operation" &&
      input.failureSource !== "session") ||
    (input.failureMessage !== null && typeof input.failureMessage !== "string") ||
    (input.persistedState !== null && typeof input.persistedState !== "boolean") ||
    typeof input.quotaProbeCompleted !== "boolean" ||
    (expectedSchemaVersion >= 3 &&
      input.finalVerificationPhase !== "idle" &&
      input.finalVerificationPhase !== "verifying" &&
      input.finalVerificationPhase !== "complete")
  ) {
    throw new Error("installerTransfer telemetry has invalid nullable/boolean fields");
  }
  if (
    expectedSchemaVersion >= 5 &&
    ((input.failureCode === null) !== (input.failureClass === null) ||
      (input.failureCode === null) !== (input.failureEvidence === null) ||
      (expectedSchemaVersion >= 6 &&
        (input.failureCode === null) !== (input.failureOperation === null)) ||
      (expectedSchemaVersion >= 9 &&
        (input.failureCode === null) !== (input.failureSource === null)))
  ) {
    throw new Error("installerTransfer telemetry structured failure fields contradict");
  }
  if (
    expectedSchemaVersion >= 5 &&
    input.failureCode !== null &&
    input.failureClass !== null &&
    input.failureEvidence !== null &&
    input.failureMessage !== null
  ) {
    const historicalOperation =
      expectedSchemaVersion >= 6
        ? (input.failureOperation as InstallerFailureOperation)
        : INSTALLER_FAILURE_RULES.find(
            (rule) =>
              rule.code === input.failureCode &&
              rule.failureClass === input.failureClass &&
              rule.failureEvidence === input.failureEvidence,
          )?.operations[0];
    if (historicalOperation === undefined) {
      throw new Error("installerTransfer telemetry has no authoritative failure operation");
    }
    assertCanonicalInstallerFailureDiagnostic({
      code: input.failureCode as InstallerFailureCode,
      failureClass: input.failureClass as InstallerFailureClass,
      failureEvidence: input.failureEvidence as InstallerFailureEvidence,
      message: input.failureMessage as string,
      operation: historicalOperation,
      resourceId: input.failureResourceId as string | null,
    });
  }
  if (
    input.activeRequestId !== null &&
    (!Number.isSafeInteger(input.activeRequestId) || (input.activeRequestId as number) <= 0)
  ) {
    throw new Error("installerTransfer telemetry activeRequestId must be null or positive");
  }
  if (
    (input.checkpointBytes as number) <= 0 ||
    (input.concurrency as number) <= 0 ||
    (input.activeResourceCount as number) > (input.concurrency as number) ||
    ((input.activeResourceCount as number) === 0 && input.activeResourceId !== null) ||
    (input.failureCode === null) !== (input.failureMessage === null) ||
    (expectedSchemaVersion >= 4 &&
      input.failureCode === null &&
      input.failureResourceId !== null) ||
    (expectedSchemaVersion >= 9 &&
      ((input.failureCode === null && input.failureExpectedReleaseDigest !== null) ||
        (input.failureExpectedReleaseDigest !== null &&
          (input.failureSource !== "operation" || input.failureOperation !== "repair")) ||
        (input.failureSource === "operation" &&
          input.failureOperation === "repair" &&
          input.failureExpectedReleaseDigest === null))) ||
    (input.state === "failed" || input.state === "cancelled") !== (input.failureCode !== null) ||
    (input.state === "cancelled" && input.failureCode !== "cancelled") ||
    (input.quotaProbeCompleted === true && (input.quotaProbeBytes as number) === 0) ||
    (typeof input.failureMessage === "string" && input.failureMessage.length === 0) ||
    (expectedSchemaVersion >= 3 &&
      ((input.finalVerificationBytes as number) > (input.finalVerificationTotalBytes as number) ||
        (input.finalVerificationResourceCount as number) >
          (input.finalVerificationTotalResourceCount as number) ||
        (input.finalVerificationPhase === "idle" &&
          ((input.finalVerificationBytes as number) !== 0 ||
            (input.finalVerificationResourceCount as number) !== 0 ||
            (input.finalVerificationTotalBytes as number) !== 0 ||
            (input.finalVerificationTotalResourceCount as number) !== 0)) ||
        (input.finalVerificationPhase === "complete" &&
          ((input.finalVerificationBytes as number) !==
            (input.finalVerificationTotalBytes as number) ||
            (input.finalVerificationResourceCount as number) !==
              (input.finalVerificationTotalResourceCount as number))))) ||
    (expectedSchemaVersion >= 4 &&
      ((input.operationRepairedResourceCount as number) >
        (input.operationRepairAttemptCount as number) ||
        ((input.operationRepairAttemptCount as number) === 0 &&
          ((input.operationRepairedResourceCount as number) !== 0 ||
            (input.operationRepairedBytes as number) !== 0)) ||
        ((input.operationRepairedResourceCount as number) === 0 &&
          (input.operationRepairedBytes as number) !== 0) ||
        ((input.operationRepairedResourceCount as number) > 0 &&
          (input.operationRepairedBytes as number) === 0) ||
        ((input.resourceCount as number) > 0 &&
          (input.operationRepairAttemptCount as number) > (input.resourceCount as number)) ||
        (input.operationRepairedBytes as number) > (input.downloadedBytes as number) ||
        (input.operationRepairedBytes as number) > (input.plannedDownloadBytes as number) ||
        (input.operationRepairAttemptCount as number) > (input.integrityFailureCount as number) ||
        ((input.operationRepairAttemptCount as number) >
          (input.operationRepairedResourceCount as number) &&
          input.state === "failed" &&
          input.failureResourceId === null) ||
        (input.state === "failed" &&
          input.failureCode === "integrity" &&
          (input.integrityFailureCount as number) >
            (input.operationRepairedResourceCount as number) &&
          input.failureResourceId === null) ||
        (input.state === "ready" &&
          ((input.operationRepairAttemptCount as number) !==
            (input.operationRepairedResourceCount as number) ||
            (input.resourceCount as number) === 0 ||
            (input.totalBytes as number) === 0 ||
            (input.completedResourceCount as number) < (input.resourceCount as number) ||
            (input.verifiedBytes as number) < (input.totalBytes as number) ||
            input.finalVerificationPhase !== "complete" ||
            (input.finalVerificationBytes as number) !== (input.totalBytes as number) ||
            (input.finalVerificationResourceCount as number) !== (input.resourceCount as number) ||
            (input.finalVerificationTotalBytes as number) !== (input.totalBytes as number) ||
            (input.finalVerificationTotalResourceCount as number) !==
              (input.resourceCount as number) ||
            safeAdd(
              safeAdd(input.plannedDownloadBytes, input.plannedResumeBytes),
              input.reusedBytes,
            ) !== input.totalBytes))))
  ) {
    throw new Error("installerTransfer telemetry has inconsistent state/progress fields");
  }
}

export function validateInstallerSnapshotTelemetry(
  input: {
    readonly installStore: unknown;
    readonly installerTransfer: unknown;
  },
  expectedInstallerTransferSchemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 9,
): void {
  validateInstallStoreTelemetrySnapshot(input.installStore);
  validateInstallerTransferTelemetrySnapshot(
    input.installerTransfer,
    expectedInstallerTransferSchemaVersion,
  );
  if (!isRecord(input.installStore) || !isRecord(input.installerTransfer)) {
    throw new Error("installer telemetry snapshot must contain exact telemetry objects");
  }
  for (const key of [
    "finalVerificationBytes",
    "finalVerificationPhase",
    "finalVerificationResourceCount",
    "finalVerificationTotalBytes",
    "finalVerificationTotalResourceCount",
  ]) {
    if (input.installStore[key] !== input.installerTransfer[key]) {
      throw new Error(`installer final verification ${key} contradicts the install store`);
    }
  }
  if (
    input.installerTransfer.state === "ready" &&
    (input.installerTransfer.activeReleaseDigest === null ||
      input.installStore.activeReleaseDigest !== input.installerTransfer.activeReleaseDigest)
  ) {
    throw new Error("installer ready telemetry contradicts the exact active store selection");
  }
}

function safeAdd(left: unknown, right: unknown): number {
  const total = (left as number) + (right as number);
  if (!Number.isSafeInteger(total)) {
    throw new Error("installerTransfer telemetry total exceeds safe integer");
  }
  return total;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
