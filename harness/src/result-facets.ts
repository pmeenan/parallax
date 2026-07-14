export interface FacetCheck {
  readonly description: string;
  readonly passed: boolean;
}

export interface FacetEvidenceCheck {
  readonly description: string;
  readonly mandatory: boolean;
  readonly measured: boolean;
}

export type MetricState = "invalid" | "measured" | "not-applicable" | "unsupported";

export interface EnvironmentFacetInput {
  readonly failures: readonly string[];
  readonly measured: boolean;
}

export interface BinaryResultFacet {
  readonly reasons: readonly string[];
  readonly status: "failed" | "passed";
}

export interface BudgetEvaluationFacet {
  readonly evaluatedChecks: number;
  readonly reasons: readonly string[];
  readonly status: "failed" | "not-evaluated" | "passed";
}

export interface ResultFacets {
  readonly budgetEvaluation: BudgetEvaluationFacet;
  readonly environment: BinaryResultFacet;
  readonly evidenceCompleteness: BinaryResultFacet;
}

export interface ResultFacetInput {
  readonly budgetChecks: readonly FacetCheck[];
  readonly environment: EnvironmentFacetInput;
  readonly evidenceChecks: readonly FacetEvidenceCheck[];
}

export function evaluateResultFacets(input: ResultFacetInput): ResultFacets {
  const environment = environmentFacet(input.environment);
  const evidenceCompleteness = binaryFacet(
    input.evidenceChecks
      .filter((check) => check.mandatory && !check.measured)
      .map((check) => check.description),
  );
  const failedBudgetChecks = input.budgetChecks
    .filter((check) => !check.passed)
    .map((check) => check.description);
  const budgetEvaluation = Object.freeze({
    evaluatedChecks: input.budgetChecks.length,
    reasons: Object.freeze(
      failedBudgetChecks.length > 0
        ? failedBudgetChecks
        : evidenceCompleteness.status === "failed"
          ? [
              "Mandatory metric evidence is incomplete; a complete budget verdict cannot be evaluated",
            ]
          : input.budgetChecks.length === 0
            ? ["No budget checks were evaluated"]
            : [],
    ),
    status:
      failedBudgetChecks.length > 0
        ? ("failed" as const)
        : evidenceCompleteness.status === "failed"
          ? ("not-evaluated" as const)
          : input.budgetChecks.length === 0
            ? ("not-evaluated" as const)
            : ("passed" as const),
  });
  return Object.freeze({ budgetEvaluation, environment, evidenceCompleteness });
}

export function resultFacetsPassed(facets: ResultFacets): boolean {
  return (
    facets.environment.status === "passed" &&
    facets.evidenceCompleteness.status === "passed" &&
    facets.budgetEvaluation.status === "passed"
  );
}

function binaryFacet(failures: readonly string[]): BinaryResultFacet {
  const reasons = Object.freeze([...failures]);
  return Object.freeze({ reasons, status: reasons.length === 0 ? "passed" : "failed" });
}

function environmentFacet(input: EnvironmentFacetInput): BinaryResultFacet {
  if (input.measured) return binaryFacet(input.failures);
  return binaryFacet(
    input.failures.length > 0
      ? input.failures
      : ["Verified gate environment identity is not measured; no reason was supplied"],
  );
}
