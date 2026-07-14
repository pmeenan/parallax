import { describe, expect, it } from "vitest";
import { evaluateMainThreadBudgets, evaluatePipelineBudgets } from "./budgets";

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
});
