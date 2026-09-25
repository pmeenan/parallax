// Pinned-Chrome Babylon Lite inspection of the photoreal paving delivery candidate.
// Requires `pnpm build` (harness/dist). node chrome-preview.mjs <pack dir> <stage-2 maps dir> <out dir> [diag|cost|tex2048|normal2048|rim]
// Renders the decoded runtime bytes with chrome-worker.ts in a module worker and writes PNGs
// plus preview.json (visible triangles, draw calls, GPU frame-time samples). Timings are
// isolated-preview diagnostics on this machine, not budget evidence.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

const repo = resolve(import.meta.dirname, "../../../../..");
const harness = (name) =>
  import(pathToFileURL(join(repo, "harness/dist/types", `${name}.js`)).href);
const { build } = await import(
  pathToFileURL(join(repo, "harness/node_modules/esbuild/lib/main.js")).href
);
const { createLocalServer, listenLocalServer, stopLocalServer } = await harness("server");
const {
  launchPersistentChrome,
  loadChromePin,
  resolveChromeExecutablePath,
  validateChromeExecutable,
} = await harness("chrome-pin");
const { launchAfterPhysicalConsoleDisplayWake } = await harness("physical-console-preflight");

const pack = resolve(process.argv[2]);
const mapsDir = resolve(process.argv[3]);
const out = resolve(process.argv[4]);
await mkdir(out, { recursive: false });
const hash = (b) => createHash("sha256").update(b).digest("hex");
const packReceipt = JSON.parse(await readFile(join(pack, "pack.json"), "utf8"));

// The source close-up aims at the first rosette root: its first petiole ring (vertices 98-103).
const npy = await readFile(join(mapsDir, "geometry", "plant_co.npy"));
const plantCo = new Float32Array(npy.buffer.slice(npy.byteOffset + 10 + npy.readUInt16LE(8)));
let rx = 0;
let ry = 0;
for (let i = 98; i < 104; i++) {
  rx += plantCo[i * 3] / 6;
  ry += plantCo[i * 3 + 1] / 6;
}
const grid = (x0, x1, y0, y1) => {
  const t = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) t.push([x, y]);
  return t;
};
const matched = grid(-1, 1, -1, 2); // the source presentation's 3 x 4 tiles
const wide = grid(-6, 6, -2, 12);
const sunny = { sun: [30, 165], weather: "clear" };
const walk = { eye: [2.0, 0.25, 1.6], target: [2.05, 2.75, 0.0], lens: 30 };
const view = (name, o) => ({
  name,
  width: 1536,
  height: 1024,
  tiles: matched,
  lodMode: "lod0",
  timingFrames: 0,
  ...sunny,
  ...walk,
  ...o,
});
const views = [
  view("walking", {}),
  view("walking-matched", {
    width: 1800,
    height: 1350,
    eye: [2.15, 0.3, 1.635],
    target: [2.05, 2.15, 0.0],
    lens: 42,
  }),
  view("overview", { eye: [-0.6, -1.4, 2.6], target: [2.0, 2.0, 0.0] }),
  view("close", { eye: [rx - 0.05, ry - 0.55, 0.32], target: [rx, ry + 0.05, 0.0], lens: 40 }),
  view("joint", { eye: [2.0, 1.3, 0.22], target: [2.05, 1.75, -0.01], lens: 45, sun: [28, 170] }),
  view("grazing", { sun: [12, 20] }),
  view("overcast", { sun: [34, 165], weather: "overcast" }),
  view("join", { eye: [4.35, 3.05, 0.55], target: [4.0, 4.0, 0.0], lens: 35, sun: [12, 20] }),
  view("mid-lod0", { tiles: wide, eye: [2.0, 0.25, 1.6], target: [2.0, 24.0, 0.0], lens: 60 }),
  view("mid-mixed", {
    tiles: wide,
    eye: [2.0, 0.25, 1.6],
    target: [2.0, 24.0, 0.0],
    lens: 60,
    lodMode: "mixed",
  }),
  view("walking-4k-mixed", {
    width: 3840,
    height: 2160,
    tiles: wide,
    lodMode: "mixed",
    timingFrames: 180,
  }),
];
// `diag`: light-scale and flat-normal variants that separate asset shading from engine lighting.
if (process.argv[5] === "diag") {
  const wm = {
    width: 1800,
    height: 1350,
    eye: [2.15, 0.3, 1.635],
    target: [2.05, 2.15, 0.0],
    lens: 42,
  };
  views.splice(
    0,
    views.length,
    view("wm-game", wm),
    view("wm-sun-only", { ...wm, ambientScale: 0 }),
    view("wm-ambient-only", { ...wm, sunScale: 0 }),
    view("wm-flat-normal", { ...wm, flatGroundNormal: true }),
    view("wm-bright", { ...wm, sunScale: 3, ambientScale: 2 }),
    view("grazing-bright", { sun: [12, 20], sunScale: 3, ambientScale: 2 }),
    view("grazing-bright-flat-normal", {
      sun: [12, 20],
      sunScale: 3,
      ambientScale: 2,
      flatGroundNormal: true,
    }),
  );
}
// `rim`: pale camera-facing stone edges, lit by the hemisphere or the sun alone, with and
// without the ground normal map. (Lite shades hemispheric specular with its diffuse colour.)
if (process.argv[5] === "rim") {
  const close = { eye: [rx - 0.05, ry - 0.55, 0.32], target: [rx, ry + 0.05, 0.0], lens: 40 };
  views.splice(
    0,
    views.length,
    view("close-ambient-only", { ...close, sunScale: 0 }),
    view("close-ambient-only-flat-normal", { ...close, sunScale: 0, flatGroundNormal: true }),
    view("close-sun-only", { ...close, ambientScale: 0 }),
    view("close-sun-only-flat-normal", { ...close, ambientScale: 0, flatGroundNormal: true }),
  );
}
// `cost`: per-part 4K GPU attribution.
// `tex2048`: the same 4K views with the 4096 mip level withheld (512 texels/m).
if (process.argv[5] === "cost" || process.argv[5] === "tex2048") {
  const k = { width: 3840, height: 2160, tiles: wide, lodMode: "mixed", timingFrames: 180 };
  const near = {
    width: 3840,
    height: 2160,
    eye: [2.0, 0.25, 1.6],
    target: [2.05, 2.75, 0.0],
    lens: 30,
  };
  views.splice(
    0,
    views.length,
    view("walking-4k-mixed", k),
    view("close-4k", {
      ...near,
      eye: [rx - 0.05, ry - 0.55, 0.32],
      target: [rx, ry + 0.05, 0.0],
      lens: 40,
    }),
  );
  if (process.argv[5] === "cost")
    views.push(
      view("4k-ground-only", { ...k, hideParts: ["pebbles", "plants"] }),
      view("4k-no-plants", { ...k, hideParts: ["plants"] }),
      view("close", { eye: [rx - 0.05, ry - 0.55, 0.32], target: [rx, ry + 0.05, 0.0], lens: 40 }),
      // Last: after an empty caster list, later Lite frames rendered black in this preview.
      view("4k-empty", { ...k, hideParts: ["ground", "pebbles", "plants"] }),
    );
}
const maxTextureWidth = process.argv[5] === "tex2048" ? 2048 : undefined;
// `normal2048`: the default views with only the ground normal's 4096 level withheld.
const maxTextureWidthByRole =
  process.argv[5] === "normal2048" ? { "ground-normal": 2048 } : undefined;
// Levels as packed (candidate 7's ground normal starts at 2048²), not as authored in stage 2.
const textures = packReceipt.textures.map((t) => ({
  role: t.role,
  srgb: t.role.endsWith("basecolor"),
  levels: Array.from({ length: t.levels }, (_, level) => ({
    width: Math.max(1, t.width >> level),
    height: Math.max(1, t.height >> level),
  })),
}));
const parts = packReceipt.geometry.map((g) => ({ part: g.part, lod: g.lod }));
const lodBoundaries = { ground: [12, 32], pebbles: [6, 12], plants: [8, 24] };

const bundle = join(pack, "chrome-worker.js");
await build({
  entryPoints: [join(import.meta.dirname, "chrome-worker.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome152",
  outfile: bundle,
  nodePaths: [join(repo, "engine/node_modules")],
  logLevel: "warning",
});
await writeFile(join(pack, "index.html"), "<!doctype html><title>paving preview</title>\n");
const lite = JSON.parse(
  await readFile(join(repo, "engine/node_modules/@babylonjs/lite/package.json"), "utf8"),
);
const pin = await loadChromePin(join(repo, "harness/chrome/stable.json"));
const executable = await resolveChromeExecutablePath(repo, pin);
const executableSha256 = await validateChromeExecutable(pin, executable);
const server = createLocalServer({ root: pack });
const address = await listenLocalServer(server);
const origin = `http://127.0.0.1:${address.port}`;
const profile = await mkdtemp(join(tmpdir(), "parallax-paving-preview-"));
const context = await launchAfterPhysicalConsoleDisplayWake(() =>
  launchPersistentChrome(executable, profile),
);
const errors = [];
const external = [];
let result;
try {
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(m.text());
  });
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith(`${origin}/`)) await route.continue();
    else {
      external.push(url);
      await route.abort();
    }
  });
  await page.goto(`${origin}/index.html`);
  const adapter = await page.evaluate(async () => {
    const a = await navigator.gpu.requestAdapter();
    return {
      features: [...a.features].sort(),
      info: { vendor: a.info.vendor, architecture: a.info.architecture },
    };
  });
  result = await page.evaluate(
    async ({ workerUrl, request }) =>
      await new Promise((done, fail) => {
        const worker = new Worker(workerUrl, { type: "module" });
        const timer = setTimeout(() => fail(new Error("preview worker timed out")), 600_000);
        worker.onerror = (e) => fail(new Error(e.message));
        worker.onmessage = (event) => {
          clearTimeout(timer);
          worker.terminate();
          const data = event.data;
          if (data.status !== "passed") return fail(new Error(data.error));
          for (const f of data.frames) {
            const bytes = new Uint8Array(f.rgba);
            let s = "";
            for (let i = 0; i < bytes.length; i += 0x8000)
              s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            f.rgbaBase64 = btoa(s);
            delete f.rgba;
          }
          done(data);
        };
        worker.postMessage(request);
      }),
    {
      workerUrl: `${origin}/chrome-worker.js`,
      request: {
        origin,
        textures,
        parts,
        lodBoundaries,
        views,
        maxTextureWidth,
        maxTextureWidthByRole,
      },
    },
  );
  result.adapter = adapter;
} finally {
  await context.close();
  await stopLocalServer(server);
}
const png = (w, h, rgba) => {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};
const table = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(b) {
  let c = -1;
  for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
const quantile = (xs, q) => {
  const s = [...xs].filter((x) => x > 0).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null;
};
const summary = [];
for (const f of result.frames) {
  const rgba = Buffer.from(f.rgbaBase64, "base64");
  assert.equal(rgba.length, f.width * f.height * 4);
  const file = `${f.name}.png`;
  const bytes = png(f.width, f.height, rgba);
  await writeFile(join(out, file), bytes, { flag: "wx" });
  summary.push({
    view: f.name,
    file,
    sha256: hash(bytes),
    width: f.width,
    height: f.height,
    visibleTriangles: f.visibleTriangles,
    drawCalls: f.drawCalls,
    gpuFrameMs:
      f.gpuFrameMs.length > 0
        ? {
            samples: f.gpuFrameMs.length,
            p50: quantile(f.gpuFrameMs, 0.5),
            p95: quantile(f.gpuFrameMs, 0.95),
          }
        : null,
  });
}
const report = {
  scenario: "photoreal-paving-delivery-preview@1",
  budgetAuthority: "none: isolated worker preview, not the installed game",
  browser: { version: pin.version, executableSha256 },
  renderer: { package: "@babylonjs/lite", version: lite.version },
  adapter: result.adapter,
  workerBundleSha256: hash(await readFile(bundle)),
  packReceiptSha256: hash(await readFile(join(pack, "pack.json"))),
  uploadMs: Math.round(result.uploadMs),
  textureGpuBytes: result.textureGpuBytes,
  geometryDecodedBytes: result.geometryBytes,
  lodBoundaries,
  browserErrors: errors,
  externalRequests: external,
  views: summary,
};
await writeFile(join(out, "preview.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
console.log(
  JSON.stringify(
    { ...report, views: summary.map((s) => [s.view, s.visibleTriangles, s.gpuFrameMs]) },
    null,
    1,
  ),
);
