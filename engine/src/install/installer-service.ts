import { unavailableInstallStoreTelemetrySnapshot } from "../storage/opfs-release-store";
import {
  assertCanonicalInstallerFailureDiagnostic,
  createInstallerFailureDiagnostic,
  INSTALLER_FAILURE_RULES,
  type InstallerFailureRecovery,
  installerFailureRecoveryAction,
} from "./installer-failure";
import {
  INSTALLER_PROTOCOL_VERSION,
  type InstallerFailureClass,
  type InstallerFailureCode,
  type InstallerFailureEvidence,
  type InstallerFailureOperation,
  type InstallerInstallResult,
  type InstallerRequest,
  type InstallerResponse,
  type InstallerSnapshot,
  type InstallerTargetStatus,
  idleInstallerTransferTelemetrySnapshot,
  parseInstallerResponse,
} from "./installer-protocol";

const WORKER_ARTIFACT = "./__INSTALLER_WORKER_ARTIFACT__";

interface DevelopmentImportMeta extends ImportMeta {
  readonly env?: { readonly DEV?: boolean };
}

export type InstallerListener = (snapshot: InstallerSnapshot) => void;

export interface InstallerService {
  cancel(): Promise<boolean>;
  dispose(): Promise<void>;
  install(): Promise<InstallerInstallResult>;
  repair(expectedReleaseDigest: string): Promise<InstallerInstallResult>;
  requestPersistence(): Promise<boolean>;
  snapshot(): InstallerSnapshot;
  subscribe(listener: InstallerListener): () => void;
  targetStatus(): Promise<InstallerTargetStatus>;
}

export interface InstallerServicePlatform {
  createWorker(url: URL): Worker;
  requestPersistence(): Promise<boolean>;
}

export interface InstallerServiceInput {
  readonly shellEntrypointPath: string;
}

export type InstallerServiceRecovery = InstallerFailureRecovery;

export class InstallerServiceError extends Error {
  public readonly code;
  public readonly failureClass;
  public readonly failureEvidence;
  public readonly expectedReleaseDigest;
  public readonly failureSource;
  public readonly operation;
  public readonly recovery;
  public readonly resourceId;

  public constructor(
    code: InstallerFailureCode,
    message: string,
    resourceId: string | null,
    operation: InstallerFailureOperation,
    recovery?: InstallerServiceRecovery,
    failureClass?: InstallerFailureClass,
    failureEvidence?: InstallerFailureEvidence,
    expectedReleaseDigest: string | null = null,
    failureSource: "operation" | "session" = operation === "session" ? "session" : "operation",
  ) {
    super(message);
    if (
      (expectedReleaseDigest !== null &&
        (!/^[a-f0-9]{64}$/.test(expectedReleaseDigest) ||
          failureSource !== "operation" ||
          operation !== "repair")) ||
      (failureSource === "operation" && operation === "repair" && expectedReleaseDigest === null)
    ) {
      throw new Error("Installer service Repair failure requires its exact expected release");
    }
    const candidates = INSTALLER_FAILURE_RULES.filter(
      (rule) =>
        rule.code === code &&
        (failureClass === undefined || rule.failureClass === failureClass) &&
        (failureEvidence === undefined || rule.failureEvidence === failureEvidence),
    ).filter((rule) => rule.operations.includes(operation));
    const candidate = candidates[0];
    if (
      candidate === undefined ||
      candidates.some(
        (rule) =>
          rule.failureClass !== candidate.failureClass ||
          rule.failureEvidence !== candidate.failureEvidence ||
          rule.recoveryAction !== candidate.recoveryAction,
      )
    ) {
      throw new Error("Installer service failure requires one authoritative tuple");
    }
    const diagnostic = {
      code,
      failureClass: candidate.failureClass,
      failureEvidence: candidate.failureEvidence,
      message,
      operation,
      resourceId,
    };
    const rule = assertCanonicalInstallerFailureDiagnostic(diagnostic);
    if (recovery !== undefined && recovery !== rule.recoveryAction) {
      throw new Error("Installer service recovery contradicts its failure tuple");
    }
    this.name = "InstallerServiceError";
    this.code = code;
    this.failureClass = candidate.failureClass;
    this.failureEvidence = candidate.failureEvidence;
    this.expectedReleaseDigest = expectedReleaseDigest;
    this.failureSource = failureSource;
    this.operation = operation;
    this.recovery = candidate.recoveryAction;
    this.resourceId = resourceId;
  }
}

interface PendingRequest {
  draining: boolean;
  readonly expected: InstallerResponse["kind"];
  readonly reject: (error: Error) => void;
  readonly resolve: (response: InstallerResponse) => void;
}

interface PendingPersistenceRequest {
  readonly reject: (reason?: unknown) => void;
  settled: boolean;
}

function installerWorkerUrl(): URL {
  return (import.meta as DevelopmentImportMeta).env?.DEV === true
    ? new URL("../workers/installer-worker.ts", import.meta.url)
    : new URL(WORKER_ARTIFACT, import.meta.url);
}

export function createInstallerService(
  input: InstallerServiceInput,
  platform: InstallerServicePlatform = browserPlatform(),
): InstallerService {
  const worker = platform.createWorker(installerWorkerUrl());
  const listeners = new Set<InstallerListener>();
  const pending = new Map<number, PendingRequest>();
  const pendingPersistence = new Set<PendingPersistenceRequest>();
  let snapshot = freezeSnapshot({
    installStore: unavailableInstallStoreTelemetrySnapshot(),
    installerTransfer: idleInstallerTransferTelemetrySnapshot(),
  });
  let requestId = 0;
  let activeOperationRequestId: number | null = null;
  let disposing = false;
  let disposed = false;
  let disposal: Promise<void> | null = null;
  let failed: InstallerServiceError | null = null;
  let workerReady = false;
  let readyResolve: (() => void) | null = null;
  let readyReject: ((error: Error) => void) | null = null;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  // The service is created eagerly, so initialization can fail before a caller awaits a
  // request. Observe that rejection here while preserving the original rejected promise
  // for install/cancel/dispose callers.
  void ready.catch(() => undefined);

  const publish = (next: InstallerSnapshot): void => {
    snapshot = freezeSnapshot(next);
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch (error: unknown) {
        console.error("Installer telemetry listener failed", error);
      }
    }
  };
  const failClosed = (diagnostic: string): void => {
    if (failed !== null || disposed) return;
    const productFailure = createInstallerFailureDiagnostic(
      "protocol",
      "protocol",
      "protocol-request",
      diagnostic,
      null,
      "session",
    );
    failed = new InstallerServiceError(
      productFailure.code,
      productFailure.message,
      productFailure.resourceId,
      productFailure.operation,
      installerFailureRecoveryAction(productFailure),
      productFailure.failureClass,
      productFailure.failureEvidence,
    );
    worker.terminate();
    readyReject?.(failed);
    readyReject = null;
    readyResolve = null;
    for (const request of pending.values()) request.reject(failed);
    pending.clear();
    for (const request of pendingPersistence) {
      request.settled = true;
      request.reject(failed);
    }
    pendingPersistence.clear();
    activeOperationRequestId = null;
    publish({
      installStore: snapshot.installStore,
      installerTransfer: {
        ...snapshot.installerTransfer,
        activeRequestId: null,
        activeResourceCount: 0,
        activeResourceId: null,
        failureCode: "protocol",
        failureClass: "protocol",
        failureEvidence: "protocol-request",
        failureExpectedReleaseDigest: null,
        failureMessage: productFailure.message,
        failureOperation: productFailure.operation,
        failureResourceId: null,
        failureSource: "session",
        state: "failed",
      },
    });
  };

  worker.onmessage = (event: MessageEvent<unknown>): void => {
    let response: InstallerResponse;
    try {
      response = parseInstallerResponse(event.data);
    } catch (error: unknown) {
      failClosed(`Installer worker violated protocol: ${message(error)}`);
      return;
    }
    if (response.kind === "ready") {
      if (readyResolve === null || response.protocolVersion !== INSTALLER_PROTOCOL_VERSION) {
        failClosed("Installer worker sent duplicate or stale readiness");
        return;
      }
      readyResolve();
      workerReady = true;
      readyResolve = null;
      readyReject = null;
      return;
    }
    if (response.kind === "snapshot") {
      publish(response.snapshot);
      if (
        !workerReady &&
        response.snapshot.installerTransfer.state === "failed" &&
        response.snapshot.installerTransfer.failureMessage !== null
      ) {
        failClosed(
          `Installer worker initialization failed: ${response.snapshot.installerTransfer.failureMessage}`,
        );
        return;
      }
      if (response.requestId === null) return;
    }
    const responseRequestId = response.requestId;
    if (responseRequestId === null) return;
    const request = pending.get(responseRequestId);
    if (request === undefined) {
      failClosed(`Installer worker responded to unknown request ${responseRequestId}`);
      return;
    }
    if (request.draining) {
      if (response.kind !== "failure" && response.kind !== request.expected) {
        failClosed(
          `Draining installer response kind ${response.kind} does not match ${request.expected}`,
        );
        return;
      }
      pending.delete(responseRequestId);
      return;
    }
    if (response.kind === "failure") {
      const transfer = snapshot.installerTransfer;
      const cancellation = response.code === "cancelled";
      if (
        transfer.state !== (cancellation ? "cancelled" : "failed") ||
        transfer.failureCode !== response.code ||
        transfer.failureClass !== response.failureClass ||
        transfer.failureEvidence !== response.failureEvidence ||
        transfer.failureExpectedReleaseDigest !== response.expectedReleaseDigest ||
        transfer.failureMessage !== response.message ||
        transfer.failureOperation !== response.operation ||
        transfer.failureResourceId !== response.resourceId ||
        transfer.failureSource !== response.failureSource
      ) {
        failClosed("Installer worker failure response contradicts failed transfer telemetry");
        return;
      }
      pending.delete(responseRequestId);
      const recovery = installerFailureRecoveryAction(response);
      request.reject(
        new InstallerServiceError(
          response.code,
          response.message,
          response.resourceId,
          response.operation,
          recovery,
          response.failureClass,
          response.failureEvidence,
          response.expectedReleaseDigest,
          response.failureSource,
        ),
      );
      return;
    }
    if (response.kind !== request.expected) {
      failClosed(
        `Installer worker response kind ${response.kind} does not match ${request.expected}`,
      );
      return;
    }
    if (response.kind === "install-complete") {
      const transfer = snapshot.installerTransfer;
      if (
        transfer.state !== "ready" ||
        transfer.activeRequestId !== response.requestId ||
        transfer.activeReleaseDigest !== response.releaseDigest ||
        transfer.totalBytes !== response.readyBytes ||
        transfer.resourceCount !== response.readyResourceCount ||
        snapshot.installStore.activeReleaseDigest !== response.releaseDigest
      ) {
        failClosed(
          "Installer worker completed without matching ready transfer and active-store telemetry",
        );
        return;
      }
    }
    pending.delete(responseRequestId);
    request.resolve(response);
  };
  worker.onmessageerror = (): void => failClosed("Installer worker response was unreadable");
  worker.onerror = (event): void =>
    failClosed(event.message || "Installer worker script failed to load");

  const nextRequestId = (): number => {
    requestId += 1;
    if (!Number.isSafeInteger(requestId)) throw new Error("Installer request ID exhausted");
    return requestId;
  };
  const disposedFailure = (): InstallerServiceError =>
    new InstallerServiceError(
      "disposed",
      "Installer service is disposed",
      null,
      "session",
      "reload",
      "terminal",
      "terminal-unclassified",
    );
  const assertAcceptingWork = (): void => {
    if (disposing || disposed) throw disposedFailure();
  };
  const request = async <T extends InstallerResponse>(
    body: InstallerRequest,
    expected: T["kind"],
    allowDuringDisposal = false,
  ): Promise<T> => {
    await ready;
    if ((disposing || disposed) && !allowDuringDisposal) throw disposedFailure();
    if (failed !== null) throw failed;
    return new Promise<T>((resolve, reject) => {
      pending.set(body.requestId, {
        draining: false,
        expected,
        reject,
        resolve: (response) => resolve(response as T),
      });
      worker.postMessage(body);
    });
  };

  return Object.freeze({
    async cancel(): Promise<boolean> {
      assertAcceptingWork();
      const targetRequestId = activeOperationRequestId;
      if (targetRequestId === null) {
        throw new InstallerServiceError(
          "cancel-target-invalid",
          "No active installer request to cancel",
          null,
          "session",
        );
      }
      const id = nextRequestId();
      const response = await request<Extract<InstallerResponse, { kind: "cancel-complete" }>>(
        { kind: "cancel", requestId: id, targetRequestId },
        "cancel-complete",
      );
      return response.cancelled;
    },
    dispose(): Promise<void> {
      if (disposal !== null) return disposal;
      if (disposed) return Promise.resolve();
      if (failed !== null) {
        disposed = true;
        disposal = Promise.resolve();
        return disposal;
      }
      disposing = true;
      const failure = disposedFailure();
      for (const pendingRequest of pending.values()) {
        pendingRequest.draining = true;
        pendingRequest.reject(failure);
      }
      for (const persistenceRequest of pendingPersistence) {
        persistenceRequest.settled = true;
        persistenceRequest.reject(failure);
      }
      pendingPersistence.clear();
      const id = nextRequestId();
      disposal = request<Extract<InstallerResponse, { kind: "dispose-complete" }>>(
        { kind: "dispose", requestId: id },
        "dispose-complete",
        true,
      ).then(() => {
        disposing = false;
        disposed = true;
        activeOperationRequestId = null;
        pending.clear();
        worker.terminate();
        worker.onmessage = null;
        worker.onmessageerror = null;
        worker.onerror = null;
      });
      return disposal;
    },
    async install(): Promise<InstallerInstallResult> {
      assertAcceptingWork();
      if (activeOperationRequestId !== null) {
        throw new InstallerServiceError(
          "concurrent-install",
          "An installer request is already active",
          null,
          "session",
        );
      }
      const id = nextRequestId();
      activeOperationRequestId = id;
      try {
        const response = await request<Extract<InstallerResponse, { kind: "install-complete" }>>(
          { kind: "install", requestId: id, shellEntrypointPath: input.shellEntrypointPath },
          "install-complete",
        );
        return Object.freeze({
          readyBytes: response.readyBytes,
          readyResourceCount: response.readyResourceCount,
          releaseDigest: response.releaseDigest,
        });
      } finally {
        if (activeOperationRequestId === id) activeOperationRequestId = null;
      }
    },
    async repair(expectedReleaseDigest: string): Promise<InstallerInstallResult> {
      assertAcceptingWork();
      if (activeOperationRequestId !== null) {
        throw new InstallerServiceError(
          "concurrent-install",
          "An installer request is already active",
          null,
          "session",
        );
      }
      const id = nextRequestId();
      activeOperationRequestId = id;
      try {
        const response = await request<Extract<InstallerResponse, { kind: "install-complete" }>>(
          {
            expectedReleaseDigest,
            kind: "repair",
            requestId: id,
            shellEntrypointPath: input.shellEntrypointPath,
          },
          "install-complete",
        );
        return Object.freeze({
          readyBytes: response.readyBytes,
          readyResourceCount: response.readyResourceCount,
          releaseDigest: response.releaseDigest,
        });
      } finally {
        if (activeOperationRequestId === id) activeOperationRequestId = null;
      }
    },
    requestPersistence(): Promise<boolean> {
      if (disposing || disposed) return Promise.reject(disposedFailure());
      if (failed !== null) return Promise.reject(failed);
      // The platform call is made before returning so a direct click-handler caller
      // preserves transient user activation.
      let platformRequest: Promise<boolean>;
      try {
        platformRequest = inputPlatformPersistence(platform);
      } catch (error: unknown) {
        return Promise.reject(error);
      }
      return new Promise<boolean>((resolve, reject) => {
        const pendingRequest: PendingPersistenceRequest = { reject, settled: false };
        pendingPersistence.add(pendingRequest);
        void platformRequest.then(
          (decision) => {
            if (pendingRequest.settled) return;
            pendingRequest.settled = true;
            pendingPersistence.delete(pendingRequest);
            resolve(decision);
          },
          (error: unknown) => {
            if (pendingRequest.settled) return;
            pendingRequest.settled = true;
            pendingPersistence.delete(pendingRequest);
            reject(error);
          },
        );
      });
    },
    snapshot: () => snapshot,
    subscribe(listener: InstallerListener): () => void {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    async targetStatus(): Promise<InstallerTargetStatus> {
      assertAcceptingWork();
      const id = nextRequestId();
      const response = await request<Extract<InstallerResponse, { kind: "target-status" }>>(
        { kind: "target-status", requestId: id, shellEntrypointPath: input.shellEntrypointPath },
        "target-status",
      );
      return Object.freeze({
        active: response.active,
        activeReleaseDigest: response.activeReleaseDigest,
        releaseDigest: response.releaseDigest,
      });
    },
  });
}

export function resolveInstallerShellEntrypointPath(
  shellModuleUrl: string,
  pageUrl: string,
): string {
  const shell = new URL(shellModuleUrl);
  const page = new URL(pageUrl);
  const path = shell.pathname.startsWith("/") ? shell.pathname.slice(1) : "";
  if (
    shell.origin !== page.origin ||
    shell.username !== "" ||
    shell.password !== "" ||
    shell.search !== "" ||
    shell.hash !== "" ||
    path === "" ||
    !/^[A-Za-z0-9._/-]+$/.test(path) ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error("Installer shell entrypoint URL is not an exact same-origin safe path");
  }
  return path;
}

function browserPlatform(): InstallerServicePlatform {
  return Object.freeze({
    createWorker: (url: URL) =>
      new Worker(url, {
        name: "parallax-installer",
        type: "module",
      }),
    requestPersistence: () => navigator.storage.persist(),
  });
}

function inputPlatformPersistence(platform: InstallerServicePlatform): Promise<boolean> {
  return platform.requestPersistence();
}

function freezeSnapshot(value: InstallerSnapshot): InstallerSnapshot {
  return Object.freeze({
    installStore: Object.freeze({ ...value.installStore }),
    installerTransfer: Object.freeze({ ...value.installerTransfer }),
  });
}

function message(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : String(error);
}
