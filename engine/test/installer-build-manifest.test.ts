import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import { compareUnicodeScalars } from "../src/core/unicode-scalar-order";
import {
  assertCompatibleInstallerShellEntrypoint,
  parseInstallerBuildManifest,
  resolveInstallerBuildRootUrl,
  resolveInstallerManifestUrl,
  validateInstallerManifestBytes,
} from "../src/install/installer-build-manifest";

const encoder = new TextEncoder();

describe("installer build URL resolution", () => {
  it("uses one canonical root for a hashed worker, manifest, and local resources", () => {
    const workerLocation =
      "https://parallax-web.com/immutable/installer-worker-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.js";
    const buildUrl = new URL("/build-manifest.json", workerLocation).href;
    const buildRootUrl = resolveInstallerBuildRootUrl(buildUrl);
    const installUrl = resolveInstallerManifestUrl(buildUrl, "install-manifest.json");
    const syntheticUrl = new URL("synthetic/qualification-a.bin", buildRootUrl).href;
    const productionUrl = new URL("immutable/model-object.gguf", buildRootUrl).href;

    expect(buildRootUrl).toBe("https://parallax-web.com/");
    expect(installUrl).toBe("https://parallax-web.com/install-manifest.json");
    expect(syntheticUrl).toBe("https://parallax-web.com/synthetic/qualification-a.bin");
    expect(productionUrl).toBe("https://parallax-web.com/immutable/model-object.gguf");
    expect(installUrl).not.toContain("/immutable/install-manifest.json");
    expect(syntheticUrl).not.toContain("/immutable/synthetic/");
    expect(productionUrl).not.toContain("/immutable/immutable/");
  });

  it.each([
    "/install-manifest.json",
    "//other.example/install-manifest.json",
    "https://parallax-web.com/install-manifest.json",
    "../install-manifest.json",
    "./install-manifest.json",
    "nested/../install-manifest.json",
    "install-manifest.json?variant=1",
    "install-manifest.json#fragment",
    "install\\-manifest.json",
  ])("rejects non-exact install entrypoint %s", (entrypoint) => {
    expect(() =>
      resolveInstallerManifestUrl("https://parallax-web.com/build-manifest.json", entrypoint),
    ).toThrow(/exact install-manifest/);
  });

  it.each([
    "https://parallax-web.com/immutable/build-manifest.json",
    "https://parallax-web.com/build-manifest.json?variant=1",
    "https://parallax-web.com/build-manifest.json#fragment",
    "https://user@parallax-web.com/build-manifest.json",
  ])("rejects non-canonical build manifest URL %s", (buildUrl) => {
    expect(() => resolveInstallerBuildRootUrl(buildUrl)).toThrow(/exact root/);
  });
});

function fixture() {
  const installBytes = encoder.encode(
    `${JSON.stringify({
      gameId: "parallax",
      resources: [
        {
          bytes: 1,
          id: "game-cell",
          kind: "world-cell",
          scope: "game-specific",
          sha256: "1".repeat(64),
          source: "immutable/cell.json",
          target: "opfs",
        },
      ],
      schemaVersion: 1,
    })}\n`,
  );
  const installSha = bytesToHex(sha256(installBytes));
  const workers = ["decode", "installer", "render", "sim", "streaming", "wasm-thread"].map(
    (role, index) => ({
      path: `immutable/${role}-${String(index).repeat(64)}.js`,
      role,
      targetType: "worker",
    }),
  );
  const artifacts = [
    { bytes: installBytes.byteLength, path: "install-manifest.json", sha256: installSha },
    {
      bytes: 10,
      path: `immutable/app-${"a".repeat(64)}.js`,
      sha256: "a".repeat(64),
    },
    { bytes: 11, path: "service-worker.js", sha256: "9".repeat(64) },
    ...workers.map((worker, index) => ({
      bytes: index + 1,
      path: worker.path,
      sha256: String(index + 2).repeat(64),
    })),
  ];
  return {
    installBytes,
    manifest: {
      artifacts,
      gameContentEntrypoints: [],
      installManifestEntrypoint: { path: "install-manifest.json", schemaVersion: 1 },
      offlineShell: {
        generationSchemaVersion: 1,
        saveSchemaVersion: 1,
        serviceWorkerPath: "service-worker.js",
      },
      schemaVersion: 16,
      workerEntrypoints: workers,
    },
  };
}

describe("installer build-manifest v16", () => {
  it("uses Unicode scalar ordering for canonical key comparisons", () => {
    expect(["\u{10000}", "\ue000"].sort(compareUnicodeScalars)).toEqual(["\ue000", "\u{10000}"]);
  });

  it.each([
    ["lone high", "\ud800"],
    ["lone low", "\udc00"],
  ])("rejects %s surrogate text before build-manifest key canonicalization", (_label, invalid) => {
    const { manifest } = fixture();
    expect(() => parseInstallerBuildManifest({ ...manifest, [invalid]: true })).toThrow(
      /lone.*surrogate/u,
    );
  });

  it("binds exact install bytes and all six worker roles", () => {
    const { installBytes, manifest } = fixture();
    const parsed = parseInstallerBuildManifest(manifest);
    const identity = validateInstallerManifestBytes(parsed, installBytes);
    expect(identity.releaseDigest).toBe(manifest.artifacts[0]?.sha256);
    expect(identity.installManifest.manifest.resources).toHaveLength(1);
    expect(
      assertCompatibleInstallerShellEntrypoint(parsed, `immutable/app-${"a".repeat(64)}.js`),
    ).toMatchObject({ sha256: "a".repeat(64) });
  });

  it("rejects a stale or non-content-addressed loaded shell", () => {
    const { manifest } = fixture();
    const parsed = parseInstallerBuildManifest(manifest);
    expect(() =>
      assertCompatibleInstallerShellEntrypoint(parsed, `immutable/app-${"b".repeat(64)}.js`),
    ).toThrow(/exact content-addressed/);
    expect(() => assertCompatibleInstallerShellEntrypoint(parsed, "immutable/app.js")).toThrow(
      /exact content-addressed/,
    );
  });

  it("rejects missing, duplicate, unknown, or aliased worker roles", () => {
    const { manifest } = fixture();
    expect(() =>
      parseInstallerBuildManifest({
        ...manifest,
        workerEntrypoints: manifest.workerEntrypoints.slice(1),
      }),
    ).toThrow(/exactly one distinct worker for every v16 role/);
    expect(() =>
      parseInstallerBuildManifest({
        ...manifest,
        workerEntrypoints: manifest.workerEntrypoints.map((worker, index) =>
          index === 1 ? { ...worker, role: "decode" } : worker,
        ),
      }),
    ).toThrow(/invalid worker/);
    expect(() =>
      parseInstallerBuildManifest({
        ...manifest,
        workerEntrypoints: manifest.workerEntrypoints.map((worker, index) =>
          index === 1 ? { ...worker, role: "other" } : worker,
        ),
      }),
    ).toThrow(/invalid worker/);
    expect(() =>
      parseInstallerBuildManifest({
        ...manifest,
        workerEntrypoints: manifest.workerEntrypoints.map((worker, index) =>
          index === 1 ? { ...worker, path: manifest.workerEntrypoints[0]?.path } : worker,
        ),
      }),
    ).toThrow();
  });

  it("rejects malformed schema, artifact identity, and install bytes", () => {
    const { installBytes, manifest } = fixture();
    expect(() => parseInstallerBuildManifest({ ...manifest, schemaVersion: 15 })).toThrow(/v16/);
    expect(() =>
      parseInstallerBuildManifest({
        ...manifest,
        artifacts: [...manifest.artifacts, manifest.artifacts[0]],
      }),
    ).toThrow(/duplicate/);
    const parsed = parseInstallerBuildManifest(manifest);
    expect(() => validateInstallerManifestBytes(parsed, installBytes.slice(0, -1))).toThrow(
      /identity/,
    );
  });
});
