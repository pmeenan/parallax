import { describe, expect, it, vi } from "vitest";
import { openAndAdmitInstalledStreamingRelease } from "../src/streaming/installed-streaming-admission";

describe("installed streaming worker admission", () => {
  it("closes every opened handle when active selection drifts before final admission", async () => {
    const events: string[] = [];
    let openHandles = 0;
    const close = vi.fn(() => {
      events.push("close");
      openHandles = 0;
      return [];
    });

    await expect(
      openAndAdmitInstalledStreamingRelease({
        admit: async () => {
          events.push("admit");
          throw new Error("active selection drifted");
        },
        closeHandles: close,
        openHandles: async () => {
          events.push("open");
          openHandles = 256;
        },
      }),
    ).rejects.toThrow(/active selection drifted/);

    expect(events).toEqual(["open", "admit", "close"]);
    expect(close).toHaveBeenCalledOnce();
    expect(openHandles).toBe(0);
  });

  it("closes partially opened handles exactly once when handle opening rejects", async () => {
    const events: string[] = [];
    const openingFailure = new Error("second access handle failed");
    const close = vi.fn(() => {
      events.push("close");
      return [];
    });
    const admit = vi.fn(async () => undefined);

    await expect(
      openAndAdmitInstalledStreamingRelease({
        admit,
        closeHandles: close,
        openHandles: async () => {
          events.push("open-partial");
          throw openingFailure;
        },
      }),
    ).rejects.toBe(openingFailure);

    expect(events).toEqual(["open-partial", "close"]);
    expect(close).toHaveBeenCalledOnce();
    expect(admit).not.toHaveBeenCalled();
  });

  it("retains the opening failure when partial-handle cleanup also fails", async () => {
    const openingFailure = new Error("access handle failed");
    const close = vi.fn(() => [new Error("close failed")]);

    await expect(
      openAndAdmitInstalledStreamingRelease({
        admit: vi.fn(async () => undefined),
        closeHandles: close,
        openHandles: async () => {
          throw openingFailure;
        },
      }),
    ).rejects.toMatchObject({
      cause: openingFailure,
      message: "access handle failed; OPFS access-handle cleanup failed: close failed",
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not close admitted immutable handles", async () => {
    const close = vi.fn(() => []);
    const events: string[] = [];

    await openAndAdmitInstalledStreamingRelease({
      admit: async () => {
        events.push("admit");
      },
      closeHandles: close,
      openHandles: async () => {
        events.push("open");
      },
    });

    expect(events).toEqual(["open", "admit"]);
    expect(close).not.toHaveBeenCalled();
  });
});
