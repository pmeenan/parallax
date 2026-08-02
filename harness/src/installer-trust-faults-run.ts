import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  assertCanonicalInstallerFailureDiagnostic,
  INSTALLER_FAILURE_RULES,
  type InstallerFailureClass,
  type InstallerFailureCode,
  type InstallerFailureEvidence,
  type InstallerFailureOperation,
  installerFailureRecoveryAction,
  isCanonicalInstallerFailureMessage,
  type OfflineShellFailureCode,
} from "@parallax/engine";
import { canonicalJson, historicalCaseFoldedCanonicalJson } from "./canonical-json.js";
import { validateInstallStoreTelemetryProjection } from "./install-store-telemetry.js";
import {
  INSTALLER_TRUST_TRANSITION_BINDING_FAILURE_MESSAGE,
  INSTALLER_TRUST_TRANSITION_REJECTION_MESSAGE,
  type InstallerTrustTransitionAnyBindingDiagnosticEvidence,
  type InstallerTrustTransitionFailedPredicateEvidence,
  type InstallerTrustTransitionPreviousStateEvidence,
  readTrustedInstallerTrustTransitionBindingDiagnostic,
} from "./installer-trust-faults-binding-diagnostic.js";
import {
  InstallerTrustFaultLifecycleAggregateError,
  InstallerTrustFaultOperationError,
} from "./installer-trust-faults-lifecycle.js";
import {
  INSTALLER_TRUST_FAULT_CELL_IDS,
  INSTALLER_TRUST_FAULTS_CONTRACT,
  INSTALLER_TRUST_FAULTS_LEGACY_SCHEMA_VERSION,
  INSTALLER_TRUST_FAULTS_PERSISTENCE_SCHEMA_VERSION,
  INSTALLER_TRUST_FAULTS_PREVIOUS_SCHEMA_VERSION,
  INSTALLER_TRUST_FAULTS_PROOF_SCHEMA_VERSION,
  INSTALLER_TRUST_FAULTS_SCHEMA_VERSION,
  type InstallerTrustFaultAuthority,
  type InstallerTrustFaultCellV5 as InstallerTrustFaultCell,
  type InstallerTrustFaultCellEvidence,
  type InstallerTrustFaultCellId,
  type InstallerTrustFaultResultProofSemantics,
  type InstallerTrustFaultsResultV5 as InstallerTrustFaultsResult,
  type InstallerTrustFaultTransferTelemetrySchemaVersion,
  installerTrustFaultOperationContract,
  parseInstallerTrustFaultAuthority,
  parseInstallerTrustFaultCell,
  parseInstallerTrustFaultCellLegacy,
  parseInstallerTrustFaultCellV2,
  parseInstallerTrustFaultCellV3,
  parseInstallerTrustFaultCellV4,
  parseInstallerTrustFaultManifestResources,
  projectInstallerTrustFaultTerminalPublication,
  selectInstallerTrustFaultResource,
  validateInstallerTrustFaultsResult,
} from "./installer-trust-faults-result.js";
import {
  INSTALLER_TRUST_FAULT_CORRECTNESS_CEILING_MS,
  INSTALLER_TRUST_FAULT_TERMINAL_EVIDENCE_ERROR_NAME,
  type InstallerTrustFaultCellTerminalEvidence,
  InstallerTrustFaultCellTerminalEvidenceError,
} from "./installer-trust-faults-terminal-evidence.js";
import {
  findTrustedInstallerTrustFaultRawObservationEvidence,
  INSTALLER_TRUST_FAULT_ESTIMATE_FINALIZATION_FAILED_PREDICATES,
  INSTALLER_TRUST_FAULT_TRANSITION_PROOF_PREVIOUS_SCHEMA_VERSION,
  INSTALLER_TRUST_FAULT_TRANSITION_PROOF_SCHEMA_VERSION,
  type InstallerTrustFaultEstimateFinalizationDiagnostic,
  validateInstallerTrustFaultRawObservationEvidence,
  validateInstallerTrustFaultTransitionProof,
  validateRetainedInstallerTrustFaultAsynchronousHandoffRawObservationEvidence,
} from "./installer-trust-faults-transition-proof.js";
import {
  INSTALLER_TRUST_FAULT_STORE_STATES,
  INSTALLER_TRUST_FAULT_TRANSFER_STATES,
  INSTALLER_TRUST_FAULT_UI_STATES,
} from "./installer-trust-faults-transitions.js";
import { ResultPairPublicationError, type ResultPairReservation } from "./result-pair.js";

const MAX_FAILURE_TEXT = 500;
const MAX_FAILURE_NAME = 80;
const MAX_FAILURE_OPERATION = 120;
const MAX_FAILURE_DEPTH = 8;
const MAX_FAILURE_NODES = 32;
const MAX_AGGREGATE_MEMBERS = 8;
const MAX_CLEANUP_FAILURES = 8;
const INSTALLER_TRUST_FAULT_ESTIMATE_FINALIZATION_FAILURE_MESSAGE =
  "Installer trust-fault transition proof estimate-insufficient terminal is invalid";
const INSTALLER_TRUST_PRODUCT_TERMINAL_FAILURE_CODES = new Set<string>([
  "cancel-target-invalid",
  "cancelled",
  "concurrent-install",
  "disposed",
  "install-manifest-invalid",
  "integrity",
  "launch",
  "persistence",
  "protocol",
  "quota",
  "shell-contract",
  "shell-incompatible",
  "shell-release-mismatch",
  "shell-unavailable",
  "store",
  "transport",
  "unknown",
  "validator",
] satisfies readonly Exclude<InstallerTrustProductTerminalFailureCode, null>[]);
const INSTALL_STORE_STATES = new Set<string>(INSTALLER_TRUST_FAULT_STORE_STATES);
const INSTALLER_TRANSFER_STATES = new Set<string>(INSTALLER_TRUST_FAULT_TRANSFER_STATES);
const INSTALLER_UI_STATES = new Set<string>(INSTALLER_TRUST_FAULT_UI_STATES);
const INSTALLER_FAILURE_CODES = new Set<string>(INSTALLER_FAILURE_RULES.map((rule) => rule.code));
const INSTALLER_FAILURE_RESOURCE_RELATIONSHIPS = new Map<string, ReadonlySet<boolean>>(
  [...INSTALLER_FAILURE_CODES].map((code) => [
    code,
    new Set(
      INSTALLER_FAILURE_RULES.filter((rule) => rule.code === code).flatMap((rule) =>
        rule.resourcePresence === "required"
          ? [true]
          : rule.resourcePresence === "forbidden"
            ? [false]
            : [false, true],
      ),
    ),
  ]),
);

export const INSTALLER_TRUST_FAULT_LEGACY_RUN_SCHEMA_VERSION = 2;
export const INSTALLER_TRUST_FAULT_PREVIOUS_RUN_SCHEMA_VERSION = 3;
export const INSTALLER_TRUST_FAULT_PROOF_RUN_SCHEMA_VERSION = 4;
export const INSTALLER_TRUST_FAULT_PERSISTENCE_RUN_SCHEMA_VERSION = 5;
export const INSTALLER_TRUST_FAULT_PHYSICAL_OBSERVER_RUN_SCHEMA_VERSION = 6;
export const INSTALLER_TRUST_FAULT_PRODUCT_TERMINAL_RUN_SCHEMA_VERSION = 7;
export const INSTALLER_TRUST_FAULT_CELL_VALIDATION_RUN_SCHEMA_VERSION = 8;
export const INSTALLER_TRUST_FAULT_BINDING_DIAGNOSTIC_RUN_SCHEMA_VERSION = 9;
export const INSTALLER_TRUST_FAULT_TERMINAL_REPEAT_RUN_SCHEMA_VERSION = 10;
export const INSTALLER_TRUST_FAULT_RUN_SCHEMA_VERSION = 11;
export const INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION = 12;
export const INSTALLER_TRUST_FAULT_CELL_VALIDATION_ERROR_NAME =
  "InstallerTrustFaultCellValidationError";
export const INSTALLER_TRUST_FAULT_MAX_CANONICAL_PAYLOAD_BYTES = 4 * 1024 * 1024;
export const INSTALLER_TRUST_FAULT_MAX_SERIALIZED_JSON_REPORT_BYTES = 8 * 1024 * 1024;
export const INSTALLER_TRUST_FAULT_MAX_SERIALIZED_MARKDOWN_REPORT_BYTES = 6 * 1024 * 1024;

const RETAINED_ASYNC_HANDOFF_FAILURE = Object.freeze({
  artifactDigest: "e5c9060ec5cb59430b9d4d8a1f5f310769442bf0e29c189fb39566d8543472dc",
  authoritySha256: "73e36b86315ff8008fec85fd6748c74716f4dd55796203c7a7625d56394ec8c7",
  canonicalBindingSha256: "1b426e3a3aab2d9c47890f94058c37715ac28fc463d7190d48b6e385140006df",
  jsonSha256: "dc62c17f9f5eb3cf1e7d4ce220c0493bed190243615929628c75c5706b64875c",
  markdownSha256: "084c6d19ec362def7d53528f33e252ab9cfb84677a2cc6a53b75cf0d0a5a1402",
  releaseDigest: "ff9f1f810ed3679ef547cd253d62a8880265d13085879b78d94e47ef7a4d9254",
  runId: "84ac6b44-8877-41d4-b08a-e136edaf1a89",
  sourceCommit: "7fdc5465b5903751301a4e319a160848eacefac6",
  sourceDirtyTreeDigest: "ab0b35788706093d242119e6c0c9913c2371e81c41e1d5848cfdbeb61b74f67e",
});

const INSTALLER_TRUST_FAULT_V8_CELL_VALIDATION_PREDICATES = Object.freeze([
  "attempt",
  "cell-contract",
  "cell-id",
  "manifest-resource",
  "operation",
  "phase",
  "post-validation",
  "proof",
  "publication",
  "terminal-store",
  "terminal-transfer",
  "terminal-ui",
] as const);
export const INSTALLER_TRUST_FAULT_CELL_VALIDATION_PREDICATES = Object.freeze([
  "selected-request-count",
  "selected-range-classification",
  "selected-status",
  "selected-if-range",
  "operation-range-request-count",
  "repaired-resource-count",
  "repaired-bytes",
  "downloaded-bytes",
  "attempt",
  "cell-id",
  "manifest-resource",
  "operation",
  "phase",
  "post-validation",
  "proof",
  "publication",
  "terminal-store",
  "terminal-transfer",
  "terminal-ui",
] as const);

export type InstallerTrustFaultCellValidationPredicate =
  (typeof INSTALLER_TRUST_FAULT_CELL_VALIDATION_PREDICATES)[number];

interface InstallerTrustFaultCellValidationEvidence {
  readonly accounting: Readonly<{
    readonly baseline: InstallerTrustFaultCellValidationAccountingSnapshot;
    readonly declaredDownloadedBytes: number | null;
    readonly declaredRepairedBytes: number | null;
    readonly declaredRepairedResourceCount: number | null;
    readonly delta: InstallerTrustFaultCellValidationAccountingSnapshot;
    readonly terminal: InstallerTrustFaultCellValidationAccountingSnapshot;
  }>;
  readonly attempt: 1 | 2;
  readonly faultResourceId: string;
  readonly id: InstallerTrustFaultCellId;
  readonly kind: "cell-validation";
  readonly observed: Readonly<{
    readonly attempt: 1 | 2 | null;
    readonly cellId: InstallerTrustFaultCellId | null;
    readonly faultEventReleaseDigest: string | null;
    readonly faultEventResourceId: string | null;
    readonly faultOperation: "install" | "repair" | null;
    readonly faultReleaseDigest: string | null;
    readonly faultResourceId: string | null;
    readonly outcome: "failed" | "passed" | null;
    readonly phase: "attempt-1" | "attempt-2" | null;
  }>;
  readonly operation: "install" | "repair";
  readonly phase: "attempt-1" | "attempt-2";
  readonly http: Readonly<{
    readonly operationRangeRequestCount: number | null;
    readonly selected: Readonly<{
      readonly bodyBytes: number | null;
      readonly etagMatchesManifest: boolean | null;
      readonly ifRangeMatchesEtag: boolean | null;
      readonly ifRangePresent: boolean | null;
      readonly manifestPathMatch: boolean | null;
      readonly pathSha256: string | null;
      readonly rangeClassification: "absent" | "exact-zero-offset" | "other" | null;
      readonly responseKind: "full" | "other" | "range" | null;
      readonly sameOriginPath: boolean | null;
      readonly status: number | null;
    }> | null;
    readonly selectedRequestCount: number | null;
  }>;
  readonly post: Readonly<{
    readonly activeReleaseDigest: string | null;
    readonly launchEnabled: boolean | null;
    readonly operationInitialActiveReleaseDigest: string | null;
    readonly operationInitialPreviousReleaseDigest: string | null;
    readonly operationInitialPublicationCount: number | null;
    readonly previousReleaseDigest: string | null;
    readonly publicationOccurred: boolean | null;
    readonly targetReleaseDigest: string | null;
    readonly terminalPublicationCount: number | null;
    readonly uiReleaseDigest: string | null;
    readonly uiShellGenerationId: string | null;
  }>;
  readonly proof: Readonly<{
    readonly finalStateId: number | null;
    readonly lastOrder: number | null;
    readonly streamSha256: string | null;
    readonly terminalStateSha256: string | null;
  }>;
  readonly terminal: Readonly<{
    readonly store: Readonly<{
      readonly activeReleaseDigest: string | null;
      readonly currentReleaseDigest: string | null;
      readonly currentResourceId: string | null;
      readonly failureMessageSha256: string | null;
      readonly previousReleaseDigest: string | null;
      readonly publicationCount: number | null;
      readonly state: string | null;
    }>;
    readonly transfer: Readonly<{
      readonly activeReleaseDigest: string | null;
      readonly failureCode: string | null;
      readonly failureMessageSha256: string | null;
      readonly failureOperation: "install" | "repair" | null;
      readonly failureResourceId: string | null;
      readonly state: string | null;
    }>;
    readonly ui: Readonly<{
      readonly activeReleaseDigest: string | null;
      readonly failureCode: string | null;
      readonly failureResourceId: string | null;
      readonly releaseDigest: string | null;
      readonly shellGenerationId: string | null;
      readonly storeState: string | null;
      readonly transferState: string | null;
      readonly uiState: string | null;
    }>;
  }>;
  readonly violatedPredicates: readonly InstallerTrustFaultCellValidationPredicate[];
}

interface InstallerTrustFaultCellValidationAccountingSnapshot {
  readonly completedResourceCount: number | null;
  readonly downloadedBytes: number | null;
  readonly repairedBytes: number | null;
  readonly repairedResourceCount: number | null;
}

type InstallerTrustProductTerminalFailureCode =
  | InstallerFailureCode
  | OfflineShellFailureCode
  | "launch"
  | "persistence"
  | null;

type SanitizedFailureKind =
  | "aggregate"
  | "cycle"
  | "error"
  | "non-error"
  | "redacted"
  | "truncated";

export interface InstallerTrustFaultSanitizedFailureNode {
  readonly cause: InstallerTrustFaultSanitizedFailureNode | null;
  readonly errors: readonly InstallerTrustFaultSanitizedFailureNode[];
  readonly kind: SanitizedFailureKind;
  readonly message: string;
  readonly name: string;
  readonly operation: string | null;
  readonly stage: "cleanup" | "primary" | null;
  readonly proofFinalizationDiagnostic?: InstallerTrustFaultEstimateFinalizationDiagnostic;
  readonly transitionBindingDiagnostic?: InstallerTrustTransitionAnyBindingDiagnosticEvidence;
}

export interface InstallerTrustCanonicalBinding {
  readonly payloadBase64url: string;
  readonly sha256: string;
}

export interface InstallerTrustFaultRuntimeDependencies {
  readonly executeCell: (
    id: InstallerTrustFaultCellId,
    authority: InstallerTrustFaultAuthority,
  ) => Promise<InstallerTrustFaultCell>;
  readonly postValidate: (authority: InstallerTrustFaultAuthority) => Promise<void>;
  readonly preflight: () => Promise<InstallerTrustFaultAuthority>;
}

export interface InstallerTrustFaultRunScheduledDeadline {
  readonly cancel: () => void;
}

export interface InstallerTrustFaultRunDependencies {
  readonly createRuntimeDependencies: () => Promise<InstallerTrustFaultRuntimeDependencies>;
  readonly now: () => Date;
  readonly reserve: (
    resultRoot: string,
    startedAt: string,
    pending: Readonly<Record<string, unknown>>,
  ) => Promise<ResultPairReservation>;
  readonly scheduleDeadline?: (
    milliseconds: number,
    expire: () => void,
  ) => InstallerTrustFaultRunScheduledDeadline;
}

export interface InstallerTrustFaultRunOutcome {
  readonly jsonPath: string;
  readonly markdownPath: string;
  readonly state: "failed" | "passed";
}

export const INSTALLER_TRUST_FAULT_PROGRESS_STALL_MS = 120_000;

export class InstallerTrustFaultRunTimeoutError extends Error {
  public constructor(
    public readonly classification: "absolute" | "stall",
    public readonly phase: string,
    public readonly timeoutMs: number,
  ) {
    super(
      `Installer trust-fault ${classification} deadline expired after ${timeoutMs} ms during ${phase}`,
    );
    this.name = "InstallerTrustFaultRunTimeoutError";
  }
}

export class InstallerTrustFaultCellValidationError extends Error {
  public constructor(
    public readonly cellId: InstallerTrustFaultCellId,
    cause: unknown,
  ) {
    super(`Installer trust-fault cell ${cellId} failed independent result validation`, { cause });
    this.name = INSTALLER_TRUST_FAULT_CELL_VALIDATION_ERROR_NAME;
  }
}

function resolveRunProofSemantics(
  value: Record<string, unknown>,
  retainedProofSemantics?: "historical-active-raw-v2",
): InstallerTrustFaultResultProofSemantics {
  if (value.schemaVersion !== INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION) {
    if (retainedProofSemantics !== undefined) {
      throw new Error("Installer trust-fault retained proof semantics target only schema-12");
    }
    return typeof value.schemaVersion === "number" && value.schemaVersion >= 5
      ? "historical-closed-world-v2"
      : "legacy-closed-world";
  }
  return retainedProofSemantics ?? "active-raw";
}

export function validateInstallerTrustFaultRunEvidence(input: unknown): void {
  validateInstallerTrustFaultRunEvidenceWithProofSemantics(input);
}

function validateInstallerTrustFaultRunEvidenceWithProofSemantics(
  input: unknown,
  retainedProofSemantics?: "historical-active-raw-v2",
  retainedTransferTelemetrySchemaVersion?: 6,
): void {
  const value = normalizeOwnedRunEvidence(object(input, "run evidence"));
  const proofSemantics = resolveRunProofSemantics(value, retainedProofSemantics);
  if (
    retainedTransferTelemetrySchemaVersion !== undefined &&
    value.schemaVersion !== INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION
  ) {
    throw new Error("Installer trust-fault retained transfer schema target only schema-12");
  }
  const transferTelemetrySchemaVersion =
    retainedTransferTelemetrySchemaVersion ??
    (value.schemaVersion === INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION &&
    proofSemantics === "active-raw"
      ? 9
      : 6);
  if (value.schemaVersion === INSTALLER_TRUST_FAULTS_LEGACY_SCHEMA_VERSION) {
    validateInstallerTrustFaultRunEvidenceV1(value);
    return;
  }
  if (
    value.schemaVersion !== INSTALLER_TRUST_FAULT_LEGACY_RUN_SCHEMA_VERSION &&
    value.schemaVersion !== INSTALLER_TRUST_FAULT_PREVIOUS_RUN_SCHEMA_VERSION &&
    value.schemaVersion !== INSTALLER_TRUST_FAULT_PROOF_RUN_SCHEMA_VERSION &&
    value.schemaVersion !== INSTALLER_TRUST_FAULT_PERSISTENCE_RUN_SCHEMA_VERSION &&
    value.schemaVersion !== INSTALLER_TRUST_FAULT_PHYSICAL_OBSERVER_RUN_SCHEMA_VERSION &&
    value.schemaVersion !== INSTALLER_TRUST_FAULT_PRODUCT_TERMINAL_RUN_SCHEMA_VERSION &&
    value.schemaVersion !== INSTALLER_TRUST_FAULT_CELL_VALIDATION_RUN_SCHEMA_VERSION &&
    value.schemaVersion !== INSTALLER_TRUST_FAULT_BINDING_DIAGNOSTIC_RUN_SCHEMA_VERSION &&
    value.schemaVersion !== INSTALLER_TRUST_FAULT_TERMINAL_REPEAT_RUN_SCHEMA_VERSION &&
    value.schemaVersion !== INSTALLER_TRUST_FAULT_RUN_SCHEMA_VERSION &&
    value.schemaVersion !== INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION
  ) {
    throw new Error("Installer trust-fault run evidence schema is invalid");
  }
  if (
    value.schemaVersion === INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION &&
    value.state !== "pending" &&
    Buffer.byteLength(JSON.stringify(value, null, 2), "utf8") >
      INSTALLER_TRUST_FAULT_MAX_SERIALIZED_JSON_REPORT_BYTES
  ) {
    throw new Error("Installer trust-fault schema-12 terminal JSON exceeds its byte bound");
  }
  const state = value.state;
  if (state === "pending") {
    exactKeys(value, [
      "authority",
      "cells",
      "contract",
      "resultSchemaVersion",
      "runId",
      "schemaVersion",
      "startedAt",
      "state",
    ]);
    validateRunIdentity(value);
    validatePartialCells(
      value.authority,
      value.cells,
      value.resultSchemaVersion,
      proofSemantics,
      transferTelemetrySchemaVersion,
    );
    return;
  }
  if (state === "failed") {
    const failedKeys = [
      "authority",
      "canonicalBinding",
      "cells",
      "completedAt",
      "contract",
      "failure",
      "resultSchemaVersion",
      "runId",
      "schemaVersion",
      "startedAt",
      "state",
      ...(value.schemaVersion === INSTALLER_TRUST_FAULT_PRODUCT_TERMINAL_RUN_SCHEMA_VERSION ||
      value.schemaVersion === INSTALLER_TRUST_FAULT_CELL_VALIDATION_RUN_SCHEMA_VERSION ||
      value.schemaVersion === INSTALLER_TRUST_FAULT_BINDING_DIAGNOSTIC_RUN_SCHEMA_VERSION ||
      value.schemaVersion === INSTALLER_TRUST_FAULT_TERMINAL_REPEAT_RUN_SCHEMA_VERSION ||
      value.schemaVersion === INSTALLER_TRUST_FAULT_RUN_SCHEMA_VERSION ||
      value.schemaVersion === INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION
        ? ["failedCell"]
        : []),
    ];
    exactKeys(value, failedKeys);
    validateRunIdentity(value);
    validateCanonicalBinding(value);
    timestamp(value.completedAt, "completion");
    const completedCells = validatePartialCells(
      value.authority,
      value.cells,
      value.resultSchemaVersion,
      proofSemantics,
      transferTelemetrySchemaVersion,
    );
    const failure = object(value.failure, "failure");
    exactKeys(failure, ["cleanupFailures", "phase", "primary"]);
    if (
      (failure.phase !== "cell" &&
        failure.phase !== "post-validation" &&
        failure.phase !== "preflight") ||
      !Array.isArray(failure.cleanupFailures) ||
      failure.cleanupFailures.length > MAX_CLEANUP_FAILURES
    ) {
      throw new Error("Installer trust-fault failure evidence is invalid");
    }
    if (failure.primary !== null) {
      validateSanitizedFailureNode(failure.primary, 0, { nodes: 0 }, value.schemaVersion);
      if (object(failure.primary, "primary failure node").stage === "cleanup") {
        throw new Error("Installer trust-fault primary evidence has cleanup stage");
      }
    }
    if (failure.primary === null && failure.cleanupFailures.length === 0) {
      throw new Error("Installer trust-fault failed evidence has no retained failure");
    }
    for (const rawCleanup of failure.cleanupFailures) {
      validateSanitizedFailureNode(rawCleanup, 0, { nodes: 0 }, value.schemaVersion);
      if (object(rawCleanup, "cleanup failure node").stage === "primary") {
        throw new Error("Installer trust-fault cleanup evidence has primary stage");
      }
    }
    const primaryRecord =
      failure.primary === null ? null : object(failure.primary, "primary failure node");
    const proofFinalizationDiagnosticCount =
      sanitizedFailureProofFinalizationDiagnosticCount(failure.primary) +
      failure.cleanupFailures.reduce(
        (count, cleanup) => count + sanitizedFailureProofFinalizationDiagnosticCount(cleanup),
        0,
      );
    if (value.schemaVersion === INSTALLER_TRUST_FAULT_RUN_SCHEMA_VERSION) {
      const reservedMessageCount =
        sanitizedFailureMessageCount(
          failure.primary,
          INSTALLER_TRUST_FAULT_ESTIMATE_FINALIZATION_FAILURE_MESSAGE,
        ) +
        failure.cleanupFailures.reduce(
          (count, cleanup) =>
            count +
            sanitizedFailureMessageCount(
              cleanup,
              INSTALLER_TRUST_FAULT_ESTIMATE_FINALIZATION_FAILURE_MESSAGE,
            ),
          0,
        );
      if (reservedMessageCount !== proofFinalizationDiagnosticCount) {
        throw new Error(
          "Installer trust-fault reserved proof finalization message lacks exact diagnostic provenance",
        );
      }
      if (proofFinalizationDiagnosticCount !== 0) {
        const directCause =
          primaryRecord?.cause === null || primaryRecord?.cause === undefined
            ? null
            : object(primaryRecord.cause, "primary failure cause");
        if (
          proofFinalizationDiagnosticCount !== 1 ||
          reservedMessageCount !== 1 ||
          primaryRecord === null ||
          primaryRecord.kind !== "error" ||
          primaryRecord.name !== "InstallerTrustFaultOperationError" ||
          primaryRecord.message !== "Installer trust-fault read-terminal-evidence failed" ||
          primaryRecord.operation !== "read-terminal-evidence" ||
          primaryRecord.stage !== "primary" ||
          Object.hasOwn(primaryRecord, "proofFinalizationDiagnostic") ||
          directCause === null ||
          !Object.hasOwn(directCause, "proofFinalizationDiagnostic") ||
          directCause.message !== INSTALLER_TRUST_FAULT_ESTIMATE_FINALIZATION_FAILURE_MESSAGE ||
          failure.phase !== "cell" ||
          failure.cleanupFailures.length !== 0 ||
          completedCells.length !== 3 ||
          completedCells.some((cell, index) => cell.id !== INSTALLER_TRUST_FAULT_CELL_IDS[index]) ||
          value.failedCell !== null
        ) {
          throw new Error(
            "Installer trust-fault proof finalization diagnostic lacks exact fourth-cell lifecycle provenance",
          );
        }
      }
    }
    if (value.schemaVersion === INSTALLER_TRUST_FAULT_PRODUCT_TERMINAL_RUN_SCHEMA_VERSION) {
      validateFailedCellEvidence(
        value.failedCell,
        value.authority,
        completedCells,
        failure.phase,
        sanitizedFailureCollectionContainsName(
          failure.primary,
          failure.cleanupFailures,
          INSTALLER_TRUST_FAULT_TERMINAL_EVIDENCE_ERROR_NAME,
        ),
        INSTALLER_TRUST_FAULT_TRANSITION_PROOF_PREVIOUS_SCHEMA_VERSION,
      );
    } else if (
      value.schemaVersion === INSTALLER_TRUST_FAULT_CELL_VALIDATION_RUN_SCHEMA_VERSION ||
      value.schemaVersion === INSTALLER_TRUST_FAULT_BINDING_DIAGNOSTIC_RUN_SCHEMA_VERSION ||
      value.schemaVersion === INSTALLER_TRUST_FAULT_TERMINAL_REPEAT_RUN_SCHEMA_VERSION ||
      value.schemaVersion === INSTALLER_TRUST_FAULT_RUN_SCHEMA_VERSION
    ) {
      validateCurrentFailedCellEvidence(
        value.failedCell,
        value.authority,
        completedCells,
        failure.phase,
        sanitizedFailureCollectionContainsName(
          failure.primary,
          failure.cleanupFailures,
          INSTALLER_TRUST_FAULT_TERMINAL_EVIDENCE_ERROR_NAME,
        ),
        sanitizedFailureCollectionContainsName(
          failure.primary,
          failure.cleanupFailures,
          INSTALLER_TRUST_FAULT_CELL_VALIDATION_ERROR_NAME,
        ),
        value.schemaVersion,
      );
    } else if (value.schemaVersion === INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION) {
      validateRawObservationFailedCellEvidence(
        value.failedCell,
        value.authority,
        completedCells,
        failure.phase,
        sanitizedFailureCollectionContainsName(
          failure.primary,
          failure.cleanupFailures,
          INSTALLER_TRUST_FAULT_TERMINAL_EVIDENCE_ERROR_NAME,
        ),
        sanitizedFailureCollectionContainsName(
          failure.primary,
          failure.cleanupFailures,
          INSTALLER_TRUST_FAULT_CELL_VALIDATION_ERROR_NAME,
        ),
        proofSemantics,
      );
    }
    return;
  }
  if (state === "passed") {
    exactKeys(value, [
      "authority",
      "canonicalBinding",
      "cells",
      "completedAt",
      "contract",
      "passed",
      "resultSchemaVersion",
      "runId",
      "schemaVersion",
      "startedAt",
      "state",
    ]);
    validateRunIdentity(value);
    validateCanonicalBinding(value);
    const {
      canonicalBinding: _canonicalBinding,
      resultSchemaVersion,
      runId: _runId,
      schemaVersion: _runSchemaVersion,
      state: _state,
      ...resultBase
    } = value;
    const result = { ...resultBase, schemaVersion: resultSchemaVersion };
    validateInstallerTrustFaultsResult(
      result,
      undefined,
      value.schemaVersion === INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION
        ? proofSemantics
        : "legacy-closed-world",
      transferTelemetrySchemaVersion,
    );
    return;
  }
  throw new Error("Installer trust-fault run evidence state is invalid");
}

function validateInstallerTrustFaultRunEvidenceV1(value: Record<string, unknown>): void {
  const state = value.state;
  if (state === "pending") {
    exactKeys(value, [
      "authority",
      "cells",
      "contract",
      "runId",
      "schemaVersion",
      "startedAt",
      "state",
    ]);
    validateRunIdentityV1(value);
    validatePartialCells(
      value.authority,
      value.cells,
      INSTALLER_TRUST_FAULTS_LEGACY_SCHEMA_VERSION,
      "legacy-closed-world",
      6,
    );
    return;
  }
  if (state === "failed") {
    exactKeys(value, [
      "authority",
      "canonicalBinding",
      "cells",
      "completedAt",
      "contract",
      "failure",
      "runId",
      "schemaVersion",
      "startedAt",
      "state",
    ]);
    validateRunIdentityV1(value);
    validateCanonicalBinding(value);
    timestamp(value.completedAt, "completion");
    validatePartialCells(
      value.authority,
      value.cells,
      INSTALLER_TRUST_FAULTS_LEGACY_SCHEMA_VERSION,
      "legacy-closed-world",
      6,
    );
    const failure = object(value.failure, "failure");
    exactKeys(failure, ["cleanupFailures", "message", "name", "phase"]);
    if (
      !boundedFailureString(failure.message, MAX_FAILURE_TEXT) ||
      !boundedFailureString(failure.name, MAX_FAILURE_NAME) ||
      (failure.phase !== "cell" &&
        failure.phase !== "post-validation" &&
        failure.phase !== "preflight") ||
      !Array.isArray(failure.cleanupFailures) ||
      failure.cleanupFailures.length > MAX_CLEANUP_FAILURES
    ) {
      throw new Error("Installer trust-fault v1 failure evidence is invalid");
    }
    for (const rawCleanup of failure.cleanupFailures) {
      const cleanup = object(rawCleanup, "cleanup failure");
      exactKeys(cleanup, ["message", "name"]);
      if (
        !boundedFailureString(cleanup.message, MAX_FAILURE_TEXT) ||
        !boundedFailureString(cleanup.name, MAX_FAILURE_NAME)
      ) {
        throw new Error("Installer trust-fault v1 cleanup failure is invalid");
      }
    }
    return;
  }
  if (state === "passed") {
    exactKeys(value, [
      "authority",
      "canonicalBinding",
      "cells",
      "completedAt",
      "contract",
      "passed",
      "runId",
      "schemaVersion",
      "startedAt",
      "state",
    ]);
    validateRunIdentityV1(value);
    validateCanonicalBinding(value);
    const { canonicalBinding: _canonicalBinding, runId: _runId, state: _state, ...result } = value;
    validateInstallerTrustFaultsResult(result, undefined, "legacy-closed-world", 6);
    return;
  }
  throw new Error("Installer trust-fault v1 run evidence state is invalid");
}

export async function runInstallerTrustFaultQualification(
  resultRoot: string,
  dependencies: InstallerTrustFaultRunDependencies,
): Promise<InstallerTrustFaultRunOutcome> {
  const startedAt = dependencies.now().toISOString();
  const runId = randomUUID();
  const pending = {
    authority: null,
    cells: [],
    contract: INSTALLER_TRUST_FAULTS_CONTRACT,
    resultSchemaVersion: INSTALLER_TRUST_FAULTS_SCHEMA_VERSION,
    runId,
    schemaVersion: INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION,
    startedAt,
    state: "pending",
  } as const;
  validateInstallerTrustFaultRunEvidence(pending);
  const reservation = await dependencies.reserve(resolve(resultRoot), startedAt, pending);
  const watchdog = createInstallerTrustFaultRunWatchdog(dependencies.scheduleDeadline);
  let authority: InstallerTrustFaultAuthority | null = null;
  const cells: InstallerTrustFaultCell[] = [];
  let failedCell: unknown = null;
  let returnedCell: Readonly<{
    readonly id: InstallerTrustFaultCellId;
    readonly raw: unknown;
  }> | null = null;
  let phase: "cell" | "post-validation" | "preflight" = "preflight";
  try {
    const runtimeDependencies = await watchdog.race(
      "runtime-startup",
      awaitInstallerTrustFaultRuntimeDependencies(dependencies),
    );
    authority = await watchdog.race("preflight", runtimeDependencies.preflight());
    const pendingWithAuthority = {
      ...pending,
      authority,
    } as const;
    validateInstallerTrustFaultRunEvidence(pendingWithAuthority);
    await watchdog.race("preflight-evidence", reservation.publishPendingJson(pendingWithAuthority));
    phase = "cell";
    for (const id of INSTALLER_TRUST_FAULT_CELL_IDS) {
      const rawCell: unknown = await watchdog.race(
        `cell:${id}`,
        runtimeDependencies.executeCell(id, authority),
      );
      returnedCell = Object.freeze({ id, raw: rawCell });
      let cell: InstallerTrustFaultCell;
      try {
        cell = parseInstallerTrustFaultCell(rawCell, authority, "active-raw");
        if (cell.id !== id) {
          throw new Error(`Cell executor returned ${cell.id} while running ${id}`);
        }
      } catch (error: unknown) {
        throw new InstallerTrustFaultCellValidationError(id, error);
      }
      returnedCell = null;
      cells.push(cell);
      const pendingWithCell = {
        ...pending,
        authority,
        cells: [...cells],
      } as const;
      validateInstallerTrustFaultRunEvidence(pendingWithCell);
      await watchdog.race(`cell-evidence:${id}`, reservation.publishPendingJson(pendingWithCell));
    }
    phase = "post-validation";
    await watchdog.race("post-validation:initial", runtimeDependencies.postValidate(authority));
    const result: InstallerTrustFaultsResult = {
      authority,
      cells,
      completedAt: dependencies.now().toISOString(),
      contract: INSTALLER_TRUST_FAULTS_CONTRACT,
      passed: true,
      schemaVersion: INSTALLER_TRUST_FAULTS_SCHEMA_VERSION,
      startedAt,
    };
    validateInstallerTrustFaultsResult(result, authority, "active-raw");
    await watchdog.race("post-validation:final", runtimeDependencies.postValidate(authority));
    const passed = bindTerminalEvidence({
      ...result,
      resultSchemaVersion: result.schemaVersion,
      runId,
      schemaVersion: INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION,
      state: "passed",
    } as const);
    validateInstallerTrustFaultRunEvidence(passed);
    const markdown = formatInstallerTrustFaultsMarkdown(result, runId, passed.canonicalBinding);
    validateInstallerTrustFaultTerminalPair(passed, markdown);
    await watchdog.race(
      "terminal-publication",
      reservation.publishPair(passed, markdown, "passed", {
        retainJsonPrimaryOnMarkdownFailure: true,
      }),
    );
    watchdog.close();
    return Object.freeze({
      jsonPath: reservation.jsonPath,
      markdownPath: reservation.markdownPath,
      state: "passed",
    });
  } catch (error: unknown) {
    watchdog.close();
    if (error instanceof ResultPairPublicationError) throw error;
    const rawObservations = findTrustedInstallerTrustFaultRawObservationEvidence(error);
    const cause = sanitizeFailure(error);
    const productTerminal = cause.productTerminal;
    failedCell =
      rawObservations !== null
        ? Object.freeze({ evidence: rawObservations, kind: "raw-observations" as const })
        : productTerminal !== null
          ? Object.freeze({
              evidence: productTerminal,
              kind: "product-terminal" as const,
            })
          : returnedCell === null || authority === null
            ? null
            : createInstallerTrustFaultCellValidationEvidence(
                returnedCell.raw,
                returnedCell.id,
                authority,
              );
    const failed = bindTerminalEvidence({
      authority,
      cells,
      completedAt: dependencies.now().toISOString(),
      contract: INSTALLER_TRUST_FAULTS_CONTRACT,
      failure: { cleanupFailures: cause.cleanupFailures, phase, primary: cause.primary },
      failedCell,
      resultSchemaVersion: INSTALLER_TRUST_FAULTS_SCHEMA_VERSION,
      runId,
      schemaVersion: INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION,
      startedAt,
      state: "failed",
    } as const);
    validateInstallerTrustFaultRunEvidence(failed);
    const markdown = formatFailureMarkdown(failed);
    validateInstallerTrustFaultTerminalPair(failed, markdown);
    await reservation.publishPair(failed, markdown, "failed", {
      retainJsonPrimaryOnMarkdownFailure: true,
    });
    return Object.freeze({
      jsonPath: reservation.jsonPath,
      markdownPath: reservation.markdownPath,
      state: "failed",
    });
  } finally {
    watchdog.close();
    await reservation.close();
  }
}

async function awaitInstallerTrustFaultRuntimeDependencies(
  dependencies: InstallerTrustFaultRunDependencies,
): Promise<InstallerTrustFaultRuntimeDependencies> {
  const runtime = await Promise.resolve().then(dependencies.createRuntimeDependencies);
  if (
    typeof runtime !== "object" ||
    runtime === null ||
    typeof runtime.executeCell !== "function" ||
    typeof runtime.postValidate !== "function" ||
    typeof runtime.preflight !== "function"
  ) {
    throw new Error("Installer trust-fault runtime dependency startup returned an invalid surface");
  }
  return runtime;
}

interface InstallerTrustFaultRunWatchdog {
  close(): void;
  race<T>(phase: string, operation: Promise<T>): Promise<T>;
}

function createInstallerTrustFaultRunWatchdog(
  scheduleDeadline = defaultRunDeadlineScheduler,
): InstallerTrustFaultRunWatchdog {
  const timeout = Promise.withResolvers<never>();
  void timeout.promise.catch(() => undefined);
  let active = true;
  let phase = "reservation";
  let absolute: InstallerTrustFaultRunScheduledDeadline | null = null;
  let stall: InstallerTrustFaultRunScheduledDeadline | null = null;
  absolute = scheduleDeadline(INSTALLER_TRUST_FAULT_CORRECTNESS_CEILING_MS, () => {
    expire("absolute", INSTALLER_TRUST_FAULT_CORRECTNESS_CEILING_MS);
  });
  const scheduleStall = (): void => {
    stall = scheduleDeadline(INSTALLER_TRUST_FAULT_PROGRESS_STALL_MS, () => {
      expire("stall", INSTALLER_TRUST_FAULT_PROGRESS_STALL_MS);
    });
  };
  const close = (): void => {
    if (!active) return;
    active = false;
    absolute?.cancel();
    stall?.cancel();
  };
  function expire(classification: "absolute" | "stall", timeoutMs: number): void {
    if (!active) return;
    active = false;
    absolute?.cancel();
    stall?.cancel();
    timeout.reject(new InstallerTrustFaultRunTimeoutError(classification, phase, timeoutMs));
  }
  scheduleStall();
  return Object.freeze({
    close,
    async race<T>(nextPhase: string, operation: Promise<T>): Promise<T> {
      if (active) {
        phase = nextPhase;
        stall?.cancel();
        scheduleStall();
      }
      return Promise.race([operation, timeout.promise]);
    },
  });
}

const defaultRunDeadlineScheduler = (
  milliseconds: number,
  expire: () => void,
): InstallerTrustFaultRunScheduledDeadline => {
  const timeout = setTimeout(expire, milliseconds);
  return Object.freeze({
    cancel: () => {
      clearTimeout(timeout);
    },
  });
};

export function formatInstallerTrustFaultsMarkdown(
  result: InstallerTrustFaultsResult,
  runId: string,
  binding: InstallerTrustCanonicalBinding,
): string {
  return [
    "# Installer trust + fault qualification",
    "",
    `- Contract: \`${result.contract}\``,
    "- State: `passed`",
    `- Run: \`${runId}\``,
    `- Artifact: \`${result.authority.artifactDigest}\``,
    `- Release: \`${result.authority.releaseDigest}\``,
    `- Browser: \`${result.authority.browser.product}\``,
    `- Machine: \`${result.authority.environment.machineId}\``,
    `- Cells: \`${result.cells.length}/${INSTALLER_TRUST_FAULT_CELL_IDS.length}\``,
    `- Canonical payload (base64url): \`${binding.payloadBase64url}\``,
    `- Canonical payload SHA-256: \`${binding.sha256}\``,
    "",
    ...result.cells.map(
      (cell) => `- \`${cell.id}\`: ${cell.attempts.map((attempt) => attempt.outcome).join(" → ")}`,
    ),
    "",
    "This bounded qualification does not claim true disk-full, OS/power-loss, production deployment, or D-097 evidence.",
    "",
  ].join("\n");
}

function formatFailureMarkdown(input: {
  readonly cells: readonly InstallerTrustFaultCell[];
  readonly contract: string;
  readonly failedCell?: unknown;
  readonly failure: Readonly<{
    readonly cleanupFailures: readonly InstallerTrustFaultSanitizedFailureNode[];
    readonly phase: string;
    readonly primary: InstallerTrustFaultSanitizedFailureNode | null;
  }>;
  readonly canonicalBinding: InstallerTrustCanonicalBinding;
  readonly runId: string;
  readonly startedAt: string;
}): string {
  const failureLines = [
    ...(input.failure.primary === null
      ? ["- Primary failure: `null`"]
      : formatFailureNodeMarkdown("primary", input.failure.primary)),
    ...input.failure.cleanupFailures.flatMap((failure, index) =>
      formatFailureNodeMarkdown(`cleanup.${index}`, failure),
    ),
  ];
  const failedCell =
    input.failedCell === undefined || input.failedCell === null
      ? null
      : object(input.failedCell, "failed-cell Markdown evidence");
  const hasFailedCellContract = input.failedCell !== undefined;
  const failedCellKind =
    failedCell?.kind === "product-terminal"
      ? "product-terminal"
      : failedCell?.kind === "cell-validation"
        ? "cell-validation"
        : failedCell?.kind === "raw-observations"
          ? "raw-observations"
          : failedCell === null
            ? null
            : "legacy-product-terminal";
  const productFailedCell =
    failedCellKind === "product-terminal"
      ? object(failedCell?.evidence, "failed-cell Markdown product terminal")
      : failedCellKind === "legacy-product-terminal"
        ? failedCell
        : null;
  const validationFailedCell = failedCellKind === "cell-validation" ? failedCell : null;
  const rawFailedCell =
    failedCellKind === "raw-observations"
      ? object(failedCell?.evidence, "failed-cell Markdown raw observations")
      : null;
  const validationHttp =
    validationFailedCell !== null && "http" in validationFailedCell
      ? object(validationFailedCell.http, "failed-cell Markdown HTTP projection")
      : null;
  const validationAccounting =
    validationFailedCell !== null && "accounting" in validationFailedCell
      ? object(validationFailedCell.accounting, "failed-cell Markdown accounting projection")
      : null;
  const failedTerminal =
    productFailedCell === null
      ? null
      : object(productFailedCell.terminal, "failed-cell Markdown terminal");
  const failedTransfer =
    failedTerminal === null
      ? null
      : object(failedTerminal.transfer, "failed-cell Markdown transfer");
  const failedStore =
    failedTerminal === null ? null : object(failedTerminal.store, "failed-cell Markdown store");
  const failedTransitions =
    productFailedCell === null
      ? null
      : object(productFailedCell.transitions, "failed-cell Markdown transitions");
  return [
    "# Installer trust + fault qualification",
    "",
    `- Contract: \`${input.contract}\``,
    "- State: `failed`",
    `- Run: \`${input.runId}\``,
    `- Started: \`${input.startedAt}\``,
    `- Completed cells: \`${input.cells.length}\``,
    ...(hasFailedCellContract
      ? [
          `- Failed cell: ${
            failedCell === null
              ? "`null`"
              : `\`${String(productFailedCell?.id ?? validationFailedCell?.id ?? rawFailedCell?.cellId)}\``
          }`,
        ]
      : []),
    ...(!hasFailedCellContract || productFailedCell === null
      ? []
      : [
          ...(failedCellKind === "product-terminal"
            ? ["- Failed-cell evidence kind: `product-terminal`"]
            : []),
          `- Failed-cell fault resource: \`${String(productFailedCell.faultResourceId)}\``,
          `- Failed-cell terminal: expected \`${String(failedTerminal?.expected)}\`, observed \`${String(failedTerminal?.observed)}\``,
          `- Failed-cell transfer: \`${String(failedTransfer?.failureCode)}\` / \`${String(failedTransfer?.failureClass)}\` / \`${String(failedTransfer?.failureEvidence)}\` / \`${String(failedTransfer?.failureOperation)}\`; message ${JSON.stringify(failedTransfer?.failureMessage)}`,
          `- Failed-cell store failure: ${JSON.stringify(failedStore?.failureMessage)}`,
          `- Failed-cell transition stream: \`${String(failedTransitions?.streamSha256)}\``,
        ]),
    ...(validationFailedCell === null
      ? []
      : [
          "- Failed-cell evidence kind: `cell-validation`",
          `- Failed-cell fault resource: \`${String(validationFailedCell.faultResourceId)}\``,
          `- Failed-cell operation: \`${String(validationFailedCell.operation)}\` attempt \`${String(validationFailedCell.attempt)}\` phase \`${String(validationFailedCell.phase)}\``,
          `- Failed-cell violated predicates: \`${JSON.stringify(validationFailedCell.violatedPredicates)}\``,
          ...(validationHttp === null
            ? []
            : [
                `- Failed-cell HTTP projection: selected \`${String(validationHttp.selectedRequestCount)}\`, operation Range \`${String(validationHttp.operationRangeRequestCount)}\``,
              ]),
          ...(validationAccounting === null
            ? []
            : [
                `- Failed-cell accounting projection: declared downloaded \`${String(validationAccounting.declaredDownloadedBytes)}\`, repaired \`${String(validationAccounting.declaredRepairedBytes)}\`, repaired resources \`${String(validationAccounting.declaredRepairedResourceCount)}\``,
              ]),
          `- Failed-cell publication: initial \`${String(object(validationFailedCell.post, "failed-cell Markdown post").operationInitialPublicationCount)}\`, terminal \`${String(object(validationFailedCell.post, "failed-cell Markdown post").terminalPublicationCount)}\`, occurred \`${String(object(validationFailedCell.post, "failed-cell Markdown post").publicationOccurred)}\``,
          `- Failed-cell proof stream: \`${String(object(validationFailedCell.proof, "failed-cell Markdown proof").streamSha256)}\`; terminal digest \`${String(object(validationFailedCell.proof, "failed-cell Markdown proof").terminalStateSha256)}\``,
        ]),
    ...(rawFailedCell === null
      ? []
      : [
          "- Failed-cell evidence kind: `raw-observations`",
          `- Failed-cell phase: \`${String(rawFailedCell.phase)}\``,
          `- Failed-cell product predicate: \`${String(rawFailedCell.failedPredicate)}\``,
          `- Failed-cell accepted raw observations: \`${String(rawFailedCell.acceptedObservationCount)}\``,
          `- Failed-cell rejected raw observation SHA-256: \`${String(object(rawFailedCell.rejectedSample, "rejected sample Markdown evidence").digestSha256)}\``,
          `- Failed-cell raw observation SHA-256: \`${String(rawFailedCell.sha256)}\``,
        ]),
    `- Failure phase: \`${input.failure.phase}\``,
    `- Cleanup failures: \`${input.failure.cleanupFailures.length}\``,
    "",
    "## Sanitized ordered failure graph",
    "",
    ...failureLines,
    `- Canonical payload (base64url): \`${input.canonicalBinding.payloadBase64url}\``,
    `- Canonical payload SHA-256: \`${input.canonicalBinding.sha256}\``,
    "",
  ].join("\n");
}

function formatFailureNodeMarkdown(
  path: string,
  node: InstallerTrustFaultSanitizedFailureNode,
): string[] {
  const lines = [
    `- Node \`${path}\` kind: \`${node.kind}\``,
    `- Node \`${path}\` name: ${JSON.stringify(node.name)}`,
    `- Node \`${path}\` operation: ${JSON.stringify(node.operation)}`,
    `- Node \`${path}\` stage: ${JSON.stringify(node.stage)}`,
    `- Node \`${path}\` message: ${JSON.stringify(node.message)}`,
    `- Node \`${path}\` cause: ${node.cause === null ? "`null`" : `\`${path}.cause\``}`,
    `- Node \`${path}\` aggregate members: \`${node.errors.length}\``,
  ];
  if (node.transitionBindingDiagnostic !== undefined) {
    lines.push(
      `- Node \`${path}\` transition binding diagnostic: ${JSON.stringify(node.transitionBindingDiagnostic)}`,
    );
  }
  if (node.proofFinalizationDiagnostic !== undefined) {
    lines.push(
      `- Node \`${path}\` proof finalization diagnostic: ${JSON.stringify(node.proofFinalizationDiagnostic)}`,
    );
  }
  if (node.cause !== null) lines.push(...formatFailureNodeMarkdown(`${path}.cause`, node.cause));
  node.errors.forEach((member, index) => {
    lines.push(...formatFailureNodeMarkdown(`${path}.errors.${index}`, member));
  });
  return lines;
}

export function validateInstallerTrustFaultTerminalPair(
  json: Readonly<Record<string, unknown>>,
  markdown: string,
): void {
  validateInstallerTrustFaultTerminalPairWithProofSemantics(json, markdown);
}

export function validateRetainedInstallerTrustFaultTerminalPair(
  json: Readonly<Record<string, unknown>>,
  markdown: string,
): void {
  validateInstallerTrustFaultTerminalPairWithProofSemantics(json, markdown, undefined, 6);
}

function validateInstallerTrustFaultTerminalPairWithProofSemantics(
  json: Readonly<Record<string, unknown>>,
  markdown: string,
  retainedProofSemantics?: "historical-active-raw-v2",
  retainedTransferTelemetrySchemaVersion?: 6,
): void {
  validateInstallerTrustFaultRunEvidenceWithProofSemantics(
    json,
    retainedProofSemantics,
    retainedTransferTelemetrySchemaVersion,
  );
  const normalizedJson = normalizeOwnedRunEvidence({ ...json });
  const normalizedMarkdown = normalizeOwnedMarkdown(json, markdown);
  if (
    normalizedJson.schemaVersion === INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION &&
    (Buffer.byteLength(JSON.stringify(json, null, 2), "utf8") >
      INSTALLER_TRUST_FAULT_MAX_SERIALIZED_JSON_REPORT_BYTES ||
      Buffer.byteLength(markdown, "utf8") >
        INSTALLER_TRUST_FAULT_MAX_SERIALIZED_MARKDOWN_REPORT_BYTES)
  ) {
    throw new Error("Installer trust-fault schema-12 terminal report exceeds its byte bound");
  }
  const binding = object(
    normalizedJson.canonicalBinding,
    "canonical binding",
  ) as unknown as InstallerTrustCanonicalBinding;
  const base64Matches = [
    ...normalizedMarkdown.matchAll(/^- Canonical payload \(base64url\): `([^`]+)`$/gmu),
  ];
  const digestMatches = [
    ...normalizedMarkdown.matchAll(/^- Canonical payload SHA-256: `([a-f0-9]{64})`$/gmu),
  ];
  if (
    base64Matches.length !== 1 ||
    digestMatches.length !== 1 ||
    base64Matches[0]?.[1] !== binding.payloadBase64url ||
    digestMatches[0]?.[1] !== binding.sha256
  ) {
    throw new Error("Installer trust-fault terminal companion binding is missing or mismatched");
  }
  if (
    (normalizedJson.schemaVersion === INSTALLER_TRUST_FAULT_LEGACY_RUN_SCHEMA_VERSION ||
      normalizedJson.schemaVersion === INSTALLER_TRUST_FAULT_PREVIOUS_RUN_SCHEMA_VERSION ||
      normalizedJson.schemaVersion === INSTALLER_TRUST_FAULT_PROOF_RUN_SCHEMA_VERSION ||
      normalizedJson.schemaVersion === INSTALLER_TRUST_FAULT_PERSISTENCE_RUN_SCHEMA_VERSION ||
      normalizedJson.schemaVersion === INSTALLER_TRUST_FAULT_PHYSICAL_OBSERVER_RUN_SCHEMA_VERSION ||
      normalizedJson.schemaVersion === INSTALLER_TRUST_FAULT_PRODUCT_TERMINAL_RUN_SCHEMA_VERSION ||
      normalizedJson.schemaVersion === INSTALLER_TRUST_FAULT_CELL_VALIDATION_RUN_SCHEMA_VERSION ||
      normalizedJson.schemaVersion ===
        INSTALLER_TRUST_FAULT_BINDING_DIAGNOSTIC_RUN_SCHEMA_VERSION ||
      normalizedJson.schemaVersion === INSTALLER_TRUST_FAULT_TERMINAL_REPEAT_RUN_SCHEMA_VERSION ||
      normalizedJson.schemaVersion === INSTALLER_TRUST_FAULT_RUN_SCHEMA_VERSION ||
      normalizedJson.schemaVersion === INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION) &&
    normalizedJson.state === "failed" &&
    normalizedMarkdown !==
      formatFailureMarkdown(
        normalizedJson as unknown as Parameters<typeof formatFailureMarkdown>[0],
      )
  ) {
    throw new Error("Installer trust-fault terminal Markdown contradicts failed JSON");
  }
  if (
    (normalizedJson.schemaVersion === INSTALLER_TRUST_FAULT_LEGACY_RUN_SCHEMA_VERSION ||
      normalizedJson.schemaVersion === INSTALLER_TRUST_FAULT_PREVIOUS_RUN_SCHEMA_VERSION ||
      normalizedJson.schemaVersion === INSTALLER_TRUST_FAULT_PROOF_RUN_SCHEMA_VERSION ||
      normalizedJson.schemaVersion === INSTALLER_TRUST_FAULT_PERSISTENCE_RUN_SCHEMA_VERSION ||
      normalizedJson.schemaVersion === INSTALLER_TRUST_FAULT_PHYSICAL_OBSERVER_RUN_SCHEMA_VERSION ||
      normalizedJson.schemaVersion === INSTALLER_TRUST_FAULT_PRODUCT_TERMINAL_RUN_SCHEMA_VERSION ||
      normalizedJson.schemaVersion === INSTALLER_TRUST_FAULT_CELL_VALIDATION_RUN_SCHEMA_VERSION ||
      normalizedJson.schemaVersion ===
        INSTALLER_TRUST_FAULT_BINDING_DIAGNOSTIC_RUN_SCHEMA_VERSION ||
      normalizedJson.schemaVersion === INSTALLER_TRUST_FAULT_TERMINAL_REPEAT_RUN_SCHEMA_VERSION ||
      normalizedJson.schemaVersion === INSTALLER_TRUST_FAULT_RUN_SCHEMA_VERSION ||
      normalizedJson.schemaVersion === INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION) &&
    normalizedJson.state === "passed"
  ) {
    const {
      canonicalBinding: _canonicalBinding,
      resultSchemaVersion,
      runId,
      schemaVersion: _runSchemaVersion,
      state: _state,
      ...resultBase
    } = normalizedJson;
    const result = {
      ...resultBase,
      schemaVersion: resultSchemaVersion,
    } as unknown as InstallerTrustFaultsResult;
    if (
      typeof runId !== "string" ||
      normalizedMarkdown !== formatInstallerTrustFaultsMarkdown(result, runId, binding)
    ) {
      throw new Error("Installer trust-fault terminal Markdown contradicts passed JSON");
    }
  }
}

/**
 * Validates only the immutable 2026-07-31 asynchronous handoff failure pair whose
 * schema-12 cells predate transition-proof v3. The closed byte and authority identity
 * deliberately keeps this compatibility path out of ordinary result validation.
 */
export function validateRetainedInstallerTrustFaultAsynchronousHandoffFailure(
  jsonBytes: Uint8Array,
  markdownBytes: Uint8Array,
): void {
  const jsonSha256 = createHash("sha256").update(jsonBytes).digest("hex");
  const markdownSha256 = createHash("sha256").update(markdownBytes).digest("hex");
  if (
    jsonSha256 !== RETAINED_ASYNC_HANDOFF_FAILURE.jsonSha256 ||
    markdownSha256 !== RETAINED_ASYNC_HANDOFF_FAILURE.markdownSha256
  ) {
    throw new Error("Installer trust-fault retained asynchronous handoff pair identity is invalid");
  }

  const json = object(
    JSON.parse(Buffer.from(jsonBytes).toString("utf8")),
    "retained asynchronous handoff JSON",
  );
  const authority = object(json.authority, "retained asynchronous handoff authority");
  const source = object(authority.source, "retained asynchronous handoff source");
  const canonicalBinding = object(
    json.canonicalBinding,
    "retained asynchronous handoff canonical binding",
  );
  const authoritySha256 = createHash("sha256").update(JSON.stringify(authority)).digest("hex");
  if (
    json.runId !== RETAINED_ASYNC_HANDOFF_FAILURE.runId ||
    json.state !== "failed" ||
    json.schemaVersion !== INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION ||
    json.resultSchemaVersion !== INSTALLER_TRUST_FAULTS_SCHEMA_VERSION ||
    authority.artifactDigest !== RETAINED_ASYNC_HANDOFF_FAILURE.artifactDigest ||
    authority.buildManifestSha256 !== RETAINED_ASYNC_HANDOFF_FAILURE.artifactDigest ||
    authority.releaseDigest !== RETAINED_ASYNC_HANDOFF_FAILURE.releaseDigest ||
    authority.installManifestSha256 !== RETAINED_ASYNC_HANDOFF_FAILURE.releaseDigest ||
    source.commit !== RETAINED_ASYNC_HANDOFF_FAILURE.sourceCommit ||
    source.dirtyTreeDigest !== RETAINED_ASYNC_HANDOFF_FAILURE.sourceDirtyTreeDigest ||
    authoritySha256 !== RETAINED_ASYNC_HANDOFF_FAILURE.authoritySha256 ||
    canonicalBinding.sha256 !== RETAINED_ASYNC_HANDOFF_FAILURE.canonicalBindingSha256
  ) {
    throw new Error("Installer trust-fault retained asynchronous handoff authority is invalid");
  }

  validateInstallerTrustFaultTerminalPairWithProofSemantics(
    json,
    Buffer.from(markdownBytes).toString("utf8"),
    "historical-active-raw-v2",
  );
}

function normalizeOwnedRunEvidence(value: Record<string, unknown>): Record<string, unknown> {
  const hasReservation = "resultReservationId" in value;
  const hasOwnership = "resultOwnership" in value;
  if (!hasReservation && !hasOwnership) return value;
  if (!hasReservation || !hasOwnership || typeof value.resultReservationId !== "string") {
    throw new Error("Installer trust-fault result ownership is incomplete");
  }
  const ownership = object(value.resultOwnership, "result ownership");
  exactKeys(ownership, ["publicationState", "reservationId"]);
  if (
    ownership.reservationId !== value.resultReservationId ||
    typeof ownership.reservationId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
      ownership.reservationId,
    ) ||
    (value.state === "pending"
      ? ownership.publicationState !== "pending" && ownership.publicationState !== "reserved"
      : ownership.publicationState !== value.state) ||
    (value.state !== "failed" && value.state !== "passed" && value.state !== "pending")
  ) {
    throw new Error("Installer trust-fault result ownership contradicts terminal evidence");
  }
  const normalized = { ...value };
  delete normalized.resultOwnership;
  delete normalized.resultReservationId;
  return normalized;
}

function normalizeOwnedMarkdown(json: Readonly<Record<string, unknown>>, markdown: string): string {
  if (!("resultOwnership" in json) && !("resultReservationId" in json)) return markdown;
  const reservationId = json.resultReservationId;
  const state = json.state;
  if (typeof reservationId !== "string" || (state !== "failed" && state !== "passed")) {
    throw new Error("Installer trust-fault Markdown ownership input is invalid");
  }
  const prefix = `<!-- parallax-result-reservation:${reservationId} -->\n`;
  const suffix = `- Result reservation: \`${reservationId}\`\n- Publication state: \`${state}\`\n`;
  if (!markdown.startsWith(prefix) || !markdown.endsWith(suffix)) {
    throw new Error("Installer trust-fault Markdown ownership contradicts terminal JSON");
  }
  return `${markdown.slice(prefix.length, -suffix.length).trimEnd()}\n`;
}

function bindTerminalEvidence<T extends Readonly<Record<string, unknown>>>(
  input: T,
): T & { readonly canonicalBinding: InstallerTrustCanonicalBinding } {
  const payload = canonicalJson(input);
  if (
    input.schemaVersion === INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION &&
    Buffer.byteLength(payload, "utf8") > INSTALLER_TRUST_FAULT_MAX_CANONICAL_PAYLOAD_BYTES
  ) {
    throw new Error("Installer trust-fault schema-12 canonical payload exceeds its byte bound");
  }
  const binding = Object.freeze({
    payloadBase64url: Buffer.from(payload, "utf8").toString("base64url"),
    sha256: createHash("sha256").update(payload).digest("hex"),
  });
  const terminal = Object.freeze({ ...input, canonicalBinding: binding });
  if (
    input.schemaVersion === INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION &&
    Buffer.byteLength(JSON.stringify(terminal, null, 2), "utf8") >
      INSTALLER_TRUST_FAULT_MAX_SERIALIZED_JSON_REPORT_BYTES
  ) {
    throw new Error("Installer trust-fault schema-12 JSON report exceeds its byte bound");
  }
  return terminal;
}

function validateCanonicalBinding(value: Record<string, unknown>): void {
  const binding = object(value.canonicalBinding, "canonical binding");
  exactKeys(binding, ["payloadBase64url", "sha256"]);
  if (
    typeof binding.payloadBase64url !== "string" ||
    typeof binding.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(binding.sha256)
  ) {
    throw new Error("Installer trust-fault canonical binding is invalid");
  }
  if (
    value.schemaVersion === INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION &&
    binding.payloadBase64url.length >
      Math.ceil((INSTALLER_TRUST_FAULT_MAX_CANONICAL_PAYLOAD_BYTES * 4) / 3)
  ) {
    throw new Error("Installer trust-fault schema-12 canonical payload exceeds its byte bound");
  }
  if (!/^[A-Za-z0-9_-]{1,33554432}$/u.test(binding.payloadBase64url)) {
    throw new Error("Installer trust-fault canonical binding is invalid");
  }
  const { canonicalBinding: _canonicalBinding, ...base } = value;
  const expected = canonicalJson(base);
  // Immutable schema <=12 artifacts were emitted with the former default-locale ordering.
  // Its observed ASCII/camel-case order is reproduced by a fixed comparator, never ICU.
  const historicalExpected = historicalCaseFoldedCanonicalJson(base);
  let decoded: string;
  try {
    decoded = Buffer.from(binding.payloadBase64url, "base64url").toString("utf8");
  } catch (error: unknown) {
    throw new Error("Installer trust-fault canonical payload is not base64url", { cause: error });
  }
  if (
    (decoded !== expected && decoded !== historicalExpected) ||
    createHash("sha256").update(decoded).digest("hex") !== binding.sha256
  ) {
    throw new Error("Installer trust-fault canonical binding contradicts terminal JSON");
  }
  if (
    value.schemaVersion === INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION &&
    (Buffer.byteLength(decoded, "utf8") > INSTALLER_TRUST_FAULT_MAX_CANONICAL_PAYLOAD_BYTES ||
      Buffer.byteLength(JSON.stringify(value, null, 2), "utf8") >
        INSTALLER_TRUST_FAULT_MAX_SERIALIZED_JSON_REPORT_BYTES)
  ) {
    throw new Error("Installer trust-fault schema-12 canonical report exceeds its byte bound");
  }
}

function sanitizeFailure(error: unknown): Readonly<{
  cleanupFailures: readonly InstallerTrustFaultSanitizedFailureNode[];
  primary: InstallerTrustFaultSanitizedFailureNode | null;
  productTerminal: InstallerTrustFaultCellTerminalEvidence | null;
}> {
  const context: FailureSanitizationContext = {
    nodes: 0,
    retainedProductTerminals: [],
    seen: new WeakSet<object>(),
  };
  const aggregateRead = safeAggregateMembers(error, MAX_CLEANUP_FAILURES + 1);
  const aggregateMembers = aggregateRead.members;
  if (error instanceof InstallerTrustFaultLifecycleAggregateError) {
    if (
      aggregateRead.unreadable ||
      aggregateMembers.length === 0 ||
      !aggregateMembers.every((member) => member instanceof InstallerTrustFaultOperationError)
    ) {
      return Object.freeze({
        cleanupFailures: Object.freeze([
          failureMarker(
            "redacted",
            "LifecycleAggregate",
            "Invalid lifecycle failure members redacted",
          ),
        ]),
        primary: null,
        productTerminal: null,
      });
    }
    const primaryMembers = aggregateMembers.filter(
      (member) => member instanceof InstallerTrustFaultOperationError && member.stage === "primary",
    );
    const primary =
      primaryMembers.length > 1
        ? failureMarker(
            "redacted",
            "LifecycleAggregate",
            "Contradictory lifecycle primary failures redacted",
          )
        : (primaryMembers[0] ?? null);
    const cleanup = aggregateMembers.filter(
      (member) => member instanceof InstallerTrustFaultOperationError && member.stage === "cleanup",
    );
    const boundedCleanup =
      !aggregateRead.truncated && cleanup.length <= MAX_CLEANUP_FAILURES
        ? cleanup
        : [...cleanup.slice(0, MAX_CLEANUP_FAILURES - 1), FAILURE_CLEANUP_TRUNCATED];
    const sanitizedPrimary =
      primary === null || !(primary instanceof InstallerTrustFaultOperationError)
        ? primary
        : sanitizeCause(primary, 0, context);
    if (primary !== null && !(primary instanceof InstallerTrustFaultOperationError)) {
      context.nodes += 1;
    }
    const cleanupFailures = sanitizeFailureList(boundedCleanup, 0, context);
    return finalizeSanitizedFailure(sanitizedPrimary, cleanupFailures, context);
  }
  const primary = sanitizeCause(error, 0, context);
  return finalizeSanitizedFailure(primary, Object.freeze([]), context);
}

interface FailureSanitizationContext {
  nodes: number;
  readonly retainedProductTerminals: InstallerTrustFaultCellTerminalEvidenceError[];
  readonly seen: WeakSet<object>;
}

const FAILURE_CLEANUP_TRUNCATED = Symbol("installer-trust-fault-cleanup-truncated");
const FAILURE_AGGREGATE_UNREADABLE = Symbol("installer-trust-fault-aggregate-unreadable");

function sanitizeCause(
  error: unknown,
  depth: number,
  context: FailureSanitizationContext,
): InstallerTrustFaultSanitizedFailureNode {
  if (depth >= MAX_FAILURE_DEPTH || context.nodes >= MAX_FAILURE_NODES - 1) {
    context.nodes += 1;
    return failureMarker("truncated", "FailureTruncated", "Failure graph bound reached");
  }
  context.nodes += 1;
  if (error === FAILURE_CLEANUP_TRUNCATED) {
    return failureMarker("truncated", "CleanupTruncated", "Additional cleanup failures redacted");
  }
  if (error === FAILURE_AGGREGATE_UNREADABLE) {
    return failureMarker("redacted", "AggregateMembers", "Unreadable aggregate members redacted");
  }
  if (typeof error === "object" && error !== null) {
    if (context.seen.has(error)) {
      return failureMarker("cycle", "FailureCycle", "Repeated failure reference redacted");
    }
    context.seen.add(error);
    if (error instanceof InstallerTrustFaultCellTerminalEvidenceError) {
      context.retainedProductTerminals.push(error);
    }
  }
  if (error instanceof Error) {
    const transitionBindingDiagnostic = readTrustedInstallerTrustTransitionBindingDiagnostic(error);
    // Schema 12 retains product-invariant raw evidence. The exact topology diagnostic is
    // accepted only while validating immutable schema <=11 results.
    const proofFinalizationDiagnostic = null;
    const operationMetadata = safeOperationMetadata(error);
    if (operationMetadata === "invalid") {
      return failureMarker(
        "redacted",
        "OperationFailure",
        "Invalid operation failure metadata redacted",
      );
    }
    const aggregateRead = safeAggregateMembers(error, MAX_AGGREGATE_MEMBERS);
    const aggregateMembers = aggregateRead.members;
    const boundedMembers = aggregateRead.unreadable
      ? [FAILURE_AGGREGATE_UNREADABLE]
      : !aggregateRead.truncated && aggregateMembers.length <= MAX_AGGREGATE_MEMBERS
        ? aggregateMembers
        : [...aggregateMembers.slice(0, MAX_AGGREGATE_MEMBERS - 1), FAILURE_CLEANUP_TRUNCATED];
    return Object.freeze({
      cause: safeErrorCause(error, depth, context),
      errors: sanitizeFailureList(boundedMembers, depth + 1, context),
      kind: error instanceof AggregateError ? "aggregate" : "error",
      message:
        proofFinalizationDiagnostic !== null
          ? INSTALLER_TRUST_FAULT_ESTIMATE_FINALIZATION_FAILURE_MESSAGE
          : transitionBindingDiagnostic === null
            ? safeErrorText(error, "message", MAX_FAILURE_TEXT, "Unspecified failure")
            : "predicate" in transitionBindingDiagnostic
              ? INSTALLER_TRUST_TRANSITION_REJECTION_MESSAGE
              : INSTALLER_TRUST_TRANSITION_BINDING_FAILURE_MESSAGE,
      name:
        operationMetadata === null
          ? safeGenericErrorName(error)
          : "InstallerTrustFaultOperationError",
      operation: operationMetadata?.operation ?? null,
      stage: operationMetadata?.stage ?? null,
      ...(proofFinalizationDiagnostic === null ? {} : { proofFinalizationDiagnostic }),
      ...(transitionBindingDiagnostic === null ? {} : { transitionBindingDiagnostic }),
    });
  }
  if (
    typeof error === "string" ||
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint" ||
    error === null ||
    error === undefined
  ) {
    return Object.freeze({
      cause: null,
      errors: Object.freeze([]),
      kind: "non-error",
      message: sanitizeFailureText(String(error), MAX_FAILURE_TEXT, "Unspecified failure"),
      name: "NonError",
      operation: null,
      stage: null,
    });
  }
  return failureMarker("redacted", "UnknownFailure", "Unsupported failure value redacted");
}

function projectRetainedProductTerminal(
  found: readonly InstallerTrustFaultCellTerminalEvidenceError[],
): Readonly<{ conflict: boolean; evidence: InstallerTrustFaultCellTerminalEvidence | null }> {
  if (found.length === 0) return Object.freeze({ conflict: false, evidence: null });
  const retained = found[0];
  if (retained === undefined) return Object.freeze({ conflict: true, evidence: null });
  const keys = found.map(safeRetainedProductTerminalKey);
  const expected = keys[0];
  if (expected === null || expected === undefined || keys.some((key) => key !== expected)) {
    return Object.freeze({ conflict: true, evidence: null });
  }
  return Object.freeze({
    conflict: false,
    evidence: Object.freeze({
      faultResourceId: retained.faultResourceId,
      id: retained.cellId,
      terminal: retained.terminal,
      transitions: retained.transitions,
    }),
  });
}

function finalizeSanitizedFailure(
  primary: InstallerTrustFaultSanitizedFailureNode | null,
  cleanupFailures: readonly InstallerTrustFaultSanitizedFailureNode[],
  context: FailureSanitizationContext,
): Readonly<{
  cleanupFailures: readonly InstallerTrustFaultSanitizedFailureNode[];
  primary: InstallerTrustFaultSanitizedFailureNode | null;
  productTerminal: InstallerTrustFaultCellTerminalEvidence | null;
}> {
  const terminal = projectRetainedProductTerminal(context.retainedProductTerminals);
  if (!terminal.conflict) {
    return Object.freeze({ cleanupFailures, primary, productTerminal: terminal.evidence });
  }
  return Object.freeze({
    cleanupFailures: Object.freeze(cleanupFailures.map(redactTerminalEvidenceCollectionConflict)),
    primary: primary === null ? null : redactTerminalEvidenceCollectionConflict(primary),
    productTerminal: null,
  });
}

function safeRetainedProductTerminalKey(
  retained: InstallerTrustFaultCellTerminalEvidenceError,
): string | null {
  try {
    return canonicalJson({
      faultResourceId: retained.faultResourceId,
      id: retained.cellId,
      terminal: retained.terminal,
      transitions: retained.transitions,
    });
  } catch {
    return null;
  }
}

function redactTerminalEvidenceCollectionConflict(
  node: InstallerTrustFaultSanitizedFailureNode,
): InstallerTrustFaultSanitizedFailureNode {
  if (node.name === INSTALLER_TRUST_FAULT_TERMINAL_EVIDENCE_ERROR_NAME) {
    return failureMarker(
      "redacted",
      "TerminalEvidenceCollectionConflict",
      "Conflicting installer product-terminal evidence redacted",
    );
  }
  const cause = node.cause === null ? null : redactTerminalEvidenceCollectionConflict(node.cause);
  const errors = Object.freeze(node.errors.map(redactTerminalEvidenceCollectionConflict));
  if (cause === node.cause && errors.every((entry, index) => entry === node.errors[index])) {
    return node;
  }
  return Object.freeze({ ...node, cause, errors });
}

function safeGenericErrorName(error: Error): string {
  const name = safeErrorText(error, "name", MAX_FAILURE_NAME, "Error");
  return name === "InstallerTrustFaultOperationError" ? "ReservedErrorNameRedacted" : name;
}

function safeOperationMetadata(
  error: Error,
): Readonly<{ operation: string; stage: "cleanup" | "primary" }> | "invalid" | null {
  if (!(error instanceof InstallerTrustFaultOperationError)) return null;
  try {
    if (
      typeof error.operation !== "string" ||
      (error.stage !== "cleanup" && error.stage !== "primary")
    ) {
      return "invalid";
    }
    return Object.freeze({
      operation: sanitizeFailureText(error.operation, MAX_FAILURE_OPERATION, "operation-redacted"),
      stage: error.stage,
    });
  } catch {
    return "invalid";
  }
}

function safeErrorText(
  error: Error,
  field: "message" | "name",
  maximum: number,
  fallback: string,
): string {
  try {
    const value: unknown = error[field];
    return typeof value === "string"
      ? sanitizeFailureText(value, maximum, fallback)
      : `<invalid ${field} redacted>`;
  } catch {
    return `<unreadable ${field} redacted>`;
  }
}

function parseTransitionRelationalStateEvidence(
  input: unknown,
): InstallerTrustTransitionPreviousStateEvidence | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const state = input as Record<string, unknown>;
  if (
    Object.keys(state).sort().join(",") !==
      "active,failure,order,phase,release,resource,shell,store,transfer,ui" ||
    typeof state.active !== "boolean" ||
    (state.failure !== null &&
      (typeof state.failure !== "string" || !INSTALLER_FAILURE_CODES.has(state.failure))) ||
    !Number.isSafeInteger(state.order) ||
    (state.order as number) < 1 ||
    (state.phase !== "attempt-1" &&
      state.phase !== "attempt-2" &&
      state.phase !== "seed" &&
      state.phase !== "setup") ||
    typeof state.release !== "boolean" ||
    typeof state.resource !== "boolean" ||
    !isTransitionFailureResourceRelationship(state.failure, state.resource) ||
    typeof state.shell !== "boolean" ||
    typeof state.store !== "string" ||
    !INSTALL_STORE_STATES.has(state.store) ||
    typeof state.transfer !== "string" ||
    !INSTALLER_TRANSFER_STATES.has(state.transfer) ||
    typeof state.ui !== "string" ||
    !INSTALLER_UI_STATES.has(state.ui)
  ) {
    return null;
  }
  return Object.freeze({
    active: state.active,
    failure: state.failure as InstallerFailureCode | null,
    order: state.order as number,
    phase: state.phase,
    release: state.release,
    resource: state.resource,
    shell: state.shell,
    store: state.store as InstallerTrustTransitionPreviousStateEvidence["store"],
    transfer: state.transfer as InstallerTrustTransitionPreviousStateEvidence["transfer"],
    ui: state.ui as InstallerTrustTransitionPreviousStateEvidence["ui"],
  });
}

function isTransitionFailureResourceRelationship(failure: unknown, resource: boolean): boolean {
  if (failure === null) return !resource;
  return (
    typeof failure === "string" &&
    (INSTALLER_FAILURE_RESOURCE_RELATIONSHIPS.get(failure)?.has(resource) ?? false)
  );
}

function isTransitionFailedPredicate(
  input: string,
): input is InstallerTrustTransitionFailedPredicateEvidence {
  return (
    input === "current-not-precursor" ||
    input === "previous-not-revoked-finalization" ||
    input === "previous-revoked-store-not-idle-or-verifying"
  );
}

function isTransitionRevokedFinalizationSummary(
  state: InstallerTrustTransitionPreviousStateEvidence,
): boolean {
  return (
    state.phase === "attempt-1" &&
    state.transfer === "verifying" &&
    (state.store === "idle" ||
      state.store === "reconciling" ||
      state.store === "writing" ||
      state.store === "verifying") &&
    state.ui === "repairing" &&
    !state.active &&
    state.release &&
    state.shell &&
    state.failure === null &&
    !state.resource
  );
}

function isTransitionPrecursorSummary(
  state: InstallerTrustTransitionPreviousStateEvidence,
): boolean {
  return (
    state.phase === "attempt-1" &&
    state.transfer === "verifying" &&
    state.store === "failed" &&
    state.ui === "repairing" &&
    !state.active &&
    state.release &&
    state.shell &&
    state.failure === null &&
    !state.resource
  );
}

function sanitizeFailureList(
  entries: readonly unknown[],
  depth: number,
  context: FailureSanitizationContext,
): readonly InstallerTrustFaultSanitizedFailureNode[] {
  const sanitized: InstallerTrustFaultSanitizedFailureNode[] = [];
  for (const entry of entries) {
    if (context.nodes >= MAX_FAILURE_NODES) break;
    sanitized.push(sanitizeCause(entry, depth, context));
  }
  return Object.freeze(sanitized);
}

function safeAggregateMembers(
  error: unknown,
  maximum: number,
): Readonly<{
  members: readonly unknown[];
  truncated: boolean;
  unreadable: boolean;
}> {
  if (!(error instanceof AggregateError)) {
    return Object.freeze({ members: Object.freeze([]), truncated: false, unreadable: false });
  }
  try {
    const errors: unknown = error.errors;
    if (!Array.isArray(errors)) {
      return Object.freeze({ members: Object.freeze([]), truncated: false, unreadable: true });
    }
    return Object.freeze({
      members: Object.freeze(errors.slice(0, maximum)),
      truncated: errors.length > maximum,
      unreadable: false,
    });
  } catch {
    return Object.freeze({ members: Object.freeze([]), truncated: false, unreadable: true });
  }
}

function safeErrorCause(
  error: Error,
  depth: number,
  context: FailureSanitizationContext,
): InstallerTrustFaultSanitizedFailureNode | null {
  try {
    if (!("cause" in error) || error.cause === undefined) return null;
    return sanitizeCause(error.cause, depth + 1, context);
  } catch {
    return failureMarker("redacted", "FailureCause", "Unreadable failure cause redacted");
  }
}

function failureMarker(
  kind: Extract<SanitizedFailureKind, "cycle" | "redacted" | "truncated">,
  name: string,
  message: string,
): InstallerTrustFaultSanitizedFailureNode {
  return Object.freeze({
    cause: null,
    errors: Object.freeze([]),
    kind,
    message,
    name,
    operation: null,
    stage: null,
  });
}

function sanitizeFailureText(value: string, maximum: number, fallback: string): string {
  const clean = Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)
      ? character
      : " ";
  })
    .join("")
    .replaceAll(/\b(?:file|https?):\/\/[^\s"'`]*/giu, "<url-redacted>")
    .replaceAll(/\b[A-Za-z]:[\\/][^\s"'`]*/gu, "<local-path>")
    .replaceAll(/(^|[^A-Za-z0-9_<>])(?:\\\\|\/\/)[^\s"'`]*/gu, "$1<local-path>")
    .replaceAll(/(^|[^A-Za-z0-9_<>])\/(?!\/)[^\s"'`]*/gu, "$1<local-path>")
    .replaceAll(
      /\bauthorization\s*[:=][^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*/giu,
      "authorization=<redacted>",
    )
    .replaceAll(/\bbearer\s+[^\s,;]+/giu, "Bearer <redacted>")
    .replaceAll(
      /\b(token|secret|password|passwd|credential|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|auth[_-]?token|id[_-]?token)\s*[:=]\s*[^\s,;&#]+/giu,
      "$1=<redacted>",
    )
    .trim();
  if (clean === "") return fallback;
  if (clean.length > maximum) return `<oversized ${fallback.toLowerCase()} redacted>`;
  return containsSensitiveFailureText(clean) ? "<sensitive failure text redacted>" : clean;
}

function containsSensitiveFailureText(value: string): boolean {
  const authorizationMarkersRemoved = value.replaceAll(/authorization=<redacted>/giu, "");
  return (
    /\b(?:file|https?):\/\//iu.test(value) ||
    /\b[A-Za-z]:[\\/]/u.test(value) ||
    /(^|[^A-Za-z0-9_<>])(?:\\\\|\/\/)/u.test(value) ||
    /(^|[^A-Za-z0-9_<>])\/(?!\/)/u.test(value) ||
    /authorization=<redacted>[^\r\n]+/iu.test(value) ||
    /\bauthorization\b/iu.test(authorizationMarkersRemoved) ||
    /\bbearer\s+(?!<redacted>)[^\s,;]+/iu.test(value) ||
    /\b(?:token|secret|password|passwd|credential|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|auth[_-]?token|id[_-]?token)\s*[:=]\s*(?!<redacted>)/iu.test(
      value,
    ) ||
    /[?&](?:token|secret|password|passwd|credential|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|auth[_-]?token|id[_-]?token)=(?!<redacted>)/iu.test(
      value,
    )
  );
}

function validateRunIdentity(value: Record<string, unknown>): void {
  const current =
    (value.schemaVersion === INSTALLER_TRUST_FAULT_BINDING_DIAGNOSTIC_RUN_SCHEMA_VERSION ||
      value.schemaVersion === INSTALLER_TRUST_FAULT_TERMINAL_REPEAT_RUN_SCHEMA_VERSION ||
      value.schemaVersion === INSTALLER_TRUST_FAULT_RUN_SCHEMA_VERSION ||
      value.schemaVersion === INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION) &&
    value.resultSchemaVersion === INSTALLER_TRUST_FAULTS_SCHEMA_VERSION;
  const cellValidation =
    value.schemaVersion === INSTALLER_TRUST_FAULT_CELL_VALIDATION_RUN_SCHEMA_VERSION &&
    value.resultSchemaVersion === INSTALLER_TRUST_FAULTS_SCHEMA_VERSION;
  const productTerminal =
    value.schemaVersion === INSTALLER_TRUST_FAULT_PRODUCT_TERMINAL_RUN_SCHEMA_VERSION &&
    value.resultSchemaVersion === INSTALLER_TRUST_FAULTS_SCHEMA_VERSION;
  const physicalObserver =
    value.schemaVersion === INSTALLER_TRUST_FAULT_PHYSICAL_OBSERVER_RUN_SCHEMA_VERSION &&
    value.resultSchemaVersion === INSTALLER_TRUST_FAULTS_SCHEMA_VERSION;
  const previous =
    value.schemaVersion === INSTALLER_TRUST_FAULT_PROOF_RUN_SCHEMA_VERSION &&
    value.resultSchemaVersion === INSTALLER_TRUST_FAULTS_PROOF_SCHEMA_VERSION;
  const persistence =
    value.schemaVersion === INSTALLER_TRUST_FAULT_PERSISTENCE_RUN_SCHEMA_VERSION &&
    value.resultSchemaVersion === INSTALLER_TRUST_FAULTS_PERSISTENCE_SCHEMA_VERSION;
  const proofV1 =
    value.schemaVersion === INSTALLER_TRUST_FAULT_PREVIOUS_RUN_SCHEMA_VERSION &&
    value.resultSchemaVersion === INSTALLER_TRUST_FAULTS_PREVIOUS_SCHEMA_VERSION;
  const legacy =
    value.schemaVersion === INSTALLER_TRUST_FAULT_LEGACY_RUN_SCHEMA_VERSION &&
    value.resultSchemaVersion === INSTALLER_TRUST_FAULTS_LEGACY_SCHEMA_VERSION;
  if (
    value.contract !== INSTALLER_TRUST_FAULTS_CONTRACT ||
    (!current &&
      !cellValidation &&
      !productTerminal &&
      !physicalObserver &&
      !persistence &&
      !previous &&
      !proofV1 &&
      !legacy) ||
    typeof value.runId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value.runId)
  ) {
    throw new Error("Installer trust-fault run identity is invalid");
  }
  timestamp(value.startedAt, "start");
}

function validateRunIdentityV1(value: Record<string, unknown>): void {
  if (
    value.contract !== INSTALLER_TRUST_FAULTS_CONTRACT ||
    value.schemaVersion !== INSTALLER_TRUST_FAULTS_LEGACY_SCHEMA_VERSION ||
    typeof value.runId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value.runId)
  ) {
    throw new Error("Installer trust-fault v1 run identity is invalid");
  }
  timestamp(value.startedAt, "start");
}

function validateSanitizedFailureNode(
  input: unknown,
  depth: number,
  budget: { nodes: number },
  runSchemaVersion: unknown,
): void {
  if (depth > MAX_FAILURE_DEPTH || budget.nodes >= MAX_FAILURE_NODES) {
    throw new Error("Installer trust-fault failure graph exceeds its bound");
  }
  budget.nodes += 1;
  const node = object(input, "failure node");
  const hasTransitionBindingDiagnostic = Object.hasOwn(node, "transitionBindingDiagnostic");
  const hasProofFinalizationDiagnostic = Object.hasOwn(node, "proofFinalizationDiagnostic");
  if (hasTransitionBindingDiagnostic && hasProofFinalizationDiagnostic) {
    throw new Error("Installer trust-fault failure node has contradictory diagnostics");
  }
  exactKeys(
    node,
    hasTransitionBindingDiagnostic
      ? [
          "cause",
          "errors",
          "kind",
          "message",
          "name",
          "operation",
          "stage",
          "transitionBindingDiagnostic",
        ]
      : hasProofFinalizationDiagnostic
        ? [
            "cause",
            "errors",
            "kind",
            "message",
            "name",
            "operation",
            "proofFinalizationDiagnostic",
            "stage",
          ]
        : ["cause", "errors", "kind", "message", "name", "operation", "stage"],
  );
  if (
    node.kind !== "aggregate" &&
    node.kind !== "cycle" &&
    node.kind !== "error" &&
    node.kind !== "non-error" &&
    node.kind !== "redacted" &&
    node.kind !== "truncated"
  ) {
    throw new Error("Installer trust-fault failure node kind is invalid");
  }
  if (
    !boundedFailureString(node.message, MAX_FAILURE_TEXT) ||
    !boundedFailureString(node.name, MAX_FAILURE_NAME) ||
    (node.operation !== null && !boundedFailureString(node.operation, MAX_FAILURE_OPERATION)) ||
    (node.stage !== null && node.stage !== "cleanup" && node.stage !== "primary") ||
    (node.operation === null) !== (node.stage === null) ||
    !Array.isArray(node.errors) ||
    node.errors.length > MAX_AGGREGATE_MEMBERS
  ) {
    throw new Error("Installer trust-fault failure node is invalid");
  }
  if (hasTransitionBindingDiagnostic) {
    validateTransitionBindingDiagnosticEvidence(
      node.transitionBindingDiagnostic,
      node.message,
      runSchemaVersion,
    );
    if (
      node.kind !== "error" ||
      (node.name !== "Error" && node.name !== "InstallerTrustTransitionBindingError") ||
      node.operation !== null ||
      node.stage !== null ||
      node.errors.length !== 0
    ) {
      throw new Error("Installer trust-fault transition binding diagnostic node is not exact");
    }
  }
  if (hasProofFinalizationDiagnostic) {
    validateEstimateFinalizationDiagnosticEvidence(
      node.proofFinalizationDiagnostic,
      node.message,
      runSchemaVersion,
    );
    if (
      node.kind !== "error" ||
      node.name !== "Error" ||
      node.operation !== null ||
      node.stage !== null ||
      node.cause !== null ||
      node.errors.length !== 0
    ) {
      throw new Error("Installer trust-fault proof finalization diagnostic node is not exact");
    }
  }
  const typedOperationNode =
    node.kind === "error" && node.name === "InstallerTrustFaultOperationError";
  const hasOperationMetadata = node.operation !== null && node.stage !== null;
  if (
    (node.name === "InstallerTrustFaultOperationError" && node.kind !== "error") ||
    typedOperationNode !== hasOperationMetadata
  ) {
    throw new Error("Installer trust-fault operation failure node is not exact");
  }
  if (
    (node.kind === "cycle" || node.kind === "redacted" || node.kind === "truncated") &&
    (node.cause !== null ||
      node.errors.length !== 0 ||
      node.operation !== null ||
      node.stage !== null)
  ) {
    throw new Error("Installer trust-fault failure marker has unexpected structure");
  }
  if (node.kind !== "aggregate" && node.errors.length !== 0) {
    throw new Error("Installer trust-fault non-aggregate node has aggregate members");
  }
  if (node.cause !== null)
    validateSanitizedFailureNode(node.cause, depth + 1, budget, runSchemaVersion);
  for (const member of node.errors)
    validateSanitizedFailureNode(member, depth + 1, budget, runSchemaVersion);
}

function validateEstimateFinalizationDiagnosticEvidence(
  input: unknown,
  message: unknown,
  runSchemaVersion: unknown,
): void {
  if (runSchemaVersion !== INSTALLER_TRUST_FAULT_RUN_SCHEMA_VERSION) {
    throw new Error("Installer trust-fault proof finalization diagnostic requires run schema 11");
  }
  if (message !== INSTALLER_TRUST_FAULT_ESTIMATE_FINALIZATION_FAILURE_MESSAGE) {
    throw new Error("Installer trust-fault proof finalization message is not exact");
  }
  const diagnostic = object(input, "proof finalization diagnostic");
  exactKeys(diagnostic, [
    "cellId",
    "failedPredicate",
    "finalRelationalState",
    "initialRelationalState",
    "phase",
    "projectedMilestones",
    "proofPrefix",
    "terminalIncidence",
  ]);
  const initial = parseTransitionRelationalStateEvidence(diagnostic.initialRelationalState);
  const final = parseTransitionRelationalStateEvidence(diagnostic.finalRelationalState);
  const prefix = object(diagnostic.proofPrefix, "proof finalization prefix");
  exactKeys(prefix, ["observationCount", "sha256"]);
  if (
    diagnostic.cellId !== "estimate-clearly-insufficient" ||
    diagnostic.phase !== "attempt-1" ||
    typeof diagnostic.failedPredicate !== "string" ||
    !(INSTALLER_TRUST_FAULT_ESTIMATE_FINALIZATION_FAILED_PREDICATES as readonly string[]).includes(
      diagnostic.failedPredicate,
    ) ||
    !Array.isArray(diagnostic.projectedMilestones) ||
    diagnostic.projectedMilestones.length > 8 ||
    diagnostic.projectedMilestones.some(
      (milestone) => typeof milestone !== "string" || !INSTALLER_TRANSFER_STATES.has(milestone),
    ) ||
    initial === null ||
    final === null ||
    !Number.isSafeInteger(prefix.observationCount) ||
    (prefix.observationCount as number) < 2 ||
    typeof prefix.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(prefix.sha256)
  ) {
    throw new Error("Installer trust-fault proof finalization diagnostic is invalid");
  }
  const incidence = object(diagnostic.terminalIncidence, "proof terminal incidence");
  exactKeys(incidence, ["externalIngress", "externalOutgoing", "self"]);
  const externalIngress = parseFinalizationIncidence(incidence.externalIngress);
  const externalOutgoing = parseFinalizationIncidence(incidence.externalOutgoing);
  const self = parseFinalizationIncidence(incidence.self);
  const expectedInitial =
    initial.phase === "attempt-1" &&
    initial.order === 2 &&
    initial.store === "idle" &&
    initial.transfer === "idle" &&
    initial.ui === "requesting-persistence" &&
    initial.failure === null &&
    !initial.resource &&
    !initial.active &&
    !initial.release &&
    !initial.shell;
  const expectedFinal =
    final.phase === "attempt-1" &&
    final.order === prefix.observationCount &&
    final.store === "idle" &&
    final.transfer === "failed" &&
    final.ui === "failed" &&
    final.failure === "quota" &&
    !final.resource &&
    !final.active &&
    !final.release &&
    !final.shell;
  const expectedIngress = externalIngress.edgeCount === 1 && externalIngress.observationCount === 1;
  const expectedOutgoing =
    externalOutgoing.edgeCount === 0 && externalOutgoing.observationCount === 0;
  const expectedSelf =
    self.edgeCount <= 1 &&
    self.observationCount <= 2 &&
    (self.edgeCount === 0) === (self.observationCount === 0) &&
    (self.edgeCount !== 1 || self.observationCount >= 1);
  if (
    initial.order !== 2 ||
    final.order !== prefix.observationCount ||
    (!expectedInitial && diagnostic.failedPredicate !== "initial-state") ||
    (!expectedFinal &&
      diagnostic.failedPredicate !== "final-state" &&
      diagnostic.failedPredicate !== "attempt-milestones") ||
    (!expectedIngress &&
      diagnostic.failedPredicate !== "terminal-external-ingress" &&
      diagnostic.failedPredicate !== "final-state" &&
      diagnostic.failedPredicate !== "attempt-milestones") ||
    (!expectedOutgoing &&
      diagnostic.failedPredicate !== "terminal-external-outgoing" &&
      diagnostic.failedPredicate !== "final-state" &&
      diagnostic.failedPredicate !== "attempt-milestones") ||
    (!expectedSelf &&
      diagnostic.failedPredicate !== "terminal-self-edge" &&
      diagnostic.failedPredicate !== "final-state" &&
      diagnostic.failedPredicate !== "attempt-milestones") ||
    externalIngress.edgeCount > prefix.observationCount ||
    externalIngress.observationCount > prefix.observationCount ||
    externalOutgoing.edgeCount > prefix.observationCount ||
    externalOutgoing.observationCount > prefix.observationCount ||
    self.edgeCount > prefix.observationCount ||
    self.observationCount > prefix.observationCount ||
    (diagnostic.failedPredicate === "attempt-milestones" &&
      canonicalJson(diagnostic.projectedMilestones) ===
        canonicalJson(["idle", "waiting-lock", "planning", "probing-quota", "failed"]))
  ) {
    throw new Error("Installer trust-fault proof finalization diagnostic is contradictory");
  }
}

function parseFinalizationIncidence(input: unknown): Readonly<{
  edgeCount: number;
  observationCount: number;
}> {
  const value = object(input, "proof terminal incidence count");
  exactKeys(value, ["edgeCount", "observationCount"]);
  if (
    !Number.isSafeInteger(value.edgeCount) ||
    (value.edgeCount as number) < 0 ||
    !Number.isSafeInteger(value.observationCount) ||
    (value.observationCount as number) < 0
  ) {
    throw new Error("Installer trust-fault proof terminal incidence is invalid");
  }
  return value as unknown as Readonly<{ edgeCount: number; observationCount: number }>;
}

function validateTransitionBindingDiagnosticEvidence(
  input: unknown,
  message: unknown,
  runSchemaVersion: unknown,
): void {
  const diagnostic = object(input, "transition binding diagnostic");
  if (Object.hasOwn(diagnostic, "predicate")) {
    if (
      runSchemaVersion !== INSTALLER_TRUST_FAULT_TERMINAL_REPEAT_RUN_SCHEMA_VERSION &&
      runSchemaVersion !== INSTALLER_TRUST_FAULT_RUN_SCHEMA_VERSION &&
      runSchemaVersion !== INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION
    ) {
      throw new Error("Installer trust-fault transition rejection requires run schema 10 or 11");
    }
    if (message !== INSTALLER_TRUST_TRANSITION_REJECTION_MESSAGE) {
      throw new Error("Installer trust-fault transition rejection message is not exact");
    }
    exactKeys(diagnostic, [
      "currentRelationalState",
      "predicate",
      "previousRelationalState",
      "proofPrefix",
      "repairFailedPredicate",
    ]);
    if (
      diagnostic.predicate !== "binding-absent" &&
      diagnostic.predicate !== "binding-outcome-invalid" &&
      diagnostic.predicate !== "binding-transport-rejected" &&
      diagnostic.predicate !== "transition-model-rejected"
    ) {
      throw new Error("Installer trust-fault transition binding predicate is invalid");
    }
    const current = parseTransitionRelationalStateEvidence(diagnostic.currentRelationalState);
    const previous =
      diagnostic.previousRelationalState === null
        ? null
        : parseTransitionRelationalStateEvidence(diagnostic.previousRelationalState);
    const prefix = object(diagnostic.proofPrefix, "transition proof prefix");
    exactKeys(prefix, ["acknowledgedThrough", "observationCount", "sha256"]);
    if (
      current === null ||
      (diagnostic.previousRelationalState !== null && previous === null) ||
      !Number.isSafeInteger(prefix.acknowledgedThrough) ||
      (prefix.acknowledgedThrough as number) < 0 ||
      (prefix.observationCount !== null &&
        (!Number.isSafeInteger(prefix.observationCount) ||
          (prefix.observationCount as number) < 0)) ||
      (prefix.sha256 !== null &&
        (typeof prefix.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(prefix.sha256))) ||
      (prefix.observationCount === null) !== (prefix.sha256 === null) ||
      current.order !== (prefix.acknowledgedThrough as number) + 1 ||
      (previous === null) !== (prefix.acknowledgedThrough === 0) ||
      (previous !== null && previous.order !== prefix.acknowledgedThrough) ||
      (diagnostic.predicate !== "transition-model-rejected" && prefix.observationCount !== null) ||
      (diagnostic.predicate === "transition-model-rejected" &&
        (runSchemaVersion !== INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION
          ? prefix.observationCount !== prefix.acknowledgedThrough
          : prefix.observationCount !== null &&
            prefix.observationCount !== prefix.acknowledgedThrough))
    ) {
      throw new Error("Installer trust-fault transition proof prefix is contradictory");
    }
    if (
      diagnostic.repairFailedPredicate !== null &&
      (typeof diagnostic.repairFailedPredicate !== "string" ||
        !isTransitionFailedPredicate(diagnostic.repairFailedPredicate))
    ) {
      throw new Error("Installer trust-fault repair predicate is invalid");
    }
    if (
      diagnostic.repairFailedPredicate !== null &&
      diagnostic.predicate !== "transition-model-rejected"
    ) {
      throw new Error("Installer trust-fault binding predicate cannot carry a Repair predicate");
    }
    if (diagnostic.repairFailedPredicate !== null) {
      if (previous === null) {
        throw new Error("Installer trust-fault repair diagnostic lacks previous state");
      }
      const currentIsPrecursor = isTransitionPrecursorSummary(current);
      const previousIsRevoked = isTransitionRevokedFinalizationSummary(previous);
      if (
        !(
          (diagnostic.repairFailedPredicate === "current-not-precursor" && !currentIsPrecursor) ||
          (diagnostic.repairFailedPredicate === "previous-not-revoked-finalization" &&
            currentIsPrecursor &&
            !previousIsRevoked) ||
          (diagnostic.repairFailedPredicate === "previous-revoked-store-not-idle-or-verifying" &&
            currentIsPrecursor &&
            previousIsRevoked &&
            (previous.store === "reconciling" || previous.store === "writing"))
        )
      ) {
        throw new Error("Installer trust-fault repair diagnostic is contradictory");
      }
    }
    return;
  }
  if (message !== INSTALLER_TRUST_TRANSITION_BINDING_FAILURE_MESSAGE) {
    throw new Error("Installer trust-fault transition binding diagnostic message is not exact");
  }
  exactKeys(diagnostic, ["failedPredicate", "previousRelationalState"]);
  if (
    typeof diagnostic.failedPredicate !== "string" ||
    !isTransitionFailedPredicate(diagnostic.failedPredicate)
  ) {
    throw new Error("Installer trust-fault transition binding failed predicate is invalid");
  }
  const previous = parseTransitionRelationalStateEvidence(diagnostic.previousRelationalState);
  if (previous === null) {
    throw new Error("Installer trust-fault transition binding previous state is invalid");
  }
  if (
    (diagnostic.failedPredicate === "previous-not-revoked-finalization" &&
      isTransitionRevokedFinalizationSummary(previous)) ||
    (diagnostic.failedPredicate === "previous-revoked-store-not-idle-or-verifying" &&
      (!isTransitionRevokedFinalizationSummary(previous) ||
        (previous.store !== "reconciling" && previous.store !== "writing")))
  ) {
    throw new Error("Installer trust-fault transition binding diagnostic is contradictory");
  }
}

function sanitizedFailureContainsName(input: unknown, expectedName: string): boolean {
  if (input === null) return false;
  const node = object(input, "failure node");
  if (node.name === expectedName) return true;
  if (node.cause !== null && sanitizedFailureContainsName(node.cause, expectedName)) return true;
  if (!Array.isArray(node.errors)) return false;
  return node.errors.some((member) => sanitizedFailureContainsName(member, expectedName));
}

function sanitizedFailureCollectionContainsName(
  primary: unknown,
  cleanupFailures: readonly unknown[],
  expectedName: string,
): boolean {
  return (
    sanitizedFailureContainsName(primary, expectedName) ||
    cleanupFailures.some((cleanup) => sanitizedFailureContainsName(cleanup, expectedName))
  );
}

function sanitizedFailureProofFinalizationDiagnosticCount(input: unknown): number {
  if (input === null) return 0;
  const node = object(input, "failure node");
  const own = Object.hasOwn(node, "proofFinalizationDiagnostic") ? 1 : 0;
  const cause = sanitizedFailureProofFinalizationDiagnosticCount(node.cause);
  if (!Array.isArray(node.errors)) return own + cause;
  return (
    own +
    cause +
    node.errors.reduce(
      (count, member) => count + sanitizedFailureProofFinalizationDiagnosticCount(member),
      0,
    )
  );
}

function sanitizedFailureMessageCount(input: unknown, expectedMessage: string): number {
  if (input === null) return 0;
  const node = object(input, "failure node");
  const own = node.message === expectedMessage ? 1 : 0;
  const cause = sanitizedFailureMessageCount(node.cause, expectedMessage);
  if (!Array.isArray(node.errors)) return own + cause;
  return (
    own +
    cause +
    node.errors.reduce(
      (count, member) => count + sanitizedFailureMessageCount(member, expectedMessage),
      0,
    )
  );
}

function validatePartialCells(
  authorityInput: unknown,
  cellsInput: unknown,
  resultSchemaVersion: unknown,
  proofSemantics: InstallerTrustFaultResultProofSemantics = "legacy-closed-world",
  transferTelemetrySchemaVersion: InstallerTrustFaultTransferTelemetrySchemaVersion = 9,
): readonly InstallerTrustFaultCellEvidence[] {
  if (!Array.isArray(cellsInput) || cellsInput.length > INSTALLER_TRUST_FAULT_CELL_IDS.length) {
    throw new Error("Installer trust-fault partial cells are invalid");
  }
  if (authorityInput === null) {
    if (cellsInput.length !== 0) {
      throw new Error("Installer trust-fault cells lack preflight authority");
    }
    return Object.freeze([]);
  }
  const authority = parseInstallerTrustFaultAuthority(authorityInput);
  const profiles = new Set<string>();
  const nonces = new Set<string>();
  const parsedCells = cellsInput.map((rawCell, index) => {
    const cell =
      resultSchemaVersion === INSTALLER_TRUST_FAULTS_LEGACY_SCHEMA_VERSION
        ? parseInstallerTrustFaultCellLegacy(rawCell, authority, transferTelemetrySchemaVersion)
        : resultSchemaVersion === INSTALLER_TRUST_FAULTS_PREVIOUS_SCHEMA_VERSION
          ? parseInstallerTrustFaultCellV2(rawCell, authority, transferTelemetrySchemaVersion)
          : resultSchemaVersion === INSTALLER_TRUST_FAULTS_PROOF_SCHEMA_VERSION
            ? parseInstallerTrustFaultCellV3(rawCell, authority, transferTelemetrySchemaVersion)
            : resultSchemaVersion === INSTALLER_TRUST_FAULTS_PERSISTENCE_SCHEMA_VERSION
              ? parseInstallerTrustFaultCellV4(rawCell, authority, transferTelemetrySchemaVersion)
              : resultSchemaVersion === INSTALLER_TRUST_FAULTS_SCHEMA_VERSION
                ? parseInstallerTrustFaultCell(
                    rawCell,
                    authority,
                    proofSemantics,
                    transferTelemetrySchemaVersion,
                  )
                : (() => {
                    throw new Error("Installer trust-fault partial-cell result schema is invalid");
                  })();
    if (
      cell.id !== INSTALLER_TRUST_FAULT_CELL_IDS[index] ||
      profiles.has(cell.profileId) ||
      nonces.has(cell.fault.nonce)
    ) {
      throw new Error("Installer trust-fault partial cells are duplicated or out of order");
    }
    profiles.add(cell.profileId);
    nonces.add(cell.fault.nonce);
    return cell;
  });
  return Object.freeze(parsedCells);
}

function validateRawObservationFailedCellEvidence(
  input: unknown,
  authorityInput: unknown,
  completedCells: readonly InstallerTrustFaultCellEvidence[],
  phase: unknown,
  productTerminalFailure: boolean,
  cellValidationFailure: boolean,
  proofSemantics: InstallerTrustFaultResultProofSemantics,
): void {
  if (
    input === null ||
    object(input, "schema-12 failed-cell evidence").kind !== "raw-observations"
  ) {
    validateCurrentFailedCellEvidence(
      input,
      authorityInput,
      completedCells,
      phase,
      productTerminalFailure,
      cellValidationFailure,
      INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION,
    );
    return;
  }
  const failedCell = object(input, "raw failed-cell evidence");
  exactKeys(failedCell, ["evidence", "kind"]);
  if (failedCell.kind !== "raw-observations") {
    throw new Error("Installer trust-fault cell failure lacks raw observations");
  }
  const evidence =
    proofSemantics === "historical-active-raw-v2"
      ? validateRetainedInstallerTrustFaultAsynchronousHandoffRawObservationEvidence(
          failedCell.evidence,
        )
      : validateInstallerTrustFaultRawObservationEvidence(failedCell.evidence);
  const expectedId = INSTALLER_TRUST_FAULT_CELL_IDS[completedCells.length];
  if (
    authorityInput === null ||
    phase !== "cell" ||
    productTerminalFailure ||
    cellValidationFailure ||
    expectedId === undefined ||
    evidence.cellId !== expectedId
  ) {
    throw new Error("Installer trust-fault raw observations identify the wrong partial cell");
  }
  const authority = parseInstallerTrustFaultAuthority(authorityInput);
  const expectedResource = selectInstallerTrustFaultResource(authority, expectedId);
  if (
    evidence.authority.artifactDigest !== authority.artifactDigest ||
    evidence.authority.releaseDigest !== authority.releaseDigest ||
    evidence.faultResourceId !== expectedResource.id
  ) {
    throw new Error("Installer trust-fault raw observations differ from outer cell authority");
  }
}

function validateCurrentFailedCellEvidence(
  input: unknown,
  authorityInput: unknown,
  completedCells: readonly InstallerTrustFaultCellEvidence[],
  failurePhase: unknown,
  productTerminalFailure: boolean,
  cellValidationFailure: boolean,
  schemaVersion:
    | typeof INSTALLER_TRUST_FAULT_CELL_VALIDATION_RUN_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULT_BINDING_DIAGNOSTIC_RUN_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULT_TERMINAL_REPEAT_RUN_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULT_RUN_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION,
): void {
  if (input === null) {
    if (cellValidationFailure) {
      throw new Error("Installer trust-fault validation failure lacks cell-validation evidence");
    }
    validateInstallerTrustFaultFailedCellRunBinding(
      null,
      completedCells.map((cell) => cell.id),
      failurePhase,
      productTerminalFailure,
    );
    return;
  }
  const value = object(input, "failed-cell evidence");
  if (value.kind === "product-terminal") {
    exactKeys(value, ["evidence", "kind"]);
    if (!productTerminalFailure) {
      throw new Error("Installer trust-fault product-terminal branch lacks its typed failure");
    }
    if (cellValidationFailure) {
      throw new Error("Installer trust-fault product-terminal branch has validation provenance");
    }
    validateFailedCellEvidence(
      value.evidence,
      authorityInput,
      completedCells,
      failurePhase,
      true,
      schemaVersion === INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION
        ? INSTALLER_TRUST_FAULT_TRANSITION_PROOF_SCHEMA_VERSION
        : INSTALLER_TRUST_FAULT_TRANSITION_PROOF_PREVIOUS_SCHEMA_VERSION,
    );
    return;
  }
  if (value.kind !== "cell-validation") {
    throw new Error("Installer trust-fault failed-cell evidence kind is invalid");
  }
  if (productTerminalFailure) {
    throw new Error("Installer trust-fault cell-validation branch contradicts product terminal");
  }
  if (!cellValidationFailure) {
    throw new Error("Installer trust-fault cell-validation branch lacks typed provenance");
  }
  validateCellValidationEvidence(
    value,
    authorityInput,
    completedCells,
    failurePhase,
    schemaVersion,
  );
}

function validateCellValidationEvidence(
  input: Record<string, unknown>,
  authorityInput: unknown,
  completedCells: readonly InstallerTrustFaultCellEvidence[],
  failurePhase: unknown,
  schemaVersion:
    | typeof INSTALLER_TRUST_FAULT_CELL_VALIDATION_RUN_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULT_BINDING_DIAGNOSTIC_RUN_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULT_TERMINAL_REPEAT_RUN_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULT_RUN_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION,
): void {
  exactKeys(input, [
    ...(schemaVersion === INSTALLER_TRUST_FAULT_BINDING_DIAGNOSTIC_RUN_SCHEMA_VERSION ||
    schemaVersion === INSTALLER_TRUST_FAULT_TERMINAL_REPEAT_RUN_SCHEMA_VERSION ||
    schemaVersion === INSTALLER_TRUST_FAULT_RUN_SCHEMA_VERSION ||
    schemaVersion === INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION
      ? ["accounting", "http"]
      : []),
    "attempt",
    "faultResourceId",
    "id",
    "kind",
    "observed",
    "operation",
    "phase",
    "post",
    "proof",
    "terminal",
    "violatedPredicates",
  ]);
  if (authorityInput === null) {
    throw new Error("Installer trust-fault cell-validation evidence lacks authority");
  }
  const authority = parseInstallerTrustFaultAuthority(authorityInput);
  const expectedId = validateInstallerTrustFaultFailedCellRunBinding(
    { id: input.id },
    completedCells.map((cell) => cell.id),
    failurePhase,
    true,
  );
  if (expectedId === null || input.id !== expectedId) {
    throw new Error("Installer trust-fault cell-validation evidence lacks the exact next cell");
  }
  const contract = installerTrustFaultOperationContract(expectedId);
  const resource = selectInstallerTrustFaultResource(authority, expectedId);
  if (
    input.kind !== "cell-validation" ||
    input.attempt !== contract.attempt ||
    input.operation !== contract.operation ||
    input.phase !== contract.phase ||
    input.faultResourceId !== resource.id
  ) {
    throw new Error("Installer trust-fault cell-validation contract binding is invalid");
  }
  const evidence = input as unknown as InstallerTrustFaultCellValidationEvidence;
  validateCellValidationProjection(evidence, authority, schemaVersion);
  const expectedPredicates =
    schemaVersion === INSTALLER_TRUST_FAULT_CELL_VALIDATION_RUN_SCHEMA_VERSION
      ? deriveV8CellValidationPredicates(evidence, authority)
      : deriveCellValidationPredicates(evidence, authority);
  const allowedPredicates =
    schemaVersion === INSTALLER_TRUST_FAULT_CELL_VALIDATION_RUN_SCHEMA_VERSION
      ? INSTALLER_TRUST_FAULT_V8_CELL_VALIDATION_PREDICATES
      : INSTALLER_TRUST_FAULT_CELL_VALIDATION_PREDICATES;
  if (
    !Array.isArray(input.violatedPredicates) ||
    input.violatedPredicates.length < 1 ||
    input.violatedPredicates.length > allowedPredicates.length ||
    canonicalJson(input.violatedPredicates) !== canonicalJson(expectedPredicates)
  ) {
    throw new Error(
      `Installer trust-fault cell-validation predicate evidence is invalid: observed=${canonicalJson(input.violatedPredicates)} expected=${canonicalJson(expectedPredicates)}`,
    );
  }
}

function validateCellValidationProjection(
  evidence: InstallerTrustFaultCellValidationEvidence,
  authority: InstallerTrustFaultAuthority,
  schemaVersion:
    | typeof INSTALLER_TRUST_FAULT_CELL_VALIDATION_RUN_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULT_BINDING_DIAGNOSTIC_RUN_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULT_TERMINAL_REPEAT_RUN_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULT_RUN_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION,
): void {
  const observed = object(evidence.observed, "cell-validation observed contract");
  exactKeys(observed, [
    "attempt",
    "cellId",
    "faultEventReleaseDigest",
    "faultEventResourceId",
    "faultOperation",
    "faultReleaseDigest",
    "faultResourceId",
    "outcome",
    "phase",
  ]);
  const post = object(evidence.post, "cell-validation post projection");
  exactKeys(post, [
    "activeReleaseDigest",
    "launchEnabled",
    "operationInitialActiveReleaseDigest",
    "operationInitialPreviousReleaseDigest",
    "operationInitialPublicationCount",
    "previousReleaseDigest",
    "publicationOccurred",
    "targetReleaseDigest",
    "terminalPublicationCount",
    "uiReleaseDigest",
    "uiShellGenerationId",
  ]);
  const proof = object(evidence.proof, "cell-validation proof projection");
  exactKeys(proof, ["finalStateId", "lastOrder", "streamSha256", "terminalStateSha256"]);
  const terminal = object(evidence.terminal, "cell-validation terminal projection");
  exactKeys(terminal, ["store", "transfer", "ui"]);
  const store = object(terminal.store, "cell-validation store projection");
  exactKeys(store, [
    "activeReleaseDigest",
    "currentReleaseDigest",
    "currentResourceId",
    "failureMessageSha256",
    "previousReleaseDigest",
    "publicationCount",
    "state",
  ]);
  const transfer = object(terminal.transfer, "cell-validation transfer projection");
  exactKeys(transfer, [
    "activeReleaseDigest",
    "failureCode",
    "failureMessageSha256",
    "failureOperation",
    "failureResourceId",
    "state",
  ]);
  const ui = object(terminal.ui, "cell-validation UI projection");
  exactKeys(ui, [
    "activeReleaseDigest",
    "failureCode",
    "failureResourceId",
    "releaseDigest",
    "shellGenerationId",
    "storeState",
    "transferState",
    "uiState",
  ]);
  const manifestIds = new Set(
    parseInstallerTrustFaultManifestResources(authority).map((resource) => resource.id),
  );
  for (const digestValue of [
    post.activeReleaseDigest,
    post.operationInitialActiveReleaseDigest,
    post.operationInitialPreviousReleaseDigest,
    post.previousReleaseDigest,
    post.targetReleaseDigest,
    post.uiReleaseDigest,
    observed.faultEventReleaseDigest,
    observed.faultReleaseDigest,
    store.activeReleaseDigest,
    store.currentReleaseDigest,
    store.previousReleaseDigest,
    transfer.activeReleaseDigest,
    ui.activeReleaseDigest,
    ui.releaseDigest,
  ]) {
    if (digestValue !== null && !nullableDigest(digestValue)) {
      throw new Error("Installer trust-fault cell-validation digest projection is invalid");
    }
  }
  for (const projectedResourceId of [
    observed.faultResourceId,
    observed.faultEventResourceId,
    store.currentResourceId,
    transfer.failureResourceId,
    ui.failureResourceId,
  ]) {
    if (
      projectedResourceId !== null &&
      (typeof projectedResourceId !== "string" || !manifestIds.has(projectedResourceId))
    ) {
      throw new Error("Installer trust-fault cell-validation resource projection is invalid");
    }
  }
  if (
    (observed.attempt !== null && observed.attempt !== 1 && observed.attempt !== 2) ||
    (observed.cellId !== null &&
      !(INSTALLER_TRUST_FAULT_CELL_IDS as readonly string[]).includes(observed.cellId as string)) ||
    (observed.faultOperation !== null &&
      observed.faultOperation !== "install" &&
      observed.faultOperation !== "repair") ||
    (observed.outcome !== null && observed.outcome !== "failed" && observed.outcome !== "passed") ||
    (observed.phase !== null && observed.phase !== "attempt-1" && observed.phase !== "attempt-2") ||
    (post.launchEnabled !== null && typeof post.launchEnabled !== "boolean") ||
    (post.publicationOccurred !== null && typeof post.publicationOccurred !== "boolean") ||
    !nullableNonnegativeInteger(post.operationInitialPublicationCount) ||
    !nullableNonnegativeInteger(post.terminalPublicationCount) ||
    !nullablePositiveInteger(proof.finalStateId) ||
    !nullablePositiveInteger(proof.lastOrder) ||
    !nullableSha256(proof.streamSha256) ||
    !nullableSha256(proof.terminalStateSha256) ||
    !nullableSha256(store.failureMessageSha256) ||
    !nullableSha256(transfer.failureMessageSha256) ||
    (post.uiShellGenerationId !== null &&
      post.uiShellGenerationId !== `${authority.artifactDigest}:${authority.releaseDigest}`) ||
    (ui.shellGenerationId !== null &&
      ui.shellGenerationId !== `${authority.artifactDigest}:${authority.releaseDigest}`) ||
    (store.state !== null && !INSTALL_STORE_STATES.has(store.state as string)) ||
    (transfer.state !== null && !INSTALLER_TRANSFER_STATES.has(transfer.state as string)) ||
    (ui.storeState !== null && !INSTALL_STORE_STATES.has(ui.storeState as string)) ||
    (ui.transferState !== null && !INSTALLER_TRANSFER_STATES.has(ui.transferState as string)) ||
    (ui.uiState !== null && !INSTALLER_UI_STATES.has(ui.uiState as string)) ||
    (transfer.failureOperation !== null &&
      transfer.failureOperation !== "install" &&
      transfer.failureOperation !== "repair") ||
    (transfer.failureCode !== null &&
      !INSTALLER_TRUST_PRODUCT_TERMINAL_FAILURE_CODES.has(transfer.failureCode as string)) ||
    (ui.failureCode !== null &&
      !INSTALLER_TRUST_PRODUCT_TERMINAL_FAILURE_CODES.has(ui.failureCode as string))
  ) {
    throw new Error("Installer trust-fault cell-validation projection is invalid");
  }
  if (
    schemaVersion === INSTALLER_TRUST_FAULT_BINDING_DIAGNOSTIC_RUN_SCHEMA_VERSION ||
    schemaVersion === INSTALLER_TRUST_FAULT_TERMINAL_REPEAT_RUN_SCHEMA_VERSION ||
    schemaVersion === INSTALLER_TRUST_FAULT_RUN_SCHEMA_VERSION ||
    schemaVersion === INSTALLER_TRUST_FAULT_RAW_OBSERVATION_RUN_SCHEMA_VERSION
  ) {
    validateCellValidationAccountingProjection(evidence.accounting);
    validateCellValidationHttpProjection(
      evidence.http,
      selectInstallerTrustFaultResource(authority, evidence.id),
    );
  }
}

function validateCellValidationAccountingProjection(
  accounting: InstallerTrustFaultCellValidationEvidence["accounting"],
): void {
  const value = object(accounting, "cell-validation accounting projection");
  exactKeys(value, [
    "baseline",
    "declaredDownloadedBytes",
    "declaredRepairedBytes",
    "declaredRepairedResourceCount",
    "delta",
    "terminal",
  ]);
  const baseline = validateCellValidationAccountingSnapshot(
    value.baseline,
    "cell-validation accounting baseline",
  );
  const delta = validateCellValidationAccountingSnapshot(
    value.delta,
    "cell-validation accounting delta",
  );
  const terminal = validateCellValidationAccountingSnapshot(
    value.terminal,
    "cell-validation accounting terminal",
  );
  if (
    !nullableNonnegativeInteger(value.declaredDownloadedBytes) ||
    !nullableNonnegativeInteger(value.declaredRepairedBytes) ||
    !nullableNonnegativeInteger(value.declaredRepairedResourceCount) ||
    canonicalJson(delta) !== canonicalJson(projectAccountingDelta(baseline, terminal))
  ) {
    throw new Error("Installer trust-fault cell-validation accounting projection is invalid");
  }
}

function validateCellValidationAccountingSnapshot(
  input: unknown,
  label: string,
): InstallerTrustFaultCellValidationAccountingSnapshot {
  const value = object(input, label);
  exactKeys(value, [
    "completedResourceCount",
    "downloadedBytes",
    "repairedBytes",
    "repairedResourceCount",
  ]);
  if (Object.values(value).some((entry) => !nullableNonnegativeInteger(entry))) {
    throw new Error(`Installer trust-fault ${label} is invalid`);
  }
  return value as unknown as InstallerTrustFaultCellValidationAccountingSnapshot;
}

function validateCellValidationHttpProjection(
  http: InstallerTrustFaultCellValidationEvidence["http"],
  expectedResource: ReturnType<typeof selectInstallerTrustFaultResource>,
): void {
  const value = object(http, "cell-validation HTTP projection");
  exactKeys(value, ["operationRangeRequestCount", "selected", "selectedRequestCount"]);
  const operationRangeRequestCount = validatedNullableNonnegativeIntegerValue(
    value.operationRangeRequestCount,
    4_096,
    "cell-validation operation Range request count",
  );
  const selectedRequestCount = validatedNullableNonnegativeIntegerValue(
    value.selectedRequestCount,
    4_096,
    "cell-validation selected request count",
  );
  if (
    operationRangeRequestCount !== null &&
    selectedRequestCount !== null &&
    selectedRequestCount > operationRangeRequestCount
  ) {
    throw new Error("Installer trust-fault selected request count exceeds total Range count");
  }
  if (value.selected === null) {
    if (selectedRequestCount === 1) {
      throw new Error("Installer trust-fault selected HTTP projection is missing");
    }
    return;
  }
  if (selectedRequestCount !== 1) {
    throw new Error("Installer trust-fault selected HTTP projection is ambiguous");
  }
  const selected = object(value.selected, "cell-validation selected HTTP projection");
  exactKeys(selected, [
    "bodyBytes",
    "etagMatchesManifest",
    "ifRangeMatchesEtag",
    "ifRangePresent",
    "manifestPathMatch",
    "pathSha256",
    "rangeClassification",
    "responseKind",
    "sameOriginPath",
    "status",
  ]);
  validatedNullableNonnegativeIntegerValue(
    selected.bodyBytes,
    Number.MAX_SAFE_INTEGER,
    "cell-validation selected body bytes",
  );
  const status = validatedNullableNonnegativeIntegerValue(
    selected.status,
    599,
    "cell-validation selected status",
  );
  if (
    (selected.etagMatchesManifest !== null && typeof selected.etagMatchesManifest !== "boolean") ||
    (selected.ifRangeMatchesEtag !== null && typeof selected.ifRangeMatchesEtag !== "boolean") ||
    (selected.ifRangePresent !== null && typeof selected.ifRangePresent !== "boolean") ||
    (selected.manifestPathMatch !== null && typeof selected.manifestPathMatch !== "boolean") ||
    (selected.sameOriginPath !== null && typeof selected.sameOriginPath !== "boolean") ||
    !nullableSha256(selected.pathSha256) ||
    (selected.rangeClassification !== null &&
      selected.rangeClassification !== "absent" &&
      selected.rangeClassification !== "exact-zero-offset" &&
      selected.rangeClassification !== "other") ||
    (selected.responseKind !== null &&
      selected.responseKind !== "full" &&
      selected.responseKind !== "range" &&
      selected.responseKind !== "other")
  ) {
    throw new Error("Installer trust-fault selected HTTP projection is invalid");
  }
  const expectedPathSha256 = createHash("sha256").update(expectedResource.path).digest("hex");
  if (
    selected.manifestPathMatch !== true ||
    selected.sameOriginPath !== true ||
    selected.pathSha256 !== expectedPathSha256 ||
    (selected.ifRangePresent === false && selected.ifRangeMatchesEtag !== false) ||
    (selected.rangeClassification === "absent" && selected.responseKind === "range") ||
    (selected.rangeClassification === "exact-zero-offset" &&
      status === 206 &&
      selected.responseKind !== "range")
  ) {
    throw new Error("Installer trust-fault selected HTTP projection contradicts");
  }
}

function createInstallerTrustFaultCellValidationEvidence(
  rawCell: unknown,
  expectedId: InstallerTrustFaultCellId,
  authority: InstallerTrustFaultAuthority,
): InstallerTrustFaultCellValidationEvidence {
  const contract = installerTrustFaultOperationContract(expectedId);
  const expectedResource = selectInstallerTrustFaultResource(authority, expectedId);
  const cell = recordOrNull(rawCell);
  const fault = recordOrNull(cell?.fault);
  const faultEvents = arrayOrEmpty(fault?.events);
  const faultEvent = recordOrNull(faultEvents[0]);
  const attempts = arrayOrEmpty(cell?.attempts);
  const rawAttempt = recordOrNull(
    attempts.find((candidate) => recordOrNull(candidate)?.index === contract.attempt) ??
      attempts.at(-1),
  );
  const snapshots = arrayOrEmpty(cell?.snapshots);
  const baselineSnapshot = recordOrNull(
    snapshots[
      expectedId === "reused-object-corruption" ||
      expectedId === "final-verification-corruption" ||
      expectedId === "repeated-server-corruption"
        ? 1
        : 0
    ],
  );
  const baselineTransfer = recordOrNull(baselineSnapshot?.installerTransfer);
  const terminalSnapshot = recordOrNull(snapshots.at(-1));
  const store = recordOrNull(terminalSnapshot?.installStore);
  const transfer = recordOrNull(terminalSnapshot?.installerTransfer);
  const rawAccounting = recordOrNull(cell?.accounting);
  const http = projectCellValidationHttp(cell?.http, expectedResource);
  const post = recordOrNull(cell?.postValidation);
  const proof = recordOrNull(cell?.transitions);
  const states = arrayOrEmpty(proof?.states);
  const finalStateId = safePositiveInteger(proof?.finalStateId);
  const finalState = recordOrNull(
    states.find((candidate) => recordOrNull(candidate)?.id === finalStateId) ?? states.at(-1),
  );
  const terminalUi = Object.freeze({
    activeReleaseDigest: safeDigest(finalState?.activeReleaseDigest),
    failureCode: safeFailureCode(finalState?.failureCode),
    failureResourceId: safeManifestResourceId(finalState?.failureResourceId, authority),
    releaseDigest: safeDigest(finalState?.releaseDigest),
    shellGenerationId: safeShellGeneration(finalState?.shellGenerationId, authority),
    storeState: safeEnum(finalState?.storeState, INSTALL_STORE_STATES),
    transferState: safeEnum(finalState?.transferState, INSTALLER_TRANSFER_STATES),
    uiState: safeEnum(finalState?.uiState, INSTALLER_UI_STATES),
  });
  const evidence: InstallerTrustFaultCellValidationEvidence = Object.freeze({
    accounting: Object.freeze({
      baseline: projectAccountingSnapshot(baselineTransfer),
      declaredDownloadedBytes: safeNonnegativeInteger(rawAccounting?.downloadedBytes),
      declaredRepairedBytes: safeNonnegativeInteger(rawAccounting?.repairedBytes),
      declaredRepairedResourceCount: safeNonnegativeInteger(rawAccounting?.repairedResourceCount),
      delta: projectAccountingDelta(
        projectAccountingSnapshot(baselineTransfer),
        projectAccountingSnapshot(transfer),
      ),
      terminal: projectAccountingSnapshot(transfer),
    }),
    attempt: contract.attempt,
    faultResourceId: expectedResource.id,
    id: expectedId,
    kind: "cell-validation",
    observed: Object.freeze({
      attempt: safeAttempt(rawAttempt?.index),
      cellId: safeCellId(cell?.id),
      faultEventReleaseDigest: safeDigest(faultEvent?.releaseDigest),
      faultEventResourceId: safeManifestResourceId(faultEvent?.resourceId, authority),
      faultOperation: safeOperation(faultEvent?.operation),
      faultReleaseDigest: safeDigest(fault?.releaseDigest),
      faultResourceId: safeManifestResourceId(fault?.resourceId, authority),
      outcome: safeOutcome(rawAttempt?.outcome),
      phase: safePhase(finalState?.phase),
    }),
    operation: contract.operation,
    phase: contract.phase,
    http,
    post: Object.freeze({
      activeReleaseDigest: safeDigest(post?.activeReleaseDigest),
      launchEnabled: safeBoolean(post?.launchEnabled),
      operationInitialActiveReleaseDigest: safeDigest(post?.operationInitialActiveReleaseDigest),
      operationInitialPreviousReleaseDigest: safeDigest(
        post?.operationInitialPreviousReleaseDigest,
      ),
      operationInitialPublicationCount: safeNonnegativeInteger(
        post?.operationInitialPublicationCount,
      ),
      previousReleaseDigest: safeDigest(post?.previousReleaseDigest),
      publicationOccurred: safeBoolean(post?.publicationOccurred),
      targetReleaseDigest: safeDigest(post?.targetReleaseDigest),
      terminalPublicationCount: safeNonnegativeInteger(post?.terminalPublicationCount),
      uiReleaseDigest: safeDigest(post?.uiReleaseDigest),
      uiShellGenerationId: safeShellGeneration(post?.uiShellGenerationId, authority),
    }),
    proof: Object.freeze({
      finalStateId,
      lastOrder: safePositiveInteger(proof?.lastOrder),
      streamSha256: safeDigest(proof?.streamSha256),
      terminalStateSha256:
        finalState === null
          ? null
          : createHash("sha256").update(canonicalJson(terminalUi)).digest("hex"),
    }),
    terminal: Object.freeze({
      store: Object.freeze({
        activeReleaseDigest: safeDigest(store?.activeReleaseDigest),
        currentReleaseDigest: safeDigest(store?.currentReleaseDigest),
        currentResourceId: safeManifestResourceId(store?.currentResourceId, authority),
        failureMessageSha256: safeFailureMessageSha256(store?.failureMessage),
        previousReleaseDigest: safeDigest(store?.previousReleaseDigest),
        publicationCount: safeNonnegativeInteger(store?.publicationCount),
        state: safeEnum(store?.state, INSTALL_STORE_STATES),
      }),
      transfer: Object.freeze({
        activeReleaseDigest: safeDigest(transfer?.activeReleaseDigest),
        failureCode: safeFailureCode(transfer?.failureCode),
        failureMessageSha256: safeFailureMessageSha256(transfer?.failureMessage),
        failureOperation: safeOperation(transfer?.failureOperation),
        failureResourceId: safeManifestResourceId(transfer?.failureResourceId, authority),
        state: safeEnum(transfer?.state, INSTALLER_TRANSFER_STATES),
      }),
      ui: terminalUi,
    }),
    violatedPredicates: Object.freeze([]),
  });
  validateCellValidationRawProjection(evidence, rawCell, expectedResource, authority);
  return Object.freeze({
    ...evidence,
    violatedPredicates: deriveCellValidationPredicates(evidence, authority),
  });
}

function validateCellValidationRawProjection(
  evidence: InstallerTrustFaultCellValidationEvidence,
  rawCell: unknown,
  expectedResource: ReturnType<typeof selectInstallerTrustFaultResource>,
  authority: InstallerTrustFaultAuthority,
): void {
  const cell = recordOrNull(rawCell);
  const snapshots = arrayOrEmpty(cell?.snapshots);
  const baselineSnapshot = recordOrNull(
    snapshots[
      evidence.id === "reused-object-corruption" ||
      evidence.id === "final-verification-corruption" ||
      evidence.id === "repeated-server-corruption"
        ? 1
        : 0
    ],
  );
  const terminalSnapshot = recordOrNull(snapshots.at(-1));
  const baseline = projectAccountingSnapshot(recordOrNull(baselineSnapshot?.installerTransfer));
  const terminal = projectAccountingSnapshot(recordOrNull(terminalSnapshot?.installerTransfer));
  const rawAccounting = recordOrNull(cell?.accounting);
  const expectedAccounting = Object.freeze({
    baseline,
    declaredDownloadedBytes: safeNonnegativeInteger(rawAccounting?.downloadedBytes),
    declaredRepairedBytes: safeNonnegativeInteger(rawAccounting?.repairedBytes),
    declaredRepairedResourceCount: safeNonnegativeInteger(rawAccounting?.repairedResourceCount),
    delta: projectAccountingDelta(baseline, terminal),
    terminal,
  });
  const expectedHttp = projectCellValidationHttp(cell?.http, expectedResource);
  if (
    canonicalJson(evidence.accounting) !== canonicalJson(expectedAccounting) ||
    canonicalJson(evidence.http) !== canonicalJson(expectedHttp)
  ) {
    throw new Error("Installer trust-fault raw cell projection is not exact");
  }
  validateCellValidationProjection(evidence, authority, INSTALLER_TRUST_FAULT_RUN_SCHEMA_VERSION);
}

function deriveV8CellValidationPredicates(
  evidence: InstallerTrustFaultCellValidationEvidence,
  authority: InstallerTrustFaultAuthority,
): readonly string[] {
  return deriveCommonCellValidationPredicates(evidence, authority, true);
}

function deriveCellValidationPredicates(
  evidence: InstallerTrustFaultCellValidationEvidence,
  authority: InstallerTrustFaultAuthority,
): readonly InstallerTrustFaultCellValidationPredicate[] {
  const violations = new Set<InstallerTrustFaultCellValidationPredicate>();
  const expectedResource = selectInstallerTrustFaultResource(authority, evidence.id);
  const expectedPathSha256 = createHash("sha256").update(expectedResource.path).digest("hex");
  const hasOneAuthoritativeSelectedRequest =
    evidence.http.selectedRequestCount === 1 &&
    evidence.http.selected?.manifestPathMatch === true &&
    evidence.http.selected.sameOriginPath === true &&
    evidence.http.selected.pathSha256 === expectedPathSha256;
  if (!hasOneAuthoritativeSelectedRequest) {
    violations.add("selected-request-count");
  }
  if (hasOneAuthoritativeSelectedRequest) {
    if (evidence.http.selected?.rangeClassification !== "exact-zero-offset") {
      violations.add("selected-range-classification");
    }
    if (
      evidence.http.selected.status !== 206 ||
      evidence.http.selected.bodyBytes !== expectedResource.bytes ||
      evidence.http.selected.etagMatchesManifest !== true ||
      evidence.http.selected.responseKind !== "range"
    ) {
      violations.add("selected-status");
    }
    if (
      evidence.http.selected.ifRangePresent !== false ||
      evidence.http.selected.ifRangeMatchesEtag !== false
    ) {
      violations.add("selected-if-range");
    }
  }
  if (
    evidence.http.operationRangeRequestCount === null ||
    evidence.http.selectedRequestCount === null ||
    evidence.http.operationRangeRequestCount !== evidence.http.selectedRequestCount
  ) {
    violations.add("operation-range-request-count");
  }
  const expectedOpfsResources = parseInstallerTrustFaultManifestResources(authority).filter(
    (resource) => resource.target === "opfs",
  );
  const expectedResourceCount = expectedOpfsResources.length;
  const expectedTotalBytes = expectedOpfsResources.reduce(
    (total, resource) => total + resource.bytes,
    0,
  );
  if (
    evidence.accounting.declaredRepairedResourceCount !== 1 ||
    evidence.accounting.baseline.repairedResourceCount !== 0 ||
    evidence.accounting.terminal.repairedResourceCount !== 1 ||
    evidence.accounting.delta.repairedResourceCount !== 1 ||
    evidence.accounting.baseline.completedResourceCount !== expectedResourceCount ||
    evidence.accounting.terminal.completedResourceCount !== expectedResourceCount ||
    evidence.accounting.delta.completedResourceCount !== 0
  ) {
    violations.add("repaired-resource-count");
  }
  if (
    evidence.accounting.declaredRepairedBytes !== expectedResource.bytes ||
    evidence.accounting.baseline.repairedBytes !== 0 ||
    evidence.accounting.terminal.repairedBytes !== expectedResource.bytes ||
    evidence.accounting.delta.repairedBytes !== expectedResource.bytes
  ) {
    violations.add("repaired-bytes");
  }
  if (
    evidence.accounting.declaredDownloadedBytes !== expectedResource.bytes ||
    evidence.accounting.baseline.downloadedBytes !== expectedTotalBytes ||
    evidence.accounting.terminal.downloadedBytes !== expectedTotalBytes + expectedResource.bytes ||
    evidence.accounting.delta.downloadedBytes !== expectedResource.bytes
  ) {
    violations.add("downloaded-bytes");
  }
  for (const predicate of deriveCommonCellValidationPredicates(evidence, authority, false)) {
    violations.add(predicate as InstallerTrustFaultCellValidationPredicate);
  }
  return Object.freeze(
    INSTALLER_TRUST_FAULT_CELL_VALIDATION_PREDICATES.filter((predicate) =>
      violations.has(predicate),
    ),
  );
}

function deriveCommonCellValidationPredicates(
  evidence: InstallerTrustFaultCellValidationEvidence,
  authority: InstallerTrustFaultAuthority,
  includeV8CellContract: boolean,
): readonly string[] {
  const contract = installerTrustFaultOperationContract(evidence.id);
  const expectedResource = selectInstallerTrustFaultResource(authority, evidence.id);
  const violations = new Set<string>(includeV8CellContract ? ["cell-contract"] : []);
  if (evidence.observed.cellId !== evidence.id) violations.add("cell-id");
  if (evidence.observed.faultOperation !== contract.operation) violations.add("operation");
  if (
    evidence.observed.attempt !== contract.attempt ||
    evidence.observed.outcome !== contract.outcome
  ) {
    violations.add("attempt");
  }
  if (evidence.observed.phase !== contract.phase) violations.add("phase");
  if (
    evidence.observed.faultResourceId !== expectedResource.id ||
    evidence.observed.faultEventResourceId !== expectedResource.id ||
    evidence.observed.faultReleaseDigest !== authority.releaseDigest ||
    evidence.observed.faultEventReleaseDigest !== authority.releaseDigest ||
    (evidence.terminal.store.currentResourceId !== null &&
      evidence.terminal.store.currentResourceId !== expectedResource.id) ||
    (evidence.terminal.transfer.failureResourceId !== null &&
      evidence.terminal.transfer.failureResourceId !== expectedResource.id) ||
    (evidence.terminal.ui.failureResourceId !== null &&
      evidence.terminal.ui.failureResourceId !== expectedResource.id)
  ) {
    violations.add("manifest-resource");
  }
  const expectedTerminalState = contract.outcome === "passed" ? "ready" : "failed";
  if (
    evidence.terminal.store.state === null ||
    (contract.outcome === "passed" && evidence.terminal.store.state !== "ready") ||
    evidence.terminal.store.activeReleaseDigest !== evidence.post.activeReleaseDigest ||
    evidence.terminal.store.previousReleaseDigest !== evidence.post.previousReleaseDigest
  ) {
    violations.add("terminal-store");
  }
  if (
    evidence.terminal.transfer.state !== expectedTerminalState ||
    evidence.terminal.transfer.failureOperation !==
      (contract.outcome === "failed" ? contract.operation : null)
  ) {
    violations.add("terminal-transfer");
  }
  if (
    evidence.terminal.ui.uiState !== expectedTerminalState ||
    evidence.terminal.ui.activeReleaseDigest !== evidence.terminal.store.activeReleaseDigest ||
    evidence.terminal.ui.storeState !== evidence.terminal.store.state ||
    evidence.terminal.ui.transferState !== evidence.terminal.transfer.state
  ) {
    violations.add("terminal-ui");
  }
  if (
    evidence.post.targetReleaseDigest !== authority.releaseDigest ||
    evidence.post.launchEnabled !== (contract.outcome === "passed") ||
    evidence.post.operationInitialActiveReleaseDigest !==
      (contract.operation === "repair" ? authority.releaseDigest : null) ||
    evidence.post.operationInitialPreviousReleaseDigest !== null ||
    evidence.post.activeReleaseDigest !==
      (contract.outcome === "passed" ? authority.releaseDigest : null) ||
    evidence.post.activeReleaseDigest !== evidence.terminal.store.activeReleaseDigest ||
    evidence.post.previousReleaseDigest !== evidence.post.operationInitialPreviousReleaseDigest ||
    evidence.post.previousReleaseDigest !== evidence.terminal.store.previousReleaseDigest ||
    evidence.post.uiReleaseDigest !== evidence.terminal.ui.releaseDigest ||
    evidence.post.uiShellGenerationId !== evidence.terminal.ui.shellGenerationId ||
    evidence.post.uiReleaseDigest !==
      (contract.outcome === "passed" ? authority.releaseDigest : null) ||
    evidence.post.uiShellGenerationId !==
      (contract.outcome === "passed"
        ? `${authority.artifactDigest}:${authority.releaseDigest}`
        : null)
  ) {
    violations.add("post-validation");
  }
  const baseline = evidence.post.operationInitialPublicationCount;
  const expectedPublication =
    baseline === null
      ? null
      : projectInstallerTrustFaultTerminalPublication(
          contract.operation,
          contract.outcome,
          baseline,
        );
  if (
    expectedPublication === null ||
    evidence.post.publicationOccurred !== expectedPublication.publicationOccurred ||
    evidence.post.terminalPublicationCount !== expectedPublication.terminalPublicationCount ||
    evidence.terminal.store.publicationCount !== expectedPublication.terminalPublicationCount
  ) {
    violations.add("publication");
  }
  if (
    evidence.proof.finalStateId === null ||
    evidence.proof.lastOrder === null ||
    evidence.proof.streamSha256 === null ||
    evidence.proof.terminalStateSha256 === null ||
    evidence.proof.terminalStateSha256 !==
      createHash("sha256").update(canonicalJson(evidence.terminal.ui)).digest("hex")
  ) {
    violations.add("proof");
  }
  return Object.freeze(
    (includeV8CellContract
      ? INSTALLER_TRUST_FAULT_V8_CELL_VALIDATION_PREDICATES
      : INSTALLER_TRUST_FAULT_CELL_VALIDATION_PREDICATES
    ).filter((predicate) => violations.has(predicate)),
  );
}

function validateFailedCellEvidence(
  input: unknown,
  authorityInput: unknown,
  completedCells: readonly InstallerTrustFaultCellEvidence[],
  failurePhase: unknown,
  productTerminalFailure: boolean,
  transitionProofSchemaVersion:
    | typeof INSTALLER_TRUST_FAULT_TRANSITION_PROOF_PREVIOUS_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULT_TRANSITION_PROOF_SCHEMA_VERSION,
): void {
  const expectedCellId = validateInstallerTrustFaultFailedCellRunBinding(
    input,
    completedCells.map((cell) => cell.id),
    failurePhase,
    productTerminalFailure,
  );
  if (expectedCellId === null) return;
  if (authorityInput === null) {
    throw new Error("Installer trust-fault failed-cell evidence lacks authority");
  }
  const authority = parseInstallerTrustFaultAuthority(authorityInput);
  const manifestResources = parseInstallerTrustFaultManifestResources(authority);
  const manifestResourceById = new Map(
    manifestResources.map((resource) => [resource.id, resource] as const),
  );
  const expectedFaultResource = selectInstallerTrustFaultResource(authority, expectedCellId);
  const value = object(input, "failed-cell evidence");
  exactKeys(value, ["faultResourceId", "id", "terminal", "transitions"]);
  if (value.faultResourceId !== expectedFaultResource.id) {
    throw new Error("Installer trust-fault failed-cell identity is not the exact next cell");
  }
  const terminal = object(value.terminal, "failed-cell terminal");
  exactKeys(terminal, ["expected", "observed", "store", "transfer", "ui"]);
  if (
    (terminal.expected !== "failed" && terminal.expected !== "ready") ||
    (terminal.observed !== "failed" && terminal.observed !== "ready") ||
    terminal.expected === terminal.observed
  ) {
    throw new Error("Installer trust-fault failed-cell terminal direction is invalid");
  }
  const store = validateInstallStoreTelemetryProjection(terminal.store);
  if (
    !nullableCanonicalFailureMessage(store.failureMessage) ||
    (store.activeReleaseDigest !== null && store.activeReleaseDigest !== authority.releaseDigest) ||
    (store.currentReleaseDigest !== null && store.currentReleaseDigest !== authority.releaseDigest)
  ) {
    throw new Error("Installer trust-fault failed-cell store projection is invalid");
  }
  const currentStoreResourceId = store.currentResourceId;
  if (currentStoreResourceId !== null) {
    const currentStoreResource = manifestResourceById.get(currentStoreResourceId);
    if (
      currentStoreResource === undefined ||
      currentStoreResource.target !== "opfs" ||
      currentStoreResourceId !== value.faultResourceId ||
      store.currentReleaseDigest !== authority.releaseDigest
    ) {
      throw new Error("Installer trust-fault failed-cell store source authority is invalid");
    }
  }
  if (store.state === "ready" && store.activeReleaseDigest !== authority.releaseDigest) {
    throw new Error("Installer trust-fault failed-cell store source authority is invalid");
  }
  const transfer = object(terminal.transfer, "failed-cell transfer");
  exactKeys(transfer, [
    "activeReleaseDigest",
    "failureClass",
    "failureCode",
    "failureEvidence",
    "failureMessage",
    "failureOperation",
    "failureResourceId",
    "state",
  ]);
  const ui = object(terminal.ui, "failed-cell UI");
  exactKeys(ui, [
    "action",
    "failureCode",
    "failureOperation",
    "failureResourceId",
    "releaseDigest",
    "shellGenerationId",
    "state",
  ]);
  const transferFailureResourceId = validatedNullableBoundedString(
    transfer.failureResourceId,
    256,
    "transfer failure resource",
  );
  const uiFailureResourceId = validatedNullableBoundedString(
    ui.failureResourceId,
    256,
    "UI failure resource",
  );
  const uiShellGenerationId = validatedNullableBoundedString(
    ui.shellGenerationId,
    160,
    "UI shell generation",
  );
  const uiFailureOperation = validatedNullableBoundedString(
    ui.failureOperation,
    128,
    "UI failure operation",
  );
  if (
    !nullableDigest(transfer.activeReleaseDigest) ||
    !nullableDigest(ui.releaseDigest) ||
    typeof transfer.state !== "string" ||
    !["cancelled", "failed", "idle", "ready", "transferring", "verifying"].includes(
      transfer.state,
    ) ||
    ui.state !== terminal.observed ||
    (ui.failureCode !== null &&
      (typeof ui.failureCode !== "string" ||
        !INSTALLER_TRUST_PRODUCT_TERMINAL_FAILURE_CODES.has(ui.failureCode))) ||
    ui.failureOperation !== uiFailureOperation ||
    ui.failureResourceId !== uiFailureResourceId ||
    ui.shellGenerationId !== uiShellGenerationId ||
    transfer.failureResourceId !== transferFailureResourceId
  ) {
    throw new Error("Installer trust-fault failed-cell terminal projections contradict");
  }
  if (uiFailureResourceId !== null) {
    const terminalFailureResource = manifestResourceById.get(uiFailureResourceId);
    if (
      terminalFailureResource === undefined ||
      terminalFailureResource.target !== "opfs" ||
      uiFailureResourceId !== value.faultResourceId
    ) {
      throw new Error("Installer trust-fault failed-cell failure source authority is invalid");
    }
  }
  if (
    currentStoreResourceId !== null &&
    uiFailureResourceId !== null &&
    currentStoreResourceId !== uiFailureResourceId
  ) {
    throw new Error("Installer trust-fault failed-cell failure source authority is invalid");
  }
  if (!["none", "reload", "repair", "retry"].includes(String(ui.action))) {
    throw new Error("Installer trust-fault failed-cell UI recovery action is invalid");
  }
  if (transfer.state === "failed") {
    if (
      typeof transfer.failureCode !== "string" ||
      typeof transfer.failureClass !== "string" ||
      typeof transfer.failureEvidence !== "string" ||
      typeof transfer.failureOperation !== "string" ||
      !isCanonicalInstallerFailureMessage(transfer.failureMessage)
    ) {
      throw new Error("Installer trust-fault failed-cell transfer tuple is incomplete");
    }
    assertCanonicalInstallerFailureDiagnostic({
      code: transfer.failureCode as InstallerFailureCode,
      failureClass: transfer.failureClass as InstallerFailureClass,
      failureEvidence: transfer.failureEvidence as InstallerFailureEvidence,
      message: transfer.failureMessage,
      operation: transfer.failureOperation as InstallerFailureOperation,
      resourceId: transfer.failureResourceId as string | null,
    });
    const diagnostic = {
      code: transfer.failureCode as InstallerFailureCode,
      failureClass: transfer.failureClass as InstallerFailureClass,
      failureEvidence: transfer.failureEvidence as InstallerFailureEvidence,
      message: transfer.failureMessage,
      operation: transfer.failureOperation as InstallerFailureOperation,
      resourceId: transfer.failureResourceId as string | null,
    };
    if (
      transfer.failureCode !== ui.failureCode ||
      transfer.failureOperation !== ui.failureOperation ||
      transfer.failureResourceId !== ui.failureResourceId ||
      installerFailureRecoveryAction(diagnostic) !== ui.action
    ) {
      throw new Error("Installer trust-fault failed-cell transfer and UI tuples contradict");
    }
  } else if (
    transfer.failureCode !== null ||
    transfer.failureClass !== null ||
    transfer.failureEvidence !== null ||
    transfer.failureMessage !== null ||
    transfer.failureOperation !== null ||
    transfer.failureResourceId !== null
  ) {
    throw new Error("Installer trust-fault failed-cell non-failed transfer retains failure");
  }
  if (terminal.observed === "failed") {
    if (
      ui.failureCode === null ||
      ui.action !==
        installerTrustProductRecoveryAction(
          ui.failureCode as InstallerTrustProductTerminalFailureCode,
        ) ||
      ui.releaseDigest !== null ||
      ui.shellGenerationId !== null ||
      transfer.activeReleaseDigest !== authority.releaseDigest ||
      store.activeReleaseDigest !== null
    ) {
      throw new Error("Installer trust-fault failed-cell failure authority is invalid");
    }
  } else if (
    ui.failureCode !== null ||
    ui.failureOperation !== null ||
    ui.failureResourceId !== null ||
    ui.action !== "none" ||
    ui.releaseDigest !== authority.releaseDigest ||
    ui.shellGenerationId !== `${authority.artifactDigest}:${authority.releaseDigest}` ||
    transfer.activeReleaseDigest !== authority.releaseDigest ||
    store.activeReleaseDigest !== authority.releaseDigest
  ) {
    throw new Error("Installer trust-fault failed-cell Ready projection retains failure");
  } else if (store.state !== "ready" || store.failureMessage !== null) {
    throw new Error("Installer trust-fault failed-cell Ready store projection is invalid");
  }
  const transitions = validateInstallerTrustFaultTransitionProof(
    value.transitions,
    value.id as InstallerTrustFaultCellId,
    authority,
    value.faultResourceId,
    transitionProofSchemaVersion,
    "allow-unexpected-terminal",
  );
  const finalState = transitions.states.find((state) => state.id === transitions.finalStateId);
  if (
    finalState === undefined ||
    finalState.activeReleaseDigest !== store.activeReleaseDigest ||
    finalState.failureCode !== ui.failureCode ||
    finalState.failureResourceId !== ui.failureResourceId ||
    finalState.releaseDigest !== ui.releaseDigest ||
    finalState.shellGenerationId !== ui.shellGenerationId ||
    finalState.storeState !== store.state ||
    finalState.transferState !== transfer.state ||
    finalState.uiState !== ui.state
  ) {
    throw new Error("Installer trust-fault failed-cell proof contradicts its terminal projection");
  }
}

export function validateInstallerTrustFaultFailedCellRunBinding(
  input: unknown,
  completedCellIds: readonly InstallerTrustFaultCellId[],
  failurePhase: unknown,
  productTerminalFailure = false,
): InstallerTrustFaultCellId | null {
  if (
    completedCellIds.length > INSTALLER_TRUST_FAULT_CELL_IDS.length ||
    completedCellIds.some((id, index) => id !== INSTALLER_TRUST_FAULT_CELL_IDS[index])
  ) {
    throw new Error("Installer trust-fault failed-cell prefix is invalid");
  }
  if (
    (failurePhase === "preflight" && completedCellIds.length !== 0) ||
    (failurePhase === "post-validation" &&
      completedCellIds.length !== INSTALLER_TRUST_FAULT_CELL_IDS.length) ||
    (failurePhase !== "cell" && failurePhase !== "post-validation" && failurePhase !== "preflight")
  ) {
    throw new Error("Installer trust-fault failure phase contradicts its completed-cell prefix");
  }
  if (input === null) {
    if (productTerminalFailure) {
      throw new Error("Installer trust-fault product-terminal failure lacks failed-cell evidence");
    }
    return null;
  }
  if (failurePhase !== "cell") {
    throw new Error("Installer trust-fault non-cell failure retains failed-cell evidence");
  }
  if (!productTerminalFailure) {
    throw new Error("Installer trust-fault failed-cell evidence lacks a typed product terminal");
  }
  const expectedCellId = INSTALLER_TRUST_FAULT_CELL_IDS[completedCellIds.length];
  if (expectedCellId === undefined) {
    throw new Error("Installer trust-fault failed-cell evidence follows a complete cell run");
  }
  if (object(input, "failed-cell binding").id !== expectedCellId) {
    throw new Error("Installer trust-fault failed-cell ID is not the exact next cell");
  }
  return expectedCellId;
}

function recordOrNull(input: unknown): Record<string, unknown> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
}

function projectCellValidationHttp(
  input: unknown,
  expectedResource: ReturnType<typeof selectInstallerTrustFaultResource>,
): InstallerTrustFaultCellValidationEvidence["http"] {
  if (!Array.isArray(input) || input.length > 4_096) {
    return Object.freeze({
      operationRangeRequestCount: null,
      selected: null,
      selectedRequestCount: null,
    });
  }
  const operationResponses = input
    .map(recordOrNull)
    .filter(
      (request): request is Record<string, unknown> =>
        request !== null && (request.phase === "attempt-1" || request.phase === "attempt-2"),
    );
  const operationRangeResponses = operationResponses.filter((request) => request.range !== null);
  const selectedRequests = operationRangeResponses.filter(
    (request) => request.path === expectedResource.path,
  );
  const selectedRaw = selectedRequests.length === 1 ? (selectedRequests[0] ?? null) : null;
  return Object.freeze({
    operationRangeRequestCount: operationRangeResponses.length,
    selected:
      selectedRaw === null
        ? null
        : Object.freeze({
            bodyBytes: safeNonnegativeInteger(selectedRaw.bodyBytes),
            etagMatchesManifest:
              typeof selectedRaw.etag === "string"
                ? selectedRaw.etag === `"sha256-${expectedResource.sha256}"`
                : null,
            ifRangeMatchesEtag:
              typeof selectedRaw.ifRange === "string" && typeof selectedRaw.etag === "string"
                ? selectedRaw.ifRange === selectedRaw.etag
                : false,
            ifRangePresent:
              selectedRaw.ifRange === null
                ? false
                : typeof selectedRaw.ifRange === "string"
                  ? true
                  : null,
            manifestPathMatch:
              typeof selectedRaw.path === "string"
                ? selectedRaw.path === expectedResource.path
                : null,
            pathSha256: safeHttpPathSha256(selectedRaw.path),
            rangeClassification: projectRangeClassification(selectedRaw.range),
            responseKind: projectHttpResponseKind(selectedRaw),
            sameOriginPath: safeSameOriginHttpPath(selectedRaw.path),
            status: safeNonnegativeInteger(selectedRaw.status),
          }),
    selectedRequestCount: selectedRequests.length,
  });
}

function projectHttpResponseKind(request: Record<string, unknown>): "full" | "other" | "range" {
  if (request.range === null && (request.status === 200 || request.status === 304)) return "full";
  if (
    typeof request.range === "string" &&
    (request.status === 206 || request.status === 416 || request.status === 499)
  ) {
    return "range";
  }
  return "other";
}

function projectRangeClassification(
  input: unknown,
): "absent" | "exact-zero-offset" | "other" | null {
  if (input === null) return "absent";
  if (typeof input !== "string" || input.length > 64 || /[\r\n\0]/u.test(input)) return null;
  return input === "bytes=0-" ? "exact-zero-offset" : "other";
}

function safeSameOriginHttpPath(input: unknown): boolean | null {
  if (typeof input !== "string" || input.length > 501 || /[\r\n\0]/u.test(input)) return null;
  return /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,500}$/u.test(input);
}

function safeHttpPathSha256(input: unknown): string | null {
  return safeSameOriginHttpPath(input) === true
    ? createHash("sha256")
        .update(input as string)
        .digest("hex")
    : null;
}

function projectAccountingSnapshot(
  input: Record<string, unknown> | null,
): InstallerTrustFaultCellValidationAccountingSnapshot {
  return Object.freeze({
    completedResourceCount: safeNonnegativeInteger(input?.completedResourceCount),
    downloadedBytes: safeNonnegativeInteger(input?.downloadedBytes),
    repairedBytes: safeNonnegativeInteger(input?.operationRepairedBytes),
    repairedResourceCount: safeNonnegativeInteger(input?.operationRepairedResourceCount),
  });
}

function projectAccountingDelta(
  baseline: InstallerTrustFaultCellValidationAccountingSnapshot,
  terminal: InstallerTrustFaultCellValidationAccountingSnapshot,
): InstallerTrustFaultCellValidationAccountingSnapshot {
  const delta = (before: number | null, after: number | null): number | null =>
    before !== null && after !== null && after >= before ? after - before : null;
  return Object.freeze({
    completedResourceCount: delta(baseline.completedResourceCount, terminal.completedResourceCount),
    downloadedBytes: delta(baseline.downloadedBytes, terminal.downloadedBytes),
    repairedBytes: delta(baseline.repairedBytes, terminal.repairedBytes),
    repairedResourceCount: delta(baseline.repairedResourceCount, terminal.repairedResourceCount),
  });
}

function arrayOrEmpty(input: unknown): readonly unknown[] {
  return Array.isArray(input) && input.length <= 512 ? input : Object.freeze([]);
}

function safeDigest(input: unknown): string | null {
  return typeof input === "string" && /^[a-f0-9]{64}$/u.test(input) ? input : null;
}

function safeBoolean(input: unknown): boolean | null {
  return typeof input === "boolean" ? input : null;
}

function safeNonnegativeInteger(input: unknown): number | null {
  return Number.isSafeInteger(input) && (input as number) >= 0 ? (input as number) : null;
}

function safePositiveInteger(input: unknown): number | null {
  const value = safeNonnegativeInteger(input);
  return value !== null && value > 0 ? value : null;
}

function safeAttempt(input: unknown): 1 | 2 | null {
  return input === 1 || input === 2 ? input : null;
}

function safeCellId(input: unknown): InstallerTrustFaultCellId | null {
  return typeof input === "string" &&
    (INSTALLER_TRUST_FAULT_CELL_IDS as readonly string[]).includes(input)
    ? (input as InstallerTrustFaultCellId)
    : null;
}

function safeOperation(input: unknown): "install" | "repair" | null {
  return input === "install" || input === "repair" ? input : null;
}

function safeOutcome(input: unknown): "failed" | "passed" | null {
  return input === "failed" || input === "passed" ? input : null;
}

function safePhase(input: unknown): "attempt-1" | "attempt-2" | null {
  return input === "attempt-1" || input === "attempt-2" ? input : null;
}

function safeEnum(input: unknown, allowed: ReadonlySet<string>): string | null {
  return typeof input === "string" && allowed.has(input) ? input : null;
}

function safeManifestResourceId(
  input: unknown,
  authority: InstallerTrustFaultAuthority,
): string | null {
  if (
    typeof input !== "string" ||
    input.length < 1 ||
    input.length > 128 ||
    !/^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u.test(input)
  ) {
    return null;
  }
  return parseInstallerTrustFaultManifestResources(authority).some(
    (resource) => resource.id === input,
  )
    ? input
    : null;
}

function safeShellGeneration(
  input: unknown,
  authority: InstallerTrustFaultAuthority,
): string | null {
  const expected = `${authority.artifactDigest}:${authority.releaseDigest}`;
  return input === expected ? expected : null;
}

function safeFailureCode(input: unknown): string | null {
  return typeof input === "string" && INSTALLER_TRUST_PRODUCT_TERMINAL_FAILURE_CODES.has(input)
    ? input
    : null;
}

function safeFailureMessageSha256(input: unknown): string | null {
  if (typeof input !== "string" || input.length < 1 || input.length > 4_096) return null;
  return createHash("sha256").update(input).digest("hex");
}

function nullableNonnegativeInteger(input: unknown): boolean {
  return input === null || (Number.isSafeInteger(input) && (input as number) >= 0);
}

function validatedNullableNonnegativeIntegerValue(
  input: unknown,
  maximum: number,
  label: string,
): number | null {
  if (input === null) return null;
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 0 || input > maximum) {
    throw new Error(`Installer trust-fault ${label} is invalid`);
  }
  return input;
}

function nullablePositiveInteger(input: unknown): boolean {
  return input === null || (Number.isSafeInteger(input) && (input as number) > 0);
}

function nullableSha256(input: unknown): boolean {
  return input === null || (typeof input === "string" && /^[a-f0-9]{64}$/u.test(input));
}

function nullableDigest(input: unknown): boolean {
  return input === null || (typeof input === "string" && /^[a-f0-9]{64}$/u.test(input));
}

function validatedNullableBoundedString(
  input: unknown,
  maximum: number,
  label: string,
): string | null {
  if (input === null) return null;
  if (typeof input !== "string" || input.length === 0 || input.length > maximum) {
    throw new Error(`Installer trust-fault failed-cell ${label} is invalid`);
  }
  return input;
}

function nullableCanonicalFailureMessage(input: unknown): boolean {
  return input === null || isCanonicalInstallerFailureMessage(input);
}

function installerTrustProductRecoveryAction(
  code: InstallerTrustProductTerminalFailureCode,
): "reload" | "repair" | "retry" | null {
  switch (code) {
    case null:
      return null;
    case "cancel-target-invalid":
    case "cancelled":
    case "concurrent-install":
    case "disposed":
    case "install-manifest-invalid":
    case "integrity":
    case "protocol":
    case "quota":
    case "repair-target-mismatch":
    case "shell-incompatible":
    case "store":
    case "transport":
    case "unknown":
    case "validator": {
      const recoveries = new Set(
        INSTALLER_FAILURE_RULES.filter((rule) => rule.code === code).map(
          (rule) => rule.recoveryAction,
        ),
      );
      if (recoveries.size !== 1) {
        throw new Error("Installer failure registry has contradictory recovery actions");
      }
      return recoveries.values().next().value ?? null;
    }
    case "launch":
    case "shell-contract":
    case "shell-release-mismatch":
      return "reload";
    case "persistence":
    case "shell-unavailable":
      return "retry";
  }
}

function object(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`Installer trust-fault ${label} must be an object`);
  }
  return input as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    keys.length !== sortedExpected.length ||
    keys.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error("Installer trust-fault run evidence has unknown, missing, or extra keys");
  }
}

function timestamp(input: unknown, label: string): void {
  if (typeof input !== "string" || !Number.isFinite(Date.parse(input))) {
    throw new Error(`Installer trust-fault ${label} timestamp is invalid`);
  }
}

function boundedFailureString(input: unknown, maximum: number): input is string {
  return (
    typeof input === "string" &&
    input.length > 0 &&
    input.length <= maximum &&
    Array.from(input).every((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    }) &&
    !containsSensitiveFailureText(input)
  );
}
