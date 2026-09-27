import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
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
 * Every manifest in `assets/library` is an admitted asset: a periodic surface module (the D1
 * paving, D-196/D-197) or a kit-piece set (the K1 wall kit): parts with three LODs each,
 * sharing role-tagged PBR materials. Roles are namespaced by asset, and content-addressed
 * objects that several roles share (unsimplified LODs, identical fittings) ship once. */
export async function loadPbrAssetLibrary(root, writeResource) {
  const directory = resolve(root, "assets/library");
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  const assets = new Map();
  const resources = [];
  const emitted = new Map();
  for (const name of names) {
    const manifest = JSON.parse(await readFile(resolve(directory, name), "utf8"));
    assert.equal(manifest.schemaVersion, 1);
    assert(
      ["periodic-surface-module", "kit-piece-set"].includes(manifest.mode),
      `Unknown library mode in ${name}`,
    );
    assert(!assets.has(manifest.assetId), `Repeated library asset ${manifest.assetId}`);
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
    // Pre-encoded BC7 comes from the pinned Babylon transcoder (D-201). Older output is still
    // valid BC7, so a lagging pack only warns: repack with each decoder upgrade to pick up fixes.
    const bc7Lag = await pbrBc7TranscoderLag(manifest);
    if (bc7Lag !== null) console.warn(bc7Lag);
    const byRole = new Map();
    const lods = Object.values(manifest.parts).flatMap((part) =>
      part.lods.map((lod) => ({ ...lod, material: manifest.materials[part.material] })),
    );
    const ids = new Set();
    for (const entry of manifest.resources) {
      assert.match(entry.file, /^[a-f0-9]{64}\.(glb|ktx2|meshopt)$/);
      assert.equal(entry.path, `objects/${entry.file}`);
      if (entry.file.endsWith(".glb")) continue;
      const texture = manifest.textures[entry.role];
      const role = texture ? "texture" : entry.role.endsWith("-vertices") ? "vertices" : "indices";
      const resourceId = scaleStreamingDependencyResourceId(role, entry.sha256);
      assert(!byRole.has(entry.role), "Repeated asset role");
      byRole.set(entry.role, resourceId);
      ids.add(resourceId);
      const bytes = emitted.has(resourceId)
        ? undefined
        : await readFile(resolve(directory, entry.path));
      if (bytes !== undefined) {
        assert.equal(bytes.length, entry.bytes);
        assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
      }
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
      // A content-addressed resource carries one dependency chain: roles that share its bytes
      // must bind it the same way (library preparation re-encodes a stream that would not).
      if (emitted.has(resourceId)) {
        assert.deepEqual(emitted.get(resourceId), dependencies, `${entry.role} binds differently`);
        continue;
      }
      emitted.set(resourceId, dependencies);
      resources.push(
        await writeResource(bytes, `streaming-${role}`, texture ? ".ktx2" : ".meshopt", {
          decode,
          dependencies,
          format: texture ? "ktx2" : "meshopt",
          resourceId,
        }),
      );
    }
    const unique = new Set(
      manifest.resources.filter((r) => !r.file.endsWith(".glb")).map((r) => r.sha256),
    );
    assert.equal(ids.size, unique.size, `${manifest.assetId} resource identities`);
    assets.set(manifest.assetId, { manifest, byRole });
  }
  return { assets, resources };
}

/** Game requests place one part (`variantId`) of an asset per placement, or a whole assembly
 * (`assembly`: the kit's test house) as a rigid group of part placements. */
export function resolvePbrAssetsForCell(cell, requests, library) {
  const placements = [];
  const dependencies = new Set();
  const obstacles = [];
  for (const request of requests ?? []) {
    const [x, z] = request.center;
    if (
      x < cell.bounds.minimum[0] ||
      x >= cell.bounds.maximum[0] ||
      z < cell.bounds.minimum[2] ||
      z >= cell.bounds.maximum[2]
    )
      continue;
    const asset = library.assets.get(request.assetId);
    assert(asset, `Unknown library asset ${request.assetId}`);
    const { manifest, byRole } = asset;
    const resource = (role) => {
      const id = byRole.get(role);
      assert(id, `Missing asset role ${role}`);
      return id;
    };
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
    // follows the same detail field everywhere else in its footprint (D-204). An assembly
    // stands rigid on the walkable ground at its anchor.
    const detail = cell.collision.detail;
    const conforms = request.conformToTerrain === true;
    assert(
      !conforms || (detail !== undefined && terrainDetailContains(detail, anchorX, anchorZ)),
      `Conforming asset ${request.id} needs a terrain detail field at its anchor`,
    );
    const referenceHeight =
      conforms || request.assembly !== undefined
        ? sampleCellGroundHeight(cell.collision, anchorX, anchorZ)
        : surfaceHeight(cell, anchorX, anchorZ);
    const origin = [x, referenceHeight + request.heightOffset, z];
    let items;
    if (request.assembly !== undefined) {
      // An assembly's parts sit in the asset's own glTF frame (G: a rotation about +Y and a
      // translation). The assembly stands at T(origin) R(yaw) ReflectX, so a part's placement is
      // T(origin) R(yaw) ReflectX G = T(origin + R(yaw) (-tx, ty, tz)) R(yaw - alpha) ReflectX,
      // the engine's own placement form (checked below against writePbrAssetMatrix).
      assert.equal(request.variantId, undefined, "An assembly request names no variant");
      assert(!conforms, "Assemblies are rigid");
      const assembly = manifest.assemblies?.[request.assembly];
      assert(assembly, `Unknown assembly ${request.assembly}`);
      const yaw = request.rotationYRadians;
      const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
      items = assembly.parts.map(({ part, matrix }, index) => {
        const [tx, ty, tz] = [-matrix[12], matrix[13], matrix[14]];
        return {
          id: `${request.id}-${String(index).padStart(3, "0")}-${part}`,
          part,
          matrix,
          position: [origin[0] + c * tx + s * tz, origin[1] + ty, origin[2] - s * tx + c * tz],
          rotationYRadians: yaw - Math.atan2(matrix[8], matrix[0]),
          lodDistancesMeters: request.lodDistancesMeters,
          castsCsmShadows: manifest.parts[part]?.castsCsmShadows,
        };
      });
    } else
      items = [
        {
          id: request.id,
          part: request.variantId,
          position: origin,
          rotationYRadians: request.rotationYRadians,
          lodDistancesMeters: request.lodDistancesMeters,
          castsCsmShadows: request.castsCsmShadows,
        },
      ];
    // An assembly that asks for collision gets one box over its transformed LOD0 bounds
    // (buildings are axis-aligned in the kit, so a yaw in quarter turns keeps the box tight).
    const extent = [
      [Infinity, Infinity, Infinity],
      [-Infinity, -Infinity, -Infinity],
    ];
    for (const item of items) {
      const part = manifest.parts[item.part];
      assert(part, `Unknown ${manifest.assetId} part ${item.part}`);
      const source = manifest.materials[part.material];
      const placement = {
        schemaVersion: 1,
        id: item.id,
        position: item.position,
        rotationYRadians: item.rotationYRadians,
        scale: [1, 1, 1],
        lodDistancesMeters: item.lodDistancesMeters,
        material: {
          textureAddressMode: source.textureAddressMode,
          baseColorResourceId: resource(source.baseColor),
          normalResourceId: resource(source.normal),
          ormResourceId: resource(source.orm),
          baseColorFactor: source.baseColorFactor,
          metallicFactor: source.metallicFactor,
          roughnessFactor: source.roughnessFactor,
          normalScale: source.normalScale,
          ...(source.ormHeightRangeMetres === undefined
            ? {}
            : {
                ormHeight: { rangeMeters: source.ormHeightRangeMetres },
              }),
        },
        lods: part.lods.map((lod) => ({
          vertexResourceId: resource(lod.vertexRole),
          indexResourceId: resource(lod.indexRole),
        })),
        ...(conforms ? { terrainDrape: { referenceHeightMeters: referenceHeight } } : {}),
        ...(item.castsCsmShadows === false ? { castsCsmShadows: false } : {}),
      };
      const matrix = new Float64Array(16);
      writePbrAssetMatrix(matrix, 0, placement);
      assert([...matrix].every(Number.isFinite), "Invalid module transform");
      if (item.matrix !== undefined) {
        const standing = new Float64Array(16);
        writePbrAssetMatrix(standing, 0, {
          position: origin,
          rotationYRadians: request.rotationYRadians,
          scale: [1, 1, 1],
        });
        for (let row = 0; row < 3; row++)
          for (let column = 0; column < 4; column++) {
            let value = 0;
            for (let k = 0; k < 4; k++)
              value += (standing[k * 4 + row] ?? 0) * (item.matrix[column * 4 + k] ?? 0);
            assert(
              Math.abs(value - matrix[column * 4 + row]) < 1e-5,
              `Assembly part ${item.id} transform`,
            );
          }
      }
      for (const [lodIndex, lod] of part.lods.entries())
        for (let corner = 0; corner < 8; corner++) {
          const point = [0, 1, 2].map((axis) => lod.bounds[(corner >> axis) & 1][axis]);
          for (const axis of [0, 1, 2]) {
            const value =
              matrix[axis] * point[0] +
              matrix[4 + axis] * point[1] +
              matrix[8 + axis] * point[2] +
              matrix[12 + axis];
            if (lodIndex === 0) {
              extent[0][axis] = Math.min(extent[0][axis], value);
              extent[1][axis] = Math.max(extent[1][axis], value);
            }
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
    if (request.collision === true) {
      assert(request.assembly !== undefined, "Only assemblies carry collision");
      obstacles.push({
        center: [0, 1, 2].map((axis) => (extent[0][axis] + extent[1][axis]) / 2),
        id: `${cell.id}-${request.id}`,
        kind: "aabb",
        size: [0, 1, 2].map((axis) => extent[1][axis] - extent[0][axis]),
      });
    }
  }
  const resolved =
    obstacles.length === 0
      ? cell
      : {
          ...cell,
          collision: { ...cell.collision, obstacles: [...cell.collision.obstacles, ...obstacles] },
        };
  return {
    cell: placements.length === 0 ? resolved : { ...resolved, pbrAssets: placements },
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
