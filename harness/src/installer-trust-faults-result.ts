import { createHash } from "node:crypto";
import {
  INSTALL_RESOURCE_PLACEMENTS,
  type InstallerFailureCode,
  type InstallerSnapshot,
} from "@parallax/engine";
import { canonicalJson } from "./canonical-json.js";
import { validateInstallerSnapshotTelemetry } from "./installer-transfer-telemetry.js";
import {
  INSTALLER_TRUST_FAULT_TRANSITION_PROOF_LEGACY_SCHEMA_VERSION,
  INSTALLER_TRUST_FAULT_TRANSITION_PROOF_PREVIOUS_SCHEMA_VERSION,
  INSTALLER_TRUST_FAULT_TRANSITION_PROOF_SCHEMA_VERSION,
  type InstallerTrustFaultTransitionProof,
  type InstallerTrustFaultTransitionProofEvidence,
  type InstallerTrustFaultTransitionProofV1,
  validateInstallerTrustFaultRawTransitionProof,
  validateInstallerTrustFaultTransitionProof,
} from "./installer-trust-faults-transition-proof.js";
import {
  INSTALLER_TRUST_FAULT_MAX_ATTEMPT_MILESTONES,
  type InstallerTrustFaultLegacyTransitions,
  type InstallerTrustFaultTransition,
  installerTrustFaultTransitionSemanticKey,
  projectInstallerTrustFaultAttemptMilestones,
  validateCanonicalInstallerTrustFaultTransitions,
} from "./installer-trust-faults-transitions.js";
import type { SourceIdentity } from "./source-identity.js";

export const INSTALLER_TRUST_FAULTS_CONTRACT = "installer-trust-faults@1";
export const INSTALLER_TRUST_FAULTS_LEGACY_SCHEMA_VERSION = 1;
export const INSTALLER_TRUST_FAULTS_PREVIOUS_SCHEMA_VERSION = 2;
export const INSTALLER_TRUST_FAULTS_PROOF_SCHEMA_VERSION = 3;
export const INSTALLER_TRUST_FAULTS_PERSISTENCE_SCHEMA_VERSION = 4;
export const INSTALLER_TRUST_FAULTS_SCHEMA_VERSION = 5;

export type InstallerTrustFaultResultProofSemantics =
  | "active-raw"
  | "historical-active-raw-v2"
  | "historical-closed-world-v2"
  | "legacy-closed-world";
export type InstallerTrustFaultTransferTelemetrySchemaVersion = 6 | 7 | 8 | 9;

export const INSTALLER_TRUST_FAULT_CELL_IDS = Object.freeze([
  "reused-object-corruption",
  "final-verification-corruption",
  "repeated-server-corruption",
  "estimate-clearly-insufficient",
  "estimate-incomplete-probe-success",
  "quota-probe-exceeded",
  "mid-append-quota-resume",
  "persistence-denied",
] as const);
export const INSTALLER_TRUST_FAULT_CHECKPOINT_BYTES = 8 * 1024 * 1024;

export type InstallerTrustFaultCellId = (typeof INSTALLER_TRUST_FAULT_CELL_IDS)[number];
export type InstallerTrustFaultMutationScope =
  | "external-root"
  | "indexeddb"
  | "install-root"
  | "saves"
  | "selection"
  | "shell-cache";

export interface InstallerTrustFaultScopedInventory {
  readonly entries: readonly string[];
  readonly sha256: string;
}

export interface InstallerTrustFaultAuthority {
  readonly artifactDigest: string;
  readonly browser: Readonly<{
    readonly executableSha256: string;
    readonly product: string;
    readonly revision: string;
    readonly sandboxed: true;
    readonly version: string;
  }>;
  readonly buildManifestBase64url: string;
  readonly buildManifestSha256: string;
  readonly environment: Readonly<{
    readonly gateState: "valid";
    readonly machineId: "dev-01";
    readonly physicalConsole: true;
    readonly profileIsolation: "fresh-disposable-per-cell";
    readonly tier: "showcase";
  }>;
  readonly installManifestBase64url: string;
  readonly installManifestSha256: string;
  readonly releaseDigest: string;
  readonly source: SourceIdentity;
}

export interface InstallerTrustFaultManifestResource {
  readonly bytes: number;
  readonly id: string;
  readonly kind:
    | "asset-pack"
    | "district-index"
    | "document"
    | "model"
    | "module"
    | "wasm"
    | "worker"
    | "world-cell";
  readonly path: string;
  readonly scope: "app-shell" | "common" | "game-specific";
  readonly sha256: string;
  readonly source: string;
  readonly target: "opfs" | "shell";
}

interface ValidatedInstallerTrustFaultAuthority {
  readonly authority: InstallerTrustFaultAuthority;
  readonly resourceById: ReadonlyMap<string, InstallerTrustFaultManifestResource>;
  readonly resourceByPath: ReadonlyMap<string, InstallerTrustFaultManifestResource>;
  readonly resources: readonly InstallerTrustFaultManifestResource[];
}

export interface InstallerTrustFaultCell<TTransitions = InstallerTrustFaultLegacyTransitions> {
  readonly accounting: Readonly<{
    readonly checkpointedBytes: number;
    readonly downloadedBytes: number;
    readonly lifetimeCheckpointedBytes: number;
    readonly lifetimeDownloadedBytes: number;
    readonly readyBytes: number;
    readonly repairedBytes: number;
    readonly repairedResourceCount: number;
    readonly resumedBytes: number;
    readonly reusedBytes: number;
    readonly totalBytes: number;
  }>;
  readonly attempts: readonly Readonly<{
    readonly action: "none" | "repair" | "retry";
    readonly failureCode: InstallerFailureCode | null;
    readonly failureResourceId: string | null;
    readonly index: number;
    readonly networkRetryCount: number;
    readonly outcome: "failed" | "passed";
    readonly transitions: readonly string[];
  }>[];
  readonly cleanup: Readonly<{
    readonly faultHooksCleared: true;
    readonly profileRemoved: true;
    readonly serverStopped: true;
  }>;
  readonly completedAt: string;
  readonly fault: Readonly<{
    readonly events: readonly Readonly<{
      readonly nonce: string;
      readonly offset: number;
      readonly operation: "install" | "repair";
      readonly order: number;
      readonly releaseDigest: string;
      readonly resourceId: string;
    }>[];
    readonly kind:
      | "corrupt-final-object"
      | "corrupt-reused-object"
      | "corrupt-server-representation"
      | "estimate-insufficient"
      | "estimate-incomplete"
      | "mid-append-quota"
      | "persistence-denied"
      | "quota-probe";
    readonly nonce: string;
    readonly offset: number;
    readonly releaseDigest: string;
    readonly resourceId: string;
    readonly useCount: 1;
  }>;
  readonly http: readonly Readonly<{
    readonly attempt: 0 | 1 | 2;
    readonly bodyBytes: number;
    readonly etag: string | null;
    readonly ifRange: string | null;
    readonly method: string;
    readonly order: number;
    readonly path: string;
    readonly phase: "attempt-1" | "attempt-2" | "seed" | "setup";
    readonly range: string | null;
    readonly status: number;
  }>[];
  readonly httpSummary: Readonly<{
    readonly bodyBytes: number;
    readonly responseCount: number;
    readonly sha256: string;
  }>;
  readonly id: InstallerTrustFaultCellId;
  readonly postValidation: Readonly<{
    readonly activeReleaseDigest: string | null;
    readonly externalRootSentinelSha256: string;
    readonly launchEnabled: boolean;
    readonly operationInitialActiveReleaseDigest: string | null;
    readonly operationInitialPreviousReleaseDigest: string | null;
    readonly operationInitialPublicationCount: number;
    readonly mutationEvidence: Readonly<{
      readonly declaredMutableScopes: readonly InstallerTrustFaultMutationScope[];
      readonly post: Readonly<
        Record<InstallerTrustFaultMutationScope, InstallerTrustFaultScopedInventory>
      >;
      readonly pre: Readonly<
        Record<InstallerTrustFaultMutationScope, InstallerTrustFaultScopedInventory>
      >;
      readonly unexpectedChangedScopes: readonly InstallerTrustFaultMutationScope[];
    }>;
    readonly previousReleaseDigest: string | null;
    readonly publicationOccurred: boolean;
    readonly saveSentinelSha256: string;
    readonly targetReleaseDigest: string;
    readonly terminalPublicationCount: number;
    readonly uiReleaseDigest: string | null;
    readonly uiShellGenerationId: string | null;
  }>;
  readonly profileId: string;
  readonly snapshots: readonly InstallerSnapshot[];
  readonly startedAt: string;
  readonly transitions: TTransitions;
  readonly warning: "degraded-durability" | null;
}

export interface InstallerTrustFaultPersistenceRequest {
  readonly attempt: 1 | 2;
  readonly classification: "already-persisted" | "denied" | "granted";
  readonly operation: "install" | "repair";
  readonly order: number;
  readonly persistedAfter: boolean;
  readonly persistedBefore: boolean;
  readonly phase: "attempt-1" | "attempt-2" | "seed";
  readonly requestedUiState: "requesting";
  readonly result: boolean;
  readonly terminalUiState: "denied" | "granted";
  readonly warning: "degraded-durability" | null;
}

export interface InstallerTrustFaultPersistenceEvidence {
  readonly initialPersisted: boolean;
  readonly requests: readonly InstallerTrustFaultPersistenceRequest[];
}

export type InstallerTrustFaultCellV2 =
  InstallerTrustFaultCell<InstallerTrustFaultTransitionProofV1>;
export type InstallerTrustFaultCellV3 = InstallerTrustFaultCell<InstallerTrustFaultTransitionProof>;
export type InstallerTrustFaultCellV4 = InstallerTrustFaultCellV3 &
  Readonly<{ persistence: InstallerTrustFaultPersistenceEvidence }>;
export type InstallerTrustFaultCellV5 = InstallerTrustFaultCellV4;
export type InstallerTrustFaultCellEvidence =
  | InstallerTrustFaultCell
  | InstallerTrustFaultCellV2
  | InstallerTrustFaultCellV3
  | InstallerTrustFaultCellV4
  | InstallerTrustFaultCellV5;

export interface InstallerTrustFaultsResult<
  TCell extends InstallerTrustFaultCellEvidence = InstallerTrustFaultCell,
> {
  readonly authority: InstallerTrustFaultAuthority;
  readonly cells: readonly TCell[];
  readonly completedAt: string;
  readonly contract: typeof INSTALLER_TRUST_FAULTS_CONTRACT;
  readonly passed: boolean;
  readonly schemaVersion:
    | typeof INSTALLER_TRUST_FAULTS_LEGACY_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULTS_PREVIOUS_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULTS_PROOF_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULTS_PERSISTENCE_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULTS_SCHEMA_VERSION;
  readonly startedAt: string;
}

export type InstallerTrustFaultsResultV2 = InstallerTrustFaultsResult<InstallerTrustFaultCellV2>;
export type InstallerTrustFaultsResultV3 = InstallerTrustFaultsResult<InstallerTrustFaultCellV3>;
export type InstallerTrustFaultsResultV4 = InstallerTrustFaultsResult<InstallerTrustFaultCellV4>;
export type InstallerTrustFaultsResultV5 = InstallerTrustFaultsResult<InstallerTrustFaultCellV5>;
export type InstallerTrustFaultsResultEvidence =
  | InstallerTrustFaultsResult
  | InstallerTrustFaultsResultV2
  | InstallerTrustFaultsResultV3
  | InstallerTrustFaultsResultV4
  | InstallerTrustFaultsResultV5;

const SHA256 = /^[a-f0-9]{64}$/u;
const NONCE = /^[A-Za-z0-9_-]{32,128}$/u;
const RESOURCE_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u;
const RETAINED_RESOURCE_PLACEMENTS: ReadonlySet<string> = new Set(INSTALL_RESOURCE_PLACEMENTS);
const SUCCESS_CELLS = new Set<InstallerTrustFaultCellId>([
  "reused-object-corruption",
  "final-verification-corruption",
  "estimate-incomplete-probe-success",
  "mid-append-quota-resume",
  "persistence-denied",
]);
const INSTALLER_TRUST_FAULT_OPERATION_CONTRACT: Readonly<
  Record<
    InstallerTrustFaultCellId,
    Readonly<{
      attempt: 1 | 2;
      operation: "install" | "repair";
      outcome: "failed" | "passed";
      phase: "attempt-1" | "attempt-2";
    }>
  >
> = Object.freeze({
  "estimate-clearly-insufficient": Object.freeze({
    attempt: 1,
    operation: "install",
    outcome: "failed",
    phase: "attempt-1",
  }),
  "estimate-incomplete-probe-success": Object.freeze({
    attempt: 1,
    operation: "install",
    outcome: "passed",
    phase: "attempt-1",
  }),
  "final-verification-corruption": Object.freeze({
    attempt: 1,
    operation: "repair",
    outcome: "passed",
    phase: "attempt-1",
  }),
  "mid-append-quota-resume": Object.freeze({
    attempt: 2,
    operation: "install",
    outcome: "passed",
    phase: "attempt-2",
  }),
  "persistence-denied": Object.freeze({
    attempt: 1,
    operation: "install",
    outcome: "passed",
    phase: "attempt-1",
  }),
  "quota-probe-exceeded": Object.freeze({
    attempt: 1,
    operation: "install",
    outcome: "failed",
    phase: "attempt-1",
  }),
  "repeated-server-corruption": Object.freeze({
    attempt: 1,
    operation: "repair",
    outcome: "failed",
    phase: "attempt-1",
  }),
  "reused-object-corruption": Object.freeze({
    attempt: 1,
    operation: "repair",
    outcome: "passed",
    phase: "attempt-1",
  }),
});

export function installerTrustFaultOperationContract(id: InstallerTrustFaultCellId): Readonly<{
  attempt: 1 | 2;
  operation: "install" | "repair";
  outcome: "failed" | "passed";
  phase: "attempt-1" | "attempt-2";
}> {
  return INSTALLER_TRUST_FAULT_OPERATION_CONTRACT[id];
}

export function projectInstallerTrustFaultTerminalPublication(
  operation: "install" | "repair",
  outcome: "failed" | "passed",
  baselinePublicationCount: number,
): Readonly<{
  publicationOccurred: boolean;
  terminalPublicationCount: number;
}> {
  const publicationOccurred = operation === "install" && outcome === "passed";
  return Object.freeze({
    publicationOccurred,
    terminalPublicationCount: baselinePublicationCount + (publicationOccurred ? 1 : 0),
  });
}

export function validateInstallerTrustFaultsResult(
  input: unknown,
  expectedAuthority?: InstallerTrustFaultAuthority,
  proofSemantics: InstallerTrustFaultResultProofSemantics = "legacy-closed-world",
  transferTelemetrySchemaVersion: InstallerTrustFaultTransferTelemetrySchemaVersion = 9,
): asserts input is InstallerTrustFaultsResultEvidence {
  const result = record(input, "result");
  exact(result, [
    "authority",
    "cells",
    "completedAt",
    "contract",
    "passed",
    "schemaVersion",
    "startedAt",
  ]);
  if (
    result.contract !== INSTALLER_TRUST_FAULTS_CONTRACT ||
    (result.schemaVersion !== INSTALLER_TRUST_FAULTS_LEGACY_SCHEMA_VERSION &&
      result.schemaVersion !== INSTALLER_TRUST_FAULTS_PREVIOUS_SCHEMA_VERSION &&
      result.schemaVersion !== INSTALLER_TRUST_FAULTS_PROOF_SCHEMA_VERSION &&
      result.schemaVersion !== INSTALLER_TRUST_FAULTS_PERSISTENCE_SCHEMA_VERSION &&
      result.schemaVersion !== INSTALLER_TRUST_FAULTS_SCHEMA_VERSION) ||
    typeof result.passed !== "boolean"
  ) {
    throw new Error("Installer trust-fault result identity is invalid");
  }
  timestamp(result.startedAt, "result start");
  timestamp(result.completedAt, "result completion");
  const validatedAuthority = validateAuthority(result.authority);
  const authority = validatedAuthority.authority;
  if (
    expectedAuthority !== undefined &&
    canonical(authority) !== canonical(validateAuthority(expectedAuthority).authority)
  ) {
    throw new Error("Installer trust-fault authority differs from independent preflight");
  }
  if (
    !Array.isArray(result.cells) ||
    result.cells.length !== INSTALLER_TRUST_FAULT_CELL_IDS.length
  ) {
    throw new Error("Installer trust-fault result must contain exactly eight cells");
  }
  const profiles = new Set<string>();
  const nonces = new Set<string>();
  const actualIds: string[] = [];
  for (const rawCell of result.cells) {
    let cell: InstallerTrustFaultCellEvidence;
    try {
      cell = validateCell(
        rawCell,
        validatedAuthority,
        result.schemaVersion,
        proofSemantics,
        transferTelemetrySchemaVersion,
      );
    } catch (error: unknown) {
      const candidate =
        typeof rawCell === "object" && rawCell !== null && "id" in rawCell
          ? String(rawCell.id)
          : "unknown";
      throw new Error(
        `Installer trust-fault cell ${candidate} is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
    actualIds.push(cell.id);
    if (profiles.has(cell.profileId)) throw new Error("Installer trust-fault profiles are reused");
    if (nonces.has(cell.fault.nonce)) throw new Error("Installer trust-fault nonce is reused");
    profiles.add(cell.profileId);
    nonces.add(cell.fault.nonce);
  }
  if (canonical(actualIds) !== canonical(INSTALLER_TRUST_FAULT_CELL_IDS)) {
    throw new Error("Installer trust-fault cells are missing, duplicated, or out of order");
  }
  // `passed` is never trusted: the independent cell validator computes the verdict.
  if (result.passed !== true)
    throw new Error("Installer trust-fault recomputed verdict did not pass");
}

export function parseInstallerTrustFaultAuthority(input: unknown): InstallerTrustFaultAuthority {
  return validateAuthority(input).authority;
}

export function parseInstallerTrustFaultManifestResources(
  authority: InstallerTrustFaultAuthority,
): readonly InstallerTrustFaultManifestResource[] {
  return validateAuthority(authority).resources;
}

export function selectInstallerTrustFaultResource(
  authority: InstallerTrustFaultAuthority,
  id: InstallerTrustFaultCellId,
): InstallerTrustFaultManifestResource {
  const resources = validateAuthority(authority).resources.filter(
    (resource) => resource.target === "opfs",
  );
  const selected =
    id === "mid-append-quota-resume"
      ? resources.find((resource) => resource.bytes > INSTALLER_TRUST_FAULT_CHECKPOINT_BYTES)
      : [...resources].sort((left, right) => left.bytes - right.bytes)[0];
  if (selected === undefined) {
    throw new Error(`No retained OPFS resource can drive ${id}`);
  }
  return selected;
}

export function parseInstallerTrustFaultCell(
  input: unknown,
  authority: InstallerTrustFaultAuthority,
  proofSemantics: InstallerTrustFaultResultProofSemantics = "legacy-closed-world",
  transferTelemetrySchemaVersion: InstallerTrustFaultTransferTelemetrySchemaVersion = 9,
): InstallerTrustFaultCellV5 {
  return validateCell(
    input,
    validateAuthority(authority),
    INSTALLER_TRUST_FAULTS_SCHEMA_VERSION,
    proofSemantics,
    transferTelemetrySchemaVersion,
  ) as InstallerTrustFaultCellV5;
}

export function parseInstallerTrustFaultCellV3(
  input: unknown,
  authority: InstallerTrustFaultAuthority,
  transferTelemetrySchemaVersion: InstallerTrustFaultTransferTelemetrySchemaVersion = 9,
): InstallerTrustFaultCellV3 {
  return validateCell(
    input,
    validateAuthority(authority),
    INSTALLER_TRUST_FAULTS_PROOF_SCHEMA_VERSION,
    "legacy-closed-world",
    transferTelemetrySchemaVersion,
  ) as InstallerTrustFaultCellV3;
}

export function parseInstallerTrustFaultCellV4(
  input: unknown,
  authority: InstallerTrustFaultAuthority,
  transferTelemetrySchemaVersion: InstallerTrustFaultTransferTelemetrySchemaVersion = 9,
): InstallerTrustFaultCellV4 {
  return validateCell(
    input,
    validateAuthority(authority),
    INSTALLER_TRUST_FAULTS_PERSISTENCE_SCHEMA_VERSION,
    "legacy-closed-world",
    transferTelemetrySchemaVersion,
  ) as InstallerTrustFaultCellV4;
}

export function parseInstallerTrustFaultCellV2(
  input: unknown,
  authority: InstallerTrustFaultAuthority,
  transferTelemetrySchemaVersion: InstallerTrustFaultTransferTelemetrySchemaVersion = 9,
): InstallerTrustFaultCellV2 {
  return validateCell(
    input,
    validateAuthority(authority),
    INSTALLER_TRUST_FAULTS_PREVIOUS_SCHEMA_VERSION,
    "legacy-closed-world",
    transferTelemetrySchemaVersion,
  ) as InstallerTrustFaultCellV2;
}

export function parseInstallerTrustFaultCellLegacy(
  input: unknown,
  authority: InstallerTrustFaultAuthority,
  transferTelemetrySchemaVersion: InstallerTrustFaultTransferTelemetrySchemaVersion = 9,
): InstallerTrustFaultCell {
  return validateCell(
    input,
    validateAuthority(authority),
    INSTALLER_TRUST_FAULTS_LEGACY_SCHEMA_VERSION,
    "legacy-closed-world",
    transferTelemetrySchemaVersion,
  ) as InstallerTrustFaultCell;
}

function validateAuthority(input: unknown): ValidatedInstallerTrustFaultAuthority {
  const authority = record(input, "authority");
  exact(authority, [
    "artifactDigest",
    "browser",
    "buildManifestBase64url",
    "buildManifestSha256",
    "environment",
    "installManifestBase64url",
    "installManifestSha256",
    "releaseDigest",
    "source",
  ]);
  for (const key of [
    "artifactDigest",
    "buildManifestSha256",
    "installManifestSha256",
    "releaseDigest",
  ] as const) {
    if (typeof authority[key] !== "string" || !SHA256.test(authority[key])) {
      throw new Error(`Installer trust-fault ${key} is invalid`);
    }
  }
  const buildManifestBytes = decodeCanonicalBase64url(
    authority.buildManifestBase64url,
    "build manifest",
  );
  const installManifestBytes = decodeCanonicalBase64url(
    authority.installManifestBase64url,
    "install manifest",
  );
  const buildManifestSha256 = createHash("sha256").update(buildManifestBytes).digest("hex");
  const installManifestSha256 = createHash("sha256").update(installManifestBytes).digest("hex");
  if (
    authority.buildManifestSha256 !== buildManifestSha256 ||
    authority.artifactDigest !== buildManifestSha256 ||
    authority.installManifestSha256 !== installManifestSha256 ||
    authority.releaseDigest !== installManifestSha256
  ) {
    throw new Error("Installer trust-fault manifest bytes do not bind the declared identities");
  }
  const { resourceById, resourceByPath, resources } = validateManifestBytes(
    buildManifestBytes,
    installManifestBytes,
  );
  const browser = record(authority.browser, "browser");
  exact(browser, ["executableSha256", "product", "revision", "sandboxed", "version"]);
  if (
    typeof browser.executableSha256 !== "string" ||
    !SHA256.test(browser.executableSha256) ||
    typeof browser.product !== "string" ||
    browser.product === "" ||
    typeof browser.revision !== "string" ||
    browser.revision === "" ||
    browser.sandboxed !== true ||
    typeof browser.version !== "string" ||
    browser.version === ""
  ) {
    throw new Error("Installer trust-fault browser authority is invalid");
  }
  const environment = record(authority.environment, "environment");
  exact(environment, ["gateState", "machineId", "physicalConsole", "profileIsolation", "tier"]);
  if (
    environment.gateState !== "valid" ||
    environment.machineId !== "dev-01" ||
    environment.physicalConsole !== true ||
    environment.profileIsolation !== "fresh-disposable-per-cell" ||
    environment.tier !== "showcase"
  ) {
    throw new Error("Installer trust-fault registered environment is invalid");
  }
  const source = record(authority.source, "source");
  exact(source, ["commit", "dirtyTreeDigest"]);
  if (
    typeof source.commit !== "string" ||
    !/^[a-f0-9]{40}$/u.test(source.commit) ||
    (source.dirtyTreeDigest !== null &&
      (typeof source.dirtyTreeDigest !== "string" || !SHA256.test(source.dirtyTreeDigest)))
  ) {
    throw new Error("Installer trust-fault source authority is invalid");
  }
  return Object.freeze({
    authority: authority as unknown as InstallerTrustFaultAuthority,
    resourceById,
    resourceByPath,
    resources,
  });
}

function validateCell(
  input: unknown,
  validatedAuthority: ValidatedInstallerTrustFaultAuthority,
  schemaVersion:
    | typeof INSTALLER_TRUST_FAULTS_LEGACY_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULTS_PREVIOUS_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULTS_PROOF_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULTS_PERSISTENCE_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULTS_SCHEMA_VERSION,
  proofSemantics: InstallerTrustFaultResultProofSemantics = "legacy-closed-world",
  transferTelemetrySchemaVersion: InstallerTrustFaultTransferTelemetrySchemaVersion = 9,
): InstallerTrustFaultCellEvidence {
  const authority = validatedAuthority.authority;
  const cell = record(input, "cell");
  exact(cell, [
    "accounting",
    "attempts",
    "cleanup",
    "completedAt",
    "fault",
    "http",
    "httpSummary",
    "id",
    "postValidation",
    "profileId",
    ...(schemaVersion === INSTALLER_TRUST_FAULTS_PERSISTENCE_SCHEMA_VERSION ||
    schemaVersion === INSTALLER_TRUST_FAULTS_SCHEMA_VERSION
      ? ["persistence"]
      : []),
    "snapshots",
    "startedAt",
    "transitions",
    "warning",
  ]);
  if (
    typeof cell.id !== "string" ||
    !(INSTALLER_TRUST_FAULT_CELL_IDS as readonly string[]).includes(cell.id) ||
    typeof cell.profileId !== "string" ||
    !/^profile-[A-Za-z0-9_-]{16,128}$/u.test(cell.profileId)
  ) {
    throw new Error("Installer trust-fault cell identity is invalid");
  }
  timestamp(cell.startedAt, "cell start");
  timestamp(cell.completedAt, "cell completion");
  const id = cell.id as InstallerTrustFaultCellId;
  const fault = validateFault(cell.fault, id, authority.releaseDigest);
  const transitions =
    schemaVersion === INSTALLER_TRUST_FAULTS_LEGACY_SCHEMA_VERSION
      ? validateTransitions(cell.transitions)
      : schemaVersion === INSTALLER_TRUST_FAULTS_SCHEMA_VERSION &&
          (proofSemantics === "active-raw" || proofSemantics === "historical-active-raw-v2")
        ? validateInstallerTrustFaultRawTransitionProof(
            cell.transitions,
            id,
            authority,
            fault.resourceId,
            proofSemantics === "historical-active-raw-v2"
              ? INSTALLER_TRUST_FAULT_TRANSITION_PROOF_PREVIOUS_SCHEMA_VERSION
              : INSTALLER_TRUST_FAULT_TRANSITION_PROOF_SCHEMA_VERSION,
          )
        : validateInstallerTrustFaultTransitionProof(
            cell.transitions,
            id,
            authority,
            fault.resourceId,
            schemaVersion === INSTALLER_TRUST_FAULTS_PREVIOUS_SCHEMA_VERSION
              ? INSTALLER_TRUST_FAULT_TRANSITION_PROOF_LEGACY_SCHEMA_VERSION
              : proofSemantics === "historical-closed-world-v2"
                ? INSTALLER_TRUST_FAULT_TRANSITION_PROOF_PREVIOUS_SCHEMA_VERSION
                : INSTALLER_TRUST_FAULT_TRANSITION_PROOF_SCHEMA_VERSION,
          );
  const attempts = validateAttempts(cell.attempts, id, fault.resourceId, transitions);
  if (isLegacyTransitions(transitions)) {
    validateCellAutomaton(
      id,
      attempts,
      transitions,
      fault.resourceId,
      authority.artifactDigest,
      authority.releaseDigest,
    );
  } else {
    validateProofAttemptOutcomes(transitions, attempts);
  }
  const http = validateHttp(cell.http);
  validateHttpSummary(cell.httpSummary, http);
  const accounting = validateAccounting(cell.accounting);
  const post = validatePostValidation(
    cell.postValidation,
    authority.releaseDigest,
    {
      cellId: id,
      resourceId: fault.resourceId,
    },
    schemaVersion,
  );
  const cleanup = record(cell.cleanup, "cleanup");
  exact(cleanup, ["faultHooksCleared", "profileRemoved", "serverStopped"]);
  if (
    cleanup.faultHooksCleared !== true ||
    cleanup.profileRemoved !== true ||
    cleanup.serverStopped !== true
  ) {
    throw new Error("Installer trust-fault cleanup is incomplete");
  }
  if (!Array.isArray(cell.snapshots) || cell.snapshots.length < 2 || cell.snapshots.length > 128) {
    throw new Error("Installer trust-fault snapshots are not bounded");
  }
  const expectedSnapshotCount =
    id === "mid-append-quota-resume" ||
    id === "reused-object-corruption" ||
    id === "final-verification-corruption" ||
    id === "repeated-server-corruption"
      ? 3
      : 2;
  if (cell.snapshots.length !== expectedSnapshotCount) {
    throw new Error("Installer trust-fault snapshot sequence is not exact");
  }
  for (const snapshot of cell.snapshots) {
    parseInstallerTrustFaultSnapshot(snapshot, transferTelemetrySchemaVersion);
  }
  const persistence =
    schemaVersion === INSTALLER_TRUST_FAULTS_PERSISTENCE_SCHEMA_VERSION ||
    schemaVersion === INSTALLER_TRUST_FAULTS_SCHEMA_VERSION
      ? validatePersistenceEvidence(cell.persistence)
      : null;
  validateCellSemantics({
    accounting,
    attempts,
    fault,
    http,
    id,
    post,
    persistence,
    resourceById: validatedAuthority.resourceById,
    resourceByPath: validatedAuthority.resourceByPath,
    snapshots: cell.snapshots as InstallerSnapshot[],
    transitions,
    warning: cell.warning,
    withRepairMetadataEvidence: schemaVersion === INSTALLER_TRUST_FAULTS_SCHEMA_VERSION,
    withOperationAwarePublication: schemaVersion === INSTALLER_TRUST_FAULTS_SCHEMA_VERSION,
  });
  return cell as unknown as InstallerTrustFaultCellEvidence;
}

function parseInstallerTrustFaultSnapshot(
  input: unknown,
  transferTelemetrySchemaVersion: InstallerTrustFaultTransferTelemetrySchemaVersion,
): InstallerSnapshot {
  const snapshot = record(input, "installer snapshot");
  exact(snapshot, ["installStore", "installerTransfer"]);
  validateInstallerSnapshotTelemetry(
    {
      installStore: snapshot.installStore,
      installerTransfer: snapshot.installerTransfer,
    },
    transferTelemetrySchemaVersion,
  );
  return snapshot as unknown as InstallerSnapshot;
}

function validateProofAttemptOutcomes(
  proof: InstallerTrustFaultTransitionProofEvidence,
  attempts: InstallerTrustFaultCell["attempts"],
): void {
  for (const attempt of attempts) {
    const phase = proof.phases.find((candidate) => candidate.phase === `attempt-${attempt.index}`);
    const terminal = phase === undefined ? undefined : proof.states[phase.finalStateId - 1];
    if (
      terminal === undefined ||
      terminal.transferState !== (attempt.outcome === "passed" ? "ready" : "failed") ||
      terminal.uiState !== (attempt.outcome === "passed" ? "ready" : "failed") ||
      terminal.failureCode !== attempt.failureCode ||
      terminal.failureResourceId !== attempt.failureResourceId
    ) {
      throw new Error("Installer trust-fault attempt outcome differs from transition proof");
    }
  }
}

function validateHttpSummary(
  input: unknown,
  http: InstallerTrustFaultCell["http"],
): InstallerTrustFaultCell["httpSummary"] {
  const summary = record(input, "HTTP summary");
  exact(summary, ["bodyBytes", "responseCount", "sha256"]);
  const expectedBytes = http.reduce((total, response) => total + response.bodyBytes, 0);
  const expectedSha256 = createHash("sha256").update(JSON.stringify(http)).digest("hex");
  if (
    summary.bodyBytes !== expectedBytes ||
    summary.responseCount !== http.length ||
    summary.sha256 !== expectedSha256
  ) {
    throw new Error("Installer trust-fault HTTP summary differs from the complete ordered journal");
  }
  return summary as unknown as InstallerTrustFaultCell["httpSummary"];
}

function validateFault(
  input: unknown,
  id: InstallerTrustFaultCellId,
  releaseDigest: string,
): InstallerTrustFaultCell["fault"] {
  const fault = record(input, "fault");
  exact(fault, ["events", "kind", "nonce", "offset", "releaseDigest", "resourceId", "useCount"]);
  const expectedKind: Record<InstallerTrustFaultCellId, InstallerTrustFaultCell["fault"]["kind"]> =
    {
      "estimate-clearly-insufficient": "estimate-insufficient",
      "estimate-incomplete-probe-success": "estimate-incomplete",
      "final-verification-corruption": "corrupt-final-object",
      "mid-append-quota-resume": "mid-append-quota",
      "persistence-denied": "persistence-denied",
      "quota-probe-exceeded": "quota-probe",
      "repeated-server-corruption": "corrupt-server-representation",
      "reused-object-corruption": "corrupt-reused-object",
    };
  if (
    fault.kind !== expectedKind[id] ||
    typeof fault.nonce !== "string" ||
    !NONCE.test(fault.nonce) ||
    fault.releaseDigest !== releaseDigest ||
    typeof fault.resourceId !== "string" ||
    !RESOURCE_ID.test(fault.resourceId) ||
    !nonnegative(fault.offset) ||
    fault.useCount !== 1 ||
    !Array.isArray(fault.events) ||
    fault.events.length !== 1
  ) {
    throw new Error("Installer trust-fault token is invalid or was not used exactly once");
  }
  const event = record(fault.events[0], "fault event");
  exact(event, ["nonce", "offset", "operation", "order", "releaseDigest", "resourceId"]);
  const expectedOperation = installerTrustFaultOperationContract(id).operation;
  if (
    event.nonce !== fault.nonce ||
    event.offset !== fault.offset ||
    event.operation !== expectedOperation ||
    event.order !== 1 ||
    event.releaseDigest !== releaseDigest ||
    event.resourceId !== fault.resourceId ||
    fault.useCount !== fault.events.length
  ) {
    throw new Error("Installer trust-fault raw nonce consumption event is contradictory");
  }
  return fault as unknown as InstallerTrustFaultCell["fault"];
}

function validateAttempts(
  input: unknown,
  id: InstallerTrustFaultCellId,
  faultResourceId: string,
  transitions: InstallerTrustFaultLegacyTransitions | InstallerTrustFaultTransitionProofEvidence,
): InstallerTrustFaultCell["attempts"] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 2) {
    throw new Error("Installer trust-fault attempt count is invalid");
  }
  const attempts = input.map((value, ordinal) => {
    const attempt = record(value, "attempt");
    exact(attempt, [
      "action",
      "failureCode",
      "failureResourceId",
      "index",
      "networkRetryCount",
      "outcome",
      "transitions",
    ]);
    if (
      attempt.index !== ordinal + 1 ||
      (attempt.action !== "none" && attempt.action !== "repair" && attempt.action !== "retry") ||
      (attempt.outcome !== "failed" && attempt.outcome !== "passed") ||
      !nonnegative(attempt.networkRetryCount) ||
      !Array.isArray(attempt.transitions) ||
      attempt.transitions.length < 2 ||
      attempt.transitions.length > INSTALLER_TRUST_FAULT_MAX_ATTEMPT_MILESTONES ||
      attempt.transitions.some((item) => typeof item !== "string" || item === "")
    ) {
      throw new Error("Installer trust-fault attempt evidence is invalid");
    }
    if (
      attempt.outcome === "passed"
        ? attempt.failureCode !== null ||
          attempt.failureResourceId !== null ||
          attempt.action !== "none"
        : typeof attempt.failureCode !== "string"
    ) {
      throw new Error("Installer trust-fault attempt outcome contradicts its failure");
    }
    return attempt as unknown as InstallerTrustFaultCell["attempts"][number];
  });
  for (const attempt of attempts) {
    const phase = `attempt-${attempt.index}`;
    const expectedTransitions = isLegacyTransitions(transitions)
      ? projectInstallerTrustFaultAttemptMilestones(
          transitions.filter((transition) => transition.phase === phase),
        ).milestones
      : transitions.phases.find((candidate) => candidate.phase === phase)?.attemptMilestones;
    if (expectedTransitions === undefined) {
      throw new Error("Installer trust-fault attempt phase proof is absent");
    }
    if (canonical(attempt.transitions) !== canonical(expectedTransitions)) {
      throw new Error("Installer trust-fault attempt summary differs from transition proof");
    }
  }
  if (id === "mid-append-quota-resume") {
    if (
      attempts.length !== 2 ||
      attempts[0]?.outcome !== "failed" ||
      attempts[0]?.failureCode !== "quota" ||
      attempts[0]?.failureResourceId !== faultResourceId ||
      attempts[0]?.networkRetryCount !== 0 ||
      attempts[0]?.action !== "retry" ||
      attempts[1]?.outcome !== "passed"
    ) {
      throw new Error("Installer trust-fault quota resume attempts are invalid");
    }
  } else {
    const success = SUCCESS_CELLS.has(id);
    if (
      attempts.length !== 1 ||
      attempts[0]?.outcome !== (success ? "passed" : "failed") ||
      (!success &&
        attempts[0]?.action !== (id === "repeated-server-corruption" ? "repair" : "retry"))
    ) {
      throw new Error("Installer trust-fault terminal attempt is invalid");
    }
    if (
      id === "repeated-server-corruption" &&
      (attempts[0]?.failureCode !== "integrity" ||
        attempts[0]?.failureResourceId !== faultResourceId)
    ) {
      throw new Error("Repeated corruption omitted the exact failure resource");
    }
    if (
      (id === "estimate-clearly-insufficient" || id === "quota-probe-exceeded") &&
      attempts[0]?.failureCode !== "quota"
    ) {
      throw new Error("Installer quota cell omitted its typed quota failure");
    }
  }
  if (attempts.some((attempt) => attempt.networkRetryCount !== 0)) {
    throw new Error("Installer trust-fault cell crossed an unexpected network retry boundary");
  }
  return Object.freeze(attempts);
}

function validateTransitions(input: unknown): InstallerTrustFaultLegacyTransitions {
  return validateCanonicalInstallerTrustFaultTransitions(input);
}

function validateCellAutomaton(
  id: InstallerTrustFaultCellId,
  attempts: InstallerTrustFaultCell["attempts"],
  transitions: InstallerTrustFaultLegacyTransitions,
  faultResourceId: string,
  targetArtifactDigest: string,
  targetReleaseDigest: string,
): void {
  const expectedPhases =
    id === "mid-append-quota-resume"
      ? ["setup", "attempt-1", "attempt-2"]
      : id === "reused-object-corruption" ||
          id === "final-verification-corruption" ||
          id === "repeated-server-corruption"
        ? ["setup", "seed", "attempt-1"]
        : ["setup", "attempt-1"];
  const phaseRanks = new Map(expectedPhases.map((phase, index) => [phase, index] as const));
  let priorRank = -1;
  for (const transition of transitions) {
    const rank = phaseRanks.get(transition.phase);
    if (rank === undefined || rank < priorRank) {
      throw new Error("Installer trust-fault transition phase progression is invalid");
    }
    priorRank = rank;
  }
  if (
    canonical([...new Set(transitions.map((transition) => transition.phase))]) !==
    canonical(expectedPhases)
  ) {
    throw new Error("Installer trust-fault transition phases do not match the cell automaton");
  }
  if (
    transitions
      .filter((transition) => transition.phase === "setup")
      .some((transition) => transition.uiState === "ready" || transition.uiState === "failed")
  ) {
    throw new Error("Installer trust-fault setup transition has terminal authority");
  }
  if (expectedPhases.includes("seed")) {
    validateOperationProgression(
      transitions.filter((transition) => transition.phase === "seed"),
      "passed",
      "installing",
      null,
      null,
      targetArtifactDigest,
      targetReleaseDigest,
    );
  }
  for (const attempt of attempts) {
    validateOperationProgression(
      transitions.filter((transition) => transition.phase === `attempt-${attempt.index}`),
      attempt.outcome,
      expectedPhases.includes("seed") ? "repairing" : "installing",
      attempt.failureCode,
      attempt.failureResourceId,
      targetArtifactDigest,
      targetReleaseDigest,
    );
  }
  const terminalAttempt = attempts.at(-1);
  if (
    terminalAttempt === undefined ||
    (id === "repeated-server-corruption"
      ? terminalAttempt.action !== "repair" ||
        terminalAttempt.failureCode !== "integrity" ||
        terminalAttempt.failureResourceId !== faultResourceId
      : id === "mid-append-quota-resume"
        ? attempts[0]?.action !== "retry" ||
          attempts[0]?.failureCode !== "quota" ||
          attempts[0]?.failureResourceId !== faultResourceId ||
          terminalAttempt.action !== "none"
        : SUCCESS_CELLS.has(id)
          ? terminalAttempt.action !== "none"
          : terminalAttempt.action !== "retry" || terminalAttempt.failureCode !== "quota")
  ) {
    throw new Error("Installer trust-fault terminal action/failure automaton is invalid");
  }
}

function validateOperationProgression(
  transitions: readonly InstallerTrustFaultTransition[],
  outcome: "failed" | "passed",
  operationUiState: "installing" | "repairing",
  failureCode: InstallerFailureCode | null,
  failureResourceId: string | null,
  targetArtifactDigest: string,
  targetReleaseDigest: string,
): void {
  if (transitions.length < 3) {
    throw new Error("Installer trust-fault operation transition sequence is incomplete");
  }
  const startIndex = transitions.findIndex(
    (transition) =>
      transition.transferState === "waiting-lock" || transition.transferState === "planning",
  );
  if (startIndex < 0) {
    throw new Error("Installer trust-fault operation never entered its attempt boundary");
  }
  const operation = transitions.slice(startIndex);
  const semanticProgression = operation.filter(
    (transition, index) =>
      index === 0 ||
      installerTrustFaultTransitionSemanticKey(transition) !==
        installerTrustFaultTransitionSemanticKey(operation[index - 1]),
  );
  const graph = new Map<string, ReadonlySet<string>>([
    ["waiting-lock", new Set(["planning"])],
    ["planning", new Set(["probing-quota"])],
    ["probing-quota", new Set(["failed", "transferring"])],
    ["transferring", new Set(["failed", "verifying"])],
    ["verifying", new Set(["failed", "ready", "transferring"])],
    ["failed", new Set()],
    ["ready", new Set()],
  ]);
  if (
    (semanticProgression[0]?.transferState !== "waiting-lock" &&
      semanticProgression[0]?.transferState !== "planning") ||
    !semanticProgression.some((transition) => transition.transferState === "planning") ||
    !semanticProgression.some((transition) => transition.transferState === "probing-quota")
  ) {
    throw new Error("Installer trust-fault operation omitted planning or quota probing");
  }
  for (let index = 1; index < semanticProgression.length; index += 1) {
    const previous = semanticProgression[index - 1]?.transferState;
    const current = semanticProgression[index]?.transferState;
    if (
      previous === undefined ||
      current === undefined ||
      (previous !== current && !(graph.get(previous)?.has(current) ?? false))
    ) {
      throw new Error("Installer trust-fault operation transition order is invalid");
    }
  }
  const terminal = operation.at(-1);
  const terminalState = outcome === "passed" ? "ready" : "failed";
  const firstTerminalIndex = operation.findIndex(
    (transition) => transition.transferState === terminalState,
  );
  const invalidPrelude =
    firstTerminalIndex < 0 ||
    operation
      .slice(0, firstTerminalIndex)
      .some(
        (transition) =>
          transition.failureCode !== null ||
          transition.failureResourceId !== null ||
          transition.uiState === "failed" ||
          transition.uiState === "ready",
      ) ||
    !operation.some((transition) => transition.uiState === operationUiState);
  if (invalidPrelude || terminal === undefined) {
    throw new Error("Installer trust-fault operation terminal/UI progression is invalid");
  }
  const terminalSequence = operation.slice(firstTerminalIndex);
  if (outcome === "passed") {
    const firstReady = terminalSequence[0];
    const expectedShellGenerationId = `${targetArtifactDigest}:${targetReleaseDigest}`;
    let observedUiReady = false;
    if (
      firstReady === undefined ||
      firstReady.transferState !== "ready" ||
      firstReady.uiState !== operationUiState ||
      firstReady.storeState !== "ready" ||
      firstReady.activeReleaseDigest !== targetReleaseDigest ||
      firstReady.failureCode !== null ||
      firstReady.failureResourceId !== null ||
      terminal.transferState !== "ready" ||
      terminal.uiState !== "ready" ||
      terminal.storeState !== "ready" ||
      terminal.activeReleaseDigest !== targetReleaseDigest ||
      terminal.releaseDigest !== targetReleaseDigest ||
      terminal.shellGenerationId !== expectedShellGenerationId
    ) {
      throw new Error("Installer trust-fault success omitted its two-stage Ready boundary");
    }
    for (const transition of terminalSequence) {
      if (
        transition.transferState !== "ready" ||
        transition.storeState !== "ready" ||
        transition.activeReleaseDigest !== targetReleaseDigest ||
        transition.failureCode !== null ||
        transition.failureResourceId !== null ||
        (transition.uiState !== operationUiState && transition.uiState !== "ready")
      ) {
        throw new Error("Installer trust-fault success Ready sequence changed authority");
      }
      if (transition.uiState === "ready") {
        observedUiReady = true;
        if (
          transition.releaseDigest !== targetReleaseDigest ||
          transition.shellGenerationId !== expectedShellGenerationId
        ) {
          throw new Error("Installer trust-fault final UI Ready authority is inconsistent");
        }
      } else if (
        observedUiReady ||
        (operationUiState === "installing"
          ? transition.releaseDigest !== null || transition.shellGenerationId !== null
          : transition.releaseDigest !== targetReleaseDigest ||
            transition.shellGenerationId !== expectedShellGenerationId)
      ) {
        throw new Error("Installer trust-fault offline-shell preparation boundary is invalid");
      }
    }
    if (!observedUiReady) {
      throw new Error("Installer trust-fault success never reached final UI Ready");
    }
  } else if (
    terminal.transferState !== "failed" ||
    terminal.uiState !== "failed" ||
    terminal.failureCode !== failureCode ||
    terminal.failureResourceId !== failureResourceId ||
    terminalSequence.some(
      (transition) =>
        transition.transferState !== "failed" ||
        transition.uiState !== "failed" ||
        transition.failureCode !== failureCode ||
        transition.failureResourceId !== failureResourceId,
    )
  ) {
    throw new Error("Installer trust-fault failure terminal progression is invalid");
  }
  const transferred = semanticProgression.some(
    (transition) => transition.transferState === "transferring",
  );
  const verified = semanticProgression.some(
    (transition) => transition.transferState === "verifying",
  );
  if (
    outcome === "passed"
      ? !transferred || !verified
      : operationUiState === "repairing"
        ? !transferred || !verified
        : verified
  ) {
    throw new Error("Installer trust-fault operation work progression is contradictory");
  }
}

function validateHttp(input: unknown): InstallerTrustFaultCell["http"] {
  if (!Array.isArray(input) || input.length > 4096) {
    throw new Error("Installer trust-fault HTTP evidence is not bounded");
  }
  return Object.freeze(
    input.map((value, index) => {
      const request = record(value, "HTTP request");
      exact(request, [
        "attempt",
        "bodyBytes",
        "etag",
        "ifRange",
        "method",
        "order",
        "path",
        "phase",
        "range",
        "status",
      ]);
      if (
        !nonnegative(request.attempt) ||
        (request.attempt as number) > 2 ||
        !nonnegative(request.bodyBytes) ||
        (request.etag !== null &&
          (typeof request.etag !== "string" ||
            !/^"[\x21\x23-\x7e]{1,1024}"$/u.test(request.etag))) ||
        (request.ifRange !== null &&
          (typeof request.ifRange !== "string" ||
            !/^"[\x21\x23-\x7e]{1,1024}"$/u.test(request.ifRange))) ||
        typeof request.method !== "string" ||
        !/^[A-Z]{3,8}$/u.test(request.method) ||
        request.order !== index + 1 ||
        typeof request.path !== "string" ||
        !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,500}$/u.test(request.path) ||
        (request.phase !== "attempt-1" &&
          request.phase !== "attempt-2" &&
          request.phase !== "seed" &&
          request.phase !== "setup") ||
        (request.range !== null &&
          (typeof request.range !== "string" ||
            request.range.length > 64 ||
            !/^bytes=[0-9]+-$/u.test(request.range))) ||
        !nonnegative(request.status) ||
        (request.status as number) > 599
      ) {
        throw new Error("Installer trust-fault HTTP request is invalid");
      }
      return request as unknown as InstallerTrustFaultCell["http"][number];
    }),
  );
}

function validateAccounting(input: unknown): InstallerTrustFaultCell["accounting"] {
  const value = record(input, "accounting");
  exact(value, [
    "checkpointedBytes",
    "downloadedBytes",
    "lifetimeCheckpointedBytes",
    "lifetimeDownloadedBytes",
    "readyBytes",
    "repairedBytes",
    "repairedResourceCount",
    "resumedBytes",
    "reusedBytes",
    "totalBytes",
  ]);
  for (const key of Object.keys(value)) {
    if (!nonnegative(value[key])) throw new Error("Installer trust-fault accounting is invalid");
  }
  if (
    (value.repairedResourceCount === 0) !== (value.repairedBytes === 0) ||
    (value.repairedBytes as number) > (value.downloadedBytes as number) ||
    (value.checkpointedBytes as number) > (value.lifetimeDownloadedBytes as number)
  ) {
    throw new Error("Installer trust-fault repaired/checkpoint accounting is inconsistent");
  }
  return value as unknown as InstallerTrustFaultCell["accounting"];
}

function validatePersistenceEvidence(input: unknown): InstallerTrustFaultPersistenceEvidence {
  const evidence = record(input, "persistence evidence");
  exact(evidence, ["initialPersisted", "requests"]);
  if (typeof evidence.initialPersisted !== "boolean" || !Array.isArray(evidence.requests)) {
    throw new Error("Installer trust-fault persistence evidence is invalid");
  }
  if (evidence.requests.length < 1 || evidence.requests.length > 3) {
    throw new Error("Installer trust-fault persistence request evidence is not bounded");
  }
  const requests = evidence.requests.map((rawRequest, index) => {
    const request = record(rawRequest, `persistence request ${index + 1}`);
    exact(request, [
      "attempt",
      "classification",
      "operation",
      "order",
      "persistedAfter",
      "persistedBefore",
      "phase",
      "requestedUiState",
      "result",
      "terminalUiState",
      "warning",
    ]);
    if (
      (request.attempt !== 1 && request.attempt !== 2) ||
      (request.classification !== "already-persisted" &&
        request.classification !== "denied" &&
        request.classification !== "granted") ||
      (request.operation !== "install" && request.operation !== "repair") ||
      request.order !== index + 1 ||
      typeof request.persistedAfter !== "boolean" ||
      typeof request.persistedBefore !== "boolean" ||
      (request.phase !== "attempt-1" &&
        request.phase !== "attempt-2" &&
        request.phase !== "seed") ||
      request.requestedUiState !== "requesting" ||
      typeof request.result !== "boolean" ||
      (request.terminalUiState !== "denied" && request.terminalUiState !== "granted") ||
      (request.warning !== null && request.warning !== "degraded-durability")
    ) {
      throw new Error(
        `Installer trust-fault persistence request is invalid; request=${JSON.stringify({
          attempt: request.attempt,
          classification: request.classification,
          operation: request.operation,
          order: request.order,
          phase: request.phase,
        })}`,
      );
    }
    return request as unknown as InstallerTrustFaultPersistenceRequest;
  });
  return Object.freeze({
    initialPersisted: evidence.initialPersisted,
    requests: Object.freeze(requests),
  });
}

function validatePostValidation(
  input: unknown,
  releaseDigest: string,
  context: Readonly<{
    readonly cellId: InstallerTrustFaultCellId;
    readonly resourceId: string;
  }>,
  schemaVersion:
    | typeof INSTALLER_TRUST_FAULTS_LEGACY_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULTS_PREVIOUS_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULTS_PROOF_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULTS_PERSISTENCE_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULTS_SCHEMA_VERSION,
): InstallerTrustFaultCell["postValidation"] {
  const value = record(input, "post-validation");
  exact(value, [
    "activeReleaseDigest",
    "externalRootSentinelSha256",
    "launchEnabled",
    "operationInitialActiveReleaseDigest",
    "operationInitialPreviousReleaseDigest",
    "operationInitialPublicationCount",
    "mutationEvidence",
    "previousReleaseDigest",
    "publicationOccurred",
    "saveSentinelSha256",
    "targetReleaseDigest",
    "terminalPublicationCount",
    "uiReleaseDigest",
    "uiShellGenerationId",
  ]);
  validateMutationEvidence(
    value.mutationEvidence,
    context,
    schemaVersion === INSTALLER_TRUST_FAULTS_SCHEMA_VERSION,
  );
  if (
    (value.activeReleaseDigest !== null &&
      (typeof value.activeReleaseDigest !== "string" || !SHA256.test(value.activeReleaseDigest))) ||
    (value.previousReleaseDigest !== null &&
      (typeof value.previousReleaseDigest !== "string" ||
        !SHA256.test(value.previousReleaseDigest))) ||
    (value.operationInitialActiveReleaseDigest !== null &&
      (typeof value.operationInitialActiveReleaseDigest !== "string" ||
        !SHA256.test(value.operationInitialActiveReleaseDigest))) ||
    (value.operationInitialPreviousReleaseDigest !== null &&
      (typeof value.operationInitialPreviousReleaseDigest !== "string" ||
        !SHA256.test(value.operationInitialPreviousReleaseDigest))) ||
    !nonnegative(value.operationInitialPublicationCount) ||
    !nonnegative(value.terminalPublicationCount) ||
    (value.terminalPublicationCount as number) <
      (value.operationInitialPublicationCount as number) ||
    value.targetReleaseDigest !== releaseDigest ||
    (value.uiReleaseDigest !== null &&
      (typeof value.uiReleaseDigest !== "string" || !SHA256.test(value.uiReleaseDigest))) ||
    (value.uiShellGenerationId !== null &&
      (typeof value.uiShellGenerationId !== "string" ||
        value.uiShellGenerationId.length < 1 ||
        value.uiShellGenerationId.length > 256 ||
        !/^[A-Za-z0-9._:-]+$/u.test(value.uiShellGenerationId))) ||
    typeof value.saveSentinelSha256 !== "string" ||
    !SHA256.test(value.saveSentinelSha256) ||
    typeof value.externalRootSentinelSha256 !== "string" ||
    !SHA256.test(value.externalRootSentinelSha256) ||
    typeof value.launchEnabled !== "boolean" ||
    typeof value.publicationOccurred !== "boolean" ||
    value.publicationOccurred !==
      (value.terminalPublicationCount as number) >
        (value.operationInitialPublicationCount as number)
  ) {
    throw new Error("Installer trust-fault post-validation authority is invalid");
  }
  return value as unknown as InstallerTrustFaultCell["postValidation"];
}

function validateMutationEvidence(
  input: unknown,
  context: Readonly<{
    readonly cellId: InstallerTrustFaultCellId;
    readonly resourceId: string;
  }>,
  requireMetadataDigests: boolean,
): void {
  const value = record(input, "mutation evidence");
  exact(value, ["declaredMutableScopes", "post", "pre", "unexpectedChangedScopes"]);
  const scopes: readonly InstallerTrustFaultMutationScope[] = [
    "external-root",
    "indexeddb",
    "install-root",
    "saves",
    "selection",
    "shell-cache",
  ];
  const validateScopes = (raw: unknown, label: string): InstallerTrustFaultMutationScope[] => {
    if (
      !Array.isArray(raw) ||
      raw.some((item) => typeof item !== "string" || !scopes.includes(item as never))
    ) {
      throw new Error(`Installer trust-fault ${label} scopes are invalid`);
    }
    const result = [...raw] as InstallerTrustFaultMutationScope[];
    if (
      new Set(result).size !== result.length ||
      canonical(result) !== canonical([...result].sort())
    ) {
      throw new Error(`Installer trust-fault ${label} scopes are not unique and canonical`);
    }
    return result;
  };
  const declared = validateScopes(value.declaredMutableScopes, "declared mutation");
  const reportedUnexpected = validateScopes(value.unexpectedChangedScopes, "unexpected mutation");
  const pre = validateScopedInventories(value.pre, scopes, "pre", requireMetadataDigests);
  const post = validateScopedInventories(value.post, scopes, "post", requireMetadataDigests);
  const changed = scopes.filter((scope) => pre[scope].sha256 !== post[scope].sha256);
  const unexpected = changed.filter((scope) => !declared.includes(scope)).sort();
  if (canonical(unexpected) !== canonical(reportedUnexpected) || unexpected.length !== 0) {
    const deltas = unexpected.map((scope) => boundedInventoryDelta(scope, pre[scope], post[scope]));
    throw new Error(
      `Installer trust-fault scoped inventory contains an unexpected mutation; cell=${context.cellId}; resourceId=${context.resourceId}; deltas=${JSON.stringify(deltas)}`,
    );
  }
  if (
    pre.saves.sha256 !== post.saves.sha256 ||
    pre["external-root"].sha256 !== post["external-root"].sha256
  ) {
    throw new Error("Installer trust-fault protected OPFS inventory changed");
  }
}

function boundedInventoryDelta(
  scope: InstallerTrustFaultMutationScope,
  pre: InstallerTrustFaultScopedInventory,
  post: InstallerTrustFaultScopedInventory,
): Readonly<{
  readonly addedCount: number;
  readonly addedEntrySha256: readonly string[];
  readonly addedLogicalPathSha256: readonly string[];
  readonly postCount: number;
  readonly postSha256: string;
  readonly preCount: number;
  readonly preSha256: string;
  readonly removedCount: number;
  readonly removedEntrySha256: readonly string[];
  readonly removedLogicalPathSha256: readonly string[];
  readonly scope: InstallerTrustFaultMutationScope;
}> {
  const preEntries = new Set(pre.entries);
  const postEntries = new Set(post.entries);
  const added = post.entries.filter((entry) => !preEntries.has(entry));
  const removed = pre.entries.filter((entry) => !postEntries.has(entry));
  const hashes = (entries: readonly string[], logicalPath: boolean): readonly string[] =>
    Object.freeze(
      entries
        .map((entry) =>
          createHash("sha256")
            .update(logicalPath ? inventoryLogicalPath(scope, entry) : entry)
            .digest("hex"),
        )
        .sort()
        .slice(0, 4),
    );
  return Object.freeze({
    addedCount: added.length,
    addedEntrySha256: hashes(added, false),
    addedLogicalPathSha256: hashes(added, true),
    postCount: post.entries.length,
    postSha256: post.sha256,
    preCount: pre.entries.length,
    preSha256: pre.sha256,
    removedCount: removed.length,
    removedEntrySha256: hashes(removed, false),
    removedLogicalPathSha256: hashes(removed, true),
    scope,
  });
}

function inventoryLogicalPath(scope: InstallerTrustFaultMutationScope, entry: string): string {
  if (scope === "external-root" || scope === "install-root" || scope === "saves") {
    if (entry.startsWith("d:")) return entry.slice(2);
    const match = /^f:(.*):[0-9]+(?::[a-f0-9]{64})?$/u.exec(entry);
    return match?.[1] ?? "<invalid-file-entry>";
  }
  const separator = entry.indexOf(":");
  return separator === -1 ? entry : entry.slice(0, separator);
}

function requireUnchangedDurablePublicationMetadata(
  pre: readonly string[],
  post: readonly string[],
  releaseDigest: string,
): void {
  const paths = {
    commit: new RegExp(`^commits/[0-9]{20}-${releaseDigest}\\.json$`, "u"),
    published: new RegExp(`^releases/${releaseDigest}/published\\.json$`, "u"),
    ready: new RegExp(`^releases/${releaseDigest}/ready\\.json$`, "u"),
  } as const;
  for (const [kind, pattern] of Object.entries(paths)) {
    const select = (entries: readonly string[]): readonly string[] =>
      entries.filter((entry) => pattern.test(inventoryLogicalPath("install-root", entry))).sort();
    const before = select(pre);
    const after = select(post);
    if (
      before.length === 0 ||
      canonical(before) !== canonical(after) ||
      before.some((entry) => !/:[0-9]+:[a-f0-9]{64}$/u.test(entry))
    ) {
      throw new Error(
        `Repeated corruption changed or omitted exact durable ${kind} metadata bytes`,
      );
    }
  }
}

function validateScopedInventories(
  input: unknown,
  scopes: readonly InstallerTrustFaultMutationScope[],
  label: string,
  requireMetadataDigests: boolean,
): Record<InstallerTrustFaultMutationScope, InstallerTrustFaultScopedInventory> {
  const value = record(input, `${label} scoped inventories`);
  exact(value, scopes);
  const result = {} as Record<InstallerTrustFaultMutationScope, InstallerTrustFaultScopedInventory>;
  for (const scope of scopes) {
    const inventory = record(value[scope], `${label} ${scope} inventory`);
    exact(inventory, ["entries", "sha256"]);
    if (
      !Array.isArray(inventory.entries) ||
      inventory.entries.length > 8192 ||
      inventory.entries.some(
        (entry) => typeof entry !== "string" || entry.length > 1024 || /[\r\n\0]/u.test(entry),
      ) ||
      canonical(inventory.entries) !== canonical([...inventory.entries].sort()) ||
      new Set(inventory.entries).size !== inventory.entries.length ||
      typeof inventory.sha256 !== "string" ||
      inventory.sha256 !==
        createHash("sha256").update(JSON.stringify(inventory.entries)).digest("hex")
    ) {
      throw new Error(`Installer trust-fault ${label} ${scope} inventory is invalid`);
    }
    if (
      requireMetadataDigests &&
      scope === "install-root" &&
      (inventory.entries.some((entry) => !validInstallRootMetadataEntry(entry)) ||
        installRootMetadataBytes(inventory.entries) > 16 * 1024 * 1024)
    ) {
      throw new Error(
        `Installer trust-fault ${label} install-root metadata inventory is not exact`,
      );
    }
    result[scope] = inventory as unknown as InstallerTrustFaultScopedInventory;
  }
  return result;
}

function installRootMetadataBytes(entries: readonly string[]): number {
  return entries.reduce((total, entry) => {
    const match = /^f:.*:([0-9]+):[a-f0-9]{64}$/u.exec(entry);
    return match?.[1] === undefined ? total : total + Number(match[1]);
  }, 0);
}

function validInstallRootMetadataEntry(entry: string): boolean {
  if (entry.startsWith("d:")) return true;
  const match = /^f:(.*):([0-9]+)(?::([a-f0-9]{64}))?$/u.exec(entry);
  if (match === null) return false;
  const path = match[1] ?? "";
  const bytes = Number(match[2]);
  const digest = match[3];
  const metadata =
    /^commits\/[0-9]{20}-[a-f0-9]{64}\.json$/u.test(path) ||
    /^objects\/(?:common|games\/parallax)\/sha256\/[a-f0-9]{2}\/[a-f0-9]{64}\.verified\.json$/u.test(
      path,
    ) ||
    /^partials\/[a-f0-9]{64}\/[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?\/checkpoints\/[0-9]{20}\.json$/u.test(
      path,
    ) ||
    /^releases\/[a-f0-9]{64}\/(?:abandoned|published|ready|repair-eligibility|staged)\.json$/u.test(
      path,
    );
  return metadata
    ? digest !== undefined && Number.isSafeInteger(bytes) && bytes >= 1 && bytes <= 1024 * 1024
    : digest === undefined;
}

export function validateInstallerTrustFaultResourceResponse(
  request: InstallerTrustFaultCell["http"][number],
  resource: Readonly<{
    readonly bytes: number;
    readonly id: string;
    readonly path: string;
    readonly sha256: string;
  }>,
  options: Readonly<{ readonly allowInterruptedMidAppend: boolean }>,
): void {
  const expectedEtag = `"sha256-${resource.sha256}"`;
  const rangeStartMatch = request.range?.match(/^bytes=([0-9]+)-$/u);
  const rangeStart = rangeStartMatch?.[1] === undefined ? null : Number(rangeStartMatch[1]);
  const canonicalRange =
    rangeStart !== null &&
    Number.isSafeInteger(rangeStart) &&
    rangeStart >= 0 &&
    request.range === `bytes=${rangeStart}-`;
  const fullGet =
    request.range === null &&
    request.method === "GET" &&
    request.status === 200 &&
    request.ifRange === null &&
    request.etag === expectedEtag &&
    request.bodyBytes === resource.bytes;
  const conditionalFullGet =
    request.range === null &&
    request.method === "GET" &&
    request.status === 304 &&
    request.ifRange === null &&
    request.etag === expectedEtag &&
    request.bodyBytes === 0;
  const interrupted =
    options.allowInterruptedMidAppend &&
    request.method === "GET" &&
    request.status === 499 &&
    request.range === "bytes=0-" &&
    request.ifRange === null &&
    request.etag === expectedEtag &&
    request.bodyBytes > 0 &&
    request.bodyBytes <= resource.bytes;
  const partial =
    canonicalRange &&
    request.method === "GET" &&
    request.status === 206 &&
    request.etag === expectedEtag &&
    request.bodyBytes === resource.bytes - rangeStart &&
    (rangeStart === 0 ? request.ifRange === null : request.ifRange === expectedEtag);
  const complete =
    canonicalRange &&
    request.method === "GET" &&
    request.status === 416 &&
    rangeStart === resource.bytes &&
    request.ifRange === expectedEtag &&
    request.etag === expectedEtag &&
    request.bodyBytes === 0;
  if (fullGet || conditionalFullGet || interrupted || partial || complete) return;
  const summary = Object.freeze({
    etag: request.etag !== null,
    ifRange: request.ifRange !== null,
    method: request.method,
    order: request.order,
    pathSha256: createHash("sha256").update(request.path).digest("hex"),
    range:
      request.range === null ? null : request.range.length <= 64 ? request.range : "<oversized>",
    resourceId: resource.id,
    status: request.status,
  });
  throw new Error(
    `Installer trust-fault resource response lacks exact transport authority; request=${JSON.stringify(summary)}`,
  );
}

function validateCellSemantics(input: {
  readonly accounting: InstallerTrustFaultCell["accounting"];
  readonly attempts: InstallerTrustFaultCell["attempts"];
  readonly fault: InstallerTrustFaultCell["fault"];
  readonly http: InstallerTrustFaultCell["http"];
  readonly id: InstallerTrustFaultCellId;
  readonly persistence: InstallerTrustFaultPersistenceEvidence | null;
  readonly post: InstallerTrustFaultCell["postValidation"];
  readonly resourceById: ReadonlyMap<string, InstallerTrustFaultManifestResource>;
  readonly resourceByPath: ReadonlyMap<string, InstallerTrustFaultManifestResource>;
  readonly snapshots: readonly InstallerSnapshot[];
  readonly transitions:
    | InstallerTrustFaultLegacyTransitions
    | InstallerTrustFaultTransitionProofEvidence;
  readonly warning: unknown;
  readonly withRepairMetadataEvidence: boolean;
  readonly withOperationAwarePublication: boolean;
}): void {
  const operationContract = installerTrustFaultOperationContract(input.id);
  const success = operationContract.outcome === "passed";
  const terminalSnapshot = input.snapshots.at(-1);
  const baselineSnapshot =
    input.id === "reused-object-corruption" ||
    input.id === "final-verification-corruption" ||
    input.id === "repeated-server-corruption"
      ? input.snapshots[1]
      : input.snapshots[0];
  const terminal = terminalSnapshot?.installerTransfer;
  const terminalTransition = isLegacyTransitions(input.transitions)
    ? input.transitions.filter((transition) => transition.phase.startsWith("attempt-")).at(-1)
    : proofFinalTransition(input.transitions);
  if (
    terminalSnapshot === undefined ||
    terminal === undefined ||
    baselineSnapshot === undefined ||
    terminalTransition === undefined
  ) {
    throw new Error("Installer trust-fault terminal or operation-baseline snapshot is absent");
  }
  if (
    terminalTransition.activeReleaseDigest !== input.post.activeReleaseDigest ||
    terminalTransition.releaseDigest !== input.post.uiReleaseDigest ||
    terminalTransition.shellGenerationId !== input.post.uiShellGenerationId ||
    terminalTransition.transferState !== terminal.state ||
    terminalTransition.storeState !== terminalSnapshot.installStore.state ||
    terminalTransition.uiState !== (success ? "ready" : "failed") ||
    terminalTransition.failureCode !== terminal.failureCode ||
    terminalTransition.failureResourceId !== terminal.failureResourceId
  ) {
    throw new Error("Installer trust-fault raw terminal UI/store/transfer identity differs");
  }
  if (
    input.post.operationInitialActiveReleaseDigest !==
      baselineSnapshot.installStore.activeReleaseDigest ||
    input.post.operationInitialPreviousReleaseDigest !==
      baselineSnapshot.installStore.previousReleaseDigest ||
    input.post.operationInitialPublicationCount !==
      baselineSnapshot.installStore.publicationCount ||
    input.post.activeReleaseDigest !== terminalSnapshot.installStore.activeReleaseDigest ||
    input.post.previousReleaseDigest !== terminalSnapshot.installStore.previousReleaseDigest ||
    input.post.terminalPublicationCount !== terminalSnapshot.installStore.publicationCount
  ) {
    throw new Error("Installer trust-fault publication evidence differs from exact snapshots");
  }
  const expectedDeclaredScopes: readonly InstallerTrustFaultMutationScope[] = success
    ? ["indexeddb", "install-root", "selection", "shell-cache"]
    : input.id === "repeated-server-corruption"
      ? ["install-root", "selection"]
      : ["install-root"];
  if (
    canonical(input.post.mutationEvidence.declaredMutableScopes) !==
      canonical(expectedDeclaredScopes) ||
    canonical(input.post.mutationEvidence.pre.selection.entries) !==
      canonical(selectionInventoryEntries(baselineSnapshot)) ||
    canonical(input.post.mutationEvidence.post.selection.entries) !==
      canonical(selectionInventoryEntries(terminalSnapshot))
  ) {
    throw new Error("Installer trust-fault declared mutation or selection inventory is invalid");
  }
  const saveEntry = `f:trust-sentinel.bin:${42}:${input.post.saveSentinelSha256}`;
  const externalEntries = [
    "d:external-trust-root",
    `f:external-trust-root/trust-sentinel.bin:${42}:${input.post.externalRootSentinelSha256}`,
  ];
  if (
    canonical(input.post.mutationEvidence.pre.saves.entries) !== canonical([saveEntry]) ||
    canonical(input.post.mutationEvidence.post.saves.entries) !== canonical([saveEntry]) ||
    canonical(input.post.mutationEvidence.pre["external-root"].entries) !==
      canonical(externalEntries) ||
    canonical(input.post.mutationEvidence.post["external-root"].entries) !==
      canonical(externalEntries)
  ) {
    throw new Error("Installer trust-fault sentinel inventory is not exact");
  }
  const fresh = input.snapshots[0]?.installStore;
  if (
    fresh === undefined ||
    fresh.activeReleaseDigest !== null ||
    fresh.previousReleaseDigest !== null ||
    fresh.publicationCount !== 0
  ) {
    throw new Error("Installer trust-fault cell did not start from a fresh unselected profile");
  }
  if (
    (input.id === "reused-object-corruption" ||
      input.id === "final-verification-corruption" ||
      input.id === "repeated-server-corruption") &&
    (input.snapshots[1]?.installerTransfer.state !== "ready" ||
      input.snapshots[1]?.installStore.state !== "ready" ||
      input.snapshots[1]?.installStore.activeReleaseDigest !== input.post.targetReleaseDigest ||
      input.snapshots[1]?.installStore.publicationCount !== 1)
  ) {
    throw new Error("Installer trust-fault seed attempt snapshot is not exactly Ready");
  }
  if (
    input.id === "mid-append-quota-resume" &&
    (input.snapshots[1]?.installerTransfer.state !== "failed" ||
      input.snapshots[1]?.installerTransfer.failureCode !== "quota" ||
      input.snapshots[1]?.installerTransfer.failureResourceId !== input.fault.resourceId ||
      input.snapshots[1]?.installStore.publicationCount !== 0 ||
      input.snapshots[1]?.installStore.activeReleaseDigest !== null)
  ) {
    throw new Error("Installer trust-fault retry-boundary snapshot is invalid");
  }
  if (
    terminal.checkpointedBytes !== input.accounting.lifetimeCheckpointedBytes ||
    terminal.downloadedBytes !== input.accounting.lifetimeDownloadedBytes ||
    terminal.operationRepairedBytes !== input.accounting.repairedBytes ||
    terminal.operationRepairedResourceCount !== input.accounting.repairedResourceCount ||
    terminal.resumedBytes !== input.accounting.resumedBytes ||
    terminal.reusedBytes !== input.accounting.reusedBytes ||
    terminal.totalBytes !== input.accounting.totalBytes
  ) {
    throw new Error("Installer trust-fault accounting differs from terminal transfer telemetry");
  }
  const expectedPublication = input.withOperationAwarePublication
    ? projectInstallerTrustFaultTerminalPublication(
        input.fault.events[0]?.operation ?? operationContract.operation,
        operationContract.outcome,
        input.post.operationInitialPublicationCount,
      )
    : Object.freeze({
        publicationOccurred: success,
        terminalPublicationCount: input.post.operationInitialPublicationCount + (success ? 1 : 0),
      });
  if (
    success
      ? terminal.state !== "ready" ||
        input.post.activeReleaseDigest !== input.post.targetReleaseDigest ||
        input.post.launchEnabled !== true ||
        input.post.terminalPublicationCount !== expectedPublication.terminalPublicationCount ||
        input.post.publicationOccurred !== expectedPublication.publicationOccurred ||
        input.accounting.readyBytes !== input.accounting.totalBytes ||
        input.accounting.readyBytes !==
          input.accounting.reusedBytes +
            input.accounting.resumedBytes +
            input.accounting.downloadedBytes
      : terminal.state !== "failed" ||
        input.post.launchEnabled !== false ||
        input.post.publicationOccurred !== expectedPublication.publicationOccurred ||
        input.post.terminalPublicationCount !== expectedPublication.terminalPublicationCount ||
        input.accounting.readyBytes !== 0
  ) {
    throw new Error("Installer trust-fault UI/store/transfer terminal authority is contradictory");
  }
  if (
    (input.id === "reused-object-corruption" || input.id === "final-verification-corruption") &&
    (input.post.operationInitialActiveReleaseDigest !== input.post.targetReleaseDigest ||
      input.post.operationInitialPreviousReleaseDigest !== input.post.previousReleaseDigest ||
      input.post.activeReleaseDigest !== input.post.operationInitialActiveReleaseDigest)
  ) {
    throw new Error("Repair changed or omitted the exact active/previous release authority");
  }
  if (input.id === "repeated-server-corruption") {
    const resource = input.resourceById.get(input.fault.resourceId);
    if (resource === undefined || resource.target !== "opfs" || resource.scope === "app-shell") {
      throw new Error("Repeated corruption resource has no exact OPFS namespace");
    }
    const objectNamespace =
      resource.scope === "common" ? "objects/common" : "objects/games/parallax";
    const markerPath =
      `${objectNamespace}/sha256/${resource.sha256.slice(0, 2)}/` +
      `${resource.sha256}.verified.json`;
    const preInstall = new Set(input.post.mutationEvidence.pre["install-root"].entries);
    const postInstall = new Set(input.post.mutationEvidence.post["install-root"].entries);
    const added = [...postInstall].filter((entry) => !preInstall.has(entry));
    const removed = [...preInstall].filter((entry) => !postInstall.has(entry));
    const repairEligibilityPath = `releases/${input.post.targetReleaseDigest}/repair-eligibility.json`;
    const expectedAdded = input.withRepairMetadataEvidence ? 1 : 0;
    if (input.withRepairMetadataEvidence) {
      requireUnchangedDurablePublicationMetadata(
        input.post.mutationEvidence.pre["install-root"].entries,
        input.post.mutationEvidence.post["install-root"].entries,
        input.post.targetReleaseDigest,
      );
    }
    if (
      added.length !== expectedAdded ||
      (input.withRepairMetadataEvidence &&
        (!added[0]?.startsWith(`f:${repairEligibilityPath}:`) ||
          !/:[0-9]+:[a-f0-9]{64}$/u.test(added[0]))) ||
      removed.length !== 1 ||
      !removed[0]?.startsWith(`f:${markerPath}:`) ||
      !(input.withRepairMetadataEvidence
        ? /:[0-9]+:[a-f0-9]{64}$/u.test(removed[0])
        : /:[0-9]+$/u.test(removed[0]))
    ) {
      throw new Error(
        `Repeated corruption install-store mutation is not exact marker revocation with zero residue; resourceId=${input.fault.resourceId}; delta=${JSON.stringify(
          {
            addedCount: added.length,
            addedEntrySha256: added
              .map((entry) => createHash("sha256").update(entry).digest("hex"))
              .sort()
              .slice(0, 4),
            removedCount: removed.length,
            removedEntrySha256: removed
              .map((entry) => createHash("sha256").update(entry).digest("hex"))
              .sort()
              .slice(0, 4),
          },
        )}`,
      );
    }
    if (input.withRepairMetadataEvidence) {
      const inventories = [
        input.post.mutationEvidence.pre["install-root"].entries,
        input.post.mutationEvidence.post["install-root"].entries,
      ];
      const partialPrefix = `partials/${input.post.targetReleaseDigest}/${resource.id}`;
      const targetResidue = inventories.flatMap((entries) =>
        entries.filter((entry) => {
          const path = inventoryLogicalPath("install-root", entry);
          return (
            path === partialPrefix ||
            path.startsWith(`${partialPrefix}/`) ||
            ((path.includes(resource.id) || path.includes(resource.sha256)) &&
              /(?:^|[/._-])(?:orphan|temp|tmp)(?:$|[/._-])/u.test(path))
          );
        }),
      );
      if (targetResidue.length !== 0) {
        throw new Error(
          `Repeated corruption retained target partial/checkpoint/temp/orphan residue; resourceId=${resource.id}; entrySha256=${JSON.stringify(
            targetResidue
              .map((entry) => createHash("sha256").update(entry).digest("hex"))
              .sort()
              .slice(0, 4),
          )}`,
        );
      }
      if (
        terminalSnapshot.installStore.partialBytes !== 0 ||
        terminalSnapshot.installStore.partialResourceCount !== 0 ||
        terminalSnapshot.installStore.currentCheckpointCount !== 0 ||
        terminalSnapshot.installStore.etagBoundPartialCount !== 0
      ) {
        throw new Error(
          "Repeated corruption terminal install-store partial/checkpoint/ETag telemetry is not exact zero",
        );
      }
    }
  }
  if (
    input.id === "repeated-server-corruption" &&
    (input.post.uiReleaseDigest !== null ||
      input.post.uiShellGenerationId !== null ||
      input.post.operationInitialActiveReleaseDigest !== input.post.targetReleaseDigest ||
      input.post.operationInitialPreviousReleaseDigest !== null ||
      terminalTransition.activeReleaseDigest !== null ||
      input.post.activeReleaseDigest !== null ||
      input.post.previousReleaseDigest !== null ||
      input.attempts[0]?.action !== "repair" ||
      input.attempts[0]?.failureCode !== "integrity" ||
      input.attempts[0]?.failureResourceId !== input.fault.resourceId)
  ) {
    throw new Error(
      "Repeated corruption did not revoke unsafe store/UI/shell authority without publication",
    );
  }
  const boundRequests = input.http.flatMap((request) => {
    const resource = input.resourceByPath.get(request.path);
    return resource === undefined ? [] : [{ request, resource }];
  });
  const operationResourceRequests = boundRequests.filter(
    ({ request, resource }) =>
      (request.phase === "attempt-1" || request.phase === "attempt-2") &&
      request.range !== null &&
      resource.target === "opfs",
  );
  const seedResourceRequests = boundRequests.filter(
    ({ request, resource }) =>
      request.phase === "seed" && request.range !== null && resource.target === "opfs",
  );
  if (
    boundRequests.some(
      ({ request, resource }) => request.range !== null && resource.target !== "opfs",
    )
  ) {
    throw new Error("Installer trust-fault Range response is not bound to an OPFS resource");
  }
  if (
    boundRequests.some(
      ({ request, resource }) => request.range === null && resource.target !== "shell",
    )
  ) {
    throw new Error("Installer trust-fault full response is not bound to a shell resource");
  }
  if (
    boundRequests.some(
      ({ request, resource }) =>
        resource.target === "opfs" &&
        request.range !== null &&
        request.status !== 206 &&
        request.status !== 416 &&
        request.status !== 499,
    )
  ) {
    throw new Error("Installer trust-fault OPFS Range response status is not admissible");
  }
  if (
    boundRequests.some(
      ({ request, resource }) =>
        resource.target === "shell" &&
        request.range === null &&
        request.status !== 200 &&
        request.status !== 304 &&
        (request.status !== 499 || request.method !== "GET"),
    )
  ) {
    throw new Error("Installer trust-fault shell full response status is not admissible");
  }
  const faultResource = input.resourceById.get(input.fault.resourceId);
  if (faultResource === undefined || faultResource.target !== "opfs") {
    throw new Error("Installer trust-fault resource is absent from retained manifest bytes");
  }
  for (const request of input.http) {
    const manifestResource = input.resourceByPath.get(request.path);
    if (request.range !== null && manifestResource === undefined) {
      throw new Error("Installer trust-fault journal has an unbound Range request");
    }
  }
  if (
    terminal.rangeRequestCount - baselineSnapshot.installerTransfer.rangeRequestCount !==
      operationResourceRequests.length ||
    terminal.httpRequestCount - baselineSnapshot.installerTransfer.httpRequestCount !==
      operationResourceRequests.length
  ) {
    throw new Error("Installer trust-fault server journal is incomplete for transfer requests");
  }
  const authoritativeTransportResponses = boundRequests.filter(({ request, resource }) =>
    resource.target === "shell"
      ? request.range === null && (request.status === 200 || request.status === 304)
      : request.range !== null &&
        (request.status === 206 || request.status === 416 || request.status === 499),
  );
  for (const { request, resource } of authoritativeTransportResponses) {
    const interruptedMidAppend =
      input.id === "mid-append-quota-resume" &&
      request.attempt === 1 &&
      resource.id === input.fault.resourceId &&
      request.status === 499 &&
      request.range === "bytes=0-" &&
      request.ifRange === null &&
      request.bodyBytes >= input.fault.offset &&
      request.bodyBytes <= resource.bytes;
    validateInstallerTrustFaultResourceResponse(request, resource, {
      allowInterruptedMidAppend: interruptedMidAppend,
    });
  }
  if (
    input.id === "reused-object-corruption" ||
    input.id === "final-verification-corruption" ||
    input.id === "repeated-server-corruption"
  ) {
    const freshTransfer = input.snapshots[0]?.installerTransfer;
    if (
      freshTransfer === undefined ||
      baselineSnapshot.installerTransfer.rangeRequestCount - freshTransfer.rangeRequestCount !==
        seedResourceRequests.length ||
      baselineSnapshot.installerTransfer.httpRequestCount - freshTransfer.httpRequestCount !==
        seedResourceRequests.length ||
      seedResourceRequests.length === 0 ||
      seedResourceRequests.some(
        ({ request }) =>
          request.range !== "bytes=0-" || request.status !== 206 || request.ifRange !== null,
      )
    ) {
      throw new Error("Installer trust-fault seed Range journal is incomplete");
    }
  } else if (seedResourceRequests.length !== 0) {
    throw new Error("Installer trust-fault non-seeded cell retained seed Range traffic");
  }
  if (input.id === "reused-object-corruption" || input.id === "final-verification-corruption") {
    const repairRequests = operationResourceRequests.filter(
      ({ resource }) => resource.id === input.fault.resourceId,
    );
    if (
      repairRequests.length !== 1 ||
      repairRequests[0]?.request.range !== "bytes=0-" ||
      repairRequests[0]?.request.status !== 206 ||
      repairRequests[0]?.request.ifRange !== null ||
      operationResourceRequests.length !== 1 ||
      input.accounting.repairedResourceCount !== 1 ||
      input.accounting.repairedBytes !== repairRequests[0]?.request.bodyBytes ||
      input.accounting.downloadedBytes !== repairRequests[0]?.request.bodyBytes
    ) {
      throw new Error("Installer trust-fault exact zero-offset repair request is invalid");
    }
  }
  if (input.id === "repeated-server-corruption") {
    const requests = operationResourceRequests.filter(
      ({ resource }) => resource.id === input.fault.resourceId,
    );
    const request = requests[0]?.request;
    const integrityFailureDelta =
      terminal.integrityFailureCount - baselineSnapshot.installerTransfer.integrityFailureCount;
    const downloadedDelta =
      terminal.downloadedBytes - baselineSnapshot.installerTransfer.downloadedBytes;
    if (
      requests.length !== 1 ||
      request === undefined ||
      request.range !== "bytes=0-" ||
      request.status !== 206 ||
      request.ifRange !== null ||
      operationResourceRequests.length !== 1 ||
      request.bodyBytes <= 0 ||
      input.accounting.downloadedBytes !== request.bodyBytes ||
      downloadedDelta !== request.bodyBytes ||
      integrityFailureDelta !== 2 ||
      baselineSnapshot.installerTransfer.operationRepairAttemptCount !== 0 ||
      terminal.operationRepairAttemptCount !== 1 ||
      terminal.operationRepairedResourceCount !== 0 ||
      terminal.operationRepairedBytes !== 0 ||
      input.accounting.repairedResourceCount !== 0 ||
      input.accounting.repairedBytes !== 0 ||
      terminal.failureCode !== "integrity" ||
      terminal.failureResourceId !== input.fault.resourceId
    ) {
      throw new Error(
        "Repeated server corruption counters or single failed repair body are not exact",
      );
    }
  }
  if (input.id === "estimate-clearly-insufficient" && operationResourceRequests.length !== 0) {
    throw new Error("Clearly insufficient estimate performed content transfer");
  }
  if (input.id === "quota-probe-exceeded" && operationResourceRequests.length !== 0) {
    throw new Error("Failed flushed quota probe performed content transfer");
  }
  if (input.id === "estimate-incomplete-probe-success" && operationResourceRequests.length === 0) {
    throw new Error("Incomplete estimate did not continue through probe and transfer");
  }
  if (
    (input.id === "estimate-incomplete-probe-success" || input.id === "persistence-denied") &&
    operationResourceRequests.reduce((total, { request }) => total + request.bodyBytes, 0) !==
      input.accounting.downloadedBytes
  ) {
    throw new Error("Installer trust-fault downloaded counter differs from resource responses");
  }
  if (input.id === "mid-append-quota-resume") {
    const resumed = operationResourceRequests.find(
      ({ request, resource }) =>
        request.attempt === 2 &&
        resource.id === input.fault.resourceId &&
        request.range === `bytes=${input.fault.offset}-`,
    );
    if (
      input.accounting.checkpointedBytes === 0 ||
      input.fault.offset !== 8 * 1024 * 1024 ||
      resumed === undefined ||
      resumed.request.status !== 206 ||
      resumed.request.ifRange !== resumed.request.etag ||
      !operationResourceRequests.some(
        ({ request, resource }) =>
          request.attempt === 1 &&
          resource.id === input.fault.resourceId &&
          request.range === "bytes=0-" &&
          (request.status === 206 || request.status === 499) &&
          request.ifRange === null,
      ) ||
      input.accounting.resumedBytes !== input.fault.offset
    ) {
      throw new Error("Mid-append quota retry did not resume the exact durable checkpoint");
    }
  } else if (input.fault.offset !== 0) {
    throw new Error("Installer trust-fault token used an unexpected nonzero offset");
  }
  if (input.persistence === null) {
    if (
      input.id === "persistence-denied"
        ? input.warning !== "degraded-durability"
        : input.warning !== null
    ) {
      throw new Error("Installer trust-fault persistence warning is contradictory");
    }
  } else {
    validatePersistenceSemantics({ ...input, persistence: input.persistence });
  }
}

function validatePersistenceSemantics(input: {
  readonly id: InstallerTrustFaultCellId;
  readonly persistence: InstallerTrustFaultPersistenceEvidence;
  readonly snapshots: readonly InstallerSnapshot[];
  readonly warning: unknown;
}): void {
  const expected = expectedPersistenceRequests(input.id);
  if (input.persistence.requests.length !== expected.length) {
    throw new Error(
      `Installer trust-fault persistence request count is invalid; cell=${input.id}; expected=${expected.length}; actual=${input.persistence.requests.length}`,
    );
  }
  let persistedBefore = input.persistence.initialPersisted;
  for (let index = 0; index < expected.length; index += 1) {
    const request = input.persistence.requests[index];
    const expectedRequest = expected[index];
    const snapshot = persistenceSnapshot(input.id, request?.phase ?? "attempt-1", input.snapshots);
    if (request === undefined || expectedRequest === undefined || snapshot === undefined) {
      throw new Error(
        `Installer trust-fault persistence request boundary is absent; cell=${input.id}; order=${index + 1}`,
      );
    }
    const classification = request.result
      ? request.persistedBefore
        ? "already-persisted"
        : "granted"
      : "denied";
    const terminalUiState = request.result ? "granted" : "denied";
    const warning = request.result ? null : "degraded-durability";
    if (
      request.phase !== expectedRequest.phase ||
      request.attempt !== expectedRequest.attempt ||
      request.operation !== expectedRequest.operation ||
      request.persistedBefore !== persistedBefore ||
      request.persistedAfter !== request.result ||
      (!request.result && request.persistedBefore) ||
      request.classification !== classification ||
      request.terminalUiState !== terminalUiState ||
      request.warning !== warning ||
      snapshot.installerTransfer.persistedState !== request.persistedAfter
    ) {
      throw new Error(
        `Installer trust-fault persistence authority is contradictory; evidence=${JSON.stringify({
          attempt: request.attempt,
          cell: input.id,
          classification: request.classification,
          operation: request.operation,
          order: request.order,
          persistedAfter: request.persistedAfter,
          persistedBefore: request.persistedBefore,
          phase: request.phase,
          result: request.result,
          telemetry: snapshot.installerTransfer.persistedState,
          terminalUiState: request.terminalUiState,
          warning: request.warning,
        })}`,
      );
    }
    persistedBefore = request.persistedAfter;
  }
  const terminal = input.persistence.requests.at(-1);
  if (
    terminal === undefined ||
    input.warning !== terminal.warning ||
    (input.id === "persistence-denied" &&
      (terminal.phase !== "attempt-1" ||
        terminal.operation !== "install" ||
        terminal.classification !== "denied" ||
        terminal.result !== false ||
        terminal.persistedAfter !== false ||
        terminal.warning !== "degraded-durability"))
  ) {
    throw new Error(
      `Installer trust-fault terminal persistence warning is contradictory; cell=${input.id}; warning=${String(input.warning)}`,
    );
  }
}

function expectedPersistenceRequests(id: InstallerTrustFaultCellId): readonly Readonly<{
  attempt: 1 | 2;
  operation: "install" | "repair";
  phase: "attempt-1" | "attempt-2" | "seed";
}>[] {
  if (
    id === "reused-object-corruption" ||
    id === "final-verification-corruption" ||
    id === "repeated-server-corruption"
  ) {
    return Object.freeze([
      { attempt: 1, operation: "install", phase: "seed" },
      { attempt: 1, operation: "repair", phase: "attempt-1" },
    ]);
  }
  if (id === "mid-append-quota-resume") {
    return Object.freeze([
      { attempt: 1, operation: "install", phase: "attempt-1" },
      { attempt: 2, operation: "install", phase: "attempt-2" },
    ]);
  }
  return Object.freeze([{ attempt: 1, operation: "install", phase: "attempt-1" }]);
}

function persistenceSnapshot(
  id: InstallerTrustFaultCellId,
  phase: "attempt-1" | "attempt-2" | "seed",
  snapshots: readonly InstallerSnapshot[],
): InstallerSnapshot | undefined {
  if (phase === "seed") return snapshots[1];
  if (id === "mid-append-quota-resume") return phase === "attempt-1" ? snapshots[1] : snapshots[2];
  return snapshots.at(-1);
}

function proofFinalTransition(
  proof: InstallerTrustFaultTransitionProofEvidence,
): InstallerTrustFaultTransition | undefined {
  const state = proof.states[proof.finalStateId - 1];
  return state === undefined ? undefined : { ...state, order: proof.lastOrder };
}

function isLegacyTransitions(
  input: InstallerTrustFaultLegacyTransitions | InstallerTrustFaultTransitionProofEvidence,
): input is InstallerTrustFaultLegacyTransitions {
  return Array.isArray(input);
}

function selectionInventoryEntries(snapshot: InstallerSnapshot): readonly string[] {
  return Object.freeze(
    [
      `active:${snapshot.installStore.activeReleaseDigest ?? "null"}`,
      `previous:${snapshot.installStore.previousReleaseDigest ?? "null"}`,
      `publications:${snapshot.installStore.publicationCount}`,
    ].sort(),
  );
}

function decodeCanonicalBase64url(input: unknown, label: string): Buffer {
  if (
    typeof input !== "string" ||
    input.length < 4 ||
    input.length > 4 * 1024 * 1024 ||
    !/^[A-Za-z0-9_-]+$/u.test(input)
  ) {
    throw new Error(`Installer trust-fault ${label} bytes are invalid`);
  }
  const bytes = Buffer.from(input, "base64url");
  if (bytes.length === 0 || bytes.toString("base64url") !== input) {
    throw new Error(`Installer trust-fault ${label} bytes are not canonical base64url`);
  }
  return bytes;
}

function validateManifestBytes(
  buildBytes: Buffer,
  installBytes: Buffer,
): {
  readonly resourceById: ReadonlyMap<string, InstallerTrustFaultManifestResource>;
  readonly resourceByPath: ReadonlyMap<string, InstallerTrustFaultManifestResource>;
  readonly resources: readonly InstallerTrustFaultManifestResource[];
} {
  let buildValue: unknown;
  let installValue: unknown;
  try {
    buildValue = JSON.parse(buildBytes.toString("utf8")) as unknown;
    installValue = JSON.parse(installBytes.toString("utf8")) as unknown;
  } catch (error: unknown) {
    throw new Error("Installer trust-fault retained manifest bytes are not valid JSON", {
      cause: error,
    });
  }
  const build = record(buildValue, "retained build manifest");
  exact(build, [
    "artifacts",
    "gameContentEntrypoints",
    "installManifestEntrypoint",
    "offlineShell",
    "schemaVersion",
    "workerEntrypoints",
  ]);
  if (!positive(build.schemaVersion) || !Array.isArray(build.artifacts)) {
    throw new Error("Installer trust-fault retained build manifest identity is invalid");
  }
  const installEntrypoint = record(
    build.installManifestEntrypoint,
    "retained install manifest entrypoint",
  );
  exact(installEntrypoint, ["path", "schemaVersion"]);
  if (installEntrypoint.path !== "install-manifest.json" || installEntrypoint.schemaVersion !== 1) {
    throw new Error("Installer trust-fault retained install entrypoint is invalid");
  }
  const artifacts = new Map<string, { readonly bytes: number; readonly sha256: string }>();
  for (const rawArtifact of build.artifacts) {
    const artifact = record(rawArtifact, "retained build artifact");
    exact(artifact, ["bytes", "path", "sha256"]);
    if (
      !positive(artifact.bytes) ||
      typeof artifact.path !== "string" ||
      !safeManifestSource(artifact.path) ||
      typeof artifact.sha256 !== "string" ||
      !SHA256.test(artifact.sha256) ||
      artifacts.has(artifact.path)
    ) {
      throw new Error("Installer trust-fault retained build artifact is invalid");
    }
    artifacts.set(artifact.path, {
      bytes: artifact.bytes as number,
      sha256: artifact.sha256,
    });
  }
  const install = record(installValue, "retained install manifest");
  exact(install, ["gameId", "resources", "schemaVersion"]);
  if (
    install.gameId !== "parallax" ||
    install.schemaVersion !== 1 ||
    !Array.isArray(install.resources) ||
    install.resources.length < 1 ||
    install.resources.length > 4096
  ) {
    throw new Error("Installer trust-fault retained install manifest identity is invalid");
  }
  const resourceById = new Map<string, InstallerTrustFaultManifestResource>();
  const resourceByPath = new Map<string, InstallerTrustFaultManifestResource>();
  const resources: InstallerTrustFaultManifestResource[] = [];
  for (const rawResource of install.resources) {
    const resource = record(rawResource, "retained install resource");
    exact(resource, ["bytes", "id", "kind", "scope", "sha256", "source", "target"]);
    if (
      !positive(resource.bytes) ||
      typeof resource.id !== "string" ||
      !RESOURCE_ID.test(resource.id) ||
      typeof resource.sha256 !== "string" ||
      !SHA256.test(resource.sha256) ||
      typeof resource.source !== "string" ||
      !safeManifestSource(resource.source) ||
      typeof resource.kind !== "string" ||
      !validRetainedResourcePlacement(resource.scope, resource.target, resource.kind) ||
      (resource.scope !== "app-shell" &&
        resource.scope !== "common" &&
        resource.scope !== "game-specific") ||
      (resource.target !== "opfs" && resource.target !== "shell") ||
      resourceById.has(resource.id) ||
      resourceByPath.has(`/${resource.source}`)
    ) {
      throw new Error("Installer trust-fault retained install resource is invalid");
    }
    const artifact = artifacts.get(resource.source);
    if (
      artifact !== undefined &&
      (artifact.bytes !== resource.bytes || artifact.sha256 !== resource.sha256)
    ) {
      throw new Error("Installer trust-fault build/install manifest resource identity differs");
    }
    const retained = Object.freeze({
      bytes: resource.bytes as number,
      id: resource.id,
      kind: resource.kind,
      path: `/${resource.source}`,
      scope: resource.scope,
      sha256: resource.sha256,
      source: resource.source,
      target: resource.target,
    });
    resourceById.set(retained.id, retained);
    resourceByPath.set(retained.path, retained);
    resources.push(retained);
  }
  return Object.freeze({
    resourceById,
    resourceByPath,
    resources: Object.freeze(resources),
  });
}

function validRetainedResourcePlacement(
  scope: unknown,
  target: unknown,
  kind: unknown,
): kind is InstallerTrustFaultManifestResource["kind"] {
  if (typeof scope !== "string" || typeof target !== "string" || typeof kind !== "string") {
    return false;
  }
  return RETAINED_RESOURCE_PLACEMENTS.has(`${scope}/${target}/${kind}`);
}

function safeManifestSource(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 512 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..") &&
    /^[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/u.test(value)
  );
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Installer trust-fault ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error("Installer trust-fault evidence has unknown, missing, or extra keys");
  }
}

function timestamp(value: unknown, label: string): void {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Installer trust-fault ${label} is invalid`);
  }
}

function positive(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonnegative(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function canonical(value: unknown): string {
  return canonicalJson(value);
}
