import { describe, expect, it } from "vitest";
import type { BuildManifest, ManifestArtifact } from "./build-manifest.js";
import { selectV8ScriptManifestArtifacts } from "./v8-script-artifacts.js";

function artifact(path: string): ManifestArtifact {
  return Object.freeze({ bytes: 1, path, sha256: "digest" });
}

describe("V8 script artifact selection", () => {
  it("keeps active immutable scripts and excludes inactive spike workers", () => {
    const manifest: BuildManifest = Object.freeze({
      artifacts: Object.freeze([
        artifact("index.html"),
        artifact("immutable/app.js"),
        artifact("immutable/engine.js"),
        artifact("immutable/game.js"),
        artifact("immutable/render-worker.js"),
        artifact("immutable/decode-worker.js"),
        artifact("immutable/installer-worker.js"),
        artifact("immutable/streaming-worker.js"),
        artifact("immutable/wasm-thread-worker.js"),
        artifact("immutable/module.wasm"),
      ]),
      gameContentEntrypoints: Object.freeze([
        Object.freeze({
          districtId: "district-1-surface",
          path: "immutable/district-1.json",
          schemaVersion: 2,
          scope: "game-specific",
          targetType: "district",
        }),
      ]),
      installManifestEntrypoint: Object.freeze({
        path: "install-manifest.json",
        schemaVersion: 1,
      }),
      offlineShell: Object.freeze({
        generationSchemaVersion: 1,
        saveSchemaVersion: 1,
        serviceWorkerPath: "service-worker.js",
      }),
      schemaVersion: 16,
      workerEntrypoints: Object.freeze([
        Object.freeze({
          path: "immutable/decode-worker.js",
          role: "decode",
          targetType: "worker",
        }),
        Object.freeze({
          path: "immutable/installer-worker.js",
          role: "installer",
          targetType: "worker",
        }),
        Object.freeze({
          path: "immutable/render-worker.js",
          role: "render",
          targetType: "worker",
        }),
        Object.freeze({
          path: "immutable/streaming-worker.js",
          role: "streaming",
          targetType: "worker",
        }),
        Object.freeze({
          path: "immutable/wasm-thread-worker.js",
          role: "wasm-thread",
          targetType: "worker",
        }),
      ]),
    });

    expect(selectV8ScriptManifestArtifacts(manifest).map(({ path }) => path)).toEqual([
      "immutable/app.js",
      "immutable/engine.js",
      "immutable/game.js",
      "immutable/render-worker.js",
      "immutable/installer-worker.js",
      "immutable/streaming-worker.js",
    ]);
  });
});
