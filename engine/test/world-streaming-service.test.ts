import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  StreamingWorkerRequest,
  StreamingWorkerResponse,
  WorldStreamingTelemetrySnapshot,
} from "../src/streaming/streaming-protocol";
import { createWorldStreamingService } from "../src/streaming/world-streaming-service";

class FakeWorker {
  static instances: FakeWorker[] = [];
  static latest: FakeWorker | null = null;

  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<StreamingWorkerResponse>) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly requests: StreamingWorkerRequest[] = [];
  terminated = false;

  constructor() {
    FakeWorker.latest = this;
    FakeWorker.instances.push(this);
  }

  emit(response: StreamingWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<StreamingWorkerResponse>);
  }

  postMessage(request: StreamingWorkerRequest): void {
    this.requests.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
  FakeWorker.latest = null;
});

describe("world streaming service lifecycle", () => {
  it("rejects observer updates before initial residency is ready", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const service = createWorldStreamingService();
    const renderPort = service.start(startOptions());
    const worker = requireWorker();
    worker.emit({ kind: "telemetry", snapshot: snapshot(service, "provisioning") });

    expect(() => service.setObservers([[1, 2, 3]])).toThrow(/not running/);

    worker.emit({ kind: "telemetry", snapshot: snapshot(service, "streaming") });
    expect(() => service.setObservers([[1, 2, 3]])).not.toThrow();
    expect(worker.requests.at(-1)).toMatchObject({ kind: "observers" });
    renderPort.close();
  });

  it("rejects an in-progress disposal when the worker reports failure", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const service = createWorldStreamingService();
    const renderPort = service.start(startOptions());
    const worker = requireWorker();
    worker.emit({ kind: "telemetry", snapshot: snapshot(service, "streaming") });

    const disposal = service.dispose();
    worker.emit({
      kind: "failure",
      message: "render eviction failed",
      snapshot: {
        ...snapshot(service, "failed"),
        failureMessage: "render eviction failed",
      },
    });

    await expect(disposal).rejects.toThrow("render eviction failed");
    await expect(service.dispose()).resolves.toBeUndefined();
    renderPort.close();
  });

  it("resolves disposal only after the worker acknowledges render cleanup", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const service = createWorldStreamingService();
    const renderPort = service.start(startOptions());
    const worker = requireWorker();
    worker.emit({ kind: "telemetry", snapshot: snapshot(service, "streaming") });

    const disposal = service.dispose();
    expect(worker.requests.at(-1)).toMatchObject({ kind: "dispose" });
    worker.emit({ kind: "disposed", snapshot: snapshot(service, "disposed") });

    await expect(disposal).resolves.toBeUndefined();
    expect(worker.terminated).toBe(true);
    renderPort.close();
  });

  it("rolls back an in-flight window observer to the latest settled worker checkpoint", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const service = createWorldStreamingService();
    const firstPort = service.start(startOptions());
    const firstWorker = requireWorker();
    firstWorker.emit({ kind: "telemetry", snapshot: snapshot(service, "streaming") });
    service.setObservers([[40, 12, -24]]);
    firstWorker.emit({
      kind: "telemetry",
      snapshot: {
        ...snapshot(service, "streaming"),
        currentObservers: Object.freeze([[40, 12, -24] as const]),
        observerUpdateCount: 1,
        settledObserverUpdateCount: 0,
      },
    });

    const recovery = service.restartAfterRenderFailure();
    const secondWorker = requireWorker();

    expect(firstWorker.terminated).toBe(true);
    expect(secondWorker).not.toBe(firstWorker);
    expect(secondWorker.requests[0]).toMatchObject({
      initialObservers: [[0, 0, 0]],
      kind: "start",
      recoveryCheckpoint: {
        observers: [[0, 0, 0]],
        residentCellIds: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
      },
      renderRecoveryCount: 1,
      workerGeneration: 2,
    });
    expect(service.snapshot()).toMatchObject({
      renderRecoveryCount: 1,
      state: "starting",
      workerGeneration: 2,
    });
    firstPort.close();
    recovery.streamingPort.close();
  });

  it("restarts from a direct render-port observer reported by streaming telemetry", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const service = createWorldStreamingService();
    const firstPort = service.start(startOptions());
    const firstWorker = requireWorker();
    firstWorker.emit({ kind: "telemetry", snapshot: snapshot(service, "streaming") });
    const directCheckpoint = Object.freeze({
      flythroughObserverUpdateCount: 8,
      observerUpdateCount: 8,
      observers: Object.freeze([[384, 12, -192] as const]),
      residentCellIds: Object.freeze(["a", "b", "c", "d", "e", "f", "g", "h", "i"]),
      workerGeneration: 1,
    });
    firstWorker.emit({
      kind: "telemetry",
      snapshot: {
        ...snapshot(service, "streaming"),
        currentObservers: Object.freeze([[384, 12, -192] as const]),
        flythroughObserverUpdateCount: 8,
        observerUpdateCount: 8,
        residentCellCount: 9,
        residentCellIds: Object.freeze(["a", "b", "c", "d", "e", "f", "g", "h", "i"]),
        settledRecoveryCheckpoint: directCheckpoint,
        settledObserverUpdateCount: 8,
      },
    });

    const recovery = service.restartAfterRenderFailure(directCheckpoint);
    const secondWorker = requireWorker();

    expect(secondWorker.requests[0]).toMatchObject({
      initialObservers: [[384, 12, -192]],
      kind: "start",
      recoveryCheckpoint: directCheckpoint,
      renderRecoveryCount: 1,
      workerGeneration: 2,
    });
    firstPort.close();
    recovery.streamingPort.close();
  });

  it("acknowledges recovery only after the replacement settles the exact checkpoint", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const service = createWorldStreamingService();
    const firstPort = service.start(startOptions());
    const firstWorker = requireWorker();
    const settled = snapshot(service, "streaming");
    firstWorker.emit({ kind: "telemetry", snapshot: settled });
    const checkpoint = settled.settledRecoveryCheckpoint;
    if (checkpoint === null) throw new Error("Test checkpoint is missing");
    const recovery = service.restartAfterRenderFailure(checkpoint);
    const secondWorker = requireWorker();
    let resolved = false;
    void recovery.settled.then(() => {
      resolved = true;
    });
    secondWorker.emit({
      kind: "telemetry",
      snapshot: {
        ...snapshot(service, "streaming"),
        settledRecoveryCheckpoint: { ...checkpoint, workerGeneration: 2 },
        workerGeneration: 2,
      },
    });
    await Promise.resolve();
    expect(resolved).toBe(true);
    firstPort.close();
    recovery.streamingPort.close();
  });

  it("terminates the active replacement cohort on terminal render failure", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const service = createWorldStreamingService();
    const firstPort = service.start(startOptions());
    requireWorker().emit({ kind: "telemetry", snapshot: snapshot(service, "streaming") });
    const recovery = service.restartAfterRenderFailure();
    void recovery.settled.catch(() => undefined);
    const secondWorker = requireWorker();

    service.failAfterRenderFailure("render retry exhausted");

    expect(secondWorker.terminated).toBe(true);
    expect(service.snapshot()).toMatchObject({
      failureMessage: "render retry exhausted",
      state: "failed",
    });
    firstPort.close();
    recovery.streamingPort.close();
  });
});

function requireWorker(): FakeWorker {
  if (FakeWorker.latest === null) throw new Error("Streaming worker was not constructed");
  return FakeWorker.latest;
}

function snapshot(
  service: ReturnType<typeof createWorldStreamingService>,
  state: WorldStreamingTelemetrySnapshot["state"],
): WorldStreamingTelemetrySnapshot {
  const residentCellIds = Object.freeze(["a", "b", "c", "d", "e", "f", "g", "h", "i"]);
  return Object.freeze({
    ...service.snapshot(),
    currentObservers: Object.freeze([[0, 0, 0] as const]),
    residentCellCount: residentCellIds.length,
    residentCellIds,
    settledRecoveryCheckpoint: Object.freeze({
      flythroughObserverUpdateCount: 0,
      observerUpdateCount: 0,
      observers: Object.freeze([[0, 0, 0] as const]),
      residentCellIds,
      workerGeneration: 1,
    }),
    state,
  });
}

function startOptions() {
  return Object.freeze({
    contentSource: Object.freeze({
      buildManifestUrl: "http://127.0.0.1/build-manifest.json",
      kind: "privileged-legacy-network" as const,
    }),
    districtId: "district-1-surface",
    initialObservers: Object.freeze([[0, 0, 0] as const]),
  });
}
