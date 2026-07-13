import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const isolationHeaders = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
};

export default defineConfig(({ command }) => ({
  ...(command === "serve"
    ? {
        resolve: {
          alias: {
            "@parallax/engine": fileURLToPath(new URL("../engine/src/index.ts", import.meta.url)),
            "@parallax/game": fileURLToPath(new URL("../game/src/index.ts", import.meta.url)),
          },
        },
      }
    : {}),
  build: {
    emptyOutDir: false,
    minify: "esbuild",
    rollupOptions: {
      external: ["@parallax/engine", "@parallax/game"],
      output: {
        entryFileNames: "immutable/app.js",
      },
    },
    sourcemap: false,
  },
  server: {
    headers: isolationHeaders,
  },
}));
