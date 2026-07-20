import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type Memory64SpikeTelemetrySnapshot,
  type ParallaxTelemetryExport,
  TELEMETRY_GLOBAL_NAME,
  TELEMETRY_SCHEMA_VERSION,
} from "@parallax/engine";
import type { CDPSession, Page } from "playwright-core";
import {
  type Distribution,
  distribution,
  evaluateP95Variance,
  evaluateRelativeVariance,
  type VarianceMetric,
} from "./aggregate.js";
import {
  readBrowserDisplayIdentity,
  readChromeCommandLine,
  readChromeDisplayRefreshRates,
  readWebGpuAdapterIdentity,
} from "./browser-probes.js";
import type { QualityTier } from "./budgets.js";
import { readAndValidateBuildManifest } from "./build-manifest.js";
import {
  type ChromePin,
  launchPersistentChrome,
  loadChromePin,
  resolveChromeExecutablePath,
  validateChromeExecutable,
  validateChromeSandboxCommandLine,
} from "./chrome-pin.js";
import {
  type BrowserDisplayIdentity,
  type CdpGpuDevice,
  type EnvironmentGateState,
  evaluateBrowserDisplay,
  evaluateGateEnvironment,
  invalidEnvironmentGate,
  loadMachineDescriptor,
  type MachineDescriptor,
  safeMachineIdForFilename,
  tryReadWindowsHostIdentity,
  type WebGpuAdapterIdentity,
  type WindowsHostIdentity,
  type WindowsHostIdentityResult,
} from "./environment.js";
import {
  type Memory64SpikeMetric,
  pairedRatioDistribution,
  resolveMemory64SpikeMetric,
} from "./memory64-spike.js";
import {
  MEMORY64_SPIKE_COMPLETION_TIMEOUT_MS,
  MEMORY64_SPIKE_REPEATS,
  MEMORY64_SPIKE_REPORT_SCHEMA_VERSION,
  MEMORY64_SPIKE_SCENARIO,
} from "./runs/memory64-spike.js";
import { parseQualityTier, QUALITY_TIER_PROFILES, renderSurfaceMismatch } from "./runs/smoke.js";
import { createLocalServer, listenLocalServer, stopLocalServer } from "./server.js";
import { readSourceIdentity, type SourceIdentity } from "./source-identity.js";
import { readTelemetry } from "./telemetry.js";
import { errorMessage } from "./value-utils.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const buildRoot = join(repositoryRoot, "dist");
const chromePinPath = join(repositoryRoot, "harness/chrome/stable.json");
const machineRoot = join(repositoryRoot, "harness/machines");
const outputRoot = join(repositoryRoot, "harness/results");

interface Memory64EnvironmentIdentity {
  readonly adapter: WebGpuAdapterIdentity | null;
  readonly browserDisplay: BrowserDisplayIdentity | null;
  readonly browserProduct: string | null;
  readonly browserRevision: string | null;
  readonly browserUserAgent: string | null;
  readonly commandLine: string | null;
  readonly executableSha256: string;
  readonly gate: EnvironmentGateState;
  readonly gpuDevices: readonly CdpGpuDevice[];
  readonly host: WindowsHostIdentity | null;
  readonly hostAfterRuns: WindowsHostIdentity | null;
  readonly jsVersion: string | null;
  readonly machine: MachineDescriptor | null;
  readonly machineId: string;
  readonly qualityTier: QualityTier;
  readonly sandboxVerified: boolean;
  readonly targetDisplayMode: string;
}

interface Memory64RunMeasurement {
  readonly browserDisplayAfter: BrowserDisplayIdentity | null;
  readonly browserDisplayBefore: BrowserDisplayIdentity | null;
  readonly errors: readonly string[];
  readonly metric: Memory64SpikeMetric;
  readonly profile: "fresh" | "warm";
  readonly renderSurfaceAfter: RenderSurface | null;
  readonly renderSurfaceBefore: RenderSurface | null;
  readonly renderSurfaceChanges: readonly RenderSurface[];
  readonly repeat: number;
}

type RenderSurface = Readonly<{ readonly height: number; readonly width: number }>;

interface VariantSummary {
  readonly coldCompileMs: Distribution;
  readonly compileMs: Distribution;
  readonly instantiateMs: Distribution;
  readonly kernelMs: Distribution;
  readonly moduleBytes: number;
  readonly prepareMs: Distribution;
}

interface PerRunSummary {
  readonly highGrowAndTouchMs: number;
  readonly memory32: VariantSummary;
  readonly memory64: VariantSummary;
  readonly pairedRatios: Readonly<{
    readonly compile: Distribution;
    readonly instantiate: Distribution;
    readonly kernel: Distribution;
    readonly prepare: Distribution;
  }>;
  readonly profile: Memory64RunMeasurement["profile"];
  readonly repeat: number;
}

interface CostVarianceEvidence {
  readonly metric: "compile" | "instantiate" | "kernel" | "prepare";
  readonly profile: Memory64RunMeasurement["profile"];
  readonly repeatP95Ms: readonly number[];
  readonly variance: VarianceMetric;
  readonly variant: "memory32" | "memory64";
}

interface PairedCostVarianceEvidence {
  readonly metric: CostVarianceEvidence["metric"];
  readonly profile: Memory64RunMeasurement["profile"];
  readonly repeatP95Ratios: readonly number[];
  readonly variance: VarianceMetric;
}

interface Memory64SpikeReport {
  readonly artifactDigest: string;
  readonly chromePin: ChromePin;
  readonly environment: Memory64EnvironmentIdentity;
  readonly generatedAt: string;
  readonly overheadRatios: Readonly<{
    readonly compileP50: number | null;
    readonly instantiateP50: number | null;
    readonly kernelP50: number | null;
    readonly moduleBytes: number;
    readonly prepareP50: number | null;
  }> | null;
  readonly passed: boolean;
  readonly perRunSummaries: readonly PerRunSummary[] | null;
  readonly runs: readonly Memory64RunMeasurement[];
  readonly scenario: typeof MEMORY64_SPIKE_SCENARIO;
  readonly schemaVersion: typeof MEMORY64_SPIKE_REPORT_SCHEMA_VERSION;
  readonly source: SourceIdentity;
  readonly summaries: Readonly<{
    readonly memory32: VariantSummary;
    readonly memory64: VariantSummary;
  }> | null;
  readonly variance: Readonly<{
    readonly absoluteEvidence: readonly CostVarianceEvidence[];
    readonly absoluteReasons: readonly string[];
    readonly absoluteState: "invalid" | "measured";
    readonly pairedEvidence: readonly PairedCostVarianceEvidence[];
    readonly pairedReasons: readonly string[];
    readonly pairedState: "invalid" | "measured";
  }>;
}

export async function runMemory64SpikeEntrypoint(): Promise<void> {
  try {
    await main();
  } catch (error: unknown) {
    console.error(`Memory64 spike failed: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const machineId = requiredEnvironment("PARALLAX_MACHINE_ID");
  const tier = parseQualityTier(process.env.PARALLAX_TIER);
  const chromePin = await loadChromePin(chromePinPath);
  const executablePath = await resolveChromeExecutablePath(repositoryRoot, chromePin);
  const executableSha256 = await validateChromeExecutable(chromePin, executablePath);
  const validatedBuild = await readAndValidateBuildManifest(buildRoot);
  const source = await readSourceIdentity(repositoryRoot);
  const server = createLocalServer({ root: buildRoot });
  const address = await listenLocalServer(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const profileRoot = await mkdtemp(join(tmpdir(), "parallax-memory64-"));
  try {
    let environment = await inspectEnvironment(
      executablePath,
      join(profileRoot, "identity"),
      chromePin,
      executableSha256,
      machineId,
      tier,
      baseUrl,
    );
    const runs: Memory64RunMeasurement[] = [];
    for (let repeat = 1; repeat <= MEMORY64_SPIKE_REPEATS; repeat += 1) {
      const lineage = join(profileRoot, `lineage-${repeat}`);
      for (const profile of ["fresh", "warm"] as const) {
        runs.push(await measureRun(executablePath, lineage, baseUrl, repeat, profile));
      }
    }
    environment = revalidateRunDisplays(environment, runs);
    environment = revalidateHostEnvironment(environment, await tryReadWindowsHostIdentity());
    const perRunSummaries = summarizeEachRun(runs);
    const summaries = summarizeRuns(perRunSummaries);
    const overheadRatios = compareRuns(perRunSummaries);
    const variance = evaluateCostVariance(perRunSummaries);
    const passed =
      environment.gate.state === "measured" &&
      runs.length === MEMORY64_SPIKE_REPEATS * 2 &&
      runs.every((run) => run.metric.state === "measured" && run.errors.length === 0) &&
      variance.pairedState === "measured";
    if (
      (await readAndValidateBuildManifest(buildRoot)).artifactDigest !==
      validatedBuild.artifactDigest
    ) {
      throw new Error("Built artifact identity changed during the memory64 run");
    }
    if (JSON.stringify(await readSourceIdentity(repositoryRoot)) !== JSON.stringify(source)) {
      throw new Error("Source identity changed during the memory64 run");
    }
    const report: Memory64SpikeReport = Object.freeze({
      artifactDigest: validatedBuild.artifactDigest,
      chromePin,
      environment,
      generatedAt: new Date().toISOString(),
      overheadRatios,
      passed,
      perRunSummaries,
      runs: Object.freeze(runs),
      scenario: MEMORY64_SPIKE_SCENARIO,
      schemaVersion: MEMORY64_SPIKE_REPORT_SCHEMA_VERSION,
      source,
      summaries,
      variance,
    });
    await writeReport(report);
    console.log(formatReport(report));
    process.exitCode = passed ? 0 : 1;
  } finally {
    await rm(profileRoot, { force: true, recursive: true });
    await stopLocalServer(server);
  }
}

async function measureRun(
  executablePath: string,
  profilePath: string,
  baseUrl: string,
  repeat: number,
  profile: Memory64RunMeasurement["profile"],
): Promise<Memory64RunMeasurement> {
  const errors: string[] = [];
  const context = await launchPersistentChrome(executablePath, profilePath);
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`${baseUrl}?memory64Spike=dedicated`, { waitUntil: "load" });
    await installSurfaceObserver(page);
    // D-034: finish the privileged chrome://gpu diagnostic before full app warmup and
    // never enable developer WebGPU features on a measurement browser.
    const refreshRatesHz = await readChromeDisplayRefreshRates(context);
    await page.waitForFunction(
      ({ globalName, schemaVersion }) => {
        const telemetry = Reflect.get(globalThis, globalName) as
          | ParallaxTelemetryExport
          | undefined;
        if (telemetry === undefined) return false;
        const snapshot = telemetry.snapshot();
        if (snapshot.schemaVersion !== schemaVersion) {
          throw new Error(
            `Telemetry schema mismatch: expected ${schemaVersion}, received ${snapshot.schemaVersion}`,
          );
        }
        if (snapshot.render.state === "failed") {
          throw new Error(snapshot.render.failureMessage ?? "Render failed before memory64 spike");
        }
        if (snapshot.wasmThreadSpike.state !== "idle") {
          throw new Error("Dedicated memory64 launch unexpectedly started the Rust/WASM spike");
        }
        return snapshot.render.state === "ready";
      },
      { globalName: TELEMETRY_GLOBAL_NAME, schemaVersion: TELEMETRY_SCHEMA_VERSION },
      { timeout: 60_000 },
    );
    await resetSurfaceObserver(page);
    const renderSurfaceBefore = await readSurfaceLatest(page);
    const browserDisplayBefore = await readBoundaryDisplay(page, refreshRatesHz);
    await page.evaluate((globalName) => {
      const telemetry = Reflect.get(globalThis, globalName) as ParallaxTelemetryExport;
      telemetry.startMemory64Spike();
    }, TELEMETRY_GLOBAL_NAME);
    await page.waitForFunction(
      (globalName) => {
        const telemetry = Reflect.get(globalThis, globalName) as ParallaxTelemetryExport;
        return ["completed", "failed"].includes(telemetry.snapshot().memory64Spike.state);
      },
      TELEMETRY_GLOBAL_NAME,
      { timeout: MEMORY64_SPIKE_COMPLETION_TIMEOUT_MS },
    );
    const snapshot = (await readTelemetry(page)).memory64Spike;
    const surfaceState = await readSurfaceState(page);
    const browserDisplayAfter = await readBoundaryDisplay(page, refreshRatesHz);
    return Object.freeze({
      browserDisplayAfter,
      browserDisplayBefore,
      errors: Object.freeze(errors),
      metric: resolveMemory64SpikeMetric(snapshot),
      profile,
      renderSurfaceAfter: surfaceState.latest,
      renderSurfaceBefore,
      renderSurfaceChanges: surfaceState.changes,
      repeat,
    });
  } catch (error: unknown) {
    errors.push(errorMessage(error));
    return Object.freeze({
      browserDisplayAfter: null,
      browserDisplayBefore: null,
      errors: Object.freeze(errors),
      metric: Object.freeze({ reason: errors.join(" | "), state: "invalid" }),
      profile,
      renderSurfaceAfter: null,
      renderSurfaceBefore: null,
      renderSurfaceChanges: Object.freeze([]),
      repeat,
    });
  } finally {
    await context.close();
  }
}

async function inspectEnvironment(
  executablePath: string,
  profilePath: string,
  chromePin: ChromePin,
  executableSha256: string,
  machineId: string,
  tier: QualityTier,
  baseUrl: string,
): Promise<Memory64EnvironmentIdentity> {
  const machine = await loadMachineDescriptor(machineRoot, machineId).catch(() => null);
  const hostResultPromise = tryReadWindowsHostIdentity();
  const context = await launchPersistentChrome(executablePath, profilePath, [
    "--enable-webgpu-developer-features",
  ]);
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
        `Chrome version mismatch: expected ${chromePin.version}, received ${actualVersion}`,
      );
    }
    const systemInfo = (await session.send("SystemInfo.getInfo")) as {
      gpu: { devices: readonly CdpGpuDevice[] };
    };
    const primaryGpu = systemInfo.gpu.devices[0];
    if (primaryGpu === undefined) throw new Error("CDP did not report a primary GPU");
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${baseUrl}/__parallax/identity`, { waitUntil: "load" });
    const [adapter, browserDisplay, commandLine, hostResult] = await Promise.all([
      readWebGpuAdapterIdentity(page),
      readBrowserDisplayIdentity(context, page),
      readChromeCommandLine(context),
      hostResultPromise,
    ]);
    const sandboxVerified = validateChromeSandboxCommandLine(commandLine);
    const host = hostResult.state === "measured" ? hostResult.host : null;
    const gate =
      machine === null || host === null
        ? invalidEnvironmentGate(
            machine === null
              ? `Machine descriptor ${machineId} is unavailable`
              : hostResult.state === "invalid"
                ? hostResult.reason
                : "Host identity is unavailable",
          )
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
      commandLine,
      executableSha256,
      gate,
      gpuDevices: systemInfo.gpu.devices,
      host,
      hostAfterRuns: null,
      jsVersion: version.jsVersion,
      machine,
      machineId: machine?.id ?? machineId,
      qualityTier: tier,
      sandboxVerified,
      targetDisplayMode: QUALITY_TIER_PROFILES[tier].targetDisplayMode,
    });
  } finally {
    await session?.detach().catch(() => undefined);
    await context.close();
  }
}

function readBoundaryDisplay(
  page: Page,
  refreshRatesHz: readonly number[],
): Promise<BrowserDisplayIdentity> {
  return page.evaluate(
    (rates) =>
      Object.freeze({
        probeFailures: Object.freeze([]),
        refreshRatesHz: Object.freeze([...rates]),
        screen: Object.freeze({
          availHeight: screen.availHeight,
          availWidth: screen.availWidth,
          colorDepth: screen.colorDepth,
          devicePixelRatio,
          height: screen.height,
          width: screen.width,
        }),
      }),
    refreshRatesHz,
  );
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
        Object.defineProperty(globalThis, "__PARALLAX_MEMORY64_SURFACE__", {
          value: Object.freeze({
            latest: () => {
              if (latest === null) throw new Error("Canvas device-pixel size is unavailable");
              return Object.freeze({ ...latest });
            },
            reset: () =>
              new Promise<void>((resolveReset) => {
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    sizes.length = 0;
                    resolveReset();
                  });
                });
              }),
            snapshot: () => sizes.map((size) => Object.freeze({ ...size })),
          }),
        });
        observer.observe(canvas, { box: "device-pixel-content-box" });
      }),
  );
}

function resetSurfaceObserver(page: Page): Promise<void> {
  return page.evaluate(() => {
    const state = Reflect.get(globalThis, "__PARALLAX_MEMORY64_SURFACE__") as {
      reset(): Promise<void>;
    };
    return state.reset();
  });
}

function readSurfaceLatest(page: Page): Promise<RenderSurface> {
  return page.evaluate(() => {
    const state = Reflect.get(globalThis, "__PARALLAX_MEMORY64_SURFACE__") as {
      latest(): RenderSurface;
    };
    return state.latest();
  });
}

function readSurfaceState(
  page: Page,
): Promise<Readonly<{ changes: readonly RenderSurface[]; latest: RenderSurface }>> {
  return page.evaluate(() => {
    const state = Reflect.get(globalThis, "__PARALLAX_MEMORY64_SURFACE__") as {
      latest(): RenderSurface;
      snapshot(): readonly RenderSurface[];
    };
    return Object.freeze({ changes: state.snapshot(), latest: state.latest() });
  });
}

function summarizeEachRun(
  runs: readonly Memory64RunMeasurement[],
): readonly PerRunSummary[] | null {
  if (
    runs.length !== MEMORY64_SPIKE_REPEATS * 2 ||
    runs.some((run) => run.metric.state !== "measured")
  ) {
    return null;
  }
  return Object.freeze(
    runs.map((run) => {
      if (run.metric.state !== "measured") throw new Error("Run evidence changed during summary");
      const highAddress = run.metric.value.highAddress;
      if (highAddress === null) throw new Error("High-address evidence changed during summary");
      return Object.freeze({
        highGrowAndTouchMs: highAddress.growAndTouchElapsedMs,
        memory32: summarizeVariant(run.metric.value, "memory32"),
        memory64: summarizeVariant(run.metric.value, "memory64"),
        pairedRatios: summarizePairedRatios(run.metric.value),
        profile: run.profile,
        repeat: run.repeat,
      });
    }),
  );
}

function summarizePairedRatios(
  snapshot: Memory64SpikeTelemetrySnapshot,
): PerRunSummary["pairedRatios"] {
  const memory32 = requiredVariant(snapshot, "memory32").samples.filter(
    (sample) => sample.phase === "measured",
  );
  const memory64 = requiredVariant(snapshot, "memory64").samples.filter(
    (sample) => sample.phase === "measured",
  );
  const ratios = (
    memory32Field:
      | "compileElapsedMs"
      | "instantiateElapsedMs"
      | "kernelElapsedMs"
      | "prepareElapsedMs",
  ): Distribution => {
    if (memory32.some((sample, index) => memory64[index]?.ordinal !== sample.ordinal)) {
      throw new Error("Paired memory64 sample ordinal drifted");
    }
    return pairedRatioDistribution(
      memory32.map((sample) => sample[memory32Field]),
      memory64.map((sample) => sample[memory32Field]),
    );
  };
  return Object.freeze({
    compile: ratios("compileElapsedMs"),
    instantiate: ratios("instantiateElapsedMs"),
    kernel: ratios("kernelElapsedMs"),
    prepare: ratios("prepareElapsedMs"),
  });
}

function summarizeVariant(
  snapshot: Memory64SpikeTelemetrySnapshot,
  variant: "memory32" | "memory64",
): VariantSummary {
  const evidence = requiredVariant(snapshot, variant);
  const measured = evidence.samples.filter((sample) => sample.phase === "measured");
  const cold = evidence.samples.filter((sample) => sample.phase === "cold");
  return Object.freeze({
    coldCompileMs: distribution(cold.map((sample) => sample.compileElapsedMs)),
    compileMs: distribution(measured.map((sample) => sample.compileElapsedMs)),
    instantiateMs: distribution(measured.map((sample) => sample.instantiateElapsedMs)),
    kernelMs: distribution(measured.map((sample) => sample.kernelElapsedMs)),
    moduleBytes: evidence.moduleBytes,
    prepareMs: distribution(measured.map((sample) => sample.prepareElapsedMs)),
  });
}

function summarizeRuns(perRun: readonly PerRunSummary[] | null): Memory64SpikeReport["summaries"] {
  if (perRun === null) return null;
  const summarize = (variant: "memory32" | "memory64"): VariantSummary =>
    Object.freeze({
      coldCompileMs: distribution(perRun.map((run) => run[variant].coldCompileMs.p95)),
      compileMs: distribution(perRun.map((run) => run[variant].compileMs.p95)),
      instantiateMs: distribution(perRun.map((run) => run[variant].instantiateMs.p95)),
      kernelMs: distribution(perRun.map((run) => run[variant].kernelMs.p95)),
      moduleBytes: perRun[0]?.[variant].moduleBytes ?? 0,
      prepareMs: distribution(perRun.map((run) => run[variant].prepareMs.p95)),
    });
  return Object.freeze({ memory32: summarize("memory32"), memory64: summarize("memory64") });
}

function evaluateCostVariance(
  perRun: readonly PerRunSummary[] | null,
): Memory64SpikeReport["variance"] {
  if (perRun === null) {
    return Object.freeze({
      absoluteEvidence: Object.freeze([]),
      absoluteReasons: Object.freeze(["Absolute cost variance requires all six measured runs"]),
      absoluteState: "invalid",
      pairedEvidence: Object.freeze([]),
      pairedReasons: Object.freeze(["Paired cost variance requires all six measured runs"]),
      pairedState: "invalid",
    });
  }
  const absoluteEvidence: CostVarianceEvidence[] = [];
  const pairedEvidence: PairedCostVarianceEvidence[] = [];
  for (const profile of ["fresh", "warm"] as const) {
    const profileRuns = perRun
      .filter((run) => run.profile === profile)
      .sort((left, right) => left.repeat - right.repeat);
    for (const variant of ["memory32", "memory64"] as const) {
      for (const [metric, field] of [
        ["compile", "compileMs"],
        ["instantiate", "instantiateMs"],
        ["prepare", "prepareMs"],
        ["kernel", "kernelMs"],
      ] as const) {
        const repeatP95Ms = Object.freeze(profileRuns.map((run) => run[variant][field].p95));
        absoluteEvidence.push(
          Object.freeze({
            metric,
            profile,
            repeatP95Ms,
            variance: evaluateP95Variance(repeatP95Ms, MEMORY64_SPIKE_REPEATS),
            variant,
          }),
        );
      }
    }
    for (const metric of ["compile", "instantiate", "prepare", "kernel"] as const) {
      const repeatP95Ratios = Object.freeze(profileRuns.map((run) => run.pairedRatios[metric].p95));
      pairedEvidence.push(
        Object.freeze({
          metric,
          profile,
          repeatP95Ratios,
          variance: evaluateRelativeVariance(
            repeatP95Ratios,
            MEMORY64_SPIKE_REPEATS,
            "paired p95 ratio",
          ),
        }),
      );
    }
  }
  const absoluteReasons = absoluteEvidence.flatMap((item) =>
    item.variance.state === "invalid"
      ? [`${item.profile} ${item.variant} ${item.metric}: ${item.variance.reason}`]
      : [],
  );
  const pairedReasons = pairedEvidence.flatMap((item) =>
    item.variance.state === "invalid"
      ? [`${item.profile} ${item.metric}: ${item.variance.reason}`]
      : [],
  );
  return Object.freeze({
    absoluteEvidence: Object.freeze(absoluteEvidence),
    absoluteReasons: Object.freeze(absoluteReasons),
    absoluteState: absoluteReasons.length === 0 ? "measured" : "invalid",
    pairedEvidence: Object.freeze(pairedEvidence),
    pairedReasons: Object.freeze(pairedReasons),
    pairedState: pairedReasons.length === 0 ? "measured" : "invalid",
  });
}

function requiredVariant(
  snapshot: Memory64SpikeTelemetrySnapshot,
  variant: "memory32" | "memory64",
) {
  const evidence = snapshot[variant];
  if (evidence === null) throw new Error(`${variant} evidence disappeared after validation`);
  return evidence;
}

function compareRuns(
  perRun: readonly PerRunSummary[] | null,
): Memory64SpikeReport["overheadRatios"] {
  if (perRun === null) return null;
  const first = perRun[0];
  if (first === undefined) return null;
  const pairedMedian = (metric: "compile" | "instantiate" | "kernel" | "prepare") =>
    distribution(perRun.map((run) => run.pairedRatios[metric].p95)).p50;
  return Object.freeze({
    compileP50: pairedMedian("compile"),
    instantiateP50: pairedMedian("instantiate"),
    kernelP50: pairedMedian("kernel"),
    moduleBytes: first.memory64.moduleBytes / first.memory32.moduleBytes,
    prepareP50: pairedMedian("prepare"),
  });
}

function revalidateRunDisplays(
  environment: Memory64EnvironmentIdentity,
  runs: readonly Memory64RunMeasurement[],
): Memory64EnvironmentIdentity {
  if (environment.machine === null) return environment;
  const expectedDisplay = environment.machine.display;
  const reasons: string[] = [];
  for (const run of runs) {
    const label = `${run.profile} repeat ${run.repeat}`;
    for (const [phase, display] of [
      ["before", run.browserDisplayBefore],
      ["after", run.browserDisplayAfter],
    ] as const) {
      if (display === null) reasons.push(`${label} ${phase}: display unavailable`);
      else {
        reasons.push(
          ...evaluateBrowserDisplay(expectedDisplay, display).map(
            (reason) => `${label} ${phase}: ${reason}`,
          ),
        );
      }
    }
    for (const [phase, surface] of [
      ["before", run.renderSurfaceBefore],
      ["after", run.renderSurfaceAfter],
      ...run.renderSurfaceChanges.map((surface) => ["during", surface] as const),
    ] as const) {
      if (surface === null) reasons.push(`${label} ${phase}: render surface unavailable`);
      else {
        const mismatch = renderSurfaceMismatch(
          environment.qualityTier,
          surface,
          expectedDisplay.dimensionTolerancePixels,
        );
        if (mismatch !== null) reasons.push(`${label} ${phase}: ${mismatch}`);
      }
    }
    if (!jsonEquals(run.browserDisplayBefore, run.browserDisplayAfter)) {
      reasons.push(`${label}: browser display identity changed during the measurement window`);
    }
    if (
      run.renderSurfaceChanges.length > 0 ||
      !jsonEquals(run.renderSurfaceBefore, run.renderSurfaceAfter)
    ) {
      reasons.push(`${label}: render surface changed during the measurement window`);
    }
  }
  return reasons.length === 0 ? environment : invalidateEnvironment(environment, reasons);
}

function revalidateHostEnvironment(
  environment: Memory64EnvironmentIdentity,
  result: WindowsHostIdentityResult,
): Memory64EnvironmentIdentity {
  if (result.state === "invalid") return invalidateEnvironment(environment, [result.reason]);
  if (
    environment.host !== null &&
    JSON.stringify(environment.host) === JSON.stringify(result.host)
  ) {
    return Object.freeze({ ...environment, hostAfterRuns: result.host });
  }
  return Object.freeze({
    ...invalidateEnvironment(environment, ["Host environment changed during the memory64 run"]),
    hostAfterRuns: result.host,
  });
}

function invalidateEnvironment(
  environment: Memory64EnvironmentIdentity,
  reasons: readonly string[],
): Memory64EnvironmentIdentity {
  const existing = environment.gate.state === "invalid" ? environment.gate.reasons : [];
  return Object.freeze({ ...environment, gate: invalidEnvironmentGate([...existing, ...reasons]) });
}

async function writeReport(report: Memory64SpikeReport): Promise<void> {
  await mkdir(outputRoot, { recursive: true });
  const timestamp = report.generatedAt.replaceAll(":", "-");
  const stem = `${MEMORY64_SPIKE_SCENARIO.replace("@", "-")}-${report.artifactDigest.slice(0, 12)}-${safeMachineIdForFilename(report.environment.machineId)}-${report.environment.qualityTier}-${timestamp}`;
  await Promise.all([
    writeFile(join(outputRoot, `${stem}.json`), `${JSON.stringify(report, null, 2)}\n`),
    writeFile(join(outputRoot, `${stem}.md`), `${formatReport(report)}\n`),
  ]);
}

function formatReport(report: Memory64SpikeReport): string {
  const summary = report.summaries;
  const high = report.runs.find((run) => run.metric.state === "measured");
  const highEvidence = high?.metric.state === "measured" ? high.metric.value.highAddress : null;
  return [
    `# ${MEMORY64_SPIKE_SCENARIO} — ${report.passed ? "PASS" : "FAIL"}`,
    "",
    `- Artifact: \`${report.artifactDigest}\``,
    `- Chrome: ${report.chromePin.version}`,
    `- Environment: ${report.environment.gate.state}`,
    `- Paired overhead variance: ${report.variance.pairedState}`,
    `- Absolute timing variance (diagnostic): ${report.variance.absoluteState}`,
    `- Runs: ${report.runs.filter((run) => run.metric.state === "measured").length}/${MEMORY64_SPIKE_REPEATS * 2} measured`,
    highEvidence === null
      ? "- Beyond-4-GiB proof: unavailable"
      : `- Beyond-4-GiB proof: wrote/read 0x${highEvidence.sentinelRead.toString(16)} at 0x${highEvidence.address.toString(16)} with ${highEvidence.logicalMemoryBytes.toLocaleString("en-US")} logical bytes`,
    "",
    "## Paired cost summary",
    "",
    summary === null
      ? "Complete paired summaries unavailable."
      : `- memory32: ${summary.memory32.moduleBytes} bytes; kernel repeat-p95 median/worst ${formatMs(summary.memory32.kernelMs.p50)}/${formatMs(summary.memory32.kernelMs.p95)}\n- memory64: ${summary.memory64.moduleBytes} bytes; kernel repeat-p95 median/worst ${formatMs(summary.memory64.kernelMs.p50)}/${formatMs(summary.memory64.kernelMs.p95)}\n- memory64/memory32 median repeat-p95 ratios: compile ${formatRatio(report.overheadRatios?.compileP50)}, instantiate ${formatRatio(report.overheadRatios?.instantiateP50)}, prepare ${formatRatio(report.overheadRatios?.prepareP50)}, kernel ${formatRatio(report.overheadRatios?.kernelP50)}`,
    ...(report.variance.pairedReasons.length === 0
      ? []
      : [
          "",
          "## Invalid paired overhead variance",
          "",
          ...report.variance.pairedReasons.map((reason) => `- ${reason}`),
        ]),
    ...(report.variance.absoluteReasons.length === 0
      ? []
      : [
          "",
          "## Invalid absolute timing diagnostics",
          "",
          ...report.variance.absoluteReasons.map((reason) => `- ${reason}`),
        ]),
  ].join("\n");
}

function formatMs(value: number): string {
  return `${value.toFixed(3)} ms`;
}

function formatRatio(value: number | null | undefined): string {
  return value === null || value === undefined ? "n/a" : `${value.toFixed(3)}x`;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`${name} is required`);
  return value;
}

function jsonEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
