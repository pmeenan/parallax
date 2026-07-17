import type {
  PromptApiAvailability,
  PromptApiDownloadTelemetry,
  PromptApiSpikeTelemetrySnapshot,
} from "@parallax/engine";
import { distribution } from "../aggregate.js";
import type { BudgetCheck, DiagnosticCheck, QualityTier } from "../budgets.js";

export const PROMPT_API_SPIKE_SCENARIO = "prompt-api-spike@1";
export const PROMPT_API_SPIKE_REPORT_SCHEMA_VERSION = 6;
export const PROMPT_API_SPIKE_COMPLETION_TIMEOUT_MS = 30 * 60 * 1_000;
export const PROMPT_API_PROGRESS_STALL_TIMEOUT_MS = 2 * 60 * 1_000;
export const PROMPT_API_SPIKE_FIRST_TOKEN_LIMIT_MS = 1_500;
export const PROMPT_API_SPIKE_PROFILE_LINEAGE_SCHEMA_VERSION = 1;
export const PROMPT_API_CALLBACK_MIN_SAMPLES = 30;

const PRESENT_P50_LIMIT_MS: Readonly<Record<QualityTier, number>> = Object.freeze({
  showcase: 16.67,
  standard: 8.34,
});

export type PromptApiDownloadEvidence =
  | Readonly<{ readonly state: "measured"; readonly value: PromptApiDownloadTelemetry }>
  | Readonly<{ readonly reason: string; readonly state: "invalid" }>;

export interface PromptApiCallbackPacing {
  readonly max: number;
  readonly p50: number;
  readonly p95: number;
  readonly sampleCount: number;
}

export type PromptApiCallbackPacingEvidence =
  | Readonly<{ readonly state: "measured"; readonly value: PromptApiCallbackPacing }>
  | Readonly<{ readonly reason: string; readonly state: "invalid" }>;

export function evaluatePromptApiDownloadEvidence(input: {
  readonly download: PromptApiDownloadTelemetry;
  readonly initialAvailability: PromptApiAvailability | null;
  readonly profile: "fresh" | "warm";
}): PromptApiDownloadEvidence {
  if (input.profile !== "fresh") {
    return Object.freeze({
      reason: "First-download evidence requires a fresh browser profile",
      state: "invalid",
    });
  }
  if (input.initialAvailability === "available") {
    return Object.freeze({
      reason: "Fresh profile reported the model already available; download flow was absent",
      state: "invalid",
    });
  }
  if (input.download.invalidEventsObserved > 0) {
    return Object.freeze({
      reason: `${input.download.invalidEventsObserved} download progress events violated the normalized 0..1 contract`,
      state: "invalid",
    });
  }
  if (input.download.regressiveEventsObserved > 0) {
    return Object.freeze({
      reason: `${input.download.regressiveEventsObserved} download progress events regressed`,
      state: "invalid",
    });
  }
  const firstSample = input.download.samples[0];
  const lastSample = input.download.samples.at(-1);
  if (input.download.eventsObserved < 2 || firstSample?.loaded !== 0 || lastSample?.loaded !== 1) {
    return Object.freeze({
      reason: "Download progress did not include the required normalized 0 and 1 endpoints",
      state: "invalid",
    });
  }
  if (!input.download.samples.some((sample) => sample.loaded > 0 && sample.loaded < 1)) {
    return Object.freeze({
      reason: "Download progress did not include an actionable intermediate update",
      state: "invalid",
    });
  }
  if (input.download.longestProgressGapMs >= PROMPT_API_PROGRESS_STALL_TIMEOUT_MS) {
    return Object.freeze({
      reason: `Download progress stalled for ${input.download.longestProgressGapMs} ms`,
      state: "invalid",
    });
  }
  return Object.freeze({ state: "measured", value: input.download });
}

export interface PromptApiCompletionWatchResult {
  readonly failureMessage: string | null;
  readonly snapshot: PromptApiSpikeTelemetrySnapshot;
}

export async function waitForPromptApiCompletion(
  readSnapshot: () => Promise<PromptApiSpikeTelemetrySnapshot>,
  options: Readonly<{
    completionTimeoutMs?: number;
    now?: () => number;
    pollIntervalMs?: number;
    progressStallTimeoutMs?: number;
    sleep?: (delayMs: number) => Promise<void>;
  }> = {},
): Promise<PromptApiCompletionWatchResult> {
  const completionTimeoutMs = options.completionTimeoutMs ?? PROMPT_API_SPIKE_COMPLETION_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const progressStallTimeoutMs =
    options.progressStallTimeoutMs ?? PROMPT_API_PROGRESS_STALL_TIMEOUT_MS;
  const sleep =
    options.sleep ??
    ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const startedAt = now();
  let lastAdvanceAt = startedAt;
  let maxProgress = 0;

  for (;;) {
    const snapshot = await readSnapshot();
    const observedAt = now();
    const observedProgress = snapshot.download.maxProgress ?? 0;
    if (observedProgress > maxProgress) {
      maxProgress = observedProgress;
      lastAdvanceAt = observedAt;
    }
    if (["completed", "failed"].includes(snapshot.state)) {
      return Object.freeze({
        failureMessage:
          snapshot.state === "failed"
            ? (snapshot.failureMessage ?? "Prompt API entered failed state without a reason")
            : null,
        snapshot,
      });
    }
    if (
      ["awaiting-user-activation", "creating"].includes(snapshot.state) &&
      observedAt - lastAdvanceAt >= progressStallTimeoutMs
    ) {
      return Object.freeze({
        failureMessage: `Prompt API download made no forward progress for ${observedAt - lastAdvanceAt} ms (last observed progress ${maxProgress.toFixed(4)}; ${snapshot.download.eventsObserved} events observed)`,
        snapshot,
      });
    }
    if (observedAt - startedAt >= completionTimeoutMs) {
      return Object.freeze({
        failureMessage: `Prompt API spike did not complete within ${completionTimeoutMs} ms`,
        snapshot,
      });
    }
    await sleep(pollIntervalMs);
  }
}

export function evaluatePromptApiCallbackPacing(
  intervals: readonly number[],
  priorFailure: string | null,
): PromptApiCallbackPacingEvidence {
  if (priorFailure !== null) return Object.freeze({ reason: priorFailure, state: "invalid" });
  if (intervals.length < PROMPT_API_CALLBACK_MIN_SAMPLES) {
    return Object.freeze({
      reason: `Only ${intervals.length} marker-aligned callback intervals were captured; ${PROMPT_API_CALLBACK_MIN_SAMPLES} are required for a distribution`,
      state: "invalid",
    });
  }
  return Object.freeze({ state: "measured", value: summarizePromptApiCallbackPacing(intervals) });
}

export function evaluatePromptApiBudgets(input: {
  readonly firstChunkLatencyMs: number;
  readonly longTasksOver50Ms: number;
}): readonly BudgetCheck[] {
  return Object.freeze([
    check(
      "dialogFirstTokenLatencyMs",
      input.firstChunkLatencyMs,
      PROMPT_API_SPIKE_FIRST_TOKEN_LIMIT_MS,
    ),
    check("mainThreadLongTasksOver50Ms", input.longTasksOver50Ms, 0),
  ]);
}

export function summarizePromptApiCallbackPacing(
  intervals: readonly number[],
): PromptApiCallbackPacing {
  const summary = distribution(intervals);
  return Object.freeze({
    max: summary.max,
    p50: summary.p50,
    p95: summary.p95,
    sampleCount: intervals.length,
  });
}

export function evaluatePromptApiCallbackPacingDiagnostics(
  pacing: PromptApiCallbackPacing,
  tier: QualityTier,
): readonly DiagnosticCheck[] {
  return Object.freeze([
    diagnostic("promptGenerationCallbackIntervalP50Ms", pacing.p50, PRESENT_P50_LIMIT_MS[tier]),
    diagnostic("promptGenerationCallbackIntervalP95Ms", pacing.p95, 16.67),
    diagnostic("promptGenerationCallbackIntervalMaxMs", pacing.max, 50),
  ]);
}

export function evaluatePromptApiRunPass(input: {
  readonly budgetChecks: readonly BudgetCheck[];
  readonly concurrentSessionsMeasured: boolean;
  readonly downloadMeasured: boolean;
  readonly environmentMeasured: boolean;
  readonly errorCount: number;
  readonly firstTokenMeasured: boolean;
  readonly longTasksMeasured: boolean;
  readonly modelComponentMeasured: boolean;
  readonly offlineMeasured: boolean;
  readonly offlinePromptSucceeded: boolean;
  readonly telemetryCompleted: boolean;
}): boolean {
  return (
    input.environmentMeasured &&
    input.downloadMeasured &&
    input.firstTokenMeasured &&
    input.longTasksMeasured &&
    input.budgetChecks.length > 0 &&
    input.budgetChecks.every((check) => check.passed) &&
    input.modelComponentMeasured &&
    input.telemetryCompleted &&
    input.concurrentSessionsMeasured &&
    input.offlineMeasured &&
    input.offlinePromptSucceeded &&
    input.errorCount === 0
  );
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
