import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS,
  APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
} from "../src/ai/app-owned-llm-spike-protocol";
import { createInstalledModelSource } from "../src/ai/installed-model-source";
import type { InstallManifest, InstallResource } from "../src/storage/install-manifest";
import {
  bindActiveInstalledRelease,
  type InstalledReleaseBinding,
} from "../src/storage/installed-release";
import type { OpfsReleaseStore, VerifiedObjectRef } from "../src/storage/opfs-release-store";
import {
  parseStreamingDistrictIndex,
  resolveInstalledStreamingRelease,
} from "../src/streaming/installed-streaming-release";

const releaseDigest = "a".repeat(64);

describe("installed runtime release binding", () => {
  it("requires the admitted digest to remain the exact active selection", async () => {
    const store = releaseStore(manifest([resource("cell", "world-cell", "b".repeat(64), 4)]), {
      activeReleaseDigest: "c".repeat(64),
      previousReleaseDigest: null,
    });

    await expect(bindActiveInstalledRelease(releaseDigest, store)).rejects.toThrow(
      /not the exact active selection/,
    );
    expect(store.admitActiveRelease).toHaveBeenCalledOnce();
    expect(store.getManifest).not.toHaveBeenCalled();
    expect(store.getSelection).not.toHaveBeenCalled();
  });

  it("resolves exact references, accounts them, and fails terminally on mismatch", async () => {
    const cell = resource("cell", "world-cell", "b".repeat(64), 4);
    const store = releaseStore(manifest([cell]));
    const binding = await bindActiveInstalledRelease(releaseDigest, store);
    expect(store.admitActiveRelease).toHaveBeenCalledOnce();
    expect(store.getManifest).not.toHaveBeenCalled();
    expect(store.getSelection).not.toHaveBeenCalled();

    await expect(binding.getResource(cell.id)).resolves.toMatchObject({
      manifest: cell,
      reference: { releaseDigest, resourceId: cell.id, sha256: cell.sha256 },
    });
    expect(binding.snapshot()).toMatchObject({
      networkFallbackCount: 0,
      referencedBytes: 4,
      referencedResourceCount: 1,
      state: "ready",
    });

    vi.mocked(store.getResource).mockResolvedValueOnce({
      ...reference(cell),
      sha256: "d".repeat(64),
    });
    await expect(binding.getResource(cell.id)).rejects.toThrow(/reference mismatch/);
    expect(binding.snapshot().state).toBe("failed");
    await expect(binding.getResource(cell.id)).rejects.toThrow(/reference mismatch/);
  });
});

describe("installed model source", () => {
  it("binds all five pinned shards with zero fallback", async () => {
    const resources = modelResources();
    const source = createInstalledModelSource(binding(manifest(resources)));
    const artifacts = await source.initialize();

    expect(artifacts.map(({ sha256 }) => sha256).sort()).toEqual(
      APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.map(({ sha256 }) => sha256).sort(),
    );
    expect(source.snapshot()).toMatchObject({
      expectedArtifactBytes: APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
      networkFallbackCount: 0,
      releaseDigest,
      resolvedArtifactBytes: APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
      resolvedArtifactCount: 5,
      state: "ready",
    });
  });

  it("fails closed when the installed shard set is incomplete", async () => {
    const source = createInstalledModelSource(binding(manifest(modelResources().slice(0, 4))));

    await expect(source.initialize()).rejects.toThrow(/wrong pinned model artifact count/);
    expect(source.snapshot()).toMatchObject({
      networkFallbackCount: 0,
      resolvedArtifactCount: 0,
      state: "failed",
    });
    expect(() => source.artifacts()).toThrow(/not ready/);
  });
});

describe("installed streaming release", () => {
  it("binds a strict per-cell KTX2 -> meshopt dependency graph to installed objects", async () => {
    const indexDocument = productionCompressedDistrictIndexDocument();
    const cell = indexDocument.cells[0];
    if (
      cell === undefined ||
      typeof cell.sha256 !== "string" ||
      typeof cell.bytes !== "number" ||
      typeof cell.path !== "string"
    ) {
      throw new Error("Production cell is absent or invalid");
    }
    const indexBytes = new TextEncoder().encode(JSON.stringify(indexDocument));
    const resources = [
      resource(
        "game-specific-district-index-district-1-surface",
        "district-index",
        "f".repeat(64),
        indexBytes.byteLength,
      ),
      resource(
        "game-specific-world-cell-district-1-surface-00-00",
        "world-cell",
        cell.sha256,
        cell.bytes,
        cell.path,
      ),
      ...indexDocument.resources.map((dependency) =>
        resource(
          dependency.resourceId,
          "asset-pack",
          dependency.sha256,
          dependency.bytes,
          dependency.path,
        ),
      ),
    ];

    const release = await resolveInstalledStreamingRelease(
      binding(manifest(resources)),
      "district-1-surface",
      async () => indexBytes,
    );

    expect(release.dependencies.map(({ descriptor }) => descriptor.resourceId)).toEqual([
      "production-00-texture",
      "production-01-vertices",
      "production-02-indices",
    ]);
    expect(release.index.cells[0]?.dependencies).toEqual(["production-02-indices"]);
  });

  it("rejects schema drift, duplicate edges, unsafe sizes, and format/path mismatch", () => {
    const valid = productionCompressedDistrictIndexDocument();
    const texture = valid.resources[0];
    const vertices = valid.resources[1];
    const indices = valid.resources[2];
    if (texture === undefined || vertices === undefined || indices === undefined) {
      throw new Error("Fixture resources absent");
    }
    expect(() =>
      parseStreamingDistrictIndex({ ...valid, schemaVersion: 1 }, "district-1-surface"),
    ).toThrow(/identity/);
    expect(() =>
      parseStreamingDistrictIndex(
        { ...districtIndexDocument(), schemaVersion: 2 },
        "district-1-surface",
      ),
    ).toThrow(/identity/);
    expect(() =>
      parseStreamingDistrictIndex(
        {
          ...valid,
          cells: [
            {
              ...valid.cells[0],
              dependencies: [indices.resourceId, indices.resourceId],
            },
          ],
        },
        "district-1-surface",
      ),
    ).toThrow(/dependency graph/);
    expect(() =>
      parseStreamingDistrictIndex(
        {
          ...valid,
          resources: [
            texture,
            { ...vertices, dependencies: [texture.resourceId, texture.resourceId] },
            indices,
          ],
        },
        "district-1-surface",
      ),
    ).toThrow(/identity/);
    expect(() =>
      parseStreamingDistrictIndex(
        { ...valid, resources: [vertices, texture, indices] },
        "district-1-surface",
      ),
    ).toThrow(/identity/);
    expect(() =>
      parseStreamingDistrictIndex(
        {
          ...valid,
          resources: [
            {
              ...texture,
              decode: { ...texture.decode, width: Number.MAX_SAFE_INTEGER },
            },
            vertices,
            indices,
          ],
        },
        "district-1-surface",
      ),
    ).toThrow(/format/);
    expect(() =>
      parseStreamingDistrictIndex(
        {
          ...valid,
          resources: [
            { ...texture, path: texture.path.replace("ktx2", "meshopt") },
            vertices,
            indices,
          ],
        },
        "district-1-surface",
      ),
    ).toThrow(/format/);
    expect(() =>
      parseStreamingDistrictIndex(
        {
          ...valid,
          resources: [{ ...texture, bytes: 8 * 1024 * 1024 + 1 }, vertices, indices],
        },
        "district-1-surface",
      ),
    ).toThrow(/identity/);
  });

  it("accepts only the bounded texture, vertex-attribute, and index dependency topology", () => {
    const valid = productionCompressedDistrictIndexDocument();
    expect(
      parseStreamingDistrictIndex(valid, "district-1-surface").resources?.map(
        ({ resourceId }) => resourceId,
      ) ?? [],
    ).toEqual(["production-00-texture", "production-01-vertices", "production-02-indices"]);
    const [texture, vertices, indices] = valid.resources;
    if (texture === undefined || vertices === undefined || indices === undefined) {
      throw new Error("Production compressed resources are absent");
    }
    const rejects = [
      [
        "topology",
        {
          ...indices,
          dependencies: [vertices.resourceId, texture.resourceId],
        },
      ],
      ["attribute count", { ...vertices, decode: { ...vertices.decode, count: 0 } }],
      ["attribute format", { ...vertices, decode: { ...vertices.decode, stride: 12 } }],
      ["triangle count", { ...indices, decode: { ...indices.decode, count: 4 } }],
      ["index cap", { ...indices, decode: { ...indices.decode, count: Number.MAX_SAFE_INTEGER } }],
      ["index format", { ...indices, decode: { ...indices.decode, indexFormat: "uint16" } }],
    ] as const;
    for (const [label, replacement] of rejects) {
      const resources = valid.resources.map((resourceValue) =>
        resourceValue.resourceId === replacement.resourceId ? replacement : resourceValue,
      );
      expect(
        () => parseStreamingDistrictIndex({ ...valid, resources }, "district-1-surface"),
        label,
      ).toThrow(/identity|format/);
    }

    expect(() =>
      parseStreamingDistrictIndex(
        {
          ...valid,
          cells: [{ ...valid.cells[0], dependencies: [vertices.resourceId] }],
        },
        "district-1-surface",
      ),
    ).toThrow(/dependency graph/);

    const sharedIndex = {
      ...indices,
      path: `immutable/streaming-indices-${"f".repeat(64)}.meshopt`,
      resourceId: "production-03-shared-indices",
      sha256: "f".repeat(64),
    };
    expect(() =>
      parseStreamingDistrictIndex(
        {
          ...valid,
          cells: [
            {
              ...valid.cells[0],
              dependencies: [indices.resourceId, sharedIndex.resourceId],
            },
          ],
          resources: [...valid.resources, sharedIndex],
        },
        "district-1-surface",
      ),
    ).toThrow(/ambiguous mesh dependency graph/);

    const secondCell = {
      bytes: 4,
      cellId: "district-1-surface-cell-01-00",
      coordinate: [1, 0],
      dependencies: [sharedIndex.resourceId],
      path: `immutable/district-1-surface-cell-01-00-${"a".repeat(64)}.json`,
      sha256: "a".repeat(64),
    };
    expect(() =>
      parseStreamingDistrictIndex(
        {
          ...valid,
          bounds: { ...valid.bounds, maximum: [512, 100, 256] },
          cells: [valid.cells[0], secondCell],
          resources: [...valid.resources, sharedIndex],
        },
        "district-1-surface",
      ),
    ).toThrow(/ambiguous mesh dependency graph/);

    expect(
      parseStreamingDistrictIndex(
        {
          ...valid,
          bounds: { ...valid.bounds, maximum: [512, 100, 256] },
          cells: [valid.cells[0], { ...secondCell, dependencies: [indices.resourceId] }],
        },
        "district-1-surface",
      ).cells.map(({ dependencies }) => dependencies),
    ).toEqual([[indices.resourceId], [indices.resourceId]]);

    const uniqueVertices = {
      ...vertices,
      path: `immutable/streaming-vertices-${"6".repeat(64)}.meshopt`,
      resourceId: "production-03-vertices-unique",
      sha256: "6".repeat(64),
    };
    const uniqueIndices = {
      ...indices,
      dependencies: [texture.resourceId, uniqueVertices.resourceId],
      path: `immutable/streaming-indices-${"7".repeat(64)}.meshopt`,
      resourceId: "production-04-indices-unique",
      sha256: "7".repeat(64),
    };
    expect(
      parseStreamingDistrictIndex(
        {
          ...valid,
          bounds: { ...valid.bounds, maximum: [512, 100, 256] },
          cells: [valid.cells[0], { ...secondCell, dependencies: [uniqueIndices.resourceId] }],
          resources: [...valid.resources, uniqueVertices, uniqueIndices],
        },
        "district-1-surface",
      ).cells.map(({ dependencies }) => dependencies),
    ).toEqual([[indices.resourceId], [uniqueIndices.resourceId]]);

    const textureB = {
      ...texture,
      path: `immutable/streaming-texture-${"6".repeat(64)}.ktx2`,
      resourceId: "production-03-texture-b",
      sha256: "6".repeat(64),
    };
    const verticesB = {
      ...vertices,
      dependencies: [textureB.resourceId],
      path: `immutable/streaming-vertices-${"7".repeat(64)}.meshopt`,
      resourceId: "production-04-vertices-b",
      sha256: "7".repeat(64),
    };
    const indicesB = {
      ...indices,
      dependencies: [textureB.resourceId, verticesB.resourceId],
      path: `immutable/streaming-indices-${"8".repeat(64)}.meshopt`,
      resourceId: "production-05-indices-b",
      sha256: "8".repeat(64),
    };
    expect(
      parseStreamingDistrictIndex(
        {
          ...valid,
          cells: [
            {
              ...valid.cells[0],
              dependencies: [indices.resourceId, indicesB.resourceId],
            },
          ],
          resources: [...valid.resources, textureB, verticesB, indicesB],
        },
        "district-1-surface",
      ).cells[0]?.dependencies,
    ).toEqual([indices.resourceId, indicesB.resourceId]);

    const ambiguousTexture = {
      ...texture,
      path: `immutable/streaming-texture-${"9".repeat(64)}.ktx2`,
      resourceId: "production-00z-texture-ambiguous",
      sha256: "9".repeat(64),
    };
    expect(() =>
      parseStreamingDistrictIndex(
        {
          ...valid,
          resources: [
            texture,
            ambiguousTexture,
            { ...vertices, dependencies: [ambiguousTexture.resourceId] },
            indices,
          ],
        },
        "district-1-surface",
      ),
    ).toThrow(/format/);
  });

  it("rejects a legacy v1 index before any installed cell batch lookup", async () => {
    const cellSha = "b".repeat(64);
    const indexSha = "c".repeat(64);
    const path = `immutable/district-1-surface-cell-00-00-${cellSha}.json`;
    const indexDocument = {
      bounds: { maximum: [256, 100, 256], minimum: [0, -10, 0] },
      cellSizeMeters: 256,
      cells: [
        {
          bytes: 4,
          cellId: "district-1-surface-cell-00-00",
          coordinate: [0, 0],
          path,
          sha256: cellSha,
        },
      ],
      districtId: "district-1-surface",
      materials: [{ color: [0.1, 0.2, 0.3], id: "ground" }],
      schemaVersion: 1,
    };
    const indexBytes = new TextEncoder().encode(JSON.stringify(indexDocument));
    const resources = [
      resource(
        "game-specific-district-index-district-1-surface",
        "district-index",
        indexSha,
        indexBytes.byteLength,
        `immutable/district-1-surface-index-${indexSha}.json`,
      ),
      resource("game-specific-world-cell-district-1-surface-00-00", "world-cell", cellSha, 4, path),
    ];
    const baseBinding = binding(manifest(resources));
    const getResources = vi.fn((resourceIds: readonly string[]) => {
      if (resourceIds.length === 0) {
        return Promise.reject(new Error("empty release lookup poisoned the binding"));
      }
      return baseBinding.getResources(resourceIds);
    });
    await expect(
      resolveInstalledStreamingRelease(
        Object.freeze({ ...baseBinding, getResources }),
        "district-1-surface",
        async () => indexBytes,
      ),
    ).rejects.toThrow(/identity/);
    expect(getResources).not.toHaveBeenCalled();
  });

  it("rejects an index cell not bound by the exact release manifest", async () => {
    const indexBytes = new TextEncoder().encode(
      JSON.stringify(productionCompressedDistrictIndexDocument()),
    );
    const index = resource(
      "game-specific-district-index-district-1-surface",
      "district-index",
      "c".repeat(64),
      indexBytes.byteLength,
    );

    await expect(
      resolveInstalledStreamingRelease(
        binding(manifest([index])),
        "district-1-surface",
        async () => indexBytes,
      ),
    ).rejects.toThrow(/not bound exactly/);
  });

  it("rejects swapped cell semantics while byte and hash bindings remain valid", async () => {
    const hashes = ["b".repeat(64), "c".repeat(64)] as const;
    const entries = hashes.map((sha256, x) => ({
      bytes: 4,
      cellId: `district-1-surface-cell-${String(x).padStart(2, "0")}-00`,
      coordinate: [x, 0] as const,
      path: `immutable/district-1-surface-cell-${String(x).padStart(2, "0")}-00-${sha256}.json`,
      sha256,
    }));
    const resolve = async (
      cells: readonly (typeof entries)[number][],
      mutateResources: (resources: InstallResource[]) => void = () => undefined,
    ) => {
      const versioned = productionCompressedDistrictIndexDocument();
      const indexBytes = new TextEncoder().encode(
        JSON.stringify({
          ...versioned,
          bounds: { ...versioned.bounds, maximum: [512, 100, 256] },
          cells: cells.map((cell) => ({ ...cell, dependencies: ["production-02-indices"] })),
        }),
      );
      const resources = [
        resource(
          "game-specific-district-index-district-1-surface",
          "district-index",
          "d".repeat(64),
          indexBytes.byteLength,
        ),
        ...entries.map((entry) =>
          resource(
            `game-specific-world-cell-district-1-surface-${String(entry.coordinate[0]).padStart(2, "0")}-00`,
            "world-cell",
            entry.sha256,
            entry.bytes,
            entry.path,
          ),
        ),
      ];
      mutateResources(resources);
      return resolveInstalledStreamingRelease(
        binding(manifest(resources)),
        "district-1-surface",
        async () => indexBytes,
      );
    };
    const [first, second] = entries;
    if (first === undefined || second === undefined)
      throw new Error("Semantic fixtures are absent");

    await expect(
      resolve([
        { ...first, cellId: second.cellId },
        { ...second, cellId: first.cellId },
      ]),
    ).rejects.toThrow(/noncanonical cell identity/);
    await expect(
      resolve([
        { ...first, coordinate: second.coordinate },
        { ...second, coordinate: first.coordinate },
      ]),
    ).rejects.toThrow(/noncanonical cell identity/);
    await expect(
      resolve([
        { ...first, path: second.path },
        { ...second, path: first.path },
      ]),
    ).rejects.toThrow(/noncanonical cell identity/);
    await expect(
      resolve(entries, (resources) => {
        const firstCell = resources[1];
        if (firstCell === undefined) throw new Error("Semantic resource fixture is absent");
        resources[1] = {
          ...firstCell,
          id: "game-specific-world-cell-district-1-surface-99-99",
        };
      }),
    ).rejects.toThrow(/not bound exactly/);
  });

  it("keeps fetch and the legacy streaming cache outside the installed branch", async () => {
    const source = await readFile(
      new URL("../src/workers/streaming-worker.ts", import.meta.url),
      "utf8",
    );
    const installedStart = source.indexOf(
      'if (request.contentSource.kind === "installed-release")',
    );
    const legacyStart = source.indexOf("} else {", installedStart);
    const installedBranch = source.slice(installedStart, legacyStart);

    expect(installedStart).toBeGreaterThan(0);
    expect(legacyStart).toBeGreaterThan(installedStart);
    expect(installedBranch).not.toContain("fetchLegacy(");
    expect(installedBranch).not.toContain("OPFS_DIRECTORY");
    expect(installedBranch).not.toContain("provision(");
    expect(installedBranch).toContain("openAndAdmitInstalledStreamingRelease(");
    expect(installedBranch).toContain("closeHandles: () => opfsAccessHandles.closeAll()");
    expect(installedBranch).toContain("openAccessHandlesWithoutCleanup(");
    expect(source.indexOf("openAndAdmitInstalledStreamingRelease({", installedStart)).toBeLessThan(
      source.indexOf("createDecodePool();", installedStart),
    );
    const openHandlesStart = source.indexOf("const openAccessHandlesWithoutCleanup");
    const initializeStart = source.indexOf("const initialize =", openHandlesStart);
    expect(openHandlesStart).toBeGreaterThan(0);
    expect(initializeStart).toBeGreaterThan(openHandlesStart);
    expect(source.slice(openHandlesStart, initializeStart)).not.toContain("closeAll()");
    expect(source.slice(legacyStart)).toContain("fetchLegacy(");
  });

  it("rejects hostile material objects, bounds, and derived cell extents", () => {
    const valid = productionCompressedDistrictIndexDocument();
    for (const materials of [
      [],
      [{ color: [0, 0, 0], extra: true, id: "ground" }],
      [{ color: [0, 0, 2], id: "ground" }],
      [{ color: [0, Number.NaN, 0], id: "ground" }],
      [
        { color: [0, 0, 0], id: "ground" },
        { color: [1, 1, 1], id: "ground" },
      ],
    ]) {
      expect(() =>
        parseStreamingDistrictIndex({ ...valid, materials }, "district-1-surface"),
      ).toThrow(/material|requires materials/);
    }
    expect(() =>
      parseStreamingDistrictIndex(
        {
          ...valid,
          bounds: { maximum: [0, 100, 256], minimum: [0, -10, 0] },
        },
        "district-1-surface",
      ),
    ).toThrow(/identity/);
    expect(() =>
      parseStreamingDistrictIndex({ ...valid, extra: true }, "district-1-surface"),
    ).toThrow(/identity/);
    const { materials: _materials, ...missingMaterials } = valid;
    expect(() => parseStreamingDistrictIndex(missingMaterials, "district-1-surface")).toThrow(
      /identity/,
    );
    expect(() =>
      parseStreamingDistrictIndex(
        {
          ...valid,
          bounds: { maximum: [Number.NaN, 100, 256], minimum: [0, -10, 0] },
        },
        "district-1-surface",
      ),
    ).toThrow(/identity/);
    expect(() =>
      parseStreamingDistrictIndex(
        {
          ...valid,
          cells: [
            {
              ...valid.cells[0],
              cellId: "district-1-surface-cell-01-00",
              coordinate: [1, 0],
              path: `immutable/district-1-surface-cell-01-00-${"b".repeat(64)}.json`,
            },
          ],
        },
        "district-1-surface",
      ),
    ).toThrow(/outside its bounds/);
    expect(() =>
      parseStreamingDistrictIndex(
        {
          ...valid,
          cells: [{ ...valid.cells[0], coordinate: [-1, 0] }],
        },
        "district-1-surface",
      ),
    ).toThrow(/invalid cell index entry/);
    expect(() =>
      parseStreamingDistrictIndex(
        {
          ...valid,
          cells: [{ ...valid.cells[0], extra: true }],
        },
        "district-1-surface",
      ),
    ).toThrow(/invalid cell index entry/);
    expect(() =>
      parseStreamingDistrictIndex(
        {
          ...valid,
          bounds: {
            extra: true,
            maximum: [256, 100, 256],
            minimum: [0, -10, 0],
          },
        },
        "district-1-surface",
      ),
    ).toThrow(/identity/);
  });
});

function districtIndexDocument() {
  return {
    bounds: { maximum: [256, 100, 256], minimum: [0, -10, 0] },
    cellSizeMeters: 256,
    cells: [
      {
        bytes: 4,
        cellId: "district-1-surface-cell-00-00",
        coordinate: [0, 0],
        path: `immutable/district-1-surface-cell-00-00-${"b".repeat(64)}.json`,
        sha256: "b".repeat(64),
      },
    ],
    districtId: "district-1-surface",
    materials: [{ color: [0.1, 0.2, 0.3], id: "ground" }],
    schemaVersion: 1,
  };
}

function productionCompressedDistrictIndexDocument() {
  const base = districtIndexDocument();
  const textureSha = "c".repeat(64);
  const vertexSha = "d".repeat(64);
  const indexSha = "e".repeat(64);
  return {
    ...base,
    cells: [
      {
        ...base.cells[0],
        dependencies: ["production-02-indices"],
      },
    ],
    resources: [
      {
        bytes: 240,
        decode: {
          colorSpace: "srgb",
          format: "rgba8",
          height: 16,
          version: 1,
          width: 32,
        },
        dependencies: [],
        format: "ktx2",
        path: `immutable/streaming-texture-${textureSha}.ktx2`,
        resourceId: "production-00-texture",
        sha256: textureSha,
      },
      {
        bytes: 256,
        decode: {
          count: 20,
          layout: "position-normal-uv-f32",
          mode: "ATTRIBUTES",
          stride: 32,
          version: 1,
        },
        dependencies: ["production-00-texture"],
        format: "meshopt",
        path: `immutable/streaming-vertices-${vertexSha}.meshopt`,
        resourceId: "production-01-vertices",
        sha256: vertexSha,
      },
      {
        bytes: 60,
        decode: {
          count: 72,
          indexFormat: "uint32",
          mode: "TRIANGLES",
          stride: 4,
          version: 1,
          vertexCount: 20,
        },
        dependencies: ["production-00-texture", "production-01-vertices"],
        format: "meshopt",
        path: `immutable/streaming-indices-${indexSha}.meshopt`,
        resourceId: "production-02-indices",
        sha256: indexSha,
      },
    ],
    schemaVersion: 2,
  };
}

function manifest(resources: readonly InstallResource[]): InstallManifest {
  return Object.freeze({
    gameId: "parallax",
    resources: Object.freeze([...resources]),
    schemaVersion: 1,
  });
}

function resource(
  id: string,
  kind: InstallResource["kind"],
  sha256: string,
  bytes: number,
  source = `immutable/${id}-${sha256}.json`,
): InstallResource {
  return Object.freeze({
    bytes,
    id,
    kind,
    scope: "game-specific",
    sha256,
    source,
    target: "opfs",
  });
}

function modelResources(): InstallResource[] {
  return APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.map((artifact, index) =>
    Object.freeze({
      bytes: artifact.bytes,
      id: `common-model-shard-${index}`,
      kind: "model" as const,
      scope: "common" as const,
      sha256: artifact.sha256,
      source: `immutable/model-${artifact.sha256}.gguf`,
      target: "opfs" as const,
    }),
  );
}

function reference(resourceValue: InstallResource): VerifiedObjectRef {
  if (resourceValue.scope === "app-shell") throw new Error("Test resource must be in OPFS");
  return Object.freeze({
    bytes: resourceValue.bytes,
    path: `parallax-install-v1/objects/${resourceValue.sha256}.data`,
    releaseDigest,
    resourceId: resourceValue.id,
    scope: resourceValue.scope,
    sha256: resourceValue.sha256,
  });
}

function binding(manifestValue: InstallManifest): InstalledReleaseBinding {
  const byId = new Map(manifestValue.resources.map((entry) => [entry.id, entry] as const));
  return Object.freeze({
    manifest: manifestValue,
    releaseDigest,
    async getResource(resourceId: string) {
      const resourceValue = byId.get(resourceId);
      if (resourceValue === undefined) throw new Error(`missing ${resourceId}`);
      return Object.freeze({ manifest: resourceValue, reference: reference(resourceValue) });
    },
    async getResources(resourceIds: readonly string[]) {
      return Promise.all(resourceIds.map((resourceId) => this.getResource(resourceId)));
    },
    snapshot: () =>
      Object.freeze({
        failureMessage: null,
        networkFallbackCount: 0 as const,
        referencedBytes: 0,
        referencedResourceCount: 0,
        releaseDigest,
        schemaVersion: 1 as const,
        state: "ready" as const,
      }),
  });
}

function releaseStore(
  manifestValue: InstallManifest,
  selection = {
    activeReleaseDigest: releaseDigest,
    previousReleaseDigest: null as string | null,
  },
): OpfsReleaseStore {
  const byId = new Map(manifestValue.resources.map((entry) => [entry.id, entry] as const));
  return {
    admitActiveRelease: vi.fn(() => {
      if (selection.activeReleaseDigest !== releaseDigest) {
        return Promise.reject(
          new Error(`Installed runtime release ${releaseDigest} is not the exact active selection`),
        );
      }
      return Promise.resolve(manifestValue);
    }),
    getManifest: vi.fn(() => Promise.resolve(manifestValue)),
    getResource: vi.fn((_: string, resourceId: string) => {
      const resourceValue = byId.get(resourceId);
      if (resourceValue === undefined) return Promise.reject(new Error(`missing ${resourceId}`));
      return Promise.resolve(reference(resourceValue));
    }),
    getResources: vi.fn((_: string, resourceIds: readonly string[]) =>
      Promise.all(
        resourceIds.map((resourceId) => {
          const resourceValue = byId.get(resourceId);
          if (resourceValue === undefined) throw new Error(`missing ${resourceId}`);
          return reference(resourceValue);
        }),
      ),
    ),
    getSelection: vi.fn(() => Promise.resolve(selection)),
  } as unknown as OpfsReleaseStore;
}
