import {
  fillSabSpikeRecord,
  SAB_SPIKE_CAPACITY_RECORDS,
  SAB_SPIKE_MESSAGE_COUNT,
  SAB_SPIKE_RECORD_WORDS,
  SAB_SPIKE_TIMEOUT_MS,
  type SabRingBufferSpikeConfig,
  type SabRingBufferSpikeTelemetrySnapshot,
  type SabRingBufferSpikeWorkerResult,
  sabSpikeRecordIsValid,
} from "./sab-ring-buffer-spike-protocol";
import { createSpscRingBuffer } from "./spsc-ring-buffer";

const MAIN_PUMP_MAX_OPERATIONS = 512;
const MAIN_PUMP_TIME_SLICE_MS = 2;

export interface SabRingBufferSpike {
  readonly config: SabRingBufferSpikeConfig;
  dispose(): void;
  failFromWorker(message: string): void;
  handleWorkerResult(result: SabRingBufferSpikeWorkerResult): void;
  snapshot(): SabRingBufferSpikeTelemetrySnapshot;
  start(): void;
}

export function createSabRingBufferSpike(
  publish: (snapshot: SabRingBufferSpikeTelemetrySnapshot) => void,
): SabRingBufferSpike {
  const commandRing = createSpscRingBuffer(SAB_SPIKE_CAPACITY_RECORDS, SAB_SPIKE_RECORD_WORDS);
  const responseRing = createSpscRingBuffer(SAB_SPIKE_CAPACITY_RECORDS, SAB_SPIKE_RECORD_WORDS);
  const config: SabRingBufferSpikeConfig = Object.freeze({
    commandRing: commandRing.descriptor,
    messageCount: SAB_SPIKE_MESSAGE_COUNT,
    responseRing: responseRing.descriptor,
  });
  let telemetry: SabRingBufferSpikeTelemetrySnapshot = freezeTelemetry({
    capacityRecords: SAB_SPIKE_CAPACITY_RECORDS,
    elapsedMs: null,
    failureMessage: null,
    mainConsumerEmptyPolls: 0,
    mainProducerStalls: 0,
    mainPumpMaxDurationMs: 0,
    messageCount: SAB_SPIKE_MESSAGE_COUNT,
    cooperativeRoundTripsPerSecond: null,
    payloadErrors: 0,
    recordWords: SAB_SPIKE_RECORD_WORDS,
    responsesReceived: 0,
    state: "pending",
    totalSABBytes: commandRing.byteLength + responseRing.byteLength,
    workerElapsedMs: null,
    workerConcurrentFrameCount: 0,
    workerConcurrentFrameIntervalMaxMs: null,
    workerConcurrentRenderDurationMaxMs: null,
    workerInboundWaits: 0,
    workerOutboundStalls: 0,
    workerSequenceErrors: 0,
  });
  let startedAt: number | null = null;
  let sent = 0;
  let received = 0;
  let mainProducerStalls = 0;
  let mainConsumerEmptyPolls = 0;
  let mainPumpMaxDurationMs = 0;
  let payloadErrors = 0;
  let workerResult: SabRingBufferSpikeWorkerResult | null = null;
  let pumpTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  const outgoing = new Int32Array(SAB_SPIKE_RECORD_WORDS);
  const incoming = new Int32Array(SAB_SPIKE_RECORD_WORDS);

  const update = (
    next: Partial<Omit<SabRingBufferSpikeTelemetrySnapshot, "state">> &
      Pick<SabRingBufferSpikeTelemetrySnapshot, "state">,
  ): void => {
    telemetry = freezeTelemetry({ ...telemetry, ...next });
    publish(telemetry);
  };

  const fail = (message: string): void => {
    if (disposed || telemetry.state === "completed" || telemetry.state === "failed") return;
    if (pumpTimer !== null) clearTimeout(pumpTimer);
    pumpTimer = null;
    update({
      failureMessage: message,
      mainConsumerEmptyPolls,
      mainProducerStalls,
      mainPumpMaxDurationMs,
      payloadErrors,
      responsesReceived: received,
      state: "failed",
    });
  };

  const finishIfComplete = (): boolean => {
    if (received !== SAB_SPIKE_MESSAGE_COUNT || workerResult === null) return false;
    if (startedAt === null) {
      throw new Error("SAB ring-buffer spike completed before it started");
    }
    const elapsedMs = performance.now() - startedAt;
    const failed =
      payloadErrors > 0 ||
      workerResult.payloadErrors > 0 ||
      workerResult.sequenceErrors > 0 ||
      workerResult.messagesProcessed !== SAB_SPIKE_MESSAGE_COUNT;
    update({
      elapsedMs,
      failureMessage: failed ? "SAB ring-buffer spike detected record corruption" : null,
      mainConsumerEmptyPolls,
      mainProducerStalls,
      mainPumpMaxDurationMs,
      cooperativeRoundTripsPerSecond: (SAB_SPIKE_MESSAGE_COUNT * 1_000) / elapsedMs,
      payloadErrors: payloadErrors + workerResult.payloadErrors,
      responsesReceived: received,
      state: failed ? "failed" : "completed",
      workerElapsedMs: workerResult.elapsedMs,
      workerConcurrentFrameCount: workerResult.concurrentFrameCount,
      workerConcurrentFrameIntervalMaxMs: workerResult.concurrentFrameIntervalMaxMs,
      workerConcurrentRenderDurationMaxMs: workerResult.concurrentRenderDurationMaxMs,
      workerInboundWaits: workerResult.inboundWaits,
      workerOutboundStalls: workerResult.outboundStalls,
      workerSequenceErrors: workerResult.sequenceErrors,
    });
    pumpTimer = null;
    return true;
  };

  const pump = (): void => {
    pumpTimer = null;
    if (disposed || telemetry.state !== "running" || startedAt === null) return;
    try {
      if (performance.now() - startedAt > SAB_SPIKE_TIMEOUT_MS) {
        fail(`SAB ring-buffer spike exceeded ${SAB_SPIKE_TIMEOUT_MS} ms`);
        return;
      }
      const sliceStartedAt = performance.now();
      let operations = 0;
      let readProgress = false;
      while (
        operations < MAIN_PUMP_MAX_OPERATIONS &&
        performance.now() - sliceStartedAt < MAIN_PUMP_TIME_SLICE_MS
      ) {
        if (responseRing.tryRead(incoming)) {
          readProgress = true;
          if (incoming[0] !== received || !sabSpikeRecordIsValid(incoming)) payloadErrors += 1;
          received += 1;
          operations += 1;
          continue;
        }
        if (sent < SAB_SPIKE_MESSAGE_COUNT) {
          fillSabSpikeRecord(outgoing, sent);
          if (commandRing.tryWrite(outgoing)) {
            sent += 1;
            operations += 1;
            continue;
          }
          mainProducerStalls += 1;
        }
        break;
      }
      if (!readProgress && received < sent) mainConsumerEmptyPolls += 1;
      mainPumpMaxDurationMs = Math.max(mainPumpMaxDurationMs, performance.now() - sliceStartedAt);
      if (!finishIfComplete()) pumpTimer = setTimeout(pump, 0);
    } catch (error: unknown) {
      fail(error instanceof Error ? error.message : String(error));
    }
  };

  return Object.freeze({
    config,

    dispose(): void {
      disposed = true;
      if (pumpTimer !== null) clearTimeout(pumpTimer);
      pumpTimer = null;
    },

    failFromWorker(message: string): void {
      fail(message);
    },

    handleWorkerResult(result: SabRingBufferSpikeWorkerResult): void {
      if (disposed || workerResult !== null || telemetry.state === "failed") return;
      workerResult = Object.freeze({ ...result });
      finishIfComplete();
    },

    snapshot(): SabRingBufferSpikeTelemetrySnapshot {
      return telemetry;
    },

    start(): void {
      if (disposed || telemetry.state !== "pending") return;
      startedAt = performance.now();
      update({ state: "running" });
      if (disposed) return;
      pumpTimer = setTimeout(pump, 0);
    },
  });
}

function freezeTelemetry(
  telemetry: SabRingBufferSpikeTelemetrySnapshot,
): SabRingBufferSpikeTelemetrySnapshot {
  return Object.freeze(telemetry);
}
