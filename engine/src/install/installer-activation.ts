import type {
  InstallerRepairAdmission,
  IntegrityResult,
  ReleaseSelection,
  VerifiedObjectRef,
} from "../storage/opfs-release-store";
import { InstallStoreIntegrityError } from "../storage/opfs-release-store-contract";
import { callInstallerRepairStore } from "./installer-repair-store-operation";
import {
  InstallerQuotaError,
  InstallerStoreError,
  InstallerTransferError,
} from "./installer-transfer";

interface InstallerVerificationStore {
  verifyRelease(
    releaseDigest: string,
    listener?: (reference: VerifiedObjectRef, result: IntegrityResult) => void,
  ): Promise<Readonly<{ bytes: number; ok: boolean }>>;
}

export interface InstallerActivationStore extends InstallerVerificationStore {
  markReleaseReady(releaseDigest: string): Promise<unknown>;
  publishRelease(releaseDigest: string): Promise<ReleaseSelection>;
}

export interface InstallerRepairActivationStore extends InstallerVerificationStore {
  completeRepairRelease(admission: InstallerRepairAdmission): Promise<ReleaseSelection>;
}

export interface InstallerExistingActivationStore extends InstallerVerificationStore {
  completeRepairRelease(admission: InstallerRepairAdmission): Promise<ReleaseSelection>;
  getActiveReleaseDigest(): Promise<string | null>;
}

export async function verifyExistingInstallerRelease(input: {
  readonly expectedBytes: number;
  readonly expectedResourceCount: number;
  readonly releaseDigest: string;
  readonly repairResource?: (resourceId: string) => Promise<InstallerRepairAdmission>;
  readonly signal: AbortSignal;
  readonly store: InstallerExistingActivationStore;
  readonly transferredBytes: number;
  readonly transferredResourceCount: number;
}): Promise<ReleaseSelection> {
  throwIfAborted(input.signal);
  requireExactTransferTotals(input);
  let admission: InstallerRepairAdmission | null = null;
  let repairCycles = 0;
  while (true) {
    let failedResourceId: string | null = null;
    const integrity = await callInstallerRepairStore(
      "verify-release",
      () => failedResourceId,
      () =>
        input.store.verifyRelease(input.releaseDigest, (reference, result) => {
          if (!result.ok && failedResourceId === null) failedResourceId = reference.resourceId;
        }),
    );
    throwIfAborted(input.signal);
    if (integrity.ok && integrity.bytes === input.expectedBytes) break;
    if (
      failedResourceId === null ||
      input.repairResource === undefined ||
      repairCycles >= input.expectedResourceCount
    ) {
      throw new InstallerTransferError(
        "integrity",
        "Existing release verification did not match the exact target bytes",
        failedResourceId,
      );
    }
    admission = await input.repairResource(failedResourceId);
    if (
      admission.releaseDigest !== input.releaseDigest ||
      admission.resourceId !== failedResourceId
    ) {
      throw new InstallerTransferError(
        "integrity",
        "Final-verification repair admission is contradictory",
        failedResourceId,
      );
    }
    repairCycles += 1;
    throwIfAborted(input.signal);
  }
  if (admission !== null) {
    return callInstallerRepairStore("complete-repair-release", admission.resourceId, () =>
      input.store.completeRepairRelease(admission),
    );
  }
  const activeReleaseDigest = await callInstallerRepairStore("get-active-release", null, () =>
    input.store.getActiveReleaseDigest(),
  );
  if (activeReleaseDigest !== input.releaseDigest) {
    throw new InstallerTransferError(
      "integrity",
      "Existing repair target is not the exact active committed release",
      null,
    );
  }
  return Object.freeze({ activeReleaseDigest, previousReleaseDigest: null });
}

export async function verifyAndRestoreInstallerRepair(input: {
  readonly admission: InstallerRepairAdmission;
  readonly expectedBytes: number;
  readonly expectedResourceCount: number;
  readonly releaseDigest: string;
  readonly signal: AbortSignal;
  readonly store: InstallerRepairActivationStore;
  readonly transferredBytes: number;
  readonly transferredResourceCount: number;
}): Promise<ReleaseSelection> {
  throwIfAborted(input.signal);
  requireExactTransferTotals(input);
  let failedResourceId: string | null = null;
  const integrity = await callInstallerRepairStore(
    "verify-release",
    () => failedResourceId,
    () =>
      input.store.verifyRelease(input.releaseDigest, (reference, result) => {
        if (!result.ok && failedResourceId === null) failedResourceId = reference.resourceId;
      }),
  );
  throwIfAborted(input.signal);
  if (!integrity.ok || integrity.bytes !== input.expectedBytes) {
    throw new InstallerTransferError(
      "integrity",
      "Repaired release verification did not match the exact target bytes",
      failedResourceId,
    );
  }
  const selection = await callInstallerRepairStore(
    "complete-repair-release",
    input.admission.resourceId,
    () => input.store.completeRepairRelease(input.admission),
  );
  if (selection.activeReleaseDigest !== input.releaseDigest) {
    throw new InstallerTransferError(
      "integrity",
      "Repair completion did not restore the exact committed active release",
      input.admission.resourceId,
    );
  }
  return selection;
}

export async function verifyAndPublishInstallerRelease(input: {
  readonly beginPublication: () => void;
  readonly expectedBytes: number;
  readonly expectedResourceCount: number;
  readonly repairResource?: (resourceId: string) => Promise<void>;
  readonly releaseDigest: string;
  readonly signal: AbortSignal;
  readonly store: InstallerActivationStore;
  readonly transferredBytes: number;
  readonly transferredResourceCount: number;
}): Promise<ReleaseSelection> {
  throwIfAborted(input.signal);
  requireExactTransferTotals(input);
  let repairCycles = 0;
  while (true) {
    let failedResourceId: string | null = null;
    const integrity = await callInstallerActivationStore(
      () => failedResourceId,
      () =>
        input.store.verifyRelease(input.releaseDigest, (reference, result) => {
          if (!result.ok && failedResourceId === null) failedResourceId = reference.resourceId;
        }),
    );
    throwIfAborted(input.signal);
    if (integrity.ok && integrity.bytes === input.expectedBytes) break;
    if (
      failedResourceId === null ||
      input.repairResource === undefined ||
      repairCycles >= input.expectedResourceCount
    ) {
      throw new InstallerTransferError(
        "integrity",
        "Release verification did not match transferred resource bytes",
        failedResourceId,
      );
    }
    await input.repairResource(failedResourceId);
    repairCycles += 1;
    throwIfAborted(input.signal);
  }
  await callInstallerActivationStore(null, () => input.store.markReleaseReady(input.releaseDigest));
  throwIfAborted(input.signal);
  input.beginPublication();
  const selection = await callInstallerActivationStore(null, () =>
    input.store.publishRelease(input.releaseDigest),
  );
  if (selection.activeReleaseDigest !== input.releaseDigest) {
    throw new Error("Published install release did not become the active selection");
  }
  return selection;
}

async function callInstallerActivationStore<T>(
  resourceAuthority: string | null | (() => string | null),
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error: unknown) {
    if (
      error instanceof InstallerQuotaError ||
      error instanceof InstallerStoreError ||
      error instanceof InstallerTransferError
    ) {
      throw error;
    }
    const resourceId =
      typeof resourceAuthority === "function" ? resourceAuthority() : resourceAuthority;
    if (error instanceof InstallStoreIntegrityError) {
      throw new InstallerTransferError("integrity", error.message, resourceId);
    }
    if (error instanceof DOMException && error.name === "QuotaExceededError") {
      throw new InstallerQuotaError(resourceId, error.message);
    }
    throw new InstallerStoreError("verify-release", resourceId, error);
  }
}

function requireExactTransferTotals(input: {
  readonly expectedBytes: number;
  readonly expectedResourceCount: number;
  readonly transferredBytes: number;
  readonly transferredResourceCount: number;
}): void {
  if (
    input.transferredBytes !== input.expectedBytes ||
    input.transferredResourceCount !== input.expectedResourceCount
  ) {
    throw new InstallerTransferError(
      "integrity",
      "Transferred release totals did not match the target manifest",
      null,
    );
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason ?? new DOMException("Install cancelled", "AbortError");
  }
}
