import { describe, expect, it } from "vitest";
import { runHeadlessBalanceSweep } from "../src/balance/headless-balancer";

// The D-165 balance instrument: closed-form lane/TTK/survivability checks plus the
// seeded duel sweep. A band violation is a balance regression and fails the unit gate.
describe("headless balancer", () => {
  it("passes every ruleset v2 band across the reference sweep", () => {
    const report = runHeadlessBalanceSweep();
    expect(report.matchups.length).toBeGreaterThan(0);
    expect(report.violations).toEqual([]);
  }, 180_000);

  it("is deterministic for the same root seed", () => {
    const first = runHeadlessBalanceSweep(3);
    const second = runHeadlessBalanceSweep(3);
    expect(second).toEqual(first);
  }, 180_000);
});
