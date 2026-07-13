import { describe, expect, it } from "vitest";
import { distribution, evaluateP95Variance, relativeRange } from "./aggregate";

describe("measurement aggregation", () => {
  it("uses nearest-rank percentiles without averaging away tail frames", () => {
    const values = Array.from({ length: 1_000 }, (_, index) => index + 1).reverse();
    expect(distribution(values)).toEqual({ max: 1_000, p50: 500, p95: 950, p99_9: 999 });
  });

  it("measures repeat spread relative to the best repeat", () => {
    expect(relativeRange([10, 11, 10.5])).toBeCloseTo(0.1);
    expect(relativeRange([0, 1])).toBe(Number.POSITIVE_INFINITY);
  });

  it("invalidates a p95 repeat spread above ten percent", () => {
    expect(evaluateP95Variance([10, 11])).toMatchObject({ state: "measured" });
    expect(evaluateP95Variance([10, 11.01])).toMatchObject({ state: "invalid" });
  });

  it("rejects empty sample sets", () => {
    expect(() => distribution([])).toThrow("empty sample set");
  });
});
