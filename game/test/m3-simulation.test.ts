import {
  createSimulationRuntime,
  runSimulationReplay,
  simulationWorldDefinition,
} from "@parallax/engine";
import { describe, expect, it } from "vitest";
import { NPC_CROWD_BALANCE } from "../src/balance/npc-crowd";
import { buildDeterministicNavigationMesh } from "../src/sim/deterministic-navigation";
import {
  createGameSimulationAdapter,
  createPlayerInputCommand,
  NPC_ENTITY_ID_START,
  PLAYER_ENTITY_ID,
} from "../src/sim/m3-simulation";
import { buildNpcScheduleSet } from "../src/sim/npc-schedules";
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
    expect(saved.presentation.entities[0]).toEqual(
      expect.objectContaining({ id: PLAYER_ENTITY_ID, yawRadians: 1 }),
    );
    expect(saved.presentation.entities).toHaveLength(49);
    expect(saved.presentation.entities[1]?.id).toBe(NPC_ENTITY_ID_START);
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

  it("round-trips cumulative crowd counters beyond uint32 without truncation", () => {
    const adapter = createGameSimulationAdapter(context);
    const bytes = adapter.serializeState(adapter.createInitialState(1));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setFloat64(68, 2 ** 32 + 48, true);
    view.setFloat64(88, 2 ** 32 + 1, true);
    const roundTripped = adapter.serializeState(adapter.deserializeState(bytes));
    const roundTripView = new DataView(
      roundTripped.buffer,
      roundTripped.byteOffset,
      roundTripped.byteLength,
    );
    expect(roundTripView.getFloat64(68, true)).toBe(2 ** 32 + 48);
    expect(roundTripView.getFloat64(88, true)).toBe(2 ** 32 + 1);
  });

  it("rejects a finite off-mesh NPC pose in serialized state", () => {
    const adapter = createGameSimulationAdapter(context);
    const bytes = adapter.serializeState(adapter.createInitialState(1));
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setFloat32(96 + 12, 1e9, true);
    expect(() => adapter.deserializeState(bytes)).toThrow(/invalid NPC values/);
  });

  it("rejects a walkable NPC pose whose saved path cursor is not directly reachable", () => {
    const adapter = createGameSimulationAdapter(context);
    const navigation = buildDeterministicNavigationMesh(context.world, {
      agentRadiusMeters: NPC_CROWD_BALANCE.agentRadiusMeters,
      maximumGroundStepMeters: NPC_CROWD_BALANCE.maximumGroundStepMeters,
      sampleSpacingMeters: NPC_CROWD_BALANCE.navigationSampleSpacingMeters,
    });
    const schedules = buildNpcScheduleSet(context.world, navigation);
    const bytes = adapter.serializeState(adapter.createInitialState(1));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const routeIndex = view.getUint16(96 + 4, true);
    const targetStopIndex = view.getUint16(96 + 6, true);
    const pathCursor = view.getUint16(96 + 8, true);
    const target = schedules.routes[routeIndex]?.segments[targetStopIndex]?.nodes[pathCursor];
    if (target === undefined) throw new Error("Test NPC target is unavailable");
    const candidate = schedules.routes
      .flatMap(({ segments }) => segments.flatMap(({ nodes }) => nodes))
      .find((node) => !navigation.canTraverseSegment(node, target));
    if (candidate === undefined) throw new Error("Test world has no path-inconsistent pose");
    view.setFloat32(96 + 12, candidate[0], true);
    view.setFloat32(
      96 + 16,
      navigation.groundHeight(candidate[0], candidate[2]) + NPC_CROWD_BALANCE.agentHeightMeters / 2,
      true,
    );
    view.setFloat32(96 + 20, candidate[2], true);
    expect(() => adapter.deserializeState(bytes)).toThrow(/invalid NPC values/);
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
        ...simulationWorldDefinition(world).markers,
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

  it("emits a stable entity ID when the authored conversational NPC is nearest", () => {
    const adapter = createGameSimulationAdapter(context);
    const initial = adapter.createInitialState(1);
    const npc = adapter.presentationSnapshot(initial).find(({ id }) => id === NPC_ENTITY_ID_START);
    if (npc === undefined) throw new Error("Conversational NPC is missing");
    const bytes = adapter.serializeState(initial);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setFloat32(20, npc.position[0], true);
    view.setFloat32(24, npc.position[1], true);
    view.setFloat32(28, npc.position[2], true);
    const moved = adapter.deserializeState(bytes);
    const applied = adapter.applyCommand(
      moved,
      createPlayerInputCommand(0, 1, {
        forward: 0,
        interactPressed: true,
        right: 0,
        yawRadians: 0,
      }),
    ).state;
    const result = adapter.step(applied, 1);
    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    if (event === undefined) throw new Error("NPC interaction event is missing");
    expect(event.kind).toBe("npc.interaction-activated");
    expect(
      new DataView(
        event.payload.buffer,
        event.payload.byteOffset,
        event.payload.byteLength,
      ).getUint32(0, true),
    ).toBe(NPC_ENTITY_ID_START);
  });

  it("generates tiled navigation and advances deterministic schedule crowds with avoidance", () => {
    const adapter = createGameSimulationAdapter(context);
    const initial = adapter.createInitialState(123);
    expect(adapter.telemetryCounters(initial).npcScheduleTransitionCount).toBe(0);
    expect(
      new Set(
        adapter
          .presentationSnapshot(initial)
          .filter(({ id }) => id !== PLAYER_ENTITY_ID)
          .map(({ position }) => position.join(",")),
      ).size,
    ).toBe(48);
    const initialCrowd = adapter
      .presentationSnapshot(initial)
      .filter(({ id }) => id !== PLAYER_ENTITY_ID);
    for (const [index, agent] of initialCrowd.entries()) {
      for (const other of initialCrowd.slice(index + 1)) {
        expect(
          Math.hypot(agent.position[0] - other.position[0], agent.position[2] - other.position[2]),
        ).toBeGreaterThanOrEqual(NPC_CROWD_BALANCE.agentRadiusMeters * 2);
      }
    }
    const result = runSimulationReplay(adapter, 123, 60, [], 240);
    expect(result.gameCounters).toMatchObject({
      navigationPathQueryCount: 8,
      navigationTileCount: world.cells.length,
      npcAgentCount: 48,
    });
    expect(result.gameCounters.navigationNodeCount).toBeGreaterThan(60_000);
    expect(result.gameCounters.navigationEdgeCount).toBeGreaterThan(
      result.gameCounters.navigationNodeCount ?? 0,
    );
    expect(result.gameCounters.navigationExpandedNodeCount).toBeGreaterThan(0);
    expect(result.gameCounters.navigationGridBytes).toBeGreaterThan(0);
    expect(result.gameCounters.navigationPathNodeCount).toBeGreaterThan(8);
    expect(result.gameCounters.npcMovementDistanceMeters).toBeGreaterThan(0);
    expect(result.gameCounters.npcAvoidanceAdjustmentCount).toBeGreaterThan(0);
    expect(result.gameCounters.npcScheduleTransitionCount).toBeGreaterThan(0);
    expect(result.gameCounters.npcMovingAgentCount).toBeGreaterThan(0);
  });

  it("keeps every avoidance and waypoint-progress state serializable", () => {
    const adapter = createGameSimulationAdapter(context);
    let state = adapter.createInitialState(123);
    for (let tick = 1; tick <= 240; tick += 1) {
      const previous = new Map(
        adapter
          .presentationSnapshot(state)
          .filter(({ id }) => id !== PLAYER_ENTITY_ID)
          .map((entity) => [entity.id, entity.position] as const),
      );
      state = adapter.step(state, tick).state;
      expect(() => adapter.serializeState(state)).not.toThrow();
      for (const entity of adapter
        .presentationSnapshot(state)
        .filter(({ id }) => id !== PLAYER_ENTITY_ID)) {
        const before = previous.get(entity.id);
        if (before === undefined) throw new Error("Test crowd identity disappeared");
        expect(
          Math.hypot(entity.position[0] - before[0], entity.position[2] - before[2]),
        ).toBeLessThanOrEqual(NPC_CROWD_BALANCE.movementMetersPerSecond / 60 + 0.000_01);
      }
    }
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
