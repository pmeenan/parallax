import { describe, expect, it } from "vitest";
import {
  createGameplayInputService,
  type GameplayInputFrame,
} from "../src/input/gameplay-input-service";

class FakeDocument extends EventTarget {
  activeElement: Element | null = null;
  pointerLockElement: Element | null = null;

  exitPointerLock(): void {
    this.pointerLockElement = null;
    this.dispatchEvent(new Event("pointerlockchange"));
  }
}

class FakeWindow extends EventTarget {
  private nextAnimationFrame = 1;
  private readonly callbacks = new Map<number, FrameRequestCallback>();

  requestAnimationFrame(callback: FrameRequestCallback): number {
    const id = this.nextAnimationFrame++;
    this.callbacks.set(id, callback);
    return id;
  }

  cancelAnimationFrame(id: number): void {
    this.callbacks.delete(id);
  }

  flush(timestamp = 1): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) callback(timestamp);
  }
}

class FakeCanvas extends EventTarget {
  tabIndex = -1;

  constructor(private readonly documentTarget: FakeDocument) {
    super();
  }

  focus(): void {
    this.documentTarget.activeElement = this as unknown as Element;
  }

  requestPointerLock(): Promise<void> {
    return Promise.reject(new Error("pointer lock denied"));
  }
}

describe("gameplay input service", () => {
  it("carries UI suppression from idle through startup and ignores terminal teardown", () => {
    const documentTarget = new FakeDocument();
    const windowTarget = new FakeWindow();
    const canvas = new FakeCanvas(documentTarget);
    const frames: GameplayInputFrame[] = [];
    const service = createGameplayInputService(
      documentTarget as unknown as Document,
      windowTarget as unknown as Window,
    );

    service.setUiSuppressed(true);
    expect(service.snapshot()).toMatchObject({ state: "idle", uiSuppressed: true });
    service.start(canvas as unknown as HTMLCanvasElement, (frame) => frames.push(frame));
    windowTarget.flush();
    expect(frames).toHaveLength(0);
    service.setUiSuppressed(false);
    windowTarget.flush();
    expect(frames).toMatchObject([{ forward: 0, interactPressed: false, right: 0 }]);
    service.dispose();
    expect(() => service.setUiSuppressed(false)).not.toThrow();
  });

  it("focus-gates keys, coalesces high-rate motion, and preserves interaction edges", async () => {
    const documentTarget = new FakeDocument();
    const windowTarget = new FakeWindow();
    const canvas = new FakeCanvas(documentTarget);
    const frames: GameplayInputFrame[] = [];
    const service = createGameplayInputService(
      documentTarget as unknown as Document,
      windowTarget as unknown as Window,
    );

    service.start(canvas as unknown as HTMLCanvasElement, (frame) => frames.push(frame));
    windowTarget.flush();
    expect(frames).toMatchObject([{ forward: 0, interactPressed: false, right: 0 }]);

    windowTarget.dispatchEvent(keyEvent("keydown", "KeyW"));
    windowTarget.flush();
    expect(frames).toHaveLength(1);

    canvas.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    expect(service.snapshot().pointerLockFailureCount).toBe(1);
    windowTarget.dispatchEvent(keyEvent("keydown", "KeyW"));
    documentTarget.pointerLockElement = canvas as unknown as Element;
    documentTarget.dispatchEvent(new Event("pointerlockchange"));
    documentTarget.dispatchEvent(mouseMove(8, -3));
    documentTarget.dispatchEvent(mouseMove(5, 2));
    windowTarget.dispatchEvent(keyEvent("keydown", "KeyE"));
    windowTarget.flush();

    expect(frames).toHaveLength(2);
    expect(frames[1]).toMatchObject({ forward: 1, interactPressed: true, sequence: 1 });
    expect(frames[1]?.yawRadians).not.toBe(0);
    expect(service.snapshot()).toMatchObject({
      emittedFrameCount: 2,
      interactionPressCount: 1,
      pointerLockAcquisitionCount: 1,
      pointerLocked: true,
      uiSuppressed: false,
    });

    service.setUiSuppressed(true);
    expect(service.snapshot()).toMatchObject({ pointerLocked: false, uiSuppressed: true });
    windowTarget.dispatchEvent(keyEvent("keydown", "KeyW"));
    windowTarget.flush();
    expect(frames.at(-1)).toMatchObject({ forward: 0 });
    service.setUiSuppressed(false);
    await Promise.resolve();
    expect(service.snapshot()).toMatchObject({ uiSuppressed: false });

    windowTarget.dispatchEvent(keyEvent("keyup", "KeyW"));
    windowTarget.flush();
    expect(frames[2]).toMatchObject({ forward: 0, interactPressed: false });

    const replacementCanvas = new FakeCanvas(documentTarget);
    service.rebindCanvas(replacementCanvas as unknown as HTMLCanvasElement);
    expect(service.snapshot().pointerLocked).toBe(false);
    replacementCanvas.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    expect(service.snapshot().pointerLockFailureCount).toBe(3);
    documentTarget.pointerLockElement = replacementCanvas as unknown as Element;
    documentTarget.dispatchEvent(new Event("pointerlockchange"));
    windowTarget.dispatchEvent(keyEvent("keydown", "KeyD"));
    windowTarget.flush();
    expect(frames.at(-1)).toMatchObject({ right: 1 });
    service.dispose();
    expect(service.snapshot().state).toBe("disposed");
  });

  it("retains a terminal failure while disposal removes its listeners", () => {
    const documentTarget = new FakeDocument();
    const windowTarget = new FakeWindow();
    const canvas = new FakeCanvas(documentTarget);
    const service = createGameplayInputService(
      documentTarget as unknown as Document,
      windowTarget as unknown as Window,
    );

    service.start(canvas as unknown as HTMLCanvasElement, () => {
      throw new Error("input sink failed");
    });
    windowTarget.flush();
    expect(service.snapshot()).toMatchObject({
      failureMessage: "input sink failed",
      state: "failed",
    });

    service.dispose();
    service.dispose();
    expect(service.snapshot()).toMatchObject({
      failureMessage: "input sink failed",
      pointerLocked: false,
      state: "failed",
    });
  });
});

function keyEvent(type: "keydown" | "keyup", code: string): KeyboardEvent {
  const event = new Event(type);
  Object.defineProperties(event, {
    code: { value: code },
    repeat: { value: false },
  });
  return event as KeyboardEvent;
}

function mouseMove(movementX: number, movementY: number): MouseEvent {
  const event = new Event("mousemove");
  Object.defineProperties(event, {
    movementX: { value: movementX },
    movementY: { value: movementY },
  });
  return event as MouseEvent;
}
