import {
  createSimulationRuntime,
  runSimulationReplay,
  simulationWorldDefinition,
} from "@parallax/engine";
import { describe, expect, it } from "vitest";
import { monsterKitIndex } from "../src/balance/combat";
import {
  COMBAT_ACTION_DOWNED,
  createCombatantState,
  deriveMonsterSheet,
} from "../src/sim/combat-core";
import {
  COMBAT_PRESSED_DEBUG_SPAWN,
  COMBAT_PRESSED_LIGHT,
  COMBAT_PRESSED_SLOT_3,
  COMBAT_PRESSED_SLOT_4,
  COMBAT_STATE_BYTES,
  type CombatWorldView,
  createInitialM3CombatState,
  MAXIMUM_ALIVE_MONSTERS,
  MAXIMUM_MONSTER_ENTRIES,
  MONSTER_ENTITY_ID_START,
  serializeCombatState,
  spawnMonster,
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
    expect(runtime.gameCounters.combatMonstersAlive).toBe(1);
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

  it("caps the serialized roster by releasing the oldest corpse for replacements", () => {
    const flatWorld: CombatWorldView = Object.freeze({
      groundHeight: () => 0,
      maximumX: 100,
      maximumZ: 100,
      minimumX: -100,
      minimumZ: -100,
      obstacles: Object.freeze([]),
    });
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
});
