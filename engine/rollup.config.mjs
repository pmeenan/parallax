import { transform } from "esbuild";
import { defineConfig } from "rollup";

const transpileTypescript = {
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
};

export default defineConfig({
  input: "src/index.ts",
  plugins: [transpileTypescript],
  output: {
    dir: process.env.PARALLAX_ENGINE_OUTPUT_DIR ?? "dist",
    entryFileNames: "engine.js",
    format: "es",
    generatedCode: "es2015",
    sourcemap: false,
  },
});
