import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ParallaxTelemetryExport, ParallaxTelemetrySnapshot } from "@parallax/engine";
import { type BrowserContext, type CDPSession, chromium, type Page } from "playwright-core";
import {
  type Distribution,
  distribution,
  evaluateP95Variance,
  type VarianceMetric,
} from "./aggregate.js";
import {
  type BudgetCheck,
  type DiagnosticCheck,
  evaluateJsHeapBudget,
  evaluateMainThreadBudgets,
  evaluatePipelineBudgets,
  evaluateV8CodeCacheDiagnostics,
  evaluateV8CodeCacheReproductionDiagnostics,
  type QualityTier,
} from "./budgets.js";
import {
  type BuildManifest,
  type ManifestArtifact,
  readAndValidateBuildManifest,
  sha256File,
} from "./build-manifest.js";
import {
  D3D12_HISTOGRAM_PREFIX,
  DAWN_TRACE_CATEGORY,
  type DawnHistogram,
  type DawnPipelineEvidence,
  resolveD3D12DawnPipelineEvidence,
} from "./dawn-pipeline-trace.js";
import {
  type BrowserDisplayIdentity,
  type CdpGpuDevice,
  type EnvironmentGateState,
  evaluateBrowserDisplay,
  evaluateGateEnvironment,
  invalidEnvironmentGate,
  loadMachineDescriptor,
  type MachineDescriptor,
  parseDisplayRefreshRates,
  safeMachineIdForFilename,
  tryReadWindowsHostIdentity,
  type WebGpuAdapterIdentity,
  type WindowsHostIdentity,
  type WindowsHostIdentityResult,
} from "./environment.js";
import {
  type GpuMemoryMetric,
  MEMORY_INFRA_TRACE_CATEGORY,
  type MemoryDumpRequest,
  resolveGpuMemoryMetric,
} from "./gpu-memory.js";
import {
  invalidateJsHeapMetric,
  type JsHeapEvidence,
  type JsHeapMetric,
  type JsHeapSampler,
  JsHeapValidationError,
  prepareJsHeapSampler,
} from "./js-heap.js";
import {
  type ChromeTraceEvent,
  extractVizPresentationFeedbackCallbackIntervalsMs,
  PRESENTATION_TRACE_CATEGORY,
  PRESENTATION_TRACE_END_MARKER,
  PRESENTATION_TRACE_START_MARKER,
  withTimeout,
} from "./presentation-trace.js";
import { evaluateResultFacets, type ResultFacets, resultFacetsPassed } from "./result-facets.js";
import {
  parseQualityTier,
  QUALITY_TIER_PROFILES,
  renderSurfaceMismatch,
  SMOKE_INCOMPLETE_METRICS,
  SMOKE_JS_HEAP_SAMPLE_INTERVAL_MS,
  SMOKE_MANDATORY_METRIC_SET_VERSION,
  SMOKE_MEASUREMENT_FRAMES,
  SMOKE_METRICS,
  SMOKE_PRESENTATION_TRACE_COMPLETION_TIMEOUT_MS,
  SMOKE_PRESENTATION_TRACE_TAIL_MS,
  SMOKE_REPEATS,
  SMOKE_SCENARIO,
  SMOKE_TELEMETRY_GLOBAL_NAME,
  SMOKE_TELEMETRY_SCHEMA_VERSION,
  SMOKE_TRACE_QUIESCE_MS,
  SMOKE_V8_CODE_CACHE_DIAGNOSTIC,
  SMOKE_V8_CODE_CACHE_DIAGNOSTIC_REPEATS,
  SMOKE_WARMUP_MS,
  type SmokeMetricDefinition,
} from "./runs/smoke.js";
import {
  createLocalServer,
  type LocalServerMetrics,
  listenLocalServer,
  stopLocalServer,
} from "./server.js";
import {
  collectSmokeBudgetFacetChecks,
  collectSmokeEnvironmentFacetInput,
  collectSmokeEvidenceChecks,
  collectSmokeInformationalFailures,
  formatSmokeFacetSummary,
} from "./smoke-result.js";
import { readSourceIdentity, type SourceIdentity } from "./source-identity.js";
import {
  decodedSourceCodeUnits,
  resolveV8CodeCacheEvidence,
  resolveV8CodeCacheProductionEvidence,
  V8_CODE_CACHE_TRACE_CATEGORY,
  type V8CodeCacheArtifactEvidence,
  type V8CodeCacheMetric,
  type V8CodeCacheProductionMetric,
  type V8ScriptArtifact,
} from "./v8-code-cache-trace.js";
import { errorMessage } from "./value-utils.js";

interface MeasuredMetric<T> {
  readonly state: "measured";
  readonly value: T;
}

type ProbeResult<T> =
  | Readonly<{ readonly state: "measured"; readonly value: T }>
  | Readonly<{ readonly reason: string; readonly state: "invalid" }>;

type MetricResult<T> =
  | ProbeResult<T>
  | Readonly<{ readonly reason: string; readonly state: "unsupported" }>;

interface P95VarianceSummary {
  readonly profile: "fresh" | "warm";
  readonly reason?: string;
  readonly relativeP95Range: number;
  readonly state: "invalid" | "measured";
}

interface LaunchSequencePosition {
  readonly launchOrdinal: number;
  readonly launchStartedAfterSequenceMs: number;
}

interface ChromePin {
  readonly channel: "stable";
  readonly executableSha256: Readonly<Record<string, string>>;
  readonly revision: string;
  readonly version: string;
}

interface RunMeasurement {
  readonly budgetChecks: readonly BudgetCheck[];
  readonly browserDisplayAfter: BrowserDisplayIdentity;
  readonly browserDisplayBefore: BrowserDisplayIdentity;
  readonly cpuFrameMs: MeasuredMetric<Distribution>;
  readonly dawnPipeline: MetricResult<DawnPipelineEvidence>;
  readonly gpuMemory: GpuMemoryMetric;
  readonly http: MeasuredMetric<LocalServerMetrics>;
  readonly jsHeap: JsHeapMetric;
  readonly launchOrdinal: number;
  readonly launchStartedAfterSequenceMs: number;
  readonly mainThreadLongTasksOver50Ms: MeasuredMetric<number>;
  readonly workerAnimationCallbackIntervalMs: MeasuredMetric<Distribution>;
  readonly profile: "fresh" | "warm";
  readonly profileLineage: {
    readonly history: readonly ("fresh" | "warm")[];
    readonly id: string;
  };
  readonly repeat: number;
  readonly renderSurfaceAfter: Readonly<{ height: number; width: number }>;
  readonly renderSurfaceBefore: Readonly<{ height: number; width: number }>;
  readonly renderSurfaceChanges: readonly Readonly<{ height: number; width: number }>[];
  readonly traceDrain: SmokeTraceDrainMetric;
  readonly workerInitToFirstFrameMs: MeasuredMetric<number>;
  readonly workerStartupToFirstFrameMs: MeasuredMetric<number>;
  readonly vizPresentationFeedbackCallbackIntervalMs: ProbeResult<Distribution>;
}

interface V8CodeCacheDiagnosticRun {
  readonly diagnosticChecks: readonly DiagnosticCheck[];
  readonly launchOrdinal: number | null;
  readonly launchStartedAfterSequenceMs: number | null;
  readonly lifecycleLoadCompleted: boolean;
  readonly profile: "fresh" | "produce" | "warm";
  readonly profileLineage: {
    readonly history: readonly ("fresh" | "produce" | "warm")[];
    readonly id: string;
  };
  readonly production: V8CodeCacheProductionMetric;
  readonly repeat: number;
  readonly scenario: typeof SMOKE_V8_CODE_CACHE_DIAGNOSTIC;
  readonly traceDrain: SmokeTraceDrainMetric;
  readonly v8CodeCache: V8CodeCacheMetric;
  readonly workerStartupToFirstFrameMs: ProbeResult<number>;
}

interface SmokeTraceDrainEvidence {
  readonly categories: readonly string[];
  readonly completionAfterEndCommandMs: number | null;
  readonly completionTimeoutMs: number;
  readonly dataChunkCount: number;
  readonly dataLossOccurred: boolean | null;
  readonly endWaitMs: number | null;
  readonly endCommandMs: number | null;
  readonly eventCount: number;
  readonly recordingDurationBeforeEndMs: number | null;
  readonly serializedEventBytes: number;
}

type SmokeTraceDrainMetric =
  | Readonly<{ readonly evidence: SmokeTraceDrainEvidence; readonly state: "measured" }>
  | Readonly<{
      readonly evidence: SmokeTraceDrainEvidence | null;
      readonly reason: string;
      readonly state: "invalid";
    }>;

interface EnvironmentIdentity {
  readonly adapter: WebGpuAdapterIdentity | null;
  readonly browserDisplay: BrowserDisplayIdentity | null;
  readonly browserProduct: string;
  readonly browserRevision: string;
  readonly browserUserAgent: string;
  readonly executableSha256: string;
  readonly gateIdentity: EnvironmentGateState;
  readonly gpuDevices: readonly CdpGpuDevice[];
  readonly host: WindowsHostIdentity | null;
  readonly hostAfterRuns: WindowsHostIdentity | null;
  readonly jsVersion: string;
  readonly machine: MachineDescriptor | null;
  readonly machineId: string;
  readonly requestedTier: QualityTier;
  readonly targetDisplayMode: string;
}

interface SmokeReport {
  readonly artifactDigest: string;
  readonly chromePin: ChromePin;
  readonly environment: EnvironmentIdentity;
  readonly facets: ResultFacets;
  readonly generatedAt: string;
  readonly incompleteMetrics: readonly {
    readonly mandatoryForHarnessV1: boolean;
    readonly metric: string;
    readonly reason: string;
    readonly state: "invalid";
  }[];
  readonly informationalFailures: readonly string[];
  readonly mandatoryMetricSet: {
    readonly metrics: readonly string[];
    readonly version: typeof SMOKE_MANDATORY_METRIC_SET_VERSION;
  };
  readonly passed: boolean;
  readonly vizPresentationFeedbackCallbackVariance: readonly {
    readonly profile: "fresh" | "warm";
    readonly reason?: string;
    readonly relativeP95Range: number | null;
    readonly state: "invalid" | "measured";
  }[];
  readonly runs: readonly RunMeasurement[];
  readonly scenario: typeof SMOKE_SCENARIO;
  readonly schemaVersion: 16;
  readonly source: SourceIdentity;
  readonly callbackPacingVariance: readonly P95VarianceSummary[];
  readonly v8CodeCacheDiagnostics: readonly V8CodeCacheDiagnosticRun[];
}

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const buildRoot = join(repositoryRoot, "dist");
const chromePinPath = join(repositoryRoot, "harness/chrome/stable.json");
const machineRoot = join(repositoryRoot, "harness/machines");
const outputRoot = join(repositoryRoot, "harness/results");

await main();

async function main(): Promise<void> {
  const executablePath = requiredEnvironment("PARALLAX_CHROME_PATH");
  const machineId = requiredEnvironment("PARALLAX_MACHINE_ID");
  const tier = parseQualityTier(process.env.PARALLAX_TIER);
  const chromePin = JSON.parse(await readFile(chromePinPath, "utf8")) as ChromePin;
  const validatedBuild = await readAndValidateBuildManifest(buildRoot);
  const artifactDigest = validatedBuild.artifactDigest;
  const v8ScriptArtifacts = await readV8ScriptArtifacts(validatedBuild.manifest.artifacts);
  const renderWorkerArtifact = await tryProbe("Build-manifest render-worker entrypoint", async () =>
    renderWorkerArtifactPath(validatedBuild.manifest),
  );
  const source = await readSourceIdentity(repositoryRoot);
  const server = createLocalServer({ root: buildRoot });
  const address = await listenLocalServer(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const renderWorkerUrl: ProbeResult<string> =
    renderWorkerArtifact.state === "measured"
      ? measured(new URL(renderWorkerArtifact.value, `${baseUrl}/`).href)
      : renderWorkerArtifact;
  const profileRoot = await mkdtemp(join(tmpdir(), "parallax-harness-"));

  try {
    let environment = await inspectEnvironment(
      executablePath,
      join(profileRoot, "identity"),
      chromePin,
      machineId,
      tier,
      baseUrl,
    );
    const measurementSequenceStartedAtMs = performance.now();
    let launchOrdinal = 0;
    const runs: RunMeasurement[] = [];
    for (let repeat = 1; repeat <= SMOKE_REPEATS; repeat += 1) {
      const lineage = join(profileRoot, `lineage-${repeat}`);
      runs.push(
        await measureRun(
          executablePath,
          lineage,
          baseUrl,
          repeat,
          "fresh",
          environment.adapter?.backend ?? null,
          tier,
          renderWorkerUrl,
          launchSequencePosition(++launchOrdinal, measurementSequenceStartedAtMs),
        ),
        await measureRun(
          executablePath,
          lineage,
          baseUrl,
          repeat,
          "warm",
          environment.adapter?.backend ?? null,
          tier,
          renderWorkerUrl,
          launchSequencePosition(++launchOrdinal, measurementSequenceStartedAtMs),
        ),
      );
    }
    const v8CodeCacheDiagnostics: V8CodeCacheDiagnosticRun[] = [];
    for (let repeat = 1; repeat <= SMOKE_V8_CODE_CACHE_DIAGNOSTIC_REPEATS; repeat += 1) {
      const lineage = join(profileRoot, `v8-lineage-${repeat}`);
      const completedHistory: V8CodeCacheDiagnosticRun["profile"][] = [];
      let predecessorFailure: string | null = null;
      for (const profile of ["fresh", "produce", "warm"] as const) {
        const run =
          predecessorFailure === null
            ? await measureV8CodeCacheDiagnosticRun(
                executablePath,
                lineage,
                baseUrl,
                repeat,
                profile,
                v8ScriptArtifacts,
                launchSequencePosition(++launchOrdinal, measurementSequenceStartedAtMs),
                completedHistory,
              )
            : invalidV8CodeCacheDiagnosticRun(
                `V8 code-cache diagnostic ${profile} phase was not launched because ${predecessorFailure}`,
                profile,
                repeat,
                null,
                completedHistory,
              );
        v8CodeCacheDiagnostics.push(run);
        if (run.lifecycleLoadCompleted) {
          completedHistory.push(profile);
        } else if (predecessorFailure === null) {
          predecessorFailure = `the ${profile} lifecycle load did not complete`;
        }
      }
    }
    const callbackPacingVariance = (["fresh", "warm"] as const).map((profile) => {
      const variance = evaluateP95Variance(
        runs
          .filter((run) => run.profile === profile)
          .map((run) => run.workerAnimationCallbackIntervalMs.value.p95),
      );
      return summarizeP95Variance(profile, variance);
    });
    const vizPresentationFeedbackCallbackVariance = (["fresh", "warm"] as const).map((profile) => {
      const profileRuns = runs.filter((run) => run.profile === profile);
      const invalidRuns = profileRuns.filter(
        (run) => run.vizPresentationFeedbackCallbackIntervalMs.state === "invalid",
      );
      if (invalidRuns.length > 0) {
        return Object.freeze({
          profile,
          reason: invalidRuns
            .map(
              (run) =>
                `repeat ${run.repeat}: ${
                  run.vizPresentationFeedbackCallbackIntervalMs.state === "invalid"
                    ? run.vizPresentationFeedbackCallbackIntervalMs.reason
                    : "unknown failure"
                }`,
            )
            .join(" | "),
          relativeP95Range: null,
          state: "invalid" as const,
        });
      }
      const variance = evaluateP95Variance(
        profileRuns.map((run) => {
          if (run.vizPresentationFeedbackCallbackIntervalMs.state !== "measured") {
            throw new Error("Viz presentation diagnostic state changed during aggregation");
          }
          return run.vizPresentationFeedbackCallbackIntervalMs.value.p95;
        }),
      );
      return summarizeP95Variance(profile, variance);
    });
    environment = revalidateRunDisplays(environment, runs);
    environment = revalidateHostEnvironment(environment, await tryReadWindowsHostIdentity());
    const incompleteMetrics = Object.freeze(SMOKE_INCOMPLETE_METRICS.map(invalidMetric));
    const evidenceChecks = collectSmokeEvidenceChecks({
      callbackPacingVariance,
      incompleteMetrics,
      runs,
      v8CodeCacheDiagnostics,
      vizPresentationFeedbackCallbackVariance,
    });
    const facets = evaluateResultFacets({
      budgetChecks: collectSmokeBudgetFacetChecks({ runs }),
      environment: collectSmokeEnvironmentFacetInput(environment.gateIdentity),
      evidenceChecks,
    });
    const informationalFailures = collectSmokeInformationalFailures({
      evidenceChecks,
      v8CodeCacheDiagnostics,
    });
    const passed = resultFacetsPassed(facets);
    if ((await readAndValidateBuildManifest(buildRoot)).artifactDigest !== artifactDigest) {
      throw new Error("Built artifact identity changed during the smoke run");
    }
    if (JSON.stringify(await readSourceIdentity(repositoryRoot)) !== JSON.stringify(source)) {
      throw new Error("Source identity changed during the smoke run");
    }
    const report: SmokeReport = Object.freeze({
      artifactDigest,
      callbackPacingVariance,
      chromePin,
      environment,
      facets,
      generatedAt: new Date().toISOString(),
      incompleteMetrics,
      informationalFailures,
      mandatoryMetricSet: Object.freeze({
        metrics: Object.freeze(
          SMOKE_METRICS.filter((metric) => metric.mandatoryForHarnessV1).map(
            (metric) => metric.name,
          ),
        ),
        version: SMOKE_MANDATORY_METRIC_SET_VERSION,
      }),
      passed,
      runs,
      scenario: SMOKE_SCENARIO,
      schemaVersion: 16,
      source,
      v8CodeCacheDiagnostics,
      vizPresentationFeedbackCallbackVariance,
    });
    await writeReport(report);
    process.exitCode = passed ? 0 : 1;
  } finally {
    await rm(profileRoot, { force: true, recursive: true });
    await stopLocalServer(server);
  }
}

function invalidMetric(
  definition: SmokeMetricDefinition,
): SmokeReport["incompleteMetrics"][number] {
  return Object.freeze({
    mandatoryForHarnessV1: definition.mandatoryForHarnessV1,
    metric: definition.name,
    reason:
      definition.invalidReason ??
      "Probe is not implemented in smoke@1; Harness v1 remains incomplete",
    state: "invalid",
  });
}

function measured<T>(value: T): MeasuredMetric<T> {
  return Object.freeze({ state: "measured", value });
}

function launchSequencePosition(
  launchOrdinal: number,
  measurementSequenceStartedAtMs: number,
): LaunchSequencePosition {
  return Object.freeze({
    launchOrdinal,
    launchStartedAfterSequenceMs: performance.now() - measurementSequenceStartedAtMs,
  });
}

async function readV8ScriptArtifacts(
  artifacts: readonly ManifestArtifact[],
): Promise<readonly V8ScriptArtifact[]> {
  return Object.freeze(
    await Promise.all(
      artifacts
        .filter(
          (artifact) => artifact.path.startsWith("immutable/") && artifact.path.endsWith(".js"),
        )
        .map(async (artifact) =>
          Object.freeze({
            bytes: artifact.bytes,
            path: artifact.path,
            sourceCodeUnits: decodedSourceCodeUnits(
              await readFile(join(buildRoot, artifact.path), "utf8"),
            ),
          }),
        ),
    ),
  );
}

function renderWorkerArtifactPath(manifest: BuildManifest): string {
  const matches = manifest.workerEntrypoints.filter(
    (entrypoint) => entrypoint.role === "render" && entrypoint.targetType === "worker",
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one declared render-worker entrypoint; received ${matches.length}`);
  }
  const entrypoint = matches[0];
  if (entrypoint === undefined) throw new Error("Render-worker entrypoint disappeared");
  return entrypoint.path;
}

async function readD3D12CacheHistograms(
  context: BrowserContext,
): Promise<readonly DawnHistogram[]> {
  const browser = context.browser();
  if (browser === null) throw new Error("Playwright did not expose the launched browser");
  const session = await browser.newBrowserCDPSession();
  let page: Page | null = null;
  try {
    page = await context.newPage();
    await page.goto(`chrome://histograms/#${D3D12_HISTOGRAM_PREFIX}`);
    const subprocessCheckbox = page.locator("#subprocess_checkbox");
    await subprocessCheckbox.waitFor({ state: "attached" });
    await subprocessCheckbox.setChecked(true);
    const refresh = page.getByText("Refresh", { exact: true });
    await refresh.click();
    await page.waitForFunction(
      (prefix) => document.body.textContent?.includes(prefix) === true,
      D3D12_HISTOGRAM_PREFIX,
      { timeout: 5_000 },
    );
    const first = await queryD3D12CacheHistograms(session);
    await delay(SMOKE_TRACE_QUIESCE_MS);
    await refresh.click();
    await delay(SMOKE_TRACE_QUIESCE_MS);
    const second = await queryD3D12CacheHistograms(session);
    if (JSON.stringify(first) !== JSON.stringify(second)) {
      throw new Error(
        "Dawn cache histograms were unstable across subprocess histogram synchronization",
      );
    }
    return second;
  } finally {
    await session.detach().catch(() => undefined);
    await page?.close().catch(() => undefined);
  }
}

async function queryD3D12CacheHistograms(session: CDPSession): Promise<readonly DawnHistogram[]> {
  const result = (await session.send("Browser.getHistograms", {
    delta: false,
    query: D3D12_HISTOGRAM_PREFIX,
  })) as {
    histograms: readonly DawnHistogram[];
  };
  return Object.freeze(
    result.histograms
      .filter((histogram) => !histogram.name.endsWith(".90SecondsPostStartup"))
      .map((histogram) =>
        Object.freeze({ count: histogram.count, name: histogram.name, sum: histogram.sum }),
      )
      .sort((left, right) => left.name.localeCompare(right.name)),
  );
}

async function tryProbe<T>(label: string, probe: () => Promise<T>): Promise<ProbeResult<T>> {
  try {
    return Object.freeze({ state: "measured", value: await probe() });
  } catch (error) {
    return Object.freeze({
      reason: `${label} probe failed: ${errorMessage(error)}`,
      state: "invalid",
    });
  }
}

function summarizeP95Variance(
  profile: "fresh" | "warm",
  variance: VarianceMetric,
): P95VarianceSummary {
  return variance.state === "invalid"
    ? Object.freeze({
        profile,
        reason: variance.reason,
        relativeP95Range: variance.relativeRange,
        state: variance.state,
      })
    : Object.freeze({
        profile,
        relativeP95Range: variance.relativeRange,
        state: variance.state,
      });
}

async function inspectEnvironment(
  executablePath: string,
  profilePath: string,
  chromePin: ChromePin,
  machineId: string,
  tier: QualityTier,
  baseUrl: string,
): Promise<EnvironmentIdentity> {
  const platformKey = chromePlatformKey();
  const expectedExecutableDigest = chromePin.executableSha256[platformKey];
  if (expectedExecutableDigest === undefined) {
    throw new Error(`Chrome for Testing executable digest is not pinned for ${platformKey}`);
  }
  const executableDigest = await sha256File(executablePath);
  if (executableDigest.sha256 !== expectedExecutableDigest) {
    throw new Error(
      `Chrome executable digest mismatch: expected ${expectedExecutableDigest}, received ${executableDigest.sha256}`,
    );
  }
  let machine: MachineDescriptor | null = null;
  let machineDescriptorFailure: string | null = null;
  try {
    machine = await loadMachineDescriptor(machineRoot, machineId);
  } catch (error) {
    machineDescriptorFailure = `Machine descriptor unavailable: ${errorMessage(error)}`;
  }
  const hostResultPromise = tryReadWindowsHostIdentity();
  const context = await launch(executablePath, profilePath, ["--enable-webgpu-developer-features"]);
  let session: CDPSession | null = null;
  try {
    const browser = context.browser();
    if (browser === null) throw new Error("Playwright did not expose the launched browser");
    session = await browser.newBrowserCDPSession();
    const version = (await session.send("Browser.getVersion")) as {
      product: string;
      revision: string;
      jsVersion: string;
      userAgent: string;
    };
    const actualVersion = version.product.replace(/^Chrome\//, "");
    if (actualVersion !== chromePin.version) {
      throw new Error(
        `Chrome for Testing version mismatch: expected ${chromePin.version}, received ${actualVersion}`,
      );
    }
    const systemInfo = (await session.send("SystemInfo.getInfo")) as {
      gpu: { devices: readonly CdpGpuDevice[] };
    };
    const primaryGpu = systemInfo.gpu.devices[0];
    if (primaryGpu === undefined) throw new Error("CDP did not report a primary GPU");
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${baseUrl}/__parallax/identity`, { waitUntil: "load" });
    const adapterResult = await tryProbe("WebGPU adapter identity", () =>
      readWebGpuAdapterIdentity(page),
    );
    const browserDisplayResult = await tryProbe("Browser display identity", () =>
      readBrowserDisplayIdentity(context, page),
    );
    const adapter = adapterResult.state === "measured" ? adapterResult.value : null;
    const browserDisplay =
      browserDisplayResult.state === "measured" ? browserDisplayResult.value : null;
    const hostResult = await hostResultPromise;
    const host = hostResult.state === "measured" ? hostResult.host : null;
    const identityFailures = [
      ...(machineDescriptorFailure === null ? [] : [machineDescriptorFailure]),
      ...(hostResult.state === "invalid" ? [hostResult.reason] : []),
      ...(adapterResult.state === "invalid" ? [adapterResult.reason] : []),
      ...(browserDisplayResult.state === "invalid" ? [browserDisplayResult.reason] : []),
    ];
    const gateIdentity =
      machine === null || host === null || adapter === null || browserDisplay === null
        ? invalidEnvironmentGate(identityFailures)
        : evaluateGateEnvironment(machine, {
            adapter,
            arch: process.arch,
            browserDisplay,
            host,
            platform: process.platform,
            primaryGpu,
            requestedTier: tier,
          });
    return Object.freeze({
      adapter,
      browserDisplay,
      browserProduct: version.product,
      browserRevision: version.revision,
      browserUserAgent: version.userAgent,
      executableSha256: executableDigest.sha256,
      gateIdentity,
      gpuDevices: systemInfo.gpu.devices,
      host,
      hostAfterRuns: null,
      jsVersion: version.jsVersion,
      machine,
      machineId: machine?.id ?? machineId,
      requestedTier: tier,
      targetDisplayMode: QUALITY_TIER_PROFILES[tier].targetDisplayMode,
    });
  } finally {
    await session?.detach().catch(() => undefined);
    await context.close();
  }
}

function chromePlatformKey(): string {
  if (process.platform === "win32" && process.arch === "x64") return "win64";
  if (process.platform === "linux" && process.arch === "x64") return "linux64";
  if (process.platform === "darwin" && process.arch === "arm64") return "mac-arm64";
  if (process.platform === "darwin" && process.arch === "x64") return "mac-x64";
  throw new Error(`No Chrome for Testing platform mapping for ${process.platform}/${process.arch}`);
}

async function measureRun(
  executablePath: string,
  profilePath: string,
  baseUrl: string,
  repeat: number,
  profile: "fresh" | "warm",
  dawnBackend: string | null,
  tier: QualityTier,
  renderWorkerUrl: ProbeResult<string>,
  launchPosition: LaunchSequencePosition,
): Promise<RunMeasurement> {
  const before = await fetchServerMetrics(baseUrl);
  const context = await launch(executablePath, profilePath);
  const page = context.pages()[0] ?? (await context.newPage());
  const errors: string[] = [];
  let smokeTrace: SmokeTraceCapture | null = null;
  let smokeTraceFailure: string | null = null;
  const markPresentationBoundary = async (boundary: "start" | "end"): Promise<void> => {
    if (smokeTrace === null) return;
    const trace = smokeTrace;
    const markerResult = await tryProbe(`Smoke trace presentation-window ${boundary} marker`, () =>
      boundary === "start" ? trace.markStart(page) : trace.markEnd(page),
    );
    if (markerResult.state === "invalid") {
      smokeTraceFailure = markerResult.reason;
    }
  };
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await installLongTaskObserver(page);
  try {
    const traceStartResult = await tryProbe("Chrome smoke trace start", () =>
      beginSmokeTrace(context, {
        categories: [
          DAWN_TRACE_CATEGORY,
          MEMORY_INFRA_TRACE_CATEGORY,
          PRESENTATION_TRACE_CATEGORY,
          "blink.user_timing",
        ],
        requireMeasurementEndMarker: true,
      }),
    );
    if (traceStartResult.state === "measured") {
      smokeTrace = traceStartResult.value;
    } else {
      smokeTraceFailure = traceStartResult.reason;
    }
    await page.goto(baseUrl, { waitUntil: "load" });
    await page.waitForFunction(
      telemetryReady,
      {
        expectedSchemaVersion: SMOKE_TELEMETRY_SCHEMA_VERSION,
        globalName: SMOKE_TELEMETRY_GLOBAL_NAME,
      },
      { timeout: 30_000 },
    );
    await installSurfaceObserver(page);
    const refreshRateResult = await tryProbe("Browser refresh-rate diagnostics", () =>
      readChromeDisplayRefreshRates(context),
    );
    const refreshRatesHz =
      refreshRateResult.state === "measured" ? refreshRateResult.value : Object.freeze([]);
    const displayProbeFailures =
      refreshRateResult.state === "invalid" ? Object.freeze([refreshRateResult.reason]) : [];
    await page.waitForTimeout(SMOKE_WARMUP_MS);
    await resetSurfaceObserver(page);
    const renderSurfaceBefore = await readSurfaceLatest(page);
    const screenBeforeResult = await tryProbe("Browser screen identity", () =>
      readScreenIdentity(page),
    );
    const browserDisplayBefore = browserDisplay(
      screenBeforeResult.state === "measured" ? screenBeforeResult.value : null,
      refreshRatesHz,
      [
        ...displayProbeFailures,
        ...(screenBeforeResult.state === "invalid" ? [screenBeforeResult.reason] : []),
      ],
    );
    await resetLongTaskObserver(page);
    const start = await readTelemetry(page);
    await markPresentationBoundary("start");
    await page.waitForFunction(
      (target) => {
        const telemetry = Reflect.get(globalThis, target.globalName) as ParallaxTelemetryExport;
        return telemetry.snapshot().render.frameCount >= target.frameCount;
      },
      {
        frameCount: start.render.frameCount + SMOKE_MEASUREMENT_FRAMES,
        globalName: SMOKE_TELEMETRY_GLOBAL_NAME,
      },
      { timeout: 15_000 },
    );
    await markPresentationBoundary("end");
    const snapshot = await readTelemetry(page);
    const mainThreadLongTasks = await readMainThreadLongTasks(page);
    const endSurfaceState = await readSurfaceState(page);
    const screenAfterResult = await tryProbe("Browser screen identity", () =>
      readScreenIdentity(page),
    );
    const browserDisplayAfter = browserDisplay(
      screenAfterResult.state === "measured" ? screenAfterResult.value : null,
      refreshRatesHz,
      [
        ...displayProbeFailures,
        ...(screenAfterResult.state === "invalid" ? [screenAfterResult.reason] : []),
      ],
    );
    if (snapshot.render.state !== "ready") {
      throw new Error(
        snapshot.render.failureMessage ?? `Unexpected render state ${snapshot.render.state}`,
      );
    }
    const frames = snapshot.render.recentFrames.slice(-SMOKE_MEASUREMENT_FRAMES);
    const presentIntervals = frames.flatMap((frame) =>
      frame.presentIntervalMs === null ? [] : [frame.presentIntervalMs],
    );
    if (presentIntervals.length !== SMOKE_MEASUREMENT_FRAMES) {
      throw new Error(
        `Expected ${SMOKE_MEASUREMENT_FRAMES} intervals; received ${presentIntervals.length}`,
      );
    }
    if (smokeTrace !== null) {
      await page.waitForTimeout(SMOKE_PRESENTATION_TRACE_TAIL_MS);
    }
    if (errors.length > 0) throw new Error(`Browser errors: ${errors.join(" | ")}`);
    const traceForMemoryDump = smokeTrace;
    const memoryDumpRequest: ProbeResult<MemoryDumpRequest> =
      traceForMemoryDump === null
        ? Object.freeze({
            reason: smokeTraceFailure ?? "Chrome smoke trace is unavailable",
            state: "invalid",
          })
        : await tryProbe("Dawn GPU memory dump request", () =>
            traceForMemoryDump.requestMemoryDump(),
          );
    const histogramsBeforeTraceEnd =
      smokeTrace !== null && dawnBackend?.toLowerCase() === "d3d12"
        ? await tryProbe("Dawn subprocess cache histograms before trace end", () =>
            readD3D12CacheHistograms(context),
          )
        : null;
    const traceToFinish = smokeTrace;
    const traceEvents =
      traceToFinish === null
        ? Object.freeze({
            reason: smokeTraceFailure ?? "Chrome smoke trace is unavailable",
            state: "invalid" as const,
          })
        : await tryProbe("Chrome smoke trace", () => traceToFinish.finish());
    const traceDrain: SmokeTraceDrainMetric =
      traceToFinish === null
        ? Object.freeze({
            evidence: null,
            reason: smokeTraceFailure ?? "Chrome smoke trace is unavailable",
            state: "invalid",
          })
        : traceEvents.state === "invalid"
          ? Object.freeze({
              evidence: traceToFinish.diagnostics(),
              reason: traceEvents.reason,
              state: "invalid",
            })
          : Object.freeze({ evidence: traceToFinish.diagnostics(), state: "measured" });
    const vizPresentationFeedbackCallbackIntervalMs =
      traceEvents.state === "invalid"
        ? traceEvents
        : await tryProbe("Viz presentation-feedback callback intervals", async () =>
            distribution(extractVizPresentationFeedbackCallbackIntervalsMs(traceEvents.value)),
          );
    const histogramsAfterTraceEnd =
      smokeTrace !== null && dawnBackend?.toLowerCase() === "d3d12"
        ? await tryProbe("Dawn subprocess cache histograms after trace end", () =>
            readD3D12CacheHistograms(context),
          )
        : null;
    const dawnPipeline = resolveD3D12DawnPipelineEvidence(
      traceEvents,
      dawnBackend,
      histogramsBeforeTraceEnd,
      histogramsAfterTraceEnd,
    );
    const gpuMemory = resolveGpuMemoryMetric(traceEvents, memoryDumpRequest);
    const browserErrorsBeforeJsHeap = errors.length;
    let jsHeap: JsHeapMetric =
      renderWorkerUrl.state === "measured"
        ? await measureJsHeapMetric(context, page, renderWorkerUrl.value)
        : Object.freeze({
            evidence: null,
            reason: renderWorkerUrl.reason,
            state: "invalid",
          });
    const jsHeapBrowserErrors = errors.slice(browserErrorsBeforeJsHeap);
    if (jsHeapBrowserErrors.length > 0) {
      jsHeap = invalidateJsHeapMetric(
        jsHeap,
        `Browser errors during the JS heap steady-state window: ${jsHeapBrowserErrors.join(" | ")}`,
      );
    }
    const workerAnimationCallbackIntervalMs = distribution(presentIntervals);
    const pipelineBudgetChecks =
      dawnPipeline.state === "measured"
        ? evaluatePipelineBudgets(
            dawnPipeline.value.pipelineActivity.overlappingMeasurement,
            dawnPipeline.value.shaderCache.missesOverlappingMeasurement,
          )
        : [];
    return Object.freeze({
      budgetChecks: Object.freeze([
        ...(jsHeap.state === "measured"
          ? evaluateJsHeapBudget(jsHeap.value.highWaterUsedSizeBytes, tier)
          : []),
        ...evaluateMainThreadBudgets(mainThreadLongTasks),
        ...pipelineBudgetChecks,
      ]),
      browserDisplayAfter,
      browserDisplayBefore,
      cpuFrameMs: measured(distribution(frames.map((frame) => frame.durationMs))),
      dawnPipeline,
      gpuMemory,
      http: measured(subtractServerMetrics(await fetchServerMetrics(baseUrl), before)),
      jsHeap,
      launchOrdinal: launchPosition.launchOrdinal,
      launchStartedAfterSequenceMs: launchPosition.launchStartedAfterSequenceMs,
      mainThreadLongTasksOver50Ms: measured(mainThreadLongTasks),
      profile,
      profileLineage: Object.freeze({
        history: profile === "fresh" ? (["fresh"] as const) : (["fresh", "warm"] as const),
        id: `lineage-${repeat}`,
      }),
      repeat,
      renderSurfaceAfter: endSurfaceState.latest,
      renderSurfaceBefore,
      renderSurfaceChanges: endSurfaceState.changes,
      traceDrain,
      workerInitToFirstFrameMs: measured(requiredNumber(snapshot.render.workerInitToFirstFrameMs)),
      workerStartupToFirstFrameMs: measured(
        requiredNumber(snapshot.render.workerStartupToFirstFrameMs),
      ),
      workerAnimationCallbackIntervalMs: measured(workerAnimationCallbackIntervalMs),
      vizPresentationFeedbackCallbackIntervalMs,
    });
  } finally {
    try {
      if (smokeTrace !== null) {
        const trace = smokeTrace;
        await tryProbe("Chrome smoke trace cleanup", () => trace.discard());
      }
    } finally {
      await context.close();
    }
  }
}

async function measureJsHeapSteadyStateWindow(
  context: BrowserContext,
  page: Page,
  renderWorkerUrl: string,
): Promise<JsHeapEvidence> {
  const browser = context.browser();
  if (browser === null) throw new Error("Playwright did not expose the launched browser");
  let browserSession: CDPSession | null = null;
  let pageSession: CDPSession | null = null;
  let sampler: JsHeapSampler | null = null;
  try {
    browserSession = await withTimeout(
      browser.newBrowserCDPSession(),
      5_000,
      "JS heap browser CDP session creation",
    );
    pageSession = await withTimeout(
      context.newCDPSession(page),
      5_000,
      "JS heap page CDP session creation",
    );
    sampler = await prepareJsHeapSampler(
      browserSession,
      pageSession,
      page.url(),
      renderWorkerUrl,
      SMOKE_JS_HEAP_SAMPLE_INTERVAL_MS,
    );
    const start = await readTelemetry(page);
    sampler.start();
    await page.waitForFunction(
      (target) => {
        const telemetry = Reflect.get(globalThis, target.globalName) as ParallaxTelemetryExport;
        return telemetry.snapshot().render.frameCount >= target.frameCount;
      },
      {
        frameCount: start.render.frameCount + SMOKE_MEASUREMENT_FRAMES,
        globalName: SMOKE_TELEMETRY_GLOBAL_NAME,
      },
      { timeout: 15_000 },
    );
    return await sampler.finish();
  } finally {
    await sampler?.discard().catch(() => undefined);
    if (pageSession !== null) {
      await withTimeout(pageSession.detach(), 1_000, "JS heap page CDP session detach").catch(
        () => undefined,
      );
    }
    if (browserSession !== null) {
      await withTimeout(browserSession.detach(), 1_000, "JS heap browser CDP session detach").catch(
        () => undefined,
      );
    }
  }
}

async function measureJsHeapMetric(
  context: BrowserContext,
  page: Page,
  renderWorkerUrl: string,
): Promise<JsHeapMetric> {
  try {
    return measured(await measureJsHeapSteadyStateWindow(context, page, renderWorkerUrl));
  } catch (error) {
    return Object.freeze({
      evidence: error instanceof JsHeapValidationError ? error.evidence : null,
      reason: `All-realm JS heap steady-state window: ${errorMessage(error)}`,
      state: "invalid",
    });
  }
}

async function measureV8CodeCacheDiagnosticRun(
  executablePath: string,
  profilePath: string,
  baseUrl: string,
  repeat: number,
  profile: "fresh" | "produce" | "warm",
  buildArtifacts: readonly V8ScriptArtifact[],
  launchPosition: LaunchSequencePosition,
  completedHistory: readonly V8CodeCacheDiagnosticRun["profile"][],
): Promise<V8CodeCacheDiagnosticRun> {
  try {
    return await measureV8CodeCacheDiagnosticRunOnce(
      executablePath,
      profilePath,
      baseUrl,
      repeat,
      profile,
      buildArtifacts,
      launchPosition,
      completedHistory,
    );
  } catch (error) {
    const reason = `V8 code-cache diagnostic launch failed: ${errorMessage(error)}`;
    return invalidV8CodeCacheDiagnosticRun(
      reason,
      profile,
      repeat,
      launchPosition,
      completedHistory,
    );
  }
}

function invalidV8CodeCacheDiagnosticRun(
  reason: string,
  profile: V8CodeCacheDiagnosticRun["profile"],
  repeat: number,
  launchPosition: LaunchSequencePosition | null,
  completedHistory: readonly V8CodeCacheDiagnosticRun["profile"][],
): V8CodeCacheDiagnosticRun {
  return Object.freeze({
    diagnosticChecks: Object.freeze([]),
    launchOrdinal: launchPosition?.launchOrdinal ?? null,
    launchStartedAfterSequenceMs: launchPosition?.launchStartedAfterSequenceMs ?? null,
    lifecycleLoadCompleted: false,
    profile,
    profileLineage: v8ProfileLineage(completedHistory, repeat),
    production: Object.freeze({ evidence: null, reason, state: "invalid" }),
    repeat,
    scenario: SMOKE_V8_CODE_CACHE_DIAGNOSTIC,
    traceDrain: Object.freeze({ evidence: null, reason, state: "invalid" }),
    v8CodeCache: Object.freeze({ evidence: null, reason, state: "invalid" }),
    workerStartupToFirstFrameMs: Object.freeze({ reason, state: "invalid" }),
  });
}

async function measureV8CodeCacheDiagnosticRunOnce(
  executablePath: string,
  profilePath: string,
  baseUrl: string,
  repeat: number,
  profile: "fresh" | "produce" | "warm",
  buildArtifacts: readonly V8ScriptArtifact[],
  launchPosition: LaunchSequencePosition,
  completedHistory: readonly V8CodeCacheDiagnosticRun["profile"][],
): Promise<V8CodeCacheDiagnosticRun> {
  const context = await launch(executablePath, profilePath);
  let trace: SmokeTraceCapture | null = null;
  let traceStartFailure: string | null = null;
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const traceStartResult = await tryProbe("V8 code-cache diagnostic trace start", () =>
      beginSmokeTrace(context, {
        categories: [V8_CODE_CACHE_TRACE_CATEGORY],
        requireMeasurementEndMarker: false,
      }),
    );
    if (traceStartResult.state === "measured") {
      trace = traceStartResult.value;
    } else {
      traceStartFailure = traceStartResult.reason;
    }
    await page.goto(baseUrl, { waitUntil: "load" });
    await page.waitForFunction(
      telemetryReady,
      {
        expectedSchemaVersion: SMOKE_TELEMETRY_SCHEMA_VERSION,
        globalName: SMOKE_TELEMETRY_GLOBAL_NAME,
      },
      { timeout: 30_000 },
    );
    const telemetry = await readTelemetry(page);
    const workerStartupToFirstFrameMs = requiredNumber(
      telemetry.render.workerStartupToFirstFrameMs,
    );
    await page.waitForTimeout(SMOKE_TRACE_QUIESCE_MS);
    if (errors.length > 0) throw new Error(`Browser errors: ${errors.join(" | ")}`);
    const traceToFinish = trace;
    const traceEvents =
      traceToFinish === null
        ? Object.freeze({
            reason: traceStartFailure ?? "V8 code-cache diagnostic trace is unavailable",
            state: "invalid" as const,
          })
        : await tryProbe("V8 code-cache diagnostic trace", () => traceToFinish.finish());
    const traceDrain: SmokeTraceDrainMetric =
      traceToFinish === null
        ? Object.freeze({
            evidence: null,
            reason: traceStartFailure ?? "V8 code-cache diagnostic trace is unavailable",
            state: "invalid",
          })
        : traceEvents.state === "invalid"
          ? Object.freeze({
              evidence: traceToFinish.diagnostics(),
              reason: traceEvents.reason,
              state: "invalid",
            })
          : Object.freeze({ evidence: traceToFinish.diagnostics(), state: "measured" });
    const v8CodeCache: V8CodeCacheMetric =
      traceEvents.state === "invalid"
        ? Object.freeze({ evidence: null, reason: traceEvents.reason, state: "invalid" })
        : resolveV8CodeCacheEvidence(traceEvents.value, baseUrl, buildArtifacts, profile);
    const production: V8CodeCacheProductionMetric =
      traceEvents.state === "invalid"
        ? Object.freeze({ evidence: null, reason: traceEvents.reason, state: "invalid" })
        : resolveV8CodeCacheProductionEvidence(traceEvents.value, baseUrl, buildArtifacts, profile);
    const diagnosticChecks =
      profile === "warm"
        ? [
            ...(v8CodeCache.evidence === null
              ? []
              : evaluateV8CodeCacheDiagnostics(
                  v8CodeCache.evidence.rejectedArtifactCount,
                  v8CodeCache.state === "measured",
                )),
            ...(production.evidence === null
              ? []
              : evaluateV8CodeCacheReproductionDiagnostics(
                  production.evidence.producedArtifactCount,
                  production.state === "measured",
                )),
          ]
        : [];
    return Object.freeze({
      diagnosticChecks: Object.freeze(diagnosticChecks),
      launchOrdinal: launchPosition.launchOrdinal,
      launchStartedAfterSequenceMs: launchPosition.launchStartedAfterSequenceMs,
      lifecycleLoadCompleted: true,
      profile,
      profileLineage: v8ProfileLineage([...completedHistory, profile], repeat),
      production,
      repeat,
      scenario: SMOKE_V8_CODE_CACHE_DIAGNOSTIC,
      traceDrain,
      v8CodeCache,
      workerStartupToFirstFrameMs: measured(workerStartupToFirstFrameMs),
    });
  } finally {
    try {
      if (trace !== null) {
        const traceToDiscard = trace;
        await tryProbe("V8 code-cache diagnostic trace cleanup", () => traceToDiscard.discard());
      }
    } finally {
      await context.close();
    }
  }
}

function v8ProfileLineage(
  history: readonly V8CodeCacheDiagnosticRun["profile"][],
  repeat: number,
): V8CodeCacheDiagnosticRun["profileLineage"] {
  return Object.freeze({
    history: Object.freeze([...history]),
    id: `v8-lineage-${repeat}`,
  });
}

interface SmokeTraceCapture {
  diagnostics(): SmokeTraceDrainEvidence;
  discard(): Promise<void>;
  finish(): Promise<readonly ChromeTraceEvent[]>;
  markEnd(page: Page): Promise<void>;
  markStart(page: Page): Promise<void>;
  requestMemoryDump(): Promise<MemoryDumpRequest>;
}

interface SmokeTraceOptions {
  readonly categories: readonly string[];
  readonly requireMeasurementEndMarker: boolean;
}

async function beginSmokeTrace(
  context: BrowserContext,
  options: SmokeTraceOptions,
): Promise<SmokeTraceCapture> {
  const browser = context.browser();
  if (browser === null) throw new Error("Playwright did not expose the launched browser");
  const session = await browser.newBrowserCDPSession();
  const events: ChromeTraceEvent[] = [];
  const categories = Object.freeze([...options.categories]);
  let active = true;
  let completedAtMs: number | null = null;
  let dataChunkCount = 0;
  let dataLossOccurred: boolean | null = null;
  let endCommandCompletedAtMs: number | null = null;
  let endMarked = false;
  let endRequestedAtMs: number | null = null;
  let serializedEventBytes = 0;
  let traceStartedAtMs: number | null = null;
  session.on("Tracing.dataCollected", (event) => {
    const traceEvents = event.value as unknown as readonly ChromeTraceEvent[];
    dataChunkCount += 1;
    serializedEventBytes += Buffer.byteLength(JSON.stringify(traceEvents), "utf8");
    for (const traceEvent of traceEvents) {
      events.push(traceEvent);
    }
  });
  const completed = new Promise<{ dataLossOccurred: boolean }>(
    (resolveComplete, rejectComplete) => {
      session.once("Tracing.tracingComplete", (result) => {
        completedAtMs = performance.now();
        dataLossOccurred = result.dataLossOccurred;
        resolveComplete(result);
      });
      session.once("close", () => rejectComplete(new Error("Smoke trace CDP session closed")));
    },
  );
  void completed.catch(() => undefined);
  try {
    await session.send("Tracing.start", {
      traceConfig: {
        includedCategories: [...categories],
        ...(categories.includes(MEMORY_INFRA_TRACE_CATEGORY) ? { memoryDumpConfig: {} } : {}),
        recordMode: "recordAsMuchAsPossible",
      },
      transferMode: "ReportEvents",
    });
    traceStartedAtMs = performance.now();
  } catch (error) {
    await session.detach().catch(() => undefined);
    throw error;
  }

  const stop = async (): Promise<{ dataLossOccurred: boolean }> => {
    if (!active) throw new Error("Smoke trace was already stopped");
    active = false;
    endRequestedAtMs = performance.now();
    try {
      try {
        return await withTimeout(
          (async () => {
            await session.send("Tracing.end");
            endCommandCompletedAtMs = performance.now();
            return completed;
          })(),
          SMOKE_PRESENTATION_TRACE_COMPLETION_TIMEOUT_MS,
          "Smoke trace end/completion",
        );
      } catch (error) {
        const diagnostics = snapshotDiagnostics();
        throw new Error(
          `${errorMessage(error)}; Tracing.end command ${formatMilliseconds(diagnostics.endCommandMs)}; received ${diagnostics.eventCount} events in ${diagnostics.dataChunkCount} chunks (${diagnostics.serializedEventBytes} serialized bytes) during ${formatMilliseconds(diagnostics.endWaitMs)}`,
        );
      }
    } finally {
      await session.detach().catch(() => undefined);
    }
  };
  const snapshotDiagnostics = (): SmokeTraceDrainEvidence =>
    Object.freeze({
      categories,
      completionAfterEndCommandMs:
        completedAtMs === null || endCommandCompletedAtMs === null
          ? null
          : completedAtMs - endCommandCompletedAtMs,
      completionTimeoutMs: SMOKE_PRESENTATION_TRACE_COMPLETION_TIMEOUT_MS,
      dataChunkCount,
      dataLossOccurred,
      endWaitMs:
        endRequestedAtMs === null ? null : (completedAtMs ?? performance.now()) - endRequestedAtMs,
      endCommandMs:
        endRequestedAtMs === null || endCommandCompletedAtMs === null
          ? null
          : endCommandCompletedAtMs - endRequestedAtMs,
      eventCount: events.length,
      recordingDurationBeforeEndMs:
        traceStartedAtMs === null || endRequestedAtMs === null
          ? null
          : endRequestedAtMs - traceStartedAtMs,
      serializedEventBytes,
    });
  return Object.freeze({
    diagnostics: snapshotDiagnostics,
    async discard(): Promise<void> {
      if (active) await stop();
    },
    async finish(): Promise<readonly ChromeTraceEvent[]> {
      if (options.requireMeasurementEndMarker && !endMarked) {
        throw new Error("Smoke trace ended before its measurement marker");
      }
      const result = await stop();
      if (result.dataLossOccurred) throw new Error("Chrome reported smoke trace data loss");
      return Object.freeze(events);
    },
    async markEnd(page: Page): Promise<void> {
      if (endMarked) throw new Error("Smoke trace end was marked more than once");
      await markPresentationTrace(page, PRESENTATION_TRACE_END_MARKER);
      endMarked = true;
    },
    markStart(page: Page): Promise<void> {
      return markPresentationTrace(page, PRESENTATION_TRACE_START_MARKER);
    },
    async requestMemoryDump(): Promise<MemoryDumpRequest> {
      if (!active) throw new Error("Cannot request a memory dump after the smoke trace stopped");
      const startedAtMs = performance.now();
      const result = await withTimeout(
        session.send("Tracing.requestMemoryDump", {
          deterministic: false,
          levelOfDetail: "background",
        }),
        5_000,
        "Chrome global memory dump request",
      );
      return Object.freeze({
        dumpGuid: result.dumpGuid,
        requestDurationMs: performance.now() - startedAtMs,
        success: result.success,
      });
    },
  });
}

function markPresentationTrace(page: Page, marker: string): Promise<void> {
  return page.evaluate((name) => performance.mark(name), marker).then(() => undefined);
}

function launch(
  executablePath: string,
  profilePath: string,
  args: readonly string[] = [],
): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profilePath, {
    executablePath,
    headless: false,
    args: ["--start-fullscreen", ...args],
    viewport: null,
  });
}

function readWebGpuAdapterIdentity(page: Page): Promise<WebGpuAdapterIdentity> {
  return page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    if (adapter === null || adapter === undefined) throw new Error("WebGPU adapter is unavailable");
    const info = adapter.info;
    const optionalString = (name: string): string | null => {
      const value = Reflect.get(info, name);
      return typeof value === "string" ? value : null;
    };
    return Object.freeze({
      architecture: info.architecture,
      backend: optionalString("backend"),
      description: info.description,
      device: info.device,
      driver: optionalString("driver"),
      isFallbackAdapter: info.isFallbackAdapter,
      type: optionalString("type"),
      vendor: info.vendor,
    });
  });
}

async function readBrowserDisplayIdentity(
  context: BrowserContext,
  page: Page,
): Promise<BrowserDisplayIdentity> {
  const refreshRatesHz = await readChromeDisplayRefreshRates(context);
  return browserDisplay(await readScreenIdentity(page), refreshRatesHz, []);
}

function readScreenIdentity(page: Page): Promise<NonNullable<BrowserDisplayIdentity["screen"]>> {
  return page.evaluate(() =>
    Object.freeze({
      availHeight: screen.availHeight,
      availWidth: screen.availWidth,
      colorDepth: screen.colorDepth,
      devicePixelRatio,
      height: screen.height,
      width: screen.width,
    }),
  );
}

function browserDisplay(
  screen: BrowserDisplayIdentity["screen"],
  refreshRatesHz: readonly number[],
  probeFailures: readonly string[],
): BrowserDisplayIdentity {
  return Object.freeze({ probeFailures, refreshRatesHz, screen });
}

function installSurfaceObserver(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolveReady, rejectReady) => {
        const canvas = document.querySelector("#render-canvas");
        if (!(canvas instanceof HTMLCanvasElement)) {
          rejectReady(new Error("Render canvas is missing"));
          return;
        }
        const sizes: { height: number; width: number }[] = [];
        let latest: { height: number; width: number } | null = null;
        let ready = false;
        const observer = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const size = entry.devicePixelContentBoxSize[0];
            if (size !== undefined) {
              latest = { height: size.blockSize, width: size.inlineSize };
              sizes.push(latest);
            }
          }
          if (!ready && sizes.length > 0) {
            ready = true;
            clearTimeout(timeout);
            resolveReady();
          }
        });
        const timeout = setTimeout(() => {
          observer.disconnect();
          rejectReady(new Error("Canvas device-pixel observer initialization timed out"));
        }, 5_000);
        Object.defineProperty(globalThis, "__PARALLAX_HARNESS_SURFACE__", {
          value: Object.freeze({
            reset: () => {
              return new Promise<void>((resolveReset) => {
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    sizes.length = 0;
                    resolveReset();
                  });
                });
              });
            },
            latest: () => {
              if (latest === null) throw new Error("Canvas device-pixel size is unavailable");
              return Object.freeze({ ...latest });
            },
            snapshot: () => sizes.map((size) => Object.freeze({ ...size })),
          }),
        });
        observer.observe(canvas, { box: "device-pixel-content-box" });
      }),
  );
}

function resetSurfaceObserver(page: Page): Promise<void> {
  return page.evaluate(() => {
    const state = Reflect.get(globalThis, "__PARALLAX_HARNESS_SURFACE__") as {
      reset(): Promise<void>;
    };
    return state.reset();
  });
}

function readSurfaceLatest(page: Page): Promise<Readonly<{ height: number; width: number }>> {
  return page.evaluate(() => {
    const state = Reflect.get(globalThis, "__PARALLAX_HARNESS_SURFACE__") as {
      latest(): Readonly<{ height: number; width: number }>;
    };
    return state.latest();
  });
}

function readSurfaceState(page: Page): Promise<
  Readonly<{
    changes: readonly Readonly<{ height: number; width: number }>[];
    latest: Readonly<{ height: number; width: number }>;
  }>
> {
  return page.evaluate(() => {
    const state = Reflect.get(globalThis, "__PARALLAX_HARNESS_SURFACE__") as {
      latest(): Readonly<{ height: number; width: number }>;
      snapshot(): readonly Readonly<{ height: number; width: number }>[];
    };
    return Object.freeze({
      changes: state.snapshot(),
      latest: state.latest(),
    });
  });
}

async function readChromeDisplayRefreshRates(context: BrowserContext): Promise<readonly number[]> {
  const gpuPage = await context.newPage();
  try {
    await gpuPage.goto("chrome://gpu", { waitUntil: "load" });
    const session = await context.newCDPSession(gpuPage);
    const document = (await session.send("DOM.getDocument")) as { root: { nodeId: number } };
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const matches = (await session.send("Accessibility.queryAXTree", {
        accessibleName: "Refresh Rate in Hz",
        nodeId: document.root.nodeId,
      })) as { nodes: readonly { name?: { value?: unknown } }[] };
      const labelIsReady = matches.nodes.some((node) => node.name?.value === "Refresh Rate in Hz");
      if (!labelIsReady) {
        await gpuPage.waitForTimeout(250);
        continue;
      }
      const tree = (await session.send("Accessibility.getFullAXTree")) as {
        nodes: readonly { name?: { value?: unknown } }[];
      };
      const names = tree.nodes.flatMap((node) =>
        typeof node.name?.value === "string" ? [node.name.value] : [],
      );
      const refreshRates = parseDisplayRefreshRates(names);
      if (refreshRates.length > 0) {
        return Object.freeze([...new Set(refreshRates)]);
      }
      await gpuPage.waitForTimeout(250);
    }
    return Object.freeze([]);
  } finally {
    await gpuPage.close();
  }
}

function revalidateHostEnvironment(
  environment: EnvironmentIdentity,
  result: WindowsHostIdentityResult,
): EnvironmentIdentity {
  if (result.state === "invalid") {
    return invalidateEnvironment(environment, [result.reason]);
  }
  const hostAfterRuns = result.host;
  if (environment.host !== null && jsonEquals(environment.host, hostAfterRuns)) {
    return Object.freeze({ ...environment, hostAfterRuns });
  }
  return Object.freeze({
    ...invalidateEnvironment(environment, [
      environment.host === null
        ? "Pre-run Windows host identity was unavailable"
        : "Host environment changed between pre-run and post-run identity probes",
    ]),
    hostAfterRuns,
  });
}

function revalidateRunDisplays(
  environment: EnvironmentIdentity,
  runs: readonly RunMeasurement[],
): EnvironmentIdentity {
  const reasons: string[] = [];
  for (const run of runs) {
    const runLabel = `${run.profile} repeat ${run.repeat}`;
    if (environment.machine !== null) {
      for (const [phase, display] of [
        ["before", run.browserDisplayBefore],
        ["after", run.browserDisplayAfter],
      ] as const) {
        for (const reason of evaluateBrowserDisplay(environment.machine.display, display)) {
          reasons.push(`${runLabel} ${phase}: ${reason}`);
        }
      }
      for (const [phase, surface] of [
        ["before", run.renderSurfaceBefore],
        ["after", run.renderSurfaceAfter],
        ...run.renderSurfaceChanges.map((surface) => ["during", surface] as const),
      ] as const) {
        const surfaceMismatch = renderSurfaceMismatch(
          environment.requestedTier,
          surface,
          environment.machine.display.dimensionTolerancePixels,
        );
        if (surfaceMismatch !== null) reasons.push(`${runLabel} ${phase}: ${surfaceMismatch}`);
      }
    }
    if (!jsonEquals(run.browserDisplayBefore, run.browserDisplayAfter)) {
      reasons.push(`${runLabel}: browser display identity changed during the measurement window`);
    }
    if (
      run.renderSurfaceChanges.length > 0 ||
      !jsonEquals(run.renderSurfaceBefore, run.renderSurfaceAfter)
    ) {
      reasons.push(`${runLabel}: render surface changed during the measurement window`);
    }
  }
  return reasons.length === 0 ? environment : invalidateEnvironment(environment, reasons);
}

function invalidateEnvironment(
  environment: EnvironmentIdentity,
  reasons: readonly string[],
): EnvironmentIdentity {
  const priorReasons =
    environment.gateIdentity.state === "invalid" ? environment.gateIdentity.reasons : [];
  return Object.freeze({
    ...environment,
    gateIdentity: invalidEnvironmentGate([...priorReasons, ...reasons]),
  });
}

function jsonEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function telemetryReady(contract: { expectedSchemaVersion: number; globalName: string }): boolean {
  const telemetry = Reflect.get(globalThis, contract.globalName) as
    | ParallaxTelemetryExport
    | undefined;
  if (telemetry === undefined) return false;
  const snapshot = telemetry.snapshot();
  if (snapshot.render.state === "failed")
    throw new Error(snapshot.render.failureMessage ?? "Render failed");
  return (
    snapshot.schemaVersion === contract.expectedSchemaVersion && snapshot.render.state === "ready"
  );
}

function readTelemetry(page: Page): Promise<ParallaxTelemetrySnapshot> {
  return page.evaluate((globalName) => {
    const telemetry = Reflect.get(globalThis, globalName) as ParallaxTelemetryExport;
    return telemetry.snapshot();
  }, SMOKE_TELEMETRY_GLOBAL_NAME);
}

async function installLongTaskObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let longTasks = 0;
    const observer = new PerformanceObserver((list) => {
      longTasks += list.getEntries().filter((entry) => entry.duration > 50).length;
    });
    observer.observe({ type: "longtask", buffered: true } as unknown as PerformanceObserverInit);
    Object.defineProperty(globalThis, "__PARALLAX_HARNESS_LONG_TASKS__", {
      value: Object.freeze({
        count: () => longTasks,
        reset: () => {
          observer.takeRecords();
          longTasks = 0;
        },
      }),
    });
  });
}

function resetLongTaskObserver(page: Page): Promise<void> {
  return page.evaluate(() => {
    const state = Reflect.get(globalThis, "__PARALLAX_HARNESS_LONG_TASKS__") as {
      reset(): void;
    };
    state.reset();
  });
}

function readMainThreadLongTasks(page: Page): Promise<number> {
  return page.evaluate(() => {
    const state = Reflect.get(globalThis, "__PARALLAX_HARNESS_LONG_TASKS__") as {
      count(): number;
    };
    return state.count();
  });
}

async function fetchServerMetrics(baseUrl: string): Promise<LocalServerMetrics> {
  const response = await fetch(`${baseUrl}/__parallax/metrics`);
  if (!response.ok) throw new Error(`Server metrics request failed with ${response.status}`);
  return (await response.json()) as LocalServerMetrics;
}

function subtractServerMetrics(
  after: LocalServerMetrics,
  before: LocalServerMetrics,
): LocalServerMetrics {
  const statuses: Record<string, number> = {};
  for (const [status, count] of Object.entries(after.statuses)) {
    statuses[status] = count - (before.statuses[status] ?? 0);
  }
  return {
    bytesServed: after.bytesServed - before.bytesServed,
    metadataCacheHits: after.metadataCacheHits - before.metadataCacheHits,
    metadataCacheMisses: after.metadataCacheMisses - before.metadataCacheMisses,
    pathClasses: {
      document: after.pathClasses.document - before.pathClasses.document,
      immutable: after.pathClasses.immutable - before.pathClasses.immutable,
      other: after.pathClasses.other - before.pathClasses.other,
    },
    requests: after.requests - before.requests,
    schemaVersion: 1,
    statuses,
  };
}

async function writeReport(report: SmokeReport): Promise<void> {
  await mkdir(outputRoot, { recursive: true });
  const timestamp = report.generatedAt.replaceAll(/[:.]/g, "-");
  const stem = [
    report.scenario.replace("@", "-"),
    report.artifactDigest.slice(0, 12),
    safeMachineIdForFilename(report.environment.machineId),
    report.environment.requestedTier,
    timestamp,
  ].join("-");
  await writeFile(join(outputRoot, `${stem}.json`), `${JSON.stringify(report, null, 2)}\n`);
  const failures = [
    ...report.facets.environment.reasons,
    ...report.facets.evidenceCompleteness.reasons,
    ...report.facets.budgetEvaluation.reasons,
  ];
  const dawnEvidence = report.runs.map((run) => {
    if (run.dawnPipeline.state !== "measured") {
      return `- ${run.profile} repeat ${run.repeat}: ${run.dawnPipeline.state} — ${run.dawnPipeline.reason}`;
    }
    const evidence = run.dawnPipeline.value;
    return `- ${run.profile} repeat ${run.repeat}: shader hits/misses ${evidence.shaderCache.hitCount}/${evidence.shaderCache.missCount}; graphics PSO ${formatDawnCachePath(evidence.pipelineCache.render)}; compute PSO ${formatDawnCachePath(evidence.pipelineCache.compute)}; gameplay-overlap pipeline/shader ${evidence.pipelineActivity.overlappingMeasurement}/${evidence.shaderCache.missesOverlappingMeasurement}`;
  });
  const gpuMemoryEvidence = report.runs.map((run) => {
    const metricSummary =
      run.gpuMemory.state === "measured"
        ? `${run.gpuMemory.state} — ${formatBytes(run.gpuMemory.value.envelopePeakBytes)} envelope peak (${formatBytes(run.gpuMemory.value.residentBytes)} resident + ${formatBytes(run.gpuMemory.value.transientPeakBytes)} transient peak)`
        : `${run.gpuMemory.state} — ${run.gpuMemory.reason}`;
    const providerDiagnostic = run.gpuMemory.diagnostic;
    if (providerDiagnostic === null) {
      return `- ${run.profile} repeat ${run.repeat}: ${metricSummary}; no provider diagnostic`;
    }
    const diagnostic = providerDiagnostic.result;
    if (diagnostic.state === "invalid") {
      const request = diagnostic.request;
      return `- ${run.profile} repeat ${run.repeat}: ${metricSummary}; memory-infra diagnostic invalid — ${diagnostic.reason}${request === null ? "" : `; dump ${request.dumpGuid} completed in ${formatMilliseconds(request.requestDurationMs)}`}`;
    }
    const evidence = diagnostic.evidence;
    const request = diagnostic.request;
    return `- ${run.profile} repeat ${run.repeat}: ${metricSummary}; measured memory-infra diagnostic exported as ${evidence.exportedDumpName}/${evidence.exportedDumpId ?? "no id"} with ${evidence.allocatorCount} allocators (${evidence.webGpuRelatedAllocatorNames.length === 0 ? "no Dawn/WebGPU-named allocator" : evidence.webGpuRelatedAllocatorNames.join(", ")}); CDP request ${request.dumpGuid} completed in ${formatMilliseconds(request.requestDurationMs)}`;
  });
  const v8Evidence = report.v8CodeCacheDiagnostics.map((run) => {
    if (run.v8CodeCache.state !== "measured") {
      const retainedEvidence = run.v8CodeCache.evidence;
      const retainedSummary =
        retainedEvidence === null
          ? ""
          : `; retained outcomes: ${retainedEvidence.artifacts.map(formatV8ArtifactOutcome).join(", ")}`;
      return `- ${run.profile} repeat ${run.repeat}: ${run.v8CodeCache.state} — ${run.v8CodeCache.reason}${retainedSummary}`;
    }
    const evidence = run.v8CodeCache.evidence;
    if (run.profile === "fresh") {
      return `- fresh repeat ${run.repeat}: attributed ${evidence.artifacts.length} immutable JavaScript artifacts; ${evidence.cacheableArtifactCount} cacheable artifacts are cold-profile/not-applicable`;
    }
    return run.profile === "produce"
      ? `- produce repeat ${run.repeat}: attributed ${evidence.artifacts.length} immutable JavaScript artifacts; cache consumption is timestamp-profile/not-applicable`
      : `- warm repeat ${run.repeat}: consumed ${evidence.consumedArtifactCount}/${evidence.cacheableArtifactCount} cacheable immutable JavaScript artifacts; rejected ${evidence.rejectedArtifactCount}`;
  });
  const v8ProductionEvidence = report.v8CodeCacheDiagnostics.map((run) => {
    const evidence = run.production.evidence;
    if (run.production.state !== "measured" || evidence === null) {
      const retained =
        evidence === null
          ? ""
          : `; retained outcomes: ${evidence.artifacts
              .map((artifact) => {
                if (artifact.state !== "measured") {
                  return `${artifact.artifact}=${artifact.state}`;
                }
                const producedBytes = artifact.productions.reduce(
                  (total, production) =>
                    total + (production.state === "measured" ? production.producedBytes : 0),
                  0,
                );
                return `${artifact.artifact}=produced(${producedBytes} bytes)`;
              })
              .join(", ")}`;
      return `- ${run.profile} repeat ${run.repeat}: ${run.production.state} — ${"reason" in run.production ? run.production.reason : "unknown production failure"}${retained}`;
    }
    if (run.profile === "fresh") {
      return `- fresh repeat ${run.repeat}: no unexpected URL-attributed code-cache production events`;
    }
    if (run.profile === "warm") {
      const reproduced = evidence.artifacts
        .filter((artifact) => artifact.state === "measured")
        .map(
          (artifact) =>
            `${artifact.artifact}=${artifact.productions.reduce((total, production) => total + production.producedBytes, 0)} bytes`,
        );
      return `- warm repeat ${run.repeat}: re-produced ${evidence.producedArtifactCount}/${evidence.cacheableArtifactCount} cacheable artifacts, ${evidence.producedBytes} bytes total${reproduced.length === 0 ? "; no URL-attributed re-production observed" : `; ${reproduced.join(", ")}`}`;
    }
    return `- produce repeat ${run.repeat}: produced ${evidence.producedArtifactCount}/${evidence.cacheableArtifactCount} cacheable artifacts, ${evidence.producedBytes} bytes total; ${evidence.artifacts
      .filter((artifact) => artifact.state === "measured")
      .map(
        (artifact) =>
          `${artifact.artifact}=${artifact.productions.reduce((total, production) => total + production.producedBytes, 0)} bytes`,
      )
      .join(", ")}`;
  });
  const v8CompileDurationEvidence = report.v8CodeCacheDiagnostics.map((run) => {
    const evidence = run.v8CodeCache.evidence;
    if (evidence === null) {
      return `- ${run.profile} repeat ${run.repeat}: invalid — compilation evidence unavailable`;
    }
    const totalDurationUs = evidence.artifacts.reduce(
      (total, artifact) => total + artifact.compileDurationUs,
      0,
    );
    const artifacts = evidence.artifacts.map((artifact) => {
      const modes = [...new Set(artifact.compilations.map((compilation) => compilation.streamed))]
        .map((streamed) => (streamed ? "streamed" : "non-streamed"))
        .join("+");
      return `${artifact.artifact}=${artifact.compileDurationUs} µs (${modes}; ${artifact.compilations.length} event${artifact.compilations.length === 1 ? "" : "s"})`;
    });
    return `- ${run.profile} repeat ${run.repeat}: ${totalDurationUs} µs total; ${artifacts.join(", ")}`;
  });
  const v8WorkerStartupEvidence = report.v8CodeCacheDiagnostics.map((run) => {
    const metric = run.workerStartupToFirstFrameMs;
    return metric.state === "measured"
      ? `- ${run.profile} repeat ${run.repeat}: ${formatMilliseconds(metric.value)}`
      : `- ${run.profile} repeat ${run.repeat}: invalid — ${metric.reason}`;
  });
  const traceDrainEvidence = report.runs.map((run) => {
    const evidence = run.traceDrain.evidence;
    if (evidence === null) {
      return `- core ${run.profile} repeat ${run.repeat}; launch ${run.launchOrdinal} at +${formatMilliseconds(run.launchStartedAfterSequenceMs)}: invalid — ${run.traceDrain.state === "invalid" ? run.traceDrain.reason : "trace diagnostics unavailable"}`;
    }
    const completion =
      run.traceDrain.state === "measured"
        ? `${formatMilliseconds(evidence.endWaitMs)} to completion`
        : `${formatMilliseconds(evidence.endWaitMs)} before invalidation`;
    return `- core ${run.profile} repeat ${run.repeat}; launch ${run.launchOrdinal} at +${formatMilliseconds(run.launchStartedAfterSequenceMs)}: ${run.traceDrain.state}; categories ${evidence.categories.join(", ")}; recording before end ${formatMilliseconds(evidence.recordingDurationBeforeEndMs)}; ${evidence.eventCount} events / ${evidence.dataChunkCount} chunks / ${evidence.serializedEventBytes} serialized bytes; Tracing.end command ${formatMilliseconds(evidence.endCommandMs)}; completion after command ${formatMilliseconds(evidence.completionAfterEndCommandMs)}; data loss ${evidence.dataLossOccurred ?? "unknown"}; ${completion}`;
  });
  traceDrainEvidence.push(
    ...report.v8CodeCacheDiagnostics.map((run) => {
      const evidence = run.traceDrain.evidence;
      const launch =
        run.launchOrdinal === null || run.launchStartedAfterSequenceMs === null
          ? "not launched"
          : `launch ${run.launchOrdinal} at +${formatMilliseconds(run.launchStartedAfterSequenceMs)}`;
      if (evidence === null) {
        return `- V8 diagnostic ${run.profile} repeat ${run.repeat}; ${launch}: invalid — ${run.traceDrain.state === "invalid" ? run.traceDrain.reason : "trace diagnostics unavailable"}`;
      }
      const completion =
        run.traceDrain.state === "measured"
          ? `${formatMilliseconds(evidence.endWaitMs)} to completion`
          : `${formatMilliseconds(evidence.endWaitMs)} before invalidation`;
      return `- V8 diagnostic ${run.profile} repeat ${run.repeat}; ${launch}: ${run.traceDrain.state}; categories ${evidence.categories.join(", ")}; recording before end ${formatMilliseconds(evidence.recordingDurationBeforeEndMs)}; ${evidence.eventCount} events / ${evidence.dataChunkCount} chunks / ${evidence.serializedEventBytes} serialized bytes; Tracing.end command ${formatMilliseconds(evidence.endCommandMs)}; completion after command ${formatMilliseconds(evidence.completionAfterEndCommandMs)}; data loss ${evidence.dataLossOccurred ?? "unknown"}; ${completion}`;
    }),
  );
  const jsHeapEvidence = report.runs.map((run) => {
    const invalidReason = run.jsHeap.state === "invalid" ? run.jsHeap.reason : null;
    const evidence = run.jsHeap.state === "measured" ? run.jsHeap.value : run.jsHeap.evidence;
    if (evidence === null) {
      return `- ${run.profile} repeat ${run.repeat}: invalid — ${invalidReason ?? "unknown failure"}`;
    }
    const validity = invalidReason === null ? "measured" : `invalid — ${invalidReason}; retained`;
    return `- ${run.profile} repeat ${run.repeat}: ${validity} near-concurrent aggregate used-heap high-water estimate ${formatBytes(evidence.highWaterUsedSizeBytes)} across window + render worker; ${evidence.samples.length} samples over ${formatMilliseconds(evidence.periodicSamplingDurationMs)} at ${evidence.sampleIntervalMs} ms fixed-deadline interval in a dedicated post-trace steady-state window; missed deadlines ${evidence.missedSampleDeadlines}; maximum start delay ${formatMilliseconds(evidence.maximumSamplingStartDelayMs)}; maximum realm response-completion skew ${formatMilliseconds(evidence.maximumRealmResponseCompletionSkewMs)}; slowest collection ${formatMilliseconds(evidence.maximumCollectionDurationMs)}`;
  });
  const lines = [
    `# Parallax ${report.scenario}`,
    "",
    `Verdict: **${report.passed ? "PASS" : "FAIL"}**`,
    `Artifact: \`${report.artifactDigest}\``,
    `Chrome: \`${report.environment.browserProduct}\``,
    "",
    "## Result facets",
    "",
    ...formatSmokeFacetSummary(report.facets),
    "",
    "## Failures",
    "",
    ...(failures.length === 0 ? ["None."] : failures.map((failure) => `- ${failure}`)),
    "",
    "## Informational failures (non-blocking)",
    "",
    ...(report.informationalFailures.length === 0
      ? ["None."]
      : report.informationalFailures.map((failure) => `- ${failure}`)),
    "",
    "## Dawn pipeline/cache evidence",
    "",
    ...dawnEvidence,
    "",
    "## GPU memory observability",
    "",
    ...gpuMemoryEvidence,
    "",
    `## V8 code-cache evidence (${SMOKE_V8_CODE_CACHE_DIAGNOSTIC})`,
    "",
    ...v8Evidence,
    "",
    "## V8 code-cache production",
    "",
    ...v8ProductionEvidence,
    "",
    "## V8 compile-event duration diagnostics",
    "",
    ...v8CompileDurationEvidence,
    "",
    "## V8 worker startup-to-first-frame diagnostics",
    "",
    ...v8WorkerStartupEvidence,
    "",
    "## All-worker JavaScript heap",
    "",
    ...jsHeapEvidence,
    "",
    "## Trace drain diagnostics",
    "",
    ...traceDrainEvidence,
    "",
  ];
  await writeFile(join(outputRoot, `${stem}.md`), lines.join("\n"));
  console.log(lines.join("\n"));
}

function formatV8ArtifactOutcome(artifact: V8CodeCacheArtifactEvidence): string {
  if (artifact.cache.state === "measured") {
    const bytes = artifact.cache.consumedBytes ?? "unknown-size";
    return `${artifact.artifact}=${artifact.cache.outcome}(${bytes} bytes; ${artifact.compilations.length} compilation${artifact.compilations.length === 1 ? "" : "s"})`;
  }
  const rejectedCompilations = artifact.compilations.filter(
    (compilation) =>
      compilation.cache.state === "measured" && compilation.cache.outcome === "rejected",
  ).length;
  return `${artifact.artifact}=${artifact.cache.state}(${artifact.compilations.length} compilation${artifact.compilations.length === 1 ? "" : "s"}${rejectedCompilations === 0 ? "" : `; ${rejectedCompilations} rejected`})`;
}

function formatDawnCachePath(path: DawnPipelineEvidence["pipelineCache"]["compute"]): string {
  return path.state === "measured"
    ? `hits/misses ${path.value.hitCount}/${path.value.missCount}`
    : `${path.state} (${path.reason})`;
}

function formatMilliseconds(value: number | null): string {
  return value === null ? "unknown duration" : `${value.toFixed(1)} ms`;
}

function formatBytes(value: number): string {
  return `${value.toLocaleString("en-US")} bytes`;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
}

function requiredNumber(value: number | null): number {
  if (value === null) throw new Error("Required telemetry timing is missing");
  return value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
