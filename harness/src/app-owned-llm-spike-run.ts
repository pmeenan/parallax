import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  APP_OWNED_LLM_SPIKE_TELEMETRY_SCHEMA_VERSION,
  APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS,
  type AppOwnedLlmInferenceDevice,
  type AppOwnedLlmSpikeTelemetrySnapshot,
  type ParallaxTelemetryExport,
  type RenderFrameSample,
  TELEMETRY_FRAME_BATCH_FRAMES,
  TELEMETRY_GLOBAL_NAME,
  TELEMETRY_SCHEMA_VERSION,
} from "@parallax/engine";
import type { BrowserContext, Page } from "playwright-core";
import {
  readBrowserDisplayIdentity,
  readChromeCommandLine,
  readWebGpuAdapterIdentityFromProbePage,
} from "./browser-probes.js";
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
  evaluateGateEnvironment,
  invalidEnvironmentGate,
  loadMachineDescriptor,
  type MachineDescriptor,
  safeMachineIdForFilename,
  tryReadWindowsHostIdentity,
  type WebGpuAdapterIdentity,
  type WindowsHostIdentity,
} from "./environment.js";
import { launchAfterPhysicalConsoleDisplayWake } from "./physical-console-preflight.js";
import {
  APP_OWNED_LLM_SPIKE_REPORT_SCHEMA_VERSION,
  APP_OWNED_LLM_SPIKE_SCENARIO,
  type AppOwnedLlmRunMetrics,
  evaluateAppOwnedLlmRun,
  evaluateAppOwnedLlmRunPass,
  type Metric,
  waitForAppOwnedLlmCompletion,
} from "./runs/app-owned-llm-spike.js";
import { parseQualityTier, QUALITY_TIER_PROFILES } from "./runs/smoke.js";
import { createLocalServer, listenLocalServer, stopLocalServer } from "./server.js";
import { readSourceIdentity, type SourceIdentity } from "./source-identity.js";
import { readTelemetry } from "./telemetry.js";
import { errorMessage } from "./value-utils.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const buildRoot = join(repositoryRoot, "dist");
const machineRoot = join(repositoryRoot, "harness/machines");
const outputRoot = join(repositoryRoot, "harness/results");
const collectorName = "__PARALLAX_APP_OWNED_LLM_COLLECTORS__";
const COLD_LOAD_STALL_WARM_SKIP_ERROR =
  "warm: skipped because the cold model load stalled without forward progress";
const fixtureOrder = resolveFixtureOrder();
const inferenceDevice = resolveInferenceDevice();

export interface AppOwnedLlmEnvironmentIdentity {
  readonly adapter: WebGpuAdapterIdentity | null;
  readonly browser: Readonly<{
    readonly channel: ChromePin["channel"];
    readonly commandLine: string;
    readonly executableSha256: string;
    readonly jsVersion: string;
    readonly product: string;
    readonly revision: string;
    readonly sandboxed: true;
    readonly userAgent: string;
    readonly version: string;
  }> | null;
  readonly browserDisplay: BrowserDisplayIdentity | null;
  readonly gate: EnvironmentGateState;
  readonly gpuDevices: readonly CdpGpuDevice[];
  readonly host: WindowsHostIdentity | null;
  readonly machine: MachineDescriptor | null;
  readonly machineId: string;
  readonly profile: Readonly<{
    readonly root: string;
    readonly strategy: "fresh-persistent-restarted";
  }>;
  readonly qualityTier: ReturnType<typeof parseQualityTier>;
  readonly runScript: typeof APP_OWNED_LLM_SPIKE_SCENARIO;
  readonly targetDisplayMode: string;
}

export interface AppOwnedLlmRuntimeCollectors {
  readonly failureMessage: string | null;
  readonly frames: readonly RenderFrameSample[];
}

interface AppOwnedLlmPhaseCapture {
  readonly collectors: AppOwnedLlmRuntimeCollectors;
  readonly telemetry: AppOwnedLlmSpikeTelemetrySnapshot | null;
}

interface AppOwnedLlmSpikeReport {
  readonly artifactDigest: string;
  readonly environment: AppOwnedLlmEnvironmentIdentity;
  readonly errors: readonly string[];
  readonly generatedAt: string;
  readonly metrics: AppOwnedLlmRunMetrics;
  readonly passed: boolean;
  readonly rawTelemetry: Readonly<{
    readonly coldInstall: AppOwnedLlmSpikeTelemetrySnapshot | null;
    readonly warmRestart: AppOwnedLlmSpikeTelemetrySnapshot | null;
  }>;
  readonly generationWindowRenderCallbacks: Readonly<{
    readonly coldInstall: AppOwnedLlmRuntimeCollectors;
    readonly warmRestart: AppOwnedLlmRuntimeCollectors;
  }>;
  readonly scenario: typeof APP_OWNED_LLM_SPIKE_SCENARIO;
  readonly schemaVersion: typeof APP_OWNED_LLM_SPIKE_REPORT_SCHEMA_VERSION;
  readonly source: SourceIdentity;
  readonly vram: Readonly<{ readonly reason: string; readonly state: "unsupported" }>;
}

interface FreshPersistentProfile {
  readonly root: string;
  remove(): Promise<void>;
}

export async function runAppOwnedLlmSpikeEntrypoint(): Promise<void> {
  const failure = await executeAppOwnedLlmEntrypoint(main, writeFatalFailureReport);
  if (failure !== null) {
    console.error(`App-owned LLM spike failed: ${failure.message}`);
    if (failure.reportFailure !== null) {
      console.error(`App-owned LLM fatal-report write failed: ${failure.reportFailure}`);
    }
    process.exitCode = 1;
  }
}

export async function executeAppOwnedLlmEntrypoint(
  run: () => Promise<void>,
  reportFatal: (message: string) => Promise<void>,
): Promise<Readonly<{ readonly message: string; readonly reportFailure: string | null }> | null> {
  try {
    await run();
    return null;
  } catch (error: unknown) {
    const message = errorMessage(error);
    try {
      await reportFatal(message);
      return Object.freeze({ message, reportFailure: null });
    } catch (reportError: unknown) {
      return Object.freeze({ message, reportFailure: errorMessage(reportError) });
    }
  }
}

async function main(): Promise<void> {
  const machineId = requiredEnvironment("PARALLAX_MACHINE_ID");
  const tier = parseQualityTier(process.env.PARALLAX_TIER);
  const chromePin = await loadChromePin(join(repositoryRoot, "harness/chrome/stable.json"));
  const executablePath = await resolveChromeExecutablePath(repositoryRoot, chromePin);
  const executableSha256 = await validateChromeExecutable(chromePin, executablePath);
  const profile = await createFreshPersistentProfile(resolveProfileRoot());
  try {
    await runAppOwnedLlmSpike(
      machineId,
      tier,
      chromePin,
      executablePath,
      executableSha256,
      profile,
    );
  } finally {
    await profile.remove().catch((error: unknown) => {
      console.warn(`App-owned LLM temporary-profile cleanup failed: ${errorMessage(error)}`);
    });
  }
}

async function runAppOwnedLlmSpike(
  machineId: string,
  tier: ReturnType<typeof parseQualityTier>,
  chromePin: ChromePin,
  executablePath: string,
  executableSha256: string,
  profile: FreshPersistentProfile,
): Promise<void> {
  const build = await readAndValidateBuildManifest(buildRoot);
  const source = await readSourceIdentity(repositoryRoot);
  const externalModel = await validateWllamaModelRoot(resolveWllamaModelRoot());
  const server = createLocalServer({
    ...(externalModel === undefined ? {} : { externalModel }),
    root: buildRoot,
  });
  const address = await listenLocalServer(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const modelUrl =
    externalModel === undefined
      ? undefined
      : `${baseUrl}/__parallax/models/${APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS[0]?.path ?? "missing-first-shard"}`;
  const errors: string[] = [];
  if (fixtureOrder === "context-first") {
    errors.push(
      "Context-first fixture order is an attribution diagnostic and cannot pass the qualification gate",
    );
  }
  let environment = emptyEnvironment(machineId, tier, profile.root);
  let cold: AppOwnedLlmPhaseCapture = emptyCapture();
  let warm: AppOwnedLlmPhaseCapture = emptyCapture();
  try {
    const coldResult = await runPhase({
      baseUrl,
      chromePin,
      executablePath,
      executableSha256,
      machineId,
      ...(modelUrl === undefined ? {} : { modelUrl }),
      phase: "cold",
      profileRoot: profile.root,
      tier,
    });
    cold = coldResult.capture;
    environment = coldResult.environment;
    errors.push(...coldResult.errors);

    if (coldResult.loadStalled) {
      errors.push(COLD_LOAD_STALL_WARM_SKIP_ERROR);
    } else {
      // Closing the persistent context is the required restart boundary. The second
      // launch receives the same exact profile directory but no live browser state.
      const warmResult = await runPhase({
        baseUrl,
        chromePin,
        executablePath,
        executableSha256,
        machineId,
        ...(modelUrl === undefined ? {} : { modelUrl }),
        phase: "warm",
        profileRoot: profile.root,
        tier,
      });
      warm = warmResult.capture;
      errors.push(...warmResult.errors);
    }
  } finally {
    await stopLocalServer(server);
  }

  await validatePostRunIdentity(build.artifactDigest, source, errors);
  const metrics = evaluateAppOwnedLlmRun({
    cold: cold.telemetry,
    generationFrames: warm.collectors.frames,
    warm: warm.telemetry,
  });
  if (warm.collectors.failureMessage !== null) errors.push(warm.collectors.failureMessage);
  const report = createReport(
    build.artifactDigest,
    environment,
    errors,
    metrics,
    source,
    cold,
    warm,
  );
  await writeReport(report);
  console.log(formatReport(report));
  process.exitCode = report.passed ? 0 : 1;
}

async function runPhase(
  input: Readonly<{
    readonly baseUrl: string;
    readonly chromePin: ChromePin;
    readonly executablePath: string;
    readonly executableSha256: string;
    readonly machineId: string;
    readonly modelUrl?: string;
    readonly phase: "cold" | "warm";
    readonly profileRoot: string;
    readonly tier: ReturnType<typeof parseQualityTier>;
  }>,
): Promise<
  Readonly<{
    readonly capture: AppOwnedLlmPhaseCapture;
    readonly environment: AppOwnedLlmEnvironmentIdentity;
    readonly errors: readonly string[];
    readonly loadStalled: boolean;
  }>
> {
  const errors: string[] = [];
  let capture = emptyCapture();
  let environment = emptyEnvironment(input.machineId, input.tier, input.profileRoot);
  let loadStalled = false;
  const context = await launchAfterPhysicalConsoleDisplayWake(() =>
    launchPersistentChrome(input.executablePath, input.profileRoot, [
      "--enable-webgpu-developer-features",
    ]),
  );
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    page.on("pageerror", (error) => errors.push(`${input.phase}: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`${input.phase}: ${message.text()}`);
    });
    const pageUrl = new URL(input.baseUrl);
    pageUrl.searchParams.set("appOwnedLlmSpike", fixtureOrder);
    pageUrl.searchParams.set("appOwnedLlmDevice", inferenceDevice);
    if (input.modelUrl !== undefined) {
      pageUrl.searchParams.set("appOwnedLlmModelUrl", input.modelUrl);
    }
    await page.goto(pageUrl.href, { waitUntil: "load" });
    environment = await readEnvironment(
      context,
      page,
      input.chromePin,
      input.executableSha256,
      input.machineId,
      input.tier,
      input.baseUrl,
      input.profileRoot,
    );
    await waitForAppReady(page);
    await installGenerationWindowCollector(page);
    await page.locator("#app-owned-llm-start").click();
    const completed = await waitForAppOwnedLlmCompletion(
      async () => (await readTelemetry(page)).appOwnedLlmSpike,
    );
    loadStalled = completed.loadStalled;
    if (completed.failureMessage !== null)
      errors.push(`${input.phase}: ${completed.failureMessage}`);
    capture = Object.freeze({
      collectors: await readGenerationWindowCollector(page),
      telemetry: (await readTelemetry(page)).appOwnedLlmSpike,
    });
  } catch (error: unknown) {
    errors.push(`${input.phase}: ${errorMessage(error)}`);
  } finally {
    await context.close();
  }
  return Object.freeze({ capture, environment, errors: Object.freeze(errors), loadStalled });
}

async function readEnvironment(
  context: BrowserContext,
  page: Page,
  chromePin: ChromePin,
  executableSha256: string,
  machineId: string,
  tier: ReturnType<typeof parseQualityTier>,
  baseUrl: string,
  profileRoot: string,
): Promise<AppOwnedLlmEnvironmentIdentity> {
  const machine = await loadMachineDescriptor(machineRoot, machineId).catch(() => null);
  const hostResult = await tryReadWindowsHostIdentity();
  const host = hostResult.state === "measured" ? hostResult.host : null;
  const browser = context.browser();
  if (browser === null) throw new Error("Playwright did not expose the launched browser");
  const session = await browser.newBrowserCDPSession();
  try {
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
    const [adapter, browserDisplay, commandLine] = await Promise.all([
      readWebGpuAdapterIdentityFromProbePage(context, baseUrl),
      readBrowserDisplayIdentity(context, page),
      readChromeCommandLine(context),
    ]);
    validateChromeSandboxCommandLine(commandLine);
    const gate =
      machine === null
        ? invalidEnvironmentGate(`Machine descriptor ${machineId} is unavailable`)
        : host === null
          ? invalidEnvironmentGate(
              hostResult.state === "invalid" ? hostResult.reason : "Host identity is unavailable",
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
    return createEnvironmentIdentity({
      adapter,
      browser: Object.freeze({
        channel: chromePin.channel,
        commandLine,
        executableSha256,
        jsVersion: version.jsVersion,
        product: version.product,
        revision: version.revision,
        sandboxed: true,
        userAgent: version.userAgent,
        version: actualVersion,
      }),
      browserDisplay,
      gate,
      gpuDevices: systemInfo.gpu.devices,
      host,
      machine,
      profileRoot,
      qualityTier: tier,
      requestedMachineId: machineId,
      runScript: APP_OWNED_LLM_SPIKE_SCENARIO,
    });
  } finally {
    await session.detach().catch(() => undefined);
  }
}

async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForFunction(
    ({ globalName, sectionSchemaVersion, telemetrySchemaVersion }) => {
      const telemetry = Reflect.get(globalThis, globalName) as ParallaxTelemetryExport | undefined;
      if (telemetry === undefined) return false;
      const snapshot = telemetry.snapshot();
      if (snapshot.schemaVersion !== telemetrySchemaVersion) {
        throw new Error(
          `Telemetry schema mismatch: expected ${telemetrySchemaVersion}, received ${snapshot.schemaVersion}`,
        );
      }
      if (snapshot.appOwnedLlmSpike.schemaVersion !== sectionSchemaVersion) {
        throw new Error(
          `App-owned LLM schema mismatch: expected ${sectionSchemaVersion}, received ${snapshot.appOwnedLlmSpike.schemaVersion}`,
        );
      }
      return snapshot.render.state === "ready" && snapshot.appOwnedLlmSpike.state === "idle";
    },
    {
      globalName: TELEMETRY_GLOBAL_NAME,
      sectionSchemaVersion: APP_OWNED_LLM_SPIKE_TELEMETRY_SCHEMA_VERSION,
      telemetrySchemaVersion: TELEMETRY_SCHEMA_VERSION,
    },
    { timeout: 30_000 },
  );
}

export async function installGenerationWindowCollector(page: Page): Promise<void> {
  await page.evaluate(
    ({ batchFrames, globalName, name }) => {
      const telemetry = Reflect.get(globalThis, globalName) as ParallaxTelemetryExport;
      const state = {
        failureMessage: null as string | null,
        frames: [] as RenderFrameSample[],
        lastFrameCount: telemetry.snapshot().render.frameCount,
        markerFrameCount: null as number | null,
        recording: false,
      };
      telemetry.subscribe((snapshot) => {
        const spike = snapshot.appOwnedLlmSpike;
        if (!state.recording && spike.state === "running") {
          state.recording = true;
          state.markerFrameCount = snapshot.render.frameCount;
          // Frame telemetry is batch-published. Excluding the whole previous batch
          // makes the capture a generation-only window instead of a load warmup mix.
          state.lastFrameCount = snapshot.render.frameCount + batchFrames;
        }
        if (!state.recording) return;
        const advanced = snapshot.render.frameCount - state.lastFrameCount;
        if (advanced > 0) {
          if (advanced > snapshot.render.recentFrames.length) {
            state.failureMessage = `Generation window lost ${advanced - snapshot.render.recentFrames.length} render samples to telemetry retention`;
          } else if (state.failureMessage === null) {
            state.frames.push(...snapshot.render.recentFrames.slice(-advanced));
          }
          state.lastFrameCount = snapshot.render.frameCount;
        }
        if (spike.state === "completed" || spike.state === "failed") {
          state.recording = false;
          if (state.frames.length === 0 && state.failureMessage === null) {
            const advancedSinceMarker =
              state.markerFrameCount === null
                ? 0
                : snapshot.render.frameCount - state.markerFrameCount;
            state.failureMessage = `Generation advanced ${advancedSinceMarker} telemetry-counted frames; the ${batchFrames}-frame guard band left no render callback samples`;
          }
        }
      });
      Reflect.set(globalThis, name, {
        snapshot: () => ({ failureMessage: state.failureMessage, frames: [...state.frames] }),
      });
    },
    {
      batchFrames: TELEMETRY_FRAME_BATCH_FRAMES,
      globalName: TELEMETRY_GLOBAL_NAME,
      name: collectorName,
    },
  );
}

function readGenerationWindowCollector(page: Page): Promise<AppOwnedLlmRuntimeCollectors> {
  return page.evaluate((name) => {
    const collector = Reflect.get(globalThis, name) as
      | { snapshot(): AppOwnedLlmRuntimeCollectors }
      | undefined;
    if (collector === undefined) {
      return { failureMessage: "Generation-window collector was not installed", frames: [] };
    }
    return collector.snapshot();
  }, collectorName);
}

function createReport(
  artifactDigest: string,
  environment: AppOwnedLlmEnvironmentIdentity,
  errors: readonly string[],
  metrics: AppOwnedLlmRunMetrics,
  source: SourceIdentity,
  cold: AppOwnedLlmPhaseCapture,
  warm: AppOwnedLlmPhaseCapture,
): AppOwnedLlmSpikeReport {
  const telemetryCompleted =
    cold.telemetry?.state === "completed" && warm.telemetry?.state === "completed";
  return Object.freeze({
    artifactDigest,
    environment,
    errors: Object.freeze([...errors]),
    generatedAt: new Date().toISOString(),
    metrics,
    passed: evaluateAppOwnedLlmRunPass({
      environmentMeasured: environment.gate.state === "measured",
      errors,
      metrics,
      telemetryCompleted,
    }),
    rawTelemetry: Object.freeze({ coldInstall: cold.telemetry, warmRestart: warm.telemetry }),
    generationWindowRenderCallbacks: Object.freeze({
      coldInstall: cold.collectors,
      warmRestart: warm.collectors,
    }),
    scenario: APP_OWNED_LLM_SPIKE_SCENARIO,
    schemaVersion: APP_OWNED_LLM_SPIKE_REPORT_SCHEMA_VERSION,
    source,
    vram: Object.freeze({
      reason:
        "WebGPU does not expose per-GPUDevice VRAM allocation or cross-worker attribution; this spike reports VRAM explicitly unsupported rather than estimating it.",
      state: "unsupported",
    }),
  });
}

function emptyCapture(): AppOwnedLlmPhaseCapture {
  return Object.freeze({
    collectors: Object.freeze({
      failureMessage: "Runtime capture did not complete",
      frames: Object.freeze([]),
    }),
    telemetry: null,
  });
}

function emptyEnvironment(
  machineId: string,
  tier: ReturnType<typeof parseQualityTier>,
  profileRoot: string,
): AppOwnedLlmEnvironmentIdentity {
  return createEnvironmentIdentity({
    adapter: null,
    browser: null,
    browserDisplay: null,
    gate: invalidEnvironmentGate("Environment identity was not collected"),
    gpuDevices: Object.freeze([]),
    host: null,
    machine: null,
    profileRoot,
    qualityTier: tier,
    requestedMachineId: machineId,
    runScript: APP_OWNED_LLM_SPIKE_SCENARIO,
  });
}

export function createEnvironmentIdentity(
  input: Omit<AppOwnedLlmEnvironmentIdentity, "machineId" | "profile" | "targetDisplayMode"> & {
    readonly profileRoot: string;
    readonly requestedMachineId: string;
  },
): AppOwnedLlmEnvironmentIdentity {
  const { profileRoot, requestedMachineId, ...environment } = input;
  return Object.freeze({
    ...environment,
    machineId: input.machine?.id ?? requestedMachineId,
    profile: Object.freeze({ root: profileRoot, strategy: "fresh-persistent-restarted" }),
    targetDisplayMode: QUALITY_TIER_PROFILES[input.qualityTier].targetDisplayMode,
  });
}

async function validatePostRunIdentity(
  artifactDigest: string,
  source: SourceIdentity,
  errors: string[],
): Promise<void> {
  try {
    if ((await readAndValidateBuildManifest(buildRoot)).artifactDigest !== artifactDigest) {
      errors.push("Built artifact identity changed during the app-owned LLM spike run");
    }
  } catch (error: unknown) {
    errors.push(`Post-run artifact validation failed: ${errorMessage(error)}`);
  }
  try {
    if (JSON.stringify(await readSourceIdentity(repositoryRoot)) !== JSON.stringify(source)) {
      errors.push("Source identity changed during the app-owned LLM spike run");
    }
  } catch (error: unknown) {
    errors.push(`Post-run source validation failed: ${errorMessage(error)}`);
  }
}

async function createFreshPersistentProfile(root: string): Promise<FreshPersistentProfile> {
  await mkdir(root, { recursive: true });
  const profileRoot = await mkdtemp(join(root, "app-owned-llm-"));
  return Object.freeze({
    root: profileRoot,
    remove: () => rm(profileRoot, { force: true, recursive: true }),
  });
}

function resolveProfileRoot(): string {
  const override = process.env.PARALLAX_APP_OWNED_LLM_PROFILE_ROOT;
  return resolve(
    override === undefined || override === ""
      ? join(homedir(), ".parallax", "harness", "app-owned-llm-profiles")
      : override,
  );
}

async function writeReport(report: AppOwnedLlmSpikeReport): Promise<void> {
  await mkdir(outputRoot, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const machine = safeMachineIdForFilename(report.environment.machineId);
  const stem = `${APP_OWNED_LLM_SPIKE_SCENARIO.replace("@", "-")}-${report.artifactDigest.slice(0, 12)}-${machine}-${stamp}`;
  await writeFile(join(outputRoot, `${stem}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(outputRoot, `${stem}.md`), `${formatReport(report)}\n`);
}

async function writeFatalFailureReport(message: string): Promise<void> {
  await mkdir(outputRoot, { recursive: true });
  const generatedAt = new Date().toISOString();
  const machineId = process.env.PARALLAX_MACHINE_ID ?? "unknown-machine";
  const stem = `${APP_OWNED_LLM_SPIKE_SCENARIO.replace("@", "-")}-fatal-${safeMachineIdForFilename(machineId)}-${generatedAt.replace(/[:.]/g, "-")}`;
  const report = Object.freeze({
    error: message,
    generatedAt,
    machineId,
    passed: false,
    scenario: APP_OWNED_LLM_SPIKE_SCENARIO,
    schema: "app-owned-llm-spike-failure@1",
  });
  await writeFile(join(outputRoot, `${stem}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(
    join(outputRoot, `${stem}.md`),
    `# ${APP_OWNED_LLM_SPIKE_SCENARIO} fatal runner failure\n\n- Result: **FAIL**\n- Machine: ${machineId}\n- Generated: ${generatedAt}\n- Error: ${message}\n`,
  );
}

function formatReport(report: AppOwnedLlmSpikeReport): string {
  const metric = <T>(value: Metric<T>): string =>
    value.state === "measured" ? "measured" : `${value.state} — ${value.reason}`;
  const checks = report.metrics.budgetChecks.map(
    (check) =>
      `- ${check.passed ? "PASS" : "FAIL"}: ${check.metric} ${check.actual.toFixed(2)} <= ${check.limit.toFixed(2)} ms`,
  );
  return [
    `# ${APP_OWNED_LLM_SPIKE_SCENARIO}`,
    "",
    `- Result: **${report.passed ? "PASS" : "FAIL"}**`,
    `- Machine / tier: ${report.environment.machineId} / ${report.environment.qualityTier}`,
    `- Environment gate: ${report.environment.gate.state}`,
    `- Chrome: ${report.environment.browser?.version ?? "not measured"}; pinned CfT digest ${report.environment.browser?.executableSha256 ?? "not measured"}; production sandbox ${report.environment.browser?.sandboxed === true ? "verified" : "not measured"}`,
    `- Persistent profile lifecycle: ${report.environment.profile.strategy} (${
      report.errors.includes(COLD_LOAD_STALL_WARM_SKIP_ERROR)
        ? "fresh profile; cold load stalled, warm restart skipped"
        : "cold install then browser restart then warm run"
    })`,
    `- Inference device: ${report.rawTelemetry.warmRestart?.deviceTopology.inferenceDevice ?? "not measured"}`,
    `- TTFT: ${metric(report.metrics.ttft)}${report.metrics.ttft.state === "measured" ? `; n=20; p95 ${report.metrics.ttft.value.p95.toFixed(2)} ms` : ""}`,
    `- Tokens/s: ${metric(report.metrics.tokensPerSecond)}`,
    `- Schema / grounding / context: ${metric(report.metrics.schema)} / ${metric(report.metrics.grounding)} / ${metric(report.metrics.context)}`,
    `- Exact model identity: ${metric(report.metrics.modelIdentity)}`,
    `- Cold OPFS writes: ${metric(report.metrics.coldInstall)}`,
    `- Warm OPFS reads: ${metric(report.metrics.warmOpfs)}`,
    `- Generation-window render callbacks: ${metric(report.metrics.generationWindow)}${report.metrics.generationWindow.state === "measured" ? `; n=${report.metrics.generationWindow.value.sampleCount}; p95 ${report.metrics.generationWindow.value.p95.toFixed(2)} ms` : ""}`,
    `- VRAM: ${report.vram.state} — ${report.vram.reason}`,
    "",
    "## Budget checks",
    "",
    ...(checks.length === 0 ? ["- No complete budget set was produced."] : checks),
    ...(report.errors.length === 0
      ? []
      : ["", "## Browser/runner errors", "", ...report.errors.map((error) => `- ${error}`)]),
  ].join("\n");
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
}

function resolveFixtureOrder(): "context-first" | "manual" {
  const value = process.env.PARALLAX_APP_OWNED_LLM_FIXTURE_ORDER ?? "manual";
  if (value !== "manual" && value !== "context-first") {
    throw new Error(`Unsupported PARALLAX_APP_OWNED_LLM_FIXTURE_ORDER ${JSON.stringify(value)}`);
  }
  return value;
}

function resolveInferenceDevice(): AppOwnedLlmInferenceDevice {
  const value = process.env.PARALLAX_APP_OWNED_LLM_DEVICE ?? "wllama-webgpu";
  if (value !== "wllama-webgpu" && value !== "wllama-wasm") {
    throw new Error(`Unsupported PARALLAX_APP_OWNED_LLM_DEVICE ${JSON.stringify(value)}`);
  }
  return value;
}

function resolveWllamaModelRoot(): string {
  const override = process.env.PARALLAX_APP_OWNED_LLM_MODEL_ROOT;
  return resolve(
    override === undefined || override === ""
      ? join(homedir(), ".parallax", "harness", "models", "gemma-4-E2B-it-qat-GGUF-66a399f6")
      : override,
  );
}

async function validateWllamaModelRoot(root: string): Promise<
  Readonly<{
    readonly artifacts: typeof APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS;
    readonly root: string;
  }>
> {
  for (const artifact of APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS) {
    const path = join(root, artifact.path);
    const file = await stat(path);
    if (!file.isFile() || file.size !== artifact.bytes) {
      throw new Error(
        `wllama GGUF artifact size mismatch for ${artifact.path}: expected ${artifact.bytes}, received ${file.size}`,
      );
    }
    const digest = await sha256File(path);
    if (digest !== artifact.sha256) {
      throw new Error(
        `wllama GGUF artifact digest mismatch for ${artifact.path}: expected ${artifact.sha256}, received ${digest}`,
      );
    }
  }
  return Object.freeze({ artifacts: APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS, root });
}

function sha256File(path: string): Promise<string> {
  return new Promise<string>((resolveDigest, rejectDigest) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", rejectDigest);
    stream.once("end", () => resolveDigest(hash.digest("hex")));
  });
}
