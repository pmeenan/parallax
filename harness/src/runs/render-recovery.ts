import { STREAMING_RESIDENT_CELL_LIMIT, TELEMETRY_SCHEMA_VERSION } from "@parallax/engine";

export const RENDER_RECOVERY_SCENARIO = "render-recovery@1";
export const RENDER_RECOVERY_REPORT_SCHEMA_VERSION = 27;
export const RENDER_RECOVERY_MANDATORY_METRIC_SET_VERSION = 5;
export const RENDER_RECOVERY_TELEMETRY_SCHEMA_VERSION = TELEMETRY_SCHEMA_VERSION;
export const RENDER_RECOVERY_COMPLETION_TIMEOUT_MS = 30_000;
export const RENDER_RECOVERY_MOVEMENT_TIMEOUT_MS = 45_000;
export const RENDER_RECOVERY_MINIMUM_MOVEMENT_METERS = 96;
export const RENDER_RECOVERY_RESIDENT_CELL_COUNT = STREAMING_RESIDENT_CELL_LIMIT;

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
  "visible post-recovery canvas",
] as const);
