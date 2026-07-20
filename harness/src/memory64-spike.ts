import type { Memory64SpikeSamplePhase, Memory64SpikeTelemetrySnapshot } from "@parallax/engine";
import { type Distribution, distribution } from "./aggregate.js";
import {
  MEMORY64_SPIKE_EXPECTED_CHECKSUM,
  MEMORY64_SPIKE_EXPECTED_COLD_SAMPLE_COUNT,
  MEMORY64_SPIKE_EXPECTED_COMPILE_BATCH_ITERATIONS,
  MEMORY64_SPIKE_EXPECTED_HIGH_ADDRESS,
  MEMORY64_SPIKE_EXPECTED_HIGH_PAGES,
  MEMORY64_SPIKE_EXPECTED_HIGH_SENTINEL,
  MEMORY64_SPIKE_EXPECTED_INSTANTIATE_BATCH_ITERATIONS,
  MEMORY64_SPIKE_EXPECTED_KERNEL_ROUNDS,
  MEMORY64_SPIKE_EXPECTED_MEASURED_SAMPLE_COUNT,
  MEMORY64_SPIKE_EXPECTED_PREPARE_ROUNDS,
  MEMORY64_SPIKE_EXPECTED_PREPARED_PAGES,
  MEMORY64_SPIKE_EXPECTED_TELEMETRY_SCHEMA_VERSION,
  MEMORY64_SPIKE_EXPECTED_WARMUP_SAMPLE_COUNT,
} from "./runs/memory64-spike.js";

export type Memory64SpikeMetric =
  | Readonly<{ readonly state: "measured"; readonly value: Memory64SpikeTelemetrySnapshot }>
  | Readonly<{ readonly reason: string; readonly state: "invalid" }>;

export function pairedRatioDistribution(
  memory32: readonly number[],
  memory64: readonly number[],
): Distribution {
  if (memory32.length === 0 || memory32.length !== memory64.length) {
    throw new Error("Paired ratio distribution requires equal non-empty arms");
  }
  return distribution(
    memory32.map((value, index) => {
      const paired = memory64[index];
      if (!positiveFinite(value) || paired === undefined || !positiveFinite(paired)) {
        throw new Error("Paired ratio distribution requires positive finite values");
      }
      return paired / value;
    }),
  );
}

export function resolveMemory64SpikeMetric(
  snapshot: Memory64SpikeTelemetrySnapshot,
): Memory64SpikeMetric {
  if (snapshot.state !== "completed") {
    return invalid(
      snapshot.failureMessage ?? `Memory64 spike did not complete; observed ${snapshot.state}`,
    );
  }
  if (
    snapshot.schemaVersion !== MEMORY64_SPIKE_EXPECTED_TELEMETRY_SCHEMA_VERSION ||
    snapshot.failureMessage !== null ||
    snapshot.coldSampleCount !== MEMORY64_SPIKE_EXPECTED_COLD_SAMPLE_COUNT ||
    snapshot.compileBatchIterations !== MEMORY64_SPIKE_EXPECTED_COMPILE_BATCH_ITERATIONS ||
    snapshot.warmupSampleCount !== MEMORY64_SPIKE_EXPECTED_WARMUP_SAMPLE_COUNT ||
    snapshot.measuredSampleCount !== MEMORY64_SPIKE_EXPECTED_MEASURED_SAMPLE_COUNT ||
    snapshot.kernelRounds !== MEMORY64_SPIKE_EXPECTED_KERNEL_ROUNDS ||
    snapshot.instantiateBatchIterations !== MEMORY64_SPIKE_EXPECTED_INSTANTIATE_BATCH_ITERATIONS ||
    snapshot.prepareRounds !== MEMORY64_SPIKE_EXPECTED_PREPARE_ROUNDS ||
    !positiveFinite(snapshot.totalElapsedMs) ||
    snapshot.memory32 === null ||
    snapshot.memory64 === null ||
    snapshot.memory32.variant !== "memory32" ||
    snapshot.memory64.variant !== "memory64" ||
    !validVariant(snapshot.memory32) ||
    !validVariant(snapshot.memory64) ||
    snapshot.highAddress === null ||
    snapshot.highAddress.address !== MEMORY64_SPIKE_EXPECTED_HIGH_ADDRESS ||
    snapshot.highAddress.pages !== MEMORY64_SPIKE_EXPECTED_HIGH_PAGES ||
    snapshot.highAddress.logicalMemoryBytes !== MEMORY64_SPIKE_EXPECTED_HIGH_PAGES * 65_536 ||
    snapshot.highAddress.sentinelWritten !== MEMORY64_SPIKE_EXPECTED_HIGH_SENTINEL ||
    snapshot.highAddress.sentinelRead !== MEMORY64_SPIKE_EXPECTED_HIGH_SENTINEL ||
    snapshot.highAddress.sentinelReturned !== MEMORY64_SPIKE_EXPECTED_HIGH_SENTINEL ||
    !positiveFinite(snapshot.highAddress.growAndTouchElapsedMs)
  ) {
    return invalid("Memory64 spike completed with missing or contract-drifted evidence");
  }
  const checksums = [...snapshot.memory32.samples, ...snapshot.memory64.samples].map(
    (sample) => sample.checksum,
  );
  if (
    new Set(checksums).size !== 1 ||
    checksums.some((checksum) => checksum !== MEMORY64_SPIKE_EXPECTED_CHECKSUM)
  ) {
    return invalid("Memory32 and memory64 kernels did not produce the pinned identical checksum");
  }
  return Object.freeze({ state: "measured", value: snapshot });
}

function validVariant(variant: NonNullable<Memory64SpikeTelemetrySnapshot["memory32"]>): boolean {
  const expectedSamples =
    MEMORY64_SPIKE_EXPECTED_COLD_SAMPLE_COUNT +
    MEMORY64_SPIKE_EXPECTED_WARMUP_SAMPLE_COUNT +
    MEMORY64_SPIKE_EXPECTED_MEASURED_SAMPLE_COUNT;
  if (
    !nonNegativeFinite(variant.fetchElapsedMs) ||
    !Number.isSafeInteger(variant.moduleBytes) ||
    variant.moduleBytes <= 0 ||
    variant.samples.length !== expectedSamples
  ) {
    return false;
  }
  const expectedPhases: readonly Memory64SpikeSamplePhase[] = [
    ...Array.from({ length: MEMORY64_SPIKE_EXPECTED_COLD_SAMPLE_COUNT }, () => "cold" as const),
    ...Array.from({ length: MEMORY64_SPIKE_EXPECTED_WARMUP_SAMPLE_COUNT }, () => "warmup" as const),
    ...Array.from(
      { length: MEMORY64_SPIKE_EXPECTED_MEASURED_SAMPLE_COUNT },
      () => "measured" as const,
    ),
  ];
  return variant.samples.every((sample, ordinal) => {
    const validLoadTimings =
      sample.phase === "cold"
        ? nonNegativeFinite(sample.compileElapsedMs) &&
          nonNegativeFinite(sample.instantiateElapsedMs)
        : positiveFinite(sample.compileElapsedMs) && positiveFinite(sample.instantiateElapsedMs);
    return (
      sample.ordinal === ordinal &&
      sample.phase === expectedPhases[ordinal] &&
      Number.isInteger(sample.checksum) &&
      validLoadTimings &&
      positiveFinite(sample.prepareElapsedMs) &&
      positiveFinite(sample.kernelElapsedMs) &&
      sample.logicalMemoryBytes === MEMORY64_SPIKE_EXPECTED_PREPARED_PAGES * 65_536
    );
  });
}

function positiveFinite(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function nonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function invalid(reason: string): Memory64SpikeMetric {
  return Object.freeze({ reason, state: "invalid" });
}
