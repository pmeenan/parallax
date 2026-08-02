import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, CDPSession, Page } from "playwright-core";
import { readAndValidateBuildManifest } from "./build-manifest.js";
import {
  launchPersistentChrome,
  loadChromePin,
  resolveChromeExecutablePath,
  validateChromeExecutable,
} from "./chrome-pin.js";
import { sanitizeEvidenceText } from "./evidence-redaction.js";
import { launchAfterPhysicalConsoleDisplayWake } from "./physical-console-preflight.js";
import {
  inspectRegisteredEnvironment,
  type RegisteredEnvironmentIdentity,
} from "./registered-environment.js";
import { type ResultPairReservation, reserveResultPair } from "./result-pair.js";
import {
  LOCAL_SERVER_IDENTITY_PROBE_MARKER,
  type LocalServerJournalEntry,
  uninstallSentinelWorkerPath,
} from "./server.js";
import { readSourceIdentity } from "./source-identity.js";
import { startHarnessTarget } from "./target.js";
import {
  evaluateUninstallEvidence,
  UNINSTALL_EVIDENCE_CONTRACT,
  UNINSTALL_EVIDENCE_SCHEMA_VERSION,
  UNINSTALL_MECHANISMS,
  UNINSTALL_MINIMUM_SEEDED_BYTES,
  type UninstallMechanism,
  type UninstallMechanismObservation,
  type UninstallRawSurfaceObservation,
  type UninstallVerificationEvidence,
} from "./uninstall-evidence.js";
import { beginV8TraceCapture, finishV8TraceAfterOperation } from "./v8-trace-capture.js";
import { isRecord as isUnknownRecord } from "./value-utils.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const buildRoot = join(repositoryRoot, "dist");
const resultRoot = join(repositoryRoot, "harness/results/uninstall-verification");
const machineId = process.env.PARALLAX_MACHINE_ID ?? "dev-01";
const SENTINEL_BYTES = UNINSTALL_MINIMUM_SEEDED_BYTES;

export type UninstallTerminalReport = Readonly<{
  cleanupFailures: readonly Readonly<{ message: string; operation: string }>[];
  completedAt: string;
  contract: typeof UNINSTALL_EVIDENCE_CONTRACT;
  evidence: UninstallVerificationEvidence | null;
  failure: Readonly<{ message: string; phase: string }> | null;
  mechanismDiagnostics: readonly UninstallMechanismDiagnostic[];
  postValidation: Readonly<{ passed: boolean; performed: boolean }>;
  schemaVersion: typeof UNINSTALL_EVIDENCE_SCHEMA_VERSION;
  setupAuthority: UninstallMechanismObservation["authority"] | null;
  setupProgress: UninstallSetupProgress;
  startedAt: string;
  state: "failed" | "passed";
}>;

export type UninstallMechanismDiagnostic = Readonly<{
  attempt: number;
  failures: readonly Readonly<{ message: string; phase: string; surface: string }>[];
  mechanism: "client-side";
  state: "failed" | "idle" | "running" | "succeeded";
}>;

export type UninstallSetupProgress = Readonly<{
  browser: Readonly<{ executableSha256: string | null; product: string; revision: string }> | null;
  build: Readonly<{ artifactDigest: string; releaseDigest: string }> | null;
  environment: Readonly<{ gateState: "measured"; machineId: string; tier: "showcase" }> | null;
  source: Readonly<{ commit: string; dirtyTreeDigest: string | null }> | null;
  target: unknown | null;
}>;

const EMPTY_SETUP_PROGRESS: UninstallSetupProgress = Object.freeze({
  browser: null,
  build: null,
  environment: null,
  source: null,
  target: null,
});

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  if (process.argv.length !== 3 || process.argv[2] !== "--physical-console-confirmed") {
    throw new Error(
      "Usage: uninstall-verification-run --physical-console-confirmed (run only after the developer confirms native local dev-01 access and a visibly awake display)",
    );
  }
  await main();
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const reservation = await reserveResultPair(
    resultRoot,
    startedAt,
    pendingReport(startedAt, null, EMPTY_SETUP_PROGRESS),
    {},
    "uninstall-verification",
    "Uninstall verification",
  );
  let phase = "preflight";
  let target: Awaited<ReturnType<typeof startHarnessTarget>> | null = null;
  const cleanupFailures: Array<{ message: string; operation: string }> = [];
  const localResponses: LocalServerJournalEntry[] = [];
  const mechanismDiagnostics: UninstallMechanismDiagnostic[] = [];
  const profiles: string[] = [];
  let evidence: UninstallVerificationEvidence | null = null;
  let setupAuthority: UninstallMechanismObservation["authority"] | null = null;
  let setupProgress = EMPTY_SETUP_PROGRESS;
  let postValidationPerformed = false;
  let postValidationPassed = false;
  let primary: unknown = null;
  try {
    const build = await readAndValidateBuildManifest(buildRoot);
    setupProgress = Object.freeze({
      ...setupProgress,
      build: { artifactDigest: build.artifactDigest, releaseDigest: build.releaseDigest },
    });
    await reservation.publishPendingJson(pendingReport(startedAt, null, setupProgress));
    const source = await readSourceIdentity(repositoryRoot);
    setupProgress = Object.freeze({ ...setupProgress, source });
    await reservation.publishPendingJson(pendingReport(startedAt, null, setupProgress));
    const pin = await loadChromePin(join(repositoryRoot, "harness/chrome/stable.json"));
    setupProgress = Object.freeze({
      ...setupProgress,
      browser: {
        executableSha256: null,
        product: `Chrome/${pin.version}`,
        revision: pin.browserRevision,
      },
    });
    await reservation.publishPendingJson(pendingReport(startedAt, null, setupProgress));
    const executablePath = await resolveChromeExecutablePath(repositoryRoot, pin);
    const executableSha256 = await validateChromeExecutable(pin, executablePath);
    setupProgress = Object.freeze({
      ...setupProgress,
      browser: {
        executableSha256,
        product: `Chrome/${pin.version}`,
        revision: pin.browserRevision,
      },
    });
    await reservation.publishPendingJson(pendingReport(startedAt, null, setupProgress));
    target = await startHarnessTarget({
      artifactDigest: build.artifactDigest,
      buildManifest: build.manifest,
      buildRoot,
      localHostname: "localhost",
      onLocalResponse: (entry) => localResponses.push(entry),
      request: "local",
    });
    setupProgress = Object.freeze({ ...setupProgress, target: target.identity });
    await reservation.publishPendingJson(pendingReport(startedAt, null, setupProgress));
    const clientProfilePath = await mkdtemp(join(tmpdir(), "parallax-uninstall-client-side-"));
    profiles.push(clientProfilePath);
    const registeredEnvironment = await inspectRegisteredEnvironment({
      chromePin: pin,
      executablePath,
      machineId,
      machineRoot: join(repositoryRoot, "harness/machines"),
      probeUrl: target.probeUrl,
      profilePath: clientProfilePath,
      target: target.identity,
      tier: "showcase",
    });
    if (
      registeredEnvironment.gateIdentity.state !== "measured" ||
      registeredEnvironment.sandboxVerified !== true
    ) {
      throw new Error("Uninstall registered environment is not measured and sandboxed");
    }
    setupProgress = Object.freeze({
      ...setupProgress,
      environment: {
        gateState: "measured",
        machineId: registeredEnvironment.machineId,
        tier: "showcase",
      },
    });
    setupAuthority = {
      artifactDigest: build.artifactDigest,
      browser: {
        executableSha256,
        product: `Chrome/${pin.version}`,
        revision: pin.browserRevision,
      },
      environment: {
        gateState: "measured",
        machineId: registeredEnvironment.machineId,
        tier: "showcase",
      },
      origin: target.baseUrl,
      releaseDigest: build.releaseDigest,
      source,
      target: target.identity,
    };
    await reservation.publishPendingJson(pendingReport(startedAt, setupAuthority, setupProgress));
    const observations: UninstallMechanismObservation[] = [];
    for (const mechanism of ["client-side", "clear-site-data"] as const) {
      phase = `${mechanism}-profile`;
      const profilePath =
        mechanism === "client-side"
          ? clientProfilePath
          : await mkdtemp(join(tmpdir(), `parallax-uninstall-${mechanism}-`));
      if (mechanism !== "client-side") profiles.push(profilePath);
      const observation = await collectMechanism({
        artifactDigest: build.artifactDigest,
        browserPinPath: join(repositoryRoot, "harness/chrome/stable.json"),
        executablePath,
        machineId,
        mechanism,
        recordDiagnostic: (diagnostic) => {
          if (mechanismDiagnostics.length !== 0) {
            throw new Error("Uninstall client-side diagnostic was recorded more than once");
          }
          mechanismDiagnostics.push(diagnostic);
        },
        origin: target.baseUrl,
        readLocalResponses: () => Object.freeze([...localResponses]),
        probeUrl: target.probeUrl,
        profilePath,
        releaseDigest: build.releaseDigest,
        registeredEnvironment: mechanism === "client-side" ? registeredEnvironment : null,
        serviceWorkerPath: build.manifest.offlineShell.serviceWorkerPath,
        source,
        targetIdentity: target.identity,
      });
      phase = `${mechanism}-profile-cleanup`;
      await removeTrackedUninstallMechanismProfile(mechanism, profilePath, profiles);
      observations.push({
        ...observation,
        cleanup: { ...observation.cleanup, profileRemoved: true },
      });
    }
    phase = "post-validation";
    postValidationPerformed = true;
    const [postBuild, postSource, postTarget] = await Promise.all([
      readAndValidateBuildManifest(buildRoot),
      readSourceIdentity(repositoryRoot),
      target.revalidate(),
    ]);
    if (
      postBuild.artifactDigest !== build.artifactDigest ||
      postBuild.releaseDigest !== build.releaseDigest ||
      JSON.stringify(postSource) !== JSON.stringify(source) ||
      JSON.stringify(postTarget) !== JSON.stringify(target.identity)
    ) {
      throw new Error("Uninstall build/source/target identity changed during collection");
    }
    postValidationPassed = true;
    phase = "cleanup";
    await target.stop();
    target = null;
    evidence = evaluateUninstallEvidence(
      observations.map((observation) => ({
        ...observation,
        cleanup: { ...observation.cleanup, postValidationPassed: true },
      })),
      setupAuthority,
    );
    if (!evidence.passed)
      throw new Error("Uninstall mechanisms did not pass required storage/quota invariants");
  } catch (error: unknown) {
    primary = error;
  } finally {
    if (target !== null) {
      await target
        .stop()
        .catch((error: unknown) =>
          cleanupFailures.push({ message: sanitize(error), operation: "stop-target" }),
        );
    }
    for (const profilePath of profiles) {
      await rm(profilePath, { recursive: true, force: true }).catch((error: unknown) =>
        cleanupFailures.push({
          message: sanitize(error),
          operation: `remove-profile:${basename(profilePath)}`,
        }),
      );
    }
  }

  const state =
    primary === null && cleanupFailures.length === 0 && evidence?.passed === true
      ? "passed"
      : "failed";
  const report: UninstallTerminalReport = Object.freeze({
    cleanupFailures: Object.freeze(cleanupFailures.map((failure) => Object.freeze(failure))),
    completedAt: new Date().toISOString(),
    contract: UNINSTALL_EVIDENCE_CONTRACT,
    evidence,
    failure:
      state === "failed"
        ? Object.freeze({
            message: sanitize(
              primary ?? cleanupFailures[0]?.message ?? "Uninstall evidence did not pass",
            ),
            phase,
          })
        : null,
    mechanismDiagnostics: Object.freeze(mechanismDiagnostics.map((value) => Object.freeze(value))),
    postValidation: Object.freeze({
      performed: postValidationPerformed,
      passed: postValidationPassed,
    }),
    schemaVersion: UNINSTALL_EVIDENCE_SCHEMA_VERSION,
    setupAuthority,
    setupProgress,
    startedAt,
    state,
  });
  validateUninstallTerminalReport(report, setupAuthority);
  await publishTerminal(reservation, report);
  process.stdout.write(`${reservation.jsonPath}\n${reservation.markdownPath}\n`);
  if (state === "failed") process.exitCode = 1;
}

export async function removeTrackedUninstallMechanismProfile(
  mechanism: UninstallMechanism,
  profilePath: string,
  trackedProfiles: string[],
): Promise<void> {
  const trackedProfileIndex = trackedProfiles.indexOf(profilePath);
  if (trackedProfileIndex === -1) {
    throw new Error(`Uninstall ${mechanism} profile cleanup lost its tracked path`);
  }
  await rm(profilePath, { recursive: true, force: true });
  trackedProfiles.splice(trackedProfileIndex, 1);
}

async function collectMechanism(
  input: Readonly<{
    artifactDigest: string;
    browserPinPath: string;
    executablePath: string;
    machineId: string;
    mechanism: UninstallMechanism;
    origin: string;
    probeUrl: string;
    profilePath: string;
    readLocalResponses(): readonly LocalServerJournalEntry[];
    recordDiagnostic(diagnostic: UninstallMechanismDiagnostic): void;
    releaseDigest: string;
    registeredEnvironment: RegisteredEnvironmentIdentity | null;
    serviceWorkerPath: string;
    source: Readonly<{ commit: string; dirtyTreeDigest: string | null }>;
    targetIdentity: Parameters<typeof inspectRegisteredEnvironment>[0]["target"];
  }>,
): Promise<UninstallMechanismObservation> {
  const pin = await loadChromePin(input.browserPinPath);
  const environment =
    input.registeredEnvironment ??
    (await inspectRegisteredEnvironment({
      chromePin: pin,
      executablePath: input.executablePath,
      machineId: input.machineId,
      machineRoot: join(repositoryRoot, "harness/machines"),
      probeUrl: input.probeUrl,
      profilePath: input.profilePath,
      target: input.targetIdentity,
      tier: "showcase",
    }));
  if (environment.gateIdentity.state !== "measured" || environment.sandboxVerified !== true) {
    throw new Error(`${input.mechanism} registered environment is not measured and sandboxed`);
  }
  let context: BrowserContext | null = null;
  try {
    context = await launchAfterPhysicalConsoleDisplayWake(() =>
      launchPersistentChrome(input.executablePath, input.profilePath, [
        "--enable-webgpu-developer-features",
      ]),
    );
    const browserSession = await requireBrowserSession(context);
    const processId = await browserProcessId(browserSession);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(input.origin, { waitUntil: "load" });
    const sentinelPrefix = `${input.mechanism}-${randomBytes(18).toString("base64url")}`;
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    const cacheBefore = await attemptCacheProbes(
      context,
      page,
      browserSession,
      "before",
      input.origin,
    );
    await prepareInertUninstallProbe({
      browserSession,
      page,
      probeUrl: input.probeUrl,
      serviceWorkerPath: input.serviceWorkerPath,
    });
    const capture = await captureUninstallBeforeObservation(
      page,
      sentinelPrefix,
      input.serviceWorkerPath,
    );
    const { before, beforeSeedUsage, beforeUsage } = capture;
    await reopenAndAttestProductUninstallUi(page, input.origin, input.mechanism);
    let response: UninstallMechanismObservation["response"] = null;
    let productTelemetry: unknown | null = null;
    if (input.mechanism === "client-side") {
      await page.locator("#uninstall-open").click();
      await page.locator("#uninstall-client-confirm").click();
      await page
        .waitForFunction(
          () => {
            const state = document
              .querySelector("[data-uninstall-state]")
              ?.getAttribute("data-uninstall-state");
            return state === "succeeded" || state === "failed";
          },
          undefined,
          { timeout: 30_000 },
        )
        .catch(() => undefined);
      productTelemetry = await page.evaluate(
        () =>
          (
            globalThis as typeof globalThis & { __parallaxUninstallDiagnosticsV1?: () => unknown }
          ).__parallaxUninstallDiagnosticsV1?.() ?? null,
      );
      const diagnostic = parseProductDiagnostic(productTelemetry);
      input.recordDiagnostic(diagnostic);
      if (diagnostic.state !== "succeeded") {
        throw new Error(
          `Client-side uninstall ended in ${diagnostic.state}: ${
            diagnostic.failures
              .map(({ message, phase, surface }) => `${surface}/${phase}: ${message}`)
              .join("; ") || "no product failure was reported"
          }`,
        );
      }
    } else {
      response = await submitClearSiteData(page, input.origin, input.readLocalResponses);
    }
    const inspectionPage = await context.newPage();
    await inspectionPage.goto(input.probeUrl, { waitUntil: "load" });
    const after = await inspectStorage(inspectionPage);
    const afterUsage = await waitForReleasedEstimate(inspectionPage, beforeUsage.usage);
    const cacheAfter = await attemptCacheProbes(
      context,
      inspectionPage,
      browserSession,
      "after",
      input.origin,
    );
    await browserSession.detach();
    const sentinels = sentinelValues(sentinelPrefix, input.origin, input.serviceWorkerPath);
    const measuredQuota = {
      afterQuota: afterUsage.quota,
      afterUsage: afterUsage.usage,
      beforeQuota: beforeUsage.quota,
      beforeUsage: beforeUsage.usage,
      releasedBytes: beforeUsage.usage - afterUsage.usage,
      seededBytes: beforeUsage.usage - beforeSeedUsage.usage,
    };
    return {
      authority: {
        artifactDigest: input.artifactDigest,
        browser: {
          executableSha256: environment.executableSha256,
          product: environment.browserProduct,
          revision: environment.browserRevision,
        },
        environment: { gateState: "measured", machineId: environment.machineId, tier: "showcase" },
        origin: input.origin,
        releaseDigest: input.releaseDigest,
        source: input.source,
        target: input.targetIdentity,
      },
      cleanup: { postValidationPassed: false, profileRemoved: false },
      endpoint: input.mechanism === "clear-site-data" ? "/uninstall" : null,
      mechanism: input.mechanism,
      processId,
      productTelemetry,
      profileId: `profile-${basename(input.profilePath).replaceAll(/[^A-Za-z0-9_-]/gu, "_")}`,
      quota: measuredQuota,
      response,
      surfaces: storageSurfaces(before, after, sentinels, cacheBefore, cacheAfter),
    };
  } finally {
    await context?.close();
  }
}

type StorageInventory = Readonly<{
  cacheStorage: readonly string[];
  indexedDb: readonly string[];
  opfs: readonly string[];
  serviceWorkers: readonly string[];
}>;
type CacheProbeCapture = Readonly<{ dawn: string; http: string; v8: string }>;

type UninstallInertProbeAttestation = Readonly<{
  controllerScriptUrl: string | null;
  location: string;
  marker: string | null;
  registrationScopes: readonly string[];
  registrationScriptUrls: readonly (string | null)[];
  runtimeGlobalsAbsent: boolean;
  scriptCount: number;
  title: string;
}>;

const PRODUCT_UNINSTALL_UI_SELECTORS = Object.freeze([
  "#uninstall-open",
  "#uninstall-client-confirm",
  "#uninstall-site-data-confirm",
] as const);

type ProductUninstallUiAttestation = Readonly<{
  availableSelectors: readonly string[];
  location: string;
  readyState: DocumentReadyState;
  selectedConfirmationSelector: string;
}>;

async function reopenAndAttestProductUninstallUi(
  page: Page,
  origin: string,
  mechanism: UninstallMechanism,
): Promise<void> {
  const expectedLocation = new URL("/", origin).href;
  const selectedConfirmationSelector = productUninstallConfirmationSelector(mechanism);
  await page.goto(origin, { waitUntil: "load" });
  await page.waitForFunction(
    ({ expectedLocation: location, selectors }) =>
      globalThis.location.href === location &&
      document.readyState === "complete" &&
      selectors.every((selector) => {
        const element = document.querySelector(selector);
        return element instanceof HTMLButtonElement && element.isConnected && !element.disabled;
      }),
    { expectedLocation, selectors: PRODUCT_UNINSTALL_UI_SELECTORS },
  );
  const attestation = await page.evaluate(
    ({ selectedConfirmationSelector: selected, selectors }) => ({
      availableSelectors: selectors.filter((selector) => {
        const element = document.querySelector(selector);
        return element instanceof HTMLButtonElement && element.isConnected && !element.disabled;
      }),
      location: globalThis.location.href,
      readyState: document.readyState,
      selectedConfirmationSelector: selected,
    }),
    { selectedConfirmationSelector, selectors: PRODUCT_UNINSTALL_UI_SELECTORS },
  );
  validateProductUninstallUiReadiness(attestation, origin, mechanism);
}

function productUninstallConfirmationSelector(mechanism: UninstallMechanism): string {
  return mechanism === "client-side" ? "#uninstall-client-confirm" : "#uninstall-site-data-confirm";
}

export function validateProductUninstallUiReadiness(
  value: ProductUninstallUiAttestation,
  origin: string,
  mechanism: UninstallMechanism,
): void {
  if (
    !exactKeys(value, [
      "availableSelectors",
      "location",
      "readyState",
      "selectedConfirmationSelector",
    ]) ||
    value.location !== new URL("/", origin).href ||
    value.readyState !== "complete" ||
    JSON.stringify(value.availableSelectors) !== JSON.stringify(PRODUCT_UNINSTALL_UI_SELECTORS) ||
    value.selectedConfirmationSelector !== productUninstallConfirmationSelector(mechanism)
  ) {
    throw new Error("Product uninstall UI readiness attestation is invalid");
  }
}

async function prepareInertUninstallProbe(
  input: Readonly<{
    browserSession: CDPSession;
    page: Page;
    probeUrl: string;
    serviceWorkerPath: string;
  }>,
): Promise<void> {
  await input.page.goto(input.probeUrl, { waitUntil: "load" });
  await waitForNoPageWorkerTargets(input.browserSession, input.page);
  const expected = inertProbeExpectation(input.probeUrl, input.serviceWorkerPath);
  validateUninstallInertProbeAttestation(await readInertProbeAttestation(input.page), expected);

  const inventoryBefore = await inspectStorage(input.page);
  const estimateBefore = await estimate(input.page);
  const fetched = await input.page.evaluate(async (probeUrl) => {
    const response = await fetch(probeUrl, { cache: "no-store" });
    return {
      body: await response.text(),
      contentType: response.headers.get("content-type"),
      status: response.status,
      url: response.url,
    };
  }, input.probeUrl);
  if (
    fetched.status !== 200 ||
    fetched.url !== input.probeUrl ||
    fetched.contentType !== "text/html; charset=utf-8" ||
    !fetched.body.includes(LOCAL_SERVER_IDENTITY_PROBE_MARKER)
  ) {
    throw new Error("Uninstall inert probe fetch identity is invalid");
  }
  const inventoryAfter = await inspectStorage(input.page);
  const estimateAfter = await estimate(input.page);
  if (
    JSON.stringify(inventoryAfter) !== JSON.stringify(inventoryBefore) ||
    estimateAfter.quota !== estimateBefore.quota ||
    estimateAfter.usage !== estimateBefore.usage
  ) {
    throw new Error("Uninstall inert probe fetch changed origin storage");
  }
  validateUninstallInertProbeAttestation(await readInertProbeAttestation(input.page), expected);
}

async function captureUninstallBeforeObservation(
  page: Page,
  sentinelPrefix: string,
  serviceWorkerPath: string,
): Promise<
  Readonly<{
    before: StorageInventory;
    beforeSeedUsage: Readonly<{ quota: number; usage: number }>;
    beforeUsage: Readonly<{ quota: number; usage: number }>;
  }>
> {
  const beforeSeedUsage = await estimate(page);
  await seedSentinels(page, sentinelPrefix, serviceWorkerPath);
  const before = await inspectStorage(page);
  const beforeUsage = await estimate(page);
  return Object.freeze({ before, beforeSeedUsage, beforeUsage });
}

function inertProbeExpectation(probeUrl: string, serviceWorkerPath: string) {
  const origin = new URL(probeUrl).origin;
  return Object.freeze({
    controllerScriptUrl: new URL(serviceWorkerPath, origin).href,
    location: probeUrl,
    registrationScope: `${origin}/`,
  });
}

export function validateUninstallInertProbeAttestation(
  value: UninstallInertProbeAttestation,
  expected: Readonly<{
    controllerScriptUrl: string;
    location: string;
    registrationScope: string;
  }>,
): void {
  if (
    !exactKeys(value, [
      "controllerScriptUrl",
      "location",
      "marker",
      "registrationScopes",
      "registrationScriptUrls",
      "runtimeGlobalsAbsent",
      "scriptCount",
      "title",
    ]) ||
    value.location !== expected.location ||
    value.marker !== LOCAL_SERVER_IDENTITY_PROBE_MARKER ||
    value.title !== "Parallax harness identity probe" ||
    value.scriptCount !== 0 ||
    value.runtimeGlobalsAbsent !== true ||
    value.controllerScriptUrl !== expected.controllerScriptUrl ||
    JSON.stringify(value.registrationScopes) !== JSON.stringify([expected.registrationScope]) ||
    JSON.stringify(value.registrationScriptUrls) !== JSON.stringify([expected.controllerScriptUrl])
  ) {
    throw new Error("Uninstall inert probe attestation is invalid");
  }
}

async function readInertProbeAttestation(page: Page): Promise<UninstallInertProbeAttestation> {
  return page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const runtime = globalThis as typeof globalThis & Record<string, unknown>;
    return {
      controllerScriptUrl: navigator.serviceWorker.controller?.scriptURL ?? null,
      location: globalThis.location.href,
      marker:
        document.querySelector<HTMLMetaElement>('meta[name="parallax-harness-probe"]')?.content ??
        null,
      registrationScopes: registrations.map(({ scope }) => scope).sort(),
      registrationScriptUrls: registrations
        .map((registration) => registration.active?.scriptURL ?? null)
        .sort((left, right) => String(left).localeCompare(String(right))),
      runtimeGlobalsAbsent:
        !("__PARALLAX_TELEMETRY__" in runtime) && !("__parallaxUninstallDiagnosticsV1" in runtime),
      scriptCount: document.scripts.length,
      title: document.title,
    };
  });
}

async function waitForNoPageWorkerTargets(session: CDPSession, page: Page): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (true) {
    const result = (await session.send("Target.getTargets")) as {
      targetInfos: readonly { type: string; url: string }[];
    };
    const pageWorkers = result.targetInfos.filter(({ type }) =>
      ["shared_worker", "worker"].includes(type),
    );
    if (pageWorkers.length === 0) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `Uninstall inert probe retained page worker targets: ${pageWorkers
          .map(({ type, url }) => `${type}:${url}`)
          .join(",")}`,
      );
    }
    await page.waitForTimeout(50);
  }
}

async function seedSentinels(page: Page, prefix: string, serviceWorkerPath: string): Promise<void> {
  await page.evaluate(
    async ({ bytes, prefix, sentinelWorkerPath, serviceWorkerPath }) => {
      const opfs = await navigator.storage.getDirectory();
      const file = await opfs.getFileHandle(`${prefix}-opfs`, { create: true });
      const writer = await file.createWritable();
      const chunk = new Uint8Array(1024 * 1024);
      for (let offset = 0; offset < bytes; offset += chunk.byteLength) await writer.write(chunk);
      await writer.close();
      const cacheName = `${prefix}-cache-storage`;
      const cache = await caches.open(cacheName);
      await cache.put(`/__parallax/uninstall-sentinel/${prefix}`, new Response(prefix));
      await new Promise<void>((resolvePromise, reject) => {
        const request = indexedDB.open(`${prefix}-indexed-db`, 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("sentinel").put(prefix, "value");
        request.onerror = () =>
          reject(request.error ?? new Error("Sentinel IndexedDB creation failed"));
        request.onsuccess = () => {
          request.result.close();
          resolvePromise();
        };
      });
      const activate = async (registration: ServiceWorkerRegistration): Promise<void> => {
        await new Promise<void>((resolvePromise, reject) => {
          const worker = registration.installing ?? registration.waiting ?? registration.active;
          if (worker?.state === "activated") {
            resolvePromise();
            return;
          }
          if (worker?.state === "redundant") {
            reject(new Error("Sentinel service worker was redundant before activation"));
            return;
          }
          if (worker === null || worker === undefined) {
            reject(new Error("Sentinel service worker has no lifecycle worker"));
            return;
          }
          const timeout = globalThis.setTimeout(
            () => reject(new Error("Sentinel service-worker activation timed out")),
            10_000,
          );
          worker.addEventListener(
            "statechange",
            () => {
              if (worker.state === "activated") {
                globalThis.clearTimeout(timeout);
                resolvePromise();
              } else if (worker.state === "redundant") {
                globalThis.clearTimeout(timeout);
                reject(new Error("Sentinel service worker became redundant before activation"));
              }
            },
            { once: false },
          );
        });
      };
      await activate(
        await navigator.serviceWorker.register(serviceWorkerPath, {
          scope: "/",
          type: "module",
          updateViaCache: "none",
        }),
      );
      const sentinelRegistration = await navigator.serviceWorker.register(sentinelWorkerPath, {
        scope: `/__parallax-uninstall-sentinel-${encodeURIComponent(prefix)}/`,
        updateViaCache: "none",
      });
      await activate(sentinelRegistration);
    },
    {
      bytes: SENTINEL_BYTES,
      prefix,
      sentinelWorkerPath: uninstallSentinelWorkerPath(prefix),
      serviceWorkerPath,
    },
  );
}

async function inspectStorage(page: Page): Promise<StorageInventory> {
  return page.evaluate(async () => {
    const opfs: string[] = [];
    for await (const name of (await navigator.storage.getDirectory()).keys()) opfs.push(name);
    const registrations = await navigator.serviceWorker.getRegistrations();
    return {
      cacheStorage: [...(await caches.keys())].sort(),
      indexedDb: (await indexedDB.databases()).map(({ name }) => name ?? "<unnamed>").sort(),
      opfs: opfs.sort(),
      serviceWorkers: registrations
        .map((registration) => registration.scope)
        .concat(
          navigator.serviceWorker.controller === null
            ? []
            : [`controller:${navigator.serviceWorker.controller.scriptURL}`],
        )
        .sort(),
    };
  });
}

async function estimate(page: Page): Promise<{ quota: number; usage: number }> {
  const value = await page.evaluate(() => navigator.storage.estimate());
  if (!Number.isFinite(value.quota) || !Number.isFinite(value.usage))
    throw new Error("Storage estimate omitted finite quota/usage");
  return { quota: value.quota as number, usage: value.usage as number };
}

async function waitForReleasedEstimate(
  page: Page,
  beforeUsage: number,
): Promise<{ quota: number; usage: number }> {
  const deadline = Date.now() + 10_000;
  let observed = await estimate(page);
  while (observed.usage >= beforeUsage && Date.now() < deadline) {
    await page.waitForTimeout(100);
    observed = await estimate(page);
  }
  return observed;
}

async function submitClearSiteData(
  page: Page,
  origin: string,
  readLocalResponses: () => readonly LocalServerJournalEntry[],
): Promise<NonNullable<UninstallMechanismObservation["response"]>> {
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  const observations: ClearSiteDataCdpObservation[] = [];
  const methods = new Map<string, string>();
  const journalStart = readLocalResponses().length;
  session.on("Network.requestWillBeSent", (event) => {
    const value = event as unknown as {
      requestId?: unknown;
      request?: { method?: unknown; url?: unknown };
    };
    if (
      typeof value.requestId === "string" &&
      typeof value.request?.method === "string" &&
      value.request.url === `${origin}/uninstall`
    ) {
      methods.set(value.requestId, value.request.method);
    }
  });
  session.on("Network.responseReceived", (event) => {
    const value = event as unknown as {
      requestId?: unknown;
      response?: {
        fromServiceWorker?: unknown;
        headers?: unknown;
        status?: unknown;
        url?: unknown;
      };
    };
    if (value.response?.url !== `${origin}/uninstall`) return;
    const headers = isUnknownRecord(value.response.headers) ? value.response.headers : {};
    const clearSiteData = Object.entries(headers).find(
      ([name]) => name.toLowerCase() === "clear-site-data",
    )?.[1];
    observations.push({
      clearSiteData,
      fromServiceWorker: value.response.fromServiceWorker,
      method: typeof value.requestId === "string" ? methods.get(value.requestId) : undefined,
      requestId: value.requestId,
      status: value.response.status,
      url: value.response.url,
    });
  });
  try {
    await page.locator("#uninstall-open").click();
    await page.locator("#uninstall-site-data-confirm").click({ noWaitAfter: true });
    const deadline = Date.now() + 10_000;
    while (matchingUninstallResponses(readLocalResponses().slice(journalStart)).length === 0) {
      if (Date.now() >= deadline) break;
      await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 50));
    }
  } finally {
    await session.detach();
  }
  return resolveClearSiteDataResponse(
    readLocalResponses().slice(journalStart),
    origin,
    observations,
  );
}

export function resolveClearSiteDataResponse(
  entries: readonly LocalServerJournalEntry[],
  origin: string,
  observations: readonly ClearSiteDataCdpObservation[],
): NonNullable<UninstallMechanismObservation["response"]> {
  if (observations.length !== 1) {
    throw new Error("Clear-Site-Data response did not have exactly one URL-scoped CDP observation");
  }
  const cdpMatch = observations[0];
  if (
    cdpMatch === undefined ||
    cdpMatch.clearSiteData !== '"storage", "cache"' ||
    cdpMatch.method !== "POST" ||
    typeof cdpMatch.requestId !== "string" ||
    cdpMatch.requestId === "" ||
    cdpMatch.status !== 200 ||
    cdpMatch.url !== `${origin}/uninstall`
  ) {
    throw new Error("Clear-Site-Data CDP observation did not match the exact request/response");
  }
  if (cdpMatch.fromServiceWorker !== false) {
    throw new Error("Clear-Site-Data CDP observation did not prove direct network provenance");
  }
  const matches = matchingUninstallResponses(entries);
  if (matches.length !== 1) {
    throw new Error("Clear-Site-Data response lacked one exact guarded local-server record");
  }
  return {
    clearSiteData: '"storage", "cache"',
    fromServiceWorker: cdpMatch.fromServiceWorker,
    method: "POST",
    requestId: cdpMatch.requestId,
    status: 200,
    transport: matches[0]?.completion === "completed" ? "completed" : "client-closed-after-headers",
    url: `${origin}/uninstall`,
  };
}

export type ClearSiteDataCdpObservation = Readonly<{
  clearSiteData: unknown;
  fromServiceWorker?: unknown;
  method: unknown;
  requestId: unknown;
  status: unknown;
  url: unknown;
}>;

function matchingUninstallResponses(
  entries: readonly LocalServerJournalEntry[],
): readonly LocalServerJournalEntry[] {
  return entries.filter(
    ({ clearSiteData, completion, headersSent, intendedStatus, method, path, status }) =>
      clearSiteData === '"storage", "cache"' &&
      headersSent === true &&
      intendedStatus === 200 &&
      method === "POST" &&
      path === "/uninstall" &&
      ((completion === "completed" && status === 200) ||
        (completion === "client-closed" && status === 499)),
  );
}

async function attemptCacheProbes(
  context: BrowserContext,
  page: Page,
  browserSession: CDPSession,
  phase: "after" | "before",
  workloadUrl: string,
): Promise<CacheProbeCapture> {
  await page.goto(workloadUrl, { waitUntil: "load" });
  let v8 = "v8-trace:attempted";
  try {
    const trace = await beginV8TraceCapture(context);
    const result = await finishV8TraceAfterOperation(trace, () =>
      page.reload({ waitUntil: "load" }).then(() => undefined),
    );
    v8 =
      result.trace.state === "invalid"
        ? `input=${workloadUrl};reload=1;v8-trace:${phase}:failed:${sanitize(result.trace.reason)}`
        : `input=${workloadUrl};reload=1;v8-trace:${phase}:measured:events=${result.trace.eventCount}`;
  } catch (error: unknown) {
    v8 = `input=${workloadUrl};reload=1;v8-trace:${phase}:failed:${sanitize(error)}`;
  }
  let dawn = "dawn-histograms:attempted";
  try {
    const result = (await browserSession.send("Browser.getHistograms", {
      delta: false,
      query: "GPU.D3D12",
    })) as { histograms: readonly unknown[] };
    dawn = `input=Browser.getHistograms(GPU.D3D12);workload=${workloadUrl};dawn-histograms:${phase}:count=${result.histograms.length}`;
  } catch (error: unknown) {
    dawn = `input=Browser.getHistograms(GPU.D3D12);workload=${workloadUrl};dawn-histograms:${phase}:failed:${sanitize(error)}`;
  }
  let http = "cdp-network-cache:attempted";
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Network.enable");
    let disk = 0;
    let serviceWorker = 0;
    let responses = 0;
    session.on("Network.responseReceived", (event) => {
      const response = (
        event as unknown as { response: { fromDiskCache?: boolean; fromServiceWorker?: boolean } }
      ).response;
      responses += 1;
      if (response.fromDiskCache === true) disk += 1;
      if (response.fromServiceWorker === true) serviceWorker += 1;
    });
    await page.reload({ waitUntil: "load" });
    http = `input=${workloadUrl};reload=1;cdp-network-cache:${phase}:responses=${responses}:disk=${disk}:service-worker=${serviceWorker}`;
  } catch (error: unknown) {
    http = `input=${workloadUrl};reload=1;cdp-network-cache:${phase}:failed:${sanitize(error)}`;
  } finally {
    await session.detach().catch(() => undefined);
  }
  return { dawn, http, v8 };
}

function sentinelValues(prefix: string, origin: string, _serviceWorkerPath: string) {
  return {
    cacheStorage: `${prefix}-cache-storage`,
    indexedDb: `${prefix}-indexed-db`,
    opfs: `${prefix}-opfs`,
    serviceWorkers: `${origin}/__parallax-uninstall-sentinel-${encodeURIComponent(prefix)}/`,
  };
}

function storageSurfaces(
  before: StorageInventory,
  after: StorageInventory,
  sentinels: ReturnType<typeof sentinelValues>,
  cacheBefore: CacheProbeCapture,
  cacheAfter: CacheProbeCapture,
): readonly UninstallRawSurfaceObservation[] {
  const required = <K extends keyof StorageInventory>(
    surface: "cache-storage" | "indexed-db" | "opfs" | "service-workers",
    key: K,
    sentinel: string,
    kind: "page-cache-storage" | "page-indexed-db" | "page-opfs" | "page-service-worker",
  ): UninstallRawSurfaceObservation => ({
    after: after[key],
    before: before[key],
    probe: { attempted: true, kind, reason: null },
    sentinel,
    source: "page",
    surface,
    verdict: after[key].length === 0 ? "cleared" : "retained",
  });
  const cache = (
    surface: "http-cache" | "v8-code-cache" | "dawn-gpu-cache",
    source: "cdp" | "trace",
    kind: "cdp-network-cache" | "v8-trace-code-cache" | "dawn-subprocess-histograms",
    beforeValue: string,
    afterValue: string,
  ): UninstallRawSurfaceObservation => ({
    after: [afterValue],
    before: [beforeValue],
    probe: {
      attempted: true,
      kind,
      reason:
        beforeValue.includes(":failed:") || afterValue.includes(":failed:")
          ? `Probe failed: ${[beforeValue, afterValue].find((value) => value.includes(":failed:"))}`
          : surface === "http-cache"
            ? "CDP response cache flags cannot prove eviction of every origin HTTP-cache entry."
            : surface === "v8-code-cache"
              ? "V8 trace events expose no origin-scoped code-cache inventory or deletion operation."
              : "CDP Dawn histograms are process-wide cumulative counters and cannot attribute eviction to this origin.",
    },
    sentinel: null,
    source,
    surface,
    verdict: "unobservable",
  });
  return [
    required("opfs", "opfs", sentinels.opfs, "page-opfs"),
    required("service-workers", "serviceWorkers", sentinels.serviceWorkers, "page-service-worker"),
    required("cache-storage", "cacheStorage", sentinels.cacheStorage, "page-cache-storage"),
    required("indexed-db", "indexedDb", sentinels.indexedDb, "page-indexed-db"),
    cache("http-cache", "cdp", "cdp-network-cache", cacheBefore.http, cacheAfter.http),
    cache("v8-code-cache", "trace", "v8-trace-code-cache", cacheBefore.v8, cacheAfter.v8),
    cache("dawn-gpu-cache", "cdp", "dawn-subprocess-histograms", cacheBefore.dawn, cacheAfter.dawn),
  ];
}

async function requireBrowserSession(context: BrowserContext): Promise<CDPSession> {
  const browser = context.browser();
  if (browser === null) throw new Error("Playwright did not expose the browser");
  return browser.newBrowserCDPSession();
}

async function browserProcessId(session: CDPSession): Promise<number> {
  const result = (await session.send("SystemInfo.getProcessInfo")) as {
    processInfo: readonly { id: number; type: string }[];
  };
  const browser = result.processInfo.find(({ type }) => type === "browser");
  if (browser === undefined || !Number.isSafeInteger(browser.id) || browser.id <= 0)
    throw new Error("CDP omitted browser process identity");
  return browser.id;
}

function pendingReport(
  startedAt: string,
  setupAuthority: UninstallMechanismObservation["authority"] | null,
  setupProgress: UninstallSetupProgress,
): Readonly<Record<string, unknown>> {
  return {
    contract: UNINSTALL_EVIDENCE_CONTRACT,
    postValidation: { passed: false, performed: false },
    schemaVersion: UNINSTALL_EVIDENCE_SCHEMA_VERSION,
    setupAuthority,
    setupProgress,
    startedAt,
    state: "pending",
  };
}

export function validateUninstallTerminalReport(
  report: UninstallTerminalReport,
  expectedAuthority: UninstallMechanismObservation["authority"] | null,
): void {
  validateSetupProgress(report.setupProgress, expectedAuthority);
  validateMechanismDiagnostics(report.mechanismDiagnostics);
  if (
    report.contract !== UNINSTALL_EVIDENCE_CONTRACT ||
    report.schemaVersion !== UNINSTALL_EVIDENCE_SCHEMA_VERSION ||
    (report.state !== "failed" && report.state !== "passed") ||
    JSON.stringify(report.setupAuthority) !== JSON.stringify(expectedAuthority) ||
    !exactKeys(report.postValidation, ["passed", "performed"]) ||
    typeof report.postValidation.performed !== "boolean" ||
    typeof report.postValidation.passed !== "boolean" ||
    (report.postValidation.passed && !report.postValidation.performed) ||
    (report.state === "passed" &&
      (!report.postValidation.performed || !report.postValidation.passed)) ||
    (report.state === "passed" && (report.evidence?.passed !== true || report.failure !== null)) ||
    (report.state === "failed" && report.failure === null) ||
    (report.state === "passed" &&
      (report.mechanismDiagnostics.length !== 1 ||
        report.mechanismDiagnostics[0]?.state !== "succeeded"))
  ) {
    throw new Error("Uninstall terminal report contradicts independently resolved authority/state");
  }
  if (
    report.evidence !== null &&
    (report.evidence.contract !== UNINSTALL_EVIDENCE_CONTRACT ||
      report.evidence.schemaVersion !== UNINSTALL_EVIDENCE_SCHEMA_VERSION ||
      report.evidence.mechanisms.length !== UNINSTALL_MECHANISMS.length ||
      !UNINSTALL_MECHANISMS.every(
        (mechanism) =>
          report.evidence?.mechanisms.some(
            (observation) => observation.mechanism === mechanism && observation.passed,
          ) === true,
      ) ||
      expectedAuthority === null ||
      report.evidence.mechanisms.some(
        ({ authority }) => JSON.stringify(authority) !== JSON.stringify(expectedAuthority),
      ))
  ) {
    throw new Error("Uninstall terminal report evidence authority is invalid");
  }
}

function parseProductDiagnostic(value: unknown): UninstallMechanismDiagnostic {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Client-side uninstall terminal diagnostics are absent");
  }
  const telemetry = value as Record<string, unknown>;
  const state = telemetry.state;
  if (
    !exactKeys(telemetry, [
      "attempt",
      "contract",
      "coverage",
      "failures",
      "quota",
      "quiescence",
      "schemaVersion",
      "state",
      "surfaces",
    ]) ||
    telemetry.contract !== "uninstall-telemetry@1" ||
    telemetry.schemaVersion !== 1 ||
    !Number.isSafeInteger(telemetry.attempt) ||
    Number(telemetry.attempt) <= 0 ||
    !["failed", "idle", "running", "succeeded"].includes(String(state)) ||
    !Array.isArray(telemetry.failures) ||
    telemetry.failures.length > 8
  ) {
    throw new Error("Client-side uninstall terminal diagnostics are invalid");
  }
  const failures = telemetry.failures.map(
    (raw): UninstallMechanismDiagnostic["failures"][number] => {
      if (
        typeof raw !== "object" ||
        raw === null ||
        Array.isArray(raw) ||
        !exactKeys(raw, ["message", "phase", "surface"])
      ) {
        throw new Error("Client-side uninstall failure diagnostic is invalid");
      }
      const failure = raw as Record<string, unknown>;
      if (
        typeof failure.message !== "string" ||
        failure.message.length === 0 ||
        failure.message.length > 500 ||
        typeof failure.phase !== "string" ||
        ![
          "after",
          "before",
          "delete",
          "prepare",
          "quiescence",
          "quota-after",
          "quota-before",
        ].includes(failure.phase) ||
        typeof failure.surface !== "string" ||
        !["cache-storage", "indexed-db", "opfs", "quota", "runtime", "service-workers"].includes(
          failure.surface,
        )
      ) {
        throw new Error("Client-side uninstall failure diagnostic value is invalid");
      }
      return Object.freeze({
        message: sanitize(failure.message),
        phase: failure.phase,
        surface: failure.surface,
      });
    },
  );
  if ((state === "failed") !== failures.length > 0) {
    throw new Error("Client-side uninstall terminal state contradicts its failures");
  }
  return Object.freeze({
    attempt: Number(telemetry.attempt),
    failures: Object.freeze(failures),
    mechanism: "client-side",
    state: state as UninstallMechanismDiagnostic["state"],
  });
}

function validateMechanismDiagnostics(values: readonly UninstallMechanismDiagnostic[]): void {
  if (!Array.isArray(values) || values.length > 1) {
    throw new Error("Uninstall mechanism diagnostics are invalid");
  }
  for (const value of values) {
    const parsed = parseProductDiagnostic({
      attempt: value.attempt,
      contract: "uninstall-telemetry@1",
      coverage: {},
      failures: value.failures,
      quota: {},
      quiescence: {},
      schemaVersion: 1,
      state: value.state,
      surfaces: [],
    });
    if (value.mechanism !== "client-side" || JSON.stringify(parsed) !== JSON.stringify(value)) {
      throw new Error("Uninstall mechanism diagnostic is not canonical");
    }
  }
}

export function validateSetupProgress(
  progress: UninstallSetupProgress,
  authority: UninstallMechanismObservation["authority"] | null,
): void {
  const keys = Object.keys(progress).sort();
  if (
    JSON.stringify(keys) !== JSON.stringify(["browser", "build", "environment", "source", "target"])
  ) {
    throw new Error("Uninstall setup progress fields are invalid");
  }
  if (
    (progress.build !== null &&
      (!exactKeys(progress.build, ["artifactDigest", "releaseDigest"]) ||
        !isSha(progress.build.artifactDigest) ||
        !isSha(progress.build.releaseDigest))) ||
    (progress.source !== null &&
      (!exactKeys(progress.source, ["commit", "dirtyTreeDigest"]) ||
        !/^[a-f0-9]{40}$/u.test(progress.source.commit) ||
        (progress.source.dirtyTreeDigest !== null && !isSha(progress.source.dirtyTreeDigest)))) ||
    (progress.browser !== null &&
      (!exactKeys(progress.browser, ["executableSha256", "product", "revision"]) ||
        (progress.browser.executableSha256 !== null && !isSha(progress.browser.executableSha256)) ||
        progress.browser.product === "" ||
        progress.browser.revision === "")) ||
    (progress.environment !== null &&
      (!exactKeys(progress.environment, ["gateState", "machineId", "tier"]) ||
        progress.environment.machineId === "")) ||
    (progress.target !== null && typeof progress.target !== "object")
  ) {
    throw new Error("Uninstall setup progress value is invalid");
  }
  const prerequisiteComplete =
    progress.build !== null &&
    progress.source !== null &&
    progress.browser?.executableSha256 !== null &&
    progress.browser !== null &&
    progress.target !== null;
  if (progress.environment !== null && !prerequisiteComplete) {
    throw new Error("Uninstall setup progress claims measured environment prematurely");
  }
  if (authority === null) {
    if (progress.environment !== null) {
      throw new Error("Uninstall setup progress measured environment lacks full authority");
    }
    return;
  }
  if (
    progress.environment === null ||
    progress.build?.artifactDigest !== authority.artifactDigest ||
    progress.build.releaseDigest !== authority.releaseDigest ||
    JSON.stringify(progress.source) !== JSON.stringify(authority.source) ||
    JSON.stringify(progress.browser) !== JSON.stringify(authority.browser) ||
    JSON.stringify(progress.environment) !== JSON.stringify(authority.environment) ||
    JSON.stringify(progress.target) !== JSON.stringify(authority.target)
  ) {
    throw new Error("Uninstall setup progress does not reconstruct full authority");
  }
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function isSha(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

async function publishTerminal(
  reservation: ResultPairReservation,
  report: UninstallTerminalReport,
): Promise<void> {
  await reservation.publishPair({ ...report }, formatUninstallMarkdown(report), report.state, {
    retainJsonPrimaryOnMarkdownFailure: true,
  });
}

function formatUninstallMarkdown(report: UninstallTerminalReport): string {
  return [
    "# Uninstall verification",
    "",
    `- State: \`${report.state}\``,
    `- Contract: \`${report.contract}\``,
    `- Started: \`${report.startedAt}\``,
    `- Completed: \`${report.completedAt}\``,
    `- Client-side: \`${report.evidence?.mechanisms[0]?.passed ?? false}\``,
    `- Clear-Site-Data: \`${report.evidence?.mechanisms[1]?.passed ?? false}\``,
    `- Client terminal state: \`${report.mechanismDiagnostics[0]?.state ?? "not-observed"}\``,
    ...report.mechanismDiagnostics.flatMap(({ failures }) =>
      failures.map(
        ({ message, phase, surface }) => `- Client failure: \`${surface}/${phase}\` — ${message}`,
      ),
    ),
    ...(report.failure === null
      ? []
      : [`- Failure phase: \`${report.failure.phase}\``, `- Failure: ${report.failure.message}`]),
    "",
  ].join("\n");
}

function sanitize(error: unknown): string {
  return sanitizeEvidenceText(error, {
    fallback: "Unknown uninstall verification failure",
    maximumLength: 500,
  });
}
