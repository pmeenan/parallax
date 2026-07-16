import { describe, expect, it } from "vitest";
import type { BuildManifest, ManifestArtifact } from "./build-manifest.js";
import { selectV8ScriptManifestArtifacts } from "./v8-script-artifacts.js";

function artifact(path: string): ManifestArtifact {
  return Object.freeze({ bytes: 1, path, sha256: "digest" });
}

describe("V8 script artifact selection", () => {
  it("keeps active immutable scripts and excludes the inactive storage worker", () => {
    const manifest: BuildManifest = Object.freeze({
      artifacts: Object.freeze([
        artifact("index.html"),
        artifact("immutable/app.js"),
        artifact("immutable/engine.js"),
        artifact("immutable/game.js"),
        artifact("immutable/render-worker.js"),
        artifact("immutable/storage-worker.js"),
        artifact("immutable/module.wasm"),
      ]),
      schemaVersion: 3,
      workerEntrypoints: Object.freeze([
        Object.freeze({
          path: "immutable/render-worker.js",
          role: "render",
          targetType: "worker",
        }),
        Object.freeze({
          path: "immutable/storage-worker.js",
          role: "storage",
          targetType: "worker",
        }),
      ]),
    });

    expect(selectV8ScriptManifestArtifacts(manifest).map(({ path }) => path)).toEqual([
      "immutable/app.js",
      "immutable/engine.js",
      "immutable/game.js",
      "immutable/render-worker.js",
    ]);
  });
});
