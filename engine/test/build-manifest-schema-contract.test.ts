import { describe, expect, it } from "vitest";
import { BUILD_MANIFEST_SCHEMA_VERSION } from "../src/build/build-manifest-contract";
import { INSTALLER_BUILD_MANIFEST_SCHEMA_VERSION } from "../src/install/installer-build-manifest";
import {
  OFFLINE_SHELL_GENERATION_SCHEMA_VERSION,
  OFFLINE_SHELL_SAVE_SCHEMA_VERSION,
} from "../src/offline-shell/shell-generation-contract";
import {
  INSTALL_MANIFEST_PATH,
  INSTALL_MANIFEST_SCHEMA_VERSION,
} from "../src/storage/install-manifest";
import { validateStreamingBuildManifest } from "../src/streaming/streaming-build-manifest";

describe("build manifest schema authority", () => {
  it("binds installer and streaming consumers to the authoritative versions", () => {
    expect(INSTALLER_BUILD_MANIFEST_SCHEMA_VERSION).toBe(BUILD_MANIFEST_SCHEMA_VERSION);
    expect(() =>
      validateStreamingBuildManifest({
        artifacts: [],
        gameContentEntrypoints: [],
        installManifestEntrypoint: {
          path: INSTALL_MANIFEST_PATH,
          schemaVersion: INSTALL_MANIFEST_SCHEMA_VERSION,
        },
        offlineShell: {
          generationSchemaVersion: OFFLINE_SHELL_GENERATION_SCHEMA_VERSION,
          saveSchemaVersion: OFFLINE_SHELL_SAVE_SCHEMA_VERSION,
          serviceWorkerPath: "service-worker.js",
        },
        schemaVersion: BUILD_MANIFEST_SCHEMA_VERSION + 1,
        workerEntrypoints: [],
      }),
    ).toThrow(/requires build-manifest/);
  });
});
