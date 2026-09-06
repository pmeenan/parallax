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
const library = {
  manifest: {
    assetId: "test",
    sourceWidthMetres: 2,
    normalStrength: 1,
    materials: Object.fromEntries(
      ["stone", "grass"].map((surface) => [
        surface,
        {
          baseColor: `${surface}-base`,
          metallicRoughness: `${surface}-orm`,
          metallicFactor: 0,
          roughnessFactor: 1,
          normalStrength: 1,
          ...(surface === "stone" ? { textureAddressMode: "repeat" } : {}),
        },
      ]),
    ),
  },
  byRole: { get: (role) => role },
};
const request = {
  id: "test",
  assetId: "test",
  center: [6, 6],
  heightOffset: 0.015,
  rotationYRadians: 0,
  lodDistancesMeters: [12, 32],
};

describe("PBR placement packaging", () => {
  it("shares variant dependencies and checks rotated scaled geometry footprints", () => {
    const variants = {
      manifest: {
        mode: "individual-stone-variants",
        assetId: "test",
        variants: [{ id: "square", kind: "stone", material: "stone", lods: ["a", "b", "c"] }],
        meshes: ["a", "b", "c"].map((stem) => ({
          stem,
          triangles: 100,
          bounds: [
            [-0.2, 0, -0.1],
            [0.2, 0.1, 0.1],
          ],
        })),
        materials: {
          stone: {
            baseColor: "base",
            normal: "normal",
            metallicRoughness: "orm",
            metallicFactor: 0,
            roughnessFactor: 1,
            normalStrength: 1,
          },
        },
      },
      byRole: { get: (role) => role },
    };
    const r = {
      ...request,
      variantId: "square",
      scale: 2,
      rotationXRadians: 0.2,
      rotationZRadians: 0.1,
    };
    const result = resolvePbrAssetsForCell(
      cell,
      [r, { ...r, id: "second", center: [7, 7] }],
      variants,
    );
    expect(result.cell.pbrAssets).toHaveLength(2);
    expect(result.dependencies).toHaveLength(5);
    expect(result.cell.pbrAssets[0].scale).toEqual([2, 2, 2]);
    expect(() => resolvePbrAssetsForCell(cell, [{ ...r, center: [0.1, 0.1] }], variants)).toThrow(
      /ownership boundary/,
    );
  });
  it("honors an admitted asset-wide sampler default and material overrides", () => {
    const periodic = {
      ...library,
      manifest: { ...library.manifest, textureAddressMode: "repeat" },
    };
    const result = resolvePbrAssetsForCell(cell, [request], periodic);
    expect(result.cell.pbrAssets.map((p) => p.material.textureAddressMode)).toEqual([
      "repeat",
      "repeat",
    ]);
    const mixed = {
      ...periodic,
      manifest: {
        ...periodic.manifest,
        materials: {
          ...periodic.manifest.materials,
          grass: { ...periodic.manifest.materials.grass, textureAddressMode: "clamp-to-edge" },
        },
      },
    };
    expect(
      resolvePbrAssetsForCell(cell, [request], mixed).cell.pbrAssets[1].material.textureAddressMode,
    ).toBe("clamp-to-edge");
  });
  it("bakes one anchor height for nine adjoining modules on sloping terrain", () => {
    const requests = [4, 6, 8].flatMap((x) =>
      [4, 6, 8].map((z) => ({
        ...request,
        id: `tile-${x}-${z}`,
        center: [x, z],
        heightAnchor: [6, 6],
      })),
    );
    const result = resolvePbrAssetsForCell(cell, requests, library);
    expect(result.cell.pbrAssets).toHaveLength(18);
    expect(new Set(result.cell.pbrAssets.map((p) => p.position[1]))).toEqual(new Set([11.515]));
    expect(result.cell.pbrAssets[0].material.textureAddressMode).toBe("repeat");
    expect(result.cell.pbrAssets[1].material.textureAddressMode).toBe("clamp-to-edge");
    expect(result.dependencies).toHaveLength(10);
  });
  it("preserves center sampling for finite placements and rejects cross-cell anchors", () => {
    const result = resolvePbrAssetsForCell(cell, [{ ...request, center: [4, 4] }], library);
    expect(result.cell.pbrAssets[0].position[1]).toBe(11.015);
    expect(() =>
      resolvePbrAssetsForCell(cell, [{ ...request, heightAnchor: [17, 6] }], library),
    ).toThrow(/height anchor/);
  });
});
