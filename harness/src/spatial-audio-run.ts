import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SpatialAudioService, SpatialAudioTelemetrySnapshot } from "@parallax/engine";
import { readChromeCommandLine } from "./browser-probes.js";
import { readAndValidateBuildManifest } from "./build-manifest.js";
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
import { validateSpatialAudioTelemetry } from "./spatial-audio-telemetry.js";
import { readTelemetry } from "./telemetry.js";

// Focused correctness evidence. No physical presentation, audible quality, or budget verdict.
const repositoryRoot = resolve(import.meta.dirname, "../../..");
const output = join(
  repositoryRoot,
  "harness/results",
  `spatial-audio-${new Date().toISOString().replace(/[:.]/gu, "-")}`,
);
await mkdir(output, { recursive: true });
const report: Record<string, unknown> = {
  schemaVersion: 1,
  scenario: "spatial-audio@1",
  verdict: "pending",
  budget: "not-evaluated",
};
const persist = async (): Promise<void> => {
  await writeFile(join(output, "result.json"), `${JSON.stringify(report, null, 2)}\n`);
};
await persist();
try {
  const source = await readSourceIdentity(repositoryRoot);
  const build = await readAndValidateBuildManifest(join(repositoryRoot, "dist"));
  const engine = build.manifest.artifacts.find((entry) =>
    /^immutable\/engine-[a-f0-9]{64}\.js$/u.test(entry.path),
  );
  if (engine === undefined) throw new Error("Production engine artifact is missing");
  const pin = await loadChromePin(join(repositoryRoot, "harness/chrome/stable.json"));
  const executable = await resolveChromeExecutablePath(repositoryRoot, pin);
  const executableSha256 = await validateChromeExecutable(pin, executable);
  Object.assign(report, {
    source,
    artifactDigest: build.artifactDigest,
    releaseDigest: build.releaseDigest,
    browser: { version: pin.version, executableSha256 },
  });
  await persist();
  const server = createLocalServer({ root: join(repositoryRoot, "dist") });
  const address = await listenLocalServer(server);
  try {
    const profile = await mkdtemp(join(tmpdir(), "parallax-spatial-audio-"));
    report.profilePath = profile;
    const context = await launchAfterPhysicalConsoleDisplayWake(() =>
      launchPersistentChrome(executable, profile),
    );
    try {
      validateChromeSandboxCommandLine(await readChromeCommandLine(context));
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const session = await context.newCDPSession(page);
      validateChromeBrowserIdentity(pin, await session.send("Browser.getVersion"));
      const baseUrl = `http://127.0.0.1:${address.port}`;
      await page.goto(`${baseUrl}/__parallax/identity`);
      const engineUrl = `${baseUrl}/${engine.path}`;
      report.stereo = await page.evaluate(async (url) => {
        const engine = (await import(url)) as typeof import("@parallax/engine");
        const cases = [
          { id: "left", position: [-2, 0, 0], forward: [0, 0, 1] },
          { id: "right", position: [2, 0, 0], forward: [0, 0, 1] },
          { id: "turned-right", position: [-2, 0, 0], forward: [0, 0, -1] },
          { id: "near", position: [0, 0, 1], forward: [0, 0, 1] },
          { id: "far", position: [0, 0, 10], forward: [0, 0, 1] },
        ] as const;
        const results: { id: string; leftRms: number; rightRms: number }[] = [];
        for (const entry of cases) {
          const offline = new OfflineAudioContext(2, 9_600, 48_000);
          // Only the control-state adapter is synthetic; all production graph nodes,
          // listener coordinates, attenuation and rendered PCM are Chrome's Web Audio.
          const control = {
            state: "running",
            sampleRate: offline.sampleRate,
            baseLatency: 0,
            outputLatency: 0,
            listener: offline.listener,
            destination: offline.destination,
            onstatechange: null,
            createBuffer: (channels: number, frames: number, sampleRate: number) =>
              offline.createBuffer(channels, frames, sampleRate),
            createPanner: () => offline.createPanner(),
            createGain: () => offline.createGain(),
            createBufferSource: () => offline.createBufferSource(),
            close: async () => undefined,
          } as unknown as AudioContext;
          const audio = engine.createSpatialAudioService(
            { maximumClips: 1, maximumVoices: 1, maximumPcmBytes: 38_400 },
            {
              createContext: () => control,
              now: () => performance.now(),
              yieldPreparation: async () => undefined,
            },
          );
          const signal = Float32Array.from(
            { length: 9_600 },
            (_, index) => 0.1 * Math.sin((2 * Math.PI * 440 * index) / 48_000),
          );
          await audio.prepareClip({
            id: "measurement-signal",
            sampleRate: 48_000,
            samples: signal,
          });
          audio.setScene("measurement");
          audio.setListener({ position: [0, 0, 0], forward: entry.forward, up: [0, 1, 0] });
          audio.play({
            clipId: "measurement-signal",
            sceneId: "measurement",
            position: entry.position,
            gain: 1,
            referenceDistance: 1,
            maximumDistance: 100,
          });
          const rendered = await offline.startRendering();
          const rms = (channel: number): number =>
            Math.sqrt(
              rendered.getChannelData(channel).reduce((sum, sample) => sum + sample * sample, 0) /
                rendered.length,
            );
          results.push({ id: entry.id, leftRms: rms(0), rightRms: rms(1) });
          await audio.dispose();
        }
        const [left, right, turned, near, far] = results;
        if (
          left === undefined ||
          right === undefined ||
          turned === undefined ||
          near === undefined ||
          far === undefined ||
          left.leftRms < 0.01 ||
          left.rightRms > 0.00001 ||
          right.rightRms < 0.01 ||
          right.leftRms > 0.00001 ||
          turned.rightRms < 0.01 ||
          turned.leftRms > 0.00001 ||
          Math.abs(near.leftRms - near.rightRms) > 0.00001 ||
          Math.abs(far.leftRms / near.leftRms - 0.1) > 0.001
        ) {
          throw new Error(`Spatial stereo/attenuation mismatch: ${JSON.stringify(results)}`);
        }
        return results;
      }, engineUrl);
      await page.evaluate(async (url) => {
        const engine = (await import(url)) as typeof import("@parallax/engine");
        const native = new AudioContext({ latencyHint: "interactive" });
        const audio = engine.createSpatialAudioService(
          {
            maximumClips: 1,
            maximumVoices: 32,
            maximumPcmBytes: 38_400,
          },
          {
            createContext: () => native,
            now: () => performance.now(),
            yieldPreparation: async () => undefined,
          },
        );
        await audio.prepareClip({
          id: "measurement-signal",
          sampleRate: 48_000,
          samples: Float32Array.from(
            { length: 9_600 },
            (_, index) => 0.1 * Math.sin((index * Math.PI) / 32),
          ),
        });
        audio.setScene("measurement");
        audio.setListener({ position: [0, 0, 0], forward: [0, 0, 1], up: [0, 1, 0] });
        await native.suspend();
        const unbind = engine.bindSpatialAudioLifecycle(audio);
        const button = document.createElement("button");
        button.textContent = "Activate audio test";
        document.body.append(button);
        Reflect.set(globalThis, "spatialAudioProbe", { audio, unbind });
      }, engineUrl);
      await page.waitForFunction(
        () => {
          const probe = Reflect.get(globalThis, "spatialAudioProbe") as {
            audio: SpatialAudioService;
          };
          return probe.audio.snapshot().state === "suspended";
        },
        undefined,
        { timeout: 10_000 },
      );
      await page.getByRole("button", { name: "Activate audio test" }).click();
      await page.waitForFunction(
        () => {
          const probe = Reflect.get(globalThis, "spatialAudioProbe") as {
            audio: SpatialAudioService;
          };
          return probe.audio.snapshot().state === "running";
        },
        undefined,
        { timeout: 10_000 },
      );
      report.realtime = await page.evaluate(async () => {
        const { audio, unbind } = Reflect.get(globalThis, "spatialAudioProbe") as {
          audio: SpatialAudioService;
          unbind(): void;
        };
        const request = {
          clipId: "measurement-signal",
          sceneId: "measurement",
          position: [1, 0, 1] as const,
          emitterId: 7,
          gain: 0,
          referenceDistance: 1,
          maximumDistance: 60,
          loop: true,
        };
        for (let index = 0; index < 32; index += 1) {
          if (audio.play(request) === null) throw new Error("Native voice allocation failed");
        }
        if (audio.play(request) !== null) throw new Error("Native voice capacity was not enforced");
        const costs: number[] = [];
        for (let index = 0; index < 120; index += 1) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const start = performance.now();
          const yaw = index / 60;
          audio.setListener({
            position: [index / 60, 0, 0],
            forward: [Math.sin(yaw), 0, Math.cos(yaw)],
            up: [0, 1, 0],
          });
          audio.updateEmitters([{ id: 7, position: [1, 0, 1] }]);
          costs.push(performance.now() - start);
        }
        const playing = audio.snapshot();
        audio.setScene("other-district");
        const cleared = audio.snapshot();
        audio.releaseClip("measurement-signal");
        unbind();
        await audio.dispose();
        const disposed = audio.snapshot();
        if (
          playing.resumeAttemptCount !== 1 ||
          playing.activeVoices !== 32 ||
          cleared.activeVoices !== 0 ||
          disposed.pcmBytes !== 0 ||
          disposed.state !== "disposed"
        )
          throw new Error("Native audio cleanup failed");
        costs.sort((a, b) => a - b);
        return {
          playing,
          cleared,
          disposed,
          controlMs: { p50: costs[59], p95: costs[113], max: costs[119] },
          outputGain: 0,
          acousticQuality: "not-evaluated",
        };
      });
      const realtime = report.realtime as {
        playing: SpatialAudioTelemetrySnapshot;
        cleared: SpatialAudioTelemetrySnapshot;
        disposed: SpatialAudioTelemetrySnapshot;
      };
      for (const snapshot of [realtime.playing, realtime.cleared, realtime.disposed])
        validateSpatialAudioTelemetry(snapshot);
      report.browserErrors = errors;
      if (errors.length !== 0) throw new Error("Audio probe reported browser errors");
      await page.goto(`${baseUrl}/?parallaxAutomation=runtime`);
      await page.waitForFunction(
        () => {
          const telemetry = Reflect.get(globalThis, "__PARALLAX_TELEMETRY__") as
            | import("@parallax/engine").ParallaxTelemetryExport
            | undefined;
          const snapshot = telemetry?.snapshot();
          return (
            snapshot?.render.state === "ready" &&
            snapshot.simulation.state === "running" &&
            snapshot.streaming.state === "streaming"
          );
        },
        undefined,
        { timeout: 30_000 },
      );
      const runtime = await readTelemetry(page);
      if (
        runtime.spatialAudio.clipCount !== 0 ||
        runtime.spatialAudio.activeVoices !== 0 ||
        runtime.spatialAudio.state !== "idle"
      )
        throw new Error("Ordinary runtime unexpectedly loaded audio content");
      report.runtime = {
        schemaVersion: runtime.schemaVersion,
        renderState: runtime.render.state,
        simulationState: runtime.simulation.state,
        streamingState: runtime.streaming.state,
        audio: runtime.spatialAudio,
        contentSource: "privileged-legacy-network",
        installedLifecycle: "not-evaluated",
      };
      if (errors.length !== 0) throw new Error("Runtime integration reported browser errors");
    } finally {
      await context.close();
    }
  } finally {
    await stopLocalServer(server);
  }
  const after = await readAndValidateBuildManifest(join(repositoryRoot, "dist"));
  if (after.artifactDigest !== build.artifactDigest)
    throw new Error("Audio build changed during verification");
  report.sourceAfter = await readSourceIdentity(repositoryRoot);
  report.sourceDrift = JSON.stringify(report.sourceAfter) !== JSON.stringify(source);
  if (report.sourceDrift)
    throw new Error(
      "Source changed during the audio probe; retained observations do not qualify this run",
    );
  report.verdict = "passed";
} catch (error: unknown) {
  report.verdict = "failed";
  report.failure = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  await persist();
  await writeFile(
    join(output, "summary.md"),
    `# Spatial audio correctness\n\nVerdict: ${report.verdict}. Budget and acoustic quality: not evaluated.\n\nNative stereo/attenuation and activation/pool/cleanup evidence is in result.json.\n`,
  );
  console.log(`${report.verdict}: ${output}`);
}
