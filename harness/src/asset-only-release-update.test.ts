import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzeAssetOnlyReleaseUpdate,
  createAssetOnlyUpdateFixture,
  publishAssetOnlyUpdateFixture,
  rewriteDistrictIndexCellReferences,
  verifyPublishedAssetOnlyFixture,
} from "./asset-only-release-update.js";
import {
  type BuildManifest,
  readAndValidateBuildManifest,
  type ValidatedBuildManifest,
} from "./build-manifest.js";
import type { InstallManifest, InstallResource } from "./install-manifest.js";

const digest = (character: string): string => character.repeat(64);
const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("asset-only release update analysis", () => {
  it("rewrites every district index that shares the selected world cell", () => {
    const beforePath = `immutable/cell-${digest("5")}.json`;
    const after = {
      bytes: 11,
      path: `immutable/cell-${digest("e")}.json`,
      sha256: digest("e"),
    };
    const sharedIndexes = [
      { cells: [{ bytes: 10, path: beforePath, sha256: digest("5") }], districtId: "a" },
      {
        cells: [
          { bytes: 9, path: `immutable/other-${digest("4")}.json`, sha256: digest("4") },
          { bytes: 10, path: beforePath, sha256: digest("5") },
        ],
        districtId: "b",
      },
    ];

    const rewritten = sharedIndexes.map((index) =>
      rewriteDistrictIndexCellReferences(index, beforePath, after),
    );

    expect(rewritten.every((index) => index !== null)).toBe(true);
    expect(sharedIndexes.map((index) => index.cells.at(-1))).toEqual([after, after]);
  });

  it("accepts only declared non-executable immutable resource changes", () => {
    const analysis = analyzeAssetOnlyReleaseUpdate(
      release("a", "b", resources()),
      release(
        "c",
        "d",
        resources({
          bytes: 11,
          id: "game-specific-world-cell-district-1-surface-00-00",
          kind: "world-cell",
          scope: "game-specific",
          sha256: digest("e"),
          source: `immutable/cell-${digest("e")}.json`,
          target: "opfs",
        }),
      ),
    );

    expect(analysis.changedResources).toHaveLength(1);
    expect(analysis.executableResources.map(({ id }) => id)).toEqual([
      "app-shell-document-index",
      "app-shell-module-app",
      "common-wasm-thread-spike",
      "common-worker-service",
    ]);
    expect(analysis.executableIdentityDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects executable and non-asset drift", () => {
    const executable = resources().map((resource) =>
      resource.id === "app-shell-module-app"
        ? { ...resource, sha256: digest("e"), source: `immutable/app-${digest("e")}.js` }
        : resource,
    );
    expect(() =>
      analyzeAssetOnlyReleaseUpdate(release("a", "b", resources()), release("c", "d", executable)),
    ).toThrow("Executable install resource drifted");

    const classification = resources().map((resource) =>
      resource.kind === "world-cell" ? { ...resource, kind: "module" as const } : resource,
    );
    expect(() =>
      analyzeAssetOnlyReleaseUpdate(
        release("a", "b", resources()),
        release("c", "d", classification),
      ),
    ).toThrow(/classification drifted|Executable install resource drifted/);
  });

  it("rejects arbitrary identities and mutable-URL asset replacement", () => {
    expect(() =>
      analyzeAssetOnlyReleaseUpdate(
        { ...release("a", "b", resources()), artifactDigest: "forged" },
        release("c", "d", resources(changedCell())),
      ),
    ).toThrow("pre artifact identity");

    expect(() =>
      analyzeAssetOnlyReleaseUpdate(
        release("a", "b", resources()),
        release("c", "d", resources({ ...changedCell(), source: defaultCell().source })),
      ),
    ).toThrow("advance both content hash and immutable URL");
  });

  it("rejects worker/offline lifecycle and resource-set drift", () => {
    const post = release("c", "d", resources(changedCell()));
    const workerDrift = {
      ...post,
      manifest: {
        ...post.manifest,
        workerEntrypoints: [
          {
            path: `immutable/render-${digest("f")}.js`,
            role: "render" as const,
            targetType: "worker" as const,
          },
        ],
      },
    };
    expect(() =>
      analyzeAssetOnlyReleaseUpdate(release("a", "b", resources()), workerDrift),
    ).toThrow("lifecycle contract drifted");

    expect(() =>
      analyzeAssetOnlyReleaseUpdate(
        release("a", "b", resources()),
        release("c", "d", resources(changedCell()).slice(1)),
      ),
    ).toThrow("may not add or remove");
  });

  it("creates and publishes a filesystem-valid asset-only release without stale pre paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-asset-update-test-"));
    cleanup.push(root);
    const buildRoot = resolve(import.meta.dirname, "../../dist");
    const postRoot = join(root, "post");
    const servingRoot = join(root, "serving");
    const fixture = await createAssetOnlyUpdateFixture(buildRoot, postRoot);
    await cp(buildRoot, servingRoot, { recursive: true });

    await publishAssetOnlyUpdateFixture(servingRoot, postRoot, fixture);

    const published = await readAndValidateBuildManifest(servingRoot);
    expect(published.artifactDigest).toBe(fixture.post.artifactDigest);
    expect(published.releaseDigest).toBe(fixture.post.releaseDigest);
    expect(fixture.analysis.changedResources.map(({ before }) => before.kind).sort()).toEqual([
      "district-index",
      "world-cell",
    ]);
    for (const path of fixture.changedPaths.before) {
      await expect(access(join(servingRoot, path))).rejects.toThrow();
    }
    for (const path of fixture.changedPaths.after) {
      await expect(access(join(servingRoot, path))).resolves.toBeUndefined();
    }

    const changedPath = fixture.changedPaths.after[0];
    if (changedPath === undefined) throw new Error("Asset-only fixture changed no filesystem path");
    await writeFile(join(servingRoot, changedPath), "drifted after Ready");
    await expect(verifyPublishedAssetOnlyFixture(servingRoot, fixture)).rejects.toThrow(
      "artifact identity is invalid",
    );
  });

  it("refuses to copy into a pre-existing post root without overwriting stale files", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-asset-update-existing-"));
    cleanup.push(root);
    const buildRoot = resolve(import.meta.dirname, "../../dist");
    const postRoot = join(root, "post");
    const stalePath = join(postRoot, "stale.txt");
    await mkdir(postRoot);
    await writeFile(stalePath, "must survive");

    await expect(createAssetOnlyUpdateFixture(buildRoot, postRoot)).rejects.toThrow();
    await expect(readFile(stalePath, "utf8")).resolves.toBe("must survive");
  });
});

function changedCell(): InstallResource {
  return {
    bytes: 11,
    id: "game-specific-world-cell-district-1-surface-00-00",
    kind: "world-cell",
    scope: "game-specific",
    sha256: digest("e"),
    source: `immutable/cell-${digest("e")}.json`,
    target: "opfs",
  };
}

function resources(cell: InstallResource = defaultCell()): InstallResource[] {
  return [
    {
      bytes: 100,
      id: "app-shell-document-index",
      kind: "document",
      scope: "app-shell",
      sha256: digest("1"),
      source: "index.html",
      target: "shell",
    },
    {
      bytes: 200,
      id: "app-shell-module-app",
      kind: "module",
      scope: "app-shell",
      sha256: digest("2"),
      source: `immutable/app-${digest("2")}.js`,
      target: "shell",
    },
    {
      bytes: 300,
      id: "common-wasm-thread-spike",
      kind: "wasm",
      scope: "common",
      sha256: digest("3"),
      source: `immutable/thread-spike-${digest("3")}.wasm`,
      target: "shell",
    },
    {
      bytes: 400,
      id: "common-worker-service",
      kind: "worker",
      scope: "common",
      sha256: digest("4"),
      source: "service-worker.js",
      target: "shell",
    },
    cell,
  ];
}

function defaultCell(): InstallResource {
  return {
    bytes: 10,
    id: "game-specific-world-cell-district-1-surface-00-00",
    kind: "world-cell",
    scope: "game-specific",
    sha256: digest("5"),
    source: `immutable/cell-${digest("5")}.json`,
    target: "opfs",
  };
}

function release(
  artifactCharacter: string,
  releaseCharacter: string,
  installResources: readonly InstallResource[],
): Pick<
  ValidatedBuildManifest,
  "artifactDigest" | "installManifest" | "manifest" | "releaseDigest"
> {
  const installManifest: InstallManifest = {
    gameId: "parallax",
    resources: installResources,
    schemaVersion: 1,
  };
  const manifest: BuildManifest = {
    artifacts: [],
    gameContentEntrypoints: [],
    installManifestEntrypoint: { path: "install-manifest.json", schemaVersion: 1 },
    offlineShell: {
      generationSchemaVersion: 1,
      saveSchemaVersion: 1,
      serviceWorkerPath: "service-worker.js",
    },
    schemaVersion: 15,
    workerEntrypoints: [
      {
        path: `immutable/render-${digest("6")}.js`,
        role: "render",
        targetType: "worker",
      },
    ],
  };
  return {
    artifactDigest: digest(artifactCharacter),
    installManifest,
    manifest,
    releaseDigest: digest(releaseCharacter),
  };
}
