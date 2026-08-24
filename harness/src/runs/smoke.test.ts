import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type ParallaxTelemetrySnapshot,
  TELEMETRY_GLOBAL_NAME,
  TELEMETRY_SCHEMA_VERSION,
} from "@parallax/engine";
import { describe, expect, it } from "vitest";
import {
  assertSmokeMetricRegistryCoverage,
  SMOKE_CHECKED_METRIC_NAMES,
  SMOKE_EVIDENCE_METRIC_NAMES,
} from "../smoke-result.js";
import {
  parseQualityTier,
  parseSmokeRunOptions,
  QUALITY_TIER_PROFILES,
  renderSurfaceMismatch,
  SMOKE_DISTRICT_SWAP_PREFETCH_TRIGGER_METERS,
  SMOKE_DISTRICT_SWAP_TRAVERSAL_SPEED_METERS_PER_SECOND,
  SMOKE_INCOMPLETE_METRICS,
  SMOKE_MANDATORY_METRIC_SET_VERSION,
  SMOKE_METRICS,
  SMOKE_PRESENTATION_TRACE_COMPLETION_TIMEOUT_MS,
  SMOKE_PRESENTATION_TRACE_LATE_OBSERVATION_MS,
  SMOKE_REPORT_SCHEMA_VERSION,
  SMOKE_SAB_TOTAL_BYTES,
  SMOKE_STREAMING_P95_ABSOLUTE_RANGE_FLOOR_MS,
  SMOKE_STREAMING_P95_RELATIVE_RANGE_LIMIT,
  SMOKE_TELEMETRY_GLOBAL_NAME,
  SMOKE_TELEMETRY_SCHEMA_VERSION,
  SMOKE_V8_CODE_CACHE_DIAGNOSTIC,
  SMOKE_V8_CODE_CACHE_DIAGNOSTIC_REPEATS,
  SMOKE_WASM_THREAD_COMPLETION_TIMEOUT_MS,
  SMOKE_WASM_THREAD_MEMORY_PAGES,
  SMOKE_WASM_THREAD_TASK_COUNT,
  SMOKE_WASM_THREAD_WORKER_COUNT,
} from "./smoke.js";

const expectedSchemaVersion: ParallaxTelemetrySnapshot["schemaVersion"] =
  SMOKE_TELEMETRY_SCHEMA_VERSION;

describe("smoke@1 contract", () => {
  it("versions baseline evidence in the Lite-only result contract", () => {
    expect(SMOKE_REPORT_SCHEMA_VERSION).toBe(75);
    expect(SMOKE_DISTRICT_SWAP_PREFETCH_TRIGGER_METERS).toEqual({
      "castle-undercroft": 6,
      "forest-ruin": 5,
      "village-well": 5,
    });
    expect(SMOKE_DISTRICT_SWAP_TRAVERSAL_SPEED_METERS_PER_SECOND).toBe(12);
  });

  it("stays synchronized with the public engine telemetry contract", () => {
    expect(SMOKE_TELEMETRY_GLOBAL_NAME).toBe(TELEMETRY_GLOBAL_NAME);
    expect(expectedSchemaVersion).toBe(TELEMETRY_SCHEMA_VERSION);
  });

  it("versions the isolated V8 diagnostic and its repeat contract", () => {
    expect(SMOKE_V8_CODE_CACHE_DIAGNOSTIC).toBe("v8-code-cache@6");
    expect(SMOKE_V8_CODE_CACHE_DIAGNOSTIC_REPEATS).toBe(3);
  });

  it("keeps the V8 code-cache diagnostic opt-in", () => {
    expect(parseSmokeRunOptions([])).toEqual({ includeV8CodeCache: false });
    expect(parseSmokeRunOptions(["--include-v8-code-cache"])).toEqual({
      includeV8CodeCache: true,
    });
    expect(() =>
      parseSmokeRunOptions(["--include-v8-code-cache", "--include-v8-code-cache"]),
    ).toThrow("may only be specified once");
    expect(() => parseSmokeRunOptions(["--unknown"])).toThrow("Unsupported smoke option");
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
    expect(SMOKE_METRICS.find((metric) => metric.name === "report finalization")).toMatchObject({
      mandatoryForHarnessV1: true,
      probe: "implemented",
    });
    expect(SMOKE_METRICS.find((metric) => metric.name === "greybox world content")).toMatchObject({
      mandatoryForHarnessV1: true,
      probe: "implemented",
    });
    expect(
      SMOKE_METRICS.find((metric) => metric.name === "world streaming pipeline"),
    ).toMatchObject({
      mandatoryForHarnessV1: true,
      probe: "implemented",
    });
    expect(
      SMOKE_METRICS.find((metric) => metric.name === "streaming cell-load p95 variance"),
    ).toMatchObject({
      mandatoryForHarnessV1: false,
      probe: "implemented",
    });
    expect(SMOKE_METRICS.find((metric) => metric.name === "HTTP serving evidence")).toMatchObject({
      mandatoryForHarnessV1: false,
      probe: "implemented",
    });
    expect(
      SMOKE_METRICS.find((metric) => metric.name === "SAB ring-buffer transport"),
    ).toMatchObject({ mandatoryForHarnessV1: true, probe: "implemented" });
    expect(SMOKE_METRICS.find((metric) => metric.name === "Rust/WASM threads")).toMatchObject({
      mandatoryForHarnessV1: true,
      probe: "implemented",
    });
    expect(SMOKE_MANDATORY_METRIC_SET_VERSION).toBe(35);
    expect(SMOKE_STREAMING_P95_ABSOLUTE_RANGE_FLOOR_MS).toBe(1);
    expect(SMOKE_STREAMING_P95_RELATIVE_RANGE_LIMIT).toBe(0.1);
    expect(SMOKE_PRESENTATION_TRACE_COMPLETION_TIMEOUT_MS).toBe(10_000);
    expect(SMOKE_PRESENTATION_TRACE_LATE_OBSERVATION_MS).toBe(10_000);
    expect(SMOKE_SAB_TOTAL_BYTES).toBe(8_224);
    expect(SMOKE_WASM_THREAD_MEMORY_PAGES).toBe(33);
    expect(SMOKE_WASM_THREAD_COMPLETION_TIMEOUT_MS).toBe(12_000);
    expect(SMOKE_WASM_THREAD_TASK_COUNT).toBe(262_144);
    expect(SMOKE_WASM_THREAD_WORKER_COUNT).toBe(2);
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

  it("keeps every advertised metric and blocking-check producer in exact symmetry", () => {
    const registered = SMOKE_METRICS.map((metric) => metric.name).sort();
    expect(SMOKE_EVIDENCE_METRIC_NAMES.length).toBeGreaterThan(0);
    expect([...SMOKE_CHECKED_METRIC_NAMES].sort()).toEqual(registered);
    expect(() =>
      assertSmokeMetricRegistryCoverage(
        [...SMOKE_METRICS, { mandatoryForHarnessV1: true, name: "advertised without a producer" }],
        SMOKE_CHECKED_METRIC_NAMES,
      ),
    ).toThrow(/drifted/u);
    expect(() =>
      assertSmokeMetricRegistryCoverage(SMOKE_METRICS, [
        ...SMOKE_CHECKED_METRIC_NAMES,
        "producer without an advertised metric",
      ]),
    ).toThrow(/drifted/u);
  });

  it("keeps budgets.md aligned with the executable mandatory metric-set version", async () => {
    const budgets = await readFile(
      resolve(import.meta.dirname, "../../../docs/budgets.md"),
      "utf8",
    );
    expect(budgets).toContain(
      `the current \`smoke@1\` mandatory metric-set (v${SMOKE_MANDATORY_METRIC_SET_VERSION},`,
    );
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

  it("passes every telemetry readiness identity into the browser predicate", async () => {
    const source = await readFile(resolve(import.meta.dirname, "../smoke-run.ts"), "utf8");
    const start = source.indexOf("function telemetryReady(");
    const end = source.indexOf("function requireHybridUiEvidence(", start);
    const predicate = source.slice(start, end);
    expect(predicate).toContain("contract.expectedSchemaVersion");
    expect(predicate).toContain("contract.hybridUiSchemaVersion");
    expect(predicate).not.toContain("SMOKE_HYBRID_UI_TELEMETRY_SCHEMA_VERSION");
    expect(
      source.match(/hybridUiSchemaVersion: SMOKE_HYBRID_UI_TELEMETRY_SCHEMA_VERSION/g),
    ).toHaveLength(2);
  });
});
