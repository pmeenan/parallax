import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readAndValidateBuildManifest } from "./build-manifest.js";

describe("installer trust-fault harness isolation", () => {
  it("keeps schema-12 raw rejection retention bounded and schema-11 topology isolated", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../..");
    const [proofHarness, runHarness] = await Promise.all([
      readFile(
        join(repositoryRoot, "harness/src/installer-trust-faults-transition-proof.ts"),
        "utf8",
      ),
      readFile(join(repositoryRoot, "harness/src/installer-trust-faults-run.ts"), "utf8"),
    ]);
    expect(proofHarness).toContain("acceptedObservations");
    expect(proofHarness).toContain("acceptedObservationPrefix");
    expect(proofHarness).toContain("acceptedObservationTail");
    expect(proofHarness).toContain("acceptedObservationCount: rawObservationCount");
    expect(proofHarness).toContain('const rawStreamHash = createHash("sha256")');
    expect(proofHarness).not.toContain(
      "acceptedRawJsonBytesAfterCandidate > INSTALLER_TRUST_FAULT_MAX_ACCEPTED_RAW_BYTES",
    );
    expect(proofHarness).toContain("rejectedSample");
    expect(proofHarness).toContain("sourceDigestSha256");
    expect(proofHarness).toContain("INSTALLER_TRUST_FAULT_MAX_RAW_ARTIFACT_BYTES");
    expect(proofHarness).toContain("deriveRejectedPredicate(");
    expect(runHarness).toContain("runSchemaVersion !== INSTALLER_TRUST_FAULT_RUN_SCHEMA_VERSION");
    expect(runHarness).toContain("const proofFinalizationDiagnostic = null");
  });

  it("keeps harness-only fault tokens and wrappers out of source and production worker bytes", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../..");
    const workerSource = await readFile(
      join(repositoryRoot, "engine/src/workers/installer-worker.ts"),
      "utf8",
    );
    const browserHarness = await readFile(
      join(repositoryRoot, "harness/src/installer-trust-faults-browser.ts"),
      "utf8",
    );
    const build = await readAndValidateBuildManifest(join(repositoryRoot, "dist"));
    const worker = build.manifest.workerEntrypoints.find((entry) => entry.role === "installer");
    if (worker === undefined) throw new Error("Build omits the installer worker");
    const workerBytes = await readFile(join(repositoryRoot, "dist", worker.path), "utf8");
    const appArtifact = build.manifest.artifacts.find((entry) =>
      /^immutable\/app-[a-f0-9]{64}\.js$/u.test(entry.path),
    );
    if (appArtifact === undefined) throw new Error("Build omits the hashed app bundle");
    const appBytes = await readFile(join(repositoryRoot, "dist", appArtifact.path), "utf8");
    const appSources = await Promise.all(
      ["main.ts", "installer-controller.ts", "installer-ui.ts"].map((name) =>
        readFile(join(repositoryRoot, "app/src", name), "utf8"),
      ),
    );

    expect(browserHarness).toContain("__parallaxTrustFaultV1");
    expect(browserHarness).toContain("fresh-disposable-per-cell");
    expect(browserHarness).not.toContain("parallaxAutomation=runtime");
    for (const product of [workerSource, workerBytes, appBytes, ...appSources]) {
      expect(product).not.toContain("__parallaxTrustFaultV1");
      expect(product).not.toContain("__parallaxTrustPersistenceFault");
      expect(product).not.toMatch(
        /fault.?nonce|qualification.?hook|installer.?trust.?fault|trustFault|trust-fault/iu,
      );
      expect(product).not.toMatch(
        /[?&](?:fault|faultNonce|installerTrustFault|trustFault)=|__parallaxTrust/iu,
      );
    }
  });

  it("settles exact startup admission before capturing evidence or clicking", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../..");
    const browserHarness = await readFile(
      join(repositoryRoot, "harness/src/installer-trust-faults-browser.ts"),
      "utf8",
    );
    const wait = browserHarness.indexOf("await waitForInstallerTrustStartupAdmission");
    const baseline = browserHarness.indexOf("await takeTransitions(page, transitionProof);", wait);
    const snapshot = browserHarness.indexOf(
      "const snapshots: InstallerSnapshot[] = [await readInstallerSnapshot(page)]",
      baseline,
    );
    const firstClick = browserHarness.indexOf('await click(page, "#installer-start")', snapshot);

    expect(wait).toBeGreaterThanOrEqual(0);
    expect(baseline).toBeGreaterThan(wait);
    expect(snapshot).toBeGreaterThan(baseline);
    expect(firstClick).toBeGreaterThan(snapshot);
    expect(browserHarness).not.toMatch(/\.disabled\s*=\s*false/u);
    expect(browserHarness).not.toContain('removeAttribute("disabled")');
    expect(browserHarness).not.toMatch(/click\(\s*\{\s*force:\s*true/iu);
  });

  it("collects the complete terminal panel failure tuple through the evaluated observer", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../..");
    const browserHarness = await readFile(
      join(repositoryRoot, "harness/src/installer-trust-faults-browser.ts"),
      "utf8",
    );
    const waitStart = browserHarness.indexOf("async function waitForState(");
    const collectorStart = browserHarness.indexOf(
      "export function collectInstallerTrustProductTerminalEvidenceInPage",
      waitStart,
    );
    const validatorStart = browserHarness.indexOf(
      "export function createInstallerTrustProductTerminalFailure",
      collectorStart,
    );
    const wait = browserHarness.slice(waitStart, collectorStart);
    const collector = browserHarness.slice(collectorStart, validatorStart);

    expect(waitStart).toBeGreaterThanOrEqual(0);
    expect(collectorStart).toBeGreaterThan(waitStart);
    expect(validatorStart).toBeGreaterThan(collectorStart);
    expect(wait).toContain("await collectInstallerTrustProductTerminalEvidence(page)");
    for (const field of ["failureClass", "failureEvidence", "failureMessage"]) {
      expect(collector).toContain(`${field}: panel.dataset.${field} || null`);
    }
    expect(wait).toContain(
      "return page.evaluate(collectInstallerTrustProductTerminalEvidenceInPage)",
    );
  });

  it("retains product and parser failures as exact discriminated v8 failed-cell evidence", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../..");
    const [browserHarness, runHarness, terminalHarness] = await Promise.all([
      readFile(join(repositoryRoot, "harness/src/installer-trust-faults-browser.ts"), "utf8"),
      readFile(join(repositoryRoot, "harness/src/installer-trust-faults-run.ts"), "utf8"),
      readFile(
        join(repositoryRoot, "harness/src/installer-trust-faults-terminal-evidence.ts"),
        "utf8",
      ),
    ]);

    expect(browserHarness).toContain("new InstallerTrustFaultCellTerminalEvidenceError(");
    expect(browserHarness).toContain("await allTransitions(page, transitionProof)");
    expect(browserHarness).toContain('"allow-unexpected-terminal"');
    expect(browserHarness).toContain("selectInstallerTrustFaultResource(authority, id)");
    expect(browserHarness).not.toContain("function selectFaultResource(");
    expect(runHarness).toContain(
      "export const INSTALLER_TRUST_FAULT_PRODUCT_TERMINAL_RUN_SCHEMA_VERSION = 7",
    );
    expect(runHarness).toContain(
      "export const INSTALLER_TRUST_FAULT_CELL_VALIDATION_RUN_SCHEMA_VERSION = 8",
    );
    expect(runHarness).toContain(
      "export const INSTALLER_TRUST_FAULT_BINDING_DIAGNOSTIC_RUN_SCHEMA_VERSION = 9",
    );
    expect(runHarness).toContain("export const INSTALLER_TRUST_FAULT_RUN_SCHEMA_VERSION = 11");
    expect(runHarness).toContain(
      "export const INSTALLER_TRUST_FAULT_TERMINAL_REPEAT_RUN_SCHEMA_VERSION = 10",
    );
    expect(runHarness).toContain("const productTerminal = cause.productTerminal");
    expect(runHarness).toContain("context.retainedProductTerminals.push(error)");
    expect(runHarness).toContain('kind: "product-terminal" as const');
    expect(runHarness).toContain("createInstallerTrustFaultCellValidationEvidence(");
    expect(runHarness).toContain('kind: "cell-validation"');
    expect(runHarness).toContain("InstallerTrustFaultCellValidationError");
    expect(runHarness).toContain("INSTALLER_TRUST_FAULT_CELL_VALIDATION_PREDICATES");
    expect(runHarness).toContain("safeFailureMessageSha256(");
    expect(terminalHarness).toContain(
      "export class InstallerTrustFaultCellTerminalEvidenceError extends Error",
    );
    expect(terminalHarness).toContain(
      "export function findInstallerTrustFaultCellTerminalEvidence(",
    );
    expect(runHarness).toContain("validateFailedCellEvidence(");
    expect(runHarness).toContain("validateCellValidationEvidence(");
    expect(runHarness).toContain("completedCells,");
    expect(runHarness).toContain("failure.phase,");
    expect(runHarness).toMatch(
      /sanitizedFailureCollectionContainsName\(\s*failure\.primary,\s*failure\.cleanupFailures,\s*INSTALLER_TRUST_FAULT_TERMINAL_EVIDENCE_ERROR_NAME,/u,
    );
    expect(runHarness).toContain("productTerminalFailure = false");
    expect(runHarness).toContain("selectInstallerTrustFaultResource(authority, expectedCellId)");
    expect(runHarness).toContain("validateInstallStoreTelemetryProjection(terminal.store)");
    expect(runHarness).toContain("validateInstallerTrustFaultTransitionProof(");
  });

  it("keeps the CLI graph acyclic and reserves evidence before lazy browser startup", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../..");
    const [browserHarness, cliHarness, packageSource, runHarness] = await Promise.all([
      readFile(join(repositoryRoot, "harness/src/installer-trust-faults-browser.ts"), "utf8"),
      readFile(join(repositoryRoot, "harness/src/installer-trust-faults-cli.ts"), "utf8"),
      readFile(join(repositoryRoot, "package.json"), "utf8"),
      readFile(join(repositoryRoot, "harness/src/installer-trust-faults-run.ts"), "utf8"),
    ]);

    expect(browserHarness).toMatch(
      /import type \{ InstallerTrustFaultRuntimeDependencies \} from "\.\/installer-trust-faults-run\.js";/u,
    );
    expect(browserHarness).not.toMatch(
      /import \{[^}]*\} from "\.\/installer-trust-faults-run\.js";/su,
    );
    expect(runHarness).not.toContain('import("./installer-trust-faults-browser.js")');
    const reserve = runHarness.indexOf("const reservation = await dependencies.reserve(");
    const startup = runHarness.indexOf(
      "awaitInstallerTrustFaultRuntimeDependencies(dependencies)",
      reserve,
    );
    expect(reserve).toBeGreaterThanOrEqual(0);
    expect(startup).toBeGreaterThan(reserve);
    expect(runHarness.slice(reserve, startup)).toContain('"runtime-startup",');
    expect(cliHarness).toMatch(
      /createRuntimeDependencies:\s*async[\s\S]*import\("\.\/installer-trust-faults-browser\.js"\)/u,
    );
    expect(cliHarness).toContain("process.exitCode = await runInstallerTrustFaultCli(");
    expect(cliHarness).not.toContain("main().catch");
    expect(packageSource).toContain("node harness/dist/types/installer-trust-faults-cli.js");
  });

  it("keeps historical binding diagnostics isolated from the synchronous browser topology", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../..");
    const [bindingHarness, browserHarness, runHarness] = await Promise.all([
      readFile(
        join(repositoryRoot, "harness/src/installer-trust-faults-binding-diagnostic.ts"),
        "utf8",
      ),
      readFile(join(repositoryRoot, "harness/src/installer-trust-faults-browser.ts"), "utf8"),
      readFile(join(repositoryRoot, "harness/src/installer-trust-faults-run.ts"), "utf8"),
    ]);

    expect(browserHarness).not.toContain("__parallaxTrustTransitionV1");
    expect(browserHarness).not.toContain("createInstallerTrustTransitionBoundaryError");
    expect(browserHarness).not.toContain("exposeBinding");
    expect(runHarness).toContain("readTrustedInstallerTrustTransitionBindingDiagnostic(error)");
    expect(runHarness).not.toContain("safeTransitionBindingDiagnostic");
    expect(bindingHarness).toMatch(/new WeakMap<\s*TrustedTransitionBindingError/u);
    expect(bindingHarness).toContain(
      "Object.getPrototypeOf(input) !== TrustedTransitionBindingError.prototype",
    );
    expect(bindingHarness).not.toContain("export class TrustedTransitionBindingError");
  });

  it("keeps finite attempt milestones separate from the live full-cell proof", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../..");
    const browserHarness = await readFile(
      join(repositoryRoot, "harness/src/installer-trust-faults-browser.ts"),
      "utf8",
    );
    const attemptStart = browserHarness.indexOf("async function takeTransitions");
    const fullStart = browserHarness.indexOf("async function allTransitions", attemptStart);
    const phaseStart = browserHarness.indexOf("async function setTransitionPhase", fullStart);
    const attemptCapture = browserHarness.slice(attemptStart, fullStart);
    const fullCapture = browserHarness.slice(fullStart, phaseStart);

    expect(attemptCapture).toContain("projectInstallerTrustFaultAttemptMilestones(raw)");
    expect(attemptCapture).not.toContain("canonicalizeInstallerTrustFaultTransitions(raw)");
    expect(fullCapture).toContain("const proof = recorder.finish()");
    expect(fullCapture).toContain(
      'await runInstallerTrustTransitionBarrier(page, recorder, "seal")',
    );
    expect(browserHarness).toContain("createInstallerTrustFaultTransitionProofRecorder");
    expect(browserHarness).not.toContain("transitions.all.push");
    expect(browserHarness).not.toContain(".pending");
    expect(attemptCapture).toContain('runInstallerTrustTransitionBarrier(page, recorder, "clear")');
    expect(browserHarness.slice(phaseStart)).toContain(
      'runInstallerTrustTransitionBarrier(page, recorder, "phase", phase)',
    );
    expect(browserHarness).toContain("return value.barrier(barrierKind, barrierPhase)");
    expect(browserHarness).toContain(
      "for (const [index, observation] of batch.rawObservations.entries())",
    );
    expect(browserHarness).toContain('isPhaseFinal ? "barrier" : undefined');
  });

  it("keeps ordinary persistence observation off the product promise chain", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../..");
    const browserHarness = await readFile(
      join(repositoryRoot, "harness/src/installer-trust-faults-browser.ts"),
      "utf8",
    );
    const recorderStart = browserHarness.indexOf(
      "export async function installInstallerTrustPersistenceRecorderInPage",
    );
    const recorderEnd = browserHarness.indexOf(
      "async function setPersistenceContext",
      recorderStart,
    );
    const recorder = browserHarness.slice(recorderStart, recorderEnd);
    const wrapperStart = recorder.indexOf('Object.defineProperty(storage, "persist"');
    const wrapper = recorder.slice(wrapperStart);

    expect(recorderStart).toBeGreaterThanOrEqual(0);
    expect(recorderEnd).toBeGreaterThan(recorderStart);
    expect(wrapper).toContain("Reflect.apply(original, storage, [])");
    expect(wrapper).toContain("const sideObserver = Promise.resolve(returned)");
    expect(wrapper).toContain("return returned;");
    expect(wrapper.match(/Reflect\.apply\(original, storage, \[\]\)/gu)).toHaveLength(1);
    expect(wrapper).not.toMatch(/return\s+Promise\.resolve\(returned\)/u);
    expect(wrapper).not.toMatch(/return\s+sideObserver/u);
    expect(recorder).toContain('error.name = "InstallerTrustPersistenceObserverError"');
    expect(recorder).toContain("observerTail.then");
    const barrierStart = browserHarness.indexOf(
      "async function waitForStateWithPersistenceBarrier",
      recorderEnd,
    );
    const barrierEnd = browserHarness.indexOf(
      "async function readAndClearPersistenceRecorder",
      barrierStart,
    );
    const barrier = browserHarness.slice(barrierStart, barrierEnd);
    expect(barrier.indexOf("await waitForState(page")).toBeGreaterThanOrEqual(0);
    expect(barrier.indexOf("await finalizePersistenceContext(page")).toBeGreaterThan(
      barrier.indexOf("await waitForState(page"),
    );
  });

  it("captures fully published UI state into aligned batches before atomic window rotation", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../..");
    const browserHarness = await readFile(
      join(repositoryRoot, "harness/src/installer-trust-faults-browser.ts"),
      "utf8",
    );
    const recorderStart = browserHarness.indexOf(
      "export async function installInstallerTrustTransitionRecorderInPage",
    );
    const recorderEnd = browserHarness.indexOf("async function postValidateCell", recorderStart);
    const recorder = browserHarness.slice(recorderStart, recorderEnd);

    expect(recorder).toContain("const closed = current");
    expect(recorder).toContain("const closedRaw = currentRaw");
    expect(recorder).toContain("current = []");
    expect(recorder).toContain("currentRaw = []");
    expect(recorder).toContain("const listener = (): void => enqueueCapture(phase)");
    expect(recorder).toContain(": structuredClone({");
    expect(recorder).toContain(
      "activeReleaseDigest: liveTelemetry.installStore.activeReleaseDigest",
    );
    expect(recorder).toContain(
      "failureResourceId: liveTelemetry.installerTransfer.failureResourceId",
    );
    expect(recorder).toContain('degradedDurabilityWarning: rawPersistence === "denied"');
    expect(recorder).not.toContain("#installer-warning");
    expect(recorder).toContain("rawObservations: Object.freeze([...closedRaw])");
    expect(recorder).toContain("transitions: Object.freeze([...closed])");
    expect(recorder).toContain('panel.removeEventListener("parallax-installer-state", listener)');
    expect(recorder).toContain('error.name = "InstallerTrustTransitionCaptureError"');
    expect(recorder).not.toContain("queueMicrotask(");
    expect(recorder).not.toContain("pendingCaptureCount");
    expect(recorder).not.toContain("acknowledgedThrough");
    expect(recorder).not.toContain("tail.then");
    expect(recorder).not.toContain("setTimeout(");
    expect(recorder).not.toContain("__parallaxTrustTransitionV1");
    expect(browserHarness).toContain(
      'Object.keys(batch).sort().join(",") !== "rawObservations,transitions"',
    );
    expect(browserHarness).toContain("batch.rawObservations.length !== batch.transitions.length");
    expect(browserHarness).toContain(
      'recorder.observe(observation, isPhaseFinal ? "barrier" : undefined)',
    );
    expect(browserHarness).toContain("const terminalWarning =");
    expect(browserHarness).toContain('(terminalUiState === "denied") !==');
  });

  it("derives proof bounds from the transition-domain registry without numeric mirrors", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../..");
    const proofSource = await readFile(
      join(repositoryRoot, "harness/src/installer-trust-faults-transition-proof.ts"),
      "utf8",
    );
    for (const domain of [
      "INSTALLER_TRUST_FAULT_BOUND_AUTHORITY_VALUES",
      "INSTALLER_TRUST_FAULT_BOUND_FAILURE_RESOURCE_VALUES",
      "INSTALLER_TRUST_FAULT_OPTIONAL_FAILURE_CODES",
      "INSTALLER_TRUST_FAULT_PHASES",
      "INSTALLER_TRUST_FAULT_STORE_STATES",
      "INSTALLER_TRUST_FAULT_TRANSFER_STATES",
      "INSTALLER_TRUST_FAULT_UI_STATES",
    ]) {
      expect(proofSource).toContain(`${domain}.length`);
    }
    expect(proofSource).not.toMatch(/const [A-Z_]+_COUNT\s*=\s*\d+/u);
  });

  it("keeps the failure-code registry bidirectionally exact with the engine union", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../..");
    const transitionSource = await readFile(
      join(repositoryRoot, "harness/src/installer-trust-faults-transitions.ts"),
      "utf8",
    );
    expect(transitionSource).toContain(
      "Exclude<InstallerFailureCode, T[number]> extends never ? T : never",
    );
    expect(transitionSource).toContain("as const satisfies readonly InstallerFailureCode[]");
    expect(transitionSource).toContain(
      "INSTALLER_TRUST_FAULT_FAILURE_CODES: ExactInstallerFailureCodeDomain<",
    );
  });
});
