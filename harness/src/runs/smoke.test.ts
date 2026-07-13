import {
  type ParallaxTelemetrySnapshot,
  TELEMETRY_GLOBAL_NAME,
  TELEMETRY_SCHEMA_VERSION,
} from "@parallax/engine";
import { describe, expect, it } from "vitest";
import {
  parseQualityTier,
  QUALITY_TIER_PROFILES,
  SMOKE_INCOMPLETE_METRICS,
  SMOKE_METRICS,
  SMOKE_TELEMETRY_GLOBAL_NAME,
  SMOKE_TELEMETRY_SCHEMA_VERSION,
} from "./smoke.js";

const expectedSchemaVersion: ParallaxTelemetrySnapshot["schemaVersion"] =
  SMOKE_TELEMETRY_SCHEMA_VERSION;

describe("smoke@1 contract", () => {
  it("stays synchronized with the public engine telemetry contract", () => {
    expect(SMOKE_TELEMETRY_GLOBAL_NAME).toBe(TELEMETRY_GLOBAL_NAME);
    expect(expectedSchemaVersion).toBe(TELEMETRY_SCHEMA_VERSION);
  });

  it("accounts for every mandatory metric in its single registry", () => {
    const mandatory = SMOKE_METRICS.filter((metric) => metric.mandatoryForHarnessV1);
    expect(mandatory.length).toBeGreaterThan(0);
    expect(new Set(SMOKE_METRICS.map((metric) => metric.name)).size).toBe(SMOKE_METRICS.length);
    expect(SMOKE_INCOMPLETE_METRICS.every((metric) => SMOKE_METRICS.includes(metric))).toBe(true);
  });

  it("owns exhaustive tier profiles", () => {
    expect(parseQualityTier(undefined)).toBe("showcase");
    expect(parseQualityTier("standard")).toBe("standard");
    expect(() => parseQualityTier("future-tier")).toThrow("showcase or standard");
    expect(Object.keys(QUALITY_TIER_PROFILES).sort()).toEqual(["showcase", "standard"]);
  });
});
