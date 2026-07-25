import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  StreamingWorkerRequest,
  StreamingWorkerResponse,
  WorldStreamingTelemetrySnapshot,
} from "../src/streaming/streaming-protocol";
import { createWorldStreamingService } from "../src/streaming/world-streaming-service";

class FakeWorker {
  static latest: FakeWorker | null = null;

  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<StreamingWorkerResponse>) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly requests: StreamingWorkerRequest[] = [];
  terminated = false;

  constructor() {
    FakeWorker.latest = this;
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
});

function requireWorker(): FakeWorker {
  if (FakeWorker.latest === null) throw new Error("Streaming worker was not constructed");
  return FakeWorker.latest;
}

function snapshot(
  service: ReturnType<typeof createWorldStreamingService>,
  state: WorldStreamingTelemetrySnapshot["state"],
): WorldStreamingTelemetrySnapshot {
  return Object.freeze({ ...service.snapshot(), state });
}

function startOptions() {
  return Object.freeze({
    buildManifestUrl: "http://127.0.0.1/build-manifest.json",
    districtId: "district-1-surface",
    initialObservers: Object.freeze([[0, 0, 0] as const]),
  });
}
