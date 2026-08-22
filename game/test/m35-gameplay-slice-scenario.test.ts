import { runSimulationReplay, simulationWorldDefinition } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import { createGameSimulationAdapter } from "../src/sim/m3-simulation";
import {
  M35_GAMEPLAY_SLICE_SCENARIO,
  M35_GAMEPLAY_SLICE_SCENARIO_ID,
} from "../src/sim/m35-gameplay-slice-scenario";
import { DISTRICT_1_GREYBOX_SPEC } from "../src/world/district-1.data";
import { createGreyboxScene } from "../src/world/greybox-generator";

const world = simulationWorldDefinition(createGreyboxScene(DISTRICT_1_GREYBOX_SPEC).world);
const context = Object.freeze({ timestepHz: 60, world });

describe("M3.5 gameplay slice scenario", () => {
  it("fights, loots, crafts, levels, and completes a multi-objective quest deterministically", () => {
    const first = runSimulationReplay(
      createGameSimulationAdapter(context),
      M35_GAMEPLAY_SLICE_SCENARIO.seed,
      60,
      M35_GAMEPLAY_SLICE_SCENARIO.commands,
      M35_GAMEPLAY_SLICE_SCENARIO.ticks,
    );
    const second = runSimulationReplay(
      createGameSimulationAdapter(context),
      M35_GAMEPLAY_SLICE_SCENARIO.seed,
      60,
      M35_GAMEPLAY_SLICE_SCENARIO.commands,
      M35_GAMEPLAY_SLICE_SCENARIO.ticks,
    );

    expect(M35_GAMEPLAY_SLICE_SCENARIO.id).toBe(M35_GAMEPLAY_SLICE_SCENARIO_ID);
    expect(M35_GAMEPLAY_SLICE_SCENARIO).toMatchObject({
      seed: 424_242,
      ticks: 8_000,
      version: 1,
    });
    expect(M35_GAMEPLAY_SLICE_SCENARIO.commands).toHaveLength(34);
    expect(second.finalStateHash).toBe(first.finalStateHash);
    expect(second.finalSave).toEqual(first.finalSave);
    expect(first.gameCounters).toMatchObject({
      combatMonstersDefeated: 3,
      itemBuyCount: 3,
      itemCraftCount: 1,
      itemLootAwardCount: 3,
      progressionLevel: 3,
      questAcceptedCount: 2,
      questCompletedCount: 2,
      questObjectiveProgressCount: 5,
      questStageCompletionCount: 2,
    });
  }, 15_000);
});
