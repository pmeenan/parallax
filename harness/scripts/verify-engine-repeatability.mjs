import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const shippedDirectory = join(repositoryRoot, "engine/dist");
// Keep this exact allowlist aligned with engine/rollup.config.mjs: unexpected chunks
// would weaken the self-contained, independently addressable engine artifact contract.
const expectedOutputs = Object.freeze(["engine.js", "render-worker.js"]);
const pnpmCli = process.env.npm_execpath;
if (pnpmCli === undefined) {
  throw new Error("pnpm CLI path is unavailable; run this script through pnpm verify:repeatable");
}

// D-010 repeatability gate over the bytes that actually ship: hash the existing
// engine/dist artifacts (the ones the assembler consumes), rebuild once into a
// temporary directory, and require byte-identical output.
let shipped = await tryDigestShipped();
if (shipped === null) {
  console.log("Engine repeatability: engine/dist is missing or incomplete; building it first");
  runEngineBuild(null);
  shipped = await tryDigestShipped();
  if (shipped === null) {
    throw new Error("Engine build did not produce the expected engine/dist artifacts");
  }
}

const rebuilt = await buildAndDigestTemporary();

if (JSON.stringify(shipped) !== JSON.stringify(rebuilt)) {
  console.error("Engine repeatability check failed", { rebuilt, shipped });
  process.exit(1);
}

for (const artifact of shipped) {
  console.log(`Engine repeatability: ${artifact.name} sha256=${artifact.sha256}`);
}
console.log("Engine repeatability: shipped engine/dist bytes match an independent rebuild");

async function tryDigestShipped() {
  const digests = [];
  for (const name of expectedOutputs) {
    try {
      digests.push(await digestFile(shippedDirectory, name));
    } catch (error) {
      if (error !== null && typeof error === "object" && error.code === "ENOENT") return null;
      throw error;
    }
  }
  return digests;
}

async function buildAndDigestTemporary() {
  const outputDirectory = await mkdtemp(join(tmpdir(), "parallax-engine-build-"));
  try {
    runEngineBuild(outputDirectory);
    const outputs = (await readdir(outputDirectory)).sort();
    if (outputs.join(",") !== expectedOutputs.join(",")) {
      throw new Error(`Expected engine.js and render-worker.js; received: ${outputs.join(", ")}`);
    }
    return await Promise.all(outputs.map((name) => digestFile(outputDirectory, name)));
  } finally {
    await rm(outputDirectory, { force: true, recursive: true });
  }
}

function runEngineBuild(outputDirectory) {
  const env = {
    ...process.env,
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
  };
  // Without an override the engine build writes its default output, engine/dist.
  delete env.PARALLAX_ENGINE_OUTPUT_DIR;
  if (outputDirectory !== null) {
    env.PARALLAX_ENGINE_OUTPUT_DIR = outputDirectory;
  }
  const result = spawnSync(process.execPath, [pnpmCli, "--filter", "@parallax/engine", "build"], {
    cwd: repositoryRoot,
    env,
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Engine build failed with exit code ${result.status ?? "unknown"}`);
  }
}

async function digestFile(directory, name) {
  const bytes = await readFile(join(directory, name));
  return { name, sha256: createHash("sha256").update(bytes).digest("hex") };
}
