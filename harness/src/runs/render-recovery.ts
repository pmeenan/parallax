import { STREAMING_RESIDENT_CELL_LIMIT, TELEMETRY_SCHEMA_VERSION } from "@parallax/engine";

export const RENDER_RECOVERY_SCENARIO = "render-recovery@2";
export const RENDER_RECOVERY_REPORT_SCHEMA_VERSION = 34;
export const RENDER_RECOVERY_MANDATORY_METRIC_SET_VERSION = 6;
export const RENDER_RECOVERY_TELEMETRY_SCHEMA_VERSION = TELEMETRY_SCHEMA_VERSION;
export const RENDER_RECOVERY_COMPLETION_TIMEOUT_MS = 30_000;
export const RENDER_RECOVERY_MOVEMENT_TIMEOUT_MS = 45_000;
export const RENDER_RECOVERY_MINIMUM_MOVEMENT_METERS = 96;
export const RENDER_RECOVERY_RESIDENT_CELL_COUNT = STREAMING_RESIDENT_CELL_LIMIT;
/**
 * Recovery invalidates the active flythrough, after which gameplay may own the camera (M3), so
 * a raw canvas no longer shows the recovered residency. `render-recovery@2` resets the failed
 * flythrough and previews the pre-fault observer through this fixed view, which matches the
 * flythrough-d1 camera (60 degrees from vertical, 28 m target height, 120 m radius).
 */
export const RENDER_RECOVERY_VERIFICATION_VIEW = Object.freeze({
  camera: Object.freeze({ beta: Math.PI / 3, heightMeters: 28, radiusMeters: 120 }),
  environment: Object.freeze({
    timeOfDay: "daylight" as const,
    timeOfDayPhase: 0.25,
    weather: "clear" as const,
  }),
  headingRadians: 0,
});

export const RENDER_RECOVERY_ATTEMPTS = Object.freeze([
  Object.freeze({
    firstProbe: "device-loss" as const,
    id: "device-loss-recovery" as const,
    secondProbe: null,
  }),
  Object.freeze({
    firstProbe: "worker-crash" as const,
    id: "worker-crash-recovery" as const,
    secondProbe: null,
  }),
  Object.freeze({
    firstProbe: "device-loss" as const,
    id: "retry-exhaustion" as const,
    secondProbe: "worker-crash" as const,
  }),
]);

export const RENDER_RECOVERY_MANDATORY_METRICS = Object.freeze([
  "real device-loss recovery",
  "real silent worker-crash recovery",
  "bounded retry exhaustion",
  "fresh render and streaming generations",
  "fresh SAB completion",
  "moved observer and settled residency restoration",
  "active flythrough invalidation",
  "decoder and world telemetry restoration",
  "rendered pre-fault resident view after recovery",
] as const);
