import { describe, expect, it } from "vitest";
import type { StreamingDistrictIndex } from "../src/streaming/streaming-protocol";
import {
  scheduleStreamingCells,
  streamingDecodeWorkerCount,
} from "../src/streaming/streaming-scheduler";

const cells = Array.from({ length: 16 }, (_, z) =>
  Array.from({ length: 16 }, (_, x) =>
    Object.freeze({
      bytes: 1_024 + x + z,
      cellId: `cell-${x}-${z}`,
      coordinate: Object.freeze([x, z] as const),
      path: `cell-${x}-${z}.json`,
      sha256: `${x.toString(16)}${z.toString(16)}`.padEnd(64, "0"),
    }),
  ),
).flat();

const index = Object.freeze({
  bounds: Object.freeze({
    maximum: Object.freeze([2_048, 256, 2_048] as const),
    minimum: Object.freeze([-2_048, -32, -2_048] as const),
  }),
  cellSizeMeters: 256,
  cells: Object.freeze(cells),
  districtId: "fixture",
  materials: Object.freeze([]),
  schemaVersion: 1,
}) satisfies StreamingDistrictIndex;

describe("movement-driven streaming scheduler", () => {
  it("selects a deterministic bounded nearest set for multiple future observers", () => {
    const schedule = scheduleStreamingCells(
      index,
      [
        [-1_920, 0, -1_920],
        [1_920, 0, 1_920],
      ],
      new Set(),
      4,
    );

    expect(schedule.target.map(({ cellId }) => cellId)).toEqual([
      "cell-0-0",
      "cell-15-15",
      "cell-1-0",
      "cell-0-1",
    ]);
    expect(schedule.load).toEqual(schedule.target);
    expect(schedule.evict).toEqual([]);
  });

  it("evicts the farthest old cells before loading replacements after movement", () => {
    const resident = new Set(["cell-0-0", "cell-1-0", "cell-0-1", "cell-1-1"]);
    const schedule = scheduleStreamingCells(index, [[-1_280, 0, -1_920]], resident, 4);

    expect(schedule.target.map(({ cellId }) => cellId)).toEqual([
      "cell-2-0",
      "cell-3-0",
      "cell-2-1",
      "cell-3-1",
    ]);
    expect(schedule.evict.map(({ cellId }) => cellId)).toEqual([
      "cell-0-1",
      "cell-0-0",
      "cell-1-1",
      "cell-1-0",
    ]);
    expect(schedule.load.map(({ cellId }) => cellId)).toEqual([
      "cell-2-0",
      "cell-3-0",
      "cell-2-1",
      "cell-3-1",
    ]);
  });

  it("makes the bounded diagonal stress path supply at least ten replacements per second", () => {
    const southwest = scheduleStreamingCells(index, [[-0.75, 0, -0.75]], new Set(), 9);
    const southwestIds = new Set(southwest.target.map(({ cellId }) => cellId));
    const northeast = scheduleStreamingCells(index, [[0.75, 0, 0.75]], southwestIds, 9);
    const oneWayMeters = Math.hypot(1.5, 1.5);
    const minimumTransitionsPerSecond = Math.floor(12 / oneWayMeters);

    expect(northeast.load).toHaveLength(3);
    expect(minimumTransitionsPerSecond * northeast.load.length).toBeGreaterThanOrEqual(10);
  });

  it("sizes the decode pool from hardware concurrency with reserved-thread and cap bounds", () => {
    expect(streamingDecodeWorkerCount(1)).toBe(1);
    expect(streamingDecodeWorkerCount(4)).toBe(2);
    expect(streamingDecodeWorkerCount(16)).toBe(4);
    expect(streamingDecodeWorkerCount(Number.NaN)).toBe(1);
  });
});
