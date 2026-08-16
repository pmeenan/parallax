export const DISTRICT_1_ID = "district-1-surface";

export const KNOWN_DISTRICT_IDS = Object.freeze([DISTRICT_1_ID] as const);

export type KnownDistrictId = (typeof KNOWN_DISTRICT_IDS)[number];
