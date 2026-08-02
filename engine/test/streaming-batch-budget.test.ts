import { describe, expect, it } from "vitest";
import { createStreamingBatchBudget } from "../src/streaming/streaming-batch-budget";

describe("streaming batch budget", () => {
  it("reserves the aggregate batch atomically and releases it exactly", () => {
    const budget = createStreamingBatchBudget();
    const reservation = budget.reserve(100, 60, 200);
    expect(reservation?.projectedBytes).toBe(160);
    expect(budget.reservedBytes).toBe(60);
    expect(budget.reserve(100, 50, 200)).toBeNull();
    reservation?.release();
    expect(budget.reservedBytes).toBe(0);
    expect(budget.reserve(100, 50, 200)?.projectedBytes).toBe(150);
  });

  it("releases after failure paths and rejects duplicate release", () => {
    const budget = createStreamingBatchBudget();
    const reservation = budget.reserve(0, 9, 9);
    expect(reservation).not.toBeNull();
    reservation?.release();
    expect(() => reservation?.release()).toThrow(/already released/);
    expect(budget.reservedBytes).toBe(0);
  });

  it("rejects malformed accounting inputs", () => {
    const budget = createStreamingBatchBudget();
    expect(() => budget.reserve(-1, 1, 1)).toThrow(/invalid/);
    expect(() => budget.reserve(0, 0, 1)).toThrow(/invalid/);
    expect(() => budget.reserve(0, 1, Number.MAX_SAFE_INTEGER + 1)).toThrow(/invalid/);
  });
});
