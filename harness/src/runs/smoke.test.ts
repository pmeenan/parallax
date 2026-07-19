import {
  type ParallaxTelemetrySnapshot,
  TELEMETRY_GLOBAL_NAME,
  TELEMETRY_SCHEMA_VERSION,
} from "@parallax/engine";
import { describe, expect, it } from "vitest";
import { SMOKE_EVIDENCE_METRIC_NAMES } from "../smoke-result.js";
import {
  parseQualityTier,
  QUALITY_TIER_PROFILES,
  renderSurfaceMismatch,
  SMOKE_INCOMPLETE_METRICS,
  SMOKE_MANDATORY_METRIC_SET_VERSION,
  SMOKE_METRICS,
  SMOKE_OPFS_COMPLETION_TIMEOUT_MS,
  SMOKE_OPFS_FILE_BYTES,
  SMOKE_OPFS_RANDOM_BATCH_READS,
  SMOKE_OPFS_RANDOM_READS,
  SMOKE_REPORT_SCHEMA_VERSION,
  SMOKE_SAB_TOTAL_BYTES,
  SMOKE_TELEMETRY_GLOBAL_NAME,
  SMOKE_TELEMETRY_SCHEMA_VERSION,
  SMOKE_V8_CODE_CACHE_DIAGNOSTIC,
  SMOKE_V8_CODE_CACHE_DIAGNOSTIC_REPEATS,
} from "./smoke.js";

const expectedSchemaVersion: ParallaxTelemetrySnapshot["schemaVersion"] =
  SMOKE_TELEMETRY_SCHEMA_VERSION;

describe("smoke@1 contract", () => {
  it("versions the Lite-only build evidence in the result contract", () => {
    expect(SMOKE_REPORT_SCHEMA_VERSION).toBe(24);
  });

  it("stays synchronized with the public engine telemetry contract", () => {
    expect(SMOKE_TELEMETRY_GLOBAL_NAME).toBe(TELEMETRY_GLOBAL_NAME);
    expect(expectedSchemaVersion).toBe(TELEMETRY_SCHEMA_VERSION);
  });

  it("versions the isolated V8 diagnostic and its repeat contract", () => {
    expect(SMOKE_V8_CODE_CACHE_DIAGNOSTIC).toBe("v8-code-cache@6");
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
    expect(SMOKE_METRICS.find((metric) => metric.name === "attributable GPU memory")?.probe).toBe(
      "implemented",
    );
    expect(SMOKE_METRICS.find((metric) => metric.name === "all-worker JS heap")?.probe).toBe(
      "implemented",
    );
    expect(
      SMOKE_METRICS.find((metric) => metric.name === "all-worker JS heap")?.mandatoryForHarnessV1,
    ).toBe(true);
    expect(
      SMOKE_METRICS.find((metric) => metric.name === "render-worker callback-pacing variance"),
    ).toMatchObject({ mandatoryForHarnessV1: true, probe: "implemented" });
    expect(
      SMOKE_METRICS.find((metric) => metric.name === "core measurement run completion"),
    ).toMatchObject({ mandatoryForHarnessV1: true, probe: "implemented" });
    expect(SMOKE_METRICS.find((metric) => metric.name === "HTTP serving evidence")).toMatchObject({
      mandatoryForHarnessV1: false,
      probe: "implemented",
    });
    expect(
      SMOKE_METRICS.find((metric) => metric.name === "SAB ring-buffer transport"),
    ).toMatchObject({ mandatoryForHarnessV1: true, probe: "implemented" });
    expect(
      SMOKE_METRICS.find((metric) => metric.name === "OPFS sync-access-handle read throughput"),
    ).toMatchObject({ mandatoryForHarnessV1: true, probe: "implemented" });
    expect(
      SMOKE_METRICS.find(
        (metric) => metric.name === "OPFS sync-access-handle throughput repeatability",
      ),
    ).toMatchObject({ mandatoryForHarnessV1: false, probe: "implemented" });
    expect(SMOKE_MANDATORY_METRIC_SET_VERSION).toBe(10);
    expect(SMOKE_SAB_TOTAL_BYTES).toBe(8_224);
    expect(SMOKE_OPFS_FILE_BYTES).toBe(64 * 1024 * 1024);
    expect(SMOKE_OPFS_COMPLETION_TIMEOUT_MS).toBe(17_000);
    expect(SMOKE_OPFS_RANDOM_READS).toBe(4_096);
    expect(SMOKE_OPFS_RANDOM_BATCH_READS).toBe(256);
    expect(SMOKE_METRICS.find((metric) => metric.name === "V8 code-cache evidence")?.probe).toBe(
      "implemented",
    );
    expect(
      SMOKE_METRICS.find((metric) => metric.name === "compositor presentation interval")
        ?.mandatoryForHarnessV1,
    ).toBe(false);
    expect(
      SMOKE_METRICS.find((metric) => metric.name === "V8 code-cache evidence")
        ?.mandatoryForHarnessV1,
    ).toBe(false);
    expect(
      SMOKE_METRICS.find((metric) => metric.name === "compositor presentation interval")
        ?.invalidReason,
    ).toContain("PresentationFeedback.kFailure");
  });

  it("registers every evidence-check metric name the smoke result adapters use", () => {
    const registered = new Set(SMOKE_METRICS.map((metric) => metric.name));
    expect(SMOKE_EVIDENCE_METRIC_NAMES.length).toBeGreaterThan(0);
    for (const name of SMOKE_EVIDENCE_METRIC_NAMES) {
      expect(registered).toContain(name);
    }
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
