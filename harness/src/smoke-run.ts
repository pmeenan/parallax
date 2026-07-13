import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ParallaxTelemetryExport, ParallaxTelemetrySnapshot } from "@parallax/engine";
import { type BrowserContext, chromium, type Page } from "playwright-core";
import {
  type Distribution,
  distribution,
  evaluateP95Variance,
  type VarianceMetric,
} from "./aggregate.js";
import { type BudgetCheck, evaluateMainThreadBudgets, type QualityTier } from "./budgets.js";
import { readAndValidateBuildManifest, sha256File } from "./build-manifest.js";
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
  type ChromeTraceEvent,
  extractVizPresentationFeedbackCallbackIntervalsMs,
  PRESENTATION_TRACE_CATEGORY,
  PRESENTATION_TRACE_END_MARKER,
  PRESENTATION_TRACE_START_MARKER,
  withTimeout,
} from "./presentation-trace.js";
import {
  parseQualityTier,
  QUALITY_TIER_PROFILES,
  renderSurfaceMismatch,
  SMOKE_INCOMPLETE_METRICS,
  SMOKE_MEASUREMENT_FRAMES,
  SMOKE_METRICS,
  SMOKE_PRESENTATION_TRACE_COMPLETION_TIMEOUT_MS,
  SMOKE_PRESENTATION_TRACE_TAIL_MS,
  SMOKE_REPEATS,
  SMOKE_SCENARIO,
  SMOKE_TELEMETRY_GLOBAL_NAME,
  SMOKE_TELEMETRY_SCHEMA_VERSION,
  SMOKE_WARMUP_MS,
  type SmokeMetricDefinition,
} from "./runs/smoke.js";
import {
  createLocalServer,
  type LocalServerMetrics,
  listenLocalServer,
  stopLocalServer,
} from "./server.js";
import { readSourceIdentity, type SourceIdentity } from "./source-identity.js";

interface MeasuredMetric<T> {
  readonly state: "measured";
  readonly value: T;
}

type ProbeResult<T> =
  | Readonly<{ readonly state: "measured"; readonly value: T }>
  | Readonly<{ readonly reason: string; readonly state: "invalid" }>;

interface P95VarianceSummary {
  readonly profile: "fresh" | "warm";
  readonly reason?: string;
  readonly relativeP95Range: number;
  readonly state: "invalid" | "measured";
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
  readonly http: MeasuredMetric<LocalServerMetrics>;
  readonly jsHeapUsedBytes: MeasuredMetric<number>;
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
  readonly workerInitToFirstFrameMs: MeasuredMetric<number>;
  readonly workerStartupToFirstFrameMs: MeasuredMetric<number>;
  readonly vizPresentationFeedbackCallbackIntervalMs: ProbeResult<Distribution>;
}

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
  readonly generatedAt: string;
  readonly incompleteMetrics: readonly {
    readonly mandatoryForHarnessV1: boolean;
    readonly metric: string;
    readonly reason: string;
    readonly state: "invalid";
  }[];
  readonly mandatoryMetricSet: {
    readonly metrics: readonly string[];
    readonly version: 1;
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
  readonly schemaVersion: 3;
  readonly source: SourceIdentity;
  readonly callbackPacingVariance: readonly P95VarianceSummary[];
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
  const artifactDigest = (await readAndValidateBuildManifest(buildRoot)).artifactDigest;
  const source = await readSourceIdentity(repositoryRoot);
  const server = createLocalServer({ root: buildRoot });
  const address = await listenLocalServer(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;
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
    const runs: RunMeasurement[] = [];
    for (let repeat = 1; repeat <= SMOKE_REPEATS; repeat += 1) {
      const lineage = join(profileRoot, `lineage-${repeat}`);
      runs.push(
        await measureRun(executablePath, lineage, baseUrl, repeat, "fresh"),
        await measureRun(executablePath, lineage, baseUrl, repeat, "warm"),
      );
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
    const passed =
      runs.every((run) => run.budgetChecks.every((check) => check.passed)) &&
      environment.gateIdentity.state === "measured" &&
      incompleteMetrics.every((metric) => !metric.mandatoryForHarnessV1) &&
      callbackPacingVariance.every((metric) => metric.state === "measured");
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
      generatedAt: new Date().toISOString(),
      incompleteMetrics,
      mandatoryMetricSet: Object.freeze({
        metrics: Object.freeze(
          SMOKE_METRICS.filter((metric) => metric.mandatoryForHarnessV1).map(
            (metric) => metric.name,
          ),
        ),
        version: 1,
      }),
      passed,
      runs,
      scenario: SMOKE_SCENARIO,
      schemaVersion: 3,
      source,
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
  try {
    const browser = context.browser();
    if (browser === null) throw new Error("Playwright did not expose the launched browser");
    const session = await browser.newBrowserCDPSession();
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
): Promise<RunMeasurement> {
  const before = await fetchServerMetrics(baseUrl);
  const context = await launch(executablePath, profilePath);
  const page = context.pages()[0] ?? (await context.newPage());
  const errors: string[] = [];
  let presentationTrace: PresentationTraceCapture | null = null;
  let presentationTraceFailure: string | null = null;
  const markPresentationBoundary = async (boundary: "start" | "end"): Promise<void> => {
    if (presentationTrace === null) return;
    const trace = presentationTrace;
    const markerResult = await tryProbe(`Viz presentation-feedback ${boundary} marker`, () =>
      boundary === "start" ? trace.markStart(page) : trace.markEnd(page),
    );
    if (markerResult.state === "invalid") {
      presentationTraceFailure = await discardFailedPresentationTrace(trace, markerResult.reason);
      presentationTrace = null;
    }
  };
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await installLongTaskObserver(page);
  try {
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
    const traceStartResult = await tryProbe("Viz presentation-feedback trace start", () =>
      beginPresentationTrace(context),
    );
    if (traceStartResult.state === "measured") {
      presentationTrace = traceStartResult.value;
    } else {
      presentationTraceFailure = traceStartResult.reason;
    }
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
    const session = await context.newCDPSession(page);
    await session.send("Performance.enable");
    const performanceMetrics = (await session.send("Performance.getMetrics")) as {
      metrics: readonly { name: string; value: number }[];
    };
    const jsHeapUsedBytes = performanceMetrics.metrics.find(
      (metric) => metric.name === "JSHeapUsedSize",
    )?.value;
    if (jsHeapUsedBytes === undefined) throw new Error("CDP did not report JSHeapUsedSize");
    if (presentationTrace !== null) {
      await page.waitForTimeout(SMOKE_PRESENTATION_TRACE_TAIL_MS);
    }
    const traceToFinish = presentationTrace;
    const vizPresentationFeedbackCallbackIntervalMs =
      traceToFinish === null
        ? Object.freeze({
            reason: presentationTraceFailure ?? "Viz presentation-feedback trace is unavailable",
            state: "invalid" as const,
          })
        : await tryProbe("Viz presentation-feedback callback intervals", async () =>
            distribution(await traceToFinish.finish()),
          );
    if (errors.length > 0) throw new Error(`Browser errors: ${errors.join(" | ")}`);
    const workerAnimationCallbackIntervalMs = distribution(presentIntervals);
    return Object.freeze({
      budgetChecks: evaluateMainThreadBudgets(mainThreadLongTasks),
      browserDisplayAfter,
      browserDisplayBefore,
      cpuFrameMs: measured(distribution(frames.map((frame) => frame.durationMs))),
      http: measured(subtractServerMetrics(await fetchServerMetrics(baseUrl), before)),
      jsHeapUsedBytes: measured(jsHeapUsedBytes),
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
      workerInitToFirstFrameMs: measured(requiredNumber(snapshot.render.workerInitToFirstFrameMs)),
      workerStartupToFirstFrameMs: measured(
        requiredNumber(snapshot.render.workerStartupToFirstFrameMs),
      ),
      workerAnimationCallbackIntervalMs: measured(workerAnimationCallbackIntervalMs),
      vizPresentationFeedbackCallbackIntervalMs,
    });
  } finally {
    try {
      if (presentationTrace !== null) {
        const trace = presentationTrace;
        await tryProbe("Viz presentation-feedback trace cleanup", () => trace.discard());
      }
    } finally {
      await context.close();
    }
  }
}

async function discardFailedPresentationTrace(
  trace: PresentationTraceCapture,
  failure: string,
): Promise<string> {
  const discardResult = await tryProbe("Viz presentation-feedback trace cleanup", () =>
    trace.discard(),
  );
  return discardResult.state === "invalid" ? `${failure} | ${discardResult.reason}` : failure;
}

interface PresentationTraceCapture {
  discard(): Promise<void>;
  finish(): Promise<readonly number[]>;
  markEnd(page: Page): Promise<void>;
  markStart(page: Page): Promise<void>;
}

async function beginPresentationTrace(context: BrowserContext): Promise<PresentationTraceCapture> {
  const browser = context.browser();
  if (browser === null) throw new Error("Playwright did not expose the launched browser");
  const session = await browser.newBrowserCDPSession();
  const events: ChromeTraceEvent[] = [];
  let active = true;
  let endMarked = false;
  session.on("Tracing.dataCollected", (event) => {
    for (const traceEvent of event.value as unknown as readonly ChromeTraceEvent[]) {
      events.push(traceEvent);
    }
  });
  const completed = new Promise<{ dataLossOccurred: boolean }>(
    (resolveComplete, rejectComplete) => {
      session.once("Tracing.tracingComplete", resolveComplete);
      session.once("close", () => rejectComplete(new Error("Viz callback CDP session closed")));
    },
  );
  void completed.catch(() => undefined);
  try {
    await session.send("Tracing.start", {
      traceConfig: {
        includedCategories: [PRESENTATION_TRACE_CATEGORY, "blink.user_timing"],
        recordMode: "recordAsMuchAsPossible",
      },
      transferMode: "ReportEvents",
    });
  } catch (error) {
    await session.detach().catch(() => undefined);
    throw error;
  }

  const stop = async (): Promise<{ dataLossOccurred: boolean }> => {
    if (!active) throw new Error("Viz callback trace was already stopped");
    active = false;
    try {
      return await withTimeout(
        (async () => {
          await session.send("Tracing.end");
          return completed;
        })(),
        SMOKE_PRESENTATION_TRACE_COMPLETION_TIMEOUT_MS,
        "Viz callback trace end/completion",
      );
    } finally {
      await session.detach().catch(() => undefined);
    }
  };
  return Object.freeze({
    async discard(): Promise<void> {
      if (active) await stop();
    },
    async finish(): Promise<readonly number[]> {
      if (!endMarked) throw new Error("Viz callback trace ended before its measurement marker");
      const result = await stop();
      if (result.dataLossOccurred) throw new Error("Chrome reported Viz callback trace data loss");
      return extractVizPresentationFeedbackCallbackIntervalsMs(events);
    },
    async markEnd(page: Page): Promise<void> {
      if (endMarked) throw new Error("Viz callback trace end was marked more than once");
      await markPresentationTrace(page, PRESENTATION_TRACE_END_MARKER);
      endMarked = true;
    },
    markStart(page: Page): Promise<void> {
      return markPresentationTrace(page, PRESENTATION_TRACE_START_MARKER);
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
  const failures = report.runs.flatMap((run) =>
    run.budgetChecks
      .filter((check) => !check.passed)
      .map(
        (check) =>
          `${run.profile} repeat ${run.repeat}: ${check.metric} ${check.actual} > ${check.limit}`,
      ),
  );
  failures.push(
    ...(report.environment.gateIdentity.state === "invalid"
      ? report.environment.gateIdentity.reasons.map(
          (reason) => `verified gate environment identity: invalid (${reason})`,
        )
      : []),
  );
  failures.push(
    ...report.incompleteMetrics
      .filter((metric) => metric.mandatoryForHarnessV1)
      .map((metric) => `${metric.metric}: ${metric.state} (${metric.reason})`),
  );
  failures.push(
    ...report.callbackPacingVariance
      .filter((metric) => metric.state === "invalid")
      .map((metric) => `${metric.profile} callback pacing variance: ${metric.reason}`),
  );
  const lines = [
    `# Parallax ${report.scenario}`,
    "",
    `Verdict: **${report.passed ? "PASS" : "FAIL"}**`,
    `Artifact: \`${report.artifactDigest}\``,
    `Chrome: \`${report.environment.browserProduct}\``,
    "",
    "## Failures",
    "",
    ...(failures.length === 0 ? ["None."] : failures.map((failure) => `- ${failure}`)),
    "",
  ];
  await writeFile(join(outputRoot, `${stem}.md`), lines.join("\n"));
  console.log(lines.join("\n"));
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
