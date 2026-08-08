import type {
  GameplayInputService,
  RenderService,
  SimulationService,
  SimulationWorldDefinition,
  WorldStreamingService,
} from "@parallax/engine";
import { createPlayerInputCommand, PLAYER_ENTITY_ID } from "./m3-simulation";

export interface M3GameplayRuntime {
  dispose(): void;
  maybeStartInput(interactiveEnabled: boolean): void;
  subscribeInteractions(listener: (markerId: string) => void): () => void;
  update(timestamp: number, scenarioOwned: boolean, interactiveEnabled: boolean): void;
}

export function createM3GameplayRuntime(
  inputService: GameplayInputService,
  renderService: RenderService,
  simulationService: SimulationService,
  streamingService: WorldStreamingService,
  world: SimulationWorldDefinition,
): M3GameplayRuntime {
  let latestCameraPitchRadians = 0;
  let activeCanvas: HTMLCanvasElement | null = null;
  let disposed = false;
  let inputStarted = false;
  let nextInputCommandSequence = 0;
  let observedLoadCount = simulationService.snapshot().loadCount;
  let observedRejectedCommandCount = simulationService.snapshot().rejectedCommandCount;
  let presentationSequence = 0;
  let lastPresentedPitch = Number.NaN;
  let lastPresentedYaw = Number.NaN;
  let lastPresentedPosition: readonly [number, number, number] = [
    Number.NaN,
    Number.NaN,
    Number.NaN,
  ];
  let lastStreamingObserverAt = 0;
  const interactionListeners = new Set<(markerId: string) => void>();
  const unsubscribeEvents = simulationService.subscribeEvents((events) => {
    for (const event of events) {
      if (event.kind !== "interaction.activated") continue;
      if (event.payload.byteLength !== Uint32Array.BYTES_PER_ELEMENT) {
        throw new Error("Interaction event marker payload is invalid");
      }
      const markerIndex = new DataView(
        event.payload.buffer,
        event.payload.byteOffset,
        event.payload.byteLength,
      ).getUint32(0, true);
      const marker = world.markers[markerIndex];
      if (marker === undefined || marker.kind !== "transition") {
        throw new Error("Interaction event references an invalid transition marker");
      }
      const markerId = marker.id;
      for (const listener of interactionListeners) listener(markerId);
    }
  });
  const unsubscribeCanvas = renderService.subscribeCanvas((canvas) => {
    activeCanvas = canvas;
    if (inputStarted) inputService.rebindCanvas(canvas);
  });
  const unsubscribeSimulation = simulationService.subscribe((snapshot) => {
    // A rejected command means an emitted input frame never reached the timeline (its
    // target tick fell behind the worker under main-thread or transport delay).
    // Re-emit current physical input so a dropped key release cannot leave stale
    // movement axes applied indefinitely.
    if (snapshot.rejectedCommandCount !== observedRejectedCommandCount) {
      observedRejectedCommandCount = snapshot.rejectedCommandCount;
      if (inputStarted) inputService.emitCurrentFrame();
    }
    if (snapshot.loadCount === observedLoadCount) return;
    observedLoadCount = snapshot.loadCount;
    nextInputCommandSequence = snapshot.highestAcceptedCommandSequence + 1;
    if (inputStarted) inputService.emitCurrentFrame();
  });

  return Object.freeze({
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribeCanvas();
      unsubscribeEvents();
      unsubscribeSimulation();
      inputService.dispose();
      interactionListeners.clear();
    },
    maybeStartInput(interactiveEnabled: boolean): void {
      if (
        disposed ||
        inputStarted ||
        !interactiveEnabled ||
        activeCanvas === null ||
        simulationService.snapshot().state !== "running" ||
        renderService.snapshot().state !== "ready"
      ) {
        return;
      }
      inputStarted = true;
      inputService.start(activeCanvas, (frame) => {
        latestCameraPitchRadians = frame.cameraPitchRadians;
        const snapshot = simulationService.snapshot();
        nextInputCommandSequence = Math.max(
          nextInputCommandSequence,
          snapshot.highestAcceptedCommandSequence + 1,
        );
        simulationService.enqueue(
          createPlayerInputCommand(nextInputCommandSequence++, snapshot.tick + 3, {
            forward: frame.forward,
            interactPressed: frame.interactPressed,
            right: frame.right,
            yawRadians: frame.yawRadians,
          }),
        );
      });
    },
    subscribeInteractions(listener: (markerId: string) => void): () => void {
      interactionListeners.add(listener);
      return () => interactionListeners.delete(listener);
    },
    update(timestamp: number, scenarioOwned: boolean, interactiveEnabled: boolean): void {
      if (disposed || scenarioOwned) return;
      const presentation = simulationService.samplePresentation(timestamp);
      const player = presentation?.entities.find((entity) => entity.id === PLAYER_ENTITY_ID);
      if (presentation === null || player === undefined) return;
      // Deduplicate on the interpolated pose, not the snapshot tick: interpolation
      // moves the presented transform between snapshot arrivals, so a tick gate
      // would freeze player/camera motion at the snapshot cadence.
      if (
        latestCameraPitchRadians === lastPresentedPitch &&
        player.yawRadians === lastPresentedYaw &&
        player.position[0] === lastPresentedPosition[0] &&
        player.position[1] === lastPresentedPosition[1] &&
        player.position[2] === lastPresentedPosition[2]
      ) {
        return;
      }
      renderService.setGameplayPresentation({
        cameraPitchRadians: latestCameraPitchRadians,
        playerPosition: player.position,
        playerYawRadians: player.yawRadians,
        sequence: presentationSequence++,
      });
      lastPresentedPitch = latestCameraPitchRadians;
      lastPresentedYaw = player.yawRadians;
      lastPresentedPosition = player.position;
      if (
        interactiveEnabled &&
        timestamp - lastStreamingObserverAt >= 100 &&
        streamingService.snapshot().state === "streaming"
      ) {
        streamingService.setObservers([player.position]);
        lastStreamingObserverAt = timestamp;
      }
    },
  });
}
