import {
  LANDMARK_DISCOVERY_EXPERIENCE,
  LANDMARK_DISCOVERY_RADIUS_METERS,
} from "../balance/exploration";
import { DISTRICT_1_ID, KNOWN_DISTRICT_IDS, type KnownDistrictId } from "./district-identity";

export const LANDMARK_CAPACITY = 31;

// Stable array order is serialized as the discovery bitset identity. Append new
// landmarks rather than reordering existing entries.
export interface NamedLandmarkDefinition {
  readonly discoveryRadiusMeters: number;
  readonly districtId: KnownDistrictId;
  readonly experience: number;
  readonly id: string;
  readonly markerId: string;
  readonly name: string;
}

export const NAMED_LANDMARKS: readonly NamedLandmarkDefinition[] = Object.freeze([
  Object.freeze({
    discoveryRadiusMeters: LANDMARK_DISCOVERY_RADIUS_METERS,
    districtId: DISTRICT_1_ID,
    experience: LANDMARK_DISCOVERY_EXPERIENCE,
    id: "castle-gate-waystone",
    markerId: "d1-player-spawn-waystone",
    name: "Castle Gate Waystone",
  }),
  Object.freeze({
    discoveryRadiusMeters: LANDMARK_DISCOVERY_RADIUS_METERS,
    districtId: DISTRICT_1_ID,
    experience: LANDMARK_DISCOVERY_EXPERIENCE,
    id: "village-square-waystone",
    markerId: "d1-landmark-village-square",
    name: "Village Square Waystone",
  }),
  Object.freeze({
    discoveryRadiusMeters: LANDMARK_DISCOVERY_RADIUS_METERS,
    districtId: DISTRICT_1_ID,
    experience: LANDMARK_DISCOVERY_EXPERIENCE,
    id: "forest-edge-waystone",
    markerId: "d1-landmark-forest-edge",
    name: "Forest Edge Waystone",
  }),
  Object.freeze({
    discoveryRadiusMeters: LANDMARK_DISCOVERY_RADIUS_METERS,
    districtId: DISTRICT_1_ID,
    experience: LANDMARK_DISCOVERY_EXPERIENCE,
    id: "castle-undercroft",
    markerId: "d1-transition-castle-catacomb",
    name: "Castle Undercroft",
  }),
  Object.freeze({
    discoveryRadiusMeters: LANDMARK_DISCOVERY_RADIUS_METERS,
    districtId: DISTRICT_1_ID,
    experience: LANDMARK_DISCOVERY_EXPERIENCE,
    id: "village-well",
    markerId: "d1-transition-village-well",
    name: "Village Well",
  }),
  Object.freeze({
    discoveryRadiusMeters: LANDMARK_DISCOVERY_RADIUS_METERS,
    districtId: DISTRICT_1_ID,
    experience: LANDMARK_DISCOVERY_EXPERIENCE,
    id: "forest-throat",
    markerId: "d1-transition-forest-ruin",
    name: "Forest Throat",
  }),
]);

export function assertNamedLandmarkDefinitions(
  landmarks: readonly NamedLandmarkDefinition[],
): void {
  if (landmarks.length > LANDMARK_CAPACITY) {
    throw new Error("Named-landmark vocabulary exceeds the persisted mask");
  }
  const ids = new Set<string>();
  const markerIds = new Set<string>();
  let totalExperience = 0;
  for (const landmark of landmarks) {
    if (
      landmark.id.length === 0 ||
      landmark.markerId.length === 0 ||
      landmark.name.length === 0 ||
      ids.has(landmark.id) ||
      markerIds.has(landmark.markerId) ||
      !KNOWN_DISTRICT_IDS.some((districtId) => districtId === landmark.districtId) ||
      !Number.isSafeInteger(landmark.experience) ||
      landmark.experience <= 0 ||
      !Number.isFinite(landmark.discoveryRadiusMeters) ||
      landmark.discoveryRadiusMeters <= 0
    ) {
      throw new Error(`Named-landmark definition ${landmark.id || "<empty>"} is invalid`);
    }
    ids.add(landmark.id);
    markerIds.add(landmark.markerId);
    totalExperience += landmark.experience;
  }
  if (!Number.isSafeInteger(totalExperience) || totalExperience > 0xffff_ffff) {
    throw new Error("Named-landmark nominal experience exceeds the persisted total");
  }
}

assertNamedLandmarkDefinitions(NAMED_LANDMARKS);
