import type { OpfsReadSpikeTelemetrySnapshot } from "@parallax/engine";
import { evaluateRelativeVariance } from "./aggregate.js";
import {
  SMOKE_OPFS_FILE_BYTES,
  SMOKE_OPFS_RANDOM_BATCH_READS,
  SMOKE_OPFS_RANDOM_READ_BYTES,
  SMOKE_OPFS_RANDOM_READS,
  SMOKE_OPFS_SEQUENTIAL_PASSES,
  SMOKE_OPFS_SEQUENTIAL_READ_BYTES,
} from "./runs/smoke.js";

export type OpfsReadSpikeMetric =
  | Readonly<{ readonly state: "measured"; readonly value: OpfsReadSpikeTelemetrySnapshot }>
  | Readonly<{ readonly reason: string; readonly state: "invalid" }>;

export type OpfsThroughputVariance =
  | Readonly<{
      readonly mode: "random" | "sequential";
      readonly profile: "fresh" | "warm";
      readonly reason: string;
      readonly relativeRange: number | null;
      readonly state: "invalid";
      readonly timingScope: "read-call";
    }>
  | Readonly<{
      readonly mode: "random" | "sequential";
      readonly profile: "fresh" | "warm";
      readonly relativeRange: number;
      readonly state: "measured";
      readonly timingScope: "read-call";
    }>;

export function resolveOpfsReadSpikeMetric(
  snapshot: OpfsReadSpikeTelemetrySnapshot,
  profile: "fresh" | "warm",
): OpfsReadSpikeMetric {
  if (snapshot.state !== "completed") {
    return invalid(
      snapshot.failureMessage ??
        `OPFS read spike did not complete; observed state ${snapshot.state}`,
    );
  }
  const expectedSequentialOperations =
    (SMOKE_OPFS_FILE_BYTES / SMOKE_OPFS_SEQUENTIAL_READ_BYTES) * SMOKE_OPFS_SEQUENTIAL_PASSES;
  const expectedSequentialBytes = SMOKE_OPFS_FILE_BYTES * SMOKE_OPFS_SEQUENTIAL_PASSES;
  const expectedRandomBytes = SMOKE_OPFS_RANDOM_READ_BYTES * SMOKE_OPFS_RANDOM_READS;
  const expectedReuse = profile === "warm";
  const expectedProvisioningBytes = profile === "fresh" ? SMOKE_OPFS_FILE_BYTES : 0;
  const sequential = snapshot.sequential;
  const random = snapshot.random;
  if (
    snapshot.failureMessage !== null ||
    snapshot.fileBytes !== SMOKE_OPFS_FILE_BYTES ||
    snapshot.fileReused !== expectedReuse ||
    snapshot.provisioningBytesWritten !== expectedProvisioningBytes ||
    !validProvisioningDuration(snapshot.provisioningElapsedMs, profile) ||
    sequential === null ||
    random === null ||
    !validPhase(
      sequential,
      expectedSequentialBytes,
      expectedSequentialOperations,
      SMOKE_OPFS_SEQUENTIAL_PASSES,
    ) ||
    !validPhase(
      random,
      expectedRandomBytes,
      SMOKE_OPFS_RANDOM_READS,
      SMOKE_OPFS_RANDOM_READS / SMOKE_OPFS_RANDOM_BATCH_READS,
    )
  ) {
    return invalid("OPFS read spike completed with missing, invalid, or contract-drifted evidence");
  }
  return Object.freeze({ state: "measured", value: Object.freeze({ ...snapshot }) });
}

export function requireOpfsReadSpikeCompleteAtMeasurementBoundary(
  snapshot: OpfsReadSpikeTelemetrySnapshot,
  profile: "fresh" | "warm",
): OpfsReadSpikeMetric & Readonly<{ readonly state: "measured" }> {
  const metric = resolveOpfsReadSpikeMetric(snapshot, profile);
  if (metric.state !== "measured") {
    throw new Error(
      `OPFS read spike was not complete at the measurement boundary: ${metric.reason}`,
    );
  }
  return metric;
}

export function evaluateOpfsThroughputVariance(
  profile: "fresh" | "warm",
  mode: "random" | "sequential",
  values: readonly number[],
  expectedSamples: number,
): OpfsThroughputVariance {
  const variance = evaluateRelativeVariance(values, expectedSamples, "throughput");
  return variance.state === "invalid"
    ? Object.freeze({
        mode,
        profile,
        reason: variance.reason,
        relativeRange: variance.relativeRange,
        state: "invalid",
        timingScope: "read-call",
      })
    : Object.freeze({
        mode,
        profile,
        relativeRange: variance.relativeRange,
        state: "measured",
        timingScope: "read-call",
      });
}

function validPhase(
  phase: NonNullable<OpfsReadSpikeTelemetrySnapshot["sequential"]>,
  expectedBytes: number,
  expectedOperations: number,
  expectedBatches: number,
): boolean {
  return (
    validBatches(phase, expectedBytes, expectedOperations, expectedBatches) &&
    phase.bytesRead === expectedBytes &&
    phase.operations === expectedOperations &&
    phase.validationErrors === 0 &&
    positiveFinite(phase.readCallElapsedMs) &&
    positiveFinite(phase.wallElapsedMs) &&
    phase.wallElapsedMs >= phase.readCallElapsedMs &&
    positiveFinite(phase.readCallThroughputBytesPerSecond) &&
    positiveFinite(phase.wallThroughputBytesPerSecond) &&
    throughputMatches(
      phase.bytesRead,
      phase.readCallElapsedMs,
      phase.readCallThroughputBytesPerSecond,
    ) &&
    throughputMatches(phase.bytesRead, phase.wallElapsedMs, phase.wallThroughputBytesPerSecond)
  );
}

function validBatches(
  phase: NonNullable<OpfsReadSpikeTelemetrySnapshot["sequential"]>,
  expectedBytes: number,
  expectedOperations: number,
  expectedBatches: number,
): boolean {
  if (phase.batches.length !== expectedBatches) return false;
  let bytesRead = 0;
  let operations = 0;
  let readCallElapsedMs = 0;
  for (const batch of phase.batches) {
    if (
      !Number.isSafeInteger(batch.bytesRead) ||
      batch.bytesRead <= 0 ||
      !Number.isSafeInteger(batch.operations) ||
      batch.operations <= 0 ||
      !positiveFinite(batch.readCallElapsedMs) ||
      !positiveFinite(batch.wallElapsedMs) ||
      batch.wallElapsedMs < batch.readCallElapsedMs
    ) {
      return false;
    }
    bytesRead += batch.bytesRead;
    operations += batch.operations;
    readCallElapsedMs += batch.readCallElapsedMs;
  }
  return (
    bytesRead === expectedBytes &&
    operations === expectedOperations &&
    Math.abs(readCallElapsedMs - phase.readCallElapsedMs) <= phase.readCallElapsedMs * 1e-9
  );
}

function validProvisioningDuration(value: number | null, profile: "fresh" | "warm"): boolean {
  return (
    value !== null && Number.isFinite(value) && (profile === "fresh" ? value > 0 : value === 0)
  );
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function throughputMatches(bytes: number, elapsedMs: number, throughput: number): boolean {
  const expected = (bytes * 1_000) / elapsedMs;
  return Math.abs(throughput - expected) <= expected * 1e-9;
}

function invalid(reason: string): OpfsReadSpikeMetric {
  return Object.freeze({ reason, state: "invalid" });
}
