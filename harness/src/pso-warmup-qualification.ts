import { createHash } from "node:crypto";
import type { PsoWarmupTelemetrySnapshot } from "@parallax/engine";
import { type BaselineEligibleReport, parseFinalizedSmokeReport } from "./baseline-store.js";
import type { ValidatedBuildManifest } from "./build-manifest.js";
import type { ChromePin } from "./chrome-pin.js";
import {
  type BrowserDisplayIdentity,
  evaluateBrowserDisplay,
  evaluateGateEnvironment,
  type MachineDescriptor,
} from "./environment.js";
import { validateExactPsoWarmupTelemetrySnapshot } from "./pso-warmup-telemetry.js";
import { QUALITY_TIER_PROFILES } from "./runs/smoke.js";
import type { SourceIdentity } from "./source-identity.js";
import type { HarnessTargetIdentity } from "./target.js";

export const PSO_WARMUP_QUALIFICATION_SCHEMA_VERSION = 1;
export const PSO_WARMUP_QUALIFICATION_CONTRACT = "pso-warmup-launch-pair@1";

export interface PsoWarmupLaunchObservation {
  readonly pipelineHitCount: number;
  readonly pipelineMissCount: number;
  readonly shaderHitCount: number;
  readonly shaderMissCount: number;
}

export interface PsoWarmupLaunchPair {
  readonly fresh: PsoWarmupLaunchObservation;
  readonly lineageId: string;
  readonly repeat: number;
  readonly warm: PsoWarmupLaunchObservation;
}

export interface PsoWarmupQualificationResult {
  readonly artifactDigest: string;
  readonly browser: Readonly<{
    readonly executableSha256: string;
    readonly pin: ChromePin;
    readonly product: string;
    readonly revision: string;
  }>;
  readonly buildCompatibilityDigest: string;
  readonly contract: typeof PSO_WARMUP_QUALIFICATION_CONTRACT;
  readonly pairs: readonly PsoWarmupLaunchPair[];
  readonly passed: true;
  readonly releaseDigest: string;
  readonly schemaVersion: typeof PSO_WARMUP_QUALIFICATION_SCHEMA_VERSION;
  readonly smokeReport: Readonly<{ path: string; sha256: string }>;
  readonly source: SourceIdentity;
  readonly target: Readonly<{
    readonly identity: HarnessTargetIdentity;
    readonly postflight: BaselineEligibleReport["environment"]["targetPostflight"];
    readonly preflight: BaselineEligibleReport["environment"]["targetPreflight"];
  }>;
  readonly trace: Readonly<{
    readonly buildCompatibilityDigest: string;
    readonly sha256: string;
    readonly state: "ready";
  }>;
  readonly traceSha256: string;
}

export interface PsoWarmupQualificationAuthority {
  readonly build: ValidatedBuildManifest;
  readonly chromeExecutableSha256: string;
  readonly chromePin: ChromePin;
  readonly machineDescriptor: MachineDescriptor;
  readonly repositorySource: SourceIdentity;
  readonly smokeReportPath: string;
}

export function qualifyPsoWarmupLaunchPairs(
  inputBytes: Uint8Array,
  authority: PsoWarmupQualificationAuthority,
): PsoWarmupQualificationResult {
  if (authority.smokeReportPath === "") {
    throw new Error("PSO warmup qualification requires exact source-report identity");
  }
  const sourceSha256 = createHash("sha256").update(inputBytes).digest("hex");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(inputBytes)) as unknown;
  } catch (error: unknown) {
    throw new Error("PSO warmup qualification source report is not valid UTF-8 JSON", {
      cause: error,
    });
  }
  const report = parseFinalizedSmokeReport(parsed);
  assertReportAuthority(report, authority);
  if (!report.mandatoryMetricSet.metrics.includes("PSO warmup trace replay")) {
    throw new Error("PSO warmup qualification requires mandatory PSO trace replay");
  }
  const runs = report.runs;
  if (runs.length !== 6) {
    throw new Error("PSO warmup qualification requires the exact six core launches");
  }

  const pairs: PsoWarmupLaunchPair[] = [];
  const lineageIds = new Set<string>();
  let traceSha256: string | null = null;
  let buildCompatibilityDigest: string | null = null;
  let pendingFresh:
    | Readonly<{
        launch: PsoWarmupLaunchObservation;
        lineageId: string;
        repeat: number;
      }>
    | undefined;
  let previousLaunchStartedAfterSequenceMs = -1;
  for (const [index, candidate] of runs.entries()) {
    const run = record(candidate, "smoke run");
    const expectedRepeat = Math.floor(index / 2) + 1;
    const expectedProfile = index % 2 === 0 ? "fresh" : "warm";
    if (
      run.profile !== expectedProfile ||
      positiveInteger(run.repeat, "smoke repeat") !== expectedRepeat ||
      positiveInteger(run.launchOrdinal, "smoke launch ordinal") !== index + 1
    ) {
      throw new Error(
        "PSO warmup qualification requires original fresh/warm adjacency and launch order",
      );
    }
    const launchStartedAfterSequenceMs = finiteNonnegative(
      run.launchStartedAfterSequenceMs,
      "smoke launch sequence time",
    );
    if (launchStartedAfterSequenceMs <= previousLaunchStartedAfterSequenceMs) {
      throw new Error("PSO warmup qualification requires strictly monotonic launch chronology");
    }
    previousLaunchStartedAfterSequenceMs = launchStartedAfterSequenceMs;
    const lineage = record(run.profileLineage, "profile lineage");
    const lineageId = string(lineage.id, "profile lineage id");
    const history = array(lineage.history, "profile lineage history");
    const expectedHistory = expectedProfile === "fresh" ? ["fresh"] : ["fresh", "warm"];
    if (JSON.stringify(history) !== JSON.stringify(expectedHistory)) {
      throw new Error("PSO warmup qualification found nonadjacent fresh/warm lineage history");
    }
    const psoMetric = record(run.psoWarmup, "PSO warmup metric");
    if (psoMetric.state !== "measured") {
      throw new Error("PSO warmup qualification requires measured product telemetry");
    }
    const pso = validateExactPsoWarmupTelemetrySnapshot(
      psoMetric.value as PsoWarmupTelemetrySnapshot,
    );
    validateExactReplay(pso);
    if (
      (traceSha256 !== null && pso.traceSha256 !== traceSha256) ||
      (buildCompatibilityDigest !== null &&
        pso.buildCompatibilityDigest !== buildCompatibilityDigest)
    ) {
      throw new Error("PSO warmup qualification found trace identity drift across launches");
    }
    traceSha256 = pso.traceSha256;
    buildCompatibilityDigest = pso.buildCompatibilityDigest;

    const launch = readDawnObservation(run.dawnPipeline, expectedProfile);
    if (expectedProfile === "fresh") {
      if (lineageIds.has(lineageId) || lineageId !== `lineage-${expectedRepeat}`) {
        throw new Error("PSO warmup qualification requires three exact distinct lineages");
      }
      lineageIds.add(lineageId);
      pendingFresh = Object.freeze({ launch, lineageId, repeat: expectedRepeat });
      continue;
    }
    if (
      pendingFresh === undefined ||
      pendingFresh.repeat !== expectedRepeat ||
      pendingFresh.lineageId !== lineageId
    ) {
      throw new Error(
        "PSO warmup qualification requires the same persistent profile within each pair",
      );
    }
    assertPairConservation(pendingFresh.launch, launch, expectedRepeat);
    pairs.push(
      Object.freeze({
        fresh: pendingFresh.launch,
        lineageId,
        repeat: expectedRepeat,
        warm: launch,
      }),
    );
    pendingFresh = undefined;
  }

  if (pendingFresh !== undefined || pairs.length !== 3 || lineageIds.size !== 3) {
    throw new Error("PSO warmup qualification requires exact lineages 1 through 3");
  }
  assertCrossLineageConservation(pairs);
  if (traceSha256 === null || buildCompatibilityDigest === null) {
    throw new Error("PSO warmup qualification did not observe a trace identity");
  }
  if (
    traceSha256 !== authority.build.psoWarmupTrace.sha256 ||
    buildCompatibilityDigest !== authority.build.psoWarmupTrace.buildCompatibilityDigest
  ) {
    throw new Error("PSO warmup qualification telemetry does not match the validated build trace");
  }
  return Object.freeze({
    artifactDigest: authority.build.artifactDigest,
    browser: Object.freeze({
      executableSha256: authority.chromeExecutableSha256,
      pin: authority.chromePin,
      product: report.environment.browserProduct,
      revision: report.environment.browserRevision,
    }),
    buildCompatibilityDigest,
    contract: PSO_WARMUP_QUALIFICATION_CONTRACT,
    pairs: Object.freeze(pairs),
    passed: true,
    releaseDigest: authority.build.releaseDigest,
    schemaVersion: PSO_WARMUP_QUALIFICATION_SCHEMA_VERSION,
    smokeReport: Object.freeze({ path: authority.smokeReportPath, sha256: sourceSha256 }),
    source: authority.repositorySource,
    target: Object.freeze({
      identity: report.environment.target,
      postflight: report.environment.targetPostflight,
      preflight: report.environment.targetPreflight,
    }),
    trace: Object.freeze({
      buildCompatibilityDigest,
      sha256: traceSha256,
      state: "ready",
    }),
    traceSha256,
  });
}

function assertReportAuthority(
  report: BaselineEligibleReport,
  authority: PsoWarmupQualificationAuthority,
): void {
  if (
    report.artifactDigest !== authority.build.artifactDigest ||
    report.releaseDigest !== authority.build.releaseDigest ||
    report.environment.target.artifactDigest !== authority.build.artifactDigest ||
    report.environment.target.releaseDigest !== authority.build.releaseDigest
  ) {
    throw new Error("PSO warmup qualification report does not match the validated build");
  }
  if (JSON.stringify(report.source) !== JSON.stringify(authority.repositorySource)) {
    throw new Error("PSO warmup qualification report does not match the current source identity");
  }
  if (JSON.stringify(report.chromePin) !== JSON.stringify(authority.chromePin)) {
    throw new Error("PSO warmup qualification report does not match the checked-in Chrome pin");
  }
  if (
    report.environment.executableSha256 !== authority.chromeExecutableSha256 ||
    report.environment.browserProduct !== `Chrome/${authority.chromePin.version}` ||
    authority.chromePin.browserRevision === "" ||
    report.environment.browserRevision !== authority.chromePin.browserRevision
  ) {
    throw new Error(
      "PSO warmup qualification browser product, revision, or executable does not match independent authority",
    );
  }
  assertRegisteredPhysicalEnvironment(report, authority.machineDescriptor);
}

function assertRegisteredPhysicalEnvironment(
  report: BaselineEligibleReport,
  machineDescriptor: MachineDescriptor,
): void {
  const environment = report.environment;
  if (
    environment.machineId !== machineDescriptor.id ||
    JSON.stringify(environment.machine) !== JSON.stringify(machineDescriptor)
  ) {
    throw new Error("PSO warmup qualification machine identity does not match registration");
  }
  const host = record(environment.host, "registered host") as unknown as Parameters<
    typeof evaluateGateEnvironment
  >[1]["host"];
  const hostAfterRuns = record(
    environment.hostAfterRuns,
    "post-run registered host",
  ) as unknown as typeof host;
  if (host.remoteSession || hostAfterRuns.remoteSession) {
    throw new Error("PSO warmup qualification rejects remote-session evidence");
  }
  if (JSON.stringify(hostAfterRuns) !== JSON.stringify(host)) {
    throw new Error("PSO warmup qualification host identity changed across the run");
  }
  const adapter = record(environment.adapter, "registered adapter") as unknown as Parameters<
    typeof evaluateGateEnvironment
  >[1]["adapter"];
  const browserDisplay = record(
    environment.browserDisplay,
    "registered browser display",
  ) as unknown as BrowserDisplayIdentity;
  const primaryGpu = environment.gpuDevices[0] as Parameters<
    typeof evaluateGateEnvironment
  >[1]["primaryGpu"];
  if (primaryGpu === undefined) {
    throw new Error("PSO warmup qualification omits the primary physical GPU");
  }
  const gate = evaluateGateEnvironment(machineDescriptor, {
    adapter,
    arch: machineDescriptor.arch,
    browserDisplay,
    host,
    platform: machineDescriptor.platform,
    primaryGpu,
    requestedTier: environment.requestedTier,
  });
  if (gate.state !== "measured") {
    throw new Error(
      `PSO warmup qualification registered environment is invalid: ${gate.reasons.join("; ")}`,
    );
  }
  const tier = QUALITY_TIER_PROFILES[environment.requestedTier];
  if (environment.targetDisplayMode !== tier.targetDisplayMode) {
    throw new Error("PSO warmup qualification target presentation mode drifted");
  }
  for (const [index, candidate] of report.runs.entries()) {
    const run = record(candidate, `presentation run ${index}`);
    const before = record(
      run.browserDisplayBefore,
      `presentation run ${index} browser display before`,
    ) as unknown as BrowserDisplayIdentity;
    const after = record(
      run.browserDisplayAfter,
      `presentation run ${index} browser display after`,
    ) as unknown as BrowserDisplayIdentity;
    if (
      evaluateBrowserDisplay(machineDescriptor.display, before).length !== 0 ||
      evaluateBrowserDisplay(machineDescriptor.display, after).length !== 0 ||
      JSON.stringify(before) !== JSON.stringify(after) ||
      JSON.stringify(before) !== JSON.stringify(browserDisplay)
    ) {
      throw new Error("PSO warmup qualification presentation display identity drifted");
    }
    const surfaceBefore = record(
      run.renderSurfaceBefore,
      `presentation run ${index} surface before`,
    );
    const surfaceAfter = record(run.renderSurfaceAfter, `presentation run ${index} surface after`);
    const surfaceChanges = array(run.renderSurfaceChanges, `presentation run ${index} changes`);
    const surfaceWidth = nonnegativeInteger(
      surfaceBefore.width,
      `presentation run ${index} surface-before width`,
    );
    const surfaceHeight = nonnegativeInteger(
      surfaceBefore.height,
      `presentation run ${index} surface-before height`,
    );
    if (
      Math.abs(surfaceWidth - tier.renderSurface.width) >
        machineDescriptor.display.dimensionTolerancePixels ||
      Math.abs(surfaceHeight - tier.renderSurface.height) >
        machineDescriptor.display.dimensionTolerancePixels ||
      JSON.stringify(surfaceAfter) !== JSON.stringify(surfaceBefore) ||
      surfaceChanges.length !== 0
    ) {
      throw new Error("PSO warmup qualification render-surface presentation identity drifted");
    }
  }
}

function validateExactReplay(input: PsoWarmupTelemetrySnapshot): void {
  if (
    input.state !== "ready" ||
    input.source !== "privileged-embedded" ||
    input.releaseDigest !== null ||
    input.traceEntryCount !== 5 ||
    input.requestedCount !== 6 ||
    input.compiledCount !== 5 ||
    input.deferredCount !== 5 ||
    input.cacheMissCount !== 5 ||
    input.cacheHitCount !== 1 ||
    input.failure !== null ||
    input.failureCount !== 0 ||
    input.queueHighWater !== 5 ||
    input.entries.length !== 5 ||
    input.entries[0]?.id !== "babylon-lite.standard-opaque-msaa4" ||
    input.entries[0].compileAttemptCount !== 1 ||
    !input.entries[0].compiled ||
    input.entries[0].requestCount !== 2 ||
    input.entries
      .slice(1)
      .some(
        (entry) => entry.compileAttemptCount !== 1 || !entry.compiled || entry.requestCount !== 1,
      )
  ) {
    throw new Error("PSO warmup qualification did not observe exact progressive trace replay");
  }
}

function readDawnObservation(
  input: unknown,
  profile: "fresh" | "warm",
): PsoWarmupLaunchObservation {
  const metric = record(input, "Dawn pipeline metric");
  if (metric.state !== "measured") {
    throw new Error("PSO warmup qualification requires measured Dawn cache evidence");
  }
  const evidence = record(metric.value, "Dawn pipeline evidence");
  if (evidence.backend !== "D3D12") {
    throw new Error("PSO warmup qualification supports only the D3D12 evidence contract");
  }
  const activity = record(evidence.pipelineActivity, "Dawn pipeline activity");
  const shader = record(evidence.shaderCache, "Dawn shader cache");
  const pipelineCache = record(evidence.pipelineCache, "Dawn pipeline cache");
  const compute = record(pipelineCache.compute, "Dawn compute-pipeline cache");
  if (
    compute.state !== "not-applicable" ||
    compute.reason !== "No backend D3D12 compute PSO cache operation occurred in this scenario run"
  ) {
    throw new Error("PSO warmup qualification requires render-only Dawn cache evidence");
  }
  const render = record(pipelineCache.render, "Dawn render-pipeline cache");
  if (render.state !== "measured") {
    throw new Error("PSO warmup qualification requires measured render-pipeline cache evidence");
  }
  const renderValue = record(render.value, "Dawn render-pipeline cache value");
  const observation = Object.freeze({
    pipelineHitCount: nonnegativeInteger(renderValue.hitCount, "pipeline hit count"),
    pipelineMissCount: nonnegativeInteger(renderValue.missCount, "pipeline miss count"),
    shaderHitCount: nonnegativeInteger(shader.hitCount, "shader hit count"),
    shaderMissCount: nonnegativeInteger(shader.missCount, "shader miss count"),
  });
  const shaderRequestCount = nonnegativeInteger(shader.requestCount, "shader request count");
  if (shaderRequestCount !== observation.shaderHitCount + observation.shaderMissCount) {
    throw new Error("PSO warmup qualification shader request counts are not conserved");
  }
  if (
    nonnegativeInteger(activity.overlappingMeasurement, "pipeline overlap") !== 0 ||
    nonnegativeInteger(shader.missesOverlappingMeasurement, "shader overlap") !== 0 ||
    (profile === "fresh"
      ? observation.pipelineMissCount <= 0 ||
        observation.pipelineHitCount !== 0 ||
        observation.shaderMissCount <= 0 ||
        observation.shaderHitCount !== 0
      : observation.pipelineHitCount <= 0 ||
        observation.pipelineMissCount !== 0 ||
        observation.shaderHitCount <= 0 ||
        observation.shaderMissCount !== 0)
  ) {
    throw new Error(`PSO warmup ${profile} launch does not prove expected Dawn cache behavior`);
  }
  return observation;
}

function assertPairConservation(
  fresh: PsoWarmupLaunchObservation,
  warm: PsoWarmupLaunchObservation,
  repeat: number,
): void {
  if (
    fresh.pipelineMissCount !== warm.pipelineHitCount ||
    fresh.shaderMissCount !== warm.shaderHitCount
  ) {
    throw new Error(`PSO warmup launch pair ${repeat} does not conserve Dawn cache counts`);
  }
}

function assertCrossLineageConservation(pairs: readonly PsoWarmupLaunchPair[]): void {
  const first = pairs[0];
  if (
    first === undefined ||
    pairs.some(
      (pair) =>
        pair.fresh.pipelineMissCount !== first.fresh.pipelineMissCount ||
        pair.warm.pipelineHitCount !== first.warm.pipelineHitCount ||
        pair.fresh.shaderMissCount !== first.fresh.shaderMissCount ||
        pair.warm.shaderHitCount !== first.warm.shaderHitCount,
    )
  ) {
    throw new Error("PSO warmup qualification cache counts drift across lineages");
  }
}

function record(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`${label} must be an object`);
  }
  return input as Record<string, unknown>;
}

function array(input: unknown, label: string): unknown[] {
  if (!Array.isArray(input)) throw new Error(`${label} must be an array`);
  return input;
}

function string(input: unknown, label: string): string {
  if (typeof input !== "string" || input === "") throw new Error(`${label} must be a string`);
  return input;
}

function nonnegativeInteger(input: unknown, label: string): number {
  if (!Number.isSafeInteger(input) || (input as number) < 0) {
    throw new Error(`${label} must be a nonnegative safe integer`);
  }
  return input as number;
}

function positiveInteger(input: unknown, label: string): number {
  const value = nonnegativeInteger(input, label);
  if (value === 0) throw new Error(`${label} must be positive`);
  return value;
}

function finiteNonnegative(input: unknown, label: string): number {
  if (typeof input !== "number" || !Number.isFinite(input) || input < 0) {
    throw new Error(`${label} must be finite and nonnegative`);
  }
  return input;
}
