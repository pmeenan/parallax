import { describe, expect, it } from "vitest";
import {
  type ChromeTraceEvent,
  extractVizPresentationFeedbackCallbackIntervalsMs,
  observeThroughLateCompletionWindow,
  PRESENTATION_TRACE_END_MARKER,
  PRESENTATION_TRACE_EVENT,
  PRESENTATION_TRACE_START_MARKER,
  withTimeout,
} from "./presentation-trace.js";

describe("Viz presentation-feedback callback trace extraction", () => {
  it("bounds trace completion waits", async () => {
    await expect(
      withTimeout(new Promise<never>(() => undefined), 1, "trace completion"),
    ).rejects.toThrow("trace completion timed out");
  });

  it("retains completion observed after the validity deadline", async () => {
    const observation = await observeThroughLateCompletionWindow(
      new Promise<string>((resolve) => setTimeout(() => resolve("late"), 10)),
      1,
      5_000,
      "trace completion",
    );
    expect(observation).toMatchObject({ exceededDeadline: true, value: "late" });
    expect(observation.elapsedMs).toBeGreaterThan(1);
  });

  it("reports both validity and observation bounds when completion remains unbounded", async () => {
    await expect(
      observeThroughLateCompletionWindow(
        new Promise<never>(() => undefined),
        1,
        2,
        "trace completion",
      ),
    ).rejects.toThrow("3 ms observation bound (1 ms validity deadline plus 2 ms late window)");
  });

  it("extracts sorted callback intervals spanning the marked window", () => {
    const events = [
      event("process_name", 1, 0, 0, "M", { name: "GPU Process" }),
      event(PRESENTATION_TRACE_START_MARKER, 2, 3, 2_000, "I"),
      event(PRESENTATION_TRACE_EVENT, 1, 4, 1_000, "I"),
      event(PRESENTATION_TRACE_EVENT, 1, 4, 34_334, "I"),
      event(PRESENTATION_TRACE_EVENT, 1, 4, 17_667, "I"),
      event(PRESENTATION_TRACE_EVENT, 1, 4, 51_001, "I"),
      event(PRESENTATION_TRACE_END_MARKER, 2, 3, 60_000, "I"),
      event(PRESENTATION_TRACE_EVENT, 1, 4, 67_668, "I"),
    ];

    expect(extractVizPresentationFeedbackCallbackIntervalsMs(events)).toEqual([
      16.667, 16.667, 16.667, 16.667,
    ]);
  });

  it("rejects trace loss at either measurement boundary", () => {
    const events = [
      event("process_name", 1, 0, 0, "M", { name: "GPU Process" }),
      event(PRESENTATION_TRACE_START_MARKER, 2, 3, 1_000, "I"),
      event(PRESENTATION_TRACE_EVENT, 1, 4, 17_667, "I"),
      event(PRESENTATION_TRACE_END_MARKER, 2, 3, 20_000, "I"),
    ];

    expect(() => extractVizPresentationFeedbackCallbackIntervalsMs(events)).toThrow("start marker");
  });

  it("includes callbacks exactly coincident with both unequal window boundaries", () => {
    const events = [
      event("process_name", 1, 0, 0, "M", { name: "GPU Process" }),
      event(PRESENTATION_TRACE_EVENT, 1, 4, 1_000, "I"),
      event(PRESENTATION_TRACE_START_MARKER, 2, 3, 2_000, "I"),
      event(PRESENTATION_TRACE_EVENT, 1, 4, 2_000, "I"),
      event(PRESENTATION_TRACE_EVENT, 1, 4, 7_000, "I"),
      event(PRESENTATION_TRACE_END_MARKER, 2, 3, 11_000, "I"),
      event(PRESENTATION_TRACE_EVENT, 1, 4, 11_000, "I"),
      event(PRESENTATION_TRACE_EVENT, 1, 4, 20_000, "I"),
    ];

    expect(extractVizPresentationFeedbackCallbackIntervalsMs(events)).toEqual([1, 5, 4]);
  });

  it("rejects a missing callback after the end marker", () => {
    const events = [
      event("process_name", 1, 0, 0, "M", { name: "GPU Process" }),
      event(PRESENTATION_TRACE_EVENT, 1, 4, 1_000, "I"),
      event(PRESENTATION_TRACE_START_MARKER, 2, 3, 2_000, "I"),
      event(PRESENTATION_TRACE_EVENT, 1, 4, 17_667, "I"),
      event(PRESENTATION_TRACE_END_MARKER, 2, 3, 20_000, "I"),
    ];

    expect(() => extractVizPresentationFeedbackCallbackIntervalsMs(events)).toThrow("end marker");
  });

  it("rejects multiple GPU callback tracks as ambiguous", () => {
    const events = [
      event("process_name", 1, 0, 0, "M", { name: "GPU Process" }),
      event(PRESENTATION_TRACE_START_MARKER, 2, 3, 1_000, "I"),
      event(PRESENTATION_TRACE_EVENT, 1, 4, 10_000, "I"),
      event(PRESENTATION_TRACE_EVENT, 1, 5, 15_000, "I"),
      event(PRESENTATION_TRACE_EVENT, 1, 4, 20_000, "I"),
      event(PRESENTATION_TRACE_END_MARKER, 2, 3, 30_000, "I"),
    ];

    expect(() => extractVizPresentationFeedbackCallbackIntervalsMs(events)).toThrow(
      "one Viz presentation-feedback callback track",
    );
  });

  it("preserves tied callback timestamps as a zero-length diagnostic interval", () => {
    const events = [
      event("process_name", 1, 0, 0, "M", { name: "GPU Process" }),
      event(PRESENTATION_TRACE_EVENT, 1, 4, 1_000, "I"),
      event(PRESENTATION_TRACE_START_MARKER, 2, 3, 2_000, "I"),
      event(PRESENTATION_TRACE_EVENT, 1, 4, 17_667, "I"),
      event(PRESENTATION_TRACE_EVENT, 1, 4, 17_667, "I"),
      event(PRESENTATION_TRACE_END_MARKER, 2, 3, 20_000, "I"),
      event(PRESENTATION_TRACE_EVENT, 1, 4, 34_334, "I"),
    ];

    expect(extractVizPresentationFeedbackCallbackIntervalsMs(events)).toContain(0);
  });
});

function event(
  name: string,
  pid: number,
  tid: number,
  ts: number,
  ph: string,
  args?: Readonly<Record<string, unknown>>,
): ChromeTraceEvent {
  return args === undefined ? { name, ph, pid, tid, ts } : { args, name, ph, pid, tid, ts };
}
