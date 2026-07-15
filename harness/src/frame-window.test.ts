import { describe, expect, it } from "vitest";
import { markerAlignedWindowStart, selectMeasurementFrameWindow } from "./frame-window.js";

// Frames are labeled with their absolute frame numbers: the last element of
// recentFrames is frame #snapshotFrameCount.
function frames(firstFrameNumber: number, lastFrameNumber: number): readonly number[] {
  return Array.from(
    { length: lastFrameNumber - firstFrameNumber + 1 },
    (_, index) => firstFrameNumber + index,
  );
}

describe("measurement frame-window selection", () => {
  it("selects the exact window by frame index when trailing frames arrived after the end marker", () => {
    const selected = selectMeasurementFrameWindow({
      measurementFrames: 120,
      recentFrames: frames(11, 250),
      snapshotFrameCount: 250,
      startFrameCount: 100,
    });
    expect(selected).toHaveLength(120);
    expect(selected[0]).toBe(101);
    expect(selected.at(-1)).toBe(220);
  });

  it("keeps the trailing window when the snapshot landed exactly on the end marker (drop = 0)", () => {
    const selected = selectMeasurementFrameWindow({
      measurementFrames: 3,
      recentFrames: frames(4, 13),
      snapshotFrameCount: 13,
      startFrameCount: 10,
    });
    expect(selected).toEqual([11, 12, 13]);
  });

  it("fails clearly when retention evicted frames from the measurement window", () => {
    expect(() =>
      selectMeasurementFrameWindow({
        measurementFrames: 120,
        recentFrames: frames(200, 400),
        snapshotFrameCount: 400,
        startFrameCount: 100,
      }),
    ).toThrow("evicted from telemetry retention");
  });

  it("rejects a snapshot taken before the measurement window completed", () => {
    expect(() =>
      selectMeasurementFrameWindow({
        measurementFrames: 120,
        recentFrames: frames(1, 150),
        snapshotFrameCount: 150,
        startFrameCount: 100,
      }),
    ).toThrow("precedes the end of the measurement window");
  });

  it("rejects a non-positive window size", () => {
    expect(() =>
      selectMeasurementFrameWindow({
        measurementFrames: 0,
        recentFrames: [],
        snapshotFrameCount: 0,
        startFrameCount: 0,
      }),
    ).toThrow("positive integer");
  });
});

describe("marker-aligned window start", () => {
  it("pads the observed frame count by one full telemetry batch", () => {
    expect(markerAlignedWindowStart(100, 60)).toBe(160);
    expect(markerAlignedWindowStart(0, 60)).toBe(60);
  });

  it("keeps every selected frame after the marker even with a worst-case stale batch", () => {
    // Worst case: the observed frameCount at the start-telemetry read trailed the true
    // rendered count by a full batch minus one frame, so the marker (placed before the
    // read) landed while frame observed + batch - 1 was already rendered.
    const observed = 100;
    const batchFrames = 60;
    const trueRenderedAtMarker = observed + batchFrames - 1;
    const windowStart = markerAlignedWindowStart(observed, batchFrames);
    const selected = selectMeasurementFrameWindow({
      measurementFrames: 120,
      recentFrames: frames(61, 300),
      snapshotFrameCount: 300,
      startFrameCount: windowStart,
    });
    expect(selected).toHaveLength(120);
    expect(selected[0]).toBe(161);
    expect(selected.every((frameNumber) => frameNumber > trueRenderedAtMarker)).toBe(true);
  });

  it("rejects malformed inputs", () => {
    expect(() => markerAlignedWindowStart(-1, 60)).toThrow("non-negative integer");
    expect(() => markerAlignedWindowStart(0.5, 60)).toThrow("non-negative integer");
    expect(() => markerAlignedWindowStart(100, 0)).toThrow("positive integer");
    expect(() => markerAlignedWindowStart(100, 59.5)).toThrow("positive integer");
  });
});
