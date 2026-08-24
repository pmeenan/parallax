import type { GreyboxCell, GreyboxTriangleBoxPayload } from "@parallax/engine";
import { validateGreyboxDistrict } from "@parallax/engine";
import { describe, expect, it, vi } from "vitest";
import { DISTRICT_2_GREYBOX_SPEC } from "../src/world/district-2.data";
import { GREYBOX_DISTRICT_SPECS } from "../src/world/district-registry";
import { createGreyboxScene, sampleGreyboxTerrain } from "../src/world/greybox-generator";
import { M4_DISTRICT_SWAP_SCENARIO } from "../src/world/m4-district-swap-scenario";
import {
  PARALLAX_WORLD_GRAPH,
  resolveWorldGraphTransition,
  validateWorldGraph,
} from "../src/world/world-graph";

function detailedBoxes(cell: GreyboxCell): GreyboxTriangleBoxPayload {
  const representation = cell.lods[0].representations.find(
    (candidate) => candidate.kind === "triangle-boxes",
  );
  if (representation?.kind !== "triangle-boxes") throw new Error("Missing catacomb boxes");
  return representation;
}

describe("District 2 catacombs greybox", () => {
  it("generates a deterministic, valid 8 by 8 streamed district", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("District generation must not use Math.random");
    });
    try {
      const first = createGreyboxScene(DISTRICT_2_GREYBOX_SPEC);
      const second = createGreyboxScene(DISTRICT_2_GREYBOX_SPEC);
      const summary = validateGreyboxDistrict(first.world);

      expect(second).toEqual(first);
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      expect(first.world.id).toBe("district-2-catacombs");
      expect(first.world.bounds).toEqual({
        maximum: [512, 32, 512],
        minimum: [-512, -16, -512],
      });
      expect(first.world.cells).toHaveLength(64);
      expect(first.world.cells[0]?.id).toBe("district-2-catacombs-cell-00-00");
      expect(first.world.cells.at(-1)?.id).toBe("district-2-catacombs-cell-07-07");
      expect(summary).toEqual({
        cellCount: 64,
        colliderCount: 88,
        heightSampleCount: 64 * 17 * 17,
        lodPrimitiveCounts: [104, 104, 104],
        markerCount: 4,
      });
      expect(Object.isFrozen(first.world)).toBe(true);
      expect(Object.isFrozen(DISTRICT_2_GREYBOX_SPEC.features)).toBe(true);
    } finally {
      random.mockRestore();
    }
  });

  it("forms one connected choke-point network through sealed rock", () => {
    const world = createGreyboxScene(DISTRICT_2_GREYBOX_SPEC).world;
    const traversable = world.cells.filter(({ tags }) => !tags.includes("sealed-rock"));
    const traversableIds = new Set(traversable.map(({ id }) => id));
    const visited = new Set<string>();
    const pending = [traversable[0]?.id];
    while (pending.length > 0) {
      const id = pending.shift();
      if (id === undefined || visited.has(id)) continue;
      visited.add(id);
      const cell = world.cells.find((candidate) => candidate.id === id);
      for (const neighbor of cell?.neighbors ?? []) {
        if (traversableIds.has(neighbor) && !visited.has(neighbor)) pending.push(neighbor);
      }
    }

    expect(traversable).toHaveLength(16);
    expect(visited).toEqual(traversableIds);
    expect(world.cells.filter(({ tags }) => tags.includes("sealed-rock"))).toHaveLength(48);
    expect(world.cells.filter(({ tags }) => tags.includes("warden-arena"))).toHaveLength(4);
    for (const marker of world.markers.filter(({ kind }) => kind === "transition")) {
      const containingCell = world.cells.find(
        ({ bounds }) =>
          marker.position[0] >= bounds.minimum[0] &&
          marker.position[0] <= bounds.maximum[0] &&
          marker.position[2] >= bounds.minimum[2] &&
          marker.position[2] <= bounds.maximum[2],
      );
      expect(containingCell?.tags).not.toContain("sealed-rock");
      expect(marker.tags).toContain("waystone");
    }
  });

  it("keeps repeated shell geometry and colliders inside each owning cell", () => {
    const world = createGreyboxScene(DISTRICT_2_GREYBOX_SPEC).world;
    for (const cell of world.cells) {
      for (const box of detailedBoxes(cell).primitives) {
        expect(box.center[0] - box.size[0] / 2).toBeGreaterThanOrEqual(cell.bounds.minimum[0]);
        expect(box.center[0] + box.size[0] / 2).toBeLessThanOrEqual(cell.bounds.maximum[0]);
        expect(box.center[2] - box.size[2] / 2).toBeGreaterThanOrEqual(cell.bounds.minimum[2]);
        expect(box.center[2] + box.size[2] / 2).toBeLessThanOrEqual(cell.bounds.maximum[2]);
      }
      expect(new Set(cell.collision.obstacles.map(({ id }) => id)).size).toBe(
        cell.collision.obstacles.length,
      );
    }
  });

  it("pairs all six authored endpoints through context-specific world-graph edges", () => {
    expect(validateWorldGraph(PARALLAX_WORLD_GRAPH, GREYBOX_DISTRICT_SPECS)).toEqual({
      districtCount: 2,
      endpointCount: 6,
      transitionCount: 3,
    });
    expect(PARALLAX_WORLD_GRAPH.transitions.map(({ context }) => context)).toEqual([
      "castle",
      "village",
      "forest",
    ]);
    expect(
      PARALLAX_WORLD_GRAPH.transitions.map(
        ({ prefetchTriggerDistanceMeters }) => prefetchTriggerDistanceMeters,
      ),
    ).toEqual([6, 5, 5]);
    expect(
      PARALLAX_WORLD_GRAPH.transitions.map(({ endpoints }) =>
        endpoints.map(({ districtId, markerId }) => `${districtId}:${markerId}`),
      ),
    ).toEqual([
      [
        "district-1-surface:d1-transition-castle-catacomb",
        "district-2-catacombs:d2-transition-castle-undercroft",
      ],
      [
        "district-1-surface:d1-transition-village-well",
        "district-2-catacombs:d2-transition-village-well",
      ],
      [
        "district-1-surface:d1-transition-forest-ruin",
        "district-2-catacombs:d2-transition-forest-ruin",
      ],
    ]);
    expect(Object.isFrozen(PARALLAX_WORLD_GRAPH.transitions[0]?.endpoints)).toBe(true);
    expect(JSON.parse(JSON.stringify(PARALLAX_WORLD_GRAPH))).toEqual(PARALLAX_WORLD_GRAPH);
  });

  it("resolves every entrance in both directions without district-specific code", () => {
    for (const transition of PARALLAX_WORLD_GRAPH.transitions) {
      for (const source of transition.endpoints) {
        const resolved = resolveWorldGraphTransition(
          PARALLAX_WORLD_GRAPH,
          GREYBOX_DISTRICT_SPECS,
          source.districtId,
          source.markerId,
        );
        const expectedDestination = transition.endpoints.find((endpoint) => endpoint !== source);
        expect(resolved).toMatchObject({
          destination: expectedDestination,
          entranceId: transition.id,
          prefetchTriggerDistanceMeters: transition.prefetchTriggerDistanceMeters,
          source,
        });
        expect(resolved.destinationPosition).toHaveLength(3);
        const destinationSpec = GREYBOX_DISTRICT_SPECS.find(
          ({ world }) => world.id === expectedDestination?.districtId,
        );
        const destinationMarker = destinationSpec?.markers.find(
          ({ id }) => id === expectedDestination?.markerId,
        );
        if (destinationSpec === undefined || destinationMarker === undefined) {
          throw new Error("Resolved destination fixture is missing");
        }
        expect(resolved.destinationPosition[1]).toBe(
          destinationMarker.fixedY ??
            sampleGreyboxTerrain(
              destinationSpec,
              destinationMarker.position[0],
              destinationMarker.position[1],
            ),
        );
      }
    }
  });

  it("authors the measurement scenario from all three graph edges in both directions", () => {
    expect(M4_DISTRICT_SWAP_SCENARIO).toMatchObject({
      id: "m4-district-swap@1",
      version: 2,
    });
    expect(M4_DISTRICT_SWAP_SCENARIO.steps).toHaveLength(6);
    for (let index = 0; index < M4_DISTRICT_SWAP_SCENARIO.steps.length; index += 2) {
      const forward = M4_DISTRICT_SWAP_SCENARIO.steps[index];
      const reverse = M4_DISTRICT_SWAP_SCENARIO.steps[index + 1];
      expect(forward?.entranceId).toBe(reverse?.entranceId);
      expect(forward?.sourceDistrictId).toBe(reverse?.destinationDistrictId);
      expect(forward?.destinationDistrictId).toBe(reverse?.sourceDistrictId);
      expect(forward?.initialObservers).toHaveLength(1);
      expect(reverse?.initialObservers).toHaveLength(1);
      expect(forward?.prefetchTriggerDistanceMeters).toBe(
        PARALLAX_WORLD_GRAPH.transitions[index / 2]?.prefetchTriggerDistanceMeters,
      );
      expect(reverse?.prefetchTriggerDistanceMeters).toBe(forward?.prefetchTriggerDistanceMeters);
      expect(forward?.traversalSpeedMetersPerSecond).toBe(12);
      expect(reverse?.traversalSpeedMetersPerSecond).toBe(12);
    }
    expect(Object.isFrozen(M4_DISTRICT_SWAP_SCENARIO.steps)).toBe(true);
  });
});
