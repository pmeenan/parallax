import { simulationWorldDefinition } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import {
  cumulativeExperienceForLevel,
  levelForExperience,
  PROGRESSION_ABILITIES,
  PROGRESSION_LEVEL_CAP,
  progressionSlotAvailable,
  SCRIPTED_SLICE_XP_LEDGER,
} from "../src/balance/progression";
import {
  applySelfSpellEffects,
  createCombatantState,
  derivePlayerSheet,
  PLAYER_ACTION_SLOT_BASE,
  playerActionTiming,
  startPlayerAction,
  tickCombatant,
} from "../src/sim/combat-core";
import { createInitialItemState, itemCombatBonuses } from "../src/sim/items";
import { COMBAT_PRESSED_SLOT_2 } from "../src/sim/m3-combat-system";
import {
  createEquipAbilityCommand,
  createGameSimulationAdapter,
  createLearnAbilityCommand,
  createPlayerInputCommand,
  createProgressionSnapshotQuery,
  createSpendAttributeCommand,
} from "../src/sim/m3-simulation";
import {
  applyLevelUpPayoff,
  assertProgressionState,
  awardExperience,
  createInitialProgressionState,
  deserializeProgressionState,
  equipAbility,
  learnAbility,
  PROGRESSION_STATE_BYTES,
  progressionCombatProfile,
  serializeProgressionState,
  spendAttributePoint,
} from "../src/sim/progression";
import { DISTRICT_1_GREYBOX_SPEC } from "../src/world/district-1.data";
import { createGreyboxScene } from "../src/world/greybox-generator";

const world = createGreyboxScene(DISTRICT_1_GREYBOX_SPEC).world;
const context = Object.freeze({ timestepHz: 60, world: simulationWorldDefinition(world) });
const STARTER_ITEM_BONUSES = itemCombatBonuses(createInitialItemState(0));

describe("M3.5 progression", () => {
  it("uses the authored cumulative XP curve through the level-10 cap", () => {
    expect(
      Array.from({ length: PROGRESSION_LEVEL_CAP }, (_, index) =>
        cumulativeExperienceForLevel(index + 1),
      ),
    ).toEqual([0, 100, 300, 600, 1_000, 1_500, 2_100, 2_800, 3_600, 4_500]);
    expect(levelForExperience(4_499)).toBe(9);
    expect(levelForExperience(4_500)).toBe(10);
    expect(levelForExperience(50_000)).toBe(10);
  });

  it("grants one attribute point and one ability pick per level gained", () => {
    const initial = createInitialProgressionState();
    const award = awardExperience(initial, 500);
    expect(award.levelsGained).toBe(2);
    expect(award.state).toMatchObject({
      experience: 600,
      level: 4,
      unspentAbilityPicks: 2,
      unspentAttributePoints: 2,
    });
    const attributed = spendAttributePoint(award.state, "attunement");
    const learned = learnAbility(attributed, "emberlash");
    const equipped = equipAbility(learned, "active", 1, "emberlash");
    expect(progressionCombatProfile(equipped, STARTER_ITEM_BONUSES).loadout).toEqual([
      "piercing-lunge",
      "emberlash",
      null,
      null,
    ]);
    expect(
      derivePlayerSheet(progressionCombatProfile(equipped, STARTER_ITEM_BONUSES)).maxAether,
    ).toBeGreaterThan(
      derivePlayerSheet(progressionCombatProfile(initial, STARTER_ITEM_BONUSES)).maxAether,
    );
    expect(() => assertProgressionState(equipped)).not.toThrow();
  });

  it("makes the deterministic level-up payoff refill stamina and aether but not health", () => {
    const progression = createInitialProgressionState();
    const sheet = derivePlayerSheet(progressionCombatProfile(progression, STARTER_ITEM_BONUSES));
    const depleted = Object.freeze({
      ...createCombatantState(sheet),
      aether: 3,
      aetherAccumulator: 17,
      health: sheet.maxHealth - 11,
      stamina: 4,
      staminaAccumulator: 23,
      staminaDelayTicks: 19,
    });
    const payoff = applyLevelUpPayoff(depleted, sheet, 1);
    expect(payoff).toMatchObject({
      aether: sheet.maxAether,
      aetherAccumulator: 0,
      health: sheet.maxHealth - 11,
      stamina: sheet.maxStamina,
      staminaAccumulator: 0,
      staminaDelayTicks: 0,
    });
    expect(applyLevelUpPayoff(depleted, sheet, 0)).toBe(depleted);
  });

  it("keeps all four active and two knack slots available from level 2", () => {
    expect(
      Array.from({ length: 4 }, (_, slot) => progressionSlotAvailable("active", slot, 2)),
    ).toEqual([true, true, true, true]);
    expect(
      Array.from({ length: 2 }, (_, slot) => progressionSlotAvailable("knack", slot, 2)),
    ).toEqual([true, true]);
    expect(progressionSlotAvailable("active", 0, 1)).toBe(false);
  });

  it("binds learned passives and equipped knacks into the combat sheet", () => {
    let state = awardExperience(createInitialProgressionState(), 500).state;
    state = learnAbility(state, "answering-strike");
    state = learnAbility(state, "wellspring");
    state = equipAbility(state, "knack", 0, "wellspring");
    const sheet = derivePlayerSheet(progressionCombatProfile(state, STARTER_ITEM_BONUSES));
    expect(sheet.answeringStrike).toBe(true);
    expect(sheet.wellspring).toBe(true);
  });

  it("activates Ironset from a learned active slot", () => {
    let state = awardExperience(createInitialProgressionState(), 500).state;
    state = learnAbility(state, "ironset-stance");
    state = equipAbility(state, "active", 1, "ironset-stance");
    const sheet = derivePlayerSheet(progressionCombatProfile(state, STARTER_ITEM_BONUSES));
    const actionId = PLAYER_ACTION_SLOT_BASE + 1;
    const started = startPlayerAction(createCombatantState(sheet), sheet, actionId);
    expect(started.started).toBe(true);
    const ticked = tickCombatant(started.state, sheet, playerActionTiming(sheet, actionId), {
      blockHeld: false,
      inCombat: true,
    });
    expect(ticked.activeStartedActionId).toBe(actionId);
    const active = applySelfSpellEffects(ticked.state, actionId, sheet);
    expect(active.ironsetTicks).toBe(240);

    const adapter = createGameSimulationAdapter(context);
    const initial = adapter.createInitialState(3);
    let simulationState = Object.freeze({ ...initial, progression: state });
    const queued = adapter.applyCommand(
      simulationState,
      createPlayerInputCommand(0, 1, {
        blockHeld: false,
        combatPressed: COMBAT_PRESSED_SLOT_2,
        forward: 0,
        interactPressed: false,
        right: 0,
        yawRadians: 0,
      }),
    );
    simulationState = queued.state;
    const eventKinds: string[] = [];
    for (let tick = 1; tick <= 30; tick += 1) {
      const stepped = adapter.step(simulationState, tick);
      simulationState = stepped.state;
      eventKinds.push(...stepped.events.map((event) => event.kind));
    }
    expect(eventKinds).toContain("combat.ironset-started");
    expect(adapter.telemetryCounters(simulationState).combatPlayerIronsetTicks).toBeGreaterThan(0);
  });

  it("round-trips the stable 14-ability state block and rejects noncanonical bytes", () => {
    expect(PROGRESSION_ABILITIES).toHaveLength(14);
    let state = awardExperience(createInitialProgressionState(), 500).state;
    state = learnAbility(state, "quiet-tread");
    state = equipAbility(state, "knack", 0, "quiet-tread");
    const bytes = new Uint8Array(PROGRESSION_STATE_BYTES);
    serializeProgressionState(new DataView(bytes.buffer), 0, state);
    expect(deserializeProgressionState(new DataView(bytes.buffer), 0)).toEqual(state);
    new DataView(bytes.buffer).setUint32(80, 1, true);
    expect(() => deserializeProgressionState(new DataView(bytes.buffer), 0)).toThrow(
      /noncanonical reserved bytes/,
    );
    new DataView(bytes.buffer).setUint32(80, 0, true);
    new DataView(bytes.buffer).setUint32(
      4,
      cumulativeExperienceForLevel(PROGRESSION_LEVEL_CAP) + 1,
      true,
    );
    expect(() => deserializeProgressionState(new DataView(bytes.buffer), 0)).toThrow(
      /progression state is invalid/i,
    );
  });

  it("applies selections only through serializable simulation commands", () => {
    const adapter = createGameSimulationAdapter(context);
    const initial = adapter.createInitialState(1);
    const earned = Object.freeze({
      ...initial,
      progression: awardExperience(initial.progression, 500).state,
    });
    const attributed = adapter.applyCommand(
      earned,
      createSpendAttributeCommand(0, 1, "attunement"),
    );
    const learned = adapter.applyCommand(
      attributed.state,
      createLearnAbilityCommand(1, 1, "emberlash"),
    );
    const equipped = adapter.applyCommand(
      learned.state,
      createEquipAbilityCommand(2, 1, "active", 1, "emberlash"),
    );
    expect([attributed.events[0]?.kind, learned.events[0]?.kind, equipped.events[0]?.kind]).toEqual(
      ["progression.changed", "progression.changed", "progression.changed"],
    );
    expect(adapter.telemetryCounters(equipped.state)).toMatchObject({
      progressionAbilityLearnCount: 2,
      progressionAttributeSpendCount: 2,
      progressionLevel: 4,
      progressionLoadoutChangeCount: 1,
      progressionUnspentAbilityPicks: 1,
      progressionUnspentAttributePoints: 1,
    });
    const queryState = adapter.queryState;
    if (queryState === undefined) throw new Error("Game-state query boundary is missing");
    expect(
      JSON.parse(
        new TextDecoder().decode(queryState(equipped.state, createProgressionSnapshotQuery())),
      ),
    ).toMatchObject({
      activeSlots: ["piercing-lunge", "emberlash", null, null],
      level: 4,
      slotAccess: {
        active: [true, true, true, true],
        knack: [true, true],
        rule: "all-from-level-2",
      },
      version: 1,
    });
    expect(() => adapter.deserializeState(adapter.serializeState(equipped.state))).not.toThrow();
  });

  it("keeps the scripted slice completion inside the level 9-10 pacing band", () => {
    const experience = Object.values(SCRIPTED_SLICE_XP_LEDGER).reduce(
      (sum, amount) => sum + amount,
      0,
    );
    expect(levelForExperience(experience)).toBe(9);
  });
});
