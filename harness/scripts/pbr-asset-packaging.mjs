import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { scaleStreamingDependencyResourceId } from "../../engine/src/streaming/scale-streaming-resource-id.ts";
import { writePbrAssetMatrix } from "../../engine/src/world/pbr-asset-transform.ts";

/** Only admitted library objects cross this build boundary; source art is never packaged. */
export async function loadPbrAssetLibrary(root, writeResource) {
  const manifest = JSON.parse(
    await readFile(resolve(root, "assets/library/d1-paving.json"), "utf8"),
  );
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.status, "QA-admitted-runtime-visual-acceptance-pending");
  const resources = [];
  const byRole = new Map();
  for (const entry of manifest.resources) {
    assert.match(entry.file, /^[a-f0-9]{64}\.(glb|ktx2|meshopt)$/);
    assert.equal(entry.path, `objects/${entry.file}`);
    const bytes = await readFile(resolve(root, "assets/library", entry.path));
    assert.equal(bytes.length, entry.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
    if (entry.file.endsWith(".glb")) continue;
    const texture = entry.file.endsWith(".ktx2");
    const role = texture ? "texture" : entry.role.endsWith("-vertices") ? "vertices" : "indices";
    const resourceId = scaleStreamingDependencyResourceId(role, entry.sha256);
    assert(!byRole.has(entry.role), "Repeated asset role");
    byRole.set(entry.role, resourceId);
    let decode;
    let dependencies;
    if (texture) {
      const width = manifest.textureWidths[entry.role];
      decode = {
        colorSpace: /basecolor/i.test(entry.role) ? "srgb" : "linear",
        format: "rgba8",
        width,
        height: width,
        version: 2,
        mipLevelCount: manifest.mipLevels[entry.role],
      };
      dependencies = [];
    } else {
      const variantMode = manifest.mode === "individual-stone-variants";
      const variantMesh = variantMode
        ? manifest.meshes.find(
            (mesh) =>
              entry.role === `${mesh.stem}-vertices` || entry.role === `${mesh.stem}-indices`,
          )
        : undefined;
      const match = /^lod([0-2])-(stone|grass)-(vertices|indices)$/.exec(entry.role);
      if (variantMode) assert(variantMesh, "Missing variant topology");
      else assert(match, "Invalid geometry role");
      const [, level, surface, kind] = match ?? [
        null,
        variantMesh.lod,
        variantMesh.material,
        entry.role.endsWith("-vertices") ? "vertices" : "indices",
      ];
      const mesh =
        variantMesh ??
        manifest.source.meshes.find((m) => m.lod === Number(level) && m.role === surface);
      assert(mesh, "Missing source topology");
      const base = byRole.get(
        variantMode
          ? manifest.materials[mesh.material].baseColor
          : surface === "stone"
            ? "baseColor"
            : "grassBaseColor",
      );
      assert(base, "Texture must precede geometry");
      if (kind === "vertices") {
        decode = {
          count: mesh.vertices,
          layout: "position-normal-uv-f32",
          mode: "ATTRIBUTES",
          stride: 32,
          version: 1,
        };
        dependencies = [base];
      } else {
        const vertices = byRole.get(
          variantMode ? `${mesh.stem}-vertices` : `lod${level}-${surface}-vertices`,
        );
        assert(vertices, "Vertex stream must precede indices");
        decode = {
          count: mesh.triangles * 3,
          indexFormat: "uint32",
          mode: "TRIANGLES",
          stride: 4,
          version: 1,
          vertexCount: mesh.vertices,
        };
        dependencies = [base, vertices];
      }
    }
    resources.push(
      await writeResource(bytes, `streaming-${role}`, texture ? ".ktx2" : ".meshopt", {
        decode,
        dependencies,
        format: texture ? "ktx2" : "meshopt",
        resourceId,
      }),
    );
  }
  if (manifest.mode === "individual-stone-variants")
    assert.equal(
      resources.length,
      Object.keys(manifest.textureWidths).length + manifest.meshes.length * 2,
    );
  else assert.equal(resources.length, 18);
  return { manifest, resources, byRole };
}

export function resolvePbrAssetsForCell(cell, requests, library) {
  const placements = [];
  const dependencies = new Set();
  if (library.manifest.mode === "individual-stone-variants") {
    let stoneCount = 0,
      nearTriangles = 0;
    for (const request of requests ?? []) {
      const variant = library.manifest.variants.find((v) => v.id === request.variantId);
      assert(variant, "Unknown requested variant");
      if (variant.kind === "stone") {
        stoneCount++;
        nearTriangles += library.manifest.meshes.find((m) => m.stem === variant.lods[0]).triangles;
      }
    }
    assert(
      stoneCount <= 200 && nearTriangles <= 750000,
      "Individual stone scene asset ceiling exceeded",
    );
  }
  for (const request of requests ?? []) {
    const [x, z] = request.center;
    if (
      x < cell.bounds.minimum[0] ||
      x >= cell.bounds.maximum[0] ||
      z < cell.bounds.minimum[2] ||
      z >= cell.bounds.maximum[2]
    )
      continue;
    assert.equal(request.assetId, library.manifest.assetId);
    const [anchorX, anchorZ] = request.heightAnchor ?? request.center;
    assert(
      Number.isFinite(anchorX) &&
        Number.isFinite(anchorZ) &&
        anchorX >= cell.bounds.minimum[0] &&
        anchorX <= cell.bounds.maximum[0] &&
        anchorZ >= cell.bounds.minimum[2] &&
        anchorZ <= cell.bounds.maximum[2],
      "Asset height anchor must lie within its owning cell",
    );
    const placementHeight = surfaceHeight(cell, anchorX, anchorZ) + request.heightOffset;
    if (library.manifest.mode === "individual-stone-variants") {
      const variant = library.manifest.variants.find((entry) => entry.id === request.variantId);
      assert(variant, "Unknown asset variant");
      const sourceMaterial = library.manifest.materials[variant.material];
      const resource = (role) => {
        const id = library.byRole.get(role);
        assert(id, `Missing asset role ${role}`);
        return id;
      };
      const scale = request.scale ?? 1;
      assert(Number.isFinite(scale) && scale > 0 && scale <= 4, "Invalid variant scale");
      const baseColorFactor = request.baseColorFactor ??
        sourceMaterial.baseColorFactor ?? [1, 1, 1];
      assert(
        baseColorFactor.length === 3 &&
          baseColorFactor.every((value) => Number.isFinite(value) && value >= 0 && value <= 1),
        "Invalid variant tint",
      );
      const placement = {
        schemaVersion: 1,
        id: request.id,
        position: [x, placementHeight, z],
        rotationXRadians: request.rotationXRadians ?? 0,
        rotationYRadians: request.rotationYRadians,
        rotationZRadians: request.rotationZRadians ?? 0,
        scale: [scale, scale, scale],
        lodDistancesMeters: request.lodDistancesMeters,
        material: {
          textureAddressMode: sourceMaterial.textureAddressMode ?? "repeat",
          baseColorResourceId: resource(sourceMaterial.baseColor),
          normalResourceId: resource(sourceMaterial.normal),
          ormResourceId: resource(sourceMaterial.metallicRoughness),
          baseColorFactor,
          metallicFactor: sourceMaterial.metallicFactor,
          roughnessFactor: sourceMaterial.roughnessFactor,
          normalScale: sourceMaterial.normalStrength,
        },
        lods: variant.lods.map((stem) => ({
          vertexResourceId: resource(`${stem}-vertices`),
          indexResourceId: resource(`${stem}-indices`),
        })),
      };
      const matrix = new Float64Array(16);
      writePbrAssetMatrix(matrix, 0, placement);
      assert([...matrix].every(Number.isFinite), "Invalid variant transform");
      for (const stem of variant.lods) {
        const mesh = library.manifest.meshes.find((entry) => entry.stem === stem);
        assert(mesh, "Missing variant mesh");
        for (let corner = 0; corner < 8; corner++) {
          const point = [0, 1, 2].map((axis) => mesh.bounds[(corner >> axis) & 1][axis]);
          for (const axis of [0, 1, 2]) {
            const value =
              matrix[axis] * point[0] +
              matrix[4 + axis] * point[1] +
              matrix[8 + axis] * point[2] +
              matrix[12 + axis];
            assert(
              value >= cell.bounds.minimum[axis] && value <= cell.bounds.maximum[axis],
              "Transformed asset crosses cell ownership boundary",
            );
          }
        }
      }
      placements.push(placement);
      dependencies.add(placement.material.normalResourceId);
      dependencies.add(placement.material.ormResourceId);
      for (const lod of placement.lods) dependencies.add(lod.indexResourceId);
      continue;
    }
    const half = library.manifest.sourceWidthMetres / 2;
    assert(
      x - half >= cell.bounds.minimum[0] &&
        x + half <= cell.bounds.maximum[0] &&
        z - half >= cell.bounds.minimum[2] &&
        z + half <= cell.bounds.maximum[2],
      "Asset crosses cell ownership boundary",
    );
    for (const surface of ["stone", "grass"]) {
      const sourceMaterial = library.manifest.materials[surface];
      const textureAddressMode =
        sourceMaterial.textureAddressMode ?? library.manifest.textureAddressMode ?? "clamp-to-edge";
      assert(
        ["clamp-to-edge", "repeat"].includes(textureAddressMode),
        "Invalid asset texture address mode",
      );
      const resource = (role) => {
        const id = library.byRole.get(role);
        assert(id, `Missing asset role ${role}`);
        return id;
      };
      const material = {
        textureAddressMode,
        baseColorResourceId: resource(sourceMaterial.baseColor),
        normalResourceId: resource(surface === "stone" ? "normal" : "grassNormal"),
        ormResourceId: resource(sourceMaterial.metallicRoughness),
        baseColorFactor: [1, 1, 1],
        metallicFactor: sourceMaterial.metallicFactor,
        roughnessFactor: sourceMaterial.roughnessFactor,
        normalScale:
          surface === "stone" ? library.manifest.normalStrength : sourceMaterial.normalStrength,
      };
      const lods = [0, 1, 2].map((level) => ({
        vertexResourceId: resource(`lod${level}-${surface}-vertices`),
        indexResourceId: resource(`lod${level}-${surface}-indices`),
      }));
      placements.push({
        schemaVersion: 1,
        id: `${request.id}-${surface}`,
        position: [x, placementHeight, z],
        rotationYRadians: request.rotationYRadians,
        scale: [1, 1, 1],
        lodDistancesMeters: request.lodDistancesMeters,
        material,
        lods,
      });
      dependencies.add(material.normalResourceId);
      dependencies.add(material.ormResourceId);
      for (const lod of lods) dependencies.add(lod.indexResourceId);
    }
  }
  return {
    cell: placements.length === 0 ? cell : { ...cell, pbrAssets: placements },
    dependencies: [...dependencies].sort(),
  };
}

function surfaceHeight(cell, x, z) {
  const h = cell.collision.heightfield;
  const gx = (x - h.origin[0]) / h.sampleSpacingMeters;
  const gz = (z - h.origin[2]) / h.sampleSpacingMeters;
  const col = Math.min(h.columns - 2, Math.floor(gx));
  const row = Math.min(h.rows - 2, Math.floor(gz));
  const u = gx - col,
    v = gz - row;
  const sample = (dx, dz) => h.heights[(row + dz) * h.columns + col + dx];
  return u + v <= 1
    ? sample(0, 0) + u * (sample(1, 0) - sample(0, 0)) + v * (sample(0, 1) - sample(0, 0))
    : sample(1, 1) +
        (1 - u) * (sample(0, 1) - sample(1, 1)) +
        (1 - v) * (sample(1, 0) - sample(1, 1));
}
