import { createSabRingBufferSpike } from "../workers/sab-ring-buffer-spike";
import type { SabRingBufferSpikeTelemetrySnapshot } from "../workers/sab-ring-buffer-spike-protocol";
import type {
  RenderFrameSample,
  RenderWorkerRequest,
  RenderWorkerResponse,
  WalkingSkeletonScene,
} from "./render-protocol";

export type { RenderFrameSample, WalkingSkeletonScene } from "./render-protocol";

export interface RenderTelemetrySnapshot {
  readonly failureMessage: string | null;
  readonly frameCount: number;
  readonly recentFrames: readonly RenderFrameSample[];
  readonly sabRingBufferSpike: SabRingBufferSpikeTelemetrySnapshot;
  readonly state: "idle" | "starting" | "ready" | "failed" | "disposed";
  readonly workerInitToFirstFrameMs: number | null;
  readonly workerStartupToFirstFrameMs: number | null;
}

export type RenderServiceListener = (snapshot: RenderTelemetrySnapshot) => void;

export interface RenderService {
  dispose(): void;
  snapshot(): RenderTelemetrySnapshot;
  start(canvas: HTMLCanvasElement, scene: WalkingSkeletonScene): void;
  subscribe(listener: RenderServiceListener): () => void;
}

// D-028: the assembler replaces this token after hashing the sibling worker artifact.
const WORKER_ARTIFACT = "./__RENDER_WORKER_ARTIFACT__";
// Retention must cover the harness's 120-frame measurement window plus the frames that
// land between the window's end and the snapshot read, so the harness can select the
// exact window by frame index instead of a sliding tail. That trailing gap is
// batch-quantized (frameCount publishes once per TELEMETRY_FRAME_BATCH_FRAMES rendered
// frames): the harness's end-of-window wait can overshoot by up to one batch, and CDP
// latency before the snapshot read can add another — 240 retains the window (120) plus
// two full 60-frame batches of tail.
const MAX_RECENT_FRAMES = 240;

interface DevelopmentImportMeta extends ImportMeta {
  readonly env?: { readonly DEV?: boolean };
}

interface PixelSize {
  readonly height: number;
  readonly width: number;
}

function renderWorkerUrl(): URL {
  const development = (import.meta as DevelopmentImportMeta).env?.DEV === true;
  return development
    ? new URL("../workers/render-worker.ts", import.meta.url)
    : new URL(WORKER_ARTIFACT, import.meta.url);
}

function initialCanvasPixelSize(canvas: HTMLCanvasElement): PixelSize {
  return Object.freeze({
    height: Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio)),
    width: Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio)),
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : String(error);
}

export function createRenderService(): RenderService {
  const sabRingBufferSpike = createSabRingBufferSpike((sabSnapshot) => {
    publish({ ...telemetry, sabRingBufferSpike: sabSnapshot });
  });
  let telemetry: RenderTelemetrySnapshot = Object.freeze({
    failureMessage: null,
    frameCount: 0,
    recentFrames: Object.freeze([]),
    sabRingBufferSpike: sabRingBufferSpike.snapshot(),
    state: "idle",
    workerInitToFirstFrameMs: null,
    workerStartupToFirstFrameMs: null,
  });
  let worker: Worker | null = null;
  let resizeObserver: ResizeObserver | null = null;
  const listeners = new Set<RenderServiceListener>();

  const publish = (next: RenderTelemetrySnapshot): void => {
    telemetry = Object.freeze(next);
    for (const listener of listeners) {
      // Telemetry listeners are external consumers of this surface (D-029: the harness
      // reads it); one throwing listener must not break rendering or other listeners.
      try {
        listener(telemetry);
      } catch (error: unknown) {
        console.error("Render telemetry listener failed", error);
      }
    }
  };

  const teardown = (): void => {
    sabRingBufferSpike.dispose();
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (worker !== null) {
      worker.onmessage = null;
      worker.onmessageerror = null;
      worker.onerror = null;
      worker.terminate();
      worker = null;
    }
  };

  // Failed is terminal (no restart path) — intentional for the M0 skeleton; revisit
  // alongside M1 device-loss handling.
  const fail = (message: string): void => {
    if (telemetry.state === "failed" || telemetry.state === "disposed") return;
    teardown();
    publish({ ...telemetry, failureMessage: message, state: "failed" });
    console.error("Render worker failed", message);
  };

  const sendResize = (size: PixelSize): void => {
    worker?.postMessage({
      height: Math.max(1, Math.round(size.height)),
      kind: "resize",
      width: Math.max(1, Math.round(size.width)),
    } satisfies RenderWorkerRequest);
  };

  return Object.freeze({
    dispose(): void {
      if (telemetry.state === "disposed") return;
      teardown();
      publish({ ...telemetry, state: "disposed" });
    },

    snapshot(): RenderTelemetrySnapshot {
      return telemetry;
    },

    start(canvas: HTMLCanvasElement, scene: WalkingSkeletonScene): void {
      if (telemetry.state !== "idle") {
        throw new Error("Render service can only be started once");
      }

      publish({ ...telemetry, state: "starting" });
      try {
        if (!("transferControlToOffscreen" in canvas)) {
          throw new Error("OffscreenCanvas transfer is unavailable in this Chrome build");
        }

        const initialSize = initialCanvasPixelSize(canvas);
        const offscreenCanvas = canvas.transferControlToOffscreen();
        const workerStartupStartedAt = performance.now();
        const renderWorker = new Worker(renderWorkerUrl(), {
          name: "parallax-render",
          type: "module",
        });
        worker = renderWorker;
        renderWorker.onmessage = (event: MessageEvent<RenderWorkerResponse>): void => {
          const message = event.data;
          if (telemetry.state === "failed" || telemetry.state === "disposed") return;
          // Structured clone strips the worker-side Object.freeze from frame samples;
          // the cloned objects are owned by this service, so freeze them in place at
          // this boundary before they enter retained telemetry.
          switch (message.kind) {
            case "ready":
              publish({
                ...telemetry,
                frameCount: 1,
                recentFrames: Object.freeze([Object.freeze(message.firstFrame)]),
                state: "ready",
                workerInitToFirstFrameMs: message.workerInitToFirstFrameMs,
                workerStartupToFirstFrameMs: performance.now() - workerStartupStartedAt,
              });
              sabRingBufferSpike.start();
              break;
            case "frame":
              publish({
                ...telemetry,
                frameCount: message.frameCount,
                recentFrames: Object.freeze(
                  [
                    ...telemetry.recentFrames,
                    ...message.samples.map((sample) => Object.freeze(sample)),
                  ].slice(-MAX_RECENT_FRAMES),
                ),
              });
              break;
            case "error":
              fail(message.message);
              break;
            case "sab-ring-buffer-spike-result":
              sabRingBufferSpike.handleWorkerResult(message);
              break;
            case "sab-ring-buffer-spike-failure":
              sabRingBufferSpike.failFromWorker(message.message);
              break;
          }
        };
        renderWorker.onmessageerror = (): void => {
          fail("Render worker message failed to deserialize");
        };
        renderWorker.onerror = (event): void => {
          if (telemetry.state === "failed" || telemetry.state === "disposed") return;
          fail(
            event instanceof ErrorEvent && event.message !== ""
              ? event.message
              : "Render worker script failed to load",
          );
        };

        renderWorker.postMessage(
          {
            canvas: offscreenCanvas,
            height: initialSize.height,
            kind: "start",
            sabRingBufferSpike: sabRingBufferSpike.config,
            scene,
            width: initialSize.width,
          } satisfies RenderWorkerRequest,
          [offscreenCanvas],
        );
        resizeObserver = new ResizeObserver((entries) => {
          const devicePixelSize = entries[0]?.devicePixelContentBoxSize[0];
          if (devicePixelSize === undefined) {
            fail("ResizeObserver did not provide device-pixel canvas dimensions");
            return;
          }
          sendResize({ height: devicePixelSize.blockSize, width: devicePixelSize.inlineSize });
        });
        resizeObserver.observe(canvas, { box: "device-pixel-content-box" });
      } catch (error: unknown) {
        fail(errorMessage(error));
      }
    },

    subscribe(listener: RenderServiceListener): () => void {
      listeners.add(listener);
      // Initial delivery gets the same isolation as publish(): a throwing listener
      // must not prevent subscribe() from returning its unsubscribe function.
      try {
        listener(telemetry);
      } catch (error: unknown) {
        console.error("Render telemetry listener failed", error);
      }
      return () => listeners.delete(listener);
    },
  });
}
