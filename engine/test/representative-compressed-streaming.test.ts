import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as KTX2DecoderPackage from "@babylonjs/ktx2decoder";
import { MeshoptEncoder } from "meshoptimizer/encoder";
import { describe, expect, it, vi } from "vitest";
import {
  evictStreamingGreyboxCell,
  installStreamingGreyboxMaterials,
  type LiteGreyboxWorld,
  retainStreamingGreyboxMaterials,
  uploadStreamingGreyboxCell,
} from "../src/render/lite-greybox-world";
import { createRenderStreamingBatchTransactionManager } from "../src/render/render-streaming-batch";
import {
  CompressedStreamingDecodeError,
  createCompressedStreamingDecoder,
} from "../src/streaming/compressed-streaming-codecs";
import { PRODUCTION_COMPRESSED_STREAMING_FIXTURES } from "../src/streaming/production-compressed-fixtures.generated";
import { representativeCompressedStreamingFixtures } from "../src/streaming/representative-compressed-fixtures";
import { createStreamingResourceCache } from "../src/streaming/streaming-resource-cache";
import type { GreyboxCell } from "../src/world/world-contract";

const lite = vi.hoisted(() => ({
  addToScene: vi.fn((_scene: unknown, _mesh: unknown) => undefined),
  createMeshFromData: vi.fn(() => ({ material: null, visible: false })),
  createStandardMaterial: vi.fn(() => ({ diffuseColor: [0, 0, 0] })),
  createTexture2DFromPixels: vi.fn(() => ({ id: "texture" })),
  disposeMeshGpu: vi.fn(),
  releaseTexture: vi.fn(),
  removeFromScene: vi.fn((_scene: unknown, _mesh: unknown) => undefined),
}));

vi.mock("@babylonjs/lite", () => lite);

describe("representative compressed streaming fixtures", () => {
  it("installs destination materials without invalidating the source registry", () => {
    const renderer = {
      materials: new Map([["ground", { id: "ground", color: [0.1, 0.2, 0.3] }]]),
    } as unknown as LiteGreyboxWorld;
    expect(() =>
      installStreamingGreyboxMaterials(renderer, [{ color: [0.1, 0.2, 0.3], id: "ground" }]),
    ).not.toThrow();
    installStreamingGreyboxMaterials(renderer, [{ color: [0.2, 0.25, 0.3], id: "ceiling-stone" }]);
    expect([...renderer.materials.keys()]).toEqual(["ground", "ceiling-stone"]);
    expect(() =>
      installStreamingGreyboxMaterials(renderer, [{ color: [0.9, 0.9, 0.9], id: "ceiling-stone" }]),
    ).toThrow("conflicts across districts");
    retainStreamingGreyboxMaterials(renderer, new Set(["ceiling-stone"]));
    expect([...renderer.materials.keys()]).toEqual(["ceiling-stone"]);
  });

  it("rejects non-finite legacy meshopt positions before render upload", async () => {
    await MeshoptEncoder.ready;
    const positions = new Float32Array([Number.NaN, 0, 0, 1, 0, 0, 0, 1, 0]);
    const encoded = MeshoptEncoder.encodeGltfBuffer(
      new Uint8Array(positions.buffer),
      3,
      12,
      "ATTRIBUTES",
      0,
    );
    const resourceId = "legacy-non-finite-mesh";
    const failure = await createCompressedStreamingDecoder()
      .decode({
        bytes: encoded.slice().buffer,
        descriptor: {
          bytes: encoded.byteLength,
          decode: { count: 3, mode: "ATTRIBUTES", stride: 12 },
          dependencies: [],
          format: "meshopt",
          path: `immutable/legacy-non-finite-${"a".repeat(64)}.meshopt`,
          resourceId,
          sha256: "a".repeat(64),
        },
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CompressedStreamingDecodeError);
    expect(failure).toMatchObject({ code: "non-finite-vertex-attribute", resourceId });
    expect(lite.createMeshFromData).not.toHaveBeenCalled();
  });

  it("executes the production KTX2 and meshopt codec path with real fixtures", async () => {
    const fixtures = representativeCompressedStreamingFixtures();
    expect(createHash("sha256").update(fixtures.ktx2).digest("hex")).toBe(
      "08968e9d7d9855ae8d201cfaea889e2748fc9049a95838aa18ce689d29c041ca",
    );
    const wasm = readFileSync(
      new URL(
        "../node_modules/@babylonjs/ktx2decoder/wasm/msc_basis_transcoder.wasm",
        import.meta.url,
      ),
    );
    KTX2DecoderPackage.MSCTranscoder.WasmBinary = wasm.buffer.slice(
      wasm.byteOffset,
      wasm.byteOffset + wasm.byteLength,
    );
    const decoder = createCompressedStreamingDecoder();
    const texture = await decoder.decode({
      bytes: fixtures.ktx2.slice().buffer,
      descriptor: {
        bytes: fixtures.ktx2.byteLength,
        decode: { colorSpace: "srgb", format: "rgba8", height: 128, width: 128 },
        dependencies: [],
        format: "ktx2",
        path: `immutable/representative-streaming-ktx2-${"a".repeat(64)}.ktx2`,
        resourceId: "game-specific-streaming-00-texture",
        sha256: "a".repeat(64),
      },
    });
    const mesh = await decoder.decode({
      bytes: fixtures.meshopt.slice().buffer,
      descriptor: {
        bytes: fixtures.meshopt.byteLength,
        decode: { count: 3, mode: "ATTRIBUTES", stride: 12 },
        dependencies: ["game-specific-streaming-00-texture"],
        format: "meshopt",
        path: `immutable/representative-streaming-meshopt-${"b".repeat(64)}.meshopt`,
        resourceId: "game-specific-streaming-01-mesh",
        sha256: "b".repeat(64),
      },
    });
    expect(texture).toMatchObject({ decodedBytes: 128 * 128 * 4, height: 128, width: 128 });
    if (mesh.format !== "meshopt" || mesh.kind !== "legacy-positions") {
      throw new Error("Expected meshopt fixture output");
    }
    expect([...new Float32Array(mesh.positions)]).toEqual([-8, 0, -8, 8, 0, -8, 0, 12, 0]);

    const makeRenderer = (): LiteGreyboxWorld =>
      ({
        config: { world: { materials: [{ id: "ground" }] } },
        engine: {},
        materials: new Map([["ground", { color: [0.1, 0.2, 0.3] }]]),
        presentationOwner: "streamed-residency",
        psoWarmup: { snapshot: () => ({ state: "ready" }) },
        scene: {},
        streamingCells: new Map(),
        streamingDependencyCache: createStreamingResourceCache(),
        streamingDependencyGpuBytes: 0,
      }) as unknown as LiteGreyboxWorld;
    const renderer = makeRenderer();
    const cell = {
      id: "district-1-surface-cell-00-00",
      lods: [{ representations: [] }],
    } as unknown as GreyboxCell;
    const uploaded = uploadStreamingGreyboxCell(renderer, cell, [texture, mesh]);
    expect(uploaded).toMatchObject({
      dependencyUploadBytes: 128 * 128 * 4 + 108,
      dependencyUploadCount: 2,
    });
    expect(uploaded).not.toHaveProperty("psoWarmupGameplayOverlap");
    expect(uploaded.dependencyUploadMs).toBeGreaterThanOrEqual(0);
    expect(lite.createTexture2DFromPixels).toHaveBeenCalledOnce();
    expect(lite.createMeshFromData).toHaveBeenCalledOnce();
    const sharedCells = Array.from(
      { length: 8 },
      (_, index) => ({ ...cell, id: `district-1-surface-cell-${index + 1}-00` }) as GreyboxCell,
    );
    const sharedUploads = sharedCells.map((sharedCell) =>
      uploadStreamingGreyboxCell(renderer, sharedCell, [texture, mesh]),
    );
    expect(sharedUploads.every((upload) => upload.dependencyUploadCount === 0)).toBe(true);
    expect(sharedUploads.at(-1)?.dependencyGpuCache).toMatchObject({
      hitCount: 16,
      liveRefCount: 18,
      liveResourceCount: 2,
      missCount: 2,
    });
    expect(lite.createTexture2DFromPixels).toHaveBeenCalledOnce();
    expect(lite.createMeshFromData).toHaveBeenCalledOnce();

    for (const residentCell of [cell, ...sharedCells.slice(0, -1)]) {
      expect(evictStreamingGreyboxCell(renderer, residentCell.id).freedGpuBytes).toBe(0);
    }
    expect(lite.removeFromScene).not.toHaveBeenCalled();
    expect(lite.releaseTexture).not.toHaveBeenCalled();
    const finalCell = sharedCells.at(-1);
    if (finalCell === undefined) throw new Error("Final shared cell is absent");
    const final = evictStreamingGreyboxCell(renderer, finalCell.id);
    expect(final.freedGpuBytes).toBe(uploaded.gpuBytes);
    expect(final.dependencyGpuCache).toMatchObject({
      liveRefCount: 0,
      liveResourceCount: 0,
      releaseCount: 18,
    });
    expect(lite.removeFromScene).toHaveBeenCalledOnce();
    expect(lite.releaseTexture).toHaveBeenCalledOnce();

    uploadStreamingGreyboxCell(renderer, cell, [texture, mesh]);
    evictStreamingGreyboxCell(renderer, cell.id);
    expect(lite.createTexture2DFromPixels).toHaveBeenCalledTimes(2);
    expect(lite.createMeshFromData).toHaveBeenCalledTimes(2);
    expect(lite.removeFromScene).toHaveBeenCalledTimes(2);
    expect(lite.releaseTexture).toHaveBeenCalledTimes(2);

    const failedCell = { ...cell, id: "failure-cell" } as GreyboxCell;
    expect(() =>
      uploadStreamingGreyboxCell(renderer, failedCell, [
        texture,
        { ...mesh, positions: new ArrayBuffer(12) },
      ]),
    ).toThrow(/meshopt dependency.*invalid/);
    expect(renderer.streamingDependencyCache.snapshot()).toMatchObject({
      liveRefCount: 0,
      liveResourceCount: 0,
    });
    expect(lite.createTexture2DFromPixels).toHaveBeenCalledTimes(3);
    expect(lite.releaseTexture).toHaveBeenCalledTimes(3);
    expect(() => evictStreamingGreyboxCell(renderer, failedCell.id)).toThrow(/not resident/);

    vi.clearAllMocks();
    const cleanupRenderer = makeRenderer();
    const cleanupCell = { ...cell, id: "eviction-cleanup-failure" } as GreyboxCell;
    uploadStreamingGreyboxCell(cleanupRenderer, cleanupCell, [texture, mesh]);
    lite.removeFromScene.mockImplementationOnce(() => {
      throw new Error("dependency mesh removal failed");
    });
    expect(() => evictStreamingGreyboxCell(cleanupRenderer, cleanupCell.id)).toThrow(
      /eviction cleanup failed/,
    );
    expect(cleanupRenderer.streamingCells.size).toBe(0);
    expect(cleanupRenderer.streamingDependencyGpuBytes).toBe(0);
    expect(cleanupRenderer.streamingDependencyCache.snapshot()).toMatchObject({
      liveDecodedBytes: 0,
      liveRefCount: 0,
      liveResourceCount: 0,
    });
    expect(lite.releaseTexture).toHaveBeenCalledOnce();
    expect(() => evictStreamingGreyboxCell(cleanupRenderer, cleanupCell.id)).toThrow(
      /not resident/,
    );

    vi.clearAllMocks();
    const batchCells = Array.from(
      { length: 9 },
      (_, index) => ({ ...cell, id: `batch-cell-${index + 1}` }) as GreyboxCell,
    );
    const dependencyEncodedBytes = texture.encodedBytes + mesh.encodedBytes;
    const batchManager = createRenderStreamingBatchTransactionManager({
      evict: (cellId) => evictStreamingGreyboxCell(renderer, cellId),
      upload: (member) => uploadStreamingGreyboxCell(renderer, member.cell, member.dependencies),
    });
    let batchResponse: Parameters<Parameters<typeof batchManager.transact>[1]>[0] | undefined;
    batchManager.transact(
      {
        batchCellCount: 9,
        batchDemandEncodedBytes: 9 * (100 + dependencyEncodedBytes),
        batchOrdinal: 1,
        batchTransactionId: "1:1:1:0",
        kind: "render-batch-transaction",
        members: batchCells.map((batchCell, index) => ({
          batchCellOrdinal: index + 1,
          cell: batchCell,
          cellId: batchCell.id,
          dependencies: [texture, mesh],
          encodedBytes: 100 + (index === 0 ? dependencyEncodedBytes : 0),
        })),
        requestId: 1,
      },
      (response) => {
        batchResponse = response;
      },
    );
    expect(batchResponse).toMatchObject({
      batchDemandEncodedBytes: 9 * (100 + dependencyEncodedBytes),
      batchEncodedBytes: 9 * 100 + dependencyEncodedBytes,
      dependencyGpuCache: { liveRefCount: 18, liveResourceCount: 2 },
    });
    expect(
      batchResponse?.members.reduce((sum, member) => sum + member.dependencyUploadCount, 0),
    ).toBe(2);
    expect(lite.createTexture2DFromPixels).toHaveBeenCalledOnce();
    expect(lite.createMeshFromData).toHaveBeenCalledOnce();
    for (const batchCell of batchCells) evictStreamingGreyboxCell(renderer, batchCell.id);

    const intraUploadFailures = [
      {
        inject: () =>
          lite.createTexture2DFromPixels.mockImplementationOnce(() => {
            throw new Error("texture allocation failed");
          }),
        message: "texture allocation failed",
      },
      {
        inject: () =>
          lite.createMeshFromData.mockImplementationOnce(() => {
            throw new Error("mesh allocation failed");
          }),
        message: "mesh allocation failed",
      },
      {
        inject: () =>
          lite.createStandardMaterial.mockImplementationOnce(() => {
            throw new Error("material allocation failed");
          }),
        message: "material allocation failed",
      },
      {
        inject: () => {
          const partialRegistry = new Set<unknown>();
          lite.addToScene.mockImplementationOnce((_scene, mesh) => {
            partialRegistry.add(mesh);
            throw new Error("scene insertion failed");
          });
          lite.removeFromScene.mockImplementationOnce((_scene, mesh) => {
            if (!partialRegistry.delete(mesh)) throw new Error("partial mesh was not registered");
            lite.disposeMeshGpu(mesh);
          });
        },
        message: "scene insertion failed",
      },
    ];
    for (const [index, failure] of intraUploadFailures.entries()) {
      vi.clearAllMocks();
      failure.inject();
      const failureRenderer = makeRenderer();
      const failureCell = { ...cell, id: `intra-upload-failure-${index}` } as GreyboxCell;
      expect(() =>
        uploadStreamingGreyboxCell(failureRenderer, failureCell, [texture, mesh]),
      ).toThrow(failure.message);
      expect(failureRenderer.streamingCells.size).toBe(0);
      expect(failureRenderer.streamingDependencyGpuBytes).toBe(0);
      expect(failureRenderer.streamingDependencyCache.snapshot()).toMatchObject({
        liveDecodedBytes: 0,
        liveRefCount: 0,
        liveResourceCount: 0,
      });
      if (index >= 2) expect(lite.disposeMeshGpu).toHaveBeenCalledOnce();
    }

    vi.clearAllMocks();
    const rollbackCells = [
      { ...cell, id: "rollback-cell-1" } as GreyboxCell,
      { ...cell, id: "rollback-cell-2" } as GreyboxCell,
    ];
    const manager = createRenderStreamingBatchTransactionManager({
      evict: (cellId) => evictStreamingGreyboxCell(renderer, cellId),
      upload: (member) => uploadStreamingGreyboxCell(renderer, member.cell, member.dependencies),
    });
    expect(() =>
      manager.transact(
        {
          batchCellCount: 2,
          batchDemandEncodedBytes: 200,
          batchOrdinal: 1,
          batchTransactionId: "1:1:1:0",
          kind: "render-batch-transaction",
          members: rollbackCells.map((rollbackCell, index) => ({
            batchCellOrdinal: index + 1,
            cell: rollbackCell,
            cellId: rollbackCell.id,
            dependencies:
              index === 0 ? [texture, mesh] : [texture, { ...mesh, cacheKey: "invalid-cache-key" }],
            encodedBytes: 100,
          })),
          requestId: 1,
        },
        () => undefined,
      ),
    ).toThrow(/cache key is invalid/);
    expect(renderer.streamingCells.size).toBe(0);
    expect(renderer.streamingDependencyCache.snapshot()).toMatchObject({
      liveRefCount: 0,
      liveResourceCount: 0,
    });
    expect(lite.createTexture2DFromPixels).toHaveBeenCalledOnce();
    expect(lite.createMeshFromData).toHaveBeenCalledOnce();
    expect(lite.releaseTexture).toHaveBeenCalledOnce();
    expect(lite.removeFromScene).toHaveBeenCalledOnce();
  });

  it("decodes materially different production-like texture, attribute, and index graphs", async () => {
    vi.clearAllMocks();
    for (const [transcoder, file] of [
      [KTX2DecoderPackage.LiteTranscoder_UASTC_RGBA_SRGB, "uastc_rgba8_srgb_v2.wasm"],
      [KTX2DecoderPackage.LiteTranscoder_UASTC_RGBA_UNORM, "uastc_rgba8_unorm_v2.wasm"],
    ] as const) {
      const bytes = readFileSync(
        new URL(`../node_modules/@babylonjs/ktx2decoder/wasm/${file}`, import.meta.url),
      );
      transcoder.WasmBinary = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );
    }
    const wasm = readFileSync(
      new URL(
        "../node_modules/@babylonjs/ktx2decoder/wasm/msc_basis_transcoder.wasm",
        import.meta.url,
      ),
    );
    KTX2DecoderPackage.MSCTranscoder.WasmBinary = wasm.buffer.slice(
      wasm.byteOffset,
      wasm.byteOffset + wasm.byteLength,
    );
    const decoder = createCompressedStreamingDecoder();
    const decodedGraphs = [];
    for (const fixture of PRODUCTION_COMPRESSED_STREAMING_FIXTURES) {
      const ktx2 = Uint8Array.from(Buffer.from(fixture.ktx2, "base64"));
      const attributes = Uint8Array.from(Buffer.from(fixture.attributes, "base64"));
      const indices = Uint8Array.from(Buffer.from(fixture.indices, "base64"));
      const textureId = `${fixture.id}-texture`;
      const vertexId = `${fixture.id}-vertices`;
      const indexId = `${fixture.id}-indices`;
      const texture = await decoder.decode({
        bytes: ktx2.buffer,
        descriptor: {
          bytes: ktx2.byteLength,
          decode: {
            colorSpace: "srgb",
            format: "rgba8",
            height: fixture.height,
            version: 1,
            width: fixture.width,
          },
          dependencies: [],
          format: "ktx2",
          path: `immutable/streaming-texture-${"a".repeat(64)}.ktx2`,
          resourceId: textureId,
          sha256: "a".repeat(64),
        },
      });
      const vertices = await decoder.decode({
        bytes: attributes.buffer,
        descriptor: {
          bytes: attributes.byteLength,
          decode: {
            count: fixture.vertexCount,
            layout: "position-normal-uv-f32",
            mode: "ATTRIBUTES",
            stride: 32,
            version: 1,
          },
          dependencies: [textureId],
          format: "meshopt",
          path: `immutable/streaming-vertices-${"b".repeat(64)}.meshopt`,
          resourceId: vertexId,
          sha256: "b".repeat(64),
        },
      });
      const index = await decoder.decode({
        bytes: indices.buffer,
        descriptor: {
          bytes: indices.byteLength,
          decode: {
            count: fixture.indexCount,
            indexFormat: "uint32",
            mode: "TRIANGLES",
            stride: 4,
            version: 1,
            vertexCount: fixture.vertexCount,
          },
          dependencies: [textureId, vertexId],
          format: "meshopt",
          path: `immutable/streaming-indices-${"c".repeat(64)}.meshopt`,
          resourceId: indexId,
          sha256: "c".repeat(64),
        },
      });
      expect(texture).toMatchObject({
        decodedBytes: fixture.width * fixture.height * 4,
        height: fixture.height,
        width: fixture.width,
      });
      expect(vertices).toMatchObject({
        decodedBytes: fixture.vertexCount * 32,
        kind: "vertex-attributes",
        vertexCount: fixture.vertexCount,
      });
      expect(index).toMatchObject({
        decodedBytes: fixture.indexCount * 4,
        indexCount: fixture.indexCount,
        kind: "indices",
      });
      if (vertices.format !== "meshopt" || vertices.kind !== "vertex-attributes") {
        throw new Error("Expected production vertex attributes");
      }
      if (index.format !== "meshopt" || index.kind !== "indices") {
        throw new Error("Expected production indices");
      }
      expect(
        [...new Uint32Array(index.indices)].every((value) => value < fixture.vertexCount),
      ).toBe(true);
      decodedGraphs.push({ fixture, index, texture, vertices });
    }
    expect(decodedGraphs.map(({ fixture }) => [fixture.width, fixture.vertexCount])).toEqual([
      [32, 20],
      [128, 561],
    ]);

    const compact = decodedGraphs[0];
    if (compact === undefined) throw new Error("Compact production fixture is absent");
    await MeshoptEncoder.ready;
    const nonFiniteAttributes = new Float32Array(compact.fixture.vertexCount * 8);
    nonFiniteAttributes[7] = Number.NaN;
    const nonFiniteEncoded = MeshoptEncoder.encodeGltfBuffer(
      new Uint8Array(nonFiniteAttributes.buffer),
      compact.fixture.vertexCount,
      32,
      "ATTRIBUTES",
      0,
    );
    const nonFiniteFailure = await decoder
      .decode({
        bytes: nonFiniteEncoded.slice().buffer,
        descriptor: {
          ...compact.vertices.descriptor,
          bytes: nonFiniteEncoded.byteLength,
        },
      })
      .catch((error: unknown) => error);
    expect(nonFiniteFailure).toBeInstanceOf(CompressedStreamingDecodeError);
    expect(nonFiniteFailure).toMatchObject({
      code: "non-finite-vertex-attribute",
      name: "CompressedStreamingDecodeError",
      resourceId: compact.vertices.resourceId,
    });
    const outOfRangeIndices = new Uint32Array(compact.fixture.indexCount);
    for (let index = 0; index < outOfRangeIndices.length; index += 1) {
      outOfRangeIndices[index] = index % compact.fixture.vertexCount;
    }
    outOfRangeIndices[0] = compact.fixture.vertexCount;
    const outOfRangeEncoded = MeshoptEncoder.encodeGltfBuffer(
      new Uint8Array(outOfRangeIndices.buffer),
      outOfRangeIndices.length,
      4,
      "TRIANGLES",
      0,
    );
    const outOfRangeFailure = await decoder
      .decode({
        bytes: outOfRangeEncoded.slice().buffer,
        descriptor: {
          ...compact.index.descriptor,
          bytes: outOfRangeEncoded.byteLength,
        },
      })
      .catch((error: unknown) => error);
    expect(outOfRangeFailure).toBeInstanceOf(CompressedStreamingDecodeError);
    expect(outOfRangeFailure).toMatchObject({
      code: "vertex-index-out-of-range",
      name: "CompressedStreamingDecodeError",
      resourceId: compact.index.resourceId,
    });

    const makeRenderer = () =>
      ({
        config: { world: { materials: [{ id: "ground" }] } },
        engine: {},
        materials: new Map([["ground", { color: [0.1, 0.2, 0.3] }]]),
        presentationOwner: "streamed-residency",
        psoWarmup: { snapshot: () => ({ state: "ready" }) },
        scene: {},
        streamingCells: new Map(),
        streamingDependencyCache: createStreamingResourceCache(),
        streamingDependencyGpuBytes: 0,
      }) as unknown as LiteGreyboxWorld;
    for (const graph of decodedGraphs) {
      const renderer = makeRenderer();
      const cell = {
        id: `district-1-surface-cell-${graph.fixture.id}`,
        lods: [{ representations: [] }],
      } as unknown as GreyboxCell;
      const upload = uploadStreamingGreyboxCell(renderer, cell, [
        graph.texture,
        graph.vertices,
        graph.index,
      ]);
      expect(upload).toMatchObject({
        dependencyUploadBytes:
          graph.fixture.width * graph.fixture.height * 4 +
          graph.fixture.vertexCount * 32 +
          graph.fixture.indexCount * 4,
        dependencyUploadCount: 3,
        dependencyGpuCache: { liveRefCount: 3, liveResourceCount: 3 },
      });
      expect(lite.createMeshFromData).toHaveBeenLastCalledWith(
        renderer.engine,
        `streaming-dependency-${graph.index.resourceId}`,
        expect.objectContaining({ length: graph.fixture.vertexCount * 3 }),
        expect.objectContaining({ length: graph.fixture.vertexCount * 3 }),
        expect.objectContaining({ length: graph.fixture.indexCount }),
        expect.objectContaining({ length: graph.fixture.vertexCount * 2 }),
      );
      expect(evictStreamingGreyboxCell(renderer, cell.id).dependencyGpuCache).toMatchObject({
        liveRefCount: 0,
        liveResourceCount: 0,
      });
    }
    expect(lite.createMeshFromData).toHaveBeenCalledTimes(2);
    expect(lite.removeFromScene).toHaveBeenCalledTimes(2);
    expect(lite.releaseTexture).toHaveBeenCalledTimes(2);

    const graph = decodedGraphs[1];
    if (graph === undefined) throw new Error("Expanded production fixture is absent");
    const renderer = makeRenderer();
    const cell = {
      id: "district-1-surface-cell-production",
      lods: [{ representations: [] }],
    } as unknown as GreyboxCell;

    vi.clearAllMocks();
    const invalidIndices = graph.index.indices.slice(0);
    new Uint32Array(invalidIndices)[0] = graph.fixture.vertexCount;
    const invalidRenderer = {
      ...renderer,
      streamingCells: new Map(),
      streamingDependencyCache: createStreamingResourceCache(),
      streamingDependencyGpuBytes: 0,
    } as unknown as LiteGreyboxWorld;
    expect(() =>
      uploadStreamingGreyboxCell(invalidRenderer, { ...cell, id: "invalid-index-cell" }, [
        graph.texture,
        graph.vertices,
        { ...graph.index, indices: invalidIndices },
      ]),
    ).toThrow(/index dependency.*invalid/);
    expect(invalidRenderer.streamingDependencyCache.snapshot()).toMatchObject({
      liveRefCount: 0,
      liveResourceCount: 0,
    });
    expect(lite.releaseTexture).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    lite.createStandardMaterial.mockImplementationOnce(() => {
      throw new Error("production material allocation failed");
    });
    const allocationRenderer = {
      ...renderer,
      streamingCells: new Map(),
      streamingDependencyCache: createStreamingResourceCache(),
      streamingDependencyGpuBytes: 0,
    } as unknown as LiteGreyboxWorld;
    expect(() =>
      uploadStreamingGreyboxCell(allocationRenderer, { ...cell, id: "allocation-failure-cell" }, [
        graph.texture,
        graph.vertices,
        graph.index,
      ]),
    ).toThrow("production material allocation failed");
    expect(lite.disposeMeshGpu).toHaveBeenCalledOnce();
    expect(lite.releaseTexture).toHaveBeenCalledOnce();
    expect(allocationRenderer.streamingDependencyCache.snapshot()).toMatchObject({
      liveRefCount: 0,
      liveResourceCount: 0,
    });
  });
});
