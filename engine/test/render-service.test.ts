import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmbeddedPsoWarmupTrace } from "../src/render/installed-pso-warmup";
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
import type { HybridUiPresentation } from "../src/ui/hybrid-ui-contract";
import { idleHybridUiWorkerTelemetry } from "../src/ui/hybrid-ui-contract";

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
  it("replays hybrid UI state and admits only worker-authorized actions", () => {
    installBrowserFakes();
    const service = createRenderService();
    const presentation = hybridUiPresentation();
    service.setHybridUiPresentation(presentation);
    let retainedPresentationWasQueuedAtReady = false;
    service.subscribe((snapshot) => {
      if (snapshot.state !== "ready") return;
      retainedPresentationWasQueuedAtReady =
        requireWorker(0).requests.at(-1)?.message.kind === "hybrid-ui-presentation";
    });
    service.start(new FakeCanvas() as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort: () => undefined,
      mainThreadWorldGenerationMs: 2,
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
      restartStreamingCohort: () => {
        throw new Error("Unexpected recovery");
      },
      streamingPort: new FakeMessagePort(100) as unknown as MessagePort,
    });
    const worker = requireWorker(0);
    worker.emit(readyMessage());
    expect(retainedPresentationWasQueuedAtReady).toBe(true);
    expect(worker.requests.at(-1)?.message).toEqual({
      kind: "hybrid-ui-presentation",
      presentation,
    });

    const actions: string[] = [];
    service.subscribeHybridUiActions((action) => actions.push(action.actionId));
    service.sendHybridUiInput({ kind: "activate", sequence: 1 });
    expect(worker.requests.at(-1)?.message).toEqual({
      input: { kind: "activate", sequence: 1 },
      kind: "hybrid-ui-input",
    });
    worker.emit({
      action: {
        actionId: "inventory:use",
        inputSequence: 1,
        payload: null,
        presentationRevision: presentation.revision,
        source: "heavy-screen-worker",
      },
      kind: "hybrid-ui-action",
      telemetry: {
        ...idleHybridUiWorkerTelemetry(),
        actionCount: 1,
        heavyPrimitiveCount: 1,
        inputCount: 1,
        presentationCount: 1,
        presentationRevision: presentation.revision,
      },
    });
    expect(actions).toEqual(["inventory:use"]);
    expect(service.snapshot().hybridUi).toMatchObject({ actionCount: 1, presentationRevision: 2 });

    service.setHybridUiPresentation({ ...presentation, revision: 1 });
    expect(worker.requests.at(-1)?.message.kind).toBe("hybrid-ui-input");
    expect(() => service.sendHybridUiInput({ kind: "activate", sequence: 1 })).toThrow(
      /strictly increasing/,
    );
    worker.emit({
      action: {
        actionId: "inventory:use",
        inputSequence: 99,
        payload: null,
        presentationRevision: presentation.revision,
        source: "heavy-screen-worker",
      },
      kind: "hybrid-ui-action",
      telemetry: {
        ...idleHybridUiWorkerTelemetry(),
        actionCount: 2,
        heavyPrimitiveCount: 1,
        inputCount: 2,
        presentationCount: 1,
        presentationRevision: presentation.revision,
      },
    });
    expect(service.snapshot().state).toBe("failed");
  });

  it("routes invalid standalone hybrid UI telemetry through recovery", () => {
    installBrowserFakes();
    const service = createRenderService();
    service.start(new FakeCanvas() as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort: () => undefined,
      mainThreadWorldGenerationMs: 2,
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
      restartStreamingCohort: () => {
        throw new Error("injected recovery stop");
      },
      streamingPort: new FakeMessagePort(100) as unknown as MessagePort,
    });
    const worker = requireWorker(0);
    worker.emit(readyMessage());
    worker.emit({
      inputSequence: null,
      kind: "hybrid-ui-telemetry",
      telemetry: {
        ...idleHybridUiWorkerTelemetry(),
        worldAnchorCount: 65,
      },
    });
    expect(service.snapshot()).toMatchObject({
      failureMessage: expect.stringContaining("invalid hybrid UI telemetry"),
      state: "failed",
    });
  });

  it("requires exact pointer hits and in-order worker acknowledgements", () => {
    installBrowserFakes();
    const service = createRenderService();
    const presentation = hybridUiPresentation();
    service.setHybridUiPresentation(presentation);
    service.start(new FakeCanvas() as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort: () => undefined,
      mainThreadWorldGenerationMs: 2,
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
      restartStreamingCohort: () => {
        throw new Error("injected recovery stop");
      },
      streamingPort: new FakeMessagePort(100) as unknown as MessagePort,
    });
    const worker = requireWorker(0);
    worker.emit(readyMessage());
    service.sendHybridUiInput({ kind: "pointer-activate", sequence: 1, x: 0.9, y: 0.9 });
    service.sendHybridUiInput({ kind: "activate", sequence: 2 });
    worker.emit({
      inputSequence: 2,
      kind: "hybrid-ui-telemetry",
      telemetry: {
        ...idleHybridUiWorkerTelemetry(),
        inputCount: 1,
        presentationCount: 1,
        presentationRevision: presentation.revision,
      },
    });
    expect(service.snapshot()).toMatchObject({
      failureMessage: expect.stringContaining("oldest pending input"),
      state: "failed",
    });

    const screen = presentation.heavyScreen;
    if (screen === null) throw new Error("Test presentation lacks a heavy screen");
    const basePrimitive = screen.primitives[0];
    if (basePrimitive === undefined) throw new Error("Test presentation lacks a primitive");
    const occludedPresentation = Object.freeze({
      ...presentation,
      heavyScreen: Object.freeze({
        ...screen,
        primitives: Object.freeze([
          ...screen.primitives,
          Object.freeze({
            ...basePrimitive,
            actionId: null,
            id: "inventory:overlay",
            layer: 1,
          }),
        ]),
      }),
    });
    const exactService = createRenderService();
    exactService.setHybridUiPresentation(occludedPresentation);
    exactService.start(new FakeCanvas() as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort: () => undefined,
      mainThreadWorldGenerationMs: 2,
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
      restartStreamingCohort: () => {
        throw new Error("injected recovery stop");
      },
      streamingPort: new FakeMessagePort(101) as unknown as MessagePort,
    });
    const exactWorker = requireWorker(1);
    exactWorker.emit(readyMessage());
    exactService.sendHybridUiInput({ kind: "pointer-activate", sequence: 1, x: 0.3, y: 0.3 });
    exactWorker.emit({
      action: {
        actionId: "inventory:use",
        inputSequence: 1,
        payload: null,
        presentationRevision: occludedPresentation.revision,
        source: "heavy-screen-worker",
      },
      kind: "hybrid-ui-action",
      telemetry: {
        ...idleHybridUiWorkerTelemetry(),
        actionCount: 1,
        inputCount: 1,
        presentationCount: 1,
        presentationRevision: occludedPresentation.revision,
      },
    });
    expect(exactService.snapshot()).toMatchObject({
      failureMessage: expect.stringContaining("exact input result"),
      state: "failed",
    });
  });

  it("replays the latest monotonic gameplay presentation after worker readiness", () => {
    installBrowserFakes();
    const service = createRenderService();
    const initial = Object.freeze({
      cameraPitchRadians: 0.2,
      crowdEntities: Object.freeze([]),
      playerPosition: Object.freeze([1, 2, 3] as const),
      playerYawRadians: 0.5,
      sequence: 4,
    });
    service.setGameplayPresentation(initial);
    service.start(new FakeCanvas() as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort: () => undefined,
      mainThreadWorldGenerationMs: 2,
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
      restartStreamingCohort: () => {
        throw new Error("Unexpected recovery");
      },
      streamingPort: new FakeMessagePort(100) as unknown as MessagePort,
    });
    const worker = requireWorker(0);
    expect(worker.requests).toHaveLength(1);
    worker.emit(readyMessage());
    expect(worker.requests.at(-1)?.message).toEqual({
      ...initial,
      kind: "gameplay-presentation",
    });
    service.setGameplayPresentation({ ...initial, sequence: 3 });
    expect(worker.requests).toHaveLength(2);
    service.setGameplayPresentation({ ...initial, playerPosition: [8, 9, 10], sequence: 5 });
    expect(worker.requests.at(-1)?.message).toMatchObject({
      kind: "gameplay-presentation",
      playerPosition: [8, 9, 10],
      sequence: 5,
    });
  });

  it("acknowledges preflight only after the worker rendered the exact sample and pixel size", async () => {
    installBrowserFakes();
    const service = createRenderService();
    service.start(new FakeCanvas() as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort: () => undefined,
      mainThreadWorldGenerationMs: 2,
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
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
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
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
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
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
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
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
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
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
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
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
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
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
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
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
    const observedCanvases: HTMLCanvasElement[] = [];
    service.subscribeCanvas((activeCanvas) => observedCanvases.push(activeCanvas));
    const restartStreamingCohort = vi.fn(() => ({
      checkpoint: recoveryCheckpoint(1),
      settled: settlement.promise,
      streamingPort: replacementStreamingPort as unknown as MessagePort,
    }));
    const failStreamingCohort = vi.fn();

    service.start(canvas as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort,
      mainThreadWorldGenerationMs: 2,
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
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
    expect(observedCanvases).toEqual([
      canvas as unknown as HTMLCanvasElement,
      canvas.replacement as unknown as HTMLCanvasElement,
    ]);
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

  it("retains the first typed PSO failure across replacement-generation readiness", async () => {
    installBrowserFakes();
    const service = createRenderService();
    const observed = [] as ReturnType<typeof service.snapshot>[];
    service.subscribe((snapshot) => observed.push(snapshot));
    service.start(new FakeCanvas() as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort: () => undefined,
      mainThreadWorldGenerationMs: 2,
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
      restartStreamingCohort: () => ({
        checkpoint: recoveryCheckpoint(1),
        settled: Promise.resolve(recoveryCheckpoint(2)),
        streamingPort: new FakeMessagePort(200) as unknown as MessagePort,
      }),
      streamingPort: new FakeMessagePort(100) as unknown as MessagePort,
    });
    const failureMessage: RenderWorkerResponse = {
      cause: "render-error",
      kind: "error",
      message: "PSO warmup compile failure",
      psoWarmup: failedPsoWarmupSnapshot("compile failed"),
    };
    const serializedFailure = structuredClone(failureMessage);
    expect(serializedFailure).toEqual(failureMessage);
    requireWorker(0).emit(serializedFailure);

    expect(service.snapshot()).toMatchObject({
      psoWarmup: { state: "idle" },
      retainedPsoWarmupFailure: {
        snapshot: {
          cacheMissCount: 1,
          compiledCount: 0,
          failure: { class: "compile", detail: "compile failed" },
          state: "failed",
        },
        workerGeneration: 1,
      },
      state: "recovering",
    });

    requireWorker(1).emit(readyMessage());
    await Promise.resolve();
    expect(service.snapshot()).toMatchObject({
      psoWarmup: { failure: null, state: "ready" },
      retainedPsoWarmupFailure: {
        snapshot: { failure: { class: "compile" }, state: "failed" },
        workerGeneration: 1,
      },
      state: "ready",
    });
    expect(
      observed.every(
        (snapshot) =>
          snapshot.retainedPsoWarmupFailure === null ||
          snapshot.retainedPsoWarmupFailure.workerGeneration < snapshot.recovery.workerGeneration,
      ),
    ).toBe(true);
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
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
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
      psoWarmup: null,
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

  it("keeps the first PSO failure strictly prior to a terminal replacement failure", () => {
    installBrowserFakes();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const service = createRenderService();
    service.start(new FakeCanvas() as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort: () => undefined,
      mainThreadWorldGenerationMs: 2,
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
      restartStreamingCohort: () => ({
        checkpoint: recoveryCheckpoint(1),
        settled: new Promise(() => undefined),
        streamingPort: new FakeMessagePort(200) as unknown as MessagePort,
      }),
      streamingPort: new FakeMessagePort(100) as unknown as MessagePort,
    });
    requireWorker(0).emit({
      cause: "render-error",
      kind: "error",
      message: "first PSO failure",
      psoWarmup: failedPsoWarmupSnapshot("first compile failed"),
    });
    requireWorker(1).emit({
      cause: "render-error",
      kind: "error",
      message: "replacement PSO failure",
      psoWarmup: failedPsoWarmupSnapshot("replacement compile failed"),
    });

    expect(service.snapshot()).toMatchObject({
      psoWarmup: {
        failure: { detail: "replacement compile failed" },
        state: "failed",
      },
      recovery: { state: "exhausted", workerGeneration: 2 },
      retainedPsoWarmupFailure: {
        snapshot: { failure: { detail: "first compile failed" }, state: "failed" },
        workerGeneration: 1,
      },
      state: "failed",
    });
  });

  it("allows a second deterministic probe so the bounded terminal path is testable", async () => {
    installBrowserFakes();
    const service = createRenderService();
    const canvas = new FakeCanvas();

    service.start(canvas as unknown as HTMLCanvasElement, {} as GreyboxSceneConfig, {
      failStreamingCohort: () => undefined,
      mainThreadWorldGenerationMs: 2,
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
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
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
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
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
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
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
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
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
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
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
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
      psoWarmupTrace: createEmbeddedPsoWarmupTrace(),
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
    psoWarmup: Object.freeze({
      buildCompatibilityDigest: "a".repeat(64),
      cacheHitCount: 1,
      cacheMissCount: 1,
      compiledCount: 1,
      contract: "pso-warmup-telemetry@1",
      deferredCount: 1,
      entries: Object.freeze([
        Object.freeze({
          compileAttemptCount: 1,
          compileDurationMs: 1,
          compiled: true,
          id: "babylon-lite.standard-opaque-msaa4",
          requestCount: 2,
          stateDigest: "b".repeat(64),
        }),
      ]),
      failure: null,
      failureCount: 0,
      maximumCompileDurationMs: 1,
      queueHighWater: 1,
      releaseDigest: null,
      requestedCount: 2,
      schemaVersion: 1,
      source: "privileged-embedded",
      state: "ready",
      totalDurationMs: 1,
      traceEntryCount: 1,
      traceSha256: "c".repeat(64),
    }),
    workerInitToFirstFrameMs: 2,
  });
}

function failedPsoWarmupSnapshot(detail: string) {
  const ready = readyMessage().psoWarmup;
  const entry = ready.entries[0];
  if (entry === undefined) throw new Error("Ready PSO fixture has no entry");
  return Object.freeze({
    ...ready,
    cacheHitCount: 0,
    compiledCount: 0,
    entries: Object.freeze([
      Object.freeze({
        ...entry,
        compiled: false,
        requestCount: 1,
      }),
    ]),
    failure: Object.freeze({
      class: "compile" as const,
      detail,
      entryId: entry.id,
      phase: "compile" as const,
      requestIndex: 1,
      traceIndex: 0,
    }),
    failureCount: 1,
    requestedCount: 1,
    state: "failed" as const,
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

function hybridUiPresentation(): HybridUiPresentation {
  return Object.freeze({
    dialog: Object.freeze({
      body: "No conversation",
      choices: Object.freeze([]),
      speaker: "Conversation",
      textEntry: null,
      visible: false,
    }),
    heavyScreen: Object.freeze({
      cancelActionId: "inventory:close",
      focusActionId: "inventory:use",
      id: "inventory",
      primitives: Object.freeze([
        Object.freeze({
          actionId: "inventory:use",
          disabled: false,
          id: "inventory:use:primitive",
          layer: 0,
          rect: Object.freeze({ height: 0.2, width: 0.3, x: 0.2, y: 0.2 }),
          tone: "neutral" as const,
        }),
      ]),
      semanticActions: Object.freeze([
        Object.freeze({ actionId: "inventory:use", disabled: false, label: "Use" }),
      ]),
      textEntry: null,
      visible: true,
    }),
    hud: Object.freeze({ meters: Object.freeze([]), messages: Object.freeze([]), visible: true }),
    revision: 2,
    worldAnchors: Object.freeze([]),
  });
}
