import { describe, expect, it, vi } from "vitest";
import type { GreyboxCell } from "../src/index";
import { createRenderStreamingBatchTransactionManager } from "../src/render/render-streaming-batch";
import type {
  RenderBatchTransactionRequest,
  RenderBatchTransactionResponse,
} from "../src/streaming/streaming-protocol";
import { streamingResourceCacheKey } from "../src/streaming/streaming-resource-key";

const EMPTY_CACHE = Object.freeze({
  acquireCount: 0,
  hitCount: 0,
  liveDecodedBytes: 0,
  liveEncodedBytes: 0,
  liveRefCount: 0,
  liveResourceCount: 0,
  missCount: 0,
  releaseCount: 0,
  resources: Object.freeze([]),
});

function cell(cellId: string): GreyboxCell {
  return { id: cellId } as unknown as GreyboxCell;
}

function transactionRequest(size: number): RenderBatchTransactionRequest {
  return {
    batchCellCount: size,
    batchDemandEncodedBytes: Array.from({ length: size }, (_, index) => 100 + index).reduce(
      (sum, value) => sum + value,
      0,
    ),
    batchOrdinal: 2,
    batchTransactionId: "1:2:1:0",
    kind: "render-batch-transaction",
    members: Array.from({ length: size }, (_, index) => ({
      batchCellOrdinal: index + 1,
      cell: cell(`cell-${index + 1}`),
      cellId: `cell-${index + 1}`,
      dependencies: [],
      encodedBytes: 100 + index,
    })),
    requestId: 1,
  };
}

function requireMember<T>(members: readonly T[], index: number): T {
  const member = members[index];
  if (member === undefined) throw new Error(`Test member ${index} is absent`);
  return member;
}

function uploadResult(gpuBytes: number) {
  return {
    cellGpuBytes: gpuBytes,
    dependencyGpuCache: EMPTY_CACHE,
    dependencyUploadBytes: 0,
    dependencyUploadCount: 0,
    dependencyUploadMs: 0,
    gpuBytes,
  };
}

describe("render streaming batch transactions", () => {
  it.each([
    1, 3, 9,
  ])("uploads a %i-cell scheduler batch and acknowledges it with one response", (size) => {
    let now = 0;
    const uploaded: string[] = [];
    const acknowledged: RenderBatchTransactionResponse[] = [];
    const evict = vi.fn(() => 1);
    const manager = createRenderStreamingBatchTransactionManager({
      evict,
      now: () => now++,
      upload: (member) => {
        uploaded.push(member.cellId);
        return uploadResult(member.encodedBytes * 2);
      },
    });
    const request = transactionRequest(size);
    manager.transact(request, (response) => acknowledged.push(response));
    expect(uploaded).toEqual(request.members.map(({ cellId }) => cellId));
    expect(acknowledged).toHaveLength(1);
    expect(acknowledged[0]).toMatchObject({
      batchCellCount: size,
      batchEncodedBytes: request.members.reduce((sum, member) => sum + member.encodedBytes, 0),
      batchGpuBytes: request.members.reduce((sum, member) => sum + member.encodedBytes * 2, 0),
      batchTransactionId: request.batchTransactionId,
      kind: "render-batch-transaction-complete",
      requestId: 1,
    });
    expect(acknowledged[0]?.members).toHaveLength(size);
    expect(evict).not.toHaveBeenCalled();
    manager.dispose();
    expect(evict).not.toHaveBeenCalled();
  });

  it("does not acknowledge until every ordered member upload is complete", () => {
    const events: string[] = [];
    const manager = createRenderStreamingBatchTransactionManager({
      evict: () => 1,
      upload: (member) => {
        events.push(`upload:${member.cellId}`);
        return uploadResult(1);
      },
    });
    manager.transact(transactionRequest(3), (response) => {
      events.push(`ack:${response.members.map(({ cellId }) => cellId).join(",")}`);
    });
    expect(events).toEqual([
      "upload:cell-1",
      "upload:cell-2",
      "upload:cell-3",
      "ack:cell-1,cell-2,cell-3",
    ]);
  });

  it("prevalidates malformed membership without mutating and rejects replay", () => {
    const upload = vi.fn(() => uploadResult(1));
    const manager = createRenderStreamingBatchTransactionManager({
      evict: () => 1,
      upload,
    });
    const base = transactionRequest(3);
    const first = requireMember(base.members, 0);
    const second = requireMember(base.members, 1);
    const third = requireMember(base.members, 2);
    const malformed = [
      { ...base, members: base.members.slice(0, 2) },
      { ...base, members: [...base.members, first] },
      { ...base, members: [second, first, third] },
      { ...base, members: [first, { ...second, cellId: "cell-1" }, third] },
      { ...base, members: [first, { ...second, cell: cell("wrong") }, third] },
      { ...base, batchTransactionId: "1:3:1:0" },
      { ...base, requestId: 0 },
    ] satisfies readonly RenderBatchTransactionRequest[];
    for (const request of malformed) {
      expect(() => manager.transact(request, () => undefined)).toThrow(/membership/);
    }
    expect(upload).not.toHaveBeenCalled();
    manager.transact(base, () => undefined);
    expect(() => manager.transact(base, () => undefined)).toThrow(/duplicate/);
    expect(() => manager.transact({ ...base, requestId: 2 }, () => undefined)).toThrow(/duplicate/);
  });

  it.each([
    {
      expectedEvents: ["upload:cell-1", "upload-cleanup:cell-1"],
      failureOrdinal: 1,
      position: "first",
    },
    {
      expectedEvents: [
        "upload:cell-1",
        "upload:cell-2",
        "upload:cell-3",
        "upload-cleanup:cell-3",
        "evict:cell-2",
        "evict:cell-1",
      ],
      failureOrdinal: 3,
      position: "middle",
    },
  ])("leaves a throwing $position member to upload cleanup and rolls back only completed peers", ({
    expectedEvents,
    failureOrdinal,
  }) => {
    const events: string[] = [];
    const residentCells = new Set<string>();
    const postError = vi.fn();
    const evict = vi.fn((cellId: string) => {
      if (!residentCells.delete(cellId)) {
        throw new Error(`Test renderer cannot evict non-resident ${cellId}`);
      }
      events.push(`evict:${cellId}`);
      return 1;
    });
    const manager = createRenderStreamingBatchTransactionManager({
      evict,
      onRollbackFailure: postError,
      upload: (member) => {
        events.push(`upload:${member.cellId}`);
        if (member.batchCellOrdinal === failureOrdinal) {
          events.push(`upload-cleanup:${member.cellId}`);
          throw new Error(`upload failed for ${member.cellId}`);
        }
        residentCells.add(member.cellId);
        return uploadResult(1);
      },
    });
    expect(() => manager.transact(transactionRequest(5), () => undefined)).toThrow(
      `upload failed for cell-${failureOrdinal}`,
    );
    expect(events).toEqual(expectedEvents);
    expect(residentCells.size).toBe(0);
    expect(postError).not.toHaveBeenCalled();
  });

  it("rolls back the invalid current member and completed peers in reverse order", () => {
    const evicted: string[] = [];
    const residentCells = new Set<string>();
    const manager = createRenderStreamingBatchTransactionManager({
      evict: (cellId) => {
        if (!residentCells.delete(cellId)) {
          throw new Error(`Test renderer cannot evict non-resident ${cellId}`);
        }
        evicted.push(cellId);
        return 1;
      },
      upload: (member) => {
        residentCells.add(member.cellId);
        return uploadResult(member.batchCellOrdinal === 2 ? -1 : 1);
      },
    });
    expect(() => manager.transact(transactionRequest(3), () => undefined)).toThrow(
      /upload is invalid/,
    );
    expect(evicted).toEqual(["cell-2", "cell-1"]);
    expect(residentCells.size).toBe(0);
  });

  it("continues peer rollback when eviction and its diagnostic callback both throw", () => {
    const evictionAttempts: string[] = [];
    const diagnosticAttempts: string[] = [];
    const manager = createRenderStreamingBatchTransactionManager({
      evict: (cellId) => {
        evictionAttempts.push(cellId);
        throw new Error(`evict failed:${cellId}`);
      },
      onRollbackFailure: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        diagnosticAttempts.push(message);
        throw new Error(`diagnostic failed:${message}`);
      },
      upload: (member) => uploadResult(member.batchCellOrdinal === 3 ? -1 : 1),
    });

    let failure: unknown;
    try {
      manager.transact(transactionRequest(3), () => undefined);
    } catch (error: unknown) {
      failure = error;
    }

    expect(evictionAttempts).toEqual(["cell-3", "cell-2", "cell-1"]);
    expect(diagnosticAttempts).toEqual([
      "evict failed:cell-3",
      "evict failed:cell-2",
      "evict failed:cell-1",
    ]);
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError)) throw failure;
    expect(failure.cause).toMatchObject({ message: expect.stringMatching(/upload is invalid/) });
    expect(failure.errors.map((error) => (error instanceof Error ? error.message : error))).toEqual(
      [
        expect.stringMatching(/upload is invalid/),
        "evict failed:cell-3",
        "diagnostic failed:evict failed:cell-3",
        "evict failed:cell-2",
        "diagnostic failed:evict failed:cell-2",
        "evict failed:cell-1",
        "diagnostic failed:evict failed:cell-1",
      ],
    );
  });

  it("rolls back every uploaded member when aggregate GPU accounting is invalid", () => {
    const evicted: string[] = [];
    const manager = createRenderStreamingBatchTransactionManager({
      evict: (cellId) => {
        evicted.push(cellId);
        return 1;
      },
      upload: () => uploadResult(Number.MAX_SAFE_INTEGER),
    });
    expect(() => manager.transact(transactionRequest(2), () => undefined)).toThrow(
      /upload is invalid/,
    );
    expect(evicted).toEqual(["cell-2", "cell-1"]);
  });

  it("rejects untruthful dependency upload count or non-dependency timing", () => {
    const base = transactionRequest(1);
    const first = requireMember(base.members, 0);
    const descriptor = {
      bytes: 9,
      decode: { colorSpace: "srgb" as const, format: "rgba8" as const, height: 2, width: 2 },
      dependencies: [],
      format: "ktx2" as const,
      path: `immutable/representative-streaming-ktx2-${"a".repeat(64)}.ktx2`,
      resourceId: "texture",
      sha256: "a".repeat(64),
    };
    const request = {
      ...base,
      members: [
        {
          ...first,
          dependencies: [
            {
              cacheKey: streamingResourceCacheKey(descriptor),
              decodeMs: 1,
              decodedBytes: 16,
              descriptor,
              encodedBytes: 9,
              format: "ktx2" as const,
              height: 2,
              resourceId: "texture",
              rgba: new ArrayBuffer(16),
              width: 2,
            },
          ],
        },
      ],
    };
    const evict = vi.fn(() => 1);
    const invalidCount = createRenderStreamingBatchTransactionManager({
      evict,
      upload: () => ({ ...uploadResult(1), dependencyUploadCount: 2 }),
    });
    expect(() => invalidCount.transact(request, () => undefined)).toThrow(/upload is invalid/);
    expect(evict).toHaveBeenCalledWith("cell-1");

    let now = 0;
    const invalidTiming = createRenderStreamingBatchTransactionManager({
      evict: () => 1,
      now: () => now++,
      upload: () => ({
        cellGpuBytes: 1,
        dependencyGpuCache: EMPTY_CACHE,
        dependencyUploadBytes: 16,
        dependencyUploadCount: 1,
        dependencyUploadMs: 2,
        gpuBytes: 17,
      }),
    });
    expect(() => invalidTiming.transact(request, () => undefined)).toThrow(/upload is invalid/);
  });

  it("rolls back the complete batch when synchronous response enqueue throws", () => {
    const evicted: string[] = [];
    const manager = createRenderStreamingBatchTransactionManager({
      evict: (cellId) => {
        evicted.push(cellId);
        return 1;
      },
      upload: () => uploadResult(1),
    });
    expect(() =>
      manager.transact(transactionRequest(3), () => {
        throw new Error("enqueue failed");
      }),
    ).toThrow("enqueue failed");
    expect(evicted).toEqual(["cell-3", "cell-2", "cell-1"]);
  });

  it("does not roll back after successful synchronous response enqueue", () => {
    const evict = vi.fn(() => 1);
    const manager = createRenderStreamingBatchTransactionManager({
      evict,
      upload: () => uploadResult(1),
    });
    manager.transact(transactionRequest(3), () => undefined);
    manager.dispose();
    expect(evict).not.toHaveBeenCalled();
  });

  it("closes permanently on dispose instead of reopening the replay window", () => {
    const upload = vi.fn(() => uploadResult(1));
    const manager = createRenderStreamingBatchTransactionManager({
      evict: () => 1,
      upload,
    });
    manager.transact(transactionRequest(1), () => undefined);
    manager.dispose();
    manager.dispose();

    expect(() => manager.transact(transactionRequest(1), () => undefined)).toThrow(/disposed/);
    expect(upload).toHaveBeenCalledOnce();
  });
});
