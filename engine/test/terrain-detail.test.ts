import { describe, expect, it } from "vitest";
import { createHeightfieldGeometryBatch } from "../src/render/lite-greybox-world";
import { float16Bits, terrainDetailSlope, terrainDrapeTexels } from "../src/render/terrain-drape";
import type {
  GreyboxCell,
  GreyboxDistrict,
  GreyboxHeightfieldCollider,
} from "../src/world/world-contract";
import {
  sampleCellGroundHeight,
  sampleHeightfieldBilinear,
  validateGreyboxDistrict,
} from "../src/world/world-contract";

// One 32 m cell on a 16 m coarse lattice; the detail field covers [0, 16]² at 0.5 m.
const COARSE = 16;
const SPACING = 0.5;
const relief = (x: number, z: number): number =>
  x <= 0 || z <= 0 || x >= 16 || z >= 16
    ? 0
    : 0.3 * Math.sin((Math.PI * x) / 16) ** 2 * Math.sin((Math.PI * z) / 16) ** 2;

function coarseField(): GreyboxHeightfieldCollider {
  // A tilted plane, so bilinear and triangle interpolation both carry real slope.
  const heights: number[] = [];
  for (let row = 0; row < 3; row++)
    for (let column = 0; column < 3; column++) heights.push(10 + column * 0.8 + row * 0.3);
  return {
    columns: 3,
    heights,
    kind: "heightfield",
    origin: [0, 0, 0],
    rows: 3,
    sampleSpacingMeters: COARSE,
  };
}

function detailField(
  coarse: GreyboxHeightfieldCollider,
  mutate?: (heights: number[]) => void,
): GreyboxHeightfieldCollider {
  const size = 16 / SPACING + 1;
  const heights: number[] = [];
  for (let row = 0; row < size; row++)
    for (let column = 0; column < size; column++) {
      const x = column * SPACING;
      const z = row * SPACING;
      heights.push(sampleHeightfieldBilinear(coarse, x, z) + relief(x, z));
    }
  mutate?.(heights);
  return {
    columns: size,
    heights,
    kind: "heightfield",
    origin: [0, 0, 0],
    rows: size,
    sampleSpacingMeters: SPACING,
  };
}

function cell(detail?: GreyboxHeightfieldCollider): GreyboxCell {
  const heightfield = coarseField();
  return {
    bounds: { maximum: [32, 100, 32], minimum: [0, -10, 0] },
    collision: { ...(detail ? { detail } : {}), heightfield, obstacles: [] },
    coordinate: [0, 0],
    id: "cell-0-0",
    lods: [0, 1, 2].map((tier) => ({
      complexityScore: 100 - tier,
      maxDistanceMeters: 100 * (tier + 1),
      representations: [{ kind: "heightfield-grid", materialId: "ground", sampleStride: 1 }],
      tier,
    })) as unknown as GreyboxCell["lods"],
    neighbors: [],
    tags: ["test"],
  };
}

function district(target: GreyboxCell): GreyboxDistrict {
  return {
    bounds: { maximum: [32, 100, 32], minimum: [0, -10, 0] },
    cellSizeMeters: 32,
    cells: [target],
    generator: { seed: 1, version: 1 },
    id: "test",
    lodHysteresisMeters: 1,
    markers: [],
    materials: [{ color: [0.2, 0.5, 0.2], id: "ground" }],
    schemaVersion: 1,
    standardTraversalMetersPerSecond: 5,
    units: "meters",
  };
}

function float16Value(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const mantissa = bits & 0x3ff;
  return exponent === 0
    ? sign * mantissa * 2 ** -24
    : sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

describe("terrain detail fields (D-204)", () => {
  it("is the ground inside its rectangle and falls back to the coarse field outside", () => {
    const detail = detailField(coarseField());
    const target = cell(detail);
    expect(sampleCellGroundHeight(target.collision, 8, 8)).toBeCloseTo(
      sampleHeightfieldBilinear(coarseField(), 8, 8) + 0.3,
      12,
    );
    expect(sampleCellGroundHeight(target.collision, 24, 8)).toBe(
      sampleHeightfieldBilinear(coarseField(), 24, 8),
    );
    expect(() => validateGreyboxDistrict(district(target))).not.toThrow();
  });

  it("rejects a field off the coarse lattice or one whose inner edge leaves the coarse terrain", () => {
    const offLattice = { ...detailField(coarseField()), origin: [0.5, 0, 0] as const };
    expect(() => validateGreyboxDistrict(district(cell(offLattice)))).toThrow(/coarse collision/);
    const lifted = detailField(coarseField(), (heights) => {
      heights[heights.length - 1] = (heights[heights.length - 1] ?? 0) + 0.01;
    });
    expect(() => validateGreyboxDistrict(district(cell(lifted)))).toThrow(/edge does not meet/);
  });

  it("renders one seamless surface: covered coarse quads go, skirts follow the ground", () => {
    const target = cell(detailField(coarseField()));
    const batch = createHeightfieldGeometryBatch([
      {
        cell: target,
        representation: { kind: "heightfield-grid", materialId: "ground", sampleStride: 1 },
      },
    ]);
    const vertexCount = batch.positions.length / 3;
    const fine = (16 / SPACING + 1) ** 2;
    // 9 coarse vertices, 3 of 4 coarse quads, the fine grid, and four skirts whose
    // western and southern walls also carry the fine edge samples.
    const skirtSamples = 2 * 3 + 2 * (3 + 16 / SPACING - 1);
    expect(vertexCount).toBe(9 + fine + skirtSamples * 2);
    expect(batch.indices.length).toBe(3 * 6 + (16 / SPACING) ** 2 * 6 + (skirtSamples - 4) * 6);
    expect(batch.triangleCount * 3).toBe(batch.indices.length);
    expect(Math.max(...batch.indices)).toBeLessThan(vertexCount);
    // Every vertex at or above the ground is on it: surface vertices and skirt tops.
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const x = batch.positions[vertex * 3] ?? 0;
      const y = batch.positions[vertex * 3 + 1] ?? 0;
      const z = batch.positions[vertex * 3 + 2] ?? 0;
      if (y === -10) continue;
      expect(Math.abs(y - sampleCellGroundHeight(target.collision, x, z))).toBeLessThan(1e-5);
    }
  });

  it("encodes float16 with round-to-nearest-even", () => {
    expect(float16Bits(0)).toBe(0);
    expect(float16Bits(1)).toBe(0x3c00);
    expect(float16Bits(-2)).toBe(0xc000);
    expect(float16Bits(0.1)).toBe(0x2e66);
    expect(float16Bits(65504)).toBe(0x7bff);
    expect(float16Bits(2 ** -24)).toBe(1);
    expect(float16Bits(1 + 2 ** -11)).toBe(0x3c00);
    expect(float16Bits(1 + 3 * 2 ** -11)).toBe(0x3c02);
    expect(() => float16Bits(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => float16Bits(70000)).toThrow();
  });

  it("drapes onto collision's bilinear surface to within float16 precision", () => {
    const detail = detailField(coarseField());
    const reference = sampleHeightfieldBilinear(detail, 8, 8);
    const texels = terrainDrapeTexels(detail, reference);
    const texel = (column: number, row: number, channel: number): number =>
      float16Value(texels[(row * detail.columns + column) * 4 + channel] ?? 0);
    // CPU mirror of the vertex-stage WGSL in terrain-drape.ts.
    const drape = (x: number, z: number, channel: number): number => {
      const maximum = detail.columns - 1;
      const gx = Math.min(Math.max(x / SPACING, 0), maximum);
      const gz = Math.min(Math.max(z / SPACING, 0), maximum);
      const cx = Math.min(Math.floor(gx), maximum - 1);
      const cz = Math.min(Math.floor(gz), maximum - 1);
      const fx = gx - cx;
      const fz = gz - cz;
      const mix = (a: number, b: number, t: number) => a + (b - a) * t;
      return mix(
        mix(texel(cx, cz, channel), texel(Math.min(cx + 1, maximum), cz, channel), fx),
        mix(
          texel(cx, Math.min(cz + 1, maximum), channel),
          texel(Math.min(cx + 1, maximum), Math.min(cz + 1, maximum), channel),
          fx,
        ),
        fz,
      );
    };
    let worst = 0;
    for (let x = 0; x <= 16; x += 0.37)
      for (let z = 0; z <= 16; z += 0.41)
        worst = Math.max(
          worst,
          Math.abs(
            reference + drape(x, z, 0) - sampleCellGroundHeight(cell(detail).collision, x, z),
          ),
        );
    // Displacements here stay under 1 m, where float16 steps are at most 0.5 mm.
    expect(worst).toBeLessThan(5e-4);
    // Slopes are central differences, one-sided at the edge.
    const [slopeX, slopeZ] = terrainDetailSlope(detail, 16, 8);
    expect(texel(16, 8, 1)).toBeCloseTo(slopeX, 3);
    expect(texel(16, 8, 2)).toBeCloseTo(slopeZ, 3);
    expect(terrainDetailSlope(detail, 0, 0)[0]).toBeCloseTo(
      ((detail.heights[1] ?? 0) - (detail.heights[0] ?? 0)) / SPACING,
      12,
    );
  });
});
