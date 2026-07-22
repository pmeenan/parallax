import type {
  SabRingBufferSpikeConfig,
  SabRingBufferSpikeWorkerResponse,
} from "../workers/sab-ring-buffer-spike-protocol";
import type { DecoderBootstrapTelemetry, DecoderFixtureTelemetry } from "./decoder-bootstrap";

export interface WalkingSkeletonScene {
  readonly camera: {
    readonly alpha: number;
    readonly beta: number;
    readonly minZ: number;
    readonly radius: number;
    readonly target: readonly [number, number, number];
  };
  readonly clearColor: readonly [number, number, number, number];
  readonly lightDirection: readonly [number, number, number];
  readonly meshColor: readonly [number, number, number];
  readonly meshSize: number;
  readonly rotationRadiansPerSecond: readonly [number, number];
}

export interface RenderStartMessage {
  readonly canvas: OffscreenCanvas;
  readonly height: number;
  readonly kind: "start";
  readonly sabRingBufferSpike: SabRingBufferSpikeConfig;
  readonly scene: WalkingSkeletonScene;
  readonly width: number;
}

export interface RenderResizeMessage {
  readonly height: number;
  readonly kind: "resize";
  readonly width: number;
}

export type RenderWorkerRequest = RenderResizeMessage | RenderStartMessage;

export interface RenderFrameSample {
  readonly durationMs: number;
  readonly presentIntervalMs: number | null;
}

export interface RenderReadyMessage {
  readonly decoderBootstrap: DecoderBootstrapTelemetry;
  readonly decoderFixtures: DecoderFixtureTelemetry;
  readonly firstFrame: RenderFrameSample;
  readonly kind: "ready";
  readonly workerInitToFirstFrameMs: number;
}

export interface RenderFrameMessage {
  readonly frameCount: number;
  readonly kind: "frame";
  readonly samples: readonly RenderFrameSample[];
}

export interface RenderErrorMessage {
  readonly kind: "error";
  readonly message: string;
}

export type RenderWorkerResponse =
  | RenderErrorMessage
  | RenderFrameMessage
  | RenderReadyMessage
  | SabRingBufferSpikeWorkerResponse;
