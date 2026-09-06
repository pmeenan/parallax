import assert from "node:assert/strict";

/** UV seams split indices; closedness is tested on welded metric positions. */
export function validateStoneVariantGeometry(entry, attributes, indices, budget) {
  assert.equal(attributes.length, entry.vertices * 12);
  assert.equal(indices.length, entry.triangles * 3);
  const kind = entry.kind ?? "stone";
  assert(["stone", "substrate", "grass"].includes(kind));
  assert.equal(
    entry.uvPolicy,
    kind === "grass" ? "solid-color-vegetation" : "shared-procedural-surface",
  );
  assert(entry.triangles > 0 && entry.triangles <= budget[`${kind}Triangles`][entry.lod]);
  assert([...attributes].every(Number.isFinite));
  const minimum = [Infinity, Infinity, Infinity],
    maximum = [-Infinity, -Infinity, -Infinity];
  const positions = [];
  for (let i = 0; i < entry.vertices; i++) {
    const v = i * 12;
    assert(
      Math.abs(Math.hypot(...attributes.subarray(v + 3, v + 6)) - 1) < 0.002,
      "Nonunit normal",
    );
    for (let axis = 0; axis < 3; axis++) {
      const value = attributes[v + axis];
      minimum[axis] = Math.min(minimum[axis], value);
      maximum[axis] = Math.max(maximum[axis], value);
      const bounds =
        kind === "stone"
          ? budget.boundsMetres
          : { minimum: [-2.001, -0.1, -2.001], maximum: [2.001, 0.3, 2.001] };
      assert(value >= bounds.minimum[axis] && value <= bounds.maximum[axis], "Metric stone bounds");
    }
    assert(
      attributes[v + 6] >= 0 &&
        attributes[v + 6] <= 1 &&
        attributes[v + 7] >= 0 &&
        attributes[v + 7] <= 1,
      "UV outside material domain",
    );
    positions.push([0, 1, 2].map((axis) => Math.round(attributes[v + axis] * 1e6)).join(","));
  }
  for (let axis = 0; axis < 3; axis++)
    for (const [side, actual] of [
      [0, minimum],
      [1, maximum],
    ])
      assert(
        Math.abs(entry.bounds[side][axis] - actual[axis]) <= 1e-6,
        "Declared bounds differ from geometry",
      );
  if (kind === "stone") assert(Math.abs(minimum[1]) <= 1e-5, "Stone pivot must rest at local Y=0");
  const edges = new Map();
  let volume = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const ids = [indices[i], indices[i + 1], indices[i + 2]];
    assert(
      ids.every((index) => Number.isInteger(index) && index >= 0 && index < entry.vertices),
      "Invalid triangle index",
    );
    const [a, b, c] = ids.map((index) => attributes.subarray(index * 12, index * 12 + 12));
    const ab = [0, 1, 2].map((j) => b[j] - a[j]),
      ac = [0, 1, 2].map((j) => c[j] - a[j]);
    const cross = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    assert(Math.hypot(...cross) > 1e-12, "Degenerate geometric triangle");
    if (kind !== "grass")
      assert(
        Math.abs((b[6] - a[6]) * (c[7] - a[7]) - (b[7] - a[7]) * (c[6] - a[6])) > 1e-12,
        "Degenerate UV triangle",
      );
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
    for (let j = 0; j < 3; j++) {
      const from = positions[ids[j]],
        to = positions[ids[(j + 1) % 3]];
      assert.notEqual(from, to, "Collapsed welded edge");
      const key = from < to ? `${from}|${to}` : `${to}|${from}`;
      const edge = edges.get(key) ?? { count: 0, balance: 0 };
      edge.count++;
      edge.balance += from < to ? 1 : -1;
      edges.set(key, edge);
    }
  }
  if (kind === "stone") {
    assert(
      [...edges.values()].every((edge) => edge.count === 2 && edge.balance === 0),
      "Stone must be a closed consistently wound manifold",
    );
    assert(volume > 1e-8, "Stone winding or enclosed volume invalid");
  }
  return {
    kind,
    bounds: [minimum, maximum],
    ...(kind === "stone" ? { closedGeometricEdges: edges.size, signedVolumeMetres3: volume } : {}),
    uvPolicy: entry.uvPolicy,
  };
}

export function validateStoneVariantSet(source, budget) {
  assert.equal(source.mode, "individual-stone-variants");
  assert.equal(source.periodic, undefined, "Individual stones must not claim periodic tile QA");
  const stones = source.variants.filter((v) => v.kind === "stone");
  assert(stones.length > 0 && stones.length <= budget.maxVariants);
  assert.equal(source.variants.filter((v) => v.kind === "substrate").length, 1);
  assert.equal(source.variants.filter((v) => v.kind === "grass").length, 1);
  assert.equal(source.variants.length, stones.length + 2);
  assert.deepEqual(Object.keys(source.materials).sort(), ["earth", "stone", "vegetation"]);
  for (const material of Object.values(source.materials)) {
    for (const field of ["baseColor", "normal", "metallicRoughness"])
      assert(Object.hasOwn(budget.textureWidths, material[field]), "Unknown material texture");
    for (const field of ["metallicFactor", "roughnessFactor"])
      assert(
        Number.isFinite(material[field]) && material[field] >= 0 && material[field] <= 1,
        "Invalid material factor",
      );
    assert(
      Number.isFinite(material.normalStrength) &&
        material.normalStrength >= 0 &&
        material.normalStrength <= 4,
    );
    assert(["repeat", "clamp-to-edge"].includes(material.textureAddressMode));
    if (material.baseColorFactor !== undefined)
      assert(
        material.baseColorFactor.length === 3 &&
          material.baseColorFactor.every((v) => Number.isFinite(v) && v >= 0 && v <= 1),
      );
  }
  assert.equal(new Set(source.variants.map((v) => v.id)).size, source.variants.length);
  assert.equal(source.meshes.length, source.variants.length * 3);
  assert.equal(new Set(source.meshes.map((m) => m.stem)).size, source.meshes.length);
  for (const variant of source.variants) {
    if (variant.kind === "stone")
      assert.match(variant.id, /^limestone-(square|rect|large)-[0-9]+$/);
    else assert.equal(variant.id, variant.kind);
    assert.equal(
      variant.material,
      { stone: "stone", substrate: "earth", grass: "vegetation" }[variant.kind],
    );
    assert.equal(variant.lods.length, 3);
    let previous = Infinity;
    for (const [lod, stem] of variant.lods.entries()) {
      assert.match(stem, /^[a-z0-9-]+$/);
      const mesh = source.meshes.find((m) => m.stem === stem);
      assert(mesh, "Missing variant LOD");
      assert.equal(mesh.variantId, variant.id);
      assert.equal(mesh.material, variant.material);
      assert.equal(mesh.lod, lod);
      assert.equal(mesh.kind, variant.kind);
      assert(mesh.triangles < previous, "LOD triangle count must decrease");
      previous = mesh.triangles;
    }
  }
}
