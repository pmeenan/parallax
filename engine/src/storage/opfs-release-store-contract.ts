import { assertUnicodeScalarString, compareUnicodeScalars } from "../core/unicode-scalar-order";
import { INSTALL_MANIFEST_SCHEMA_VERSION, type InstallResourceScope } from "./install-manifest";

export const INSTALL_STORE_ROOT = "parallax-install-v1";
export const INSTALL_STORE_LOCK_NAME = "parallax-install-store-v1";
export const INSTALL_STORE_TELEMETRY_SCHEMA_VERSION = 3;
export const STRONG_ETAG_MAX_QDTEXT_CHARS = 1024;

export class InstallStoreLockTimeoutError extends Error {
  public constructor() {
    super("Install-store lock acquisition timed out");
    this.name = "InstallStoreLockTimeoutError";
  }
}

export class InstallStoreIntegrityError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InstallStoreIntegrityError";
  }
}

export type InstallStoreState =
  | "failed"
  | "garbage-collecting"
  | "idle"
  | "publishing"
  | "ready"
  | "reconciling"
  | "staging"
  | "unavailable"
  | "verifying"
  | "writing";

export type InstallStoreFinalVerificationPhase = "complete" | "idle" | "verifying";

export interface InstallStoreTelemetrySnapshot {
  readonly activeReleaseDigest: string | null;
  readonly currentReleaseDigest: string | null;
  readonly currentResourceId: string | null;
  readonly currentCheckpointCount: number;
  readonly etagBoundPartialCount: number;
  readonly failureMessage: string | null;
  readonly finalVerificationBytes: number;
  readonly finalVerificationPhase: InstallStoreFinalVerificationPhase;
  readonly finalVerificationResourceCount: number;
  readonly finalVerificationTotalBytes: number;
  readonly finalVerificationTotalResourceCount: number;
  readonly garbageCollectedBytes: number;
  readonly garbageCollectedEntries: number;
  readonly garbageCollectionRemaining: boolean;
  readonly hashedBytes: number;
  readonly integrityFailures: number;
  readonly lastOperationDurationMs: number;
  readonly partialBytes: number;
  readonly partialResourceCount: number;
  readonly previousReleaseDigest: string | null;
  readonly publicationCount: number;
  readonly checkpointWriteCount: number;
  readonly quotaExceededCount: number;
  readonly readyReleaseCount: number;
  readonly reconciliationCount: number;
  readonly recoveryCount: number;
  readonly resumedBytes: number;
  readonly reusedBytes: number;
  readonly rollbackCount: number;
  readonly schemaVersion: typeof INSTALL_STORE_TELEMETRY_SCHEMA_VERSION;
  readonly stagedReleaseCount: number;
  readonly state: InstallStoreState;
  readonly verifiedObjectBytes: number;
  readonly verifiedObjectCount: number;
  readonly writtenBytes: number;
}

export interface VerifiedObjectRecord {
  readonly bytes: number;
  readonly schemaVersion: 1;
  readonly scope: Exclude<InstallResourceScope, "app-shell">;
  readonly sha256: string;
}

export interface PartialCheckpointRecord {
  readonly bytesCommitted: number;
  readonly expectedBytes: number;
  readonly expectedSha256: string;
  readonly releaseDigest: string;
  readonly resourceId: string;
  readonly schemaVersion: 2;
  readonly source: string;
  readonly strongEtag: string;
}

export interface ReleaseStagedRecord {
  readonly gameId: "parallax";
  readonly installManifestSchemaVersion: typeof INSTALL_MANIFEST_SCHEMA_VERSION;
  readonly releaseDigest: string;
  readonly schemaVersion: 1;
}

export interface ReleaseReadyRecord {
  readonly opfsBytes: number;
  readonly opfsResourceCount: number;
  readonly releaseDigest: string;
  readonly schemaVersion: 1;
}

export interface ReleaseCommitRecord {
  readonly ordinal: number;
  readonly releaseDigest: string;
  readonly schemaVersion: 1;
}

export interface ReleaseAbandonedRecord {
  readonly releaseDigest: string;
  readonly schemaVersion: 1;
}

export interface ReleasePublishedRecord {
  readonly releaseDigest: string;
  readonly schemaVersion: 1;
}

export interface ReleaseRepairEligibilityRecord {
  readonly bytes: number;
  readonly commitOrdinal: number;
  readonly commitRecordSha256: string;
  readonly observedBytes: number;
  readonly observedSha256: string;
  readonly publishedRecordSha256: string;
  readonly readyRecordSha256: string;
  readonly releaseDigest: string;
  readonly resourceId: string;
  readonly schemaVersion: 2;
  readonly scope: Exclude<InstallResourceScope, "app-shell">;
  readonly sha256: string;
  readonly verifiedRecordSha256: string;
}

export type InstallStoreRecord =
  | PartialCheckpointRecord
  | ReleaseAbandonedRecord
  | ReleaseCommitRecord
  | ReleasePublishedRecord
  | ReleaseRepairEligibilityRecord
  | ReleaseReadyRecord
  | ReleaseStagedRecord
  | VerifiedObjectRecord;

const SHA256 = /^[a-f0-9]{64}$/;
const RESOURCE_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const INSTALL_STORE_TELEMETRY_KEYS = Object.freeze([
  "activeReleaseDigest",
  "checkpointWriteCount",
  "currentCheckpointCount",
  "currentReleaseDigest",
  "currentResourceId",
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
] as const);
const INSTALL_STORE_COUNTER_KEYS = Object.freeze([
  "checkpointWriteCount",
  "currentCheckpointCount",
  "etagBoundPartialCount",
  "finalVerificationBytes",
  "finalVerificationResourceCount",
  "finalVerificationTotalBytes",
  "finalVerificationTotalResourceCount",
  "garbageCollectedBytes",
  "garbageCollectedEntries",
  "hashedBytes",
  "integrityFailures",
  "partialBytes",
  "partialResourceCount",
  "publicationCount",
  "quotaExceededCount",
  "readyReleaseCount",
  "reconciliationCount",
  "recoveryCount",
  "resumedBytes",
  "reusedBytes",
  "rollbackCount",
  "stagedReleaseCount",
  "verifiedObjectBytes",
  "verifiedObjectCount",
  "writtenBytes",
] as const);
const INSTALL_STORE_STATES: ReadonlySet<string> = new Set([
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
const FINAL_VERIFICATION_PHASES: ReadonlySet<string> = new Set(["complete", "idle", "verifying"]);

export function parseVerifiedObjectRecord(input: unknown): VerifiedObjectRecord {
  const record = exact(input, ["bytes", "schemaVersion", "scope", "sha256"]);
  positiveSafe(record.bytes, "verified object bytes");
  if (
    record.schemaVersion !== 1 ||
    (record.scope !== "common" && record.scope !== "game-specific") ||
    !digest(record.sha256)
  ) {
    throw new Error("Invalid verified-object@1 record");
  }
  return Object.freeze(record as unknown as VerifiedObjectRecord);
}

export function parsePartialCheckpointRecord(input: unknown): PartialCheckpointRecord {
  const record = exact(input, [
    "bytesCommitted",
    "expectedBytes",
    "expectedSha256",
    "releaseDigest",
    "resourceId",
    "schemaVersion",
    "source",
    "strongEtag",
  ]);
  nonnegativeSafe(record.bytesCommitted, "checkpoint bytesCommitted");
  positiveSafe(record.expectedBytes, "checkpoint expectedBytes");
  if (
    (record.bytesCommitted as number) > (record.expectedBytes as number) ||
    record.schemaVersion !== 2 ||
    !digest(record.expectedSha256) ||
    !digest(record.releaseDigest) ||
    typeof record.resourceId !== "string" ||
    !RESOURCE_ID.test(record.resourceId) ||
    typeof record.source !== "string" ||
    record.source.length === 0 ||
    typeof record.strongEtag !== "string" ||
    !isStrongEtag(record.strongEtag)
  ) {
    throw new Error("Invalid partial-checkpoint@2 record");
  }
  return Object.freeze(record as unknown as PartialCheckpointRecord);
}

export function parseInstallStoreTelemetrySnapshot(input: unknown): InstallStoreTelemetrySnapshot {
  const record = exact(input, INSTALL_STORE_TELEMETRY_KEYS);
  if (
    record.schemaVersion !== INSTALL_STORE_TELEMETRY_SCHEMA_VERSION ||
    typeof record.state !== "string" ||
    !INSTALL_STORE_STATES.has(record.state) ||
    typeof record.finalVerificationPhase !== "string" ||
    !FINAL_VERIFICATION_PHASES.has(record.finalVerificationPhase)
  ) {
    throw new Error("Invalid install-store telemetry schema/state");
  }
  for (const key of INSTALL_STORE_COUNTER_KEYS) {
    nonnegativeSafe(record[key], `install-store telemetry ${key}`);
  }
  finiteNonnegative(record.lastOperationDurationMs, "install-store telemetry duration");
  if (typeof record.garbageCollectionRemaining !== "boolean") {
    throw new Error("Invalid install-store telemetry garbage-collection state");
  }
  for (const key of [
    "activeReleaseDigest",
    "currentReleaseDigest",
    "previousReleaseDigest",
  ] as const) {
    if (record[key] !== null && !digest(record[key])) {
      throw new Error(`Invalid install-store telemetry ${key}`);
    }
  }
  if (
    record.currentResourceId !== null &&
    (typeof record.currentResourceId !== "string" || !RESOURCE_ID.test(record.currentResourceId))
  ) {
    throw new Error("Invalid install-store telemetry currentResourceId");
  }
  if (
    record.failureMessage !== null &&
    (typeof record.failureMessage !== "string" || record.failureMessage.length === 0)
  ) {
    throw new Error("Invalid install-store telemetry failureMessage");
  }
  if (
    record.state === "unavailable" &&
    (record.activeReleaseDigest !== null ||
      record.currentReleaseDigest !== null ||
      record.currentResourceId !== null ||
      record.failureMessage !== null ||
      record.finalVerificationPhase !== "idle" ||
      record.previousReleaseDigest !== null ||
      record.garbageCollectionRemaining !== false ||
      record.lastOperationDurationMs !== 0 ||
      INSTALL_STORE_COUNTER_KEYS.some((key) => record[key] !== 0))
  ) {
    throw new Error("Unavailable install-store telemetry must not claim store observations");
  }
  if (
    (record.currentResourceId !== null && record.currentReleaseDigest === null) ||
    (record.state === "failed") !== (record.failureMessage !== null) ||
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
          (record.finalVerificationTotalResourceCount as number)))
  ) {
    throw new Error("Invalid install-store telemetry state relationship");
  }
  return Object.freeze(record as unknown as InstallStoreTelemetrySnapshot);
}

export function parseReleaseStagedRecord(input: unknown): ReleaseStagedRecord {
  const record = exact(input, [
    "gameId",
    "installManifestSchemaVersion",
    "releaseDigest",
    "schemaVersion",
  ]);
  if (
    record.gameId !== "parallax" ||
    record.installManifestSchemaVersion !== INSTALL_MANIFEST_SCHEMA_VERSION ||
    !digest(record.releaseDigest) ||
    record.schemaVersion !== 1
  ) {
    throw new Error("Invalid release-staged@1 record");
  }
  return Object.freeze(record as unknown as ReleaseStagedRecord);
}

export function parseReleaseReadyRecord(input: unknown): ReleaseReadyRecord {
  const record = exact(input, ["opfsBytes", "opfsResourceCount", "releaseDigest", "schemaVersion"]);
  nonnegativeSafe(record.opfsBytes, "ready opfsBytes");
  nonnegativeSafe(record.opfsResourceCount, "ready opfsResourceCount");
  if (!digest(record.releaseDigest) || record.schemaVersion !== 1) {
    throw new Error("Invalid release-ready@1 record");
  }
  return Object.freeze(record as unknown as ReleaseReadyRecord);
}

export function parseReleaseCommitRecord(input: unknown): ReleaseCommitRecord {
  const record = exact(input, ["ordinal", "releaseDigest", "schemaVersion"]);
  positiveSafe(record.ordinal, "commit ordinal");
  if (!digest(record.releaseDigest) || record.schemaVersion !== 1) {
    throw new Error("Invalid release-commit@1 record");
  }
  return Object.freeze(record as unknown as ReleaseCommitRecord);
}

export function parseReleaseAbandonedRecord(input: unknown): ReleaseAbandonedRecord {
  const record = exact(input, ["releaseDigest", "schemaVersion"]);
  if (!digest(record.releaseDigest) || record.schemaVersion !== 1) {
    throw new Error("Invalid release-abandoned@1 record");
  }
  return Object.freeze(record as unknown as ReleaseAbandonedRecord);
}

export function parseReleasePublishedRecord(input: unknown): ReleasePublishedRecord {
  const record = exact(input, ["releaseDigest", "schemaVersion"]);
  if (!digest(record.releaseDigest) || record.schemaVersion !== 1) {
    throw new Error("Invalid release-published@1 record");
  }
  return Object.freeze(record as unknown as ReleasePublishedRecord);
}

export function parseReleaseRepairEligibilityRecord(
  input: unknown,
): ReleaseRepairEligibilityRecord {
  const record = exact(input, [
    "bytes",
    "commitOrdinal",
    "commitRecordSha256",
    "observedBytes",
    "observedSha256",
    "publishedRecordSha256",
    "readyRecordSha256",
    "releaseDigest",
    "resourceId",
    "schemaVersion",
    "scope",
    "sha256",
    "verifiedRecordSha256",
  ]);
  positiveSafe(record.bytes, "repair eligibility bytes");
  positiveSafe(record.commitOrdinal, "repair eligibility commit ordinal");
  nonnegativeSafe(record.observedBytes, "repair eligibility observed bytes");
  if (
    !digest(record.commitRecordSha256) ||
    !digest(record.observedSha256) ||
    !digest(record.publishedRecordSha256) ||
    !digest(record.readyRecordSha256) ||
    !digest(record.releaseDigest) ||
    typeof record.resourceId !== "string" ||
    !RESOURCE_ID.test(record.resourceId) ||
    record.schemaVersion !== 2 ||
    (record.scope !== "common" && record.scope !== "game-specific") ||
    !digest(record.sha256) ||
    !digest(record.verifiedRecordSha256) ||
    (record.observedBytes === record.bytes && record.observedSha256 === record.sha256)
  ) {
    throw new Error("Invalid release-repair-eligibility@2 record");
  }
  return Object.freeze(record as unknown as ReleaseRepairEligibilityRecord);
}

export function serializeInstallStoreRecord(record: InstallStoreRecord): Uint8Array {
  return new TextEncoder().encode(`${canonicalInstallStoreRecord(record)}\n`);
}

export function canonicalInstallStoreRecord(record: InstallStoreRecord): string {
  const entries = Object.entries(record);
  for (const [key, value] of entries) {
    assertUnicodeScalarString(key);
    if (typeof value === "string") assertUnicodeScalarString(value);
  }
  entries.sort(([left], [right]) => compareUnicodeScalars(left, right));
  return JSON.stringify(Object.fromEntries(entries));
}

export function parseJsonRecord<T>(bytes: Uint8Array, parse: (input: unknown) => T): T {
  if (bytes.byteLength === 0) throw new Error("Empty install-store record");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!text.endsWith("\n")) throw new Error("Install-store records must end with a newline");
  return parse(JSON.parse(text));
}

export function isInstallStoreDigest(value: string): boolean {
  return SHA256.test(value);
}

export function isStrongEtag(value: string): boolean {
  if (
    value.length < 3 ||
    value.length > STRONG_ETAG_MAX_QDTEXT_CHARS + 2 ||
    value.charCodeAt(0) !== 0x22 ||
    value.charCodeAt(value.length - 1) !== 0x22
  ) {
    return false;
  }
  for (let index = 1; index < value.length - 1; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code !== 0x09 &&
      code !== 0x20 &&
      code !== 0x21 &&
      !(code >= 0x23 && code <= 0x5b) &&
      !(code >= 0x5d && code <= 0x7e)
    ) {
      return false;
    }
  }
  return true;
}

export function formatInstallStoreOrdinal(value: number): string {
  positiveSafe(value, "commit ordinal");
  const text = String(value);
  if (text.length > 20) throw new Error("Commit ordinal exceeds the 20-digit namespace");
  return text.padStart(20, "0");
}

function exact(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Install-store record must be an object");
  }
  const record = input as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error("Install-store record has unsupported or missing keys");
  }
  return record;
}

function digest(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function positiveSafe(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`Invalid ${label}`);
}

function nonnegativeSafe(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`Invalid ${label}`);
}

function finiteNonnegative(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${label}`);
  }
}
