import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "parallax-test-msc-transcoder-factory",
      resolveId(source) {
        return source === "parallax:msc-transcoder-factory" ? `\0${source}` : null;
      },
      load(id) {
        if (id !== "\0parallax:msc-transcoder-factory") return null;
        const path = resolve(
          import.meta.dirname,
          "engine/node_modules/@babylonjs/ktx2decoder/wasm/msc_basis_transcoder.js",
        );
        const source = readFileSync(path, "utf8");
        const trailer = "if (typeof exports === 'object' && typeof module === 'object')";
        const trailerOffset = source.lastIndexOf(trailer);
        if (trailerOffset === -1) throw new Error(`Pinned MSC wrapper changed shape: ${path}`);
        return `${source.slice(0, trailerOffset)}\nexport default MSC_TRANSCODER;\n`;
      },
    },
  ],
  test: {
    exclude: ["**/dist/**", "**/node_modules/**"],
  },
});
