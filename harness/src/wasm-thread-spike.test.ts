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
  state: "completed",
  taskCount: 262_144,
  workerCount: 2,
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
    expect(
      resolveWasmThreadSpikeMetric({
        ...complete,
        completedTasks: 0,
        failureMessage: "WASM thread spike exceeded 10000 ms",
        parallelExecutionElapsedMs: null,
        processedTasksByWorker: Object.freeze([0, 0]),
        state: "failed",
        workerInitializationElapsedMs: null,
        workerMask: 0,
      }),
    ).toMatchObject({
      reason: expect.stringContaining("phase=worker-initialization"),
      state: "invalid",
    });
  });
});
