import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  SimulationStartOptions,
  SimulationTelemetrySnapshot,
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "../src/sim/simulation-protocol";
import {
  createSimulationService,
  simulationSnapshotInterpolationAlpha,
} from "../src/sim/simulation-service";
import { createSimulationSnapshotBufferWriter } from "../src/sim/simulation-snapshot-buffer";

class FakeWorker {
  static latest: FakeWorker | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<SimulationWorkerResponse>) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: SimulationWorkerRequest[] = [];
  terminated = false;
  throwOnKind: SimulationWorkerRequest["kind"] | null = null;
  private readonly messageListeners = new Set<
    (event: MessageEvent<SimulationWorkerResponse>) => void
  >();

  constructor() {
    FakeWorker.latest = this;
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent<SimulationWorkerResponse>) => void,
  ): void {
    if (type === "message") this.messageListeners.add(listener);
  }
  removeEventListener(
    type: string,
    listener: (event: MessageEvent<SimulationWorkerResponse>) => void,
  ): void {
    if (type === "message") this.messageListeners.delete(listener);
  }

  postMessage(request: SimulationWorkerRequest): void {
    if (request.kind === this.throwOnKind)
      throw new DOMException("not cloneable", "DataCloneError");
    this.posted.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(response: SimulationWorkerResponse): void {
    const event = { data: response } as MessageEvent<SimulationWorkerResponse>;
    this.onmessage?.(event);
    for (const listener of this.messageListeners) listener(event);
  }
}

afterEach(() => {
  FakeWorker.latest = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("simulation presentation service", () => {
  it("interpolates over the actual publication tick interval", () => {
    const timestepMs = 1_000 / 60;
    expect(simulationSnapshotInterpolationAlpha(10, 12, timestepMs, timestepMs)).toBeCloseTo(0.5);
    expect(simulationSnapshotInterpolationAlpha(10, 12, timestepMs * 2, timestepMs)).toBeCloseTo(1);
  });

  it("drops overwritten transform publications without losing events or telemetry", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const service = createSimulationService(() => 100);
    const options: SimulationStartOptions = Object.freeze({
      entityCapacity: 1,
      gameModuleUrl: "https://example.test/game/src/sim/m3-simulation.ts",
      seed: 1,
      snapshotCadenceTicks: 1,
      timestepHz: 60,
    });
    service.start(options);
    const worker = FakeWorker.latest;
    if (worker === null) throw new Error("Fake worker was not created");
    const start = worker.posted[0];
    if (start?.kind !== "start") throw new Error("Simulation start was not posted");
    const writer = createSimulationSnapshotBufferWriter(start.snapshotBuffer);
    const publications = [];
    for (let tick = 1; tick <= 4; tick += 1) {
      publications.push(
        writer.publish({
          entities: [{ id: 1, position: [tick, 0, 0], yawRadians: 0 }],
          stateHash: `${tick}`.repeat(64),
          tick,
        }),
      );
    }
    const events: number[] = [];
    service.subscribeEvents((batch) => events.push(...batch.map((event) => event.sequence)));
    const telemetry = (tick: number): SimulationTelemetrySnapshot =>
      Object.freeze({
        ...service.snapshot(),
        latestStateHash: `${tick}`.repeat(64),
        snapshotCount: tick,
        state: "running",
        tick,
      });
    const stale = publications[0];
    if (stale === undefined) throw new Error("Missing stale publication");
    worker.emit({
      events: [{ kind: "test", payload: new Uint8Array(), sequence: 7, tick: 1 }],
      kind: "snapshot",
      snapshot: { ...stale, stateHash: "1".repeat(64) },
      telemetry: telemetry(1),
    });
    expect(events).toEqual([7]);
    expect(service.snapshot()).toMatchObject({ failureMessage: null, state: "running", tick: 1 });
    expect(service.samplePresentation()).toBeNull();

    const current = publications[3];
    if (current === undefined) throw new Error("Missing current publication");
    worker.emit({
      events: [],
      kind: "snapshot",
      snapshot: { ...current, stateHash: "4".repeat(64) },
      telemetry: telemetry(4),
    });
    expect(service.samplePresentation()).toMatchObject({ tick: 4 });
  });

  it("terminates and fails the worker cohort when a request times out", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    const service = createSimulationService();
    service.start({
      entityCapacity: 1,
      gameModuleUrl: "https://example.test/game/src/sim/m3-simulation.ts",
      seed: 1,
      snapshotCadenceTicks: 1,
      timestepHz: 60,
    });
    const worker = FakeWorker.latest;
    if (worker === null) throw new Error("Fake worker was not created");
    worker.emit({
      kind: "telemetry",
      telemetry: Object.freeze({ ...service.snapshot(), state: "running" }),
    });
    const saving = service.save();
    const rejection = expect(saving).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
    expect(worker.terminated).toBe(true);
    expect(service.snapshot()).toMatchObject({ state: "failed" });
  });

  it("canonicalizes shared command payloads and strips non-cloneable extra properties", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const service = createSimulationService();
    service.start({
      entityCapacity: 1,
      gameModuleUrl: "https://example.test/game/src/sim/m3-simulation.ts",
      seed: 1,
      snapshotCadenceTicks: 1,
      timestepHz: 60,
    });
    const worker = FakeWorker.latest;
    if (worker === null) throw new Error("Fake worker was not created");
    worker.emit({
      kind: "telemetry",
      telemetry: Object.freeze({ ...service.snapshot(), state: "running" }),
    });
    const shared = new Uint8Array(new SharedArrayBuffer(1));
    shared[0] = 7;
    service.enqueue({
      kind: "test",
      payload: shared,
      sequence: 1,
      targetTick: 1,
      unsafeExtra: () => undefined,
    } as never);
    shared[0] = 9;
    const posted = worker.posted.at(-1);
    expect(posted?.kind).toBe("command");
    if (posted?.kind !== "command") throw new Error("Command was not posted");
    expect(posted.command.payload[0]).toBe(7);
    expect(posted.command.payload.buffer).toBeInstanceOf(ArrayBuffer);
    expect(Reflect.has(posted.command, "unsafeExtra")).toBe(false);
  });

  it("clears request bookkeeping when postMessage throws synchronously", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    const service = createSimulationService();
    service.start({
      entityCapacity: 1,
      gameModuleUrl: "https://example.test/game/src/sim/m3-simulation.ts",
      seed: 1,
      snapshotCadenceTicks: 1,
      timestepHz: 60,
    });
    const worker = FakeWorker.latest;
    if (worker === null) throw new Error("Fake worker was not created");
    worker.emit({
      kind: "telemetry",
      telemetry: Object.freeze({ ...service.snapshot(), state: "running" }),
    });
    worker.throwOnKind = "save";
    await expect(service.save()).rejects.toThrow(/not cloneable/);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(worker.terminated).toBe(false);
    expect(service.snapshot()).toMatchObject({ failureMessage: null, state: "running" });
  });

  it("rejects pending/new requests during disposal and stays disposed after acknowledgement", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    const service = createSimulationService();
    service.start({
      entityCapacity: 1,
      gameModuleUrl: "https://example.test/game/src/sim/m3-simulation.ts",
      seed: 1,
      snapshotCadenceTicks: 1,
      timestepHz: 60,
    });
    const worker = FakeWorker.latest;
    if (worker === null) throw new Error("Fake worker was not created");
    worker.emit({
      kind: "telemetry",
      telemetry: Object.freeze({ ...service.snapshot(), state: "running" }),
    });
    const pendingSave = service.save();
    const pendingRejection = expect(pendingSave).rejects.toThrow(/disposing/);
    const disposing = service.dispose();
    await pendingRejection;
    expect(() => service.save()).toThrow(/not running/);
    worker.emit({
      kind: "disposed",
      telemetry: Object.freeze({ ...service.snapshot(), state: "disposed" }),
    });
    await disposing;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(service.snapshot()).toMatchObject({ failureMessage: null, state: "disposed" });
  });

  it("publishes terminal failure when disposal itself times out", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    const service = createSimulationService();
    service.start({
      entityCapacity: 1,
      gameModuleUrl: "https://example.test/game/src/sim/m3-simulation.ts",
      seed: 1,
      snapshotCadenceTicks: 1,
      timestepHz: 60,
    });
    const worker = FakeWorker.latest;
    if (worker === null) throw new Error("Fake worker was not created");
    const disposing = service.dispose();
    const rejection = expect(disposing).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
    expect(worker.terminated).toBe(true);
    expect(service.snapshot()).toMatchObject({ state: "failed" });
  });
});
