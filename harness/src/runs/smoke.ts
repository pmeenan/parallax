import type { QualityTier } from "../budgets.js";

export interface SmokeMetricDefinition {
  readonly invalidReason?: string;
  readonly mandatoryForHarnessV1: boolean;
  readonly name: string;
  readonly probe: "implemented" | "incomplete";
}

export interface QualityTierProfile {
  readonly refreshRateHz: number;
  readonly renderSurface: Readonly<{ height: number; width: number }>;
  readonly targetDisplayMode: string;
}

export const SMOKE_SCENARIO = "smoke@1";
export const SMOKE_REPEATS = 3;
export const SMOKE_WARMUP_MS = 10_000;
export const SMOKE_MEASUREMENT_FRAMES = 120;
export const SMOKE_PRESENTATION_TRACE_TAIL_MS = 100;
export const SMOKE_PRESENTATION_TRACE_COMPLETION_TIMEOUT_MS = 5_000;
export const SMOKE_TELEMETRY_GLOBAL_NAME = "__PARALLAX_TELEMETRY__";
export const SMOKE_TELEMETRY_SCHEMA_VERSION = 1;

export const SMOKE_METRICS: readonly SmokeMetricDefinition[] = Object.freeze([
  metric(
    "compositor presentation interval",
    true,
    "incomplete",
    "Viz trace callbacks omit PresentationFeedback.kFailure, so scan-out success is unobservable",
  ),
  metric("verified gate environment identity", true, "implemented"),
  metric("all-worker JS heap", false),
  metric("attributable GPU memory", false),
  metric("Dawn pipeline compile/cache evidence", true),
  metric("V8 code-cache evidence", true),
]);

export const SMOKE_INCOMPLETE_METRICS: readonly SmokeMetricDefinition[] = Object.freeze(
  SMOKE_METRICS.filter((metric) => metric.probe === "incomplete"),
);

export const QUALITY_TIER_PROFILES: Readonly<Record<QualityTier, QualityTierProfile>> =
  Object.freeze({
    showcase: Object.freeze({
      refreshRateHz: 60,
      renderSurface: Object.freeze({ height: 2_160, width: 3_840 }),
      targetDisplayMode: "3840x2160@60Hz",
    }),
    standard: Object.freeze({
      refreshRateHz: 120,
      renderSurface: Object.freeze({ height: 1_440, width: 2_560 }),
      targetDisplayMode: "2560x1440@120Hz",
    }),
  });

export function parseQualityTier(value: string | undefined): QualityTier {
  const candidate = value ?? "showcase";
  if (Object.hasOwn(QUALITY_TIER_PROFILES, candidate)) return candidate as QualityTier;
  throw new Error(`PARALLAX_TIER must be showcase or standard; received ${candidate}`);
}

export function renderSurfaceMismatch(
  tier: QualityTier,
  surface: Readonly<{ height: number; width: number }>,
  tolerancePixels: number,
): string | null {
  const expected = QUALITY_TIER_PROFILES[tier].renderSurface;
  if (
    Math.abs(surface.width - expected.width) <= tolerancePixels &&
    Math.abs(surface.height - expected.height) <= tolerancePixels
  ) {
    return null;
  }
  return `render surface expected ${expected.width}x${expected.height}±${tolerancePixels} pixels, received ${surface.width}x${surface.height}`;
}

function metric(
  name: string,
  mandatoryForHarnessV1: boolean,
  probe: SmokeMetricDefinition["probe"] = "incomplete",
  invalidReason?: string,
): SmokeMetricDefinition {
  return Object.freeze(
    invalidReason === undefined
      ? { mandatoryForHarnessV1, name, probe }
      : { invalidReason, mandatoryForHarnessV1, name, probe },
  );
}
