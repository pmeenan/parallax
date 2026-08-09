import type { SimulationWorldDefinition } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import { buildDeterministicNavigationMesh } from "../src/sim/deterministic-navigation";

function thinObstacleWorld(): SimulationWorldDefinition {
  return Object.freeze({
    bounds: Object.freeze({
      maximum: Object.freeze([48, 8, 48] as const),
      minimum: Object.freeze([-16, -8, -16] as const),
    }),
    cellSizeMeters: 64,
    id: "test-district",
    cells: Object.freeze([
      Object.freeze({
        collision: Object.freeze({
          heightfield: Object.freeze({
            columns: 5,
            heights: Object.freeze(Array.from({ length: 25 }, () => 0)),
            kind: "heightfield" as const,
            origin: Object.freeze([-16, 0, -16] as const),
            rows: 5,
            sampleSpacingMeters: 16,
          }),
          obstacles: Object.freeze([
            Object.freeze({
              center: Object.freeze([8, 1, 0] as const),
              id: "thin-between-samples",
              kind: "aabb" as const,
              size: Object.freeze([2, 2, 2] as const),
            }),
          ]),
        }),
        coordinate: Object.freeze([0, 0] as const),
      }),
    ]),
    markers: Object.freeze([]),
  });
}

describe("deterministic navigation mesh", () => {
  it("rejects boundary nodes and routes around thin colliders between clear samples", () => {
    const navigation = buildDeterministicNavigationMesh(thinObstacleWorld(), {
      agentRadiusMeters: 0.5,
      maximumGroundStepMeters: 1,
      sampleSpacingMeters: 16,
    });
    expect(navigation.isWalkablePosition(-16, 0)).toBe(false);
    expect(navigation.isWalkablePosition(0, 0)).toBe(true);
    expect(navigation.isWalkablePosition(16, 0)).toBe(true);
    expect(navigation.canTraverseSegment([0, 0, 0], [16, 0, 0])).toBe(false);
    expect(navigation.canTraverseSegment([0, 0, 0], [16, 0, 16])).toBe(true);
    expect(navigation.findPath([0, 0, 0], [16, 0, 0]).nodes).toEqual([
      [0, 0, 0],
      [0, 0, 16],
      [16, 0, 16],
      [16, 0, 0],
    ]);
  });
});
