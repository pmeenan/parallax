import { describe, expect, it } from "vitest";
import { compareUnicodeScalars } from "../src/core/unicode-scalar-order";
import {
  APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS,
  APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
  canonicalAppOwnedLlmModelResourceId,
  INSTALL_RESOURCE_PLACEMENTS,
  parseInstallManifest,
  parseInstallManifestDocument,
} from "../src/index";

const localArtifact = Object.freeze({
  bytes: 17,
  id: "app-shell-document-index",
  kind: "document" as const,
  scope: "app-shell" as const,
  sha256: "0".repeat(64),
  source: "index.html",
  target: "shell" as const,
});

describe("install manifest storage contract", () => {
  it("orders astral and BMP text by Unicode scalar rather than UTF-16 code unit", () => {
    expect(compareUnicodeScalars("\u{10000}", "\ue000")).toBeGreaterThan(0);
    expect(["\u{10000}", "\ue000"].sort(compareUnicodeScalars)).toEqual(["\ue000", "\u{10000}"]);
  });

  it.each([
    ["lone high", "\ud800"],
    ["lone low", "\udc00"],
  ])("rejects %s surrogate text before manifest key canonicalization", (_label, invalid) => {
    expect(() => compareUnicodeScalars(invalid, "valid")).toThrow(/lone.*surrogate/u);
    expect(() => compareUnicodeScalars(`a${invalid}`, "b")).toThrow(/lone.*surrogate/u);
    expect(() => parseInstallManifestDocument({ ...validManifest(), [invalid]: true })).toThrow(
      /lone.*surrogate/u,
    );
  });

  it("canonicalizes model artifact paths through the shared resource-ID authority", () => {
    expect(canonicalAppOwnedLlmModelResourceId("Nested/model shard@1.GGUF")).toBe(
      "common-model-nested-model-shard-1.gguf",
    );
    expect(() => canonicalAppOwnedLlmModelResourceId("")).toThrow(/must not be empty/);
    expect(() => canonicalAppOwnedLlmModelResourceId("x".repeat(129))).toThrow(/canonical/);
  });

  it("pins and accepts the complete authoritative placement registry", () => {
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
    for (const [index, placement] of INSTALL_RESOURCE_PLACEMENTS.entries()) {
      const [scope, target, kind] = placement.split("/");
      const resource = {
        bytes: 1,
        id: `placement-${String(index).padStart(2, "0")}`,
        kind,
        scope,
        sha256: (index + 1).toString(16).padStart(64, "0"),
        source: `placement-${String(index).padStart(2, "0")}.bin`,
        target,
      };
      expect(() =>
        parseInstallManifestDocument({
          gameId: "parallax",
          resources: [resource],
          schemaVersion: 1,
        }),
      ).not.toThrow();
    }
    expect(() =>
      parseInstallManifestDocument({
        gameId: "parallax",
        resources: [
          {
            bytes: 1,
            id: "placement-near-miss",
            kind: "worker",
            scope: "game-specific",
            sha256: "f".repeat(64),
            source: "placement-near-miss.bin",
            target: "opfs",
          },
        ],
        schemaVersion: 1,
      }),
    ).toThrow(/Unsupported install resource placement/u);
  });

  it("separates runtime document parsing from build inventory policy", () => {
    const resource = {
      bytes: 5,
      id: "test-asset",
      kind: "asset-pack",
      scope: "game-specific",
      sha256: "a".repeat(64),
      source: "test.bin",
      target: "opfs",
    } as const;
    const input = { gameId: "parallax", resources: [resource], schemaVersion: 1 };
    expect(parseInstallManifestDocument(input).manifest.resources).toEqual([resource]);
    expect(() => parseInstallManifest(input, [resource])).toThrow("five exact pinned model shards");
  });

  it("accepts the exact sorted contract and reports exact scope and target totals", () => {
    const parsed = parseInstallManifest(validManifest(), [localArtifact]);
    expect(parsed.summary).toEqual({
      bytesByScope: {
        "app-shell": 17,
        common: APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
        "game-specific": 0,
      },
      bytesByTarget: {
        opfs: APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
        shell: 17,
      },
      countByScope: { "app-shell": 1, common: 5, "game-specific": 0 },
      countByTarget: { opfs: 5, shell: 1 },
      resourceBytes: APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES + 17,
      resourceCount: 6,
    });
  });

  it.each([
    ["extra top-level key", (manifest: Record<string, unknown>) => (manifest.extra = true)],
    [
      "extra resource key",
      (manifest: Record<string, unknown>) =>
        (((manifest.resources as Record<string, unknown>[])[0] as Record<string, unknown>).extra =
          true),
    ],
    [
      "unsafe id",
      (manifest: Record<string, unknown>) =>
        (((manifest.resources as Record<string, unknown>[])[0] as Record<string, unknown>).id =
          "../bad"),
    ],
    [
      "uppercase hash",
      (manifest: Record<string, unknown>) =>
        (((manifest.resources as Record<string, unknown>[])[0] as Record<string, unknown>).sha256 =
          "A".repeat(64)),
    ],
    [
      "unsafe integer",
      (manifest: Record<string, unknown>) =>
        (((manifest.resources as Record<string, unknown>[])[0] as Record<string, unknown>).bytes =
          Number.MAX_SAFE_INTEGER + 1),
    ],
    [
      "unsafe local path",
      (manifest: Record<string, unknown>) =>
        (((manifest.resources as Record<string, unknown>[])[0] as Record<string, unknown>).source =
          "../index.html"),
    ],
    [
      "wrong model source",
      (manifest: Record<string, unknown>) => {
        const model = (manifest.resources as Record<string, unknown>[]).find(
          (resource) => resource.kind === "model",
        );
        if (model !== undefined) model.source = "immutable/model-wrong.gguf";
      },
    ],
    [
      "unsupported placement",
      (manifest: Record<string, unknown>) =>
        (((manifest.resources as Record<string, unknown>[])[0] as Record<string, unknown>).target =
          "opfs"),
    ],
    [
      "duplicate source",
      (manifest: Record<string, unknown>) => {
        const resources = manifest.resources as Record<string, unknown>[];
        if (resources[1] !== undefined && resources[0] !== undefined) {
          resources[1].source = resources[0].source;
        }
      },
    ],
    [
      "duplicate hash",
      (manifest: Record<string, unknown>) => {
        const resources = manifest.resources as Record<string, unknown>[];
        if (resources[1] !== undefined && resources[0] !== undefined) {
          resources[1].sha256 = resources[0].sha256;
        }
      },
    ],
    [
      "model mismatch",
      (manifest: Record<string, unknown>) => {
        const model = (manifest.resources as Record<string, unknown>[]).find(
          (resource) => resource.kind === "model",
        );
        if (model !== undefined) model.bytes = 1;
      },
    ],
  ])("rejects %s", (_label, mutate) => {
    const manifest = structuredClone(validManifest()) as unknown as Record<string, unknown>;
    mutate(manifest);
    expect(() => parseInstallManifest(manifest, [localArtifact])).toThrow();
  });

  it("rejects zero, multiple, unknown, and mismatched local classifications", () => {
    const missing = structuredClone(validManifest());
    missing.resources = missing.resources.filter((resource) => resource.source !== "index.html");
    expect(() => parseInstallManifest(missing, [localArtifact])).toThrow(/exactly once/);

    const duplicate = structuredClone(validManifest());
    const original = duplicate.resources[0];
    if (original === undefined) throw new Error("Fixture is empty");
    duplicate.resources.push({
      ...original,
      id: "app-shell-document-other",
      sha256: "f".repeat(64),
    });
    duplicate.resources.sort((left, right) => compareUnicodeScalars(left.id, right.id));
    expect(() => parseInstallManifest(duplicate, [localArtifact])).toThrow(/Duplicate.*source/);

    const mismatch = structuredClone(validManifest());
    const index = mismatch.resources.find((resource) => resource.source === "index.html");
    if (index !== undefined) index.bytes += 1;
    expect(() => parseInstallManifest(mismatch, [localArtifact])).toThrow(
      /classification mismatch/,
    );

    const swapped = structuredClone(validManifest());
    const localResource = swapped.resources.find((resource) => resource.source === "index.html");
    if (localResource === undefined) throw new Error("Fixture omitted local resource");
    localResource.scope = "common";
    expect(() => parseInstallManifest(swapped, [localArtifact])).toThrow(
      /(classification mismatch|Unsupported install resource placement)/,
    );

    const model = validManifest().resources.find((resource) => resource.kind === "model");
    if (model === undefined) throw new Error("Fixture omitted model");
    expect(() => parseInstallManifest(validManifest(), [localArtifact, model])).toThrow(
      /Unsafe or duplicate expected local install artifact/,
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
    const base = validManifest();
    const swapped = structuredClone({
      ...base,
      resources: [
        ...base.resources,
        { ...appArtifact, id: engineArtifact.id, scope: engineArtifact.scope },
        { ...engineArtifact, id: appArtifact.id, scope: appArtifact.scope },
      ],
    });
    swapped.resources.sort((left, right) => compareUnicodeScalars(left.id, right.id));

    expect(() =>
      parseInstallManifest(swapped, [localArtifact, appArtifact, engineArtifact]),
    ).toThrow(/classification mismatch/);
  });

  it("rejects arbitrary sixth external or install-only resources from a current build", () => {
    const externalBase = structuredClone(validManifest());
    const external = {
      ...externalBase,
      resources: [
        ...externalBase.resources,
        {
          bytes: 19,
          id: "common-extra-external",
          kind: "asset-pack" as const,
          scope: "common" as const,
          sha256: "e".repeat(64),
          source: "https://example.test/stale.bin",
          target: "opfs" as const,
        },
      ],
    };
    external.resources.sort((left, right) => compareUnicodeScalars(left.id, right.id));
    expect(() => parseInstallManifest(external, [localArtifact])).toThrow(
      /unknown current-build resource/,
    );

    const sameOriginBase = structuredClone(validManifest());
    const sameOrigin = {
      ...sameOriginBase,
      resources: [
        ...sameOriginBase.resources,
        {
          bytes: 19,
          id: "common-extra-install-only",
          kind: "asset-pack" as const,
          scope: "common" as const,
          sha256: "e".repeat(64),
          source: "immutable/stale-e.gguf",
          target: "opfs" as const,
        },
      ],
    };
    sameOrigin.resources.sort((left, right) => compareUnicodeScalars(left.id, right.id));
    expect(() => parseInstallManifest(sameOrigin, [localArtifact])).toThrow(
      /unknown current-build resource/,
    );
  });
});

function validManifest(): {
  gameId: "parallax";
  resources: Array<{
    bytes: number;
    id: string;
    kind: "document" | "model";
    scope: "app-shell" | "common";
    sha256: string;
    source: string;
    target: "opfs" | "shell";
  }>;
  schemaVersion: 1;
} {
  const resources = [
    {
      bytes: localArtifact.bytes,
      id: "app-shell-document-index",
      kind: "document" as const,
      scope: "app-shell" as const,
      sha256: localArtifact.sha256,
      source: localArtifact.source,
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
  resources.sort((left, right) => compareUnicodeScalars(left.id, right.id));
  return { gameId: "parallax", resources, schemaVersion: 1 };
}
