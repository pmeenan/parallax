import type {
  GameSimulationAdapter,
  SimulationCommand,
  SimulationPresentationEntity,
  SimulationStepResult,
} from "@parallax/engine";

export const GAME_SIMULATION_STATE_SCHEMA_VERSION = 1;
export const PLAYER_ENTITY_ID = 1;

interface M3SimulationState {
  readonly inputForward: number;
  readonly inputRight: number;
  readonly playerPosition: readonly [number, number, number];
  readonly playerYawRadians: number;
  readonly rngState: number;
  readonly schemaVersion: typeof GAME_SIMULATION_STATE_SCHEMA_VERSION;
}

const EMPTY_EVENTS = Object.freeze([]);
const INPUT_COMMAND_KIND = "player.input-axes@1";
const INPUT_PAYLOAD_BYTES = Float32Array.BYTES_PER_ELEMENT * 3;
const STATE_BYTES = 32;

export function createGameSimulationAdapter(): GameSimulationAdapter<M3SimulationState> {
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
      assertInputState(inputForward, inputRight, playerYawRadians);
      const next = Object.freeze({
        ...state,
        inputForward,
        inputRight,
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
      return Object.freeze({
        inputForward: 0,
        inputRight: 0,
        playerPosition: Object.freeze([0, 12, 0]) as readonly [number, number, number],
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
      const state = Object.freeze({
        inputForward: view.getFloat32(8, true),
        inputRight: view.getFloat32(12, true),
        playerPosition: Object.freeze([
          view.getFloat32(20, true),
          view.getFloat32(24, true),
          view.getFloat32(28, true),
        ]) as readonly [number, number, number],
        playerYawRadians: view.getFloat32(16, true),
        rngState: view.getUint32(4, true),
        schemaVersion: GAME_SIMULATION_STATE_SCHEMA_VERSION,
      });
      if (state.playerPosition.some((value) => !Number.isFinite(value))) {
        throw new Error("Game simulation state contains non-finite values");
      }
      assertInputState(state.inputForward, state.inputRight, state.playerYawRadians);
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
      return bytes;
    },
    step(state: M3SimulationState, _tick: number): SimulationStepResult<M3SimulationState> {
      // Character movement is the next M3 plan item. The authoritative scheduler and
      // command state are live now without smuggling controller rules into this task.
      return Object.freeze({ events: EMPTY_EVENTS, state });
    },
  });
}

function assertInputState(inputForward: number, inputRight: number, yawRadians: number): void {
  if (
    !Number.isFinite(inputForward) ||
    !Number.isFinite(inputRight) ||
    !Number.isFinite(yawRadians) ||
    Math.abs(inputForward) > 1 ||
    Math.abs(inputRight) > 1
  ) {
    throw new Error("Player input state values are invalid");
  }
}

export function createPlayerInputCommand(
  sequence: number,
  targetTick: number,
  input: Readonly<{
    readonly forward: number;
    readonly right: number;
    readonly yawRadians: number;
  }>,
): SimulationCommand {
  const payload = new Uint8Array(INPUT_PAYLOAD_BYTES);
  const view = new DataView(payload.buffer);
  view.setFloat32(0, input.forward, true);
  view.setFloat32(4, input.right, true);
  view.setFloat32(8, input.yawRadians, true);
  return Object.freeze({ kind: INPUT_COMMAND_KIND, payload, sequence, targetTick });
}
