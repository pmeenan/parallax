import {
  STREAMING_DECODE_WORKER_MAXIMUM,
  STREAMING_RESIDENT_CELL_LIMIT,
  STREAMING_RESIDENT_ENCODED_BUDGET_BYTES,
  STREAMING_TELEMETRY_SCHEMA_VERSION,
  STREAMING_TIMING_ATTRIBUTION_TOLERANCE_MS,
  type StreamingCellLoadTelemetry,
  type WorldStreamingTelemetrySnapshot,
} from "@parallax/engine";

export const STREAMING_MEASUREMENT_SAMPLE_MINIMUM = 10;

export type WorldStreamingSnapshotPolicy = "measurement-history" | "settled-hydration";

export interface StreamingCellLoadAttributionP95 {
  readonly decodeMs: number;
  readonly decodeRoundTripMs: number;
  readonly decodeWaitMs: number;
  readonly opfsAccessRoundTripMs: number;
  readonly opfsReadMs: number;
  readonly opfsWaitMs: number;
  readonly renderCommitRoundTripMs: number;
  readonly renderUploadRoundTripMs: number;
  readonly renderUploadWaitMs: number;
  readonly streamingWorkerRemainderMs: number;
  readonly uploadMs: number;
}

export interface StreamingMeasurementStartBatch {
  readonly batchCellCount: number;
  readonly batchFlythroughObserverSequence: number;
  readonly batchObserverUpdateCount: number;
  readonly batchOrdinal: number;
  readonly completedCellIds: readonly string[];
  readonly completedCellOrdinals: readonly number[];
}

export interface StreamingEvidence extends WorldStreamingTelemetrySnapshot {
  readonly cellLoadAttributionP95: StreamingCellLoadAttributionP95;
  readonly cellLoadP95Ms: number;
  readonly measurementCellLoadSamples: readonly StreamingCellLoadTelemetry[];
  readonly measurementProactiveEvictionCount: number;
  readonly measurementStartBatch: StreamingMeasurementStartBatch | null;
  readonly measurementStartCellLoadSampleCount: number;
  readonly measurementStartFlythroughObserverUpdateCount: number;
  readonly measurementStartObserverUpdateCount: number;
  readonly measurementStartProactiveEvictionCount: number;
  readonly measurementStartSettledObserverUpdateCount: number;
}

export interface StreamingEvidenceFailure {
  readonly measurementEnd: WorldStreamingTelemetrySnapshot;
  readonly measurementStart: WorldStreamingTelemetrySnapshot;
  readonly reason: string;
}

export type StreamingEvidenceResult =
  | Readonly<{
      readonly state: "measured";
      readonly value: StreamingEvidence &
        Readonly<{ readonly measurementStartResidentCellCount: number }>;
    }>
  | Readonly<{ readonly failure: StreamingEvidenceFailure; readonly state: "invalid" }>;

export function tryRequireStreamingEvidence(
  value: unknown,
  measurementStart: WorldStreamingTelemetrySnapshot,
): StreamingEvidenceResult {
  try {
    const evidence = requireStreamingEvidence(value, measurementStart);
    return Object.freeze({
      state: "measured",
      value: Object.freeze({
        ...evidence,
        measurementStartResidentCellCount: measurementStart.residentCellCount,
      }),
    });
  } catch (error) {
    return Object.freeze({
      failure: Object.freeze({
        measurementEnd: value as WorldStreamingTelemetrySnapshot,
        measurementStart,
        reason: error instanceof Error ? error.message : String(error),
      }),
      state: "invalid",
    });
  }
}

export function requireStreamingEvidence(
  value: unknown,
  measurementStart?: WorldStreamingTelemetrySnapshot,
): StreamingEvidence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("World-streaming telemetry is missing");
  }
  const telemetry = value as WorldStreamingTelemetrySnapshot;
  const snapshotFailure = streamingSnapshotFailure(telemetry);
  if (snapshotFailure !== null) {
    throw new Error(`World-streaming snapshot contract failed: ${snapshotFailure}`);
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
  const suppliedMeasurementStartResidentCellCount = (
    value as Readonly<{ readonly measurementStartResidentCellCount?: unknown }>
  ).measurementStartResidentCellCount;
  const measurementStartCellLoadSampleCount =
    measurementStart?.cellLoadSampleCount ??
    suppliedEvidence.measurementStartCellLoadSampleCount ??
    telemetry.cellLoadSampleCount - telemetry.cellLoadSamples.length;
  const measurementStartFlythroughObserverUpdateCount =
    measurementStart?.flythroughObserverUpdateCount ??
    suppliedEvidence.measurementStartFlythroughObserverUpdateCount ??
    (measurementStartCellLoadSampleCount === 0 ? 0 : Number.NaN);
  const measurementStartObserverUpdateCount =
    measurementStart?.observerUpdateCount ??
    suppliedEvidence.measurementStartObserverUpdateCount ??
    (measurementStartCellLoadSampleCount === 0 ? 0 : Number.NaN);
  const measurementStartSettledObserverUpdateCount =
    measurementStart?.settledObserverUpdateCount ??
    suppliedEvidence.measurementStartSettledObserverUpdateCount ??
    (measurementStartCellLoadSampleCount === 0 ? 0 : Number.NaN);
  const measurementStartBatch =
    measurementStart === undefined
      ? (suppliedEvidence.measurementStartBatch ?? null)
      : deriveMeasurementStartBatch(measurementStart);
  const retainedMeasurementStartBatch = deriveMeasurementStartBatchFromSamples(
    telemetry.cellLoadSamples,
    measurementStartCellLoadSampleCount,
  );
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
  const measurementStartResidentCellCount =
    measurementStart?.residentCellCount ??
    (typeof suppliedMeasurementStartResidentCellCount === "number"
      ? suppliedMeasurementStartResidentCellCount
      : telemetry.residentCellCount - measurementSampleCount + measurementProactiveEvictionCount);
  if (
    !nonNegativeInteger(measurementStartCellLoadSampleCount) ||
    !nonNegativeInteger(measurementStartFlythroughObserverUpdateCount) ||
    !nonNegativeInteger(measurementStartObserverUpdateCount) ||
    !nonNegativeInteger(measurementStartSettledObserverUpdateCount) ||
    measurementStartSettledObserverUpdateCount > measurementStartObserverUpdateCount ||
    measurementStartFlythroughObserverUpdateCount > measurementStartObserverUpdateCount
  ) {
    throw new Error(
      `World-streaming measurement-start counters are invalid: samples=${String(measurementStartCellLoadSampleCount)}, flythrough=${String(measurementStartFlythroughObserverUpdateCount)}, total=${String(measurementStartObserverUpdateCount)}, settled=${String(measurementStartSettledObserverUpdateCount)}`,
    );
  }
  if (
    !positiveInteger(measurementStartResidentCellCount) ||
    measurementStartResidentCellCount > STREAMING_RESIDENT_CELL_LIMIT ||
    (measurementStartSettledObserverUpdateCount === measurementStartObserverUpdateCount &&
      measurementStartResidentCellCount !== STREAMING_RESIDENT_CELL_LIMIT)
  ) {
    throw new Error(
      `World-streaming measurement-start residency is invalid: residentCellCount=${String(measurementStartResidentCellCount)}, totalObserver=${String(measurementStartObserverUpdateCount)}, settledObserver=${String(measurementStartSettledObserverUpdateCount)}`,
    );
  }
  if (
    telemetry.settledObserverUpdateCount < measurementStartSettledObserverUpdateCount ||
    !validObserverProgress(
      measurementStartObserverUpdateCount,
      measurementStartFlythroughObserverUpdateCount,
      telemetry.observerUpdateCount,
      telemetry.flythroughObserverUpdateCount,
    )
  ) {
    throw new Error(
      `World-streaming observer progress is invalid: start flythrough/total/settled=${measurementStartFlythroughObserverUpdateCount}/${measurementStartObserverUpdateCount}/${measurementStartSettledObserverUpdateCount}, end=${telemetry.flythroughObserverUpdateCount}/${telemetry.observerUpdateCount}/${telemetry.settledObserverUpdateCount}`,
    );
  }
  if (
    !validMeasurementStartBatch(
      measurementStartBatch,
      measurementStartCellLoadSampleCount,
      measurementStartObserverUpdateCount,
      measurementStartFlythroughObserverUpdateCount,
      measurementStartSettledObserverUpdateCount,
    )
  ) {
    throw new Error("World-streaming measurement-start batch is invalid");
  }
  if (
    !validRetainedBoundaryPrefix(telemetry.cellLoadSamples, measurementStartCellLoadSampleCount) ||
    (measurementStart !== undefined &&
      (!validRetainedSequenceWindow(
        measurementStart.cellLoadSamples,
        measurementStartCellLoadSampleCount,
      ) ||
        !validRetainedBoundaryPrefix(
          measurementStart.cellLoadSamples,
          measurementStartCellLoadSampleCount,
        )))
  ) {
    throw new Error("World-streaming retained pre-window prefix is invalid");
  }
  if (
    retainedMeasurementStartBatch !== null &&
    !compatibleMeasurementStartBatchFacts(
      measurementStartBatch,
      retainedMeasurementStartBatch,
      telemetry.cellLoadSamples,
      measurementStartCellLoadSampleCount,
    )
  ) {
    throw new Error("World-streaming stored start-batch facts conflict with the raw prefix");
  }
  if (
    measurementSampleCount < STREAMING_MEASUREMENT_SAMPLE_MINIMUM ||
    measurementSampleCount > telemetry.cellLoadSamples.length ||
    measurementCellLoadSamples.length < STREAMING_MEASUREMENT_SAMPLE_MINIMUM
  ) {
    throw new Error(
      `World-streaming measurement window requires at least ${STREAMING_MEASUREMENT_SAMPLE_MINIMUM} completed replacements retained in evidence; delta=${measurementSampleCount}, retained=${telemetry.cellLoadSamples.length}, selected=${measurementCellLoadSamples.length}`,
    );
  }
  if (
    !nonNegativeInteger(measurementStartProactiveEvictionCount) ||
    !positiveInteger(measurementProactiveEvictionCount) ||
    telemetry.proactiveEvictionCount < measurementStartProactiveEvictionCount ||
    telemetry.residentCellCount - measurementStartResidentCellCount !==
      measurementSampleCount - measurementProactiveEvictionCount
  ) {
    throw new Error(
      `World-streaming measurement window has inconsistent residency/eviction evidence: startResident=${measurementStartResidentCellCount}, endResident=${telemetry.residentCellCount}, completedDelta=${measurementSampleCount}, evictionDelta=${measurementProactiveEvictionCount}`,
    );
  }
  if (
    measurementCellLoadSamples.some(
      (sample) =>
        sample.cellId === "" ||
        !positiveInteger(sample.batchCellCount) ||
        sample.batchCellCount > STREAMING_RESIDENT_CELL_LIMIT ||
        !positiveInteger(sample.batchCellOrdinal) ||
        sample.batchCellOrdinal > sample.batchCellCount ||
        !nonNegativeInteger(sample.batchFlythroughObserverSequence) ||
        sample.batchFlythroughObserverSequence > telemetry.flythroughObserverUpdateCount ||
        !positiveInteger(sample.batchObserverUpdateCount) ||
        sample.batchObserverUpdateCount > telemetry.observerUpdateCount ||
        sample.batchFlythroughObserverSequence > sample.batchObserverUpdateCount ||
        !positiveInteger(sample.batchOrdinal) ||
        sample.batchOrdinal < 2 ||
        sample.batchOrdinal > sample.batchObserverUpdateCount + 1 ||
        !positiveInteger(sample.sequence) ||
        sample.batchOrdinal > sample.sequence + 1 ||
        !positiveFinite(sample.totalMs) ||
        !nonNegativeFinite(sample.opfsAccessRoundTripMs) ||
        !nonNegativeFinite(sample.opfsReadMs) ||
        !nonNegativeFinite(sample.opfsWaitMs) ||
        !nonNegativeFinite(sample.decodeRoundTripMs) ||
        !nonNegativeFinite(sample.decodeMs) ||
        !nonNegativeFinite(sample.decodeWaitMs) ||
        !nonNegativeFinite(sample.renderUploadRoundTripMs) ||
        !nonNegativeFinite(sample.uploadMs) ||
        !nonNegativeFinite(sample.renderUploadWaitMs) ||
        !nonNegativeFinite(sample.renderCommitRoundTripMs) ||
        !nonNegativeFinite(sample.streamingWorkerRemainderMs) ||
        !Number.isInteger(sample.encodedBytes) ||
        sample.encodedBytes <= 0 ||
        !Number.isInteger(sample.gpuBytes) ||
        sample.gpuBytes <= 0 ||
        !validTimingAttribution(sample),
    )
  ) {
    throw new Error("World-streaming cell-load samples are invalid");
  }
  if (
    !validBatchIdentity(
      measurementCellLoadSamples,
      measurementStartBatch,
      telemetry.observerUpdateCount,
      telemetry.flythroughObserverUpdateCount,
      telemetry.settledObserverUpdateCount,
      measurementStartObserverUpdateCount,
      measurementStartFlythroughObserverUpdateCount,
      measurementStartSettledObserverUpdateCount,
    )
  ) {
    throw new Error("World-streaming cell-load batch identity is invalid");
  }
  const cellLoadP95Ms = p95(measurementCellLoadSamples.map((sample) => sample.totalMs));
  const cellLoadAttributionP95 = Object.freeze({
    decodeMs: p95(measurementCellLoadSamples.map((sample) => sample.decodeMs)),
    decodeRoundTripMs: p95(measurementCellLoadSamples.map((sample) => sample.decodeRoundTripMs)),
    decodeWaitMs: p95(measurementCellLoadSamples.map((sample) => sample.decodeWaitMs)),
    opfsAccessRoundTripMs: p95(
      measurementCellLoadSamples.map((sample) => sample.opfsAccessRoundTripMs),
    ),
    opfsReadMs: p95(measurementCellLoadSamples.map((sample) => sample.opfsReadMs)),
    opfsWaitMs: p95(measurementCellLoadSamples.map((sample) => sample.opfsWaitMs)),
    renderCommitRoundTripMs: p95(
      measurementCellLoadSamples.map((sample) => sample.renderCommitRoundTripMs),
    ),
    renderUploadRoundTripMs: p95(
      measurementCellLoadSamples.map((sample) => sample.renderUploadRoundTripMs),
    ),
    renderUploadWaitMs: p95(measurementCellLoadSamples.map((sample) => sample.renderUploadWaitMs)),
    streamingWorkerRemainderMs: p95(
      measurementCellLoadSamples.map((sample) => sample.streamingWorkerRemainderMs),
    ),
    uploadMs: p95(measurementCellLoadSamples.map((sample) => sample.uploadMs)),
  });
  return Object.freeze({
    ...telemetry,
    cellLoadAttributionP95,
    cellLoadP95Ms,
    measurementCellLoadSamples: Object.freeze([...measurementCellLoadSamples]),
    measurementProactiveEvictionCount,
    measurementStartBatch,
    measurementStartCellLoadSampleCount,
    measurementStartFlythroughObserverUpdateCount,
    measurementStartObserverUpdateCount,
    measurementStartProactiveEvictionCount,
    measurementStartSettledObserverUpdateCount,
  });
}

export function requireWorldStreamingSnapshot(
  value: unknown,
  policy: WorldStreamingSnapshotPolicy = "measurement-history",
): WorldStreamingTelemetrySnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("World-streaming telemetry is missing");
  }
  const telemetry = value as WorldStreamingTelemetrySnapshot;
  const failure = streamingSnapshotFailure(telemetry, policy);
  if (failure !== null) {
    throw new Error(`World-streaming snapshot contract failed: ${failure}`);
  }
  return telemetry;
}

function streamingSnapshotFailure(
  telemetry: WorldStreamingTelemetrySnapshot,
  policy: WorldStreamingSnapshotPolicy = "measurement-history",
): string | null {
  if (telemetry.schemaVersion !== STREAMING_TELEMETRY_SCHEMA_VERSION) {
    return `schemaVersion=${String(telemetry.schemaVersion)}; expected ${STREAMING_TELEMETRY_SCHEMA_VERSION}`;
  }
  if (telemetry.state !== "streaming" || telemetry.failureMessage !== null) {
    return `state=${String(telemetry.state)}, failureMessage=${String(telemetry.failureMessage)}`;
  }
  if (
    !Number.isInteger(telemetry.decodeWorkerCount) ||
    telemetry.decodeWorkerCount < 1 ||
    telemetry.decodeWorkerCount > STREAMING_DECODE_WORKER_MAXIMUM ||
    !positiveInteger(telemetry.hardwareConcurrency) ||
    telemetry.hardwareConcurrency < telemetry.decodeWorkerCount
  ) {
    return `decode topology workers=${String(telemetry.decodeWorkerCount)}, hardwareConcurrency=${String(telemetry.hardwareConcurrency)}`;
  }
  if (
    !nonNegativeInteger(telemetry.flythroughObserverUpdateCount) ||
    !nonNegativeInteger(telemetry.observerUpdateCount) ||
    !nonNegativeInteger(telemetry.settledObserverUpdateCount) ||
    telemetry.settledObserverUpdateCount > telemetry.observerUpdateCount ||
    telemetry.flythroughObserverUpdateCount > telemetry.observerUpdateCount
  ) {
    return `observer counters flythrough=${String(telemetry.flythroughObserverUpdateCount)}, total=${String(telemetry.observerUpdateCount)}, settled=${String(telemetry.settledObserverUpdateCount)}`;
  }
  if (
    !Array.isArray(telemetry.currentObservers) ||
    telemetry.currentObservers.length === 0 ||
    telemetry.currentObservers.some(
      (observer) =>
        !Array.isArray(observer) ||
        observer.length !== 3 ||
        observer.some((component) => !Number.isFinite(component)),
    )
  ) {
    return "currentObservers is missing or contains a non-finite vec3";
  }
  if (
    !positiveInteger(telemetry.decodeQueueDepthHighWater) ||
    telemetry.decodeQueueDepthHighWater < telemetry.decodeWorkerCount ||
    telemetry.decodeQueueDepthHighWater > STREAMING_RESIDENT_CELL_LIMIT
  ) {
    return `decodeQueueDepthHighWater=${String(telemetry.decodeQueueDepthHighWater)} outside worker/residency bounds ${telemetry.decodeWorkerCount}..${STREAMING_RESIDENT_CELL_LIMIT}`;
  }
  if (
    !positiveInteger(telemetry.residentCellCount) ||
    telemetry.residentCellCount > STREAMING_RESIDENT_CELL_LIMIT ||
    (telemetry.settledObserverUpdateCount === telemetry.observerUpdateCount &&
      telemetry.residentCellCount !== STREAMING_RESIDENT_CELL_LIMIT)
  ) {
    return `residentCellCount=${String(telemetry.residentCellCount)} at observer=${String(telemetry.observerUpdateCount)}, settled=${String(telemetry.settledObserverUpdateCount)}; expected 1..${STREAMING_RESIDENT_CELL_LIMIT} while unsettled and ${STREAMING_RESIDENT_CELL_LIMIT} when settled`;
  }
  if (
    !Array.isArray(telemetry.residentCellIds) ||
    telemetry.residentCellIds.length !== telemetry.residentCellCount ||
    telemetry.residentCellIds.some((cellId) => typeof cellId !== "string" || cellId.length === 0) ||
    new Set(telemetry.residentCellIds).size !== telemetry.residentCellIds.length
  ) {
    return `residentCellIds=${String(telemetry.residentCellIds?.length)} does not identify ${telemetry.residentCellCount} unique residents`;
  }
  const checkpoint = telemetry.settledRecoveryCheckpoint;
  if (
    checkpoint === null ||
    checkpoint.workerGeneration !== telemetry.workerGeneration ||
    checkpoint.observerUpdateCount !== telemetry.settledObserverUpdateCount ||
    checkpoint.flythroughObserverUpdateCount > checkpoint.observerUpdateCount ||
    !Array.isArray(checkpoint.observers) ||
    checkpoint.observers.length === 0 ||
    checkpoint.observers.some(
      (observer) =>
        !Array.isArray(observer) ||
        observer.length !== 3 ||
        observer.some((component) => !Number.isFinite(component)),
    ) ||
    !Array.isArray(checkpoint.residentCellIds) ||
    checkpoint.residentCellIds.length !== STREAMING_RESIDENT_CELL_LIMIT ||
    new Set(checkpoint.residentCellIds).size !== checkpoint.residentCellIds.length ||
    (telemetry.settledObserverUpdateCount === telemetry.observerUpdateCount &&
      (JSON.stringify(checkpoint.observers) !== JSON.stringify(telemetry.currentObservers) ||
        JSON.stringify(checkpoint.residentCellIds) !== JSON.stringify(telemetry.residentCellIds)))
  ) {
    return "settledRecoveryCheckpoint is missing, stale, or inconsistent with settled residency";
  }
  if (
    !positiveInteger(telemetry.residentEncodedBytes) ||
    telemetry.residentEncodedBytes > STREAMING_RESIDENT_ENCODED_BUDGET_BYTES ||
    !positiveInteger(telemetry.residentEncodedBytesHighWater) ||
    telemetry.residentEncodedBytesHighWater < telemetry.residentEncodedBytes
  ) {
    return `encoded residency current=${String(telemetry.residentEncodedBytes)}, highWater=${String(telemetry.residentEncodedBytesHighWater)}, budget=${STREAMING_RESIDENT_ENCODED_BUDGET_BYTES}`;
  }
  if (
    !positiveInteger(telemetry.residentGpuBytes) ||
    !positiveInteger(telemetry.residentGpuBytesHighWater) ||
    telemetry.residentGpuBytesHighWater < telemetry.residentGpuBytes
  ) {
    return `GPU residency current=${String(telemetry.residentGpuBytes)}, highWater=${String(telemetry.residentGpuBytesHighWater)}`;
  }
  if (
    !nonNegativeInteger(telemetry.proactiveEvictionCount) ||
    (policy === "measurement-history" && telemetry.proactiveEvictionCount === 0)
  ) {
    return `proactiveEvictionCount=${String(telemetry.proactiveEvictionCount)}; expected ${
      policy === "measurement-history"
        ? "positive movement history"
        : "non-negative hydration state"
    }`;
  }
  if (telemetry.cpuBudgetRejectionCount !== 0) {
    return `cpuBudgetRejectionCount=${String(telemetry.cpuBudgetRejectionCount)}; expected zero`;
  }
  if (
    !positiveInteger(telemetry.encodedBytesRead) ||
    !nonNegativeInteger(telemetry.opfsProvisionedBytes) ||
    !positiveInteger(telemetry.opfsPackageCount) ||
    telemetry.opfsAccessHandleCount !== telemetry.opfsPackageCount ||
    !Number.isFinite(telemetry.opfsAccessHandleOpenDurationMs) ||
    telemetry.opfsAccessHandleOpenDurationMs < 0
  ) {
    return `storage attribution encodedBytesRead=${String(telemetry.encodedBytesRead)}, opfsProvisionedBytes=${String(telemetry.opfsProvisionedBytes)}, accessHandles=${String(telemetry.opfsAccessHandleCount)}/${String(telemetry.opfsPackageCount)}, handleOpenDurationMs=${String(telemetry.opfsAccessHandleOpenDurationMs)}`;
  }
  if (
    !nonNegativeInteger(telemetry.cellLoadSampleCount) ||
    !Array.isArray(telemetry.cellLoadSamples) ||
    telemetry.cellLoadSampleCount < telemetry.cellLoadSamples.length ||
    (policy === "measurement-history" &&
      telemetry.cellLoadSamples.length < STREAMING_MEASUREMENT_SAMPLE_MINIMUM)
  ) {
    return `sample retention total=${String(telemetry.cellLoadSampleCount)}, retained=${String(telemetry.cellLoadSamples?.length)}, minimum=${
      policy === "measurement-history" ? STREAMING_MEASUREMENT_SAMPLE_MINIMUM : 0
    }`;
  }
  return null;
}

function validTimingAttribution(sample: StreamingCellLoadTelemetry): boolean {
  const tolerance = STREAMING_TIMING_ATTRIBUTION_TOLERANCE_MS;
  return (
    withinTolerance(
      sample.opfsAccessRoundTripMs,
      sample.opfsReadMs + sample.opfsWaitMs,
      tolerance,
    ) &&
    withinTolerance(sample.decodeRoundTripMs, sample.decodeMs + sample.decodeWaitMs, tolerance) &&
    withinTolerance(
      sample.renderUploadRoundTripMs,
      sample.uploadMs + sample.renderUploadWaitMs,
      tolerance,
    ) &&
    withinTolerance(
      sample.totalMs,
      sample.opfsAccessRoundTripMs +
        sample.decodeRoundTripMs +
        sample.renderUploadRoundTripMs +
        sample.renderCommitRoundTripMs +
        sample.streamingWorkerRemainderMs,
      tolerance,
    )
  );
}

function validBatchIdentity(
  samples: readonly StreamingCellLoadTelemetry[],
  measurementStartBatch: StreamingMeasurementStartBatch | null,
  measurementEndObserverUpdateCount: number,
  measurementEndFlythroughObserverUpdateCount: number,
  measurementEndSettledObserverUpdateCount: number,
  measurementStartObserverUpdateCount: number,
  measurementStartFlythroughObserverUpdateCount: number,
  measurementStartSettledObserverUpdateCount: number,
): boolean {
  const batches: {
    readonly cellCount: number;
    readonly cellIds: Set<string>;
    readonly cellOrdinals: Set<number>;
    readonly flythroughObserverSequence: number;
    readonly observerUpdateCount: number;
    readonly ordinal: number;
  }[] = [];
  for (const sample of samples) {
    const existing = batches.at(-1);
    if (existing === undefined || existing.ordinal !== sample.batchOrdinal) {
      if (existing !== undefined) {
        if (
          sample.batchOrdinal !== existing.ordinal + 1 ||
          sample.batchObserverUpdateCount === existing.observerUpdateCount ||
          !validObserverProgress(
            existing.observerUpdateCount,
            existing.flythroughObserverSequence,
            sample.batchObserverUpdateCount,
            sample.batchFlythroughObserverSequence,
          )
        ) {
          return false;
        }
      }
      batches.push({
        cellCount: sample.batchCellCount,
        cellIds: new Set([sample.cellId]),
        cellOrdinals: new Set([sample.batchCellOrdinal]),
        flythroughObserverSequence: sample.batchFlythroughObserverSequence,
        observerUpdateCount: sample.batchObserverUpdateCount,
        ordinal: sample.batchOrdinal,
      });
      continue;
    }
    if (
      existing.cellCount !== sample.batchCellCount ||
      existing.flythroughObserverSequence !== sample.batchFlythroughObserverSequence ||
      existing.observerUpdateCount !== sample.batchObserverUpdateCount ||
      existing.cellOrdinals.has(sample.batchCellOrdinal) ||
      existing.cellIds.has(sample.cellId)
    ) {
      return false;
    }
    existing.cellOrdinals.add(sample.batchCellOrdinal);
    existing.cellIds.add(sample.cellId);
  }
  const first = batches[0];
  const last = batches.at(-1);
  if (first === undefined || last === undefined) return false;
  if (first.observerUpdateCount <= measurementStartSettledObserverUpdateCount) return false;
  if (
    measurementStartBatch !== null &&
    first.ordinal !== measurementStartBatch.batchOrdinal &&
    first.ordinal !== measurementStartBatch.batchOrdinal + 1
  ) {
    return false;
  }
  const hasSameStartBatchOrdinal = measurementStartBatch?.batchOrdinal === first.ordinal;
  const continuesStartBatch =
    hasSameStartBatchOrdinal &&
    measurementStartBatch.batchObserverUpdateCount > measurementStartSettledObserverUpdateCount;
  if (hasSameStartBatchOrdinal && !continuesStartBatch) return false;
  const succeedsStartBatch =
    measurementStartBatch !== null && first.ordinal === measurementStartBatch.batchOrdinal + 1;
  if (
    succeedsStartBatch &&
    (measurementStartBatch.completedCellIds.length !== measurementStartBatch.batchCellCount ||
      first.observerUpdateCount <= measurementStartBatch.batchObserverUpdateCount ||
      first.observerUpdateCount <= measurementStartSettledObserverUpdateCount ||
      !validObserverProgress(
        measurementStartBatch.batchObserverUpdateCount,
        measurementStartBatch.batchFlythroughObserverSequence,
        first.observerUpdateCount,
        first.flythroughObserverSequence,
      ))
  ) {
    return false;
  }
  if (
    continuesStartBatch
      ? !sameBatchIdentity(first, measurementStartBatch) ||
        !validObserverProgress(
          first.observerUpdateCount,
          first.flythroughObserverSequence,
          measurementStartObserverUpdateCount,
          measurementStartFlythroughObserverUpdateCount,
        )
      : !validBatchSelectionAcrossMeasurementStart(
          first,
          measurementStartObserverUpdateCount,
          measurementStartFlythroughObserverUpdateCount,
          measurementStartSettledObserverUpdateCount,
        )
  ) {
    return false;
  }
  if (
    !validObserverProgress(
      last.observerUpdateCount,
      last.flythroughObserverSequence,
      measurementEndObserverUpdateCount,
      measurementEndFlythroughObserverUpdateCount,
    )
  ) {
    return false;
  }
  for (const [index, batch] of batches.entries()) {
    const boundaryOrdinals =
      index === 0 && continuesStartBatch
        ? new Set(measurementStartBatch.completedCellOrdinals)
        : new Set<number>();
    const boundaryCellIds =
      index === 0 && continuesStartBatch
        ? new Set(measurementStartBatch.completedCellIds)
        : new Set<string>();
    if (
      [...batch.cellOrdinals].some((ordinal) => boundaryOrdinals.has(ordinal)) ||
      [...batch.cellIds].some((cellId) => boundaryCellIds.has(cellId))
    ) {
      return false;
    }
    const observedCellCount = boundaryOrdinals.size + batch.cellOrdinals.size;
    if (observedCellCount > batch.cellCount) return false;
    const complete = observedCellCount === batch.cellCount;
    const legitimatelyTruncatedAtEnd =
      index === batches.length - 1 &&
      measurementEndSettledObserverUpdateCount < measurementEndObserverUpdateCount &&
      batch.observerUpdateCount > measurementEndSettledObserverUpdateCount;
    if (!complete && !legitimatelyTruncatedAtEnd) return false;
  }
  return true;
}

function deriveMeasurementStartBatch(
  measurementStart: WorldStreamingTelemetrySnapshot,
): StreamingMeasurementStartBatch | null {
  return deriveMeasurementStartBatchFromSamples(
    measurementStart.cellLoadSamples,
    measurementStart.cellLoadSampleCount,
  );
}

function validRetainedBoundaryPrefix(
  samples: readonly StreamingCellLoadTelemetry[],
  measurementStartCellLoadSampleCount: number,
): boolean {
  const retainedAtBoundary = samples.filter(
    (sample) => sample.sequence <= measurementStartCellLoadSampleCount,
  );
  if (retainedAtBoundary.length === 0) return true;
  const batches: {
    readonly cellCount: number;
    readonly cellIds: Set<string>;
    readonly cellOrdinals: Set<number>;
    readonly flythroughObserverSequence: number;
    readonly observerUpdateCount: number;
    readonly ordinal: number;
  }[] = [];
  for (const sample of retainedAtBoundary) {
    if (
      sample.cellId === "" ||
      !positiveInteger(sample.batchCellCount) ||
      sample.batchCellCount > STREAMING_RESIDENT_CELL_LIMIT ||
      !positiveInteger(sample.batchCellOrdinal) ||
      sample.batchCellOrdinal > sample.batchCellCount ||
      !nonNegativeInteger(sample.batchFlythroughObserverSequence) ||
      !positiveInteger(sample.batchObserverUpdateCount) ||
      sample.batchFlythroughObserverSequence > sample.batchObserverUpdateCount ||
      !positiveInteger(sample.batchOrdinal) ||
      sample.batchOrdinal < 2 ||
      sample.batchOrdinal > sample.batchObserverUpdateCount + 1 ||
      sample.batchOrdinal > sample.sequence + 1
    ) {
      return false;
    }
    const existing = batches.at(-1);
    if (existing === undefined || existing.ordinal !== sample.batchOrdinal) {
      if (
        existing !== undefined &&
        (sample.batchOrdinal !== existing.ordinal + 1 ||
          sample.batchObserverUpdateCount === existing.observerUpdateCount ||
          !validObserverProgress(
            existing.observerUpdateCount,
            existing.flythroughObserverSequence,
            sample.batchObserverUpdateCount,
            sample.batchFlythroughObserverSequence,
          ))
      ) {
        return false;
      }
      batches.push({
        cellCount: sample.batchCellCount,
        cellIds: new Set([sample.cellId]),
        cellOrdinals: new Set([sample.batchCellOrdinal]),
        flythroughObserverSequence: sample.batchFlythroughObserverSequence,
        observerUpdateCount: sample.batchObserverUpdateCount,
        ordinal: sample.batchOrdinal,
      });
      continue;
    }
    if (
      existing.cellCount !== sample.batchCellCount ||
      existing.flythroughObserverSequence !== sample.batchFlythroughObserverSequence ||
      existing.observerUpdateCount !== sample.batchObserverUpdateCount ||
      existing.cellIds.has(sample.cellId) ||
      existing.cellOrdinals.has(sample.batchCellOrdinal)
    ) {
      return false;
    }
    existing.cellIds.add(sample.cellId);
    existing.cellOrdinals.add(sample.batchCellOrdinal);
  }
  const prefixStartsAtSequenceOne = retainedAtBoundary[0]?.sequence === 1;
  return batches.every(
    (batch, index) =>
      index === batches.length - 1 ||
      (index === 0 && !prefixStartsAtSequenceOne) ||
      batch.cellOrdinals.size === batch.cellCount,
  );
}

function validRetainedSequenceWindow(
  samples: readonly StreamingCellLoadTelemetry[],
  totalSampleCount: number,
): boolean {
  if (!nonNegativeInteger(totalSampleCount) || totalSampleCount < samples.length) return false;
  const firstRetainedSequence = totalSampleCount - samples.length + 1;
  return samples.every((sample, index) => sample.sequence === firstRetainedSequence + index);
}

function deriveMeasurementStartBatchFromSamples(
  samples: readonly StreamingCellLoadTelemetry[],
  measurementStartCellLoadSampleCount: number,
): StreamingMeasurementStartBatch | null {
  if (measurementStartCellLoadSampleCount === 0) return null;
  const retainedAtBoundary = samples.filter(
    (sample) => sample.sequence <= measurementStartCellLoadSampleCount,
  );
  const last = retainedAtBoundary.at(-1);
  if (last === undefined || last.sequence !== measurementStartCellLoadSampleCount) return null;
  const batchSamples = retainedAtBoundary.filter(
    (sample) => sample.batchOrdinal === last.batchOrdinal,
  );
  return Object.freeze({
    batchCellCount: last.batchCellCount,
    batchFlythroughObserverSequence: last.batchFlythroughObserverSequence,
    batchObserverUpdateCount: last.batchObserverUpdateCount,
    batchOrdinal: last.batchOrdinal,
    completedCellIds: Object.freeze(batchSamples.map((sample) => sample.cellId)),
    completedCellOrdinals: Object.freeze(batchSamples.map((sample) => sample.batchCellOrdinal)),
  });
}

function validMeasurementStartBatch(
  batch: StreamingMeasurementStartBatch | null,
  measurementStartCellLoadSampleCount: number,
  measurementStartObserverUpdateCount: number,
  measurementStartFlythroughObserverUpdateCount: number,
  measurementStartSettledObserverUpdateCount: number,
): boolean {
  if (batch === null) return measurementStartCellLoadSampleCount === 0;
  return (
    measurementStartCellLoadSampleCount > 0 &&
    positiveInteger(batch.batchCellCount) &&
    batch.batchCellCount <= STREAMING_RESIDENT_CELL_LIMIT &&
    positiveInteger(batch.batchOrdinal) &&
    batch.batchOrdinal >= 2 &&
    positiveInteger(batch.batchObserverUpdateCount) &&
    nonNegativeInteger(batch.batchFlythroughObserverSequence) &&
    batch.batchFlythroughObserverSequence <= batch.batchObserverUpdateCount &&
    batch.batchOrdinal <= batch.batchObserverUpdateCount + 1 &&
    batch.batchOrdinal <= measurementStartCellLoadSampleCount + 1 &&
    validObserverProgress(
      batch.batchObserverUpdateCount,
      batch.batchFlythroughObserverSequence,
      measurementStartObserverUpdateCount,
      measurementStartFlythroughObserverUpdateCount,
    ) &&
    Array.isArray(batch.completedCellIds) &&
    Array.isArray(batch.completedCellOrdinals) &&
    batch.completedCellIds.length > 0 &&
    batch.completedCellIds.length === batch.completedCellOrdinals.length &&
    batch.completedCellIds.length <= measurementStartCellLoadSampleCount &&
    batch.completedCellIds.length <= batch.batchCellCount &&
    (batch.batchObserverUpdateCount > measurementStartSettledObserverUpdateCount ||
      batch.completedCellIds.length === batch.batchCellCount) &&
    batch.completedCellIds.every((cellId) => typeof cellId === "string" && cellId !== "") &&
    new Set(batch.completedCellIds).size === batch.completedCellIds.length &&
    batch.completedCellOrdinals.every(
      (ordinal) => positiveInteger(ordinal) && ordinal <= batch.batchCellCount,
    ) &&
    new Set(batch.completedCellOrdinals).size === batch.completedCellOrdinals.length
  );
}

function compatibleMeasurementStartBatchFacts(
  left: StreamingMeasurementStartBatch | null,
  right: StreamingMeasurementStartBatch,
  retainedSamples: readonly StreamingCellLoadTelemetry[],
  measurementStartCellLoadSampleCount: number,
): boolean {
  if (
    left === null ||
    left.batchCellCount !== right.batchCellCount ||
    left.batchFlythroughObserverSequence !== right.batchFlythroughObserverSequence ||
    left.batchObserverUpdateCount !== right.batchObserverUpdateCount ||
    left.batchOrdinal !== right.batchOrdinal
  ) {
    return false;
  }
  const leftPairs = new Set(
    left.completedCellIds.map((cellId, index) => `${cellId}\0${left.completedCellOrdinals[index]}`),
  );
  if (
    right.completedCellIds.some(
      (cellId, index) => !leftPairs.has(`${cellId}\0${right.completedCellOrdinals[index]}`),
    )
  ) {
    return false;
  }
  const retainedAtBoundary = retainedSamples.filter(
    (sample) => sample.sequence <= measurementStartCellLoadSampleCount,
  );
  const firstRetainedBoundarySample = retainedAtBoundary.find(
    (sample) => sample.batchOrdinal === right.batchOrdinal,
  );
  const fullBoundaryCompletionRetained =
    right.completedCellIds.length === right.batchCellCount ||
    firstRetainedBoundarySample?.sequence === 1 ||
    retainedAtBoundary.some((sample) => sample.batchOrdinal < right.batchOrdinal);
  const firstRecordedBoundarySequence =
    measurementStartCellLoadSampleCount - left.completedCellIds.length + 1;
  const demonstrablyTruncated =
    firstRetainedBoundarySample !== undefined &&
    firstRetainedBoundarySample.sequence > firstRecordedBoundarySequence;
  return (
    (!fullBoundaryCompletionRetained && demonstrablyTruncated) ||
    left.completedCellIds.length === right.completedCellIds.length
  );
}

function sameBatchIdentity(
  batch: Readonly<{
    cellCount: number;
    flythroughObserverSequence: number;
    observerUpdateCount: number;
    ordinal: number;
  }>,
  boundary: StreamingMeasurementStartBatch,
): boolean {
  return (
    batch.cellCount === boundary.batchCellCount &&
    batch.flythroughObserverSequence === boundary.batchFlythroughObserverSequence &&
    batch.observerUpdateCount === boundary.batchObserverUpdateCount &&
    batch.ordinal === boundary.batchOrdinal
  );
}

function validBatchSelectionAcrossMeasurementStart(
  batch: Readonly<{
    flythroughObserverSequence: number;
    observerUpdateCount: number;
  }>,
  measurementStartObserverUpdateCount: number,
  measurementStartFlythroughObserverUpdateCount: number,
  measurementStartSettledObserverUpdateCount: number,
): boolean {
  if (measurementStartSettledObserverUpdateCount >= measurementStartObserverUpdateCount) {
    return (
      batch.observerUpdateCount > measurementStartObserverUpdateCount &&
      validObserverProgress(
        measurementStartObserverUpdateCount,
        measurementStartFlythroughObserverUpdateCount,
        batch.observerUpdateCount,
        batch.flythroughObserverSequence,
      )
    );
  }
  return (
    validObserverProgress(
      measurementStartObserverUpdateCount,
      measurementStartFlythroughObserverUpdateCount,
      batch.observerUpdateCount,
      batch.flythroughObserverSequence,
    ) ||
    validObserverProgress(
      batch.observerUpdateCount,
      batch.flythroughObserverSequence,
      measurementStartObserverUpdateCount,
      measurementStartFlythroughObserverUpdateCount,
    )
  );
}

function validObserverProgress(
  earlierObserverUpdateCount: number,
  earlierFlythroughObserverUpdateCount: number,
  laterObserverUpdateCount: number,
  laterFlythroughObserverUpdateCount: number,
): boolean {
  const observerDelta = laterObserverUpdateCount - earlierObserverUpdateCount;
  const flythroughDelta = laterFlythroughObserverUpdateCount - earlierFlythroughObserverUpdateCount;
  return flythroughDelta >= 0 && observerDelta >= flythroughDelta;
}

function p95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  const value = sorted[rank];
  if (value === undefined) throw new Error("World-streaming p95 is unavailable");
  return value;
}

function withinTolerance(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
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
