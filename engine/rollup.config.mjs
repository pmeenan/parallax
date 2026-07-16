import { nodeResolve } from "@rollup/plugin-node-resolve";
import { transform } from "esbuild";
import { defineConfig } from "rollup";

const outputDirectory = process.env.PARALLAX_ENGINE_OUTPUT_DIR ?? "dist";

function createPlugins() {
  return [
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
]);
