// Structural QA and candidate packaging for a kit-piece set (the D1 timber-framed wall kit, K1;
// the D1 terracotta roof kit, K2).
// node assets/qa/prepare-kit-piece-set.mjs <class config> <delivery dir> <candidate dir>
// The delivery dir (under ignored harness/results) holds the delivery's `pack/` (pack.json and
// runtime KTX2), `geometry/` (geometry.json and runtime meshopt), `maps.json` and `extract.json`.
// D-197: sizes and triangle counts are recorded measurements; only the structural checks here
// gate admission.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { MeshoptDecoder } from "../../engine/node_modules/meshoptimizer/meshopt_decoder.mjs";
import { MeshoptEncoder } from "../../engine/node_modules/meshoptimizer/meshopt_encoder.js";
import { KTX_ENCODER_PIN } from "../../engine/scripts/ktx-encoder-pin.mjs";
import { bc7TranscoderIdentity } from "../../engine/scripts/preencode-bc7.mjs";
import { canonicalMeshoptLayoutErrors } from "../../engine/src/assets/meshopt-layout.ts";
import { readAssetProvenance } from "./asset-provenance.mjs";

const root = resolve(import.meta.dirname, "../..");
const config = JSON.parse(await readFile(resolve(process.argv[2]), "utf8"));
const input = resolve(process.argv[3]);
const output = resolve(process.argv[4]);
const resultsRoot = resolve(root, "harness/results");
for (const directory of [input, output]) {
  const scoped = relative(resultsRoot, directory);
  assert(scoped !== "" && !scoped.startsWith("..") && !scoped.includes(":"), "Use harness/results");
}
assert.equal(config.schemaVersion, 1);
assert.equal(config.mode, "kit-piece-set");
await mkdir(output, { recursive: false });
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const provenancePath = config.provenancePath;
assert.match(provenancePath ?? "", /^assets\/source\/[a-z0-9-]+\/provenance\.json$/, "Provenance path");
const source = {
  sourceProvenancePath: provenancePath,
  sourceProvenanceSha256: hash(await readFile(resolve(root, provenancePath))),
};
const reviewed = await readAssetProvenance(root, source, config.assetId);
const packBytes = await readFile(join(input, "pack/pack.json"));
const geometryBytes = await readFile(join(input, "geometry/geometry.json"));
const mapsBytes = await readFile(join(input, "maps.json"));
const pack = JSON.parse(packBytes);
const geometry = JSON.parse(geometryBytes);
const maps = JSON.parse(mapsBytes);
source.deliveryReceipts = {
  packSha256: hash(packBytes),
  geometrySha256: hash(geometryBytes),
  mapsSha256: hash(mapsBytes),
  extractSha256: hash(await readFile(join(input, "extract.json"))),
};

// Objects are content-addressed: identical streams (an unsimplified part's LODs, identical
// fittings) are stored once and listed under each role.
const resources = [];
async function save(role, extension, bytes) {
  const sha256 = hash(bytes);
  const file = `${sha256}.${extension}`;
  const target = join(output, file);
  if (await stat(target).catch(() => null)) assert.equal(hash(await readFile(target)), sha256);
  else await writeFile(target, bytes, { flag: "wx" });
  resources.push({ role, file, sha256, bytes: bytes.length });
}
async function runtimeBytes(directory, stream) {
  const bytes = await readFile(join(input, directory, stream.path));
  assert.equal(bytes.length, stream.bytes);
  assert.equal(hash(bytes), stream.sha256, `Delivery stream drifted: ${stream.path}`);
  return bytes;
}

// ---------------------------------------------------------------- textures
const textures = {};
const measurements = { textures: {}, parts: {}, assemblies: {} };
for (const texture of pack.textures) {
  const bytes = await runtimeBytes("pack", texture.ktx2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (offset) => view.getUint32(offset, true);
  assert.equal(
    bytes.subarray(0, 12).toString("hex"),
    "ab4b5458203230bb0d0a1a0a",
    "KTX2 identifier",
  );
  const vkFormat = u32(12);
  const width = u32(20);
  const height = u32(24);
  const levels = u32(40);
  const scheme = u32(44);
  const srgb = texture.srgb === true;
  assert.equal(srgb, texture.slot === "basecolor", `${texture.role} colour space`);
  assert.equal(width, texture.width);
  assert.equal(height, texture.height);
  assert.equal(levels, Math.floor(Math.log2(Math.max(width, height))) + 1, "Full mip chain");
  assert.equal(scheme, 0, "GPU-ready maps are not supercompressed (D-203)");
  let encoding;
  if (vkFormat === 131 || vkFormat === 132) {
    assert.equal(vkFormat, srgb ? 132 : 131, "BC1 colour space");
    encoding = "bc1";
  } else if (vkFormat === 145 || vkFormat === 146) {
    assert.equal(vkFormat, srgb ? 146 : 145, "BC7 colour space");
    encoding = "bc7";
  } else {
    assert.equal(vkFormat, srgb ? 43 : 37, "RGBA8 colour space");
    encoding = "rgba8";
  }
  await save(texture.role, "ktx2", bytes);
  textures[texture.role] = {
    width,
    height,
    mipLevels: levels,
    colorSpace: srgb ? "srgb" : "linear",
    encoding,
  };
  measurements.textures[texture.role] = { encodedBytes: bytes.length, gpuBytes: texture.gpuBytes };
}

// ---------------------------------------------------------------- materials
const materials = {};
for (const [name, record] of Object.entries(maps.materials)) {
  const roles = ["basecolor", "normal", "orm"].map((slot) => `${name}-${slot}`);
  for (const role of roles) assert(textures[role], `Missing material texture ${role}`);
  const range = record.ormHeightRangeMetres;
  const metallicFactor = record.metallicFactor ?? 0;
  if (range !== undefined)
    assert(
      Array.isArray(range) &&
        range.length === 2 &&
        range.every(Number.isFinite) &&
        range[1] > range[0] &&
        range[1] - range[0] <= config.ormHeightSpanMaxMetres &&
        metallicFactor === 0,
      `Invalid ORM height for ${name}: a height-carrying ORM needs metallic 0`,
    );
  assert(["clamp-to-edge", "repeat"].includes(record.textureAddressMode), `${name} address mode`);
  // A shared tiling detail tile (K2 delivery): a linear texture role of this kit, full mips.
  const detail = record.detail;
  if (detail !== undefined) {
    const tile = textures[detail.texture];
    assert(tile && tile.colorSpace === "linear", `${name} detail tile ${detail.texture}`);
    assert(
      detail.uvScale.length === 2 &&
        detail.uvScale.every((v) => Number.isFinite(v) && v > 0) &&
        [detail.normalGain, detail.albedoGain].every((v) => Number.isFinite(v) && v >= 0 && v <= 4),
      `${name} detail layer`,
    );
  }
  materials[name] = {
    baseColor: roles[0],
    normal: roles[1],
    orm: roles[2],
    textureAddressMode: record.textureAddressMode,
    ...config.materialFactors,
    metallicFactor,
    ...(range === undefined ? {} : { ormHeightRangeMetres: range }),
    ...(detail === undefined
      ? {}
      : {
          detail: {
            texture: detail.texture,
            uvScale: detail.uvScale,
            normalGain: detail.normalGain,
            albedoGain: detail.albedoGain,
          },
        }),
  };
}
// Tinted meshes (roof tiles) carry a per-element tint in their UVs' integer parts (engine
// pbr-tint): their material takes the geometry stage's tint model and must repeat.
for (const mesh of geometry.meshes)
  if (mesh.tintWorstRelativeError !== undefined) {
    const material = materials[mesh.material];
    assert(geometry.uvTint && material, `${mesh.object} tint`);
    assert.equal(material.textureAddressMode, "repeat", `${mesh.material} tint needs repeat`);
    material.tint = geometry.uvTint;
  }

const constant = (material) =>
  [material.baseColor, material.normal, material.orm].every(
    (role) => textures[role].width <= 8 && textures[role].height <= 8,
  );

// A content-addressed stream carries one dependency chain in the streaming contract: a vertex
// stream binds to its material's base colour, an index stream to that and to its vertex stream.
// Byte-identical streams that would bind differently (a small index list shared by two meshes)
// get a distinct but equivalent encoding: the index list with its first triangle moved last.
// Keys are content hashes (the runtime's resource identities), and the other admitted library
// assets' streams are bound first: a stream byte-identical to another kit's (a small box's index
// list) must bind the same way there too, or it gets its own encoding here.
const bindings = new Map();
const libraryDirectory = resolve(root, "assets/library");
for (const name of (await readdir(libraryDirectory)).filter((n) => n.endsWith(".json")).sort()) {
  const other = JSON.parse(await readFile(join(libraryDirectory, name), "utf8"));
  if (other.assetId === config.assetId || other.parts === undefined) continue;
  const shaOf = (role) => other.resources.find((r) => r.role === role)?.sha256;
  for (const part of Object.values(other.parts)) {
    const base = shaOf(other.materials[part.material].baseColor);
    for (const lod of part.lods) {
      const vertices = shaOf(lod.vertexRole);
      if (!bindings.has(vertices)) bindings.set(vertices, base);
      const indices = shaOf(lod.indexRole);
      if (!bindings.has(indices)) bindings.set(indices, `${base}|${vertices}`);
    }
  }
}
const textureSha = (role) => resources.find((r) => r.role === role).sha256;
function bindStream(bytes, key) {
  const sha = hash(bytes);
  const bound = bindings.get(sha);
  if (bound === undefined || bound === key) {
    bindings.set(sha, key);
    return bytes;
  }
  return undefined;
}
function reencodeIndices(indexBytes, triangles, key, label) {
  const indices = new Uint32Array(indexBytes.buffer.slice(0));
  for (let attempt = 1; attempt < triangles; attempt++) {
    const moved = new Uint32Array(indices.length);
    moved.set(indices.subarray(attempt * 3));
    moved.set(indices.subarray(0, attempt * 3), indices.length - attempt * 3);
    const encoded = Buffer.from(
      MeshoptEncoder.encodeGltfBuffer(moved, moved.length, 4, "TRIANGLES"),
    );
    const check = new Uint8Array(moved.length * 4);
    MeshoptDecoder.decodeGltfBuffer(check, moved.length, 4, encoded, "TRIANGLES");
    // The same triangles in the same order (the codec may rotate a triangle's corners).
    const decoded = new Uint32Array(check.buffer);
    for (let t = 0; t < moved.length; t += 3) {
      const [a, b, c] = [moved[t], moved[t + 1], moved[t + 2]];
      assert(
        [
          [a, b, c],
          [b, c, a],
          [c, a, b],
        ].some((r) => r[0] === decoded[t] && r[1] === decoded[t + 1] && r[2] === decoded[t + 2]),
        `${label} re-encoding`,
      );
    }
    if (bindStream(encoded, key) !== undefined) return encoded;
  }
  assert.fail(`${label} has no distinct encoding for its binding`);
}

// ---------------------------------------------------------------- parts
const partId = (object) => object.toLowerCase().replace(/~m$/, ".m");
const pieceId = (piece) => (piece === null ? null : piece.replace(/~m$/, ".m"));
const ID = /^[a-z0-9](?:[a-z0-9._-]{0,90}[a-z0-9])?$/;
const parts = {};
const pieces = {};
const decodedParts = new Map();
const glbMeshes = [[], [], []];
for (const mesh of geometry.meshes) {
  const id = partId(mesh.object);
  assert.match(id, ID, `Part id ${id}`);
  assert(!parts[id], `Repeated part ${id}`);
  const material = materials[mesh.material];
  assert(material, `Part ${id} has unknown material ${mesh.material}`);
  assert.equal(mesh.lods.length, 3, `${id} has three LODs`);
  const lods = [];
  const decodedLods = [];
  for (const [lod, entry] of mesh.lods.entries()) {
    assert.equal(entry.lod, lod);
    const vertexStream = await runtimeBytes("geometry", entry.vertexStream);
    const indexStream = await runtimeBytes("geometry", entry.indexStream);
    const vertexBytes = new Uint8Array(entry.vertices * 32);
    MeshoptDecoder.decodeGltfBuffer(vertexBytes, entry.vertices, 32, vertexStream, "ATTRIBUTES");
    const indexBytes = new Uint8Array(entry.triangles * 12);
    MeshoptDecoder.decodeGltfBuffer(indexBytes, entry.triangles * 3, 4, indexStream, "TRIANGLES");
    const v = new Float32Array(vertexBytes.buffer);
    const indices = new Uint32Array(indexBytes.buffer);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const size = textures[material.baseColor];
    const uvTolerance = config.atlasUvToleranceTexels / Math.min(size.width, size.height);
    for (let i = 0; i < entry.vertices; i++) {
      const o = i * 8;
      for (let k = 0; k < 8; k++) assert(Number.isFinite(v[o + k]), `${id} finite attributes`);
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], v[o + a]);
        max[a] = Math.max(max[a], v[o + a]);
      }
      const length = Math.hypot(v[o + 3], v[o + 4], v[o + 5]);
      assert(Math.abs(length - 1) <= config.normalUnitTolerance, `${id} unit normals`);
      // A constant material (every map 8 x 8 or smaller, like the interior's) has no atlas to miss.
      if (material.textureAddressMode === "clamp-to-edge" && !constant(material))
        assert(
          v[o + 6] >= -uvTolerance &&
            v[o + 6] <= 1 + uvTolerance &&
            v[o + 7] >= -uvTolerance &&
            v[o + 7] <= 1 + uvTolerance,
          `${id} atlas UVs inside the map`,
        );
    }
    for (const index of indices) assert(index < entry.vertices, `${id} index range`);
    for (let a = 0; a < 3; a++) {
      assert(Math.abs(min[a] - entry.bounds[0][a]) < 1e-5, `${id} LOD${lod} bounds`);
      assert(Math.abs(max[a] - entry.bounds[1][a]) < 1e-5, `${id} LOD${lod} bounds`);
      assert(max[a] - min[a] <= config.partExtentMaxMetres, `${id} extent`);
    }
    if (lod > 0) assert(entry.triangles <= lods[lod - 1].triangles, `${id} LOD reduction`);
    assert(
      bindStream(vertexStream, textureSha(material.baseColor)) !== undefined,
      `${id} LOD${lod} vertices are identical to another material's; re-export them`,
    );
    const indexKey = `${textureSha(material.baseColor)}|${hash(vertexStream)}`;
    const boundIndices =
      bindStream(indexStream, indexKey) ??
      reencodeIndices(indexBytes, entry.triangles, indexKey, `${id} LOD${lod}`);
    await save(`${id}-lod${lod}-vertices`, "meshopt", vertexStream);
    await save(`${id}-lod${lod}-indices`, "meshopt", boundIndices);
    lods.push({
      vertexRole: `${id}-lod${lod}-vertices`,
      indexRole: `${id}-lod${lod}-indices`,
      vertices: entry.vertices,
      triangles: entry.triangles,
      bounds: [min, max],
    });
    decodedLods.push({ v, indices });
    glbMeshes[lod].push({
      id,
      material: mesh.material,
      vertexBytes,
      indexBytes,
      vertexStream,
      indexStream,
      entry,
      min,
      max,
    });
  }
  const piece = pieceId(mesh.piece);
  parts[id] = {
    material: mesh.material,
    piece,
    ...(mesh.mirrorOf === undefined ? {} : { mirrorOf: partId(mesh.mirrorOf) }),
    ...(config.csmExcludedMaterials.includes(mesh.material) ? { castsCsmShadows: false } : {}),
    lodDistancesMetres: config.lodDistancesMetres,
    lods,
  };
  if (piece !== null) {
    pieces[piece] ??= [];
    pieces[piece].push(id);
  }
  decodedParts.set(id, decodedLods);
  measurements.parts[id] = lods.map((l) => ({ vertices: l.vertices, triangles: l.triangles }));
}
// A mirrored variant is its source with X negated and the winding flipped (det > 0 placements).
for (const [id, part] of Object.entries(parts)) {
  if (part.mirrorOf === undefined) continue;
  const original = decodedParts.get(part.mirrorOf);
  assert(original, `${id} mirrors a missing part`);
  for (const [lod, mirrored] of decodedParts.get(id).entries()) {
    const base = original[lod];
    assert.equal(mirrored.v.length, base.v.length, `${id} mirror vertex count`);
    assert.equal(mirrored.indices.length, base.indices.length, `${id} mirror index count`);
    for (let i = 0; i < base.v.length; i += 8) {
      assert.equal(mirrored.v[i], -base.v[i], `${id} mirrored X`);
      assert.equal(mirrored.v[i + 3], -base.v[i + 3], `${id} mirrored normal X`);
      for (const k of [1, 2, 4, 5, 6, 7]) assert.equal(mirrored.v[i + k], base.v[i + k]);
    }
    // The same triangles, each reversed (the index codec may rotate a triangle's corners).
    for (let t = 0; t < base.indices.length; t += 3) {
      const [a, b, c] = [base.indices[t], base.indices[t + 2], base.indices[t + 1]];
      const m = [mirrored.indices[t], mirrored.indices[t + 1], mirrored.indices[t + 2]];
      assert(
        [
          [a, b, c],
          [b, c, a],
          [c, a, b],
        ].some((r) => r[0] === m[0] && r[1] === m[1] && r[2] === m[2]),
        `${id} mirrored winding`,
      );
    }
  }
}

// ---------------------------------------------------------------- the test house assembly
// Placements are column-major glTF-frame matrices: a rotation about +Y (up) and a translation,
// determinant +1 (mirrored placements use the `.m` part variants).
const assemblyParts = [];
const checkMatrix = (matrix, label) => {
  assert(matrix.length === 16 && matrix.every(Number.isFinite), `${label} matrix`);
  const [c, s] = [matrix[0], matrix[8]];
  const expected = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0];
  for (let i = 0; i < 12; i++)
    assert(Math.abs(matrix[i] - expected[i]) < 1e-5, `${label} is a rotation about Y`);
  assert(Math.abs(Math.hypot(c, s) - 1) < 1e-6, `${label} rotation is orthonormal`);
  assert.equal(matrix[15], 1);
};
for (const placement of geometry.placements) {
  const piece = pieceId(placement.piece);
  assert(pieces[piece], `Placement ${placement.name} names an unknown piece`);
  assert.equal(placement.mirrored, placement.piece.endsWith("~m"), `${placement.name} mirror`);
  checkMatrix(placement.matrix, placement.name);
  for (const part of pieces[piece]) assemblyParts.push({ part, matrix: placement.matrix });
}
checkMatrix(geometry.housePlacement.matrix, "house placement");
for (const [id, part] of Object.entries(parts))
  if (part.piece === null) assemblyParts.push({ part: id, matrix: geometry.housePlacement.matrix });
const houseMin = [Infinity, Infinity, Infinity];
const houseMax = [-Infinity, -Infinity, -Infinity];
const houseTriangles = [0, 0, 0];
for (const { part, matrix } of assemblyParts)
  for (const [lod, l] of parts[part].lods.entries()) {
    houseTriangles[lod] += l.triangles;
    for (let corner = 0; corner < 8; corner++) {
      const p = [0, 1, 2].map((axis) => l.bounds[(corner >> axis) & 1][axis]);
      for (let a = 0; a < 3; a++) {
        const w = matrix[a] * p[0] + matrix[4 + a] * p[1] + matrix[8 + a] * p[2] + matrix[12 + a];
        houseMin[a] = Math.min(houseMin[a], w);
        houseMax[a] = Math.max(houseMax[a], w);
      }
    }
  }
for (let a = 0; a < 3; a++)
  assert(
    houseMin[a] >= config.assemblyBoundsMetres[0][a] &&
      houseMax[a] <= config.assemblyBoundsMetres[1][a],
    "Test house bounds",
  );
const assemblies = { "test-house": { parts: assemblyParts } };
measurements.assemblies["test-house"] = {
  placements: assemblyParts.length,
  triangles: houseTriangles,
  bounds: [houseMin, houseMax],
};

// ---------------------------------------------------------------- canonical meshopt GLBs
// Every part of each LOD is written as one EXT_meshopt_compression GLB and passed through the
// Khronos validator. The GLBs are export evidence only (packaging never reads them), so the
// kit records their validation and does not store them.
const require = createRequire(new URL("../package.json", import.meta.url));
const { validateBytes, version: validatorVersion } = require("gltf-validator");
const validation = [];
const materialNames = Object.keys(materials);
for (let lod = 0; lod < 3; lod++) {
  const gltf = {
    asset: { version: "2.0", generator: "Parallax kit-piece-set QA v1" },
    extensionsUsed: ["EXT_meshopt_compression"],
    extensionsRequired: ["EXT_meshopt_compression"],
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    buffers: [{ byteLength: 0 }],
    bufferViews: [],
    accessors: [],
    materials: materialNames.map((name) => ({
      name,
      pbrMetallicRoughness: { metallicFactor: materials[name].metallicFactor, roughnessFactor: 1 },
    })),
  };
  const chunks = [];
  let cursor = 0;
  const append = (bytes) => {
    const offset = cursor;
    const padding = (4 - (bytes.length % 4)) % 4;
    chunks.push(bytes, Buffer.alloc(padding));
    cursor += bytes.length + padding;
    return offset;
  };
  for (const mesh of glbMeshes[lod]) {
    const views = [];
    for (const [compressed, fallback, count, stride, mode] of [
      [mesh.vertexStream, mesh.vertexBytes, mesh.entry.vertices, 32, "ATTRIBUTES"],
      [mesh.indexStream, mesh.indexBytes, mesh.entry.triangles * 3, 4, "TRIANGLES"],
    ]) {
      const encodedOffset = append(compressed);
      const fallbackOffset = append(Buffer.from(fallback));
      views.push(gltf.bufferViews.length);
      gltf.bufferViews.push({
        buffer: 0,
        byteOffset: fallbackOffset,
        byteLength: fallback.length,
        ...(mode === "ATTRIBUTES" ? { byteStride: stride } : {}),
        extensions: {
          EXT_meshopt_compression: {
            buffer: 0,
            byteOffset: encodedOffset,
            byteLength: compressed.length,
            byteStride: stride,
            count,
            mode,
            filter: "NONE",
          },
        },
      });
    }
    const base = gltf.accessors.length;
    for (const [offset, type] of [
      [0, "VEC3"],
      [12, "VEC3"],
      [24, "VEC2"],
    ])
      gltf.accessors.push({
        bufferView: views[0],
        byteOffset: offset,
        componentType: 5126,
        count: mesh.entry.vertices,
        type,
        ...(offset === 0 ? { min: mesh.min, max: mesh.max } : {}),
      });
    gltf.accessors.push({
      bufferView: views[1],
      componentType: 5125,
      count: mesh.entry.triangles * 3,
      type: "SCALAR",
    });
    gltf.nodes.push({ name: `${mesh.id}-lod${lod}`, mesh: gltf.meshes.length });
    gltf.scenes[0].nodes.push(gltf.nodes.length - 1);
    gltf.meshes.push({
      name: `${mesh.id}-lod${lod}`,
      primitives: [
        {
          attributes: { POSITION: base, NORMAL: base + 1, TEXCOORD_0: base + 2 },
          indices: base + 3,
          material: materialNames.indexOf(mesh.material),
          mode: 4,
        },
      ],
    });
  }
  gltf.buffers[0].byteLength = cursor;
  assert.deepEqual(canonicalMeshoptLayoutErrors(gltf), []);
  const json = Buffer.from(JSON.stringify(gltf));
  const paddedJson = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 32)]);
  const bin = Buffer.concat(chunks);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + paddedJson.length + bin.length, 8);
  header.writeUInt32LE(paddedJson.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length);
  binHeader.writeUInt32LE(0x004e4942, 4);
  const glb = Buffer.concat([header, paddedJson, binHeader, bin]);
  const report = await validateBytes(glb, { uri: `lod${lod}.glb`, maxIssues: 100 });
  assert.equal(report.issues.numErrors, 0, `lod${lod}.glb Khronos validation`);
  validation.push({
    lod,
    bytes: glb.length,
    sha256: hash(glb),
    errors: report.issues.numErrors,
    warnings: report.issues.numWarnings,
  });
}

const unique = new Map(resources.map((r) => [r.sha256, r.bytes]));
measurements.runtimeEncodedBytes = [...unique.values()].reduce((sum, bytes) => sum + bytes, 0);
measurements.gpuTextureBytes = Object.values(measurements.textures).reduce(
  (sum, t) => sum + t.gpuBytes,
  0,
);
const bc7 = await bc7TranscoderIdentity();
assert.deepEqual(pack.encoders?.bc7Transcoder, bc7, "BC7 not from the pinned transcoder; repack");
const candidate = {
  schemaVersion: 1,
  mode: "kit-piece-set",
  assetId: config.assetId,
  class: config.class,
  status: "structural-QA-passed-worker-roundtrip-pending",
  upAxis: "Y",
  materials,
  textures,
  parts,
  pieces,
  assemblies,
  source,
  provenance: reviewed.provenance,
  encoders: { ktx: KTX_ENCODER_PIN, meshopt: "1.2.0", bc7Transcoder: bc7 },
  qa: {
    finiteAttributesUnitNormalsAndIndexRange: true,
    atlasUvsInsideClampedMaps: true,
    boundsMatchDelivery: true,
    lodReduction: true,
    mirroredVariantsExact: true,
    assemblyRotationsAboutYOnly: true,
    ktx2HeadersFullMipChainsGpuReady: true,
    ormHeightNeedsMetallicZero: true,
    detailTilesLinear: true,
    uvTintNeedsRepeat: true,
    canonicalMeshoptLayout: true,
    khronosValidator: { version: validatorVersion(), glbs: validation, retained: false },
    rightsReviewed: reviewed.rightsReviewed,
  },
  measurements,
  resources,
};
await writeFile(join(output, "candidate.json"), `${JSON.stringify(candidate, null, 2)}\n`);
console.log(
  JSON.stringify({
    parts: Object.keys(parts).length,
    resources: resources.length,
    uniqueObjects: unique.size,
    runtimeBytes: measurements.runtimeEncodedBytes,
    house: measurements.assemblies["test-house"],
  }),
);
