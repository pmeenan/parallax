import { describe, expect, it, vi } from "vitest";
import { createRetryableSuccessLatch } from "../src/retryable-success-latch";

describe("retryable success latch", () => {
  it("releases a failed start but stays latched after success", async () => {
    const latch = createRetryableSuccessLatch("already started");
    const operation = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("late startup failure"))
      .mockResolvedValueOnce();

    await expect(latch.run(operation)).rejects.toThrow("late startup failure");
    await expect(latch.run(operation)).resolves.toBeUndefined();
    await expect(latch.run(operation)).rejects.toThrow("already started");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("rejects concurrent starts", async () => {
    let finish!: () => void;
    const latch = createRetryableSuccessLatch("already started");
    const first = latch.run(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    await expect(latch.run(() => Promise.resolve())).rejects.toThrow("already started");
    finish();
    await first;
  });
});
