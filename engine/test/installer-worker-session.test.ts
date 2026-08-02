import { describe, expect, it } from "vitest";
import {
  createInstallerFailureDiagnostic,
  createInstallerWorkerSession,
  type InstallerResponse,
  type InstallerTransferTelemetrySnapshot,
  type InstallerWorkerSessionOperationContext,
  idleInstallerTransferTelemetrySnapshot,
  parseInstallerResponse,
  parseInstallerTransferTelemetry,
  unavailableInstallStoreTelemetrySnapshot,
} from "../src";
import {
  callInstallerRepairStore,
  INSTALLER_REPAIR_STORE_BOUNDARY_RULES,
  installerRepairStoreFailureDiagnostic,
} from "../src/install/installer-repair-store-operation";

const digest = "a".repeat(64);
const shellEntrypointPath = `immutable/app-${"b".repeat(64)}.js`;

describe("installer worker session", () => {
  it.each(
    INSTALLER_REPAIR_STORE_BOUNDARY_RULES,
  )("publishes the typed $boundary tuple before Repair recovery", async (rule) => {
    const resourceId =
      rule.boundary === "admit-repair-release" || rule.boundary === "complete-repair-release"
        ? "resource-a"
        : null;
    const test = fixture(
      () =>
        callInstallerRepairStore(rule.boundary, resourceId, () =>
          Promise.reject(new Error("raw store failure")),
        ),
      {
        classifyFailure: (error) =>
          installerRepairStoreFailureDiagnostic(error) ??
          createInstallerFailureDiagnostic(
            "unknown",
            "terminal",
            "terminal-unclassified",
            error,
            null,
            "repair",
          ),
      },
    );

    await expect(
      test.send({
        expectedReleaseDigest: digest,
        kind: "repair",
        requestId: 1,
        shellEntrypointPath,
      }),
    ).resolves.toMatchObject({
      code: "store",
      failureClass: "installer-store",
      failureEvidence: rule.failureEvidence,
      kind: "failure",
      operation: "repair",
      requestId: 1,
      resourceId,
    });
    expect(test.snapshot()).toMatchObject({
      failureCode: "store",
      failureClass: "installer-store",
      failureEvidence: rule.failureEvidence,
      failureOperation: "repair",
      failureResourceId: resourceId,
      state: "failed",
    });
  });
  it("creates completion credit only from a successful Install in the same private session", async () => {
    const observed: Array<InstallerWorkerSessionOperationContext["completionCredit"]> = [];
    const test = fixture(async (context) => {
      observed.push(context.completionCredit);
      return Object.freeze({ readyBytes: 10, readyResourceCount: 2, releaseDigest: digest });
    });

    const install = test.send({ kind: "install", requestId: 1, shellEntrypointPath });
    await expect(install).resolves.toMatchObject({ kind: "install-complete", requestId: 1 });
    const repair = test.send({
      expectedReleaseDigest: digest,
      kind: "repair",
      requestId: 2,
      shellEntrypointPath,
    });
    await expect(repair).resolves.toMatchObject({ kind: "install-complete", requestId: 2 });

    expect(observed).toEqual([null, { releaseDigest: digest, resourceCount: 2, totalBytes: 10 }]);
    expect(test.snapshot().lockWaitDurationMs).toBeGreaterThan(0);
    expect(test.snapshot().operationDurationMs).toBeGreaterThan(0);
  });

  it("starts a fresh durable-store Repair session with reset 0/0 lifetime state", async () => {
    const observed: Array<InstallerWorkerSessionOperationContext["completionCredit"]> = [];
    const test = fixture(async (context) => {
      observed.push(context.completionCredit);
      expect(test.snapshot()).toMatchObject({
        completedResourceCount: 0,
        verifiedBytes: 0,
      });
      return Object.freeze({ readyBytes: 10, readyResourceCount: 2, releaseDigest: digest });
    });

    await expect(
      test.send({
        expectedReleaseDigest: digest,
        kind: "repair",
        requestId: 1,
        shellEntrypointPath,
      }),
    ).resolves.toMatchObject({ kind: "install-complete", requestId: 1 });
    expect(observed).toEqual([null]);
  });

  it("binds a Repair failure to its expected release independently of active release telemetry", async () => {
    const test = fixture(() => Promise.reject(new Error("repair failed before target binding")));

    await expect(
      test.send({
        expectedReleaseDigest: digest,
        kind: "repair",
        requestId: 1,
        shellEntrypointPath,
      }),
    ).resolves.toMatchObject({
      expectedReleaseDigest: digest,
      failureSource: "operation",
      kind: "failure",
      operation: "repair",
      requestId: 1,
    });
    expect(test.snapshot()).toMatchObject({
      activeReleaseDigest: null,
      failureExpectedReleaseDigest: digest,
      failureSource: "operation",
      state: "failed",
    });
  });

  it("retains exact concurrent-request and cancellation authority", async () => {
    let release: (() => void) | null = null;
    const test = fixture(
      (context) =>
        new Promise((resolve, reject) => {
          release = () => resolve({ readyBytes: 10, readyResourceCount: 2, releaseDigest: digest });
          context.signal.addEventListener("abort", () => reject(context.signal.reason), {
            once: true,
          });
        }),
    );
    const install = test.send({ kind: "install", requestId: 1, shellEntrypointPath });
    await Promise.resolve();
    await expect(
      test.send({
        expectedReleaseDigest: digest,
        kind: "repair",
        requestId: 2,
        shellEntrypointPath,
      }),
    ).resolves.toMatchObject({ code: "concurrent-install", kind: "failure", requestId: 2 });
    await expect(
      test.send({ kind: "cancel", requestId: 3, targetRequestId: 1 }),
    ).resolves.toMatchObject({
      cancelled: true,
      kind: "cancel-complete",
      requestId: 3,
      targetRequestId: 1,
    });
    await expect(install).resolves.toMatchObject({ code: "cancelled", kind: "failure" });
    expect(release).not.toBeNull();
  });

  it("rejects cancel-before, non-increasing request IDs, and cancel-after without stale credit", async () => {
    const observed: Array<InstallerWorkerSessionOperationContext["completionCredit"]> = [];
    const test = fixture(async (context) => {
      observed.push(context.completionCredit);
      return { readyBytes: 10, readyResourceCount: 2, releaseDigest: digest };
    });
    await expect(
      test.send({ kind: "cancel", requestId: 1, targetRequestId: 99 }),
    ).resolves.toMatchObject({
      code: "cancel-target-invalid",
      operation: "session",
    });
    await expect(
      test.send({ kind: "install", requestId: 2, shellEntrypointPath }),
    ).resolves.toMatchObject({ kind: "install-complete" });
    await expect(
      test.send({ kind: "cancel", requestId: 3, targetRequestId: 2 }),
    ).resolves.toMatchObject({
      code: "cancel-target-invalid",
      operation: "session",
    });
    await expect(
      test.send({
        expectedReleaseDigest: digest,
        kind: "repair",
        requestId: 3,
        shellEntrypointPath,
      }),
    ).resolves.toMatchObject({
      code: "protocol",
      operation: "session",
    });
    expect(observed).toEqual([null]);
  });

  it("rejects out-of-order request IDs while a new worker session restarts at one", async () => {
    const first = fixture(async () => ({
      readyBytes: 10,
      readyResourceCount: 2,
      releaseDigest: digest,
    }));
    await expect(
      first.send({ kind: "cancel", requestId: 3, targetRequestId: 99 }),
    ).resolves.toMatchObject({ code: "cancel-target-invalid", requestId: 3 });
    await expect(
      first.send({ kind: "target-status", requestId: 2, shellEntrypointPath }),
    ).resolves.toMatchObject({ code: "protocol", requestId: 2 });

    const restarted = fixture(async () => ({
      readyBytes: 10,
      readyResourceCount: 2,
      releaseDigest: digest,
    }));
    await expect(
      restarted.send({ kind: "target-status", requestId: 1, shellEntrypointPath }),
    ).resolves.toMatchObject({ kind: "target-status", requestId: 1 });
  });

  it("consumes malformed newer IDs and fails closed at the safe-integer ceiling", async () => {
    const test = fixture(async () => ({
      readyBytes: 10,
      readyResourceCount: 2,
      releaseDigest: digest,
    }));

    await expect(test.sendRaw({ kind: "unknown", requestId: 5 }, 5)).resolves.toMatchObject({
      code: "protocol",
      requestId: 5,
    });
    await expect(
      test.send({ kind: "target-status", requestId: 5, shellEntrypointPath }),
    ).resolves.toMatchObject({ code: "protocol", requestId: 5 });
    await expect(
      test.send({ kind: "target-status", requestId: 4, shellEntrypointPath }),
    ).resolves.toMatchObject({ code: "protocol", requestId: 4 });
    await expect(
      test.sendRaw(
        { extra: true, kind: "snapshot", requestId: Number.MAX_SAFE_INTEGER },
        Number.MAX_SAFE_INTEGER,
      ),
    ).resolves.toMatchObject({ code: "protocol", requestId: Number.MAX_SAFE_INTEGER });
    await expect(
      test.send({
        kind: "target-status",
        requestId: Number.MAX_SAFE_INTEGER,
        shellEntrypointPath,
      }),
    ).resolves.toMatchObject({ code: "protocol", requestId: Number.MAX_SAFE_INTEGER });
    await expect(
      test.send({ kind: "target-status", requestId: 6, shellEntrypointPath }),
    ).resolves.toMatchObject({ code: "protocol", requestId: 6 });

    const restarted = fixture(async () => ({
      readyBytes: 10,
      readyResourceCount: 2,
      releaseDigest: digest,
    }));
    await expect(
      restarted.send({ kind: "target-status", requestId: 1, shellEntrypointPath }),
    ).resolves.toMatchObject({ kind: "target-status", requestId: 1 });
  });

  it("completes cancellation even when operation failure handling rejects", async () => {
    const test = fixture(
      (context) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(context.signal.reason), {
            once: true,
          });
        }),
      { throwOnUpdateState: "cancelled" },
    );
    void test.send({ kind: "install", requestId: 1, shellEntrypointPath });
    await Promise.resolve();

    await expect(
      test.send({ kind: "cancel", requestId: 2, targetRequestId: 1 }),
    ).resolves.toMatchObject({ cancelled: true, kind: "cancel-complete", requestId: 2 });
  });

  it("completes disposal even when operation failure handling rejects", async () => {
    const test = fixture(
      (context) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(context.signal.reason), {
            once: true,
          });
        }),
      { throwOnUpdateState: "cancelled" },
    );
    void test.send({ kind: "install", requestId: 1, shellEntrypointPath });
    await Promise.resolve();

    await expect(test.send({ kind: "dispose", requestId: 2 })).resolves.toMatchObject({
      kind: "dispose-complete",
      requestId: 2,
    });
    expectCleanDisposedTransfer(test.snapshot());
  });

  it("always emits an authoritative target-status failure even when classification throws", async () => {
    const test = fixture(
      async () => ({ readyBytes: 10, readyResourceCount: 2, releaseDigest: digest }),
      {
        classifyFailure: () => {
          throw new Error("classification failed at C:\\Private Folder\\secret.txt");
        },
        targetStatus: () =>
          Promise.reject(new DOMException("Current target timed out", "TimeoutError")),
      },
    );
    await expect(
      test.send({ kind: "target-status", requestId: 1, shellEntrypointPath }),
    ).resolves.toMatchObject({
      code: "unknown",
      failureClass: "terminal",
      failureEvidence: "terminal-unclassified",
      operation: "target-status",
    });
  });

  it("carries target-status timeout classification as its exact authoritative tuple", async () => {
    const test = fixture(
      async () => ({ readyBytes: 10, readyResourceCount: 2, releaseDigest: digest }),
      {
        classifyFailure: (error, operation) =>
          createInstallerFailureDiagnostic(
            "transport",
            "target",
            "target-manifest",
            error,
            null,
            operation,
          ),
        targetStatus: () =>
          Promise.reject(new DOMException("Current target timed out", "TimeoutError")),
      },
    );
    await expect(
      test.send({ kind: "target-status", requestId: 1, shellEntrypointPath }),
    ).resolves.toMatchObject({
      code: "transport",
      failureClass: "target",
      failureEvidence: "target-manifest",
      operation: "target-status",
    });
  });

  it("publishes a clean parsable terminal snapshot when an idle session is disposed", async () => {
    const test = fixture(async () => ({
      readyBytes: 10,
      readyResourceCount: 2,
      releaseDigest: digest,
    }));

    const response = await test.send({ kind: "dispose", requestId: 1 });

    expect(parseInstallerResponse(response)).toEqual({ kind: "dispose-complete", requestId: 1 });
    expectCleanDisposedTransfer(test.snapshot());
  });

  it("clears the complete failure tuple when a failed session is disposed", async () => {
    const test = fixture(() => Promise.reject(new Error("transfer failed")));
    await expect(
      test.send({ kind: "install", requestId: 1, shellEntrypointPath }),
    ).resolves.toMatchObject({ kind: "failure", requestId: 1 });
    expect(test.snapshot()).toMatchObject({ failureCode: "unknown", state: "failed" });

    await expect(test.send({ kind: "dispose", requestId: 2 })).resolves.toMatchObject({
      kind: "dispose-complete",
      requestId: 2,
    });
    expectCleanDisposedTransfer(test.snapshot());
  });

  it("clears the complete failure tuple when a cancelled session is disposed", async () => {
    const test = fixture(
      (context) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(context.signal.reason), {
            once: true,
          });
        }),
    );
    const install = test.send({ kind: "install", requestId: 1, shellEntrypointPath });
    await Promise.resolve();
    const cancel = test.send({ kind: "cancel", requestId: 2, targetRequestId: 1 });
    await expect(install).resolves.toMatchObject({ code: "cancelled", kind: "failure" });
    await expect(cancel).resolves.toMatchObject({ cancelled: true, kind: "cancel-complete" });
    expect(test.snapshot()).toMatchObject({ failureCode: "cancelled", state: "cancelled" });

    await expect(test.send({ kind: "dispose", requestId: 3 })).resolves.toMatchObject({
      kind: "dispose-complete",
      requestId: 3,
    });
    expectCleanDisposedTransfer(test.snapshot());
  });

  it("waits for active cancellation and publishes only a clean disposed terminal snapshot", async () => {
    const test = fixture(
      (context) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(context.signal.reason), {
            once: true,
          });
        }),
    );
    const install = test.send({ kind: "install", requestId: 1, shellEntrypointPath });
    await Promise.resolve();
    const dispose = test.send({ kind: "dispose", requestId: 2 });

    await expect(install).resolves.toMatchObject({ code: "cancelled", kind: "failure" });
    await expect(dispose).resolves.toMatchObject({ kind: "dispose-complete", requestId: 2 });
    expectCleanDisposedTransfer(test.snapshot());
    await expect(test.send({ kind: "dispose", requestId: 3 })).resolves.toMatchObject({
      code: "disposed",
      kind: "failure",
      requestId: 3,
    });
  });
});

function expectCleanDisposedTransfer(snapshot: InstallerTransferTelemetrySnapshot): void {
  expect(parseInstallerTransferTelemetry(snapshot)).toEqual(snapshot);
  expect(
    parseInstallerResponse({
      kind: "snapshot",
      requestId: null,
      snapshot: {
        installStore: unavailableInstallStoreTelemetrySnapshot(),
        installerTransfer: snapshot,
      },
    }),
  ).toMatchObject({
    kind: "snapshot",
    snapshot: { installerTransfer: { state: "disposed" } },
  });
  expect(snapshot).toMatchObject({
    activeRequestId: null,
    activeResourceCount: 0,
    activeResourceId: null,
    failureCode: null,
    failureClass: null,
    failureEvidence: null,
    failureMessage: null,
    failureOperation: null,
    failureResourceId: null,
    state: "disposed",
  });
}

function fixture(
  executeOperation: (context: InstallerWorkerSessionOperationContext) => Promise<{
    readonly readyBytes: number;
    readonly readyResourceCount: number;
    readonly releaseDigest: string;
  }>,
  overrides: Partial<{
    classifyFailure: Parameters<typeof createInstallerWorkerSession>[0]["classifyFailure"];
    targetStatus: Parameters<typeof createInstallerWorkerSession>[0]["targetStatus"];
    throwOnUpdateState: InstallerTransferTelemetrySnapshot["state"];
  }> = {},
) {
  let transfer = idleInstallerTransferTelemetrySnapshot(1, 8);
  const waiters = new Map<number, (response: InstallerResponse) => void>();
  const session = createInstallerWorkerSession({
    classifyFailure:
      overrides.classifyFailure ??
      ((error, operation) =>
        createInstallerFailureDiagnostic(
          "unknown",
          "terminal",
          "terminal-unclassified",
          error,
          null,
          operation,
        )),
    executeOperation,
    now: (() => {
      let now = 0;
      return () => (now += 0.25);
    })(),
    post(response) {
      if ("requestId" in response && response.requestId !== null) {
        waiters.get(response.requestId)?.(response);
      }
    },
    publishSnapshot: () => undefined,
    requestLock: (_name, _signal, operation) => operation(),
    snapshotTransfer: () => transfer,
    targetStatus:
      overrides.targetStatus ??
      (async () => ({
        active: true,
        activeReleaseDigest: digest,
        releaseDigest: digest,
      })),
    update(partial: Partial<InstallerTransferTelemetrySnapshot>) {
      transfer = Object.freeze({ ...transfer, ...partial });
      if (
        overrides.throwOnUpdateState !== undefined &&
        partial.state === overrides.throwOnUpdateState
      ) {
        throw new Error(`Injected ${partial.state} telemetry update failure`);
      }
    },
  });
  return Object.freeze({
    sendRaw(request: unknown, requestId: number): Promise<InstallerResponse> {
      return new Promise((resolve) => {
        waiters.set(requestId, resolve);
        session.message(request);
      });
    },
    send(
      request:
        | {
            readonly kind: "cancel";
            readonly requestId: number;
            readonly targetRequestId: number;
          }
        | {
            readonly kind: "install";
            readonly requestId: number;
            readonly shellEntrypointPath: string;
          }
        | {
            readonly expectedReleaseDigest: string;
            readonly kind: "repair";
            readonly requestId: number;
            readonly shellEntrypointPath: string;
          }
        | {
            readonly kind: "target-status";
            readonly requestId: number;
            readonly shellEntrypointPath: string;
          }
        | {
            readonly kind: "dispose";
            readonly requestId: number;
          },
    ): Promise<InstallerResponse> {
      return new Promise((resolve) => {
        waiters.set(request.requestId, resolve);
        session.message(request);
      });
    },
    snapshot: () => transfer,
  });
}
