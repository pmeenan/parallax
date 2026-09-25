// Terrain-conforming courtyard captures and telemetry from the built game (dist) in pinned
// Chrome (engine package 4). Requires `pnpm build`. node capture.mjs <out dir>
// Cameras stand on the rolling ground: heights are read from the built cell's own terrain
// detail field, the same bilinear surface that collision and the GPU drape use.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repo = resolve(import.meta.dirname, "../../../../..");
const out = resolve(process.argv[2]);
await mkdir(out, { recursive: false });
const harness = (name) =>
  import(pathToFileURL(join(repo, "harness/dist/types", `${name}.js`)).href);
const { createLocalServer, listenLocalServer, stopLocalServer } = await harness("server");
const {
  launchPersistentChrome,
  loadChromePin,
  resolveChromeExecutablePath,
  validateChromeExecutable,
} = await harness("chrome-pin");
const { launchAfterPhysicalConsoleDisplayWake } = await harness("physical-console-preflight");
const { readSourceIdentity } = await harness("source-identity");
const { sampleCellGroundHeight } = await import(
  pathToFileURL(join(repo, "engine/src/world/terrain-surface.ts")).href
);
const hash = (b) => createHash("sha256").update(b).digest("hex");

const cellName = (await readdir(join(repo, "dist/immutable"))).find((name) =>
  name.startsWith("district-1-surface-cell-08-08-"),
);
assert(cellName, "Built courtyard cell is missing");
const courtyard = JSON.parse(await readFile(join(repo, "dist/immutable", cellName), "utf8")).cell;
assert(courtyard.collision.detail, "Courtyard cell has no terrain detail field");
const ground = (x, z) => sampleCellGroundHeight(courtyard.collision, x, z);

// Tile-local source coordinates (x, y in [0,4], z up) -> world, for the tile centred at (cx, cz):
// world = (cx - X, ground + offset + z, cz + Z) with glTF X = x - 2, Z = 2 - y.
const offset = 0.021;
const tile = (cx, cz) => (p) => {
  const x = cx - (p[0] - 2);
  const z = cz + (2 - p[1]);
  return [x, ground(x, z) + offset + p[2], z];
};
const world = (x, z, above) => [x, ground(x, z) + above, z];
const view = (name, eye, target, environment) => {
  const d = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]];
  const radius = Math.hypot(...d);
  // flythroughCameraPose: position = target + r(sinB cosA, cosB, sinB sinA), A = heading + PI.
  return {
    name,
    request: {
      observer: [target[0], target[1] - 0.01, target[2]],
      headingRadians: Math.atan2(d[2], d[0]) - Math.PI,
      camera: { beta: Math.acos(d[1] / radius), heightMeters: 0.01, radiusMeters: radius },
      environment,
    },
  };
};
const day = { timeOfDay: "daylight", timeOfDayPhase: 30 / 360, weather: "clear" };
const low = { ...day, timeOfDayPhase: 12 / 360 };
const t11 = tile(6.05, 6.05);
const t22 = tile(10.05, 10.05);
const rosette = [3.0926, 1.6931];
const views = [
  // The install package's views, now standing on the rolling ground.
  view("walking", t11([2.0, 0.25, 1.6]), t11([2.05, 2.75, 0.0]), day),
  view("walking-matched", t11([2.15, 0.3, 1.635]), t11([2.05, 2.15, 0.0]), day),
  view(
    "close",
    t22([rosette[0] - 0.05, rosette[1] - 0.55, 0.32]),
    t22([rosette[0], rosette[1] + 0.05, 0]),
    day,
  ),
  view("joint", t11([2.0, 1.3, 0.22]), t11([2.05, 1.75, -0.01]), day),
  view("grazing", t11([2.0, 0.25, 1.6]), t11([2.05, 2.75, 0.0]), low),
  view("overcast", t11([2.0, 0.25, 1.6]), t11([2.05, 2.75, 0.0]), { ...day, weather: "overcast" }),
  view("courtyard-overview", t11([-3.5, -3.0, 4.5]), t11([4.0, 4.0, 0.0]), day),
  view("courtyard-far", t11([-24.0, -18.0, 3.0]), t11([6.0, 6.0, 0.0]), day),
  // Rolling ground: a low eye across the courtyard, the crest and dip, and the paving edge.
  view("rolling-across", world(-3, 8, 1.2), world(16, 8, 0), day),
  view("rolling-grazing", world(8, -3, 0.9), world(8, 16, 0), low),
  view("crest", world(1.5, 12.5, 0.8), world(0.5, 16, 0), day),
  view("dip", world(13.5, 3.5, 0.8), world(16, 0.5, 0), low),
  view("edge-seam", world(18.5, 5, 0.7), world(15.5, 7, 0), day),
  // Lighting states that must stay readable (engine package 5): dusk, night and storm.
  ...(process.argv.includes("--lighting-states")
    ? [
        view("dusk", t11([2.0, 0.25, 1.6]), t11([2.05, 2.75, 0.0]), {
          ...day,
          timeOfDay: "dusk",
          timeOfDayPhase: 176 / 360,
        }),
        view("night", t11([2.0, 0.25, 1.6]), t11([2.05, 2.75, 0.0]), {
          ...day,
          timeOfDay: "night",
          timeOfDayPhase: 0.75,
        }),
        view("storm", t11([2.0, 0.25, 1.6]), t11([2.05, 2.75, 0.0]), { ...day, weather: "storm" }),
      ]
    : []),
];

const source = await readSourceIdentity(repo);
const build = JSON.parse(await readFile(join(repo, "dist/build-manifest.json"), "utf8"));
const pin = await loadChromePin(join(repo, "harness/chrome/stable.json"));
const executable = await resolveChromeExecutablePath(repo, pin);
const executableSha256 = await validateChromeExecutable(pin, executable);
const server = createLocalServer({ root: join(repo, "dist") });
const address = await listenLocalServer(server);
const base = `http://127.0.0.1:${address.port}`;
const profile = await mkdtemp(join(tmpdir(), "parallax-paving-conform-"));
const context = await launchAfterPhysicalConsoleDisplayWake(() =>
  launchPersistentChrome(executable, profile),
);
const errors = [];
const report = {
  scenario: "terrain-conforming-paving-capture@1",
  mode: "privileged-network-runtime",
  budgetAuthority: "none: focused inspection, not a smoke or traversal gate",
  browser: { version: pin.version, executableSha256 },
  buildManifestSha256: hash(await readFile(join(repo, "dist/build-manifest.json"))),
  courtyardCell: cellName,
  source,
  views: [],
};
try {
  const page = context.pages()[0] ?? (await context.newPage());
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(`${base}/?parallaxAutomation=runtime`);
  const readyStart = Date.now();
  await page.waitForFunction(
    () => {
      const s = globalThis.__PARALLAX_TELEMETRY__?.snapshot();
      return (
        s?.render.state === "ready" &&
        s.simulation.state === "running" &&
        s.streaming.state === "streaming"
      );
    },
    undefined,
    { timeout: 120_000 },
  );
  report.readyMs = Date.now() - readyStart;
  for (const v of views) {
    const evidence = await page.evaluate(
      (request) => globalThis.__PARALLAX_TELEMETRY__.previewScene(request),
      v.request,
    );
    // Let CSM and streaming settle, then sample frame timing while the view holds.
    const samples = await page.evaluate(async () => {
      for (let i = 0; i < 120; i++) await new Promise((r) => requestAnimationFrame(r));
      return globalThis.__PARALLAX_TELEMETRY__
        .snapshot()
        .render.recentFrames.slice(-60)
        .map((f) => ({
          gpuFrameEmaMs: f.rendering?.gpuFrameEmaMs ?? null,
          cpuSubmitMs: f.rendering?.cpuSubmitMs ?? null,
          shadowTaskGpuMs: f.rendering?.shadowTaskGpuMs ?? null,
          pbrVisibleTriangles: f.rendering?.pbrAssets?.visibleTriangleCount ?? null,
          durationMs: f.durationMs ?? null,
        }));
    });
    const file = `${v.name}.png`;
    const png = await page
      .locator("canvas")
      .first()
      .screenshot({ path: join(out, file) });
    report.views.push({
      name: v.name,
      file,
      sha256: hash(png),
      request: v.request,
      visiblePixelRatio: evidence.visiblePixelRatio,
      evidence,
      frames: samples,
    });
  }
  const snapshot = await page.evaluate(() => globalThis.__PARALLAX_TELEMETRY__.snapshot());
  await writeFile(join(out, "telemetry.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
  await page.evaluate(() => globalThis.__PARALLAX_TELEMETRY__.endScenePreview());
} finally {
  await context.close();
  await stopLocalServer(server);
}
report.browserErrors = errors;
report.buildArtifacts = build.artifacts.length;
await writeFile(join(out, "capture.json"), `${JSON.stringify(report, null, 2)}\n`);
const median = (values) => {
  const sorted = values.filter((v) => v !== null).sort((a, b) => a - b);
  return sorted.length === 0 ? null : sorted[Math.floor(sorted.length / 2)];
};
console.log(
  JSON.stringify({
    readyMs: report.readyMs,
    errors,
    views: report.views.map((v) => ({
      name: v.name,
      gpuP50: median(v.frames.map((f) => f.gpuFrameEmaMs)),
      shadowP50: median(v.frames.map((f) => f.shadowTaskGpuMs)),
    })),
  }),
);
