import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function workerSource(): Promise<string> {
  return readFile(new URL("../src/workers/streaming-worker.ts", import.meta.url), "utf8");
}

async function batchSource(): Promise<string> {
  return readFile(
    new URL("../src/streaming/streaming-batch-cache-transaction.ts", import.meta.url),
    "utf8",
  );
}

describe("streaming worker batch transaction wiring", () => {
  it("routes fetched build manifests through the shared strict validator", async () => {
    const source = await workerSource();
    expect(source).toContain("validateStreamingBuildManifest(await manifestResponse.json())");
  });

  it("publishes residency, accounting, and samples only after the sole response", async () => {
    const worker = await workerSource();
    const source = await batchSource();
    expect(worker).toContain("await executeStreamingBatchCacheTransaction({");
    const responseAwait = source.indexOf("const transactionResponse = await transactionPromise");
    const validation = source.indexOf(
      'transactionResponse.kind !== "render-batch-transaction-complete"',
      responseAwait,
    );
    const residency = source.indexOf("options.commitResident(cell, member)", validation);
    const afterCommit = source.indexOf("await options.afterCommit(result)", residency);
    expect(responseAwait).toBeGreaterThanOrEqual(0);
    expect(validation).toBeGreaterThan(responseAwait);
    expect(residency).toBeGreaterThan(validation);
    expect(afterCommit).toBeGreaterThan(residency);
  });

  it("records launch hydration before the initial schedule while leaving measurement filtering to consumers", async () => {
    const source = await workerSource();
    const ready = source.indexOf("ready = true;");
    const recording = source.indexOf("recordCellLoadSamples = true;", ready);
    const initialSchedule = source.indexOf("await runSchedule();", ready);
    expect(ready).toBeGreaterThanOrEqual(0);
    expect(recording).toBeGreaterThan(ready);
    expect(initialSchedule).toBeGreaterThan(recording);
    expect(source.match(/recordCellLoadSamples = true;/g)).toHaveLength(1);
  });

  it("uses exactly one render request for each authoritative scheduler load batch", async () => {
    const worker = await workerSource();
    const source = await batchSource();
    expect(source.match(/const transactionPromise = options.requestRender\(/g)).toHaveLength(1);
    expect(source).toContain('kind: "render-batch-transaction"');
    expect(worker).toContain("await loadBatch(schedule.load, batch)");
    expect(worker).not.toContain('"stream-batch"');
    expect(worker).not.toContain('"commit-batch"');
    expect(worker).not.toContain("uploadRequestId");
  });

  it("transfers decoded dependency buffers across both worker boundaries", async () => {
    const streaming = await workerSource();
    const decode = await readFile(
      new URL("../src/workers/decode-worker.ts", import.meta.url),
      "utf8",
    );
    expect(streaming).toContain("[task.bytes, ...task.dependencies.map");
    expect(streaming).toContain('"kind" in dependency');
    expect(streaming).toContain("...new Set(");
    expect(decode).toContain("dependencies.map((dependency)");
    for (const source of [streaming, decode]) {
      expect(source).toContain('dependency.format === "ktx2"');
      expect(source).toContain("? dependency.rgba");
      expect(source).toContain('dependency.kind !== "legacy-positions"');
      expect(source).toContain('dependency.kind === "indices"');
      expect(source).toContain("? dependency.indices");
      expect(source).toContain(": dependency.attributes");
      expect(source).toContain(": dependency.positions");
    }
  });

  it("validates exact decode response accounting before resolving the task", async () => {
    const source = await workerSource();
    const validation = source.indexOf("validateDecodedCellResponseAccounting(");
    const resolve = source.indexOf("task.resolve(response)", validation);
    const telemetry = source.indexOf("dependencyDecodedBytes:", resolve);
    expect(validation).toBeGreaterThanOrEqual(0);
    expect(resolve).toBeGreaterThan(validation);
    expect(telemetry).toBeGreaterThan(resolve);
  });

  it("decodes only cache misses and releases each resident cell reference on eviction", async () => {
    const worker = await workerSource();
    const source = await batchSource();
    expect(source).toContain("if (acquired.miss)");
    expect(source).toContain("misses.push(descriptor)");
    expect(source).toContain("options.prepareCell(entry, misses, descriptors, keys)");
    expect(source).toContain("options.dependencyCache.fulfill(dependency.cacheKey, dependency)");
    const evict = worker.indexOf("const evictCell = async");
    const projection = worker.indexOf("projectStreamingCacheReleases(", evict);
    const correlation = worker.indexOf("compatibleStreamingCacheSnapshots(", projection);
    const exactFreedBytes = worker.indexOf(
      "requireExactStreamingEvictionFreedGpuBytes(",
      correlation,
    );
    const release = worker.indexOf("dependencyCache.release(key)", evict);
    const residencyDelete = worker.indexOf("residents.delete(entry.cellId)", release);
    expect(projection).toBeGreaterThan(evict);
    expect(correlation).toBeGreaterThan(projection);
    expect(exactFreedBytes).toBeGreaterThan(correlation);
    expect(release).toBeGreaterThan(exactFreedBytes);
    expect(residencyDelete).toBeGreaterThan(release);
  });

  it("reserves residency and staging before reads and releases both on every outcome", async () => {
    const source = await workerSource();
    const transaction = await batchSource();
    const reserve = source.indexOf("const reservation = encodedBatchBudget.reserve");
    const stagingReserve = source.indexOf(
      "const stagingReservation = stagingBatchBudget.reserve",
      reserve,
    );
    const execute = source.indexOf("await executeStreamingBatchCacheTransaction", stagingReserve);
    const stagingRelease = source.indexOf("stagingReservation.release()", execute);
    const release = source.indexOf("reservation.release()", stagingRelease);
    expect(reserve).toBeGreaterThanOrEqual(0);
    expect(source.indexOf("reservation.projectedBytes", reserve)).toBeLessThan(stagingReserve);
    expect(stagingReserve).toBeGreaterThan(reserve);
    expect(execute).toBeGreaterThan(stagingReserve);
    expect(release).toBeGreaterThan(execute);
    expect(transaction).toContain("const decodedCells = await Promise.all");
    expect(transaction).toContain('kind: "render-batch-transaction"');
    expect(transaction).toContain(
      'transactionResponse.kind !== "render-batch-transaction-complete"',
    );
    const requestHelper = source.indexOf("const requestRender =");
    const requestTimeout = source.indexOf("const timeout = setTimeout", requestHelper);
    const timeoutReject = source.indexOf("reject(", requestTimeout);
    expect(requestHelper).toBeGreaterThanOrEqual(0);
    expect(requestTimeout).toBeGreaterThan(requestHelper);
    expect(timeoutReject).toBeGreaterThan(requestTimeout);
    expect(stagingRelease).toBeGreaterThan(execute);
    expect(source.slice(stagingReserve, release)).toContain("try {");
    expect(source.slice(execute, release)).toContain("finally {");
  });

  it("retains the 5 second streaming-side request timeout without render pending state", async () => {
    const streaming = await workerSource();
    const renderManager = await readFile(
      new URL("../src/render/render-streaming-batch.ts", import.meta.url),
      "utf8",
    );
    expect(streaming).toContain("const RENDER_REQUEST_TIMEOUT_MS = 5_000");
    expect(renderManager).not.toContain("setTimeout");
    expect(renderManager).not.toContain("PendingRenderBatch");
    expect(renderManager).not.toContain("pendingByUploadRequest");
    expect(renderManager).not.toContain("commit(");
  });

  it("lets a transaction failure win over disposal and reach app render teardown", async () => {
    const streaming = await workerSource();
    const app = await readFile(new URL("../../app/src/runtime.ts", import.meta.url), "utf8");
    const failStart = streaming.indexOf("const fail =");
    const failLatch = streaming.indexOf("if (!lifecycle.tryFail()) return", failStart);
    const disposeStart = streaming.indexOf('if (request.kind === "dispose")');
    const beginDisposal = streaming.indexOf("lifecycle.beginDisposal()", disposeStart);
    const drain = streaming.indexOf("while (scheduling", beginDisposal);
    const failedExit = streaming.indexOf('if (lifecycle.state === "failed") return', drain);
    const finishDisposal = streaming.indexOf("lifecycle.finishDisposal()", failedExit);
    const disposedResponse = streaming.indexOf('kind: "disposed"', finishDisposal);
    expect(failLatch).toBeGreaterThan(failStart);
    expect(beginDisposal).toBeGreaterThan(disposeStart);
    expect(drain).toBeGreaterThan(beginDisposal);
    expect(failedExit).toBeGreaterThan(drain);
    expect(finishDisposal).toBeGreaterThan(failedExit);
    expect(disposedResponse).toBeGreaterThan(finishDisposal);
    expect(app).toContain('if (streaming.state === "failed")');
    expect(app).toContain("renderService.failAfterStreamingFailure(");
  });
});
