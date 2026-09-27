import type { GreyboxDistrictSpec } from "./greybox-spec";

/** The admitted K1 timber-framed wall kit (assets/library/d1-timber-walls.json). Game content
 * records the admitted candidate; runtime never reads source paths. */
export const D1_TIMBER_WALLS = Object.freeze({
  assetId: "d1-timber-walls",
  candidateSha256: "0d77a496013b94526d03f74ed4355ba06c39f940c0c2d12eb0f7bc290a04e9e6",
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
export const DISTRICT_1_TEST_HOUSE: AssetPlacement = Object.freeze({
  id: "k1-test-house",
  assetId: D1_TIMBER_WALLS.assetId,
  assembly: "test-house",
  collision: true,
  center: [8.5, 30.4] as const,
  heightAnchor: [8.9, 43.05] as const,
  heightOffset: -0.03,
  rotationYRadians: Math.PI / 2,
  lodDistancesMeters: D1_TIMBER_WALLS.lodDistancesMeters,
});
