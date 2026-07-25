export const APP_OWNED_LLM_SPIKE_TELEMETRY_SCHEMA_VERSION = 3;

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

export type AppOwnedLlmInferenceDevice = "wllama-wasm" | "wllama-webgpu";

export interface AppOwnedLlmDeviceTopologyTelemetry {
  readonly inferenceDevice:
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
  readonly runtime: "wllama-llama.cpp";
  readonly schemaVersion: typeof APP_OWNED_LLM_SPIKE_TELEMETRY_SCHEMA_VERSION;
  readonly state: AppOwnedLlmSpikeState;
  readonly warmupElapsedMs: number | null;
}

export interface AppOwnedLlmRunRequest {
  readonly device: AppOwnedLlmInferenceDevice;
  readonly fixtureSet: AppOwnedLlmFixtureSet;
  readonly modelUrl?: string;
}

export function createInitialAppOwnedLlmTelemetry(): AppOwnedLlmSpikeTelemetrySnapshot {
  return Object.freeze({
    activeFixtureId: null,
    cache: Object.freeze({
      expectedArtifacts: APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.length,
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
      inferenceDevice: "nested-wllama-worker-own-webgpu-device",
      renderDevice: "render-worker-own-device",
      sharedDevice: Object.freeze({
        reason:
          "wllama owns its WebGPU device in a nested worker and cannot share the render device",
        state: "unsupported",
      }),
    }),
    failureMessage: null,
    fixtureSetId: null,
    generations: Object.freeze([]),
    loadElapsedMs: null,
    loadSource: null,
    modelDtype: APP_OWNED_LLM_WLLAMA_MODEL_DTYPE,
    modelId: APP_OWNED_LLM_WLLAMA_MODEL_ID,
    modelInstallBytes: APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
    modelRevision: APP_OWNED_LLM_WLLAMA_MODEL_REVISION,
    progress: 0,
    runtime: "wllama-llama.cpp",
    schemaVersion: APP_OWNED_LLM_SPIKE_TELEMETRY_SCHEMA_VERSION,
    state: "idle",
    warmupElapsedMs: null,
  });
}
