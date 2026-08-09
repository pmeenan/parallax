import {
  type InstallerInstallResult,
  InstallerServiceError,
  type InstallerSnapshot,
  idleInstallerTransferTelemetrySnapshot,
  type OfflineShellAdmission,
  type OfflineShellGeneration,
  OfflineShellServiceError,
  type OfflineShellTelemetrySnapshot,
  unavailableInstallStoreTelemetrySnapshot,
  unavailableOfflineShellTelemetrySnapshot,
} from "@parallax/engine";
import { describe, expect, it, vi } from "vitest";
import {
  createInstallerController,
  type InstallerControllerInput,
} from "../src/installer-controller";
import { createInstallerViewModel } from "../src/installer-ui";

function installerSnapshot(
  transfer: Partial<InstallerSnapshot["installerTransfer"]> = {},
): InstallerSnapshot {
  return Object.freeze({
    installStore: unavailableInstallStoreTelemetrySnapshot(),
    installerTransfer: Object.freeze({
      ...idleInstallerTransferTelemetrySnapshot(),
      ...transfer,
    }),
  });
}

function deferredInstall(): {
  readonly promise: Promise<InstallerInstallResult>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: InstallerInstallResult) => void;
} {
  let resolvePromise!: (value: InstallerInstallResult) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<InstallerInstallResult>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return Object.freeze({ promise, reject: rejectPromise, resolve: resolvePromise });
}

function shellGeneration(
  releaseDigest = "0".repeat(64),
  artifactToken = "1",
): OfflineShellGeneration {
  const artifactDigest = artifactToken.repeat(64);
  const identity = (path: string) => Object.freeze({ bytes: 1, path, sha256: "2".repeat(64) });
  return Object.freeze({
    appEntrypoint: identity(`immutable/app-${"2".repeat(64)}.js`),
    artifactDigest,
    buildManifestSchemaVersion: 14,
    engineArtifact: identity(`immutable/engine-${"2".repeat(64)}.js`),
    generationId: `${artifactDigest}:${releaseDigest}`,
    installManifestSchemaVersion: 1,
    releaseDigest,
    resources: Object.freeze([
      Object.freeze({
        ...identity("index.html"),
        mimeType: "text/html",
      }),
      Object.freeze({
        ...identity("build-manifest.json"),
        mimeType: "application/json",
      }),
      Object.freeze({
        ...identity("install-manifest.json"),
        mimeType: "application/json",
      }),
      Object.freeze({
        ...identity(`immutable/app-${"2".repeat(64)}.js`),
        mimeType: "application/javascript",
      }),
      Object.freeze({
        ...identity(`immutable/engine-${"2".repeat(64)}.js`),
        mimeType: "application/javascript",
      }),
      Object.freeze({
        ...identity("service-worker.js"),
        mimeType: "application/javascript",
      }),
    ]),
    saveSchemaVersion: 1,
    schemaVersion: 1,
    serviceWorker: Object.freeze({
      ...identity("service-worker.js"),
      path: "service-worker.js",
    }),
  });
}

function activeShellTelemetry(generation: OfflineShellGeneration): OfflineShellTelemetrySnapshot {
  return Object.freeze({
    activateCount: 1,
    activeArtifactDigest: generation.artifactDigest,
    activeGenerationId: generation.generationId,
    activeReleaseDigest: generation.releaseDigest,
    cacheHitCount: 0,
    cacheMissCount: 0,
    candidateGenerationId: null,
    failureCode: null,
    failureCount: 0,
    failureMessage: null,
    mixedGenerationCount: 0,
    prepareCount: 1,
    previousGenerationId: null,
    rollbackCount: 0,
    schemaVersion: 2,
    state: "active",
    verifiedBytes: 1,
    verifyCount: 1,
    verifyDurationMs: 1,
    verifyHighWaterMs: 1,
  });
}

function fixture(input?: {
  readonly cancel?: InstallerControllerInput["installer"]["cancel"];
  readonly install?: InstallerControllerInput["installer"]["install"];
  readonly repair?: InstallerControllerInput["installer"]["repair"];
  readonly launch?: InstallerControllerInput["launch"];
  readonly persist?: InstallerControllerInput["installer"]["requestPersistence"];
  readonly prepareShell?: InstallerControllerInput["offlineShell"]["prepare"];
  readonly targetStatus?: InstallerControllerInput["installer"]["targetStatus"];
}) {
  let snapshot = installerSnapshot();
  const listeners = new Set<(next: InstallerSnapshot) => void>();
  const cancel = vi.fn(input?.cancel ?? (() => Promise.resolve(true)));
  let currentReleaseDigest = "0".repeat(64);
  let installedActive = false;
  const rawInstall =
    input?.install ??
    vi.fn(() =>
      Promise.resolve({
        readyBytes: 100,
        readyResourceCount: 2,
        releaseDigest: "a".repeat(64),
      }),
    );
  const install = vi.fn(async () => {
    const result = await rawInstall();
    currentReleaseDigest = result.releaseDigest;
    installedActive = true;
    return result;
  });
  const repair = vi.fn(input?.repair ?? (() => install()));
  const requestPersistence = input?.persist ?? vi.fn(() => Promise.resolve(true));
  const targetStatus =
    input?.targetStatus ??
    vi.fn(() =>
      Promise.resolve(
        installedActive
          ? {
              active: true,
              activeReleaseDigest: currentReleaseDigest,
              releaseDigest: currentReleaseDigest,
            }
          : {
              active: false,
              activeReleaseDigest: null,
              releaseDigest: currentReleaseDigest,
            },
      ),
    );
  const launch = vi.fn(
    input?.launch ??
      ((_releaseDigest, _shellAdmission, shellAuthority) => {
        shellAuthority.markAdmitted();
        return Promise.resolve();
      }),
  );
  const reload = vi.fn();
  const rawPrepareShell =
    input?.prepareShell ?? vi.fn(async () => shellGeneration(currentReleaseDigest));
  let shellSnapshot = unavailableOfflineShellTelemetrySnapshot();
  const shellListeners = new Set<(next: OfflineShellTelemetrySnapshot) => void>();
  const emitShellSnapshot = (next: OfflineShellTelemetrySnapshot): void => {
    shellSnapshot = next;
    for (const listener of shellListeners) listener(next);
  };
  const prepareShell = vi.fn(async () => {
    const generation = await rawPrepareShell();
    emitShellSnapshot(activeShellTelemetry(generation));
    return generation;
  });
  const installer = {
    cancel,
    install,
    repair,
    requestPersistence,
    snapshot: () => snapshot,
    subscribe(listener: (next: InstallerSnapshot) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    targetStatus,
  } satisfies InstallerControllerInput["installer"];
  const controller = createInstallerController({
    installer,
    launch,
    offlineShell: {
      prepare: prepareShell,
      snapshot: () => shellSnapshot,
      subscribe(listener) {
        shellListeners.add(listener);
        listener(shellSnapshot);
        return () => shellListeners.delete(listener);
      },
    },
    reload,
  });
  return {
    cancel,
    controller,
    emit(transfer: Partial<InstallerSnapshot["installerTransfer"]>) {
      snapshot = installerSnapshot(transfer);
      for (const listener of listeners) listener(snapshot);
    },
    emitShell(generation: OfflineShellGeneration | null) {
      emitShellSnapshot(
        generation === null
          ? unavailableOfflineShellTelemetrySnapshot()
          : activeShellTelemetry(generation),
      );
    },
    emitShellControlFailure(generation: OfflineShellGeneration) {
      emitShellSnapshot(
        Object.freeze({
          ...activeShellTelemetry(generation),
          failureCode: "shell-release-mismatch",
          failureCount: 1,
          failureMessage: "exact controller replaced",
          state: "failed",
        }),
      );
    },
    emitShellUnavailable(generation: OfflineShellGeneration) {
      emitShellSnapshot(
        Object.freeze({
          ...activeShellTelemetry(generation),
          failureCode: "shell-unavailable",
          failureCount: 1,
          failureMessage: "offline shell endpoint disconnected",
          state: "failed",
        }),
      );
    },
    install,
    repair,
    launch,
    reload,
    requestPersistence,
    prepareShell,
    targetStatus,
  };
}

describe("installer controller", () => {
  it("exposes an explicit repair operation only after exact target authority exists", async () => {
    const digest = "a".repeat(64);
    const repair = vi.fn(() =>
      Promise.resolve({
        readyBytes: 100,
        readyResourceCount: 2,
        releaseDigest: digest,
      }),
    );
    const test = fixture({ repair });

    await expect(test.controller.repair()).rejects.toThrow(/exact active target/);
    await test.controller.installOrResume();
    expect(test.controller.snapshot().state).toBe("ready");
    await test.controller.repair();

    expect(repair).toHaveBeenCalledTimes(1);
    expect(test.controller.snapshot()).toMatchObject({
      releaseDigest: digest,
      state: "ready",
    });
  });

  it("retains the exact failed target so a second explicit Repair can recover it", async () => {
    const digest = "a".repeat(64);
    const firstRepair = deferredInstall();
    let attempts = 0;
    const repair = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        return firstRepair.promise;
      }
      return {
        readyBytes: 100,
        readyResourceCount: 2,
        releaseDigest: digest,
      };
    });
    const test = fixture({ repair });
    await test.controller.installOrResume();

    const failedRepair = test.controller.repair();
    await Promise.resolve();
    test.emit({ activeRequestId: 1, state: "waiting-lock" });
    test.emit({
      activeRequestId: 1,
      failureCode: "integrity",
      failureClass: "installer-transfer",
      failureEvidence: "transfer-integrity",
      failureExpectedReleaseDigest: digest,
      failureMessage: "Exact replacement failed integrity",
      failureOperation: "repair",
      failureResourceId: "resource-a",
      failureSource: "operation",
      state: "failed",
    });
    expect(test.controller.snapshot()).toMatchObject({
      failure: { code: "integrity", recovery: "repair" },
      releaseDigest: digest,
      state: "failed",
    });
    const repairFailure = new InstallerServiceError(
      "integrity",
      "Exact replacement failed integrity",
      "resource-a",
      "repair",
      "repair",
      "installer-transfer",
      "transfer-integrity",
      digest,
      "operation",
    );
    firstRepair.reject(repairFailure);
    await failedRepair;
    expect(test.controller.snapshot()).toMatchObject({
      failure: { code: "integrity", recovery: "repair", resourceId: "resource-a" },
      releaseDigest: digest,
      state: "failed",
    });
    expect(createInstallerViewModel(test.controller.snapshot()).canRepair).toBe(true);

    await test.controller.repair();
    expect(test.controller.snapshot()).toMatchObject({
      releaseDigest: digest,
      state: "ready",
    });
    expect(repair).toHaveBeenCalledTimes(2);
    expect(test.install).toHaveBeenCalledTimes(1);
  });

  it("ignores stale terminal telemetry from a prior request during a newer operation", async () => {
    const first = deferredInstall();
    const second = deferredInstall();
    let attempt = 0;
    const test = fixture({
      install: vi.fn(() => {
        attempt += 1;
        return attempt === 1 ? first.promise : second.promise;
      }),
    });

    const firstOperation = test.controller.installOrResume();
    await Promise.resolve();
    test.emit({ activeRequestId: 1, state: "waiting-lock" });
    test.emit({
      activeRequestId: 1,
      failureCode: "transport",
      failureClass: "installer-transfer",
      failureEvidence: "transfer-transport",
      failureMessage: "first request failed",
      failureOperation: "install",
      failureResourceId: "resource-a",
      state: "failed",
    });
    first.reject(
      new InstallerServiceError("transport", "first request failed", "resource-a", "install"),
    );
    await firstOperation;

    const secondOperation = test.controller.installOrResume();
    await Promise.resolve();
    test.emit({ activeRequestId: 2, state: "waiting-lock" });
    test.emit({
      activeRequestId: 1,
      activeResourceId: "stale-resource",
      downloadedBytes: 999,
      state: "transferring",
    });
    test.emit({ activeRequestId: null, activeReleaseDigest: "b".repeat(64), state: "ready" });
    expect(test.controller.snapshot()).toMatchObject({
      activeResourceId: null,
      downloadedBytes: 0,
      transferState: "waiting-lock",
    });
    test.emit({
      activeRequestId: 1,
      failureCode: "transport",
      failureClass: "installer-transfer",
      failureEvidence: "transfer-transport",
      failureMessage: "stale first-request terminal publish",
      failureOperation: "install",
      failureResourceId: "resource-a",
      state: "failed",
    });
    test.emit({
      activeRequestId: null,
      failureCode: "transport",
      failureClass: "installer-transfer",
      failureEvidence: "transfer-transport",
      failureMessage: "stale terminal cleanup publish",
      failureOperation: "install",
      failureResourceId: "resource-a",
      state: "failed",
    });
    expect(test.controller.snapshot()).toMatchObject({ failure: null, state: "installing" });

    second.resolve({
      readyBytes: 100,
      readyResourceCount: 2,
      releaseDigest: "a".repeat(64),
    });
    await secondOperation;
    expect(test.controller.snapshot().state).toBe("ready");
  });

  it("ignores ready-to-null cleanup while exact shell preparation is pending", async () => {
    const digest = "a".repeat(64);
    const install = deferredInstall();
    let resolveShell!: (generation: OfflineShellGeneration) => void;
    const test = fixture({
      install: vi.fn(() => install.promise),
      prepareShell: vi.fn(
        () =>
          new Promise<OfflineShellGeneration>((resolve) => {
            resolveShell = resolve;
          }),
      ),
    });

    const operation = test.controller.installOrResume();
    await Promise.resolve();
    test.emit({
      activeReleaseDigest: digest,
      activeRequestId: 1,
      downloadedBytes: 100,
      state: "ready",
    });
    install.resolve({ readyBytes: 100, readyResourceCount: 2, releaseDigest: digest });
    await Promise.resolve();
    await Promise.resolve();

    test.emit({ activeReleaseDigest: digest, activeRequestId: null, state: "ready" });
    expect(test.controller.snapshot()).toMatchObject({
      downloadedBytes: 100,
      state: "installing",
      transferState: "ready",
    });

    resolveShell(shellGeneration(digest));
    await operation;
    expect(test.controller.snapshot()).toMatchObject({ releaseDigest: digest, state: "ready" });
  });

  it("revokes admitted Repair authority when worker failure evidence contradicts its target", async () => {
    const admittedDigest = "a".repeat(64);
    const discoveredDigest = "b".repeat(64);
    const repair = deferredInstall();
    const test = fixture({ repair: vi.fn(() => repair.promise) });
    await test.controller.installOrResume();

    const operation = test.controller.repair();
    await Promise.resolve();
    test.emit({ activeRequestId: 1, state: "waiting-lock" });
    test.emit({
      activeReleaseDigest: discoveredDigest,
      activeRequestId: 1,
      failureCode: "transport",
      failureClass: "installer-transfer",
      failureEvidence: "transfer-transport",
      failureExpectedReleaseDigest: admittedDigest,
      failureMessage: `Worker discovered contradictory release ${discoveredDigest}`,
      failureOperation: "repair",
      failureResourceId: null,
      failureSource: "operation",
      state: "failed",
    });
    repair.reject(
      new InstallerServiceError(
        "transport",
        "contradictory target",
        null,
        "repair",
        undefined,
        undefined,
        undefined,
        admittedDigest,
        "operation",
      ),
    );
    await operation;

    expect(test.controller.snapshot()).toMatchObject({
      failure: { recovery: "retry" },
      releaseDigest: null,
      shellGenerationId: null,
      state: "failed",
    });
    expect(createInstallerViewModel(test.controller.snapshot())).toMatchObject({
      canInstall: true,
      canRepair: false,
    });
  });

  it("cancels repair persistence preflight without revoking existing Ready authority", async () => {
    let persistenceCalls = 0;
    const repairPersistence = {
      resolve: (_value: boolean): void => {
        throw new Error("repair persistence resolver was not installed");
      },
    };
    const test = fixture({
      persist: vi.fn(() => {
        persistenceCalls += 1;
        return persistenceCalls === 1
          ? Promise.resolve(true)
          : new Promise<boolean>((resolve) => {
              repairPersistence.resolve = resolve;
            });
      }),
    });
    await test.controller.installOrResume();
    const repair = test.controller.repair();
    expect(test.controller.snapshot()).toMatchObject({
      persistence: "requesting",
      state: "requesting-persistence",
    });
    await test.controller.cancel();
    expect(test.controller.snapshot()).toMatchObject({
      persistence: "granted",
      state: "ready",
    });
    expect(createInstallerViewModel(test.controller.snapshot())).toMatchObject({
      canLaunch: true,
      persistenceWarning: null,
    });
    repairPersistence.resolve(true);
    await repair;
    expect(test.controller.snapshot().persistence).toBe("granted");
    expect(test.repair).not.toHaveBeenCalled();
  });

  it("restores denied durability and its warning when repair persistence preflight is cancelled", async () => {
    let persistenceCalls = 0;
    let resolveLatePersistence!: (value: boolean) => void;
    const test = fixture({
      persist: vi.fn(() => {
        persistenceCalls += 1;
        return persistenceCalls === 1
          ? Promise.resolve(false)
          : new Promise<boolean>((resolve) => {
              resolveLatePersistence = resolve;
            });
      }),
    });
    await test.controller.installOrResume();
    const releaseDigest = test.controller.snapshot().releaseDigest;
    expect(createInstallerViewModel(test.controller.snapshot()).persistenceWarning).toMatch(
      /may evict/,
    );

    const repair = test.controller.repair();
    expect(test.controller.snapshot()).toMatchObject({
      persistence: "requesting",
      releaseDigest,
      state: "requesting-persistence",
    });
    expect(createInstallerViewModel(test.controller.snapshot())).toMatchObject({
      canLaunch: false,
      persistenceWarning: null,
    });

    await test.controller.cancel();
    expect(test.controller.snapshot()).toMatchObject({
      persistence: "denied",
      releaseDigest,
      state: "ready",
    });
    expect(createInstallerViewModel(test.controller.snapshot())).toMatchObject({
      canLaunch: true,
      persistenceWarning: expect.stringMatching(/may evict/),
    });

    resolveLatePersistence(true);
    await repair;
    expect(test.controller.snapshot()).toMatchObject({
      persistence: "denied",
      releaseDigest,
      state: "ready",
    });
    expect(test.repair).not.toHaveBeenCalled();
  });

  it("restores not-requested durability when initial persistence preflight is cancelled", async () => {
    let resolveLatePersistence!: (value: boolean) => void;
    const test = fixture({
      persist: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveLatePersistence = resolve;
          }),
      ),
    });

    const install = test.controller.installOrResume();
    expect(test.controller.snapshot().persistence).toBe("requesting");
    await test.controller.cancel();
    expect(test.controller.snapshot()).toMatchObject({
      persistence: "not-requested",
      releaseDigest: null,
      state: "cancelled",
    });

    resolveLatePersistence(true);
    await install;
    expect(test.controller.snapshot()).toMatchObject({
      persistence: "not-requested",
      releaseDigest: null,
      state: "cancelled",
    });
    expect(test.install).not.toHaveBeenCalled();
  });

  it.each([
    { late: "resolve", prior: "not-requested" },
    { late: "reject", prior: "granted" },
    { late: "resolve", prior: "denied" },
  ] as const)("ignores stale terminal telemetry during $prior persistence that later $late", async ({
    late,
    prior,
  }) => {
    let persistenceCalls = 0;
    let settleLatePersistence!: () => void;
    const test = fixture({
      persist: vi.fn(() => {
        persistenceCalls += 1;
        if (prior !== "not-requested" && persistenceCalls === 1) {
          return Promise.resolve(prior === "granted");
        }
        return new Promise<boolean>((resolve, reject) => {
          settleLatePersistence = () =>
            late === "resolve" ? resolve(true) : reject(new Error("late persistence failure"));
        });
      }),
    });
    if (prior !== "not-requested") await test.controller.installOrResume();
    const operation =
      prior === "not-requested" ? test.controller.installOrResume() : test.controller.repair();
    expect(test.controller.snapshot().persistence).toBe("requesting");

    test.emit({
      failureCode: "integrity",
      failureClass: "installer-transfer",
      failureEvidence: "transfer-integrity",
      failureMessage: "authoritative worker failure",
      failureOperation: prior === "not-requested" ? "install" : "repair",
      failureResourceId: "resource-a",
      state: "failed",
    });

    expect(test.controller.snapshot()).toMatchObject({
      failure: null,
      persistence: "requesting",
      state: "requesting-persistence",
    });

    settleLatePersistence();
    await operation;
    expect(test.controller.snapshot().state).toBe(late === "reject" ? "failed" : "ready");
  });

  it("accepts a null-request session failure while persistence is pending", async () => {
    let resolvePersistence!: (value: boolean) => void;
    const test = fixture({
      persist: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolvePersistence = resolve;
          }),
      ),
    });

    const operation = test.controller.installOrResume();
    test.emit({
      activeRequestId: null,
      failureCode: "protocol",
      failureClass: "protocol",
      failureEvidence: "protocol-request",
      failureExpectedReleaseDigest: null,
      failureMessage: "Installer worker failed closed",
      failureOperation: "session",
      failureResourceId: null,
      failureSource: "session",
      state: "failed",
    });
    expect(test.controller.snapshot()).toMatchObject({
      failure: { code: "protocol", recovery: "reload" },
      state: "failed",
    });

    resolvePersistence(true);
    await operation;
    expect(test.controller.snapshot().state).toBe("failed");
    expect(test.install).not.toHaveBeenCalled();
  });

  it.each([
    { change: "replacement", late: "resolve" },
    { change: "control-loss", late: "reject" },
  ] as const)("terminally revokes repair authority on offline-shell $change before a late persist $late", async ({
    change,
    late,
  }) => {
    const digest = "a".repeat(64);
    const initial = shellGeneration(digest, "1");
    let persistenceCalls = 0;
    let settleLatePersistence!: () => void;
    const test = fixture({
      persist: vi.fn(() => {
        persistenceCalls += 1;
        if (persistenceCalls === 1) return Promise.resolve(true);
        return new Promise<boolean>((resolve, reject) => {
          settleLatePersistence = () =>
            late === "resolve" ? resolve(true) : reject(new Error("late persistence failure"));
        });
      }),
      prepareShell: vi.fn(() => Promise.resolve(initial)),
    });
    await test.controller.installOrResume();
    const repair = test.controller.repair();
    expect(test.controller.snapshot()).toMatchObject({
      persistence: "requesting",
      state: "requesting-persistence",
    });

    if (change === "replacement") {
      test.emitShell(shellGeneration(digest, "3"));
    } else {
      test.emitShellControlFailure(initial);
    }

    expect(test.controller.snapshot()).toMatchObject({
      failure: { code: "shell-release-mismatch", recovery: "reload" },
      persistence: "granted",
      releaseDigest: null,
      shellGenerationId: null,
      state: "failed",
    });
    await expect(test.controller.cancel()).rejects.toThrow(/active install/);

    settleLatePersistence();
    await repair;
    expect(test.controller.snapshot()).toMatchObject({
      failure: { code: "shell-release-mismatch", recovery: "reload" },
      persistence: "granted",
      releaseDigest: null,
      shellGenerationId: null,
      state: "failed",
    });
    expect(test.repair).not.toHaveBeenCalled();
    expect(test.install).toHaveBeenCalledOnce();
  });

  it("does nothing eagerly, requests persistence in the install action, and gates launch", async () => {
    const order: string[] = [];
    const test = fixture({
      install: vi.fn(() => {
        order.push("install");
        return Promise.resolve({
          readyBytes: 100,
          readyResourceCount: 2,
          releaseDigest: "b".repeat(64),
        });
      }),
      persist: vi.fn(() => {
        order.push("persist");
        return Promise.resolve(false);
      }),
    });

    expect(test.requestPersistence).not.toHaveBeenCalled();
    expect(test.install).not.toHaveBeenCalled();
    await expect(test.controller.launch()).rejects.toThrow(/requires the target release/);

    const operation = test.controller.installOrResume();
    expect(order).toEqual(["persist"]);
    await operation;

    expect(order).toEqual(["persist", "install"]);
    expect(test.controller.snapshot()).toMatchObject({
      persistence: "denied",
      releaseDigest: "b".repeat(64),
      state: "ready",
    });
    expect(createInstallerViewModel(test.controller.snapshot()).persistenceWarning).toMatch(
      /may evict/,
    );
    await test.controller.launch();
    expect(test.launch).toHaveBeenCalledWith(
      "b".repeat(64),
      expect.objectContaining({ releaseDigest: "b".repeat(64) }),
      expect.objectContaining({
        markAdmitted: expect.any(Function),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(test.controller.snapshot().state).toBe("launched");
  });

  it("unlocks launch on reload only when the exact current target is active", async () => {
    const digest = "9".repeat(64);
    const test = fixture({
      prepareShell: vi.fn(() => Promise.resolve(shellGeneration(digest))),
      targetStatus: vi.fn(() =>
        Promise.resolve({
          active: true,
          activeReleaseDigest: digest,
          releaseDigest: digest,
        }),
      ),
    });

    const refresh = test.controller.refreshTarget();
    expect(test.controller.snapshot().state).toBe("checking");
    await refresh;

    expect(test.controller.snapshot()).toMatchObject({
      releaseDigest: digest,
      state: "ready",
    });
    expect(test.install).not.toHaveBeenCalled();
    expect(test.requestPersistence).not.toHaveBeenCalled();
    await test.controller.launch();
    expect(test.launch).toHaveBeenCalledWith(
      digest,
      expect.objectContaining({ releaseDigest: digest }),
      expect.objectContaining({
        markAdmitted: expect.any(Function),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("invalidates Ready when another controlled client selects a different generation", async () => {
    const digest = "9".repeat(64);
    const initial = shellGeneration(digest, "1");
    const replacement = shellGeneration(digest, "3");
    const test = fixture({
      prepareShell: vi.fn(() => Promise.resolve(initial)),
      targetStatus: vi.fn(() =>
        Promise.resolve({
          active: true,
          activeReleaseDigest: digest,
          releaseDigest: digest,
        }),
      ),
    });

    await test.controller.refreshTarget();
    expect(test.controller.snapshot().state).toBe("ready");
    test.emitShell(replacement);

    expect(test.controller.snapshot()).toMatchObject({
      failure: { code: "shell-release-mismatch", recovery: "reload" },
      releaseDigest: null,
      state: "failed",
    });
    await expect(test.controller.launch()).rejects.toThrow(/requires the target release/);
  });

  it("uses the canonical retry recovery when the selected offline shell becomes unavailable", async () => {
    const digest = "9".repeat(64);
    const generation = shellGeneration(digest, "1");
    const test = fixture({
      prepareShell: vi.fn(() => Promise.resolve(generation)),
      targetStatus: vi.fn(() =>
        Promise.resolve({
          active: true,
          activeReleaseDigest: digest,
          releaseDigest: digest,
        }),
      ),
    });

    await test.controller.refreshTarget();
    test.emitShellUnavailable(generation);

    expect(test.controller.snapshot()).toMatchObject({
      failure: { code: "shell-unavailable", recovery: "retry" },
      releaseDigest: null,
      state: "failed",
    });
    expect(createInstallerViewModel(test.controller.snapshot()).canInstall).toBe(true);
  });

  it("does not publish stale Ready when selection changes during target refresh", async () => {
    const digest = "9".repeat(64);
    const initial = shellGeneration(digest, "1");
    const replacement = shellGeneration(digest, "3");
    let test!: ReturnType<typeof fixture>;
    test = fixture({
      prepareShell: vi.fn(() => Promise.resolve(initial)),
      targetStatus: vi.fn(async () => {
        test.emitShell(replacement);
        return {
          active: true,
          activeReleaseDigest: digest,
          releaseDigest: digest,
        };
      }),
    });

    await test.controller.refreshTarget();

    expect(test.controller.snapshot()).toMatchObject({
      failure: { code: "shell-release-mismatch", recovery: "reload" },
      releaseDigest: null,
      state: "failed",
    });
  });

  it("fails typed final admission when another client changes selection during launch", async () => {
    const digest = "8".repeat(64);
    const initial = shellGeneration(digest, "1");
    const replacement = shellGeneration(digest, "4");
    let selected = initial;
    let test!: ReturnType<typeof fixture>;
    const admit = vi.fn(async (expected: OfflineShellAdmission) => {
      if (
        selected.generationId !== expected.generationId ||
        selected.releaseDigest !== expected.releaseDigest
      ) {
        throw new OfflineShellServiceError(
          "shell-release-mismatch",
          "selection changed during runtime preflight",
        );
      }
    });
    test = fixture({
      launch: vi.fn(async (_releaseDigest, expected, shellAuthority) => {
        selected = replacement;
        test.emitShell(replacement);
        await admit(expected);
        shellAuthority.markAdmitted();
      }),
      prepareShell: vi.fn(() => Promise.resolve(initial)),
      targetStatus: vi.fn(() =>
        Promise.resolve({
          active: true,
          activeReleaseDigest: digest,
          releaseDigest: digest,
        }),
      ),
    });

    await test.controller.refreshTarget();
    await test.controller.launch();

    expect(admit).toHaveBeenCalledTimes(1);
    expect(test.controller.snapshot()).toMatchObject({
      failure: { code: "shell-release-mismatch", recovery: "reload" },
      releaseDigest: null,
      state: "failed",
    });
  });

  it("revokes same-generation launch authority when the exact controller changes during preflight", async () => {
    const digest = "6".repeat(64);
    const initial = shellGeneration(digest, "1");
    let test!: ReturnType<typeof fixture>;
    test = fixture({
      launch: vi.fn(async (_releaseDigest, _expected, shellAuthority) => {
        expect(shellAuthority.signal.aborted).toBe(false);
        test.emitShellControlFailure(initial);
        expect(shellAuthority.signal.aborted).toBe(true);
        const reason = shellAuthority.signal.reason;
        throw reason instanceof Error ? reason : new Error("authority was not typed");
      }),
      prepareShell: vi.fn(() => Promise.resolve(initial)),
      targetStatus: vi.fn(() =>
        Promise.resolve({
          active: true,
          activeReleaseDigest: digest,
          releaseDigest: digest,
        }),
      ),
    });

    await test.controller.refreshTarget();
    await test.controller.launch();

    expect(test.controller.snapshot()).toMatchObject({
      failure: { code: "shell-release-mismatch", message: "exact controller replaced" },
      releaseDigest: null,
      state: "failed",
    });
  });

  it("keeps the running immutable page admitted when control is lost after final admit", async () => {
    const digest = "5".repeat(64);
    const initial = shellGeneration(digest, "1");
    let test!: ReturnType<typeof fixture>;
    const admit = vi.fn((_expected: OfflineShellAdmission) => Promise.resolve());
    const prepareShell = vi.fn(() => Promise.resolve(initial));
    test = fixture({
      launch: vi.fn(async (_releaseDigest, expected, shellAuthority) => {
        await admit(expected);
        shellAuthority.markAdmitted();
        test.emitShell(null);
      }),
      prepareShell,
      targetStatus: vi.fn(() =>
        Promise.resolve({
          active: true,
          activeReleaseDigest: digest,
          releaseDigest: digest,
        }),
      ),
    });

    await test.controller.refreshTarget();
    await test.controller.launch();

    expect(prepareShell).toHaveBeenCalledTimes(1);
    expect(admit).toHaveBeenCalledOnce();
    expect(test.controller.snapshot().state).toBe("launched");
  });

  it("prepares the selected shell generation before reading the installer target", async () => {
    const digest = "8".repeat(64);
    let shellPrepared = false;
    const test = fixture({
      prepareShell: vi.fn(async () => {
        shellPrepared = true;
        return shellGeneration(digest);
      }),
      targetStatus: vi.fn(() => {
        expect(shellPrepared).toBe(true);
        return Promise.resolve({
          active: true,
          activeReleaseDigest: digest,
          releaseDigest: digest,
        });
      }),
    });

    await test.controller.refreshTarget();
    expect(test.controller.snapshot()).toMatchObject({
      releaseDigest: digest,
      state: "ready",
    });
  });

  it("re-queries the exact active target without repeating full shell verification", async () => {
    const digest = "7".repeat(64);
    let targetReadCount = 0;
    const prepareShell = vi.fn(() => Promise.resolve(shellGeneration(digest)));
    const test = fixture({
      prepareShell,
      targetStatus: vi.fn(() => {
        targetReadCount += 1;
        return Promise.resolve(
          targetReadCount === 1
            ? {
                active: true,
                activeReleaseDigest: digest,
                releaseDigest: digest,
              }
            : {
                active: true,
                activeReleaseDigest: "6".repeat(64),
                releaseDigest: "6".repeat(64),
              },
        );
      }),
    });

    await test.controller.refreshTarget();
    await test.controller.launch();

    expect(prepareShell).toHaveBeenCalledTimes(1);
    expect(targetReadCount).toBe(2);
    expect(test.launch).not.toHaveBeenCalled();
    expect(test.controller.snapshot()).toMatchObject({
      failure: { code: "shell-release-mismatch", recovery: "reload" },
      state: "failed",
    });
  });

  it("fails closed when shell and installed-release identities differ", async () => {
    const test = fixture({
      prepareShell: vi.fn(() => Promise.resolve(shellGeneration("8".repeat(64)))),
      targetStatus: vi.fn(() =>
        Promise.resolve({
          active: true,
          activeReleaseDigest: "9".repeat(64),
          releaseDigest: "9".repeat(64),
        }),
      ),
    });

    await test.controller.refreshTarget();
    expect(test.controller.snapshot()).toMatchObject({
      failure: {
        code: "shell-release-mismatch",
        recovery: "reload",
      },
      releaseDigest: null,
      state: "failed",
    });
    await expect(test.controller.launch()).rejects.toThrow(/requires the target release/);
  });

  it("does not unlock launch when installation completes under a different shell release", async () => {
    const installedDigest = "7".repeat(64);
    const test = fixture({
      install: vi.fn(() =>
        Promise.resolve({
          readyBytes: 100,
          readyResourceCount: 2,
          releaseDigest: installedDigest,
        }),
      ),
      prepareShell: vi.fn(() => Promise.resolve(shellGeneration("6".repeat(64)))),
    });

    await test.controller.installOrResume();
    expect(test.controller.snapshot()).toMatchObject({
      failure: {
        code: "shell-release-mismatch",
        recovery: "reload",
      },
      releaseDigest: null,
      state: "failed",
    });
  });

  it("keeps installation available when the current target is not the active release", async () => {
    const test = fixture();

    await test.controller.refreshTarget();

    expect(test.controller.snapshot()).toMatchObject({
      releaseDigest: null,
      state: "idle",
    });
    expect(createInstallerViewModel(test.controller.snapshot()).canInstall).toBe(true);
  });

  it("requires reload when the loaded shell is incompatible with the current target", async () => {
    const test = fixture({
      targetStatus: vi.fn(() =>
        Promise.reject(
          new InstallerServiceError(
            "shell-incompatible",
            "loaded shell is stale",
            null,
            "target-status",
            "reload",
          ),
        ),
      ),
    });

    await test.controller.refreshTarget();

    expect(test.controller.snapshot()).toMatchObject({
      failure: { code: "shell-incompatible", recovery: "reload" },
      state: "failed",
    });
    const view = createInstallerViewModel(test.controller.snapshot());
    expect(view.canInstall).toBe(false);
    expect(view.canReload).toBe(true);
    expect(view.error).toMatch(/newer Parallax shell/);
  });

  it("retains ready state when cancellation loses the publication commit race", async () => {
    const deferred = deferredInstall();
    let resolveCancel!: (cancelled: boolean) => void;
    const cancelResult = new Promise<boolean>((resolve) => {
      resolveCancel = resolve;
    });
    const test = fixture({
      cancel: vi.fn(() => cancelResult),
      install: vi.fn(() => deferred.promise),
      targetStatus: vi.fn(() =>
        Promise.resolve({
          active: true,
          activeReleaseDigest: "f".repeat(64),
          releaseDigest: "f".repeat(64),
        }),
      ),
    });

    const install = test.controller.installOrResume();
    await Promise.resolve();
    const cancel = test.controller.cancel();
    expect(test.controller.snapshot().state).toBe("cancelling");

    deferred.resolve({
      readyBytes: 100,
      readyResourceCount: 2,
      releaseDigest: "f".repeat(64),
    });
    await install;
    expect(test.controller.snapshot().state).toBe("cancelling");

    resolveCancel(false);
    await cancel;
    expect(test.controller.snapshot().state).toBe("ready");
  });

  it("does not let a late cancellation error clobber a newer install generation", async () => {
    const first = deferredInstall();
    const second = deferredInstall();
    let installAttempt = 0;
    let rejectCancel!: (error: unknown) => void;
    const test = fixture({
      cancel: vi.fn(
        () =>
          new Promise<boolean>((_resolve, reject) => {
            rejectCancel = reject;
          }),
      ),
      install: vi.fn(() => {
        installAttempt += 1;
        return installAttempt === 1 ? first.promise : second.promise;
      }),
    });

    const firstOperation = test.controller.installOrResume();
    await Promise.resolve();
    test.emit({ activeRequestId: 1, state: "waiting-lock" });
    const cancellation = test.controller.cancel();
    test.emit({
      activeRequestId: 1,
      failureCode: "cancelled",
      failureClass: "terminal",
      failureEvidence: "terminal-unclassified",
      failureMessage: "Install request was cancelled",
      failureOperation: "install",
      failureResourceId: null,
      state: "cancelled",
    });
    first.reject(
      new InstallerServiceError("cancelled", "Install request was cancelled", null, "install"),
    );
    await firstOperation;

    const secondOperation = test.controller.installOrResume();
    await Promise.resolve();
    test.emit({ activeRequestId: 2, state: "waiting-lock" });
    rejectCancel(new Error("late cancellation reconciliation failed"));
    await cancellation;
    expect(test.controller.snapshot()).toMatchObject({ failure: null, state: "installing" });

    second.resolve({
      readyBytes: 100,
      readyResourceCount: 2,
      releaseDigest: "a".repeat(64),
    });
    await secondOperation;
  });

  it("preserves a typed target failure when late cancellation must reconcile publication", async () => {
    const deferred = deferredInstall();
    const test = fixture({
      cancel: vi.fn(() => Promise.resolve(false)),
      install: vi.fn(() => deferred.promise),
      targetStatus: vi.fn(() =>
        Promise.reject(
          new InstallerServiceError(
            "shell-incompatible",
            "loaded shell is stale",
            null,
            "target-status",
            "reload",
          ),
        ),
      ),
    });

    const install = test.controller.installOrResume();
    await Promise.resolve();
    const cancel = test.controller.cancel();
    deferred.resolve({
      readyBytes: 100,
      readyResourceCount: 2,
      releaseDigest: "f".repeat(64),
    });
    await Promise.all([install, cancel]);

    expect(test.controller.snapshot()).toMatchObject({
      failure: {
        code: "shell-incompatible",
        message: "loaded shell is stale",
        recovery: "reload",
      },
      state: "failed",
    });
    const view = createInstallerViewModel(test.controller.snapshot());
    expect(view.canInstall).toBe(false);
    expect(view.canReload).toBe(true);
  });

  it("retains a publication failure when late cancellation finds no active target", async () => {
    const deferred = deferredInstall();
    let resolveCancel!: (cancelled: boolean) => void;
    const cancelResult = new Promise<boolean>((resolve) => {
      resolveCancel = resolve;
    });
    const test = fixture({
      cancel: vi.fn(() => cancelResult),
      install: vi.fn(() => deferred.promise),
    });

    const install = test.controller.installOrResume();
    await Promise.resolve();
    const cancel = test.controller.cancel();
    test.emit({
      activeRequestId: 1,
      activeResourceId: null,
      failureCode: "integrity",
      failureClass: "installer-transfer",
      failureEvidence: "transfer-integrity",
      failureMessage: "publication verification failed",
      failureOperation: "install",
      failureResourceId: "district-1",
      state: "failed",
    });
    deferred.reject(
      new InstallerServiceError(
        "integrity",
        "publication verification failed",
        "district-1",
        "install",
      ),
    );
    resolveCancel(false);
    await Promise.all([install, cancel]);

    expect(test.controller.snapshot()).toMatchObject({
      failure: {
        code: "integrity",
        message: "publication verification failed",
        resourceId: "district-1",
      },
      state: "failed",
    });
    expect(test.targetStatus).toHaveBeenCalledOnce();
  });

  it("exposes downloaded, reused, resumed, total, and current-resource progress", async () => {
    const deferred = deferredInstall();
    const test = fixture({
      install: vi.fn(() => deferred.promise),
    });

    const operation = test.controller.installOrResume();
    await Promise.resolve();
    test.emit({
      activeRequestId: 1,
      activeResourceId: "district-1",
      downloadedBytes: 20,
      resourceCount: 4,
      resumedBytes: 10,
      reusedBytes: 30,
      state: "transferring",
      totalBytes: 100,
    });

    expect(test.controller.snapshot()).toMatchObject({
      activeResourceId: "district-1",
      downloadedBytes: 20,
      resourceCount: 4,
      resumedBytes: 10,
      reusedBytes: 30,
      totalBytes: 100,
    });
    expect(createInstallerViewModel(test.controller.snapshot()).progress).toBe(0.6);

    deferred.resolve({
      readyBytes: 100,
      readyResourceCount: 4,
      releaseDigest: "c".repeat(64),
    });
    await operation;
  });

  it("retains both exact release identities when installer and offline shell diverge", async () => {
    const installedRelease = "a".repeat(64);
    const shellRelease = "b".repeat(64);
    const test = fixture({
      install: vi.fn(async () => ({
        readyBytes: 100,
        readyResourceCount: 2,
        releaseDigest: installedRelease,
      })),
      prepareShell: vi.fn(async () => shellGeneration(shellRelease)),
    });

    await test.controller.installOrResume();

    expect(test.controller.snapshot()).toMatchObject({
      failure: {
        code: "shell-release-mismatch",
        message: `Installed release ${installedRelease} does not match selected offline shell ${shellRelease}`,
      },
      state: "failed",
    });
  });

  it.each([
    ["quota", "not enough writable storage"],
    ["integrity", "did not match the release manifest"],
  ] as const)("renders actionable %s failure copy and recovery", async (code, copy) => {
    const test = fixture({
      install: vi.fn(() =>
        Promise.reject(new InstallerServiceError(code, `${code} detail`, "district-1", "install")),
      ),
    });

    await test.controller.installOrResume();

    expect(test.controller.snapshot()).toMatchObject({
      failure: { code, resourceId: "district-1" },
      state: "failed",
    });
    const view = createInstallerViewModel(test.controller.snapshot());
    expect(view.error).toContain(copy);
    expect(view.canInstall).toBe(true);
    expect(view.canRepair).toBe(false);
    expect(view.installLabel).toBe("Retry / resume installation");
  });

  it("re-enters the installer after failure and reaches ready through the resume path", async () => {
    let attempt = 0;
    const test = fixture({
      install: vi.fn(() => {
        attempt += 1;
        return attempt === 1
          ? Promise.reject(
              new InstallerServiceError("transport", "connection lost", "district-1", "install"),
            )
          : Promise.resolve({
              readyBytes: 100,
              readyResourceCount: 2,
              releaseDigest: "e".repeat(64),
            });
      }),
    });

    await test.controller.installOrResume();
    expect(test.controller.snapshot().state).toBe("failed");
    await test.controller.installOrResume();

    expect(test.install).toHaveBeenCalledTimes(2);
    expect(test.requestPersistence).toHaveBeenCalledTimes(2);
    expect(test.controller.snapshot()).toMatchObject({
      releaseDigest: "e".repeat(64),
      state: "ready",
    });
  });

  it("cancels an active operation without allowing its stale completion to unlock launch", async () => {
    const deferred = deferredInstall();
    let resolveCancel!: (cancelled: boolean) => void;
    const test = fixture({
      cancel: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveCancel = resolve;
          }),
      ),
      install: vi.fn(() => deferred.promise),
    });
    const operation = test.controller.installOrResume();
    await Promise.resolve();

    const cancel = test.controller.cancel();
    test.emit({
      activeRequestId: 1,
      failureCode: "cancelled",
      failureClass: "terminal",
      failureEvidence: "terminal-unclassified",
      failureMessage: "Install request was cancelled",
      failureOperation: "install",
      failureResourceId: null,
      state: "cancelled",
    });
    deferred.reject(
      new InstallerServiceError("cancelled", "Install request was cancelled", null, "install"),
    );
    resolveCancel(true);
    await Promise.all([operation, cancel]);

    expect(test.cancel).toHaveBeenCalledOnce();
    expect(test.controller.snapshot()).toMatchObject({
      failure: null,
      releaseDigest: null,
      state: "cancelled",
    });
    expect(createInstallerViewModel(test.controller.snapshot()).error).toBeNull();
    await expect(test.controller.launch()).rejects.toThrow(/requires the target release/);
  });

  it("retries a runtime boot failure without reinstalling or reloading", async () => {
    const launch = vi
      .fn()
      .mockRejectedValueOnce(new Error("render boot failed"))
      .mockResolvedValueOnce(undefined);
    const test = fixture({
      launch,
    });

    await test.controller.installOrResume();
    const admittedRelease = test.controller.snapshot().releaseDigest;
    await test.controller.launch();

    expect(test.controller.snapshot()).toMatchObject({
      failure: { code: "launch", recovery: "retry" },
      releaseDigest: admittedRelease,
      state: "ready",
    });
    const view = createInstallerViewModel(test.controller.snapshot());
    expect(view).toMatchObject({
      canInstall: false,
      canLaunch: true,
      canReload: false,
    });
    expect(view.error).toMatch(/Launch Parallax to try again/);
    await expect(test.controller.installOrResume()).rejects.toThrow(/unavailable/);
    await test.controller.launch();
    expect(launch).toHaveBeenCalledTimes(2);
    expect(test.controller.snapshot()).toMatchObject({ state: "launched" });
    expect(test.reload).not.toHaveBeenCalled();
  });

  it("rejects retry when the offline shell rotates after admission but before boot fails", async () => {
    const digest = "8".repeat(64);
    const initial = shellGeneration(digest, "1");
    const replacement = shellGeneration(digest, "2");
    let test!: ReturnType<typeof fixture>;
    test = fixture({
      launch: vi.fn(async (_releaseDigest, _expected, shellAuthority) => {
        shellAuthority.markAdmitted();
        test.emitShell(replacement);
        throw new Error("render boot failed after admission");
      }),
      prepareShell: vi.fn(() => Promise.resolve(initial)),
      targetStatus: vi.fn(() =>
        Promise.resolve({
          active: true,
          activeReleaseDigest: digest,
          releaseDigest: digest,
        }),
      ),
    });

    await test.controller.refreshTarget();
    await test.controller.launch();

    expect(test.controller.snapshot()).toMatchObject({
      failure: { code: "shell-release-mismatch", recovery: "reload" },
      releaseDigest: null,
      state: "failed",
    });
    expect(createInstallerViewModel(test.controller.snapshot()).canLaunch).toBe(false);
  });

  it("preserves terminal installer-service failures instead of relabeling them persistence", async () => {
    const test = fixture({
      persist: () =>
        Promise.reject(
          new InstallerServiceError(
            "protocol",
            "installer worker terminated",
            null,
            "session",
            "reload",
          ),
        ),
    });

    await test.controller.installOrResume();

    expect(test.controller.snapshot()).toMatchObject({
      failure: { code: "protocol", recovery: "reload" },
      persistence: "failed",
      state: "failed",
    });
    const view = createInstallerViewModel(test.controller.snapshot());
    expect(view.canInstall).toBe(false);
    expect(view.canReload).toBe(true);
    expect(view.error).toMatch(/installer can no longer continue safely/);
  });

  it("scopes cumulative worker counters and plan fields to each retry attempt", async () => {
    const first = deferredInstall();
    const second = deferredInstall();
    let attempt = 0;
    const test = fixture({
      install: vi.fn(() => {
        attempt += 1;
        return attempt === 1 ? first.promise : second.promise;
      }),
    });

    const firstOperation = test.controller.installOrResume();
    await Promise.resolve();
    test.emit({
      activeRequestId: 1,
      completedResourceCount: 1,
      downloadedBytes: 40,
      plannedDownloadBytes: 100,
      resourceCount: 2,
      reusedBytes: 0,
      state: "transferring",
      totalBytes: 100,
      verifiedBytes: 10,
    });
    first.reject(
      new InstallerServiceError("transport", "connection lost", "district-1", "install"),
    );
    await firstOperation;

    const secondOperation = test.controller.installOrResume();
    expect(test.controller.snapshot()).toMatchObject({
      completedResourceCount: 0,
      downloadedBytes: 0,
      plannedDownloadBytes: 0,
      resourceCount: 0,
      resumedBytes: 0,
      reusedBytes: 0,
      totalBytes: 0,
      verifiedBytes: 0,
    });
    await Promise.resolve();
    test.emit({
      activeRequestId: 2,
      completedResourceCount: 1,
      downloadedBytes: 40,
      plannedDownloadBytes: 100,
      resourceCount: 2,
      reusedBytes: 0,
      state: "planning",
      totalBytes: 100,
      verifiedBytes: 10,
    });
    expect(test.controller.snapshot().totalBytes).toBe(0);

    test.emit({
      activeRequestId: 2,
      completedResourceCount: 2,
      downloadedBytes: 50,
      plannedDownloadBytes: 60,
      resourceCount: 2,
      resumedBytes: 40,
      reusedBytes: 0,
      state: "transferring",
      totalBytes: 100,
      verifiedBytes: 50,
    });
    expect(test.controller.snapshot()).toMatchObject({
      completedResourceCount: 1,
      downloadedBytes: 10,
      plannedDownloadBytes: 60,
      resourceCount: 2,
      resumedBytes: 40,
      reusedBytes: 0,
      totalBytes: 100,
      verifiedBytes: 40,
    });
    expect(createInstallerViewModel(test.controller.snapshot()).progress).toBe(0.5);

    second.resolve({
      readyBytes: 100,
      readyResourceCount: 2,
      releaseDigest: "f".repeat(64),
    });
    await secondOperation;
  });
});
