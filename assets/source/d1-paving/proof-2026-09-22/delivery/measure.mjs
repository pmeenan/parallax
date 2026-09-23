import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MeshoptDecoder } from "../../../../../engine/node_modules/meshoptimizer/meshopt_decoder.mjs";
import { MeshoptEncoder } from "../../../../../engine/node_modules/meshoptimizer/meshopt_encoder.js";

// Resource-only measurement, not an admission command or a shipping container format.
const root = resolve(process.argv[2]);
const out = resolve(process.argv[3]);
await mkdir(out, { recursive: false });
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const hash = (b) => createHash("sha256").update(b).digest("hex");
const resources = new Map();
const lods = [];
for (let lod = 0; lod < 3; lod++) {
  const bytes = await readFile(resolve(root, `lod${lod}.glb`));
  assert.equal(bytes.toString("ascii", 0, 4), "glTF");
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const jsonLength = bytes.readUInt32LE(12);
  const g = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
  const bin = bytes.subarray(28 + jsonLength);
  assert.equal(g.buffers.length, 1);
  assert.equal(g.materials.length, 3);
  const images = new Set(g.images.map((im) => im.bufferView));
  let rawGeometry = 0;
  let encodedGeometry = 0;
  let pngBytes = 0;
  let decodeMs = 0;
  let colorViews = 0;
  const records = [];
  for (const [index, view] of g.bufferViews.entries()) {
    assert.equal(view.buffer, 0);
    const raw = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    assert.equal(raw.length, view.byteLength);
    let encoded;
    let mode = "PNG";
    if (images.has(index)) {
      pngBytes += raw.length;
      encoded = raw;
    } else {
      const accessors = g.accessors.filter((a) => a.bufferView === index);
      assert.equal(accessors.length, 1, "This measurement expects separate accessor views");
      const a = accessors[0];
      assert.equal(a.byteOffset ?? 0, 0);
      const stride = view.byteStride ?? raw.length / a.count;
      assert(Number.isInteger(stride));
      mode = a.type === "SCALAR" ? "INDICES" : "ATTRIBUTES";
      // Index-sequence mode preserves exact order, including provoking vertices.
      encoded = Buffer.from(MeshoptEncoder.encodeGltfBuffer(raw, a.count, stride, mode));
      const decoded = Buffer.alloc(raw.length);
      const start = performance.now();
      MeshoptDecoder.decodeGltfBuffer(decoded, a.count, stride, encoded, mode);
      decodeMs += performance.now() - start;
      assert.deepEqual(decoded, raw, "Every decoded byte must match the export");
      rawGeometry += raw.length;
      encodedGeometry += encoded.length;
      const ai = g.accessors.indexOf(a);
      if (g.meshes.some((m) => m.primitives.some((p) => p.attributes.COLOR_0 === ai))) colorViews++;
    }
    const sha256 = hash(encoded);
    const file = `${sha256}.${mode === "PNG" ? "png" : "meshopt"}`;
    if (!resources.has(sha256)) {
      await writeFile(resolve(out, file), encoded, { flag: "wx" });
      resources.set(sha256, { file, bytes: encoded.length, mode });
    }
    records.push({
      view: index,
      mode,
      rawBytes: raw.length,
      bytes: encoded.length,
      sha256,
      sourceSha256: hash(raw),
    });
  }
  assert(colorViews > 0, "Approved plant colors must survive export");
  lods.push({
    lod,
    exportSha256: hash(bytes),
    rawGeometry,
    encodedGeometry,
    pngBytes,
    decodeMs,
    colorViews,
    views: records,
  });
}
const result = {
  scope: "Lossless meshopt streams and deduplicated PNG maps; not a runtime package",
  encoder: "meshoptimizer 1.2.0",
  exactDecodedBytes: true,
  lods,
  uniqueResources: [...resources.values()],
  uniqueResourceBytes: [...resources.values()].reduce((n, r) => n + r.bytes, 0),
  limitations: [
    "KTX2/transcoded visual evidence separate",
    "single cold Node decode diagnostic, not worker timing",
    "no admission or budget verdict",
  ],
};
await writeFile(resolve(root, "compression.json"), `${JSON.stringify(result, null, 2)}\n`, {
  flag: "wx",
});
console.log(
  JSON.stringify({
    uniqueResourceBytes: result.uniqueResourceBytes,
    lods: lods.map(({ views, ...r }) => r),
  }),
);
