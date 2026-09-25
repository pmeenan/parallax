import { readFile } from "node:fs/promises";
import type {
  GreyboxCell,
  GreyboxHeightfieldGridPayload,
  GreyboxPrimitive,
  GreyboxSceneConfig,
  GreyboxTriangleBoxPayload,
} from "@parallax/engine";
import {
  sampleCellGroundHeight,
  selectGreyboxCellLod,
  simulationWorldDefinition,
  validateGreyboxDistrict,
} from "@parallax/engine";
import { describe, expect, it, vi } from "vitest";
import { createHeightfieldGeometryBatch } from "../../engine/src/render/lite-greybox-world";
import { buildDeterministicNavigationMesh } from "../src/sim/deterministic-navigation";
import { DISTRICT_1_GREYBOX_SPEC } from "../src/world/district-1.data";
import { D1_PAVING } from "../src/world/district-1-paving";
import { DISTRICT_2_GREYBOX_SPEC } from "../src/world/district-2.data";
import { GREYBOX_DISTRICT_SPECS } from "../src/world/district-registry";
import { createGreyboxScene, sampleGreyboxTerrain } from "../src/world/greybox-generator";
import { freezeGreyboxData } from "../src/world/greybox-spec";

const CELLS_PER_AXIS = 16;
const HEIGHTFIELD_SAMPLES_PER_AXIS = 17;

function createScene(): GreyboxSceneConfig {
  return createGreyboxScene(DISTRICT_1_GREYBOX_SPEC);
}

function requireCell(scene: GreyboxSceneConfig, x: number, z: number): GreyboxCell {
  const cell = scene.world.cells.find(
    (candidate) => candidate.coordinate[0] === x && candidate.coordinate[1] === z,
  );
  if (cell === undefined) throw new Error(`Missing cell ${x},${z}`);
  return cell;
}

function heightfieldRepresentation(
  cell: GreyboxCell,
  tier: 0 | 1 | 2,
): GreyboxHeightfieldGridPayload {
  const representation = cell.lods[tier].representations.find(
    (candidate) => candidate.kind === "heightfield-grid",
  );
  if (representation?.kind !== "heightfield-grid")
    throw new Error("Missing terrain representation");
  return representation;
}

function triangleRepresentation(cell: GreyboxCell, tier: 0 | 1 | 2): GreyboxTriangleBoxPayload {
  const representation = cell.lods[tier].representations.find(
    (candidate) => candidate.kind === "triangle-boxes",
  );
  if (representation?.kind !== "triangle-boxes") throw new Error("Missing feature representation");
  return representation;
}

describe("data-first greybox world generation", () => {
  it("paves the level courtyard pad with the admitted periodic module", async () => {
    const placements = DISTRICT_1_GREYBOX_SPEC.assetPlacements ?? [];
    expect(placements).toHaveLength(48);
    expect(new Set(placements.map((p) => p.id)).size).toBe(48);
    const library = JSON.parse(
      await readFile(new URL("../../assets/library/d1-paving.json", import.meta.url), "utf8"),
    ) as { assetId: string; candidateSha256: string };
    expect(library).toMatchObject({
      assetId: D1_PAVING.assetId,
      candidateSha256: D1_PAVING.candidateSha256,
    });
    for (const part of ["ground", "pebbles", "plants"] as const) {
      const tiles = placements.filter((p) => p.variantId === part);
      expect(tiles).toHaveLength(16);
      expect(new Set(tiles.map((p) => p.center.join(",")))).toEqual(
        new Set(
          [2.05, 6.05, 10.05, 14.05].flatMap((z) =>
            [2.05, 6.05, 10.05, 14.05].map((x) => `${x},${z}`),
          ),
        ),
      );
      for (const placement of tiles) {
        expect(placement).toMatchObject({
          assetId: "d1-photoreal-paving",
          heightAnchor: [8.05, 8.05],
          heightOffset: 0.021,
          rotationYRadians: 0,
          lodDistancesMeters: D1_PAVING.lodDistancesMeters[part],
        });
        expect(
          sampleGreyboxTerrain(DISTRICT_1_GREYBOX_SPEC, ...placement.center) +
            placement.heightOffset,
        ).toBeCloseTo(18.99475, 10);
      }
    }
  });
  it("keeps the courtyard plane identical in collision and every rendered terrain LOD", () => {
    const scene = createScene();
    const cell = requireCell(scene, 8, 8);
    const height = 18.97375;
    const h = cell.collision.heightfield;
    for (const index of [0, 1, h.columns, h.columns + 1]) expect(h.heights[index]).toBe(height);
    // Both triangles of the [0,16]² lattice square are level, containing the
    // entire [0,16]² paving footprint, not merely its center sample.
    for (const tier of [0, 1, 2] as const) {
      const geometry = createHeightfieldGeometryBatch([
        { cell, representation: heightfieldRepresentation(cell, tier) },
      ]);
      const corners = [];
      for (let index = 0; index < h.columns * h.rows * 3; index += 3) {
        const x = geometry.positions[index] ?? Infinity,
          z = geometry.positions[index + 2] ?? Infinity;
        if (x >= 0 && x <= 16 && z >= 0 && z <= 16) corners.push(geometry.positions[index + 1]);
      }
      expect(corners).toHaveLength(4);
      for (const y of corners) expect(y).toBeCloseTo(height, 5);
    }
    const original = {
      ...DISTRICT_1_GREYBOX_SPEC,
      terrain: { ...DISTRICT_1_GREYBOX_SPEC.terrain, levelPads: [] },
    };
    for (let z = -48; z <= 64; z += 16)
      for (let x = -48; x <= 64; x += 16) {
        if (x <= -32 || x >= 48 || z <= -32 || z >= 48)
          expect(sampleGreyboxTerrain(DISTRICT_1_GREYBOX_SPEC, x, z)).toBe(
            sampleGreyboxTerrain(original, x, z),
          );
      }
    expect(sampleGreyboxTerrain(DISTRICT_1_GREYBOX_SPEC, -16, 0)).toBeCloseTo(
      (height + sampleGreyboxTerrain(original, -16, 0)) / 2,
      12,
    );
    const retained = scene.world.cells.filter(
      (c) => heightfieldRepresentation(c, 2).sampleStride === 1,
    );
    expect(retained.map((c) => c.coordinate)).toEqual([
      [7, 7],
      [8, 7],
      [7, 8],
      [8, 8],
    ]);
  });
  it("interprets a versioned descriptor through the district-neutral public API", () => {
    expect(GREYBOX_DISTRICT_SPECS).toEqual([DISTRICT_1_GREYBOX_SPEC, DISTRICT_2_GREYBOX_SPEC]);
    expect(Object.isFrozen(GREYBOX_DISTRICT_SPECS)).toBe(true);
    expect(Object.isFrozen(DISTRICT_1_GREYBOX_SPEC.world.zones)).toBe(true);
    expect(JSON.parse(JSON.stringify(DISTRICT_1_GREYBOX_SPEC))).toEqual(DISTRICT_1_GREYBOX_SPEC);

    const alternateSpec = freezeGreyboxData({
      ...DISTRICT_1_GREYBOX_SPEC,
      features: [],
      markers: [],
      world: {
        ...DISTRICT_1_GREYBOX_SPEC.world,
        bounds: { maximum: [-1_536, 256, -1_536], minimum: [-2_048, -32, -2_048] },
        id: "generic-fixture",
        zones: [],
      },
    });
    const alternate = createGreyboxScene(alternateSpec);

    expect(alternate.world.cells).toHaveLength(4);
    expect(alternate.world.cells.map(({ id }) => id)).toEqual([
      "generic-fixture-cell-00-00",
      "generic-fixture-cell-01-00",
      "generic-fixture-cell-00-01",
      "generic-fixture-cell-01-01",
    ]);
    expect(alternate.world.cells[0]?.neighbors).toEqual([
      "generic-fixture-cell-01-00",
      "generic-fixture-cell-00-01",
    ]);
  });

  it("generates the complete, valid district contract", () => {
    const scene = createScene();
    const summary = validateGreyboxDistrict(scene.world);

    expect(scene.world.id).toBe("district-1-surface");
    expect(scene.world.schemaVersion).toBe(1);
    expect(scene.world.generator).toEqual({ seed: 1_592_643_841, version: 1 });
    expect(scene.world.bounds).toEqual({
      maximum: [2_048, 256, 2_048],
      minimum: [-2_048, -32, -2_048],
    });
    expect(scene.world.cellSizeMeters).toBe(256);
    expect(scene.world.lodHysteresisMeters).toBe(64);
    expect(scene.world.standardTraversalMetersPerSecond).toBe(12);
    expect(scene.camera.minZ).toBe(5);
    expect(scene.lodObservers).toEqual([[0, 12, -900]]);
    expect(summary.cellCount).toBe(CELLS_PER_AXIS ** 2);
    // Coarse fields, plus the rolling courtyard's detail region [-16, 32]² at 0.5 m, clipped
    // into its four cells (D-204).
    expect(summary.heightSampleCount).toBe(
      CELLS_PER_AXIS ** 2 * HEIGHTFIELD_SAMPLES_PER_AXIS ** 2 + 65 ** 2 + 2 * 33 * 65 + 33 ** 2,
    );
    expect(summary.colliderCount).toBeGreaterThan(0);
    expect(summary.markerCount).toBe(18);
  });

  it("rolls the courtyard on one shared walkable surface (D-204)", () => {
    const scene = createScene();
    const detailed = scene.world.cells.filter((cell) => cell.collision.detail !== undefined);
    expect(detailed.map((cell) => cell.coordinate)).toEqual([
      [7, 7],
      [8, 7],
      [7, 8],
      [8, 8],
    ]);
    for (const cell of detailed) {
      // Detail cells keep the full collision lattice so the fine mesh edge meets it.
      for (const lod of cell.lods)
        for (const representation of lod.representations)
          if (representation.kind === "heightfield-grid")
            expect(representation.sampleStride).toBe(1);
      const detail = cell.collision.detail;
      if (detail === undefined) throw new Error("detail");
      let steepest = 0;
      for (let row = 1; row + 1 < detail.rows; row++)
        for (let column = 1; column + 1 < detail.columns; column++) {
          const height = (c: number, r: number) => detail.heights[r * detail.columns + c] ?? 0;
          const slopeX = (height(column + 1, row) - height(column - 1, row)) / 1;
          const slopeZ = (height(column, row + 1) - height(column, row - 1)) / 1;
          steepest = Math.max(steepest, Math.hypot(slopeX, slopeZ));
        }
      expect((Math.atan(steepest) * 180) / Math.PI).toBeLessThan(10);
    }
    const courtyard = requireCell(scene, 8, 8);
    const navigation = buildDeterministicNavigationMesh(simulationWorldDefinition(scene.world), {
      agentRadiusMeters: 0.4,
      maximumGroundStepMeters: 0.5,
      sampleSpacingMeters: 16,
    });
    let relief = 0;
    for (let x = 0.3; x < 16; x += 1.7)
      for (let z = 0.2; z < 16; z += 1.3) {
        const ground = sampleCellGroundHeight(courtyard.collision, x, z);
        expect(navigation.groundHeight(x, z)).toBe(Math.fround(ground));
        relief = Math.max(relief, Math.abs(ground - 18.97375));
      }
    expect(relief).toBeGreaterThan(0.25);
    const paving = DISTRICT_1_GREYBOX_SPEC.assetPlacements ?? [];
    expect(paving.length).toBeGreaterThan(0);
    expect(paving.every((placement) => placement.conformToTerrain === true)).toBe(true);
  });

  it("preserves stable IDs, ordering, neighbors, and deterministic generation", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("District generation must not use Math.random");
    });
    try {
      const first = createScene();
      const second = createScene();

      expect(second).toEqual(first);
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      expect(first.world.cells[0]?.id).toBe("district-1-surface-cell-00-00");
      expect(first.world.cells[1]?.id).toBe("district-1-surface-cell-01-00");
      expect(first.world.cells.at(-1)?.id).toBe("district-1-surface-cell-15-15");
      expect(requireCell(first, 8, 8).neighbors).toEqual([
        "district-1-surface-cell-07-08",
        "district-1-surface-cell-09-08",
        "district-1-surface-cell-08-07",
        "district-1-surface-cell-08-09",
      ]);
      expect(Object.isFrozen(first.world)).toBe(true);
      expect(Object.isFrozen(first.world.cells[0]?.lods[0].representations)).toBe(true);
      expect(Object.isFrozen(first.world.cells[0]?.collision.heightfield.heights)).toBe(true);
    } finally {
      random.mockRestore();
    }
  });

  it("uses the collision heightfield as every visual terrain LOD source with identical seams", () => {
    const scene = createScene();

    for (const cell of scene.world.cells) {
      for (const tier of [0, 1, 2] as const) {
        const visual = heightfieldRepresentation(cell, tier);
        expect(visual.materialId).toBe(DISTRICT_1_GREYBOX_SPEC.terrain.materialId);
        expect((cell.collision.heightfield.columns - 1) % visual.sampleStride).toBe(0);
        const visualSamples = cell.collision.heightfield.heights.filter((_, index) => {
          const row = Math.floor(index / cell.collision.heightfield.columns);
          const column = index % cell.collision.heightfield.columns;
          return row % visual.sampleStride === 0 && column % visual.sampleStride === 0;
        });
        const visualSide = (HEIGHTFIELD_SAMPLES_PER_AXIS - 1) / visual.sampleStride + 1;
        expect(visualSamples).toHaveLength(visualSide ** 2);
      }
    }

    for (let z = 0; z < CELLS_PER_AXIS; z += 1) {
      for (let x = 0; x + 1 < CELLS_PER_AXIS; x += 1) {
        const west = requireCell(scene, x, z);
        const east = requireCell(scene, x + 1, z);
        for (const tier of [0, 1, 2] as const) {
          const stride = heightfieldRepresentation(west, tier).sampleStride;
          for (let row = 0; row < HEIGHTFIELD_SAMPLES_PER_AXIS; row += stride) {
            expect(
              west.collision.heightfield.heights[
                row * HEIGHTFIELD_SAMPLES_PER_AXIS + HEIGHTFIELD_SAMPLES_PER_AXIS - 1
              ],
            ).toBe(east.collision.heightfield.heights[row * HEIGHTFIELD_SAMPLES_PER_AXIS]);
          }
        }
      }
    }

    for (let z = 0; z + 1 < CELLS_PER_AXIS; z += 1) {
      for (let x = 0; x < CELLS_PER_AXIS; x += 1) {
        const south = requireCell(scene, x, z);
        const north = requireCell(scene, x, z + 1);
        for (const tier of [0, 1, 2] as const) {
          const stride = heightfieldRepresentation(south, tier).sampleStride;
          for (let column = 0; column < HEIGHTFIELD_SAMPLES_PER_AXIS; column += stride) {
            expect(
              south.collision.heightfield.heights[
                (HEIGHTFIELD_SAMPLES_PER_AXIS - 1) * HEIGHTFIELD_SAMPLES_PER_AXIS + column
              ],
            ).toBe(north.collision.heightfield.heights[column]);
          }
        }
      }
    }
  });

  it("covers the playable square exactly and keeps feature extents within their cell", () => {
    const scene = createScene();
    const coordinates = new Set<string>();

    for (const cell of scene.world.cells) {
      const [x, z] = cell.coordinate;
      expect(coordinates.has(`${x},${z}`)).toBe(false);
      coordinates.add(`${x},${z}`);
      const minimumX = -2_048 + x * 256;
      const minimumZ = -2_048 + z * 256;
      expect(cell.bounds.minimum).toEqual([minimumX, -32, minimumZ]);
      expect(cell.bounds.maximum).toEqual([minimumX + 256, 256, minimumZ + 256]);
      expect(cell.collision.heightfield.origin).toEqual([minimumX, 0, minimumZ]);

      for (const lod of cell.lods) {
        for (const definition of triangleRepresentation(cell, lod.tier).primitives) {
          const halfSize = horizontalHalfSize(definition);
          expect(definition.center[0] - halfSize[0]).toBeGreaterThanOrEqual(minimumX);
          expect(definition.center[0] + halfSize[0]).toBeLessThanOrEqual(minimumX + 256);
          expect(definition.center[2] - halfSize[1]).toBeGreaterThanOrEqual(minimumZ);
          expect(definition.center[2] + halfSize[1]).toBeLessThanOrEqual(minimumZ + 256);
        }
      }
    }

    expect(coordinates.size).toBe(256);
  });

  it("retains authored pad terrain and otherwise provides stride 1/2/4 with simpler features", () => {
    const scene = createScene();

    for (const cell of scene.world.cells) {
      expect(cell.lods.map(({ maxDistanceMeters }) => maxDistanceMeters)).toEqual([
        320, 960, 4_096,
      ]);
      expect(
        cell.lods.map((lod) => heightfieldRepresentation(cell, lod.tier).sampleStride),
      ).toEqual(
        cell.coordinate.every((coordinate) => coordinate === 7 || coordinate === 8)
          ? [1, 1, 1]
          : [1, 2, 4],
      );
      expect(cell.lods[0].complexityScore).toBeGreaterThanOrEqual(cell.lods[1].complexityScore);
      expect(cell.lods[1].complexityScore).toBeGreaterThanOrEqual(cell.lods[2].complexityScore);
      expect(triangleRepresentation(cell, 0).primitives.length).toBeGreaterThanOrEqual(
        triangleRepresentation(cell, 1).primitives.length,
      );
      expect(triangleRepresentation(cell, 1).primitives.length).toBeGreaterThanOrEqual(
        triangleRepresentation(cell, 2).primitives.length,
      );
      expect(
        cell.lods
          .flatMap(({ representations }) => representations)
          .some(
            (representation) =>
              representation.kind === "triangle-boxes" &&
              representation.primitives.some(
                (definition) => definition.materialId === "ground" && definition.size[0] === 256,
              ),
          ),
      ).toBe(false);
    }
  });

  it("preserves complete landmark feature groups through reduced LOD tiers", () => {
    const scene = createScene();
    const castleCells = scene.world.cells.filter(({ tags }) => tags.includes("castle"));
    const forestCells = scene.world.cells.filter(({ tags }) => tags.includes("forest"));

    expect(castleCells).toHaveLength(4);
    expect(forestCells).toHaveLength(80);
    for (const cell of castleCells) {
      expect(
        triangleRepresentation(cell, 2).primitives.some(({ materialId }) => materialId === "stone"),
      ).toBe(true);
    }
    for (const cell of forestCells) {
      for (const tier of [1, 2] as const) {
        const materials = triangleRepresentation(cell, tier).primitives.map(
          ({ materialId }) => materialId,
        );
        const trunkCount = materials.filter((materialId) => materialId === "wood").length;
        const foliageCount = materials.filter((materialId) => materialId === "foliage").length;
        expect(trunkCount).toBeGreaterThan(0);
        expect(foliageCount).toBe(trunkCount);
      }
    }
  });

  it("treats spatial-range minimum and maximum boundaries as inclusive", () => {
    const boundarySpec = freezeGreyboxData({
      ...DISTRICT_1_GREYBOX_SPEC,
      features: [],
      markers: [],
      world: {
        ...DISTRICT_1_GREYBOX_SPEC.world,
        bounds: { maximum: [256, 256, 256], minimum: [0, -32, 0] },
        id: "inclusive-boundary-fixture",
        zones: [
          {
            match: { kind: "manhattan-range", maximum: 256, minimum: 256 },
            tag: "boundary",
          },
        ],
      },
    });
    const scene = createGreyboxScene(boundarySpec);

    expect(scene.world.cells).toHaveLength(1);
    expect(scene.world.cells[0]?.tags).toContain("boundary");
  });

  it("selects from every playable corner and explicitly culls cells beyond the far tier", () => {
    const scene = createScene();
    for (const observer of [
      [-2_048, 0, -2_048],
      [2_048, 0, -2_048],
      [-2_048, 0, 2_048],
      [2_048, 0, 2_048],
    ] as const) {
      const selections = scene.world.cells.map((cell) =>
        selectGreyboxCellLod(cell, [observer], {
          hysteresisMeters: scene.world.lodHysteresisMeters,
        }),
      );
      expect(selections.some(({ lod }) => lod?.tier === 0)).toBe(true);
      expect(selections.some(({ lod }) => lod === null)).toBe(true);
    }
  });

  it("derives each collision AABB footprint from its rotated visual primitive", () => {
    const scene = createScene();
    let sawRotatedNonSquareFootprint = false;

    for (const cell of scene.world.cells) {
      const detailed = triangleRepresentation(cell, 0).primitives;
      expect(new Set(cell.collision.obstacles.map(({ id }) => id)).size).toBe(
        cell.collision.obstacles.length,
      );
      for (const obstacle of cell.collision.obstacles) {
        const definition = detailed.find((candidate) => candidate.center === obstacle.center);
        expect(definition).toBeDefined();
        if (definition === undefined) continue;
        const [halfX, halfZ] = horizontalHalfSize(definition);
        expect(obstacle.size).toEqual([halfX * 2, definition.size[1], halfZ * 2]);
        if (definition.rotationYRadians !== 0 && definition.size[0] !== definition.size[2]) {
          sawRotatedNonSquareFootprint = true;
        }
      }
    }

    expect(sawRotatedNonSquareFootprint).toBe(true);
  });

  it("expresses required zones, paths, entrances, and vista entirely from descriptor data", () => {
    const scene = createScene();
    const allTags = new Set(scene.world.cells.flatMap(({ tags }) => tags));
    for (const tag of ["castle", "moat", "village", "fields", "forest", "shoreline", "path"])
      expect(allTags.has(tag)).toBe(true);
    expect(
      scene.world.cells.some(({ tags }) => tags.includes("moat") && tags.includes("village")),
    ).toBe(false);

    expect(scene.world.markers.map(({ id }) => id)).toEqual(
      DISTRICT_1_GREYBOX_SPEC.markers.map(({ id }) => id),
    );
    const entrances = scene.world.markers.filter(({ kind }) => kind === "transition");
    expect(entrances).toHaveLength(3);
    expect(entrances.every(({ tags }) => tags.includes("d2") && tags.includes("entrance"))).toBe(
      true,
    );
    expect(
      scene.world.markers.some(({ kind, tags }) => kind === "vista" && tags.includes("mountains")),
    ).toBe(true);
    expect(
      scene.world.cells
        .filter(({ tags }) => tags.includes("shoreline"))
        .every(({ bounds }) => bounds.maximum[2] <= -1_536),
    ).toBe(true);
  });
});

function horizontalHalfSize(definition: GreyboxPrimitive): readonly [number, number] {
  const quarterTurns = definition.rotationYRadians / (Math.PI / 2);
  if (Number.isInteger(quarterTurns)) {
    return Math.abs(quarterTurns % 2) === 1
      ? [definition.size[2] / 2, definition.size[0] / 2]
      : [definition.size[0] / 2, definition.size[2] / 2];
  }
  const sine = Math.abs(Math.sin(definition.rotationYRadians));
  const cosine = Math.abs(Math.cos(definition.rotationYRadians));
  return [
    (definition.size[0] * cosine + definition.size[2] * sine) / 2,
    (definition.size[0] * sine + definition.size[2] * cosine) / 2,
  ];
}
