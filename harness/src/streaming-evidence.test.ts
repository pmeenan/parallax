import {
  STREAMING_RESIDENT_CELL_LIMIT,
  type WorldStreamingTelemetrySnapshot,
} from "@parallax/engine";
import { describe, expect, it } from "vitest";
import { requireStreamingEvidence } from "./streaming-evidence.js";

function validTelemetry(): WorldStreamingTelemetrySnapshot {
  return {
    cellLoadSampleCount: 12,
    cellLoadSamples: Array.from({ length: 12 }, (_, index) => ({
      cellId: `cell-${index}`,
      decodeMs: 1,
      encodedBytes: 10_000,
      gpuBytes: 20_000,
      opfsReadMs: 2,
      sequence: index + 1,
      totalMs: 10 + index,
      uploadMs: 3,
    })),
    decodeQueueDepthHighWater: 9,
    decodeWorkerCount: 4,
    cpuBudgetRejectionCount: 0,
    encodedBytesRead: 120_000,
    failureMessage: null,
    hardwareConcurrency: 16,
    opfsProvisionedBytes: 3_000_000,
    proactiveEvictionCount: 12,
    residentCellCount: 9,
    residentEncodedBytes: 90_000,
    residentEncodedBytesHighWater: 90_000,
    residentGpuBytes: 180_000,
    residentGpuBytesHighWater: 180_000,
    schemaVersion: 1,
    state: "streaming",
  };
}

describe("M1 streaming smoke evidence", () => {
  it("derives nearest-rank p95 from a complete movement-driven sample", () => {
    expect(requireStreamingEvidence(validTelemetry()).cellLoadP95Ms).toBe(21);
  });

  it("derives p95 and eviction evidence from the bounded measurement delta", () => {
    const end = validTelemetry();
    const start = {
      ...end,
      cellLoadSampleCount: 2,
      cellLoadSamples: end.cellLoadSamples.slice(0, 2),
      proactiveEvictionCount: 2,
    };
    const evidence = requireStreamingEvidence(end, start);
    expect(evidence.cellLoadP95Ms).toBe(21);
    expect(evidence.measurementCellLoadSamples).toHaveLength(10);
    expect(evidence.measurementProactiveEvictionCount).toBe(10);
  });

  it("uses monotonic sequence boundaries after the retained sample ring wraps", () => {
    const base = validTelemetry();
    const template = base.cellLoadSamples[0];
    if (template === undefined) throw new Error("Streaming fixture has no sample");
    const samples = Array.from({ length: 256 }, (_, index) => ({
      ...(base.cellLoadSamples[index % base.cellLoadSamples.length] ?? template),
      sequence: index + 5,
      totalMs: index + 1,
    }));
    const end = {
      ...base,
      cellLoadSampleCount: 260,
      cellLoadSamples: samples,
      proactiveEvictionCount: 260,
    };
    const start = {
      ...end,
      cellLoadSampleCount: 250,
      proactiveEvictionCount: 250,
    };
    const evidence = requireStreamingEvidence(end, start);
    expect(evidence.measurementCellLoadSamples.map(({ sequence }) => sequence)).toEqual([
      251, 252, 253, 254, 255, 256, 257, 258, 259, 260,
    ]);
    expect(evidence.cellLoadP95Ms).toBe(256);
  });

  it("recomputes a stored measurement window instead of trusting supplied samples", () => {
    const telemetry = validTelemetry();
    const evidence = requireStreamingEvidence({
      ...telemetry,
      measurementCellLoadSamples: [telemetry.cellLoadSamples[0]],
      measurementProactiveEvictionCount: 999,
      measurementStartCellLoadSampleCount: 2,
      measurementStartProactiveEvictionCount: 2,
    });
    expect(evidence.measurementCellLoadSamples.map(({ sequence }) => sequence)).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(evidence.measurementProactiveEvictionCount).toBe(10);
  });

  it("rejects a self-declared favorable suffix shorter than ten samples", () => {
    const telemetry = validTelemetry();
    expect(() =>
      requireStreamingEvidence({
        ...telemetry,
        measurementStartCellLoadSampleCount: 10,
        measurementStartProactiveEvictionCount: 1,
      }),
    ).toThrow(/at least 10 completed replacements/);
  });

  it("accepts snapshots that bisect the eviction-before-load schedule phase", () => {
    const telemetry = validTelemetry();
    const endSkew = requireStreamingEvidence({
      ...telemetry,
      proactiveEvictionCount: telemetry.proactiveEvictionCount + 1,
    });
    expect(endSkew.measurementProactiveEvictionCount).toBe(13);

    const startSkew = requireStreamingEvidence(telemetry, {
      ...telemetry,
      cellLoadSampleCount: 2,
      cellLoadSamples: telemetry.cellLoadSamples.slice(0, 2),
      proactiveEvictionCount: 3,
    });
    expect(startSkew.measurementCellLoadSamples).toHaveLength(10);
    expect(startSkew.measurementProactiveEvictionCount).toBe(9);
  });

  it("rejects eviction/load skew larger than one bounded residency pass", () => {
    const telemetry = validTelemetry();
    expect(() =>
      requireStreamingEvidence({
        ...telemetry,
        proactiveEvictionCount: telemetry.cellLoadSampleCount + STREAMING_RESIDENT_CELL_LIMIT + 1,
      }),
    ).toThrow(/inconsistent proactive-eviction evidence/);
  });

  it.each([
    ["not ready", { ...validTelemetry(), state: "provisioning" }],
    ["no proactive eviction", { ...validTelemetry(), proactiveEvictionCount: 0 }],
    ["encoded-budget rejection", { ...validTelemetry(), cpuBudgetRejectionCount: 1 }],
    ["unbounded residency", { ...validTelemetry(), residentCellCount: 10 }],
    ["unbounded queue", { ...validTelemetry(), decodeQueueDepthHighWater: 10 }],
    ["invalid hardware count", { ...validTelemetry(), hardwareConcurrency: Number.NaN }],
    [
      "invalid encoded high water",
      { ...validTelemetry(), residentEncodedBytesHighWater: Number.NaN },
    ],
    ["invalid GPU high water", { ...validTelemetry(), residentGpuBytesHighWater: Number.NaN }],
    ["invalid read attribution", { ...validTelemetry(), encodedBytesRead: Number.NaN }],
    ["invalid provision attribution", { ...validTelemetry(), opfsProvisionedBytes: Number.NaN }],
    ["missing GPU residency", { ...validTelemetry(), residentGpuBytes: 0 }],
    [
      "too few samples",
      { ...validTelemetry(), cellLoadSamples: validTelemetry().cellLoadSamples.slice(0, 9) },
    ],
  ])("rejects %s", (_label, telemetry) => {
    expect(() => requireStreamingEvidence(telemetry)).toThrow();
  });
});
