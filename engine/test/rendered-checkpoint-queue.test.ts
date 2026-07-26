import { captureScreenshot, VERSION } from "@babylonjs/lite";
import { describe, expect, it, vi } from "vitest";
import {
  createRenderedCheckpointFrameGate,
  createRenderedCheckpointQueue,
} from "../src/render/rendered-checkpoint-queue";

describe("rendered checkpoint queue", () => {
  it("registers capture before the frame that services it and awaits evidence after return", async () => {
    const events: string[] = [];
    const deferredTasks: (() => void)[] = [];
    const frameCaptures: (() => void)[] = [];
    const capture = vi.fn((checkpointId: string) => {
      events.push(`capture-registered:${checkpointId}`);
      return new Promise<string>((resolve) => {
        frameCaptures.push(() => {
          events.push(`capture-serviced:${checkpointId}`);
          resolve(`evidence:${checkpointId}`);
        });
      });
    });
    const publish = vi.fn((requestId: number, evidence: string) => {
      events.push(`publish:${requestId}:${evidence}`);
    });
    const queue = createRenderedCheckpointQueue(capture, publish, (callback) => {
      events.push("readback-deferred");
      deferredTasks.push(callback);
    });

    events.push("sample-applied");
    const completion = queue.request(7, "storm-dusk");
    expect(capture).toHaveBeenCalledOnce();
    expect(frameCaptures).toHaveLength(1);
    frameCaptures.shift()?.();
    events.push("frame-rendered");
    const flush = queue.flushAfterRenderedFrame();
    events.push("render-callback-returned");

    expect(deferredTasks).toHaveLength(1);
    deferredTasks[0]?.();
    await flush;
    events.push("next-frame-scheduled");
    await completion;

    expect(events).toEqual([
      "sample-applied",
      "capture-registered:storm-dusk",
      "capture-serviced:storm-dusk",
      "frame-rendered",
      "readback-deferred",
      "render-callback-returned",
      "publish:7:evidence:storm-dusk",
      "next-frame-scheduled",
    ]);
  });

  it("claims concurrent same-frame requests and leaves later requests for the next frame", async () => {
    const deferredTasks: (() => void)[] = [];
    const frameCaptures: (() => void)[] = [];
    const capture = vi.fn((checkpointId: string) => {
      return new Promise<string>((resolve, reject) => {
        frameCaptures.push(() => {
          if (checkpointId === "bad") {
            reject(new Error("readback failed"));
          } else {
            resolve(checkpointId);
          }
        });
      });
    });
    const publish = vi.fn();
    const queue = createRenderedCheckpointQueue(capture, publish, (callback) => {
      deferredTasks.push(callback);
    });
    const failed = queue.request(1, "bad");
    const sameFrame = queue.request(2, "same-frame");

    for (const service of frameCaptures.splice(0, frameCaptures.length)) service();
    const firstFlush = queue.flushAfterRenderedFrame();
    const later = queue.request(3, "later-frame");
    expect(queue.hasPendingRequests()).toBe(true);
    deferredTasks.shift()?.();
    await firstFlush;
    await expect(failed).rejects.toThrow(/readback failed/);
    await expect(sameFrame).resolves.toBeUndefined();
    expect(publish).toHaveBeenCalledWith(2, "same-frame");
    expect(capture).toHaveBeenCalledTimes(3);
    expect(publish).not.toHaveBeenCalledWith(3, "later-frame");

    for (const service of frameCaptures.splice(0, frameCaptures.length)) service();
    const secondFlush = queue.flushAfterRenderedFrame();
    deferredTasks.shift()?.();
    await secondFlush;
    await expect(later).resolves.toBeUndefined();
    expect(publish).toHaveBeenCalledWith(3, "later-frame");
  });

  it("cancels a never-settling readback so the active frame flush can resume", async () => {
    const deferredTasks: (() => void)[] = [];
    const publish = vi.fn();
    const queue = createRenderedCheckpointQueue(
      () => new Promise<string>(() => undefined),
      publish,
      (callback) => deferredTasks.push(callback),
    );
    const request = queue.request(1, "hung");
    const flush = queue.flushAfterRenderedFrame();
    deferredTasks.shift()?.();

    queue.cancelAll();

    await expect(request).resolves.toBeUndefined();
    await expect(flush).resolves.toBeUndefined();
    expect(queue.hasPendingRequests()).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not publish an already-resolved old-generation capture after cancellation", async () => {
    const deferredTasks: (() => void)[] = [];
    const publish = vi.fn();
    const queue = createRenderedCheckpointQueue(
      () => Promise.resolve("stale"),
      publish,
      (callback) => deferredTasks.push(callback),
    );
    const request = queue.request(1, "old-generation");
    const flush = queue.flushAfterRenderedFrame();
    await Promise.resolve();
    queue.cancelAll();
    deferredTasks.shift()?.();

    await request;
    await flush;
    expect(publish).not.toHaveBeenCalled();
  });

  it("withholds reset completion until a cancelled deferred flush schedules the next frame", async () => {
    const events: string[] = [];
    const deferredTasks: (() => void)[] = [];
    const queue = createRenderedCheckpointQueue(
      () => new Promise<string>(() => undefined),
      () => events.push("published"),
      (callback) => deferredTasks.push(callback),
    );
    const gate = createRenderedCheckpointFrameGate(
      queue,
      () => events.push("next-frame-scheduled"),
      (error) => events.push(`failure:${String(error)}`),
    );
    const capture = queue.request(1, "hung");
    gate.afterRenderedFrame();

    const resetBoundary = gate
      .cancelAndWaitForRenderLoop()
      .then(() => events.push("reset-boundary-posted"));
    await capture;
    await Promise.resolve();
    expect(events).toEqual([]);

    deferredTasks.shift()?.();
    await resetBoundary;

    expect(events).toEqual(["next-frame-scheduled", "reset-boundary-posted"]);
  });

  it("matches pinned Babylon Lite's synchronous screenshot registration contract", () => {
    const surface = {} as unknown as Parameters<typeof captureScreenshot>[0];
    const capture = captureScreenshot(surface);
    const internal = surface as unknown as {
      readonly _captureQueue?: readonly unknown[];
    };

    expect(VERSION).toBe("1.12.0");
    expect(capture).toBeInstanceOf(Promise);
    expect(internal._captureQueue).toHaveLength(1);
  });
});
