import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  ParallaxTelemetrySnapshot,
  RenderRecoveryProbeKind,
  StreamingRecoveryCheckpoint,
} from "@parallax/engine";
import type { BrowserContext, CDPSession, Page } from "playwright-core";
import {
  readBrowserDisplayIdentity,
  readChromeCommandLine,
  readWebGpuAdapterIdentity,
} from "./browser-probes.js";
import { readAndValidateBuildManifest, sha256File } from "./build-manifest.js";
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
  evaluateGateEnvironment,
  invalidEnvironmentGate,
  loadMachineDescriptor,
  safeMachineIdForFilename,
  tryReadWindowsHostIdentity,
  type WebGpuAdapterIdentity,
  type WindowsHostIdentity,
} from "./environment.js";
import {
  analyzeGreyboxRenderedOutput,
  type GreyboxRenderedOutputEvidence,
} from "./greybox-rendered-output.js";
import { launchAfterPhysicalConsoleDisplayWake } from "./physical-console-preflight.js";
import {
  captureRecoveryBoundary,
  finalizeMeasuredRenderRecoveryAttempt,
  type MeasuredRenderRecoveryEnvironment,
  type RenderRecoveryAttempt,
  type RenderRecoveryBoundary,
  type UnfinalizedMeasuredRenderRecoveryAttempt,
} from "./render-recovery-evidence.js";
import {
  evaluateRenderRecoveryPage,
  evaluateRenderRecoveryWait,
  type RenderRecoveryActionRequest,
  type RenderRecoveryPageResult,
  type RenderRecoveryWaitRequest,
} from "./render-recovery-page.js";
import { validateRenderRecoveryReportContract } from "./render-recovery-result.js";
import {
  renderRecoveryElapsedMs,
  withRenderRecoveryBoundaryTimeout,
} from "./render-recovery-timeout.js";
import { evaluateResultFacets, resultFacetsPassed } from "./result-facets.js";
import {
  RENDER_RECOVERY_ATTEMPTS,
  RENDER_RECOVERY_COMPLETION_TIMEOUT_MS,
  RENDER_RECOVERY_MANDATORY_METRIC_SET_VERSION,
  RENDER_RECOVERY_MANDATORY_METRICS,
  RENDER_RECOVERY_MINIMUM_MOVEMENT_METERS,
  RENDER_RECOVERY_MOVEMENT_TIMEOUT_MS,
  RENDER_RECOVERY_REPORT_SCHEMA_VERSION,
  RENDER_RECOVERY_RESIDENT_CELL_COUNT,
  RENDER_RECOVERY_SCENARIO,
  RENDER_RECOVERY_TELEMETRY_SCHEMA_VERSION,
} from "./runs/render-recovery.js";
import { parseQualityTier, QUALITY_TIER_PROFILES } from "./runs/smoke.js";
import { readSourceIdentity } from "./source-identity.js";
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

interface EnvironmentIdentity {
  readonly adapter: WebGpuAdapterIdentity | null;
  readonly browserDisplay: BrowserDisplayIdentity | null;
  readonly browserProduct: string;
  readonly browserRevision: string;
  readonly browserUserAgent: string;
  readonly executableSha256: string;
  readonly gateIdentity:
    | ReturnType<typeof invalidEnvironmentGate>
    | Readonly<{
        readonly state: "measured";
        readonly value: true;
      }>;
  readonly gpuDevices: readonly CdpGpuDevice[];
  readonly host: WindowsHostIdentity | null;
  readonly hostAfterRuns: WindowsHostIdentity | null;
  readonly identityProbeBrowserCommandLine: string;
  readonly jsVersion: string;
  readonly machineId: string;
  readonly requestedTier: ReturnType<typeof parseQualityTier>;
  readonly sandboxVerified: boolean;
  readonly target: HarnessTargetIdentity;
  readonly targetPostflight: HarnessTargetVerificationEvidence;
  readonly targetPreflight: HarnessTargetVerificationEvidence;
  readonly targetDisplayMode: string;
}

interface PartialCapture {
  afterFirstRecovery: RenderRecoveryBoundary | null;
  afterSecondFault: RenderRecoveryBoundary | null;
  beforeFault: RenderRecoveryBoundary | null;
  readonly browserErrors: string[];
  elapsedMs: number | null;
  environment: MeasuredRenderRecoveryEnvironment | null;
  initial: RenderRecoveryBoundary | null;
  latestTelemetry: ParallaxTelemetrySnapshot | null;
  visibleCanvas: GreyboxRenderedOutputEvidence | null;
}

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const buildRoot = join(repositoryRoot, "dist");
const outputRoot = join(repositoryRoot, "harness/results");
const machineRoot = join(repositoryRoot, "harness/machines");

await main();

async function main(): Promise<void> {
  const targetOptions = parseHarnessTargetArguments(process.argv.slice(2));
  if (targetOptions.remainingArguments.length > 0) {
    throw new Error(
      `render-recovery accepts only --target; received ${targetOptions.remainingArguments
        .map((argument) => JSON.stringify(argument))
        .join(", ")}`,
    );
  }
  const machineId = requiredEnvironment("PARALLAX_MACHINE_ID");
  const tier = parseQualityTier(process.env.PARALLAX_TIER);
  const chromePin = await loadChromePin(join(repositoryRoot, "harness/chrome/stable.json"));
  const executablePath = await resolveChromeExecutablePath(repositoryRoot, chromePin);
  const executableSha256 = await validateChromeExecutable(chromePin, executablePath);
  const build = await readAndValidateBuildManifest(buildRoot);
  const source = await readSourceIdentity(repositoryRoot);
  const expectedNodeVersion = (await readFile(join(repositoryRoot, ".nvmrc"), "utf8")).trim();
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
  const profileRoot = await mkdtemp(join(tmpdir(), "parallax-render-recovery-"));
  const attempts: RenderRecoveryAttempt[] = [];
  try {
    let runFailure: string | null = null;
    let environment: EnvironmentIdentity;
    try {
      environment = await inspectEnvironment(
        executablePath,
        join(profileRoot, "identity"),
        chromePin,
        machineId,
        tier,
        target.probeUrl,
        executableSha256,
        target.identity,
      );
    } catch (error: unknown) {
      runFailure = `Identity inspection failed: ${errorMessage(error)}`;
      environment = invalidEnvironmentIdentity(
        machineId,
        tier,
        executableSha256,
        runFailure,
        target.identity,
      );
    }
    for (const definition of RENDER_RECOVERY_ATTEMPTS) {
      attempts.push(
        await measureAttempt(
          executablePath,
          join(profileRoot, definition.id),
          baseUrl,
          definition,
          executableSha256,
          tier,
        ),
      );
    }
    try {
      environment = await revalidateEnvironment(environment);
    } catch (error: unknown) {
      runFailure = appendFailure(
        runFailure,
        `Environment revalidation failed: ${errorMessage(error)}`,
      );
    }
    const targetPostflight = reconcileTargetPostflight(
      environment.target,
      await captureTargetPostflight(target.revalidate),
    );
    if (targetPostflight.state === "verified") {
      environment = recordTargetPostflightSuccess(environment, targetPostflight);
    } else {
      const targetFailure = `Serving target postflight failed: ${targetPostflight.reason}`;
      runFailure = appendFailure(runFailure, targetFailure);
      environment = recordTargetPostflightFailure(environment, targetFailure);
    }
    try {
      if ((await readAndValidateBuildManifest(buildRoot)).artifactDigest !== build.artifactDigest) {
        runFailure = appendFailure(
          runFailure,
          "Built artifact identity changed during the render-recovery run",
        );
      }
    } catch (error: unknown) {
      runFailure = appendFailure(
        runFailure,
        `Built artifact identity revalidation failed: ${errorMessage(error)}`,
      );
    }
    try {
      if (JSON.stringify(await readSourceIdentity(repositoryRoot)) !== JSON.stringify(source)) {
        runFailure = appendFailure(
          runFailure,
          "Source identity changed during the render-recovery run",
        );
      }
    } catch (error: unknown) {
      runFailure = appendFailure(
        runFailure,
        `Source identity revalidation failed: ${errorMessage(error)}`,
      );
    }
    const attemptFailures = attempts.flatMap((attempt) =>
      attempt.state === "invalid" ? [`${attempt.id}: ${attempt.failureMessage}`] : [],
    );
    const measured = attempts.flatMap((attempt) =>
      attempt.state === "measured" && attempt.result !== null ? [attempt.result] : [],
    );
    const evidenceChecks = RENDER_RECOVERY_MANDATORY_METRICS.map((metric) =>
      Object.freeze({
        description:
          attemptFailures.length === 0 && runFailure === null
            ? metric
            : `${metric}: ${[...attemptFailures, ...(runFailure === null ? [] : [runFailure])].join(" | ")}`,
        mandatory: true,
        measured:
          runFailure === null &&
          attemptFailures.length === 0 &&
          measured.length === RENDER_RECOVERY_ATTEMPTS.length,
      }),
    );
    const budgetChecks = measured.map((attempt) =>
      Object.freeze({
        description: `${attempt.id}: recovery ${attempt.elapsedMs.toFixed(3)} ms <= ${RENDER_RECOVERY_COMPLETION_TIMEOUT_MS} ms`,
        passed: attempt.elapsedMs <= RENDER_RECOVERY_COMPLETION_TIMEOUT_MS,
      }),
    );
    const environmentFailures = [
      ...(environment.gateIdentity.state === "invalid" ? environment.gateIdentity.reasons : []),
      ...(harnessRuntime.eligible
        ? []
        : [`Node ${process.version} does not match v${expectedNodeVersion}`]),
      ...measuredRecoveryEnvironmentFailures(attempts, environment, chromePin.version),
      ...(runFailure === null ? [] : [runFailure]),
    ];
    const facets = evaluateResultFacets({
      budgetChecks,
      environment: {
        failures: Object.freeze(environmentFailures),
        measured: environment.gateIdentity.state === "measured" && harnessRuntime.eligible,
      },
      evidenceChecks,
    });
    const passed = resultFacetsPassed(facets);
    const generatedAt = new Date().toISOString();
    const report = Object.freeze({
      artifactDigest: build.artifactDigest,
      attempts: Object.freeze(attempts),
      chromePin,
      environment,
      facets,
      generatedAt,
      harnessRuntime,
      mandatoryMetricSet: Object.freeze({
        metrics: RENDER_RECOVERY_MANDATORY_METRICS,
        version: RENDER_RECOVERY_MANDATORY_METRIC_SET_VERSION,
      }),
      passed,
      releaseDigest: build.releaseDigest,
      runFailure,
      scenario: RENDER_RECOVERY_SCENARIO,
      schemaVersion: RENDER_RECOVERY_REPORT_SCHEMA_VERSION,
      source,
    });
    await mkdir(outputRoot, { recursive: true });
    const stem = `${RENDER_RECOVERY_SCENARIO.replace("@", "-")}-${build.artifactDigest.slice(
      0,
      12,
    )}-${safeMachineIdForFilename(machineId)}-${tier}-${generatedAt.replaceAll(/[:.]/g, "-")}`;
    const jsonPath = join(outputRoot, `${stem}.json`);
    const markdownPath = join(outputRoot, `${stem}.md`);
    let contractValidationFailure: string | null = null;
    try {
      validateRenderRecoveryReportContract(report);
    } catch (error: unknown) {
      contractValidationFailure = errorMessage(error);
    }
    const retainedReport =
      contractValidationFailure === null
        ? report
        : Object.freeze({
            ...report,
            contractValidationFailure,
            passed: false,
          });
    await writeFile(jsonPath, `${JSON.stringify(retainedReport, null, 2)}\n`);
    await writeFile(markdownPath, formatReport(retainedReport));
    console.log(`Render-recovery result: ${jsonPath}`);
    console.log(`Render-recovery summary: ${markdownPath}`);
    if (!passed || contractValidationFailure !== null) process.exitCode = 1;
  } finally {
    await rm(profileRoot, { force: true, recursive: true });
    await target.stop();
  }
}

async function measureAttempt(
  executablePath: string,
  profilePath: string,
  baseUrl: string,
  definition: (typeof RENDER_RECOVERY_ATTEMPTS)[number],
  executableSha256: string,
  tier: ReturnType<typeof parseQualityTier>,
): Promise<RenderRecoveryAttempt> {
  const capture: PartialCapture = {
    afterFirstRecovery: null,
    afterSecondFault: null,
    beforeFault: null,
    browserErrors: [],
    elapsedMs: null,
    environment: null,
    initial: null,
    latestTelemetry: null,
    visibleCanvas: null,
  };
  try {
    const unfinalizedResult = await runAttempt(
      executablePath,
      profilePath,
      baseUrl,
      definition,
      capture,
      executableSha256,
      tier,
    );
    if (capture.environment === null) {
      throw new Error("Measured recovery browser environment is unavailable");
    }
    const result = finalizeMeasuredRenderRecoveryAttempt(unfinalizedResult, capture.browserErrors);
    return Object.freeze({
      browserErrors: result.browserErrors,
      environment: capture.environment,
      failureMessage: null,
      id: definition.id,
      profileLineage: recoveryProfileLineage(definition.id),
      result,
      state: "measured",
    });
  } catch (error: unknown) {
    return Object.freeze({
      browserErrors: Object.freeze([...capture.browserErrors]),
      failureMessage: errorMessage(error),
      environment: capture.environment,
      id: definition.id,
      profileLineage: recoveryProfileLineage(definition.id),
      partial: Object.freeze({
        afterFirstRecovery: capture.afterFirstRecovery,
        afterSecondFault: capture.afterSecondFault,
        beforeFault: capture.beforeFault,
        elapsedMs: capture.elapsedMs,
        initial: capture.initial,
        latestTelemetry: capture.latestTelemetry,
        visibleCanvas: capture.visibleCanvas,
      }),
      result: null,
      state: "invalid",
    });
  }
}

async function runAttempt(
  executablePath: string,
  profilePath: string,
  baseUrl: string,
  definition: (typeof RENDER_RECOVERY_ATTEMPTS)[number],
  capture: PartialCapture,
  executableSha256: string,
  tier: ReturnType<typeof parseQualityTier>,
): Promise<UnfinalizedMeasuredRenderRecoveryAttempt> {
  const context = await launchAfterPhysicalConsoleDisplayWake(() =>
    launchPersistentChrome(executablePath, profilePath, ["--enable-webgpu-developer-features"]),
  );
  const page = context.pages()[0] ?? (await context.newPage());
  const hostBeforeResultPromise = tryReadWindowsHostIdentity();
  let browserDisplayBefore: BrowserDisplayIdentity | null = null;
  let recoveryStartedAt: number | null = null;
  page.on("pageerror", (error) => capture.browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") capture.browserErrors.push(message.text());
  });
  try {
    const runtimeUrl = harnessRuntimeUrl(baseUrl);
    await page.goto(runtimeUrl, { waitUntil: "load" });
    assertHarnessNavigationUrl(page.url(), runtimeUrl, `render-recovery ${definition.id}`);
    browserDisplayBefore = await readBrowserDisplayIdentity(context, page);
    await waitForInitialCohort(page);
    capture.latestTelemetry = await readTelemetry(page);
    capture.initial = captureRecoveryBoundary(capture.latestTelemetry);
    await invoke(page, "prepare");
    await page.waitForFunction<boolean, RenderRecoveryWaitRequest>(
      evaluateRenderRecoveryWait,
      {
        kind: "wait-for-prepared",
        residentCount: RENDER_RECOVERY_RESIDENT_CELL_COUNT,
      },
      { timeout: 180_000 },
    );
    const prepared = await readTelemetry(page);
    capture.latestTelemetry = prepared;
    if (prepared.flythrough.state !== "prepared") {
      throw new Error(prepared.flythrough.failureMessage ?? "Recovery movement preflight failed");
    }
    // The flythrough preflight uses the window-side observer path. Make that settled
    // boundary the origin so the later pre-fault boundary can only pass after the
    // render worker's direct port has moved to a different observer and cell set.
    capture.initial = captureRecoveryBoundary(prepared);
    await invoke(page, "start");
    const initialObservers = capture.initial.observers;
    const initialResidentCellIds = capture.initial.residentCellIds;
    await page.waitForFunction<boolean, RenderRecoveryWaitRequest>(
      evaluateRenderRecoveryWait,
      {
        initialObservers,
        initialResidentCellIds,
        kind: "wait-for-movement",
        minimumMovement: RENDER_RECOVERY_MINIMUM_MOVEMENT_METERS,
        residentCount: RENDER_RECOVERY_RESIDENT_CELL_COUNT,
      },
      { timeout: RENDER_RECOVERY_MOVEMENT_TIMEOUT_MS },
    );
    recoveryStartedAt = performance.now();
    const faultBoundary = await withRenderRecoveryBoundaryTimeout(
      exerciseAtBoundary(page, definition.firstProbe),
      RENDER_RECOVERY_COMPLETION_TIMEOUT_MS,
    );
    capture.latestTelemetry = faultBoundary.snapshot;
    capture.beforeFault = captureRecoveryBoundary(faultBoundary.snapshot, faultBoundary.checkpoint);
    await page.waitForFunction<boolean, RenderRecoveryWaitRequest>(
      evaluateRenderRecoveryWait,
      {
        kind: "wait-for-recovery",
        residentCount: RENDER_RECOVERY_RESIDENT_CELL_COUNT,
      },
      { timeout: RENDER_RECOVERY_COMPLETION_TIMEOUT_MS },
    );
    capture.elapsedMs = performance.now() - recoveryStartedAt;
    capture.latestTelemetry = await readTelemetry(page);
    capture.afterFirstRecovery = captureRecoveryBoundary(capture.latestTelemetry);
    const recoveredFrameCount = capture.afterFirstRecovery.frameCount;
    await page.waitForFunction<boolean, RenderRecoveryWaitRequest>(
      evaluateRenderRecoveryWait,
      { frameCount: recoveredFrameCount, kind: "wait-for-frame" },
      { timeout: 5_000 },
    );
    capture.latestTelemetry = await readTelemetry(page);
    const frameCountAfterVisibilityWait = capture.latestTelemetry.render.frameCount;
    const clearColor = capture.afterFirstRecovery.greyboxWorld?.clearColor;
    if (clearColor === undefined) throw new Error("Recovered greybox clear color is unavailable");
    const png = await page.locator("#render-canvas").screenshot({ type: "png" });
    capture.visibleCanvas = await analyzeGreyboxRenderedOutput(png, clearColor);
    if (definition.secondProbe !== null) {
      const expectedTerminalError = page.waitForEvent("console", {
        predicate: (message) =>
          message.type() === "error" && message.text().includes("Render worker failed"),
        timeout: RENDER_RECOVERY_COMPLETION_TIMEOUT_MS,
      });
      await Promise.all([
        exercise(page, definition.secondProbe).then(() =>
          page.waitForFunction<boolean, RenderRecoveryWaitRequest>(
            evaluateRenderRecoveryWait,
            {
              kind: "wait-for-exhaustion",
              residentCount: RENDER_RECOVERY_RESIDENT_CELL_COUNT,
            },
            { timeout: RENDER_RECOVERY_COMPLETION_TIMEOUT_MS },
          ),
        ),
        expectedTerminalError,
      ]);
      capture.latestTelemetry = await readTelemetry(page);
      capture.afterSecondFault = captureRecoveryBoundary(capture.latestTelemetry);
    }
    return Object.freeze({
      afterFirstRecovery: capture.afterFirstRecovery,
      afterSecondFault: capture.afterSecondFault,
      beforeFault: capture.beforeFault,
      elapsedMs: capture.elapsedMs,
      firstProbe: definition.firstProbe,
      frameCountAfterVisibilityWait,
      id: definition.id,
      initial: capture.initial,
      secondProbe: definition.secondProbe,
      visibleCanvas: capture.visibleCanvas,
    }) as UnfinalizedMeasuredRenderRecoveryAttempt;
  } finally {
    if (recoveryStartedAt !== null && capture.elapsedMs === null) {
      capture.elapsedMs = renderRecoveryElapsedMs(recoveryStartedAt, performance.now());
    }
    try {
      capture.latestTelemetry = await readTelemetry(page);
    } catch {
      // Partial diagnostics are best-effort after a page or worker terminal failure.
    }
    try {
      const hostBeforeResult = await hostBeforeResultPromise;
      const hostAfterResult = await tryReadWindowsHostIdentity();
      const browserDisplayAfter = await readBrowserDisplayIdentity(context, page);
      if (
        hostBeforeResult.state === "measured" &&
        hostAfterResult.state === "measured" &&
        browserDisplayBefore !== null
      ) {
        capture.environment = await inspectMeasuredRecoveryEnvironment(
          context,
          page,
          hostBeforeResult.host,
          browserDisplayBefore,
          hostAfterResult.host,
          browserDisplayAfter,
          executableSha256,
          tier,
        );
      } else {
        capture.browserErrors.push(
          hostBeforeResult.state === "invalid"
            ? hostBeforeResult.reason
            : hostAfterResult.state === "invalid"
              ? hostAfterResult.reason
              : "Measured browser display identity is unavailable",
        );
      }
    } catch (error: unknown) {
      capture.browserErrors.push(`Measured environment inspection failed: ${errorMessage(error)}`);
    }
    await context.close();
  }
}

async function waitForInitialCohort(page: Page): Promise<void> {
  await page.waitForFunction<boolean, RenderRecoveryWaitRequest>(
    evaluateRenderRecoveryWait,
    {
      kind: "wait-for-initial-cohort",
      residentCount: RENDER_RECOVERY_RESIDENT_CELL_COUNT,
      schemaVersion: RENDER_RECOVERY_TELEMETRY_SCHEMA_VERSION,
    },
    { timeout: 120_000 },
  );
}

function invoke(page: Page, action: "prepare" | "start"): Promise<void> {
  return page
    .evaluate<RenderRecoveryPageResult, RenderRecoveryActionRequest>(evaluateRenderRecoveryPage, {
      action,
      kind: "invoke",
    })
    .then(() => undefined);
}

function exercise(page: Page, probe: RenderRecoveryProbeKind): Promise<void> {
  return page
    .evaluate<RenderRecoveryPageResult, RenderRecoveryActionRequest>(evaluateRenderRecoveryPage, {
      kind: "exercise",
      probe,
    })
    .then(() => undefined);
}

function exerciseAtBoundary(
  page: Page,
  probe: RenderRecoveryProbeKind,
): Promise<
  Readonly<{
    checkpoint: StreamingRecoveryCheckpoint;
    snapshot: ParallaxTelemetrySnapshot;
  }>
> {
  return page.evaluate<RenderRecoveryPageResult, RenderRecoveryActionRequest>(
    evaluateRenderRecoveryPage,
    {
      kind: "exercise-at-boundary",
      probe,
    },
  ) as Promise<
    Extract<
      RenderRecoveryPageResult,
      Readonly<{
        readonly checkpoint: StreamingRecoveryCheckpoint;
        readonly snapshot: ParallaxTelemetrySnapshot;
      }>
    >
  >;
}

async function inspectMeasuredRecoveryEnvironment(
  context: BrowserContext,
  page: Page,
  hostBefore: WindowsHostIdentity,
  browserDisplayBefore: BrowserDisplayIdentity,
  hostAfter: WindowsHostIdentity,
  browserDisplayAfter: BrowserDisplayIdentity,
  executableSha256: string,
  requestedTier: ReturnType<typeof parseQualityTier>,
): Promise<MeasuredRenderRecoveryEnvironment> {
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
      browserDisplayBefore,
      browserProduct: version.product,
      browserRevision: version.revision,
      browserUserAgent: version.userAgent,
      executableSha256,
      gpuDevices: systemInfo.gpu.devices,
      hostAfter,
      hostBefore,
      jsVersion: version.jsVersion,
      requestedTier,
      sandboxVerified,
      targetDisplayMode: QUALITY_TIER_PROFILES[requestedTier].targetDisplayMode,
    });
  } finally {
    await session.detach().catch(() => undefined);
  }
}

function recoveryProfileLineage(
  id: RenderRecoveryAttempt["id"],
): Readonly<{ readonly history: readonly ["fresh"]; readonly id: string }> {
  return Object.freeze({
    history: Object.freeze(["fresh"] as const),
    id: `independent-fresh-${id}`,
  });
}

function measuredRecoveryEnvironmentFailures(
  attempts: readonly RenderRecoveryAttempt[],
  reference: EnvironmentIdentity,
  chromePinVersion: string,
): readonly string[] {
  const failures: string[] = [];
  for (const attempt of attempts) {
    const actual = attempt.environment;
    if (actual === null) {
      failures.push(`${attempt.id} measured browser environment is unavailable`);
      continue;
    }
    if (
      actual.browserProduct !== `Chrome/${chromePinVersion}` ||
      actual.executableSha256 !== reference.executableSha256 ||
      actual.requestedTier !== reference.requestedTier ||
      actual.targetDisplayMode !== reference.targetDisplayMode ||
      !actual.sandboxVerified ||
      actual.browserCommandLine.trim() === "" ||
      !actual.browserCommandLine.includes("--start-fullscreen") ||
      /--(?:headless|disable-gpu|use-angle=swiftshader)(?:\s|=|$)/i.test(
        actual.browserCommandLine,
      ) ||
      reference.adapter === null ||
      reference.browserDisplay === null ||
      reference.host === null ||
      !sameStableAdapter(actual.adapter, reference.adapter) ||
      !same(actual.gpuDevices, reference.gpuDevices) ||
      !same(actual.browserDisplayBefore, reference.browserDisplay) ||
      !same(actual.browserDisplayAfter, reference.browserDisplay) ||
      !same(actual.hostBefore, reference.host) ||
      !same(actual.hostAfter, reference.host) ||
      actual.browserProduct !== reference.browserProduct ||
      actual.browserRevision !== reference.browserRevision ||
      actual.browserUserAgent !== reference.browserUserAgent ||
      actual.jsVersion !== reference.jsVersion
    ) {
      failures.push(`${attempt.id} measured browser environment drifted`);
    }
  }
  return Object.freeze(failures);
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameStableAdapter(
  measured: WebGpuAdapterIdentity,
  reference: WebGpuAdapterIdentity,
): boolean {
  return (
    measured.architecture === reference.architecture &&
    measured.isFallbackAdapter === reference.isFallbackAdapter &&
    measured.vendor === reference.vendor
  );
}

function invalidEnvironmentIdentity(
  machineId: string,
  requestedTier: ReturnType<typeof parseQualityTier>,
  executableSha256: string,
  reason: string,
  target: HarnessTargetIdentity,
): EnvironmentIdentity {
  return Object.freeze({
    adapter: null,
    browserDisplay: null,
    browserProduct: "unavailable",
    browserRevision: "unavailable",
    browserUserAgent: "unavailable",
    executableSha256,
    gateIdentity: invalidEnvironmentGate(reason),
    gpuDevices: Object.freeze([]),
    host: null,
    hostAfterRuns: null,
    identityProbeBrowserCommandLine: "unavailable",
    jsVersion: "unavailable",
    machineId,
    requestedTier,
    sandboxVerified: false,
    target,
    targetPostflight: failedTargetEvidence("Serving target postflight has not run"),
    targetPreflight: verifiedTargetEvidence(target),
    targetDisplayMode: QUALITY_TIER_PROFILES[requestedTier].targetDisplayMode,
  });
}

function appendFailure(existing: string | null, next: string): string {
  return existing === null ? next : `${existing}; ${next}`;
}

async function inspectEnvironment(
  executablePath: string,
  profilePath: string,
  chromePin: ChromePin,
  machineId: string,
  tier: ReturnType<typeof parseQualityTier>,
  probeUrl: string,
  executableSha256: string,
  target: HarnessTargetIdentity,
): Promise<EnvironmentIdentity> {
  const machine = await loadMachineDescriptor(machineRoot, machineId).catch(() => null);
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
    if (version.product !== `Chrome/${chromePin.version}`) {
      throw new Error(`Chrome pin mismatch: expected ${chromePin.version}, got ${version.product}`);
    }
    const systemInfo = (await session.send("SystemInfo.getInfo")) as {
      gpu: { devices: readonly CdpGpuDevice[] };
    };
    const primaryGpu = systemInfo.gpu.devices[0];
    if (primaryGpu === undefined) throw new Error("CDP did not report a primary GPU");
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(probeUrl, { waitUntil: "load" });
    assertHarnessNavigationUrl(page.url(), probeUrl, "render-recovery identity probe");
    const adapter = await readWebGpuAdapterIdentity(page).catch(() => null);
    const browserDisplay = await readBrowserDisplayIdentity(context, page).catch(() => null);
    const commandLine = await readChromeCommandLine(context);
    const sandboxVerified = validateChromeSandboxCommandLine(commandLine);
    const hostResult = await hostResultPromise;
    const host = hostResult.state === "measured" ? hostResult.host : null;
    const failures = [
      ...(machine === null ? ["Machine descriptor unavailable"] : []),
      ...(hostResult.state === "invalid" ? [hostResult.reason] : []),
      ...(adapter === null ? ["WebGPU adapter identity unavailable"] : []),
      ...(browserDisplay === null ? ["Browser display identity unavailable"] : []),
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
      executableSha256,
      gateIdentity,
      gpuDevices: systemInfo.gpu.devices,
      host,
      hostAfterRuns: null,
      identityProbeBrowserCommandLine: commandLine,
      jsVersion: version.jsVersion,
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

async function revalidateEnvironment(
  environment: EnvironmentIdentity,
): Promise<EnvironmentIdentity> {
  const hostResult = await tryReadWindowsHostIdentity();
  const hostAfterRuns = hostResult.state === "measured" ? hostResult.host : null;
  const failures =
    environment.gateIdentity.state === "invalid" ? [...environment.gateIdentity.reasons] : [];
  if (hostResult.state === "invalid") failures.push(hostResult.reason);
  else if (
    environment.host === null ||
    JSON.stringify(environment.host) !== JSON.stringify(hostAfterRuns)
  ) {
    failures.push("Host OS/GPU/display/power identity changed during recovery qualification");
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
    environment.gateIdentity.state === "invalid" ? [...environment.gateIdentity.reasons] : [];
  return Object.freeze({
    ...environment,
    gateIdentity: invalidEnvironmentGate([...failures, reason]),
  });
}

function formatReport(report: {
  readonly artifactDigest: string;
  readonly attempts: readonly RenderRecoveryAttempt[];
  readonly chromePin: ChromePin;
  readonly contractValidationFailure?: string | null;
  readonly environment: EnvironmentIdentity;
  readonly facets: ReturnType<typeof evaluateResultFacets>;
  readonly generatedAt: string;
  readonly mandatoryMetricSet: Readonly<{ readonly version: number }>;
  readonly passed: boolean;
  readonly releaseDigest: string;
  readonly runFailure: string | null;
  readonly schemaVersion: number;
  readonly source: Awaited<ReturnType<typeof readSourceIdentity>>;
}): string {
  return `${[
    "# Parallax render-recovery qualification",
    "",
    `- Scenario: \`${RENDER_RECOVERY_SCENARIO}\``,
    `- Result: **${report.passed ? "PASS" : "FAIL"}**`,
    `- Generated: ${report.generatedAt}`,
    `- Build artifact: \`${report.artifactDigest}\``,
    `- Install release: \`${report.releaseDigest}\``,
    `- Serving target: **${report.environment.target.kind}** \`${report.environment.target.origin}\``,
    `- Target preflight: **${formatTargetVerificationEvidence(report.environment.targetPreflight)}**`,
    `- Target postflight: **${formatTargetVerificationEvidence(report.environment.targetPostflight)}**`,
    `- Source commit: \`${report.source.commit}\``,
    `- Dirty-tree digest: \`${report.source.dirtyTreeDigest ?? "clean"}\``,
    `- Chrome: ${report.chromePin.version}`,
    `- Machine/tier: ${report.environment.machineId} / ${report.environment.requestedTier}`,
    `- Schema / metric set: ${report.schemaVersion} / ${report.mandatoryMetricSet.version}`,
    `- Facets: environment ${report.facets.environment.status}; evidence ${report.facets.evidenceCompleteness.status}; bounded recovery ${report.facets.budgetEvaluation.status}`,
    `- Run failure: ${report.runFailure ?? "none"}`,
    `- Contract validation failure: ${report.contractValidationFailure ?? "none"}`,
    "",
    "## Attempts",
    "",
    ...report.attempts.map((attempt) =>
      attempt.state === "invalid"
        ? `- ${attempt.id}: invalid — ${attempt.failureMessage}; browser errors ${attempt.browserErrors.length === 0 ? "none" : attempt.browserErrors.join(" | ")}; partial boundaries initial=${attempt.partial.initial === null ? "missing" : "captured"}, beforeFault=${attempt.partial.beforeFault === null ? "missing" : "captured"}, afterFirstRecovery=${attempt.partial.afterFirstRecovery === null ? "missing" : "captured"}, afterSecondFault=${attempt.partial.afterSecondFault === null ? "missing" : "captured"}; elapsed=${attempt.partial.elapsedMs === null ? "missing" : `${attempt.partial.elapsedMs.toFixed(3)} ms`}; canvas=${attempt.partial.visibleCanvas === null ? "missing" : "captured"}; ${formatLatestTelemetry(attempt.partial.latestTelemetry)}`
        : `- ${attempt.id}: measured — first recovery ${attempt.result.elapsedMs.toFixed(3)} ms; render/streaming generations ${attempt.result.afterFirstRecovery.renderRecovery.workerGeneration}/${attempt.result.afterFirstRecovery.streaming.workerGeneration}; residents ${attempt.result.afterFirstRecovery.residentCellIds.length}; visible pixels ${(attempt.result.visibleCanvas.visiblePixelRatio * 100).toFixed(2)}%; terminal ${attempt.result.afterSecondFault === null ? "not applicable" : attempt.result.afterSecondFault.renderRecovery.state}`,
    ),
    "",
    "## Contract",
    "",
    `Real \`GPUDevice.destroy()\` and render-worker \`close()\` probes are invoked through the public diagnostic surface. Each attempt uses a distinct fresh Chrome profile. Automation launches, invokes, waits, captures, and validates; it does not synthesize recovery telemetry.`,
    "",
  ].join("\n")}\n`;
}

function formatLatestTelemetry(telemetry: ParallaxTelemetrySnapshot | null): string {
  if (telemetry === null) return "latest telemetry=missing";
  const checkpoints = telemetry.flythrough.checkpointEvidence;
  const latestCheckpoint = checkpoints.at(-1);
  return `latest telemetry=flythrough ${telemetry.flythrough.state}, checkpoints ${checkpoints.length}${
    latestCheckpoint === undefined
      ? ""
      : `, last ${latestCheckpoint.checkpointId} visibleRatio=${latestCheckpoint.visiblePixelRatio}`
  }, render ${telemetry.render.state}/generation ${telemetry.render.recovery.workerGeneration}, streaming ${telemetry.streaming.state}/generation ${telemetry.streaming.workerGeneration}`;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`${name} is required`);
  return value.trim();
}
