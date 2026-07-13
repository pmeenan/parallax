import { describe, expect, it } from "vitest";
import { evaluateMainThreadBudgets } from "./budgets";

describe("M0 implemented budgets", () => {
  it("passes zero main-thread long tasks and fails a nonzero count", () => {
    expect(evaluateMainThreadBudgets(0)[0]?.passed).toBe(true);
    expect(evaluateMainThreadBudgets(1)[0]?.passed).toBe(false);
  });
});
