import { afterEach, describe, expect, it, vi } from "vitest";
import { requireValidFlythroughTraceCompletion } from "./flythrough-trace-policy.js";
import { observeThroughLateCompletionWindow } from "./presentation-trace.js";
import {
  FLYTHROUGH_D1_TRACE_COMPLETION_TIMEOUT_MS,
  FLYTHROUGH_D1_TRACE_LATE_OBSERVATION_MS,
} from "./runs/flythrough-d1.js";

describe("flythrough trace completion policy", () => {
  afterEach(() => vi.useRealTimers());

  it("accepts a complete lossless roughly twenty-second drain", async () => {
    vi.useFakeTimers();
    const observationPromise = observeThroughLateCompletionWindow(
      completionAfter(20_000, false),
      FLYTHROUGH_D1_TRACE_COMPLETION_TIMEOUT_MS,
      FLYTHROUGH_D1_TRACE_LATE_OBSERVATION_MS,
      "Flythrough trace end/completion",
    );

    await vi.advanceTimersByTimeAsync(20_000);
    const observation = await observationPromise;

    expect(observation.exceededDeadline).toBe(false);
    expect(() => requireValidFlythroughTraceCompletion(observation)).not.toThrow();
  });

  it("retains but invalidates completion after the thirty-second deadline", async () => {
    vi.useFakeTimers();
    const observationPromise = observeThroughLateCompletionWindow(
      completionAfter(30_001, false),
      FLYTHROUGH_D1_TRACE_COMPLETION_TIMEOUT_MS,
      FLYTHROUGH_D1_TRACE_LATE_OBSERVATION_MS,
      "Flythrough trace end/completion",
    );

    await vi.advanceTimersByTimeAsync(30_001);
    const observation = await observationPromise;

    expect(observation.exceededDeadline).toBe(true);
    expect(() => requireValidFlythroughTraceCompletion(observation)).toThrow(
      "exceeded the 30000 ms validity deadline",
    );
  });

  it("invalidates data loss inside the validity deadline", async () => {
    vi.useFakeTimers();
    const observationPromise = observeThroughLateCompletionWindow(
      completionAfter(1_000, true),
      FLYTHROUGH_D1_TRACE_COMPLETION_TIMEOUT_MS,
      FLYTHROUGH_D1_TRACE_LATE_OBSERVATION_MS,
      "Flythrough trace end/completion",
    );

    await vi.advanceTimersByTimeAsync(1_000);
    const observation = await observationPromise;

    expect(() => requireValidFlythroughTraceCompletion(observation)).toThrow(
      "Chrome reported flythrough trace data loss",
    );
  });
});

function completionAfter(
  milliseconds: number,
  dataLossOccurred: boolean,
): Promise<Readonly<{ dataLossOccurred: boolean }>> {
  return new Promise((resolve) =>
    setTimeout(() => resolve(Object.freeze({ dataLossOccurred })), milliseconds),
  );
}
