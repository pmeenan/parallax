import { GATHERING_NODE_CAPACITY, type ItemId } from "../balance/items";

// D1 gathering is deliberately readable by landscape: field food/flowers, forest
// wood/game, and shore salt/fish/salvage. Stable order is the persisted node mask.
export interface GatheringNodeDefinition {
  readonly districtId: string;
  readonly id: string;
  readonly itemId: ItemId;
  readonly position: readonly [number, number];
  readonly quantity: number;
  readonly region: "fields" | "forest" | "shore";
}

const D1 = "district-1-surface";

export const GATHERING_NODES: readonly GatheringNodeDefinition[] = Object.freeze([
  Object.freeze({
    districtId: D1,
    id: "d1-fields-grain-west",
    itemId: "grain",
    position: Object.freeze([-672, -768] as const),
    quantity: 4,
    region: "fields" as const,
  }),
  Object.freeze({
    districtId: D1,
    id: "d1-fields-bittergreen",
    itemId: "bittergreen",
    position: Object.freeze([-608, -720] as const),
    quantity: 3,
    region: "fields" as const,
  }),
  Object.freeze({
    districtId: D1,
    id: "d1-fields-emberpetal",
    itemId: "emberpetal",
    position: Object.freeze([-544, -768] as const),
    quantity: 2,
    region: "fields" as const,
  }),
  Object.freeze({
    districtId: D1,
    id: "d1-fields-grain-east",
    itemId: "grain",
    position: Object.freeze([-608, -816] as const),
    quantity: 4,
    region: "fields" as const,
  }),
  Object.freeze({
    districtId: D1,
    id: "d1-forest-timber",
    itemId: "timber",
    position: Object.freeze([576, 1_216] as const),
    quantity: 4,
    region: "forest" as const,
  }),
  Object.freeze({
    districtId: D1,
    id: "d1-forest-game",
    itemId: "game-meat",
    position: Object.freeze([640, 1_216] as const),
    quantity: 3,
    region: "forest" as const,
  }),
  Object.freeze({
    districtId: D1,
    id: "d1-forest-sinew",
    itemId: "sinew",
    position: Object.freeze([704, 1_216] as const),
    quantity: 2,
    region: "forest" as const,
  }),
  Object.freeze({
    districtId: D1,
    id: "d1-forest-hide",
    itemId: "hide",
    position: Object.freeze([640, 1_152] as const),
    quantity: 2,
    region: "forest" as const,
  }),
  Object.freeze({
    districtId: D1,
    id: "d1-shore-fish-west",
    itemId: "fish",
    position: Object.freeze([-64, -1_024] as const),
    quantity: 3,
    region: "shore" as const,
  }),
  Object.freeze({
    districtId: D1,
    id: "d1-shore-salt",
    itemId: "sea-salt",
    position: Object.freeze([0, -1_024] as const),
    quantity: 4,
    region: "shore" as const,
  }),
  Object.freeze({
    districtId: D1,
    id: "d1-shore-salvage",
    itemId: "salvage-iron",
    position: Object.freeze([64, -1_024] as const),
    quantity: 3,
    region: "shore" as const,
  }),
  Object.freeze({
    districtId: D1,
    id: "d1-shore-fish-east",
    itemId: "fish",
    position: Object.freeze([96, -960] as const),
    quantity: 3,
    region: "shore" as const,
  }),
]);

if (GATHERING_NODES.length > GATHERING_NODE_CAPACITY) {
  throw new Error("Gathering node vocabulary exceeds the persisted mask");
}

export const DISTRICT_1_GATHERING_NODES = Object.freeze(
  GATHERING_NODES.filter(({ districtId }) => districtId === D1),
);

export function gatheringNodeIndex(nodeId: string): number {
  const index = GATHERING_NODES.findIndex(({ id }) => id === nodeId);
  if (index < 0) throw new Error(`Unknown gathering node ${nodeId}`);
  return index;
}
