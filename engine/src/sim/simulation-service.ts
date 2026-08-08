import {
  SIMULATION_TELEMETRY_SCHEMA_VERSION,
  type SimulationCommand,
  type SimulationPresentationSnapshot,
  type SimulationReplayResult,
  type SimulationSemanticEvent,
  type SimulationStartOptions,
  type SimulationTelemetrySnapshot,
  type SimulationWorkerRequest,
  type SimulationWorkerResponse,
} from "./simulation-protocol";
import {
  assertSimulationReplayWorkload,
  canonicalSimulationCommand,
  interpolateSimulationSnapshots,
} from "./simulation-runtime";
import {
  createSimulationSnapshotBuffer,
  readSimulationSnapshotBuffer,
  SimulationSnapshotPublicationOverwrittenError,
} from "./simulation-snapshot-buffer";

const WORKER_ARTIFACT = "./__SIM_WORKER_ARTIFACT__";
const REQUEST_TIMEOUT_MS = 10_000;

interface DevelopmentImportMeta extends ImportMeta {
  readonly env?: { readonly DEV?: boolean };
}

export interface SimulationService {
  dispose(): Promise<void>;
  enqueue(command: SimulationCommand): void;
  load(bytes: Uint8Array): Promise<SimulationPresentationSnapshot>;
  replay(
    commands: readonly SimulationCommand[],
    ticks: number,
    seed: number,
  ): Promise<SimulationReplayResult>;
  samplePresentation(nowMs?: number): SimulationPresentationSnapshot | null;
  save(): Promise<Uint8Array>;
  snapshot(): SimulationTelemetrySnapshot;
  start(options: SimulationStartOptions): void;
  subscribe(listener: (snapshot: SimulationTelemetrySnapshot) => void): () => void;
  subscribeEvents(listener: (events: readonly SimulationSemanticEvent[]) => void): () => void;
}

interface PendingRequest {
  readonly reject: (error: Error) => void;
  readonly resolve: (value: unknown) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

type SimulationRequestInput =
  | Readonly<{ readonly bytes: Uint8Array; readonly kind: "load" }>
  | Readonly<{
      readonly commands: readonly SimulationCommand[];
      readonly kind: "replay";
      readonly seed: number;
      readonly ticks: number;
    }>
  | Readonly<{ readonly kind: "save" }>;

function workerUrl(): URL {
  return (import.meta as DevelopmentImportMeta).env?.DEV === true
    ? new URL("../workers/sim-worker.ts", import.meta.url)
    : new URL(WORKER_ARTIFACT, import.meta.url);
}

export function createSimulationService(
  now: () => number = () => performance.now(),
): SimulationService {
  let telemetry = initialTelemetry();
  let worker: Worker | null = null;
  let nextRequestId = 1;
  let timestepMs = 0;
  let previousSnapshot: SimulationPresentationSnapshot | null = null;
  let currentSnapshot: SimulationPresentationSnapshot | null = null;
  let currentSnapshotReceivedAt = 0;
  let snapshotBuffer: SharedArrayBuffer | null = null;
  let disposal: Promise<void> | null = null;
  const pending = new Map<number, PendingRequest>();
  const listeners = new Set<(snapshot: SimulationTelemetrySnapshot) => void>();
  const eventListeners = new Set<(events: readonly SimulationSemanticEvent[]) => void>();

  const publish = (next: SimulationTelemetrySnapshot): void => {
    telemetry = Object.freeze({ ...next });
    for (const listener of listeners) listener(telemetry);
  };
  const fail = (message: string): void => {
    worker?.terminate();
    worker = null;
    rejectAll(message);
    publish({ ...telemetry, failureMessage: message, state: "failed" });
  };
  const settle = (requestId: number, value: unknown, error?: string): void => {
    const request = pending.get(requestId);
    if (request === undefined) {
      fail(`Simulation worker returned unknown request ${requestId}`);
      return;
    }
    clearTimeout(request.timeout);
    pending.delete(requestId);
    if (error === undefined) request.resolve(value);
    else request.reject(new Error(error));
  };
  const request = <T>(message: SimulationRequestInput): Promise<T> => {
    const active = worker;
    if (active === null || telemetry.state !== "running") {
      throw new Error("Simulation service is not running");
    }
    const requestId = nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        fail(`Simulation request ${requestId} timed out`);
      }, REQUEST_TIMEOUT_MS);
      pending.set(requestId, {
        reject,
        resolve: (value) => resolve(value as T),
        timeout,
      });
      try {
        active.postMessage({ ...message, requestId });
      } catch (error: unknown) {
        clearTimeout(timeout);
        pending.delete(requestId);
        reject(
          error instanceof Error ? error : new Error("Simulation request could not be posted"),
        );
      }
    });
  };

  return Object.freeze({
    dispose(): Promise<void> {
      if (disposal !== null) return disposal;
      if (worker === null) return Promise.resolve();
      const active = worker;
      rejectAll("Simulation service is disposing");
      publish({ ...telemetry, state: "disposed" });
      disposal = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          active.terminate();
          worker = null;
          const message = "Simulation disposal timed out";
          publish({ ...telemetry, failureMessage: message, state: "failed" });
          reject(new Error(message));
        }, REQUEST_TIMEOUT_MS);
        const listener = (event: MessageEvent<SimulationWorkerResponse>): void => {
          if (event.data.kind !== "disposed") return;
          clearTimeout(timeout);
          active.removeEventListener("message", listener);
          active.terminate();
          worker = null;
          publish(event.data.telemetry);
          resolve();
        };
        active.addEventListener("message", listener);
        active.postMessage({ kind: "dispose" } satisfies SimulationWorkerRequest);
      });
      return disposal;
    },
    enqueue(command: SimulationCommand): void {
      if (worker === null || telemetry.state !== "running")
        throw new Error("Simulation is not running");
      worker.postMessage({
        command: canonicalSimulationCommand(command),
        kind: "command",
      } satisfies SimulationWorkerRequest);
    },
    load(bytes: Uint8Array): Promise<SimulationPresentationSnapshot> {
      const copied = new Uint8Array(bytes.byteLength);
      copied.set(bytes);
      return request({ bytes: copied, kind: "load" });
    },
    replay(
      commands: readonly SimulationCommand[],
      ticks: number,
      seed: number,
    ): Promise<SimulationReplayResult> {
      assertSimulationReplayWorkload(commands, ticks);
      return request({
        commands: commands.map(canonicalSimulationCommand),
        kind: "replay",
        seed,
        ticks,
      });
    },
    samplePresentation(sampleAt = now()): SimulationPresentationSnapshot | null {
      if (currentSnapshot === null) return null;
      if (previousSnapshot === null || timestepMs === 0) return currentSnapshot;
      return interpolateSimulationSnapshots(
        previousSnapshot,
        currentSnapshot,
        simulationSnapshotInterpolationAlpha(
          previousSnapshot.tick,
          currentSnapshot.tick,
          sampleAt - currentSnapshotReceivedAt,
          timestepMs,
        ),
      );
    },
    save(): Promise<Uint8Array> {
      return request({ kind: "save" });
    },
    snapshot(): SimulationTelemetrySnapshot {
      return telemetry;
    },
    start(options: SimulationStartOptions): void {
      if (worker !== null || telemetry.state !== "idle") {
        throw new Error("Simulation service can only be started once");
      }
      timestepMs = 1_000 / options.timestepHz;
      snapshotBuffer = createSimulationSnapshotBuffer(options.entityCapacity);
      const active = new Worker(workerUrl(), { name: "parallax-sim", type: "module" });
      worker = active;
      publish({
        ...initialTelemetry(),
        state: "starting",
        timestepHz: options.timestepHz,
        workerGeneration: 1,
      });
      active.onmessage = (event: MessageEvent<SimulationWorkerResponse>): void => {
        if (worker !== active) return;
        try {
          const response = event.data;
          if (response.kind === "failure") {
            if (response.requestId === null) fail(response.message);
            else settle(response.requestId, undefined, response.message);
            return;
          }
          if (response.kind === "snapshot") {
            const nextSnapshot = tryReadPublishedSnapshot(snapshotBuffer, response.snapshot);
            if (nextSnapshot !== null) {
              previousSnapshot = currentSnapshot;
              currentSnapshot = nextSnapshot;
              currentSnapshotReceivedAt = now();
            }
            publish(response.telemetry);
            for (const listener of eventListeners) listener(response.events);
            return;
          }
          if (response.kind === "telemetry") {
            publish(response.telemetry);
            return;
          }
          if (response.kind === "saved") {
            publish(response.telemetry);
            settle(response.requestId, response.bytes);
            return;
          }
          if (response.kind === "loaded") {
            previousSnapshot = null;
            currentSnapshot = response.snapshot;
            currentSnapshotReceivedAt = now();
            publish(response.telemetry);
            settle(response.requestId, currentSnapshot);
            return;
          }
          if (response.kind === "replayed") {
            settle(response.requestId, response.result);
          }
        } catch (error: unknown) {
          fail(error instanceof Error ? error.message : "Simulation worker response was invalid");
        }
      };
      active.onmessageerror = (): void => fail("Simulation worker response was unreadable");
      active.onerror = (event): void => fail(event.message || "Simulation worker failed to load");
      active.postMessage({
        kind: "start",
        options,
        snapshotBuffer,
        workerGeneration: 1,
      } satisfies SimulationWorkerRequest);
    },
    subscribe(listener: (snapshot: SimulationTelemetrySnapshot) => void): () => void {
      listeners.add(listener);
      listener(telemetry);
      return () => listeners.delete(listener);
    },
    subscribeEvents(listener: (events: readonly SimulationSemanticEvent[]) => void): () => void {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
  });

  function rejectAll(message: string): void {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error(message));
    }
    pending.clear();
  }
}

export function simulationSnapshotInterpolationAlpha(
  previousTick: number,
  currentTick: number,
  elapsedMs: number,
  timestepMs: number,
): number {
  const intervalTicks = Math.max(1, currentTick - previousTick);
  return elapsedMs / (intervalTicks * timestepMs);
}

function initialTelemetry(): SimulationTelemetrySnapshot {
  return Object.freeze({
    appliedCommandCount: 0,
    droppedCatchUpTickCount: 0,
    emittedEventCount: 0,
    failureMessage: null,
    latestStateHash: null,
    loadCount: 0,
    queuedCommandCount: 0,
    queuedCommandCountHighWater: 0,
    rejectedCommandCount: 0,
    saveCount: 0,
    schedulerLagHighWaterMs: 0,
    schemaVersion: SIMULATION_TELEMETRY_SCHEMA_VERSION,
    snapshotCount: 0,
    snapshotEntityCapacity: 0,
    snapshotSharedBytes: 0,
    state: "idle",
    stepDurationHighWaterMs: 0,
    tick: 0,
    timestepHz: 0,
    workerGeneration: 0,
  });
}

function tryReadPublishedSnapshot(
  buffer: SharedArrayBuffer | null,
  metadata: Readonly<{
    readonly sequence: number;
    readonly slot: number;
    readonly stateHash: string;
    readonly tick: number;
  }>,
): SimulationPresentationSnapshot | null {
  if (buffer === null) throw new Error("Simulation snapshot buffer is unavailable");
  let snapshot: SimulationPresentationSnapshot;
  try {
    snapshot = readSimulationSnapshotBuffer(buffer, metadata.stateHash, metadata);
  } catch (error: unknown) {
    if (error instanceof SimulationSnapshotPublicationOverwrittenError) return null;
    throw error;
  }
  if (snapshot.tick !== metadata.tick) {
    throw new Error("Simulation snapshot buffer publication does not match worker metadata");
  }
  return snapshot;
}
