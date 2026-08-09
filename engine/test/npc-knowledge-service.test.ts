import { describe, expect, it } from "vitest";
import type { NpcKnowledgeProvider } from "../src/ai/npc-knowledge-contract";
import { createNpcKnowledgeService } from "../src/ai/npc-knowledge-service";

describe("NPC knowledge service", () => {
  it("assembles stable ranked citations within the token budget", async () => {
    const service = createNpcKnowledgeService(
      [
        provider("world", [
          candidate("road", "The east road is open.", 80, 0.9),
          candidate("inn", "The shoreward alehouse has rooms.", 50, 1),
        ]),
        provider("relationships", [candidate("trust", "Mara trusts the player.", 80, 0.8)]),
      ],
      { estimateTokens: (text) => (text.includes("alehouse") ? 20 : 5), now: clock() },
    );
    const context = await service.assemble({
      maximumTokens: 10,
      npcId: "mara-venn",
      playerText: "Is the road safe?",
      tags: ["road"],
    });
    expect(context).toEqual({
      entries: [
        expect.objectContaining({ citation: "[world:road]", id: "road", tokenCount: 5 }),
        expect.objectContaining({ citation: "[relationships:trust]", id: "trust", tokenCount: 5 }),
      ],
      formattedText:
        "[world:road] The east road is open.\n[relationships:trust] Mara trusts the player.",
      tokenCount: 10,
    });
    expect(service.snapshot()).toMatchObject({
      assembledEntryCount: 2,
      candidateCount: 3,
      providerCount: 2,
      requestCount: 1,
      state: "ready",
    });
  });

  it("fails closed on invalid providers, duplicate candidates, and provider errors", async () => {
    expect(() => createNpcKnowledgeService([provider("same", []), provider("same", [])])).toThrow(
      /duplicated/,
    );
    const duplicate = createNpcKnowledgeService([
      provider("world", [candidate("road", "One.", 1, 1), candidate("road", "Two.", 1, 1)]),
    ]);
    await expect(
      duplicate.assemble({
        maximumTokens: 64,
        npcId: "mara-venn",
        playerText: "Road?",
        tags: [],
      }),
    ).rejects.toThrow(/duplicated/);
    expect(duplicate.snapshot()).toMatchObject({ failureCount: 1, state: "failed" });
  });

  it("snapshots provider identity and retrieval at registration", async () => {
    const mutable = {
      id: "stable",
      retrieve: async () => [candidate("first", "Registered fact.", 1, 1)],
      tier: "structured-game-state" as const,
    };
    const service = createNpcKnowledgeService([mutable]);
    mutable.id = "mutated";
    mutable.retrieve = async () => [candidate("second", "Replacement fact.", 1, 1)];
    const context = await service.assemble({
      maximumTokens: 64,
      npcId: "mara-venn",
      playerText: "Fact?",
      tags: [],
    });
    expect(context.formattedText).toBe("[stable:first] Registered fact.");
  });

  it("propagates cancellation and disposes active retrieval", async () => {
    let providerWasAborted = (): boolean => false;
    const service = createNpcKnowledgeService([
      {
        id: "slow",
        tier: "structured-game-state",
        retrieve: (_request, signal) => {
          providerWasAborted = () => signal.aborted;
          return new Promise(() => undefined);
        },
      },
    ]);
    const pending = service.assemble({
      maximumTokens: 64,
      npcId: "mara-venn",
      playerText: "Road?",
      tags: [],
    });
    service.dispose();
    await expect(pending).rejects.toThrow(/disposed/);
    expect(providerWasAborted()).toBe(true);
    expect(service.snapshot()).toMatchObject({ activeRequestCount: 0, state: "disposed" });
  });
});

function provider(
  id: string,
  candidates: readonly ReturnType<typeof candidate>[],
): NpcKnowledgeProvider {
  return { id, retrieve: async () => candidates, tier: "structured-game-state" };
}

function candidate(id: string, text: string, priority: number, relevance: number) {
  return { id, priority, relevance, tags: [], text } as const;
}

function clock(): () => number {
  let value = 0;
  return () => (value += 2);
}
