import { afterEach, describe, expect, it, vi } from "vitest";
import { createStreamingWorkerLifecycle } from "../src/streaming/streaming-worker-lifecycle";

afterEach(() => {
  vi.useRealTimers();
});

describe("streaming worker disposal lifecycle", () => {
  it("fails a disposing cohort when an outstanding render transaction loses its response", async () => {
    vi.useFakeTimers();
    const lifecycle = createStreamingWorkerLifecycle();
    const teardown = vi.fn();
    let scheduling = true;
    const transaction = new Promise<void>((_resolve, reject) => {
      setTimeout(() => reject(new Error("render transaction timed out after 5000 ms")), 5_000);
    });
    const schedule = transaction
      .catch((error: unknown) => {
        if (lifecycle.tryFail()) teardown(error);
      })
      .finally(() => {
        scheduling = false;
      });

    expect(lifecycle.beginDisposal()).toBe(true);
    expect(lifecycle.state).toBe("disposing");
    expect(scheduling).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    await schedule;

    expect(scheduling).toBe(false);
    expect(lifecycle.state).toBe("failed");
    expect(lifecycle.finishDisposal()).toBe(false);
    expect(teardown).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "render transaction timed out after 5000 ms" }),
    );
  });

  it("finishes an ordinary disposal with no in-flight failure", () => {
    const lifecycle = createStreamingWorkerLifecycle();
    const teardown = vi.fn();

    expect(lifecycle.beginDisposal()).toBe(true);
    expect(lifecycle.disposalRequested).toBe(true);
    expect(lifecycle.finishDisposal()).toBe(true);
    expect(lifecycle.state).toBe("disposed");
    expect(lifecycle.tryFail()).toBe(false);
    expect(teardown).not.toHaveBeenCalled();
  });
});
