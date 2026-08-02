import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  createInstallerFailureDiagnostic,
  idleInstallerTransferTelemetrySnapshot,
  unavailableInstallStoreTelemetrySnapshot,
} from "@parallax/engine";
import type { Page } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import {
  collectInstallerTrustProductTerminalEvidence,
  createInstallerTrustFaultBrowserDependencies,
  createInstallerTrustProductTerminalFailure,
  InstallerTrustFaultWorkerSelectionError,
  InstallerTrustProductTerminalError,
  type InstallerTrustTransitionQueueState,
  installerTrustProductRecoveryAction,
  installInstallerTrustPersistenceRecorderInPage,
  installInstallerTrustTransitionRecorderInPage,
  parseInstallerTrustTransitionBatch,
  runInstallerTrustTransitionBarrier,
  selectExactInstallerWorker,
  throwInstallerTrustWaitFailures,
  validateInstallerTrustFaultDetailedRangeAuthority,
} from "./installer-trust-faults-browser.js";
import {
  type InstallerTrustFaultAuthority,
  selectInstallerTrustFaultResource,
} from "./installer-trust-faults-result.js";
import { createInstallerTrustFaultTransitionProofRecorder } from "./installer-trust-faults-transition-proof.js";
import type { InstallerTrustFaultTransition } from "./installer-trust-faults-transitions.js";
import type { LocalServerDetailedJournalEntry } from "./server.js";

const DEGRADED_DURABILITY_WARNING =
  "Persistent storage was not granted. Installation can continue, but Chrome may evict the game under storage pressure.";
const terminalReleaseDigest = "a".repeat(64);
const terminalArtifactDigest = "b".repeat(64);
const terminalShellGenerationId = `${terminalArtifactDigest}:${terminalReleaseDigest}`;
const terminalAuthority = Object.freeze({
  artifactDigest: terminalArtifactDigest,
  releaseDigest: terminalReleaseDigest,
});

function estimateClearlyInsufficientAuthority(): InstallerTrustFaultAuthority {
  const resource = {
    bytes: 2432,
    id: "game-specific-world-cell-district-1-surface-15-07",
    kind: "asset-pack",
    scope: "game-specific",
    sha256: "c5dcce140fd0a6b5e2fc5fffa9b20df824d9bdbcee476baec1fe88637a06d4bb",
    source:
      "immutable/district-1-surface-cell-15-07-c5dcce140fd0a6b5e2fc5fffa9b20df824d9bdbcee476baec1fe88637a06d4bb.json",
    target: "opfs",
  } as const;
  const buildBytes = Buffer.from(
    JSON.stringify({
      artifacts: [{ bytes: resource.bytes, path: resource.source, sha256: resource.sha256 }],
      gameContentEntrypoints: [],
      installManifestEntrypoint: { path: "install-manifest.json", schemaVersion: 1 },
      offlineShell: {
        generationSchemaVersion: 1,
        saveSchemaVersion: 1,
        serviceWorkerPath: "service-worker.js",
      },
      schemaVersion: 15,
      workerEntrypoints: [],
    }),
  );
  const installBytes = Buffer.from(
    JSON.stringify({ gameId: "parallax", resources: [resource], schemaVersion: 1 }),
  );
  const artifactDigest = createHash("sha256").update(buildBytes).digest("hex");
  const releaseDigest = createHash("sha256").update(installBytes).digest("hex");
  return {
    artifactDigest,
    browser: {
      executableSha256: "3".repeat(64),
      product: "Chrome/151.0.7922.34",
      revision: "@revision",
      sandboxed: true,
      version: "151.0.7922.34",
    },
    buildManifestBase64url: buildBytes.toString("base64url"),
    buildManifestSha256: artifactDigest,
    environment: {
      gateState: "valid",
      machineId: "dev-01",
      physicalConsole: true,
      profileIsolation: "fresh-disposable-per-cell",
      tier: "showcase",
    },
    installManifestBase64url: installBytes.toString("base64url"),
    installManifestSha256: releaseDigest,
    releaseDigest,
    source: { commit: "4".repeat(40), dirtyTreeDigest: "5".repeat(64) },
  };
}

function terminalEvidence(state: "failed" | "ready") {
  const failed = state === "failed";
  const installStore = {
    ...unavailableInstallStoreTelemetrySnapshot(),
    activeReleaseDigest: failed ? null : terminalReleaseDigest,
    failureMessage: failed ? "Exact store failure" : null,
    finalVerificationBytes: failed ? 0 : 7,
    finalVerificationPhase: failed ? ("idle" as const) : ("complete" as const),
    finalVerificationResourceCount: failed ? 0 : 1,
    finalVerificationTotalBytes: failed ? 0 : 7,
    finalVerificationTotalResourceCount: failed ? 0 : 1,
    state: failed ? ("failed" as const) : ("ready" as const),
  };
  const installerTransfer = {
    ...idleInstallerTransferTelemetrySnapshot(),
    activeReleaseDigest: terminalReleaseDigest,
    completedResourceCount: failed ? 0 : 1,
    failureCode: failed ? ("integrity" as const) : null,
    failureClass: failed ? ("installer-transfer" as const) : null,
    failureEvidence: failed ? ("transfer-integrity" as const) : null,
    failureExpectedReleaseDigest: null,
    failureMessage: failed ? "Exact transfer failure" : null,
    failureOperation: failed ? ("install" as const) : null,
    failureResourceId: failed ? "resource-a" : null,
    failureSource: failed ? ("operation" as const) : null,
    finalVerificationBytes: failed ? 0 : 7,
    finalVerificationPhase: failed ? ("idle" as const) : ("complete" as const),
    finalVerificationResourceCount: failed ? 0 : 1,
    finalVerificationTotalBytes: failed ? 0 : 7,
    finalVerificationTotalResourceCount: failed ? 0 : 1,
    resourceCount: failed ? 0 : 1,
    reusedBytes: failed ? 0 : 7,
    state: failed ? ("failed" as const) : ("ready" as const),
    totalBytes: failed ? 0 : 7,
    verifiedBytes: failed ? 0 : 7,
  };
  const failure = failed
    ? {
        code: "integrity",
        failureClass: "installer-transfer",
        failureEvidence: "transfer-integrity",
        message: "Exact transfer failure",
        operation: "install",
        recovery: "repair",
        resourceId: "resource-a",
      }
    : null;
  return {
    installer: { installStore, installerTransfer },
    panel: {
      failureCode: failed ? "integrity" : null,
      failureClass: failed ? "installer-transfer" : null,
      failureEvidence: failed ? "transfer-integrity" : null,
      failureMessage: failed ? "Exact transfer failure" : null,
      failureOperation: failed ? "install" : null,
      failureRecovery: failed ? "repair" : null,
      failureResourceId: failed ? "resource-a" : null,
      releaseDigest: failed ? null : terminalReleaseDigest,
      shellGenerationId: failed ? null : terminalShellGenerationId,
      state,
      storeState: installStore.state,
      transferState: installerTransfer.state,
    },
    ui: {
      failure,
      releaseDigest: failed ? null : terminalReleaseDigest,
      shellGenerationId: failed ? null : terminalShellGenerationId,
      state,
      storeState: installStore.state,
      transferState: installerTransfer.state,
    },
  };
}

describe("installer trust-fault browser preflight ownership", () => {
  it("selects only the manifest-declared installer worker URL", () => {
    const decoy = { url: () => "http://127.0.0.1/immutable/not-installer-decoy.js" };
    const expected = { url: () => "http://127.0.0.1/immutable/worker-a.js" };
    expect(selectExactInstallerWorker([decoy, expected], expected.url())).toBe(expected);
    expect(() => selectExactInstallerWorker([decoy], expected.url())).toThrow(
      InstallerTrustFaultWorkerSelectionError,
    );
    const duplicate = { url: expected.url };
    expect(() => selectExactInstallerWorker([decoy, expected, duplicate], expected.url())).toThrow(
      InstallerTrustFaultWorkerSelectionError,
    );
    try {
      selectExactInstallerWorker([decoy, expected, duplicate], expected.url());
    } catch (error: unknown) {
      expect(error).toMatchObject({ expectedUrl: expected.url(), matchCount: 2 });
    }
  });

  it("wraps the first build-manifest read in an exact typed operation boundary", async () => {
    const missingRepository = resolve(
      import.meta.dirname,
      "__missing-installer-trust-preflight-repository__",
    );
    const dependencies = await createInstallerTrustFaultBrowserDependencies(missingRepository);

    await expect(dependencies.preflight()).rejects.toMatchObject({
      errors: [
        expect.objectContaining({
          operation: "read-build-manifest",
          stage: "primary",
        }),
      ],
    });
  });

  it("rotates transition and raw-observation windows atomically at clear and phase barriers", async () => {
    await withTransitionRecorder(async ({ emit, state }) => {
      const initial = await state.barrier("clear");
      expect(initial.transitions.map(({ order, phase }) => [order, phase])).toEqual([[1, "setup"]]);
      expect(initial.rawObservations).toHaveLength(1);
      emit({ storeState: "verifying" });
      const setup = await state.barrier("phase", "attempt-1");
      emit({ uiState: "requesting-persistence" });
      const attempt = await state.barrier("clear");
      expect(setup.transitions.map(({ order, phase }) => [order, phase])).toEqual([[2, "setup"]]);
      expect(attempt.transitions.map(({ order, phase }) => [order, phase])).toEqual([
        [3, "attempt-1"],
      ]);
      expect(setup.rawObservations[0]).toMatchObject({ transition: setup.transitions[0] });
      expect(attempt.rawObservations[0]).toMatchObject({
        degradedDurabilityWarning: true,
        transition: attempt.transitions[0],
      });
    });
  });

  it("preserves same-turn publication order and event-time phase while draining captures", async () => {
    await withTransitionRecorder(async ({ emit, state }) => {
      await state.barrier("phase", "attempt-1");
      emit({ storeState: "writing", transferState: "transferring", uiState: "installing" });
      emit({ storeState: "verifying", transferState: "verifying", uiState: "installing" });

      const batch = await state.barrier("phase", "attempt-2");

      expect(
        batch.transitions.map(({ order, phase, storeState, transferState }) => ({
          order,
          phase,
          storeState,
          transferState,
        })),
      ).toEqual([
        {
          order: 2,
          phase: "attempt-1",
          storeState: "writing",
          transferState: "transferring",
        },
        {
          order: 3,
          phase: "attempt-1",
          storeState: "verifying",
          transferState: "verifying",
        },
      ]);
      expect(batch.rawObservations).toHaveLength(batch.transitions.length);
      for (const [index, rawObservation] of batch.rawObservations.entries()) {
        expect(rawObservation).toMatchObject({ transition: batch.transitions[index] });
      }
      expect(state.phase).toBe("attempt-2");
    });
  });

  it("retains a listener capture failure and rejects the next barrier fail closed", async () => {
    await withTransitionRecorder(async ({ emit, failNextCapture, state }) => {
      await state.barrier("clear");
      failNextCapture();
      emit({ uiState: "installing" });

      let rejection: unknown = null;
      try {
        state.barrier("clear");
      } catch (error: unknown) {
        rejection = error;
      }

      expect(rejection).toMatchObject({
        message: "Installer transition capture failed",
        name: "InstallerTrustTransitionCaptureError",
      });
      expect(String(rejection)).not.toContain("private-capture-detail");
    });
  });

  it("rejects malformed transition batches by exact keys, length, and index alignment", () => {
    const transition = transitionForBatch(1);
    const raw = { transition };
    expect(() =>
      parseInstallerTrustTransitionBatch({
        extra: true,
        rawObservations: [raw],
        transitions: [transition],
      }),
    ).toThrow("shape or alignment");
    expect(() =>
      parseInstallerTrustTransitionBatch({
        rawObservations: [],
        transitions: [transition],
      }),
    ).toThrow("shape or alignment");
    expect(() =>
      parseInstallerTrustTransitionBatch({
        rawObservations: [raw],
        transitions: [transitionForBatch(2)],
      }),
    ).toThrow("raw observation is misaligned");
  });

  it("feeds aligned raw observations to the Node recorder and seals final capture", async () => {
    const authority = estimateClearlyInsufficientAuthority();
    const resource = selectInstallerTrustFaultResource(authority, "estimate-clearly-insufficient");
    const recorder = createInstallerTrustFaultTransitionProofRecorder(
      "estimate-clearly-insufficient",
      authority,
      resource.id,
    );
    await withTransitionRecorder(async ({ emit, page, state }) => {
      await expect(
        runInstallerTrustTransitionBarrier(page, recorder, "clear"),
      ).resolves.toHaveLength(1);
      await expect(
        runInstallerTrustTransitionBarrier(page, recorder, "phase", "attempt-1"),
      ).resolves.toEqual([]);
      emit({ uiState: "requesting-persistence" });
      await expect(
        runInstallerTrustTransitionBarrier(page, recorder, "seal"),
      ).resolves.toHaveLength(1);
      const nextOrder = state.nextOrder;
      emit({ transferState: "planning", uiState: "installing" });
      expect(state.nextOrder).toBe(nextOrder);
    });
    expect(recorder.prefix()).toMatchObject({ observationCount: 2 });
  });

  it("marks every phase-final observation when one browser batch spans phases", async () => {
    const setup = transitionForBatch(1);
    const attempt = { ...transitionForBatch(2), phase: "attempt-1" as const };
    const rawObservations = [setup, attempt].map((transition) => ({ transition }));
    const page = {
      evaluate: async () => ({ rawObservations, transitions: [setup, attempt] }),
    } as unknown as Page;
    const boundaries: Array<"barrier" | undefined> = [];
    const recorder = {
      observe: (_input: unknown, boundary?: "barrier") => boundaries.push(boundary),
    } as unknown as ReturnType<typeof createInstallerTrustFaultTransitionProofRecorder>;
    await expect(runInstallerTrustTransitionBarrier(page, recorder, "clear")).resolves.toHaveLength(
      2,
    );
    expect(boundaries).toEqual(["barrier", "barrier"]);
  });
  it("requires exact detailed Content-Range authority for partial, interrupted, and complete responses", () => {
    const base: LocalServerDetailedJournalEntry & { readonly order: number } = {
      bodyBytes: 10,
      cacheControl: "no-cache",
      contentRange: null,
      contentType: "application/octet-stream",
      coep: "require-corp",
      coop: "same-origin",
      etag: '"sha256-authority"',
      ifNoneMatch: null,
      ifRange: null,
      method: "GET",
      nosniff: "nosniff",
      order: 1,
      path: "/immutable/resource.bin",
      range: null,
      status: 200,
    };
    const allowed = [
      base,
      {
        ...base,
        bodyBytes: 6,
        contentRange: "bytes 4-9/10",
        ifRange: base.etag,
        range: "bytes=4-",
        status: 206,
      },
      {
        ...base,
        bodyBytes: 3,
        contentRange: "bytes 0-9/10",
        range: "bytes=0-",
        status: 499,
      },
      {
        ...base,
        bodyBytes: 0,
        contentRange: "bytes */10",
        ifRange: base.etag,
        range: "bytes=10-",
        status: 416,
      },
    ] as const;
    for (const entry of allowed) {
      expect(() => validateInstallerTrustFaultDetailedRangeAuthority(entry)).not.toThrow();
    }

    const forbidden = [
      { ...allowed[1], contentRange: null },
      { ...allowed[1], contentRange: "bytes 3-9/10" },
      { ...allowed[1], contentRange: "bytes 4-8/10" },
      { ...allowed[1], contentRange: "bytes 4-9/11" },
      { ...allowed[2], bodyBytes: 11 },
      { ...allowed[3], contentRange: "bytes */11" },
      { ...base, contentRange: "bytes 0-9/10" },
    ] as const;
    for (const entry of forbidden) {
      expect(() => validateInstallerTrustFaultDetailedRangeAuthority(entry)).toThrow(
        /exact Content-Range authority/u,
      );
    }
  });
});

describe("installer trust-fault unexpected terminal evidence", () => {
  it("retains a typed Repair store boundary from public telemetry through terminal projection", () => {
    const diagnostic = createInstallerFailureDiagnostic(
      "store",
      "installer-store",
      "store-verify-release",
      "Installer Repair store verify-release failed",
      null,
      "repair",
    );
    const raw = terminalEvidence("failed");
    const failure = createInstallerTrustProductTerminalFailure(
      "ready",
      "failed",
      terminalAuthority,
      {
        ...raw,
        installer: {
          ...raw.installer,
          installerTransfer: {
            ...raw.installer.installerTransfer,
            failureCode: diagnostic.code,
            failureClass: diagnostic.failureClass,
            failureEvidence: diagnostic.failureEvidence,
            failureExpectedReleaseDigest: terminalAuthority.releaseDigest,
            failureMessage: diagnostic.message,
            failureOperation: diagnostic.operation,
            failureResourceId: diagnostic.resourceId,
          },
        },
        panel: {
          ...raw.panel,
          failureCode: diagnostic.code,
          failureClass: diagnostic.failureClass,
          failureEvidence: diagnostic.failureEvidence,
          failureMessage: diagnostic.message,
          failureOperation: diagnostic.operation,
          failureRecovery: "retry",
          failureResourceId: diagnostic.resourceId,
        },
        ui: {
          ...raw.ui,
          failure: {
            code: diagnostic.code,
            failureClass: diagnostic.failureClass,
            failureEvidence: diagnostic.failureEvidence,
            message: diagnostic.message,
            operation: diagnostic.operation,
            recovery: "retry",
            resourceId: diagnostic.resourceId,
          },
        },
      },
    );

    expect(failure.projection.transfer).toMatchObject({
      failureCode: "store",
      failureClass: "installer-store",
      failureEvidence: "store-verify-release",
      failureMessage: "Installer Repair store verify-release failed",
      failureOperation: "repair",
      failureResourceId: null,
    });
  });

  it("collects the exact failed panel tuple through the page-evaluate observer path", async () => {
    const raw = terminalEvidence("failed");
    const collected = await withTerminalPanelCollector(raw, async (page) =>
      collectInstallerTrustProductTerminalEvidence(page),
    );

    expect(collected).toEqual(raw);
    expect((collected as typeof raw).panel).toMatchObject({
      failureClass: "installer-transfer",
      failureCode: "integrity",
      failureEvidence: "transfer-integrity",
      failureMessage: "Exact transfer failure",
      failureOperation: "install",
      failureRecovery: "repair",
      failureResourceId: "resource-a",
    });
  });

  it("normalizes absent terminal failure dataset fields to null through the page evaluator", async () => {
    const raw = terminalEvidence("ready");
    const collected = await withTerminalPanelCollector(raw, async (page) =>
      collectInstallerTrustProductTerminalEvidence(page),
    );

    expect((collected as typeof raw).panel).toMatchObject({
      failureClass: null,
      failureCode: null,
      failureEvidence: null,
      failureMessage: null,
      failureOperation: null,
      failureRecovery: null,
      failureResourceId: null,
    });
  });

  it.each([
    ["failureClass", "installer-transfer<script>residual</script>"],
    ["failureEvidence", "transfer-integrity "],
    ["failureMessage", "Exact transfer failure\0residual"],
  ] as const)("preserves and rejects a noncanonical or malicious %s residual", async (field, residual) => {
    const raw = terminalEvidence("failed");
    const collected = await withTerminalPanelCollector(
      {
        ...raw,
        panel: { ...raw.panel, [field]: residual },
      },
      async (page) => collectInstallerTrustProductTerminalEvidence(page),
    );

    expect((collected as typeof raw).panel[field]).toBe(residual);
    expect(() =>
      createInstallerTrustProductTerminalFailure("ready", "failed", terminalAuthority, collected),
    ).toThrow(expect.objectContaining({ name: "InstallerTrustProductTerminalEvidenceError" }));
  });

  it("projects an expected-ready to observed-failed product outcome before throwing", () => {
    const raw = terminalEvidence("failed");
    const failure = createInstallerTrustProductTerminalFailure(
      "ready",
      "failed",
      terminalAuthority,
      raw,
    );

    expect(failure).toBeInstanceOf(InstallerTrustProductTerminalError);
    expect(failure.projection).toMatchObject({
      expected: "ready",
      observed: "failed",
      transfer: {
        failureCode: "integrity",
        failureMessage: "Exact transfer failure",
        failureOperation: "install",
        failureResourceId: "resource-a",
        state: "failed",
      },
      store: {
        failureMessage: "Exact store failure",
        state: "failed",
      },
      ui: {
        action: "repair",
        failureCode: "integrity",
        failureResourceId: "resource-a",
        state: "failed",
      },
    });
    expect(failure.message).toContain("ui=failed/integrity/repair/resource-a");
    expect(failure.message.length).toBeLessThanOrEqual(500);
  });

  it("sanitizes and bounds the retained store cause without weakening transfer authority", () => {
    const raw = terminalEvidence("failed");
    const failure = createInstallerTrustProductTerminalFailure(
      "ready",
      "failed",
      terminalAuthority,
      {
        ...raw,
        installer: {
          ...raw.installer,
          installStore: {
            ...raw.installer.installStore,
            failureMessage:
              "OPFS failed at C:\\private\\profile token=do-not-retain because " +
              "x".repeat(2_000),
          },
        },
      },
    );

    expect(failure.projection.store.failureMessage).not.toMatch(/private|do-not-retain/iu);
    expect(failure.projection.store.failureMessage?.length).toBeLessThanOrEqual(256);
    expect(failure.projection.transfer).toMatchObject({
      failureMessage: "Exact transfer failure",
      failureOperation: "install",
    });
  });

  it("projects an expected-failed to observed-ready product outcome without stale failure data", () => {
    const failure = createInstallerTrustProductTerminalFailure(
      "failed",
      "ready",
      terminalAuthority,
      terminalEvidence("ready"),
    );

    expect(failure.projection).toMatchObject({
      expected: "failed",
      observed: "ready",
      transfer: { failureCode: null, failureResourceId: null, state: "ready" },
      ui: { action: "none", failureCode: null, failureResourceId: null, state: "ready" },
    });
  });

  it.each([
    [
      "missing typed failure",
      () => {
        const raw = terminalEvidence("failed");
        return {
          ...raw,
          panel: { ...raw.panel, failureCode: null },
        };
      },
    ],
    [
      "contradictory typed failure",
      () => {
        const raw = terminalEvidence("failed");
        return {
          ...raw,
          panel: { ...raw.panel, failureResourceId: "resource-b" },
        };
      },
    ],
    [
      "forged matching failed recovery actions",
      () => {
        const raw = terminalEvidence("failed");
        return {
          ...raw,
          panel: { ...raw.panel, failureRecovery: "retry" },
          ui: {
            ...raw.ui,
            failure: { ...raw.ui.failure, recovery: "retry" },
          },
        };
      },
    ],
    [
      "forged matching retryable recovery actions",
      () => {
        const raw = terminalEvidence("failed");
        return {
          ...raw,
          installer: {
            ...raw.installer,
            installerTransfer: {
              ...raw.installer.installerTransfer,
              failureCode: "transport" as const,
            },
          },
          panel: {
            ...raw.panel,
            failureCode: "transport",
            failureRecovery: "repair",
          },
          ui: {
            ...raw.ui,
            failure: {
              ...raw.ui.failure,
              code: "transport",
              recovery: "repair",
            },
          },
        };
      },
    ],
    [
      "forged matching terminal recovery actions",
      () => {
        const raw = terminalEvidence("failed");
        return {
          ...raw,
          installer: {
            ...raw.installer,
            installerTransfer: {
              ...raw.installer.installerTransfer,
              failureCode: "protocol" as const,
            },
          },
          panel: {
            ...raw.panel,
            failureCode: "protocol",
            failureRecovery: "retry",
          },
          ui: {
            ...raw.ui,
            failure: {
              ...raw.ui.failure,
              code: "protocol",
              recovery: "retry",
            },
          },
        };
      },
    ],
    [
      "non-null failed panel identity",
      () => {
        const raw = terminalEvidence("failed");
        return {
          ...raw,
          panel: { ...raw.panel, releaseDigest: terminalReleaseDigest },
          ui: { ...raw.ui, releaseDigest: terminalReleaseDigest },
        };
      },
    ],
    [
      "forged failed diagnostic identity",
      () => {
        const raw = terminalEvidence("failed");
        return {
          ...raw,
          ui: { ...raw.ui, releaseDigest: "c".repeat(64) },
        };
      },
    ],
  ])("rejects %s instead of inventing terminal authority", (_label, mutate) => {
    expect(() =>
      createInstallerTrustProductTerminalFailure("ready", "failed", terminalAuthority, mutate()),
    ).toThrow(expect.objectContaining({ name: "InstallerTrustProductTerminalEvidenceError" }));
  });

  it.each([
    [
      "missing ready panel release identity",
      () => {
        const raw = terminalEvidence("ready");
        return {
          ...raw,
          panel: { ...raw.panel, releaseDigest: null },
        };
      },
    ],
    [
      "forged matching ready shell identities",
      () => {
        const raw = terminalEvidence("ready");
        const shellGenerationId = `${"c".repeat(64)}:${terminalReleaseDigest}`;
        return {
          ...raw,
          panel: { ...raw.panel, shellGenerationId },
          ui: { ...raw.ui, shellGenerationId },
        };
      },
    ],
    [
      "missing ready diagnostic release identity",
      () => {
        const raw = terminalEvidence("ready");
        return {
          ...raw,
          ui: { ...raw.ui, releaseDigest: null },
        };
      },
    ],
    [
      "ready diagnostic failure action",
      () => {
        const raw = terminalEvidence("ready");
        return {
          ...raw,
          panel: {
            ...raw.panel,
            failureCode: "integrity",
            failureRecovery: "repair",
            failureResourceId: "resource-a",
          },
          ui: {
            ...raw.ui,
            failure: {
              code: "integrity",
              message: "Forged ready failure",
              recovery: "repair",
              resourceId: "resource-a",
            },
          },
        };
      },
    ],
  ])("rejects %s in the observed-ready direction", (_label, mutate) => {
    expect(() =>
      createInstallerTrustProductTerminalFailure("failed", "ready", terminalAuthority, mutate()),
    ).toThrow(expect.objectContaining({ name: "InstallerTrustProductTerminalEvidenceError" }));
  });

  it("derives each recovery class from the typed failure code", () => {
    expect(installerTrustProductRecoveryAction("integrity")).toBe("repair");
    expect(installerTrustProductRecoveryAction("transport")).toBe("retry");
    expect(installerTrustProductRecoveryAction("protocol")).toBe("reload");
    expect(installerTrustProductRecoveryAction(null)).toBeNull();
  });

  it("aggregates the product projection before a concurrent persistence observer failure", () => {
    const product = createInstallerTrustProductTerminalFailure(
      "ready",
      "failed",
      terminalAuthority,
      terminalEvidence("failed"),
    );
    const observer = new Error("persistence observer failed");
    const failure = (() => {
      try {
        throwInstallerTrustWaitFailures(product, observer);
      } catch (error: unknown) {
        return error;
      }
      throw new Error("Expected aggregate failure");
    })();
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([product, observer]);
  });
});

describe("installer trust-fault persistence observer", () => {
  it("returns the exact platform promise and does not delay its result on the after-state probe", async () => {
    const platform = deferred<boolean>();
    const probe = deferred<boolean>();
    const platformPersist = vi.fn(() => platform.promise);
    const persisted = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(() => probe.promise);
    await withPersistenceRecorder(
      { persist: platformPersist, persisted },
      async ({ panel, state, storage }) => {
        state.setContext({ attempt: 1, operation: "install", phase: "attempt-1" });
        panel.dataset.persistence = "requesting";
        const returned = storage.persist();
        expect(returned).toBe(platform.promise);
        expect(platformPersist).toHaveBeenCalledTimes(1);

        let productSettled = false;
        const product = returned.then((result) => {
          productSettled = true;
          panel.dataset.persistence = "granted";
          return result;
        });
        platform.resolve(true);
        await expect(product).resolves.toBe(true);
        expect(productSettled).toBe(true);

        let barrierSettled = false;
        const barrier = state.finalize("attempt-1").then(() => {
          barrierSettled = true;
        });
        await Promise.resolve();
        expect(barrierSettled).toBe(false);
        probe.resolve(true);
        await barrier;
        expect(state.evidence.requests[0]).toMatchObject({
          persistedAfter: true,
          result: true,
        });
      },
    );
  });

  it("preserves exact platform rejection and reports it only through the later observer barrier", async () => {
    const platform = deferred<boolean>();
    const rejection = new Error("platform rejection");
    const platformPersist = vi.fn(() => platform.promise);
    await withPersistenceRecorder(
      {
        persist: platformPersist,
        persisted: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
      },
      async ({ panel, state, storage }) => {
        state.setContext({ attempt: 1, operation: "install", phase: "attempt-1" });
        panel.dataset.persistence = "requesting";
        const returned = storage.persist();
        expect(returned).toBe(platform.promise);
        const product = returned.catch((error: unknown) => error);
        platform.reject(rejection);
        expect(await product).toBe(rejection);
        panel.dataset.persistence = "failed";

        await expect(state.finalize("attempt-1")).rejects.toMatchObject({
          message: expect.stringContaining("platform-rejected"),
          name: "InstallerTrustPersistenceObserverError",
        });
        expect(platformPersist).toHaveBeenCalledTimes(1);
      },
    );
  });

  it("does not turn an after-state probe rejection into a successful product rejection", async () => {
    const platform = deferred<boolean>();
    const probeFailure = new Error("probe rejected");
    const persisted = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(probeFailure);
    await withPersistenceRecorder(
      { persist: vi.fn(() => platform.promise), persisted },
      async ({ panel, state, storage }) => {
        state.setContext({ attempt: 1, operation: "install", phase: "attempt-1" });
        panel.dataset.persistence = "requesting";
        const returned = storage.persist();
        platform.resolve(true);
        await expect(returned).resolves.toBe(true);
        panel.dataset.persistence = "granted";

        await expect(state.finalize("attempt-1")).rejects.toMatchObject({
          message: expect.stringContaining("after-probe-rejected"),
          name: "InstallerTrustPersistenceObserverError",
        });
      },
    );
  });

  it("retains concurrent call and settlement order while leaving both promises unchanged", async () => {
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const platformPersist = vi
      .fn<() => Promise<boolean>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    await withPersistenceRecorder(
      {
        persist: platformPersist,
        persisted: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
      },
      async ({ panel, state, storage }) => {
        state.setContext({ attempt: 1, operation: "install", phase: "attempt-1" });
        panel.dataset.persistence = "requesting";
        const returnedFirst = storage.persist();
        const returnedSecond = storage.persist();
        expect(returnedFirst).toBe(first.promise);
        expect(returnedSecond).toBe(second.promise);
        second.resolve(false);
        first.resolve(false);
        await Promise.all([returnedFirst, returnedSecond]);
        panel.dataset.persistence = "denied";
        await expect(state.finalize("attempt-1")).rejects.toMatchObject({
          message: expect.stringContaining("expected=1; actual=2; orders=1,2"),
          name: "InstallerTrustPersistenceObserverError",
        });
        expect(state.diagnostics).toEqual([
          { callOrder: 1, phase: "attempt-1", settleOrder: 2, state: "resolved" },
          { callOrder: 2, phase: "attempt-1", settleOrder: 1, state: "resolved" },
        ]);
        expect(platformPersist).toHaveBeenCalledTimes(2);
      },
    );
  });

  it("bounds a late observer and permits a later truthful barrier after settlement", async () => {
    const platform = deferred<boolean>();
    await withPersistenceRecorder(
      {
        observerTimeoutMs: 10,
        persist: vi.fn(() => platform.promise),
        persisted: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
      },
      async ({ panel, state, storage }) => {
        state.setContext({ attempt: 1, operation: "install", phase: "attempt-1" });
        panel.dataset.persistence = "requesting";
        const returned = storage.persist();
        await expect(state.finalize("attempt-1")).rejects.toMatchObject({
          message: expect.stringContaining("timeout; phase=attempt-1; calls=1; pending=1"),
          name: "InstallerTrustPersistenceObserverError",
        });
        platform.resolve(false);
        await expect(returned).resolves.toBe(false);
        panel.dataset.persistence = "denied";
        panel.warning.hidden = false;
        panel.warning.textContent = DEGRADED_DURABILITY_WARNING;
        await state.finalize("attempt-1");
        expect(state.evidence.requests[0]?.result).toBe(false);
      },
    );
  });

  it("suppresses the platform call only for the exact injected denial", async () => {
    const platformPersist = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    await withPersistenceRecorder(
      {
        persist: platformPersist,
        persisted: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
      },
      async ({ panel, state, storage }) => {
        state.configureDenial({
          nonce: "n".repeat(32),
          operation: "install",
          releaseDigest: "a".repeat(64),
          resourceId: "resource",
        });
        state.setContext({ attempt: 1, operation: "install", phase: "attempt-1" });
        panel.dataset.persistence = "requesting";
        await expect(storage.persist()).resolves.toBe(false);
        panel.dataset.persistence = "denied";
        panel.warning.hidden = false;
        panel.warning.textContent = DEGRADED_DURABILITY_WARNING;
        await state.finalize("attempt-1");

        expect(platformPersist).not.toHaveBeenCalled();
        expect(state.evidence.requests[0]).toMatchObject({
          persistedAfter: false,
          result: false,
          terminalUiState: "denied",
          warning: "degraded-durability",
        });
        expect(state.faultEvents).toHaveLength(1);
      },
    );
  });
});

interface PersistenceRecorderTestState {
  readonly diagnostics: readonly Readonly<{
    readonly callOrder: number;
    readonly phase: "attempt-1" | "attempt-2" | "seed" | null;
    readonly settleOrder: number | null;
    readonly state: string;
  }>[];
  readonly evidence: Readonly<{
    readonly initialPersisted: boolean;
    readonly requests: readonly Readonly<{
      readonly persistedAfter: boolean;
      readonly result: boolean;
      readonly terminalUiState: string;
      readonly warning: string | null;
    }>[];
  }>;
  readonly faultEvents: readonly unknown[];
  clear(): void;
  configureDenial(input: {
    readonly nonce: string;
    readonly operation: "install" | "repair";
    readonly releaseDigest: string;
    readonly resourceId: string;
  }): void;
  finalize(phase: "attempt-1" | "attempt-2" | "seed"): Promise<void>;
  setContext(input: {
    readonly attempt: 1 | 2;
    readonly operation: "install" | "repair";
    readonly phase: "attempt-1" | "attempt-2" | "seed";
  }): void;
}

async function withPersistenceRecorder(
  options: Readonly<{
    observerTimeoutMs?: number;
    persist: () => Promise<boolean>;
    persisted: () => Promise<boolean>;
  }>,
  run: (context: {
    readonly panel: {
      readonly dataset: Record<string, string>;
      readonly warning: { hidden: boolean; textContent: string };
    };
    readonly state: PersistenceRecorderTestState;
    readonly storage: { persist: () => Promise<boolean>; persisted: () => Promise<boolean> };
  }) => Promise<void>,
): Promise<void> {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalElement = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
  const scope = globalThis as unknown as {
    __parallaxTrustPersistenceV1?: PersistenceRecorderTestState;
  };
  const originalState = scope.__parallaxTrustPersistenceV1;
  class FakeHtmlElement {
    readonly dataset: Record<string, string> = {};
    hidden = true;
    textContent = "";
  }
  const shell = new FakeHtmlElement();
  shell.dataset.persistence = "not-requested";
  const warning = new FakeHtmlElement();
  const storage = {
    persist: options.persist,
    persisted: options.persisted,
  };
  try {
    Object.defineProperty(globalThis, "HTMLElement", {
      configurable: true,
      value: FakeHtmlElement,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        querySelector: (selector: string) =>
          selector === "#installer-shell"
            ? shell
            : selector === "#installer-warning"
              ? warning
              : null,
      },
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { storage },
    });
    await installInstallerTrustPersistenceRecorderInPage({
      observerTimeoutMs: options.observerTimeoutMs ?? 100,
      warningText: DEGRADED_DURABILITY_WARNING,
    });
    const state = scope.__parallaxTrustPersistenceV1;
    if (state === undefined) throw new Error("Persistence recorder test state is absent");
    await run({
      panel: { dataset: shell.dataset, warning },
      state,
      storage,
    });
  } finally {
    scope.__parallaxTrustPersistenceV1?.clear();
    if (originalState === undefined) {
      delete scope.__parallaxTrustPersistenceV1;
    } else {
      scope.__parallaxTrustPersistenceV1 = originalState;
    }
    restoreGlobalProperty("navigator", originalNavigator);
    restoreGlobalProperty("document", originalDocument);
    restoreGlobalProperty("HTMLElement", originalElement);
  }
}

function restoreGlobalProperty(
  key: "document" | "HTMLElement" | "navigator",
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    delete (globalThis as unknown as Record<string, unknown>)[key];
  } else {
    Object.defineProperty(globalThis, key, descriptor);
  }
}

async function withTerminalPanelCollector<T>(
  raw: ReturnType<typeof terminalEvidence>,
  run: (page: Page) => Promise<T>,
): Promise<T> {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalElement = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
  const scope = globalThis as unknown as {
    __parallaxInstallerDiagnosticsV1?: () => {
      readonly installer: unknown;
      readonly ui: unknown;
    };
  };
  const originalDiagnostics = scope.__parallaxInstallerDiagnosticsV1;
  class FakeHtmlElement {
    public readonly dataset: Record<string, string>;

    public constructor(dataset: Record<string, string>) {
      this.dataset = dataset;
    }
  }
  const dataset = Object.fromEntries(
    Object.entries(raw.panel)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, value]) => [key, value]),
  );
  const panel = new FakeHtmlElement(dataset);
  const page = {
    evaluate: async (collector: () => unknown) => collector(),
  } as unknown as Page;
  try {
    Object.defineProperty(globalThis, "HTMLElement", {
      configurable: true,
      value: FakeHtmlElement,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        querySelector: (selector: string) => (selector === "#installer-shell" ? panel : null),
      },
    });
    scope.__parallaxInstallerDiagnosticsV1 = () => ({
      installer: raw.installer,
      ui: raw.ui,
    });
    return await run(page);
  } finally {
    if (originalDiagnostics === undefined) {
      delete scope.__parallaxInstallerDiagnosticsV1;
    } else {
      scope.__parallaxInstallerDiagnosticsV1 = originalDiagnostics;
    }
    restoreGlobalProperty("document", originalDocument);
    restoreGlobalProperty("HTMLElement", originalElement);
  }
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: (value: T) => void = () => {};
  let rejectPromise: (error: unknown) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

interface TransitionRecorderTestContext {
  readonly emit: (
    transition: Partial<Omit<InstallerTrustFaultTransition, "order" | "phase">>,
  ) => void;
  readonly failNextCapture: () => void;
  readonly page: Page;
  readonly state: InstallerTrustTransitionQueueState;
}

async function withTransitionRecorder(
  run: (context: TransitionRecorderTestContext) => Promise<void>,
): Promise<void> {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalElement = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
  const scope = globalThis as unknown as {
    __parallaxInstallerDiagnosticsV1?: () => { installer: unknown };
    __parallaxTrustTransitions?: InstallerTrustTransitionQueueState;
  };
  const originalDiagnostics = scope.__parallaxInstallerDiagnosticsV1;
  const originalTransitions = scope.__parallaxTrustTransitions;
  class FakeHtmlElement extends EventTarget {
    readonly dataset: Record<string, string> = {};
    hidden = true;
    textContent: string | null = "";
  }
  const panel = new FakeHtmlElement();
  const warning = new FakeHtmlElement();
  Object.assign(panel.dataset, {
    failureCode: "",
    failureResourceId: "",
    persistence: "not-requested",
    releaseDigest: "",
    shellGenerationId: "",
    state: "idle",
    storeState: "idle",
    transferState: "idle",
  });
  let telemetry = transitionTelemetry(transitionForBatch(1));
  let failNextCapture = false;
  const page = {
    evaluate: async <T, R>(collector: (input: T) => R, input: T): Promise<R> => collector(input),
  } as unknown as Page;
  try {
    Object.defineProperty(globalThis, "HTMLElement", {
      configurable: true,
      value: FakeHtmlElement,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        querySelector: (selector: string) =>
          selector === "#installer-shell"
            ? panel
            : selector === "#installer-warning"
              ? warning
              : null,
      },
    });
    scope.__parallaxInstallerDiagnosticsV1 = () => {
      if (failNextCapture) {
        failNextCapture = false;
        throw new Error("private-capture-detail");
      }
      return { installer: telemetry };
    };
    await installInstallerTrustTransitionRecorderInPage({ expectedRepairAuthority: null });
    const state = scope.__parallaxTrustTransitions;
    if (state === undefined) throw new Error("Transition recorder test state is absent");
    await run({
      emit: (partial) => {
        const transition: InstallerTrustFaultTransition = {
          activeReleaseDigest: partial.activeReleaseDigest ?? null,
          failureCode: partial.failureCode ?? null,
          failureResourceId: partial.failureResourceId ?? null,
          order: state.nextOrder,
          phase: state.phase,
          releaseDigest: partial.releaseDigest ?? null,
          shellGenerationId: partial.shellGenerationId ?? null,
          storeState: partial.storeState ?? "idle",
          transferState: partial.transferState ?? "idle",
          uiState: partial.uiState ?? "idle",
        };
        Object.assign(panel.dataset, {
          failureCode: transition.failureCode ?? "",
          failureResourceId: transition.failureResourceId ?? "",
          persistence: transition.phase === "setup" ? "not-requested" : "denied",
          releaseDigest: transition.releaseDigest ?? "",
          shellGenerationId: transition.shellGenerationId ?? "",
          state: transition.uiState,
          storeState: transition.storeState,
          transferState: transition.transferState,
        });
        telemetry = transitionTelemetry(transition);
        panel.dispatchEvent(new Event("parallax-installer-state"));
        const showWarning = transition.phase !== "setup";
        warning.hidden = !showWarning;
        warning.textContent = showWarning ? DEGRADED_DURABILITY_WARNING : "";
      },
      failNextCapture: () => {
        failNextCapture = true;
      },
      page,
      state,
    });
  } finally {
    if (originalDiagnostics === undefined) delete scope.__parallaxInstallerDiagnosticsV1;
    else scope.__parallaxInstallerDiagnosticsV1 = originalDiagnostics;
    if (originalTransitions === undefined) delete scope.__parallaxTrustTransitions;
    else scope.__parallaxTrustTransitions = originalTransitions;
    restoreGlobalProperty("document", originalDocument);
    restoreGlobalProperty("HTMLElement", originalElement);
  }
}

function transitionForBatch(order: number): InstallerTrustFaultTransition {
  return {
    activeReleaseDigest: null,
    failureCode: null,
    failureResourceId: null,
    order,
    phase: "setup",
    releaseDigest: null,
    shellGenerationId: null,
    storeState: "idle",
    transferState: "idle",
    uiState: "idle",
  };
}

function transitionTelemetry(transition: InstallerTrustFaultTransition) {
  return {
    installStore: {
      ...unavailableInstallStoreTelemetrySnapshot(),
      activeReleaseDigest: transition.activeReleaseDigest,
      state: transition.storeState,
    },
    installerTransfer: {
      ...idleInstallerTransferTelemetrySnapshot(),
      activeReleaseDigest: transition.activeReleaseDigest,
      failureCode: transition.failureCode,
      failureExpectedReleaseDigest: null,
      failureResourceId: transition.failureResourceId,
      failureSource: transition.failureCode === null ? null : "operation",
      state: transition.transferState,
    },
  };
}
