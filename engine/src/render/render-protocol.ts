import type {
  FlythroughScenario,
  FlythroughScenarioSample,
} from "../flythrough/flythrough-contract";
import type { StreamingRecoveryCheckpoint } from "../streaming/streaming-protocol";
import type {
  HybridUiAction,
  HybridUiPresentation,
  HybridUiWorkerInput,
  HybridUiWorkerTelemetrySnapshot,
} from "../ui/hybrid-ui-contract";
import type {
  SabRingBufferSpikeConfig,
  SabRingBufferSpikeWorkerResponse,
} from "../workers/sab-ring-buffer-spike-protocol";
import type { GreyboxSceneConfig } from "../world/world-contract";
import type { DecoderBootstrapTelemetry, DecoderFixtureTelemetry } from "./decoder-bootstrap";
import type { PsoWarmupTelemetrySnapshot, PsoWarmupTraceBundle } from "./pso-warmup-contract";

export type { GreyboxSceneConfig } from "../world/world-contract";

export const RENDER_GAMEPLAY_CROWD_CAPACITY = 64;

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
  readonly flythroughGeneration: number;
  readonly flythroughTransportSequence: number;
  readonly height: number;
  readonly kind: "start";
  readonly psoWarmupTrace: PsoWarmupTraceBundle;
  readonly sabRingBufferSpike: SabRingBufferSpikeConfig;
  readonly scene: GreyboxSceneConfig;
  readonly streamingPort: MessagePort;
  readonly width: number;
  readonly workerGeneration: number;
}

export interface RenderResizeMessage {
  readonly height: number;
  readonly kind: "resize";
  readonly width: number;
}

export interface RenderGameplayPresentationMessage {
  readonly cameraPitchRadians: number;
  readonly crowdEntities: readonly Readonly<{
    readonly id: number;
    readonly position: readonly [number, number, number];
    readonly yawRadians: number;
  }>[];
  readonly kind: "gameplay-presentation";
  readonly playerPosition: readonly [number, number, number];
  readonly playerYawRadians: number;
  readonly sequence: number;
}

export interface RenderHybridUiPresentationMessage {
  readonly kind: "hybrid-ui-presentation";
  readonly presentation: HybridUiPresentation;
}

export interface RenderHybridUiInputMessage {
  readonly input: HybridUiWorkerInput;
  readonly kind: "hybrid-ui-input";
}

export interface RenderFlythroughResetMessage {
  readonly kind: "reset-flythrough";
  readonly nextFlythroughGeneration: number;
  readonly requestId: number;
}

export interface RenderFlythroughPreflightSampleMessage {
  readonly camera: Readonly<{
    readonly beta: number;
    readonly heightMeters: number;
    readonly radiusMeters: number;
  }>;
  readonly flythroughGeneration: number;
  readonly kind: "flythrough-preflight-sample";
  readonly requestId: number;
  readonly sample: FlythroughScenarioSample;
  readonly scenarioId: string;
}

export interface RenderFlythroughStartMessage {
  readonly flythroughGeneration: number;
  readonly kind: "start-flythrough";
  readonly scenario: FlythroughScenario;
}

export interface RenderFlythroughCheckpointRequest {
  readonly checkpointId: string;
  readonly flythroughGeneration: number;
  readonly kind: "capture-flythrough-checkpoint";
  readonly requestId: number;
}

export type RenderRecoveryProbeKind = "device-loss" | "worker-crash";

export interface RenderRecoveryProbeRequest {
  readonly kind: "exercise-recovery";
  readonly probe: RenderRecoveryProbeKind;
}

export interface RenderRecoveryBoundaryProbeRequest {
  readonly kind: "exercise-recovery-at-boundary";
  readonly probe: RenderRecoveryProbeKind;
  readonly requestId: number;
}

export type RenderWorkerRequest =
  | RenderFlythroughCheckpointRequest
  | RenderFlythroughPreflightSampleMessage
  | RenderFlythroughResetMessage
  | RenderFlythroughStartMessage
  | RenderRecoveryBoundaryProbeRequest
  | RenderRecoveryProbeRequest
  | RenderGameplayPresentationMessage
  | RenderHybridUiInputMessage
  | RenderHybridUiPresentationMessage
  | RenderResizeMessage
  | RenderStartMessage;

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
  readonly psoWarmup: PsoWarmupTelemetrySnapshot;
  readonly workerInitToFirstFrameMs: number;
}

export interface RenderFrameMessage {
  readonly frameCount: number;
  readonly kind: "frame";
  readonly samples: readonly RenderFrameSample[];
}

export interface RenderErrorMessage {
  readonly cause: "render-error";
  readonly kind: "error";
  readonly message: string;
  readonly psoWarmup: PsoWarmupTelemetrySnapshot | null;
}

export interface RenderDeviceLostMessage {
  readonly kind: "device-lost";
  readonly message: string;
  readonly reason: GPUDeviceLostReason;
}

export interface RenderHeartbeatMessage {
  readonly kind: "heartbeat";
  readonly workerGeneration: number;
}

export interface RenderHybridUiActionMessage {
  readonly action: HybridUiAction;
  readonly kind: "hybrid-ui-action";
  readonly telemetry: HybridUiWorkerTelemetrySnapshot;
}

export interface RenderHybridUiTelemetryMessage {
  readonly inputSequence: number | null;
  readonly kind: "hybrid-ui-telemetry";
  readonly telemetry: HybridUiWorkerTelemetrySnapshot;
}

export interface RenderDistributionTelemetry {
  readonly maximum: number;
  readonly p50: number;
  readonly p95: number;
  readonly p999: number;
  readonly sampleCount: number;
}

export interface RenderFlythroughTelemetry {
  readonly callbackIntervalMs: RenderDistributionTelemetry;
  readonly cameraPositionMaximum: readonly [number, number, number];
  readonly cameraPositionMinimum: readonly [number, number, number];
  readonly cameraTargetMaximum: readonly [number, number, number];
  readonly cameraTargetMinimum: readonly [number, number, number];
  readonly completedDistanceMeters: number;
  readonly completedElapsedMs: number;
  readonly environmentFrameCounts: Readonly<Record<string, number>>;
  readonly environmentPhaseOrder: readonly string[];
  readonly finalObserver: readonly [number, number, number];
  readonly frameCount: number;
  readonly minimumVisibleStreamingMeshCount: number;
  readonly observerUpdateCount: number;
  readonly previewVisibleFrameCount: number;
  readonly renderDurationMs: RenderDistributionTelemetry;
  readonly scenario: FlythroughScenario;
  readonly scenarioId: string;
  readonly state: "completed";
  readonly streamedPresentationFrameCount: number;
}

export interface FlythroughCheckpointRenderEvidence {
  readonly cameraPosition: readonly [number, number, number];
  readonly cameraTarget: readonly [number, number, number];
  readonly checkpointId: string;
  readonly clearColorDistanceThreshold: number;
  readonly clearColorRgb: readonly [number, number, number];
  readonly environmentPhaseId: string;
  readonly environment: FlythroughScenarioSample["environment"];
  readonly elapsedMs: number;
  readonly height: number;
  readonly previewVisibleMeshCount: number;
  readonly rgbaSha256: string;
  readonly sampledPixelCount: number;
  readonly streamedVisibleMeshCount: number;
  readonly visiblePixelCount: number;
  readonly visiblePixelRatio: number;
  readonly width: number;
}

export interface RenderFlythroughCheckpointResponse {
  readonly evidence: FlythroughCheckpointRenderEvidence;
  readonly flythroughGeneration: number;
  readonly kind: "flythrough-checkpoint";
  readonly requestId: number;
}

export interface RenderFlythroughPreflightRenderedMessage {
  readonly elapsedMs: number;
  readonly environmentPhaseId: string;
  readonly flythroughGeneration: number;
  readonly height: number;
  readonly kind: "flythrough-preflight-rendered";
  readonly requestId: number;
  readonly scenarioId: string;
  readonly width: number;
}

export interface RenderFlythroughCompleteMessage {
  readonly flythroughGeneration: number;
  readonly kind: "flythrough-complete";
  readonly telemetry: RenderFlythroughTelemetry;
}

export interface RenderFlythroughResetCompleteMessage {
  readonly flythroughGeneration: number;
  readonly kind: "flythrough-reset-complete";
  readonly requestId: number;
}

export interface RenderRecoveryBoundaryMessage {
  readonly checkpoint: StreamingRecoveryCheckpoint;
  readonly kind: "recovery-boundary";
  readonly requestId: number;
}

export type RenderWorkerResponse =
  | RenderDeviceLostMessage
  | RenderErrorMessage
  | RenderFlythroughCheckpointResponse
  | RenderFlythroughCompleteMessage
  | RenderFlythroughPreflightRenderedMessage
  | RenderFlythroughResetCompleteMessage
  | RenderFrameMessage
  | RenderHeartbeatMessage
  | RenderHybridUiActionMessage
  | RenderHybridUiTelemetryMessage
  | RenderReadyMessage
  | RenderRecoveryBoundaryMessage
  | SabRingBufferSpikeWorkerResponse;
