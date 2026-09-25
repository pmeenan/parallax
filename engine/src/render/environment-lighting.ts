import type { EnvironmentTimeOfDayPhase, EnvironmentWeatherState } from "../world/world-contract";

export type LinearRgb = readonly [number, number, number];

export interface EnvironmentLightingSample {
  /** Greybox (Standard) hemispheric ambient intensity. PBR surfaces use `pbrSky`/`pbrGround`. */
  readonly ambientIntensity: number;
  readonly clearColor: LinearRgb;
  /** Pre-tone-mapping exposure: 1 at the calibrated 30° clear day, partly adapting elsewhere. */
  readonly exposure: number;
  readonly groundColor: LinearRgb;
  /** Backward-compatible normalized perceptual aggregate, not a raw light intensity. */
  readonly perceivedIntensity: number;
  /**
   * PBR ambient, as the linear radiance of an unoccluded white Lambert surface facing up (sky)
   * or down (ground bounce). These are Lite light units, calibrated to the paving source's
   * Hosek-Wilkie sky.
   */
  readonly pbrGround: LinearRgb;
  readonly pbrSky: LinearRgb;
  readonly phase: EnvironmentTimeOfDayPhase;
  readonly skyColor: LinearRgb;
  readonly sunColor: LinearRgb;
  readonly sunElevation: number;
  /** Normalized direct-sun fraction in [0, 1]; the applied light is `sunLightIntensity`. */
  readonly sunIntensity: number;
  /** Lite directional-light intensity: `sunIntensity` × SUN_LIGHT_SCALE. */
  readonly sunLightIntensity: number;
  readonly sunDirection: readonly [number, number, number];
  readonly weather: EnvironmentWeatherState;
}

const ANIMATED_ENVIRONMENT_LIGHTING_PHASE_STEPS = 4_096;

// Calibration against the approved paving source's Cycles lighting (engine package 5,
// assets/source/d1-paving/proof-2026-09-24/lighting/calibrate.py). A white Lambert plane under
// the 4.6 W/m² sun shows radiance 4.6·cosθ/π, so the light intensity is 4.6/π in radiance-on-white
// units (Standard materials, the PBR ambient; streamed PBR materials scale direct light by π
// because Lite's PBR divides diffuse by π). The Hosek sky
// (turbidity 2.6, strength 2) gives it luminance 0.0865 at 12° and 0.1284 at 30° elevation, with
// the chroma below (normalized to luminance 1).
export const SUN_LIGHT_SCALE = 4.6 / Math.PI;
const SKY_LUMINANCE_AT_ZERO = 0.0567;
const SKY_LUMINANCE_PER_SINE = 0.1434;
const SKY_CHROMA_LOW = Object.freeze([0.728, 1.04, 1.399] as const);
const SKY_CHROMA_HIGH = Object.freeze([0.662, 1.036, 1.643] as const);
const SKY_CHROMA_HORIZON = Object.freeze([1.08, 0.98, 0.9] as const);
// Moonlit sky: dim and blue, but readable once exposure has adapted.
const NIGHT_SKY_RADIANCE = Object.freeze([0.006, 0.009, 0.018] as const);
const GROUND_BOUNCE_ALBEDO = Object.freeze([0.2, 0.18, 0.15] as const);
// The daylight key (sun on a horizontal plane plus sky) at the calibrated 30° clear view.
const DAYLIGHT_KEY_LUMINANCE = 0.782;
// Partial adaptation keeps storms and nights visibly darker than clear daylight.
const EXPOSURE_ADAPTATION = 0.5;
const EXPOSURE_RANGE = Object.freeze([0.6, 16] as const);

// Bounded shared-light calibration: scale ambient equally across weather states;
// retain sun intensities, colors, and day/night interpolation.
const AMBIENT_CALIBRATION = 0.25 / 0.88;

const WEATHER = Object.freeze({
  clear: Object.freeze({
    ambient: 0.88,
    clearColor: Object.freeze([0.32, 0.64, 0.92] as const),
    direct: 1,
    saturation: 1,
    skyLuminance: 1,
  }),
  overcast: Object.freeze({
    ambient: 0.76,
    clearColor: Object.freeze([0.2, 0.28, 0.38] as const),
    direct: 0.36,
    saturation: 0.56,
    skyLuminance: 1.9,
  }),
  storm: Object.freeze({
    ambient: 0.58,
    clearColor: Object.freeze([0.055, 0.075, 0.11] as const),
    direct: 0.12,
    saturation: 0.28,
    skyLuminance: 0.5,
  }),
} as const);

const DAY_SKY = Object.freeze([0.72, 0.84, 1] as const);
const NIGHT_SKY = Object.freeze([0.16, 0.22, 0.48] as const);
const DAY_GROUND = Object.freeze([0.5, 0.42, 0.32] as const);
const NIGHT_GROUND = Object.freeze([0.1, 0.07, 0.13] as const);
const NIGHT_CLEAR_COLOR = Object.freeze([0.008, 0.014, 0.035] as const);
const STORM_TINT = Object.freeze([0.58, 0.65, 0.76] as const);
const HORIZON_SUN = Object.freeze([1, 0.31, 0.08] as const);
// The source's sun colour, nearly reached by 12° elevation (its grazing view) and held above.
const HIGH_SUN = Object.freeze([1, 0.88, 0.72] as const);

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
  const highSun = smoothstep(0, 0.25, sunElevation);
  const horizonGlow = daylight * (1 - highSun);
  // Cycles holds sun irradiance constant with elevation; only the horizon fade and weather dim it.
  const sunIntensity = weatherProfile.direct * directDaylight;
  const ambientIntensity = weatherProfile.ambient * AMBIENT_CALIBRATION * (0.12 + 0.88 * daylight);
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
  const sunLightIntensity = sunIntensity * SUN_LIGHT_SCALE;
  // Sky radiance on white: the measured Hosek luminance and chroma by elevation, warmed toward
  // the horizon, desaturated and scaled by weather, and fading to a moonlit floor at night.
  const skySine = Math.max(0, sunElevation);
  const skyChroma = mixRgb(
    mixRgb(SKY_CHROMA_HORIZON, SKY_CHROMA_LOW, smoothstep(0, 0.2079, skySine)),
    SKY_CHROMA_HIGH,
    clamp01((skySine - 0.2079) / 0.2921),
  );
  const skyGrey = luminance(skyChroma);
  const weatherChroma = mixRgb([skyGrey, skyGrey, skyGrey], skyChroma, weatherProfile.saturation);
  const skyLuminance =
    (SKY_LUMINANCE_AT_ZERO + SKY_LUMINANCE_PER_SINE * skySine) * weatherProfile.skyLuminance;
  const pbrSky = mixRgb(NIGHT_SKY_RADIANCE, scaleRgb(weatherChroma, skyLuminance), daylight);
  const sunOnGround = scaleRgb(sunColor, sunLightIntensity * directElevation);
  const pbrGround = Object.freeze([
    GROUND_BOUNCE_ALBEDO[0] * ((sunOnGround[0] ?? 0) + (pbrSky[0] ?? 0)),
    GROUND_BOUNCE_ALBEDO[1] * ((sunOnGround[1] ?? 0) + (pbrSky[1] ?? 0)),
    GROUND_BOUNCE_ALBEDO[2] * ((sunOnGround[2] ?? 0) + (pbrSky[2] ?? 0)),
  ] as const);
  const key = luminance(sunOnGround) + luminance(pbrSky);
  const exposure = Math.min(
    EXPOSURE_RANGE[1],
    Math.max(EXPOSURE_RANGE[0], (DAYLIGHT_KEY_LUMINANCE / key) ** EXPOSURE_ADAPTATION),
  );
  return Object.freeze({
    ambientIntensity,
    clearColor,
    exposure,
    groundColor,
    perceivedIntensity: clamp01(ambientIntensity + sunIntensity * 0.12),
    pbrGround,
    pbrSky,
    phase,
    skyColor,
    sunColor,
    sunElevation,
    sunIntensity,
    sunLightIntensity,
    sunDirection,
    weather,
  });
}

function luminance(color: LinearRgb): number {
  return 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
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
