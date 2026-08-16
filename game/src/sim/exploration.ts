import type { SimulationWorldDefinition } from "@parallax/engine";
import { LANDMARK_RULES_VERSION } from "../balance/exploration";
import { NAMED_LANDMARKS, type NamedLandmarkDefinition } from "../world/landmarks";
import { countSetBits, lowBitsMask } from "./bitmask";

export const EXPLORATION_STATE_BYTES = 16;
const EMPTY_LANDMARK_DISCOVERIES: readonly LandmarkDiscovery[] = Object.freeze([]);

export interface ExplorationState {
  readonly discoveredLandmarkCount: number;
  readonly discoveredLandmarkMask: number;
  readonly landmarkNominalExperienceAwarded: number;
}

export interface LandmarkDiscovery {
  readonly index: number;
  readonly landmark: NamedLandmarkDefinition;
}

export interface LandmarkDiscoveryResult {
  readonly discoveries: readonly LandmarkDiscovery[];
  readonly state: ExplorationState;
}

export interface ResolvedNamedLandmark {
  readonly index: number;
  readonly landmark: NamedLandmarkDefinition;
  readonly position: readonly [number, number, number];
  readonly radiusSquaredMeters: number;
}

export function createInitialExplorationState(): ExplorationState {
  return Object.freeze({
    discoveredLandmarkCount: 0,
    discoveredLandmarkMask: 0,
    landmarkNominalExperienceAwarded: 0,
  });
}

export function discoverNearbyLandmarks(
  state: ExplorationState,
  landmarks: readonly ResolvedNamedLandmark[],
  position: readonly [number, number, number],
): LandmarkDiscoveryResult {
  let discoveries: LandmarkDiscovery[] | undefined;
  let discoveredLandmarkMask = state.discoveredLandmarkMask;
  let landmarkNominalExperienceAwarded = state.landmarkNominalExperienceAwarded;
  for (const { index, landmark, position: landmarkPosition, radiusSquaredMeters } of landmarks) {
    if ((discoveredLandmarkMask & (1 << index)) !== 0) continue;
    const deltaX = position[0] - landmarkPosition[0];
    const deltaZ = position[2] - landmarkPosition[2];
    if (deltaX * deltaX + deltaZ * deltaZ > radiusSquaredMeters) continue;
    discoveredLandmarkMask |= 1 << index;
    landmarkNominalExperienceAwarded += landmark.experience;
    discoveries ??= [];
    discoveries.push(Object.freeze({ index, landmark }));
  }
  if (discoveries === undefined) {
    return Object.freeze({ discoveries: EMPTY_LANDMARK_DISCOVERIES, state });
  }
  const next = Object.freeze({
    discoveredLandmarkCount: state.discoveredLandmarkCount + discoveries.length,
    discoveredLandmarkMask: discoveredLandmarkMask >>> 0,
    landmarkNominalExperienceAwarded,
  });
  assertExplorationState(next);
  return Object.freeze({ discoveries: Object.freeze(discoveries), state: next });
}

export function resolveNamedLandmarks(
  world: SimulationWorldDefinition,
): readonly ResolvedNamedLandmark[] {
  const markerById = new Map(world.markers.map((marker) => [marker.id, marker] as const));
  const districtLandmarks = NAMED_LANDMARKS.flatMap((landmark, index) =>
    landmark.districtId === world.id ? [Object.freeze({ index, landmark })] : [],
  );
  const landmarkMarkerIds = new Set(districtLandmarks.map(({ landmark }) => landmark.markerId));
  for (const marker of world.markers) {
    if (marker.tags.includes("landmark") && !landmarkMarkerIds.has(marker.id)) {
      throw new Error(`Authored landmark marker ${marker.id} has no named-landmark definition`);
    }
  }
  return Object.freeze(
    districtLandmarks.map(({ index, landmark }) => {
      const marker = markerById.get(landmark.markerId);
      if (marker === undefined || !marker.tags.includes("landmark")) {
        throw new Error(`Named landmark ${landmark.id} has no tagged authored world marker`);
      }
      return Object.freeze({
        index,
        landmark,
        position: marker.position,
        radiusSquaredMeters: landmark.discoveryRadiusMeters ** 2,
      });
    }),
  );
}

export function serializeExplorationState(
  view: DataView,
  offset: number,
  state: ExplorationState,
): void {
  assertExplorationState(state);
  view.setUint32(offset, state.discoveredLandmarkMask, true);
  view.setUint32(offset + 4, state.discoveredLandmarkCount, true);
  view.setUint32(offset + 8, state.landmarkNominalExperienceAwarded, true);
  view.setUint32(offset + 12, LANDMARK_RULES_VERSION, true);
}

export function deserializeExplorationState(view: DataView, offset: number): ExplorationState {
  if (view.getUint32(offset + 12, true) !== LANDMARK_RULES_VERSION) {
    throw new Error("Game exploration state has an unsupported landmark rules version");
  }
  const state = Object.freeze({
    discoveredLandmarkCount: view.getUint32(offset + 4, true),
    discoveredLandmarkMask: view.getUint32(offset, true),
    landmarkNominalExperienceAwarded: view.getUint32(offset + 8, true),
  });
  assertExplorationState(state);
  return state;
}

export function assertExplorationState(state: ExplorationState): void {
  const knownMask = lowBitsMask(NAMED_LANDMARKS.length);
  const discoveredMask = state.discoveredLandmarkMask >>> 0;
  const discoveredCount = countSetBits(discoveredMask);
  const expectedExperience = NAMED_LANDMARKS.reduce(
    (sum, landmark, index) =>
      sum + ((discoveredMask & (1 << index)) === 0 ? 0 : landmark.experience),
    0,
  );
  if (
    !Number.isSafeInteger(state.discoveredLandmarkMask) ||
    state.discoveredLandmarkMask < 0 ||
    state.discoveredLandmarkMask > 0xffff_ffff ||
    (discoveredMask & ~knownMask) !== 0 ||
    state.discoveredLandmarkCount !== discoveredCount ||
    state.landmarkNominalExperienceAwarded !== expectedExperience
  ) {
    throw new Error("Game exploration state is invalid");
  }
}
