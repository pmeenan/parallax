import { NPC_ENTITY_ID_START } from "./identity";

export interface M3NpcKnowledgeFact {
  readonly id: string;
  readonly npcIds: readonly string[];
  readonly priority: number;
  readonly tags: readonly string[];
  readonly text: string;
}

export interface M3NpcKnowledgeProfile {
  readonly displayName: string;
  readonly entityId: number;
  readonly npcId: string;
}

export const M3_NPC_KNOWLEDGE_PROFILES: readonly M3NpcKnowledgeProfile[] = deepFreeze([
  { displayName: "Mara Venn", entityId: NPC_ENTITY_ID_START, npcId: "mara-venn" },
]);

export const M3_NPC_KNOWLEDGE_DISTRICTS: Readonly<Record<string, readonly M3NpcKnowledgeFact[]>> =
  deepFreeze({
    "district-1-surface": [
      {
        id: "east-road",
        npcIds: ["mara-venn"],
        priority: 80,
        tags: ["road", "east-gate", "travel", "gate", "safe"],
        text: "The east road leaves the village through the east gate and follows the marked landward path.",
      },
      {
        id: "shoreward-alehouse",
        npcIds: ["mara-venn"],
        priority: 70,
        tags: ["inn", "lodging", "shoreward-alehouse", "sleep", "bed", "room"],
        text: "The shoreward alehouse is the village lodging place; its hearth keeper may offer the loft when the upstairs rooms are full.",
      },
      {
        id: "village-well",
        npcIds: ["mara-venn"],
        priority: 70,
        tags: ["work", "commissions", "village-well", "job", "help", "quest"],
        text: "The forge and field crews post ordinary paid commissions by the village well.",
      },
    ],
  });

function deepFreeze<const T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
