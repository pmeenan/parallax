import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: {
        game: "src/index.ts",
        "game-simulation": "src/sim/m3-simulation.ts",
      },
      formats: ["es"],
    },
    minify: "esbuild",
    rollupOptions: {
      external: ["@parallax/engine"],
      output: {
        entryFileNames: "[name].js",
      },
    },
    sourcemap: false,
  },
});
