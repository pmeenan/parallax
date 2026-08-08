import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  const simulationBuild = mode === "simulation";
  if (!simulationBuild && mode !== "game") {
    throw new Error(`Unsupported game build mode ${mode}`);
  }
  const entryName = simulationBuild ? "game-simulation" : "game";
  const entryPath = simulationBuild ? "src/sim/m3-simulation.ts" : "src/index.ts";
  return {
    build: {
      emptyOutDir: false,
      lib: {
        entry: {
          [entryName]: entryPath,
        },
        formats: ["es"],
      },
      minify: "esbuild",
      rollupOptions: {
        // Module workers do not inherit the document import map. Keep the simulation
        // entry self-contained if a future hot-path implementation imports an engine
        // runtime value; the document-loaded game entry may use the shared engine map.
        external: simulationBuild ? [] : ["@parallax/engine"],
        output: {
          entryFileNames: "[name].js",
        },
      },
      sourcemap: false,
    },
  };
});
