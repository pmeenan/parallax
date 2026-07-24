import { describe, expect, it } from "vitest";
import type { GreyboxCell, GreyboxDistrict } from "../src/world/world-contract";
import { selectGreyboxCellLod, validateGreyboxDistrict } from "../src/world/world-contract";

function cell(): GreyboxCell {
  const primitive = Object.freeze({
    center: [5, 1, 5] as const,
    materialId: "ground",
    rotationYRadians: 0,
    size: [10, 2, 10] as const,
  });
  return Object.freeze({
    bounds: Object.freeze({
      maximum: [10, 10, 10] as const,
      minimum: [0, -10, 0] as const,
    }),
    collision: Object.freeze({
      heightfield: Object.freeze({
        columns: 2,
        heights: Object.freeze([0, 0, 0, 0]),
        kind: "heightfield" as const,
        origin: [0, 0, 0] as const,
        rows: 2,
        sampleSpacingMeters: 10,
      }),
      obstacles: Object.freeze([]),
    }),
    coordinate: [0, 0] as const,
    id: "cell-0-0",
    lods: Object.freeze([
      Object.freeze({
        complexityScore: 3,
        maxDistanceMeters: 10,
        representations: Object.freeze([
          Object.freeze({ kind: "triangle-boxes" as const, primitives: [primitive] }),
        ]),
        tier: 0 as const,
      }),
      Object.freeze({
        complexityScore: 2,
        maxDistanceMeters: 20,
        representations: Object.freeze([
          Object.freeze({ kind: "triangle-boxes" as const, primitives: [primitive] }),
        ]),
        tier: 1 as const,
      }),
      Object.freeze({
        complexityScore: 1,
        maxDistanceMeters: 40,
        representations: Object.freeze([
          Object.freeze({ kind: "triangle-boxes" as const, primitives: [primitive] }),
        ]),
        tier: 2 as const,
      }),
    ] as const),
    neighbors: Object.freeze([]),
    tags: Object.freeze(["test"]),
  });
}

function district(overrides: Partial<GreyboxDistrict> = {}): GreyboxDistrict {
  return Object.freeze({
    bounds: Object.freeze({
      maximum: [10, 10, 10] as const,
      minimum: [0, -10, 0] as const,
    }),
    cellSizeMeters: 10,
    cells: Object.freeze([cell()]),
    generator: Object.freeze({ seed: 1, version: 1 }),
    id: "test-district",
    lodHysteresisMeters: 2,
    markers: Object.freeze([]),
    materials: Object.freeze([Object.freeze({ color: [0.5, 0.5, 0.5] as const, id: "ground" })]),
    schemaVersion: 1,
    standardTraversalMetersPerSecond: 12,
    units: "meters",
    ...overrides,
  });
}

describe("greybox world contract", () => {
  it("summarizes a valid district and selects LOD by distance to cell bounds", () => {
    expect(validateGreyboxDistrict(district())).toEqual({
      cellCount: 1,
      colliderCount: 0,
      heightSampleCount: 4,
      lodPrimitiveCounts: [1, 1, 1],
      markerCount: 0,
    });
    expect(selectGreyboxCellLod(cell(), [[5, 0, 5]]).lod?.tier).toBe(0);
    expect(selectGreyboxCellLod(cell(), [[25, 0, 5]]).lod?.tier).toBe(1);
    expect(selectGreyboxCellLod(cell(), [[45, 0, 5]]).lod?.tier).toBe(2);
  });

  it("uses the nearest observer, applies hysteresis in both directions, and culls outside coverage", () => {
    expect(
      selectGreyboxCellLod(cell(), [
        [51, 0, 5],
        [5, 0, 5],
      ]).lod?.tier,
    ).toBe(0);
    expect(selectGreyboxCellLod(cell(), [[51, 0, 5]]).lod).toBeNull();
    expect(
      selectGreyboxCellLod(cell(), [[21, 0, 5]], {
        hysteresisMeters: 2,
        previousTier: 0,
      }).lod?.tier,
    ).toBe(0);
    expect(
      selectGreyboxCellLod(cell(), [[23, 0, 5]], {
        hysteresisMeters: 2,
        previousTier: 0,
      }).lod?.tier,
    ).toBe(1);
    expect(
      selectGreyboxCellLod(cell(), [[19, 0, 5]], {
        hysteresisMeters: 2,
        previousTier: 1,
      }).lod?.tier,
    ).toBe(1);
    expect(
      selectGreyboxCellLod(cell(), [[17, 0, 5]], {
        hysteresisMeters: 2,
        previousTier: 1,
      }).lod?.tier,
    ).toBe(0);
  });

  it("rejects increasing LOD complexity", () => {
    const source = cell();
    const invalidCell: GreyboxCell = {
      ...source,
      lods: [{ ...source.lods[0], complexityScore: 1 }, source.lods[1], source.lods[2]],
    };
    expect(() => validateGreyboxDistrict(district({ cells: [invalidCell] }))).toThrow(
      "LOD complexity scores must be positive and not increase",
    );
  });

  it("rejects unknown material references", () => {
    const source = cell();
    const representation = source.lods[0].representations[0];
    if (representation?.kind !== "triangle-boxes") {
      throw new Error("Test fixture omitted its triangle-box representation");
    }
    const primitive = representation.primitives[0];
    if (primitive === undefined) throw new Error("Test fixture omitted its primitive");
    const invalidCell: GreyboxCell = {
      ...source,
      lods: [
        {
          ...source.lods[0],
          representations: [
            {
              kind: "triangle-boxes",
              primitives: [{ ...primitive, materialId: "missing" }],
            },
          ],
        },
        source.lods[1],
        source.lods[2],
      ],
    };
    expect(() => validateGreyboxDistrict(district({ cells: [invalidCell] }))).toThrow(
      "unknown material missing",
    );
  });

  it("fails closed on malformed runtime representation, LOD, and collider records", () => {
    const source = cell();
    const unsupportedRepresentation = {
      ...source,
      lods: [
        {
          ...source.lods[0],
          representations: [{ kind: "future-format" }],
        },
        source.lods[1],
        source.lods[2],
      ],
    } as unknown as GreyboxCell;
    expect(() => validateGreyboxDistrict(district({ cells: [unsupportedRepresentation] }))).toThrow(
      "unsupported representation",
    );

    const missingTier = {
      ...source,
      lods: [source.lods[0], source.lods[1]],
    } as unknown as GreyboxCell;
    expect(() => validateGreyboxDistrict(district({ cells: [missingTier] }))).toThrow(
      "exactly three LOD tiers",
    );

    const invalidCollider = {
      ...source,
      collision: {
        ...source.collision,
        obstacles: [{ center: [1, 1, 1], id: "bad", kind: "sphere", size: [1, 1, 1] }],
      },
    } as unknown as GreyboxCell;
    expect(() => validateGreyboxDistrict(district({ cells: [invalidCollider] }))).toThrow(
      "invalid collider kind",
    );
  });
});
