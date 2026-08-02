import { describe, expect, it } from "vitest";
import {
  executeStreamingBatchCacheTransaction,
  planStreamingBatch,
} from "../src/streaming/streaming-batch-cache-transaction";
import { expectedStreamingDependencyGpuBytes } from "../src/streaming/streaming-cache-correlation";
import type {
  DecodedStreamingDependency,
  RenderBatchTransactionRequest,
  StreamingCellIndexEntry,
  StreamingDependencyIndexEntry,
} from "../src/streaming/streaming-protocol";
import { createStreamingResourceCache } from "../src/streaming/streaming-resource-cache";
import { streamingResourceCacheKey } from "../src/streaming/streaming-resource-key";
import type { GreyboxCell } from "../src/world/world-contract";

const resources = Object.freeze([
  Object.freeze({
    bytes: 9,
    decode: Object.freeze({ colorSpace: "srgb", format: "rgba8", height: 2, width: 2 }),
    dependencies: Object.freeze([]),
    format: "ktx2",
    path: "installed/release/texture.ktx2",
    resourceId: "texture",
    sha256: "a".repeat(64),
  }),
  Object.freeze({
    bytes: 12,
    decode: Object.freeze({ count: 3, mode: "ATTRIBUTES", stride: 12 }),
    dependencies: Object.freeze(["texture"]),
    format: "meshopt",
    path: "installed/release/mesh.meshopt",
    resourceId: "mesh",
    sha256: "b".repeat(64),
  }),
]) satisfies readonly StreamingDependencyIndexEntry[];

describe("streaming batch cache transaction", () => {
  it("executes installed first-nine miss/hit accounting and reverses a post-commit rejection", async () => {
    const entries = Object.freeze(
      Array.from({ length: 9 }, (_, index) =>
        Object.freeze({
          bytes: 10,
          cellId: `cell-${index + 1}`,
          coordinate: Object.freeze([index, 0] as const),
          dependencies: Object.freeze(["mesh"]),
          path: `installed/release/cell-${index + 1}.cell`,
          sha256: (index + 1).toString(16).padStart(64, "0"),
        }),
      ),
    ) satisfies readonly StreamingCellIndexEntry[];
    const installed = new Map<string, Uint8Array>([
      ...entries.map((entry) => [entry.path, new Uint8Array(entry.bytes)] as const),
      ...resources.map((resource) => [resource.path, new Uint8Array(resource.bytes)] as const),
    ]);
    const reads: string[] = [];
    const cpu = createStreamingResourceCache<DecodedStreamingDependency>();
    const committed = new Set<string>();
    const renderRollbacks: string[] = [];
    const plans = planStreamingBatch(entries, resources, 1);

    const operation = executeStreamingBatchCacheTransaction({
      afterCommit: () => {
        throw new Error("post-commit telemetry rejection");
      },
      batchOrdinal: 1,
      batchTransactionId: "1:1:1:0",
      commitResident: (cell) => committed.add(cell.entry.cellId),
      dependencyCache: cpu,
      now: () => 10,
      plans,
      prepareCell: async (entry, misses, descriptors, keys) => {
        const cellBytes = installed.get(entry.path);
        if (cellBytes === undefined) throw new Error("installed cell absent");
        reads.push(entry.path);
        const dependencies = misses.map((descriptor): DecodedStreamingDependency => {
          const encoded = installed.get(descriptor.path);
          if (encoded === undefined) throw new Error("installed dependency absent");
          reads.push(descriptor.path);
          return descriptor.format === "ktx2"
            ? Object.freeze({
                cacheKey: streamingResourceCacheKey(descriptor),
                decodeMs: 0,
                decodedBytes: 16,
                descriptor,
                encodedBytes: encoded.byteLength,
                format: "ktx2" as const,
                height: 2,
                resourceId: descriptor.resourceId,
                rgba: new ArrayBuffer(16),
                width: 2,
              })
            : Object.freeze({
                cacheKey: streamingResourceCacheKey(descriptor),
                decodeMs: 0,
                decodedBytes: 36,
                descriptor,
                encodedBytes: encoded.byteLength,
                format: "meshopt" as const,
                kind: "legacy-positions" as const,
                positions: new ArrayBuffer(36),
                resourceId: descriptor.resourceId,
                vertexCount: 3,
              });
        });
        const dependencyEncodedBytes = dependencies.reduce(
          (sum, dependency) => sum + dependency.encodedBytes,
          0,
        );
        return Object.freeze({
          decodeCompletedAt: 3,
          decoded: Object.freeze({
            cell: { id: entry.cellId } as GreyboxCell,
            decodeMs: 0,
            dependencies: Object.freeze(dependencies),
            encodedBytes: cellBytes.byteLength + dependencyEncodedBytes,
          }),
          dependencyDescriptors: descriptors,
          dependencyEncodedBytes,
          dependencyKeys: keys,
          dependencyReadMs: 0,
          entry,
          opfsCompletedAt: 2,
          readMs: 0,
          renderDependencies: Object.freeze([]),
          totalStartedAt: 1,
        });
      },
      requestId: 1,
      requestRender: (request) => {
        if (request.kind !== "render-batch-transaction") throw new Error("unexpected request");
        const transaction = request satisfies RenderBatchTransactionRequest;
        expect(transaction.batchDemandEncodedBytes).toBe(9 * 10 + 21);
        expect(
          transaction.members[0]?.dependencies.every(
            (dependency) =>
              !("kind" in dependency) || dependency.kind !== "cached-dependency-reference",
          ),
        ).toBe(true);
        expect(
          transaction.members
            .slice(1)
            .every((member) =>
              member.dependencies.every(
                (dependency) =>
                  "kind" in dependency && dependency.kind === "cached-dependency-reference",
              ),
            ),
        ).toBe(true);
        const gpu = createStreamingResourceCache<object>();
        for (const member of transaction.members) {
          for (const dependency of member.dependencies) {
            const acquired = gpu.acquire(dependency.descriptor);
            if (acquired.miss) {
              gpu.setOwnedBytes(
                acquired.key,
                0,
                expectedStreamingDependencyGpuBytes(dependency.descriptor),
              );
              gpu.fulfill(acquired.key, {});
            }
          }
        }
        return Promise.resolve().then(() => {
          expect(cpu.snapshot()).toMatchObject({ liveDecodedBytes: 0, liveEncodedBytes: 0 });
          return Object.freeze({
            batchCellCount: 9,
            batchDemandEncodedBytes: 9 * 10 + 21,
            batchDirectUploadMs: 0,
            batchEncodedBytes: 9 * 10 + 21,
            batchGpuBytes: 9 + 124,
            batchOrdinal: 1,
            batchTransactionId: "1:1:1:0",
            dependencyGpuCache: gpu.snapshot(),
            kind: "render-batch-transaction-complete" as const,
            members: Object.freeze(
              transaction.members.map((member, index) =>
                Object.freeze({
                  batchCellOrdinal: index + 1,
                  cellGpuBytes: 1,
                  cellId: member.cellId,
                  dependencyUploadBytes: index === 0 ? 124 : 0,
                  dependencyUploadCount: index === 0 ? 2 : 0,
                  dependencyUploadMs: 0,
                  gpuBytes: index === 0 ? 125 : 1,
                  psoWarmupGameplayOverlap: false,
                  uploadMs: 0,
                }),
              ),
            ),
            requestId: 1,
          });
        });
      },
      resources,
      rollbackRenderResident: async (cellId) => {
        renderRollbacks.push(cellId);
      },
      rollbackResident: (cellId) => committed.delete(cellId),
    });

    await expect(operation).rejects.toThrow("post-commit telemetry rejection");
    expect(reads).toEqual([
      entries[0]?.path,
      resources[0]?.path,
      resources[1]?.path,
      ...entries.slice(1).map((entry) => entry.path),
    ]);
    expect(renderRollbacks).toEqual(entries.map((entry) => entry.cellId).reverse());
    expect(committed.size).toBe(0);
    expect(cpu.snapshot()).toMatchObject({ liveRefCount: 0, liveResourceCount: 0 });
  });
});
