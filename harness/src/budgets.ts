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

function check(metric: string, actual: number, limit: number): BudgetCheck {
  return Object.freeze({ actual, limit, metric, passed: actual <= limit });
}
