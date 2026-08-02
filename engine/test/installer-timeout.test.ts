import { describe, expect, it, vi } from "vitest";
import {
  type InstallerTimeoutPlatform,
  runInstallerRequestWithTimeout,
} from "../src/install/installer-timeout";

describe("installer request timeout", () => {
  it("aborts and rejects a request that never settles", async () => {
    let fire!: () => void;
    const clearTimeout = vi.fn();
    const platform: InstallerTimeoutPlatform = {
      clearTimeout,
      setTimeout(callback) {
        fire = callback;
        return 7;
      },
    };
    let observedAbort = false;
    const result = runInstallerRequestWithTimeout(
      30_000,
      "target status timed out",
      (signal) => {
        signal.addEventListener("abort", () => {
          observedAbort = true;
        });
        return new Promise<never>(() => undefined);
      },
      platform,
    );
    await Promise.resolve();

    fire();

    await expect(result).rejects.toMatchObject({
      message: "target status timed out",
      name: "TimeoutError",
    });
    expect(observedAbort).toBe(true);
    expect(clearTimeout).toHaveBeenCalledWith(7);
  });

  it("clears the deadline when the request settles first", async () => {
    const clearTimeout = vi.fn();
    const platform: InstallerTimeoutPlatform = {
      clearTimeout,
      setTimeout: () => 9,
    };

    await expect(
      runInstallerRequestWithTimeout(30_000, "timeout", async () => "ready", platform),
    ).resolves.toBe("ready");
    expect(clearTimeout).toHaveBeenCalledWith(9);
  });

  it("ignores a queued deadline callback after success without aborting the operation signal", async () => {
    let fireDeadline!: () => void;
    let operationSignal: AbortSignal | undefined;
    const platform: InstallerTimeoutPlatform = {
      clearTimeout: vi.fn(),
      setTimeout(callback) {
        fireDeadline = callback;
        return 10;
      },
    };
    const result = runInstallerRequestWithTimeout(
      30_000,
      "late timeout must be inert",
      async (signal) => {
        operationSignal = signal;
        return "ready";
      },
      platform,
    );

    await expect(result).resolves.toBe("ready");
    fireDeadline();

    expect(operationSignal?.aborted).toBe(false);
    expect(platform.clearTimeout).toHaveBeenCalledWith(10);
  });

  it("composes a parent cancellation and preserves its typed reason", async () => {
    let fireDeadline!: () => void;
    let operationSignal: AbortSignal | undefined;
    const parent = new AbortController();
    const reason = new DOMException("user cancelled target discovery", "AbortError");
    const platform: InstallerTimeoutPlatform = {
      clearTimeout: vi.fn(),
      setTimeout(callback) {
        fireDeadline = callback;
        return 11;
      },
    };
    const result = runInstallerRequestWithTimeout(
      30_000,
      "target discovery timed out",
      (signal) => {
        operationSignal = signal;
        return new Promise<never>(() => undefined);
      },
      platform,
      parent.signal,
    );
    await Promise.resolve();

    parent.abort(reason);

    await expect(result).rejects.toBe(reason);
    expect(operationSignal?.aborted).toBe(true);
    expect(operationSignal?.reason).toBe(reason);
    fireDeadline();
    expect(platform.clearTimeout).toHaveBeenCalledWith(11);
  });

  it("preserves an explicit null parent abort reason", async () => {
    let operationSignal: AbortSignal | undefined;
    const parent = new AbortController();
    const platform: InstallerTimeoutPlatform = {
      clearTimeout: vi.fn(),
      setTimeout: () => 12,
    };
    const result = runInstallerRequestWithTimeout(
      30_000,
      "timeout",
      (signal) => {
        operationSignal = signal;
        return new Promise<never>(() => undefined);
      },
      platform,
      parent.signal,
    );
    await Promise.resolve();

    parent.abort(null);
    const rejection = await result.catch((error: unknown) => error);

    expect(rejection).toBeNull();
    expect(operationSignal?.aborted).toBe(true);
    expect(operationSignal?.reason).toBeNull();
    expect(platform.clearTimeout).toHaveBeenCalledWith(12);
  });
});
