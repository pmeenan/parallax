import { describe, expect, it } from "vitest";
import {
  D3D12_HISTOGRAM_PREFIX,
  DAWN_TRACE_CATEGORY,
  type DawnHistogram,
  extractD3D12DawnPipelineEvidence,
  resolveD3D12DawnPipelineEvidence,
} from "./dawn-pipeline-trace.js";
import type { ChromeTraceEvent } from "./presentation-trace.js";

describe("Dawn pipeline trace extraction", () => {
  it("cross-checks trace events against exact shader and PSO cache histograms", () => {
    const evidence = extractD3D12DawnPipelineEvidence(
      [
        event("process_name", 1, 0, 0, "M", undefined, { name: "GPU Process" }),
        event("DeviceBase::APICreateRenderPipeline", 1, 2, 100, "X", 50),
        event("ShaderModuleD3D12::Compile", 1, 2, 110, "X", 20),
        event("CompileShaderDXC", 1, 2, 115, "X", 10),
        event("ShaderModuleD3D12::Compile", 1, 2, 140, "X", 5),
        marker("parallax-presentation-window-start", 2_000),
        marker("parallax-presentation-window-end", 3_000),
      ],
      [
        histogram("CompileShader.CacheHit", 1, 2),
        histogram("CompileShader.CacheMiss", 1, 10),
        histogram("CreateGraphicsPipelineState.CacheHit", 1, 3),
      ],
    );

    expect(evidence.pipelineActivity).toMatchObject({
      count: 1,
      maxDurationMs: 0.05,
      overlappingMeasurement: 0,
      syncRenderCount: 1,
      totalDurationMs: 0.05,
    });
    expect(evidence.shaderCache).toMatchObject({
      hitCount: 1,
      hitDurationUs: 2,
      hitRate: 0.5,
      missCount: 1,
      missDurationUs: 10,
      missesOverlappingMeasurement: 0,
      requestCount: 2,
    });
    expect(evidence.pipelineCache.render).toMatchObject({
      state: "measured",
      value: { hitCount: 1, missCount: 0 },
    });
    expect(evidence.pipelineCache.compute).toMatchObject({ state: "not-applicable" });
  });

  it("conservatively counts sync and async pipeline work crossing the measurement boundary", () => {
    const evidence = extractD3D12DawnPipelineEvidence(
      [
        event("process_name", 1, 0, 0, "M", undefined, { name: "GPU Process" }),
        event("DeviceBase::APICreateRenderPipeline", 1, 2, 1_900, "X", 200),
        event("CreatePipelineAsyncEvent::InitializeImpl", 1, 3, 2_200, "X", 100),
        event("ShaderModuleD3D12::Compile", 1, 2, 2_100, "X", 20),
        event("CompileShaderFXC", 1, 2, 2_105, "X", 10),
        marker("parallax-presentation-window-start", 2_000),
        marker("parallax-presentation-window-end", 3_000),
      ],
      [
        histogram("CompileShader.CacheMiss", 1, 10),
        histogram("CreateGraphicsPipelineState.CacheHit", 1, 3),
        histogram("CreateGraphicsPipelineState.CacheMiss", 1, 5),
      ],
    );

    expect(evidence.pipelineActivity.overlappingMeasurement).toBe(2);
    expect(evidence.pipelineActivity.asyncInitializationCount).toBe(1);
    expect(evidence.shaderCache.missesOverlappingMeasurement).toBe(1);
  });

  it("rejects traces or histograms that cannot demonstrate the exercised cache path", () => {
    const base = [
      event("process_name", 1, 0, 0, "M", undefined, { name: "GPU Process" }),
      marker("parallax-presentation-window-start", 2_000),
      marker("parallax-presentation-window-end", 3_000),
    ];
    expect(() => extractD3D12DawnPipelineEvidence(base, [])).toThrow("pipeline creation activity");
    expect(() =>
      extractD3D12DawnPipelineEvidence(
        [...base, event("DeviceBase::APICreateRenderPipeline", 1, 2, 100, "X", 50)],
        [histogram("CreateGraphicsPipelineState.CacheMiss", 1, 5)],
      ),
    ).toThrow("shader-cache requests");
  });

  it("rejects disagreement between trace events and subprocess histogram counts", () => {
    expect(() =>
      extractD3D12DawnPipelineEvidence(
        [
          event("process_name", 1, 0, 0, "M", undefined, { name: "GPU Process" }),
          event("DeviceBase::APICreateRenderPipeline", 1, 2, 100, "X", 50),
          event("ShaderModuleD3D12::Compile", 1, 2, 110, "X", 20),
          marker("parallax-presentation-window-start", 2_000),
          marker("parallax-presentation-window-end", 3_000),
        ],
        [
          histogram("CompileShader.CacheHit", 2, 2),
          histogram("CreateGraphicsPipelineState.CacheHit", 1, 3),
        ],
      ),
    ).toThrow("2 operations for 1 traced requests");
  });

  it("allows a sync API request satisfied by Dawn's in-device frontend cache", () => {
    const evidence = extractD3D12DawnPipelineEvidence(
      [
        event("process_name", 1, 0, 0, "M", undefined, { name: "GPU Process" }),
        event("DeviceBase::APICreateRenderPipeline", 1, 2, 100, "X", 50),
        event("DeviceBase::APICreateRenderPipeline", 1, 2, 200, "X", 2),
        event("ShaderModuleD3D12::Compile", 1, 2, 110, "X", 20),
        marker("parallax-presentation-window-start", 2_000),
        marker("parallax-presentation-window-end", 3_000),
      ],
      [
        histogram("CompileShader.CacheHit", 1, 2),
        histogram("CreateGraphicsPipelineState.CacheHit", 1, 3),
      ],
    );

    expect(evidence.pipelineActivity.count).toBe(2);
    expect(evidence.pipelineCache.render).toMatchObject({ state: "measured" });
  });

  it("rejects PSO histogram operations outside traced activity bounds", () => {
    const base = [
      event("process_name", 1, 0, 0, "M", undefined, { name: "GPU Process" }),
      event("ShaderModuleD3D12::Compile", 1, 2, 110, "X", 20),
      marker("parallax-presentation-window-start", 2_000),
      marker("parallax-presentation-window-end", 3_000),
    ];
    expect(() =>
      extractD3D12DawnPipelineEvidence(
        [...base, event("DeviceBase::APICreateRenderPipeline", 1, 2, 100, "X", 50)],
        [
          histogram("CompileShader.CacheHit", 1, 2),
          histogram("CreateGraphicsPipelineState.CacheHit", 2, 6),
        ],
      ),
    ).toThrow("2 operations for only 1 traced");
    expect(() =>
      extractD3D12DawnPipelineEvidence(
        [...base, event("CreatePipelineAsyncEvent::InitializeImpl", 1, 2, 100, "X", 50)],
        [histogram("CompileShader.CacheHit", 1, 2)],
      ),
    ).toThrow("0 operations for 1 traced async initializations");
  });

  it("rejects a compute PSO histogram explained only by a render request", () => {
    expect(() =>
      extractD3D12DawnPipelineEvidence(
        [
          event("process_name", 1, 0, 0, "M", undefined, { name: "GPU Process" }),
          event("DeviceBase::APICreateRenderPipeline", 1, 2, 100, "X", 50),
          event("ShaderModuleD3D12::Compile", 1, 2, 110, "X", 20),
          marker("parallax-presentation-window-start", 2_000),
          marker("parallax-presentation-window-end", 3_000),
        ],
        [
          histogram("CompileShader.CacheHit", 1, 2),
          histogram("CreateComputePipelineState.CacheHit", 1, 3),
        ],
      ),
    ).toThrow("compute pipeline-cache histograms reported 1 operations");
  });
});

describe("Dawn pipeline evidence resolution", () => {
  it("invalidates evidence when histograms change across trace completion", () => {
    const result = resolveD3D12DawnPipelineEvidence(
      measured([marker("parallax-presentation-window-start", 2_000)]),
      "d3d12",
      measured([histogram("CompileShader.CacheHit", 1, 2)]),
      measured([histogram("CompileShader.CacheHit", 2, 4)]),
    );

    expect(result).toEqual({
      reason: "Dawn cache histograms changed across the trace completion boundary",
      state: "invalid",
    });
  });

  it("reports unsupported backends explicitly", () => {
    const result = resolveD3D12DawnPipelineEvidence(measured([]), "vulkan", null, null);

    expect(result).toEqual({
      reason: "Dawn shader-cache trace semantics are not implemented for backend vulkan",
      state: "unsupported",
    });
  });

  it("preserves an invalid trace before evaluating histogram failures", () => {
    const invalidTrace = Object.freeze({ reason: "trace failed", state: "invalid" as const });
    const result = resolveD3D12DawnPipelineEvidence(
      invalidTrace,
      "d3d12",
      Object.freeze({ reason: "histogram failed", state: "invalid" as const }),
      null,
    );

    expect(result).toBe(invalidTrace);
  });
});

function histogram(suffix: string, count: number, sum: number): DawnHistogram {
  return { count, name: `${D3D12_HISTOGRAM_PREFIX}${suffix}`, sum };
}

function measured<T>(value: T): Readonly<{ state: "measured"; value: T }> {
  return Object.freeze({ state: "measured", value });
}

function marker(name: string, ts: number): ChromeTraceEvent {
  return { name, ph: "I", pid: 9, tid: 9, ts };
}

function event(
  name: string,
  pid: number,
  tid: number,
  ts: number,
  ph: string,
  dur?: number,
  args?: Readonly<Record<string, unknown>>,
): ChromeTraceEvent {
  return {
    ...(args === undefined ? {} : { args }),
    ...(dur === undefined ? {} : { dur }),
    cat: name === "process_name" ? "__metadata" : DAWN_TRACE_CATEGORY,
    name,
    ph,
    pid,
    tid,
    ts,
  };
}
