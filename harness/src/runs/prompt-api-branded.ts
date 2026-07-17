import type { PromptApiAvailability, PromptApiSpikeTelemetrySnapshot } from "@parallax/engine";
import {
  PROMPT_API_PROGRESS_STALL_TIMEOUT_MS,
  PROMPT_API_SPIKE_COMPLETION_TIMEOUT_MS,
} from "./prompt-api-spike.js";

export const PROMPT_API_BRANDED_SCENARIO = "prompt-api-branded@1";
export const PROMPT_API_BRANDED_REPORT_SCHEMA_VERSION = 2;

export type PromptApiBrandedMode = "restart-resume" | "uninterrupted";

export interface PromptApiBrandedInstallSegment {
  readonly activatedAtEpochMs: number;
  readonly initialAvailability: PromptApiAvailability | null;
  readonly outcome: "completed" | "interrupted-for-restart" | "failed";
  readonly telemetry: PromptApiSpikeTelemetrySnapshot;
}

export interface PromptApiBrandedDownloadSummary {
  readonly downloadDurationMs: number;
  readonly eventsObserved: number;
  readonly longestInProcessProgressGapMs: number;
  readonly retainedSamples: number;
  readonly restartObservationGapMs: number | null;
  readonly restartCount: number;
}

export type PromptApiBrandedDownloadEvidence =
  | Readonly<{ readonly state: "measured"; readonly value: PromptApiBrandedDownloadSummary }>
  | Readonly<{ readonly reason: string; readonly state: "invalid" }>;

export interface PromptApiRestartPointResult {
  readonly failureMessage: string | null;
  readonly readyForRestart: boolean;
  readonly snapshot: PromptApiSpikeTelemetrySnapshot;
}

export async function waitForPromptApiRestartPoint(
  readSnapshot: () => Promise<PromptApiSpikeTelemetrySnapshot>,
  options: Readonly<{
    completionTimeoutMs?: number;
    now?: () => number;
    pollIntervalMs?: number;
    progressStallTimeoutMs?: number;
    sleep?: (delayMs: number) => Promise<void>;
  }> = {},
): Promise<PromptApiRestartPointResult> {
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
    if (
      snapshot.state === "creating" &&
      observedProgress > 0 &&
      observedProgress < 1 &&
      snapshot.download.samples.some((sample) => sample.loaded > 0 && sample.loaded < 1)
    ) {
      return Object.freeze({ failureMessage: null, readyForRestart: true, snapshot });
    }
    if (["completed", "failed"].includes(snapshot.state)) {
      return Object.freeze({
        failureMessage:
          snapshot.state === "completed"
            ? "Prompt API download completed before the restart/resume boundary could be exercised"
            : (snapshot.failureMessage ?? "Prompt API failed before the restart/resume boundary"),
        readyForRestart: false,
        snapshot,
      });
    }
    if (
      ["awaiting-user-activation", "creating"].includes(snapshot.state) &&
      observedAt - lastAdvanceAt >= progressStallTimeoutMs
    ) {
      return Object.freeze({
        failureMessage: `Prompt API download made no forward progress for ${observedAt - lastAdvanceAt} ms before the restart boundary (last observed progress ${maxProgress.toFixed(4)}; ${snapshot.download.eventsObserved} events observed)`,
        readyForRestart: false,
        snapshot,
      });
    }
    if (observedAt - startedAt >= completionTimeoutMs) {
      return Object.freeze({
        failureMessage: `Prompt API restart/resume phase did not reach an intermediate progress update within ${completionTimeoutMs} ms`,
        readyForRestart: false,
        snapshot,
      });
    }
    await sleep(pollIntervalMs);
  }
}

export function evaluatePromptApiBrandedDownload(
  mode: PromptApiBrandedMode,
  segments: readonly PromptApiBrandedInstallSegment[],
): PromptApiBrandedDownloadEvidence {
  if (mode === "uninterrupted" && segments.length !== 1) {
    return invalid("The uninterrupted profile must contain exactly one install segment");
  }
  if (mode === "restart-resume") {
    if (segments.length !== 2) {
      return invalid("The restart/resume profile must contain exactly two install segments");
    }
    if (segments[0]?.outcome !== "interrupted-for-restart") {
      return invalid("The first restart/resume segment was not interrupted during live download");
    }
    const interruptedProgress = segments[0].telemetry.download.maxProgress;
    if (interruptedProgress === null || interruptedProgress <= 0 || interruptedProgress >= 1) {
      return invalid(
        `The restart boundary requires current progress strictly between 0 and 1, received ${String(interruptedProgress)}`,
      );
    }
  }
  if (segments.at(-1)?.outcome !== "completed") {
    return invalid("The final install segment did not complete");
  }
  if (segments[0]?.initialAvailability === "available") {
    return invalid("The fresh branded-Chrome profile already reported the model available");
  }
  for (const [index, segment] of segments.entries()) {
    const invalidEvents = segment.telemetry.download.invalidEventsObserved;
    const regressions = segment.telemetry.download.regressiveEventsObserved;
    if (invalidEvents > 0) {
      return invalid(
        `Install segment ${index + 1} observed ${invalidEvents} invalid progress events`,
      );
    }
    if (regressions > 0) {
      return invalid(
        `Install segment ${index + 1} observed ${regressions} regressive progress events`,
      );
    }
    if (segment.telemetry.download.longestProgressGapMs >= PROMPT_API_PROGRESS_STALL_TIMEOUT_MS) {
      return invalid(
        `Install segment ${index + 1} stalled for ${segment.telemetry.download.longestProgressGapMs} ms`,
      );
    }
  }

  const samples = absoluteSamples(segments);
  if (!samples.some((sample) => sample.loaded === 0)) {
    return invalid("Branded-Chrome progress did not expose the normalized 0 endpoint");
  }
  const completed = samples.find((sample) => sample.loaded === 1);
  if (completed === undefined) {
    return invalid("Branded-Chrome progress did not expose the normalized 1 endpoint");
  }
  if (!samples.some((sample) => sample.loaded > 0 && sample.loaded < 1)) {
    return invalid("Branded-Chrome progress did not expose an actionable intermediate update");
  }
  if (mode === "restart-resume") {
    const first = segments[0];
    if (
      first === undefined ||
      !first.telemetry.download.samples.some((sample) => sample.loaded > 0 && sample.loaded < 1)
    ) {
      return invalid("The browser restart was not taken after observable intermediate progress");
    }
  }

  const firstActivation = segments[0]?.activatedAtEpochMs;
  if (firstActivation === undefined) return invalid("No install activation was recorded");
  const longestInProcessProgressGapMs = Math.max(
    0,
    ...segments.map((segment) => segment.telemetry.download.longestProgressGapMs),
  );
  const restartObservationGapMs =
    mode === "restart-resume" ? observationGapAcrossRestart(segments[0], segments[1]) : null;
  const downloads = segments.map((segment) => segment.telemetry.download);
  return Object.freeze({
    state: "measured",
    value: Object.freeze({
      downloadDurationMs: completed.observedAt - firstActivation,
      eventsObserved: downloads.reduce((sum, download) => sum + download.eventsObserved, 0),
      longestInProcessProgressGapMs,
      retainedSamples: samples.length,
      restartObservationGapMs,
      restartCount: mode === "restart-resume" ? 1 : 0,
    }),
  });
}

function observationGapAcrossRestart(
  before: PromptApiBrandedInstallSegment | undefined,
  after: PromptApiBrandedInstallSegment | undefined,
): number | null {
  if (before === undefined || after === undefined) return null;
  const lastBefore = before.telemetry.download.samples.at(-1);
  const firstAfter = after.telemetry.download.samples[0];
  if (lastBefore === undefined || firstAfter === undefined) return null;
  return Math.max(
    0,
    after.activatedAtEpochMs +
      firstAfter.elapsedMs -
      (before.activatedAtEpochMs + lastBefore.elapsedMs),
  );
}

function absoluteSamples(segments: readonly PromptApiBrandedInstallSegment[]): readonly Readonly<{
  loaded: number;
  observedAt: number;
}>[] {
  return segments
    .flatMap((segment) =>
      segment.telemetry.download.samples.map((sample) =>
        Object.freeze({
          loaded: sample.loaded,
          observedAt: segment.activatedAtEpochMs + sample.elapsedMs,
        }),
      ),
    )
    .sort((left, right) => left.observedAt - right.observedAt);
}

function invalid(reason: string): PromptApiBrandedDownloadEvidence {
  return Object.freeze({ reason, state: "invalid" });
}
