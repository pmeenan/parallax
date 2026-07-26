import type { StreamingCellLoadTelemetry, WorldStreamingTelemetrySnapshot } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import { createStreamingDashboardModel } from "../src/ui/streaming-dashboard";

describe("streaming dashboard", () => {
  it("presents the authoritative running cohort, storage identity, pressure, and p95 stages", () => {
    const model = createStreamingDashboardModel(
      snapshot({
        cellLoadSampleCount: 3,
        cellLoadSamples: [
          sample(1, 10, 2, 3, 4, 0.5),
          sample(2, 20, 4, 6, 8, 1),
          sample(3, 15, 3, 5, 6, 0.75),
        ],
        cpuBudgetRejectionCount: 2,
        currentObservers: [
          [12, 4, -8],
          [20, 4, -2],
        ],
        decodeQueueDepthHighWater: 5,
        decodeWorkerCount: 4,
        encodedBytesRead: 3_145_728,
        hardwareConcurrency: 16,
        observerUpdateCount: 12,
        opfsAccessHandleCount: 256,
        opfsAccessHandleOpenDurationMs: 42.25,
        opfsPackageCount: 256,
        opfsProvisionedBytes: 8_388_608,
        proactiveEvictionCount: 7,
        renderRecoveryCount: 1,
        residentCellCount: 9,
        residentCellIds: ["d1/1", "d1/2", "d1/3", "d1/4", "d1/5", "d1/6", "d1/7", "d1/8", "d1/9"],
        residentEncodedBytes: 1_048_576,
        residentEncodedBytesHighWater: 2_097_152,
        residentGpuBytes: 4_194_304,
        residentGpuBytesHighWater: 8_388_608,
        settledObserverUpdateCount: 10,
        state: "streaming",
        workerGeneration: 2,
      }),
    );

    expect(model.announcement).toBe("Streaming streaming, generation 2, 9 of 9 resident cells.");
    expect(model.observerTargets).toEqual([
      "Observer 1: 12.0, 4.0, -8.0",
      "Observer 2: 20.0, 4.0, -2.0",
    ]);
    expect(metric(model, "generation")).toMatchObject({
      state: "warning",
      value: "generation 2 · 1 recovery",
    });
    expect(metric(model, "opfs-handles")).toMatchObject({
      state: "healthy",
      value: "256 / 256 packages",
    });
    expect(metric(model, "load-total")).toMatchObject({
      detail:
        "3 retained / 3 cumulative samples · max 20.000 ms · live retained history, not a budget verdict.",
      state: "neutral",
      value: "20.000 ms",
    });
    expect(metric(model, "stage-opfs")).toMatchObject({
      detail: "Nested work p95 2.000 ms · derived wait p95 2.000 ms.",
      value: "4.000 ms",
    });
    expect(metric(model, "stage-decode")).toMatchObject({ value: "6.000 ms" });
    expect(metric(model, "stage-upload")).toMatchObject({ value: "8.000 ms" });
    expect(metric(model, "stage-commit")).toMatchObject({ value: "1.000 ms" });
    expect(metric(model, "observer-settlement")).toMatchObject({
      detail: "2 updates awaiting settlement.",
      state: "warning",
    });
    expect(metric(model, "decode-queue")).toMatchObject({
      detail: "4 workers · 9 resident-cell capacity.",
      state: "healthy",
      value: "5",
    });
    expect(metric(model, "worker-stalls")).toMatchObject({
      state: "unavailable",
      value: "Unavailable",
    });
    expect(metric(model, "emergency-evictions")).toMatchObject({
      state: "unavailable",
      value: "Unavailable",
    });
    expect(metric(model, "encoded-budget-rejections")).toMatchObject({
      detail: "A rejection is terminal; it is not a scheduling deferral.",
      state: "error",
      value: "2",
    });
    expect(metric(model, "encoded-memory").detail).toContain("in-flight reserved");
    expect(metric(model, "gpu-memory").detail).toContain("not physical resident GPU memory");
  });

  it("keeps absent samples, package identity, targets, stalls, and emergency evictions explicit", () => {
    const model = createStreamingDashboardModel(snapshot());

    expect(metric(model, "load-total")).toMatchObject({
      detail: "No cell-load samples are available yet.",
      state: "unavailable",
      value: "Unavailable",
    });
    expect(metric(model, "stage-opfs").state).toBe("unavailable");
    expect(metric(model, "opfs-handles")).toMatchObject({
      detail: "Package and open-handle identity is published during provisioning.",
      state: "unavailable",
      value: "Unavailable",
    });
    expect(metric(model, "observer-targets")).toMatchObject({
      state: "unavailable",
      value: "0",
    });
    expect(metric(model, "worker-stalls").detail).toContain("not a worker-stall counter");
    expect(metric(model, "emergency-evictions").detail).toContain("proactive-only");
  });

  it("treats spare decode-worker capacity as healthy and only warns above queue capacity", () => {
    const spareCapacity = createStreamingDashboardModel(
      snapshot({
        decodeQueueDepthHighWater: 1,
        decodeWorkerCount: 4,
        state: "streaming",
      }),
    );
    const overCapacity = createStreamingDashboardModel(
      snapshot({
        decodeQueueDepthHighWater: 10,
        decodeWorkerCount: 4,
        state: "streaming",
      }),
    );

    expect(metric(spareCapacity, "decode-queue")).toMatchObject({
      state: "healthy",
      value: "1",
    });
    expect(metric(overCapacity, "decode-queue")).toMatchObject({
      state: "warning",
      value: "10",
    });
  });

  it("uses nearest-rank p95 over retained samples without treating cumulative history as retained", () => {
    const samples = Array.from({ length: 21 }, (_, index) =>
      sample(index + 1, index + 1, 1, 1, 1, 1),
    );
    const model = createStreamingDashboardModel(
      snapshot({
        cellLoadSampleCount: 300,
        cellLoadSamples: samples,
      }),
    );

    expect(metric(model, "load-total")).toMatchObject({
      detail:
        "21 retained / 300 cumulative samples · max 21.000 ms · live retained history, not a budget verdict.",
      state: "neutral",
      value: "20.000 ms",
    });
  });

  it("distinguishes opening, open, and closed OPFS handle-set lifecycle states", () => {
    const opening = createStreamingDashboardModel(
      snapshot({
        opfsAccessHandleCount: 8,
        opfsPackageCount: 256,
        state: "provisioning",
      }),
    );
    const closed = createStreamingDashboardModel(
      snapshot({
        opfsAccessHandleCount: 0,
        opfsAccessHandleOpenDurationMs: 42,
        opfsPackageCount: 256,
        state: "disposed",
      }),
    );
    const terminatedWithStaleCount = createStreamingDashboardModel(
      snapshot({
        opfsAccessHandleCount: 256,
        opfsAccessHandleOpenDurationMs: 42,
        opfsPackageCount: 256,
        state: "failed",
      }),
    );

    expect(metric(opening, "opfs-handles")).toMatchObject({
      detail: "Fixed handle set is still opening.",
      state: "neutral",
      value: "8 / 256 packages",
    });
    expect(metric(closed, "opfs-handles")).toMatchObject({
      detail: "Handles are closed. The last startup-open pass took 42.000 ms.",
      state: "unavailable",
      value: "Closed / 256 packages",
    });
    expect(metric(terminatedWithStaleCount, "opfs-handles")).toMatchObject({
      detail:
        "Handles are closed. The last worker snapshot reported 256 open before termination. The last startup-open pass took 42.000 ms.",
      state: "error",
      value: "Closed / 256 packages",
    });
  });

  it("surfaces a streaming failure as the live announcement and state detail", () => {
    const model = createStreamingDashboardModel(
      snapshot({
        failureMessage: "OPFS package hash mismatch",
        state: "failed",
        workerGeneration: 3,
      }),
    );

    expect(model.announcement).toBe("Streaming failed in generation 3: OPFS package hash mismatch");
    expect(metric(model, "state")).toEqual({
      detail: "OPFS package hash mismatch",
      id: "state",
      label: "State",
      state: "error",
      value: "failed",
    });
  });
});

function metric(model: ReturnType<typeof createStreamingDashboardModel>, id: string) {
  const value = model.sections.flatMap(({ metrics }) => metrics).find((entry) => entry.id === id);
  if (value === undefined) throw new Error(`Missing dashboard metric ${id}`);
  return value;
}

function snapshot(
  patch: Partial<WorldStreamingTelemetrySnapshot> = {},
): WorldStreamingTelemetrySnapshot {
  return {
    cellLoadSampleCount: 0,
    cellLoadSamples: [],
    cpuBudgetRejectionCount: 0,
    currentObservers: [],
    decodeQueueDepthHighWater: 0,
    decodeWorkerCount: 0,
    encodedBytesRead: 0,
    failureMessage: null,
    flythroughObserverUpdateCount: 0,
    hardwareConcurrency: 0,
    observerUpdateCount: 0,
    opfsAccessHandleCount: 0,
    opfsAccessHandleOpenDurationMs: 0,
    opfsPackageCount: 0,
    opfsProvisionedBytes: 0,
    proactiveEvictionCount: 0,
    renderRecoveryCount: 0,
    residentCellCount: 0,
    residentCellIds: [],
    residentEncodedBytes: 0,
    residentEncodedBytesHighWater: 0,
    residentGpuBytes: 0,
    residentGpuBytesHighWater: 0,
    schemaVersion: 7,
    settledObserverUpdateCount: 0,
    settledRecoveryCheckpoint: null,
    state: "idle",
    workerGeneration: 0,
    ...patch,
  };
}

function sample(
  sequence: number,
  totalMs: number,
  opfsAccessRoundTripMs: number,
  decodeRoundTripMs: number,
  renderUploadRoundTripMs: number,
  renderCommitRoundTripMs: number,
): StreamingCellLoadTelemetry {
  return {
    batchCellCount: 1,
    batchCellOrdinal: 1,
    batchFlythroughObserverSequence: sequence,
    batchObserverUpdateCount: sequence,
    batchOrdinal: sequence,
    cellId: `cell-${sequence}`,
    decodeMs: decodeRoundTripMs / 2,
    decodeRoundTripMs,
    decodeWaitMs: decodeRoundTripMs / 2,
    encodedBytes: 1_024,
    gpuBytes: 2_048,
    opfsAccessRoundTripMs,
    opfsReadMs: opfsAccessRoundTripMs / 2,
    opfsWaitMs: opfsAccessRoundTripMs / 2,
    renderCommitRoundTripMs,
    renderUploadRoundTripMs,
    renderUploadWaitMs: renderUploadRoundTripMs / 2,
    sequence,
    streamingWorkerRemainderMs: 0.25 * sequence,
    totalMs,
    uploadMs: renderUploadRoundTripMs / 2,
  };
}
