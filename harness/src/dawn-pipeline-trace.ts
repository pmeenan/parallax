import type { ChromeTraceEvent } from "./presentation-trace.js";

export const DAWN_TRACE_CATEGORY = "disabled-by-default-gpu.dawn";
export const D3D12_HISTOGRAM_PREFIX = "GPU.WebGPU.D3D12.";

const SYNC_PIPELINE_EVENTS = new Set([
  "DeviceBase::APICreateComputePipeline",
  "DeviceBase::APICreateRenderPipeline",
]);
const ASYNC_PIPELINE_INITIALIZATION_EVENT = "CreatePipelineAsyncEvent::InitializeImpl";
const D3D12_SHADER_REQUEST_EVENT = "ShaderModuleD3D12::Compile";
const D3D12_SHADER_COMPILER_EVENTS = new Set(["CompileShaderDXC", "CompileShaderFXC"]);

export interface DawnHistogram {
  readonly count: number;
  readonly name: string;
  readonly sum: number;
}

export type DawnProbeResult<T> =
  | Readonly<{ readonly state: "measured"; readonly value: T }>
  | Readonly<{ readonly reason: string; readonly state: "invalid" }>;

export type DawnMetricResult<T> =
  | DawnProbeResult<T>
  | Readonly<{ readonly reason: string; readonly state: "unsupported" }>;

export interface DawnCacheBreakdown {
  readonly hitCount: number;
  readonly hitDurationUs: number;
  readonly hitRate: number;
  readonly missCount: number;
  readonly missDurationUs: number;
}

export type DawnCachePath =
  | Readonly<{ readonly state: "measured"; readonly value: DawnCacheBreakdown }>
  | Readonly<{ readonly reason: string; readonly state: "not-applicable" }>;

export interface DawnPipelineEvidence {
  readonly backend: "D3D12";
  readonly pipelineCache: {
    readonly compute: DawnCachePath;
    readonly render: DawnCachePath;
  };
  readonly pipelineActivity: {
    readonly asyncInitializationCount: number;
    readonly count: number;
    readonly maxDurationMs: number;
    readonly overlappingMeasurement: number;
    readonly syncComputeCount: number;
    readonly syncRenderCount: number;
    readonly totalDurationMs: number;
  };
  readonly shaderCache: DawnCacheBreakdown & {
    readonly missesOverlappingMeasurement: number;
    readonly requestCount: number;
  };
}

export function resolveD3D12DawnPipelineEvidence(
  traceEvents: DawnProbeResult<readonly ChromeTraceEvent[]>,
  dawnBackend: string | null,
  histogramsBeforeTraceEnd: DawnProbeResult<readonly DawnHistogram[]> | null,
  histogramsAfterTraceEnd: DawnProbeResult<readonly DawnHistogram[]> | null,
): DawnMetricResult<DawnPipelineEvidence> {
  if (dawnBackend?.toLowerCase() !== "d3d12") {
    return Object.freeze({
      reason: `Dawn shader-cache trace semantics are not implemented for backend ${dawnBackend ?? "unknown"}`,
      state: "unsupported",
    });
  }
  if (traceEvents.state === "invalid") return traceEvents;
  if (histogramsBeforeTraceEnd === null || histogramsAfterTraceEnd === null) {
    return Object.freeze({
      reason: "Dawn histogram boundary snapshots are missing",
      state: "invalid",
    });
  }
  if (histogramsBeforeTraceEnd.state === "invalid") return histogramsBeforeTraceEnd;
  if (histogramsAfterTraceEnd.state === "invalid") return histogramsAfterTraceEnd;
  if (
    JSON.stringify(histogramsBeforeTraceEnd.value) !== JSON.stringify(histogramsAfterTraceEnd.value)
  ) {
    return Object.freeze({
      reason: "Dawn cache histograms changed across the trace completion boundary",
      state: "invalid",
    });
  }
  try {
    return Object.freeze({
      state: "measured",
      value: extractD3D12DawnPipelineEvidence(traceEvents.value, histogramsAfterTraceEnd.value),
    });
  } catch (error) {
    return Object.freeze({
      reason: `Dawn pipeline trace probe failed: ${errorMessage(error)}`,
      state: "invalid",
    });
  }
}

export function extractD3D12DawnPipelineEvidence(
  events: readonly ChromeTraceEvent[],
  histograms: readonly DawnHistogram[],
): DawnPipelineEvidence {
  const start = uniqueMarker(events, "parallax-presentation-window-start");
  const end = uniqueMarker(events, "parallax-presentation-window-end");
  if (end.ts <= start.ts) throw new Error("Dawn measurement-window markers are out of order");

  const gpuProcessId = uniqueGpuProcessId(events);
  const dawnEvents = events.filter(
    (event) =>
      event.cat === DAWN_TRACE_CATEGORY &&
      event.ph === "X" &&
      event.pid === gpuProcessId &&
      validDuration(event),
  );
  const syncPipelines = dawnEvents.filter((event) => SYNC_PIPELINE_EVENTS.has(event.name));
  const asyncPipelineMisses = dawnEvents.filter(
    (event) => event.name === ASYNC_PIPELINE_INITIALIZATION_EVENT,
  );
  const syncRenderCount = syncPipelines.filter(
    (event) => event.name === "DeviceBase::APICreateRenderPipeline",
  ).length;
  const syncComputeCount = syncPipelines.filter(
    (event) => event.name === "DeviceBase::APICreateComputePipeline",
  ).length;
  const pipelineActivity = [...syncPipelines, ...asyncPipelineMisses];
  const shaderRequests = dawnEvents.filter((event) => event.name === D3D12_SHADER_REQUEST_EVENT);
  const shaderMisses = dawnEvents.filter((event) => D3D12_SHADER_COMPILER_EVENTS.has(event.name));

  if (pipelineActivity.length === 0) {
    throw new Error("Dawn trace did not exercise pipeline creation activity");
  }
  if (shaderRequests.length === 0) {
    throw new Error("Dawn trace did not exercise D3D12 shader-cache requests");
  }

  const shaderCache = cacheBreakdown(histograms, "CompileShader");
  if (shaderCache === undefined) {
    throw new Error("Dawn subprocess histograms did not expose CompileShader cache evidence");
  }
  const renderPipelineCache = cacheBreakdown(histograms, "CreateGraphicsPipelineState");
  const computePipelineCache = cacheBreakdown(histograms, "CreateComputePipelineState");
  const shaderOperationCount = shaderCache.hitCount + shaderCache.missCount;
  if (shaderOperationCount !== shaderRequests.length) {
    throw new Error(
      `Dawn shader-cache histograms reported ${shaderOperationCount} operations for ${shaderRequests.length} traced requests`,
    );
  }
  if (shaderCache.missCount !== shaderMisses.length) {
    throw new Error(
      `Dawn shader-cache histogram reported ${shaderCache.missCount} misses but the trace contained ${shaderMisses.length} compiler events`,
    );
  }
  const pipelineCacheOperationCount =
    cacheOperationCount(renderPipelineCache) + cacheOperationCount(computePipelineCache);
  if (pipelineCacheOperationCount > pipelineActivity.length) {
    throw new Error(
      `Dawn pipeline-cache histograms reported ${pipelineCacheOperationCount} operations for only ${pipelineActivity.length} traced sync requests and async initializations`,
    );
  }
  if (pipelineCacheOperationCount < asyncPipelineMisses.length) {
    throw new Error(
      `Dawn pipeline-cache histograms reported ${pipelineCacheOperationCount} operations for ${asyncPipelineMisses.length} traced async initializations`,
    );
  }
  const renderPipelineCacheOperationCount = cacheOperationCount(renderPipelineCache);
  if (renderPipelineCacheOperationCount > syncRenderCount + asyncPipelineMisses.length) {
    throw new Error(
      `Dawn graphics pipeline-cache histograms reported ${renderPipelineCacheOperationCount} operations for only ${syncRenderCount} traced sync render requests and ${asyncPipelineMisses.length} generic async initializations`,
    );
  }
  const computePipelineCacheOperationCount = cacheOperationCount(computePipelineCache);
  if (computePipelineCacheOperationCount > syncComputeCount + asyncPipelineMisses.length) {
    throw new Error(
      `Dawn compute pipeline-cache histograms reported ${computePipelineCacheOperationCount} operations for only ${syncComputeCount} traced sync compute requests and ${asyncPipelineMisses.length} generic async initializations`,
    );
  }

  const pipelineDurationsMs = pipelineActivity.map(durationMs);
  return Object.freeze({
    backend: "D3D12",
    pipelineCache: Object.freeze({
      compute: cachePath(computePipelineCache, "compute"),
      render: cachePath(renderPipelineCache, "render"),
    }),
    pipelineActivity: Object.freeze({
      asyncInitializationCount: asyncPipelineMisses.length,
      count: pipelineActivity.length,
      maxDurationMs: Math.max(...pipelineDurationsMs),
      overlappingMeasurement: pipelineActivity.filter((event) => overlaps(event, start.ts, end.ts))
        .length,
      syncComputeCount,
      syncRenderCount,
      totalDurationMs: pipelineDurationsMs.reduce((total, value) => total + value, 0),
    }),
    shaderCache: Object.freeze({
      ...shaderCache,
      missesOverlappingMeasurement: shaderMisses.filter((event) =>
        overlaps(event, start.ts, end.ts),
      ).length,
      requestCount: shaderRequests.length,
    }),
  });
}

function cacheBreakdown(
  histograms: readonly DawnHistogram[],
  operation: string,
): DawnCacheBreakdown | undefined {
  const hit = uniqueHistogram(histograms, `${D3D12_HISTOGRAM_PREFIX}${operation}.CacheHit`);
  const miss = uniqueHistogram(histograms, `${D3D12_HISTOGRAM_PREFIX}${operation}.CacheMiss`);
  if (hit === undefined && miss === undefined) return undefined;
  const hitCount = hit?.count ?? 0;
  const missCount = miss?.count ?? 0;
  const total = hitCount + missCount;
  return Object.freeze({
    hitCount,
    hitDurationUs: hit?.sum ?? 0,
    hitRate: total === 0 ? 0 : hitCount / total,
    missCount,
    missDurationUs: miss?.sum ?? 0,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cacheOperationCount(cache: DawnCacheBreakdown | undefined): number {
  return cache === undefined ? 0 : cache.hitCount + cache.missCount;
}

function cachePath(cache: DawnCacheBreakdown | undefined, kind: string): DawnCachePath {
  return cache === undefined
    ? Object.freeze({
        reason: `No backend D3D12 ${kind} PSO cache operation occurred in this scenario run`,
        state: "not-applicable",
      })
    : Object.freeze({ state: "measured", value: cache });
}

function uniqueHistogram(
  histograms: readonly DawnHistogram[],
  name: string,
): DawnHistogram | undefined {
  const matches = histograms.filter((histogram) => histogram.name === name);
  if (matches.length > 1) throw new Error(`Expected at most one ${name} histogram`);
  const histogram = matches[0];
  if (
    histogram !== undefined &&
    (!Number.isInteger(histogram.count) || histogram.count < 0 || !Number.isFinite(histogram.sum))
  ) {
    throw new Error(`${name} histogram has invalid count or sum`);
  }
  return histogram;
}

function uniqueMarker(events: readonly ChromeTraceEvent[], name: string): ChromeTraceEvent {
  const matches = events.filter((event) => event.name === name && event.ph === "I");
  if (matches.length !== 1) {
    throw new Error(`Expected one ${name} trace marker; received ${matches.length}`);
  }
  const marker = matches[0];
  if (marker === undefined || !Number.isFinite(marker.ts)) {
    throw new Error(`${name} trace marker has an invalid timestamp`);
  }
  return marker;
}

function uniqueGpuProcessId(events: readonly ChromeTraceEvent[]): number {
  const processIds = new Set(
    events
      .filter(
        (event) =>
          event.name === "process_name" && event.ph === "M" && event.args?.name === "GPU Process",
      )
      .map((event) => event.pid),
  );
  if (processIds.size !== 1) {
    throw new Error(`Expected one traced GPU process; received ${processIds.size}`);
  }
  const processId = processIds.values().next().value;
  if (processId === undefined) throw new Error("Traced GPU process ID is missing");
  return processId;
}

function validDuration(event: ChromeTraceEvent): boolean {
  return event.dur !== undefined && Number.isFinite(event.dur) && event.dur >= 0;
}

function durationMs(event: ChromeTraceEvent): number {
  if (!validDuration(event)) throw new Error(`${event.name} trace event has an invalid duration`);
  return (event.dur ?? 0) / 1_000;
}

function overlaps(event: ChromeTraceEvent, start: number, end: number): boolean {
  const duration = event.dur ?? 0;
  return event.ts < end && event.ts + duration > start;
}
