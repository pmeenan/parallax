import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const crateRoot = join(repositoryRoot, "engine/wasm/thread-spike");
const threadSpikeProtocolPath = join(
  repositoryRoot,
  "engine/src/wasm/wasm-thread-spike-protocol.ts",
);
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
const wasmPageBytes = 64 * 1024;
const linkerHeapBase = 1_050_048;
const wasmBindgenOriginalScratchBase = linkerHeapBase;
const wasmBindgenOriginalScratchLock = wasmBindgenOriginalScratchBase + 4;
const wasmBindgenOriginalTempStack = wasmBindgenOriginalScratchBase + wasmPageBytes;
// Rust nightly-2026-07-16's dlmalloc treats [__heap_base, __heap_end) as a
// pre-existing allocator chunk. wasm-bindgen 0.2.126 places its thread counter,
// temporary-stack lock, and scratch stack at __heap_base, so allocator metadata can
// overwrite the lock. Relocate that generated scratch page to the page wasm-bindgen
// appended after the linker's __heap_end while preserving the 33-page memory contract.
const threadRuntimeScratchBase = memoryBytes;
const threadRuntimeScratchLock = threadRuntimeScratchBase + 4;
const threadRuntimeTempStack = threadRuntimeScratchBase + wasmPageBytes;
const requiredFeatures = Object.freeze([
  "--enable-threads",
  "--enable-simd",
  "--enable-relaxed-simd",
  "--enable-bulk-memory",
]);
const threadRuntimeStateOffsets = Object.freeze({
  allocatorLock: threadRuntimeScratchLock,
  initializedInstanceCount: threadRuntimeScratchBase,
  sharedInitializationState: 1_050_040,
});

export async function buildRustWasm({
  outputDirectory = defaultOutputDirectory,
  targetDirectory = defaultTargetDirectory,
} = {}) {
  await verifyEngineThreadRuntimeStateOffsets();
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
  await relocateThreadRuntimeScratchPage(outputDirectory, env);
  await instrumentThreadSpikeBindings(outputDirectory);

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
      "--enable-reference-types",
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
      "--enable-reference-types",
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
  await verifyThreadRuntimeStateOffsets(optimizedWasm, outputDirectory, env);
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

async function relocateThreadRuntimeScratchPage(outputDirectory, env) {
  const wasmPath = join(outputDirectory, "thread_spike_bg.wasm");
  const watPath = join(outputDirectory, "thread_spike.thread-runtime-relocation.wat");
  const relocatedWasmPath = join(outputDirectory, "thread_spike.thread-runtime-relocated.wasm");
  const wasmDis = join(repositoryRoot, "node_modules/binaryen/bin/wasm-dis");
  const wasmAs = join(repositoryRoot, "node_modules/binaryen/bin/wasm-as");
  const featureFlags = [
    "--enable-threads",
    "--enable-simd",
    "--enable-relaxed-simd",
    "--enable-bulk-memory",
    "--enable-reference-types",
  ];
  try {
    run(process.execPath, [wasmDis, wasmPath, "-o", watPath, ...featureFlags], env);
    let wat = await readFile(watPath, "utf8");
    wat = replaceRegexExactlyOnce(
      wat,
      new RegExp(
        `(\\(i32\\.atomic\\.rmw\\.add\\s+)\\(i32\\.const ${String(
          wasmBindgenOriginalScratchBase,
        )}\\)`,
        "g",
      ),
      `$1(i32.const ${String(threadRuntimeScratchBase)})`,
      "thread counter",
    );
    wat = replaceExactlyCount(
      wat,
      `(i32.const ${String(wasmBindgenOriginalScratchLock)})`,
      `(i32.const ${String(threadRuntimeScratchLock)})`,
      8,
      "temporary-stack lock",
    );
    wat = replaceExactlyCount(
      wat,
      `(i32.const ${String(wasmBindgenOriginalTempStack)})`,
      `(i32.const ${String(threadRuntimeTempStack)})`,
      2,
      "temporary stack",
    );
    const remainingHeapBaseReferences = countOccurrences(
      wat,
      `(i32.const ${String(linkerHeapBase)})`,
    );
    if (remainingHeapBaseReferences !== 4) {
      throw new Error(
        `Expected four pinned dlmalloc linker-heap references after thread-runtime relocation; found ${String(
          remainingHeapBaseReferences,
        )}`,
      );
    }
    await writeFile(watPath, wat);
    run(process.execPath, [wasmAs, watPath, "-o", relocatedWasmPath, ...featureFlags], env);
    await rm(wasmPath, { force: true });
    await rename(relocatedWasmPath, wasmPath);
  } finally {
    await rm(watPath, { force: true });
    await rm(relocatedWasmPath, { force: true });
  }
}

async function instrumentThreadSpikeBindings(outputDirectory) {
  const javascriptPath = join(outputDirectory, "thread_spike.js");
  const declarationsPath = join(outputDirectory, "thread_spike.d.ts");
  let source = await readFile(javascriptPath, "utf8");
  source = replaceExactlyOnce(
    source,
    "function __wbg_finalize_init(instance, module, thread_stack_size) {",
    "function __wbg_finalize_init(instance, module, thread_stack_size, on_phase) {",
    "finalize-init phase callback signature",
  );
  source = replaceExactlyOnce(
    source,
    "    wasm.__wbindgen_start(thread_stack_size);\n    return wasm;",
    [
      '    on_phase?.("runtime-startup-started");',
      "    wasm.__wbindgen_start(thread_stack_size);",
      '    on_phase?.("runtime-started");',
      "    return wasm;",
    ].join("\n"),
    "runtime-startup phase callbacks",
  );
  source = replaceExactlyOnce(
    source,
    "    let thread_stack_size\n    if (module !== undefined) {",
    "    let thread_stack_size, on_phase\n    if (module !== undefined) {",
    "initSync phase callback local",
  );
  source = replaceExactlyOnce(
    source,
    "            ({module, memory, thread_stack_size} = module)",
    "            ({module, memory, thread_stack_size, on_phase} = module)",
    "initSync phase callback destructuring",
  );
  source = replaceExactlyOnce(
    source,
    [
      "    const imports = __wbg_get_imports(memory);",
      "    if (!(module instanceof WebAssembly.Module)) {",
      "        module = new WebAssembly.Module(module);",
      "    }",
      "    const instance = new WebAssembly.Instance(module, imports);",
      "    return __wbg_finalize_init(instance, module, thread_stack_size);",
    ].join("\n"),
    [
      "    if (on_phase !== undefined && typeof on_phase !== 'function') {",
      "        throw new Error('on_phase must be a function');",
      "    }",
      "    const imports = __wbg_get_imports(memory);",
      "    if (!(module instanceof WebAssembly.Module)) {",
      "        module = new WebAssembly.Module(module);",
      "    }",
      '    on_phase?.("module-instantiation-started");',
      "    const instance = new WebAssembly.Instance(module, imports);",
      '    on_phase?.("module-instantiated");',
      "    return __wbg_finalize_init(instance, module, thread_stack_size, on_phase);",
    ].join("\n"),
    "module-instantiation phase callbacks",
  );
  await writeFile(javascriptPath, source);

  let declarations = await readFile(declarationsPath, "utf8");
  declarations = replaceExactlyOnce(
    declarations,
    "@param {{ module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number }} module",
    "@param {{ module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number, on_phase?: (phase: string) => void }} module",
    "initSync JSDoc phase callback",
  );
  declarations = replaceExactlyOnce(
    declarations,
    "export function initSync(module: { module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number } | SyncInitInput, memory?: WebAssembly.Memory): InitOutput;",
    "export function initSync(module: { module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number, on_phase?: (phase: string) => void } | SyncInitInput, memory?: WebAssembly.Memory): InitOutput;",
    "initSync declaration phase callback",
  );
  await writeFile(declarationsPath, declarations);
}

async function verifyEngineThreadRuntimeStateOffsets() {
  const source = await readFile(threadSpikeProtocolPath, "utf8");
  const declaration = "export const WASM_THREAD_SPIKE_RUNTIME_STATE_OFFSETS = Object.freeze({";
  const declarationStart = source.indexOf(declaration);
  const declarationEnd =
    declarationStart < 0 ? -1 : source.indexOf("\n});", declarationStart + declaration.length);
  if (declarationStart < 0 || declarationEnd < 0) {
    throw new Error(
      "Engine protocol omitted the pinned WASM_THREAD_SPIKE_RUNTIME_STATE_OFFSETS declaration",
    );
  }
  const declarationSource = source.slice(declarationStart, declarationEnd);
  for (const [field, expected] of Object.entries(threadRuntimeStateOffsets)) {
    const matches = [...declarationSource.matchAll(new RegExp(`\\b${field}:\\s*([\\d_]+)`, "g"))];
    if (matches.length !== 1) {
      throw new Error(
        `Engine protocol must declare exactly one ${field} WASM thread runtime-state offset; found ${String(
          matches.length,
        )}`,
      );
    }
    const captured = matches[0]?.[1];
    const actual = captured === undefined ? Number.NaN : Number(captured.replaceAll("_", ""));
    if (actual !== expected) {
      throw new Error(
        `Engine protocol WASM thread runtime-state offset drifted for ${field}: build expects ${String(
          expected,
        )}, protocol declares ${String(actual)}`,
      );
    }
  }
}

async function verifyThreadRuntimeStateOffsets(wasmPath, outputDirectory, env) {
  const wasmDis = join(repositoryRoot, "node_modules/binaryen/bin/wasm-dis");
  const watPath = join(outputDirectory, "thread_spike.runtime-state-check.wat");
  try {
    run(
      process.execPath,
      [
        wasmDis,
        wasmPath,
        "-o",
        watPath,
        "--enable-threads",
        "--enable-simd",
        "--enable-relaxed-simd",
        "--enable-bulk-memory",
        "--enable-reference-types",
      ],
      env,
    );
    const compactWat = (await readFile(watPath, "utf8")).replaceAll(/\s+/g, " ");
    const requiredRuntimeOperations = [
      `(i32.atomic.rmw.cmpxchg (i32.const ${threadRuntimeStateOffsets.sharedInitializationState})`,
      `(i32.atomic.store (i32.const ${threadRuntimeStateOffsets.sharedInitializationState})`,
      `(memory.atomic.wait32 (i32.const ${threadRuntimeStateOffsets.sharedInitializationState})`,
      `(memory.atomic.notify (i32.const ${threadRuntimeStateOffsets.sharedInitializationState})`,
      `(i32.atomic.rmw.add (i32.const ${threadRuntimeStateOffsets.initializedInstanceCount})`,
      `(i32.atomic.rmw.cmpxchg (i32.const ${threadRuntimeStateOffsets.allocatorLock})`,
      `(i32.atomic.store (i32.const ${threadRuntimeStateOffsets.allocatorLock})`,
      `(memory.atomic.wait32 (i32.const ${threadRuntimeStateOffsets.allocatorLock})`,
      `(memory.atomic.notify (i32.const ${threadRuntimeStateOffsets.allocatorLock})`,
    ];
    for (const operation of requiredRuntimeOperations) {
      if (!compactWat.includes(operation)) {
        throw new Error(
          `Threaded WASM runtime-state diagnostic operation drifted from the optimized module: ${operation}`,
        );
      }
    }
  } finally {
    await rm(watPath, { force: true });
  }
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceExactlyOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  const last = source.lastIndexOf(search);
  if (first < 0 || first !== last) {
    throw new Error(
      `Expected exactly one pinned wasm-bindgen ${label} fragment; found ${
        first < 0 ? 0 : "multiple"
      }`,
    );
  }
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function replaceRegexExactlyOnce(source, pattern, replacement, label) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one pinned wasm-bindgen ${label} fragment; found ${String(matches.length)}`,
    );
  }
  return source.replace(pattern, replacement);
}

function replaceExactlyCount(source, search, replacement, expectedCount, label) {
  const count = countOccurrences(source, search);
  if (count !== expectedCount) {
    throw new Error(
      `Expected ${String(expectedCount)} pinned wasm-bindgen ${label} fragments; found ${String(
        count,
      )}`,
    );
  }
  return source.replaceAll(search, replacement);
}

function countOccurrences(source, search) {
  return source.split(search).length - 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildRustWasm();
}
