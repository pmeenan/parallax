import type {
  FlythroughCheckpointRenderEvidence,
  GreyboxRenderTelemetry,
  ParallaxTelemetrySnapshot,
  RenderRecoveryProbeKind,
  StreamingRecoveryCheckpoint,
  WorldStreamingTelemetrySnapshot,
  WorldVec3,
} from "@parallax/engine";
import type { MeasuredFlythroughEnvironment } from "./flythrough-run-result.js";
import {
  GREYBOX_MAXIMUM_VISIBLE_PIXEL_RATIO,
  GREYBOX_MINIMUM_VISIBLE_PIXEL_RATIO,
  type GreyboxRenderedOutputEvidence,
  requireGreyboxRenderedOutputEvidence,
} from "./greybox-rendered-output.js";
import {
  RENDER_RECOVERY_COMPLETION_TIMEOUT_MS,
  RENDER_RECOVERY_MINIMUM_MOVEMENT_METERS,
  RENDER_RECOVERY_RESIDENT_CELL_COUNT,
  RENDER_RECOVERY_VERIFICATION_VIEW,
} from "./runs/render-recovery.js";
import { requireSabRingBufferCompleteAtMeasurementBoundary } from "./sab-ring-buffer.js";
import { isSortedUniqueExactStringSet } from "./sorted-exact-string-set.js";
import {
  requireWorldStreamingSnapshot,
  type WorldStreamingSnapshotPolicy,
} from "./streaming-evidence.js";

export type RenderRecoveryAttemptId =
  | "device-loss-recovery"
  | "worker-crash-recovery"
  | "retry-exhaustion";

export interface MeasuredRenderRecoveryEnvironment extends MeasuredFlythroughEnvironment {
  readonly executableSha256: string;
  readonly requestedTier: "showcase" | "standard";
  readonly targetDisplayMode: string;
}

export interface RenderRecoveryBoundary {
  readonly checkpoint: StreamingRecoveryCheckpoint;
  readonly decoderBootstrap: ParallaxTelemetrySnapshot["render"]["decoderBootstrap"];
  readonly decoderFixtures: ParallaxTelemetrySnapshot["render"]["decoderFixtures"];
  readonly frameCount: number;
  readonly flythrough: Readonly<{
    readonly failureMessage: string | null;
    readonly state: ParallaxTelemetrySnapshot["flythrough"]["state"];
  }>;
  readonly greyboxWorld: GreyboxRenderTelemetry | null;
  readonly observers: readonly WorldVec3[];
  readonly renderRecovery: ParallaxTelemetrySnapshot["render"]["recovery"];
  readonly renderState: ParallaxTelemetrySnapshot["render"]["state"];
  readonly residentCellIds: readonly string[];
  readonly sab: ParallaxTelemetrySnapshot["render"]["sabRingBufferSpike"];
  readonly streaming: WorldStreamingTelemetrySnapshot;
}

/** The engine's scene-preview request (`ScenePreviewRequest`), as retained evidence. */
export interface RenderRecoveryViewRequest {
  readonly camera: Readonly<{ beta: number; heightMeters: number; radiusMeters: number }>;
  readonly environment: Readonly<{
    timeOfDay: "dawn" | "daylight" | "dusk" | "night";
    timeOfDayPhase: number;
    weather: "clear" | "overcast" | "storm";
  }>;
  readonly headingRadians: number;
  readonly observer: WorldVec3;
}

/**
 * Post-recovery rendered output, independent of gameplay camera ownership: the recovered
 * renderer previews the pre-fault observer through a fixed view. `render` is the render worker's
 * own readback of that frame; `canvas` is the compositor screenshot of the same preview.
 */
export interface RenderRecoveryVerifiedView {
  readonly canvas: GreyboxRenderedOutputEvidence;
  readonly render: FlythroughCheckpointRenderEvidence;
  readonly request: RenderRecoveryViewRequest;
  readonly residentCellIds: readonly string[];
}

export interface MeasuredRenderRecoveryAttempt {
  readonly afterFirstRecovery: RenderRecoveryBoundary;
  readonly afterSecondFault: RenderRecoveryBoundary | null;
  readonly beforeFault: RenderRecoveryBoundary;
  readonly browserErrors: readonly string[];
  readonly elapsedMs: number;
  readonly firstProbe: RenderRecoveryProbeKind;
  readonly frameCountAfterVisibilityWait: number;
  readonly id: RenderRecoveryAttemptId;
  readonly initial: RenderRecoveryBoundary;
  readonly recoveredView: RenderRecoveryVerifiedView;
  readonly secondProbe: RenderRecoveryProbeKind | null;
}

export type UnfinalizedMeasuredRenderRecoveryAttempt = Omit<
  MeasuredRenderRecoveryAttempt,
  "browserErrors"
>;

export type RenderRecoveryAttempt =
  | Readonly<{
      readonly browserErrors: readonly string[];
      readonly failureMessage: string;
      readonly environment: MeasuredRenderRecoveryEnvironment | null;
      readonly id: RenderRecoveryAttemptId;
      readonly profileLineage: Readonly<{
        readonly history: readonly ["fresh"];
        readonly id: string;
      }>;
      readonly partial: Readonly<{
        readonly afterFirstRecovery: RenderRecoveryBoundary | null;
        readonly afterSecondFault: RenderRecoveryBoundary | null;
        readonly beforeFault: RenderRecoveryBoundary | null;
        readonly elapsedMs: number | null;
        readonly initial: RenderRecoveryBoundary | null;
        readonly latestTelemetry: ParallaxTelemetrySnapshot | null;
        readonly recoveredView: RenderRecoveryVerifiedView | null;
      }>;
      readonly result: null;
      readonly state: "invalid";
    }>
  | Readonly<{
      readonly browserErrors: readonly string[];
      readonly failureMessage: null;
      readonly environment: MeasuredRenderRecoveryEnvironment;
      readonly id: RenderRecoveryAttemptId;
      readonly profileLineage: Readonly<{
        readonly history: readonly ["fresh"];
        readonly id: string;
      }>;
      readonly result: MeasuredRenderRecoveryAttempt;
      readonly state: "measured";
    }>;

export function captureRecoveryBoundary(
  snapshot: ParallaxTelemetrySnapshot,
  exactCheckpoint: StreamingRecoveryCheckpoint | null = snapshot.streaming
    .settledRecoveryCheckpoint,
): RenderRecoveryBoundary {
  if (exactCheckpoint === null) {
    throw new Error("Recovery boundary requires a settled streaming checkpoint");
  }
  return Object.freeze({
    checkpoint: exactCheckpoint,
    decoderBootstrap: snapshot.render.decoderBootstrap,
    decoderFixtures: snapshot.render.decoderFixtures,
    frameCount: snapshot.render.frameCount,
    flythrough: Object.freeze({
      failureMessage: snapshot.flythrough.failureMessage,
      state: snapshot.flythrough.state,
    }),
    greyboxWorld: snapshot.render.greyboxWorld,
    observers: Object.freeze(exactCheckpoint.observers.map(freezeVec3)),
    renderRecovery: snapshot.render.recovery,
    renderState: snapshot.render.state,
    residentCellIds: Object.freeze([...exactCheckpoint.residentCellIds]),
    sab: snapshot.render.sabRingBufferSpike,
    streaming: snapshot.streaming,
  });
}

export function validateRenderRecoveryAttempt(attempt: MeasuredRenderRecoveryAttempt): void {
  const { initial, beforeFault, afterFirstRecovery: recovered } = attempt;
  requireHealthyBoundary(initial, 1, 1, 0, "initial", "measurement-history");
  requireHealthyBoundary(beforeFault, 1, 1, 0, "pre-fault", "measurement-history");
  requireMovedDirectObserver(initial, beforeFault);
  requireHealthyBoundary(recovered, 2, 2, 1, "recovered", "settled-hydration");
  if (
    initial.flythrough.state !== "prepared" ||
    beforeFault.flythrough.state !== "running" ||
    recovered.flythrough.state !== "failed" ||
    recovered.flythrough.failureMessage === null
  ) {
    throw new Error(`${attempt.id} did not retain recovery-invalidated flythrough evidence`);
  }
  if (
    recovered.renderRecovery.state !== "recovered" ||
    recovered.renderRecovery.restartCount !== 1 ||
    recovered.renderRecovery.lastCause !== attempt.firstProbe ||
    recovered.renderRecovery.lastRestartDurationMs === null ||
    !Number.isFinite(recovered.renderRecovery.lastRestartDurationMs) ||
    recovered.renderRecovery.lastRestartDurationMs <= 0 ||
    recovered.renderRecovery.lastRestartDurationMs > RENDER_RECOVERY_COMPLETION_TIMEOUT_MS
  ) {
    throw new Error(`${attempt.id} did not retain a positive bounded first recovery`);
  }
  if (
    JSON.stringify(recovered.observers) !== JSON.stringify(beforeFault.observers) ||
    JSON.stringify(recovered.residentCellIds) !== JSON.stringify(beforeFault.residentCellIds) ||
    recovered.checkpoint.observerUpdateCount !== beforeFault.checkpoint.observerUpdateCount ||
    recovered.checkpoint.flythroughObserverUpdateCount !==
      beforeFault.checkpoint.flythroughObserverUpdateCount
  ) {
    throw new Error(`${attempt.id} did not restore moved observer residency`);
  }
  requireSabRingBufferCompleteAtMeasurementBoundary(recovered.sab);
  if (
    recovered.decoderBootstrap === null ||
    recovered.decoderFixtures === null ||
    recovered.greyboxWorld === null ||
    beforeFault.decoderBootstrap === null ||
    beforeFault.decoderFixtures === null ||
    beforeFault.greyboxWorld === null ||
    !sameDecoderIdentity(recovered, beforeFault) ||
    !sameWorldIdentity(recovered.greyboxWorld, beforeFault.greyboxWorld)
  ) {
    throw new Error(`${attempt.id} did not restore decoder and world telemetry`);
  }
  if (attempt.frameCountAfterVisibilityWait <= recovered.frameCount) {
    throw new Error(`${attempt.id} did not render frames after recovery`);
  }
  requireRecoveredResidentView(attempt.id, attempt.recoveredView, beforeFault);
  if (
    !Number.isFinite(attempt.elapsedMs) ||
    attempt.elapsedMs <= 0 ||
    attempt.elapsedMs > RENDER_RECOVERY_COMPLETION_TIMEOUT_MS
  ) {
    throw new Error(`${attempt.id} recovery driver duration is not positive and bounded`);
  }
  if (attempt.secondProbe === null) {
    if (attempt.afterSecondFault !== null) {
      throw new Error(`${attempt.id} retained unexpected second-fault evidence`);
    }
    if (attempt.browserErrors.length > 0) {
      throw new Error(`${attempt.id} emitted browser errors: ${attempt.browserErrors.join(" | ")}`);
    }
    return;
  }
  const terminal = attempt.afterSecondFault;
  if (
    terminal === null ||
    terminal.renderState !== "failed" ||
    terminal.renderRecovery.state !== "exhausted" ||
    terminal.renderRecovery.restartCount !== 1 ||
    terminal.renderRecovery.workerGeneration !== 2 ||
    terminal.renderRecovery.lastCause !== attempt.secondProbe ||
    terminal.streaming.state !== "failed" ||
    terminal.streaming.renderRecoveryCount !== 1 ||
    terminal.streaming.workerGeneration !== 2 ||
    terminal.checkpoint.workerGeneration !== 2
  ) {
    throw new Error(`${attempt.id} did not fail closed after exhausting its single retry`);
  }
  const terminalErrors = attempt.browserErrors.filter((message) =>
    message.includes("Render worker failed"),
  );
  const unexpectedErrors = attempt.browserErrors.filter(
    (message) => !message.includes("Render worker failed"),
  );
  if (terminalErrors.length === 0 || unexpectedErrors.length > 0) {
    throw new Error(`${attempt.id} did not retain the expected terminal browser error`);
  }
}

function requireRecoveredResidentView(
  id: RenderRecoveryAttemptId,
  view: RenderRecoveryVerifiedView,
  beforeFault: RenderRecoveryBoundary,
): void {
  const { request, render, canvas } = view;
  const expected = RENDER_RECOVERY_VERIFICATION_VIEW;
  if (
    JSON.stringify(request.observer) !== JSON.stringify(beforeFault.observers[0]) ||
    request.headingRadians !== expected.headingRadians ||
    JSON.stringify(request.camera) !== JSON.stringify(expected.camera) ||
    JSON.stringify(request.environment) !== JSON.stringify(expected.environment)
  ) {
    throw new Error(`${id} did not view the pre-fault observer through the fixed recovery view`);
  }
  if (JSON.stringify(view.residentCellIds) !== JSON.stringify(beforeFault.residentCellIds)) {
    throw new Error(`${id} recovery view did not render the pre-fault residency`);
  }
  const target: WorldVec3 = [
    request.observer[0],
    request.observer[1] + expected.camera.heightMeters,
    request.observer[2],
  ];
  // Independent reconstruction of the fixed heading-0 recovery view. The renderer may store
  // camera coordinates as float32, so allow its rounding without admitting another viewpoint.
  const position: WorldVec3 = [
    target[0] - expected.camera.radiusMeters * Math.sin(expected.camera.beta),
    target[1] + expected.camera.radiusMeters * Math.cos(expected.camera.beta),
    target[2],
  ];
  const samePoint = (actual: WorldVec3, wanted: WorldVec3) =>
    actual.length === 3 &&
    actual.every(
      (value, axis) =>
        Number.isFinite(value) && Math.abs(value - (wanted[axis] ?? Number.NaN)) <= 1e-4,
    );
  if (
    !samePoint(render.cameraPosition, position) ||
    !samePoint(render.cameraTarget, target) ||
    render.elapsedMs !== 0 ||
    render.environmentPhaseId !== "visual-preview" ||
    render.environment.id !== "visual-preview" ||
    render.environment.startMs !== 0 ||
    render.environment.endMs !== 1 ||
    render.environment.timeOfDay !== expected.environment.timeOfDay ||
    render.environment.timeOfDayPhase !== expected.environment.timeOfDayPhase ||
    render.environment.weather !== expected.environment.weather
  )
    throw new Error(`${id} recovered readback does not match the fixed recovery view`);
  const ratioInRange = (ratio: number) =>
    Number.isFinite(ratio) &&
    ratio >= GREYBOX_MINIMUM_VISIBLE_PIXEL_RATIO &&
    ratio < GREYBOX_MAXIMUM_VISIBLE_PIXEL_RATIO;
  if (
    render.checkpointId !== "visual-preview" ||
    render.previewVisibleMeshCount !== 0 ||
    render.streamedVisibleMeshCount <= 0 ||
    render.width <= 0 ||
    render.height <= 0 ||
    render.sampledPixelCount !== render.width * render.height ||
    !Number.isSafeInteger(render.visiblePixelCount) ||
    render.visiblePixelCount <= 0 ||
    render.visiblePixelCount > render.sampledPixelCount ||
    Math.abs(render.visiblePixelRatio - render.visiblePixelCount / render.sampledPixelCount) >
      1e-12 ||
    !Number.isFinite(render.clearColorDistanceThreshold) ||
    render.clearColorDistanceThreshold < 2 ||
    render.clearColorDistanceThreshold > 24 ||
    !ratioInRange(render.visiblePixelRatio)
  ) {
    throw new Error(`${id} recovered renderer did not draw its streamed residency`);
  }
  if (
    canvas.width <= 0 ||
    canvas.height <= 0 ||
    canvas.visiblePixelCount <= 0 ||
    !ratioInRange(canvas.visiblePixelRatio) ||
    JSON.stringify(canvas.clearColorRgb) !== JSON.stringify(render.clearColorRgb)
  ) {
    throw new Error(`${id} did not retain visible recovered canvas evidence`);
  }
  requireGreyboxRenderedOutputEvidence(canvas);
}

export function finalizeMeasuredRenderRecoveryAttempt(
  attempt: UnfinalizedMeasuredRenderRecoveryAttempt,
  browserErrors: readonly string[],
): MeasuredRenderRecoveryAttempt {
  const finalized = Object.freeze({
    ...attempt,
    browserErrors: Object.freeze([...browserErrors]),
  });
  validateRenderRecoveryAttempt(finalized);
  return finalized;
}

function requireHealthyBoundary(
  boundary: RenderRecoveryBoundary,
  renderGeneration: number,
  streamingGeneration: number,
  renderRecoveryCount: number,
  label: string,
  streamingPolicy: WorldStreamingSnapshotPolicy,
): void {
  requireWorldStreamingSnapshot(boundary.streaming, streamingPolicy);
  requireSabRingBufferCompleteAtMeasurementBoundary(boundary.sab);
  if (
    boundary.renderState !== "ready" ||
    boundary.renderRecovery.workerGeneration !== renderGeneration ||
    boundary.streaming.state !== "streaming" ||
    boundary.streaming.workerGeneration !== streamingGeneration ||
    boundary.streaming.renderRecoveryCount !== renderRecoveryCount ||
    boundary.streaming.residentCellCount !== RENDER_RECOVERY_RESIDENT_CELL_COUNT ||
    boundary.streaming.residentCellIds.length !== RENDER_RECOVERY_RESIDENT_CELL_COUNT ||
    boundary.streaming.settledObserverUpdateCount !== boundary.streaming.observerUpdateCount ||
    boundary.streaming.flythroughObserverUpdateCount !==
      boundary.checkpoint.flythroughObserverUpdateCount ||
    boundary.checkpoint.workerGeneration !== streamingGeneration ||
    boundary.checkpoint.observerUpdateCount !== boundary.streaming.settledObserverUpdateCount ||
    JSON.stringify(boundary.checkpoint) !==
      JSON.stringify(boundary.streaming.settledRecoveryCheckpoint) ||
    JSON.stringify(boundary.checkpoint.observers) !== JSON.stringify(boundary.observers) ||
    JSON.stringify(boundary.checkpoint.observers) !==
      JSON.stringify(boundary.streaming.currentObservers) ||
    JSON.stringify(boundary.checkpoint.residentCellIds) !==
      JSON.stringify(boundary.residentCellIds) ||
    JSON.stringify(boundary.checkpoint.residentCellIds) !==
      JSON.stringify(boundary.streaming.residentCellIds) ||
    boundary.observers.length === 0 ||
    !isSortedUniqueExactStringSet(
      boundary.checkpoint.residentCellIds,
      RENDER_RECOVERY_RESIDENT_CELL_COUNT,
    )
  ) {
    throw new Error(`${label} render/streaming cohort is not healthy and settled`);
  }
}

function sameDecoderIdentity(left: RenderRecoveryBoundary, right: RenderRecoveryBoundary): boolean {
  if (
    left.decoderBootstrap === null ||
    right.decoderBootstrap === null ||
    left.decoderFixtures === null ||
    right.decoderFixtures === null
  ) {
    return false;
  }
  return (
    JSON.stringify(left.decoderBootstrap.paths) === JSON.stringify(right.decoderBootstrap.paths) &&
    JSON.stringify(left.decoderBootstrap.versions) ===
      JSON.stringify(right.decoderBootstrap.versions) &&
    left.decoderFixtures.draco.faces === right.decoderFixtures.draco.faces &&
    left.decoderFixtures.ktx2.height === right.decoderFixtures.ktx2.height &&
    left.decoderFixtures.ktx2.transcoder === right.decoderFixtures.ktx2.transcoder &&
    left.decoderFixtures.ktx2.width === right.decoderFixtures.ktx2.width &&
    left.decoderFixtures.meshopt.bytes === right.decoderFixtures.meshopt.bytes
  );
}

function sameWorldIdentity(left: GreyboxRenderTelemetry, right: GreyboxRenderTelemetry): boolean {
  return (
    left.cellCount === right.cellCount &&
    JSON.stringify(left.clearColor) === JSON.stringify(right.clearColor) &&
    left.colliderCount === right.colliderCount &&
    left.districtId === right.districtId &&
    left.dynamicLighting === right.dynamicLighting &&
    left.heightSampleCount === right.heightSampleCount &&
    left.lightingModel === right.lightingModel &&
    left.materialCount === right.materialCount &&
    left.renderedFeaturePrimitiveCount === right.renderedFeaturePrimitiveCount &&
    left.renderedTerrainPatchCount === right.renderedTerrainPatchCount &&
    left.renderedTriangleCount === right.renderedTriangleCount &&
    JSON.stringify(left.selectedLodCellCounts) === JSON.stringify(right.selectedLodCellCounts) &&
    JSON.stringify(left.worldBoundsMeters) === JSON.stringify(right.worldBoundsMeters)
  );
}

function requireMovedDirectObserver(
  initial: RenderRecoveryBoundary,
  moved: RenderRecoveryBoundary,
): void {
  const from = initial.observers[0];
  const to = moved.observers[0];
  if (
    from === undefined ||
    to === undefined ||
    moved.streaming.flythroughObserverUpdateCount <=
      initial.streaming.flythroughObserverUpdateCount ||
    moved.streaming.observerUpdateCount <= initial.streaming.observerUpdateCount ||
    moved.streaming.cellLoadSampleCount <= initial.streaming.cellLoadSampleCount ||
    moved.streaming.proactiveEvictionCount <= initial.streaming.proactiveEvictionCount ||
    distance(from, to) < RENDER_RECOVERY_MINIMUM_MOVEMENT_METERS ||
    JSON.stringify(initial.residentCellIds) === JSON.stringify(moved.residentCellIds)
  ) {
    throw new Error(
      "Pre-fault boundary did not prove direct flythrough movement to a new cell set",
    );
  }
}

function distance(left: WorldVec3, right: WorldVec3): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function freezeVec3(value: WorldVec3): WorldVec3 {
  return Object.freeze([...value]) as WorldVec3;
}
