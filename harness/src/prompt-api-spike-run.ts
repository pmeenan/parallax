import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  type ParallaxTelemetryExport,
  PROMPT_API_SPIKE_TELEMETRY_SCHEMA_VERSION,
  type PromptApiSpikeTelemetrySnapshot,
  type RenderFrameSample,
  TELEMETRY_FRAME_BATCH_FRAMES,
  TELEMETRY_GLOBAL_NAME,
  TELEMETRY_SCHEMA_VERSION,
} from "@parallax/engine";
import type { Page } from "playwright-core";
import {
  readBrowserDisplayIdentity,
  readChromeCommandLine,
  readWebGpuAdapterIdentityFromProbePage,
} from "./browser-probes.js";
import type { BudgetCheck, DiagnosticCheck, QualityTier } from "./budgets.js";
import { readAndValidateBuildManifest } from "./build-manifest.js";
import {
  type ChromePin,
  launchPersistentChrome,
  loadChromePin,
  PROMPT_API_CHROME_LAUNCH_ARGS,
  PROMPT_API_IGNORED_PLAYWRIGHT_DEFAULT_ARGS,
  type PromptApiChromeLaunchEvidence,
  resolveChromeExecutablePath,
  validateChromeExecutable,
  validatePromptApiChromeCommandLine,
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
  type WindowsHostIdentityResult,
} from "./environment.js";
import {
  measurePromptApiModelComponent,
  type PromptApiModelComponentMetric,
} from "./prompt-api-model-component.js";
import {
  createFreshPromptApiProfile,
  type FreshPromptApiProfile,
  type PromptApiProfileLineage,
} from "./prompt-api-profile.js";
import {
  evaluatePromptApiBudgets,
  evaluatePromptApiCallbackPacing,
  evaluatePromptApiCallbackPacingDiagnostics,
  evaluatePromptApiDownloadEvidence,
  evaluatePromptApiRunPass,
  PROMPT_API_SPIKE_REPORT_SCHEMA_VERSION,
  PROMPT_API_SPIKE_SCENARIO,
  type PromptApiCallbackPacing,
  waitForPromptApiCompletion,
} from "./runs/prompt-api-spike.js";
import { parseQualityTier, QUALITY_TIER_PROFILES } from "./runs/smoke.js";
import { createLocalServer, listenLocalServer, stopLocalServer } from "./server.js";
import { readSourceIdentity, type SourceIdentity } from "./source-identity.js";
import { readTelemetry } from "./telemetry.js";
import { errorMessage } from "./value-utils.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const buildRoot = join(repositoryRoot, "dist");
const outputRoot = join(repositoryRoot, "harness/results");
const machineRoot = join(repositoryRoot, "harness/machines");

type Metric<T> =
  | Readonly<{ readonly state: "measured"; readonly value: T }>
  | Readonly<{
      readonly reason: string;
      readonly state: "invalid" | "not-applicable" | "unsupported";
    }>;

export interface PromptEnvironmentIdentity {
  readonly adapter: WebGpuAdapterIdentity | null;
  readonly browser: Readonly<{
    readonly channel: ChromePin["channel"];
    readonly executableSha256: string;
    readonly jsVersion: string;
    readonly product: string;
    readonly revision: string;
    readonly userAgent: string;
    readonly version: string;
    readonly launch: PromptApiChromeLaunchEvidence;
  }> | null;
  readonly browserDisplay: BrowserDisplayIdentity | null;
  readonly gate: EnvironmentGateState;
  readonly gpuDevices: readonly CdpGpuDevice[];
  readonly host: WindowsHostIdentity | null;
  readonly hostAfterRuns: WindowsHostIdentity | null;
  readonly machine: MachineDescriptor | null;
  readonly machineId: string;
  readonly profileLineage: PromptApiProfileLineage;
  readonly qualityTier: QualityTier;
  readonly runScript: typeof PROMPT_API_SPIKE_SCENARIO;
  readonly targetDisplayMode: string;
}

export interface RuntimeCollectors {
  readonly frameWindowFailureMessage: string | null;
  readonly frames: readonly RenderFrameSample[];
  readonly longTaskFailureMessage: string | null;
  readonly longTaskDurationsMs: readonly number[];
}

export interface RuntimeCapture {
  readonly budgetChecks: readonly BudgetCheck[];
  readonly callbackPacingDiagnostics: readonly DiagnosticCheck[];
  readonly downloadFlow: Metric<PromptApiSpikeTelemetrySnapshot["download"]>;
  readonly firstTokenLatency: Metric<number>;
  readonly frameImpact: Metric<PromptApiCallbackPacing>;
  readonly longTasks: Metric<readonly number[]>;
  readonly telemetry: PromptApiSpikeTelemetrySnapshot;
}

interface PromptApiSpikeReport {
  readonly artifactDigest: string;
  readonly budgetChecks: readonly BudgetCheck[];
  readonly callbackPacingDiagnostics: readonly DiagnosticCheck[];
  readonly downloadFlow: Metric<PromptApiSpikeTelemetrySnapshot["download"]>;
  readonly environment: PromptEnvironmentIdentity;
  readonly errors: readonly string[];
  readonly evictionExercise: Readonly<{ readonly reason: string; readonly state: "unsupported" }>;
  readonly firstTokenLatency: Metric<number>;
  readonly frameImpact: Metric<PromptApiCallbackPacing>;
  readonly generatedAt: string;
  readonly longTasks: Metric<readonly number[]>;
  readonly modelComponent: PromptApiModelComponentMetric;
  readonly passed: boolean;
  readonly scenario: typeof PROMPT_API_SPIKE_SCENARIO;
  readonly schemaVersion: typeof PROMPT_API_SPIKE_REPORT_SCHEMA_VERSION;
  readonly source: SourceIdentity;
  readonly telemetry: PromptApiSpikeTelemetrySnapshot | null;
}

export async function runPromptApiSpikeEntrypoint(): Promise<void> {
  const failure = await executePromptApiEntrypoint(main, writeFatalFailureReport);
  if (failure !== null) {
    console.error(`Prompt API spike failed: ${failure.message}`);
    if (failure.reportFailure !== null) {
      console.error(`Prompt API fatal-report write failed: ${failure.reportFailure}`);
    }
    process.exitCode = 1;
  }
}

export async function executePromptApiEntrypoint(
  run: () => Promise<void>,
  reportFatal: (message: string) => Promise<void>,
): Promise<Readonly<{ message: string; reportFailure: string | null }> | null> {
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
  const profile = await createFreshPromptApiProfile(resolvePromptProfileRoot());
  try {
    await runPromptApiSpike(machineId, tier, chromePin, executablePath, executableSha256, profile);
  } finally {
    await removePromptApiProfile(profile);
  }
}

export async function removePromptApiProfile(
  profile: Pick<FreshPromptApiProfile, "remove">,
  warn: (message: string) => void = console.warn,
): Promise<void> {
  await profile.remove().catch((error: unknown) => {
    warn(`Prompt API temporary-profile cleanup failed: ${errorMessage(error)}`);
  });
}

async function runPromptApiSpike(
  machineId: string,
  tier: QualityTier,
  chromePin: ChromePin,
  executablePath: string,
  executableSha256: string,
  profile: FreshPromptApiProfile,
): Promise<void> {
  const profileRoot = profile.root;
  const profileLineage = profile.lineage;
  const validatedBuild = await readAndValidateBuildManifest(buildRoot);
  const source = await readSourceIdentity(repositoryRoot);
  const server = createLocalServer({ root: buildRoot });
  const address = await listenLocalServer(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const errors: string[] = [];
  let environment = emptyEnvironment(machineId, profileLineage, tier);
  let capture: RuntimeCapture | null = null;

  try {
    const context = await launchPersistentChrome(executablePath, profileRoot, {
      args: PROMPT_API_CHROME_LAUNCH_ARGS,
      ignoreDefaultArgs: PROMPT_API_IGNORED_PLAYWRIGHT_DEFAULT_ARGS,
    });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await installLongTaskObserver(page);
      await page.goto(`${baseUrl}/?promptApiSpike=manual`, { waitUntil: "load" });
      environment = await readEnvironment(
        context,
        page,
        chromePin,
        executableSha256,
        machineId,
        profileLineage,
        tier,
        baseUrl,
      );
      await page.waitForFunction(
        ({ expectedSchemaVersion, expectedSectionSchemaVersion, globalName }) => {
          const telemetry = Reflect.get(globalThis, globalName) as
            | ParallaxTelemetryExport
            | undefined;
          if (telemetry === undefined) return false;
          const snapshot = telemetry.snapshot();
          if (snapshot.schemaVersion !== expectedSchemaVersion) {
            throw new Error(
              `Prompt API telemetry schema mismatch: expected ${expectedSchemaVersion}, received ${snapshot.schemaVersion}`,
            );
          }
          if (snapshot.promptApiSpike.schemaVersion !== expectedSectionSchemaVersion) {
            throw new Error(
              `Prompt API section schema mismatch: expected ${expectedSectionSchemaVersion}, received ${snapshot.promptApiSpike.schemaVersion}`,
            );
          }
          return (
            snapshot.render.state === "ready" &&
            !["idle", "probing"].includes(snapshot.promptApiSpike.state)
          );
        },
        {
          expectedSchemaVersion: TELEMETRY_SCHEMA_VERSION,
          expectedSectionSchemaVersion: PROMPT_API_SPIKE_TELEMETRY_SCHEMA_VERSION,
          globalName: TELEMETRY_GLOBAL_NAME,
        },
        { timeout: 30_000 },
      );
      await installRuntimeCollectors(page);
      let snapshot = await readTelemetry(page);
      if (snapshot.promptApiSpike.state === "awaiting-user-activation") {
        await page.locator("#prompt-api-start").click();
        const completion = await waitForPromptApiCompletion(
          async () => (await readTelemetry(page)).promptApiSpike,
        );
        if (completion.failureMessage !== null) errors.push(completion.failureMessage);
        snapshot = await readTelemetry(page);
      }

      if (snapshot.promptApiSpike.state === "completed") {
        await context.setOffline(true);
        await page.locator("#prompt-api-offline").click();
        await page.waitForFunction(
          ({ globalName }) => {
            const telemetry = Reflect.get(globalThis, globalName) as ParallaxTelemetryExport;
            return ["measured", "failed"].includes(
              telemetry.snapshot().promptApiSpike.offline.state,
            );
          },
          { globalName: TELEMETRY_GLOBAL_NAME },
          { timeout: 120_000 },
        );
        snapshot = await readTelemetry(page);
      }
      const collectors = await readRuntimeCollectors(page);
      capture = resolveRuntimeCapture(snapshot.promptApiSpike, collectors, tier, profileLineage);
    } catch (error: unknown) {
      errors.push(errorMessage(error));
    } finally {
      await context.close();
    }
  } finally {
    await stopLocalServer(server);
  }

  environment = revalidateHostEnvironment(environment, await tryReadWindowsHostIdentity());
  await validatePostRunIdentity(validatedBuild.artifactDigest, source, errors);
  const modelComponent = await measurePromptApiModelComponent(profileRoot);
  const generatedAt = new Date().toISOString();
  const report = createReport(
    validatedBuild.artifactDigest,
    source,
    generatedAt,
    environment,
    capture,
    modelComponent,
    errors,
  );
  await writeReport(report);
  console.log(formatReport(report));
  process.exitCode = report.passed ? 0 : 1;
}

async function readEnvironment(
  context: import("playwright-core").BrowserContext,
  page: Page,
  chromePin: ChromePin,
  executableSha256: string,
  machineId: string,
  profileLineage: PromptApiProfileLineage,
  tier: QualityTier,
  baseUrl: string,
): Promise<PromptEnvironmentIdentity> {
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
    const launch = validatePromptApiChromeCommandLine(commandLine);
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
    return createPromptEnvironmentIdentity({
      adapter,
      browser: Object.freeze({
        channel: chromePin.channel,
        executableSha256,
        jsVersion: version.jsVersion,
        launch,
        product: version.product,
        revision: chromePin.revision,
        userAgent: version.userAgent,
        version: actualVersion,
      }),
      browserDisplay,
      gate,
      gpuDevices: systemInfo.gpu.devices,
      host,
      hostAfterRuns: null,
      machine,
      profileLineage,
      qualityTier: tier,
      requestedMachineId: machineId,
      runScript: PROMPT_API_SPIKE_SCENARIO,
    });
  } finally {
    await session.detach().catch(() => undefined);
  }
}

export function resolveRuntimeCapture(
  telemetry: PromptApiSpikeTelemetrySnapshot,
  collectors: RuntimeCollectors,
  tier: QualityTier,
  lineage: PromptApiProfileLineage,
): RuntimeCapture {
  const intervals = collectors.frames.flatMap((frame) =>
    frame.presentIntervalMs === null ? [] : [frame.presentIntervalMs],
  );
  const frameImpact: RuntimeCapture["frameImpact"] = evaluatePromptApiCallbackPacing(
    intervals,
    collectors.frameWindowFailureMessage,
  );
  const firstTokenLatency: RuntimeCapture["firstTokenLatency"] =
    telemetry.inference === null
      ? invalid("Prompt inference did not produce first-token telemetry")
      : measured(telemetry.inference.firstChunkLatencyMs);
  const longTasks: RuntimeCapture["longTasks"] =
    collectors.longTaskFailureMessage === null
      ? measured(Object.freeze([...collectors.longTaskDurationsMs]))
      : invalid(collectors.longTaskFailureMessage);
  const downloadFlow = evaluatePromptApiDownloadEvidence({
    download: telemetry.download,
    initialAvailability: telemetry.initialAvailability,
    profile: lineage.profile,
  });
  const budgetChecks =
    firstTokenLatency.state === "measured" && longTasks.state === "measured"
      ? evaluatePromptApiBudgets({
          firstChunkLatencyMs: firstTokenLatency.value,
          longTasksOver50Ms: longTasks.value.filter((value) => value > 50).length,
        })
      : Object.freeze([]);
  const callbackPacingDiagnostics =
    frameImpact.state === "measured"
      ? evaluatePromptApiCallbackPacingDiagnostics(frameImpact.value, tier)
      : Object.freeze([]);
  return Object.freeze({
    budgetChecks,
    callbackPacingDiagnostics,
    downloadFlow,
    firstTokenLatency,
    frameImpact,
    longTasks,
    telemetry,
  });
}

function createReport(
  artifactDigest: string,
  source: SourceIdentity,
  generatedAt: string,
  environment: PromptEnvironmentIdentity,
  capture: RuntimeCapture | null,
  modelComponent: PromptApiModelComponentMetric,
  errors: readonly string[],
): PromptApiSpikeReport {
  const missingDownload = invalid<PromptApiSpikeTelemetrySnapshot["download"]>(
    "Prompt API runtime capture did not complete",
  );
  const missingFirstToken = invalid<number>("Prompt API runtime capture did not complete");
  const missingFrames = invalid<PromptApiCallbackPacing>(
    "Prompt API runtime capture did not complete",
  );
  const missingLongTasks = invalid<readonly number[]>(
    "Prompt API runtime capture did not complete",
  );
  const budgetChecks = capture?.budgetChecks ?? Object.freeze([]);
  const callbackPacingDiagnostics = capture?.callbackPacingDiagnostics ?? Object.freeze([]);
  const telemetry = capture?.telemetry ?? null;
  const passed = evaluatePromptApiRunPass({
    budgetChecks,
    concurrentSessionsMeasured: telemetry !== null && telemetry.concurrentSessions !== null,
    downloadMeasured: capture?.downloadFlow.state === "measured",
    environmentMeasured: environment.gate.state === "measured",
    errorCount: errors.length,
    firstTokenMeasured: capture?.firstTokenLatency.state === "measured",
    longTasksMeasured: capture?.longTasks.state === "measured",
    modelComponentMeasured: modelComponent.state === "measured",
    offlineMeasured: telemetry?.offline.state === "measured",
    offlinePromptSucceeded: telemetry?.offline.promptSucceeded === true,
    telemetryCompleted: telemetry?.state === "completed",
  });
  return Object.freeze({
    artifactDigest,
    budgetChecks,
    callbackPacingDiagnostics,
    downloadFlow: capture?.downloadFlow ?? missingDownload,
    environment,
    errors: Object.freeze([...errors]),
    evictionExercise: Object.freeze({
      reason:
        "Chrome exposes no supported web or automation API to force Gemini Nano deletion; low-space, policy, and eligibility-based deletion remain manual browser/machine lifecycle exercises.",
      state: "unsupported",
    }),
    firstTokenLatency: capture?.firstTokenLatency ?? missingFirstToken,
    frameImpact: capture?.frameImpact ?? missingFrames,
    generatedAt,
    longTasks: capture?.longTasks ?? missingLongTasks,
    modelComponent,
    passed,
    scenario: PROMPT_API_SPIKE_SCENARIO,
    schemaVersion: PROMPT_API_SPIKE_REPORT_SCHEMA_VERSION,
    source,
    telemetry,
  });
}

export async function installLongTaskObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface LongTaskRecord {
      duration: number;
      startTime: number;
    }
    const records: LongTaskRecord[] = [];
    let failureMessage: string | null = null;
    let observer: PerformanceObserver | null = null;
    if (!PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      failureMessage = "The Long Tasks API is not supported in this window";
    } else {
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            records.push({ duration: entry.duration, startTime: entry.startTime });
          }
        });
        observer.observe({ buffered: true, type: "longtask" });
      } catch (error: unknown) {
        failureMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      }
    }
    Reflect.set(globalThis, "__PARALLAX_PROMPT_LONG_TASKS__", {
      snapshot: () => {
        if (observer !== null) {
          for (const entry of observer.takeRecords()) {
            records.push({ duration: entry.duration, startTime: entry.startTime });
          }
        }
        return { failureMessage, records: [...records] };
      },
    });
  });
}

export async function installRuntimeCollectors(page: Page): Promise<void> {
  await page.evaluate(
    ({ batchFrames, globalName }) => {
      const telemetry = Reflect.get(globalThis, globalName) as ParallaxTelemetryExport;
      const state = {
        endTime: null as number | null,
        frameWindowFailureMessage: null as string | null,
        frames: [] as RenderFrameSample[],
        lastFrameCount: telemetry.snapshot().render.frameCount,
        markerFrameCount: null as number | null,
        recording: false,
        startTime: null as number | null,
      };
      telemetry.subscribe((snapshot) => {
        if (!state.recording && snapshot.promptApiSpike.state === "running-inference") {
          state.recording = true;
          state.startTime = performance.now();
          state.markerFrameCount = snapshot.render.frameCount;
          // render.frameCount can trail the true count at this marker by up to one
          // telemetry batch. Skip that entire guard band so no pre-inference frame
          // can enter the diagnostic window.
          state.lastFrameCount = snapshot.render.frameCount + batchFrames;
        }
        if (state.recording) {
          const advanced = snapshot.render.frameCount - state.lastFrameCount;
          if (advanced > 0) {
            if (advanced > snapshot.render.recentFrames.length) {
              state.frameWindowFailureMessage = `Marker-aligned frame window lost ${advanced - snapshot.render.recentFrames.length} samples to telemetry retention`;
            } else if (state.frameWindowFailureMessage === null) {
              state.frames.push(...snapshot.render.recentFrames.slice(-advanced));
            }
            state.lastFrameCount = snapshot.render.frameCount;
          }
          if (snapshot.promptApiSpike.state !== "running-inference") {
            state.endTime = performance.now();
            state.recording = false;
            if (state.frames.length === 0 && state.frameWindowFailureMessage === null) {
              const advanced =
                state.markerFrameCount === null
                  ? 0
                  : snapshot.render.frameCount - state.markerFrameCount;
              state.frameWindowFailureMessage = `Generation advanced ${advanced} telemetry-counted frames; the ${batchFrames}-frame pre-marker exclusion guard band consumed the entire callback-pacing window`;
            }
          }
        }
      });
      Reflect.set(globalThis, "__PARALLAX_PROMPT_COLLECTORS__", {
        snapshot: () => {
          const start = state.startTime;
          const end = state.endTime;
          const longTaskCollector = Reflect.get(globalThis, "__PARALLAX_PROMPT_LONG_TASKS__") as
            | {
                snapshot(): Readonly<{
                  failureMessage: string | null;
                  records: readonly Readonly<{ duration: number; startTime: number }>[];
                }>;
              }
            | undefined;
          const longTaskSnapshot = longTaskCollector?.snapshot();
          const markerFailure =
            start === null || end === null
              ? "Prompt inference start/end markers were unavailable for long-task attribution"
              : null;
          const longTaskFailureMessage =
            longTaskCollector === undefined
              ? "Pre-navigation long-task observer was not attached"
              : (longTaskSnapshot?.failureMessage ?? markerFailure);
          const longTaskDurationsMs =
            start === null || end === null || longTaskSnapshot === undefined
              ? []
              : longTaskSnapshot.records
                  .filter(
                    (entry) => entry.startTime < end && entry.startTime + entry.duration > start,
                  )
                  .map((entry) => entry.duration);
          return {
            frameWindowFailureMessage: state.frameWindowFailureMessage,
            frames: [...state.frames],
            longTaskFailureMessage,
            longTaskDurationsMs,
          };
        },
      });
    },
    { batchFrames: TELEMETRY_FRAME_BATCH_FRAMES, globalName: TELEMETRY_GLOBAL_NAME },
  );
}

function readRuntimeCollectors(page: Page): Promise<RuntimeCollectors> {
  return page.evaluate(() => {
    const collectors = Reflect.get(globalThis, "__PARALLAX_PROMPT_COLLECTORS__") as {
      snapshot(): RuntimeCollectors;
    };
    return collectors.snapshot();
  });
}

function resolvePromptProfileRoot(): string {
  const override = process.env.PARALLAX_PROMPT_PROFILE_ROOT;
  return resolve(
    override === undefined || override === ""
      ? join(homedir(), ".parallax", "harness", "prompt-api-profiles")
      : override,
  );
}

function emptyEnvironment(
  machineId: string,
  profileLineage: PromptApiProfileLineage,
  tier: QualityTier,
): PromptEnvironmentIdentity {
  return createPromptEnvironmentIdentity({
    adapter: null,
    browser: null,
    browserDisplay: null,
    gate: invalidEnvironmentGate("Environment identity was not collected"),
    gpuDevices: Object.freeze([]),
    host: null,
    hostAfterRuns: null,
    machine: null,
    profileLineage,
    qualityTier: tier,
    requestedMachineId: machineId,
    runScript: PROMPT_API_SPIKE_SCENARIO,
  });
}

export function revalidateHostEnvironment(
  environment: PromptEnvironmentIdentity,
  result: WindowsHostIdentityResult,
): PromptEnvironmentIdentity {
  if (result.state === "invalid") {
    return invalidatePromptEnvironment(environment, result.reason, null);
  }
  if (
    environment.host !== null &&
    JSON.stringify(environment.host) === JSON.stringify(result.host)
  ) {
    return Object.freeze({ ...environment, hostAfterRuns: result.host });
  }
  return invalidatePromptEnvironment(
    environment,
    environment.host === null
      ? "Pre-run Windows host identity was unavailable"
      : "Host environment changed between pre-run and post-run identity probes",
    result.host,
  );
}

export function createPromptEnvironmentIdentity(
  input: Omit<PromptEnvironmentIdentity, "machineId" | "targetDisplayMode"> & {
    readonly requestedMachineId: string;
  },
): PromptEnvironmentIdentity {
  const { requestedMachineId, ...environment } = input;
  return Object.freeze({
    ...environment,
    machineId: input.machine?.id ?? requestedMachineId,
    targetDisplayMode: QUALITY_TIER_PROFILES[input.qualityTier].targetDisplayMode,
  });
}

function invalidatePromptEnvironment(
  environment: PromptEnvironmentIdentity,
  reason: string,
  hostAfterRuns: WindowsHostIdentity | null,
): PromptEnvironmentIdentity {
  const priorReasons = environment.gate.state === "invalid" ? environment.gate.reasons : [];
  return Object.freeze({
    ...environment,
    gate: invalidEnvironmentGate([...priorReasons, reason]),
    hostAfterRuns,
  });
}

async function validatePostRunIdentity(
  artifactDigest: string,
  source: SourceIdentity,
  errors: string[],
): Promise<void> {
  try {
    if ((await readAndValidateBuildManifest(buildRoot)).artifactDigest !== artifactDigest) {
      errors.push("Built artifact identity changed during the Prompt API spike run");
    }
  } catch (error: unknown) {
    errors.push(`Post-run artifact validation failed: ${errorMessage(error)}`);
  }
  try {
    if (JSON.stringify(await readSourceIdentity(repositoryRoot)) !== JSON.stringify(source)) {
      errors.push("Source identity changed during the Prompt API spike run");
    }
  } catch (error: unknown) {
    errors.push(`Post-run source validation failed: ${errorMessage(error)}`);
  }
}

async function writeReport(report: PromptApiSpikeReport): Promise<void> {
  await mkdir(outputRoot, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const machine = safeMachineIdForFilename(report.environment.machineId);
  const stem = `${PROMPT_API_SPIKE_SCENARIO.replace("@", "-")}-${report.artifactDigest.slice(0, 12)}-${machine}-${stamp}`;
  await writeFile(join(outputRoot, `${stem}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(outputRoot, `${stem}.md`), `${formatReport(report)}\n`);
}

async function writeFatalFailureReport(message: string): Promise<void> {
  await mkdir(outputRoot, { recursive: true });
  const generatedAt = new Date().toISOString();
  const machineId = process.env.PARALLAX_MACHINE_ID ?? "unknown-machine";
  const stem = `${PROMPT_API_SPIKE_SCENARIO.replace("@", "-")}-fatal-${safeMachineIdForFilename(machineId)}-${generatedAt.replace(/[:.]/g, "-")}`;
  const report = Object.freeze({
    error: message,
    generatedAt,
    machineId,
    passed: false,
    scenario: PROMPT_API_SPIKE_SCENARIO,
    schema: "prompt-api-spike-failure@1",
  });
  const markdown = [
    `# ${PROMPT_API_SPIKE_SCENARIO} fatal runner failure`,
    "",
    "- Result: **FAIL**",
    `- Machine: ${machineId}`,
    `- Generated: ${generatedAt}`,
    `- Error: ${message}`,
  ].join("\n");
  await writeFile(join(outputRoot, `${stem}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(outputRoot, `${stem}.md`), `${markdown}\n`);
}

function formatReport(report: PromptApiSpikeReport): string {
  const prompt = report.telemetry;
  const model =
    report.modelComponent.state === "measured"
      ? `${formatGib(report.modelComponent.value.bytes)} across ${report.modelComponent.value.files} files`
      : `${report.modelComponent.state} — ${report.modelComponent.reason}`;
  const budgets = report.budgetChecks.map(
    (check) =>
      `- ${check.passed ? "PASS" : "FAIL"}: ${check.metric} ${check.actual.toFixed(2)} <= ${check.limit.toFixed(2)}`,
  );
  const callbackDiagnostics = report.callbackPacingDiagnostics.map(
    (check) =>
      `- ${check.satisfied ? "within reference threshold" : "over reference threshold"}: ${check.metric} ${check.actual.toFixed(2)} vs. ${check.expectedMaximum.toFixed(2)} ms (non-gating)`,
  );
  return [
    `# ${PROMPT_API_SPIKE_SCENARIO}`,
    "",
    `- Result: **${report.passed ? "PASS" : "FAIL"}**`,
    `- Machine / tier / profile: ${report.environment.machineId} / ${report.environment.qualityTier} / ${report.environment.profileLineage.profile}`,
    `- Environment gate: ${report.environment.gate.state}`,
    `- Chrome launch contract: ${report.environment.browser?.launch.modelDeliverySwitchesVerified === true ? `verified; ${report.environment.browser.launch.disabledFeatures.length} Playwright feature suppressions retained (full command line in JSON)` : "not measured"}`,
    `- API state / initial availability: ${prompt?.state ?? "not measured"} / ${prompt?.initialAvailability ?? "not measured"}`,
    `- Execution contexts: window=${String(prompt?.executionContexts.windowExposed)}, dedicated worker=${formatWorkerContext(prompt)}`,
    `- Download flow: ${formatDownloadMetric(report.downloadFlow, prompt?.download ?? null)}`,
    `- First-token latency: ${formatMetric(report.firstTokenLatency, " ms")}`,
    `- Concurrent cloned sessions: ${prompt?.concurrentSessions?.created ?? 0} created from ${prompt?.concurrentSessions?.attempted ?? 0} attempts (target ${prompt?.concurrentSessions?.target ?? 0})`,
    `- Offline reavailability: ${prompt?.offline.state ?? "not measured"} (${prompt?.offline.availability ?? "no availability"})`,
    `- Frame impact: ${formatFrameMetric(report.frameImpact)}`,
    `- Generation-window main-thread long tasks >50 ms: ${report.longTasks.state === "measured" ? report.longTasks.value.filter((value) => value > 50).length : report.longTasks.state}`,
    `- Privileged model-component size: ${model}`,
    `- Eviction exercise: ${report.evictionExercise.state} — ${report.evictionExercise.reason}`,
    "",
    "## Budget checks",
    "",
    ...(budgets.length === 0 ? ["- No complete budget set was produced."] : budgets),
    "",
    "## Callback-pacing diagnostics",
    "",
    ...(callbackDiagnostics.length === 0
      ? ["- No marker-aligned callback-pacing diagnostic was produced."]
      : callbackDiagnostics),
    ...(report.errors.length === 0
      ? []
      : ["", "## Browser/runner errors", "", ...report.errors.map((error) => `- ${error}`)]),
  ].join("\n");
}

function formatWorkerContext(prompt: PromptApiSpikeTelemetrySnapshot | null): string {
  const worker = prompt?.executionContexts.dedicatedWorker;
  if (worker === undefined) return "not measured";
  return worker.state === "measured"
    ? String(worker.exposed)
    : `${worker.state}: ${worker.failureMessage}`;
}

function formatMetric<T>(metric: Metric<T>, suffix = ""): string {
  return metric.state === "measured"
    ? `${typeof metric.value === "number" ? metric.value.toFixed(2) : "measured"}${suffix}`
    : `${metric.state} — ${metric.reason}`;
}

function formatDownloadMetric(
  metric: Metric<PromptApiSpikeTelemetrySnapshot["download"]>,
  observed: PromptApiSpikeTelemetrySnapshot["download"] | null,
): string {
  const download = metric.state === "measured" ? metric.value : observed;
  const detail =
    download === null
      ? ""
      : `; observed ${download.eventsObserved} events, ${download.samples.length} retained samples, max ${(download.maxProgress ?? 0).toFixed(4)}, longest completed forward-progress gap ${download.longestProgressGapMs.toFixed(0)} ms, ${download.regressiveEventsObserved} regressions`;
  return metric.state === "measured"
    ? `measured${detail}`
    : `${metric.state} — ${metric.reason}${detail}`;
}

function formatFrameMetric(metric: Metric<PromptApiCallbackPacing>): string {
  if (metric.state !== "measured") return `${metric.state} — ${metric.reason}`;
  return `n=${metric.value.sampleCount}; p95 ${metric.value.p95.toFixed(2)} ms; max ${metric.value.max.toFixed(2)} ms (non-gating callback heuristic; p99.9 is inapplicable to this short scenario)`;
}

function formatGib(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(3)} GiB (${bytes.toLocaleString("en-US")} bytes)`;
}

function measured<T>(value: T): Readonly<{ state: "measured"; value: T }> {
  return Object.freeze({ state: "measured", value });
}

function invalid<T = unknown>(reason: string): Metric<T> {
  return Object.freeze({ reason, state: "invalid" });
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
}
