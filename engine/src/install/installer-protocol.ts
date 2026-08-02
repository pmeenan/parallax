import {
  type InstallStoreTelemetrySnapshot,
  parseInstallStoreTelemetrySnapshot,
} from "../storage/opfs-release-store-contract";
import {
  assertCanonicalInstallerFailureDiagnostic,
  type InstallerFailureClass,
  type InstallerFailureCode,
  type InstallerFailureEvidence,
  type InstallerFailureOperation,
} from "./installer-failure";

export type {
  InstallerFailureClass,
  InstallerFailureCode,
  InstallerFailureEvidence,
  InstallerFailureOperation,
  InstallerFailureRecovery,
} from "./installer-failure";

export const INSTALLER_PROTOCOL_VERSION = 7;
// v7 binds Repair requests and failures to an exact expected release digest.
// v7 defines quotaRequiredPeakBytes as one next atomic resource/probe plus metadata,
// rather than the full release's remaining bytes.
// v8 carries installer protocol v6's expanded failure-evidence taxonomy.
export const INSTALLER_TRANSFER_TELEMETRY_SCHEMA_VERSION = 9;
export const INSTALL_TRANSFER_LOCK_NAME = "parallax-installer-transfer-v1";

export type InstallerTransferState =
  | "cancelled"
  | "cancelling"
  | "disposed"
  | "failed"
  | "idle"
  | "planning"
  | "probing-quota"
  | "ready"
  | "transferring"
  | "verifying"
  | "waiting-lock";

export interface InstallerTransferTelemetrySnapshot {
  readonly activeRequestId: number | null;
  readonly activeReleaseDigest: string | null;
  readonly activeResourceCount: number;
  readonly activeResourceId: string | null;
  readonly cancellationCount: number;
  readonly checkpointBytes: number;
  readonly checkpointedBytes: number;
  readonly completedResourceCount: number;
  readonly concurrency: number;
  readonly downloadedBytes: number;
  readonly failureCode: InstallerFailureCode | null;
  readonly failureClass: InstallerFailureClass | null;
  readonly failureEvidence: InstallerFailureEvidence | null;
  readonly failureExpectedReleaseDigest: string | null;
  readonly failureMessage: string | null;
  readonly failureOperation: InstallerFailureOperation | null;
  readonly failureResourceId: string | null;
  readonly failureSource: "operation" | "session" | null;
  readonly finalVerificationBytes: number;
  readonly finalVerificationPhase: InstallStoreTelemetrySnapshot["finalVerificationPhase"];
  readonly finalVerificationResourceCount: number;
  readonly finalVerificationTotalBytes: number;
  readonly finalVerificationTotalResourceCount: number;
  readonly hashedBytes: number;
  readonly httpRequestCount: number;
  readonly integrityFailureCount: number;
  readonly lockWaitDurationMs: number;
  readonly operationDurationMs: number;
  readonly operationRepairAttemptCount: number;
  readonly operationRepairedBytes: number;
  readonly operationRepairedResourceCount: number;
  readonly persistedState: boolean | null;
  readonly plannedDownloadBytes: number;
  readonly plannedResumeBytes: number;
  readonly quotaAvailableBytes: number | null;
  readonly quotaFailureCount: number;
  readonly quotaProbeBytes: number;
  readonly quotaProbeCompleted: boolean;
  readonly quotaRequiredPeakBytes: number;
  readonly quotaTotalBytes: number | null;
  readonly quotaUsageBytes: number | null;
  readonly rangeRequestCount: number;
  readonly resourceCount: number;
  readonly resumedBytes: number;
  readonly retryCount: number;
  readonly reusedBytes: number;
  readonly schemaVersion: typeof INSTALLER_TRANSFER_TELEMETRY_SCHEMA_VERSION;
  readonly state: InstallerTransferState;
  readonly totalBytes: number;
  readonly transportFailureCount: number;
  readonly validatorFailureCount: number;
  readonly verifiedBytes: number;
}

export interface InstallerInstallResult {
  readonly readyBytes: number;
  readonly readyResourceCount: number;
  readonly releaseDigest: string;
}

export interface InstallerTargetStatus {
  readonly active: boolean;
  readonly activeReleaseDigest: string | null;
  readonly releaseDigest: string;
}

export interface InstallerSnapshot {
  readonly installStore: InstallStoreTelemetrySnapshot;
  readonly installerTransfer: InstallerTransferTelemetrySnapshot;
}

export function idleInstallerTransferTelemetrySnapshot(
  concurrency = 1,
  checkpointBytes = 4 * 1024 * 1024,
): InstallerTransferTelemetrySnapshot {
  return Object.freeze({
    activeRequestId: null,
    activeReleaseDigest: null,
    activeResourceCount: 0,
    activeResourceId: null,
    cancellationCount: 0,
    checkpointBytes,
    checkpointedBytes: 0,
    completedResourceCount: 0,
    concurrency,
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
    schemaVersion: INSTALLER_TRANSFER_TELEMETRY_SCHEMA_VERSION,
    state: "idle",
    totalBytes: 0,
    transportFailureCount: 0,
    validatorFailureCount: 0,
    verifiedBytes: 0,
  });
}

export type InstallerRequest =
  | Readonly<{ kind: "cancel"; requestId: number; targetRequestId: number }>
  | Readonly<{ kind: "dispose"; requestId: number }>
  | Readonly<{ kind: "install"; requestId: number; shellEntrypointPath: string }>
  | Readonly<{
      expectedReleaseDigest: string;
      kind: "repair";
      requestId: number;
      shellEntrypointPath: string;
    }>
  | Readonly<{ kind: "snapshot"; requestId: number }>
  | Readonly<{ kind: "target-status"; requestId: number; shellEntrypointPath: string }>;

export type InstallerResponse =
  | Readonly<{
      cancelled: boolean;
      kind: "cancel-complete";
      requestId: number;
      targetRequestId: number;
    }>
  | Readonly<{ kind: "dispose-complete"; requestId: number }>
  | Readonly<{
      code: InstallerFailureCode;
      failureClass: InstallerFailureClass;
      failureEvidence: InstallerFailureEvidence;
      expectedReleaseDigest: string | null;
      failureSource: "operation" | "session";
      kind: "failure";
      message: string;
      operation: InstallerFailureOperation;
      requestId: number;
      resourceId: string | null;
    }>
  | Readonly<{
      kind: "install-complete";
      readyBytes: number;
      readyResourceCount: number;
      releaseDigest: string;
      requestId: number;
    }>
  | Readonly<{ kind: "ready"; protocolVersion: typeof INSTALLER_PROTOCOL_VERSION }>
  | Readonly<{ kind: "snapshot"; requestId: number | null; snapshot: InstallerSnapshot }>
  | Readonly<{
      active: boolean;
      activeReleaseDigest: string | null;
      kind: "target-status";
      releaseDigest: string;
      requestId: number;
    }>;

const SHA256 = /^[a-f0-9]{64}$/;
const RESOURCE_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;

export function parseInstallerRequest(input: unknown): InstallerRequest {
  const record = object(input);
  switch (record.kind) {
    case "snapshot":
    case "dispose":
      exact(record, ["kind", "requestId"]);
      positiveRequestId(record.requestId);
      return Object.freeze(record) as unknown as InstallerRequest;
    case "install":
    case "target-status":
      exact(record, ["kind", "requestId", "shellEntrypointPath"]);
      positiveRequestId(record.requestId);
      safeShellEntrypointPath(record.shellEntrypointPath);
      return Object.freeze(record) as unknown as InstallerRequest;
    case "repair":
      exact(record, ["expectedReleaseDigest", "kind", "requestId", "shellEntrypointPath"]);
      digest(record.expectedReleaseDigest);
      positiveRequestId(record.requestId);
      safeShellEntrypointPath(record.shellEntrypointPath);
      return Object.freeze(record) as unknown as InstallerRequest;
    case "cancel":
      exact(record, ["kind", "requestId", "targetRequestId"]);
      positiveRequestId(record.requestId);
      positiveRequestId(record.targetRequestId);
      return Object.freeze(record) as unknown as InstallerRequest;
    default:
      throw new Error("Unknown installer request kind");
  }
}

export function parseInstallerResponse(input: unknown): InstallerResponse {
  const record = object(input);
  switch (record.kind) {
    case "ready":
      exact(record, ["kind", "protocolVersion"]);
      if (record.protocolVersion !== INSTALLER_PROTOCOL_VERSION) {
        throw new Error("Unsupported installer worker protocol");
      }
      return Object.freeze(record) as unknown as InstallerResponse;
    case "snapshot":
      exact(record, ["kind", "requestId", "snapshot"]);
      nullableRequestId(record.requestId);
      return Object.freeze({
        kind: "snapshot",
        requestId: record.requestId,
        snapshot: parseInstallerSnapshot(record.snapshot),
      }) as InstallerResponse;
    case "install-complete":
      exact(record, ["kind", "readyBytes", "readyResourceCount", "releaseDigest", "requestId"]);
      positiveRequestId(record.requestId);
      nonnegativeSafe(record.readyBytes);
      nonnegativeSafe(record.readyResourceCount);
      if (typeof record.releaseDigest !== "string" || !SHA256.test(record.releaseDigest)) {
        throw new Error("Invalid installer completion release digest");
      }
      return Object.freeze(record) as unknown as InstallerResponse;
    case "target-status":
      exact(record, ["active", "activeReleaseDigest", "kind", "releaseDigest", "requestId"]);
      positiveRequestId(record.requestId);
      if (
        typeof record.active !== "boolean" ||
        typeof record.releaseDigest !== "string" ||
        !SHA256.test(record.releaseDigest) ||
        (record.activeReleaseDigest !== null &&
          (typeof record.activeReleaseDigest !== "string" ||
            !SHA256.test(record.activeReleaseDigest))) ||
        record.active !== (record.activeReleaseDigest === record.releaseDigest)
      ) {
        throw new Error("Invalid installer target-status response");
      }
      return Object.freeze(record) as unknown as InstallerResponse;
    case "cancel-complete":
      exact(record, ["cancelled", "kind", "requestId", "targetRequestId"]);
      positiveRequestId(record.requestId);
      positiveRequestId(record.targetRequestId);
      if (typeof record.cancelled !== "boolean") {
        throw new Error("Invalid installer cancellation result");
      }
      return Object.freeze(record) as unknown as InstallerResponse;
    case "dispose-complete":
      exact(record, ["kind", "requestId"]);
      positiveRequestId(record.requestId);
      return Object.freeze(record) as unknown as InstallerResponse;
    case "failure":
      exact(record, [
        "code",
        "expectedReleaseDigest",
        "failureClass",
        "failureEvidence",
        "failureSource",
        "kind",
        "message",
        "operation",
        "requestId",
        "resourceId",
      ]);
      positiveRequestId(record.requestId);
      if (
        typeof record.code !== "string" ||
        typeof record.failureClass !== "string" ||
        typeof record.failureEvidence !== "string" ||
        (record.expectedReleaseDigest !== null &&
          (typeof record.expectedReleaseDigest !== "string" ||
            !SHA256.test(record.expectedReleaseDigest))) ||
        (record.failureSource !== "operation" && record.failureSource !== "session") ||
        (record.expectedReleaseDigest !== null &&
          (record.failureSource !== "operation" || record.operation !== "repair")) ||
        (record.failureSource === "operation" &&
          record.operation === "repair" &&
          record.expectedReleaseDigest === null) ||
        typeof record.message !== "string" ||
        typeof record.operation !== "string" ||
        (record.resourceId !== null &&
          (typeof record.resourceId !== "string" || !RESOURCE_ID.test(record.resourceId)))
      ) {
        throw new Error("Invalid installer failure response");
      }
      assertCanonicalInstallerFailureDiagnostic({
        code: record.code as InstallerFailureCode,
        failureClass: record.failureClass as InstallerFailureClass,
        failureEvidence: record.failureEvidence as InstallerFailureEvidence,
        message: record.message,
        operation: record.operation as InstallerFailureOperation,
        resourceId: record.resourceId as string | null,
      });
      return Object.freeze(record) as unknown as InstallerResponse;
    default:
      throw new Error("Unknown installer response kind");
  }
}

export function parseInstallerSnapshot(input: unknown): InstallerSnapshot {
  const record = object(input);
  exact(record, ["installStore", "installerTransfer"]);
  const installStore = parseInstallStoreTelemetrySnapshot(record.installStore);
  const installerTransfer = parseInstallerTransferTelemetry(record.installerTransfer);
  assertExactFinalVerificationTelemetry(installStore, installerTransfer);
  if (
    installerTransfer.state === "ready" &&
    (installerTransfer.activeReleaseDigest === null ||
      installStore.activeReleaseDigest !== installerTransfer.activeReleaseDigest ||
      installerTransfer.finalVerificationPhase !== "complete" ||
      installerTransfer.finalVerificationBytes !== installerTransfer.totalBytes ||
      installerTransfer.finalVerificationResourceCount !== installerTransfer.resourceCount ||
      installerTransfer.finalVerificationTotalBytes !== installerTransfer.totalBytes ||
      installerTransfer.finalVerificationTotalResourceCount !== installerTransfer.resourceCount)
  ) {
    throw new Error(
      "Installer ready telemetry requires exact active selection and complete release totals",
    );
  }
  return Object.freeze({
    installStore,
    installerTransfer,
  });
}

function assertExactFinalVerificationTelemetry(
  installStore: InstallStoreTelemetrySnapshot,
  installerTransfer: InstallerTransferTelemetrySnapshot,
): void {
  for (const key of [
    "finalVerificationBytes",
    "finalVerificationPhase",
    "finalVerificationResourceCount",
    "finalVerificationTotalBytes",
    "finalVerificationTotalResourceCount",
  ] as const) {
    if (installStore[key] !== installerTransfer[key]) {
      throw new Error(`Installer final verification ${key} contradicts the install store`);
    }
  }
}

export function parseInstallerTransferTelemetry(
  input: unknown,
): InstallerTransferTelemetrySnapshot {
  const record = object(input);
  exact(record, [
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
  if (
    record.schemaVersion !== INSTALLER_TRANSFER_TELEMETRY_SCHEMA_VERSION ||
    typeof record.state !== "string" ||
    !new Set<InstallerTransferState>([
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
    ]).has(record.state as InstallerTransferState)
  ) {
    throw new Error("Invalid installer-transfer schema/state");
  }
  for (const key of [
    "activeResourceCount",
    "cancellationCount",
    "checkpointBytes",
    "checkpointedBytes",
    "completedResourceCount",
    "concurrency",
    "downloadedBytes",
    "finalVerificationBytes",
    "finalVerificationResourceCount",
    "finalVerificationTotalBytes",
    "finalVerificationTotalResourceCount",
    "hashedBytes",
    "httpRequestCount",
    "integrityFailureCount",
    "operationRepairAttemptCount",
    "operationRepairedBytes",
    "operationRepairedResourceCount",
    "plannedDownloadBytes",
    "plannedResumeBytes",
    "quotaFailureCount",
    "quotaProbeBytes",
    "quotaRequiredPeakBytes",
    "rangeRequestCount",
    "resourceCount",
    "resumedBytes",
    "retryCount",
    "reusedBytes",
    "totalBytes",
    "transportFailureCount",
    "validatorFailureCount",
    "verifiedBytes",
  ] as const) {
    nonnegativeSafe(record[key]);
  }
  finiteNonnegative(record.lockWaitDurationMs);
  finiteNonnegative(record.operationDurationMs);
  if (
    (record.checkpointBytes as number) <= 0 ||
    (record.concurrency as number) <= 0 ||
    (record.activeResourceCount as number) > (record.concurrency as number)
  ) {
    throw new Error("Invalid installer-transfer policy/progress telemetry");
  }
  nullableRequestId(record.activeRequestId);
  nullableDigest(record.activeReleaseDigest);
  nullableDigest(record.failureExpectedReleaseDigest);
  nullableResourceId(record.activeResourceId);
  nullableResourceId(record.failureResourceId);
  nullableNonnegativeSafe(record.quotaAvailableBytes);
  nullableNonnegativeSafe(record.quotaTotalBytes);
  nullableNonnegativeSafe(record.quotaUsageBytes);
  if (
    (record.failureCode !== null && typeof record.failureCode !== "string") ||
    (record.failureClass !== null && typeof record.failureClass !== "string") ||
    (record.failureEvidence !== null && typeof record.failureEvidence !== "string") ||
    (record.failureSource !== null &&
      record.failureSource !== "operation" &&
      record.failureSource !== "session") ||
    (record.failureMessage !== null && typeof record.failureMessage !== "string") ||
    (record.failureOperation !== null && typeof record.failureOperation !== "string") ||
    (record.persistedState !== null && typeof record.persistedState !== "boolean") ||
    typeof record.quotaProbeCompleted !== "boolean"
  ) {
    throw new Error("Invalid installer-transfer nullable/boolean telemetry");
  }
  if (
    record.failureCode !== null &&
    record.failureClass !== null &&
    record.failureEvidence !== null &&
    record.failureMessage !== null
  ) {
    assertCanonicalInstallerFailureDiagnostic({
      code: record.failureCode as InstallerFailureCode,
      failureClass: record.failureClass as InstallerFailureClass,
      failureEvidence: record.failureEvidence as InstallerFailureEvidence,
      message: record.failureMessage,
      operation: record.failureOperation as InstallerFailureOperation,
      resourceId: record.failureResourceId as string | null,
    });
  }
  const exactLifetimeCompletion =
    ((record.completedResourceCount as number) === (record.resourceCount as number) &&
      (record.verifiedBytes as number) === (record.totalBytes as number)) ||
    ((record.operationRepairAttemptCount as number) > 0 &&
      (record.completedResourceCount as number) === 0 &&
      (record.verifiedBytes as number) === 0);
  if (
    ((record.activeResourceCount as number) === 0 && record.activeResourceId !== null) ||
    (record.failureCode === null) !== (record.failureMessage === null) ||
    (record.failureCode === null) !== (record.failureClass === null) ||
    (record.failureCode === null) !== (record.failureEvidence === null) ||
    (record.failureCode === null) !== (record.failureOperation === null) ||
    (record.failureCode === null) !== (record.failureSource === null) ||
    (record.failureCode === null && record.failureExpectedReleaseDigest !== null) ||
    (record.failureExpectedReleaseDigest !== null &&
      (record.failureSource !== "operation" || record.failureOperation !== "repair")) ||
    (record.failureSource === "operation" &&
      record.failureOperation === "repair" &&
      record.failureExpectedReleaseDigest === null) ||
    (record.failureCode === null && record.failureResourceId !== null) ||
    (record.state === "failed" || record.state === "cancelled") !== (record.failureCode !== null) ||
    (record.state === "cancelled" && record.failureCode !== "cancelled") ||
    (record.quotaProbeCompleted === true && (record.quotaProbeBytes as number) === 0) ||
    (record.finalVerificationPhase !== "idle" &&
      record.finalVerificationPhase !== "verifying" &&
      record.finalVerificationPhase !== "complete") ||
    (record.finalVerificationBytes as number) > (record.finalVerificationTotalBytes as number) ||
    (record.finalVerificationResourceCount as number) >
      (record.finalVerificationTotalResourceCount as number) ||
    (record.finalVerificationPhase === "idle" &&
      ((record.finalVerificationBytes as number) !== 0 ||
        (record.finalVerificationResourceCount as number) !== 0 ||
        (record.finalVerificationTotalBytes as number) !== 0 ||
        (record.finalVerificationTotalResourceCount as number) !== 0)) ||
    (record.finalVerificationPhase === "complete" &&
      ((record.finalVerificationBytes as number) !==
        (record.finalVerificationTotalBytes as number) ||
        (record.finalVerificationResourceCount as number) !==
          (record.finalVerificationTotalResourceCount as number))) ||
    (record.operationRepairedResourceCount as number) >
      (record.operationRepairAttemptCount as number) ||
    ((record.operationRepairAttemptCount as number) === 0 &&
      ((record.operationRepairedResourceCount as number) !== 0 ||
        (record.operationRepairedBytes as number) !== 0)) ||
    ((record.operationRepairedResourceCount as number) === 0 &&
      (record.operationRepairedBytes as number) !== 0) ||
    ((record.operationRepairedResourceCount as number) > 0 &&
      (record.operationRepairedBytes as number) === 0) ||
    ((record.resourceCount as number) > 0 &&
      (record.operationRepairAttemptCount as number) > (record.resourceCount as number)) ||
    (record.operationRepairedBytes as number) > (record.downloadedBytes as number) ||
    (record.operationRepairedBytes as number) > (record.plannedDownloadBytes as number) ||
    // A durable repair admission can be discovered by an earlier worker lifetime.
    // The current operation credits the repair attempt without double-counting that
    // already-retained integrity discovery in this operation's public counter.
    ((record.operationRepairAttemptCount as number) >
      (record.operationRepairedResourceCount as number) &&
      record.state === "failed" &&
      record.failureResourceId === null) ||
    (record.state === "failed" &&
      record.failureCode === "integrity" &&
      (record.integrityFailureCount as number) >
        (record.operationRepairedResourceCount as number) &&
      record.failureResourceId === null) ||
    (record.state === "ready" &&
      ((record.operationRepairAttemptCount as number) !==
        (record.operationRepairedResourceCount as number) ||
        (record.resourceCount as number) === 0 ||
        (record.totalBytes as number) === 0 ||
        !exactLifetimeCompletion ||
        record.finalVerificationPhase !== "complete" ||
        (record.finalVerificationBytes as number) !== (record.totalBytes as number) ||
        (record.finalVerificationResourceCount as number) !== (record.resourceCount as number) ||
        (record.finalVerificationTotalBytes as number) !== (record.totalBytes as number) ||
        (record.finalVerificationTotalResourceCount as number) !==
          (record.resourceCount as number) ||
        safeTelemetryAdd(
          safeTelemetryAdd(record.plannedDownloadBytes, record.plannedResumeBytes),
          record.reusedBytes,
        ) !== record.totalBytes))
  ) {
    throw new Error("Invalid installer-transfer state relationship");
  }
  return Object.freeze(record) as unknown as InstallerTransferTelemetrySnapshot;
}

function safeTelemetryAdd(left: unknown, right: unknown): number {
  const total = (left as number) + (right as number);
  if (!Number.isSafeInteger(total)) {
    throw new Error("Installer telemetry total exceeds safe integer");
  }
  return total;
}

function object(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Installer protocol value must be an object");
  }
  return input as Record<string, unknown>;
}

function exact(record: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error("Installer protocol value has unsupported or missing keys");
  }
}

function positiveRequestId(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error("Installer requestId must be a positive safe integer");
  }
}

function safeShellEntrypointPath(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value === "" ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    !/^[A-Za-z0-9._/-]+$/.test(value) ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error("Installer shell entrypoint path is unsafe");
  }
}

function nullableRequestId(value: unknown): void {
  if (value !== null) positiveRequestId(value);
}

function nonnegativeSafe(value: unknown): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("Installer telemetry integer must be non-negative and safe");
  }
}

function nullableNonnegativeSafe(value: unknown): void {
  if (value !== null) nonnegativeSafe(value);
}

function finiteNonnegative(value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Installer telemetry duration must be finite and non-negative");
  }
}

function nullableDigest(value: unknown): void {
  if (value !== null && (typeof value !== "string" || !SHA256.test(value))) {
    throw new Error("Installer telemetry digest is invalid");
  }
}

function digest(value: unknown): void {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error("Invalid installer release digest");
  }
}

function nullableResourceId(value: unknown): void {
  if (value !== null && (typeof value !== "string" || !RESOURCE_ID.test(value))) {
    throw new Error("Installer telemetry resource ID is invalid");
  }
}
