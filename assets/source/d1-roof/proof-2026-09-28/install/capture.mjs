// K1 test house with its K2 roof: captures and telemetry from the built game (dist) in pinned
// Chrome (K2 delivery, house kit memory round). Derived from the K1 install capture
// (d1-walls/proof-2026-09-27/install/capture.mjs). Requires `pnpm build`. node capture.mjs <out dir>
// The house stands in cell 08-08 (game/src/world/district-1-walls.ts): a quarter turn, so a
// point (x, y, z) of the wall source (z up) is at world (8.5 - y, floor + z, 30.4 + x).
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
const cell = JSON.parse(await readFile(join(repo, "dist/immutable", cellName), "utf8")).cell;
const ground = (x, z) => sampleCellGroundHeight(cell.collision, x, z);

const floor = ground(8.9, 43.05) - 0.03;
const house = (p) => [8.5 - p[1], floor + p[2], 30.4 + p[0]];
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
// The sun crosses the sky along X; at 30 degrees it stands over the house's front (+X).
const day = { timeOfDay: "daylight", timeOfDayPhase: 30 / 360, weather: "clear" };
const low = { ...day, timeOfDayPhase: 12 / 360 };
const afternoon = { ...day, timeOfDayPhase: 140 / 360 };
// The K2 roof source's cameras (d1-roof/proof-2026-09-27 build.py VIEWS) and three of the wall
// source's, all in the shared house frame (z up).
const V = {
  gable: [
    [-7.5, -9.5, 1.7],
    [3.5, 1.5, 5.6],
  ],
  eave: [
    [13.9, -1.6, 4.3],
    [12.1, -0.3, 6.7],
  ],
  tile: [
    [5.75, -1.55, 7.45],
    [5.95, -0.3, 6.9],
  ],
  underside: [
    [5.0, -1.6, 1.7],
    [5.6, -0.25, 6.6],
  ],
  "roof-street": [
    [-4.0, -9.5, 1.7],
    [7.5, 1.0, 5.4],
  ],
  verge: [
    [-3.6, -2.4, 3.2],
    [-0.2, 1.6, 7.4],
  ],
  "roof-overview": [
    [17.5, -13.0, 11.0],
    [6.0, 2.5, 6.0],
  ],
  "overview-rear": [
    [-8.5, 18.0, 12.0],
    [6.0, 3.5, 6.0],
  ],
  ridgecheck: [
    [4.0, -1.0, 10.6],
    [5.5, 3.1, 9.6],
  ],
  front: [
    [3.0, -7.2, 1.75],
    [3.0, 0.0, 1.75],
  ],
  street: [
    [-1.2, -4.8, 1.7],
    [8.5, 0.3, 2.9],
  ],
  overview: [
    [17.5, -13.0, 6.0],
    [6.0, 2.0, 2.6],
  ],
};
const at = (name, environment, label = name) =>
  view(label, house(V[name][0]), house(V[name][1]), environment);
const views = [
  ...Object.keys(V).map((name) => at(name, day)),
  at("gable", low, "gable-low"),
  at("gable", afternoon, "gable-afternoon"),
  at("gable", { ...day, weather: "overcast" }, "gable-overcast"),
  // Past the house on foot, and from across the paving pad.
  view("approach", [20, ground(20, 36) + 1.7, 36], house([6, 3, 4.5]), day),
  view("from-pad", [8, ground(8, 8) + 1.7, 8], house([6, 3, 4.5]), day),
];

const source = await readSourceIdentity(repo);
const build = JSON.parse(await readFile(join(repo, "dist/build-manifest.json"), "utf8"));
const pin = await loadChromePin(join(repo, "harness/chrome/stable.json"));
const executable = await resolveChromeExecutablePath(repo, pin);
const executableSha256 = await validateChromeExecutable(pin, executable);
const server = createLocalServer({ root: join(repo, "dist") });
const address = await listenLocalServer(server);
const base = `http://127.0.0.1:${address.port}`;
const profile = await mkdtemp(join(tmpdir(), "parallax-k1-house-"));
const context = await launchAfterPhysicalConsoleDisplayWake(() =>
  launchPersistentChrome(executable, profile),
);
const errors = [];
const report = {
  scenario: "k1-test-house-capture@1",
  mode: "privileged-network-runtime",
  budgetAuthority: "none: focused inspection, not a smoke or traversal gate",
  browser: { version: pin.version, executableSha256 },
  buildManifestSha256: hash(await readFile(join(repo, "dist/build-manifest.json"))),
  houseCell: cellName,
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
} catch (error) {
  // Record where the game stood when a capture fails (the render stall, K1 step 2).
  const page = context.pages()[0];
  const state = await page
    ?.evaluate(() => {
      const s = globalThis.__PARALLAX_TELEMETRY__?.snapshot();
      const r = s?.render ?? {};
      return {
        streaming: s?.streaming,
        render: Object.fromEntries(
          Object.entries(r)
            .filter(([k]) => k !== "recentFrames")
            .map(([k, v]) => [k, v]),
        ),
      };
    })
    .catch((e) => String(e));
  await writeFile(
    join(out, "failure-state.json"),
    JSON.stringify({ browserErrors: errors, state }, null, 1),
  );
  console.error(`Capture failed; state in ${join(out, "failure-state.json")}`);
  throw error;
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
