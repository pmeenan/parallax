import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const outputRoot = join(repositoryRoot, "dist");
const moduleDescriptors = Object.freeze([
  {
    input: "app/dist/immutable/app.js",
    mode: "rename",
    scope: "app",
    token: "/immutable/app.js",
  },
  {
    input: "engine/dist/engine.js",
    mode: "copy",
    scope: "engine",
    token: "__ENGINE_ARTIFACT__",
  },
  {
    input: "game/dist/game.js",
    mode: "copy",
    scope: "game",
    token: "__GAME_ARTIFACT__",
  },
]);

process.env.LANG = "C";
process.env.LC_ALL = "C";
process.env.TZ = "UTC";

await Promise.all([
  rm(outputRoot, { force: true, recursive: true }),
  rm(join(repositoryRoot, "app/dist"), { force: true, recursive: true }),
  rm(join(repositoryRoot, "engine/dist"), { force: true, recursive: true }),
  rm(join(repositoryRoot, "game/dist"), { force: true, recursive: true }),
  rm(join(repositoryRoot, "harness/dist"), { force: true, recursive: true }),
]);

runPnpm(["exec", "tsc", "-b"]);
runPnpm(["--filter", "@parallax/engine", "build"]);
runPnpm(["--filter", "@parallax/game", "build"]);
runPnpm(["--filter", "@parallax/app", "build"]);

await mkdir(join(outputRoot, "immutable"), { recursive: true });
await cp(join(repositoryRoot, "app/dist"), outputRoot, { recursive: true });

const assembledModules = [];
for (const descriptor of moduleDescriptors) {
  const input = join(repositoryRoot, descriptor.input);
  const outputName = await contentAddressedName(descriptor.scope, input);
  const output = join(outputRoot, "immutable", outputName);
  if (descriptor.mode === "rename") {
    await rename(join(outputRoot, descriptor.input.replace("app/dist/", "")), output);
  } else {
    await cp(input, output);
  }
  assembledModules.push({ ...descriptor, outputName });
}

const indexPath = join(outputRoot, "index.html");
let index = await readFile(indexPath, "utf8");
for (const descriptor of assembledModules) {
  const replacement = descriptor.token.startsWith("/immutable/")
    ? `/immutable/${descriptor.outputName}`
    : descriptor.outputName;
  index = replaceExactlyOnce(index, descriptor.token, replacement);
}
validateImmutableReferences(index);
await writeFile(indexPath, index);

const artifacts = (await collectArtifacts(outputRoot)).sort((left, right) =>
  compareCodepoints(left.path, right.path),
);
await writeFile(
  join(outputRoot, "build-manifest.json"),
  `${JSON.stringify({ schemaVersion: 1, artifacts }, null, 2)}\n`,
);
runPnpm(["verify:repeatable"]);

function runPnpm(arguments_) {
  const pnpmCli = process.env.npm_execpath;
  if (pnpmCli === undefined) {
    throw new Error("pnpm CLI path is unavailable; run this script through pnpm build");
  }
  const result = spawnSync(process.execPath, [pnpmCli, ...arguments_], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function contentAddressedName(scope, path) {
  const bytes = await readFile(path);
  const digest = createHash("sha256").update(bytes).digest("hex");
  return `${scope}-${digest}.js`;
}

function replaceExactlyOnce(source, token, replacement) {
  const first = source.indexOf(token);
  if (first === -1) throw new Error(`Required assembly token is missing: ${token}`);
  if (source.indexOf(token, first + token.length) !== -1) {
    throw new Error(`Required assembly token is ambiguous: ${token}`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + token.length)}`;
}

function validateImmutableReferences(index) {
  const references = index.match(/\/immutable\/[^"'\s<]+/g) ?? [];
  if (references.length !== moduleDescriptors.length) {
    throw new Error(
      `Expected ${moduleDescriptors.length} immutable module references; found ${references.length}`,
    );
  }
  const contentAddressedPath = /^\/immutable\/[a-z0-9-]+-[a-f0-9]{64}\.[a-z0-9]+$/;
  for (const reference of references) {
    if (!contentAddressedPath.test(reference)) {
      throw new Error(`Immutable reference is not content-addressed: ${reference}`);
    }
  }
}

function compareCodepoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function collectArtifacts(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const artifacts = [];
  for (const entry of entries) {
    if (entry.name === "build-manifest.json") continue;
    const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      artifacts.push(...(await collectArtifacts(absolutePath, relativePath)));
    } else {
      const bytes = await readFile(absolutePath);
      artifacts.push({
        bytes: bytes.byteLength,
        path: relativePath,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
  return artifacts;
}
