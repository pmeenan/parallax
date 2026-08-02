import { INSTALLER_FAILURE_RULES, type InstallerFailureCode } from "@parallax/engine";
import {
  INSTALLER_TRUST_FAULT_STORE_STATES,
  INSTALLER_TRUST_FAULT_TRANSFER_STATES,
  INSTALLER_TRUST_FAULT_UI_STATES,
  type InstallerTrustFaultStoreState,
  type InstallerTrustFaultTransferState,
  type InstallerTrustFaultUiState,
} from "./installer-trust-faults-transitions.js";

export const INSTALLER_TRUST_TRANSITION_BINDING_FAILURE_MESSAGE =
  "Installer trust-fault transition proof crossed its repair failure edge automaton";
export const INSTALLER_TRUST_TRANSITION_REJECTION_MESSAGE =
  "Installer trust-fault transition binding rejected a queued observation";
export const INSTALLER_TRUST_TRANSITION_QUEUE_INTERNAL_MESSAGE =
  "Installer transition queue rejected without retained failure evidence";

export type InstallerTrustTransitionFailedPredicateEvidence =
  | "current-not-precursor"
  | "previous-not-revoked-finalization"
  | "previous-revoked-store-not-idle-or-verifying";

export interface InstallerTrustTransitionPreviousStateEvidence {
  readonly active: boolean;
  readonly failure: InstallerFailureCode | null;
  readonly order: number;
  readonly phase: "attempt-1" | "attempt-2" | "seed" | "setup";
  readonly release: boolean;
  readonly resource: boolean;
  readonly shell: boolean;
  readonly store: InstallerTrustFaultStoreState;
  readonly transfer: InstallerTrustFaultTransferState;
  readonly ui: InstallerTrustFaultUiState;
}

export interface InstallerTrustTransitionLegacyBindingDiagnosticEvidence {
  readonly failedPredicate: InstallerTrustTransitionFailedPredicateEvidence;
  readonly previousRelationalState: InstallerTrustTransitionPreviousStateEvidence;
}

export type InstallerTrustTransitionBindingPredicateEvidence =
  | "binding-absent"
  | "binding-outcome-invalid"
  | "binding-transport-rejected"
  | "transition-model-rejected";

export interface InstallerTrustTransitionBindingDiagnosticEvidence {
  readonly currentRelationalState: InstallerTrustTransitionPreviousStateEvidence;
  readonly predicate: InstallerTrustTransitionBindingPredicateEvidence;
  readonly previousRelationalState: InstallerTrustTransitionPreviousStateEvidence | null;
  readonly proofPrefix: Readonly<{
    readonly acknowledgedThrough: number;
    readonly observationCount: number | null;
    readonly sha256: string | null;
  }>;
  readonly repairFailedPredicate: InstallerTrustTransitionFailedPredicateEvidence | null;
}

export type InstallerTrustTransitionAnyBindingDiagnosticEvidence =
  | InstallerTrustTransitionLegacyBindingDiagnosticEvidence
  | InstallerTrustTransitionBindingDiagnosticEvidence;

interface RelationalState {
  readonly activeAuthority: "absent" | "present";
  readonly failureCode: InstallerFailureCode | null;
  readonly failureResource: "absent" | "present";
  readonly order: number;
  readonly phase: InstallerTrustTransitionPreviousStateEvidence["phase"];
  readonly releaseAuthority: "absent" | "present";
  readonly shellAuthority: "absent" | "present";
  readonly storeState: InstallerTrustFaultStoreState;
  readonly transferState: InstallerTrustFaultTransferState;
  readonly uiState: InstallerTrustFaultUiState;
}

const STORE_STATES = new Set<string>(INSTALLER_TRUST_FAULT_STORE_STATES);
const TRANSFER_STATES = new Set<string>(INSTALLER_TRUST_FAULT_TRANSFER_STATES);
const UI_STATES = new Set<string>(INSTALLER_TRUST_FAULT_UI_STATES);
const FAILURE_CODES = new Set<string>(INSTALLER_FAILURE_RULES.map((rule) => rule.code));
const diagnostics = new WeakMap<
  TrustedTransitionBindingError,
  InstallerTrustTransitionAnyBindingDiagnosticEvidence
>();

class TrustedTransitionBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallerTrustTransitionBindingError";
  }
}

export function createInstallerTrustTransitionBoundaryError(input: unknown): Error {
  const failure = record(input, "transition queue failure");
  if (failure.name === "InstallerTrustTransitionQueueInternalError") {
    exactKeys(failure, [
      "bindingDiagnostic",
      "message",
      "name",
      "order",
      "queueInternalCause",
      "relationalState",
    ]);
    if (
      failure.bindingDiagnostic !== null ||
      failure.message !== INSTALLER_TRUST_TRANSITION_QUEUE_INTERNAL_MESSAGE ||
      !Number.isSafeInteger(failure.order) ||
      (failure.order as number) < 0 ||
      failure.relationalState !== null ||
      !isBoundedQueueInternalCause(failure.queueInternalCause)
    ) {
      throw new Error("Installer transition queue-internal failure is invalid");
    }
    const error = new Error(INSTALLER_TRUST_TRANSITION_QUEUE_INTERNAL_MESSAGE, {
      cause: failure.queueInternalCause,
    });
    error.name = "InstallerTrustTransitionQueueInternalError";
    return error;
  }
  exactKeys(failure, ["bindingDiagnostic", "message", "name", "order", "relationalState"]);
  if (
    (failure.name !== "InstallerTrustTransitionBarrierError" &&
      failure.name !== "InstallerTrustTransitionBindingError") ||
    typeof failure.message !== "string" ||
    failure.message.length < 1 ||
    failure.message.length > 2_000 ||
    !Number.isSafeInteger(failure.order) ||
    (failure.order as number) < 0
  ) {
    throw new Error("Installer transition queue failure identity is invalid");
  }
  if (failure.bindingDiagnostic === null) {
    if (
      (failure.name === "InstallerTrustTransitionBarrierError") !==
      (failure.relationalState === null)
    ) {
      throw new Error("Installer transition queue failure state is contradictory");
    }
    if (failure.relationalState !== null) {
      const state = parseRelationalState(failure.relationalState, "current relational state");
      if (state.order !== failure.order) {
        throw new Error("Installer transition binding current state order is contradictory");
      }
    }
    const error = new Error(
      failure.name === "InstallerTrustTransitionBarrierError"
        ? "Installer transition barrier failed"
        : "Installer transition proof binding failed",
    );
    error.name = failure.name;
    return error;
  }
  if (failure.name !== "InstallerTrustTransitionBindingError" || (failure.order as number) < 1) {
    throw new Error("Installer transition binding failure identity is invalid");
  }
  const current = parseRelationalState(failure.relationalState, "current relational state");
  if (current.order !== failure.order) {
    throw new Error("Installer transition binding current state order is contradictory");
  }
  const rawDiagnostic = record(failure.bindingDiagnostic, "transition binding diagnostic");
  if (Object.hasOwn(rawDiagnostic, "predicate")) {
    return createCurrentBoundaryError(failure, current, rawDiagnostic);
  }
  if (failure.message !== INSTALLER_TRUST_TRANSITION_BINDING_FAILURE_MESSAGE) {
    throw new Error("Installer transition binding legacy failure message is invalid");
  }
  exactKeys(rawDiagnostic, ["failedPredicate", "previousRelationalState"]);
  if (
    typeof rawDiagnostic.failedPredicate !== "string" ||
    !isFailedPredicate(rawDiagnostic.failedPredicate)
  ) {
    throw new Error("Installer transition binding failed predicate is invalid");
  }
  const previous = parseRelationalState(
    rawDiagnostic.previousRelationalState,
    "previous relational state",
  );
  if (previous.order >= current.order) {
    throw new Error("Installer transition binding previous state order is contradictory");
  }
  validateDiagnosticRelationship(rawDiagnostic.failedPredicate, current, previous);
  const diagnostic = Object.freeze({
    failedPredicate: rawDiagnostic.failedPredicate,
    previousRelationalState: compact(previous),
  });
  const error = new TrustedTransitionBindingError(
    INSTALLER_TRUST_TRANSITION_BINDING_FAILURE_MESSAGE,
  );
  diagnostics.set(error, diagnostic);
  return error;
}

function isBoundedQueueInternalCause(input: unknown): input is string {
  return (
    typeof input === "string" &&
    input.length >= 1 &&
    input.length <= 400 &&
    /^(?:error|non-error-(?:bigint|boolean|function|null|number|object|string|symbol|undefined)): [ A-Za-z0-9.,:;_()'!?-]+$/u.test(
      input,
    ) &&
    !/\b(?:authorization|bearer|token|secret|password|passwd|credential|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|auth[_-]?token|id[_-]?token)\b/iu.test(
      input,
    )
  );
}

export function readTrustedInstallerTrustTransitionBindingDiagnostic(
  input: unknown,
): InstallerTrustTransitionAnyBindingDiagnosticEvidence | null {
  if (
    !(input instanceof TrustedTransitionBindingError) ||
    Object.getPrototypeOf(input) !== TrustedTransitionBindingError.prototype
  ) {
    return null;
  }
  return diagnostics.get(input) ?? null;
}

function createCurrentBoundaryError(
  failure: Record<string, unknown>,
  current: RelationalState,
  rawDiagnostic: Record<string, unknown>,
): Error {
  if (failure.message !== INSTALLER_TRUST_TRANSITION_REJECTION_MESSAGE) {
    throw new Error("Installer transition binding rejection message is invalid");
  }
  exactKeys(rawDiagnostic, [
    "currentRelationalState",
    "predicate",
    "previousRelationalState",
    "proofPrefix",
    "repairFailedPredicate",
  ]);
  if (
    rawDiagnostic.predicate !== "binding-absent" &&
    rawDiagnostic.predicate !== "binding-outcome-invalid" &&
    rawDiagnostic.predicate !== "binding-transport-rejected" &&
    rawDiagnostic.predicate !== "transition-model-rejected"
  ) {
    throw new Error("Installer transition binding predicate is invalid");
  }
  const diagnosticCurrent = parseRelationalState(
    rawDiagnostic.currentRelationalState,
    "diagnostic current relational state",
  );
  if (!sameRelationalState(current, diagnosticCurrent)) {
    throw new Error("Installer transition binding current states are contradictory");
  }
  const previous =
    rawDiagnostic.previousRelationalState === null
      ? null
      : parseRelationalState(rawDiagnostic.previousRelationalState, "previous relational state");
  const prefix = record(rawDiagnostic.proofPrefix, "transition proof prefix");
  exactKeys(prefix, ["acknowledgedThrough", "observationCount", "sha256"]);
  if (
    !Number.isSafeInteger(prefix.acknowledgedThrough) ||
    (prefix.acknowledgedThrough as number) < 0 ||
    (prefix.observationCount !== null &&
      (!Number.isSafeInteger(prefix.observationCount) ||
        (prefix.observationCount as number) < 0)) ||
    (prefix.sha256 !== null &&
      (typeof prefix.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(prefix.sha256))) ||
    (prefix.observationCount === null) !== (prefix.sha256 === null) ||
    (rawDiagnostic.predicate === "transition-model-rejected" &&
      prefix.observationCount !== null &&
      prefix.observationCount !== prefix.acknowledgedThrough) ||
    (rawDiagnostic.predicate !== "transition-model-rejected" &&
      (prefix.observationCount !== null || prefix.sha256 !== null)) ||
    current.order !== (prefix.acknowledgedThrough as number) + 1 ||
    (previous === null) !== (prefix.acknowledgedThrough === 0) ||
    (previous !== null && previous.order !== prefix.acknowledgedThrough)
  ) {
    throw new Error("Installer transition binding proof prefix is contradictory");
  }
  if (
    rawDiagnostic.repairFailedPredicate !== null &&
    (typeof rawDiagnostic.repairFailedPredicate !== "string" ||
      !isFailedPredicate(rawDiagnostic.repairFailedPredicate))
  ) {
    throw new Error("Installer transition repair predicate is invalid");
  }
  if (
    rawDiagnostic.repairFailedPredicate !== null &&
    rawDiagnostic.predicate !== "transition-model-rejected"
  ) {
    throw new Error("Installer transition binding predicate cannot carry a Repair predicate");
  }
  if (rawDiagnostic.repairFailedPredicate !== null) {
    if (previous === null) {
      throw new Error("Installer transition repair diagnostic lacks previous state");
    }
    validateDiagnosticRelationship(rawDiagnostic.repairFailedPredicate, current, previous);
  }
  const diagnostic = Object.freeze({
    currentRelationalState: compact(current),
    predicate: rawDiagnostic.predicate,
    previousRelationalState: previous === null ? null : compact(previous),
    proofPrefix: Object.freeze({
      acknowledgedThrough: prefix.acknowledgedThrough as number,
      observationCount: prefix.observationCount as number | null,
      sha256: prefix.sha256 as string | null,
    }),
    repairFailedPredicate:
      rawDiagnostic.repairFailedPredicate as InstallerTrustTransitionFailedPredicateEvidence | null,
  });
  const error = new TrustedTransitionBindingError(INSTALLER_TRUST_TRANSITION_REJECTION_MESSAGE);
  diagnostics.set(error, diagnostic);
  return error;
}

function sameRelationalState(left: RelationalState, right: RelationalState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseRelationalState(input: unknown, label: string): RelationalState {
  const state = record(input, label);
  exactKeys(state, [
    "activeAuthority",
    "failureCode",
    "failureResource",
    "order",
    "phase",
    "releaseAuthority",
    "shellAuthority",
    "storeState",
    "transferState",
    "uiState",
  ]);
  if (
    (state.activeAuthority !== "absent" && state.activeAuthority !== "present") ||
    (state.failureCode !== null &&
      (typeof state.failureCode !== "string" || !FAILURE_CODES.has(state.failureCode))) ||
    (state.failureResource !== "absent" && state.failureResource !== "present") ||
    (state.failureCode === null && state.failureResource !== "absent") ||
    !Number.isSafeInteger(state.order) ||
    (state.order as number) < 1 ||
    (state.phase !== "attempt-1" &&
      state.phase !== "attempt-2" &&
      state.phase !== "seed" &&
      state.phase !== "setup") ||
    (state.releaseAuthority !== "absent" && state.releaseAuthority !== "present") ||
    (state.shellAuthority !== "absent" && state.shellAuthority !== "present") ||
    typeof state.storeState !== "string" ||
    !STORE_STATES.has(state.storeState) ||
    typeof state.transferState !== "string" ||
    !TRANSFER_STATES.has(state.transferState) ||
    typeof state.uiState !== "string" ||
    !UI_STATES.has(state.uiState)
  ) {
    throw new Error(`Installer transition binding ${label} is invalid`);
  }
  return Object.freeze({
    activeAuthority: state.activeAuthority,
    failureCode: state.failureCode as InstallerFailureCode | null,
    failureResource: state.failureResource,
    order: state.order as number,
    phase: state.phase,
    releaseAuthority: state.releaseAuthority,
    shellAuthority: state.shellAuthority,
    storeState: state.storeState as InstallerTrustFaultStoreState,
    transferState: state.transferState as InstallerTrustFaultTransferState,
    uiState: state.uiState as InstallerTrustFaultUiState,
  });
}

function validateDiagnosticRelationship(
  predicate: InstallerTrustTransitionFailedPredicateEvidence,
  current: RelationalState,
  previous: RelationalState,
): void {
  const currentIsPrecursor = isPrecursor(current);
  const previousIsRevokedFinalization = isRevokedFinalization(previous);
  if (
    (predicate === "current-not-precursor" && !currentIsPrecursor) ||
    (predicate === "previous-not-revoked-finalization" &&
      currentIsPrecursor &&
      !previousIsRevokedFinalization) ||
    (predicate === "previous-revoked-store-not-idle-or-verifying" &&
      currentIsPrecursor &&
      previousIsRevokedFinalization &&
      (previous.storeState === "reconciling" || previous.storeState === "writing"))
  ) {
    return;
  }
  throw new Error("Installer transition binding diagnostic is contradictory");
}

function compact(state: RelationalState): InstallerTrustTransitionPreviousStateEvidence {
  return Object.freeze({
    active: state.activeAuthority === "present",
    failure: state.failureCode,
    order: state.order,
    phase: state.phase,
    release: state.releaseAuthority === "present",
    resource: state.failureResource === "present",
    shell: state.shellAuthority === "present",
    store: state.storeState,
    transfer: state.transferState,
    ui: state.uiState,
  });
}

function isFailedPredicate(
  input: string,
): input is InstallerTrustTransitionFailedPredicateEvidence {
  return (
    input === "current-not-precursor" ||
    input === "previous-not-revoked-finalization" ||
    input === "previous-revoked-store-not-idle-or-verifying"
  );
}

function isPrecursor(state: RelationalState): boolean {
  return (
    state.phase === "attempt-1" &&
    state.transferState === "verifying" &&
    state.storeState === "failed" &&
    state.uiState === "repairing" &&
    state.activeAuthority === "absent" &&
    state.releaseAuthority === "present" &&
    state.shellAuthority === "present" &&
    state.failureCode === null &&
    state.failureResource === "absent"
  );
}

function isRevokedFinalization(state: RelationalState): boolean {
  return (
    state.phase === "attempt-1" &&
    state.transferState === "verifying" &&
    (state.storeState === "idle" ||
      state.storeState === "reconciling" ||
      state.storeState === "writing" ||
      state.storeState === "verifying") &&
    state.uiState === "repairing" &&
    state.activeAuthority === "absent" &&
    state.releaseAuthority === "present" &&
    state.shellAuthority === "present" &&
    state.failureCode === null &&
    state.failureResource === "absent"
  );
}

function record(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`Installer ${label} is not an object`);
  }
  return input as Record<string, unknown>;
}

function exactKeys(input: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(input).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    throw new Error("Installer transition binding diagnostic contains unknown fields");
  }
}
