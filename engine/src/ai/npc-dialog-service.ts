import {
  type ChatCompletionChunk,
  type ChatCompletionParams,
  LoggerWithoutDebug,
  Wllama,
} from "@wllama/wllama/esm/index.js";
import type { RenderFrameSample, RenderService } from "../render/render-service";
import { openBrowserInstallStoreFile } from "../storage/opfs-release-store-browser";
import { APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS } from "./app-owned-llm-spike-protocol";
import type { InstalledModelSource } from "./installed-model-source";
import {
  NPC_DIALOG_NO_ACTION,
  NPC_DIALOG_NO_SUBJECT,
  NPC_DIALOG_TELEMETRY_SCHEMA_VERSION,
  type NpcDialogFrameImpactTelemetry,
  type NpcDialogInferenceDevice,
  type NpcDialogRequest,
  type NpcDialogResponse,
  type NpcDialogTelemetrySnapshot,
  parseNpcDialogOutput,
  validateNpcDialogRequest,
} from "./npc-dialog-contract";
import { WLLAMA_WASM_ARTIFACT } from "./wllama-runtime-artifact";

const MAXIMUM_LATENCY_SAMPLES = 256;
const MAXIMUM_FRAME_SAMPLES = 4_096;
const MODEL_LOAD_TIMEOUT_MS = 120_000;
const MODEL_CLEANUP_TIMEOUT_MS = 5_000;
const FRAME_BATCH_PADDING_SAMPLES = 60;

export interface NpcDialogModelRuntime {
  dispose(): Promise<void>;
  generate(request: NpcDialogRequest, signal: AbortSignal): Promise<NpcDialogResponse>;
}

export interface NpcDialogRuntimeFactory {
  create(
    source: InstalledModelSource,
    device: NpcDialogInferenceDevice,
    signal: AbortSignal,
  ): Promise<NpcDialogModelRuntime>;
}

export interface NpcDialogService {
  dispose(): void;
  generate(request: NpcDialogRequest, signal?: AbortSignal): Promise<NpcDialogResponse>;
  snapshot(): NpcDialogTelemetrySnapshot;
  subscribe(listener: (snapshot: NpcDialogTelemetrySnapshot) => void): () => void;
}

export class NpcDialogUnavailableError extends Error {
  override readonly name = "NpcDialogUnavailableError";
}

export class NpcDialogRejectedOutputError extends Error {
  override readonly name = "NpcDialogRejectedOutputError";
}

export function createNpcDialogService(
  source: InstalledModelSource,
  renderService: Pick<RenderService, "snapshot" | "subscribe">,
  device: NpcDialogInferenceDevice = "wllama-webgpu",
  runtimeFactory: NpcDialogRuntimeFactory = browserNpcDialogRuntimeFactory(),
): NpcDialogService {
  const listeners = new Set<(snapshot: NpcDialogTelemetrySnapshot) => void>();
  const latencies: number[] = [];
  const frameDurations: number[] = [];
  const presentIntervals: number[] = [];
  let runtime: NpcDialogModelRuntime | null = null;
  let initialization: Promise<NpcDialogModelRuntime> | null = null;
  let active: Promise<NpcDialogResponse> | null = null;
  let disposed = false;
  const controller = new AbortController();
  let observedFrameCount = renderService.snapshot().frameCount;
  let captureFrames = false;
  let captureStopAfterFrameCount: number | null = null;
  let telemetry = freezeTelemetry({
    activeNpcId: null,
    device,
    failureCount: 0,
    failureMessage: null,
    firstTokenLatencyMaximumMs: null,
    firstTokenLatencyP95Ms: null,
    frameImpact: emptyFrameImpact(),
    generationCount: 0,
    inputTokenCount: 0,
    loadElapsedMs: null,
    outputTokenCount: 0,
    rejectedOutputCount: 0,
    requestCount: 0,
    schemaVersion: NPC_DIALOG_TELEMETRY_SCHEMA_VERSION,
    state: source.snapshot().state === "unavailable" ? "unavailable" : "idle",
  });

  const publish = (next: NpcDialogTelemetrySnapshot): void => {
    telemetry = freezeTelemetry(next);
    for (const listener of listeners) {
      try {
        listener(telemetry);
      } catch (error: unknown) {
        console.error("NPC dialog telemetry listener failed", error);
      }
    }
  };
  const unsubscribeRender = renderService.subscribe((snapshot) => {
    const delta = Math.max(0, snapshot.frameCount - observedFrameCount);
    observedFrameCount = snapshot.frameCount;
    if (!captureFrames || delta === 0) return;
    const samples = snapshot.recentFrames.slice(-Math.min(delta, snapshot.recentFrames.length));
    recordFrames(samples, frameDurations, presentIntervals);
    if (captureStopAfterFrameCount !== null && snapshot.frameCount > captureStopAfterFrameCount) {
      captureFrames = false;
      captureStopAfterFrameCount = null;
      publish({ ...telemetry, frameImpact: frameImpact(frameDurations, presentIntervals) });
    }
  });

  const initialize = (): Promise<NpcDialogModelRuntime> => {
    if (disposed) return Promise.reject(new Error("NPC dialog service is disposed"));
    if (runtime !== null) return Promise.resolve(runtime);
    if (initialization !== null) return initialization;
    if (source.snapshot().state !== "ready") {
      publish({ ...telemetry, state: "unavailable" });
      return Promise.reject(
        new NpcDialogUnavailableError("The installed NPC model is unavailable"),
      );
    }
    publish({ ...telemetry, failureMessage: null, state: "loading-model" });
    const startedAt = performance.now();
    initialization = runtimeFactory
      .create(source, device, controller.signal)
      .then((created) => {
        if (disposed) {
          return created.dispose().then(() => {
            throw new Error("NPC dialog service was disposed during model load");
          });
        }
        runtime = created;
        publish({
          ...telemetry,
          loadElapsedMs: performance.now() - startedAt,
          state: "ready",
        });
        return created;
      })
      .catch((error: unknown) => {
        if (disposed) throw error;
        if (error instanceof NpcDialogUnavailableError) throw error;
        publish({
          ...telemetry,
          failureCount: telemetry.failureCount + 1,
          failureMessage: errorMessage(error),
          state: "failed",
        });
        throw error;
      });
    return initialization;
  };

  return Object.freeze({
    dispose(): void {
      if (disposed) return;
      disposed = true;
      captureFrames = false;
      controller.abort();
      unsubscribeRender();
      const current = runtime;
      runtime = null;
      if (current !== null) void current.dispose().catch(() => undefined);
      publish({ ...telemetry, activeNpcId: null, state: "disposed" });
      listeners.clear();
    },
    generate(input: NpcDialogRequest, callerSignal?: AbortSignal): Promise<NpcDialogResponse> {
      if (disposed) return Promise.reject(new Error("NPC dialog service is disposed"));
      if (active !== null)
        return Promise.reject(new Error("NPC dialog generation is already active"));
      if (callerSignal?.aborted === true) return Promise.reject(callerSignal.reason);
      const request = validateNpcDialogRequest(input);
      const requestSignal =
        callerSignal === undefined
          ? controller.signal
          : AbortSignal.any([controller.signal, callerSignal]);
      publish({
        ...telemetry,
        activeNpcId: request.npcId,
        failureMessage: null,
        requestCount: telemetry.requestCount + 1,
      });
      active = abortable(initialize(), requestSignal)
        .then(async (model) => {
          captureFrames = true;
          captureStopAfterFrameCount = null;
          frameDurations.length = 0;
          presentIntervals.length = 0;
          recordFrames(
            renderService.snapshot().recentFrames.slice(-FRAME_BATCH_PADDING_SAMPLES),
            frameDurations,
            presentIntervals,
          );
          publish({
            ...telemetry,
            activeNpcId: request.npcId,
            frameImpact: frameImpact(frameDurations, presentIntervals),
            state: "generating",
          });
          try {
            const response = await model.generate(request, requestSignal);
            latencies.push(response.firstTokenLatencyMs);
            if (latencies.length > MAXIMUM_LATENCY_SAMPLES) latencies.shift();
            publish({
              ...telemetry,
              activeNpcId: null,
              firstTokenLatencyMaximumMs: Math.max(...latencies),
              firstTokenLatencyP95Ms: percentile95(latencies),
              frameImpact: frameImpact(frameDurations, presentIntervals),
              generationCount: telemetry.generationCount + 1,
              inputTokenCount: telemetry.inputTokenCount + response.inputTokens,
              outputTokenCount: telemetry.outputTokenCount + response.outputTokens,
              state: "ready",
            });
            return response;
          } finally {
            captureStopAfterFrameCount = renderService.snapshot().frameCount;
          }
        })
        .catch((error: unknown) => {
          if (disposed) throw error;
          const unavailable = error instanceof NpcDialogUnavailableError;
          const cancelled = requestSignal.aborted;
          const loadFailureAlreadyRecorded = runtime === null && telemetry.state === "failed";
          const rejected = error instanceof NpcDialogRejectedOutputError;
          publish({
            ...telemetry,
            activeNpcId: null,
            failureCount:
              unavailable || cancelled || loadFailureAlreadyRecorded
                ? telemetry.failureCount
                : telemetry.failureCount + 1,
            failureMessage: unavailable || cancelled ? null : errorMessage(error),
            frameImpact: frameImpact(frameDurations, presentIntervals),
            rejectedOutputCount:
              runtime === null || cancelled
                ? telemetry.rejectedOutputCount
                : telemetry.rejectedOutputCount + Number(rejected),
            state: unavailable
              ? "unavailable"
              : cancelled
                ? runtime === null
                  ? telemetry.state
                  : "ready"
                : runtime === null
                  ? "failed"
                  : "ready",
          });
          throw error;
        })
        .finally(() => {
          active = null;
        });
      return active;
    },
    snapshot(): NpcDialogTelemetrySnapshot {
      return telemetry;
    },
    subscribe(listener: (snapshot: NpcDialogTelemetrySnapshot) => void): () => void {
      listeners.add(listener);
      listener(telemetry);
      return () => listeners.delete(listener);
    },
  });
}

function browserNpcDialogRuntimeFactory(): NpcDialogRuntimeFactory {
  return Object.freeze({
    async create(
      source: InstalledModelSource,
      device: NpcDialogInferenceDevice,
      signal: AbortSignal,
    ): Promise<NpcDialogModelRuntime> {
      signal.throwIfAborted();
      const installedBySha = new Map(
        source.artifacts().map((artifact) => [artifact.sha256, artifact] as const),
      );
      const blobs: Blob[] = [];
      for (const expected of APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS) {
        const installed = installedBySha.get(expected.sha256);
        if (installed === undefined || installed.bytes !== expected.bytes) {
          throw new Error(`Installed NPC model artifact is unavailable: ${expected.path}`);
        }
        const file = await (await openBrowserInstallStoreFile(installed.path)).getFile();
        if (file.size !== installed.bytes) {
          throw new Error(`Installed NPC model artifact changed size: ${installed.resourceId}`);
        }
        blobs.push(new File([file], expected.path, { type: "application/octet-stream" }));
      }
      const wllama = new Wllama({ default: WLLAMA_WASM_ARTIFACT }, { logger: LoggerWithoutDebug });
      try {
        await withTimeout(
          wllama.loadModel(blobs, {
            flash_attn: true,
            n_ctx: 8_192,
            n_gpu_layers: device === "wllama-webgpu" ? 99_999 : 0,
            reasoning: false,
            warmup: false,
          }),
          MODEL_LOAD_TIMEOUT_MS,
          "NPC model load did not complete within 120 seconds",
        );
        signal.throwIfAborted();
      } catch (error: unknown) {
        await settleNpcDialogRuntimeCleanup(wllama.exit());
        throw error;
      }
      return Object.freeze({
        dispose: () => wllama.exit(),
        generate: (request: NpcDialogRequest, requestSignal: AbortSignal) =>
          generateWithWllama(wllama, request, requestSignal),
      });
    },
  });
}

async function generateWithWllama(
  wllama: Wllama,
  request: NpcDialogRequest,
  signal: AbortSignal,
): Promise<NpcDialogResponse> {
  const startedAt = performance.now();
  let firstTokenAt: number | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let outputChunkCount = 0;
  let output = "";
  const completion: ChatCompletionParams & {
    readonly onData: (chunk: ChatCompletionChunk) => void;
    readonly stream: true;
  } = {
    abortSignal: signal,
    chat_template_kwargs: { enable_thinking: false },
    max_tokens: request.maxOutputTokens,
    messages: request.messages.map((message) => ({ ...message })),
    onData(chunk: ChatCompletionChunk): void {
      const content = chunk.choices[0]?.delta?.content;
      if (typeof content === "string" && content !== "") {
        firstTokenAt ??= performance.now();
        outputChunkCount += 1;
        output += content;
      }
      if (chunk.usage !== undefined && chunk.usage !== null) {
        inputTokens = chunk.usage.prompt_tokens;
        outputTokens = chunk.usage.completion_tokens;
      }
      if (chunk.timings !== undefined) {
        inputTokens = chunk.timings.prompt_n;
        outputTokens = chunk.timings.predicted_n;
      }
    },
    response_format: npcDialogResponseFormat(request),
    return_tokens: true,
    seed: 0,
    stream: true,
    temperature: 0,
    timings_per_token: true,
  };
  await wllama.createChatCompletion(completion);
  const completedAt = performance.now();
  outputTokens = Math.max(outputTokens, outputChunkCount);
  if (firstTokenAt === null || outputTokens < 1) {
    throw new Error("NPC dialog output completed without a generated token");
  }
  let parsed: ReturnType<typeof parseNpcDialogOutput>;
  try {
    parsed = parseNpcDialogOutput(output, request.intentDefinitions);
  } catch (error: unknown) {
    throw new NpcDialogRejectedOutputError(
      `NPC dialog output failed validation: ${errorMessage(error)}`,
      { cause: error },
    );
  }
  return Object.freeze({
    firstTokenLatencyMs: firstTokenAt - startedAt,
    inputTokens,
    intent: parsed.intent,
    outputTokens,
    speech: parsed.speech,
    totalLatencyMs: completedAt - startedAt,
  });
}

export function npcDialogResponseFormat(
  request: NpcDialogRequest,
): NonNullable<ChatCompletionParams["response_format"]> {
  const kinds = [NPC_DIALOG_NO_ACTION, ...request.intentDefinitions.map(({ kind }) => kind)];
  const subjects = [
    NPC_DIALOG_NO_SUBJECT,
    ...new Set(request.intentDefinitions.flatMap(({ subjects: values }) => values)),
  ];
  return {
    json_schema: {
      name: "parallax_npc_dialog_turn",
      schema: {
        additionalProperties: false,
        properties: {
          intent: { enum: kinds, type: "string" },
          speech: { maxLength: 2_048, minLength: 1, type: "string" },
          subject: { enum: subjects, type: "string" },
        },
        required: ["intent", "speech", "subject"],
        type: "object",
      },
      strict: true,
    },
    type: "json_schema",
  };
}

function recordFrames(
  samples: readonly RenderFrameSample[],
  durations: number[],
  presentIntervals: number[],
): void {
  for (const sample of samples) {
    durations.push(sample.durationMs);
    if (sample.presentIntervalMs !== null) presentIntervals.push(sample.presentIntervalMs);
  }
  if (durations.length > MAXIMUM_FRAME_SAMPLES)
    durations.splice(0, durations.length - MAXIMUM_FRAME_SAMPLES);
  if (presentIntervals.length > MAXIMUM_FRAME_SAMPLES) {
    presentIntervals.splice(0, presentIntervals.length - MAXIMUM_FRAME_SAMPLES);
  }
}

function emptyFrameImpact(): NpcDialogFrameImpactTelemetry {
  return Object.freeze({
    frameDurationMaximumMs: null,
    frameDurationP95Ms: null,
    presentIntervalMaximumMs: null,
    presentIntervalP95Ms: null,
    sampleCount: 0,
  });
}

function frameImpact(
  durations: readonly number[],
  intervals: readonly number[],
): NpcDialogFrameImpactTelemetry {
  if (durations.length === 0) return emptyFrameImpact();
  return Object.freeze({
    frameDurationMaximumMs: Math.max(...durations),
    frameDurationP95Ms: percentile95(durations),
    presentIntervalMaximumMs: intervals.length === 0 ? null : Math.max(...intervals),
    presentIntervalP95Ms: intervals.length === 0 ? null : percentile95(intervals),
    sampleCount: durations.length,
  });
}

function percentile95(values: readonly number[]): number {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function freezeTelemetry(snapshot: NpcDialogTelemetrySnapshot): NpcDialogTelemetrySnapshot {
  return Object.freeze({ ...snapshot, frameImpact: Object.freeze({ ...snapshot.frameImpact }) });
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : String(error);
}

function withTimeout<T>(operation: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => reject(new Error(message)), milliseconds);
    operation.then(
      (value) => {
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export async function settleNpcDialogRuntimeCleanup(
  operation: Promise<unknown>,
  milliseconds = MODEL_CLEANUP_TIMEOUT_MS,
): Promise<void> {
  await withTimeout(
    operation.then(
      () => undefined,
      () => undefined,
    ),
    milliseconds,
    "NPC dialog runtime cleanup timed out",
  ).catch(() => undefined);
}
