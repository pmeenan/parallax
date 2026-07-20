export const MEMORY64_SPIKE_TELEMETRY_SCHEMA_VERSION = 1;
export const MEMORY64_SPIKE_COLD_SAMPLE_COUNT = 1;
export const MEMORY64_SPIKE_WARMUP_SAMPLE_COUNT = 2;
export const MEMORY64_SPIKE_MEASURED_SAMPLE_COUNT = 30;
export const MEMORY64_SPIKE_COMPILE_BATCH_ITERATIONS = 2_048;
export const MEMORY64_SPIKE_INSTANTIATE_BATCH_ITERATIONS = 32_768;
export const MEMORY64_SPIKE_KERNEL_ROUNDS = 16;
export const MEMORY64_SPIKE_PREPARE_ROUNDS = 8;
export const MEMORY64_SPIKE_PREPARED_PAGES = 1_024;
export const MEMORY64_SPIKE_HIGH_PAGES = 65_537;
export const MEMORY64_SPIKE_HIGH_ADDRESS = 0x1_0000_0000;
export const MEMORY64_SPIKE_HIGH_SENTINEL = 0x0bad_c0de;
export const MEMORY64_SPIKE_TIMEOUT_MS = 30_000;

export type Memory64SpikeVariant = "memory32" | "memory64";
export type Memory64SpikeSamplePhase = "cold" | "warmup" | "measured";

export interface Memory64SpikeSample {
  readonly checksum: number;
  readonly compileElapsedMs: number;
  readonly instantiateElapsedMs: number;
  readonly kernelElapsedMs: number;
  readonly logicalMemoryBytes: number;
  readonly ordinal: number;
  readonly phase: Memory64SpikeSamplePhase;
  readonly prepareElapsedMs: number;
}

export interface Memory64SpikeVariantTelemetry {
  readonly fetchElapsedMs: number;
  readonly moduleBytes: number;
  readonly samples: readonly Memory64SpikeSample[];
  readonly variant: Memory64SpikeVariant;
}

export interface Memory64SpikeHighAddressTelemetry {
  readonly address: number;
  readonly growAndTouchElapsedMs: number;
  readonly logicalMemoryBytes: number;
  readonly pages: number;
  readonly sentinelRead: number;
  readonly sentinelReturned: number;
  readonly sentinelWritten: number;
}

export interface Memory64SpikeTelemetrySnapshot {
  readonly coldSampleCount: number;
  readonly compileBatchIterations: number;
  readonly failureMessage: string | null;
  readonly highAddress: Memory64SpikeHighAddressTelemetry | null;
  readonly instantiateBatchIterations: number;
  readonly kernelRounds: number;
  readonly measuredSampleCount: number;
  readonly memory32: Memory64SpikeVariantTelemetry | null;
  readonly memory64: Memory64SpikeVariantTelemetry | null;
  readonly prepareRounds: number;
  readonly schemaVersion: typeof MEMORY64_SPIKE_TELEMETRY_SCHEMA_VERSION;
  readonly state: "idle" | "running" | "completed" | "failed";
  readonly totalElapsedMs: number | null;
  readonly warmupSampleCount: number;
}

export interface Memory64SpikeRunRequest {
  readonly kind: "run";
  readonly memory32Url: string;
  readonly memory64Url: string;
  readonly workerUrl: string;
}

export type Memory64SpikeWorkerResponse =
  | Readonly<{
      readonly failureMessage: string;
      readonly kind: "failure";
    }>
  | Readonly<{
      readonly highAddress: Memory64SpikeHighAddressTelemetry;
      readonly kind: "completed";
      readonly memory32: Memory64SpikeVariantTelemetry;
      readonly memory64: Memory64SpikeVariantTelemetry;
      readonly totalElapsedMs: number;
    }>;
