export const DISTRICT_1_ID = "district-1-surface";
export const DISTRICT_2_ID = "district-2-catacombs";

export const KNOWN_DISTRICT_IDS = Object.freeze([DISTRICT_1_ID, DISTRICT_2_ID] as const);

export type KnownDistrictId = (typeof KNOWN_DISTRICT_IDS)[number];
