import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { isRuntimeIdentifier } from "../core/runtime-identifier";
import {
  type GameSimulationAdapter,
  type GameSimulationModule,
  MAXIMUM_SIMULATION_GAME_STATE_QUERY_BYTES,
  MAXIMUM_SIMULATION_REPLAY_COMMAND_BYTES,
  MAXIMUM_SIMULATION_REPLAY_COMMANDS,
  MAXIMUM_SIMULATION_REPLAY_TICKS,
  SIMULATION_SAVE_SCHEMA_VERSION,
  type SimulationCommand,
  type SimulationGameStateQuery,
  type SimulationPresentationEntity,
  type SimulationPresentationSnapshot,
  type SimulationReplayResult,
  type SimulationSemanticEvent,
} from "./simulation-protocol";

const SAVE_MAGIC = new Uint8Array([0x50, 0x52, 0x4c, 0x58, 0x53, 0x49, 0x4d, 0x00]);
const SAVE_HEADER_BYTES = 48;
const BODY_DIGEST_BYTES = 32;
const COMMAND_HEADER_BYTES = 24;
const MAXIMUM_COMMAND_KIND_BYTES = 128;
const MAXIMUM_COMMAND_PAYLOAD_BYTES = 64 * 1_024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface SimulationRuntimeSnapshot {
  readonly presentation: SimulationPresentationSnapshot;
  readonly saveBytes: Uint8Array;
}

export interface SimulationRuntime {
  readonly gameCounters: Readonly<Record<string, number>>;
  readonly highestAcceptedCommandSequence: number;
  readonly queuedCommandCount: number;
  readonly tick: number;
  enqueue(command: SimulationCommand): boolean;
  load(bytes: Uint8Array): SimulationRuntimeSnapshot;
  presentation(): SimulationPresentationSnapshot;
  queryGameState(query: SimulationGameStateQuery): Uint8Array;
  save(): SimulationRuntimeSnapshot;
  step(): Readonly<{
    readonly appliedCommandCount: number;
    readonly events: readonly SimulationSemanticEvent[];
  }>;
}

export function createSimulationRuntime(
  adapter: GameSimulationAdapter,
  seed: number,
  timestepHz: number,
): SimulationRuntime {
  assertSafeUnsigned(seed, "Simulation seed");
  assertPositiveSafeInteger(timestepHz, "Simulation timestep rate");
  let state = adapter.createInitialState(seed);
  let tick = 0;
  let lastAppliedSequence = -1;
  let highestAcceptedSequence = -1;
  let nextEventSequence = 0;
  let commands: SimulationCommand[] = [];

  const capturePresentation = (
    candidateState: unknown,
    candidateTick: number,
    stateBytes: Uint8Array,
  ): SimulationPresentationSnapshot =>
    freezePresentationSnapshot(
      candidateTick,
      bytesToHex(sha256(stateBytes)),
      adapter.presentationSnapshot(candidateState),
    );

  const snapshot = (): SimulationRuntimeSnapshot => {
    const stateBytes = serializeState(adapter, state);
    const presentation = capturePresentation(state, tick, stateBytes);
    const saveBytes = encodeSimulationSave(
      tick,
      timestepHz,
      lastAppliedSequence,
      nextEventSequence,
      stateBytes,
      commands,
    );
    return Object.freeze({
      presentation,
      saveBytes,
    });
  };

  return Object.freeze({
    get gameCounters(): Readonly<Record<string, number>> {
      return canonicalGameCounters(adapter.telemetryCounters(state));
    },
    get highestAcceptedCommandSequence(): number {
      return highestAcceptedSequence;
    },
    get queuedCommandCount(): number {
      return commands.length;
    },
    get tick(): number {
      return tick;
    },
    enqueue(command: SimulationCommand): boolean {
      assertSimulationCommand(command);
      if (
        command.sequence <= highestAcceptedSequence ||
        command.targetTick <= tick ||
        command.targetTick < (commands.at(-1)?.targetTick ?? tick + 1)
      ) {
        return false;
      }
      commands.push(freezeCommand(command));
      highestAcceptedSequence = command.sequence;
      return true;
    },
    load(bytes: Uint8Array): SimulationRuntimeSnapshot {
      const decoded = decodeSimulationSave(bytes, timestepHz);
      const candidateState = adapter.deserializeState(decoded.stateBytes);
      const candidateCommands = decoded.commands.map(freezeCommand);
      const candidateStateBytes = serializeState(adapter, candidateState);
      const candidatePresentation = capturePresentation(
        candidateState,
        decoded.tick,
        candidateStateBytes,
      );
      const candidateSave = encodeSimulationSave(
        decoded.tick,
        timestepHz,
        decoded.lastAppliedSequence,
        decoded.nextEventSequence,
        candidateStateBytes,
        candidateCommands,
      );
      state = candidateState;
      tick = decoded.tick;
      lastAppliedSequence = decoded.lastAppliedSequence;
      commands = candidateCommands;
      highestAcceptedSequence = commands.at(-1)?.sequence ?? decoded.lastAppliedSequence;
      nextEventSequence = decoded.nextEventSequence;
      return Object.freeze({ presentation: candidatePresentation, saveBytes: candidateSave });
    },
    presentation(): SimulationPresentationSnapshot {
      const stateBytes = serializeState(adapter, state);
      return capturePresentation(state, tick, stateBytes);
    },
    queryGameState(query: SimulationGameStateQuery): Uint8Array {
      const handler = adapter.queryState;
      if (handler === undefined) throw new Error("Game simulation state queries are unavailable");
      assertSimulationGameStateQuery(query);
      const result = handler(state, canonicalSimulationGameStateQuery(query));
      if (!(result instanceof Uint8Array)) {
        throw new Error("Game simulation state query result is not bytes");
      }
      if (result.byteLength > MAXIMUM_SIMULATION_GAME_STATE_QUERY_BYTES) {
        throw new Error("Game simulation state query result exceeds byte capacity");
      }
      return result.slice();
    },
    save: snapshot,
    step(): Readonly<{
      readonly appliedCommandCount: number;
      readonly events: readonly SimulationSemanticEvent[];
    }> {
      tick += 1;
      const events: SimulationSemanticEvent[] = [];
      let appliedCommandCount = 0;
      while (commands[0]?.targetTick === tick) {
        const command = commands.shift();
        if (command === undefined) throw new Error("Simulation command queue lost its head");
        const result = adapter.applyCommand(state, command);
        state = result.state;
        lastAppliedSequence = command.sequence;
        appliedCommandCount += 1;
        appendEvents(events, result.events, tick, () => nextEventSequence++);
      }
      const result = adapter.step(state, tick);
      state = result.state;
      appendEvents(events, result.events, tick, () => nextEventSequence++);
      return Object.freeze({ appliedCommandCount, events: Object.freeze(events) });
    },
  });
}

export function runSimulationReplay(
  adapter: GameSimulationAdapter,
  seed: number,
  timestepHz: number,
  commands: readonly SimulationCommand[],
  ticks: number,
): SimulationReplayResult {
  assertSimulationReplayWorkload(commands, ticks);
  assertSafeUnsigned(seed, "Simulation seed");
  const runtime = createSimulationRuntime(adapter, seed, timestepHz);
  for (const command of commands) {
    if (!runtime.enqueue(command)) {
      throw new Error(`Simulation replay rejected command sequence ${command.sequence}`);
    }
  }
  let stepDurationHighWaterMs = 0;
  while (runtime.tick < ticks) {
    const startedAt = performance.now();
    runtime.step();
    stepDurationHighWaterMs = Math.max(stepDurationHighWaterMs, performance.now() - startedAt);
  }
  const final = runtime.save();
  return Object.freeze({
    adapterInitializationDurationMs: 0,
    finalSave: final.saveBytes,
    finalStateHash: final.presentation.stateHash,
    gameCounters: canonicalGameCounters(runtime.gameCounters),
    stepDurationHighWaterMs,
    tick: runtime.tick,
  });
}

export function runSimulationModuleReplay(
  module: GameSimulationModule,
  context: Parameters<GameSimulationModule["createGameSimulationAdapter"]>[0],
  seed: number,
  timestepHz: number,
  commands: readonly SimulationCommand[],
  ticks: number,
): SimulationReplayResult {
  const startedAt = performance.now();
  const adapter = module.createGameSimulationAdapter(context);
  const adapterInitializationDurationMs = performance.now() - startedAt;
  return Object.freeze({
    ...runSimulationReplay(adapter, seed, timestepHz, commands, ticks),
    adapterInitializationDurationMs,
  });
}

export function canonicalGameCounters(
  counters: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  if (typeof counters !== "object" || counters === null || Array.isArray(counters)) {
    throw new Error("Simulation game counters must be a record");
  }
  const canonical: Record<string, number> = {};
  for (const key of Object.keys(counters).sort()) {
    const value = counters[key];
    if (
      !/^[a-z][a-zA-Z0-9]*$/u.test(key) ||
      value === undefined ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      throw new Error(`Simulation game counter ${key} is invalid`);
    }
    canonical[key] = value;
  }
  return Object.freeze(canonical);
}

export function assertSimulationReplayWorkload(
  commands: readonly SimulationCommand[],
  ticks: number,
): void {
  assertSafeUnsigned(ticks, "Simulation replay tick count");
  if (ticks > MAXIMUM_SIMULATION_REPLAY_TICKS) {
    throw new Error(`Simulation replay tick count exceeds ${MAXIMUM_SIMULATION_REPLAY_TICKS}`);
  }
  if (!Array.isArray(commands) || commands.length > MAXIMUM_SIMULATION_REPLAY_COMMANDS) {
    throw new Error(
      `Simulation replay command count exceeds ${MAXIMUM_SIMULATION_REPLAY_COMMANDS}`,
    );
  }
  let commandBytes = 0;
  for (const command of commands) {
    assertSimulationCommand(command);
    commandBytes += encoder.encode(command.kind).byteLength + command.payload.byteLength;
    if (commandBytes > MAXIMUM_SIMULATION_REPLAY_COMMAND_BYTES) {
      throw new Error(
        `Simulation replay command bytes exceed ${MAXIMUM_SIMULATION_REPLAY_COMMAND_BYTES}`,
      );
    }
  }
}

export function canonicalSimulationCommand(command: SimulationCommand): SimulationCommand {
  assertSimulationCommand(command);
  const payload = new Uint8Array(command.payload.byteLength);
  payload.set(command.payload);
  return Object.freeze({
    kind: command.kind,
    payload,
    sequence: command.sequence,
    targetTick: command.targetTick,
  });
}

export function canonicalSimulationGameStateQuery(
  query: SimulationGameStateQuery,
): SimulationGameStateQuery {
  assertSimulationGameStateQuery(query);
  return Object.freeze({ kind: query.kind, payload: query.payload.slice() });
}

function assertSimulationGameStateQuery(query: SimulationGameStateQuery): void {
  if (!isRuntimeIdentifier(query.kind)) {
    throw new Error("Simulation game-state query kind is invalid");
  }
  if (
    !(query.payload instanceof Uint8Array) ||
    query.payload.byteLength > MAXIMUM_SIMULATION_GAME_STATE_QUERY_BYTES
  ) {
    throw new Error("Simulation game-state query payload is invalid or too large");
  }
}

export function interpolateSimulationSnapshots(
  previous: SimulationPresentationSnapshot,
  current: SimulationPresentationSnapshot,
  alpha: number,
): SimulationPresentationSnapshot {
  if (!Number.isFinite(alpha)) throw new Error("Simulation interpolation alpha must be finite");
  const boundedAlpha = Math.max(0, Math.min(1, alpha));
  const previousById = new Map(previous.entities.map((entity) => [entity.id, entity]));
  const entities = current.entities.map((entity) => {
    const from = previousById.get(entity.id);
    if (from === undefined) return freezeEntity(entity);
    return Object.freeze({
      id: entity.id,
      position: Object.freeze([
        lerp(from.position[0], entity.position[0], boundedAlpha),
        lerp(from.position[1], entity.position[1], boundedAlpha),
        lerp(from.position[2], entity.position[2], boundedAlpha),
      ]) as readonly [number, number, number],
      yawRadians: lerpAngle(from.yawRadians, entity.yawRadians, boundedAlpha),
    });
  });
  return freezePresentationSnapshot(current.tick, current.stateHash, entities);
}

function encodeSimulationSave(
  tick: number,
  timestepHz: number,
  lastAppliedSequence: number,
  nextEventSequence: number,
  stateBytes: Uint8Array,
  commands: readonly SimulationCommand[],
): Uint8Array {
  assertSafeUnsigned(tick, "Simulation save tick");
  assertSafeUnsigned(nextEventSequence, "Simulation next event sequence");
  if (!(stateBytes instanceof Uint8Array) || stateBytes.byteLength === 0) {
    throw new Error("Simulation adapter must serialize a non-empty state payload");
  }
  const encodedCommands = commands.map((command) => {
    const kind = encoder.encode(command.kind);
    return Object.freeze({ command, kind });
  });
  const commandBytes = encodedCommands.reduce(
    (total, { command, kind }) =>
      total + COMMAND_HEADER_BYTES + kind.byteLength + command.payload.byteLength,
    0,
  );
  const body = new Uint8Array(stateBytes.byteLength + commandBytes);
  body.set(stateBytes, 0);
  let offset = stateBytes.byteLength;
  for (const { command, kind } of encodedCommands) {
    const record = new DataView(body.buffer, body.byteOffset + offset, COMMAND_HEADER_BYTES);
    record.setBigUint64(0, BigInt(command.sequence), true);
    record.setBigUint64(8, BigInt(command.targetTick), true);
    record.setUint32(16, kind.byteLength, true);
    record.setUint32(20, command.payload.byteLength, true);
    offset += COMMAND_HEADER_BYTES;
    body.set(kind, offset);
    offset += kind.byteLength;
    body.set(command.payload, offset);
    offset += command.payload.byteLength;
  }
  const output = new Uint8Array(SAVE_HEADER_BYTES + BODY_DIGEST_BYTES + body.byteLength);
  output.set(SAVE_MAGIC, 0);
  const view = new DataView(output.buffer);
  view.setUint32(8, SIMULATION_SAVE_SCHEMA_VERSION, true);
  view.setUint32(12, timestepHz, true);
  view.setBigUint64(16, BigInt(tick), true);
  view.setBigInt64(24, BigInt(lastAppliedSequence), true);
  view.setBigUint64(32, BigInt(nextEventSequence), true);
  view.setUint32(40, stateBytes.byteLength, true);
  view.setUint32(44, commands.length, true);
  output.set(body, SAVE_HEADER_BYTES + BODY_DIGEST_BYTES);
  output.set(digestSaveEnvelope(output, body), SAVE_HEADER_BYTES);
  return output;
}

function decodeSimulationSave(
  bytes: Uint8Array,
  expectedTimestepHz: number,
): Readonly<{
  readonly commands: readonly SimulationCommand[];
  readonly lastAppliedSequence: number;
  readonly nextEventSequence: number;
  readonly stateBytes: Uint8Array;
  readonly tick: number;
}> {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < SAVE_HEADER_BYTES + BODY_DIGEST_BYTES + 1
  ) {
    throw new Error("Simulation save is truncated");
  }
  if (SAVE_MAGIC.some((value, index) => bytes[index] !== value)) {
    throw new Error("Simulation save magic is invalid");
  }
  const body = bytes.subarray(SAVE_HEADER_BYTES + BODY_DIGEST_BYTES);
  const digest = bytes.subarray(SAVE_HEADER_BYTES, SAVE_HEADER_BYTES + BODY_DIGEST_BYTES);
  const calculatedDigest = digestSaveEnvelope(bytes, body);
  if (!equalBytes(digest, calculatedDigest)) {
    throw new Error("Simulation save envelope digest is invalid");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(8, true);
  const timestepHz = view.getUint32(12, true);
  const tickBigInt = view.getBigUint64(16, true);
  const lastAppliedSequence = safeBigInt(
    view.getBigInt64(24, true),
    "last applied command sequence",
  );
  const nextEventSequence = safeBigUint(view.getBigUint64(32, true), "next event sequence");
  const stateLength = view.getUint32(40, true);
  const commandCount = view.getUint32(44, true);
  if (version !== SIMULATION_SAVE_SCHEMA_VERSION || timestepHz !== expectedTimestepHz) {
    throw new Error("Simulation save schema or timestep is incompatible");
  }
  if (tickBigInt > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Simulation save tick is unsafe");
  if (stateLength === 0 || stateLength > body.byteLength) {
    throw new Error("Simulation save payload length is invalid");
  }
  const stateBytes = body.subarray(0, stateLength).slice();
  const commands: SimulationCommand[] = [];
  let offset = stateLength;
  for (let index = 0; index < commandCount; index += 1) {
    if (offset + COMMAND_HEADER_BYTES > body.byteLength) {
      throw new Error("Simulation save command header is truncated");
    }
    const record = new DataView(body.buffer, body.byteOffset + offset, COMMAND_HEADER_BYTES);
    const sequence = safeBigUint(record.getBigUint64(0, true), "command sequence");
    const targetTick = safeBigUint(record.getBigUint64(8, true), "command tick");
    const kindLength = record.getUint32(16, true);
    const payloadLength = record.getUint32(20, true);
    offset += COMMAND_HEADER_BYTES;
    if (
      kindLength === 0 ||
      kindLength > MAXIMUM_COMMAND_KIND_BYTES ||
      payloadLength > MAXIMUM_COMMAND_PAYLOAD_BYTES ||
      offset + kindLength + payloadLength > body.byteLength
    ) {
      throw new Error("Simulation save command record is invalid");
    }
    const kind = decoder.decode(body.subarray(offset, offset + kindLength));
    offset += kindLength;
    const payload = body.subarray(offset, offset + payloadLength).slice();
    offset += payloadLength;
    const command = Object.freeze({ kind, payload, sequence, targetTick });
    assertSimulationCommand(command);
    if (
      targetTick <= Number(tickBigInt) ||
      sequence <= (commands.at(-1)?.sequence ?? lastAppliedSequence) ||
      targetTick < (commands.at(-1)?.targetTick ?? Number(tickBigInt) + 1)
    ) {
      throw new Error("Simulation save command order is invalid");
    }
    commands.push(command);
  }
  if (offset !== body.byteLength) throw new Error("Simulation save has trailing bytes");
  return Object.freeze({
    commands: Object.freeze(commands),
    lastAppliedSequence,
    nextEventSequence,
    stateBytes,
    tick: Number(tickBigInt),
  });
}

function assertSimulationCommand(command: SimulationCommand): void {
  if (
    typeof command.kind !== "string" ||
    command.kind === "" ||
    !(command.payload instanceof Uint8Array) ||
    encoder.encode(command.kind).byteLength > MAXIMUM_COMMAND_KIND_BYTES ||
    command.payload.byteLength > MAXIMUM_COMMAND_PAYLOAD_BYTES
  ) {
    throw new Error("Simulation command has an invalid kind or payload");
  }
  assertSafeUnsigned(command.sequence, "Simulation command sequence");
  assertSafeUnsigned(command.targetTick, "Simulation command target tick");
}

function serializeState(adapter: GameSimulationAdapter, state: unknown): Uint8Array {
  const bytes = adapter.serializeState(state);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new Error("Simulation adapter must serialize a non-empty state payload");
  }
  return bytes;
}

function digestSaveEnvelope(bytes: Uint8Array, body: Uint8Array): Uint8Array {
  return sha256.create().update(bytes.subarray(0, SAVE_HEADER_BYTES)).update(body).digest();
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function freezeCommand(command: SimulationCommand): SimulationCommand {
  return canonicalSimulationCommand(command);
}

function freezePresentationSnapshot(
  tick: number,
  stateHash: string,
  entities: readonly SimulationPresentationEntity[],
): SimulationPresentationSnapshot {
  const ids = new Set<number>();
  const frozen = entities.map((entity) => {
    if (ids.has(entity.id)) throw new Error(`Duplicate simulation entity ID ${entity.id}`);
    ids.add(entity.id);
    return freezeEntity(entity);
  });
  frozen.sort((left, right) => left.id - right.id);
  return Object.freeze({ entities: Object.freeze(frozen), stateHash, tick });
}

function freezeEntity(entity: SimulationPresentationEntity): SimulationPresentationEntity {
  if (
    !Number.isSafeInteger(entity.id) ||
    entity.id <= 0 ||
    entity.position.length !== 3 ||
    [...entity.position, entity.yawRadians].some((value) => !Number.isFinite(value))
  ) {
    throw new Error("Simulation presentation entity is invalid");
  }
  return Object.freeze({
    id: entity.id,
    position: Object.freeze([...entity.position]) as readonly [number, number, number],
    yawRadians: entity.yawRadians,
  });
}

function appendEvents(
  target: SimulationSemanticEvent[],
  events: readonly Readonly<{ readonly kind: string; readonly payload: Uint8Array }>[],
  tick: number,
  sequence: () => number,
): void {
  for (const event of events) {
    if (event.kind === "" || !(event.payload instanceof Uint8Array)) {
      throw new Error("Simulation adapter emitted an invalid semantic event");
    }
    target.push(
      Object.freeze({
        kind: event.kind,
        payload: event.payload.slice(),
        sequence: sequence(),
        tick,
      }),
    );
  }
}

function assertSafeUnsigned(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a safe unsigned integer`);
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${label} must be a positive safe integer`);
}

function safeBigUint(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error(`Simulation save ${label} is unsafe`);
  return Number(value);
}

function safeBigInt(value: bigint, label: string): number {
  if (value < -1n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Simulation save ${label} is unsafe`);
  }
  return Number(value);
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

function lerpAngle(from: number, to: number, alpha: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * alpha;
}
