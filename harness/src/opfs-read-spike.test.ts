import type { OpfsReadSpikeTelemetrySnapshot } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import {
  evaluateOpfsThroughputVariance,
  requireOpfsReadSpikeCompleteAtMeasurementBoundary,
  resolveOpfsReadSpikeMetric,
} from "./opfs-read-spike.js";

const sequentialBytes = 64 * 1024 * 1024 * 12;
const randomBytes = 64 * 1024 * 4_096;

function phase(bytesRead: number, operations: number) {
  return Object.freeze({
    bytesRead,
    operations,
    readCallElapsedMs: 100,
    readCallThroughputBytesPerSecond: bytesRead * 10,
    validationErrors: 0,
    wallElapsedMs: 200,
    wallThroughputBytesPerSecond: bytesRead * 5,
  });
}

const sequentialPhase = phase(sequentialBytes, 768);
const randomPhase = phase(randomBytes, 4_096);

const freshSnapshot: OpfsReadSpikeTelemetrySnapshot = Object.freeze({
  failureMessage: null,
  fileBytes: 64 * 1024 * 1024,
  fileReused: false,
  provisioningBytesWritten: 64 * 1024 * 1024,
  provisioningElapsedMs: 250,
  random: randomPhase,
  sequential: sequentialPhase,
  state: "completed",
});

describe("OPFS read spike evidence", () => {
  it("accepts exact fresh and warm contracts", () => {
    expect(resolveOpfsReadSpikeMetric(freshSnapshot, "fresh")).toMatchObject({ state: "measured" });
    expect(
      resolveOpfsReadSpikeMetric(
        {
          ...freshSnapshot,
          fileReused: true,
          provisioningBytesWritten: 0,
          provisioningElapsedMs: 0,
        },
        "warm",
      ),
    ).toMatchObject({ state: "measured" });
  });

  it("rejects lifecycle drift, corruption, and malformed throughput", () => {
    expect(resolveOpfsReadSpikeMetric(freshSnapshot, "warm")).toMatchObject({ state: "invalid" });
    expect(
      resolveOpfsReadSpikeMetric(
        { ...freshSnapshot, sequential: { ...sequentialPhase, validationErrors: 1 } },
        "fresh",
      ),
    ).toMatchObject({ state: "invalid" });
    expect(
      resolveOpfsReadSpikeMetric(
        {
          ...freshSnapshot,
          random: { ...randomPhase, readCallThroughputBytesPerSecond: 1 },
        },
        "fresh",
      ),
    ).toMatchObject({ state: "invalid" });
    const contractDriftMutations = [
      { sequential: { ...sequentialPhase, bytesRead: sequentialPhase.bytesRead - 1 } },
      { sequential: { ...sequentialPhase, operations: sequentialPhase.operations - 1 } },
      {
        sequential: {
          ...sequentialPhase,
          wallElapsedMs: sequentialPhase.readCallElapsedMs - 1,
        },
      },
      {
        sequential: {
          ...sequentialPhase,
          wallThroughputBytesPerSecond: 1,
        },
      },
    ] as const;
    for (const mutation of contractDriftMutations) {
      expect(resolveOpfsReadSpikeMetric({ ...freshSnapshot, ...mutation }, "fresh")).toMatchObject({
        state: "invalid",
      });
    }
  });

  it("fails an unfinished spike at the measurement boundary", () => {
    expect(() =>
      requireOpfsReadSpikeCompleteAtMeasurementBoundary(
        { ...freshSnapshot, state: "running" },
        "fresh",
      ),
    ).toThrow("not complete at the measurement boundary");
  });

  it("enforces the repeat count and ten-percent throughput variance gate", () => {
    expect(evaluateOpfsThroughputVariance("fresh", "sequential", [100, 105, 110], 3)).toMatchObject(
      { state: "measured" },
    );
    expect(evaluateOpfsThroughputVariance("fresh", "sequential", [100, 111, 120], 3)).toMatchObject(
      { state: "invalid" },
    );
    expect(evaluateOpfsThroughputVariance("warm", "random", [100, 101], 3)).toMatchObject({
      state: "invalid",
    });
  });
});
