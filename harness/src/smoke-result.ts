import type { BudgetCheck } from "./budgets.js";
import type { EnvironmentGateState } from "./environment.js";
import type {
  BinaryResultFacet,
  BudgetEvaluationFacet,
  EnvironmentFacetInput,
  FacetCheck,
  FacetEvidenceCheck,
  MetricState,
  ResultFacets,
} from "./result-facets.js";

interface EvidenceState {
  readonly reason?: string;
  readonly state: MetricState;
}

interface BudgetRun {
  readonly budgetChecks: readonly BudgetCheck[];
  readonly profile: string;
  readonly repeat: number;
}

export interface SmokeBudgetInput {
  readonly runs: readonly BudgetRun[];
  readonly v8CodeCacheDiagnostics: readonly BudgetRun[];
}

export interface SmokeEvidenceInput {
  readonly callbackPacingVariance: readonly (EvidenceState & { readonly profile: string })[];
  readonly incompleteMetrics: readonly (EvidenceState & {
    readonly mandatoryForHarnessV1: boolean;
    readonly metric: string;
  })[];
  readonly runs: readonly {
    readonly dawnPipeline: EvidenceState;
    readonly jsHeap: EvidenceState;
    readonly profile: string;
    readonly repeat: number;
  }[];
  readonly v8CodeCacheDiagnostics: readonly {
    readonly production: EvidenceState;
    readonly profile: string;
    readonly repeat: number;
    readonly v8CodeCache: EvidenceState;
  }[];
  readonly vizPresentationFeedbackCallbackVariance: readonly (EvidenceState & {
    readonly profile: string;
  })[];
}

export function collectSmokeBudgetFacetChecks(input: SmokeBudgetInput): readonly FacetCheck[] {
  return Object.freeze([
    ...input.runs.flatMap((run) => budgetFacetChecks(run, "")),
    ...input.v8CodeCacheDiagnostics.flatMap((run) => budgetFacetChecks(run, "V8 diagnostic ")),
  ]);
}

export function collectSmokeEnvironmentFacetInput(
  gateIdentity: EnvironmentGateState,
): EnvironmentFacetInput {
  if (gateIdentity.state === "measured") {
    return Object.freeze({ failures: Object.freeze([]), measured: true });
  }
  return Object.freeze({
    failures: Object.freeze(
      gateIdentity.reasons.map(
        (reason) => `verified gate environment identity: invalid (${reason})`,
      ),
    ),
    measured: false,
  });
}

export function collectSmokeEvidenceChecks(
  input: SmokeEvidenceInput,
): readonly FacetEvidenceCheck[] {
  return Object.freeze([
    ...input.v8CodeCacheDiagnostics.flatMap((run) => [
      evidenceCheck(
        `V8 diagnostic ${run.profile} repeat ${run.repeat}: code-cache production ${run.production.state} (${evidenceReason(run.production)})`,
        true,
        run.production,
      ),
      evidenceCheck(
        `V8 diagnostic ${run.profile} repeat ${run.repeat}: V8 code-cache evidence ${run.v8CodeCache.state} (${evidenceReason(run.v8CodeCache)})`,
        true,
        run.v8CodeCache,
      ),
    ]),
    ...input.incompleteMetrics.map((metric) =>
      evidenceCheck(
        `${metric.metric}: ${metric.state} (${evidenceReason(metric)})`,
        metric.mandatoryForHarnessV1,
        metric,
      ),
    ),
    ...input.callbackPacingVariance.map((metric) =>
      evidenceCheck(
        `${metric.profile} callback pacing variance: ${evidenceReason(metric)}`,
        true,
        metric,
      ),
    ),
    ...input.vizPresentationFeedbackCallbackVariance.map((metric) =>
      evidenceCheck(
        `${metric.profile} presentation-feedback variance: ${evidenceReason(metric)}`,
        false,
        metric,
      ),
    ),
    ...input.runs.map((run) =>
      evidenceCheck(
        `${run.profile} repeat ${run.repeat}: Dawn pipeline compile/cache evidence ${run.dawnPipeline.state} (${evidenceReason(run.dawnPipeline)})`,
        true,
        run.dawnPipeline,
      ),
    ),
    ...input.runs.map((run) =>
      evidenceCheck(
        `${run.profile} repeat ${run.repeat}: all-worker JS heap ${run.jsHeap.state} (${evidenceReason(run.jsHeap)})`,
        true,
        run.jsHeap,
      ),
    ),
  ]);
}

export function formatSmokeFacetSummary(facets: ResultFacets): readonly string[] {
  const checkLabel = facets.budgetEvaluation.evaluatedChecks === 1 ? "check" : "checks";
  const failedCheckLabel = facets.budgetEvaluation.reasons.length === 1 ? "check" : "checks";
  const budgetReason =
    facets.budgetEvaluation.status === "not-evaluated"
      ? `; verdict withheld: ${facets.budgetEvaluation.reasons.join(" | ")}`
      : facets.budgetEvaluation.status === "failed"
        ? `; ${facets.budgetEvaluation.reasons.length} ${failedCheckLabel} failed (see Failures below)`
        : "";
  return Object.freeze([
    `- Environment: **${formatFacetStatus(facets.environment.status)}**`,
    `- Evidence completeness: **${formatFacetStatus(facets.evidenceCompleteness.status)}**`,
    `- Budget evaluation: **${formatFacetStatus(facets.budgetEvaluation.status)}** — ${facets.budgetEvaluation.evaluatedChecks} ${checkLabel} executed${budgetReason}`,
  ]);
}

function budgetFacetChecks(run: BudgetRun, prefix: string): readonly FacetCheck[] {
  return run.budgetChecks.map((check) =>
    Object.freeze({
      description: `${prefix}${run.profile} repeat ${run.repeat}: ${check.metric} ${check.actual} > ${check.limit}`,
      passed: check.passed,
    }),
  );
}

function evidenceCheck(
  description: string,
  mandatory: boolean,
  evidence: EvidenceState,
): FacetEvidenceCheck {
  return Object.freeze({ description, mandatory, measured: evidence.state === "measured" });
}

function evidenceReason(evidence: EvidenceState): string {
  return evidence.reason ?? (evidence.state === "measured" ? "measured" : "unknown failure");
}

function formatFacetStatus(
  status: BinaryResultFacet["status"] | BudgetEvaluationFacet["status"],
): string {
  return status.replaceAll("-", " ").toUpperCase();
}
