import {
  MAXIMUM_SIMULATION_GAME_STATE_QUERY_BYTES,
  SIMULATION_TELEMETRY_SCHEMA_VERSION,
  type SimulationCommand,
  type SimulationGameStateQuery,
  type SimulationGameStateQueryResult,
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
  canonicalSimulationGameStateQuery,
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
  queryGameState(query: SimulationGameStateQuery): Promise<SimulationGameStateQueryResult>;
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
  subscribeAuthorityChanges(listener: () => void): () => void;
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
  | Readonly<{ readonly kind: "query-game-state"; readonly query: SimulationGameStateQuery }>
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
  let snapshotCadenceTicks = 0;
  let previousSnapshot: SimulationPresentationSnapshot | null = null;
  let currentSnapshot: SimulationPresentationSnapshot | null = null;
  let currentSnapshotReceivedAt = 0;
  let snapshotBuffer: SharedArrayBuffer | null = null;
  let disposal: Promise<void> | null = null;
  let loadPending = false;
  let authorityGeneration = 0;
  let commandsBlockedByLoad: SimulationCommand[] = [];
  const pending = new Map<number, PendingRequest>();
  const listeners = new Set<(snapshot: SimulationTelemetrySnapshot) => void>();
  const eventListeners = new Set<(events: readonly SimulationSemanticEvent[]) => void>();
  const authorityListeners = new Set<() => void>();

  const invalidateAuthority = (): void => {
    authorityGeneration += 1;
    for (const listener of authorityListeners) {
      try {
        listener();
      } catch (error: unknown) {
        console.error("Simulation authority-change listener failed", error);
      }
    }
  };
  const publish = (next: SimulationTelemetrySnapshot): void => {
    telemetry = Object.freeze({ ...next });
    for (const listener of listeners) listener(telemetry);
  };
  const fail = (message: string): void => {
    if (telemetry.state === "running" || telemetry.state === "starting") {
      invalidateAuthority();
    }
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
      invalidateAuthority();
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
      const canonical = canonicalSimulationCommand(command);
      // Commands posted after a load request would execute against the restored
      // timeline before the main thread receives its new sequence/tick anchors. The
      // gameplay bridge emits current physical input again once load telemetry lands.
      // Preserve commands behind the barrier so a rejected load can resume the live
      // timeline without losing input releases or other ordered commands.
      if (loadPending) {
        commandsBlockedByLoad.push(canonical);
        return;
      }
      worker.postMessage({
        command: canonical,
        kind: "command",
      } satisfies SimulationWorkerRequest);
    },
    load(bytes: Uint8Array): Promise<SimulationPresentationSnapshot> {
      if (loadPending) return Promise.reject(new Error("Simulation load is already pending"));
      const copied = new Uint8Array(bytes.byteLength);
      copied.set(bytes);
      loadPending = true;
      invalidateAuthority();
      try {
        return request<SimulationPresentationSnapshot>({ bytes: copied, kind: "load" }).then(
          (snapshot) => {
            releaseLoadBarrier(true);
            return snapshot;
          },
          (error: unknown) => {
            releaseLoadBarrier(false);
            throw error;
          },
        );
      } catch (error: unknown) {
        releaseLoadBarrier(false);
        throw error;
      }
    },
    queryGameState(query: SimulationGameStateQuery): Promise<SimulationGameStateQueryResult> {
      if (loadPending) {
        return Promise.reject(new Error("Simulation game-state query is unavailable during load"));
      }
      const queryAuthorityGeneration = authorityGeneration;
      return request<SimulationGameStateQueryResult>({
        kind: "query-game-state",
        query: canonicalSimulationGameStateQuery(query),
      }).then((result) => {
        if (queryAuthorityGeneration !== authorityGeneration) {
          throw new Error("Simulation game-state query authority changed during retrieval");
        }
        return result;
      });
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
      snapshotCadenceTicks = options.snapshotCadenceTicks;
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
            return;
          }
          if (response.kind === "game-state-query-result") {
            if (
              !(response.result.payload instanceof Uint8Array) ||
              response.result.payload.byteLength > MAXIMUM_SIMULATION_GAME_STATE_QUERY_BYTES ||
              !Number.isSafeInteger(response.result.tick) ||
              response.result.tick < 0
            ) {
              throw new Error("Simulation game-state query response is invalid");
            }
            settle(
              response.requestId,
              Object.freeze({
                payload: response.result.payload.slice(),
                tick: response.result.tick,
              }),
            );
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
    subscribeAuthorityChanges(listener: () => void): () => void {
      authorityListeners.add(listener);
      return () => authorityListeners.delete(listener);
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

  function releaseLoadBarrier(restored: boolean): void {
    loadPending = false;
    const blocked = commandsBlockedByLoad;
    commandsBlockedByLoad = [];
    if (restored || worker === null || telemetry.state !== "running") return;
    const earliestTargetTick = blocked.reduce(
      (earliest, command) => Math.min(earliest, command.targetTick),
      Number.POSITIVE_INFINITY,
    );
    // The latest published telemetry can trail the worker by at most one snapshot
    // cadence. Shift the entire batch far enough forward to preserve its relative
    // schedule while guaranteeing that every target is still in the worker's future.
    const targetTickOffset = Math.max(
      0,
      telemetry.tick + snapshotCadenceTicks + 1 - earliestTargetTick,
    );
    for (const command of blocked) {
      worker.postMessage({
        command: Object.freeze({
          ...command,
          targetTick: command.targetTick + targetTickOffset,
        }),
        kind: "command",
      } satisfies SimulationWorkerRequest);
    }
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
    gameCounters: Object.freeze({}),
    highestAcceptedCommandSequence: -1,
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
