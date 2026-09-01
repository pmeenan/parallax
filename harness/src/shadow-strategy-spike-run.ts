import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import sharp from "sharp";
import { readChromeCommandLine, readWebGpuAdapterIdentity } from "./browser-probes.js";
import {
  launchPersistentChrome,
  loadChromePin,
  resolveChromeExecutablePath,
  validateChromeExecutable,
  validateChromeSandboxCommandLine,
} from "./chrome-pin.js";
import type { WebGpuAdapterIdentity } from "./environment.js";
import {
  launchAfterPhysicalConsoleDisplayWake,
  withClosedBrowserContext,
} from "./physical-console-preflight.js";
import { createLocalServer, listenLocalServer, stopLocalServer } from "./server.js";
import {
  assertShadowStrategyPageResult,
  assertShadowStrategyRendererPackage,
  evaluateShadowStrategyRepeatability,
  SHADOW_STRATEGY_ARMS,
  SHADOW_STRATEGY_SPIKE_ID,
  SHADOW_STRATEGY_SPIKE_SCHEMA_VERSION,
  type ShadowStrategyArm,
  type ShadowStrategyCapture,
  type ShadowStrategyPageResult,
  type ShadowStrategyRepeatability,
} from "./shadow-strategy-spike-contract.js";
import { readSourceIdentity } from "./source-identity.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const outputRoot = join(repositoryRoot, "harness/results");
const probeGlobalName = "__PARALLAX_SHADOW_STRATEGY_PROBE__";
const captureCount = 3;
const repeatCount = 3;

interface CapturedImageEvidence {
  readonly checkpointId: string;
  readonly height: number;
  readonly path: string;
  readonly rgbaSha256: string;
  readonly width: number;
}

interface ArmRepeatEvidence {
  readonly adapter: WebGpuAdapterIdentity;
  readonly browserErrors: readonly string[];
  readonly repeat: number;
  readonly result: ShadowStrategyPageResult;
  readonly userAgent: string;
}

interface ArmEvidence {
  readonly captures: readonly CapturedImageEvidence[];
  readonly cpuP50Repeatability: ShadowStrategyRepeatability;
  readonly gpuP50Repeatability: ShadowStrategyRepeatability;
  readonly repeats: readonly ArmRepeatEvidence[];
}

interface MutableArmEvidence {
  captures: readonly CapturedImageEvidence[];
  readonly repeats: ArmRepeatEvidence[];
}

interface ProbePageEnvelope {
  readonly error: string | null;
  readonly result: unknown;
  readonly state: "complete" | "failed" | "running";
}

await main();

async function main(): Promise<void> {
  if (process.argv.length !== 2) throw new Error("Shadow strategy spike accepts no arguments");
  await assertInstalledRendererMatchesContract();
  const generatedAt = new Date().toISOString();
  const timestamp = generatedAt.replaceAll(/[:.]/gu, "-");
  const resultDirectory = join(outputRoot, `m45-shadow-strategies-${timestamp}`);
  const bundleDirectory = await mkdtemp(join(tmpdir(), "parallax-shadow-strategies-bundle-"));
  const profileRoot = await mkdtemp(join(tmpdir(), "parallax-shadow-strategies-profile-"));
  const chromePin = await loadChromePin(join(repositoryRoot, "harness/chrome/stable.json"));
  const executablePath = await resolveChromeExecutablePath(repositoryRoot, chromePin);
  const executableSha256 = await validateChromeExecutable(chromePin, executablePath);
  const source = await readSourceIdentity(repositoryRoot);
  await mkdir(resultDirectory, { recursive: true });
  try {
    const bundlePath = join(bundleDirectory, "probe.js");
    await build({
      bundle: true,
      entryPoints: [join(repositoryRoot, "harness/src/shadow-strategy-spike-page.ts")],
      format: "esm",
      logLevel: "silent",
      minify: false,
      outfile: bundlePath,
      platform: "browser",
      sourcemap: false,
      target: "chrome152",
    });
    await writeFile(join(bundleDirectory, "index.html"), probeDocument(), "utf8");
    const bundleSha256 = sha256(await readFile(bundlePath));
    const server = createLocalServer({ root: bundleDirectory });
    const address = await listenLocalServer(server);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const arms: Record<ShadowStrategyArm, MutableArmEvidence> = {
      "csm-4x1024": { captures: Object.freeze([]), repeats: [] },
      "esm-2048": { captures: Object.freeze([]), repeats: [] },
      "no-shadow": { captures: Object.freeze([]), repeats: [] },
      "pcf-2048": { captures: Object.freeze([]), repeats: [] },
    };
    let chromeCommandLine = "";
    try {
      for (let repeat = 1; repeat <= repeatCount; repeat += 1) {
        for (const arm of SHADOW_STRATEGY_ARMS) {
          const evidence = await runArm({
            arm,
            baseUrl,
            capture: repeat === 1,
            executablePath,
            profilePath: join(profileRoot, `repeat-${repeat}-${arm}`),
            repeat,
            resultDirectory,
          });
          arms[arm].repeats.push(evidence.repeat);
          if (repeat === 1) arms[arm].captures = evidence.captures;
          chromeCommandLine ||= evidence.chromeCommandLine;
          await persistPendingReport(resultDirectory, {
            arms,
            bundleSha256,
            chrome: {
              browserRevision: chromePin.browserRevision,
              commandLineSandboxVerified: true,
              executableSha256,
              version: chromePin.version,
            },
            generatedAt,
            scenarioId: SHADOW_STRATEGY_SPIKE_ID,
            schemaVersion: SHADOW_STRATEGY_SPIKE_SCHEMA_VERSION,
            source,
            state: "pending",
          });
        }
      }
    } finally {
      await stopLocalServer(server);
    }
    const completeArms = Object.fromEntries(
      SHADOW_STRATEGY_ARMS.map((arm) => {
        const evidence = arms[arm];
        if (evidence.repeats.length !== repeatCount) {
          throw new Error(`Shadow strategy arm ${arm} repeat set is incomplete`);
        }
        return [
          arm,
          Object.freeze({
            captures: evidence.captures,
            cpuP50Repeatability: evaluateShadowStrategyRepeatability(
              evidence.repeats.map((repeat) => repeat.result.cpuRenderCallMs.p50),
            ),
            gpuP50Repeatability: evaluateShadowStrategyRepeatability(
              evidence.repeats.map((repeat) => repeat.result.gpuFrameTimeMs.p50),
            ),
            repeats: Object.freeze(evidence.repeats),
          }),
        ];
      }),
    ) as Record<ShadowStrategyArm, ArmEvidence>;
    const sourceAfterRun = await readSourceIdentity(repositoryRoot);
    if (
      sourceAfterRun.commit !== source.commit ||
      sourceAfterRun.dirtyTreeDigest !== source.dirtyTreeDigest
    ) {
      throw new Error("Shadow strategy source identity changed during the browser matrix");
    }
    const reportBase = Object.freeze({
      arms: completeArms,
      bundleSha256,
      chrome: Object.freeze({
        browserRevision: chromePin.browserRevision,
        commandLine: chromeCommandLine,
        commandLineSandboxVerified: true as const,
        executableSha256,
        version: chromePin.version,
      }),
      generatedAt,
      scenarioId: SHADOW_STRATEGY_SPIKE_ID,
      schemaVersion: SHADOW_STRATEGY_SPIKE_SCHEMA_VERSION,
      source,
    });
    await persistPendingReport(resultDirectory, { ...reportBase, state: "pending" });
    await writeFile(join(resultDirectory, "result.md"), formatReport(reportBase));
    await writeFile(
      join(resultDirectory, "result.json"),
      `${JSON.stringify({ ...reportBase, state: "complete" }, null, 2)}\n`,
    );
    console.log(`Shadow strategy comparison: ${resultDirectory}`);
    console.log(formatConsoleSummary(completeArms));
  } finally {
    await Promise.all([
      rm(bundleDirectory, { force: true, recursive: true }),
      rm(profileRoot, { force: true, recursive: true }),
    ]);
  }
}

async function runArm(
  input: Readonly<{
    readonly arm: ShadowStrategyArm;
    readonly baseUrl: string;
    readonly capture: boolean;
    readonly executablePath: string;
    readonly profilePath: string;
    readonly repeat: number;
    readonly resultDirectory: string;
  }>,
): Promise<
  Readonly<{
    readonly captures: readonly CapturedImageEvidence[];
    readonly chromeCommandLine: string;
    readonly repeat: ArmRepeatEvidence;
  }>
> {
  return withClosedBrowserContext(
    () =>
      launchAfterPhysicalConsoleDisplayWake(() =>
        launchPersistentChrome(input.executablePath, input.profilePath),
      ),
    async (context) => {
      const chromeCommandLine = await readChromeCommandLine(context);
      validateChromeSandboxCommandLine(chromeCommandLine);
      const page = context.pages()[0] ?? (await context.newPage());
      const browserErrors: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(message.text());
      });
      const url = new URL(input.baseUrl);
      url.searchParams.set("arm", input.arm);
      await page.goto(url.href, { waitUntil: "load" });
      await page.waitForFunction(
        (globalName) => {
          const candidate = Reflect.get(globalThis, globalName) as
            | Readonly<{ readonly state?: unknown }>
            | undefined;
          return candidate?.state === "complete" || candidate?.state === "failed";
        },
        probeGlobalName,
        { timeout: 120_000 },
      );
      const envelope = await page.evaluate((globalName): ProbePageEnvelope => {
        const candidate = Reflect.get(globalThis, globalName) as ProbePageEnvelope | undefined;
        if (candidate === undefined) throw new Error("Shadow strategy probe global is missing");
        return { error: candidate.error, result: candidate.result, state: candidate.state };
      }, probeGlobalName);
      if (envelope.state !== "complete") {
        throw new Error(envelope.error ?? `Shadow strategy arm ${input.arm} failed`);
      }
      assertShadowStrategyPageResult(envelope.result, input.arm);
      if (browserErrors.length > 0) {
        throw new Error(
          `Shadow strategy arm ${input.arm} emitted browser errors: ${browserErrors.join(" | ")}`,
        );
      }
      const armDirectory = join(input.resultDirectory, input.arm);
      await mkdir(armDirectory, { recursive: true });
      const adapter = await readWebGpuAdapterIdentity(page);
      const captures: CapturedImageEvidence[] = [];
      for (let index = 0; index < (input.capture ? captureCount : 0); index += 1) {
        const capture = await page.evaluate(
          async ({ checkpointIndex, globalName }): Promise<ShadowStrategyCapture> => {
            const candidate = Reflect.get(globalThis, globalName) as
              | Readonly<{
                  capture(index: number): Promise<ShadowStrategyCapture>;
                }>
              | undefined;
            if (candidate === undefined) throw new Error("Shadow strategy probe global is missing");
            return candidate.capture(checkpointIndex);
          },
          { checkpointIndex: index, globalName: probeGlobalName },
        );
        const rgba = Buffer.from(capture.dataBase64, "base64");
        if (rgba.byteLength !== capture.width * capture.height * 4) {
          throw new Error(`Shadow strategy ${input.arm} capture byte length is invalid`);
        }
        const filename = `${capture.checkpointId}.png`;
        await sharp(rgba, {
          raw: { channels: 4, height: capture.height, width: capture.width },
        })
          .png({ compressionLevel: 9 })
          .toFile(join(armDirectory, filename));
        captures.push(
          Object.freeze({
            checkpointId: capture.checkpointId,
            height: capture.height,
            path: `${input.arm}/${filename}`,
            rgbaSha256: sha256(rgba),
            width: capture.width,
          }),
        );
      }
      if (browserErrors.length > 0) {
        throw new Error(
          `Shadow strategy arm ${input.arm} emitted capture errors: ${browserErrors.join(" | ")}`,
        );
      }
      const userAgent = await page.evaluate(() => navigator.userAgent);
      return Object.freeze({
        captures: Object.freeze(captures),
        chromeCommandLine,
        repeat: Object.freeze({
          adapter,
          browserErrors: Object.freeze(browserErrors),
          repeat: input.repeat,
          result: envelope.result,
          userAgent,
        }),
      });
    },
  );
}

async function assertInstalledRendererMatchesContract(): Promise<void> {
  const manifestPath = findPackageJSON("@babylonjs/lite", import.meta.url);
  if (manifestPath === undefined) {
    throw new Error("Shadow strategy renderer package manifest was not found");
  }
  const manifest: Readonly<Record<string, unknown>> = JSON.parse(
    await readFile(manifestPath, "utf8"),
  );
  assertShadowStrategyRendererPackage(manifest.name, manifest.version);
}

async function persistPendingReport(
  resultDirectory: string,
  report: Readonly<Record<string, unknown>>,
): Promise<void> {
  await writeFile(join(resultDirectory, "result.json"), `${JSON.stringify(report, null, 2)}\n`);
}

function probeDocument(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:,">
  <title>Parallax M4.5 directional shadow strategy probe</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #111; }
    #probe-canvas { display: block; width: 1280px; height: 720px; }
  </style>
</head>
<body>
  <canvas id="probe-canvas" width="1280" height="720"></canvas>
  <script type="module" src="/probe.js"></script>
</body>
</html>
`;
}

function formatConsoleSummary(arms: Readonly<Record<ShadowStrategyArm, ArmEvidence>>): string {
  return SHADOW_STRATEGY_ARMS.map((arm) => {
    const evidence = arms[arm];
    return [
      arm.padEnd(12),
      `GPU p50 [${evidence.gpuP50Repeatability.values.map((value) => value.toFixed(3)).join(", ")}] ms`,
      `range ${(evidence.gpuP50Repeatability.relativeRange * 100).toFixed(1)}% ${evidence.gpuP50Repeatability.state}`,
      `CPU ${evidence.cpuP50Repeatability.state}`,
    ].join(" | ");
  }).join("\n");
}

function formatReport(
  report: Readonly<{
    readonly arms: Readonly<Record<ShadowStrategyArm, ArmEvidence>>;
    readonly bundleSha256: string;
    readonly chrome: Readonly<{ readonly executableSha256: string; readonly version: string }>;
    readonly generatedAt: string;
    readonly scenarioId: string;
    readonly source: Readonly<{ readonly commit: string; readonly dirtyTreeDigest: string | null }>;
  }>,
): string {
  const rows = SHADOW_STRATEGY_ARMS.map((arm) => {
    const evidence = report.arms[arm];
    return `| ${arm} | ${evidence.gpuP50Repeatability.values.map((value) => value.toFixed(3)).join(", ")} | ${(evidence.gpuP50Repeatability.relativeRange * 100).toFixed(1)}% | ${evidence.gpuP50Repeatability.state} | ${evidence.cpuP50Repeatability.values.map((value) => value.toFixed(3)).join(", ")} | ${evidence.cpuP50Repeatability.state} |`;
  });
  return `# M4.5 directional shadow strategy comparison

- Scenario: \`${report.scenarioId}\`
- Generated: ${report.generatedAt}
- Source: \`${report.source.commit}\` / dirty \`${report.source.dirtyTreeDigest ?? "null"}\`
- Bundle SHA-256: \`${report.bundleSha256}\`
- Chrome: ${report.chrome.version} / \`${report.chrome.executableSha256}\`

| Arm | GPU p50 ms by launch | GPU range | GPU state | CPU-submit p50 ms by launch | CPU state |
| --- | --- | ---: | --- | --- | --- |
${rows.join("\n")}

Representative captures are stored under each arm directory at near-casters, mid-range,
and long-vista checkpoints. This is discovery evidence, not a milestone budget verdict.
`;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
