import type {
  GreyboxRenderTelemetry,
  ParallaxTelemetrySnapshot,
  RenderRecoveryProbeKind,
  StreamingRecoveryCheckpoint,
  WorldStreamingTelemetrySnapshot,
  WorldVec3,
} from "@parallax/engine";
import type { MeasuredFlythroughEnvironment } from "./flythrough-run-result.js";
import type { GreyboxRenderedOutputEvidence } from "./greybox-rendered-output.js";
import {
  RENDER_RECOVERY_COMPLETION_TIMEOUT_MS,
  RENDER_RECOVERY_MINIMUM_MOVEMENT_METERS,
  RENDER_RECOVERY_RESIDENT_CELL_COUNT,
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
  readonly secondProbe: RenderRecoveryProbeKind | null;
  readonly visibleCanvas: GreyboxRenderedOutputEvidence;
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
        readonly visibleCanvas: GreyboxRenderedOutputEvidence | null;
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
  if (
    attempt.visibleCanvas.width <= 0 ||
    attempt.visibleCanvas.height <= 0 ||
    attempt.visibleCanvas.visiblePixelCount <= 0
  ) {
    throw new Error(`${attempt.id} did not retain visible canvas evidence`);
  }
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
