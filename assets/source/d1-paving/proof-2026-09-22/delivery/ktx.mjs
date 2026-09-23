import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  KTX_ENCODER_PIN,
  loadPinnedKtxEncoder,
} from "../../../../../engine/scripts/ktx-encoder-pin.mjs";

const input = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
await mkdir(output, { recursive: false });
const k = await loadPinnedKtxEncoder();
const maps = JSON.parse(await readFile(resolve(input, "mips.json"), "utf8"));
const results = [];
const hash = (b) => createHash("sha256").update(b).digest("hex");
for (const map of maps) {
  const info = new k.textureCreateInfo();
  const width = map.levels[0].width;
  info.vkFormat = map.name.endsWith("basecolor")
    ? k.VkFormat.R8G8B8A8_SRGB
    : k.VkFormat.R8G8B8A8_UNORM;
  Object.assign(info, {
    baseWidth: width,
    baseHeight: width,
    baseDepth: 1,
    numDimensions: 2,
    numLevels: map.levels.length,
    numLayers: 1,
    numFaces: 1,
    isArray: false,
    generateMipmaps: false,
  });
  const texture = new k.texture(info, k.TextureCreateStorageEnum.ALLOC_STORAGE);
  const basis = new k.basisParams();
  const start = performance.now();
  try {
    for (const [level, image] of map.levels.entries()) {
      const rgba = await readFile(resolve(input, image.file));
      assert.equal(hash(rgba), image.sha256);
      assert.equal(rgba.length, image.width ** 2 * 4);
      texture.setImageFromMemory(level, 0, 0, rgba);
    }
    Object.assign(basis, {
      uastc: true,
      threadCount: 1,
      noSSE: true,
      uastcRDO: false,
      uastcRDONoMultithreading: true,
    });
    assert.equal(texture.compressBasis(basis), k.ErrorCode.SUCCESS);
    assert.equal(texture.deflateZstd(9), k.ErrorCode.SUCCESS);
    const bytes = Buffer.from(texture.writeToMemory());
    assert.equal(bytes.subarray(0, 12).toString("hex"), "ab4b5458203230bb0d0a1a0a");
    assert.equal(bytes.readUInt32LE(20), width);
    assert.equal(bytes.readUInt32LE(40), map.levels.length);
    await writeFile(resolve(output, `${map.name}.ktx2`), bytes, { flag: "wx" });
    // Decode the serialized payload, not merely the still-live source texture.
    const decoded = new k.texture(bytes);
    try {
      assert.equal(decoded.transcodeBasis(k.TranscodeTarget.RGBA32, 0), k.ErrorCode.SUCCESS);
      const rgba = Buffer.from(decoded.getImage(0, 0, 0));
      assert.equal(rgba.length, width ** 2 * 4);
      await writeFile(resolve(output, `${map.name}.rgba`), rgba, { flag: "wx" });
      const original = await readFile(resolve(input, map.levels[0].file));
      let error = 0;
      let maximum = 0;
      for (let i = 0; i < rgba.length; i++) {
        const delta = Math.abs(rgba[i] - original[i]);
        error += delta;
        maximum = Math.max(maximum, delta);
      }
      results.push({
        name: map.name,
        width,
        levels: map.levels.length,
        bytes: bytes.length,
        sha256: hash(bytes),
        decodedSha256: hash(rgba),
        meanChannelByteError: error / rgba.length,
        maximumChannelByteError: maximum,
        encodeAndDecodeMs: performance.now() - start,
      });
    } finally {
      decoded.delete();
    }
  } finally {
    texture.delete();
    basis.delete();
    info.delete();
  }
  console.log(map.name, results.at(-1).bytes);
}
const result = {
  encoder: KTX_ENCODER_PIN,
  mode: "UASTC without RDO + Zstd 9; full mip chains",
  maps: results,
  totalBytes: results.reduce((n, r) => n + r.bytes, 0),
  scope:
    "Source texture compression diagnostic; BC7 GPU appearance and atlas-tail mips still need runtime inspection",
};
await writeFile(resolve(output, "receipt.json"), `${JSON.stringify(result, null, 2)}\n`, {
  flag: "wx",
});
