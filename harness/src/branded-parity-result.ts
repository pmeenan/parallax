import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type InstalledBrandedChromeIdentity,
  requireBrandedChromeComparable,
  validateBrandedBrowserVersion,
  validateObservedBrowserVersionIdentity,
} from "./branded-chrome.js";
import type { ChromePin } from "./chrome-pin.js";
import type {
  BrowserVersionIdentity,
  RegisteredEnvironmentIdentity,
} from "./registered-environment.js";
import {
  type FinalizationEvidence,
  invalidFinalizationEvidence,
  measuredFinalizationEvidence,
  persistJsonPrimaryReport,
  type ReportPersistenceDependencies,
} from "./report-finalization.js";
import { resultFacetsPassed } from "./result-facets.js";
import {
  SMOKE_MANDATORY_METRIC_SET_VERSION,
  SMOKE_METRICS,
  SMOKE_REPEATS,
  SMOKE_REPORT_SCHEMA_VERSION,
  SMOKE_SCENARIO,
} from "./runs/smoke.js";
import type { SmokeEvidenceReport } from "./smoke-run.js";
import type { SourceIdentity } from "./source-identity.js";
import { type HarnessTargetIdentity, PRODUCTION_ORIGIN } from "./target.js";
import { errorMessage, isRecord } from "./value-utils.js";

export const BRANDED_PARITY_SCENARIO = "branded-parity@1";
export const BRANDED_PARITY_SCHEMA_VERSION = 2;
export const BRANDED_PARITY_COMMAND =
  "pnpm harness:branded-parity -- --target https://parallax-web.com";
export const BRANDED_PARITY_RESULT_DIRECTORY = "branded-parity";

export interface BrandedParityPreRunIdentity {
  readonly artifactDigest: string;
  readonly releaseDigest: string;
  readonly source: SourceIdentity;
  readonly target: HarnessTargetIdentity;
}

export interface BrandedParityReport {
  readonly authority: {
    readonly baselineComparison: "ineligible";
    readonly baselinePromotionAllowed: false;
    readonly budgetAuthority: false;
    readonly pinnedSmoke: false;
    readonly reason: string;
  };
  readonly brandedBrowser: InstalledBrandedChromeIdentity | null;
  readonly observedBrowserVersion: BrowserVersionIdentity | null;
  readonly command: typeof BRANDED_PARITY_COMMAND;
  readonly comparisonReference: ChromePin | null;
  readonly completedAt: string | null;
  readonly failure: string | null;
  readonly passed: boolean;
  readonly postValidation: FinalizationEvidence;
  readonly reportPersistence: FinalizationEvidence;
  readonly scenario: typeof BRANDED_PARITY_SCENARIO;
  readonly schemaVersion: typeof BRANDED_PARITY_SCHEMA_VERSION;
  readonly smoke: SmokeEvidenceReport | null;
  readonly startedAt: string;
  readonly state: "failed" | "passed" | "pending";
  readonly expectedIdentity: BrandedParityPreRunIdentity | null;
}

export interface BrandedParityReservation {
  readonly directory: string;
  readonly jsonPath: string;
  readonly markdownPath: string;
  readonly persistenceDependencies: ReportPersistenceDependencies;
  readonly stem: string;
}

export interface BrandedParityReservationDependencies {
  readonly makeDirectory: (path: string) => Promise<void>;
  readonly writeJsonExclusive: (path: string, contents: string) => Promise<void>;
}

const defaultReservationDependencies: BrandedParityReservationDependencies = Object.freeze({
  makeDirectory: (path: string) => mkdir(path),
  writeJsonExclusive: (path: string, contents: string) => writeFile(path, contents, { flag: "wx" }),
});

export function pendingBrandedParityReport(
  startedAt: string,
  input: Partial<
    Pick<
      BrandedParityReport,
      "brandedBrowser" | "comparisonReference" | "expectedIdentity" | "observedBrowserVersion"
    >
  > = {},
): BrandedParityReport {
  return Object.freeze({
    authority: parityAuthority(),
    brandedBrowser: input.brandedBrowser ?? null,
    observedBrowserVersion: input.observedBrowserVersion ?? null,
    command: BRANDED_PARITY_COMMAND,
    comparisonReference: input.comparisonReference ?? null,
    completedAt: null,
    expectedIdentity: input.expectedIdentity ?? null,
    failure: null,
    passed: false,
    postValidation: invalidFinalizationEvidence(
      "Branded parity has not completed exact postvalidation",
    ),
    reportPersistence: invalidFinalizationEvidence(
      "Human-readable report persistence has not completed",
    ),
    scenario: BRANDED_PARITY_SCENARIO,
    schemaVersion: BRANDED_PARITY_SCHEMA_VERSION,
    smoke: null,
    startedAt,
    state: "pending",
  });
}

export async function reserveBrandedParityResult(
  resultRoot: string,
  startedAt: string,
  pending: BrandedParityReport,
  dependencies: BrandedParityReservationDependencies = defaultReservationDependencies,
): Promise<BrandedParityReservation> {
  await mkdir(resultRoot, { recursive: true });
  const timestamp = startedAt.replaceAll(/[:.]/gu, "-");
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const stem = `branded-parity-v${BRANDED_PARITY_SCHEMA_VERSION}-${timestamp}${suffix === 0 ? "" : `-${suffix}`}`;
    const directory = join(resultRoot, stem);
    try {
      await dependencies.makeDirectory(directory);
    } catch (error) {
      if (isAlreadyExists(error)) continue;
      throw error;
    }
    const jsonPath = join(directory, "result.json");
    const markdownPath = join(directory, "result.md");
    await dependencies.writeJsonExclusive(jsonPath, serializeBrandedParityReport(pending));
    return Object.freeze({
      directory,
      jsonPath,
      markdownPath,
      persistenceDependencies: Object.freeze({
        publishMarkdown: (pendingPath: string, finalPath: string) => rename(pendingPath, finalPath),
        removePendingMarkdown: (path: string) => rm(path, { force: true }),
        writeJson: (path: string, contents: string) => writeFile(path, contents),
        writePendingMarkdown: (path: string, contents: string) =>
          writeFile(path, contents, { flag: "wx" }),
      }),
      stem,
    });
  }
  throw new Error("Branded parity result reservation exhausted 100 collision-safe stems");
}

export function assembleBrandedParityReport(input: {
  readonly brandedBrowser: InstalledBrandedChromeIdentity;
  readonly comparisonReference: ChromePin;
  readonly expectedIdentity: BrandedParityPreRunIdentity;
  readonly observedBrowserVersion: BrowserVersionIdentity;
  readonly reportPersistence: FinalizationEvidence;
  readonly smoke: SmokeEvidenceReport;
  readonly startedAt: string;
}): BrandedParityReport {
  if (
    input.reportPersistence.state === "invalid" &&
    input.reportPersistence.reason === "Human-readable report persistence has not completed"
  ) {
    return Object.freeze({
      ...pendingBrandedParityReport(input.startedAt, input),
      brandedBrowser: input.brandedBrowser,
      comparisonReference: input.comparisonReference,
      expectedIdentity: input.expectedIdentity,
      smoke: sanitizeBrandedParityEvidence(input.smoke),
    });
  }
  const failures = validateParityEvidence(input);
  if (input.reportPersistence.state === "invalid") {
    failures.push(input.reportPersistence.reason ?? "Report persistence is invalid");
  }
  const failure = boundedFailureSummary(failures);
  const postValidation =
    failure === null ? measuredFinalizationEvidence() : invalidFinalizationEvidence(failure);
  const passed = failure === null;
  return Object.freeze({
    authority: parityAuthority(),
    brandedBrowser: input.brandedBrowser,
    command: BRANDED_PARITY_COMMAND,
    comparisonReference: input.comparisonReference,
    completedAt: new Date().toISOString(),
    expectedIdentity: input.expectedIdentity,
    observedBrowserVersion: input.observedBrowserVersion,
    failure,
    passed,
    postValidation,
    reportPersistence: sanitizeFinalizationEvidence(input.reportPersistence),
    scenario: BRANDED_PARITY_SCENARIO,
    schemaVersion: BRANDED_PARITY_SCHEMA_VERSION,
    smoke: sanitizeBrandedParityEvidence(input.smoke),
    startedAt: input.startedAt,
    state: passed ? "passed" : "failed",
  });
}

export function failedBrandedParityReport(input: {
  readonly brandedBrowser?: InstalledBrandedChromeIdentity | null;
  readonly comparisonReference?: ChromePin | null;
  readonly error: unknown;
  readonly expectedIdentity?: BrandedParityPreRunIdentity | null;
  readonly observedBrowserVersion?: BrowserVersionIdentity | null;
  readonly reportPersistence: FinalizationEvidence;
  readonly smoke?: SmokeEvidenceReport | null;
  readonly startedAt: string;
}): BrandedParityReport {
  const reason = sanitizeBrandedParityFailure(errorMessage(input.error));
  return Object.freeze({
    authority: parityAuthority(),
    brandedBrowser: input.brandedBrowser ?? null,
    command: BRANDED_PARITY_COMMAND,
    comparisonReference: input.comparisonReference ?? null,
    completedAt: new Date().toISOString(),
    expectedIdentity: input.expectedIdentity ?? null,
    failure: reason,
    passed: false,
    observedBrowserVersion: input.observedBrowserVersion ?? null,
    postValidation: invalidFinalizationEvidence(reason),
    reportPersistence: sanitizeFinalizationEvidence(input.reportPersistence),
    scenario: BRANDED_PARITY_SCENARIO,
    schemaVersion: BRANDED_PARITY_SCHEMA_VERSION,
    smoke:
      input.smoke === undefined || input.smoke === null
        ? null
        : sanitizeBrandedParityEvidence(input.smoke),
    startedAt: input.startedAt,
    state: "failed",
  });
}

export async function publishEarlyBrandedParityFailure(
  reservation: BrandedParityReservation,
  report: BrandedParityReport,
  dependencies: ReportPersistenceDependencies = reservation.persistenceDependencies,
): Promise<BrandedParityReport> {
  const persisted = await persistJsonPrimaryReport({
    dependencies,
    failedReport: (reason) =>
      failedBrandedParityReport({
        brandedBrowser: report.brandedBrowser,
        comparisonReference: report.comparisonReference,
        error: `${report.failure ?? "Branded parity failed"} | ${reason}`,
        expectedIdentity: report.expectedIdentity,
        observedBrowserVersion: report.observedBrowserVersion,
        reportPersistence: invalidFinalizationEvidence(reason),
        smoke: report.smoke,
        startedAt: report.startedAt,
      }),
    formatMarkdown: formatBrandedParityReport,
    jsonPath: reservation.jsonPath,
    markdownPath: reservation.markdownPath,
    pendingReport: pendingBrandedParityReport(report.startedAt, report),
    successfulReport: report,
  });
  return persisted.finalReport;
}

export function formatBrandedParityReport(report: BrandedParityReport): string {
  const facets = report.smoke?.facets;
  return [
    "# Branded Stable parity",
    "",
    `- Scenario: \`${report.scenario}\``,
    `- State: \`${report.state}\``,
    `- Passed: \`${report.passed}\``,
    `- Budget authority: \`${report.authority.budgetAuthority}\``,
    `- Baseline comparison: \`${report.authority.baselineComparison}\``,
    `- CfT comparison reference: \`${report.comparisonReference?.version ?? "pending"}\``,
    `- Branded executable version: \`${report.brandedBrowser?.fileVersion ?? "pending"}\``,
    `- Observed CDP product: \`${report.observedBrowserVersion?.product ?? "pending"}\``,
    `- Observed CDP user agent: \`${report.observedBrowserVersion?.userAgent ?? "pending"}\``,
    `- Environment facet: \`${facets?.environment.status ?? "pending"}\``,
    `- Evidence facet: \`${facets?.evidenceCompleteness.status ?? "pending"}\``,
    `- Budget facet: \`${facets?.budgetEvaluation.status ?? "pending"}\``,
    `- Failure: \`${Buffer.from(JSON.stringify(report.failure)).toString("base64url")}\``,
    "",
  ].join("\n");
}

function validateParityEvidence(input: {
  readonly brandedBrowser: InstalledBrandedChromeIdentity;
  readonly comparisonReference: ChromePin;
  readonly expectedIdentity: BrandedParityPreRunIdentity;
  readonly observedBrowserVersion: BrowserVersionIdentity;
  readonly smoke: SmokeEvidenceReport;
}): string[] {
  const failures: string[] = [];
  const smoke = input.smoke;
  let observedBrowserVersion: BrowserVersionIdentity | null = null;
  try {
    requireBrandedChromeComparable(input.brandedBrowser.fileVersion, input.comparisonReference);
  } catch (error) {
    failures.push(errorMessage(error));
  }
  try {
    observedBrowserVersion = validateObservedBrowserVersionIdentity(input.observedBrowserVersion);
    validateBrandedBrowserVersion(
      observedBrowserVersion,
      input.brandedBrowser,
      input.comparisonReference,
    );
  } catch (error) {
    failures.push(errorMessage(error));
  }
  if (smoke.scenario !== SMOKE_SCENARIO || smoke.schemaVersion !== SMOKE_REPORT_SCHEMA_VERSION) {
    failures.push("Parity must reuse the exact current smoke scenario/schema evidence");
  }
  if (JSON.stringify(smoke.chromePin) !== JSON.stringify(input.comparisonReference)) {
    failures.push("Smoke Chrome pin differs from the exact branded-parity comparison reference");
  }
  const mandatoryNames = SMOKE_METRICS.filter((metric) => metric.mandatoryForHarnessV1).map(
    (metric) => metric.name,
  );
  if (
    smoke.mandatoryMetricSet.version !== SMOKE_MANDATORY_METRIC_SET_VERSION ||
    JSON.stringify(smoke.mandatoryMetricSet.metrics) !== JSON.stringify(mandatoryNames)
  ) {
    failures.push("Parity mandatory metric set differs from the current smoke contract");
  }
  const expectedTarget = input.expectedIdentity.target;
  const preflightTarget =
    smoke.environment.targetPreflight.state === "verified"
      ? smoke.environment.targetPreflight.identity
      : null;
  const postflightTarget =
    smoke.environment.targetPostflight.state === "verified"
      ? smoke.environment.targetPostflight.identity
      : null;
  if (
    expectedTarget.kind !== "production" ||
    expectedTarget.origin !== PRODUCTION_ORIGIN ||
    expectedTarget.artifactDigest !== input.expectedIdentity.artifactDigest ||
    expectedTarget.releaseDigest !== input.expectedIdentity.releaseDigest ||
    JSON.stringify(smoke.environment.target) !== JSON.stringify(expectedTarget) ||
    JSON.stringify(preflightTarget) !== JSON.stringify(expectedTarget) ||
    JSON.stringify(postflightTarget) !== JSON.stringify(expectedTarget)
  ) {
    failures.push(
      "Parity target, preflight, postflight, and reserved production artifact/release/origin/serving contract differ",
    );
  }
  if (!resultFacetsPassed(smoke.facets) || !smoke.passed) {
    failures.push("Parity requires all current smoke facets to pass");
  }
  if (smoke.runs.length !== SMOKE_REPEATS * 2) {
    failures.push(`Parity requires all ${SMOKE_REPEATS * 2} smoke launches`);
  }
  for (const [index, run] of smoke.runs.entries()) {
    const rendered = run.greyboxWorld.value.renderedOutput;
    if (
      !isRecord(rendered) ||
      typeof rendered.pngSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(rendered.pngSha256) ||
      typeof rendered.visiblePixelRatio !== "number"
    ) {
      failures.push(`Smoke launch ${index + 1} lacks exact rendered-output evidence`);
    }
  }
  if (
    smoke.artifactDigest !== input.expectedIdentity.artifactDigest ||
    smoke.releaseDigest !== input.expectedIdentity.releaseDigest ||
    JSON.stringify(smoke.source) !== JSON.stringify(input.expectedIdentity.source)
  ) {
    failures.push(
      "Smoke source/build artifact/release identity differs from reserved pre-run identity",
    );
  }
  if (smoke.postRunIdentity.state !== "measured") failures.push("Smoke post-run identity failed");
  validateEnvironment(smoke.environment, input.brandedBrowser, observedBrowserVersion, failures);
  return failures;
}

function validateEnvironment(
  environment: RegisteredEnvironmentIdentity,
  branded: InstalledBrandedChromeIdentity,
  observed: BrowserVersionIdentity | null,
  failures: string[],
): void {
  if (
    environment.machineId !== "dev-01" ||
    environment.requestedTier !== "showcase" ||
    environment.gateIdentity.state !== "measured"
  ) {
    failures.push("Parity requires registered physical dev-01/Showcase gate identity");
  }
  if (environment.host?.remoteSession !== false) failures.push("Parity forbids remote sessions");
  if (!environment.sandboxVerified) failures.push("Parity requires the Chrome process sandbox");
  if (
    environment.executablePath !== branded.executablePath ||
    environment.executableSha256 !== branded.executableSha256
  ) {
    failures.push(
      "Parity browser executable path/hash differs from the registered branded install",
    );
  }
  if (
    environment.browserProduct !== `Chrome/${branded.fileVersion}` ||
    environment.browserChannel !== "chrome" ||
    environment.browserProtocolVersion === undefined ||
    environment.browserRevision === "" ||
    environment.browserUserAgent === "" ||
    environment.jsVersion === ""
  ) {
    failures.push(
      "Parity Browser.getVersion evidence is incomplete or differs from branded Chrome",
    );
  }
  if (
    observed !== null &&
    (environment.browserProduct !== observed.product ||
      environment.browserProtocolVersion !== observed.protocolVersion ||
      environment.browserRevision !== observed.revision ||
      environment.browserUserAgent !== observed.userAgent ||
      environment.jsVersion !== observed.jsVersion)
  ) {
    failures.push(
      "Parity environment Browser.getVersion evidence differs from retained raw identity",
    );
  }
  if (
    environment.target.kind !== "production" ||
    environment.target.origin !== PRODUCTION_ORIGIN ||
    environment.targetPreflight.state !== "verified" ||
    environment.targetPostflight.state !== "verified" ||
    JSON.stringify(environment.targetPreflight.identity) !==
      JSON.stringify(environment.targetPostflight.identity)
  ) {
    failures.push("Parity requires exact production target pre/post identity");
  }
}

export function sanitizeBrandedParityFailure(input: string): string {
  const withoutCredentials = input
    .slice(0, 4_096)
    .normalize("NFKC")
    .replaceAll(/[\p{Cc}\p{Cf}]/gu, " ")
    .replaceAll(
      /\b(?:authorization\s*[:=]\s*)?(?:bearer|basic|digest)\s+[^\s,;]+/giu,
      "credential=<redacted>",
    )
    .replaceAll(
      /\b(credential|access(?:[_-]?token)|refresh(?:[_-]?token)|client(?:[_-]?secret)|set-cookie|cookie|session(?:[_-]?id)?|api(?:[_-]?key)|password|passwd|secret|token|auth|authorization)\b(?:\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;|]+)|\s+(?:"[^"\r\n]*"|'[^'\r\n]*'))/giu,
      "$1=<redacted>",
    )
    .replaceAll(/(?:https?|file):\/\/[^\s'"`<>]+/giu, "<url>")
    .replaceAll(/(["'])(?:[A-Za-z]:\\|\\\\|\/)[^"']+\1/gu, "<path>")
    .replaceAll(/\\\\[^\s'"`<>]+/gu, "<path>")
    .replaceAll(/\b[A-Za-z]:\\[^\s'"`<>]*/gu, "<path>")
    .replaceAll(/(^|\s)\/(?:[^\s'"`<>]*)/gu, "$1<path>")
    .replaceAll(/\s+/gu, " ")
    .trim();
  return (withoutCredentials === "" ? "redacted-failure" : withoutCredentials).slice(0, 512);
}

export function sanitizeBrandedParityEvidence<T>(value: T): T {
  return sanitizeEvidenceValue(value, null) as T;
}

function sanitizeEvidenceValue(value: unknown, key: string | null): unknown {
  if (typeof value === "string") {
    return isFailureKey(key) ? sanitizeBrandedParityFailure(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      typeof entry === "string" && isFailureArrayKey(key)
        ? sanitizeBrandedParityFailure(entry)
        : sanitizeEvidenceValue(entry, key),
    );
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeEvidenceValue(entryValue, entryKey),
    ]),
  );
}

function isFailureKey(key: string | null): boolean {
  return (
    key === "failure" || key === "finalizationFailure" || key === "message" || key === "reason"
  );
}

function isFailureArrayKey(key: string | null): boolean {
  return key === "failures" || key === "informationalFailures" || key === "reasons";
}

function boundedFailureSummary(failures: readonly string[]): string | null {
  if (failures.length === 0) return null;
  return failures.slice(0, 16).map(sanitizeBrandedParityFailure).join(" | ").slice(0, 2_048);
}

function sanitizeFinalizationEvidence(evidence: FinalizationEvidence): FinalizationEvidence {
  return evidence.state === "measured"
    ? evidence
    : invalidFinalizationEvidence(
        sanitizeBrandedParityFailure(evidence.reason ?? "Invalid finalization evidence"),
      );
}

function parityAuthority(): BrandedParityReport["authority"] {
  return Object.freeze({
    baselineComparison: "ineligible",
    baselinePromotionAllowed: false,
    budgetAuthority: false,
    pinnedSmoke: false,
    reason:
      "Installed branded-Stable parity is comparison evidence only; it never loads/promotes a baseline or carries pinned-CfT budget authority",
  });
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function serializeBrandedParityReport(report: BrandedParityReport): string {
  return serialize(sanitizeBrandedParityEvidence(report));
}
