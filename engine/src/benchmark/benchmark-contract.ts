import type { FlythroughScenario } from "../flythrough/flythrough-contract";
import type { FlythroughTelemetrySnapshot } from "../flythrough/flythrough-service";
import type { RenderDistributionTelemetry } from "../render/render-protocol";
import type { RenderPixelSize } from "../render/render-service";

export const BENCHMARK_RESULT_SCHEMA_VERSION = 6;
export const BENCHMARK_TELEMETRY_SCHEMA_VERSION = 5;
export const BENCHMARK_RESULT_CONTRACT = "benchmark-result@1";
export const BENCHMARK_REPEAT_RELATIVE_RANGE_LIMIT = 0.1;

export type BenchmarkMetric<T> =
  | Readonly<{ readonly state: "measured"; readonly value: T }>
  | Readonly<{ readonly reason: string; readonly state: "unsupported" }>
  | Readonly<{ readonly reason: string; readonly state: "invalid" }>
  | Readonly<{ readonly reason: string; readonly state: "not-applicable" }>;

export interface BenchmarkQualityPreset {
  readonly expectedReferenceMachineId: string | null;
  readonly id: string;
  readonly qualityVersion: string;
  readonly renderSize: RenderPixelSize;
  readonly targetRefreshRateHz: number;
  readonly tier: "showcase" | "standard";
}

export interface BenchmarkDefinition {
  readonly id: string;
  readonly qualityPresets: readonly BenchmarkQualityPreset[];
  readonly repeatCount: 3;
  readonly scenario: FlythroughScenario;
  readonly worldSeed: number;
}

export interface BenchmarkBrowserIdentity {
  readonly engine: string;
  readonly fullVersionList: readonly Readonly<{
    readonly brand: string;
    readonly version: string;
  }>[];
  readonly mobile: boolean | null;
  readonly name: string;
  readonly platform: string | null;
  readonly platformVersion: string | null;
  readonly userAgent: string;
  readonly version: string | null;
}

export interface BenchmarkGpuAdapterIdentity {
  readonly architecture: string;
  readonly description: string;
  readonly device: string;
  readonly isFallbackAdapter: boolean;
  readonly source: "window-request-adapter";
  readonly vendor: string;
}

export interface BenchmarkScreenIdentity {
  readonly availableCssPixels: Readonly<{ readonly height: number; readonly width: number }>;
  readonly colorDepth: number;
  readonly cssPixels: Readonly<{ readonly height: number; readonly width: number }>;
  readonly devicePixelRatio: number;
  readonly orientation: Readonly<{ readonly angle: number; readonly type: string }>;
  readonly physicalPixelEstimate: Readonly<{ readonly height: number; readonly width: number }>;
  readonly viewportCssPixels: Readonly<{ readonly height: number; readonly width: number }>;
}

export interface BenchmarkCapability {
  readonly id:
    | "cross-origin-isolated"
    | "offscreen-canvas"
    | "opfs"
    | "shared-array-buffer"
    | "wasm-simd"
    | "wasm-threads"
    | "webgpu"
    | "window-long-tasks";
  readonly state: "available" | "unavailable";
}

export interface BenchmarkEnvironmentIdentity {
  readonly artifactDigest: BenchmarkMetric<string>;
  readonly browser: BenchmarkBrowserIdentity;
  readonly capabilities: readonly BenchmarkCapability[];
  readonly gpuAdapter: BenchmarkMetric<BenchmarkGpuAdapterIdentity>;
  readonly hardwareConcurrency: number;
  readonly hostIdentity: BenchmarkMetric<never>;
  readonly powerAndSessionState: BenchmarkMetric<never>;
  readonly referenceEligibility: BenchmarkMetric<true>;
  readonly releaseDigest: BenchmarkMetric<string>;
  readonly screen: BenchmarkScreenIdentity;
}

export interface BenchmarkAttemptMetrics {
  readonly allRealmJsHeapHighWaterBytes: BenchmarkMetric<number>;
  readonly attributableGpuMemoryHighWaterBytes: BenchmarkMetric<number>;
  readonly dawnPipelineActivity: BenchmarkMetric<number>;
  readonly mainThreadLongTasksOver50Ms: BenchmarkMetric<number>;
  readonly presentationIntervalMs: BenchmarkMetric<RenderDistributionTelemetry>;
  readonly renderWorkerCallbackIntervalMs: BenchmarkMetric<RenderDistributionTelemetry>;
  readonly renderWorkerRenderDurationMs: BenchmarkMetric<RenderDistributionTelemetry>;
  readonly streamingCellLoadP95Ms: BenchmarkMetric<number>;
  readonly workerLongTasksOver50Ms: BenchmarkMetric<number>;
}

export interface BenchmarkAttempt {
  readonly environmentAfter: BenchmarkEnvironmentIdentity | null;
  readonly environmentBefore: BenchmarkEnvironmentIdentity | null;
  readonly failureMessage: string | null;
  readonly flythrough: FlythroughTelemetrySnapshot | null;
  readonly metrics: BenchmarkAttemptMetrics;
  readonly profileLineage: Readonly<{
    readonly history: readonly ["continuous-page"];
    readonly id: "in-game-continuous-page";
  }>;
  readonly repeat: number;
  readonly state: "invalid" | "measured";
}

export interface BenchmarkVarianceMetric {
  readonly metric:
    | "renderWorkerCallbackIntervalP95Ms"
    | "renderWorkerRenderDurationP95Ms"
    | "streamingCellLoadP95Ms";
  readonly reason: string | null;
  readonly relativeRange: number | null;
  readonly state: "invalid" | "measured";
  readonly values: readonly number[];
}

export interface BenchmarkCheck {
  readonly actual: number | null;
  readonly limit: number;
  readonly metric: string;
  readonly passed: boolean | null;
  readonly state: "measured" | "unsupported" | "invalid";
}

export interface BenchmarkFacet {
  readonly reasons: readonly string[];
  readonly status: "passed" | "failed" | "not-evaluated";
}

export interface BenchmarkReport {
  readonly artifactDigest: BenchmarkMetric<string>;
  readonly attempts: readonly BenchmarkAttempt[];
  readonly checks: readonly BenchmarkCheck[];
  readonly definitionId: string;
  readonly environmentComparisonPolicy: Readonly<{
    readonly excludedRecordedFields: readonly ["screen.viewportCssPixels"];
    readonly id: "fixed-worker-render-pixels@1";
  }>;
  readonly environmentCaptures: readonly BenchmarkEnvironmentIdentity[];
  readonly releaseDigest: BenchmarkMetric<string>;
  readonly facets: Readonly<{
    readonly budgetEvaluation: BenchmarkFacet;
    readonly referenceEligibility: BenchmarkFacet;
    readonly scenarioEvidence: BenchmarkFacet;
  }>;
  readonly generatedAt: string;
  readonly metricStates: Readonly<{
    readonly allRealmJsHeap: "unsupported";
    readonly attributableGpuMemory: "unsupported";
    readonly dawnPipelineActivity: "unsupported";
    readonly mainThreadLongTasks: "measured" | "unsupported" | "invalid";
    readonly presentationIntervals: "unsupported";
    readonly renderWorkerCallbackIntervals: "measured" | "invalid";
    readonly renderWorkerDurations: "measured" | "invalid";
    readonly streamingCellLoads: "measured" | "invalid";
    readonly workerLongTasks: "unsupported";
  }>;
  readonly preset: BenchmarkQualityPreset;
  readonly provenance: Readonly<{
    readonly invocation: "manual-or-automation-equivalent";
    readonly launcherCollectorTimings: "not-applicable";
    readonly measurementOwner: "in-game";
  }>;
  readonly repeatPolicy: Readonly<{
    readonly count: 3;
    readonly lineage: "continuous-page";
    readonly resetBetweenRepeats: true;
  }>;
  readonly resultContract: typeof BENCHMARK_RESULT_CONTRACT;
  readonly scenario: string;
  readonly scenarioContract: FlythroughScenario;
  readonly schemaVersion: typeof BENCHMARK_RESULT_SCHEMA_VERSION;
  readonly verdict: Readonly<{
    readonly kind: "advisory" | "budget" | "capability-failure";
    readonly label: string;
    readonly passed: boolean | null;
    readonly reasons: readonly string[];
  }>;
  readonly variance: readonly BenchmarkVarianceMetric[];
  readonly warmupPolicy: Readonly<{
    readonly checkpointCount: number;
    readonly kind: "streamed-checkpoint-preflight-plus-fixed-stabilization";
    readonly stabilizationMs: number;
  }>;
  readonly worldSeed: number;
}

export interface BenchmarkTelemetrySnapshot {
  readonly activeRepeat: number | null;
  readonly completedRepeats: number;
  readonly failureMessage: string | null;
  readonly presetId: string;
  readonly progress: number;
  readonly report: BenchmarkReport | null;
  readonly schemaVersion: typeof BENCHMARK_TELEMETRY_SCHEMA_VERSION;
  readonly state:
    | "idle"
    | "resetting"
    | "capturing-environment"
    | "preflighting"
    | "stabilizing"
    | "running"
    | "aggregating"
    | "completed"
    | "failed"
    | "disposed";
}

export function measuredMetric<T>(value: T): BenchmarkMetric<T> {
  return Object.freeze({ state: "measured", value });
}

export function unsupportedMetric<T>(reason: string): BenchmarkMetric<T> {
  return Object.freeze({ reason, state: "unsupported" });
}

export function invalidMetric<T>(reason: string): BenchmarkMetric<T> {
  return Object.freeze({ reason, state: "invalid" });
}

export function notApplicableMetric<T>(reason: string): BenchmarkMetric<T> {
  return Object.freeze({ reason, state: "not-applicable" });
}
