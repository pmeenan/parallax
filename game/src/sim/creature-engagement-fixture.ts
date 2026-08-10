// Recurring deterministic multi-creature pressure fixture for encounter-level AI.
// The duel balancer cannot observe attack-slot contention or simultaneous attacks;
// this fixture keeps those dynamics in the ordinary unit gate without a browser.
import { monsterKitIndex } from "../balance/combat";
import { COMBAT_ACTION_ACTIVE, COMBAT_ACTION_WINDUP } from "./combat-core";
import {
  type CombatWorldView,
  CREATURE_BEHAVIOR_PURSUE,
  createInitialM3CombatState,
  MONSTER_ENTITY_ID_START,
  spawnMonster,
  stepM3Combat,
} from "./m3-combat-system";

export const CREATURE_ENGAGEMENT_FIXTURE_TICKS = 240;

export interface CreatureEngagementPressureReport {
  readonly attackStarts: number;
  readonly attackSlotWaitTicks: number;
  readonly concurrentAttackerHistogram: readonly number[];
  readonly maximumConcurrentAttackers: number;
  readonly overlapTicks: number;
  readonly ticks: number;
}

const FLAT_WORLD: CombatWorldView = Object.freeze({
  canTraverseSegment: () => true,
  groundHeight: () => 0,
  isWalkablePosition: () => true,
  maximumX: 100,
  maximumZ: 100,
  minimumX: -100,
  minimumZ: -100,
  obstacles: Object.freeze([]),
});

const PACK_POSITIONS = Object.freeze([
  Object.freeze([0, 1.4] as const),
  Object.freeze([1.4, 0] as const),
  Object.freeze([0, -1.4] as const),
  Object.freeze([-1.4, 0] as const),
]);

export function runCreatureEngagementPressureFixture(): CreatureEngagementPressureReport {
  let state = createInitialM3CombatState(0x51_07);
  for (const [x, z] of PACK_POSITIONS) {
    const spawned = spawnMonster(
      state,
      monsterKitIndex("burrow-gnawer"),
      x,
      z,
      FLAT_WORLD,
      MONSTER_ENTITY_ID_START,
    );
    if (spawned === null) throw new Error("Creature engagement fixture spawn failed");
    state = spawned.state;
  }
  state = Object.freeze({
    ...state,
    monsters: Object.freeze(
      state.monsters.map((entry) =>
        Object.freeze({
          ...entry,
          aggro: true,
          behaviorMode: CREATURE_BEHAVIOR_PURSUE,
          decisionTicks: CREATURE_ENGAGEMENT_FIXTURE_TICKS + 1,
          yawRadians: Math.fround(Math.atan2(-entry.position[0], -entry.position[2])),
        }),
      ),
    ),
  });

  const histogram = Array.from({ length: PACK_POSITIONS.length + 1 }, () => 0);
  let attackStarts = 0;
  let attackSlotWaitTicks = 0;
  let maximumConcurrentAttackers = 0;
  let overlapTicks = 0;
  for (let tick = 0; tick < CREATURE_ENGAGEMENT_FIXTURE_TICKS; tick += 1) {
    const stepped = stepM3Combat(state, FLAT_WORLD, [0, 0.9, 0], 0, 1 / 60);
    state = stepped.state;
    attackStarts += stepped.events.filter((event) => event.kind === "combat.attack-started").length;
    attackSlotWaitTicks += stepped.events.filter(
      (event) => event.kind === "combat.attack-slot-waited",
    ).length;
    const concurrentAttackers = state.monsters.filter(
      (entry) =>
        entry.combat.actionKind === COMBAT_ACTION_WINDUP ||
        entry.combat.actionKind === COMBAT_ACTION_ACTIVE,
    ).length;
    histogram[concurrentAttackers] = (histogram[concurrentAttackers] ?? 0) + 1;
    maximumConcurrentAttackers = Math.max(maximumConcurrentAttackers, concurrentAttackers);
    overlapTicks += Number(concurrentAttackers > 1);
  }

  return Object.freeze({
    attackStarts,
    attackSlotWaitTicks,
    concurrentAttackerHistogram: Object.freeze(histogram),
    maximumConcurrentAttackers,
    overlapTicks,
    ticks: CREATURE_ENGAGEMENT_FIXTURE_TICKS,
  });
}
