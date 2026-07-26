import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RenderReadyMessage,
  RenderStartMessage,
  RenderWorkerRequest,
  RenderWorkerResponse,
} from "../src/render/render-protocol";
import {
  createRenderService,
  FLYTHROUGH_RESET_TIMEOUT_MS,
  type GreyboxSceneConfig,
} from "../src/render/render-service";
import { createFlythroughObserverProtocol } from "../src/streaming/flythrough-observer-protocol";

class FakeCanvas {
  readonly clientHeight = 720;
  readonly clientWidth = 1_280;
  replacement: FakeCanvas | null = null;
  transferredCanvas = Object.freeze({ owner: this });

  cloneNode(): FakeCanvas {
    return new FakeCanvas();
  }

  replaceWith(replacement: FakeCanvas): void {
    this.replacement = replacement;
  }

  transferControlToOffscreen(): OffscreenCanvas {
    return this.transferredCanvas as unknown as OffscreenCanvas;
  }
}

class FakeResizeObserver {
  disconnected = false;
  observed: FakeCanvas | null = null;

  disconnect(): void {
    this.disconnected = true;
  }

  observe(canvas: FakeCanvas): void {
    this.observed = canvas;
  }
}

class FakeMessagePort {
  readonly id: number;

  constructor(id: number) {
    this.id = id;
  }

  close(): void {}
}

class FakeMessageChannel {
  static nextPortId = 1;
  readonly port1 = new FakeMessagePort(FakeMessageChannel.nextPortId++);
  readonly port2 = new FakeMessagePort(FakeMessageChannel.nextPortId++);
}

class FakeWorker {
  static instances: FakeWorker[] = [];
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<RenderWorkerResponse>) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly requests: Readonly<{
    message: RenderWorkerRequest;
    transfer: readonly Transferable[];
  }>[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  emit(response: RenderWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<RenderWorkerResponse>);
  }

  postMessage(message: RenderWorkerRequest, transfer: readonly Transferable[] = []): void {
    (this.requests as { message: RenderWorkerRequest; transfer: readonly Transferable[] }[]).push({
      message,
      transfer,
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  FakeWorker.instances = [];
  FakeMessageChannel.nextPortId = 1;
});

describe("render service recovery", () => {
  it("acknowledges preflight only after the worker rendered the exact sample and pixel size", async () => {
    installBrowserFakes();
    const service = createRenderService();
    service.start(new FakeCanvas() as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort: () => undefined,
      mainThreadWorldGenerationMs: 2,
      restartStreamingCohort: () => {
        throw new Error("Unexpected recovery");
      },
      streamingPort: new FakeMessagePort(100) as unknown as MessagePort,
    });
    const worker = requireWorker(0);
    worker.emit(readyMessage());
    service.setRenderPixelSizeOverride({ height: 2_160, width: 3_840 });
    const sample = Object.freeze({
      distanceMeters: 600,
      elapsedMs: 50_000,
      environment: Object.freeze({
        endMs: 100_000,
        id: "clear-daylight-start",
        startMs: 0,
        timeOfDay: "daylight" as const,
        timeOfDayPhase: 0.25,
        weather: "clear" as const,
      }),
      headingRadians: 0,
      observer: Object.freeze([0, 12, -1_200] as const),
      progress: 1 / 12,
    });

    const rendered = service.applyFlythroughPreflight(
      "flythrough-d1@1",
      sample,
      Object.freeze({ beta: Math.PI / 3, heightMeters: 28, radiusMeters: 120 }),
    );
    let settled = false;
    void rendered.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    const request = worker.requests.at(-1)?.message;
    expect(request).toMatchObject({
      flythroughGeneration: 0,
      kind: "flythrough-preflight-sample",
      requestId: 1,
      sample,
      scenarioId: "flythrough-d1@1",
    });
    if (request?.kind !== "flythrough-preflight-sample") {
      throw new Error("Test lost flythrough preflight request");
    }

    worker.emit({
      elapsedMs: sample.elapsedMs,
      environmentPhaseId: sample.environment.id,
      flythroughGeneration: 0,
      height: 2_160,
      kind: "flythrough-preflight-rendered",
      requestId: request.requestId,
      scenarioId: "flythrough-d1@1",
      width: 3_840,
    });
    await expect(rendered).resolves.toBeUndefined();
  });

  it("isolates and deeply freezes worker flythrough evidence at window ingress", async () => {
    installBrowserFakes();
    const service = createRenderService();
    service.start(new FakeCanvas() as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort: () => undefined,
      mainThreadWorldGenerationMs: 2,
      restartStreamingCohort: () => {
        throw new Error("Unexpected recovery");
      },
      streamingPort: new FakeMessagePort(100) as unknown as MessagePort,
    });
    const worker = requireWorker(0);
    worker.emit(readyMessage());

    const checkpointPromise = service.captureFlythroughCheckpoint("clear-daylight");
    const checkpointRequest = worker.requests.at(-1)?.message;
    if (checkpointRequest?.kind !== "capture-flythrough-checkpoint") {
      throw new Error("Test lost checkpoint request");
    }
    const mutableEnvironment = {
      endMs: 1_000,
      id: "clear-daylight",
      startMs: 0,
      timeOfDay: "daylight" as const,
      timeOfDayPhase: 0.25,
      weather: "clear" as const,
    };
    const mutableCheckpoint = {
      cameraPosition: [0, 20, 10] as [number, number, number],
      cameraTarget: [0, 10, 0] as [number, number, number],
      checkpointId: "clear-daylight",
      clearColorDistanceThreshold: 2,
      clearColorRgb: [10, 20, 30] as [number, number, number],
      elapsedMs: 500,
      environment: mutableEnvironment,
      environmentPhaseId: "clear-daylight",
      height: 1,
      previewVisibleMeshCount: 0,
      rgbaSha256: "a".repeat(64),
      sampledPixelCount: 2,
      streamedVisibleMeshCount: 1,
      visiblePixelCount: 1,
      visiblePixelRatio: 0.5,
      width: 2,
    };
    worker.emit({
      evidence: mutableCheckpoint,
      flythroughGeneration: 0,
      kind: "flythrough-checkpoint",
      requestId: checkpointRequest.requestId,
    });
    const checkpoint = await checkpointPromise;

    const mutableScenario = {
      camera: { beta: 1, heightMeters: 10, radiusMeters: 20 },
      durationMs: 1_000,
      environmentPhases: [mutableEnvironment],
      id: "mutable@1",
      path: [[0, 10, 0] as [number, number, number], [1, 10, 0] as [number, number, number]],
      schemaVersion: 1 as const,
      speedMetersPerSecond: 1,
    };
    service.startFlythrough(mutableScenario);
    const mutableCompletion = {
      callbackIntervalMs: distribution(1),
      cameraPositionMaximum: [1, 20, 10] as [number, number, number],
      cameraPositionMinimum: [0, 20, 10] as [number, number, number],
      cameraTargetMaximum: [1, 10, 0] as [number, number, number],
      cameraTargetMinimum: [0, 10, 0] as [number, number, number],
      completedDistanceMeters: 1,
      completedElapsedMs: 1_000,
      environmentFrameCounts: { "clear-daylight": 1 },
      environmentPhaseOrder: ["clear-daylight"],
      finalObserver: [1, 10, 0] as [number, number, number],
      frameCount: 1,
      minimumVisibleStreamingMeshCount: 1,
      observerUpdateCount: 1,
      previewVisibleFrameCount: 0,
      renderDurationMs: distribution(1),
      scenario: mutableScenario,
      scenarioId: "mutable@1",
      state: "completed" as const,
      streamedPresentationFrameCount: 1,
    };
    worker.emit({
      flythroughGeneration: 0,
      kind: "flythrough-complete",
      telemetry: mutableCompletion,
    });
    const flythrough = service.snapshot().flythrough;
    if (flythrough === null) throw new Error("Test lost flythrough completion");
    const exportedBeforeMutation = JSON.stringify({ checkpoint, flythrough });

    expect(Object.isFrozen(checkpoint.environment)).toBe(true);
    expect(Object.isFrozen(checkpoint.cameraPosition)).toBe(true);
    expect(Object.isFrozen(flythrough.scenario.path)).toBe(true);
    expect(Object.isFrozen(flythrough.scenario.path[0])).toBe(true);
    expect(Object.isFrozen(flythrough.callbackIntervalMs)).toBe(true);
    expect(() => {
      (checkpoint.environment as { id: string }).id = "tampered";
    }).toThrow(TypeError);
    expect(() => {
      (flythrough.scenario.path[0] as unknown as number[])[0] = 999;
    }).toThrow(TypeError);

    mutableCheckpoint.cameraPosition[0] = 999;
    mutableEnvironment.id = "source-tampered";
    const mutableFirstPathPoint = mutableScenario.path[0];
    if (mutableFirstPathPoint === undefined) throw new Error("Mutable scenario path is empty");
    mutableFirstPathPoint[0] = 999;
    mutableCompletion.cameraPositionMinimum[0] = 999;
    expect(JSON.stringify({ checkpoint, flythrough })).toBe(exportedBeforeMutation);
  });

  it("settles checkpoint cancellation only after a generation-scoped worker reset ack", async () => {
    installBrowserFakes();
    const service = createRenderService();
    service.start(new FakeCanvas() as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort: () => undefined,
      mainThreadWorldGenerationMs: 2,
      restartStreamingCohort: () => {
        throw new Error("Unexpected recovery");
      },
      streamingPort: new FakeMessagePort(100) as unknown as MessagePort,
    });
    const worker = requireWorker(0);
    worker.emit(readyMessage());

    const checkpoint = service.captureFlythroughCheckpoint("hung");
    const checkpointRequest = worker.requests.at(-1)?.message;
    expect(checkpointRequest).toMatchObject({
      flythroughGeneration: 0,
      kind: "capture-flythrough-checkpoint",
    });

    const reset = service.resetFlythrough();
    await expect(checkpoint).rejects.toThrow(/reset cancelled checkpoint/);
    const resetRequest = worker.requests.at(-1)?.message;
    expect(resetRequest).toEqual({
      kind: "reset-flythrough",
      nextFlythroughGeneration: 1,
      requestId: 1,
    });
    let resetSettled = false;
    void reset.then(() => {
      resetSettled = true;
    });
    await Promise.resolve();
    expect(resetSettled).toBe(false);

    if (checkpointRequest?.kind !== "capture-flythrough-checkpoint") {
      throw new Error("Test lost checkpoint request");
    }
    worker.emit({
      evidence: {} as never,
      flythroughGeneration: 0,
      kind: "flythrough-checkpoint",
      requestId: checkpointRequest.requestId,
    });
    expect(service.snapshot().state).toBe("ready");
    worker.emit({
      flythroughGeneration: 1,
      kind: "flythrough-reset-complete",
      requestId: 1,
    });
    await expect(reset).resolves.toBeUndefined();
    expect(service.snapshot().state).toBe("ready");
  });

  it("cancels an unacknowledged preflight render at reset and ignores its stale ack", async () => {
    installBrowserFakes();
    const service = createRenderService();
    service.start(new FakeCanvas() as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort: () => undefined,
      mainThreadWorldGenerationMs: 2,
      restartStreamingCohort: () => {
        throw new Error("Unexpected recovery");
      },
      streamingPort: new FakeMessagePort(100) as unknown as MessagePort,
    });
    const worker = requireWorker(0);
    worker.emit(readyMessage());
    const sample = Object.freeze({
      distanceMeters: 10,
      elapsedMs: 10,
      environment: Object.freeze({
        endMs: 20,
        id: "clear",
        startMs: 0,
        timeOfDay: "daylight" as const,
        timeOfDayPhase: 0.25,
        weather: "clear" as const,
      }),
      headingRadians: 0,
      observer: Object.freeze([0, 12, 0] as const),
      progress: 0.5,
    });
    const preflight = service.applyFlythroughPreflight(
      "test@1",
      sample,
      Object.freeze({ beta: 1, heightMeters: 10, radiusMeters: 20 }),
    );
    const request = worker.requests.at(-1)?.message;
    if (request?.kind !== "flythrough-preflight-sample") {
      throw new Error("Test lost flythrough preflight request");
    }

    const reset = service.resetFlythrough();
    await expect(preflight).rejects.toThrow(/reset cancelled preflight render/);
    worker.emit({
      elapsedMs: sample.elapsedMs,
      environmentPhaseId: sample.environment.id,
      flythroughGeneration: 0,
      height: 720,
      kind: "flythrough-preflight-rendered",
      requestId: request.requestId,
      scenarioId: "test@1",
      width: 1_280,
    });
    expect(service.snapshot().state).toBe("ready");
    worker.emit({
      flythroughGeneration: 1,
      kind: "flythrough-reset-complete",
      requestId: 1,
    });
    await expect(reset).resolves.toBeUndefined();
  });

  it("bounds a heartbeat-alive reset stall and enters cohort recovery", async () => {
    vi.useFakeTimers();
    installBrowserFakes();
    const service = createRenderService();
    const restartStreamingCohort = vi.fn(() => ({
      checkpoint: recoveryCheckpoint(1),
      settled: new Promise<ReturnType<typeof recoveryCheckpoint>>(() => undefined),
      streamingPort: new FakeMessagePort(200) as unknown as MessagePort,
    }));
    service.start(new FakeCanvas() as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort: () => undefined,
      mainThreadWorldGenerationMs: 2,
      restartStreamingCohort,
      streamingPort: new FakeMessagePort(100) as unknown as MessagePort,
    });
    const worker = requireWorker(0);
    worker.emit(readyMessage());
    const reset = service.resetFlythrough();
    const resetRejection = expect(reset).rejects.toThrow(
      new RegExp(`did not settle within ${FLYTHROUGH_RESET_TIMEOUT_MS} ms`),
    );

    for (let elapsed = 0; elapsed < FLYTHROUGH_RESET_TIMEOUT_MS - 1_000; elapsed += 1_000) {
      await vi.advanceTimersByTimeAsync(1_000);
      worker.emit({ kind: "heartbeat", workerGeneration: 1 });
    }
    await vi.advanceTimersByTimeAsync(999);
    worker.emit({ kind: "heartbeat", workerGeneration: 1 });
    expect(service.snapshot().state).toBe("ready");
    await vi.advanceTimersByTimeAsync(2);

    await resetRejection;
    expect(restartStreamingCohort).toHaveBeenCalledOnce();
    expect(service.snapshot()).toMatchObject({
      recovery: { lastCause: "render-error", restartCount: 1, state: "restarting" },
      state: "recovering",
    });
    service.dispose();
  });

  it("reconciles reset-separated flythrough identity across idle cohort recovery", async () => {
    installBrowserFakes();
    const service = createRenderService();
    const checkpoint = recoveryCheckpoint(1);
    service.start(new FakeCanvas() as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort: () => undefined,
      mainThreadWorldGenerationMs: 2,
      restartStreamingCohort: () => ({
        checkpoint,
        settled: Promise.resolve(recoveryCheckpoint(2)),
        streamingPort: new FakeMessagePort(200) as unknown as MessagePort,
      }),
      streamingPort: new FakeMessagePort(100) as unknown as MessagePort,
    });
    const firstWorker = requireWorker(0);
    firstWorker.emit(readyMessage());
    service.startFlythrough({} as never);
    const reset = service.resetFlythrough();
    firstWorker.emit({
      flythroughGeneration: 1,
      kind: "flythrough-reset-complete",
      requestId: 1,
    });
    await reset;

    firstWorker.emit({ kind: "device-lost", message: "idle recovery", reason: "destroyed" });
    const replacementStart = requireStart(requireWorker(1));
    expect(replacementStart).toMatchObject({
      flythroughGeneration: 0,
      flythroughTransportSequence: 8,
    });

    const replacementStreamingProtocol = createFlythroughObserverProtocol(
      replacementStart.flythroughTransportSequence,
    );
    expect(
      replacementStreamingProtocol.acceptObserver({
        flythroughGeneration: replacementStart.flythroughGeneration,
        kind: "flythrough-observers",
        observers: [[0, 0, 0]],
        sequence: 1,
        transportSequence: replacementStart.flythroughTransportSequence + 1,
      }),
    ).toBe(9);
    service.dispose();
  });

  it("publishes and applies a fixed render size until the override is cleared", () => {
    installBrowserFakes();
    const service = createRenderService();
    const canvas = new FakeCanvas();
    service.start(canvas as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort: () => undefined,
      mainThreadWorldGenerationMs: 2,
      restartStreamingCohort: () => {
        throw new Error("Unexpected recovery");
      },
      streamingPort: new FakeMessagePort(100) as unknown as MessagePort,
    });
    const worker = requireWorker(0);
    worker.emit(readyMessage());

    service.setRenderPixelSizeOverride({ height: 2_160, width: 3_840 });
    expect(worker.requests.at(-1)?.message).toEqual({
      height: 2_160,
      kind: "resize",
      width: 3_840,
    });
    expect(service.snapshot()).toMatchObject({
      renderPixelSize: { height: 2_160, width: 3_840 },
      renderPixelSizeOverride: { height: 2_160, width: 3_840 },
    });

    service.setRenderPixelSizeOverride(null);
    expect(worker.requests.at(-1)?.message).toEqual({
      height: 720,
      kind: "resize",
      width: 1_280,
    });
    expect(service.snapshot()).toMatchObject({
      renderPixelSize: { height: 720, width: 1_280 },
      renderPixelSizeOverride: null,
    });
  });

  it("retains a recovery attempt's latest requested size when ready arrives after override restoration", async () => {
    installBrowserFakes();
    const service = createRenderService();
    const canvas = new FakeCanvas();
    const settlement = deferredStreamingSettlement();
    service.start(canvas as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort: () => undefined,
      mainThreadWorldGenerationMs: 2,
      restartStreamingCohort: () => ({
        checkpoint: recoveryCheckpoint(1),
        settled: settlement.promise,
        streamingPort: new FakeMessagePort(200) as unknown as MessagePort,
      }),
      streamingPort: new FakeMessagePort(100) as unknown as MessagePort,
    });
    const firstWorker = requireWorker(0);
    firstWorker.emit(readyMessage());
    service.setRenderPixelSizeOverride({ height: 2_160, width: 3_840 });

    firstWorker.emit({ kind: "device-lost", message: "injected", reason: "destroyed" });
    const replacementWorker = requireWorker(1);
    expect(requireStart(replacementWorker)).toMatchObject({
      height: 2_160,
      width: 3_840,
    });

    service.setRenderPixelSizeOverride(null);
    expect(replacementWorker.requests.at(-1)?.message).toEqual({
      height: 720,
      kind: "resize",
      width: 1_280,
    });
    replacementWorker.emit(readyMessage());
    settlement.resolve(recoveryCheckpoint(2));
    await Promise.resolve();

    expect(service.snapshot()).toMatchObject({
      renderPixelSize: { height: 720, width: 1_280 },
      renderPixelSizeOverride: null,
      state: "ready",
    });
    service.dispose();
  });

  it("restarts once and publishes recovery only after render-ready and streaming settlement", async () => {
    installBrowserFakes();
    const service = createRenderService();
    const canvas = new FakeCanvas();
    const firstStreamingPort = new FakeMessagePort(100);
    const replacementStreamingPort = new FakeMessagePort(200);
    const settlement = deferredStreamingSettlement();
    const restartStreamingCohort = vi.fn(() => ({
      checkpoint: recoveryCheckpoint(1),
      settled: settlement.promise,
      streamingPort: replacementStreamingPort as unknown as MessagePort,
    }));
    const failStreamingCohort = vi.fn();

    service.start(canvas as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort,
      mainThreadWorldGenerationMs: 2,
      restartStreamingCohort,
      streamingPort: firstStreamingPort as unknown as MessagePort,
    });
    const firstWorker = requireWorker(0);
    const firstStart = requireStart(firstWorker);
    const staleMessageHandler = firstWorker.onmessage;

    firstWorker.emit({
      kind: "device-lost",
      message: "injected",
      reason: "destroyed",
    });

    const secondWorker = requireWorker(1);
    const secondStart = requireStart(secondWorker);
    expect(firstWorker.terminated).toBe(true);
    expect(restartStreamingCohort).toHaveBeenCalledOnce();
    expect(canvas.replacement).not.toBeNull();
    expect(firstStart.canvas).toBe(canvas.transferredCanvas);
    expect(secondStart.canvas).toBe(canvas.replacement?.transferredCanvas);
    expect(firstStart.streamingPort).toBe(firstStreamingPort);
    expect(secondStart.streamingPort).toBe(replacementStreamingPort);
    expect(firstStart.workerGeneration).toBe(1);
    expect(secondStart.workerGeneration).toBe(2);
    expect(firstStart.sabRingBufferSpike.commandRing.buffer).not.toBe(
      secondStart.sabRingBufferSpike.commandRing.buffer,
    );
    expect(firstStart.sabRingBufferSpike.responseRing.buffer).not.toBe(
      secondStart.sabRingBufferSpike.responseRing.buffer,
    );
    expect(service.snapshot()).toMatchObject({
      recovery: {
        lastCause: "device-loss",
        restartCount: 1,
        state: "restarting",
        workerGeneration: 2,
      },
      state: "recovering",
    });

    secondWorker.emit(readyMessage());
    expect(service.snapshot()).toMatchObject({
      recovery: { state: "restarting" },
      state: "recovering",
    });
    settlement.resolve(recoveryCheckpoint(2));
    await Promise.resolve();
    expect(service.snapshot()).toMatchObject({
      failureMessage: null,
      frameCount: 1,
      recovery: {
        lastCause: "device-loss",
        restartCount: 1,
        state: "recovered",
        workerGeneration: 2,
      },
      state: "ready",
    });

    staleMessageHandler?.({
      data: {
        frameCount: 99,
        kind: "frame",
        samples: [frameSample()],
      },
    } as unknown as MessageEvent<RenderWorkerResponse>);
    expect(service.snapshot().frameCount).toBe(1);
    expect(failStreamingCohort).not.toHaveBeenCalled();
    service.dispose();
  });

  it("fails terminally when the replacement attempt faults before ready", () => {
    installBrowserFakes();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const service = createRenderService();
    const canvas = new FakeCanvas();
    const replacementStreamingPort = new FakeMessagePort(200);
    const failStreamingCohort = vi.fn();

    service.start(canvas as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort,
      mainThreadWorldGenerationMs: 2,
      restartStreamingCohort: () => ({
        checkpoint: recoveryCheckpoint(1),
        settled: new Promise(() => undefined),
        streamingPort: replacementStreamingPort as unknown as MessagePort,
      }),
      streamingPort: new FakeMessagePort(100) as unknown as MessagePort,
    });
    requireWorker(0).emit({
      kind: "device-lost",
      message: "first injected fault",
      reason: "destroyed",
    });
    const replacementWorker = requireWorker(1);

    replacementWorker.emit({
      cause: "render-error",
      kind: "error",
      message: "replacement initialization failed",
    });

    expect(replacementWorker.terminated).toBe(true);
    expect(failStreamingCohort).toHaveBeenCalledOnce();
    expect(failStreamingCohort).toHaveBeenCalledWith("replacement initialization failed");
    expect(service.snapshot()).toMatchObject({
      failureMessage: "replacement initialization failed",
      recovery: {
        lastCause: "render-error",
        lastFailureMessage: "replacement initialization failed",
        restartCount: 1,
        state: "exhausted",
        workerGeneration: 2,
      },
      state: "failed",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Render worker failed",
      "replacement initialization failed",
    );
  });

  it("allows a second deterministic probe so the bounded terminal path is testable", async () => {
    installBrowserFakes();
    const service = createRenderService();
    const canvas = new FakeCanvas();

    service.start(canvas as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort: () => undefined,
      mainThreadWorldGenerationMs: 2,
      restartStreamingCohort: () => ({
        checkpoint: recoveryCheckpoint(1),
        settled: Promise.resolve(recoveryCheckpoint(2)),
        streamingPort: new FakeMessagePort(200) as unknown as MessagePort,
      }),
      streamingPort: new FakeMessagePort(100) as unknown as MessagePort,
    });
    requireWorker(0).emit({
      kind: "device-lost",
      message: "first injected fault",
      reason: "destroyed",
    });
    const replacementWorker = requireWorker(1);
    replacementWorker.emit(readyMessage());
    await vi.waitFor(() => expect(service.snapshot().state).toBe("ready"));

    expect(() => service.exerciseRecovery("worker-crash")).not.toThrow();
    expect(replacementWorker.requests.at(-1)?.message).toEqual({
      kind: "exercise-recovery",
      probe: "worker-crash",
    });
    service.dispose();
  });

  it("waits for render-ready when streaming hydration settles first", async () => {
    installBrowserFakes();
    const service = createRenderService();
    const settlement = deferredStreamingSettlement();
    service.start(new FakeCanvas() as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort: () => undefined,
      mainThreadWorldGenerationMs: 2,
      restartStreamingCohort: () => ({
        checkpoint: recoveryCheckpoint(1),
        settled: settlement.promise,
        streamingPort: new FakeMessagePort(200) as unknown as MessagePort,
      }),
      streamingPort: new FakeMessagePort(100) as unknown as MessagePort,
    });
    requireWorker(0).emit({
      kind: "device-lost",
      message: "first injected fault",
      reason: "destroyed",
    });
    settlement.resolve(recoveryCheckpoint(2));
    await Promise.resolve();
    expect(service.snapshot().state).toBe("recovering");
    requireWorker(1).emit(readyMessage());
    expect(service.snapshot().state).toBe("ready");
  });

  it("fails render terminally when replacement streaming hydration rejects", async () => {
    installBrowserFakes();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const service = createRenderService();
    const failStreamingCohort = vi.fn();
    service.start(new FakeCanvas() as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort,
      mainThreadWorldGenerationMs: 2,
      restartStreamingCohort: () => ({
        checkpoint: recoveryCheckpoint(1),
        settled: Promise.reject(new Error("checkpoint mismatch")),
        streamingPort: new FakeMessagePort(200) as unknown as MessagePort,
      }),
      streamingPort: new FakeMessagePort(100) as unknown as MessagePort,
    });
    requireWorker(0).emit({
      kind: "device-lost",
      message: "first injected fault",
      reason: "destroyed",
    });
    await vi.waitFor(() => expect(service.snapshot().state).toBe("failed"));
    expect(service.snapshot().failureMessage).toMatch(/checkpoint mismatch/);
    expect(failStreamingCohort).toHaveBeenCalled();
  });

  it("passes the exact acknowledged diagnostic checkpoint into cohort recovery", async () => {
    installBrowserFakes();
    const service = createRenderService();
    const checkpoint = recoveryCheckpoint(1);
    const restartStreamingCohort = vi.fn(() => ({
      checkpoint,
      settled: new Promise<ReturnType<typeof recoveryCheckpoint>>(() => undefined),
      streamingPort: new FakeMessagePort(200) as unknown as MessagePort,
    }));
    service.start(new FakeCanvas() as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort: () => undefined,
      mainThreadWorldGenerationMs: 2,
      restartStreamingCohort,
      streamingPort: new FakeMessagePort(100) as unknown as MessagePort,
    });
    const firstWorker = requireWorker(0);
    firstWorker.emit(readyMessage());
    const boundary = service.exerciseRecoveryAtBoundary("device-loss");
    const request = firstWorker.requests.at(-1)?.message;
    expect(request).toMatchObject({
      kind: "exercise-recovery-at-boundary",
      probe: "device-loss",
    });
    if (request?.kind !== "exercise-recovery-at-boundary") {
      throw new Error("Test lost the recovery-boundary request");
    }
    firstWorker.emit({
      checkpoint,
      kind: "recovery-boundary",
      requestId: request.requestId,
    });
    await expect(boundary).resolves.toEqual(checkpoint);
    firstWorker.emit({
      kind: "device-lost",
      message: "injected",
      reason: "destroyed",
    });
    expect(restartStreamingCohort).toHaveBeenCalledWith(checkpoint);
  });

  it("fails terminally and rejects a pending recovery boundary when streaming fails", async () => {
    installBrowserFakes();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const service = createRenderService();
    service.start(new FakeCanvas() as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort: () => undefined,
      mainThreadWorldGenerationMs: 2,
      restartStreamingCohort: () => ({
        checkpoint: recoveryCheckpoint(1),
        settled: Promise.resolve(recoveryCheckpoint(2)),
        streamingPort: new FakeMessagePort(200) as unknown as MessagePort,
      }),
      streamingPort: new FakeMessagePort(100) as unknown as MessagePort,
    });
    const worker = requireWorker(0);
    worker.emit(readyMessage());
    const boundary = service.exerciseRecoveryAtBoundary("device-loss");

    service.failAfterStreamingFailure("quiesce transport failed");

    await expect(boundary).rejects.toThrow(/failed before checkpoint capture completed/);
    expect(service.snapshot()).toMatchObject({
      failureMessage: "Streaming cohort failed: quiesce transport failed",
      recovery: { state: "exhausted" },
      state: "failed",
    });
  });

  it("deep-clones the diagnostic checkpoint for internal and caller-owned copies", async () => {
    installBrowserFakes();
    const service = createRenderService();
    const restartStreamingCohort = vi.fn(() => ({
      checkpoint: recoveryCheckpoint(1),
      settled: new Promise<ReturnType<typeof recoveryCheckpoint>>(() => undefined),
      streamingPort: new FakeMessagePort(200) as unknown as MessagePort,
    }));
    service.start(new FakeCanvas() as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort: () => undefined,
      mainThreadWorldGenerationMs: 2,
      restartStreamingCohort,
      streamingPort: new FakeMessagePort(100) as unknown as MessagePort,
    });
    const worker = requireWorker(0);
    worker.emit(readyMessage());
    const boundaryPromise = service.exerciseRecoveryAtBoundary("device-loss");
    const request = worker.requests.at(-1)?.message;
    if (request?.kind !== "exercise-recovery-at-boundary") {
      throw new Error("Test lost the recovery-boundary request");
    }
    const mutableCheckpoint = {
      flythroughObserverUpdateCount: 8,
      observerUpdateCount: 8,
      observers: [[384, 12, -192]] as [number, number, number][],
      residentCellIds: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
      workerGeneration: 1,
    };
    worker.emit({
      checkpoint: mutableCheckpoint,
      kind: "recovery-boundary",
      requestId: request.requestId,
    });
    const exposed = await boundaryPromise;
    expect(exposed).not.toBe(mutableCheckpoint);
    expect(exposed.observers).not.toBe(mutableCheckpoint.observers);
    mutableCheckpoint.observers[0] = [999, 999, 999];
    mutableCheckpoint.residentCellIds[0] = "tampered";

    worker.emit({ kind: "device-lost", message: "injected", reason: "destroyed" });

    expect(restartStreamingCohort).toHaveBeenCalledWith(
      expect.objectContaining({
        observers: [[384, 12, -192]],
        residentCellIds: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
      }),
    );
    expect(Object.isFrozen(exposed.observers[0])).toBe(true);
  });

  it("rejects an unsorted or duplicate diagnostic recovery checkpoint", async () => {
    installBrowserFakes();
    const service = createRenderService();
    service.start(new FakeCanvas() as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort: () => undefined,
      mainThreadWorldGenerationMs: 2,
      restartStreamingCohort: () => ({
        checkpoint: recoveryCheckpoint(1),
        settled: new Promise(() => undefined),
        streamingPort: new FakeMessagePort(200) as unknown as MessagePort,
      }),
      streamingPort: new FakeMessagePort(100) as unknown as MessagePort,
    });
    const worker = requireWorker(0);
    worker.emit(readyMessage());
    const boundary = service.exerciseRecoveryAtBoundary("device-loss");
    const request = worker.requests.at(-1)?.message;
    if (request?.kind !== "exercise-recovery-at-boundary") {
      throw new Error("Test lost the recovery-boundary request");
    }
    worker.emit({
      checkpoint: {
        ...recoveryCheckpoint(1),
        residentCellIds: ["a", "b", "c", "d", "e", "f", "g", "i", "i"],
      },
      kind: "recovery-boundary",
      requestId: request.requestId,
    });

    await expect(boundary).rejects.toThrow(/restarted before checkpoint capture completed/);
  });
});

function installBrowserFakes(): void {
  vi.stubGlobal("devicePixelRatio", 1);
  vi.stubGlobal("HTMLCanvasElement", FakeCanvas);
  vi.stubGlobal("MessageChannel", FakeMessageChannel);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("Worker", FakeWorker);
}

function requireWorker(index: number): FakeWorker {
  const worker = FakeWorker.instances[index];
  if (worker === undefined) throw new Error(`Render worker ${index} was not constructed`);
  return worker;
}

function requireStart(worker: FakeWorker): RenderStartMessage {
  const request = worker.requests.find(
    (
      candidate,
    ): candidate is Readonly<{
      message: RenderStartMessage;
      transfer: readonly Transferable[];
    }> => candidate.message.kind === "start",
  );
  if (request === undefined) throw new Error("Render worker did not receive start");
  return request.message;
}

function frameSample() {
  return Object.freeze({
    durationMs: 1,
    lightingIntensity: 1,
    lightingPhase: 0,
    presentIntervalMs: null,
  });
}

function distribution(sampleCount: number) {
  return { maximum: 1, p50: 1, p95: 1, p999: 1, sampleCount };
}

function readyMessage(): RenderReadyMessage {
  return Object.freeze({
    decoderBootstrap: Object.freeze({
      installedAtMs: 1,
      paths: Object.freeze({
        draco: "preinstalled-global",
        ktx2: "preinstalled-global",
        meshopt: "preinstalled-global",
      }),
      versions: Object.freeze({
        draco: "1.5.7",
        ktx2: "9.17.0",
        meshopt: "1.2.0",
      }),
    }),
    decoderFixtures: Object.freeze({
      draco: Object.freeze({ durationMs: 1, faces: 1 }),
      ktx2: Object.freeze({ durationMs: 1, height: 128, transcoder: "test", width: 128 }),
      meshopt: Object.freeze({ bytes: 48, durationMs: 1 }),
    }),
    firstFrame: frameSample(),
    greyboxWorld: Object.freeze({
      cellCount: 1,
      clearColor: Object.freeze([0, 0, 0, 1] as const),
      colliderCount: 1,
      districtId: "test",
      dynamicLighting: true,
      heightSampleCount: 4,
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
    kind: "ready",
    workerInitToFirstFrameMs: 2,
  });
}

function recoveryCheckpoint(workerGeneration: number) {
  return Object.freeze({
    flythroughObserverUpdateCount: 8,
    observerUpdateCount: 8,
    observers: Object.freeze([[384, 12, -192] as const]),
    residentCellIds: Object.freeze(["a", "b", "c", "d", "e", "f", "g", "h", "i"]),
    workerGeneration,
  });
}

function deferredStreamingSettlement() {
  let resolve!: (checkpoint: ReturnType<typeof recoveryCheckpoint>) => void;
  const promise = new Promise<ReturnType<typeof recoveryCheckpoint>>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
