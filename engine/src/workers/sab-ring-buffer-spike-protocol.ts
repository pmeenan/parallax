import type { SpscRingBufferDescriptor } from "./spsc-ring-buffer";

// These values define the engine-produced workload. smoke@1 intentionally pins
// independent copies: changing this contract must make the old metric set fail closed
// until the harness expectation and metric-set version advance deliberately.
export const SAB_SPIKE_CAPACITY_RECORDS = 256;
export const SAB_SPIKE_MESSAGE_COUNT = 100_000;
export const SAB_SPIKE_RECORD_WORDS = 4;
export const SAB_SPIKE_TIMEOUT_MS = 10_000;

const PAYLOAD_SEED = 0x5a17_c9e3;
const PAYLOAD_MULTIPLIER = 0x9e37_79b1;
const PAYLOAD_CHECK = 0x6d2b_79f5;

export interface SabRingBufferSpikeConfig {
  readonly commandRing: SpscRingBufferDescriptor;
  readonly messageCount: number;
  readonly responseRing: SpscRingBufferDescriptor;
}

export interface SabRingBufferSpikeWorkerResult {
  readonly concurrentFrameCount: number;
  readonly concurrentFrameIntervalMaxMs: number | null;
  readonly concurrentRenderDurationMaxMs: number | null;
  readonly elapsedMs: number;
  readonly inboundWaits: number;
  readonly kind: "sab-ring-buffer-spike-result";
  readonly messagesProcessed: number;
  readonly outboundStalls: number;
  readonly payloadErrors: number;
  readonly sequenceErrors: number;
}

export interface SabRingBufferSpikeWorkerFailure {
  readonly kind: "sab-ring-buffer-spike-failure";
  readonly message: string;
}

export type SabRingBufferSpikeWorkerResponse =
  | SabRingBufferSpikeWorkerFailure
  | SabRingBufferSpikeWorkerResult;

export interface SabRingBufferSpikeTelemetrySnapshot {
  readonly capacityRecords: number;
  readonly elapsedMs: number | null;
  readonly failureMessage: string | null;
  readonly mainConsumerEmptyPolls: number;
  readonly mainProducerStalls: number;
  readonly mainPumpMaxDurationMs: number;
  readonly messageCount: number;
  readonly cooperativeRoundTripsPerSecond: number | null;
  readonly payloadErrors: number;
  readonly recordWords: number;
  readonly responsesReceived: number;
  readonly state: "pending" | "running" | "completed" | "failed";
  readonly totalSABBytes: number;
  readonly workerElapsedMs: number | null;
  readonly workerConcurrentFrameCount: number;
  readonly workerConcurrentFrameIntervalMaxMs: number | null;
  readonly workerConcurrentRenderDurationMaxMs: number | null;
  readonly workerInboundWaits: number;
  readonly workerOutboundStalls: number;
  readonly workerSequenceErrors: number;
}

export function fillSabSpikeRecord(record: Int32Array, sequence: number): void {
  const first = sequence | 0;
  const second = (first ^ PAYLOAD_SEED) | 0;
  const third = Math.imul(first, PAYLOAD_MULTIPLIER);
  record[0] = first;
  record[1] = second;
  record[2] = third;
  record[3] = (first ^ second ^ third ^ PAYLOAD_CHECK) | 0;
}

export function sabSpikeRecordIsValid(record: Int32Array): boolean {
  const sequence = record[0];
  if (sequence === undefined) return false;
  const second = (sequence ^ PAYLOAD_SEED) | 0;
  const third = Math.imul(sequence, PAYLOAD_MULTIPLIER);
  return (
    record[1] === second &&
    record[2] === third &&
    record[3] === ((sequence ^ second ^ third ^ PAYLOAD_CHECK) | 0)
  );
}
