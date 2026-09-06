import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { MeshoptDecoder } from "../../engine/node_modules/meshoptimizer/meshopt_decoder.mjs";
import { MeshoptEncoder } from "../../engine/node_modules/meshoptimizer/meshopt_encoder.js";
import { KTX_ENCODER_PIN, loadPinnedKtxEncoder } from "../../engine/scripts/ktx-encoder-pin.mjs";
import { canonicalMeshoptLayoutErrors } from "../../engine/src/assets/meshopt-layout.ts";
import { readPavingProvenance } from "./paving-provenance.mjs";
import {
  periodicTextureGradientDiagnostics,
  validatePeriodicPavingSeams,
} from "./paving-seams.mjs";

const input = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const resultsRoot = resolve(import.meta.dirname, "../../harness/results");
for (const directory of [input, output]) {
  const scoped = relative(resultsRoot, directory);
  assert(
    scoped !== "" && !scoped.startsWith("..") && !scoped.includes(":"),
    "Candidate files belong under ignored harness/results",
  );
}
await mkdir(output, { recursive: true });
const budget = JSON.parse(await readFile(new URL("./d1-paving.json", import.meta.url), "utf8"));
assert.equal(budget.schemaVersion, 1);
const source = JSON.parse(await readFile(resolve(input, "export.json"), "utf8"));
const provenanceReview = await readPavingProvenance(resolve(import.meta.dirname, "../.."), source);
const { provenance } = provenanceReview;
assert.equal(source.sourceWidthMetres, 2);
assert(
  Number.isFinite(source.normalStrength) &&
    source.normalStrength >= 0 &&
    source.normalStrength <= 4,
  "Authored normal strength must be within [0, 4]",
);
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const ktx = await loadPinnedKtxEncoder();
const resources = [];
const meshes = [];
const periodicMeshes = [];
const textureSeamDiagnostics = [];
if (source.periodic === true) assert.equal(source.textureAddressMode, "repeat");
for (const [role, linear] of [
  ["grassBaseColor", [0.055, 0.13, 0.018]],
  ["grassNormal", [0.5, 0.5, 1]],
  ["grassOrm", [1, 0.76, 0]],
]) {
  const rgb = linear.map((v) =>
    Math.round(
      255 *
        (role === "grassBaseColor"
          ? v <= 0.0031308
            ? v * 12.92
            : 1.055 * v ** (1 / 2.4) - 0.055
          : v),
    ),
  );
  const levels = [];
  for (const [level, size] of [4, 2, 1].entries()) {
    const file = `${role}-${level}.rgba`;
    const rgba = Buffer.alloc(size * size * 4);
    for (let p = 0; p < rgba.length; p += 4) rgba.set([...rgb, 255], p);
    await writeFile(resolve(input, file), rgba);
    levels.push({ file, width: size, height: size });
  }
  source.textures.push({ role, levels });
}
for (const textureSource of source.textures) {
  const expectedWidth = budget.textureWidths[textureSource.role];
  assert.equal(textureSource.levels[0].width, expectedWidth);
  assert.equal(textureSource.levels.length, Math.log2(expectedWidth) + 1);
  const info = new ktx.textureCreateInfo();
  info.vkFormat = ["baseColor", "grassBaseColor"].includes(textureSource.role)
    ? ktx.VkFormat.R8G8B8A8_SRGB
    : ktx.VkFormat.R8G8B8A8_UNORM;
  info.baseWidth = textureSource.levels[0].width;
  info.baseHeight = textureSource.levels[0].height;
  info.baseDepth = 1;
  info.numDimensions = 2;
  info.numLevels = textureSource.levels.length;
  info.numLayers = 1;
  info.numFaces = 1;
  info.isArray = false;
  info.generateMipmaps = false;
  const texture = new ktx.texture(info, ktx.TextureCreateStorageEnum.ALLOC_STORAGE);
  const basis = new ktx.basisParams();
  try {
    for (const [level, image] of textureSource.levels.entries()) {
      assert.equal(image.width, expectedWidth >> level);
      assert.equal(image.height, image.width);
      const rgba = await readFile(resolve(input, image.file));
      assert.equal(rgba.length, image.width * image.height * 4);
      if (
        source.periodic === true &&
        level === 0 &&
        ["baseColor", "normal", "orm"].includes(textureSource.role)
      )
        textureSeamDiagnostics.push(
          periodicTextureGradientDiagnostics(rgba, image.width, image.height, textureSource.role),
        );
      texture.setImageFromMemory(level, 0, 0, rgba);
    }
    basis.uastc = true;
    basis.threadCount = 1;
    basis.noSSE = true;
    basis.uastcRDO = false;
    basis.uastcRDONoMultithreading = true;
    const status = texture.compressBasis(basis);
    assert.equal(status, ktx.ErrorCode.SUCCESS);
    const bytes = Buffer.from(texture.writeToMemory());
    assert.equal(bytes.subarray(0, 12).toString("hex"), "ab4b5458203230bb0d0a1a0a");
    assert.equal(bytes.readUInt32LE(20), textureSource.levels[0].width);
    assert.equal(bytes.readUInt32LE(40), textureSource.levels.length);
    resources.push(await save(textureSource.role, "ktx2", bytes));
  } finally {
    texture.delete();
    basis.delete();
    info.delete();
  }
}
for (let lod = 0; lod < 3; lod++) {
  const gltf = {
    asset: { version: "2.0", generator: "Parallax d1-paving export v1" },
    extensionsUsed: ["EXT_meshopt_compression"],
    extensionsRequired: ["EXT_meshopt_compression"],
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [],
    meshes: [],
    buffers: [{ byteLength: 0 }],
    bufferViews: [],
    accessors: [],
    materials: [
      {
        name: provenanceReview.assetId,
        pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 },
      },
      {
        name: "d1-living-joint-grass",
        doubleSided: false,
        pbrMetallicRoughness: {
          baseColorFactor: [0.055, 0.13, 0.018, 1],
          metallicFactor: 0,
          roughnessFactor: 0.76,
        },
      },
    ],
  };
  const chunks = [];
  let cursor = 0;
  const append = (bytes) => {
    const offset = cursor;
    chunks.push(bytes);
    const padding = (4 - (bytes.length % 4)) % 4;
    chunks.push(Buffer.alloc(padding));
    cursor += bytes.length + padding;
    return offset;
  };
  for (const role of ["stone", "grass"]) {
    const entry = source.meshes.find((m) => m.lod === lod && m.role === role);
    const vertices = await readFile(resolve(input, `${entry.stem}.vertices`));
    const indices = await readFile(resolve(input, `${entry.stem}.indices`));
    const floats = new Float32Array(vertices.buffer, vertices.byteOffset, vertices.length / 4);
    const indexArray = new Uint32Array(indices.buffer, indices.byteOffset, indices.length / 4);
    if (source.periodic === true && role === "stone")
      periodicMeshes.push({ attributes: floats, indices: indexArray });
    assert.equal(vertices.length, entry.vertices * 48);
    assert.equal(indices.length, entry.triangles * 12);
    assert(
      entry.triangles <=
        (role === "stone" ? budget.stoneTriangles[lod] : budget.grassTriangles[lod]),
    );
    for (const value of floats) assert(Number.isFinite(value));
    for (const index of indexArray) assert(index < entry.vertices);
    for (let v = 0; v < entry.vertices; v++) {
      const p = v * 12;
      assert(Math.abs(Math.hypot(...floats.subarray(p + 3, p + 6)) - 1) < 0.002);
      assert(floats[p] >= -1.001 && floats[p] <= 1.001);
      assert(floats[p + 1] >= -0.003 && floats[p + 1] <= 0.12);
      assert(floats[p + 2] >= -1.001 && floats[p + 2] <= 1.001);
      assert(floats[p + 6] >= 0 && floats[p + 6] <= 1 && floats[p + 7] >= 0 && floats[p + 7] <= 1);
    }
    if (role === "stone") {
      // Each triangle's UV area must be positive, nondegenerate, and the complete tile covers exactly one unit square.
      let area = 0;
      for (let i = 0; i < indexArray.length; i += 3) {
        const a = indexArray[i] * 12 + 6,
          b = indexArray[i + 1] * 12 + 6,
          c = indexArray[i + 2] * 12 + 6;
        const signed =
          (floats[b] - floats[a]) * (floats[c + 1] - floats[a + 1]) -
          (floats[b + 1] - floats[a + 1]) * (floats[c] - floats[a]);
        assert(signed < 0); // glTF V flip reverses UV winding intentionally.
        area -= signed / 2;
      }
      assert(Math.abs(area - 1) < 1e-6);
    }
    const viewIds = [];
    for (const [bytes, count, stride, mode] of [
      [vertices, entry.vertices, 48, "ATTRIBUTES"],
      [indices, indexArray.length, 4, "TRIANGLES"],
    ]) {
      const compressed = Buffer.from(
        MeshoptEncoder.encodeGltfBuffer(bytes, count, stride, mode, 0),
      );
      const decoded = new Uint8Array(bytes.length);
      MeshoptDecoder.decodeGltfBuffer(decoded, count, stride, compressed, mode);
      if (mode === "ATTRIBUTES")
        assert(Buffer.from(decoded).equals(bytes), "Meshopt vertex roundtrip differs");
      else {
        const restored = new Uint32Array(decoded.buffer);
        for (let i = 0; i < indexArray.length; i += 3) {
          const rotation = [0, 1, 2].find((r) => restored[i] === indexArray[i + r]);
          assert(
            rotation !== undefined &&
              restored[i + 1] === indexArray[i + ((rotation + 1) % 3)] &&
              restored[i + 2] === indexArray[i + ((rotation + 2) % 3)],
            "Meshopt triangle topology differs",
          );
        }
      }
      let runtimeCompressed = compressed;
      if (mode === "ATTRIBUTES") {
        const runtimeBytes = Buffer.alloc(count * 32);
        for (let vertex = 0; vertex < count; vertex++)
          bytes.copy(runtimeBytes, vertex * 32, vertex * 48, vertex * 48 + 32);
        runtimeCompressed = Buffer.from(
          MeshoptEncoder.encodeGltfBuffer(runtimeBytes, count, 32, mode, 0),
        );
        const runtimeDecoded = new Uint8Array(runtimeBytes.length);
        MeshoptDecoder.decodeGltfBuffer(runtimeDecoded, count, 32, runtimeCompressed, mode);
        assert(
          Buffer.from(runtimeDecoded).equals(runtimeBytes),
          "Runtime 32-byte vertex roundtrip differs",
        );
      }
      const resource = await save(
        `lod${lod}-${role}-${mode === "ATTRIBUTES" ? "vertices" : "indices"}`,
        "meshopt",
        runtimeCompressed,
      );
      resources.push(resource);
      const encodedOffset = append(compressed);
      // Valid single-buffer glTF fallback preserves broad tool inspectability; production packs compressed views only.
      const fallbackOffset = append(bytes);
      viewIds.push(gltf.bufferViews.length);
      gltf.bufferViews.push({
        buffer: 0,
        byteOffset: fallbackOffset,
        byteLength: bytes.length,
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
    const baseAccessor = gltf.accessors.length;
    for (const [offset, type] of [
      [0, "VEC3"],
      [12, "VEC3"],
      [24, "VEC2"],
      [32, "VEC4"],
    ])
      gltf.accessors.push({
        bufferView: viewIds[0],
        byteOffset: offset,
        componentType: 5126,
        count: entry.vertices,
        type,
        ...(offset === 0 ? { min: entry.bounds[0], max: entry.bounds[1] } : {}),
      });
    gltf.accessors.push({
      bufferView: viewIds[1],
      componentType: 5125,
      count: indexArray.length,
      type: "SCALAR",
    });
    gltf.nodes.push({ name: `d1-paving-${role}-lod${lod}`, mesh: gltf.meshes.length });
    gltf.meshes.push({
      name: `d1-paving-${role}-lod${lod}`,
      primitives: [
        {
          attributes: {
            POSITION: baseAccessor,
            NORMAL: baseAccessor + 1,
            TEXCOORD_0: baseAccessor + 2,
            TANGENT: baseAccessor + 3,
          },
          indices: baseAccessor + 4,
          material: role === "stone" ? 0 : 1,
          mode: 4,
        },
      ],
    });
    meshes.push({ ...entry, vertexStride: 32, sourceGlbVertexStride: 48, indexStride: 4 });
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
  resources.push(
    await save(`lod${lod}`, "glb", Buffer.concat([header, paddedJson, binHeader, bin])),
  );
}
assert(
  resources
    .filter((resource) => !resource.file.endsWith(".glb"))
    .reduce((sum, resource) => sum + resource.bytes, 0) <= budget.maxRuntimeEncodedBytes,
);
const periodicSeams =
  source.periodic === true ? validatePeriodicPavingSeams(periodicMeshes) : undefined;
const manifest = {
  schemaVersion: 1,
  assetId: provenanceReview.assetId,
  ...(source.periodic === true ? { periodic: true, textureAddressMode: "repeat" } : {}),
  status: "structural-QA-passed-worker-roundtrip-pending",
  sourceWidthMetres: 2,
  upAxis: "Y",
  texelsPerMetre: 1024,
  textureWidths: {
    baseColor: 2048,
    normal: 2048,
    orm: 1024,
    grassBaseColor: 4,
    grassNormal: 4,
    grassOrm: 4,
  },
  mipLevels: { baseColor: 12, normal: 12, orm: 11, grassBaseColor: 3, grassNormal: 3, grassOrm: 3 },
  normalStrength: source.normalStrength,
  materials: {
    stone: {
      baseColor: "baseColor",
      normal: "normal",
      metallicRoughness: "orm",
      metallicFactor: 0,
      roughnessFactor: 1,
    },
    grass: {
      baseColor: "grassBaseColor",
      normal: "grassNormal",
      metallicRoughness: "grassOrm",
      baseColorFactor: [1, 1, 1, 1],
      roughnessFactor: 1,
      metallicFactor: 0,
      normalStrength: 1,
      doubleSided: false,
    },
  },
  source,
  provenance,
  encoders: { ktx: KTX_ENCODER_PIN, meshopt: "1.2.0" },
  qa: {
    canonicalMeshoptLayout: true,
    meshoptVertexExactAndTriangleCyclicRoundtrip: true,
    finiteMetricBounds: true,
    uvTileCoverage: true,
    normalUnitLength: true,
    lodBudgets: true,
    sourceMapHashes: true,
    rightsReviewed: provenanceReview.rightsReviewed,
    ...(periodicSeams === undefined ? {} : { periodicSeams, textureSeamDiagnostics }),
    grassUvException:
      "Solid-color original authored leaves; no sampled texture or texel-density requirement.",
  },
  meshes,
  resources,
};
await writeFile(resolve(output, "candidate.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  JSON.stringify({
    resources: resources.map((r) => ({ role: r.role, bytes: r.bytes })),
    totalBytes: resources.reduce((s, r) => s + r.bytes, 0),
  }),
);
function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
async function save(role, extension, bytes) {
  assert(bytes.length <= budget.maxResourceEncodedBytes);
  const sha256 = hash(bytes);
  const file = `${sha256}.${extension}`;
  await writeFile(resolve(output, file), bytes);
  return { role, file, sha256, bytes: bytes.length };
}
