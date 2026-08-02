import {
  type FlythroughScenario,
  flythroughCameraPose,
  sampleFlythroughScenario,
  validateFlythroughScenario,
} from "../flythrough/flythrough-contract";
import { installDecoderGlobals, runDecoderFixtures } from "../render/decoder-bootstrap";
import {
  destroyLiteWebGpuDeviceForRecoveryTest,
  observeLiteWebGpuDeviceLoss,
} from "../render/lite-device-loss";
import {
  applyFlythroughSample,
  captureFlythroughCheckpoint,
  createLiteGreyboxWorld,
  evictStreamingGreyboxCell,
  type GreyboxLightingSample,
  renderLiteGreyboxWorld,
  resizeLiteGreyboxWorld,
  uploadStreamingGreyboxCell,
  visibleStreamingMeshCount,
} from "../render/lite-greybox-world";
import type { PsoWarmupTraceBundle } from "../render/pso-warmup-contract";
import {
  createPsoWarmupRegistry,
  type PsoWarmupRegistry,
  psoWarmupTelemetryFailureSnapshot,
} from "../render/pso-warmup-registry";
import type {
  GreyboxSceneConfig,
  RenderDistributionTelemetry,
  RenderFlythroughPreflightSampleMessage,
  RenderFlythroughTelemetry,
  RenderFrameSample,
  RenderWorkerRequest,
  RenderWorkerResponse,
} from "../render/render-protocol";
import { createRenderStreamingBatchTransactionManager } from "../render/render-streaming-batch";
import {
  createRenderedCheckpointFrameGate,
  createRenderedCheckpointQueue,
} from "../render/rendered-checkpoint-queue";
import { createStreamingWarmupArrivalGate } from "../render/streaming-warmup-arrival-gate";
import type {
  RenderStreamingFaultBoundaryRequest,
  RenderStreamingFlythroughObservers,
  RenderStreamingResponse,
  StreamingToRenderMessage,
} from "../streaming/streaming-protocol";
import { TELEMETRY_FRAME_BATCH_FRAMES } from "../telemetry/telemetry-export";
import {
  SAB_SPIKE_TIMEOUT_MS,
  type SabRingBufferSpikeConfig,
  type SabRingBufferSpikeWorkerResult,
  sabSpikeRecordIsValid,
} from "./sab-ring-buffer-spike-protocol";
import { attachSpscRingBuffer } from "./spsc-ring-buffer";

interface RenderWorkerScope {
  close(): void;
  onmessage: ((event: MessageEvent<RenderWorkerRequest>) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: RenderWorkerResponse): void;
  requestAnimationFrame(callback: (timestamp: number) => void): number;
}

interface SabSpikeFrameStats {
  frameCount: number;
  frameIntervalMaxMs: number | null;
  renderDurationMaxMs: number | null;
}

interface FlythroughFrameAccumulator {
  readonly callbackIntervalsMs: number[];
  readonly cameraPositionMaximum: [number, number, number];
  readonly cameraPositionMinimum: [number, number, number];
  readonly cameraTargetMaximum: [number, number, number];
  readonly cameraTargetMinimum: [number, number, number];
  readonly environmentFrameCounts: Map<string, number>;
  readonly environmentPhaseOrder: string[];
  finalSample: import("../flythrough/flythrough-contract").FlythroughScenarioSample;
  frameCount: number;
  minimumVisibleStreamingMeshCount: number;
  observerUpdateCount: number;
  previewVisibleFrameCount: number;
  readonly renderDurationsMs: number[];
  readonly scenarioId: string;
  streamedPresentationFrameCount: number;
}

function startRenderWorker(): void {
  const workerScope = globalThis as unknown as RenderWorkerScope;
  let resizeScene: ((width: number, height: number) => void) | null = null;
  let startReceived = false;
  let pendingSize: Readonly<{ height: number; width: number }> | null = null;
  let sabSpikeFrameStats: SabSpikeFrameStats | null = null;
  let applyFlythroughPreflight: ((message: RenderFlythroughPreflightSampleMessage) => void) | null =
    null;
  let resetFlythrough: ((requestId: number, nextFlythroughGeneration: number) => void) | null =
    null;
  let startFlythrough:
    | ((scenario: FlythroughScenario, flythroughGeneration: number) => void)
    | null = null;
  let captureCheckpoint:
    | ((requestId: number, checkpointId: string, flythroughGeneration: number) => Promise<void>)
    | null = null;
  let exerciseRecovery: ((probe: "device-loss" | "worker-crash") => void) | null = null;
  let exerciseRecoveryAtBoundary:
    | ((requestId: number, probe: "device-loss" | "worker-crash") => void)
    | null = null;
  let workerGeneration: number | null = null;
  let activePsoWarmup: PsoWarmupRegistry | null = null;

  const postError = (error: unknown): void => {
    const psoWarmup =
      psoWarmupTelemetryFailureSnapshot(error) ??
      (activePsoWarmup?.snapshot().state === "failed" ? activePsoWarmup.snapshot() : null);
    workerScope.postMessage({
      cause: "render-error",
      kind: "error",
      message: errorMessage(error),
      psoWarmup,
    });
  };

  const runSabRingBufferSpike = async (config: SabRingBufferSpikeConfig): Promise<void> => {
    const commandRing = attachSpscRingBuffer(config.commandRing);
    const responseRing = attachSpscRingBuffer(config.responseRing);
    const record = new Int32Array(commandRing.recordWords);
    let messagesProcessed = 0;
    let inboundWaits = 0;
    let outboundStalls = 0;
    let payloadErrors = 0;
    let sequenceErrors = 0;
    const startedAt = performance.now();
    const frameStats: SabSpikeFrameStats = {
      frameCount: 0,
      frameIntervalMaxMs: null,
      renderDurationMaxMs: null,
    };
    sabSpikeFrameStats = frameStats;

    try {
      while (messagesProcessed < config.messageCount) {
        if (!commandRing.tryRead(record)) {
          inboundWaits += 1;
          await commandRing.waitForReadable(1_000);
          if (performance.now() - startedAt > SAB_SPIKE_TIMEOUT_MS) {
            throw new Error(`SAB ring-buffer worker exceeded ${SAB_SPIKE_TIMEOUT_MS} ms`);
          }
          continue;
        }
        if (record[0] !== messagesProcessed) sequenceErrors += 1;
        if (!sabSpikeRecordIsValid(record)) payloadErrors += 1;
        while (!responseRing.tryWrite(record)) {
          outboundStalls += 1;
          await responseRing.waitForWritable(1_000);
          if (performance.now() - startedAt > SAB_SPIKE_TIMEOUT_MS) {
            throw new Error(`SAB ring-buffer worker exceeded ${SAB_SPIKE_TIMEOUT_MS} ms`);
          }
        }
        messagesProcessed += 1;
      }
    } finally {
      sabSpikeFrameStats = null;
    }

    workerScope.postMessage({
      concurrentFrameCount: frameStats.frameCount,
      concurrentFrameIntervalMaxMs: frameStats.frameIntervalMaxMs,
      concurrentRenderDurationMaxMs: frameStats.renderDurationMaxMs,
      elapsedMs: performance.now() - startedAt,
      inboundWaits,
      kind: "sab-ring-buffer-spike-result",
      messagesProcessed,
      outboundStalls,
      payloadErrors,
      sequenceErrors,
    } satisfies SabRingBufferSpikeWorkerResult);
  };

  const initialize = async (
    canvas: OffscreenCanvas,
    width: number,
    height: number,
    config: GreyboxSceneConfig,
    sabRingBufferSpike: SabRingBufferSpikeConfig,
    streamingPort: MessagePort,
    initialFlythroughGeneration: number,
    initialFlythroughTransportSequence: number,
    psoWarmupTrace: PsoWarmupTraceBundle,
  ): Promise<void> => {
    const initStartedAt = performance.now();
    try {
      const decoderBootstrap = installDecoderGlobals();
      const decoderFixtures = await runDecoderFixtures();
      const psoWarmup = createPsoWarmupRegistry(psoWarmupTrace);
      activePsoWarmup = psoWarmup;
      const streamingWarmupArrivalGate =
        createStreamingWarmupArrivalGate<StreamingToRenderMessage>();
      streamingPort.onmessage = (event: MessageEvent<StreamingToRenderMessage>): void =>
        streamingWarmupArrivalGate.receive(event.data);
      streamingPort.onmessageerror = (): void =>
        postError("Streaming render request was unreadable");
      streamingPort.start();
      const renderer = await createLiteGreyboxWorld(canvas, width, height, config, psoWarmup);
      observeLiteWebGpuDeviceLoss(renderer.engine, (loss) => {
        workerScope.postMessage({
          kind: "device-lost",
          message: loss.message,
          reason: loss.reason,
        });
      });
      exerciseRecovery = (probe): void => {
        if (probe === "device-loss") {
          destroyLiteWebGpuDeviceForRecoveryTest(renderer.engine);
          return;
        }
        workerScope.close();
      };
      let flythroughAccumulator: FlythroughFrameAccumulator | null = null;
      let flythroughScenario: FlythroughScenario | null = null;
      let flythroughStartedAt: number | null = null;
      let flythroughLastObserverSentAt: number | null = null;
      let flythroughLastEnvironmentId: string | null = null;
      let flythroughCompleted = false;
      let flythroughObserverQuiesced = false;
      let activeFlythroughGeneration = initialFlythroughGeneration;
      let flythroughTransportSequence = initialFlythroughTransportSequence;
      let lastCompletedRunSequence: number | null = null;
      let pendingPreflightRendered: Readonly<{
        elapsedMs: number;
        environmentPhaseId: string;
        flythroughGeneration: number;
        requestId: number;
        scenarioId: string;
      }> | null = null;
      let nextFaultBoundaryRequestId = 1;
      const faultBoundaryRequests = new Map<
        number,
        Readonly<{ probe: "device-loss" | "worker-crash"; requestId: number }>
      >();
      const flythroughResetRequests = new Map<
        number,
        Readonly<{ nextFlythroughGeneration: number; requestId: number }>
      >();
      applyFlythroughPreflight = (message): void => {
        if (flythroughScenario !== null) {
          throw new Error("Flythrough preflight cannot run after measurement starts");
        }
        if (
          message.flythroughGeneration !== activeFlythroughGeneration ||
          pendingPreflightRendered !== null
        ) {
          throw new Error("Flythrough preflight render request is invalid");
        }
        applyFlythroughSample(renderer, message.sample, message.camera);
        pendingPreflightRendered = Object.freeze({
          elapsedMs: message.sample.elapsedMs,
          environmentPhaseId: message.sample.environment.id,
          flythroughGeneration: message.flythroughGeneration,
          requestId: message.requestId,
          scenarioId: message.scenarioId,
        });
      };
      startFlythrough = (scenario, requestedFlythroughGeneration): void => {
        if (flythroughScenario !== null) {
          throw new Error("Render worker flythrough can only be started once");
        }
        if (requestedFlythroughGeneration !== activeFlythroughGeneration) {
          throw new Error("Render worker flythrough generation is invalid");
        }
        validateFlythroughScenario(scenario, config.world.bounds);
        const initial = sampleFlythroughScenario(scenario, 0);
        const pose = flythroughCameraPose(initial, scenario.camera);
        flythroughScenario = scenario;
        flythroughAccumulator = {
          callbackIntervalsMs: [],
          cameraPositionMaximum: [...pose.position],
          cameraPositionMinimum: [...pose.position],
          cameraTargetMaximum: [...pose.target],
          cameraTargetMinimum: [...pose.target],
          environmentFrameCounts: new Map(),
          environmentPhaseOrder: [],
          finalSample: initial,
          frameCount: 0,
          minimumVisibleStreamingMeshCount: Number.POSITIVE_INFINITY,
          observerUpdateCount: 0,
          previewVisibleFrameCount: 0,
          renderDurationsMs: [],
          scenarioId: scenario.id,
          streamedPresentationFrameCount: 0,
        };
      };
      const clearFlythrough = (): void => {
        lastCompletedRunSequence =
          flythroughAccumulator?.observerUpdateCount ?? lastCompletedRunSequence;
        flythroughAccumulator = null;
        flythroughScenario = null;
        flythroughStartedAt = null;
        flythroughLastObserverSentAt = null;
        flythroughLastEnvironmentId = null;
        flythroughCompleted = false;
        flythroughObserverQuiesced = false;
        pendingPreflightRendered = null;
      };
      const checkpointQueue = createRenderedCheckpointQueue(
        (checkpointId) => captureFlythroughCheckpoint(renderer, checkpointId),
        (requestId, evidence) =>
          workerScope.postMessage({
            evidence,
            flythroughGeneration: activeFlythroughGeneration,
            kind: "flythrough-checkpoint",
            requestId,
          }),
      );
      let checkpointFrameGate: ReturnType<typeof createRenderedCheckpointFrameGate>;
      captureCheckpoint = (
        requestId,
        checkpointId,
        requestedFlythroughGeneration,
      ): Promise<void> => {
        if (
          requestedFlythroughGeneration !== activeFlythroughGeneration ||
          flythroughResetRequests.size > 0
        ) {
          return Promise.reject(new Error("Render worker checkpoint generation is invalid"));
        }
        return checkpointQueue.request(requestId, checkpointId);
      };
      resetFlythrough = (requestId, nextFlythroughGeneration): void => {
        if (
          !Number.isSafeInteger(requestId) ||
          requestId <= 0 ||
          !Number.isSafeInteger(nextFlythroughGeneration) ||
          nextFlythroughGeneration !== activeFlythroughGeneration + 1 ||
          flythroughResetRequests.size > 0
        ) {
          throw new Error("Render worker flythrough reset request is invalid");
        }
        const completedRunSequence =
          flythroughAccumulator?.observerUpdateCount ?? lastCompletedRunSequence;
        clearFlythrough();
        const streamingRequestId = nextFaultBoundaryRequestId;
        nextFaultBoundaryRequestId += 1;
        flythroughResetRequests.set(
          streamingRequestId,
          Object.freeze({ nextFlythroughGeneration, requestId }),
        );
        void checkpointFrameGate.cancelAndWaitForRenderLoop().then(() => {
          streamingPort.postMessage({
            completedFlythroughGeneration: activeFlythroughGeneration,
            completedRunSequence,
            flythroughObserverUpdateCount:
              completedRunSequence === null ? null : flythroughTransportSequence,
            kind: "reset-flythrough-boundary",
            nextFlythroughGeneration,
            requestId: streamingRequestId,
          });
        }, postError);
      };
      let activeBatchArrivedDuringPsoWarmup = false;
      const streamingBatches = createRenderStreamingBatchTransactionManager({
        evict: (cellId) => evictStreamingGreyboxCell(renderer, cellId),
        onRollbackFailure: postError,
        upload: ({ cell, dependencies }) =>
          Object.freeze({
            ...uploadStreamingGreyboxCell(renderer, cell, dependencies),
            psoWarmupGameplayOverlap: activeBatchArrivedDuringPsoWarmup,
          }),
      });
      exerciseRecoveryAtBoundary = (requestId, probe): void => {
        if (flythroughScenario === null || flythroughAccumulator === null) {
          throw new Error("Recovery fault boundary requires an active flythrough");
        }
        if (flythroughObserverQuiesced || faultBoundaryRequests.size > 0) {
          throw new Error("Recovery fault boundary is already quiescing");
        }
        flythroughObserverQuiesced = true;
        const streamingRequestId = nextFaultBoundaryRequestId;
        nextFaultBoundaryRequestId += 1;
        faultBoundaryRequests.set(streamingRequestId, Object.freeze({ probe, requestId }));
        streamingPort.postMessage({
          flythroughObserverUpdateCount: flythroughTransportSequence,
          kind: "quiesce-fault-boundary",
          requestId: streamingRequestId,
        } satisfies RenderStreamingFaultBoundaryRequest);
      };
      streamingWarmupArrivalGate.activate((request: StreamingToRenderMessage): void => {
        try {
          if (request.kind === "fault-boundary-settled") {
            const pending = faultBoundaryRequests.get(request.requestId);
            if (pending === undefined) {
              throw new Error(`Streaming returned unknown fault boundary ${request.requestId}`);
            }
            faultBoundaryRequests.delete(request.requestId);
            workerScope.postMessage({
              checkpoint: request.checkpoint,
              kind: "recovery-boundary",
              requestId: pending.requestId,
            });
            setTimeout(() => exerciseRecovery?.(pending.probe), 0);
            return;
          }
          if (request.kind === "flythrough-reset-settled") {
            const pending = flythroughResetRequests.get(request.requestId);
            if (
              pending === undefined ||
              request.nextFlythroughGeneration !== pending.nextFlythroughGeneration ||
              request.flythroughObserverUpdateCount < flythroughTransportSequence
            ) {
              throw new Error(`Streaming returned invalid flythrough reset ${request.requestId}`);
            }
            flythroughResetRequests.delete(request.requestId);
            activeFlythroughGeneration = request.nextFlythroughGeneration;
            flythroughTransportSequence = request.flythroughObserverUpdateCount;
            lastCompletedRunSequence = null;
            workerScope.postMessage({
              flythroughGeneration: activeFlythroughGeneration,
              kind: "flythrough-reset-complete",
              requestId: pending.requestId,
            });
            return;
          }
          if (request.kind === "render-batch-transaction") {
            activeBatchArrivedDuringPsoWarmup =
              streamingWarmupArrivalGate.arrivedDuringWarmup(request);
            try {
              streamingBatches.transact(request, (response) => streamingPort.postMessage(response));
            } finally {
              activeBatchArrivedDuringPsoWarmup = false;
            }
          } else {
            const evicted = evictStreamingGreyboxCell(renderer, request.cellId);
            streamingPort.postMessage({
              cellId: request.cellId,
              dependencyGpuCache: evicted.dependencyGpuCache,
              freedCellGpuBytes: evicted.freedCellGpuBytes,
              freedGpuBytes: evicted.freedGpuBytes,
              kind: "evict-cell-complete",
              requestId: request.requestId,
            } satisfies RenderStreamingResponse);
          }
        } catch (error: unknown) {
          const failedRequest =
            typeof request === "object" && request !== null
              ? (request as Readonly<{
                  readonly batchTransactionId?: unknown;
                  readonly requestId?: unknown;
                }>)
              : null;
          streamingPort.postMessage({
            batchTransactionId:
              typeof failedRequest?.batchTransactionId === "string"
                ? failedRequest.batchTransactionId
                : null,
            kind: "streaming-render-failure",
            message: errorMessage(error),
            requestId:
              Number.isSafeInteger(failedRequest?.requestId) &&
              (failedRequest?.requestId as number) > 0
                ? (failedRequest?.requestId as number)
                : 0,
          } satisfies RenderStreamingResponse);
        }
      });

      resizeScene = (nextWidth, nextHeight): void => {
        resizeLiteGreyboxWorld(renderer, nextWidth, nextHeight);
      };
      if (pendingSize !== null) {
        resizeScene(pendingSize.width, pendingSize.height);
        pendingSize = null;
      }

      let frameCount = 0;
      let previousFrameTimestamp: number | null = null;
      let samples: RenderFrameSample[] = [];
      const renderWorkerFrame = (timestamp: number): void => {
        const frameStartedAt = performance.now();
        let lighting: GreyboxLightingSample;
        try {
          if (flythroughScenario !== null && !flythroughCompleted) {
            flythroughStartedAt ??= timestamp;
            const elapsedMs = Math.min(
              flythroughScenario.durationMs,
              timestamp - flythroughStartedAt,
            );
            const flythroughSample = sampleFlythroughScenario(flythroughScenario, elapsedMs);
            applyFlythroughSample(renderer, flythroughSample, flythroughScenario.camera);
            if (
              flythroughLastObserverSentAt === null ||
              timestamp - flythroughLastObserverSentAt >= 50 ||
              flythroughLastEnvironmentId !== flythroughSample.environment.id ||
              elapsedMs === flythroughScenario.durationMs
            ) {
              const activeAccumulator = flythroughAccumulator;
              if (activeAccumulator === null) {
                throw new Error("Flythrough observer update lost its aggregate");
              }
              if (!flythroughObserverQuiesced) {
                activeAccumulator.observerUpdateCount += 1;
                flythroughTransportSequence += 1;
                streamingPort.postMessage({
                  flythroughGeneration: activeFlythroughGeneration,
                  kind: "flythrough-observers",
                  observers: Object.freeze([flythroughSample.observer]),
                  sequence: activeAccumulator.observerUpdateCount,
                  transportSequence: flythroughTransportSequence,
                } satisfies RenderStreamingFlythroughObservers);
              }
              flythroughLastObserverSentAt = timestamp;
              flythroughLastEnvironmentId = flythroughSample.environment.id;
            }
            flythroughCompleted = elapsedMs === flythroughScenario.durationMs;
          }
          lighting = renderLiteGreyboxWorld(renderer, timestamp);
        } catch (error: unknown) {
          postError(error);
          return;
        }

        const sample: RenderFrameSample = Object.freeze({
          durationMs: performance.now() - frameStartedAt,
          lightingIntensity: lighting.intensity,
          lightingPhase: lighting.phase,
          presentIntervalMs:
            previousFrameTimestamp === null ? null : timestamp - previousFrameTimestamp,
        });
        const activeFlythrough = flythroughAccumulator;
        if (activeFlythrough !== null) {
          const flythroughSample = renderer.flythroughSample;
          if (flythroughSample === null) {
            throw new Error("Flythrough aggregation lost its active render sample");
          }
          activeFlythrough.renderDurationsMs.push(sample.durationMs);
          if (activeFlythrough.frameCount > 0 && sample.presentIntervalMs !== null) {
            activeFlythrough.callbackIntervalsMs.push(sample.presentIntervalMs);
          }
          activeFlythrough.frameCount += 1;
          activeFlythrough.environmentFrameCounts.set(
            flythroughSample.environment.id,
            (activeFlythrough.environmentFrameCounts.get(flythroughSample.environment.id) ?? 0) + 1,
          );
          if (activeFlythrough.environmentPhaseOrder.at(-1) !== flythroughSample.environment.id) {
            activeFlythrough.environmentPhaseOrder.push(flythroughSample.environment.id);
          }
          activeFlythrough.finalSample = flythroughSample;
          const cameraTarget = renderer.camera.target;
          updateRange(activeFlythrough.cameraTargetMinimum, activeFlythrough.cameraTargetMaximum, [
            cameraTarget.x,
            cameraTarget.y,
            cameraTarget.z,
          ]);
          const activeScenario = flythroughScenario;
          if (activeScenario === null) {
            throw new Error("Flythrough aggregation lost its active scenario");
          }
          const pose = flythroughCameraPose(flythroughSample, activeScenario.camera);
          updateRange(
            activeFlythrough.cameraPositionMinimum,
            activeFlythrough.cameraPositionMaximum,
            pose.position,
          );
          const visibleStreamingMeshes = visibleStreamingMeshCount(renderer);
          activeFlythrough.minimumVisibleStreamingMeshCount = Math.min(
            activeFlythrough.minimumVisibleStreamingMeshCount,
            visibleStreamingMeshes,
          );
          if (renderer.presentationOwner === "streamed-residency") {
            activeFlythrough.streamedPresentationFrameCount += 1;
          }
          if (renderer.previewMeshes.some((mesh) => mesh.visible)) {
            activeFlythrough.previewVisibleFrameCount += 1;
          }
        }
        if (sabSpikeFrameStats !== null) {
          sabSpikeFrameStats.frameCount += 1;
          sabSpikeFrameStats.renderDurationMaxMs = Math.max(
            sabSpikeFrameStats.renderDurationMaxMs ?? 0,
            sample.durationMs,
          );
          if (sample.presentIntervalMs !== null) {
            sabSpikeFrameStats.frameIntervalMaxMs = Math.max(
              sabSpikeFrameStats.frameIntervalMaxMs ?? 0,
              sample.presentIntervalMs,
            );
          }
        }
        previousFrameTimestamp = timestamp;
        frameCount += 1;
        const renderedPreflight = pendingPreflightRendered;
        if (renderedPreflight !== null) {
          pendingPreflightRendered = null;
          workerScope.postMessage({
            ...renderedPreflight,
            height: canvas.height,
            kind: "flythrough-preflight-rendered",
            width: canvas.width,
          });
        }
        if (frameCount === 1) {
          workerScope.postMessage({
            decoderBootstrap,
            decoderFixtures,
            firstFrame: sample,
            greyboxWorld: renderer.telemetry,
            kind: "ready",
            psoWarmup: psoWarmup.snapshot(),
            workerInitToFirstFrameMs: performance.now() - initStartedAt,
          });
          void runSabRingBufferSpike(sabRingBufferSpike).catch((error: unknown) => {
            workerScope.postMessage({
              kind: "sab-ring-buffer-spike-failure",
              message: errorMessage(error),
            });
          });
        } else {
          samples.push(sample);
        }
        if (samples.length === TELEMETRY_FRAME_BATCH_FRAMES) {
          workerScope.postMessage({
            frameCount,
            kind: "frame",
            samples,
          });
          samples = [];
        }
        if (flythroughCompleted && flythroughAccumulator !== null) {
          if (flythroughScenario === null) {
            throw new Error("Render worker flythrough completion lost its scenario");
          }
          const completed = freezeFlythroughTelemetry(flythroughAccumulator, flythroughScenario);
          lastCompletedRunSequence = flythroughAccumulator.observerUpdateCount;
          flythroughAccumulator = null;
          workerScope.postMessage({
            flythroughGeneration: activeFlythroughGeneration,
            kind: "flythrough-complete",
            telemetry: completed,
          });
        }
        // A preflight sample and its already-registered Babylon capture can arrive
        // between the same two animation frames. This render services the capture.
        // Claim exactly those requests, return before awaiting their evidence, and hold
        // the framebuffer stable by withholding the next frame until they settle.
        checkpointFrameGate.afterRenderedFrame();
      };
      checkpointFrameGate = createRenderedCheckpointFrameGate(
        checkpointQueue,
        () => workerScope.requestAnimationFrame(renderWorkerFrame),
        postError,
      );
      workerScope.requestAnimationFrame(renderWorkerFrame);
    } catch (error: unknown) {
      postError(error);
    }
  };

  workerScope.onmessageerror = (): void => {
    postError("Render worker message failed to deserialize");
  };

  workerScope.onmessage = (event): void => {
    const message = event.data;
    if (message.kind === "resize") {
      if (resizeScene === null) {
        pendingSize = message;
      } else {
        resizeScene(message.width, message.height);
      }
      return;
    }
    if (message.kind === "flythrough-preflight-sample") {
      if (applyFlythroughPreflight === null) {
        postError("Render worker received a flythrough preflight sample before initialization");
        return;
      }
      try {
        applyFlythroughPreflight(message);
      } catch (error: unknown) {
        postError(error);
      }
      return;
    }
    if (message.kind === "start-flythrough") {
      if (startFlythrough === null) {
        postError("Render worker received flythrough start before initialization");
        return;
      }
      try {
        startFlythrough(message.scenario, message.flythroughGeneration);
      } catch (error: unknown) {
        postError(error);
      }
      return;
    }
    if (message.kind === "reset-flythrough") {
      if (resetFlythrough === null) {
        postError("Render worker received flythrough reset before initialization");
        return;
      }
      try {
        resetFlythrough(message.requestId, message.nextFlythroughGeneration);
      } catch (error: unknown) {
        postError(error);
      }
      return;
    }
    if (message.kind === "capture-flythrough-checkpoint") {
      if (captureCheckpoint === null) {
        postError("Render worker received a checkpoint request before initialization");
        return;
      }
      void captureCheckpoint(
        message.requestId,
        message.checkpointId,
        message.flythroughGeneration,
      ).catch(postError);
      return;
    }
    if (message.kind === "exercise-recovery") {
      if (exerciseRecovery === null) {
        postError("Render worker received a recovery probe before initialization");
        return;
      }
      exerciseRecovery(message.probe);
      return;
    }
    if (message.kind === "exercise-recovery-at-boundary") {
      if (exerciseRecoveryAtBoundary === null) {
        postError("Render worker received a recovery boundary probe before initialization");
        return;
      }
      try {
        exerciseRecoveryAtBoundary(message.requestId, message.probe);
      } catch (error: unknown) {
        postError(error);
      }
      return;
    }

    if (startReceived) {
      postError("Render worker received more than one start message");
      return;
    }
    startReceived = true;
    workerGeneration = message.workerGeneration;
    setInterval(() => {
      if (workerGeneration === null) return;
      workerScope.postMessage({
        kind: "heartbeat",
        workerGeneration,
      });
    }, 500);
    workerScope.postMessage({
      kind: "heartbeat",
      workerGeneration,
    });
    void initialize(
      message.canvas,
      message.width,
      message.height,
      message.scene,
      message.sabRingBufferSpike,
      message.streamingPort,
      message.flythroughGeneration,
      message.flythroughTransportSequence,
      message.psoWarmupTrace,
    );
  };
}

function freezeFlythroughTelemetry(
  accumulator: FlythroughFrameAccumulator,
  scenario: FlythroughScenario,
): RenderFlythroughTelemetry {
  if (
    accumulator.frameCount <= 0 ||
    accumulator.callbackIntervalsMs.length <= 0 ||
    accumulator.renderDurationsMs.length !== accumulator.frameCount ||
    !Number.isFinite(accumulator.minimumVisibleStreamingMeshCount)
  ) {
    throw new Error("Render worker flythrough aggregate is incomplete");
  }
  return Object.freeze({
    callbackIntervalMs: distribution(accumulator.callbackIntervalsMs),
    cameraPositionMaximum: Object.freeze([...accumulator.cameraPositionMaximum]) as readonly [
      number,
      number,
      number,
    ],
    cameraPositionMinimum: Object.freeze([...accumulator.cameraPositionMinimum]) as readonly [
      number,
      number,
      number,
    ],
    cameraTargetMaximum: Object.freeze([...accumulator.cameraTargetMaximum]) as readonly [
      number,
      number,
      number,
    ],
    cameraTargetMinimum: Object.freeze([...accumulator.cameraTargetMinimum]) as readonly [
      number,
      number,
      number,
    ],
    completedDistanceMeters: accumulator.finalSample.distanceMeters,
    completedElapsedMs: accumulator.finalSample.elapsedMs,
    environmentFrameCounts: Object.freeze(Object.fromEntries(accumulator.environmentFrameCounts)),
    environmentPhaseOrder: Object.freeze([...accumulator.environmentPhaseOrder]),
    finalObserver: accumulator.finalSample.observer,
    frameCount: accumulator.frameCount,
    minimumVisibleStreamingMeshCount: accumulator.minimumVisibleStreamingMeshCount,
    observerUpdateCount: accumulator.observerUpdateCount,
    previewVisibleFrameCount: accumulator.previewVisibleFrameCount,
    renderDurationMs: distribution(accumulator.renderDurationsMs),
    scenario: freezeFlythroughScenario(scenario),
    scenarioId: accumulator.scenarioId,
    state: "completed",
    streamedPresentationFrameCount: accumulator.streamedPresentationFrameCount,
  });
}

function freezeFlythroughScenario(scenario: FlythroughScenario): FlythroughScenario {
  return Object.freeze({
    ...scenario,
    camera: Object.freeze({ ...scenario.camera }),
    environmentPhases: Object.freeze(
      scenario.environmentPhases.map((phase) => Object.freeze({ ...phase })),
    ),
    path: Object.freeze(
      scenario.path.map((point) => Object.freeze([...point]) as readonly [number, number, number]),
    ),
  });
}

function distribution(values: readonly number[]): RenderDistributionTelemetry {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Render worker flythrough distribution is empty or invalid");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (fraction: number): number => {
    const value = sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
    if (value === undefined) throw new Error("Render worker percentile sample is missing");
    return value;
  };
  const maximum = sorted.at(-1);
  if (maximum === undefined) throw new Error("Render worker distribution maximum is missing");
  return Object.freeze({
    maximum,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p999: percentile(0.999),
    sampleCount: sorted.length,
  });
}

function updateRange(
  minimum: [number, number, number],
  maximum: [number, number, number],
  value: readonly [number, number, number],
): void {
  minimum[0] = Math.min(minimum[0], value[0]);
  minimum[1] = Math.min(minimum[1], value[1]);
  minimum[2] = Math.min(minimum[2], value[2]);
  maximum[0] = Math.max(maximum[0], value[0]);
  maximum[1] = Math.max(maximum[1], value[1]);
  maximum[2] = Math.max(maximum[2], value[2]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

startRenderWorker();
