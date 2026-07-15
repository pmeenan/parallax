import type { SabRingBufferSpikeTelemetrySnapshot } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import {
  requireSabRingBufferCompleteAtMeasurementBoundary,
  resolveSabRingBufferMetric,
} from "./sab-ring-buffer.js";

const measuredSnapshot: SabRingBufferSpikeTelemetrySnapshot = Object.freeze({
  capacityRecords: 256,
  elapsedMs: 2_000,
  failureMessage: null,
  mainConsumerEmptyPolls: 10,
  mainProducerStalls: 20,
  mainPumpMaxDurationMs: 0.5,
  messageCount: 100_000,
  cooperativeRoundTripsPerSecond: 50_000,
  payloadErrors: 0,
  recordWords: 4,
  responsesReceived: 100_000,
  state: "completed",
  totalSABBytes: 8_224,
  workerConcurrentFrameCount: 60,
  workerConcurrentFrameIntervalMaxMs: 32,
  workerConcurrentRenderDurationMaxMs: 3,
  workerElapsedMs: 1_990,
  workerInboundWaits: 50,
  workerOutboundStalls: 2,
  workerSequenceErrors: 0,
});

describe("SAB ring-buffer smoke evidence", () => {
  it("accepts the exact completed transport contract", () => {
    expect(resolveSabRingBufferMetric(measuredSnapshot)).toMatchObject({ state: "measured" });
  });

  it("rejects incomplete or corrupt transport evidence", () => {
    expect(
      resolveSabRingBufferMetric({
        ...measuredSnapshot,
        failureMessage: "timed out",
        state: "failed",
      }),
    ).toMatchObject({ reason: "timed out", state: "invalid" });
    expect(resolveSabRingBufferMetric({ ...measuredSnapshot, payloadErrors: 1 })).toMatchObject({
      state: "invalid",
    });
    expect(
      resolveSabRingBufferMetric({ ...measuredSnapshot, responsesReceived: 99_999 }),
    ).toMatchObject({ state: "invalid" });
  });

  it("rejects shape drift and non-finite performance evidence", () => {
    expect(resolveSabRingBufferMetric({ ...measuredSnapshot, capacityRecords: 512 })).toMatchObject(
      { state: "invalid" },
    );
    expect(
      resolveSabRingBufferMetric({
        ...measuredSnapshot,
        cooperativeRoundTripsPerSecond: Number.NaN,
      }),
    ).toMatchObject({ state: "invalid" });
    expect(
      resolveSabRingBufferMetric({ ...measuredSnapshot, workerConcurrentFrameCount: 0 }),
    ).toMatchObject({ state: "invalid" });
  });

  it("accepts a zero concurrent render-duration maximum", () => {
    expect(
      resolveSabRingBufferMetric({
        ...measuredSnapshot,
        workerConcurrentRenderDurationMaxMs: 0,
      }),
    ).toMatchObject({ state: "measured" });
  });

  it("rejects malformed counters and an inconsistent round-trip rate", () => {
    const invalidCounters: readonly Partial<SabRingBufferSpikeTelemetrySnapshot>[] = [
      { mainConsumerEmptyPolls: -1 },
      { mainProducerStalls: Number.NaN },
      { workerConcurrentFrameCount: Number.NaN },
      { workerInboundWaits: -1 },
      { workerOutboundStalls: Number.NaN },
    ];
    for (const mutation of invalidCounters) {
      expect(resolveSabRingBufferMetric({ ...measuredSnapshot, ...mutation })).toMatchObject({
        state: "invalid",
      });
    }
    expect(
      resolveSabRingBufferMetric({ ...measuredSnapshot, cooperativeRoundTripsPerSecond: 1 }),
    ).toMatchObject({ state: "invalid" });
  });

  it("fails a running spike at the authoritative measurement boundary", () => {
    expect(() =>
      requireSabRingBufferCompleteAtMeasurementBoundary({
        ...measuredSnapshot,
        state: "running",
      }),
    ).toThrow("not complete at the measurement boundary");
  });
});
