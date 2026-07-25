import { installDecoderGlobals, runDecoderFixtures } from "../render/decoder-bootstrap";
import {
  createLiteGreyboxWorld,
  evictStreamingGreyboxCell,
  type GreyboxLightingSample,
  renderLiteGreyboxWorld,
  resizeLiteGreyboxWorld,
  uploadStreamingGreyboxCell,
} from "../render/lite-greybox-world";
import type {
  GreyboxSceneConfig,
  RenderFrameSample,
  RenderWorkerRequest,
  RenderWorkerResponse,
} from "../render/render-protocol";
import type {
  RenderStreamingRequest,
  RenderStreamingResponse,
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

function startRenderWorker(): void {
  const workerScope = globalThis as unknown as RenderWorkerScope;
  let resizeScene: ((width: number, height: number) => void) | null = null;
  let startReceived = false;
  let pendingSize: Readonly<{ height: number; width: number }> | null = null;
  let sabSpikeFrameStats: SabSpikeFrameStats | null = null;

  const postError = (error: unknown): void => {
    workerScope.postMessage({
      kind: "error",
      message: errorMessage(error),
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
  ): Promise<void> => {
    const initStartedAt = performance.now();
    try {
      const decoderBootstrap = installDecoderGlobals();
      const decoderFixtures = await runDecoderFixtures();
      const renderer = await createLiteGreyboxWorld(canvas, width, height, config);
      const pendingStreamingUploads = new Map<
        number,
        Readonly<{ cellId: string; timeout: ReturnType<typeof setTimeout> }>
      >();
      streamingPort.onmessage = (event: MessageEvent<RenderStreamingRequest>): void => {
        const request = event.data;
        try {
          if (request.kind === "stream-cell") {
            const startedAt = performance.now();
            const uploaded = uploadStreamingGreyboxCell(renderer, request.cell);
            const timeout = setTimeout(() => {
              const pending = pendingStreamingUploads.get(request.requestId);
              if (pending?.cellId !== request.cellId) return;
              pendingStreamingUploads.delete(request.requestId);
              try {
                evictStreamingGreyboxCell(renderer, request.cellId);
              } catch (error: unknown) {
                postError(error);
              }
            }, 5_000);
            pendingStreamingUploads.set(
              request.requestId,
              Object.freeze({ cellId: request.cellId, timeout }),
            );
            streamingPort.postMessage({
              cellId: request.cellId,
              gpuBytes: uploaded.gpuBytes,
              kind: "stream-cell-complete",
              requestId: request.requestId,
              uploadMs: performance.now() - startedAt,
            } satisfies RenderStreamingResponse);
          } else if (request.kind === "commit-cell") {
            const pending = pendingStreamingUploads.get(request.uploadRequestId);
            if (pending?.cellId !== request.cellId) {
              throw new Error(
                `Streaming commit ${request.requestId} arrived after upload ${request.uploadRequestId} was rolled back`,
              );
            }
            clearTimeout(pending.timeout);
            pendingStreamingUploads.delete(request.uploadRequestId);
            streamingPort.postMessage({
              cellId: request.cellId,
              kind: "commit-cell-complete",
              requestId: request.requestId,
            } satisfies RenderStreamingResponse);
          } else {
            for (const [pendingId, pending] of pendingStreamingUploads) {
              if (pending.cellId !== request.cellId) continue;
              clearTimeout(pending.timeout);
              pendingStreamingUploads.delete(pendingId);
            }
            streamingPort.postMessage({
              cellId: request.cellId,
              freedGpuBytes: evictStreamingGreyboxCell(renderer, request.cellId),
              kind: "evict-cell-complete",
              requestId: request.requestId,
            } satisfies RenderStreamingResponse);
          }
        } catch (error: unknown) {
          streamingPort.postMessage({
            kind: "streaming-render-failure",
            message: errorMessage(error),
            requestId: request.requestId,
          } satisfies RenderStreamingResponse);
        }
      };
      streamingPort.onmessageerror = (): void =>
        postError("Streaming render request was unreadable");
      streamingPort.start();

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
        if (frameCount === 1) {
          workerScope.postMessage({
            decoderBootstrap,
            decoderFixtures,
            firstFrame: sample,
            greyboxWorld: renderer.telemetry,
            kind: "ready",
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
        workerScope.requestAnimationFrame(renderWorkerFrame);
      };
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

    if (startReceived) {
      postError("Render worker received more than one start message");
      return;
    }
    startReceived = true;
    void initialize(
      message.canvas,
      message.width,
      message.height,
      message.scene,
      message.sabRingBufferSpike,
      message.streamingPort,
    );
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

startRenderWorker();
