import { isDeepStrictEqual } from "node:util";
import {
  APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS,
  APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
  STREAMING_CELL_LOAD_BUDGET_MS,
  STREAMING_DECODE_WORKER_MAXIMUM,
  STREAMING_RESIDENT_CELL_LIMIT,
} from "@parallax/engine";
import {
  DEGRADED_DURABILITY_WARNING,
  PROGRESS_LIVENESS_ABSOLUTE_TIMEOUT_MS,
  PROGRESS_LIVENESS_POLL_INTERVAL_MS,
  PROGRESS_LIVENESS_STALL_TIMEOUT_MS,
} from "./progress-liveness.js";
import type { RegisteredEnvironmentIdentity } from "./registered-environment.js";
import {
  createScaleStreamingManifestModel,
  type GeneratedScaleStreamingCorpus,
  parseGeneratedScaleStreamingCorpus,
} from "./scale-streaming-corpus.js";
import {
  type MaterializedScaleStreamingTarget,
  SCALE_STREAMING_INITIAL_SAMPLE_LIMIT,
  type ScaleStreamingCacheKind,
  type ScaleStreamingPipelineSamplePhase,
  type ScaleStreamingRunnerCoreResult,
  validScaleStreamingPipelineSample,
  validScaleStreamingResourceOwnedBytes,
} from "./scale-streaming-runner-core.js";
import type { SourceIdentity } from "./source-identity.js";
import { STREAMING_MEASUREMENT_SAMPLE_MINIMUM } from "./streaming-evidence.js";

export const SCALE_STREAMING_EVIDENCE_CONTRACT = "scale-streaming@1" as const;
export const SCALE_STREAMING_EVIDENCE_SCHEMA_VERSION = 1 as const;

export type ScaleStreamingPhase =
  | "reservation"
  | "validation"
  | "environment"
  | "materialization"
  | "runtime"
  | "postvalidation"
  | "cleanup"
  | "companion"
  | "complete";

export interface ScaleStreamingCleanupOutcome {
  readonly message: string | null;
  readonly operation: string;
  readonly state: "failed" | "passed";
}

export interface ScaleStreamingFailure {
  readonly message: string;
  readonly phase:
    | "validation"
    | "materialization"
    | "environment"
    | "runtime"
    | "postvalidation"
    | "cleanup";
}

export interface ScaleStreamingCompanionOutcome {
  readonly path: string;
  readonly state: "requested";
}

export interface ScaleStreamingProgress {
  readonly cleanup: boolean;
  readonly environment: boolean;
  readonly materialization: boolean;
  readonly postvalidation: boolean;
  readonly runtime: boolean;
  readonly validation: boolean;
}

export interface ScaleStreamingPersistedEvidence {
  readonly authority: ScaleStreamingRunnerCoreResult["authority"];
  readonly hydration: Readonly<{
    readonly pipeline: ScaleStreamingRunnerCoreResult["hydration"];
    readonly samples: readonly Readonly<Record<string, number>>[];
  }>;
  readonly installLiveness: ScaleStreamingRunnerCoreResult["installLiveness"];
  readonly modeled: ScaleStreamingRunnerCoreResult["modeled"];
  readonly population: ScaleStreamingRunnerCoreResult["population"];
  readonly runtime: ScaleStreamingRunnerCoreResult["runtime"];
  readonly traversal: Readonly<{
    readonly batchHighWater: number;
    readonly decodeCache: Readonly<Record<string, unknown>> | null;
    readonly decodeFailureCount: number;
    readonly decodeQueueHighWater: number;
    readonly decodedBytes: number;
    readonly encodedBytesRead: number;
    readonly gpuCache: Readonly<Record<string, unknown>> | null;
    readonly measurementEvictionCount: number;
    readonly psoWarmupGameplayOverlapCount: number;
    readonly p95Ms: number;
    readonly readCount: number;
    readonly reuse: ScaleStreamingRunnerCoreResult["traversalReuse"];
    readonly samples: readonly Readonly<Record<string, number>>[];
    readonly uploadBytes: number;
    readonly uploadCount: number;
  }>;
}

export interface ScaleStreamingTerminalReport extends Readonly<Record<string, unknown>> {
  readonly browser: Readonly<{
    readonly executableSha256: string;
    readonly revision: string;
    readonly version: string;
  }> | null;
  readonly build: Readonly<{
    readonly artifactDigest: string;
    readonly releaseDigest: string;
  }> | null;
  readonly cleanup: readonly ScaleStreamingCleanupOutcome[];
  readonly companion: ScaleStreamingCompanionOutcome;
  readonly completedAt: string;
  readonly contract: typeof SCALE_STREAMING_EVIDENCE_CONTRACT;
  readonly corpus: GeneratedScaleStreamingCorpus | null;
  readonly environment: RegisteredEnvironmentIdentity | null;
  readonly evidence: ScaleStreamingPersistedEvidence | null;
  readonly failure: ScaleStreamingFailure | null;
  readonly inputs: Readonly<{
    readonly corpusDocumentPath: string;
    readonly corpusRoot: string;
    readonly machineId: "dev-01";
    readonly tier: "showcase";
  }>;
  readonly phase: "complete";
  readonly postvalidation: Readonly<{
    readonly build: Readonly<{ readonly artifactDigest: string; readonly releaseDigest: string }>;
    readonly source: SourceIdentity;
    readonly target: Readonly<{ readonly artifactDigest: string; readonly releaseDigest: string }>;
  }> | null;
  readonly progress: ScaleStreamingProgress;
  readonly schemaVersion: typeof SCALE_STREAMING_EVIDENCE_SCHEMA_VERSION;
  readonly source: SourceIdentity | null;
  readonly startedAt: string;
  readonly state: "failed" | "passed";
  readonly target: Readonly<{
    readonly artifactDigest: string;
    readonly modelHardLinkBytes: number;
    readonly modelHardLinkCount: number;
    readonly modeled: MaterializedScaleStreamingTarget["modeled"];
    readonly population: MaterializedScaleStreamingTarget["population"];
    readonly releaseDigest: string;
  }> | null;
}

export interface ScaleStreamingEvidenceAuthority {
  readonly artifactDigest: string | null;
  readonly browser: ScaleStreamingTerminalReport["browser"];
  readonly corpus: GeneratedScaleStreamingCorpus | null;
  readonly environment: RegisteredEnvironmentIdentity | null;
  readonly releaseDigest: string | null;
  readonly source: SourceIdentity | null;
  readonly target: MaterializedScaleStreamingTarget | null;
}

export interface ScaleStreamingPendingReport extends Readonly<Record<string, unknown>> {
  readonly contract: typeof SCALE_STREAMING_EVIDENCE_CONTRACT;
  readonly inputs: Readonly<{ readonly machineId: "dev-01"; readonly tier: "showcase" }>;
  readonly phase: "reservation";
  readonly schemaVersion: typeof SCALE_STREAMING_EVIDENCE_SCHEMA_VERSION;
  readonly startedAt: string;
  readonly state: "pending";
}

export type ScaleStreamingOwnedReport = Readonly<{
  ownership: Readonly<{
    failurePhase?: "close" | "json" | "markdown";
    publicationState:
      | "failed"
      | "finalization-failed"
      | "passed"
      | "pending"
      | "reservation-abandoned"
      | "reserved";
    reservationId: string;
    terminalState?: "failed" | "passed";
  }>;
  report: ScaleStreamingPendingReport | ScaleStreamingTerminalReport;
}>;

const TERMINAL_KEYS = Object.freeze([
  "browser",
  "build",
  "cleanup",
  "companion",
  "completedAt",
  "contract",
  "corpus",
  "environment",
  "evidence",
  "failure",
  "inputs",
  "phase",
  "postvalidation",
  "progress",
  "schemaVersion",
  "source",
  "startedAt",
  "state",
  "target",
]);
const CLEANUP_OPERATIONS = Object.freeze([
  "browser-close",
  "target-stop",
  "runtime-profile-remove",
  "environment-profile-remove",
  "materialized-target-remove",
  "generated-corpus-remove",
]);
const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_COMMIT = /^[a-f0-9]{40}$/u;

export function createScaleStreamingPersistedEvidence(
  core: ScaleStreamingRunnerCoreResult,
): ScaleStreamingPersistedEvidence {
  const sample = (value: ScaleStreamingRunnerCoreResult["streaming"]["cellLoadSamples"][number]) =>
    Object.freeze({
      dependencyCount: value.dependencyCount ?? 0,
      dependencyDecodeMs: value.dependencyDecodeMs ?? 0,
      dependencyDecodedBytes: value.dependencyDecodedBytes ?? 0,
      dependencyEncodedBytes: value.dependencyEncodedBytes ?? 0,
      dependencyReadMs: value.dependencyReadMs ?? 0,
      dependencyUploadBytes: value.dependencyUploadBytes ?? 0,
      dependencyUploadMs: value.dependencyUploadMs ?? 0,
    });
  const cache = (
    value: ScaleStreamingRunnerCoreResult["streaming"]["dependencyCache"],
  ): Readonly<Record<string, unknown>> | null =>
    value == null
      ? null
      : Object.freeze({
          acquireCount: value.acquireCount,
          hitCount: value.hitCount,
          liveDecodedBytes: value.liveDecodedBytes,
          liveEncodedBytes: value.liveEncodedBytes,
          liveRefCount: value.liveRefCount,
          liveResourceCount: value.liveResourceCount,
          missCount: value.missCount,
          releaseCount: value.releaseCount,
          resources: Object.freeze(
            (value.resources ?? []).map((resource) =>
              Object.freeze({
                cacheKey: resource.cacheKey,
                format: resource.format,
                ownedBytes: resource.ownedBytes,
                refCount: resource.refCount,
                resourceId: resource.resourceId,
              }),
            ),
          ),
        });
  return Object.freeze({
    authority: core.authority,
    hydration: Object.freeze({
      pipeline: core.hydration,
      samples: Object.freeze(core.hydrationSamples.map(sample)),
    }),
    installLiveness: core.installLiveness,
    modeled: core.modeled,
    population: core.population,
    runtime: core.runtime,
    traversal: Object.freeze({
      batchHighWater: core.streaming.renderBatchCellCountHighWater ?? 0,
      decodeCache: cache(core.streaming.dependencyCache),
      decodeFailureCount: core.streaming.dependencyDecodeFailureCount ?? 0,
      decodeQueueHighWater: core.streaming.decodeQueueDepthHighWater ?? 0,
      decodedBytes: core.streaming.dependencyDecodedBytes ?? 0,
      encodedBytesRead: core.streaming.dependencyEncodedBytesRead ?? 0,
      gpuCache: cache(core.streaming.dependencyGpuCache),
      measurementEvictionCount: core.streaming.measurementProactiveEvictionCount ?? 0,
      p95Ms: core.streaming.cellLoadP95Ms ?? Number.NaN,
      psoWarmupGameplayOverlapCount: core.streaming.psoWarmupGameplayOverlapCount ?? 0,
      readCount: core.streaming.dependencyReadCount ?? 0,
      reuse: core.traversalReuse,
      samples: Object.freeze(core.streaming.measurementCellLoadSamples.map(sample)),
      uploadBytes: core.streaming.dependencyUploadBytes ?? 0,
      uploadCount: core.streaming.dependencyUploadCount ?? 0,
    }),
  });
}

export function validateScaleStreamingTerminalReport(
  input: unknown,
  authority: ScaleStreamingEvidenceAuthority,
): ScaleStreamingTerminalReport {
  exact(input, TERMINAL_KEYS, "Scale-streaming result");
  const report = input as ScaleStreamingTerminalReport;
  if (
    report.contract !== SCALE_STREAMING_EVIDENCE_CONTRACT ||
    report.schemaVersion !== SCALE_STREAMING_EVIDENCE_SCHEMA_VERSION ||
    report.phase !== "complete" ||
    (report.state !== "passed" && report.state !== "failed") ||
    !iso(report.startedAt) ||
    !iso(report.completedAt) ||
    report.inputs.machineId !== "dev-01" ||
    report.inputs.tier !== "showcase"
  ) {
    throw new Error("Scale-streaming result identity is invalid");
  }
  exact(
    report.inputs,
    ["corpusDocumentPath", "corpusRoot", "machineId", "tier"],
    "Scale-streaming inputs",
  );
  if (report.build !== null)
    exact(report.build, ["artifactDigest", "releaseDigest"], "Scale-streaming build");
  if (report.source !== null)
    exact(report.source, ["commit", "dirtyTreeDigest"], "Scale-streaming source");
  if (report.browser !== null) {
    exact(report.browser, ["executableSha256", "revision", "version"], "Scale-streaming browser");
  }
  if (report.target !== null) {
    exact(
      report.target,
      [
        "artifactDigest",
        "modelHardLinkBytes",
        "modelHardLinkCount",
        "modeled",
        "population",
        "releaseDigest",
      ],
      "Scale-streaming target",
    );
  }
  if (report.postvalidation !== null) {
    exact(report.postvalidation, ["build", "source", "target"], "Scale-streaming postvalidation");
    exact(
      report.postvalidation.build,
      ["artifactDigest", "releaseDigest"],
      "Scale-streaming postvalidation build",
    );
    exact(
      report.postvalidation.source,
      ["commit", "dirtyTreeDigest"],
      "Scale-streaming postvalidation source",
    );
    exact(
      report.postvalidation.target,
      ["artifactDigest", "releaseDigest"],
      "Scale-streaming postvalidation target",
    );
  }
  if (
    (report.build !== null &&
      (!SHA256.test(report.build.artifactDigest) || !SHA256.test(report.build.releaseDigest))) ||
    (report.source !== null &&
      (!GIT_COMMIT.test(report.source.commit) ||
        (report.source.dirtyTreeDigest !== null && !SHA256.test(report.source.dirtyTreeDigest)))) ||
    (report.browser !== null &&
      (!SHA256.test(report.browser.executableSha256) ||
        report.browser.revision.length === 0 ||
        report.browser.version.length === 0))
  ) {
    throw new Error("Scale-streaming build/source/browser identity is malformed");
  }
  if (report.corpus !== null) parseGeneratedScaleStreamingCorpus(report.corpus);
  const expectedTarget =
    authority.target === null
      ? null
      : {
          artifactDigest: authority.target.artifactDigest,
          modelHardLinkBytes: authority.target.modelHardLinkBytes,
          modelHardLinkCount: authority.target.modelHardLinkCount,
          modeled: authority.target.modeled,
          population: authority.target.population,
          releaseDigest: authority.target.releaseDigest,
        };
  if (
    report.state === "passed" &&
    (report.build === null ||
      report.source === null ||
      report.browser === null ||
      report.environment === null ||
      report.corpus === null ||
      report.target === null ||
      report.postvalidation === null)
  ) {
    throw new Error("Passing scale-streaming result lacks exact authority");
  }
  if (
    !isDeepStrictEqual(
      report.build,
      authority.artifactDigest === null || authority.releaseDigest === null
        ? null
        : { artifactDigest: authority.artifactDigest, releaseDigest: authority.releaseDigest },
    ) ||
    !isDeepStrictEqual(report.browser, authority.browser) ||
    !isDeepStrictEqual(report.source, authority.source) ||
    !isDeepStrictEqual(report.environment, authority.environment) ||
    !isDeepStrictEqual(report.corpus, authority.corpus) ||
    !isDeepStrictEqual(report.target, expectedTarget) ||
    (report.postvalidation !== null &&
      (report.build === null ||
        report.source === null ||
        report.target === null ||
        !isDeepStrictEqual(report.postvalidation.build, report.build) ||
        !isDeepStrictEqual(report.postvalidation.source, report.source) ||
        report.postvalidation.target.artifactDigest !== report.target.artifactDigest ||
        report.postvalidation.target.releaseDigest !== report.target.releaseDigest))
  ) {
    throw new Error("Scale-streaming result does not match exact current authority");
  }
  if (
    report.target !== null &&
    report.corpus !== null &&
    !isDeepStrictEqual(report.target.modeled, createScaleStreamingManifestModel(report.corpus))
  ) {
    throw new Error("Scale-streaming virtual modeled population is not canonical");
  }
  if (
    report.environment !== null &&
    (report.environment.machineId !== "dev-01" ||
      report.environment.requestedTier !== "showcase" ||
      !report.environment.sandboxVerified ||
      report.environment.gateIdentity.state !== "measured" ||
      report.browser === null ||
      report.environment.executableSha256 !== report.browser.executableSha256 ||
      report.environment.browserRevision !== report.browser.revision)
  ) {
    throw new Error("Scale-streaming registered physical environment is invalid");
  }
  if (!Array.isArray(report.cleanup) || report.cleanup.length === 0) {
    throw new Error("Scale-streaming result lacks cleanup evidence");
  }
  for (const outcome of report.cleanup) validateOutcome(outcome);
  validateCompanion(report.companion);
  validateProgress(report);
  if (report.state === "passed") {
    if (
      report.failure !== null ||
      report.evidence === null ||
      report.cleanup.some(({ state }) => state !== "passed")
    ) {
      throw new Error("Passing scale-streaming result is incomplete");
    }
    if (
      report.cleanup.length !== CLEANUP_OPERATIONS.length ||
      report.cleanup.some(({ operation }, index) => operation !== CLEANUP_OPERATIONS[index])
    ) {
      throw new Error("Passing scale-streaming result lacks exact cleanup coverage");
    }
    if (authority.target === null) throw new Error("Passing result lacks target authority");
    validateCoreEvidence(report.evidence, authority.target);
  } else {
    if (report.failure === null) {
      throw new Error("Failed scale-streaming result lacks a bounded sanitized cause");
    }
    exact(report.failure, ["message", "phase"], "Scale-streaming failure");
    if (!sanitized(report.failure.message)) {
      throw new Error("Failed scale-streaming result lacks a bounded sanitized cause");
    }
  }
  return report;
}

export function validateScaleStreamingPendingReport(input: unknown): ScaleStreamingPendingReport {
  exact(
    input,
    ["contract", "inputs", "phase", "schemaVersion", "startedAt", "state"],
    "Scale-streaming pending result",
  );
  const report = input as ScaleStreamingPendingReport;
  exact(report.inputs, ["machineId", "tier"], "Scale-streaming pending inputs");
  if (
    report.contract !== SCALE_STREAMING_EVIDENCE_CONTRACT ||
    report.schemaVersion !== SCALE_STREAMING_EVIDENCE_SCHEMA_VERSION ||
    report.phase !== "reservation" ||
    report.state !== "pending" ||
    report.inputs.machineId !== "dev-01" ||
    report.inputs.tier !== "showcase" ||
    !iso(report.startedAt)
  ) {
    throw new Error("Scale-streaming pending result identity is invalid");
  }
  return report;
}

export function validateScaleStreamingOwnedReport(
  input: unknown,
  authority: ScaleStreamingEvidenceAuthority,
  expectedMarkdownPath?: string,
): ScaleStreamingOwnedReport {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Owned scale-streaming result must be an object");
  }
  const owned = input as Record<string, unknown>;
  const reservationId = owned.resultReservationId;
  const ownership = owned.resultOwnership;
  if (
    typeof reservationId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(reservationId)
  ) {
    throw new Error("Scale-streaming result reservation identity is invalid");
  }
  if (typeof ownership !== "object" || ownership === null || Array.isArray(ownership)) {
    throw new Error("Scale-streaming result ownership is invalid");
  }
  const ownershipRecord = ownership as Record<string, unknown>;
  const publicationState = ownershipRecord.publicationState;
  const terminalFailure = publicationState === "finalization-failed";
  exact(
    ownershipRecord,
    terminalFailure
      ? ["failurePhase", "publicationState", "reservationId", "terminalState"]
      : ["publicationState", "reservationId"],
    "Scale-streaming result ownership",
  );
  if (
    ownershipRecord.reservationId !== reservationId ||
    ![
      "failed",
      "finalization-failed",
      "passed",
      "pending",
      "reservation-abandoned",
      "reserved",
    ].includes(String(publicationState)) ||
    (terminalFailure &&
      ((ownershipRecord.failurePhase !== "close" &&
        ownershipRecord.failurePhase !== "json" &&
        ownershipRecord.failurePhase !== "markdown") ||
        (ownershipRecord.terminalState !== "failed" && ownershipRecord.terminalState !== "passed")))
  ) {
    throw new Error("Scale-streaming result ownership is contradictory");
  }
  const normalized = { ...owned };
  delete normalized.resultOwnership;
  delete normalized.resultReservationId;
  const report =
    normalized.state === "pending"
      ? validateScaleStreamingPendingReport(normalized)
      : validateScaleStreamingTerminalReport(normalized, authority);
  if (
    (report.state === "pending"
      ? publicationState !== "reserved" &&
        publicationState !== "pending" &&
        publicationState !== "reservation-abandoned" &&
        publicationState !== "finalization-failed"
      : publicationState !== report.state) ||
    (report.state !== "pending" &&
      expectedMarkdownPath !== undefined &&
      report.companion.path !== expectedMarkdownPath)
  ) {
    throw new Error("Scale-streaming result ownership does not bind its normalized report");
  }
  return Object.freeze({
    ownership: ownershipRecord as ScaleStreamingOwnedReport["ownership"],
    report,
  });
}

function validateCoreEvidence(
  evidence: ScaleStreamingPersistedEvidence,
  target: MaterializedScaleStreamingTarget,
): void {
  exact(
    evidence,
    ["authority", "hydration", "installLiveness", "modeled", "population", "runtime", "traversal"],
    "Scale-streaming evidence",
  );
  exact(
    evidence.authority,
    [
      "launchEnabled",
      "durabilityClaimed",
      "persistence",
      "persistenceWarning",
      "releaseDigest",
      "shellGenerationId",
      "state",
    ],
    "Scale-streaming installer authority",
  );
  exact(evidence.hydration, ["pipeline", "samples"], "Scale-streaming hydration");
  exact(
    evidence.hydration.pipeline,
    [
      "decodeCacheMissCount",
      "decodeQueueDepthHighWater",
      "decodeWorkerCount",
      "decodedBytes",
      "encodedBytesRead",
      "gpuCacheMissCount",
      "psoWarmupGameplayOverlapCount",
      "readCount",
      "renderBatchCellCountHighWater",
      "uploadBytes",
      "uploadCount",
    ],
    "Scale-streaming hydration pipeline",
  );
  exact(
    evidence.runtime,
    [
      "activeReleaseDigest",
      "activeShellGenerationId",
      "installedModelBytes",
      "installedModelCount",
      "installedStreamingBytes",
      "installedStreamingCount",
    ],
    "Scale-streaming runtime authority",
  );
  exact(
    evidence.traversal,
    [
      "batchHighWater",
      "decodeCache",
      "decodeFailureCount",
      "decodeQueueHighWater",
      "decodedBytes",
      "encodedBytesRead",
      "gpuCache",
      "measurementEvictionCount",
      "p95Ms",
      "psoWarmupGameplayOverlapCount",
      "readCount",
      "reuse",
      "samples",
      "uploadBytes",
      "uploadCount",
    ],
    "Scale-streaming traversal",
  );
  exact(
    evidence.traversal.reuse,
    [
      "decodeAcquireDelta",
      "decodeHitDelta",
      "decodeMissDelta",
      "decodeReleaseDelta",
      "gpuAcquireDelta",
      "gpuHitDelta",
      "gpuMissDelta",
      "gpuReleaseDelta",
      "psoWarmupGameplayOverlapCount",
    ],
    "Scale-streaming traversal reuse",
  );
  validateLiveness(evidence, target);
  validatePopulation(evidence, target);
  for (const sample of evidence.hydration.samples) validatePipelineSample(sample, "hydration");
  for (const sample of evidence.traversal.samples) validatePipelineSample(sample, "traversal");
  const decodeCache = validateCache(
    evidence.traversal.decodeCache,
    "decode",
    target.expectedStreamingResourceCacheKeys,
  );
  const gpuCache = validateCache(
    evidence.traversal.gpuCache,
    "gpu",
    target.expectedStreamingResourceCacheKeys,
  );
  validateCacheCorrelation(decodeCache, gpuCache);
  const hydrationTotals = sumSamples(
    evidence.hydration.samples.filter(({ dependencyCount }) => positiveInteger(dependencyCount)),
  );
  const traversalTotals = sumSamples(evidence.traversal.samples);
  const hydrationPipelineScalarsValid = [
    evidence.hydration.pipeline.decodeCacheMissCount,
    evidence.hydration.pipeline.decodedBytes,
    evidence.hydration.pipeline.encodedBytesRead,
    evidence.hydration.pipeline.gpuCacheMissCount,
    evidence.hydration.pipeline.readCount,
    evidence.hydration.pipeline.uploadBytes,
    evidence.hydration.pipeline.uploadCount,
  ].every(positiveInteger);
  const hydrationTopologyValid =
    positiveInteger(evidence.hydration.pipeline.decodeWorkerCount) &&
    evidence.hydration.pipeline.decodeWorkerCount <= STREAMING_DECODE_WORKER_MAXIMUM &&
    positiveInteger(evidence.hydration.pipeline.decodeQueueDepthHighWater) &&
    evidence.hydration.pipeline.decodeQueueDepthHighWater >=
      evidence.hydration.pipeline.decodeWorkerCount &&
    evidence.hydration.pipeline.decodeQueueDepthHighWater <= STREAMING_RESIDENT_CELL_LIMIT &&
    positiveInteger(evidence.hydration.pipeline.renderBatchCellCountHighWater) &&
    evidence.hydration.pipeline.renderBatchCellCountHighWater > 1 &&
    evidence.hydration.pipeline.renderBatchCellCountHighWater <= STREAMING_RESIDENT_CELL_LIMIT;
  const traversalReuseScalarsValid =
    [
      evidence.traversal.reuse.decodeAcquireDelta,
      evidence.traversal.reuse.decodeHitDelta,
      evidence.traversal.reuse.decodeReleaseDelta,
      evidence.traversal.reuse.gpuAcquireDelta,
      evidence.traversal.reuse.gpuHitDelta,
      evidence.traversal.reuse.gpuReleaseDelta,
    ].every(positiveInteger) &&
    nonNegativeInteger(evidence.traversal.reuse.decodeMissDelta) &&
    nonNegativeInteger(evidence.traversal.reuse.gpuMissDelta);
  const traversalScalarsValid =
    [
      evidence.traversal.decodedBytes,
      evidence.traversal.encodedBytesRead,
      evidence.traversal.measurementEvictionCount,
      evidence.traversal.readCount,
      evidence.traversal.uploadBytes,
      evidence.traversal.uploadCount,
    ].every(positiveInteger) &&
    positiveInteger(evidence.traversal.decodeQueueHighWater) &&
    evidence.traversal.decodeQueueHighWater <= STREAMING_RESIDENT_CELL_LIMIT &&
    Number.isSafeInteger(evidence.traversal.batchHighWater) &&
    evidence.traversal.batchHighWater > 1 &&
    evidence.traversal.batchHighWater <= STREAMING_RESIDENT_CELL_LIMIT;
  if (
    !isDeepStrictEqual(evidence.modeled, target.modeled) ||
    !isDeepStrictEqual(evidence.population, target.population) ||
    evidence.authority.releaseDigest !== target.releaseDigest ||
    evidence.authority.state !== "ready" ||
    !evidence.authority.launchEnabled ||
    evidence.authority.persistence === null ||
    (evidence.authority.persistence !== "granted" && evidence.authority.persistence !== "denied") ||
    (evidence.authority.persistence === "granted"
      ? !evidence.authority.durabilityClaimed || evidence.authority.persistenceWarning !== null
      : evidence.authority.durabilityClaimed ||
        evidence.authority.persistenceWarning !== DEGRADED_DURABILITY_WARNING) ||
    evidence.authority.shellGenerationId !== `${target.artifactDigest}:${target.releaseDigest}` ||
    evidence.runtime.activeReleaseDigest !== target.releaseDigest ||
    evidence.runtime.activeShellGenerationId !== evidence.authority.shellGenerationId ||
    evidence.runtime.installedModelBytes !== APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES ||
    evidence.runtime.installedModelCount !== APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.length ||
    evidence.runtime.installedStreamingBytes !== target.population.representativeBytes ||
    evidence.runtime.installedStreamingCount !== target.population.representativeResourceCount ||
    !hydrationPipelineScalarsValid ||
    !hydrationTopologyValid ||
    evidence.hydration.pipeline.readCount !== evidence.hydration.pipeline.decodeCacheMissCount ||
    evidence.hydration.pipeline.uploadCount !== evidence.hydration.pipeline.gpuCacheMissCount ||
    evidence.hydration.pipeline.psoWarmupGameplayOverlapCount !== 0 ||
    evidence.hydration.samples.length === 0 ||
    evidence.hydration.samples.length > SCALE_STREAMING_INITIAL_SAMPLE_LIMIT ||
    hydrationTotals.encodedBytes !== evidence.hydration.pipeline.encodedBytesRead ||
    hydrationTotals.decodedBytes !== evidence.hydration.pipeline.decodedBytes ||
    hydrationTotals.uploadBytes !== evidence.hydration.pipeline.uploadBytes ||
    evidence.traversal.samples.length < STREAMING_MEASUREMENT_SAMPLE_MINIMUM ||
    evidence.traversal.samples.length > SCALE_STREAMING_INITIAL_SAMPLE_LIMIT ||
    !traversalReuseScalarsValid ||
    traversalTotals.dependencyCount !== evidence.traversal.reuse.decodeAcquireDelta ||
    traversalTotals.dependencyCount !== evidence.traversal.reuse.gpuAcquireDelta ||
    evidence.traversal.encodedBytesRead - evidence.hydration.pipeline.encodedBytesRead !==
      traversalTotals.encodedBytes ||
    evidence.traversal.decodedBytes - evidence.hydration.pipeline.decodedBytes !==
      traversalTotals.decodedBytes ||
    evidence.traversal.uploadBytes - evidence.hydration.pipeline.uploadBytes !==
      traversalTotals.uploadBytes ||
    evidence.traversal.reuse.decodeAcquireDelta !==
      evidence.traversal.reuse.decodeHitDelta + evidence.traversal.reuse.decodeMissDelta ||
    evidence.traversal.reuse.gpuAcquireDelta !==
      evidence.traversal.reuse.gpuHitDelta + evidence.traversal.reuse.gpuMissDelta ||
    evidence.traversal.reuse.decodeReleaseDelta !== evidence.traversal.reuse.decodeAcquireDelta ||
    evidence.traversal.reuse.gpuReleaseDelta !== evidence.traversal.reuse.gpuAcquireDelta ||
    evidence.traversal.reuse.psoWarmupGameplayOverlapCount !== 0 ||
    !finiteRange(evidence.traversal.p95Ms, 0, STREAMING_CELL_LOAD_BUDGET_MS) ||
    evidence.traversal.decodeFailureCount !== 0 ||
    !traversalScalarsValid ||
    evidence.traversal.psoWarmupGameplayOverlapCount !== 0 ||
    evidence.traversal.readCount !==
      evidence.hydration.pipeline.readCount + evidence.traversal.reuse.decodeMissDelta ||
    evidence.traversal.uploadCount !==
      evidence.hydration.pipeline.uploadCount + evidence.traversal.reuse.gpuMissDelta ||
    decodeCache.acquireCount < evidence.traversal.reuse.decodeAcquireDelta ||
    decodeCache.hitCount < evidence.traversal.reuse.decodeHitDelta ||
    decodeCache.missCount !==
      evidence.hydration.pipeline.decodeCacheMissCount + evidence.traversal.reuse.decodeMissDelta ||
    decodeCache.releaseCount < evidence.traversal.reuse.decodeReleaseDelta ||
    gpuCache.acquireCount < evidence.traversal.reuse.gpuAcquireDelta ||
    gpuCache.hitCount < evidence.traversal.reuse.gpuHitDelta ||
    gpuCache.missCount !==
      evidence.hydration.pipeline.gpuCacheMissCount + evidence.traversal.reuse.gpuMissDelta ||
    gpuCache.releaseCount < evidence.traversal.reuse.gpuReleaseDelta
  ) {
    throw new Error("Scale-streaming runtime evidence is contradictory or incomplete");
  }
}

function sumSamples(samples: readonly Readonly<Record<string, number>>[]) {
  return samples.reduce<{
    decodedBytes: number;
    dependencyCount: number;
    encodedBytes: number;
    uploadBytes: number;
  }>(
    (sum, sample) => ({
      decodedBytes: sum.decodedBytes + (sample.dependencyDecodedBytes ?? 0),
      dependencyCount: sum.dependencyCount + (sample.dependencyCount ?? 0),
      encodedBytes: sum.encodedBytes + (sample.dependencyEncodedBytes ?? 0),
      uploadBytes: sum.uploadBytes + (sample.dependencyUploadBytes ?? 0),
    }),
    { decodedBytes: 0, dependencyCount: 0, encodedBytes: 0, uploadBytes: 0 },
  );
}

function validateLiveness(
  evidence: ScaleStreamingPersistedEvidence,
  target: MaterializedScaleStreamingTarget,
): void {
  exact(
    evidence.installLiveness,
    [
      "absoluteTimeoutMs",
      "lastProgressAtMs",
      "lastProgressGapMs",
      "lastProgressTuple",
      "maxProgressGapMs",
      "pollIntervalMs",
      "stallTimeoutMs",
      "startedAtMs",
      "terminalCause",
      "timeoutClassification",
    ],
    "Scale-streaming install liveness",
  );
  const tuple = evidence.installLiveness.lastProgressTuple;
  exact(
    tuple,
    [
      "checkpointedBytes",
      "completedResourceCount",
      "downloadedBytes",
      "finalVerificationBytes",
      "finalVerificationPhase",
      "finalVerificationResourceCount",
      "finalVerificationTotalBytes",
      "finalVerificationTotalResourceCount",
      "verifiedBytes",
    ],
    "Scale-streaming install progress",
  );
  if (
    evidence.installLiveness.absoluteTimeoutMs !== PROGRESS_LIVENESS_ABSOLUTE_TIMEOUT_MS ||
    evidence.installLiveness.pollIntervalMs !== PROGRESS_LIVENESS_POLL_INTERVAL_MS ||
    evidence.installLiveness.stallTimeoutMs !== PROGRESS_LIVENESS_STALL_TIMEOUT_MS ||
    !nonNegativeInteger(evidence.installLiveness.startedAtMs) ||
    !nonNegativeInteger(evidence.installLiveness.lastProgressAtMs) ||
    evidence.installLiveness.lastProgressAtMs < evidence.installLiveness.startedAtMs ||
    !nonNegativeInteger(evidence.installLiveness.lastProgressGapMs) ||
    !nonNegativeInteger(evidence.installLiveness.maxProgressGapMs) ||
    evidence.installLiveness.maxProgressGapMs < evidence.installLiveness.lastProgressGapMs ||
    tuple.finalVerificationPhase !== "complete" ||
    tuple.checkpointedBytes !== target.population.installBytes ||
    tuple.downloadedBytes !== target.population.installBytes ||
    tuple.verifiedBytes !== target.population.installBytes ||
    tuple.finalVerificationBytes !== target.population.installBytes ||
    tuple.finalVerificationTotalBytes !== target.population.installBytes ||
    tuple.finalVerificationResourceCount !== target.population.installResourceCount ||
    tuple.finalVerificationTotalResourceCount !== target.population.installResourceCount ||
    tuple.completedResourceCount !== target.population.installResourceCount ||
    evidence.installLiveness.terminalCause !== null ||
    evidence.installLiveness.timeoutClassification !== null
  ) {
    throw new Error("Scale-streaming installer liveness is incomplete");
  }
}

function validatePopulation(
  evidence: ScaleStreamingPersistedEvidence,
  target: MaterializedScaleStreamingTarget,
): void {
  exact(
    evidence.population,
    [
      "dependencyBytes",
      "dependencyCount",
      "districtCellBytes",
      "districtCellCount",
      "districtIndexBytes",
      "installBytes",
      "installResourceCount",
      "representativeBytes",
      "representativeResourceCount",
    ],
    "Scale-streaming materialized population",
  );
  exact(
    evidence.modeled,
    [
      "cellCount",
      "cellIdentitySha256",
      "cellModeledBytes",
      "cellModeledResourceCount",
      "dependencyAssignmentSha256",
      "dependencyGraphCount",
      "dependencyIdentitySha256",
      "dependencyModeledBytes",
      "dependencyModeledResourceCount",
      "dependencyReusePerGraph",
      "exactModeledBytes",
      "exactModeledResourceCount",
      "manifestIdentitySha256",
      "materializedBytes",
      "materializedResources",
      "minimumClassBytes",
      "sizeBuckets",
    ],
    "Scale-streaming modeled population",
  );
  for (const bucket of evidence.modeled.sizeBuckets) {
    exact(bucket, ["bytes", "count"], "Scale-streaming modeled size bucket");
    if (!positiveInteger(bucket.bytes) || !positiveInteger(bucket.count)) {
      throw new Error("Scale-streaming modeled size bucket is invalid");
    }
  }
  if (
    !isDeepStrictEqual(evidence.modeled, target.modeled) ||
    !isDeepStrictEqual(evidence.population, target.population) ||
    evidence.modeled.exactModeledBytes < evidence.modeled.minimumClassBytes ||
    evidence.modeled.materializedBytes !== 0 ||
    evidence.modeled.materializedResources !== 0 ||
    !SHA256.test(evidence.modeled.cellIdentitySha256) ||
    !SHA256.test(evidence.modeled.dependencyAssignmentSha256) ||
    !SHA256.test(evidence.modeled.dependencyIdentitySha256) ||
    !SHA256.test(evidence.modeled.manifestIdentitySha256)
  ) {
    throw new Error("Scale-streaming modeled/materialized populations are invalid");
  }
}

function validatePipelineSample(
  sample: Readonly<Record<string, number>>,
  phase: ScaleStreamingPipelineSamplePhase,
): void {
  exact(
    sample,
    [
      "dependencyCount",
      "dependencyDecodeMs",
      "dependencyDecodedBytes",
      "dependencyEncodedBytes",
      "dependencyReadMs",
      "dependencyUploadBytes",
      "dependencyUploadMs",
    ],
    "Scale-streaming pipeline sample",
  );
  if (!validScaleStreamingPipelineSample(sample, phase)) {
    throw new Error("Scale-streaming pipeline sample is invalid");
  }
}

function validateCache(
  input: Readonly<Record<string, unknown>> | null,
  cacheKind: ScaleStreamingCacheKind,
  expectedCacheKeys: Readonly<Record<string, string>>,
) {
  const label = cacheKind === "decode" ? "decode" : "GPU";
  exact(
    input,
    [
      "acquireCount",
      "hitCount",
      "liveDecodedBytes",
      "liveEncodedBytes",
      "liveRefCount",
      "liveResourceCount",
      "missCount",
      "releaseCount",
      "resources",
    ],
    `Scale-streaming ${label} cache`,
  );
  const cache = input as {
    acquireCount: number;
    hitCount: number;
    liveDecodedBytes: number;
    liveEncodedBytes: number;
    liveRefCount: number;
    liveResourceCount: number;
    missCount: number;
    releaseCount: number;
    resources: readonly Readonly<Record<string, unknown>>[];
  };
  let refCount = 0;
  let ownedBytes = 0;
  const resourceIds = new Set<string>();
  for (const resource of cache.resources) {
    exact(
      resource,
      ["cacheKey", "format", "ownedBytes", "refCount", "resourceId"],
      `${label} cache resource`,
    );
    if (
      (resource.format !== "meshopt" && resource.format !== "ktx2") ||
      typeof resource.cacheKey !== "string" ||
      !canonicalCacheKey(resource.cacheKey) ||
      typeof resource.resourceId !== "string" ||
      !canonicalResourceIdentity(resource.resourceId) ||
      !Object.hasOwn(expectedCacheKeys, resource.resourceId) ||
      resource.cacheKey !== expectedCacheKeys[resource.resourceId] ||
      resourceIds.has(resource.resourceId) ||
      !validScaleStreamingResourceOwnedBytes(resource.ownedBytes, cacheKind) ||
      !positiveInteger(resource.refCount)
    ) {
      throw new Error(`Scale-streaming ${label} cache resource is invalid`);
    }
    resourceIds.add(resource.resourceId as string);
    refCount += resource.refCount as number;
    ownedBytes += resource.ownedBytes as number;
  }
  if (
    ![
      cache.acquireCount,
      cache.hitCount,
      cache.missCount,
      cache.releaseCount,
      cache.liveRefCount,
      cache.liveResourceCount,
      cache.liveDecodedBytes,
      cache.liveEncodedBytes,
    ].every(nonNegativeInteger) ||
    cache.acquireCount !== cache.hitCount + cache.missCount ||
    cache.acquireCount - cache.releaseCount !== cache.liveRefCount ||
    cache.liveRefCount !== refCount ||
    cache.liveResourceCount !== cache.resources.length ||
    cache.liveEncodedBytes + cache.liveDecodedBytes !== ownedBytes ||
    (cacheKind === "decode" && (cache.liveEncodedBytes !== 0 || cache.liveDecodedBytes !== 0)) ||
    new Set(cache.resources.map((resource) => resource.cacheKey)).size !== cache.resources.length ||
    new Set(cache.resources.map((resource) => resource.format)).size !== 2
  ) {
    throw new Error(`Scale-streaming ${label} cache accounting is contradictory`);
  }
  return cache;
}

function canonicalCacheKey(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    !value.split("/").includes("..") &&
    ![...value].some((character) => character.charCodeAt(0) <= 0x1f)
  );
}

function validateCacheCorrelation(
  decode: ReturnType<typeof validateCache>,
  gpu: ReturnType<typeof validateCache>,
): void {
  if (
    decode.acquireCount !== gpu.acquireCount ||
    decode.hitCount !== gpu.hitCount ||
    decode.liveRefCount !== gpu.liveRefCount ||
    decode.liveResourceCount !== gpu.liveResourceCount ||
    decode.missCount !== gpu.missCount ||
    decode.releaseCount !== gpu.releaseCount ||
    decode.resources.some((resource, index) => {
      const gpuResource = gpu.resources[index];
      return (
        gpuResource === undefined ||
        resource.cacheKey !== gpuResource.cacheKey ||
        resource.format !== gpuResource.format ||
        resource.refCount !== gpuResource.refCount ||
        resource.resourceId !== gpuResource.resourceId
      );
    })
  ) {
    throw new Error("Scale-streaming decode/GPU cache correlation is contradictory");
  }
}

function canonicalResourceIdentity(value: string): boolean {
  return (
    value.length <= 512 &&
    value.length > 0 &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    !value.split("/").includes("..") &&
    ![...value].some((character) => character.charCodeAt(0) <= 0x1f)
  );
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function finiteRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

export function sanitizeScaleStreamingCause(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const printable = [...raw]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f ? " " : character;
    })
    .join("");
  const sanitized = printable
    .replaceAll(/https?:\/\/\S+/giu, "[url]")
    .replaceAll(/[A-Za-z]:\\[^ ]+/gu, "[path]")
    .replaceAll(/\/(?:[^ /]+\/)+[^ ]*/gu, "[path]")
    .replaceAll(/\s+/gu, " ")
    .trim();
  return (sanitized || "Unclassified scale-streaming failure").slice(0, 240);
}

function validateOutcome(input: ScaleStreamingCleanupOutcome): void {
  exact(input, ["message", "operation", "state"], "Scale-streaming cleanup outcome");
  if (
    input.operation.length === 0 ||
    (input.state !== "passed" && input.state !== "failed") ||
    (input.state === "passed" ? input.message !== null : !sanitized(input.message))
  ) {
    throw new Error("Scale-streaming cleanup outcome is invalid");
  }
}

function validateCompanion(input: ScaleStreamingCompanionOutcome): void {
  exact(input, ["path", "state"], "Scale-streaming companion outcome");
  if (input.path.length === 0 || input.state !== "requested") {
    throw new Error("Scale-streaming companion outcome is invalid");
  }
}

function validateProgress(report: ScaleStreamingTerminalReport): void {
  exact(
    report.progress,
    ["cleanup", "environment", "materialization", "postvalidation", "runtime", "validation"],
    "Scale-streaming progress",
  );
  const ordered = [
    report.progress.validation,
    report.progress.materialization,
    report.progress.environment,
    report.progress.runtime,
    report.progress.postvalidation,
  ];
  if (
    ordered.some((value) => typeof value !== "boolean") ||
    typeof report.progress.cleanup !== "boolean" ||
    !report.progress.cleanup ||
    ordered.some((value, index) => value && ordered.slice(0, index).some((prior) => !prior))
  ) {
    throw new Error("Scale-streaming phase progress is contradictory");
  }
  if (report.state === "passed" && ordered.some((value) => !value)) {
    throw new Error("Passing scale-streaming result has incomplete phase progress");
  }
  if (
    (report.progress.validation &&
      (report.build === null || report.source === null || report.corpus === null)) ||
    (!report.progress.validation &&
      (report.target !== null ||
        report.browser !== null ||
        report.environment !== null ||
        report.evidence !== null ||
        report.postvalidation !== null)) ||
    (report.progress.materialization && report.target === null) ||
    (!report.progress.materialization &&
      (report.browser !== null ||
        report.environment !== null ||
        report.evidence !== null ||
        report.postvalidation !== null)) ||
    (report.progress.environment && (report.browser === null || report.environment === null)) ||
    (!report.progress.environment &&
      (report.evidence !== null || report.postvalidation !== null)) ||
    (report.progress.runtime && report.evidence === null) ||
    (!report.progress.runtime && report.postvalidation !== null) ||
    (report.progress.postvalidation && report.postvalidation === null)
  ) {
    throw new Error("Scale-streaming identities contradict completed phase progress");
  }
  if (report.state === "failed" && report.failure !== null) {
    const matches =
      (report.failure.phase === "validation" && !report.progress.validation) ||
      (report.failure.phase === "materialization" &&
        report.progress.validation &&
        !report.progress.materialization) ||
      (report.failure.phase === "environment" &&
        report.progress.materialization &&
        !report.progress.environment) ||
      (report.failure.phase === "runtime" &&
        report.progress.environment &&
        !report.progress.runtime) ||
      (report.failure.phase === "postvalidation" &&
        report.progress.runtime &&
        !report.progress.postvalidation) ||
      (report.failure.phase === "cleanup" &&
        report.progress.postvalidation &&
        report.cleanup.some(({ state }) => state === "failed"));
    if (!matches) throw new Error("Scale-streaming failure phase contradicts completed progress");
  }
}

function exact(input: unknown, keys: readonly string[], label: string): asserts input is object {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(input).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has unsupported or missing keys`);
  }
}

function iso(value: string): boolean {
  return typeof value === "string" && new Date(value).toISOString() === value;
}

function sanitized(value: string | null): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 240 &&
    sanitizeScaleStreamingCause(value) === value
  );
}
