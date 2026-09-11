import {
  SPATIAL_AUDIO_TELEMETRY_SCHEMA_VERSION,
  type SpatialAudioTelemetrySnapshot,
} from "@parallax/engine";

const counters = [
  "activeVoices",
  "cacheHitCount",
  "cacheMissCount",
  "capacityDropCount",
  "clipCount",
  "emitterUpdateCount",
  "endedCount",
  "inactiveDropCount",
  "listenerUpdateCount",
  "pcmBytes",
  "pcmBytesHighWater",
  "pendingPcmBytes",
  "playCount",
  "prepareCount",
  "resetCount",
  "resumeAttemptCount",
  "stoppedCount",
  "voicesHighWater",
] as const;

export function validateSpatialAudioTelemetry(
  input: unknown,
): asserts input is SpatialAudioTelemetrySnapshot {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new Error("Invalid spatial audio telemetry");
  const value = input as SpatialAudioTelemetrySnapshot;
  if (
    value.schemaVersion !== SPATIAL_AUDIO_TELEMETRY_SCHEMA_VERSION ||
    !["idle", "suspended", "running", "failed", "disposed"].includes(value.state) ||
    typeof value.enabled !== "boolean" ||
    (value.sceneId !== null &&
      (typeof value.sceneId !== "string" ||
        !/^[a-z0-9][a-z0-9._:@-]{0,127}$/u.test(value.sceneId))) ||
    (value.failureMessage !== null && typeof value.failureMessage !== "string")
  )
    throw new Error("Invalid spatial audio identity");
  for (const key of counters) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0)
      throw new Error(`Invalid spatial audio counter ${key}`);
  }
  if (typeof value.limits !== "object" || value.limits === null)
    throw new Error("Invalid spatial audio limits");
  for (const key of ["maximumClips", "maximumPcmBytes", "maximumVoices"] as const) {
    if (!Number.isSafeInteger(value.limits[key]) || value.limits[key] < 1)
      throw new Error("Invalid spatial audio limits");
  }
  if (
    value.clipCount > value.limits.maximumClips ||
    value.activeVoices > value.voicesHighWater ||
    value.voicesHighWater > value.limits.maximumVoices ||
    value.pcmBytes + value.pendingPcmBytes > value.pcmBytesHighWater ||
    value.pcmBytesHighWater > value.limits.maximumPcmBytes ||
    ((value.state === "idle" || value.state === "disposed") &&
      (value.activeVoices !== 0 || value.pcmBytes !== 0))
  ) {
    throw new Error("Spatial audio resource accounting is inconsistent");
  }
  for (const key of ["prepareDurationHighWaterMs", "controlDurationHighWaterMs"] as const) {
    if (!Number.isFinite(value[key]) || value[key] < 0)
      throw new Error("Invalid spatial audio duration");
  }
  for (const key of ["sampleRate", "baseLatencySeconds", "outputLatencySeconds"] as const) {
    if (value[key] !== null && (!Number.isFinite(value[key]) || value[key] < 0))
      throw new Error("Invalid spatial audio context observation");
  }
}
