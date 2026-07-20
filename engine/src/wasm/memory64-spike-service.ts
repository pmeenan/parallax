import {
  MEMORY64_SPIKE_COLD_SAMPLE_COUNT,
  MEMORY64_SPIKE_COMPILE_BATCH_ITERATIONS,
  MEMORY64_SPIKE_INSTANTIATE_BATCH_ITERATIONS,
  MEMORY64_SPIKE_KERNEL_ROUNDS,
  MEMORY64_SPIKE_MEASURED_SAMPLE_COUNT,
  MEMORY64_SPIKE_PREPARE_ROUNDS,
  MEMORY64_SPIKE_TELEMETRY_SCHEMA_VERSION,
  MEMORY64_SPIKE_TIMEOUT_MS,
  MEMORY64_SPIKE_WARMUP_SAMPLE_COUNT,
  type Memory64SpikeTelemetrySnapshot,
  type Memory64SpikeWorkerResponse,
} from "./memory64-spike-protocol";

export type Memory64SpikeListener = (snapshot: Memory64SpikeTelemetrySnapshot) => void;

export interface Memory64SpikeService {
  dispose(): void;
  snapshot(): Memory64SpikeTelemetrySnapshot;
  start(): void;
  subscribe(listener: Memory64SpikeListener): () => void;
}

const WORKER_ARTIFACT = "./__MEMORY64_SPIKE_WORKER_ARTIFACT__";
const MEMORY32_ARTIFACT = "./__MEMORY32_SPIKE_ARTIFACT__";
const MEMORY64_ARTIFACT = "./__MEMORY64_SPIKE_ARTIFACT__";

interface DevelopmentImportMeta extends ImportMeta {
  readonly env?: { readonly DEV?: boolean };
}

export function createMemory64SpikeService(): Memory64SpikeService {
  const listeners = new Set<Memory64SpikeListener>();
  let worker: Worker | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let telemetry = freezeTelemetry({
    coldSampleCount: MEMORY64_SPIKE_COLD_SAMPLE_COUNT,
    compileBatchIterations: MEMORY64_SPIKE_COMPILE_BATCH_ITERATIONS,
    failureMessage: null,
    highAddress: null,
    instantiateBatchIterations: MEMORY64_SPIKE_INSTANTIATE_BATCH_ITERATIONS,
    kernelRounds: MEMORY64_SPIKE_KERNEL_ROUNDS,
    measuredSampleCount: MEMORY64_SPIKE_MEASURED_SAMPLE_COUNT,
    memory32: null,
    memory64: null,
    prepareRounds: MEMORY64_SPIKE_PREPARE_ROUNDS,
    schemaVersion: MEMORY64_SPIKE_TELEMETRY_SCHEMA_VERSION,
    state: "idle",
    totalElapsedMs: null,
    warmupSampleCount: MEMORY64_SPIKE_WARMUP_SAMPLE_COUNT,
  });

  const publish = (next: Memory64SpikeTelemetrySnapshot): void => {
    telemetry = freezeTelemetry(next);
    for (const listener of listeners) {
      try {
        listener(telemetry);
      } catch (error: unknown) {
        console.error("Memory64 spike telemetry listener failed", error);
      }
    }
  };
  const cleanup = (): void => {
    if (timeout !== null) clearTimeout(timeout);
    timeout = null;
    worker?.terminate();
    worker = null;
  };
  const fail = (message: string): void => {
    if (disposed || telemetry.state !== "running") return;
    cleanup();
    publish({ ...telemetry, failureMessage: message, state: "failed" });
  };
  const complete = (message: Extract<Memory64SpikeWorkerResponse, { kind: "completed" }>): void => {
    if (disposed || telemetry.state !== "running") return;
    cleanup();
    publish({
      ...telemetry,
      highAddress: message.highAddress,
      memory32: message.memory32,
      memory64: message.memory64,
      state: "completed",
      totalElapsedMs: message.totalElapsedMs,
    });
  };

  return Object.freeze({
    dispose(): void {
      disposed = true;
      cleanup();
    },
    snapshot(): Memory64SpikeTelemetrySnapshot {
      return telemetry;
    },
    start(): void {
      if (disposed || telemetry.state !== "idle") return;
      publish({ ...telemetry, state: "running" });
      try {
        worker = new Worker(workerArtifactUrl(), {
          name: "parallax-memory64-spike",
          type: "module",
        });
        worker.onmessage = (event: MessageEvent<Memory64SpikeWorkerResponse>): void => {
          if (event.data.kind === "failure") fail(event.data.failureMessage);
          else complete(event.data);
        };
        worker.onmessageerror = (): void => fail("Memory64 spike worker response was unreadable");
        worker.onerror = (event): void =>
          fail(
            event instanceof ErrorEvent && event.message !== "" ? event.message : "worker failed",
          );
        timeout = setTimeout(
          () => fail(`Memory64 spike exceeded ${MEMORY64_SPIKE_TIMEOUT_MS} ms`),
          MEMORY64_SPIKE_TIMEOUT_MS,
        );
        worker.postMessage({
          kind: "run",
          memory32Url: memory32ArtifactUrl().href,
          memory64Url: memory64ArtifactUrl().href,
          workerUrl: workerArtifactUrl().href,
        });
      } catch (error: unknown) {
        fail(`Memory64 spike failed to start: ${errorMessage(error)}`);
      }
    },
    subscribe(listener: Memory64SpikeListener): () => void {
      listeners.add(listener);
      listener(telemetry);
      return () => listeners.delete(listener);
    },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : String(error);
}

function workerArtifactUrl(): URL {
  const development = (import.meta as DevelopmentImportMeta).env?.DEV === true;
  return development
    ? new URL("../workers/memory64-spike-worker.ts", import.meta.url)
    : new URL(WORKER_ARTIFACT, import.meta.url);
}

function memory32ArtifactUrl(): URL {
  const development = (import.meta as DevelopmentImportMeta).env?.DEV === true;
  return development
    ? new URL("../../wasm/memory64-spike/pkg/memory32.wasm", import.meta.url)
    : new URL(MEMORY32_ARTIFACT, import.meta.url);
}

function memory64ArtifactUrl(): URL {
  const development = (import.meta as DevelopmentImportMeta).env?.DEV === true;
  return development
    ? new URL("../../wasm/memory64-spike/pkg/memory64.wasm", import.meta.url)
    : new URL(MEMORY64_ARTIFACT, import.meta.url);
}

function freezeTelemetry(snapshot: Memory64SpikeTelemetrySnapshot): Memory64SpikeTelemetrySnapshot {
  const freezeVariant = (variant: Memory64SpikeTelemetrySnapshot["memory32"]) =>
    variant === null
      ? null
      : Object.freeze({
          ...variant,
          samples: Object.freeze(variant.samples.map((sample) => Object.freeze({ ...sample }))),
        });
  return Object.freeze({
    ...snapshot,
    highAddress: snapshot.highAddress === null ? null : Object.freeze({ ...snapshot.highAddress }),
    memory32: freezeVariant(snapshot.memory32),
    memory64: freezeVariant(snapshot.memory64),
  });
}
