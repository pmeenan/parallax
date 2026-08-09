import type {
  GameplayInputFrame,
  GameplayInputService,
  RenderGameplayPresentation,
  RenderService,
  SimulationCommand,
  SimulationSemanticEvent,
  SimulationService,
  SimulationWorldDefinition,
  WorldStreamingService,
} from "@parallax/engine";
import { describe, expect, it } from "vitest";
import {
  createM3GameplayRuntime,
  type M3GameplayInteraction,
} from "../src/sim/m3-gameplay-runtime";

describe("M3 gameplay runtime", () => {
  it("keeps app orchestration generic and yields presentation/observer ownership to scenarios", () => {
    let inputListener: ((frame: GameplayInputFrame) => void) | null = null;
    let eventListener: ((events: readonly SimulationSemanticEvent[]) => void) | null = null;
    let canvasListener: ((canvas: HTMLCanvasElement) => void) | null = null;
    let simulationListener: ((snapshot: ReturnType<SimulationService["snapshot"]>) => void) | null =
      null;
    let simulationSnapshot = {
      highestAcceptedCommandSequence: -1,
      loadCount: 0,
      rejectedCommandCount: 0,
      state: "running" as const,
      tick: 10,
    } as ReturnType<SimulationService["snapshot"]>;
    let sampledPosition: readonly [number, number, number] = [2, 3, 4];
    let sampledCrowdPosition: readonly [number, number, number] = [8, 2, 9];
    const commands: SimulationCommand[] = [];
    const presentations: RenderGameplayPresentation[] = [];
    const observers: (readonly [number, number, number])[][] = [];
    const reboundCanvases: HTMLCanvasElement[] = [];
    let emitCurrentFrameCount = 0;
    const input = {
      dispose: () => undefined,
      emitCurrentFrame: () => {
        emitCurrentFrameCount += 1;
      },
      rebindCanvas: (canvas: HTMLCanvasElement) => reboundCanvases.push(canvas),
      snapshot: () => ({ state: "idle" }),
      start: (_canvas: HTMLCanvasElement, listener: (frame: GameplayInputFrame) => void) => {
        inputListener = listener;
      },
      subscribe: () => () => undefined,
    } as unknown as GameplayInputService;
    const render = {
      setGameplayPresentation: (presentation: RenderGameplayPresentation) =>
        presentations.push(presentation),
      snapshot: () => ({ state: "ready" }),
      subscribeCanvas: (listener: (canvas: HTMLCanvasElement) => void) => {
        canvasListener = listener;
        return () => undefined;
      },
    } as unknown as RenderService;
    const simulation = {
      enqueue: (command: SimulationCommand) => commands.push(command),
      samplePresentation: () => ({
        entities: [
          { id: 1, position: sampledPosition, yawRadians: 0.5 },
          { id: 1_000, position: sampledCrowdPosition, yawRadians: -0.25 },
        ],
        stateHash: "a".repeat(64),
        tick: 12,
      }),
      snapshot: () => simulationSnapshot,
      subscribe: (listener: (snapshot: ReturnType<SimulationService["snapshot"]>) => void) => {
        simulationListener = listener;
        listener(simulationSnapshot);
        return () => undefined;
      },
      subscribeEvents: (listener: (events: readonly SimulationSemanticEvent[]) => void) => {
        eventListener = listener;
        return () => undefined;
      },
    } as unknown as SimulationService;
    const streaming = {
      setObservers: (next: (readonly [number, number, number])[]) => observers.push(next),
      snapshot: () => ({ state: "streaming" }),
    } as unknown as WorldStreamingService;
    const world = {
      markers: [{ id: "nearby-transition", kind: "transition", position: [0, 0, 0], tags: [] }],
    } as unknown as SimulationWorldDefinition;
    const runtime = createM3GameplayRuntime(input, render, simulation, streaming, world);

    const initialCanvas = {} as HTMLCanvasElement;
    const replacementCanvas = {} as HTMLCanvasElement;
    const publishCanvas = canvasListener as ((canvas: HTMLCanvasElement) => void) | null;
    if (publishCanvas === null) throw new Error("Render canvas subscription is missing");
    publishCanvas(initialCanvas);
    runtime.maybeStartInput(true);
    const activeInput = inputListener as ((frame: GameplayInputFrame) => void) | null;
    if (activeInput === null) throw new Error("Gameplay input did not start");
    activeInput({
      cameraPitchRadians: 0.2,
      forward: 1,
      interactPressed: true,
      right: 0,
      sequence: 0,
      yawRadians: 0.5,
    });
    expect(commands).toMatchObject([{ kind: "player.input-axes@2", sequence: 0, targetTick: 13 }]);

    publishCanvas(replacementCanvas);
    expect(reboundCanvases).toEqual([replacementCanvas]);

    simulationSnapshot = {
      ...simulationSnapshot,
      highestAcceptedCommandSequence: 41,
      loadCount: 1,
      tick: 4,
    };
    const publishSimulation = simulationListener as
      | ((snapshot: ReturnType<SimulationService["snapshot"]>) => void)
      | null;
    if (publishSimulation === null) throw new Error("Simulation subscription is missing");
    publishSimulation(simulationSnapshot);
    expect(emitCurrentFrameCount).toBe(1);
    activeInput({
      cameraPitchRadians: 0.2,
      forward: 0,
      interactPressed: false,
      right: 0,
      sequence: 1,
      yawRadians: 0.5,
    });
    expect(commands.at(-1)).toMatchObject({ sequence: 42, targetTick: 7 });

    runtime.update(100, true, true);
    expect(presentations).toEqual([]);
    expect(observers).toEqual([]);
    runtime.update(100, false, true);
    expect(presentations).toMatchObject([
      {
        cameraPitchRadians: 0.2,
        crowdEntities: [{ id: 1_000, position: [8, 2, 9], yawRadians: -0.25 }],
        playerPosition: [2, 3, 4],
        playerYawRadians: 0.5,
      },
    ]);
    expect(observers).toEqual([[[2, 3, 4]]]);

    runtime.update(116, false, true);
    expect(presentations).toHaveLength(1);
    sampledCrowdPosition = [8.125, 2, 9];
    runtime.update(125, false, true);
    expect(presentations).toHaveLength(2);
    sampledPosition = [2.125, 3, 4];
    runtime.update(133, false, true);
    expect(presentations).toMatchObject([
      { playerPosition: [2, 3, 4] },
      { crowdEntities: [{ position: [8.125, 2, 9] }] },
      { playerPosition: [2.125, 3, 4] },
    ]);

    publishSimulation({ ...simulationSnapshot, rejectedCommandCount: 1 });
    expect(emitCurrentFrameCount).toBe(2);

    const interactions: M3GameplayInteraction[] = [];
    runtime.subscribeInteractions((interaction) => interactions.push(interaction));
    const activeEvents = eventListener as
      | ((events: readonly SimulationSemanticEvent[]) => void)
      | null;
    if (activeEvents === null) throw new Error("Gameplay event subscription is missing");
    const payload = new Uint8Array(4);
    new DataView(payload.buffer).setUint32(0, 0, true);
    activeEvents([{ kind: "interaction.activated", payload, sequence: 0, tick: 1 }]);
    expect(interactions).toEqual([{ kind: "transition", markerId: "nearby-transition" }]);
  });
});
