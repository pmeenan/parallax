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
      batchDirectUploadMs: index < 9 ? 27 : 9,
      batchCellCount: index < 9 ? 9 : 3,
      batchCellOrdinal: index < 9 ? index + 1 : index - 8,
      batchFlythroughObserverSequence: 0,
      batchObserverUpdateCount: index < 9 ? 1 : 2,
      batchOrdinal: index < 9 ? 2 : 3,
      batchTransactionId: index < 9 ? "1:2:1:0" : "1:3:2:0",
      cellId: `cell-${index}`,
      decodeMs: 1,
      decodeRoundTripMs: 2,
      decodeWaitMs: 1,
      encodedBytes: 10_000,
      gpuBytes: 20_000,
      opfsAccessRoundTripMs: 3,
      opfsReadMs: 2,
      opfsWaitMs: 1,
      renderTransactionRoundTripMs: 5,
      renderTransactionWaitMs: 2,
      sequence: index + 1,
      streamingWorkerRemainderMs: index,
      totalMs: 10 + index,
      uploadMs: 3,
    })),
    decodeQueueDepthHighWater: 9,
    decodeWorkerCount: 4,
    cpuBudgetRejectionCount: 0,
    currentObservers: Object.freeze([[0, 12, 0] as const]),
    districtId: "district-1-surface",
    districtSwapCount: 0,
    districtSwapInProgress: false,
    districtSwapSamples: Object.freeze([]),
    encodedBytesRead: 120_000,
    failureMessage: null,
    flythroughObserverUpdateCount: 0,
    hardwareConcurrency: 16,
    installedReleaseDigest: null,
    installedResourceBytes: 0,
    installedResourceCount: 0,
    legacyNetworkRequestCount: 2,
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
    renderBatchCellCountHighWater: 9,
    renderBatchDirectUploadMsHighWater: 27,
    renderBatchRequestCount: 2,
    renderBatchTransactionCount: 2,
    schemaVersion: 13,
    settledRecoveryCheckpoint: Object.freeze({
      flythroughObserverUpdateCount: 0,
      observerUpdateCount: 12,
      observers: Object.freeze([[0, 12, 0] as const]),
      residentCellIds: Object.freeze(["a", "b", "c", "d", "e", "f", "g", "h", "i"]),
      workerGeneration: 1,
    }),
    settledObserverUpdateCount: 12,
    state: "streaming",
    startupTiming: {
      accessHandlesOpenedAtMs: 4,
      contract: "streaming-startup-timing@1",
      decodePoolCreatedAtMs: 5,
      finalAdmissionCompletedAtMs: null,
      initialResidencyReadyAtMs: 6,
      provisioningStartedAtMs: 2,
      releaseBindingCompletedAtMs: null,
      releaseResolutionCompletedAtMs: 3,
      schemaVersion: 1,
      sourceKind: "privileged-legacy-network",
      workerStartedAtMs: 1,
    },
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
        batchTransactionId: "1:2:1:0",
        batchDirectUploadMs: 6,
      };
    }
    if (index < 11) {
      return {
        ...sample,
        batchCellCount: 9,
        batchCellOrdinal: index - 1,
        batchObserverUpdateCount: successorObserverUpdateCount,
        batchOrdinal: 3,
        batchTransactionId: `1:3:${successorObserverUpdateCount}:0`,
        batchDirectUploadMs: 27,
      };
    }
    return {
      ...sample,
      batchCellCount: 1,
      batchCellOrdinal: 1,
      batchObserverUpdateCount: 3,
      batchOrdinal: 4,
      batchTransactionId: "1:4:3:0",
      batchDirectUploadMs: 3,
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
        batchTransactionId: `1:${batchOrdinal}:${batchObserverUpdateCount}:0`,
        batchDirectUploadMs: batchCellCount * template.uploadMs,
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
      batchTransactionId: "1:2:1:0",
      batchDirectUploadMs: batchCellCount * template.uploadMs,
      cellId: `boundary-${index + 1}`,
      sequence: index + 1,
      streamingWorkerRemainderMs: index + 1,
      totalMs: index + 11,
    })),
  );
}

function launchHydrationSamples(
  completedCellCount = STREAMING_RESIDENT_CELL_LIMIT,
  batchCellCount = completedCellCount,
): readonly StreamingCellLoadTelemetry[] {
  const template = validTelemetry().cellLoadSamples[0];
  if (template === undefined) throw new Error("Streaming fixture has no sample");
  return Object.freeze(
    Array.from({ length: completedCellCount }, (_, index) => ({
      ...template,
      batchCellCount,
      batchCellOrdinal: index + 1,
      batchObserverUpdateCount: 0,
      batchOrdinal: 1,
      batchTransactionId: "1:1:0:0",
      batchDirectUploadMs: batchCellCount * template.uploadMs,
      cellId: `hydration-${index + 1}`,
      sequence: index + 1,
      streamingWorkerRemainderMs: 1_000 + index,
      totalMs: 1_010 + index,
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

function completeStartFixture(measuredSampleCount = 10): Readonly<{
  end: WorldStreamingTelemetrySnapshot;
  start: WorldStreamingTelemetrySnapshot;
}> {
  const boundary = boundarySamples(9);
  const measured = generatedSamples(measuredSampleCount, 10, 3, 2);
  const allSamples = [...boundary, ...measured];
  const lastObserverUpdateCount = allSamples.at(-1)?.batchObserverUpdateCount ?? 2;
  return Object.freeze({
    end: generatedSnapshot(allSamples, allSamples.length, lastObserverUpdateCount),
    start: generatedSnapshot(boundary, boundary.length, 1),
  });
}

function launchHydrationBoundaryFixture(measuredSampleCount = 10): Readonly<{
  end: WorldStreamingTelemetrySnapshot;
  start: WorldStreamingTelemetrySnapshot;
}> {
  const hydration = launchHydrationSamples();
  const measured = generatedSamples(measuredSampleCount, hydration.length + 1, 2, 1);
  const allSamples = [...hydration, ...measured];
  const lastObserverUpdateCount = measured.at(-1)?.batchObserverUpdateCount ?? 0;
  const installedRelease = {
    installedReleaseDigest: "a".repeat(64),
    installedResourceBytes: 60,
    installedResourceCount: 3,
    legacyNetworkRequestCount: 0,
    startupTiming: {
      accessHandlesOpenedAtMs: 5,
      contract: "streaming-startup-timing@1" as const,
      decodePoolCreatedAtMs: 7,
      finalAdmissionCompletedAtMs: 6,
      initialResidencyReadyAtMs: 8,
      provisioningStartedAtMs: 2,
      releaseBindingCompletedAtMs: 3,
      releaseResolutionCompletedAtMs: 4,
      schemaVersion: 1 as const,
      sourceKind: "installed-release" as const,
      workerStartedAtMs: 1,
    },
  };
  return Object.freeze({
    end: {
      ...generatedSnapshot(allSamples, allSamples.length, lastObserverUpdateCount),
      ...installedRelease,
      proactiveEvictionCount: measured.length,
    },
    start: {
      ...generatedSnapshot(hydration, hydration.length, 0),
      ...installedRelease,
      proactiveEvictionCount: 0,
    },
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
      batchTransactionId: `1:${batchOrdinal}:${batchObserverUpdateCount}:0`,
      batchDirectUploadMs: batchCellCount * template.uploadMs,
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
  it("requires mutually exclusive installed and privileged legacy content identity", () => {
    const legacy = validTelemetry();
    expect(() => requireStreamingEvidence(legacy)).not.toThrow();
    const installed = {
      ...legacy,
      installedReleaseDigest: "a".repeat(64),
      installedResourceBytes: 1_000,
      installedResourceCount: 2,
      legacyNetworkRequestCount: 0,
      startupTiming: {
        accessHandlesOpenedAtMs: 5,
        contract: "streaming-startup-timing@1" as const,
        decodePoolCreatedAtMs: 7,
        finalAdmissionCompletedAtMs: 6,
        initialResidencyReadyAtMs: 8,
        provisioningStartedAtMs: 2,
        releaseBindingCompletedAtMs: 3,
        releaseResolutionCompletedAtMs: 4,
        schemaVersion: 1 as const,
        sourceKind: "installed-release" as const,
        workerStartedAtMs: 1,
      },
    };
    expect(() => requireStreamingEvidence(installed)).not.toThrow();
    expect(() => requireStreamingEvidence({ ...installed, legacyNetworkRequestCount: 1 })).toThrow(
      /content source/,
    );
    expect(() => requireStreamingEvidence({ ...legacy, legacyNetworkRequestCount: 0 })).toThrow(
      /content source/,
    );
  });

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
      renderTransactionRoundTripMs: 5,
      renderTransactionWaitMs: 2,
      streamingWorkerRemainderMs: 11,
      uploadMs: 3,
    });
  });

  it("requires exact batch transaction counters and high-water observations", () => {
    const telemetry = validTelemetry();
    for (const mutation of [
      { renderBatchRequestCount: 4 },
      { renderBatchTransactionCount: 0 },
      { renderBatchCellCountHighWater: 10 },
      { renderBatchDirectUploadMsHighWater: Number.NaN },
    ]) {
      expect(() => requireStreamingEvidence({ ...telemetry, ...mutation })).toThrow(
        /render batch transactions/,
      );
    }
  });

  it("allows one unsettled request and requires exact request/completion equality when settled", () => {
    const telemetry = validTelemetry();
    const checkpoint = telemetry.settledRecoveryCheckpoint;
    if (checkpoint === null) throw new Error("Test checkpoint is absent");
    expect(() =>
      requireStreamingEvidence({
        ...telemetry,
        renderBatchRequestCount: telemetry.renderBatchTransactionCount + 1,
        settledRecoveryCheckpoint: {
          ...checkpoint,
          observerUpdateCount: telemetry.observerUpdateCount - 1,
        },
        settledObserverUpdateCount: telemetry.observerUpdateCount - 1,
      }),
    ).not.toThrow();
    expect(() =>
      requireStreamingEvidence({
        ...telemetry,
        renderBatchRequestCount: telemetry.renderBatchTransactionCount + 1,
      }),
    ).toThrow(/render batch transactions/);
  });

  it("rejects streaming-v8 counter and timing shapes", () => {
    const telemetry = validTelemetry();
    const { renderBatchRequestCount: _requestCount, ...withoutRequestCount } = telemetry;
    expect(() =>
      requireStreamingEvidence({
        ...withoutRequestCount,
        renderBatchCommitRequestCount: 2,
        renderBatchUploadRequestCount: 2,
        schemaVersion: 8,
      } as unknown as WorldStreamingTelemetrySnapshot),
    ).toThrow(/schemaVersion=8; expected 13/);
    const [first, ...rest] = telemetry.cellLoadSamples;
    if (first === undefined) throw new Error("Test sample is absent");
    const {
      renderTransactionRoundTripMs: _transactionRoundTrip,
      renderTransactionWaitMs: _transactionWait,
      ...withoutTransactionTiming
    } = first;
    expect(() =>
      requireStreamingEvidence({
        ...telemetry,
        cellLoadSamples: [
          {
            ...withoutTransactionTiming,
            renderCommitRoundTripMs: 1,
            renderUploadRoundTripMs: 4,
            renderUploadWaitMs: 1,
          },
          ...rest,
        ],
      } as unknown as WorldStreamingTelemetrySnapshot),
    ).toThrow(/cell-load samples are invalid/);
  });

  it.each([
    ["transaction decomposition", { renderTransactionWaitMs: 2.100_001 }],
    ["total decomposition", { totalMs: 10.100_001 }],
  ])("rejects independent timing conservation drift beyond 0.1 ms: %s", (_label, patch) => {
    const telemetry = validTelemetry();
    const samples = telemetry.cellLoadSamples.map((sample, index) =>
      index === 0 ? { ...sample, ...patch } : sample,
    );
    expect(() => requireStreamingEvidence({ ...telemetry, cellLoadSamples: samples })).toThrow(
      /cell-load samples are invalid/,
    );
  });

  it("rejects noncanonical batch transaction identity, including internally consistent arbitrary IDs", () => {
    const telemetry = validTelemetry();
    const inconsistent = telemetry.cellLoadSamples.map((sample, index) =>
      index === 1 ? { ...sample, batchTransactionId: "different" } : sample,
    );
    expect(() =>
      requireStreamingEvidence({ ...telemetry, cellLoadSamples: inconsistent }),
    ).toThrow();
    const reused = telemetry.cellLoadSamples.map((sample) =>
      sample.batchOrdinal === 3
        ? { ...sample, batchTransactionId: "1:2:1:0", batchDirectUploadMs: 9 }
        : sample,
    );
    expect(() => requireStreamingEvidence({ ...telemetry, cellLoadSamples: reused })).toThrow(
      /cell-load samples are invalid/,
    );
    const arbitraryButInternallyConsistent = telemetry.cellLoadSamples.map((sample) => ({
      ...sample,
      batchTransactionId: sample.batchOrdinal === 2 ? "arbitrary-first" : "arbitrary-second",
    }));
    expect(() =>
      requireStreamingEvidence({ ...telemetry, cellLoadSamples: arbitraryButInternallyConsistent }),
    ).toThrow(/cell-load samples are invalid/);
  });

  it("requires batch direct-upload time to contain member direct uploads", () => {
    const telemetry = validTelemetry();
    const samples = telemetry.cellLoadSamples.map((sample, index) =>
      index < 9 ? { ...sample, batchDirectUploadMs: 26 } : sample,
    );
    expect(() => requireStreamingEvidence({ ...telemetry, cellLoadSamples: samples })).toThrow(
      /batch identity/,
    );
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
    const { end, start } = completeStartFixture();
    const evidence = requireStreamingEvidence(end, start);
    expect(evidence.cellLoadP95Ms).toBe(29);
    expect(evidence.measurementCellLoadSamples).toHaveLength(10);
    expect(evidence.measurementProactiveEvictionCount).toBe(10);
    expect(evidence.measurementStartBatch).toEqual({
      batchDirectUploadMs: 27,
      batchCellCount: 9,
      batchFlythroughObserverSequence: 0,
      batchObserverUpdateCount: 1,
      batchOrdinal: 2,
      batchTransactionId: "1:2:1:0",
      completedCellIds: [
        "boundary-1",
        "boundary-2",
        "boundary-3",
        "boundary-4",
        "boundary-5",
        "boundary-6",
        "boundary-7",
        "boundary-8",
        "boundary-9",
      ],
      completedCellOrdinals: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    });
  });

  it("accepts the canonical launch-hydration runner boundary without measuring hydration", () => {
    const { end, start } = launchHydrationBoundaryFixture();
    const result = tryRequireStreamingEvidence(end, start);
    expect(result.state).toBe("measured");
    if (result.state !== "measured") throw new Error(result.failure.reason);
    expect(result.value.measurementStartBatch).toMatchObject({
      batchCellCount: STREAMING_RESIDENT_CELL_LIMIT,
      batchFlythroughObserverSequence: 0,
      batchObserverUpdateCount: 0,
      batchOrdinal: 1,
      batchTransactionId: "1:1:0:0",
      completedCellOrdinals: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    });
    expect(result.value.measurementStartCellLoadSampleCount).toBe(9);
    expect(result.value.measurementCellLoadSamples.map(({ sequence }) => sequence)).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);
    expect(
      result.value.measurementCellLoadSamples.every(({ batchOrdinal }) => batchOrdinal >= 2),
    ).toBe(true);
    expect(result.value.cellLoadP95Ms).toBe(29);
    expect(result.value.cellLoadP95Ms).toBeLessThan(start.cellLoadSamples[0]?.totalMs ?? 0);
  });

  it("round-trips the launch-hydration boundary after the 256-entry ring evicts it", () => {
    const fixture = launchHydrationBoundaryFixture(256);
    const end = {
      ...fixture.end,
      cellLoadSamples: fixture.end.cellLoadSamples.slice(-256),
    };
    const stored = requireStreamingEvidence(end, fixture.start);
    expect(stored.cellLoadSamples).toHaveLength(256);
    expect(stored.cellLoadSamples[0]?.sequence).toBe(10);
    expect(stored.measurementCellLoadSamples).toHaveLength(256);
    expect(stored.measurementCellLoadSamples.every(({ batchOrdinal }) => batchOrdinal >= 2)).toBe(
      true,
    );
    expect(() => requireStreamingEvidence(stored)).not.toThrow();
    const boundary = stored.measurementStartBatch;
    if (boundary === null) throw new Error("Launch-hydration boundary is absent");
    expect(() =>
      requireStreamingEvidence({
        ...stored,
        measurementStartBatch: {
          ...boundary,
          completedCellOrdinals: [...boundary.completedCellOrdinals].reverse(),
        },
      }),
    ).toThrow();
  });

  it("accepts a zero-observer launch batch behind a later measurement-start watermark", () => {
    const hydration = launchHydrationSamples();
    const measured = generatedSamples(10, 10, 2, 2);
    const end = {
      ...generatedSnapshot([...hydration, ...measured], 19, 3),
      proactiveEvictionCount: measured.length,
    };
    const start = {
      ...generatedSnapshot(hydration, hydration.length, 1),
      proactiveEvictionCount: 0,
    };
    const evidence = requireStreamingEvidence(end, start);
    expect(evidence.measurementStartBatch).toMatchObject({
      batchFlythroughObserverSequence: 0,
      batchObserverUpdateCount: 0,
      batchOrdinal: 1,
    });
    expect(evidence.measurementCellLoadSamples.map(({ sequence }) => sequence)).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);
  });

  it("rejects malformed or replayed launch-hydration boundary batches", () => {
    const fixture = launchHydrationBoundaryFixture();
    const mutateHydration = (
      mutate: (sample: StreamingCellLoadTelemetry, index: number) => StreamingCellLoadTelemetry,
    ): Readonly<{ end: WorldStreamingTelemetrySnapshot; start: WorldStreamingTelemetrySnapshot }> =>
      Object.freeze({
        end: {
          ...fixture.end,
          cellLoadSamples: fixture.end.cellLoadSamples.map((sample, index) =>
            index < STREAMING_RESIDENT_CELL_LIMIT ? mutate(sample, index) : sample,
          ),
        },
        start: {
          ...fixture.start,
          cellLoadSamples: fixture.start.cellLoadSamples.map(mutate),
        },
      });
    const malformed = [
      mutateHydration((sample) => ({ ...sample, batchCellCount: 10 })),
      mutateHydration((sample, index) =>
        index === 1 ? { ...sample, batchCellOrdinal: 1 } : sample,
      ),
      mutateHydration((sample, index) =>
        index === 1 ? { ...sample, cellId: "hydration-1" } : sample,
      ),
      mutateHydration((sample) => ({
        ...sample,
        batchObserverUpdateCount: 1,
        batchTransactionId: "1:1:1:0",
      })),
      mutateHydration((sample) => ({
        ...sample,
        batchFlythroughObserverSequence: 1,
        batchObserverUpdateCount: 1,
        batchTransactionId: "1:1:1:1",
      })),
      mutateHydration((sample) => ({ ...sample, batchTransactionId: "1:1:0:wrong" })),
    ];
    for (const candidate of malformed) {
      expect(() => requireStreamingEvidence(candidate.end, candidate.start)).toThrow();
    }

    const partialStart = {
      ...fixture.start,
      cellLoadSampleCount: fixture.start.cellLoadSampleCount - 1,
      cellLoadSamples: fixture.start.cellLoadSamples.slice(0, -1),
    };
    expect(() => requireStreamingEvidence(fixture.end, partialStart)).toThrow();

    const repeatedOrdinalOne = fixture.end.cellLoadSamples.map((sample) =>
      sample.batchOrdinal === 2
        ? {
            ...sample,
            batchObserverUpdateCount: 0,
            batchOrdinal: 1,
            batchTransactionId: "1:1:0:0",
          }
        : sample,
    );
    expect(() =>
      requireStreamingEvidence(
        { ...fixture.end, cellLoadSamples: repeatedOrdinalOne },
        fixture.start,
      ),
    ).toThrow();

    const ordinalOneAfterMovement = fixture.end.cellLoadSamples.map((sample, index, samples) =>
      index === samples.length - 1
        ? {
            ...sample,
            batchObserverUpdateCount: 0,
            batchOrdinal: 1,
            batchTransactionId: "1:1:0:0",
          }
        : sample,
    );
    expect(() =>
      requireStreamingEvidence(
        { ...fixture.end, cellLoadSamples: ordinalOneAfterMovement },
        fixture.start,
      ),
    ).toThrow();
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

  it("excludes the hydration prefix at the 256-sample ring boundary for smoke and traversal", () => {
    const base = validTelemetry();
    const template = base.cellLoadSamples[0];
    if (template === undefined) throw new Error("Streaming fixture has no sample");
    const samples = Array.from({ length: 256 }, (_, index) => ({
      ...(base.cellLoadSamples[index % base.cellLoadSamples.length] ?? template),
      batchCellCount: index < 252 ? 9 : 4,
      batchCellOrdinal: (index % 9) + 1,
      batchObserverUpdateCount: Math.floor(index / 9) + 2,
      batchOrdinal: Math.floor(index / 9) + 3,
      batchTransactionId: `1:${Math.floor(index / 9) + 3}:${Math.floor(index / 9) + 2}:0`,
      batchDirectUploadMs: index < 252 ? 27 : 12,
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
      cellLoadSampleCount: 247,
      cellLoadSamples: samples.filter((sample) => sample.sequence <= 247),
      observerUpdateCount: 28,
      proactiveEvictionCount: 247,
      settledObserverUpdateCount: 28,
    });
    const evidence = requireStreamingEvidence(end, start);
    expect(evidence.cellLoadSamples).toHaveLength(256);
    expect(evidence.measurementCellLoadSamples.map(({ sequence }) => sequence)).toEqual([
      248, 249, 250, 251, 252, 253, 254, 255, 256, 257, 258, 259, 260,
    ]);
    expect(evidence.measurementCellLoadSamples.every(({ sequence }) => sequence > 247)).toBe(true);
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
        batchTransactionId: `1:${batchOffset + 3}:${batchOffset + 2}:0`,
        batchDirectUploadMs: index < 252 ? 27 : 12,
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
    const { end: telemetry, start } = completeStartFixture();
    const evidence = requireStreamingEvidence({
      ...telemetry,
      measurementStartBatch: requireStreamingEvidence(telemetry, start).measurementStartBatch,
      measurementCellLoadSamples: [telemetry.cellLoadSamples[0]],
      measurementProactiveEvictionCount: 999,
      measurementStartCellLoadSampleCount: 9,
      measurementStartFlythroughObserverUpdateCount: 0,
      measurementStartObserverUpdateCount: 1,
      measurementStartProactiveEvictionCount: 9,
      measurementStartSettledObserverUpdateCount: 1,
    });
    expect(evidence.measurementCellLoadSamples.map(({ sequence }) => sequence)).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);
    expect(evidence.measurementProactiveEvictionCount).toBe(10);
  });

  it("round-trips stored start-boundary evidence and cross-checks the retained raw prefix", () => {
    const { end, start } = completeStartFixture();
    const stored = requireStreamingEvidence(end, start);
    expect(requireStreamingEvidence(stored).measurementStartBatch).toEqual(
      stored.measurementStartBatch,
    );

    const tamperedPrefix = stored.cellLoadSamples.map((sample) =>
      sample.sequence <= 9 ? { ...sample, cellId: `fake-${sample.sequence}` } : sample,
    );
    expect(() =>
      requireStreamingEvidence({ ...stored, cellLoadSamples: tamperedPrefix }),
    ).toThrow();
  });

  it("round-trips producer-valid boundary states across retention and settlement shapes", () => {
    const completeBoundary = completeStartFixture();
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
        end: completeBoundary.end,
        name: "retained complete boundary",
        start: completeBoundary.start,
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
        end: agedBoundaryFixture(9, 9, 256).end,
        name: "aged-out complete boundary and full measurement ring",
        start: agedBoundaryFixture(9, 9, 256).start,
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
    expect(() => requireStreamingEvidence(end, start)).toThrow(
      /measurement-start batch is invalid/,
    );
  });

  it("orders the first measured batch after a zero-count start settlement watermark", () => {
    const fixture = (
      firstObserverUpdateCount: number,
      secondObserverUpdateCount = firstObserverUpdateCount + 1,
    ) => {
      const first = boundarySamples(1).map((sample) => ({
        ...sample,
        batchObserverUpdateCount: firstObserverUpdateCount,
        batchTransactionId: `1:2:${firstObserverUpdateCount}:0`,
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
          batchDirectUploadMs: 27,
          batchCellCount: 9,
          batchFlythroughObserverSequence: 0,
          batchObserverUpdateCount: 1,
          batchOrdinal: 2,
          batchTransactionId: "1:2:1:0",
          completedCellIds: [
            "cell-0",
            "cell-1",
            "cell-2",
            "cell-3",
            "cell-4",
            "cell-5",
            "cell-6",
            "cell-7",
            "cell-8",
          ],
          completedCellOrdinals: [1, 2, 3, 4, 5, 6, 7, 8, 9],
        },
        measurementStartCellLoadSampleCount: 9,
        measurementStartFlythroughObserverUpdateCount: 0,
        measurementStartObserverUpdateCount: 1,
        measurementStartProactiveEvictionCount: 9,
        measurementStartSettledObserverUpdateCount: 1,
      }),
    ).toThrow(/at least 10 completed replacements/);
  });

  it("accepts snapshots that bisect the eviction-before-load schedule phase", () => {
    const { end: telemetry, start: completeStart } = completeStartFixture();
    const endSkew = requireStreamingEvidence(
      withSettledCheckpoint({
        ...telemetry,
        proactiveEvictionCount: telemetry.proactiveEvictionCount + 1,
        residentCellCount: STREAMING_RESIDENT_CELL_LIMIT - 1,
        residentCellIds: telemetry.residentCellIds.slice(0, STREAMING_RESIDENT_CELL_LIMIT - 1),
        settledObserverUpdateCount: telemetry.settledObserverUpdateCount - 1,
      }),
    );
    expect(endSkew.measurementProactiveEvictionCount).toBe(20);

    const startSkew = requireStreamingEvidence(
      telemetry,
      withSettledCheckpoint({
        ...completeStart,
        observerUpdateCount: 1,
        proactiveEvictionCount: 10,
        residentCellCount: STREAMING_RESIDENT_CELL_LIMIT - 1,
        residentCellIds: completeStart.residentCellIds.slice(0, STREAMING_RESIDENT_CELL_LIMIT - 1),
        settledObserverUpdateCount: 0,
      }),
    );
    expect(startSkew.measurementCellLoadSamples).toHaveLength(10);
    expect(startSkew.measurementProactiveEvictionCount).toBe(9);
  });

  it("accepts the short smoke window only after its final batch commits", () => {
    const fixture = shortSmokeWindowFixture(true);
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
      expect(result.value.residentCellCount).toBe(9);
      expect(() => requireStreamingEvidence(result.value)).not.toThrow();
    }
  });

  it("fails closed when the short smoke end snapshot retains a partial final batch", () => {
    const fixture = shortSmokeWindowFixture(false);
    const result = tryRequireStreamingEvidence(fixture.end, fixture.start);
    expect(result.state).toBe("invalid");
    if (result.state === "invalid") {
      expect(result.failure.reason).toContain("batch identity is invalid");
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
    ).toThrow(/cell-load samples are invalid/);
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

  it("rejects an active partial final batch at an unsettled end snapshot", () => {
    const telemetry = validTelemetry();
    const cellLoadSamples = telemetry.cellLoadSamples.slice(0, 10);
    expect(() =>
      requireStreamingEvidence(
        withSettledCheckpoint({
          ...telemetry,
          cellLoadSampleCount: cellLoadSamples.length,
          cellLoadSamples,
          observerUpdateCount: 2,
          proactiveEvictionCount: cellLoadSamples.length,
          settledObserverUpdateCount: 1,
        }),
      ),
    ).toThrow(/batch identity is invalid/);
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
      batchTransactionId: `1:${sample.batchOrdinal}:${sample.batchOrdinal === 2 ? 3 : 4}:0`,
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
          batchTransactionId: "1:2:1:0",
        };
      }
      if (index < 11) {
        return {
          ...sample,
          batchCellCount: 9,
          batchCellOrdinal: index - 1,
          batchObserverUpdateCount: 3,
          batchOrdinal: 4,
          batchTransactionId: "1:4:3:0",
        };
      }
      return {
        ...sample,
        batchCellCount: 1,
        batchCellOrdinal: 1,
        batchObserverUpdateCount: 4,
        batchOrdinal: 5,
        batchTransactionId: "1:5:4:0",
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
