import type { FlythroughScenario } from "@parallax/engine";

export const FLYTHROUGH_D1_SCENARIO = "flythrough-d1@1";
export const FLYTHROUGH_D1_DURATION_MS = 600_000;
export const FLYTHROUGH_D1_DISTANCE_METERS = 7_200;
export const FLYTHROUGH_D1_REPEATS = 3;
export const FLYTHROUGH_D1_REPORT_SCHEMA_VERSION = 35;
export const FLYTHROUGH_D1_MANDATORY_METRIC_SET_VERSION = 11;
export const FLYTHROUGH_D1_TELEMETRY_SCHEMA_VERSION = 46;
export const FLYTHROUGH_D1_COMPLETION_TIMEOUT_MS = 620_000;
export const FLYTHROUGH_D1_JS_HEAP_SAMPLE_INTERVAL_MS = 200;
export const FLYTHROUGH_D1_TRACE_COMPLETION_TIMEOUT_MS = 30_000;
export const FLYTHROUGH_D1_TRACE_LATE_OBSERVATION_MS = 10_000;
export const FLYTHROUGH_D1_PHASE_IDS = Object.freeze([
  "clear-daylight-start",
  "overcast-daylight",
  "storm-dusk",
  "storm-night",
  "overcast-dawn",
  "clear-daylight-finish",
] as const);

export const FLYTHROUGH_D1_EXPECTED_SCENARIO = Object.freeze({
  camera: Object.freeze({
    beta: Math.PI / 3,
    heightMeters: 28,
    radiusMeters: 120,
  }),
  durationMs: FLYTHROUGH_D1_DURATION_MS,
  environmentPhases: Object.freeze([
    Object.freeze({
      endMs: 100_000,
      id: "clear-daylight-start",
      startMs: 0,
      timeOfDay: "daylight",
      timeOfDayPhase: 0.25,
      weather: "clear",
    }),
    Object.freeze({
      endMs: 200_000,
      id: "overcast-daylight",
      startMs: 100_000,
      timeOfDay: "daylight",
      timeOfDayPhase: 0.25,
      weather: "overcast",
    }),
    Object.freeze({
      endMs: 300_000,
      id: "storm-dusk",
      startMs: 200_000,
      timeOfDay: "dusk",
      timeOfDayPhase: 0.48,
      weather: "storm",
    }),
    Object.freeze({
      endMs: 400_000,
      id: "storm-night",
      startMs: 300_000,
      timeOfDay: "night",
      timeOfDayPhase: 0.75,
      weather: "storm",
    }),
    Object.freeze({
      endMs: 500_000,
      id: "overcast-dawn",
      startMs: 400_000,
      timeOfDay: "dawn",
      timeOfDayPhase: 0.02,
      weather: "overcast",
    }),
    Object.freeze({
      endMs: 600_000,
      id: "clear-daylight-finish",
      startMs: 500_000,
      timeOfDay: "daylight",
      timeOfDayPhase: 0.25,
      weather: "clear",
    }),
  ]),
  id: FLYTHROUGH_D1_SCENARIO,
  path: Object.freeze([
    Object.freeze([0, 12, -1_800] as const),
    Object.freeze([0, 12, 0] as const),
    Object.freeze([1_200, 12, 0] as const),
    Object.freeze([1_200, 12, 1_200] as const),
    Object.freeze([-1_200, 12, 1_200] as const),
    Object.freeze([-1_200, 12, 600] as const),
  ]),
  schemaVersion: 1,
  speedMetersPerSecond: 12,
}) satisfies FlythroughScenario;

export const FLYTHROUGH_D1_WARMUP_POLICY = Object.freeze({
  checkpointCount: FLYTHROUGH_D1_PHASE_IDS.length,
  kind: "streamed-checkpoint-preflight-plus-fixed-stabilization",
  stabilizationMs: 10_000,
});

export const FLYTHROUGH_D1_MANDATORY_METRICS = Object.freeze([
  "scenario completion",
  "report finalization",
  "ordered environment-state coverage",
  "streamed-residency presentation ownership",
  "rendered checkpoint output",
  "render-worker full-window callback aggregate",
  "world streaming pipeline",
  "main-thread long tasks",
  "all-worker JS heap",
  "Dawn pipeline compile/cache evidence",
  "repeat p95 variance",
] as const);
