import { createHash, type Hash } from "node:crypto";
import {
  assertCanonicalInstallerFailureDiagnostic,
  type InstallerFailureClass,
  type InstallerFailureEvidence,
  type InstallerFailureOperation,
  type InstallerSnapshot,
  parseInstallerSnapshot,
} from "@parallax/engine";
import type {
  InstallerTrustFaultAuthority,
  InstallerTrustFaultCellId,
} from "./installer-trust-faults-result.js";
import {
  INSTALLER_TRUST_FAULT_BOUND_AUTHORITY_VALUES,
  INSTALLER_TRUST_FAULT_BOUND_FAILURE_RESOURCE_VALUES,
  INSTALLER_TRUST_FAULT_MAX_ATTEMPT_MILESTONES,
  INSTALLER_TRUST_FAULT_OPTIONAL_FAILURE_CODES,
  INSTALLER_TRUST_FAULT_PHASES,
  INSTALLER_TRUST_FAULT_STORE_STATES,
  INSTALLER_TRUST_FAULT_TRANSFER_STATES,
  INSTALLER_TRUST_FAULT_UI_STATES,
  type InstallerTrustFaultStoreState,
  type InstallerTrustFaultTransferState,
  type InstallerTrustFaultTransition,
  validateInstallerTrustFaultTransitionObservation,
} from "./installer-trust-faults-transitions.js";

export const INSTALLER_TRUST_FAULT_TRANSITION_PROOF_CONTRACT =
  "installer-trust-fault-transition-proof@1";
export const INSTALLER_TRUST_FAULT_TRANSITION_PROOF_LEGACY_SCHEMA_VERSION = 1;
export const INSTALLER_TRUST_FAULT_TRANSITION_PROOF_PREVIOUS_SCHEMA_VERSION = 2;
export const INSTALLER_TRUST_FAULT_TRANSITION_PROOF_SCHEMA_VERSION = 3;
export const INSTALLER_TRUST_FAULT_RAW_OBSERVATION_CONTRACT =
  "installer-trust-fault-raw-observations@1";
export const INSTALLER_TRUST_FAULT_RAW_OBSERVATION_LEGACY_SCHEMA_VERSION = 2;
export const INSTALLER_TRUST_FAULT_RAW_OBSERVATION_SCHEMA_VERSION = 3;
export const INSTALLER_TRUST_FAULT_MAX_RAW_OBSERVATIONS = 16_384;
export const INSTALLER_TRUST_FAULT_MAX_RAW_ARTIFACT_BYTES = 512 * 1024;
export const INSTALLER_TRUST_FAULT_MAX_SERIALIZED_RAW_OBSERVATION_BYTES = 68 * 1024;
export const INSTALLER_TRUST_FAULT_MAX_REJECTED_RAW_SAMPLE_BYTES = 72 * 1024;
const INSTALLER_TRUST_FAULT_MAX_RAW_TELEMETRY_BYTES = 64 * 1024;
const INSTALLER_TRUST_FAULT_RAW_EVIDENCE_FIXED_BYTES = Buffer.byteLength(
  '{"accepted":,"rejected":}',
  "utf8",
);
export const INSTALLER_TRUST_FAULT_MAX_ACCEPTED_RAW_BYTES =
  INSTALLER_TRUST_FAULT_MAX_RAW_ARTIFACT_BYTES -
  INSTALLER_TRUST_FAULT_MAX_REJECTED_RAW_SAMPLE_BYTES -
  INSTALLER_TRUST_FAULT_RAW_EVIDENCE_FIXED_BYTES;
const INSTALLER_TRUST_FAULT_RAW_V3_FIXED_BYTES = Buffer.byteLength(
  '{"acceptedObservationPrefix":,"acceptedObservationTail":,"rejectedSample":}',
  "utf8",
);
const INSTALLER_TRUST_FAULT_MAX_RETAINED_RAW_BYTES =
  INSTALLER_TRUST_FAULT_MAX_RAW_ARTIFACT_BYTES -
  INSTALLER_TRUST_FAULT_MAX_REJECTED_RAW_SAMPLE_BYTES -
  INSTALLER_TRUST_FAULT_RAW_V3_FIXED_BYTES;
const INSTALLER_TRUST_FAULT_MAX_RETAINED_RAW_PREFIX_BYTES = Math.floor(
  INSTALLER_TRUST_FAULT_MAX_RETAINED_RAW_BYTES / 2,
);
const INSTALLER_TRUST_FAULT_MAX_RETAINED_RAW_TAIL_BYTES =
  INSTALLER_TRUST_FAULT_MAX_RETAINED_RAW_BYTES -
  INSTALLER_TRUST_FAULT_MAX_RETAINED_RAW_PREFIX_BYTES;
const INSTALLER_TRUST_FAULT_MAX_RAW_TEXT = 512;
export const INSTALLER_TRUST_FAULT_RAW_FAILURE_PREDICATES = Object.freeze([
  "cell-invariant",
  "observation-bound",
  "observation-order",
  "observation-parse",
  "observation-consistency",
] as const);

export type InstallerTrustFaultRawFailurePredicate =
  (typeof INSTALLER_TRUST_FAULT_RAW_FAILURE_PREDICATES)[number];

export type InstallerTrustFaultPersistenceObservation =
  | "denied"
  | "failed"
  | "granted"
  | "not-requested"
  | "requesting";

export interface InstallerTrustFaultRawObservation {
  readonly degradedDurabilityWarning: boolean;
  readonly persistence: InstallerTrustFaultPersistenceObservation;
  readonly telemetry:
    | InstallerSnapshot
    | InstallerTrustFaultRawTelemetry
    | InstallerTrustFaultLegacyRawTelemetry;
  readonly transition: InstallerTrustFaultTransition;
}

interface InstallerTrustFaultLegacyRawTelemetry {
  readonly installStore: Readonly<{
    readonly activeReleaseDigest: string | null;
    readonly state: InstallerTrustFaultStoreState;
  }>;
  readonly installerTransfer: Readonly<{
    readonly failureCode: InstallerTrustFaultTransition["failureCode"];
    readonly failureResourceId: string | null;
    readonly state: InstallerTrustFaultTransferState;
  }>;
}

export interface InstallerTrustFaultRawTelemetry {
  readonly installStore: Readonly<{
    readonly activeReleaseDigest: string | null;
    readonly state: InstallerTrustFaultStoreState;
  }>;
  readonly installerTransfer: Readonly<{
    readonly activeReleaseDigest: string | null;
    readonly failureCode: InstallerTrustFaultTransition["failureCode"];
    readonly failureClass: InstallerFailureClass | null;
    readonly failureEvidence: InstallerFailureEvidence | null;
    readonly failureExpectedReleaseDigest: string | null;
    readonly failureMessage: string | null;
    readonly failureOperation: InstallerFailureOperation | null;
    readonly failureResourceId: string | null;
    readonly failureSource: "operation" | "session" | null;
    readonly state: InstallerTrustFaultTransferState;
  }>;
}

export interface InstallerTrustFaultRawObservationEvidenceV2 {
  readonly acceptedObservationCount: number;
  readonly acceptedObservations: readonly InstallerTrustFaultRawObservation[];
  readonly authority: InstallerTrustFaultAuthority;
  readonly cellId: InstallerTrustFaultCellId;
  readonly contract: typeof INSTALLER_TRUST_FAULT_RAW_OBSERVATION_CONTRACT;
  readonly failedPredicate: InstallerTrustFaultRawFailurePredicate;
  readonly faultResourceId: string;
  readonly phase: InstallerTrustFaultTransition["phase"] | null;
  readonly rawArtifactBytes: number;
  readonly rejectedSample: InstallerTrustFaultRejectedRawObservationSample;
  readonly schemaVersion: typeof INSTALLER_TRUST_FAULT_RAW_OBSERVATION_LEGACY_SCHEMA_VERSION;
  readonly sha256: string;
}

export interface InstallerTrustFaultRawObservationEvidenceV3 {
  readonly acceptedObservationCount: number;
  readonly acceptedObservationPrefix: readonly InstallerTrustFaultRawObservation[];
  readonly acceptedObservationTail: readonly InstallerTrustFaultRawObservation[];
  readonly authority: InstallerTrustFaultAuthority;
  readonly cellId: InstallerTrustFaultCellId;
  readonly contract: typeof INSTALLER_TRUST_FAULT_RAW_OBSERVATION_CONTRACT;
  readonly failedPredicate: InstallerTrustFaultRawFailurePredicate;
  readonly faultResourceId: string;
  readonly phase: InstallerTrustFaultTransition["phase"] | null;
  readonly rawArtifactBytes: number;
  readonly rejectedSample: InstallerTrustFaultRejectedRawObservationSample;
  readonly retainedSha256: string;
  readonly schemaVersion: typeof INSTALLER_TRUST_FAULT_RAW_OBSERVATION_SCHEMA_VERSION;
  readonly sha256: string;
}

export type InstallerTrustFaultRawObservationEvidence =
  | InstallerTrustFaultRawObservationEvidenceV2
  | InstallerTrustFaultRawObservationEvidenceV3;

export interface InstallerTrustFaultRejectedRawObservationSample {
  readonly detail: string;
  readonly digestSha256: string;
  readonly observation: InstallerTrustFaultRawObservation | null;
  readonly projection: Readonly<{
    readonly keys: readonly string[];
    readonly kind: "array" | "null" | "object" | "primitive" | "unreadable";
  }>;
  readonly sourceDigestSha256: string;
}

const TRUSTED_RAW_OBSERVATION_DIAGNOSTICS = new WeakMap<
  Error,
  InstallerTrustFaultRawObservationEvidence
>();

export function findTrustedInstallerTrustFaultRawObservationEvidence(
  input: unknown,
): InstallerTrustFaultRawObservationEvidence | null {
  const found: InstallerTrustFaultRawObservationEvidence[] = [];
  const seen = new WeakSet<object>();
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > 8 || typeof candidate !== "object" || candidate === null || seen.has(candidate)) {
      return;
    }
    seen.add(candidate);
    if (candidate instanceof Error) {
      const diagnostic = TRUSTED_RAW_OBSERVATION_DIAGNOSTICS.get(candidate);
      if (diagnostic !== undefined) found.push(diagnostic);
      if (candidate instanceof AggregateError) {
        for (const member of candidate.errors.slice(0, 8)) visit(member, depth + 1);
      }
      if ("cause" in candidate) visit(candidate.cause, depth + 1);
    }
  };
  visit(input, 0);
  if (found.length === 0) return null;
  const canonical = JSON.stringify(found[0]);
  if (found.some((candidate) => JSON.stringify(candidate) !== canonical)) {
    throw new Error("Installer trust-fault failure graph has contradictory raw observations");
  }
  return found[0] ?? null;
}

export function validateInstallerTrustFaultRawObservationEvidence(
  input: unknown,
): InstallerTrustFaultRawObservationEvidence {
  const evidence = record(input, "raw observation evidence");
  if (evidence.schemaVersion === INSTALLER_TRUST_FAULT_RAW_OBSERVATION_LEGACY_SCHEMA_VERSION) {
    return validateInstallerTrustFaultRawObservationEvidenceV2(evidence);
  }
  if (evidence.schemaVersion === INSTALLER_TRUST_FAULT_RAW_OBSERVATION_SCHEMA_VERSION) {
    return validateInstallerTrustFaultRawObservationEvidenceV3(evidence);
  }
  throw new Error("Installer trust-fault raw observation evidence schema is invalid");
}

export function validateRetainedInstallerTrustFaultAsynchronousHandoffRawObservationEvidence(
  input: unknown,
): InstallerTrustFaultRawObservationEvidenceV3 {
  if (
    createHash("sha256").update(JSON.stringify(input)).digest("hex") !==
    "40674082cde969c8c6a383d080676cf8b09da39e503409c8701cb62a75e08e7f"
  ) {
    throw new Error("Installer trust-fault retained raw observation identity is invalid");
  }
  return validateInstallerTrustFaultRawObservationEvidenceV3(input, "retained-pre-target-binding");
}

function validateInstallerTrustFaultRawObservationEvidenceV2(
  input: unknown,
): InstallerTrustFaultRawObservationEvidenceV2 {
  const evidence = record(input, "raw observation evidence");
  exact(evidence, [
    "acceptedObservationCount",
    "acceptedObservations",
    "authority",
    "cellId",
    "contract",
    "failedPredicate",
    "faultResourceId",
    "phase",
    "rawArtifactBytes",
    "rejectedSample",
    "schemaVersion",
    "sha256",
  ]);
  const authority = parseRawAuthority(evidence.authority);
  if (
    evidence.contract !== INSTALLER_TRUST_FAULT_RAW_OBSERVATION_CONTRACT ||
    evidence.schemaVersion !== INSTALLER_TRUST_FAULT_RAW_OBSERVATION_LEGACY_SCHEMA_VERSION ||
    typeof evidence.cellId !== "string" ||
    ![
      "estimate-clearly-insufficient",
      "estimate-incomplete-probe-success",
      "final-verification-corruption",
      "mid-append-quota-resume",
      "persistence-denied",
      "quota-probe-exceeded",
      "repeated-server-corruption",
      "reused-object-corruption",
    ].includes(evidence.cellId) ||
    typeof evidence.failedPredicate !== "string" ||
    !(INSTALLER_TRUST_FAULT_RAW_FAILURE_PREDICATES as readonly string[]).includes(
      evidence.failedPredicate,
    ) ||
    typeof evidence.faultResourceId !== "string" ||
    evidence.faultResourceId.length < 1 ||
    evidence.faultResourceId.length > 256 ||
    !Array.isArray(evidence.acceptedObservations) ||
    evidence.acceptedObservations.length > INSTALLER_TRUST_FAULT_MAX_RAW_OBSERVATIONS ||
    evidence.acceptedObservationCount !== evidence.acceptedObservations.length ||
    (evidence.phase !== null &&
      (typeof evidence.phase !== "string" ||
        !(INSTALLER_TRUST_FAULT_PHASES as readonly string[]).includes(evidence.phase)))
  ) {
    throw new Error("Installer trust-fault raw observation evidence is invalid");
  }
  let previousAccepted: InstallerTrustFaultTransition | null = null;
  const observations = Object.freeze(
    evidence.acceptedObservations.map((observation, index) => {
      const parsed = parseRawObservation(observation, index + 1, true);
      if (parsed === null) {
        throw new Error("Installer trust-fault raw observation envelope is absent");
      }
      validateRawTelemetrySafety(
        parsed.telemetry,
        parsed.transition,
        evidence.cellId as InstallerTrustFaultCellId,
        authority,
        evidence.faultResourceId as string,
      );
      validateRawObservationConsistency(parsed);
      validateHistoricalRawOnlineStructure(
        parsed.transition,
        previousAccepted,
        evidence.cellId as InstallerTrustFaultCellId,
        authority,
        evidence.faultResourceId as string,
      );
      previousAccepted = parsed.transition;
      return parsed;
    }),
  );
  const rejected = parseRejectedSample(evidence.rejectedSample);
  const expectedPredicate = deriveRejectedPredicate(
    rejected,
    observations,
    evidence.cellId as InstallerTrustFaultCellId,
    authority,
    evidence.faultResourceId as string,
  );
  const rawArtifactBytes = rawEvidenceBytes(observations, rejected);
  if (
    evidence.phase !== (observations.at(-1)?.transition.phase ?? null) ||
    evidence.failedPredicate !== expectedPredicate ||
    evidence.rawArtifactBytes !== rawArtifactBytes ||
    serializedAcceptedRawBytes(observations) > INSTALLER_TRUST_FAULT_MAX_ACCEPTED_RAW_BYTES ||
    Buffer.byteLength(JSON.stringify(rejected), "utf8") >
      INSTALLER_TRUST_FAULT_MAX_REJECTED_RAW_SAMPLE_BYTES ||
    rawArtifactBytes > INSTALLER_TRUST_FAULT_MAX_RAW_ARTIFACT_BYTES ||
    typeof evidence.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(evidence.sha256) ||
    evidence.sha256 !== createHash("sha256").update(JSON.stringify(observations)).digest("hex")
  ) {
    throw new Error("Installer trust-fault raw observation binding is invalid");
  }
  return evidence as unknown as InstallerTrustFaultRawObservationEvidenceV2;
}

function validateInstallerTrustFaultRawObservationEvidenceV3(
  input: unknown,
  targetSemantics: PriorAttemptTransferTargetSemantics = "current-exact-target",
): InstallerTrustFaultRawObservationEvidenceV3 {
  const evidence = record(input, "raw observation evidence");
  exact(evidence, [
    "acceptedObservationCount",
    "acceptedObservationPrefix",
    "acceptedObservationTail",
    "authority",
    "cellId",
    "contract",
    "failedPredicate",
    "faultResourceId",
    "phase",
    "rawArtifactBytes",
    "rejectedSample",
    "retainedSha256",
    "schemaVersion",
    "sha256",
  ]);
  const authority = parseRawAuthority(evidence.authority);
  const acceptedObservationCount = evidence.acceptedObservationCount;
  if (
    !Number.isSafeInteger(acceptedObservationCount) ||
    (acceptedObservationCount as number) < 0 ||
    (acceptedObservationCount as number) > INSTALLER_TRUST_FAULT_MAX_RAW_OBSERVATIONS
  ) {
    throw new Error("Installer trust-fault raw observation count is invalid");
  }
  const acceptedCount = acceptedObservationCount as number;
  if (
    evidence.contract !== INSTALLER_TRUST_FAULT_RAW_OBSERVATION_CONTRACT ||
    evidence.schemaVersion !== INSTALLER_TRUST_FAULT_RAW_OBSERVATION_SCHEMA_VERSION ||
    typeof evidence.cellId !== "string" ||
    ![
      "estimate-clearly-insufficient",
      "estimate-incomplete-probe-success",
      "final-verification-corruption",
      "mid-append-quota-resume",
      "persistence-denied",
      "quota-probe-exceeded",
      "repeated-server-corruption",
      "reused-object-corruption",
    ].includes(evidence.cellId) ||
    typeof evidence.failedPredicate !== "string" ||
    !(INSTALLER_TRUST_FAULT_RAW_FAILURE_PREDICATES as readonly string[]).includes(
      evidence.failedPredicate,
    ) ||
    typeof evidence.faultResourceId !== "string" ||
    evidence.faultResourceId.length < 1 ||
    evidence.faultResourceId.length > 256 ||
    !Array.isArray(evidence.acceptedObservationPrefix) ||
    !Array.isArray(evidence.acceptedObservationTail) ||
    (acceptedCount > 0 && evidence.acceptedObservationPrefix.length === 0) ||
    (acceptedCount > evidence.acceptedObservationPrefix.length &&
      evidence.acceptedObservationTail.length === 0) ||
    evidence.acceptedObservationPrefix.length + evidence.acceptedObservationTail.length >
      acceptedCount ||
    (evidence.phase !== null &&
      (typeof evidence.phase !== "string" ||
        !(INSTALLER_TRUST_FAULT_PHASES as readonly string[]).includes(evidence.phase))) ||
    typeof evidence.sha256 !== "string" ||
    !SHA256.test(evidence.sha256) ||
    typeof evidence.retainedSha256 !== "string" ||
    !SHA256.test(evidence.retainedSha256)
  ) {
    throw new Error("Installer trust-fault raw observation evidence is invalid");
  }
  const prefix = parseRetainedRawObservationSequence(
    evidence.acceptedObservationPrefix,
    1,
    true,
    evidence.cellId as InstallerTrustFaultCellId,
    authority,
    evidence.faultResourceId,
    targetSemantics,
  );
  const tailStart = acceptedCount - evidence.acceptedObservationTail.length + 1;
  const tail = parseRetainedRawObservationSequence(
    evidence.acceptedObservationTail,
    tailStart,
    false,
    evidence.cellId as InstallerTrustFaultCellId,
    authority,
    evidence.faultResourceId,
    targetSemantics,
  );
  if (
    serializedAcceptedRawBytes(prefix) > INSTALLER_TRUST_FAULT_MAX_RETAINED_RAW_PREFIX_BYTES ||
    serializedAcceptedRawBytes(tail) > INSTALLER_TRUST_FAULT_MAX_RETAINED_RAW_TAIL_BYTES ||
    (tail.length > 0 && tailStart <= prefix.length)
  ) {
    throw new Error("Installer trust-fault retained raw observation windows are invalid");
  }
  const previous = tail.at(-1) ?? prefix.at(-1) ?? null;
  const rejected = parseRejectedSample(evidence.rejectedSample);
  const expectedPredicate = deriveRejectedPredicateV3(
    rejected,
    acceptedCount,
    previous,
    evidence.cellId as InstallerTrustFaultCellId,
    authority,
    evidence.faultResourceId,
    targetSemantics,
  );
  const rawArtifactBytes = rawEvidenceBytesV3(prefix, tail, rejected);
  const retainedSha256 = digestRetainedRawObservations(prefix, tail);
  if (
    evidence.phase !== (previous?.transition.phase ?? null) ||
    evidence.failedPredicate !== expectedPredicate ||
    evidence.rawArtifactBytes !== rawArtifactBytes ||
    rawArtifactBytes > INSTALLER_TRUST_FAULT_MAX_RAW_ARTIFACT_BYTES ||
    Buffer.byteLength(JSON.stringify(rejected), "utf8") >
      INSTALLER_TRUST_FAULT_MAX_REJECTED_RAW_SAMPLE_BYTES ||
    evidence.retainedSha256 !== retainedSha256
  ) {
    throw new Error("Installer trust-fault raw observation binding is invalid");
  }
  if (prefix.length + tail.length === acceptedCount) {
    const complete = [...prefix, ...tail];
    if (evidence.sha256 !== digestRawObservationStream(complete)) {
      throw new Error("Installer trust-fault complete raw observation stream hash is invalid");
    }
  }
  return evidence as unknown as InstallerTrustFaultRawObservationEvidenceV3;
}

function parseRetainedRawObservationSequence(
  input: readonly unknown[],
  firstOrder: number,
  requireInitialObservation: boolean,
  id: InstallerTrustFaultCellId,
  authority: InstallerTrustFaultAuthority,
  faultResourceId: string,
  targetSemantics: PriorAttemptTransferTargetSemantics,
): readonly InstallerTrustFaultRawObservation[] {
  let previous: InstallerTrustFaultTransition | null = null;
  return Object.freeze(
    input.map((observation, index) => {
      const parsed = parseRawObservation(observation, firstOrder + index, true);
      if (parsed === null)
        throw new Error("Installer trust-fault raw observation envelope is absent");
      if (previous !== null || requireInitialObservation) {
        validateRawDiagnosticStructure(parsed.transition, previous, id, authority, faultResourceId);
      } else {
        validateAuthorityDimensions(parsed.transition, authority, faultResourceId);
        if (!expectedCellPhases(id).includes(parsed.transition.phase)) {
          throw new Error("Installer trust-fault retained tail has a forbidden phase");
        }
        if (
          (parsed.transition.releaseDigest === null) !==
            (parsed.transition.shellGenerationId === null) ||
          (parsed.transition.releaseDigest !== null &&
            parsed.transition.uiState !== "ready" &&
            expectedOperationUiState(id, parsed.transition.phase) !== "repairing")
        ) {
          throw new Error("Installer trust-fault retained tail has forbidden shell authority");
        }
      }
      validateRawTelemetrySafety(
        parsed.telemetry,
        parsed.transition,
        id,
        authority,
        faultResourceId,
        targetSemantics,
      );
      previous = parsed.transition;
      return parsed;
    }),
  );
}
export const INSTALLER_TRUST_FAULT_ESTIMATE_FINALIZATION_FAILED_PREDICATES = Object.freeze([
  "attempt-milestones",
  "initial-state",
  "final-state",
  "state-set",
  "phase-ingress",
  "initial-persistence-edge",
  "persistence-installing-edge",
  "waiting-lock-edge",
  "planning-edge",
  "terminal-external-ingress",
  "terminal-self-edge",
  "terminal-external-outgoing",
  "unexpected-edge",
] as const);

export type InstallerTrustFaultEstimateFinalizationFailedPredicate =
  (typeof INSTALLER_TRUST_FAULT_ESTIMATE_FINALIZATION_FAILED_PREDICATES)[number];

export interface InstallerTrustFaultEstimateFinalizationRelationalState {
  readonly active: boolean;
  readonly failure: string | null;
  readonly order: number;
  readonly phase: InstallerTrustFaultTransition["phase"];
  readonly release: boolean;
  readonly resource: boolean;
  readonly shell: boolean;
  readonly store: InstallerTrustFaultStoreState;
  readonly transfer: InstallerTrustFaultTransition["transferState"];
  readonly ui: InstallerTrustFaultTransition["uiState"];
}

export interface InstallerTrustFaultEstimateFinalizationDiagnostic {
  readonly cellId: "estimate-clearly-insufficient";
  readonly failedPredicate: InstallerTrustFaultEstimateFinalizationFailedPredicate;
  readonly finalRelationalState: InstallerTrustFaultEstimateFinalizationRelationalState;
  readonly initialRelationalState: InstallerTrustFaultEstimateFinalizationRelationalState;
  readonly phase: "attempt-1";
  readonly projectedMilestones: readonly string[];
  readonly proofPrefix: Readonly<{
    readonly observationCount: number;
    readonly sha256: string;
  }>;
  readonly terminalIncidence: Readonly<{
    readonly externalIngress: Readonly<{
      readonly edgeCount: number;
      readonly observationCount: number;
    }>;
    readonly externalOutgoing: Readonly<{
      readonly edgeCount: number;
      readonly observationCount: number;
    }>;
    readonly self: Readonly<{ readonly edgeCount: number; readonly observationCount: number }>;
  }>;
}

export const INSTALLER_TRUST_FAULT_MAX_PROOF_PHASES = INSTALLER_TRUST_FAULT_PHASES.length;

export const INSTALLER_TRUST_FAULT_MAX_PROOF_STATES =
  INSTALLER_TRUST_FAULT_PHASES.length *
  INSTALLER_TRUST_FAULT_BOUND_AUTHORITY_VALUES.length *
  INSTALLER_TRUST_FAULT_OPTIONAL_FAILURE_CODES.length *
  INSTALLER_TRUST_FAULT_BOUND_FAILURE_RESOURCE_VALUES.length *
  INSTALLER_TRUST_FAULT_BOUND_AUTHORITY_VALUES.length *
  INSTALLER_TRUST_FAULT_BOUND_AUTHORITY_VALUES.length *
  INSTALLER_TRUST_FAULT_STORE_STATES.length *
  INSTALLER_TRUST_FAULT_TRANSFER_STATES.length *
  INSTALLER_TRUST_FAULT_UI_STATES.length;
export const INSTALLER_TRUST_FAULT_MAX_PROOF_EDGES =
  INSTALLER_TRUST_FAULT_MAX_PROOF_STATES * INSTALLER_TRUST_FAULT_MAX_PROOF_STATES;
export const INSTALLER_TRUST_FAULT_MAX_PROOF_BOUNDARIES =
  BigInt(INSTALLER_TRUST_FAULT_MAX_PROOF_EDGES) * 2n;
export const INSTALLER_TRUST_FAULT_MAX_PROOF_GAPS = INSTALLER_TRUST_FAULT_MAX_PROOF_BOUNDARIES - 1n;
export const INSTALLER_TRUST_FAULT_MAX_PROOF_GAP_EDGE_COUNTS =
  BigInt(INSTALLER_TRUST_FAULT_MAX_PROOF_EDGES) * INSTALLER_TRUST_FAULT_MAX_PROOF_GAPS;

const SHA256 = /^[a-f0-9]{64}$/u;
type PriorAttemptTransferTargetSemantics = "current-exact-target" | "retained-pre-target-binding";
const DIMENSIONS = [
  "activeReleaseDigest",
  "failureCode",
  "failureResourceId",
  "phase",
  "releaseDigest",
  "shellGenerationId",
  "storeState",
  "transferState",
  "uiState",
] as const;
type Dimension = (typeof DIMENSIONS)[number];
type TransitionState = Omit<InstallerTrustFaultTransition, "order">;
export type InstallerTrustFaultProofVerdictMode = "allow-unexpected-terminal" | "expected";

export interface InstallerTrustFaultProofState extends TransitionState {
  readonly firstOrder: number;
  readonly id: number;
}

export interface InstallerTrustFaultProofEdge {
  readonly count: number;
  readonly firstOrder: number;
  readonly fromStateId: number;
  readonly id: number;
  readonly lastOrder: number;
  readonly toStateId: number;
}

export interface InstallerTrustFaultProofPhase {
  readonly attemptMilestones: readonly string[];
  readonly finalStateId: number;
  readonly firstOrder: number;
  readonly initialStateId: number;
  readonly lastOrder: number;
  readonly observedCount: number;
  readonly phase: InstallerTrustFaultTransition["phase"];
}

interface InstallerTrustFaultTransitionProofBase {
  readonly contract: typeof INSTALLER_TRUST_FAULT_TRANSITION_PROOF_CONTRACT;
  readonly dimensionChangeCounts: Readonly<Record<Dimension, number>>;
  readonly edges: readonly InstallerTrustFaultProofEdge[];
  readonly finalStateId: number;
  readonly firstOrder: number;
  readonly initialStateId: number;
  readonly lastOrder: number;
  readonly phases: readonly InstallerTrustFaultProofPhase[];
  readonly rawObservationCount: number;
  readonly states: readonly InstallerTrustFaultProofState[];
  readonly streamSha256: string;
}

export interface InstallerTrustFaultTransitionProofV1
  extends InstallerTrustFaultTransitionProofBase {
  readonly schemaVersion: typeof INSTALLER_TRUST_FAULT_TRANSITION_PROOF_LEGACY_SCHEMA_VERSION;
}

export interface InstallerTrustFaultTransitionProofV2
  extends InstallerTrustFaultTransitionProofBase {
  readonly gaps: readonly InstallerTrustFaultProofGap[];
  readonly schemaVersion: typeof INSTALLER_TRUST_FAULT_TRANSITION_PROOF_PREVIOUS_SCHEMA_VERSION;
}

export interface InstallerTrustFaultProofBarrierWitness {
  readonly barrierCount: number;
  readonly finalBarrierOrder: number;
  readonly phase: InstallerTrustFaultTransition["phase"];
}

export interface InstallerTrustFaultProofGap {
  readonly afterOrder: number;
  readonly beforeOrder: number;
  readonly edgeCounts: readonly Readonly<{
    readonly count: number;
    readonly edgeId: number;
  }>[];
}

export interface InstallerTrustFaultTransitionProof extends InstallerTrustFaultTransitionProofBase {
  readonly barrierWitnesses: readonly InstallerTrustFaultProofBarrierWitness[];
  readonly barrierWitnessesSha256: string;
  readonly gaps: readonly InstallerTrustFaultProofGap[];
  readonly schemaVersion: typeof INSTALLER_TRUST_FAULT_TRANSITION_PROOF_SCHEMA_VERSION;
}

export type InstallerTrustFaultTransitionProofEvidence =
  | InstallerTrustFaultTransitionProofV1
  | InstallerTrustFaultTransitionProofV2
  | InstallerTrustFaultTransitionProof;

interface MutableEdge {
  count: number;
  readonly firstCountsAfter: readonly number[];
  readonly firstOrder: number;
  readonly fromStateId: number;
  readonly id: number;
  lastOrder: number;
  lastCountsAfter: readonly number[];
  readonly toStateId: number;
}

interface MutablePhase {
  readonly attemptMilestones: string[];
  readonly finalStateId: number;
  readonly firstOrder: number;
  readonly initialStateId: number;
  lastOrder: number;
  observedCount: number;
  readonly phase: InstallerTrustFaultTransition["phase"];
  previousTransferState: string;
  readonly seenTransferEdges: Set<string>;
}

interface MutableRepairFinalizationProgress {
  precursorReached: boolean;
  reconciliationReached: boolean;
  revocationReached: boolean;
  terminalReached: boolean;
  verificationReached: boolean;
  writingReached: boolean;
}

interface MutableEstimateTerminalProgress {
  ingressReached: boolean;
  repeatCount: number;
}

export interface InstallerTrustFaultTransitionProofRecorder {
  finish(): InstallerTrustFaultTransitionProof;
  observe(input: unknown, boundary?: "barrier"): void;
  prefix(): InstallerTrustFaultTransitionProofPrefix;
  retainFailure(error: Error, predicate: InstallerTrustFaultRawFailurePredicate): void;
}

export interface InstallerTrustFaultTransitionProofPrefix {
  readonly observationCount: number;
  readonly sha256: string;
}

export function createInstallerTrustFaultTransitionProofRecorder(
  id: InstallerTrustFaultCellId,
  authority: InstallerTrustFaultAuthority,
  faultResourceId: string,
  verdictMode: InstallerTrustFaultProofVerdictMode = "expected",
): InstallerTrustFaultTransitionProofRecorder {
  const states: InstallerTrustFaultProofState[] = [];
  const stateIds = new Map<string, number>();
  const edges: MutableEdge[] = [];
  const edgeIds = new Map<string, number>();
  const phases: MutablePhase[] = [];
  const dimensionChangeCounts = zeroDimensionCounts();
  const hash = createHash("sha256");
  let previous: InstallerTrustFaultTransition | null = null;
  let previousStateId: number | null = null;
  let observationCount = 0;
  let finished = false;
  const rawObservationPrefix: InstallerTrustFaultRawObservation[] = [];
  const rawObservationTail: InstallerTrustFaultRawObservation[] = [];
  const rawStreamHash = createHash("sha256");
  let rawObservationCount = 0;
  let rawPrefixJsonBytes = 2;
  let rawTailJsonBytes = 2;
  let rawPrefixComplete = false;
  let lastRejectedInput: unknown;
  let lastRejectedPredicate: InstallerTrustFaultRawFailurePredicate | null = null;
  const repairFinalizationProgress: MutableRepairFinalizationProgress = {
    precursorReached: false,
    reconciliationReached: false,
    revocationReached: false,
    terminalReached: false,
    verificationReached: false,
    writingReached: false,
  };
  const estimateTerminalProgress: MutableEstimateTerminalProgress = {
    ingressReached: false,
    repeatCount: 0,
  };
  const barrierWitnesses = new Map<
    InstallerTrustFaultTransition["phase"],
    { barrierCount: number; finalBarrierOrder: number }
  >();

  return Object.freeze({
    finish: () => {
      if (finished) throw new Error("Installer trust-fault transition proof was already finalized");
      finished = true;
      if (previous === null || states.length === 0 || phases.length === 0) {
        throw new Error("Installer trust-fault transition proof has no observations");
      }
      const serializedBarrierWitnesses = Object.freeze(
        phases.map((phase) => {
          const witness = barrierWitnesses.get(phase.phase);
          if (rawObservationCount > 0 && witness?.finalBarrierOrder !== phase.lastOrder) {
            throw new Error(
              `Installer trust-fault phase ${phase.phase} lacks its final raw barrier`,
            );
          }
          return Object.freeze({
            barrierCount: witness?.barrierCount ?? 0,
            finalBarrierOrder: witness?.finalBarrierOrder ?? 0,
            phase: phase.phase,
          });
        }),
      );
      const activeRawProof = rawObservationCount > 0;
      const commonProof = {
        contract: INSTALLER_TRUST_FAULT_TRANSITION_PROOF_CONTRACT,
        dimensionChangeCounts: Object.freeze({ ...dimensionChangeCounts }),
        edges: Object.freeze(
          edges.map(
            ({ firstCountsAfter: _firstCountsAfter, lastCountsAfter: _lastCountsAfter, ...edge }) =>
              Object.freeze({ ...edge }),
          ),
        ),
        finalStateId: previousStateId as number,
        firstOrder: 1,
        initialStateId: 1,
        lastOrder: observationCount,
        phases: Object.freeze(
          phases.map(({ previousTransferState: _previous, seenTransferEdges: _seen, ...phase }) =>
            Object.freeze({
              ...phase,
              attemptMilestones: Object.freeze([...phase.attemptMilestones]),
            }),
          ),
        ),
        rawObservationCount: observationCount,
        states: Object.freeze(states.map((state) => Object.freeze({ ...state }))),
        streamSha256: hash.digest("hex"),
      } as const;
      const proof = Object.freeze({
        ...commonProof,
        barrierWitnesses: serializedBarrierWitnesses,
        barrierWitnessesSha256: digestBarrierWitnesses(serializedBarrierWitnesses),
        gaps: buildProofGaps(edges),
        schemaVersion: INSTALLER_TRUST_FAULT_TRANSITION_PROOF_SCHEMA_VERSION,
      });
      if (activeRawProof) {
        validateInstallerTrustFaultRawTransitionProof(proof, id, authority, faultResourceId);
      } else {
        validateInstallerTrustFaultTransitionProof(
          proof,
          id,
          authority,
          faultResourceId,
          INSTALLER_TRUST_FAULT_TRANSITION_PROOF_SCHEMA_VERSION,
          verdictMode,
        );
      }
      return proof;
    },
    observe: (input: unknown, boundary?: "barrier") => {
      if (finished) throw new Error("Installer trust-fault transition proof is finalized");
      let rawObservation: InstallerTrustFaultRawObservation | null;
      try {
        rawObservation = parseRawObservation(input, observationCount + 1);
      } catch (error: unknown) {
        if (error instanceof Error) {
          lastRejectedInput = input;
          lastRejectedPredicate = /order/iu.test(error.message)
            ? "observation-order"
            : "observation-parse";
          retainRawObservationFailure(
            error,
            rawRetention(),
            input,
            id,
            authority,
            faultResourceId,
            lastRejectedPredicate,
          );
        }
        throw error;
      }
      const transition = validateInstallerTrustFaultTransitionObservation(
        rawObservation?.transition ?? input,
        observationCount + 1,
      );
      if (rawObservation !== null) {
        if (rawObservationCount >= INSTALLER_TRUST_FAULT_MAX_RAW_OBSERVATIONS) {
          const error = new Error("Installer trust-fault raw observation bound was exceeded");
          lastRejectedInput = input;
          lastRejectedPredicate = "observation-bound";
          retainRawObservationFailure(
            error,
            rawRetention(),
            input,
            id,
            authority,
            faultResourceId,
            "observation-bound",
          );
          throw error;
        }
      }
      try {
        if (rawObservation === null) {
          validateOnlineObservation(
            transition,
            previous,
            id,
            authority,
            faultResourceId,
            verdictMode,
            repairFinalizationProgress,
            estimateTerminalProgress,
          );
        } else {
          validateRawDiagnosticStructure(transition, previous, id, authority, faultResourceId);
          validateRawTelemetrySafety(
            rawObservation.telemetry,
            transition,
            id,
            authority,
            faultResourceId,
          );
          if (boundary === "barrier") {
            validateRawBarrierObservation(rawObservation, previous, id, authority, faultResourceId);
          }
        }
      } catch (error: unknown) {
        if (error instanceof Error) {
          lastRejectedInput = input;
          lastRejectedPredicate =
            boundary === "barrier" && isRawObservationConsistencyFailure(error)
              ? "observation-consistency"
              : "cell-invariant";
          retainRawObservationFailure(
            error,
            rawRetention(),
            input,
            id,
            authority,
            faultResourceId,
            lastRejectedPredicate,
          );
        }
        throw error;
      }
      const stateKey = transitionStateKey(transition);
      let stateId = stateIds.get(stateKey);
      if (stateId === undefined) {
        stateId = states.length + 1;
        if (stateId > INSTALLER_TRUST_FAULT_MAX_PROOF_STATES) {
          throw new Error("Installer trust-fault transition proof exceeded finite state space");
        }
        stateIds.set(stateKey, stateId);
        states.push(
          Object.freeze({
            ...withoutOrder(transition),
            firstOrder: transition.order,
            id: stateId,
          }),
        );
      }
      updatePhase(phases, transition, stateId);
      if (rawObservation !== null && boundary === "barrier") {
        const witness = barrierWitnesses.get(transition.phase);
        barrierWitnesses.set(transition.phase, {
          barrierCount: (witness?.barrierCount ?? 0) + 1,
          finalBarrierOrder: transition.order,
        });
      }
      if (previous !== null && previousStateId !== null) {
        for (const dimension of DIMENSIONS) {
          if (transition[dimension] !== previous[dimension]) {
            dimensionChangeCounts[dimension] += 1;
          }
        }
        const edgeKey = `${previousStateId}:${stateId}`;
        const edgeId = edgeIds.get(edgeKey);
        if (edgeId === undefined) {
          const idValue = edges.length + 1;
          if (idValue > INSTALLER_TRUST_FAULT_MAX_PROOF_EDGES) {
            throw new Error("Installer trust-fault transition proof exceeded finite edge space");
          }
          edgeIds.set(edgeKey, idValue);
          const countsAfter = Object.freeze([...edges.map((edge) => edge.count), 1]);
          edges.push({
            count: 1,
            firstCountsAfter: countsAfter,
            firstOrder: transition.order,
            fromStateId: previousStateId,
            id: idValue,
            lastOrder: transition.order,
            lastCountsAfter: countsAfter,
            toStateId: stateId,
          });
        } else {
          const edge = edges[edgeId - 1];
          if (edge === undefined) throw new Error("Installer trust-fault proof edge is absent");
          edge.count += 1;
          edge.lastOrder = transition.order;
          edge.lastCountsAfter = Object.freeze(edges.map((candidate) => candidate.count));
        }
      }
      updateStreamHash(hash, transition);
      if (rawObservation !== null) {
        const candidateBytes = Buffer.byteLength(JSON.stringify(rawObservation), "utf8");
        const prefixBytesAfterCandidate =
          rawPrefixJsonBytes + candidateBytes + (rawObservationPrefix.length === 0 ? 0 : 1);
        if (
          !rawPrefixComplete &&
          prefixBytesAfterCandidate <= INSTALLER_TRUST_FAULT_MAX_RETAINED_RAW_PREFIX_BYTES
        ) {
          rawObservationPrefix.push(rawObservation);
          rawPrefixJsonBytes = prefixBytesAfterCandidate;
        } else {
          rawPrefixComplete = true;
          rawObservationTail.push(rawObservation);
          rawTailJsonBytes += candidateBytes + (rawObservationTail.length === 1 ? 0 : 1);
          while (rawTailJsonBytes > INSTALLER_TRUST_FAULT_MAX_RETAINED_RAW_TAIL_BYTES) {
            const removed = rawObservationTail.shift();
            if (removed === undefined)
              throw new Error("Installer trust-fault raw tail underflowed");
            rawTailJsonBytes -=
              Buffer.byteLength(JSON.stringify(removed), "utf8") +
              (rawObservationTail.length === 0 ? 0 : 1);
          }
        }
        updateRawObservationStreamHash(rawStreamHash, rawObservation);
        rawObservationCount += 1;
      }
      observationCount += 1;
      previous = transition;
      previousStateId = stateId;
    },
    prefix: () =>
      Object.freeze({
        observationCount,
        sha256: hash.copy().digest("hex"),
      }),
    retainFailure: (error: Error, predicate: InstallerTrustFaultRawFailurePredicate) => {
      if (lastRejectedPredicate !== null) {
        retainRawObservationFailure(
          error,
          rawRetention(),
          lastRejectedInput,
          id,
          authority,
          faultResourceId,
          lastRejectedPredicate,
        );
      }
      void predicate;
    },
  });

  function rawRetention(): RawObservationRetention {
    return Object.freeze({
      acceptedObservationCount: rawObservationCount,
      acceptedObservationPrefix: rawObservationPrefix,
      acceptedObservationTail: rawObservationTail,
      streamSha256: rawStreamHash.copy().digest("hex"),
    });
  }
}

function validateRawDiagnosticStructure(
  current: InstallerTrustFaultTransition,
  previous: InstallerTrustFaultTransition | null,
  id: InstallerTrustFaultCellId,
  authority: InstallerTrustFaultAuthority,
  faultResourceId: string,
): void {
  validateAuthorityDimensions(current, authority, faultResourceId);
  const phases = expectedCellPhases(id);
  const currentRank = phases.indexOf(current.phase);
  if (currentRank < 0) {
    throw new Error(`Installer trust-fault cell ${id} observed forbidden phase ${current.phase}`);
  }
  if (previous === null) {
    if (current.phase !== "setup") {
      throw new Error("Installer trust-fault transition proof did not start in setup");
    }
  } else {
    const previousRank = phases.indexOf(previous.phase);
    if (currentRank < previousRank || currentRank > previousRank + 1) {
      throw new Error("Installer trust-fault transition proof crossed a forbidden phase boundary");
    }
  }
  if ((current.releaseDigest === null) !== (current.shellGenerationId === null)) {
    throw new Error("Installer trust-fault raw observation has partial shell authority");
  }
  if (
    current.releaseDigest !== null &&
    current.uiState !== "ready" &&
    expectedOperationUiState(id, current.phase) !== "repairing"
  ) {
    throw new Error("Installer trust-fault raw observation has forbidden shell authority context");
  }
}

function validateRawBarrierObservation(
  current: InstallerTrustFaultRawObservation,
  previous: InstallerTrustFaultTransition | null,
  id: InstallerTrustFaultCellId,
  authority: InstallerTrustFaultAuthority,
  faultResourceId: string,
): void {
  validateRawObservationConsistency(current);
  validateInstallerTrustFaultCellPhaseOutcome(
    current.transition,
    previous,
    id,
    authority,
    faultResourceId,
  );
  validateEstimateBarrierTransition(current.transition, previous, id);
}

function validateRawTelemetrySafety(
  telemetry:
    | InstallerSnapshot
    | InstallerTrustFaultRawTelemetry
    | InstallerTrustFaultLegacyRawTelemetry,
  transition: InstallerTrustFaultTransition,
  id: InstallerTrustFaultCellId,
  authority: InstallerTrustFaultAuthority,
  faultResourceId: string,
  targetSemantics: PriorAttemptTransferTargetSemantics = "current-exact-target",
): void {
  const { installStore, installerTransfer } = telemetry;
  const storeActive = installStore.activeReleaseDigest;
  const transferActive =
    "activeReleaseDigest" in installerTransfer ? installerTransfer.activeReleaseDigest : null;
  if (
    isPriorAttemptQuotaHandoffTransition(id, transition) &&
    installerTransfer.failureCode !== null
  ) {
    if (
      installStore.activeReleaseDigest !== null ||
      installStore.state !== "failed" ||
      (targetSemantics === "retained-pre-target-binding"
        ? transferActive !== null && transferActive !== authority.releaseDigest
        : transferActive !== authority.releaseDigest) ||
      installerTransfer.state !== "failed"
    ) {
      throw new Error(
        "Installer trust-fault prior-attempt quota handoff telemetry projection is invalid",
      );
    }
  }
  if (
    (storeActive !== null && storeActive !== authority.releaseDigest) ||
    (transferActive !== null && transferActive !== authority.releaseDigest) ||
    (storeActive !== null &&
      installStore.state !== "ready" &&
      expectedOperationUiState(id, transition.phase) !== "repairing") ||
    (installerTransfer.state === "ready" &&
      (installStore.state !== "ready" || storeActive !== authority.releaseDigest))
  ) {
    throw new Error("Installer trust-fault raw telemetry has contradictory publication authority");
  }
  if (
    (installerTransfer.state === "failed" || installerTransfer.state === "cancelled") !==
      (installerTransfer.failureCode !== null) ||
    (installerTransfer.failureCode === null && installerTransfer.failureResourceId !== null) ||
    (installerTransfer.failureResourceId !== null &&
      installerTransfer.failureResourceId !== faultResourceId)
  ) {
    throw new Error("Installer trust-fault raw telemetry has contradictory fault authority");
  }
  if (!("failureClass" in installerTransfer)) return;
  if (
    (installerTransfer.failureCode === null) !== (installerTransfer.failureClass === null) ||
    (installerTransfer.failureCode === null) !== (installerTransfer.failureEvidence === null) ||
    (installerTransfer.failureCode === null) !== (installerTransfer.failureSource === null) ||
    (installerTransfer.failureCode === null) !== (installerTransfer.failureMessage === null) ||
    (installerTransfer.failureCode === null) !== (installerTransfer.failureOperation === null) ||
    (installerTransfer.failureExpectedReleaseDigest !== null &&
      (installerTransfer.failureSource !== "operation" ||
        installerTransfer.failureOperation !== "repair")) ||
    (installerTransfer.failureSource === "operation" &&
      installerTransfer.failureOperation === "repair" &&
      installerTransfer.failureExpectedReleaseDigest !== authority.releaseDigest)
  ) {
    throw new Error("Installer trust-fault raw telemetry has contradictory fault authority");
  }
  if (
    installerTransfer.failureCode !== null &&
    installerTransfer.failureClass !== null &&
    installerTransfer.failureEvidence !== null &&
    installerTransfer.failureMessage !== null &&
    installerTransfer.failureOperation !== null
  ) {
    assertCanonicalInstallerFailureDiagnostic({
      code: installerTransfer.failureCode,
      failureClass: installerTransfer.failureClass,
      failureEvidence: installerTransfer.failureEvidence,
      message: installerTransfer.failureMessage,
      operation: installerTransfer.failureOperation,
      resourceId: installerTransfer.failureResourceId,
    });
    validateExpectedRawFailureDiagnostic(installerTransfer, transition, id, faultResourceId);
  }
}

function validateExpectedRawFailureDiagnostic(
  diagnostic: InstallerTrustFaultRawTelemetry["installerTransfer"],
  transition: InstallerTrustFaultTransition,
  id: InstallerTrustFaultCellId,
  faultResourceId: string,
): void {
  const expected = expectedStructuredFailureDiagnostic(id, transition, faultResourceId);
  if (
    expected === null ||
    diagnostic.failureCode !== expected.code ||
    diagnostic.failureClass !== expected.failureClass ||
    diagnostic.failureEvidence !== expected.failureEvidence ||
    diagnostic.failureMessage !== expected.failureMessage ||
    diagnostic.failureOperation !== expected.failureOperation ||
    diagnostic.failureResourceId !== expected.failureResourceId
  ) {
    throw new Error(
      "Installer trust-fault compact raw failure diagnostic differs from the exact cell-phase contract",
    );
  }
}

function expectedStructuredFailureDiagnostic(
  id: InstallerTrustFaultCellId,
  transition: InstallerTrustFaultTransition,
  faultResourceId: string,
): Readonly<{
  code: "integrity" | "quota";
  failureClass: "installer-transfer" | "quota";
  failureEvidence: "quota-exceeded" | "transfer-integrity";
  failureMessage: string;
  failureOperation: "install" | "repair";
  failureResourceId: string | null;
}> | null {
  const priorAttemptHandoff = isPriorAttemptQuotaHandoffTransition(id, transition);
  if (transition.phase !== "attempt-1" && !priorAttemptHandoff) return null;
  if (id === "repeated-server-corruption") {
    return Object.freeze({
      code: "integrity",
      failureClass: "installer-transfer",
      failureEvidence: "transfer-integrity",
      failureMessage: "Partial object failed exact <local-path> verification",
      failureOperation: "repair",
      failureResourceId: faultResourceId,
    });
  }
  if (id === "mid-append-quota-resume") {
    return Object.freeze({
      code: "quota",
      failureClass: "quota",
      failureEvidence: "quota-exceeded",
      failureMessage: "Installer storage quota was exceeded",
      failureOperation: "install",
      failureResourceId: faultResourceId,
    });
  }
  if (id === "estimate-clearly-insufficient" || id === "quota-probe-exceeded") {
    return Object.freeze({
      code: "quota",
      failureClass: "quota",
      failureEvidence: "quota-exceeded",
      failureMessage: "Installer storage quota was exceeded",
      failureOperation: "install",
      failureResourceId: null,
    });
  }
  return null;
}

function isPriorAttemptQuotaHandoffTransition(
  id: InstallerTrustFaultCellId,
  transition: InstallerTrustFaultTransition,
): boolean {
  return (
    id === "mid-append-quota-resume" &&
    transition.phase === "attempt-2" &&
    (transition.uiState === "requesting-persistence" ||
      transition.uiState === "installing" ||
      transition.uiState === "ready") &&
    transition.failureCode === null &&
    transition.failureResourceId === null
  );
}

function validateHistoricalRawOnlineStructure(
  current: InstallerTrustFaultTransition,
  previous: InstallerTrustFaultTransition | null,
  id: InstallerTrustFaultCellId,
  authority: InstallerTrustFaultAuthority,
  faultResourceId: string,
): void {
  validateRawDiagnosticStructure(current, previous, id, authority, faultResourceId);
  validateInstallerTrustFaultCellPhaseOutcome(current, previous, id, authority, faultResourceId);
  validateEstimateBarrierTransition(current, previous, id);
}

function validateEstimateBarrierTransition(
  transition: InstallerTrustFaultTransition,
  previous: InstallerTrustFaultTransition | null,
  id: InstallerTrustFaultCellId,
): void {
  if (id === "estimate-clearly-insufficient") {
    const allowedTransfers = new Set([
      "idle",
      "waiting-lock",
      "planning",
      "probing-quota",
      "failed",
    ]);
    if (
      transition.activeReleaseDigest !== null ||
      transition.releaseDigest !== null ||
      transition.shellGenerationId !== null ||
      transition.storeState === "ready" ||
      transition.transferState === "ready" ||
      transition.uiState === "ready" ||
      !allowedTransfers.has(transition.transferState)
    ) {
      throw new Error("Installer trust-fault estimate cell acquired forbidden authority");
    }
    if (previous !== null && transition.phase === previous.phase) {
      const rank = ["idle", "waiting-lock", "planning", "probing-quota", "failed"].indexOf(
        transition.transferState,
      );
      const previousTransferRank = [
        "idle",
        "waiting-lock",
        "planning",
        "probing-quota",
        "failed",
      ].indexOf(previous.transferState);
      if (rank < previousTransferRank) {
        throw new Error("Installer trust-fault estimate cell reversed transfer phase");
      }
    }
  }
}

function isRawObservationConsistencyFailure(error: Error): boolean {
  return error.message === "Installer trust-fault raw observation contradicts full telemetry";
}

/** Shared fail-closed product outcome contract used by live raw capture and schema-12 replay. */
export function validateInstallerTrustFaultCellPhaseOutcome(
  current: InstallerTrustFaultTransition,
  previous: InstallerTrustFaultTransition | null,
  id: InstallerTrustFaultCellId,
  authority: InstallerTrustFaultAuthority,
  faultResourceId: string,
): void {
  const hasActive = current.activeReleaseDigest !== null;
  const hasRelease = current.releaseDigest !== null;
  const hasShell = current.shellGenerationId !== null;
  const hasPublication = hasActive || hasRelease || hasShell;
  if (current.phase === "setup") {
    if (
      hasPublication ||
      current.transferState === "ready" ||
      current.transferState === "failed" ||
      current.storeState === "ready" ||
      current.uiState === "ready" ||
      current.uiState === "failed" ||
      current.failureCode !== null ||
      current.failureResourceId !== null
    ) {
      throw new Error("Installer trust-fault setup acquired terminal outcome authority");
    }
    return;
  }

  const outcome = expectedPhaseOutcome(id, current.phase);
  const operationUiState = expectedOperationUiState(id, current.phase);
  if (outcome === "failed") {
    const inheritedRepairReady =
      operationUiState === "repairing" &&
      isRetainedRepairReadyPrelude(current, authority) &&
      (previous === null ||
        previous.phase !== current.phase ||
        isRetainedRepairReadyPrelude(previous, authority));
    if (
      current.uiState === "ready" ||
      (current.transferState === "ready" && !inheritedRepairReady) ||
      (operationUiState === "installing" && hasPublication)
    ) {
      throw new Error("Installer trust-fault failure-only phase acquired Ready authority");
    }
    if (operationUiState === "repairing" && previous?.phase === current.phase) {
      if (
        (previous.activeReleaseDigest === null && hasActive) ||
        (previous.releaseDigest === null && hasRelease) ||
        (previous.shellGenerationId === null && hasShell)
      ) {
        throw new Error("Installer trust-fault failure-only phase restored revoked authority");
      }
    }
    if (current.transferState === "failed") {
      const expected = expectedPhaseFailure(id, current.phase, faultResourceId);
      if (
        current.failureCode !== expected.code ||
        current.failureResourceId !== expected.resourceId ||
        current.uiState !== "failed" ||
        hasPublication
      ) {
        throw new Error("Installer trust-fault failure-only phase has the wrong terminal fault");
      }
    } else if (current.failureCode !== null || current.failureResourceId !== null) {
      throw new Error("Installer trust-fault failure-only phase exposes a nonterminal fault");
    }
    return;
  }

  if (
    current.transferState === "failed" ||
    current.uiState === "failed" ||
    current.failureCode !== null ||
    current.failureResourceId !== null
  ) {
    throw new Error("Installer trust-fault success phase acquired failure authority");
  }
  if (current.transferState === "ready") {
    if (
      current.storeState !== "ready" ||
      current.activeReleaseDigest !== authority.releaseDigest ||
      (current.uiState === "ready" &&
        (current.releaseDigest !== authority.releaseDigest ||
          current.shellGenerationId !== `${authority.artifactDigest}:${authority.releaseDigest}`))
    ) {
      throw new Error("Installer trust-fault success phase has incomplete Ready authority");
    }
  } else if (
    operationUiState === "installing" &&
    hasPublication &&
    !isVerifiedStorePublicationHandoff(current, authority)
  ) {
    throw new Error("Installer trust-fault install success published before Ready");
  }
}

function isVerifiedStorePublicationHandoff(
  current: InstallerTrustFaultTransition,
  authority: InstallerTrustFaultAuthority,
): boolean {
  return (
    current.storeState === "ready" &&
    current.activeReleaseDigest === authority.releaseDigest &&
    current.transferState === "verifying" &&
    current.uiState === "installing" &&
    current.releaseDigest === null &&
    current.shellGenerationId === null
  );
}

function parseRawObservation(
  input: unknown,
  expectedOrder: number,
  allowLegacyCompact = false,
): InstallerTrustFaultRawObservation | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const candidate = input as Record<string, unknown>;
  if (!Object.hasOwn(candidate, "transition")) return null;
  exact(candidate, ["degradedDurabilityWarning", "persistence", "telemetry", "transition"]);
  const transition = validateInstallerTrustFaultTransitionObservation(
    candidate.transition,
    expectedOrder,
  );
  if (
    typeof candidate.persistence !== "string" ||
    !["denied", "failed", "granted", "not-requested", "requesting"].includes(
      candidate.persistence,
    ) ||
    typeof candidate.degradedDurabilityWarning !== "boolean"
  ) {
    throw new Error("Installer trust-fault raw observation UI fields are invalid");
  }
  const observation = Object.freeze({
    degradedDurabilityWarning: candidate.degradedDurabilityWarning,
    persistence: candidate.persistence as InstallerTrustFaultPersistenceObservation,
    telemetry: parseRawTelemetry(candidate.telemetry, allowLegacyCompact),
    transition,
  });
  if ((observation.persistence === "denied") !== observation.degradedDurabilityWarning) {
    throw new Error("Installer trust-fault raw observation UI persistence is contradictory");
  }
  if (
    Buffer.byteLength(JSON.stringify(observation), "utf8") >
    INSTALLER_TRUST_FAULT_MAX_SERIALIZED_RAW_OBSERVATION_BYTES
  ) {
    throw new Error("Installer trust-fault raw observation envelope exceeds its byte bound");
  }
  return observation;
}

function parseRawTelemetry(
  input: unknown,
  allowLegacyCompact: boolean,
): InstallerSnapshot | InstallerTrustFaultRawTelemetry | InstallerTrustFaultLegacyRawTelemetry {
  try {
    return sanitizeInstallerSnapshot(parseInstallerSnapshot(input));
  } catch {
    const telemetry = record(input, "compact raw telemetry");
    exact(telemetry, ["installStore", "installerTransfer"]);
    const installStore = record(telemetry.installStore, "compact raw install-store telemetry");
    const installerTransfer = record(
      telemetry.installerTransfer,
      "compact raw installer-transfer telemetry",
    );
    exact(installStore, ["activeReleaseDigest", "state"]);
    const legacyKeys = ["failureCode", "failureResourceId", "state"];
    if (
      allowLegacyCompact &&
      Object.keys(installerTransfer).sort().join(",") === legacyKeys.sort().join(",")
    ) {
      exact(installStore, ["activeReleaseDigest", "state"]);
      if (
        (installStore.activeReleaseDigest !== null &&
          (typeof installStore.activeReleaseDigest !== "string" ||
            !/^[a-f0-9]{64}$/u.test(installStore.activeReleaseDigest))) ||
        typeof installStore.state !== "string" ||
        !(INSTALLER_TRUST_FAULT_STORE_STATES as readonly string[]).includes(installStore.state) ||
        !(INSTALLER_TRUST_FAULT_OPTIONAL_FAILURE_CODES as readonly unknown[]).includes(
          installerTransfer.failureCode,
        ) ||
        (installerTransfer.failureResourceId !== null &&
          (typeof installerTransfer.failureResourceId !== "string" ||
            installerTransfer.failureResourceId.length < 1 ||
            installerTransfer.failureResourceId.length > 256)) ||
        typeof installerTransfer.state !== "string" ||
        !(INSTALLER_TRUST_FAULT_TRANSFER_STATES as readonly string[]).includes(
          installerTransfer.state,
        )
      ) {
        throw new Error("Installer trust-fault legacy compact raw telemetry is invalid");
      }
      return Object.freeze({
        installStore: Object.freeze({
          activeReleaseDigest: installStore.activeReleaseDigest as string | null,
          state: installStore.state as InstallerTrustFaultStoreState,
        }),
        installerTransfer: Object.freeze({
          failureCode:
            installerTransfer.failureCode as InstallerTrustFaultTransition["failureCode"],
          failureResourceId: installerTransfer.failureResourceId as string | null,
          state: installerTransfer.state as InstallerTrustFaultTransferState,
        }),
      });
    }
    exact(installerTransfer, [
      "activeReleaseDigest",
      "failureClass",
      "failureCode",
      "failureEvidence",
      "failureExpectedReleaseDigest",
      "failureMessage",
      "failureOperation",
      "failureResourceId",
      "failureSource",
      "state",
    ]);
    if (
      (installStore.activeReleaseDigest !== null &&
        (typeof installStore.activeReleaseDigest !== "string" ||
          !/^[a-f0-9]{64}$/u.test(installStore.activeReleaseDigest))) ||
      typeof installStore.state !== "string" ||
      !(INSTALLER_TRUST_FAULT_STORE_STATES as readonly string[]).includes(installStore.state) ||
      !(INSTALLER_TRUST_FAULT_OPTIONAL_FAILURE_CODES as readonly unknown[]).includes(
        installerTransfer.failureCode,
      ) ||
      (installerTransfer.activeReleaseDigest !== null &&
        (typeof installerTransfer.activeReleaseDigest !== "string" ||
          !/^[a-f0-9]{64}$/u.test(installerTransfer.activeReleaseDigest))) ||
      (installerTransfer.failureClass !== null &&
        typeof installerTransfer.failureClass !== "string") ||
      (installerTransfer.failureEvidence !== null &&
        typeof installerTransfer.failureEvidence !== "string") ||
      (installerTransfer.failureExpectedReleaseDigest !== null &&
        (typeof installerTransfer.failureExpectedReleaseDigest !== "string" ||
          !/^[a-f0-9]{64}$/u.test(installerTransfer.failureExpectedReleaseDigest))) ||
      (installerTransfer.failureMessage !== null &&
        typeof installerTransfer.failureMessage !== "string") ||
      (installerTransfer.failureOperation !== null &&
        typeof installerTransfer.failureOperation !== "string") ||
      (installerTransfer.failureResourceId !== null &&
        (typeof installerTransfer.failureResourceId !== "string" ||
          installerTransfer.failureResourceId.length < 1 ||
          installerTransfer.failureResourceId.length > 256)) ||
      (installerTransfer.failureSource !== null &&
        installerTransfer.failureSource !== "operation" &&
        installerTransfer.failureSource !== "session") ||
      typeof installerTransfer.state !== "string" ||
      !(INSTALLER_TRUST_FAULT_TRANSFER_STATES as readonly string[]).includes(
        installerTransfer.state,
      )
    ) {
      throw new Error("Installer trust-fault compact raw telemetry is invalid");
    }
    return Object.freeze({
      installStore: Object.freeze({
        activeReleaseDigest: installStore.activeReleaseDigest as string | null,
        state: installStore.state as InstallerTrustFaultStoreState,
      }),
      installerTransfer: Object.freeze({
        activeReleaseDigest: installerTransfer.activeReleaseDigest as string | null,
        failureCode: installerTransfer.failureCode as InstallerTrustFaultTransition["failureCode"],
        failureClass: installerTransfer.failureClass as InstallerFailureClass | null,
        failureEvidence: installerTransfer.failureEvidence as InstallerFailureEvidence | null,
        failureExpectedReleaseDigest: installerTransfer.failureExpectedReleaseDigest as
          | string
          | null,
        failureMessage: installerTransfer.failureMessage as string | null,
        failureOperation: installerTransfer.failureOperation as InstallerFailureOperation | null,
        failureResourceId: installerTransfer.failureResourceId as string | null,
        failureSource: installerTransfer.failureSource as "operation" | "session" | null,
        state: installerTransfer.state as InstallerTrustFaultTransferState,
      }),
    });
  }
}

function validateRawObservationConsistency(observation: InstallerTrustFaultRawObservation): void {
  const { installStore, installerTransfer } = observation.telemetry;
  const transition = observation.transition;
  if (
    transition.storeState !== installStore.state ||
    transition.transferState !== installerTransfer.state ||
    transition.activeReleaseDigest !== installStore.activeReleaseDigest ||
    transition.failureCode !== installerTransfer.failureCode ||
    transition.failureResourceId !== installerTransfer.failureResourceId
  ) {
    throw new Error("Installer trust-fault raw observation contradicts full telemetry");
  }
}

interface RawObservationRetention {
  readonly acceptedObservationCount: number;
  readonly acceptedObservationPrefix: readonly InstallerTrustFaultRawObservation[];
  readonly acceptedObservationTail: readonly InstallerTrustFaultRawObservation[];
  readonly streamSha256: string;
}

function retainRawObservationFailure(
  error: Error,
  retention: RawObservationRetention,
  rejectedInput: unknown,
  cellId: InstallerTrustFaultCellId,
  authority: InstallerTrustFaultAuthority,
  faultResourceId: string,
  failedPredicate: InstallerTrustFaultRawFailurePredicate,
): void {
  if (TRUSTED_RAW_OBSERVATION_DIAGNOSTICS.has(error)) return;
  if (!isRawObservationEnvelopeCandidate(rejectedInput)) return;
  const retainedPrefix = Object.freeze(
    retention.acceptedObservationPrefix.map((observation) => Object.freeze(observation)),
  );
  const retainedTail = Object.freeze(
    retention.acceptedObservationTail.map((observation) => Object.freeze(observation)),
  );
  const retainedEnvelopeBytes =
    INSTALLER_TRUST_FAULT_RAW_V3_FIXED_BYTES +
    serializedAcceptedRawBytes(retainedPrefix) +
    serializedAcceptedRawBytes(retainedTail);
  const rejectedSample = createRejectedSample(
    rejectedInput,
    tryParseRejectedObservation(rejectedInput),
    failedPredicate,
    INSTALLER_TRUST_FAULT_MAX_RAW_ARTIFACT_BYTES - retainedEnvelopeBytes,
  );
  const rawArtifactBytes = rawEvidenceBytesV3(retainedPrefix, retainedTail, rejectedSample);
  TRUSTED_RAW_OBSERVATION_DIAGNOSTICS.set(
    error,
    Object.freeze({
      acceptedObservationCount: retention.acceptedObservationCount,
      acceptedObservationPrefix: retainedPrefix,
      acceptedObservationTail: retainedTail,
      authority: Object.freeze({
        artifactDigest: authority.artifactDigest,
        releaseDigest: authority.releaseDigest,
      }) as InstallerTrustFaultAuthority,
      cellId,
      contract: INSTALLER_TRUST_FAULT_RAW_OBSERVATION_CONTRACT,
      failedPredicate,
      faultResourceId,
      phase: (retainedTail.at(-1) ?? retainedPrefix.at(-1))?.transition.phase ?? null,
      rawArtifactBytes,
      rejectedSample,
      retainedSha256: digestRetainedRawObservations(retainedPrefix, retainedTail),
      schemaVersion: INSTALLER_TRUST_FAULT_RAW_OBSERVATION_SCHEMA_VERSION,
      sha256: retention.streamSha256,
    }),
  );
}

function sanitizeInstallerSnapshot(snapshot: InstallerSnapshot): InstallerSnapshot {
  const sanitized = sanitizeRawValue(snapshot, 0, { nodes: 0 });
  const bytes = Buffer.byteLength(JSON.stringify(sanitized), "utf8");
  if (bytes > INSTALLER_TRUST_FAULT_MAX_RAW_TELEMETRY_BYTES) {
    throw new Error("Installer trust-fault raw telemetry exceeds its byte bound");
  }
  return parseInstallerSnapshot(sanitized);
}

function sanitizeRawValue(input: unknown, depth: number, budget: { nodes: number }): unknown {
  if (depth > 16 || budget.nodes++ > 4_096) {
    throw new Error("Installer trust-fault raw telemetry structure exceeds its bound");
  }
  if (input === null || typeof input === "boolean" || typeof input === "number") return input;
  if (typeof input === "string") {
    const clean = Array.from(input, (character) => {
      const code = character.codePointAt(0) ?? 0;
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)
        ? character
        : " ";
    }).join("");
    if (clean.length > INSTALLER_TRUST_FAULT_MAX_RAW_TEXT) {
      throw new Error("Installer trust-fault raw telemetry text exceeds its bound");
    }
    if (
      /(?:\b(?:file|https?):\/\/|\b[A-Za-z]:[\\/]|(?:^|[^A-Za-z0-9_<>])(?:\\\\|\/\/)|\b(?:authorization|bearer|token|secret|password|credential|api[_-]?key)\b)/iu.test(
        clean,
      )
    ) {
      return "<redacted>";
    }
    return clean;
  }
  if (Array.isArray(input)) {
    if (input.length > 512)
      throw new Error("Installer trust-fault raw telemetry array is oversized");
    return input.map((entry) => sanitizeRawValue(entry, depth + 1, budget));
  }
  if (typeof input !== "object") {
    throw new Error("Installer trust-fault raw telemetry contains an unsupported value");
  }
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(input as Record<string, unknown>).sort()) {
    if (key.length > 128) throw new Error("Installer trust-fault raw telemetry key is oversized");
    output[key] = sanitizeRawValue((input as Record<string, unknown>)[key], depth + 1, budget);
  }
  return output;
}

function tryParseRejectedObservation(input: unknown): InstallerTrustFaultRawObservation | null {
  try {
    const recordInput = input as { transition?: { order?: unknown } };
    const order = recordInput?.transition?.order;
    return Number.isSafeInteger(order) && (order as number) > 0
      ? parseRawObservation(input, order as number)
      : null;
  } catch {
    return null;
  }
}

function createRejectedSample(
  input: unknown,
  observation: InstallerTrustFaultRawObservation | null,
  detail: string,
  availableBytes = INSTALLER_TRUST_FAULT_MAX_REJECTED_RAW_SAMPLE_BYTES,
): InstallerTrustFaultRejectedRawObservationSample {
  let projection: InstallerTrustFaultRejectedRawObservationSample["projection"];
  try {
    projection = Object.freeze({
      keys:
        typeof input === "object" && input !== null && !Array.isArray(input)
          ? Object.freeze(
              Object.keys(input as Record<string, unknown>)
                .sort()
                .slice(0, 16)
                .map(safeProjectionKey),
            )
          : Object.freeze([]),
      kind:
        input === null
          ? "null"
          : Array.isArray(input)
            ? "array"
            : typeof input === "object"
              ? "object"
              : "primitive",
    });
  } catch {
    projection = Object.freeze({ keys: Object.freeze([]), kind: "unreadable" });
  }
  const safeDetail = detail.slice(0, 64);
  const sourceDigestSha256 = digestUnknown(input);
  const create = (
    retainedObservation: InstallerTrustFaultRawObservation | null,
    retainedDetail: string,
  ): InstallerTrustFaultRejectedRawObservationSample => {
    const digestPayload = JSON.stringify({
      detail: retainedDetail,
      observation: retainedObservation,
      projection,
      sourceDigestSha256,
    });
    return Object.freeze({
      detail: retainedDetail,
      digestSha256: createHash("sha256").update(digestPayload).digest("hex"),
      observation: retainedObservation,
      projection,
      sourceDigestSha256,
    });
  };
  const full = create(observation, safeDetail);
  if (
    Buffer.byteLength(JSON.stringify(full), "utf8") <=
    Math.min(availableBytes, INSTALLER_TRUST_FAULT_MAX_REJECTED_RAW_SAMPLE_BYTES)
  ) {
    return full;
  }
  return create(null, "observation-parse");
}

function isRawObservationEnvelopeCandidate(input: unknown): boolean {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  try {
    return Object.hasOwn(input, "transition");
  } catch {
    return false;
  }
}

function safeProjectionKey(key: string): string {
  return /^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(key) &&
    !/(?:authorization|bearer|token|secret|password|credential|api[_-]?key)/iu.test(key)
    ? key
    : "<redacted-key>";
}

function parseRejectedSample(input: unknown): InstallerTrustFaultRejectedRawObservationSample {
  const sample = record(input, "rejected raw observation sample");
  exact(sample, ["detail", "digestSha256", "observation", "projection", "sourceDigestSha256"]);
  const projection = record(sample.projection, "rejected raw observation projection");
  exact(projection, ["keys", "kind"]);
  if (
    typeof sample.detail !== "string" ||
    sample.detail.length > 64 ||
    typeof sample.digestSha256 !== "string" ||
    !SHA256.test(sample.digestSha256) ||
    typeof sample.sourceDigestSha256 !== "string" ||
    !SHA256.test(sample.sourceDigestSha256) ||
    !Array.isArray(projection.keys) ||
    projection.keys.length > 16 ||
    projection.keys.some((key) => typeof key !== "string" || key.length > 128) ||
    !["array", "null", "object", "primitive", "unreadable"].includes(String(projection.kind))
  ) {
    throw new Error("Installer trust-fault rejected raw observation sample is invalid");
  }
  const observation =
    sample.observation === null
      ? null
      : parseRawObservation(
          sample.observation,
          record(record(sample.observation, "rejected observation").transition, "transition")
            .order as number,
          true,
        );
  const parsed = Object.freeze({
    detail: sample.detail,
    digestSha256: sample.digestSha256,
    observation,
    projection: Object.freeze({
      keys: Object.freeze([...projection.keys] as string[]),
      kind: projection.kind,
    }),
    sourceDigestSha256: sample.sourceDigestSha256,
  }) as InstallerTrustFaultRejectedRawObservationSample;
  if (
    parsed.digestSha256 !==
    createHash("sha256")
      .update(
        JSON.stringify({
          detail: parsed.detail,
          observation: parsed.observation,
          projection: parsed.projection,
          sourceDigestSha256: parsed.sourceDigestSha256,
        }),
      )
      .digest("hex")
  ) {
    throw new Error("Installer trust-fault rejected raw observation digest is invalid");
  }
  return parsed;
}

function digestUnknown(input: unknown): string {
  const hash = createHash("sha256");
  const seen = new WeakSet<object>();
  let nodes = 0;
  const visit = (value: unknown, depth: number): void => {
    if (depth > 16 || nodes++ > 4_096) {
      hash.update("<bound>");
      return;
    }
    if (typeof value !== "object" || value === null) {
      hash.update(`${typeof value}:`);
      hash.update(typeof value === "string" ? value : String(value));
      return;
    }
    if (seen.has(value)) {
      hash.update("<cycle>");
      return;
    }
    seen.add(value);
    try {
      const candidate = value as Record<string, unknown>;
      const keys = Array.isArray(value) ? Object.keys(value) : Object.keys(candidate).sort();
      for (const key of keys.slice(0, 512)) {
        hash.update(key);
        try {
          visit(candidate[key], depth + 1);
        } catch {
          hash.update("<unreadable>");
        }
      }
      if (keys.length > 512) hash.update(`<truncated:${keys.length}>`);
    } catch {
      hash.update("<unreadable-object>");
    }
  };
  visit(input, 0);
  return hash.digest("hex");
}

function deriveRejectedPredicate(
  sample: InstallerTrustFaultRejectedRawObservationSample,
  accepted: readonly InstallerTrustFaultRawObservation[],
  id: InstallerTrustFaultCellId,
  authority: InstallerTrustFaultAuthority,
  faultResourceId: string,
): InstallerTrustFaultRawFailurePredicate {
  if (sample.observation === null) return "observation-parse";
  if (sample.observation.transition.order !== accepted.length + 1) return "observation-order";
  try {
    validateRawObservationConsistency(sample.observation);
  } catch {
    return "observation-consistency";
  }
  if (
    accepted.length >= INSTALLER_TRUST_FAULT_MAX_RAW_OBSERVATIONS ||
    serializedAcceptedRawBytes([...accepted, sample.observation]) >
      INSTALLER_TRUST_FAULT_MAX_ACCEPTED_RAW_BYTES
  ) {
    return "observation-bound";
  }
  try {
    validateRawTelemetrySafety(
      sample.observation.telemetry,
      sample.observation.transition,
      id,
      authority,
      faultResourceId,
    );
    validateHistoricalRawOnlineStructure(
      sample.observation.transition,
      accepted.at(-1)?.transition ?? null,
      id,
      authority,
      faultResourceId,
    );
  } catch {
    return "cell-invariant";
  }
  throw new Error("Installer trust-fault rejected raw observation satisfies all invariants");
}

function deriveRejectedPredicateV3(
  sample: InstallerTrustFaultRejectedRawObservationSample,
  acceptedObservationCount: number,
  previous: InstallerTrustFaultRawObservation | null,
  id: InstallerTrustFaultCellId,
  authority: InstallerTrustFaultAuthority,
  faultResourceId: string,
  targetSemantics: PriorAttemptTransferTargetSemantics = "current-exact-target",
): InstallerTrustFaultRawFailurePredicate {
  if (sample.observation === null) return "observation-parse";
  if (sample.observation.transition.order !== acceptedObservationCount + 1) {
    return "observation-order";
  }
  if (acceptedObservationCount >= INSTALLER_TRUST_FAULT_MAX_RAW_OBSERVATIONS) {
    return "observation-bound";
  }
  try {
    validateRawDiagnosticStructure(
      sample.observation.transition,
      previous?.transition ?? null,
      id,
      authority,
      faultResourceId,
    );
  } catch {
    return "cell-invariant";
  }
  try {
    validateRawTelemetrySafety(
      sample.observation.telemetry,
      sample.observation.transition,
      id,
      authority,
      faultResourceId,
      targetSemantics,
    );
  } catch {
    return "cell-invariant";
  }
  try {
    validateRawObservationConsistency(sample.observation);
  } catch {
    return "observation-consistency";
  }
  try {
    validateInstallerTrustFaultCellPhaseOutcome(
      sample.observation.transition,
      previous?.transition ?? null,
      id,
      authority,
      faultResourceId,
    );
    validateEstimateBarrierTransition(
      sample.observation.transition,
      previous?.transition ?? null,
      id,
    );
  } catch {
    return "cell-invariant";
  }
  throw new Error("Installer trust-fault rejected raw observation satisfies all invariants");
}

function rawEvidenceBytes(
  accepted: readonly InstallerTrustFaultRawObservation[],
  rejected: InstallerTrustFaultRejectedRawObservationSample,
): number {
  return Buffer.byteLength(JSON.stringify({ accepted, rejected }), "utf8");
}

function rawEvidenceBytesV3(
  prefix: readonly InstallerTrustFaultRawObservation[],
  tail: readonly InstallerTrustFaultRawObservation[],
  rejected: InstallerTrustFaultRejectedRawObservationSample,
): number {
  return Buffer.byteLength(
    JSON.stringify({
      acceptedObservationPrefix: prefix,
      acceptedObservationTail: tail,
      rejectedSample: rejected,
    }),
    "utf8",
  );
}

function digestRetainedRawObservations(
  prefix: readonly InstallerTrustFaultRawObservation[],
  tail: readonly InstallerTrustFaultRawObservation[],
): string {
  return createHash("sha256").update(JSON.stringify({ prefix, tail })).digest("hex");
}

function digestBarrierWitnesses(
  witnesses: readonly InstallerTrustFaultProofBarrierWitness[],
): string {
  return createHash("sha256").update(JSON.stringify(witnesses)).digest("hex");
}

function validateBarrierWitnesses(
  input: unknown,
  digestInput: unknown,
  phases: readonly InstallerTrustFaultProofPhase[],
  requirePhaseFinalBarriers: boolean,
): void {
  if (!Array.isArray(input) || input.length !== phases.length) {
    throw new Error("Installer trust-fault transition proof barrier witnesses are incomplete");
  }
  const witnesses = input.map((candidate, index) => {
    const witness = record(candidate, `transition proof barrier witness ${index}`);
    exact(witness, ["barrierCount", "finalBarrierOrder", "phase"]);
    const phase = phases[index];
    const validActive =
      positiveInteger(witness.barrierCount) &&
      positiveInteger(witness.finalBarrierOrder) &&
      witness.finalBarrierOrder === phase?.lastOrder;
    const validLegacy = witness.barrierCount === 0 && witness.finalBarrierOrder === 0;
    if (
      phase === undefined ||
      witness.phase !== phase.phase ||
      (requirePhaseFinalBarriers ? !validActive : !validActive && !validLegacy)
    ) {
      throw new Error("Installer trust-fault transition proof phase-final barrier is invalid");
    }
    return Object.freeze({
      barrierCount: witness.barrierCount as number,
      finalBarrierOrder: witness.finalBarrierOrder as number,
      phase: witness.phase as InstallerTrustFaultTransition["phase"],
    });
  });
  if (
    typeof digestInput !== "string" ||
    !SHA256.test(digestInput) ||
    digestInput !== digestBarrierWitnesses(witnesses)
  ) {
    throw new Error("Installer trust-fault transition proof barrier binding is invalid");
  }
}

function updateRawObservationStreamHash(
  hash: Hash,
  observation: InstallerTrustFaultRawObservation,
): void {
  hash.update(`${JSON.stringify(observation)}\n`, "utf8");
}

function digestRawObservationStream(
  observations: readonly InstallerTrustFaultRawObservation[],
): string {
  const hash = createHash("sha256");
  for (const observation of observations) updateRawObservationStreamHash(hash, observation);
  return hash.digest("hex");
}

function serializedAcceptedRawBytes(
  accepted: readonly InstallerTrustFaultRawObservation[],
): number {
  return Buffer.byteLength(JSON.stringify(accepted), "utf8");
}

function parseRawAuthority(input: unknown): InstallerTrustFaultAuthority {
  const value = record(input, "raw observation authority");
  exact(value, ["artifactDigest", "releaseDigest"]);
  if (
    typeof value.artifactDigest !== "string" ||
    !SHA256.test(value.artifactDigest) ||
    typeof value.releaseDigest !== "string" ||
    !SHA256.test(value.releaseDigest)
  ) {
    throw new Error("Installer trust-fault raw observation authority is invalid");
  }
  return value as unknown as InstallerTrustFaultAuthority;
}

export function validateInstallerTrustFaultTransitionProof(
  input: unknown,
  id: InstallerTrustFaultCellId,
  authority: InstallerTrustFaultAuthority,
  faultResourceId: string,
  expectedSchemaVersion:
    | typeof INSTALLER_TRUST_FAULT_TRANSITION_PROOF_LEGACY_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULT_TRANSITION_PROOF_PREVIOUS_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULT_TRANSITION_PROOF_SCHEMA_VERSION
    | undefined = undefined,
  verdictMode: InstallerTrustFaultProofVerdictMode = "expected",
): InstallerTrustFaultTransitionProofEvidence {
  const schemaVersion =
    expectedSchemaVersion ??
    (record(input, "transition proof").schemaVersion ===
    INSTALLER_TRUST_FAULT_TRANSITION_PROOF_PREVIOUS_SCHEMA_VERSION
      ? INSTALLER_TRUST_FAULT_TRANSITION_PROOF_PREVIOUS_SCHEMA_VERSION
      : INSTALLER_TRUST_FAULT_TRANSITION_PROOF_SCHEMA_VERSION);
  return validateTransitionProof(
    input,
    id,
    authority,
    faultResourceId,
    schemaVersion,
    verdictMode,
    "legacy-closed-world",
  );
}

/** Validates an active raw-capture aggregate without reintroducing the legacy event topology. */
export function validateInstallerTrustFaultRawTransitionProof(
  input: unknown,
  id: InstallerTrustFaultCellId,
  authority: InstallerTrustFaultAuthority,
  faultResourceId: string,
  expectedSchemaVersion:
    | typeof INSTALLER_TRUST_FAULT_TRANSITION_PROOF_PREVIOUS_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULT_TRANSITION_PROOF_SCHEMA_VERSION = INSTALLER_TRUST_FAULT_TRANSITION_PROOF_SCHEMA_VERSION,
): InstallerTrustFaultTransitionProofEvidence {
  return validateTransitionProof(
    input,
    id,
    authority,
    faultResourceId,
    expectedSchemaVersion,
    "expected",
    "active-raw",
  );
}

function validateTransitionProof(
  input: unknown,
  id: InstallerTrustFaultCellId,
  authority: InstallerTrustFaultAuthority,
  faultResourceId: string,
  expectedSchemaVersion:
    | typeof INSTALLER_TRUST_FAULT_TRANSITION_PROOF_LEGACY_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULT_TRANSITION_PROOF_PREVIOUS_SCHEMA_VERSION
    | typeof INSTALLER_TRUST_FAULT_TRANSITION_PROOF_SCHEMA_VERSION,
  verdictMode: InstallerTrustFaultProofVerdictMode,
  semantics: "active-raw" | "legacy-closed-world",
): InstallerTrustFaultTransitionProofEvidence {
  const proof = record(input, "transition proof");
  const commonKeys = [
    "contract",
    "dimensionChangeCounts",
    "edges",
    "finalStateId",
    "firstOrder",
    "initialStateId",
    "lastOrder",
    "phases",
    "rawObservationCount",
    "schemaVersion",
    "states",
    "streamSha256",
  ] as const;
  exact(
    proof,
    expectedSchemaVersion === INSTALLER_TRUST_FAULT_TRANSITION_PROOF_SCHEMA_VERSION
      ? [...commonKeys, "barrierWitnesses", "barrierWitnessesSha256", "gaps"]
      : expectedSchemaVersion === INSTALLER_TRUST_FAULT_TRANSITION_PROOF_PREVIOUS_SCHEMA_VERSION
        ? [...commonKeys, "gaps"]
        : commonKeys,
  );
  if (
    proof.contract !== INSTALLER_TRUST_FAULT_TRANSITION_PROOF_CONTRACT ||
    proof.schemaVersion !== expectedSchemaVersion ||
    !positiveInteger(proof.rawObservationCount) ||
    proof.rawObservationCount < 2 ||
    proof.firstOrder !== 1 ||
    proof.lastOrder !== proof.rawObservationCount ||
    // The aggregate has no raw stream from which to recompute this opaque commitment.
    // Independent validation therefore checks its syntax only; live capture computes it.
    typeof proof.streamSha256 !== "string" ||
    !SHA256.test(proof.streamSha256) ||
    !Array.isArray(proof.states) ||
    proof.states.length < 2 ||
    proof.states.length > INSTALLER_TRUST_FAULT_MAX_PROOF_STATES ||
    !Array.isArray(proof.edges) ||
    proof.edges.length < 1 ||
    proof.edges.length > INSTALLER_TRUST_FAULT_MAX_PROOF_EDGES ||
    !Array.isArray(proof.phases) ||
    proof.phases.length < 2 ||
    proof.phases.length > INSTALLER_TRUST_FAULT_MAX_PROOF_PHASES
  ) {
    throw new Error("Installer trust-fault transition proof envelope is invalid");
  }

  const states = proof.states.map((inputState, index) => {
    const state = record(inputState, `transition proof state ${index}`);
    exact(state, [...DIMENSIONS, "firstOrder", "id"]);
    if (state.id !== index + 1 || !positiveInteger(state.firstOrder)) {
      throw new Error("Installer trust-fault transition proof state identity is invalid");
    }
    const { firstOrder, id: _stateId, ...dimensions } = state;
    const transition = validateInstallerTrustFaultTransitionObservation(
      { ...dimensions, order: firstOrder },
      firstOrder as number,
    );
    validateAuthorityDimensions(transition, authority, faultResourceId);
    return Object.freeze({
      ...withoutOrder(transition),
      firstOrder: state.firstOrder as number,
      id: state.id as number,
    });
  });
  if (new Set(states.map((state) => transitionStateKey(state))).size !== states.length) {
    throw new Error("Installer trust-fault transition proof states are duplicated");
  }
  if (
    new Set(states.map((state) => state.firstOrder)).size !== states.length ||
    states.some(
      (state, index) =>
        state.firstOrder > (proof.rawObservationCount as number) ||
        (index > 0 && state.firstOrder <= (states[index - 1]?.firstOrder ?? 0)),
    )
  ) {
    throw new Error("Installer trust-fault transition proof state orders are invalid");
  }

  const edges = proof.edges.map((inputEdge, index) => {
    const edge = record(inputEdge, `transition proof edge ${index}`);
    exact(edge, ["count", "firstOrder", "fromStateId", "id", "lastOrder", "toStateId"]);
    if (
      edge.id !== index + 1 ||
      !positiveInteger(edge.count) ||
      !positiveInteger(edge.firstOrder) ||
      !positiveInteger(edge.lastOrder) ||
      !positiveInteger(edge.fromStateId) ||
      !positiveInteger(edge.toStateId) ||
      edge.firstOrder < 2 ||
      edge.firstOrder > edge.lastOrder ||
      edge.lastOrder > (proof.rawObservationCount as number)
    ) {
      throw new Error("Installer trust-fault transition proof edge is invalid");
    }
    const from = states[(edge.fromStateId as number) - 1];
    const to = states[(edge.toStateId as number) - 1];
    if (from === undefined || to === undefined) {
      throw new Error("Installer trust-fault transition proof edge references an absent state");
    }
    const current = { ...to, order: edge.firstOrder as number };
    const previous = { ...from, order: (edge.firstOrder as number) - 1 };
    if (semantics === "active-raw") {
      validateRawDiagnosticStructure(current, previous, id, authority, faultResourceId);
    } else {
      validateOnlineObservation(current, previous, id, authority, faultResourceId, verdictMode);
    }
    return Object.freeze({
      count: edge.count as number,
      firstOrder: edge.firstOrder as number,
      fromStateId: edge.fromStateId as number,
      id: edge.id as number,
      lastOrder: edge.lastOrder as number,
      toStateId: edge.toStateId as number,
    });
  });
  if (
    new Set(edges.map((edge) => `${edge.fromStateId}:${edge.toStateId}`)).size !== edges.length ||
    new Set(edges.map((edge) => edge.firstOrder)).size !== edges.length ||
    edges.reduce((total, edge) => total + edge.count, 0) !==
      (proof.rawObservationCount as number) - 1
  ) {
    throw new Error("Installer trust-fault transition proof edge accounting is invalid");
  }
  if (states[0]?.firstOrder !== 1) {
    throw new Error("Installer trust-fault transition proof initial state occurrence is invalid");
  }
  if (semantics === "active-raw") {
    validateRawDiagnosticStructure(
      { ...(states[0] as InstallerTrustFaultProofState), order: 1 },
      null,
      id,
      authority,
      faultResourceId,
    );
  }
  validateInstallerTrustFaultProofTrailFeasibility(
    states,
    edges,
    proof.initialStateId,
    proof.finalStateId,
    proof.rawObservationCount as number,
  );
  if (expectedSchemaVersion !== INSTALLER_TRUST_FAULT_TRANSITION_PROOF_LEGACY_SCHEMA_VERSION) {
    validateInstallerTrustFaultProofGapWitness(
      proof.gaps,
      states,
      edges,
      proof.initialStateId as number,
      proof.finalStateId as number,
      proof.rawObservationCount as number,
    );
  }

  const expectedDimensionCounts = zeroDimensionCounts();
  for (const edge of edges) {
    const from = states[edge.fromStateId - 1] as InstallerTrustFaultProofState;
    const to = states[edge.toStateId - 1] as InstallerTrustFaultProofState;
    for (const dimension of DIMENSIONS) {
      if (from[dimension] !== to[dimension]) expectedDimensionCounts[dimension] += edge.count;
    }
  }
  validateDimensionCounts(proof.dimensionChangeCounts, expectedDimensionCounts);
  const phases = validatePhases(
    proof.phases,
    states,
    edges,
    proof.rawObservationCount as number,
    id,
  );
  const expectedPhases = expectedCellPhases(id);
  if (phases.map((phase) => phase.phase).join(",") !== expectedPhases.join(",")) {
    throw new Error("Installer trust-fault transition proof phases are incomplete or misordered");
  }
  if (expectedSchemaVersion === INSTALLER_TRUST_FAULT_TRANSITION_PROOF_SCHEMA_VERSION) {
    validateBarrierWitnesses(
      proof.barrierWitnesses,
      proof.barrierWitnessesSha256,
      phases,
      semantics === "active-raw",
    );
  }
  for (const phase of phases) {
    const phaseStates = states.filter((state) => state.phase === phase.phase);
    const terminal = states[phase.finalStateId - 1];
    if (terminal === undefined) {
      throw new Error("Installer trust-fault transition proof phase terminal is absent");
    }
    if (semantics === "active-raw") {
      const {
        firstOrder: _terminalFirstOrder,
        id: _terminalStateId,
        ...terminalDimensions
      } = terminal;
      const terminalTransition = {
        ...terminalDimensions,
        order: phase.lastOrder,
      };
      validateInstallerTrustFaultCellPhaseOutcome(
        terminalTransition,
        null,
        id,
        authority,
        faultResourceId,
      );
      validateEstimateBarrierTransition(terminalTransition, null, id);
    }
    if (phase.phase === "setup") {
      if (semantics === "active-raw") continue;
      if (
        phaseStates.some(
          (state) =>
            state.transferState === "ready" ||
            state.transferState === "failed" ||
            state.uiState === "ready" ||
            state.uiState === "failed" ||
            state.uiState === "repairing" ||
            state.failureCode !== null ||
            state.failureResourceId !== null,
        )
      ) {
        throw new Error("Installer trust-fault transition proof setup is not generic nonterminal");
      }
      continue;
    }
    if (
      semantics === "legacy-closed-world" &&
      (!phase.attemptMilestones.includes("planning") ||
        !phase.attemptMilestones.includes("probing-quota"))
    ) {
      throw new Error("Installer trust-fault transition proof omitted planning or quota probing");
    }
    const contractOutcome = expectedPhaseOutcome(id, phase.phase);
    const expectedOutcome =
      verdictMode === "allow-unexpected-terminal" &&
      phase.phase === expectedPhases.at(-1) &&
      (terminal.transferState === "failed" || terminal.transferState === "ready")
        ? terminal.transferState
        : contractOutcome;
    if (
      terminal.transferState !== expectedOutcome ||
      terminal.uiState !== expectedOutcome ||
      (expectedOutcome === "failed" && terminal.failureCode === null) ||
      (expectedOutcome === "ready" &&
        (terminal.failureCode !== null || terminal.failureResourceId !== null))
    ) {
      throw new Error("Installer trust-fault transition proof phase verdict is invalid");
    }
    if (semantics === "legacy-closed-world") {
      validatePhaseOperationSemantics(
        phase,
        phaseStates,
        edges,
        expectedOutcome,
        expectedOperationUiState(id, phase.phase),
        authority,
        id,
        faultResourceId,
        expectedOutcome !== contractOutcome,
      );
    }
  }
  if (
    proof.initialStateId !== 1 ||
    proof.finalStateId !== states.find((state) => state.id === proof.finalStateId)?.id ||
    phases[0]?.initialStateId !== proof.initialStateId ||
    phases.at(-1)?.finalStateId !== proof.finalStateId
  ) {
    throw new Error("Installer trust-fault transition proof endpoints are invalid");
  }
  validateTerminalVerdict(
    states[(proof.finalStateId as number) - 1] as InstallerTrustFaultProofState,
    id,
    authority,
    faultResourceId,
    verdictMode,
  );
  return input as InstallerTrustFaultTransitionProofEvidence;
}

export function validateInstallerTrustFaultProofTrailFeasibility(
  states: readonly InstallerTrustFaultProofState[],
  edges: readonly InstallerTrustFaultProofEdge[],
  initialStateIdInput: unknown,
  finalStateIdInput: unknown,
  rawObservationCount: number,
): void {
  if (
    !positiveInteger(initialStateIdInput) ||
    !positiveInteger(finalStateIdInput) ||
    states[initialStateIdInput - 1] === undefined ||
    states[finalStateIdInput - 1] === undefined
  ) {
    throw new Error("Installer trust-fault transition proof trail endpoints are invalid");
  }
  const initialStateId = initialStateIdInput;
  const finalStateId = finalStateIdInput;
  const incoming = new Array<number>(states.length).fill(0);
  const outgoing = new Array<number>(states.length).fill(0);
  const firstIncomingOrder = new Array<number>(states.length).fill(Number.POSITIVE_INFINITY);
  const support = new Map<number, Set<number>>();
  let previousFirstOrder = 1;
  const lastOrders = new Set<number>();
  for (const edge of edges) {
    const from = states[edge.fromStateId - 1] as InstallerTrustFaultProofState;
    const to = states[edge.toStateId - 1] as InstallerTrustFaultProofState;
    if (
      edge.firstOrder <= previousFirstOrder ||
      lastOrders.has(edge.lastOrder) ||
      (edge.count === 1
        ? edge.lastOrder !== edge.firstOrder
        : edge.lastOrder <= edge.firstOrder || edge.lastOrder - edge.firstOrder + 1 < edge.count) ||
      from.firstOrder >= edge.firstOrder ||
      to.firstOrder > edge.firstOrder
    ) {
      throw new Error(
        "Installer trust-fault transition proof edge occurrence claims are infeasible",
      );
    }
    previousFirstOrder = edge.firstOrder;
    lastOrders.add(edge.lastOrder);
    outgoing[edge.fromStateId - 1] = safeCountAdd(
      outgoing[edge.fromStateId - 1] as number,
      edge.count,
    );
    incoming[edge.toStateId - 1] = safeCountAdd(incoming[edge.toStateId - 1] as number, edge.count);
    firstIncomingOrder[edge.toStateId - 1] = Math.min(
      firstIncomingOrder[edge.toStateId - 1] as number,
      edge.firstOrder,
    );
    addSupport(support, edge.fromStateId, edge.toStateId);
    addSupport(support, edge.toStateId, edge.fromStateId);
  }
  if (
    edges[0]?.firstOrder !== 2 ||
    edges[0]?.fromStateId !== initialStateId ||
    !edges.some((edge) => edge.lastOrder === rawObservationCount && edge.toStateId === finalStateId)
  ) {
    throw new Error(
      "Installer trust-fault transition proof endpoint occurrence claims are invalid",
    );
  }
  for (const state of states) {
    const inCount = incoming[state.id - 1] as number;
    const outCount = outgoing[state.id - 1] as number;
    const expectedDelta =
      initialStateId === finalStateId
        ? 0
        : state.id === initialStateId
          ? 1
          : state.id === finalStateId
            ? -1
            : 0;
    if (inCount + outCount === 0 || outCount - inCount !== expectedDelta) {
      throw new Error("Installer trust-fault transition proof weighted flow is not a trail");
    }
    if (state.id > 1) {
      if (firstIncomingOrder[state.id - 1] !== state.firstOrder) {
        throw new Error(
          "Installer trust-fault transition proof state first occurrence is not minimal",
        );
      }
    }
  }
  const visited = new Set<number>();
  const pending = [initialStateId];
  while (pending.length > 0) {
    const stateId = pending.pop();
    if (stateId === undefined || visited.has(stateId)) continue;
    visited.add(stateId);
    for (const adjacent of support.get(stateId) ?? []) pending.push(adjacent);
  }
  if (visited.size !== states.length) {
    throw new Error("Installer trust-fault transition proof trail support is disconnected");
  }
  validateOccurrenceIntervalCapacity(edges, rawObservationCount);
}

function validateOccurrenceIntervalCapacity(
  edges: readonly InstallerTrustFaultProofEdge[],
  rawObservationCount: number,
): void {
  const byFirst = [...edges].sort((left, right) => left.firstOrder - right.firstOrder);
  let releasedCapacity = 0;
  for (const edge of byFirst) {
    if (releasedCapacity < edge.firstOrder - 2) {
      throw new Error(
        "Installer trust-fault transition proof first-occurrence capacity is infeasible",
      );
    }
    releasedCapacity = safeCountAdd(releasedCapacity, edge.count);
  }
  if (releasedCapacity !== rawObservationCount - 1) {
    throw new Error("Installer trust-fault transition proof occurrence capacity is invalid");
  }
  const byLast = [...edges].sort((left, right) => left.lastOrder - right.lastOrder);
  let deadlineDemand = 0;
  for (const edge of byLast) {
    deadlineDemand = safeCountAdd(deadlineDemand, edge.count);
    if (deadlineDemand > edge.lastOrder - 1) {
      throw new Error(
        "Installer trust-fault transition proof last-occurrence capacity is infeasible",
      );
    }
  }
}

interface ProofBoundary {
  readonly edge: InstallerTrustFaultProofEdge;
  readonly kind: "first" | "last";
  readonly order: number;
}

interface MutableProofBoundary extends ProofBoundary {
  readonly countsAfter: readonly number[];
}

function buildProofGaps(edges: readonly MutableEdge[]): readonly InstallerTrustFaultProofGap[] {
  const boundaries: MutableProofBoundary[] = [];
  for (const edge of edges) {
    boundaries.push({
      countsAfter: edge.firstCountsAfter,
      edge,
      kind: "first",
      order: edge.firstOrder,
    });
    if (edge.lastOrder !== edge.firstOrder) {
      boundaries.push({
        countsAfter: edge.lastCountsAfter,
        edge,
        kind: "last",
        order: edge.lastOrder,
      });
    }
  }
  boundaries.sort((left, right) => left.order - right.order);
  return Object.freeze(
    boundaries.slice(1).map((current, index) => {
      const previous = boundaries[index];
      if (previous === undefined || current.order <= previous.order) {
        throw new Error("Installer trust-fault proof boundary capture is contradictory");
      }
      const edgeCounts: Array<Readonly<{ count: number; edgeId: number }>> = [];
      for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
        const currentAfter = current.countsAfter[edgeIndex] ?? 0;
        const currentBefore = currentAfter - (current.edge.id === edgeIndex + 1 ? 1 : 0);
        const previousAfter = previous.countsAfter[edgeIndex] ?? 0;
        const count = currentBefore - previousAfter;
        if (!Number.isSafeInteger(count) || count < 0) {
          throw new Error("Installer trust-fault proof boundary counts are contradictory");
        }
        if (count > 0) edgeCounts.push(Object.freeze({ count, edgeId: edgeIndex + 1 }));
      }
      return Object.freeze({
        afterOrder: previous.order,
        beforeOrder: current.order,
        edgeCounts: Object.freeze(edgeCounts),
      });
    }),
  );
}

/**
 * Validates a bounded constructive ordering witness. Each explicit boundary is one
 * edge's first or last occurrence; each intervening sparse weighted graph proves an
 * Euler subtrail between adjacent boundaries. This proves existence of a stream with
 * the aggregate boundary claims. It deliberately does not reconstruct, or claim to
 * authenticate, the live raw stream committed by streamSha256.
 */
export function validateInstallerTrustFaultProofGapWitness(
  input: unknown,
  states: readonly InstallerTrustFaultProofState[],
  edges: readonly InstallerTrustFaultProofEdge[],
  initialStateId: number,
  finalStateId: number,
  rawObservationCount: number,
): void {
  if (!Array.isArray(input)) {
    throw new Error("Installer trust-fault transition proof gaps are invalid");
  }
  const boundaries: ProofBoundary[] = [];
  for (const edge of edges) {
    boundaries.push({ edge, kind: "first", order: edge.firstOrder });
    if (edge.lastOrder !== edge.firstOrder) {
      boundaries.push({ edge, kind: "last", order: edge.lastOrder });
    }
  }
  boundaries.sort((left, right) => left.order - right.order);
  if (
    boundaries.length === 0 ||
    input.length !== boundaries.length - 1 ||
    boundaries[0]?.order !== 2 ||
    boundaries[0]?.edge.fromStateId !== initialStateId ||
    boundaries.at(-1)?.order !== rawObservationCount ||
    boundaries.at(-1)?.edge.toStateId !== finalStateId ||
    boundaries.some(
      (boundary, index) => index > 0 && boundary.order <= (boundaries[index - 1]?.order ?? 0),
    )
  ) {
    throw new Error("Installer trust-fault transition proof boundary witness is invalid");
  }

  const occurrenceCounts = new Array<number>(edges.length).fill(0);
  for (const boundary of boundaries) {
    occurrenceCounts[boundary.edge.id - 1] = safeCountAdd(
      occurrenceCounts[boundary.edge.id - 1] as number,
      1,
    );
  }
  for (let gapIndex = 0; gapIndex < input.length; gapIndex += 1) {
    const previous = boundaries[gapIndex];
    const current = boundaries[gapIndex + 1];
    if (previous === undefined || current === undefined) {
      throw new Error("Installer trust-fault transition proof gap boundary is absent");
    }
    const gap = record(input[gapIndex], `transition proof gap ${gapIndex}`);
    exact(gap, ["afterOrder", "beforeOrder", "edgeCounts"]);
    if (
      gap.afterOrder !== previous.order ||
      gap.beforeOrder !== current.order ||
      !Array.isArray(gap.edgeCounts) ||
      gap.edgeCounts.length > edges.length
    ) {
      throw new Error("Installer trust-fault transition proof gap identity is invalid");
    }
    let previousEdgeId = 0;
    let gapCount = 0;
    const weighted: Array<Readonly<{ count: number; edge: InstallerTrustFaultProofEdge }>> = [];
    for (const inputCount of gap.edgeCounts) {
      const edgeCount = record(inputCount, `transition proof gap ${gapIndex} edge count`);
      exact(edgeCount, ["count", "edgeId"]);
      if (
        !positiveInteger(edgeCount.count) ||
        !positiveInteger(edgeCount.edgeId) ||
        edgeCount.edgeId <= previousEdgeId
      ) {
        throw new Error("Installer trust-fault transition proof gap count is invalid");
      }
      const edge = edges[edgeCount.edgeId - 1];
      if (
        edge === undefined ||
        edge.firstOrder > previous.order ||
        edge.lastOrder < current.order
      ) {
        throw new Error("Installer trust-fault transition proof gap crosses an edge boundary");
      }
      previousEdgeId = edgeCount.edgeId;
      gapCount = safeCountAdd(gapCount, edgeCount.count);
      occurrenceCounts[edge.id - 1] = safeCountAdd(
        occurrenceCounts[edge.id - 1] as number,
        edgeCount.count,
      );
      weighted.push(Object.freeze({ count: edgeCount.count, edge }));
    }
    if (gapCount !== current.order - previous.order - 1) {
      throw new Error("Installer trust-fault transition proof gap length is invalid");
    }
    validateWeightedGapTrail(
      weighted,
      states.length,
      previous.edge.toStateId,
      current.edge.fromStateId,
    );
  }
  if (occurrenceCounts.some((count, index) => count !== edges[index]?.count)) {
    throw new Error("Installer trust-fault transition proof gap accounting is invalid");
  }
}

function validateWeightedGapTrail(
  weighted: readonly Readonly<{
    readonly count: number;
    readonly edge: InstallerTrustFaultProofEdge;
  }>[],
  stateCount: number,
  initialStateId: number,
  finalStateId: number,
): void {
  if (weighted.length === 0) {
    if (initialStateId !== finalStateId) {
      throw new Error("Installer trust-fault transition proof empty gap is not connected");
    }
    return;
  }
  const incoming = new Map<number, number>();
  const outgoing = new Map<number, number>();
  const support = new Map<number, Set<number>>();
  const active = new Set<number>();
  for (const { count, edge } of weighted) {
    if (
      edge.fromStateId < 1 ||
      edge.fromStateId > stateCount ||
      edge.toStateId < 1 ||
      edge.toStateId > stateCount
    ) {
      throw new Error("Installer trust-fault transition proof gap state is absent");
    }
    outgoing.set(edge.fromStateId, safeCountAdd(outgoing.get(edge.fromStateId) ?? 0, count));
    incoming.set(edge.toStateId, safeCountAdd(incoming.get(edge.toStateId) ?? 0, count));
    active.add(edge.fromStateId);
    active.add(edge.toStateId);
    addSupport(support, edge.fromStateId, edge.toStateId);
    addSupport(support, edge.toStateId, edge.fromStateId);
  }
  for (const stateId of active) {
    const expectedDelta =
      initialStateId === finalStateId
        ? 0
        : stateId === initialStateId
          ? 1
          : stateId === finalStateId
            ? -1
            : 0;
    if ((outgoing.get(stateId) ?? 0) - (incoming.get(stateId) ?? 0) !== expectedDelta) {
      throw new Error("Installer trust-fault transition proof gap flow is not a trail");
    }
  }
  if (!active.has(initialStateId) || !active.has(finalStateId)) {
    throw new Error("Installer trust-fault transition proof gap endpoints are absent");
  }
  const visited = new Set<number>();
  const pending = [initialStateId];
  while (pending.length > 0) {
    const stateId = pending.pop();
    if (stateId === undefined || visited.has(stateId)) continue;
    visited.add(stateId);
    for (const adjacent of support.get(stateId) ?? []) pending.push(adjacent);
  }
  if ([...active].some((stateId) => !visited.has(stateId))) {
    throw new Error("Installer trust-fault transition proof gap support is disconnected");
  }
}

function safeCountAdd(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    throw new Error("Installer trust-fault transition proof count exceeds safe integer range");
  }
  return total;
}

function addSupport(support: Map<number, Set<number>>, from: number, to: number): void {
  const adjacent = support.get(from) ?? new Set<number>();
  adjacent.add(to);
  support.set(from, adjacent);
}

function expectedPhaseOutcome(
  id: InstallerTrustFaultCellId,
  phase: InstallerTrustFaultTransition["phase"],
): "failed" | "ready" {
  if (phase === "seed" || phase === "attempt-2") return "ready";
  return id === "repeated-server-corruption" ||
    id === "estimate-clearly-insufficient" ||
    id === "quota-probe-exceeded" ||
    (id === "mid-append-quota-resume" && phase === "attempt-1")
    ? "failed"
    : "ready";
}

function validatePhaseOperationSemantics(
  phase: InstallerTrustFaultProofPhase,
  states: readonly InstallerTrustFaultProofState[],
  edges: readonly InstallerTrustFaultProofEdge[],
  outcome: "failed" | "ready",
  operationUiState: "installing" | "repairing",
  authority: InstallerTrustFaultAuthority,
  id: InstallerTrustFaultCellId,
  faultResourceId: string,
  unexpectedOutcome: boolean,
): void {
  validateRetainedRepairReadyPrelude(phase, states, edges, operationUiState, authority);
  const initial = states.find((state) => state.id === phase.initialStateId);
  const expectedRepairFailure = !unexpectedOutcome && isExpectedRepairFailurePhase(id, phase.phase);
  if (
    expectedRepairFailure &&
    (initial === undefined || !isRetainedRepairReadyPrelude(initial, authority))
  ) {
    throw new Error(
      "Installer trust-fault transition proof repair failure initial Ready boundary is invalid",
    );
  }
  const terminalStates = states
    .filter((state) => state.transferState === outcome)
    .sort((left, right) => left.firstOrder - right.firstOrder);
  if (
    !states.some((state) => state.uiState === operationUiState) ||
    (phase.phase === "seed" && states.some((state) => state.uiState === "repairing")) ||
    states.some(
      (state) =>
        state.transferState !== "failed" &&
        state.transferState !== "ready" &&
        (state.failureCode !== null ||
          state.failureResourceId !== null ||
          state.uiState === "failed" ||
          state.uiState === "ready"),
    )
  ) {
    throw new Error("Installer trust-fault transition proof operation prelude is invalid");
  }
  if (outcome === "failed") {
    const stateById = new Map(states.map((state) => [state.id, state] as const));
    const expectedFailure = expectedPhaseFailure(id, phase.phase, faultResourceId);
    const reachedCurrentReady = edges.some((edge) => {
      const from = stateById.get(edge.fromStateId);
      const to = stateById.get(edge.toStateId);
      return (
        from !== undefined &&
        to !== undefined &&
        from.transferState !== "ready" &&
        to.transferState === "ready"
      );
    });
    if (
      (!unexpectedOutcome &&
        !expectedRepairFailure &&
        states.some((state) => state.transferState === "verifying")) ||
      reachedCurrentReady ||
      terminalStates.length === 0 ||
      terminalStates.some(
        (state) =>
          state.uiState !== "failed" ||
          state.failureCode === null ||
          state.failureCode !== terminalStates[0]?.failureCode ||
          state.failureResourceId !== terminalStates[0]?.failureResourceId ||
          (!unexpectedOutcome &&
            (state.failureCode !== expectedFailure.code ||
              state.failureResourceId !== expectedFailure.resourceId)),
      )
    ) {
      throw new Error("Installer trust-fault transition proof failure progression is invalid");
    }
    if (
      !unexpectedOutcome &&
      id === "estimate-clearly-insufficient" &&
      phase.phase === "attempt-1" &&
      estimateClearlyInsufficientFinalizationFailedPredicate(phase, states, edges) !== null
    ) {
      throw new Error(
        "Installer trust-fault transition proof estimate-insufficient terminal is invalid",
      );
    }
    if (
      expectedRepairFailure &&
      (JSON.stringify(phase.attemptMilestones) !==
        JSON.stringify([
          "ready",
          "waiting-lock",
          "planning",
          "probing-quota",
          "transferring",
          "verifying",
          "failed",
        ]) ||
        !hasRepairVerificationInvariant(states, terminalStates, authority) ||
        terminalStates.some(
          (state) =>
            state.storeState !== "failed" ||
            state.activeReleaseDigest !== null ||
            state.releaseDigest !== null ||
            state.shellGenerationId !== null,
        ))
    ) {
      throw new Error(
        "Installer trust-fault transition proof repair failure progression is invalid",
      );
    }
    return;
  }
  const generationId = `${authority.artifactDigest}:${authority.releaseDigest}`;
  if (
    terminalStates.length === 0 ||
    !states.some((state) => state.transferState === "transferring") ||
    !states.some((state) => state.transferState === "verifying") ||
    !terminalStates.some((state) => state.uiState === operationUiState) ||
    terminalStates.some(
      (state) =>
        state.storeState !== "ready" ||
        state.activeReleaseDigest !== authority.releaseDigest ||
        state.failureCode !== null ||
        state.failureResourceId !== null ||
        (state.uiState !== operationUiState &&
          state.uiState !== "ready" &&
          !isRetainedRepairReadyPrelude(state, authority)) ||
        (state.uiState === operationUiState &&
          (operationUiState === "installing"
            ? state.releaseDigest !== null || state.shellGenerationId !== null
            : state.releaseDigest !== authority.releaseDigest ||
              state.shellGenerationId !== generationId)),
    ) ||
    !terminalStates.some((state) => state.uiState === "ready")
  ) {
    throw new Error("Installer trust-fault transition proof success progression is invalid");
  }
}

function isEstimateClearlyInsufficientInitialPersistenceState(state: TransitionState): boolean {
  return isEstimateClearlyInsufficientPreludeState(state, "idle", "requesting-persistence");
}

function isEstimateClearlyInsufficientInstallingState(state: TransitionState): boolean {
  return isEstimateClearlyInsufficientPreludeState(state, "idle", "installing");
}

function isEstimateClearlyInsufficientWaitingLockState(state: TransitionState): boolean {
  return isEstimateClearlyInsufficientPreludeState(state, "waiting-lock", "installing");
}

function isEstimateClearlyInsufficientPlanningState(state: TransitionState): boolean {
  return isEstimateClearlyInsufficientPreludeState(state, "planning", "installing");
}

function isEstimateClearlyInsufficientPredecessorState(state: TransitionState): boolean {
  return isEstimateClearlyInsufficientPreludeState(state, "probing-quota", "installing");
}

function isEstimateClearlyInsufficientPreludeState(
  state: TransitionState,
  transferState: "idle" | "planning" | "probing-quota" | "waiting-lock",
  uiState: "installing" | "requesting-persistence",
): boolean {
  return (
    state.phase === "attempt-1" &&
    state.storeState === "idle" &&
    state.transferState === transferState &&
    state.uiState === uiState &&
    state.failureCode === null &&
    state.failureResourceId === null &&
    state.activeReleaseDigest === null &&
    state.releaseDigest === null &&
    state.shellGenerationId === null
  );
}

function isEstimateClearlyInsufficientTerminalState(state: TransitionState): boolean {
  return (
    state.phase === "attempt-1" &&
    state.storeState === "idle" &&
    state.transferState === "failed" &&
    state.uiState === "failed" &&
    state.failureCode === "quota" &&
    state.failureResourceId === null &&
    state.activeReleaseDigest === null &&
    state.releaseDigest === null &&
    state.shellGenerationId === null
  );
}

function estimateClearlyInsufficientFinalizationFailedPredicate(
  phase: InstallerTrustFaultProofPhase,
  states: readonly InstallerTrustFaultProofState[],
  edges: readonly InstallerTrustFaultProofEdge[],
): InstallerTrustFaultEstimateFinalizationFailedPredicate | null {
  if (
    JSON.stringify(phase.attemptMilestones) !==
    JSON.stringify(["idle", "waiting-lock", "planning", "probing-quota", "failed"])
  ) {
    return "attempt-milestones";
  }
  const normalizedStates = states.map((state) => normalizeEstimateStorePulse(state));
  const initialPersistence = normalizedStates.filter(
    isEstimateClearlyInsufficientInitialPersistenceState,
  );
  const installing = normalizedStates.filter(isEstimateClearlyInsufficientInstallingState);
  const waitingLock = normalizedStates.filter(isEstimateClearlyInsufficientWaitingLockState);
  const planning = normalizedStates.filter(isEstimateClearlyInsufficientPlanningState);
  const probingQuota = normalizedStates.filter(isEstimateClearlyInsufficientPredecessorState);
  const terminals = states.filter(isEstimateClearlyInsufficientTerminalState);
  const initial = initialPersistence.sort((left, right) => left.firstOrder - right.firstOrder)[0];
  const installingState = installing.sort((left, right) => left.firstOrder - right.firstOrder)[0];
  const waiting = waitingLock.sort((left, right) => left.firstOrder - right.firstOrder)[0];
  const planningState = planning.sort((left, right) => left.firstOrder - right.firstOrder)[0];
  const probing = probingQuota.sort((left, right) => left.firstOrder - right.firstOrder)[0];
  const terminal = terminals.sort((left, right) => left.firstOrder - right.firstOrder)[0];
  if (initial === undefined || phase.initialStateId !== initial.id) {
    return "initial-state";
  }
  if (terminal === undefined || phase.finalStateId !== terminal.id) return "final-state";
  if (
    installingState === undefined ||
    waiting === undefined ||
    planningState === undefined ||
    probing === undefined
  ) {
    return "state-set";
  }
  if (
    !(
      initial.firstOrder <= installingState.firstOrder &&
      installingState.firstOrder <= waiting.firstOrder &&
      waiting.firstOrder <= planningState.firstOrder &&
      planningState.firstOrder <= probing.firstOrder &&
      probing.firstOrder <= terminal.firstOrder
    )
  ) {
    return "unexpected-edge";
  }
  const allowedTransferStates = new Set([
    "failed",
    "idle",
    "planning",
    "probing-quota",
    "waiting-lock",
  ]);
  if (
    states.some(
      (state) =>
        !allowedTransferStates.has(state.transferState) ||
        (state.transferState !== "failed" &&
          (state.failureCode !== null ||
            state.failureResourceId !== null ||
            state.activeReleaseDigest !== null ||
            state.releaseDigest !== null ||
            state.shellGenerationId !== null)) ||
        (state.storeState !== "idle" &&
          state.storeState !== "staging" &&
          state.storeState !== "reconciling"),
    )
  ) {
    return "unexpected-edge";
  }
  void edges;
  return null;
}

function validateRetainedRepairReadyPrelude(
  phase: InstallerTrustFaultProofPhase,
  states: readonly InstallerTrustFaultProofState[],
  edges: readonly InstallerTrustFaultProofEdge[],
  operationUiState: "installing" | "repairing",
  authority: InstallerTrustFaultAuthority,
): void {
  const stateById = new Map(states.map((state) => [state.id, state] as const));
  const initial = stateById.get(phase.initialStateId);
  if (initial === undefined) {
    throw new Error("Installer trust-fault transition proof phase initial state is absent");
  }
  const phaseEdges = edges.filter((edge) => {
    return stateById.has(edge.fromStateId) && stateById.has(edge.toStateId);
  });
  const readyRestarts = phaseEdges.filter((edge) => {
    const from = stateById.get(edge.fromStateId);
    const to = stateById.get(edge.toStateId);
    return from?.transferState === "ready" && to?.transferState !== "ready";
  });
  const hasRetainedReadyPrelude = initial.transferState === "ready";
  if (!hasRetainedReadyPrelude) {
    if (readyRestarts.length !== 0) {
      throw new Error("Installer trust-fault transition proof restarted after current Ready");
    }
    return;
  }
  if (
    operationUiState !== "repairing" ||
    phase.phase !== "attempt-1" ||
    !isRetainedRepairReadyPrelude(initial, authority) ||
    phase.attemptMilestones[0] !== "ready" ||
    phase.attemptMilestones[1] !== "waiting-lock" ||
    readyRestarts.length !== 1 ||
    readyRestarts[0]?.count !== 1
  ) {
    throw new Error("Installer trust-fault transition proof repair Ready prelude is invalid");
  }
  const restart = readyRestarts[0];
  const from = restart === undefined ? undefined : stateById.get(restart.fromStateId);
  const to = restart === undefined ? undefined : stateById.get(restart.toStateId);
  if (
    from?.uiState !== "repairing" ||
    to?.uiState !== "repairing" ||
    to?.transferState !== "waiting-lock"
  ) {
    throw new Error("Installer trust-fault transition proof repair Ready restart is invalid");
  }
}

function expectedOperationUiState(
  id: InstallerTrustFaultCellId,
  phase: InstallerTrustFaultTransition["phase"],
): "installing" | "repairing" {
  return phase !== "seed" &&
    (id === "reused-object-corruption" ||
      id === "final-verification-corruption" ||
      id === "repeated-server-corruption")
    ? "repairing"
    : "installing";
}

function validatePhases(
  input: unknown[],
  states: readonly InstallerTrustFaultProofState[],
  edges: readonly InstallerTrustFaultProofEdge[],
  rawObservationCount: number,
  id: InstallerTrustFaultCellId,
): readonly InstallerTrustFaultProofPhase[] {
  let nextOrder = 1;
  return Object.freeze(
    input.map((inputPhase, index) => {
      const phase = record(inputPhase, `transition proof phase ${index}`);
      exact(phase, [
        "attemptMilestones",
        "finalStateId",
        "firstOrder",
        "initialStateId",
        "lastOrder",
        "observedCount",
        "phase",
      ]);
      if (
        phase.phase !== expectedCellPhases(id)[index] ||
        phase.firstOrder !== nextOrder ||
        !positiveInteger(phase.lastOrder) ||
        !positiveInteger(phase.observedCount) ||
        phase.lastOrder !== (phase.firstOrder as number) + (phase.observedCount as number) - 1 ||
        phase.lastOrder > rawObservationCount ||
        !positiveInteger(phase.initialStateId) ||
        !positiveInteger(phase.finalStateId) ||
        !Array.isArray(phase.attemptMilestones) ||
        phase.attemptMilestones.length < 1 ||
        phase.attemptMilestones.length > INSTALLER_TRUST_FAULT_MAX_ATTEMPT_MILESTONES ||
        phase.attemptMilestones.some((value) => typeof value !== "string" || value === "")
      ) {
        throw new Error("Installer trust-fault transition proof phase is invalid");
      }
      const initial = states[(phase.initialStateId as number) - 1];
      const final = states[(phase.finalStateId as number) - 1];
      if (
        initial === undefined ||
        final === undefined ||
        initial.phase !== phase.phase ||
        final.phase !== phase.phase ||
        initial.firstOrder !== phase.firstOrder
      ) {
        throw new Error("Installer trust-fault transition proof phase endpoints are invalid");
      }
      const phaseEdges = edges
        .filter((edge) => {
          const to = states[edge.toStateId - 1];
          return (
            to?.phase === phase.phase &&
            edge.firstOrder >= (phase.firstOrder as number) &&
            edge.firstOrder <= (phase.lastOrder as number)
          );
        })
        .sort((left, right) => left.firstOrder - right.firstOrder);
      const expectedMilestones = [initial.transferState];
      const seen = new Set<string>();
      for (const edge of phaseEdges) {
        const from = states[edge.fromStateId - 1];
        const to = states[edge.toStateId - 1];
        if (
          from === undefined ||
          to === undefined ||
          from.phase !== phase.phase ||
          from.transferState === to.transferState
        ) {
          continue;
        }
        const key = `${from.transferState}\n${to.transferState}`;
        if (!seen.has(key)) {
          seen.add(key);
          expectedMilestones.push(to.transferState);
        }
      }
      if (JSON.stringify(phase.attemptMilestones) !== JSON.stringify(expectedMilestones)) {
        throw new Error("Installer trust-fault transition proof phase milestones are invalid");
      }
      const expectedObservedCount =
        (phase.firstOrder === 1 ? 1 : 0) +
        edges.reduce((total, edge) => {
          const to = states[edge.toStateId - 1];
          return to?.phase === phase.phase ? total + edge.count : total;
        }, 0);
      if (phase.observedCount !== expectedObservedCount) {
        throw new Error("Installer trust-fault transition proof phase count is invalid");
      }
      const terminalEdge = phaseEdges
        .filter((edge) => states[edge.toStateId - 1]?.phase === phase.phase)
        .sort((left, right) => right.lastOrder - left.lastOrder)[0];
      if (
        phase.observedCount === 1
          ? phase.finalStateId !== phase.initialStateId
          : terminalEdge?.lastOrder !== phase.lastOrder ||
            terminalEdge.toStateId !== phase.finalStateId
      ) {
        throw new Error("Installer trust-fault transition proof phase final occurrence is invalid");
      }
      nextOrder = (phase.lastOrder as number) + 1;
      return phase as unknown as InstallerTrustFaultProofPhase;
    }),
  );
}

function validateOnlineObservation(
  current: InstallerTrustFaultTransition,
  previous: InstallerTrustFaultTransition | null,
  id: InstallerTrustFaultCellId,
  authority: InstallerTrustFaultAuthority,
  faultResourceId: string,
  verdictMode: InstallerTrustFaultProofVerdictMode,
  repairFinalizationProgress?: MutableRepairFinalizationProgress,
  estimateTerminalProgress?: MutableEstimateTerminalProgress,
): void {
  validateAuthorityDimensions(current, authority, faultResourceId);
  const phases = expectedCellPhases(id);
  const currentRank = phases.indexOf(current.phase);
  if (currentRank < 0) {
    throw new Error(`Installer trust-fault cell ${id} observed forbidden phase ${current.phase}`);
  }
  if (
    previous !== null &&
    DIMENSIONS.every((dimension) => current[dimension] === previous[dimension])
  ) {
    return;
  }
  const retainedRepairReadyPrelude =
    expectedOperationUiState(id, current.phase) === "repairing" &&
    isRetainedRepairReadyPrelude(current, authority);
  const estimateTerminalIngress = isEstimateClearlyInsufficientTerminalEdge(id, previous, current);
  const estimateTerminalRepeat = isEstimateClearlyInsufficientTerminalRepeat(id, previous, current);
  if (estimateTerminalRepeat && estimateTerminalProgress !== undefined) {
    if (!estimateTerminalProgress.ingressReached) {
      throw new Error("Installer trust-fault transition proof observed terminal before ingress");
    }
  }
  if (current.phase === "setup") {
    if (
      current.transferState === "ready" ||
      current.transferState === "failed" ||
      current.uiState === "ready" ||
      current.uiState === "failed" ||
      current.uiState === "repairing" ||
      current.failureCode !== null ||
      current.failureResourceId !== null
    ) {
      throw new Error("Installer trust-fault transition proof setup is not generic nonterminal");
    }
  } else {
    const outcome = expectedPhaseOutcome(id, current.phase);
    const expectedRepairFailure = isExpectedRepairFailurePhase(id, current.phase);
    const unexpectedTerminalAllowed =
      verdictMode === "allow-unexpected-terminal" && current.phase === phases.at(-1);
    if (current.phase === "seed" && current.uiState === "repairing") {
      throw new Error("Installer trust-fault transition proof seed is not an ordinary install");
    }
    if (
      !unexpectedTerminalAllowed &&
      ((outcome === "ready" && current.transferState === "failed") ||
        (outcome === "failed" &&
          ((!expectedRepairFailure && current.transferState === "verifying") ||
            (current.transferState === "ready" && !retainedRepairReadyPrelude))))
    ) {
      throw new Error("Installer trust-fault transition proof crossed its cell outcome automaton");
    }
    if (
      !unexpectedTerminalAllowed &&
      expectedRepairFailure &&
      current.transferState === "verifying" &&
      !isExpectedRepairVerificationState(current, authority)
    ) {
      throw new Error(
        "Installer trust-fault transition proof repair verification authority is invalid",
      );
    }
  }
  if (
    current.transferState === "ready" &&
    (current.storeState !== "ready" ||
      current.activeReleaseDigest !== authority.releaseDigest ||
      current.failureCode !== null ||
      current.failureResourceId !== null ||
      (current.uiState !== "installing" &&
        current.uiState !== "repairing" &&
        current.uiState !== "ready" &&
        !retainedRepairReadyPrelude))
  ) {
    throw new Error("Installer trust-fault transition proof contains contradictory transfer Ready");
  }
  if (current.transferState === "ready" && current.uiState !== "ready") {
    const operationUiState = expectedOperationUiState(id, current.phase);
    const generationId = `${authority.artifactDigest}:${authority.releaseDigest}`;
    if (
      !retainedRepairReadyPrelude &&
      (current.uiState !== operationUiState ||
        (operationUiState === "installing"
          ? current.releaseDigest !== null || current.shellGenerationId !== null
          : current.releaseDigest !== authority.releaseDigest ||
            current.shellGenerationId !== generationId))
    ) {
      throw new Error("Installer trust-fault transition proof Ready preparation is invalid");
    }
  }
  if (
    current.transferState === "failed" &&
    !estimateTerminalIngress &&
    !estimateTerminalRepeat &&
    (current.uiState !== "failed" ||
      current.storeState !== "failed" ||
      current.activeReleaseDigest !== null ||
      current.releaseDigest !== null ||
      current.shellGenerationId !== null ||
      current.failureCode === null)
  ) {
    throw new Error(
      "Installer trust-fault transition proof contains contradictory transfer failure",
    );
  }
  if (previous === null) {
    if (current.phase !== "setup") {
      throw new Error("Installer trust-fault transition proof did not start in setup");
    }
    return;
  }
  if (id === "estimate-clearly-insufficient" && current.phase === "attempt-1") {
    validateEstimateClearlyInsufficientOnlineEdge(previous, current);
  }
  const previousRank = phases.indexOf(previous.phase);
  if (currentRank < previousRank || currentRank > previousRank + 1) {
    throw new Error("Installer trust-fault transition proof crossed a forbidden phase boundary");
  }
  if (
    current.phase !== previous.phase &&
    isExpectedRepairFailurePhase(id, current.phase) &&
    !isRetainedRepairReadyPrelude(current, authority)
  ) {
    throw new Error(
      "Installer trust-fault transition proof repair failure did not enter at exact retained Ready",
    );
  }
  if (current.transferState === "failed") {
    const expectedFailure = expectedPhaseFailure(id, current.phase, faultResourceId);
    const unexpectedFailure =
      verdictMode === "allow-unexpected-terminal" && current.phase === phases.at(-1);
    if (
      !unexpectedFailure &&
      (current.failureCode !== expectedFailure.code ||
        current.failureResourceId !== expectedFailure.resourceId)
    ) {
      throw new Error("Installer trust-fault transition proof crossed its typed failure automaton");
    }
  }
  if (
    current.phase === previous.phase &&
    isExpectedRepairFailurePhase(id, current.phase) &&
    !isExpectedRepairFailureEdge(previous, current, authority)
  ) {
    throw new Error(
      "Installer trust-fault transition proof crossed its repair failure edge automaton",
    );
  }
  if (
    current.phase === previous.phase &&
    isExpectedRepairFailurePhase(id, current.phase) &&
    repairFinalizationProgress !== undefined
  ) {
    updateRepairFinalizationProgress(repairFinalizationProgress, previous, current, authority);
  }
  if (previous.transferState !== "ready" && current.transferState === "ready") {
    const operationUiState = expectedOperationUiState(id, current.phase);
    const generationId = `${authority.artifactDigest}:${authority.releaseDigest}`;
    if (
      current.uiState !== operationUiState ||
      (operationUiState === "installing"
        ? current.releaseDigest !== null || current.shellGenerationId !== null
        : current.releaseDigest !== authority.releaseDigest ||
          current.shellGenerationId !== generationId)
    ) {
      throw new Error(
        "Installer trust-fault transition proof omitted its first Ready authority boundary",
      );
    }
  }
  if (current.phase !== previous.phase) return;
  const retainedRepairRestart =
    expectedOperationUiState(id, current.phase) === "repairing" &&
    previous.uiState === "repairing" &&
    isRetainedRepairReadyPrelude(previous, authority) &&
    current.transferState === "waiting-lock" &&
    current.uiState === "repairing";
  const allowed = transferSuccessors(previous.transferState);
  if (
    current.transferState !== previous.transferState &&
    !allowed.has(current.transferState) &&
    !retainedRepairRestart
  ) {
    throw new Error(
      `Installer trust-fault transition proof contains forbidden transfer edge ${previous.transferState}->${current.transferState}`,
    );
  }
  if (
    (previous.transferState === "ready" || previous.transferState === "failed") &&
    current.transferState !== previous.transferState &&
    !retainedRepairRestart
  ) {
    throw new Error("Installer trust-fault transition proof left a terminal transfer state");
  }
  if (
    previous.transferState === "ready" &&
    previous.uiState === "ready" &&
    current.uiState !== "ready"
  ) {
    throw new Error("Installer trust-fault transition proof revoked final Ready in one phase");
  }
  if (estimateTerminalProgress !== undefined) {
    if (estimateTerminalIngress) estimateTerminalProgress.ingressReached = true;
    if (estimateTerminalRepeat) estimateTerminalProgress.repeatCount += 1;
  }
}

function isEstimateClearlyInsufficientTerminalEdge(
  id: InstallerTrustFaultCellId,
  previous: InstallerTrustFaultTransition | null,
  current: InstallerTrustFaultTransition,
): boolean {
  return (
    id === "estimate-clearly-insufficient" &&
    previous !== null &&
    isEstimateClearlyInsufficientPredecessorState(previous) &&
    isEstimateClearlyInsufficientTerminalState(current)
  );
}

function validateEstimateClearlyInsufficientOnlineEdge(
  previous: InstallerTrustFaultTransition,
  current: InstallerTrustFaultTransition,
): void {
  const previousProductState = normalizeEstimateStorePulse(previous);
  const currentProductState = normalizeEstimateStorePulse(current);
  const valid =
    DIMENSIONS.every(
      (dimension) => previousProductState[dimension] === currentProductState[dimension],
    ) ||
    (previousProductState.phase === "setup" &&
      isEstimateClearlyInsufficientInitialPersistenceState(currentProductState)) ||
    (isEstimateClearlyInsufficientInitialPersistenceState(previousProductState) &&
      isEstimateClearlyInsufficientInstallingState(currentProductState)) ||
    (isEstimateClearlyInsufficientInstallingState(previousProductState) &&
      isEstimateClearlyInsufficientWaitingLockState(currentProductState)) ||
    (isEstimateClearlyInsufficientWaitingLockState(previousProductState) &&
      isEstimateClearlyInsufficientPlanningState(currentProductState)) ||
    (isEstimateClearlyInsufficientPlanningState(previousProductState) &&
      isEstimateClearlyInsufficientPredecessorState(currentProductState)) ||
    (isEstimateClearlyInsufficientPredecessorState(previousProductState) &&
      (isEstimateClearlyInsufficientPredecessorState(currentProductState) ||
        isEstimateClearlyInsufficientTerminalState(currentProductState))) ||
    (isEstimateClearlyInsufficientTerminalState(previousProductState) &&
      isEstimateClearlyInsufficientTerminalState(currentProductState));
  if (!valid) {
    throw new Error(
      "Installer trust-fault transition proof crossed its estimate attempt automaton",
    );
  }
}

function normalizeEstimateStorePulse<T extends TransitionState>(transition: T): T {
  return transition.phase === "attempt-1" &&
    transition.transferState !== "failed" &&
    (transition.storeState === "staging" || transition.storeState === "reconciling")
    ? (Object.freeze({ ...transition, storeState: "idle" as const }) as T)
    : transition;
}

function isEstimateClearlyInsufficientTerminalRepeat(
  id: InstallerTrustFaultCellId,
  previous: InstallerTrustFaultTransition | null,
  current: InstallerTrustFaultTransition,
): boolean {
  return (
    id === "estimate-clearly-insufficient" &&
    previous !== null &&
    isEstimateClearlyInsufficientTerminalState(previous) &&
    isEstimateClearlyInsufficientTerminalState(current)
  );
}

function isRetainedRepairReadyPrelude(
  transition: TransitionState,
  authority: InstallerTrustFaultAuthority,
): boolean {
  return (
    transition.phase === "attempt-1" &&
    transition.transferState === "ready" &&
    transition.storeState === "ready" &&
    transition.activeReleaseDigest === authority.releaseDigest &&
    transition.releaseDigest === authority.releaseDigest &&
    transition.shellGenerationId === `${authority.artifactDigest}:${authority.releaseDigest}` &&
    transition.failureCode === null &&
    transition.failureResourceId === null &&
    (transition.uiState === "requesting-persistence" || transition.uiState === "repairing")
  );
}

function isExpectedRepairFailurePhase(
  id: InstallerTrustFaultCellId,
  phase: InstallerTrustFaultTransition["phase"],
): boolean {
  return id === "repeated-server-corruption" && phase === "attempt-1";
}

function hasExactAdmissionAuthority(
  transition: TransitionState,
  authority: InstallerTrustFaultAuthority,
): boolean {
  return (
    transition.activeReleaseDigest === authority.releaseDigest &&
    transition.releaseDigest === authority.releaseDigest &&
    transition.shellGenerationId === `${authority.artifactDigest}:${authority.releaseDigest}`
  );
}

function hasNoFailure(transition: TransitionState): boolean {
  return transition.failureCode === null && transition.failureResourceId === null;
}

function isExpectedRepairFailureEdge(
  previous: InstallerTrustFaultTransition,
  current: InstallerTrustFaultTransition,
  authority: InstallerTrustFaultAuthority,
): boolean {
  if (
    isRepairFailureStorePrecursor(previous, authority) &&
    isRepairFailureStorePrecursor(current, authority)
  ) {
    return true;
  }
  if (previous.transferState === "failed" && current.transferState === "failed") {
    return transitionStateKey(previous) === transitionStateKey(current);
  }
  if (previous.transferState === "failed" || current.transferState === "failed") {
    return (
      isRepairFailureStorePrecursor(previous, authority) &&
      current.transferState === "failed" &&
      current.storeState === "failed" &&
      current.uiState === "failed" &&
      current.activeReleaseDigest === null &&
      current.releaseDigest === null &&
      current.shellGenerationId === null
    );
  }
  if (previous.transferState === "verifying" && current.transferState === "verifying") {
    return isExpectedRepairFinalizationEdge(previous, current, authority);
  }
  if (
    !hasExactAdmissionAuthority(previous, authority) ||
    !hasExactAdmissionAuthority(current, authority) ||
    !hasNoFailure(previous) ||
    !hasNoFailure(current)
  ) {
    return false;
  }
  if (previous.transferState === current.transferState) {
    return isExpectedRepairFailureStoreEdge(previous, current);
  }
  return (
    previous.uiState === "repairing" &&
    current.uiState === "repairing" &&
    previous.storeState === "ready" &&
    current.storeState === "ready" &&
    new Set([
      "ready->waiting-lock",
      "waiting-lock->planning",
      "planning->probing-quota",
      "probing-quota->transferring",
      "transferring->verifying",
    ]).has(`${previous.transferState}->${current.transferState}`)
  );
}

function isExpectedRepairFailureStoreEdge(
  previous: InstallerTrustFaultTransition,
  current: InstallerTrustFaultTransition,
): boolean {
  if (previous.transferState === "ready") {
    return (
      previous.storeState === "ready" &&
      current.storeState === "ready" &&
      (previous.uiState === current.uiState ||
        (previous.uiState === "requesting-persistence" && current.uiState === "repairing")) &&
      (current.uiState === "requesting-persistence" || current.uiState === "repairing")
    );
  }
  if (previous.uiState !== "repairing" || current.uiState !== "repairing") return false;
  if (previous.transferState === "waiting-lock" || previous.transferState === "transferring") {
    return previous.storeState === "ready" && current.storeState === "ready";
  }
  if (previous.transferState === "planning") {
    return isBidirectionalStoreCycleEdge(previous.storeState, current.storeState, [
      "ready",
      "reconciling",
      "staging",
    ]);
  }
  if (previous.transferState === "probing-quota") {
    return isBidirectionalStoreCycleEdge(previous.storeState, current.storeState, [
      "ready",
      "writing",
    ]);
  }
  return false;
}

function isExpectedRepairVerificationState(
  transition: InstallerTrustFaultTransition,
  authority: InstallerTrustFaultAuthority,
): boolean {
  return (
    isFullAuthorityRepairVerificationState(transition, authority) ||
    isRevokedRepairFinalizationState(transition, authority) ||
    isRepairFailureStorePrecursor(transition, authority)
  );
}

function isFullAuthorityRepairVerificationState(
  transition: TransitionState,
  authority: InstallerTrustFaultAuthority,
): boolean {
  return (
    transition.transferState === "verifying" &&
    (transition.storeState === "ready" || transition.storeState === "verifying") &&
    transition.uiState === "repairing" &&
    hasExactAdmissionAuthority(transition, authority) &&
    hasNoFailure(transition)
  );
}

function hasRevokedRepairAuthority(
  transition: TransitionState,
  authority: InstallerTrustFaultAuthority,
): boolean {
  return (
    transition.activeReleaseDigest === null &&
    transition.releaseDigest === authority.releaseDigest &&
    transition.shellGenerationId === `${authority.artifactDigest}:${authority.releaseDigest}`
  );
}

function isRevokedRepairFinalizationState(
  transition: TransitionState,
  authority: InstallerTrustFaultAuthority,
): boolean {
  return (
    transition.transferState === "verifying" &&
    (transition.storeState === "idle" ||
      transition.storeState === "reconciling" ||
      transition.storeState === "writing" ||
      transition.storeState === "verifying") &&
    transition.uiState === "repairing" &&
    hasRevokedRepairAuthority(transition, authority) &&
    hasNoFailure(transition)
  );
}

function isRepairFailureStorePrecursor(
  transition: TransitionState,
  authority: InstallerTrustFaultAuthority,
): boolean {
  return (
    transition.transferState === "verifying" &&
    transition.storeState === "failed" &&
    transition.uiState === "repairing" &&
    hasRevokedRepairAuthority(transition, authority) &&
    hasNoFailure(transition)
  );
}

function isExpectedRepairFinalizationEdge(
  previous: InstallerTrustFaultTransition,
  current: InstallerTrustFaultTransition,
  authority: InstallerTrustFaultAuthority,
): boolean {
  if (
    isFullAuthorityRepairVerificationState(previous, authority) &&
    isFullAuthorityRepairVerificationState(current, authority)
  ) {
    return (
      previous.storeState === current.storeState ||
      (previous.storeState === "ready" && current.storeState === "verifying")
    );
  }
  if (
    isFullAuthorityRepairVerificationState(previous, authority) &&
    isRevokedRepairFinalizationState(current, authority)
  ) {
    return previous.storeState === "verifying" && current.storeState === "idle";
  }
  if (
    isRevokedRepairFinalizationState(previous, authority) &&
    isRevokedRepairFinalizationState(current, authority)
  ) {
    return (
      previous.storeState === current.storeState ||
      previous.storeState === "idle" ||
      current.storeState === "idle"
    );
  }
  return (
    isRevokedRepairFinalizationState(previous, authority) &&
    (previous.storeState === "idle" || previous.storeState === "verifying") &&
    isRepairFailureStorePrecursor(current, authority)
  );
}

function updateRepairFinalizationProgress(
  progress: MutableRepairFinalizationProgress,
  previous: InstallerTrustFaultTransition,
  current: InstallerTrustFaultTransition,
  authority: InstallerTrustFaultAuthority,
): void {
  if (
    isRepairFailureStorePrecursor(previous, authority) &&
    isRepairFailureStorePrecursor(current, authority)
  ) {
    if (!progress.precursorReached || progress.terminalReached) {
      throw new Error(
        "Installer trust-fault repair finalization precursor repeat order is invalid",
      );
    }
    return;
  }
  if (
    previous.transferState === "failed" &&
    current.transferState === "failed" &&
    transitionStateKey(previous) === transitionStateKey(current)
  ) {
    if (!progress.terminalReached) {
      throw new Error("Installer trust-fault repair finalization terminal repeat order is invalid");
    }
    return;
  }
  if (current.transferState === "failed") {
    if (!progress.precursorReached || progress.terminalReached) {
      throw new Error("Installer trust-fault repair finalization terminal order is invalid");
    }
    progress.terminalReached = true;
    return;
  }
  if (isRepairFailureStorePrecursor(current, authority)) {
    if (
      !progress.revocationReached ||
      !progress.reconciliationReached ||
      !progress.writingReached ||
      progress.precursorReached
    ) {
      throw new Error("Installer trust-fault repair finalization precursor order is invalid");
    }
    progress.precursorReached = true;
    return;
  }
  if (!isRevokedRepairFinalizationState(current, authority)) {
    if (progress.revocationReached) {
      throw new Error("Installer trust-fault repair finalization restored revoked authority");
    }
    return;
  }
  if (!progress.revocationReached) {
    if (
      !isFullAuthorityRepairVerificationState(previous, authority) ||
      previous.storeState !== "verifying" ||
      current.storeState !== "idle"
    ) {
      throw new Error("Installer trust-fault repair finalization revocation order is invalid");
    }
    progress.revocationReached = true;
  }
  if (current.storeState === "reconciling") {
    progress.reconciliationReached = true;
  } else if (current.storeState === "writing") {
    if (!progress.reconciliationReached) {
      throw new Error("Installer trust-fault repair finalization wrote before reconciliation");
    }
    progress.writingReached = true;
  } else if (current.storeState === "verifying") {
    if (!progress.writingReached) {
      throw new Error("Installer trust-fault repair finalization verified before writing");
    }
    progress.verificationReached = true;
  }
}

function isBidirectionalStoreCycleEdge(
  previous: InstallerTrustFaultStoreState,
  current: InstallerTrustFaultStoreState,
  allowed: readonly InstallerTrustFaultStoreState[],
): boolean {
  return (
    allowed.includes(previous) &&
    allowed.includes(current) &&
    (previous === current || previous === "ready" || current === "ready")
  );
}

function hasRepairVerificationInvariant(
  states: readonly InstallerTrustFaultProofState[],
  terminalStates: readonly InstallerTrustFaultProofState[],
  authority: InstallerTrustFaultAuthority,
): boolean {
  const ordered = [...states].sort((left, right) => left.firstOrder - right.firstOrder);
  const firstIndex = (predicate: (state: InstallerTrustFaultProofState) => boolean): number =>
    ordered.findIndex(predicate);
  const readyVerification = firstIndex(
    (state) =>
      isFullAuthorityRepairVerificationState(state, authority) && state.storeState === "ready",
  );
  const storeVerification = firstIndex(
    (state) =>
      isFullAuthorityRepairVerificationState(state, authority) && state.storeState === "verifying",
  );
  const revokedIdle = firstIndex(
    (state) => isRevokedRepairFinalizationState(state, authority) && state.storeState === "idle",
  );
  const reconciled = firstIndex(
    (state) =>
      isRevokedRepairFinalizationState(state, authority) && state.storeState === "reconciling",
  );
  const written = firstIndex(
    (state) => isRevokedRepairFinalizationState(state, authority) && state.storeState === "writing",
  );
  const precursor = firstIndex((state) => isRepairFailureStorePrecursor(state, authority));
  const terminal = firstIndex((state) =>
    terminalStates.some((candidate) => candidate.id === state.id),
  );
  if (
    [
      readyVerification,
      storeVerification,
      revokedIdle,
      reconciled,
      written,
      precursor,
      terminal,
    ].some((index) => index < 0) ||
    !(
      readyVerification < storeVerification &&
      storeVerification < revokedIdle &&
      revokedIdle < reconciled &&
      reconciled < written &&
      written < precursor &&
      precursor < terminal
    )
  ) {
    return false;
  }
  return ordered
    .slice(revokedIdle)
    .every(
      (state) => !hasExactAdmissionAuthority(state, authority) && state.transferState !== "ready",
    );
}

function expectedPhaseFailure(
  id: InstallerTrustFaultCellId,
  phase: InstallerTrustFaultTransition["phase"],
  faultResourceId: string,
): Readonly<{ code: "integrity" | "quota"; resourceId: string | null }> {
  if (id === "repeated-server-corruption") {
    return { code: "integrity", resourceId: faultResourceId };
  }
  if (id === "mid-append-quota-resume" && phase === "attempt-1") {
    return { code: "quota", resourceId: faultResourceId };
  }
  return { code: "quota", resourceId: null };
}

function validateAuthorityDimensions(
  transition: InstallerTrustFaultTransition,
  authority: InstallerTrustFaultAuthority,
  faultResourceId: string,
): void {
  const generationId = `${authority.artifactDigest}:${authority.releaseDigest}`;
  if (
    (transition.activeReleaseDigest !== null &&
      transition.activeReleaseDigest !== authority.releaseDigest) ||
    (transition.releaseDigest !== null && transition.releaseDigest !== authority.releaseDigest) ||
    (transition.shellGenerationId !== null && transition.shellGenerationId !== generationId) ||
    (transition.failureResourceId !== null && transition.failureResourceId !== faultResourceId)
  ) {
    throw new Error("Installer trust-fault transition proof crossed its authority dimensions");
  }
  if (
    transition.uiState === "ready" &&
    (transition.transferState !== "ready" ||
      transition.storeState !== "ready" ||
      transition.activeReleaseDigest !== authority.releaseDigest ||
      transition.releaseDigest !== authority.releaseDigest ||
      transition.shellGenerationId !== generationId ||
      transition.failureCode !== null ||
      transition.failureResourceId !== null)
  ) {
    throw new Error(
      "Installer trust-fault transition proof contains contradictory Ready authority",
    );
  }
  if (
    transition.uiState === "failed" &&
    (transition.transferState !== "failed" || transition.failureCode === null)
  ) {
    throw new Error(
      "Installer trust-fault transition proof contains contradictory failure authority",
    );
  }
}

function validateTerminalVerdict(
  terminal: InstallerTrustFaultProofState,
  id: InstallerTrustFaultCellId,
  authority: InstallerTrustFaultAuthority,
  faultResourceId: string,
  verdictMode: InstallerTrustFaultProofVerdictMode,
): void {
  const success =
    id === "reused-object-corruption" ||
    id === "final-verification-corruption" ||
    id === "estimate-incomplete-probe-success" ||
    id === "mid-append-quota-resume" ||
    id === "persistence-denied";
  if (success && (verdictMode === "expected" || terminal.uiState !== "failed")) {
    validateAuthorityDimensions(
      { ...terminal, order: terminal.firstOrder },
      authority,
      faultResourceId,
    );
    if (terminal.uiState !== "ready") {
      throw new Error("Installer trust-fault transition proof terminal verdict is not Ready");
    }
  } else if (
    !success &&
    verdictMode === "allow-unexpected-terminal" &&
    terminal.uiState === "ready"
  ) {
    validateAuthorityDimensions(
      { ...terminal, order: terminal.firstOrder },
      authority,
      faultResourceId,
    );
  } else if (terminal.uiState !== "failed") {
    throw new Error("Installer trust-fault transition proof terminal verdict is not failed");
  }
}

function expectedCellPhases(
  id: InstallerTrustFaultCellId,
): readonly InstallerTrustFaultTransition["phase"][] {
  return id === "mid-append-quota-resume"
    ? ["setup", "attempt-1", "attempt-2"]
    : id === "reused-object-corruption" ||
        id === "final-verification-corruption" ||
        id === "repeated-server-corruption"
      ? ["setup", "seed", "attempt-1"]
      : ["setup", "attempt-1"];
}

function transferSuccessors(state: string): ReadonlySet<string> {
  const graph = new Map<string, ReadonlySet<string>>([
    ["idle", new Set(["planning", "waiting-lock"])],
    ["waiting-lock", new Set(["planning"])],
    ["planning", new Set(["probing-quota"])],
    ["probing-quota", new Set(["failed", "transferring"])],
    ["transferring", new Set(["failed", "verifying"])],
    ["verifying", new Set(["failed", "ready", "transferring"])],
    ["failed", new Set()],
    ["ready", new Set()],
    ["cancelled", new Set()],
    ["cancelling", new Set(["cancelled"])],
    ["disposed", new Set()],
  ]);
  return graph.get(state) ?? new Set();
}

function updatePhase(
  phases: MutablePhase[],
  transition: InstallerTrustFaultTransition,
  stateId: number,
): void {
  let phase = phases.at(-1);
  if (phase?.phase !== transition.phase) {
    phase = {
      attemptMilestones: [transition.transferState],
      finalStateId: stateId,
      firstOrder: transition.order,
      initialStateId: stateId,
      lastOrder: transition.order,
      observedCount: 0,
      phase: transition.phase,
      previousTransferState: transition.transferState,
      seenTransferEdges: new Set(),
    };
    phases.push(phase);
  } else if (transition.transferState !== phase.previousTransferState) {
    const edge = `${phase.previousTransferState}\n${transition.transferState}`;
    if (!phase.seenTransferEdges.has(edge)) {
      phase.seenTransferEdges.add(edge);
      phase.attemptMilestones.push(transition.transferState);
    }
    phase.previousTransferState = transition.transferState;
  }
  phase.observedCount += 1;
  phase.lastOrder = transition.order;
  (phase as { finalStateId: number }).finalStateId = stateId;
}

function updateStreamHash(hash: Hash, transition: InstallerTrustFaultTransition): void {
  hash.update(`${JSON.stringify(DIMENSIONS.map((dimension) => transition[dimension]))}\n`, "utf8");
}

function transitionStateKey(transition: TransitionState): string {
  return JSON.stringify(DIMENSIONS.map((dimension) => transition[dimension]));
}

function withoutOrder(transition: InstallerTrustFaultTransition): TransitionState {
  const { order: _order, ...state } = transition;
  return state;
}

function zeroDimensionCounts(): Record<Dimension, number> {
  return Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, 0])) as Record<
    Dimension,
    number
  >;
}

function validateDimensionCounts(
  input: unknown,
  expected: Readonly<Record<Dimension, number>>,
): void {
  const counts = record(input, "transition proof dimension counts");
  exact(counts, [...DIMENSIONS]);
  for (const dimension of DIMENSIONS) {
    if (counts[dimension] !== expected[dimension]) {
      throw new Error(
        `Installer trust-fault transition proof ${dimension} change count is invalid`,
      );
    }
  }
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function record(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`Installer trust-fault ${label} is not a record`);
  }
  return input as Record<string, unknown>;
}

function exact(input: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(input).sort().join("\n") !== [...keys].sort().join("\n")) {
    throw new Error("Installer trust-fault transition proof fields are invalid");
  }
}
