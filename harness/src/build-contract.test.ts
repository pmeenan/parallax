import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type GreyboxCell, type GreyboxDistrict, validateGreyboxDistrict } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import { readAndValidateBuildManifest } from "./build-manifest.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const buildRoot = join(repositoryRoot, "dist");

describe("assembled build contract", () => {
  it("contains independently addressed engine, game, and app artifacts with exact metadata", async () => {
    const index = await readFile(join(buildRoot, "index.html"), "utf8");
    const { manifest } = await readAndValidateBuildManifest(buildRoot);

    expect(index).not.toContain("__ENGINE_ARTIFACT__");
    expect(index).not.toContain("__GAME_ARTIFACT__");
    expect(manifest.schemaVersion).toBe(7);

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

    expect(manifest.workerEntrypoints).toHaveLength(5);
    expect(manifest.workerEntrypoints.map((entrypoint) => entrypoint.role).sort()).toEqual([
      "ai",
      "memory64-spike",
      "render",
      "storage",
      "wasm-thread",
    ]);
    for (const workerEntrypoint of manifest.workerEntrypoints) {
      expect(workerEntrypoint.targetType).toBe("worker");
      const workerArtifact = manifest.artifacts.find(
        (artifact) => artifact.path === workerEntrypoint.path,
      );
      expect(workerArtifact).toBeDefined();
      const workerSource = await readFile(join(buildRoot, workerArtifact?.path ?? ""), "utf8");
      expect(workerSource).not.toContain('from "@babylonjs/core');
      if (workerEntrypoint.role === "render") {
        // Rollup removes package import specifiers. This retained classic engine symbol
        // makes accidental @babylonjs/core inclusion observable in the emitted artifact.
        expect(workerSource).not.toContain("WebGPUEngine");
      }
    }

    const decoderScopes = [
      "draco-decoder",
      "msc-transcoder",
      "uastc-astc",
      "uastc-bc7",
      "uastc-r8",
      "uastc-rg8",
      "uastc-rgba-srgb",
      "uastc-rgba-unorm",
      "zstd-decoder",
    ];
    const renderEntrypoint = manifest.workerEntrypoints.find(
      (entrypoint) => entrypoint.role === "render",
    );
    expect(renderEntrypoint).toBeDefined();
    const renderSource = await readFile(
      join(buildRoot, renderEntrypoint?.path ?? "missing-render-worker"),
      "utf8",
    );
    expect(renderSource).toContain('draco: "preinstalled-global"');
    expect(renderSource).toContain('ktx2: "preinstalled-global"');
    expect(renderSource).toContain('meshopt: "preinstalled-global"');
    for (const scope of decoderScopes) {
      const matches = manifest.artifacts.filter((artifact) =>
        new RegExp(`^immutable/${scope}-[a-f0-9]{64}\\.wasm$`).test(artifact.path),
      );
      expect(matches).toHaveLength(1);
      expect(renderSource).toContain(matches[0]?.path.replace("immutable/", ""));
    }
    expect(renderSource).not.toMatch(/__[A-Z0-9_]+_WASM_ARTIFACT__/);

    for (const artifact of manifest.artifacts) {
      if (artifact.path.startsWith("immutable/")) {
        expect(artifact.path).toContain(`-${artifact.sha256}.`);
      }
    }

    expect(manifest.gameContentEntrypoints).toEqual([
      expect.objectContaining({
        districtId: "district-1-surface",
        schemaVersion: 1,
        scope: "game-specific",
        targetType: "district",
      }),
    ]);
    const districtEntrypoint = manifest.gameContentEntrypoints[0];
    expect(districtEntrypoint?.path).toMatch(
      /^immutable\/district-1-surface-index-[a-f0-9]{64}\.json$/,
    );
    const districtIndexBytes = await readFile(
      join(buildRoot, districtEntrypoint?.path ?? "missing"),
    );
    const districtIndex = JSON.parse(districtIndexBytes.toString("utf8")) as Omit<
      GreyboxDistrict,
      "cells" | "id"
    > & {
      districtId: string;
      cells: readonly Readonly<{
        bytes: number;
        cellId: string;
        coordinate: readonly [number, number];
        path: string;
        sha256: string;
      }>[];
    };
    expect(districtIndex).toMatchObject({ districtId: "district-1-surface", schemaVersion: 1 });
    expect(districtIndex.districtId).toBe(districtEntrypoint?.districtId);
    expect(districtIndex.schemaVersion).toBe(districtEntrypoint?.schemaVersion);
    const districtIndexArtifact = manifest.artifacts.find(
      (artifact) => artifact.path === districtEntrypoint?.path,
    );
    expect(districtIndexArtifact).toBeDefined();
    expect(createHash("sha256").update(districtIndexBytes).digest("hex")).toBe(
      districtIndexArtifact?.sha256,
    );
    expect(districtEntrypoint?.path).toContain(`-${districtIndexArtifact?.sha256}.json`);
    expect(districtIndex.cells).toHaveLength(256);
    const cells: GreyboxCell[] = [];
    const coordinates = new Set<string>();
    for (const cellEntry of districtIndex.cells) {
      expect(cellEntry.path).toMatch(
        /^immutable\/district-1-surface-cell-\d{2}-\d{2}-[a-f0-9]{64}\.json$/,
      );
      expect(cellEntry.path).toContain(`-${cellEntry.sha256}.json`);
      const cellArtifact = manifest.artifacts.find((artifact) => artifact.path === cellEntry.path);
      expect(cellArtifact).toMatchObject({ bytes: cellEntry.bytes, sha256: cellEntry.sha256 });
      const cellBytes = await readFile(join(buildRoot, cellEntry.path));
      expect(cellBytes.byteLength).toBe(cellEntry.bytes);
      expect(createHash("sha256").update(cellBytes).digest("hex")).toBe(cellEntry.sha256);
      const wrapper = JSON.parse(cellBytes.toString("utf8")) as {
        cell: GreyboxCell;
        districtId: string;
        schemaVersion: number;
      };
      expect(wrapper.districtId).toBe(districtIndex.districtId);
      expect(wrapper.schemaVersion).toBe(districtIndex.schemaVersion);
      expect(wrapper.cell.id).toBe(cellEntry.cellId);
      expect(wrapper.cell.coordinate).toEqual(cellEntry.coordinate);
      const coordinateKey = cellEntry.coordinate.join(",");
      expect(coordinates.has(coordinateKey)).toBe(false);
      coordinates.add(coordinateKey);
      cells.push(wrapper.cell);
    }
    expect(coordinates).toEqual(
      new Set(
        Array.from({ length: 16 }, (_, row) =>
          Array.from({ length: 16 }, (_unused, column) => `${column},${row}`),
        ).flat(),
      ),
    );
    const { districtId, ...districtMetadata } = districtIndex;
    const reconstructedDistrict: GreyboxDistrict = { ...districtMetadata, cells, id: districtId };
    expect(validateGreyboxDistrict(reconstructedDistrict)).toMatchObject({ cellCount: 256 });

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
    expect(engineSource).not.toContain("__STORAGE_WORKER_ARTIFACT__");
    expect(engineSource).not.toContain("__WASM_THREAD_WORKER_ARTIFACT__");
    expect(engineSource).not.toContain("__WASM_THREAD_SPIKE_ARTIFACT__");
    expect(engineSource).not.toContain("__MEMORY64_SPIKE_WORKER_ARTIFACT__");
    expect(engineSource).not.toContain("__MEMORY32_SPIKE_ARTIFACT__");
    expect(engineSource).not.toContain("__MEMORY64_SPIKE_ARTIFACT__");
    for (const worker of manifest.workerEntrypoints) {
      expect(engineSource).toContain(`./${worker.path.replace("immutable/", "")}`);
    }
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
