import {
  createSimulationRuntime,
  runSimulationReplay,
  simulationWorldDefinition,
} from "@parallax/engine";
import { describe, expect, it } from "vitest";
import { monsterKitIndex } from "../src/balance/combat";
import {
  COMBAT_ACTION_DODGE,
  COMBAT_ACTION_DOWNED,
  COMBAT_ACTION_IDLE,
  COMBAT_ACTION_WINDUP,
  createCombatantState,
  deriveMonsterSheet,
  PLAYER_ACTION_LIGHT,
} from "../src/sim/combat-core";
import {
  COMBAT_HEADER_BYTES,
  COMBAT_PRESSED_DEBUG_SPAWN,
  COMBAT_PRESSED_LIGHT,
  COMBAT_PRESSED_SLOT_3,
  COMBAT_PRESSED_SLOT_4,
  COMBAT_STATE_BYTES,
  COMBATANT_STATE_BYTES,
  type CombatWorldView,
  CREATURE_BEHAVIOR_FLEE,
  CREATURE_BEHAVIOR_IDLE,
  CREATURE_BEHAVIOR_PURSUE,
  CREATURE_BEHAVIOR_RETURN,
  CREATURE_BEHAVIOR_YIELD,
  createInitialM3CombatState,
  creatureEncounterGroupId,
  creatureFlankAngleRadians,
  MAXIMUM_ALIVE_MONSTERS,
  MAXIMUM_MONSTER_ENTRIES,
  MONSTER_ENTITY_ID_START,
  PLAYER_COMBAT_SHEET,
  PLAYER_RESPAWN_TICKS,
  serializeCombatState,
  spawnMonster,
  stepM3Combat,
} from "../src/sim/m3-combat-system";
import {
  createGameSimulationAdapter,
  createPlayerInputCommand,
  createSpawnMonsterCommand,
} from "../src/sim/m3-simulation";
import { DISTRICT_1_GREYBOX_SPEC } from "../src/world/district-1.data";
import { createGreyboxScene } from "../src/world/greybox-generator";

const world = createGreyboxScene(DISTRICT_1_GREYBOX_SPEC).world;
const context = Object.freeze({ timestepHz: 60, world: simulationWorldDefinition(world) });
const AI_WORLD: CombatWorldView = Object.freeze({
  canTraverseSegment: () => true,
  groundHeight: () => 0,
  isWalkablePosition: () => true,
  maximumX: 100,
  maximumZ: 100,
  minimumX: -100,
  minimumZ: -100,
  obstacles: Object.freeze([]),
});

function spawnForAi(
  state: ReturnType<typeof createInitialM3CombatState>,
  kitId: string,
  x: number,
  z: number,
  packId = 0,
): ReturnType<typeof createInitialM3CombatState> {
  const spawned = spawnMonster(state, monsterKitIndex(kitId), x, z, AI_WORLD, packId);
  if (spawned === null) throw new Error("AI test monster spawn failed");
  return spawned.state;
}

// Spawned 1.5 m ahead on both axes: inside melee reach and the frontal arc when the
// player faces along +X/+Z (yaw = π/4).
const FIGHT_COMMANDS = Object.freeze([
  createSpawnMonsterCommand(0, 1, "burrow-gnawer", 1.5, 1.5),
  createPlayerInputCommand(1, 2, {
    combatPressed: COMBAT_PRESSED_LIGHT,
    forward: 0,
    right: 0,
    yawRadians: Math.PI / 4,
  }),
  createPlayerInputCommand(2, 40, {
    combatPressed: COMBAT_PRESSED_LIGHT,
    forward: 0,
    right: 0,
    yawRadians: Math.PI / 4,
  }),
  createPlayerInputCommand(3, 80, {
    combatPressed: COMBAT_PRESSED_LIGHT,
    forward: 0,
    right: 0,
    yawRadians: Math.PI / 4,
  }),
]);

describe("M3 combat integration", () => {
  it("spawns a monster, resolves contested checks, and stays replay-deterministic", () => {
    const first = runSimulationReplay(
      createGameSimulationAdapter(context),
      424_242,
      60,
      FIGHT_COMMANDS,
      300,
    );
    const second = runSimulationReplay(
      createGameSimulationAdapter(context),
      424_242,
      60,
      FIGHT_COMMANDS,
      300,
    );
    expect(second).toMatchObject({
      finalSave: first.finalSave,
      finalStateHash: first.finalStateHash,
      gameCounters: first.gameCounters,
    });
    expect(first.gameCounters.combatChecksResolved).toBeGreaterThan(0);
    expect(first.gameCounters.combatMonstersAlive).toBeGreaterThanOrEqual(0);
    expect(
      (first.gameCounters.combatDamageDealt ?? 0) + (first.gameCounters.combatDeflections ?? 0),
    ).toBeGreaterThan(0);
    expect(first.gameCounters.progressionExperience).toBeGreaterThan(100);
  });

  it("emits telegraph and outcome events for the fight", () => {
    const adapter = createGameSimulationAdapter(context);
    const runtime = createSimulationRuntime(adapter, 424_242, 60);
    for (const command of FIGHT_COMMANDS) runtime.enqueue(command);
    const kinds = new Set<string>();
    for (let tick = 0; tick < 300; tick += 1) {
      for (const event of runtime.step().events) kinds.add(event.kind);
    }
    expect(kinds.has("combat.spawned")).toBe(true);
    expect(kinds.has("combat.attack-started")).toBe(true);
    expect(
      kinds.has("combat.hit") || kinds.has("combat.deflected") || kinds.has("combat.avoided"),
    ).toBe(true);
  });

  it("round-trips combat state through save and load", () => {
    const adapter = createGameSimulationAdapter(context);
    const runtime = createSimulationRuntime(adapter, 424_242, 60);
    for (const command of FIGHT_COMMANDS) runtime.enqueue(command);
    for (let tick = 0; tick < 120; tick += 1) runtime.step();
    const saved = runtime.save();
    const monsterEntity = saved.presentation.entities.find(
      (entity) => entity.id >= MONSTER_ENTITY_ID_START,
    );
    expect(monsterEntity).toBeDefined();
    const loaded = createSimulationRuntime(createGameSimulationAdapter(context), 0, 60).load(
      saved.saveBytes,
    );
    expect(loaded.presentation).toEqual(saved.presentation);
  });

  it("supports the greybox debug-spawn input affordance", () => {
    const adapter = createGameSimulationAdapter(context);
    const runtime = createSimulationRuntime(adapter, 7, 60);
    runtime.enqueue(
      createPlayerInputCommand(0, 1, {
        combatPressed: COMBAT_PRESSED_DEBUG_SPAWN,
        forward: 0,
        right: 0,
        yawRadians: 0,
      }),
    );
    const events = runtime.step().events.map((event) => event.kind);
    expect(events).toContain("combat.spawned");
    expect(runtime.gameCounters.combatMonstersAlive).toBe(7);
  });

  it("treats presses on unbound ability slots as inert input", () => {
    const adapter = createGameSimulationAdapter(context);
    const runtime = createSimulationRuntime(adapter, 3, 60);
    runtime.enqueue(
      createPlayerInputCommand(0, 1, {
        combatPressed: COMBAT_PRESSED_SLOT_3,
        forward: 0,
        right: 0,
        yawRadians: 0,
      }),
    );
    runtime.enqueue(
      createPlayerInputCommand(1, 5, {
        combatPressed: COMBAT_PRESSED_SLOT_4,
        forward: 0,
        right: 0,
        yawRadians: 0,
      }),
    );
    for (let tick = 0; tick < 60; tick += 1) {
      expect(() => runtime.step()).not.toThrow();
    }
    expect(() => runtime.save()).not.toThrow();
  });

  it("perceives the player through navigation sight, propagates pack aggro, and returns on leash", () => {
    let state = createInitialM3CombatState(11);
    state = spawnForAi(state, "greymaw", 5, 0, MONSTER_ENTITY_ID_START);
    state = spawnForAi(state, "greymaw", 8, 0, MONSTER_ENTITY_ID_START);
    const entered = stepM3Combat(state, AI_WORLD, [0, 0.9, 0], 0, 1 / 60);
    expect(entered.state.monsters.every((monster) => monster.aggro)).toBe(true);
    expect(entered.state.monsters.every((monster) => monster.behaviorMode > 0)).toBe(true);
    expect(entered.events.filter((event) => event.kind === "combat.aggro-started")).toHaveLength(2);
    expect(entered.state.counters.monsterMovementDistanceMeters).toBeGreaterThan(0);

    let far = entered.state;
    const clearedKinds = new Set<string>();
    for (let tick = 0; tick < 10; tick += 1) {
      const step = stepM3Combat(far, AI_WORLD, [80, 0.9, 0], 0, 1 / 60);
      far = step.state;
      for (const event of step.events) clearedKinds.add(event.kind);
    }
    expect(far.monsters.every((monster) => !monster.aggro)).toBe(true);
    expect(clearedKinds.has("combat.aggro-cleared")).toBe(true);
  });

  it("turns at the authored rate and requires facing before attack commitment", () => {
    let state = spawnForAi(createInitialM3CombatState(18), "greymaw", 1.5, 0);
    const monster = state.monsters[0];
    if (monster === undefined) throw new Error("Turn-rate monster is missing");
    state = Object.freeze({
      ...state,
      monsters: Object.freeze([
        Object.freeze({
          ...monster,
          aggro: true,
          behaviorMode: CREATURE_BEHAVIOR_PURSUE,
          decisionTicks: 1,
          yawRadians: 0,
        }),
      ]),
    });
    const first = stepM3Combat(state, AI_WORLD, [0, 0.9, 0], 0, 1 / 60);
    expect(first.events.some((event) => event.kind === "combat.attack-started")).toBe(false);
    expect(Math.abs(first.state.monsters[0]?.yawRadians ?? 0)).toBeCloseTo(4 / 60, 6);

    let turning = first.state;
    let attackStarted = false;
    for (let tick = 0; tick < 30; tick += 1) {
      const stepped = stepM3Combat(turning, AI_WORLD, [0, 0.9, 0], 0, 1 / 60);
      turning = stepped.state;
      attackStarted ||= stepped.events.some((event) => event.kind === "combat.attack-started");
    }
    expect(attackStarted).toBe(true);
  });

  it("keeps authored flank ranks stable and gives the first pair opposite sides", () => {
    let state = createInitialM3CombatState(19);
    state = spawnForAi(state, "greymaw", 5, 0, MONSTER_ENTITY_ID_START);
    state = spawnForAi(state, "greymaw", 6, 0, MONSTER_ENTITY_ID_START);
    const first = state.monsters[0];
    const second = state.monsters[1];
    if (first === undefined || second === undefined) throw new Error("Flank pair is missing");
    const secondAngle = creatureFlankAngleRadians(second);
    expect(creatureFlankAngleRadians(first)).toBe(0);
    expect(secondAngle).toBe(Math.PI);
    expect(
      creatureFlankAngleRadians(
        Object.freeze({ ...second, combat: { ...second.combat, health: 1 } }),
      ),
    ).toBe(secondAngle);
  });

  it("makes the last surviving gnawer flee and keeps the transition serializable", () => {
    let state = createInitialM3CombatState(12);
    state = spawnForAi(state, "burrow-gnawer", 4, 0, MONSTER_ENTITY_ID_START);
    state = spawnForAi(state, "burrow-gnawer", 5, 0, MONSTER_ENTITY_ID_START);
    state = stepM3Combat(state, AI_WORLD, [0, 0.9, 0], 0, 1 / 60).state;
    const first = state.monsters[0];
    if (first === undefined) throw new Error("AI test pack is missing");
    state = Object.freeze({
      ...state,
      monsters: Object.freeze([
        Object.freeze({
          ...first,
          combat: Object.freeze({ ...first.combat, actionKind: COMBAT_ACTION_DOWNED, health: 0 }),
        }),
        ...state.monsters.slice(1),
      ]),
    });
    const fled = stepM3Combat(state, AI_WORLD, [0, 0.9, 0], 0, 1 / 60);
    const survivor = fled.state.monsters[1];
    expect(survivor?.aggro).toBe(false);
    expect(survivor?.behaviorMode).toBe(CREATURE_BEHAVIOR_FLEE);
    expect(fled.events.some((event) => event.kind === "creature.behavior-changed")).toBe(true);
    const view = new DataView(new ArrayBuffer(COMBAT_STATE_BYTES));
    expect(() => serializeCombatState(view, 0, fled.state)).not.toThrow();

    const downedPackmate = fled.state.monsters[0];
    const returningSurvivor = fled.state.monsters[1];
    if (downedPackmate === undefined || returningSurvivor === undefined) {
      throw new Error("Fleeing pack state disappeared");
    }
    const camped = stepM3Combat(
      Object.freeze({
        ...fled.state,
        monsters: Object.freeze([
          downedPackmate,
          Object.freeze({
            ...returningSurvivor,
            aggro: false,
            behaviorMode: CREATURE_BEHAVIOR_RETURN,
            decisionTicks: 0,
            position: returningSurvivor.homePosition,
          }),
        ]),
      }),
      AI_WORLD,
      [0, 0.9, 0],
      0,
      1 / 60,
    );
    expect(camped.state.monsters[1]?.aggro).toBe(false);
    expect(camped.events.some((event) => event.kind === "combat.aggro-started")).toBe(false);
  });

  it("lets brigands block, deterministically dodge, and yield below one-quarter health", () => {
    let state = spawnForAi(createInitialM3CombatState(13), "wayland-brigand", 1.5, 0);
    const brigand = state.monsters[0];
    if (brigand === undefined) throw new Error("AI test brigand is missing");
    const attackingPlayer = Object.freeze({
      ...state.player,
      actionId: PLAYER_ACTION_LIGHT,
      actionKind: COMBAT_ACTION_WINDUP,
      actionTicksRemaining: 10,
    });
    state = Object.freeze({
      ...state,
      monsters: Object.freeze([
        Object.freeze({
          ...brigand,
          aggro: true,
          behaviorMode: CREATURE_BEHAVIOR_PURSUE,
          decisionTicks: 1,
        }),
      ]),
      player: attackingPlayer,
    });
    const blocked = stepM3Combat(state, AI_WORLD, [0, 0.9, 0], 0, 1 / 60).state;
    expect(blocked.monsters[0]?.combat.blockHeldTicks).toBeGreaterThan(0);
    expect(blocked.monsters[0]?.combat.actionKind).toBe(COMBAT_ACTION_IDLE);

    const blockingBrigand = blocked.monsters[0];
    if (blockingBrigand === undefined) throw new Error("AI test brigand disappeared");
    const dodgeReady = Object.freeze({
      ...blocked,
      monsters: Object.freeze([
        Object.freeze({
          ...blockingBrigand,
          combat: Object.freeze({ ...blockingBrigand.combat, blockHeldTicks: 0 }),
          decisionSerial: 2,
          decisionTicks: 0,
        }),
      ]),
    });
    const dodged = stepM3Combat(dodgeReady, AI_WORLD, [0, 0.9, 0], 0, 1 / 60).state;
    expect(dodged.monsters[0]?.combat.actionKind).toBe(COMBAT_ACTION_DODGE);

    const dodgingBrigand = dodged.monsters[0];
    if (dodgingBrigand === undefined) throw new Error("AI test brigand disappeared");
    const yielded = stepM3Combat(
      Object.freeze({
        ...dodged,
        monsters: Object.freeze([
          Object.freeze({
            ...dodgingBrigand,
            combat: Object.freeze({ ...dodgingBrigand.combat, health: 20 }),
          }),
        ]),
        player: createCombatantState(PLAYER_COMBAT_SHEET),
      }),
      AI_WORLD,
      [0, 0.9, 0],
      0,
      1 / 60,
    ).state;
    expect(yielded.monsters[0]?.behaviorMode).toBe(CREATURE_BEHAVIOR_YIELD);
    expect(yielded.monsters[0]?.aggro).toBe(false);
    expect(yielded.counters.fleeTransitions).toBe(0);
  });

  it("advances both boss thresholds, summons a bounded clutch, and preserves wind-up floors", () => {
    let state = spawnForAi(createInitialM3CombatState(14), "warden-below", 10, 0);
    const boss = state.monsters[0];
    if (boss === undefined) throw new Error("AI test boss is missing");
    state = Object.freeze({
      ...state,
      monsters: Object.freeze([
        Object.freeze({
          ...boss,
          aggro: true,
          behaviorMode: CREATURE_BEHAVIOR_PURSUE,
          combat: Object.freeze({ ...boss.combat, health: 900 }),
          yawRadians: -Math.PI / 2,
        }),
      ]),
    });
    const phased = stepM3Combat(state, AI_WORLD, [0, 0.9, 0], 0, 1 / 60);
    expect(phased.state.monsters[0]?.bossPhase).toBe(2);
    expect(phased.state.monsters).toHaveLength(5);
    expect(phased.state.counters.summons).toBe(4);
    expect(phased.events.filter((event) => event.kind === "combat.boss-phase")).toHaveLength(2);
    expect(phased.events.some((event) => event.kind === "combat.hazard-warned")).toBe(true);
    expect(phased.events.some((event) => event.kind === "combat.hazard-activated")).toBe(false);
    expect(phased.state.player.conditions.burningTicks).toBe(0);
    expect(phased.events.filter((event) => event.kind === "combat.hazard-warned")).toHaveLength(1);
    expect(
      phased.state.monsters.every((entry) => creatureEncounterGroupId(entry) === boss.entityId),
    ).toBe(true);
    const bossAttack = phased.events.find(
      (event) => event.kind === "combat.attack-started" && event.values[0] === boss.entityId,
    );
    if (bossAttack === undefined) throw new Error("Boss did not start its expected attack");
    expect(bossAttack.values[2]).toBeGreaterThanOrEqual(44);

    let quenchedState = stepM3Combat(state, AI_WORLD, [0, 0.9, 0], 0, 1 / 60, PLAYER_COMBAT_SHEET, {
      bossVentsDoused: true,
    }).state;
    const quenchedEvents: Array<{ readonly kind: string }> = [];
    for (let tick = 0; tick < 60; tick += 1) {
      const stepped = stepM3Combat(
        quenchedState,
        AI_WORLD,
        [0, 0.9, 0],
        0,
        1 / 60,
        PLAYER_COMBAT_SHEET,
        { bossVentsDoused: true },
      );
      quenchedState = stepped.state;
      quenchedEvents.push(...stepped.events);
    }
    expect(quenchedEvents.some((event) => event.kind === "combat.hazard-warned")).toBe(false);
    expect(quenchedEvents.some((event) => event.kind === "combat.hazard-activated")).toBe(false);
    expect(quenchedState.player.conditions.burningTicks).toBe(0);

    let ventState = phased.state;
    const ventEvents: Array<{ readonly kind: string }> = [];
    for (let tick = 0; tick < 60; tick += 1) {
      const stepped = stepM3Combat(ventState, AI_WORLD, [0, 0.9, 0], 0, 1 / 60);
      ventState = stepped.state;
      ventEvents.push(...stepped.events);
    }
    expect(ventEvents.some((event) => event.kind === "combat.hazard-activated")).toBe(true);
    expect(ventState.player.conditions.burningTicks).toBeGreaterThan(0);
  });

  it("keeps phase-two boss vents dormant outside active combat", () => {
    let state = spawnForAi(createInitialM3CombatState(15), "warden-below", 10, 0);
    const boss = state.monsters[0];
    if (boss === undefined) throw new Error("AI test boss is missing");
    state = Object.freeze({
      ...state,
      monsters: Object.freeze([
        Object.freeze({
          ...boss,
          aggro: false,
          bossPhase: 2,
          decisionTicks: 2,
          hazardCooldownTicks: 0,
        }),
      ]),
    });
    const dormant = stepM3Combat(state, AI_WORLD, [0, 0.9, 0], 0, 1 / 60);
    expect(dormant.events.some((event) => event.kind === "combat.hazard-warned")).toBe(false);
    expect(dormant.events.some((event) => event.kind === "combat.hazard-activated")).toBe(false);
    expect(dormant.state.player.conditions.burningTicks).toBe(0);
  });

  it("does not emit idle-home behavior churn when the player respawns", () => {
    let state = spawnForAi(createInitialM3CombatState(16), "burrow-gnawer", 4, 0);
    state = Object.freeze({
      ...state,
      player: Object.freeze({
        ...state.player,
        actionKind: COMBAT_ACTION_DOWNED,
        health: 0,
      }),
      playerDownTicks: PLAYER_RESPAWN_TICKS - 1,
    });
    const respawned = stepM3Combat(state, AI_WORLD, [0, 0.9, 0], 0, 1 / 60);
    expect(respawned.respawnPlayer).toBe(true);
    expect(respawned.state.monsters[0]?.behaviorMode).toBe(CREATURE_BEHAVIOR_IDLE);
    expect(respawned.events.some((event) => event.kind === "creature.behavior-changed")).toBe(
      false,
    );
    expect(respawned.state.counters.behaviorTransitions).toBe(0);
  });

  it("tries fallback steering when bounds collapse the direct movement candidate", () => {
    const edgeWorld: CombatWorldView = Object.freeze({
      ...AI_WORLD,
      maximumX: 2,
    });
    const spawned = spawnMonster(
      createInitialM3CombatState(17),
      monsterKitIndex("greymaw"),
      1,
      0,
      edgeWorld,
    );
    if (spawned === null) throw new Error("Edge-steering monster spawn failed");
    const monster = spawned.state.monsters[0];
    if (monster === undefined) throw new Error("Edge-steering monster is missing");
    const pursuing = Object.freeze({
      ...spawned.state,
      monsters: Object.freeze([
        Object.freeze({
          ...monster,
          aggro: true,
          behaviorMode: CREATURE_BEHAVIOR_PURSUE,
          decisionTicks: 1,
          yawRadians: Math.PI / 2,
        }),
      ]),
    });
    const moved = stepM3Combat(pursuing, edgeWorld, [10, 0.9, 0], 0, 1 / 60).state.monsters[0];
    expect(moved?.position[0]).toBe(1);
    expect(Math.abs(moved?.position[2] ?? 0)).toBeGreaterThan(0);
  });

  it("caps the serialized roster by releasing the oldest corpse for replacements", () => {
    const flatWorld = AI_WORLD;
    const kitIndex = monsterKitIndex("burrow-gnawer");
    const downedCombat = Object.freeze({
      ...createCombatantState(deriveMonsterSheet(kitIndex)),
      actionKind: COMBAT_ACTION_DOWNED,
      health: 0,
    });
    let state = createInitialM3CombatState(1);
    // Fill the roster to its serialized capacity with retained corpses.
    for (let index = 0; index < MAXIMUM_MONSTER_ENTRIES; index += 1) {
      const spawned = spawnMonster(state, kitIndex, index, 0, flatWorld);
      if (spawned === null) throw new Error("Test roster spawn failed");
      state = Object.freeze({
        ...spawned.state,
        monsters: Object.freeze(
          spawned.state.monsters.map((entry, position) =>
            position === spawned.state.monsters.length - 1
              ? Object.freeze({ ...entry, combat: downedCombat })
              : entry,
          ),
        ),
      });
    }
    expect(state.monsters.length).toBe(MAXIMUM_MONSTER_ENTRIES);
    // Replacements while corpses are retained must stay inside the fixed block.
    for (let extra = 0; extra < MAXIMUM_ALIVE_MONSTERS; extra += 1) {
      const spawned = spawnMonster(state, kitIndex, extra, 5, flatWorld);
      if (spawned === null) throw new Error("Replacement spawn was rejected");
      state = spawned.state;
      expect(state.monsters.length).toBeLessThanOrEqual(MAXIMUM_MONSTER_ENTRIES);
    }
    const view = new DataView(new ArrayBuffer(COMBAT_STATE_BYTES));
    expect(() => serializeCombatState(view, 0, state)).not.toThrow();
  });

  it("rejects a save whose combat block claims an overfull monster roster", () => {
    const adapter = createGameSimulationAdapter(context);
    const bytes = adapter.serializeState(adapter.createInitialState(1));
    // Combat block sits after the header and NPC block; monster count lives at +20.
    const combatOffset = 96 + 48 * 32;
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
      combatOffset + 20,
      17,
      true,
    );
    expect(() => adapter.deserializeState(bytes)).toThrow(/too many monsters/);
  });

  it("rejects noncanonical reserved bytes in serialized creature AI state", () => {
    const adapter = createGameSimulationAdapter(context);
    const bytes = adapter.serializeState(adapter.createInitialState(1));
    const combatOffset = 96 + 48 * 32;
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
      combatOffset + 112,
      1,
      true,
    );
    expect(() => adapter.deserializeState(bytes)).toThrow(/noncanonical header bytes/);

    const creatureBytes = adapter.serializeState(adapter.createInitialState(1));
    const firstCreatureOffset = combatOffset + COMBAT_HEADER_BYTES + COMBATANT_STATE_BYTES;
    new DataView(
      creatureBytes.buffer,
      creatureBytes.byteOffset,
      creatureBytes.byteLength,
    ).setUint32(firstCreatureOffset + 180, 1, true);
    expect(() => adapter.deserializeState(creatureBytes)).toThrow(/noncanonical reserved bytes/);
  });
});
