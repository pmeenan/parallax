import { describe, expect, it } from "vitest";
import { CREATURE_AI_BY_KIT } from "../src/balance/creature-ai";
import { runCreatureEngagementPressureFixture } from "../src/sim/creature-engagement-fixture";

describe("creature encounter pressure fixture", () => {
  it("is repeatable and enforces measurable multi-attacker pressure", () => {
    const first = runCreatureEngagementPressureFixture();
    const second = runCreatureEngagementPressureFixture();
    expect(second).toEqual(first);
    expect(first.attackStarts).toBeGreaterThan(2);
    expect(first.attackSlotWaitTicks).toBeGreaterThan(0);
    expect(first.maximumConcurrentAttackers).toBe(
      CREATURE_AI_BY_KIT["burrow-gnawer"].maxConcurrentAttackers,
    );
    expect(first.overlapTicks).toBeGreaterThan(0);
    expect(first.concurrentAttackerHistogram).toHaveLength(5);
    expect(first.concurrentAttackerHistogram.slice(3)).toEqual([0, 0]);
  });
});
