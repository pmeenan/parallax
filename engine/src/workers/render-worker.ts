import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Scene } from "@babylonjs/core/scene.js";
import type {
  RenderFrameSample,
  RenderWorkerRequest,
  RenderWorkerResponse,
  WalkingSkeletonScene,
} from "../render/render-protocol";
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

const workerScope = globalThis as unknown as RenderWorkerScope;
let engine: WebGPUEngine | null = null;
let rendererReady = false;
let pendingSize: Readonly<{ height: number; width: number }> | null = null;
let sabSpikeFrameStats: {
  frameCount: number;
  frameIntervalMaxMs: number | null;
  renderDurationMaxMs: number | null;
} | null = null;

workerScope.onmessageerror = (): void => {
  postError("Render worker message failed to deserialize");
};

workerScope.onmessage = (event): void => {
  const message = event.data;
  if (message.kind === "resize") {
    if (engine !== null && rendererReady) {
      engine.setSize(message.width, message.height);
    } else {
      pendingSize = message;
    }
    return;
  }

  if (engine !== null) {
    postError("Render worker received more than one start message");
    return;
  }
  void startRenderer(
    message.canvas,
    message.width,
    message.height,
    message.scene,
    message.sabRingBufferSpike,
  );
};

async function startRenderer(
  canvas: OffscreenCanvas,
  width: number,
  height: number,
  config: WalkingSkeletonScene,
  sabRingBufferSpike: SabRingBufferSpikeConfig,
): Promise<void> {
  const initStartedAt = performance.now();
  try {
    const renderEngine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: false });
    engine = renderEngine;
    await renderEngine.initAsync();
    renderEngine.setSize(pendingSize?.width ?? width, pendingSize?.height ?? height);
    pendingSize = null;
    rendererReady = true;

    const scene = new Scene(renderEngine);
    scene.clearColor = Color4.FromArray(config.clearColor);
    const camera = new ArcRotateCamera(
      "camera",
      config.camera.alpha,
      config.camera.beta,
      config.camera.radius,
      Vector3.FromArray(config.camera.target),
      scene,
    );
    camera.minZ = config.camera.minZ;
    new HemisphericLight("key-light", Vector3.FromArray(config.lightDirection), scene);

    const box = MeshBuilder.CreateBox("walking-skeleton", { size: config.meshSize }, scene);
    const material = new StandardMaterial("walking-skeleton-material", scene);
    material.diffuseColor = Color3.FromArray(config.meshColor);
    box.material = material;

    let frameCount = 0;
    let animationStartedAt: number | null = null;
    let previousFrameTimestamp: number | null = null;
    let samples: RenderFrameSample[] = [];
    const renderFrame = (timestamp: number): void => {
      const frameStartedAt = performance.now();
      try {
        animationStartedAt ??= timestamp;
        const animationSeconds = (timestamp - animationStartedAt) / 1_000;
        box.rotation.x = animationSeconds * config.rotationRadiansPerSecond[0];
        box.rotation.y = animationSeconds * config.rotationRadiansPerSecond[1];
        renderEngine.beginFrame();
        scene.render();
        renderEngine.endFrame();
      } catch (error: unknown) {
        postError(error);
        return;
      }

      const sample: RenderFrameSample = Object.freeze({
        durationMs: performance.now() - frameStartedAt,
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
          firstFrame: sample,
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
      workerScope.requestAnimationFrame(renderFrame);
    };
    workerScope.requestAnimationFrame(renderFrame);
  } catch (error: unknown) {
    postError(error);
  }
}

async function runSabRingBufferSpike(config: SabRingBufferSpikeConfig): Promise<void> {
  const commandRing = attachSpscRingBuffer(config.commandRing);
  const responseRing = attachSpscRingBuffer(config.responseRing);
  const record = new Int32Array(commandRing.recordWords);
  let messagesProcessed = 0;
  let inboundWaits = 0;
  let outboundStalls = 0;
  let payloadErrors = 0;
  let sequenceErrors = 0;
  const startedAt = performance.now();
  const frameStats = {
    frameCount: 0,
    frameIntervalMaxMs: null as number | null,
    renderDurationMaxMs: null as number | null,
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
}

function postError(error: unknown): void {
  workerScope.postMessage({
    kind: "error",
    message: errorMessage(error),
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
