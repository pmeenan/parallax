import type { WorldVec3 } from "../world/world-contract";
import {
  STREAMING_TELEMETRY_SCHEMA_VERSION,
  type StreamingRecoveryCheckpoint,
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
  failAfterRenderFailure(message: string): void;
  restartAfterRenderFailure(
    checkpoint?: StreamingRecoveryCheckpoint,
  ): WorldStreamingRecoveryAttempt;
  setObservers(observers: readonly WorldVec3[]): void;
  snapshot(): WorldStreamingTelemetrySnapshot;
  start(options: WorldStreamingStartOptions): MessagePort;
  subscribe(listener: WorldStreamingListener): () => void;
}

export interface WorldStreamingRecoveryAttempt {
  readonly checkpoint: StreamingRecoveryCheckpoint;
  readonly settled: Promise<StreamingRecoveryCheckpoint>;
  readonly streamingPort: MessagePort;
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
    currentObservers: Object.freeze([]),
    decodeQueueDepthHighWater: 0,
    decodeWorkerCount: 0,
    encodedBytesRead: 0,
    failureMessage: null,
    hardwareConcurrency: 0,
    flythroughObserverUpdateCount: 0,
    observerUpdateCount: 0,
    opfsAccessHandleCount: 0,
    opfsAccessHandleOpenDurationMs: 0,
    opfsPackageCount: 0,
    opfsProvisionedBytes: 0,
    proactiveEvictionCount: 0,
    residentCellCount: 0,
    residentCellIds: Object.freeze([]),
    residentEncodedBytes: 0,
    residentEncodedBytesHighWater: 0,
    residentGpuBytes: 0,
    residentGpuBytesHighWater: 0,
    renderRecoveryCount: 0,
    schemaVersion: STREAMING_TELEMETRY_SCHEMA_VERSION,
    settledRecoveryCheckpoint: null,
    settledObserverUpdateCount: 0,
    state: "idle",
    workerGeneration: 0,
  });
}

export function createWorldStreamingService(): WorldStreamingService {
  let telemetry = initialSnapshot();
  let worker: Worker | null = null;
  let startOptions: WorldStreamingStartOptions | null = null;
  let recoverySettlement: Readonly<{
    readonly checkpoint: StreamingRecoveryCheckpoint;
    readonly reject: (error: Error) => void;
    readonly resolve: (checkpoint: StreamingRecoveryCheckpoint) => void;
  }> | null = null;
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
      currentObservers: Object.freeze(
        snapshot.currentObservers.map((observer) => Object.freeze([...observer]) as WorldVec3),
      ),
      residentCellIds: Object.freeze([...snapshot.residentCellIds]),
      settledRecoveryCheckpoint: freezeCheckpoint(snapshot.settledRecoveryCheckpoint),
    });
    const pendingRecovery = recoverySettlement;
    if (
      pendingRecovery !== null &&
      telemetry.state === "streaming" &&
      telemetry.settledRecoveryCheckpoint !== null &&
      checkpointMatchesRecoveryTarget(
        telemetry.settledRecoveryCheckpoint,
        pendingRecovery.checkpoint,
      )
    ) {
      recoverySettlement = null;
      pendingRecovery.resolve(telemetry.settledRecoveryCheckpoint);
    }
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
    recoverySettlement?.reject(new Error(message));
    recoverySettlement = null;
    publish({ ...telemetry, failureMessage: message, state: "failed" });
  };

  const launchWorker = (
    options: WorldStreamingStartOptions,
    workerGeneration: number,
    renderRecoveryCount: number,
    recoveryCheckpoint: StreamingRecoveryCheckpoint | null,
  ): MessagePort => {
    const channel = new MessageChannel();
    const streamingWorker = new Worker(workerUrl(), {
      name: "parallax-streaming",
      type: "module",
    });
    worker = streamingWorker;
    publish({
      ...initialSnapshot(),
      hardwareConcurrency: telemetry.hardwareConcurrency,
      renderRecoveryCount,
      state: "starting",
      workerGeneration,
    });
    streamingWorker.onmessage = (event: MessageEvent<StreamingWorkerResponse>): void => {
      if (worker !== streamingWorker) return;
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
        recoverySettlement?.reject(new Error(event.data.message));
        recoverySettlement = null;
        publish(event.data.snapshot);
      } else {
        publish(event.data.snapshot);
      }
    };
    streamingWorker.onmessageerror = (): void => {
      if (worker === streamingWorker) fail("Streaming worker response was unreadable");
    };
    streamingWorker.onerror = (event): void => {
      if (worker === streamingWorker)
        fail(event.message || "Streaming worker script failed to load");
    };
    streamingWorker.postMessage(
      {
        buildManifestUrl: options.buildManifestUrl,
        districtId: options.districtId,
        initialObservers: options.initialObservers,
        kind: "start",
        recoveryCheckpoint,
        renderPort: channel.port1,
        renderRecoveryCount,
        workerGeneration,
      } satisfies StreamingWorkerRequest,
      [channel.port1],
    );
    return channel.port2;
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
    failAfterRenderFailure(message: string): void {
      rejectDisposal(message);
      worker?.terminate();
      worker = null;
      recoverySettlement?.reject(new Error(message));
      recoverySettlement = null;
      if (telemetry.state !== "disposed") {
        publish({ ...telemetry, failureMessage: message, state: "failed" });
      }
    },
    restartAfterRenderFailure(
      suppliedCheckpoint?: StreamingRecoveryCheckpoint,
    ): WorldStreamingRecoveryAttempt {
      if (startOptions === null || telemetry.state === "idle" || telemetry.state === "disposed") {
        throw new Error("Streaming recovery requires a started, non-disposed service");
      }
      rejectDisposal("Streaming service was restarted during disposal");
      const checkpoint = freezeCheckpoint(
        suppliedCheckpoint ?? telemetry.settledRecoveryCheckpoint,
      );
      if (checkpoint === null) {
        throw new Error("Streaming recovery requires a worker-acknowledged settled checkpoint");
      }
      if (
        checkpoint.workerGeneration !== telemetry.workerGeneration ||
        checkpoint.observers.length === 0 ||
        checkpoint.residentCellIds.length === 0
      ) {
        throw new Error("Streaming recovery checkpoint generation or residency is invalid");
      }
      worker?.terminate();
      worker = null;
      let resolveSettlement!: (value: StreamingRecoveryCheckpoint) => void;
      let rejectSettlement!: (error: Error) => void;
      const settled = new Promise<StreamingRecoveryCheckpoint>((resolve, reject) => {
        resolveSettlement = resolve;
        rejectSettlement = reject;
      });
      recoverySettlement = Object.freeze({
        checkpoint,
        reject: rejectSettlement,
        resolve: resolveSettlement,
      });
      const streamingPort = launchWorker(
        Object.freeze({ ...startOptions, initialObservers: checkpoint.observers }),
        telemetry.workerGeneration + 1,
        telemetry.renderRecoveryCount + 1,
        checkpoint,
      );
      return Object.freeze({ checkpoint, settled, streamingPort });
    },
    setObservers(observers: readonly WorldVec3[]): void {
      if (worker === null || telemetry.state !== "streaming") {
        throw new Error("Streaming service is not running");
      }
      const frozenObservers = Object.freeze(
        observers.map((observer) => Object.freeze([...observer]) as WorldVec3),
      );
      worker.postMessage({
        kind: "observers",
        observers: frozenObservers,
      } satisfies StreamingWorkerRequest);
    },
    snapshot(): WorldStreamingTelemetrySnapshot {
      return telemetry;
    },
    start(options: WorldStreamingStartOptions): MessagePort {
      if (telemetry.state !== "idle") throw new Error("Streaming service can only be started once");
      startOptions = Object.freeze({
        ...options,
        initialObservers: Object.freeze(
          options.initialObservers.map((observer) => Object.freeze([...observer]) as WorldVec3),
        ),
      });
      return launchWorker(startOptions, 1, 0, null);
    },
    subscribe(listener: WorldStreamingListener): () => void {
      listeners.add(listener);
      listener(telemetry);
      return () => listeners.delete(listener);
    },
  });
}

function freezeCheckpoint(
  checkpoint: StreamingRecoveryCheckpoint | null,
): StreamingRecoveryCheckpoint | null {
  if (checkpoint === null) return null;
  return Object.freeze({
    ...checkpoint,
    observers: Object.freeze(
      checkpoint.observers.map((observer) => Object.freeze([...observer]) as WorldVec3),
    ),
    residentCellIds: Object.freeze([...checkpoint.residentCellIds]),
  });
}

function checkpointMatchesRecoveryTarget(
  actual: StreamingRecoveryCheckpoint,
  target: StreamingRecoveryCheckpoint,
): boolean {
  return (
    actual.observerUpdateCount === target.observerUpdateCount &&
    actual.flythroughObserverUpdateCount === target.flythroughObserverUpdateCount &&
    JSON.stringify(actual.observers) === JSON.stringify(target.observers) &&
    JSON.stringify(actual.residentCellIds) === JSON.stringify(target.residentCellIds) &&
    actual.workerGeneration === target.workerGeneration + 1
  );
}
