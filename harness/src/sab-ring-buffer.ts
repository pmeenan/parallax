import type { SabRingBufferSpikeTelemetrySnapshot } from "@parallax/engine";
import {
  SMOKE_SAB_CAPACITY_RECORDS,
  SMOKE_SAB_MESSAGE_COUNT,
  SMOKE_SAB_RECORD_WORDS,
  SMOKE_SAB_TOTAL_BYTES,
} from "./runs/smoke.js";

export type SabRingBufferMetric =
  | Readonly<{ readonly state: "measured"; readonly value: SabRingBufferSpikeTelemetrySnapshot }>
  | Readonly<{ readonly reason: string; readonly state: "invalid" }>;

export function resolveSabRingBufferMetric(input: unknown): SabRingBufferMetric {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return Object.freeze({
      reason: "SAB ring-buffer spike telemetry is not an object",
      state: "invalid",
    });
  }
  const snapshot = input as SabRingBufferSpikeTelemetrySnapshot;
  if (snapshot.state !== "completed") {
    return Object.freeze({
      reason:
        snapshot.failureMessage ??
        `SAB ring-buffer spike did not complete; observed state ${snapshot.state}`,
      state: "invalid",
    });
  }
  if (
    snapshot.messageCount !== SMOKE_SAB_MESSAGE_COUNT ||
    snapshot.responsesReceived !== SMOKE_SAB_MESSAGE_COUNT ||
    snapshot.capacityRecords !== SMOKE_SAB_CAPACITY_RECORDS ||
    snapshot.recordWords !== SMOKE_SAB_RECORD_WORDS ||
    snapshot.totalSABBytes !== SMOKE_SAB_TOTAL_BYTES ||
    snapshot.payloadErrors !== 0 ||
    snapshot.workerSequenceErrors !== 0 ||
    snapshot.failureMessage !== null ||
    !positiveFinite(snapshot.elapsedMs) ||
    !positiveFinite(snapshot.cooperativeRoundTripsPerSecond) ||
    !rateMatchesElapsed(
      snapshot.messageCount,
      snapshot.elapsedMs,
      snapshot.cooperativeRoundTripsPerSecond,
    ) ||
    !positiveFinite(snapshot.workerElapsedMs) ||
    !nonNegativeFinite(snapshot.mainPumpMaxDurationMs) ||
    !nonNegativeSafeInteger(snapshot.mainConsumerEmptyPolls) ||
    !nonNegativeSafeInteger(snapshot.mainProducerStalls) ||
    !nonNegativeSafeInteger(snapshot.workerInboundWaits) ||
    !nonNegativeSafeInteger(snapshot.workerOutboundStalls) ||
    !positiveSafeInteger(snapshot.workerConcurrentFrameCount) ||
    !positiveFinite(snapshot.workerConcurrentFrameIntervalMaxMs) ||
    !nonNegativeFinite(snapshot.workerConcurrentRenderDurationMaxMs)
  ) {
    return Object.freeze({
      reason: "SAB ring-buffer spike completed with missing or invalid correctness evidence",
      state: "invalid",
    });
  }
  return Object.freeze({ state: "measured", value: Object.freeze({ ...snapshot }) });
}

export function requireSabRingBufferCompleteAtMeasurementBoundary(
  snapshot: unknown,
): SabRingBufferMetric & Readonly<{ readonly state: "measured" }> {
  const metric = resolveSabRingBufferMetric(snapshot);
  if (metric.state !== "measured") {
    throw new Error(`SAB transport was not complete at the measurement boundary: ${metric.reason}`);
  }
  return metric;
}

function positiveFinite(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function nonNegativeFinite(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0;
}

function nonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function rateMatchesElapsed(messageCount: number, elapsedMs: number, rate: number): boolean {
  const expected = (messageCount * 1_000) / elapsedMs;
  return Math.abs(rate - expected) <= expected * 1e-9;
}
