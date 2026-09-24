import { describe, expect, it } from "vitest";
import { resolvePbrAssetsForCell } from "./pbr-asset-packaging.mjs";

const cell = {
  bounds: { minimum: [0, 0, 0], maximum: [16, 40, 16] },
  collision: {
    heightfield: {
      origin: [0, 0, 0],
      sampleSpacingMeters: 16,
      columns: 2,
      rows: 2,
      heights: [10, 12, 12, 14],
    },
  },
};
const bounds = [
  [-2, -0.02, -2],
  [2, 0.02, 2],
];
const lods = (part) =>
  [0, 1, 2].map((lod) => ({
    vertexRole: `${part}-lod${lod}-vertices`,
    indexRole: `${part}-lod${lod}-indices`,
    bounds,
  }));
const material = (baseColor, normal, orm, textureAddressMode) => ({
  baseColor,
  normal,
  orm,
  textureAddressMode,
  baseColorFactor: [1, 1, 1],
  roughnessFactor: 1,
  metallicFactor: 0,
  normalScale: 1,
});
const library = {
  manifest: {
    assetId: "module",
    parts: {
      ground: { material: "ground", lods: lods("ground") },
      pebbles: { material: "pebbles", lods: lods("pebbles") },
      plants: { material: "plants", lods: lods("plants") },
    },
    materials: {
      ground: material("ground-basecolor", "ground-normal", "ground-orm", "repeat"),
      pebbles: material("ground-basecolor", "pebble-normal", "pebble-orm", "repeat"),
      plants: material("plant-basecolor", "plant-normal", "plant-orm", "clamp-to-edge"),
    },
  },
  byRole: { get: (role) => role },
};
const tile = (x, z, variantId) => ({
  id: `tile-${x}-${z}-${variantId}`,
  assetId: "module",
  variantId,
  center: [x, z],
  heightAnchor: [8, 8],
  heightOffset: 0.021,
  rotationYRadians: 0,
  lodDistancesMeters: [12, 32],
});

describe("periodic surface module packaging", () => {
  it("places every part of adjoining tiles on one anchored plane with shared resources", () => {
    const requests = [2, 6, 10, 14].flatMap((x) =>
      [2, 6].flatMap((z) => ["ground", "pebbles", "plants"].map((part) => tile(x, z, part))),
    );
    const result = resolvePbrAssetsForCell(cell, requests, library);
    expect(result.cell.pbrAssets).toHaveLength(24);
    expect(new Set(result.cell.pbrAssets.map((p) => p.position[1]))).toEqual(new Set([12.021]));
    const byPart = (part) => result.cell.pbrAssets.find((p) => p.id.endsWith(part));
    expect(byPart("ground").material).toMatchObject({
      baseColorResourceId: "ground-basecolor",
      textureAddressMode: "repeat",
    });
    expect(byPart("pebbles").material.baseColorResourceId).toBe("ground-basecolor");
    expect(byPart("plants").material.textureAddressMode).toBe("clamp-to-edge");
    // Normal + ORM per material (pebbles share the ground base colour) and nine index streams per part.
    expect(result.dependencies).toHaveLength(6 + 9);
  });

  it("rejects tiles crossing cell ownership, cross-cell anchors and unknown parts", () => {
    expect(() => resolvePbrAssetsForCell(cell, [tile(1, 8, "ground")], library)).toThrow(
      /ownership boundary/,
    );
    expect(() =>
      resolvePbrAssetsForCell(cell, [{ ...tile(8, 8, "ground"), heightAnchor: [17, 8] }], library),
    ).toThrow(/height anchor/);
    expect(() => resolvePbrAssetsForCell(cell, [tile(8, 8, "stones")], library)).toThrow(
      /Unknown module part/,
    );
    expect(resolvePbrAssetsForCell(cell, [tile(20, 8, "ground")], library).cell.pbrAssets).toBe(
      undefined,
    );
  });
});
