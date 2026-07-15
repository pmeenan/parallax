import { describe, expect, it } from "vitest";
import {
  attachSpscRingBuffer,
  createSpscRingBuffer,
  SPSC_RING_HEADER_WORDS,
} from "../src/workers/spsc-ring-buffer";

describe("SPSC shared ring buffer", () => {
  it("preserves record order and applies fixed-capacity backpressure", () => {
    const producer = createSpscRingBuffer(2, 2);
    const consumer = attachSpscRingBuffer(producer.descriptor);
    const first = new Int32Array([1, 11]);
    const second = new Int32Array([2, 22]);
    const output = new Int32Array(2);

    expect(producer.tryWrite(first)).toBe(true);
    expect(producer.tryWrite(second)).toBe(true);
    expect(producer.tryWrite(first)).toBe(false);
    expect(producer.availableRead()).toBe(2);
    expect(consumer.tryRead(output)).toBe(true);
    expect([...output]).toEqual([1, 11]);
    expect(consumer.tryRead(output)).toBe(true);
    expect([...output]).toEqual([2, 22]);
    expect(consumer.tryRead(output)).toBe(false);
    expect(producer.availableWrite()).toBe(2);
  });

  it("continues across the unsigned 32-bit sequence wrap", () => {
    const ring = createSpscRingBuffer(2, 1);
    const header = new Int32Array(ring.descriptor.buffer, 0, SPSC_RING_HEADER_WORDS);
    Atomics.store(header, 0, -1);
    Atomics.store(header, 1, -1);
    const input = new Int32Array([73]);
    const output = new Int32Array(1);

    expect(ring.tryWrite(input)).toBe(true);
    expect(ring.tryRead(output)).toBe(true);
    expect(output[0]).toBe(73);
    expect(Atomics.load(header, 0)).toBe(0);
    expect(Atomics.load(header, 1)).toBe(0);
  });

  it("rejects descriptors that do not match the shared allocation", () => {
    const ring = createSpscRingBuffer(4, 2);
    expect(() => attachSpscRingBuffer({ ...ring.descriptor, capacity: 8 })).toThrow(
      "byte length mismatch",
    );
  });

  it("rejects non-power-of-two capacities that would alias records at sequence wrap", () => {
    expect(() => createSpscRingBuffer(3, 1)).toThrow("power of two");
    const ring = createSpscRingBuffer(4, 1);
    expect(() => attachSpscRingBuffer({ ...ring.descriptor, capacity: 3 })).toThrow(
      "invalid capacity",
    );
  });

  it("waits asynchronously for readable and writable sequence changes", async () => {
    const ring = createSpscRingBuffer(1, 1);
    const input = new Int32Array([5]);
    const output = new Int32Array(1);

    await expect(ring.waitForReadable(1)).resolves.toBe("timed-out");
    expect(ring.tryWrite(input)).toBe(true);
    await expect(ring.waitForReadable(1)).resolves.toBe("ok");
    await expect(ring.waitForWritable(1)).resolves.toBe("timed-out");
    expect(ring.tryRead(output)).toBe(true);
    await expect(ring.waitForWritable(1)).resolves.toBe("ok");
  });
});
