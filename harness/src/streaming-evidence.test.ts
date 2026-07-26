import {
  STREAMING_RESIDENT_CELL_LIMIT,
  type StreamingCellLoadTelemetry,
  type WorldStreamingTelemetrySnapshot,
} from "@parallax/engine";
import { describe, expect, it } from "vitest";
import { requireStreamingEvidence, tryRequireStreamingEvidence } from "./streaming-evidence.js";

function validTelemetry(): WorldStreamingTelemetrySnapshot {
  return {
    cellLoadSampleCount: 12,
    cellLoadSamples: Array.from({ length: 12 }, (_, index) => ({
      batchCellCount: index < 9 ? 9 : 3,
      batchCellOrdinal: index < 9 ? index + 1 : index - 8,
      batchFlythroughObserverSequence: 0,
      batchObserverUpdateCount: index < 9 ? 1 : 2,
      batchOrdinal: index < 9 ? 2 : 3,
      cellId: `cell-${index}`,
      decodeMs: 1,
      decodeRoundTripMs: 2,
      decodeWaitMs: 1,
      encodedBytes: 10_000,
      gpuBytes: 20_000,
      opfsAccessRoundTripMs: 3,
      opfsReadMs: 2,
      opfsWaitMs: 1,
      renderCommitRoundTripMs: 1,
      renderUploadRoundTripMs: 4,
      renderUploadWaitMs: 1,
      sequence: index + 1,
      streamingWorkerRemainderMs: index,
      totalMs: 10 + index,
      uploadMs: 3,
    })),
    decodeQueueDepthHighWater: 9,
    decodeWorkerCount: 4,
    cpuBudgetRejectionCount: 0,
    currentObservers: Object.freeze([[0, 12, 0] as const]),
    encodedBytesRead: 120_000,
    failureMessage: null,
    flythroughObserverUpdateCount: 0,
    hardwareConcurrency: 16,
    observerUpdateCount: 12,
    opfsAccessHandleCount: 256,
    opfsAccessHandleOpenDurationMs: 10,
    opfsPackageCount: 256,
    opfsProvisionedBytes: 3_000_000,
    proactiveEvictionCount: 12,
    residentCellCount: 9,
    residentCellIds: Object.freeze(["a", "b", "c", "d", "e", "f", "g", "h", "i"]),
    residentEncodedBytes: 90_000,
    residentEncodedBytesHighWater: 90_000,
    residentGpuBytes: 180_000,
    residentGpuBytesHighWater: 180_000,
    renderRecoveryCount: 0,
    schemaVersion: 7,
    settledRecoveryCheckpoint: Object.freeze({
      flythroughObserverUpdateCount: 0,
      observerUpdateCount: 12,
      observers: Object.freeze([[0, 12, 0] as const]),
      residentCellIds: Object.freeze(["a", "b", "c", "d", "e", "f", "g", "h", "i"]),
      workerGeneration: 1,
    }),
    settledObserverUpdateCount: 12,
    state: "streaming",
    workerGeneration: 1,
  };
}

function successorFixture(successorObserverUpdateCount: number): Readonly<{
  end: WorldStreamingTelemetrySnapshot;
  start: WorldStreamingTelemetrySnapshot;
}> {
  const telemetry = validTelemetry();
  const cellLoadSamples = telemetry.cellLoadSamples.map((sample, index) => {
    if (index < 2) {
      return {
        ...sample,
        batchCellCount: 2,
        batchCellOrdinal: index + 1,
        batchObserverUpdateCount: 1,
        batchOrdinal: 2,
      };
    }
    if (index < 11) {
      return {
        ...sample,
        batchCellCount: 9,
        batchCellOrdinal: index - 1,
        batchObserverUpdateCount: successorObserverUpdateCount,
        batchOrdinal: 3,
      };
    }
    return {
      ...sample,
      batchCellCount: 1,
      batchCellOrdinal: 1,
      batchObserverUpdateCount: 3,
      batchOrdinal: 4,
    };
  });
  const end = withSettledCheckpoint({
    ...telemetry,
    cellLoadSamples,
    observerUpdateCount: 3,
    settledObserverUpdateCount: 3,
  });
  const start = withSettledCheckpoint({
    ...end,
    cellLoadSampleCount: 2,
    cellLoadSamples: cellLoadSamples.slice(0, 2),
    observerUpdateCount: 2,
    proactiveEvictionCount: 2,
    settledObserverUpdateCount: 1,
  });
  return Object.freeze({ end, start });
}

function generatedSamples(
  count: number,
  startSequence: number,
  startBatchOrdinal: number,
  startObserverUpdateCount: number,
): readonly StreamingCellLoadTelemetry[] {
  const template = validTelemetry().cellLoadSamples[0];
  if (template === undefined) throw new Error("Streaming fixture has no sample");
  const samples: StreamingCellLoadTelemetry[] = [];
  let remaining = count;
  let sequence = startSequence;
  let batchOrdinal = startBatchOrdinal;
  let batchObserverUpdateCount = startObserverUpdateCount;
  while (remaining > 0) {
    const batchCellCount = Math.min(STREAMING_RESIDENT_CELL_LIMIT, remaining);
    for (let batchCellOrdinal = 1; batchCellOrdinal <= batchCellCount; batchCellOrdinal += 1) {
      samples.push({
        ...template,
        batchCellCount,
        batchCellOrdinal,
        batchObserverUpdateCount,
        batchOrdinal,
        cellId: `generated-${sequence}`,
        sequence,
        streamingWorkerRemainderMs: sequence,
        totalMs: sequence + 10,
      });
      sequence += 1;
    }
    remaining -= batchCellCount;
    batchOrdinal += 1;
    batchObserverUpdateCount += 1;
  }
  return Object.freeze(samples);
}

function boundarySamples(
  completedCellCount: number,
  batchCellCount = completedCellCount,
): readonly StreamingCellLoadTelemetry[] {
  const template = validTelemetry().cellLoadSamples[0];
  if (template === undefined) throw new Error("Streaming fixture has no sample");
  return Object.freeze(
    Array.from({ length: completedCellCount }, (_, index) => ({
      ...template,
      batchCellCount,
      batchCellOrdinal: index + 1,
      batchObserverUpdateCount: 1,
      batchOrdinal: 2,
      cellId: `boundary-${index + 1}`,
      sequence: index + 1,
      streamingWorkerRemainderMs: index + 1,
      totalMs: index + 11,
    })),
  );
}

function generatedSnapshot(
  cellLoadSamples: readonly StreamingCellLoadTelemetry[],
  cellLoadSampleCount: number,
  observerUpdateCount: number,
  settledObserverUpdateCount = observerUpdateCount,
): WorldStreamingTelemetrySnapshot {
  return withSettledCheckpoint({
    ...validTelemetry(),
    cellLoadSampleCount,
    cellLoadSamples,
    encodedBytesRead: cellLoadSampleCount * 10_000,
    observerUpdateCount,
    proactiveEvictionCount: cellLoadSampleCount,
    settledObserverUpdateCount,
  });
}

function withSettledCheckpoint(
  snapshot: WorldStreamingTelemetrySnapshot,
): WorldStreamingTelemetrySnapshot {
  const settled = snapshot.settledObserverUpdateCount === snapshot.observerUpdateCount;
  return {
    ...snapshot,
    settledRecoveryCheckpoint: Object.freeze({
      flythroughObserverUpdateCount: Math.min(
        snapshot.flythroughObserverUpdateCount,
        snapshot.settledObserverUpdateCount,
      ),
      observerUpdateCount: snapshot.settledObserverUpdateCount,
      observers: settled
        ? snapshot.currentObservers
        : (snapshot.settledRecoveryCheckpoint?.observers ?? snapshot.currentObservers),
      residentCellIds: settled
        ? snapshot.residentCellIds
        : (snapshot.settledRecoveryCheckpoint?.residentCellIds ?? validTelemetry().residentCellIds),
      workerGeneration: snapshot.workerGeneration,
    }),
  };
}

function agedBoundaryFixture(
  boundaryCompletedCellCount: number,
  boundaryCellCount: number,
  measuredSampleCount: number,
): Readonly<{
  end: WorldStreamingTelemetrySnapshot;
  start: WorldStreamingTelemetrySnapshot;
}> {
  const boundary = boundarySamples(boundaryCompletedCellCount, boundaryCellCount);
  const continuationCount = boundaryCellCount - boundaryCompletedCellCount;
  const continuation = boundarySamples(boundaryCellCount, boundaryCellCount)
    .slice(boundaryCompletedCellCount)
    .map((sample, index) => ({
      ...sample,
      sequence: boundaryCompletedCellCount + index + 1,
    }));
  const successors = generatedSamples(
    measuredSampleCount - continuationCount,
    boundaryCellCount + 1,
    3,
    2,
  );
  const allMeasured = [...continuation, ...successors];
  const totalSampleCount = boundaryCompletedCellCount + allMeasured.length;
  const retainedSamples = [...boundary, ...allMeasured].slice(-256);
  const lastObserverUpdateCount = retainedSamples.at(-1)?.batchObserverUpdateCount ?? 1;
  return Object.freeze({
    end: generatedSnapshot(retainedSamples, totalSampleCount, lastObserverUpdateCount),
    start: generatedSnapshot(
      boundary,
      boundaryCompletedCellCount,
      1,
      boundaryCompletedCellCount === boundaryCellCount ? 1 : 0,
    ),
  });
}

function smallPriorBatchFixture(measuredSampleCount: number): Readonly<{
  end: WorldStreamingTelemetrySnapshot;
  start: WorldStreamingTelemetrySnapshot;
}> {
  const priorBatch = boundarySamples(1);
  const boundary = generatedSamples(9, 2, 3, 2);
  const measured = generatedSamples(measuredSampleCount, 11, 4, 3);
  const allSamples = [...priorBatch, ...boundary, ...measured];
  const lastObserverUpdateCount = allSamples.at(-1)?.batchObserverUpdateCount ?? 2;
  return Object.freeze({
    end: generatedSnapshot(allSamples.slice(-256), allSamples.length, lastObserverUpdateCount),
    start: generatedSnapshot([...priorBatch, ...boundary], 10, 2),
  });
}

function fixedBatchSamples(
  batchCellCount: number,
  completedCellCount: number,
  startSequence: number,
  batchOrdinal: number,
  batchObserverUpdateCount: number,
): readonly StreamingCellLoadTelemetry[] {
  const template = validTelemetry().cellLoadSamples[0];
  if (template === undefined) throw new Error("Streaming fixture has no sample");
  return Object.freeze(
    Array.from({ length: completedCellCount }, (_, index) => ({
      ...template,
      batchCellCount,
      batchCellOrdinal: index + 1,
      batchObserverUpdateCount,
      batchOrdinal,
      cellId: `fixed-${batchOrdinal}-${index + 1}`,
      sequence: startSequence + index,
      streamingWorkerRemainderMs: startSequence + index,
      totalMs: startSequence + index + 10,
    })),
  );
}

function shortSmokeWindowFixture(endSettled: boolean): Readonly<{
  end: WorldStreamingTelemetrySnapshot;
  start: WorldStreamingTelemetrySnapshot;
}> {
  const boundary = fixedBatchSamples(3, 3, 1, 2, 2);
  const measured = [
    ...fixedBatchSamples(3, 3, 4, 3, 6),
    ...fixedBatchSamples(3, 3, 7, 4, 9),
    ...fixedBatchSamples(3, 3, 10, 5, 13),
    ...fixedBatchSamples(3, endSettled ? 3 : 2, 13, 6, 16),
  ];
  const completedCount = boundary.length + measured.length;
  return Object.freeze({
    end: {
      ...generatedSnapshot([...boundary, ...measured], completedCount, 16, endSettled ? 16 : 13),
      proactiveEvictionCount: 15,
      residentCellCount: endSettled ? 9 : 8,
      residentCellIds: validTelemetry().residentCellIds.slice(0, endSettled ? 9 : 8),
    },
    start: generatedSnapshot(boundary, boundary.length, 6, 5),
  });
}

describe("M1 streaming smoke evidence", () => {
  it("derives nearest-rank p95 from a complete movement-driven sample", () => {
    const evidence = requireStreamingEvidence(validTelemetry());
    expect(evidence.cellLoadP95Ms).toBe(21);
    expect(evidence.measurementStartBatch).toBeNull();
    expect(evidence.cellLoadAttributionP95).toEqual({
      decodeMs: 1,
      decodeRoundTripMs: 2,
      decodeWaitMs: 1,
      opfsAccessRoundTripMs: 3,
      opfsReadMs: 2,
      opfsWaitMs: 1,
      renderCommitRoundTripMs: 1,
      renderUploadRoundTripMs: 4,
      renderUploadWaitMs: 1,
      streamingWorkerRemainderMs: 11,
      uploadMs: 3,
    });
  });

  it("requires a complete finite startup-open OPFS handle set", () => {
    const telemetry = validTelemetry();
    for (const mutation of [
      { opfsAccessHandleCount: 255 },
      { opfsAccessHandleOpenDurationMs: Number.NaN },
      { opfsPackageCount: 0 },
    ]) {
      expect(() => requireStreamingEvidence({ ...telemetry, ...mutation })).toThrow(
        /storage attribution/,
      );
    }
  });

  it("derives p95 and eviction evidence from the bounded measurement delta", () => {
    const end = validTelemetry();
    const start = {
      ...end,
      cellLoadSampleCount: 2,
      cellLoadSamples: end.cellLoadSamples.slice(0, 2),
      observerUpdateCount: 1,
      proactiveEvictionCount: 2,
      settledObserverUpdateCount: 0,
    };
    const evidence = requireStreamingEvidence(end, start);
    expect(evidence.cellLoadP95Ms).toBe(21);
    expect(evidence.measurementCellLoadSamples).toHaveLength(10);
    expect(evidence.measurementProactiveEvictionCount).toBe(10);
    expect(evidence.measurementStartBatch).toEqual({
      batchCellCount: 9,
      batchFlythroughObserverSequence: 0,
      batchObserverUpdateCount: 1,
      batchOrdinal: 2,
      completedCellIds: ["cell-0", "cell-1"],
      completedCellOrdinals: [1, 2],
    });
  });

  it("rejects a leading split whose batch observer was already settled at start", () => {
    const end = validTelemetry();
    const start = {
      ...end,
      cellLoadSampleCount: 2,
      cellLoadSamples: end.cellLoadSamples.slice(0, 2),
      observerUpdateCount: 2,
      proactiveEvictionCount: 2,
      settledObserverUpdateCount: 1,
    };
    expect(() => requireStreamingEvidence(end, start)).toThrow();
  });

  it("rejects an ordinal successor that reuses the settled boundary observer identity", () => {
    const { end, start } = successorFixture(1);
    expect(() => requireStreamingEvidence(end, start)).toThrow();
  });

  it("accepts an ordinal successor with a newer producer-valid observer identity", () => {
    const { end, start } = successorFixture(2);
    const evidence = requireStreamingEvidence(end, start);
    expect(evidence.measurementCellLoadSamples).toHaveLength(10);
    expect(evidence.measurementCellLoadSamples[0]).toMatchObject({
      batchObserverUpdateCount: 2,
      batchOrdinal: 3,
    });
  });

  it("uses monotonic sequence boundaries after the retained sample ring wraps", () => {
    const base = validTelemetry();
    const template = base.cellLoadSamples[0];
    if (template === undefined) throw new Error("Streaming fixture has no sample");
    const samples = Array.from({ length: 256 }, (_, index) => ({
      ...(base.cellLoadSamples[index % base.cellLoadSamples.length] ?? template),
      batchCellCount: index < 252 ? 9 : 4,
      batchCellOrdinal: (index % 9) + 1,
      batchObserverUpdateCount: Math.floor(index / 9) + 2,
      batchOrdinal: Math.floor(index / 9) + 3,
      sequence: index + 5,
      totalMs: index + 11,
      streamingWorkerRemainderMs: index + 1,
    }));
    const end = withSettledCheckpoint({
      ...base,
      cellLoadSampleCount: 260,
      cellLoadSamples: samples,
      observerUpdateCount: 30,
      proactiveEvictionCount: 260,
      settledObserverUpdateCount: 30,
    });
    const start = withSettledCheckpoint({
      ...end,
      cellLoadSampleCount: 250,
      cellLoadSamples: samples.filter((sample) => sample.sequence <= 250),
      observerUpdateCount: 29,
      proactiveEvictionCount: 250,
      settledObserverUpdateCount: 28,
    });
    const evidence = requireStreamingEvidence(end, start);
    expect(evidence.measurementCellLoadSamples.map(({ sequence }) => sequence)).toEqual([
      251, 252, 253, 254, 255, 256, 257, 258, 259, 260,
    ]);
    expect(evidence.cellLoadP95Ms).toBe(266);
  });

  it("rejects a null stored start batch after its nonzero raw prefix ages out of the ring", () => {
    const base = validTelemetry();
    const template = base.cellLoadSamples[0];
    if (template === undefined) throw new Error("Streaming fixture has no sample");
    const cellLoadSamples = Array.from({ length: 256 }, (_, index) => {
      const batchOffset = Math.floor(index / 9);
      return {
        ...template,
        batchCellCount: index < 252 ? 9 : 4,
        batchCellOrdinal: (index % 9) + 1,
        batchObserverUpdateCount: batchOffset + 2,
        batchOrdinal: batchOffset + 3,
        cellId: `ring-cell-${index}`,
        sequence: index + 5,
        streamingWorkerRemainderMs: index + 1,
        totalMs: index + 11,
      };
    });
    expect(() =>
      requireStreamingEvidence({
        ...base,
        cellLoadSampleCount: 260,
        cellLoadSamples,
        measurementStartBatch: null,
        measurementStartCellLoadSampleCount: 4,
        measurementStartFlythroughObserverUpdateCount: 0,
        measurementStartObserverUpdateCount: 1,
        measurementStartProactiveEvictionCount: 4,
        measurementStartSettledObserverUpdateCount: 1,
        observerUpdateCount: 30,
        proactiveEvictionCount: 260,
        settledObserverUpdateCount: 30,
      }),
    ).toThrow();
  });

  it("recomputes a stored measurement window instead of trusting supplied samples", () => {
    const telemetry = validTelemetry();
    const evidence = requireStreamingEvidence({
      ...telemetry,
      measurementStartBatch: {
        batchCellCount: 9,
        batchFlythroughObserverSequence: 0,
        batchObserverUpdateCount: 1,
        batchOrdinal: 2,
        completedCellIds: ["cell-0", "cell-1"],
        completedCellOrdinals: [1, 2],
      },
      measurementCellLoadSamples: [telemetry.cellLoadSamples[0]],
      measurementProactiveEvictionCount: 999,
      measurementStartCellLoadSampleCount: 2,
      measurementStartFlythroughObserverUpdateCount: 0,
      measurementStartObserverUpdateCount: 1,
      measurementStartProactiveEvictionCount: 2,
      measurementStartSettledObserverUpdateCount: 0,
    });
    expect(evidence.measurementCellLoadSamples.map(({ sequence }) => sequence)).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(evidence.measurementProactiveEvictionCount).toBe(10);
  });

  it("round-trips stored start-boundary evidence and cross-checks the retained raw prefix", () => {
    const end = validTelemetry();
    const start = {
      ...end,
      cellLoadSampleCount: 2,
      cellLoadSamples: end.cellLoadSamples.slice(0, 2),
      observerUpdateCount: 1,
      proactiveEvictionCount: 2,
      settledObserverUpdateCount: 0,
    };
    const stored = requireStreamingEvidence(end, start);
    expect(requireStreamingEvidence(stored).measurementStartBatch).toEqual(
      stored.measurementStartBatch,
    );

    const tamperedPrefix = stored.cellLoadSamples.map((sample) =>
      sample.sequence <= 2 ? { ...sample, cellId: `fake-${sample.sequence}` } : sample,
    );
    expect(() =>
      requireStreamingEvidence({ ...stored, cellLoadSamples: tamperedPrefix }),
    ).toThrow();
  });

  it("round-trips producer-valid boundary states across retention and settlement shapes", () => {
    const retainedSplitEnd = validTelemetry();
    const retainedSplitStart = {
      ...retainedSplitEnd,
      cellLoadSampleCount: 2,
      cellLoadSamples: retainedSplitEnd.cellLoadSamples.slice(0, 2),
      observerUpdateCount: 1,
      proactiveEvictionCount: 2,
      settledObserverUpdateCount: 0,
    };
    const completeSuccessor = successorFixture(2);
    const retainedCompleteStart = {
      ...completeSuccessor.start,
      observerUpdateCount: 1,
      settledObserverUpdateCount: 1,
    };
    const scenarios = [
      {
        end: validTelemetry(),
        name: "zero-count null boundary",
        start: undefined,
      },
      {
        end: retainedSplitEnd,
        name: "retained split boundary",
        start: retainedSplitStart,
      },
      {
        end: completeSuccessor.end,
        name: "retained complete settled boundary",
        start: retainedCompleteStart,
      },
      {
        end: agedBoundaryFixture(4, 4, 256).end,
        name: "aged-out complete boundary and full measurement ring",
        start: agedBoundaryFixture(4, 4, 256).start,
      },
      {
        end: agedBoundaryFixture(4, 9, 256).end,
        name: "aged-out split boundary and full measurement ring",
        start: agedBoundaryFixture(4, 9, 256).start,
      },
      {
        end: agedBoundaryFixture(9, 9, 255).end,
        name: "partially retained complete boundary and 255 measured samples",
        start: agedBoundaryFixture(9, 9, 255).start,
      },
    ] as const;

    for (const scenario of scenarios) {
      const stored = requireStreamingEvidence(scenario.end, scenario.start);
      expect(
        () => requireStreamingEvidence(stored),
        `stored round trip for ${scenario.name}`,
      ).not.toThrow();
    }
  });

  it("rejects every out-of-model stored boundary mutation after its raw prefix ages out", () => {
    const fixture = agedBoundaryFixture(4, 4, 256);
    const stored = requireStreamingEvidence(fixture.end, fixture.start);
    const boundary = stored.measurementStartBatch;
    if (boundary === null) throw new Error("Expected a stored boundary batch");
    const fiveIds = Array.from({ length: 5 }, (_, index) => `fabricated-${index + 1}`);
    const nineIds = Array.from({ length: 9 }, (_, index) => `fabricated-${index + 1}`);
    const mutations: readonly Partial<typeof boundary>[] = [
      { batchCellCount: 0 },
      { batchCellCount: STREAMING_RESIDENT_CELL_LIMIT + 1 },
      { batchFlythroughObserverSequence: -1 },
      { batchFlythroughObserverSequence: 1 },
      { batchObserverUpdateCount: 0 },
      { batchObserverUpdateCount: 2 },
      { batchOrdinal: 1 },
      { batchOrdinal: boundary.batchObserverUpdateCount + 2 },
      { completedCellIds: [] },
      { completedCellOrdinals: [] },
      { completedCellIds: [...boundary.completedCellIds, "extra"] },
      { completedCellIds: ["duplicate", "duplicate", "three", "four"] },
      { completedCellOrdinals: [1, 1, 3, 4] },
      { completedCellOrdinals: [1, 2, 3, 5] },
      {
        batchCellCount: 5,
        completedCellIds: fiveIds,
        completedCellOrdinals: [1, 2, 3, 4, 5],
      },
      {
        batchCellCount: 9,
        completedCellIds: nineIds,
        completedCellOrdinals: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      },
    ];

    for (const mutation of mutations) {
      expect(() =>
        requireStreamingEvidence({
          ...stored,
          measurementStartBatch: { ...boundary, ...mutation },
        }),
      ).toThrow();
    }
  });

  it("rejects impossible recorded observer and ordinal origins", () => {
    const fixture = agedBoundaryFixture(4, 4, 256);
    const stored = requireStreamingEvidence(fixture.end, fixture.start);
    const observerZero = stored.cellLoadSamples.map((sample, index) =>
      index === 0 ? { ...sample, batchObserverUpdateCount: 0 } : sample,
    );
    const hydrationOrdinal = stored.cellLoadSamples.map((sample, index) =>
      index === 0 ? { ...sample, batchOrdinal: 1 } : sample,
    );
    expect(() => requireStreamingEvidence({ ...stored, cellLoadSamples: observerZero })).toThrow();
    expect(() =>
      requireStreamingEvidence({ ...stored, cellLoadSamples: hydrationOrdinal }),
    ).toThrow();
  });

  it("accepts a truncated raw boundary subset and rejects tampering with that subset", () => {
    const fixture = agedBoundaryFixture(9, 9, 255);
    const stored = requireStreamingEvidence(fixture.end, fixture.start);
    expect(stored.cellLoadSamples[0]).toMatchObject({
      batchCellOrdinal: 9,
      batchOrdinal: 2,
      sequence: 9,
    });
    expect(() => requireStreamingEvidence(stored)).not.toThrow();

    const tamperedRetainedSubset = stored.cellLoadSamples.map((sample, index) =>
      index === 0 ? { ...sample, cellId: "tampered-retained-boundary-cell" } : sample,
    );
    expect(() =>
      requireStreamingEvidence({
        ...stored,
        cellLoadSamples: tamperedRetainedSubset,
      }),
    ).toThrow();
  });

  it("round-trips an ordinal-3 boundary truncated after a smaller prior batch", () => {
    const fixture = smallPriorBatchFixture(255);
    const stored = requireStreamingEvidence(fixture.end, fixture.start);
    expect(stored.cellLoadSamples[0]).toMatchObject({
      batchCellOrdinal: 9,
      batchOrdinal: 3,
      sequence: 10,
    });
    expect(stored.measurementStartBatch?.completedCellIds).toHaveLength(9);
    expect(() => requireStreamingEvidence(stored)).not.toThrow();
  });

  it("requires exact boundary facts when the complete raw boundary remains retained", () => {
    const fixture = smallPriorBatchFixture(10);
    const stored = requireStreamingEvidence(fixture.end, fixture.start);
    expect(() => requireStreamingEvidence(stored)).not.toThrow();
    const boundary = stored.measurementStartBatch;
    if (boundary === null) throw new Error("Expected a stored boundary batch");
    const tamperedIds = boundary.completedCellIds.map((cellId, index) =>
      index === 0 ? "tampered-nontruncated-boundary-cell" : cellId,
    );
    expect(() =>
      requireStreamingEvidence({
        ...stored,
        measurementStartBatch: {
          ...boundary,
          completedCellIds: tamperedIds,
        },
      }),
    ).toThrow();
  });

  it("rejects conflicting identity and ordinal regression in the retained pre-window prefix", () => {
    const samples = generatedSamples(30, 1, 2, 1);
    const end = generatedSnapshot(samples, 30, 4, 3);
    const start = generatedSnapshot(samples.slice(0, 18), 18, 2);
    const stored = requireStreamingEvidence(end, start);

    const conflictingMetadata = stored.cellLoadSamples.map((sample, index) =>
      index === 0 ? { ...sample, batchCellCount: 8 } : sample,
    );
    expect(() =>
      requireStreamingEvidence({
        ...stored,
        cellLoadSamples: conflictingMetadata,
      }),
    ).toThrow();

    const regressingOrdinal = stored.cellLoadSamples.map((sample, index) =>
      index === 0
        ? {
            ...sample,
            batchObserverUpdateCount: 2,
            batchOrdinal: 3,
          }
        : sample,
    );
    expect(() =>
      requireStreamingEvidence({
        ...stored,
        cellLoadSamples: regressingOrdinal,
      }),
    ).toThrow();

    const agedFixture = agedBoundaryFixture(9, 9, 255);
    const conflictingLiveStart = agedFixture.start.cellLoadSamples.map((sample, index) =>
      index === 0 ? { ...sample, batchCellCount: 8 } : sample,
    );
    expect(() =>
      requireStreamingEvidence(agedFixture.end, {
        ...agedFixture.start,
        cellLoadSamples: conflictingLiveStart,
      }),
    ).toThrow();

    const noncontiguousLiveStart = agedFixture.start.cellLoadSamples.map((sample, index) =>
      index === 0 ? { ...sample, sequence: 2 } : sample,
    );
    expect(() =>
      requireStreamingEvidence(agedFixture.end, {
        ...agedFixture.start,
        cellLoadSamples: noncontiguousLiveStart,
      }),
    ).toThrow();
  });

  it("rejects abandoning an incomplete active start batch for an ordinal successor", () => {
    const fixture = agedBoundaryFixture(2, 9, 256);
    const boundary = fixture.start.cellLoadSamples;
    const successors = generatedSamples(256, 3, 3, 2);
    const end = generatedSnapshot(successors, 258, 30);
    const start = generatedSnapshot(boundary, 2, 2, 0);
    expect(() => requireStreamingEvidence(end, start)).toThrow(/batch identity is invalid/);
  });

  it("orders the first measured batch after a zero-count start settlement watermark", () => {
    const fixture = (
      firstObserverUpdateCount: number,
      secondObserverUpdateCount = firstObserverUpdateCount + 1,
    ) => {
      const first = boundarySamples(1).map((sample) => ({
        ...sample,
        batchObserverUpdateCount: firstObserverUpdateCount,
      }));
      const second = generatedSamples(9, 2, 3, secondObserverUpdateCount);
      const end = generatedSnapshot([...first, ...second], 10, secondObserverUpdateCount);
      const start: WorldStreamingTelemetrySnapshot = {
        ...end,
        cellLoadSampleCount: 0,
        cellLoadSamples: [],
        observerUpdateCount: 10,
        proactiveEvictionCount: 0,
        settledObserverUpdateCount: 9,
      };
      return { end, start };
    };

    const impossible = fixture(1, 11);
    expect(() => requireStreamingEvidence(impossible.end, impossible.start)).toThrow(
      /batch identity is invalid/,
    );
    for (const producerValidFirstObserver of [10, 11]) {
      const valid = fixture(producerValidFirstObserver);
      expect(() => requireStreamingEvidence(valid.end, valid.start)).not.toThrow();
    }
  });

  it("rejects a self-declared favorable suffix shorter than ten samples", () => {
    const telemetry = validTelemetry();
    expect(() =>
      requireStreamingEvidence({
        ...telemetry,
        measurementStartBatch: {
          batchCellCount: 3,
          batchFlythroughObserverSequence: 0,
          batchObserverUpdateCount: 2,
          batchOrdinal: 3,
          completedCellIds: ["cell-9"],
          completedCellOrdinals: [1],
        },
        measurementStartCellLoadSampleCount: 10,
        measurementStartFlythroughObserverUpdateCount: 0,
        measurementStartObserverUpdateCount: 2,
        measurementStartProactiveEvictionCount: 10,
        measurementStartSettledObserverUpdateCount: 1,
      }),
    ).toThrow(/at least 10 completed replacements/);
  });

  it("accepts snapshots that bisect the eviction-before-load schedule phase", () => {
    const telemetry = validTelemetry();
    const endSkew = requireStreamingEvidence(
      withSettledCheckpoint({
        ...telemetry,
        proactiveEvictionCount: telemetry.proactiveEvictionCount + 1,
        residentCellCount: STREAMING_RESIDENT_CELL_LIMIT - 1,
        residentCellIds: telemetry.residentCellIds.slice(0, STREAMING_RESIDENT_CELL_LIMIT - 1),
        settledObserverUpdateCount: telemetry.settledObserverUpdateCount - 1,
      }),
    );
    expect(endSkew.measurementProactiveEvictionCount).toBe(13);

    const startSkew = requireStreamingEvidence(
      telemetry,
      withSettledCheckpoint({
        ...telemetry,
        cellLoadSampleCount: 2,
        cellLoadSamples: telemetry.cellLoadSamples.slice(0, 2),
        observerUpdateCount: 1,
        proactiveEvictionCount: 3,
        residentCellCount: STREAMING_RESIDENT_CELL_LIMIT - 1,
        residentCellIds: telemetry.residentCellIds.slice(0, STREAMING_RESIDENT_CELL_LIMIT - 1),
        settledObserverUpdateCount: 0,
      }),
    );
    expect(startSkew.measurementCellLoadSamples).toHaveLength(10);
    expect(startSkew.measurementProactiveEvictionCount).toBe(9);
  });

  it("accepts the short smoke window with an unsettled start and settled or active end", () => {
    for (const endSettled of [false, true]) {
      const fixture = shortSmokeWindowFixture(endSettled);
      const result = tryRequireStreamingEvidence(fixture.end, fixture.start);
      expect(result.state).toBe("measured");
      if (result.state === "measured") {
        expect(result.value.measurementStartBatch).toMatchObject({
          batchObserverUpdateCount: 2,
          batchOrdinal: 2,
        });
        expect(result.value.measurementStartFlythroughObserverUpdateCount).toBe(0);
        expect(result.value.measurementStartObserverUpdateCount).toBe(6);
        expect(result.value.measurementStartSettledObserverUpdateCount).toBe(5);
        expect(result.value.measurementStartResidentCellCount).toBe(9);
        expect(result.value.residentCellCount).toBe(endSettled ? 9 : 8);
        expect(() => requireStreamingEvidence(result.value)).not.toThrow();
      }
    }
  });

  it("retains localized raw start/end snapshots when short smoke evidence is invalid", () => {
    const fixture = shortSmokeWindowFixture(false);
    const invalidEnd = { ...fixture.end, residentCellCount: 0 };
    const result = tryRequireStreamingEvidence(invalidEnd, fixture.start);
    expect(result).toMatchObject({
      failure: {
        measurementEnd: { residentCellCount: 0 },
        measurementStart: {
          observerUpdateCount: 6,
          settledObserverUpdateCount: 5,
        },
        reason: expect.stringContaining("residentCellCount=0"),
      },
      state: "invalid",
    });
  });

  it("rejects residency changes that do not match completion and eviction deltas", () => {
    const telemetry = validTelemetry();
    const start = {
      ...telemetry,
      cellLoadSampleCount: 0,
      cellLoadSamples: [],
      observerUpdateCount: 0,
      proactiveEvictionCount: 0,
      settledObserverUpdateCount: 0,
    };
    expect(() =>
      requireStreamingEvidence(
        {
          ...telemetry,
          proactiveEvictionCount: telemetry.cellLoadSampleCount + STREAMING_RESIDENT_CELL_LIMIT + 1,
        },
        start,
      ),
    ).toThrow(/inconsistent residency\/eviction evidence/);
  });

  it.each([
    ["inconsistent total decomposition", { totalMs: 50 }, /cell-load samples are invalid/],
    ["worker duration outside its round trip", { decodeMs: 4 }, /cell-load samples are invalid/],
    ["duplicate batch cell ordinal", { batchCellOrdinal: 1 }, /batch identity is invalid/],
    ["skipped batch ordinal", { batchOrdinal: 4 }, /cell-load samples are invalid/],
    ["duplicate batch cell ID", { cellId: "cell-0" }, /batch identity is invalid/],
  ])("rejects malformed attribution: %s", (_label, samplePatch, reason) => {
    const telemetry = validTelemetry();
    const samples = telemetry.cellLoadSamples.map((sample, index) =>
      index === 1 ? { ...sample, ...samplePatch } : sample,
    );
    expect(() => requireStreamingEvidence({ ...telemetry, cellLoadSamples: samples })).toThrow(
      reason,
    );
  });

  it("rejects distinct batches that reuse one observer-update identity", () => {
    const telemetry = validTelemetry();
    const samples = telemetry.cellLoadSamples.map((sample) =>
      sample.batchOrdinal === 3 ? { ...sample, batchObserverUpdateCount: 1 } : sample,
    );
    expect(() => requireStreamingEvidence({ ...telemetry, cellLoadSamples: samples })).toThrow();
  });

  it("rejects a flythrough sequence delta larger than its total observer delta", () => {
    const telemetry = validTelemetry();
    const samples = telemetry.cellLoadSamples.map((sample) =>
      sample.batchOrdinal === 3
        ? {
            ...sample,
            batchFlythroughObserverSequence: 2,
            batchObserverUpdateCount: 2,
          }
        : sample,
    );
    expect(() =>
      requireStreamingEvidence({
        ...telemetry,
        cellLoadSamples: samples,
        flythroughObserverUpdateCount: 2,
      }),
    ).toThrow(/batch identity is invalid/);
  });

  it("rejects an incomplete interior batch", () => {
    const telemetry = validTelemetry();
    const cellLoadSamples = telemetry.cellLoadSamples
      .filter((_sample, index) => index !== 1)
      .map((sample, index) => ({ ...sample, sequence: index + 1 }));
    expect(() =>
      requireStreamingEvidence({
        ...telemetry,
        cellLoadSampleCount: cellLoadSamples.length,
        cellLoadSamples,
        proactiveEvictionCount: cellLoadSamples.length,
      }),
    ).toThrow(/batch identity is invalid/);
  });

  it("rejects an incomplete final batch when the end snapshot is settled", () => {
    const telemetry = validTelemetry();
    const cellLoadSamples = telemetry.cellLoadSamples.slice(0, -1);
    expect(() =>
      requireStreamingEvidence({
        ...telemetry,
        cellLoadSampleCount: cellLoadSamples.length,
        cellLoadSamples,
        proactiveEvictionCount: cellLoadSamples.length,
      }),
    ).toThrow(/batch identity is invalid/);
  });

  it("accepts only the active final batch as truncated at an unsettled end snapshot", () => {
    const telemetry = validTelemetry();
    const cellLoadSamples = telemetry.cellLoadSamples.slice(0, 10);
    const evidence = requireStreamingEvidence(
      withSettledCheckpoint({
        ...telemetry,
        cellLoadSampleCount: cellLoadSamples.length,
        cellLoadSamples,
        observerUpdateCount: 2,
        proactiveEvictionCount: cellLoadSamples.length,
        settledObserverUpdateCount: 1,
      }),
    );
    expect(evidence.measurementCellLoadSamples).toHaveLength(10);
    expect(evidence.measurementCellLoadSamples.at(-1)?.batchOrdinal).toBe(3);
  });

  it("rejects a truncated final batch already covered by the last settled observer", () => {
    const telemetry = validTelemetry();
    const cellLoadSamples = telemetry.cellLoadSamples.slice(0, 10);
    expect(() =>
      requireStreamingEvidence(
        withSettledCheckpoint({
          ...telemetry,
          cellLoadSampleCount: cellLoadSamples.length,
          cellLoadSamples,
          observerUpdateCount: 3,
          proactiveEvictionCount: cellLoadSamples.length,
          settledObserverUpdateCount: 2,
        }),
      ),
    ).toThrow(/batch identity is invalid/);
  });

  it("rejects settlement regression that would otherwise authorize a final partial batch", () => {
    const telemetry = validTelemetry();
    const cellLoadSamples = telemetry.cellLoadSamples.slice(0, 10).map((sample) => ({
      ...sample,
      batchObserverUpdateCount: sample.batchOrdinal === 2 ? 3 : 4,
    }));
    const end = withSettledCheckpoint({
      ...telemetry,
      cellLoadSampleCount: cellLoadSamples.length,
      cellLoadSamples,
      observerUpdateCount: 4,
      proactiveEvictionCount: cellLoadSamples.length,
      settledObserverUpdateCount: 1,
    });
    const start = withSettledCheckpoint({
      ...end,
      cellLoadSampleCount: 0,
      cellLoadSamples: [],
      observerUpdateCount: 2,
      proactiveEvictionCount: 0,
      settledObserverUpdateCount: 2,
    });
    expect(() => requireStreamingEvidence(end, start)).toThrow();
  });

  it("uses the last settled batch identity to reject a skipped first measurement batch", () => {
    const telemetry = validTelemetry();
    const cellLoadSamples = telemetry.cellLoadSamples.map((sample, index) => {
      if (index < 2) {
        return {
          ...sample,
          batchCellCount: 2,
          batchCellOrdinal: index + 1,
          batchObserverUpdateCount: 1,
          batchOrdinal: 2,
        };
      }
      if (index < 11) {
        return {
          ...sample,
          batchCellCount: 9,
          batchCellOrdinal: index - 1,
          batchObserverUpdateCount: 3,
          batchOrdinal: 4,
        };
      }
      return {
        ...sample,
        batchCellCount: 1,
        batchCellOrdinal: 1,
        batchObserverUpdateCount: 4,
        batchOrdinal: 5,
      };
    });
    const end = withSettledCheckpoint({
      ...telemetry,
      cellLoadSamples,
      observerUpdateCount: 4,
      settledObserverUpdateCount: 4,
    });
    const start = withSettledCheckpoint({
      ...end,
      cellLoadSampleCount: 2,
      cellLoadSamples: cellLoadSamples.slice(0, 2),
      observerUpdateCount: 1,
      proactiveEvictionCount: 2,
      settledObserverUpdateCount: 1,
    });
    expect(() => requireStreamingEvidence(end, start)).toThrow(/batch identity is invalid/);
  });

  it.each([
    ["not ready", { ...validTelemetry(), state: "provisioning" }],
    ["no proactive eviction", { ...validTelemetry(), proactiveEvictionCount: 0 }],
    ["encoded-budget rejection", { ...validTelemetry(), cpuBudgetRejectionCount: 1 }],
    ["unbounded residency", { ...validTelemetry(), residentCellCount: 10 }],
    ["unbounded queue", { ...validTelemetry(), decodeQueueDepthHighWater: 10 }],
    ["invalid hardware count", { ...validTelemetry(), hardwareConcurrency: Number.NaN }],
    [
      "invalid encoded high water",
      { ...validTelemetry(), residentEncodedBytesHighWater: Number.NaN },
    ],
    ["invalid GPU high water", { ...validTelemetry(), residentGpuBytesHighWater: Number.NaN }],
    ["invalid read attribution", { ...validTelemetry(), encodedBytesRead: Number.NaN }],
    ["invalid provision attribution", { ...validTelemetry(), opfsProvisionedBytes: Number.NaN }],
    ["missing GPU residency", { ...validTelemetry(), residentGpuBytes: 0 }],
    [
      "too few samples",
      { ...validTelemetry(), cellLoadSamples: validTelemetry().cellLoadSamples.slice(0, 9) },
    ],
  ])("rejects %s", (_label, telemetry) => {
    expect(() => requireStreamingEvidence(telemetry)).toThrow();
  });
});
