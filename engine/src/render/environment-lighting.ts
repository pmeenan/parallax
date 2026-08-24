import type { EnvironmentTimeOfDayPhase, EnvironmentWeatherState } from "../world/world-contract";

export type LinearRgb = readonly [number, number, number];

export interface EnvironmentLightingSample {
  readonly ambientIntensity: number;
  readonly clearColor: LinearRgb;
  readonly groundColor: LinearRgb;
  /** Backward-compatible normalized perceptual aggregate, not a raw light intensity. */
  readonly perceivedIntensity: number;
  readonly phase: EnvironmentTimeOfDayPhase;
  readonly skyColor: LinearRgb;
  readonly sunColor: LinearRgb;
  readonly sunElevation: number;
  readonly sunIntensity: number;
  readonly sunDirection: readonly [number, number, number];
  readonly weather: EnvironmentWeatherState;
}

const ANIMATED_ENVIRONMENT_LIGHTING_PHASE_STEPS = 4_096;

const WEATHER = Object.freeze({
  clear: Object.freeze({
    ambient: 0.88,
    clearColor: Object.freeze([0.32, 0.64, 0.92] as const),
    direct: 1,
    saturation: 1,
  }),
  overcast: Object.freeze({
    ambient: 0.76,
    clearColor: Object.freeze([0.2, 0.28, 0.38] as const),
    direct: 0.36,
    saturation: 0.56,
  }),
  storm: Object.freeze({
    ambient: 0.58,
    clearColor: Object.freeze([0.055, 0.075, 0.11] as const),
    direct: 0.12,
    saturation: 0.28,
  }),
} as const);

const DAY_SKY = Object.freeze([0.72, 0.84, 1] as const);
const NIGHT_SKY = Object.freeze([0.16, 0.22, 0.48] as const);
const DAY_GROUND = Object.freeze([0.5, 0.42, 0.32] as const);
const NIGHT_GROUND = Object.freeze([0.1, 0.07, 0.13] as const);
const NIGHT_CLEAR_COLOR = Object.freeze([0.008, 0.014, 0.035] as const);
const STORM_TINT = Object.freeze([0.58, 0.65, 0.76] as const);
const HORIZON_SUN = Object.freeze([1, 0.31, 0.08] as const);
const HIGH_SUN = Object.freeze([1, 0.93, 0.78] as const);

/**
 * Evaluates renderer-owned, fully dynamic environment-lighting inputs. The sample is
 * deterministic so the render worker and visual harness can evaluate identical states.
 */
export function sampleEnvironmentLighting(
  phase: EnvironmentTimeOfDayPhase,
  weather: EnvironmentWeatherState,
): EnvironmentLightingSample {
  validateEnvironmentLightingPhase(phase);
  const weatherProfile = WEATHER[weather];
  const solarAngle = phase * Math.PI * 2;
  const sunElevation = Math.sin(solarAngle);
  const daylight = smoothstep(-0.08, 0.18, sunElevation);
  const directElevation = sunElevation <= Number.EPSILON ? 0 : sunElevation;
  const directDaylight = smoothstep(0, 0.18, directElevation);
  const highSun = smoothstep(0.04, 0.78, sunElevation);
  const horizonGlow = daylight * (1 - highSun);
  const sunIntensity = weatherProfile.direct * directDaylight * (0.2 + 0.8 * directElevation);
  const ambientIntensity = weatherProfile.ambient * (0.12 + 0.88 * daylight);
  const skyDay = mixRgb(STORM_TINT, DAY_SKY, weatherProfile.saturation);
  const skyColor = mixRgb(NIGHT_SKY, skyDay, daylight);
  const groundDay = mixRgb(STORM_TINT, DAY_GROUND, weatherProfile.saturation);
  const groundColor = mixRgb(NIGHT_GROUND, groundDay, daylight);
  const sunColor = mixRgb(HORIZON_SUN, HIGH_SUN, highSun);
  const clearColor = scaleRgb(
    mixRgb(NIGHT_CLEAR_COLOR, weatherProfile.clearColor, daylight),
    0.42 + 0.58 * daylight + horizonGlow * 0.08,
  );
  const sunDirection = normalizeDirection(-Math.cos(solarAngle), -sunElevation, 0);
  return Object.freeze({
    ambientIntensity,
    clearColor,
    groundColor,
    perceivedIntensity: clamp01(ambientIntensity + sunIntensity * 0.12),
    phase,
    skyColor,
    sunColor,
    sunElevation,
    sunIntensity,
    sunDirection,
    weather,
  });
}

/**
 * Quantizes the autonomous day cycle to sub-tenth-degree solar steps. Authored
 * flythrough phases remain exact and bypass this policy because each validated segment
 * holds a piecewise-constant phase.
 */
export function quantizeAnimatedEnvironmentLightingPhase(
  phase: EnvironmentTimeOfDayPhase,
): EnvironmentTimeOfDayPhase {
  validateEnvironmentLightingPhase(phase);
  return (
    Math.floor(phase * ANIMATED_ENVIRONMENT_LIGHTING_PHASE_STEPS) /
    ANIMATED_ENVIRONMENT_LIGHTING_PHASE_STEPS
  );
}

function validateEnvironmentLightingPhase(phase: EnvironmentTimeOfDayPhase): void {
  if (!Number.isFinite(phase) || phase < 0 || phase >= 1) {
    throw new Error("Environment lighting phase must be finite and within [0, 1)");
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function mixRgb(left: LinearRgb, right: LinearRgb, amount: number): LinearRgb {
  return Object.freeze([
    left[0] + (right[0] - left[0]) * amount,
    left[1] + (right[1] - left[1]) * amount,
    left[2] + (right[2] - left[2]) * amount,
  ]);
}

function normalizeDirection(x: number, y: number, z: number): readonly [number, number, number] {
  const inverseLength = 1 / Math.hypot(x, y, z);
  return Object.freeze([x * inverseLength, y * inverseLength, z * inverseLength]);
}

function scaleRgb(color: LinearRgb, scale: number): LinearRgb {
  return Object.freeze([color[0] * scale, color[1] * scale, color[2] * scale]);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
