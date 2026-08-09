import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { minimumObservedFlythroughRouteSpan, TELEMETRY_SCHEMA_VERSION } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import {
  FLYTHROUGH_D1_COMPLETION_TIMEOUT_MS,
  FLYTHROUGH_D1_DISTANCE_METERS,
  FLYTHROUGH_D1_DURATION_MS,
  FLYTHROUGH_D1_EXPECTED_SCENARIO,
  FLYTHROUGH_D1_JS_HEAP_SAMPLE_INTERVAL_MS,
  FLYTHROUGH_D1_MANDATORY_METRIC_SET_VERSION,
  FLYTHROUGH_D1_MANDATORY_METRICS,
  FLYTHROUGH_D1_PHASE_IDS,
  FLYTHROUGH_D1_REPEATS,
  FLYTHROUGH_D1_REPORT_SCHEMA_VERSION,
  FLYTHROUGH_D1_SCENARIO,
  FLYTHROUGH_D1_TELEMETRY_SCHEMA_VERSION,
  FLYTHROUGH_D1_TRACE_COMPLETION_TIMEOUT_MS,
  FLYTHROUGH_D1_TRACE_LATE_OBSERVATION_MS,
  FLYTHROUGH_D1_WARMUP_POLICY,
} from "./flythrough-d1.js";

describe("flythrough-d1@1 run contract", () => {
  it("pins the ten-minute route, three-repeat policy, and public telemetry", () => {
    expect(FLYTHROUGH_D1_SCENARIO).toBe("flythrough-d1@1");
    expect(FLYTHROUGH_D1_DURATION_MS).toBe(600_000);
    expect(FLYTHROUGH_D1_DISTANCE_METERS).toBe(7_200);
    expect(FLYTHROUGH_D1_REPEATS).toBe(3);
    expect(FLYTHROUGH_D1_COMPLETION_TIMEOUT_MS).toBeGreaterThan(FLYTHROUGH_D1_DURATION_MS);
    expect(FLYTHROUGH_D1_JS_HEAP_SAMPLE_INTERVAL_MS).toBe(200);
    expect(FLYTHROUGH_D1_TRACE_COMPLETION_TIMEOUT_MS).toBe(30_000);
    expect(FLYTHROUGH_D1_TRACE_LATE_OBSERVATION_MS).toBe(10_000);
    expect(FLYTHROUGH_D1_REPORT_SCHEMA_VERSION).toBe(35);
    expect(FLYTHROUGH_D1_MANDATORY_METRIC_SET_VERSION).toBe(11);
    expect(FLYTHROUGH_D1_TELEMETRY_SCHEMA_VERSION).toBe(TELEMETRY_SCHEMA_VERSION);
    expect(minimumObservedFlythroughRouteSpan(FLYTHROUGH_D1_EXPECTED_SCENARIO)).toEqual([
      2_000, 0, 2_800,
    ]);
    expect(FLYTHROUGH_D1_EXPECTED_SCENARIO).toMatchObject({
      camera: { beta: Math.PI / 3, heightMeters: 28, radiusMeters: 120 },
      durationMs: 600_000,
      path: [
        [0, 12, -1_800],
        [0, 12, 0],
        [1_200, 12, 0],
        [1_200, 12, 1_200],
        [-1_200, 12, 1_200],
        [-1_200, 12, 600],
      ],
      speedMetersPerSecond: 12,
    });
  });

  it("keeps the rendered preflight outside the fixed stabilization and measurement window", () => {
    expect(FLYTHROUGH_D1_WARMUP_POLICY).toEqual({
      checkpointCount: FLYTHROUGH_D1_PHASE_IDS.length,
      kind: "streamed-checkpoint-preflight-plus-fixed-stabilization",
      stabilizationMs: 10_000,
    });
    expect(FLYTHROUGH_D1_MANDATORY_METRICS).toContain("rendered checkpoint output");
    expect(FLYTHROUGH_D1_MANDATORY_METRICS).toContain("report finalization");
    expect(FLYTHROUGH_D1_MANDATORY_METRICS).toContain("streamed-residency presentation ownership");
  });

  it("keeps budgets.md aligned with the executable flythrough contract versions", async () => {
    const budgets = await readFile(
      resolve(import.meta.dirname, "../../../docs/budgets.md"),
      "utf8",
    );
    expect(budgets).toContain(
      `\`flythrough-d1@1\` report schema v${FLYTHROUGH_D1_REPORT_SCHEMA_VERSION}/mandatory metric set v${FLYTHROUGH_D1_MANDATORY_METRIC_SET_VERSION}`,
    );
  });
});
