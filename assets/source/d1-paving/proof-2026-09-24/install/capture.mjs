// Courtyard captures and telemetry from the built game (dist) in pinned Chrome.
// Requires `pnpm build`. node capture.mjs <out dir> [--installed]
// Default: ?parallaxAutomation=runtime (network-authorized content, same streaming/decode/
// render path). --installed drives the ordinary OPFS install first (needs the local model
// shards from .parallax-toolchain.local.json).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repo = resolve(import.meta.dirname, "../../../../..");
const out = resolve(process.argv[2]);
const installed = process.argv.includes("--installed");
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
const hash = (b) => createHash("sha256").update(b).digest("hex");

// Tile-local source coordinates (x, y in [0,4], z up) -> world, for the tile centred at (cx, cz).
// Placement: world = (cx - X, height + Y, cz + Z) with glTF X = x - 2, Y = z, Z = 2 - y.
const cellFloor = 18.97375 + 0.021;
const tile = (cx, cz) => (p) => [cx - (p[0] - 2), cellFloor + p[2], cz + (2 - p[1])];
const view = (name, t, eye, target, environment) => {
  const e = t(eye);
  const g = t(target);
  const d = [e[0] - g[0], e[1] - g[1], e[2] - g[2]];
  const radius = Math.hypot(...d);
  // flythroughCameraPose: position = target + r(sinB cosA, cosB, sinB sinA), A = heading + PI.
  return {
    name,
    request: {
      observer: [g[0], g[1] - 0.01, g[2]],
      headingRadians: Math.atan2(d[2], d[0]) - Math.PI,
      camera: { beta: Math.acos(d[1] / radius), heightMeters: 0.01, radiusMeters: radius },
      environment,
    },
  };
};
const day = { timeOfDay: "daylight", timeOfDayPhase: 30 / 360, weather: "clear" };
const t11 = tile(6.05, 6.05);
const t22 = tile(10.05, 10.05);
// The source close-up rosette root, from the delivery's recorded plant geometry.
const rosette = [3.0926, 1.6931];
const views = [
  view("walking", t11, [2.0, 0.25, 1.6], [2.05, 2.75, 0.0], day),
  view("walking-matched", t11, [2.15, 0.3, 1.635], [2.05, 2.15, 0.0], day),
  view(
    "close",
    t22,
    [rosette[0] - 0.05, rosette[1] - 0.55, 0.32],
    [rosette[0], rosette[1] + 0.05, 0],
    day,
  ),
  view("joint", t11, [2.0, 1.3, 0.22], [2.05, 1.75, -0.01], day),
  view("grazing", t11, [2.0, 0.25, 1.6], [2.05, 2.75, 0.0], { ...day, timeOfDayPhase: 12 / 360 }),
  view("overcast", t11, [2.0, 0.25, 1.6], [2.05, 2.75, 0.0], { ...day, weather: "overcast" }),
  view("courtyard-overview", t11, [-3.5, -3.0, 4.5], [4.0, 4.0, 0.0], day),
  view("courtyard-far", t11, [-24.0, -18.0, 3.0], [6.0, 6.0, 0.0], day),
];

const source = await readSourceIdentity(repo);
const build = JSON.parse(await readFile(join(repo, "dist/build-manifest.json"), "utf8"));
const pin = await loadChromePin(join(repo, "harness/chrome/stable.json"));
const executable = await resolveChromeExecutablePath(repo, pin);
const executableSha256 = await validateChromeExecutable(pin, executable);
const server = createLocalServer({ root: join(repo, "dist") });
const address = await listenLocalServer(server);
const base = `http://127.0.0.1:${address.port}`;
const profile = await mkdtemp(join(tmpdir(), "parallax-paving-install-"));
const context = await launchAfterPhysicalConsoleDisplayWake(() =>
  launchPersistentChrome(executable, profile),
);
const errors = [];
const report = {
  scenario: "photoreal-paving-courtyard-capture@1",
  mode: installed ? "installed" : "privileged-network-runtime",
  budgetAuthority: "none: focused inspection, not a smoke or traversal gate",
  browser: { version: pin.version, executableSha256 },
  buildManifestSha256: hash(await readFile(join(repo, "dist/build-manifest.json"))),
  source,
  views: [],
};
try {
  const page = context.pages()[0] ?? (await context.newPage());
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  assert(!installed, "Installed mode is driven separately (install UI flow)");
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
      // Render-worker frame samples: whole-frame GPU EMA, CPU submit and PBR draw load.
      return globalThis.__PARALLAX_TELEMETRY__
        .snapshot()
        .render.recentFrames.slice(-60)
        .map((f) => ({
          gpuFrameEmaMs: f.rendering?.gpuFrameEmaMs ?? null,
          cpuSubmitMs: f.rendering?.cpuSubmitMs ?? null,
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
console.log(
  JSON.stringify({
    readyMs: report.readyMs,
    errors: errors.length,
    views: report.views.map((v) => v.name),
  }),
);
