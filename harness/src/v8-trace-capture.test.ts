import { describe, expect, it, vi } from "vitest";
import {
  finishV8TraceAfterOperation,
  resolveV8TraceCompletionDataLoss,
  type V8TraceCapture,
} from "./v8-trace-capture.js";

describe("V8 trace operation cleanup", () => {
  it("does not coerce an absent or malformed trace data-loss result to false", () => {
    expect(resolveV8TraceCompletionDataLoss({ dataLossOccurred: false })).toBe(false);
    expect(resolveV8TraceCompletionDataLoss({ dataLossOccurred: true })).toBe(true);
    expect(resolveV8TraceCompletionDataLoss({})).toBeNull();
    expect(resolveV8TraceCompletionDataLoss({ dataLossOccurred: "false" })).toBeNull();
  });

  it("discards an active trace when the traced operation throws", async () => {
    const discard = vi.fn(async () => undefined);
    const finish = vi.fn<() => Promise<never>>();
    const capture = { discard, finish } as V8TraceCapture;

    await expect(
      finishV8TraceAfterOperation(capture, async () => {
        throw new Error("reload failed");
      }),
    ).rejects.toThrow("reload failed");
    expect(discard).toHaveBeenCalledOnce();
    expect(finish).not.toHaveBeenCalled();
  });

  it("does not discard a successfully finished trace", async () => {
    const result = {
      events: [],
      trace: { dataLossOccurred: false, eventCount: 0, state: "measured" as const },
    };
    const discard = vi.fn(async () => undefined);
    const capture = {
      discard,
      finish: vi.fn(async () => result),
    } satisfies V8TraceCapture;

    await expect(finishV8TraceAfterOperation(capture, async () => undefined)).resolves.toBe(result);
    expect(discard).not.toHaveBeenCalled();
  });
});
