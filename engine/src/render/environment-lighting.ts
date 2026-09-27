import type { EnvironmentTimeOfDayPhase, EnvironmentWeatherState } from "../world/world-contract";
import { PBR_SKY_SHAPE_TERMS } from "./pbr-ambient";

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
  /**
   * How the sky dome's irradiance varies with a surface's orientation, relative to `pbrSky` (the
   * up-facing value), in the sun's frame: coefficients of 1, y, y^2, h, h*y, s^2, h^2*y^2, s^4 and
   * h^3*y for each channel (27 values, coefficient-major), where y is the normal's up component, h
   * its component toward the sun's horizontal direction and s across it. Calibrated against the
   * source's Hosek-Wilkie sky (engine package 7); a uniform dome is (1 + y) / 2.
   */
  readonly pbrSkyShape: readonly number[];
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
// because Lite's PBR divides diffuse by π).
export const SUN_LIGHT_SCALE = 4.6 / Math.PI;
// The clear Hosek sky (turbidity 2.6, strength 2) on an upward white Lambert surface, by sun
// elevation in degrees: radiance on white (r, g, b), measured in Cycles
// (assets/source/d1-walls/proof-2026-09-27/lighting/calibrate.py). Engine package 5's fit to the
// 12° and 30° points ran 9-29% bright above 38°. The 0° row is the warm twilight anchor.
const CLEAR_SKY_BY_ELEVATION: readonly (readonly number[])[] = Object.freeze([
  Object.freeze([0, 0.0612, 0.0556, 0.051] as const),
  Object.freeze([3, 0.0386, 0.0453, 0.046] as const),
  Object.freeze([8, 0.0539, 0.0736, 0.0919] as const),
  Object.freeze([12, 0.0624, 0.0892, 0.1211] as const),
  Object.freeze([20, 0.0747, 0.112, 0.1669] as const),
  Object.freeze([30, 0.0844, 0.1318, 0.2102] as const),
  Object.freeze([38, 0.0884, 0.1426, 0.2374] as const),
  Object.freeze([50, 0.0908, 0.1527, 0.2668] as const),
  Object.freeze([65, 0.096, 0.1616, 0.2873] as const),
  Object.freeze([80, 0.1076, 0.1715, 0.295] as const),
]);
// Moonlit sky: dim and blue, but readable once exposure has adapted.
const NIGHT_SKY_RADIANCE = Object.freeze([0.006, 0.009, 0.018] as const);
// The ground that bounces light onto walls: the admitted D1 paving's mean linear albedo (engine
// package 7; D-205 used a neutral 0.2, which left vertical surfaces dark and cool against Cycles).
export const GROUND_BOUNCE_ALBEDO = Object.freeze([0.3187, 0.2547, 0.1668] as const);
// Sky-dome shape by sun elevation (degrees), fitted to the source's Hosek-Wilkie sky integrated
// over 801 normals and to its Cycles probes
// (assets/source/d1-walls/proof-2026-09-27/lighting/fit.py): per elevation, the coefficients of
// 1, y, y^2, h, h*y, s^2, h^2*y^2, s^4, h^3*y, each as (r, g, b), relative to the up-facing sky. Every Cycles probe is within 2.3%, and walls within 3.6% of the integral at every
// elevation. A vertical wall sees 1.3-1.5x half the zenith sky from the brighter, whiter horizon,
// more on the sun's side.
const SKY_SHAPE_BY_ELEVATION: readonly (readonly number[])[] = Object.freeze([
  Object.freeze([
    3, 1.21089, 0.92197, 0.6613, 0.49865, 0.49963, 0.50047, -0.70942, -0.42154, -0.1618, 0.35727,
    0.16697, 0.0582, 0.18561, 0.09159, 0.03957, -0.2236, -0.12768, -0.07777, 0.36049, 0.16013,
    0.00282, -0.11798, -0.04489, 0.01375, -0.17502, -0.07864, -0.02253,
  ] as const),
  Object.freeze([
    8, 1.29249, 1.00756, 0.73361, 0.49853, 0.49941, 0.50019, -0.7909, -0.50689, -0.2338, 0.45638,
    0.2226, 0.07531, 0.25588, 0.13061, 0.05129, -0.27981, -0.16299, -0.08894, 0.40511, 0.21634,
    0.05323, -0.13709, -0.06756, -0.00759, -0.23384, -0.11614, -0.03745,
  ] as const),
  Object.freeze([
    12, 1.26409, 1.02015, 0.76239, 0.49865, 0.49939, 0.50008, -0.76262, -0.51945, -0.26246, 0.46697,
    0.24543, 0.09165, 0.28011, 0.15458, 0.06565, -0.27688, -0.17026, -0.0936, 0.37791, 0.2221,
    0.07262, -0.13144, -0.07236, -0.0168, -0.24257, -0.13105, -0.04783,
  ] as const),
  Object.freeze([
    20, 1.14854, 0.98296, 0.77435, 0.49893, 0.49943, 0.49998, -0.64736, -0.4823, -0.27429, 0.41729,
    0.24259, 0.10891, 0.28747, 0.17517, 0.0862, -0.23165, -0.15316, -0.08854, 0.28511, 0.19148,
    0.08017, -0.10687, -0.06657, -0.02325, -0.21441, -0.12679, -0.05464,
  ] as const),
  Object.freeze([
    30, 1.01286, 0.90724, 0.75156, 0.49902, 0.49942, 0.49992, -0.51174, -0.40655, -0.25143, 0.32919,
    0.20658, 0.10844, 0.2644, 0.171, 0.09384, -0.16186, -0.11146, -0.06906, 0.19139, 0.14265,
    0.06858, -0.0836, -0.05612, -0.02373, -0.1503, -0.09363, -0.04561,
  ] as const),
  Object.freeze([
    38, 0.93041, 0.8495, 0.72439, 0.49903, 0.49943, 0.4999, -0.42928, -0.34881, -0.22424, 0.27024,
    0.17517, 0.09898, 0.23622, 0.15601, 0.08989, -0.10694, -0.07507, -0.05012, 0.14731, 0.11307,
    0.05752, -0.0765, -0.05212, -0.02377, -0.09717, -0.06263, -0.03272,
  ] as const),
  Object.freeze([
    50, 0.8364, 0.7771, 0.68461, 0.49885, 0.49936, 0.49986, -0.33505, -0.27632, -0.1844, 0.20086,
    0.13317, 0.08042, 0.18651, 0.1254, 0.07621, -0.03468, -0.02708, -0.0237, 0.12586, 0.0925,
    0.04941, -0.07241, -0.04886, -0.02362, -0.036, -0.02488, -0.01466,
  ] as const),
  Object.freeze([
    65, 0.73687, 0.70733, 0.64494, 0.49884, 0.49934, 0.49983, -0.23549, -0.20653, -0.1447, 0.12067,
    0.08573, 0.05615, 0.11337, 0.08162, 0.05394, 0.0333, 0.01911, 0.00424, 0.13217, 0.09398,
    0.05168, -0.07025, -0.0487, -0.02506, 0.00567, 0.0021, -0.00088,
  ] as const),
  Object.freeze([
    80, 0.66585, 0.6628, 0.621, 0.49897, 0.49934, 0.49982, -0.1646, -0.16199, -0.12074, 0.04151,
    0.03724, 0.02697, 0.03935, 0.0353, 0.02581, 0.06551, 0.04838, 0.02457, 0.14675, 0.11068,
    0.05971, -0.06461, -0.0493, -0.02636, 0.00951, 0.00498, 0.00075,
  ] as const),
]);
// A uniform dome, (1 + y) / 2: the shape weather and night fade toward.
const UNIFORM_SKY_SHAPE = Object.freeze([
  0.5,
  0.5,
  0.5,
  0.5,
  0.5,
  0.5,
  ...Array<number>(3 * (PBR_SKY_SHAPE_TERMS - 2)).fill(0),
]);
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
  // Sky radiance on white: the measured clear Hosek sky by elevation, desaturated and scaled by
  // weather, and fading to a moonlit floor at night.
  const clearSky = atElevation(CLEAR_SKY_BY_ELEVATION, degrees(Math.max(0, sunElevation)));
  const clearRgb: LinearRgb = [clearSky[0] ?? 0, clearSky[1] ?? 0, clearSky[2] ?? 0];
  const clearLuminance = luminance(clearRgb);
  const skyChroma = scaleRgb(clearRgb, 1 / clearLuminance);
  const skyGrey = luminance(skyChroma);
  const weatherChroma = mixRgb([skyGrey, skyGrey, skyGrey], skyChroma, weatherProfile.saturation);
  const skyLuminance = clearLuminance * weatherProfile.skyLuminance;
  const pbrSky = mixRgb(NIGHT_SKY_RADIANCE, scaleRgb(weatherChroma, skyLuminance), daylight);
  const sunOnGround = scaleRgb(sunColor, sunLightIntensity * directElevation);
  // The measured shape holds for the clear sky with the sun up; weather and night flatten it toward
  // a uniform dome as the direct sun fades (overcast and storm skies have no circumsolar lobe).
  const skyShape = atElevation(SKY_SHAPE_BY_ELEVATION, degrees(directElevation));
  const shapeWeight = weatherProfile.direct * directDaylight;
  const pbrSkyShape = Object.freeze(
    skyShape.map(
      (value, index) =>
        (UNIFORM_SKY_SHAPE[index] ?? 0) + shapeWeight * (value - (UNIFORM_SKY_SHAPE[index] ?? 0)),
    ),
  );
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
    pbrSkyShape,
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

/** Linear interpolation in a table of [elevation degrees, ...values] rows, clamped at its ends. */
function atElevation(table: readonly (readonly number[])[], elevationDegrees: number): number[] {
  const first = table[0] ?? [];
  const last = table[table.length - 1] ?? [];
  if (elevationDegrees <= (first[0] ?? 0)) return first.slice(1);
  if (elevationDegrees >= (last[0] ?? 90)) return last.slice(1);
  let index = 0;
  while (index < table.length - 2 && elevationDegrees > ((table[index + 1] ?? [])[0] ?? 90))
    index++;
  const low = table[index] ?? [];
  const high = table[index + 1] ?? [];
  const t = (elevationDegrees - (low[0] ?? 0)) / ((high[0] ?? 1) - (low[0] ?? 0));
  return low.slice(1).map((value, i) => value + t * ((high[i + 1] ?? 0) - value));
}

/** Elevation in degrees from its sine. */
function degrees(sine: number): number {
  return (Math.asin(Math.max(-1, Math.min(1, sine))) * 180) / Math.PI;
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
