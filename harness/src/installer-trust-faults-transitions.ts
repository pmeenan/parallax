import { createHash } from "node:crypto";
import type { InstallerFailureCode } from "@parallax/engine";

export const INSTALLER_TRUST_FAULT_MAX_CANONICAL_TRANSITIONS = 512;

export const INSTALLER_TRUST_FAULT_PHASES = ["attempt-1", "attempt-2", "seed", "setup"] as const;
export const INSTALLER_TRUST_FAULT_UI_STATES = [
  "cancelled",
  "cancelling",
  "checking",
  "failed",
  "idle",
  "installing",
  "launched",
  "launching",
  "ready",
  "repairing",
  "requesting-persistence",
] as const;
export const INSTALLER_TRUST_FAULT_TRANSFER_STATES = [
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
] as const;
export const INSTALLER_TRUST_FAULT_STORE_STATES = [
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
] as const;
const INSTALLER_TRUST_FAULT_FAILURE_CODE_VALUES = [
  "cancel-target-invalid",
  "cancelled",
  "concurrent-install",
  "disposed",
  "install-manifest-invalid",
  "integrity",
  "protocol",
  "quota",
  "repair-target-mismatch",
  "shell-incompatible",
  "store",
  "transport",
  "unknown",
  "validator",
] as const satisfies readonly InstallerFailureCode[];
type ExactInstallerFailureCodeDomain<T extends readonly InstallerFailureCode[]> =
  Exclude<InstallerFailureCode, T[number]> extends never ? T : never;
export const INSTALLER_TRUST_FAULT_FAILURE_CODES: ExactInstallerFailureCodeDomain<
  typeof INSTALLER_TRUST_FAULT_FAILURE_CODE_VALUES
> = INSTALLER_TRUST_FAULT_FAILURE_CODE_VALUES;
export const INSTALLER_TRUST_FAULT_OPTIONAL_FAILURE_CODES = [
  null,
  ...INSTALLER_TRUST_FAULT_FAILURE_CODES,
] as const;
export const INSTALLER_TRUST_FAULT_BOUND_AUTHORITY_VALUES = ["absent", "expected"] as const;
export const INSTALLER_TRUST_FAULT_BOUND_FAILURE_RESOURCE_VALUES = [
  "absent",
  "fault-resource",
] as const;

export type InstallerTrustFaultPhase = (typeof INSTALLER_TRUST_FAULT_PHASES)[number];
export type InstallerTrustFaultUiState = (typeof INSTALLER_TRUST_FAULT_UI_STATES)[number];
export type InstallerTrustFaultTransferState =
  (typeof INSTALLER_TRUST_FAULT_TRANSFER_STATES)[number];
export type InstallerTrustFaultStoreState = (typeof INSTALLER_TRUST_FAULT_STORE_STATES)[number];

export interface InstallerTrustFaultTransition {
  readonly activeReleaseDigest: string | null;
  readonly failureCode: InstallerFailureCode | null;
  readonly failureResourceId: string | null;
  readonly order: number;
  readonly phase: InstallerTrustFaultPhase;
  readonly releaseDigest: string | null;
  readonly shellGenerationId: string | null;
  readonly storeState: InstallerTrustFaultStoreState;
  readonly transferState: InstallerTrustFaultTransferState;
  readonly uiState: InstallerTrustFaultUiState;
}

export type InstallerTrustFaultLegacyTransitions = readonly InstallerTrustFaultTransition[];

const SHA256 = /^[a-f0-9]{64}$/u;
const RESOURCE_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u;
const PHASES = new Set<string>(INSTALLER_TRUST_FAULT_PHASES);
const UI_STATES = new Set<string>(INSTALLER_TRUST_FAULT_UI_STATES);
const TRANSFER_STATES = new Set<string>(INSTALLER_TRUST_FAULT_TRANSFER_STATES);
export const INSTALLER_TRUST_FAULT_MAX_ATTEMPT_MILESTONES =
  TRANSFER_STATES.size * (TRANSFER_STATES.size - 1) + 1;
const STORE_STATES = new Set<string>(INSTALLER_TRUST_FAULT_STORE_STATES);
const FAILURE_CODES = new Set<string>(INSTALLER_TRUST_FAULT_FAILURE_CODES);

export interface InstallerTrustFaultCanonicalTransitionCapture {
  readonly complete: boolean;
  readonly diagnostics: InstallerTrustFaultTransitionDiagnostics;
  readonly events: InstallerTrustFaultLegacyTransitions;
  readonly observedCount: number;
  readonly omittedSemanticCount: number;
}

const TRANSITION_DIMENSIONS = [
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

type InstallerTrustFaultTransitionDimension = (typeof TRANSITION_DIMENSIONS)[number];

export interface InstallerTrustFaultTransitionDiagnostics {
  readonly dimensionChangeCounts: Readonly<Record<InstallerTrustFaultTransitionDimension, number>>;
  readonly firstOrder: number | null;
  readonly lastOrder: number | null;
  readonly observedCount: number;
  readonly semanticBoundaryCount: number;
  readonly sha256: string;
}

export interface InstallerTrustFaultAttemptMilestoneProjection {
  readonly diagnostics: InstallerTrustFaultTransitionDiagnostics;
  readonly milestones: readonly string[];
}

export function canonicalizeInstallerTrustFaultTransitions(
  input: readonly InstallerTrustFaultTransition[],
): InstallerTrustFaultCanonicalTransitionCapture {
  return canonicalizeInstallerTrustFaultTransitionSequence(input, "full");
}

export function canonicalizeInstallerTrustFaultTransitionWindow(
  input: readonly InstallerTrustFaultTransition[],
): InstallerTrustFaultCanonicalTransitionCapture {
  return canonicalizeInstallerTrustFaultTransitionSequence(input, "window");
}

export function projectInstallerTrustFaultAttemptMilestones(
  input: readonly InstallerTrustFaultTransition[],
): InstallerTrustFaultAttemptMilestoneProjection {
  const validated = validateInstallerTrustFaultTransitionSequence(input, false, "window");
  const seenEdges = new Set<string>();
  const milestones: string[] = [];
  let previousState: string | null = null;
  for (const transition of validated) {
    const currentState = transition.transferState;
    if (previousState === null) {
      milestones.push(currentState);
    } else if (currentState !== previousState) {
      const edge = `${previousState}\n${currentState}`;
      if (!seenEdges.has(edge)) {
        seenEdges.add(edge);
        milestones.push(currentState);
      }
    }
    previousState = currentState;
  }
  if (milestones.length > INSTALLER_TRUST_FAULT_MAX_ATTEMPT_MILESTONES) {
    throw new Error("Installer trust-fault attempt milestone projection exceeded its finite state");
  }
  return Object.freeze({
    diagnostics: transitionDiagnostics(validated),
    milestones: Object.freeze(milestones),
  });
}

function canonicalizeInstallerTrustFaultTransitionSequence(
  input: readonly InstallerTrustFaultTransition[],
  orderMode: "full" | "window",
): InstallerTrustFaultCanonicalTransitionCapture {
  const validated = validateInstallerTrustFaultTransitionSequence(input, false, orderMode);
  const events: InstallerTrustFaultTransition[] = [];
  let omittedSemanticCount = 0;
  let previousKey: string | null = null;
  for (const transition of validated) {
    const key = installerTrustFaultTransitionSemanticKey(transition);
    if (key === previousKey) continue;
    previousKey = key;
    if (events.length >= INSTALLER_TRUST_FAULT_MAX_CANONICAL_TRANSITIONS) {
      omittedSemanticCount += 1;
      continue;
    }
    events.push(
      Object.freeze({
        ...transition,
        order: events.length + 1,
      }),
    );
  }
  return Object.freeze({
    complete: omittedSemanticCount === 0,
    diagnostics: transitionDiagnostics(validated),
    events: Object.freeze(events),
    observedCount: validated.length,
    omittedSemanticCount,
  });
}

export function validateCanonicalInstallerTrustFaultTransitions(
  input: unknown,
): InstallerTrustFaultLegacyTransitions {
  return validateInstallerTrustFaultTransitionSequence(input, true, "full");
}

export function installerTrustFaultTransitionSemanticKey(
  transition: InstallerTrustFaultTransition | undefined,
): string {
  if (transition === undefined) return "";
  const semanticStoreState =
    transition.transferState === "failed" ||
    transition.transferState === "ready" ||
    transition.uiState === "failed" ||
    transition.uiState === "ready"
      ? transition.storeState
      : transition.storeState === "failed" || transition.storeState === "ready"
        ? transition.storeState
        : null;
  return JSON.stringify([
    transition.phase,
    transition.activeReleaseDigest,
    transition.failureCode,
    transition.failureResourceId,
    transition.releaseDigest,
    transition.shellGenerationId,
    semanticStoreState,
    transition.transferState,
    transition.uiState,
  ]);
}

function validateInstallerTrustFaultTransitionSequence(
  input: unknown,
  requireCanonicalBound: boolean,
  orderMode: "full" | "window",
): InstallerTrustFaultLegacyTransitions {
  if (
    !Array.isArray(input) ||
    (requireCanonicalBound &&
      (input.length < 2 || input.length > INSTALLER_TRUST_FAULT_MAX_CANONICAL_TRANSITIONS))
  ) {
    throw new Error("Installer trust-fault raw transitions are not bounded");
  }
  let firstOrder: number | null = null;
  const transitions = Object.freeze(
    input.map((raw, index) => {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error(`Installer trust-fault transition at index ${index} is not a record`);
      }
      const transition = raw as Record<string, unknown>;
      if (
        Object.keys(transition).sort().join("\n") !==
        [
          "activeReleaseDigest",
          "failureCode",
          "failureResourceId",
          "order",
          "phase",
          "releaseDigest",
          "shellGenerationId",
          "storeState",
          "transferState",
          "uiState",
        ]
          .sort()
          .join("\n")
      ) {
        throw new Error(`Installer trust-fault transition at index ${index} has invalid fields`);
      }
      const observedOrder = transition.order;
      if (!Number.isSafeInteger(observedOrder) || (observedOrder as number) <= 0) {
        throw new Error(`Installer trust-fault transition at index ${index} has invalid order`);
      }
      if (firstOrder === null) firstOrder = observedOrder as number;
      const expectedOrder = orderMode === "full" ? index + 1 : firstOrder + index;
      if (observedOrder !== expectedOrder) {
        throw new Error(
          `Installer trust-fault transition at index ${index} has order ${observedOrder}; expected contiguous order ${expectedOrder}`,
        );
      }
      if (
        !nullableDigest(transition.activeReleaseDigest) ||
        typeof transition.phase !== "string" ||
        !PHASES.has(transition.phase) ||
        typeof transition.uiState !== "string" ||
        !UI_STATES.has(transition.uiState) ||
        typeof transition.transferState !== "string" ||
        !TRANSFER_STATES.has(transition.transferState) ||
        typeof transition.storeState !== "string" ||
        !STORE_STATES.has(transition.storeState) ||
        !nullableDigest(transition.releaseDigest) ||
        (transition.shellGenerationId !== null &&
          (typeof transition.shellGenerationId !== "string" ||
            transition.shellGenerationId.length < 1 ||
            transition.shellGenerationId.length > 256 ||
            !/^[A-Za-z0-9._:-]+$/u.test(transition.shellGenerationId))) ||
        (transition.failureCode !== null &&
          (typeof transition.failureCode !== "string" ||
            !FAILURE_CODES.has(transition.failureCode))) ||
        (transition.failureResourceId !== null &&
          (typeof transition.failureResourceId !== "string" ||
            !RESOURCE_ID.test(transition.failureResourceId)))
      ) {
        throw new Error(`Installer trust-fault transition at index ${index} is invalid`);
      }
      return Object.freeze({ ...transition }) as unknown as InstallerTrustFaultTransition;
    }),
  );
  if (
    requireCanonicalBound &&
    transitions.some(
      (transition, index) =>
        index > 0 &&
        installerTrustFaultTransitionSemanticKey(transition) ===
          installerTrustFaultTransitionSemanticKey(transitions[index - 1]),
    )
  ) {
    throw new Error("Installer trust-fault transitions are not in canonical semantic form");
  }
  return transitions;
}

export function validateInstallerTrustFaultTransitionObservation(
  input: unknown,
  expectedOrder: number,
): InstallerTrustFaultTransition {
  const transition = validateInstallerTrustFaultTransitionSequence([input], false, "window")[0];
  if (transition === undefined || transition.order !== expectedOrder) {
    throw new Error(
      `Installer trust-fault transition has order ${transition?.order ?? "absent"}; expected ${expectedOrder}`,
    );
  }
  return transition;
}

function nullableDigest(value: unknown): boolean {
  return value === null || (typeof value === "string" && SHA256.test(value));
}

function transitionDiagnostics(
  transitions: InstallerTrustFaultLegacyTransitions,
): InstallerTrustFaultTransitionDiagnostics {
  const dimensionChangeCounts = Object.fromEntries(
    TRANSITION_DIMENSIONS.map((dimension) => [dimension, 0]),
  ) as Record<InstallerTrustFaultTransitionDimension, number>;
  let semanticBoundaryCount = 0;
  let previousSemanticKey: string | null = null;
  for (let index = 0; index < transitions.length; index += 1) {
    const transition = transitions[index];
    if (transition === undefined) continue;
    const semanticKey = installerTrustFaultTransitionSemanticKey(transition);
    if (semanticKey !== previousSemanticKey) {
      semanticBoundaryCount += 1;
      previousSemanticKey = semanticKey;
    }
    const previous = transitions[index - 1];
    if (previous === undefined) continue;
    for (const dimension of TRANSITION_DIMENSIONS) {
      if (transition[dimension] !== previous[dimension]) {
        dimensionChangeCounts[dimension] += 1;
      }
    }
  }
  const digestInput = transitions.map((transition) =>
    TRANSITION_DIMENSIONS.map((dimension) => transition[dimension]),
  );
  return Object.freeze({
    dimensionChangeCounts: Object.freeze(dimensionChangeCounts),
    firstOrder: transitions[0]?.order ?? null,
    lastOrder: transitions.at(-1)?.order ?? null,
    observedCount: transitions.length,
    semanticBoundaryCount,
    sha256: createHash("sha256").update(JSON.stringify(digestInput)).digest("hex"),
  });
}
