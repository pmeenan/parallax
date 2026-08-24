import {
  APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS,
  APP_OWNED_LLM_WLLAMA_MODEL_DTYPE,
  APP_OWNED_LLM_WLLAMA_MODEL_ID,
  APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
  APP_OWNED_LLM_WLLAMA_MODEL_REVISION,
  type AppOwnedLlmGenerationTelemetry,
  type AppOwnedLlmSpikeTelemetrySnapshot,
  type RenderFrameSample,
} from "@parallax/engine";
import { type Distribution, distribution } from "../aggregate.js";
import type { BudgetCheck } from "../budgets.js";

export const APP_OWNED_LLM_SPIKE_SCENARIO = "app-owned-llm-spike@1";
export const APP_OWNED_LLM_SPIKE_REPORT_SCHEMA_VERSION = 4;
export const APP_OWNED_LLM_TTFT_SAMPLES = 20;
export const APP_OWNED_LLM_TOTAL_GENERATIONS = 30;
export const APP_OWNED_LLM_TTFT_P95_LIMIT_MS = 1_500;
export const APP_OWNED_LLM_COMPLETION_TIMEOUT_MS = 45 * 60 * 1_000;
export const APP_OWNED_LLM_LOAD_STALL_TIMEOUT_MS = 2 * 60 * 1_000;
export const APP_OWNED_LLM_CALLBACK_MIN_SAMPLES = 30;
const EXPECTED_MODEL = Object.freeze({
  artifacts: APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.length,
  dtype: APP_OWNED_LLM_WLLAMA_MODEL_DTYPE,
  id: APP_OWNED_LLM_WLLAMA_MODEL_ID,
  installBytes: APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
  revision: APP_OWNED_LLM_WLLAMA_MODEL_REVISION,
});

export type Metric<T> =
  | Readonly<{ readonly state: "measured"; readonly value: T }>
  | Readonly<{ readonly reason: string; readonly state: "invalid" | "unsupported" }>;

export interface AppOwnedLlmCallbackPacing extends Distribution {
  readonly sampleCount: number;
}

export interface AppOwnedLlmValidationSummary {
  readonly failures: readonly string[];
  readonly samples: number;
}

export interface AppOwnedLlmRunMetrics {
  readonly budgetChecks: readonly BudgetCheck[];
  readonly coldInstall: Metric<AppOwnedLlmSpikeTelemetrySnapshot["cache"]>;
  readonly context: Metric<AppOwnedLlmValidationSummary>;
  readonly generationWindow: Metric<AppOwnedLlmCallbackPacing>;
  readonly grounding: Metric<AppOwnedLlmValidationSummary>;
  readonly modelIdentity: Metric<Readonly<{ readonly bytes: number; readonly artifacts: number }>>;
  readonly schema: Metric<AppOwnedLlmValidationSummary>;
  readonly tokensPerSecond: Metric<Distribution>;
  readonly ttft: Metric<Distribution>;
  readonly warmOpfs: Metric<AppOwnedLlmSpikeTelemetrySnapshot["cache"]>;
}

export interface AppOwnedLlmCompletionWatchResult {
  readonly failureMessage: string | null;
  readonly loadStalled: boolean;
  readonly snapshot: AppOwnedLlmSpikeTelemetrySnapshot;
}

export async function waitForAppOwnedLlmCompletion(
  readSnapshot: () => Promise<AppOwnedLlmSpikeTelemetrySnapshot>,
  options: Readonly<{
    completionTimeoutMs?: number;
    loadStallTimeoutMs?: number;
    now?: () => number;
    pollIntervalMs?: number;
    sleep?: (delayMs: number) => Promise<void>;
  }> = {},
): Promise<AppOwnedLlmCompletionWatchResult> {
  const completionTimeoutMs = options.completionTimeoutMs ?? APP_OWNED_LLM_COMPLETION_TIMEOUT_MS;
  const loadStallTimeoutMs = options.loadStallTimeoutMs ?? APP_OWNED_LLM_LOAD_STALL_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const sleep =
    options.sleep ??
    ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const startedAt = now();
  let lastLoadAdvanceAt = startedAt;
  let maxLoadProgress = 0;

  for (;;) {
    const snapshot = await readSnapshot();
    const observedAt = now();
    if (snapshot.progress > maxLoadProgress) {
      maxLoadProgress = snapshot.progress;
      lastLoadAdvanceAt = observedAt;
    }
    if (snapshot.state === "completed" || snapshot.state === "failed") {
      return Object.freeze({
        failureMessage:
          snapshot.state === "failed"
            ? (snapshot.failureMessage ?? "App-owned LLM entered failed state without a reason")
            : null,
        loadStalled: false,
        snapshot,
      });
    }
    if (
      snapshot.state === "loading-model" &&
      observedAt - lastLoadAdvanceAt >= loadStallTimeoutMs
    ) {
      return Object.freeze({
        failureMessage: `App-owned LLM model load made no forward progress for ${observedAt - lastLoadAdvanceAt} ms (last observed progress ${maxLoadProgress.toFixed(4)}; ${snapshot.cache.verifiedArtifacts}/${snapshot.cache.expectedArtifacts} artifacts verified)`,
        loadStalled: true,
        snapshot,
      });
    }
    if (observedAt - startedAt >= completionTimeoutMs) {
      return Object.freeze({
        failureMessage: `App-owned LLM spike did not complete within ${completionTimeoutMs} ms`,
        loadStalled: false,
        snapshot,
      });
    }
    await sleep(pollIntervalMs);
  }
}

export function evaluateAppOwnedLlmRun(input: {
  readonly cold: AppOwnedLlmSpikeTelemetrySnapshot | null;
  readonly generationFrames: readonly RenderFrameSample[];
  readonly warm: AppOwnedLlmSpikeTelemetrySnapshot | null;
}): AppOwnedLlmRunMetrics {
  const ttft = evaluateTtft(input.warm);
  const tokensPerSecond = evaluateTokensPerSecond(input.warm);
  const schema = evaluateValidation(input.warm, "structured", APP_OWNED_LLM_SPIKE_SCENARIO);
  const grounding = evaluateValidation(
    input.warm,
    "context",
    "retrieved-fact-grounding",
    "retrieved-fact-grounding",
  );
  const context = evaluateContext(input.warm);
  const modelIdentity = evaluateModelIdentity(input.cold, input.warm);
  const coldInstall = evaluateColdInstall(input.cold);
  const warmOpfs = evaluateWarmOpfs(input.warm);
  const generationWindow = evaluateGenerationWindow(input.generationFrames);
  const budgetChecks =
    ttft.state === "measured"
      ? Object.freeze([
          Object.freeze({
            actual: ttft.value.p95,
            limit: APP_OWNED_LLM_TTFT_P95_LIMIT_MS,
            metric: "warmLatencyFixtureTtftP95Ms",
            passed: ttft.value.p95 <= APP_OWNED_LLM_TTFT_P95_LIMIT_MS,
          }),
        ])
      : Object.freeze([]);
  return Object.freeze({
    budgetChecks,
    coldInstall,
    context,
    generationWindow,
    grounding,
    modelIdentity,
    schema,
    tokensPerSecond,
    ttft,
    warmOpfs,
  });
}

export function evaluateAppOwnedLlmRunPass(input: {
  readonly environmentMeasured: boolean;
  readonly errors: readonly string[];
  readonly metrics: AppOwnedLlmRunMetrics;
  readonly telemetryCompleted: boolean;
}): boolean {
  const metrics = input.metrics;
  return (
    input.environmentMeasured &&
    input.telemetryCompleted &&
    input.errors.length === 0 &&
    metrics.budgetChecks.length > 0 &&
    metrics.budgetChecks.every((check) => check.passed) &&
    [
      metrics.coldInstall,
      metrics.context,
      metrics.generationWindow,
      metrics.grounding,
      metrics.modelIdentity,
      metrics.schema,
      metrics.tokensPerSecond,
      metrics.ttft,
      metrics.warmOpfs,
    ].every((metric) => metric.state === "measured")
  );
}

function evaluateTtft(telemetry: AppOwnedLlmSpikeTelemetrySnapshot | null): Metric<Distribution> {
  const samples = latencyFixtureSamples(telemetry);
  if (samples.length !== APP_OWNED_LLM_TTFT_SAMPLES) {
    return invalid(
      `Expected ${APP_OWNED_LLM_TTFT_SAMPLES} gate-watch-latency TTFT samples, received ${samples.length}`,
    );
  }
  const repetitions = new Set(samples.map((sample) => sample.repetition));
  if (repetitions.size !== APP_OWNED_LLM_TTFT_SAMPLES || !samples.every(validGeneration)) {
    return invalid("Latency fixture repetitions or TTFT values were invalid");
  }
  return measured(distribution(samples.map((sample) => sample.firstTokenLatencyMs)));
}

function evaluateTokensPerSecond(
  telemetry: AppOwnedLlmSpikeTelemetrySnapshot | null,
): Metric<Distribution> {
  if (telemetry === null || telemetry.generations.length !== APP_OWNED_LLM_TOTAL_GENERATIONS) {
    return invalid(
      `Warm run must produce all ${APP_OWNED_LLM_TOTAL_GENERATIONS} fixture generations`,
    );
  }
  if (!telemetry.generations.every(validGeneration)) {
    return invalid("Generation telemetry contained non-finite throughput or token counts");
  }
  return measured(distribution(telemetry.generations.map((sample) => sample.tokensPerSecond)));
}

function evaluateValidation(
  telemetry: AppOwnedLlmSpikeTelemetrySnapshot | null,
  kind: AppOwnedLlmGenerationTelemetry["kind"],
  label: string,
  fixtureId?: string,
): Metric<AppOwnedLlmValidationSummary> {
  if (telemetry === null) return invalid(`${label} evidence was not captured`);
  const samples = telemetry.generations.filter(
    (sample) => sample.kind === kind && (fixtureId === undefined || sample.fixtureId === fixtureId),
  );
  if (samples.length === 0) return invalid(`${label} fixture produced no samples`);
  if (kind === "structured" && samples.length !== 5) {
    return invalid(`Structured fixture must produce 5 samples, received ${samples.length}`);
  }
  if (fixtureId !== undefined && samples.length !== 1) {
    return invalid(`${label} fixture must produce exactly one sample, received ${samples.length}`);
  }
  const failures = samples.flatMap((sample) => sample.semanticValidationFailures);
  if (kind === "structured" && samples.some((sample) => sample.schemaValid !== true)) {
    failures.push("structured output failed the schema contract");
  }
  return failures.length === 0
    ? measured(Object.freeze({ failures: Object.freeze([]), samples: samples.length }))
    : invalid(`${label} validation failed: ${failures.join("; ")}`);
}

function evaluateContext(
  telemetry: AppOwnedLlmSpikeTelemetrySnapshot | null,
): Metric<AppOwnedLlmValidationSummary> {
  if (telemetry === null) return invalid("Context-window evidence was not captured");
  const required = ["context-short", "context-medium", "context-large"];
  const samples = required.map((id) =>
    telemetry.generations.find((sample) => sample.fixtureId === id),
  );
  if (samples.some((sample) => sample === undefined)) {
    return invalid("Context-window fixture did not produce every short/medium/large sample");
  }
  const inputTokens = samples.map((sample) => sample?.inputTokens ?? 0);
  if (!inputTokens.every((value) => Number.isSafeInteger(value) && value > 0)) {
    return invalid("Context-window fixture reported invalid input-token counts");
  }
  const [short, medium, large] = inputTokens;
  if (
    short === undefined ||
    medium === undefined ||
    large === undefined ||
    !(short < medium && medium < large)
  ) {
    return invalid("Context-window input tokens did not increase from short through large");
  }
  return measured(Object.freeze({ failures: Object.freeze([]), samples: inputTokens.length }));
}

function evaluateModelIdentity(
  cold: AppOwnedLlmSpikeTelemetrySnapshot | null,
  warm: AppOwnedLlmSpikeTelemetrySnapshot | null,
): Metric<Readonly<{ readonly bytes: number; readonly artifacts: number }>> {
  if (cold === null || warm === null)
    return invalid("Both cold and warm model telemetry are required");
  const expected = EXPECTED_MODEL;
  const exact = [cold, warm].every(
    (telemetry) =>
      telemetry.modelId === expected.id &&
      telemetry.modelRevision === expected.revision &&
      telemetry.modelDtype === expected.dtype &&
      telemetry.modelInstallBytes === expected.installBytes,
  );
  return exact
    ? measured(
        Object.freeze({
          artifacts: expected.artifacts,
          bytes: expected.installBytes,
        }),
      )
    : invalid("Model ID, revision, dtype, or exact pinned artifact byte total drifted");
}

function evaluateColdInstall(
  telemetry: AppOwnedLlmSpikeTelemetrySnapshot | null,
): Metric<AppOwnedLlmSpikeTelemetrySnapshot["cache"]> {
  if (telemetry === null) return invalid("Cold install telemetry was not captured");
  const cache = telemetry.cache;
  const expected = EXPECTED_MODEL;
  return telemetry.loadSource === "remote-install" &&
    cache.expectedArtifacts === expected.artifacts &&
    cache.missArtifacts === cache.expectedArtifacts &&
    cache.verifiedArtifacts === cache.expectedArtifacts &&
    cache.integrityFailures === 0 &&
    cache.writeBytes === expected.installBytes
    ? measured(cache)
    : invalid(
        "Fresh persistent profile did not prove a complete exact-byte remote install into OPFS",
      );
}

function evaluateWarmOpfs(
  telemetry: AppOwnedLlmSpikeTelemetrySnapshot | null,
): Metric<AppOwnedLlmSpikeTelemetrySnapshot["cache"]> {
  if (telemetry === null) return invalid("Warm OPFS telemetry was not captured");
  const cache = telemetry.cache;
  const expected = EXPECTED_MODEL;
  return telemetry.loadSource === "opfs" &&
    cache.expectedArtifacts === expected.artifacts &&
    cache.hitArtifacts === cache.expectedArtifacts &&
    cache.verifiedArtifacts === cache.expectedArtifacts &&
    cache.integrityFailures === 0 &&
    cache.readBytes === expected.installBytes &&
    cache.writeBytes === 0
    ? measured(cache)
    : invalid("Browser-restarted profile did not prove exact-byte OPFS reads without writes");
}

function evaluateGenerationWindow(
  frames: readonly RenderFrameSample[],
): Metric<AppOwnedLlmCallbackPacing> {
  const intervals = frames.flatMap((frame) =>
    frame.presentIntervalMs === null ? [] : [frame.presentIntervalMs],
  );
  if (intervals.length < APP_OWNED_LLM_CALLBACK_MIN_SAMPLES) {
    return invalid(
      `Only ${intervals.length} generation-window render callback samples were captured; ${APP_OWNED_LLM_CALLBACK_MIN_SAMPLES} are required`,
    );
  }
  const summary = distribution(intervals);
  return measured(Object.freeze({ ...summary, sampleCount: intervals.length }));
}

function latencyFixtureSamples(
  telemetry: AppOwnedLlmSpikeTelemetrySnapshot | null,
): readonly AppOwnedLlmGenerationTelemetry[] {
  return telemetry?.generations.filter((sample) => sample.fixtureId === "gate-watch-latency") ?? [];
}

function validGeneration(sample: AppOwnedLlmGenerationTelemetry): boolean {
  return (
    Number.isFinite(sample.firstTokenLatencyMs) &&
    sample.firstTokenLatencyMs >= 0 &&
    Number.isFinite(sample.tokensPerSecond) &&
    sample.tokensPerSecond >= 0 &&
    Number.isSafeInteger(sample.inputTokens) &&
    sample.inputTokens > 0 &&
    Number.isSafeInteger(sample.outputTokens) &&
    sample.outputTokens > 0
  );
}

function measured<T>(value: T): Readonly<{ readonly state: "measured"; readonly value: T }> {
  return Object.freeze({ state: "measured", value });
}

function invalid<T = never>(reason: string): Metric<T> {
  return Object.freeze({ reason, state: "invalid" });
}
