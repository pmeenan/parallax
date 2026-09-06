import {
  createInstallerFailureDiagnostic,
  type InstallerFailureDiagnostic,
  type InstallerFailureOperation,
} from "../install/installer-failure";
import {
  INSTALL_TRANSFER_LOCK_NAME,
  type InstallerInstallResult,
  type InstallerRequest,
  type InstallerResponse,
  type InstallerTargetStatus,
  type InstallerTransferTelemetrySnapshot,
  parseInstallerRequest,
} from "../install/installer-protocol";
import {
  createInstallerRepairCompleteResponse,
  type InstallerRepairCompletionCredit,
} from "../install/installer-repair-worker-operation";

export interface InstallerWorkerSessionOperationContext {
  readonly completionCredit: InstallerRepairCompletionCredit | null;
  readonly control: { cancelable: boolean };
  readonly expectedReleaseDigest: string | null;
  readonly operation: "install" | "repair";
  readonly requestId: number;
  readonly shellEntrypointPath: string;
  readonly signal: AbortSignal;
}

export interface InstallerWorkerSessionPlatform {
  readonly classifyFailure: (
    error: unknown,
    operation: InstallerFailureOperation,
  ) => InstallerFailureDiagnostic;
  readonly executeOperation: (
    context: InstallerWorkerSessionOperationContext,
  ) => Promise<InstallerInstallResult>;
  readonly now: () => number;
  readonly post: (response: InstallerResponse) => void;
  readonly publishSnapshot: (requestId?: number | null) => void;
  readonly requestLock: <T>(
    name: string,
    signal: AbortSignal,
    operation: () => Promise<T>,
  ) => Promise<T>;
  readonly snapshotTransfer: () => InstallerTransferTelemetrySnapshot;
  readonly targetStatus: (
    shellEntrypointPath: string,
    requestId: number,
  ) => Promise<InstallerTargetStatus>;
  readonly update: (partial: Partial<InstallerTransferTelemetrySnapshot>) => void;
}

export interface InstallerWorkerSession {
  message(input: unknown): void;
  messageError(): void;
}

interface ActiveOperation {
  readonly abort: AbortController;
  readonly control: { cancelable: boolean };
  readonly promise: Promise<void>;
  readonly requestId: number;
}

/**
 * Exact worker-lifetime request state machine. The production worker entrypoint
 * and deterministic replay both use this implementation, so completion credit
 * can only originate from a successful Install in this private session.
 */
export function createInstallerWorkerSession(
  platform: InstallerWorkerSessionPlatform,
): InstallerWorkerSession {
  let lastRequestId = 0;
  let active: ActiveOperation | null = null;
  let disposed = false;
  let completionCredit: InstallerRepairCompletionCredit | null = null;

  const failure = (
    requestId: number,
    diagnostic: InstallerFailureDiagnostic,
    failureSource: "operation" | "session" = "session",
    expectedReleaseDigest: string | null = null,
  ): void => {
    platform.post({
      ...diagnostic,
      expectedReleaseDigest,
      failureSource,
      kind: "failure",
      requestId,
    });
  };

  const startOperation = (
    requestId: number,
    shellEntrypointPath: string,
    operation: "install" | "repair",
    expectedReleaseDigest: string | null,
  ): void => {
    if (operation === "install") completionCredit = null;
    const abort = new AbortController();
    const control = { cancelable: true };
    const started = platform.now();
    platform.update({
      activeRequestId: requestId,
      failureCode: null,
      failureClass: null,
      failureEvidence: null,
      failureExpectedReleaseDigest: null,
      failureMessage: null,
      failureOperation: null,
      failureResourceId: null,
      failureSource: null,
      operationDurationMs: 0,
      operationRepairAttemptCount: 0,
      operationRepairedBytes: 0,
      operationRepairedResourceCount: 0,
      state: "waiting-lock",
    });
    const lockRequestedAt = platform.now();
    const promise = platform
      .requestLock(INSTALL_TRANSFER_LOCK_NAME, abort.signal, async () => {
        platform.update({
          lockWaitDurationMs: Math.max(0, platform.now() - lockRequestedAt),
          state: "planning",
        });
        const result = await platform.executeOperation({
          completionCredit: operation === "repair" ? completionCredit : null,
          control,
          expectedReleaseDigest,
          operation,
          requestId,
          shellEntrypointPath,
          signal: abort.signal,
        });
        completionCredit =
          operation === "install" || completionCredit !== null
            ? Object.freeze({
                releaseDigest: result.releaseDigest,
                resourceCount: result.readyResourceCount,
                totalBytes: result.readyBytes,
                lifetimeResourceCount: platform.snapshotTransfer().completedResourceCount,
                lifetimeVerifiedBytes: platform.snapshotTransfer().verifiedBytes,
              })
            : null;
        platform.update({
          activeReleaseDigest: result.releaseDigest,
          operationDurationMs: Math.max(0, platform.now() - started),
          state: "ready",
        });
        platform.post(
          operation === "repair"
            ? createInstallerRepairCompleteResponse(
                { expectedReleaseDigest, kind: "repair", requestId, shellEntrypointPath },
                result,
              )
            : {
                kind: "install-complete",
                readyBytes: result.readyBytes,
                readyResourceCount: result.readyResourceCount,
                releaseDigest: result.releaseDigest,
                requestId,
              },
        );
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) {
          const snapshot = platform.snapshotTransfer();
          const diagnostic = createInstallerFailureDiagnostic(
            "cancelled",
            "terminal",
            "terminal-unclassified",
            "Install request was cancelled",
            null,
            operation,
          );
          platform.update({
            cancellationCount: snapshot.cancellationCount + 1,
            failureCode: diagnostic.code,
            failureClass: diagnostic.failureClass,
            failureEvidence: diagnostic.failureEvidence,
            failureExpectedReleaseDigest: expectedReleaseDigest,
            failureMessage: diagnostic.message,
            failureOperation: diagnostic.operation,
            failureResourceId: diagnostic.resourceId,
            failureSource: "operation",
            operationDurationMs: Math.max(0, platform.now() - started),
            state: "cancelled",
          });
          failure(requestId, diagnostic, "operation", expectedReleaseDigest);
          return;
        }
        const diagnostic = classifySafely(platform, error, operation);
        const snapshot = platform.snapshotTransfer();
        platform.update({
          failureCode: diagnostic.code,
          failureClass: diagnostic.failureClass,
          failureEvidence: diagnostic.failureEvidence,
          failureExpectedReleaseDigest: expectedReleaseDigest,
          failureMessage: diagnostic.message,
          failureOperation: diagnostic.operation,
          failureResourceId: diagnostic.resourceId,
          failureSource: "operation",
          operationDurationMs: Math.max(0, platform.now() - started),
          quotaFailureCount:
            diagnostic.code === "quota"
              ? snapshot.quotaFailureCount + 1
              : snapshot.quotaFailureCount,
          state: "failed",
        });
        failure(requestId, diagnostic, "operation", expectedReleaseDigest);
      })
      .finally(() => {
        if (active?.requestId === requestId) active = null;
        platform.update({ activeRequestId: null, activeResourceCount: 0, activeResourceId: null });
      });
    active = Object.freeze({ abort, control, promise, requestId });
  };

  const message = (input: unknown): void => {
    const requestId = readableRequestId(input);
    if (requestId !== null) {
      if (requestId <= lastRequestId) {
        failure(
          requestId,
          createInstallerFailureDiagnostic(
            "protocol",
            "protocol",
            "protocol-request",
            "Installer requestId must increase strictly within one worker session",
            null,
            "session",
          ),
        );
        return;
      }
      lastRequestId = requestId;
    }
    let request: InstallerRequest;
    try {
      request = parseInstallerRequest(input);
    } catch (error: unknown) {
      if (requestId !== null) {
        failure(
          requestId,
          createInstallerFailureDiagnostic(
            "protocol",
            "protocol",
            "protocol-request",
            error,
            null,
            "session",
          ),
        );
      }
      return;
    }
    if (disposed) {
      failure(
        request.requestId,
        createInstallerFailureDiagnostic(
          "disposed",
          "terminal",
          "terminal-unclassified",
          "Installer worker is disposed",
          null,
          "session",
        ),
      );
      return;
    }
    switch (request.kind) {
      case "install":
      case "repair":
        if (active !== null) {
          failure(
            request.requestId,
            createInstallerFailureDiagnostic(
              "concurrent-install",
              "terminal",
              "terminal-unclassified",
              "An install is already active",
              null,
              "session",
            ),
          );
          return;
        }
        startOperation(
          request.requestId,
          request.shellEntrypointPath,
          request.kind,
          request.kind === "repair" ? request.expectedReleaseDigest : null,
        );
        return;
      case "target-status":
        if (active !== null) {
          failure(
            request.requestId,
            createInstallerFailureDiagnostic(
              "concurrent-install",
              "terminal",
              "terminal-unclassified",
              "An install is already active",
              null,
              "session",
            ),
          );
          return;
        }
        void platform
          .targetStatus(request.shellEntrypointPath, request.requestId)
          .then((status) =>
            platform.post({ ...status, kind: "target-status", requestId: request.requestId }),
          )
          .catch((error: unknown) =>
            failure(request.requestId, classifySafely(platform, error, "target-status")),
          );
        return;
      case "cancel": {
        const current = active;
        if (current === null || current.requestId !== request.targetRequestId) {
          failure(
            request.requestId,
            createInstallerFailureDiagnostic(
              "cancel-target-invalid",
              "terminal",
              "terminal-unclassified",
              "Cancellation does not identify the active install request",
              null,
              "session",
            ),
          );
          return;
        }
        const cancelled = current.control.cancelable;
        if (cancelled) {
          platform.update({ state: "cancelling" });
          current.abort.abort(new DOMException("Install cancelled", "AbortError"));
        }
        const completeCancellation = (): void => {
          platform.post({
            cancelled,
            kind: "cancel-complete",
            requestId: request.requestId,
            targetRequestId: current.requestId,
          });
        };
        void current.promise
          .then(completeCancellation, completeCancellation)
          .catch(() => undefined);
        return;
      }
      case "snapshot":
        platform.publishSnapshot(request.requestId);
        return;
      case "dispose": {
        disposed = true;
        const current = active;
        if (current?.control.cancelable) {
          current.abort.abort(new DOMException("Installer disposed", "AbortError"));
        }
        const completeDisposal = (): void => {
          try {
            platform.update({
              activeRequestId: null,
              activeResourceCount: 0,
              activeResourceId: null,
              failureCode: null,
              failureClass: null,
              failureEvidence: null,
              failureExpectedReleaseDigest: null,
              failureMessage: null,
              failureOperation: null,
              failureResourceId: null,
              failureSource: null,
              state: "disposed",
            });
          } finally {
            platform.post({ kind: "dispose-complete", requestId: request.requestId });
          }
        };
        void (current?.promise ?? Promise.resolve())
          .then(completeDisposal, completeDisposal)
          .catch(() => undefined);
        return;
      }
    }
  };

  return Object.freeze({
    message,
    messageError(): void {
      platform.update({
        failureCode: "protocol",
        failureClass: "protocol",
        failureEvidence: "protocol-request",
        failureExpectedReleaseDigest: null,
        failureMessage: "Installer worker request failed to deserialize",
        failureOperation: "session",
        failureResourceId: null,
        failureSource: "session",
        state: "failed",
      });
    },
  });
}

function classifySafely(
  platform: InstallerWorkerSessionPlatform,
  error: unknown,
  operation: InstallerFailureOperation,
): InstallerFailureDiagnostic {
  try {
    return platform.classifyFailure(error, operation);
  } catch {
    return createInstallerFailureDiagnostic(
      "unknown",
      "terminal",
      "terminal-unclassified",
      "Installer operation failed without classified evidence",
      null,
      operation,
    );
  }
}

function readableRequestId(input: unknown): number | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const value = (input as Record<string, unknown>).requestId;
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : null;
}
