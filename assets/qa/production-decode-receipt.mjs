// Production decode receipt for a library candidate: every runtime resource is decoded by the
// engine's own compressed streaming codec in a pinned-Chrome module worker, with external
// requests blocked. Admission requires this receipt (D-186).
// Requires `pnpm build` (harness/dist). node assets/qa/production-decode-receipt.mjs <candidate dir> <receipt.json>
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, link, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const candidateDirectory = resolve(process.argv[2]);
const receiptPath = resolve(process.argv[3]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const harness = (name) =>
  import(pathToFileURL(join(root, "harness/dist/types", `${name}.js`)).href);
const { build } = await import(
  pathToFileURL(join(root, "harness/node_modules/esbuild/lib/main.js")).href
);
const { createLocalServer, listenLocalServer, stopLocalServer } = await harness("server");
const {
  launchPersistentChrome,
  loadChromePin,
  resolveChromeExecutablePath,
  validateChromeExecutable,
} = await harness("chrome-pin");

const candidateBytes = await readFile(join(candidateDirectory, "candidate.json"));
const candidate = JSON.parse(candidateBytes);
assert.equal(candidate.status, "structural-QA-passed-worker-roundtrip-pending");
// Served beside the receipt so candidate objects can be hard-linked on the same volume.
const serving = await mkdtemp(join(dirname(receiptPath), "decode-receipt-serving-"));
await writeFile(join(serving, "candidate.json"), candidateBytes);
const runtime = candidate.resources.filter((resource) => !resource.file.endsWith(".glb"));
for (const resource of runtime)
  await link(join(candidateDirectory, resource.file), join(serving, resource.file));

// The same decoder inputs the engine build substitutes (harness/scripts/build.mjs).
const wasm = {
  __MSC_TRANSCODER_WASM_ARTIFACT__: "@babylonjs/ktx2decoder/wasm/msc_basis_transcoder.wasm",
  __UASTC_RGBA_SRGB_WASM_ARTIFACT__: "@babylonjs/ktx2decoder/wasm/uastc_rgba8_srgb_v2.wasm",
  __UASTC_RGBA_UNORM_WASM_ARTIFACT__: "@babylonjs/ktx2decoder/wasm/uastc_rgba8_unorm_v2.wasm",
  __ZSTD_DECODER_WASM_ARTIFACT__: "@babylonjs/ktx2decoder/wasm/zstddec.wasm",
};
for (const [token, path] of Object.entries(wasm))
  await copyFile(join(root, "engine/node_modules", path), join(serving, `${token}.wasm`));
const codecs = join(root, "engine/src/streaming/compressed-streaming-codecs.ts");
const contract = join(root, "engine/src/streaming/streaming-dependency-contract.ts");
const entry = join(serving, "entry.ts");
await writeFile(
  entry,
  `import { createCompressedStreamingDecoder } from ${JSON.stringify(codecs)};
import { validateDecodedStreamingDependencies } from ${JSON.stringify(contract)};
onmessage = async () => {
  const candidate = await (await fetch("./candidate.json")).json();
  const decoder = createCompressedStreamingDecoder();
  const lods = Object.values(candidate.parts).flatMap((part) => part.lods);
  const results = [];
  for (const r of candidate.resources.filter((r) => !r.file.endsWith(".glb"))) {
    try {
      const texture = candidate.textures[r.role];
      const lod = lods.find((l) => l.vertexRole === r.role || l.indexRole === r.role);
      const decode = texture
        ? { version: 2, colorSpace: texture.colorSpace, format: "rgba8", width: texture.width, height: texture.height, mipLevelCount: texture.mipLevels }
        : lod.indexRole === r.role
          ? { version: 1, mode: "TRIANGLES", count: lod.triangles * 3, stride: 4, indexFormat: "uint32", vertexCount: lod.vertices }
          : { version: 1, mode: "ATTRIBUTES", count: lod.vertices, stride: 32, layout: "position-normal-uv-f32" };
      const descriptor = { resourceId: r.role, bytes: r.bytes, sha256: r.sha256, path: r.file, format: texture ? "ktx2" : "meshopt", dependencies: [], decode };
      const data = await (await fetch("./" + r.file)).arrayBuffer();
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), (b) => b.toString(16).padStart(2, "0")).join("");
      if (digest !== r.sha256) throw new Error("SHA-256 mismatch");
      const decoded = await decoder.decode({ descriptor, bytes: data });
      validateDecodedStreamingDependencies([descriptor], [decoded]);
      results.push({ role: r.role, sha256: r.sha256, passed: true, decodedBytes: decoded.decodedBytes, decodeMs: decoded.decodeMs, mips: decoded.mipmaps?.length ?? null });
    } catch (error) {
      results.push({ role: r.role, sha256: r.sha256, passed: false, error: String(error?.stack ?? error) });
    }
  }
  postMessage({ passed: results.every((r) => r.passed), documentType: typeof document, resources: results });
};
`,
);
const factory = "@babylonjs/ktx2decoder/wasm/msc_basis_transcoder.js";
const trailer = "if (typeof exports === 'object' && typeof module === 'object')";
await build({
  entryPoints: [entry],
  outfile: join(serving, "worker.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome152",
  // The transcoder wrapper's Node branches reference these; the worker never reaches them.
  external: ["fs", "path"],
  nodePaths: [join(root, "engine/node_modules")],
  logLevel: "warning",
  plugins: [
    {
      name: "production-decoder-inputs",
      setup(b) {
        // Mirrors engine/rollup.config.mjs's decoder-factory plugin for the MSC transcoder.
        b.onResolve({ filter: /^parallax:msc-transcoder-factory$/ }, (a) => ({
          path: a.path,
          namespace: "factory",
        }));
        b.onLoad({ filter: /.*/, namespace: "factory" }, async () => {
          const text = await readFile(join(root, "engine/node_modules", factory), "utf8");
          const at = text.lastIndexOf(trailer);
          assert(at > 0, "Pinned MSC transcoder wrapper changed shape");
          return {
            contents: `${text.slice(0, at)}\nexport default MSC_TRANSCODER;\n`,
            loader: "js",
          };
        });
        b.onLoad({ filter: /compressed-streaming-codecs\.ts$/ }, async (a) => {
          let text = await readFile(a.path, "utf8");
          for (const token of Object.keys(wasm)) {
            assert.equal(text.split(token).length, 2, `Codec token ${token}`);
            text = text.replace(token, `${token}.wasm`);
          }
          return { contents: text, loader: "ts" };
        });
      },
    },
  ],
});
await writeFile(join(serving, "index.html"), "<!doctype html><title>decode receipt</title>\n");
const pin = await loadChromePin(join(root, "harness/chrome/stable.json"));
const executable = await resolveChromeExecutablePath(root, pin);
const executableSha256 = await validateChromeExecutable(pin, executable);
const server = createLocalServer({ root: serving });
const address = await listenLocalServer(server);
const origin = `http://127.0.0.1:${address.port}`;
const context = await launchPersistentChrome(
  executable,
  await mkdtemp(join(tmpdir(), "parallax-receipt-chrome-")),
);
const external = [];
let result;
try {
  const page = await context.newPage();
  await context.route("**/*", async (route) => {
    if (route.request().url().startsWith(`${origin}/`)) await route.continue();
    else {
      external.push(route.request().url());
      await route.abort();
    }
  });
  await page.goto(`${origin}/index.html`);
  result = await page.evaluate(
    (url) =>
      new Promise((done, fail) => {
        const worker = new Worker(url, { type: "module" });
        worker.onerror = (event) => fail(new Error(event.message));
        worker.onmessage = (event) => done(event.data);
        worker.postMessage(null);
      }),
    `${origin}/worker.js`,
  );
} finally {
  await context.close();
  await stopLocalServer(server);
}
const sourceFiles = [];
for (const path of [
  "engine/src/streaming/compressed-streaming-codecs.ts",
  "engine/src/streaming/ktx2-rgba8.ts",
  "engine/src/streaming/streaming-dependency-contract.ts",
  "engine/src/streaming/streaming-protocol.ts",
  "engine/node_modules/@babylonjs/ktx2decoder/package.json",
])
  sourceFiles.push({ path, sha256: hash(await readFile(join(root, path))) });
const receipt = {
  schemaVersion: 1,
  candidateSha256: hash(candidateBytes),
  decoder: "parallax-production-compressed-worker",
  passed: result.passed && external.length === 0 && result.documentType === "undefined",
  browser: { version: pin.version, executableSha256 },
  externalRequestCount: external.length,
  documentType: result.documentType,
  sourceFiles,
  resources: result.resources,
};
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
console.log(
  JSON.stringify({
    passed: receipt.passed,
    resources: receipt.resources.length,
    failed: receipt.resources.filter((r) => !r.passed).map((r) => [r.role, r.error]),
  }),
);
if (!receipt.passed) process.exitCode = 1;
