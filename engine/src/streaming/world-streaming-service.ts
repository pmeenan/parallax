import type { WorldVec3 } from "../world/world-contract";
import {
  STREAMING_TELEMETRY_SCHEMA_VERSION,
  type StreamingWorkerRequest,
  type StreamingWorkerResponse,
  type WorldStreamingTelemetrySnapshot,
} from "./streaming-protocol";

const WORKER_ARTIFACT = "./__STREAMING_WORKER_ARTIFACT__";
const DISPOSAL_TIMEOUT_MS = 10_000;

interface DevelopmentImportMeta extends ImportMeta {
  readonly env?: { readonly DEV?: boolean };
}

export type WorldStreamingListener = (snapshot: WorldStreamingTelemetrySnapshot) => void;

export interface WorldStreamingStartOptions {
  readonly buildManifestUrl: string;
  readonly districtId: string;
  readonly initialObservers: readonly WorldVec3[];
}

export interface WorldStreamingService {
  dispose(): Promise<void>;
  setObservers(observers: readonly WorldVec3[]): void;
  snapshot(): WorldStreamingTelemetrySnapshot;
  start(options: WorldStreamingStartOptions): MessagePort;
  subscribe(listener: WorldStreamingListener): () => void;
}

function workerUrl(): URL {
  return (import.meta as DevelopmentImportMeta).env?.DEV === true
    ? new URL("../workers/streaming-worker.ts", import.meta.url)
    : new URL(WORKER_ARTIFACT, import.meta.url);
}

function initialSnapshot(): WorldStreamingTelemetrySnapshot {
  return Object.freeze({
    cellLoadSamples: Object.freeze([]),
    cellLoadSampleCount: 0,
    cpuBudgetRejectionCount: 0,
    decodeQueueDepthHighWater: 0,
    decodeWorkerCount: 0,
    encodedBytesRead: 0,
    failureMessage: null,
    hardwareConcurrency: 0,
    opfsProvisionedBytes: 0,
    proactiveEvictionCount: 0,
    residentCellCount: 0,
    residentEncodedBytes: 0,
    residentEncodedBytesHighWater: 0,
    residentGpuBytes: 0,
    residentGpuBytesHighWater: 0,
    schemaVersion: STREAMING_TELEMETRY_SCHEMA_VERSION,
    state: "idle",
  });
}

export function createWorldStreamingService(): WorldStreamingService {
  let telemetry = initialSnapshot();
  let worker: Worker | null = null;
  let disposal: Readonly<{
    reject: (error: Error) => void;
    resolve: () => void;
    timeout: ReturnType<typeof setTimeout>;
  }> | null = null;
  const listeners = new Set<WorldStreamingListener>();
  const publish = (snapshot: WorldStreamingTelemetrySnapshot): void => {
    telemetry = Object.freeze({
      ...snapshot,
      cellLoadSamples: Object.freeze(
        snapshot.cellLoadSamples.map((sample) => Object.freeze(sample)),
      ),
    });
    for (const listener of listeners) {
      try {
        listener(telemetry);
      } catch (error: unknown) {
        console.error("Streaming telemetry listener failed", error);
      }
    }
  };
  const rejectDisposal = (message: string): void => {
    if (disposal !== null) {
      clearTimeout(disposal.timeout);
      disposal.reject(new Error(message));
      disposal = null;
    }
  };
  const fail = (message: string): void => {
    rejectDisposal(message);
    if (telemetry.state === "failed" || telemetry.state === "disposed") return;
    worker?.terminate();
    worker = null;
    publish({ ...telemetry, failureMessage: message, state: "failed" });
  };

  return Object.freeze({
    dispose(): Promise<void> {
      if (telemetry.state === "disposed") return Promise.resolve();
      if (worker === null) return Promise.resolve();
      if (disposal !== null) throw new Error("Streaming service disposal is already in progress");
      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          fail("Streaming worker disposal timed out");
        }, DISPOSAL_TIMEOUT_MS);
        disposal = Object.freeze({ reject, resolve, timeout });
        worker?.postMessage({ kind: "dispose" } satisfies StreamingWorkerRequest);
      });
    },
    setObservers(observers: readonly WorldVec3[]): void {
      if (worker === null || telemetry.state !== "streaming") {
        throw new Error("Streaming service is not running");
      }
      worker.postMessage({ kind: "observers", observers } satisfies StreamingWorkerRequest);
    },
    snapshot(): WorldStreamingTelemetrySnapshot {
      return telemetry;
    },
    start(options: WorldStreamingStartOptions): MessagePort {
      if (telemetry.state !== "idle") throw new Error("Streaming service can only be started once");
      const channel = new MessageChannel();
      const streamingWorker = new Worker(workerUrl(), {
        name: "parallax-streaming",
        type: "module",
      });
      worker = streamingWorker;
      publish({ ...telemetry, state: "starting" });
      streamingWorker.onmessage = (event: MessageEvent<StreamingWorkerResponse>): void => {
        if (event.data.kind === "disposed") {
          streamingWorker.terminate();
          worker = null;
          publish(event.data.snapshot);
          if (disposal !== null) {
            clearTimeout(disposal.timeout);
            disposal.resolve();
            disposal = null;
          }
        } else if (event.data.kind === "failure") {
          streamingWorker.terminate();
          worker = null;
          rejectDisposal(event.data.message);
          publish(event.data.snapshot);
        } else {
          publish(event.data.snapshot);
        }
      };
      streamingWorker.onmessageerror = (): void => fail("Streaming worker response was unreadable");
      streamingWorker.onerror = (event): void =>
        fail(event.message || "Streaming worker script failed to load");
      streamingWorker.postMessage(
        {
          buildManifestUrl: options.buildManifestUrl,
          districtId: options.districtId,
          initialObservers: options.initialObservers,
          kind: "start",
          renderPort: channel.port1,
        } satisfies StreamingWorkerRequest,
        [channel.port1],
      );
      return channel.port2;
    },
    subscribe(listener: WorldStreamingListener): () => void {
      listeners.add(listener);
      listener(telemetry);
      return () => listeners.delete(listener);
    },
  });
}
