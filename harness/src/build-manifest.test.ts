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

async function writeFixture(districtSchemaVersion = 1): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "parallax-manifest-"));
  cleanup.push(root);
  const index = "<!doctype html><title>Parallax</title>";
  const workerBody = "export const worker = true;";
  const districtBody = `${JSON.stringify({
    districtId: "test-district",
    schemaVersion: districtSchemaVersion,
  })}\n`;
  const districtDigest = createHash("sha256").update(districtBody).digest("hex");
  const districtPath = `immutable/test-district-${districtDigest}.json`;
  const workerDigest = createHash("sha256").update(workerBody).digest("hex");
  const workerPath = `immutable/render-worker-${workerDigest}.js`;
  const decodeWorkerPath = `immutable/decode-worker-${workerDigest}.js`;
  const streamingWorkerPath = `immutable/streaming-worker-${workerDigest}.js`;
  const wasmThreadWorkerPath = `immutable/wasm-thread-worker-${workerDigest}.js`;
  const memory64SpikeWorkerPath = `immutable/memory64-spike-worker-${workerDigest}.js`;
  await mkdir(join(root, "immutable"));
  await writeFile(join(root, "index.html"), index);
  await writeFile(join(root, workerPath), workerBody);
  await writeFile(join(root, decodeWorkerPath), workerBody);
  await writeFile(join(root, streamingWorkerPath), workerBody);
  await writeFile(join(root, wasmThreadWorkerPath), workerBody);
  await writeFile(join(root, memory64SpikeWorkerPath), workerBody);
  await writeFile(join(root, districtPath), districtBody);
  await writeFile(
    join(root, "build-manifest.json"),
    JSON.stringify({
      artifacts: [
        {
          bytes: Buffer.byteLength(districtBody),
          path: districtPath,
          sha256: districtDigest,
        },
        {
          bytes: Buffer.byteLength(workerBody),
          path: workerPath,
          sha256: workerDigest,
        },
        {
          bytes: Buffer.byteLength(workerBody),
          path: decodeWorkerPath,
          sha256: workerDigest,
        },
        {
          bytes: Buffer.byteLength(workerBody),
          path: streamingWorkerPath,
          sha256: workerDigest,
        },
        {
          bytes: Buffer.byteLength(workerBody),
          path: wasmThreadWorkerPath,
          sha256: workerDigest,
        },
        {
          bytes: Buffer.byteLength(workerBody),
          path: memory64SpikeWorkerPath,
          sha256: workerDigest,
        },
        {
          bytes: Buffer.byteLength(index),
          path: "index.html",
          sha256: createHash("sha256").update(index).digest("hex"),
        },
      ],
      gameContentEntrypoints: [
        {
          districtId: "test-district",
          path: districtPath,
          schemaVersion: 1,
          scope: "game-specific",
          targetType: "district",
        },
      ],
      schemaVersion: 10,
      workerEntrypoints: [
        { path: decodeWorkerPath, role: "decode", targetType: "worker" },
        { path: memory64SpikeWorkerPath, role: "memory64-spike", targetType: "worker" },
        { path: workerPath, role: "render", targetType: "worker" },
        { path: streamingWorkerPath, role: "streaming", targetType: "worker" },
        { path: wasmThreadWorkerPath, role: "wasm-thread", targetType: "worker" },
      ],
    }),
  );
  return root;
}

describe("build manifest validation", () => {
  it("accepts a served tree whose files are all listed in the manifest", async () => {
    const root = await writeFixture();
    const validated = await readAndValidateBuildManifest(root);
    expect(validated.manifest.artifacts).toHaveLength(7);
    expect(validated.artifactDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts multiple uniquely identified district entrypoints and rejects empty or duplicate sets", async () => {
    const root = await writeFixture();
    const manifestPath = join(root, "build-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      artifacts: Array<{ bytes: number; path: string; sha256: string }>;
      gameContentEntrypoints: Array<{
        districtId: string;
        path: string;
        schemaVersion: number;
        scope: string;
        targetType: string;
      }>;
    };
    const secondBody = `${JSON.stringify({ districtId: "second-district", schemaVersion: 1 })}\n`;
    const secondDigest = createHash("sha256").update(secondBody).digest("hex");
    const secondPath = `immutable/second-district-${secondDigest}.json`;
    await writeFile(join(root, secondPath), secondBody);
    manifest.artifacts.push({
      bytes: Buffer.byteLength(secondBody),
      path: secondPath,
      sha256: secondDigest,
    });
    manifest.gameContentEntrypoints.push({
      districtId: "second-district",
      path: secondPath,
      schemaVersion: 1,
      scope: "game-specific",
      targetType: "district",
    });
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(readAndValidateBuildManifest(root)).resolves.toMatchObject({
      manifest: {
        gameContentEntrypoints: [
          { districtId: "test-district" },
          { districtId: "second-district" },
        ],
      },
    });

    const secondEntrypoint = manifest.gameContentEntrypoints[1];
    if (secondEntrypoint === undefined) throw new Error("Fixture omitted its second district");
    manifest.gameContentEntrypoints[1] = {
      ...secondEntrypoint,
      districtId: "test-district",
    };
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(readAndValidateBuildManifest(root)).rejects.toThrow(
      "unique game-content district IDs and paths",
    );

    const emptyRoot = await writeFixture();
    const emptyManifestPath = join(emptyRoot, "build-manifest.json");
    const emptyManifest = JSON.parse(await readFile(emptyManifestPath, "utf8")) as {
      gameContentEntrypoints: unknown[];
    };
    emptyManifest.gameContentEntrypoints = [];
    await writeFile(emptyManifestPath, JSON.stringify(emptyManifest));
    await expect(readAndValidateBuildManifest(emptyRoot)).rejects.toThrow(
      "at least one game-content district entrypoint",
    );
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

  it("rejects missing or duplicate worker roles in manifest v10", async () => {
    const root = await writeFixture();
    const manifestPath = join(root, "build-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      workerEntrypoints: unknown[];
    };
    manifest.workerEntrypoints = manifest.workerEntrypoints.slice(0, 1);
    await writeFile(manifestPath, JSON.stringify(manifest));

    await expect(readAndValidateBuildManifest(root)).rejects.toThrow(
      "requires exactly one distinct decode, memory64-spike, render, streaming, and WASM-thread worker",
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
      "requires exactly one distinct decode, memory64-spike, render, streaming, and WASM-thread worker",
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
    const streamingIndex = manifest.workerEntrypoints.findIndex(
      (entrypoint) => entrypoint.role === "streaming",
    );
    manifest.workerEntrypoints[streamingIndex] = {
      path: aliasedRenderPath,
      role: "streaming",
      targetType: "worker",
    };
    await writeFile(manifestPath, JSON.stringify(manifest));

    await expect(readAndValidateBuildManifest(root)).rejects.toThrow(
      "requires exactly one distinct decode, memory64-spike, render, streaming, and WASM-thread worker",
    );
  });

  it("rejects malformed game-content entrypoint fields", async () => {
    for (const invalidEntrypoint of [
      {
        districtId: "   ",
        path: "immutable/unused.json",
        schemaVersion: 1,
        scope: "game-specific",
        targetType: "district",
      },
      {
        districtId: "test-district",
        path: "",
        schemaVersion: 1,
        scope: "game-specific",
        targetType: "district",
      },
      {
        districtId: "test-district",
        path: "immutable/unused.json",
        schemaVersion: 2,
        scope: "game-specific",
        targetType: "district",
      },
      {
        districtId: "test-district",
        path: "immutable/unused.json",
        schemaVersion: 1,
        scope: "engine-shared",
        targetType: "district",
      },
      {
        districtId: "test-district",
        path: "immutable/unused.json",
        schemaVersion: 1,
        scope: "game-specific",
        targetType: "cell",
      },
    ]) {
      const root = await writeFixture();
      const manifestPath = join(root, "build-manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        gameContentEntrypoints: unknown[];
      };
      manifest.gameContentEntrypoints = [invalidEntrypoint];
      await writeFile(manifestPath, JSON.stringify(manifest));
      await expect(readAndValidateBuildManifest(root)).rejects.toThrow(
        "Invalid build-manifest game content entrypoint",
      );
    }
  });

  it("binds the declared district ID and schema to the referenced index", async () => {
    const idRoot = await writeFixture();
    const manifestPath = join(idRoot, "build-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      gameContentEntrypoints: Array<Record<string, unknown>>;
    };
    const entrypoint = manifest.gameContentEntrypoints[0];
    if (entrypoint === undefined) throw new Error("Fixture omitted district entrypoint");
    manifest.gameContentEntrypoints[0] = { ...entrypoint, districtId: "other-district" };
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(readAndValidateBuildManifest(idRoot)).rejects.toThrow(
      "does not match its district index",
    );

    const schemaRoot = await writeFixture(2);
    await expect(readAndValidateBuildManifest(schemaRoot)).rejects.toThrow(
      "does not match its district index",
    );
  });
});
