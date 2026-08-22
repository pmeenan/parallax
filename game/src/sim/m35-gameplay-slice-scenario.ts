import type { SimulationCommand, SimulationScenarioDefinition } from "@parallax/engine";
import { COMBAT_PRESSED_LIGHT } from "./m3-combat-system";
import {
  createAcceptQuestCommand,
  createBuyItemCommand,
  createCraftItemCommand,
  createPlayerInputCommand,
  createQuestIntentCommand,
  createSpawnMonsterCommand,
} from "./m3-simulation";

export const M35_GAMEPLAY_SLICE_SCENARIO_ID = "m35-gameplay-slice@1";
export const M35_GAMEPLAY_SLICE_SCENARIO_VERSION = 1;
export const M35_GAMEPLAY_SLICE_SCENARIO_SEED = 424_242;
export const M35_GAMEPLAY_SLICE_SCENARIO_TICKS = 8_000;

const commands: SimulationCommand[] = [];
let sequence = 0;

const add = (command: SimulationCommand): void => {
  commands.push(command);
  sequence += 1;
};
const input = (tick: number, forward: number, yawRadians: number, combatPressed = 0): void => {
  add(
    createPlayerInputCommand(sequence, tick, {
      combatPressed,
      forward,
      right: 0,
      yawRadians,
    }),
  );
};
const attack = (tick: number): void => input(tick, 0, Math.PI / 4, COMBAT_PRESSED_LIGHT);

add(createAcceptQuestCommand(sequence, 1, "a-bounty-of-teeth"));
add(createAcceptQuestCommand(sequence, 2, "cold-larder"));

for (const [spawnTick, x, z] of [
  [3, 1.5, 1.5],
  [253, 1.5, 1.5],
  [503, 1.5, 1.5],
] as const) {
  add(createSpawnMonsterCommand(sequence, spawnTick, "burrow-gnawer", x, z));
  for (let attackTick = spawnTick + 1; attackTick < spawnTick + 220; attackTick += 40) {
    attack(attackTick);
  }
}

// Follow the already-qualified east-gate approach, then visit the east market and
// hearth. These are ordinary player-input and item commands against authored markers.
input(800, 1, 1.456);
input(5_297, 0, 1.456);
input(5_300, 1, 1.199);
input(6_020, 0, 1.199);
add(createBuyItemCommand(sequence, 6_021, "fish"));
add(createBuyItemCommand(sequence, 6_022, "fish"));
add(createBuyItemCommand(sequence, 6_023, "bittergreen"));
input(6_030, 1, -Math.PI / 2);
input(6_930, 0, -Math.PI / 2);
add(createCraftItemCommand(sequence, 6_931, "fishers-stew"));
add(createQuestIntentCommand(sequence, 6_932, "deliver-cold-larder"));

export const M35_GAMEPLAY_SLICE_SCENARIO: SimulationScenarioDefinition = Object.freeze({
  commands: Object.freeze(commands),
  id: M35_GAMEPLAY_SLICE_SCENARIO_ID,
  seed: M35_GAMEPLAY_SLICE_SCENARIO_SEED,
  ticks: M35_GAMEPLAY_SLICE_SCENARIO_TICKS,
  version: M35_GAMEPLAY_SLICE_SCENARIO_VERSION,
});
