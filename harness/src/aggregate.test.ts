import { describe, expect, it } from "vitest";
import {
  distribution,
  evaluateBoundedRepeatability,
  evaluateP95Variance,
  relativeRange,
} from "./aggregate";

describe("measurement aggregation", () => {
  it("uses nearest-rank percentiles without averaging away tail frames", () => {
    const values = Array.from({ length: 1_000 }, (_, index) => index + 1).reverse();
    expect(distribution(values)).toEqual({ max: 1_000, p50: 500, p95: 950, p99_9: 999 });
  });

  it("measures repeat spread relative to the best repeat", () => {
    expect(relativeRange([10, 11, 10.5])).toBeCloseTo(0.1);
    expect(relativeRange([0, 0])).toBe(0);
  });

  it("stores an explicit null when a zero minimum makes the spread unbounded", () => {
    expect(relativeRange([0, 1])).toBeNull();
    const variance = evaluateP95Variance([0, 1], 2);
    expect(variance).toMatchObject({ relativeRange: null, state: "invalid" });
    expect(variance.state === "invalid" ? variance.reason : "").toContain(
      "minimum repeat p95 is 0",
    );
    expect(JSON.parse(JSON.stringify(variance)).relativeRange).toBeNull();
  });

  it("invalidates a p95 repeat spread above ten percent", () => {
    expect(evaluateP95Variance([10, 11], 2)).toMatchObject({ state: "measured" });
    expect(evaluateP95Variance([10, 11.01], 2)).toMatchObject({ state: "invalid" });
  });

  it("invalidates a variance computed from fewer repeats than the run contract expects", () => {
    for (const values of [[], [10], [10, 10.1]] as const) {
      const variance = evaluateP95Variance(values, 3);
      expect(variance).toMatchObject({ relativeRange: null, state: "invalid" });
      expect(variance.state === "invalid" ? variance.reason : "").toContain(
        `requires all 3 expected repeats; received ${values.length}`,
      );
    }
  });

  it("evaluates the spread once exactly the expected repeats are present", () => {
    expect(evaluateP95Variance([10, 10.5, 11], 3)).toMatchObject({ state: "measured" });
    expect(evaluateP95Variance([10, 10.5, 11.01], 3)).toMatchObject({ state: "invalid" });
    expect(() => evaluateP95Variance([10], 0)).toThrow("positive integer");
  });

  it("bounds near-zero repeatability by an explicit absolute floor", () => {
    expect(evaluateBoundedRepeatability([2.435, 1.85, 2.375], 3, "p95", 0.1, 1)).toMatchObject({
      absoluteRange: 0.585,
      allowedAbsoluteRange: 1,
      relativeRange: (2.435 - 1.85) / 1.85,
      state: "measured",
    });
    const invalid = evaluateBoundedRepeatability([2, 2.5, 3.01], 3, "p95", 0.1, 1);
    expect(invalid).toMatchObject({ allowedAbsoluteRange: 1, state: "invalid" });
    expect(invalid.absoluteRange).toBeCloseTo(1.01);
  });

  it("preserves the relative limit above the absolute floor", () => {
    expect(evaluateBoundedRepeatability([20, 21, 22], 3, "p95", 0.1, 1)).toMatchObject({
      absoluteRange: 2,
      allowedAbsoluteRange: 2,
      relativeRange: 0.1,
      state: "measured",
    });
    expect(evaluateBoundedRepeatability([20, 21, 22.01], 3, "p95", 0.1, 1)).toMatchObject({
      state: "invalid",
    });
  });

  it("fails bounded repeatability closed for incomplete or invalid samples", () => {
    for (const values of [[], [1], [1, 2], [1, Number.NaN, 2], [1, -1, 2]] as const) {
      expect(evaluateBoundedRepeatability(values, 3, "p95", 0.1, 1)).toMatchObject({
        absoluteRange: null,
        allowedAbsoluteRange: null,
        relativeRange: null,
        state: "invalid",
      });
    }
    expect(() => evaluateBoundedRepeatability([1], 0, "p95", 0.1, 1)).toThrow("positive integer");
    expect(() => evaluateBoundedRepeatability([1], 1, "p95", -0.1, 1)).toThrow(
      "finite and nonnegative",
    );
    expect(() => evaluateBoundedRepeatability([1], 1, "p95", 0.1, Number.NaN)).toThrow(
      "finite and nonnegative",
    );
  });

  it("rejects empty sample sets", () => {
    expect(() => distribution([])).toThrow("empty sample set");
  });
});
