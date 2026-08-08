export const GAMEPLAY_INPUT_TELEMETRY_SCHEMA_VERSION = 1;

export interface GameplayInputFrame {
  readonly cameraPitchRadians: number;
  readonly forward: number;
  readonly interactPressed: boolean;
  readonly right: number;
  readonly sequence: number;
  readonly yawRadians: number;
}

export interface GameplayInputTelemetrySnapshot {
  readonly emittedFrameCount: number;
  readonly failureMessage: string | null;
  readonly interactionPressCount: number;
  readonly pointerLockAcquisitionCount: number;
  readonly pointerLockFailureCount: number;
  readonly pointerLocked: boolean;
  readonly schemaVersion: typeof GAMEPLAY_INPUT_TELEMETRY_SCHEMA_VERSION;
  readonly state: "idle" | "running" | "disposed" | "failed";
}

export interface GameplayInputService {
  dispose(): void;
  emitCurrentFrame(): void;
  rebindCanvas(canvas: HTMLCanvasElement): void;
  snapshot(): GameplayInputTelemetrySnapshot;
  start(canvas: HTMLCanvasElement, listener: (frame: GameplayInputFrame) => void): void;
  subscribe(listener: (snapshot: GameplayInputTelemetrySnapshot) => void): () => void;
}

const YAW_RADIANS_PER_PIXEL = 0.0024;
const PITCH_RADIANS_PER_PIXEL = 0.0018;
const KEYBOARD_YAW_STEP_RADIANS = 0.08;
const MINIMUM_CAMERA_PITCH_RADIANS = -0.65;
const MAXIMUM_CAMERA_PITCH_RADIANS = 0.55;

export function createGameplayInputService(
  documentTarget: Document = document,
  windowTarget: Window = window,
): GameplayInputService {
  let telemetry = initialTelemetry();
  let canvas: HTMLCanvasElement | null = null;
  let frameListener: ((frame: GameplayInputFrame) => void) | null = null;
  let sequence = 0;
  let yawRadians = 0;
  let cameraPitchRadians = 0;
  let pendingAnimationFrame: number | null = null;
  let pendingInteractPressed = false;
  let disposed = false;
  const pressed = new Set<string>();
  const listeners = new Set<(snapshot: GameplayInputTelemetrySnapshot) => void>();

  const publish = (next: GameplayInputTelemetrySnapshot): void => {
    telemetry = Object.freeze(next);
    for (const listener of listeners) listener(telemetry);
  };
  const fail = (error: unknown): void => {
    publish({
      ...telemetry,
      failureMessage: error instanceof Error ? error.message : String(error),
      state: "failed",
    });
  };
  const emit = (): void => {
    pendingAnimationFrame = null;
    const interactPressed = pendingInteractPressed;
    pendingInteractPressed = false;
    const active = frameListener;
    if (active === null || telemetry.state !== "running") return;
    const forward =
      Number(pressed.has("KeyW") || pressed.has("ArrowUp")) -
      Number(pressed.has("KeyS") || pressed.has("ArrowDown"));
    const right = Number(pressed.has("KeyD")) - Number(pressed.has("KeyA"));
    const frame = Object.freeze({
      cameraPitchRadians,
      forward,
      interactPressed,
      right,
      sequence: sequence++,
      yawRadians,
    });
    try {
      active(frame);
      publish({
        ...telemetry,
        emittedFrameCount: telemetry.emittedFrameCount + 1,
        interactionPressCount: telemetry.interactionPressCount + Number(interactPressed),
      });
    } catch (error: unknown) {
      fail(error);
    }
  };
  const scheduleEmit = (interactPressed = false): void => {
    pendingInteractPressed ||= interactPressed;
    if (pendingAnimationFrame !== null || telemetry.state !== "running") return;
    pendingAnimationFrame = windowTarget.requestAnimationFrame(emit);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (
      event.repeat ||
      telemetry.state !== "running" ||
      (documentTarget.pointerLockElement !== canvas && documentTarget.activeElement !== canvas)
    ) {
      return;
    }
    if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
      yawRadians +=
        event.code === "ArrowLeft" ? -KEYBOARD_YAW_STEP_RADIANS : KEYBOARD_YAW_STEP_RADIANS;
      scheduleEmit();
      return;
    }
    if (event.code === "KeyE") {
      scheduleEmit(true);
      return;
    }
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown"].includes(event.code)) {
      pressed.add(event.code);
      scheduleEmit();
    }
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (pressed.delete(event.code)) scheduleEmit();
  };
  const onMouseMove = (event: MouseEvent): void => {
    if (documentTarget.pointerLockElement !== canvas || telemetry.state !== "running") return;
    yawRadians = normalizeAngle(yawRadians + event.movementX * YAW_RADIANS_PER_PIXEL);
    cameraPitchRadians = clamp(
      cameraPitchRadians - event.movementY * PITCH_RADIANS_PER_PIXEL,
      MINIMUM_CAMERA_PITCH_RADIANS,
      MAXIMUM_CAMERA_PITCH_RADIANS,
    );
    scheduleEmit();
  };
  const onPointerLockChange = (): void => {
    const pointerLocked = documentTarget.pointerLockElement === canvas;
    publish({
      ...telemetry,
      pointerLockAcquisitionCount:
        telemetry.pointerLockAcquisitionCount + Number(pointerLocked && !telemetry.pointerLocked),
      pointerLocked,
    });
  };
  const onPointerDown = (): void => {
    canvas?.focus();
    if (documentTarget.pointerLockElement !== canvas) {
      void canvas?.requestPointerLock().catch(() => {
        publish({
          ...telemetry,
          pointerLockFailureCount: telemetry.pointerLockFailureCount + 1,
        });
      });
    }
  };
  const onBlur = (): void => {
    if (pressed.size === 0) return;
    pressed.clear();
    scheduleEmit();
  };
  const detachCanvas = (): void => {
    canvas?.removeEventListener("pointerdown", onPointerDown);
    canvas?.removeEventListener("blur", onBlur);
  };
  const attachCanvas = (nextCanvas: HTMLCanvasElement): void => {
    detachCanvas();
    canvas = nextCanvas;
    nextCanvas.tabIndex = 0;
    nextCanvas.addEventListener("pointerdown", onPointerDown);
    nextCanvas.addEventListener("blur", onBlur);
    publish({ ...telemetry, pointerLocked: documentTarget.pointerLockElement === nextCanvas });
  };

  return Object.freeze({
    dispose(): void {
      if (disposed) return;
      disposed = true;
      detachCanvas();
      documentTarget.removeEventListener("mousemove", onMouseMove);
      documentTarget.removeEventListener("pointerlockchange", onPointerLockChange);
      windowTarget.removeEventListener("blur", onBlur);
      windowTarget.removeEventListener("keydown", onKeyDown);
      windowTarget.removeEventListener("keyup", onKeyUp);
      pressed.clear();
      if (pendingAnimationFrame !== null) windowTarget.cancelAnimationFrame(pendingAnimationFrame);
      pendingAnimationFrame = null;
      pendingInteractPressed = false;
      canvas = null;
      frameListener = null;
      publish({
        ...telemetry,
        pointerLocked: false,
        state: telemetry.state === "failed" ? "failed" : "disposed",
      });
    },
    emitCurrentFrame(): void {
      if (telemetry.state !== "running") {
        throw new Error("Gameplay input can only emit while running");
      }
      scheduleEmit();
    },
    rebindCanvas(targetCanvas: HTMLCanvasElement): void {
      if (telemetry.state !== "running") {
        throw new Error("Gameplay input canvas can only be rebound while running");
      }
      if (canvas === targetCanvas) return;
      pressed.clear();
      pendingInteractPressed = false;
      attachCanvas(targetCanvas);
      scheduleEmit();
    },
    snapshot(): GameplayInputTelemetrySnapshot {
      return telemetry;
    },
    start(targetCanvas: HTMLCanvasElement, listener: (frame: GameplayInputFrame) => void): void {
      if (telemetry.state !== "idle") throw new Error("Gameplay input can only be started once");
      frameListener = listener;
      attachCanvas(targetCanvas);
      documentTarget.addEventListener("mousemove", onMouseMove);
      documentTarget.addEventListener("pointerlockchange", onPointerLockChange);
      windowTarget.addEventListener("blur", onBlur);
      windowTarget.addEventListener("keydown", onKeyDown);
      windowTarget.addEventListener("keyup", onKeyUp);
      publish({ ...telemetry, state: "running" });
      scheduleEmit();
    },
    subscribe(listener: (snapshot: GameplayInputTelemetrySnapshot) => void): () => void {
      listeners.add(listener);
      listener(telemetry);
      return () => listeners.delete(listener);
    },
  });
}

function initialTelemetry(): GameplayInputTelemetrySnapshot {
  return Object.freeze({
    emittedFrameCount: 0,
    failureMessage: null,
    interactionPressCount: 0,
    pointerLockAcquisitionCount: 0,
    pointerLockFailureCount: 0,
    pointerLocked: false,
    schemaVersion: GAMEPLAY_INPUT_TELEMETRY_SCHEMA_VERSION,
    state: "idle",
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}
