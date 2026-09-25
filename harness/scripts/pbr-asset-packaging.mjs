import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { bc7TranscoderIdentity } from "../../engine/scripts/preencode-bc7.mjs";
import { scaleStreamingDependencyResourceId } from "../../engine/src/streaming/scale-streaming-resource-id.ts";
import { writePbrAssetMatrix } from "../../engine/src/world/pbr-asset-transform.ts";
import {
  sampleCellGroundHeight,
  terrainDetailContains,
} from "../../engine/src/world/terrain-surface.ts";

/** A reminder, or null, when admitted pre-encoded BC7 maps were made by a different
 * `@babylonjs/ktx2decoder` than the one the engine pins. */
export async function pbrBc7TranscoderLag(manifest) {
  if (!Object.values(manifest.textures).some((texture) => texture.encoding === "bc7")) return null;
  const current = await bc7TranscoderIdentity();
  const recorded = manifest.encoders?.bc7Transcoder;
  return recorded?.version === current.version && recorded?.wasmSha256 === current.wasmSha256
    ? null
    : `Pre-encoded BC7 maps in ${manifest.assetId ?? "the PBR library"} were transcoded by ` +
        `@babylonjs/ktx2decoder ${recorded?.version ?? "(unrecorded)"}; the engine pins ` +
        `${current.version}. Repack and readmit them to pick up transcoder fixes.`;
}

/** UASTC transcodes to BC7 on the GPU; pre-encoded BC7 and BC1 (D-201) and raw RGBA8
 * (lossless) maps upload as stored. */
export function pbrTextureGpuFormat(texture) {
  return texture.encoding === "uastc" || texture.encoding === "bc7"
    ? "bc7"
    : texture.encoding === "bc1"
      ? "bc1"
      : "rgba8";
}

/** Only admitted library objects cross this build boundary; source art is never packaged.
 * The admitted D1 paving is a periodic surface module (D-196/D-197): parts with three LODs
 * each, sharing role-tagged PBR materials. */
export async function loadPbrAssetLibrary(root, writeResource) {
  const manifest = JSON.parse(
    await readFile(resolve(root, "assets/library/d1-paving.json"), "utf8"),
  );
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.mode, "periodic-surface-module");
  // Installed-game visual acceptance is a human record bound to the admitted candidate;
  // admission alone (structure and rights) still packages as pending.
  if (manifest.status === "QA-admitted-runtime-visual-accepted") {
    const acceptance = manifest.runtimeVisualAcceptance;
    assert.equal(acceptance?.candidateSha256, manifest.candidateSha256, "Acceptance candidate");
    assert.match(acceptance.acceptedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(acceptance.acceptedBy, "human");
    assert(typeof acceptance.evidence === "string" && acceptance.evidence !== "");
  } else {
    assert.equal(manifest.status, "QA-admitted-runtime-visual-acceptance-pending");
    assert.equal(manifest.runtimeVisualAcceptance, undefined);
  }
  // Pre-encoded BC7 comes from the pinned Babylon transcoder (D-201). Older output is still valid
  // BC7, so a lagging pack only warns: repack with each decoder upgrade to pick up its fixes.
  const bc7Lag = await pbrBc7TranscoderLag(manifest);
  if (bc7Lag !== null) console.warn(bc7Lag);
  const resources = [];
  const byRole = new Map();
  const lods = Object.values(manifest.parts).flatMap((part) =>
    part.lods.map((lod) => ({ ...lod, material: manifest.materials[part.material] })),
  );
  for (const entry of manifest.resources) {
    assert.match(entry.file, /^[a-f0-9]{64}\.(glb|ktx2|meshopt)$/);
    assert.equal(entry.path, `objects/${entry.file}`);
    const bytes = await readFile(resolve(root, "assets/library", entry.path));
    assert.equal(bytes.length, entry.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
    if (entry.file.endsWith(".glb")) continue;
    const texture = manifest.textures[entry.role];
    const role = texture ? "texture" : entry.role.endsWith("-vertices") ? "vertices" : "indices";
    const resourceId = scaleStreamingDependencyResourceId(role, entry.sha256);
    assert(!byRole.has(entry.role), "Repeated asset role");
    byRole.set(entry.role, resourceId);
    let decode;
    let dependencies;
    if (texture) {
      assert.equal(entry.file.endsWith(".ktx2"), true);
      assert(
        ["uastc", "bc7", "bc1", "rgba8", "rgba8-zstd"].includes(texture.encoding),
        `Unknown encoding ${texture.encoding}`,
      );
      decode = {
        colorSpace: texture.colorSpace,
        format: pbrTextureGpuFormat(texture),
        width: texture.width,
        height: texture.height,
        version: 2,
        mipLevelCount: texture.mipLevels,
      };
      dependencies = [];
    } else {
      const lod = lods.find((l) => l.vertexRole === entry.role || l.indexRole === entry.role);
      assert(lod, `Unknown geometry role ${entry.role}`);
      const base = byRole.get(lod.material.baseColor);
      assert(base, "Texture must precede geometry");
      if (role === "vertices") {
        decode = {
          count: lod.vertices,
          layout: "position-normal-uv-f32",
          mode: "ATTRIBUTES",
          stride: 32,
          version: 1,
        };
        dependencies = [base];
      } else {
        const vertices = byRole.get(lod.vertexRole);
        assert(vertices, "Vertex stream must precede indices");
        decode = {
          count: lod.triangles * 3,
          indexFormat: "uint32",
          mode: "TRIANGLES",
          stride: 4,
          version: 1,
          vertexCount: lod.vertices,
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
  assert.equal(resources.length, Object.keys(manifest.textures).length + lods.length * 2);
  return { manifest, resources, byRole };
}

/** Game requests place one part (`variantId`) of the module per placement. */
export function resolvePbrAssetsForCell(cell, requests, library) {
  const placements = [];
  const dependencies = new Set();
  const { manifest, byRole } = library;
  const resource = (role) => {
    const id = byRole.get(role);
    assert(id, `Missing asset role ${role}`);
    return id;
  };
  for (const request of requests ?? []) {
    const [x, z] = request.center;
    if (
      x < cell.bounds.minimum[0] ||
      x >= cell.bounds.maximum[0] ||
      z < cell.bounds.minimum[2] ||
      z >= cell.bounds.maximum[2]
    )
      continue;
    assert.equal(request.assetId, manifest.assetId);
    const part = manifest.parts[request.variantId];
    assert(part, `Unknown module part ${request.variantId}`);
    const source = manifest.materials[part.material];
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
    // A conforming module rests on the walkable ground at its anchor; the GPU drape then
    // follows the same detail field everywhere else in its footprint (D-204).
    const detail = cell.collision.detail;
    const conforms = request.conformToTerrain === true;
    assert(
      !conforms || (detail !== undefined && terrainDetailContains(detail, anchorX, anchorZ)),
      `Conforming asset ${request.id} needs a terrain detail field at its anchor`,
    );
    const referenceHeight = conforms
      ? sampleCellGroundHeight(cell.collision, anchorX, anchorZ)
      : surfaceHeight(cell, anchorX, anchorZ);
    const placement = {
      schemaVersion: 1,
      id: request.id,
      position: [x, referenceHeight + request.heightOffset, z],
      rotationYRadians: request.rotationYRadians,
      scale: [1, 1, 1],
      lodDistancesMeters: request.lodDistancesMeters,
      material: {
        textureAddressMode: source.textureAddressMode,
        baseColorResourceId: resource(source.baseColor),
        normalResourceId: resource(source.normal),
        ormResourceId: resource(source.orm),
        baseColorFactor: source.baseColorFactor,
        metallicFactor: source.metallicFactor,
        roughnessFactor: source.roughnessFactor,
        normalScale: source.normalScale,
      },
      lods: part.lods.map((lod) => ({
        vertexResourceId: resource(lod.vertexRole),
        indexResourceId: resource(lod.indexRole),
      })),
      ...(conforms ? { terrainDrape: { referenceHeightMeters: referenceHeight } } : {}),
    };
    const matrix = new Float64Array(16);
    writePbrAssetMatrix(matrix, 0, placement);
    assert([...matrix].every(Number.isFinite), "Invalid module transform");
    for (const lod of part.lods)
      for (let corner = 0; corner < 8; corner++) {
        const point = [0, 1, 2].map((axis) => lod.bounds[(corner >> axis) & 1][axis]);
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
        if (conforms) {
          const [worldX, worldZ] = [0, 2].map(
            (axis) =>
              matrix[axis] * point[0] +
              matrix[4 + axis] * point[1] +
              matrix[8 + axis] * point[2] +
              matrix[12 + axis],
          );
          assert(
            terrainDetailContains(detail, worldX, worldZ),
            `Conforming asset ${request.id} extends outside its cell's terrain detail field`,
          );
        }
      }
    placements.push(placement);
    dependencies.add(placement.material.normalResourceId);
    dependencies.add(placement.material.ormResourceId);
    for (const lod of placement.lods) dependencies.add(lod.indexResourceId);
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
