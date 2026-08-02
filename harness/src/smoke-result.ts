import type { BudgetCheck, DiagnosticCheck } from "./budgets.js";
import type { EnvironmentGateState } from "./environment.js";
import { evaluateHttpServingEvidence } from "./http-evidence.js";
import type {
  BinaryResultFacet,
  BudgetEvaluationFacet,
  EnvironmentFacetInput,
  FacetCheck,
  FacetEvidenceCheck,
  MetricState,
  ResultFacets,
} from "./result-facets.js";
import { SMOKE_METRICS } from "./runs/smoke.js";
import type { LocalServerMetrics } from "./server.js";

// Registry names for every evidence check this module emits. The mandatory flag of each
// check is derived from SMOKE_METRICS so the versioned mandatory-metric set is the
// single source of truth for what blocks the evidence facet.
const EVIDENCE_METRIC_NAMES = Object.freeze({
  callbackPacingVariance: "render-worker callback-pacing variance",
  coreRunCompletion: "core measurement run completion",
  dawnPipeline: "Dawn pipeline compile/cache evidence",
  greyboxWorld: "greybox world content",
  gpuMemory: "attributable GPU memory",
  httpServing: "HTTP serving evidence",
  jsHeap: "all-worker JS heap",
  psoWarmup: "PSO warmup trace replay",
  reportFinalization: "report finalization",
  sabRingBuffer: "SAB ring-buffer transport",
  streaming: "world streaming pipeline",
  streamingVariance: "streaming cell-load p95 variance",
  wasmThreads: "Rust/WASM threads",
  v8CodeCache: "V8 code-cache evidence",
  vizPresentationFeedback: "compositor presentation interval",
});

export const SMOKE_EVIDENCE_METRIC_NAMES: readonly string[] = Object.freeze(
  Object.values(EVIDENCE_METRIC_NAMES),
);
export const SMOKE_ENVIRONMENT_METRIC_NAME = "verified gate environment identity" as const;
export const SMOKE_CHECKED_METRIC_NAMES: readonly string[] = Object.freeze([
  SMOKE_ENVIRONMENT_METRIC_NAME,
  ...SMOKE_EVIDENCE_METRIC_NAMES,
]);

function registryMandatory(name: string): boolean {
  const metric = SMOKE_METRICS.find((candidate) => candidate.name === name);
  if (metric === undefined) {
    throw new Error(`Evidence check references an unregistered smoke metric: ${name}`);
  }
  return metric.mandatoryForHarnessV1;
}

export function assertSmokeMetricRegistryCoverage(
  metrics: readonly Readonly<{ mandatoryForHarnessV1: boolean; name: string }>[],
  checkedNames: readonly string[],
): void {
  const registered = metrics.map(({ name }) => name).sort();
  const checked = [...checkedNames].sort();
  if (
    new Set(registered).size !== registered.length ||
    new Set(checked).size !== checked.length ||
    registered.length !== checked.length ||
    registered.some((name, index) => name !== checked[index])
  ) {
    throw new Error("Smoke metric registry and blocking-check producers drifted");
  }
}

// Fail loudly at module load if either side of the registry/producer contract drifts.
for (const name of SMOKE_EVIDENCE_METRIC_NAMES) registryMandatory(name);
if (!registryMandatory(SMOKE_ENVIRONMENT_METRIC_NAME)) {
  throw new Error("Smoke environment metric must remain mandatory");
}
assertSmokeMetricRegistryCoverage(SMOKE_METRICS, SMOKE_CHECKED_METRIC_NAMES);

interface EvidenceState {
  readonly reason?: string;
  readonly state: MetricState;
}

interface BudgetRun {
  readonly budgetChecks: readonly BudgetCheck[];
  readonly profile: string;
  readonly repeat: number;
}

interface DiagnosticRun {
  readonly diagnosticChecks: readonly DiagnosticCheck[];
  readonly profile: string;
  readonly repeat: number;
}

export interface SmokeBudgetInput {
  readonly runs: readonly BudgetRun[];
}

export interface SmokeInformationalInput {
  readonly evidenceChecks: readonly FacetEvidenceCheck[];
  readonly v8CodeCacheDiagnostics: readonly DiagnosticRun[];
}

export interface SmokeCoreRunCompletion {
  readonly completedRuns: number;
  readonly expectedRuns: number;
  readonly failure: string | null;
}

export interface SmokeEvidenceInput {
  readonly callbackPacingVariance: readonly (EvidenceState & { readonly profile: string })[];
  readonly coreRunCompletion: SmokeCoreRunCompletion;
  readonly incompleteMetrics: readonly (EvidenceState & {
    readonly mandatoryForHarnessV1: boolean;
    readonly metric: string;
  })[];
  readonly reportFinalization: EvidenceState;
  readonly runs: readonly {
    readonly dawnPipeline: EvidenceState;
    readonly gpuMemory: EvidenceState;
    readonly greyboxWorld: EvidenceState;
    readonly http:
      | Readonly<{ readonly state: "measured"; readonly value: LocalServerMetrics }>
      | Readonly<{ readonly reason: string; readonly state: "not-applicable" }>;
    readonly jsHeap: EvidenceState;
    readonly profile: "fresh" | "warm";
    readonly psoWarmup: EvidenceState;
    readonly repeat: number;
    readonly sabRingBuffer: EvidenceState;
    readonly streaming: EvidenceState;
    readonly wasmThreads: EvidenceState;
  }[];
  readonly streamingCellLoadP95Variance: readonly (EvidenceState & {
    readonly profile: string;
  })[];
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
  return Object.freeze(input.runs.flatMap((run) => budgetFacetChecks(run, "")));
}

export function collectSmokeInformationalFailures(
  input: SmokeInformationalInput,
): readonly string[] {
  return Object.freeze([
    ...input.evidenceChecks
      .filter((check) => !check.mandatory && !check.measured)
      .map((check) => check.description),
    ...input.v8CodeCacheDiagnostics.flatMap((run) =>
      run.diagnosticChecks
        .filter((check) => !check.satisfied)
        .map(
          (check) =>
            `V8 diagnostic ${run.profile} repeat ${run.repeat}: ${check.metric} ${check.actual} > ${check.expectedMaximum}`,
        ),
    ),
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
    coreRunCompletionCheck(input.coreRunCompletion),
    evidenceCheck(
      `report finalization: ${input.reportFinalization.state} (${evidenceReason(input.reportFinalization)})`,
      registryMandatory(EVIDENCE_METRIC_NAMES.reportFinalization),
      input.reportFinalization,
    ),
    ...input.v8CodeCacheDiagnostics.flatMap((run) => [
      evidenceCheck(
        `V8 diagnostic ${run.profile} repeat ${run.repeat}: code-cache production ${run.production.state} (${evidenceReason(run.production)})`,
        registryMandatory(EVIDENCE_METRIC_NAMES.v8CodeCache),
        run.production,
      ),
      evidenceCheck(
        `V8 diagnostic ${run.profile} repeat ${run.repeat}: V8 code-cache evidence ${run.v8CodeCache.state} (${evidenceReason(run.v8CodeCache)})`,
        registryMandatory(EVIDENCE_METRIC_NAMES.v8CodeCache),
        run.v8CodeCache,
      ),
    ]),
    ...input.incompleteMetrics.map((metric) => {
      const mandatory = registryMandatory(metric.metric);
      if (metric.mandatoryForHarnessV1 !== mandatory) {
        throw new Error(`Incomplete metric registry drifted for ${metric.metric}`);
      }
      return evidenceCheck(
        `${metric.metric}: ${metric.state} (${evidenceReason(metric)})`,
        mandatory,
        metric,
      );
    }),
    ...input.callbackPacingVariance.map((metric) =>
      evidenceCheck(
        `${metric.profile} callback pacing variance: ${evidenceReason(metric)}`,
        registryMandatory(EVIDENCE_METRIC_NAMES.callbackPacingVariance),
        metric,
      ),
    ),
    ...input.streamingCellLoadP95Variance.map((metric) =>
      evidenceCheck(
        `${metric.profile} streaming cell-load p95 variance: ${evidenceReason(metric)}`,
        registryMandatory(EVIDENCE_METRIC_NAMES.streamingVariance),
        metric,
      ),
    ),
    ...input.vizPresentationFeedbackCallbackVariance.map((metric) =>
      evidenceCheck(
        `${metric.profile} presentation-feedback variance: ${evidenceReason(metric)}`,
        registryMandatory(EVIDENCE_METRIC_NAMES.vizPresentationFeedback),
        metric,
      ),
    ),
    ...input.runs.map((run) =>
      evidenceCheck(
        `${run.profile} repeat ${run.repeat}: Dawn pipeline compile/cache evidence ${run.dawnPipeline.state} (${evidenceReason(run.dawnPipeline)})`,
        registryMandatory(EVIDENCE_METRIC_NAMES.dawnPipeline),
        run.dawnPipeline,
      ),
    ),
    ...input.runs.map((run) =>
      evidenceCheck(
        `${run.profile} repeat ${run.repeat}: PSO warmup trace replay ${run.psoWarmup.state} (${evidenceReason(run.psoWarmup)})`,
        registryMandatory(EVIDENCE_METRIC_NAMES.psoWarmup),
        run.psoWarmup,
      ),
    ),
    ...input.runs.map((run) =>
      evidenceCheck(
        `${run.profile} repeat ${run.repeat}: world streaming pipeline ${run.streaming.state} (${evidenceReason(run.streaming)})`,
        registryMandatory(EVIDENCE_METRIC_NAMES.streaming),
        run.streaming,
      ),
    ),
    ...input.runs.map((run) =>
      evidenceCheck(
        `${run.profile} repeat ${run.repeat}: greybox world content ${run.greyboxWorld.state} (${evidenceReason(run.greyboxWorld)})`,
        registryMandatory(EVIDENCE_METRIC_NAMES.greyboxWorld),
        run.greyboxWorld,
      ),
    ),
    ...input.runs.map((run) =>
      evidenceCheck(
        `${run.profile} repeat ${run.repeat}: Rust/WASM threads ${run.wasmThreads.state} (${evidenceReason(run.wasmThreads)})`,
        registryMandatory(EVIDENCE_METRIC_NAMES.wasmThreads),
        run.wasmThreads,
      ),
    ),
    ...input.runs.map((run) =>
      evidenceCheck(
        `${run.profile} repeat ${run.repeat}: all-worker JS heap ${run.jsHeap.state} (${evidenceReason(run.jsHeap)})`,
        registryMandatory(EVIDENCE_METRIC_NAMES.jsHeap),
        run.jsHeap,
      ),
    ),
    ...input.runs.map((run) =>
      evidenceCheck(
        `${run.profile} repeat ${run.repeat}: SAB ring-buffer transport ${run.sabRingBuffer.state} (${evidenceReason(run.sabRingBuffer)})`,
        registryMandatory(EVIDENCE_METRIC_NAMES.sabRingBuffer),
        run.sabRingBuffer,
      ),
    ),
    ...input.runs.map((run) =>
      evidenceCheck(
        `${run.profile} repeat ${run.repeat}: attributable GPU memory ${run.gpuMemory.state} (${evidenceReason(run.gpuMemory)})`,
        registryMandatory(EVIDENCE_METRIC_NAMES.gpuMemory),
        run.gpuMemory,
      ),
    ),
    ...input.runs.flatMap((run) =>
      run.http.state === "measured"
        ? evaluateHttpServingEvidence(run.profile, run.repeat, run.http.value).map((observation) =>
            Object.freeze({
              description: observation.description,
              mandatory: registryMandatory(EVIDENCE_METRIC_NAMES.httpServing),
              measured: observation.satisfied,
            }),
          )
        : [
            evidenceCheck(
              `${run.profile} repeat ${run.repeat}: HTTP serving evidence ${run.http.state} (${run.http.reason})`,
              registryMandatory(EVIDENCE_METRIC_NAMES.httpServing),
              run.http,
            ),
          ],
    ),
  ]);
}

function coreRunCompletionCheck(completion: SmokeCoreRunCompletion): FacetEvidenceCheck {
  const failureSuffix = completion.failure === null ? "" : ` — ${completion.failure}`;
  return Object.freeze({
    description: `core measurement runs completed (${completion.completedRuns} of ${completion.expectedRuns})${failureSuffix}`,
    mandatory: registryMandatory(EVIDENCE_METRIC_NAMES.coreRunCompletion),
    measured: completion.completedRuns === completion.expectedRuns,
  });
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
