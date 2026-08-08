import type {
  GameSimulationAdapter,
  GameSimulationContext,
  GreyboxAabbCollider,
  SimulationCommand,
  SimulationPresentationEntity,
  SimulationStepResult,
  SimulationWorldCell,
  SimulationWorldDefinition,
} from "@parallax/engine";
import { CHARACTER_CONTROLLER_BALANCE } from "../balance/character-controller";

export const GAME_SIMULATION_STATE_SCHEMA_VERSION = 2;
export const PLAYER_ENTITY_ID = 1;

interface M3SimulationState {
  readonly collisionResolutionCount: number;
  readonly inputForward: number;
  readonly inputRight: number;
  readonly interactionActivationCount: number;
  readonly interactionAttemptCount: number;
  readonly interactionRequested: boolean;
  readonly lastInteractionMarkerIndex: number;
  readonly movementDistanceMeters: number;
  readonly playerPosition: readonly [number, number, number];
  readonly playerYawRadians: number;
  readonly rngState: number;
  readonly schemaVersion: typeof GAME_SIMULATION_STATE_SCHEMA_VERSION;
}

interface ControllerWorld {
  readonly cellsByCoordinate: ReadonlyMap<string, SimulationWorldCell>;
  readonly district: SimulationWorldDefinition;
  readonly obstacles: readonly GreyboxAabbCollider[];
  readonly transitionMarkerIndexes: readonly number[];
}

const EMPTY_EVENTS = Object.freeze([]);
const INPUT_COMMAND_KIND = "player.input-axes@2";
const INPUT_PAYLOAD_BYTES = 16;
const INPUT_INTERACT_PRESSED = 1;
const STATE_BYTES = 64;

export function createGameSimulationAdapter(
  context: GameSimulationContext,
): GameSimulationAdapter<M3SimulationState> {
  if (!Number.isSafeInteger(context.timestepHz) || context.timestepHz <= 0) {
    throw new Error("Game simulation timestep is invalid");
  }
  const world = createControllerWorld(context.world);
  const tickSeconds = 1 / context.timestepHz;
  return Object.freeze({
    applyCommand(
      state: M3SimulationState,
      command: SimulationCommand,
    ): SimulationStepResult<M3SimulationState> {
      if (command.kind !== INPUT_COMMAND_KIND) {
        throw new Error(`Unsupported game simulation command ${command.kind}`);
      }
      if (command.payload.byteLength !== INPUT_PAYLOAD_BYTES) {
        throw new Error("Player input command payload is invalid");
      }
      const view = new DataView(
        command.payload.buffer,
        command.payload.byteOffset,
        command.payload.byteLength,
      );
      const inputForward = view.getFloat32(0, true);
      const inputRight = view.getFloat32(4, true);
      const playerYawRadians = view.getFloat32(8, true);
      const flags = view.getUint32(12, true);
      assertInputState(inputForward, inputRight, playerYawRadians, flags);
      const interactionPressed = (flags & INPUT_INTERACT_PRESSED) !== 0;
      const next = Object.freeze({
        ...state,
        inputForward,
        inputRight,
        interactionAttemptCount: state.interactionAttemptCount + Number(interactionPressed),
        interactionRequested: state.interactionRequested || interactionPressed,
        playerYawRadians,
      });
      return Object.freeze({
        events: Object.freeze([
          Object.freeze({ kind: "input.command-applied", payload: command.payload.slice() }),
        ]),
        state: next,
      });
    },
    createInitialState(seed: number): M3SimulationState {
      const spawnX = 0;
      const spawnZ = 0;
      return Object.freeze({
        collisionResolutionCount: 0,
        inputForward: 0,
        inputRight: 0,
        interactionActivationCount: 0,
        interactionAttemptCount: 0,
        interactionRequested: false,
        lastInteractionMarkerIndex: -1,
        movementDistanceMeters: 0,
        playerPosition: Object.freeze([
          spawnX,
          groundHeight(world, spawnX, spawnZ) + CHARACTER_CONTROLLER_BALANCE.halfHeightMeters,
          spawnZ,
        ]) as readonly [number, number, number],
        playerYawRadians: 0,
        rngState: seed >>> 0,
        schemaVersion: GAME_SIMULATION_STATE_SCHEMA_VERSION,
      });
    },
    deserializeState(bytes: Uint8Array): M3SimulationState {
      if (bytes.byteLength !== STATE_BYTES) throw new Error("Game simulation state is truncated");
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (view.getUint32(0, true) !== GAME_SIMULATION_STATE_SCHEMA_VERSION) {
        throw new Error("Game simulation state schema is incompatible");
      }
      const interactionRequestedValue = view.getUint32(56, true);
      if (interactionRequestedValue !== 0 && interactionRequestedValue !== 1) {
        throw new Error("Game simulation state contains a noncanonical interaction flag");
      }
      const state = Object.freeze({
        collisionResolutionCount: view.getUint32(44, true),
        inputForward: view.getFloat32(8, true),
        inputRight: view.getFloat32(12, true),
        interactionActivationCount: view.getUint32(52, true),
        interactionAttemptCount: view.getUint32(48, true),
        interactionRequested: interactionRequestedValue === 1,
        lastInteractionMarkerIndex: view.getInt32(60, true),
        movementDistanceMeters: view.getFloat64(32, true),
        playerPosition: Object.freeze([
          view.getFloat32(20, true),
          view.getFloat32(24, true),
          view.getFloat32(28, true),
        ]) as readonly [number, number, number],
        playerYawRadians: view.getFloat32(16, true),
        rngState: view.getUint32(4, true),
        schemaVersion: GAME_SIMULATION_STATE_SCHEMA_VERSION,
      });
      assertState(state, world.district.markers.length);
      return state;
    },
    presentationSnapshot(state: M3SimulationState): readonly SimulationPresentationEntity[] {
      return Object.freeze([
        Object.freeze({
          id: PLAYER_ENTITY_ID,
          position: state.playerPosition,
          yawRadians: state.playerYawRadians,
        }),
      ]);
    },
    serializeState(state: M3SimulationState): Uint8Array {
      assertState(state, world.district.markers.length);
      const bytes = new Uint8Array(STATE_BYTES);
      const view = new DataView(bytes.buffer);
      view.setUint32(0, state.schemaVersion, true);
      view.setUint32(4, state.rngState, true);
      view.setFloat32(8, state.inputForward, true);
      view.setFloat32(12, state.inputRight, true);
      view.setFloat32(16, state.playerYawRadians, true);
      view.setFloat32(20, state.playerPosition[0], true);
      view.setFloat32(24, state.playerPosition[1], true);
      view.setFloat32(28, state.playerPosition[2], true);
      view.setFloat64(32, state.movementDistanceMeters, true);
      view.setUint32(44, state.collisionResolutionCount, true);
      view.setUint32(48, state.interactionAttemptCount, true);
      view.setUint32(52, state.interactionActivationCount, true);
      view.setUint32(56, Number(state.interactionRequested), true);
      view.setInt32(60, state.lastInteractionMarkerIndex, true);
      return bytes;
    },
    step(state: M3SimulationState, _tick: number): SimulationStepResult<M3SimulationState> {
      const movement = movePlayer(world, state, tickSeconds);
      const markerIndex = state.interactionRequested
        ? nearestTransitionMarker(world, movement.position)
        : -1;
      const activated = markerIndex >= 0;
      const next = Object.freeze({
        ...state,
        collisionResolutionCount: state.collisionResolutionCount + movement.collisionCount,
        interactionActivationCount: state.interactionActivationCount + Number(activated),
        interactionRequested: false,
        lastInteractionMarkerIndex: activated ? markerIndex : state.lastInteractionMarkerIndex,
        movementDistanceMeters: Math.fround(state.movementDistanceMeters + movement.distanceMeters),
        playerPosition: movement.position,
      });
      const marker = activated ? world.district.markers[markerIndex] : undefined;
      return Object.freeze({
        events:
          marker === undefined
            ? EMPTY_EVENTS
            : Object.freeze([
                Object.freeze({
                  kind: "interaction.activated",
                  payload: markerIndexPayload(markerIndex),
                }),
              ]),
        state: next,
      });
    },
    telemetryCounters(state: M3SimulationState): Readonly<Record<string, number>> {
      return Object.freeze({
        collisionResolutionCount: state.collisionResolutionCount,
        interactionActivationCount: state.interactionActivationCount,
        interactionAttemptCount: state.interactionAttemptCount,
        movementDistanceMeters: state.movementDistanceMeters,
      });
    },
  });
}

function createControllerWorld(district: SimulationWorldDefinition): ControllerWorld {
  const cellsByCoordinate = new Map(
    district.cells.map((cell) => [`${cell.coordinate[0]},${cell.coordinate[1]}`, cell]),
  );
  const obstacles = district.cells
    .flatMap((cell) => cell.collision.obstacles)
    .toSorted((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const transitionMarkerIndexes = district.markers.flatMap((marker, index) =>
    marker.kind === "transition" ? [index] : [],
  );
  return Object.freeze({
    cellsByCoordinate,
    district,
    obstacles: Object.freeze(obstacles),
    transitionMarkerIndexes: Object.freeze(transitionMarkerIndexes),
  });
}

function movePlayer(
  world: ControllerWorld,
  state: M3SimulationState,
  tickSeconds: number,
): Readonly<{
  readonly collisionCount: number;
  readonly distanceMeters: number;
  readonly position: readonly [number, number, number];
}> {
  const inputLength = Math.hypot(state.inputForward, state.inputRight);
  const scale = inputLength > 1 ? 1 / inputLength : 1;
  const forward = state.inputForward * scale;
  const right = state.inputRight * scale;
  const sine = Math.sin(state.playerYawRadians);
  const cosine = Math.cos(state.playerYawRadians);
  const distance = CHARACTER_CONTROLLER_BALANCE.movementMetersPerSecond * tickSeconds;
  const deltaX = (sine * forward + cosine * right) * distance;
  const deltaZ = (cosine * forward - sine * right) * distance;
  const oldX = state.playerPosition[0];
  const oldZ = state.playerPosition[2];
  const radius = CHARACTER_CONTROLLER_BALANCE.collisionRadiusMeters;
  const bounds = world.district.bounds;
  let x = Math.fround(clamp(oldX + deltaX, bounds.minimum[0] + radius, bounds.maximum[0] - radius));
  let collisionCount = 0;
  if (deltaX !== 0) {
    for (const obstacle of world.obstacles) {
      if (!overlapsExpandedAabb(x, oldZ, obstacle, radius)) continue;
      x = Math.fround(
        deltaX > 0
          ? obstacle.center[0] - obstacle.size[0] / 2 - radius
          : obstacle.center[0] + obstacle.size[0] / 2 + radius,
      );
      collisionCount += 1;
    }
  }
  let z = Math.fround(clamp(oldZ + deltaZ, bounds.minimum[2] + radius, bounds.maximum[2] - radius));
  if (deltaZ !== 0) {
    for (const obstacle of world.obstacles) {
      if (!overlapsExpandedAabb(x, z, obstacle, radius)) continue;
      z = Math.fround(
        deltaZ > 0
          ? obstacle.center[2] - obstacle.size[2] / 2 - radius
          : obstacle.center[2] + obstacle.size[2] / 2 + radius,
      );
      collisionCount += 1;
    }
  }
  const moved = Math.hypot(x - oldX, z - oldZ);
  return Object.freeze({
    collisionCount,
    distanceMeters: Math.fround(moved),
    position: Object.freeze([
      x,
      Math.fround(groundHeight(world, x, z) + CHARACTER_CONTROLLER_BALANCE.halfHeightMeters),
      z,
    ]) as readonly [number, number, number],
  });
}

function groundHeight(world: ControllerWorld, x: number, z: number): number {
  const bounds = world.district.bounds;
  const cellSize = world.district.cellSizeMeters;
  const cellsX = Math.round((bounds.maximum[0] - bounds.minimum[0]) / cellSize);
  const cellsZ = Math.round((bounds.maximum[2] - bounds.minimum[2]) / cellSize);
  const cellX = clamp(Math.floor((x - bounds.minimum[0]) / cellSize), 0, cellsX - 1);
  const cellZ = clamp(Math.floor((z - bounds.minimum[2]) / cellSize), 0, cellsZ - 1);
  const cell = world.cellsByCoordinate.get(`${cellX},${cellZ}`);
  if (cell === undefined) throw new Error("Character controller could not resolve terrain cell");
  const field = cell.collision.heightfield;
  const column = clamp((x - field.origin[0]) / field.sampleSpacingMeters, 0, field.columns - 1);
  const row = clamp((z - field.origin[2]) / field.sampleSpacingMeters, 0, field.rows - 1);
  const column0 = Math.floor(column);
  const row0 = Math.floor(row);
  const column1 = Math.min(field.columns - 1, column0 + 1);
  const row1 = Math.min(field.rows - 1, row0 + 1);
  const sample = (sampleColumn: number, sampleRow: number): number =>
    field.heights[sampleRow * field.columns + sampleColumn] ?? 0;
  const south = lerp(sample(column0, row0), sample(column1, row0), column - column0);
  const north = lerp(sample(column0, row1), sample(column1, row1), column - column0);
  return Math.fround(lerp(south, north, row - row0));
}

function nearestTransitionMarker(
  world: ControllerWorld,
  position: readonly [number, number, number],
): number {
  let nearest = -1;
  let nearestDistanceSquared = CHARACTER_CONTROLLER_BALANCE.interactionRangeMeters ** 2;
  for (const index of world.transitionMarkerIndexes) {
    const marker = world.district.markers[index];
    if (marker === undefined) continue;
    const distanceSquared =
      (marker.position[0] - position[0]) ** 2 + (marker.position[2] - position[2]) ** 2;
    if (distanceSquared <= nearestDistanceSquared) {
      nearest = index;
      nearestDistanceSquared = distanceSquared;
    }
  }
  return nearest;
}

function overlapsExpandedAabb(
  x: number,
  z: number,
  obstacle: GreyboxAabbCollider,
  radius: number,
): boolean {
  return (
    x > obstacle.center[0] - obstacle.size[0] / 2 - radius &&
    x < obstacle.center[0] + obstacle.size[0] / 2 + radius &&
    z > obstacle.center[2] - obstacle.size[2] / 2 - radius &&
    z < obstacle.center[2] + obstacle.size[2] / 2 + radius
  );
}

function assertState(state: M3SimulationState, markerCount: number): void {
  if (
    state.schemaVersion !== GAME_SIMULATION_STATE_SCHEMA_VERSION ||
    state.playerPosition.some((value) => !Number.isFinite(value)) ||
    !Number.isFinite(state.movementDistanceMeters) ||
    state.movementDistanceMeters < 0 ||
    !Number.isSafeInteger(state.collisionResolutionCount) ||
    !Number.isSafeInteger(state.interactionAttemptCount) ||
    !Number.isSafeInteger(state.interactionActivationCount) ||
    (state.lastInteractionMarkerIndex !== -1 &&
      (state.lastInteractionMarkerIndex < 0 || state.lastInteractionMarkerIndex >= markerCount))
  ) {
    throw new Error("Game simulation state contains invalid controller values");
  }
  assertInputState(state.inputForward, state.inputRight, state.playerYawRadians, 0);
}

function assertInputState(
  inputForward: number,
  inputRight: number,
  yawRadians: number,
  flags: number,
): void {
  if (
    !Number.isFinite(inputForward) ||
    !Number.isFinite(inputRight) ||
    !Number.isFinite(yawRadians) ||
    Math.abs(inputForward) > 1 ||
    Math.abs(inputRight) > 1 ||
    !Number.isSafeInteger(flags) ||
    flags < 0 ||
    (flags & ~INPUT_INTERACT_PRESSED) !== 0
  ) {
    throw new Error("Player input state values are invalid");
  }
}

export function createPlayerInputCommand(
  sequence: number,
  targetTick: number,
  input: Readonly<{
    readonly forward: number;
    readonly interactPressed?: boolean;
    readonly right: number;
    readonly yawRadians: number;
  }>,
): SimulationCommand {
  const payload = new Uint8Array(INPUT_PAYLOAD_BYTES);
  const view = new DataView(payload.buffer);
  view.setFloat32(0, input.forward, true);
  view.setFloat32(4, input.right, true);
  view.setFloat32(8, input.yawRadians, true);
  view.setUint32(12, input.interactPressed === true ? INPUT_INTERACT_PRESSED : 0, true);
  return Object.freeze({ kind: INPUT_COMMAND_KIND, payload, sequence, targetTick });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

function markerIndexPayload(markerIndex: number): Uint8Array {
  const payload = new Uint8Array(Uint32Array.BYTES_PER_ELEMENT);
  new DataView(payload.buffer).setUint32(0, markerIndex, true);
  return payload;
}
