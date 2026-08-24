import type {
  StreamingDistrictSwapScenarioDefinition,
  StreamingDistrictSwapScenarioStep,
} from "@parallax/engine";
import { STANDARD_TRAVERSAL_SPEED_METERS_PER_SECOND } from "../balance/exploration";
import { GREYBOX_DISTRICT_SPECS } from "./district-registry";
import {
  PARALLAX_WORLD_GRAPH,
  resolveWorldGraphTransition,
  type WorldGraphEndpoint,
} from "./world-graph";

export const M4_DISTRICT_SWAP_SCENARIO_ID = "m4-district-swap@1";

function step(endpoint: WorldGraphEndpoint): StreamingDistrictSwapScenarioStep {
  const resolved = resolveWorldGraphTransition(
    PARALLAX_WORLD_GRAPH,
    GREYBOX_DISTRICT_SPECS,
    endpoint.districtId,
    endpoint.markerId,
  );
  return Object.freeze({
    destinationDistrictId: resolved.destination.districtId,
    entranceId: resolved.entranceId,
    initialObservers: Object.freeze([resolved.destinationPosition]),
    prefetchTriggerDistanceMeters: resolved.prefetchTriggerDistanceMeters,
    sourceDistrictId: resolved.source.districtId,
    traversalSpeedMetersPerSecond: STANDARD_TRAVERSAL_SPEED_METERS_PER_SECOND,
  });
}

export const M4_DISTRICT_SWAP_SCENARIO: StreamingDistrictSwapScenarioDefinition = Object.freeze({
  id: M4_DISTRICT_SWAP_SCENARIO_ID,
  steps: Object.freeze(
    PARALLAX_WORLD_GRAPH.transitions.flatMap(({ endpoints }) => [
      step(endpoints[0]),
      step(endpoints[1]),
    ]),
  ),
  version: 2,
});
