import { describe, expect, it } from "vitest";
import { createStreamingWarmupArrivalGate } from "../src/render/streaming-warmup-arrival-gate";

describe("streaming warmup arrival gate", () => {
  it("buffers an injected early arrival and preserves its measured warmup overlap", () => {
    const gate = createStreamingWarmupArrivalGate<object>();
    const early = Object.freeze({ id: "early" });
    const delivered: object[] = [];
    let overlapCount = 0;

    gate.receive(early);
    expect(delivered).toEqual([]);
    expect(gate.arrivedDuringWarmup(early)).toBe(true);
    gate.activate((message) => {
      delivered.push(message);
      if (gate.arrivedDuringWarmup(message)) overlapCount += 1;
    });
    expect(delivered).toEqual([early]);
    expect(overlapCount).toBe(1);
  });

  it("delivers ordinary post-warmup arrivals without reporting overlap", () => {
    const gate = createStreamingWarmupArrivalGate<object>();
    const ordinary = Object.freeze({ id: "ordinary" });
    const delivered: object[] = [];
    let overlapCount = 0;

    gate.activate((message) => {
      delivered.push(message);
      if (gate.arrivedDuringWarmup(message)) overlapCount += 1;
    });
    gate.receive(ordinary);
    expect(delivered).toEqual([ordinary]);
    expect(gate.arrivedDuringWarmup(ordinary)).toBe(false);
    expect(overlapCount).toBe(0);
  });
});
