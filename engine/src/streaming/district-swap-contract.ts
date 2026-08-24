import {
  STREAMING_DISTRICT_SWAP_LOGICAL_GPU_OVERLAP_RATIO,
  STREAMING_DISTRICT_SWAP_MAX_HITCH_BUDGET_MS,
  STREAMING_DISTRICT_SWAP_TOTAL_BUDGET_MS,
  STREAMING_RESIDENT_CELL_LIMIT,
  type StreamingDistrictSwapTelemetry,
} from "./streaming-protocol";

export interface StreamingDistrictSwapPrefetchContract {
  readonly prefetchTriggerDistanceMeters: number;
  readonly traversalSpeedMetersPerSecond: number;
}

export interface StreamingDistrictSwapVerdict {
  readonly exclusiveResidentSets: boolean;
  readonly logicalGpuOverlapRatio: number;
  readonly logicalGpuOverlapWithinBudget: boolean;
  readonly maxHitchWithinBudget: boolean;
  readonly prefetchLeadTimeMs: number;
  readonly prefetchWithinBudget: boolean;
  readonly proactiveOnly: boolean;
  readonly renderEvidenceAvailable: boolean;
  readonly passed: boolean;
  readonly totalWithinBudget: boolean;
}

export function evaluateStreamingDistrictSwap(
  sample: StreamingDistrictSwapTelemetry,
  prefetch: StreamingDistrictSwapPrefetchContract | null,
): StreamingDistrictSwapVerdict {
  const steadyLogicalGpuBytes = Math.max(
    sample.sourceLogicalGpuBytes,
    sample.destinationLogicalGpuBytes,
  );
  const logicalGpuOverlapRatio = sample.logicalGpuBytesHighWater / steadyLogicalGpuBytes;
  const exclusiveResidentSets =
    exactResidentSet(sample.sourceResidentCellIds) &&
    exactResidentSet(sample.destinationResidentCellIds) &&
    sample.destinationResidentCellIds.every(
      (cellId) => !sample.sourceResidentCellIds.includes(cellId),
    );
  const logicalGpuOverlapWithinBudget =
    Number.isFinite(logicalGpuOverlapRatio) &&
    logicalGpuOverlapRatio <= STREAMING_DISTRICT_SWAP_LOGICAL_GPU_OVERLAP_RATIO;
  const maxHitchWithinBudget =
    Number.isFinite(sample.maxHitchMs) &&
    sample.maxHitchMs <= STREAMING_DISTRICT_SWAP_MAX_HITCH_BUDGET_MS;
  const prefetchLeadTimeMs =
    prefetch === null ||
    !Number.isFinite(prefetch.prefetchTriggerDistanceMeters) ||
    prefetch.prefetchTriggerDistanceMeters <= 0 ||
    !Number.isFinite(prefetch.traversalSpeedMetersPerSecond) ||
    prefetch.traversalSpeedMetersPerSecond <= 0
      ? Number.NaN
      : (prefetch.prefetchTriggerDistanceMeters / prefetch.traversalSpeedMetersPerSecond) * 1_000;
  const prefetchWithinBudget =
    Number.isFinite(prefetchLeadTimeMs) &&
    Number.isFinite(sample.totalMs) &&
    sample.totalMs <= prefetchLeadTimeMs;
  const proactiveOnly = sample.proactiveEvictionCount === STREAMING_RESIDENT_CELL_LIMIT;
  const renderEvidenceAvailable =
    Number.isSafeInteger(sample.renderFrameCount) && sample.renderFrameCount > 0;
  const totalWithinBudget =
    Number.isFinite(sample.totalMs) && sample.totalMs <= STREAMING_DISTRICT_SWAP_TOTAL_BUDGET_MS;
  return Object.freeze({
    exclusiveResidentSets,
    logicalGpuOverlapRatio,
    logicalGpuOverlapWithinBudget,
    maxHitchWithinBudget,
    prefetchLeadTimeMs,
    prefetchWithinBudget,
    proactiveOnly,
    passed:
      exclusiveResidentSets &&
      logicalGpuOverlapWithinBudget &&
      maxHitchWithinBudget &&
      prefetchWithinBudget &&
      proactiveOnly &&
      renderEvidenceAvailable &&
      totalWithinBudget,
    renderEvidenceAvailable,
    totalWithinBudget,
  });
}

function exactResidentSet(cellIds: readonly string[]): boolean {
  return (
    cellIds.length === STREAMING_RESIDENT_CELL_LIMIT &&
    new Set(cellIds).size === STREAMING_RESIDENT_CELL_LIMIT &&
    cellIds.every((cellId) => cellId.length > 0)
  );
}
