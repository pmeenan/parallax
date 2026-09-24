import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sha256, validateAnimationSource } from "@parallax/assets/animation";
import { importAnimationCandidate } from "@parallax/assets/animation-candidate";
import { createAnimationFixture, encodeFixtureGlb } from "@parallax/assets/animation-fixture";
import { build } from "esbuild";
import sharp from "sharp";
import type { AnimationImportWorkerRequest } from "../../engine/src/assets/animation-import-worker.js";
import { readChromeCommandLine } from "./browser-probes.js";
import {
  launchPersistentChrome,
  loadChromePin,
  resolveChromeExecutablePath,
  validateChromeBrowserIdentity,
  validateChromeExecutable,
  validateChromeSandboxCommandLine,
} from "./chrome-pin.js";
import { launchAfterPhysicalConsoleDisplayWake } from "./physical-console-preflight.js";
import { createLocalServer, listenLocalServer, stopLocalServer } from "./server.js";
import { readSourceIdentity } from "./source-identity.js";

interface WorkerResult {
  status: string;
  error?: string;
  importDurationMs: number;
  meshes: number;
  joints: string[];
  frames: {
    clip: string;
    sample: number;
    timeSeconds: number;
    rgbaBase64: string;
    width: number;
    height: number;
  }[];
}

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const [candidateArgument, ...extra] = process.argv.slice(2);
assert(
  candidateArgument !== undefined && extra.length === 0,
  "Usage: pnpm harness:animation-import <candidate-directory|--fixture>",
);
const output = join(
  repositoryRoot,
  "harness/results",
  `animation-import-${new Date().toISOString().replace(/[:.]/gu, "-")}`,
);
await mkdir(output);
const report: Record<string, unknown> = {
  schemaVersion: 1,
  scenario: "animation-source-import@1",
  verdict: "running",
  budget: "not-evaluated",
};
const persist = async (): Promise<void> => {
  await writeFile(join(output, "result.json"), `${JSON.stringify(report, null, 2)}\n`);
};
await persist();
try {
  let candidateDirectory = resolve(candidateArgument);
  if (candidateArgument === "--fixture") {
    const fixture = createAnimationFixture();
    const sourcePath = join(output, "fixture.glb"),
      profilePath = join(output, "fixture-profile.json");
    await writeFile(sourcePath, encodeFixtureGlb(fixture.json, fixture.binary));
    await writeFile(profilePath, `${JSON.stringify(fixture.profile, null, 2)}\n`);
    candidateDirectory = join(output, "candidate");
    await importAnimationCandidate(
      sourcePath,
      profilePath,
      candidateDirectory,
      join(repositoryRoot, "harness/results"),
    );
  }
  const manifestBytes = await readFile(join(candidateDirectory, "candidate.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
    schemaVersion: number;
    status: string;
    rigSha256: string;
    source: { file: string; sha256: string; bytes: number };
    profile: { file: string; sha256: string };
    validation: { file: string; sha256: string };
  };
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.status, "source-validated-admission-pending");
  assert.match(manifest.source.file, /^[a-f0-9]{64}\.glb$/u);
  assert.equal(manifest.source.file, `${manifest.source.sha256}.glb`);
  assert.equal(manifest.profile.file, "profile.json");
  assert.equal(manifest.validation.file, "validation.json");
  const bytes = await readFile(join(candidateDirectory, manifest.source.file));
  const profileBytes = await readFile(join(candidateDirectory, manifest.profile.file));
  assert.equal(bytes.length, manifest.source.bytes);
  assert.equal(sha256(bytes), manifest.source.sha256);
  assert.equal(sha256(profileBytes), manifest.profile.sha256);
  assert.equal(
    sha256(await readFile(join(candidateDirectory, manifest.validation.file))),
    manifest.validation.sha256,
  );
  const assessment = await validateAnimationSource(
    bytes,
    JSON.parse(profileBytes.toString("utf8")) as unknown,
  );
  assert.equal(assessment.rigSha256, manifest.rigSha256);
  const packageBytes = await readFile(
    join(repositoryRoot, "engine/node_modules/@babylonjs/lite/package.json"),
  );
  const renderer = JSON.parse(packageBytes.toString("utf8")) as { version: string };
  assert.equal(
    renderer.version,
    "1.31.1",
    "Requalify animation import when the renderer pin changes",
  );
  const source = await readSourceIdentity(repositoryRoot);
  const bundleDirectory = await mkdtemp(join(tmpdir(), "parallax-animation-import-bundle-"));
  const workerPath = join(bundleDirectory, "worker.js");
  await build({
    entryPoints: [join(repositoryRoot, "engine/src/assets/animation-import-worker.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome152",
    outfile: workerPath,
    logLevel: "silent",
  });
  const pin = await loadChromePin(join(repositoryRoot, "harness/chrome/stable.json"));
  const executable = await resolveChromeExecutablePath(repositoryRoot, pin);
  const executableSha256 = await validateChromeExecutable(pin, executable);
  Object.assign(report, {
    source,
    candidateSha256: sha256(manifestBytes),
    candidateDirectory,
    sourceSha256: manifest.source.sha256,
    rigSha256: assessment.rigSha256,
    renderer: { version: renderer.version, packageSha256: sha256(packageBytes) },
    probeBundleSha256: sha256(await readFile(workerPath)),
    browser: { version: pin.version, executableSha256 },
    assessment,
  });
  await persist();
  const server = createLocalServer({ root: bundleDirectory });
  const address = await listenLocalServer(server);
  try {
    const profilePath = await mkdtemp(join(tmpdir(), "parallax-animation-import-chrome-"));
    const context = await launchAfterPhysicalConsoleDisplayWake(() =>
      launchPersistentChrome(executable, profilePath),
    );
    try {
      validateChromeSandboxCommandLine(await readChromeCommandLine(context));
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      validateChromeBrowserIdentity(pin, await cdp.send("Browser.getVersion"));
      const origin = `http://127.0.0.1:${address.port}`;
      const browserErrors: string[] = [],
        externalRequests: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      await context.route("**/*", async (route) => {
        const url = route.request().url();
        if (url.startsWith(`${origin}/`)) await route.continue();
        else {
          externalRequests.push(url);
          await route.abort();
        }
      });
      await page.goto(`${origin}/__parallax/identity`);
      const minimum = assessment.statistics.restBounds.minimum,
        maximum = assessment.statistics.restBounds.maximum;
      const center = [0, 1, 2].map((axis) => ((minimum[axis] ?? 0) + (maximum[axis] ?? 0)) / 2);
      // Lite reflects glTF X on import; fit the rest bounds, without asserting animated bounds.
      const camera: AnimationImportWorkerRequest["camera"] = {
        target: [-(center[0] ?? 0), center[1] ?? 0, center[2] ?? 0],
        radius: Math.max(
          0.25,
          Math.hypot(...[0, 1, 2].map((axis) => (maximum[axis] ?? 0) - (minimum[axis] ?? 0))) * 1.6,
        ),
      };
      const result = await page.evaluate(
        async ({ bytesBase64, expected, camera, workerUrl }) => {
          const bytes = Uint8Array.from(atob(bytesBase64), (character) =>
            character.charCodeAt(0),
          ).buffer;
          return await new Promise<WorkerResult>((resolve, reject) => {
            const worker = new Worker(workerUrl, { type: "module" });
            const timer = setTimeout(() => {
              worker.terminate();
              reject(new Error("Animation worker timed out"));
            }, 60_000);
            worker.onerror = (event) => {
              clearTimeout(timer);
              worker.terminate();
              reject(new Error(event.message));
            };
            worker.onmessage = (
              event: MessageEvent<
                Omit<WorkerResult, "frames"> & {
                  frames?: {
                    clip: string;
                    sample: number;
                    timeSeconds: number;
                    rgba: ArrayBuffer;
                    width: number;
                    height: number;
                  }[];
                }
              >,
            ) => {
              clearTimeout(timer);
              worker.terminate();
              if (event.data.status !== "passed") {
                reject(new Error(event.data.error ?? "Worker failed"));
                return;
              }
              const frames = (event.data.frames ?? []).map(({ rgba, ...frame }) => {
                const data = new Uint8Array(rgba);
                let binary = "";
                for (let offset = 0; offset < data.length; offset += 8192)
                  binary += String.fromCharCode(...data.subarray(offset, offset + 8192));
                return { ...frame, rgbaBase64: btoa(binary) };
              });
              resolve({ ...event.data, frames });
            };
            worker.postMessage({ bytes, expected, camera }, [bytes]);
          });
        },
        {
          bytesBase64: bytes.toString("base64"),
          workerUrl: `${origin}/worker.js`,
          camera,
          expected: {
            sourceSha256: assessment.sourceSha256,
            jointNames: assessment.rig
              .filter((bone) => bone.inverseBindMatrix !== null)
              .map((bone) => bone.name),
            clips: assessment.clips,
          },
        },
      );
      assert.equal(result.frames.length, assessment.clips.length * 4);
      assert(
        Number.isFinite(result.importDurationMs) &&
          result.importDurationMs >= 0 &&
          result.meshes > 0,
      );
      const frames = [];
      for (const [index, frame] of result.frames.entries()) {
        const rgba = Buffer.from(frame.rgbaBase64, "base64");
        assert.equal(rgba.length, frame.width * frame.height * 4);
        let visiblePixels = 0;
        for (let offset = 0; offset < rgba.length; offset += 4)
          if ((rgba[offset] ?? 0) + (rgba[offset + 1] ?? 0) + (rgba[offset + 2] ?? 0) > 12)
            visiblePixels++;
        const file = `frame-${index.toString().padStart(2, "0")}.png`;
        await sharp(rgba, { raw: { width: frame.width, height: frame.height, channels: 4 } })
          .png()
          .toFile(join(output, file));
        frames.push({
          clip: frame.clip,
          sample: frame.sample,
          timeSeconds: frame.timeSeconds,
          file,
          rgbaSha256: sha256(rgba),
          visiblePixels,
          width: frame.width,
          height: frame.height,
        });
      }
      report.worker = {
        importDurationMs: result.importDurationMs,
        meshes: result.meshes,
        joints: result.joints,
        frames,
        camera,
        browserErrors,
        externalRequests,
      };
      if (candidateArgument === "--fixture") {
        const walk = frames.filter((frame) => frame.clip === "Walk");
        assert(
          walk.every((frame) => frame.visiblePixels > 100),
          "Fixture geometry did not render",
        );
        assert.notEqual(walk[0]?.rgbaSha256, walk[1]?.rgbaSha256, "Fixture skin did not animate");
        assert.notEqual(
          walk[1]?.rgbaSha256,
          walk[2]?.rgbaSha256,
          "LINEAR interpolation did not progress between keys",
        );
        assert.equal(
          walk[0]?.rgbaSha256,
          walk[3]?.rgbaSha256,
          "Fixture loop endpoint did not return to the original pose",
        );
        const attack = frames.filter((frame) => frame.clip === "Attack");
        assert.equal(
          attack[0]?.rgbaSha256,
          attack[1]?.rgbaSha256,
          "STEP interpolation changed before the next key",
        );
        assert.notEqual(
          attack[0]?.rgbaSha256,
          attack[2]?.rgbaSha256,
          "STEP interpolation did not reach the next key",
        );
      }
      assert.deepEqual(browserErrors, []);
      assert.deepEqual(externalRequests, []);
    } finally {
      await context.close();
    }
  } finally {
    await stopLocalServer(server);
  }
  const sourceAfter = await readSourceIdentity(repositoryRoot);
  report.sourceAfter = sourceAfter;
  assert.deepEqual(sourceAfter, source, "Source changed during animation verification");
  report.verdict = "passed";
} catch (error: unknown) {
  report.verdict = "failed";
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await persist();
  await writeFile(
    join(output, "summary.md"),
    `# Animation source import\n\nVerdict: ${String(report.verdict)}.\n\nPinned-loader diagnostic only; no library admission, installed motion acceptance or performance-budget verdict.\n\n${report.error ?? "See result.json for exact source, profile, renderer, browser, seek and capture evidence."}\n`,
  );
  process.stdout.write(`${String(report.verdict)}: ${join(output, "result.json")}\n`);
}
