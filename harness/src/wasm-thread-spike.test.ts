import type { WasmThreadSpikeTelemetrySnapshot } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import { resolveWasmThreadSpikeMetric } from "./wasm-thread-spike.js";

const complete: WasmThreadSpikeTelemetrySnapshot = Object.freeze({
  checksum: 0x1234,
  completedTasks: 262_144,
  elapsedMs: 25,
  failureMessage: null,
  memoryBytes: 33 * 65_536,
  moduleBytes: 12_000,
  moduleLoadAndCompileElapsedMs: 8,
  parallelExecutionElapsedMs: 10,
  processedTasksByWorker: Object.freeze([131_072, 131_072]),
  referenceChecksum: 0x1234,
  runtimeStateAfterInitialization: Object.freeze({
    allocatorLock: 0,
    initializedInstanceCount: 2,
    sharedInitializationState: 2,
  }),
  runtimeStateAtFailure: null,
  state: "completed",
  taskCount: 262_144,
  workerCount: 2,
  workerPhases: Object.freeze(["ready", "ready"] as const),
  workerInitializationElapsedMs: 7,
  workerMask: 3,
});

describe("Rust/WASM threads smoke evidence", () => {
  it("accepts exact correctness, participation, memory, and timing evidence", () => {
    expect(resolveWasmThreadSpikeMetric(complete)).toMatchObject({ state: "measured" });
  });

  it("rejects a nominal completion when one worker did no work", () => {
    expect(
      resolveWasmThreadSpikeMetric({
        ...complete,
        processedTasksByWorker: Object.freeze([262_144, 0]),
        workerMask: 1,
      }),
    ).toMatchObject({ state: "invalid" });
  });

  it("retains the terminal phase when a page-owned timeout fires", () => {
    const result = resolveWasmThreadSpikeMetric({
      ...complete,
      completedTasks: 0,
      failureMessage: "WASM thread spike exceeded 10000 ms",
      parallelExecutionElapsedMs: null,
      processedTasksByWorker: Object.freeze([0, 0]),
      runtimeStateAfterInitialization: null,
      runtimeStateAtFailure: Object.freeze({
        allocatorLock: 1,
        initializedInstanceCount: 1,
        sharedInitializationState: 2,
      }),
      state: "failed",
      workerPhases: Object.freeze(["ready", "runtime-startup-started"] as const),
      workerInitializationElapsedMs: null,
      workerMask: 0,
    });
    expect(result).toMatchObject({
      reason: expect.stringContaining("phase=worker-initialization"),
      state: "invalid",
    });
    if (result.state !== "invalid") throw new Error("Expected an invalid timeout metric");
    expect(result.reason).toContain(
      "workerPhases=[ready,runtime-startup-started], runtimeStateAfterInitialization=null, runtimeStateAtFailure={sharedInitializationState=2,initializedInstanceCount=1,allocatorLock=1}",
    );
  });

  it("rejects a nominal completion when the post-initialization allocator lock is not clear", () => {
    expect(
      resolveWasmThreadSpikeMetric({
        ...complete,
        runtimeStateAfterInitialization: Object.freeze({
          allocatorLock: 43,
          initializedInstanceCount: 2,
          sharedInitializationState: 2,
        }),
      }),
    ).toMatchObject({ state: "invalid" });
  });
});
