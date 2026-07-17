import {
  createOpfsReadSpikeConfig,
  type OpfsReadSpikeTelemetrySnapshot,
  type OpfsReadSpikeWorkerResponse,
} from "./opfs-read-spike-protocol";

export type OpfsReadSpikeListener = (snapshot: OpfsReadSpikeTelemetrySnapshot) => void;

export interface OpfsReadSpikeService {
  dispose(): void;
  snapshot(): OpfsReadSpikeTelemetrySnapshot;
  start(): void;
  subscribe(listener: OpfsReadSpikeListener): () => void;
}

// D-028's content-addressed worker assembly applies to every engine-owned worker.
const WORKER_ARTIFACT = "./__STORAGE_WORKER_ARTIFACT__";

interface DevelopmentImportMeta extends ImportMeta {
  readonly env?: { readonly DEV?: boolean };
}

function storageWorkerUrl(): URL {
  const development = (import.meta as DevelopmentImportMeta).env?.DEV === true;
  return development
    ? new URL("../workers/storage-worker.ts", import.meta.url)
    : new URL(WORKER_ARTIFACT, import.meta.url);
}

export function createOpfsReadSpikeService(): OpfsReadSpikeService {
  let telemetry: OpfsReadSpikeTelemetrySnapshot = freezeTelemetry({
    failureMessage: null,
    fileBytes: createOpfsReadSpikeConfig().fileBytes,
    fileReused: null,
    provisioningBytesWritten: null,
    provisioningElapsedMs: null,
    random: null,
    sequential: null,
    state: "idle",
  });
  let worker: Worker | null = null;
  const listeners = new Set<OpfsReadSpikeListener>();

  const publish = (next: OpfsReadSpikeTelemetrySnapshot): void => {
    telemetry = freezeTelemetry(next);
    for (const listener of listeners) {
      try {
        listener(telemetry);
      } catch (error: unknown) {
        console.error("OPFS spike telemetry listener failed", error);
      }
    }
  };

  const terminateWorker = (): void => {
    if (worker === null) return;
    worker.onmessage = null;
    worker.onmessageerror = null;
    worker.onerror = null;
    worker.terminate();
    worker = null;
  };

  const fail = (message: string): void => {
    if (telemetry.state !== "running") return;
    terminateWorker();
    publish({ ...telemetry, failureMessage: message, state: "failed" });
  };

  return Object.freeze({
    dispose(): void {
      if (telemetry.state === "disposed") return;
      terminateWorker();
      publish({ ...telemetry, state: "disposed" });
    },

    snapshot(): OpfsReadSpikeTelemetrySnapshot {
      return telemetry;
    },

    start(): void {
      if (telemetry.state !== "idle") {
        throw new Error("OPFS read spike service can only be started once");
      }
      publish({ ...telemetry, state: "running" });
      // A telemetry listener can dispose the service synchronously from the running
      // notification. Do not create an orphan worker after that reentrant transition.
      if (!isRunning(telemetry)) return;
      try {
        const storageWorker = new Worker(storageWorkerUrl(), {
          name: "parallax-storage",
          type: "module",
        });
        worker = storageWorker;
        storageWorker.onmessage = (event: MessageEvent<OpfsReadSpikeWorkerResponse>): void => {
          if (telemetry.state !== "running") return;
          const message = event.data;
          if (message.kind === "opfs-read-spike-failure") {
            fail(message.message);
            return;
          }
          terminateWorker();
          publish({
            failureMessage: null,
            fileBytes: message.fileBytes,
            fileReused: message.fileReused,
            provisioningBytesWritten: message.provisioningBytesWritten,
            provisioningElapsedMs: message.provisioningElapsedMs,
            random: freezePhase(message.random),
            sequential: freezePhase(message.sequential),
            state: "completed",
          });
        };
        storageWorker.onmessageerror = (): void => {
          fail("Storage worker message failed to deserialize");
        };
        storageWorker.onerror = (event): void => {
          fail(
            event instanceof ErrorEvent && event.message !== ""
              ? event.message
              : "Storage worker script failed to load",
          );
        };
        storageWorker.postMessage({ kind: "start", config: createOpfsReadSpikeConfig() });
      } catch (error: unknown) {
        fail(error instanceof Error ? error.message : String(error));
      }
    },

    subscribe(listener: OpfsReadSpikeListener): () => void {
      listeners.add(listener);
      try {
        listener(telemetry);
      } catch (error: unknown) {
        console.error("OPFS spike telemetry listener failed", error);
      }
      return () => listeners.delete(listener);
    },
  });
}

function freezeTelemetry(
  telemetry: OpfsReadSpikeTelemetrySnapshot,
): OpfsReadSpikeTelemetrySnapshot {
  return Object.freeze(telemetry);
}

function freezePhase(
  phase: NonNullable<OpfsReadSpikeTelemetrySnapshot["sequential"]>,
): NonNullable<OpfsReadSpikeTelemetrySnapshot["sequential"]> {
  return Object.freeze({
    ...phase,
    batches: Object.freeze(phase.batches.map((batch) => Object.freeze({ ...batch }))),
  });
}

function isRunning(telemetry: OpfsReadSpikeTelemetrySnapshot): boolean {
  return telemetry.state === "running";
}
