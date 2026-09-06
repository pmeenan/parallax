import { describe, expect, it } from "vitest";
import { validateStoneRootClearance } from "../../assets/qa/stone-root-clearance.mjs";
import { validateStoneVariantGeometry } from "../../assets/qa/stone-variant-geometry.mjs";

function tetrahedron() {
  const positions = [
    [0, 0, 0],
    [0.1, 0, 0],
    [0, 0.1, 0],
    [0, 0, 0.1],
  ];
  const faces = [
    [0, 2, 1],
    [0, 1, 3],
    [0, 3, 2],
    [1, 2, 3],
  ];
  const attributes = [];
  for (const face of faces)
    for (const [i, id] of face.entries())
      attributes.push(
        ...positions[id],
        0,
        1,
        0,
        ...[
          [0, 0],
          [1, 0],
          [0, 1],
        ][i],
        1,
        0,
        0,
        1,
      );
  return {
    attributes: new Float32Array(attributes),
    indices: Uint32Array.from({ length: 12 }, (_, i) => i),
    entry: {
      kind: "stone",
      vertices: 12,
      triangles: 4,
      lod: 0,
      bounds: [
        [0, 0, 0],
        [0.1, 0.1, 0.1],
      ],
      uvPolicy: "shared-procedural-surface",
    },
  };
}
const budget = {
  stoneTriangles: [4000, 1200, 400],
  boundsMetres: { minimum: [-0.4, -0.00001, -0.4], maximum: [0.4, 0.15, 0.4] },
};
describe("individual stone geometry gate", () => {
  it("checks roots against geometry rather than trusting authored footprints", () => {
    const f = tetrahedron();
    const source = { variants: [{ id: "stone", kind: "stone", lods: ["a", "b", "c"] }] };
    const geometry = new Map(["a", "b", "c"].map((stem) => [stem, f.attributes]));
    const layout = {
      placements: [
        {
          variantId: "stone",
          center: [0, 0, 0],
          yaw: 0,
          pitch: 0,
          roll: 0,
          scale: 1,
          footprint: [],
        },
      ],
      grassRoots: [{ position: [0.2, 0, 0.2], footprintRadiusMetres: 0.01, clearanceMetres: 0.01 }],
    };
    expect(validateStoneRootClearance(layout, source, geometry).roots).toBe(1);
    layout.grassRoots[0].position = [0.02, 0, 0.02];
    expect(() => validateStoneRootClearance(layout, source, geometry)).toThrow(/overlaps/);
  });
  it("welds UV split edges and rejects open or reversed shells", () => {
    const f = tetrahedron();
    expect(
      validateStoneVariantGeometry(f.entry, f.attributes, f.indices, budget).closedGeometricEdges,
    ).toBe(6);
    expect(() =>
      validateStoneVariantGeometry(
        { ...f.entry, triangles: 3 },
        f.attributes,
        f.indices.slice(0, 9),
        budget,
      ),
    ).toThrow(/closed/);
    const reversed = f.indices.slice();
    [reversed[1], reversed[2]] = [reversed[2], reversed[1]];
    expect(() => validateStoneVariantGeometry(f.entry, f.attributes, reversed, budget)).toThrow(
      /closed/,
    );
  });
  it("rejects untruthful bounds and collapsed material UVs", () => {
    const f = tetrahedron();
    expect(() =>
      validateStoneVariantGeometry(
        {
          ...f.entry,
          bounds: [
            [0, 0, 0],
            [0.2, 0.1, 0.1],
          ],
        },
        f.attributes,
        f.indices,
        budget,
      ),
    ).toThrow(/Declared bounds/);
    f.attributes[18] = 0;
    f.attributes[19] = 0;
    expect(() => validateStoneVariantGeometry(f.entry, f.attributes, f.indices, budget)).toThrow(
      /UV triangle/,
    );
  });
});
