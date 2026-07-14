import {
  type ParallaxTelemetrySnapshot,
  TELEMETRY_GLOBAL_NAME,
  TELEMETRY_SCHEMA_VERSION,
} from "@parallax/engine";
import { describe, expect, it } from "vitest";
import {
  parseQualityTier,
  QUALITY_TIER_PROFILES,
  renderSurfaceMismatch,
  SMOKE_INCOMPLETE_METRICS,
  SMOKE_METRICS,
  SMOKE_TELEMETRY_GLOBAL_NAME,
  SMOKE_TELEMETRY_SCHEMA_VERSION,
  SMOKE_V8_CODE_CACHE_DIAGNOSTIC,
  SMOKE_V8_CODE_CACHE_DIAGNOSTIC_REPEATS,
} from "./smoke.js";

const expectedSchemaVersion: ParallaxTelemetrySnapshot["schemaVersion"] =
  SMOKE_TELEMETRY_SCHEMA_VERSION;

describe("smoke@1 contract", () => {
  it("stays synchronized with the public engine telemetry contract", () => {
    expect(SMOKE_TELEMETRY_GLOBAL_NAME).toBe(TELEMETRY_GLOBAL_NAME);
    expect(expectedSchemaVersion).toBe(TELEMETRY_SCHEMA_VERSION);
  });

  it("versions the isolated V8 diagnostic and its repeat contract", () => {
    expect(SMOKE_V8_CODE_CACHE_DIAGNOSTIC).toBe("v8-code-cache@5");
    expect(SMOKE_V8_CODE_CACHE_DIAGNOSTIC_REPEATS).toBe(3);
  });

  it("accounts for every mandatory metric in its single registry", () => {
    const mandatory = SMOKE_METRICS.filter((metric) => metric.mandatoryForHarnessV1);
    expect(mandatory.length).toBeGreaterThan(0);
    expect(new Set(SMOKE_METRICS.map((metric) => metric.name)).size).toBe(SMOKE_METRICS.length);
    expect(SMOKE_INCOMPLETE_METRICS.every((metric) => SMOKE_METRICS.includes(metric))).toBe(true);
    expect(
      SMOKE_METRICS.find((metric) => metric.name === "verified gate environment identity")?.probe,
    ).toBe("implemented");
    expect(
      SMOKE_METRICS.find((metric) => metric.name === "compositor presentation interval")?.probe,
    ).toBe("incomplete");
    expect(
      SMOKE_METRICS.find((metric) => metric.name === "Dawn pipeline compile/cache evidence")?.probe,
    ).toBe("implemented");
    expect(SMOKE_METRICS.find((metric) => metric.name === "V8 code-cache evidence")?.probe).toBe(
      "implemented",
    );
    expect(
      SMOKE_METRICS.find((metric) => metric.name === "compositor presentation interval")
        ?.invalidReason,
    ).toContain("PresentationFeedback.kFailure");
  });

  it("owns exhaustive tier profiles", () => {
    expect(parseQualityTier(undefined)).toBe("showcase");
    expect(parseQualityTier("standard")).toBe("standard");
    expect(() => parseQualityTier("future-tier")).toThrow("showcase or standard");
    expect(Object.keys(QUALITY_TIER_PROFILES).sort()).toEqual(["showcase", "standard"]);
    expect(QUALITY_TIER_PROFILES.showcase.refreshRateHz).toBe(60);
    expect(QUALITY_TIER_PROFILES.standard.refreshRateHz).toBe(120);
  });

  it("applies the registered pixel tolerance to native-fullscreen render surfaces", () => {
    expect(renderSurfaceMismatch("showcase", { height: 2_161, width: 3_841 }, 2)).toBeNull();
    expect(renderSurfaceMismatch("showcase", { height: 2_163, width: 3_840 }, 2)).toContain(
      "3840x2160±2",
    );
  });
});
