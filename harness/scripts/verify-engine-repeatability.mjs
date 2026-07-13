import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const pnpmCli = process.env.npm_execpath;
if (pnpmCli === undefined) {
  throw new Error("pnpm CLI path is unavailable; run this script through pnpm verify:repeatable");
}

const first = await buildAndDigest();
const second = await buildAndDigest();

if (JSON.stringify(first) !== JSON.stringify(second)) {
  console.error("Engine repeatability check failed", { first, second });
  process.exit(1);
}

for (const artifact of first) {
  console.log(`Engine repeatability: ${artifact.name} sha256=${artifact.sha256}`);
}

async function buildAndDigest() {
  const outputDirectory = await mkdtemp(join(tmpdir(), "parallax-engine-build-"));
  const result = spawnSync(process.execPath, [pnpmCli, "--filter", "@parallax/engine", "build"], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      LANG: "C",
      LC_ALL: "C",
      PARALLAX_ENGINE_OUTPUT_DIR: outputDirectory,
      TZ: "UTC",
    },
    stdio: "inherit",
  });
  try {
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Engine build failed with exit code ${result.status ?? "unknown"}`);
    }

    const outputs = (await readdir(outputDirectory)).sort();
    // Keep this exact allowlist aligned with engine/rollup.config.mjs: unexpected chunks
    // would weaken the self-contained, independently addressable engine artifact contract.
    if (outputs.join(",") !== "engine.js,render-worker.js") {
      throw new Error(`Expected engine.js and render-worker.js; received: ${outputs.join(", ")}`);
    }
    return await Promise.all(
      outputs.map(async (name) => {
        const bytes = await readFile(join(outputDirectory, name));
        return { name, sha256: createHash("sha256").update(bytes).digest("hex") };
      }),
    );
  } finally {
    await rm(outputDirectory, { force: true, recursive: true });
  }
}
