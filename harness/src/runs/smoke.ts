import type { QualityTier } from "../budgets.js";

export interface SmokeMetricDefinition {
  readonly invalidReason?: string;
  readonly mandatoryForHarnessV1: boolean;
  readonly name: string;
  readonly probe: "implemented" | "incomplete";
}

export interface QualityTierProfile {
  readonly refreshRateHz: number;
  readonly renderSurface: Readonly<{ height: number; width: number }>;
  readonly targetDisplayMode: string;
}

export interface SmokeRunOptions {
  readonly includeV8CodeCache: boolean;
}

export const SMOKE_SCENARIO = "smoke@1";
export const SMOKE_MANDATORY_METRIC_SET_VERSION = 32;
export const SMOKE_REPEATS = 3;
export const SMOKE_SIMULATION_GAMEPLAY_WORKLOAD = Object.freeze({
  navigationPathQueryCount: 8,
  navigationTileCount: 256,
  npcAgentCount: 48,
});
export const SMOKE_STREAMING_P95_ABSOLUTE_RANGE_FLOOR_MS = 1;
export const SMOKE_STREAMING_P95_RELATIVE_RANGE_LIMIT = 0.1;
export const SMOKE_BUDGET_METRICS = Object.freeze({
  allRealmJsHeapHighWaterBytes: "allRealmJsHeapHighWaterBytes",
  mainThreadLongTasksOver50Ms: "mainThreadLongTasksOver50Ms",
  pipelineCreationActivityOverlappingMeasurement: "pipelineCreationActivityOverlappingMeasurement",
  shaderCompilationsOverlappingMeasurement: "shaderCompilationsOverlappingMeasurement",
  simulationGameplayStepHighWaterMs: "simulationGameplayStepHighWaterMs",
  streamingCellLoadP95Ms: "streamingCellLoadP95Ms",
} as const);
export const SMOKE_BUDGET_METRIC_NAMES = Object.freeze(Object.values(SMOKE_BUDGET_METRICS));
export const SMOKE_V8_CODE_CACHE_DIAGNOSTIC = "v8-code-cache@6";
export const SMOKE_V8_CODE_CACHE_DIAGNOSTIC_REPEATS = 3;
export const SMOKE_WARMUP_MS = 10_000;
export const SMOKE_MEASUREMENT_FRAMES = 120;
export const SMOKE_JS_HEAP_SAMPLE_INTERVAL_MS = 100;
// Independent consumer-side pin for the public telemetry workload. Do not import the
// engine's producer constants: drift must invalidate this metric until an intentional
// contract change advances both these values and the mandatory metric-set version.
export const SMOKE_SAB_CAPACITY_RECORDS = 256;
export const SMOKE_SAB_MESSAGE_COUNT = 100_000;
export const SMOKE_SAB_RECORD_WORDS = 4;
export const SMOKE_SAB_TOTAL_BYTES =
  2 * (4 + SMOKE_SAB_CAPACITY_RECORDS * SMOKE_SAB_RECORD_WORDS) * Int32Array.BYTES_PER_ELEMENT;
export const SMOKE_WASM_THREAD_MEMORY_PAGES = 33;
export const SMOKE_WASM_THREAD_TASK_COUNT = 262_144;
export const SMOKE_WASM_THREAD_WORKER_COUNT = 2;
// Keep diagnostic headroom beyond the page-owned 10 s failure timer so the harness
// observes the service's actionable failureMessage instead of racing waitForFunction.
export const SMOKE_WASM_THREAD_COMPLETION_TIMEOUT_MS = 12_000;
export const SMOKE_PRESENTATION_TRACE_TAIL_MS = 100;
export const SMOKE_TRACE_QUIESCE_MS = 100;
export const SMOKE_PRESENTATION_TRACE_COMPLETION_TIMEOUT_MS = 10_000;
export const SMOKE_PRESENTATION_TRACE_LATE_OBSERVATION_MS = 10_000;
export const SMOKE_TELEMETRY_GLOBAL_NAME = "__PARALLAX_TELEMETRY__";
export const SMOKE_TELEMETRY_SCHEMA_VERSION = 41;
// v68 carries the deterministic 48-agent navigation/crowd workload and its combined
// gameplay-simulation step high-water gate.
export const SMOKE_REPORT_SCHEMA_VERSION = 68;

export const SMOKE_METRICS: readonly SmokeMetricDefinition[] = Object.freeze([
  metric(
    "compositor presentation interval",
    false,
    "incomplete",
    "Viz trace callbacks omit PresentationFeedback.kFailure, so scan-out success is unobservable",
  ),
  metric("verified gate environment identity", true, "implemented"),
  metric("core measurement run completion", true, "implemented"),
  metric("report finalization", true, "implemented"),
  metric("greybox world content", true, "implemented"),
  metric("world streaming pipeline", true, "implemented"),
  metric("streaming cell-load p95 variance", false, "implemented"),
  metric("SAB ring-buffer transport", true, "implemented"),
  metric("Rust/WASM threads", true, "implemented"),
  metric("character and NPC navigation/crowd step duration", true, "implemented"),
  metric("render-worker callback-pacing variance", true, "implemented"),
  metric("all-worker JS heap", true, "implemented"),
  metric("attributable GPU memory", false, "implemented"),
  metric("Dawn pipeline compile/cache evidence", true, "implemented"),
  metric("PSO warmup trace replay", true, "implemented"),
  metric("HTTP serving evidence", false, "implemented"),
  metric("V8 code-cache evidence", false, "implemented"),
]);

export const SMOKE_INCOMPLETE_METRICS: readonly SmokeMetricDefinition[] = Object.freeze(
  SMOKE_METRICS.filter((metric) => metric.probe === "incomplete"),
);

export const QUALITY_TIER_PROFILES: Readonly<Record<QualityTier, QualityTierProfile>> =
  Object.freeze({
    showcase: Object.freeze({
      refreshRateHz: 60,
      renderSurface: Object.freeze({ height: 2_160, width: 3_840 }),
      targetDisplayMode: "3840x2160@60Hz",
    }),
    standard: Object.freeze({
      refreshRateHz: 120,
      renderSurface: Object.freeze({ height: 1_440, width: 2_560 }),
      targetDisplayMode: "2560x1440@120Hz",
    }),
  });

export function parseQualityTier(value: string | undefined): QualityTier {
  const candidate = value ?? "showcase";
  if (Object.hasOwn(QUALITY_TIER_PROFILES, candidate)) return candidate as QualityTier;
  throw new Error(`PARALLAX_TIER must be showcase or standard; received ${candidate}`);
}

export function parseSmokeRunOptions(args: readonly string[]): SmokeRunOptions {
  let includeV8CodeCache = false;
  for (const argument of args) {
    if (argument === "--include-v8-code-cache") {
      if (includeV8CodeCache) {
        throw new Error("--include-v8-code-cache may only be specified once");
      }
      includeV8CodeCache = true;
      continue;
    }
    throw new Error(`Unsupported smoke option ${JSON.stringify(argument)}`);
  }
  return Object.freeze({ includeV8CodeCache });
}

export function renderSurfaceMismatch(
  tier: QualityTier,
  surface: Readonly<{ height: number; width: number }>,
  tolerancePixels: number,
): string | null {
  const expected = QUALITY_TIER_PROFILES[tier].renderSurface;
  if (
    Math.abs(surface.width - expected.width) <= tolerancePixels &&
    Math.abs(surface.height - expected.height) <= tolerancePixels
  ) {
    return null;
  }
  return `render surface expected ${expected.width}x${expected.height}±${tolerancePixels} pixels, received ${surface.width}x${surface.height}`;
}

function metric(
  name: string,
  mandatoryForHarnessV1: boolean,
  probe: SmokeMetricDefinition["probe"] = "incomplete",
  invalidReason?: string,
): SmokeMetricDefinition {
  return Object.freeze(
    invalidReason === undefined
      ? { mandatoryForHarnessV1, name, probe }
      : { invalidReason, mandatoryForHarnessV1, name, probe },
  );
}
