import { describe, expect, it, vi } from "vitest";
import { createInstallerFailureDiagnostic } from "../src/install/installer-failure";
import type { InstallerRequest, InstallerResponse } from "../src/install/installer-protocol";
import {
  INSTALLER_PROTOCOL_VERSION,
  idleInstallerTransferTelemetrySnapshot,
} from "../src/install/installer-protocol";
import {
  createInstallerService,
  InstallerServiceError,
  type InstallerServicePlatform,
  resolveInstallerShellEntrypointPath,
} from "../src/install/installer-service";
import { unavailableInstallStoreTelemetrySnapshot } from "../src/storage/opfs-release-store";
import {
  createInstallerWorkerSession,
  type InstallerWorkerSession,
  type InstallerWorkerSessionOperationContext,
} from "../src/workers/installer-worker-session";

const shellEntrypointPath = `immutable/app-${"c".repeat(64)}.js`;

class FakeWorker {
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  public onmessageerror: ((event: MessageEvent) => void) | null = null;
  public readonly requests: InstallerRequest[] = [];
  public terminated = false;

  public postMessage(message: InstallerRequest): void {
    this.requests.push(message);
  }

  public terminate(): void {
    this.terminated = true;
  }

  public respond(message: InstallerResponse | unknown): void {
    this.onmessage?.(new MessageEvent("message", { data: message }));
  }
}

function fixture(requestPersistence: () => Promise<boolean> = () => Promise.resolve(true)) {
  const worker = new FakeWorker();
  let createdUrl: URL | null = null;
  const platform: InstallerServicePlatform = {
    createWorker(url) {
      createdUrl = url;
      return worker as unknown as Worker;
    },
    requestPersistence,
  };
  const service = createInstallerService({ shellEntrypointPath }, platform);
  return { createdUrl: () => createdUrl, service, worker };
}

describe("installer service", () => {
  it("invokes the injected persistence request synchronously and returns its decision", async () => {
    let invoked = false;
    const test = fixture(() => {
      invoked = true;
      return Promise.resolve(false);
    });

    const decision = test.service.requestPersistence();
    expect(invoked).toBe(true);
    await expect(decision).resolves.toBe(false);
    expect(test.worker.requests).toEqual([]);
  });

  it.each([
    "resolve",
    "reject",
  ] as const)("settles pending persistence as disposed before a late platform %s", async (lateOutcome) => {
    let resolvePlatform!: (value: boolean) => void;
    let rejectPlatform!: (reason: unknown) => void;
    const platformDecision = new Promise<boolean>((resolve, reject) => {
      resolvePlatform = resolve;
      rejectPlatform = reject;
    });
    const requestPersistence = vi.fn(() => platformDecision);
    const test = fixture(requestPersistence);
    test.worker.respond({ kind: "ready", protocolVersion: 7 });

    const persistence = test.service.requestPersistence();
    expect(requestPersistence).toHaveBeenCalledOnce();
    const disposal = test.service.dispose();
    await expect(persistence).rejects.toMatchObject({ code: "disposed", recovery: "reload" });

    if (lateOutcome === "resolve") resolvePlatform(false);
    else rejectPlatform(new Error("late persistence failure"));
    await Promise.resolve();
    await expect(persistence).rejects.toMatchObject({ code: "disposed" });

    await Promise.resolve();
    expect(test.worker.requests).toEqual([{ kind: "dispose", requestId: 1 }]);
    test.worker.respond({ kind: "dispose-complete", requestId: 1 });
    await expect(disposal).resolves.toBeUndefined();
  });

  it("coalesces concurrent disposal behind one request and one worker termination", async () => {
    const test = fixture();
    const terminate = vi.spyOn(test.worker, "terminate");
    test.worker.respond({ kind: "ready", protocolVersion: 7 });

    const first = test.service.dispose();
    const second = test.service.dispose();
    const third = test.service.dispose();
    expect(second).toBe(first);
    expect(third).toBe(first);
    await Promise.resolve();
    expect(test.worker.requests).toEqual([{ kind: "dispose", requestId: 1 }]);

    test.worker.respond({ kind: "dispose-complete", requestId: 1 });
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(terminate).toHaveBeenCalledOnce();

    const sequential = test.service.dispose();
    expect(sequential).toBe(first);
    await expect(sequential).resolves.toBeUndefined();
    expect(test.worker.requests).toHaveLength(1);
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("closes the public request boundary synchronously when disposal begins", async () => {
    const test = fixture();
    test.worker.respond({ kind: "ready", protocolVersion: 7 });

    const install = test.service.install();
    const disposal = test.service.dispose();
    expect(test.service.dispose()).toBe(disposal);

    await expect(install).rejects.toMatchObject({ code: "disposed", recovery: "reload" });
    await expect(test.service.install()).rejects.toMatchObject({ code: "disposed" });
    await expect(test.service.repair("a".repeat(64))).rejects.toMatchObject({ code: "disposed" });
    await expect(test.service.cancel()).rejects.toMatchObject({ code: "disposed" });
    await expect(test.service.targetStatus()).rejects.toMatchObject({ code: "disposed" });
    await expect(test.service.requestPersistence()).rejects.toMatchObject({ code: "disposed" });
    await Promise.resolve();
    expect(test.worker.requests).toEqual([{ kind: "dispose", requestId: 2 }]);

    test.worker.respond({ kind: "dispose-complete", requestId: 2 });
    await expect(disposal).resolves.toBeUndefined();
    expect(test.worker.terminated).toBe(true);
  });

  it("drains an already-pending install success without live telemetry validation", async () => {
    const test = fixture();
    test.worker.respond({ kind: "ready", protocolVersion: 7 });
    const install = test.service.install();
    await Promise.resolve();
    expect(test.worker.requests).toEqual([{ kind: "install", requestId: 1, shellEntrypointPath }]);

    const disposal = test.service.dispose();
    await expect(install).rejects.toMatchObject({ code: "disposed", recovery: "reload" });
    await Promise.resolve();
    expect(test.worker.requests[1]).toEqual({ kind: "dispose", requestId: 2 });

    test.worker.respond({
      kind: "install-complete",
      readyBytes: 7,
      readyResourceCount: 1,
      releaseDigest: "a".repeat(64),
      requestId: 1,
    });
    expect(test.worker.terminated).toBe(false);
    test.worker.respond({ kind: "dispose-complete", requestId: 2 });

    await expect(disposal).resolves.toBeUndefined();
    expect(test.worker.terminated).toBe(true);
  });

  it.each([
    "success",
    "failure",
  ] as const)("drains a pending target-status late %s without re-settlement", async (outcome) => {
    const test = fixture();
    test.worker.respond({ kind: "ready", protocolVersion: 7 });
    const status = test.service.targetStatus();
    await Promise.resolve();
    expect(test.worker.requests).toEqual([
      { kind: "target-status", requestId: 1, shellEntrypointPath },
    ]);

    const disposal = test.service.dispose();
    await expect(status).rejects.toMatchObject({ code: "disposed", recovery: "reload" });
    await Promise.resolve();
    expect(test.worker.requests[1]).toEqual({ kind: "dispose", requestId: 2 });

    test.worker.respond(
      outcome === "success"
        ? {
            active: false,
            activeReleaseDigest: null,
            kind: "target-status",
            releaseDigest: "a".repeat(64),
            requestId: 1,
          }
        : {
            code: "unknown",
            expectedReleaseDigest: null,
            failureClass: "terminal",
            failureEvidence: "terminal-unclassified",
            failureSource: "operation",
            kind: "failure",
            message: "late target status failure",
            operation: "target-status",
            requestId: 1,
            resourceId: null,
          },
    );
    expect(test.worker.terminated).toBe(false);
    expect(test.service.snapshot().installerTransfer.state).not.toBe("failed");

    test.worker.respond({ kind: "dispose-complete", requestId: 2 });
    await expect(disposal).resolves.toBeUndefined();
    expect(test.worker.terminated).toBe(true);
  });

  it("clears an unanswered draining correlation when disposal quiesces", async () => {
    const test = fixture();
    test.worker.respond({ kind: "ready", protocolVersion: 7 });
    const status = test.service.targetStatus();
    await Promise.resolve();
    const disposal = test.service.dispose();
    await expect(status).rejects.toMatchObject({ code: "disposed" });
    await Promise.resolve();

    test.worker.respond({ kind: "dispose-complete", requestId: 2 });
    await expect(disposal).resolves.toBeUndefined();
    expect(test.worker.terminated).toBe(true);
    expect(test.worker.onmessage).toBeNull();
    expect(test.worker.onmessageerror).toBeNull();
    expect(test.worker.onerror).toBeNull();
    test.worker.respond({
      active: false,
      activeReleaseDigest: null,
      kind: "target-status",
      releaseDigest: "a".repeat(64),
      requestId: 1,
    });
    expect(test.service.snapshot().installerTransfer.state).not.toBe("failed");
  });

  it("fails closed when a draining correlation receives the wrong parsed response kind", async () => {
    const test = fixture();
    test.worker.respond({ kind: "ready", protocolVersion: 7 });
    const status = test.service.targetStatus();
    await Promise.resolve();
    const disposal = test.service.dispose();
    await expect(status).rejects.toMatchObject({ code: "disposed" });
    await Promise.resolve();

    test.worker.respond({
      kind: "install-complete",
      readyBytes: 0,
      readyResourceCount: 0,
      releaseDigest: "a".repeat(64),
      requestId: 1,
    });

    await expect(disposal).rejects.toMatchObject({ code: "protocol", recovery: "reload" });
    expect(test.worker.terminated).toBe(true);
  });

  it("rejects every coalesced disposer when fail-closed termination rejects the request", async () => {
    const test = fixture();
    const terminate = vi.spyOn(test.worker, "terminate");
    test.worker.respond({ kind: "ready", protocolVersion: 7 });

    const first = test.service.dispose();
    const second = test.service.dispose();
    expect(second).toBe(first);
    await Promise.resolve();
    expect(test.worker.requests).toEqual([{ kind: "dispose", requestId: 1 }]);

    test.worker.respond({ kind: "not-real", requestId: 1 });
    const results = await Promise.allSettled([first, second]);
    expect(results[0]).toMatchObject({ status: "rejected" });
    expect(results[1]).toMatchObject({ status: "rejected" });
    if (results[0]?.status !== "rejected" || results[1]?.status !== "rejected") {
      throw new Error("Concurrent disposal failure did not reject every caller");
    }
    expect(results[1].reason).toBe(results[0].reason);
    expect(results[0].reason).toMatchObject({ code: "protocol", recovery: "reload" });
    expect(terminate).toHaveBeenCalledOnce();

    const sequential = test.service.dispose();
    expect(sequential).toBe(first);
    await expect(sequential).rejects.toBe(results[0].reason);
    expect(test.worker.requests).toHaveLength(1);
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("eagerly creates the fixed worker and resolves an install completion", async () => {
    const test = fixture();
    expect(test.createdUrl()?.href).toContain("installer-worker");
    test.worker.respond({ kind: "ready", protocolVersion: 7 });
    const result = test.service.install();
    await Promise.resolve();
    expect(test.worker.requests).toEqual([{ kind: "install", requestId: 1, shellEntrypointPath }]);
    const snapshot = test.service.snapshot();
    test.worker.respond({
      kind: "snapshot",
      requestId: null,
      snapshot: {
        installStore: {
          ...snapshot.installStore,
          ...finalVerification(7, 1),
          activeReleaseDigest: "a".repeat(64),
          state: "ready",
        },
        installerTransfer: {
          ...snapshot.installerTransfer,
          ...finalVerification(7, 1),
          activeReleaseDigest: "a".repeat(64),
          activeRequestId: 1,
          completedResourceCount: 1,
          plannedDownloadBytes: 7,
          resourceCount: 1,
          state: "ready",
          totalBytes: 7,
          verifiedBytes: 7,
        },
      },
    });
    test.worker.respond({
      kind: "install-complete",
      readyBytes: 7,
      readyResourceCount: 1,
      releaseDigest: "a".repeat(64),
      requestId: 1,
    });
    await expect(result).resolves.toEqual({
      readyBytes: 7,
      readyResourceCount: 1,
      releaseDigest: "a".repeat(64),
    });
  });

  it("uses the same worker correlation path for an explicit repair operation", async () => {
    const test = fixture();
    const digest = "a".repeat(64);
    test.worker.respond({ kind: "ready", protocolVersion: 7 });
    const result = test.service.repair("a".repeat(64));
    await Promise.resolve();
    expect(test.worker.requests).toEqual([
      { expectedReleaseDigest: digest, kind: "repair", requestId: 1, shellEntrypointPath },
    ]);
    const snapshot = test.service.snapshot();
    test.worker.respond({
      kind: "snapshot",
      requestId: null,
      snapshot: {
        installStore: {
          ...snapshot.installStore,
          ...finalVerification(7, 1),
          activeReleaseDigest: digest,
          state: "ready",
        },
        installerTransfer: {
          ...snapshot.installerTransfer,
          ...finalVerification(7, 1),
          activeReleaseDigest: digest,
          activeRequestId: 1,
          completedResourceCount: 1,
          plannedDownloadBytes: 7,
          resourceCount: 1,
          state: "ready",
          totalBytes: 7,
          verifiedBytes: 7,
        },
      },
    });
    test.worker.respond({
      kind: "install-complete",
      readyBytes: 7,
      readyResourceCount: 1,
      releaseDigest: digest,
      requestId: 1,
    });
    await expect(result).resolves.toMatchObject({ releaseDigest: digest });
  });

  it("preserves exact-resource integrity and Repair recovery from a worker failure", async () => {
    const test = fixture();
    test.worker.respond({ kind: "ready", protocolVersion: 7 });
    const install = test.service.install();
    await Promise.resolve();
    const snapshot = test.service.snapshot();
    test.worker.respond({
      kind: "snapshot",
      requestId: null,
      snapshot: {
        installStore: snapshot.installStore,
        installerTransfer: {
          ...snapshot.installerTransfer,
          activeRequestId: 1,
          failureCode: "integrity",
          failureClass: "installer-transfer",
          failureEvidence: "transfer-integrity",
          failureExpectedReleaseDigest: null,
          failureMessage: "Downloaded body failed exact SHA-256 verification",
          failureOperation: "install",
          failureResourceId: "district-resource",
          failureSource: "operation",
          state: "failed",
        },
      },
    });
    test.worker.respond({
      code: "integrity",
      expectedReleaseDigest: null,
      failureClass: "installer-transfer",
      failureEvidence: "transfer-integrity",
      failureSource: "operation",
      kind: "failure",
      message: "Downloaded body failed exact SHA-256 verification",
      operation: "install",
      requestId: 1,
      resourceId: "district-resource",
    });
    await expect(install).rejects.toMatchObject({
      code: "integrity",
      name: InstallerServiceError.name,
      recovery: "repair",
      resourceId: "district-resource",
    });
  });

  it("fails closed on completion before exact ready and active-selection telemetry", async () => {
    const test = fixture();
    test.worker.respond({ kind: "ready", protocolVersion: 7 });
    const result = test.service.install();
    await Promise.resolve();
    test.worker.respond({
      kind: "install-complete",
      readyBytes: 7,
      readyResourceCount: 1,
      releaseDigest: "a".repeat(64),
      requestId: 1,
    });

    await expect(result).rejects.toMatchObject({ code: "protocol", recovery: "reload" });
    expect(test.worker.terminated).toBe(true);
  });

  it("resolves the exact current target activation status", async () => {
    const test = fixture();
    const digest = "b".repeat(64);
    test.worker.respond({ kind: "ready", protocolVersion: 7 });
    const status = test.service.targetStatus();
    await Promise.resolve();
    expect(test.worker.requests).toEqual([
      { kind: "target-status", requestId: 1, shellEntrypointPath },
    ]);
    test.worker.respond({
      active: true,
      activeReleaseDigest: digest,
      kind: "target-status",
      releaseDigest: digest,
      requestId: 1,
    });
    await expect(status).resolves.toEqual({
      active: true,
      activeReleaseDigest: digest,
      releaseDigest: digest,
    });
  });

  it("targets cancellation at the active install and waits for quiescent completion", async () => {
    const test = fixture();
    test.worker.respond({ kind: "ready", protocolVersion: 7 });
    const install = test.service.install();
    await Promise.resolve();
    const cancel = test.service.cancel();
    await Promise.resolve();
    expect(test.worker.requests[1]).toEqual({
      kind: "cancel",
      requestId: 2,
      targetRequestId: 1,
    });
    const snapshot = test.service.snapshot();
    test.worker.respond({
      kind: "snapshot",
      requestId: null,
      snapshot: {
        installStore: snapshot.installStore,
        installerTransfer: {
          ...snapshot.installerTransfer,
          activeRequestId: 1,
          failureCode: "cancelled",
          failureClass: "terminal",
          failureEvidence: "terminal-unclassified",
          failureExpectedReleaseDigest: null,
          failureMessage: "cancelled",
          failureOperation: "install",
          failureResourceId: null,
          failureSource: "operation",
          state: "cancelled",
        },
      },
    });
    test.worker.respond({
      code: "cancelled",
      expectedReleaseDigest: null,
      failureClass: "terminal",
      failureEvidence: "terminal-unclassified",
      failureSource: "operation",
      kind: "failure",
      message: "cancelled",
      operation: "install",
      requestId: 1,
      resourceId: null,
    });
    test.worker.respond({
      cancelled: true,
      kind: "cancel-complete",
      requestId: 2,
      targetRequestId: 1,
    });
    await expect(install).rejects.toThrow(/cancelled/);
    await expect(cancel).resolves.toBe(true);
  });

  it("carries real session cancellation through service telemetry without fatal recovery or stale credit", async () => {
    const worker = new FakeWorker();
    let session: InstallerWorkerSession | null = null;
    worker.postMessage = (request: InstallerRequest): void => {
      worker.requests.push(request);
      session?.message(request);
    };
    const service = createInstallerService(
      { shellEntrypointPath },
      {
        createWorker: () => worker as unknown as Worker,
        requestPersistence: () => Promise.resolve(true),
      },
    );
    let transfer = idleInstallerTransferTelemetrySnapshot();
    const observedCredits: Array<InstallerWorkerSessionOperationContext["completionCredit"]> = [];
    const publishSnapshot = (): void =>
      worker.respond({
        kind: "snapshot",
        requestId: null,
        snapshot: {
          installStore: unavailableInstallStoreTelemetrySnapshot(),
          installerTransfer: transfer,
        },
      });
    session = createInstallerWorkerSession({
      classifyFailure: (error, operation) =>
        createInstallerFailureDiagnostic(
          "unknown",
          "terminal",
          "terminal-unclassified",
          error,
          null,
          operation,
        ),
      executeOperation: (context) => {
        observedCredits.push(context.completionCredit);
        return new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(context.signal.reason), {
            once: true,
          });
        });
      },
      now: (() => {
        let now = 0;
        return () => (now += 0.25);
      })(),
      post: (response) => worker.respond(response),
      publishSnapshot,
      requestLock: (_name, _signal, operation) => operation(),
      snapshotTransfer: () => transfer,
      targetStatus: async () => ({
        active: false,
        activeReleaseDigest: null,
        releaseDigest: "a".repeat(64),
      }),
      update: (partial) => {
        transfer = Object.freeze({ ...transfer, ...partial });
        publishSnapshot();
      },
    });
    worker.respond({ kind: "ready", protocolVersion: INSTALLER_PROTOCOL_VERSION });

    const install = service.install();
    await Promise.resolve();
    const cancel = service.cancel();
    await expect(install).rejects.toMatchObject({
      code: "cancelled",
      operation: "install",
      recovery: "retry",
    });
    await expect(cancel).resolves.toBe(true);
    expect(service.snapshot().installerTransfer).toMatchObject({
      failureCode: "cancelled",
      failureOperation: "install",
      state: "cancelled",
    });
    expect(observedCredits).toEqual([null]);
    await expect(service.cancel()).rejects.toThrow(/No active/u);

    const dispose = service.dispose();
    await expect(dispose).resolves.toBeUndefined();
    expect(service.snapshot().installerTransfer).toMatchObject({
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
    expect(worker.terminated).toBe(true);
    const requestCount = worker.requests.length;
    await expect(service.dispose()).resolves.toBeUndefined();
    expect(worker.requests).toHaveLength(requestCount);
  });

  it("reports cancellation as too late after the publication commit starts", async () => {
    const test = fixture();
    const digest = "d".repeat(64);
    test.worker.respond({ kind: "ready", protocolVersion: 7 });
    const install = test.service.install();
    await Promise.resolve();
    const cancel = test.service.cancel();
    await Promise.resolve();
    const snapshot = test.service.snapshot();
    test.worker.respond({
      kind: "snapshot",
      requestId: null,
      snapshot: {
        installStore: {
          ...snapshot.installStore,
          ...finalVerification(7, 1),
          activeReleaseDigest: digest,
          state: "ready",
        },
        installerTransfer: {
          ...snapshot.installerTransfer,
          ...finalVerification(7, 1),
          activeReleaseDigest: digest,
          activeRequestId: 1,
          completedResourceCount: 1,
          plannedDownloadBytes: 7,
          resourceCount: 1,
          state: "ready",
          totalBytes: 7,
          verifiedBytes: 7,
        },
      },
    });
    test.worker.respond({
      kind: "install-complete",
      readyBytes: 7,
      readyResourceCount: 1,
      releaseDigest: digest,
      requestId: 1,
    });
    test.worker.respond({
      cancelled: false,
      kind: "cancel-complete",
      requestId: 2,
      targetRequestId: 1,
    });

    await expect(install).resolves.toMatchObject({ releaseDigest: digest });
    await expect(cancel).resolves.toBe(false);
  });

  it("publishes live snapshots and fails closed on malformed or unknown responses", async () => {
    const test = fixture();
    const states: string[] = [];
    test.service.subscribe((snapshot) => states.push(snapshot.installerTransfer.state));
    test.worker.respond({ kind: "ready", protocolVersion: 7 });
    test.worker.respond({ kind: "not-real", requestId: 1 });
    expect(test.worker.terminated).toBe(true);
    expect(test.service.snapshot().installerTransfer.state).toBe("failed");
    expect(states.at(-1)).toBe("failed");
    const failure = await test.service.install().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(InstallerServiceError);
    expect(failure).toMatchObject({
      code: "protocol",
      recovery: "reload",
    });
    expect((failure as Error).message).toMatch(/violated protocol/);
  });

  it("fails closed when initialization reports failure before readiness", async () => {
    const test = fixture();
    const initial = test.service.snapshot();
    test.worker.respond({
      kind: "snapshot",
      requestId: null,
      snapshot: {
        installStore: initial.installStore,
        installerTransfer: {
          ...initial.installerTransfer,
          failureCode: "unknown",
          failureClass: "terminal",
          failureEvidence: "terminal-unclassified",
          failureExpectedReleaseDigest: null,
          failureMessage: "OPFS initialization failed",
          failureOperation: "session",
          failureSource: "session",
          state: "failed",
        },
      },
    });
    expect(test.worker.terminated).toBe(true);
    await expect(test.service.install()).rejects.toThrow(/initialization failed/);
  });

  it.each([
    [
      "wrong nested install-store type",
      (installStore: Record<string, unknown>) => ({ ...installStore, writtenBytes: "1" }),
    ],
    [
      "extra nested install-store key",
      (installStore: Record<string, unknown>) => ({ ...installStore, extra: true }),
    ],
  ])("fails closed on %s", async (_label, mutateInstallStore) => {
    const test = fixture();
    test.worker.respond({ kind: "ready", protocolVersion: 7 });
    const initial = test.service.snapshot();
    test.worker.respond({
      kind: "snapshot",
      requestId: null,
      snapshot: {
        installStore: mutateInstallStore({
          ...initial.installStore,
          state: "idle",
        }),
        installerTransfer: initial.installerTransfer,
      },
    });
    expect(test.worker.terminated).toBe(true);
    expect(test.service.snapshot().installerTransfer).toMatchObject({
      failureCode: "protocol",
      state: "failed",
    });
    await expect(test.service.install()).rejects.toThrow(/violated protocol/);
  });

  it("rejects duplicate readiness and refuses cancellation without an install", async () => {
    const test = fixture();
    test.worker.respond({ kind: "ready", protocolVersion: 7 });
    test.worker.respond({ kind: "ready", protocolVersion: 7 });
    expect(test.worker.terminated).toBe(true);
    await expect(test.service.cancel()).rejects.toMatchObject({
      code: "cancel-target-invalid",
      name: "InstallerServiceError",
      operation: "session",
      recovery: "retry",
    });
  });

  it("rejects concurrent install and Repair calls with the canonical typed tuple", async () => {
    const test = fixture();
    test.worker.respond({ kind: "ready", protocolVersion: 7 });
    const active = test.service.install();
    await Promise.resolve();

    await expect(test.service.install()).rejects.toMatchObject({
      code: "concurrent-install",
      name: "InstallerServiceError",
      operation: "session",
      recovery: "retry",
    });
    await expect(test.service.repair("a".repeat(64))).rejects.toMatchObject({
      code: "concurrent-install",
      name: "InstallerServiceError",
      operation: "session",
      recovery: "retry",
    });

    test.worker.respond({ kind: "not-real", requestId: 1 });
    await expect(active).rejects.toMatchObject({ code: "protocol", recovery: "reload" });
  });

  it("derives an exact same-origin shell entrypoint path", () => {
    expect(
      resolveInstallerShellEntrypointPath(
        `https://parallax-web.com/${shellEntrypointPath}`,
        "https://parallax-web.com/play",
      ),
    ).toBe(shellEntrypointPath);
    expect(() =>
      resolveInstallerShellEntrypointPath(
        `https://other.example/${shellEntrypointPath}`,
        "https://parallax-web.com/",
      ),
    ).toThrow(/same-origin/);
    expect(() =>
      resolveInstallerShellEntrypointPath(
        `https://parallax-web.com/${shellEntrypointPath}?stale=1`,
        "https://parallax-web.com/",
      ),
    ).toThrow(/safe path/);
  });
});

function finalVerification(bytes: number, resources: number) {
  return {
    finalVerificationBytes: bytes,
    finalVerificationPhase: "complete" as const,
    finalVerificationResourceCount: resources,
    finalVerificationTotalBytes: bytes,
    finalVerificationTotalResourceCount: resources,
  };
}
