import { describe, expect, it } from "vitest";
import type { OpfsReadSpikeConfig } from "../src/storage/opfs-read-spike-protocol.js";
import {
  measureSequentialReads,
  type OpfsSyncAccessHandle,
} from "../src/storage/opfs-read-spike-worker-core.js";

const config: OpfsReadSpikeConfig = Object.freeze({
  fileBytes: 16,
  randomBatchReads: 1,
  randomReadBytes: 4,
  randomReads: 1,
  sequentialPasses: 1,
  sequentialReadBytes: 8,
});

class FakeSyncAccessHandle implements OpfsSyncAccessHandle {
  readonly source: Uint8Array;
  readCalls = 0;
  shortReadCall: number | null = null;

  constructor() {
    const words = new Uint32Array([0, 1, 2, 3]);
    this.source = new Uint8Array(words.buffer.slice(0));
  }

  close(): void {}
  flush(): void {}
  getSize(): number {
    return this.source.byteLength;
  }
  read(buffer: Uint8Array, options: Readonly<{ at: number }>): number {
    const call = this.readCalls;
    this.readCalls += 1;
    buffer.set(this.source.subarray(options.at, options.at + buffer.byteLength));
    return call === this.shortReadCall ? buffer.byteLength - 4 : buffer.byteLength;
  }
  truncate(): void {}
  write(): number {
    return 0;
  }
}

describe("OPFS sequential worker core", () => {
  it("validates one untimed preflight and excludes it from measured telemetry", () => {
    const handle = new FakeSyncAccessHandle();
    const timestamps = [10, 11, 12, 14, 15, 18, 20, 21];
    let timestampIndex = 0;
    const result = measureSequentialReads(
      handle,
      config,
      Number.POSITIVE_INFINITY,
      () => {
        const timestamp = timestamps[timestampIndex];
        if (timestamp === undefined) throw new Error("Unexpected timer read");
        timestampIndex += 1;
        return timestamp;
      },
      () => {},
    );

    expect(handle.readCalls).toBe(4);
    expect(timestampIndex).toBe(timestamps.length);
    expect(result).toMatchObject({
      bytesRead: 16,
      batches: [
        {
          bytesRead: 16,
          operations: 2,
          readCallElapsedMs: 5,
          wallElapsedMs: 9,
        },
      ],
      operations: 2,
      readCallElapsedMs: 5,
      validationErrors: 0,
      wallElapsedMs: 11,
    });
  });

  it("rejects a short preflight read", () => {
    const handle = new FakeSyncAccessHandle();
    handle.shortReadCall = 0;
    expect(() =>
      measureSequentialReads(
        handle,
        config,
        Number.POSITIVE_INFINITY,
        () => 1,
        () => {},
      ),
    ).toThrow("sequential preflight short read");
  });

  it("rejects corruption during the preflight", () => {
    const handle = new FakeSyncAccessHandle();
    new Uint32Array(handle.source.buffer)[0] = 99;
    expect(() =>
      measureSequentialReads(
        handle,
        config,
        Number.POSITIVE_INFINITY,
        () => 1,
        () => {},
      ),
    ).toThrow("sequential preflight found 1 data errors");
  });
});
