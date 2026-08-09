import type { NpcDialogIntentDefinition } from "@parallax/engine";
import { NPC_ENTITY_ID_START } from "./identity";

export interface NpcFallbackReply {
  readonly keywords: readonly string[];
  readonly speech: string;
}

export interface NpcPersonaCard {
  readonly authoredFallback: Readonly<{
    readonly defaultReply: string;
    readonly opening: string;
    readonly replies: readonly NpcFallbackReply[];
  }>;
  readonly displayName: string;
  readonly entityId: number;
  readonly id: string;
  readonly intentDefinitions: readonly NpcDialogIntentDefinition[];
  readonly retrievedContext: readonly string[];
  readonly systemPrompt: string;
}

export const NPC_PERSONA_CARDS: readonly NpcPersonaCard[] = Object.freeze([
  Object.freeze({
    authoredFallback: Object.freeze({
      defaultReply:
        "I should keep my eyes on the gate, but I can spare a moment. Ask me about the road, the inn, or work in the village.",
      opening: "Mara Venn, east-gate watch. The road is quiet for now. What do you need?",
      replies: Object.freeze([
        Object.freeze({
          keywords: Object.freeze(["road", "travel", "gate", "safe"]),
          speech:
            "The east road is open and the gate watch has seen no trouble today. Stay on the marked path after dusk.",
        }),
        Object.freeze({
          keywords: Object.freeze(["inn", "sleep", "bed", "room"]),
          speech:
            "Try the shoreward alehouse. If its rooms are full, the hearth keeper sometimes rents the loft.",
        }),
        Object.freeze({
          keywords: Object.freeze(["work", "job", "help", "quest"]),
          speech:
            "The field crews always need hands, and the forge posts commissions by the village well. Neither depends on my gift for conversation.",
        }),
      ]),
    }),
    displayName: "Mara Venn",
    entityId: NPC_ENTITY_ID_START,
    id: "mara-venn",
    intentDefinitions: Object.freeze([
      Object.freeze({
        description:
          "Offer the player an authored route without changing quest, gate, trade, or inventory state.",
        kind: "offer_directions",
        subjects: Object.freeze(["east-road", "shoreward-alehouse", "village-well"]),
      }),
    ]),
    retrievedContext: Object.freeze([
      "The east road is open and the watch has observed no hazard today.",
      "The shoreward alehouse and village-well commission board are available authored destinations.",
    ]),
    systemPrompt:
      "You are Mara Venn, a practical watch officer at a bright shore village's east gate. Speak concisely, warmly, and as a person rather than a quest dispenser. Never invent world facts outside retrieved context or memory. Never claim that an action happened; select only an allowed structured intent, and use no_action/none for flavor-only speech.",
  }),
]);

export function requireNpcPersonaByEntityId(entityId: number): NpcPersonaCard {
  const persona = NPC_PERSONA_CARDS.find((candidate) => candidate.entityId === entityId);
  if (persona === undefined) throw new Error(`NPC entity ${entityId} has no authored persona card`);
  return persona;
}
