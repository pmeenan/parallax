import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
    },
    minify: "esbuild",
    rollupOptions: {
      external: ["@parallax/engine"],
      output: {
        entryFileNames: "game.js",
      },
    },
    sourcemap: false,
  },
});
