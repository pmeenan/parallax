import { describe, expect, it } from "vitest";
import {
  extractGpuProcessMemoryDumpEvidence,
  type MemoryDumpRequest,
  resolveGpuMemoryMetric,
} from "./gpu-memory.js";
import type { ChromeTraceEvent } from "./presentation-trace.js";

describe("GPU memory-infra trace probe", () => {
  it("inventories the requested GPU-process allocator dump", () => {
    expect(extractGpuProcessMemoryDumpEvidence(traceEvents())).toEqual({
      allocatorCount: 4,
      allocatorNames: ["gpu", "gpu/shader_cache/webgpu_cache_0x1", "gpu/shared_image", "malloc"],
      exportedDumpId: "0x0",
      exportedDumpName: "periodic_interval",
      gpuProcessId: 9,
      webGpuRelatedAllocatorNames: ["gpu/shader_cache/webgpu_cache_0x1"],
    });
  });

  it("retains the dump inventory while marking attributable resident VRAM unsupported", () => {
    expect(
      resolveGpuMemoryMetric(
        { state: "measured", value: traceEvents() },
        { state: "measured", value: request() },
      ),
    ).toMatchObject({
      diagnostic: {
        provider: "chrome-memory-infra",
        result: { evidence: { allocatorCount: 4 }, state: "measured" },
      },
      reason: expect.stringContaining("no page-attributed resident GPU-memory total"),
      state: "unsupported",
    });
  });

  it("fails closed when Chrome rejects the requested dump", () => {
    const rejected = { dumpGuid: "abc", requestDurationMs: 12, success: false };
    expect(
      resolveGpuMemoryMetric(
        { state: "measured", value: traceEvents() },
        { state: "measured", value: rejected },
      ),
    ).toEqual({
      diagnostic: {
        provider: "chrome-memory-infra",
        result: {
          evidence: null,
          reason: "Chrome rejected global memory dump abc",
          request: rejected,
          state: "invalid",
        },
      },
      reason:
        "Chrome exposes no page-attributed resident GPU-memory total; the GPU envelope cannot be evaluated",
      state: "unsupported",
    });
  });

  it("keeps the envelope unsupported when the diagnostic trace is invalid", () => {
    expect(
      resolveGpuMemoryMetric(
        { reason: "trace completion timed out", state: "invalid" },
        { state: "measured", value: request() },
      ),
    ).toEqual({
      diagnostic: {
        provider: "chrome-memory-infra",
        result: {
          evidence: null,
          reason: "trace completion timed out",
          request: request(),
          state: "invalid",
        },
      },
      reason:
        "Chrome exposes no page-attributed resident GPU-memory total; the GPU envelope cannot be evaluated",
      state: "unsupported",
    });
  });

  it("rejects an allocator dump from a renderer process", () => {
    const events = traceEvents().map((event) =>
      event.id === "0x0" && Reflect.get(event.args?.dumps ?? {}, "allocators") !== undefined
        ? Object.freeze({ ...event, pid: 7 })
        : event,
    );
    expect(() => extractGpuProcessMemoryDumpEvidence(events)).toThrow(
      "Expected one allocator-bearing GPU-process memory dump",
    );
  });

  it("rejects ambiguous GPU-process allocator dumps", () => {
    const allocatorEvent = traceEvents().find(
      (event) => Reflect.get(event.args?.dumps ?? {}, "allocators") !== undefined,
    );
    if (allocatorEvent === undefined) throw new Error("Fixture allocator event disappeared");
    expect(() =>
      extractGpuProcessMemoryDumpEvidence([...traceEvents(), { ...allocatorEvent, ts: 2 }]),
    ).toThrow("received 2");
  });
});

function request(): MemoryDumpRequest {
  return Object.freeze({ dumpGuid: "abc", requestDurationMs: 12, success: true });
}

function traceEvents(): readonly ChromeTraceEvent[] {
  return Object.freeze([
    event({ args: { name: "GPU Process" }, name: "process_name", ph: "M", pid: 9 }),
    event({ args: { name: "Renderer" }, name: "process_name", ph: "M", pid: 7 }),
    event({
      args: { dumps: { level_of_detail: "background", process_totals: {} } },
      id: "0x0",
      name: "periodic_interval",
      ph: "v",
      pid: 9,
      cat: "disabled-by-default-memory-infra",
    }),
    event({
      args: {
        dumps: {
          allocators: {
            gpu: allocator(),
            "gpu/shader_cache/webgpu_cache_0x1": allocator(),
            "gpu/shared_image": allocator(),
            malloc: allocator(),
          },
          level_of_detail: "background",
        },
      },
      id: "0x0",
      name: "periodic_interval",
      ph: "v",
      pid: 9,
      cat: "disabled-by-default-memory-infra",
    }),
  ]);
}

function allocator(): unknown {
  return { guid: "1" };
}

function event(
  overrides: Partial<ChromeTraceEvent> & Pick<ChromeTraceEvent, "name" | "ph" | "pid">,
): ChromeTraceEvent {
  return Object.freeze({ cat: "", tid: 0, ts: 1, ...overrides });
}
