export type QualityTier = "showcase" | "standard";

export interface BudgetCheck {
  readonly actual: number;
  readonly limit: number;
  readonly metric: string;
  readonly passed: boolean;
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

export function evaluateV8CodeCacheBudgets(
  rejectedArtifactCount: number,
  aggregateEvidenceMeasured: boolean,
): readonly BudgetCheck[] {
  if (!aggregateEvidenceMeasured && rejectedArtifactCount === 0) return Object.freeze([]);
  return Object.freeze([check("v8CodeCacheRejectedArtifacts", rejectedArtifactCount, 0)]);
}

export function evaluateV8CodeCacheReproductionBudgets(
  reproducedArtifactCount: number,
  aggregateEvidenceMeasured: boolean,
): readonly BudgetCheck[] {
  if (!aggregateEvidenceMeasured && reproducedArtifactCount === 0) return Object.freeze([]);
  return Object.freeze([check("v8CodeCacheWarmReproducedArtifacts", reproducedArtifactCount, 0)]);
}

function check(metric: string, actual: number, limit: number): BudgetCheck {
  return Object.freeze({ actual, limit, metric, passed: actual <= limit });
}
