import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const crateRoot = join(repositoryRoot, "engine/wasm/thread-spike");
const defaultOutputDirectory = join(crateRoot, "pkg");
const defaultTargetDirectory = join(crateRoot, "target");
const rustArtifactName = "parallax_wasm_thread_spike.wasm";
const wasmBindgenVersion = "0.2.126";
const binaryenVersion = "131.0.0";
const rustcCommit = "d0babd8b6b05ef9bb65d42f928cef4129d64cf65";
const cargoCommit = "59800466c5c41c444d264b1010b4d57e85a7117f";
// wasm-bindgen's pinned thread transform raises this fixed 32-page linker memory to the
// 33-page shared import instantiated by the engine; see WASM_THREAD_SPIKE_MEMORY_PAGES.
const memoryBytes = 2 * 1024 * 1024;
const requiredFeatures = Object.freeze([
  "--enable-threads",
  "--enable-simd",
  "--enable-relaxed-simd",
  "--enable-bulk-memory",
]);

export async function buildRustWasm({
  outputDirectory = defaultOutputDirectory,
  targetDirectory = defaultTargetDirectory,
} = {}) {
  const cargo = resolveTool("cargo");
  const rustc = resolveTool("rustc");
  const wasmBindgen = resolveTool("wasm-bindgen");
  verifyOutput(
    cargo,
    ["--version", "--verbose"],
    new RegExp(`^cargo 1\\.99\\.0-nightly [\\s\\S]*^commit-hash: ${cargoCommit}$`, "m"),
    "pinned Cargo",
  );
  verifyOutput(
    rustc,
    ["--version", "--verbose"],
    new RegExp(`^rustc 1\\.99\\.0-nightly [\\s\\S]*^commit-hash: ${rustcCommit}$`, "m"),
    "pinned rustc",
  );
  verifyOutput(
    wasmBindgen,
    ["--version"],
    new RegExp(`^wasm-bindgen ${escapeRegExp(wasmBindgenVersion)}$`),
    "pinned wasm-bindgen CLI",
  );
  const binaryenPackage = JSON.parse(
    await readFile(join(repositoryRoot, "node_modules/binaryen/package.json"), "utf8"),
  );
  if (binaryenPackage.version !== binaryenVersion) {
    throw new Error(
      `Expected Binaryen ${binaryenVersion}; received ${String(binaryenPackage.version)}`,
    );
  }

  await mkdir(outputDirectory, { recursive: true });
  const rustFlags = [
    `--remap-path-prefix=${repositoryRoot}=/parallax`,
    "-C",
    "target-feature=+atomics,+bulk-memory,+mutable-globals,+simd128,+relaxed-simd",
    "-C",
    "link-arg=--import-memory",
    "-C",
    "link-arg=--shared-memory",
    "-C",
    `link-arg=--initial-memory=${memoryBytes}`,
    "-C",
    `link-arg=--max-memory=${memoryBytes}`,
    ...[
      "__heap_base",
      "__wasm_init_tls",
      "__tls_size",
      "__tls_align",
      "__tls_base",
      "__stack_pointer",
    ].flatMap((symbol) => ["-C", `link-arg=--export=${symbol}`]),
  ];
  const env = {
    ...process.env,
    CARGO_ENCODED_RUSTFLAGS: rustFlags.join("\x1f"),
    LANG: "C",
    LC_ALL: "C",
    SOURCE_DATE_EPOCH: "0",
    TZ: "UTC",
  };
  run(cargo, ["fmt", "--manifest-path", join(crateRoot, "Cargo.toml"), "--", "--check"], env);
  run(
    cargo,
    [
      "build",
      "-Z",
      "build-std=std,panic_abort",
      "--locked",
      "--manifest-path",
      join(crateRoot, "Cargo.toml"),
      "--target",
      "wasm32-unknown-unknown",
      "--target-dir",
      targetDirectory,
      "--release",
    ],
    env,
  );

  const rustArtifact = join(targetDirectory, "wasm32-unknown-unknown/release", rustArtifactName);
  run(
    wasmBindgen,
    ["--target", "web", "--out-dir", outputDirectory, "--out-name", "thread_spike", rustArtifact],
    env,
  );

  const generatedWasm = join(outputDirectory, "thread_spike_bg.wasm");
  const optimizedWasm = join(outputDirectory, "thread_spike_bg.optimized.wasm");
  const wasmOpt = join(repositoryRoot, "node_modules/binaryen/bin/wasm-opt");
  run(
    process.execPath,
    [
      wasmOpt,
      generatedWasm,
      "-o",
      optimizedWasm,
      "-Oz",
      "--enable-threads",
      "--enable-simd",
      "--enable-relaxed-simd",
      "--enable-bulk-memory",
      "--enable-bulk-memory-opt",
    ],
    env,
  );
  const featureResult = run(
    process.execPath,
    [
      wasmOpt,
      optimizedWasm,
      "--print-features",
      "--enable-threads",
      "--enable-simd",
      "--enable-relaxed-simd",
      "--enable-bulk-memory",
      "--enable-bulk-memory-opt",
      "-o",
      join(outputDirectory, "thread_spike_features.wasm"),
    ],
    env,
    "pipe",
  );
  await rm(join(outputDirectory, "thread_spike_features.wasm"), { force: true });
  for (const feature of requiredFeatures) {
    if (!featureResult.stdout.includes(feature)) {
      throw new Error(`Optimized WASM omitted required feature ${feature}`);
    }
  }
  await rm(generatedWasm, { force: true });
  await rename(optimizedWasm, generatedWasm);

  const module = new WebAssembly.Module(await readFile(generatedWasm));
  const imports = WebAssembly.Module.imports(module);
  const memoryImports = imports.filter((entry) => entry.kind === "memory");
  if (
    memoryImports.length !== 1 ||
    memoryImports[0]?.name !== "memory" ||
    memoryImports[0]?.module !== "./thread_spike_bg.js"
  ) {
    throw new Error(
      `Threaded WASM must have exactly one expected memory import; received ${JSON.stringify(imports)}`,
    );
  }
  return Object.freeze({ outputDirectory, targetDirectory });
}

function resolveTool(name) {
  const extension = process.platform === "win32" ? ".exe" : "";
  const explicit = process.env[`PARALLAX_${name.toUpperCase().replaceAll("-", "_")}_PATH`];
  return explicit ?? join(homedir(), ".cargo/bin", `${name}${extension}`);
}

function verifyOutput(command, arguments_, pattern, label) {
  const result = run(command, arguments_, process.env, "pipe");
  const output = result.stdout.trim();
  if (!pattern.test(output)) throw new Error(`Expected ${label}; received ${output}`);
}

function run(command, arguments_, env, stdio = "inherit") {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    encoding: stdio === "pipe" ? "utf8" : undefined,
    env,
    stdio,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? "unknown"}`);
  }
  return result;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildRustWasm();
}
