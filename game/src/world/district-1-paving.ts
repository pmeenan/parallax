import type { GreyboxDistrictSpec } from "./greybox-spec";

/** The admitted periodic 4 m photoreal paving module (assets/library/d1-paving.json). Game
 * content records the admitted candidate; runtime never reads source paths. */
export const D1_PAVING = Object.freeze({
  assetId: "d1-photoreal-paving",
  candidateSha256: "83a0ebc0c93aebdc075d220df6882710407aff7101cfc0820fe85cbb6f135b4d",
  tileMetres: 4,
  /** The module's deepest joint is 20.7 mm below its origin. Lifting it 21 mm keeps every
   * joint above the level pad; stone tops then sit about 2 cm above the collision plane. */
  heightOffsetMeters: 0.021,
  lodDistancesMeters: Object.freeze({
    ground: [12, 32],
    pebbles: [6, 12],
    plants: [8, 24],
  } as const),
});

type AssetPlacement = NonNullable<GreyboxDistrictSpec["assetPlacements"]>[number];

/** Tiles a square of whole 4 m modules; every part of every tile shares one height anchor. */
export function createPavingTilePlacements(
  id: string,
  minimum: readonly [number, number],
  tilesPerAxis: number,
): AssetPlacement[] {
  const size = D1_PAVING.tileMetres;
  const anchor = [minimum[0] + (size * tilesPerAxis) / 2, minimum[1] + (size * tilesPerAxis) / 2];
  const placements: AssetPlacement[] = [];
  for (let row = 0; row < tilesPerAxis; row++)
    for (let column = 0; column < tilesPerAxis; column++)
      for (const part of ["ground", "pebbles", "plants"] as const)
        placements.push({
          id: `${id}-${column}-${row}-${part}`,
          assetId: D1_PAVING.assetId,
          variantId: part,
          center: [minimum[0] + size * (column + 0.5), minimum[1] + size * (row + 0.5)],
          heightAnchor: [anchor[0] ?? 0, anchor[1] ?? 0],
          heightOffset: D1_PAVING.heightOffsetMeters,
          rotationYRadians: 0,
          lodDistancesMeters: D1_PAVING.lodDistancesMeters[part],
        });
  return placements;
}
