import { createHash, randomBytes } from "node:crypto";
import { cp, link, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import type { Server } from "node:http";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS,
  assertCanonicalInstallerFailureDiagnostic,
  INSTALL_STORE_ROOT,
  INSTALLER_FAILURE_RULES,
  type InstallerFailureClass,
  type InstallerFailureCode,
  type InstallerFailureEvidence,
  type InstallerFailureOperation,
  type InstallerSnapshot,
  type InstallResource,
  installerFailureRecoveryAction,
  type OfflineShellFailureCode,
  parseInstallerSnapshot,
  sanitizeInstallerFailureMessage,
} from "@parallax/engine";
import type { BrowserContext, Page, Worker } from "playwright-core";
import { readAndValidateBuildManifest, type ValidatedBuildManifest } from "./build-manifest.js";
import {
  launchPersistentChrome,
  loadChromePin,
  resolveChromeExecutablePath,
} from "./chrome-pin.js";
import { createExactRangeResources } from "./exact-range-resources.js";
import {
  createInstallerTrustFaultOwnership,
  type InstallerTrustFaultOwnership,
} from "./installer-trust-faults-lifecycle.js";
import {
  INSTALLER_TRUST_FAULT_CHECKPOINT_BYTES,
  type InstallerTrustFaultAuthority,
  type InstallerTrustFaultCellV5 as InstallerTrustFaultCell,
  type InstallerTrustFaultCellId,
  type InstallerTrustFaultMutationScope,
  type InstallerTrustFaultScopedInventory,
  selectInstallerTrustFaultResource,
} from "./installer-trust-faults-result.js";
import type { InstallerTrustFaultRuntimeDependencies } from "./installer-trust-faults-run.js";
import {
  type InstallerTrustStartupObservation,
  waitForInstallerTrustStartupAdmission,
} from "./installer-trust-faults-startup.js";
import { InstallerTrustFaultCellTerminalEvidenceError } from "./installer-trust-faults-terminal-evidence.js";
import {
  createInstallerTrustFaultTransitionProofRecorder,
  INSTALLER_TRUST_FAULT_MAX_RAW_OBSERVATIONS,
  INSTALLER_TRUST_FAULT_TRANSITION_PROOF_SCHEMA_VERSION,
  type InstallerTrustFaultRawObservation,
  type InstallerTrustFaultRawTelemetry,
  type InstallerTrustFaultTransitionProof,
  type InstallerTrustFaultTransitionProofRecorder,
} from "./installer-trust-faults-transition-proof.js";
import {
  type InstallerTrustFaultStoreState,
  type InstallerTrustFaultTransferState,
  type InstallerTrustFaultTransition,
  type InstallerTrustFaultUiState,
  projectInstallerTrustFaultAttemptMilestones,
} from "./installer-trust-faults-transitions.js";
import { launchAfterPhysicalConsoleDisplayWake } from "./physical-console-preflight.js";
import { inspectRegisteredEnvironment } from "./registered-environment.js";
import {
  createLocalServer,
  type LocalServerDetailedJournalEntry,
  listenLocalServer,
  stopLocalServer,
} from "./server.js";
import { readSourceIdentity } from "./source-identity.js";
import { startHarnessTarget } from "./target.js";

export const INSTALLER_TRUST_FAULT_READY_TIMEOUT_MS = 10 * 60_000;
const FAILURE_TIMEOUT_MS = 120_000;
const PERSISTENCE_OBSERVER_TIMEOUT_MS = 30_000;
const SENTINEL_BYTES = new TextEncoder().encode("parallax-installer-trust-fault-sentinel-v1");
const SENTINEL_SHA256 = createHash("sha256").update(SENTINEL_BYTES).digest("hex");
const DEGRADED_DURABILITY_WARNING =
  "Persistent storage was not granted. Installation can continue, but Chrome may evict the game under storage pressure.";
const INSTALLER_TRUST_PRODUCT_TERMINAL_FAILURE_CODES = new Set<string>([
  "cancel-target-invalid",
  "cancelled",
  "concurrent-install",
  "disposed",
  "install-manifest-invalid",
  "integrity",
  "launch",
  "persistence",
  "protocol",
  "quota",
  "shell-contract",
  "shell-incompatible",
  "shell-release-mismatch",
  "shell-unavailable",
  "store",
  "transport",
  "unknown",
  "validator",
] satisfies readonly Exclude<InstallerTrustProductTerminalFailureCode, null>[]);

interface BrowserRuntime {
  readonly build: ValidatedBuildManifest;
  readonly executablePath: string;
}

interface RawCellObservation {
  readonly accounting: InstallerTrustFaultCell["accounting"];
  readonly attempts: InstallerTrustFaultCell["attempts"];
  readonly faultEvents: InstallerTrustFaultCell["fault"]["events"];
  readonly http: InstallerTrustFaultCell["http"];
  readonly postValidation: InstallerTrustFaultCell["postValidation"];
  readonly persistence: InstallerTrustFaultCell["persistence"];
  readonly snapshots: readonly InstallerSnapshot[];
  readonly transitions: InstallerTrustFaultCell["transitions"];
  readonly warning: InstallerTrustFaultCell["warning"];
}

export interface InstallerTrustProductTerminalProjection {
  readonly expected: "failed" | "ready";
  readonly observed: "failed" | "ready";
  readonly store: Readonly<{
    readonly activeReleaseDigest: string | null;
    readonly currentReleaseDigest: string | null;
    readonly currentResourceId: string | null;
    readonly failureMessage: string | null;
    readonly state: InstallerSnapshot["installStore"]["state"];
  }>;
  readonly transfer: Readonly<{
    readonly activeReleaseDigest: string | null;
    readonly failureCode: InstallerSnapshot["installerTransfer"]["failureCode"];
    readonly failureClass: InstallerSnapshot["installerTransfer"]["failureClass"];
    readonly failureEvidence: InstallerSnapshot["installerTransfer"]["failureEvidence"];
    readonly failureOperation: InstallerSnapshot["installerTransfer"]["failureOperation"];
    readonly failureMessage: string | null;
    readonly failureResourceId: string | null;
    readonly state: InstallerSnapshot["installerTransfer"]["state"];
  }>;
  readonly ui: Readonly<{
    readonly action: "none" | "reload" | "repair" | "retry";
    readonly failureCode: InstallerTrustProductTerminalFailureCode;
    readonly failureOperation: InstallerFailureOperation | null;
    readonly failureResourceId: string | null;
    readonly releaseDigest: string | null;
    readonly shellGenerationId: string | null;
    readonly state: "failed" | "ready";
  }>;
}

export type InstallerTrustProductTerminalFailureCode =
  | InstallerFailureCode
  | OfflineShellFailureCode
  | "launch"
  | "persistence"
  | null;

export interface InstallerTrustProductTerminalAuthority {
  readonly artifactDigest: string;
  readonly releaseDigest: string;
}

export class InstallerTrustProductTerminalError extends Error {
  public constructor(public readonly projection: InstallerTrustProductTerminalProjection) {
    super(formatInstallerTrustProductTerminalProjection(projection));
    this.name = "InstallerTrustProductTerminalError";
  }
}

interface InstallerTrustPersistenceRecorderState {
  readonly diagnostics: readonly Readonly<{
    readonly callOrder: number;
    readonly phase: Exclude<TrustPhase, "setup"> | null;
    readonly settleOrder: number | null;
    readonly state:
      | "after-probe-rejected"
      | "boundary-invalid"
      | "non-boolean-result"
      | "pending"
      | "platform-rejected"
      | "resolved";
  }>[];
  readonly evidence: InstallerTrustFaultCell["persistence"];
  readonly faultEvents: InstallerTrustFaultCell["fault"]["events"];
  clear(): void;
  configureDenial(
    input: Readonly<{
      readonly nonce: string;
      readonly operation: "install" | "repair";
      readonly releaseDigest: string;
      readonly resourceId: string;
    }>,
  ): void;
  finalize(phase: Exclude<TrustPhase, "setup">): Promise<void>;
  restore(): void;
  setContext(
    input: Readonly<{
      readonly attempt: 1 | 2;
      readonly operation: "install" | "repair";
      readonly phase: Exclude<TrustPhase, "setup">;
    }>,
  ): void;
}

type TrustPhase = "attempt-1" | "attempt-2" | "seed" | "setup";
type InstallerTrustTransitionBarrierKind = "clear" | "phase" | "seal";

export interface InstallerTrustTransitionBatch {
  readonly rawObservations: readonly unknown[];
  readonly transitions: readonly InstallerTrustFaultTransition[];
}

export interface InstallerTrustTransitionQueueState {
  barrier(
    kind: InstallerTrustTransitionBarrierKind,
    nextPhase?: TrustPhase,
  ): InstallerTrustTransitionBatch;
  readonly nextOrder: number;
  readonly phase: TrustPhase;
}

export async function createInstallerTrustFaultBrowserDependencies(
  repositoryRoot: string,
): Promise<InstallerTrustFaultRuntimeDependencies> {
  const buildRoot = join(repositoryRoot, "dist");
  let runtime: BrowserRuntime | null = null;
  let authority: InstallerTrustFaultAuthority | null = null;
  const preflight = async (): Promise<InstallerTrustFaultAuthority> => {
    let profilePath: string | null = null;
    let target: Awaited<ReturnType<typeof startHarnessTarget>> | null = null;
    let result: InstallerTrustFaultAuthority | null = null;
    let primaryError: unknown = null;
    let operation = "read-build-manifest";
    const ownership = createInstallerTrustFaultOwnership();
    try {
      const build = await readAndValidateBuildManifest(buildRoot);
      operation = "read-build-manifest-bytes";
      const buildManifestBytes = await readFile(join(buildRoot, "build-manifest.json"));
      operation = "read-install-manifest-bytes";
      const installManifestBytes = await readFile(join(buildRoot, "install-manifest.json"));
      operation = "read-source-identity";
      const source = await readSourceIdentity(repositoryRoot);
      operation = "load-chrome-pin";
      const pin = await loadChromePin(join(repositoryRoot, "harness/chrome/stable.json"));
      operation = "resolve-chrome-executable";
      const executablePath = await resolveChromeExecutablePath(repositoryRoot, pin);
      operation = "create-profile";
      profilePath = await mkdtemp(join(tmpdir(), "parallax-installer-trust-identity-"));
      ownership.add({
        operation: "remove-preflight-profile",
        run: () => rm(profilePath as string, { force: true, recursive: true }),
      });
      operation = "create-target";
      target = await startHarnessTarget({
        artifactDigest: build.artifactDigest,
        buildManifest: build.manifest,
        buildRoot,
        request: "local",
      });
      ownership.add({
        operation: "stop-preflight-target",
        run: () => target?.stop() ?? Promise.resolve(),
      });
      operation = "launch-and-inspect-registered-browser";
      const environment = await inspectRegisteredEnvironment({
        chromePin: pin,
        executablePath,
        machineId: "dev-01",
        machineRoot: join(repositoryRoot, "harness/machines"),
        probeUrl: target.probeUrl,
        profilePath,
        target: target.identity,
        tier: "showcase",
      });
      if (environment.gateIdentity.state !== "measured" || environment.sandboxVerified !== true) {
        throw new Error("Installer trust-fault qualification requires valid registered dev-01");
      }
      runtime = Object.freeze({ build, executablePath });
      result = Object.freeze({
        artifactDigest: build.artifactDigest,
        browser: Object.freeze({
          executableSha256: environment.executableSha256,
          product: environment.browserProduct,
          revision: environment.browserRevision,
          sandboxed: true as const,
          version: pin.version,
        }),
        buildManifestBase64url: buildManifestBytes.toString("base64url"),
        buildManifestSha256: build.buildManifestDigest,
        environment: Object.freeze({
          gateState: "valid" as const,
          machineId: "dev-01" as const,
          physicalConsole: true as const,
          profileIsolation: "fresh-disposable-per-cell" as const,
          tier: "showcase" as const,
        }),
        installManifestBase64url: installManifestBytes.toString("base64url"),
        installManifestSha256: build.releaseDigest,
        releaseDigest: build.releaseDigest,
        source,
      });
    } catch (error: unknown) {
      primaryError = error;
    }
    await ownership.finish(primaryError === null ? null : { error: primaryError, operation });
    if (result === null) throw new Error("Installer trust-fault preflight produced no authority");
    authority = result;
    return result;
  };
  return Object.freeze({
    executeCell: async (id: InstallerTrustFaultCellId, expected: InstallerTrustFaultAuthority) => {
      if (authority === null || runtime === null || expected !== authority) {
        throw new Error("Installer trust-fault browser cell lacks exact preflight authority");
      }
      return executeBrowserCell(repositoryRoot, runtime, authority, id);
    },
    postValidate: async (expected: InstallerTrustFaultAuthority) => {
      const currentBuild = await readAndValidateBuildManifest(buildRoot);
      const currentSource = await readSourceIdentity(repositoryRoot);
      if (
        currentBuild.artifactDigest !== expected.artifactDigest ||
        currentBuild.releaseDigest !== expected.releaseDigest ||
        JSON.stringify(currentSource) !== JSON.stringify(expected.source)
      ) {
        throw new Error("Installer trust-fault build or source changed during qualification");
      }
    },
    preflight,
  });
}

async function executeBrowserCell(
  repositoryRoot: string,
  runtime: BrowserRuntime,
  authority: InstallerTrustFaultAuthority,
  id: InstallerTrustFaultCellId,
): Promise<InstallerTrustFaultCell> {
  const startedAt = new Date().toISOString();
  const nonce = randomBytes(24).toString("base64url");
  let servingParent: string | null = null;
  let profilePath: string | null = null;
  let profileId: string | null = null;
  let server: Server | null = null;
  const resource = selectInstallerTrustFaultResource(authority, id);
  const faultOffset = id === "mid-append-quota-resume" ? INSTALLER_TRUST_FAULT_CHECKPOINT_BYTES : 0;
  const journal: Array<
    LocalServerDetailedJournalEntry & { attempt: 0 | 1 | 2; order: number; phase: TrustPhase }
  > = [];
  let currentAttempt = 0;
  let currentPhase: TrustPhase = "setup";
  const serverFaultEvents: InstallerTrustFaultCell["fault"]["events"][number][] = [];
  let serverStopped = false;
  let profileRemoved = false;
  let hooksCleared = false;
  let persistenceRecorderCleared = false;
  let observation: RawCellObservation | null = null;
  let context: BrowserContext | null = null;
  let retainedPage: Page | null = null;
  let retainedTransitionProof: InstallerTrustFaultTransitionProofRecorder | null = null;
  let primaryError: unknown = null;
  let operation = "create-profile";
  const ownership = createInstallerTrustFaultOwnership();
  try {
    profilePath = await mkdtemp(join(tmpdir(), `parallax-installer-trust-${id}-`));
    profileId = `profile-${basename(profilePath).replaceAll(/[^A-Za-z0-9_-]/gu, "_")}`;
    const ownedProfilePath = profilePath;
    ownership.add({
      operation: "remove-profile",
      run: async () => {
        await rm(ownedProfilePath, { force: true, recursive: true });
        profileRemoved = true;
      },
    });
    operation = "create-serving-parent";
    servingParent = await mkdtemp(join(tmpdir(), "parallax-installer-trust-serving-"));
    const ownedServingParent = servingParent;
    ownership.add({
      operation: "remove-serving-tree",
      run: () => rm(ownedServingParent, { force: true, recursive: true }),
    });
    const servingRoot = join(servingParent, "www");
    operation = "prepare-serving-root";
    await prepareServingRoot(repositoryRoot, runtime.build, servingRoot);
    operation = "create-server";
    server = createLocalServer({
      exactRangeResources: createExactRangeResources(runtime.build.installManifest.resources),
      ...(id === "repeated-server-corruption"
        ? {
            exactRangeBodyTransform: {
              path: `/${resource.source}`,
              transform: ({ body, start }) => {
                if (
                  currentPhase !== "attempt-1" ||
                  serverFaultEvents.length !== 0 ||
                  start !== 0 ||
                  body.byteLength === 0
                ) {
                  return body;
                }
                const corrupt = new Uint8Array(body);
                corrupt[0] = (corrupt[0] ?? 0) ^ 0xff;
                serverFaultEvents.push(
                  Object.freeze({
                    nonce,
                    offset: 0,
                    operation: "repair" as const,
                    order: 1,
                    releaseDigest: authority.releaseDigest,
                    resourceId: resource.id,
                  }),
                );
                return corrupt;
              },
            },
          }
        : {}),
      onDetailedResponse: (entry) =>
        journal.push({
          ...entry,
          attempt: currentAttempt as 0 | 1 | 2,
          order: journal.length + 1,
          phase: currentPhase,
        }),
      root: servingRoot,
    });
    const ownedServer = server;
    ownership.add({
      operation: "stop-server",
      run: async () => {
        await stopLocalServer(ownedServer);
        serverStopped = true;
        if (id === "repeated-server-corruption") hooksCleared = true;
      },
    });
    operation = "listen-server";
    const address = await listenLocalServer(server);
    const origin = `http://127.0.0.1:${address.port}`;
    operation = "launch-browser";
    context = await launchAfterPhysicalConsoleDisplayWake(() =>
      launchPersistentChrome(runtime.executablePath, ownedProfilePath, [
        "--enable-webgpu-developer-features",
      ]),
    );
    const ownedContext = context;
    ownership.add({ operation: "close-browser", run: () => ownedContext.close() });
    operation = "open-ordinary-route";
    const page = context.pages()[0] ?? (await context.newPage());
    retainedPage = page;
    const transitionProof = createInstallerTrustFaultTransitionProofRecorder(
      id,
      authority,
      resource.id,
      "allow-unexpected-terminal",
    );
    retainedTransitionProof = transitionProof;
    await page.goto(origin, { waitUntil: "load" });
    operation = "validate-ordinary-route";
    if (new URL(page.url()).search !== "") {
      throw new Error("Trust-fault qualification must use the ordinary app route");
    }
    operation = "install-trust-observers";
    await installSentinelsAndTransitionRecorder(page, id, authority);
    operation = "observe-installer-worker";
    const installerEntrypoint = runtime.build.manifest.workerEntrypoints.find(
      ({ role }) => role === "installer",
    );
    if (installerEntrypoint === undefined) {
      throw new Error("Validated build manifest omitted its installer worker entrypoint");
    }
    const worker = await installerWorker(page, new URL(installerEntrypoint.path, origin).href);
    operation = "wait-for-startup-admission";
    await waitForInstallerTrustStartupAdmission({
      delay: (milliseconds) =>
        new Promise((resolve) => {
          setTimeout(resolve, milliseconds);
        }),
      expected: {
        allowedUiState: "idle",
        artifactDigest: authority.artifactDigest,
        controllerScriptUrl: new URL(runtime.build.manifest.offlineShell.serviceWorkerPath, origin)
          .href,
        generationId: `${authority.artifactDigest}:${authority.releaseDigest}`,
        releaseDigest: authority.releaseDigest,
      },
      now: () => Date.now(),
      observe: () => readStartupAdmissionObservation(page),
    });
    operation = "install-persistence-recorder";
    await installPersistenceRecorder(page);
    ownership.add({
      operation: "restore-persistence-recorder",
      run: async () => {
        if (persistenceRecorderCleared) return;
        await clearPersistenceRecorder(page);
        persistenceRecorderCleared = true;
      },
    });
    operation = "establish-startup-transition-baseline";
    await takeTransitions(page, transitionProof);
    operation = "read-initial-installer-snapshot";
    const snapshots: InstallerSnapshot[] = [await readInstallerSnapshot(page)];
    const attempts: InstallerTrustFaultCell["attempts"][number][] = [];

    if (requiresSeedInstall(id)) {
      currentAttempt = 1;
      currentPhase = "seed";
      operation = "select-seed-phase";
      await setTransitionPhase(page, transitionProof, currentPhase);
      await setPersistenceContext(page, {
        attempt: 1,
        operation: "install",
        phase: currentPhase,
      });
      operation = "start-seed-install";
      await click(page, "#installer-start");
      operation = "wait-for-seed-ready";
      await waitForStateWithPersistenceBarrier(
        page,
        "ready",
        INSTALLER_TRUST_FAULT_READY_TIMEOUT_MS,
        currentPhase,
        authority,
      );
      operation = "read-seed-ready-snapshot";
      snapshots.push(await readInstallerSnapshot(page));
      operation = "retain-seed-transitions";
      await takeTransitions(page, transitionProof);
      currentAttempt = 0;
      currentPhase = "setup";
      operation = "restore-setup-phase";
      await setTransitionPhase(page, transitionProof, currentPhase);
    }

    operation = "read-operation-baseline";
    const operationBaselineSnapshot = await readInstallerSnapshot(page);
    operation = "read-pre-operation-inventories";
    const mutationPre = await readScopedInventories(page, operationBaselineSnapshot);
    if (id === "reused-object-corruption" || id === "repeated-server-corruption") {
      operation = "corrupt-installed-object";
      await corruptInstalledObject(page, resource);
    }
    operation = "inject-fault";
    await injectFault(worker, page, {
      id,
      nonce,
      offset: faultOffset,
      operation: requiresSeedInstall(id) ? "repair" : "install",
      releaseDigest: authority.releaseDigest,
      resource,
    });

    if (id === "mid-append-quota-resume") {
      currentAttempt = 1;
      currentPhase = "attempt-1";
      operation = "select-attempt-1-phase";
      await setTransitionPhase(page, transitionProof, currentPhase);
      await setPersistenceContext(page, {
        attempt: 1,
        operation: "install",
        phase: currentPhase,
      });
      const retryBaseline = operationBaselineSnapshot.installerTransfer.retryCount;
      operation = "start-attempt-1";
      await click(page, "#installer-start");
      operation = "wait-for-attempt-1-failed";
      await waitForStateWithPersistenceBarrier(
        page,
        "failed",
        FAILURE_TIMEOUT_MS,
        currentPhase,
        authority,
      );
      const failed = await readUiFailure(page);
      const transitions1 = await takeTransitions(page, transitionProof);
      const failedSnapshot = await readInstallerSnapshot(page);
      attempts.push(
        attemptEvidence(
          1,
          "failed",
          failed.code,
          failed.resourceId,
          failed.action,
          transitions1,
          failedSnapshot.installerTransfer.retryCount - retryBaseline,
        ),
      );
      snapshots.push(failedSnapshot);
      currentAttempt = 2;
      currentPhase = "attempt-2";
      operation = "select-attempt-2-phase";
      await setTransitionPhase(page, transitionProof, currentPhase);
      await setPersistenceContext(page, {
        attempt: 2,
        operation: "install",
        phase: currentPhase,
      });
      const secondRetryBaseline = failedSnapshot.installerTransfer.retryCount;
      operation = "start-attempt-2";
      await click(page, "#installer-start");
      operation = "wait-for-attempt-2-ready";
      await waitForStateWithPersistenceBarrier(
        page,
        "ready",
        INSTALLER_TRUST_FAULT_READY_TIMEOUT_MS,
        currentPhase,
        authority,
      );
      const readySnapshot = await readInstallerSnapshot(page);
      attempts.push(
        attemptEvidence(
          2,
          "passed",
          null,
          null,
          "none",
          await takeTransitions(page, transitionProof),
          readySnapshot.installerTransfer.retryCount - secondRetryBaseline,
        ),
      );
    } else {
      currentAttempt = 1;
      currentPhase = "attempt-1";
      operation = "select-attempt-1-phase";
      await setTransitionPhase(page, transitionProof, currentPhase);
      await setPersistenceContext(page, {
        attempt: 1,
        operation: requiresSeedInstall(id) ? "repair" : "install",
        phase: currentPhase,
      });
      const retryBaseline = operationBaselineSnapshot.installerTransfer.retryCount;
      operation = "start-attempt-1";
      await click(page, requiresSeedInstall(id) ? "#installer-repair" : "#installer-start");
      const success = expectedSuccess(id);
      operation = success ? "wait-for-attempt-1-ready" : "wait-for-attempt-1-failed";
      await waitForStateWithPersistenceBarrier(
        page,
        success ? "ready" : "failed",
        success ? INSTALLER_TRUST_FAULT_READY_TIMEOUT_MS : FAILURE_TIMEOUT_MS,
        currentPhase,
        authority,
      );
      const failure = success ? null : await readUiFailure(page);
      const attemptSnapshot = await readInstallerSnapshot(page);
      attempts.push(
        attemptEvidence(
          1,
          success ? "passed" : "failed",
          failure?.code ?? null,
          failure?.resourceId ?? null,
          failure?.action ?? "none",
          await takeTransitions(page, transitionProof),
          attemptSnapshot.installerTransfer.retryCount - retryBaseline,
        ),
      );
    }
    operation = "read-terminal-evidence";
    const terminalSnapshot = await readInstallerSnapshot(page);
    snapshots.push(terminalSnapshot);
    const mutationPost = await readScopedInventories(page, terminalSnapshot);
    const diagnostics = await readDiagnostics(page);
    const http = buildHttpEvidence(journal);
    const faultEvents =
      id === "repeated-server-corruption"
        ? Object.freeze(serverFaultEvents)
        : await readAndClearFault(worker, page, id);
    if (id !== "repeated-server-corruption") hooksCleared = true;
    const persistence = await readAndClearPersistenceRecorder(page);
    persistenceRecorderCleared = true;
    const terminalPersistence = persistence.requests.at(-1);
    if (
      terminalPersistence === undefined ||
      diagnostics.ui.persistence !== terminalPersistence.terminalUiState
    ) {
      throw new Error(
        `Installer trust-fault terminal persistence UI differs; cell=${id}; diagnostic=${diagnostics.ui.persistence}; evidence=${terminalPersistence?.terminalUiState ?? "absent"}`,
      );
    }
    const postValidation = await postValidateCell(
      page,
      authority.artifactDigest,
      authority.releaseDigest,
      expectedSuccess(id),
      id,
      operationBaselineSnapshot,
      mutationPre,
      mutationPost,
    );
    const transfer = terminalSnapshot.installerTransfer;
    const baselineIndex =
      id === "mid-append-quota-resume" ? snapshots.length - 2 : requiresSeedInstall(id) ? 1 : 0;
    const baseline = snapshots[baselineIndex]?.installerTransfer;
    if (baseline === undefined) throw new Error("Installer cell counter baseline is absent");
    const lifetimeDownloadedBytes = transfer.downloadedBytes;
    const lifetimeCheckpointedBytes = transfer.checkpointedBytes;
    const downloadedBytes = Math.max(0, transfer.downloadedBytes - baseline.downloadedBytes);
    const firstAttemptCheckpoint =
      id === "mid-append-quota-resume"
        ? snapshots[1]?.installerTransfer.checkpointedBytes
        : undefined;
    const checkpointedBytes =
      id === "mid-append-quota-resume" && firstAttemptCheckpoint !== undefined
        ? Math.max(
            0,
            firstAttemptCheckpoint - (snapshots[0]?.installerTransfer.checkpointedBytes ?? 0),
          )
        : Math.max(0, transfer.checkpointedBytes - baseline.checkpointedBytes);
    const accounting = Object.freeze({
      checkpointedBytes,
      downloadedBytes,
      lifetimeCheckpointedBytes,
      lifetimeDownloadedBytes,
      readyBytes: expectedSuccess(id) ? transfer.totalBytes : 0,
      repairedBytes: transfer.operationRepairedBytes,
      repairedResourceCount: transfer.operationRepairedResourceCount,
      resumedBytes: Math.max(0, transfer.resumedBytes - baseline.resumedBytes),
      reusedBytes: transfer.reusedBytes,
      totalBytes: transfer.totalBytes,
    });
    observation = Object.freeze({
      accounting,
      attempts: Object.freeze(attempts),
      faultEvents,
      http,
      postValidation,
      persistence,
      snapshots: Object.freeze(snapshots),
      transitions: Object.freeze(await allTransitions(page, transitionProof)),
      warning: terminalPersistence.warning,
    });
  } catch (error: unknown) {
    if (
      error instanceof InstallerTrustProductTerminalError &&
      retainedPage !== null &&
      retainedTransitionProof !== null
    ) {
      try {
        primaryError = new InstallerTrustFaultCellTerminalEvidenceError(
          id,
          resource.id,
          error.projection,
          await allTransitions(retainedPage, retainedTransitionProof),
          error,
        );
      } catch (proofError: unknown) {
        primaryError = new AggregateError(
          [error, proofError],
          "Installer terminal mismatch and transition-proof capture both failed",
        );
      }
    } else {
      primaryError = error;
    }
  }
  await finishInstallerTrustFaultBrowserCell(
    ownership,
    primaryError,
    operation,
    retainedTransitionProof,
  );
  if (observation === null)
    throw new Error(`Installer trust-fault cell ${id} produced no evidence`);
  if (profileId === null) throw new Error("Installer trust-fault cell profile identity is absent");
  if (observation.faultEvents.length !== 1) {
    throw new Error(
      `Installer trust-fault cell ${id} consumed its nonce ${observation.faultEvents.length} times`,
    );
  }
  return Object.freeze({
    accounting: observation.accounting,
    attempts: observation.attempts,
    cleanup: {
      faultHooksCleared: hooksCleared as true,
      profileRemoved: profileRemoved as true,
      serverStopped: serverStopped as true,
    },
    completedAt: new Date().toISOString(),
    fault: {
      events: observation.faultEvents,
      kind: faultKind(id),
      nonce,
      offset: faultOffset,
      releaseDigest: authority.releaseDigest,
      resourceId: resource.id,
      useCount: 1 as const,
    },
    http: observation.http,
    httpSummary: Object.freeze({
      bodyBytes: observation.http.reduce((total, response) => total + response.bodyBytes, 0),
      responseCount: observation.http.length,
      sha256: createHash("sha256").update(JSON.stringify(observation.http)).digest("hex"),
    }),
    id,
    postValidation: observation.postValidation,
    persistence: observation.persistence,
    profileId,
    snapshots: observation.snapshots,
    startedAt,
    transitions: observation.transitions,
    warning: observation.warning,
  });
}

export function retainInstallerTrustFaultBrowserCellFailure(
  error: unknown,
  transitionProof: InstallerTrustFaultTransitionProofRecorder | null,
): void {
  if (error instanceof Error && transitionProof !== null) {
    transitionProof.retainFailure(error, "cell-invariant");
  }
}

export async function finishInstallerTrustFaultBrowserCell(
  ownership: InstallerTrustFaultOwnership,
  primaryError: unknown,
  operation: string,
  transitionProof: InstallerTrustFaultTransitionProofRecorder | null,
): Promise<void> {
  retainInstallerTrustFaultBrowserCellFailure(primaryError, transitionProof);
  await ownership.finish(primaryError === null ? null : { error: primaryError, operation });
}

function requiresSeedInstall(id: InstallerTrustFaultCellId): boolean {
  return (
    id === "reused-object-corruption" ||
    id === "final-verification-corruption" ||
    id === "repeated-server-corruption"
  );
}

function expectedSuccess(id: InstallerTrustFaultCellId): boolean {
  return (
    id === "reused-object-corruption" ||
    id === "final-verification-corruption" ||
    id === "estimate-incomplete-probe-success" ||
    id === "mid-append-quota-resume" ||
    id === "persistence-denied"
  );
}

async function prepareServingRoot(
  _repositoryRoot: string,
  build: ValidatedBuildManifest,
  servingRoot: string,
): Promise<void> {
  await cp(join(_repositoryRoot, "dist"), servingRoot, { recursive: true });
  const modelRoot = join(
    homedir(),
    ".parallax",
    "harness",
    "models",
    "gemma-4-E2B-it-qat-GGUF-66a399f6",
  );
  const immutableRoot = join(servingRoot, "immutable");
  await mkdir(immutableRoot, { recursive: true });
  for (const artifact of APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS) {
    const source = join(modelRoot, artifact.path);
    const sourceStat = await stat(source);
    if (!sourceStat.isFile() || sourceStat.size !== artifact.bytes) {
      throw new Error(`Installer trust-fault model fixture is invalid: ${artifact.path}`);
    }
    await link(source, join(immutableRoot, `model-${artifact.sha256}.gguf`));
  }
  if (build.installManifest.resources.length === 0) {
    throw new Error("Installer trust-fault build has no resources");
  }
}

async function installerWorker(page: Page, expectedUrl: string): Promise<Worker> {
  await page.waitForFunction(() => document.querySelector("#installer-shell") !== null);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const candidates = page.workers();
    if (candidates.some((candidate) => candidate.url() === expectedUrl)) {
      return selectExactInstallerWorker(candidates, expectedUrl);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return selectExactInstallerWorker(page.workers(), expectedUrl);
}

export class InstallerTrustFaultWorkerSelectionError extends Error {
  public constructor(
    public readonly expectedUrl: string,
    public readonly matchCount: number,
  ) {
    super(
      matchCount === 0
        ? "Manifest-declared installer worker did not become observable"
        : "Manifest-declared installer worker URL matched multiple realms",
    );
    this.name = "InstallerTrustFaultWorkerSelectionError";
  }
}

export function selectExactInstallerWorker<T extends Readonly<{ url(): string }>>(
  candidates: readonly T[],
  expectedUrl: string,
): T {
  const matches = candidates.filter((candidate) => candidate.url() === expectedUrl);
  if (matches.length !== 1) {
    throw new InstallerTrustFaultWorkerSelectionError(expectedUrl, matches.length);
  }
  const selected = matches[0];
  if (selected === undefined) {
    throw new InstallerTrustFaultWorkerSelectionError(expectedUrl, 0);
  }
  return selected;
}

async function injectFault(
  worker: Worker,
  page: Page,
  input: {
    readonly id: InstallerTrustFaultCellId;
    readonly nonce: string;
    readonly offset: number;
    readonly operation: "install" | "repair";
    readonly releaseDigest: string;
    readonly resource: InstallResource;
  },
): Promise<void> {
  if (input.id === "repeated-server-corruption") return;
  if (input.id === "persistence-denied") {
    await page.evaluate(
      ({ nonce, operation, releaseDigest, resourceId }) => {
        const state = (
          globalThis as unknown as {
            __parallaxTrustPersistenceV1?: InstallerTrustPersistenceRecorderState;
          }
        ).__parallaxTrustPersistenceV1;
        if (
          state === undefined ||
          nonce.length < 32 ||
          releaseDigest.length !== 64 ||
          resourceId === ""
        ) {
          throw new Error("Persistence fault token boundary mismatch");
        }
        state.configureDenial({ nonce, operation, releaseDigest, resourceId });
      },
      {
        nonce: input.nonce,
        operation: input.operation,
        releaseDigest: input.releaseDigest,
        resourceId: input.resource.id,
      },
    );
  }
  await worker.evaluate(
    async ({ checkpointBytes, fault, storeRoot }) => {
      const scope = globalThis as unknown as {
        __parallaxTrustFaultV1?: {
          count: number;
          events: Array<{
            nonce: string;
            offset: number;
            operation: "install" | "repair";
            order: number;
            releaseDigest: string;
            resourceId: string;
          }>;
          restore: () => void;
          token: typeof fault;
        };
      };
      if (scope.__parallaxTrustFaultV1 !== undefined) {
        throw new Error("Trust-fault token already installed");
      }
      const events: Array<{
        nonce: string;
        offset: number;
        operation: "install" | "repair";
        order: number;
        releaseDigest: string;
        resourceId: string;
      }> = [];
      const restorers: Array<() => void> = [];
      const consume = (resourceId: string, offset: number): void => {
        if (
          events.length !== 0 ||
          resourceId !== fault.resourceId ||
          offset !== fault.offset ||
          fault.releaseDigest.length !== 64 ||
          fault.nonce.length < 32
        ) {
          throw new Error("Trust-fault token boundary mismatch");
        }
        events.push({
          nonce: fault.nonce,
          offset,
          operation: fault.operation,
          order: 1,
          releaseDigest: fault.releaseDigest,
          resourceId,
        });
      };
      const replace = (owner: object, key: PropertyKey, value: unknown): void => {
        const descriptor = Object.getOwnPropertyDescriptor(owner, key);
        Object.defineProperty(owner, key, { configurable: true, value });
        restorers.push(() => {
          if (descriptor === undefined) delete (owner as Record<PropertyKey, unknown>)[key];
          else Object.defineProperty(owner, key, descriptor);
        });
      };
      if (fault.id === "estimate-clearly-insufficient") {
        replace(navigator.storage, "estimate", async () => {
          consume(fault.resourceId, fault.offset);
          return { quota: 1, usage: 1 };
        });
      } else if (fault.id === "estimate-incomplete-probe-success") {
        replace(navigator.storage, "estimate", async () => {
          consume(fault.resourceId, fault.offset);
          return {};
        });
      } else if (fault.id === "quota-probe-exceeded" || fault.id === "mid-append-quota-resume") {
        const root = await navigator.storage.getDirectory();
        const sample = await root.getFileHandle(".parallax-trust-fault-prototype", {
          create: true,
        });
        const prototype = Object.getPrototypeOf(sample) as {
          createSyncAccessHandle: (this: FileSystemFileHandle) => Promise<{
            close(): void;
            flush(): void;
            getSize(): number;
            truncate(bytes: number): void;
            write(bytes: Uint8Array, options: { at: number }): number;
          }>;
        };
        const original = prototype.createSyncAccessHandle;
        replace(prototype, "createSyncAccessHandle", async function (this: FileSystemFileHandle) {
          const name = this.name;
          const access = await original.call(this);
          const originalWrite = access.write.bind(access);
          return {
            close: access.close.bind(access),
            flush: access.flush.bind(access),
            getSize: access.getSize.bind(access),
            truncate: access.truncate.bind(access),
            write(bytes: Uint8Array, options: { at: number }): number {
              const shouldFail =
                (fault.id === "quota-probe-exceeded" &&
                  name === "quota-probe.bin" &&
                  options.at === 0) ||
                (fault.id === "mid-append-quota-resume" &&
                  name === "data.partial" &&
                  options.at === checkpointBytes);
              if (shouldFail && events.length === 0) {
                consume(fault.resourceId, fault.offset);
                throw new DOMException("Harness-injected quota boundary", "QuotaExceededError");
              }
              return originalWrite(bytes, options);
            },
          };
        });
        await root.removeEntry(".parallax-trust-fault-prototype");
      } else if (fault.id === "final-verification-corruption") {
        const root = await navigator.storage.getDirectory();
        const namespace = fault.scope === "common" ? "common" : "games/parallax";
        let directory = await root.getDirectoryHandle(storeRoot);
        for (const segment of [
          "objects",
          ...namespace.split("/"),
          "sha256",
          fault.sha256.slice(0, 2),
        ]) {
          directory = await directory.getDirectoryHandle(segment);
        }
        const target = await directory.getFileHandle(`${fault.sha256}.data`);
        const targetFile = await target.getFile();
        const prototype = Object.getPrototypeOf(targetFile) as {
          slice: (this: File, start?: number, end?: number, contentType?: string) => Blob;
        };
        const original = prototype.slice;
        replace(
          prototype,
          "slice",
          function (this: File, start?: number, end?: number, contentType?: string) {
            const blob = original.call(this, start, end, contentType);
            if (this.name !== `${fault.sha256}.data` || events.length !== 0) return blob;
            const originalArrayBuffer = blob.arrayBuffer.bind(blob);
            return new Proxy(blob, {
              get(targetBlob, property) {
                if (property === "arrayBuffer") {
                  return async () => {
                    const bytes = await originalArrayBuffer();
                    const current = await target.getFile();
                    const first = new Uint8Array(await original.call(current, 0, 1).arrayBuffer());
                    const writable = await target.createWritable({ keepExistingData: true });
                    await writable.write({
                      data: new Uint8Array([(first[0] ?? 0) ^ 0xff]),
                      position: 0,
                      type: "write",
                    });
                    await writable.close();
                    consume(fault.resourceId, 0);
                    return bytes;
                  };
                }
                const value = Reflect.get(targetBlob, property, targetBlob);
                return typeof value === "function" ? value.bind(targetBlob) : value;
              },
            });
          },
        );
      } else if (fault.id === "reused-object-corruption") {
        const root = await navigator.storage.getDirectory();
        const namespace = fault.scope === "common" ? "common" : "games/parallax";
        let directory = await root.getDirectoryHandle(storeRoot);
        for (const segment of [
          "objects",
          ...namespace.split("/"),
          "sha256",
          fault.sha256.slice(0, 2),
        ]) {
          directory = await directory.getDirectoryHandle(segment);
        }
        const target = await directory.getFileHandle(`${fault.sha256}.data`);
        const targetFile = await target.getFile();
        const prototype = Object.getPrototypeOf(targetFile) as {
          slice: (this: File, start?: number, end?: number, contentType?: string) => Blob;
        };
        const original = prototype.slice;
        replace(
          prototype,
          "slice",
          function (this: File, start?: number, end?: number, contentType?: string) {
            if (this.name === `${fault.sha256}.data` && events.length === 0) {
              consume(fault.resourceId, 0);
            }
            return original.call(this, start, end, contentType);
          },
        );
      } else if (fault.id === "persistence-denied") {
        // The main-realm wrapper owns consumption; the worker token remains present
        // so cleanup can prove no production worker hook was used.
      }
      scope.__parallaxTrustFaultV1 = {
        get count() {
          return events.length;
        },
        get events() {
          return events;
        },
        restore: () => {
          for (const restore of restorers.reverse()) restore();
        },
        token: fault,
      };
    },
    {
      checkpointBytes: INSTALLER_TRUST_FAULT_CHECKPOINT_BYTES,
      fault: {
        id: input.id,
        nonce: input.nonce,
        offset: input.offset,
        operation: input.operation,
        releaseDigest: input.releaseDigest,
        resourceId: input.resource.id,
        scope: input.resource.scope,
        sha256: input.resource.sha256,
        source: input.resource.source,
      },
      storeRoot: INSTALL_STORE_ROOT,
    },
  );
}

async function readAndClearFault(
  worker: Worker,
  page: Page,
  id: InstallerTrustFaultCellId,
): Promise<InstallerTrustFaultCell["fault"]["events"]> {
  const workerEvents = await worker.evaluate(() => {
    const scope = globalThis as unknown as {
      __parallaxTrustFaultV1?: {
        events: InstallerTrustFaultCell["fault"]["events"];
        restore: () => void;
      };
    };
    const state = scope.__parallaxTrustFaultV1;
    if (state === undefined) throw new Error("Trust-fault token is absent");
    state.restore();
    delete scope.__parallaxTrustFaultV1;
    return structuredClone(state.events);
  });
  if (id !== "persistence-denied") return Object.freeze(workerEvents);
  if (workerEvents.length !== 0) {
    throw new Error("Persistence denial unexpectedly consumed a worker-realm fault token");
  }
  return page.evaluate(() => {
    const state = (
      globalThis as unknown as {
        __parallaxTrustPersistenceV1?: InstallerTrustPersistenceRecorderState;
      }
    ).__parallaxTrustPersistenceV1;
    if (state === undefined) throw new Error("Persistence fault token is absent");
    return structuredClone(state.faultEvents);
  });
}

async function corruptInstalledObject(page: Page, resource: InstallResource): Promise<void> {
  await page.evaluate(
    async ({ bytes, rootName, scope, sha256 }) => {
      let directory = await navigator.storage.getDirectory();
      const namespace = scope === "common" ? ["common"] : ["games", "parallax"];
      for (const segment of [rootName, "objects", ...namespace, "sha256", sha256.slice(0, 2)]) {
        directory = await directory.getDirectoryHandle(segment);
      }
      const handle = await directory.getFileHandle(`${sha256}.data`);
      const file = await handle.getFile();
      if (file.size !== bytes) throw new Error("Corruption target size changed");
      const first = new Uint8Array(await file.slice(0, 1).arrayBuffer());
      const writable = await handle.createWritable({ keepExistingData: true });
      await writable.write({
        data: new Uint8Array([(first[0] ?? 0) ^ 0xff]),
        position: 0,
        type: "write",
      });
      await writable.close();
      if ((await handle.getFile()).size !== bytes) {
        throw new Error("Same-size corruption changed object length");
      }
    },
    {
      bytes: resource.bytes,
      rootName: INSTALL_STORE_ROOT,
      scope: resource.scope,
      sha256: resource.sha256,
    },
  );
}

async function installSentinelsAndTransitionRecorder(
  page: Page,
  id: InstallerTrustFaultCellId,
  authority: InstallerTrustFaultAuthority,
): Promise<void> {
  await page.evaluate(
    async ({ bytes }) => {
      const root = await navigator.storage.getDirectory();
      for (const [directoryName, fileName] of [
        ["parallax-saves", "trust-sentinel.bin"],
        ["external-trust-root", "trust-sentinel.bin"],
      ] as const) {
        const directory = await root.getDirectoryHandle(directoryName, { create: true });
        const writable = await (
          await directory.getFileHandle(fileName, { create: true })
        ).createWritable();
        await writable.write(new Uint8Array(bytes));
        await writable.close();
      }
    },
    { bytes: [...SENTINEL_BYTES] },
  );
  await page.evaluate(installInstallerTrustTransitionRecorderInPage, {
    expectedRepairAuthority:
      id === "repeated-server-corruption"
        ? {
            releaseDigest: authority.releaseDigest,
            shellGenerationId: `${authority.artifactDigest}:${authority.releaseDigest}`,
          }
        : null,
  });
}

async function installPersistenceRecorder(page: Page): Promise<void> {
  await page.evaluate(installInstallerTrustPersistenceRecorderInPage, {
    observerTimeoutMs: PERSISTENCE_OBSERVER_TIMEOUT_MS,
    warningText: DEGRADED_DURABILITY_WARNING,
  });
}

export async function installInstallerTrustPersistenceRecorderInPage(input: {
  readonly observerTimeoutMs: number;
  readonly warningText: string;
}): Promise<void> {
  if (
    !Number.isSafeInteger(input.observerTimeoutMs) ||
    input.observerTimeoutMs < 1 ||
    input.observerTimeoutMs > 120_000
  ) {
    throw new Error("Installer persistence observer timeout is invalid");
  }
  const storage = navigator.storage;
  const initialPersisted = await storage.persisted();
  const ownDescriptor = Object.getOwnPropertyDescriptor(storage, "persist");
  const original = storage.persist;
  const panel = document.querySelector("#installer-shell");
  const warning = document.querySelector("#installer-warning");
  if (
    typeof initialPersisted !== "boolean" ||
    typeof original !== "function" ||
    !(panel instanceof HTMLElement) ||
    !(warning instanceof HTMLElement)
  ) {
    throw new Error("Installer persistence recorder boundary is unavailable");
  }
  type Context = Readonly<{
    attempt: 1 | 2;
    callStartIndex: number;
    operation: "install" | "repair";
    phase: "attempt-1" | "attempt-2" | "seed";
  }>;
  type Denial = Readonly<{
    nonce: string;
    operation: "install" | "repair";
    releaseDigest: string;
    resourceId: string;
  }>;
  type ObserverState =
    | "after-probe-rejected"
    | "boundary-invalid"
    | "non-boolean-result"
    | "pending"
    | "platform-rejected"
    | "resolved";
  interface ObserverCall {
    readonly activeDenial: Denial | null;
    readonly callOrder: number;
    readonly context: Context | null;
    readonly persistedBefore: boolean;
    readonly sideObserver: Promise<void>;
    boundaryInvalid: boolean;
    persistedAfter: boolean | null;
    result: boolean | null;
    settleOrder: number | null;
    state: ObserverState;
  }
  const requests: InstallerTrustFaultCell["persistence"]["requests"][number][] = [];
  const faultEvents: InstallerTrustFaultCell["fault"]["events"][number][] = [];
  const observerCalls: ObserverCall[] = [];
  let current: Context | null = null;
  let persistedBefore = initialPersisted;
  let denial: Denial | null = null;
  let denialConsumed = false;
  let observerTail: Promise<void> = Promise.resolve();
  let settleOrder = 0;
  let restored = false;
  const observerError = (kind: string, detail: string): Error => {
    const error = new Error(`Installer persistence observer ${kind}; ${detail}`);
    error.name = "InstallerTrustPersistenceObserverError";
    return error;
  };
  const restore = (): void => {
    if (restored) return;
    restored = true;
    if (ownDescriptor === undefined) {
      delete (storage as unknown as Record<string, unknown>).persist;
    } else {
      Object.defineProperty(storage, "persist", ownDescriptor);
    }
  };
  const state: InstallerTrustPersistenceRecorderState = {
    clear: restore,
    configureDenial(denialInput) {
      if (denial !== null || denialConsumed || faultEvents.length !== 0) {
        throw new Error("Installer persistence denial token is already configured");
      }
      denial = Object.freeze({ ...denialInput });
    },
    get diagnostics() {
      return Object.freeze(
        observerCalls.map((call) =>
          Object.freeze({
            callOrder: call.callOrder,
            phase: call.context?.phase ?? null,
            settleOrder: call.settleOrder,
            state: call.boundaryInvalid ? "boundary-invalid" : call.state,
          }),
        ),
      );
    },
    get evidence() {
      return Object.freeze({
        initialPersisted,
        requests: Object.freeze(requests.map((request) => Object.freeze({ ...request }))),
      });
    },
    get faultEvents() {
      return Object.freeze(faultEvents.map((event) => Object.freeze({ ...event })));
    },
    async finalize(phase) {
      const context = current;
      if (context?.phase !== phase) {
        throw observerError(
          "context-mismatch",
          `phase=${phase}; active=${context?.phase ?? "absent"}`,
        );
      }
      const calls = observerCalls.slice(context.callStartIndex);
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const timeout = new Promise<"timeout">((resolveTimeout) => {
        timeoutId = setTimeout(() => resolveTimeout("timeout"), input.observerTimeoutMs);
      });
      const settled = await Promise.race([observerTail.then(() => "settled" as const), timeout]);
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (settled === "timeout") {
        const pendingOrders = calls
          .filter((call) => call.state === "pending")
          .map((call) => call.callOrder)
          .join(",");
        throw observerError(
          "timeout",
          `phase=${phase}; calls=${calls.length}; pending=${pendingOrders || "none"}`,
        );
      }
      if (calls.length !== 1) {
        throw observerError(
          "call-count",
          `phase=${phase}; expected=1; actual=${calls.length}; orders=${calls
            .map((call) => call.callOrder)
            .join(",")}`,
        );
      }
      const call = calls[0];
      if (call === undefined) {
        throw observerError("call-absent", `phase=${phase}`);
      }
      if (call.boundaryInvalid) {
        throw observerError(
          "boundary-invalid",
          `phase=${phase}; call=${call.callOrder}; ui=${panel.dataset.persistence ?? "absent"}`,
        );
      }
      if (
        call.state !== "resolved" ||
        call.context === null ||
        call.result === null ||
        call.persistedAfter === null
      ) {
        throw observerError(
          call.state,
          `phase=${phase}; call=${call.callOrder}; settle=${call.settleOrder ?? "absent"}`,
        );
      }
      const terminalUiState = panel.dataset.persistence;
      const terminalWarning =
        warning.hidden && warning.textContent === ""
          ? null
          : !warning.hidden && warning.textContent === input.warningText
            ? ("degraded-durability" as const)
            : "invalid";
      if (
        (terminalUiState !== "denied" && terminalUiState !== "granted") ||
        terminalWarning === "invalid" ||
        (terminalUiState === "denied") !== (terminalWarning === "degraded-durability")
      ) {
        throw observerError(
          "ui-contradiction",
          `phase=${phase}; state=${terminalUiState ?? "absent"}; warning=${terminalWarning}`,
        );
      }
      requests.push(
        Object.freeze({
          attempt: call.context.attempt,
          classification: call.result
            ? call.persistedBefore
              ? "already-persisted"
              : "granted"
            : "denied",
          operation: call.context.operation,
          order: requests.length + 1,
          persistedAfter: call.persistedAfter,
          persistedBefore: call.persistedBefore,
          phase: call.context.phase,
          requestedUiState: "requesting",
          result: call.result,
          terminalUiState,
          warning: terminalWarning,
        }),
      );
      persistedBefore = call.persistedAfter;
      if (call.activeDenial !== null) {
        faultEvents.push(
          Object.freeze({
            nonce: call.activeDenial.nonce,
            offset: 0,
            operation: call.activeDenial.operation,
            order: 1,
            releaseDigest: call.activeDenial.releaseDigest,
            resourceId: call.activeDenial.resourceId,
          }),
        );
      }
      current = null;
    },
    restore,
    setContext(contextInput) {
      if (current !== null) {
        throw new Error("Installer persistence operation context overlaps");
      }
      current = Object.freeze({
        ...contextInput,
        callStartIndex: observerCalls.length,
      });
    },
  };
  Object.defineProperty(storage, "persist", {
    configurable: true,
    value: () => {
      const context = current;
      const callOrder = observerCalls.length + 1;
      const boundaryInvalid = context === null || panel.dataset.persistence !== "requesting";
      const activeDenial =
        context !== null &&
        denial !== null &&
        !denialConsumed &&
        denial.operation === context.operation
          ? denial
          : null;
      if (activeDenial !== null) denialConsumed = true;
      let returned: Promise<boolean>;
      try {
        returned =
          activeDenial === null ? Reflect.apply(original, storage, []) : Promise.resolve(false);
      } catch (error: unknown) {
        const rejectedCall: ObserverCall = {
          activeDenial,
          boundaryInvalid,
          callOrder,
          context,
          persistedAfter: null,
          persistedBefore,
          result: null,
          settleOrder: ++settleOrder,
          sideObserver: Promise.resolve(),
          state: "platform-rejected",
        };
        observerCalls.push(rejectedCall);
        throw error;
      }
      const mutableCall: Omit<ObserverCall, "sideObserver"> = {
        activeDenial,
        boundaryInvalid,
        callOrder,
        context,
        persistedAfter: null,
        persistedBefore,
        result: null,
        settleOrder: null,
        state: "pending" as ObserverState,
      };
      const sideObserver = Promise.resolve(returned)
        .then(
          (result: unknown) => {
            mutableCall.settleOrder = ++settleOrder;
            if (typeof result !== "boolean") {
              mutableCall.state = "non-boolean-result";
              return;
            }
            mutableCall.result = result;
            let afterProbe: Promise<boolean>;
            try {
              afterProbe = Promise.resolve(storage.persisted());
            } catch {
              mutableCall.state = "after-probe-rejected";
              return;
            }
            return afterProbe.then(
              (after: unknown) => {
                if (typeof after !== "boolean") {
                  mutableCall.state = "after-probe-rejected";
                  return;
                }
                mutableCall.persistedAfter = after;
                mutableCall.state = "resolved";
              },
              () => {
                mutableCall.state = "after-probe-rejected";
              },
            );
          },
          () => {
            mutableCall.settleOrder = ++settleOrder;
            mutableCall.state = "platform-rejected";
          },
        )
        .then(
          () => undefined,
          () => {
            mutableCall.state = "after-probe-rejected";
          },
        );
      const call: ObserverCall = Object.assign(mutableCall, { sideObserver });
      observerCalls.push(call);
      observerTail = Promise.all([observerTail, sideObserver]).then(() => undefined);
      return returned;
    },
  });
  (
    globalThis as unknown as {
      __parallaxTrustPersistenceV1?: InstallerTrustPersistenceRecorderState;
    }
  ).__parallaxTrustPersistenceV1 = state;
}

async function setPersistenceContext(
  page: Page,
  context: Readonly<{
    readonly attempt: 1 | 2;
    readonly operation: "install" | "repair";
    readonly phase: Exclude<TrustPhase, "setup">;
  }>,
): Promise<void> {
  await page.evaluate((input) => {
    const state = (
      globalThis as unknown as {
        __parallaxTrustPersistenceV1?: InstallerTrustPersistenceRecorderState;
      }
    ).__parallaxTrustPersistenceV1;
    if (state === undefined) throw new Error("Installer persistence recorder is absent");
    state.setContext(input);
  }, context);
}

async function finalizePersistenceContext(
  page: Page,
  phase: Exclude<TrustPhase, "setup">,
): Promise<void> {
  await page.evaluate(async (currentPhase) => {
    const state = (
      globalThis as unknown as {
        __parallaxTrustPersistenceV1?: InstallerTrustPersistenceRecorderState;
      }
    ).__parallaxTrustPersistenceV1;
    if (state === undefined) throw new Error("Installer persistence recorder is absent");
    await state.finalize(currentPhase);
  }, phase);
}

async function waitForStateWithPersistenceBarrier(
  page: Page,
  expected: "failed" | "ready",
  timeoutMs: number,
  phase: Exclude<TrustPhase, "setup">,
  authority: InstallerTrustProductTerminalAuthority,
): Promise<void> {
  let productFailure: unknown = null;
  try {
    await waitForState(page, expected, timeoutMs, authority);
  } catch (error: unknown) {
    productFailure = error;
  }
  let observerFailure: unknown = null;
  try {
    await finalizePersistenceContext(page, phase);
  } catch (error: unknown) {
    observerFailure = error;
  }
  throwInstallerTrustWaitFailures(productFailure, observerFailure);
}

export function throwInstallerTrustWaitFailures(
  productFailure: unknown | null,
  observerFailure: unknown | null,
): void {
  if (productFailure !== null && observerFailure !== null) {
    throw new AggregateError(
      [productFailure, observerFailure],
      "Installer product outcome and persistence observer both failed",
    );
  }
  if (productFailure !== null) throw productFailure;
  if (observerFailure !== null) throw observerFailure;
}

async function readAndClearPersistenceRecorder(
  page: Page,
): Promise<InstallerTrustFaultCell["persistence"]> {
  return page.evaluate(() => {
    const scope = globalThis as unknown as {
      __parallaxTrustPersistenceV1?: InstallerTrustPersistenceRecorderState;
    };
    const state = scope.__parallaxTrustPersistenceV1;
    if (state === undefined) throw new Error("Installer persistence recorder is absent");
    const evidence = structuredClone(state.evidence);
    state.restore();
    delete scope.__parallaxTrustPersistenceV1;
    return evidence;
  });
}

async function clearPersistenceRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = globalThis as unknown as {
      __parallaxTrustPersistenceV1?: InstallerTrustPersistenceRecorderState;
    };
    scope.__parallaxTrustPersistenceV1?.clear();
    delete scope.__parallaxTrustPersistenceV1;
  });
}

export async function installInstallerTrustTransitionRecorderInPage(input: {
  readonly expectedRepairAuthority: Readonly<{
    readonly releaseDigest: string;
    readonly shellGenerationId: string;
  }> | null;
}): Promise<void> {
  if (
    input.expectedRepairAuthority !== null &&
    (!/^[a-f0-9]{64}$/u.test(input.expectedRepairAuthority.releaseDigest) ||
      !/^[a-f0-9]{64}:[a-f0-9]{64}$/u.test(input.expectedRepairAuthority.shellGenerationId))
  ) {
    throw new Error("Installer transition expected Repair authority is invalid");
  }
  const panel = document.querySelector("#installer-shell");
  if (!(panel instanceof HTMLElement)) throw new Error("Installer panel is absent");
  const scope = globalThis as unknown as {
    __parallaxInstallerDiagnosticsV1?: () => {
      installer: InstallerSnapshot;
    };
    __parallaxTrustTransitions?: InstallerTrustTransitionQueueState;
  };
  let accepting = true;
  let current: InstallerTrustFaultTransition[] = [];
  let currentRaw: InstallerTrustFaultRawObservation[] = [];
  let nextOrder = 1;
  let phase: TrustPhase = "setup";
  let captureFailed = false;
  const capture = (eventPhase: TrustPhase): InstallerTrustFaultRawObservation | null => {
    if (!accepting) return null;
    const transferState = panel.dataset.transferState ?? "";
    const storeState = panel.dataset.storeState ?? "";
    const uiState = panel.dataset.state ?? "";
    if (transferState === "" || storeState === "" || uiState === "") return null;
    const diagnostics = scope.__parallaxInstallerDiagnosticsV1?.();
    const liveTelemetry = diagnostics?.installer;
    const rawTelemetry: InstallerTrustFaultRawTelemetry | undefined =
      liveTelemetry === undefined
        ? undefined
        : structuredClone({
            installStore: {
              activeReleaseDigest: liveTelemetry.installStore.activeReleaseDigest,
              state: liveTelemetry.installStore.state,
            },
            installerTransfer: {
              activeReleaseDigest: liveTelemetry.installerTransfer.activeReleaseDigest,
              failureCode: liveTelemetry.installerTransfer.failureCode,
              failureClass: liveTelemetry.installerTransfer.failureClass,
              failureEvidence: liveTelemetry.installerTransfer.failureEvidence,
              failureExpectedReleaseDigest:
                liveTelemetry.installerTransfer.failureExpectedReleaseDigest,
              failureMessage: liveTelemetry.installerTransfer.failureMessage,
              failureOperation: liveTelemetry.installerTransfer.failureOperation,
              failureResourceId: liveTelemetry.installerTransfer.failureResourceId,
              failureSource: liveTelemetry.installerTransfer.failureSource,
              state: liveTelemetry.installerTransfer.state,
            },
          });
    const rawPersistence = panel.dataset.persistence;
    const hasPersistence =
      rawPersistence === "denied" ||
      rawPersistence === "failed" ||
      rawPersistence === "granted" ||
      rawPersistence === "not-requested" ||
      rawPersistence === "requesting";
    if (rawTelemetry === undefined || !hasPersistence) {
      throw new Error("Installer transition raw observation is unavailable");
    }
    const event: InstallerTrustFaultTransition = {
      activeReleaseDigest: rawTelemetry.installStore.activeReleaseDigest ?? null,
      failureCode:
        panel.dataset.failureCode === undefined || panel.dataset.failureCode === ""
          ? null
          : (panel.dataset.failureCode as InstallerTrustFaultTransition["failureCode"]),
      failureResourceId: panel.dataset.failureResourceId || null,
      order: nextOrder,
      phase: eventPhase,
      releaseDigest: panel.dataset.releaseDigest || null,
      shellGenerationId: panel.dataset.shellGenerationId || null,
      storeState: storeState as InstallerTrustFaultStoreState,
      transferState: transferState as InstallerTrustFaultTransferState,
      uiState: uiState as InstallerTrustFaultUiState,
    };
    nextOrder += 1;
    return Object.freeze({
      degradedDurabilityWarning: rawPersistence === "denied",
      persistence: rawPersistence,
      telemetry: rawTelemetry,
      transition: event,
    });
  };
  const enqueueCapture = (eventPhase: TrustPhase): void => {
    try {
      const observation = capture(eventPhase);
      if (observation === null) return;
      current.push(observation.transition);
      currentRaw.push(observation);
    } catch {
      captureFailed = true;
    }
  };
  const listener = (): void => enqueueCapture(phase);
  const barrier = (
    kind: InstallerTrustTransitionBarrierKind,
    nextPhase?: TrustPhase,
  ): InstallerTrustTransitionBatch => {
    if (
      (kind === "phase" &&
        nextPhase !== "attempt-1" &&
        nextPhase !== "attempt-2" &&
        nextPhase !== "seed" &&
        nextPhase !== "setup") ||
      (kind !== "phase" && nextPhase !== undefined)
    ) {
      throw new Error("Installer transition barrier request is invalid");
    }
    if (kind === "seal") {
      accepting = false;
      panel.removeEventListener("parallax-installer-state", listener);
    }
    if (captureFailed) {
      const error = new Error("Installer transition capture failed");
      error.name = "InstallerTrustTransitionCaptureError";
      throw error;
    }
    const closed = current;
    const closedRaw = currentRaw;
    current = [];
    currentRaw = [];
    if (kind === "phase") phase = nextPhase as TrustPhase;
    return Object.freeze({
      rawObservations: Object.freeze([...closedRaw]),
      transitions: Object.freeze([...closed]),
    });
  };
  const state: InstallerTrustTransitionQueueState = {
    barrier,
    get nextOrder() {
      return nextOrder;
    },
    get phase() {
      return phase;
    },
  };
  enqueueCapture(phase);
  panel.addEventListener("parallax-installer-state", listener);
  scope.__parallaxTrustTransitions = state;
}

async function postValidateCell(
  page: Page,
  artifactDigest: string,
  releaseDigest: string,
  success: boolean,
  id: InstallerTrustFaultCellId,
  initialSnapshot: InstallerSnapshot,
  mutationPre: Readonly<
    Record<InstallerTrustFaultMutationScope, InstallerTrustFaultScopedInventory>
  >,
  mutationPost: Readonly<
    Record<InstallerTrustFaultMutationScope, InstallerTrustFaultScopedInventory>
  >,
): Promise<InstallerTrustFaultCell["postValidation"]> {
  const value = await page.evaluate(
    async ({ expectedBytes }) => {
      const root = await navigator.storage.getDirectory();
      const digest = async (directoryName: string): Promise<string> => {
        const directory = await root.getDirectoryHandle(directoryName);
        const file = await (await directory.getFileHandle("trust-sentinel.bin")).getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (
          bytes.length !== expectedBytes.length ||
          bytes.some((byte, index) => byte !== expectedBytes[index])
        ) {
          throw new Error("Sentinel bytes changed");
        }
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      };
      const diagnostics = (
        globalThis as unknown as {
          __parallaxInstallerDiagnosticsV1?: () => {
            installer: InstallerSnapshot;
            ui: {
              releaseDigest: string | null;
              shellGenerationId: string | null;
              state: string;
            };
          };
        }
      ).__parallaxInstallerDiagnosticsV1?.();
      const launch = document.querySelector("#installer-launch");
      if (diagnostics === undefined || !(launch instanceof HTMLButtonElement)) {
        throw new Error("Installer post-validation surface is absent");
      }
      return {
        activeReleaseDigest: diagnostics.installer.installStore.activeReleaseDigest,
        launchEnabled: !launch.disabled,
        previousReleaseDigest: diagnostics.installer.installStore.previousReleaseDigest,
        publicationCount: diagnostics.installer.installStore.publicationCount,
        saveSentinelSha256: await digest("parallax-saves"),
        externalRootSentinelSha256: await digest("external-trust-root"),
        uiReleaseDigest: diagnostics.ui.releaseDigest,
        uiShellGenerationId: diagnostics.ui.shellGenerationId,
        uiState: diagnostics.ui.state,
      };
    },
    { expectedBytes: [...SENTINEL_BYTES] },
  );
  if (
    value.saveSentinelSha256 !== SENTINEL_SHA256 ||
    value.externalRootSentinelSha256 !== SENTINEL_SHA256 ||
    (success &&
      (value.activeReleaseDigest !== releaseDigest ||
        value.uiReleaseDigest !== releaseDigest ||
        value.uiShellGenerationId !== `${artifactDigest}:${releaseDigest}` ||
        value.uiState !== "ready" ||
        value.launchEnabled !== true)) ||
    (!success &&
      (value.uiReleaseDigest !== null ||
        value.uiShellGenerationId !== null ||
        value.uiState !== "failed" ||
        value.launchEnabled !== false))
  ) {
    throw new Error("Installer post-validation authority or sentinel changed");
  }
  const declaredMutableScopes: readonly InstallerTrustFaultMutationScope[] = success
    ? ["indexeddb", "install-root", "selection", "shell-cache"]
    : id === "repeated-server-corruption"
      ? ["install-root", "selection"]
      : ["install-root"];
  const unexpectedChangedScopes = (Object.keys(mutationPre) as InstallerTrustFaultMutationScope[])
    .filter(
      (scope) =>
        mutationPre[scope].sha256 !== mutationPost[scope].sha256 &&
        !declaredMutableScopes.includes(scope),
    )
    .sort();
  return Object.freeze({
    activeReleaseDigest: value.activeReleaseDigest,
    externalRootSentinelSha256: value.externalRootSentinelSha256,
    launchEnabled: value.launchEnabled,
    operationInitialActiveReleaseDigest: initialSnapshot.installStore.activeReleaseDigest,
    operationInitialPreviousReleaseDigest: initialSnapshot.installStore.previousReleaseDigest,
    operationInitialPublicationCount: initialSnapshot.installStore.publicationCount,
    mutationEvidence: Object.freeze({
      declaredMutableScopes: Object.freeze([...declaredMutableScopes]),
      post: mutationPost,
      pre: mutationPre,
      unexpectedChangedScopes: Object.freeze(unexpectedChangedScopes),
    }),
    previousReleaseDigest: value.previousReleaseDigest,
    publicationOccurred: value.publicationCount > initialSnapshot.installStore.publicationCount,
    saveSentinelSha256: value.saveSentinelSha256,
    targetReleaseDigest: releaseDigest,
    terminalPublicationCount: value.publicationCount,
    uiReleaseDigest: value.uiReleaseDigest,
    uiShellGenerationId: value.uiShellGenerationId,
  });
}

async function readScopedInventories(
  page: Page,
  selectionSnapshot: InstallerSnapshot,
): Promise<Readonly<Record<InstallerTrustFaultMutationScope, InstallerTrustFaultScopedInventory>>> {
  const raw = await page.evaluate(
    async ({ installRoot }) => {
      const root = await navigator.storage.getDirectory();
      const hex = (bytes: ArrayBuffer): string =>
        [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      let installMetadataBytes = 0;
      const fileEntries = async (
        directoryName: string | null,
        digestMode: "all" | "install-metadata",
        excludedRootNames: readonly string[] = [],
      ): Promise<string[]> => {
        let directory: FileSystemDirectoryHandle;
        if (directoryName === null) {
          directory = root;
        } else {
          try {
            directory = await root.getDirectoryHandle(directoryName);
          } catch (error: unknown) {
            if (error instanceof DOMException && error.name === "NotFoundError") return [];
            throw error;
          }
        }
        const entries: string[] = [];
        const walk = async (current: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
          const iterable = current as FileSystemDirectoryHandle & {
            entries(): AsyncIterableIterator<
              [string, FileSystemDirectoryHandle | FileSystemFileHandle]
            >;
          };
          for await (const [name, handle] of iterable.entries()) {
            if (prefix === "" && excludedRootNames.includes(name)) continue;
            const path = prefix === "" ? name : `${prefix}/${name}`;
            if (handle.kind === "directory") {
              entries.push(`d:${path}`);
              await walk(handle, path);
            } else {
              const file = await handle.getFile();
              const installMetadata =
                /^commits\/[0-9]{20}-[a-f0-9]{64}\.json$/u.test(path) ||
                /^objects\/(?:common|games\/parallax)\/sha256\/[a-f0-9]{2}\/[a-f0-9]{64}\.verified\.json$/u.test(
                  path,
                ) ||
                /^partials\/[a-f0-9]{64}\/[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?\/checkpoints\/[0-9]{20}\.json$/u.test(
                  path,
                ) ||
                /^releases\/[a-f0-9]{64}\/(?:abandoned|published|ready|repair-eligibility|staged)\.json$/u.test(
                  path,
                );
              if (installMetadata && file.size > 1024 * 1024) {
                throw new Error("Install-store metadata file exceeds the bounded inventory limit");
              }
              if (installMetadata) {
                installMetadataBytes += file.size;
                if (installMetadataBytes > 16 * 1024 * 1024) {
                  throw new Error(
                    "Install-store metadata inventory exceeds the bounded aggregate limit",
                  );
                }
              }
              const digest =
                digestMode === "all" || (digestMode === "install-metadata" && installMetadata)
                  ? `:${hex(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))}`
                  : "";
              entries.push(`f:${path}:${file.size}${digest}`);
            }
          }
        };
        await walk(directory, "");
        return entries.sort();
      };
      const cacheEntries: string[] = [];
      for (const name of (await caches.keys()).sort()) {
        cacheEntries.push(`cache:${name}`);
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          cacheEntries.push(`request:${name}:${request.method}:${request.url}`);
        }
      }
      cacheEntries.sort();
      const databaseEntries = (await indexedDB.databases())
        .map((database) => `database:${database.name ?? "null"}:${database.version ?? "null"}`)
        .sort();
      return {
        "external-root": await fileEntries(null, "all", [installRoot, "parallax-saves"]),
        indexeddb: databaseEntries,
        "install-root": await fileEntries(installRoot, "install-metadata"),
        saves: await fileEntries("parallax-saves", "all"),
        "shell-cache": cacheEntries,
      };
    },
    { installRoot: INSTALL_STORE_ROOT },
  );
  const entries: Record<InstallerTrustFaultMutationScope, readonly string[]> = {
    "external-root": raw["external-root"],
    indexeddb: raw.indexeddb,
    "install-root": raw["install-root"],
    saves: raw.saves,
    selection: [
      `active:${selectionSnapshot.installStore.activeReleaseDigest ?? "null"}`,
      `previous:${selectionSnapshot.installStore.previousReleaseDigest ?? "null"}`,
      `publications:${selectionSnapshot.installStore.publicationCount}`,
    ].sort(),
    "shell-cache": raw["shell-cache"],
  };
  return Object.freeze(
    Object.fromEntries(
      Object.entries(entries).map(([scope, inventoryEntries]) => [
        scope,
        Object.freeze({
          entries: Object.freeze([...inventoryEntries]),
          sha256: createHash("sha256").update(JSON.stringify(inventoryEntries)).digest("hex"),
        }),
      ]),
    ) as unknown as Readonly<
      Record<InstallerTrustFaultMutationScope, InstallerTrustFaultScopedInventory>
    >,
  );
}

function buildHttpEvidence(
  journal: readonly (LocalServerDetailedJournalEntry & {
    attempt: 0 | 1 | 2;
    order: number;
    phase: TrustPhase;
  })[],
): InstallerTrustFaultCell["http"] {
  return Object.freeze(
    journal.map((entry, index) => {
      if (entry.order !== index + 1) {
        throw new Error("Installer trust-fault server journal order changed");
      }
      validateInstallerTrustFaultDetailedRangeAuthority(entry);
      return Object.freeze({
        attempt: entry.attempt,
        bodyBytes: entry.bodyBytes,
        etag: entry.etag,
        ifRange: entry.ifRange,
        method: entry.method,
        order: entry.order,
        path: entry.path,
        phase: entry.phase,
        range: entry.range,
        status: entry.status,
      });
    }),
  );
}

export function validateInstallerTrustFaultDetailedRangeAuthority(
  entry: LocalServerDetailedJournalEntry & { readonly order: number },
): void {
  const requested = entry.range?.match(/^bytes=([0-9]+)-$/u);
  const requestedStart = requested?.[1] === undefined ? null : Number(requested[1]);
  const canonicalRequest =
    requestedStart !== null &&
    Number.isSafeInteger(requestedStart) &&
    requestedStart >= 0 &&
    entry.range === `bytes=${requestedStart}-`;
  const partial = entry.contentRange?.match(/^bytes ([0-9]+)-([0-9]+)\/([0-9]+)$/u);
  const partialStart = partial?.[1] === undefined ? null : Number(partial[1]);
  const partialEnd = partial?.[2] === undefined ? null : Number(partial[2]);
  const partialTotal = partial?.[3] === undefined ? null : Number(partial[3]);
  const exactPartial =
    canonicalRequest &&
    partialStart === requestedStart &&
    partialEnd !== null &&
    partialTotal !== null &&
    Number.isSafeInteger(partialEnd) &&
    Number.isSafeInteger(partialTotal) &&
    partialEnd === partialTotal - 1 &&
    partialEnd >= requestedStart;
  const unsatisfied = entry.contentRange?.match(/^bytes \*\/([0-9]+)$/u);
  const unsatisfiedTotal = unsatisfied?.[1] === undefined ? null : Number(unsatisfied[1]);
  const valid =
    entry.range === null
      ? entry.contentRange === null
      : entry.status === 206
        ? exactPartial && partialTotal !== null && entry.bodyBytes === partialTotal - requestedStart
        : entry.status === 499
          ? exactPartial &&
            partialTotal !== null &&
            entry.bodyBytes >= 0 &&
            entry.bodyBytes <= partialTotal - requestedStart
          : entry.status === 416
            ? canonicalRequest &&
              unsatisfiedTotal !== null &&
              Number.isSafeInteger(unsatisfiedTotal) &&
              requestedStart === unsatisfiedTotal &&
              entry.bodyBytes === 0
            : entry.contentRange === null;
  if (valid) return;
  throw new Error(
    `Installer trust-fault server journal lacks exact Content-Range authority; request=${JSON.stringify(
      {
        contentRange: entry.contentRange !== null,
        etag: entry.etag !== null,
        ifRange: entry.ifRange !== null,
        method: entry.method,
        order: entry.order,
        pathSha256: createHash("sha256").update(entry.path).digest("hex"),
        range: entry.range === null ? null : entry.range.length <= 64 ? entry.range : "<oversized>",
        status: entry.status,
      },
    )}`,
  );
}

async function click(page: Page, selector: string): Promise<void> {
  const locator = page.locator(selector);
  await locator.waitFor({ state: "visible" });
  if (await locator.isDisabled())
    throw new Error(`Ordinary installer action ${selector} is disabled`);
  await locator.click();
}

async function waitForState(
  page: Page,
  expected: "failed" | "ready",
  timeout: number,
  authority: InstallerTrustProductTerminalAuthority,
): Promise<void> {
  const terminal = await page.waitForFunction(
    () => {
      const observed = document.querySelector("#installer-shell")?.getAttribute("data-state");
      return observed === "failed" || observed === "ready" ? observed : false;
    },
    undefined,
    { timeout },
  );
  const observed = await terminal.jsonValue();
  await terminal.dispose();
  if (observed !== expected) {
    const raw = await collectInstallerTrustProductTerminalEvidence(page);
    throw createInstallerTrustProductTerminalFailure(expected, observed, authority, raw);
  }
}

export async function collectInstallerTrustProductTerminalEvidence(page: Page): Promise<unknown> {
  return page.evaluate(collectInstallerTrustProductTerminalEvidenceInPage);
}

export function collectInstallerTrustProductTerminalEvidenceInPage(): unknown {
  const panel = document.querySelector("#installer-shell");
  const diagnostics = (
    globalThis as unknown as {
      __parallaxInstallerDiagnosticsV1?: () => {
        readonly installer: unknown;
        readonly ui: {
          readonly failure: unknown;
          readonly releaseDigest: string | null;
          readonly shellGenerationId: string | null;
          readonly state: string;
          readonly storeState: string;
          readonly transferState: string;
        };
      };
    }
  ).__parallaxInstallerDiagnosticsV1?.();
  if (!(panel instanceof HTMLElement) || diagnostics === undefined) {
    return null;
  }
  return {
    installer: diagnostics.installer,
    panel: {
      failureClass: panel.dataset.failureClass || null,
      failureCode: panel.dataset.failureCode || null,
      failureEvidence: panel.dataset.failureEvidence || null,
      failureMessage: panel.dataset.failureMessage || null,
      failureOperation: panel.dataset.failureOperation || null,
      failureRecovery: panel.dataset.failureRecovery || null,
      failureResourceId: panel.dataset.failureResourceId || null,
      releaseDigest: panel.dataset.releaseDigest || null,
      shellGenerationId: panel.dataset.shellGenerationId || null,
      state: panel.dataset.state || null,
      storeState: panel.dataset.storeState || null,
      transferState: panel.dataset.transferState || null,
    },
    ui: diagnostics.ui,
  };
}

export function createInstallerTrustProductTerminalFailure(
  expected: "failed" | "ready",
  observed: unknown,
  authority: InstallerTrustProductTerminalAuthority,
  raw: unknown,
): InstallerTrustProductTerminalError {
  if (observed !== "failed" && observed !== "ready") {
    throw terminalEvidenceError("Observed terminal state is invalid");
  }
  if (observed === expected) {
    throw terminalEvidenceError("Unexpected-terminal evidence does not describe a mismatch");
  }
  const root = terminalObject(raw, "terminal evidence");
  const artifactDigest = terminalRequiredDigest(
    authority.artifactDigest,
    "expected terminal artifact",
  );
  const expectedReleaseDigest = terminalRequiredDigest(
    authority.releaseDigest,
    "expected terminal release",
  );
  const panel = terminalObject(root.panel, "terminal panel");
  const ui = terminalObject(root.ui, "terminal UI diagnostics");
  const installer = root.installer;
  try {
    parseInstallerSnapshot(installer);
  } catch (error: unknown) {
    throw terminalEvidenceError(
      `Terminal installer snapshot is not authoritative: ${String(error)}`,
    );
  }
  const snapshot = installer as InstallerSnapshot;
  const state = terminalNullableString(panel.state, "terminal panel state");
  const uiState = terminalNullableString(ui.state, "terminal UI state");
  const storeState = terminalNullableString(panel.storeState, "terminal panel store state");
  const transferState = terminalNullableString(
    panel.transferState,
    "terminal panel transfer state",
  );
  if (
    state !== observed ||
    uiState !== observed ||
    storeState !== snapshot.installStore.state ||
    transferState !== snapshot.installerTransfer.state ||
    ui.storeState !== snapshot.installStore.state ||
    ui.transferState !== snapshot.installerTransfer.state
  ) {
    throw terminalEvidenceError("Terminal UI, panel, and installer telemetry are contradictory");
  }
  const failureCode = terminalNullableString(panel.failureCode, "terminal failure code");
  const failureResourceId = terminalNullableString(
    panel.failureResourceId,
    "terminal failure resource",
  );
  const action = terminalNullableString(panel.failureRecovery, "terminal failure action");
  const failureOperation = terminalNullableString(
    panel.failureOperation,
    "terminal failure operation",
  );
  const releaseDigest = terminalNullableDigest(panel.releaseDigest, "terminal UI release");
  const shellGenerationId = terminalNullableGeneration(
    panel.shellGenerationId,
    "terminal UI shell generation",
  );
  const diagnosticReleaseDigest = terminalNullableDigest(ui.releaseDigest, "diagnostic UI release");
  const diagnosticShellGenerationId = terminalNullableGeneration(
    ui.shellGenerationId,
    "diagnostic UI shell generation",
  );
  if (
    releaseDigest !== diagnosticReleaseDigest ||
    shellGenerationId !== diagnosticShellGenerationId
  ) {
    throw terminalEvidenceError("Terminal panel and diagnostic UI identities are contradictory");
  }
  const diagnosticFailure = ui.failure;
  if (failureCode !== null && !INSTALLER_TRUST_PRODUCT_TERMINAL_FAILURE_CODES.has(failureCode)) {
    throw terminalEvidenceError("Terminal failure code is outside the exact product domain");
  }
  if (observed === "failed") {
    const failure = terminalObject(diagnosticFailure, "terminal UI failure");
    let expectedAction = installerTrustProductRecoveryAction(
      failureCode as InstallerTrustProductTerminalFailureCode,
    );
    if (
      snapshot.installerTransfer.state === "failed" &&
      failureCode !== null &&
      typeof failure.message === "string" &&
      typeof failure.failureClass === "string" &&
      typeof failure.failureEvidence === "string" &&
      typeof failure.operation === "string"
    ) {
      const diagnostic = {
        code: failureCode as InstallerFailureCode,
        failureClass: failure.failureClass as InstallerFailureClass,
        failureEvidence: failure.failureEvidence as InstallerFailureEvidence,
        message: failure.message,
        operation: failure.operation as InstallerFailureOperation,
        resourceId: failureResourceId,
      };
      try {
        assertCanonicalInstallerFailureDiagnostic(diagnostic);
        expectedAction = installerFailureRecoveryAction(diagnostic);
      } catch (error: unknown) {
        throw terminalEvidenceError(
          `Failed terminal UI has a non-authoritative installer tuple: ${String(error)}`,
        );
      }
    }
    if (
      failureCode === null ||
      expectedAction === null ||
      action !== expectedAction ||
      failure.code !== failureCode ||
      failure.operation !== failureOperation ||
      (snapshot.installerTransfer.state === "failed" &&
        (failure.failureClass !== snapshot.installerTransfer.failureClass ||
          failure.failureEvidence !== snapshot.installerTransfer.failureEvidence ||
          failure.operation !== snapshot.installerTransfer.failureOperation ||
          failure.message !== snapshot.installerTransfer.failureMessage)) ||
      failure.recovery !== expectedAction ||
      failure.resourceId !== failureResourceId
    ) {
      throw terminalEvidenceError("Failed terminal UI lacks exact typed failure authority");
    }
    if (
      releaseDigest !== null ||
      shellGenerationId !== null ||
      snapshot.installerTransfer.activeReleaseDigest !== expectedReleaseDigest ||
      snapshot.installStore.activeReleaseDigest !== null
    ) {
      throw terminalEvidenceError(
        "Failed terminal outcome retains contradictory release authority",
      );
    }
    if (
      snapshot.installerTransfer.state === "failed" &&
      (snapshot.installerTransfer.failureCode !== failureCode ||
        snapshot.installerTransfer.failureResourceId !== failureResourceId ||
        snapshot.installerTransfer.failureMessage === null ||
        panel.failureClass !== snapshot.installerTransfer.failureClass ||
        panel.failureEvidence !== snapshot.installerTransfer.failureEvidence ||
        panel.failureOperation !== snapshot.installerTransfer.failureOperation ||
        panel.failureMessage !== snapshot.installerTransfer.failureMessage)
    ) {
      throw terminalEvidenceError(
        "Failed transfer telemetry contradicts the terminal UI failure authority",
      );
    }
  } else if (
    diagnosticFailure !== null ||
    failureCode !== null ||
    failureResourceId !== null ||
    failureOperation !== null ||
    action !== null ||
    snapshot.installerTransfer.failureCode !== null ||
    snapshot.installerTransfer.failureResourceId !== null ||
    snapshot.installerTransfer.failureMessage !== null
  ) {
    throw terminalEvidenceError("Ready terminal UI retains contradictory failure authority");
  } else if (
    releaseDigest !== expectedReleaseDigest ||
    shellGenerationId !== `${artifactDigest}:${expectedReleaseDigest}` ||
    snapshot.installerTransfer.activeReleaseDigest !== expectedReleaseDigest ||
    snapshot.installStore.activeReleaseDigest !== expectedReleaseDigest
  ) {
    throw terminalEvidenceError("Ready terminal outcome lacks exact expected release authority");
  }
  const projection: InstallerTrustProductTerminalProjection = Object.freeze({
    expected,
    observed,
    store: Object.freeze({
      activeReleaseDigest: snapshot.installStore.activeReleaseDigest,
      currentReleaseDigest: snapshot.installStore.currentReleaseDigest,
      currentResourceId: snapshot.installStore.currentResourceId,
      failureMessage:
        snapshot.installStore.failureMessage === null
          ? null
          : sanitizeInstallerFailureMessage(snapshot.installStore.failureMessage),
      state: snapshot.installStore.state,
    }),
    transfer: Object.freeze({
      activeReleaseDigest: snapshot.installerTransfer.activeReleaseDigest,
      failureCode: snapshot.installerTransfer.failureCode,
      failureClass: snapshot.installerTransfer.failureClass,
      failureEvidence: snapshot.installerTransfer.failureEvidence,
      failureMessage: snapshot.installerTransfer.failureMessage,
      failureOperation: snapshot.installerTransfer.failureOperation,
      failureResourceId: snapshot.installerTransfer.failureResourceId,
      state: snapshot.installerTransfer.state,
    }),
    ui: Object.freeze({
      action: action ?? "none",
      failureCode: failureCode as InstallerTrustProductTerminalFailureCode,
      failureOperation: failureOperation as InstallerFailureOperation | null,
      failureResourceId,
      releaseDigest,
      shellGenerationId,
      state: observed,
    }),
  });
  return new InstallerTrustProductTerminalError(projection);
}

function formatInstallerTrustProductTerminalProjection(
  projection: InstallerTrustProductTerminalProjection,
): string {
  const value = (input: string | null): string => input ?? "none";
  const message =
    `product-terminal@1 expected=${projection.expected} observed=${projection.observed}` +
    ` ui=${projection.ui.state}/${value(projection.ui.failureCode)}/${projection.ui.action}` +
    `/${value(projection.ui.failureResourceId)}/${value(projection.ui.releaseDigest)}` +
    `/${value(projection.ui.shellGenerationId)}` +
    ` transfer=${projection.transfer.state}/${value(projection.transfer.failureCode)}` +
    `/${value(projection.transfer.failureClass)}` +
    `/${value(projection.transfer.failureEvidence)}` +
    `/${value(projection.transfer.failureOperation)}` +
    `/${value(projection.transfer.failureResourceId)}` +
    `/${value(projection.transfer.activeReleaseDigest)}` +
    ` store=${projection.store.state}/${value(projection.store.activeReleaseDigest)}` +
    `/${value(projection.store.currentReleaseDigest)}` +
    `/${value(projection.store.currentResourceId)}` +
    `/${projection.store.failureMessage === null ? "absent" : "present"}`;
  if (message.length > 500) {
    throw terminalEvidenceError("Terminal product projection exceeds its evidence bound");
  }
  return message;
}

function terminalObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw terminalEvidenceError(`${name} is invalid`);
  }
  return value as Record<string, unknown>;
}

function terminalNullableString(value: unknown, name: string): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value === "" ||
    value.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/u.test(value)
  ) {
    throw terminalEvidenceError(`${name} is invalid`);
  }
  return value;
}

function terminalNullableDigest(value: unknown, name: string): string | null {
  const parsed = terminalNullableString(value, name);
  if (parsed !== null && !/^[a-f0-9]{64}$/u.test(parsed)) {
    throw terminalEvidenceError(`${name} is invalid`);
  }
  return parsed;
}

function terminalRequiredDigest(value: unknown, name: string): string {
  const parsed = terminalNullableDigest(value, name);
  if (parsed === null) throw terminalEvidenceError(`${name} is absent`);
  return parsed;
}

function terminalNullableGeneration(value: unknown, name: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[a-f0-9]{64}:[a-f0-9]{64}$/u.test(value)) {
    throw terminalEvidenceError(`${name} is invalid`);
  }
  return value;
}

export function installerTrustProductRecoveryAction(
  code: InstallerTrustProductTerminalFailureCode,
): "reload" | "repair" | "retry" | null {
  switch (code) {
    case null:
      return null;
    case "cancel-target-invalid":
    case "cancelled":
    case "concurrent-install":
    case "disposed":
    case "install-manifest-invalid":
    case "integrity":
    case "protocol":
    case "quota":
    case "repair-target-mismatch":
    case "shell-incompatible":
    case "store":
    case "transport":
    case "unknown":
    case "validator": {
      const recoveries = new Set(
        INSTALLER_FAILURE_RULES.filter((rule) => rule.code === code).map(
          (rule) => rule.recoveryAction,
        ),
      );
      if (recoveries.size !== 1) {
        throw new Error("Installer failure registry has contradictory recovery actions");
      }
      return recoveries.values().next().value ?? null;
    }
    case "launch":
    case "shell-contract":
    case "shell-release-mismatch":
      return "reload";
    case "persistence":
    case "shell-unavailable":
      return "retry";
  }
}

function terminalEvidenceError(message: string): Error {
  const error = new Error(message);
  error.name = "InstallerTrustProductTerminalEvidenceError";
  return error;
}

async function readDiagnostics(page: Page): Promise<{
  readonly installer: InstallerSnapshot;
  readonly ui: { readonly persistence: string };
}> {
  return page.evaluate(() => {
    const value = (
      globalThis as unknown as {
        __parallaxInstallerDiagnosticsV1?: () => unknown;
      }
    ).__parallaxInstallerDiagnosticsV1?.();
    if (value === undefined) throw new Error("Installer diagnostics are absent");
    return value as {
      installer: InstallerSnapshot;
      ui: { persistence: string };
    };
  });
}

async function readStartupAdmissionObservation(
  page: Page,
): Promise<InstallerTrustStartupObservation> {
  const observation = await page.evaluate(() => {
    const panel = document.querySelector("#installer-shell");
    const start = document.querySelector("#installer-start");
    const repair = document.querySelector("#installer-repair");
    const launch = document.querySelector("#installer-launch");
    const controller = navigator.serviceWorker.controller;
    const value = (
      globalThis as unknown as {
        __parallaxInstallerDiagnosticsV1?: () => {
          readonly installer: {
            readonly installStore: {
              readonly activeReleaseDigest: string | null;
              readonly failureMessage: string | null;
              readonly state: string;
            };
            readonly installerTransfer: {
              readonly activeReleaseDigest: string | null;
              readonly failureCode: string | null;
              readonly failureMessage: string | null;
              readonly state: string;
            };
          };
          readonly offlineShell: {
            readonly activeArtifactDigest: string | null;
            readonly activeGenerationId: string | null;
            readonly activeReleaseDigest: string | null;
            readonly failureCode: string | null;
            readonly failureMessage: string | null;
            readonly state: string;
          };
          readonly ui: {
            readonly failure: unknown;
            readonly releaseDigest: string | null;
            readonly shellGenerationId: string | null;
            readonly state: string;
            readonly storeState: string;
            readonly transferState: string;
          };
        };
      }
    ).__parallaxInstallerDiagnosticsV1?.();
    const htmlPanel = panel instanceof HTMLElement ? panel : null;
    return {
      controller:
        controller === null
          ? null
          : {
              scriptUrl: controller.scriptURL,
              state: controller.state,
            },
      controls:
        start instanceof HTMLButtonElement &&
        repair instanceof HTMLButtonElement &&
        launch instanceof HTMLButtonElement
          ? {
              launchDisabled: launch.disabled,
              repairDisabled: repair.disabled,
              startDisabled: start.disabled,
            }
          : null,
      diagnosticsAvailable: value !== undefined,
      installStore: value?.installer.installStore ?? null,
      installerTransfer: value?.installer.installerTransfer ?? null,
      offlineShell: value?.offlineShell ?? null,
      panel:
        htmlPanel === null
          ? null
          : {
              failureCode: htmlPanel.dataset.failureCode || null,
              releaseDigest: htmlPanel.dataset.releaseDigest || null,
              shellGenerationId: htmlPanel.dataset.shellGenerationId || null,
              state: htmlPanel.dataset.state || null,
              storeState: htmlPanel.dataset.storeState || null,
              transferState: htmlPanel.dataset.transferState || null,
            },
      ui: value?.ui ?? null,
    };
  });
  return Object.freeze({
    ...observation,
    installerWorkerObserved: true,
  });
}

async function readInstallerSnapshot(page: Page): Promise<InstallerSnapshot> {
  const value = (await readDiagnostics(page)).installer;
  parseInstallerSnapshot(value);
  return value;
}

async function readUiFailure(page: Page): Promise<{
  readonly action: "repair" | "retry";
  readonly code: InstallerTrustFaultCell["attempts"][number]["failureCode"];
  readonly resourceId: string | null;
}> {
  return page.evaluate(() => {
    const panel = document.querySelector("#installer-shell");
    if (!(panel instanceof HTMLElement)) throw new Error("Installer failure panel is absent");
    const recovery = panel.dataset.failureRecovery;
    if (recovery !== "repair" && recovery !== "retry") {
      throw new Error("Installer failure recovery action is not Repair or Retry");
    }
    return {
      action: recovery,
      code: panel.dataset.failureCode as InstallerTrustFaultCell["attempts"][number]["failureCode"],
      resourceId: panel.dataset.failureResourceId || null,
    };
  });
}

async function takeTransitions(
  page: Page,
  recorder: InstallerTrustFaultTransitionProofRecorder,
): Promise<readonly string[]> {
  const raw = await runInstallerTrustTransitionBarrier(page, recorder, "clear");
  return projectInstallerTrustFaultAttemptMilestones(raw).milestones;
}

async function allTransitions(
  page: Page,
  recorder: InstallerTrustFaultTransitionProofRecorder,
): Promise<InstallerTrustFaultTransitionProof> {
  await runInstallerTrustTransitionBarrier(page, recorder, "seal");
  const proof = recorder.finish();
  if (proof.schemaVersion !== INSTALLER_TRUST_FAULT_TRANSITION_PROOF_SCHEMA_VERSION) {
    throw new Error("Installer physical raw transition proof did not emit the active schema");
  }
  return proof;
}

async function setTransitionPhase(
  page: Page,
  recorder: InstallerTrustFaultTransitionProofRecorder,
  phase: TrustPhase,
): Promise<void> {
  await runInstallerTrustTransitionBarrier(page, recorder, "phase", phase);
}

export async function runInstallerTrustTransitionBarrier(
  page: Page,
  recorder: InstallerTrustFaultTransitionProofRecorder,
  kind: InstallerTrustTransitionBarrierKind,
  nextPhase?: TrustPhase,
): Promise<readonly InstallerTrustFaultTransition[]> {
  const rawBatch = await page.evaluate(
    ({ barrierKind, barrierPhase }) => {
      const value = (
        globalThis as unknown as {
          __parallaxTrustTransitions?: InstallerTrustTransitionQueueState;
        }
      ).__parallaxTrustTransitions;
      if (value === undefined) throw new Error("Installer transitions are absent");
      return value.barrier(barrierKind, barrierPhase);
    },
    { barrierKind: kind, barrierPhase: nextPhase },
  );
  const batch = parseInstallerTrustTransitionBatch(rawBatch);
  for (const [index, observation] of batch.rawObservations.entries()) {
    const transition = batch.transitions[index];
    const next = batch.transitions[index + 1];
    const isPhaseFinal =
      transition !== undefined && (next === undefined || next.phase !== transition.phase);
    recorder.observe(observation, isPhaseFinal ? "barrier" : undefined);
  }
  return batch.transitions;
}

export function parseInstallerTrustTransitionBatch(input: unknown): InstallerTrustTransitionBatch {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Installer transition batch is not an object");
  }
  const batch = input as Record<string, unknown>;
  if (
    Object.keys(batch).sort().join(",") !== "rawObservations,transitions" ||
    !Array.isArray(batch.rawObservations) ||
    !Array.isArray(batch.transitions) ||
    batch.rawObservations.length !== batch.transitions.length ||
    batch.transitions.length > INSTALLER_TRUST_FAULT_MAX_RAW_OBSERVATIONS
  ) {
    throw new Error("Installer transition batch shape or alignment is invalid");
  }
  for (let index = 0; index < batch.transitions.length; index += 1) {
    const raw = batch.rawObservations[index];
    if (
      typeof raw !== "object" ||
      raw === null ||
      Array.isArray(raw) ||
      JSON.stringify((raw as Record<string, unknown>).transition) !==
        JSON.stringify(batch.transitions[index])
    ) {
      throw new Error("Installer transition batch raw observation is misaligned");
    }
  }
  return Object.freeze({
    rawObservations: Object.freeze([...batch.rawObservations]),
    transitions: Object.freeze([...batch.transitions]) as readonly InstallerTrustFaultTransition[],
  });
}

function attemptEvidence(
  index: number,
  outcome: "failed" | "passed",
  failureCode: InstallerTrustFaultCell["attempts"][number]["failureCode"],
  failureResourceId: string | null,
  action: InstallerTrustFaultCell["attempts"][number]["action"],
  transitions: readonly string[],
  networkRetryCount: number,
): InstallerTrustFaultCell["attempts"][number] {
  return Object.freeze({
    action,
    failureCode,
    failureResourceId,
    index,
    networkRetryCount,
    outcome,
    transitions: Object.freeze([...transitions]),
  });
}

function faultKind(id: InstallerTrustFaultCellId): InstallerTrustFaultCell["fault"]["kind"] {
  const values: Record<InstallerTrustFaultCellId, InstallerTrustFaultCell["fault"]["kind"]> = {
    "estimate-clearly-insufficient": "estimate-insufficient",
    "estimate-incomplete-probe-success": "estimate-incomplete",
    "final-verification-corruption": "corrupt-final-object",
    "mid-append-quota-resume": "mid-append-quota",
    "persistence-denied": "persistence-denied",
    "quota-probe-exceeded": "quota-probe",
    "repeated-server-corruption": "corrupt-server-representation",
    "reused-object-corruption": "corrupt-reused-object",
  };
  return values[id];
}
