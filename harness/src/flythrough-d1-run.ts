import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ParallaxTelemetryExport } from "@parallax/engine";
import type { BrowserContext, CDPSession, Page } from "playwright-core";
import { evaluateP95Variance, type VarianceMetric } from "./aggregate.js";
import {
  readBrowserDisplayIdentity,
  readChromeCommandLine,
  readWebGpuAdapterIdentity,
} from "./browser-probes.js";
import {
  type BudgetCheck,
  evaluateJsHeapBudget,
  evaluateMainThreadBudgets,
  evaluatePipelineBudgets,
  evaluateStreamingBudgets,
  type QualityTier,
} from "./budgets.js";
import { type BuildManifest, readAndValidateBuildManifest, sha256File } from "./build-manifest.js";
import {
  type ChromePin,
  launchPersistentChrome,
  loadChromePin,
  resolveChromeExecutablePath,
  validateChromeExecutable,
  validateChromeSandboxCommandLine,
} from "./chrome-pin.js";
import {
  D3D12_HISTOGRAM_PREFIX,
  DAWN_TRACE_CATEGORY,
  type DawnHistogram,
  resolveD3D12DawnPipelineWindowEvidence,
} from "./dawn-pipeline-trace.js";
import {
  type BrowserDisplayIdentity,
  type CdpGpuDevice,
  type EnvironmentGateState,
  evaluateGateEnvironment,
  invalidEnvironmentGate,
  loadMachineDescriptor,
  type MachineDescriptor,
  safeMachineIdForFilename,
  tryReadWindowsHostIdentity,
  type WebGpuAdapterIdentity,
  type WindowsHostIdentity,
} from "./environment.js";
import { requireNoFlythroughD1Arguments } from "./flythrough-d1-cli.js";
import { type FlythroughEvidence, requireFlythroughEvidence } from "./flythrough-evidence.js";
import {
  assembleFlythroughAttempt,
  type FlythroughAttempt,
  type FlythroughTraceDrainEvidence,
  type MeasuredFlythroughEnvironment,
  measuredFlythroughEnvironmentFailures,
  measuredJsHeap,
} from "./flythrough-run-result.js";
import { requireValidFlythroughTraceCompletion } from "./flythrough-trace-policy.js";
import { resolveHeapWorkerTargetUrls } from "./heap-worker-topology.js";
import {
  type JsHeapEvidence,
  type JsHeapMetric,
  type JsHeapSampler,
  JsHeapValidationError,
  prepareJsHeapSampler,
} from "./js-heap.js";
import {
  launchAfterPhysicalConsoleDisplayWake,
  withClosedBrowserContext,
} from "./physical-console-preflight.js";
import { type ChromeTraceEvent, observeThroughLateCompletionWindow } from "./presentation-trace.js";
import {
  evaluatePostRunIdentity,
  type FinalizationEvidence,
  invalidFinalizationEvidence,
  measuredFinalizationEvidence,
  persistJsonPrimaryReport,
} from "./report-finalization.js";
import { evaluateResultFacets, type ResultFacets, resultFacetsPassed } from "./result-facets.js";
import {
  FLYTHROUGH_D1_COMPLETION_TIMEOUT_MS,
  FLYTHROUGH_D1_EXPECTED_SCENARIO,
  FLYTHROUGH_D1_JS_HEAP_SAMPLE_INTERVAL_MS,
  FLYTHROUGH_D1_MANDATORY_METRIC_SET_VERSION,
  FLYTHROUGH_D1_MANDATORY_METRICS,
  FLYTHROUGH_D1_REPEATS,
  FLYTHROUGH_D1_REPORT_SCHEMA_VERSION,
  FLYTHROUGH_D1_SCENARIO,
  FLYTHROUGH_D1_TELEMETRY_SCHEMA_VERSION,
  FLYTHROUGH_D1_TRACE_COMPLETION_TIMEOUT_MS,
  FLYTHROUGH_D1_TRACE_LATE_OBSERVATION_MS,
  FLYTHROUGH_D1_WARMUP_POLICY,
} from "./runs/flythrough-d1.js";
import { parseQualityTier, QUALITY_TIER_PROFILES, SMOKE_TRACE_QUIESCE_MS } from "./runs/smoke.js";
import { readSourceIdentity } from "./source-identity.js";
import { requireStreamingEvidence, type StreamingEvidence } from "./streaming-evidence.js";
import {
  assertHarnessNavigationUrl,
  captureTargetPostflight,
  failedTargetEvidence,
  formatTargetVerificationEvidence,
  type HarnessTargetIdentity,
  type HarnessTargetVerificationEvidence,
  harnessRuntimeUrl,
  parseHarnessTargetArguments,
  reconcileTargetPostflight,
  startHarnessTarget,
  verifiedTargetEvidence,
} from "./target.js";
import { readTelemetry } from "./telemetry.js";
import { errorMessage } from "./value-utils.js";

interface FlythroughRun {
  readonly budgetChecks: readonly BudgetCheck[];
  readonly dawnPipeline: ReturnType<typeof resolveD3D12DawnPipelineWindowEvidence>;
  readonly evidence: FlythroughEvidence;
  readonly mainThreadLongTasksOver50Ms: number;
  readonly repeat: number;
  readonly streaming: StreamingEvidence;
}

interface EnvironmentIdentity {
  readonly adapter: WebGpuAdapterIdentity | null;
  readonly browserDisplay: BrowserDisplayIdentity | null;
  readonly identityProbeBrowserCommandLine: string;
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
  readonly sandboxVerified: true;
  readonly target: HarnessTargetIdentity;
  readonly targetPostflight: HarnessTargetVerificationEvidence;
  readonly targetPreflight: HarnessTargetVerificationEvidence;
  readonly targetDisplayMode: string;
}

interface P95VarianceEvidence {
  readonly metric: string;
  readonly note: string;
  readonly variance: VarianceMetric;
}

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const buildRoot = join(repositoryRoot, "dist");
const outputRoot = join(repositoryRoot, "harness/results");
const machineRoot = join(repositoryRoot, "harness/machines");

await main();

async function main(): Promise<void> {
  const targetOptions = parseHarnessTargetArguments(process.argv.slice(2));
  requireNoFlythroughD1Arguments(targetOptions.remainingArguments);
  const machineId = requiredEnvironment("PARALLAX_MACHINE_ID");
  const tier = parseQualityTier(process.env.PARALLAX_TIER);
  const chromePin = await loadChromePin(join(repositoryRoot, "harness/chrome/stable.json"));
  const executablePath = await resolveChromeExecutablePath(repositoryRoot, chromePin);
  const executableSha256 = await validateChromeExecutable(chromePin, executablePath);
  const build = await readAndValidateBuildManifest(buildRoot);
  const source = await readSourceIdentity(repositoryRoot);
  const expectedNodeVersion = await readExpectedNodeVersion(repositoryRoot);
  const harnessRuntime = Object.freeze({
    eligible: process.version === `v${expectedNodeVersion}`,
    expectedNodeVersion,
    nodeExecutableSha256: (await sha256File(process.execPath)).sha256,
    nodeVersion: process.version,
  });
  const target = await startHarnessTarget({
    artifactDigest: build.artifactDigest,
    buildManifest: build.manifest,
    buildRoot,
    request: targetOptions.request,
  });
  const baseUrl = target.baseUrl;
  const heapWorkerUrls = Object.freeze({
    baseUrl,
    manifest: build.manifest,
  });
  const profileRoot = await mkdtemp(join(tmpdir(), "parallax-flythrough-d1-"));
  const attempts: FlythroughAttempt<FlythroughRun>[] = [];
  try {
    let environment = await inspectEnvironment(
      executablePath,
      join(profileRoot, "identity"),
      chromePin,
      machineId,
      tier,
      target.probeUrl,
      target.identity,
    );
    for (let repeat = 1; repeat <= FLYTHROUGH_D1_REPEATS; repeat += 1) {
      const attempt = await measureFlythroughAttempt(
        executablePath,
        join(profileRoot, `repeat-${repeat}`),
        baseUrl,
        repeat,
        environment.adapter?.backend ?? null,
        tier,
        heapWorkerUrls,
      );
      attempts.push(attempt);
      if (attempt.state === "invalid") break;
    }
    const runs = attempts.flatMap((attempt) =>
      attempt.state === "measured" && attempt.result !== null ? [attempt.result] : [],
    );
    const invalidAttempt = attempts.find((attempt) => attempt.state === "invalid");
    const attemptFailure =
      invalidAttempt === undefined
        ? null
        : `repeat ${invalidAttempt.repeat}: ${invalidAttempt.failureMessage ?? "unknown failure"}`;
    environment = await revalidateEnvironment(environment);
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
    const measuredEnvironmentFailures = measuredFlythroughEnvironmentFailures({
      attempts,
      chromePinVersion: chromePin.version,
      expectedNodeVersion,
      nodeVersion: process.version,
      reference: environment,
    });
    const p95Variance = collectP95Variance(runs);
    const budgetCoverage = flythroughBudgetCoverage();
    const postRunIdentity = await evaluatePostRunIdentity(build.artifactDigest, source, {
      readArtifactDigest: async () =>
        (await readAndValidateBuildManifest(buildRoot)).artifactDigest,
      readSourceIdentity: () => readSourceIdentity(repositoryRoot),
    });
    const generatedAt = new Date().toISOString();
    const assembleReport = (reportPersistence: FinalizationEvidence) => {
      const finalizationFailure = finalizationFailureReason(postRunIdentity, reportPersistence);
      const reportFinalization =
        finalizationFailure === null
          ? measuredFinalizationEvidence()
          : invalidFinalizationEvidence(finalizationFailure);
      const runFailure = attemptFailure;
      const evidenceFailures = [
        ...(runFailure === null ? [] : [runFailure]),
        ...(finalizationFailure === null ? [] : [finalizationFailure]),
        ...(runs.length === FLYTHROUGH_D1_REPEATS
          ? []
          : [`completed ${runs.length} of ${FLYTHROUGH_D1_REPEATS} repeats`]),
        ...runs.flatMap((run) =>
          run.dawnPipeline.state === "measured"
            ? []
            : [`repeat ${run.repeat}: ${run.dawnPipeline.reason}`],
        ),
        ...p95Variance.flatMap((metric) =>
          metric.variance.state === "measured"
            ? []
            : [`${metric.metric}: ${metric.variance.reason}`],
        ),
      ];
      const evidenceChecks = flythroughEvidenceChecks(
        runs,
        p95Variance,
        runFailure,
        reportFinalization,
      );
      const facets = evaluateResultFacets({
        budgetChecks: runs.flatMap((run) =>
          run.budgetChecks.map((check) =>
            Object.freeze({
              description: `repeat ${run.repeat}: ${check.metric} ${check.actual} <= ${check.limit}`,
              passed: check.passed,
            }),
          ),
        ),
        environment:
          environment.gateIdentity.state === "measured" && measuredEnvironmentFailures.length === 0
            ? { failures: Object.freeze([]), measured: true }
            : {
                failures: Object.freeze([
                  ...(environment.gateIdentity.state === "invalid"
                    ? environment.gateIdentity.reasons.map(
                        (reason) => `verified gate environment identity: invalid (${reason})`,
                      )
                    : []),
                  ...measuredEnvironmentFailures,
                ]),
                measured: false,
              },
        evidenceChecks,
      });
      return Object.freeze({
        artifactDigest: build.artifactDigest,
        attempts,
        budgetCoverage,
        chromePin,
        environment: Object.freeze({ ...environment, executableSha256 }),
        evidenceFailures: Object.freeze(evidenceFailures),
        facets,
        finalizationFailure,
        generatedAt,
        harnessRuntime,
        mandatoryMetricSet: {
          metrics: FLYTHROUGH_D1_MANDATORY_METRICS,
          version: FLYTHROUGH_D1_MANDATORY_METRIC_SET_VERSION,
        },
        passed: resultFacetsPassed(facets),
        postRunIdentity,
        reportPersistence,
        releaseDigest: build.releaseDigest,
        repeats: FLYTHROUGH_D1_REPEATS,
        runFailure,
        scenario: FLYTHROUGH_D1_SCENARIO,
        scenarioContract: FLYTHROUGH_D1_EXPECTED_SCENARIO,
        schemaVersion: FLYTHROUGH_D1_REPORT_SCHEMA_VERSION,
        source,
        p95Variance,
        warmupPolicy: FLYTHROUGH_D1_WARMUP_POLICY,
      });
    };
    await mkdir(outputRoot, { recursive: true });
    const stem = `${FLYTHROUGH_D1_SCENARIO.replace("@", "-")}-${build.artifactDigest.slice(
      0,
      12,
    )}-${safeMachineIdForFilename(machineId)}-${tier}-${generatedAt.replaceAll(/[:.]/g, "-")}`;
    const jsonPath = join(outputRoot, `${stem}.json`);
    const markdownPath = join(outputRoot, `${stem}.md`);
    const persistence = await persistJsonPrimaryReport({
      failedReport: (reason) => assembleReport(invalidFinalizationEvidence(reason)),
      formatMarkdown: formatReport,
      jsonPath,
      markdownPath,
      pendingReport: assembleReport(
        invalidFinalizationEvidence("Human-readable report persistence has not completed"),
      ),
      successfulReport: assembleReport(measuredFinalizationEvidence()),
    });
    console.log(`Flythrough result: ${jsonPath}`);
    if (persistence.markdown !== null) console.log(`Flythrough summary: ${markdownPath}`);
    if (persistence.secondaryFailure !== null) console.error(persistence.secondaryFailure);
    if (!persistence.finalReport.passed) process.exitCode = 1;
  } finally {
    await rm(profileRoot, { force: true, recursive: true });
    await target.stop();
  }
}

interface MutableAttemptCapture {
  readonly browserErrors: string[];
  environment: MeasuredFlythroughEnvironment | null;
  jsHeap: JsHeapMetric | null;
  traceDrain: FlythroughTraceDrainEvidence | null;
}

async function measureFlythroughAttempt(
  executablePath: string,
  profilePath: string,
  baseUrl: string,
  repeat: number,
  backend: string | null,
  tier: QualityTier,
  heapWorkerUrls: HeapWorkerUrls,
): Promise<FlythroughAttempt<FlythroughRun>> {
  const capture: MutableAttemptCapture = {
    browserErrors: [],
    environment: null,
    jsHeap: null,
    traceDrain: null,
  };
  let result: FlythroughRun | null = null;
  let error: unknown | null = null;
  try {
    result = await measureFlythroughResult(
      executablePath,
      profilePath,
      baseUrl,
      repeat,
      backend,
      tier,
      heapWorkerUrls,
      capture,
    );
  } catch (caught: unknown) {
    error = caught;
  }
  return assembleFlythroughAttempt({
    ...capture,
    error,
    repeat,
    result,
  });
}

async function measureFlythroughResult(
  executablePath: string,
  profilePath: string,
  baseUrl: string,
  repeat: number,
  backend: string | null,
  tier: QualityTier,
  heapWorkerUrls: HeapWorkerUrls,
  capture: MutableAttemptCapture,
): Promise<FlythroughRun> {
  const hostBeforeResultPromise = tryReadWindowsHostIdentity();
  return withClosedBrowserContext(
    () =>
      launchAfterPhysicalConsoleDisplayWake(() =>
        launchPersistentChrome(executablePath, profilePath),
      ),
    async (context) => {
      const page = context.pages()[0] ?? (await context.newPage());
      page.on("pageerror", (error) => capture.browserErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") capture.browserErrors.push(message.text());
      });
      await installLongTaskObserver(page);
      const runtimeUrl = harnessRuntimeUrl(baseUrl);
      await page.goto(runtimeUrl, { waitUntil: "load" });
      assertHarnessNavigationUrl(page.url(), runtimeUrl, `flythrough repeat ${repeat}`);
      await page.waitForFunction(
        (schemaVersion) => {
          const telemetry = Reflect.get(
            globalThis,
            "__PARALLAX_TELEMETRY__",
          ) as ParallaxTelemetryExport;
          const snapshot = telemetry?.snapshot();
          return (
            snapshot?.schemaVersion === schemaVersion &&
            snapshot.render.state === "ready" &&
            snapshot.streaming.state === "streaming"
          );
        },
        FLYTHROUGH_D1_TELEMETRY_SCHEMA_VERSION,
        { timeout: 120_000 },
      );
      const hostBeforeResult = await hostBeforeResultPromise;
      if (hostBeforeResult.state === "invalid") throw new Error(hostBeforeResult.reason);
      capture.environment = await inspectMeasuredEnvironment(
        context,
        page,
        hostBeforeResult.host,
        null,
        null,
      );
      await page.evaluate(() => {
        const telemetry = Reflect.get(
          globalThis,
          "__PARALLAX_TELEMETRY__",
        ) as ParallaxTelemetryExport;
        telemetry.prepareFlythrough();
      });
      await page.waitForFunction(
        () => {
          const telemetry = Reflect.get(
            globalThis,
            "__PARALLAX_TELEMETRY__",
          ) as ParallaxTelemetryExport;
          return ["prepared", "failed"].includes(telemetry.snapshot().flythrough.state);
        },
        undefined,
        { timeout: 180_000 },
      );
      const prepared = await readTelemetry(page);
      if (prepared.flythrough.state !== "prepared") {
        throw new Error(prepared.flythrough.failureMessage ?? "Flythrough preflight failed");
      }
      const histogramsBefore = await readD3D12CacheHistograms(context);
      const heapCapture = await prepareFullWindowHeapCapture(context, page, heapWorkerUrls);
      const trace = await beginTrace(context);
      try {
        await resetLongTaskObserver(page);
        const streamingStart = prepared.streaming;
        heapCapture.sampler.start();
        await trace.mark(page, "parallax-presentation-window-start");
        await page.evaluate(() => {
          const telemetry = Reflect.get(
            globalThis,
            "__PARALLAX_TELEMETRY__",
          ) as ParallaxTelemetryExport;
          telemetry.startFlythrough();
        });
        await page.waitForFunction(
          () => {
            const telemetry = Reflect.get(
              globalThis,
              "__PARALLAX_TELEMETRY__",
            ) as ParallaxTelemetryExport;
            return ["completed", "failed"].includes(telemetry.snapshot().flythrough.state);
          },
          undefined,
          { timeout: FLYTHROUGH_D1_COMPLETION_TIMEOUT_MS },
        );
        await trace.mark(page, "parallax-presentation-window-end");
        const snapshot = await readTelemetry(page);
        const longTasks = await readMainThreadLongTasks(page);
        let jsHeapEvidence: JsHeapEvidence;
        try {
          jsHeapEvidence = await heapCapture.sampler.finish();
          capture.jsHeap = measuredJsHeap(jsHeapEvidence);
        } catch (error: unknown) {
          if (error instanceof JsHeapValidationError) {
            capture.jsHeap = Object.freeze({
              evidence: error.evidence,
              reason: error.message,
              state: "invalid",
            });
          }
          throw error;
        }
        let traceEvents: readonly ChromeTraceEvent[];
        try {
          traceEvents = await trace.finish();
        } catch (error: unknown) {
          capture.traceDrain = trace.diagnostics();
          throw error;
        }
        capture.traceDrain = trace.diagnostics();
        const histogramsAfter = await readD3D12CacheHistograms(context);
        const browserDisplayAfter = await readBrowserDisplayIdentity(context, page);
        const hostAfterResult = await tryReadWindowsHostIdentity();
        if (hostAfterResult.state === "invalid") throw new Error(hostAfterResult.reason);
        capture.environment = Object.freeze({
          ...capture.environment,
          browserDisplayAfter,
          hostAfter: hostAfterResult.host,
        }) as MeasuredFlythroughEnvironment;
        if (capture.browserErrors.length > 0) {
          throw new Error(`Browser errors: ${capture.browserErrors.join(" | ")}`);
        }
        const evidence = requireFlythroughEvidence(snapshot.flythrough);
        const streaming = requireStreamingEvidence(snapshot.streaming, streamingStart);
        const dawnPipeline = resolveD3D12DawnPipelineWindowEvidence(
          { state: "measured", value: traceEvents },
          backend,
          { state: "measured", value: histogramsBefore },
          { state: "measured", value: histogramsAfter },
        );
        const budgetChecks = Object.freeze([
          ...evaluateJsHeapBudget(jsHeapEvidence.highWaterUsedSizeBytes, tier),
          ...evaluateMainThreadBudgets(longTasks),
          ...evaluateStreamingBudgets(streaming.cellLoadP95Ms),
          ...(dawnPipeline.state === "measured"
            ? evaluatePipelineBudgets(
                dawnPipeline.value.pipelineActivity.overlappingMeasurement,
                dawnPipeline.value.shaderCache.missesOverlappingMeasurement,
              )
            : []),
        ]);
        return Object.freeze({
          budgetChecks,
          dawnPipeline,
          evidence,
          mainThreadLongTasksOver50Ms: longTasks,
          repeat,
          streaming,
        });
      } finally {
        await heapCapture.discard().catch(() => undefined);
        try {
          await trace.discard().catch(() => undefined);
        } finally {
          capture.traceDrain = trace.diagnostics();
        }
      }
    },
  );
}

interface HeapWorkerUrls {
  readonly baseUrl: string;
  readonly manifest: BuildManifest;
}

async function prepareFullWindowHeapCapture(
  context: BrowserContext,
  page: Page,
  workerUrls: HeapWorkerUrls,
): Promise<
  Readonly<{
    discard(): Promise<void>;
    readonly sampler: JsHeapSampler;
  }>
> {
  const browser = context.browser();
  if (browser === null) throw new Error("Playwright did not expose the launched browser");
  const browserSession = await browser.newBrowserCDPSession();
  const pageSession = await context.newCDPSession(page);
  try {
    const topology = await readTelemetry(page);
    const sampler = await prepareJsHeapSampler(
      browserSession,
      pageSession,
      page.url(),
      resolveHeapWorkerTargetUrls({
        baseUrl: workerUrls.baseUrl,
        decodeWorkerCount: topology.streaming.decodeWorkerCount,
        manifest: workerUrls.manifest,
      }),
      FLYTHROUGH_D1_JS_HEAP_SAMPLE_INTERVAL_MS,
    );
    return Object.freeze({
      async discard(): Promise<void> {
        await sampler.discard().catch(() => undefined);
        await pageSession.detach().catch(() => undefined);
        await browserSession.detach().catch(() => undefined);
      },
      sampler,
    });
  } catch (error) {
    await pageSession.detach().catch(() => undefined);
    await browserSession.detach().catch(() => undefined);
    throw error;
  }
}

interface TraceCapture {
  diagnostics(): FlythroughTraceDrainEvidence;
  discard(): Promise<void>;
  finish(): Promise<readonly ChromeTraceEvent[]>;
  mark(page: Page, name: string): Promise<void>;
}

async function beginTrace(context: BrowserContext): Promise<TraceCapture> {
  const browser = context.browser();
  if (browser === null) throw new Error("Playwright did not expose the launched browser");
  const session = await browser.newBrowserCDPSession();
  const events: ChromeTraceEvent[] = [];
  const categories = Object.freeze([DAWN_TRACE_CATEGORY, "blink.user_timing"].sort());
  let active = true;
  let completedAtMs: number | null = null;
  let completionDeadlineExceeded: boolean | null = null;
  let dataChunkCount = 0;
  let dataLossOccurred: boolean | null = null;
  let endCommandCompletedAtMs: number | null = null;
  let endRequestedAtMs: number | null = null;
  let serializedEventBytes = 0;
  let traceStartedAtMs: number | null = null;
  session.on("Tracing.dataCollected", (event) => {
    const traceEvents = event.value as unknown as readonly ChromeTraceEvent[];
    dataChunkCount += 1;
    serializedEventBytes += Buffer.byteLength(JSON.stringify(traceEvents), "utf8");
    events.push(...traceEvents);
  });
  const complete = new Promise<{ dataLossOccurred: boolean }>((resolveComplete, rejectComplete) => {
    session.once("Tracing.tracingComplete", (event) => {
      completedAtMs = performance.now();
      dataLossOccurred = event.dataLossOccurred;
      resolveComplete(event);
    });
    session.once("close", () => rejectComplete(new Error("Flythrough trace session closed")));
  });
  void complete.catch(() => undefined);
  await session.send("Tracing.start", {
    traceConfig: {
      includedCategories: [...categories],
      recordMode: "recordAsMuchAsPossible",
    },
    transferMode: "ReportEvents",
  });
  traceStartedAtMs = performance.now();
  const diagnostics = (): FlythroughTraceDrainEvidence =>
    Object.freeze({
      categories,
      completionAfterEndCommandMs:
        completedAtMs === null || endCommandCompletedAtMs === null
          ? null
          : completedAtMs - endCommandCompletedAtMs,
      completionDeadlineExceeded,
      completionObservationTimeoutMs:
        FLYTHROUGH_D1_TRACE_COMPLETION_TIMEOUT_MS + FLYTHROUGH_D1_TRACE_LATE_OBSERVATION_MS,
      completionTimeoutMs: FLYTHROUGH_D1_TRACE_COMPLETION_TIMEOUT_MS,
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
  const stop = async (): Promise<void> => {
    if (!active) return;
    active = false;
    endRequestedAtMs = performance.now();
    try {
      const observation = await observeThroughLateCompletionWindow(
        (async () => {
          await session.send("Tracing.end");
          endCommandCompletedAtMs = performance.now();
          return complete;
        })(),
        FLYTHROUGH_D1_TRACE_COMPLETION_TIMEOUT_MS,
        FLYTHROUGH_D1_TRACE_LATE_OBSERVATION_MS,
        "Flythrough trace end/completion",
      );
      completionDeadlineExceeded = observation.exceededDeadline;
      requireValidFlythroughTraceCompletion(observation);
    } catch (error) {
      const snapshot = diagnostics();
      throw new Error(
        `${errorMessage(error)}; Tracing.end command ${formatNullableMilliseconds(snapshot.endCommandMs)}; received ${snapshot.eventCount} events in ${snapshot.dataChunkCount} chunks (${snapshot.serializedEventBytes} serialized bytes) during ${formatNullableMilliseconds(snapshot.endWaitMs)}`,
      );
    } finally {
      await session.detach().catch(() => undefined);
    }
  };
  return Object.freeze({
    diagnostics,
    async discard(): Promise<void> {
      await stop();
    },
    async finish(): Promise<readonly ChromeTraceEvent[]> {
      if (!active) throw new Error("Flythrough trace was already stopped");
      await stop();
      return Object.freeze(events);
    },
    mark(page: Page, name: string): Promise<void> {
      return page.evaluate((marker) => performance.mark(marker), name).then(() => undefined);
    },
  });
}

async function inspectEnvironment(
  executablePath: string,
  profilePath: string,
  chromePin: ChromePin,
  machineId: string,
  tier: QualityTier,
  probeUrl: string,
  target: HarnessTargetIdentity,
): Promise<EnvironmentIdentity> {
  let machine: MachineDescriptor | null = null;
  let machineFailure: string | null = null;
  try {
    machine = await loadMachineDescriptor(machineRoot, machineId);
  } catch (error) {
    machineFailure = `Machine descriptor unavailable: ${errorMessage(error)}`;
  }
  const hostResultPromise = tryReadWindowsHostIdentity();
  const context = await launchAfterPhysicalConsoleDisplayWake(() =>
    launchPersistentChrome(executablePath, profilePath, ["--enable-webgpu-developer-features"]),
  );
  let session: CDPSession | null = null;
  try {
    const browser = context.browser();
    if (browser === null) throw new Error("Playwright did not expose the launched browser");
    session = await browser.newBrowserCDPSession();
    const version = (await session.send("Browser.getVersion")) as {
      jsVersion: string;
      product: string;
      revision: string;
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
    await page.goto(probeUrl, { waitUntil: "load" });
    assertHarnessNavigationUrl(page.url(), probeUrl, "flythrough identity probe");
    let adapter: WebGpuAdapterIdentity | null = null;
    let adapterFailure: string | null = null;
    try {
      adapter = await readWebGpuAdapterIdentity(page);
    } catch (error) {
      adapterFailure = `WebGPU adapter identity unavailable: ${errorMessage(error)}`;
    }
    let browserDisplay: BrowserDisplayIdentity | null = null;
    let displayFailure: string | null = null;
    try {
      browserDisplay = await readBrowserDisplayIdentity(context, page);
    } catch (error) {
      displayFailure = `Browser display identity unavailable: ${errorMessage(error)}`;
    }
    const browserCommandLine = await readChromeCommandLine(context);
    const sandboxVerified = validateChromeSandboxCommandLine(browserCommandLine);
    const hostResult = await hostResultPromise;
    const host = hostResult.state === "measured" ? hostResult.host : null;
    const failures = [
      ...(machineFailure === null ? [] : [machineFailure]),
      ...(hostResult.state === "invalid" ? [hostResult.reason] : []),
      ...(adapterFailure === null ? [] : [adapterFailure]),
      ...(displayFailure === null ? [] : [displayFailure]),
    ];
    const gateIdentity =
      machine === null || host === null || adapter === null || browserDisplay === null
        ? invalidEnvironmentGate(failures)
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
      executableSha256: await validateChromeExecutable(chromePin, executablePath),
      gateIdentity,
      gpuDevices: systemInfo.gpu.devices,
      host,
      hostAfterRuns: null,
      identityProbeBrowserCommandLine: browserCommandLine,
      jsVersion: version.jsVersion,
      machine,
      machineId: machine?.id ?? machineId,
      requestedTier: tier,
      sandboxVerified,
      target,
      targetPostflight: failedTargetEvidence("Serving target postflight has not run"),
      targetPreflight: verifiedTargetEvidence(target),
      targetDisplayMode: QUALITY_TIER_PROFILES[tier].targetDisplayMode,
    });
  } finally {
    await session?.detach().catch(() => undefined);
    await context.close();
  }
}

async function inspectMeasuredEnvironment(
  context: BrowserContext,
  page: Page,
  hostBefore: WindowsHostIdentity,
  browserDisplayAfter: BrowserDisplayIdentity | null,
  hostAfter: WindowsHostIdentity | null,
): Promise<MeasuredFlythroughEnvironment> {
  const browser = context.browser();
  if (browser === null) throw new Error("Playwright did not expose the measured browser");
  const session = await browser.newBrowserCDPSession();
  try {
    const version = (await session.send("Browser.getVersion")) as {
      jsVersion: string;
      product: string;
      revision: string;
      userAgent: string;
    };
    const systemInfo = (await session.send("SystemInfo.getInfo")) as {
      gpu: { devices: readonly CdpGpuDevice[] };
    };
    const browserCommandLine = await readChromeCommandLine(context);
    const sandboxVerified = validateChromeSandboxCommandLine(browserCommandLine);
    return Object.freeze({
      adapter: await readWebGpuAdapterIdentity(page),
      browserCommandLine,
      browserDisplayAfter,
      browserDisplayBefore: await readBrowserDisplayIdentity(context, page),
      browserProduct: version.product,
      browserRevision: version.revision,
      browserUserAgent: version.userAgent,
      gpuDevices: systemInfo.gpu.devices,
      hostAfter,
      hostBefore,
      jsVersion: version.jsVersion,
      sandboxVerified,
    });
  } finally {
    await session.detach().catch(() => undefined);
  }
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
    const first = await queryHistograms(session);
    await delay(SMOKE_TRACE_QUIESCE_MS);
    await refresh.click();
    await delay(SMOKE_TRACE_QUIESCE_MS);
    const second = await queryHistograms(session);
    if (JSON.stringify(first) !== JSON.stringify(second)) {
      throw new Error(
        "Dawn cache histograms were unstable across subprocess histogram synchronization",
      );
    }
    return second;
  } finally {
    await session.detach();
    await page?.close();
  }
}

async function queryHistograms(session: CDPSession): Promise<readonly DawnHistogram[]> {
  const result = (await session.send("Browser.getHistograms", {
    delta: false,
    query: D3D12_HISTOGRAM_PREFIX,
  })) as { histograms: readonly DawnHistogram[] };
  return Object.freeze(
    result.histograms
      .filter((histogram) => !histogram.name.endsWith(".90SecondsPostStartup"))
      .map((histogram) =>
        Object.freeze({ count: histogram.count, name: histogram.name, sum: histogram.sum }),
      )
      .sort((left, right) => left.name.localeCompare(right.name)),
  );
}

async function installLongTaskObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let count = 0;
    const observer = new PerformanceObserver((list) => {
      count += list.getEntries().filter((entry) => entry.duration > 50).length;
    });
    observer.observe({ buffered: true, type: "longtask" } as unknown as PerformanceObserverInit);
    Object.defineProperty(globalThis, "__PARALLAX_FLYTHROUGH_LONG_TASKS__", {
      value: {
        count: () => {
          count += observer.takeRecords().filter((entry) => entry.duration > 50).length;
          return count;
        },
        reset: () => {
          observer.takeRecords();
          count = 0;
        },
      },
    });
  });
}

function resetLongTaskObserver(page: Page): Promise<void> {
  return page.evaluate(() => {
    (Reflect.get(globalThis, "__PARALLAX_FLYTHROUGH_LONG_TASKS__") as { reset(): void }).reset();
  });
}

function readMainThreadLongTasks(page: Page): Promise<number> {
  return page.evaluate(() =>
    (Reflect.get(globalThis, "__PARALLAX_FLYTHROUGH_LONG_TASKS__") as { count(): number }).count(),
  );
}

async function revalidateEnvironment(
  environment: EnvironmentIdentity,
): Promise<EnvironmentIdentity> {
  const hostResult = await tryReadWindowsHostIdentity();
  const hostAfterRuns = hostResult.state === "measured" ? hostResult.host : null;
  const failures =
    environment.gateIdentity.state === "measured" ? [] : [...environment.gateIdentity.reasons];
  if (hostResult.state === "invalid") {
    failures.push(hostResult.reason);
  } else if (
    environment.host === null ||
    JSON.stringify(environment.host) !== JSON.stringify(hostResult.host)
  ) {
    failures.push("Host OS/GPU/display/power identity changed during the flythrough sequence");
  }
  return Object.freeze({
    ...environment,
    gateIdentity:
      failures.length === 0 ? environment.gateIdentity : invalidEnvironmentGate(failures),
    hostAfterRuns,
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
  const failures =
    environment.gateIdentity.state === "measured" ? [] : [...environment.gateIdentity.reasons];
  return Object.freeze({
    ...environment,
    gateIdentity: invalidEnvironmentGate([...failures, reason]),
  });
}

function collectP95Variance(runs: readonly FlythroughRun[]): readonly P95VarianceEvidence[] {
  return Object.freeze([
    varianceEvidence(
      "renderWorkerCallbackIntervalP95Ms",
      "Render-worker requestAnimationFrame callback spacing is a non-presentation heuristic under RE-006/D-051.",
      runs.map((run) => run.evidence.render.callbackIntervalMs.p95),
    ),
    varianceEvidence(
      "renderWorkerRenderDurationP95Ms",
      "Render-worker CPU render duration is a diagnostic, not player-visible presentation.",
      runs.map((run) => run.evidence.render.renderDurationMs.p95),
    ),
    varianceEvidence(
      "streamingCellLoadP95Ms",
      "Representative OPFS-to-GPU cell-load p95 is a current flythrough budget input.",
      runs.map((run) => run.streaming.cellLoadP95Ms),
    ),
  ]);
}

function varianceEvidence(
  metric: string,
  note: string,
  values: readonly number[],
): P95VarianceEvidence {
  return Object.freeze({
    metric,
    note,
    variance: evaluateP95Variance(values, FLYTHROUGH_D1_REPEATS),
  });
}

function flythroughEvidenceChecks(
  runs: readonly FlythroughRun[],
  p95Variance: readonly P95VarianceEvidence[],
  runFailure: string | null,
  reportFinalization: FinalizationEvidence,
) {
  const complete = runs.length === FLYTHROUGH_D1_REPEATS && runFailure === null;
  const dawnMeasured = complete && runs.every((run) => run.dawnPipeline.state === "measured");
  const varianceMeasured =
    p95Variance.length === 3 && p95Variance.every((metric) => metric.variance.state === "measured");
  const checks = [
    evidenceCheck(
      "scenario completion",
      complete,
      runFailure ?? `completed ${runs.length}/${FLYTHROUGH_D1_REPEATS} repeats`,
    ),
    evidenceCheck(
      "report finalization",
      reportFinalization.state === "measured",
      reportFinalization.reason ?? "",
    ),
    evidenceCheck("ordered environment-state coverage", complete),
    evidenceCheck("streamed-residency presentation ownership", complete),
    evidenceCheck("rendered checkpoint output", complete),
    evidenceCheck("render-worker full-window callback aggregate", complete),
    evidenceCheck("world streaming pipeline", complete),
    evidenceCheck("main-thread long tasks", complete),
    evidenceCheck("all-worker JS heap", complete),
    evidenceCheck("Dawn pipeline compile/cache evidence", dawnMeasured),
    evidenceCheck(
      "repeat p95 variance",
      varianceMeasured,
      p95Variance
        .flatMap((metric) =>
          metric.variance.state === "invalid"
            ? [`${metric.metric}: ${metric.variance.reason}`]
            : [],
        )
        .join(" | "),
    ),
  ];
  const names = checks.map((check) => check.description.split(": ", 1)[0]);
  if (
    names.length !== FLYTHROUGH_D1_MANDATORY_METRICS.length ||
    FLYTHROUGH_D1_MANDATORY_METRICS.some((metric) => !names.includes(metric))
  ) {
    throw new Error("Flythrough evidence checks drifted from the mandatory metric registry");
  }
  return Object.freeze(checks);
}

function evidenceCheck(name: string, measured: boolean, reason = "") {
  return Object.freeze({
    description: measured || reason === "" ? name : `${name}: ${reason}`,
    mandatory: true,
    measured,
  });
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

function flythroughBudgetCoverage() {
  return Object.freeze({
    claim:
      "Budget facet covers only the listed authoritative flythrough metric set. Under D-115, M1 zero-violation means zero violations among evaluated mandatory metrics; unsupported standing metrics remain unqualified, not passed.",
    completeStandingBudgetCoverage: false,
    evaluated: Object.freeze([
      "all-realm JS heap high-water during the full route",
      "main-thread long tasks during the full route",
      "representative streaming cell-load p95",
      "Dawn pipeline creation overlapping the route",
      "D3D12 shader compilation overlapping the route",
    ]),
    omitted: Object.freeze([
      "Compositor presentation p50/p95/p99.9/max is unqualified under D-115/RE-006: smoke records informational invalid while D-114's provider inventory records unsupported. Callback cadence is not a substitute, so M1 makes no player-visible frame-budget claim.",
      "Combined CPU resident memory and page-attributed GPU residency are unsupported. This runner gates all-realm V8 used heap only; smoke's fixed synthetic Wasm/SAB sizes and logical streaming bytes are neither representative nor additive residency.",
      "Worker long tasks remain unsupported through the Window-scoped Long Tasks API; only main-thread long tasks are gated.",
      "Visible pop-in visual diff is deferred to M5 representative art; checkpoint captures prove streamed ownership and non-blank output only.",
      "D1-to-D2 transition budgets are M4 scope, outside this D1-only scenario.",
    ]),
  });
}

function formatReport(
  report: Readonly<{
    artifactDigest: string;
    attempts: readonly FlythroughAttempt<FlythroughRun>[];
    budgetCoverage: ReturnType<typeof flythroughBudgetCoverage>;
    evidenceFailures: readonly string[];
    environment: EnvironmentIdentity;
    facets: ResultFacets;
    passed: boolean;
    releaseDigest: string;
    scenario: string;
  }>,
): string {
  const runs = report.attempts.flatMap((attempt) =>
    attempt.state === "measured" && attempt.result !== null ? [attempt.result] : [],
  );
  return `${[
    `# ${report.scenario} regression report`,
    "",
    `- Result: **${report.passed ? "PASS" : "FAIL"}**`,
    `- Build artifact: \`${report.artifactDigest}\``,
    `- Install release: \`${report.releaseDigest}\``,
    `- Serving target: **${report.environment.target.kind}** \`${report.environment.target.origin}\``,
    `- Target preflight: **${formatTargetVerificationEvidence(report.environment.targetPreflight)}**`,
    `- Target postflight: **${formatTargetVerificationEvidence(report.environment.targetPostflight)}**`,
    `- Completed repeats: ${runs.length}/${FLYTHROUGH_D1_REPEATS}`,
    `- Started attempts: ${report.attempts.length}/${FLYTHROUGH_D1_REPEATS}`,
    `- Environment facet: **${report.facets.environment.status}**`,
    `- Evidence facet: **${report.facets.evidenceCompleteness.status}**`,
    `- Budget facet: **${report.facets.budgetEvaluation.status}** (${report.facets.budgetEvaluation.evaluatedChecks} current-set checks)`,
    `- Standing-budget coverage complete: **${report.budgetCoverage.completeStandingBudgetCoverage ? "yes" : "no"}**`,
    "",
    "## Runs",
    "",
    ...runs.map(
      (run) =>
        `- Repeat ${run.repeat}: ${run.evidence.render.frameCount.toLocaleString(
          "en-US",
        )} frames; callback p95 ${run.evidence.render.callbackIntervalMs.p95.toFixed(
          3,
        )} ms; ${run.streaming.measurementCellLoadSamples.length} in-window cell loads; streaming p95 ${run.streaming.cellLoadP95Ms.toFixed(
          3,
        )} ms (OPFS wait ${run.streaming.cellLoadAttributionP95.opfsWaitMs.toFixed(
          3,
        )}, decode wait ${run.streaming.cellLoadAttributionP95.decodeWaitMs.toFixed(
          3,
        )}, transaction wait ${run.streaming.cellLoadAttributionP95.renderTransactionWaitMs.toFixed(
          3,
        )}, transaction round trip ${run.streaming.cellLoadAttributionP95.renderTransactionRoundTripMs.toFixed(
          3,
        )}, worker remainder ${run.streaming.cellLoadAttributionP95.streamingWorkerRemainderMs.toFixed(
          3,
        )} ms p95); ${run.streaming.opfsAccessHandleCount}/${run.streaming.opfsPackageCount} startup-open OPFS handles in ${run.streaming.opfsAccessHandleOpenDurationMs.toFixed(
          3,
        )} ms; ${run.evidence.checkpointEvidence.length} rendered checkpoints; ${run.mainThreadLongTasksOver50Ms} main-thread long tasks`,
    ),
    ...report.attempts
      .filter((attempt) => attempt.state === "invalid")
      .map(
        (attempt) =>
          `- Repeat ${attempt.repeat}: invalid — ${attempt.failureMessage ?? "unknown failure"}; trace diagnostics ${attempt.traceDrain === null ? "unavailable" : `${attempt.traceDrain.eventCount} events/${attempt.traceDrain.dataChunkCount} chunks`}; heap evidence ${attempt.jsHeap?.state ?? "unavailable"}`,
      ),
    "",
    "## Evidence failures",
    "",
    ...(report.evidenceFailures.length === 0
      ? ["- None"]
      : report.evidenceFailures.map((failure) => `- ${failure}`)),
    "",
    "## Budget scope",
    "",
    `- ${report.budgetCoverage.claim}`,
    ...report.budgetCoverage.omitted.map((omission) => `- Omitted: ${omission}`),
    "",
  ].join("\n")}\n`;
}

function formatNullableMilliseconds(value: number | null): string {
  return value === null ? "not observed" : `${value.toFixed(1)} ms`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
}

async function readExpectedNodeVersion(root: string): Promise<string> {
  const nvmVersion = (await readFile(join(root, ".nvmrc"), "utf8")).trim().replace(/^v/, "");
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    engines?: { node?: unknown };
  };
  const packageVersion = packageJson.engines?.node;
  if (typeof packageVersion !== "string" || packageVersion !== nvmVersion) {
    throw new Error(
      `Node pin mismatch between .nvmrc ${nvmVersion} and package engines ${String(packageVersion)}`,
    );
  }
  return nvmVersion;
}
