import { describe, expect, it } from "vitest";
import {
  createHeightfieldGeometryBatch,
  type GeometryBatch,
  type HeightfieldBatchEntry,
} from "../src/render/lite-greybox-world";
import type { GreyboxCell, GreyboxHeightfieldGridPayload } from "../src/world/world-contract";

function entry(
  id: string,
  coordinate: readonly [number, number],
  originX: number,
  heights: readonly number[],
  sampleStride: 1 | 2,
): HeightfieldBatchEntry {
  const representation: GreyboxHeightfieldGridPayload = {
    kind: "heightfield-grid",
    materialId: "ground",
    sampleStride,
  };
  const cell = {
    bounds: { maximum: [originX + 4, 10, 4], minimum: [originX, -10, 0] },
    collision: {
      heightfield: {
        columns: 5,
        heights,
        kind: "heightfield",
        origin: [originX, 0, 0],
        rows: 5,
        sampleSpacingMeters: 1,
      },
      obstacles: [],
    },
    coordinate,
    id,
    lods: [],
    neighbors: [],
    tags: [],
  } as unknown as GreyboxCell;
  return { cell, representation };
}

function triangleOrientationDot(geometry: GeometryBatch, triangleIndex: number): number {
  const indexOffset = triangleIndex * 3;
  const vertexA = geometry.indices[indexOffset] ?? 0;
  const vertexB = geometry.indices[indexOffset + 1] ?? 0;
  const vertexC = geometry.indices[indexOffset + 2] ?? 0;
  const position = (vertex: number, axis: number): number =>
    geometry.positions[vertex * 3 + axis] ?? 0;
  const ab = [
    position(vertexB, 0) - position(vertexA, 0),
    position(vertexB, 1) - position(vertexA, 1),
    position(vertexB, 2) - position(vertexA, 2),
  ] as const;
  const ac = [
    position(vertexC, 0) - position(vertexA, 0),
    position(vertexC, 1) - position(vertexA, 1),
    position(vertexC, 2) - position(vertexA, 2),
  ] as const;
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ] as const;
  const normalOffset = vertexA * 3;
  return (
    cross[0] * (geometry.normals[normalOffset] ?? 0) +
    cross[1] * (geometry.normals[normalOffset + 1] ?? 0) +
    cross[2] * (geometry.normals[normalOffset + 2] ?? 0)
  );
}

describe("greybox heightfield geometry", () => {
  it("adds downward skirts that close a mismatched fine-to-coarse LOD edge", () => {
    const leftHeights = Array.from({ length: 25 }, (_, index) => {
      const row = Math.floor(index / 5);
      const column = index % 5;
      return column === 4 && row % 2 === 1 ? 1 : 0;
    });
    const rightHeights = Array.from({ length: 25 }, (_, index) => {
      const row = Math.floor(index / 5);
      const column = index % 5;
      return column === 0 && row % 2 === 1 ? 1 : 0;
    });
    const geometry = createHeightfieldGeometryBatch([
      entry("left", [0, 0], 0, leftHeights, 1),
      entry("right", [1, 0], 4, rightHeights, 2),
    ]);

    const vertices = Array.from({ length: geometry.positions.length / 3 }, (_, index) =>
      Array.from(geometry.positions.slice(index * 3, index * 3 + 3)),
    );
    const fineEdgeTop = vertices.findIndex(([x, y, z]) => x === 4 && y === 1 && z === 1);
    const fineEdgeBottom = vertices.findIndex(([x, y, z]) => x === 4 && y === -10 && z === 1);

    expect(fineEdgeTop).toBeGreaterThanOrEqual(0);
    expect(fineEdgeBottom).toBeGreaterThanOrEqual(0);
    expect(geometry.indices).toContain(fineEdgeTop);
    expect(geometry.indices).toContain(fineEdgeBottom);
    expect(geometry.triangleCount).toBe(88);
  });

  it("omits coincident skirts between neighbors at the same LOD", () => {
    const heights = Array.from({ length: 25 }, () => 0);
    const geometry = createHeightfieldGeometryBatch([
      entry("left", [0, 0], 0, heights, 1),
      entry("right", [1, 0], 4, heights, 1),
    ]);
    const vertices = Array.from({ length: geometry.positions.length / 3 }, (_, index) =>
      Array.from(geometry.positions.slice(index * 3, index * 3 + 3)),
    );

    expect(vertices.some(([x, y, z]) => x === 4 && y === -10 && z === 2)).toBe(false);
    expect(geometry.triangleCount).toBe(112);
  });

  it("winds single-sided skirts with the same front-face convention as the terrain", () => {
    const geometry = createHeightfieldGeometryBatch([
      entry(
        "isolated",
        [0, 0],
        0,
        Array.from({ length: 25 }, () => 0),
        2,
      ),
    ]);
    const orientationDots = Array.from({ length: geometry.triangleCount }, (_, index) =>
      triangleOrientationDot(geometry, index),
    );

    expect(geometry.triangleCount).toBe(24);
    expect(orientationDots.slice(0, 8).every((dot) => dot < 0)).toBe(true);
    expect(orientationDots.slice(8).every((dot) => dot < 0)).toBe(true);
  });
});
