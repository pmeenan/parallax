import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type GreyboxCell,
  type GreyboxDistrict,
  parseStreamingDistrictIndex,
  STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
  validateGreyboxDistrict,
} from "@parallax/engine";
import { describe, expect, it } from "vitest";
import { PRODUCTION_COMPRESSED_STREAMING_FIXTURES } from "../../engine/src/streaming/production-compressed-fixtures.generated.js";
import { readAndValidateBuildManifest } from "./build-manifest.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const buildRoot = join(repositoryRoot, "dist");

describe("assembled build contract", () => {
  it("contains independently addressed engine, game, and app artifacts with exact metadata", async () => {
    const index = await readFile(join(buildRoot, "index.html"), "utf8");
    const { artifactDigest, installManifest, installSummary, manifest, releaseDigest } =
      await readAndValidateBuildManifest(buildRoot);

    expect(index).not.toContain("__ENGINE_ARTIFACT__");
    expect(index).not.toContain("__GAME_ARTIFACT__");
    expect(manifest.schemaVersion).toBe(16);
    expect(manifest.installManifestEntrypoint).toEqual({
      path: "install-manifest.json",
      schemaVersion: 1,
    });
    expect(manifest.offlineShell).toEqual({
      generationSchemaVersion: 1,
      saveSchemaVersion: 1,
      serviceWorkerPath: "service-worker.js",
    });
    expect(manifest.artifacts.filter(({ path }) => path === "service-worker.js")).toHaveLength(1);
    expect(releaseDigest).toBe(
      manifest.artifacts.find((artifact) => artifact.path === "install-manifest.json")?.sha256,
    );
    expect(artifactDigest).toBe(
      createHash("sha256")
        .update(await readFile(join(buildRoot, "build-manifest.json")))
        .digest("hex"),
    );
    expect(installManifest.gameId).toBe("parallax");
    expect(installSummary.countByTarget.opfs).toBe(266);
    expect(installSummary.countByTarget.shell).toBe(23);
    expect(installSummary.bytesByTarget.opfs).toBeGreaterThan(2_620_371_552);
    expect(installSummary.resourceCount).toBe(manifest.artifacts.length - 1 + 5);
    expect(
      installManifest.resources.filter(
        (resource) => resource.id === "game-specific-pso-warmup-trace",
      ),
    ).toEqual([
      expect.objectContaining({
        id: "game-specific-pso-warmup-trace",
        scope: "game-specific",
        target: "opfs",
      }),
    ]);

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

    expect(manifest.workerEntrypoints).toHaveLength(6);
    expect(manifest.workerEntrypoints.map((entrypoint) => entrypoint.role).sort()).toEqual([
      "decode",
      "installer",
      "render",
      "sim",
      "streaming",
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
        schemaVersion: STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
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
    const districtIndex = JSON.parse(districtIndexBytes.toString("utf8")) as {
      districtId: string;
      schemaVersion: number;
      cells: readonly Readonly<{
        bytes: number;
        cellId: string;
        coordinate: readonly [number, number];
        dependencies: readonly string[];
        path: string;
        sha256: string;
      }>[];
      resources: readonly Readonly<{ decode: unknown; format: string; resourceId: string }>[];
    };
    expect(districtIndex).toMatchObject({ districtId: "district-1-surface", schemaVersion: 2 });
    expect(Object.keys(districtIndex).sort()).toEqual([
      "bounds",
      "cellSizeMeters",
      "cells",
      "districtId",
      "materials",
      "resources",
      "schemaVersion",
    ]);
    expect(districtIndex.districtId).toBe(districtEntrypoint?.districtId);
    expect(districtIndex.cells.every((cell) => cell.dependencies.length === 1)).toBe(true);
    expect(districtIndex.resources.map(({ format }) => format)).toEqual([
      "ktx2",
      "meshopt",
      "meshopt",
    ]);
    const parsedDistrictIndex = parseStreamingDistrictIndex(districtIndex, "district-1-surface");
    expect(parsedDistrictIndex.cells.every(({ dependencies }) => dependencies?.length === 1)).toBe(
      true,
    );
    expect(
      parsedDistrictIndex.resources?.map(({ decode, dependencies, resourceId }) => ({
        dependencies,
        mode: "mode" in decode ? decode.mode : "texture",
        resourceId,
      })),
    ).toEqual([
      expect.objectContaining({ dependencies: [], mode: "texture" }),
      expect.objectContaining({ mode: "ATTRIBUTES" }),
      expect.objectContaining({ mode: "TRIANGLES" }),
    ]);
    const compactFixture = PRODUCTION_COMPRESSED_STREAMING_FIXTURES.find(
      ({ id }) => id === "compact",
    );
    if (compactFixture === undefined || parsedDistrictIndex.resources === undefined) {
      throw new Error("Compact production fixture or parsed dependency resources are absent");
    }
    const expectedCompressedBytes = [
      Buffer.from(compactFixture.ktx2, "base64"),
      Buffer.from(compactFixture.attributes, "base64"),
      Buffer.from(compactFixture.indices, "base64"),
    ];
    const [textureResource, vertexResource, indexResource] = parsedDistrictIndex.resources;
    if (
      textureResource === undefined ||
      vertexResource === undefined ||
      indexResource === undefined
    ) {
      throw new Error("Production dependency graph is incomplete");
    }
    expect(vertexResource.dependencies).toEqual([textureResource.resourceId]);
    expect(indexResource.dependencies).toEqual([
      textureResource.resourceId,
      vertexResource.resourceId,
    ]);
    expect(parsedDistrictIndex.cells[0]?.dependencies).toEqual([indexResource.resourceId]);
    for (const [index, resource] of parsedDistrictIndex.resources.entries()) {
      const actualBytes = await readFile(join(buildRoot, resource.path));
      expect(actualBytes).toEqual(expectedCompressedBytes[index]);
      expect(actualBytes.byteLength).toBe(resource.bytes);
      expect(createHash("sha256").update(actualBytes).digest("hex")).toBe(resource.sha256);
      expect(installManifest.resources).toContainEqual(
        expect.objectContaining({
          bytes: resource.bytes,
          id: resource.resourceId,
          kind: "asset-pack",
          sha256: resource.sha256,
          source: resource.path,
          target: "opfs",
        }),
      );
    }
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
      // Cell wrappers retain the greybox world-contract schema; the district
      // entrypoint independently advertises the district-index schema.
      expect(wrapper.schemaVersion).toBe(1);
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
    const reconstructedDistrict: GreyboxDistrict = {
      bounds: parsedDistrictIndex.bounds,
      cells,
      cellSizeMeters: parsedDistrictIndex.cellSizeMeters,
      generator: { seed: 1, version: 1 },
      id: parsedDistrictIndex.districtId,
      lodHysteresisMeters: 64,
      markers: [],
      materials: parsedDistrictIndex.materials,
      schemaVersion: 1,
      standardTraversalMetersPerSecond: 12,
      units: "meters",
    };
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
    expect(engineSource).not.toContain("__WLLAMA_WASM_ARTIFACT__");
    expect(engineSource).not.toContain("__WASM_THREAD_WORKER_ARTIFACT__");
    expect(engineSource).not.toContain("__WASM_THREAD_SPIKE_ARTIFACT__");
    expect(engineSource).not.toContain("__STREAMING_WORKER_ARTIFACT__");
    for (const worker of manifest.workerEntrypoints.filter(({ role }) => role !== "decode")) {
      expect(engineSource).toContain(`./${worker.path.replace("immutable/", "")}`);
    }
    const streamingEntrypoint = manifest.workerEntrypoints.find(({ role }) => role === "streaming");
    const decodeEntrypoint = manifest.workerEntrypoints.find(({ role }) => role === "decode");
    const streamingSource = await readFile(
      join(buildRoot, streamingEntrypoint?.path ?? "missing-streaming-worker"),
      "utf8",
    );
    expect(streamingSource).not.toContain("__DECODE_WORKER_ARTIFACT__");
    expect(streamingSource).toContain(`./${decodeEntrypoint?.path.replace("immutable/", "")}`);
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
