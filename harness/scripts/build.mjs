import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildMemory64Wasm, buildRustWasm } from "./build-wasm.mjs";

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
    input: "game/dist/game.js",
    mode: "copy",
    scope: "game",
    token: "__GAME_ARTIFACT__",
  },
]);
const decoderWasmDescriptors = Object.freeze([
  {
    input: "engine/node_modules/draco3dgltf/draco_decoder_gltf.wasm",
    scope: "draco-decoder",
    token: "__DRACO_DECODER_WASM_ARTIFACT__",
  },
  {
    input: "engine/node_modules/@babylonjs/ktx2decoder/wasm/msc_basis_transcoder.wasm",
    scope: "msc-transcoder",
    token: "__MSC_TRANSCODER_WASM_ARTIFACT__",
  },
  {
    input: "engine/node_modules/@babylonjs/ktx2decoder/wasm/uastc_astc.wasm",
    scope: "uastc-astc",
    token: "__UASTC_ASTC_WASM_ARTIFACT__",
  },
  {
    input: "engine/node_modules/@babylonjs/ktx2decoder/wasm/uastc_bc7.wasm",
    scope: "uastc-bc7",
    token: "__UASTC_BC7_WASM_ARTIFACT__",
  },
  {
    input: "engine/node_modules/@babylonjs/ktx2decoder/wasm/uastc_r8_unorm.wasm",
    scope: "uastc-r8",
    token: "__UASTC_R8_WASM_ARTIFACT__",
  },
  {
    input: "engine/node_modules/@babylonjs/ktx2decoder/wasm/uastc_rg8_unorm.wasm",
    scope: "uastc-rg8",
    token: "__UASTC_RG8_WASM_ARTIFACT__",
  },
  {
    input: "engine/node_modules/@babylonjs/ktx2decoder/wasm/uastc_rgba8_srgb_v2.wasm",
    scope: "uastc-rgba-srgb",
    token: "__UASTC_RGBA_SRGB_WASM_ARTIFACT__",
  },
  {
    input: "engine/node_modules/@babylonjs/ktx2decoder/wasm/uastc_rgba8_unorm_v2.wasm",
    scope: "uastc-rgba-unorm",
    token: "__UASTC_RGBA_UNORM_WASM_ARTIFACT__",
  },
  {
    input: "engine/node_modules/@babylonjs/ktx2decoder/wasm/zstddec.wasm",
    scope: "zstd-decoder",
    token: "__ZSTD_DECODER_WASM_ARTIFACT__",
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

await buildRustWasm();
await buildMemory64Wasm();
runPnpm(["exec", "tsc", "-b"]);
runPnpm(["--filter", "@parallax/engine", "build"]);
runPnpm(["--filter", "@parallax/game", "build"]);
runPnpm(["--filter", "@parallax/app", "build"]);

await mkdir(join(outputRoot, "immutable"), { recursive: true });
await cp(join(repositoryRoot, "app/dist"), outputRoot, { recursive: true });
const gameContentEntrypoints = await writeGreyboxWorldArtifacts();

const decoderWasmArtifacts = [];
for (const descriptor of decoderWasmDescriptors) {
  const bytes = await readFile(join(repositoryRoot, descriptor.input));
  const outputName = contentAddressedNameFromBytes(descriptor.scope, bytes, ".wasm");
  await writeFile(join(outputRoot, "immutable", outputName), bytes);
  decoderWasmArtifacts.push({ ...descriptor, outputName });
}

const wllamaWasmBytes = await readFile(
  join(repositoryRoot, "engine/node_modules/@wllama/wllama/esm/wasm/wllama.wasm"),
);
const wllamaWasmOutputName = contentAddressedNameFromBytes("wllama", wllamaWasmBytes).replace(
  /\.js$/,
  ".wasm",
);
await writeFile(join(outputRoot, "immutable", wllamaWasmOutputName), wllamaWasmBytes);

const wasmThreadBytes = await readFile(
  join(repositoryRoot, "engine/wasm/thread-spike/pkg/thread_spike_bg.wasm"),
);
const wasmThreadOutputName = contentAddressedNameFromBytes(
  "wasm-thread-spike",
  wasmThreadBytes,
  ".wasm",
);
await writeFile(join(outputRoot, "immutable", wasmThreadOutputName), wasmThreadBytes);

const memory32SpikeBytes = await readFile(
  join(repositoryRoot, "engine/wasm/memory64-spike/pkg/memory32.wasm"),
);
const memory32SpikeOutputName = contentAddressedNameFromBytes(
  "memory32-spike",
  memory32SpikeBytes,
  ".wasm",
);
await writeFile(join(outputRoot, "immutable", memory32SpikeOutputName), memory32SpikeBytes);
const memory64SpikeBytes = await readFile(
  join(repositoryRoot, "engine/wasm/memory64-spike/pkg/memory64.wasm"),
);
const memory64SpikeOutputName = contentAddressedNameFromBytes(
  "memory64-spike",
  memory64SpikeBytes,
  ".wasm",
);
await writeFile(join(outputRoot, "immutable", memory64SpikeOutputName), memory64SpikeBytes);

const workerDescriptors = [];
for (const role of [
  "ai",
  "decode",
  "memory64-spike",
  "render",
  "storage",
  "streaming",
  "wasm-thread",
]) {
  let bytes = await readFile(join(repositoryRoot, `engine/dist/${role}-worker.js`));
  if (role === "ai" && bytes.includes("__WLLAMA_WASM_ARTIFACT__")) {
    bytes = Buffer.from(
      replaceExactlyOnce(bytes.toString("utf8"), "__WLLAMA_WASM_ARTIFACT__", wllamaWasmOutputName),
    );
  }
  if (role === "render") {
    let source = bytes.toString("utf8");
    for (const artifact of decoderWasmArtifacts) {
      source = replaceExactlyOnce(source, artifact.token, artifact.outputName);
    }
    bytes = Buffer.from(source);
  }
  if (role === "streaming") {
    const decodeWorker = workerDescriptors.find((worker) => worker.role === "decode");
    if (decodeWorker === undefined) {
      throw new Error("Decode worker must be assembled before the streaming worker");
    }
    bytes = Buffer.from(
      replaceExactlyOnce(
        bytes.toString("utf8"),
        "__DECODE_WORKER_ARTIFACT__",
        decodeWorker.outputName,
      ),
    );
  }
  const outputName = contentAddressedNameFromBytes(`${role}-worker`, bytes);
  await writeFile(join(outputRoot, "immutable", outputName), bytes);
  workerDescriptors.push({ outputName, role });
}

const engineInput = join(repositoryRoot, "engine/dist/engine.js");
let engineSource = await readFile(engineInput, "utf8");
engineSource = replaceExactlyOnce(engineSource, "__WLLAMA_WASM_ARTIFACT__", wllamaWasmOutputName);
for (const worker of workerDescriptors.filter((candidate) => candidate.role !== "decode")) {
  engineSource = replaceExactlyOnce(
    engineSource,
    `__${worker.role.toUpperCase().replaceAll("-", "_")}_WORKER_ARTIFACT__`,
    worker.outputName,
  );
}
engineSource = replaceExactlyOnce(
  engineSource,
  "__WASM_THREAD_SPIKE_ARTIFACT__",
  wasmThreadOutputName,
);
engineSource = replaceExactlyOnce(
  engineSource,
  "__MEMORY32_SPIKE_ARTIFACT__",
  memory32SpikeOutputName,
);
engineSource = replaceExactlyOnce(
  engineSource,
  "__MEMORY64_SPIKE_ARTIFACT__",
  memory64SpikeOutputName,
);
const engineOutputName = contentAddressedNameFromBytes("engine", Buffer.from(engineSource));
await writeFile(join(outputRoot, "immutable", engineOutputName), engineSource);

const htmlModuleReferences = [];
for (const descriptor of moduleDescriptors) {
  const input = join(repositoryRoot, descriptor.input);
  const outputName = await contentAddressedName(descriptor.scope, input);
  const output = join(outputRoot, "immutable", outputName);
  if (descriptor.mode === "rename") {
    await rename(join(outputRoot, descriptor.input.replace("app/dist/", "")), output);
  } else {
    await cp(input, output);
  }
  htmlModuleReferences.push({ ...descriptor, outputName });
}
htmlModuleReferences.push({
  scope: "engine",
  token: "__ENGINE_ARTIFACT__",
  outputName: engineOutputName,
});

const indexPath = join(outputRoot, "index.html");
let index = await readFile(indexPath, "utf8");
for (const descriptor of htmlModuleReferences) {
  const replacement = descriptor.token.startsWith("/immutable/")
    ? `/immutable/${descriptor.outputName}`
    : descriptor.outputName;
  index = replaceExactlyOnce(index, descriptor.token, replacement);
}
validateImmutableReferences(index, htmlModuleReferences.length);
await writeFile(indexPath, index);

const artifacts = (await collectArtifacts(outputRoot)).sort((left, right) =>
  compareCodepoints(left.path, right.path),
);
await writeFile(
  join(outputRoot, "build-manifest.json"),
  `${JSON.stringify(
    {
      schemaVersion: 8,
      gameContentEntrypoints,
      workerEntrypoints: workerDescriptors.map((worker) => ({
        path: `immutable/${worker.outputName}`,
        role: worker.role,
        targetType: "worker",
      })),
      artifacts,
    },
    null,
    2,
  )}\n`,
);
runPnpm(["verify:repeatable"]);

async function writeGreyboxWorldArtifacts() {
  const gameModuleUrl = pathToFileURL(join(repositoryRoot, "game/dist/game.js"));
  const engineModuleUrl = pathToFileURL(join(repositoryRoot, "engine/dist/engine.js"));
  const [gameModule, engineModule] = await Promise.all([
    import(gameModuleUrl.href),
    import(engineModuleUrl.href),
  ]);
  if (
    typeof gameModule.createGreyboxScene !== "function" ||
    !Array.isArray(gameModule.GREYBOX_DISTRICT_SPECS)
  ) {
    throw new Error("Game build does not export the greybox generator and district registry");
  }
  if (typeof engineModule.validateGreyboxDistrict !== "function") {
    throw new Error("Engine build does not export validateGreyboxDistrict");
  }
  if (gameModule.GREYBOX_DISTRICT_SPECS.length === 0) {
    throw new Error("Game greybox district registry is empty");
  }
  const districtIds = new Set();
  const artifactScopes = new Set();
  const entrypoints = [];
  for (const districtSpec of gameModule.GREYBOX_DISTRICT_SPECS) {
    const district = gameModule.createGreyboxScene(districtSpec).world;
    engineModule.validateGreyboxDistrict(district);
    if (districtIds.has(district.id))
      throw new Error(`Duplicate greybox district id ${district.id}`);
    districtIds.add(district.id);
    const artifactScope = contentArtifactScope(district.id);
    if (artifactScopes.has(artifactScope)) {
      throw new Error(`Greybox district artifact scope collides: ${artifactScope}`);
    }
    artifactScopes.add(artifactScope);
    const cellEntries = [];
    for (const cell of district.cells) {
      const bytes = Buffer.from(
        `${JSON.stringify({ districtId: district.id, schemaVersion: district.schemaVersion, cell })}\n`,
      );
      const coordinate = cell.coordinate.map(coordinateArtifactToken).join("-");
      const outputName = contentAddressedNameFromBytes(
        `${artifactScope}-cell-${coordinate}`,
        bytes,
        ".json",
      );
      await writeFile(join(outputRoot, "immutable", outputName), bytes);
      cellEntries.push({
        bytes: bytes.byteLength,
        cellId: cell.id,
        coordinate: cell.coordinate,
        path: `immutable/${outputName}`,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    const indexBytes = Buffer.from(
      `${JSON.stringify({
        bounds: district.bounds,
        cellSizeMeters: district.cellSizeMeters,
        cells: cellEntries,
        districtId: district.id,
        generator: district.generator,
        lodHysteresisMeters: district.lodHysteresisMeters,
        markers: district.markers,
        materials: district.materials,
        schemaVersion: district.schemaVersion,
        standardTraversalMetersPerSecond: district.standardTraversalMetersPerSecond,
        units: district.units,
      })}\n`,
    );
    const indexName = contentAddressedNameFromBytes(`${artifactScope}-index`, indexBytes, ".json");
    await writeFile(join(outputRoot, "immutable", indexName), indexBytes);
    entrypoints.push(
      Object.freeze({
        districtId: district.id,
        path: `immutable/${indexName}`,
        schemaVersion: district.schemaVersion,
        scope: "game-specific",
        targetType: "district",
      }),
    );
  }
  return Object.freeze(entrypoints);
}

function contentArtifactScope(id) {
  const scope = id
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
  if (scope === "") throw new Error(`Greybox district id has no safe artifact scope: ${id}`);
  return scope;
}

function coordinateArtifactToken(value) {
  if (!Number.isInteger(value))
    throw new Error(`Greybox cell coordinate is not an integer: ${value}`);
  const magnitude = String(Math.abs(value)).padStart(2, "0");
  return value < 0 ? `n${magnitude}` : magnitude;
}

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
  return contentAddressedNameFromBytes(scope, bytes);
}

function contentAddressedNameFromBytes(scope, bytes, extension = ".js") {
  const digest = createHash("sha256").update(bytes).digest("hex");
  return `${scope}-${digest}${extension}`;
}

function replaceExactlyOnce(source, token, replacement) {
  const first = source.indexOf(token);
  if (first === -1) throw new Error(`Required assembly token is missing: ${token}`);
  if (source.indexOf(token, first + token.length) !== -1) {
    throw new Error(`Required assembly token is ambiguous: ${token}`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + token.length)}`;
}

function validateImmutableReferences(index, expectedCount) {
  const references = index.match(/\/immutable\/[^"'\s<]+/g) ?? [];
  if (references.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} immutable module references; found ${references.length}`,
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
