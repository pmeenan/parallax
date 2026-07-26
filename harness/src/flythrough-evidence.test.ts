import { describe, expect, it } from "vitest";
import { requireFlythroughEvidence } from "./flythrough-evidence.js";
import {
  FLYTHROUGH_D1_EXPECTED_SCENARIO,
  FLYTHROUGH_D1_PHASE_IDS,
  FLYTHROUGH_D1_SCENARIO,
} from "./runs/flythrough-d1.js";

function validEvidence(): unknown {
  const checkpointEvidence = FLYTHROUGH_D1_EXPECTED_SCENARIO.environmentPhases.map(
    (phase, index) => ({
      cameraPosition: [index * 500, 100, index * 700],
      cameraTarget: [index * 500, 40, index * 700],
      checkpointId: phase.id,
      clearColorDistanceThreshold: 12,
      clearColorRgb: [20, 30, 40],
      elapsedMs: phase.startMs + (phase.endMs - phase.startMs) / 2,
      environment: phase,
      environmentPhaseId: phase.id,
      height: 720,
      previewVisibleMeshCount: 0,
      rgbaSha256: index.toString(16).padStart(64, "0"),
      sampledPixelCount: 1_280 * 720,
      streamedVisibleMeshCount: 12,
      visiblePixelCount: 500_000,
      visiblePixelRatio: 500_000 / (1_280 * 720),
      width: 1_280,
    }),
  );
  const streaming = {
    cellLoadSampleCount: 100,
    cellLoadSamples: [],
    cpuBudgetRejectionCount: 0,
    decodeQueueDepthHighWater: 9,
    decodeWorkerCount: 4,
    encodedBytesRead: 1,
    failureMessage: null,
    flythroughObserverUpdateCount: 8_000,
    hardwareConcurrency: 16,
    observerUpdateCount: 8_006,
    opfsProvisionedBytes: 0,
    proactiveEvictionCount: 90,
    residentCellCount: 9,
    residentEncodedBytes: 1,
    residentEncodedBytesHighWater: 1,
    residentGpuBytes: 1,
    residentGpuBytesHighWater: 1,
    schemaVersion: 3,
    settledObserverUpdateCount: 8_006,
    state: "streaming",
  };
  return {
    checkpointEvidence,
    failureMessage: null,
    preflightElapsedMs: 2_000,
    render: {
      callbackIntervalMs: {
        maximum: 20,
        p50: 16,
        p95: 17,
        p999: 19,
        sampleCount: 35_999,
      },
      cameraPositionMaximum: [1_200, 100, 1_304],
      cameraPositionMinimum: [-1_304, 100, -1_800],
      cameraTargetMaximum: [1_200, 40, 1_200],
      cameraTargetMinimum: [-1_200, 40, -1_800],
      completedDistanceMeters: 7_200,
      completedElapsedMs: 600_000,
      environmentFrameCounts: Object.fromEntries(FLYTHROUGH_D1_PHASE_IDS.map((id) => [id, 6_000])),
      environmentPhaseOrder: FLYTHROUGH_D1_PHASE_IDS,
      finalObserver: [-1_200, 12, 600],
      frameCount: 36_000,
      minimumVisibleStreamingMeshCount: 10,
      observerUpdateCount: 8_000,
      previewVisibleFrameCount: 0,
      renderDurationMs: {
        maximum: 4,
        p50: 1,
        p95: 2,
        p999: 3,
        sampleCount: 36_000,
      },
      scenario: FLYTHROUGH_D1_EXPECTED_SCENARIO,
      scenarioId: FLYTHROUGH_D1_SCENARIO,
      state: "completed",
      streamedPresentationFrameCount: 36_000,
    },
    scenarioId: FLYTHROUGH_D1_SCENARIO,
    schemaVersion: 3,
    state: "completed",
    streamingAtMeasurementEnd: streaming,
    streamingAtMeasurementStart: {
      ...streaming,
      flythroughObserverUpdateCount: 0,
      observerUpdateCount: 6,
      settledObserverUpdateCount: 6,
    },
    validation: {
      distanceMeters: 7_200,
      durationMs: 600_000,
      environmentPhaseIds: FLYTHROUGH_D1_PHASE_IDS,
      scenarioId: FLYTHROUGH_D1_SCENARIO,
    },
  };
}

describe("flythrough-d1@1 evidence", () => {
  it("accepts complete path, environment, presentation, and checkpoint evidence", () => {
    expect(requireFlythroughEvidence(validEvidence())).toMatchObject({
      scenarioId: FLYTHROUGH_D1_SCENARIO,
      state: "completed",
    });
  });

  it("rejects static preview ownership and missing phases", () => {
    const value = validEvidence() as {
      render: { environmentPhaseOrder: readonly string[]; previewVisibleFrameCount: number };
    };
    expect(() =>
      requireFlythroughEvidence({
        ...value,
        render: { ...value.render, previewVisibleFrameCount: 1 },
      }),
    ).toThrow();
    expect(() =>
      requireFlythroughEvidence({
        ...value,
        render: {
          ...value.render,
          environmentPhaseOrder: value.render.environmentPhaseOrder.slice(0, -1),
        },
      }),
    ).toThrow();
  });

  it("rejects same-distance path drift, state swaps, and phase-value drift", () => {
    const value = validEvidence() as {
      checkpointEvidence: readonly Record<string, unknown>[];
      render: {
        scenario: typeof FLYTHROUGH_D1_EXPECTED_SCENARIO;
      };
    };
    const driftedPath = value.render.scenario.path.map(
      (point) => [point[0] + 10, point[1], point[2]] as const,
    );
    expect(() =>
      requireFlythroughEvidence({
        ...value,
        render: {
          ...value.render,
          scenario: { ...value.render.scenario, path: driftedPath },
        },
      }),
    ).toThrow();
    const swapped = value.render.scenario.environmentPhases.map((phase, index) =>
      index === 1 ? { ...phase, weather: "storm" as const } : phase,
    );
    expect(() =>
      requireFlythroughEvidence({
        ...value,
        render: {
          ...value.render,
          scenario: { ...value.render.scenario, environmentPhases: swapped },
        },
      }),
    ).toThrow();
    const phaseDrift = value.render.scenario.environmentPhases.map((phase, index) =>
      index === 2 ? { ...phase, timeOfDayPhase: 0.47 } : phase,
    );
    expect(() =>
      requireFlythroughEvidence({
        ...value,
        render: {
          ...value.render,
          scenario: { ...value.render.scenario, environmentPhases: phaseDrift },
        },
      }),
    ).toThrow();
  });

  it("identifies the exact checkpoint and field when rendered evidence is blank", () => {
    const value = validEvidence() as {
      checkpointEvidence: readonly Record<string, unknown>[];
    };
    expect(() =>
      requireFlythroughEvidence({
        ...value,
        checkpointEvidence: value.checkpointEvidence.map((checkpoint, index) =>
          index === 2 ? { ...checkpoint, visiblePixelRatio: 0 } : checkpoint,
        ),
      }),
    ).toThrow(/checkpoint 2 \(storm-dusk\) visiblePixelRatio=0/);
  });

  it.each([
    ["short target bound", "cameraTargetMinimum", [0, 1]],
    ["non-finite position bound", "cameraPositionMaximum", [1_200, 100, Number.NaN]],
    ["long position bound", "cameraPositionMinimum", [-1_304, 100, -1_800, 0]],
  ])("rejects malformed camera aggregate vectors: %s", (_name, field, mutation) => {
    const value = validEvidence() as { render: Record<string, unknown> };
    expect(() =>
      requireFlythroughEvidence({
        ...value,
        render: { ...value.render, [field]: mutation },
      }),
    ).toThrow(/flythrough-d1@1 contract/);
  });

  it.each([
    [
      "target",
      { cameraTargetMinimum: [2_000, 40, -1_800], cameraTargetMaximum: [1_200, 40, 1_200] },
    ],
    [
      "position",
      {
        cameraPositionMinimum: [-1_304, 101, -1_800],
        cameraPositionMaximum: [1_200, 100, 1_304],
      },
    ],
  ])("rejects inverted %s aggregate bounds", (_name, mutation) => {
    const value = validEvidence() as { render: Record<string, unknown> };
    expect(() =>
      requireFlythroughEvidence({
        ...value,
        render: { ...value.render, ...mutation },
      }),
    ).toThrow(/flythrough-d1@1 contract/);
  });

  it.each([
    ["cameraPosition", [0, 100]],
    ["cameraTarget", [0, 40, 0, 1]],
    ["clearColorRgb", [20, Number.POSITIVE_INFINITY, 40]],
  ])("rejects malformed checkpoint %s vectors", (field, mutation) => {
    const value = validEvidence() as {
      checkpointEvidence: readonly Record<string, unknown>[];
    };
    expect(() =>
      requireFlythroughEvidence({
        ...value,
        checkpointEvidence: value.checkpointEvidence.map((checkpoint, index) =>
          index === 1 ? { ...checkpoint, [field]: mutation } : checkpoint,
        ),
      }),
    ).toThrow(/checkpoint 1 \(overcast-daylight\) camera\/color vectors/);
  });
});
