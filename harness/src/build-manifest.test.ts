import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readAndValidateBuildManifest } from "./build-manifest.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function writeFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "parallax-manifest-"));
  cleanup.push(root);
  const index = "<!doctype html><title>Parallax</title>";
  const workerBody = "export const worker = true;";
  const workerDigest = createHash("sha256").update(workerBody).digest("hex");
  const workerPath = `immutable/render-worker-${workerDigest}.js`;
  const storageWorkerPath = `immutable/storage-worker-${workerDigest}.js`;
  const aiWorkerPath = `immutable/ai-worker-${workerDigest}.js`;
  await mkdir(join(root, "immutable"));
  await writeFile(join(root, "index.html"), index);
  await writeFile(join(root, workerPath), workerBody);
  await writeFile(join(root, storageWorkerPath), workerBody);
  await writeFile(join(root, aiWorkerPath), workerBody);
  await writeFile(
    join(root, "build-manifest.json"),
    JSON.stringify({
      artifacts: [
        {
          bytes: Buffer.byteLength(workerBody),
          path: workerPath,
          sha256: workerDigest,
        },
        {
          bytes: Buffer.byteLength(workerBody),
          path: storageWorkerPath,
          sha256: workerDigest,
        },
        {
          bytes: Buffer.byteLength(workerBody),
          path: aiWorkerPath,
          sha256: workerDigest,
        },
        {
          bytes: Buffer.byteLength(index),
          path: "index.html",
          sha256: createHash("sha256").update(index).digest("hex"),
        },
      ],
      schemaVersion: 4,
      workerEntrypoints: [
        { path: aiWorkerPath, role: "ai", targetType: "worker" },
        { path: workerPath, role: "render", targetType: "worker" },
        { path: storageWorkerPath, role: "storage", targetType: "worker" },
      ],
    }),
  );
  return root;
}

describe("build manifest validation", () => {
  it("accepts a served tree whose files are all listed in the manifest", async () => {
    const root = await writeFixture();
    const validated = await readAndValidateBuildManifest(root);
    expect(validated.manifest.artifacts).toHaveLength(4);
    expect(validated.artifactDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a served tree containing files the manifest does not list", async () => {
    const root = await writeFixture();
    await writeFile(join(root, "immutable", "stray.js"), "export const stray = true;");
    await expect(readAndValidateBuildManifest(root)).rejects.toThrow(
      "not in the build manifest: immutable/stray.js",
    );
  });

  it("rejects a manifest artifact whose bytes changed on disk", async () => {
    const root = await writeFixture();
    await writeFile(join(root, "index.html"), "<!doctype html><title>Tampered</title>");
    await expect(readAndValidateBuildManifest(root)).rejects.toThrow(
      "does not match its manifest: index.html",
    );
  });

  it("rejects missing or duplicate worker roles in manifest v4", async () => {
    const root = await writeFixture();
    const manifestPath = join(root, "build-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      workerEntrypoints: unknown[];
    };
    manifest.workerEntrypoints = manifest.workerEntrypoints.slice(0, 1);
    await writeFile(manifestPath, JSON.stringify(manifest));

    await expect(readAndValidateBuildManifest(root)).rejects.toThrow(
      "requires exactly one distinct AI, render, and storage worker",
    );

    const duplicateRoot = await writeFixture();
    const duplicateManifestPath = join(duplicateRoot, "build-manifest.json");
    const duplicateManifest = JSON.parse(await readFile(duplicateManifestPath, "utf8")) as {
      workerEntrypoints: Array<{ path: string; role: string; targetType: string }>;
    };
    const renderEntrypoint = duplicateManifest.workerEntrypoints[0];
    if (renderEntrypoint === undefined) throw new Error("Fixture omitted its render worker");
    duplicateManifest.workerEntrypoints[1] = { ...renderEntrypoint };
    await writeFile(duplicateManifestPath, JSON.stringify(duplicateManifest));

    await expect(readAndValidateBuildManifest(duplicateRoot)).rejects.toThrow(
      "requires exactly one distinct AI, render, and storage worker",
    );
  });

  it("rejects distinct path spellings that resolve to the same worker artifact", async () => {
    const root = await writeFixture();
    const manifestPath = join(root, "build-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      artifacts: Array<{ bytes: number; path: string; sha256: string }>;
      workerEntrypoints: Array<{ path: string; role: string; targetType: string }>;
    };
    const renderEntrypoint = manifest.workerEntrypoints.find(
      (entrypoint) => entrypoint.role === "render",
    );
    const renderArtifact = manifest.artifacts.find(
      (artifact) => artifact.path === renderEntrypoint?.path,
    );
    if (renderEntrypoint === undefined || renderArtifact === undefined) {
      throw new Error("Fixture omitted its render worker");
    }
    const aliasedRenderPath = `immutable/../${renderEntrypoint.path}`;
    manifest.artifacts.push({ ...renderArtifact, path: aliasedRenderPath });
    const storageIndex = manifest.workerEntrypoints.findIndex(
      (entrypoint) => entrypoint.role === "storage",
    );
    manifest.workerEntrypoints[storageIndex] = {
      path: aliasedRenderPath,
      role: "storage",
      targetType: "worker",
    };
    await writeFile(manifestPath, JSON.stringify(manifest));

    await expect(readAndValidateBuildManifest(root)).rejects.toThrow(
      "requires exactly one distinct AI, render, and storage worker",
    );
  });
});
