import { describe, expect, it } from "vitest";
import {
  evaluateMainThreadBudgets,
  evaluatePipelineBudgets,
  evaluateV8CodeCacheBudgets,
  evaluateV8CodeCacheReproductionBudgets,
} from "./budgets";

describe("M0 implemented budgets", () => {
  it("passes zero main-thread long tasks and fails a nonzero count", () => {
    expect(evaluateMainThreadBudgets(0)[0]?.passed).toBe(true);
    expect(evaluateMainThreadBudgets(1)[0]?.passed).toBe(false);
  });

  it("fails pipeline creation or backend shader compilation overlapping gameplay", () => {
    expect(evaluatePipelineBudgets(0, 0).every((check) => check.passed)).toBe(true);
    expect(evaluatePipelineBudgets(1, 0)[0]?.passed).toBe(false);
    expect(evaluatePipelineBudgets(0, 1)[1]?.passed).toBe(false);
  });

  it("fails an explicitly observed V8 code-cache rejection", () => {
    expect(evaluateV8CodeCacheBudgets(0, true)[0]?.passed).toBe(true);
    expect(evaluateV8CodeCacheBudgets(1, true)[0]?.passed).toBe(false);
    expect(evaluateV8CodeCacheBudgets(0, false)).toEqual([]);
    expect(evaluateV8CodeCacheBudgets(1, false)[0]?.passed).toBe(false);
    expect(evaluateV8CodeCacheBudgets(1, false)[0]?.metric).toBe("v8CodeCacheRejectedArtifacts");
  });

  it("fails URL-attributed V8 code-cache re-production on a warm launch", () => {
    expect(evaluateV8CodeCacheReproductionBudgets(0, true)[0]?.passed).toBe(true);
    expect(evaluateV8CodeCacheReproductionBudgets(1, true)[0]?.passed).toBe(false);
    expect(evaluateV8CodeCacheReproductionBudgets(0, false)).toEqual([]);
    expect(evaluateV8CodeCacheReproductionBudgets(1, false)[0]?.passed).toBe(false);
  });
});
