import { describe, expect, it } from "vitest";
import type {
  GameSimulationAdapter,
  GameSimulationModule,
  SimulationCommand,
  SimulationPresentationEntity,
  SimulationStepResult,
} from "../src/sim/simulation-protocol";
import {
  MAXIMUM_SIMULATION_REPLAY_COMMANDS,
  MAXIMUM_SIMULATION_REPLAY_TICKS,
} from "../src/sim/simulation-protocol";
import {
  createSimulationRuntime,
  interpolateSimulationSnapshots,
  runSimulationModuleReplay,
  runSimulationReplay,
} from "../src/sim/simulation-runtime";

interface TestState {
  readonly value: number;
}

const adapter: GameSimulationAdapter<TestState> = Object.freeze({
  applyCommand(state: TestState, command: SimulationCommand): SimulationStepResult<TestState> {
    const value = new DataView(
      command.payload.buffer,
      command.payload.byteOffset,
      command.payload.byteLength,
    ).getInt32(0, true);
    return Object.freeze({
      events: Object.freeze([
        Object.freeze({ kind: "input.command-applied", payload: command.payload.slice() }),
      ]),
      state: Object.freeze({ value: state.value + value }),
    });
  },
  createInitialState(seed: number): TestState {
    return Object.freeze({ value: seed });
  },
  deserializeState(bytes: Uint8Array): TestState {
    return Object.freeze({ value: new DataView(bytes.buffer, bytes.byteOffset).getInt32(0, true) });
  },
  presentationSnapshot(state: TestState): readonly SimulationPresentationEntity[] {
    return Object.freeze([
      Object.freeze({
        id: 1,
        position: Object.freeze([state.value, 0, 0]) as readonly [number, number, number],
        yawRadians: 0,
      }),
    ]);
  },
  serializeState(state: TestState): Uint8Array {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setInt32(0, state.value, true);
    return bytes;
  },
  step(state: TestState): SimulationStepResult<TestState> {
    return Object.freeze({ events: Object.freeze([]), state });
  },
});

function command(sequence: number, targetTick: number, value: number): SimulationCommand {
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setInt32(0, value, true);
  return Object.freeze({ kind: "test", payload, sequence, targetTick });
}

describe("simulation runtime", () => {
  it("applies tick-stamped commands in deterministic order and rejects late or duplicate input", () => {
    const runtime = createSimulationRuntime(adapter, 7, 60);
    expect(runtime.enqueue(command(0, 2, 5))).toBe(true);
    expect(runtime.enqueue(command(1, 2, 3))).toBe(true);
    expect(runtime.enqueue(command(0, 3, 9))).toBe(false);
    expect(runtime.enqueue(command(2, 1, 9))).toBe(false);
    expect(runtime.step()).toMatchObject({ appliedCommandCount: 0, events: [] });
    expect(runtime.step()).toMatchObject({ appliedCommandCount: 2 });
    expect(runtime.save().presentation.entities[0]?.position[0]).toBe(15);
    expect(runtime.enqueue(command(2, 2, 1))).toBe(false);
  });

  it("round-trips versioned saves, rejects corruption, and preserves the state hash", () => {
    const runtime = createSimulationRuntime(adapter, 11, 60);
    runtime.enqueue(command(0, 1, 4));
    runtime.step();
    const saved = runtime.save();
    const restored = createSimulationRuntime(adapter, 99, 60);
    const loaded = restored.load(saved.saveBytes);
    expect(loaded.presentation).toEqual(saved.presentation);
    expect(restored.tick).toBe(1);
    const corrupt = saved.saveBytes.slice();
    const finalIndex = corrupt.length - 1;
    corrupt[finalIndex] = (corrupt[finalIndex] ?? 0) ^ 1;
    expect(() => restored.load(corrupt)).toThrow(/digest/);
  });

  it("binds every semantic save-header field under the envelope digest", () => {
    const runtime = createSimulationRuntime(adapter, 11, 60);
    runtime.enqueue(command(0, 1, 4));
    runtime.step();
    const saved = runtime.save().saveBytes;
    for (const offset of [8, 12, 16, 24, 32, 40, 44]) {
      const corrupt = saved.slice();
      corrupt[offset] = (corrupt[offset] ?? 0) ^ 1;
      expect(() => createSimulationRuntime(adapter, 0, 60).load(corrupt)).toThrow(/digest/);
    }
  });

  it("preserves future ordered commands across save/load", () => {
    const runtime = createSimulationRuntime(adapter, 1, 60);
    runtime.enqueue(command(0, 3, 8));
    const saved = runtime.save();
    const restored = createSimulationRuntime(adapter, 99, 60);
    restored.load(saved.saveBytes);
    expect(restored.queuedCommandCount).toBe(1);
    restored.step();
    restored.step();
    expect(restored.step()).toMatchObject({ appliedCommandCount: 1 });
    expect(restored.save().presentation.entities[0]?.position[0]).toBe(9);
  });

  it("leaves the live authority unchanged when candidate load validation fails", () => {
    const source = createSimulationRuntime(adapter, 1, 60).save();
    const rejectingAdapter: GameSimulationAdapter<TestState> = Object.freeze({
      ...adapter,
      presentationSnapshot(state: TestState): readonly SimulationPresentationEntity[] {
        if (state.value === 1) throw new Error("candidate presentation rejected");
        return adapter.presentationSnapshot(state);
      },
    });
    const target = createSimulationRuntime(rejectingAdapter, 5, 60);
    expect(() => target.load(source.saveBytes)).toThrow(/candidate presentation/);
    expect(target.save().presentation.entities[0]?.position[0]).toBe(5);
    expect(target.tick).toBe(0);
  });

  it("preserves safe command sequences beyond the signed 32-bit range", () => {
    const sequence = 0x8000_0000;
    const runtime = createSimulationRuntime(adapter, 1, 60);
    expect(runtime.enqueue(command(sequence, 3, 8))).toBe(true);
    const restored = createSimulationRuntime(adapter, 99, 60);
    restored.load(runtime.save().saveBytes);
    expect(restored.enqueue(command(sequence + 1, 4, 1))).toBe(true);
  });

  it("continues semantic event sequence identity across save/load", () => {
    const runtime = createSimulationRuntime(adapter, 1, 60);
    runtime.enqueue(command(0, 1, 2));
    expect(runtime.step().events).toMatchObject([{ sequence: 0, tick: 1 }]);
    const restored = createSimulationRuntime(adapter, 0, 60);
    restored.load(runtime.save().saveBytes);
    restored.enqueue(command(1, 2, 3));
    expect(restored.step().events).toMatchObject([{ sequence: 1, tick: 2 }]);
  });

  it("replays the same command log to the same bytes and hash", () => {
    const commands = Object.freeze([command(0, 1, 2), command(1, 4, -5)]);
    const first = runSimulationReplay(adapter, 42, 60, commands, 10);
    const second = runSimulationReplay(adapter, 42, 60, commands, 10);
    expect(second.finalStateHash).toBe(first.finalStateHash);
    expect(second.finalSave).toEqual(first.finalSave);
  });

  it("creates an isolated game adapter for every module replay", () => {
    let adapterCreationCount = 0;
    const module: GameSimulationModule = Object.freeze({
      createGameSimulationAdapter(): GameSimulationAdapter<TestState> {
        adapterCreationCount += 1;
        return Object.freeze({ ...adapter });
      },
    });
    const liveRuntime = createSimulationRuntime(module.createGameSimulationAdapter(), 7, 60);
    const liveBeforeReplay = liveRuntime.save();
    runSimulationModuleReplay(module, 7, 60, [command(0, 1, 2)], 1);
    expect(adapterCreationCount).toBe(2);
    expect(liveRuntime.save()).toEqual(liveBeforeReplay);
  });

  it("bounds synchronous replay work before entering the tick loop", () => {
    expect(() =>
      runSimulationReplay(adapter, 1, 60, [], MAXIMUM_SIMULATION_REPLAY_TICKS + 1),
    ).toThrow(/tick count exceeds/);
  });

  it("admits the maximum ordered replay command batch without quadratic queue sorting", () => {
    const commands = Array.from({ length: MAXIMUM_SIMULATION_REPLAY_COMMANDS }, (_, sequence) =>
      command(sequence, 1, 0),
    );
    expect(runSimulationReplay(adapter, 1, 60, commands, 0)).toMatchObject({ tick: 0 });
  });

  it("interpolates matching stable entities without mutating authoritative snapshots", () => {
    const previous = Object.freeze({
      entities: Object.freeze([
        Object.freeze({
          id: 1,
          position: Object.freeze([0, 0, 0]) as readonly [number, number, number],
          yawRadians: 0,
        }),
      ]),
      stateHash: "a".repeat(64),
      tick: 1,
    });
    const current = Object.freeze({
      entities: Object.freeze([
        Object.freeze({
          id: 1,
          position: Object.freeze([10, 4, -2]) as readonly [number, number, number],
          yawRadians: Math.PI,
        }),
      ]),
      stateHash: "b".repeat(64),
      tick: 2,
    });
    expect(interpolateSimulationSnapshots(previous, current, 0.5)).toMatchObject({
      entities: [{ id: 1, position: [5, 2, -1] }],
      stateHash: "b".repeat(64),
      tick: 2,
    });
    expect(current.entities[0]?.position).toEqual([10, 4, -2]);
  });

  it("interpolates yaw over the shortest arc in both wrap directions", () => {
    const snapshot = (yawRadians: number) =>
      Object.freeze({
        entities: Object.freeze([
          Object.freeze({
            id: 1,
            position: Object.freeze([0, 0, 0]) as readonly [number, number, number],
            yawRadians,
          }),
        ]),
        stateHash: "a".repeat(64),
        tick: 1,
      });
    const positive = interpolateSimulationSnapshots(snapshot(3), snapshot(-3), 0.5);
    const negative = interpolateSimulationSnapshots(snapshot(-3), snapshot(3), 0.5);
    expect(Math.abs(positive.entities[0]?.yawRadians ?? 0)).toBeCloseTo(Math.PI);
    expect(Math.abs(negative.entities[0]?.yawRadians ?? 0)).toBeCloseTo(Math.PI);
  });
});
