import { readFile } from "node:fs/promises";
import {
  APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS,
  APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
  INSTALL_RESOURCE_PLACEMENTS,
  parseInstallManifest as parseEngineInstallManifest,
} from "@parallax/engine";
import { describe, expect, it } from "vitest";
import { parseInstallManifest } from "./install-manifest.js";

const local = Object.freeze({
  bytes: 4,
  id: "app-shell-document-index",
  kind: "document" as const,
  scope: "app-shell" as const,
  sha256: "0".repeat(64),
  source: "index.html",
  target: "shell" as const,
});

describe("independent harness install-manifest validator", () => {
  it("consumes the exact authoritative placement registry without a private copy", () => {
    expect(INSTALL_RESOURCE_PLACEMENTS).toEqual([
      "app-shell/shell/document",
      "app-shell/shell/module",
      "common/opfs/asset-pack",
      "common/opfs/model",
      "common/shell/module",
      "common/shell/wasm",
      "common/shell/worker",
      "game-specific/opfs/asset-pack",
      "game-specific/opfs/district-index",
      "game-specific/opfs/world-cell",
      "game-specific/shell/module",
    ]);
  });

  it("keeps both independent harness validators wired to the exported registry", async () => {
    const [manifestSource, retainedSource] = await Promise.all([
      readFile(new URL("./install-manifest.ts", import.meta.url), "utf8"),
      readFile(new URL("./installer-trust-faults-result.ts", import.meta.url), "utf8"),
    ]);
    for (const source of [manifestSource, retainedSource]) {
      expect(source).toContain("INSTALL_RESOURCE_PLACEMENTS");
      expect(source).not.toContain('placement === "');
    }
  });

  it("agrees with the engine parser without importing its implementation", () => {
    const manifest = fixture();
    const harness = parseInstallManifest(manifest, [local]);
    const engine = parseEngineInstallManifest(manifest, [local]);
    expect(harness).toEqual(engine);
    expect(harness.summary.bytesByTarget).toEqual({
      opfs: APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
      shell: 4,
    });
  });

  it("fails closed on key drift, ordering drift, aggregate overflow, and model drift", () => {
    const extra = structuredClone(fixture()) as unknown as Record<string, unknown>;
    extra.release = "self-reference";
    expect(() => parseInstallManifest(extra, [local])).toThrow(/exact/);

    const order = structuredClone(fixture());
    order.resources.reverse();
    expect(() => parseInstallManifest(order, [local])).toThrow(/ordered/);

    const overflow = structuredClone(fixture());
    const first = overflow.resources[0];
    if (first === undefined) throw new Error("Fixture is empty");
    first.bytes = Number.MAX_SAFE_INTEGER;
    expect(() =>
      parseInstallManifest(overflow, [{ ...local, bytes: Number.MAX_SAFE_INTEGER }]),
    ).toThrow(/aggregate is unsafe/);

    const modelDrift = structuredClone(fixture());
    const model = modelDrift.resources.find((resource) => resource.kind === "model");
    if (model === undefined) throw new Error("Fixture omitted model");
    model.sha256 = "f".repeat(64);
    expect(() => parseInstallManifest(modelDrift, [local])).toThrow(/model identity mismatch/);

    const classificationDrift = structuredClone(fixture());
    const localResource = classificationDrift.resources.find(
      (resource) => resource.source === "index.html",
    );
    if (localResource === undefined) throw new Error("Fixture omitted local resource");
    localResource.scope = "common";
    expect(() => parseInstallManifest(classificationDrift, [local])).toThrow(
      /(classification mismatch|Unsupported install resource placement)/,
    );
  });

  it("rejects an otherwise valid app/engine classification swap", () => {
    const appArtifact = {
      bytes: 19,
      id: "app-shell-module-app",
      kind: "module" as const,
      scope: "app-shell" as const,
      sha256: "1".repeat(64),
      source: "immutable/app.js",
      target: "shell" as const,
    };
    const engineArtifact = {
      bytes: 23,
      id: "common-module-engine",
      kind: "module" as const,
      scope: "common" as const,
      sha256: "2".repeat(64),
      source: "immutable/engine.js",
      target: "shell" as const,
    };
    const base = fixture();
    const swapped = structuredClone({
      ...base,
      resources: [
        ...base.resources,
        { ...appArtifact, id: engineArtifact.id, scope: engineArtifact.scope },
        { ...engineArtifact, id: appArtifact.id, scope: appArtifact.scope },
      ],
    });
    swapped.resources.sort((left, right) => left.id.localeCompare(right.id));

    expect(() => parseInstallManifest(swapped, [local, appArtifact, engineArtifact])).toThrow(
      /classification mismatch/,
    );
  });

  it("rejects collision between install-only model paths and dist artifacts", () => {
    const manifest = fixture();
    const model = manifest.resources.find((resource) => resource.kind === "model");
    if (model === undefined) throw new Error("Fixture omitted model");
    expect(() => parseInstallManifest(manifest, [local, model])).toThrow(
      /Unsafe or duplicate expected local install artifact/,
    );
  });

  it("rejects arbitrary sixth external or install-only resources from a current build", () => {
    for (const source of [
      "https://huggingface.co/example/resolve/stale/model.gguf",
      "immutable/stale-model.gguf",
    ]) {
      const base = fixture();
      const manifest = {
        ...base,
        resources: [
          ...base.resources,
          {
            bytes: 19,
            id: `common-extra-${source.startsWith("https") ? "external" : "install-only"}`,
            kind: "asset-pack" as const,
            scope: "common" as const,
            sha256: "e".repeat(64),
            source,
            target: "opfs" as const,
          },
        ],
      };
      manifest.resources.sort((left, right) => left.id.localeCompare(right.id));
      expect(() => parseInstallManifest(manifest, [local])).toThrow(
        /unknown current-build resource/,
      );
    }
  });
});

function fixture() {
  const resources = [
    {
      bytes: local.bytes,
      id: "app-shell-document-index",
      kind: "document" as const,
      scope: "app-shell" as const,
      sha256: local.sha256,
      source: local.source,
      target: "shell" as const,
    },
    ...APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.map((artifact) => ({
      bytes: artifact.bytes,
      id: `common-model-${artifact.path.toLowerCase()}`,
      kind: "model" as const,
      scope: "common" as const,
      sha256: artifact.sha256,
      source: `immutable/model-${artifact.sha256}.gguf`,
      target: "opfs" as const,
    })),
  ];
  resources.sort((left, right) => left.id.localeCompare(right.id));
  return { gameId: "parallax" as const, resources, schemaVersion: 1 as const };
}
