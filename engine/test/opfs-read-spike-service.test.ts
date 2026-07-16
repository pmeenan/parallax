import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  OpfsReadPhaseTelemetry,
  OpfsReadSpikeWorkerResponse,
  OpfsReadSpikeWorkerResult,
} from "../src/storage/opfs-read-spike-protocol";
import {
  createOpfsReadSpikeService,
  type OpfsReadSpikeService,
} from "../src/storage/opfs-read-spike-service";

class FakeWorker {
  static readonly instances: FakeWorker[] = [];

  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<OpfsReadSpikeWorkerResponse>) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly posted: unknown[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }
}

class FakeErrorEvent {
  constructor(readonly message: string) {}
}

const sequential: OpfsReadPhaseTelemetry = Object.freeze({
  bytesRead: 192,
  operations: 3,
  readCallElapsedMs: 1,
  readCallThroughputBytesPerSecond: 192_000,
  validationErrors: 0,
  wallElapsedMs: 2,
  wallThroughputBytesPerSecond: 96_000,
});
const random: OpfsReadPhaseTelemetry = Object.freeze({
  ...sequential,
  bytesRead: 256,
  operations: 4,
});

function workerResult(): OpfsReadSpikeWorkerResult {
  return Object.freeze({
    fileBytes: 64,
    fileReused: false,
    kind: "opfs-read-spike-result",
    provisioningBytesWritten: 64,
    provisioningElapsedMs: 3,
    random,
    sequential,
  });
}

afterEach(() => {
  FakeWorker.instances.length = 0;
  vi.unstubAllGlobals();
});

describe("OPFS read spike service lifecycle", () => {
  it("does not create a worker after reentrant disposal from running telemetry", () => {
    const states: string[] = [];
    let service: OpfsReadSpikeService;
    service = createOpfsReadSpikeService();
    service.subscribe((snapshot) => {
      states.push(snapshot.state);
      if (snapshot.state === "running") service.dispose();
    });

    service.start();

    expect(states).toEqual(["idle", "running", "disposed"]);
    expect(service.snapshot().state).toBe("disposed");
  });

  it("maps a successful worker result only after terminating the worker", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const service = createOpfsReadSpikeService();
    service.start();
    const worker = FakeWorker.instances[0];
    if (worker === undefined) throw new Error("Service did not create its worker");
    const onmessage = worker.onmessage;
    if (onmessage === null) throw new Error("Service did not install its message handler");

    onmessage({ data: workerResult() } as MessageEvent<OpfsReadSpikeWorkerResponse>);

    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(service.snapshot()).toMatchObject({
      random,
      sequential,
      state: "completed",
    });
  });

  it("terminates and reports worker control-plane failures", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const service = createOpfsReadSpikeService();
    service.start();
    const worker = FakeWorker.instances[0];
    if (worker === undefined) throw new Error("Service did not create its worker");
    const onmessage = worker.onmessage;
    if (onmessage === null) throw new Error("Service did not install its message handler");

    onmessage({
      data: { kind: "opfs-read-spike-failure", message: "sync handle failed" },
    } as MessageEvent<OpfsReadSpikeWorkerResponse>);

    expect(worker.terminated).toBe(true);
    expect(service.snapshot()).toMatchObject({
      failureMessage: "sync handle failed",
      state: "failed",
    });
  });

  it("terminates when a worker response cannot be deserialized", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const service = createOpfsReadSpikeService();
    service.start();
    const worker = FakeWorker.instances[0];
    if (worker === undefined) throw new Error("Service did not create its worker");
    const onmessageerror = worker.onmessageerror;
    if (onmessageerror === null) throw new Error("Service did not install message-error handling");

    onmessageerror({} as MessageEvent);

    expect(worker.terminated).toBe(true);
    expect(service.snapshot()).toMatchObject({
      failureMessage: "Storage worker message failed to deserialize",
      state: "failed",
    });
  });

  it("terminates and retains a worker script error message", () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("ErrorEvent", FakeErrorEvent);
    const service = createOpfsReadSpikeService();
    service.start();
    const worker = FakeWorker.instances[0];
    if (worker === undefined) throw new Error("Service did not create its worker");
    const onerror = worker.onerror;
    if (onerror === null) throw new Error("Service did not install script-error handling");

    onerror(new FakeErrorEvent("worker script boom") as ErrorEvent);

    expect(worker.terminated).toBe(true);
    expect(service.snapshot()).toMatchObject({
      failureMessage: "worker script boom",
      state: "failed",
    });
  });
});
