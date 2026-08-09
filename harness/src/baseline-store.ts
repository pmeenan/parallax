import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { PsoWarmupTelemetrySnapshot } from "@parallax/engine";
import { evaluateBoundedRepeatability } from "./aggregate.js";
import {
  type BudgetCheck,
  type QualityTier,
  SIMULATION_GAMEPLAY_STEP_BUDGET_MS,
} from "./budgets.js";
import {
  type GreyboxWorldEvidence,
  requireGreyboxWorldTelemetry,
} from "./greybox-world-evidence.js";
import { validateExactPsoWarmupTelemetrySnapshot } from "./pso-warmup-telemetry.js";
import {
  SMOKE_BUDGET_METRIC_NAMES,
  SMOKE_BUDGET_METRICS,
  SMOKE_HYBRID_UI_TELEMETRY_SCHEMA_VERSION,
  SMOKE_MANDATORY_METRIC_SET_VERSION,
  SMOKE_METRICS,
  SMOKE_REPEATS,
  SMOKE_REPORT_SCHEMA_VERSION,
  SMOKE_SCENARIO,
  SMOKE_SIMULATION_GAMEPLAY_WORKLOAD,
  SMOKE_STREAMING_P95_ABSOLUTE_RANGE_FLOOR_MS,
  SMOKE_STREAMING_P95_RELATIVE_RANGE_LIMIT,
} from "./runs/smoke.js";
import { requireStreamingEvidence, type StreamingEvidence } from "./streaming-evidence.js";
import {
  type HarnessTargetIdentity,
  type HarnessTargetVerificationEvidence,
  validateHarnessTargetEvidence,
  validateHarnessTargetIdentity,
} from "./target.js";

export const BASELINE_STORE_SCHEMA_VERSION = 1;

interface BaselineSourceIdentity {
  readonly commit: string;
  readonly dirtyTreeDigest: string | null;
}

interface SimulationGameplayEvidence {
  readonly adapterInitializationHighWaterMs: number;
  readonly movementDistanceMeters: number;
  readonly navigationEdgeCount: number;
  readonly navigationExpandedNodeCount: number;
  readonly navigationGridBytes: number;
  readonly navigationNodeCount: number;
  readonly navigationPathNodeCount: number;
  readonly navigationPathQueryCount: number;
  readonly navigationTileCount: number;
  readonly npcAgentCount: number;
  readonly npcAvoidanceAdjustmentCount: number;
  readonly npcMovementDistanceMeters: number;
  readonly npcMovingAgentCount: number;
  readonly npcScheduleTransitionCount: number;
  readonly stepDurationHighWaterMs: number;
}

interface BaselineReportRun {
  readonly budgetChecks: readonly BudgetCheck[];
  readonly greyboxWorld: Readonly<{
    readonly state: "measured";
    readonly value: GreyboxWorldEvidence;
  }>;
  readonly hybridUi: Readonly<{ readonly state: "measured"; readonly value: unknown }>;
  readonly profile: "fresh" | "warm";
  readonly psoWarmup:
    | Readonly<{ readonly state: "measured"; readonly value: PsoWarmupTelemetrySnapshot }>
    | Readonly<{ readonly reason: string; readonly state: "invalid" | "unsupported" }>;
  readonly repeat: number;
  readonly simulationController: Readonly<{
    readonly state: "measured";
    readonly value: SimulationGameplayEvidence;
  }>;
  readonly streaming: Readonly<{
    readonly state: "measured";
    readonly value: StreamingEvidence;
  }>;
}

export interface BaselineEligibleReport {
  readonly artifactDigest: string;
  readonly baseline: BaselineEvaluation;
  readonly build: {
    readonly engineAndRenderWorkerBytes: number;
    readonly totalBuildBytes: number;
  };
  readonly chromePin: {
    readonly channel: "stable";
    readonly downloads: Readonly<Record<string, string>>;
    readonly executableSha256: Readonly<Record<string, string>>;
    readonly revision: string;
    readonly version: string;
  };
  readonly callbackPacingVariance: readonly unknown[];
  readonly coreRunFailure: unknown;
  readonly environment: {
    readonly adapter: unknown;
    readonly browserCommandLine: string;
    readonly browserDisplay: unknown;
    readonly browserProduct: string;
    readonly browserRevision: string;
    readonly browserUserAgent: string;
    readonly executableSha256: string;
    readonly gateIdentity: unknown;
    readonly gpuDevices: readonly unknown[];
    readonly host: unknown;
    readonly hostAfterRuns: unknown;
    readonly jsVersion: string;
    readonly machine: unknown;
    readonly machineId: string;
    readonly requestedTier: QualityTier;
    readonly sandboxVerified: true;
    readonly target: HarnessTargetIdentity;
    readonly targetPostflight: HarnessTargetVerificationEvidence;
    readonly targetPreflight: HarnessTargetVerificationEvidence;
    readonly targetDisplayMode: string;
  };
  readonly facets: {
    readonly budgetEvaluation: {
      readonly evaluatedChecks: number;
      readonly reasons: readonly string[];
      readonly status: string;
    };
    readonly environment: { readonly reasons: readonly string[]; readonly status: string };
    readonly evidenceCompleteness: {
      readonly reasons: readonly string[];
      readonly status: string;
    };
  };
  readonly finalizationFailure: string | null;
  readonly generatedAt: string;
  readonly harnessRuntime: HarnessRuntimeIdentity;
  readonly incompleteMetrics: readonly unknown[];
  readonly informationalFailures: readonly string[];
  readonly mandatoryMetricSet: {
    readonly metrics: readonly string[];
    readonly version: number;
  };
  readonly passed: boolean;
  readonly postRunIdentity: Readonly<{ readonly reason?: string; readonly state: string }>;
  readonly reportPersistence: Readonly<{ readonly reason?: string; readonly state: string }>;
  readonly releaseDigest: string;
  readonly runs: readonly BaselineReportRun[];
  readonly scenario: string;
  readonly schemaVersion: number;
  readonly source: BaselineSourceIdentity;
  readonly streamingCellLoadP95Variance: readonly {
    readonly absoluteP95RangeMs: number | null;
    readonly allowedAbsoluteP95RangeMs: number | null;
    readonly profile: "fresh" | "warm";
    readonly reason?: string;
    readonly relativeP95Range: number | null;
    readonly state: "invalid" | "measured";
  }[];
  readonly v8CodeCacheDiagnosticsRequested: boolean;
  readonly v8CodeCacheDiagnostics: readonly unknown[];
  readonly vizPresentationFeedbackCallbackVariance: readonly unknown[];
}

export interface BaselineMetricSummary {
  readonly key: string;
  readonly value: number;
}

export interface BaselineRecord {
  readonly artifactDigest: string;
  readonly browser: {
    readonly executableSha256: string;
    readonly revision: string;
    readonly version: string;
  };
  readonly mandatoryMetricSetVersion: number;
  readonly metrics: readonly BaselineMetricSummary[];
  readonly comparisonEnvironment: BaselineComparisonEnvironment;
  readonly promotedAt: string;
  readonly promotedBy: string;
  readonly promotionReason: string;
  readonly reportDigest: string;
  readonly reportFile: string;
  readonly reportGeneratedAt: string;
  readonly reportSchemaVersion: number;
  readonly source: BaselineSourceIdentity;
}

export interface BaselineStore {
  readonly entries: Readonly<Record<string, BaselineRecord>>;
  readonly schemaVersion: typeof BASELINE_STORE_SCHEMA_VERSION;
}

export interface BaselineMetricComparison {
  readonly absoluteDelta: number;
  readonly baseline: number;
  readonly candidate: number;
  readonly key: string;
  readonly relativeDelta: number | null;
}

export type BaselineEvaluation =
  | Readonly<{ readonly reason: string; readonly state: "untracked" }>
  | Readonly<{
      readonly baseline: BaselineRecord;
      readonly reason: string;
      readonly state: "ineligible";
    }>
  | Readonly<{
      readonly baseline: BaselineRecord;
      readonly metrics: readonly BaselineMetricComparison[];
      readonly state: "current" | "candidate";
    }>;

export interface BaselineComparisonEnvironment {
  readonly adapter: unknown;
  readonly hostAfterRuns: unknown;
  readonly machine: unknown;
  readonly machineId: string;
  readonly requestedTier: QualityTier;
  readonly target?: BaselineTargetComparisonIdentity;
  readonly targetDisplayMode: string;
  readonly harnessRuntime: HarnessRuntimeIdentity;
}

export interface BaselineTargetComparisonIdentity {
  readonly kind: "local" | "production";
  readonly origin: "http://127.0.0.1" | "https://parallax-web.com";
}

export interface HarnessRuntimeIdentity {
  readonly nodeExecutableSha256: string;
  readonly nodeVersion: string;
}

export function baselineStorePath(repositoryRoot: string): string {
  return join(repositoryRoot, "harness/results/baseline-store-v1.json");
}

export async function loadBaselineStore(path: string): Promise<BaselineStore> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return emptyBaselineStore();
    throw error;
  }
  const parsed: unknown = JSON.parse(source);
  if (!isRecord(parsed) || parsed.schemaVersion !== BASELINE_STORE_SCHEMA_VERSION) {
    throw new Error(`Unsupported or invalid baseline store at ${path}`);
  }
  if (!isRecord(parsed.entries)) throw new Error(`Baseline store entries are invalid at ${path}`);
  return parsed as unknown as BaselineStore;
}

export function evaluateBaseline(
  report: Omit<BaselineEligibleReport, "baseline">,
  store: BaselineStore,
): BaselineEvaluation {
  const anchor = baselineAnchor(report, store);
  if (anchor === null) {
    return Object.freeze({
      reason: "No promoted baseline exists for this scenario, machine, and quality tier",
      state: "untracked" as const,
    });
  }
  const candidateMetrics = summarizeBaselineMetrics(report);
  const baseline = requireBaselineRecord(anchor.record);
  if (anchor.legacy) {
    return Object.freeze({
      baseline,
      reason:
        "Pre-D-121 local baseline predecessor has no serving-target identity and is intentionally incomparable; pass --rebaseline only for an intentional reviewed migration",
      state: "ineligible" as const,
    });
  }
  if (baseline.mandatoryMetricSetVersion !== report.mandatoryMetricSet.version) {
    return Object.freeze({
      baseline,
      reason: `Promoted metric-set v${baseline.mandatoryMetricSetVersion} is not comparable with candidate metric-set v${report.mandatoryMetricSet.version}`,
      state: "ineligible" as const,
    });
  }
  requireMatchingMetricKeys(baseline.metrics, candidateMetrics);
  if (baseline.artifactDigest !== report.artifactDigest) {
    return Object.freeze({
      baseline,
      reason: `Promoted artifact ${baseline.artifactDigest} is not comparable with candidate artifact ${report.artifactDigest}`,
      state: "ineligible" as const,
    });
  }
  const candidateEnvironment = comparisonEnvironment(report);
  if (
    canonicalJsonStringify(baseline.comparisonEnvironment) !==
    canonicalJsonStringify(candidateEnvironment)
  ) {
    return Object.freeze({
      baseline,
      reason:
        "Registered machine, host, adapter, display, or Node collector identity differs from the promoted baseline",
      state: "ineligible" as const,
    });
  }
  const metrics = compareMetricSummaries(baseline.metrics, candidateMetrics);
  const sameBrowser =
    baseline.browser.version === report.chromePin.version &&
    baseline.browser.revision === report.chromePin.revision &&
    baseline.browser.executableSha256 === report.environment.executableSha256;
  return Object.freeze({
    baseline,
    metrics,
    state: sameBrowser ? ("current" as const) : ("candidate" as const),
  });
}

export function evaluateBaselineSafely(
  report: Omit<BaselineEligibleReport, "baseline">,
  store: BaselineStore,
): BaselineEvaluation {
  try {
    return evaluateBaseline(report, store);
  } catch (error) {
    return Object.freeze({
      reason: `Baseline comparison unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
      state: "untracked" as const,
    });
  }
}

export async function promoteBaseline(options: {
  readonly actor: string;
  readonly allowIneligible?: boolean;
  readonly reason: string;
  readonly reportBytes: Uint8Array;
  readonly reportPath: string;
  readonly storePath: string;
  readonly promotedAt?: string;
}): Promise<BaselineRecord> {
  const report = parseBaselineEligibleReport(
    JSON.parse(Buffer.from(options.reportBytes).toString("utf8")) as unknown,
  );
  assertPromotionEligible(report);
  const actor = requiredText(options.actor, "promotion actor");
  const reason = requiredText(options.reason, "promotion reason");
  const record = Object.freeze({
    artifactDigest: report.artifactDigest,
    browser: Object.freeze({
      executableSha256: report.environment.executableSha256,
      revision: report.chromePin.revision,
      version: report.chromePin.version,
    }),
    mandatoryMetricSetVersion: report.mandatoryMetricSet.version,
    metrics: summarizeBaselineMetrics(report),
    comparisonEnvironment: comparisonEnvironment(report),
    promotedAt: options.promotedAt ?? new Date().toISOString(),
    promotedBy: actor,
    promotionReason: reason,
    reportDigest: createHash("sha256").update(options.reportBytes).digest("hex"),
    reportFile: basename(options.reportPath),
    reportGeneratedAt: report.generatedAt,
    reportSchemaVersion: report.schemaVersion,
    source: Object.freeze({ ...report.source }),
  });
  await withBaselineStoreLock(options.storePath, async () => {
    const store = await loadBaselineStore(options.storePath);
    assertPromotionTransition(report, store, options.allowIneligible ?? false);
    const updated: BaselineStore = Object.freeze({
      entries: Object.freeze({ ...store.entries, [baselineKey(report)]: record }),
      schemaVersion: BASELINE_STORE_SCHEMA_VERSION,
    });
    await writeBaselineStore(options.storePath, updated);
  });
  return record;
}

export function parseBaselineEligibleReport(value: unknown): BaselineEligibleReport {
  if (!isRecord(value)) throw new Error("Baseline report must be a JSON object");
  requireSha256(value.artifactDigest, "artifactDigest");
  requireSha256(value.releaseDigest, "releaseDigest");
  requireExactKeys(
    value,
    [
      "artifactDigest",
      "baseline",
      "build",
      "callbackPacingVariance",
      "chromePin",
      "coreRunFailure",
      "environment",
      "facets",
      "finalizationFailure",
      "generatedAt",
      "harnessRuntime",
      "incompleteMetrics",
      "informationalFailures",
      "mandatoryMetricSet",
      "passed",
      "postRunIdentity",
      "releaseDigest",
      "reportPersistence",
      "runs",
      "scenario",
      "schemaVersion",
      "source",
      "streamingCellLoadP95Variance",
      "v8CodeCacheDiagnostics",
      "v8CodeCacheDiagnosticsRequested",
      "vizPresentationFeedbackCallbackVariance",
    ],
    "smoke report",
  );
  requireRecord(value.baseline, "baseline");
  if (
    value.baseline.state !== "untracked" &&
    value.baseline.state !== "current" &&
    value.baseline.state !== "candidate" &&
    value.baseline.state !== "ineligible"
  ) {
    invalidReport("baseline.state must be untracked, current, candidate, or ineligible");
  }
  if (value.baseline.state !== "untracked") {
    requireRecord(value.baseline.baseline, "baseline.baseline");
    requireSha256(value.baseline.baseline.reportDigest, "baseline.baseline.reportDigest");
  }
  requireRecord(value.build, "build");
  requireFiniteNonnegative(
    value.build.engineAndRenderWorkerBytes,
    "build.engineAndRenderWorkerBytes",
  );
  requireFiniteNonnegative(value.build.totalBuildBytes, "build.totalBuildBytes");
  requireRecord(value.chromePin, "chromePin");
  if (value.chromePin.channel !== "stable") invalidReport("chromePin.channel must be stable");
  requireRecord(value.chromePin.downloads, "chromePin.downloads");
  requireRecord(value.chromePin.executableSha256, "chromePin.executableSha256");
  requireText(value.chromePin.revision, "chromePin.revision");
  requireText(value.chromePin.version, "chromePin.version");
  if (value.coreRunFailure !== null) invalidReport("coreRunFailure must be null");
  if (!Array.isArray(value.callbackPacingVariance)) {
    invalidReport("callbackPacingVariance must be an array");
  }
  requireRecord(value.environment, "environment");
  requireExactKeys(
    value.environment,
    [
      "adapter",
      "browserCommandLine",
      "browserDisplay",
      "browserProduct",
      "browserRevision",
      "browserUserAgent",
      "executableSha256",
      "gateIdentity",
      "gpuDevices",
      "host",
      "hostAfterRuns",
      "jsVersion",
      "machine",
      "machineId",
      "requestedTier",
      "sandboxVerified",
      "target",
      "targetDisplayMode",
      "targetPostflight",
      "targetPreflight",
    ],
    "environment",
  );
  requireRecord(value.environment.adapter, "environment.adapter");
  requireRecord(value.environment.browserDisplay, "environment.browserDisplay");
  requireText(value.environment.browserCommandLine, "environment.browserCommandLine");
  if (value.environment.browserProduct !== `Chrome/${value.chromePin.version}`) {
    invalidReport("environment.browserProduct must match chromePin.version");
  }
  requireText(value.environment.browserRevision, "environment.browserRevision");
  requireText(value.environment.browserUserAgent, "environment.browserUserAgent");
  requireSha256(value.environment.executableSha256, "environment.executableSha256");
  if (
    !Object.values(value.chromePin.executableSha256).includes(value.environment.executableSha256)
  ) {
    invalidReport("environment.executableSha256 must match the pinned Chrome executable");
  }
  requireRecord(value.environment.gateIdentity, "environment.gateIdentity");
  if (
    value.environment.gateIdentity.state !== "measured" ||
    value.environment.gateIdentity.value !== true
  ) {
    invalidReport("environment.gateIdentity must prove a registered physical environment");
  }
  if (!Array.isArray(value.environment.gpuDevices) || value.environment.gpuDevices.length === 0) {
    invalidReport("environment.gpuDevices must contain physical GPU identity");
  }
  requireRecord(value.environment.host, "environment.host");
  requireRecord(value.environment.hostAfterRuns, "environment.hostAfterRuns");
  requireRecord(value.environment.machine, "environment.machine");
  requireText(value.environment.machineId, "environment.machineId");
  if (value.environment.machine.id !== value.environment.machineId) {
    invalidReport("environment.machine must match machineId");
  }
  requireText(value.environment.jsVersion, "environment.jsVersion");
  if (value.environment.sandboxVerified !== true) {
    invalidReport("environment.sandboxVerified must be true");
  }
  if (
    value.environment.requestedTier !== "showcase" &&
    value.environment.requestedTier !== "standard"
  ) {
    invalidReport("environment.requestedTier must be showcase or standard");
  }
  requireText(value.environment.targetDisplayMode, "environment.targetDisplayMode");
  validateHarnessTargetIdentity(value.environment.target, "environment.target");
  if (value.environment.target.artifactDigest !== value.artifactDigest) {
    invalidReport("environment.target artifact digest must match artifactDigest");
  }
  if (value.environment.target.releaseDigest !== value.releaseDigest) {
    invalidReport("environment.target release digest must match releaseDigest");
  }
  validateHarnessTargetEvidence(value.environment.targetPreflight, "environment.targetPreflight");
  validateHarnessTargetEvidence(value.environment.targetPostflight, "environment.targetPostflight");
  if (
    value.environment.targetPreflight.state !== "verified" ||
    value.environment.targetPostflight.state !== "verified" ||
    JSON.stringify(value.environment.targetPreflight.identity) !==
      JSON.stringify(value.environment.target) ||
    JSON.stringify(value.environment.targetPostflight.identity) !==
      JSON.stringify(value.environment.target)
  ) {
    invalidReport("environment target preflight/postflight evidence is contradictory");
  }
  requireRecord(value.facets, "facets");
  const budgetFacet = value.facets.budgetEvaluation;
  const environmentFacet = value.facets.environment;
  const evidenceFacet = value.facets.evidenceCompleteness;
  requireRecord(budgetFacet, "facets.budgetEvaluation");
  requireRecord(environmentFacet, "facets.environment");
  requireRecord(evidenceFacet, "facets.evidenceCompleteness");
  requireText(budgetFacet.status, "facets.budgetEvaluation.status");
  requireText(environmentFacet.status, "facets.environment.status");
  requireText(evidenceFacet.status, "facets.evidenceCompleteness.status");
  if (environmentFacet.status !== "passed" && environmentFacet.status !== "failed") {
    invalidReport("facets.environment.status must be passed or failed");
  }
  if (evidenceFacet.status !== "passed" && evidenceFacet.status !== "failed") {
    invalidReport("facets.evidenceCompleteness.status must be passed or failed");
  }
  if (
    budgetFacet.status !== "passed" &&
    budgetFacet.status !== "failed" &&
    budgetFacet.status !== "not-evaluated"
  ) {
    invalidReport("facets.budgetEvaluation.status must be passed, failed, or not-evaluated");
  }
  const generatedAt = requireText(value.generatedAt, "generatedAt");
  if (!Number.isFinite(Date.parse(generatedAt)))
    invalidReport("generatedAt must be an ISO timestamp");
  requireRecord(value.mandatoryMetricSet, "mandatoryMetricSet");
  if (value.mandatoryMetricSet.version !== SMOKE_MANDATORY_METRIC_SET_VERSION) {
    invalidReport(`mandatoryMetricSet.version must be ${SMOKE_MANDATORY_METRIC_SET_VERSION}`);
  }
  const expectedMandatoryMetrics = SMOKE_METRICS.filter(
    (metric) => metric.mandatoryForHarnessV1,
  ).map((metric) => metric.name);
  if (
    !Array.isArray(value.mandatoryMetricSet.metrics) ||
    !value.mandatoryMetricSet.metrics.every((metric) => typeof metric === "string") ||
    JSON.stringify(value.mandatoryMetricSet.metrics) !== JSON.stringify(expectedMandatoryMetrics)
  ) {
    invalidReport(
      `mandatoryMetricSet.metrics must contain exactly ${expectedMandatoryMetrics.join(", ")}`,
    );
  }
  if (typeof value.passed !== "boolean") invalidReport("passed must be boolean");
  requireFinalizationEvidence(value.postRunIdentity, "postRunIdentity");
  requireFinalizationEvidence(value.reportPersistence, "reportPersistence");
  if (value.finalizationFailure !== null && typeof value.finalizationFailure !== "string") {
    invalidReport("finalizationFailure must be null or a string");
  }
  requireRecord(value.harnessRuntime, "harnessRuntime");
  requireSha256(value.harnessRuntime.nodeExecutableSha256, "harnessRuntime.nodeExecutableSha256");
  const nodeVersion = requireText(value.harnessRuntime.nodeVersion, "harnessRuntime.nodeVersion");
  if (!/^v\d+\.\d+\.\d+$/.test(nodeVersion)) {
    invalidReport("harnessRuntime.nodeVersion must be an exact Node version");
  }
  if (value.scenario !== SMOKE_SCENARIO) invalidReport(`scenario must be ${SMOKE_SCENARIO}`);
  if (
    typeof value.schemaVersion !== "number" ||
    !Number.isInteger(value.schemaVersion) ||
    value.schemaVersion !== SMOKE_REPORT_SCHEMA_VERSION
  ) {
    invalidReport(`schemaVersion must be ${SMOKE_REPORT_SCHEMA_VERSION}`);
  }
  if (typeof value.v8CodeCacheDiagnosticsRequested !== "boolean") {
    invalidReport("v8CodeCacheDiagnosticsRequested must be boolean");
  }
  if (
    !Array.isArray(value.incompleteMetrics) ||
    !Array.isArray(value.informationalFailures) ||
    !value.informationalFailures.every((failure) => typeof failure === "string") ||
    !Array.isArray(value.v8CodeCacheDiagnostics) ||
    !Array.isArray(value.vizPresentationFeedbackCallbackVariance)
  ) {
    invalidReport("smoke report diagnostic collections must be arrays");
  }
  const declaredStreamingVariance = requireP95VarianceSummaries(
    value.streamingCellLoadP95Variance,
    "streamingCellLoadP95Variance",
  );
  requireRecord(value.source, "source");
  requireGitCommit(value.source.commit, "source.commit");
  if (value.source.dirtyTreeDigest !== null) {
    requireSha256(value.source.dirtyTreeDigest, "source.dirtyTreeDigest");
  }
  if (!Array.isArray(value.runs) || value.runs.length === 0) {
    invalidReport("runs must contain at least one measured run");
  }
  const repeats = new Map<"fresh" | "warm", Set<number>>([
    ["fresh", new Set<number>()],
    ["warm", new Set<number>()],
  ]);
  const streamingP95ByProfile = new Map<"fresh" | "warm", number[]>([
    ["fresh", []],
    ["warm", []],
  ]);
  let evaluatedChecks = 0;
  for (const [runIndex, run] of value.runs.entries()) {
    requireRecord(run, `runs[${runIndex}]`);
    if (run.profile !== "fresh" && run.profile !== "warm") {
      invalidReport(`runs[${runIndex}].profile must be fresh or warm`);
    }
    if (
      typeof run.repeat !== "number" ||
      !Number.isInteger(run.repeat) ||
      run.repeat < 1 ||
      run.repeat > SMOKE_REPEATS
    ) {
      invalidReport(`runs[${runIndex}].repeat must be from 1 through ${SMOKE_REPEATS}`);
    }
    const profileRepeats = repeats.get(run.profile);
    if (profileRepeats?.has(run.repeat)) {
      invalidReport(`runs contains duplicate ${run.profile} repeat ${run.repeat}`);
    }
    profileRepeats?.add(run.repeat);
    if (!Array.isArray(run.budgetChecks) || run.budgetChecks.length === 0) {
      invalidReport(`runs[${runIndex}].budgetChecks must contain measured observations`);
    }
    requireRecord(run.greyboxWorld, `runs[${runIndex}].greyboxWorld`);
    if (run.greyboxWorld.state !== "measured") {
      invalidReport(`runs[${runIndex}].greyboxWorld.state must be measured`);
    }
    requireRecord(run.psoWarmup, `runs[${runIndex}].psoWarmup`);
    if (run.psoWarmup.state !== "measured") {
      invalidReport(`runs[${runIndex}].psoWarmup.state must be measured`);
    }
    try {
      validateExactPsoWarmupTelemetrySnapshot(run.psoWarmup.value as PsoWarmupTelemetrySnapshot);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      invalidReport(`runs[${runIndex}].psoWarmup.value is invalid: ${reason}`);
    }
    try {
      requireGreyboxWorldTelemetry(run.greyboxWorld.value);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      invalidReport(`runs[${runIndex}].greyboxWorld.value is invalid: ${reason}`);
    }
    requireHybridUiEvidence(run.hybridUi, `runs[${runIndex}].hybridUi`);
    requireRecord(run.simulationController, `runs[${runIndex}].simulationController`);
    if (run.simulationController.state !== "measured") {
      invalidReport(`runs[${runIndex}].simulationController.state must be measured`);
    }
    requireSimulationGameplayEvidence(
      run.simulationController.value,
      `runs[${runIndex}].simulationController.value`,
    );
    requireRecord(run.streaming, `runs[${runIndex}].streaming`);
    if (run.streaming.state !== "measured") {
      invalidReport(`runs[${runIndex}].streaming.state must be measured`);
    }
    requireRecord(run.streaming.value, `runs[${runIndex}].streaming.value`);
    if (!Number.isInteger(run.streaming.value.measurementStartResidentCellCount)) {
      invalidReport(
        `runs[${runIndex}].streaming.value.measurementStartResidentCellCount must be an integer`,
      );
    }
    let streaming: StreamingEvidence;
    try {
      streaming = requireStreamingEvidence(run.streaming.value);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      invalidReport(`runs[${runIndex}].streaming.value is invalid: ${reason}`);
    }
    streamingP95ByProfile.get(run.profile)?.push(streaming.cellLoadP95Ms);
    const observedMetrics = new Set<string>();
    evaluatedChecks += run.budgetChecks.length;
    for (const [checkIndex, check] of run.budgetChecks.entries()) {
      const path = `runs[${runIndex}].budgetChecks[${checkIndex}]`;
      requireRecord(check, path);
      const actual = check.actual;
      const limit = check.limit;
      requireFiniteNonnegative(actual, `${path}.actual`);
      requireFiniteNonnegative(limit, `${path}.limit`);
      const metric = requireText(check.metric, `${path}.metric`);
      if (typeof check.passed !== "boolean") invalidReport(`${path}.passed must be boolean`);
      if (check.passed !== actual <= limit) {
        invalidReport(`${path}.passed must agree with actual <= limit`);
      }
      if (observedMetrics.has(metric)) invalidReport(`${path}.metric must not be duplicated`);
      observedMetrics.add(metric);
    }
    const expectedMetrics = [...SMOKE_BUDGET_METRIC_NAMES].sort();
    if (JSON.stringify([...observedMetrics].sort()) !== JSON.stringify(expectedMetrics)) {
      invalidReport(
        `runs[${runIndex}].budgetChecks must contain exactly ${expectedMetrics.join(", ")}`,
      );
    }
    const p95Check = run.budgetChecks.find(
      (check) => check.metric === SMOKE_BUDGET_METRICS.streamingCellLoadP95Ms,
    );
    if (p95Check?.actual !== streaming.cellLoadP95Ms) {
      invalidReport(
        `runs[${runIndex}] streaming budget checks must agree with measured streaming evidence`,
      );
    }
    const controllerCheck = run.budgetChecks.find(
      (check) => check.metric === SMOKE_BUDGET_METRICS.simulationGameplayStepHighWaterMs,
    );
    if (controllerCheck?.actual !== run.simulationController.value.stepDurationHighWaterMs) {
      invalidReport(
        `runs[${runIndex}] controller budget check must agree with measured controller evidence`,
      );
    }
    if (controllerCheck.limit !== SIMULATION_GAMEPLAY_STEP_BUDGET_MS) {
      invalidReport(
        `runs[${runIndex}] controller budget check must use the authoritative gameplay limit`,
      );
    }
  }
  for (const profile of ["fresh", "warm"] as const) {
    if (repeats.get(profile)?.size !== SMOKE_REPEATS) {
      invalidReport(`${profile} runs must contain repeats 1 through ${SMOKE_REPEATS}`);
    }
    const expected = evaluateBoundedRepeatability(
      streamingP95ByProfile.get(profile) ?? [],
      SMOKE_REPEATS,
      "streaming cell-load p95",
      SMOKE_STREAMING_P95_RELATIVE_RANGE_LIMIT,
      SMOKE_STREAMING_P95_ABSOLUTE_RANGE_FLOOR_MS,
    );
    const declared = declaredStreamingVariance.find((summary) => summary.profile === profile);
    if (
      declared?.state !== expected.state ||
      declared.absoluteP95RangeMs !== expected.absoluteRange ||
      declared.allowedAbsoluteP95RangeMs !== expected.allowedAbsoluteRange ||
      declared.relativeP95Range !== expected.relativeRange ||
      (expected.state === "invalid" && declared.reason !== expected.reason)
    ) {
      invalidReport(
        `streamingCellLoadP95Variance ${profile} summary must equal the variance recomputed from run evidence`,
      );
    }
  }
  requireStringArray(environmentFacet.reasons, "facets.environment.reasons");
  requireStringArray(evidenceFacet.reasons, "facets.evidenceCompleteness.reasons");
  requireStringArray(budgetFacet.reasons, "facets.budgetEvaluation.reasons");
  if (
    typeof budgetFacet.evaluatedChecks !== "number" ||
    !Number.isInteger(budgetFacet.evaluatedChecks) ||
    budgetFacet.evaluatedChecks !== evaluatedChecks
  ) {
    invalidReport(`facets.budgetEvaluation.evaluatedChecks must equal ${evaluatedChecks}`);
  }
  return value as unknown as BaselineEligibleReport;
}

function requireHybridUiEvidence(value: unknown, path: string): void {
  requireRecord(value, path);
  if (value.state !== "measured") invalidReport(`${path}.state must be measured`);
  const snapshot = value.value;
  requireRecord(snapshot, `${path}.value`);
  const worker = snapshot.worker;
  requireRecord(worker, `${path}.value.worker`);
  if (
    snapshot.schemaVersion !== SMOKE_HYBRID_UI_TELEMETRY_SCHEMA_VERSION ||
    snapshot.state !== "ready" ||
    typeof snapshot.presentationRevision !== "number" ||
    !Number.isSafeInteger(snapshot.presentationRevision) ||
    typeof snapshot.presentationCount !== "number" ||
    !Number.isSafeInteger(snapshot.presentationCount) ||
    snapshot.presentationCount < 1 ||
    typeof snapshot.domNodeCountHighWater !== "number" ||
    !Number.isSafeInteger(snapshot.domNodeCountHighWater) ||
    snapshot.domNodeCountHighWater < 1 ||
    worker.schemaVersion !== SMOKE_HYBRID_UI_TELEMETRY_SCHEMA_VERSION ||
    typeof worker.presentationCount !== "number" ||
    !Number.isSafeInteger(worker.presentationCount) ||
    worker.presentationCount < 1 ||
    worker.presentationRevision !== snapshot.presentationRevision ||
    typeof worker.worldAnchorCount !== "number" ||
    !Number.isSafeInteger(worker.worldAnchorCount) ||
    worker.worldAnchorCount < 1
  ) {
    invalidReport(`${path}.value must contain complete hybrid UI evidence`);
  }
}

export function parseFinalizedSmokeReport(value: unknown): BaselineEligibleReport {
  const report = parseBaselineEligibleReport(value);
  if (
    report.passed !== true ||
    report.postRunIdentity.state !== "measured" ||
    report.reportPersistence.state !== "measured" ||
    report.finalizationFailure !== null ||
    report.facets.budgetEvaluation.status !== "passed" ||
    report.facets.environment.status !== "passed" ||
    report.facets.evidenceCompleteness.status !== "passed" ||
    report.facets.budgetEvaluation.reasons.length !== 0 ||
    report.facets.environment.reasons.length !== 0 ||
    report.facets.evidenceCompleteness.reasons.length !== 0
  ) {
    invalidReport("smoke report must be finalized with all three passing facets");
  }
  return report;
}

function summarizeBaselineMetrics(
  report: Omit<BaselineEligibleReport, "baseline">,
): readonly BaselineMetricSummary[] {
  const samples = new Map<string, number[]>();
  for (const run of report.runs) {
    for (const check of run.budgetChecks) {
      const key = `${run.profile}.${check.metric}`;
      const values = samples.get(key) ?? [];
      values.push(check.actual);
      samples.set(key, values);
    }
  }
  const metrics: BaselineMetricSummary[] = [
    { key: "build.engineAndRenderWorkerBytes", value: report.build.engineAndRenderWorkerBytes },
    { key: "build.totalBuildBytes", value: report.build.totalBuildBytes },
  ];
  for (const [key, values] of samples) {
    metrics.push({ key, value: values.reduce((sum, value) => sum + value, 0) / values.length });
  }
  return Object.freeze(
    metrics
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((metric) => Object.freeze(metric)),
  );
}

function compareMetricSummaries(
  baseline: readonly BaselineMetricSummary[],
  candidate: readonly BaselineMetricSummary[],
): readonly BaselineMetricComparison[] {
  const baselineByKey = new Map(baseline.map((metric) => [metric.key, metric.value] as const));
  return Object.freeze(
    candidate.flatMap((metric) => {
      const prior = baselineByKey.get(metric.key);
      if (prior === undefined) return [];
      const absoluteDelta = metric.value - prior;
      return [
        Object.freeze({
          absoluteDelta,
          baseline: prior,
          candidate: metric.value,
          key: metric.key,
          relativeDelta: prior === 0 ? null : absoluteDelta / prior,
        }),
      ];
    }),
  );
}

function requireBaselineRecord(value: unknown): BaselineRecord {
  if (!isRecord(value)) invalidBaseline("record must be an object");
  requireBaselineSha256(value.artifactDigest, "artifactDigest");
  if (
    typeof value.mandatoryMetricSetVersion !== "number" ||
    !Number.isInteger(value.mandatoryMetricSetVersion) ||
    value.mandatoryMetricSetVersion < 1
  ) {
    invalidBaseline("mandatoryMetricSetVersion must be a positive integer");
  }
  if (!isRecord(value.browser)) invalidBaseline("browser must be an object");
  requireBaselineText(value.browser.revision, "browser.revision");
  requireBaselineText(value.browser.version, "browser.version");
  requireBaselineSha256(value.browser.executableSha256, "browser.executableSha256");
  if (!isRecord(value.comparisonEnvironment)) {
    invalidBaseline("comparisonEnvironment must be an object");
  }
  const environment = value.comparisonEnvironment;
  if (!isRecord(environment.adapter)) invalidBaseline("comparisonEnvironment.adapter is invalid");
  if (!isRecord(environment.hostAfterRuns)) {
    invalidBaseline("comparisonEnvironment.hostAfterRuns is invalid");
  }
  if (!isRecord(environment.machine)) invalidBaseline("comparisonEnvironment.machine is invalid");
  requireBaselineText(environment.machineId, "comparisonEnvironment.machineId");
  if (environment.requestedTier !== "showcase" && environment.requestedTier !== "standard") {
    invalidBaseline("comparisonEnvironment.requestedTier must be showcase or standard");
  }
  requireBaselineText(environment.targetDisplayMode, "comparisonEnvironment.targetDisplayMode");
  if (environment.target !== undefined) {
    if (
      !isRecord(environment.target) ||
      (environment.target.kind !== "local" && environment.target.kind !== "production") ||
      (environment.target.origin !== "http://127.0.0.1" &&
        environment.target.origin !== "https://parallax-web.com") ||
      (environment.target.kind === "local" && environment.target.origin !== "http://127.0.0.1") ||
      (environment.target.kind === "production" &&
        environment.target.origin !== "https://parallax-web.com")
    ) {
      invalidBaseline("comparisonEnvironment.target is invalid");
    }
  }
  if (!isRecord(environment.harnessRuntime)) {
    invalidBaseline("comparisonEnvironment.harnessRuntime must be an object");
  }
  requireBaselineSha256(
    environment.harnessRuntime.nodeExecutableSha256,
    "comparisonEnvironment.harnessRuntime.nodeExecutableSha256",
  );
  const nodeVersion = requireBaselineText(
    environment.harnessRuntime.nodeVersion,
    "comparisonEnvironment.harnessRuntime.nodeVersion",
  );
  if (!/^v\d+\.\d+\.\d+$/.test(nodeVersion)) {
    invalidBaseline("comparisonEnvironment.harnessRuntime.nodeVersion must be exact");
  }
  if (!Array.isArray(value.metrics)) invalidBaseline("metrics must be an array");
  const metricKeys = new Set<string>();
  for (const [index, metric] of value.metrics.entries()) {
    if (!isRecord(metric)) invalidBaseline(`metrics[${index}] must be an object`);
    const key = requireBaselineText(metric.key, `metrics[${index}].key`);
    if (typeof metric.value !== "number" || !Number.isFinite(metric.value) || metric.value < 0) {
      invalidBaseline(`metrics[${index}].value must be a finite nonnegative number`);
    }
    if (metricKeys.has(key)) invalidBaseline(`metrics contains duplicate key ${key}`);
    metricKeys.add(key);
  }
  if (metricKeys.size === 0) invalidBaseline("metrics must not be empty");
  requireBaselineText(value.promotedBy, "promotedBy");
  requireBaselineText(value.promotionReason, "promotionReason");
  requireBaselineSha256(value.reportDigest, "reportDigest");
  requireBaselineText(value.reportFile, "reportFile");
  requireBaselineTimestamp(value.promotedAt, "promotedAt");
  requireBaselineTimestamp(value.reportGeneratedAt, "reportGeneratedAt");
  if (
    typeof value.reportSchemaVersion !== "number" ||
    !Number.isInteger(value.reportSchemaVersion) ||
    value.reportSchemaVersion < 1
  ) {
    invalidBaseline("reportSchemaVersion must be a positive integer");
  }
  if (!isRecord(value.source)) invalidBaseline("source must be an object");
  if (typeof value.source.commit !== "string" || !/^[a-f0-9]{40,64}$/.test(value.source.commit)) {
    invalidBaseline("source.commit must be a Git object ID");
  }
  if (value.source.dirtyTreeDigest !== null) {
    requireBaselineSha256(value.source.dirtyTreeDigest, "source.dirtyTreeDigest");
  }
  return value as unknown as BaselineRecord;
}

function requireMatchingMetricKeys(
  baselineMetrics: readonly BaselineMetricSummary[],
  candidateMetrics: readonly BaselineMetricSummary[],
): void {
  const baselineKeys = baselineMetrics.map((metric) => metric.key).sort();
  const candidateKeys = candidateMetrics.map((metric) => metric.key).sort();
  if (JSON.stringify(baselineKeys) !== JSON.stringify(candidateKeys)) {
    invalidBaseline(`metrics must contain exactly ${candidateKeys.join(", ")}`);
  }
}

function requireBaselineText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    invalidBaseline(`${path} must be a nonempty string`);
  }
  return value;
}

function requireBaselineSha256(value: unknown, path: string): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    invalidBaseline(`${path} must be a lowercase SHA-256 digest`);
  }
}

function requireBaselineTimestamp(value: unknown, path: string): void {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    invalidBaseline(`${path} must be an ISO timestamp`);
  }
}

function invalidBaseline(reason: string): never {
  throw new Error(`Promoted baseline record is invalid: ${reason}`);
}

function assertPromotionEligible(report: BaselineEligibleReport): void {
  const facetStatuses = [
    report.facets.environment.status,
    report.facets.evidenceCompleteness.status,
    report.facets.budgetEvaluation.status,
  ];
  if (!report.passed || facetStatuses.some((status) => status !== "passed")) {
    throw new Error(
      "Only an aggregate-passing report with all three passing facets can be promoted",
    );
  }
  if (
    report.runs.some((run) => run.budgetChecks.some((check) => !check.passed)) ||
    report.postRunIdentity.state !== "measured" ||
    report.reportPersistence.state !== "measured" ||
    report.environment.targetPostflight.state !== "verified" ||
    report.finalizationFailure !== null ||
    report.facets.environment.reasons.length > 0 ||
    report.facets.evidenceCompleteness.reasons.length > 0 ||
    report.facets.budgetEvaluation.reasons.length > 0
  ) {
    throw new Error("A promotable report must have no failed checks or passing-facet reasons");
  }
}

function requireFinalizationEvidence(value: unknown, path: string): void {
  requireRecord(value, path);
  if (value.state !== "measured" && value.state !== "invalid") {
    invalidReport(`${path}.state must be measured or invalid`);
  }
  if (value.state === "invalid") requireText(value.reason, `${path}.reason`);
  if (value.state === "measured" && value.reason !== undefined) {
    invalidReport(`${path}.reason must be absent when state is measured`);
  }
}

function assertPromotionTransition(
  report: BaselineEligibleReport,
  store: BaselineStore,
  allowIneligible: boolean,
): void {
  const anchor = baselineAnchor(report, store);
  const current = anchor === null ? undefined : requireBaselineRecord(anchor.record);
  const observedDigest =
    report.baseline.state === "untracked" ? null : report.baseline.baseline.reportDigest;
  if (current === undefined && observedDigest !== null) {
    throw new Error(
      "Baseline promotion is stale: the report observed an anchor that no longer exists",
    );
  }
  if (current !== undefined && observedDigest !== current.reportDigest) {
    throw new Error(
      "Baseline promotion is stale: the report was not generated against the currently promoted anchor",
    );
  }
  const evaluation = evaluateBaseline(report, store);
  if (evaluation.state === "ineligible" && !allowIneligible) {
    throw new Error(
      `Baseline promotion is ineligible: ${evaluation.reason}; pass --rebaseline only for an intentional reviewed rebaseline`,
    );
  }
}

function baselineAnchor(
  report: Omit<BaselineEligibleReport, "baseline">,
  store: BaselineStore,
): Readonly<{ legacy: boolean; record: unknown }> | null {
  const qualified = store.entries[baselineKey(report)];
  if (qualified !== undefined) return Object.freeze({ legacy: false, record: qualified });
  if (report.environment.target.kind !== "local") return null;
  const legacy = store.entries[legacyBaselineKey(report)];
  return legacy === undefined ? null : Object.freeze({ legacy: true, record: legacy });
}

function baselineKey(report: Omit<BaselineEligibleReport, "baseline">): string {
  return [
    report.scenario,
    report.environment.machineId,
    report.environment.requestedTier,
    report.environment.target.kind,
    comparisonTarget(report.environment.target).origin,
  ].join("|");
}

function legacyBaselineKey(report: Omit<BaselineEligibleReport, "baseline">): string {
  return [report.scenario, report.environment.machineId, report.environment.requestedTier].join(
    "|",
  );
}

function comparisonEnvironment(
  report: Omit<BaselineEligibleReport, "baseline">,
): BaselineComparisonEnvironment {
  return Object.freeze({
    adapter: report.environment.adapter,
    hostAfterRuns: report.environment.hostAfterRuns,
    machine: report.environment.machine,
    machineId: report.environment.machineId,
    requestedTier: report.environment.requestedTier,
    target: comparisonTarget(report.environment.target),
    targetDisplayMode: report.environment.targetDisplayMode,
    harnessRuntime: report.harnessRuntime,
  });
}

function comparisonTarget(target: HarnessTargetIdentity): BaselineTargetComparisonIdentity {
  return Object.freeze({
    kind: target.kind,
    origin: target.kind === "local" ? "http://127.0.0.1" : "https://parallax-web.com",
  });
}

function emptyBaselineStore(): BaselineStore {
  return Object.freeze({
    entries: Object.freeze({}),
    schemaVersion: BASELINE_STORE_SCHEMA_VERSION,
  });
}

async function writeBaselineStore(path: string, store: BaselineStore): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { flag: "wx" });
  try {
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function withBaselineStoreLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  const token = randomUUID();
  const deadline = Date.now() + 10_000;
  while (!(await tryAcquireBaselineStoreLock(lockPath, token))) {
    await clearStaleBaselineStoreLock(lockPath);
    if (Date.now() >= deadline)
      throw new Error(`Timed out acquiring baseline store lock ${lockPath}`);
    await delay(25);
  }
  try {
    return await action();
  } finally {
    await releaseBaselineStoreLock(lockPath, token);
  }
}

async function tryAcquireBaselineStoreLock(path: string, token: string): Promise<boolean> {
  let created = false;
  try {
    const handle = await open(path, "wx");
    created = true;
    try {
      await handle.writeFile(
        `${JSON.stringify({ createdAt: new Date().toISOString(), pid: process.pid, token })}\n`,
      );
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    if (created) await rm(path, { force: true });
    if (isNodeError(error) && error.code === "EEXIST") return false;
    throw error;
  }
}

async function clearStaleBaselineStoreLock(path: string): Promise<void> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
  let metadata: { readonly createdAt?: unknown };
  try {
    metadata = JSON.parse(source) as typeof metadata;
  } catch {
    const age = await fileAgeMilliseconds(path);
    if (age !== null && age > 300_000) await removeLockIfUnchanged(path, source);
    return;
  }
  const createdAt = typeof metadata.createdAt === "string" ? Date.parse(metadata.createdAt) : NaN;
  if (!Number.isFinite(createdAt) || Date.now() - createdAt <= 300_000) return;
  await removeLockIfUnchanged(path, source);
}

async function releaseBaselineStoreLock(path: string, token: string): Promise<void> {
  try {
    const metadata = JSON.parse(await readFile(path, "utf8")) as { readonly token?: unknown };
    if (metadata.token === token) await rm(path, { force: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    console.warn(
      `Could not verify ownership while releasing baseline store lock ${path}: ${formatError(error)}. The promotion action's outcome is preserved, and the lock will be eligible for stale recovery after five minutes.`,
    );
  }
}

async function removeLockIfUnchanged(path: string, expectedSource: string): Promise<void> {
  try {
    if ((await readFile(path, "utf8")) === expectedSource) await rm(path, { force: true });
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
  }
}

async function fileAgeMilliseconds(path: string): Promise<number | null> {
  try {
    return Date.now() - (await stat(path)).mtimeMs;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function requiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed === "") throw new Error(`Baseline ${label} must not be empty`);
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalidReport(`${path} has unsupported or missing keys`);
  }
}

function canonicalJsonStringify(value: unknown): string {
  const serialized = JSON.stringify(canonicalJsonValue(value));
  if (serialized === undefined) throw new Error("Comparison environment must be JSON-serializable");
  return serialized;
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJsonValue(value[key])]),
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function requireRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) invalidReport(`${path} must be an object`);
}

function requireText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    invalidReport(`${path} must be a nonempty string`);
  }
  return value;
}

function requireStringArray(value: unknown, path: string): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    invalidReport(`${path} must be an array of strings`);
  }
}

function requireFiniteNonnegative(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    invalidReport(`${path} must be a finite nonnegative number`);
  }
}

function requireSimulationGameplayEvidence(
  value: unknown,
  path: string,
): asserts value is SimulationGameplayEvidence {
  requireRecord(value, path);
  for (const field of [
    "adapterInitializationHighWaterMs",
    "movementDistanceMeters",
    "navigationEdgeCount",
    "navigationExpandedNodeCount",
    "navigationGridBytes",
    "navigationNodeCount",
    "navigationPathNodeCount",
    "navigationPathQueryCount",
    "navigationTileCount",
    "npcAgentCount",
    "npcAvoidanceAdjustmentCount",
    "npcMovementDistanceMeters",
    "npcMovingAgentCount",
    "npcScheduleTransitionCount",
    "stepDurationHighWaterMs",
  ] as const) {
    requireFiniteNonnegative(value[field], `${path}.${field}`);
  }
  const evidence = value as unknown as SimulationGameplayEvidence;
  if (
    evidence.movementDistanceMeters <= 0 ||
    evidence.navigationEdgeCount <= evidence.navigationNodeCount ||
    evidence.navigationExpandedNodeCount <= 0 ||
    evidence.navigationGridBytes <= 0 ||
    evidence.navigationNodeCount <= 0 ||
    evidence.navigationPathNodeCount <=
      SMOKE_SIMULATION_GAMEPLAY_WORKLOAD.navigationPathQueryCount ||
    evidence.navigationPathQueryCount !==
      SMOKE_SIMULATION_GAMEPLAY_WORKLOAD.navigationPathQueryCount ||
    evidence.navigationTileCount !== SMOKE_SIMULATION_GAMEPLAY_WORKLOAD.navigationTileCount ||
    evidence.npcAgentCount !== SMOKE_SIMULATION_GAMEPLAY_WORKLOAD.npcAgentCount ||
    evidence.npcAvoidanceAdjustmentCount <= 0 ||
    evidence.npcMovementDistanceMeters <= 0 ||
    evidence.npcMovingAgentCount <= 0 ||
    evidence.npcMovingAgentCount > evidence.npcAgentCount ||
    evidence.npcScheduleTransitionCount <= 0
  ) {
    invalidReport(`${path} has invalid gameplay crowd evidence`);
  }
  for (const field of [
    "navigationEdgeCount",
    "navigationExpandedNodeCount",
    "navigationGridBytes",
    "navigationNodeCount",
    "navigationPathNodeCount",
    "navigationPathQueryCount",
    "navigationTileCount",
    "npcAgentCount",
    "npcAvoidanceAdjustmentCount",
    "npcMovingAgentCount",
    "npcScheduleTransitionCount",
  ] as const) {
    if (!Number.isSafeInteger(evidence[field])) {
      invalidReport(`${path}.${field} must be a safe integer`);
    }
  }
}

function requireP95VarianceSummaries(
  value: unknown,
  path: string,
): BaselineEligibleReport["streamingCellLoadP95Variance"] {
  if (!Array.isArray(value) || value.length !== 2) {
    invalidReport(`${path} must contain exactly fresh and warm summaries`);
  }
  for (const [index, expectedProfile] of (["fresh", "warm"] as const).entries()) {
    const summary = value[index];
    requireRecord(summary, `${path}[${index}]`);
    if (summary.profile !== expectedProfile) {
      invalidReport(`${path}[${index}].profile must be ${expectedProfile}`);
    }
    if (summary.state !== "measured" && summary.state !== "invalid") {
      invalidReport(`${path}[${index}].state must be measured or invalid`);
    }
    if (summary.relativeP95Range !== null) {
      requireFiniteNonnegative(summary.relativeP95Range, `${path}[${index}].relativeP95Range`);
    }
    if (summary.absoluteP95RangeMs !== null) {
      requireFiniteNonnegative(summary.absoluteP95RangeMs, `${path}[${index}].absoluteP95RangeMs`);
    }
    if (summary.allowedAbsoluteP95RangeMs !== null) {
      requireFiniteNonnegative(
        summary.allowedAbsoluteP95RangeMs,
        `${path}[${index}].allowedAbsoluteP95RangeMs`,
      );
    }
    if ((summary.absoluteP95RangeMs === null) !== (summary.allowedAbsoluteP95RangeMs === null)) {
      invalidReport(
        `${path}[${index}] absoluteP95RangeMs and allowedAbsoluteP95RangeMs must both be measured or both be null`,
      );
    }
    if (summary.state === "measured") {
      if (summary.reason !== undefined) {
        invalidReport(`${path}[${index}].reason must be absent when state is measured`);
      }
      if (summary.absoluteP95RangeMs === null || summary.allowedAbsoluteP95RangeMs === null) {
        invalidReport(`${path}[${index}] measured repeatability must include both absolute ranges`);
      }
      if (summary.absoluteP95RangeMs > summary.allowedAbsoluteP95RangeMs) {
        invalidReport(
          `${path}[${index}] measured absolute p95 range must not exceed its allowance`,
        );
      }
    }
    if (summary.state === "invalid") {
      requireText(summary.reason, `${path}[${index}].reason`);
    }
  }
  return value as unknown as BaselineEligibleReport["streamingCellLoadP95Variance"];
}

function requireSha256(value: unknown, path: string): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    invalidReport(`${path} must be a lowercase SHA-256 digest`);
  }
}

function requireGitCommit(value: unknown, path: string): void {
  if (typeof value !== "string" || !/^[a-f0-9]{40,64}$/.test(value)) {
    invalidReport(`${path} must be a lowercase Git commit object ID`);
  }
}

function invalidReport(reason: string): never {
  throw new Error(`Report does not implement the smoke baseline contract: ${reason}`);
}
