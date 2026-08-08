import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { scaleStreamingDependencyResourceId } from "../../engine/src/streaming/scale-streaming-resource-id.ts";
import { buildRustWasm } from "./build-wasm.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const outputRoot = join(repositoryRoot, "dist");
const moduleDescriptors = Object.freeze([
  {
    input: "app/dist/immutable/app.js",
    mode: "rename",
    scope: "app",
    token: "/immutable/app.js",
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
runPnpm(["exec", "tsc", "-b"]);
runPnpm(["--filter", "@parallax/engine", "build"]);
runPnpm(["--filter", "@parallax/game", "build"]);
runPnpm(["--filter", "@parallax/app", "build"]);

const gameRuntimeArtifacts = (await collectArtifacts(join(repositoryRoot, "game/dist")))
  .map((artifact) => artifact.path)
  .filter((path) => path !== "types.tsbuildinfo" && !path.startsWith("types/"))
  .sort(compareCodepoints);
const expectedGameRuntimeArtifacts = ["game-simulation.js", "game.js"];
if (JSON.stringify(gameRuntimeArtifacts) !== JSON.stringify(expectedGameRuntimeArtifacts)) {
  throw new Error(
    `Game build must contain only TypeScript outputs and two self-contained entrypoints; received ${gameRuntimeArtifacts.join(", ")}`,
  );
}

const engineInput = join(repositoryRoot, "engine/dist/engine.js");
const engineBuildModule = await import(pathToFileURL(engineInput).href);
if (
  !Number.isSafeInteger(engineBuildModule.BUILD_MANIFEST_SCHEMA_VERSION) ||
  !Number.isSafeInteger(engineBuildModule.INSTALL_MANIFEST_SCHEMA_VERSION) ||
  !Number.isSafeInteger(engineBuildModule.OFFLINE_SHELL_GENERATION_SCHEMA_VERSION) ||
  !Number.isSafeInteger(engineBuildModule.OFFLINE_SHELL_SAVE_SCHEMA_VERSION) ||
  !Number.isSafeInteger(engineBuildModule.STREAMING_DISTRICT_INDEX_SCHEMA_VERSION) ||
  engineBuildModule.STREAMING_DISTRICT_INDEX_SCHEMA_VERSION < 1 ||
  typeof engineBuildModule.INSTALL_MANIFEST_PATH !== "string" ||
  typeof engineBuildModule.INSTALL_MANIFEST_GAME_ID !== "string" ||
  typeof engineBuildModule.OFFLINE_SHELL_SERVICE_WORKER_PATH !== "string"
) {
  throw new Error("Engine build does not export the build/install/offline schema contracts");
}
const buildManifestSchemaVersion = engineBuildModule.BUILD_MANIFEST_SCHEMA_VERSION;
const districtIndexSchemaVersion = engineBuildModule.STREAMING_DISTRICT_INDEX_SCHEMA_VERSION;
const installManifestGameId = engineBuildModule.INSTALL_MANIFEST_GAME_ID;
const installManifestPath = engineBuildModule.INSTALL_MANIFEST_PATH;
const installManifestSchemaVersion = engineBuildModule.INSTALL_MANIFEST_SCHEMA_VERSION;
const offlineShellGenerationSchemaVersion =
  engineBuildModule.OFFLINE_SHELL_GENERATION_SCHEMA_VERSION;
const offlineShellSaveSchemaVersion = engineBuildModule.OFFLINE_SHELL_SAVE_SCHEMA_VERSION;
const offlineShellServiceWorkerPath = engineBuildModule.OFFLINE_SHELL_SERVICE_WORKER_PATH;

await mkdir(join(outputRoot, "immutable"), { recursive: true });
await cp(join(repositoryRoot, "app/dist"), outputRoot, { recursive: true });
await cp(
  join(repositoryRoot, "engine/dist/service-worker.js"),
  join(outputRoot, "service-worker.js"),
);
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

const workerDescriptors = [];
for (const role of ["decode", "installer", "render", "sim", "streaming", "wasm-thread"]) {
  let bytes = await readFile(join(repositoryRoot, `engine/dist/${role}-worker.js`));
  if (role === "render") {
    let source = bytes.toString("utf8");
    for (const artifact of decoderWasmArtifacts) {
      source = replaceExactlyOnce(source, artifact.token, artifact.outputName);
    }
    bytes = Buffer.from(source);
  }
  if (role === "decode") {
    const msc = decoderWasmArtifacts.find((artifact) => artifact.scope === "msc-transcoder");
    if (msc === undefined) throw new Error("MSC decoder artifact is unavailable");
    bytes = Buffer.from(replaceExactlyOnce(bytes.toString("utf8"), msc.token, msc.outputName));
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
const engineOutputName = contentAddressedNameFromBytes("engine", Buffer.from(engineSource));
await writeFile(join(outputRoot, "immutable", engineOutputName), engineSource);
if (typeof engineBuildModule.serializePsoWarmupTrace !== "function") {
  throw new Error("Engine build does not export the PSO warmup trace contract");
}
const psoWarmupTraceBytes = Buffer.from(engineBuildModule.serializePsoWarmupTrace());
const psoWarmupTraceOutputName = contentAddressedNameFromBytes(
  "pso-warmup-trace",
  psoWarmupTraceBytes,
  ".json",
);
await writeFile(join(outputRoot, "immutable", psoWarmupTraceOutputName), psoWarmupTraceBytes);

const htmlModuleReferences = [];
const gameSimulationBytes = await readFile(join(repositoryRoot, "game/dist/game-simulation.js"));
const gameSimulationOutputName = contentAddressedNameFromBytes(
  "game-simulation",
  gameSimulationBytes,
);
await writeFile(join(outputRoot, "immutable", gameSimulationOutputName), gameSimulationBytes);
const gameSource = replaceExactlyOnce(
  await readFile(join(repositoryRoot, "game/dist/game.js"), "utf8"),
  "__GAME_SIMULATION_ARTIFACT__",
  gameSimulationOutputName,
);
const gameOutputName = contentAddressedNameFromBytes("game", Buffer.from(gameSource));
await writeFile(join(outputRoot, "immutable", gameOutputName), gameSource);
htmlModuleReferences.push({
  scope: "game",
  token: "__GAME_ARTIFACT__",
  outputName: gameOutputName,
});
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

const localArtifacts = (await collectArtifacts(outputRoot)).sort((left, right) =>
  compareCodepoints(left.path, right.path),
);
const installManifest = await createInstallManifest(localArtifacts, {
  gameContentEntrypoints,
  workerDescriptors,
});
const installManifestBytes = Buffer.from(`${JSON.stringify(installManifest, null, 2)}\n`);
await writeFile(join(outputRoot, installManifestPath), installManifestBytes);
const artifacts = [
  ...localArtifacts,
  {
    bytes: installManifestBytes.byteLength,
    path: installManifestPath,
    sha256: createHash("sha256").update(installManifestBytes).digest("hex"),
  },
].sort((left, right) => compareCodepoints(left.path, right.path));
await writeFile(
  join(outputRoot, "build-manifest.json"),
  `${JSON.stringify(
    {
      schemaVersion: buildManifestSchemaVersion,
      gameContentEntrypoints,
      installManifestEntrypoint: {
        path: installManifestPath,
        schemaVersion: installManifestSchemaVersion,
      },
      offlineShell: {
        generationSchemaVersion: offlineShellGenerationSchemaVersion,
        saveSchemaVersion: offlineShellSaveSchemaVersion,
        serviceWorkerPath: offlineShellServiceWorkerPath,
      },
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
await verifyInstallerRepairProductionReplayModuleGraph();

async function createInstallManifest(localArtifacts, context) {
  const engineModule = await import(
    pathToFileURL(join(repositoryRoot, "engine/dist/engine.js")).href
  );
  if (
    typeof engineModule.parseInstallManifest !== "function" ||
    typeof engineModule.parseStreamingCellArtifactSource !== "function" ||
    typeof engineModule.canonicalStreamingDistrictIndexResourceId !== "function" ||
    typeof engineModule.canonicalAppOwnedLlmModelResourceId !== "function" ||
    !Array.isArray(engineModule.APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS)
  ) {
    throw new Error("Engine build does not export the install-manifest and model contracts");
  }
  const districtIndexes = new Map(
    context.gameContentEntrypoints.map((entrypoint) => [entrypoint.path, entrypoint.districtId]),
  );
  const workerRoles = new Map(
    context.workerDescriptors.map((worker) => [`immutable/${worker.outputName}`, worker.role]),
  );
  const resources = localArtifacts.map((artifact) =>
    classifyLocalInstallArtifact(artifact, { districtIndexes, engineModule, workerRoles }),
  );
  for (const artifact of engineModule.APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS) {
    resources.push({
      bytes: artifact.bytes,
      id: engineModule.canonicalAppOwnedLlmModelResourceId(artifact.path),
      kind: "model",
      scope: "common",
      sha256: artifact.sha256,
      source: `immutable/model-${artifact.sha256}.gguf`,
      target: "opfs",
    });
  }
  resources.sort((left, right) => compareCodepoints(left.id, right.id));
  const candidate = {
    gameId: installManifestGameId,
    resources,
    schemaVersion: installManifestSchemaVersion,
  };
  engineModule.parseInstallManifest(
    candidate,
    resources.filter((resource) => resource.kind !== "model"),
  );
  return candidate;
}

function classifyLocalInstallArtifact(artifact, context) {
  if (artifact.path === "index.html") {
    return installResource(artifact, "app-shell-document-index", "document", "app-shell", "shell");
  }
  if (artifact.path === "service-worker.js") {
    return installResource(artifact, "common-worker-service", "worker", "common", "shell");
  }
  if (/^immutable\/app-[a-f0-9]{64}\.js$/.test(artifact.path)) {
    return installResource(artifact, "app-shell-module-app", "module", "app-shell", "shell");
  }
  if (/^immutable\/engine-[a-f0-9]{64}\.js$/.test(artifact.path)) {
    return installResource(artifact, "common-module-engine", "module", "common", "shell");
  }
  if (/^immutable\/game-[a-f0-9]{64}\.js$/.test(artifact.path)) {
    return installResource(
      artifact,
      "game-specific-module-game",
      "module",
      "game-specific",
      "shell",
    );
  }
  if (/^immutable\/game-simulation-[a-f0-9]{64}\.js$/.test(artifact.path)) {
    return installResource(
      artifact,
      "game-specific-module-simulation",
      "module",
      "game-specific",
      "shell",
    );
  }
  const workerRole = context.workerRoles.get(artifact.path);
  if (workerRole !== undefined) {
    return installResource(artifact, `common-worker-${workerRole}`, "worker", "common", "shell");
  }
  if (/^immutable\/[a-z0-9-]+-[a-f0-9]{64}\.wasm$/.test(artifact.path)) {
    const scope = artifact.path.replace(/^immutable\//, "").replace(/-[a-f0-9]{64}\.wasm$/, "");
    return installResource(artifact, `common-wasm-${scope}`, "wasm", "common", "shell");
  }
  if (/^immutable\/pso-warmup-trace-[a-f0-9]{64}\.json$/.test(artifact.path)) {
    return installResource(
      artifact,
      "game-specific-pso-warmup-trace",
      "asset-pack",
      "game-specific",
      "opfs",
    );
  }
  if (/^immutable\/representative-streaming-ktx2-[a-f0-9]{64}\.ktx2$/.test(artifact.path)) {
    return installResource(
      artifact,
      "game-specific-streaming-00-texture",
      "asset-pack",
      "game-specific",
      "opfs",
    );
  }
  if (/^immutable\/representative-streaming-meshopt-[a-f0-9]{64}\.meshopt$/.test(artifact.path)) {
    return installResource(
      artifact,
      "game-specific-streaming-01-mesh",
      "asset-pack",
      "game-specific",
      "opfs",
    );
  }
  const productionStreaming = artifact.path.match(
    /^immutable\/streaming-(texture|vertices|indices)-[a-f0-9]{64}\.(ktx2|meshopt)$/,
  );
  if (productionStreaming !== null) {
    const role = productionStreaming[1];
    return installResource(
      artifact,
      scaleStreamingDependencyResourceId(role, artifact.sha256),
      "asset-pack",
      "game-specific",
      "opfs",
    );
  }
  const districtId = context.districtIndexes.get(artifact.path);
  if (districtId !== undefined) {
    return installResource(
      artifact,
      context.engineModule.canonicalStreamingDistrictIndexResourceId(districtId),
      "district-index",
      "game-specific",
      "opfs",
    );
  }
  if (/^immutable\/[a-z0-9-]+-cell-/.test(artifact.path)) {
    const identity = context.engineModule.parseStreamingCellArtifactSource(artifact.path);
    if (identity.sha256 !== artifact.sha256) {
      throw new Error(`Streaming cell filename hash does not match artifact: ${artifact.path}`);
    }
    return installResource(artifact, identity.resourceId, "world-cell", "game-specific", "opfs");
  }
  throw new Error(`Production artifact has no install-manifest classification: ${artifact.path}`);
}

function installResource(artifact, id, kind, scope, target) {
  return {
    bytes: artifact.bytes,
    id,
    kind,
    scope,
    sha256: artifact.sha256,
    source: artifact.path,
    target,
  };
}

async function writeGreyboxWorldArtifacts() {
  const gameModuleUrl = pathToFileURL(join(repositoryRoot, "game/dist/game.js"));
  const engineModuleUrl = pathToFileURL(join(repositoryRoot, "engine/dist/engine.js"));
  const productionFixtureModuleUrl = pathToFileURL(
    join(repositoryRoot, "engine/src/streaming/production-compressed-fixtures.generated.ts"),
  );
  const [gameModule, engineModule, productionFixtureModule] = await Promise.all([
    import(gameModuleUrl.href),
    import(engineModuleUrl.href),
    import(productionFixtureModuleUrl.href),
  ]);
  if (
    typeof gameModule.createGreyboxScene !== "function" ||
    !Array.isArray(gameModule.GREYBOX_DISTRICT_SPECS)
  ) {
    throw new Error("Game build does not export the greybox generator and district registry");
  }
  if (
    typeof engineModule.validateGreyboxDistrict !== "function" ||
    typeof engineModule.canonicalStreamingCellArtifactIdentity !== "function" ||
    typeof engineModule.canonicalStreamingDistrictIndexResourceId !== "function" ||
    typeof engineModule.streamingDistrictArtifactScope !== "function"
  ) {
    throw new Error("Engine build does not export greybox and streaming-cell identity contracts");
  }
  if (gameModule.GREYBOX_DISTRICT_SPECS.length === 0) {
    throw new Error("Game greybox district registry is empty");
  }
  const districtIds = new Set();
  const artifactScopes = new Set();
  const entrypoints = [];
  const fixture = productionFixtureModule.PRODUCTION_COMPRESSED_STREAMING_FIXTURES?.find(
    ({ id }) => id === "compact",
  );
  if (
    fixture === undefined ||
    !Number.isSafeInteger(fixture.vertexCount) ||
    !Number.isSafeInteger(fixture.indexCount)
  ) {
    throw new Error("Accepted compact production compressed streaming fixture is unavailable");
  }
  const textureBytes = Buffer.from(fixture.ktx2, "base64");
  const vertexBytes = Buffer.from(fixture.attributes, "base64");
  const indexBytes = Buffer.from(fixture.indices, "base64");
  const fixtureId = (role, bytes) =>
    scaleStreamingDependencyResourceId(role, createHash("sha256").update(bytes).digest("hex"));
  const textureId = fixtureId("texture", textureBytes);
  const vertexId = fixtureId("vertices", vertexBytes);
  const indexId = fixtureId("indices", indexBytes);
  const dependencyResources = [
    writeCompressedFixture(textureBytes, "streaming-texture", ".ktx2", {
      decode: {
        colorSpace: "srgb",
        format: "rgba8",
        height: fixture.height,
        version: 1,
        width: fixture.width,
      },
      dependencies: [],
      format: "ktx2",
      resourceId: textureId,
    }),
    writeCompressedFixture(vertexBytes, "streaming-vertices", ".meshopt", {
      decode: {
        count: fixture.vertexCount,
        layout: "position-normal-uv-f32",
        mode: "ATTRIBUTES",
        stride: 32,
        version: 1,
      },
      dependencies: [textureId],
      format: "meshopt",
      resourceId: vertexId,
    }),
    writeCompressedFixture(indexBytes, "streaming-indices", ".meshopt", {
      decode: {
        count: fixture.indexCount,
        indexFormat: "uint32",
        mode: "TRIANGLES",
        stride: 4,
        version: 1,
        vertexCount: fixture.vertexCount,
      },
      dependencies: [textureId, vertexId],
      format: "meshopt",
      resourceId: indexId,
    }),
  ];
  const resolvedDependencyResources = await Promise.all(dependencyResources);
  for (const districtSpec of gameModule.GREYBOX_DISTRICT_SPECS) {
    const district = gameModule.createGreyboxScene(districtSpec).world;
    engineModule.validateGreyboxDistrict(district);
    if (districtIds.has(district.id))
      throw new Error(`Duplicate greybox district id ${district.id}`);
    districtIds.add(district.id);
    const artifactScope = engineModule.streamingDistrictArtifactScope(district.id);
    if (artifactScopes.has(artifactScope)) {
      throw new Error(`Greybox district artifact scope collides: ${artifactScope}`);
    }
    artifactScopes.add(artifactScope);
    const cellEntries = [];
    for (const cell of district.cells) {
      const bytes = Buffer.from(
        `${JSON.stringify({ districtId: district.id, schemaVersion: district.schemaVersion, cell })}\n`,
      );
      const identity = engineModule.canonicalStreamingCellArtifactIdentity(
        district.id,
        cell.coordinate,
        createHash("sha256").update(bytes).digest("hex"),
      );
      if (identity.cellId !== cell.id) {
        throw new Error(`Greybox cell identity is not canonical: ${cell.id}`);
      }
      const outputName = identity.source.replace(/^immutable\//, "");
      await writeFile(join(outputRoot, "immutable", outputName), bytes);
      cellEntries.push({
        bytes: bytes.byteLength,
        cellId: cell.id,
        coordinate: cell.coordinate,
        dependencies: [indexId],
        path: identity.source,
        sha256: identity.sha256,
      });
    }
    const indexBytes = Buffer.from(
      `${JSON.stringify({
        bounds: district.bounds,
        cellSizeMeters: district.cellSizeMeters,
        cells: cellEntries,
        districtId: district.id,
        materials: district.materials,
        resources: resolvedDependencyResources,
        schemaVersion: districtIndexSchemaVersion,
      })}\n`,
    );
    const indexName = contentAddressedNameFromBytes(`${artifactScope}-index`, indexBytes, ".json");
    await writeFile(join(outputRoot, "immutable", indexName), indexBytes);
    entrypoints.push(
      Object.freeze({
        districtId: district.id,
        path: `immutable/${indexName}`,
        schemaVersion: districtIndexSchemaVersion,
        scope: "game-specific",
        targetType: "district",
      }),
    );
  }
  return Object.freeze(entrypoints);
}

async function writeCompressedFixture(bytes, scope, extension, descriptor) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new Error(`Compressed streaming fixture ${scope} is empty`);
  }
  const body = Buffer.from(bytes);
  const sha256 = createHash("sha256").update(body).digest("hex");
  const outputName = `${scope}-${sha256}${extension}`;
  await writeFile(join(outputRoot, "immutable", outputName), body);
  return {
    bytes: body.byteLength,
    ...descriptor,
    path: `immutable/${outputName}`,
    sha256,
  };
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

async function verifyInstallerRepairProductionReplayModuleGraph() {
  const modulePath = join(
    repositoryRoot,
    "harness/dist/types/installer-repair-production-replay-run.js",
  );
  const contractModulePath = join(
    repositoryRoot,
    "harness/dist/types/installer-repair-production-replay-contract.js",
  );
  const [replayModule, contractModule] = await Promise.all([
    import(pathToFileURL(modulePath).href),
    import(pathToFileURL(contractModulePath).href),
  ]);
  contractModule.assertInstallerRepairProductionReplayCompiledModule(replayModule);
  const [buildBytes, installBytes] = await Promise.all([
    readFile(join(outputRoot, "build-manifest.json")),
    readFile(join(outputRoot, installManifestPath)),
  ]);
  replayModule.validateProductionReplayArtifactIdentity(buildBytes, installBytes);
  console.info("Installer Repair production replay compiled module graph: import passed");
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
