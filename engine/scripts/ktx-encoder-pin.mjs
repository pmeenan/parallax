import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const KTX_ENCODER_PIN = Object.freeze({
  archiveSha256: "1d4598a290ccb654d6a33c074c4ca96f0c5ccef99e042323eaa4d1230d4de63d",
  jsSha256: "96422b4d0d0de173b9796711379b1525585aa03f8f662ad7794f2dd088da32c7",
  version: "4.4.2",
  wasmSha256: "839d8f70377b03e41a73f18ffc3839f87418079792cef4d82aae824a8241c7f0",
});

export async function loadPinnedKtxEncoder() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const registry = JSON.parse(
    await readFile(resolve(root, ".parallax-toolchain.local.json"), "utf8"),
  );
  const tool = registry.tools?.find((candidate) => candidate.id === "ktx-software-web-libktx");
  if (
    tool?.version !== KTX_ENCODER_PIN.version ||
    tool.archiveSha256 !== KTX_ENCODER_PIN.archiveSha256 ||
    typeof tool.path !== "string" ||
    typeof tool.relatedPaths?.wasm !== "string"
  ) {
    throw new Error("Machine-local Web-libktx registry identity is absent or invalid");
  }
  const [js, wasm] = await Promise.all([readFile(tool.path), readFile(tool.relatedPaths.wasm)]);
  if (sha256(js) !== KTX_ENCODER_PIN.jsSha256 || sha256(wasm) !== KTX_ENCODER_PIN.wasmSha256) {
    throw new Error("Machine-local Web-libktx bytes do not match the authoritative pin");
  }
  const require = createRequire(import.meta.url);
  const createKtxModule = require(tool.path);
  return createKtxModule({ locateFile: () => tool.relatedPaths.wasm });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
