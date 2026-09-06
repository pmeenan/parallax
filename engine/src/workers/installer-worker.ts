import { verifyAndPublishInstallerRelease } from "../install/installer-activation";
import {
  createInstallerFailureDiagnostic,
  type InstallerFailureDiagnostic,
  type InstallerFailureOperation,
} from "../install/installer-failure";
import {
  INSTALLER_PROTOCOL_VERSION,
  type InstallerFailureClass,
  type InstallerFailureCode,
  type InstallerFailureEvidence,
  type InstallerResponse,
  type InstallerTransferTelemetrySnapshot,
  idleInstallerTransferTelemetrySnapshot,
} from "../install/installer-protocol";
import {
  callInstallerRepairStore,
  installerRepairStoreFailureDiagnostic,
} from "../install/installer-repair-store-operation";
import {
  createInstallerRepairTransferObserver,
  executeInstallerRepairWorkerOperation,
  type InstallerRepairCompletionCredit,
  resolveInstallerRepairCompletionCredit,
} from "../install/installer-repair-worker-operation";
import {
  assertInstallerRepairExpectedRelease,
  installerTargetFailureCode,
  loadInstallerTargetIdentity,
} from "../install/installer-target";
import { runInstallerRequestWithTimeout } from "../install/installer-timeout";
import {
  createBrowserInstallerTransferPlatform,
  createInstallerRepairState,
  evaluateInstallerQuotaAdmission,
  INSTALLER_QUOTA_PROBE_BYTES,
  InstallerQuotaError,
  InstallerStoreError,
  InstallerTransferError,
  type InstallerTransferObserver,
  type InstallReleasePlan,
  repairInstallResource,
  transferInstallResources,
} from "../install/installer-transfer";
import { createOpfsReleaseStore } from "../storage/opfs-release-store";
import { InstallStoreLockTimeoutError } from "../storage/opfs-release-store-contract";
import { createInstallerWorkerSession } from "./installer-worker-session";

const PRODUCTION_CONCURRENCY = 1;
const PRODUCTION_CHECKPOINT_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const RECONCILIATION_CLEANUP_LIMIT = 128;

interface InstallerWorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: InstallerResponse): void;
}

type InstallerOperationKind = "install" | "repair";

const scope = globalThis as unknown as InstallerWorkerScope;
const store = createOpfsReleaseStore();
const transferPlatform = createBrowserInstallerTransferPlatform();
let telemetry = idleInstallerTransferTelemetrySnapshot(
  PRODUCTION_CONCURRENCY,
  PRODUCTION_CHECKPOINT_BYTES,
);

const post = (message: InstallerResponse): void => scope.postMessage(message);
const publishSnapshot = (requestId: number | null = null): void => {
  post({
    kind: "snapshot",
    requestId,
    snapshot: Object.freeze({
      installStore: store.snapshot(),
      installerTransfer: Object.freeze({ ...telemetry }),
    }),
  });
};
const update = (partial: Partial<InstallerTransferTelemetrySnapshot>): void => {
  telemetry = Object.freeze({ ...telemetry, ...partial });
  publishSnapshot();
};
const accumulate = (partial: Partial<InstallerTransferTelemetrySnapshot>): void => {
  telemetry = Object.freeze({ ...telemetry, ...partial });
};

store.subscribe((snapshot) => {
  telemetry = Object.freeze({
    ...telemetry,
    finalVerificationBytes: snapshot.finalVerificationBytes,
    finalVerificationPhase: snapshot.finalVerificationPhase,
    finalVerificationResourceCount: snapshot.finalVerificationResourceCount,
    finalVerificationTotalBytes: snapshot.finalVerificationTotalBytes,
    finalVerificationTotalResourceCount: snapshot.finalVerificationTotalResourceCount,
  });
  publishSnapshot();
});

const session = createInstallerWorkerSession({
  classifyFailure,
  executeOperation: ({
    completionCredit,
    control,
    expectedReleaseDigest,
    operation,
    requestId,
    shellEntrypointPath,
    signal,
  }) =>
    installUnderLock(
      signal,
      shellEntrypointPath,
      control,
      operation,
      requestId,
      completionCredit,
      expectedReleaseDigest,
    ),
  now: () => performance.now(),
  post,
  publishSnapshot,
  requestLock: (name, signal, operation) =>
    navigator.locks.request(name, { mode: "exclusive", signal }, operation),
  snapshotTransfer: () => telemetry,
  targetStatus,
  update,
});

void initialize();

async function initialize(): Promise<void> {
  try {
    await store.reconcile({ maxCleanupEntries: RECONCILIATION_CLEANUP_LIMIT });
    post({ kind: "ready", protocolVersion: INSTALLER_PROTOCOL_VERSION });
    publishSnapshot();
  } catch (error: unknown) {
    const diagnostic = classifyFailure(error, "session");
    update({
      failureCode: diagnostic.code,
      failureClass: diagnostic.failureClass,
      failureEvidence: diagnostic.failureEvidence,
      failureExpectedReleaseDigest: null,
      failureMessage: diagnostic.message,
      failureOperation: diagnostic.operation,
      failureResourceId: diagnostic.resourceId,
      failureSource: "session",
      state: "failed",
    });
  }
}

scope.onmessageerror = (): void => session.messageError();
scope.onmessage = (event): void => session.message(event.data);

async function installUnderLock(
  signal: AbortSignal,
  shellEntrypointPath: string,
  control: { cancelable: boolean },
  operation: InstallerOperationKind,
  requestId: number,
  repairCompletionCredit: InstallerRepairCompletionCredit | null,
  expectedReleaseDigest: string | null,
): Promise<{
  readonly readyBytes: number;
  readonly readyResourceCount: number;
  readonly releaseDigest: string;
}> {
  const { buildRootUrl, identity } = await runInstallerRequestWithTimeout(
    REQUEST_TIMEOUT_MS,
    "Install target discovery timed out",
    (deadlineSignal) =>
      loadInstallerTargetIdentity({
        locationUrl: location.href,
        shellEntrypointPath,
        signal: deadlineSignal,
      }),
    undefined,
    signal,
  );
  if (operation === "repair") {
    if (expectedReleaseDigest === null) {
      throw new Error("Repair operation omitted its expected release digest");
    }
    assertInstallerRepairExpectedRelease(expectedReleaseDigest, identity.releaseDigest);
  }
  const activeBefore =
    operation === "repair"
      ? await callInstallerRepairStore("get-active-release", null, () =>
          store.getActiveReleaseDigest(),
        )
      : null;
  const repairAdmission =
    operation === "repair"
      ? await callInstallerRepairStore("find-repair-release", null, () =>
          store.findRepairRelease(identity.releaseDigest),
        )
      : null;
  if (
    operation === "repair" &&
    activeBefore !== identity.releaseDigest &&
    repairAdmission?.releaseDigest !== identity.releaseDigest
  ) {
    throw new InstallerTransferError("integrity", "Repair admission target is contradictory", null);
  }
  update({
    activeReleaseDigest: identity.releaseDigest,
    resourceCount: identity.installManifest.summary.countByTarget.opfs,
    totalBytes: identity.installManifest.summary.bytesByTarget.opfs,
  });
  if (operation === "repair") {
    await callInstallerRepairStore("stage-release", null, () =>
      store.stageRelease(identity.installManifestBytes),
    );
  } else {
    await store.stageRelease(identity.installManifestBytes);
  }
  const opfsResources = identity.installManifest.manifest.resources.filter(
    (resource) => resource.target === "opfs",
  );
  const plan = operation === "install" ? await store.planRelease(identity.releaseDigest) : null;
  if (plan === null) {
    update({
      plannedDownloadBytes: 0,
      plannedResumeBytes: 0,
      resourceCount: identity.installManifest.summary.countByTarget.opfs,
      reusedBytes: identity.installManifest.summary.bytesByTarget.opfs,
      totalBytes: identity.installManifest.summary.bytesByTarget.opfs,
    });
  } else {
    applyPlan(plan);
  }
  const plannedReusedResourceIds = new Set(
    plan?.reusedResourceIds ?? opfsResources.map((resource) => resource.id),
  );
  const plannedPartialBytes = new Map(
    plan?.partialResources.map(({ bytesCommitted, resourceId }) => [resourceId, bytesCommitted]) ??
      [],
  );
  const repairState = createInstallerRepairState();
  const operationCompletionCredit =
    operation === "repair"
      ? resolveInstallerRepairCompletionCredit(telemetry, repairCompletionCredit)
      : null;
  const observer =
    operation === "repair"
      ? createInstallerRepairTransferObserver(
          {
            accumulate,
            snapshot: () => telemetry,
            update,
          },
          plannedReusedResourceIds,
          operationCompletionCredit,
        )
      : transferObserver(plannedReusedResourceIds, plannedPartialBytes);
  update({ state: "probing-quota" });
  const [estimate, persistedState] = await Promise.all([
    navigator.storage.estimate(),
    navigator.storage.persisted(),
  ]);
  const usage = finiteNonnegative(estimate.usage);
  const quota = finiteNonnegative(estimate.quota);
  const available = quota === null || usage === null ? null : Math.max(0, quota - usage);
  const repairPeakBytes = opfsResources.reduce(
    (largest, resource) => Math.max(largest, resource.bytes),
    0,
  );
  const quotaAdmission = evaluateInstallerQuotaAdmission(
    available,
    plan === null ? repairPeakBytes : plan.largestUnverifiedResourceBytes,
  );
  update({
    persistedState,
    quotaAvailableBytes: available,
    quotaRequiredPeakBytes: quotaAdmission.requiredPeakBytes,
    quotaTotalBytes: quota,
    quotaUsageBytes: usage,
  });
  if (quotaAdmission.estimateClearlyInsufficient) {
    throw new DOMException(
      "Storage estimate is clearly insufficient for install peak",
      "QuotaExceededError",
    );
  }
  const quotaProbe =
    operation === "repair"
      ? await callInstallerRepairStore("probe-quota", null, () =>
          store.probeQuota(INSTALLER_QUOTA_PROBE_BYTES),
        )
      : await store.probeQuota(INSTALLER_QUOTA_PROBE_BYTES);
  if (!quotaProbe.completed) {
    throw new DOMException("Flushed OPFS quota probe failed", "QuotaExceededError");
  }
  update({
    quotaProbeBytes: INSTALLER_QUOTA_PROBE_BYTES,
    quotaProbeCompleted: true,
    state: "transferring",
  });
  const transferInput = {
    baseUrl: buildRootUrl,
    policy: {
      checkpointBytes: PRODUCTION_CHECKPOINT_BYTES,
      concurrency: PRODUCTION_CONCURRENCY,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
    },
    releaseDigest: identity.releaseDigest,
    repairState,
    resources: identity.installManifest.manifest.resources,
    signal,
  } as const;
  const result =
    operation === "install"
      ? await transferInstallResources(store, transferPlatform, observer, transferInput)
      : Object.freeze({
          readyBytes: identity.installManifest.summary.bytesByTarget.opfs,
          readyResourceCount: identity.installManifest.summary.countByTarget.opfs,
        });
  update({ state: "verifying" });
  const resourcesById = new Map(
    identity.installManifest.manifest.resources.map((resource) => [resource.id, resource] as const),
  );
  const activationInput = {
    expectedBytes: identity.installManifest.summary.bytesByTarget.opfs,
    expectedResourceCount: identity.installManifest.summary.countByTarget.opfs,
    releaseDigest: identity.releaseDigest,
    signal,
    store,
    transferredBytes: result.readyBytes,
    transferredResourceCount: result.readyResourceCount,
  } as const;
  if (operation === "repair") {
    const repaired = await executeInstallerRepairWorkerOperation({
      admission: repairAdmission,
      beginCompletion: () => {
        control.cancelable = false;
      },
      identity,
      observer,
      request: {
        expectedReleaseDigest: expectedReleaseDigest as string,
        kind: "repair",
        requestId,
        shellEntrypointPath,
      },
      signal,
      store,
      transferInput,
      transferPlatform,
    });
    return repaired;
  }
  await verifyAndPublishInstallerRelease({
    ...activationInput,
    beginPublication: () => {
      control.cancelable = false;
    },
    repairResource: async (resourceId: string) => {
      const resource = resourcesById.get(resourceId);
      if (resource === undefined || resource.target !== "opfs") {
        throw new InstallerTransferError(
          "integrity",
          "Final release verification identified an unknown resource",
          resourceId,
        );
      }
      observer.integrityFailure(resourceId);
      await repairInstallResource(store, transferPlatform, observer, transferInput, resource, true);
    },
  });
  return Object.freeze({ ...result, releaseDigest: identity.releaseDigest });
}

async function targetStatus(
  shellEntrypointPath: string,
  _requestId: number,
): Promise<{
  readonly active: boolean;
  readonly activeReleaseDigest: string | null;
  readonly releaseDigest: string;
}> {
  const { activeReleaseDigest, identity } = await runInstallerRequestWithTimeout(
    REQUEST_TIMEOUT_MS,
    "Current-target manifest request timed out",
    async (signal) => {
      const { identity } = await loadInstallerTargetIdentity({
        locationUrl: location.href,
        shellEntrypointPath,
        signal,
      });
      const activeReleaseDigest = await store.getActiveReleaseDigest();
      return Object.freeze({ activeReleaseDigest, identity });
    },
  );
  return Object.freeze({
    active: activeReleaseDigest === identity.releaseDigest,
    activeReleaseDigest,
    releaseDigest: identity.releaseDigest,
  });
}

function applyPlan(plan: InstallReleasePlan): void {
  update({
    plannedDownloadBytes: plan.missingBytes,
    plannedResumeBytes: plan.partialBytes,
    resourceCount: plan.totalResourceCount,
    reusedBytes: plan.reusedBytes,
    totalBytes: plan.totalBytes,
  });
}

function transferObserver(
  plannedReusedResourceIds: Set<string>,
  plannedPartialBytes: Map<string, number>,
): InstallerTransferObserver {
  const completionBaseline = telemetry.completedResourceCount;
  const verifiedBaseline = telemetry.verifiedBytes;
  return Object.freeze({
    checkpoint: (bytes: number) =>
      update({ checkpointedBytes: safeAdd(telemetry.checkpointedBytes, bytes) }),
    downloaded: (bytes: number) =>
      accumulate({ downloadedBytes: safeAdd(telemetry.downloadedBytes, bytes) }),
    httpRequest: (range: boolean) =>
      update({
        httpRequestCount: telemetry.httpRequestCount + 1,
        rangeRequestCount: telemetry.rangeRequestCount + (range ? 1 : 0),
      }),
    integrityFailure: () => update({ integrityFailureCount: telemetry.integrityFailureCount + 1 }),
    resourceActive: (resourceId: string) =>
      update({
        activeResourceCount: telemetry.activeResourceCount + 1,
        activeResourceId: resourceId,
      }),
    resourceComplete: (_resourceId: string, bytes: number) =>
      update({
        completedResourceCount: telemetry.completedResourceCount + 1,
        verifiedBytes: safeAdd(telemetry.verifiedBytes, bytes),
      }),
    resourceInactive: (resourceId: string) =>
      update({
        activeResourceCount: Math.max(0, telemetry.activeResourceCount - 1),
        activeResourceId:
          telemetry.activeResourceId === resourceId ? null : telemetry.activeResourceId,
      }),
    repairCompletionCreditRevoked: (resourceId: string, bytes: number) => {
      if (telemetry.completedResourceCount === 0 && telemetry.verifiedBytes === 0) {
        return false;
      }
      if (
        telemetry.completedResourceCount - completionBaseline !== telemetry.resourceCount ||
        telemetry.verifiedBytes - verifiedBaseline !== telemetry.totalBytes ||
        telemetry.completedResourceCount === 0 ||
        telemetry.verifiedBytes < bytes
      ) {
        throw new InstallerTransferError(
          "validator",
          "Repair completion credit is partial or inconsistent for this worker lifetime",
          resourceId,
        );
      }
      update({
        completedResourceCount: telemetry.completedResourceCount - 1,
        verifiedBytes: telemetry.verifiedBytes - bytes,
      });
      return true;
    },
    repairComplete: (_resourceId: string, bytes: number) =>
      update({
        operationRepairedBytes: safeAdd(telemetry.operationRepairedBytes, bytes),
        operationRepairedResourceCount: telemetry.operationRepairedResourceCount + 1,
      }),
    repairStarted: (resourceId: string, bytes: number) => {
      const plannedAsReused = plannedReusedResourceIds.delete(resourceId);
      const plannedPartial = plannedPartialBytes.get(resourceId) ?? 0;
      plannedPartialBytes.delete(resourceId);
      update({
        operationRepairAttemptCount: telemetry.operationRepairAttemptCount + 1,
        plannedDownloadBytes: plannedAsReused
          ? safeAdd(telemetry.plannedDownloadBytes, bytes)
          : safeAdd(telemetry.plannedDownloadBytes, plannedPartial),
        plannedResumeBytes: telemetry.plannedResumeBytes - plannedPartial,
        reusedBytes: plannedAsReused ? telemetry.reusedBytes - bytes : telemetry.reusedBytes,
      });
    },
    resumed: (bytes: number) => update({ resumedBytes: safeAdd(telemetry.resumedBytes, bytes) }),
    retry: () => update({ retryCount: telemetry.retryCount + 1 }),
    transportFailure: () => update({ transportFailureCount: telemetry.transportFailureCount + 1 }),
    validatorFailure: () => update({ validatorFailureCount: telemetry.validatorFailureCount + 1 }),
    verified: (bytes: number) => update({ hashedBytes: safeAdd(telemetry.hashedBytes, bytes) }),
  });
}

function classifyFailure(
  error: unknown,
  operation: InstallerFailureOperation,
): InstallerFailureDiagnostic {
  const storeDiagnostic = installerRepairStoreFailureDiagnostic(error);
  if (storeDiagnostic !== null) return storeDiagnostic;
  if (error instanceof InstallStoreLockTimeoutError) {
    return explicitFailure(
      "unknown",
      "terminal",
      "terminal-unclassified",
      error.message,
      null,
      operation,
    );
  }
  if (error instanceof InstallerTransferError) {
    return explicitFailure(
      error.category,
      "installer-transfer",
      `transfer-${error.category}`,
      error,
      error.resourceId,
      operation,
    );
  }
  const targetCode = installerTargetFailureCode(error);
  if (targetCode !== null) {
    return explicitFailure(
      targetCode,
      "target",
      "target-manifest",
      error,
      installerFailureResourceId(error),
      operation,
    );
  }
  if (
    error instanceof InstallerQuotaError ||
    (error instanceof DOMException && error.name === "QuotaExceededError")
  ) {
    return explicitFailure(
      "quota",
      "quota",
      "quota-exceeded",
      "Installer storage quota was exceeded",
      installerFailureResourceId(error),
      operation,
    );
  }
  if (error instanceof InstallerStoreError) {
    return explicitFailure(
      "store",
      "installer-store",
      `store-${error.operation}`,
      error.message,
      error.resourceId,
      operation,
    );
  }
  return explicitFailure(
    "unknown",
    "terminal",
    "terminal-unclassified",
    "Installer operation failed without classified evidence",
    null,
    operation,
  );
}

function explicitFailure(
  code: InstallerFailureCode,
  failureClass: InstallerFailureClass,
  failureEvidence: InstallerFailureEvidence,
  diagnostic: unknown,
  resourceId: string | null,
  operation: InstallerFailureOperation,
): InstallerFailureDiagnostic {
  return createInstallerFailureDiagnostic(
    code,
    failureClass,
    failureEvidence,
    diagnostic,
    resourceId,
    operation,
  );
}

function installerFailureResourceId(error: unknown): string | null {
  return error instanceof InstallerTransferError ||
    error instanceof InstallerStoreError ||
    error instanceof InstallerQuotaError
    ? error.resourceId
    : null;
}

function finiteNonnegative(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function safeAdd(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) throw new Error("Installer total exceeds safe integer");
  return total;
}
