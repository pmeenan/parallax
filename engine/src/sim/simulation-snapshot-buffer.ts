import type {
  SimulationPresentationEntity,
  SimulationPresentationSnapshot,
} from "./simulation-protocol";

export const SIMULATION_SNAPSHOT_BUFFER_SCHEMA_VERSION = 2;
export const SIMULATION_SNAPSHOT_BUFFER_SLOT_COUNT = 3;
const HEADER_WORDS = 4;
const SLOT_HEADER_WORDS = 4;
const ENTITY_WORDS = 6;
const SCHEMA_INDEX = 0;
const CAPACITY_INDEX = 1;
const PUBLISHED_SLOT_INDEX = 2;
const PUBLISHED_SEQUENCE_INDEX = 3;
const SLOT_SEQUENCE_OFFSET = 0;
const SLOT_TICK_LOW_OFFSET = 1;
const SLOT_TICK_HIGH_OFFSET = 2;
const SLOT_COUNT_OFFSET = 3;
const MAXIMUM_PUBLICATION_SEQUENCE = 0x7fff_ffff;
const UINT32_RANGE = 0x1_0000_0000;

export interface SimulationSnapshotBufferWriter {
  publish(snapshot: SimulationPresentationSnapshot): SimulationSnapshotPublication;
}

export interface SimulationSnapshotPublication {
  readonly sequence: number;
  readonly slot: number;
  readonly tick: number;
}

export class SimulationSnapshotPublicationOverwrittenError extends Error {
  constructor() {
    super("Simulation snapshot publication was overwritten before it was read");
    this.name = "SimulationSnapshotPublicationOverwrittenError";
  }
}

export function simulationSnapshotBufferBytes(entityCapacity: number): number {
  assertCapacity(entityCapacity);
  return (
    (HEADER_WORDS +
      SIMULATION_SNAPSHOT_BUFFER_SLOT_COUNT * (SLOT_HEADER_WORDS + entityCapacity * ENTITY_WORDS)) *
    Int32Array.BYTES_PER_ELEMENT
  );
}

export function createSimulationSnapshotBuffer(entityCapacity: number): SharedArrayBuffer {
  const buffer = new SharedArrayBuffer(simulationSnapshotBufferBytes(entityCapacity));
  const words = new Int32Array(buffer);
  Atomics.store(words, SCHEMA_INDEX, SIMULATION_SNAPSHOT_BUFFER_SCHEMA_VERSION);
  Atomics.store(words, CAPACITY_INDEX, entityCapacity);
  Atomics.store(words, PUBLISHED_SLOT_INDEX, -1);
  Atomics.store(words, PUBLISHED_SEQUENCE_INDEX, 0);
  return buffer;
}

export function createSimulationSnapshotBufferWriter(
  buffer: SharedArrayBuffer,
): SimulationSnapshotBufferWriter {
  const { capacity, words } = validateBuffer(buffer);
  const unsignedWords = new Uint32Array(buffer);
  const floats = new Float32Array(buffer);
  return Object.freeze({
    publish(snapshot: SimulationPresentationSnapshot): SimulationSnapshotPublication {
      if (snapshot.entities.length > capacity) {
        throw new Error(
          `Simulation snapshot has ${snapshot.entities.length} entities; capacity is ${capacity}`,
        );
      }
      assertSafeUnsigned(snapshot.tick, "Simulation snapshot tick");
      const sequence = Atomics.load(words, PUBLISHED_SEQUENCE_INDEX) + 1;
      if (sequence > MAXIMUM_PUBLICATION_SEQUENCE) {
        throw new Error("Simulation snapshot publication sequence is exhausted");
      }
      const previousSlot = Atomics.load(words, PUBLISHED_SLOT_INDEX);
      const slot = (previousSlot + 1) % SIMULATION_SNAPSHOT_BUFFER_SLOT_COUNT;
      const base = slotBase(slot, capacity);

      // Make the old generation unreadable before mutating any slot payload. The final
      // positive store commits this generation; readers require the same value before
      // and after their copy.
      Atomics.store(words, base + SLOT_SEQUENCE_OFFSET, -sequence);
      writeSafeUnsigned(
        unsignedWords,
        base + SLOT_TICK_LOW_OFFSET,
        base + SLOT_TICK_HIGH_OFFSET,
        snapshot.tick,
      );
      words[base + SLOT_COUNT_OFFSET] = snapshot.entities.length;
      let offset = base + SLOT_HEADER_WORDS;
      for (const entity of snapshot.entities) {
        assertEntity(entity);
        writeSafeUnsigned(unsignedWords, offset, offset + 1, entity.id);
        floats[offset + 2] = entity.position[0];
        floats[offset + 3] = entity.position[1];
        floats[offset + 4] = entity.position[2];
        floats[offset + 5] = entity.yawRadians;
        offset += ENTITY_WORDS;
      }
      Atomics.store(words, base + SLOT_SEQUENCE_OFFSET, sequence);
      Atomics.store(words, PUBLISHED_SLOT_INDEX, slot);
      Atomics.store(words, PUBLISHED_SEQUENCE_INDEX, sequence);
      return Object.freeze({ sequence, slot, tick: snapshot.tick });
    },
  });
}

export function readSimulationSnapshotBuffer(
  buffer: SharedArrayBuffer,
  stateHash: string,
  publication?: SimulationSnapshotPublication,
): SimulationPresentationSnapshot {
  const { capacity, words } = validateBuffer(buffer);
  const unsignedWords = new Uint32Array(buffer);
  const floats = new Float32Array(buffer);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const publishedSequenceBefore = Atomics.load(words, PUBLISHED_SEQUENCE_INDEX);
    const slot = publication?.slot ?? Atomics.load(words, PUBLISHED_SLOT_INDEX);
    if (slot < 0 || slot >= SIMULATION_SNAPSHOT_BUFFER_SLOT_COUNT) {
      throw new Error("Simulation snapshot buffer has not published a slot");
    }
    const base = slotBase(slot, capacity);
    const slotSequenceBefore = Atomics.load(words, base + SLOT_SEQUENCE_OFFSET);
    const expectedSequence = publication?.sequence ?? publishedSequenceBefore;
    if (slotSequenceBefore !== expectedSequence || slotSequenceBefore <= 0) {
      if (publication !== undefined) throw new SimulationSnapshotPublicationOverwrittenError();
      continue;
    }
    const tick = readSafeUnsigned(
      unsignedWords,
      base + SLOT_TICK_LOW_OFFSET,
      base + SLOT_TICK_HIGH_OFFSET,
      "Simulation snapshot tick",
    );
    const count = words[base + SLOT_COUNT_OFFSET] ?? -1;
    if (count < 0 || count > capacity) {
      throw new Error("Simulation snapshot buffer metadata is invalid");
    }
    if (publication !== undefined && tick !== publication.tick) {
      throw new SimulationSnapshotPublicationOverwrittenError();
    }
    const entities: SimulationPresentationEntity[] = [];
    let offset = base + SLOT_HEADER_WORDS;
    for (let index = 0; index < count; index += 1) {
      const id = readSafeUnsigned(unsignedWords, offset, offset + 1, "Simulation entity ID");
      const position = Object.freeze([
        floats[offset + 2] ?? Number.NaN,
        floats[offset + 3] ?? Number.NaN,
        floats[offset + 4] ?? Number.NaN,
      ]) as readonly [number, number, number];
      const yawRadians = floats[offset + 5] ?? Number.NaN;
      if (id <= 0 || [...position, yawRadians].some((value) => !Number.isFinite(value))) {
        throw new Error("Simulation snapshot buffer entity is invalid");
      }
      entities.push(Object.freeze({ id, position, yawRadians }));
      offset += ENTITY_WORDS;
    }
    const slotSequenceAfter = Atomics.load(words, base + SLOT_SEQUENCE_OFFSET);
    const publishedSequenceAfter = Atomics.load(words, PUBLISHED_SEQUENCE_INDEX);
    const publishedSlotAfter = Atomics.load(words, PUBLISHED_SLOT_INDEX);
    if (
      slotSequenceBefore === slotSequenceAfter &&
      (publication !== undefined ||
        (publishedSequenceBefore === publishedSequenceAfter && slot === publishedSlotAfter))
    ) {
      return Object.freeze({ entities: Object.freeze(entities), stateHash, tick });
    }
    if (publication !== undefined) throw new SimulationSnapshotPublicationOverwrittenError();
  }
  throw new Error("Simulation snapshot buffer changed during every bounded read attempt");
}

function validateBuffer(
  buffer: SharedArrayBuffer,
): Readonly<{ readonly capacity: number; readonly words: Int32Array }> {
  if (!(buffer instanceof SharedArrayBuffer) || buffer.byteLength < HEADER_WORDS * 4) {
    throw new Error("Simulation snapshot buffer is invalid");
  }
  const words = new Int32Array(buffer);
  const capacity = Atomics.load(words, CAPACITY_INDEX);
  if (
    Atomics.load(words, SCHEMA_INDEX) !== SIMULATION_SNAPSHOT_BUFFER_SCHEMA_VERSION ||
    buffer.byteLength !== simulationSnapshotBufferBytes(capacity)
  ) {
    throw new Error("Simulation snapshot buffer identity is invalid");
  }
  return Object.freeze({ capacity, words });
}

function slotBase(slot: number, capacity: number): number {
  return HEADER_WORDS + slot * (SLOT_HEADER_WORDS + capacity * ENTITY_WORDS);
}

function writeSafeUnsigned(
  words: Uint32Array,
  lowIndex: number,
  highIndex: number,
  value: number,
): void {
  assertSafeUnsigned(value, "Simulation snapshot integer");
  words[lowIndex] = value % UINT32_RANGE;
  words[highIndex] = Math.floor(value / UINT32_RANGE);
}

function readSafeUnsigned(
  words: Uint32Array,
  lowIndex: number,
  highIndex: number,
  label: string,
): number {
  const value = (words[highIndex] ?? 0) * UINT32_RANGE + (words[lowIndex] ?? 0);
  assertSafeUnsigned(value, label);
  return value;
}

function assertEntity(entity: SimulationPresentationEntity): void {
  if (
    !Number.isSafeInteger(entity.id) ||
    entity.id <= 0 ||
    entity.position.length !== 3 ||
    [...entity.position, entity.yawRadians].some((value) => !Number.isFinite(value))
  ) {
    throw new Error("Simulation snapshot entity is invalid");
  }
}

function assertSafeUnsigned(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a safe unsigned integer`);
  }
}

function assertCapacity(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 65_536) {
    throw new Error("Simulation snapshot entity capacity must be 1..65536");
  }
}
