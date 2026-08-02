import { INSTALL_STORE_TELEMETRY_SCHEMA_VERSION } from "@parallax/engine";

const KEYS = Object.freeze([
  "activeReleaseDigest",
  "currentReleaseDigest",
  "currentResourceId",
  "currentCheckpointCount",
  "etagBoundPartialCount",
  "failureMessage",
  "finalVerificationBytes",
  "finalVerificationPhase",
  "finalVerificationResourceCount",
  "finalVerificationTotalBytes",
  "finalVerificationTotalResourceCount",
  "garbageCollectedBytes",
  "garbageCollectedEntries",
  "garbageCollectionRemaining",
  "hashedBytes",
  "integrityFailures",
  "lastOperationDurationMs",
  "partialBytes",
  "partialResourceCount",
  "previousReleaseDigest",
  "publicationCount",
  "checkpointWriteCount",
  "quotaExceededCount",
  "readyReleaseCount",
  "reconciliationCount",
  "recoveryCount",
  "resumedBytes",
  "reusedBytes",
  "rollbackCount",
  "schemaVersion",
  "stagedReleaseCount",
  "state",
  "verifiedObjectBytes",
  "verifiedObjectCount",
  "writtenBytes",
]);
const COUNTERS = KEYS.filter(
  (key) =>
    ![
      "activeReleaseDigest",
      "currentReleaseDigest",
      "currentResourceId",
      "failureMessage",
      "finalVerificationPhase",
      "garbageCollectionRemaining",
      "lastOperationDurationMs",
      "previousReleaseDigest",
      "schemaVersion",
      "state",
    ].includes(key),
);
const STATES = new Set([
  "failed",
  "garbage-collecting",
  "idle",
  "publishing",
  "ready",
  "reconciling",
  "staging",
  "unavailable",
  "verifying",
  "writing",
]);
const SHA256 = /^[a-f0-9]{64}$/;
const RESOURCE_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;

export interface InstallStoreTelemetryProjection {
  readonly activeReleaseDigest: string | null;
  readonly currentReleaseDigest: string | null;
  readonly currentResourceId: string | null;
  readonly failureMessage: string | null;
  readonly state: string;
}

export function validateInstallStoreTelemetryProjection(
  input: unknown,
): InstallStoreTelemetryProjection {
  if (!isRecord(input)) throw new Error("installStore telemetry projection must be an object");
  const projectionKeys = [
    "activeReleaseDigest",
    "currentReleaseDigest",
    "currentResourceId",
    "failureMessage",
    "state",
  ];
  const actual = Object.keys(input).sort();
  const expected = [...projectionKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error("installStore telemetry projection has unsupported or missing keys");
  }
  if (typeof input.state !== "string" || !STATES.has(input.state)) {
    throw new Error("installStore telemetry projection has an unsupported state");
  }
  for (const key of ["activeReleaseDigest", "currentReleaseDigest"] as const) {
    if (input[key] !== null && (typeof input[key] !== "string" || !SHA256.test(input[key]))) {
      throw new Error(`installStore telemetry projection ${key} is invalid`);
    }
  }
  if (
    input.currentResourceId !== null &&
    (typeof input.currentResourceId !== "string" || !RESOURCE_ID.test(input.currentResourceId))
  ) {
    throw new Error("installStore telemetry projection currentResourceId is invalid");
  }
  if (
    input.failureMessage !== null &&
    (typeof input.failureMessage !== "string" || input.failureMessage.length === 0)
  ) {
    throw new Error("installStore telemetry projection failureMessage is invalid");
  }
  if (
    (input.currentResourceId !== null && input.currentReleaseDigest === null) ||
    (input.state === "failed") !== (input.failureMessage !== null) ||
    (input.state === "unavailable" &&
      (input.activeReleaseDigest !== null ||
        input.currentReleaseDigest !== null ||
        input.currentResourceId !== null))
  ) {
    throw new Error("installStore telemetry projection has inconsistent state fields");
  }
  return input as unknown as InstallStoreTelemetryProjection;
}

export function validateInstallStoreTelemetrySnapshot(input: unknown): void {
  if (!isRecord(input)) throw new Error("installStore telemetry must be an object");
  const actual = Object.keys(input).sort();
  const expected = [...KEYS].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error("installStore telemetry v3 has unsupported or missing keys");
  }
  if (
    input.schemaVersion !== INSTALL_STORE_TELEMETRY_SCHEMA_VERSION ||
    typeof input.state !== "string" ||
    !STATES.has(input.state) ||
    (input.finalVerificationPhase !== "idle" &&
      input.finalVerificationPhase !== "verifying" &&
      input.finalVerificationPhase !== "complete")
  ) {
    throw new Error("installStore telemetry has an unsupported schema/state");
  }
  for (const key of COUNTERS) {
    const value = input[key];
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      throw new Error(`installStore telemetry ${key} must be a non-negative safe integer`);
    }
  }
  if (
    typeof input.lastOperationDurationMs !== "number" ||
    !Number.isFinite(input.lastOperationDurationMs) ||
    input.lastOperationDurationMs < 0 ||
    typeof input.garbageCollectionRemaining !== "boolean"
  ) {
    throw new Error("installStore telemetry has invalid duration/GC state");
  }
  for (const key of ["activeReleaseDigest", "currentReleaseDigest", "previousReleaseDigest"]) {
    const value = input[key];
    if (value !== null && (typeof value !== "string" || !SHA256.test(value))) {
      throw new Error(`installStore telemetry ${key} must be null or a lower-case SHA-256`);
    }
  }
  if (
    input.currentResourceId !== null &&
    (typeof input.currentResourceId !== "string" || !RESOURCE_ID.test(input.currentResourceId))
  ) {
    throw new Error("installStore telemetry currentResourceId must be null or a resource ID");
  }
  if (
    input.failureMessage !== null &&
    (typeof input.failureMessage !== "string" || input.failureMessage.length === 0)
  ) {
    throw new Error("installStore telemetry failureMessage must be null or a string");
  }
  if (
    input.state === "unavailable" &&
    (input.activeReleaseDigest !== null ||
      input.currentReleaseDigest !== null ||
      input.currentResourceId !== null ||
      input.failureMessage !== null ||
      input.finalVerificationPhase !== "idle" ||
      input.previousReleaseDigest !== null ||
      input.garbageCollectionRemaining !== false ||
      input.lastOperationDurationMs !== 0 ||
      COUNTERS.some((key) => input[key] !== 0))
  ) {
    throw new Error("unavailable installStore telemetry must not claim store observations");
  }
  if (
    (input.currentResourceId !== null && input.currentReleaseDigest === null) ||
    (input.state === "failed") !== (input.failureMessage !== null) ||
    (input.finalVerificationBytes as number) > (input.finalVerificationTotalBytes as number) ||
    (input.finalVerificationResourceCount as number) >
      (input.finalVerificationTotalResourceCount as number) ||
    (input.finalVerificationPhase === "idle" &&
      ((input.finalVerificationBytes as number) !== 0 ||
        (input.finalVerificationResourceCount as number) !== 0 ||
        (input.finalVerificationTotalBytes as number) !== 0 ||
        (input.finalVerificationTotalResourceCount as number) !== 0)) ||
    (input.finalVerificationPhase === "complete" &&
      ((input.finalVerificationBytes as number) !== (input.finalVerificationTotalBytes as number) ||
        (input.finalVerificationResourceCount as number) !==
          (input.finalVerificationTotalResourceCount as number)))
  ) {
    throw new Error("installStore telemetry has inconsistent state fields");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
