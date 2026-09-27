// Engine package 7: the game's lighting on white probes in pinned Chrome against calibrate.py's
// Cycles probes. Requires `pnpm build` (harness/dist).
// node probes.mjs <calibration.json> <out.json>
// probe-worker.ts renders each Cycles probe orientation at albedo 0.25 and 0 through the engine's
// PBR material, ambient, sun and AgX tone map. Here the captures are inverted through the CPU
// mirror of the tone map (and the exposure) to linear radiance, and the albedo-0 capture (the
// specular) is subtracted, leaving the diffuse term.
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

const [calibrationPath, outPath] = process.argv.slice(2, 4);
const calibration = JSON.parse(await readFile(calibrationPath, "utf8"));
const work = await mkdtemp(join(tmpdir(), "parallax-probes-"));
await build({
  entryPoints: [join(import.meta.dirname, "probe-worker.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome152",
  outfile: join(work, "probe-worker.js"),
  nodePaths: [join(repo, "engine/node_modules")],
  logLevel: "warning",
});
await build({
  entryPoints: [join(repo, "engine/src/render/tone-mapping.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: join(work, "tone-mapping.mjs"),
  external: ["@babylonjs/lite"],
  logLevel: "warning",
});
const { parallaxAgxDisplay } = await import(pathToFileURL(join(work, "tone-mapping.mjs")).href);
await writeFile(join(work, "index.html"), "<!doctype html><title>probes</title>\n");

// The day cases (the overcast diagnostic is not a game state), sky only and sun plus sky.
const probes = calibration.probes
  .filter((p) => p.case !== "wall-overcast-34")
  .flatMap((p) =>
    [true, false].map((skyOnly) => ({
      name: `${p.case}/${p.orientation}/${skyOnly ? "sky" : "total"}`,
      case: p.case,
      orientation: p.orientation,
      sun: [p.elevationDeg, p.azimuthDeg],
      normal: p.normal,
      skyOnly,
      cycles: skyOnly
        ? p.skyOnlyRadiance
        : p.sunOnlyRadiance.map((v, c) => v + p.skyOnlyRadiance[c]),
    })),
  );

const pin = await loadChromePin(join(repo, "harness/chrome/stable.json"));
const executable = await resolveChromeExecutablePath(repo, pin);
const executableSha256 = await validateChromeExecutable(pin, executable);
const server = createLocalServer({ root: work });
const address = await listenLocalServer(server);
const origin = `http://127.0.0.1:${address.port}`;
const profile = await mkdtemp(join(tmpdir(), "parallax-probes-profile-"));
const context = await launchAfterPhysicalConsoleDisplayWake(() =>
  launchPersistentChrome(executable, profile),
);
let results;
try {
  const page = await context.newPage();
  await page.goto(`${origin}/index.html`);
  results = await page.evaluate(
    async ({ workerUrl, probes }) =>
      await new Promise((done, fail) => {
        const worker = new Worker(workerUrl, { type: "module" });
        worker.onerror = (e) => fail(new Error(e.message));
        worker.onmessage = (event) => {
          worker.terminate();
          if (event.data.status !== "passed") fail(new Error(event.data.error));
          else done(event.data.results);
        };
        worker.postMessage({ probes });
      }),
    {
      workerUrl: `${origin}/probe-worker.js`,
      probes: probes.map(({ name, sun, normal, skyOnly }) => ({ name, sun, normal, skyOnly })),
    },
  );
} finally {
  await context.close();
  await stopLocalServer(server);
}

// Invert the display transform: Newton in log2 space on the CPU mirror (monotone per channel
// near the neutral axis), starting from the grey that matches the mean display value.
function linearFor(display) {
  let x = [0, 0, 0].map(() => Math.log2(0.18));
  for (let iteration = 0; iteration < 60; iteration++) {
    const f = parallaxAgxDisplay(x.map((v) => 2 ** v));
    const residual = f.map((v, c) => v - display[c]);
    if (Math.max(...residual.map(Math.abs)) < 1e-7) break;
    const J = [0, 1, 2].map((j) => {
      const step = x.map((v, k) => (k === j ? v + 1e-4 : v));
      return parallaxAgxDisplay(step.map((v) => 2 ** v)).map((v, c) => (v - f[c]) / 1e-4);
    });
    // Solve J^T-columns system: sum_j J[j][c] dx_j = -residual[c].
    const m = [0, 1, 2].map((c) => [J[0][c], J[1][c], J[2][c], -residual[c]]);
    for (let col = 0; col < 3; col++) {
      let pivot = col;
      for (let row = col + 1; row < 3; row++)
        if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
      [m[col], m[pivot]] = [m[pivot], m[col]];
      for (let row = 0; row < 3; row++) {
        if (row === col) continue;
        const k = m[row][col] / m[col][col];
        for (let i = col; i < 4; i++) m[row][i] -= k * m[col][i];
      }
    }
    x = x.map((v, j) => v + Math.max(-1, Math.min(1, m[j][3] / m[j][j])));
  }
  return x.map((v) => 2 ** v);
}

const measured = results.map((r, index) => {
  const probe = probes[index];
  for (const d of Object.values(r.display))
    if (d[0] > 0.98 && d[1] < 0.02 && d[2] > 0.98)
      throw new Error(`${r.name}: the capture shows the clear colour, not the probe`);
  const lit = linearFor(r.display[String(r.albedo)]).map((v) => v / r.exposure[String(r.albedo)]);
  const specular = linearFor(r.display["0"]).map((v) => v / r.exposure["0"]);
  return { ...probe, lit, specular, diffuse: lit.map((v, c) => (v - specular[c]) / r.albedo) };
});
// Sky only, relative to the case's up probe: the camera sees every probe along its normal, so
// Lite's Fresnel split of diffuse and specular is the same factor on all of them and cancels. This
// checks the shader's dome shape and ground bounce against Cycles (target: within 3%, 5% at the
// low sun).
const rows = [];
const worst = {};
for (const m of measured.filter((p) => p.skyOnly)) {
  const up = measured.find((p) => p.skyOnly && p.case === m.case && p.orientation === "up");
  const chrome = m.diffuse.map((v, c) => v / up.diffuse[c]);
  const cycles = m.cycles.map((v, c) => v / up.cycles[c]);
  const relative = chrome.map((v, c) => v / cycles[c] - 1);
  worst[m.case] = Math.max(worst[m.case] ?? 0, ...relative.map(Math.abs));
  rows.push({
    probe: `${m.case}/${m.orientation}`,
    chromeRelativeToUp: chrome.map((v) => +v.toFixed(4)),
    cyclesRelativeToUp: cycles.map((v) => +v.toFixed(4)),
    relative: relative.map((v) => +v.toFixed(4)),
  });
}
// Sun plus sky, absolute (informational): Lite's diffuse carries (1 - F), and the game's sun
// colour follows its own time-of-day model where the source keeps one sun colour.
const totals = measured
  .filter((p) => !p.skyOnly)
  .map((m) => ({
    probe: `${m.case}/${m.orientation}`,
    chrome: m.diffuse.map((v) => +v.toFixed(5)),
    cycles: m.cycles.map((v) => +v.toFixed(5)),
    relative: m.diffuse.map((v, c) => +(v / m.cycles[c] - 1).toFixed(4)),
  }));
const report = {
  scenario: "engine-package-7-white-probes@1",
  browser: { version: pin.version, executableSha256 },
  method:
    "albedo 0.25 minus albedo 0 (x8 exposure), each through the inverse AgX mirror and exposure",
  skyOnlyWorstRelativeByCase: worst,
  skyOnlyRelativeToUp: rows,
  totalsAbsolute: totals,
};
await writeFile(
  outPath,
  `${JSON.stringify(report, null, 1)}
`,
);
for (const row of rows)
  console.log(
    row.probe.padEnd(28),
    row.relative.map((v) => (v * 100).toFixed(1).padStart(6)).join(""),
  );
console.log(worst);
for (const row of totals)
  console.log(
    "total",
    row.probe.padEnd(28),
    row.relative.map((v) => (v * 100).toFixed(1).padStart(6)).join(""),
  );
