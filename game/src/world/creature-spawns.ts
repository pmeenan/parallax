// Stable authored creature placement. District identity and pack membership are data,
// not branches in the simulation. Positions are validated against the sim navigation
// projection when an adapter is created.

export interface CreatureSpawnDefinition {
  readonly districtId: string;
  readonly id: string;
  readonly kitId: string;
  readonly packId: number;
  readonly position: readonly [number, number];
}

export const CREATURE_SPAWNS: readonly CreatureSpawnDefinition[] = Object.freeze([
  Object.freeze({
    districtId: "district-1-surface",
    id: "d1-fields-gnawer-1",
    kitId: "burrow-gnawer",
    packId: 1,
    position: Object.freeze([-900, -900] as const),
  }),
  Object.freeze({
    districtId: "district-1-surface",
    id: "d1-fields-gnawer-2",
    kitId: "burrow-gnawer",
    packId: 1,
    position: Object.freeze([-894, -906] as const),
  }),
  Object.freeze({
    districtId: "district-1-surface",
    id: "d1-fields-gnawer-3",
    kitId: "burrow-gnawer",
    packId: 1,
    position: Object.freeze([-906, -894] as const),
  }),
  Object.freeze({
    districtId: "district-1-surface",
    id: "d1-forest-greymaw-1",
    kitId: "greymaw",
    packId: 2,
    position: Object.freeze([700, 1_100] as const),
  }),
  Object.freeze({
    districtId: "district-1-surface",
    id: "d1-forest-greymaw-2",
    kitId: "greymaw",
    packId: 2,
    position: Object.freeze([708, 1_094] as const),
  }),
  Object.freeze({
    districtId: "district-1-surface",
    id: "d1-road-brigand",
    kitId: "wayland-brigand",
    packId: 3,
    position: Object.freeze([-288, 512] as const),
  }),
]);

export function creatureSpawnsForDistrict(districtId: string): readonly CreatureSpawnDefinition[] {
  return Object.freeze(CREATURE_SPAWNS.filter((spawn) => spawn.districtId === districtId));
}
