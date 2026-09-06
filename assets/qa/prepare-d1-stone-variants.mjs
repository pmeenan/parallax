import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { MeshoptDecoder } from "../../engine/node_modules/meshoptimizer/meshopt_decoder.mjs";
import { MeshoptEncoder } from "../../engine/node_modules/meshoptimizer/meshopt_encoder.js";
import { KTX_ENCODER_PIN, loadPinnedKtxEncoder } from "../../engine/scripts/ktx-encoder-pin.mjs";
import { canonicalMeshoptLayoutErrors } from "../../engine/src/assets/meshopt-layout.ts";
import { readPavingProvenance } from "./paving-provenance.mjs";
import { validateStoneRootClearance } from "./stone-root-clearance.mjs";
import {
  validateStoneVariantGeometry,
  validateStoneVariantSet,
} from "./stone-variant-geometry.mjs";

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
const budget = JSON.parse(
  await readFile(new URL("./d1-stone-variants.json", import.meta.url), "utf8"),
);
assert.equal(budget.schemaVersion, 1);
const source = JSON.parse(await readFile(resolve(input, "export.json"), "utf8"));
const provenanceReview = await readPavingProvenance(resolve(import.meta.dirname, "../.."), source);
const { provenance } = provenanceReview;
validateStoneVariantSet(source, budget);
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
const geometryChecks = [];
const geometryByStem = new Map();
assert.equal(source.textures.length, Object.keys(budget.textureWidths).length);
assert.equal(new Set(source.textures.map((t) => t.role)).size, source.textures.length);
for (const textureSource of source.textures) {
  const expectedWidth = textureSource.levels[0].width;
  assert(
    Number.isInteger(expectedWidth) &&
      expectedWidth > 0 &&
      (expectedWidth & (expectedWidth - 1)) === 0,
  );
  assert(
    expectedWidth <= budget.textureWidths[textureSource.role],
    "Texture exceeds class resolution ceiling",
  );
  assert.equal(textureSource.levels.length, Math.log2(expectedWidth) + 1);
  const info = new ktx.textureCreateInfo();
  info.vkFormat = /basecolor/i.test(textureSource.role)
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
      assert.equal(hash(rgba), image.sha256, "Source mip SHA-256 differs");

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
    scenes: [{ nodes: source.meshes.filter((m) => m.lod === lod).map((_, i) => i) }],
    nodes: [],
    meshes: [],
    buffers: [{ byteLength: 0 }],
    bufferViews: [],
    accessors: [],
    materials: Object.keys(source.materials).map((name) => ({
      name,
      pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 },
    })),
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
  for (const entry of source.meshes.filter((m) => m.lod === lod)) {
    const vertices = await readFile(resolve(input, `${entry.stem}.vertices`));
    const indices = await readFile(resolve(input, `${entry.stem}.indices`));
    const floats = new Float32Array(vertices.buffer, vertices.byteOffset, vertices.length / 4);
    const indexArray = new Uint32Array(indices.buffer, indices.byteOffset, indices.length / 4);
    geometryByStem.set(entry.stem, floats);
    geometryChecks.push({
      stem: entry.stem,
      ...validateStoneVariantGeometry(entry, floats, indexArray, budget),
    });
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
        `${entry.stem}-${mode === "ATTRIBUTES" ? "vertices" : "indices"}`,
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
    gltf.nodes.push({ name: entry.stem, mesh: gltf.meshes.length });
    gltf.meshes.push({
      name: entry.stem,
      primitives: [
        {
          attributes: {
            POSITION: baseAccessor,
            NORMAL: baseAccessor + 1,
            TEXCOORD_0: baseAccessor + 2,
            TANGENT: baseAccessor + 3,
          },
          indices: baseAccessor + 4,
          material: Object.keys(source.materials).indexOf(entry.material),
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
const rootClearance = validateStoneRootClearance(source.layout, source, geometryByStem);
const manifest = {
  schemaVersion: 1,
  mode: source.mode,
  assetId: provenanceReview.assetId,
  status: "structural-QA-passed-worker-roundtrip-pending",
  upAxis: "Y",
  variants: source.variants,
  materials: source.materials,
  textureWidths: Object.fromEntries(source.textures.map((t) => [t.role, t.levels[0].width])),
  mipLevels: Object.fromEntries(source.textures.map((t) => [t.role, t.levels.length])),
  normalStrength: source.normalStrength,
  source,
  provenance,
  encoders: { ktx: KTX_ENCODER_PIN, meshopt: "1.2.0" },
  qa: {
    canonicalMeshoptLayout: true,
    meshoptVertexExactAndTriangleCyclicRoundtrip: true,
    finiteMetricBounds: true,
    closedGeometryAndSurfaceUvs: geometryChecks,
    rootClearance,
    normalUnitLength: true,
    lodBudgets: true,
    sourceMapHashes: true,
    rightsReviewed: provenanceReview.rightsReviewed,
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
