// Pinned-Chrome Babylon Lite inspection of the K1 wall delivery candidate.
// Requires `pnpm build` (harness/dist).
// node chrome-preview.mjs <root> <geometry dir> <textures dir> <out dir> [views|cost|lod|matched|...]
// Directories are relative to <root>, which the preview serves. <textures dir> is a pack.mjs
// output (GPU-ready BC1/BC7 KTX2, as shipped) or a maps.py output (RGBA8 mips, for quick
// iteration only). Renders the test house on the admitted D1 paving with chrome-worker.ts and
// writes PNGs plus preview.json (triangles, draw calls, GPU frame time). Timings are
// isolated-preview diagnostics on this machine, not budget evidence.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
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

const root = resolve(process.argv[2]);
const [geometryDir, texturesDir, outDir] = process.argv.slice(3, 6);
const mode = process.argv[6] ?? "views";
const out = join(root, outDir);
await mkdir(out, { recursive: false });
const hash = (b) => createHash("sha256").update(b).digest("hex");
const geometry = JSON.parse(await readFile(join(root, geometryDir, "geometry.json"), "utf8"));
const packed = await stat(join(root, texturesDir, "pack.json")).then(
  () => true,
  () => false,
);
const textureReceipt = JSON.parse(
  await readFile(join(root, texturesDir, packed ? "pack.json" : "maps.json"), "utf8"),
);

// ---------------------------------------------------------------- textures and materials
const textures = [];
const materials = {};
const mapList = packed ? textureReceipt.textures : textureReceipt.maps;
for (const m of mapList)
  textures.push(
    packed
      ? { role: m.role, srgb: m.srgb, format: m.format, ktx2: `${texturesDir}/${m.ktx2.path}` }
      : {
          role: m.role,
          srgb: m.srgb,
          format: "rgba8",
          mips: m.levels.map((l) => ({
            file: `${texturesDir}/${l.file}`,
            width: l.width,
            height: l.height,
          })),
        },
  );
for (const [name, m] of Object.entries(textureReceipt.materials)) {
  const range = m.ormHeightRangeMetres;
  materials[name] = {
    baseColor: `${name}-basecolor`,
    normal: `${name}-normal`,
    orm: `${name}-orm`,
    address: m.textureAddressMode,
    metallicFactor: m.metallicFactor ?? 0,
    heightRangeMeters: range ? range[1] - range[0] : 0,
  };
}

// ---------------------------------------------------------------- the admitted paving underfoot
const paving = JSON.parse(await readFile(join(repo, "assets/library/d1-paving.json"), "utf8"));
const pavingServe = join(root, "paving-library");
await mkdir(pavingServe, { recursive: true });
const pavingFile = {};
for (const r of paving.resources) {
  const target = join(pavingServe, r.file);
  if (!(await stat(target).catch(() => null)))
    await copyFile(join(repo, "assets/library", r.path), target);
  pavingFile[r.role] = `paving-library/${r.file}`;
}
for (const [role, t] of Object.entries(paving.textures))
  textures.push({
    role: `paving-${role}`,
    srgb: t.colorSpace === "srgb",
    format: t.encoding,
    ktx2: pavingFile[role],
  });
for (const [name, m] of Object.entries(paving.materials))
  materials[`paving-${name}`] = {
    baseColor: `paving-${m.baseColor}`,
    normal: `paving-${m.normal}`,
    orm: `paving-${m.orm}`,
    address: m.textureAddressMode,
    metallicFactor: m.metallicFactor,
    heightRangeMeters: m.ormHeightRangeMetres
      ? m.ormHeightRangeMetres[1] - m.ormHeightRangeMetres[0]
      : 0,
  };

// ---------------------------------------------------------------- instances (LH world)
// F mirrors glTF X into Lite's left-handed world, as every PBR instance matrix does.
const F = (m) => m.map((v, i) => (i % 4 === 0 ? -v : v));
const translation = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const centreOf = (bounds) => bounds[0].map((v, i) => (v + bounds[1][i]) / 2);
const WALL_LODS = [12, 40];
const meshes = [];
for (const m of geometry.meshes) {
  const instances =
    m.piece === null
      ? [F(translation(0, 0, 0))]
      : geometry.placements.filter((p) => p.piece === m.piece).map((p) => F(p.matrix));
  if (instances.length === 0) continue;
  meshes.push({
    key: m.object,
    material: m.material,
    lods: m.lods.map((l) => ({
      vertices: `${geometryDir}/decoded/${m.object}-lod${l.lod}.vertices`,
      indices: `${geometryDir}/decoded/${m.object}-lod${l.lod}.indices`,
    })),
    instances,
    // The soil strip's millimetres of relief stay out of the CSM, as the paving's do.
    castsShadows: m.material !== "soil",
    lodBoundaries: WALL_LODS,
    centre: centreOf(m.lods[0].bounds),
  });
}
// The source's 8 x 6 paving tiles: origins at (-12.37 + 4i, -15.79 + 4j), ground 20.7 mm down.
const tiles = [];
for (let i = 0; i < 8; i++)
  for (let j = 0; j < 6; j++)
    tiles.push(F(translation(-12.37 + 4 * i + 2, -0.0207, -(-15.79 + 4 * j + 2))));
const PAVING_LODS = { ground: [12, 32], pebbles: [6, 12], plants: [8, 24] };
for (const [part, p] of Object.entries(paving.parts))
  meshes.push({
    key: `paving-${part}`,
    material: `paving-${p.material}`,
    lods: p.lods.map((l) => ({
      vertices: pavingFile[l.vertexRole],
      indices: pavingFile[l.indexRole],
      meshopt: { vertices: l.vertices, indices: l.triangles * 3 },
    })),
    instances: tiles,
    castsShadows: part === "plants",
    lodBoundaries: PAVING_LODS[part],
    centre: centreOf(p.lods[0].bounds),
  });

// ---------------------------------------------------------------- views (build.py's cameras)
const KEY = [38, -35];
const view = (name, o) => ({
  name,
  width: 1536,
  height: 1024,
  sun: KEY,
  weather: "clear",
  lodMode: "lod0",
  timingFrames: 0,
  ...o,
});
const V = {
  front: { eye: [3.0, -7.2, 1.75], target: [3.0, 0.0, 1.75], lens: 38 },
  corner: {
    eye: [13.75, -1.95, 0.55],
    target: [12.1, 0.2, 1.05],
    lens: 28,
    width: 1312,
    height: 1200,
  },
  junction: { eye: [1.85, -0.95, 0.92], target: [2.05, 0.0, 0.74], lens: 38 },
  // The delivery's extreme range (source_views.py renders the source here): 0.25 m across a
  // front ground post's check and the plaster loss beside it.
  close: { eye: [2.0, -0.34, 2.4], target: [2.02, 0.0, 2.35], lens: 42 },
  oak: { eye: [11.25, -1.55, 2.95], target: [11.7, 0.0, 3.0], lens: 40, width: 1312, height: 1200 },
  window: { eye: [4.5, -1.7, 1.75], target: [3.1, 0.0, 1.95], lens: 35 },
  street: { eye: [-1.2, -4.8, 1.7], target: [8.5, 0.3, 2.9], lens: 26 },
  overview: { eye: [17.5, -13.0, 6.0], target: [6.0, 2.0, 2.6], lens: 30 },
};
let views = [
  ...Object.entries(V).map(([name, v]) => view(name, v)),
  // The source's overcast diagnostic: the clear sky at x3 with the sun off (not a weather state).
  view("overcast", { ...V.street, sun: [34, -35], sunScale: 0, ambientScale: 3 }),
  view("low", { ...V.front, sun: [12, -150] }),
  // The mirrored right facade and the far read (atlas mip bleed).
  view("right", { eye: [18.5, 3.1, 1.7], target: [12.25, 3.1, 2.4], lens: 30 }),
  // The front-left corner, fixed in source candidate 19.
  view("corner-left", { eye: [-1.6, -1.8, 2.2], target: [0.1, 0.1, 2.0], lens: 30 }),
  view("far", { eye: [6.0, -38.0, 2.0], target: [6.0, 0.0, 3.0], lens: 50, lodMode: "mixed" }),
];
if (mode === "shadow")
  views = ["front", "window", "junction", "oak", "close"].map((n) => view(n, V[n]));
if (mode === "decomp")
  views = [
    view("sun-only", { ...V.front, width: 768, height: 512, ambientScale: 0 }),
    view("sky-only", { ...V.front, width: 768, height: 512, sunScale: 0 }),
  ];
// The paving joint under a grazing and a normal sun, for the micro-shadow engine change's A/B.
if (mode === "paving")
  views = [
    view("paving-joint-12", {
      eye: [4.0, -4.0, 0.22],
      target: [4.4, -3.4, -0.01],
      lens: 45,
      sun: [12, -35],
    }),
    view("paving-joint-38", { eye: [4.0, -4.0, 0.22], target: [4.4, -3.4, -0.01], lens: 45 }),
    view("paving-walk-30", {
      eye: [5.0, -6.0, 1.6],
      target: [5.2, -3.5, 0.0],
      lens: 30,
      sun: [30, -35],
    }),
  ];
// The source's views at its fixed exposure (the game adapts: 0.91 at 38°, 1.5 at 12°), for the
// lighting calibration's matched comparison (engine package 7).
// The close view split into sun and sky, to attribute close-range artefacts to a light term.
if (mode === "close-decomp")
  views = [
    view("close-sun", { ...V.close, ambientScale: 0 }),
    view("close-sky", { ...V.close, sunScale: 0 }),
  ];
// The junction under the sun alone (source_views.py's junction-sun), at the source's exposure.
if (mode === "junction-sun")
  views = [view("junction-sun", { ...V.junction, ambientScale: 0, exposure: 1 })];
if (mode === "matched")
  views = views
    .filter((v) => ["front", "junction", "overcast", "low", "street", "window"].includes(v.name))
    .map((v) => ({ ...v, exposure: 1 }));
if (mode === "shaders") views = [view("front", { ...V.front, width: 512, height: 342 })];
if (mode === "corner-lods")
  views = ["lod0", "lod1", "lod2"].map((lodMode) =>
    view(`corner-fl-${lodMode}`, {
      eye: [-1.6, -1.8, 2.2],
      target: [0.1, 0.1, 2.0],
      lens: 30,
      lodMode,
    }),
  );
if (mode === "corner-debug") {
  const cam = { eye: [-1.6, -1.8, 2.2], target: [0.1, 0.1, 2.0], lens: 30 };
  views = [
    view("lod0-no-interior", { ...cam, lodMode: "lod0", hide: ["interior"] }),
    view("lod1-only-interior", {
      ...cam,
      lodMode: "lod1",
      hide: [
        "g-",
        "u-",
        "corner",
        "plaster",
        "iron",
        "glass",
        "plinth",
        "mortar",
        "soil",
        "FootPlants",
        "paving-",
      ],
    }),
    view("lod0-only-interior", {
      ...cam,
      lodMode: "lod0",
      hide: [
        "g-",
        "u-",
        "corner",
        "plaster",
        "iron",
        "glass",
        "plinth",
        "mortar",
        "soil",
        "FootPlants",
        "paving-",
      ],
    }),
  ];
}
if (mode === "lod")
  views = [
    view("street-lod0", { ...V.street, eye: [-6, -20, 1.7], target: [6, 0, 3], lens: 45 }),
    view("street-mixed", {
      ...V.street,
      eye: [-6, -20, 1.7],
      target: [6, 0, 3],
      lens: 45,
      lodMode: "mixed",
    }),
    view("far-lod0", { eye: [6.0, -38.0, 2.0], target: [6.0, 0.0, 3.0], lens: 50 }),
    view("far-mixed", {
      eye: [6.0, -38.0, 2.0],
      target: [6.0, 0.0, 3.0],
      lens: 50,
      lodMode: "mixed",
    }),
  ];
if (mode === "cost") {
  const k = { width: 3840, height: 2160, lodMode: "mixed", timingFrames: 180 };
  views = [
    // Discarded: the first timed view follows the upload and pipeline creation.
    view("warmup-4k", { ...V.street, ...k }),
    view("street-4k", { ...V.street, ...k }),
    view("overview-4k", { ...V.overview, ...k }),
    view("junction-4k", { ...V.junction, ...k }),
    view("street-4k-paving-only", {
      ...V.street,
      ...k,
      hide: [
        "g-",
        "u-",
        "corner",
        "plaster",
        "iron",
        "glass",
        "plinth",
        "mortar",
        "soil",
        "FootPlants",
        "interior",
      ],
    }),
    view("street-4k-walls-only", { ...V.street, ...k, hide: ["paving-"] }),
  ];
}

// ---------------------------------------------------------------- run
const bundle = join(out, "chrome-worker.js");
await build({
  // WALL_PREVIEW_WORKER: a worker copy against other engine sources (the PSO pin check).
  entryPoints: [process.env.WALL_PREVIEW_WORKER ?? join(import.meta.dirname, "chrome-worker.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome152",
  outfile: bundle,
  nodePaths: [join(repo, "engine/node_modules")],
  logLevel: "warning",
});
await writeFile(join(out, "index.html"), "<!doctype html><title>wall preview</title>\n");
const lite = JSON.parse(
  await readFile(join(repo, "engine/node_modules/@babylonjs/lite/package.json"), "utf8"),
);
const pin = await loadChromePin(join(repo, "harness/chrome/stable.json"));
const executable = await resolveChromeExecutablePath(repo, pin);
const executableSha256 = await validateChromeExecutable(pin, executable);
const server = createLocalServer({ root });
const address = await listenLocalServer(server);
const origin = `http://127.0.0.1:${address.port}`;
const profile = await mkdtemp(join(tmpdir(), "parallax-wall-preview-"));
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
  await page.goto(`${origin}/${outDir}/index.html`);
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
        const timer = setTimeout(() => fail(new Error("preview worker timed out")), 1_200_000);
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
      workerUrl: `${origin}/${outDir}/chrome-worker.js`,
      request: { origin, textures, materials, meshes, views },
    },
  );
  result.adapter = adapter;
} finally {
  await context.close();
  await stopLocalServer(server);
}

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
  scenario: "k1-wall-delivery-preview@1",
  budgetAuthority: "none: isolated worker preview, not the installed game",
  browser: { version: pin.version, executableSha256 },
  renderer: { package: "@babylonjs/lite", version: lite.version },
  adapter: result.adapter,
  textureSource: packed ? "pack (GPU-ready BC1/BC7 KTX2)" : "maps (RGBA8 mips, iteration only)",
  workerBundleSha256: hash(await readFile(bundle)),
  geometryReceiptSha256: hash(await readFile(join(root, geometryDir, "geometry.json"))),
  textureReceiptSha256: hash(
    await readFile(join(root, texturesDir, packed ? "pack.json" : "maps.json")),
  ),
  uploadMs: Math.round(result.uploadMs),
  textureGpuBytes: result.textureGpuBytes,
  textureGpuBytesTotal: Object.values(result.textureGpuBytes).reduce((a, b) => a + b, 0),
  geometryDecodedBytes: result.geometryBytes,
  lodBoundaries: { walls: WALL_LODS, paving: PAVING_LODS },
  shaders: result.shaders,
  browserErrors: errors,
  externalRequests: external,
  views: summary,
};
await writeFile(join(out, "preview.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
console.log(
  JSON.stringify(
    {
      ...report,
      textureGpuBytes: undefined,
      shaders: undefined,
      views: summary.map((s) => [s.view, s.visibleTriangles, s.drawCalls, s.gpuFrameMs]),
    },
    null,
    1,
  ),
);
