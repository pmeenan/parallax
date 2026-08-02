import { createHash, randomUUID } from "node:crypto";
import { cp, link, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS,
  type InstallerTransferTelemetrySnapshot,
  type ParallaxTelemetrySnapshot,
  parseInstallerTransferTelemetry,
} from "@parallax/engine";
import type { BrowserContext, CDPSession, Page } from "playwright-core";
import {
  type AssetOnlyUpdateFixture,
  createAssetOnlyUpdateFixture,
  publishAssetOnlyUpdateFixture,
  verifyPublishedAssetOnlyFixture,
} from "./asset-only-release-update.js";
import { requireAssetUpdateDiagnosticLaunch } from "./asset-update-v8-diagnostic-launch.js";
import {
  ASSET_UPDATE_V8_CONTRACT,
  ASSET_UPDATE_V8_SCHEMA_VERSION,
  type AssetUpdateExpectedAuthority,
  type AssetUpdateLifecycleResult,
  type AssetUpdateReadyAuthority,
  type AssetUpdateReleaseAuthority,
  type AssetUpdateRunAuthority,
  type AssetUpdateTargetObservation,
  type AssetUpdateV8Diagnostics,
  type AssetUpdateV8Evidence,
  type AssetUpdateV8LaunchEvidence,
  assetUpdateJsonEqual as sameJson,
  validateAssetUpdateV8Evidence,
  WARM_LAUNCH_BUDGET_MS,
} from "./asset-update-v8-evidence.js";
import {
  createAssetUpdateV8FailedEvidence as failedEvidence,
  type AssetUpdateV8FailurePhase as RunPhase,
} from "./asset-update-v8-failure.js";
import {
  buildInitialInstallExitEvidence,
  createInstallCdpNetworkCapture,
  FINAL_VERIFICATION_POLL_INTERVAL_MS,
  FINAL_VERIFICATION_POST_READY_TIMEOUT_MS,
  FRESH_INSTALLED_LAUNCH_BUDGET_MS,
  type InitialInstallExitEvidence,
  type InstallControlIdentity,
  installControlIdentities,
} from "./asset-update-v8-install-exit.js";
import { runAssetUpdateV8ProfileSequence } from "./asset-update-v8-orchestration.js";
import {
  closeAssetUpdateV8ResultAfterFailure,
  reserveAssetUpdateV8Result,
  validateAssetUpdateV8ResultPair,
} from "./asset-update-v8-result.js";
import { sanitizeAssetUpdateDiagnostic as boundedMessage } from "./asset-update-v8-sanitization.js";
import { assetUpdateResourceContentType } from "./asset-update-v8-target-representation.js";
import { waitForAssetUpdateV8WorkerCommand } from "./asset-update-v8-worker-command.js";
import {
  readBrowserDisplayIdentity,
  readChromeCommandLine,
  readWebGpuAdapterIdentity,
} from "./browser-probes.js";
import {
  readAndValidateBuildManifest,
  sha256File,
  type ValidatedBuildManifest,
} from "./build-manifest.js";
import {
  launchPersistentChrome,
  loadChromePin,
  resolveChromeExecutablePath,
  validateChromeExecutable,
  validateChromeSandboxCommandLine,
} from "./chrome-pin.js";
import { finalizeCleanup, RETRYING_RECURSIVE_REMOVE_OPTIONS } from "./cleanup.js";
import {
  evaluateGateEnvironment,
  type GateEnvironmentObservation,
  loadMachineDescriptor,
  type MachineDescriptor,
  projectCdpGpuDevice,
  tryReadWindowsHostIdentity,
} from "./environment.js";
import type { InstallManifest } from "./install-manifest.js";
import { launchAfterPhysicalConsoleDisplayWake } from "./physical-console-preflight.js";
import {
  createLocalServer,
  type LocalServerDetailedJournalEntry,
  listenLocalServer,
  stopLocalServer,
} from "./server.js";
import { readSourceIdentity } from "./source-identity.js";
import { readTelemetry } from "./telemetry.js";
import {
  decodedSourceCodeUnits,
  resolveV8CodeCacheEvidence,
  resolveV8CodeCacheProductionEvidence,
  type V8ScriptArtifact,
} from "./v8-code-cache-trace.js";
import { selectV8ScriptManifestArtifacts } from "./v8-script-artifacts.js";
import {
  beginV8TraceCapture,
  invalidV8Trace,
  type V8TraceCapture,
  type V8TraceCaptureResult,
} from "./v8-trace-capture.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const buildRoot = join(repositoryRoot, "dist");
const resultRoot = join(repositoryRoot, "harness/results/asset-update-v8");
const machineId = process.env.PARALLAX_MACHINE_ID ?? "dev-01";
const LAUNCH_COMPLETION_TIMEOUT_MS = 30_000;
const INSTALL_COMPLETION_TIMEOUT_MS = 30 * 60_000;
const V8_DIAGNOSTIC_SETTLE_MS = 2_000;
const MAX_UPDATE_SERVER_JOURNAL_ENTRIES = 4096;

interface BrowserIdentity {
  readonly jsVersion: string;
  readonly product: string;
  readonly protocolVersion: "1.3";
  readonly revision: string;
  readonly userAgent: string;
  readonly version: string;
}

interface MeasuredLaunchCapture {
  readonly browser: BrowserIdentity;
  readonly budgetExceeded: boolean;
  readonly environment: GateEnvironmentObservation | null;
  readonly launch: AssetUpdateV8LaunchEvidence;
  readonly ready: AssetUpdateReadyAuthority;
}

interface DiagnosticCapture {
  readonly diagnostics: AssetUpdateV8Diagnostics;
}

interface FreshLaunchCapture extends MeasuredLaunchCapture {
  readonly diagnostics: AssetUpdateV8Diagnostics;
}

interface LifecycleCapture {
  readonly authority: AssetUpdateRunAuthority;
  readonly expected: AssetUpdateExpectedAuthority;
  readonly postValidationReady: AssetUpdateReadyAuthority | null;
  readonly postValidationTarget: AssetUpdateTargetObservation | null;
  readonly result: AssetUpdateLifecycleResult;
}

class LifecyclePostValidationError extends Error {
  public readonly capture: LifecycleCapture;

  public constructor(capture: LifecycleCapture, cause: unknown) {
    super(`Asset-update V8 lifecycle post-validation failed: ${boundedMessage(cause)}`, {
      cause,
    });
    this.name = "LifecyclePostValidationError";
    this.capture = capture;
  }
}

class LifecycleMeasurementError extends Error {
  public readonly capture: LifecycleCapture;
  public readonly phase: "fresh" | "initial-install" | "post-warm" | "pre-warm";

  public constructor(
    capture: LifecycleCapture,
    phase: "fresh" | "initial-install" | "post-warm" | "pre-warm",
  ) {
    const duration =
      phase === "initial-install"
        ? capture.result.initialInstall.networkIdleLocalCriticalPathMs
        : capture.result.launches[
            phase === "fresh" ? "fresh" : phase === "pre-warm" ? "pre" : "post"
          ].lifecycle.durationMs;
    const budget =
      phase === "initial-install"
        ? capture.result.initialInstall.networkIdleLocalCriticalPathBudgetMs
        : phase === "fresh"
          ? FRESH_INSTALLED_LAUNCH_BUDGET_MS
          : WARM_LAUNCH_BUDGET_MS;
    super(
      phase === "initial-install"
        ? `initial-install network-idle/local-critical-path residual ${duration} exceeds ${budget} ms`
        : `${phase} Launch-to-interactive duration ${duration} exceeds ${budget} ms`,
    );
    this.name = "LifecycleMeasurementError";
    this.capture = capture;
    this.phase = phase;
  }
}

await main();

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  let phase: RunPhase = "authority";
  let authority: AssetUpdateRunAuthority | null = null;
  let partialResult: AssetUpdateLifecycleResult | null = null;
  let postValidationPerformed = false;
  const reservation = await reserveAssetUpdateV8Result(
    resultRoot,
    startedAt,
    ({ companionPath, reservationId }) => pendingEvidence(startedAt, companionPath, reservationId),
  );
  let terminalPublished = false;
  try {
    const build = await readAndValidateBuildManifest(buildRoot);
    const source = await readSourceIdentity(repositoryRoot);
    const pin = await loadChromePin(join(repositoryRoot, "harness/chrome/stable.json"));
    const executable = await resolveChromeExecutablePath(repositoryRoot, pin);
    const executableSha256 = await validateChromeExecutable(pin, executable);
    const machineRoot = join(repositoryRoot, "harness/machines");
    const machineDescriptorBytes = await readFile(join(machineRoot, `${machineId}.json`));
    const machineDescriptor = await loadMachineDescriptor(machineRoot, machineId);
    if (
      !sameJson(JSON.parse(machineDescriptorBytes.toString("utf8")) as unknown, machineDescriptor)
    ) {
      throw new Error("Loaded machine descriptor differs from its exact authority bytes");
    }

    phase = "fixture";
    let capture: LifecycleCapture;
    try {
      capture = await runLifecycle({
        baseBuild: build,
        executable,
        executableSha256,
        machineDescriptor,
        machineDescriptorBytes,
        onPhase: (nextPhase) => {
          phase = nextPhase;
        },
        pinVersion: pin.version,
        source,
      });
    } catch (error: unknown) {
      if (error instanceof LifecyclePostValidationError) {
        authority = error.capture.authority;
        partialResult = error.capture.result;
        phase = "post-validation";
      } else if (error instanceof LifecycleMeasurementError) {
        authority = error.capture.authority;
        partialResult = error.capture.result;
        phase = error.phase;
      }
      throw error;
    }
    authority = capture.authority;
    partialResult = capture.result;

    phase = "post-validation";
    const postBuild = await readAndValidateBuildManifest(buildRoot);
    const postSource = await readSourceIdentity(repositoryRoot);
    const postExecutableSha256 = await validateChromeExecutable(pin, executable);
    const postMachineDescriptorBytes = await readFile(join(machineRoot, `${machineId}.json`));
    const postMachineDescriptor = await loadMachineDescriptor(machineRoot, machineId);
    if (
      postBuild.artifactDigest !== build.artifactDigest ||
      postBuild.releaseDigest !== build.releaseDigest ||
      !sameJson(postSource, source) ||
      postExecutableSha256 !== executableSha256 ||
      !postMachineDescriptorBytes.equals(machineDescriptorBytes) ||
      !sameJson(postMachineDescriptor, machineDescriptor)
    ) {
      throw new Error("Asset-update V8 post-validation authority changed during the run");
    }
    postValidationPerformed = true;
    if (capture.postValidationReady === null || capture.postValidationTarget === null) {
      throw new Error("Asset-update V8 lifecycle omitted fresh post-validation observations");
    }
    const passed = passedEvidence({
      authority,
      companionPath: basename(reservation.markdownPath),
      completedAt: new Date().toISOString(),
      reservationId: reservation.reservationId,
      result: capture.result,
      postValidationReady: capture.postValidationReady,
      postValidationTarget: capture.postValidationTarget,
      startedAt,
    });
    validateAssetUpdateV8Evidence(passed, capture.expected);
    const terminal = await reservation.publishTerminal(passed, (failurePhase, error) =>
      failedEvidence({
        authority,
        companionPath: basename(reservation.markdownPath),
        error,
        partialResult,
        phase: publicationFailurePhase(failurePhase),
        postValidationPerformed,
        reservationId: reservation.reservationId,
        startedAt,
      }),
    );
    if (terminal.state !== "passed") {
      throw new Error(
        terminal.state === "failed"
          ? `Asset-update V8 terminal publication recovered as failed: ${terminal.failure.message}`
          : "Asset-update V8 terminal publication unexpectedly remained pending",
      );
    }
    const retained = await validateAssetUpdateV8ResultPair(
      reservation.jsonPath,
      reservation.markdownPath,
      capture.expected,
      reservation.retainedIdentity,
    );
    if (
      retained.state !== "passed" ||
      terminal.state !== "passed" ||
      !sameJson(retained, terminal) ||
      !sameJson(retained.authority, capture.expected.authority)
    ) {
      throw new Error(
        "Asset-update V8 retained terminal is not the exact passed publication/authority",
      );
    }
    terminalPublished = true;
    process.stdout.write(
      `${reservation.jsonPath}\n${reservation.markdownPath}\n${JSON.stringify(retained, null, 2)}\n`,
    );
  } catch (error: unknown) {
    let primaryFailure = error;
    if (!terminalPublished) {
      const failed = failedEvidence({
        authority,
        companionPath: basename(reservation.markdownPath),
        error,
        partialResult,
        phase,
        postValidationPerformed,
        reservationId: reservation.reservationId,
        startedAt,
      });
      try {
        await reservation.publishTerminal(failed, (failurePhase, publicationError) =>
          failedEvidence({
            authority,
            companionPath: basename(reservation.markdownPath),
            error: publicationError,
            partialResult,
            phase: publicationFailurePhase(failurePhase),
            postValidationPerformed,
            reservationId: reservation.reservationId,
            startedAt,
          }),
        );
        terminalPublished = true;
      } catch (publicationError: unknown) {
        primaryFailure = publicationError;
      }
    }
    if (!terminalPublished) {
      await closeAssetUpdateV8ResultAfterFailure(reservation, primaryFailure);
    }
    throw primaryFailure;
  }
}

async function runLifecycle(input: {
  readonly baseBuild: ValidatedBuildManifest;
  readonly executable: string;
  readonly executableSha256: string;
  readonly machineDescriptor: MachineDescriptor;
  readonly machineDescriptorBytes: Buffer;
  readonly onPhase: (phase: RunPhase) => void;
  readonly pinVersion: string;
  readonly source: AssetUpdateRunAuthority["source"];
}): Promise<LifecycleCapture> {
  const fixtureParent = await mkdtemp(join(tmpdir(), "parallax-asset-update-fixture-"));
  const servingParent = await mkdtemp(join(tmpdir(), "parallax-asset-update-serving-"));
  const profilePath = await mkdtemp(join(tmpdir(), "parallax-asset-update-profile-"));
  const postRoot = join(fixtureParent, "post");
  const servingRoot = join(servingParent, "www");
  const persistentProfileId = randomUUID();
  let server: ReturnType<typeof createLocalServer> | null = null;
  const serverJournal: LocalServerDetailedJournalEntry[] = [];
  let serverJournalOverflowed = false;
  let updateJournalStart = -1;
  const lifecycleStartedAt = performance.now();
  let lastLifecycleAt = 0;
  let lifecycleFailure: unknown | null = null;
  const lifecycleEvents: AssetUpdateLifecycleResult["lifecycle"][number][] = [];
  const recordLifecycle = (
    name: AssetUpdateLifecycleResult["lifecycle"][number]["name"],
    releaseDigest: string,
  ): void => {
    const completedAtMs = Math.max(performance.now() - lifecycleStartedAt, lastLifecycleAt);
    lastLifecycleAt = completedAtMs;
    lifecycleEvents.push(
      Object.freeze({
        completedAtMs,
        name,
        persistentProfileId,
        releaseDigest,
        sequence: lifecycleEvents.length + 1,
      }),
    );
  };
  try {
    const fixture = await createAssetOnlyUpdateFixture(buildRoot, postRoot);
    if (
      fixture.pre.artifactDigest !== input.baseBuild.artifactDigest ||
      fixture.pre.releaseDigest !== input.baseBuild.releaseDigest
    ) {
      throw new Error("Asset-only fixture pre-release differs from the run base build");
    }
    await prepareServingRoot(buildRoot, servingRoot);
    server = createLocalServer({
      exactRangeResources: combinedExactRangeResources(fixture),
      onDetailedResponse: (entry) => {
        if (serverJournal.length < MAX_UPDATE_SERVER_JOURNAL_ENTRIES) {
          serverJournal.push(entry);
        } else {
          serverJournalOverflowed = true;
        }
      },
      root: servingRoot,
    });
    const address = await listenLocalServer(server);
    const origin = `http://127.0.0.1:${address.port}`;
    const preRelease = await releaseAuthority(buildRoot, fixture.pre);
    const postRelease = await releaseAuthority(postRoot, fixture.post);
    input.onPhase("target");
    const targetPre = await observeTarget(origin, preRelease, fixture.pre, servingRoot);
    const scripts = await readV8ScriptArtifacts(buildRoot, fixture.pre);
    const wasmArtifact = threadedWasmArtifact(fixture.pre);

    const sequence = await runAssetUpdateV8ProfileSequence({
      initialInstall: () => {
        input.onPhase("initial-install");
        return withPersistentContext(input.executable, profilePath, async (context) => {
          const browser = await inspectBrowser(context, input.pinVersion);
          const page = context.pages()[0] ?? (await context.newPage());
          await page.goto(`${origin}/`, { waitUntil: "load" });
          const environment = await inspectMachineEnvironment(context, page);
          await waitForCheckingToSettle(page);
          const state = await installerUiState(page);
          if (state.state !== "idle" || !state.installEnabled || state.launchEnabled) {
            throw new Error("Fresh ordinary installer did not expose the exact idle install state");
          }
          const initialInstall = await captureInitialInstallExit(
            context,
            page,
            fixture.pre.installManifest,
            requireInstallerWorkerSource(fixture.pre),
            installControlIdentities(preRelease),
          );
          const ready = await collectReadyAuthority(page, preRelease, null);
          recordLifecycle("initial-install-ready", preRelease.releaseDigest);
          return Object.freeze({
            browser,
            environment,
            initialInstall,
            ready: ready.ready,
            transfer: ready.installerTransfer,
          });
        });
      },
      freshLaunch: async () => {
        input.onPhase("fresh");
        const capture = await captureFreshLaunch({
          executable: input.executable,
          expectedRelease: preRelease,
          origin,
          persistentProfileId,
          profilePath,
          scripts,
          wasmArtifact,
        });
        recordLifecycle("fresh-launch-interactive", preRelease.releaseDigest);
        return capture;
      },
      postDiagnosticLaunch: async () => {
        input.onPhase("post-diagnostic");
        const capture = await captureDiagnosticLaunch({
          executable: input.executable,
          expectedRelease: postRelease,
          origin,
          persistentProfileId,
          phase: "post-warm",
          profilePath,
          runtimeOrdinal: 6,
          scripts,
          wasmArtifact,
        });
        recordLifecycle("post-diagnostic-complete", postRelease.releaseDigest);
        return capture;
      },
      postWarmLaunch: () => {
        input.onPhase("post-warm");
        return captureMeasuredLaunch({
          cacheState: "stable-consume",
          captureEnvironment: true,
          executable: input.executable,
          expectedPreviousReleaseDigest: preRelease.releaseDigest,
          expectedRelease: postRelease,
          ordinal: 5,
          origin,
          phase: "post-warm",
          profilePath,
        }).then((capture) => {
          recordLifecycle("post-warm-launch-interactive", postRelease.releaseDigest);
          return capture;
        });
      },
      preDiagnosticLaunch: async () => {
        input.onPhase("pre-diagnostic");
        const capture = await captureDiagnosticLaunch({
          executable: input.executable,
          expectedRelease: preRelease,
          origin,
          persistentProfileId,
          phase: "pre-warm",
          profilePath,
          runtimeOrdinal: 3,
          scripts,
          wasmArtifact,
        });
        recordLifecycle("pre-diagnostic-complete", preRelease.releaseDigest);
        return capture;
      },
      preWarmLaunch: () => {
        input.onPhase("pre-warm");
        return captureMeasuredLaunch({
          cacheState: "stable-consume",
          captureEnvironment: false,
          executable: input.executable,
          expectedPreviousReleaseDigest: null,
          expectedRelease: preRelease,
          ordinal: 4,
          origin,
          phase: "pre-warm",
          profilePath,
        }).then((capture) => {
          recordLifecycle("pre-warm-launch-interactive", preRelease.releaseDigest);
          return capture;
        });
      },
      produceLaunch: async () => {
        input.onPhase("produce");
        const capture = await captureDiagnosticLaunch({
          executable: input.executable,
          expectedRelease: preRelease,
          origin,
          persistentProfileId,
          phase: "produce",
          profilePath,
          runtimeOrdinal: 2,
          scripts,
          wasmArtifact,
        });
        recordLifecycle("produce-diagnostic-complete", preRelease.releaseDigest);
        return capture;
      },
      publishAssetUpdate: async () => {
        input.onPhase("update");
        await publishAssetOnlyUpdateFixture(servingRoot, postRoot, fixture);
        serverJournal.length = 0;
        serverJournalOverflowed = false;
        updateJournalStart = 0;
        recordLifecycle("asset-update-published", postRelease.releaseDigest);
      },
      updateReady: async () => {
        input.onPhase("update");
        const capture = await capturePostUpdateReady({
          executable: input.executable,
          expectedRelease: postRelease,
          origin,
          preRelease,
          profilePath,
        });
        await waitForServerJournalQuiescence(serverJournal);
        if (updateJournalStart < 0 || serverJournalOverflowed) {
          throw new Error("Update server journal boundary is unavailable or overflowed");
        }
        const entries = serverJournal.slice(updateJournalStart);
        if (entries.length === 0 || entries.length > MAX_UPDATE_SERVER_JOURNAL_ENTRIES) {
          throw new Error("Update server journal is absent or exceeds its exact bound");
        }
        recordLifecycle("update-ready", postRelease.releaseDigest);
        return Object.freeze({
          ...capture,
          journal: Object.freeze(
            entries.map((entry, index) =>
              Object.freeze({
                bodyBytes: entry.bodyBytes,
                cacheControl: entry.cacheControl,
                coep: entry.coep,
                contentType: entry.contentType,
                coop: entry.coop,
                etag: entry.etag,
                ifNoneMatch: entry.ifNoneMatch,
                ifRange: entry.ifRange,
                method: entry.method,
                nosniff: entry.nosniff,
                path: entry.path,
                range: entry.range,
                sequence: index + 1,
                status: entry.status,
              }),
            ),
          ),
        });
      },
    });
    const { fresh, initial, post, postDiagnostic, pre, preDiagnostic, produce, update } = sequence;
    input.onPhase("target");
    const targetPost = await observeTarget(origin, postRelease, fixture.post, servingRoot);
    input.onPhase("browser");
    requireSameBrowser(
      [initial.browser, fresh.browser, pre.browser, update.browser, post.browser],
      input.pinVersion,
    );
    input.onPhase("authority");
    if (post.environment === null) {
      throw new Error("Post-update registered-environment observation was not captured");
    }
    const preGate = requireMeasuredMachineGate(input.machineDescriptor, initial.environment, "pre");
    const postGate = requireMeasuredMachineGate(input.machineDescriptor, post.environment, "post");

    const browser: AssetUpdateRunAuthority["browser"] = Object.freeze({
      ...initial.browser,
      executableSha256: input.executableSha256,
    });
    const authority: AssetUpdateRunAuthority = Object.freeze({
      baseBuild: Object.freeze({
        artifactDigest: preRelease.artifactDigest,
        releaseDigest: preRelease.releaseDigest,
      }),
      browser,
      machine: Object.freeze({
        descriptorBase64: input.machineDescriptorBytes.toString("base64"),
        descriptorSha256: sha256(input.machineDescriptorBytes),
        gate: Object.freeze({
          post: postGate,
          pre: preGate,
        }),
        id: machineId,
        postObservation: post.environment,
        preObservation: initial.environment,
      }),
      persistentProfileId,
      source: input.source,
      targetOrigin: origin,
    });
    const lifecycle = Object.freeze([...lifecycleEvents]);
    const result: AssetUpdateLifecycleResult = Object.freeze({
      analysis: fixture.analysis,
      deltaMs: post.launch.lifecycle.durationMs - pre.launch.lifecycle.durationMs,
      initialInstall: initial.initialInstall,
      launches: Object.freeze({
        fresh: withProfile(fresh.launch, persistentProfileId),
        post: withProfile(post.launch, persistentProfileId),
        pre: withProfile(pre.launch, persistentProfileId),
      }),
      lifecycle,
      postRelease,
      preRelease,
      publication: Object.freeze({
        postReady: update.ready,
        postTransfer: update.transfer,
        preReady: initial.ready,
        preTransfer: initial.transfer,
        updateServerJournal: Object.freeze({
          entries: update.journal,
          maximumEntries: MAX_UPDATE_SERVER_JOURNAL_ENTRIES,
          overflowed: false as const,
        }),
        updateDiscovery: Object.freeze({
          code: "shell-release-mismatch" as const,
          recovery: "retry" as const,
          state: "failed" as const,
        }),
      }),
      relativeRegressionThreshold: null,
      target: Object.freeze({ post: targetPost, pre: targetPre }),
      v8: Object.freeze({
        fresh: fresh.diagnostics,
        post: postDiagnostic.diagnostics,
        pre: preDiagnostic.diagnostics,
        produce: produce.diagnostics,
      }),
      warmLaunchBudgetMs: WARM_LAUNCH_BUDGET_MS,
    });
    const expected: AssetUpdateExpectedAuthority = Object.freeze({
      authority,
      postArtifactDigest: postRelease.artifactDigest,
      postReleaseDigest: postRelease.releaseDigest,
    });
    const capture: LifecycleCapture = Object.freeze({
      authority,
      expected,
      postValidationReady: null,
      postValidationTarget: null,
      result,
    });
    const installBudgetExceeded =
      initial.initialInstall.networkIdleLocalCriticalPathMs >
      initial.initialInstall.networkIdleLocalCriticalPathBudgetMs;
    if (
      installBudgetExceeded ||
      fresh.budgetExceeded ||
      pre.budgetExceeded ||
      post.budgetExceeded
    ) {
      throw new LifecycleMeasurementError(
        capture,
        installBudgetExceeded
          ? "initial-install"
          : fresh.budgetExceeded
            ? "fresh"
            : pre.budgetExceeded
              ? "pre-warm"
              : "post-warm",
      );
    }
    let finalTarget: AssetUpdateTargetObservation;
    let finalReady: Readonly<{
      readonly browser: BrowserIdentity;
      readonly ready: AssetUpdateReadyAuthority;
    }>;
    try {
      input.onPhase("post-validation");
      const finalFixture = await readAndValidateBuildManifest(postRoot);
      await verifyPublishedAssetOnlyFixture(servingRoot, fixture);
      finalTarget = await observeTarget(origin, postRelease, fixture.post, servingRoot);
      finalReady = await captureReadyPostValidation({
        executable: input.executable,
        expectedRelease: postRelease,
        origin,
        preRelease,
        profilePath,
      });
      if (
        finalFixture.artifactDigest !== fixture.post.artifactDigest ||
        finalFixture.releaseDigest !== fixture.post.releaseDigest ||
        !sameJson(finalTarget, targetPost) ||
        !sameJson(finalReady.browser, initial.browser) ||
        !sameJson(finalReady.ready, update.ready)
      ) {
        throw new Error(
          "Asset-update V8 fixture, target, or publication authority changed after the lifecycle",
        );
      }
    } catch (error: unknown) {
      throw new LifecyclePostValidationError(capture, error);
    }
    return Object.freeze({
      ...capture,
      postValidationReady: finalReady.ready,
      postValidationTarget: finalTarget,
    });
  } catch (error: unknown) {
    lifecycleFailure = error;
    throw error;
  } finally {
    const cleanupServer = server;
    await finalizeCleanup(
      lifecycleFailure,
      [
        ...(cleanupServer === null
          ? []
          : ([{ label: "server", run: () => stopLocalServer(cleanupServer) }] as const)),
        {
          label: "profile",
          run: () => rm(profilePath, RETRYING_RECURSIVE_REMOVE_OPTIONS),
        },
        {
          label: "serving root",
          run: () => rm(servingParent, RETRYING_RECURSIVE_REMOVE_OPTIONS),
        },
        {
          label: "fixture root",
          run: () => rm(fixtureParent, RETRYING_RECURSIVE_REMOVE_OPTIONS),
        },
      ],
      "Asset-update lifecycle cleanup failed",
    );
  }
}

async function captureMeasuredLaunch(input: {
  readonly cacheState: AssetUpdateV8LaunchEvidence["cacheState"];
  readonly captureEnvironment: boolean;
  readonly executable: string;
  readonly expectedPreviousReleaseDigest: string | null;
  readonly expectedRelease: AssetUpdateReleaseAuthority;
  readonly ordinal: 1 | 4 | 5;
  readonly origin: string;
  readonly phase: "fresh" | "post-warm" | "pre-warm";
  readonly profilePath: string;
}): Promise<MeasuredLaunchCapture> {
  return withPersistentContext(input.executable, input.profilePath, async (context) => {
    const browser = await inspectBrowser(context);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${input.origin}/`, { waitUntil: "load" });
    await waitForReady(page, 30_000);
    const ready = await collectReadyAuthority(
      page,
      input.expectedRelease,
      input.expectedPreviousReleaseDigest,
    );
    const lifecycle = await clickLaunchAndWait(page);
    const budgetExceeded = input.phase !== "fresh" && lifecycle.durationMs > WARM_LAUNCH_BUDGET_MS;
    const environment = input.captureEnvironment
      ? await inspectMachineEnvironment(context, page)
      : null;
    return Object.freeze({
      browser,
      budgetExceeded,
      environment,
      launch: Object.freeze({
        cacheState: input.cacheState,
        lifecycle,
        ordinal: input.ordinal,
        persistentProfileId: "00000000-0000-0000-0000-000000000000",
        phase: input.phase,
        releaseDigest: input.expectedRelease.releaseDigest,
      }),
      ready: ready.ready,
    });
  });
}

async function captureFreshLaunch(input: {
  readonly executable: string;
  readonly expectedRelease: AssetUpdateReleaseAuthority;
  readonly origin: string;
  readonly persistentProfileId: string;
  readonly profilePath: string;
  readonly scripts: readonly V8ScriptArtifact[];
  readonly wasmArtifact: Readonly<{
    readonly bytes: number;
    readonly path: string;
    readonly sha256: string;
  }>;
}): Promise<FreshLaunchCapture> {
  return withPersistentContext(input.executable, input.profilePath, async (context) => {
    const browser = await inspectBrowser(context);
    const trace = await tryBeginTrace(context);
    const page = context.pages()[0] ?? (await context.newPage());
    try {
      await page.goto(`${input.origin}/`, { waitUntil: "load" });
      await waitForReady(page, 30_000);
      const ready = await collectReadyAuthority(page, input.expectedRelease, null);
      const lifecycle = await clickLaunchAndWait(page);
      await waitForWasmStreamingDiagnostic(page);
      await page.waitForTimeout(V8_DIAGNOSTIC_SETTLE_MS);
      let telemetry: ParallaxTelemetrySnapshot | null = null;
      let telemetryFailure: string | null = null;
      try {
        telemetry = await readTelemetry(page);
      } catch (error: unknown) {
        telemetryFailure = boundedMessage(error);
      }
      return Object.freeze({
        browser,
        budgetExceeded: lifecycle.durationMs > FRESH_INSTALLED_LAUNCH_BUDGET_MS,
        diagnostics: diagnostics(
          "fresh",
          input.origin,
          input.persistentProfileId,
          1,
          input.scripts,
          await finishTrace(trace),
          telemetry,
          input.wasmArtifact,
          telemetryFailure,
        ),
        environment: null,
        launch: Object.freeze({
          cacheState: "setup" as const,
          lifecycle,
          ordinal: 1 as const,
          persistentProfileId: input.persistentProfileId,
          phase: "fresh" as const,
          releaseDigest: input.expectedRelease.releaseDigest,
        }),
        ready: ready.ready,
      });
    } catch (error: unknown) {
      try {
        await trace.capture?.discard();
      } catch {
        // The fresh runtime launch is a required setup boundary; auxiliary trace cleanup
        // cannot replace its concrete navigation/launch failure.
      }
      throw error;
    }
  });
}

async function captureDiagnosticLaunch(input: {
  readonly executable: string;
  readonly expectedRelease: AssetUpdateReleaseAuthority;
  readonly origin: string;
  readonly persistentProfileId: string;
  readonly phase: "post-warm" | "pre-warm" | "produce";
  readonly profilePath: string;
  readonly runtimeOrdinal: 2 | 3 | 6;
  readonly scripts: readonly V8ScriptArtifact[];
  readonly wasmArtifact: Readonly<{
    readonly bytes: number;
    readonly path: string;
    readonly sha256: string;
  }>;
}): Promise<DiagnosticCapture> {
  return requireAssetUpdateDiagnosticLaunch(input.phase, () =>
    withPersistentContext(input.executable, input.profilePath, async (context) => {
      const trace = await tryBeginTrace(context);
      const page = context.pages()[0] ?? (await context.newPage());
      try {
        await page.goto(`${input.origin}/`, { waitUntil: "load" });
        await waitForReady(page, 30_000);
        await clickLaunchAndWait(page);
        await waitForWasmStreamingDiagnostic(page);
        await page.waitForTimeout(V8_DIAGNOSTIC_SETTLE_MS);
        let telemetry: ParallaxTelemetrySnapshot | null = null;
        let telemetryFailure: string | null = null;
        try {
          telemetry = await readTelemetry(page);
        } catch (error: unknown) {
          telemetryFailure = boundedMessage(error);
        }
        const traceResult = await finishTrace(trace);
        return Object.freeze({
          diagnostics: diagnostics(
            input.phase,
            input.origin,
            input.persistentProfileId,
            input.runtimeOrdinal,
            input.scripts,
            traceResult,
            telemetry,
            input.wasmArtifact,
            telemetryFailure,
          ),
        });
      } catch (error: unknown) {
        try {
          await trace.capture?.discard();
        } catch {
          // The required launch failure remains authoritative over trace cleanup.
        }
        throw new Error(`Diagnostic navigation failed: ${boundedMessage(error)}`, { cause: error });
      }
    }),
  );
}

async function capturePostUpdateReady(input: {
  readonly executable: string;
  readonly expectedRelease: AssetUpdateReleaseAuthority;
  readonly origin: string;
  readonly preRelease: AssetUpdateReleaseAuthority;
  readonly profilePath: string;
}): Promise<
  Readonly<{
    readonly browser: BrowserIdentity;
    readonly ready: AssetUpdateReadyAuthority;
    readonly transfer: InstallerTransferTelemetrySnapshot;
  }>
> {
  return withPersistentContext(input.executable, input.profilePath, async (context) => {
    const browser = await inspectBrowser(context);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${input.origin}/`, { waitUntil: "load" });
    await page.waitForFunction(
      () => document.querySelector("#installer-shell")?.getAttribute("data-state") === "failed",
      undefined,
      { timeout: 30_000 },
    );
    const discovery = await installerUiState(page);
    if (
      discovery.failureCode !== "shell-release-mismatch" ||
      discovery.failureRecovery !== "retry" ||
      !discovery.installEnabled ||
      discovery.launchEnabled
    ) {
      throw new Error("Ordinary asset update did not expose exact mismatch-to-retry discovery");
    }
    await page.locator("#installer-start").click();
    await waitForReady(page, INSTALL_COMPLETION_TIMEOUT_MS);
    const ready = await collectReadyAuthority(
      page,
      input.expectedRelease,
      input.preRelease.releaseDigest,
    );
    return Object.freeze({
      browser,
      ready: ready.ready,
      transfer: ready.installerTransfer,
    });
  });
}

async function captureReadyPostValidation(input: {
  readonly executable: string;
  readonly expectedRelease: AssetUpdateReleaseAuthority;
  readonly origin: string;
  readonly preRelease: AssetUpdateReleaseAuthority;
  readonly profilePath: string;
}): Promise<
  Readonly<{ readonly browser: BrowserIdentity; readonly ready: AssetUpdateReadyAuthority }>
> {
  return withPersistentContext(input.executable, input.profilePath, async (context) => {
    const browser = await inspectBrowser(context);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${input.origin}/`, { waitUntil: "load" });
    await waitForReady(page, 30_000);
    const ready = await collectReadyAuthority(
      page,
      input.expectedRelease,
      input.preRelease.releaseDigest,
    );
    return Object.freeze({ browser, ready: ready.ready });
  });
}

async function withPersistentContext<T>(
  executable: string,
  profilePath: string,
  run: (context: BrowserContext) => Promise<T>,
): Promise<T> {
  const context = await launchAfterPhysicalConsoleDisplayWake(() =>
    launchPersistentChrome(executable, profilePath, ["--enable-webgpu-developer-features"]),
  );
  try {
    return await run(context);
  } finally {
    await context.close();
  }
}

async function inspectBrowser(
  context: BrowserContext,
  expectedVersion?: string,
): Promise<BrowserIdentity> {
  const browser = context.browser();
  if (browser === null) throw new Error("Playwright did not expose the launched browser");
  const session = await browser.newBrowserCDPSession();
  try {
    const version = (await session.send("Browser.getVersion")) as {
      jsVersion: string;
      product: string;
      protocolVersion: string;
      revision: string;
      userAgent: string;
    };
    const actualVersion = version.product.replace(/^Chrome\//, "");
    if (expectedVersion !== undefined && actualVersion !== expectedVersion) {
      throw new Error(
        `Chrome version mismatch: expected ${expectedVersion}, received ${actualVersion}`,
      );
    }
    if (version.protocolVersion !== "1.3") {
      throw new Error(
        `Chrome CDP protocol version mismatch: expected 1.3, received ${version.protocolVersion}`,
      );
    }
    validateChromeSandboxCommandLine(await readChromeCommandLine(context));
    return Object.freeze({
      jsVersion: version.jsVersion,
      product: version.product,
      protocolVersion: version.protocolVersion,
      revision: version.revision,
      userAgent: version.userAgent,
      version: actualVersion,
    });
  } finally {
    await session.detach();
  }
}

async function inspectMachineEnvironment(
  context: BrowserContext,
  page: Page,
): Promise<GateEnvironmentObservation> {
  const hostResultPromise = tryReadWindowsHostIdentity();
  const browser = context.browser();
  if (browser === null) throw new Error("Playwright did not expose the launched browser");
  const session = await browser.newBrowserCDPSession();
  try {
    const systemInfo = requireRecord(
      await session.send("SystemInfo.getInfo"),
      "SystemInfo.getInfo",
    );
    const gpu = requireRecord(systemInfo.gpu, "SystemInfo.getInfo GPU");
    if (!Array.isArray(gpu.devices)) throw new Error("CDP did not report a GPU device list");
    const rawPrimaryGpu = gpu.devices[0];
    if (rawPrimaryGpu === undefined) throw new Error("CDP did not report a primary GPU");
    const primaryGpu = projectCdpGpuDevice(rawPrimaryGpu);
    const [adapter, browserDisplay, hostResult] = await Promise.all([
      readWebGpuAdapterIdentity(page),
      readBrowserDisplayIdentity(context, page),
      hostResultPromise,
    ]);
    if (hostResult.state !== "measured") {
      throw new Error(hostResult.reason);
    }
    return Object.freeze({
      adapter,
      arch: process.arch,
      browserDisplay,
      host: hostResult.host,
      platform: process.platform,
      primaryGpu,
      requestedTier: "showcase" as const,
    });
  } finally {
    await session.detach();
  }
}

function requireMeasuredMachineGate(
  descriptor: MachineDescriptor,
  observation: GateEnvironmentObservation,
  phase: "post" | "pre",
): Readonly<{ readonly state: "measured"; readonly value: true }> {
  const gate = evaluateGateEnvironment(descriptor, observation);
  if (gate.state !== "measured") {
    throw new Error(`${phase} registered-environment gate failed: ${gate.reasons.join("; ")}`);
  }
  return gate;
}

function requireSameBrowser(
  observations: readonly BrowserIdentity[],
  expectedVersion: string,
): void {
  const baseline = observations[0];
  if (
    baseline === undefined ||
    baseline.version !== expectedVersion ||
    observations.some((observation) => !sameJson(observation, baseline))
  ) {
    throw new Error("Browser authority changed across persistent-profile lifecycle boundaries");
  }
}

async function clickLaunchAndWait(page: Page): Promise<AssetUpdateV8LaunchEvidence["lifecycle"]> {
  await page.locator("#installer-launch").click();
  await page.waitForFunction(
    () => {
      const read = (
        globalThis as unknown as {
          __parallaxLaunchLifecycleV2?: () => { state?: unknown };
        }
      ).__parallaxLaunchLifecycleV2;
      const state = read?.().state;
      return state === "interactive" || state === "failed";
    },
    undefined,
    { timeout: LAUNCH_COMPLETION_TIMEOUT_MS },
  );
  const lifecycle = await page.evaluate(() => {
    const read = (
      globalThis as unknown as {
        __parallaxLaunchLifecycleV2?: () => unknown;
      }
    ).__parallaxLaunchLifecycleV2;
    if (read === undefined) throw new Error("Launch lifecycle diagnostics are unavailable");
    return read();
  });
  const snapshot = requireRecord(lifecycle, "Launch lifecycle diagnostics");
  if (snapshot.state !== "interactive") {
    throw new Error(
      `Launch-to-interactive failed: ${
        typeof snapshot.failureMessage === "string"
          ? boundedMessage(snapshot.failureMessage)
          : "missing failure diagnostic"
      }`,
    );
  }
  return lifecycle as AssetUpdateV8LaunchEvidence["lifecycle"];
}

async function waitForWasmStreamingDiagnostic(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const telemetry = Reflect.get(globalThis, "__PARALLAX_TELEMETRY__") as
          | {
              snapshot(): {
                wasmThreadSpike: {
                  moduleLoadAndCompileElapsedMs: number | null;
                  state: string;
                };
              };
            }
          | undefined;
        if (telemetry === undefined) return false;
        const wasm = telemetry.snapshot().wasmThreadSpike;
        return wasm.moduleLoadAndCompileElapsedMs !== null || wasm.state === "failed";
      },
      undefined,
      { timeout: 15_000 },
    )
    .catch(() => undefined);
}

function diagnostics(
  phase: AssetUpdateV8Diagnostics["phase"],
  origin: string,
  persistentProfileId: string,
  runtimeOrdinal: AssetUpdateV8Diagnostics["runtimeOrdinal"],
  scripts: readonly V8ScriptArtifact[],
  trace: V8TraceCaptureResult,
  telemetry: ParallaxTelemetrySnapshot | null,
  wasmArtifact: Readonly<{
    readonly bytes: number;
    readonly path: string;
    readonly sha256: string;
  }>,
  telemetryFailure: string | null = null,
): AssetUpdateV8Diagnostics {
  const profile = phase === "fresh" ? "fresh" : phase === "produce" ? "produce" : "warm";
  const traceFailure =
    trace.trace.state === "invalid" ? (trace.trace.reason ?? "V8 trace capture is invalid") : null;
  const mixedLineageReason =
    phase === "fresh" || phase === "produce"
      ? `Initial installer navigation preloads app, engine, game, and installer scripts, so the ${phase} runtime trace has mixed per-artifact cache lineages; no uniform D-040 ${profile} attribution is claimed`
      : null;
  const cache =
    traceFailure === null
      ? mixedLineageReason === null
        ? resolveV8CodeCacheEvidence(trace.events, `${origin}/`, scripts, profile)
        : Object.freeze({
            evidence: null,
            reason: mixedLineageReason,
            state: "invalid" as const,
          })
      : Object.freeze({
          evidence: null,
          reason: boundedMessage(`V8 trace is invalid: ${traceFailure}`),
          state: "invalid" as const,
        });
  const production =
    traceFailure === null
      ? mixedLineageReason === null
        ? resolveV8CodeCacheProductionEvidence(trace.events, `${origin}/`, scripts, profile)
        : Object.freeze({
            evidence: null,
            reason: mixedLineageReason,
            state: "invalid" as const,
          })
      : Object.freeze({
          evidence: null,
          reason: boundedMessage(`V8 trace is invalid: ${traceFailure}`),
          state: "invalid" as const,
        });
  return Object.freeze({
    cache,
    phase,
    persistentProfileId,
    production,
    profile,
    runtimeOrdinal,
    scriptArtifacts: scripts,
    trace: trace.trace,
    wasmStreaming: Object.freeze(
      phase === "fresh"
        ? {
            api: "compileStreaming" as const,
            artifact: wasmArtifact,
            durationMs: null,
            reason:
              "Fresh runtime launch establishes the cache lineage; threaded-Wasm duration is evaluated on later diagnostic launches",
            state: "not-applicable" as const,
          }
        : telemetry?.wasmThreadSpike.moduleLoadAndCompileElapsedMs !== null &&
            telemetry?.wasmThreadSpike.moduleLoadAndCompileElapsedMs !== undefined
          ? {
              api: "compileStreaming" as const,
              artifact: wasmArtifact,
              durationMs: telemetry.wasmThreadSpike.moduleLoadAndCompileElapsedMs,
              reason: null,
              state: "measured" as const,
            }
          : {
              api: "compileStreaming" as const,
              artifact: wasmArtifact,
              durationMs: null,
              reason:
                telemetryFailure === null
                  ? `Threaded-Wasm streaming did not complete; runtime state ${telemetry?.wasmThreadSpike.state ?? "unavailable"}`
                  : boundedMessage(`Telemetry read failed: ${telemetryFailure}`),
              state: "invalid" as const,
            },
    ),
    workerStartupToFirstFrameMs: telemetry?.render.workerStartupToFirstFrameMs ?? null,
  });
}

function threadedWasmArtifact(
  build: ValidatedBuildManifest,
): Readonly<{ readonly bytes: number; readonly path: string; readonly sha256: string }> {
  const matches = build.installManifest.resources.filter(
    ({ kind, source }) =>
      kind === "wasm" && /^immutable\/wasm-thread-spike-[a-f0-9]{64}\.wasm$/.test(source),
  );
  const resource = matches[0];
  if (matches.length !== 1 || resource === undefined) {
    throw new Error("Build does not contain the exact threaded-Wasm streaming artifact");
  }
  return Object.freeze({
    bytes: resource.bytes,
    path: resource.source,
    sha256: resource.sha256,
  });
}

async function tryBeginTrace(
  context: BrowserContext,
): Promise<Readonly<{ capture: V8TraceCapture | null; failure: string | null }>> {
  try {
    return Object.freeze({ capture: await beginV8TraceCapture(context), failure: null });
  } catch (error: unknown) {
    return Object.freeze({ capture: null, failure: boundedMessage(error) });
  }
}

async function finishTrace(
  trace: Readonly<{ capture: V8TraceCapture | null; failure: string | null }>,
): Promise<V8TraceCaptureResult> {
  if (trace.capture === null) {
    return invalidV8Trace(trace.failure ?? "V8 trace capture was unavailable");
  }
  try {
    return await trace.capture.finish();
  } catch (error: unknown) {
    return invalidV8Trace(boundedMessage(error));
  }
}

async function collectReadyAuthority(
  page: Page,
  release: AssetUpdateReleaseAuthority,
  previousReleaseDigest: string | null,
): Promise<
  Readonly<{
    readonly installerTransfer: InstallerTransferTelemetrySnapshot;
    readonly ready: AssetUpdateReadyAuthority;
  }>
> {
  const snapshot = await page.evaluate(() => {
    const root = document.querySelector("#installer-shell");
    const launch = document.querySelector("#installer-launch");
    const read = (
      globalThis as unknown as {
        __parallaxInstallerDiagnosticsV1?: () => unknown;
      }
    ).__parallaxInstallerDiagnosticsV1;
    if (
      !(root instanceof HTMLElement) ||
      !(launch instanceof HTMLButtonElement) ||
      read === undefined
    ) {
      throw new Error("Ordinary Ready authority diagnostics are unavailable");
    }
    return {
      launchEnabled: !launch.disabled,
      snapshot: read(),
      uiState: root.dataset.state ?? null,
    };
  });
  const diagnostic = requireRecord(snapshot.snapshot, "installer diagnostics");
  const installer = requireRecord(diagnostic.installer, "installer diagnostics installer");
  const store = requireRecord(installer.installStore, "installer installStore");
  const transfer = requireRecord(installer.installerTransfer, "installer transfer");
  const parsedTransfer = parseInstallerTransferTelemetry(transfer);
  const shell = requireRecord(diagnostic.offlineShell, "offline shell");
  const generationId = `${release.artifactDigest}:${release.releaseDigest}`;
  const ready: AssetUpdateReadyAuthority = Object.freeze({
    artifactDigest: release.artifactDigest,
    generationId,
    installStore: Object.freeze({
      activeReleaseDigest: String(store.activeReleaseDigest),
      previousReleaseDigest:
        store.previousReleaseDigest === null ? null : String(store.previousReleaseDigest),
      state: "ready" as const,
    }),
    launchEnabled: true,
    offlineShell: Object.freeze({
      activeArtifactDigest: String(shell.activeArtifactDigest),
      activeGenerationId: String(shell.activeGenerationId),
      activeReleaseDigest: String(shell.activeReleaseDigest),
      state: "active" as const,
    }),
    releaseDigest: release.releaseDigest,
    uiState: "ready",
  });
  if (
    snapshot.launchEnabled !== true ||
    snapshot.uiState !== "ready" ||
    store.state !== "ready" ||
    store.activeReleaseDigest !== release.releaseDigest ||
    store.previousReleaseDigest !== previousReleaseDigest ||
    shell.state !== "active" ||
    shell.activeArtifactDigest !== release.artifactDigest ||
    shell.activeGenerationId !== generationId ||
    shell.activeReleaseDigest !== release.releaseDigest
  ) {
    throw new Error("Ordinary Ready did not bind exact durable store/offline-shell authority");
  }
  return Object.freeze({ installerTransfer: parsedTransfer, ready });
}

async function waitForCheckingToSettle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const state = document.querySelector("#installer-shell")?.getAttribute("data-state");
      return state !== undefined && state !== null && state !== "checking";
    },
    undefined,
    { timeout: 30_000 },
  );
}

async function waitForReady(page: Page, timeout: number): Promise<void> {
  await page.waitForFunction(
    () => document.querySelector("#installer-shell")?.getAttribute("data-state") === "ready",
    undefined,
    { timeout },
  );
}

async function captureInitialInstallExit(
  context: BrowserContext,
  page: Page,
  manifest: InstallManifest,
  installerWorkerSource: string,
  controls: readonly InstallControlIdentity[],
): Promise<InitialInstallExitEvidence> {
  const capture = createInstallCdpNetworkCapture(page.url(), manifest, controls);
  let session: Awaited<ReturnType<BrowserContext["newCDPSession"]>> | null = null;
  let worker: InstallerWorkerNetworkAttachment | null = null;
  let verification: FinalVerificationObservation | null = null;
  let result: InitialInstallExitEvidence | null = null;
  let primaryFailure: unknown = null;
  try {
    session = await context.newCDPSession(page);
    worker = await attachInstallerWorkerNetwork(
      session,
      new URL(installerWorkerSource, page.url()).href,
      capture,
    );
    verification = await beginFinalVerificationObservation(page);
    const installStartedAtMs = performance.now();
    await page.locator("#installer-start").click();
    const readyAt = waitForReady(page, INSTALL_COMPLETION_TIMEOUT_MS).then(() => performance.now());
    const installReadyAtMs = await readyAt;
    const observed = await withBoundedCdpWait(
      verification.result,
      "Final-verification complete observation",
    );
    await worker.disable();
    const requests = capture.finish();
    result = buildInitialInstallExitEvidence({
      controlRequests: requests.controlRequests,
      controls,
      finalVerificationFirstObservedCompleteAtMs: observed.completeAtMs,
      finalVerificationFirstObservedVerifyingAtMs: observed.verifyingAtMs,
      installReadyAtMs,
      installStartedAtMs,
      installerWorkerSource,
      manifest,
      resourceRequests: requests.resourceRequests,
    });
  } catch (error: unknown) {
    primaryFailure = error;
  }
  const observationCleanupFailures: unknown[] = [];
  if (primaryFailure !== null && verification !== null) {
    await verification.cancel().catch((error: unknown) => observationCleanupFailures.push(error));
    void verification.result.catch(() => undefined);
  }
  const cleanup = await Promise.allSettled([
    ...(worker === null ? [] : [worker.close()]),
    ...(session === null ? [] : [session.detach()]),
  ]);
  const cleanupFailures = [
    ...observationCleanupFailures,
    ...cleanup.flatMap((cleanupResult) =>
      cleanupResult.status === "rejected" ? [cleanupResult.reason as unknown] : [],
    ),
  ];
  if (primaryFailure !== null) {
    if (cleanupFailures.length === 0) throw primaryFailure;
    throw new AggregateError(
      [primaryFailure, ...cleanupFailures],
      "Initial-install capture and installer-worker CDP cleanup failed",
    );
  }
  if (cleanupFailures.length !== 0) {
    throw new AggregateError(
      cleanupFailures,
      "Initial-install installer-worker CDP cleanup failed",
    );
  }
  if (result === null) throw new Error("Initial-install capture produced no evidence");
  return result;
}

interface FinalVerificationObservation {
  readonly cancel: () => Promise<void>;
  readonly result: Promise<Readonly<{ completeAtMs: number; verifyingAtMs: number }>>;
}

async function beginFinalVerificationObservation(
  page: Page,
): Promise<FinalVerificationObservation> {
  const beforeCalibrationAtMs = performance.now();
  const pageCalibrationAtMs = await page.evaluate(() => performance.now());
  const afterCalibrationAtMs = performance.now();
  const pageToCollectorOffsetMs =
    (beforeCalibrationAtMs + afterCalibrationAtMs) / 2 - pageCalibrationAtMs;
  const token = "asset-update-initial-install-final-verification";
  const pageResult = page.evaluate(
    async ({ intervalMs, timeoutMs, token: observationToken }) => {
      const scope = globalThis as unknown as {
        __parallaxCancelledVerificationObservationsV1?: Set<string>;
        __parallaxInstallerDiagnosticsV1?: () => unknown;
      };
      const cancellations =
        scope.__parallaxCancelledVerificationObservationsV1 ?? new Set<string>();
      scope.__parallaxCancelledVerificationObservationsV1 = cancellations;
      const deadline = performance.now() + timeoutMs;
      let verifyingAtMs: number | null = null;
      try {
        while (performance.now() < deadline) {
          if (cancellations.has(observationToken)) throw new Error("Observation cancelled");
          const read = scope.__parallaxInstallerDiagnosticsV1;
          if (read === undefined) throw new Error("Installer diagnostics are unavailable");
          const diagnostics = read() as {
            installer?: { installerTransfer?: { finalVerificationPhase?: unknown } };
          };
          const phase = diagnostics.installer?.installerTransfer?.finalVerificationPhase ?? null;
          const observedAtMs = performance.now();
          if (phase === "verifying" && verifyingAtMs === null) verifyingAtMs = observedAtMs;
          if (phase === "complete") {
            if (verifyingAtMs === null) {
              throw new Error(
                "Final verification completed without a prior observed verifying sample",
              );
            }
            return { completeAtMs: observedAtMs, verifyingAtMs };
          }
          await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
        }
        throw new Error("Final verification observation timed out");
      } finally {
        cancellations.delete(observationToken);
      }
    },
    {
      intervalMs: FINAL_VERIFICATION_POLL_INTERVAL_MS,
      timeoutMs: INSTALL_COMPLETION_TIMEOUT_MS + FINAL_VERIFICATION_POST_READY_TIMEOUT_MS,
      token,
    },
  );
  return Object.freeze({
    cancel: () =>
      page.evaluate((observationToken) => {
        (
          globalThis as unknown as {
            __parallaxCancelledVerificationObservationsV1?: Set<string>;
          }
        ).__parallaxCancelledVerificationObservationsV1?.add(observationToken);
      }, token),
    result: pageResult.then((observation) =>
      Object.freeze({
        completeAtMs: observation.completeAtMs + pageToCollectorOffsetMs,
        verifyingAtMs: observation.verifyingAtMs + pageToCollectorOffsetMs,
      }),
    ),
  });
}

interface InstallerWorkerNetworkAttachment {
  readonly close: () => Promise<void>;
  readonly disable: () => Promise<void>;
}

async function attachInstallerWorkerNetwork(
  session: CDPSession,
  expectedWorkerUrl: string,
  capture: ReturnType<typeof createInstallCdpNetworkCapture>,
): Promise<InstallerWorkerNetworkAttachment> {
  let workerSessionId: string | null = null;
  let commandId = 0;
  let closed = false;
  let protocolFailure: Error | null = null;
  const commandResults = new Map<
    number,
    Readonly<{ reject: (error: Error) => void; resolve: () => void }>
  >();
  let resolveAttached: (() => void) | null = null;
  let rejectAttached: ((error: Error) => void) | null = null;
  const attached = new Promise<void>((resolvePromise, rejectPromise) => {
    resolveAttached = resolvePromise;
    rejectAttached = rejectPromise;
  });
  const fail = (error: unknown): void => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    protocolFailure ??= normalized;
    rejectAttached?.(normalized);
    for (const waiter of commandResults.values()) waiter.reject(normalized);
    commandResults.clear();
  };
  const sendWorkerCommand = async (method: "Network.disable" | "Network.enable"): Promise<void> => {
    if (workerSessionId === null) throw new Error("Installer-worker CDP session is unavailable");
    const id = ++commandId;
    const completion = new Promise<void>((resolvePromise, rejectPromise) => {
      commandResults.set(id, Object.freeze({ reject: rejectPromise, resolve: resolvePromise }));
    });
    try {
      await session.send("Target.sendMessageToTarget", {
        message: JSON.stringify({ id, method }),
        sessionId: workerSessionId,
      });
    } catch (error: unknown) {
      commandResults.delete(id);
      fail(error);
      throw error;
    }
    await waitForAssetUpdateV8WorkerCommand({
      completion,
      fail,
      label: `Installer-worker ${method}`,
      removeWaiter: () => {
        commandResults.delete(id);
      },
      timeoutMs: 10_000,
    });
  };
  const onAttached = (event: unknown): void => {
    try {
      const value = cdpRecord(event, "Target.attachedToTarget");
      const target = cdpRecord(value.targetInfo, "Target.attachedToTarget targetInfo");
      if (target.type !== "worker" || target.url !== expectedWorkerUrl) return;
      if (workerSessionId !== null || typeof value.sessionId !== "string") {
        fail(new Error("Exact installer-worker CDP target was duplicated or malformed"));
        return;
      }
      workerSessionId = value.sessionId;
      void sendWorkerCommand("Network.enable").then(
        () => resolveAttached?.(),
        (error: unknown) => fail(error),
      );
    } catch (error: unknown) {
      fail(error);
    }
  };
  const onDetached = (event: unknown): void => {
    try {
      const value = cdpRecord(event, "Target.detachedFromTarget");
      if (!closed && value.sessionId === workerSessionId) {
        fail(new Error("Installer-worker CDP target detached during initial install"));
      }
    } catch (error: unknown) {
      fail(error);
    }
  };
  const onMessage = (event: unknown): void => {
    try {
      const value = cdpRecord(event, "Target.receivedMessageFromTarget");
      if (value.sessionId !== workerSessionId || typeof value.message !== "string") return;
      const message = cdpRecord(
        JSON.parse(value.message) as unknown,
        "installer-worker CDP message",
      );
      if (typeof message.id === "number") {
        const waiter = commandResults.get(message.id);
        if (waiter === undefined) {
          fail(new Error(`Installer-worker CDP returned unknown command ${message.id}`));
          return;
        }
        commandResults.delete(message.id);
        if (message.error !== undefined) {
          waiter.reject(
            new Error(`Installer-worker CDP command failed: ${JSON.stringify(message.error)}`),
          );
        } else {
          waiter.resolve();
        }
        return;
      }
      if (typeof message.method !== "string") {
        fail(new Error("Installer-worker CDP message omitted method or command ID"));
        return;
      }
      const params = cdpRecord(message.params, `${message.method} params`);
      switch (message.method) {
        case "Network.loadingFailed":
          capture.loadingFailed(params as unknown as Parameters<typeof capture.loadingFailed>[0]);
          break;
        case "Network.loadingFinished":
          capture.loadingFinished(
            params as unknown as Parameters<typeof capture.loadingFinished>[0],
          );
          break;
        case "Network.requestWillBeSent":
          capture.requestWillBeSent(
            params as unknown as Parameters<typeof capture.requestWillBeSent>[0],
          );
          break;
        case "Network.responseReceived":
          capture.responseReceived(
            params as unknown as Parameters<typeof capture.responseReceived>[0],
          );
          break;
        default:
          break;
      }
    } catch (error: unknown) {
      fail(error);
    }
  };
  session.on("Target.attachedToTarget", onAttached);
  session.on("Target.detachedFromTarget", onDetached);
  session.on("Target.receivedMessageFromTarget", onMessage);
  try {
    await session.send("Target.setAutoAttach", {
      autoAttach: true,
      flatten: false,
      waitForDebuggerOnStart: false,
    });
    await withBoundedCdpWait(attached, "Exact installer-worker CDP attachment");
    if (protocolFailure !== null) throw protocolFailure;
  } catch (error: unknown) {
    closed = true;
    session.off("Target.attachedToTarget", onAttached);
    session.off("Target.detachedFromTarget", onDetached);
    session.off("Target.receivedMessageFromTarget", onMessage);
    await session
      .send("Target.setAutoAttach", {
        autoAttach: false,
        flatten: false,
        waitForDebuggerOnStart: false,
      })
      .catch(() => undefined);
    throw error;
  }
  return Object.freeze({
    close: async () => {
      if (closed) return;
      closed = true;
      session.off("Target.attachedToTarget", onAttached);
      session.off("Target.detachedFromTarget", onDetached);
      session.off("Target.receivedMessageFromTarget", onMessage);
      await session.send("Target.setAutoAttach", {
        autoAttach: false,
        flatten: false,
        waitForDebuggerOnStart: false,
      });
    },
    disable: async () => {
      if (protocolFailure !== null) throw protocolFailure;
      await sendWorkerCommand("Network.disable");
      if (protocolFailure !== null) throw protocolFailure;
    },
  });
}

async function withBoundedCdpWait<T>(completion: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      completion,
      new Promise<never>((_resolvePromise, rejectPromise) => {
        timeout = setTimeout(() => rejectPromise(new Error(`${label} timed out`)), 10_000);
      }),
    ]);
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}

function cdpRecord(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`${label} is malformed`);
  }
  return input as Record<string, unknown>;
}

function requireInstallerWorkerSource(build: ValidatedBuildManifest): string {
  const matches = build.manifest.workerEntrypoints.filter(({ role }) => role === "installer");
  const source = matches[0]?.path;
  if (matches.length !== 1 || source === undefined) {
    throw new Error("Build manifest does not expose one exact installer worker");
  }
  return source;
}

async function waitForServerJournalQuiescence(
  journal: readonly LocalServerDetailedJournalEntry[],
): Promise<void> {
  let previousLength = -1;
  let stableSamples = 0;
  for (let sample = 0; sample < 20; sample += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    if (journal.length === previousLength) {
      stableSamples += 1;
      if (stableSamples === 3) return;
    } else {
      previousLength = journal.length;
      stableSamples = 0;
    }
  }
  throw new Error("Update server journal did not become quiescent within 1 second");
}

async function installerUiState(page: Page): Promise<
  Readonly<{
    failureCode: string | null;
    failureRecovery: string | null;
    installEnabled: boolean;
    launchEnabled: boolean;
    state: string | null;
  }>
> {
  return page.evaluate(() => {
    const root = document.querySelector("#installer-shell");
    const install = document.querySelector("#installer-start");
    const launch = document.querySelector("#installer-launch");
    if (
      !(root instanceof HTMLElement) ||
      !(install instanceof HTMLButtonElement) ||
      !(launch instanceof HTMLButtonElement)
    ) {
      throw new Error("Ordinary installer controls are unavailable");
    }
    return {
      failureCode: root.dataset.failureCode || null,
      failureRecovery: root.dataset.failureRecovery || null,
      installEnabled: !install.disabled,
      launchEnabled: !launch.disabled,
      state: root.dataset.state ?? null,
    };
  });
}

async function observeTarget(
  origin: string,
  release: AssetUpdateReleaseAuthority,
  build: ValidatedBuildManifest,
  root: string,
): Promise<AssetUpdateTargetObservation> {
  const buildResponse = await fetch(`${origin}/build-manifest.json`, { cache: "no-store" });
  const buildBytes = Buffer.from(await buildResponse.arrayBuffer());
  const installResponse = await fetch(`${origin}/install-manifest.json`, { cache: "no-store" });
  const installBytes = Buffer.from(await installResponse.arrayBuffer());
  if (
    buildResponse.status !== 200 ||
    installResponse.status !== 200 ||
    sha256(buildBytes) !== release.artifactDigest ||
    sha256(installBytes) !== release.releaseDigest
  ) {
    throw new Error("Serving target manifest identity does not match the expected release");
  }
  const resourceRepresentations = [];
  for (const resource of [...build.installManifest.resources].sort((left, right) =>
    compareCodepoints(left.source, right.source),
  )) {
    const filePath = join(root, resource.source);
    const fileStat = await stat(filePath);
    const fileDigest = await sha256File(filePath);
    if (
      !fileStat.isFile() ||
      fileStat.size !== resource.bytes ||
      fileDigest.bytes !== resource.bytes ||
      fileDigest.sha256 !== resource.sha256
    ) {
      throw new Error(`Live target file verification failed: ${resource.source}`);
    }
    const boundedRange = resource.kind === "model";
    const response = await fetch(
      `${origin}/${resource.source}`,
      boundedRange ? { cache: "no-store", headers: { Range: "bytes=0-0" } } : { cache: "no-store" },
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    const etag = response.headers.get("etag");
    const conditional = await fetch(`${origin}/${resource.source}`, {
      cache: "no-store",
      headers: { "If-None-Match": etag ?? "" },
    });
    const contentType = response.headers.get("content-type");
    const expectedStatus = boundedRange ? 206 : 200;
    const expectedBodyBytes = boundedRange ? 1 : resource.bytes;
    const expectedCacheControl = boundedRange
      ? "no-cache"
      : resource.source.startsWith("immutable/")
        ? "public, max-age=31536000, immutable"
        : "no-cache";
    const expectedContentType = assetUpdateResourceContentType(resource.kind, resource.source);
    if (
      response.status !== expectedStatus ||
      bytes.byteLength !== expectedBodyBytes ||
      (!boundedRange && sha256(bytes) !== resource.sha256) ||
      (boundedRange && response.headers.get("content-range") !== `bytes 0-0/${resource.bytes}`) ||
      etag !== `"sha256-${resource.sha256}"` ||
      response.headers.get("cache-control") !== expectedCacheControl ||
      contentType !== expectedContentType ||
      conditional.status !== 304
    ) {
      throw new Error(`Complete resource transport verification failed: ${resource.source}`);
    }
    resourceRepresentations.push(
      Object.freeze({
        bytes: resource.bytes,
        cacheControl: expectedCacheControl,
        conditionalStatus: 304 as const,
        contentType: expectedContentType,
        etag,
        kind: resource.kind,
        sha256: resource.sha256,
        source: resource.source,
        status: expectedStatus,
        validation: boundedRange
          ? ("bounded-range-and-filesystem-sha256" as const)
          : ("full-body-sha256" as const),
      }),
    );
  }
  return Object.freeze({
    artifactDigest: release.artifactDigest,
    buildManifestEtag: requireHeader(buildResponse, "etag"),
    buildManifestSha256: sha256(buildBytes),
    resourceRepresentations: Object.freeze(resourceRepresentations),
    installManifestEtag: requireHeader(installResponse, "etag"),
    installManifestSha256: sha256(installBytes),
    origin,
    releaseDigest: release.releaseDigest,
  });
}

async function releaseAuthority(
  root: string,
  build: ValidatedBuildManifest,
): Promise<AssetUpdateReleaseAuthority> {
  const buildBytes = await readFile(join(root, "build-manifest.json"));
  const installBytes = await readFile(join(root, "install-manifest.json"));
  if (sha256(buildBytes) !== build.artifactDigest || sha256(installBytes) !== build.releaseDigest) {
    throw new Error("Release authority bytes changed after manifest validation");
  }
  return Object.freeze({
    artifactDigest: build.artifactDigest,
    buildManifestBase64: buildBytes.toString("base64"),
    buildManifestSchemaVersion: build.manifest.schemaVersion,
    installManifestBase64: installBytes.toString("base64"),
    releaseDigest: build.releaseDigest,
  });
}

async function readV8ScriptArtifacts(
  root: string,
  build: ValidatedBuildManifest,
): Promise<readonly V8ScriptArtifact[]> {
  return Object.freeze(
    await Promise.all(
      selectV8ScriptManifestArtifacts(build.manifest).map(async (artifact) =>
        Object.freeze({
          bytes: artifact.bytes,
          path: artifact.path,
          sourceCodeUnits: decodedSourceCodeUnits(
            await readFile(join(root, artifact.path), "utf8"),
          ),
        }),
      ),
    ),
  );
}

async function prepareServingRoot(sourceRoot: string, servingRoot: string): Promise<void> {
  await cp(sourceRoot, servingRoot, { recursive: true });
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
      throw new Error(`Asset-update V8 model fixture is invalid: ${artifact.path}`);
    }
    await link(source, join(immutableRoot, `model-${artifact.sha256}.gguf`));
  }
}

function combinedExactRangeResources(
  fixture: AssetOnlyUpdateFixture,
): readonly Readonly<{ bytes: number; sha256: string; source: string }>[] {
  const resources = new Map<string, { bytes: number; sha256: string; source: string }>();
  for (const release of [fixture.pre, fixture.post]) {
    for (const resource of release.installManifest.resources) {
      const previous = resources.get(resource.source);
      if (
        previous !== undefined &&
        (previous.bytes !== resource.bytes || previous.sha256 !== resource.sha256)
      ) {
        throw new Error(`Exact Range resource identity conflicts: ${resource.source}`);
      }
      resources.set(resource.source, {
        bytes: resource.bytes,
        sha256: resource.sha256,
        source: resource.source,
      });
    }
  }
  return Object.freeze(
    [...resources.values()].sort((left, right) => compareCodepoints(left.source, right.source)),
  );
}

function withProfile(
  launch: AssetUpdateV8LaunchEvidence,
  persistentProfileId: string,
): AssetUpdateV8LaunchEvidence {
  return Object.freeze({ ...launch, persistentProfileId });
}

function pendingEvidence(
  startedAt: string,
  companionPath: string,
  reservationId: string,
): AssetUpdateV8Evidence {
  return Object.freeze({
    authority: null,
    companion: Object.freeze({ path: companionPath, state: "pending" as const }),
    contract: ASSET_UPDATE_V8_CONTRACT,
    postValidation: Object.freeze({
      authority: null,
      passed: null,
      performed: false,
      ready: null,
      target: null,
    }),
    resultOwnership: Object.freeze({
      publicationState: "pending" as const,
      reservationId,
    }),
    schemaVersion: ASSET_UPDATE_V8_SCHEMA_VERSION,
    startedAt,
    state: "pending" as const,
  });
}

function passedEvidence(input: {
  readonly authority: AssetUpdateRunAuthority;
  readonly companionPath: string;
  readonly completedAt: string;
  readonly reservationId: string;
  readonly result: AssetUpdateLifecycleResult;
  readonly postValidationReady: AssetUpdateReadyAuthority;
  readonly postValidationTarget: AssetUpdateTargetObservation;
  readonly startedAt: string;
}): AssetUpdateV8Evidence {
  return Object.freeze({
    authority: input.authority,
    companion: Object.freeze({ path: input.companionPath, state: "passed" as const }),
    completedAt: input.completedAt,
    contract: ASSET_UPDATE_V8_CONTRACT,
    postValidation: Object.freeze({
      authority: input.authority,
      passed: true,
      performed: true,
      ready: input.postValidationReady,
      target: input.postValidationTarget,
    }),
    result: input.result,
    resultOwnership: Object.freeze({
      publicationState: "passed" as const,
      reservationId: input.reservationId,
    }),
    schemaVersion: ASSET_UPDATE_V8_SCHEMA_VERSION,
    startedAt: input.startedAt,
    state: "passed" as const,
  });
}

function publicationFailurePhase(phase: "close" | "json" | "markdown"): RunPhase {
  return phase === "close"
    ? "result-close"
    : phase === "markdown"
      ? "companion-write"
      : "publication";
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function requireHeader(response: Response, name: string): string {
  const value = response.headers.get(name);
  if (value === null || value === "") throw new Error(`Target response omits ${name}`);
  return value;
}

function sha256(value: NodeJS.ArrayBufferView): string {
  return createHash("sha256").update(value).digest("hex");
}

function compareCodepoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
