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
    expect(WebAssembly.compileStreaming).toHaveBeenCalledOnce();
    expect(WebAssembly.compileStreaming).toHaveBeenCalledWith(expect.any(Object));
    expect(WebAssembly.instantiateStreaming).not.toHaveBeenCalled();
    expect(WebAssembly.instantiate).not.toHaveBeenCalled();

    const [coordinator, peer] = requireWorkers();
    const coordinatorInitialization = coordinator.posted[0] as { module?: unknown } | undefined;
    const peerInitialization = peer.posted[0] as { module?: unknown } | undefined;
    expect(coordinatorInitialization?.module).toBe(compiledModule);
    expect(peerInitialization?.module).toBe(compiledModule);
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
      failureMessage: `WASM thread spike exceeded ${WASM_THREAD_SPIKE_TIMEOUT_MS} ms; worker phases [0:not-created,1:not-created]`,
      moduleBytes: null,
      state: "failed",
    });
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it("consumes the artifact only through compileStreaming", async () => {
    const response = successfulResponse();
    installDeferredStartupStubs(Promise.resolve(response));
    const service = createWasmThreadSpikeService();

    service.start();
    await drainMicrotasks();

    expect(WebAssembly.compileStreaming).toHaveBeenCalledWith(response);
    expect(response.clone).not.toHaveBeenCalled();
    expect(response.arrayBuffer).not.toHaveBeenCalled();
    expect(service.snapshot().moduleBytes).toBe(8);
  });

  it.each([
    ["fetch", failedResponse(503), "WASM artifact fetch failed with 503"],
    [
      "MIME",
      successfulResponse({ contentType: "application/octet-stream" }),
      "WASM artifact response MIME type must be application/wasm; received application/octet-stream",
    ],
    [
      "length",
      successfulResponse({ contentLength: "08" }),
      "WASM artifact response Content-Length is missing or non-canonical",
    ],
  ] as const)("retains a typed %s failure before worker startup", async (_phase, response, message) => {
    installDeferredStartupStubs(Promise.resolve(response));
    const service = createWasmThreadSpikeService();

    service.start();
    await drainMicrotasks();

    expect(service.snapshot()).toMatchObject({ failureMessage: message, state: "failed" });
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it("retains compileStreaming failure evidence without starting workers", async () => {
    installDeferredStartupStubs(Promise.resolve(successfulResponse()));
    vi.mocked(WebAssembly.compileStreaming).mockRejectedValueOnce(
      new TypeError("synthetic streaming compile failure"),
    );
    const service = createWasmThreadSpikeService();

    service.start();
    await drainMicrotasks();

    expect(service.snapshot()).toMatchObject({
      failureMessage: "synthetic streaming compile failure",
      runtimeStateAtFailure: {
        allocatorLock: 0,
        initializedInstanceCount: 0,
        sharedInitializationState: 0,
      },
      state: "failed",
    });
    expect(FakeWorker.instances).toHaveLength(0);
  });
});

const compiledModule = {} as WebAssembly.Module;

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
  vi.spyOn(WebAssembly, "compileStreaming").mockResolvedValue(compiledModule);
  vi.spyOn(WebAssembly, "instantiateStreaming");
  vi.spyOn(WebAssembly, "instantiate");
}

function successfulResponse(
  options: Readonly<{ contentLength?: string; contentType?: string }> = {},
): Response {
  const response = new Response(new Uint8Array(8), {
    headers: new Headers({
      "content-length": options.contentLength ?? "8",
      "content-type": options.contentType ?? "application/wasm",
    }),
  });
  vi.spyOn(response, "arrayBuffer");
  vi.spyOn(response, "clone");
  return response;
}

function failedResponse(status: number): Response {
  return new Response(null, { status });
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
