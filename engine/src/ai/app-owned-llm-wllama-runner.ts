import {
  type ChatCompletionChunk,
  type ChatCompletionParams,
  LoggerWithoutDebug,
  Wllama,
} from "@wllama/wllama/esm/index.js";
import {
  APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS,
  APP_OWNED_LLM_WLLAMA_MODEL_DTYPE,
  APP_OWNED_LLM_WLLAMA_MODEL_ID,
  APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
  APP_OWNED_LLM_WLLAMA_MODEL_REVISION,
  type AppOwnedLlmFixtureCase,
  type AppOwnedLlmGenerationTelemetry,
  type AppOwnedLlmRunRequest,
  type AppOwnedLlmSpikeTelemetrySnapshot,
  createInitialAppOwnedLlmTelemetry,
} from "./app-owned-llm-spike-protocol";
import { WLLAMA_WASM_ARTIFACT } from "./wllama-runtime-artifact";

export async function runWllamaSpike(
  request: AppOwnedLlmRunRequest,
  publishSnapshot: (snapshot: AppOwnedLlmSpikeTelemetrySnapshot) => void,
  signal: AbortSignal = new AbortController().signal,
): Promise<void> {
  signal.throwIfAborted();
  if (request.device !== "wllama-wasm" && request.device !== "wllama-webgpu") {
    throw new Error(`Unsupported wllama device ${request.device}`);
  }
  if (request.modelUrl === undefined || request.modelUrl === "") {
    throw new Error("The wllama spike requires an exact-manifest GGUF model URL");
  }
  let telemetry = createInitialAppOwnedLlmTelemetry();
  const publish = (next: AppOwnedLlmSpikeTelemetrySnapshot): void => {
    telemetry = next;
    publishSnapshot(next);
  };
  const isWebGpu = request.device === "wllama-webgpu";
  const initialCache = Object.freeze({
    expectedArtifacts: APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.length,
    hitArtifacts: 0,
    integrityFailures: 0,
    missArtifacts: 0,
    readBytes: 0,
    readElapsedMs: 0,
    verifiedArtifacts: 0,
    writeBytes: 0,
    writeElapsedMs: 0,
  });
  publish({
    ...telemetry,
    cache: initialCache,
    deviceTopology: Object.freeze({
      ...telemetry.deviceTopology,
      inferenceDevice: isWebGpu
        ? "nested-wllama-worker-own-webgpu-device"
        : "nested-wllama-worker-wasm-cpu",
      sharedDevice: Object.freeze({
        reason: isWebGpu
          ? "wllama owns WebGPU inside its inference worker; GPUDevice is not transferable to Babylon's render worker"
          : "wllama CPU inference uses WASM and allocates no inference GPUDevice",
        state: "unsupported" as const,
      }),
    }),
    fixtureSetId: request.fixtureSet.id,
    modelDtype: APP_OWNED_LLM_WLLAMA_MODEL_DTYPE,
    modelId: APP_OWNED_LLM_WLLAMA_MODEL_ID,
    modelInstallBytes: APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
    modelRevision: APP_OWNED_LLM_WLLAMA_MODEL_REVISION,
    runtime: "wllama-llama.cpp",
    state: "loading-model",
  });

  // wllama's controller is window-bound (`document.baseURI`), but all llama.cpp,
  // WebGPU, OPFS and pthread work stays in workers created by the library.
  const wllama = new Wllama(
    { default: WLLAMA_WASM_ARTIFACT },
    { logger: LoggerWithoutDebug, parallelDownloads: APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.length },
  );
  let failure: Readonly<{ error: unknown }> | null = null;
  try {
    const loadStartedAt = performance.now();
    let sawRemoteBytes = false;
    let lastLoaded = 0;
    let lastTotal = APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES;
    await wllama.loadModelFromUrl(request.modelUrl, {
      flash_attn: true,
      n_ctx: 8_192,
      n_gpu_layers: isWebGpu ? 99_999 : 0,
      progressCallback: ({ loaded, total }): void => {
        if (signal.aborted) return;
        if (loaded < total) sawRemoteBytes = true;
        lastLoaded = Math.max(lastLoaded, loaded);
        lastTotal = total > 0 ? total : lastTotal;
        publish({
          ...telemetry,
          progress: Math.min(1, Math.max(0, lastLoaded / lastTotal)),
        });
      },
      reasoning: false,
      signal,
      warmup: false,
    });
    signal.throwIfAborted();
    const loadElapsedMs = performance.now() - loadStartedAt;
    const cache = Object.freeze({
      ...initialCache,
      hitArtifacts: sawRemoteBytes ? 0 : initialCache.expectedArtifacts,
      missArtifacts: sawRemoteBytes ? initialCache.expectedArtifacts : 0,
      readBytes: sawRemoteBytes ? 0 : APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
      readElapsedMs: sawRemoteBytes ? 0 : loadElapsedMs,
      verifiedArtifacts: initialCache.expectedArtifacts,
      writeBytes: sawRemoteBytes ? APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES : 0,
      writeElapsedMs: sawRemoteBytes ? loadElapsedMs : 0,
    });
    publish({
      ...telemetry,
      cache,
      loadElapsedMs,
      loadSource: sawRemoteBytes ? "remote-install" : "opfs",
      progress: 1,
      state: "warming-up",
    });

    const warmupStartedAt = performance.now();
    const warmupCase = request.fixtureSet.cases[0];
    if (warmupCase === undefined) throw new Error("The fixture set is empty");
    await wllama.createChatCompletion({
      abortSignal: signal,
      chat_template_kwargs: { enable_thinking: false },
      max_tokens: 1,
      messages: warmupCase.messages.map((message) => ({ ...message })),
      seed: 0,
      temperature: 0,
    });
    signal.throwIfAborted();
    publish({
      ...telemetry,
      state: "running",
      warmupElapsedMs: performance.now() - warmupStartedAt,
    });

    for (const fixture of request.fixtureSet.cases) {
      for (let repetition = 0; repetition < fixture.repetitions; repetition += 1) {
        signal.throwIfAborted();
        publish({ ...telemetry, activeFixtureId: fixture.id });
        const generation = await runFixture(wllama, fixture, repetition, signal);
        publish({
          ...telemetry,
          activeFixtureId: null,
          generations: Object.freeze([...telemetry.generations, generation]),
        });
      }
    }
  } catch (error: unknown) {
    failure = Object.freeze({ error });
  }
  try {
    await wllama.exit();
  } catch (error: unknown) {
    if (failure === null) failure = Object.freeze({ error });
    else console.error("wllama cleanup failed after the spike had already failed", error);
  }
  if (failure !== null) throw failure.error;
  signal.throwIfAborted();
  publish({ ...telemetry, activeFixtureId: null, state: "completed" });
}

async function runFixture(
  wllama: Wllama,
  fixture: AppOwnedLlmFixtureCase,
  repetition: number,
  signal: AbortSignal,
): Promise<AppOwnedLlmGenerationTelemetry> {
  const startedAt = performance.now();
  let firstTokenAt: number | null = null;
  let lastTokenAt: number | null = null;
  let longestTokenGapMs = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let output = "";
  let contentChunks = 0;
  const responseFormat = responseFormatForFixture(fixture);
  await wllama.createChatCompletion({
    abortSignal: signal,
    chat_template_kwargs: { enable_thinking: false },
    max_tokens: fixture.maxNewTokens,
    messages: fixture.messages.map((message) => ({ ...message })),
    onData(chunk: ChatCompletionChunk): void {
      const delta = chunk.choices[0]?.delta;
      const content = delta?.content;
      if (typeof content === "string" && content !== "") {
        const observedAt = performance.now();
        contentChunks += 1;
        firstTokenAt ??= observedAt;
        if (lastTokenAt !== null) {
          longestTokenGapMs = Math.max(longestTokenGapMs, observedAt - lastTokenAt);
        }
        lastTokenAt = observedAt;
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
    return_tokens: true,
    ...(responseFormat === undefined ? {} : { response_format: responseFormat }),
    seed: 0,
    stream: true,
    temperature: 0,
    timings_per_token: true,
  });
  const completedAt = performance.now();
  outputTokens = Math.max(outputTokens, contentChunks);
  if (firstTokenAt === null || outputTokens === 0) {
    throw new Error(`Fixture ${fixture.id} completed without a generated token`);
  }
  const validation = validateOutput(output, fixture);
  const decodeElapsedMs = completedAt - firstTokenAt;
  return Object.freeze({
    firstTokenLatencyMs: firstTokenAt - startedAt,
    fixtureId: fixture.id,
    inputTokens,
    kind: fixture.kind,
    longestTokenGapMs,
    output,
    outputTokens,
    repetition,
    schemaValid: validation.schemaValid,
    semanticValidationFailures: Object.freeze(validation.failures),
    tokensPerSecond:
      decodeElapsedMs <= 0 ? 0 : (Math.max(0, outputTokens - 1) * 1_000) / decodeElapsedMs,
    totalLatencyMs: completedAt - startedAt,
  });
}

function responseFormatForFixture(
  fixture: AppOwnedLlmFixtureCase,
): ChatCompletionParams["response_format"] | undefined {
  const validation = fixture.validation;
  if (validation?.requiredJsonKeys === undefined) return undefined;
  const properties: Record<string, unknown> = {};
  for (const key of validation.requiredJsonKeys) {
    properties[key] =
      key === "intent" && validation.allowedIntents !== undefined
        ? { enum: [...validation.allowedIntents], type: "string" }
        : { type: "string" };
  }
  return {
    json_schema: {
      name: `parallax_${fixture.id.replaceAll("-", "_")}`,
      schema: {
        additionalProperties: false,
        properties,
        required: [...validation.requiredJsonKeys],
        type: "object",
      },
      strict: true,
    },
    type: "json_schema",
  };
}

function validateOutput(
  output: string,
  fixture: AppOwnedLlmFixtureCase,
): Readonly<{ failures: readonly string[]; schemaValid: boolean | null }> {
  const validation = fixture.validation;
  if (validation === undefined)
    return Object.freeze({ failures: Object.freeze([]), schemaValid: null });
  const failures: string[] = [];
  const normalized = output.toLocaleLowerCase("en-US");
  for (const phrase of validation.requiredPhrases ?? []) {
    if (!normalized.includes(phrase.toLocaleLowerCase("en-US"))) {
      failures.push(`missing required phrase: ${phrase}`);
    }
  }
  for (const phrase of validation.forbiddenPhrases ?? []) {
    if (normalized.includes(phrase.toLocaleLowerCase("en-US"))) {
      failures.push(`included forbidden phrase: ${phrase}`);
    }
  }
  let schemaValid: boolean | null = null;
  if (validation.requiredJsonKeys !== undefined) {
    schemaValid = false;
    try {
      const parsed = JSON.parse(output) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const missing = validation.requiredJsonKeys.filter((key) => !Object.hasOwn(parsed, key));
        if (missing.length === 0) {
          const intent = Reflect.get(parsed, "intent");
          schemaValid =
            validation.allowedIntents === undefined ||
            (typeof intent === "string" && validation.allowedIntents.includes(intent));
          if (!schemaValid) failures.push("intent was outside the allowed enum");
        } else {
          failures.push(`missing JSON keys: ${missing.join(", ")}`);
        }
      } else {
        failures.push("structured output was not a JSON object");
      }
    } catch {
      failures.push("structured output was not valid JSON");
    }
  }
  return Object.freeze({ failures: Object.freeze(failures), schemaValid });
}
