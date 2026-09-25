// Pre-encode a UASTC KTX2 as a plain BC7 KTX2 (D-201). The blocks come from the same pinned
// Babylon `uastc_bc7.wasm` transcoder the decode worker used at runtime, so shipping them changes
// no pixel; Web-libktx only writes the container. (Web-libktx's own UASTC→BC7 transcode picks
// different blocks.)
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as KTX2DecoderPackage from "@babylonjs/ktx2decoder";

const DECODED_BC7_ENGINE_FORMAT = 36492;
const WASM_URL = new URL(
  "../node_modules/@babylonjs/ktx2decoder/wasm/uastc_bc7.wasm",
  import.meta.url,
);
let ready = null;

/** The pinned transcoder that produced pre-encoded BC7. Admitted assets record it, and packaging
 * refuses them once the engine's decoder pin moves (the maps must be repacked). */
export async function bc7TranscoderIdentity() {
  const pkg = JSON.parse(
    await readFile(
      new URL("../node_modules/@babylonjs/ktx2decoder/package.json", import.meta.url),
      "utf8",
    ),
  );
  return {
    package: "@babylonjs/ktx2decoder",
    version: pkg.version,
    wasmSha256: createHash("sha256")
      .update(await readFile(WASM_URL))
      .digest("hex"),
  };
}

async function transcoderReady() {
  ready ??= readFile(WASM_URL).then((wasm) => {
    KTX2DecoderPackage.LiteTranscoder_UASTC_BC7.WasmBinary = wasm.buffer.slice(
      wasm.byteOffset,
      wasm.byteOffset + wasm.byteLength,
    );
  });
  return ready;
}

/** @returns {Promise<{ ktx2: Buffer; levels: Buffer[] }>} */
export async function preencodeUastcAsBc7(ktx, uastcKtx2, srgb) {
  await transcoderReady();
  const decoded = await new KTX2DecoderPackage.KTX2Decoder().decode(
    new Uint8Array(uastcKtx2),
    { astc: false, bptc: true, etc1: false, etc2: false, pvrtc: false, s3tc: false },
    {},
  );
  if (decoded.transcodedFormat !== DECODED_BC7_ENGINE_FORMAT)
    throw new Error("UASTC did not transcode to BC7");
  const levels = decoded.mipmaps.map((mip) => {
    if (mip.data === null) throw new Error("BC7 level is empty");
    return Buffer.from(mip.data);
  });
  const base = decoded.mipmaps[0];
  const info = new ktx.textureCreateInfo();
  info.vkFormat = srgb ? ktx.VkFormat.BC7_SRGB_BLOCK : ktx.VkFormat.BC7_UNORM_BLOCK;
  Object.assign(info, {
    baseWidth: base.width,
    baseHeight: base.height,
    baseDepth: 1,
    numDimensions: 2,
    numLevels: levels.length,
    numLayers: 1,
    numFaces: 1,
    isArray: false,
    generateMipmaps: false,
  });
  const texture = new ktx.texture(info, ktx.TextureCreateStorageEnum.ALLOC_STORAGE);
  for (const [level, blocks] of levels.entries())
    if (texture.setImageFromMemory(level, 0, 0, blocks) !== ktx.ErrorCode.SUCCESS)
      throw new Error(`BC7 level ${level} was rejected`);
  const ktx2 = Buffer.from(texture.writeToMemory());
  texture.delete();
  info.delete();
  return { ktx2, levels };
}
