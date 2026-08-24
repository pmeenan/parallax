import { describe, expect, it } from "vitest";
import type {
  MeasuredRenderRecoveryAttempt,
  RenderRecoveryBoundary,
} from "./render-recovery-evidence.js";
import {
  finalizeMeasuredRenderRecoveryAttempt,
  validateRenderRecoveryAttempt,
} from "./render-recovery-evidence.js";

describe("render-recovery evidence", () => {
  it("accepts a moved, fully restored one-retry cohort", () => {
    expect(() => validateRenderRecoveryAttempt(attempt())).not.toThrow();
  });

  it("accepts a fresh recovered generation with no redundant load or eviction work", () => {
    const value = attempt();
    expect(value.afterFirstRecovery.streaming.cellLoadSampleCount).toBe(0);
    expect(value.afterFirstRecovery.streaming.proactiveEvictionCount).toBe(0);
    expect(() => validateRenderRecoveryAttempt(value)).not.toThrow();
  });

  it("still requires positive generation-one history and movement deltas", () => {
    const value = attempt();
    expect(() =>
      validateRenderRecoveryAttempt({
        ...value,
        initial: {
          ...value.initial,
          streaming: {
            ...value.initial.streaming,
            cellLoadSampleCount: 0,
            cellLoadSamples: [],
            proactiveEvictionCount: 0,
          },
        },
      }),
    ).toThrow(/movement history|sample retention/);
    expect(() =>
      validateRenderRecoveryAttempt({
        ...value,
        beforeFault: {
          ...value.beforeFault,
          streaming: {
            ...value.beforeFault.streaming,
            proactiveEvictionCount: value.initial.streaming.proactiveEvictionCount,
          },
        },
      }),
    ).toThrow(/direct flythrough movement/);
  });

  it("rejects negative reset counters in a recovered hydration snapshot", () => {
    const value = attempt();
    expect(() =>
      validateRenderRecoveryAttempt({
        ...value,
        afterFirstRecovery: {
          ...value.afterFirstRecovery,
          streaming: {
            ...value.afterFirstRecovery.streaming,
            proactiveEvictionCount: -1,
          },
        },
      }),
    ).toThrow(/non-negative hydration/);
  });

  it("rejects recovery that silently rehydrates the boot observer", () => {
    const value = attempt();
    expect(() =>
      validateRenderRecoveryAttempt({
        ...value,
        afterFirstRecovery: {
          ...value.afterFirstRecovery,
          checkpoint: {
            ...value.afterFirstRecovery.checkpoint,
            observers: value.initial.observers,
            residentCellIds: value.initial.residentCellIds,
          },
          observers: value.initial.observers,
          residentCellIds: value.initial.residentCellIds,
          streaming: {
            ...value.afterFirstRecovery.streaming,
            currentObservers: value.initial.observers,
            residentCellIds: value.initial.residentCellIds,
            settledRecoveryCheckpoint: {
              ...value.afterFirstRecovery.checkpoint,
              observers: value.initial.observers,
              residentCellIds: value.initial.residentCellIds,
            },
          },
        },
      }),
    ).toThrow(/restore moved observer residency/);
  });

  it("accepts exhausted terminal behavior only without a second restart", () => {
    const value = attempt();
    const terminal = boundary(2, 2, 1, [128, 12, 0], movedResidents());
    expect(() =>
      validateRenderRecoveryAttempt({
        ...value,
        afterSecondFault: {
          ...terminal,
          renderRecovery: {
            ...terminal.renderRecovery,
            lastCause: "worker-crash",
            state: "exhausted",
          },
          renderState: "failed",
          streaming: {
            ...terminal.streaming,
            failureMessage: "second fault",
            state: "failed",
          },
        },
        browserErrors: ["Render worker failed second fault"],
        id: "retry-exhaustion",
        secondProbe: "worker-crash",
      }),
    ).not.toThrow();
  });

  it("semantically validates browser errors appended after the evidence core was captured", () => {
    const value = attempt();
    const terminal = boundary(2, 2, 1, [128, 12, 0], movedResidents());
    const { browserErrors: _earlyBrowserErrors, ...unfinalized } = {
      ...value,
      afterSecondFault: {
        ...terminal,
        renderRecovery: {
          ...terminal.renderRecovery,
          lastCause: "worker-crash" as const,
          state: "exhausted" as const,
        },
        renderState: "failed" as const,
        streaming: {
          ...terminal.streaming,
          failureMessage: "second fault",
          state: "failed" as const,
        },
      },
      id: "retry-exhaustion" as const,
      secondProbe: "worker-crash" as const,
    };
    const lateExpectedErrors = ["Render worker failed second fault"];
    expect(
      finalizeMeasuredRenderRecoveryAttempt(unfinalized, lateExpectedErrors).browserErrors,
    ).toEqual(lateExpectedErrors);
    expect(() =>
      finalizeMeasuredRenderRecoveryAttempt(unfinalized, [
        ...lateExpectedErrors,
        "unexpected cleanup failure",
      ]),
    ).toThrow(/expected terminal browser error/);
  });

  it("rejects a false terminal success with a second generation increment", () => {
    const value = attempt();
    const terminal = boundary(3, 3, 2, [128, 12, 0], movedResidents());
    expect(() =>
      validateRenderRecoveryAttempt({
        ...value,
        afterSecondFault: {
          ...terminal,
          renderRecovery: {
            ...terminal.renderRecovery,
            lastCause: "worker-crash",
            restartCount: 2,
            state: "recovered",
          },
        },
        browserErrors: ["unexpected"],
        id: "retry-exhaustion",
        secondProbe: "worker-crash",
      }),
    ).toThrow(/fail closed/);
  });

  it("rejects corrupted, misconfigured, or arithmetically forged SAB recovery evidence", () => {
    const value = attempt();
    for (const sab of [
      { ...value.afterFirstRecovery.sab, payloadErrors: 1 },
      { ...value.afterFirstRecovery.sab, messageCount: 99_999 },
      { ...value.afterFirstRecovery.sab, cooperativeRoundTripsPerSecond: 1 },
      { ...value.afterFirstRecovery.sab, failureMessage: "hidden failure" },
    ]) {
      expect(() =>
        validateRenderRecoveryAttempt({
          ...value,
          afterFirstRecovery: { ...value.afterFirstRecovery, sab },
        }),
      ).toThrow(/SAB transport/);
    }
  });

  it("rejects checkpoint, live-observer, direct-sequence, and residency forgeries", () => {
    const value = attempt();
    const recovered = value.afterFirstRecovery;
    const mutations: readonly RenderRecoveryBoundary[] = [
      {
        ...recovered,
        streaming: {
          ...recovered.streaming,
          settledRecoveryCheckpoint: {
            ...recovered.checkpoint,
            observerUpdateCount: recovered.checkpoint.observerUpdateCount + 1,
          },
        },
      },
      {
        ...recovered,
        streaming: {
          ...recovered.streaming,
          currentObservers: [[999, 12, 999]],
        },
      },
      {
        ...recovered,
        streaming: {
          ...recovered.streaming,
          flythroughObserverUpdateCount: recovered.streaming.flythroughObserverUpdateCount - 1,
        },
      },
      {
        ...recovered,
        checkpoint: {
          ...recovered.checkpoint,
          residentCellIds: [...recovered.checkpoint.residentCellIds].reverse(),
        },
        observers: recovered.observers,
        residentCellIds: [...recovered.residentCellIds].reverse(),
        streaming: {
          ...recovered.streaming,
          residentCellIds: [...recovered.residentCellIds].reverse(),
          settledRecoveryCheckpoint: {
            ...recovered.checkpoint,
            residentCellIds: [...recovered.residentCellIds].reverse(),
          },
        },
      },
    ];
    for (const afterFirstRecovery of mutations) {
      expect(() => validateRenderRecoveryAttempt({ ...value, afterFirstRecovery })).toThrow();
    }
  });

  it("rejects missing flythrough invalidation and decoder/world identity drift", () => {
    const value = attempt();
    const decoderFixtures = value.afterFirstRecovery.decoderFixtures;
    const greyboxWorld = value.afterFirstRecovery.greyboxWorld;
    if (decoderFixtures === null || greyboxWorld === null) {
      throw new Error("Test fixture lost decoder/world telemetry");
    }
    expect(() =>
      validateRenderRecoveryAttempt({
        ...value,
        afterFirstRecovery: {
          ...value.afterFirstRecovery,
          flythrough: { failureMessage: null, state: "completed" },
        },
      }),
    ).toThrow(/invalidated flythrough/);
    expect(() =>
      validateRenderRecoveryAttempt({
        ...value,
        afterFirstRecovery: {
          ...value.afterFirstRecovery,
          decoderFixtures: {
            ...decoderFixtures,
            ktx2: {
              ...decoderFixtures.ktx2,
              transcoder: "forged",
            },
          },
        },
      }),
    ).toThrow(/decoder and world/);
    expect(() =>
      validateRenderRecoveryAttempt({
        ...value,
        afterFirstRecovery: {
          ...value.afterFirstRecovery,
          greyboxWorld: {
            ...greyboxWorld,
            districtId: "forged",
          },
        },
      }),
    ).toThrow(/decoder and world/);
  });
});

function attempt(): MeasuredRenderRecoveryAttempt {
  const initial = boundary(1, 1, 0, [0, 12, 0], initialResidents());
  const beforeFault = boundary(1, 1, 0, [128, 12, 0], movedResidents());
  const afterFirstRecovery = boundary(2, 2, 1, [128, 12, 0], movedResidents());
  return Object.freeze({
    afterFirstRecovery,
    afterSecondFault: null,
    beforeFault,
    browserErrors: Object.freeze([]),
    elapsedMs: 2_000,
    firstProbe: "device-loss",
    frameCountAfterVisibilityWait: 4,
    id: "device-loss-recovery",
    initial,
    secondProbe: null,
    visibleCanvas: Object.freeze({
      clearColorRgb: Object.freeze([0, 0, 0] as const),
      height: 64,
      pngSha256: "a".repeat(64),
      visiblePixelCount: 2_048,
      visiblePixelRatio: 0.5,
      width: 64,
    }),
  });
}

function boundary(
  renderGeneration: number,
  streamingGeneration: number,
  recoveryCount: number,
  observer: readonly [number, number, number],
  residentCellIds: readonly string[],
): RenderRecoveryBoundary {
  const observerCount = observer[0] === 0 ? 0 : 10;
  const isHydratedRecovery = streamingGeneration === 2;
  const cellLoadSampleCount = isHydratedRecovery ? 0 : observerCount === 0 ? 10 : 11;
  const proactiveEvictionCount = isHydratedRecovery ? 0 : observerCount === 0 ? 1 : 2;
  return Object.freeze({
    checkpoint: Object.freeze({
      flythroughObserverUpdateCount: observerCount,
      observerUpdateCount: observerCount,
      observers: Object.freeze([Object.freeze(observer)]),
      residentCellIds,
      workerGeneration: streamingGeneration,
    }),
    decoderBootstrap: Object.freeze({
      installedAtMs: 1,
      paths: Object.freeze({
        draco: "preinstalled-global" as const,
        ktx2: "preinstalled-global" as const,
        meshopt: "preinstalled-global" as const,
      }),
      versions: Object.freeze({ draco: "1.5.7", ktx2: "9.17.0", meshopt: "1.2.0" }),
    }),
    decoderFixtures: Object.freeze({
      draco: Object.freeze({ durationMs: 1, faces: 1 }),
      ktx2: Object.freeze({ durationMs: 1, height: 1, transcoder: "x", width: 1 }),
      meshopt: Object.freeze({ bytes: 1, durationMs: 1 }),
    }),
    frameCount: renderGeneration === 1 ? 100 : 1,
    flythrough: Object.freeze({
      failureMessage: recoveryCount === 0 ? null : "Render recovery invalidated flythrough",
      state: recoveryCount === 0 ? (observerCount === 0 ? "prepared" : "running") : "failed",
    }),
    greyboxWorld: Object.freeze({
      cellCount: 1,
      clearColor: Object.freeze([0, 0, 0, 1] as const),
      colliderCount: 1,
      districtId: "d1",
      dynamicLighting: true,
      heightSampleCount: 1,
      mainThreadScenePostMessageMs: 1,
      mainThreadWorldGenerationMs: 1,
      materialCount: 1,
      materializationMs: 1,
      renderedFeaturePrimitiveCount: 1,
      renderedTerrainPatchCount: 1,
      renderedTriangleCount: 2,
      selectedLodCellCounts: Object.freeze([1, 0, 0] as const),
      worldBoundsMeters: Object.freeze({
        maximum: Object.freeze([1, 1, 1] as const),
        minimum: Object.freeze([0, 0, 0] as const),
      }),
    }),
    observers: Object.freeze([Object.freeze(observer)]),
    renderRecovery: Object.freeze({
      lastCause: recoveryCount === 0 ? null : ("device-loss" as const),
      lastFailureMessage: recoveryCount === 0 ? null : "fault",
      lastRestartDurationMs: recoveryCount === 0 ? null : 1_500,
      maximumAutomaticRestarts: 1 as const,
      restartCount: recoveryCount,
      state: recoveryCount === 0 ? ("not-needed" as const) : ("recovered" as const),
      workerGeneration: renderGeneration,
    }),
    renderState: "ready",
    residentCellIds,
    sab: Object.freeze({
      capacityRecords: 256,
      cooperativeRoundTripsPerSecond: 100_000_000,
      elapsedMs: 1,
      failureMessage: null,
      mainConsumerEmptyPolls: 0,
      mainProducerStalls: 0,
      mainPumpMaxDurationMs: 1,
      messageCount: 100_000,
      payloadErrors: 0,
      recordWords: 4,
      responsesReceived: 100_000,
      state: "completed",
      totalSABBytes: 8_224,
      workerConcurrentFrameCount: 1,
      workerConcurrentFrameIntervalMaxMs: 1,
      workerConcurrentRenderDurationMaxMs: 1,
      workerElapsedMs: 1,
      workerInboundWaits: 0,
      workerOutboundStalls: 0,
      workerSequenceErrors: 0,
    }),
    streaming: Object.freeze({
      cellLoadSampleCount,
      cellLoadSamples: Object.freeze(
        Array.from({ length: cellLoadSampleCount }, (_, index) => sample(index + 1)),
      ),
      cpuBudgetRejectionCount: 0,
      currentObservers: Object.freeze([Object.freeze(observer)]),
      districtId: "district-1-surface",
      districtSwapCount: 0,
      districtSwapInProgress: false,
      districtSwapSamples: Object.freeze([]),
      decodeQueueDepthHighWater: 4,
      decodeWorkerCount: 4,
      encodedBytesRead: 1,
      failureMessage: null,
      flythroughObserverUpdateCount: observerCount,
      hardwareConcurrency: 8,
      installedReleaseDigest: null,
      installedResourceBytes: 0,
      installedResourceCount: 0,
      legacyNetworkRequestCount: 2,
      observerUpdateCount: observerCount,
      opfsAccessHandleCount: 256,
      opfsAccessHandleOpenDurationMs: 10,
      opfsPackageCount: 256,
      opfsProvisionedBytes: 0,
      proactiveEvictionCount,
      renderRecoveryCount: recoveryCount,
      renderBatchCellCountHighWater: 9,
      renderBatchDirectUploadMsHighWater: 1,
      renderBatchRequestCount: Math.max(1, cellLoadSampleCount),
      renderBatchTransactionCount: Math.max(1, cellLoadSampleCount),
      residentCellCount: 9,
      residentCellIds,
      residentEncodedBytes: 1,
      residentEncodedBytesHighWater: 1,
      residentGpuBytes: 1,
      residentGpuBytesHighWater: 1,
      schemaVersion: 13,
      settledRecoveryCheckpoint: Object.freeze({
        flythroughObserverUpdateCount: observerCount,
        observerUpdateCount: observerCount,
        observers: Object.freeze([Object.freeze(observer)]),
        residentCellIds,
        workerGeneration: streamingGeneration,
      }),
      settledObserverUpdateCount: observerCount,
      state: "streaming",
      startupTiming: {
        accessHandlesOpenedAtMs: 4,
        contract: "streaming-startup-timing@1" as const,
        decodePoolCreatedAtMs: 5,
        finalAdmissionCompletedAtMs: null,
        initialResidencyReadyAtMs: 6,
        provisioningStartedAtMs: 2,
        releaseBindingCompletedAtMs: null,
        releaseResolutionCompletedAtMs: 3,
        schemaVersion: 1 as const,
        sourceKind: "privileged-legacy-network" as const,
        workerStartedAtMs: 1,
      },
      workerGeneration: streamingGeneration,
    }),
  });
}

function sample(sequence: number) {
  return Object.freeze({
    batchDirectUploadMs: 1,
    batchCellCount: 1,
    batchCellOrdinal: 1,
    batchFlythroughObserverSequence: sequence,
    batchObserverUpdateCount: sequence,
    batchOrdinal: sequence,
    batchTransactionId: `1:${sequence}:${sequence}:${sequence}`,
    cellId: `sample-${sequence}`,
    decodeMs: 1,
    decodeRoundTripMs: 1,
    decodeWaitMs: 0,
    encodedBytes: 1,
    gpuBytes: 1,
    opfsAccessRoundTripMs: 1,
    opfsReadMs: 1,
    opfsWaitMs: 0,
    renderTransactionRoundTripMs: 1,
    renderTransactionWaitMs: 0,
    sequence,
    streamingWorkerRemainderMs: 1,
    totalMs: 5,
    uploadMs: 1,
  });
}

function initialResidents(): readonly string[] {
  return Object.freeze(["a", "b", "c", "d", "e", "f", "g", "h", "i"]);
}

function movedResidents(): readonly string[] {
  return Object.freeze(["j", "k", "l", "m", "n", "o", "p", "q", "r"]);
}
