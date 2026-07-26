import { describe, expect, it } from "vitest";
import { createFlythroughObserverProtocol } from "../src/streaming/flythrough-observer-protocol";

describe("flythrough observer protocol", () => {
  it("keeps transport sequence cumulative across reset-separated runs and rejects late traffic", () => {
    const protocol = createFlythroughObserverProtocol(0);
    expect(
      protocol.acceptObserver({
        flythroughGeneration: 0,
        kind: "flythrough-observers",
        observers: [[0, 0, 0]],
        sequence: 1,
        transportSequence: 1,
      }),
    ).toBe(1);
    expect(
      protocol.acceptObserver({
        flythroughGeneration: 0,
        kind: "flythrough-observers",
        observers: [[1, 0, 0]],
        sequence: 2,
        transportSequence: 2,
      }),
    ).toBe(2);
    expect(
      protocol.settleReset({
        completedFlythroughGeneration: 0,
        completedRunSequence: 2,
        flythroughObserverUpdateCount: 2,
        kind: "reset-flythrough-boundary",
        nextFlythroughGeneration: 1,
        requestId: 7,
      }),
    ).toEqual({
      flythroughObserverUpdateCount: 2,
      kind: "flythrough-reset-settled",
      nextFlythroughGeneration: 1,
      requestId: 7,
    });

    expect(
      protocol.acceptObserver({
        flythroughGeneration: 1,
        kind: "flythrough-observers",
        observers: [[2, 0, 0]],
        sequence: 1,
        transportSequence: 3,
      }),
    ).toBe(3);
    expect(() =>
      protocol.acceptObserver({
        flythroughGeneration: 0,
        kind: "flythrough-observers",
        observers: [[3, 0, 0]],
        sequence: 3,
        transportSequence: 4,
      }),
    ).toThrow(/observer sequence is invalid/);
    expect(protocol.snapshot()).toEqual({
      flythroughGeneration: 1,
      runSequence: 1,
      transportSequence: 3,
    });
  });
});
