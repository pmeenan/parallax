import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  await mkdir(join(root, "immutable"));
  await writeFile(join(root, "index.html"), index);
  await writeFile(join(root, workerPath), workerBody);
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
          bytes: Buffer.byteLength(index),
          path: "index.html",
          sha256: createHash("sha256").update(index).digest("hex"),
        },
      ],
      schemaVersion: 2,
      workerEntrypoints: [{ path: workerPath, role: "render", targetType: "worker" }],
    }),
  );
  return root;
}

describe("build manifest validation", () => {
  it("accepts a served tree whose files are all listed in the manifest", async () => {
    const root = await writeFixture();
    const validated = await readAndValidateBuildManifest(root);
    expect(validated.manifest.artifacts).toHaveLength(2);
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
});
