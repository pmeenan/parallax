import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { release, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ParallaxTelemetryExport, ParallaxTelemetrySnapshot } from "@parallax/engine";
import { type BrowserContext, chromium, type Page } from "playwright-core";
import { type Distribution, distribution, evaluateP95Variance } from "./aggregate.js";
import { type BudgetCheck, evaluateMainThreadBudgets, type QualityTier } from "./budgets.js";
import { readAndValidateBuildManifest, sha256File } from "./build-manifest.js";
import {
  parseQualityTier,
  QUALITY_TIER_PROFILES,
  SMOKE_INCOMPLETE_METRICS,
  SMOKE_MEASUREMENT_FRAMES,
  SMOKE_METRICS,
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

interface ChromePin {
  readonly channel: "stable";
  readonly executableSha256: Readonly<Record<string, string>>;
  readonly revision: string;
  readonly version: string;
}

interface RunMeasurement {
  readonly budgetChecks: readonly BudgetCheck[];
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
  readonly workerInitToFirstFrameMs: MeasuredMetric<number>;
  readonly workerStartupToFirstFrameMs: MeasuredMetric<number>;
}

interface EnvironmentIdentity {
  readonly browserProduct: string;
  readonly browserRevision: string;
  readonly browserUserAgent: string;
  readonly declaredGpuBackend: string;
  readonly declaredMachineId: string;
  readonly declaredPowerMode: string;
  readonly gateIdentityState: "invalid";
  readonly gpuDevices: readonly unknown[];
  readonly jsVersion: string;
  readonly os: string;
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
  readonly runs: readonly RunMeasurement[];
  readonly scenario: typeof SMOKE_SCENARIO;
  readonly schemaVersion: 1;
  readonly source: SourceIdentity;
  readonly callbackPacingVariance: readonly {
    readonly profile: "fresh" | "warm";
    readonly reason?: string;
    readonly relativeP95Range: number;
    readonly state: "invalid" | "measured";
  }[];
}

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const buildRoot = join(repositoryRoot, "dist");
const chromePinPath = join(repositoryRoot, "harness/chrome/stable.json");
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
    const environment = await inspectEnvironment(
      executablePath,
      join(profileRoot, "identity"),
      chromePin,
      machineId,
      tier,
      requiredEnvironment("PARALLAX_GPU_BACKEND"),
      requiredEnvironment("PARALLAX_POWER_MODE"),
    );
    const runs: RunMeasurement[] = [];
    for (let repeat = 1; repeat <= SMOKE_REPEATS; repeat += 1) {
      const lineage = join(profileRoot, `lineage-${repeat}`);
      runs.push(
        await measureRun(executablePath, lineage, baseUrl, tier, repeat, "fresh"),
        await measureRun(executablePath, lineage, baseUrl, tier, repeat, "warm"),
      );
    }
    const callbackPacingVariance = (["fresh", "warm"] as const).map((profile) => {
      const variance = evaluateP95Variance(
        runs
          .filter((run) => run.profile === profile)
          .map((run) => run.workerAnimationCallbackIntervalMs.value.p95),
      );
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
    });
    const incompleteMetrics = Object.freeze(SMOKE_INCOMPLETE_METRICS.map(invalidMetric));
    const passed =
      runs.every((run) => run.budgetChecks.every((check) => check.passed)) &&
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
      schemaVersion: 1,
      source,
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
    reason: "Probe is not implemented in smoke@1; Harness v1 remains incomplete",
    state: "invalid",
  });
}

function measured<T>(value: T): MeasuredMetric<T> {
  return Object.freeze({ state: "measured", value });
}

async function inspectEnvironment(
  executablePath: string,
  profilePath: string,
  chromePin: ChromePin,
  machineId: string,
  tier: QualityTier,
  gpuBackend: string,
  powerMode: string,
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
  const context = await launch(executablePath, profilePath, tier);
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
    const systemInfo = await session.send("SystemInfo.getInfo");
    return Object.freeze({
      browserProduct: version.product,
      browserRevision: version.revision,
      browserUserAgent: version.userAgent,
      declaredGpuBackend: gpuBackend,
      declaredMachineId: machineId,
      declaredPowerMode: powerMode,
      gateIdentityState: "invalid",
      gpuDevices: systemInfo.gpu.devices,
      jsVersion: version.jsVersion,
      os: `${process.platform} ${process.arch} ${release()}`,
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
  tier: QualityTier,
  repeat: number,
  profile: "fresh" | "warm",
): Promise<RunMeasurement> {
  const before = await fetchServerMetrics(baseUrl);
  const context = await launch(executablePath, profilePath, tier);
  const page = context.pages()[0] ?? (await context.newPage());
  const errors: string[] = [];
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
    await page.waitForTimeout(SMOKE_WARMUP_MS);
    await page.evaluate(() => {
      const state = Reflect.get(globalThis, "__PARALLAX_HARNESS_LONG_TASKS__") as {
        reset(): void;
      };
      state.reset();
    });
    const start = await readTelemetry(page);
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
    const snapshot = await readTelemetry(page);
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
    const mainThreadLongTasks = await page.evaluate(() => {
      const state = Reflect.get(globalThis, "__PARALLAX_HARNESS_LONG_TASKS__") as {
        count(): number;
      };
      return state.count();
    });
    if (errors.length > 0) throw new Error(`Browser errors: ${errors.join(" | ")}`);
    const workerAnimationCallbackIntervalMs = distribution(presentIntervals);
    return Object.freeze({
      budgetChecks: evaluateMainThreadBudgets(mainThreadLongTasks),
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
      workerInitToFirstFrameMs: measured(requiredNumber(snapshot.render.workerInitToFirstFrameMs)),
      workerStartupToFirstFrameMs: measured(
        requiredNumber(snapshot.render.workerStartupToFirstFrameMs),
      ),
      workerAnimationCallbackIntervalMs: measured(workerAnimationCallbackIntervalMs),
    });
  } finally {
    await context.close();
  }
}

function launch(
  executablePath: string,
  profilePath: string,
  tier: QualityTier,
): Promise<BrowserContext> {
  const viewport = QUALITY_TIER_PROFILES[tier].viewport;
  return chromium.launchPersistentContext(profilePath, {
    executablePath,
    headless: false,
    viewport,
  });
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
    report.environment.declaredMachineId,
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
