import type {
  FlythroughScenario,
  FlythroughScenarioSample,
} from "../flythrough/flythrough-contract";
import type { StreamingRecoveryCheckpoint } from "../streaming/streaming-protocol";
import { STREAMING_RESIDENT_CELL_LIMIT } from "../streaming/streaming-protocol";
import { createSabRingBufferSpike } from "../workers/sab-ring-buffer-spike";
import type { SabRingBufferSpikeTelemetrySnapshot } from "../workers/sab-ring-buffer-spike-protocol";
import type { DecoderBootstrapTelemetry, DecoderFixtureTelemetry } from "./decoder-bootstrap";
import {
  idlePsoWarmupTelemetrySnapshot,
  type PsoWarmupTelemetrySnapshot,
  type PsoWarmupTraceBundle,
} from "./pso-warmup-contract";
import type {
  FlythroughCheckpointRenderEvidence,
  GreyboxRenderTelemetry,
  GreyboxSceneConfig,
  RenderFlythroughTelemetry,
  RenderFrameSample,
  RenderRecoveryProbeKind,
  RenderWorkerRequest,
  RenderWorkerResponse,
} from "./render-protocol";

export type {
  FlythroughCheckpointRenderEvidence,
  GreyboxRenderTelemetry,
  GreyboxSceneConfig,
  RenderFlythroughTelemetry,
  RenderFrameSample,
  RenderRecoveryProbeKind,
} from "./render-protocol";

export type RenderRecoveryCause =
  | "device-loss"
  | "render-error"
  | "startup"
  | "worker-crash"
  | "worker-error"
  | "worker-message";

export interface RenderRecoveryTelemetry {
  readonly lastCause: RenderRecoveryCause | null;
  readonly lastFailureMessage: string | null;
  readonly lastRestartDurationMs: number | null;
  readonly maximumAutomaticRestarts: 1;
  readonly restartCount: number;
  readonly state: "not-needed" | "restarting" | "recovered" | "exhausted";
  readonly workerGeneration: number;
}

export interface RetainedPsoWarmupFailureTelemetry {
  readonly snapshot: PsoWarmupTelemetrySnapshot;
  readonly workerGeneration: number;
}

export interface RenderTelemetrySnapshot {
  readonly decoderBootstrap: DecoderBootstrapTelemetry | null;
  readonly decoderFixtures: DecoderFixtureTelemetry | null;
  readonly failureMessage: string | null;
  readonly frameCount: number;
  readonly flythrough: RenderFlythroughTelemetry | null;
  readonly greyboxWorld: GreyboxRenderTelemetry | null;
  readonly recentFrames: readonly RenderFrameSample[];
  readonly psoWarmup: PsoWarmupTelemetrySnapshot;
  readonly retainedPsoWarmupFailure: RetainedPsoWarmupFailureTelemetry | null;
  readonly renderPixelSize: RenderPixelSize | null;
  readonly renderPixelSizeOverride: RenderPixelSize | null;
  readonly recovery: RenderRecoveryTelemetry;
  readonly sabRingBufferSpike: SabRingBufferSpikeTelemetrySnapshot;
  readonly state: "idle" | "starting" | "recovering" | "ready" | "failed" | "disposed";
  readonly workerInitToFirstFrameMs: number | null;
  readonly workerStartupToFirstFrameMs: number | null;
}

export type RenderServiceListener = (snapshot: RenderTelemetrySnapshot) => void;
export type RenderCanvasListener = (canvas: HTMLCanvasElement) => void;

export interface RenderService {
  applyFlythroughPreflight(
    scenarioId: string,
    sample: FlythroughScenarioSample,
    camera: FlythroughScenario["camera"],
  ): Promise<void>;
  captureFlythroughCheckpoint(checkpointId: string): Promise<FlythroughCheckpointRenderEvidence>;
  dispose(): void;
  exerciseRecovery(probe: RenderRecoveryProbeKind): void;
  exerciseRecoveryAtBoundary(probe: RenderRecoveryProbeKind): Promise<StreamingRecoveryCheckpoint>;
  failAfterStreamingFailure(message: string): void;
  resetFlythrough(): Promise<void>;
  setGameplayPresentation(presentation: RenderGameplayPresentation): void;
  setRenderPixelSizeOverride(size: RenderPixelSize | null): void;
  snapshot(): RenderTelemetrySnapshot;
  start(
    canvas: HTMLCanvasElement,
    scene: GreyboxSceneConfig,
    startup: RenderStartupTelemetry,
  ): void;
  startFlythrough(scenario: FlythroughScenario): void;
  subscribe(listener: RenderServiceListener): () => void;
  subscribeCanvas(listener: RenderCanvasListener): () => void;
}

export interface RenderGameplayPresentation {
  readonly cameraPitchRadians: number;
  readonly playerPosition: readonly [number, number, number];
  readonly playerYawRadians: number;
  readonly sequence: number;
}

export interface RenderStartupTelemetry {
  readonly failStreamingCohort: (message: string) => void;
  readonly mainThreadWorldGenerationMs: number;
  readonly psoWarmupTrace: PsoWarmupTraceBundle;
  readonly restartStreamingCohort: (
    checkpoint?: StreamingRecoveryCheckpoint,
  ) => RenderStreamingRecoveryAttempt;
  readonly streamingPort: MessagePort;
}

export interface RenderStreamingRecoveryAttempt {
  readonly checkpoint: StreamingRecoveryCheckpoint;
  readonly settled: Promise<StreamingRecoveryCheckpoint>;
  readonly streamingPort: MessagePort;
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
const MAX_AUTOMATIC_RESTARTS = 1;
const WORKER_HEARTBEAT_TIMEOUT_MS = 3_000;
export const FLYTHROUGH_RESET_TIMEOUT_MS = 15_000;

interface DevelopmentImportMeta extends ImportMeta {
  readonly env?: { readonly DEV?: boolean };
}

export interface RenderPixelSize {
  readonly height: number;
  readonly width: number;
}

function renderWorkerUrl(): URL {
  const development = (import.meta as DevelopmentImportMeta).env?.DEV === true;
  return development
    ? new URL("../workers/render-worker.ts", import.meta.url)
    : new URL(WORKER_ARTIFACT, import.meta.url);
}

function initialCanvasPixelSize(canvas: HTMLCanvasElement): RenderPixelSize {
  return Object.freeze({
    height: Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio)),
    width: Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio)),
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : String(error);
}

function freezeGreyboxTelemetry(value: GreyboxRenderTelemetry): GreyboxRenderTelemetry {
  return Object.freeze({
    ...value,
    clearColor: Object.freeze([...value.clearColor]) as readonly [number, number, number, number],
    selectedLodCellCounts: Object.freeze([...value.selectedLodCellCounts]) as readonly [
      number,
      number,
      number,
    ],
    worldBoundsMeters: Object.freeze({
      maximum: Object.freeze([...value.worldBoundsMeters.maximum]) as readonly [
        number,
        number,
        number,
      ],
      minimum: Object.freeze([...value.worldBoundsMeters.minimum]) as readonly [
        number,
        number,
        number,
      ],
    }),
  });
}

function freezePsoWarmupTelemetry(value: PsoWarmupTelemetrySnapshot): PsoWarmupTelemetrySnapshot {
  return Object.freeze({
    ...value,
    entries: Object.freeze(
      value.entries.map((entry) =>
        Object.freeze({
          ...entry,
        }),
      ),
    ),
    failure: value.failure === null ? null : Object.freeze({ ...value.failure }),
  });
}

export function createRenderService(): RenderService {
  let publishSabSnapshot = (_snapshot: SabRingBufferSpikeTelemetrySnapshot): void => undefined;
  let sabRingBufferSpike = createSabRingBufferSpike((snapshot) => publishSabSnapshot(snapshot));
  let telemetry: RenderTelemetrySnapshot = Object.freeze({
    decoderBootstrap: null,
    decoderFixtures: null,
    failureMessage: null,
    frameCount: 0,
    flythrough: null,
    greyboxWorld: null,
    recentFrames: Object.freeze([]),
    psoWarmup: idlePsoWarmupTelemetrySnapshot(),
    retainedPsoWarmupFailure: null,
    renderPixelSize: null,
    renderPixelSizeOverride: null,
    recovery: Object.freeze({
      lastCause: null,
      lastFailureMessage: null,
      lastRestartDurationMs: null,
      maximumAutomaticRestarts: MAX_AUTOMATIC_RESTARTS,
      restartCount: 0,
      state: "not-needed",
      workerGeneration: 0,
    }),
    sabRingBufferSpike: sabRingBufferSpike.snapshot(),
    state: "idle",
    workerInitToFirstFrameMs: null,
    workerStartupToFirstFrameMs: null,
  });
  let latestGameplayPresentation: RenderGameplayPresentation | null = null;
  let worker: Worker | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let heartbeatMonitor: ReturnType<typeof setInterval> | null = null;
  let lastHeartbeatAt: number | null = null;
  let currentCanvas: HTMLCanvasElement | null = null;
  let renderPixelSizeOverride: RenderPixelSize | null = null;
  let activeAttemptRenderSize: {
    readonly worker: Worker;
    size: RenderPixelSize;
  } | null = null;
  let startupConfig: Readonly<{
    scene: GreyboxSceneConfig;
    startup: RenderStartupTelemetry;
  }> | null = null;
  let nextCheckpointRequestId = 1;
  let nextFlythroughPreflightRequestId = 1;
  let nextFlythroughResetRequestId = 1;
  let nextRecoveryBoundaryRequestId = 1;
  let flythroughGeneration = 0;
  let activeFlythroughReset: Readonly<{
    readonly flythroughGeneration: number;
    readonly promise: Promise<void>;
    readonly reject: (error: Error) => void;
    readonly requestId: number;
    readonly resolve: () => void;
    readonly timeout: ReturnType<typeof setTimeout>;
  }> | null = null;
  let diagnosticRecoveryCheckpoint: StreamingRecoveryCheckpoint | null = null;
  const checkpointRequests = new Map<
    number,
    Readonly<{
      readonly flythroughGeneration: number;
      reject: (error: Error) => void;
      resolve: (evidence: FlythroughCheckpointRenderEvidence) => void;
    }>
  >();
  const flythroughPreflightRequests = new Map<
    number,
    Readonly<{
      readonly elapsedMs: number;
      readonly environmentPhaseId: string;
      readonly expectedRenderSize: RenderPixelSize;
      readonly flythroughGeneration: number;
      reject: (error: Error) => void;
      resolve: () => void;
      readonly scenarioId: string;
    }>
  >();
  const recoveryBoundaryRequests = new Map<
    number,
    Readonly<{
      reject: (error: Error) => void;
      resolve: (checkpoint: StreamingRecoveryCheckpoint) => void;
    }>
  >();
  const listeners = new Set<RenderServiceListener>();
  const canvasListeners = new Set<RenderCanvasListener>();

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
  const publishCanvas = (canvas: HTMLCanvasElement): void => {
    for (const listener of canvasListeners) {
      try {
        listener(canvas);
      } catch (error: unknown) {
        console.error("Render canvas listener failed", error);
      }
    }
  };
  publishSabSnapshot = (sabSnapshot): void => {
    publish({ ...telemetry, sabRingBufferSpike: sabSnapshot });
  };

  const teardownAttempt = (checkpointFailure: string): void => {
    sabRingBufferSpike.dispose();
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (heartbeatMonitor !== null) clearInterval(heartbeatMonitor);
    heartbeatMonitor = null;
    lastHeartbeatAt = null;
    if (worker !== null) {
      worker.onmessage = null;
      worker.onmessageerror = null;
      worker.onerror = null;
      worker.terminate();
      worker = null;
    }
    activeAttemptRenderSize = null;
    for (const pending of checkpointRequests.values()) {
      pending.reject(new Error(checkpointFailure));
    }
    checkpointRequests.clear();
    for (const pending of flythroughPreflightRequests.values()) {
      pending.reject(new Error(checkpointFailure));
    }
    flythroughPreflightRequests.clear();
    if (activeFlythroughReset !== null) {
      clearTimeout(activeFlythroughReset.timeout);
      activeFlythroughReset.reject(new Error(checkpointFailure));
    }
    activeFlythroughReset = null;
    for (const pending of recoveryBoundaryRequests.values()) {
      pending.reject(new Error(checkpointFailure));
    }
    recoveryBoundaryRequests.clear();
  };

  const failTerminal = (
    cause: RenderRecoveryCause,
    message: string,
    propagateToStreaming = true,
    psoWarmup: PsoWarmupTelemetrySnapshot | null = null,
  ): void => {
    if (telemetry.state === "failed" || telemetry.state === "disposed") return;
    teardownAttempt("Render service failed before checkpoint capture completed");
    publish({
      ...telemetry,
      failureMessage: message,
      psoWarmup: psoWarmup ?? telemetry.psoWarmup,
      recovery: Object.freeze({
        ...telemetry.recovery,
        lastCause: cause,
        lastFailureMessage: message,
        state: "exhausted",
      }),
      state: "failed",
    });
    let terminalMessage = message;
    if (propagateToStreaming) {
      try {
        startupConfig?.startup.failStreamingCohort(message);
      } catch (error: unknown) {
        terminalMessage = `${message}; streaming-cohort termination failed: ${errorMessage(error)}`;
        publish({
          ...telemetry,
          failureMessage: terminalMessage,
          recovery: Object.freeze({
            ...telemetry.recovery,
            lastFailureMessage: terminalMessage,
          }),
        });
      }
    }
    console.error("Render worker failed", terminalMessage);
  };

  const replaceTransferredCanvas = (): HTMLCanvasElement => {
    if (currentCanvas === null) throw new Error("Render recovery lost its canvas");
    const replacement = currentCanvas.cloneNode(false);
    if (!(replacement instanceof HTMLCanvasElement)) {
      throw new Error("Render recovery could not create a fresh canvas");
    }
    currentCanvas.replaceWith(replacement);
    currentCanvas = replacement;
    publishCanvas(replacement);
    return replacement;
  };

  const sendResize = (size: RenderPixelSize): void => {
    const frozenSize = freezePixelSize(size);
    const currentWorker = worker;
    currentWorker?.postMessage({
      height: frozenSize.height,
      kind: "resize",
      width: frozenSize.width,
    } satisfies RenderWorkerRequest);
    if (currentWorker !== null && activeAttemptRenderSize?.worker === currentWorker) {
      activeAttemptRenderSize.size = frozenSize;
    }
    publish({
      ...telemetry,
      renderPixelSize: frozenSize,
      renderPixelSizeOverride,
    });
  };

  function startAttempt(
    canvas: HTMLCanvasElement,
    scene: GreyboxSceneConfig,
    startup: RenderStartupTelemetry,
    streamingPort: MessagePort,
    recoveryStartedAt: number | null,
    streamingSettlement: Promise<StreamingRecoveryCheckpoint> | null,
    streamingRecoveryCheckpoint: StreamingRecoveryCheckpoint | null,
  ): void {
    const initialSize = renderPixelSizeOverride ?? initialCanvasPixelSize(canvas);
    const offscreenCanvas = canvas.transferControlToOffscreen();
    const workerStartupStartedAt = performance.now();
    const renderWorker = new Worker(renderWorkerUrl(), {
      name: "parallax-render",
      type: "module",
    });
    let mainThreadScenePostMessageMs: number | null = null;
    let pendingReady: Extract<RenderWorkerResponse, { kind: "ready" }> | null = null;
    let replacementStreamingSettled = recoveryStartedAt === null;
    const workerGeneration = telemetry.recovery.workerGeneration;
    worker = renderWorker;
    activeAttemptRenderSize = { size: initialSize, worker: renderWorker };
    const completeReady = (message: Extract<RenderWorkerResponse, { kind: "ready" }>): void => {
      if (mainThreadScenePostMessageMs === null) {
        recoverOrFail(
          "worker-message",
          "Render worker became ready before scene postMessage completed",
        );
        return;
      }
      const readyRenderSize =
        activeAttemptRenderSize?.worker === renderWorker
          ? activeAttemptRenderSize.size
          : initialSize;
      publish({
        ...telemetry,
        decoderBootstrap: Object.freeze(message.decoderBootstrap),
        decoderFixtures: Object.freeze(message.decoderFixtures),
        failureMessage: null,
        frameCount: 1,
        greyboxWorld: freezeGreyboxTelemetry({
          ...message.greyboxWorld,
          mainThreadScenePostMessageMs,
          mainThreadWorldGenerationMs: startup.mainThreadWorldGenerationMs,
        }),
        recentFrames: Object.freeze([Object.freeze(message.firstFrame)]),
        psoWarmup: freezePsoWarmupTelemetry(message.psoWarmup),
        renderPixelSize: readyRenderSize,
        renderPixelSizeOverride,
        recovery: Object.freeze({
          ...telemetry.recovery,
          lastRestartDurationMs:
            recoveryStartedAt === null ? null : performance.now() - recoveryStartedAt,
          state: recoveryStartedAt === null ? "not-needed" : "recovered",
        }),
        state: "ready",
        workerInitToFirstFrameMs: message.workerInitToFirstFrameMs,
        workerStartupToFirstFrameMs: performance.now() - workerStartupStartedAt,
      });
      sabRingBufferSpike.start();
      if (latestGameplayPresentation !== null) {
        renderWorker.postMessage({
          ...latestGameplayPresentation,
          kind: "gameplay-presentation",
        } satisfies RenderWorkerRequest);
      }
    };
    const completeRecoveryIfReady = (): void => {
      if (pendingReady !== null && replacementStreamingSettled) {
        const ready = pendingReady;
        pendingReady = null;
        completeReady(ready);
      }
    };
    if (streamingSettlement !== null) {
      void streamingSettlement.then(
        () => {
          if (worker !== renderWorker || telemetry.state !== "recovering") return;
          replacementStreamingSettled = true;
          completeRecoveryIfReady();
        },
        (error: unknown) => {
          if (worker !== renderWorker || telemetry.state !== "recovering") return;
          failTerminal(
            "render-error",
            `Streaming recovery hydration failed: ${errorMessage(error)}`,
          );
        },
      );
    }
    lastHeartbeatAt = performance.now();
    heartbeatMonitor = setInterval(() => {
      if (
        worker === renderWorker &&
        lastHeartbeatAt !== null &&
        performance.now() - lastHeartbeatAt > WORKER_HEARTBEAT_TIMEOUT_MS
      ) {
        recoverOrFail(
          "worker-crash",
          `Render worker heartbeat exceeded ${WORKER_HEARTBEAT_TIMEOUT_MS} ms`,
        );
      }
    }, 500);
    renderWorker.onmessage = (event: MessageEvent<RenderWorkerResponse>): void => {
      if (worker !== renderWorker || telemetry.state === "failed" || telemetry.state === "disposed")
        return;
      const message = event.data;
      switch (message.kind) {
        case "heartbeat":
          if (message.workerGeneration !== workerGeneration) {
            recoverOrFail(
              "worker-message",
              `Render worker heartbeat generation ${message.workerGeneration} did not match ${workerGeneration}`,
            );
            return;
          }
          lastHeartbeatAt = performance.now();
          break;
        case "ready":
          pendingReady = message;
          completeRecoveryIfReady();
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
        case "flythrough-checkpoint": {
          const pending = checkpointRequests.get(message.requestId);
          if (pending === undefined) {
            if (message.flythroughGeneration < flythroughGeneration) return;
            recoverOrFail(
              "worker-message",
              `Render worker returned unknown checkpoint ${message.requestId}`,
            );
            return;
          }
          if (message.flythroughGeneration !== pending.flythroughGeneration) {
            recoverOrFail(
              "worker-message",
              `Render worker returned checkpoint ${message.requestId} for flythrough generation ${message.flythroughGeneration}`,
            );
            return;
          }
          checkpointRequests.delete(message.requestId);
          pending.resolve(freezeFlythroughCheckpointEvidence(message.evidence));
          break;
        }
        case "flythrough-preflight-rendered": {
          const pending = flythroughPreflightRequests.get(message.requestId);
          if (pending === undefined) {
            if (message.flythroughGeneration < flythroughGeneration) return;
            recoverOrFail(
              "worker-message",
              `Render worker returned unknown flythrough preflight ${message.requestId}`,
            );
            return;
          }
          if (
            message.flythroughGeneration !== pending.flythroughGeneration ||
            message.scenarioId !== pending.scenarioId ||
            message.environmentPhaseId !== pending.environmentPhaseId ||
            message.elapsedMs !== pending.elapsedMs ||
            message.width !== pending.expectedRenderSize.width ||
            message.height !== pending.expectedRenderSize.height
          ) {
            recoverOrFail(
              "worker-message",
              `Render worker returned incoherent flythrough preflight ${message.requestId}`,
            );
            return;
          }
          flythroughPreflightRequests.delete(message.requestId);
          pending.resolve();
          break;
        }
        case "flythrough-complete":
          if (message.flythroughGeneration < flythroughGeneration) return;
          if (message.flythroughGeneration !== flythroughGeneration) {
            recoverOrFail(
              "worker-message",
              `Render worker completed flythrough generation ${message.flythroughGeneration}; expected ${flythroughGeneration}`,
            );
            return;
          }
          publish({
            ...telemetry,
            flythrough: freezeRenderFlythroughTelemetry(message.telemetry),
          });
          break;
        case "flythrough-reset-complete": {
          const pending = activeFlythroughReset;
          if (
            pending === null ||
            message.requestId !== pending.requestId ||
            message.flythroughGeneration !== pending.flythroughGeneration
          ) {
            if (message.flythroughGeneration < flythroughGeneration) return;
            recoverOrFail(
              "worker-message",
              `Render worker returned invalid flythrough reset ${message.requestId}`,
            );
            return;
          }
          clearTimeout(pending.timeout);
          activeFlythroughReset = null;
          pending.resolve();
          break;
        }
        case "recovery-boundary": {
          const pending = recoveryBoundaryRequests.get(message.requestId);
          if (pending === undefined) {
            recoverOrFail(
              "worker-message",
              `Render worker returned invalid recovery boundary ${message.requestId}`,
            );
            return;
          }
          let checkpoint: StreamingRecoveryCheckpoint;
          try {
            checkpoint = cloneRecoveryCheckpoint(message.checkpoint, workerGeneration);
          } catch (error: unknown) {
            recoverOrFail(
              "worker-message",
              `Render worker returned invalid recovery boundary ${message.requestId}: ${errorMessage(error)}`,
            );
            return;
          }
          recoveryBoundaryRequests.delete(message.requestId);
          diagnosticRecoveryCheckpoint = checkpoint;
          pending.resolve(cloneRecoveryCheckpoint(checkpoint, workerGeneration));
          break;
        }
        case "device-lost":
          recoverOrFail(
            "device-loss",
            `WebGPU device lost (${message.reason}): ${message.message || "no detail"}`,
          );
          break;
        case "error":
          recoverOrFail(
            message.cause,
            message.message,
            message.psoWarmup === null ? null : freezePsoWarmupTelemetry(message.psoWarmup),
          );
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
      if (worker === renderWorker)
        recoverOrFail("worker-message", "Render worker message failed to deserialize");
    };
    renderWorker.onerror = (event): void => {
      if (worker !== renderWorker || telemetry.state === "failed" || telemetry.state === "disposed")
        return;
      recoverOrFail(
        "worker-error",
        event instanceof ErrorEvent && event.message !== ""
          ? event.message
          : "Render worker script failed to load",
      );
    };

    const scenePostMessageStartedAt = performance.now();
    renderWorker.postMessage(
      {
        canvas: offscreenCanvas,
        flythroughGeneration,
        flythroughTransportSequence:
          streamingRecoveryCheckpoint?.flythroughObserverUpdateCount ?? 0,
        height: initialSize.height,
        kind: "start",
        psoWarmupTrace: startup.psoWarmupTrace,
        sabRingBufferSpike: sabRingBufferSpike.config,
        scene,
        streamingPort,
        width: initialSize.width,
        workerGeneration,
      } satisfies RenderWorkerRequest,
      [offscreenCanvas, streamingPort],
    );
    mainThreadScenePostMessageMs = performance.now() - scenePostMessageStartedAt;
    resizeObserver = new ResizeObserver((entries) => {
      if (renderPixelSizeOverride !== null) return;
      const devicePixelSize = entries[0]?.devicePixelContentBoxSize[0];
      if (devicePixelSize === undefined) {
        recoverOrFail(
          "render-error",
          "ResizeObserver did not provide device-pixel canvas dimensions",
        );
        return;
      }
      sendResize({ height: devicePixelSize.blockSize, width: devicePixelSize.inlineSize });
    });
    resizeObserver.observe(canvas, { box: "device-pixel-content-box" });
  }

  function recoverOrFail(
    cause: RenderRecoveryCause,
    message: string,
    psoWarmupFailure: PsoWarmupTelemetrySnapshot | null = null,
  ): void {
    if (telemetry.state === "failed" || telemetry.state === "disposed") {
      return;
    }
    if (
      telemetry.recovery.restartCount >= MAX_AUTOMATIC_RESTARTS ||
      startupConfig === null ||
      currentCanvas === null
    ) {
      failTerminal(cause, message, true, psoWarmupFailure);
      return;
    }
    const recoveryStartedAt = performance.now();
    const failedPsoWarmup = psoWarmupFailure ?? telemetry.psoWarmup;
    const retainedPsoWarmupFailure =
      telemetry.retainedPsoWarmupFailure ??
      (failedPsoWarmup.state === "failed"
        ? Object.freeze({
            snapshot: failedPsoWarmup,
            workerGeneration: telemetry.recovery.workerGeneration,
          })
        : null);
    teardownAttempt("Render worker restarted before checkpoint capture completed");
    publish({
      ...telemetry,
      decoderBootstrap: null,
      decoderFixtures: null,
      failureMessage: null,
      flythrough: null,
      frameCount: 0,
      greyboxWorld: null,
      recentFrames: Object.freeze([]),
      psoWarmup: idlePsoWarmupTelemetrySnapshot(),
      retainedPsoWarmupFailure,
      renderPixelSize: null,
      renderPixelSizeOverride,
      recovery: Object.freeze({
        ...telemetry.recovery,
        lastCause: cause,
        lastFailureMessage: message,
        lastRestartDurationMs: null,
        restartCount: telemetry.recovery.restartCount + 1,
        state: "restarting",
        workerGeneration: telemetry.recovery.workerGeneration + 1,
      }),
      state: "recovering",
      workerInitToFirstFrameMs: null,
      workerStartupToFirstFrameMs: null,
    });
    try {
      flythroughGeneration = 0;
      const streamingRecovery = startupConfig.startup.restartStreamingCohort(
        diagnosticRecoveryCheckpoint ?? undefined,
      );
      diagnosticRecoveryCheckpoint = null;
      const nextCanvas = replaceTransferredCanvas();
      sabRingBufferSpike = createSabRingBufferSpike((snapshot) => publishSabSnapshot(snapshot));
      publish({ ...telemetry, sabRingBufferSpike: sabRingBufferSpike.snapshot() });
      startAttempt(
        nextCanvas,
        startupConfig.scene,
        startupConfig.startup,
        streamingRecovery.streamingPort,
        recoveryStartedAt,
        streamingRecovery.settled,
        streamingRecovery.checkpoint,
      );
    } catch (error: unknown) {
      failTerminal(cause, `${message}; recovery failed: ${errorMessage(error)}`);
    }
  }

  return Object.freeze({
    applyFlythroughPreflight(
      scenarioId: string,
      sample: FlythroughScenarioSample,
      camera: FlythroughScenario["camera"],
    ): Promise<void> {
      if (worker === null || telemetry.state !== "ready") {
        return Promise.reject(new Error("Flythrough preflight requires a ready render service"));
      }
      const expectedRenderSize = telemetry.renderPixelSize;
      if (expectedRenderSize === null) {
        return Promise.reject(
          new Error("Flythrough preflight requires an acknowledged render size"),
        );
      }
      const requestId = nextFlythroughPreflightRequestId;
      nextFlythroughPreflightRequestId += 1;
      return new Promise((resolve, reject) => {
        flythroughPreflightRequests.set(
          requestId,
          Object.freeze({
            elapsedMs: sample.elapsedMs,
            environmentPhaseId: sample.environment.id,
            expectedRenderSize,
            flythroughGeneration,
            reject,
            resolve,
            scenarioId,
          }),
        );
        worker?.postMessage({
          camera,
          flythroughGeneration,
          kind: "flythrough-preflight-sample",
          requestId,
          sample,
          scenarioId,
        } satisfies RenderWorkerRequest);
      });
    },

    captureFlythroughCheckpoint(checkpointId: string): Promise<FlythroughCheckpointRenderEvidence> {
      if (worker === null || telemetry.state !== "ready") {
        return Promise.reject(new Error("Flythrough checkpoint requires a ready render service"));
      }
      const requestId = nextCheckpointRequestId;
      nextCheckpointRequestId += 1;
      return new Promise((resolve, reject) => {
        checkpointRequests.set(requestId, Object.freeze({ flythroughGeneration, reject, resolve }));
        worker?.postMessage({
          checkpointId,
          flythroughGeneration,
          kind: "capture-flythrough-checkpoint",
          requestId,
        } satisfies RenderWorkerRequest);
      });
    },

    dispose(): void {
      if (telemetry.state === "disposed") return;
      teardownAttempt("Render service disposed before checkpoint capture completed");
      publish({ ...telemetry, state: "disposed" });
    },

    exerciseRecovery(probe: RenderRecoveryProbeKind): void {
      if (worker === null || telemetry.state !== "ready") {
        throw new Error("Render recovery probe requires a ready render service");
      }
      worker.postMessage({
        kind: "exercise-recovery",
        probe,
      } satisfies RenderWorkerRequest);
    },

    exerciseRecoveryAtBoundary(
      probe: RenderRecoveryProbeKind,
    ): Promise<StreamingRecoveryCheckpoint> {
      if (worker === null || telemetry.state !== "ready") {
        return Promise.reject(
          new Error("Render recovery boundary probe requires a ready render service"),
        );
      }
      const requestId = nextRecoveryBoundaryRequestId;
      nextRecoveryBoundaryRequestId += 1;
      return new Promise((resolve, reject) => {
        recoveryBoundaryRequests.set(requestId, Object.freeze({ reject, resolve }));
        worker?.postMessage({
          kind: "exercise-recovery-at-boundary",
          probe,
          requestId,
        } satisfies RenderWorkerRequest);
      });
    },

    failAfterStreamingFailure(message: string): void {
      if (telemetry.state === "disposed" || telemetry.state === "failed") return;
      failTerminal("render-error", `Streaming cohort failed: ${message}`, false);
    },

    resetFlythrough(): Promise<void> {
      if (worker === null || telemetry.state !== "ready") {
        return Promise.reject(new Error("Flythrough reset requires a ready render service"));
      }
      if (activeFlythroughReset !== null) return activeFlythroughReset.promise;
      flythroughGeneration += 1;
      for (const pending of checkpointRequests.values()) {
        pending.reject(new Error("Flythrough reset cancelled checkpoint capture"));
      }
      checkpointRequests.clear();
      for (const pending of flythroughPreflightRequests.values()) {
        pending.reject(new Error("Flythrough reset cancelled preflight render"));
      }
      flythroughPreflightRequests.clear();
      const requestId = nextFlythroughResetRequestId;
      nextFlythroughResetRequestId += 1;
      let resolveReset!: () => void;
      let rejectReset!: (error: Error) => void;
      const promise = new Promise<void>((resolve, reject) => {
        resolveReset = resolve;
        rejectReset = reject;
      });
      const timeout = setTimeout(() => {
        const pending = activeFlythroughReset;
        if (pending?.requestId !== requestId) return;
        const message = `Flythrough reset ${requestId} did not settle within ${FLYTHROUGH_RESET_TIMEOUT_MS} ms`;
        activeFlythroughReset = null;
        pending.reject(new Error(message));
        recoverOrFail("render-error", message);
      }, FLYTHROUGH_RESET_TIMEOUT_MS);
      activeFlythroughReset = Object.freeze({
        flythroughGeneration,
        promise,
        reject: rejectReset,
        requestId,
        resolve: resolveReset,
        timeout,
      });
      worker.postMessage({
        kind: "reset-flythrough",
        nextFlythroughGeneration: flythroughGeneration,
        requestId,
      } satisfies RenderWorkerRequest);
      publish({ ...telemetry, flythrough: null });
      return promise;
    },

    setRenderPixelSizeOverride(size: RenderPixelSize | null): void {
      if (telemetry.state === "disposed" || telemetry.state === "failed") {
        throw new Error("Render pixel size cannot change after terminal render state");
      }
      renderPixelSizeOverride = size === null ? null : freezePixelSize(size);
      if (worker !== null) {
        const nextSize =
          renderPixelSizeOverride ??
          (currentCanvas === null ? null : initialCanvasPixelSize(currentCanvas));
        if (nextSize !== null) sendResize(nextSize);
      } else {
        publish({ ...telemetry, renderPixelSizeOverride });
      }
    },

    setGameplayPresentation(presentation: RenderGameplayPresentation): void {
      if (
        !Number.isSafeInteger(presentation.sequence) ||
        presentation.sequence < 0 ||
        !Number.isFinite(presentation.cameraPitchRadians) ||
        !Number.isFinite(presentation.playerYawRadians) ||
        presentation.playerPosition.some((value) => !Number.isFinite(value))
      ) {
        throw new Error("Gameplay presentation is invalid");
      }
      if (
        latestGameplayPresentation !== null &&
        presentation.sequence <= latestGameplayPresentation.sequence
      ) {
        return;
      }
      latestGameplayPresentation = Object.freeze({
        ...presentation,
        playerPosition: Object.freeze([...presentation.playerPosition]) as readonly [
          number,
          number,
          number,
        ],
      });
      if (worker !== null && telemetry.state === "ready") {
        worker.postMessage({
          ...latestGameplayPresentation,
          kind: "gameplay-presentation",
        } satisfies RenderWorkerRequest);
      }
    },

    snapshot(): RenderTelemetrySnapshot {
      return telemetry;
    },

    start(
      canvas: HTMLCanvasElement,
      scene: GreyboxSceneConfig,
      startup: RenderStartupTelemetry,
    ): void {
      if (telemetry.state !== "idle") {
        throw new Error("Render service can only be started once");
      }
      if (
        !Number.isFinite(startup.mainThreadWorldGenerationMs) ||
        startup.mainThreadWorldGenerationMs < 0
      ) {
        throw new Error("Main-thread world-generation timing must be finite and non-negative");
      }

      publish({ ...telemetry, state: "starting" });
      try {
        if (!("transferControlToOffscreen" in canvas)) {
          throw new Error("OffscreenCanvas transfer is unavailable in this Chrome build");
        }
        currentCanvas = canvas;
        publishCanvas(canvas);
        startupConfig = Object.freeze({ scene, startup });
        publish({
          ...telemetry,
          recovery: Object.freeze({ ...telemetry.recovery, workerGeneration: 1 }),
        });
        startAttempt(canvas, scene, startup, startup.streamingPort, null, null, null);
      } catch (error: unknown) {
        failTerminal("startup", errorMessage(error));
      }
    },

    startFlythrough(scenario: FlythroughScenario): void {
      if (worker === null || telemetry.state !== "ready") {
        throw new Error("Flythrough measurement requires a ready render service");
      }
      if (telemetry.flythrough !== null) {
        throw new Error("Render service flythrough can only be started once");
      }
      worker.postMessage({
        flythroughGeneration,
        kind: "start-flythrough",
        scenario,
      } satisfies RenderWorkerRequest);
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
    subscribeCanvas(listener: RenderCanvasListener): () => void {
      canvasListeners.add(listener);
      if (currentCanvas !== null) {
        try {
          listener(currentCanvas);
        } catch (error: unknown) {
          console.error("Render canvas listener failed", error);
        }
      }
      return () => canvasListeners.delete(listener);
    },
  });
}

function freezePixelSize(size: RenderPixelSize): RenderPixelSize {
  if (
    !Number.isSafeInteger(size.width) ||
    size.width <= 0 ||
    !Number.isSafeInteger(size.height) ||
    size.height <= 0
  ) {
    throw new Error("Render pixel size must contain positive safe integers");
  }
  return Object.freeze({ height: size.height, width: size.width });
}

function freezeFlythroughCheckpointEvidence(
  evidence: FlythroughCheckpointRenderEvidence,
): FlythroughCheckpointRenderEvidence {
  return Object.freeze({
    ...evidence,
    cameraPosition: Object.freeze([...evidence.cameraPosition]) as readonly [
      number,
      number,
      number,
    ],
    cameraTarget: Object.freeze([...evidence.cameraTarget]) as readonly [number, number, number],
    clearColorRgb: Object.freeze([...evidence.clearColorRgb]) as readonly [number, number, number],
    environment: Object.freeze({ ...evidence.environment }),
  });
}

function freezeRenderFlythroughTelemetry(
  value: RenderFlythroughTelemetry,
): RenderFlythroughTelemetry {
  return Object.freeze({
    ...value,
    callbackIntervalMs: Object.freeze({ ...value.callbackIntervalMs }),
    cameraPositionMaximum: freezeWorldVector(value.cameraPositionMaximum),
    cameraPositionMinimum: freezeWorldVector(value.cameraPositionMinimum),
    cameraTargetMaximum: freezeWorldVector(value.cameraTargetMaximum),
    cameraTargetMinimum: freezeWorldVector(value.cameraTargetMinimum),
    environmentFrameCounts: Object.freeze({ ...value.environmentFrameCounts }),
    environmentPhaseOrder: Object.freeze([...value.environmentPhaseOrder]),
    finalObserver: freezeWorldVector(value.finalObserver),
    renderDurationMs: Object.freeze({ ...value.renderDurationMs }),
    scenario: Object.freeze({
      ...value.scenario,
      camera: Object.freeze({ ...value.scenario.camera }),
      environmentPhases: Object.freeze(
        value.scenario.environmentPhases.map((phase) => Object.freeze({ ...phase })),
      ),
      path: Object.freeze(value.scenario.path.map((point) => freezeWorldVector(point))),
    }),
  });
}

function freezeWorldVector(
  value: readonly [number, number, number],
): readonly [number, number, number] {
  return Object.freeze([...value]) as readonly [number, number, number];
}

function cloneRecoveryCheckpoint(
  checkpoint: StreamingRecoveryCheckpoint,
  expectedWorkerGeneration: number,
): StreamingRecoveryCheckpoint {
  if (
    !Number.isSafeInteger(checkpoint.flythroughObserverUpdateCount) ||
    checkpoint.flythroughObserverUpdateCount < 0 ||
    !Number.isSafeInteger(checkpoint.observerUpdateCount) ||
    checkpoint.observerUpdateCount < 0 ||
    checkpoint.flythroughObserverUpdateCount > checkpoint.observerUpdateCount ||
    checkpoint.workerGeneration !== expectedWorkerGeneration ||
    !Array.isArray(checkpoint.observers) ||
    checkpoint.observers.length === 0 ||
    checkpoint.observers.some(
      (observer) =>
        !Array.isArray(observer) ||
        observer.length !== 3 ||
        observer.some((component) => !Number.isFinite(component)),
    ) ||
    !Array.isArray(checkpoint.residentCellIds) ||
    checkpoint.residentCellIds.length !== STREAMING_RESIDENT_CELL_LIMIT ||
    checkpoint.residentCellIds.some(
      (cellId) => typeof cellId !== "string" || cellId.length === 0,
    ) ||
    new Set(checkpoint.residentCellIds).size !== STREAMING_RESIDENT_CELL_LIMIT ||
    JSON.stringify(checkpoint.residentCellIds) !==
      JSON.stringify([...checkpoint.residentCellIds].sort())
  ) {
    throw new Error("Streaming recovery checkpoint contract is invalid");
  }
  return Object.freeze({
    flythroughObserverUpdateCount: checkpoint.flythroughObserverUpdateCount,
    observerUpdateCount: checkpoint.observerUpdateCount,
    observers: Object.freeze(
      checkpoint.observers.map(
        (observer) => Object.freeze([...observer]) as readonly [number, number, number],
      ),
    ),
    residentCellIds: Object.freeze([...checkpoint.residentCellIds]),
    workerGeneration: checkpoint.workerGeneration,
  });
}
