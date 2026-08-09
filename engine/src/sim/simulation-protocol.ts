import type {
  GreyboxCollisionPayload,
  GreyboxDistrict,
  GreyboxWorldMarker,
  WorldBounds,
} from "../world/world-contract";

export const SIMULATION_PROTOCOL_VERSION = 4;
export const SIMULATION_SAVE_SCHEMA_VERSION = 1;
export const SIMULATION_TELEMETRY_SCHEMA_VERSION = 3;
export const MAXIMUM_SIMULATION_REPLAY_TICKS = 10_000;
export const MAXIMUM_SIMULATION_REPLAY_COMMANDS = 65_536;
export const MAXIMUM_SIMULATION_REPLAY_COMMAND_BYTES = 16 * 1_024 * 1_024;
export const MAXIMUM_SIMULATION_GAME_STATE_QUERY_BYTES = 64 * 1_024;

export type SimulationState = "disposed" | "failed" | "idle" | "running" | "starting";

export interface SimulationCommand {
  readonly kind: string;
  readonly payload: Uint8Array;
  readonly sequence: number;
  readonly targetTick: number;
}

export interface SimulationGameStateQuery {
  readonly kind: string;
  readonly payload: Uint8Array;
}

export interface SimulationGameStateQueryResult {
  readonly payload: Uint8Array;
  readonly tick: number;
}

export interface SimulationPresentationEntity {
  readonly id: number;
  readonly position: readonly [number, number, number];
  readonly yawRadians: number;
}

export interface SimulationPresentationSnapshot {
  readonly entities: readonly SimulationPresentationEntity[];
  readonly stateHash: string;
  readonly tick: number;
}

export interface SimulationSemanticEvent {
  readonly kind: string;
  readonly payload: Uint8Array;
  readonly sequence: number;
  readonly tick: number;
}

export interface SimulationTelemetrySnapshot {
  readonly appliedCommandCount: number;
  readonly droppedCatchUpTickCount: number;
  readonly emittedEventCount: number;
  readonly failureMessage: string | null;
  readonly gameCounters: Readonly<Record<string, number>>;
  readonly highestAcceptedCommandSequence: number;
  readonly latestStateHash: string | null;
  readonly loadCount: number;
  readonly queuedCommandCount: number;
  readonly queuedCommandCountHighWater: number;
  readonly rejectedCommandCount: number;
  readonly saveCount: number;
  readonly schedulerLagHighWaterMs: number;
  readonly schemaVersion: typeof SIMULATION_TELEMETRY_SCHEMA_VERSION;
  readonly snapshotCount: number;
  readonly snapshotEntityCapacity: number;
  readonly snapshotSharedBytes: number;
  readonly state: SimulationState;
  readonly stepDurationHighWaterMs: number;
  readonly tick: number;
  readonly timestepHz: number;
  readonly workerGeneration: number;
}

export interface SimulationStepResult<State> {
  readonly events: readonly Readonly<{ readonly kind: string; readonly payload: Uint8Array }>[];
  readonly state: State;
}

export interface GameSimulationAdapter<State = unknown> {
  applyCommand(state: State, command: SimulationCommand): SimulationStepResult<State>;
  createInitialState(seed: number): State;
  deserializeState(bytes: Uint8Array): State;
  presentationSnapshot(state: State): readonly SimulationPresentationEntity[];
  queryState?(state: State, query: SimulationGameStateQuery): Uint8Array;
  serializeState(state: State): Uint8Array;
  step(state: State, tick: number): SimulationStepResult<State>;
  telemetryCounters(state: State): Readonly<Record<string, number>>;
}

export interface GameSimulationModule {
  createGameSimulationAdapter(context: GameSimulationContext): GameSimulationAdapter;
}

export interface GameSimulationContext {
  readonly timestepHz: number;
  readonly world: SimulationWorldDefinition;
}

export interface SimulationWorldCell {
  readonly collision: GreyboxCollisionPayload;
  readonly coordinate: readonly [number, number];
}

export interface SimulationWorldDefinition {
  readonly bounds: WorldBounds;
  readonly cellSizeMeters: number;
  readonly cells: readonly SimulationWorldCell[];
  readonly id: string;
  readonly markers: readonly GreyboxWorldMarker[];
}

export function simulationWorldDefinition(district: GreyboxDistrict): SimulationWorldDefinition {
  return Object.freeze({
    bounds: district.bounds,
    cellSizeMeters: district.cellSizeMeters,
    cells: Object.freeze(
      district.cells.map((cell) =>
        Object.freeze({ collision: cell.collision, coordinate: cell.coordinate }),
      ),
    ),
    id: district.id,
    markers: district.markers,
  });
}

export interface SimulationStartOptions {
  readonly entityCapacity: number;
  readonly gameModuleUrl: string;
  readonly seed: number;
  readonly snapshotCadenceTicks: number;
  readonly timestepHz: number;
  readonly world: SimulationWorldDefinition;
}

export interface SimulationReplayResult {
  readonly adapterInitializationDurationMs: number;
  readonly finalSave: Uint8Array;
  readonly finalStateHash: string;
  readonly gameCounters: Readonly<Record<string, number>>;
  readonly stepDurationHighWaterMs: number;
  readonly tick: number;
}

export type SimulationWorkerRequest =
  | Readonly<{ readonly kind: "command"; readonly command: SimulationCommand }>
  | Readonly<{ readonly kind: "dispose" }>
  | Readonly<{ readonly bytes: Uint8Array; readonly kind: "load"; readonly requestId: number }>
  | Readonly<{
      readonly kind: "query-game-state";
      readonly query: SimulationGameStateQuery;
      readonly requestId: number;
    }>
  | Readonly<{
      readonly commands: readonly SimulationCommand[];
      readonly kind: "replay";
      readonly requestId: number;
      readonly seed: number;
      readonly ticks: number;
    }>
  | Readonly<{ readonly kind: "save"; readonly requestId: number }>
  | Readonly<{
      readonly kind: "start";
      readonly options: SimulationStartOptions;
      readonly snapshotBuffer: SharedArrayBuffer;
      readonly workerGeneration: number;
    }>;

export type SimulationWorkerResponse =
  | Readonly<{ readonly kind: "disposed"; readonly telemetry: SimulationTelemetrySnapshot }>
  | Readonly<{
      readonly kind: "failure";
      readonly message: string;
      readonly requestId: number | null;
      readonly telemetry: SimulationTelemetrySnapshot;
    }>
  | Readonly<{
      readonly events: readonly SimulationSemanticEvent[];
      readonly kind: "snapshot";
      readonly snapshot: Readonly<{
        readonly sequence: number;
        readonly slot: number;
        readonly stateHash: string;
        readonly tick: number;
      }>;
      readonly telemetry: SimulationTelemetrySnapshot;
    }>
  | Readonly<{
      readonly bytes: Uint8Array;
      readonly kind: "saved";
      readonly requestId: number;
      readonly telemetry: SimulationTelemetrySnapshot;
    }>
  | Readonly<{
      readonly kind: "loaded";
      readonly requestId: number;
      readonly snapshot: SimulationPresentationSnapshot;
      readonly telemetry: SimulationTelemetrySnapshot;
    }>
  | Readonly<{
      readonly kind: "game-state-query-result";
      readonly requestId: number;
      readonly result: SimulationGameStateQueryResult;
    }>
  | Readonly<{
      readonly kind: "replayed";
      readonly requestId: number;
      readonly result: SimulationReplayResult;
    }>
  | Readonly<{ readonly kind: "telemetry"; readonly telemetry: SimulationTelemetrySnapshot }>;
