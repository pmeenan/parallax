import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MEMORY64_SPIKE_HIGH_ADDRESS,
  MEMORY64_SPIKE_HIGH_PAGES,
  MEMORY64_SPIKE_HIGH_SENTINEL,
  type Memory64SpikeWorkerResponse,
} from "../src/wasm/memory64-spike-protocol";
import { createMemory64SpikeService } from "../src/wasm/memory64-spike-service";

class FakeWorker {
  static readonly instances: FakeWorker[] = [];

  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<Memory64SpikeWorkerResponse>) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly posted: unknown[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  emit(message: Memory64SpikeWorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<Memory64SpikeWorkerResponse>);
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }
}

afterEach(() => {
  FakeWorker.instances.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("memory64 spike service", () => {
  it("starts exactly one dedicated worker and publishes its completed evidence", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const service = createMemory64SpikeService();

    service.start();
    service.start();

    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0];
    expect(worker?.posted).toHaveLength(1);
    worker?.emit({
      highAddress: {
        address: MEMORY64_SPIKE_HIGH_ADDRESS,
        growAndTouchElapsedMs: 5,
        logicalMemoryBytes: MEMORY64_SPIKE_HIGH_PAGES * 65_536,
        pages: MEMORY64_SPIKE_HIGH_PAGES,
        sentinelRead: MEMORY64_SPIKE_HIGH_SENTINEL,
        sentinelReturned: MEMORY64_SPIKE_HIGH_SENTINEL,
        sentinelWritten: MEMORY64_SPIKE_HIGH_SENTINEL,
      },
      kind: "completed",
      memory32: { fetchElapsedMs: 1, moduleBytes: 196, samples: [], variant: "memory32" },
      memory64: { fetchElapsedMs: 1, moduleBytes: 277, samples: [], variant: "memory64" },
      totalElapsedMs: 10,
    });

    expect(service.snapshot()).toMatchObject({ state: "completed", totalElapsedMs: 10 });
    expect(worker?.terminated).toBe(true);
    expect(Object.isFrozen(service.snapshot().highAddress)).toBe(true);
  });

  it("publishes terminal failure when worker construction throws synchronously", () => {
    class ThrowingWorker {
      constructor() {
        throw new Error("constructor rejected");
      }
    }
    vi.stubGlobal("Worker", ThrowingWorker);
    const service = createMemory64SpikeService();

    service.start();

    expect(service.snapshot()).toMatchObject({
      failureMessage: "Memory64 spike failed to start: constructor rejected",
      state: "failed",
    });
  });

  it("terminates the worker and publishes failure when postMessage throws synchronously", () => {
    class ThrowingPostWorker extends FakeWorker {
      override postMessage(): void {
        throw new Error("post rejected");
      }
    }
    vi.stubGlobal("Worker", ThrowingPostWorker);
    const service = createMemory64SpikeService();

    service.start();

    expect(service.snapshot()).toMatchObject({
      failureMessage: "Memory64 spike failed to start: post rejected",
      state: "failed",
    });
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
  });
});
