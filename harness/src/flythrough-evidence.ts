import {
  FLYTHROUGH_TELEMETRY_SCHEMA_VERSION,
  type FlythroughCheckpointRenderEvidence,
  type FlythroughScenario,
  type FlythroughTelemetrySnapshot,
  minimumObservedFlythroughRouteSpan,
} from "@parallax/engine";
import {
  FLYTHROUGH_D1_DISTANCE_METERS,
  FLYTHROUGH_D1_DURATION_MS,
  FLYTHROUGH_D1_EXPECTED_SCENARIO,
  FLYTHROUGH_D1_PHASE_IDS,
  FLYTHROUGH_D1_SCENARIO,
} from "./runs/flythrough-d1.js";

export interface FlythroughEvidence extends FlythroughTelemetrySnapshot {
  readonly checkpointEvidence: readonly FlythroughCheckpointRenderEvidence[];
  readonly render: NonNullable<FlythroughTelemetrySnapshot["render"]>;
}

export function requireFlythroughEvidence(value: unknown): FlythroughEvidence {
  if (!record(value)) throw new Error("Flythrough telemetry is missing");
  const telemetry = value as unknown as FlythroughTelemetrySnapshot;
  const render = telemetry.render;
  const minimumRouteSpan = minimumObservedFlythroughRouteSpan(FLYTHROUGH_D1_EXPECTED_SCENARIO);
  if (
    telemetry.schemaVersion !== FLYTHROUGH_TELEMETRY_SCHEMA_VERSION ||
    telemetry.state !== "completed" ||
    telemetry.failureMessage !== null ||
    telemetry.scenarioId !== FLYTHROUGH_D1_SCENARIO ||
    telemetry.validation.scenarioId !== FLYTHROUGH_D1_SCENARIO ||
    telemetry.validation.durationMs !== FLYTHROUGH_D1_DURATION_MS ||
    telemetry.validation.distanceMeters !== FLYTHROUGH_D1_DISTANCE_METERS ||
    !arrayEquals(telemetry.validation.environmentPhaseIds, FLYTHROUGH_D1_PHASE_IDS) ||
    render === null ||
    render.state !== "completed" ||
    render.scenarioId !== FLYTHROUGH_D1_SCENARIO ||
    !exactScenario(render.scenario, FLYTHROUGH_D1_EXPECTED_SCENARIO) ||
    render.completedElapsedMs !== FLYTHROUGH_D1_DURATION_MS ||
    render.completedDistanceMeters !== FLYTHROUGH_D1_DISTANCE_METERS ||
    !arrayEquals(render.finalObserver, FLYTHROUGH_D1_EXPECTED_SCENARIO.path.at(-1) ?? []) ||
    !arrayEquals(render.environmentPhaseOrder, FLYTHROUGH_D1_PHASE_IDS) ||
    render.frameCount <= 0 ||
    render.previewVisibleFrameCount !== 0 ||
    render.streamedPresentationFrameCount !== render.frameCount ||
    render.minimumVisibleStreamingMeshCount <= 0 ||
    render.observerUpdateCount < 8_000 ||
    !validDistribution(render.callbackIntervalMs, render.frameCount - 1) ||
    !validDistribution(render.renderDurationMs, render.frameCount) ||
    !validBounds(render.cameraTargetMinimum, render.cameraTargetMaximum) ||
    !validBounds(render.cameraPositionMinimum, render.cameraPositionMaximum) ||
    Object.values(render.environmentFrameCounts).reduce((sum, count) => sum + count, 0) !==
      render.frameCount ||
    FLYTHROUGH_D1_PHASE_IDS.some(
      (phaseId) => !positiveInteger(render.environmentFrameCounts[phaseId]),
    ) ||
    minimumRouteSpan.some(
      (minimum, axis) =>
        axisRange(render.cameraTargetMinimum, render.cameraTargetMaximum, axis as 0 | 1 | 2) <
        minimum,
    ) ||
    minimumRouteSpan.some(
      (minimum, axis) =>
        axisRange(render.cameraPositionMinimum, render.cameraPositionMaximum, axis as 0 | 1 | 2) <
        minimum,
    ) ||
    telemetry.streamingAtMeasurementStart === null ||
    telemetry.streamingAtMeasurementEnd === null ||
    telemetry.streamingAtMeasurementEnd.flythroughObserverUpdateCount -
      telemetry.streamingAtMeasurementStart.flythroughObserverUpdateCount !==
      render.observerUpdateCount ||
    telemetry.streamingAtMeasurementEnd.observerUpdateCount -
      telemetry.streamingAtMeasurementStart.observerUpdateCount !==
      render.observerUpdateCount ||
    telemetry.streamingAtMeasurementEnd.settledObserverUpdateCount <
      telemetry.streamingAtMeasurementEnd.observerUpdateCount
  ) {
    throw new Error("Flythrough telemetry does not satisfy the flythrough-d1@1 contract");
  }
  requireCheckpointEvidence(telemetry.checkpointEvidence);
  return telemetry as FlythroughEvidence;
}

function requireCheckpointEvidence(
  checkpoints: readonly FlythroughCheckpointRenderEvidence[],
): void {
  if (checkpoints.length !== FLYTHROUGH_D1_PHASE_IDS.length) {
    throw new Error(
      `Flythrough checkpoint count=${checkpoints.length}; expected ${FLYTHROUGH_D1_PHASE_IDS.length}`,
    );
  }
  for (const [index, checkpoint] of checkpoints.entries()) {
    const phaseId = FLYTHROUGH_D1_PHASE_IDS[index];
    const phase = FLYTHROUGH_D1_EXPECTED_SCENARIO.environmentPhases[index];
    if (phaseId === undefined || phase === undefined) {
      throw new Error(`Flythrough checkpoint ${index} has no expected phase`);
    }
    const label = `Flythrough checkpoint ${index} (${phaseId})`;
    if (checkpoint.checkpointId !== phaseId) {
      throw new Error(`${label} checkpointId=${checkpoint.checkpointId}`);
    }
    if (checkpoint.environmentPhaseId !== phaseId) {
      throw new Error(`${label} environmentPhaseId=${checkpoint.environmentPhaseId}`);
    }
    if (!exactPhase(checkpoint.environment, phase)) {
      throw new Error(`${label} environment does not match the expected phase`);
    }
    if (
      !validVector3(checkpoint.cameraPosition) ||
      !validVector3(checkpoint.cameraTarget) ||
      !validVector3(checkpoint.clearColorRgb)
    ) {
      throw new Error(`${label} camera/color vectors must contain exactly three finite numbers`);
    }
    const expectedElapsedMs =
      checkpoint.environment.startMs +
      (checkpoint.environment.endMs - checkpoint.environment.startMs) / 2;
    if (checkpoint.elapsedMs !== expectedElapsedMs) {
      throw new Error(`${label} elapsedMs=${checkpoint.elapsedMs}; expected ${expectedElapsedMs}`);
    }
    if (checkpoint.previewVisibleMeshCount !== 0) {
      throw new Error(
        `${label} previewVisibleMeshCount=${checkpoint.previewVisibleMeshCount}; expected 0`,
      );
    }
    if (checkpoint.streamedVisibleMeshCount <= 0) {
      throw new Error(
        `${label} streamedVisibleMeshCount=${checkpoint.streamedVisibleMeshCount}; expected positive`,
      );
    }
    if (
      checkpoint.width <= 0 ||
      checkpoint.height <= 0 ||
      checkpoint.sampledPixelCount !== checkpoint.width * checkpoint.height
    ) {
      throw new Error(
        `${label} sampledPixelCount=${checkpoint.sampledPixelCount}, dimensions=${checkpoint.width}x${checkpoint.height}`,
      );
    }
    if (
      !Number.isFinite(checkpoint.visiblePixelRatio) ||
      checkpoint.visiblePixelRatio < 0.1 ||
      checkpoint.visiblePixelRatio >= 0.999
    ) {
      throw new Error(
        `${label} visiblePixelRatio=${checkpoint.visiblePixelRatio}; expected 0.1..<0.999`,
      );
    }
    if (!/^[0-9a-f]{64}$/.test(checkpoint.rgbaSha256)) {
      throw new Error(`${label} rgbaSha256 is invalid`);
    }
  }
  if (new Set(checkpoints.map((checkpoint) => checkpoint.rgbaSha256)).size !== checkpoints.length) {
    throw new Error("Flythrough rendered checkpoints did not produce distinct output");
  }
}

function exactScenario(
  actual: FlythroughScenario,
  expected: typeof FLYTHROUGH_D1_EXPECTED_SCENARIO,
): boolean {
  return (
    actual.schemaVersion === expected.schemaVersion &&
    actual.id === expected.id &&
    actual.durationMs === expected.durationMs &&
    actual.speedMetersPerSecond === expected.speedMetersPerSecond &&
    actual.camera.beta === expected.camera.beta &&
    actual.camera.heightMeters === expected.camera.heightMeters &&
    actual.camera.radiusMeters === expected.camera.radiusMeters &&
    actual.path.length === expected.path.length &&
    actual.path.every((point, index) => arrayEquals(point, expected.path[index] ?? [])) &&
    actual.environmentPhases.length === expected.environmentPhases.length &&
    actual.environmentPhases.every((phase, index) =>
      exactPhase(phase, expected.environmentPhases[index]),
    )
  );
}

function exactPhase(
  actual: FlythroughCheckpointRenderEvidence["environment"],
  expected: (typeof FLYTHROUGH_D1_EXPECTED_SCENARIO.environmentPhases)[number] | undefined,
): boolean {
  return (
    expected !== undefined &&
    actual.id === expected.id &&
    actual.startMs === expected.startMs &&
    actual.endMs === expected.endMs &&
    actual.weather === expected.weather &&
    actual.timeOfDay === expected.timeOfDay &&
    actual.timeOfDayPhase === expected.timeOfDayPhase
  );
}

function validDistribution(
  value: Readonly<{
    maximum: number;
    p50: number;
    p95: number;
    p999: number;
    sampleCount: number;
  }>,
  expectedSampleCount: number,
): boolean {
  return (
    value.sampleCount === expectedSampleCount &&
    [value.p50, value.p95, value.p999, value.maximum].every(
      (sample) => Number.isFinite(sample) && sample >= 0,
    ) &&
    value.p50 <= value.p95 &&
    value.p95 <= value.p999 &&
    value.p999 <= value.maximum
  );
}

function axisRange(
  minimum: readonly [number, number, number],
  maximum: readonly [number, number, number],
  axis: 0 | 1 | 2,
): number {
  return maximum[axis] - minimum[axis];
}

function validBounds(minimum: unknown, maximum: unknown): boolean {
  return (
    validVector3(minimum) &&
    validVector3(maximum) &&
    minimum[0] <= maximum[0] &&
    minimum[1] <= maximum[1] &&
    minimum[2] <= maximum[2]
  );
}

function validVector3(value: unknown): value is readonly [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((component) => typeof component === "number" && Number.isFinite(component))
  );
}

function arrayEquals(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
