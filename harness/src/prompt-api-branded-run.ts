import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  type ParallaxTelemetryExport,
  PROMPT_API_SPIKE_TELEMETRY_SCHEMA_VERSION,
  type PromptApiAvailability,
  type PromptApiInferenceTelemetry,
  type PromptApiSpikeTelemetrySnapshot,
  TELEMETRY_GLOBAL_NAME,
  TELEMETRY_SCHEMA_VERSION,
} from "@parallax/engine";
import type { BrowserContext, Page } from "playwright-core";
import {
  readBrowserDisplayIdentity,
  readChromeCommandLine,
  readWebGpuAdapterIdentityFromProbePage,
} from "./browser-probes.js";
import type { QualityTier } from "./budgets.js";
import { readAndValidateBuildManifest, sha256File } from "./build-manifest.js";
import {
  launchPersistentChrome,
  loadChromePin,
  PROMPT_API_CHROME_LAUNCH_ARGS,
  PROMPT_API_IGNORED_PLAYWRIGHT_DEFAULT_ARGS,
  type PromptApiChromeLaunchEvidence,
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
  type PromptApiEvidence,
  type PromptApiModelComponentMetric,
} from "./prompt-api-model-component.js";
import {
  createFreshPromptApiProfile,
  type FreshPromptApiProfile,
  pruneStalePromptApiProfiles,
} from "./prompt-api-profile.js";
import { executePromptApiEntrypoint, removePromptApiProfile } from "./prompt-api-spike-run.js";
import {
  evaluatePromptApiBrandedDownload,
  PROMPT_API_BRANDED_REPORT_SCHEMA_VERSION,
  PROMPT_API_BRANDED_SCENARIO,
  type PromptApiBrandedDownloadEvidence,
  type PromptApiBrandedInstallSegment,
  type PromptApiBrandedMode,
  waitForPromptApiRestartPoint,
} from "./runs/prompt-api-branded.js";
import { waitForPromptApiCompletion } from "./runs/prompt-api-spike.js";
import { parseQualityTier, QUALITY_TIER_PROFILES } from "./runs/smoke.js";
import { createLocalServer, listenLocalServer, stopLocalServer } from "./server.js";
import { readSourceIdentity, type SourceIdentity } from "./source-identity.js";
import { readTelemetry } from "./telemetry.js";
import { errorMessage } from "./value-utils.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const buildRoot = join(repositoryRoot, "dist");
const outputRoot = join(repositoryRoot, "harness/results");
const machineRoot = join(repositoryRoot, "harness/machines");

interface BrandedBrowserIdentity {
  readonly executablePath: string;
  readonly executableSha256: string;
  readonly jsVersion: string;
  readonly launch: PromptApiChromeLaunchEvidence;
  readonly product: string;
  readonly userAgent: string;
  readonly version: string;
}

export interface AvailabilityTransition {
  readonly availability: PromptApiAvailability | null;
  readonly elapsedMs: number;
  readonly phase: AvailabilityTransitionPhase;
}

export type AvailabilityTransitionPhase =
  | "download-resume"
  | "fresh-profile"
  | "install-completed"
  | "post-install-browser-restart"
  | "post-restart-fixture-completed";

const REQUIRED_SETTLED_AVAILABILITY_PHASES: readonly AvailabilityTransitionPhase[] = Object.freeze([
  "install-completed",
  "post-restart-fixture-completed",
]);

interface ModelStatusPage {
  readonly bodyText: string;
  readonly title: string;
  readonly url: string;
}

interface PromptApiBrandedEnvironment {
  readonly adapter: WebGpuAdapterIdentity | null;
  readonly browserDisplay: BrowserDisplayIdentity | null;
  readonly gate: EnvironmentGateState;
  readonly gpuDevices: readonly CdpGpuDevice[];
  readonly host: WindowsHostIdentity | null;
  readonly hostAfterRuns: WindowsHostIdentity | null;
  readonly machine: MachineDescriptor | null;
  readonly machineId: string;
  readonly qualityTier: QualityTier;
  readonly targetDisplayMode: string;
}

interface PostRestartEvidence {
  readonly initialAvailability: PromptApiAvailability | null;
  readonly offlineAvailability: PromptApiAvailability | null;
  readonly offlineFailureMessage: string | null;
  readonly offlinePromptSucceeded: boolean;
  readonly onlineInference: PromptApiInferenceTelemetry | null;
  readonly onlineAvailability: PromptApiAvailability | null;
  readonly onlineState: PromptApiSpikeTelemetrySnapshot["state"];
  readonly userActivationAtCreate: boolean | null;
}

interface PromptApiBrandedProfileReport {
  readonly availabilityTransitions: readonly AvailabilityTransition[];
  readonly browser: BrandedBrowserIdentity | null;
  readonly download: PromptApiBrandedDownloadEvidence;
  readonly environment: PromptApiBrandedEnvironment;
  readonly errors: readonly string[];
  readonly initialInference: PromptApiInferenceTelemetry | null;
  readonly mode: PromptApiBrandedMode;
  readonly modelComponent: PromptApiModelComponentMetric;
  readonly modelStatus: PromptApiEvidence<ModelStatusPage>;
  readonly passed: boolean;
  readonly postRestart: PostRestartEvidence | null;
  readonly profileId: string;
  readonly segments: readonly PromptApiBrandedInstallSegment[];
}

interface PromptApiBrandedReport {
  readonly artifactDigest: string;
  readonly browserIdentityConsistent: boolean;
  readonly errors: readonly string[];
  readonly generatedAt: string;
  readonly machineId: string;
  readonly minimumChromeVersion: string;
  readonly passed: boolean;
  readonly profiles: readonly PromptApiBrandedProfileReport[];
  readonly scenario: typeof PROMPT_API_BRANDED_SCENARIO;
  readonly schemaVersion: typeof PROMPT_API_BRANDED_REPORT_SCHEMA_VERSION;
  readonly source: SourceIdentity;
}

interface OpenedPromptPage {
  readonly browser: BrandedBrowserIdentity;
  readonly context: BrowserContext;
  readonly environment: PromptApiBrandedEnvironment;
  readonly page: Page;
  readonly snapshot: PromptApiSpikeTelemetrySnapshot;
}

export async function runPromptApiBrandedEntrypoint(): Promise<void> {
  const failure = await executePromptApiEntrypoint(main, writeFatalFailureReport);
  if (failure !== null) {
    console.error(`Prompt API branded qualification failed: ${failure.message}`);
    if (failure.reportFailure !== null) {
      console.error(`Prompt API branded fatal-report write failed: ${failure.reportFailure}`);
    }
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const machineId = requiredEnvironment("PARALLAX_MACHINE_ID");
  const tier = parseQualityTier(process.env.PARALLAX_TIER);
  const minimumChromeVersion = (
    await loadChromePin(join(repositoryRoot, "harness/chrome/stable.json"))
  ).version;
  const executablePath = await resolveBrandedChromeExecutablePath();
  const executableSha256 = (await sha256File(executablePath)).sha256;
  const validatedBuild = await readAndValidateBuildManifest(buildRoot);
  const source = await readSourceIdentity(repositoryRoot);
  const server = createLocalServer({ root: buildRoot });
  const address = await listenLocalServer(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const profiles: PromptApiBrandedProfileReport[] = [];
  const reportErrors: string[] = [];
  const profileRoot = resolveBrandedProfileRoot();
  await pruneStalePromptApiProfiles(profileRoot).catch((error: unknown) => {
    console.warn(`Prompt API stale-profile sweep failed: ${errorMessage(error)}`);
  });
  try {
    for (const mode of ["uninterrupted", "restart-resume"] as const) {
      profiles.push(
        await runBrandedProfile(
          mode,
          baseUrl,
          executablePath,
          executableSha256,
          machineId,
          minimumChromeVersion,
          profileRoot,
          tier,
        ),
      );
    }
  } finally {
    await stopLocalServer(server).catch((error: unknown) => {
      reportErrors.push(`Local evidence server shutdown failed: ${errorMessage(error)}`);
    });
  }
  await validatePostRunIdentity(validatedBuild.artifactDigest, source, reportErrors);
  const browserIdentityConsistent = profilesShareBrowserIdentity(profiles);
  const frozenReportErrors = Object.freeze([...reportErrors]);
  const report: PromptApiBrandedReport = Object.freeze({
    artifactDigest: validatedBuild.artifactDigest,
    browserIdentityConsistent,
    errors: frozenReportErrors,
    generatedAt: new Date().toISOString(),
    machineId: profiles[0]?.environment.machineId ?? machineId,
    minimumChromeVersion,
    passed:
      profiles.length === 2 &&
      profiles.every((profile) => profile.passed) &&
      browserIdentityConsistent &&
      frozenReportErrors.length === 0,
    profiles: Object.freeze(profiles),
    scenario: PROMPT_API_BRANDED_SCENARIO,
    schemaVersion: PROMPT_API_BRANDED_REPORT_SCHEMA_VERSION,
    source,
  });
  await writeReport(report);
  console.log(formatReport(report));
  process.exitCode = report.passed ? 0 : 1;
}

async function validatePostRunIdentity(
  expectedArtifactDigest: string,
  expectedSource: SourceIdentity,
  errors: string[],
): Promise<void> {
  try {
    const currentBuild = await readAndValidateBuildManifest(buildRoot);
    if (currentBuild.artifactDigest !== expectedArtifactDigest) {
      errors.push("Built artifacts changed during the branded Prompt API qualification");
    }
  } catch (error: unknown) {
    errors.push(`Post-run artifact validation failed: ${errorMessage(error)}`);
  }
  try {
    if (
      JSON.stringify(await readSourceIdentity(repositoryRoot)) !== JSON.stringify(expectedSource)
    ) {
      errors.push("Source identity changed during the branded Prompt API qualification");
    }
  } catch (error: unknown) {
    errors.push(`Post-run source validation failed: ${errorMessage(error)}`);
  }
}

async function runBrandedProfile(
  mode: PromptApiBrandedMode,
  baseUrl: string,
  executablePath: string,
  executableSha256: string,
  machineId: string,
  minimumChromeVersion: string,
  profileParent: string,
  tier: QualityTier,
): Promise<PromptApiBrandedProfileReport> {
  const profile = await createFreshPromptApiProfile(profileParent);
  const errors: string[] = [];
  const availabilityTransitions: AvailabilityTransition[] = [];
  const segments: PromptApiBrandedInstallSegment[] = [];
  const profileStartedAt = Date.now();
  let browser: BrandedBrowserIdentity | null = null;
  let environment = emptyBrandedEnvironment(machineId, tier);
  let initialTelemetry: PromptApiSpikeTelemetrySnapshot | null = null;
  let postRestart: PostRestartEvidence | null = null;
  let modelStatus: PromptApiEvidence<ModelStatusPage> = invalid("Model status was not inspected");
  let opened: OpenedPromptPage | null = null;
  try {
    opened = await openPromptPage(
      baseUrl,
      executablePath,
      executableSha256,
      machineId,
      minimumChromeVersion,
      profile,
      tier,
      errors,
    );
    browser = opened.browser;
    environment = opened.environment;
    recordAvailability(availabilityTransitions, "fresh-profile", opened.snapshot, profileStartedAt);
    const firstSegment = await runInstallSegment(opened.page, mode === "restart-resume");
    segments.push(firstSegment.segment);
    if (firstSegment.failureMessage !== null) errors.push(firstSegment.failureMessage);
    initialTelemetry = firstSegment.segment.telemetry;

    if (mode === "restart-resume" && firstSegment.restartReady) {
      const closing = opened;
      opened = null;
      await closeOpenedPromptPage(closing);
      const resumed = await openPromptPage(
        baseUrl,
        executablePath,
        executableSha256,
        machineId,
        minimumChromeVersion,
        profile,
        tier,
        errors,
      );
      opened = resumed;
      verifyBrowserIdentity(browser, resumed.browser, errors);
      verifyEnvironment(resumed.environment, "download resume", errors);
      recordAvailability(
        availabilityTransitions,
        "download-resume",
        resumed.snapshot,
        profileStartedAt,
      );
      const resumedSegment = await runInstallSegment(resumed.page, false);
      segments.push(resumedSegment.segment);
      if (resumedSegment.failureMessage !== null) errors.push(resumedSegment.failureMessage);
      initialTelemetry = resumedSegment.segment.telemetry;
    }

    if (initialTelemetry?.state === "completed") {
      const availability = await readAvailability(opened.page);
      availabilityTransitions.push(
        Object.freeze({
          availability,
          elapsedMs: Date.now() - profileStartedAt,
          phase: "install-completed",
        }),
      );
      const closing = opened;
      opened = null;
      await closeOpenedPromptPage(closing);

      const restarted = await openPromptPage(
        baseUrl,
        executablePath,
        executableSha256,
        machineId,
        minimumChromeVersion,
        profile,
        tier,
        errors,
      );
      opened = restarted;
      verifyBrowserIdentity(browser, restarted.browser, errors);
      verifyEnvironment(restarted.environment, "post-install restart", errors);
      recordAvailability(
        availabilityTransitions,
        "post-install-browser-restart",
        restarted.snapshot,
        profileStartedAt,
      );
      const repeated = await runInstalledFixture(restarted.page);
      if (repeated.failureMessage !== null) errors.push(repeated.failureMessage);
      const onlineAvailability = await readAvailability(restarted.page);
      availabilityTransitions.push(
        Object.freeze({
          availability: onlineAvailability,
          elapsedMs: Date.now() - profileStartedAt,
          phase: "post-restart-fixture-completed",
        }),
      );
      modelStatus = await readModelStatusPage(restarted.context);
      await restarted.context.setOffline(true);
      const offline = await runOfflineFixture(restarted.page);
      if (offline.failureMessage !== null) errors.push(offline.failureMessage);
      postRestart = Object.freeze({
        initialAvailability: restarted.snapshot.initialAvailability,
        offlineAvailability: offline.snapshot.offline.availability,
        offlineFailureMessage: offline.snapshot.offline.failureMessage,
        offlinePromptSucceeded: offline.snapshot.offline.promptSucceeded === true,
        onlineAvailability,
        onlineInference: repeated.snapshot.inference,
        onlineState: repeated.snapshot.state,
        userActivationAtCreate: repeated.snapshot.userActivationAtCreate,
      });
    }
  } catch (error: unknown) {
    errors.push(errorMessage(error));
  } finally {
    const closing = opened;
    opened = null;
    if (closing !== null) {
      await closeOpenedPromptPage(closing).catch((error: unknown) => {
        errors.push(`Chrome shutdown failed: ${errorMessage(error)}`);
      });
    }
  }

  environment = revalidateBrandedEnvironment(environment, await tryReadWindowsHostIdentity());
  const modelComponent = await measurePromptApiModelComponent(profile.root);
  await removePromptApiProfile(profile);
  const download = evaluatePromptApiBrandedDownload(mode, segments);
  const frozenErrors = Object.freeze([...errors]);
  const passed = evaluateProfilePass({
    availabilityTransitions,
    browser,
    download,
    environment,
    errors: frozenErrors,
    initialTelemetry,
    modelComponent,
    modelStatus,
    postRestart,
  });
  return Object.freeze({
    availabilityTransitions: Object.freeze([...availabilityTransitions]),
    browser,
    download,
    environment,
    errors: frozenErrors,
    initialInference: initialTelemetry?.inference ?? null,
    mode,
    modelComponent,
    modelStatus,
    passed,
    postRestart,
    profileId: profile.lineage.id,
    segments: Object.freeze([...segments]),
  });
}

async function closeOpenedPromptPage(opened: OpenedPromptPage): Promise<void> {
  await Promise.all([
    opened.page.removeAllListeners("console", { behavior: "wait" }),
    opened.page.removeAllListeners("pageerror", { behavior: "wait" }),
  ]);
  await closeBrowserContext(opened.context);
}

async function closeBrowserContext(context: BrowserContext): Promise<void> {
  try {
    await context.close();
  } catch (error: unknown) {
    const browser = context.browser();
    let fallbackFailure: string | null = null;
    if (browser !== null) {
      try {
        await browser.close();
      } catch (fallbackError: unknown) {
        fallbackFailure = errorMessage(fallbackError);
      }
    }
    throw new Error(
      `Persistent Chrome context close failed: ${errorMessage(error)}${fallbackFailure === null ? "" : `; browser fallback close failed: ${fallbackFailure}`}`,
    );
  }
}

async function runInstallSegment(
  page: Page,
  interruptForRestart: boolean,
): Promise<
  Readonly<{
    failureMessage: string | null;
    restartReady: boolean;
    segment: PromptApiBrandedInstallSegment;
  }>
> {
  const initial = await readTelemetry(page);
  if (initial.promptApiSpike.state !== "awaiting-user-activation") {
    return Object.freeze({
      failureMessage: `Prompt install page was not activation-ready: ${initial.promptApiSpike.state}`,
      restartReady: false,
      segment: Object.freeze({
        activatedAtEpochMs: Date.now(),
        initialAvailability: initial.promptApiSpike.initialAvailability,
        outcome: "failed",
        telemetry: initial.promptApiSpike,
      }),
    });
  }
  const activatedAtEpochMs = Date.now();
  await page.locator("#prompt-api-start").click();
  if (interruptForRestart) {
    const result = await waitForPromptApiRestartPoint(
      async () => (await readTelemetry(page)).promptApiSpike,
    );
    return Object.freeze({
      failureMessage: result.failureMessage,
      restartReady: result.readyForRestart,
      segment: Object.freeze({
        activatedAtEpochMs,
        initialAvailability: initial.promptApiSpike.initialAvailability,
        outcome: result.readyForRestart ? "interrupted-for-restart" : "failed",
        telemetry: result.snapshot,
      }),
    });
  }
  const result = await waitForPromptApiCompletion(
    async () => (await readTelemetry(page)).promptApiSpike,
  );
  return Object.freeze({
    failureMessage: result.failureMessage,
    restartReady: false,
    segment: Object.freeze({
      activatedAtEpochMs,
      initialAvailability: initial.promptApiSpike.initialAvailability,
      outcome: result.snapshot.state === "completed" ? "completed" : "failed",
      telemetry: result.snapshot,
    }),
  });
}

async function runInstalledFixture(page: Page) {
  const initial = await readTelemetry(page);
  if (initial.promptApiSpike.state !== "awaiting-user-activation") {
    return Object.freeze({
      failureMessage: `Post-restart fixture was not activation-ready: ${initial.promptApiSpike.state}`,
      snapshot: initial.promptApiSpike,
    });
  }
  await page.locator("#prompt-api-start").click();
  return waitForPromptApiCompletion(async () => (await readTelemetry(page)).promptApiSpike);
}

async function runOfflineFixture(page: Page) {
  const before = await readTelemetry(page);
  if (before.promptApiSpike.state !== "completed") {
    return Object.freeze({
      failureMessage: `Offline fixture requires completed post-restart inference, received ${before.promptApiSpike.state}`,
      snapshot: before.promptApiSpike,
    });
  }
  await page.locator("#prompt-api-offline").click();
  try {
    await page.waitForFunction(
      ({ globalName }) => {
        const telemetry = Reflect.get(globalThis, globalName) as ParallaxTelemetryExport;
        return ["measured", "failed"].includes(telemetry.snapshot().promptApiSpike.offline.state);
      },
      { globalName: TELEMETRY_GLOBAL_NAME },
      { polling: 250, timeout: 120_000 },
    );
  } catch (error: unknown) {
    return Object.freeze({
      failureMessage: `Offline fixture did not settle: ${errorMessage(error)}`,
      snapshot: (await readTelemetry(page)).promptApiSpike,
    });
  }
  const snapshot = (await readTelemetry(page)).promptApiSpike;
  return Object.freeze({
    failureMessage:
      snapshot.offline.state === "measured" && snapshot.offline.promptSucceeded === true
        ? null
        : (snapshot.offline.failureMessage ?? "Offline fixture did not produce streamed output"),
    snapshot,
  });
}

async function openPromptPage(
  baseUrl: string,
  executablePath: string,
  executableSha256: string,
  machineId: string,
  minimumChromeVersion: string,
  profile: FreshPromptApiProfile,
  tier: QualityTier,
  errors: string[],
): Promise<OpenedPromptPage> {
  const executableShaBeforeLaunch = (await sha256File(executablePath)).sha256;
  if (executableShaBeforeLaunch !== executableSha256) {
    errors.push(
      `Branded Chrome executable changed before launch: ${executableSha256} -> ${executableShaBeforeLaunch}`,
    );
  }
  const context = await launchPersistentChrome(executablePath, profile.root, {
    args: PROMPT_API_CHROME_LAUNCH_ARGS,
    ignoreDefaultArgs: PROMPT_API_IGNORED_PLAYWRIGHT_DEFAULT_ARGS,
  });
  try {
    const executableShaAfterLaunch = (await sha256File(executablePath)).sha256;
    if (executableShaAfterLaunch !== executableShaBeforeLaunch) {
      errors.push(
        `Branded Chrome executable changed during launch: ${executableShaBeforeLaunch} -> ${executableShaAfterLaunch}`,
      );
    }
    const page = context.pages()[0] ?? (await context.newPage());
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const environment = await readBrandedEnvironment(context, page, baseUrl, machineId, tier);
    await page.goto(`${baseUrl}/?promptApiSpike=branded`, { waitUntil: "load" });
    await page.waitForFunction(
      ({ expectedSchemaVersion, expectedSectionSchemaVersion, globalName }) => {
        const telemetry = Reflect.get(globalThis, globalName) as
          | ParallaxTelemetryExport
          | undefined;
        if (telemetry === undefined) return false;
        const snapshot = telemetry.snapshot();
        if (snapshot.schemaVersion !== expectedSchemaVersion) {
          throw new Error(`Telemetry schema mismatch: ${snapshot.schemaVersion}`);
        }
        if (snapshot.promptApiSpike.schemaVersion !== expectedSectionSchemaVersion) {
          throw new Error(
            `Prompt telemetry schema mismatch: ${snapshot.promptApiSpike.schemaVersion}`,
          );
        }
        return !["idle", "probing"].includes(snapshot.promptApiSpike.state);
      },
      {
        expectedSchemaVersion: TELEMETRY_SCHEMA_VERSION,
        expectedSectionSchemaVersion: PROMPT_API_SPIKE_TELEMETRY_SCHEMA_VERSION,
        globalName: TELEMETRY_GLOBAL_NAME,
      },
      { polling: 250, timeout: 30_000 },
    );
    return Object.freeze({
      browser: await readBrowserIdentity(
        context,
        executablePath,
        executableShaAfterLaunch,
        minimumChromeVersion,
      ),
      context,
      environment,
      page,
      snapshot: (await readTelemetry(page)).promptApiSpike,
    });
  } catch (error: unknown) {
    await closeBrowserContext(context).catch((closeError: unknown) => {
      errors.push(`Chrome cleanup after page setup failure failed: ${errorMessage(closeError)}`);
    });
    throw error;
  }
}

async function readBrandedEnvironment(
  context: BrowserContext,
  page: Page,
  baseUrl: string,
  machineId: string,
  tier: QualityTier,
): Promise<PromptApiBrandedEnvironment> {
  const machine = await loadMachineDescriptor(machineRoot, machineId).catch(() => null);
  const hostResult = await tryReadWindowsHostIdentity();
  const host = hostResult.state === "measured" ? hostResult.host : null;
  const browser = context.browser();
  if (browser === null) throw new Error("Playwright did not expose branded Chrome");
  const session = await browser.newBrowserCDPSession();
  try {
    const systemInfo = (await session.send("SystemInfo.getInfo")) as {
      gpu: { devices: readonly CdpGpuDevice[] };
    };
    const primaryGpu = systemInfo.gpu.devices[0];
    if (primaryGpu === undefined) throw new Error("CDP did not report a primary GPU");
    const [adapter, browserDisplay] = await Promise.all([
      readWebGpuAdapterIdentityFromProbePage(context, baseUrl),
      readBrowserDisplayIdentity(context, page),
    ]);
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
    return Object.freeze({
      adapter,
      browserDisplay,
      gate,
      gpuDevices: Object.freeze([...systemInfo.gpu.devices]),
      host,
      hostAfterRuns: null,
      machine,
      machineId: machine?.id ?? machineId,
      qualityTier: tier,
      targetDisplayMode: QUALITY_TIER_PROFILES[tier].targetDisplayMode,
    });
  } finally {
    await session.detach().catch(() => undefined);
  }
}

async function readBrowserIdentity(
  context: BrowserContext,
  executablePath: string,
  executableSha256: string,
  minimumChromeVersion: string,
): Promise<BrandedBrowserIdentity> {
  const browser = context.browser();
  if (browser === null) throw new Error("Playwright did not expose branded Chrome");
  const session = await browser.newBrowserCDPSession();
  try {
    const version = (await session.send("Browser.getVersion")) as {
      jsVersion: string;
      product: string;
      userAgent: string;
    };
    if (!version.product.startsWith("Chrome/")) {
      throw new Error(`Expected installed branded Chrome, received ${version.product}`);
    }
    const actualVersion = version.product.replace(/^Chrome\//, "");
    if (!isChromeVersionAtLeast(actualVersion, minimumChromeVersion)) {
      throw new Error(
        `Installed branded Chrome ${actualVersion} is older than pinned Stable ${minimumChromeVersion}`,
      );
    }
    const commandLine = await readChromeCommandLine(context);
    return Object.freeze({
      executablePath,
      executableSha256,
      jsVersion: version.jsVersion,
      launch: validatePromptApiChromeCommandLine(commandLine),
      product: version.product,
      userAgent: version.userAgent,
      version: actualVersion,
    });
  } finally {
    await session.detach().catch(() => undefined);
  }
}

async function readAvailability(page: Page): Promise<PromptApiAvailability> {
  const value = await page.evaluate(async () => {
    const languageModel = Reflect.get(globalThis, "LanguageModel") as
      | { availability(): Promise<unknown> }
      | undefined;
    return languageModel?.availability();
  });
  if (!isPromptApiAvailability(value)) {
    throw new Error(`Prompt API returned invalid availability ${String(value)}`);
  }
  return value;
}

async function readModelStatusPage(
  context: BrowserContext,
): Promise<PromptApiEvidence<ModelStatusPage>> {
  const page = await context.newPage();
  try {
    await page.goto("chrome://on-device-internals/", { waitUntil: "load", timeout: 30_000 });
    const value = await page.evaluate(() => ({
      bodyText: document.body.innerText.slice(0, 20_000),
      title: document.title,
      url: location.href,
    }));
    return evaluateModelStatusPage(value);
  } catch (error: unknown) {
    return invalid(`Chrome model-status inspection failed: ${errorMessage(error)}`);
  } finally {
    await page.close().catch(() => undefined);
  }
}

export function evaluateModelStatusPage(
  value: ModelStatusPage,
): PromptApiEvidence<ModelStatusPage> {
  if (value.url === "chrome://debug-webuis-disabled/?host=chrome://on-device-internals/") {
    return unsupported(
      "Chrome disables chrome://on-device-internals in this automation session; web-visible availability and post-shutdown component inspection remain authoritative",
    );
  }
  if (!value.url.startsWith("chrome://on-device-internals")) {
    return invalid(`Chrome model-status inspection reached unexpected URL ${value.url}`);
  }
  if (value.bodyText.trim() === "") return invalid("Chrome model-status page was empty");
  if (/internal debug pages are disabled/i.test(value.bodyText)) {
    return invalid("Chrome reported that internal model-status pages are disabled");
  }
  if (!/model status/i.test(value.bodyText)) {
    return invalid("Chrome internals did not expose the Model Status surface");
  }
  if (
    !/(?:model name|foundational model state|model version|folder size|model path)[ \t]*:[ \t]*\S+/i.test(
      value.bodyText,
    )
  ) {
    return invalid("Chrome Model Status surface did not expose a populated model detail");
  }
  return measured(Object.freeze(value));
}

function evaluateProfilePass(input: {
  readonly availabilityTransitions: readonly AvailabilityTransition[];
  readonly browser: BrandedBrowserIdentity | null;
  readonly download: PromptApiBrandedDownloadEvidence;
  readonly environment: PromptApiBrandedEnvironment;
  readonly errors: readonly string[];
  readonly initialTelemetry: PromptApiSpikeTelemetrySnapshot | null;
  readonly modelComponent: PromptApiModelComponentMetric;
  readonly modelStatus: PromptApiEvidence<ModelStatusPage>;
  readonly postRestart: PostRestartEvidence | null;
}): boolean {
  return (
    hasRequiredSettledAvailability(input.availabilityTransitions) &&
    input.browser !== null &&
    input.download.state === "measured" &&
    input.environment.gate.state === "measured" &&
    input.initialTelemetry?.state === "completed" &&
    input.initialTelemetry.inference !== null &&
    input.initialTelemetry.userActivationAtCreate === true &&
    input.modelComponent.state === "measured" &&
    input.modelComponent.value.bytes > 0 &&
    input.modelComponent.value.files > 0 &&
    (input.modelStatus.state === "measured" || input.modelStatus.state === "unsupported") &&
    input.postRestart?.onlineAvailability === "available" &&
    input.postRestart.onlineState === "completed" &&
    input.postRestart.onlineInference !== null &&
    input.postRestart.userActivationAtCreate === true &&
    input.postRestart.offlineAvailability === "available" &&
    input.postRestart.offlinePromptSucceeded &&
    input.errors.length === 0
  );
}

export function hasRequiredSettledAvailability(
  transitions: readonly AvailabilityTransition[],
): boolean {
  return REQUIRED_SETTLED_AVAILABILITY_PHASES.every((phase) =>
    transitions.some(
      (transition) => transition.phase === phase && transition.availability === "available",
    ),
  );
}

function recordAvailability(
  transitions: AvailabilityTransition[],
  phase: AvailabilityTransitionPhase,
  snapshot: PromptApiSpikeTelemetrySnapshot,
  startedAt: number,
): void {
  transitions.push(
    Object.freeze({
      availability: snapshot.initialAvailability,
      elapsedMs: Date.now() - startedAt,
      phase,
    }),
  );
}

function verifyBrowserIdentity(
  expected: BrandedBrowserIdentity,
  actual: BrandedBrowserIdentity,
  errors: string[],
): void {
  if (
    expected.version !== actual.version ||
    expected.executableSha256 !== actual.executableSha256
  ) {
    errors.push(
      `Branded Chrome identity changed across restart: ${expected.version}/${expected.executableSha256} -> ${actual.version}/${actual.executableSha256}`,
    );
  }
}

function profilesShareBrowserIdentity(profiles: readonly PromptApiBrandedProfileReport[]): boolean {
  const first = profiles[0]?.browser;
  return (
    first !== null &&
    first !== undefined &&
    profiles.length === 2 &&
    profiles.every(
      (profile) =>
        profile.browser?.version === first.version &&
        profile.browser.executableSha256 === first.executableSha256,
    )
  );
}

export function isChromeVersionAtLeast(actual: string, minimum: string): boolean {
  const actualParts = parseChromeVersion(actual);
  const minimumParts = parseChromeVersion(minimum);
  if (actualParts === null || minimumParts === null) return false;
  const length = Math.max(actualParts.length, minimumParts.length);
  for (let index = 0; index < length; index += 1) {
    const actualPart = actualParts[index] ?? 0;
    const minimumPart = minimumParts[index] ?? 0;
    if (actualPart > minimumPart) return true;
    if (actualPart < minimumPart) return false;
  }
  return true;
}

function parseChromeVersion(value: string): readonly number[] | null {
  if (!/^\d+(?:\.\d+)*$/.test(value)) return null;
  const parts = value.split(".").map(Number);
  return parts.every((part) => Number.isSafeInteger(part) && part >= 0) ? parts : null;
}

function verifyEnvironment(
  environment: PromptApiBrandedEnvironment,
  phase: string,
  errors: string[],
): void {
  if (environment.gate.state === "invalid") {
    errors.push(`${phase} environment was invalid: ${environment.gate.reasons.join("; ")}`);
  }
}

function emptyBrandedEnvironment(
  machineId: string,
  tier: QualityTier,
): PromptApiBrandedEnvironment {
  return Object.freeze({
    adapter: null,
    browserDisplay: null,
    gate: invalidEnvironmentGate("Environment identity was not collected"),
    gpuDevices: Object.freeze([]),
    host: null,
    hostAfterRuns: null,
    machine: null,
    machineId,
    qualityTier: tier,
    targetDisplayMode: QUALITY_TIER_PROFILES[tier].targetDisplayMode,
  });
}

function revalidateBrandedEnvironment(
  environment: PromptApiBrandedEnvironment,
  result: WindowsHostIdentityResult,
): PromptApiBrandedEnvironment {
  if (result.state === "invalid") {
    return invalidateBrandedEnvironment(environment, result.reason, null);
  }
  if (
    environment.host !== null &&
    JSON.stringify(environment.host) === JSON.stringify(result.host)
  ) {
    return Object.freeze({ ...environment, hostAfterRuns: result.host });
  }
  return invalidateBrandedEnvironment(
    environment,
    "Host identity changed or was unavailable after the branded Prompt API run",
    result.host,
  );
}

function invalidateBrandedEnvironment(
  environment: PromptApiBrandedEnvironment,
  reason: string,
  hostAfterRuns: WindowsHostIdentity | null,
): PromptApiBrandedEnvironment {
  const existingReasons =
    environment.gate.state === "invalid" ? environment.gate.reasons : Object.freeze([]);
  return Object.freeze({
    ...environment,
    gate: invalidEnvironmentGate([...existingReasons, reason]),
    hostAfterRuns,
  });
}

export async function resolveBrandedChromeExecutablePath(): Promise<string> {
  const override = process.env.PARALLAX_BRANDED_CHROME_PATH;
  const candidates =
    override !== undefined && override !== ""
      ? [resolve(override)]
      : process.platform === "win32"
        ? [
            join(
              process.env.ProgramFiles ?? "C:\\Program Files",
              "Google/Chrome/Application/chrome.exe",
            ),
            join(
              process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
              "Google/Chrome/Application/chrome.exe",
            ),
            join(process.env.LOCALAPPDATA ?? homedir(), "Google/Chrome/Application/chrome.exe"),
          ]
        : process.platform === "darwin"
          ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
          : ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome"];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return resolve(candidate);
    } catch {
      // Try the next conventional branded-Chrome install location.
    }
  }
  throw new Error(
    `Installed branded Chrome was not found. Checked: ${candidates.join(", ")}. Set PARALLAX_BRANDED_CHROME_PATH to the executable.`,
  );
}

function resolveBrandedProfileRoot(): string {
  const override = process.env.PARALLAX_PROMPT_BRANDED_PROFILE_ROOT;
  return resolve(
    override === undefined || override === ""
      ? join(homedir(), ".parallax", "harness", "prompt-api-branded-profiles")
      : override,
  );
}

async function writeReport(report: PromptApiBrandedReport): Promise<void> {
  await mkdir(outputRoot, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const stem = `${PROMPT_API_BRANDED_SCENARIO.replace("@", "-")}-${report.artifactDigest.slice(0, 12)}-${safeMachineIdForFilename(report.machineId)}-${stamp}`;
  await writeFile(join(outputRoot, `${stem}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(outputRoot, `${stem}.md`), `${formatReport(report)}\n`);
}

async function writeFatalFailureReport(message: string): Promise<void> {
  await mkdir(outputRoot, { recursive: true });
  const generatedAt = new Date().toISOString();
  const machineId = process.env.PARALLAX_MACHINE_ID ?? "unknown-machine";
  const stem = `${PROMPT_API_BRANDED_SCENARIO.replace("@", "-")}-fatal-${safeMachineIdForFilename(machineId)}-${generatedAt.replace(/[:.]/g, "-")}`;
  const report = Object.freeze({
    error: message,
    generatedAt,
    machineId,
    passed: false,
    scenario: PROMPT_API_BRANDED_SCENARIO,
    schema: "prompt-api-branded-failure@1",
  });
  await writeFile(join(outputRoot, `${stem}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(
    join(outputRoot, `${stem}.md`),
    `# ${PROMPT_API_BRANDED_SCENARIO} fatal runner failure\n\n- Result: **FAIL**\n- Machine: ${machineId}\n- Generated: ${generatedAt}\n- Error: ${message}\n`,
  );
}

function formatReport(report: PromptApiBrandedReport): string {
  const lines = [
    `# ${PROMPT_API_BRANDED_SCENARIO}`,
    "",
    `- Result: **${report.passed ? "PASS" : "FAIL"}**`,
    `- Machine: ${report.machineId}`,
    `- Minimum Chrome version: ${report.minimumChromeVersion}`,
    `- Artifact: ${report.artifactDigest}`,
    `- Browser identity across profiles: ${report.browserIdentityConsistent ? "consistent" : "changed or not measured"}`,
  ];
  if (report.errors.length > 0) {
    lines.push("", "## Aggregate errors", "", ...report.errors.map((error) => `- ${error}`));
  }
  for (const profile of report.profiles) {
    const download =
      profile.download.state === "measured"
        ? `${formatDuration(profile.download.value.downloadDurationMs)} total; longest in-process forward-progress gap ${formatDuration(profile.download.value.longestInProcessProgressGapMs)}; restart observation gap ${profile.download.value.restartObservationGapMs === null ? "not applicable" : formatDuration(profile.download.value.restartObservationGapMs)}; ${profile.download.value.eventsObserved} events`
        : `${profile.download.state} — ${profile.download.reason}`;
    const component =
      profile.modelComponent.state === "measured"
        ? `${formatGib(profile.modelComponent.value.bytes)} across ${profile.modelComponent.value.files} files`
        : `${profile.modelComponent.state} — ${profile.modelComponent.reason}`;
    lines.push(
      "",
      `## ${profile.mode}`,
      "",
      `- Result: **${profile.passed ? "PASS" : "FAIL"}**`,
      `- Chrome: ${profile.browser?.product ?? "not measured"}`,
      `- Environment / tier: ${profile.environment.gate.state} / ${profile.environment.qualityTier}`,
      `- Download: ${download}`,
      `- Initial fixture: ${formatInference(profile.initialInference)}`,
      `- Post-restart fixture: ${formatInference(profile.postRestart?.onlineInference ?? null)}`,
      `- Offline repeat: ${profile.postRestart?.offlinePromptSucceeded === true ? "streamed successfully" : "failed or not measured"} (${profile.postRestart?.offlineAvailability ?? "no availability"})`,
      `- Model status page: ${profile.modelStatus.state}`,
      `- Model component: ${component}`,
      `- Availability transitions: ${profile.availabilityTransitions.map((transition) => `${transition.phase}=${transition.availability}@${formatDuration(transition.elapsedMs)}`).join(" -> ") || "none"}`,
    );
    if (profile.errors.length > 0) {
      lines.push("", "### Errors", "", ...profile.errors.map((error) => `- ${error}`));
    }
  }
  return lines.join("\n");
}

function formatInference(inference: PromptApiInferenceTelemetry | null): string {
  return inference === null
    ? "not measured"
    : `${inference.chunks} chunks; first ${inference.firstChunkLatencyMs.toFixed(1)} ms; total ${inference.totalLatencyMs.toFixed(1)} ms`;
}

function formatDuration(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(1)} s`;
}

function formatGib(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(3)} GiB (${bytes.toLocaleString("en-US")} bytes)`;
}

function measured<T>(value: T): Readonly<{ state: "measured"; value: T }> {
  return Object.freeze({ state: "measured", value });
}

function invalid<T = unknown>(reason: string): PromptApiEvidence<T> {
  return Object.freeze({ reason, state: "invalid" });
}

function unsupported<T = unknown>(reason: string): PromptApiEvidence<T> {
  return Object.freeze({ reason, state: "unsupported" });
}

export function isPromptApiAvailability(value: unknown): value is PromptApiAvailability {
  return (
    typeof value === "string" &&
    ["unavailable", "downloadable", "downloading", "available"].includes(value)
  );
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
}
