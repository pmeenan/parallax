import type { GreyboxDistrictSpec } from "./greybox-spec";

/** The admitted K1 timber-framed wall kit (assets/library/d1-timber-walls.json). Game content
 * records the admitted candidate; runtime never reads source paths. */
export const D1_TIMBER_WALLS = Object.freeze({
  assetId: "d1-timber-walls",
  candidateSha256: "d867ad2645cbebb6bd57d779d78c642530a7e4f6a21e0fb77ede424a99841d5e",
  /** The kit's LOD switches, as its step-1 delivery measured them. */
  lodDistancesMeters: [12, 40] as const,
});

type AssetPlacement = NonNullable<GreyboxDistrictSpec["assetPlacements"]>[number];

/**
 * The K1 test house (K1 delivery step 2), beside the courtyard's paving pad on ground that varies
 * 7 cm under its footprint. It turns a quarter so its front faces +X, toward the morning sun.
 * The house stands on the highest ground under it, 3 cm down: its plinth reaches 9 cm below its
 * floor, so it stays buried everywhere. Assembly A1 fits houses to terrain at the well court.
 */
const TEST_HOUSE_SITE = Object.freeze({
  center: [8.5, 30.4] as const,
  heightAnchor: [8.9, 43.05] as const,
  heightOffset: -0.03,
  rotationYRadians: Math.PI / 2,
});

export const DISTRICT_1_TEST_HOUSE: AssetPlacement = Object.freeze({
  id: "k1-test-house",
  assetId: D1_TIMBER_WALLS.assetId,
  assembly: "test-house",
  collision: true,
  ...TEST_HOUSE_SITE,
  lodDistancesMeters: D1_TIMBER_WALLS.lodDistancesMeters,
});

/** The admitted K2 terracotta roof kit (assets/library/d1-terracotta-roof.json). Its test-house
 * assembly shares the wall kit's house frame, so it stands with the same request geometry. */
export const D1_TERRACOTTA_ROOF = Object.freeze({
  assetId: "d1-terracotta-roof",
  candidateSha256: "7fd24cd49029d3c96856f0320625533e824d12b6749cb4c978cb893f26157952",
  lodDistancesMeters: [12, 40] as const,
});

/** The K1 test house's roof (K2 delivery): the walls' request with the roof kit's assembly. The
 * walls' collision box already covers the footprint, and nothing reaches the roof. */
export const DISTRICT_1_TEST_HOUSE_ROOF: AssetPlacement = Object.freeze({
  id: "k2-test-house-roof",
  assetId: D1_TERRACOTTA_ROOF.assetId,
  assembly: "test-house",
  ...TEST_HOUSE_SITE,
  lodDistancesMeters: D1_TERRACOTTA_ROOF.lodDistancesMeters,
});
