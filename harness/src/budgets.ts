export type QualityTier = "showcase" | "standard";

export interface BudgetCheck {
  readonly actual: number;
  readonly limit: number;
  readonly metric: string;
  readonly passed: boolean;
}

export interface DiagnosticCheck {
  readonly actual: number;
  readonly expectedMaximum: number;
  readonly metric: string;
  readonly satisfied: boolean;
}

const JS_HEAP_LIMIT_BYTES: Readonly<Record<QualityTier, number>> = Object.freeze({
  showcase: 4 * 1024 ** 3,
  standard: 2 * 1024 ** 3,
});

export function evaluateJsHeapBudget(
  highWaterUsedSizeBytes: number,
  tier: QualityTier,
): readonly BudgetCheck[] {
  return Object.freeze([
    check("allRealmJsHeapHighWaterBytes", highWaterUsedSizeBytes, JS_HEAP_LIMIT_BYTES[tier]),
  ]);
}

export function evaluateMainThreadBudgets(mainThreadLongTasks: number): readonly BudgetCheck[] {
  return Object.freeze([check("mainThreadLongTasksOver50Ms", mainThreadLongTasks, 0)]);
}

export function evaluatePipelineBudgets(
  pipelineCreationActivityOverlappingMeasurement: number,
  shaderCompilationsOverlappingMeasurement: number,
): readonly BudgetCheck[] {
  return Object.freeze([
    check(
      "pipelineCreationActivityOverlappingMeasurement",
      pipelineCreationActivityOverlappingMeasurement,
      0,
    ),
    check("shaderCompilationsOverlappingMeasurement", shaderCompilationsOverlappingMeasurement, 0),
  ]);
}

export function evaluateV8CodeCacheDiagnostics(
  rejectedArtifactCount: number,
  aggregateEvidenceMeasured: boolean,
): readonly DiagnosticCheck[] {
  if (!aggregateEvidenceMeasured && rejectedArtifactCount === 0) return Object.freeze([]);
  return Object.freeze([diagnostic("v8CodeCacheRejectedArtifacts", rejectedArtifactCount, 0)]);
}

export function evaluateV8CodeCacheReproductionDiagnostics(
  reproducedArtifactCount: number,
  aggregateEvidenceMeasured: boolean,
): readonly DiagnosticCheck[] {
  if (!aggregateEvidenceMeasured && reproducedArtifactCount === 0) return Object.freeze([]);
  return Object.freeze([
    diagnostic("v8CodeCacheWarmReproducedArtifacts", reproducedArtifactCount, 0),
  ]);
}

function check(metric: string, actual: number, limit: number): BudgetCheck {
  return Object.freeze({ actual, limit, metric, passed: actual <= limit });
}

function diagnostic(metric: string, actual: number, expectedMaximum: number): DiagnosticCheck {
  return Object.freeze({
    actual,
    expectedMaximum,
    metric,
    satisfied: actual <= expectedMaximum,
  });
}
