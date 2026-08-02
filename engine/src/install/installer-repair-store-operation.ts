import { InstallStoreIntegrityError } from "../storage/opfs-release-store-contract";
import {
  createInstallerFailureDiagnostic,
  type InstallerFailureDiagnostic,
  type InstallerFailureEvidence,
  type InstallerFailureResourcePresence,
  sanitizeInstallerFailureMessage,
} from "./installer-failure";

export type InstallerRepairStoreBoundary =
  | "admit-repair-release"
  | "complete-repair-release"
  | "find-repair-release"
  | "get-active-release"
  | "probe-quota"
  | "stage-release"
  | "verify-release";

export type InstallerRepairStoreCauseFamily =
  | "aggregate-error"
  | "dom-exception"
  | "error"
  | "install-store-integrity"
  | "non-error";

interface InstallerRepairStoreBoundaryRule {
  readonly boundary: InstallerRepairStoreBoundary;
  readonly failureEvidence: InstallerFailureEvidence;
  readonly resourcePresence: InstallerFailureResourcePresence;
}

export const INSTALLER_REPAIR_STORE_BOUNDARY_RULES: readonly InstallerRepairStoreBoundaryRule[] =
  Object.freeze([
    rule("admit-repair-release", "store-repair-admission", "required"),
    rule("complete-repair-release", "store-selection-restore", "required"),
    rule("find-repair-release", "store-repair-admission", "forbidden"),
    rule("get-active-release", "store-active-selection", "forbidden"),
    rule("probe-quota", "store-quota-probe", "forbidden"),
    rule("stage-release", "store-stage-release", "forbidden"),
    rule("verify-release", "store-verify-release", "optional"),
  ]);

export class InstallerRepairStoreOperationError extends Error {
  public readonly diagnostic: InstallerFailureDiagnostic;

  public constructor(
    public readonly boundary: InstallerRepairStoreBoundary,
    public readonly causeFamily: InstallerRepairStoreCauseFamily,
    public readonly resourceId: string | null,
    diagnostic: InstallerFailureDiagnostic,
    cause: unknown,
  ) {
    super(`Installer Repair store ${boundary} failed`, { cause });
    this.name = "InstallerRepairStoreOperationError";
    this.diagnostic = diagnostic;
  }
}

export async function callInstallerRepairStore<T>(
  boundary: InstallerRepairStoreBoundary,
  resourceAuthority: string | null | (() => string | null),
  call: () => Promise<T>,
): Promise<T> {
  const initialResourceId =
    typeof resourceAuthority === "function" ? resourceAuthority() : resourceAuthority;
  installerRepairStoreBoundaryRule(boundary, initialResourceId);
  try {
    return await call();
  } catch (error: unknown) {
    if (error instanceof InstallerRepairStoreOperationError) throw error;
    const resourceId =
      typeof resourceAuthority === "function" ? resourceAuthority() : resourceAuthority;
    const boundaryRule = installerRepairStoreBoundaryRule(boundary, resourceId);
    const family = installerRepairStoreCauseFamily(error);
    const quota = error instanceof DOMException && error.name === "QuotaExceededError";
    const integrity = error instanceof InstallStoreIntegrityError;
    const diagnostic = createInstallerFailureDiagnostic(
      quota ? "quota" : integrity ? "integrity" : "store",
      quota ? "quota" : integrity ? "installer-store" : "installer-store",
      quota ? "quota-exceeded" : boundaryRule.failureEvidence,
      repairStoreFailureMessage(boundary, family, error),
      resourceId,
      "repair",
    );
    throw new InstallerRepairStoreOperationError(boundary, family, resourceId, diagnostic, error);
  }
}

export function installerRepairStoreFailureDiagnostic(
  error: unknown,
): InstallerFailureDiagnostic | null {
  return error instanceof InstallerRepairStoreOperationError ? error.diagnostic : null;
}

export function installerRepairStoreBoundaryRule(
  boundary: InstallerRepairStoreBoundary,
  resourceId: string | null,
): InstallerRepairStoreBoundaryRule {
  const match = INSTALLER_REPAIR_STORE_BOUNDARY_RULES.find(
    (candidate) => candidate.boundary === boundary,
  );
  if (
    match === undefined ||
    (match.resourcePresence === "required" && resourceId === null) ||
    (match.resourcePresence === "forbidden" && resourceId !== null)
  ) {
    throw new Error("Installer Repair store boundary authority is invalid");
  }
  return match;
}

function installerRepairStoreCauseFamily(error: unknown): InstallerRepairStoreCauseFamily {
  if (error instanceof InstallStoreIntegrityError) return "install-store-integrity";
  if (error instanceof AggregateError) return "aggregate-error";
  if (error instanceof DOMException) return "dom-exception";
  if (error instanceof Error) return "error";
  return "non-error";
}

function repairStoreFailureMessage(
  boundary: InstallerRepairStoreBoundary,
  family: InstallerRepairStoreCauseFamily,
  error: unknown,
): string {
  const cause = sanitizeInstallerFailureMessage(error);
  return sanitizeInstallerFailureMessage(
    `Installer Repair store ${boundary} failed (${family}): ${cause}`,
  );
}

function rule(
  boundary: InstallerRepairStoreBoundary,
  failureEvidence: InstallerFailureEvidence,
  resourcePresence: InstallerFailureResourcePresence,
): InstallerRepairStoreBoundaryRule {
  return Object.freeze({ boundary, failureEvidence, resourcePresence });
}
