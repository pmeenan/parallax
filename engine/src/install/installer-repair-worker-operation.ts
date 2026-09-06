import type { InstallerRepairAdmission } from "../storage/opfs-release-store";
import type { InstallerManifestIdentity } from "./installer-build-manifest";
import type {
  InstallerInstallResult,
  InstallerResponse,
  InstallerTransferTelemetrySnapshot,
} from "./installer-protocol";
import { parseInstallerRequest } from "./installer-protocol";
import { type InstallerRepairOperationStore, repairInstalledRelease } from "./installer-repair";
import { assertInstallerRepairExpectedRelease } from "./installer-target";
import type {
  InstallerTransferInput,
  InstallerTransferObserver,
  InstallerTransferPlatform,
} from "./installer-transfer";
import { InstallerTransferError } from "./installer-transfer";

export interface InstallerRepairTelemetryController {
  accumulate(partial: Partial<InstallerTransferTelemetrySnapshot>): void;
  snapshot(): InstallerTransferTelemetrySnapshot;
  update(partial: Partial<InstallerTransferTelemetrySnapshot>): void;
}

export interface InstallerRepairCompletionCredit {
  readonly releaseDigest: string;
  readonly resourceCount: number;
  readonly totalBytes: number;
  readonly lifetimeResourceCount: number;
  readonly lifetimeVerifiedBytes: number;
}

export interface InstallerRepairWorkerOperationInput {
  readonly admission: InstallerRepairAdmission | null;
  readonly beginCompletion: () => void;
  readonly identity: InstallerManifestIdentity;
  readonly observer: InstallerTransferObserver;
  readonly request: unknown;
  readonly signal: AbortSignal;
  readonly store: InstallerRepairOperationStore;
  readonly transferInput: InstallerTransferInput;
  readonly transferPlatform: InstallerTransferPlatform;
}

/**
 * The explicit Repair operation invoked by the installer worker after it has
 * acquired the transfer lock and established target/quota authority. Harness
 * replay calls this same protocol-parsing operation with the same store and
 * public telemetry observer.
 */
export async function executeInstallerRepairWorkerOperation(
  input: InstallerRepairWorkerOperationInput,
): Promise<InstallerInstallResult> {
  const request = parseInstallerRequest(input.request);
  if (request.kind !== "repair") {
    throw new Error("Installer Repair worker operation requires an exact repair request");
  }
  assertInstallerRepairExpectedRelease(request.expectedReleaseDigest, input.identity.releaseDigest);
  const opfsSummary = input.identity.installManifest.summary;
  await repairInstalledRelease({
    admission: input.admission,
    beginCompletion: input.beginCompletion,
    expectedBytes: opfsSummary.bytesByTarget.opfs,
    expectedResourceCount: opfsSummary.countByTarget.opfs,
    observer: input.observer,
    resources: input.identity.installManifest.manifest.resources,
    signal: input.signal,
    store: input.store,
    transferInput: input.transferInput,
    transferPlatform: input.transferPlatform,
  });
  return Object.freeze({
    readyBytes: opfsSummary.bytesByTarget.opfs,
    readyResourceCount: opfsSummary.countByTarget.opfs,
    releaseDigest: input.identity.releaseDigest,
  });
}

export function createInstallerRepairCompleteResponse(
  input: unknown,
  result: InstallerInstallResult,
): Extract<InstallerResponse, { readonly kind: "install-complete" }> {
  const request = parseInstallerRequest(input);
  if (request.kind !== "repair") {
    throw new Error("Installer Repair response requires an exact repair request");
  }
  return Object.freeze({
    kind: "install-complete",
    readyBytes: result.readyBytes,
    readyResourceCount: result.readyResourceCount,
    releaseDigest: result.releaseDigest,
    requestId: request.requestId,
  });
}

export function createInstallerRepairTransferObserver(
  controller: InstallerRepairTelemetryController,
  reusedResourceIds: ReadonlySet<string>,
  completionCredit: InstallerRepairCompletionCredit | null = null,
): InstallerTransferObserver {
  const plannedReusedResourceIds = new Set(reusedResourceIds);
  const update = (partial: Partial<InstallerTransferTelemetrySnapshot>): void =>
    controller.update(partial);
  const accumulate = (partial: Partial<InstallerTransferTelemetrySnapshot>): void =>
    controller.accumulate(partial);
  const current = (): InstallerTransferTelemetrySnapshot => controller.snapshot();
  const observer: InstallerTransferObserver = {
    checkpoint: (bytes) =>
      update({ checkpointedBytes: safeAdd(current().checkpointedBytes, bytes) }),
    downloaded: (bytes) =>
      accumulate({ downloadedBytes: safeAdd(current().downloadedBytes, bytes) }),
    httpRequest: (range) =>
      update({
        httpRequestCount: current().httpRequestCount + 1,
        rangeRequestCount: current().rangeRequestCount + (range ? 1 : 0),
      }),
    integrityFailure: () => update({ integrityFailureCount: current().integrityFailureCount + 1 }),
    resourceActive: (resourceId) =>
      update({
        activeResourceCount: current().activeResourceCount + 1,
        activeResourceId: resourceId,
      }),
    resourceComplete: (_resourceId, bytes) =>
      update({
        completedResourceCount: current().completedResourceCount + 1,
        verifiedBytes: safeAdd(current().verifiedBytes, bytes),
      }),
    resourceInactive: (resourceId) =>
      update({
        activeResourceCount: Math.max(0, current().activeResourceCount - 1),
        activeResourceId:
          current().activeResourceId === resourceId ? null : current().activeResourceId,
      }),
    repairCompletionCreditRevoked: (resourceId, bytes) => {
      const snapshot = current();
      if (
        completionCredit === null &&
        snapshot.completedResourceCount === 0 &&
        snapshot.verifiedBytes === 0
      ) {
        return false;
      }
      if (
        completionCredit === null ||
        snapshot.activeReleaseDigest !== completionCredit.releaseDigest ||
        snapshot.resourceCount !== completionCredit.resourceCount ||
        snapshot.totalBytes !== completionCredit.totalBytes ||
        snapshot.completedResourceCount !== completionCredit.lifetimeResourceCount ||
        snapshot.verifiedBytes !== completionCredit.lifetimeVerifiedBytes ||
        snapshot.completedResourceCount === 0 ||
        snapshot.verifiedBytes < bytes
      ) {
        throw new InstallerTransferError(
          "validator",
          "Repair completion credit is partial or inconsistent for this worker lifetime",
          resourceId,
        );
      }
      update({
        completedResourceCount: snapshot.completedResourceCount - 1,
        verifiedBytes: snapshot.verifiedBytes - bytes,
      });
      return true;
    },
    repairComplete: (_resourceId, bytes) =>
      update({
        operationRepairedBytes: safeAdd(current().operationRepairedBytes, bytes),
        operationRepairedResourceCount: current().operationRepairedResourceCount + 1,
      }),
    repairStarted: (resourceId, bytes) => {
      const plannedAsReused = plannedReusedResourceIds.delete(resourceId);
      update({
        operationRepairAttemptCount: current().operationRepairAttemptCount + 1,
        plannedDownloadBytes: plannedAsReused
          ? safeAdd(current().plannedDownloadBytes, bytes)
          : current().plannedDownloadBytes,
        reusedBytes: plannedAsReused ? current().reusedBytes - bytes : current().reusedBytes,
      });
    },
    resumed: (bytes) => update({ resumedBytes: safeAdd(current().resumedBytes, bytes) }),
    retry: () => update({ retryCount: current().retryCount + 1 }),
    transportFailure: () => update({ transportFailureCount: current().transportFailureCount + 1 }),
    validatorFailure: () => update({ validatorFailureCount: current().validatorFailureCount + 1 }),
    verified: (bytes) => update({ hashedBytes: safeAdd(current().hashedBytes, bytes) }),
  };
  return Object.freeze(observer);
}

export function resolveInstallerRepairCompletionCredit(
  snapshot: InstallerTransferTelemetrySnapshot,
  retained: InstallerRepairCompletionCredit | null,
): InstallerRepairCompletionCredit | null {
  const reset = snapshot.completedResourceCount === 0 && snapshot.verifiedBytes === 0;
  if (retained === null) {
    if (reset) return null;
    throw new InstallerTransferError(
      "validator",
      "Repair completion counters have no exact worker-lifetime credit",
      null,
    );
  }
  if (reset) return null;
  if (
    snapshot.activeReleaseDigest !== retained.releaseDigest ||
    snapshot.resourceCount !== retained.resourceCount ||
    snapshot.totalBytes !== retained.totalBytes ||
    snapshot.completedResourceCount !== retained.lifetimeResourceCount ||
    snapshot.verifiedBytes !== retained.lifetimeVerifiedBytes
  ) {
    throw new InstallerTransferError(
      "validator",
      "Repair completion credit is partial or inconsistent for this worker lifetime",
      null,
    );
  }
  return retained;
}

function safeAdd(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) throw new Error("Installer total exceeds safe integer");
  return total;
}
