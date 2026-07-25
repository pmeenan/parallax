import type {
  SabRingBufferSpikeConfig,
  SabRingBufferSpikeWorkerResponse,
} from "../workers/sab-ring-buffer-spike-protocol";
import type { GreyboxSceneConfig } from "../world/world-contract";
import type { DecoderBootstrapTelemetry, DecoderFixtureTelemetry } from "./decoder-bootstrap";

export type { GreyboxSceneConfig } from "../world/world-contract";

export interface GreyboxRenderTelemetry {
  readonly cellCount: number;
  readonly clearColor: readonly [number, number, number, number];
  readonly colliderCount: number;
  readonly districtId: string;
  readonly dynamicLighting: true;
  readonly heightSampleCount: number;
  readonly mainThreadWorldGenerationMs: number;
  readonly mainThreadScenePostMessageMs: number;
  readonly materialCount: number;
  readonly materializationMs: number;
  readonly renderedFeaturePrimitiveCount: number;
  readonly renderedTerrainPatchCount: number;
  readonly renderedTriangleCount: number;
  readonly selectedLodCellCounts: readonly [number, number, number];
  readonly worldBoundsMeters: Readonly<{
    maximum: readonly [number, number, number];
    minimum: readonly [number, number, number];
  }>;
}

export type GreyboxWorkerRenderTelemetry = Omit<
  GreyboxRenderTelemetry,
  "mainThreadScenePostMessageMs" | "mainThreadWorldGenerationMs"
>;

export interface RenderStartMessage {
  readonly canvas: OffscreenCanvas;
  readonly height: number;
  readonly kind: "start";
  readonly sabRingBufferSpike: SabRingBufferSpikeConfig;
  readonly scene: GreyboxSceneConfig;
  readonly streamingPort: MessagePort;
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
  readonly lightingIntensity: number;
  readonly lightingPhase: number;
  readonly presentIntervalMs: number | null;
}

export interface RenderReadyMessage {
  readonly decoderBootstrap: DecoderBootstrapTelemetry;
  readonly decoderFixtures: DecoderFixtureTelemetry;
  readonly firstFrame: RenderFrameSample;
  readonly greyboxWorld: GreyboxWorkerRenderTelemetry;
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
