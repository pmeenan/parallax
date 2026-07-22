import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import { transform } from "esbuild";
import { defineConfig } from "rollup";

const outputDirectory = process.env.PARALLAX_ENGINE_OUTPUT_DIR ?? "dist";

const decoderFactorySources = Object.freeze({
  "\0parallax:draco-decoder-factory": Object.freeze({
    exportName: "DracoDecoderModule",
    path: resolve(import.meta.dirname, "node_modules/draco3dgltf/draco_decoder_gltf_nodejs.js"),
    trailer: ';"object"===typeof exports',
    topLevelThisProbeOccurrences: 1,
  }),
  "\0parallax:msc-transcoder-factory": Object.freeze({
    exportName: "MSC_TRANSCODER",
    path: resolve(
      import.meta.dirname,
      "node_modules/@babylonjs/ktx2decoder/wasm/msc_basis_transcoder.js",
    ),
    trailer: "if (typeof exports === 'object' && typeof module === 'object')",
    topLevelThisProbeOccurrences: 0,
  }),
});

function createDecoderFactoryPlugin() {
  return {
    name: "parallax-decoder-factories",
    resolveId(source) {
      const id = `\0${source}`;
      return Object.hasOwn(decoderFactorySources, id) ? id : null;
    },
    load(id) {
      const descriptor = decoderFactorySources[id];
      if (descriptor === undefined) return null;
      const source = readFileSync(descriptor.path, "utf8");
      const trailerOffset = source.lastIndexOf(descriptor.trailer);
      if (trailerOffset === -1) {
        throw new Error(`Pinned decoder wrapper changed shape: ${descriptor.path}`);
      }
      const moduleSourceBeforeRewrite = source.slice(0, trailerOffset);
      const topLevelThisProbe = "$jscomp.getGlobal(this)";
      const actualTopLevelThisProbeOccurrences =
        moduleSourceBeforeRewrite.split(topLevelThisProbe).length - 1;
      if (actualTopLevelThisProbeOccurrences !== descriptor.topLevelThisProbeOccurrences) {
        throw new Error(
          `Pinned decoder wrapper changed top-level-this probe count: ${descriptor.path}; ` +
            `expected ${descriptor.topLevelThisProbeOccurrences}, received ${actualTopLevelThisProbeOccurrences}`,
        );
      }
      const moduleSource = moduleSourceBeforeRewrite
        // The Google closure wrapper probes its top-level `this`; ESM defines that as
        // undefined, while the intended worker global is explicit and stable.
        .replace(topLevelThisProbe, "$jscomp.getGlobal(globalThis)");
      return `${moduleSource}\nexport default ${descriptor.exportName};\n`;
    },
  };
}

function createPlugins() {
  return [
    createDecoderFactoryPlugin(),
    nodeResolve({ browser: true, extensions: [".mjs", ".js", ".json", ".ts"] }),
    {
      name: "parallax-typescript-transform",
      async transform(source, id) {
        if (!id.endsWith(".ts")) return null;
        const result = await transform(source, {
          format: "esm",
          loader: "ts",
          sourcefile: id,
          target: "es2024",
        });
        return { code: result.code, map: null };
      },
    },
  ];
}

const sharedOutput = {
  dir: outputDirectory,
  format: "es",
  generatedCode: "es2015",
  sourcemap: false,
};

export default defineConfig([
  {
    input: "src/index.ts",
    plugins: createPlugins(),
    output: { ...sharedOutput, entryFileNames: "engine.js" },
  },
  {
    input: "src/workers/render-worker.ts",
    plugins: createPlugins(),
    output: { ...sharedOutput, entryFileNames: "render-worker.js", inlineDynamicImports: true },
  },
  {
    input: "src/workers/storage-worker.ts",
    plugins: createPlugins(),
    output: { ...sharedOutput, entryFileNames: "storage-worker.js", inlineDynamicImports: true },
  },
  {
    input: "src/workers/ai-worker.ts",
    plugins: createPlugins(),
    output: { ...sharedOutput, entryFileNames: "ai-worker.js", inlineDynamicImports: true },
  },
  {
    input: "src/workers/wasm-thread-spike-worker.ts",
    plugins: createPlugins(),
    output: {
      ...sharedOutput,
      entryFileNames: "wasm-thread-worker.js",
      inlineDynamicImports: true,
    },
  },
  {
    input: "src/workers/memory64-spike-worker.ts",
    plugins: createPlugins(),
    output: {
      ...sharedOutput,
      entryFileNames: "memory64-spike-worker.js",
      inlineDynamicImports: true,
    },
  },
]);
