import { describe, expect, it } from "vitest";
import { evaluateStreamingDistrictSwap } from "../src/streaming/district-swap-contract";
import type { StreamingDistrictSwapTelemetry } from "../src/streaming/streaming-protocol";

const SOURCE = Object.freeze(Array.from({ length: 9 }, (_, index) => `d1-${index}`));
const DESTINATION = Object.freeze(Array.from({ length: 9 }, (_, index) => `d2-${index}`));

function sample(
  patch: Partial<StreamingDistrictSwapTelemetry> = {},
): StreamingDistrictSwapTelemetry {
  return Object.freeze({
    completedAtMs: 2_501,
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
    totalMs: 2_500,
    ...patch,
  });
}

describe("district resident-set swap contract", () => {
  it("accepts an exclusive proactive swap inside all numeric budgets", () => {
    expect(evaluateStreamingDistrictSwap(sample())).toEqual({
      exclusiveResidentSets: true,
      logicalGpuOverlapRatio: 1,
      logicalGpuOverlapWithinBudget: true,
      maxHitchWithinBudget: true,
      passed: true,
      proactiveOnly: true,
      renderEvidenceAvailable: true,
      totalWithinBudget: true,
    });
  });

  it.each([
    ["source alias", { destinationResidentCellIds: SOURCE }],
    ["overlap", { logicalGpuBytesHighWater: 1_126 }],
    ["hitch", { maxHitchMs: 100.001 }],
    ["emergency eviction", { proactiveEvictionCount: 8 }],
    ["missing frame evidence", { renderFrameCount: 0 }],
    ["duration", { totalMs: 4_000.001 }],
  ])("fails %s evidence", (_label, patch) => {
    expect(evaluateStreamingDistrictSwap(sample(patch))).toMatchObject({ passed: false });
  });
});
