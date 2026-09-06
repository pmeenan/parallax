import assert from "node:assert/strict";
import { writePbrAssetMatrix } from "../../engine/src/world/pbr-asset-transform.ts";

function hull(points) {
  const unique = [...new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values()].sort(
    (a, b) => a[0] - b[0] || a[1] - b[1],
  );
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out.at(-2), out.at(-1), p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(unique), ...half([...unique].reverse())];
}
function distance(p, polygon) {
  let inside = false,
    min = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j],
      b = polygon[i],
      dx = b[0] - a[0],
      dz = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)),
    );
    min = Math.min(min, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz));
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside ? -min : min;
}

/** Conservative convex projected geometry footprint: roots cannot pass by
 * trusting an undersized authored outline. Source poses are canonical RH. */
export function validateStoneRootClearance(layout, source, geometryByStem) {
  assert(Array.isArray(layout.placements) && layout.placements.length > 0);
  assert(Array.isArray(layout.grassRoots) && layout.grassRoots.length > 0);
  const polygons = [];
  for (const placement of layout.placements) {
    const variant = source.variants.find((v) => v.id === placement.variantId);
    assert(variant);
    if (variant.kind !== "stone") continue;
    const matrix = new Float64Array(16);
    writePbrAssetMatrix(matrix, 0, {
      position: placement.center,
      rotationXRadians: placement.pitch,
      rotationYRadians: placement.yaw,
      rotationZRadians: placement.roll,
      scale: [placement.scale, placement.scale, placement.scale],
    });
    for (let i = 0; i < 3; i++) matrix[i] *= -1; // Cancel runtime RH-to-LH reflection for source-space QA.
    assert([...matrix].every(Number.isFinite));
    const points = [];
    for (const stem of variant.lods) {
      const vertices = geometryByStem.get(stem);
      assert(vertices);
      for (let i = 0; i < vertices.length; i += 12)
        points.push(
          [0, 2].map(
            (axis) =>
              matrix[axis] * vertices[i] +
              matrix[4 + axis] * vertices[i + 1] +
              matrix[8 + axis] * vertices[i + 2] +
              matrix[12 + axis],
          ),
        );
    }
    polygons.push(hull(points));
  }
  let minimumMarginMetres = Infinity;
  for (const root of layout.grassRoots) {
    assert(root.position.length === 3 && root.position.every(Number.isFinite));
    assert(Number.isFinite(root.footprintRadiusMetres) && root.footprintRadiusMetres > 0);
    assert(Number.isFinite(root.clearanceMetres) && root.clearanceMetres >= 0);
    assert(
      Math.abs(root.position[0]) + root.footprintRadiusMetres <= 2.001 &&
        Math.abs(root.position[2]) + root.footprintRadiusMetres <= 2.001,
      "Grass root leaves patch",
    );
    for (const polygon of polygons) {
      const margin =
        distance([root.position[0], root.position[2]], polygon) -
        root.footprintRadiusMetres -
        root.clearanceMetres;
      minimumMarginMetres = Math.min(minimumMarginMetres, margin);
      assert(margin >= -1e-6, "Grass root overlaps stone footprint or clearance");
    }
  }
  return {
    roots: layout.grassRoots.length,
    stoneFootprints: polygons.length,
    minimumMarginMetres,
    method: "all-LOD transformed geometry convex footprint",
  };
}
