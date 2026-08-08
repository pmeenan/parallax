import {
  createSimulationRuntime,
  runSimulationReplay,
  simulationWorldDefinition,
} from "@parallax/engine";
import { describe, expect, it } from "vitest";
import {
  createGameSimulationAdapter,
  createPlayerInputCommand,
  PLAYER_ENTITY_ID,
} from "../src/sim/m3-simulation";
import { DISTRICT_1_GREYBOX_SPEC } from "../src/world/district-1.data";
import { createGreyboxScene } from "../src/world/greybox-generator";

const world = createGreyboxScene(DISTRICT_1_GREYBOX_SPEC).world;
const context = Object.freeze({ timestepHz: 60, world: simulationWorldDefinition(world) });

describe("M3 game simulation adapter", () => {
  it("uses stable identity and a canonical binary input/save representation", () => {
    const adapter = createGameSimulationAdapter(context);
    const runtime = createSimulationRuntime(adapter, 0x1234_5678, 60);
    expect(
      runtime.enqueue(createPlayerInputCommand(0, 1, { forward: 1, right: -0.5, yawRadians: 1 })),
    ).toBe(true);
    expect(runtime.step()).toMatchObject({
      appliedCommandCount: 1,
      events: [{ kind: "input.command-applied", sequence: 0, tick: 1 }],
    });
    const saved = runtime.save();
    expect(saved.presentation.entities).toEqual([
      expect.objectContaining({ id: PLAYER_ENTITY_ID, yawRadians: 1 }),
    ]);
    expect(createSimulationRuntime(adapter, 0, 60).load(saved.saveBytes).presentation).toEqual(
      saved.presentation,
    );
  });

  it("hash-matches repeated same-host replay", () => {
    const commands = Object.freeze([
      createPlayerInputCommand(0, 2, { forward: 1, right: 0, yawRadians: 0.25 }),
      createPlayerInputCommand(1, 8, { forward: 0, right: 1, yawRadians: -0.5 }),
    ]);
    const first = runSimulationReplay(
      createGameSimulationAdapter(context),
      8675309,
      60,
      commands,
      120,
    );
    const second = runSimulationReplay(
      createGameSimulationAdapter(context),
      8675309,
      60,
      commands,
      120,
    );
    expect(second).toMatchObject({
      finalSave: first.finalSave,
      finalStateHash: first.finalStateHash,
      gameCounters: first.gameCounters,
      tick: first.tick,
    });
    expect(first.stepDurationHighWaterMs).toBeGreaterThanOrEqual(0);
    expect(second.stepDurationHighWaterMs).toBeGreaterThanOrEqual(0);
  });

  it("rejects serialized input axes outside the admitted command invariant", () => {
    const adapter = createGameSimulationAdapter(context);
    const bytes = adapter.serializeState(adapter.createInitialState(1));
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setFloat32(8, 999, true);
    expect(() => adapter.deserializeState(bytes)).toThrow(/input state/);
  });

  it("rejects a noncanonical serialized interaction flag", () => {
    const adapter = createGameSimulationAdapter(context);
    const bytes = adapter.serializeState(adapter.createInitialState(1));
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(56, 2, true);
    expect(() => adapter.deserializeState(bytes)).toThrow(/noncanonical interaction flag/);
  });

  it("rejects a digest-valid save whose game payload violates input invariants", async () => {
    const adapter = createGameSimulationAdapter(context);
    const saved = createSimulationRuntime(adapter, 1, 60).save().saveBytes;
    const corrupt = saved.slice();
    new DataView(corrupt.buffer, corrupt.byteOffset, corrupt.byteLength).setFloat32(
      80 + 8,
      999,
      true,
    );
    const body = corrupt.subarray(80);
    const digestInput = new Uint8Array(48 + body.byteLength);
    digestInput.set(corrupt.subarray(0, 48));
    digestInput.set(body, 48);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", digestInput));
    corrupt.set(digest, 48);
    expect(() => createSimulationRuntime(adapter, 2, 60).load(corrupt)).toThrow(/input state/);
  });

  it("moves against D1 terrain deterministically and exposes controller counters", () => {
    const commands = Object.freeze([
      createPlayerInputCommand(0, 1, { forward: 1, right: 0, yawRadians: Math.PI / 2 }),
      createPlayerInputCommand(1, 61, { forward: 0, right: 0, yawRadians: Math.PI / 2 }),
    ]);
    const result = runSimulationReplay(createGameSimulationAdapter(context), 123, 60, commands, 90);
    expect(result.gameCounters.movementDistanceMeters).toBeGreaterThan(0);
    const loaded = createSimulationRuntime(createGameSimulationAdapter(context), 0, 60).load(
      result.finalSave,
    );
    expect(loaded.presentation.entities[0]?.position[1]).toBeGreaterThan(world.bounds.minimum[1]);
  });

  it("activates a nearby authored transition marker exactly once per interaction edge", () => {
    const nearbyWorld = Object.freeze({
      ...simulationWorldDefinition(world),
      markers: Object.freeze([
        Object.freeze({
          id: "test-transition",
          kind: "transition" as const,
          position: Object.freeze([0, 0, 0] as const),
          tags: Object.freeze(["test"]),
        }),
      ]),
    });
    const runtime = createSimulationRuntime(
      createGameSimulationAdapter({ timestepHz: 60, world: nearbyWorld }),
      1,
      60,
    );
    runtime.enqueue(
      createPlayerInputCommand(0, 1, {
        forward: 0,
        interactPressed: true,
        right: 0,
        yawRadians: 0,
      }),
    );
    expect(runtime.step().events).toEqual([
      expect.objectContaining({ kind: "input.command-applied" }),
      expect.objectContaining({ kind: "interaction.activated" }),
    ]);
    expect(runtime.step().events).toEqual([]);
    expect(runtime.gameCounters).toMatchObject({
      interactionActivationCount: 1,
      interactionAttemptCount: 1,
    });
  });

  it("slides the capsule no farther than D1's authored AABB collision boundary", () => {
    const simulationWorld = simulationWorldDefinition(world);
    const blockedWorld = Object.freeze({
      ...simulationWorld,
      cells: Object.freeze(
        simulationWorld.cells.map((cell) =>
          cell.coordinate[0] === 8 && cell.coordinate[1] === 8
            ? Object.freeze({
                ...cell,
                collision: Object.freeze({
                  ...cell.collision,
                  obstacles: Object.freeze([
                    Object.freeze({
                      center: Object.freeze([0, 5, 3] as const),
                      id: "test-wall",
                      kind: "aabb" as const,
                      size: Object.freeze([8, 10, 1] as const),
                    }),
                  ]),
                }),
              })
            : cell,
        ),
      ),
    });
    const runtime = createSimulationRuntime(
      createGameSimulationAdapter({ timestepHz: 60, world: blockedWorld }),
      1,
      60,
    );
    runtime.enqueue(createPlayerInputCommand(0, 1, { forward: 1, right: 0, yawRadians: 0 }));
    for (let tick = 0; tick < 60; tick += 1) runtime.step();
    expect(runtime.presentation().entities[0]?.position[2]).toBeCloseTo(1.95, 5);
    expect(runtime.gameCounters.collisionResolutionCount).toBeGreaterThan(0);
  });
});
