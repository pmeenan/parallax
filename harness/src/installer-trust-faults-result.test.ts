import { createHash } from "node:crypto";
import {
  INSTALL_RESOURCE_PLACEMENTS,
  idleInstallerTransferTelemetrySnapshot,
  unavailableInstallStoreTelemetrySnapshot,
} from "@parallax/engine";
import { describe, expect, it } from "vitest";
import {
  INSTALLER_TRUST_FAULT_CELL_IDS,
  INSTALLER_TRUST_FAULTS_PREVIOUS_SCHEMA_VERSION,
  INSTALLER_TRUST_FAULTS_PROOF_SCHEMA_VERSION,
  INSTALLER_TRUST_FAULTS_SCHEMA_VERSION,
  type InstallerTrustFaultAuthority,
  type InstallerTrustFaultCell,
  type InstallerTrustFaultCellId,
  type InstallerTrustFaultCellV2,
  type InstallerTrustFaultCellV3,
  type InstallerTrustFaultCellV5,
  type InstallerTrustFaultsResult,
  type InstallerTrustFaultsResultV5,
  parseInstallerTrustFaultAuthority,
  projectInstallerTrustFaultTerminalPublication,
  validateInstallerTrustFaultResourceResponse,
  validateInstallerTrustFaultsResult,
} from "./installer-trust-faults-result.js";
import { createInstallerTrustFaultTransitionProofRecorder } from "./installer-trust-faults-transition-proof.js";
import {
  canonicalizeInstallerTrustFaultTransitions,
  type InstallerTrustFaultStoreState,
  type InstallerTrustFaultTransferState,
  type InstallerTrustFaultTransition,
  type InstallerTrustFaultUiState,
  projectInstallerTrustFaultAttemptMilestones,
} from "./installer-trust-faults-transitions.js";

const resourceDigest = "a".repeat(64);
const largeResourceDigest = "c".repeat(64);
const shellResourceDigest = "d".repeat(64);
const resourceId = "resource-a";
const largeResourceId = "resource-large";
const shellResourceId = "app-shell-module";
const timestamp = "2026-07-30T12:00:00.000Z";
const checkpointBytes = 8 * 1024 * 1024;
const installManifestBytes = Buffer.from(
  JSON.stringify({
    gameId: "parallax",
    resources: [
      {
        bytes: 10,
        id: resourceId,
        kind: "asset-pack",
        scope: "game-specific",
        sha256: resourceDigest,
        source: `immutable/${resourceId}.bin`,
        target: "opfs",
      },
      {
        bytes: checkpointBytes + 6,
        id: largeResourceId,
        kind: "asset-pack",
        scope: "game-specific",
        sha256: largeResourceDigest,
        source: `immutable/${largeResourceId}.bin`,
        target: "opfs",
      },
      {
        bytes: 10,
        id: shellResourceId,
        kind: "module",
        scope: "app-shell",
        sha256: shellResourceDigest,
        source: `immutable/${shellResourceId}.bin`,
        target: "shell",
      },
    ],
    schemaVersion: 1,
  }),
);
const digest = createHash("sha256").update(installManifestBytes).digest("hex");
const buildManifestBytes = Buffer.from(
  JSON.stringify({
    artifacts: [
      {
        bytes: 10,
        path: `immutable/${resourceId}.bin`,
        sha256: resourceDigest,
      },
      {
        bytes: checkpointBytes + 6,
        path: `immutable/${largeResourceId}.bin`,
        sha256: largeResourceDigest,
      },
      {
        bytes: 10,
        path: `immutable/${shellResourceId}.bin`,
        sha256: shellResourceDigest,
      },
    ],
    gameContentEntrypoints: [],
    installManifestEntrypoint: { path: "install-manifest.json", schemaVersion: 1 },
    offlineShell: {
      generationSchemaVersion: 1,
      saveSchemaVersion: 1,
      serviceWorkerPath: "service-worker.js",
    },
    schemaVersion: 16,
    workerEntrypoints: [],
  }),
);
const buildDigest = createHash("sha256").update(buildManifestBytes).digest("hex");

function authorityForManifests(build: unknown, install: unknown): InstallerTrustFaultAuthority {
  const buildBytes = Buffer.from(JSON.stringify(build));
  const installBytes = Buffer.from(JSON.stringify(install));
  const artifactDigest = createHash("sha256").update(buildBytes).digest("hex");
  const releaseDigest = createHash("sha256").update(installBytes).digest("hex");
  return {
    artifactDigest,
    browser: {
      executableSha256: digest,
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
    source: { commit: "b".repeat(40), dirtyTreeDigest: digest },
  };
}

describe("installer-trust-faults@1 independent result validator", () => {
  it("separates current v9 snapshots from explicitly retained v6 snapshots", () => {
    const current = currentFixture();
    expect(() =>
      validateInstallerTrustFaultsResult(current, current.authority, "active-raw"),
    ).not.toThrow();

    const retained = structuredClone(current);
    for (const cell of retained.cells) {
      for (const snapshot of cell.snapshots) {
        const transfer = snapshot.installerTransfer as unknown as Record<string, unknown>;
        const requiredPeakBytes = transfer.quotaRequiredPeakBytes as number;
        if (requiredPeakBytes !== 0) {
          const totalBytes = transfer.totalBytes as number;
          const largestUnverifiedResourceBytes =
            transfer.reusedBytes === totalBytes ? 0 : totalBytes;
          transfer.quotaRequiredPeakBytes =
            (transfer.plannedDownloadBytes as number) +
            largestUnverifiedResourceBytes +
            16 * 1024 * 1024;
        }
        delete transfer.failureExpectedReleaseDigest;
        delete transfer.failureSource;
        transfer.schemaVersion = 6;
      }
    }
    expect(() =>
      validateInstallerTrustFaultsResult(retained, retained.authority, "active-raw"),
    ).toThrow(/unsupported or missing keys/u);
    expect(() =>
      validateInstallerTrustFaultsResult(retained, retained.authority, "active-raw", 6),
    ).not.toThrow();

    const unknown = structuredClone(retained);
    (
      unknown.cells[0]?.snapshots[0]?.installerTransfer as unknown as Record<string, unknown>
    ).schemaVersion = 5;
    expect(() =>
      validateInstallerTrustFaultsResult(unknown, unknown.authority, "active-raw", 6),
    ).toThrow(/unsupported schema\/state/u);
  });

  it("accepts every authoritative retained-manifest placement tuple and rejects a near miss", () => {
    const install = JSON.parse(installManifestBytes.toString("utf8")) as {
      resources: Array<Record<string, unknown>>;
    };
    const build = JSON.parse(buildManifestBytes.toString("utf8")) as {
      artifacts: Array<Record<string, unknown>>;
    };
    INSTALL_RESOURCE_PLACEMENTS.forEach((placement, index) => {
      const [scope, target, kind] = placement.split("/");
      const id = `placement-${String(index).padStart(2, "0")}`;
      const sha256 = (index + 1).toString(16).padStart(64, "0");
      const source = `immutable/${id}.bin`;
      install.resources.push({ bytes: 1, id, kind, scope, sha256, source, target });
      build.artifacts.push({ bytes: 1, path: source, sha256 });
    });
    install.resources.sort((left, right) => String(left.id).localeCompare(String(right.id)));
    build.artifacts.sort((left, right) => String(left.path).localeCompare(String(right.path)));
    const authority = authorityForManifests(build, install);
    expect(() => parseInstallerTrustFaultAuthority(authority)).not.toThrow();

    const invalidInstall = structuredClone(install);
    const invalid = invalidInstall.resources.find((resource) => resource.id === "placement-03");
    if (invalid === undefined) throw new Error("Placement fixture is absent");
    invalid.scope = "app-shell";
    expect(() =>
      parseInstallerTrustFaultAuthority(authorityForManifests(build, invalidInstall)),
    ).toThrow(/retained install resource is invalid/u);
  });

  it("accepts schema-v4 bounded witnesses with operation persistence evidence", () => {
    const legacy = fixture();
    const cells = legacy.cells.map((legacyCell) => currentCell(legacyCell, legacy.authority));
    const result = {
      ...legacy,
      cells,
      schemaVersion: INSTALLER_TRUST_FAULTS_SCHEMA_VERSION,
    };

    expect(() => validateInstallerTrustFaultsResult(result, result.authority)).not.toThrow();
  });

  it("pins the shared current estimate-insufficient proof path and idle-store terminal", () => {
    const result = currentFixture();
    const cell = result.cells.find((candidate) => candidate.id === "estimate-clearly-insufficient");
    if (cell === undefined) throw new Error("Estimate-insufficient fixture is absent");
    const phase = cell.transitions.phases.find((candidate) => candidate.phase === "attempt-1");
    if (phase === undefined) throw new Error("Estimate-insufficient attempt proof is absent");
    const terminal = cell.transitions.states.find(
      (state) => state.id === cell.transitions.finalStateId,
    );
    const terminalEdge = cell.transitions.edges.find(
      (edge) =>
        edge.toStateId === cell.transitions.finalStateId &&
        edge.lastOrder === cell.transitions.lastOrder,
    );
    const predecessor = cell.transitions.states.find(
      (state) => state.id === terminalEdge?.fromStateId,
    );

    expect(cell.fault.events).toMatchObject([{ operation: "install" }]);
    expect(cell.attempts).toMatchObject([
      {
        index: 1,
        transitions: ["idle", "waiting-lock", "planning", "probing-quota", "failed"],
      },
    ]);
    expect(phase.attemptMilestones).toEqual([
      "idle",
      "waiting-lock",
      "planning",
      "probing-quota",
      "failed",
    ]);
    expect(predecessor).toMatchObject({
      activeReleaseDigest: null,
      failureCode: null,
      failureResourceId: null,
      phase: "attempt-1",
      releaseDigest: null,
      shellGenerationId: null,
      storeState: "idle",
      transferState: "probing-quota",
      uiState: "installing",
    });
    expect(terminal).toMatchObject({
      activeReleaseDigest: null,
      failureCode: "quota",
      failureResourceId: null,
      phase: "attempt-1",
      releaseDigest: null,
      shellGenerationId: null,
      storeState: "idle",
      transferState: "failed",
      uiState: "failed",
    });
  });

  it("uses active raw proof semantics only when the schema-v12 caller opts in", () => {
    const legacy = fixture();
    const legacyCell = legacy.cells.find((cell) => cell.id === "quota-probe-exceeded");
    if (legacyCell === undefined) throw new Error("Quota-probe fixture is absent");
    const transitions = proofTransitions(legacyCell).map((transition) =>
      transition.transferState === "failed"
        ? { ...transition, storeState: "idle" as const }
        : transition,
    );
    const recorder = createInstallerTrustFaultTransitionProofRecorder(
      legacyCell.id,
      legacy.authority,
      legacyCell.fault.resourceId,
    );
    for (const transition of transitions) {
      recorder.observe(
        {
          degradedDurabilityWarning: transition.phase !== "setup",
          persistence: transition.phase === "setup" ? "not-requested" : "denied",
          telemetry: {
            installStore: {
              activeReleaseDigest: transition.activeReleaseDigest,
              state: transition.storeState,
            },
            installerTransfer: {
              activeReleaseDigest: transition.activeReleaseDigest,
              failureCode: transition.failureCode,
              failureClass: transition.failureCode === "quota" ? "quota" : null,
              failureEvidence: transition.failureCode === "quota" ? "quota-exceeded" : null,
              failureExpectedReleaseDigest: null,
              failureMessage:
                transition.failureCode === "quota" ? "Installer storage quota was exceeded" : null,
              failureOperation: transition.failureCode === "quota" ? "install" : null,
              failureResourceId: transition.failureResourceId,
              failureSource: transition.failureCode === null ? null : "operation",
              state: transition.transferState,
            },
          },
          transition,
        },
        transitions.at(-1)?.order === transition.order ||
          transitions[transition.order]?.phase !== transition.phase
          ? "barrier"
          : undefined,
      );
    }
    const proof = recorder.finish();
    const result = currentFixture();
    const cells = result.cells.map((cell) => {
      if (cell.id !== legacyCell.id) return cell;
      return {
        ...cell,
        snapshots: cell.snapshots.map((snapshot, index) =>
          index === cell.snapshots.length - 1
            ? {
                ...snapshot,
                installStore: {
                  ...snapshot.installStore,
                  failureMessage: null,
                  state: "idle" as const,
                },
              }
            : snapshot,
        ),
        transitions: proof,
      };
    });
    const active = { ...result, cells };

    expect(() =>
      validateInstallerTrustFaultsResult(active, active.authority, "active-raw"),
    ).not.toThrow();
    const downgraded = {
      ...active,
      cells: active.cells.map((cell) => {
        const proof = cell.transitions as unknown as Record<string, unknown>;
        const {
          barrierWitnesses: _barrierWitnesses,
          barrierWitnessesSha256: _barrierWitnessesSha256,
          ...withoutBarrierWitnesses
        } = proof;
        return { ...cell, transitions: { ...withoutBarrierWitnesses, schemaVersion: 2 } };
      }),
    };
    expect(() =>
      validateInstallerTrustFaultsResult(downgraded, downgraded.authority, "active-raw"),
    ).toThrow(/transition proof fields/u);
    expect(() => validateInstallerTrustFaultsResult(active, active.authority)).toThrow(
      /contradictory transfer failure/u,
    );
    expect(() => validateInstallerTrustFaultsResult(result, result.authority)).not.toThrow();
  });

  it.each([
    1, 2,
  ])("accepts %i bounded estimate-insufficient terminal repeat(s) through result validation", (repeatCount) => {
    const legacy = fixture();
    const legacyCell = legacy.cells.find(
      (candidate) => candidate.id === "estimate-clearly-insufficient",
    );
    if (legacyCell === undefined) throw new Error("Estimate-insufficient fixture is absent");
    const raw = proofTransitions(legacyCell);
    const terminal = raw.at(-1);
    if (terminal === undefined) throw new Error("Estimate-insufficient terminal is absent");
    const recorder = createInstallerTrustFaultTransitionProofRecorder(
      legacyCell.id,
      legacy.authority,
      legacyCell.fault.resourceId,
    );
    for (const transition of raw) recorder.observe(transition);
    for (let index = 0; index < repeatCount; index += 1) {
      recorder.observe({ ...terminal, order: raw.length + index + 1 });
    }
    const result = currentFixture();
    const cells = result.cells.map((cell) =>
      cell.id === legacyCell.id ? { ...cell, transitions: recorder.finish() } : cell,
    );

    expect(() =>
      validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
    ).not.toThrow();
  });

  it("projects terminal publication from the exact operation and outcome contract", () => {
    expect(projectInstallerTrustFaultTerminalPublication("repair", "passed", 1)).toEqual({
      publicationOccurred: false,
      terminalPublicationCount: 1,
    });
    expect(projectInstallerTrustFaultTerminalPublication("install", "passed", 0)).toEqual({
      publicationOccurred: true,
      terminalPublicationCount: 1,
    });
    expect(projectInstallerTrustFaultTerminalPublication("repair", "failed", 1)).toEqual({
      publicationOccurred: false,
      terminalPublicationCount: 1,
    });
    expect(projectInstallerTrustFaultTerminalPublication("install", "failed", 0)).toEqual({
      publicationOccurred: false,
      terminalPublicationCount: 0,
    });
  });

  it("accepts both successful Repair cells without republishing and every successful Install with one publication", () => {
    const result = currentFixture();
    expect(() => validateInstallerTrustFaultsResult(result, result.authority)).not.toThrow();
    const projection = Object.fromEntries(
      result.cells.map((cell) => [
        cell.id,
        {
          baseline: cell.postValidation.operationInitialPublicationCount,
          occurred: cell.postValidation.publicationOccurred,
          operation: cell.fault.events[0]?.operation,
          outcome: cell.attempts.at(-1)?.outcome,
          terminal: cell.postValidation.terminalPublicationCount,
        },
      ]),
    );
    expect(projection).toMatchObject({
      "final-verification-corruption": {
        baseline: 1,
        occurred: false,
        operation: "repair",
        outcome: "passed",
        terminal: 1,
      },
      "reused-object-corruption": {
        baseline: 1,
        occurred: false,
        operation: "repair",
        outcome: "passed",
        terminal: 1,
      },
    });
    for (const id of [
      "estimate-incomplete-probe-success",
      "mid-append-quota-resume",
      "persistence-denied",
    ] as const) {
      expect(projection[id]).toMatchObject({
        baseline: 0,
        occurred: true,
        operation: "install",
        outcome: "passed",
        terminal: 1,
      });
    }
    for (const id of [
      "estimate-clearly-insufficient",
      "quota-probe-exceeded",
      "repeated-server-corruption",
    ] as const) {
      const baseline = id === "repeated-server-corruption" ? 1 : 0;
      expect(projection[id]).toMatchObject({
        baseline,
        occurred: false,
        outcome: "failed",
        terminal: baseline,
      });
    }
  });

  it.each([
    {
      id: "reused-object-corruption",
      mutate: (cell: InstallerTrustFaultCellV5) => ({
        ...cell,
        postValidation: { ...cell.postValidation, publicationOccurred: true },
      }),
      name: "Repair publication flag",
    },
    {
      id: "final-verification-corruption",
      mutate: (cell: InstallerTrustFaultCellV5) => ({
        ...cell,
        postValidation: { ...cell.postValidation, terminalPublicationCount: 2 },
      }),
      name: "Repair publication count",
    },
    {
      id: "estimate-incomplete-probe-success",
      mutate: (cell: InstallerTrustFaultCellV5) => ({
        ...cell,
        postValidation: { ...cell.postValidation, publicationOccurred: false },
      }),
      name: "Install publication flag",
    },
    {
      id: "quota-probe-exceeded",
      mutate: (cell: InstallerTrustFaultCellV5) => ({
        ...cell,
        postValidation: { ...cell.postValidation, terminalPublicationCount: 1 },
      }),
      name: "failed publication count",
    },
    {
      id: "reused-object-corruption",
      mutate: (cell: InstallerTrustFaultCellV5) => ({
        ...cell,
        fault: {
          ...cell.fault,
          events: cell.fault.events.map((event) => ({ ...event, operation: "install" as const })),
        },
      }),
      name: "operation substitution",
    },
  ] as const)("rejects an adversarial $name mutation", ({ id, mutate }) => {
    const result = currentFixture();
    const cells = result.cells.map((cell) => (cell.id === id ? mutate(cell) : cell));
    expect(() =>
      validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
    ).toThrow();
  });

  it("accepts exact full, conditional, zero-offset, resumed, complete, and interrupted transport", () => {
    const resource = {
      bytes: 10,
      id: resourceId,
      path: `/immutable/${resourceId}.bin`,
      sha256: resourceDigest,
    };
    const exactEtag = strongResourceEtag();
    const allowed = [
      {
        ...request(1, "seed", 1, 0, null),
        bodyBytes: 10,
        range: null,
        status: 200,
      },
      {
        ...request(2, "seed", 1, 0, null),
        bodyBytes: 0,
        range: null,
        status: 304,
      },
      request(3, "attempt-1", 1, 0, null),
      request(4, "attempt-2", 2, 4, exactEtag),
      {
        ...request(5, "attempt-2", 2, 10, exactEtag),
        status: 416,
      },
      {
        ...request(6, "attempt-1", 1, 0, null),
        bodyBytes: 8,
        status: 499,
      },
    ] as const;

    for (const response of allowed) {
      expect(() =>
        validateInstallerTrustFaultResourceResponse(response, resource, {
          allowInterruptedMidAppend: response.status === 499,
        }),
      ).not.toThrow();
    }
  });

  it("rejects every malformed transport kind with bounded request identity", () => {
    const path = `/immutable/${resourceId}.bin`;
    const resource = { bytes: 10, id: resourceId, path, sha256: resourceDigest };
    const exactEtag = strongResourceEtag();
    const forbidden = [
      { ...request(1, "seed", 1, 0, null), method: "HEAD", range: null, status: 200 },
      {
        ...request(2, "seed", 1, 0, null),
        bodyBytes: 0,
        etag: null,
        range: null,
        status: 304,
      },
      { ...request(3, "attempt-1", 1, 0, exactEtag) },
      { ...request(4, "attempt-2", 2, 4, null) },
      { ...request(5, "attempt-2", 2, 10, null), status: 416 },
      { ...request(6, "attempt-1", 1, 0, null), status: 200 },
      { ...request(7, "attempt-1", 1, 0, null), bodyBytes: 8, status: 499 },
      { ...request(8, "attempt-1", 1, 0, null), etag: '"wrong"' },
    ] as const;

    for (const response of forbidden) {
      let message = "";
      try {
        validateInstallerTrustFaultResourceResponse(response, resource, {
          allowInterruptedMidAppend: false,
        });
      } catch (error: unknown) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toMatch(/exact transport authority/u);
      expect(message).toContain(`"order":${response.order}`);
      expect(message).toContain(`"resourceId":"${resourceId}"`);
      expect(message).toContain('"pathSha256":"');
      expect(message).not.toContain(path);
      expect(message.length).toBeLessThan(768);
    }
  });

  it("accepts setup/seed/attempt full shell fetches beside exact Range transfer", () => {
    const result = fixture();
    const cells = result.cells.map((candidate) => {
      if (candidate.id !== "reused-object-corruption") return candidate;
      const seedRangeIndex = candidate.http.findIndex(
        (entry) => entry.phase === "seed" && entry.range === "bytes=0-",
      );
      if (seedRangeIndex < 0) throw new Error("Seed Range fixture is absent");
      const operationRangeIndex = candidate.http.findIndex(
        (entry) => entry.phase === "attempt-1" && entry.range === "bytes=0-",
      );
      if (operationRangeIndex < 0) throw new Error("Operation Range fixture is absent");
      const inserted = [
        ...candidate.http.slice(0, seedRangeIndex),
        shellRequest(1, "setup", 0, 200),
        candidate.http[seedRangeIndex] as InstallerTrustFaultCell["http"][number],
        shellRequest(1, "seed", 1, 200),
        shellRequest(1, "seed", 1, 304),
        ...candidate.http.slice(seedRangeIndex + 1, operationRangeIndex + 1),
        shellRequest(1, "attempt-1", 1, 200),
        shellRequest(1, "attempt-1", 1, 304),
        ...candidate.http.slice(operationRangeIndex + 1),
      ].map((entry, index) => ({ ...entry, order: index + 1 }));
      return withHttp(candidate, inserted);
    });

    expect(() =>
      validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
    ).not.toThrow();
  });

  it("ignores a bounded aborted non-Range shell fetch without weakening Range authority", () => {
    const result = fixture();
    const cells = result.cells.map((candidate) => {
      if (candidate.id !== "final-verification-corruption") return candidate;
      const abortedShell = {
        ...shellRequest(candidate.http.length + 1, "attempt-1", 1, 200),
        bodyBytes: 0,
        status: 499,
      };
      return withHttp(candidate, [...candidate.http, abortedShell]);
    });
    expect(() =>
      validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
    ).not.toThrow();
  });

  it.each([
    { method: "GET", status: 500 },
    { method: "HEAD", status: 499 },
  ] as const)("rejects non-admitted shell transport noise $method/$status", (mutation) => {
    const result = fixture();
    const cells = result.cells.map((candidate) => {
      if (candidate.id !== "final-verification-corruption") return candidate;
      const invalidShell = {
        ...shellRequest(candidate.http.length + 1, "attempt-1", 1, 200),
        bodyBytes: 0,
        ...mutation,
      };
      return withHttp(candidate, [...candidate.http, invalidShell]);
    });
    expect(() =>
      validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
    ).toThrow(/shell full response status is not admissible/u);
  });

  it("still rejects a non-admitted interrupted OPFS Range response", () => {
    const result = fixture();
    const cells = result.cells.map((candidate) => {
      if (candidate.id !== "reused-object-corruption") return candidate;
      const http = candidate.http.map((entry) =>
        entry.phase === "attempt-1" && entry.range === "bytes=0-"
          ? { ...entry, bodyBytes: Math.max(1, entry.bodyBytes - 1), status: 499 }
          : entry,
      );
      return withHttp(candidate, http);
    });
    expect(() =>
      validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
    ).toThrow(/exact transport authority/u);
  });

  it("rejects a full response for an OPFS-only resource", () => {
    const result = fixture();
    const cells = result.cells.map((candidate) => {
      if (candidate.id !== "reused-object-corruption") return candidate;
      const http = [
        ...candidate.http,
        {
          ...request(candidate.http.length + 1, "attempt-1", 1, 0, null),
          range: null,
          status: 200,
        },
      ];
      return withHttp(candidate, http);
    });
    expect(() =>
      validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
    ).toThrow(/full response.*shell resource/u);
  });

  it.each([
    "alongside",
    "missing-opfs",
  ] as const)("rejects a cached/service-worker shell Range %s the expected general-success OPFS request", (mode) => {
    const result = fixture();
    const cells = result.cells.map((candidate) => {
      if (candidate.id !== "estimate-incomplete-probe-success") return candidate;
      const operationIndex = candidate.http.findIndex(
        (entry) => entry.phase === "attempt-1" && entry.range !== null,
      );
      const operation = candidate.http[operationIndex];
      if (operationIndex < 0 || operation === undefined) {
        throw new Error("General-success operation Range fixture is absent");
      }
      const shellRange = asShellRange(operation);
      const http =
        mode === "alongside"
          ? [...candidate.http, shellRange]
          : candidate.http.map((entry, index) => (index === operationIndex ? shellRange : entry));
      return withHttp(
        candidate,
        http.map((entry, index) => ({ ...entry, order: index + 1 })),
      );
    });
    expect(() =>
      validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
    ).toThrow(/Range response.*OPFS resource/u);
  });

  it.each([
    "seed",
    "attempt-1",
  ] as const)("rejects shell Range substitution for the repair cell %s transfer", (phase) => {
    const result = fixture();
    const cells = result.cells.map((candidate) => {
      if (candidate.id !== "reused-object-corruption") return candidate;
      const targetIndex = candidate.http.findIndex(
        (entry) => entry.phase === phase && entry.range !== null,
      );
      const target = candidate.http[targetIndex];
      if (targetIndex < 0 || target === undefined) {
        throw new Error(`Repair ${phase} Range fixture is absent`);
      }
      return withHttp(
        candidate,
        candidate.http.map((entry, index) =>
          index === targetIndex ? asShellRange(target) : entry,
        ),
      );
    });
    expect(() =>
      validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
    ).toThrow(/Range response.*OPFS resource/u);
  });

  it("accepts a schema-v3 result after thousands of observationally equivalent store cycles", () => {
    const legacy = fixture();
    const cells = legacy.cells.map((legacyCell) => {
      if (legacyCell.id !== "persistence-denied") {
        return currentCell(legacyCell, legacy.authority);
      }
      const transferIndex = legacyCell.transitions.findIndex(
        (transition) => transition.transferState === "transferring",
      );
      const transfer = legacyCell.transitions[transferIndex];
      if (transferIndex < 0 || transfer === undefined)
        throw new Error("transfer fixture is absent");
      const expanded = [
        ...legacyCell.transitions.slice(0, transferIndex + 1),
        ...Array.from({ length: 2_000 }, (_, index) => ({
          ...transfer,
          storeState: (index % 2 === 0 ? "staging" : "writing") as InstallerTrustFaultStoreState,
        })),
        ...legacyCell.transitions.slice(transferIndex + 1),
      ].map((transition, index) => ({ ...transition, order: index + 1 }));
      return currentCell({ ...legacyCell, transitions: expanded }, legacy.authority);
    });
    const result = {
      ...legacy,
      cells,
      schemaVersion: INSTALLER_TRUST_FAULTS_SCHEMA_VERSION,
    };

    expect(
      cells.find((candidate) => candidate.id === "persistence-denied")?.transitions
        .rawObservationCount,
    ).toBeGreaterThan(2_000);
    expect(() => validateInstallerTrustFaultsResult(result, result.authority)).not.toThrow();
  });

  it("preserves schema-v3 transition proof semantics without persistence reinterpretation", () => {
    const legacy = fixture();
    const result = {
      ...legacy,
      cells: legacy.cells.map((legacyCell) => proofCell(legacyCell, legacy.authority)),
      schemaVersion: INSTALLER_TRUST_FAULTS_PROOF_SCHEMA_VERSION,
    };

    expect(() => validateInstallerTrustFaultsResult(result, result.authority)).not.toThrow();
    const downgraded = {
      ...result,
      cells: result.cells.map((cell) => {
        const {
          barrierWitnesses: _barrierWitnesses,
          barrierWitnessesSha256: _barrierWitnessesSha256,
          ...previousProof
        } = cell.transitions;
        return { ...cell, transitions: { ...previousProof, schemaVersion: 2 } };
      }),
    };
    expect(() => validateInstallerTrustFaultsResult(downgraded, downgraded.authority)).toThrow(
      /transition proof/u,
    );
  });

  it("accepts denied persistence on ordinary seeded operations only with exact UI/telemetry evidence", () => {
    for (const results of [
      [false, false],
      [false, true],
    ] as const) {
      const result = currentFixture({
        "reused-object-corruption": { results },
      });
      expect(() => validateInstallerTrustFaultsResult(result, result.authority)).not.toThrow();
      const cell = result.cells.find((candidate) => candidate.id === "reused-object-corruption");
      expect(cell?.warning).toBe(results.at(-1) ? null : "degraded-durability");
      expect(cell?.persistence.requests.map((request) => request.classification)).toEqual(
        results[1] ? ["denied", "granted"] : ["denied", "denied"],
      );
    }
  });

  it("accepts granted, already-persisted, and exact injected-denial persistence outcomes", () => {
    const result = currentFixture({
      "estimate-incomplete-probe-success": {
        initialPersisted: true,
        results: [true],
      },
    });
    expect(() => validateInstallerTrustFaultsResult(result, result.authority)).not.toThrow();
    expect(
      result.cells.find((candidate) => candidate.id === "estimate-incomplete-probe-success")
        ?.persistence.requests[0]?.classification,
    ).toBe("already-persisted");
    expect(
      result.cells.find((candidate) => candidate.id === "persistence-denied")?.persistence
        .requests[0],
    ).toMatchObject({
      classification: "denied",
      persistedAfter: false,
      result: false,
      terminalUiState: "denied",
      warning: "degraded-durability",
    });
  });

  it.each([
    "stale-warning",
    "unknown-result",
    "unrequested",
    "cross-operation",
    "telemetry",
    "ui",
  ] as const)("rejects contradictory persistence evidence: %s", (kind) => {
    const result = currentFixture({
      "reused-object-corruption": { results: [false, true] },
    });
    const cells = result.cells.map((candidate) => {
      if (candidate.id !== "reused-object-corruption") return candidate;
      if (kind === "stale-warning") {
        return { ...candidate, warning: "degraded-durability" as const };
      }
      if (kind === "unrequested") {
        return {
          ...candidate,
          persistence: {
            ...candidate.persistence,
            requests: candidate.persistence.requests.slice(0, 1),
          },
        };
      }
      if (kind === "telemetry") {
        return {
          ...candidate,
          snapshots: candidate.snapshots.map((snapshot, index) =>
            index === candidate.snapshots.length - 1
              ? {
                  ...snapshot,
                  installerTransfer: {
                    ...snapshot.installerTransfer,
                    persistedState: false,
                  },
                }
              : snapshot,
          ),
        };
      }
      return {
        ...candidate,
        persistence: {
          ...candidate.persistence,
          requests: candidate.persistence.requests.map((request, index) =>
            index !== 1
              ? request
              : kind === "unknown-result"
                ? { ...request, result: "unknown" }
                : kind === "cross-operation"
                  ? { ...request, persistedBefore: true }
                  : { ...request, terminalUiState: "denied" },
          ),
        },
      };
    });
    expect(() =>
      validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
    ).toThrow(/persistence/u);
  });

  it("preserves schema-v2 proof-v1 aggregate semantics without reinterpreting a witness", () => {
    const legacy = fixture();
    const cells: InstallerTrustFaultCellV2[] = legacy.cells.map((legacyCell) => {
      const current = proofCell(legacyCell, legacy.authority);
      const {
        barrierWitnesses: _barriers,
        barrierWitnessesSha256: _barrierBinding,
        gaps: _gaps,
        schemaVersion: _schemaVersion,
        ...proofV1
      } = current.transitions;
      return {
        ...current,
        transitions: {
          ...proofV1,
          schemaVersion: 1,
        },
      };
    });
    const result = {
      ...legacy,
      cells,
      schemaVersion: INSTALLER_TRUST_FAULTS_PREVIOUS_SCHEMA_VERSION,
    };

    expect(() => validateInstallerTrustFaultsResult(result, result.authority)).not.toThrow();
  });

  it("recomputes the eight-cell verdict without trusting passed", () => {
    const result = fixture();
    expect(() => validateInstallerTrustFaultsResult(result, result.authority)).not.toThrow();
    expect(() =>
      validateInstallerTrustFaultsResult({ ...result, passed: false }, result.authority),
    ).toThrow(/recomputed verdict/);
  });

  it("rejects unknown evidence and authority drift", () => {
    const result = fixture();
    const reorderedAuthority = Object.fromEntries(
      Object.entries(result.authority).reverse(),
    ) as unknown as InstallerTrustFaultAuthority;
    expect(() => validateInstallerTrustFaultsResult(result, reorderedAuthority)).not.toThrow();
    expect(() =>
      validateInstallerTrustFaultsResult({ ...result, extra: true }, result.authority),
    ).toThrow(/unknown/);
    expect(() =>
      validateInstallerTrustFaultsResult(result, {
        ...result.authority,
        source: { ...result.authority.source, commit: "c".repeat(40) },
      }),
    ).toThrow(/authority differs/);
  });

  it("rejects a targeted adversarial mutation in every cell", () => {
    const mutations: Record<InstallerTrustFaultCellId, (cell: InstallerTrustFaultCell) => unknown> =
      {
        "estimate-clearly-insufficient": (cell) => ({
          ...cell,
          http: [
            ...cell.http,
            request(cell.http.length + 1, "attempt-1", 1, 0, null, 10, "unexpected-resource"),
          ],
        }),
        "estimate-incomplete-probe-success": (cell) => ({
          ...cell,
          http: cell.http.filter((entry) => entry.range === null),
        }),
        "final-verification-corruption": (cell) => ({
          ...cell,
          http: cell.http.map((entry) =>
            entry.phase === "attempt-1" ? { ...entry, ifRange: strongResourceEtag() } : entry,
          ),
        }),
        "mid-append-quota-resume": (cell) => ({
          ...cell,
          http: cell.http.map((entry) =>
            entry.phase === "attempt-2" ? { ...entry, range: "bytes=7-" } : entry,
          ),
        }),
        "persistence-denied": (cell) => ({ ...cell, warning: null }),
        "quota-probe-exceeded": (cell) => ({
          ...cell,
          http: [
            ...cell.http,
            request(cell.http.length + 1, "attempt-1", 1, 0, null, 10, "unexpected-resource"),
          ],
        }),
        "repeated-server-corruption": (cell) => ({
          ...cell,
          attempts: [{ ...cell.attempts[0], failureResourceId: "resource-b" }],
        }),
        "reused-object-corruption": (cell) => ({
          ...cell,
          fault: { ...cell.fault, useCount: 2 },
        }),
      };
    for (const id of INSTALLER_TRUST_FAULT_CELL_IDS) {
      const result = fixture();
      const cells = result.cells.map((cell) => (cell.id === id ? mutations[id](cell) : cell));
      expect(
        () => validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
        id,
      ).toThrow();
    }
  });

  it("rejects profile and nonce reuse", () => {
    const result = fixture();
    const first = result.cells[0];
    expect(first).toBeDefined();
    const cells = result.cells.map((cell, index) =>
      index === 1
        ? {
            ...cell,
            fault: {
              ...cell.fault,
              events: cell.fault.events.map((event) => ({
                ...event,
                nonce: first?.fault.nonce ?? event.nonce,
              })),
              nonce: first?.fault.nonce,
            },
            profileId: first?.profileId,
          }
        : cell,
    );
    expect(() => validateInstallerTrustFaultsResult({ ...result, cells })).toThrow(
      /profiles are reused/,
    );
  });

  it("rejects missing, duplicated, and out-of-order raw nonce consumption", () => {
    for (const mutate of [
      (cell: InstallerTrustFaultCell) => ({ ...cell.fault, events: [] }),
      (cell: InstallerTrustFaultCell) => ({
        ...cell.fault,
        events: [...cell.fault.events, { ...cell.fault.events[0], order: 2 }],
        useCount: 2,
      }),
      (cell: InstallerTrustFaultCell) => ({
        ...cell.fault,
        events: cell.fault.events.map((event) => ({ ...event, order: 2 })),
      }),
    ]) {
      const result = fixture();
      const cells = result.cells.map((cell, index) =>
        index === 0 ? { ...cell, fault: mutate(cell) } : cell,
      );
      expect(() => validateInstallerTrustFaultsResult({ ...result, cells })).toThrow(/nonce|token/);
    }
  });

  it("rejects arbitrary or reordered raw transitions", () => {
    const result = fixture();
    const cells = result.cells.map((cell, index) =>
      index === 0
        ? {
            ...cell,
            transitions: cell.transitions.map((transition, transitionIndex) =>
              transitionIndex === 1
                ? { ...transition, order: 99, transferState: "invented-state" }
                : transition,
            ),
          }
        : cell,
    );
    expect(() => validateInstallerTrustFaultsResult({ ...result, cells })).toThrow(/transition/);
  });

  it("rejects noncanonical repeated semantic observations", () => {
    const result = fixture();
    const cells = result.cells.map((cell, index) => {
      if (index !== 0) return cell;
      const first = cell.transitions[0];
      if (first === undefined) throw new Error("Fixture transition is absent");
      const transitions = [first, first, ...cell.transitions.slice(1)].map(
        (transition, transitionIndex) => ({
          ...transition,
          order: transitionIndex + 1,
        }),
      );
      return { ...cell, transitions };
    });

    expect(() => validateInstallerTrustFaultsResult({ ...result, cells })).toThrow(/canonical/);
  });

  it("rejects legal-enum interior, terminal, and ordering mutations in every cell automaton", () => {
    for (const id of INSTALLER_TRUST_FAULT_CELL_IDS) {
      for (const kind of ["interior", "terminal", "order"] as const) {
        const result = fixture();
        const cells = result.cells.map((cell) => {
          if (cell.id !== id) return cell;
          const attemptIndexes = cell.transitions
            .map((transition, index) => (transition.phase === "attempt-1" ? index : -1))
            .filter((index) => index >= 0);
          const next = cell.transitions.map((transition) => ({ ...transition }));
          if (kind === "interior") {
            const index = attemptIndexes.find(
              (candidate) => next[candidate]?.transferState === "probing-quota",
            );
            if (index === undefined) throw new Error("Fixture lacks probing transition");
            const transition = next[index];
            if (transition === undefined) throw new Error("Fixture transition lookup changed");
            next[index] = { ...transition, transferState: "planning" };
          } else if (kind === "terminal") {
            const index = attemptIndexes.at(-1);
            if (index === undefined) throw new Error("Fixture lacks terminal transition");
            const transition = next[index];
            if (transition === undefined) throw new Error("Fixture transition lookup changed");
            const passed = cell.attempts[0]?.outcome === "passed";
            next[index] = {
              ...transition,
              failureCode: null,
              failureResourceId: null,
              transferState: passed ? "verifying" : "probing-quota",
              uiState: passed
                ? cell.fault.events[0]?.operation === "repair"
                  ? "repairing"
                  : "installing"
                : "installing",
            };
          } else {
            const planning = attemptIndexes.find(
              (candidate) => next[candidate]?.transferState === "planning",
            );
            const probing = attemptIndexes.find(
              (candidate) => next[candidate]?.transferState === "probing-quota",
            );
            if (planning === undefined || probing === undefined) {
              throw new Error("Fixture lacks ordered planning/probing transitions");
            }
            const planningTransition = next[planning];
            const probingTransition = next[probing];
            if (planningTransition === undefined || probingTransition === undefined) {
              throw new Error("Fixture transition lookup changed");
            }
            [next[planning], next[probing]] = [probingTransition, planningTransition];
          }
          const ordered = next.map((transition, index) => ({ ...transition, order: index + 1 }));
          return {
            ...cell,
            attempts: cell.attempts.map((attempt) => ({
              ...attempt,
              transitions: projectInstallerTrustFaultAttemptMilestones(
                ordered.filter((transition) => transition.phase === `attempt-${attempt.index}`),
              ).milestones,
            })),
            transitions: ordered,
          };
        });
        expect(
          () => validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
          `${id}:${kind}`,
        ).toThrow();
      }
    }
  });

  it("accepts canonicalized repeated progress and terminal observations in every cell automaton", () => {
    for (const id of INSTALLER_TRUST_FAULT_CELL_IDS) {
      const result = fixture();
      const cells = result.cells.map((cell) => {
        if (cell.id !== id) return cell;
        const attempt = cell.transitions.filter((transition) => transition.phase === "attempt-1");
        const planning = attempt.find((transition) => transition.transferState === "planning");
        const terminal = attempt.at(-1);
        if (planning === undefined || terminal === undefined) {
          throw new Error("Fixture attempt progression is incomplete");
        }
        const rawTransitions = cell.transitions
          .flatMap((transition) => [
            transition,
            ...(transition.order === planning.order || transition.order === terminal.order
              ? [transition]
              : []),
          ])
          .map((transition, index) => ({ ...transition, order: index + 1 }));
        const capture = canonicalizeInstallerTrustFaultTransitions(rawTransitions);
        if (!capture.complete) throw new Error("Fixture transition capture unexpectedly truncated");
        const transitions = capture.events;
        return {
          ...cell,
          attempts: cell.attempts.map((value) => ({
            ...value,
            transitions: projectInstallerTrustFaultAttemptMilestones(
              transitions.filter((transition) => transition.phase === `attempt-${value.index}`),
            ).milestones,
          })),
          transitions,
        };
      });
      expect(
        () => validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
        id,
      ).not.toThrow();
    }
  });

  it("rejects missing, reordered, or authority-significant mutations at the two-stage success boundary", () => {
    const successIds: readonly InstallerTrustFaultCellId[] = [
      "reused-object-corruption",
      "final-verification-corruption",
      "estimate-incomplete-probe-success",
      "mid-append-quota-resume",
      "persistence-denied",
    ];
    for (const id of successIds) {
      for (const kind of [
        "missing",
        "reordered",
        "wrong-failure",
        "wrong-store",
        "wrong-ui",
      ] as const) {
        const result = fixture();
        const cells = result.cells.map((cell) => {
          if (cell.id !== id) return cell;
          const terminalAttempt = cell.attempts.at(-1);
          if (terminalAttempt === undefined) throw new Error("Fixture terminal attempt is absent");
          const phase = `attempt-${terminalAttempt.index}`;
          const readyIndexes = cell.transitions
            .map((transition, index) =>
              transition.phase === phase && transition.transferState === "ready" ? index : -1,
            )
            .filter((index) => index >= 0);
          const intermediateIndex = readyIndexes[0];
          const finalIndex = readyIndexes[1];
          if (intermediateIndex === undefined || finalIndex === undefined) {
            throw new Error("Fixture two-stage Ready boundary is absent");
          }
          let transitions = cell.transitions.map((transition) => ({ ...transition }));
          if (kind === "missing") {
            transitions = transitions.filter((_transition, index) => index !== intermediateIndex);
          } else if (kind === "reordered") {
            const intermediate = transitions[intermediateIndex];
            const final = transitions[finalIndex];
            if (intermediate === undefined || final === undefined) {
              throw new Error("Fixture Ready transition lookup changed");
            }
            [transitions[intermediateIndex], transitions[finalIndex]] = [final, intermediate];
          } else if (kind === "wrong-ui") {
            const intermediate = transitions[intermediateIndex];
            if (intermediate === undefined) throw new Error("Fixture Ready transition is absent");
            transitions[intermediateIndex] = { ...intermediate, uiState: "ready" };
          } else {
            const intermediate = transitions[intermediateIndex];
            if (intermediate === undefined) throw new Error("Fixture Ready transition is absent");
            transitions[intermediateIndex] =
              kind === "wrong-store"
                ? { ...intermediate, storeState: "publishing" }
                : { ...intermediate, failureCode: "quota" };
          }
          const ordered = transitions.map((transition, index) => ({
            ...transition,
            order: index + 1,
          }));
          return {
            ...cell,
            attempts: cell.attempts.map((attempt) => ({
              ...attempt,
              transitions: projectInstallerTrustFaultAttemptMilestones(
                ordered.filter((transition) => transition.phase === `attempt-${attempt.index}`),
              ).milestones,
            })),
            transitions: ordered,
          };
        });
        expect(
          () => validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
          `${id}:${kind}`,
        ).toThrow(/Ready|boundary|progression|authority|canonical/);
      }
    }
  });

  it("rejects failed-repair UI authority retention and missing or forged store revocation", () => {
    for (const kind of [
      "launch-enabled",
      "non-null-shell",
      "preserved-store",
      "preserved-ui-authority",
      "wrong-store",
    ] as const) {
      const result = fixture();
      const cells = result.cells.map((cell) => {
        if (cell.id !== "repeated-server-corruption") return cell;
        const terminalIndex = cell.transitions.length - 1;
        const terminal = cell.transitions[terminalIndex];
        const snapshotIndex = cell.snapshots.length - 1;
        const snapshot = cell.snapshots[snapshotIndex];
        if (terminal === undefined || snapshot === undefined) {
          throw new Error("Failed-repair fixture terminal evidence is absent");
        }
        if (kind === "launch-enabled") {
          return {
            ...cell,
            postValidation: { ...cell.postValidation, launchEnabled: true },
          };
        }
        if (kind === "non-null-shell" || kind === "preserved-ui-authority") {
          const shellGenerationId = `${buildDigest}:${digest}`;
          return {
            ...cell,
            postValidation: {
              ...cell.postValidation,
              uiReleaseDigest: kind === "preserved-ui-authority" ? digest : null,
              uiShellGenerationId: shellGenerationId,
            },
            transitions: cell.transitions.map((transition, index) =>
              index === terminalIndex
                ? {
                    ...transition,
                    releaseDigest: kind === "preserved-ui-authority" ? digest : null,
                    shellGenerationId,
                  }
                : transition,
            ),
          };
        }
        const activeReleaseDigest = kind === "preserved-store" ? digest : "d".repeat(64);
        const selectionEntries = [
          `active:${activeReleaseDigest ?? "null"}`,
          "previous:null",
          "publications:1",
        ].sort();
        return {
          ...cell,
          postValidation: {
            ...cell.postValidation,
            activeReleaseDigest,
            mutationEvidence: {
              ...cell.postValidation.mutationEvidence,
              post: {
                ...cell.postValidation.mutationEvidence.post,
                selection: {
                  entries: selectionEntries,
                  sha256: createHash("sha256")
                    .update(JSON.stringify(selectionEntries))
                    .digest("hex"),
                },
              },
            },
          },
          snapshots: cell.snapshots.map((value, index) =>
            index === snapshotIndex
              ? {
                  ...value,
                  installStore: {
                    ...value.installStore,
                    activeReleaseDigest,
                  },
                }
              : value,
          ),
          transitions: cell.transitions.map((transition, index) =>
            index === terminalIndex ? { ...transition, activeReleaseDigest } : transition,
          ),
        };
      });
      expect(
        () => validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
        kind,
      ).toThrow(/authority|mutation|selection|store|Launch|terminal/i);
    }
  });

  it.each([
    "external-root",
    "indexeddb",
    "saves",
    "shell-cache",
  ] as const)("rejects repeated-corruption mutation outside exact install/selection scopes with bounded diagnostics: %s", (scope) => {
    const result = fixture();
    const cells = result.cells.map((cell) => {
      if (cell.id !== "repeated-server-corruption") return cell;
      const entries = [...cell.postValidation.mutationEvidence.post[scope].entries, "extra"].sort();
      return {
        ...cell,
        postValidation: {
          ...cell.postValidation,
          mutationEvidence: {
            ...cell.postValidation.mutationEvidence,
            post: {
              ...cell.postValidation.mutationEvidence.post,
              [scope]: {
                entries,
                sha256: createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
              },
            },
          },
        },
      };
    });
    expect(() =>
      validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
    ).toThrow(
      new RegExp(
        `cell=repeated-server-corruption; resourceId=${resourceId}; deltas=.*"postCount".*"preCount".*"scope":"${scope}"`,
        "u",
      ),
    );
  });

  it("rejects repeated-corruption partial/checkpoint residue inside the otherwise mutable install root", () => {
    const result = fixture();
    const cells = result.cells.map((cell) => {
      if (cell.id !== "repeated-server-corruption") return cell;
      const entries = [
        ...cell.postValidation.mutationEvidence.post["install-root"].entries,
        `f:partials/${digest}/${resourceId}/checkpoints/00000000000000000010.json:100`,
      ].sort();
      return {
        ...cell,
        postValidation: {
          ...cell.postValidation,
          mutationEvidence: {
            ...cell.postValidation.mutationEvidence,
            post: {
              ...cell.postValidation.mutationEvidence.post,
              "install-root": {
                entries,
                sha256: createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
              },
            },
          },
        },
      };
    });
    expect(() =>
      validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
    ).toThrow(/zero residue.*resourceId/u);
  });

  it("rejects identical pre/post target residue that a changed-scope comparison cannot detect", () => {
    const result = currentFixture();
    const cells = result.cells.map((cell) => {
      if (cell.id !== "repeated-server-corruption") return cell;
      const residue =
        `f:partials/${digest}/${resourceId}/checkpoints/00000000000000000010.json:100:` +
        createHash("sha256").update("residue").digest("hex");
      const mutate = (inventory: { readonly entries: readonly string[] }) => {
        const entries = [...inventory.entries, residue].sort();
        return {
          entries,
          sha256: createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
        };
      };
      return {
        ...cell,
        postValidation: {
          ...cell.postValidation,
          mutationEvidence: {
            ...cell.postValidation.mutationEvidence,
            pre: {
              ...cell.postValidation.mutationEvidence.pre,
              "install-root": mutate(cell.postValidation.mutationEvidence.pre["install-root"]),
            },
            post: {
              ...cell.postValidation.mutationEvidence.post,
              "install-root": mutate(cell.postValidation.mutationEvidence.post["install-root"]),
            },
          },
        },
      };
    });
    expect(() =>
      validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
    ).toThrow(/partial\/checkpoint\/temp\/orphan residue/u);
  });

  it.each([
    "ready",
    "published",
    "commit",
  ] as const)("rejects a same-size durable %s metadata rewrite", (kind) => {
    const result = currentFixture();
    const cells = result.cells.map((cell) => {
      if (cell.id !== "repeated-server-corruption") return cell;
      const pattern =
        kind === "commit"
          ? /^f:commits\//
          : new RegExp(`^f:releases/${digest}/${kind}\\.json:`, "u");
      const postInventory = cell.postValidation.mutationEvidence.post["install-root"];
      const entries = postInventory.entries
        .map((entry) => (pattern.test(entry) ? `${entry.slice(0, -64)}${"e".repeat(64)}` : entry))
        .sort();
      return {
        ...cell,
        postValidation: {
          ...cell.postValidation,
          mutationEvidence: {
            ...cell.postValidation.mutationEvidence,
            post: {
              ...cell.postValidation.mutationEvidence.post,
              "install-root": {
                entries,
                sha256: createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
              },
            },
          },
        },
      };
    });
    expect(() =>
      validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
    ).toThrow(new RegExp(`durable ${kind} metadata bytes`, "u"));
  });

  it("requires repeated-corruption terminal partial/checkpoint/ETag counters to be exact zero", () => {
    const result = currentFixture();
    const cells = result.cells.map((cell) => {
      if (cell.id !== "repeated-server-corruption") return cell;
      const terminalIndex = cell.snapshots.length - 1;
      return {
        ...cell,
        snapshots: cell.snapshots.map((snapshot, index) =>
          index === terminalIndex
            ? {
                ...snapshot,
                installStore: {
                  ...snapshot.installStore,
                  currentCheckpointCount: 1,
                  etagBoundPartialCount: 1,
                  partialBytes: 1,
                  partialResourceCount: 1,
                },
              }
            : snapshot,
        ),
      };
    });
    expect(() =>
      validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
    ).toThrow(/partial\/checkpoint\/ETag telemetry is not exact zero/u);
  });

  it("requires exact repeated-corruption integrity and repair-attempt counters", () => {
    for (const [integrityFailureCount, operationRepairAttemptCount] of [
      [0, 1],
      [1, 1],
      [2, 0],
      [2, 2],
    ] as const) {
      const result = fixture();
      const cells = result.cells.map((cell) => {
        if (cell.id !== "repeated-server-corruption") return cell;
        const terminalIndex = cell.snapshots.length - 1;
        return {
          ...cell,
          snapshots: cell.snapshots.map((snapshot, index) =>
            index === terminalIndex
              ? {
                  ...snapshot,
                  installerTransfer: {
                    ...snapshot.installerTransfer,
                    integrityFailureCount,
                    operationRepairAttemptCount,
                  },
                }
              : snapshot,
          ),
        };
      });
      expect(
        () => validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
        `${integrityFailureCount}/${operationRepairAttemptCount}`,
      ).toThrow(/counter|repair|telemetry|cell/i);
    }
  });

  it("rejects inconsistent repeated-corruption repaired bytes/resources and lifetime download delta", () => {
    for (const kind of [
      "bytes-without-resource",
      "download-delta",
      "resource-without-bytes",
    ] as const) {
      const result = fixture();
      const cells = result.cells.map((cell) => {
        if (cell.id !== "repeated-server-corruption") return cell;
        const terminalIndex = cell.snapshots.length - 1;
        return {
          ...cell,
          accounting:
            kind === "download-delta"
              ? {
                  ...cell.accounting,
                  lifetimeDownloadedBytes: cell.accounting.lifetimeDownloadedBytes + 1,
                }
              : cell.accounting,
          snapshots: cell.snapshots.map((snapshot, index) =>
            index === terminalIndex
              ? {
                  ...snapshot,
                  installerTransfer: {
                    ...snapshot.installerTransfer,
                    ...(kind === "bytes-without-resource"
                      ? { operationRepairedBytes: 1 }
                      : kind === "resource-without-bytes"
                        ? { operationRepairedResourceCount: 1 }
                        : { downloadedBytes: snapshot.installerTransfer.downloadedBytes + 1 }),
                  },
                }
              : snapshot,
          ),
        };
      });
      expect(
        () => validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
        kind,
      ).toThrow(/counter|repair|download|telemetry|cell/i);
    }
  });

  it("derives repeated-corruption lifetime integrity failures from the attempt baseline", () => {
    const result = fixture();
    const cells = result.cells.map((cell) => {
      if (cell.id !== "repeated-server-corruption") return cell;
      return {
        ...cell,
        snapshots: cell.snapshots.map((snapshot, index) =>
          index === 1
            ? {
                ...snapshot,
                installerTransfer: {
                  ...snapshot.installerTransfer,
                  integrityFailureCount: 5,
                },
              }
            : index === 2
              ? {
                  ...snapshot,
                  installerTransfer: {
                    ...snapshot.installerTransfer,
                    integrityFailureCount: 7,
                  },
                }
              : snapshot,
        ),
      };
    });
    expect(() =>
      validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
    ).not.toThrow();
  });

  it("derives manifest resource authority and rejects retained-byte or journal substitution", () => {
    const result = fixture();
    const install = JSON.parse(
      Buffer.from(result.authority.installManifestBase64url, "base64url").toString("utf8"),
    ) as {
      resources: Array<{ id: string; sha256: string }>;
    };
    const target = install.resources.find((resource) => resource.id === resourceId);
    if (target === undefined) throw new Error("Fixture resource is absent");
    target.sha256 = "d".repeat(64);
    const changedBytes = Buffer.from(JSON.stringify(install));
    const changedDigest = createHash("sha256").update(changedBytes).digest("hex");
    const changedAuthority = {
      ...result.authority,
      installManifestBase64url: changedBytes.toString("base64url"),
      installManifestSha256: changedDigest,
      releaseDigest: changedDigest,
    };
    expect(() =>
      validateInstallerTrustFaultsResult(
        { ...result, authority: changedAuthority },
        changedAuthority,
      ),
    ).toThrow(/build\/install manifest resource identity/);

    const substitutedCells = result.cells.map((cell) =>
      cell.id === "estimate-incomplete-probe-success"
        ? withHttp(
            cell,
            cell.http.map((entry) =>
              entry.phase === "attempt-1"
                ? { ...entry, path: `/immutable/${largeResourceId}.bin` }
                : entry,
            ),
          )
        : cell,
    );
    expect(() =>
      validateInstallerTrustFaultsResult({ ...result, cells: substitutedCells }, result.authority),
    ).toThrow(/Range|ETag|authority/);
  });

  it("derives unexpected scoped changes from exact pre/post inventories", () => {
    const result = fixture();
    const cells = result.cells.map((cell) => {
      if (cell.id !== "quota-probe-exceeded") return cell;
      const changedEntries = [
        ...cell.postValidation.mutationEvidence.post.saves.entries,
        "f:unexpected.save:1",
      ].sort();
      return {
        ...cell,
        postValidation: {
          ...cell.postValidation,
          mutationEvidence: {
            ...cell.postValidation.mutationEvidence,
            post: {
              ...cell.postValidation.mutationEvidence.post,
              saves: {
                entries: changedEntries,
                sha256: createHash("sha256").update(JSON.stringify(changedEntries)).digest("hex"),
              },
            },
            unexpectedChangedScopes: ["saves"],
          },
        },
      };
    });
    expect(() =>
      validateInstallerTrustFaultsResult({ ...result, cells }, result.authority),
    ).toThrow(/unexpected mutation|protected OPFS/);
  });

  it.each([
    ["status", { status: 200 }],
    ["body bytes", { bodyBytes: 9 }],
    ["ETag", { etag: '"wrong"' }],
    ["Range", { range: "bytes=1-" }],
  ])("rejects wrong resource-response %s", (_label, mutation) => {
    const result = fixture();
    const cells = result.cells.map((cell) =>
      cell.id === "estimate-incomplete-probe-success"
        ? withHttp(
            cell,
            cell.http.map((entry) =>
              entry.phase === "attempt-1" ? { ...entry, ...mutation } : entry,
            ),
          )
        : cell,
    );
    expect(() => validateInstallerTrustFaultsResult({ ...result, cells })).toThrow(
      /Range|ETag|response|downloaded/,
    );
  });

  it("rejects a missing journal entry, unexpected other-resource transfer, and preexisting selection", () => {
    const result = fixture();
    const missing = result.cells.map((cell) =>
      cell.id === "estimate-incomplete-probe-success"
        ? { ...cell, http: cell.http.filter((entry) => entry.phase !== "attempt-1") }
        : cell,
    );
    expect(() => validateInstallerTrustFaultsResult({ ...result, cells: missing })).toThrow(
      /journal|transfer/,
    );

    const unexpected = result.cells.map((cell) =>
      cell.id === "reused-object-corruption"
        ? {
            ...cell,
            http: [
              ...cell.http,
              request(cell.http.length + 1, "attempt-1", 1, 0, null, 10, "other-resource"),
            ],
          }
        : cell,
    );
    expect(() => validateInstallerTrustFaultsResult({ ...result, cells: unexpected })).toThrow();

    const preexisting = result.cells.map((cell) =>
      cell.id === "reused-object-corruption"
        ? { ...cell, snapshots: [cell.snapshots[1], ...cell.snapshots.slice(1)] }
        : cell,
    );
    expect(() => validateInstallerTrustFaultsResult({ ...result, cells: preexisting })).toThrow(
      /fresh unselected/,
    );
  });
});

function withHttp(
  cell: InstallerTrustFaultCell,
  http: InstallerTrustFaultCell["http"],
): InstallerTrustFaultCell {
  return {
    ...cell,
    http,
    httpSummary: {
      bodyBytes: http.reduce((total, response) => total + response.bodyBytes, 0),
      responseCount: http.length,
      sha256: createHash("sha256").update(JSON.stringify(http)).digest("hex"),
    },
  };
}

function fixture(): InstallerTrustFaultsResult {
  const authority: InstallerTrustFaultAuthority = {
    artifactDigest: buildDigest,
    browser: {
      executableSha256: digest,
      product: "Chrome/151.0.7922.34",
      revision: "@revision",
      sandboxed: true,
      version: "151.0.7922.34",
    },
    buildManifestBase64url: buildManifestBytes.toString("base64url"),
    buildManifestSha256: buildDigest,
    environment: {
      gateState: "valid",
      machineId: "dev-01",
      physicalConsole: true,
      profileIsolation: "fresh-disposable-per-cell",
      tier: "showcase",
    },
    installManifestBase64url: installManifestBytes.toString("base64url"),
    installManifestSha256: digest,
    releaseDigest: digest,
    source: { commit: "b".repeat(40), dirtyTreeDigest: digest },
  };
  return {
    authority,
    cells: INSTALLER_TRUST_FAULT_CELL_IDS.map((id, index) => cell(id, index)),
    completedAt: timestamp,
    contract: "installer-trust-faults@1",
    passed: true,
    schemaVersion: 1,
    startedAt: timestamp,
  };
}

function currentFixture(
  options: Partial<
    Record<
      InstallerTrustFaultCellId,
      Readonly<{ initialPersisted?: boolean; results?: readonly boolean[] }>
    >
  > = {},
): InstallerTrustFaultsResultV5 {
  const legacy = fixture();
  return {
    ...legacy,
    cells: legacy.cells.map((legacyCell) =>
      currentCell(legacyCell, legacy.authority, options[legacyCell.id]),
    ),
    schemaVersion: INSTALLER_TRUST_FAULTS_SCHEMA_VERSION,
  };
}

function proofCell(
  legacyCell: InstallerTrustFaultCell,
  authority: InstallerTrustFaultAuthority,
): InstallerTrustFaultCellV3 {
  const recorder = createInstallerTrustFaultTransitionProofRecorder(
    legacyCell.id,
    authority,
    legacyCell.fault.resourceId,
  );
  const proofEvents = proofTransitions(legacyCell);
  for (const [index, transition] of proofEvents.entries()) {
    recorder.observe(
      compactProofObservation(transition),
      proofEvents[index + 1]?.phase !== transition.phase ? "barrier" : undefined,
    );
  }
  const attempts =
    legacyCell.id === "estimate-clearly-insufficient"
      ? legacyCell.attempts.map((attempt) => ({
          ...attempt,
          transitions: ["idle", "waiting-lock", "planning", "probing-quota", "failed"] as const,
        }))
      : legacyCell.attempts;
  const snapshots =
    legacyCell.id === "estimate-clearly-insufficient"
      ? legacyCell.snapshots.map((snapshot, index) =>
          index === legacyCell.snapshots.length - 1
            ? {
                ...snapshot,
                installStore: {
                  ...snapshot.installStore,
                  failureMessage: null,
                  state: "idle" as const,
                },
              }
            : snapshot,
        )
      : legacyCell.snapshots;
  return { ...legacyCell, attempts, snapshots, transitions: recorder.finish() };
}

function proofTransitions(
  legacyCell: InstallerTrustFaultCell,
): readonly InstallerTrustFaultTransition[] {
  if (legacyCell.id === "estimate-clearly-insufficient") {
    const setup = legacyCell.transitions.filter((transition) => transition.phase === "setup");
    const attempt = (
      transferState: "failed" | "idle" | "planning" | "probing-quota" | "waiting-lock",
      uiState: "failed" | "installing" | "requesting-persistence" = transferState === "failed"
        ? "failed"
        : "installing",
    ): Omit<InstallerTrustFaultTransition, "order"> => ({
      activeReleaseDigest: null,
      failureCode: transferState === "failed" ? "quota" : null,
      failureResourceId: null,
      phase: "attempt-1",
      releaseDigest: null,
      shellGenerationId: null,
      storeState: "idle",
      transferState,
      uiState,
    });
    return [
      ...setup,
      attempt("idle", "requesting-persistence"),
      attempt("idle"),
      attempt("waiting-lock"),
      attempt("planning"),
      attempt("probing-quota"),
      attempt("failed"),
    ].map((transition, index) => ({ ...transition, order: index + 1 }));
  }
  if (legacyCell.id !== "repeated-server-corruption") return legacyCell.transitions;
  const terminalIndex = legacyCell.transitions.findIndex(
    (transition) => transition.phase === "attempt-1" && transition.transferState === "failed",
  );
  const terminal = legacyCell.transitions[terminalIndex];
  if (terminalIndex < 0 || terminal === undefined) {
    throw new Error("Repeated-corruption terminal fixture is absent");
  }
  const generationId = `${buildDigest}:${digest}`;
  const revoked = (
    storeState: InstallerTrustFaultStoreState,
  ): Omit<InstallerTrustFaultTransition, "order"> => ({
    activeReleaseDigest: null,
    failureCode: null,
    failureResourceId: null,
    phase: "attempt-1",
    releaseDigest: digest,
    shellGenerationId: generationId,
    storeState,
    transferState: "verifying",
    uiState: "repairing",
  });
  return [
    ...legacyCell.transitions.slice(0, terminalIndex),
    revoked("idle"),
    revoked("reconciling"),
    revoked("idle"),
    revoked("writing"),
    revoked("idle"),
    revoked("failed"),
    terminal,
  ].map((transition, index) => ({ ...transition, order: index + 1 }));
}

function compactProofObservation(transition: InstallerTrustFaultTransition) {
  const failure =
    transition.failureCode === "quota"
      ? {
          failureClass: "quota" as const,
          failureEvidence: "quota-exceeded" as const,
          failureMessage: "Installer storage quota was exceeded",
          failureOperation: "install" as const,
        }
      : transition.failureCode === "integrity"
        ? {
            failureClass: "installer-transfer" as const,
            failureEvidence: "transfer-integrity" as const,
            failureMessage: "Partial object failed exact <local-path> verification",
            failureOperation: (transition.phase === "seed" ? "install" : "repair") as
              | "install"
              | "repair",
          }
        : null;
  return {
    degradedDurabilityWarning: transition.phase !== "setup",
    persistence: transition.phase === "setup" ? ("not-requested" as const) : ("denied" as const),
    telemetry: {
      installStore: {
        activeReleaseDigest: transition.activeReleaseDigest,
        state: transition.storeState,
      },
      installerTransfer: {
        activeReleaseDigest: transition.activeReleaseDigest,
        failureClass: failure?.failureClass ?? null,
        failureCode: transition.failureCode,
        failureEvidence: failure?.failureEvidence ?? null,
        failureExpectedReleaseDigest: failure?.failureOperation === "repair" ? digest : null,
        failureMessage: failure?.failureMessage ?? null,
        failureOperation: failure?.failureOperation ?? null,
        failureResourceId: transition.failureResourceId,
        failureSource: failure === null ? null : "operation",
        state: transition.transferState,
      },
    },
    transition,
  };
}

function currentCell(
  legacyCell: InstallerTrustFaultCell,
  authority: InstallerTrustFaultAuthority,
  options: Readonly<{
    initialPersisted?: boolean;
    results?: readonly boolean[];
  }> = {},
): InstallerTrustFaultCellV5 {
  const proof = operationAwarePublicationCell(proofCell(legacyCell, authority));
  const expected =
    legacyCell.id === "reused-object-corruption" ||
    legacyCell.id === "final-verification-corruption" ||
    legacyCell.id === "repeated-server-corruption"
      ? ([
          { attempt: 1 as const, operation: "install" as const, phase: "seed" as const },
          { attempt: 1 as const, operation: "repair" as const, phase: "attempt-1" as const },
        ] as const)
      : legacyCell.id === "mid-append-quota-resume"
        ? ([
            { attempt: 1 as const, operation: "install" as const, phase: "attempt-1" as const },
            { attempt: 2 as const, operation: "install" as const, phase: "attempt-2" as const },
          ] as const)
        : ([
            { attempt: 1 as const, operation: "install" as const, phase: "attempt-1" as const },
          ] as const);
  const results = options.results ?? expected.map(() => legacyCell.id !== "persistence-denied");
  if (results.length !== expected.length) throw new Error("Persistence fixture result is absent");
  let persistedBefore = options.initialPersisted ?? false;
  const requests = expected.map((request, index) => {
    const result = results[index];
    if (result === undefined) throw new Error("Persistence fixture result is absent");
    const evidence = {
      ...request,
      classification: result
        ? persistedBefore
          ? ("already-persisted" as const)
          : ("granted" as const)
        : ("denied" as const),
      order: index + 1,
      persistedAfter: result,
      persistedBefore,
      requestedUiState: "requesting" as const,
      result,
      terminalUiState: result ? ("granted" as const) : ("denied" as const),
      warning: result ? null : ("degraded-durability" as const),
    };
    persistedBefore = result;
    return evidence;
  });
  const snapshots = proof.snapshots.map((snapshot, snapshotIndex) => {
    const requestIndex =
      expected.length === 1
        ? snapshotIndex === proof.snapshots.length - 1
          ? 0
          : -1
        : snapshotIndex > 0
          ? snapshotIndex - 1
          : -1;
    const request = requests[requestIndex];
    return request === undefined
      ? snapshot
      : {
          ...snapshot,
          installerTransfer: {
            ...snapshot.installerTransfer,
            persistedState: request.persistedAfter,
          },
        };
  });
  return {
    ...proof,
    postValidation: upgradePostValidationV5(proof),
    persistence: {
      initialPersisted: options.initialPersisted ?? false,
      requests,
    },
    snapshots,
    warning: requests.at(-1)?.warning ?? null,
  };
}

function operationAwarePublicationCell(cell: InstallerTrustFaultCellV3): InstallerTrustFaultCellV3 {
  const baselinePublicationCount = cell.postValidation.operationInitialPublicationCount;
  const terminalAttempt = cell.attempts.at(-1);
  const operation = cell.fault.events[0]?.operation;
  if (terminalAttempt === undefined || operation === undefined) {
    throw new Error("Operation-aware publication fixture lacks a terminal contract");
  }
  const publication = projectInstallerTrustFaultTerminalPublication(
    operation,
    terminalAttempt.outcome,
    baselinePublicationCount,
  );
  const postSelectionEntries = cell.postValidation.mutationEvidence.post.selection.entries
    .map((entry) =>
      entry.startsWith("publications:")
        ? `publications:${publication.terminalPublicationCount}`
        : entry,
    )
    .sort();
  const snapshots = cell.snapshots.map((snapshot, index) =>
    index === cell.snapshots.length - 1
      ? {
          ...snapshot,
          installStore: {
            ...snapshot.installStore,
            publicationCount: publication.terminalPublicationCount,
          },
        }
      : snapshot,
  );
  return {
    ...cell,
    postValidation: {
      ...cell.postValidation,
      mutationEvidence: {
        ...cell.postValidation.mutationEvidence,
        post: {
          ...cell.postValidation.mutationEvidence.post,
          selection: {
            entries: postSelectionEntries,
            sha256: createHash("sha256").update(JSON.stringify(postSelectionEntries)).digest("hex"),
          },
        },
      },
      ...publication,
    },
    snapshots,
  };
}

function upgradePostValidationV5(
  cell: InstallerTrustFaultCellV3,
): InstallerTrustFaultCell["postValidation"] {
  const metadata = (entry: string): string => {
    if (!entry.startsWith("f:")) return entry;
    const path = entry.slice(2, entry.lastIndexOf(":"));
    const isMetadata =
      /^commits\/[0-9]{20}-[a-f0-9]{64}\.json$/u.test(path) ||
      path.endsWith(".verified.json") ||
      path.includes("/checkpoints/") ||
      /^releases\/[a-f0-9]{64}\/(?:abandoned|published|ready|repair-eligibility|staged)\.json$/u.test(
        path,
      );
    return isMetadata ? `${entry}:${createHash("sha256").update(entry).digest("hex")}` : entry;
  };
  const transform = (entries: readonly string[]): string[] => entries.map(metadata).sort();
  const evidence = cell.postValidation.mutationEvidence;
  const preInstall = transform(evidence.pre["install-root"].entries);
  const postInstall = transform(evidence.post["install-root"].entries);
  if (cell.id === "repeated-server-corruption") {
    const durable = [
      `f:commits/00000000000000000001-${digest}.json:100`,
      `f:releases/${digest}/published.json:100`,
      `f:releases/${digest}/ready.json:100`,
    ].map(metadata);
    preInstall.push(...durable);
    postInstall.push(...durable);
    postInstall.push(metadata(`f:releases/${digest}/repair-eligibility.json:100`));
    preInstall.sort();
    postInstall.sort();
  }
  const inventory = (entries: readonly string[]) => ({
    entries,
    sha256: createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
  });
  return {
    ...cell.postValidation,
    mutationEvidence: {
      ...evidence,
      pre: {
        ...evidence.pre,
        "install-root": inventory(preInstall),
      },
      post: {
        ...evidence.post,
        "install-root": inventory(postInstall),
      },
    },
  };
}

function cell(id: InstallerTrustFaultCellId, index: number): InstallerTrustFaultCell {
  const success = new Set<InstallerTrustFaultCellId>([
    "reused-object-corruption",
    "final-verification-corruption",
    "estimate-incomplete-probe-success",
    "mid-append-quota-resume",
    "persistence-denied",
  ]).has(id);
  const repaired = id === "reused-object-corruption" || id === "final-verification-corruption";
  const repairCell =
    id === "reused-object-corruption" ||
    id === "final-verification-corruption" ||
    id === "repeated-server-corruption";
  const repeatedServerCorruption = id === "repeated-server-corruption";
  const midAppend = id === "mid-append-quota-resume";
  const currentResourceId = midAppend ? largeResourceId : resourceId;
  const downloadedBytes =
    repaired || id === "repeated-server-corruption" ? 10 : midAppend ? 6 : success ? 10 : 0;
  const resumedBytes = midAppend ? checkpointBytes : 0;
  const reusedBytes = midAppend ? 0 : 0;
  const totalBytes = success ? downloadedBytes + resumedBytes + reusedBytes : 10;
  const failureCode =
    id === "repeated-server-corruption"
      ? "integrity"
      : id === "estimate-clearly-insufficient" || id === "quota-probe-exceeded"
        ? "quota"
        : null;
  const attempts: InstallerTrustFaultCell["attempts"] = midAppend
    ? [
        {
          action: "retry",
          failureCode: "quota",
          failureResourceId: currentResourceId,
          index: 1,
          networkRetryCount: 0,
          outcome: "failed",
          transitions: ["planning", "probing-quota", "transferring", "failed"],
        },
        {
          action: "none",
          failureCode: null,
          failureResourceId: null,
          index: 2,
          networkRetryCount: 0,
          outcome: "passed",
          transitions: ["planning", "probing-quota", "transferring", "verifying", "ready"],
        },
      ]
    : [
        {
          action: success ? "none" : id === "repeated-server-corruption" ? "repair" : "retry",
          failureCode,
          failureResourceId: id === "repeated-server-corruption" ? resourceId : null,
          index: 1,
          networkRetryCount: 0,
          outcome: success ? "passed" : "failed",
          transitions: success
            ? ["planning", "probing-quota", "transferring", "verifying", "ready"]
            : id === "repeated-server-corruption"
              ? [
                  "ready",
                  "waiting-lock",
                  "planning",
                  "probing-quota",
                  "transferring",
                  "verifying",
                  "failed",
                ]
              : ["planning", "probing-quota", "failed"],
        },
      ];
  const operationHttp =
    id === "estimate-clearly-insufficient" || id === "quota-probe-exceeded"
      ? []
      : midAppend
        ? [
            request(2, "attempt-1", 1, 0, null, totalBytes, currentResourceId),
            request(
              3,
              "attempt-2",
              2,
              checkpointBytes,
              strongResourceEtag(currentResourceId),
              totalBytes,
              currentResourceId,
            ),
          ]
        : [request(repairCell ? 3 : 2, "attempt-1", 1, 0, null, totalBytes)];
  const http = [
    setupRequest(1),
    ...(repairCell ? [request(2, "seed", 1, 0, null, totalBytes)] : []),
    ...operationHttp,
  ].map((entry, ordinal) => ({ ...entry, order: ordinal + 1 }));
  const accounting = {
    checkpointedBytes: midAppend ? checkpointBytes : 0,
    downloadedBytes,
    lifetimeCheckpointedBytes: midAppend ? checkpointBytes : 0,
    lifetimeDownloadedBytes:
      (repairCell ? totalBytes : 0) + (midAppend ? totalBytes : downloadedBytes),
    readyBytes: success ? totalBytes : 0,
    repairedBytes: repaired ? 10 : 0,
    repairedResourceCount: repaired ? 1 : 0,
    resumedBytes,
    reusedBytes,
    totalBytes,
  };
  const initialPublicationCount = repairCell ? 1 : 0;
  const nonce = `${String(index).padStart(2, "0")}${"n".repeat(30)}`;
  const operation = repairCell ? "repair" : "install";
  const transitions = rawTransitions(attempts, repairCell, repeatedServerCorruption, failureCode);
  return {
    accounting,
    attempts,
    cleanup: { faultHooksCleared: true, profileRemoved: true, serverStopped: true },
    completedAt: timestamp,
    fault: {
      events: [
        {
          nonce,
          offset: midAppend ? checkpointBytes : 0,
          operation,
          order: 1,
          releaseDigest: digest,
          resourceId: currentResourceId,
        },
      ],
      kind: faultKind(id),
      nonce,
      offset: midAppend ? checkpointBytes : 0,
      releaseDigest: digest,
      resourceId: currentResourceId,
      useCount: 1,
    },
    http,
    httpSummary: {
      bodyBytes: http.reduce((total, response) => total + response.bodyBytes, 0),
      responseCount: http.length,
      sha256: createHash("sha256").update(JSON.stringify(http)).digest("hex"),
    },
    id,
    postValidation: {
      activeReleaseDigest: repeatedServerCorruption ? null : success || repairCell ? digest : null,
      externalRootSentinelSha256: resourceDigest,
      launchEnabled: success,
      operationInitialActiveReleaseDigest: repairCell ? digest : null,
      operationInitialPreviousReleaseDigest: null,
      operationInitialPublicationCount: initialPublicationCount,
      mutationEvidence: mutationEvidence(success, repairCell, repeatedServerCorruption),
      previousReleaseDigest: null,
      publicationOccurred: success,
      saveSentinelSha256: resourceDigest,
      targetReleaseDigest: digest,
      terminalPublicationCount: initialPublicationCount + (success ? 1 : 0),
      uiReleaseDigest: success ? digest : null,
      uiShellGenerationId: success ? `${buildDigest}:${digest}` : null,
    },
    profileId: `profile-${String(index).padStart(2, "0")}${"p".repeat(16)}`,
    snapshots: snapshots({
      accounting,
      failureCode,
      failureResourceId:
        id === "repeated-server-corruption" || midAppend ? currentResourceId : null,
      midAppend,
      repairCell,
      repeatedServerCorruption,
      success,
    }),
    startedAt: timestamp,
    transitions,
    warning: id === "persistence-denied" ? "degraded-durability" : null,
  };
}

function mutationEvidence(
  success: boolean,
  repairCell: boolean,
  repeatedServerCorruption: boolean,
): InstallerTrustFaultCell["postValidation"]["mutationEvidence"] {
  const sentinel = [`f:trust-sentinel.bin:42:${resourceDigest}`];
  const external = [
    "d:external-trust-root",
    `f:external-trust-root/trust-sentinel.bin:42:${resourceDigest}`,
  ];
  const preEntries = {
    "external-root": external,
    indexeddb: [] as string[],
    "install-root": repeatedServerCorruption
      ? [
          "f:object.data:10",
          `f:objects/games/parallax/sha256/${resourceDigest.slice(0, 2)}/${resourceDigest}.verified.json:100`,
        ]
      : repairCell
        ? ["f:object.data:10"]
        : [],
    saves: sentinel,
    selection: [
      `active:${repairCell ? digest : "null"}`,
      "previous:null",
      `publications:${repairCell ? 1 : 0}`,
    ].sort(),
    "shell-cache": [] as string[],
  };
  const postEntries = {
    "external-root": external,
    indexeddb: [] as string[],
    "install-root": repeatedServerCorruption
      ? ["f:object.data:10"]
      : repairCell || success
        ? ["f:object.data:10"]
        : ["f:staged.partial:1"],
    saves: sentinel,
    selection: [
      `active:${repeatedServerCorruption ? "null" : success || repairCell ? digest : "null"}`,
      "previous:null",
      `publications:${(repairCell ? 1 : 0) + (success ? 1 : 0)}`,
    ].sort(),
    "shell-cache": [] as string[],
  };
  const inventories = (
    value: typeof preEntries,
  ): InstallerTrustFaultCell["postValidation"]["mutationEvidence"]["pre"] =>
    Object.fromEntries(
      Object.entries(value).map(([scope, entries]) => [
        scope,
        {
          entries,
          sha256: createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
        },
      ]),
    ) as unknown as InstallerTrustFaultCell["postValidation"]["mutationEvidence"]["pre"];
  return {
    declaredMutableScopes: success
      ? ["indexeddb", "install-root", "selection", "shell-cache"]
      : repeatedServerCorruption
        ? ["install-root", "selection"]
        : ["install-root"],
    post: inventories(postEntries),
    pre: inventories(preEntries),
    unexpectedChangedScopes: [],
  };
}

function rawTransitions(
  attempts: InstallerTrustFaultCell["attempts"],
  repairCell: boolean,
  repeatedServerCorruption: boolean,
  failureCode: "integrity" | "quota" | null,
): InstallerTrustFaultCell["transitions"] {
  const events: InstallerTrustFaultCell["transitions"][number][] = [
    {
      activeReleaseDigest: null,
      failureCode: null,
      failureResourceId: null,
      order: 1,
      phase: "setup",
      releaseDigest: null,
      shellGenerationId: null,
      storeState: "unavailable",
      transferState: "idle",
      uiState: "idle",
    },
  ];
  if (repairCell) {
    let readyCount = 0;
    for (const state of [
      "planning",
      "probing-quota",
      "transferring",
      "verifying",
      "ready",
      "ready",
    ] as const) {
      const ready = state === "ready";
      if (ready) readyCount += 1;
      const finalReady = ready && readyCount === 2;
      events.push({
        activeReleaseDigest: ready ? digest : null,
        failureCode: null,
        failureResourceId: null,
        order: events.length + 1,
        phase: "seed",
        releaseDigest: finalReady ? digest : null,
        shellGenerationId: finalReady ? `${buildDigest}:${digest}` : null,
        storeState: ready ? "ready" : "idle",
        transferState: state,
        uiState: finalReady ? "ready" : "installing",
      });
    }
  }
  for (const attempt of attempts) {
    const phase = `attempt-${attempt.index}` as "attempt-1" | "attempt-2";
    if (repeatedServerCorruption) {
      const generationId = `${buildDigest}:${digest}`;
      const pushRepairFailure = (
        transferState: InstallerTrustFaultTransferState,
        storeState: InstallerTrustFaultStoreState,
        uiState: InstallerTrustFaultUiState,
        authorityRetained: boolean,
        terminal = false,
      ): void => {
        events.push({
          activeReleaseDigest: authorityRetained ? digest : null,
          failureCode: terminal ? "integrity" : null,
          failureResourceId: terminal ? attempt.failureResourceId : null,
          order: events.length + 1,
          phase,
          releaseDigest: authorityRetained ? digest : null,
          shellGenerationId: authorityRetained ? generationId : null,
          storeState,
          transferState,
          uiState,
        });
      };
      pushRepairFailure("ready", "ready", "requesting-persistence", true);
      pushRepairFailure("ready", "ready", "repairing", true);
      pushRepairFailure("waiting-lock", "ready", "repairing", true);
      pushRepairFailure("planning", "ready", "repairing", true);
      pushRepairFailure("planning", "reconciling", "repairing", true);
      pushRepairFailure("planning", "ready", "repairing", true);
      pushRepairFailure("planning", "staging", "repairing", true);
      pushRepairFailure("planning", "ready", "repairing", true);
      pushRepairFailure("probing-quota", "ready", "repairing", true);
      pushRepairFailure("probing-quota", "writing", "repairing", true);
      pushRepairFailure("probing-quota", "ready", "repairing", true);
      pushRepairFailure("transferring", "ready", "repairing", true);
      pushRepairFailure("verifying", "ready", "repairing", true);
      pushRepairFailure("verifying", "verifying", "repairing", true);
      pushRepairFailure("failed", "failed", "failed", false, true);
      continue;
    }
    let readyCount = 0;
    const states = (
      attempt.outcome === "passed" && attempt.transitions.at(-1) === "ready"
        ? [...attempt.transitions, "ready"]
        : attempt.transitions
    ) as readonly InstallerTrustFaultTransferState[];
    for (const state of states) {
      const failed = state === "failed";
      const ready = state === "ready";
      if (ready) readyCount += 1;
      const finalReady = ready && readyCount === 2;
      events.push({
        activeReleaseDigest:
          repeatedServerCorruption && failed ? null : repairCell || ready ? digest : null,
        failureCode: failed ? (failureCode ?? "quota") : null,
        failureResourceId: failed ? attempt.failureResourceId : null,
        order: events.length + 1,
        phase,
        releaseDigest: failed ? null : repairCell || finalReady ? digest : null,
        shellGenerationId: failed
          ? null
          : repairCell || finalReady
            ? `${buildDigest}:${digest}`
            : null,
        storeState: failed ? "failed" : ready ? "ready" : "idle",
        transferState: state,
        uiState: failed ? "failed" : finalReady ? "ready" : repairCell ? "repairing" : "installing",
      });
    }
  }
  return events;
}

function snapshots(input: {
  accounting: InstallerTrustFaultCell["accounting"];
  failureCode: "integrity" | "quota" | null;
  failureResourceId: string | null;
  midAppend: boolean;
  repairCell: boolean;
  repeatedServerCorruption: boolean;
  success: boolean;
}) {
  const idle = {
    installStore: unavailableInstallStoreTelemetrySnapshot(),
    installerTransfer: idleInstallerTransferTelemetrySnapshot(),
  };
  const finalVerification = input.success
    ? {
        finalVerificationBytes: input.accounting.totalBytes,
        finalVerificationPhase: "complete" as const,
        finalVerificationResourceCount: 1,
        finalVerificationTotalBytes: input.accounting.totalBytes,
        finalVerificationTotalResourceCount: 1,
      }
    : {};
  const operationRangeCount = input.midAppend
    ? 2
    : input.failureCode === "quota" && !input.success
      ? 0
      : 1;
  const seedRangeCount = input.repairCell ? 1 : 0;
  const terminal = {
    installStore: {
      ...idle.installStore,
      ...finalVerification,
      activeReleaseDigest: input.repeatedServerCorruption
        ? null
        : input.success || input.repairCell
          ? digest
          : null,
      publicationCount: (input.repairCell ? 1 : 0) + (input.success ? 1 : 0),
      failureMessage: input.success ? null : "typed failure",
      state: input.success ? ("ready" as const) : ("failed" as const),
    },
    installerTransfer: {
      ...idle.installerTransfer,
      ...finalVerification,
      activeReleaseDigest: input.success ? digest : null,
      checkpointedBytes: input.accounting.lifetimeCheckpointedBytes,
      completedResourceCount: input.success ? 1 : 0,
      downloadedBytes: input.accounting.lifetimeDownloadedBytes,
      failureCode: input.success ? null : input.failureCode,
      failureClass: input.success
        ? null
        : input.failureCode === "integrity"
          ? ("installer-transfer" as const)
          : ("quota" as const),
      failureEvidence: input.success
        ? null
        : input.failureCode === "integrity"
          ? ("transfer-integrity" as const)
          : ("quota-exceeded" as const),
      failureExpectedReleaseDigest: !input.success && input.repairCell ? digest : null,
      failureMessage: input.success ? null : "typed failure",
      failureOperation: input.success
        ? null
        : input.repairCell
          ? ("repair" as const)
          : ("install" as const),
      failureResourceId: input.success ? null : input.failureResourceId,
      failureSource: input.success ? null : ("operation" as const),
      integrityFailureCount:
        input.failureCode === "integrity" ? 2 : input.accounting.repairedResourceCount > 0 ? 1 : 0,
      operationRepairAttemptCount:
        input.accounting.repairedResourceCount > 0 || input.failureCode === "integrity" ? 1 : 0,
      operationRepairedBytes: input.accounting.repairedBytes,
      operationRepairedResourceCount: input.accounting.repairedResourceCount,
      httpRequestCount: seedRangeCount + operationRangeCount,
      plannedDownloadBytes: input.accounting.downloadedBytes,
      plannedResumeBytes: input.accounting.resumedBytes,
      quotaRequiredPeakBytes:
        Math.max(
          input.accounting.reusedBytes === input.accounting.totalBytes
            ? 0
            : input.accounting.totalBytes,
          1024 * 1024,
        ) +
        16 * 1024 * 1024,
      resourceCount: 1,
      rangeRequestCount: seedRangeCount + operationRangeCount,
      resumedBytes: input.accounting.resumedBytes,
      reusedBytes: input.accounting.reusedBytes,
      state: input.success ? ("ready" as const) : ("failed" as const),
      totalBytes: input.accounting.totalBytes,
      verifiedBytes: input.success ? input.accounting.totalBytes : 0,
    },
  };
  if (input.midAppend) {
    return [
      idle,
      {
        installStore: { ...idle.installStore, state: "idle" as const },
        installerTransfer: {
          ...idle.installerTransfer,
          activeReleaseDigest: digest,
          checkpointedBytes: input.accounting.checkpointedBytes,
          downloadedBytes: input.accounting.checkpointedBytes,
          failureCode: "quota" as const,
          failureClass: "quota" as const,
          failureEvidence: "quota-exceeded" as const,
          failureExpectedReleaseDigest: input.repairCell ? digest : null,
          failureMessage: "typed quota failure",
          failureOperation: input.repairCell ? ("repair" as const) : ("install" as const),
          failureResourceId: input.failureResourceId,
          failureSource: "operation" as const,
          httpRequestCount: 1,
          plannedDownloadBytes: input.accounting.totalBytes,
          quotaFailureCount: 1,
          rangeRequestCount: 1,
          resourceCount: 1,
          state: "failed" as const,
          totalBytes: input.accounting.totalBytes,
        },
      },
      terminal,
    ];
  }
  if (!input.repairCell) return [idle, terminal];
  return [
    idle,
    {
      installStore: {
        ...idle.installStore,
        activeReleaseDigest: digest,
        finalVerificationBytes: input.accounting.totalBytes,
        finalVerificationPhase: "complete" as const,
        finalVerificationResourceCount: 1,
        finalVerificationTotalBytes: input.accounting.totalBytes,
        finalVerificationTotalResourceCount: 1,
        publicationCount: 1,
        state: "ready" as const,
      },
      installerTransfer: {
        ...idle.installerTransfer,
        activeReleaseDigest: digest,
        completedResourceCount: 1,
        finalVerificationBytes: input.accounting.totalBytes,
        finalVerificationPhase: "complete" as const,
        finalVerificationResourceCount: 1,
        finalVerificationTotalBytes: input.accounting.totalBytes,
        finalVerificationTotalResourceCount: 1,
        downloadedBytes: input.accounting.totalBytes,
        httpRequestCount: 1,
        plannedDownloadBytes: input.accounting.totalBytes,
        rangeRequestCount: 1,
        resourceCount: 1,
        state: "ready" as const,
        totalBytes: input.accounting.totalBytes,
        verifiedBytes: input.accounting.totalBytes,
      },
    },
    terminal,
  ];
}

function resourceSha256(targetResourceId: string): string {
  return targetResourceId === largeResourceId ? largeResourceDigest : resourceDigest;
}

function strongResourceEtag(targetResourceId = resourceId): string {
  return `"sha256-${resourceSha256(targetResourceId)}"`;
}

function shellRequest(
  order: number,
  phase: "attempt-1" | "seed" | "setup",
  attempt: 0 | 1,
  status: 200 | 304,
): InstallerTrustFaultCell["http"][number] {
  return {
    attempt,
    bodyBytes: status === 200 ? 10 : 0,
    etag: `"sha256-${shellResourceDigest}"`,
    ifRange: null,
    method: "GET",
    order,
    path: `/immutable/${shellResourceId}.bin`,
    phase,
    range: null,
    status,
  };
}

function asShellRange(
  entry: InstallerTrustFaultCell["http"][number],
): InstallerTrustFaultCell["http"][number] {
  return {
    ...entry,
    bodyBytes: 10,
    etag: `"sha256-${shellResourceDigest}"`,
    ifRange: null,
    path: `/immutable/${shellResourceId}.bin`,
    range: "bytes=0-",
    status: 206,
  };
}

function setupRequest(order: number): InstallerTrustFaultCell["http"][number] {
  return {
    attempt: 0,
    bodyBytes: 100,
    etag: null,
    ifRange: null,
    method: "GET",
    order,
    path: "/",
    phase: "setup",
    range: null,
    status: 200,
  };
}

function request(
  order: number,
  phase: "attempt-1" | "attempt-2" | "seed",
  attempt: 1 | 2,
  rangeStart: number,
  ifRange: string | null,
  totalBytes = 10,
  targetResourceId = resourceId,
): InstallerTrustFaultCell["http"][number] {
  return {
    attempt,
    bodyBytes: totalBytes - rangeStart,
    etag: strongResourceEtag(targetResourceId),
    ifRange,
    method: "GET",
    order,
    path: `/immutable/${targetResourceId}.bin`,
    phase,
    range: `bytes=${rangeStart}-`,
    status: 206,
  };
}

function faultKind(id: InstallerTrustFaultCellId): InstallerTrustFaultCell["fault"]["kind"] {
  const kinds: Record<InstallerTrustFaultCellId, InstallerTrustFaultCell["fault"]["kind"]> = {
    "estimate-clearly-insufficient": "estimate-insufficient",
    "estimate-incomplete-probe-success": "estimate-incomplete",
    "final-verification-corruption": "corrupt-final-object",
    "mid-append-quota-resume": "mid-append-quota",
    "persistence-denied": "persistence-denied",
    "quota-probe-exceeded": "quota-probe",
    "repeated-server-corruption": "corrupt-server-representation",
    "reused-object-corruption": "corrupt-reused-object",
  };
  return kinds[id];
}
