import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WASM_THREAD_SPIKE_TASK_COUNT,
  WASM_THREAD_SPIKE_TIMEOUT_MS,
  type WasmThreadSpikeWorkerResponse,
} from "../src/wasm/wasm-thread-spike-protocol";
import { createWasmThreadSpikeService } from "../src/wasm/wasm-thread-spike-service";

class FakeWorker {
  static readonly instances: FakeWorker[] = [];

  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<WasmThreadSpikeWorkerResponse>) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly posted: unknown[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  emit(message: WasmThreadSpikeWorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<WasmThreadSpikeWorkerResponse>);
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Rust/WASM thread spike service", () => {
  it("ends parallel execution timing before the serial reference snapshot", async () => {
    let now = 0;
    installStartupStubs(() => now);
    const service = createWasmThreadSpikeService();

    service.start();
    now = 1;
    await drainMicrotasks();

    const [coordinator, peer] = requireWorkers();
    now = 2;
    coordinator.emit({ kind: "ready", workerIndex: 0 });
    now = 3;
    peer.emit({ kind: "ready", workerIndex: 1 });
    now = 4;
    coordinator.emit({ kind: "reset-complete" });
    now = 7;
    coordinator.emit({ claimedTasks: 130_000, kind: "run-complete", workerIndex: 0 });
    now = 9;
    peer.emit({ claimedTasks: 132_144, kind: "run-complete", workerIndex: 1 });

    expect(service.snapshot().parallelExecutionElapsedMs).toBe(5);
    now = 100;
    coordinator.emit({
      checksum: 42,
      completedTasks: WASM_THREAD_SPIKE_TASK_COUNT,
      kind: "snapshot",
      referenceChecksum: 42,
      workerMask: 3,
    });

    expect(service.snapshot()).toMatchObject({
      elapsedMs: 100,
      parallelExecutionElapsedMs: 5,
      state: "completed",
    });
  });

  it("does not resume startup after disposal while fetch is pending", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchResult = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    installDeferredStartupStubs(fetchResult);
    const service = createWasmThreadSpikeService();

    service.start();
    service.dispose();
    resolveFetch?.(successfulResponse());
    await drainMicrotasks();

    expect(FakeWorker.instances).toHaveLength(0);
    expect(service.snapshot().moduleBytes).toBeNull();
  });

  it("does not resume startup after the page-owned timeout", async () => {
    vi.useFakeTimers();
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchResult = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    installDeferredStartupStubs(fetchResult);
    const service = createWasmThreadSpikeService();

    service.start();
    await vi.advanceTimersByTimeAsync(WASM_THREAD_SPIKE_TIMEOUT_MS);
    resolveFetch?.(successfulResponse());
    await drainMicrotasks();

    expect(service.snapshot()).toMatchObject({
      failureMessage: `WASM thread spike exceeded ${WASM_THREAD_SPIKE_TIMEOUT_MS} ms`,
      moduleBytes: null,
      state: "failed",
    });
    expect(FakeWorker.instances).toHaveLength(0);
  });
});

function installStartupStubs(now: () => number): void {
  vi.stubGlobal("performance", { now });
  installDeferredStartupStubs(Promise.resolve(successfulResponse()));
}

function installDeferredStartupStubs(fetchResult: Promise<Response>): void {
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => fetchResult),
  );
  vi.spyOn(WebAssembly, "compile").mockResolvedValue({} as WebAssembly.Module);
}

function successfulResponse(): Response {
  return {
    arrayBuffer: async () => new ArrayBuffer(8),
    ok: true,
    status: 200,
  } as Response;
}

function requireWorkers(): readonly [FakeWorker, FakeWorker] {
  const coordinator = FakeWorker.instances[0];
  const peer = FakeWorker.instances[1];
  if (coordinator === undefined || peer === undefined) {
    throw new Error("WASM service did not create both workers");
  }
  return [coordinator, peer];
}

async function drainMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}
