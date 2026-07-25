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
  opfsReadSpike: "OPFS sync-access-handle read throughput",
  opfsThroughputVariance: "OPFS sync-access-handle throughput repeatability",
  sabRingBuffer: "SAB ring-buffer transport",
  streaming: "world streaming pipeline",
  wasmThreads: "Rust/WASM threads",
  v8CodeCache: "V8 code-cache evidence",
  vizPresentationFeedback: "compositor presentation interval",
});

export const SMOKE_EVIDENCE_METRIC_NAMES: readonly string[] = Object.freeze(
  Object.values(EVIDENCE_METRIC_NAMES),
);

function registryMandatory(name: string): boolean {
  const metric = SMOKE_METRICS.find((candidate) => candidate.name === name);
  if (metric === undefined) {
    throw new Error(`Evidence check references an unregistered smoke metric: ${name}`);
  }
  return metric.mandatoryForHarnessV1;
}

// Fail loudly at module load if the registry and this module ever drift apart.
for (const name of SMOKE_EVIDENCE_METRIC_NAMES) registryMandatory(name);

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
  readonly opfsThroughputVariance: readonly (EvidenceState & {
    readonly mode: "random" | "sequential";
    readonly profile: "fresh" | "warm";
    readonly timingScope: "read-call";
  })[];
  readonly runs: readonly {
    readonly dawnPipeline: EvidenceState;
    readonly gpuMemory: EvidenceState;
    readonly greyboxWorld: EvidenceState;
    readonly http: Readonly<{ readonly value: LocalServerMetrics }>;
    readonly jsHeap: EvidenceState;
    readonly opfsReadSpike: EvidenceState;
    readonly profile: "fresh" | "warm";
    readonly repeat: number;
    readonly sabRingBuffer: EvidenceState;
    readonly streaming: EvidenceState;
    readonly wasmThreads: EvidenceState;
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
        registryMandatory(EVIDENCE_METRIC_NAMES.callbackPacingVariance),
        metric,
      ),
    ),
    ...input.opfsThroughputVariance.map((metric) =>
      evidenceCheck(
        `${metric.profile} ${metric.mode} OPFS ${metric.timingScope} throughput variance: ${evidenceReason(metric)}`,
        registryMandatory(EVIDENCE_METRIC_NAMES.opfsThroughputVariance),
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
        `${run.profile} repeat ${run.repeat}: OPFS sync-access-handle read throughput ${run.opfsReadSpike.state} (${evidenceReason(run.opfsReadSpike)})`,
        registryMandatory(EVIDENCE_METRIC_NAMES.opfsReadSpike),
        run.opfsReadSpike,
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
      evaluateHttpServingEvidence(run.profile, run.repeat, run.http.value).map((observation) =>
        Object.freeze({
          description: observation.description,
          mandatory: registryMandatory(EVIDENCE_METRIC_NAMES.httpServing),
          measured: observation.satisfied,
        }),
      ),
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
