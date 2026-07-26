import { describe, expect, it, vi } from "vitest";
import { runBenchmarkUiAction } from "../src/benchmark-ui-action";

interface TestSnapshot {
  readonly failureMessage: string | null;
  readonly state: "failed" | "idle" | "running";
}

describe("benchmark UI actions", () => {
  it("runs successful synchronous and asynchronous actions without an announcement", async () => {
    const snapshot = Object.freeze({
      failureMessage: null,
      state: "idle",
    } satisfies TestSnapshot);
    const announce = vi.fn();
    const syncAction = vi.fn();
    const asyncAction = vi.fn(async () => undefined);

    runBenchmarkUiAction({
      action: syncAction,
      announce,
      failurePrefix: "Benchmark action failed",
      formatStatus: () => "unused",
      snapshot: () => snapshot,
    });
    runBenchmarkUiAction({
      action: asyncAction,
      announce,
      failurePrefix: "Benchmark action failed",
      formatStatus: () => "unused",
      snapshot: () => snapshot,
    });
    await Promise.resolve();

    expect(syncAction).toHaveBeenCalledOnce();
    expect(asyncAction).toHaveBeenCalledOnce();
    expect(announce).not.toHaveBeenCalled();
  });

  it.each([
    [
      "synchronous",
      (failure: Error) => (): void => {
        throw failure;
      },
    ],
    [
      "asynchronous",
      (failure: Error) => async (): Promise<void> => {
        throw failure;
      },
    ],
  ])("catches a %s action failure exactly once", async (_kind, createAction) => {
    const snapshot = Object.freeze({
      failureMessage: null,
      state: "running",
    } satisfies TestSnapshot);
    const announce = vi.fn();
    const failure = new Error("quality cannot change during a run");

    runBenchmarkUiAction({
      action: createAction(failure),
      announce,
      failurePrefix: "Benchmark action failed",
      formatStatus: () => "unused",
      snapshot: () => snapshot,
    });
    await Promise.resolve();

    expect(announce).toHaveBeenCalledExactlyOnceWith(
      "Benchmark action failed: quality cannot change during a run",
    );
  });

  it("preserves an authoritative structured failure published before rejection", async () => {
    const initial = Object.freeze({
      failureMessage: "previous failure",
      state: "failed",
    } satisfies TestSnapshot);
    const resetFailure = Object.freeze({
      failureMessage: "Benchmark reset failed: reset acknowledgement timed out",
      state: "failed",
    } satisfies TestSnapshot);
    let current = initial;
    const announce = vi.fn();

    runBenchmarkUiAction({
      action: async () => {
        current = resetFailure;
        throw new Error("reset acknowledgement timed out");
      },
      announce,
      failurePrefix: "Benchmark action failed",
      formatStatus: (snapshot) => `Structured status: ${snapshot.failureMessage}`,
      snapshot: () => current,
    });
    await Promise.resolve();

    expect(announce).toHaveBeenCalledExactlyOnceWith(
      "Structured status: Benchmark reset failed: reset acknowledgement timed out",
    );
  });

  it("does not mistake an unchanged prior failed report for the current action failure", () => {
    const priorFailure = Object.freeze({
      failureMessage: "prior measured failure",
      state: "failed",
    } satisfies TestSnapshot);
    const announce = vi.fn();

    runBenchmarkUiAction({
      action: () => {
        throw new Error("unsupported preset");
      },
      announce,
      failurePrefix: "Benchmark action failed",
      formatStatus: () => "prior structured status",
      snapshot: () => priorFailure,
    });

    expect(announce).toHaveBeenCalledExactlyOnceWith("Benchmark action failed: unsupported preset");
  });
});
