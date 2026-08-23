import { DISTRICT_1_ID, DISTRICT_2_ID, type KnownDistrictId } from "./district-identity";
import { GREYBOX_DISTRICT_SPECS } from "./district-registry";
import type { GreyboxDistrictSpec } from "./greybox-spec";
import { freezeGreyboxData } from "./greybox-spec";

export interface WorldGraphDistrict {
  readonly id: KnownDistrictId;
  readonly kind: "surface" | "underground";
}

export interface WorldGraphEndpoint {
  readonly arrivalHeadingRadians: number;
  readonly districtId: KnownDistrictId;
  readonly markerId: string;
}

export interface WorldGraphTransition {
  readonly context: string;
  readonly endpoints: readonly [WorldGraphEndpoint, WorldGraphEndpoint];
  readonly id: string;
  readonly kind: "hard";
}

export interface WorldGraph {
  readonly districts: readonly WorldGraphDistrict[];
  readonly schemaVersion: 1;
  readonly transitions: readonly WorldGraphTransition[];
}

export interface WorldGraphValidationSummary {
  readonly districtCount: number;
  readonly endpointCount: number;
  readonly transitionCount: number;
}

function requireNonEmpty(value: string, label: string): void {
  if (value.trim() === "") throw new Error(`${label} must not be empty`);
}

export function validateWorldGraph(
  graph: WorldGraph,
  districtSpecs: readonly GreyboxDistrictSpec[],
): WorldGraphValidationSummary {
  if (graph.schemaVersion !== 1) throw new Error("Unsupported world-graph schema");
  const specsById = new Map(districtSpecs.map((spec) => [spec.world.id, spec]));
  if (specsById.size !== districtSpecs.length) {
    throw new Error("World-graph district registry contains duplicate ids");
  }
  if (graph.districts.length !== districtSpecs.length) {
    throw new Error("World graph must register every greybox district exactly once");
  }

  const districtIds = new Set<string>();
  for (const district of graph.districts) {
    requireNonEmpty(district.id, "World-graph district id");
    if (districtIds.has(district.id) || !specsById.has(district.id)) {
      throw new Error(`World-graph district ${district.id} is duplicate or unknown`);
    }
    if (district.kind !== "surface" && district.kind !== "underground") {
      throw new Error(`World-graph district ${district.id} has an invalid kind`);
    }
    districtIds.add(district.id);
  }

  const transitionIds = new Set<string>();
  const endpointKeys = new Set<string>();
  for (const transition of graph.transitions) {
    requireNonEmpty(transition.id, "World-graph transition id");
    requireNonEmpty(transition.context, `World-graph transition ${transition.id} context`);
    if (transition.kind !== "hard" || transitionIds.has(transition.id)) {
      throw new Error(`World-graph transition ${transition.id} is duplicate or invalid`);
    }
    transitionIds.add(transition.id);
    if (transition.endpoints[0].districtId === transition.endpoints[1].districtId) {
      throw new Error(`World-graph transition ${transition.id} must connect distinct districts`);
    }
    for (const endpoint of transition.endpoints) {
      if (!Number.isFinite(endpoint.arrivalHeadingRadians)) {
        throw new Error(`World-graph transition ${transition.id} heading must be finite`);
      }
      const spec = specsById.get(endpoint.districtId);
      const marker = spec?.markers.find(({ id }) => id === endpoint.markerId);
      const endpointKey = `${endpoint.districtId}:${endpoint.markerId}`;
      if (
        spec === undefined ||
        marker?.kind !== "transition" ||
        endpointKeys.has(endpointKey) ||
        !marker.tags.includes("entrance") ||
        !marker.tags.includes(transition.context)
      ) {
        throw new Error(`World-graph transition ${transition.id} has an invalid endpoint`);
      }
      endpointKeys.add(endpointKey);
    }
  }

  const authoredTransitionMarkerCount = districtSpecs.reduce(
    (count, spec) => count + spec.markers.filter(({ kind }) => kind === "transition").length,
    0,
  );
  if (endpointKeys.size !== authoredTransitionMarkerCount) {
    throw new Error("Every authored transition marker must have exactly one world-graph edge");
  }

  return Object.freeze({
    districtCount: districtIds.size,
    endpointCount: endpointKeys.size,
    transitionCount: transitionIds.size,
  });
}

export const PARALLAX_WORLD_GRAPH = freezeGreyboxData({
  districts: [
    { id: DISTRICT_1_ID, kind: "surface" },
    { id: DISTRICT_2_ID, kind: "underground" },
  ],
  schemaVersion: 1,
  transitions: [
    {
      context: "castle",
      endpoints: [
        {
          arrivalHeadingRadians: Math.PI / 4,
          districtId: DISTRICT_1_ID,
          markerId: "d1-transition-castle-catacomb",
        },
        {
          arrivalHeadingRadians: 0,
          districtId: DISTRICT_2_ID,
          markerId: "d2-transition-castle-undercroft",
        },
      ],
      id: "castle-undercroft",
      kind: "hard",
    },
    {
      context: "village",
      endpoints: [
        {
          arrivalHeadingRadians: Math.PI,
          districtId: DISTRICT_1_ID,
          markerId: "d1-transition-village-well",
        },
        {
          arrivalHeadingRadians: Math.PI / 2,
          districtId: DISTRICT_2_ID,
          markerId: "d2-transition-village-well",
        },
      ],
      id: "village-well",
      kind: "hard",
    },
    {
      context: "forest",
      endpoints: [
        {
          arrivalHeadingRadians: -Math.PI / 2,
          districtId: DISTRICT_1_ID,
          markerId: "d1-transition-forest-ruin",
        },
        {
          arrivalHeadingRadians: Math.PI,
          districtId: DISTRICT_2_ID,
          markerId: "d2-transition-forest-ruin",
        },
      ],
      id: "forest-ruin",
      kind: "hard",
    },
  ],
} satisfies WorldGraph);

validateWorldGraph(PARALLAX_WORLD_GRAPH, GREYBOX_DISTRICT_SPECS);
