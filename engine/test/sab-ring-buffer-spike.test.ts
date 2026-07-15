import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSabRingBufferSpike,
  type SabRingBufferSpike,
} from "../src/workers/sab-ring-buffer-spike";

afterEach(() => vi.useRealTimers());

describe("SAB ring-buffer spike lifecycle", () => {
  it("does not start after disposal", () => {
    const updates: string[] = [];
    const spike = createSabRingBufferSpike((snapshot) => updates.push(snapshot.state));

    spike.dispose();
    spike.start();

    expect(updates).toEqual([]);
    expect(spike.snapshot().state).toBe("pending");
  });

  it("does not schedule or publish after reentrant disposal from running telemetry", async () => {
    vi.useFakeTimers();
    const updates: string[] = [];
    let spike: SabRingBufferSpike;
    spike = createSabRingBufferSpike((snapshot) => {
      updates.push(snapshot.state);
      if (snapshot.state === "running") spike.dispose();
    });

    spike.start();
    await vi.runAllTimersAsync();

    expect(updates).toEqual(["running"]);
  });

  it("attributes worker failures to terminal SAB telemetry", () => {
    const updates: string[] = [];
    const spike = createSabRingBufferSpike((snapshot) => updates.push(snapshot.state));

    spike.start();
    spike.failFromWorker("worker wait timed out");

    expect(updates).toEqual(["running", "failed"]);
    expect(spike.snapshot()).toMatchObject({
      failureMessage: "worker wait timed out",
      state: "failed",
    });
  });
});
