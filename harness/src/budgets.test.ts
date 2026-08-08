import { describe, expect, it } from "vitest";
import {
  evaluateJsHeapBudget,
  evaluateMainThreadBudgets,
  evaluatePipelineBudgets,
  evaluateSimulationControllerBudget,
  evaluateV8CodeCacheDiagnostics,
  evaluateV8CodeCacheReproductionDiagnostics,
} from "./budgets";

describe("M0 implemented budgets", () => {
  it("enforces the tier-specific all-realm JS heap ceiling", () => {
    expect(evaluateJsHeapBudget(2 * 1024 ** 3, "standard")[0]).toMatchObject({
      metric: "allRealmJsHeapHighWaterBytes",
      passed: true,
    });
    expect(evaluateJsHeapBudget(2 * 1024 ** 3 + 1, "standard")[0]?.passed).toBe(false);
    expect(evaluateJsHeapBudget(4 * 1024 ** 3, "showcase")[0]?.passed).toBe(true);
  });

  it("passes zero main-thread long tasks and fails a nonzero count", () => {
    expect(evaluateMainThreadBudgets(0)[0]).toMatchObject({
      metric: "mainThreadLongTasksOver50Ms",
      passed: true,
    });
    expect(evaluateMainThreadBudgets(1)[0]?.passed).toBe(false);
  });

  it("fails pipeline creation or backend shader compilation overlapping gameplay", () => {
    expect(evaluatePipelineBudgets(0, 0)).toMatchObject([
      { metric: "pipelineCreationActivityOverlappingMeasurement", passed: true },
      { metric: "shaderCompilationsOverlappingMeasurement", passed: true },
    ]);
    expect(evaluatePipelineBudgets(1, 0)[0]?.passed).toBe(false);
    expect(evaluatePipelineBudgets(0, 1)[1]?.passed).toBe(false);
  });

  it("gates the moving-controller replay step high water at two milliseconds", () => {
    expect(evaluateSimulationControllerBudget(2)[0]).toEqual({
      actual: 2,
      limit: 2,
      metric: "simulationControllerStepHighWaterMs",
      passed: true,
    });
    expect(evaluateSimulationControllerBudget(2.001)[0]?.passed).toBe(false);
  });

  it("flags an explicitly observed V8 code-cache rejection", () => {
    expect(evaluateV8CodeCacheDiagnostics(0, true)[0]?.satisfied).toBe(true);
    expect(evaluateV8CodeCacheDiagnostics(1, true)[0]?.satisfied).toBe(false);
    expect(evaluateV8CodeCacheDiagnostics(0, false)).toEqual([]);
    expect(evaluateV8CodeCacheDiagnostics(1, false)[0]?.satisfied).toBe(false);
    expect(evaluateV8CodeCacheDiagnostics(1, false)[0]?.metric).toBe(
      "v8CodeCacheRejectedArtifacts",
    );
  });

  it("flags URL-attributed V8 code-cache re-production on a warm launch", () => {
    expect(evaluateV8CodeCacheReproductionDiagnostics(0, true)[0]?.satisfied).toBe(true);
    expect(evaluateV8CodeCacheReproductionDiagnostics(1, true)[0]?.satisfied).toBe(false);
    expect(evaluateV8CodeCacheReproductionDiagnostics(0, false)).toEqual([]);
    expect(evaluateV8CodeCacheReproductionDiagnostics(1, false)[0]?.satisfied).toBe(false);
  });
});
