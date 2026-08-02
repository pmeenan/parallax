import type { PsoWarmupTelemetrySnapshot, RenderTelemetrySnapshot } from "@parallax/engine";
import {
  validateExactPsoWarmupTelemetrySnapshot,
  validatePsoWarmupRenderTelemetryRelationship,
} from "./pso-warmup-telemetry.js";
import { errorMessage } from "./value-utils.js";

export type PsoWarmupSmokeEvidence =
  | Readonly<{ readonly state: "measured"; readonly value: PsoWarmupTelemetrySnapshot }>
  | Readonly<{ readonly reason: string; readonly state: "invalid" }>;

export function resolvePsoWarmupEvidence(
  input: Pick<
    RenderTelemetrySnapshot,
    "psoWarmup" | "recovery" | "retainedPsoWarmupFailure" | "state"
  >,
): PsoWarmupSmokeEvidence {
  let validated: PsoWarmupTelemetrySnapshot;
  try {
    validatePsoWarmupRenderTelemetryRelationship(input);
    validated = validateExactPsoWarmupTelemetrySnapshot(input.psoWarmup);
  } catch (error) {
    return Object.freeze({
      reason: `PSO warmup telemetry identity is invalid: ${errorMessage(error)}`,
      state: "invalid",
    });
  }
  if (input.retainedPsoWarmupFailure !== null) {
    return Object.freeze({
      reason: `PSO warmup retained a failed prior worker generation ${input.retainedPsoWarmupFailure.workerGeneration}`,
      state: "invalid",
    });
  }
  const entry = validated.entries[0];
  if (
    validated.state !== "ready" ||
    validated.source !== "privileged-embedded" ||
    validated.releaseDigest !== null ||
    validated.traceEntryCount !== 1 ||
    validated.requestedCount !== 2 ||
    validated.compiledCount !== 1 ||
    validated.cacheMissCount !== 1 ||
    validated.cacheHitCount !== 1 ||
    validated.deferredCount !== 1 ||
    validated.failure !== null ||
    validated.failureCount !== 0 ||
    validated.queueHighWater !== 1 ||
    validated.entries.length !== 1 ||
    entry?.id !== "babylon-lite.standard-opaque-msaa4" ||
    entry.compileAttemptCount !== 1 ||
    !entry.compiled ||
    entry.requestCount !== 2
  ) {
    return Object.freeze({
      reason: "PSO warmup telemetry did not prove exact trace replay and registry deduplication",
      state: "invalid",
    });
  }
  return Object.freeze({ state: "measured", value: validated });
}
