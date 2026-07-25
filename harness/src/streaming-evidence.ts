import {
  STREAMING_DECODE_WORKER_MAXIMUM,
  STREAMING_RESIDENT_CELL_LIMIT,
  STREAMING_RESIDENT_ENCODED_BUDGET_BYTES,
  type StreamingCellLoadTelemetry,
  type WorldStreamingTelemetrySnapshot,
} from "@parallax/engine";

export const STREAMING_MEASUREMENT_SAMPLE_MINIMUM = 10;

export interface StreamingEvidence extends WorldStreamingTelemetrySnapshot {
  readonly cellLoadP95Ms: number;
  readonly measurementCellLoadSamples: readonly StreamingCellLoadTelemetry[];
  readonly measurementProactiveEvictionCount: number;
  readonly measurementStartCellLoadSampleCount: number;
  readonly measurementStartProactiveEvictionCount: number;
}

export function requireStreamingEvidence(
  value: unknown,
  measurementStart?: WorldStreamingTelemetrySnapshot,
): StreamingEvidence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("World-streaming telemetry is missing");
  }
  const telemetry = value as WorldStreamingTelemetrySnapshot;
  if (
    telemetry.schemaVersion !== 1 ||
    telemetry.state !== "streaming" ||
    telemetry.failureMessage !== null ||
    !Number.isInteger(telemetry.decodeWorkerCount) ||
    telemetry.decodeWorkerCount < 1 ||
    telemetry.decodeWorkerCount > STREAMING_DECODE_WORKER_MAXIMUM ||
    !positiveInteger(telemetry.hardwareConcurrency) ||
    telemetry.hardwareConcurrency < telemetry.decodeWorkerCount ||
    !positiveInteger(telemetry.decodeQueueDepthHighWater) ||
    telemetry.decodeQueueDepthHighWater < telemetry.decodeWorkerCount ||
    telemetry.decodeQueueDepthHighWater > STREAMING_RESIDENT_CELL_LIMIT ||
    !Number.isInteger(telemetry.residentCellCount) ||
    telemetry.residentCellCount !== STREAMING_RESIDENT_CELL_LIMIT ||
    !positiveInteger(telemetry.residentEncodedBytes) ||
    telemetry.residentEncodedBytes > STREAMING_RESIDENT_ENCODED_BUDGET_BYTES ||
    !positiveInteger(telemetry.residentEncodedBytesHighWater) ||
    telemetry.residentEncodedBytesHighWater < telemetry.residentEncodedBytes ||
    !positiveInteger(telemetry.residentGpuBytes) ||
    !positiveInteger(telemetry.residentGpuBytesHighWater) ||
    telemetry.residentGpuBytesHighWater < telemetry.residentGpuBytes ||
    !positiveInteger(telemetry.proactiveEvictionCount) ||
    telemetry.proactiveEvictionCount < 1 ||
    telemetry.cpuBudgetRejectionCount !== 0 ||
    !positiveInteger(telemetry.encodedBytesRead) ||
    !nonNegativeInteger(telemetry.opfsProvisionedBytes) ||
    !positiveInteger(telemetry.cellLoadSampleCount) ||
    telemetry.cellLoadSampleCount < telemetry.cellLoadSamples.length ||
    telemetry.cellLoadSamples.length < 10
  ) {
    throw new Error("World-streaming telemetry does not satisfy the M1 v1 contract");
  }
  const firstRetainedSequence =
    telemetry.cellLoadSampleCount - telemetry.cellLoadSamples.length + 1;
  if (
    telemetry.cellLoadSamples.some(
      (sample, index) => sample.sequence !== firstRetainedSequence + index,
    )
  ) {
    throw new Error("World-streaming retained sample sequence is not contiguous");
  }
  const suppliedEvidence = value as Partial<StreamingEvidence>;
  const measurementStartCellLoadSampleCount =
    measurementStart?.cellLoadSampleCount ??
    suppliedEvidence.measurementStartCellLoadSampleCount ??
    telemetry.cellLoadSampleCount - telemetry.cellLoadSamples.length;
  const measurementStartProactiveEvictionCount =
    measurementStart?.proactiveEvictionCount ??
    suppliedEvidence.measurementStartProactiveEvictionCount ??
    0;
  const measurementSampleCount =
    telemetry.cellLoadSampleCount - measurementStartCellLoadSampleCount;
  const measurementCellLoadSamples =
    measurementSampleCount <= telemetry.cellLoadSamples.length
      ? telemetry.cellLoadSamples.slice(-measurementSampleCount)
      : [];
  const measurementProactiveEvictionCount =
    telemetry.proactiveEvictionCount - measurementStartProactiveEvictionCount;
  if (
    !nonNegativeInteger(measurementStartCellLoadSampleCount) ||
    measurementSampleCount < STREAMING_MEASUREMENT_SAMPLE_MINIMUM ||
    measurementSampleCount > telemetry.cellLoadSamples.length ||
    measurementCellLoadSamples.length < STREAMING_MEASUREMENT_SAMPLE_MINIMUM
  ) {
    throw new Error(
      `World-streaming measurement window requires at least ${STREAMING_MEASUREMENT_SAMPLE_MINIMUM} completed replacements`,
    );
  }
  if (
    !nonNegativeInteger(measurementStartProactiveEvictionCount) ||
    !positiveInteger(measurementProactiveEvictionCount) ||
    telemetry.proactiveEvictionCount < measurementStartProactiveEvictionCount ||
    // A snapshot can bisect the worker's evict-before-load phase. Across two
    // snapshots, eviction/load delta skew equals their resident-count difference,
    // whose absolute value cannot exceed the bounded residency set.
    Math.abs(measurementProactiveEvictionCount - measurementSampleCount) >
      STREAMING_RESIDENT_CELL_LIMIT
  ) {
    throw new Error(
      "World-streaming measurement window has inconsistent proactive-eviction evidence",
    );
  }
  const totals = measurementCellLoadSamples.map((sample) => sample.totalMs).sort((a, b) => a - b);
  if (
    measurementCellLoadSamples.some(
      (sample) =>
        sample.cellId === "" ||
        !positiveInteger(sample.sequence) ||
        !positiveFinite(sample.totalMs) ||
        !nonNegativeFinite(sample.opfsReadMs) ||
        !nonNegativeFinite(sample.decodeMs) ||
        !nonNegativeFinite(sample.uploadMs) ||
        !Number.isInteger(sample.encodedBytes) ||
        sample.encodedBytes <= 0 ||
        !Number.isInteger(sample.gpuBytes) ||
        sample.gpuBytes <= 0,
    )
  ) {
    throw new Error("World-streaming cell-load samples are invalid");
  }
  const rank = Math.max(0, Math.ceil(totals.length * 0.95) - 1);
  const cellLoadP95Ms = totals[rank];
  if (cellLoadP95Ms === undefined) throw new Error("World-streaming p95 is unavailable");
  return Object.freeze({
    ...telemetry,
    cellLoadP95Ms,
    measurementCellLoadSamples: Object.freeze([...measurementCellLoadSamples]),
    measurementProactiveEvictionCount,
    measurementStartCellLoadSampleCount,
    measurementStartProactiveEvictionCount,
  });
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function nonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function nonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
