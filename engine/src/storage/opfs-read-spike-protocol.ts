export const OPFS_SPIKE_FILE_BYTES = 64 * 1024 * 1024;
export const OPFS_SPIKE_RANDOM_BATCH_READS = 256;
export const OPFS_SPIKE_RANDOM_READ_BYTES = 64 * 1024;
export const OPFS_SPIKE_RANDOM_READS = 4_096;
export const OPFS_SPIKE_SEQUENTIAL_READ_BYTES = 1024 * 1024;
export const OPFS_SPIKE_SEQUENTIAL_PASSES = 12;
export const OPFS_SPIKE_TIMEOUT_MS = 15_000;

export interface OpfsReadSpikeConfig {
  readonly fileBytes: number;
  readonly randomBatchReads: number;
  readonly randomReadBytes: number;
  readonly randomReads: number;
  readonly sequentialPasses: number;
  readonly sequentialReadBytes: number;
}

export interface OpfsReadBatchTelemetry {
  readonly bytesRead: number;
  readonly operations: number;
  readonly readCallElapsedMs: number;
  readonly wallElapsedMs: number;
}

export interface OpfsReadPhaseTelemetry {
  readonly batches: readonly OpfsReadBatchTelemetry[];
  readonly bytesRead: number;
  readonly operations: number;
  readonly readCallElapsedMs: number;
  readonly readCallThroughputBytesPerSecond: number;
  readonly validationErrors: number;
  readonly wallElapsedMs: number;
  readonly wallThroughputBytesPerSecond: number;
}

export interface OpfsReadSpikeWorkerResult {
  readonly fileBytes: number;
  readonly fileReused: boolean;
  readonly kind: "opfs-read-spike-result";
  readonly provisioningBytesWritten: number;
  readonly provisioningElapsedMs: number;
  readonly random: OpfsReadPhaseTelemetry;
  readonly sequential: OpfsReadPhaseTelemetry;
}

export interface OpfsReadSpikeWorkerFailure {
  readonly kind: "opfs-read-spike-failure";
  readonly message: string;
}

export type OpfsReadSpikeWorkerResponse = OpfsReadSpikeWorkerFailure | OpfsReadSpikeWorkerResult;

export interface OpfsReadSpikeTelemetrySnapshot {
  readonly failureMessage: string | null;
  readonly fileBytes: number;
  readonly fileReused: boolean | null;
  readonly provisioningBytesWritten: number | null;
  readonly provisioningElapsedMs: number | null;
  readonly random: OpfsReadPhaseTelemetry | null;
  readonly sequential: OpfsReadPhaseTelemetry | null;
  readonly state: "idle" | "running" | "completed" | "failed" | "disposed";
}

export function createOpfsReadSpikeConfig(): OpfsReadSpikeConfig {
  return Object.freeze({
    fileBytes: OPFS_SPIKE_FILE_BYTES,
    randomBatchReads: OPFS_SPIKE_RANDOM_BATCH_READS,
    randomReadBytes: OPFS_SPIKE_RANDOM_READ_BYTES,
    randomReads: OPFS_SPIKE_RANDOM_READS,
    sequentialPasses: OPFS_SPIKE_SEQUENTIAL_PASSES,
    sequentialReadBytes: OPFS_SPIKE_SEQUENTIAL_READ_BYTES,
  });
}
