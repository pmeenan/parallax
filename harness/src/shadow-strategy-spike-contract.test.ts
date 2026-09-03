import { describe, expect, it } from "vitest";
import {
  assertShadowStrategyPageResult,
  assertShadowStrategyRendererPackage,
  evaluateShadowStrategyRepeatability,
  finalizeShadowTaskSummary,
  SHADOW_STRATEGY_CASTER_COUNT,
  SHADOW_STRATEGY_RENDER_HEIGHT,
  SHADOW_STRATEGY_RENDER_WIDTH,
  SHADOW_STRATEGY_SPHERE_SEGMENTS,
  SHADOW_STRATEGY_SPIKE_ID,
  SHADOW_STRATEGY_WORKLOAD_ID,
  summarizeShadowStrategySamples,
} from "./shadow-strategy-spike-contract";

describe("shadow strategy spike contract", () => {
  it("summarizes deterministic nearest-rank percentiles", () => {
    expect(summarizeShadowStrategySamples([5, 1, 4, 2, 3])).toEqual({
      count: 5,
      maximum: 5,
      mean: 3,
      p50: 3,
      p95: 5,
    });
  });

  it("requires a shadow task for every shadowed arm", () => {
    const summary = { count: 240, maximum: 2, mean: 1, p50: 1, p95: 1.5 };
    const result = {
      arm: "pcf-2048",
      casterCount: SHADOW_STRATEGY_CASTER_COUNT,
      configuration: { mapSize: 2_048 },
      configuredShadowMapTexels: 4_194_304,
      cpuRenderCallMs: summary,
      drawCalls: summary,
      droppedGpuTaskSamples: 0,
      gpuFrameTimeMs: summary,
      gpuTimingSupported: true,
      measuredFrames: 240,
      renderHeight: SHADOW_STRATEGY_RENDER_HEIGHT,
      renderWidth: SHADOW_STRATEGY_RENDER_WIDTH,
      renderer: "@babylonjs/lite@1.12.0",
      scenarioId: SHADOW_STRATEGY_SPIKE_ID,
      sceneTaskGpuMs: summary,
      schemaVersion: 4,
      shadowTaskGpuMs: null,
      sphereCasterSegments: SHADOW_STRATEGY_SPHERE_SEGMENTS,
      warmupFrames: 240,
      workloadId: SHADOW_STRATEGY_WORKLOAD_ID,
    };

    expect(() => assertShadowStrategyPageResult(result, "pcf-2048")).toThrow("shadowTaskGpuMs");
  });

  it("rejects results from a different caster workload", () => {
    const summary = { count: 240, maximum: 2, mean: 1, p50: 1, p95: 1.5 };
    const result = {
      arm: "no-shadow",
      casterCount: 103,
      configuration: { technique: "none" },
      configuredShadowMapTexels: 0,
      cpuRenderCallMs: summary,
      drawCalls: summary,
      droppedGpuTaskSamples: 0,
      gpuFrameTimeMs: summary,
      gpuTimingSupported: true,
      measuredFrames: 240,
      renderHeight: SHADOW_STRATEGY_RENDER_HEIGHT,
      renderWidth: SHADOW_STRATEGY_RENDER_WIDTH,
      renderer: "@babylonjs/lite@1.12.0",
      scenarioId: SHADOW_STRATEGY_SPIKE_ID,
      sceneTaskGpuMs: summary,
      schemaVersion: 4,
      shadowTaskGpuMs: null,
      sphereCasterSegments: SHADOW_STRATEGY_SPHERE_SEGMENTS,
      warmupFrames: 240,
      workloadId: SHADOW_STRATEGY_WORKLOAD_ID,
    };

    expect(() => assertShadowStrategyPageResult(result, "no-shadow")).toThrow("identity");
  });

  it("rejects a contaminated no-shadow control instead of discarding its shadow task", () => {
    expect(finalizeShadowTaskSummary("no-shadow", [])).toBeNull();
    expect(() => finalizeShadowTaskSummary("no-shadow", [0.2])).toThrow(
      "No-shadow control collected shadow-task GPU samples",
    );
    expect(finalizeShadowTaskSummary("csm-4x1024", [3, 1, 2])?.p50).toBe(2);
  });

  it("binds the report's renderer identity to the installed renderer package", () => {
    expect(() => assertShadowStrategyRendererPackage("@babylonjs/lite", "1.12.0")).not.toThrow();
    expect(() => assertShadowStrategyRendererPackage("@babylonjs/lite", "1.23.0")).toThrow(
      "installed renderer is @babylonjs/lite@1.23.0",
    );
    expect(() => assertShadowStrategyRendererPackage(undefined, "1.12.0")).toThrow("unreadable");
  });

  it("fails noisy cross-launch costs instead of averaging them into a claim", () => {
    expect(evaluateShadowStrategyRepeatability([1, 1.04, 1.09]).state).toBe("valid");
    const invalid = evaluateShadowStrategyRepeatability([1, 1.04, 1.11]);
    expect(invalid.state).toBe("invalid");
    expect(invalid.relativeRange).toBeCloseTo(0.11, 12);
  });
});
