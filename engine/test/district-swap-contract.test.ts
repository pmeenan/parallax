import { describe, expect, it } from "vitest";
import { evaluateStreamingDistrictSwap } from "../src/streaming/district-swap-contract";
import type { StreamingDistrictSwapTelemetry } from "../src/streaming/streaming-protocol";

const SOURCE = Object.freeze(Array.from({ length: 9 }, (_, index) => `d1-${index}`));
const DESTINATION = Object.freeze(Array.from({ length: 9 }, (_, index) => `d2-${index}`));

function sample(
  patch: Partial<StreamingDistrictSwapTelemetry> = {},
): StreamingDistrictSwapTelemetry {
  return Object.freeze({
    completedAtMs: 301,
    destinationDistrictId: "district-2",
    destinationLogicalGpuBytes: 900,
    destinationResidentCellIds: DESTINATION,
    entranceId: "forest-ruin",
    logicalGpuBytesHighWater: 900,
    maxHitchMs: 16,
    proactiveEvictionCount: 9,
    renderFrameCount: 120,
    sourceDistrictId: "district-1",
    sourceLogicalGpuBytes: 800,
    sourceResidentCellIds: SOURCE,
    startedAtMs: 1,
    totalMs: 300,
    ...patch,
  });
}

describe("district resident-set swap contract", () => {
  const prefetch = Object.freeze({
    prefetchTriggerDistanceMeters: 4,
    traversalSpeedMetersPerSecond: 12,
  });

  it("accepts an exclusive proactive swap inside all numeric budgets", () => {
    expect(evaluateStreamingDistrictSwap(sample({ totalMs: 300 }), prefetch)).toEqual({
      exclusiveResidentSets: true,
      logicalGpuOverlapRatio: 1,
      logicalGpuOverlapWithinBudget: true,
      maxHitchWithinBudget: true,
      prefetchLeadTimeMs: 1_000 / 3,
      prefetchWithinBudget: true,
      passed: true,
      proactiveOnly: true,
      renderEvidenceAvailable: true,
      totalWithinBudget: true,
    });
  });

  it.each([
    ["source alias", { destinationResidentCellIds: SOURCE }, { exclusiveResidentSets: false }],
    ["overlap", { logicalGpuBytesHighWater: 1_126 }, { logicalGpuOverlapWithinBudget: false }],
    ["hitch", { maxHitchMs: 100.001 }, { maxHitchWithinBudget: false }],
    ["emergency eviction", { proactiveEvictionCount: 8 }, { proactiveOnly: false }],
    ["missing frame evidence", { renderFrameCount: 0 }, { renderEvidenceAvailable: false }],
    ["prefetch lead", { totalMs: 1_000 / 3 + 0.001 }, { prefetchWithinBudget: false }],
    ["duration", { totalMs: 4_000.001 }, { totalWithinBudget: false }],
  ])("fails %s evidence", (_label, patch, expected) => {
    expect(evaluateStreamingDistrictSwap(sample(patch), prefetch)).toMatchObject({
      ...expected,
      passed: false,
    });
  });

  it("fails when the prefetch contract is absent or invalid", () => {
    expect(evaluateStreamingDistrictSwap(sample(), null)).toMatchObject({
      passed: false,
      prefetchWithinBudget: false,
    });
    expect(
      evaluateStreamingDistrictSwap(sample(), {
        prefetchTriggerDistanceMeters: 0,
        traversalSpeedMetersPerSecond: 12,
      }),
    ).toMatchObject({ passed: false, prefetchWithinBudget: false });
  });
});
