import type {
  SimulationPresentationSnapshot,
  SimulationSemanticEvent,
  SimulationService,
  SimulationTelemetrySnapshot,
  SpatialAudioService,
  WorldStreamingService,
} from "@parallax/engine";
import { describe, expect, it, vi } from "vitest";
import { createGameplayAudioController } from "../src/audio/gameplay-audio";

describe("game audio event and authority bridge", () => {
  it("routes current entity positions once and clears old worlds, timelines, missing players and scenarios", () => {
    let events!: (events: readonly SimulationSemanticEvent[]) => void;
    let authority!: () => void;
    let simChanged!: (snapshot: SimulationTelemetrySnapshot) => void;
    let worldChanged!: () => void;
    let world = { districtId: "surface", districtSwapInProgress: false, state: "streaming" };
    let simulationSnapshot = { state: "running", loadCount: 0 } as SimulationTelemetrySnapshot;
    let presentation: SimulationPresentationSnapshot = {
      entities: [
        { id: 1, position: [0, 0, 0], yawRadians: 0 },
        { id: 7, position: [2, 3, 4], yawRadians: 0 },
      ],
      stateHash: "a".repeat(64),
      tick: 5,
    };
    const unsubscribe = vi.fn();
    const simulation = {
      samplePresentation: () => presentation,
      snapshot: () => simulationSnapshot,
      subscribeEvents: (listener: typeof events) => {
        events = listener;
        return unsubscribe;
      },
      subscribeAuthorityChanges: (listener: typeof authority) => {
        authority = listener;
        return unsubscribe;
      },
      subscribe: (listener: typeof simChanged) => {
        simChanged = listener;
        return unsubscribe;
      },
    } as unknown as SimulationService;
    const streaming = {
      snapshot: () => world,
      subscribe: (listener: typeof worldChanged) => {
        worldChanged = listener;
        return unsubscribe;
      },
    } as unknown as WorldStreamingService;
    const audio = {
      snapshot: () => ({ state: "running" }),
      setScene: vi.fn(),
      setListener: vi.fn(),
      updateEmitters: vi.fn(),
      play: vi.fn(),
    } as unknown as SpatialAudioService;
    const controller = createGameplayAudioController(audio, simulation, streaming, "surface");
    const event = (sequence: number): SimulationSemanticEvent => {
      const payload = new Uint8Array(16);
      const view = new DataView(payload.buffer);
      view.setUint32(0, 1, true);
      view.setUint32(4, 7, true);
      return { kind: "combat.hit", payload, sequence, tick: 5 };
    };
    events([event(1)]);
    expect(audio.play).not.toHaveBeenCalled();
    controller.update(presentation, 0, true);
    events([event(2), event(2)]);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.play).toHaveBeenLastCalledWith(
      expect.objectContaining({ emitterId: 7, position: [2, 3, 4], sceneId: "surface" }),
    );
    expect(audio.setListener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        position: [expect.any(Number), expect.any(Number), expect.any(Number)],
      }),
    );
    controller.update(presentation, 0, false);
    events([event(3)]);
    expect(audio.setScene).toHaveBeenLastCalledWith(null);
    expect(audio.play).toHaveBeenCalledTimes(1);
    controller.update(presentation, 0, true);
    world = { ...world, districtSwapInProgress: true };
    worldChanged();
    events([event(4)]);
    expect(audio.setScene).toHaveBeenLastCalledWith(null);
    world = { ...world, districtId: "underground", districtSwapInProgress: false };
    worldChanged();
    controller.update(presentation, 0, true);
    events([event(5)]);
    expect(audio.play).toHaveBeenCalledTimes(1);
    world = { ...world, districtId: "surface" };
    controller.update(presentation, 0, true);
    authority();
    expect(audio.setScene).toHaveBeenLastCalledWith(null);
    controller.update(presentation, 0, true);
    events([event(50)]);
    simulationSnapshot = { ...simulationSnapshot, loadCount: 1 };
    simChanged(simulationSnapshot);
    controller.update(presentation, 0, true);
    events([event(1)]);
    expect(audio.play).toHaveBeenCalledTimes(3);
    presentation = { ...presentation, entities: [] };
    controller.update(presentation, 0, true);
    events([event(2)]);
    expect(audio.setScene).toHaveBeenLastCalledWith(null);
    expect(audio.play).toHaveBeenCalledTimes(3);
    controller.dispose();
    controller.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(4);
  });
});
