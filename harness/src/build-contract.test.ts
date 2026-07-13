import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface ManifestArtifact {
  readonly bytes: number;
  readonly path: string;
  readonly sha256: string;
}

interface BuildManifest {
  readonly artifacts: readonly ManifestArtifact[];
  readonly schemaVersion: number;
}

const repositoryRoot = resolve(import.meta.dirname, "../..");
const buildRoot = join(repositoryRoot, "dist");

describe("assembled build contract", () => {
  it("contains independently addressed engine, game, and app artifacts with exact metadata", async () => {
    const index = await readFile(join(buildRoot, "index.html"), "utf8");
    const manifest = JSON.parse(
      await readFile(join(buildRoot, "build-manifest.json"), "utf8"),
    ) as BuildManifest;

    expect(index).not.toContain("__ENGINE_ARTIFACT__");
    expect(index).not.toContain("__GAME_ARTIFACT__");
    expect(manifest.schemaVersion).toBe(1);

    const paths = manifest.artifacts.map((artifact) => artifact.path);
    expect(paths).toEqual(
      [...paths].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    );
    expect(paths.some((path) => path.endsWith(".tsbuildinfo"))).toBe(false);

    for (const scope of ["app", "engine", "game"]) {
      const matches = manifest.artifacts.filter((artifact) =>
        new RegExp(`^immutable/${scope}-[a-f0-9]{64}\\.js$`).test(artifact.path),
      );
      expect(matches).toHaveLength(1);
      expect(index).toContain(`/${matches[0]?.path}`);
    }

    const workerArtifact = manifest.artifacts.find((artifact) =>
      /^immutable\/render-worker-[a-f0-9]{64}\.js$/.test(artifact.path),
    );
    expect(workerArtifact).toBeDefined();
    const workerSource = await readFile(join(buildRoot, workerArtifact?.path ?? ""), "utf8");
    expect(workerSource).not.toContain('from "@babylonjs/core');

    for (const artifact of manifest.artifacts) {
      const bytes = await readFile(join(buildRoot, artifact.path));
      const digest = createHash("sha256").update(bytes).digest("hex");
      expect(artifact.bytes).toBe(bytes.byteLength);
      expect(artifact.sha256).toBe(digest);
      if (artifact.path.startsWith("immutable/")) {
        expect(artifact.path).toContain(`-${digest}.`);
      }
    }

    const appArtifact = manifest.artifacts.find((artifact) =>
      artifact.path.startsWith("immutable/app-"),
    );
    expect(appArtifact).toBeDefined();
    const appSource = await readFile(join(buildRoot, appArtifact?.path ?? ""), "utf8");
    expect(appSource).toContain("@parallax/engine");
    expect(appSource).toContain("@parallax/game");

    const engineArtifact = manifest.artifacts.find((artifact) =>
      artifact.path.startsWith("immutable/engine-"),
    );
    expect(engineArtifact).toBeDefined();
    const engineSource = await readFile(join(buildRoot, engineArtifact?.path ?? ""), "utf8");
    expect(engineSource).not.toContain("@parallax/game");
    expect(engineSource).not.toContain("__RENDER_WORKER_ARTIFACT__");
    expect(engineSource).toContain(`./${workerArtifact?.path.replace("immutable/", "")}`);
    expect(engineSource).toContain("__PARALLAX_TELEMETRY__");

    const immutableReferences = index.match(/\/immutable\/[^"'\s<]+/g) ?? [];
    expect(immutableReferences).toHaveLength(3);
    for (const reference of immutableReferences) {
      expect(reference).toMatch(/^\/immutable\/[a-z0-9-]+-[a-f0-9]{64}\.[a-z0-9]+$/);
    }
    expect(index).not.toContain("/immutable/app.js");
    expect(index).not.toMatch(/__[A-Z0-9_]+__/);
  });
});
