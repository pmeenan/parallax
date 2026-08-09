export interface NpcLoreChunk {
  readonly id: string;
  readonly tags: readonly string[];
  readonly text: string;
}

// D-033 keeps lore in independently addressable, tagged chunks from first authorship.
// M3 does not retrieve these chunks; a later measured tier-2 mechanism will consume them.
export const NPC_LORE_CHUNKS: readonly NpcLoreChunk[] = Object.freeze([
  Object.freeze({
    id: "shore-village.watch",
    tags: Object.freeze(["shore-village", "watch", "east-gate"]),
    text: "The shore village keeps paired watches at its landward gates and rings the tide bell when coastal fog hides the road.",
  }),
  Object.freeze({
    id: "shore-village.well",
    tags: Object.freeze(["shore-village", "village-well", "work"]),
    text: "The village well is also a public notice place where the forge and field crews post ordinary paid commissions.",
  }),
  Object.freeze({
    id: "shore-village.alehouse",
    tags: Object.freeze(["shore-village", "shoreward-alehouse", "lodging"]),
    text: "The shoreward alehouse rents a few upstairs rooms, while its hearth keeper sometimes opens the loft when travelers fill them.",
  }),
]);
