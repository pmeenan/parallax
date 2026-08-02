import { describe, expect, it, vi } from "vitest";
import { finalizeCleanup, RETRYING_RECURSIVE_REMOVE_OPTIONS } from "./cleanup.js";

describe("runner cleanup", () => {
  it("attempts every operation and retains the primary plus all cleanup failures", async () => {
    const primary = new Error("primary");
    const first = vi.fn().mockRejectedValue(new Error("first"));
    const second = vi.fn().mockResolvedValue(undefined);
    const third = vi.fn().mockRejectedValue(new Error("third"));

    const failure = await finalizeCleanup(
      primary,
      [
        { label: "first", run: first },
        { label: "second", run: second },
        { label: "third", run: third },
      ],
      "cleanup failed",
    ).catch((error: unknown) => error);

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(third).toHaveBeenCalledOnce();
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors[0]).toBe(primary);
    expect((failure as AggregateError).errors).toHaveLength(3);
  });

  it("pins bounded Windows busy-file retries for recursive removals", () => {
    expect(RETRYING_RECURSIVE_REMOVE_OPTIONS).toEqual({
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 100,
    });
  });
});
