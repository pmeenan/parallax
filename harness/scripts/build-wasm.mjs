import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const crateRoot = join(repositoryRoot, "engine/wasm/thread-spike");
const memory64SpikeRoot = join(repositoryRoot, "engine/wasm/memory64-spike");
const defaultOutputDirectory = join(crateRoot, "pkg");
const defaultTargetDirectory = join(crateRoot, "target");
const defaultMemory64OutputDirectory = join(memory64SpikeRoot, "pkg");
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
  await verifyBinaryenVersion();

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

export async function buildMemory64Wasm({ outputDirectory = defaultMemory64OutputDirectory } = {}) {
  await verifyBinaryenVersion();
  await mkdir(outputDirectory, { recursive: true });
  const wasmAs = join(repositoryRoot, "node_modules/binaryen/bin/wasm-as");
  const wasmOpt = join(repositoryRoot, "node_modules/binaryen/bin/wasm-opt");
  const env = {
    ...process.env,
    LANG: "C",
    LC_ALL: "C",
    SOURCE_DATE_EPOCH: "0",
    TZ: "UTC",
  };
  for (const variant of ["memory32", "memory64"]) {
    const assembled = join(outputDirectory, `${variant}.assembled.wasm`);
    const output = join(outputDirectory, `${variant}.wasm`);
    run(
      process.execPath,
      [wasmAs, join(memory64SpikeRoot, `${variant}.wat`), "-o", assembled, "--enable-memory64"],
      env,
    );
    run(process.execPath, [wasmOpt, assembled, "-o", output, "-Oz", "--enable-memory64"], env);
    await rm(assembled, { force: true });
    const featureOutput = join(outputDirectory, `${variant}.features.wasm`);
    const featureResult = run(
      process.execPath,
      [
        wasmOpt,
        output,
        "--print-features",
        ...(variant === "memory64" ? ["--enable-memory64"] : []),
        "-o",
        featureOutput,
      ],
      env,
      "pipe",
    );
    await rm(featureOutput, { force: true });
    const hasMemory64 = featureResult.stdout.includes("--enable-memory64");
    if (hasMemory64 !== (variant === "memory64")) {
      throw new Error(`${variant}.wasm reported an unexpected memory64 feature state`);
    }
    if (variant === "memory64") {
      const memory32OnlyOutput = join(outputDirectory, "memory64.memory32-only-check.wasm");
      try {
        requireFailure(
          process.execPath,
          [wasmOpt, output, "-o", memory32OnlyOutput],
          env,
          /require memory64/,
          "memory64.wasm validation without the memory64 feature",
        );
      } finally {
        await rm(memory32OnlyOutput, { force: true });
      }
    }
    const bytes = await readFile(output);
    if (!WebAssembly.validate(bytes)) {
      throw new Error(`${variant}.wasm is not valid in the pinned Node runtime`);
    }
    const module = new WebAssembly.Module(bytes);
    const imports = WebAssembly.Module.imports(module).map(
      (entry) => `${entry.kind}:${entry.module}:${entry.name}`,
    );
    if (JSON.stringify(imports) !== JSON.stringify(["memory:env:memory"])) {
      throw new Error(`${variant}.wasm imports drifted: ${JSON.stringify(imports)}`);
    }
    const exports = WebAssembly.Module.exports(module)
      .map((entry) => `${entry.kind}:${entry.name}`)
      .sort();
    const expectedExports =
      variant === "memory64"
        ? ["function:grow_and_touch_high", "function:prepare", "function:run", "memory:memory"]
        : ["function:prepare", "function:run", "memory:memory"];
    if (JSON.stringify(exports) !== JSON.stringify(expectedExports)) {
      throw new Error(`${variant}.wasm exports drifted: ${JSON.stringify(exports)}`);
    }
  }
  return Object.freeze({ outputDirectory });
}

async function verifyBinaryenVersion() {
  const binaryenPackage = JSON.parse(
    await readFile(join(repositoryRoot, "node_modules/binaryen/package.json"), "utf8"),
  );
  if (binaryenPackage.version !== binaryenVersion) {
    throw new Error(
      `Expected Binaryen ${binaryenVersion}; received ${String(binaryenPackage.version)}`,
    );
  }
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

function requireFailure(command, arguments_, env, expectedDiagnostic, label) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env,
    stdio: "pipe",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status === 0) throw new Error(`${label} unexpectedly succeeded`);
  const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (!expectedDiagnostic.test(diagnostic)) {
    throw new Error(`${label} failed for an unexpected reason: ${diagnostic.trim()}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildRustWasm();
  await buildMemory64Wasm();
}
