import type { GreyboxRenderTelemetry, RenderFrameSample } from "@parallax/engine";
import {
  type GreyboxRenderedOutputEvidence,
  requireGreyboxRenderedOutputEvidence,
  screenshotClearColorRgb,
} from "./greybox-rendered-output.js";

export interface GreyboxWorldEvidence extends GreyboxRenderTelemetry {
  readonly observedLighting: GreyboxObservedLightingEvidence;
  readonly renderedOutput: GreyboxRenderedOutputEvidence;
}

export interface GreyboxObservedLightingEvidence {
  readonly intensityMaximum: number;
  readonly intensityMinimum: number;
  readonly intensityRange: number;
  readonly phaseMaximum: number;
  readonly phaseMinimum: number;
  readonly phaseRange: number;
  readonly sampleCount: number;
}

export function requireGreyboxWorld(
  value: unknown,
  frames: readonly RenderFrameSample[],
  renderedOutput: GreyboxRenderedOutputEvidence,
): GreyboxWorldEvidence {
  const telemetry = requireGreyboxRenderTelemetry(value);
  if (frames.length < 2 || frames.some((frame) => !validLightingSample(frame))) {
    throw new Error("Greybox lighting telemetry requires at least two finite frame samples");
  }
  const observedLighting = createObservedLightingEvidence(frames);
  if (observedLighting.phaseRange <= 1e-6 || observedLighting.intensityRange <= 1e-6) {
    throw new Error("Greybox lighting did not change during the measurement window");
  }
  const validatedOutput = requireGreyboxRenderedOutputEvidence(renderedOutput);
  requireMatchingClearColor(telemetry, validatedOutput);
  return Object.freeze({
    ...telemetry,
    observedLighting,
    renderedOutput: validatedOutput,
  });
}

export function requireGreyboxWorldTelemetry(value: unknown): GreyboxWorldEvidence {
  const telemetry = requireGreyboxRenderTelemetry(value);
  if (!isRecord(value)) throw new Error("Greybox-world evidence is invalid");
  const observedLighting = requireObservedLightingEvidence(value.observedLighting);
  const renderedOutput = requireGreyboxRenderedOutputEvidence(value.renderedOutput);
  requireMatchingClearColor(telemetry, renderedOutput);
  return Object.freeze({ ...telemetry, observedLighting, renderedOutput });
}

function requireMatchingClearColor(
  telemetry: GreyboxRenderTelemetry,
  renderedOutput: GreyboxRenderedOutputEvidence,
): void {
  const expected = screenshotClearColorRgb(telemetry.clearColor);
  if (expected.some((component, index) => renderedOutput.clearColorRgb[index] !== component)) {
    throw new Error("Greybox rendered-output evidence used a different clear color");
  }
}

function createObservedLightingEvidence(
  frames: readonly RenderFrameSample[],
): GreyboxObservedLightingEvidence {
  const phases = frames.map((frame) => frame.lightingPhase);
  const intensities = frames.map((frame) => frame.lightingIntensity);
  const phaseMinimum = Math.min(...phases);
  const phaseMaximum = Math.max(...phases);
  const intensityMinimum = Math.min(...intensities);
  const intensityMaximum = Math.max(...intensities);
  return Object.freeze({
    intensityMaximum,
    intensityMinimum,
    intensityRange: intensityMaximum - intensityMinimum,
    phaseMaximum,
    phaseMinimum,
    phaseRange: phaseMaximum - phaseMinimum,
    sampleCount: frames.length,
  });
}

function requireObservedLightingEvidence(value: unknown): GreyboxObservedLightingEvidence {
  if (!isRecord(value)) throw new Error("Greybox observed-lighting evidence is missing");
  const fields = [
    value.intensityMaximum,
    value.intensityMinimum,
    value.intensityRange,
    value.phaseMaximum,
    value.phaseMinimum,
    value.phaseRange,
  ];
  if (
    fields.some((field) => typeof field !== "number" || !Number.isFinite(field)) ||
    !isPositiveInteger(value.sampleCount) ||
    value.sampleCount < 2 ||
    (value.phaseMinimum as number) < 0 ||
    (value.phaseMaximum as number) >= 1 ||
    (value.phaseMaximum as number) < (value.phaseMinimum as number) ||
    (value.intensityMinimum as number) <= 0 ||
    (value.intensityMaximum as number) > 1 ||
    (value.intensityMaximum as number) < (value.intensityMinimum as number) ||
    (value.phaseRange as number) <= 1e-6 ||
    (value.intensityRange as number) <= 1e-6 ||
    !nearlyEqual(
      value.phaseRange as number,
      (value.phaseMaximum as number) - (value.phaseMinimum as number),
    ) ||
    !nearlyEqual(
      value.intensityRange as number,
      (value.intensityMaximum as number) - (value.intensityMinimum as number),
    )
  ) {
    throw new Error("Greybox observed-lighting evidence is invalid");
  }
  return value as unknown as GreyboxObservedLightingEvidence;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9;
}

function requireGreyboxRenderTelemetry(value: unknown): GreyboxRenderTelemetry {
  if (!isRecord(value)) throw new Error("Render readiness omitted greybox-world telemetry");
  if (
    !isNumberTuple(value.selectedLodCellCounts, 3) ||
    !isNumberTuple(value.clearColor, 4) ||
    !isRecord(value.worldBoundsMeters) ||
    !isNumberTuple(value.worldBoundsMeters.minimum, 3) ||
    !isNumberTuple(value.worldBoundsMeters.maximum, 3)
  ) {
    throw new Error("Greybox-world telemetry does not satisfy the D-090 v1 contract");
  }
  const selectedCellCount = value.selectedLodCellCounts.reduce((total, count) => total + count, 0);
  if (
    value.districtId !== "district-1-surface" ||
    !isInteger(value.cellCount, 256) ||
    !isPositiveInteger(value.colliderCount) ||
    value.heightSampleCount !== 256 * 17 * 17 ||
    value.materialCount !== 8 ||
    !isPositiveInteger(value.renderedFeaturePrimitiveCount) ||
    !isPositiveInteger(value.renderedTerrainPatchCount) ||
    !isPositiveInteger(value.renderedTriangleCount) ||
    selectedCellCount !== value.cellCount ||
    value.selectedLodCellCounts.some((count) => !Number.isInteger(count) || count <= 0) ||
    typeof value.materializationMs !== "number" ||
    !Number.isFinite(value.materializationMs) ||
    value.materializationMs < 0 ||
    typeof value.mainThreadWorldGenerationMs !== "number" ||
    !Number.isFinite(value.mainThreadWorldGenerationMs) ||
    value.mainThreadWorldGenerationMs < 0 ||
    typeof value.mainThreadScenePostMessageMs !== "number" ||
    !Number.isFinite(value.mainThreadScenePostMessageMs) ||
    value.mainThreadScenePostMessageMs < 0 ||
    value.dynamicLighting !== true ||
    value.worldBoundsMeters.minimum[0] !== -2_048 ||
    value.worldBoundsMeters.minimum[1] !== -32 ||
    value.worldBoundsMeters.minimum[2] !== -2_048 ||
    value.worldBoundsMeters.maximum[0] !== 2_048 ||
    value.worldBoundsMeters.maximum[1] !== 256 ||
    value.worldBoundsMeters.maximum[2] !== 2_048
  ) {
    throw new Error("Greybox-world telemetry does not satisfy the D-090 v1 contract");
  }
  return value as unknown as GreyboxRenderTelemetry;
}

function validLightingSample(value: unknown): value is RenderFrameSample {
  if (!isRecord(value)) return false;
  return (
    typeof value.lightingPhase === "number" &&
    Number.isFinite(value.lightingPhase) &&
    value.lightingPhase >= 0 &&
    value.lightingPhase < 1 &&
    typeof value.lightingIntensity === "number" &&
    Number.isFinite(value.lightingIntensity) &&
    value.lightingIntensity > 0 &&
    value.lightingIntensity <= 1
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberTuple(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((component) => typeof component === "number" && Number.isFinite(component))
  );
}

function isInteger(value: unknown, expected: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value === expected;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
