import { describe, expect, it, vi } from "vitest";
import {
  renderRecoveryElapsedMs,
  withRenderRecoveryBoundaryTimeout,
} from "./render-recovery-timeout.js";

describe("render-recovery boundary timeout", () => {
  it("rejects a quiesce handshake that never settles", async () => {
    vi.useFakeTimers();
    try {
      const pending = withRenderRecoveryBoundaryTimeout(
        new Promise<never>(() => undefined),
        30_000,
      );
      const rejection = expect(pending).rejects.toThrow(/boundary timed out/);
      await vi.advanceTimersByTimeAsync(30_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the timeout when the boundary settles", async () => {
    vi.useFakeTimers();
    try {
      await expect(
        withRenderRecoveryBoundaryTimeout(Promise.resolve("settled"), 30_000),
      ).resolves.toBe("settled");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains elapsed recovery time for a failed boundary", () => {
    expect(renderRecoveryElapsedMs(1_000, 31_500)).toBe(30_500);
    expect(renderRecoveryElapsedMs(null, 31_500)).toBeNull();
  });
});
