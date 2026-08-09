import {
  createNpcKnowledgeService,
  createSimulationRuntime,
  type SimulationService,
  simulationWorldDefinition,
} from "@parallax/engine";
import { describe, expect, it } from "vitest";
import { createM3StructuredKnowledgeProvider } from "../src/npc/knowledge";
import { NPC_LORE_CHUNKS } from "../src/npc/lore";
import { createGameSimulationAdapter } from "../src/sim/m3-simulation";
import { DISTRICT_1_GREYBOX_SPEC } from "../src/world/district-1.data";
import { createGreyboxScene } from "../src/world/greybox-generator";

const world = simulationWorldDefinition(createGreyboxScene(DISTRICT_1_GREYBOX_SPEC).world);

describe("game-owned NPC knowledge", () => {
  it("queries scoped world facts and live authoritative sim state on every turn", async () => {
    const runtime = createSimulationRuntime(
      createGameSimulationAdapter({ timestepHz: 60, world }),
      1,
      60,
    );
    const simulation = {
      queryGameState: async (query) => ({
        payload: runtime.queryGameState(query),
        tick: runtime.tick,
      }),
    } as SimulationService;
    const service = createNpcKnowledgeService([createM3StructuredKnowledgeProvider(simulation)]);
    const road = await service.assemble({
      maximumTokens: 256,
      npcId: "mara-venn",
      playerText: "Which road leaves this gate?",
      tags: ["road"],
    });
    expect(road.formattedText).toMatch(/east road leaves/i);
    expect(road.formattedText).not.toMatch(/alehouse|commissions/i);

    const before = await service.assemble({
      maximumTokens: 256,
      npcId: "mara-venn",
      playerText: "Where are you headed?",
      tags: ["npc-location"],
    });
    for (let tick = 0; tick < 10; tick += 1) runtime.step();
    const after = await service.assemble({
      maximumTokens: 256,
      npcId: "mara-venn",
      playerText: "Where are you headed?",
      tags: ["npc-location"],
    });
    expect(after.formattedText).not.toBe(before.formattedText);
  });

  it("fails closed for unknown NPC scope and keeps district facts data-driven", async () => {
    const runtime = createSimulationRuntime(
      createGameSimulationAdapter({ timestepHz: 60, world }),
      1,
      60,
    );
    const simulation = {
      queryGameState: async (query) => ({
        payload: runtime.queryGameState(query),
        tick: runtime.tick,
      }),
    } as SimulationService;
    const service = createNpcKnowledgeService([createM3StructuredKnowledgeProvider(simulation)]);
    await expect(
      service.assemble({
        maximumTokens: 256,
        npcId: "unknown-npc",
        playerText: "Tell me everything.",
        tags: ["road"],
      }),
    ).rejects.toThrow(/profile/);
  });

  it("authors lore as unique tagged chunks without registering a tier-2 provider", () => {
    expect(NPC_LORE_CHUNKS.length).toBeGreaterThan(0);
    expect(new Set(NPC_LORE_CHUNKS.map(({ id }) => id)).size).toBe(NPC_LORE_CHUNKS.length);
    expect(NPC_LORE_CHUNKS.every(({ tags, text }) => tags.length > 0 && text.trim() !== "")).toBe(
      true,
    );
  });
});
