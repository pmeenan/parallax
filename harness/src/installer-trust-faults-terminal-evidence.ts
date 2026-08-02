import type { InstallerTrustFaultCellId } from "./installer-trust-faults-result.js";
import type { InstallerTrustFaultTransitionProof } from "./installer-trust-faults-transition-proof.js";

export const INSTALLER_TRUST_FAULT_CORRECTNESS_CEILING_MS = 30 * 60_000;
export const INSTALLER_TRUST_FAULT_TERMINAL_EVIDENCE_ERROR_NAME =
  "InstallerTrustFaultCellTerminalEvidenceError";

const MAX_FAILURE_DEPTH = 8;
const MAX_AGGREGATE_MEMBERS = 8;

export interface InstallerTrustFaultCellTerminalEvidence {
  readonly faultResourceId: string;
  readonly id: InstallerTrustFaultCellId;
  readonly terminal: unknown;
  readonly transitions: InstallerTrustFaultTransitionProof;
}

export class InstallerTrustFaultCellTerminalEvidenceError extends Error {
  public constructor(
    public readonly cellId: InstallerTrustFaultCellId,
    public readonly faultResourceId: string,
    public readonly terminal: unknown,
    public readonly transitions: InstallerTrustFaultTransitionProof,
    cause: unknown,
  ) {
    super(`Installer trust-fault cell ${cellId} retained an unexpected product terminal`, {
      cause,
    });
    this.name = INSTALLER_TRUST_FAULT_TERMINAL_EVIDENCE_ERROR_NAME;
  }
}

export function findInstallerTrustFaultCellTerminalEvidence(
  error: unknown,
): InstallerTrustFaultCellTerminalEvidence | null {
  const found: InstallerTrustFaultCellTerminalEvidenceError[] = [];
  const seen = new WeakSet<object>();
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > MAX_FAILURE_DEPTH || typeof candidate !== "object" || candidate === null) return;
    if (seen.has(candidate)) return;
    seen.add(candidate);
    if (candidate instanceof InstallerTrustFaultCellTerminalEvidenceError) {
      found.push(candidate);
    }
    if (candidate instanceof AggregateError) {
      for (const member of candidate.errors.slice(0, MAX_AGGREGATE_MEMBERS)) {
        visit(member, depth + 1);
      }
    }
    if (candidate instanceof Error && "cause" in candidate) {
      visit(candidate.cause, depth + 1);
    }
  };
  visit(error, 0);
  if (found.length === 0) return null;
  if (found.length !== 1) {
    throw new Error("Installer trust-fault failure graph has contradictory failed-cell evidence");
  }
  const retained = found[0];
  if (retained === undefined) return null;
  return Object.freeze({
    faultResourceId: retained.faultResourceId,
    id: retained.cellId,
    terminal: retained.terminal,
    transitions: retained.transitions,
  });
}
