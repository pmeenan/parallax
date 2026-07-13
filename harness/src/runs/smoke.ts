import type { QualityTier } from "../budgets.js";

export interface SmokeMetricDefinition {
  readonly mandatoryForHarnessV1: boolean;
  readonly name: string;
  readonly probe: "implemented" | "incomplete";
}

export interface QualityTierProfile {
  readonly targetDisplayMode: string;
  readonly viewport: Readonly<{ height: number; width: number }>;
}

export const SMOKE_SCENARIO = "smoke@1";
export const SMOKE_REPEATS = 3;
export const SMOKE_WARMUP_MS = 10_000;
export const SMOKE_MEASUREMENT_FRAMES = 120;
export const SMOKE_TELEMETRY_GLOBAL_NAME = "__PARALLAX_TELEMETRY__";
export const SMOKE_TELEMETRY_SCHEMA_VERSION = 1;

export const SMOKE_METRICS: readonly SmokeMetricDefinition[] = Object.freeze([
  metric("compositor presentation interval", true),
  metric("verified gate environment identity", true),
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
      targetDisplayMode: "3840x2160@60Hz",
      viewport: Object.freeze({ height: 2_160, width: 3_840 }),
    }),
    standard: Object.freeze({
      targetDisplayMode: "2560x1440@120Hz",
      viewport: Object.freeze({ height: 1_440, width: 2_560 }),
    }),
  });

export function parseQualityTier(value: string | undefined): QualityTier {
  const candidate = value ?? "showcase";
  if (Object.hasOwn(QUALITY_TIER_PROFILES, candidate)) return candidate as QualityTier;
  throw new Error(`PARALLAX_TIER must be showcase or standard; received ${candidate}`);
}

function metric(name: string, mandatoryForHarnessV1: boolean): SmokeMetricDefinition {
  return Object.freeze({ mandatoryForHarnessV1, name, probe: "incomplete" });
}
