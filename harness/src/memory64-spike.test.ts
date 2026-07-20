import type { Memory64SpikeSample, Memory64SpikeTelemetrySnapshot } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import { pairedRatioDistribution, resolveMemory64SpikeMetric } from "./memory64-spike.js";
import {
  MEMORY64_SPIKE_EXPECTED_CHECKSUM,
  MEMORY64_SPIKE_EXPECTED_COLD_SAMPLE_COUNT,
  MEMORY64_SPIKE_EXPECTED_COMPILE_BATCH_ITERATIONS,
  MEMORY64_SPIKE_EXPECTED_HIGH_ADDRESS,
  MEMORY64_SPIKE_EXPECTED_HIGH_PAGES,
  MEMORY64_SPIKE_EXPECTED_HIGH_SENTINEL,
  MEMORY64_SPIKE_EXPECTED_INSTANTIATE_BATCH_ITERATIONS,
  MEMORY64_SPIKE_EXPECTED_KERNEL_ROUNDS,
  MEMORY64_SPIKE_EXPECTED_MEASURED_SAMPLE_COUNT,
  MEMORY64_SPIKE_EXPECTED_PREPARE_ROUNDS,
  MEMORY64_SPIKE_EXPECTED_PREPARED_PAGES,
  MEMORY64_SPIKE_EXPECTED_TELEMETRY_SCHEMA_VERSION,
  MEMORY64_SPIKE_EXPECTED_WARMUP_SAMPLE_COUNT,
} from "./runs/memory64-spike.js";

const samples = Object.freeze(
  Array.from(
    {
      length:
        MEMORY64_SPIKE_EXPECTED_COLD_SAMPLE_COUNT +
        MEMORY64_SPIKE_EXPECTED_WARMUP_SAMPLE_COUNT +
        MEMORY64_SPIKE_EXPECTED_MEASURED_SAMPLE_COUNT,
    },
    (_, ordinal): Memory64SpikeSample =>
      Object.freeze({
        checksum: MEMORY64_SPIKE_EXPECTED_CHECKSUM,
        compileElapsedMs: 0.1,
        instantiateElapsedMs: 0.1,
        kernelElapsedMs: 20,
        logicalMemoryBytes: MEMORY64_SPIKE_EXPECTED_PREPARED_PAGES * 65_536,
        ordinal,
        phase: ordinal === 0 ? "cold" : ordinal <= 2 ? "warmup" : "measured",
        prepareElapsedMs: 4,
      }),
  ),
);

const complete: Memory64SpikeTelemetrySnapshot = Object.freeze({
  coldSampleCount: MEMORY64_SPIKE_EXPECTED_COLD_SAMPLE_COUNT,
  compileBatchIterations: MEMORY64_SPIKE_EXPECTED_COMPILE_BATCH_ITERATIONS,
  failureMessage: null,
  highAddress: Object.freeze({
    address: MEMORY64_SPIKE_EXPECTED_HIGH_ADDRESS,
    growAndTouchElapsedMs: 5,
    logicalMemoryBytes: MEMORY64_SPIKE_EXPECTED_HIGH_PAGES * 65_536,
    pages: MEMORY64_SPIKE_EXPECTED_HIGH_PAGES,
    sentinelRead: MEMORY64_SPIKE_EXPECTED_HIGH_SENTINEL,
    sentinelReturned: MEMORY64_SPIKE_EXPECTED_HIGH_SENTINEL,
    sentinelWritten: MEMORY64_SPIKE_EXPECTED_HIGH_SENTINEL,
  }),
  instantiateBatchIterations: MEMORY64_SPIKE_EXPECTED_INSTANTIATE_BATCH_ITERATIONS,
  kernelRounds: MEMORY64_SPIKE_EXPECTED_KERNEL_ROUNDS,
  measuredSampleCount: MEMORY64_SPIKE_EXPECTED_MEASURED_SAMPLE_COUNT,
  memory32: Object.freeze({ fetchElapsedMs: 1, moduleBytes: 196, samples, variant: "memory32" }),
  memory64: Object.freeze({ fetchElapsedMs: 1, moduleBytes: 277, samples, variant: "memory64" }),
  prepareRounds: MEMORY64_SPIKE_EXPECTED_PREPARE_ROUNDS,
  schemaVersion: MEMORY64_SPIKE_EXPECTED_TELEMETRY_SCHEMA_VERSION,
  state: "completed",
  totalElapsedMs: 1000,
  warmupSampleCount: MEMORY64_SPIKE_EXPECTED_WARMUP_SAMPLE_COUNT,
});

describe("memory64 spike evidence", () => {
  it("computes ratios before percentiles so different arm outliers stay paired", () => {
    const paired = pairedRatioDistribution([10, 100, 10], [20, 100, 20]);
    expect(paired.p95).toBe(2);
  });

  it("accepts complete paired cost and beyond-4-GiB evidence", () => {
    expect(resolveMemory64SpikeMetric(complete)).toMatchObject({ state: "measured" });
  });

  it("accepts zero-duration cold load diagnostics at the timer resolution floor", () => {
    const changed = complete.memory32?.samples.map((sample, index) =>
      index === 0
        ? Object.freeze({ ...sample, compileElapsedMs: 0, instantiateElapsedMs: 0 })
        : sample,
    );
    expect(
      resolveMemory64SpikeMetric({
        ...complete,
        memory32:
          complete.memory32 === null || changed === undefined
            ? null
            : Object.freeze({ ...complete.memory32, samples: Object.freeze(changed) }),
      }),
    ).toMatchObject({ state: "measured" });
  });

  it("rejects zero-duration measured load evidence", () => {
    const measuredOrdinal =
      MEMORY64_SPIKE_EXPECTED_COLD_SAMPLE_COUNT + MEMORY64_SPIKE_EXPECTED_WARMUP_SAMPLE_COUNT;
    const changed = complete.memory32?.samples.map((sample, index) =>
      index === measuredOrdinal ? Object.freeze({ ...sample, compileElapsedMs: 0 }) : sample,
    );
    expect(
      resolveMemory64SpikeMetric({
        ...complete,
        memory32:
          complete.memory32 === null || changed === undefined
            ? null
            : Object.freeze({ ...complete.memory32, samples: Object.freeze(changed) }),
      }),
    ).toMatchObject({ state: "invalid" });
  });

  it("rejects nominal completion when paired kernels disagree", () => {
    const changed = complete.memory64?.samples.map((sample, index) =>
      index === 0 ? Object.freeze({ ...sample, checksum: 41 }) : sample,
    );
    expect(
      resolveMemory64SpikeMetric({
        ...complete,
        memory64:
          complete.memory64 === null || changed === undefined
            ? null
            : Object.freeze({ ...complete.memory64, samples: Object.freeze(changed) }),
      }),
    ).toMatchObject({ state: "invalid" });
  });

  it("rejects a declaration-only result that never crosses 4 GiB", () => {
    expect(
      resolveMemory64SpikeMetric({
        ...complete,
        highAddress:
          complete.highAddress === null
            ? null
            : Object.freeze({ ...complete.highAddress, address: 0xffff_fffc }),
      }),
    ).toMatchObject({ state: "invalid" });
  });

  it("rejects a claimed high-address result not observed at that exact byte offset", () => {
    expect(
      resolveMemory64SpikeMetric({
        ...complete,
        highAddress:
          complete.highAddress === null
            ? null
            : Object.freeze({ ...complete.highAddress, sentinelRead: 0 }),
      }),
    ).toMatchObject({ state: "invalid" });
  });
});
