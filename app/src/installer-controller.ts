import type {
  InstallerFailureClass,
  InstallerFailureCode,
  InstallerFailureEvidence,
  InstallerFailureOperation,
  InstallerService,
  InstallerServiceRecovery,
  InstallerTransferState,
  InstallStoreState,
  OfflineShellAdmission,
  OfflineShellFailureCode,
  OfflineShellService,
} from "@parallax/engine";
import {
  InstallerServiceError,
  installerFailureRecoveryAction,
  OfflineShellServiceError,
} from "@parallax/engine";
import type { ShellLaunchAuthority } from "./shell-launch-authority";

export type InstallerUiState =
  | "cancelled"
  | "cancelling"
  | "checking"
  | "failed"
  | "idle"
  | "installing"
  | "launched"
  | "launching"
  | "ready"
  | "repairing"
  | "requesting-persistence";

export type PersistenceState = "denied" | "failed" | "granted" | "not-requested" | "requesting";

export interface InstallerUiFailure {
  readonly code: InstallerFailureCode | OfflineShellFailureCode | "launch" | "persistence";
  readonly failureClass: InstallerFailureClass | "offline-shell" | "ui";
  readonly failureEvidence: InstallerFailureEvidence | "offline-shell" | "ui";
  readonly message: string;
  readonly operation: InstallerFailureOperation;
  readonly recovery: InstallerServiceRecovery;
  readonly resourceId: string | null;
}

export interface InstallerUiSnapshot {
  readonly activeResourceId: string | null;
  readonly checkpointedBytes: number;
  readonly completedResourceCount: number;
  readonly downloadedBytes: number;
  readonly failure: InstallerUiFailure | null;
  readonly finalVerificationBytes: number;
  readonly finalVerificationPhase: "complete" | "idle" | "verifying";
  readonly finalVerificationResourceCount: number;
  readonly finalVerificationTotalBytes: number;
  readonly finalVerificationTotalResourceCount: number;
  readonly persistence: PersistenceState;
  readonly plannedDownloadBytes: number;
  readonly repairAttemptCount: number;
  readonly repairedBytes: number;
  readonly repairedResourceCount: number;
  readonly releaseDigest: string | null;
  readonly resourceCount: number;
  readonly resumedBytes: number;
  readonly reusedBytes: number;
  readonly state: InstallerUiState;
  readonly shellGenerationId: string | null;
  readonly storeState: InstallStoreState;
  readonly totalBytes: number;
  readonly transferState: InstallerTransferState;
  readonly verifiedBytes: number;
}

export interface InstallerController {
  cancel(): Promise<void>;
  installOrResume(): Promise<void>;
  launch(): Promise<void>;
  repair(): Promise<void>;
  refreshTarget(): Promise<void>;
  reload(): void;
  snapshot(): InstallerUiSnapshot;
  subscribe(listener: (snapshot: InstallerUiSnapshot) => void): () => void;
}

export interface InstallerControllerInput {
  readonly installer: Pick<
    InstallerService,
    | "cancel"
    | "install"
    | "repair"
    | "requestPersistence"
    | "snapshot"
    | "subscribe"
    | "targetStatus"
  >;
  readonly launch: (
    releaseDigest: string,
    shellAdmission: OfflineShellAdmission,
    shellAuthority: ShellLaunchAuthority,
  ) => void | Promise<void>;
  readonly offlineShell: Pick<OfflineShellService, "prepare" | "snapshot" | "subscribe">;
  readonly reload: () => void;
}

export function createInstallerController(input: InstallerControllerInput): InstallerController {
  const listeners = new Set<(snapshot: InstallerUiSnapshot) => void>();
  let state: InstallerUiState = "idle";
  let persistence: PersistenceState = "not-requested";
  let failure: InstallerUiFailure | null = null;
  let releaseDigest: string | null = null;
  let shellAdmission: OfflineShellAdmission | null = null;
  let serviceSnapshot = input.installer.snapshot();
  let installGeneration = 0;
  let planVisible = false;
  let immutableShellBoundary = false;
  let launchAuthorityController: AbortController | null = null;
  let persistenceOperation: "install" | "repair" | null = null;
  let persistenceBeforeOperation: PersistenceState | null = null;
  let repairPreflightAuthorityRetained = false;
  let attemptBaseline = counterBaseline(serviceSnapshot);
  let highestInstallerRequestId = serviceSnapshot.installerTransfer.activeRequestId ?? 0;
  let activeInstallerOperation: {
    readonly operation: "install" | "repair";
    readonly requestFloor: number;
    requestId: number | null;
  } | null = null;

  const current = (): InstallerUiSnapshot => {
    const transfer = serviceSnapshot.installerTransfer;
    return freezeSnapshot({
      activeResourceId: serviceSnapshot.installerTransfer.activeResourceId,
      checkpointedBytes: counterDelta(
        transfer.checkpointedBytes,
        attemptBaseline.checkpointedBytes,
      ),
      completedResourceCount: counterDelta(
        transfer.completedResourceCount,
        attemptBaseline.completedResourceCount,
      ),
      downloadedBytes: counterDelta(transfer.downloadedBytes, attemptBaseline.downloadedBytes),
      failure,
      finalVerificationBytes: transfer.finalVerificationBytes,
      finalVerificationPhase: transfer.finalVerificationPhase,
      finalVerificationResourceCount: transfer.finalVerificationResourceCount,
      finalVerificationTotalBytes: transfer.finalVerificationTotalBytes,
      finalVerificationTotalResourceCount: transfer.finalVerificationTotalResourceCount,
      persistence,
      plannedDownloadBytes: planVisible ? transfer.plannedDownloadBytes : 0,
      repairAttemptCount: planVisible ? transfer.operationRepairAttemptCount : 0,
      repairedBytes: planVisible ? transfer.operationRepairedBytes : 0,
      repairedResourceCount: planVisible ? transfer.operationRepairedResourceCount : 0,
      releaseDigest,
      resourceCount: planVisible ? transfer.resourceCount : 0,
      resumedBytes: counterDelta(transfer.resumedBytes, attemptBaseline.resumedBytes),
      reusedBytes: planVisible ? transfer.reusedBytes : 0,
      state,
      shellGenerationId: shellAdmission?.generationId ?? null,
      storeState: serviceSnapshot.installStore.state,
      totalBytes: planVisible ? transfer.totalBytes : 0,
      transferState: transfer.state,
      verifiedBytes: counterDelta(transfer.verifiedBytes, attemptBaseline.verifiedBytes),
    });
  };
  const publish = (): void => {
    const snapshot = current();
    for (const listener of listeners) listener(snapshot);
  };
  const setState = (next: InstallerUiState): void => {
    state = next;
    publish();
  };
  const hasReportedFailure = (): boolean => state === "failed" && failure !== null;
  const requireCurrentShellSelection = (
    shell: Readonly<{ generationId: string; releaseDigest: string }>,
  ): void => {
    const selected = input.offlineShell.snapshot();
    if (
      selected.state !== "active" ||
      selected.activeGenerationId !== shell.generationId ||
      selected.activeReleaseDigest !== shell.releaseDigest
    ) {
      throw new OfflineShellServiceError(
        "shell-release-mismatch",
        "Offline shell changed before launch became ready",
      );
    }
  };
  const supersedePersistencePreflight = (): void => {
    if (state !== "requesting-persistence") return;
    installGeneration += 1;
    persistence = persistenceBeforeOperation ?? "not-requested";
    persistenceOperation = null;
    persistenceBeforeOperation = null;
    repairPreflightAuthorityRetained = false;
  };

  input.installer.subscribe((next) => {
    const transfer = next.installerTransfer;
    if (transfer.activeRequestId !== null) {
      highestInstallerRequestId = Math.max(highestInstallerRequestId, transfer.activeRequestId);
      if (
        activeInstallerOperation !== null &&
        transfer.activeRequestId > activeInstallerOperation.requestFloor &&
        activeInstallerOperation.requestId === null
      ) {
        activeInstallerOperation.requestId = transfer.activeRequestId;
      }
    }
    const sessionFailure =
      (transfer.state === "failed" || transfer.state === "cancelled") &&
      transfer.failureSource === "session" &&
      transfer.activeRequestId === null;
    if (
      activeInstallerOperation !== null &&
      !sessionFailure &&
      (transfer.activeRequestId === null ||
        transfer.activeRequestId !== activeInstallerOperation.requestId)
    ) {
      return;
    }
    const terminal = transfer.state === "failed" || transfer.state === "cancelled";
    if (terminal && activeInstallerOperation === null && !sessionFailure) return;
    serviceSnapshot = next;
    if (
      (state === "installing" || state === "repairing") &&
      (next.installerTransfer.state === "probing-quota" ||
        next.installerTransfer.state === "transferring" ||
        next.installerTransfer.state === "verifying" ||
        next.installerTransfer.state === "ready")
    ) {
      planVisible = true;
    }
    if (
      (next.installerTransfer.state === "failed" || next.installerTransfer.state === "cancelled") &&
      next.installerTransfer.failureCode !== null &&
      next.installerTransfer.failureClass !== null &&
      next.installerTransfer.failureEvidence !== null &&
      next.installerTransfer.failureMessage !== null &&
      next.installerTransfer.failureOperation !== null
    ) {
      supersedePersistencePreflight();
      const diagnostic = Object.freeze({
        code: next.installerTransfer.failureCode,
        failureClass: next.installerTransfer.failureClass,
        failureEvidence: next.installerTransfer.failureEvidence,
        message: next.installerTransfer.failureMessage,
        operation: next.installerTransfer.failureOperation,
        resourceId: next.installerTransfer.failureResourceId,
      });
      const recovery = installerFailureRecoveryAction(diagnostic);
      const cancellation = next.installerTransfer.state === "cancelled";
      const retainRepairAuthority =
        state === "repairing" &&
        recovery === "repair" &&
        next.installerTransfer.failureExpectedReleaseDigest === releaseDigest &&
        releaseDigest !== null &&
        shellAdmission !== null &&
        next.installerTransfer.failureExpectedReleaseDigest === shellAdmission.releaseDigest;
      failure = cancellation
        ? null
        : Object.freeze({
            ...diagnostic,
            recovery,
          });
      if (!retainRepairAuthority) {
        releaseDigest = null;
        shellAdmission = null;
      }
      state = next.installerTransfer.state;
    }
    publish();
  });

  input.offlineShell.subscribe((next) => {
    const requiresCurrentShellAuthority =
      state === "ready" ||
      (state === "launching" && !immutableShellBoundary) ||
      (state === "requesting-persistence" && repairPreflightAuthorityRetained);
    if (
      !requiresCurrentShellAuthority ||
      shellAdmission === null ||
      (next.state === "active" &&
        next.activeGenerationId === shellAdmission.generationId &&
        next.activeReleaseDigest === shellAdmission.releaseDigest)
    ) {
      return;
    }
    supersedePersistencePreflight();
    releaseDigest = null;
    shellAdmission = null;
    launchAuthorityController?.abort(
      new OfflineShellServiceError(
        next.failureCode ?? "shell-release-mismatch",
        next.failureMessage ?? "Offline-shell launch authority was revoked before admission",
      ),
    );
    launchAuthorityController = null;
    failure = offlineShellFailure(
      next.failureCode ?? "shell-release-mismatch",
      next.failureMessage ??
        "The selected offline shell or controlling service worker changed after launch became ready",
    );
    setState("failed");
  });

  const runInstallOperation = async (operation: "install" | "repair"): Promise<void> => {
    const isRepair = operation === "repair";
    if (
      isRepair
        ? state !== "ready" && !(state === "failed" && failure?.recovery === "repair")
        : state !== "idle" &&
          state !== "cancelled" &&
          !(
            state === "failed" &&
            (failure?.recovery === "retry" ||
              (failure?.recovery === "repair" && releaseDigest === null))
          )
    ) {
      throw new Error(
        isRepair
          ? "Repair is unavailable without an exact active target or repairable failure"
          : "Install or resume is unavailable in the current state",
      );
    }
    const generation = ++installGeneration;
    failure = null;
    if (!isRepair) {
      releaseDigest = null;
      shellAdmission = null;
    }
    attemptBaseline = counterBaseline(serviceSnapshot);
    planVisible = false;
    persistenceBeforeOperation = persistence;
    persistence = "requesting";
    persistenceOperation = operation;
    repairPreflightAuthorityRetained =
      isRepair && releaseDigest !== null && shellAdmission !== null;
    setState("requesting-persistence");
    let persisted: boolean;
    try {
      // requestPersistence() calls navigator.storage.persist() synchronously before
      // returning its promise. This function is entered directly by the UI click listener.
      persisted = await input.installer.requestPersistence();
    } catch (error: unknown) {
      if (generation !== installGeneration) return;
      persistence = "failed";
      persistenceOperation = null;
      persistenceBeforeOperation = null;
      repairPreflightAuthorityRetained = false;
      failure =
        error instanceof InstallerServiceError
          ? Object.freeze({
              code: error.code,
              failureClass: error.failureClass,
              failureEvidence: error.failureEvidence,
              message: error.message,
              operation: error.operation,
              recovery: error.recovery,
              resourceId: error.resourceId,
            })
          : Object.freeze({
              code: "persistence" as const,
              failureClass: "ui" as const,
              failureEvidence: "ui" as const,
              message: errorMessage(error),
              operation: operation,
              recovery: "retry" as const,
              resourceId: null,
            });
      setState("failed");
      return;
    }
    if (generation !== installGeneration) return;
    persistence = persisted ? "granted" : "denied";
    persistenceOperation = null;
    persistenceBeforeOperation = null;
    repairPreflightAuthorityRetained = false;
    setState(isRepair ? "repairing" : "installing");
    const operationCorrelation: NonNullable<typeof activeInstallerOperation> = {
      operation,
      requestFloor: highestInstallerRequestId,
      requestId: null,
    };
    activeInstallerOperation = operationCorrelation;
    try {
      const result =
        operation === "repair"
          ? await input.installer.repair(requireRepairReleaseDigest(releaseDigest, shellAdmission))
          : await input.installer.install();
      if (generation !== installGeneration) return;
      const shell = await input.offlineShell.prepare();
      if (generation !== installGeneration || hasReportedFailure()) return;
      if (shell.releaseDigest !== result.releaseDigest) {
        throw new OfflineShellServiceError(
          "shell-release-mismatch",
          `Installed release ${result.releaseDigest} does not match selected offline shell ${shell.releaseDigest}`,
        );
      }
      requireCurrentShellSelection(shell);
      const selected = admission(shell);
      releaseDigest = result.releaseDigest;
      shellAdmission = selected;
      setState("ready");
    } catch (error: unknown) {
      if (generation !== installGeneration) return;
      if (error instanceof InstallerServiceError && error.code === "cancelled") {
        releaseDigest = null;
        shellAdmission = null;
        setState("cancelled");
        return;
      }
      failure = installerFailure(error);
      const retainRepairAuthority =
        operation === "repair" &&
        error instanceof InstallerServiceError &&
        error.failureSource === "operation" &&
        error.expectedReleaseDigest !== null &&
        error.expectedReleaseDigest === releaseDigest &&
        shellAdmission !== null &&
        error.expectedReleaseDigest === shellAdmission.releaseDigest &&
        error.recovery === "repair";
      if (!retainRepairAuthority) {
        releaseDigest = null;
        shellAdmission = null;
      }
      setState("failed");
    } finally {
      if (activeInstallerOperation === operationCorrelation && generation === installGeneration) {
        activeInstallerOperation = null;
      }
    }
  };

  return Object.freeze({
    async cancel(): Promise<void> {
      if (state !== "installing" && state !== "repairing" && state !== "requesting-persistence") {
        throw new Error("Installer cancellation requires an active install");
      }
      const generation = ++installGeneration;
      const cancelledOperation = activeInstallerOperation;
      if (state === "requesting-persistence") {
        const returnToReady = persistenceOperation === "repair" && repairPreflightAuthorityRetained;
        persistence = persistenceBeforeOperation ?? "not-requested";
        persistenceOperation = null;
        persistenceBeforeOperation = null;
        repairPreflightAuthorityRetained = false;
        setState(returnToReady ? "ready" : "cancelled");
        return;
      }
      setState("cancelling");
      try {
        const cancelled = await input.installer.cancel();
        if (generation !== installGeneration) return;
        if (cancelled) {
          setState("cancelled");
          return;
        }
        const shell = await input.offlineShell.prepare();
        if (generation !== installGeneration) return;
        const target = await input.installer.targetStatus();
        if (generation !== installGeneration || hasReportedFailure()) return;
        if (target.releaseDigest !== shell.releaseDigest) {
          throw new OfflineShellServiceError(
            "shell-release-mismatch",
            "Installer target and selected offline shell identify different releases",
          );
        }
        if (target.active && target.activeReleaseDigest === shell.releaseDigest) {
          requireCurrentShellSelection(shell);
          const selected = admission(shell);
          releaseDigest = target.releaseDigest;
          shellAdmission = selected;
          setState("ready");
          return;
        }
        failure = Object.freeze({
          code: "unknown",
          failureClass: "ui",
          failureEvidence: "ui",
          message: "Publication completed after cancellation but the exact target is not active",
          operation: "session",
          recovery: "retry",
          resourceId: null,
        });
        setState("failed");
      } catch (error: unknown) {
        if (generation !== installGeneration) return;
        if (hasReportedFailure()) return;
        failure = installerFailure(error);
        setState("failed");
      } finally {
        if (activeInstallerOperation === cancelledOperation) activeInstallerOperation = null;
      }
    },
    async installOrResume(): Promise<void> {
      await runInstallOperation("install");
    },
    async repair(): Promise<void> {
      await runInstallOperation("repair");
    },
    async launch(): Promise<void> {
      if (state !== "ready" || releaseDigest === null || shellAdmission === null) {
        throw new Error("Launch requires the target release to be ready");
      }
      const expectedReleaseDigest = releaseDigest;
      const expectedShell = shellAdmission;
      const generation = ++installGeneration;
      immutableShellBoundary = false;
      const authorityController = new AbortController();
      launchAuthorityController = authorityController;
      setState("launching");
      try {
        const target = await input.installer.targetStatus();
        if (generation !== installGeneration || hasReportedFailure()) return;
        if (
          !target.active ||
          target.releaseDigest !== expectedReleaseDigest ||
          target.activeReleaseDigest !== expectedReleaseDigest
        ) {
          throw new OfflineShellServiceError(
            "shell-release-mismatch",
            "Installer target changed after launch became ready",
          );
        }
        await input.launch(expectedReleaseDigest, expectedShell, {
          markAdmitted: () => {
            if (authorityController.signal.aborted) {
              const reason = authorityController.signal.reason;
              throw reason instanceof OfflineShellServiceError
                ? reason
                : new OfflineShellServiceError(
                    "shell-release-mismatch",
                    "Offline-shell launch authority was revoked before admission",
                  );
            }
            if (generation !== installGeneration) {
              throw new OfflineShellServiceError(
                "shell-release-mismatch",
                "Offline-shell launch authority expired before admission",
              );
            }
            immutableShellBoundary = true;
            launchAuthorityController = null;
          },
          signal: authorityController.signal,
        });
        if (generation !== installGeneration || hasReportedFailure()) return;
        setState("launched");
      } catch (error: unknown) {
        if (launchAuthorityController === authorityController) {
          launchAuthorityController = null;
        }
        failure =
          error instanceof OfflineShellServiceError || error instanceof InstallerServiceError
            ? installerFailure(error)
            : Object.freeze({
                code: "launch" as const,
                failureClass: "ui" as const,
                failureEvidence: "ui" as const,
                message: errorMessage(error),
                operation: "session" as const,
                recovery: "reload" as const,
                resourceId: null,
              });
        releaseDigest = null;
        shellAdmission = null;
        setState("failed");
      }
    },
    reload(): void {
      if (state !== "failed" || failure?.recovery !== "reload") {
        throw new Error("Reload requires a terminal installer failure");
      }
      input.reload();
    },
    async refreshTarget(): Promise<void> {
      if (state !== "idle") throw new Error("Target refresh requires the idle installer state");
      const generation = ++installGeneration;
      failure = null;
      releaseDigest = null;
      shellAdmission = null;
      setState("checking");
      try {
        const shell = await input.offlineShell.prepare();
        if (generation !== installGeneration || hasReportedFailure()) return;
        const target = await input.installer.targetStatus();
        if (generation !== installGeneration || hasReportedFailure()) return;
        if (target.releaseDigest !== shell.releaseDigest) {
          throw new OfflineShellServiceError(
            "shell-release-mismatch",
            "Installer target does not match the selected offline shell generation",
          );
        }
        if (target.active && target.activeReleaseDigest === shell.releaseDigest) {
          requireCurrentShellSelection(shell);
          const selected = admission(shell);
          releaseDigest = target.releaseDigest;
          shellAdmission = selected;
          setState("ready");
        } else if (target.activeReleaseDigest !== null) {
          failure = offlineShellFailure(
            "shell-release-mismatch",
            "The installed asset release does not match the selected offline shell generation",
          );
          setState("failed");
        } else {
          setState("idle");
        }
      } catch (error: unknown) {
        if (generation !== installGeneration) return;
        failure = installerFailure(error);
        setState("failed");
      }
    },
    snapshot: current,
    subscribe(listener: (snapshot: InstallerUiSnapshot) => void): () => void {
      listeners.add(listener);
      listener(current());
      return () => listeners.delete(listener);
    },
  });
}

function freezeSnapshot(value: InstallerUiSnapshot): InstallerUiSnapshot {
  return Object.freeze({
    ...value,
    failure: value.failure === null ? null : Object.freeze({ ...value.failure }),
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : String(error);
}

function admission(
  generation: Readonly<{ generationId: string; releaseDigest: string }>,
): OfflineShellAdmission {
  return Object.freeze({
    generationId: generation.generationId,
    releaseDigest: generation.releaseDigest,
  });
}

function installerFailure(error: unknown): InstallerUiFailure {
  if (error instanceof OfflineShellServiceError) {
    return Object.freeze({
      code: error.code,
      failureClass: "offline-shell",
      failureEvidence: "offline-shell",
      message: error.message,
      operation: "session",
      recovery: error.recovery,
      resourceId: null,
    });
  }
  return error instanceof InstallerServiceError
    ? Object.freeze({
        code: error.code,
        failureClass: error.failureClass,
        failureEvidence: error.failureEvidence,
        message: error.message,
        operation: error.operation,
        recovery: error.recovery,
        resourceId: error.resourceId,
      })
    : Object.freeze({
        code: "unknown" as const,
        failureClass: "ui" as const,
        failureEvidence: "ui" as const,
        message: errorMessage(error),
        operation: "session" as const,
        recovery: "retry" as const,
        resourceId: null,
      });
}

function offlineShellFailure(code: OfflineShellFailureCode, message: string): InstallerUiFailure {
  return installerFailure(new OfflineShellServiceError(code, message));
}

function requireRepairReleaseDigest(
  releaseDigest: string | null,
  shellAdmission: OfflineShellAdmission | null,
): string {
  if (
    releaseDigest === null ||
    shellAdmission === null ||
    shellAdmission.releaseDigest !== releaseDigest
  ) {
    throw new Error("Repair requires exact admitted release and offline-shell authority");
  }
  return releaseDigest;
}

function counterBaseline(snapshot: ReturnType<InstallerService["snapshot"]>): Readonly<{
  checkpointedBytes: number;
  completedResourceCount: number;
  downloadedBytes: number;
  resumedBytes: number;
  verifiedBytes: number;
}> {
  return Object.freeze({
    checkpointedBytes: snapshot.installerTransfer.checkpointedBytes,
    completedResourceCount: snapshot.installerTransfer.completedResourceCount,
    downloadedBytes: snapshot.installerTransfer.downloadedBytes,
    resumedBytes: snapshot.installerTransfer.resumedBytes,
    verifiedBytes: snapshot.installerTransfer.verifiedBytes,
  });
}

function counterDelta(value: number, baseline: number): number {
  return Math.max(0, value - baseline);
}
