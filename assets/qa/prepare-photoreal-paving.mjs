// Structural QA and candidate packaging for the periodic 4 m photoreal paving module.
// node assets/qa/prepare-photoreal-paving.mjs <delivery pack dir> <candidate dir>
// Both directories live under ignored harness/results. D-197: sizes and triangle counts are
// recorded measurements; only the structural checks here gate admission.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { MeshoptDecoder } from "../../engine/node_modules/meshoptimizer/meshopt_decoder.mjs";
import { MeshoptEncoder } from "../../engine/node_modules/meshoptimizer/meshopt_encoder.js";
import { KTX_ENCODER_PIN } from "../../engine/scripts/ktx-encoder-pin.mjs";
import { bc7TranscoderIdentity } from "../../engine/scripts/preencode-bc7.mjs";
import { canonicalMeshoptLayoutErrors } from "../../engine/src/assets/meshopt-layout.ts";
import { readPavingProvenance } from "./paving-provenance.mjs";

const root = resolve(import.meta.dirname, "../..");
const input = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const resultsRoot = resolve(root, "harness/results");
for (const directory of [input, output]) {
  const scoped = relative(resultsRoot, directory);
  assert(scoped !== "" && !scoped.startsWith("..") && !scoped.includes(":"), "Use harness/results");
}
await mkdir(output, { recursive: false });
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const config = JSON.parse(await readFile(new URL("./d1-photoreal-paving.json", import.meta.url)));
const provenancePath = "assets/source/d1-paving/proof-2026-09-24/provenance.json";
const source = {
  sourceProvenancePath: provenancePath,
  sourceProvenanceSha256: hash(await readFile(resolve(root, provenancePath))),
};
const reviewed = await readPavingProvenance(root, source);
assert.equal(reviewed.assetId, config.assetId);
const packBytes = await readFile(join(input, "pack.json"));
const pack = JSON.parse(packBytes);
source.deliveryReceiptSha256 = hash(packBytes);

const resources = [];
async function save(role, extension, bytes) {
  const sha256 = hash(bytes);
  const file = `${sha256}.${extension}`;
  await writeFile(join(output, file), bytes, { flag: "wx" });
  resources.push({ role, file, sha256, bytes: bytes.length });
  return sha256;
}
async function runtimeBytes(stream) {
  const bytes = await readFile(join(input, stream.file));
  assert.equal(bytes.length, stream.bytes);
  assert.equal(hash(bytes), stream.sha256, `Delivery stream drifted: ${stream.file}`);
  return bytes;
}

// ---------------------------------------------------------------- textures
const textures = {};
const measurements = { textures: {}, parts: {} };
for (const texture of pack.textures) {
  const bytes = await runtimeBytes(texture.ktx2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (offset) => view.getUint32(offset, true);
  assert.equal(bytes.subarray(0, 12).toString("hex"), "ab4b5458203230bb0d0a1a0a");
  const vkFormat = u32(12);
  const width = u32(20);
  const height = u32(24);
  const levels = u32(40);
  const scheme = u32(44);
  const srgb = texture.role.endsWith("basecolor");
  assert.equal(width, texture.width);
  assert.equal(height, texture.height);
  assert.equal(levels, Math.floor(Math.log2(Math.max(width, height))) + 1, "Full mip chain");
  let encoding;
  if (vkFormat === 0) {
    // Basis UASTC: DFD colour model 166; transfer function 2 = sRGB, 1 = linear.
    const dfd = u32(48);
    assert.equal(bytes[dfd + 12], 166, "UASTC colour model");
    assert.equal(bytes[dfd + 14], srgb ? 2 : 1, "UASTC transfer function");
    assert.equal(scheme, 0, "Production UASTC is not supercompressed");
    encoding = "uastc";
  } else if (vkFormat === 131 || vkFormat === 132) {
    // Pre-encoded opaque BC1 (VK_FORMAT_BC1_RGB_{UNORM,SRGB}_BLOCK), uploaded as stored.
    assert.equal(vkFormat, srgb ? 132 : 131, "BC1 colour space");
    assert.equal(scheme, 0, "Production BC1 is not supercompressed");
    encoding = "bc1";
  } else if (vkFormat === 145 || vkFormat === 146) {
    // Pre-encoded BC7 (VK_FORMAT_BC7_{UNORM,SRGB}_BLOCK), transcoded from UASTC at pack time.
    assert.equal(vkFormat, srgb ? 146 : 145, "BC7 colour space");
    assert.equal(scheme, 0, "Production BC7 is not supercompressed");
    encoding = "bc7";
  } else {
    assert.equal(vkFormat, srgb ? 43 : 37, "RGBA8 colour space");
    assert([0, 2].includes(scheme), "RGBA8 maps are plain or zstd-supercompressed");
    encoding = scheme === 2 ? "rgba8-zstd" : "rgba8";
  }
  if (texture.role === "ground-basecolor")
    assert.equal(width / config.tileMetres, config.groundTexelsPerMetre, "Ground texel density");
  if (texture.role === "ground-normal")
    assert.equal(
      width / config.tileMetres,
      config.groundNormalTexelsPerMetre,
      "Ground normal texel density",
    );
  await save(texture.role, "ktx2", bytes);
  textures[texture.role] = {
    width,
    height,
    mipLevels: levels,
    colorSpace: srgb ? "srgb" : "linear",
    encoding,
  };
  // GPU residency: UASTC transcodes to BC7 (16 bytes per 4 × 4 block), BC1 is 8 bytes per
  // block, and RGBA8 uploads as is.
  const blockBytes = (bytesPerBlock) =>
    Array.from({ length: levels }, (_, level) => {
      const w = Math.max(1, width >> level);
      const h = Math.max(1, height >> level);
      return Math.ceil(w / 4) * Math.ceil(h / 4) * bytesPerBlock;
    }).reduce((sum, value) => sum + value, 0);
  measurements.textures[texture.role] = {
    encodedBytes: bytes.length,
    rgba8DecodedBytes: texture.rgba8DecodedBytes,
    gpuBytes:
      encoding === "uastc" || encoding === "bc7"
        ? blockBytes(16)
        : encoding === "bc1"
          ? blockBytes(8)
          : texture.rgba8DecodedBytes,
  };
}
for (const material of Object.values(config.materials))
  for (const role of [material.baseColor, material.normal, material.orm])
    assert(textures[role], `Missing material texture ${role}`);
// Candidate 10 (engine package 6): an ORM whose B channel carries height gives its materials the
// range; the engine marches it toward the sun. It needs the unread metallic channel.
const ormHeightRange = (role) => {
  const range = pack.textures.find((texture) => texture.role === role)?.ormHeightRangeMetres;
  if (range === undefined) return undefined;
  assert(
    Array.isArray(range) &&
      range.length === 2 &&
      range.every(Number.isFinite) &&
      range[1] > range[0] &&
      range[0] >= config.heightRangeMetres[0] &&
      range[1] <= config.heightRangeMetres[1],
    `Invalid ORM height range for ${role}`,
  );
  return range;
};

// ---------------------------------------------------------------- geometry
const half = config.tileMetres / 2;
const parts = {};
const glbMeshes = [[], [], []];
for (const [partName, spec] of Object.entries(config.parts)) {
  const lods = [];
  for (let lod = 0; lod < 3; lod++) {
    const entry = pack.geometry.find((g) => g.part === partName && g.lod === lod);
    assert(entry, `Missing ${partName} LOD${lod}`);
    const vertexStream = await runtimeBytes(entry.vertexStream);
    const indexStream = await runtimeBytes(entry.indexStream);
    const vertices = new Uint8Array(entry.vertices * 32);
    MeshoptDecoder.decodeGltfBuffer(vertices, entry.vertices, 32, vertexStream, "ATTRIBUTES");
    const indexBytes = new Uint8Array(entry.triangles * 12);
    MeshoptDecoder.decodeGltfBuffer(indexBytes, entry.triangles * 3, 4, indexStream, "TRIANGLES");
    const v = new Float32Array(vertices.buffer);
    const indices = new Uint32Array(indexBytes.buffer);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < entry.vertices; i++) {
      const o = i * 8;
      for (let k = 0; k < 8; k++) assert(Number.isFinite(v[o + k]), "Finite attributes");
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], v[o + a]);
        max[a] = Math.max(max[a], v[o + a]);
      }
      const length = Math.hypot(v[o + 3], v[o + 4], v[o + 5]);
      assert(Math.abs(length - 1) <= config.normalUnitTolerance, "Unit normals");
      if (spec.flatNormals) assert(v[o + 3] === 0 && v[o + 4] === 1 && v[o + 5] === 0);
      if (partName !== "plants") {
        // Planar tile UVs: u = (X + 2) / 4 and v = (Z + 2) / 4 (glTF top-down v).
        assert(Math.abs(v[o + 6] - (v[o] + half) / config.tileMetres) < 1e-5, "Planar u");
        assert(Math.abs(v[o + 7] - (v[o + 2] + half) / config.tileMetres) < 1e-5, "Planar v");
      } else {
        assert(v[o + 6] >= 0 && v[o + 6] <= 1 && v[o + 7] >= 0 && v[o + 7] <= 1, "Atlas UV");
      }
    }
    const margin = config.boundsMarginMetres;
    assert(min[0] >= -half - margin && max[0] <= half + margin, "Tile X bounds");
    assert(min[2] >= -half - margin && max[2] <= half + margin, "Tile Z bounds");
    assert(min[1] >= config.heightRangeMetres[0] && max[1] <= config.heightRangeMetres[1]);
    for (const index of indices) assert(index < entry.vertices, "Index range");
    if (spec.flatNormals) {
      // Heightfield folds: every ground face must face +Y.
      for (let t = 0; t < indices.length; t += 3) {
        const [a, b, c] = [indices[t] * 8, indices[t + 1] * 8, indices[t + 2] * 8];
        const ny = (v[b + 2] - v[a + 2]) * (v[c] - v[a]) - (v[b] - v[a]) * (v[c + 2] - v[a + 2]);
        assert(ny > 0, "Ground LOD folded a face");
      }
    }
    if (spec.periodicBorders) {
      // Opposite borders carry identical vertex sets and heights at every LOD.
      for (const [axis, other] of [
        [0, 2],
        [2, 0],
      ]) {
        const edge = (value) => {
          const out = [];
          for (let i = 0; i < entry.vertices; i++)
            if (v[i * 8 + axis] === value) out.push(`${v[i * 8 + other]}:${v[i * 8 + 1]}`);
          return out.sort();
        };
        const low = edge(-half);
        assert(low.length > 1 && JSON.stringify(low) === JSON.stringify(edge(half)), "Seam");
      }
    }
    if (lod > 0) assert(entry.triangles < lods[lod - 1].triangles, "LOD reduction");
    await save(`${partName}-lod${lod}-vertices`, "meshopt", vertexStream);
    await save(`${partName}-lod${lod}-indices`, "meshopt", indexStream);
    lods.push({
      vertexRole: `${partName}-lod${lod}-vertices`,
      indexRole: `${partName}-lod${lod}-indices`,
      vertices: entry.vertices,
      triangles: entry.triangles,
      bounds: [min, max],
    });
    glbMeshes[lod].push({
      part: partName,
      vertices,
      indexBytes,
      vertexStream,
      indexStream,
      entry,
      min,
      max,
    });
  }
  parts[partName] = { material: spec.material, lods };
  measurements.parts[partName] = lods.map((l) => ({
    vertices: l.vertices,
    triangles: l.triangles,
  }));
}

// ---------------------------------------------------------------- canonical meshopt GLBs
const require = createRequire(new URL("../package.json", import.meta.url));
const { validateBytes, version: validatorVersion } = require("gltf-validator");
const validation = [];
const materialNames = Object.keys(config.materials);
for (let lod = 0; lod < 3; lod++) {
  const gltf = {
    asset: { version: "2.0", generator: "Parallax photoreal paving QA v1" },
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
      pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 },
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
      [mesh.vertexStream, mesh.vertices, mesh.entry.vertices, 32, "ATTRIBUTES"],
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
    gltf.nodes.push({ name: `${mesh.part}-lod${lod}`, mesh: gltf.meshes.length });
    gltf.scenes[0].nodes.push(gltf.nodes.length - 1);
    gltf.meshes.push({
      name: `${mesh.part}-lod${lod}`,
      primitives: [
        {
          attributes: { POSITION: base, NORMAL: base + 1, TEXCOORD_0: base + 2 },
          indices: base + 3,
          material: materialNames.indexOf(config.parts[mesh.part].material),
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
  validation.push({ lod, errors: report.issues.numErrors, warnings: report.issues.numWarnings });
  await save(`lod${lod}`, "glb", glb);
}

const runtime = resources.filter((r) => !r.file.endsWith(".glb"));
measurements.runtimeEncodedBytes = runtime.reduce((sum, r) => sum + r.bytes, 0);
measurements.rgba8DecodedTextureBytes = Object.values(measurements.textures).reduce(
  (sum, t) => sum + t.rgba8DecodedBytes,
  0,
);
measurements.gpuTextureBytes = Object.values(measurements.textures).reduce(
  (sum, t) => sum + t.gpuBytes,
  0,
);
const candidate = {
  schemaVersion: 1,
  mode: "periodic-surface-module",
  assetId: config.assetId,
  class: config.class,
  status: "structural-QA-passed-worker-roundtrip-pending",
  upAxis: "Y",
  tileMetres: config.tileMetres,
  materials: Object.fromEntries(
    Object.entries(config.materials).map(([name, material]) => [
      name,
      {
        ...material,
        baseColorFactor: [1, 1, 1],
        roughnessFactor: 1,
        metallicFactor: 0,
        normalScale: 1,
        ...(ormHeightRange(material.orm) === undefined
          ? {}
          : { ormHeightRangeMetres: ormHeightRange(material.orm) }),
      },
    ]),
  ),
  textures,
  parts,
  source,
  provenance: reviewed.provenance,
  encoders: {
    ktx: KTX_ENCODER_PIN,
    meshopt: "1.2.0",
    ...(Object.values(textures).some((texture) => texture.encoding === "bc7")
      ? { bc7Transcoder: await currentBc7Transcoder() }
      : {}),
  },
  qa: {
    finiteAttributesUnitNormalsAndIndexRange: true,
    planarTileUvs: true,
    groundFlatNormalsNoFolds: true,
    periodicGroundBorders: true,
    lodReduction: true,
    ktx2HeadersFullMipChains: true,
    groundTexelsPerMetre: config.groundTexelsPerMetre,
    canonicalMeshoptLayout: true,
    khronosValidator: { version: validatorVersion(), glbs: validation },
    rightsReviewed: reviewed.rightsReviewed,
  },
  measurements,
  resources,
};
await writeFile(join(output, "candidate.json"), `${JSON.stringify(candidate, null, 2)}\n`);
console.log(
  JSON.stringify({ resources: resources.length, runtimeBytes: measurements.runtimeEncodedBytes }),
);

/** Pre-encoded BC7 must come from the engine's pinned Babylon transcoder (D-201). */
async function currentBc7Transcoder() {
  const current = await bc7TranscoderIdentity();
  assert.deepEqual(
    pack.encoders?.bc7Transcoder,
    current,
    "Pre-encoded BC7 was not produced by the pinned Babylon transcoder; repack",
  );
  return current;
}
