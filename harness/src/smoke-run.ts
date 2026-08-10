import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type HybridUiTelemetrySnapshot,
  type ParallaxTelemetryExport,
  type PsoWarmupTelemetrySnapshot,
  TELEMETRY_FRAME_BATCH_FRAMES,
} from "@parallax/engine";
import type { BrowserContext, CDPSession, Page } from "playwright-core";
import {
  type BoundedRepeatabilityMetric,
  type Distribution,
  distribution,
  evaluateBoundedRepeatability,
  evaluateP95Variance,
  type VarianceMetric,
} from "./aggregate.js";
import {
  type BaselineEvaluation,
  baselineStorePath,
  evaluateBaselineSafely,
  loadBaselineStore,
} from "./baseline-store.js";
import { readChromeDisplayRefreshRates } from "./browser-probes.js";
import {
  type BudgetCheck,
  type DiagnosticCheck,
  evaluateJsHeapBudget,
  evaluateMainThreadBudgets,
  evaluatePipelineBudgets,
  evaluateSimulationGameplayBudget,
  evaluateStreamingBudgets,
  evaluateV8CodeCacheDiagnostics,
  evaluateV8CodeCacheReproductionDiagnostics,
  type QualityTier,
} from "./budgets.js";
import { type BuildManifest, readAndValidateBuildManifest, sha256File } from "./build-manifest.js";
import {
  type ChromeLaunchMode,
  type ChromePin,
  launchPersistentChrome,
  loadSmokeChromePin,
  resolveChromeExecutablePath,
} from "./chrome-pin.js";
import {
  D3D12_HISTOGRAM_PREFIX,
  DAWN_TRACE_CATEGORY,
  type DawnHistogram,
  type DawnPipelineEvidence,
  resolveD3D12DawnPipelineEvidence,
} from "./dawn-pipeline-trace.js";
import {
  type BrowserDisplayIdentity,
  evaluateBrowserDisplay,
  invalidEnvironmentGate,
  safeMachineIdForFilename,
  tryReadWindowsHostIdentity,
  type WindowsHostIdentityResult,
} from "./environment.js";
import { markerAlignedWindowStart, selectMeasurementFrameWindow } from "./frame-window.js";
import {
  type GpuMemoryMetric,
  MEMORY_INFRA_TRACE_CATEGORY,
  type MemoryDumpRequest,
  resolveGpuMemoryMetric,
} from "./gpu-memory.js";
import { analyzeGreyboxRenderedOutput } from "./greybox-rendered-output.js";
import { type GreyboxWorldEvidence, requireGreyboxWorld } from "./greybox-world-evidence.js";
import { resolveHeapWorkerTargetUrls } from "./heap-worker-topology.js";
import { formatHttpServingEvidence } from "./http-evidence.js";
import {
  invalidateJsHeapMetric,
  type JsHeapEvidence,
  type JsHeapMetric,
  type JsHeapSampler,
  JsHeapValidationError,
  prepareJsHeapSampler,
} from "./js-heap.js";
import { launchAfterPhysicalConsoleDisplayWake } from "./physical-console-preflight.js";
import {
  type ChromeTraceEvent,
  extractVizPresentationFeedbackCallbackIntervalsMs,
  observeThroughLateCompletionWindow,
  PRESENTATION_TRACE_CATEGORY,
  PRESENTATION_TRACE_END_MARKER,
  PRESENTATION_TRACE_START_MARKER,
  withTimeout,
} from "./presentation-trace.js";
import { resolvePsoWarmupEvidence } from "./pso-warmup-smoke-evidence.js";
import {
  type RegisteredEnvironmentIdentity as EnvironmentIdentity,
  inspectRegisteredEnvironment,
  type RegisteredBrowserValidation,
} from "./registered-environment.js";
import {
  evaluatePostRunIdentity,
  type FinalizationEvidence,
  invalidFinalizationEvidence,
  measuredFinalizationEvidence,
  persistJsonPrimaryReport,
  type ReportPersistenceDependencies,
} from "./report-finalization.js";
import { evaluateResultFacets, type ResultFacets, resultFacetsPassed } from "./result-facets.js";
import {
  parseQualityTier,
  parseSmokeRunOptions,
  renderSurfaceMismatch,
  SMOKE_HYBRID_UI_TELEMETRY_SCHEMA_VERSION,
  SMOKE_INCOMPLETE_METRICS,
  SMOKE_JS_HEAP_SAMPLE_INTERVAL_MS,
  SMOKE_MANDATORY_METRIC_SET_VERSION,
  SMOKE_MEASUREMENT_FRAMES,
  SMOKE_METRICS,
  SMOKE_PRESENTATION_TRACE_COMPLETION_TIMEOUT_MS,
  SMOKE_PRESENTATION_TRACE_LATE_OBSERVATION_MS,
  SMOKE_PRESENTATION_TRACE_TAIL_MS,
  SMOKE_REPEATS,
  SMOKE_REPORT_SCHEMA_VERSION,
  SMOKE_SCENARIO,
  SMOKE_SIMULATION_GAMEPLAY_WORKLOAD,
  SMOKE_STREAMING_P95_ABSOLUTE_RANGE_FLOOR_MS,
  SMOKE_STREAMING_P95_RELATIVE_RANGE_LIMIT,
  SMOKE_TELEMETRY_GLOBAL_NAME,
  SMOKE_TELEMETRY_SCHEMA_VERSION,
  SMOKE_TRACE_QUIESCE_MS,
  SMOKE_V8_CODE_CACHE_DIAGNOSTIC,
  SMOKE_V8_CODE_CACHE_DIAGNOSTIC_REPEATS,
  SMOKE_WARMUP_MS,
  SMOKE_WASM_THREAD_COMPLETION_TIMEOUT_MS,
  type SmokeMetricDefinition,
} from "./runs/smoke.js";
import {
  requireSabRingBufferCompleteAtMeasurementBoundary,
  type SabRingBufferMetric,
} from "./sab-ring-buffer.js";
import type { LocalServerMetrics } from "./server.js";
import {
  collectSmokeBudgetFacetChecks,
  collectSmokeEnvironmentFacetInput,
  collectSmokeEvidenceChecks,
  collectSmokeInformationalFailures,
  formatSmokeFacetSummary,
} from "./smoke-result.js";
import { readSourceIdentity, type SourceIdentity } from "./source-identity.js";
import {
  type StreamingEvidence,
  type StreamingEvidenceFailure,
  tryRequireStreamingEvidence,
} from "./streaming-evidence.js";
import {
  assertHarnessNavigationUrl,
  captureTargetPostflight,
  failedTargetEvidence,
  formatTargetVerificationEvidence,
  gameplayInputHarnessRuntimeUrl,
  type HarnessTargetVerificationEvidence,
  harnessRuntimeUrl,
  parseHarnessTargetArguments,
  reconcileTargetPostflight,
  startHarnessTarget,
} from "./target.js";
import { readTelemetry } from "./telemetry.js";
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
import { selectV8ScriptManifestArtifacts } from "./v8-script-artifacts.js";
import { errorMessage } from "./value-utils.js";
import {
  requireWasmThreadSpikeCompleteAtMeasurementBoundary,
  type WasmThreadSpikeMetric,
} from "./wasm-thread-spike.js";

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

type P95VarianceSummary =
  | Readonly<{
      readonly profile: "fresh" | "warm";
      readonly reason: string;
      readonly relativeP95Range: number | null;
      readonly state: "invalid";
    }>
  | Readonly<{
      readonly profile: "fresh" | "warm";
      readonly relativeP95Range: number;
      readonly state: "measured";
    }>;

type P95RepeatabilitySummary =
  | Readonly<{
      readonly absoluteP95RangeMs: number | null;
      readonly allowedAbsoluteP95RangeMs: number | null;
      readonly profile: "fresh" | "warm";
      readonly reason: string;
      readonly relativeP95Range: number | null;
      readonly state: "invalid";
    }>
  | Readonly<{
      readonly absoluteP95RangeMs: number;
      readonly allowedAbsoluteP95RangeMs: number;
      readonly profile: "fresh" | "warm";
      readonly relativeP95Range: number | null;
      readonly state: "measured";
    }>;

interface CoreRunFailure {
  readonly launchOrdinal: number;
  readonly message: string;
  readonly profile: "fresh" | "warm";
  readonly repeat: number;
  readonly streamingEvidence: StreamingEvidenceFailure | null;
  readonly v8CodeCacheDiagnosticsSkipped: string;
}

class SmokeStreamingEvidenceError extends Error {
  constructor(readonly failure: StreamingEvidenceFailure) {
    super(failure.reason);
    this.name = "SmokeStreamingEvidenceError";
  }
}

interface LaunchSequencePosition {
  readonly launchOrdinal: number;
  readonly launchStartedAfterSequenceMs: number;
}

interface RunMeasurement {
  readonly budgetChecks: readonly BudgetCheck[];
  readonly browserDisplayAfter: BrowserDisplayIdentity;
  readonly browserDisplayBefore: BrowserDisplayIdentity;
  readonly cpuFrameMs: MeasuredMetric<Distribution>;
  readonly dawnPipeline: MetricResult<DawnPipelineEvidence>;
  readonly gpuMemory: GpuMemoryMetric;
  readonly greyboxWorld: MeasuredMetric<GreyboxWorldEvidence>;
  readonly http:
    | MeasuredMetric<LocalServerMetrics>
    | Readonly<{
        readonly reason: string;
        readonly state: "not-applicable";
      }>;
  readonly jsHeap: JsHeapMetric;
  readonly hybridUi: MeasuredMetric<HybridUiTelemetrySnapshot>;
  readonly launchOrdinal: number;
  readonly launchStartedAfterSequenceMs: number;
  readonly mainThreadLongTasksOver50Ms: MeasuredMetric<number>;
  readonly workerAnimationCallbackIntervalMs: MeasuredMetric<Distribution>;
  readonly profile: "fresh" | "warm";
  readonly psoWarmup: MetricResult<PsoWarmupTelemetrySnapshot>;
  readonly profileLineage: {
    readonly history: readonly ("fresh" | "warm")[];
    readonly id: string;
  };
  readonly repeat: number;
  readonly renderSurfaceAfter: Readonly<{ height: number; width: number }>;
  readonly renderSurfaceBefore: Readonly<{ height: number; width: number }>;
  readonly renderSurfaceChanges: readonly Readonly<{ height: number; width: number }>[];
  readonly sabRingBuffer: SabRingBufferMetric;
  readonly simulationController: MeasuredMetric<SimulationGameplayEvidence>;
  readonly streaming: MeasuredMetric<StreamingEvidence>;
  readonly wasmThreads: WasmThreadSpikeMetric;
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
  readonly completionDeadlineExceeded: boolean | null;
  readonly completionObservationTimeoutMs: number;
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

interface RenderBuildEvidence {
  readonly engineAndRenderWorkerBytes: number;
  readonly engineArtifact: Readonly<{ bytes: number; path: string }>;
  readonly renderWorkerArtifact: Readonly<{ bytes: number; path: string }>;
  readonly totalBuildBytes: number;
}

export interface SmokeReport {
  readonly artifactDigest: string;
  readonly baseline: BaselineEvaluation;
  readonly build: RenderBuildEvidence;
  readonly chromePin: ChromePin;
  readonly coreRunFailure: CoreRunFailure | null;
  readonly environment: EnvironmentIdentity;
  readonly facets: ResultFacets;
  readonly finalizationFailure: string | null;
  readonly generatedAt: string;
  readonly harnessRuntime: HarnessRuntimeIdentity;
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
  readonly postRunIdentity: FinalizationEvidence;
  readonly reportPersistence: FinalizationEvidence;
  readonly releaseDigest: string;
  readonly vizPresentationFeedbackCallbackVariance: readonly {
    readonly profile: "fresh" | "warm";
    readonly reason?: string;
    readonly relativeP95Range: number | null;
    readonly state: "invalid" | "measured";
  }[];
  readonly runs: readonly RunMeasurement[];
  readonly scenario: typeof SMOKE_SCENARIO;
  readonly schemaVersion: typeof SMOKE_REPORT_SCHEMA_VERSION;
  readonly source: SourceIdentity;
  readonly callbackPacingVariance: readonly P95VarianceSummary[];
  readonly streamingCellLoadP95Variance: readonly P95RepeatabilitySummary[];
  readonly v8CodeCacheDiagnostics: readonly V8CodeCacheDiagnosticRun[];
  readonly v8CodeCacheDiagnosticsRequested: boolean;
}

export type SmokeEvidenceReport = Omit<SmokeReport, "baseline">;

export interface SmokeCommandConfiguration<TContext, TReport extends { readonly passed: boolean }> {
  readonly arguments: readonly string[];
  readonly beforeMeasurements?: (environment: EnvironmentIdentity) => Promise<void>;
  readonly chromePin: ChromePin;
  readonly executablePath: string;
  readonly formatMarkdown: (report: TReport) => string;
  readonly inspectValidation?: RegisteredBrowserValidation;
  readonly prepareReportContext: () => Promise<TContext>;
  readonly persistenceDependencies?: ReportPersistenceDependencies;
  readonly reportPaths: (input: {
    readonly artifactDigest: string;
    readonly environment: EnvironmentIdentity;
    readonly generatedAt: string;
  }) => Readonly<{ readonly json: string; readonly markdown: string }>;
  readonly toReport: (evidence: SmokeEvidenceReport, context: TContext) => TReport;
  readonly resultLabel: string;
  readonly summaryLabel: string;
}

interface HarnessRuntimeIdentity {
  readonly nodeExecutableSha256: string;
  readonly nodeVersion: string;
}

interface HeapWorkerTopologySource {
  readonly baseUrl: string;
  readonly manifest: BuildManifest;
}

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const buildRoot = join(repositoryRoot, "dist");
const machineRoot = join(repositoryRoot, "harness/machines");
const outputRoot = join(repositoryRoot, "harness/results");
const M3_EXIT_POSITIONING_TICKS = 4_497;
const M3_EXIT_POSITIONING_YAW_RADIANS = 1.456;
const M3_EXIT_INTERACTION_RANGE_METERS = 5;
const M3_EXIT_NPC_ENTITY_ID = 1_000;
const M3_EXIT_NPC_NAME = "Mara Venn";
const M3_EXIT_PLAYER_QUESTION = "Is the road safe?";
const M3_EXIT_RETRIEVED_FALLBACK =
  "The east road leaves the village through the east gate and follows the marked landward path.";

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

async function main(): Promise<void> {
  const targetOptions = parseHarnessTargetArguments(process.argv.slice(2));
  parseSmokeRunOptions(targetOptions.remainingArguments);
  requiredEnvironment("PARALLAX_MACHINE_ID");
  parseQualityTier(process.env.PARALLAX_TIER);
  const chromePin = await loadSmokeChromePin(repositoryRoot);
  const executablePath = await resolveChromeExecutablePath(repositoryRoot, chromePin);
  await runSmokeCommand({
    arguments: process.argv.slice(2),
    chromePin,
    executablePath,
    formatMarkdown: formatReport,
    prepareReportContext: () => loadBaselineStore(baselineStorePath(repositoryRoot)),
    reportPaths: ({ artifactDigest, environment, generatedAt }) =>
      reportPaths({
        artifactDigest,
        generatedAt,
        machineId: environment.machineId,
        scenario: SMOKE_SCENARIO,
        tier: environment.requestedTier,
      }),
    resultLabel: "Smoke result",
    summaryLabel: "Smoke summary",
    toReport: (evidence, baselineStore) =>
      Object.freeze({
        ...evidence,
        baseline: evaluateBaselineSafely(evidence, baselineStore),
      }),
  });
}

export async function runSmokeCommand<TContext, TReport extends { readonly passed: boolean }>(
  configuration: SmokeCommandConfiguration<TContext, TReport>,
): Promise<TReport> {
  const targetOptions = parseHarnessTargetArguments(configuration.arguments);
  const options = parseSmokeRunOptions(targetOptions.remainingArguments);
  const machineId = requiredEnvironment("PARALLAX_MACHINE_ID");
  const tier = parseQualityTier(process.env.PARALLAX_TIER);
  const chromePin = configuration.chromePin;
  const executablePath = configuration.executablePath;
  const browserLaunchMode: ChromeLaunchMode =
    configuration.inspectValidation === undefined ? "pinned-executable" : "branded-stable-channel";
  const validatedBuild = await readAndValidateBuildManifest(buildRoot);
  const artifactDigest = validatedBuild.artifactDigest;
  const build = renderBuildEvidence(validatedBuild.manifest);
  const v8ScriptArtifacts = options.includeV8CodeCache
    ? await readV8ScriptArtifacts(validatedBuild.manifest)
    : Object.freeze([]);
  const heapWorkerManifest = await tryProbe("Build-manifest heap worker entrypoints", async () => {
    resolveHeapWorkerTargetUrls({
      baseUrl: "https://heap-topology.invalid/",
      decodeWorkerCount: 1,
      manifest: validatedBuild.manifest,
    });
    return validatedBuild.manifest;
  });
  const source = await readSourceIdentity(repositoryRoot);
  const harnessRuntime = Object.freeze({
    nodeExecutableSha256: (await sha256File(process.execPath)).sha256,
    nodeVersion: process.version,
  });
  const reportContext = await configuration.prepareReportContext();
  const target = await startHarnessTarget({
    artifactDigest,
    buildManifest: validatedBuild.manifest,
    buildRoot,
    request: targetOptions.request,
  });
  const baseUrl = target.baseUrl;
  const heapWorkerTopology: ProbeResult<HeapWorkerTopologySource> =
    heapWorkerManifest.state === "measured"
      ? measured(
          Object.freeze({
            baseUrl,
            manifest: heapWorkerManifest.value,
          }),
        )
      : heapWorkerManifest;
  const profileRoot = await mkdtemp(join(tmpdir(), "parallax-harness-"));

  try {
    let environment = await inspectRegisteredEnvironment({
      chromePin,
      executablePath,
      machineId,
      machineRoot,
      probeUrl: target.probeUrl,
      profilePath: join(profileRoot, "identity"),
      target: target.identity,
      tier,
      ...(configuration.inspectValidation === undefined
        ? {}
        : { validation: configuration.inspectValidation }),
    });
    await configuration.beforeMeasurements?.(environment);
    const measurementSequenceStartedAtMs = performance.now();
    let launchOrdinal = 0;
    const runs: RunMeasurement[] = [];
    // A core-run failure must still produce a result artifact: capture the failure,
    // stop launching further core runs, skip the V8 diagnostic phase, and let the
    // mandatory core-run-completion evidence check fail the run.
    let coreRunFailure: CoreRunFailure | null = null;
    for (let repeat = 1; repeat <= SMOKE_REPEATS && coreRunFailure === null; repeat += 1) {
      const lineage = join(profileRoot, `lineage-${repeat}`);
      for (const profile of ["fresh", "warm"] as const) {
        const launchPosition = launchSequencePosition(
          ++launchOrdinal,
          measurementSequenceStartedAtMs,
        );
        try {
          runs.push(
            await measureRun(
              executablePath,
              lineage,
              baseUrl,
              repeat,
              profile,
              environment.adapter?.backend ?? null,
              tier,
              heapWorkerTopology,
              launchPosition,
              target.localServerMetricsAvailable,
              browserLaunchMode,
            ),
          );
        } catch (error) {
          coreRunFailure = Object.freeze({
            launchOrdinal: launchPosition.launchOrdinal,
            message: errorMessage(error),
            profile,
            repeat,
            streamingEvidence: error instanceof SmokeStreamingEvidenceError ? error.failure : null,
            v8CodeCacheDiagnosticsSkipped: options.includeV8CodeCache
              ? `core ${profile} repeat ${repeat} failed, so the V8 code-cache diagnostic phase was not launched`
              : "V8 code-cache diagnostics were not requested",
          });
          break;
        }
      }
    }
    const v8CodeCacheDiagnostics: V8CodeCacheDiagnosticRun[] = [];
    const v8DiagnosticRepeats =
      coreRunFailure === null && options.includeV8CodeCache
        ? SMOKE_V8_CODE_CACHE_DIAGNOSTIC_REPEATS
        : 0;
    for (let repeat = 1; repeat <= v8DiagnosticRepeats; repeat += 1) {
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
                browserLaunchMode,
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
    // Variance is evaluated against the full SMOKE_REPEATS contract: fewer completed
    // repeats (including zero) yields an invalid variance metric, never "measured".
    const callbackPacingVariance = (["fresh", "warm"] as const).map((profile) =>
      summarizeP95Variance(
        profile,
        evaluateP95Variance(
          runs
            .filter((run) => run.profile === profile)
            .map((run) => run.workerAnimationCallbackIntervalMs.value.p95),
          SMOKE_REPEATS,
        ),
      ),
    );
    const streamingCellLoadP95Variance = (["fresh", "warm"] as const).map((profile) =>
      summarizeP95Repeatability(
        profile,
        evaluateBoundedRepeatability(
          runs
            .filter((run) => run.profile === profile)
            .map((run) => run.streaming.value.cellLoadP95Ms),
          SMOKE_REPEATS,
          "streaming cell-load p95",
          SMOKE_STREAMING_P95_RELATIVE_RANGE_LIMIT,
          SMOKE_STREAMING_P95_ABSOLUTE_RANGE_FLOOR_MS,
        ),
      ),
    );
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
        SMOKE_REPEATS,
      );
      return summarizeP95Variance(profile, variance);
    });
    environment = revalidateRunDisplays(environment, runs);
    environment = revalidateHostEnvironment(environment, await tryReadWindowsHostIdentity());
    if (configuration.inspectValidation !== undefined) {
      try {
        const postRunExecutableSha256 = (await sha256File(executablePath)).sha256;
        if (postRunExecutableSha256 !== configuration.inspectValidation.executableSha256) {
          environment = invalidateEnvironment(environment, [
            `Branded Chrome executable changed during the run: expected ${configuration.inspectValidation.executableSha256}, received ${postRunExecutableSha256}`,
          ]);
        }
      } catch (error) {
        environment = invalidateEnvironment(environment, [
          `Branded Chrome executable postvalidation failed: ${errorMessage(error)}`,
        ]);
      }
    }
    const targetPostflight = reconcileTargetPostflight(
      environment.target,
      await captureTargetPostflight(target.revalidate),
    );
    if (targetPostflight.state === "verified") {
      environment = recordTargetPostflightSuccess(environment, targetPostflight);
    } else {
      environment = recordTargetPostflightFailure(
        environment,
        `Serving target postflight failed: ${targetPostflight.reason}`,
      );
    }
    const incompleteMetrics = Object.freeze(SMOKE_INCOMPLETE_METRICS.map(invalidMetric));
    const postRunIdentity = await evaluatePostRunIdentity(artifactDigest, source, {
      readArtifactDigest: async () =>
        (await readAndValidateBuildManifest(buildRoot)).artifactDigest,
      readSourceIdentity: () => readSourceIdentity(repositoryRoot),
    });
    const generatedAt = new Date().toISOString();
    const assembleReport = (reportPersistence: FinalizationEvidence): TReport => {
      const finalizationFailure = finalizationFailureReason(postRunIdentity, reportPersistence);
      const reportFinalization =
        finalizationFailure === null
          ? measuredFinalizationEvidence()
          : invalidFinalizationEvidence(finalizationFailure);
      const evidenceChecks = collectSmokeEvidenceChecks({
        callbackPacingVariance,
        coreRunCompletion: {
          completedRuns: runs.length,
          expectedRuns: SMOKE_REPEATS * 2,
          failure:
            coreRunFailure === null
              ? null
              : `core ${coreRunFailure.profile} repeat ${coreRunFailure.repeat} failed: ${coreRunFailure.message}`,
        },
        incompleteMetrics,
        reportFinalization,
        runs,
        streamingCellLoadP95Variance,
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
      const reportWithoutBaseline = {
        artifactDigest,
        build,
        callbackPacingVariance,
        chromePin,
        coreRunFailure,
        environment,
        facets,
        finalizationFailure,
        generatedAt,
        harnessRuntime,
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
        passed: resultFacetsPassed(facets),
        postRunIdentity,
        reportPersistence,
        releaseDigest: validatedBuild.releaseDigest,
        runs,
        scenario: SMOKE_SCENARIO,
        schemaVersion: SMOKE_REPORT_SCHEMA_VERSION,
        source,
        streamingCellLoadP95Variance,
        v8CodeCacheDiagnostics,
        v8CodeCacheDiagnosticsRequested: options.includeV8CodeCache,
        vizPresentationFeedbackCallbackVariance,
      } satisfies SmokeEvidenceReport;
      return configuration.toReport(reportWithoutBaseline, reportContext);
    };
    await mkdir(outputRoot, { recursive: true });
    const paths = configuration.reportPaths({
      artifactDigest,
      generatedAt,
      environment,
    });
    const persistence = await persistJsonPrimaryReport({
      ...(configuration.persistenceDependencies === undefined
        ? {}
        : { dependencies: configuration.persistenceDependencies }),
      failedReport: (reason) => assembleReport(invalidFinalizationEvidence(reason)),
      formatMarkdown: configuration.formatMarkdown,
      jsonPath: paths.json,
      markdownPath: paths.markdown,
      pendingReport: assembleReport(
        invalidFinalizationEvidence("Human-readable report persistence has not completed"),
      ),
      successfulReport: assembleReport(measuredFinalizationEvidence()),
    });
    if (persistence.markdown !== null) console.log(persistence.markdown);
    if (persistence.secondaryFailure !== null) console.error(persistence.secondaryFailure);
    console.log(`${configuration.resultLabel}: ${paths.json}`);
    if (persistence.markdown !== null)
      console.log(`${configuration.summaryLabel}: ${paths.markdown}`);
    process.exitCode = persistence.finalReport.passed ? 0 : 1;
    return persistence.finalReport;
  } finally {
    await rm(profileRoot, { force: true, recursive: true });
    await target.stop();
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
  manifest: BuildManifest,
): Promise<readonly V8ScriptArtifact[]> {
  return Object.freeze(
    await Promise.all(
      selectV8ScriptManifestArtifacts(manifest).map(async (artifact) =>
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

function renderBuildEvidence(manifest: BuildManifest): RenderBuildEvidence {
  const renderWorkerPath = renderWorkerArtifactPath(manifest);
  const renderWorkerArtifact = manifest.artifacts.find(
    (artifact) => artifact.path === renderWorkerPath,
  );
  const engineArtifacts = manifest.artifacts.filter((artifact) =>
    /^immutable\/engine-[a-f0-9]{64}\.js$/.test(artifact.path),
  );
  if (renderWorkerArtifact === undefined || engineArtifacts.length !== 1) {
    throw new Error(
      `Expected one engine and one render-worker artifact; received ${engineArtifacts.length} engine and ${renderWorkerArtifact === undefined ? 0 : 1} render-worker artifacts`,
    );
  }
  const engineArtifact = engineArtifacts[0];
  if (engineArtifact === undefined) throw new Error("Engine artifact disappeared");
  return Object.freeze({
    engineAndRenderWorkerBytes: engineArtifact.bytes + renderWorkerArtifact.bytes,
    engineArtifact: Object.freeze({ bytes: engineArtifact.bytes, path: engineArtifact.path }),
    renderWorkerArtifact: Object.freeze({
      bytes: renderWorkerArtifact.bytes,
      path: renderWorkerArtifact.path,
    }),
    totalBuildBytes: manifest.artifacts.reduce((total, artifact) => total + artifact.bytes, 0),
  });
}

function renderWorkerArtifactPath(manifest: BuildManifest): string {
  return workerArtifactPath(manifest, "render");
}

function workerArtifactPath(
  manifest: BuildManifest,
  role: "decode" | "render" | "streaming",
): string {
  const matches = manifest.workerEntrypoints.filter(
    (entrypoint) => entrypoint.role === role && entrypoint.targetType === "worker",
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one declared ${role}-worker entrypoint; received ${matches.length}`);
  }
  const entrypoint = matches[0];
  if (entrypoint === undefined) throw new Error(`${role}-worker entrypoint disappeared`);
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

function summarizeP95Repeatability(
  profile: "fresh" | "warm",
  repeatability: BoundedRepeatabilityMetric,
): P95RepeatabilitySummary {
  return repeatability.state === "invalid"
    ? Object.freeze({
        absoluteP95RangeMs: repeatability.absoluteRange,
        allowedAbsoluteP95RangeMs: repeatability.allowedAbsoluteRange,
        profile,
        reason: repeatability.reason,
        relativeP95Range: repeatability.relativeRange,
        state: repeatability.state,
      })
    : Object.freeze({
        absoluteP95RangeMs: repeatability.absoluteRange,
        allowedAbsoluteP95RangeMs: repeatability.allowedAbsoluteRange,
        profile,
        relativeP95Range: repeatability.relativeRange,
        state: repeatability.state,
      });
}

async function measureRun(
  executablePath: string,
  profilePath: string,
  baseUrl: string,
  repeat: number,
  profile: "fresh" | "warm",
  dawnBackend: string | null,
  tier: QualityTier,
  heapWorkerTopology: ProbeResult<HeapWorkerTopologySource>,
  launchPosition: LaunchSequencePosition,
  localServerMetricsAvailable: boolean,
  browserLaunchMode: ChromeLaunchMode,
): Promise<RunMeasurement> {
  // Server-metric window: snapshot immediately before browser launch and again only
  // after the browser context is fully closed, so late requests from this browser
  // instance cannot bleed into the next run's delta.
  const before = localServerMetricsAvailable ? await fetchServerMetrics(baseUrl) : null;
  const measurement = await measureRunWithBrowser(
    executablePath,
    profilePath,
    baseUrl,
    repeat,
    profile,
    dawnBackend,
    tier,
    heapWorkerTopology,
    launchPosition,
    browserLaunchMode,
  );
  const after = localServerMetricsAvailable ? await fetchServerMetrics(baseUrl) : null;
  return Object.freeze({
    ...measurement,
    http:
      before === null || after === null
        ? Object.freeze({
            reason:
              "Production nginx exposes no harness-only request-counter endpoint; target serving headers and conditional responses are verified separately in environment identity",
            state: "not-applicable" as const,
          })
        : measured(subtractServerMetrics(after, before)),
  });
}

async function measureRunWithBrowser(
  executablePath: string,
  profilePath: string,
  baseUrl: string,
  repeat: number,
  profile: "fresh" | "warm",
  dawnBackend: string | null,
  tier: QualityTier,
  heapWorkerTopology: ProbeResult<HeapWorkerTopologySource>,
  launchPosition: LaunchSequencePosition,
  browserLaunchMode: ChromeLaunchMode,
): Promise<Omit<RunMeasurement, "http">> {
  const context = await launchAfterPhysicalConsoleDisplayWake(() =>
    launchPersistentChrome(executablePath, profilePath, [], browserLaunchMode),
  );
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
    const runtimeUrl = gameplayInputHarnessRuntimeUrl(baseUrl);
    await page.goto(runtimeUrl, { waitUntil: "load" });
    assertHarnessNavigationUrl(page.url(), runtimeUrl, `smoke ${profile} repeat ${repeat}`);
    await page.waitForFunction(
      telemetryReady,
      {
        expectedSchemaVersion: SMOKE_TELEMETRY_SCHEMA_VERSION,
        globalName: SMOKE_TELEMETRY_GLOBAL_NAME,
        hybridUiSchemaVersion: SMOKE_HYBRID_UI_TELEMETRY_SCHEMA_VERSION,
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
    await page.waitForFunction(
      (globalName) => {
        const telemetry = Reflect.get(globalThis, globalName) as ParallaxTelemetryExport;
        return telemetry.snapshot().render.sabRingBufferSpike.state === "completed";
      },
      SMOKE_TELEMETRY_GLOBAL_NAME,
      { timeout: 15_000 },
    );
    const sabRingBuffer = requireSabRingBufferCompleteAtMeasurementBoundary(
      (await readTelemetry(page)).render.sabRingBufferSpike,
    );
    await page.waitForFunction(
      (globalName) => {
        const telemetry = Reflect.get(globalThis, globalName) as ParallaxTelemetryExport;
        const state = telemetry.snapshot().wasmThreadSpike.state;
        return state === "completed" || state === "failed";
      },
      SMOKE_TELEMETRY_GLOBAL_NAME,
      { timeout: SMOKE_WASM_THREAD_COMPLETION_TIMEOUT_MS },
    );
    const wasmThreads = requireWasmThreadSpikeCompleteAtMeasurementBoundary(
      (await readTelemetry(page)).wasmThreadSpike,
    );
    await page.waitForFunction(
      (globalName) => {
        const telemetry = Reflect.get(globalThis, globalName) as ParallaxTelemetryExport;
        const state = telemetry.snapshot().streaming.state;
        return state === "streaming" || state === "failed";
      },
      SMOKE_TELEMETRY_GLOBAL_NAME,
      { timeout: 15_000 },
    );
    if ((await readTelemetry(page)).streaming.state !== "streaming") {
      throw new Error("World streaming failed before the measurement boundary");
    }
    const simulationController = await verifySimulationFoundation(page);
    const warmupStartedAt = performance.now();
    await page.evaluate((globalName) => {
      const telemetry = Reflect.get(globalThis, globalName) as ParallaxTelemetryExport;
      telemetry.startStreamingTraversal();
    }, SMOKE_TELEMETRY_GLOBAL_NAME);
    const remainingWarmupMs = SMOKE_WARMUP_MS - (performance.now() - warmupStartedAt);
    if (remainingWarmupMs > 0) await page.waitForTimeout(remainingWarmupMs);
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
    await markPresentationBoundary("start");
    const start = await readTelemetry(page);
    // Guard-band invariant: telemetry frameCount publishes once per
    // TELEMETRY_FRAME_BATCH_FRAMES rendered frames, so the observed count trails the
    // true rendered count by up to one batch minus one frame. Because the start marker
    // was placed *before* this read, the true rendered count at the marker is at most
    // start.render.frameCount + TELEMETRY_FRAME_BATCH_FRAMES - 1, so every frame in the
    // selected window (indexes > windowStart) provably rendered after the marker.
    const windowStart = markerAlignedWindowStart(
      start.render.frameCount,
      TELEMETRY_FRAME_BATCH_FRAMES,
    );
    await page.waitForFunction(
      (target) => {
        const telemetry = Reflect.get(globalThis, target.globalName) as ParallaxTelemetryExport;
        return telemetry.snapshot().render.frameCount >= target.frameCount;
      },
      {
        frameCount: windowStart + SMOKE_MEASUREMENT_FRAMES,
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
    const greyboxTelemetry = snapshot.render.greyboxWorld;
    if (greyboxTelemetry === null) {
      throw new Error("Ready render telemetry omitted the greybox world");
    }
    const frames = selectMeasurementFrameWindow({
      measurementFrames: SMOKE_MEASUREMENT_FRAMES,
      recentFrames: snapshot.render.recentFrames,
      snapshotFrameCount: snapshot.render.frameCount,
      startFrameCount: windowStart,
    });
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
    // Errors raised between the in-window error check and here (trace tail/end, memory
    // dump, histogram probes) still fail the run (a browser error is never
    // non-blocking; D-031). Throwing routes through the coreRunFailure wrapper, so the
    // result artifact is still written and the exit code is 1.
    if (errors.length > 0) {
      throw new Error(`Browser errors after the measurement window: ${errors.join(" | ")}`);
    }
    const renderedOutput = await analyzeGreyboxRenderedOutput(
      await page.locator("#render-canvas").screenshot({ type: "png" }),
      greyboxTelemetry.clearColor,
    );
    const browserErrorsBeforeJsHeap = errors.length;
    let jsHeap: JsHeapMetric =
      heapWorkerTopology.state === "measured"
        ? await measureJsHeapMetric(context, page, heapWorkerTopology.value)
        : Object.freeze({
            evidence: null,
            reason: heapWorkerTopology.reason,
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
    const streamingResult = tryRequireStreamingEvidence(snapshot.streaming, start.streaming);
    if (streamingResult.state === "invalid") {
      throw new SmokeStreamingEvidenceError(streamingResult.failure);
    }
    const streaming = streamingResult.value;
    const psoWarmup = resolvePsoWarmupEvidence(snapshot.render);
    return Object.freeze({
      budgetChecks: Object.freeze([
        ...(jsHeap.state === "measured"
          ? evaluateJsHeapBudget(jsHeap.value.highWaterUsedSizeBytes, tier)
          : []),
        ...evaluateMainThreadBudgets(mainThreadLongTasks),
        ...pipelineBudgetChecks,
        ...evaluateSimulationGameplayBudget(simulationController.stepDurationHighWaterMs),
        ...evaluateStreamingBudgets(streaming.cellLoadP95Ms),
      ]),
      browserDisplayAfter,
      browserDisplayBefore,
      cpuFrameMs: measured(distribution(frames.map((frame) => frame.durationMs))),
      dawnPipeline,
      gpuMemory,
      greyboxWorld: measured(requireGreyboxWorld(greyboxTelemetry, frames, renderedOutput)),
      hybridUi: measured(requireHybridUiEvidence(snapshot.hybridUi)),
      jsHeap,
      launchOrdinal: launchPosition.launchOrdinal,
      launchStartedAfterSequenceMs: launchPosition.launchStartedAfterSequenceMs,
      mainThreadLongTasksOver50Ms: measured(mainThreadLongTasks),
      profile,
      psoWarmup,
      profileLineage: Object.freeze({
        history: profile === "fresh" ? (["fresh"] as const) : (["fresh", "warm"] as const),
        id: `lineage-${repeat}`,
      }),
      repeat,
      renderSurfaceAfter: endSurfaceState.latest,
      renderSurfaceBefore,
      renderSurfaceChanges: endSurfaceState.changes,
      sabRingBuffer,
      simulationController: measured(simulationController),
      streaming: measured(streaming),
      wasmThreads,
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
  heapWorkerTopology: HeapWorkerTopologySource,
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
    const topology = await readTelemetry(page);
    sampler = await prepareJsHeapSampler(
      browserSession,
      pageSession,
      page.url(),
      resolveHeapWorkerTargetUrls({
        baseUrl: heapWorkerTopology.baseUrl,
        decodeWorkerCount: topology.streaming.decodeWorkerCount,
        manifest: heapWorkerTopology.manifest,
      }),
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
  heapWorkerTopology: HeapWorkerTopologySource,
): Promise<JsHeapMetric> {
  try {
    return measured(await measureJsHeapSteadyStateWindow(context, page, heapWorkerTopology));
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
  browserLaunchMode: ChromeLaunchMode,
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
      browserLaunchMode,
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
  browserLaunchMode: ChromeLaunchMode,
): Promise<V8CodeCacheDiagnosticRun> {
  const context = await launchAfterPhysicalConsoleDisplayWake(() =>
    launchPersistentChrome(executablePath, profilePath, [], browserLaunchMode),
  );
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
    const runtimeUrl = harnessRuntimeUrl(baseUrl);
    await page.goto(runtimeUrl, { waitUntil: "load" });
    assertHarnessNavigationUrl(
      page.url(),
      runtimeUrl,
      `smoke V8 code-cache ${profile} repeat ${repeat}`,
    );
    await page.waitForFunction(
      telemetryReady,
      {
        expectedSchemaVersion: SMOKE_TELEMETRY_SCHEMA_VERSION,
        globalName: SMOKE_TELEMETRY_GLOBAL_NAME,
        hybridUiSchemaVersion: SMOKE_HYBRID_UI_TELEMETRY_SCHEMA_VERSION,
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
  let completionDeadlineExceeded: boolean | null = null;
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
        const observation = await observeThroughLateCompletionWindow(
          (async () => {
            await session.send("Tracing.end");
            endCommandCompletedAtMs = performance.now();
            return completed;
          })(),
          SMOKE_PRESENTATION_TRACE_COMPLETION_TIMEOUT_MS,
          SMOKE_PRESENTATION_TRACE_LATE_OBSERVATION_MS,
          "Smoke trace end/completion",
        );
        completionDeadlineExceeded = observation.exceededDeadline;
        if (observation.exceededDeadline) {
          throw new Error(
            `Smoke trace end/completion exceeded the ${SMOKE_PRESENTATION_TRACE_COMPLETION_TIMEOUT_MS} ms validity deadline but completed after ${formatMilliseconds(observation.elapsedMs)}`,
          );
        }
        return observation.value;
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
      completionDeadlineExceeded,
      completionObservationTimeoutMs:
        SMOKE_PRESENTATION_TRACE_COMPLETION_TIMEOUT_MS +
        SMOKE_PRESENTATION_TRACE_LATE_OBSERVATION_MS,
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

function recordTargetPostflightSuccess(
  environment: EnvironmentIdentity,
  targetPostflight: Extract<HarnessTargetVerificationEvidence, { state: "verified" }>,
): EnvironmentIdentity {
  return Object.freeze({
    ...environment,
    targetPostflight,
  });
}

function recordTargetPostflightFailure(
  environment: EnvironmentIdentity,
  reason: string,
): EnvironmentIdentity {
  return invalidateTargetEnvironment(
    Object.freeze({ ...environment, targetPostflight: failedTargetEvidence(reason) }),
    reason,
  );
}

function invalidateTargetEnvironment(
  environment: EnvironmentIdentity,
  reason: string,
): EnvironmentIdentity {
  return invalidateEnvironment(environment, [reason]);
}

function jsonEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function telemetryReady(contract: {
  expectedSchemaVersion: number;
  globalName: string;
  hybridUiSchemaVersion: number;
}): boolean {
  const telemetry = Reflect.get(globalThis, contract.globalName) as
    | ParallaxTelemetryExport
    | undefined;
  if (telemetry === undefined) return false;
  const snapshot = telemetry.snapshot();
  if (snapshot.render.state === "failed")
    throw new Error(snapshot.render.failureMessage ?? "Render failed");
  if (snapshot.simulation.state === "failed")
    throw new Error(snapshot.simulation.failureMessage ?? "Simulation failed");
  return (
    snapshot.schemaVersion === contract.expectedSchemaVersion &&
    snapshot.render.state === "ready" &&
    snapshot.hybridUi.state === "ready" &&
    snapshot.hybridUi.schemaVersion === contract.hybridUiSchemaVersion &&
    snapshot.hybridUi.presentationCount > 0 &&
    snapshot.hybridUi.worker.presentationCount > 0 &&
    snapshot.hybridUi.worker.presentationRevision === snapshot.hybridUi.presentationRevision &&
    snapshot.hybridUi.worker.worldAnchorCount > 0 &&
    snapshot.simulation.state === "running" &&
    snapshot.simulation.tick > 0
  );
}

function requireHybridUiEvidence(snapshot: HybridUiTelemetrySnapshot): HybridUiTelemetrySnapshot {
  if (
    snapshot.schemaVersion !== SMOKE_HYBRID_UI_TELEMETRY_SCHEMA_VERSION ||
    snapshot.state !== "ready" ||
    snapshot.presentationRevision === null ||
    snapshot.presentationCount < 1 ||
    snapshot.domNodeCountHighWater < 1 ||
    snapshot.worker.schemaVersion !== SMOKE_HYBRID_UI_TELEMETRY_SCHEMA_VERSION ||
    snapshot.worker.presentationCount < 1 ||
    snapshot.worker.presentationRevision !== snapshot.presentationRevision ||
    snapshot.worker.worldAnchorCount < 1
  ) {
    throw new Error("Hybrid game UI substrate evidence is incomplete");
  }
  return Object.freeze({ ...snapshot, worker: Object.freeze({ ...snapshot.worker }) });
}

async function verifySimulationFoundation(page: Page): Promise<SimulationGameplayEvidence> {
  const evidence = await page.evaluate(async (globalName) => {
    const telemetry = Reflect.get(globalThis, globalName) as ParallaxTelemetryExport;
    const command = (
      sequence: number,
      targetTick: number,
      forward: number,
      right: number,
      yawRadians: number,
    ) => {
      const payload = new Uint8Array(24);
      const view = new DataView(payload.buffer);
      view.setFloat32(0, forward, true);
      view.setFloat32(4, right, true);
      view.setFloat32(8, yawRadians, true);
      view.setUint32(12, 0, true);
      view.setUint32(16, 0, true);
      view.setUint32(20, 0, true);
      return { kind: "player.input-axes@3", payload, sequence, targetTick };
    };
    const commands = [command(0, 2, 1, 0, 0.25), command(1, 8, 0, 1, -0.5)];
    const first = await telemetry.replaySimulation(commands, 120, 8_675_309);
    const second = await telemetry.replaySimulation(commands, 120, 8_675_309);
    const loaded = await telemetry.loadSimulation(first.finalSave);
    const liveSave = await telemetry.saveSimulation();
    const liveLoaded = await telemetry.loadSimulation(liveSave);
    const liveReloaded = await telemetry.loadSimulation(liveSave);
    return {
      adapterInitializationHighWaterMs: Math.max(
        first.adapterInitializationDurationMs,
        second.adapterInitializationDurationMs,
      ),
      bytesMatch:
        first.finalSave.length === second.finalSave.length &&
        first.finalSave.every((value, index) => second.finalSave[index] === value),
      finalStateHash: first.finalStateHash,
      gameCounters: first.gameCounters,
      hashMatch: first.finalStateHash === second.finalStateHash,
      liveSave,
      liveSaveBytes: liveSave.byteLength,
      liveLoadedStateHash: liveLoaded.stateHash,
      liveReloadedStateHash: liveReloaded.stateHash,
      loadedStateHash: loaded.stateHash,
      secondStateHash: second.finalStateHash,
      tick: first.tick,
      stepDurationHighWaterMs: Math.max(
        first.stepDurationHighWaterMs,
        second.stepDurationHighWaterMs,
      ),
    };
  }, SMOKE_TELEMETRY_GLOBAL_NAME);
  if (
    !evidence.hashMatch ||
    !evidence.bytesMatch ||
    evidence.loadedStateHash !== evidence.finalStateHash ||
    evidence.liveLoadedStateHash !== evidence.loadedStateHash ||
    evidence.liveReloadedStateHash !== evidence.liveLoadedStateHash ||
    !/^[a-f0-9]{64}$/.test(evidence.liveLoadedStateHash) ||
    evidence.tick !== 120 ||
    evidence.liveSaveBytes <= 64 ||
    evidence.gameCounters.movementDistanceMeters === undefined ||
    evidence.gameCounters.movementDistanceMeters <= 0 ||
    evidence.gameCounters.navigationNodeCount === undefined ||
    evidence.gameCounters.navigationNodeCount <= 0 ||
    evidence.gameCounters.navigationEdgeCount === undefined ||
    evidence.gameCounters.navigationEdgeCount <= evidence.gameCounters.navigationNodeCount ||
    evidence.gameCounters.navigationExpandedNodeCount === undefined ||
    evidence.gameCounters.navigationExpandedNodeCount <= 0 ||
    evidence.gameCounters.navigationGridBytes === undefined ||
    evidence.gameCounters.navigationGridBytes <= 0 ||
    evidence.gameCounters.navigationPathNodeCount === undefined ||
    evidence.gameCounters.navigationPathNodeCount <=
      SMOKE_SIMULATION_GAMEPLAY_WORKLOAD.navigationPathQueryCount ||
    evidence.gameCounters.navigationPathQueryCount !==
      SMOKE_SIMULATION_GAMEPLAY_WORKLOAD.navigationPathQueryCount ||
    evidence.gameCounters.navigationTileCount !==
      SMOKE_SIMULATION_GAMEPLAY_WORKLOAD.navigationTileCount ||
    evidence.gameCounters.npcAgentCount !== SMOKE_SIMULATION_GAMEPLAY_WORKLOAD.npcAgentCount ||
    evidence.gameCounters.npcMovementDistanceMeters === undefined ||
    evidence.gameCounters.npcMovementDistanceMeters <= 0 ||
    evidence.gameCounters.npcAvoidanceAdjustmentCount === undefined ||
    evidence.gameCounters.npcAvoidanceAdjustmentCount <= 0 ||
    evidence.gameCounters.npcScheduleTransitionCount === undefined ||
    evidence.gameCounters.npcScheduleTransitionCount <= 0 ||
    evidence.gameCounters.npcMovingAgentCount === undefined ||
    evidence.gameCounters.npcMovingAgentCount <= 0 ||
    !Number.isFinite(evidence.adapterInitializationHighWaterMs) ||
    evidence.adapterInitializationHighWaterMs < 0 ||
    !Number.isFinite(evidence.stepDurationHighWaterMs) ||
    evidence.stepDurationHighWaterMs < 0 ||
    !/^[a-f0-9]{64}$/.test(evidence.finalStateHash)
  ) {
    throw new Error(
      `Simulation determinism/save-load verification failed: ${JSON.stringify(evidence)}`,
    );
  }
  const m3Exit = await verifyM3PlayableLoop(page, evidence.liveSave, evidence.liveLoadedStateHash);
  return Object.freeze({
    adapterInitializationHighWaterMs: evidence.adapterInitializationHighWaterMs,
    movementDistanceMeters: evidence.gameCounters.movementDistanceMeters,
    navigationEdgeCount: evidence.gameCounters.navigationEdgeCount,
    navigationExpandedNodeCount: evidence.gameCounters.navigationExpandedNodeCount,
    navigationGridBytes: evidence.gameCounters.navigationGridBytes,
    navigationNodeCount: evidence.gameCounters.navigationNodeCount,
    navigationPathNodeCount: evidence.gameCounters.navigationPathNodeCount,
    navigationPathQueryCount: evidence.gameCounters.navigationPathQueryCount,
    navigationTileCount: evidence.gameCounters.navigationTileCount,
    npcAgentCount: evidence.gameCounters.npcAgentCount,
    npcAvoidanceAdjustmentCount: evidence.gameCounters.npcAvoidanceAdjustmentCount,
    npcMovementDistanceMeters: evidence.gameCounters.npcMovementDistanceMeters,
    npcMovingAgentCount: evidence.gameCounters.npcMovingAgentCount,
    npcScheduleTransitionCount: evidence.gameCounters.npcScheduleTransitionCount,
    replayFinalStateHash: evidence.finalStateHash,
    replayHashMatch: true,
    replayLoadedStateHash: evidence.loadedStateHash,
    replaySecondStateHash: evidence.secondStateHash,
    replayTick: evidence.tick,
    saveLoadHashMatch: true,
    saveLoadReloadedStateHash: evidence.liveReloadedStateHash,
    saveLoadStateHash: evidence.liveLoadedStateHash,
    stepDurationHighWaterMs: evidence.stepDurationHighWaterMs,
    m3Exit,
  });
}

async function verifyM3PlayableLoop(
  page: Page,
  restoreSave: Uint8Array,
  expectedRestoreStateHash: string,
): Promise<M3PlayableLoopEvidence> {
  await page.waitForFunction(
    (globalName) => {
      const telemetry = Reflect.get(globalThis, globalName) as ParallaxTelemetryExport | undefined;
      return telemetry?.snapshot().gameplayInput.state === "running";
    },
    SMOKE_TELEMETRY_GLOBAL_NAME,
    { timeout: 5_000 },
  );
  const positioning = await page.evaluate(
    async ({ globalName, ticks, yawRadians }) => {
      const telemetry = Reflect.get(globalThis, globalName) as ParallaxTelemetryExport;
      const command = (sequence: number, targetTick: number, forward: number, yaw: number) => {
        const payload = new Uint8Array(24);
        const view = new DataView(payload.buffer);
        view.setFloat32(0, forward, true);
        view.setFloat32(4, 0, true);
        view.setFloat32(8, yaw, true);
        view.setUint32(12, 0, true);
        view.setUint32(16, 0, true);
        view.setUint32(20, 0, true);
        return { kind: "player.input-axes@3", payload, sequence, targetTick };
      };
      const replay = await telemetry.replaySimulation(
        [command(0, 1, 1, yawRadians), command(1, ticks, 0, yawRadians)],
        ticks,
        8_675_309,
      );
      const loaded = await telemetry.loadSimulation(replay.finalSave);
      const player = loaded.entities.find(({ id }) => id === 1);
      const npc = loaded.entities.find(({ id }) => id === 1_000);
      if (player === undefined || npc === undefined) {
        throw new Error("M3 exit positioning replay is missing the player or NPC");
      }
      const snapshot = telemetry.snapshot();
      return {
        dialogRequestCountBefore: telemetry.npcDialogSnapshot().requestCount,
        gameplayInteractionPressCountBefore: snapshot.gameplayInput.interactionPressCount,
        installedModelState: snapshot.installedModelSource.state,
        interactionActivationCountBefore:
          snapshot.simulation.gameCounters.interactionActivationCount ?? 0,
        knowledgeEntryCountBefore: telemetry.npcKnowledgeSnapshot().assembledEntryCount,
        knowledgeRequestCountBefore: telemetry.npcKnowledgeSnapshot().requestCount,
        loadedStateHash: loaded.stateHash,
        npcPosition: npc.position,
        playerNpcDistanceMeters: Math.hypot(
          player.position[0] - npc.position[0],
          player.position[2] - npc.position[2],
        ),
        playerPosition: player.position,
        replayStateHash: replay.finalStateHash,
        replayTick: replay.tick,
      };
    },
    {
      globalName: SMOKE_TELEMETRY_GLOBAL_NAME,
      ticks: M3_EXIT_POSITIONING_TICKS,
      yawRadians: M3_EXIT_POSITIONING_YAW_RADIANS,
    },
  );
  if (
    positioning.replayTick !== M3_EXIT_POSITIONING_TICKS ||
    positioning.loadedStateHash !== positioning.replayStateHash ||
    !/^[a-f0-9]{64}$/.test(positioning.replayStateHash) ||
    positioning.installedModelState !== "unavailable" ||
    !Number.isFinite(positioning.playerNpcDistanceMeters) ||
    positioning.playerNpcDistanceMeters > M3_EXIT_INTERACTION_RANGE_METERS
  ) {
    throw new Error(`M3 exit positioning replay failed: ${JSON.stringify(positioning)}`);
  }

  await page.locator("#render-canvas").focus();
  const canvasOwnsInput = await page.evaluate(() => {
    const canvas = document.querySelector("#render-canvas");
    return document.activeElement === canvas || document.pointerLockElement === canvas;
  });
  if (!canvasOwnsInput) throw new Error("M3 exit probe could not activate the gameplay canvas");
  await page.keyboard.press("KeyE");
  try {
    await page.waitForFunction(
      ({ expectedInteraction, expectedPressCount, expectedSpeaker, globalName }) => {
        const telemetry = Reflect.get(globalThis, globalName) as
          | ParallaxTelemetryExport
          | undefined;
        const status = document.querySelector("#status");
        const dialog = document.querySelector(".hybrid-ui-dialog");
        return (
          telemetry?.snapshot().gameplayInput.interactionPressCount === expectedPressCount &&
          status instanceof HTMLElement &&
          status.dataset.lastInteraction === expectedInteraction &&
          dialog instanceof HTMLElement &&
          !dialog.hidden &&
          dialog.querySelector("h2")?.textContent === expectedSpeaker
        );
      },
      {
        expectedInteraction: `npc-${M3_EXIT_NPC_ENTITY_ID}`,
        expectedPressCount: positioning.gameplayInteractionPressCountBefore + 1,
        expectedSpeaker: M3_EXIT_NPC_NAME,
        globalName: SMOKE_TELEMETRY_GLOBAL_NAME,
      },
      { timeout: 5_000 },
    );
  } catch (error: unknown) {
    const diagnostic = await page.evaluate((globalName) => {
      const telemetry = Reflect.get(globalThis, globalName) as ParallaxTelemetryExport | undefined;
      const status = document.querySelector("#status");
      const dialog = document.querySelector(".hybrid-ui-dialog");
      return {
        activeElementId: document.activeElement?.id ?? null,
        dialogHidden: dialog instanceof HTMLElement ? dialog.hidden : null,
        dialogSpeaker: dialog?.querySelector("h2")?.textContent ?? null,
        gameplayInput: telemetry?.snapshot().gameplayInput ?? null,
        lastInteraction:
          status instanceof HTMLElement ? (status.dataset.lastInteraction ?? null) : null,
        simulation: telemetry?.snapshot().simulation ?? null,
      };
    }, SMOKE_TELEMETRY_GLOBAL_NAME);
    throw new Error(
      `M3 gameplay interaction did not open the expected NPC dialog: ${JSON.stringify(diagnostic)}`,
      { cause: error },
    );
  }
  await page.getByLabel(`Speak to ${M3_EXIT_NPC_NAME}`).fill(M3_EXIT_PLAYER_QUESTION);
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await page.waitForFunction(
    ({ expectedFallback, globalName }) => {
      const telemetry = Reflect.get(globalThis, globalName) as ParallaxTelemetryExport | undefined;
      const body = document.querySelector(".hybrid-ui-dialog p");
      return (
        telemetry !== undefined &&
        body?.textContent === expectedFallback &&
        telemetry.npcDialogSnapshot().state === "unavailable"
      );
    },
    { expectedFallback: M3_EXIT_RETRIEVED_FALLBACK, globalName: SMOKE_TELEMETRY_GLOBAL_NAME },
    { timeout: 5_000 },
  );
  const completed = await page.evaluate(
    ({ expectedFallback, globalName, npcEntityId }) => {
      const telemetry = Reflect.get(globalThis, globalName) as ParallaxTelemetryExport;
      const snapshot = telemetry.snapshot();
      const dialog = telemetry.npcDialogSnapshot();
      const knowledge = telemetry.npcKnowledgeSnapshot();
      return {
        dialogRequestCount: dialog.requestCount,
        dialogState: dialog.state,
        interactionActivationCount:
          snapshot.simulation.gameCounters.interactionActivationCount ?? 0,
        gameplayInteractionPressCount: snapshot.gameplayInput.interactionPressCount,
        knowledgeEntryCount: knowledge.assembledEntryCount,
        knowledgeRequestCount: knowledge.requestCount,
        npcEntityId,
        response: document.querySelector(".hybrid-ui-dialog p")?.textContent ?? "",
        responseUsedRetrievedState:
          document.querySelector(".hybrid-ui-dialog p")?.textContent === expectedFallback,
        speaker: document.querySelector(".hybrid-ui-dialog h2")?.textContent ?? "",
      };
    },
    {
      expectedFallback: M3_EXIT_RETRIEVED_FALLBACK,
      globalName: SMOKE_TELEMETRY_GLOBAL_NAME,
      npcEntityId: M3_EXIT_NPC_ENTITY_ID,
    },
  );
  if (
    completed.dialogRequestCount !== positioning.dialogRequestCountBefore + 1 ||
    completed.dialogState !== "unavailable" ||
    completed.interactionActivationCount !== positioning.interactionActivationCountBefore + 1 ||
    completed.gameplayInteractionPressCount !==
      positioning.gameplayInteractionPressCountBefore + 1 ||
    completed.knowledgeEntryCount < 1 ||
    completed.knowledgeEntryCount <= positioning.knowledgeEntryCountBefore ||
    completed.knowledgeRequestCount !== positioning.knowledgeRequestCountBefore + 1 ||
    completed.npcEntityId !== M3_EXIT_NPC_ENTITY_ID ||
    !completed.responseUsedRetrievedState ||
    completed.speaker !== M3_EXIT_NPC_NAME
  ) {
    throw new Error(`M3 playable fallback loop failed: ${JSON.stringify(completed)}`);
  }
  await page.getByRole("button", { name: "End conversation", exact: true }).click();
  await page.waitForFunction(
    (globalName) => {
      const telemetry = Reflect.get(globalThis, globalName) as ParallaxTelemetryExport | undefined;
      const dialog = document.querySelector(".hybrid-ui-dialog");
      return (
        telemetry !== undefined &&
        dialog instanceof HTMLElement &&
        dialog.hidden &&
        !telemetry.snapshot().gameplayInput.uiSuppressed
      );
    },
    SMOKE_TELEMETRY_GLOBAL_NAME,
    { timeout: 5_000 },
  );
  const restoredStateHash = await page.evaluate(
    async ({ globalName, save }) => {
      const telemetry = Reflect.get(globalThis, globalName) as ParallaxTelemetryExport;
      return (await telemetry.loadSimulation(save)).stateHash;
    },
    { globalName: SMOKE_TELEMETRY_GLOBAL_NAME, save: restoreSave },
  );
  if (restoredStateHash !== expectedRestoreStateHash) {
    throw new Error(
      `M3 playable-loop cleanup failed to restore the pre-probe simulation: expected ${expectedRestoreStateHash}, received ${restoredStateHash}`,
    );
  }
  return Object.freeze({
    dialogRequestCountBefore: positioning.dialogRequestCountBefore,
    dialogRequestCount: completed.dialogRequestCount,
    dialogState: completed.dialogState,
    gameplayInteractionPressCountBefore: positioning.gameplayInteractionPressCountBefore,
    gameplayInteractionPressCount: completed.gameplayInteractionPressCount,
    installedModelState: positioning.installedModelState,
    interactionActivationCountBefore: positioning.interactionActivationCountBefore,
    knowledgeEntryCountBefore: positioning.knowledgeEntryCountBefore,
    interactionActivationCount: completed.interactionActivationCount,
    knowledgeEntryCount: completed.knowledgeEntryCount,
    knowledgeRequestCountBefore: positioning.knowledgeRequestCountBefore,
    knowledgeRequestCount: completed.knowledgeRequestCount,
    loadedStateHash: positioning.loadedStateHash,
    npcEntityId: completed.npcEntityId,
    positioningReplayStateHash: positioning.replayStateHash,
    positioningReplayTick: positioning.replayTick,
    playerQuestion: M3_EXIT_PLAYER_QUESTION,
    response: completed.response,
    responseUsedRetrievedState: true,
    speaker: completed.speaker,
  });
}

interface SimulationGameplayEvidence {
  readonly adapterInitializationHighWaterMs: number;
  readonly movementDistanceMeters: number;
  readonly navigationEdgeCount: number;
  readonly navigationExpandedNodeCount: number;
  readonly navigationGridBytes: number;
  readonly navigationNodeCount: number;
  readonly navigationPathNodeCount: number;
  readonly navigationPathQueryCount: number;
  readonly navigationTileCount: number;
  readonly npcAgentCount: number;
  readonly npcAvoidanceAdjustmentCount: number;
  readonly npcMovementDistanceMeters: number;
  readonly npcMovingAgentCount: number;
  readonly npcScheduleTransitionCount: number;
  readonly replayFinalStateHash: string;
  readonly replayHashMatch: true;
  readonly replayLoadedStateHash: string;
  readonly replaySecondStateHash: string;
  readonly replayTick: number;
  readonly saveLoadHashMatch: true;
  readonly saveLoadReloadedStateHash: string;
  readonly saveLoadStateHash: string;
  readonly stepDurationHighWaterMs: number;
  readonly m3Exit: M3PlayableLoopEvidence;
}

interface M3PlayableLoopEvidence {
  readonly dialogRequestCountBefore: number;
  readonly dialogRequestCount: number;
  readonly dialogState: "unavailable";
  readonly gameplayInteractionPressCountBefore: number;
  readonly gameplayInteractionPressCount: number;
  readonly installedModelState: "unavailable";
  readonly interactionActivationCountBefore: number;
  readonly knowledgeEntryCountBefore: number;
  readonly interactionActivationCount: number;
  readonly knowledgeEntryCount: number;
  readonly knowledgeRequestCountBefore: number;
  readonly knowledgeRequestCount: number;
  readonly loadedStateHash: string;
  readonly npcEntityId: number;
  readonly positioningReplayStateHash: string;
  readonly positioningReplayTick: number;
  readonly playerQuestion: string;
  readonly response: string;
  readonly responseUsedRetrievedState: true;
  readonly speaker: string;
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
        count: () => {
          // Drain records the observer callback has not delivered yet. takeRecords
          // removes them from delivery, so fold them into the running total to keep
          // count() idempotent-safe across repeated calls.
          longTasks += observer.takeRecords().filter((entry) => entry.duration > 50).length;
          return longTasks;
        },
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
  return {
    bytesServed: after.bytesServed - before.bytesServed,
    bytesServedByPathClass: {
      document: after.bytesServedByPathClass.document - before.bytesServedByPathClass.document,
      immutable: after.bytesServedByPathClass.immutable - before.bytesServedByPathClass.immutable,
      other: after.bytesServedByPathClass.other - before.bytesServedByPathClass.other,
    },
    metadataCacheHits: after.metadataCacheHits - before.metadataCacheHits,
    metadataCacheMisses: after.metadataCacheMisses - before.metadataCacheMisses,
    pathClasses: {
      document: after.pathClasses.document - before.pathClasses.document,
      immutable: after.pathClasses.immutable - before.pathClasses.immutable,
      other: after.pathClasses.other - before.pathClasses.other,
    },
    requests: after.requests - before.requests,
    schemaVersion: 2,
    statuses: subtractStatusCounts(after.statuses, before.statuses),
    statusesByPathClass: {
      document: subtractStatusCounts(
        after.statusesByPathClass.document,
        before.statusesByPathClass.document,
      ),
      immutable: subtractStatusCounts(
        after.statusesByPathClass.immutable,
        before.statusesByPathClass.immutable,
      ),
      other: subtractStatusCounts(
        after.statusesByPathClass.other,
        before.statusesByPathClass.other,
      ),
    },
  };
}

function subtractStatusCounts(
  after: Readonly<Record<string, number>>,
  before: Readonly<Record<string, number>>,
): Record<string, number> {
  const statuses: Record<string, number> = {};
  for (const [status, count] of Object.entries(after)) {
    statuses[status] = count - (before[status] ?? 0);
  }
  return statuses;
}

function reportPaths(input: {
  readonly artifactDigest: string;
  readonly generatedAt: string;
  readonly machineId: string;
  readonly scenario: string;
  readonly tier: QualityTier;
}): Readonly<{ readonly json: string; readonly markdown: string }> {
  const timestamp = input.generatedAt.replaceAll(/[:.]/g, "-");
  const stem = [
    input.scenario.replace("@", "-"),
    input.artifactDigest.slice(0, 12),
    safeMachineIdForFilename(input.machineId),
    input.tier,
    timestamp,
  ].join("-");
  return Object.freeze({
    json: join(outputRoot, `${stem}.json`),
    markdown: join(outputRoot, `${stem}.md`),
  });
}

function formatReport(report: SmokeReport): string {
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
  const psoWarmupEvidence = report.runs.map((run) => {
    if (run.psoWarmup.state !== "measured") {
      return `- ${run.profile} repeat ${run.repeat}: ${run.psoWarmup.state} — ${run.psoWarmup.reason}`;
    }
    const evidence = run.psoWarmup.value;
    return `- ${run.profile} repeat ${run.repeat}: ${evidence.state}; source ${evidence.source ?? "none"}; requested/compiled/deferred ${evidence.requestedCount}/${evidence.compiledCount}/${evidence.deferredCount}; registry hits/misses ${evidence.cacheHitCount}/${evidence.cacheMissCount}; failures ${evidence.failureCount}; total/max compile ${formatMilliseconds(evidence.totalDurationMs)}/${formatMilliseconds(evidence.maximumCompileDurationMs)}; trace ${evidence.traceSha256 ?? "none"}`;
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
  if (!report.v8CodeCacheDiagnosticsRequested) {
    v8Evidence.push("- Not requested; run `pnpm harness:smoke:v8-cache` for this diagnostic.");
  }
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
  if (!report.v8CodeCacheDiagnosticsRequested) {
    v8ProductionEvidence.push(
      "- Not requested; run `pnpm harness:smoke:v8-cache` for this diagnostic.",
    );
  }
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
  if (!report.v8CodeCacheDiagnosticsRequested) {
    v8CompileDurationEvidence.push(
      "- Not requested; run `pnpm harness:smoke:v8-cache` for this diagnostic.",
    );
  }
  const v8WorkerStartupEvidence = report.v8CodeCacheDiagnostics.map((run) => {
    const metric = run.workerStartupToFirstFrameMs;
    return metric.state === "measured"
      ? `- ${run.profile} repeat ${run.repeat}: ${formatMilliseconds(metric.value)}`
      : `- ${run.profile} repeat ${run.repeat}: invalid — ${metric.reason}`;
  });
  if (!report.v8CodeCacheDiagnosticsRequested) {
    v8WorkerStartupEvidence.push(
      "- Not requested; run `pnpm harness:smoke:v8-cache` for this diagnostic.",
    );
  }
  const traceDrainEvidence = report.runs.map((run) => {
    const evidence = run.traceDrain.evidence;
    if (evidence === null) {
      return `- core ${run.profile} repeat ${run.repeat}; launch ${run.launchOrdinal} at +${formatMilliseconds(run.launchStartedAfterSequenceMs)}: invalid — ${run.traceDrain.state === "invalid" ? run.traceDrain.reason : "trace diagnostics unavailable"}`;
    }
    const completion = formatTraceCompletionObservation(evidence);
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
      const completion = formatTraceCompletionObservation(evidence);
      return `- V8 diagnostic ${run.profile} repeat ${run.repeat}; ${launch}: ${run.traceDrain.state}; categories ${evidence.categories.join(", ")}; recording before end ${formatMilliseconds(evidence.recordingDurationBeforeEndMs)}; ${evidence.eventCount} events / ${evidence.dataChunkCount} chunks / ${evidence.serializedEventBytes} serialized bytes; Tracing.end command ${formatMilliseconds(evidence.endCommandMs)}; completion after command ${formatMilliseconds(evidence.completionAfterEndCommandMs)}; data loss ${evidence.dataLossOccurred ?? "unknown"}; ${completion}`;
    }),
  );
  const httpServingEvidence = report.runs.map((run) =>
    run.http.state === "measured"
      ? formatHttpServingEvidence(run.profile, run.repeat, run.http.value)
      : `- ${run.profile} repeat ${run.repeat}: ${run.http.state} — ${run.http.reason}`,
  );
  const coreRunFailureLines =
    report.coreRunFailure === null
      ? ["None."]
      : [
          `- core ${report.coreRunFailure.profile} repeat ${report.coreRunFailure.repeat} (launch ${report.coreRunFailure.launchOrdinal}) failed: ${report.coreRunFailure.message}`,
          ...(report.coreRunFailure.streamingEvidence === null
            ? []
            : [
                `- Raw streaming snapshots retained: start samples/observer/settled/residents ${report.coreRunFailure.streamingEvidence.measurementStart.cellLoadSampleCount}/${report.coreRunFailure.streamingEvidence.measurementStart.observerUpdateCount}/${report.coreRunFailure.streamingEvidence.measurementStart.settledObserverUpdateCount}/${report.coreRunFailure.streamingEvidence.measurementStart.residentCellCount}; end ${report.coreRunFailure.streamingEvidence.measurementEnd.cellLoadSampleCount}/${report.coreRunFailure.streamingEvidence.measurementEnd.observerUpdateCount}/${report.coreRunFailure.streamingEvidence.measurementEnd.settledObserverUpdateCount}/${report.coreRunFailure.streamingEvidence.measurementEnd.residentCellCount}.`,
              ]),
          `- ${report.coreRunFailure.v8CodeCacheDiagnosticsSkipped}`,
        ];
  const jsHeapEvidence = report.runs.map((run) => {
    const invalidReason = run.jsHeap.state === "invalid" ? run.jsHeap.reason : null;
    const evidence = run.jsHeap.state === "measured" ? run.jsHeap.value : run.jsHeap.evidence;
    if (evidence === null) {
      return `- ${run.profile} repeat ${run.repeat}: invalid — ${invalidReason ?? "unknown failure"}`;
    }
    const validity = invalidReason === null ? "measured" : `invalid — ${invalidReason}; retained`;
    const realmCount = evidence.samples[0]?.realms.length ?? 0;
    const dedicatedWorkerCount = Math.max(0, realmCount - 1);
    return `- ${run.profile} repeat ${run.repeat}: ${validity} near-concurrent aggregate used-heap high-water estimate ${formatBytes(evidence.highWaterUsedSizeBytes)} across ${realmCount} app realms (window + ${dedicatedWorkerCount} dedicated workers); ${evidence.samples.length} samples over ${formatMilliseconds(evidence.periodicSamplingDurationMs)} at ${evidence.sampleIntervalMs} ms fixed-deadline interval in a dedicated post-trace steady-state window; missed deadlines ${evidence.missedSampleDeadlines}; maximum start delay ${formatMilliseconds(evidence.maximumSamplingStartDelayMs)}; maximum realm response-completion skew ${formatMilliseconds(evidence.maximumRealmResponseCompletionSkewMs)}; slowest collection ${formatMilliseconds(evidence.maximumCollectionDurationMs)}`;
  });
  const sabRingBufferEvidence = report.runs.map((run) => {
    if (run.sabRingBuffer.state !== "measured") {
      return `- ${run.profile} repeat ${run.repeat}: invalid — ${run.sabRingBuffer.reason}`;
    }
    const evidence = run.sabRingBuffer.value;
    return `- ${run.profile} repeat ${run.repeat}: ${evidence.responsesReceived}/${evidence.messageCount} validated round trips in ${formatMilliseconds(evidence.elapsedMs)} (${Math.round(evidence.cooperativeRoundTripsPerSecond ?? 0).toLocaleString("en-US")} cooperative round trips/s, including window pump scheduling); ${formatBytes(evidence.totalSABBytes)} fixed SAB pool; main producer stalls ${evidence.mainProducerStalls}, empty polls ${evidence.mainConsumerEmptyPolls}, max pump ${formatMilliseconds(evidence.mainPumpMaxDurationMs)}; worker inbound waits ${evidence.workerInboundWaits}, outbound stalls ${evidence.workerOutboundStalls}; ${evidence.workerConcurrentFrameCount} concurrent render callbacks, max interval/render ${formatMilliseconds(evidence.workerConcurrentFrameIntervalMaxMs)}/${formatMilliseconds(evidence.workerConcurrentRenderDurationMaxMs)}; payload/sequence errors ${evidence.payloadErrors}/${evidence.workerSequenceErrors}`;
  });
  const wasmThreadEvidence = report.runs.map((run) => {
    if (run.wasmThreads.state !== "measured") {
      return `- ${run.profile} repeat ${run.repeat}: invalid — ${run.wasmThreads.reason}`;
    }
    const evidence = run.wasmThreads.value;
    return `- ${run.profile} repeat ${run.repeat}: ${evidence.completedTasks.toLocaleString("en-US")}/${evidence.taskCount.toLocaleString("en-US")} SIMD tasks across ${evidence.workerCount} Rust/WASM instances in ${formatMilliseconds(evidence.elapsedMs)} total (${formatMilliseconds(evidence.moduleLoadAndCompileElapsedMs)} load+compile, ${formatMilliseconds(evidence.workerInitializationElapsedMs)} worker init, ${formatMilliseconds(evidence.parallelExecutionElapsedMs)} parallel execution); per-worker claims [${evidence.processedTasksByWorker.map((count) => count.toLocaleString("en-US")).join(", ")}]; worker mask 0x${evidence.workerMask.toString(16)}; checksum 0x${(evidence.checksum ?? 0).toString(16)} matched reference; ${formatBytes(evidence.memoryBytes)} fixed shared linear memory; ${formatBytes(evidence.moduleBytes ?? 0)} optimized module`;
  });
  const greyboxWorldEvidence = report.runs.map((run) => {
    const evidence = run.greyboxWorld.value;
    const lighting = evidence.observedLighting;
    const output = evidence.renderedOutput;
    return `- ${run.profile} repeat ${run.repeat}: ${evidence.districtId}; ${evidence.cellCount} cells; LOD cells [${evidence.selectedLodCellCounts.join(", ")}]; ${evidence.renderedTerrainPatchCount.toLocaleString("en-US")} terrain patches / ${evidence.renderedFeaturePrimitiveCount.toLocaleString("en-US")} box features / ${evidence.renderedTriangleCount.toLocaleString("en-US")} triangles; ${evidence.colliderCount.toLocaleString("en-US")} colliders / ${evidence.heightSampleCount.toLocaleString("en-US")} height samples; ${evidence.materialCount} materials; ${formatMilliseconds(evidence.mainThreadWorldGenerationMs)} main-thread generation / ${formatMilliseconds(evidence.mainThreadScenePostMessageMs)} main-thread scene postMessage / ${formatMilliseconds(evidence.materializationMs)} worker materialization; canvas ${output.width}×${output.height}, clear RGB [${output.clearColorRgb.join(", ")}], ${output.visiblePixelCount.toLocaleString("en-US")} visible pixels (${(output.visiblePixelRatio * 100).toFixed(2)}%), PNG SHA-256 \`${output.pngSha256}\`; ${lighting.sampleCount} lighting samples, phase ${lighting.phaseMinimum.toFixed(6)}–${lighting.phaseMaximum.toFixed(6)} (range ${lighting.phaseRange.toFixed(6)}), intensity ${lighting.intensityMinimum.toFixed(6)}–${lighting.intensityMaximum.toFixed(6)} (range ${lighting.intensityRange.toFixed(6)})`;
  });
  const streamingEvidence = report.runs.map((run) => {
    const evidence = run.streaming.value;
    return `- ${run.profile} repeat ${run.repeat}: ${evidence.cellLoadSampleCount} OPFS→decode→GPU samples (${evidence.measurementCellLoadSamples.length} in-window), p95 ${formatMilliseconds(evidence.cellLoadP95Ms)}; ${evidence.opfsAccessHandleCount}/${evidence.opfsPackageCount} startup-open OPFS handles in ${formatMilliseconds(evidence.opfsAccessHandleOpenDurationMs)}; ${evidence.decodeWorkerCount} decode workers on hardwareConcurrency ${evidence.hardwareConcurrency}; queue high-water ${evidence.decodeQueueDepthHighWater}; ${evidence.residentCellCount} resident cells representing ${formatBytes(evidence.residentEncodedBytes)} encoded / ${formatBytes(evidence.residentGpuBytes)} attributable GPU bytes; ${evidence.measurementProactiveEvictionCount} in-window proactive evictions; ${evidence.cpuBudgetRejectionCount} encoded-budget rejections; ${formatBytes(evidence.opfsProvisionedBytes)} provisioned this launch`;
  });
  const streamingVarianceEvidence = report.streamingCellLoadP95Variance.map((variance) =>
    variance.state === "measured"
      ? `- ${variance.profile}: measured absolute p95 range ${formatMilliseconds(variance.absoluteP95RangeMs)} (allowed ${formatMilliseconds(variance.allowedAbsoluteP95RangeMs)} = max(${(100 * SMOKE_STREAMING_P95_RELATIVE_RANGE_LIMIT).toFixed(0)}% of the minimum, ${formatMilliseconds(SMOKE_STREAMING_P95_ABSOLUTE_RANGE_FLOOR_MS)} floor)); relative range ${variance.relativeP95Range === null ? "unbounded at zero" : `${(100 * variance.relativeP95Range).toFixed(3)}%`}`
      : `- ${variance.profile}: diagnostic invalid (non-blocking) — ${variance.reason}`,
  );
  const simulationEvidence = report.runs.map((run) => {
    const evidence = run.simulationController.value;
    const exit = evidence.m3Exit;
    return `- ${run.profile} repeat ${run.repeat}: 120-tick replay hashes \`${evidence.replayFinalStateHash}\` / \`${evidence.replaySecondStateHash}\`, loaded \`${evidence.replayLoadedStateHash}\` (match ${evidence.replayHashMatch}); live save/load hashes \`${evidence.saveLoadStateHash}\` / \`${evidence.saveLoadReloadedStateHash}\` (match ${evidence.saveLoadHashMatch}); ${exit.positioningReplayTick}-tick positioning replay/load SHA-256 \`${exit.positioningReplayStateHash}\`; ordinary input presses ${exit.gameplayInteractionPressCountBefore}→${exit.gameplayInteractionPressCount}; interacted with NPC ${exit.npcEntityId} (${exit.speaker}); installed model state ${exit.installedModelState}; question \`${exit.playerQuestion}\`; response \`${exit.response}\`; dialog requests ${exit.dialogRequestCountBefore}→${exit.dialogRequestCount}; knowledge requests ${exit.knowledgeRequestCountBefore}→${exit.knowledgeRequestCount}; retrieved entries ${exit.knowledgeEntryCountBefore}→${exit.knowledgeEntryCount}; retrieved-state authored fallback ${exit.responseUsedRetrievedState ? "verified" : "failed"}; character+crowd step high water ${formatMilliseconds(evidence.stepDurationHighWaterMs)}`;
  });
  const lines = [
    `# Parallax ${report.scenario}`,
    "",
    `Verdict: **${report.passed ? "PASS" : "FAIL"}**`,
    `Build artifact: \`${report.artifactDigest}\``,
    `Install release: \`${report.releaseDigest}\``,
    `Engine + render worker: **${formatBytes(report.build.engineAndRenderWorkerBytes)}** (${formatBytes(report.build.engineArtifact.bytes)} engine service + ${formatBytes(report.build.renderWorkerArtifact.bytes)} render worker)`,
    `Serving target: **${report.environment.target.kind}** \`${report.environment.target.origin}\``,
    `Target preflight: **${formatTargetVerificationEvidence(report.environment.targetPreflight)}**`,
    `Target postflight: **${formatTargetVerificationEvidence(report.environment.targetPostflight)}**`,
    `Chrome: \`${report.environment.browserProduct}\``,
    `Harness runtime: \`${report.harnessRuntime.nodeVersion}\` (executable SHA-256 \`${report.harnessRuntime.nodeExecutableSha256}\`)`,
    `Sandbox: **${report.environment.sandboxVerified ? "verified" : "invalid"}**`,
    "",
    "## Baseline policy",
    "",
    ...formatBaselineEvaluation(report.baseline),
    "",
    "## Result facets",
    "",
    ...formatSmokeFacetSummary(report.facets),
    "",
    "## Failures",
    "",
    ...(failures.length === 0 ? ["None."] : failures.map((failure) => `- ${failure}`)),
    "",
    "## Core run failure",
    "",
    ...coreRunFailureLines,
    "",
    "## Informational failures (non-blocking)",
    "",
    ...(report.informationalFailures.length === 0
      ? ["None."]
      : report.informationalFailures.map((failure) => `- ${failure}`)),
    "",
    "## D1 greybox rendered-world evidence",
    "",
    ...greyboxWorldEvidence,
    "",
    "## D1 streaming evidence",
    "",
    ...streamingEvidence,
    "",
    "## D1 streaming repeatability diagnostic (informational)",
    "",
    ...streamingVarianceEvidence,
    "",
    "## M3 simulation and playable-loop evidence",
    "",
    ...simulationEvidence,
    "",
    "## Dawn pipeline/cache evidence",
    "",
    ...dawnEvidence,
    "",
    "## PSO warmup trace replay",
    "",
    ...psoWarmupEvidence,
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
    "## SAB ring-buffer transport",
    "",
    ...sabRingBufferEvidence,
    "",
    "## Rust/WASM threads",
    "",
    ...wasmThreadEvidence,
    "",
    "## HTTP serving evidence",
    "",
    ...httpServingEvidence,
    "",
    "## Trace drain diagnostics",
    "",
    ...traceDrainEvidence,
    "",
  ];
  return lines.join("\n");
}

function finalizationFailureReason(
  postRunIdentity: FinalizationEvidence,
  reportPersistence: FinalizationEvidence,
): string | null {
  const failures = [postRunIdentity, reportPersistence].flatMap((evidence) =>
    evidence.state === "invalid" ? [evidence.reason] : [],
  );
  return failures.length === 0 ? null : `Report finalization failed: ${failures.join(" | ")}`;
}

function formatTraceCompletionObservation(evidence: SmokeTraceDrainEvidence): string {
  if (evidence.completionAfterEndCommandMs !== null) {
    return `${formatMilliseconds(evidence.endWaitMs)} to ${
      evidence.completionDeadlineExceeded === true
        ? `late completion after the ${evidence.completionTimeoutMs} ms validity deadline`
        : "completion within the validity deadline"
    }`;
  }
  return `${formatMilliseconds(evidence.endWaitMs)} observed without completion against the ${evidence.completionObservationTimeoutMs} ms observation bound`;
}

function formatBaselineEvaluation(evaluation: BaselineEvaluation): readonly string[] {
  if (evaluation.state === "untracked") {
    return [`- **UNTRACKED** — ${evaluation.reason}; this report was not promoted automatically.`];
  }
  if (evaluation.state === "ineligible") {
    return [`- **INELIGIBLE** — ${evaluation.reason}; this report was not promoted automatically.`];
  }
  const heading =
    evaluation.state === "candidate"
      ? `- **CANDIDATE** — compared with promoted Chrome ${evaluation.baseline.browser.version}; explicit review and promotion are required.`
      : `- **CURRENT** — compared with the promoted Chrome ${evaluation.baseline.browser.version} baseline.`;
  return [
    heading,
    ...evaluation.metrics.map((metric) => {
      const relative =
        metric.relativeDelta === null
          ? "relative delta unavailable (baseline is zero)"
          : `${(metric.relativeDelta * 100).toFixed(2)}%`;
      return `  - ${metric.key}: ${metric.candidate} vs ${metric.baseline} (${metric.absoluteDelta >= 0 ? "+" : ""}${metric.absoluteDelta}; ${relative})`;
    }),
  ];
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
