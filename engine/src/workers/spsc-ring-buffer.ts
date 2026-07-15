const WRITE_SEQUENCE_INDEX = 0;
const READ_SEQUENCE_INDEX = 1;
const CAPACITY_INDEX = 2;
const RECORD_WORDS_INDEX = 3;

export const SPSC_RING_HEADER_WORDS = 4;

export interface SpscRingBufferDescriptor {
  readonly buffer: SharedArrayBuffer;
  readonly capacity: number;
  readonly recordWords: number;
}

export interface SpscRingBuffer {
  readonly byteLength: number;
  readonly capacity: number;
  readonly descriptor: SpscRingBufferDescriptor;
  readonly recordWords: number;
  availableRead(): number;
  availableWrite(): number;
  tryRead(target: Int32Array): boolean;
  tryWrite(source: Int32Array): boolean;
  waitForReadable(timeoutMs: number): Promise<"ok" | "timed-out">;
  waitForWritable(timeoutMs: number): Promise<"ok" | "timed-out">;
}

export function createSpscRingBuffer(capacity: number, recordWords: number): SpscRingBuffer {
  if (
    !Number.isInteger(capacity) ||
    capacity <= 0 ||
    capacity >= 0x8000_0000 ||
    (capacity & (capacity - 1)) !== 0
  ) {
    throw new RangeError("SPSC ring capacity must be a power of two between 1 and 2^30");
  }
  if (!Number.isInteger(recordWords) || recordWords <= 0) {
    throw new RangeError("SPSC ring recordWords must be a positive integer");
  }
  const wordLength = SPSC_RING_HEADER_WORDS + capacity * recordWords;
  const buffer = new SharedArrayBuffer(wordLength * Int32Array.BYTES_PER_ELEMENT);
  const header = new Int32Array(buffer, 0, SPSC_RING_HEADER_WORDS);
  Atomics.store(header, CAPACITY_INDEX, capacity);
  Atomics.store(header, RECORD_WORDS_INDEX, recordWords);
  return attachSpscRingBuffer(Object.freeze({ buffer, capacity, recordWords }));
}

export function attachSpscRingBuffer(descriptor: SpscRingBufferDescriptor): SpscRingBuffer {
  const { buffer, capacity, recordWords } = descriptor;
  if (
    !Number.isInteger(capacity) ||
    capacity <= 0 ||
    capacity >= 0x8000_0000 ||
    (capacity & (capacity - 1)) !== 0 ||
    !Number.isInteger(recordWords) ||
    recordWords <= 0
  ) {
    throw new Error("SPSC ring descriptor has invalid capacity or record width");
  }
  const expectedBytes =
    (SPSC_RING_HEADER_WORDS + capacity * recordWords) * Int32Array.BYTES_PER_ELEMENT;
  if (buffer.byteLength !== expectedBytes) {
    throw new Error(
      `SPSC ring byte length mismatch: expected ${expectedBytes}, received ${buffer.byteLength}`,
    );
  }
  const header = new Int32Array(buffer, 0, SPSC_RING_HEADER_WORDS);
  if (
    Atomics.load(header, CAPACITY_INDEX) !== capacity ||
    Atomics.load(header, RECORD_WORDS_INDEX) !== recordWords
  ) {
    throw new Error("SPSC ring descriptor does not match its shared header");
  }
  const records = new Int32Array(
    buffer,
    SPSC_RING_HEADER_WORDS * Int32Array.BYTES_PER_ELEMENT,
    capacity * recordWords,
  );
  const frozenDescriptor = Object.freeze({ buffer, capacity, recordWords });

  const distance = (): number => {
    const readSequence = Atomics.load(header, READ_SEQUENCE_INDEX);
    const writeSequence = Atomics.load(header, WRITE_SEQUENCE_INDEX);
    return (writeSequence - readSequence) >>> 0;
  };

  const checkedDistance = (): number => {
    const current = distance();
    if (current > capacity) {
      throw new Error(`SPSC ring sequence distance ${current} exceeds capacity ${capacity}`);
    }
    return current;
  };

  return Object.freeze({
    byteLength: buffer.byteLength,
    capacity,
    descriptor: frozenDescriptor,
    recordWords,

    availableRead(): number {
      return checkedDistance();
    },

    availableWrite(): number {
      return capacity - checkedDistance();
    },

    tryRead(target: Int32Array): boolean {
      if (target.length !== recordWords) {
        throw new RangeError(`SPSC ring read target must contain exactly ${recordWords} words`);
      }
      const readSequence = Atomics.load(header, READ_SEQUENCE_INDEX) >>> 0;
      const writeSequence = Atomics.load(header, WRITE_SEQUENCE_INDEX) >>> 0;
      if (readSequence === writeSequence) return false;
      const recordOffset = (readSequence % capacity) * recordWords;
      for (let index = 0; index < recordWords; index += 1) {
        target[index] = Atomics.load(records, recordOffset + index);
      }
      Atomics.store(header, READ_SEQUENCE_INDEX, (readSequence + 1) | 0);
      Atomics.notify(header, READ_SEQUENCE_INDEX, 1);
      return true;
    },

    tryWrite(source: Int32Array): boolean {
      if (source.length !== recordWords) {
        throw new RangeError(`SPSC ring source must contain exactly ${recordWords} words`);
      }
      const writeSequence = Atomics.load(header, WRITE_SEQUENCE_INDEX) >>> 0;
      const readSequence = Atomics.load(header, READ_SEQUENCE_INDEX) >>> 0;
      if ((writeSequence - readSequence) >>> 0 >= capacity) return false;
      const recordOffset = (writeSequence % capacity) * recordWords;
      for (let index = 0; index < recordWords; index += 1) {
        const word = source[index];
        if (word === undefined) {
          throw new Error("SPSC ring source length changed during write");
        }
        Atomics.store(records, recordOffset + index, word);
      }
      Atomics.store(header, WRITE_SEQUENCE_INDEX, (writeSequence + 1) | 0);
      Atomics.notify(header, WRITE_SEQUENCE_INDEX, 1);
      return true;
    },

    waitForReadable(timeoutMs: number): Promise<"ok" | "timed-out"> {
      const readSequence = Atomics.load(header, READ_SEQUENCE_INDEX);
      const writeSequence = Atomics.load(header, WRITE_SEQUENCE_INDEX);
      if (readSequence !== writeSequence) return Promise.resolve("ok");
      return waitForSequenceChange(header, WRITE_SEQUENCE_INDEX, writeSequence, timeoutMs);
    },

    waitForWritable(timeoutMs: number): Promise<"ok" | "timed-out"> {
      const writeSequence = Atomics.load(header, WRITE_SEQUENCE_INDEX);
      const readSequence = Atomics.load(header, READ_SEQUENCE_INDEX);
      if ((writeSequence - readSequence) >>> 0 < capacity) return Promise.resolve("ok");
      return waitForSequenceChange(header, READ_SEQUENCE_INDEX, readSequence, timeoutMs);
    },
  });
}

async function waitForSequenceChange(
  header: Int32Array,
  index: number,
  expected: number,
  timeoutMs: number,
): Promise<"ok" | "timed-out"> {
  const waiter = Atomics.waitAsync(header, index, expected, timeoutMs);
  const result = waiter.async ? await waiter.value : waiter.value;
  return result === "timed-out" ? "timed-out" : "ok";
}
