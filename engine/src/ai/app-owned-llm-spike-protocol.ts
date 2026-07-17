export const APP_OWNED_LLM_SPIKE_TELEMETRY_SCHEMA_VERSION = 2;
export const APP_OWNED_LLM_MODEL_ID = "onnx-community/gemma-4-E2B-it-qat-mobile-ONNX";
export const APP_OWNED_LLM_MODEL_REVISION = "5cd5514efd375abf2801c856a3936b259cc00133";
export const APP_OWNED_LLM_MODEL_DTYPE = "q2f16";

export interface AppOwnedLlmMessage {
  readonly content: string;
  readonly role: "assistant" | "system" | "user";
}

export interface AppOwnedLlmValidationSpec {
  readonly allowedIntents?: readonly string[];
  readonly forbiddenPhrases?: readonly string[];
  readonly requiredJsonKeys?: readonly string[];
  readonly requiredPhrases?: readonly string[];
}

export interface AppOwnedLlmFixtureCase {
  readonly id: string;
  readonly kind: "context" | "latency" | "quality" | "structured";
  readonly maxNewTokens: number;
  readonly messages: readonly AppOwnedLlmMessage[];
  readonly repetitions: number;
  readonly validation?: AppOwnedLlmValidationSpec;
}

export interface AppOwnedLlmFixtureSet {
  readonly cases: readonly AppOwnedLlmFixtureCase[];
  readonly id: string;
  readonly version: 1;
}

export interface AppOwnedLlmModelArtifact {
  readonly bytes: number;
  readonly path: string;
  readonly sha256: string;
}

export const APP_OWNED_LLM_MODEL_ARTIFACTS: readonly AppOwnedLlmModelArtifact[] = Object.freeze([
  Object.freeze({
    bytes: 17_336,
    path: "chat_template.jinja",
    sha256: "2f1b4d75d067bae3fe44e676721c7f077d243bc007156cb9c2f8b5836613d082",
  }),
  Object.freeze({
    bytes: 6_673,
    path: "config.json",
    sha256: "2387efbdf9d703a03f5e18f5de054eaff7956bb9dbce392bc576e38974f93654",
  }),
  Object.freeze({
    bytes: 5_491,
    path: "onnx/embed_tokens_q2f16.onnx",
    sha256: "ee1b97a04187ba19a23a8ca1761bcd5f241e37ef9ed29ccedb4c1f15e54ec114",
  }),
  Object.freeze({
    bytes: 1_296_564_224,
    path: "onnx/embed_tokens_q2f16.onnx_data",
    sha256: "a4e548ba02cabd151b9aea983c0338d8ce80b34b00a02a17a3fff50509f03076",
  }),
  Object.freeze({
    bytes: 807_184,
    path: "onnx/decoder_model_merged_q2f16.onnx",
    sha256: "c0e72ee12b6715bc968621a09ee695e232f6e5f1190f4fae6d02ba2c5319ddee",
  }),
  Object.freeze({
    bytes: 994_621_440,
    path: "onnx/decoder_model_merged_q2f16.onnx_data",
    sha256: "9b9e8d541335ccdd0226c697882a84a1cb77ac2726ce097e5847589b1e632bcc",
  }),
  Object.freeze({
    bytes: 209,
    path: "generation_config.json",
    sha256: "fb53f4c64e58896a63472e8eb304397db4a39453e1da0f5d57625ec5a8c1050e",
  }),
  Object.freeze({
    bytes: 32_169_626,
    path: "tokenizer.json",
    sha256: "cc8d3a0ce36466ccc1278bf987df5f71db1719b9ca6b4118264f45cb627bfe0f",
  }),
  Object.freeze({
    bytes: 2_095,
    path: "tokenizer_config.json",
    sha256: "68e2ea668d2b18a3c9b2868cccc1911e3c3b432c8f786557b17f164b346d9667",
  }),
]);

export const APP_OWNED_LLM_MODEL_INSTALL_BYTES = APP_OWNED_LLM_MODEL_ARTIFACTS.reduce(
  (total, artifact) => total + artifact.bytes,
  0,
);

export const APP_OWNED_LLM_WASM_MODEL_ID = "onnx-community/gemma-4-E2B-it-ONNX";
export const APP_OWNED_LLM_WASM_MODEL_REVISION = "9f4bef82ea6e296bc69f8a2f5939f73af81b07a6";
export const APP_OWNED_LLM_WASM_MODEL_DTYPE = "q4";
export const APP_OWNED_LLM_WASM_MODEL_ARTIFACTS: readonly AppOwnedLlmModelArtifact[] =
  Object.freeze([
    Object.freeze({
      bytes: 16_317,
      path: "chat_template.jinja",
      sha256: "781d10940fbc44be40064b5d43a056fc486c84ceaa55538226368b57314132bf",
    }),
    Object.freeze({
      bytes: 5_549,
      path: "config.json",
      sha256: "5494e6677d9e150ea20ba3101ae8a32b0f141004626f052725d8bf48991b9faa",
    }),
    Object.freeze({
      bytes: 647_599,
      path: "onnx/decoder_model_merged_q4.onnx",
      sha256: "c6edb929bf342c524728d37efd400285ee71525e8fe64ff996341f78c3e577d2",
    }),
    Object.freeze({
      bytes: 1_864_102_912,
      path: "onnx/decoder_model_merged_q4.onnx_data",
      sha256: "b879fe4b946c9b9ff6acb60f7c5eda3d2c9c4df8625895feb2d1e269002f0345",
    }),
    Object.freeze({
      bytes: 5_142,
      path: "onnx/embed_tokens_q4.onnx",
      sha256: "2d8c8a2bcc30e8ded7f636967c2a58a346116583356dd933720b005fc88079c4",
    }),
    Object.freeze({
      bytes: 1_762_656_256,
      path: "onnx/embed_tokens_q4.onnx_data",
      sha256: "40fa957d9988b8a0160c8b0eb5c3f781a237627e9f7153f30514a4ffb2e62888",
    }),
    Object.freeze({
      bytes: 238,
      path: "generation_config.json",
      sha256: "e6a0b50de21a511f15ac4857b7f227f68ee60ecb1f11255d07b75e0bdc60e155",
    }),
    Object.freeze({
      bytes: 19_439_251,
      path: "tokenizer.json",
      sha256: "47bd35616c7c782aaca6ccf48c75f3461d5877170984b8836b375107d0a9f566",
    }),
    Object.freeze({
      bytes: 18_807,
      path: "tokenizer_config.json",
      sha256: "06afbf54e228050cba79c4a0afd83543cc89070a2d62b8337d0aa8b4cdc348c3",
    }),
  ]);
export const APP_OWNED_LLM_WASM_MODEL_INSTALL_BYTES = APP_OWNED_LLM_WASM_MODEL_ARTIFACTS.reduce(
  (total, artifact) => total + artifact.bytes,
  0,
);

export const APP_OWNED_LLM_WLLAMA_MODEL_ID = "unsloth/gemma-4-E2B-it-qat-GGUF";
export const APP_OWNED_LLM_WLLAMA_MODEL_REVISION = "66a399f68ddd113b06dff02fca9523e55465d11d";
export const APP_OWNED_LLM_WLLAMA_MODEL_DTYPE = "UD-Q4_K_XL (QAT-derived GGUF)";
export const APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS: readonly AppOwnedLlmModelArtifact[] =
  Object.freeze([
    Object.freeze({
      bytes: 23_532_320,
      path: "gemma-4-E2B-it-qat-UD-Q4_K_XL-split-00001-of-00005.gguf",
      sha256: "ff074d7cae3cbda06f7a32b6d42c206bf88c2bee84c9d6165a0937ec2b61958d",
    }),
    Object.freeze({
      bytes: 1_321_205_952,
      path: "gemma-4-E2B-it-qat-UD-Q4_K_XL-split-00002-of-00005.gguf",
      sha256: "1c5368744032e95ba212561c1985cd8017de6fd165fef1f648528e0be265d4a8",
    }),
    Object.freeze({
      bytes: 508_734_272,
      path: "gemma-4-E2B-it-qat-UD-Q4_K_XL-split-00003-of-00005.gguf",
      sha256: "f8c3b5b6f05090ef292ed643357fed6b1df5381d0a21e11d3515580af3ef48f3",
    }),
    Object.freeze({
      bytes: 510_543_744,
      path: "gemma-4-E2B-it-qat-UD-Q4_K_XL-split-00004-of-00005.gguf",
      sha256: "ca3403a90060fc56b92e6b35acb0090eebb8b7eb11c4919536ba645f4d45c461",
    }),
    Object.freeze({
      bytes: 256_355_264,
      path: "gemma-4-E2B-it-qat-UD-Q4_K_XL-split-00005-of-00005.gguf",
      sha256: "30c5c95b427827e9f1993f7df2e4d6cbdea2354811ab5dcafd6db41190cfb9f9",
    }),
  ]);
export const APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES = APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.reduce(
  (total, artifact) => total + artifact.bytes,
  0,
);

export interface AppOwnedLlmCacheTelemetry {
  readonly expectedArtifacts: number;
  readonly hitArtifacts: number;
  readonly integrityFailures: number;
  readonly missArtifacts: number;
  readonly readBytes: number;
  readonly readElapsedMs: number;
  readonly verifiedArtifacts: number;
  readonly writeBytes: number;
  readonly writeElapsedMs: number;
}

export interface AppOwnedLlmGenerationTelemetry {
  readonly firstTokenLatencyMs: number;
  readonly fixtureId: string;
  readonly inputTokens: number;
  readonly kind: AppOwnedLlmFixtureCase["kind"];
  readonly longestTokenGapMs: number;
  readonly output: string;
  readonly outputTokens: number;
  readonly repetition: number;
  readonly schemaValid: boolean | null;
  readonly semanticValidationFailures: readonly string[];
  readonly tokensPerSecond: number;
  readonly totalLatencyMs: number;
}

export type AppOwnedLlmInferenceDevice = "wasm" | "webgpu" | "wllama-wasm" | "wllama-webgpu";

export interface AppOwnedLlmDeviceTopologyTelemetry {
  readonly inferenceDevice:
    | "dedicated-worker-own-webgpu-device"
    | "dedicated-worker-wasm-cpu"
    | "nested-wllama-worker-own-webgpu-device"
    | "nested-wllama-worker-wasm-cpu";
  readonly renderDevice: "render-worker-own-device";
  readonly sharedDevice: Readonly<{
    readonly reason: string;
    readonly state: "unsupported";
  }>;
}

export type AppOwnedLlmSpikeState =
  | "idle"
  | "loading-model"
  | "warming-up"
  | "running"
  | "completed"
  | "failed"
  | "disposed";

export interface AppOwnedLlmSpikeTelemetrySnapshot {
  readonly activeFixtureId: string | null;
  readonly cache: AppOwnedLlmCacheTelemetry;
  readonly deviceTopology: AppOwnedLlmDeviceTopologyTelemetry;
  readonly failureMessage: string | null;
  readonly fixtureSetId: string | null;
  readonly generations: readonly AppOwnedLlmGenerationTelemetry[];
  readonly loadElapsedMs: number | null;
  readonly loadSource: "mixed" | "opfs" | "remote-install" | null;
  readonly modelDtype: string;
  readonly modelId: string;
  readonly modelInstallBytes: number;
  readonly modelRevision: string;
  readonly progress: number;
  readonly runtime: "transformers.js-onnx-runtime" | "wllama-llama.cpp";
  readonly schemaVersion: typeof APP_OWNED_LLM_SPIKE_TELEMETRY_SCHEMA_VERSION;
  readonly state: AppOwnedLlmSpikeState;
  readonly warmupElapsedMs: number | null;
}

export interface AppOwnedLlmWorkerStartRequest {
  readonly device: AppOwnedLlmInferenceDevice;
  readonly fixtureSet: AppOwnedLlmFixtureSet;
  readonly kind: "start";
  readonly modelUrl?: string;
}

export type AppOwnedLlmWorkerRequest = AppOwnedLlmWorkerStartRequest;

export type AppOwnedLlmWorkerResponse =
  | Readonly<{
      readonly kind: "telemetry";
      readonly snapshot: AppOwnedLlmSpikeTelemetrySnapshot;
    }>
  | Readonly<{
      readonly kind: "failure";
      readonly message: string;
    }>;

export function createInitialAppOwnedLlmTelemetry(): AppOwnedLlmSpikeTelemetrySnapshot {
  return Object.freeze({
    activeFixtureId: null,
    cache: Object.freeze({
      expectedArtifacts: APP_OWNED_LLM_MODEL_ARTIFACTS.length,
      hitArtifacts: 0,
      integrityFailures: 0,
      missArtifacts: 0,
      readBytes: 0,
      readElapsedMs: 0,
      verifiedArtifacts: 0,
      writeBytes: 0,
      writeElapsedMs: 0,
    }),
    deviceTopology: Object.freeze({
      inferenceDevice: "dedicated-worker-own-webgpu-device",
      renderDevice: "render-worker-own-device",
      sharedDevice: Object.freeze({
        reason:
          "GPUDevice is realm-owned; a shared variant requires inference in the render worker and explicit Babylon-to-ONNX device injection",
        state: "unsupported",
      }),
    }),
    failureMessage: null,
    fixtureSetId: null,
    generations: Object.freeze([]),
    loadElapsedMs: null,
    loadSource: null,
    modelDtype: APP_OWNED_LLM_MODEL_DTYPE,
    modelId: APP_OWNED_LLM_MODEL_ID,
    modelInstallBytes: APP_OWNED_LLM_MODEL_INSTALL_BYTES,
    modelRevision: APP_OWNED_LLM_MODEL_REVISION,
    progress: 0,
    runtime: "transformers.js-onnx-runtime",
    schemaVersion: APP_OWNED_LLM_SPIKE_TELEMETRY_SCHEMA_VERSION,
    state: "idle",
    warmupElapsedMs: null,
  });
}
