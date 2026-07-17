import {
  type Chat,
  env,
  pipeline,
  type TextGenerationPipeline,
  TextStreamer,
} from "@huggingface/transformers";
import {
  APP_OWNED_LLM_MODEL_ARTIFACTS,
  APP_OWNED_LLM_MODEL_DTYPE,
  APP_OWNED_LLM_MODEL_ID,
  APP_OWNED_LLM_MODEL_INSTALL_BYTES,
  APP_OWNED_LLM_MODEL_REVISION,
  APP_OWNED_LLM_WASM_MODEL_ARTIFACTS,
  APP_OWNED_LLM_WASM_MODEL_DTYPE,
  APP_OWNED_LLM_WASM_MODEL_ID,
  APP_OWNED_LLM_WASM_MODEL_INSTALL_BYTES,
  APP_OWNED_LLM_WASM_MODEL_REVISION,
  type AppOwnedLlmFixtureCase,
  type AppOwnedLlmGenerationTelemetry,
  type AppOwnedLlmSpikeTelemetrySnapshot,
  type AppOwnedLlmWorkerRequest,
  type AppOwnedLlmWorkerResponse,
  createInitialAppOwnedLlmTelemetry,
} from "../ai/app-owned-llm-spike-protocol";
import { createOpfsModelCache } from "../ai/opfs-model-cache";

interface AiWorkerScope {
  onmessage: ((event: MessageEvent<AppOwnedLlmWorkerRequest>) => void) | null;
  postMessage(message: AppOwnedLlmWorkerResponse): void;
}

const workerScope = globalThis as unknown as AiWorkerScope;
let started = false;
let telemetry = createInitialAppOwnedLlmTelemetry();

workerScope.onmessage = (event): void => {
  if (started) {
    postFailure("AI worker received more than one start request");
    return;
  }
  started = true;
  void runSpike(event.data).catch((error: unknown) => {
    postFailure(describeError(error));
  });
};

async function runSpike(request: AppOwnedLlmWorkerRequest): Promise<void> {
  validateFixtureSet(request.fixtureSet.cases);
  if (request.device === "wllama-wasm" || request.device === "wllama-webgpu") {
    throw new Error(
      "wllama's controller is window-bound; the app-owned service must route this request before creating the ONNX AI worker",
    );
  }
  const model =
    request.device === "wasm"
      ? Object.freeze({
          artifacts: APP_OWNED_LLM_WASM_MODEL_ARTIFACTS,
          dtype: APP_OWNED_LLM_WASM_MODEL_DTYPE,
          id: APP_OWNED_LLM_WASM_MODEL_ID,
          installBytes: APP_OWNED_LLM_WASM_MODEL_INSTALL_BYTES,
          revision: APP_OWNED_LLM_WASM_MODEL_REVISION,
        })
      : Object.freeze({
          artifacts: APP_OWNED_LLM_MODEL_ARTIFACTS,
          dtype: APP_OWNED_LLM_MODEL_DTYPE,
          id: APP_OWNED_LLM_MODEL_ID,
          installBytes: APP_OWNED_LLM_MODEL_INSTALL_BYTES,
          revision: APP_OWNED_LLM_MODEL_REVISION,
        });
  const modelBaseUrl = `https://huggingface.co/${model.id}/resolve/${model.revision}/`;
  const opfsCache = createOpfsModelCache(modelBaseUrl, model.artifacts);
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = false;
  env.useCustomCache = true;
  env.useWasmCache = true;
  env.customCache = opfsCache.cache;

  publish({
    ...telemetry,
    deviceTopology: Object.freeze({
      ...telemetry.deviceTopology,
      inferenceDevice:
        request.device === "webgpu"
          ? "dedicated-worker-own-webgpu-device"
          : "dedicated-worker-wasm-cpu",
      sharedDevice:
        request.device === "webgpu"
          ? telemetry.deviceTopology.sharedDevice
          : Object.freeze({
              reason: "WASM inference uses CPU execution and allocates no inference GPUDevice",
              state: "unsupported" as const,
            }),
    }),
    fixtureSetId: request.fixtureSet.id,
    modelDtype: model.dtype,
    modelId: model.id,
    modelInstallBytes: model.installBytes,
    modelRevision: model.revision,
    state: "loading-model",
  });
  const chatTemplate = await loadChatTemplate(opfsCache.cache, modelBaseUrl);
  const loadStartedAt = performance.now();
  let lastPublishedProgress = -1;
  const loaded = await pipeline("text-generation", model.id, {
    device: request.device,
    dtype: model.dtype,
    revision: model.revision,
    progress_callback: (update: unknown): void => {
      if (typeof update !== "object" || update === null) return;
      if (Reflect.get(update, "status") !== "progress_total") return;
      const rawProgress = Reflect.get(update, "progress");
      if (typeof rawProgress !== "number" || !Number.isFinite(rawProgress)) return;
      const progress = Math.min(1, Math.max(0, rawProgress / 100));
      if (progress !== 1 && progress - lastPublishedProgress < 0.01) return;
      lastPublishedProgress = progress;
      publish({ ...telemetry, cache: opfsCache.snapshot(), progress });
    },
  });
  const generator = loaded;
  generator.tokenizer.chat_template = chatTemplate;
  const cache = opfsCache.snapshot();
  const loadSource =
    cache.hitArtifacts === cache.expectedArtifacts
      ? "opfs"
      : cache.hitArtifacts === 0
        ? "remote-install"
        : "mixed";
  publish({
    ...telemetry,
    cache,
    loadElapsedMs: performance.now() - loadStartedAt,
    loadSource,
    progress: 1,
    state: "warming-up",
  });

  const warmupStartedAt = performance.now();
  const warmupCase = request.fixtureSet.cases[0];
  if (warmupCase === undefined) throw new Error("The fixture set is empty");
  await generator(toChat(warmupCase), {
    do_sample: false,
    max_new_tokens: 1,
    tokenizer_encode_kwargs: { enable_thinking: false },
  });
  publish({
    ...telemetry,
    state: "running",
    warmupElapsedMs: performance.now() - warmupStartedAt,
  });

  for (const fixture of request.fixtureSet.cases) {
    for (let repetition = 0; repetition < fixture.repetitions; repetition += 1) {
      publish({ ...telemetry, activeFixtureId: fixture.id });
      const generation = await runFixture(generator, fixture, repetition);
      publish({
        ...telemetry,
        activeFixtureId: null,
        generations: Object.freeze([...telemetry.generations, generation]),
      });
    }
  }
  publish({ ...telemetry, activeFixtureId: null, cache: opfsCache.snapshot(), state: "completed" });
}

async function loadChatTemplate(
  cache: Readonly<{
    match(request: string): Promise<Response | undefined>;
    put(request: string, response: Response): Promise<void>;
  }>,
  modelBaseUrl: string,
): Promise<string> {
  const request = `${modelBaseUrl}chat_template.jinja`;
  const response = await cache.match(request);
  if (response === undefined) {
    const downloaded = await fetch(request);
    if (!downloaded.ok) {
      throw new Error(`Chat template download failed with HTTP ${downloaded.status}`);
    }
    const template = await downloaded.clone().text();
    await cache.put(request, downloaded);
    return template;
  }
  return response.text();
}

async function runFixture(
  generator: TextGenerationPipeline,
  fixture: AppOwnedLlmFixtureCase,
  repetition: number,
): Promise<AppOwnedLlmGenerationTelemetry> {
  const messages = toChat(fixture);
  const inputIds = generator.tokenizer.apply_chat_template(messages, {
    add_generation_prompt: true,
    return_dict: false,
    return_tensor: false,
    tokenize: true,
    tokenizer_kwargs: { enable_thinking: false },
  });
  const startedAt = performance.now();
  let firstTokenAt: number | null = null;
  let lastTokenAt: number | null = null;
  let longestTokenGapMs = 0;
  let outputTokens = 0;
  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    token_callback_function(tokens): void {
      const observedAt = performance.now();
      firstTokenAt ??= observedAt;
      if (lastTokenAt !== null) {
        longestTokenGapMs = Math.max(longestTokenGapMs, observedAt - lastTokenAt);
      }
      lastTokenAt = observedAt;
      outputTokens += tokens.length;
    },
  });
  const result = await generator(messages, {
    do_sample: false,
    max_new_tokens: fixture.maxNewTokens,
    streamer,
    tokenizer_encode_kwargs: { enable_thinking: false },
  });
  const completedAt = performance.now();
  if (firstTokenAt === null || outputTokens === 0) {
    throw new Error(`Fixture ${fixture.id} completed without a generated token`);
  }
  const output = result[0]?.generated_text.at(-1)?.content;
  if (typeof output !== "string") {
    throw new Error(`Fixture ${fixture.id} produced no assistant text`);
  }
  const validation = validateOutput(output, fixture);
  const decodeElapsedMs = completedAt - firstTokenAt;
  return Object.freeze({
    firstTokenLatencyMs: firstTokenAt - startedAt,
    fixtureId: fixture.id,
    inputTokens: inputIds.length,
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

function toChat(fixture: AppOwnedLlmFixtureCase): Chat {
  return fixture.messages.map((message) => ({ content: message.content, role: message.role }));
}

function validateFixtureSet(cases: readonly AppOwnedLlmFixtureCase[]): void {
  if (cases.length === 0) throw new Error("App-owned LLM fixture set must not be empty");
  const ids = new Set<string>();
  for (const fixture of cases) {
    if (fixture.id === "" || ids.has(fixture.id))
      throw new Error(`Invalid fixture id ${fixture.id}`);
    ids.add(fixture.id);
    if (
      !Number.isSafeInteger(fixture.repetitions) ||
      fixture.repetitions <= 0 ||
      !Number.isSafeInteger(fixture.maxNewTokens) ||
      fixture.maxNewTokens <= 0 ||
      fixture.messages.length === 0
    ) {
      throw new Error(`Invalid fixture configuration for ${fixture.id}`);
    }
  }
}

function publish(next: AppOwnedLlmSpikeTelemetrySnapshot): void {
  telemetry = Object.freeze({
    ...next,
    cache: Object.freeze({ ...next.cache }),
    generations: Object.freeze(
      next.generations.map((generation) =>
        Object.freeze({
          ...generation,
          semanticValidationFailures: Object.freeze([...generation.semanticValidationFailures]),
        }),
      ),
    ),
  });
  workerScope.postMessage({ kind: "telemetry", snapshot: telemetry });
}

function postFailure(message: string): void {
  telemetry = Object.freeze({
    ...telemetry,
    activeFixtureId: null,
    failureMessage: message,
    state: "failed",
  });
  workerScope.postMessage({ kind: "failure", message });
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
