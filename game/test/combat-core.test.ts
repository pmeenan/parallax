import { describe, expect, it } from "vitest";
import {
  COMBAT_BLOCK,
  COMBAT_CONDITION,
  COMBAT_DODGE,
  MONSTER_KITS,
  monsterKitIndex,
  PLAYER_STARTING_PROFILE,
} from "../src/balance/combat";
import {
  COMBAT_ACTION_DODGE,
  COMBAT_ACTION_STAGGERED,
  COMBAT_ACTION_WINDUP,
  createCombatantState,
  deriveMonsterSheet,
  derivePlayerSheet,
  exactSuccessSeventeenths,
  monsterAttackSpec,
  PLAYER_ACTION_LIGHT,
  PLAYER_ACTION_SLOT_BASE,
  playerAttackSpec,
  resolveAttack,
  resolveCheck,
  startPlayerAction,
  tickCombatant,
} from "../src/sim/combat-core";

const playerSheet = derivePlayerSheet(PLAYER_STARTING_PROFILE);
const gnawerSheet = deriveMonsterSheet(monsterKitIndex("burrow-gnawer"));

function freshPlayer() {
  return createCombatantState(playerSheet);
}

function attackContext(state = freshPlayer()) {
  return Object.freeze({ sheet: playerSheet, spellPotencyOverride: null, state });
}

describe("combat core rules", () => {
  it("computes the 17-outcome check with always-fail and always-succeed edges", () => {
    // Equal ratings: rolls −8 and every negative score fail; +8 always succeeds.
    expect(exactSuccessSeventeenths(0, 0)).toBe(9);
    expect(exactSuccessSeventeenths(3, 0)).toBe(12);
    // No rating gap is deterministic: one roll always succeeds, one always fails.
    expect(exactSuccessSeventeenths(-100, 0)).toBe(1);
    expect(exactSuccessSeventeenths(100, 0)).toBe(16);
  });

  it("resolves checks deterministically from the stream state", () => {
    const first = resolveCheck(12_345, 5, 3);
    const second = resolveCheck(12_345, 5, 3);
    expect(second).toEqual(first);
    expect(first.rngState).not.toBe(12_345);
  });

  it("keen weapon hits multiply raw damage before soak", () => {
    const spec = playerAttackSpec(playerSheet, PLAYER_ACTION_LIGHT);
    if (spec === null) throw new Error("Light attack spec is missing");
    // Find an RNG state whose roll produces a keen against a heavily inferior guard.
    let rngState = 1;
    let sawKeen = false;
    let sawDeflect = false;
    for (let attempt = 0; attempt < 64 && !(sawKeen && sawDeflect); attempt += 1) {
      const resolution = resolveAttack(
        rngState,
        attackContext(),
        Object.freeze({ sheet: gnawerSheet, state: createCombatantState(gnawerSheet) }),
        spec,
      );
      rngState = resolution.rngState;
      if (resolution.outcome === "keen") {
        sawKeen = true;
        const hit = resolution.events.find((event) => event.kind === "hit") as
          | { amount: number; keen: boolean }
          | undefined;
        expect(hit?.keen).toBe(true);
        expect(hit?.amount).toBe(Math.floor((spec.raw * 3) / 2));
      }
      if (resolution.outcome === "deflected") sawDeflect = true;
    }
    expect(sawKeen).toBe(true);
    expect(sawDeflect).toBe(true);
  });

  it("consumes Chilled into Staggered on an ember hit (thermal shock)", () => {
    const chilledDefender = Object.freeze({
      ...createCombatantState(gnawerSheet),
      conditions: Object.freeze({
        burningTicks: 0,
        chilledTicks: 100,
        envenomedTicks: 0,
        exposedTicks: 0,
      }),
    });
    const emberSpec = Object.freeze({
      answeringEligible: false,
      appliesCondition: null,
      appliesConditionOnKeen: null,
      channel: "ember" as const,
      checkType: "spell" as const,
      ignoresHalfSoak: false,
      raw: 20,
      staggersNonElite: false,
    });
    // Walk RNG states until the spell lands.
    let rngState = 7;
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const resolution = resolveAttack(
        rngState,
        attackContext(),
        Object.freeze({ sheet: gnawerSheet, state: chilledDefender }),
        emberSpec,
      );
      rngState = resolution.rngState;
      if (resolution.outcome === "hit" || resolution.outcome === "keen") {
        expect(resolution.defender.conditions.chilledTicks).toBe(0);
        expect(resolution.defender.actionKind).toBe(COMBAT_ACTION_STAGGERED);
        expect(
          resolution.events.some(
            (event) =>
              event.kind === "condition-consumed" &&
              (event as { consumed: string }).consumed === "chilled",
          ),
        ).toBe(true);
        return;
      }
    }
    throw new Error("Ember spell never landed in 64 attempts");
  });

  it("turns a caught block into a free deflection and breaks an empty-stamina block", () => {
    const spec = monsterAttackSpec(gnawerSheet, 0);
    const caught = Object.freeze({
      ...freshPlayer(),
      blockHeldTicks: COMBAT_BLOCK.caughtWindowTicks,
    });
    const caughtResolution = resolveAttack(
      99,
      Object.freeze({
        sheet: gnawerSheet,
        spellPotencyOverride: null,
        state: createCombatantState(gnawerSheet),
      }),
      Object.freeze({ sheet: playerSheet, state: caught }),
      spec,
    );
    expect(caughtResolution.defender.stamina).toBe(caught.stamina);

    const lateBlock = Object.freeze({
      ...freshPlayer(),
      blockHeldTicks: COMBAT_BLOCK.caughtWindowTicks + 5,
      stamina: 1,
    });
    const broken = resolveAttack(
      99,
      Object.freeze({
        sheet: gnawerSheet,
        spellPotencyOverride: null,
        state: createCombatantState(gnawerSheet),
      }),
      Object.freeze({ sheet: playerSheet, state: lateBlock }),
      spec,
    );
    expect(broken.defender.stamina).toBe(0);
    expect(broken.defender.conditions.exposedTicks).toBe(COMBAT_CONDITION.exposed.durationTicks);
    expect(broken.defender.blockLockoutTicks).toBe(COMBAT_BLOCK.breakLockoutTicks);
  });

  it("defeats attacks entirely during dodge avoidance frames", () => {
    let state = freshPlayer();
    const started = startPlayerAction(state, playerSheet, 2);
    expect(started.started).toBe(true);
    state = started.state;
    expect(state.actionKind).toBe(COMBAT_ACTION_DODGE);
    // Advance into the avoidance window.
    for (let tick = 0; tick < COMBAT_DODGE.avoidanceStartTick; tick += 1) {
      state = tickCombatant(state, playerSheet, null, { blockHeld: false, inCombat: true }).state;
    }
    const resolution = resolveAttack(
      5,
      Object.freeze({
        sheet: gnawerSheet,
        spellPotencyOverride: null,
        state: createCombatantState(gnawerSheet),
      }),
      Object.freeze({ sheet: playerSheet, state }),
      monsterAttackSpec(gnawerSheet, 0),
    );
    expect(resolution.outcome).toBe("avoided");
    // No RNG was consumed: an avoided attack is not a check.
    expect(resolution.rngState).toBe(5);
  });

  it("treats unbound loadout slots as inert no-ops", () => {
    // The starter loadout binds two slots; keys 3 and 4 press slots 2 and 3.
    expect(PLAYER_STARTING_PROFILE.loadout.length).toBe(2);
    for (const emptySlot of [2, 3]) {
      const attempt = startPlayerAction(
        freshPlayer(),
        playerSheet,
        PLAYER_ACTION_SLOT_BASE + emptySlot,
      );
      expect(attempt.started).toBe(false);
      expect(attempt.state).toEqual(freshPlayer());
    }
  });

  it("keeps stamina spend, regen delay, and integer accumulators consistent", () => {
    let state = freshPlayer();
    const heavy = startPlayerAction(state, playerSheet, 1);
    expect(heavy.started).toBe(true);
    state = heavy.state;
    expect(state.stamina).toBe(playerSheet.maxStamina - 25);
    expect(state.actionKind).toBe(COMBAT_ACTION_WINDUP);
    // Regen stays off through the delay, then accrues integer points.
    for (let tick = 0; tick < 200; tick += 1) {
      state = tickCombatant(
        state,
        playerSheet,
        tick < 45 ? { activeTicks: 8, recoveryTicks: 26 } : null,
        { blockHeld: false, inCombat: true },
      ).state;
      expect(Number.isSafeInteger(state.stamina)).toBe(true);
    }
    expect(state.stamina).toBe(playerSheet.maxStamina);
  });

  it("authors every monster wind-up at or above the telegraph floors", () => {
    for (const kit of MONSTER_KITS) {
      for (const attack of kit.attacks) {
        expect(attack.timing.windupTicks).toBeGreaterThanOrEqual(attack.fast ? 24 : 30);
      }
    }
  });
});
