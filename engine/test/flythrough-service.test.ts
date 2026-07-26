import { describe, expect, it, vi } from "vitest";
import type {
  FlythroughScenario,
  FlythroughScenarioSample,
} from "../src/flythrough/flythrough-contract";
import {
  createFlythroughService,
  FLYTHROUGH_STABILIZATION_MS,
} from "../src/flythrough/flythrough-service";
import type {
  FlythroughCheckpointRenderEvidence,
  RenderFlythroughTelemetry,
} from "../src/render/render-protocol";
import type {
  RenderService,
  RenderServiceListener,
  RenderTelemetrySnapshot,
} from "../src/render/render-service";
import type { WorldStreamingTelemetrySnapshot } from "../src/streaming/streaming-protocol";
import type {
  WorldStreamingListener,
  WorldStreamingService,
} from "../src/streaming/world-streaming-service";

describe("flythrough service", () => {
  it("waits for the exact final direct-port sequence and corresponding total settlement", async () => {
    vi.useFakeTimers();
    try {
      const render = renderHarness();
      const streaming = streamingHarness();
      const service = createFlythroughService(render.service, streaming.service, scenario, {
        maximum: [120, 20, 20],
        minimum: [0, 0, 0],
      });

      service.prepare();
      await vi.runAllTimersAsync();
      expect(service.snapshot().state).toBe("prepared");
      service.start();
      const start = service.snapshot().streamingAtMeasurementStart;
      expect(start).not.toBeNull();
      if (start === null) throw new Error("Test lost the measurement start boundary");

      render.complete(renderTelemetry(3));
      await Promise.resolve();
      expect(service.snapshot().state).toBe("running");

      streaming.publish({
        flythroughObserverUpdateCount: start.flythroughObserverUpdateCount + 2,
        observerUpdateCount: start.observerUpdateCount + 2,
        settledObserverUpdateCount: start.observerUpdateCount + 2,
      });
      await Promise.resolve();
      expect(service.snapshot().state).toBe("running");

      streaming.publish({
        flythroughObserverUpdateCount: start.flythroughObserverUpdateCount + 3,
        observerUpdateCount: start.observerUpdateCount + 3,
        settledObserverUpdateCount: start.observerUpdateCount + 2,
      });
      await Promise.resolve();
      expect(service.snapshot().state).toBe("running");

      streaming.publish({
        settledObserverUpdateCount: start.observerUpdateCount + 3,
      });
      await Promise.resolve();
      expect(service.snapshot().state).toBe("completed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not publish prepared after recovery invalidates stabilization", async () => {
    vi.useFakeTimers();
    try {
      const render = renderHarness();
      const streaming = streamingHarness();
      const service = createFlythroughService(render.service, streaming.service, scenario, {
        maximum: [120, 20, 20],
        minimum: [0, 0, 0],
      });

      service.prepare();
      for (let index = 0; index < 30 && service.snapshot().state !== "stabilizing"; index += 1) {
        await Promise.resolve();
      }
      expect(service.snapshot().state).toBe("stabilizing");
      render.recover();
      expect(service.snapshot().state).toBe("failed");
      await vi.advanceTimersByTimeAsync(FLYTHROUGH_STABILIZATION_MS);
      expect(service.snapshot().state).toBe("failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not publish completed after recovery invalidates an awaited final settlement", async () => {
    vi.useFakeTimers();
    try {
      const render = renderHarness();
      const streaming = streamingHarness();
      const service = createFlythroughService(render.service, streaming.service, scenario, {
        maximum: [120, 20, 20],
        minimum: [0, 0, 0],
      });

      service.prepare();
      await vi.runAllTimersAsync();
      service.start();
      const start = service.snapshot().streamingAtMeasurementStart;
      if (start === null) throw new Error("Test lost the measurement start boundary");
      render.complete(renderTelemetry(3));
      await Promise.resolve();
      expect(service.snapshot().state).toBe("running");

      render.recover();
      expect(service.snapshot().state).toBe("failed");
      streaming.publish({
        flythroughObserverUpdateCount: start.flythroughObserverUpdateCount + 3,
        observerUpdateCount: start.observerUpdateCount + 3,
        settledObserverUpdateCount: start.observerUpdateCount + 3,
      });
      await Promise.resolve();

      expect(service.snapshot().state).toBe("failed");
      expect(service.snapshot().render).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed on non-finite or inverted render camera bounds", async () => {
    vi.useFakeTimers();
    try {
      const mutations: readonly ((
        telemetry: RenderFlythroughTelemetry,
      ) => RenderFlythroughTelemetry)[] = [
        (telemetry) => ({ ...telemetry, cameraPositionMinimum: [Number.NaN, 20, 0] }),
        (telemetry) => ({
          ...telemetry,
          cameraPositionMinimum: [] as unknown as readonly [number, number, number],
        }),
        (telemetry) => ({
          ...telemetry,
          cameraTargetMaximum: [0, 20] as unknown as readonly [number, number, number],
        }),
        (telemetry) => ({
          ...telemetry,
          cameraTargetMaximum: [-1, 20, 0],
          cameraTargetMinimum: [0, 20, 0],
        }),
        (telemetry) => ({ ...telemetry, finalObserver: [Number.POSITIVE_INFINITY, 10, 0] }),
      ];
      for (const mutate of mutations) {
        const render = renderHarness();
        const streaming = streamingHarness();
        const service = createFlythroughService(render.service, streaming.service, scenario, {
          maximum: [120, 20, 20],
          minimum: [0, 0, 0],
        });

        service.prepare();
        await vi.runAllTimersAsync();
        service.start();
        render.complete(mutate(renderTelemetry(3)));
        await Promise.resolve();

        expect(service.snapshot()).toMatchObject({
          failureMessage: "Flythrough render camera bounds or final observer are invalid",
          state: "failed",
        });
        service.dispose();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("localizes blank preflight evidence and retains the complete checkpoint list", async () => {
    vi.useFakeTimers();
    try {
      const render = renderHarness({ blankCheckpointIndex: 1 });
      const streaming = streamingHarness();
      const service = createFlythroughService(render.service, streaming.service, scenario, {
        maximum: [120, 20, 20],
        minimum: [0, 0, 0],
      });

      service.prepare();
      await vi.runAllTimersAsync();

      expect(service.snapshot().state).toBe("failed");
      expect(service.snapshot().checkpointEvidence).toHaveLength(scenario.environmentPhases.length);
      expect(service.snapshot().failureMessage).toMatch(
        /checkpoint 1 \(overcast-daylight\) pixel counts are invalid/,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed on incoherent checkpoint pixel evidence and non-finite vectors", async () => {
    vi.useFakeTimers();
    try {
      const mutations: readonly ((
        checkpoint: FlythroughCheckpointRenderEvidence,
      ) => FlythroughCheckpointRenderEvidence)[] = [
        (checkpoint) => ({ ...checkpoint, cameraPosition: [Number.NaN, 20, 0] }),
        (checkpoint) => ({ ...checkpoint, cameraTarget: [0, Number.POSITIVE_INFINITY, 0] }),
        (checkpoint) => ({ ...checkpoint, clearColorRgb: [10, 20, Number.NaN] }),
        (checkpoint) => ({ ...checkpoint, visiblePixelCount: 2 }),
      ];
      for (const mutate of mutations) {
        const render = renderHarness({
          checkpointMutation: (checkpoint, index) =>
            index === 0 ? mutate(checkpoint) : checkpoint,
        });
        const streaming = streamingHarness();
        const service = createFlythroughService(render.service, streaming.service, scenario, {
          maximum: [120, 20, 20],
          minimum: [0, 0, 0],
        });

        service.prepare();
        await vi.runAllTimersAsync();

        expect(service.snapshot()).toMatchObject({
          state: "failed",
          failureMessage: expect.stringMatching(/checkpoint 0/i),
        });
        service.dispose();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not register a checkpoint capture until the exact preflight sample rendered", async () => {
    const render = renderHarness({ deferFirstPreflight: true });
    const streaming = streamingHarness();
    const service = createFlythroughService(render.service, streaming.service, scenario, {
      maximum: [120, 20, 20],
      minimum: [0, 0, 0],
    });

    service.prepare();
    for (let index = 0; index < 20 && render.preflightCount() === 0; index += 1) {
      await Promise.resolve();
    }
    expect(render.preflightCount()).toBe(1);
    expect(render.checkpointCount()).toBe(0);

    render.settleFirstPreflight();
    for (let index = 0; index < 20 && render.checkpointCount() === 0; index += 1) {
      await Promise.resolve();
    }
    expect(render.checkpointCount()).toBe(1);
  });

  it("clears completed evidence and resets the worker-owned route before another repeat", async () => {
    vi.useFakeTimers();
    try {
      const render = renderHarness();
      const streaming = streamingHarness();
      const service = createFlythroughService(render.service, streaming.service, scenario, {
        maximum: [120, 20, 20],
        minimum: [0, 0, 0],
      });

      service.prepare();
      await vi.runAllTimersAsync();
      service.start();
      const start = service.snapshot().streamingAtMeasurementStart;
      if (start === null) throw new Error("Test lost the measurement start boundary");
      render.complete(renderTelemetry(3));
      streaming.publish({
        flythroughObserverUpdateCount: start.flythroughObserverUpdateCount + 3,
        observerUpdateCount: start.observerUpdateCount + 3,
        settledObserverUpdateCount: start.observerUpdateCount + 3,
      });
      await Promise.resolve();
      expect(service.snapshot().state).toBe("completed");

      await service.reset();

      expect(render.resetCount()).toBe(1);
      expect(service.snapshot()).toMatchObject({
        checkpointEvidence: [],
        failureMessage: null,
        preflightElapsedMs: null,
        render: null,
        state: "idle",
        streamingAtMeasurementEnd: null,
        streamingAtMeasurementStart: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts active preflight and permits a clean reset", async () => {
    vi.useFakeTimers();
    try {
      const render = renderHarness();
      const streaming = streamingHarness();
      const service = createFlythroughService(render.service, streaming.service, scenario, {
        maximum: [120, 20, 20],
        minimum: [0, 0, 0],
      });

      service.prepare();
      await vi.advanceTimersByTimeAsync(1);
      await service.abort("benchmark timeout");
      expect(service.snapshot()).toMatchObject({
        failureMessage: "benchmark timeout",
        state: "aborted",
      });
      expect(render.resetCount()).toBe(1);

      await service.reset();
      expect(service.snapshot()).toMatchObject({ failureMessage: null, state: "idle" });
      await vi.runAllTimersAsync();
      expect(service.snapshot().state).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases synchronous streaming waits on success and failure", async () => {
    vi.useFakeTimers();
    try {
      const successfulStreaming = streamingHarness();
      const successfulService = createFlythroughService(
        renderHarness().service,
        successfulStreaming.service,
        scenario,
        {
          maximum: [120, 20, 20],
          minimum: [0, 0, 0],
        },
      );

      successfulService.prepare();
      await vi.runAllTimersAsync();
      expect(successfulService.snapshot().state).toBe("prepared");
      expect(successfulStreaming.listenerCount()).toBe(1);
      successfulService.dispose();

      const failingStreaming = streamingHarness({ failOnSetObservers: true });
      const failingService = createFlythroughService(
        renderHarness().service,
        failingStreaming.service,
        scenario,
        {
          maximum: [120, 20, 20],
          minimum: [0, 0, 0],
        },
      );

      failingService.prepare();
      await Promise.resolve();
      expect(failingService.snapshot()).toMatchObject({
        failureMessage: "synchronous streaming failure",
        state: "failed",
      });
      expect(failingStreaming.listenerCount()).toBe(1);
      failingService.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not subscribe when settlement synchronously aborts preflight first", async () => {
    vi.useFakeTimers();
    try {
      let service!: ReturnType<typeof createFlythroughService>;
      let abortInFlight: Promise<void> | null = null;
      const streaming = streamingHarness({
        onSetObservers: () => {
          abortInFlight = service.abort("synchronous preflight abort");
        },
      });
      service = createFlythroughService(renderHarness().service, streaming.service, scenario, {
        maximum: [120, 20, 20],
        minimum: [0, 0, 0],
      });

      service.prepare();
      const abort = abortInFlight;
      expect(abort).not.toBeNull();
      if (abort === null) throw new Error("Synchronous preflight abort was not invoked");
      await abort;

      expect(service.snapshot()).toMatchObject({
        failureMessage: "synchronous preflight abort",
        state: "aborted",
      });
      expect(streaming.listenerCount()).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
      service.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes the streaming wait subscription and abort listener on timeout", async () => {
    vi.useFakeTimers();
    const removeAbortListener = vi.spyOn(AbortSignal.prototype, "removeEventListener");
    try {
      const render = renderHarness();
      const streaming = streamingHarness({ settleObservers: false });
      const service = createFlythroughService(render.service, streaming.service, scenario, {
        maximum: [120, 20, 20],
        minimum: [0, 0, 0],
      });

      service.prepare();
      expect(streaming.listenerCount()).toBe(2);
      await vi.advanceTimersByTimeAsync(15_000);

      expect(service.snapshot()).toMatchObject({
        failureMessage: "Streaming did not settle observer update 1 within 15000 ms",
        state: "failed",
      });
      expect(streaming.listenerCount()).toBe(1);
      expect(removeAbortListener).toHaveBeenCalledWith("abort", expect.any(Function));
      expect(vi.getTimerCount()).toBe(0);
      service.dispose();
    } finally {
      removeAbortListener.mockRestore();
      vi.useRealTimers();
    }
  });

  it("idempotently removes a pending streaming wait when preflight is aborted", async () => {
    vi.useFakeTimers();
    try {
      const render = renderHarness();
      const streaming = streamingHarness({ settleObservers: false });
      const service = createFlythroughService(render.service, streaming.service, scenario, {
        maximum: [120, 20, 20],
        minimum: [0, 0, 0],
      });

      service.prepare();
      expect(streaming.listenerCount()).toBe(2);
      await service.abort("benchmark timeout");

      expect(service.snapshot()).toMatchObject({
        failureMessage: "benchmark timeout",
        state: "aborted",
      });
      expect(streaming.listenerCount()).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
      service.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not expose aborted or rerunnable state before render and streaming reset ack", async () => {
    vi.useFakeTimers();
    try {
      const render = renderHarness({ deferReset: true });
      const streaming = streamingHarness();
      const service = createFlythroughService(render.service, streaming.service, scenario, {
        maximum: [120, 20, 20],
        minimum: [0, 0, 0],
      });

      service.prepare();
      await vi.advanceTimersByTimeAsync(1);
      const abort = service.abort("benchmark timeout");
      expect(service.snapshot()).toMatchObject({
        failureMessage: "benchmark timeout",
        state: "stabilizing",
      });
      expect(() => service.reset()).toThrow(/completed, failed, or aborted/);

      render.settleReset();
      await abort;
      expect(service.snapshot().state).toBe("aborted");
      await service.reset();
      expect(service.snapshot().state).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("publishes and rejects a failed abort reset acknowledgement", async () => {
    vi.useFakeTimers();
    try {
      const render = renderHarness({ resetFailure: new Error("reset transport failed") });
      const streaming = streamingHarness();
      const service = createFlythroughService(render.service, streaming.service, scenario, {
        maximum: [120, 20, 20],
        minimum: [0, 0, 0],
      });

      service.prepare();
      await vi.advanceTimersByTimeAsync(1);
      await expect(service.abort("benchmark timeout")).rejects.toThrow(
        "benchmark timeout; flythrough reset failed: reset transport failed",
      );
      expect(service.snapshot()).toMatchObject({
        failureMessage: "benchmark timeout; flythrough reset failed: reset transport failed",
        state: "failed",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

const scenario = Object.freeze({
  camera: Object.freeze({ beta: Math.PI / 3, heightMeters: 10, radiusMeters: 20 }),
  durationMs: 120_000,
  environmentPhases: Object.freeze([
    phase("clear-daylight-start", 0, "clear", "daylight", 0.25),
    phase("overcast-daylight", 20_000, "overcast", "daylight", 0.25),
    phase("storm-dusk", 40_000, "storm", "dusk", 0.48),
    phase("storm-night", 60_000, "storm", "night", 0.75),
    phase("overcast-dawn", 80_000, "overcast", "dawn", 0.02),
    phase("clear-daylight-finish", 100_000, "clear", "daylight", 0.25),
  ]),
  id: "service-test@1",
  path: Object.freeze([Object.freeze([0, 10, 0] as const), Object.freeze([120, 10, 0] as const)]),
  schemaVersion: 1,
  speedMetersPerSecond: 1,
}) satisfies FlythroughScenario;

function phase(
  id: string,
  startMs: number,
  weather: "clear" | "overcast" | "storm",
  timeOfDay: "dawn" | "daylight" | "dusk" | "night",
  timeOfDayPhase: number,
) {
  return Object.freeze({
    endMs: startMs + 20_000,
    id,
    startMs,
    timeOfDay,
    timeOfDayPhase,
    weather,
  });
}

function renderHarness(
  options: {
    readonly blankCheckpointIndex?: number;
    readonly checkpointMutation?: (
      checkpoint: FlythroughCheckpointRenderEvidence,
      index: number,
    ) => FlythroughCheckpointRenderEvidence;
    readonly deferFirstPreflight?: boolean;
    readonly deferReset?: boolean;
    readonly resetFailure?: Error;
  } = {},
): Readonly<{
  checkpointCount(): number;
  complete(flythrough: RenderFlythroughTelemetry): void;
  preflightCount(): number;
  recover(): void;
  resetCount(): number;
  settleFirstPreflight(): void;
  settleReset(): void;
  readonly service: RenderService;
}> {
  let currentSample: FlythroughScenarioSample | null = null;
  let snapshot = renderSnapshot(null);
  const listeners = new Set<(value: RenderTelemetrySnapshot) => void>();
  let checkpoint = 0;
  let preflights = 0;
  let resets = 0;
  let resolveFirstPreflight: (() => void) | null = null;
  let resolveReset: (() => void) | null = null;
  const publish = (): void => {
    for (const listener of listeners) listener(snapshot);
  };
  return Object.freeze({
    checkpointCount: () => checkpoint,
    complete(flythrough): void {
      snapshot = renderSnapshot(flythrough);
      publish();
    },
    preflightCount: () => preflights,
    recover(): void {
      snapshot = { ...snapshot, state: "recovering" };
      publish();
    },
    resetCount: () => resets,
    settleFirstPreflight(): void {
      resolveFirstPreflight?.();
      resolveFirstPreflight = null;
    },
    settleReset(): void {
      resolveReset?.();
      resolveReset = null;
    },
    service: {
      applyFlythroughPreflight(
        _scenarioId: string,
        sample: FlythroughScenarioSample,
      ): Promise<void> {
        currentSample = sample;
        preflights += 1;
        if (options.deferFirstPreflight === true && preflights === 1) {
          return new Promise<void>((resolve) => {
            resolveFirstPreflight = resolve;
          });
        }
        return Promise.resolve();
      },
      async captureFlythroughCheckpoint(checkpointId: string) {
        const sample = currentSample;
        if (sample === null) throw new Error("Checkpoint test sample is missing");
        checkpoint += 1;
        const visiblePixelRatio = checkpoint - 1 === options.blankCheckpointIndex ? 0 : 0.5;
        const evidence: FlythroughCheckpointRenderEvidence = {
          cameraPosition: [sample.observer[0], 20, 0],
          cameraTarget: [sample.observer[0], 20, 0],
          checkpointId,
          clearColorDistanceThreshold: 2,
          clearColorRgb: [10, 20, 30],
          elapsedMs: sample.elapsedMs,
          environment: sample.environment,
          environmentPhaseId: sample.environment.id,
          height: 1,
          previewVisibleMeshCount: 0,
          rgbaSha256: checkpoint.toString(16).padStart(64, "0"),
          sampledPixelCount: 2,
          streamedVisibleMeshCount: 1,
          visiblePixelCount: visiblePixelRatio === 0 ? 0 : 1,
          visiblePixelRatio,
          width: 2,
        };
        return options.checkpointMutation?.(evidence, checkpoint - 1) ?? evidence;
      },
      dispose(): void {},
      resetFlythrough(): Promise<void> {
        resets += 1;
        if (options.resetFailure !== undefined) return Promise.reject(options.resetFailure);
        return options.deferReset === true
          ? new Promise<void>((resolve) => {
              resolveReset = resolve;
            })
          : Promise.resolve();
      },
      snapshot: () => snapshot,
      start(): void {},
      startFlythrough(): void {},
      subscribe(listener: RenderServiceListener) {
        listeners.add(listener);
        listener(snapshot);
        return () => listeners.delete(listener);
      },
    } as unknown as RenderService,
  });
}

function renderSnapshot(flythrough: RenderFlythroughTelemetry | null): RenderTelemetrySnapshot {
  return {
    decoderBootstrap: null,
    decoderFixtures: null,
    failureMessage: null,
    flythrough,
    frameCount: 1,
    greyboxWorld: null,
    recentFrames: [],
    renderPixelSize: { height: 720, width: 1_280 },
    renderPixelSizeOverride: null,
    recovery: {
      lastCause: null,
      lastFailureMessage: null,
      lastRestartDurationMs: null,
      maximumAutomaticRestarts: 1,
      restartCount: 0,
      state: "not-needed",
      workerGeneration: 1,
    },
    sabRingBufferSpike: {
      capacityRecords: 1,
      cooperativeRoundTripsPerSecond: null,
      elapsedMs: null,
      failureMessage: null,
      mainConsumerEmptyPolls: 0,
      mainProducerStalls: 0,
      mainPumpMaxDurationMs: 0,
      messageCount: 1,
      payloadErrors: 0,
      recordWords: 4,
      responsesReceived: 0,
      state: "pending",
      totalSABBytes: 1,
      workerConcurrentFrameCount: 0,
      workerConcurrentFrameIntervalMaxMs: null,
      workerConcurrentRenderDurationMaxMs: null,
      workerElapsedMs: null,
      workerInboundWaits: 0,
      workerOutboundStalls: 0,
      workerSequenceErrors: 0,
    },
    state: "ready",
    workerInitToFirstFrameMs: 1,
    workerStartupToFirstFrameMs: 1,
  };
}

function renderTelemetry(observerUpdateCount: number): RenderFlythroughTelemetry {
  return {
    callbackIntervalMs: distribution(observerUpdateCount),
    cameraPositionMaximum: [120, 20, 0],
    cameraPositionMinimum: [0, 20, 0],
    cameraTargetMaximum: [120, 20, 0],
    cameraTargetMinimum: [0, 20, 0],
    completedDistanceMeters: 120,
    completedElapsedMs: 120_000,
    environmentFrameCounts: {},
    environmentPhaseOrder: scenario.environmentPhases.map((value) => value.id),
    finalObserver: [120, 10, 0],
    frameCount: observerUpdateCount,
    minimumVisibleStreamingMeshCount: 1,
    observerUpdateCount,
    previewVisibleFrameCount: 0,
    renderDurationMs: distribution(observerUpdateCount),
    scenario,
    scenarioId: scenario.id,
    state: "completed",
    streamedPresentationFrameCount: observerUpdateCount,
  };
}

function distribution(sampleCount: number) {
  return { maximum: 1, p50: 1, p95: 1, p999: 1, sampleCount };
}

function streamingHarness(
  options: {
    readonly failOnSetObservers?: boolean;
    readonly onSetObservers?: () => void;
    readonly settleObservers?: boolean;
  } = {},
): Readonly<{
  listenerCount(): number;
  publish(patch: Partial<WorldStreamingTelemetrySnapshot>): void;
  readonly service: WorldStreamingService;
}> {
  let snapshot = streamingSnapshot();
  const listeners = new Set<(value: WorldStreamingTelemetrySnapshot) => void>();
  const publish = (patch: Partial<WorldStreamingTelemetrySnapshot>): void => {
    snapshot = Object.freeze({ ...snapshot, ...patch });
    for (const listener of listeners) listener(snapshot);
  };
  return Object.freeze({
    listenerCount: () => listeners.size,
    publish,
    service: {
      dispose(): void {},
      setObservers(): void {
        const observerUpdateCount = snapshot.observerUpdateCount + 1;
        if (options.failOnSetObservers === true) {
          publish({
            failureMessage: "synchronous streaming failure",
            observerUpdateCount,
            state: "failed",
          });
          return;
        }
        publish({
          observerUpdateCount,
          ...(options.settleObservers === false
            ? {}
            : { settledObserverUpdateCount: observerUpdateCount }),
        });
        options.onSetObservers?.();
      },
      snapshot: () => snapshot,
      start(): void {},
      subscribe(listener: WorldStreamingListener) {
        listeners.add(listener);
        listener(snapshot);
        return () => listeners.delete(listener);
      },
    } as unknown as WorldStreamingService,
  });
}

function streamingSnapshot(): WorldStreamingTelemetrySnapshot {
  return {
    cellLoadSampleCount: 1,
    cellLoadSamples: [],
    cpuBudgetRejectionCount: 0,
    currentObservers: Object.freeze([[0, 12, 0] as const]),
    decodeQueueDepthHighWater: 1,
    decodeWorkerCount: 1,
    encodedBytesRead: 1,
    failureMessage: null,
    flythroughObserverUpdateCount: 0,
    hardwareConcurrency: 1,
    observerUpdateCount: 0,
    opfsAccessHandleCount: 256,
    opfsAccessHandleOpenDurationMs: 10,
    opfsPackageCount: 256,
    opfsProvisionedBytes: 0,
    proactiveEvictionCount: 1,
    residentCellCount: 9,
    residentCellIds: Object.freeze(["a", "b", "c", "d", "e", "f", "g", "h", "i"]),
    residentEncodedBytes: 1,
    residentEncodedBytesHighWater: 1,
    residentGpuBytes: 1,
    residentGpuBytesHighWater: 1,
    renderRecoveryCount: 0,
    schemaVersion: 7,
    settledRecoveryCheckpoint: Object.freeze({
      flythroughObserverUpdateCount: 0,
      observerUpdateCount: 0,
      observers: Object.freeze([[0, 12, 0] as const]),
      residentCellIds: Object.freeze(["a", "b", "c", "d", "e", "f", "g", "h", "i"]),
      workerGeneration: 1,
    }),
    settledObserverUpdateCount: 0,
    state: "streaming",
    workerGeneration: 1,
  };
}
