export const GAMEPLAY_INPUT_TELEMETRY_SCHEMA_VERSION = 2;

export interface GameplayInputFrame {
  readonly cameraPitchRadians: number;
  // Bitfield of combat action press edges since the last frame; the bit vocabulary is
  // game-owned (the engine captures buttons, the game assigns meaning).
  readonly combatBlockHeld: boolean;
  readonly combatPressed: number;
  readonly forward: number;
  readonly interactPressed: boolean;
  readonly right: number;
  readonly sequence: number;
  readonly yawRadians: number;
}

// Combat button bit assignments captured by this service. The game maps these to its
// input command; keep in sync with game/src/sim/m3-combat-system.ts.
export const GAMEPLAY_COMBAT_BUTTON_BITS = Object.freeze({
  aetherspark: 128,
  debugSpawn: 256,
  dodge: 4,
  heavy: 2,
  light: 1,
  slot1: 8,
  slot2: 16,
  slot3: 32,
  slot4: 64,
});

export interface GameplayInputTelemetrySnapshot {
  readonly emittedFrameCount: number;
  readonly failureMessage: string | null;
  readonly interactionPressCount: number;
  readonly pointerLockAcquisitionCount: number;
  readonly pointerLockFailureCount: number;
  readonly pointerLocked: boolean;
  readonly schemaVersion: typeof GAMEPLAY_INPUT_TELEMETRY_SCHEMA_VERSION;
  readonly state: "idle" | "running" | "disposed" | "failed";
  readonly uiSuppressed: boolean;
}

export interface GameplayInputService {
  dispose(): void;
  emitCurrentFrame(): void;
  rebindCanvas(canvas: HTMLCanvasElement): void;
  setUiSuppressed(suppressed: boolean): void;
  snapshot(): GameplayInputTelemetrySnapshot;
  start(canvas: HTMLCanvasElement, listener: (frame: GameplayInputFrame) => void): void;
  subscribe(listener: (snapshot: GameplayInputTelemetrySnapshot) => void): () => void;
}

const COMBAT_KEY_BITS: Readonly<Record<string, number>> = Object.freeze({
  Digit1: GAMEPLAY_COMBAT_BUTTON_BITS.slot1,
  Digit2: GAMEPLAY_COMBAT_BUTTON_BITS.slot2,
  Digit3: GAMEPLAY_COMBAT_BUTTON_BITS.slot3,
  Digit4: GAMEPLAY_COMBAT_BUTTON_BITS.slot4,
  KeyF: GAMEPLAY_COMBAT_BUTTON_BITS.aetherspark,
  KeyG: GAMEPLAY_COMBAT_BUTTON_BITS.debugSpawn,
  KeyQ: GAMEPLAY_COMBAT_BUTTON_BITS.heavy,
  ShiftLeft: GAMEPLAY_COMBAT_BUTTON_BITS.dodge,
  ShiftRight: GAMEPLAY_COMBAT_BUTTON_BITS.dodge,
});

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
  let pendingCombatPressed = 0;
  let blockButtonHeld = false;
  let disposed = false;
  let uiSuppressed = false;
  let restorePointerLockAfterUi = false;
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
    const combatPressed = pendingCombatPressed;
    pendingCombatPressed = 0;
    const active = frameListener;
    if (active === null || telemetry.state !== "running" || uiSuppressed) return;
    const forward =
      Number(pressed.has("KeyW") || pressed.has("ArrowUp")) -
      Number(pressed.has("KeyS") || pressed.has("ArrowDown"));
    const right = Number(pressed.has("KeyD")) - Number(pressed.has("KeyA"));
    const frame = Object.freeze({
      cameraPitchRadians,
      combatBlockHeld: blockButtonHeld,
      combatPressed,
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
    if (pendingAnimationFrame !== null || telemetry.state !== "running" || uiSuppressed) return;
    pendingAnimationFrame = windowTarget.requestAnimationFrame(emit);
  };
  const scheduleCombat = (bits: number): void => {
    pendingCombatPressed |= bits;
    scheduleEmit();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (
      event.repeat ||
      uiSuppressed ||
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
    const combatBit = COMBAT_KEY_BITS[event.code];
    if (combatBit !== undefined) {
      scheduleCombat(combatBit);
      return;
    }
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown"].includes(event.code)) {
      pressed.add(event.code);
      scheduleEmit();
    }
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (uiSuppressed) return;
    if (pressed.delete(event.code)) scheduleEmit();
  };
  const onMouseDown = (event: MouseEvent): void => {
    if (
      uiSuppressed ||
      telemetry.state !== "running" ||
      documentTarget.pointerLockElement !== canvas
    ) {
      return;
    }
    if (event.button === 0) scheduleCombat(GAMEPLAY_COMBAT_BUTTON_BITS.light);
    if (event.button === 2) {
      blockButtonHeld = true;
      scheduleEmit();
    }
  };
  const onMouseUp = (event: MouseEvent): void => {
    if (event.button !== 2 || !blockButtonHeld) return;
    blockButtonHeld = false;
    if (!uiSuppressed && telemetry.state === "running") scheduleEmit();
  };
  const onContextMenu = (event: Event): void => {
    if (documentTarget.pointerLockElement === canvas) event.preventDefault();
  };
  const onMouseMove = (event: MouseEvent): void => {
    if (
      uiSuppressed ||
      documentTarget.pointerLockElement !== canvas ||
      telemetry.state !== "running"
    )
      return;
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
    if (!uiSuppressed) requestPointerLock();
  };
  const requestPointerLock = (): void => {
    if (canvas === null || documentTarget.pointerLockElement === canvas) return;
    void canvas.requestPointerLock().catch(() => {
      publish({
        ...telemetry,
        pointerLockFailureCount: telemetry.pointerLockFailureCount + 1,
      });
    });
  };
  const onBlur = (): void => {
    if (pressed.size === 0 && !blockButtonHeld && pendingCombatPressed === 0) return;
    pressed.clear();
    blockButtonHeld = false;
    pendingCombatPressed = 0;
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
      documentTarget.removeEventListener("contextmenu", onContextMenu);
      documentTarget.removeEventListener("mousedown", onMouseDown);
      documentTarget.removeEventListener("mousemove", onMouseMove);
      documentTarget.removeEventListener("mouseup", onMouseUp);
      documentTarget.removeEventListener("pointerlockchange", onPointerLockChange);
      windowTarget.removeEventListener("blur", onBlur);
      windowTarget.removeEventListener("keydown", onKeyDown);
      windowTarget.removeEventListener("keyup", onKeyUp);
      pressed.clear();
      if (pendingAnimationFrame !== null) windowTarget.cancelAnimationFrame(pendingAnimationFrame);
      pendingAnimationFrame = null;
      pendingInteractPressed = false;
      pendingCombatPressed = 0;
      blockButtonHeld = false;
      uiSuppressed = false;
      restorePointerLockAfterUi = false;
      canvas = null;
      frameListener = null;
      publish({
        ...telemetry,
        pointerLocked: false,
        state: telemetry.state === "failed" ? "failed" : "disposed",
        uiSuppressed: false,
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
      pendingCombatPressed = 0;
      blockButtonHeld = false;
      attachCanvas(targetCanvas);
      scheduleEmit();
    },
    setUiSuppressed(suppressed: boolean): void {
      if (telemetry.state === "disposed" || telemetry.state === "failed") return;
      if (uiSuppressed === suppressed) return;
      if (telemetry.state === "idle") {
        uiSuppressed = suppressed;
        publish({ ...telemetry, uiSuppressed: suppressed });
        return;
      }
      if (suppressed) {
        if (pendingAnimationFrame !== null) {
          windowTarget.cancelAnimationFrame(pendingAnimationFrame);
          pendingAnimationFrame = null;
        }
        pressed.clear();
        pendingInteractPressed = false;
        pendingCombatPressed = 0;
        blockButtonHeld = false;
        emit();
        restorePointerLockAfterUi = documentTarget.pointerLockElement === canvas;
        uiSuppressed = true;
        publish({ ...telemetry, uiSuppressed: true });
        if (restorePointerLockAfterUi) documentTarget.exitPointerLock();
        return;
      }
      uiSuppressed = false;
      publish({ ...telemetry, uiSuppressed: false });
      if (restorePointerLockAfterUi) requestPointerLock();
      restorePointerLockAfterUi = false;
      scheduleEmit();
    },
    snapshot(): GameplayInputTelemetrySnapshot {
      return telemetry;
    },
    start(targetCanvas: HTMLCanvasElement, listener: (frame: GameplayInputFrame) => void): void {
      if (telemetry.state !== "idle") throw new Error("Gameplay input can only be started once");
      frameListener = listener;
      attachCanvas(targetCanvas);
      documentTarget.addEventListener("contextmenu", onContextMenu);
      documentTarget.addEventListener("mousedown", onMouseDown);
      documentTarget.addEventListener("mousemove", onMouseMove);
      documentTarget.addEventListener("mouseup", onMouseUp);
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
    uiSuppressed: false,
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}
