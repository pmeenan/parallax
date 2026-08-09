import {
  type GameSimulationModule,
  SIMULATION_PROTOCOL_VERSION,
  SIMULATION_TELEMETRY_SCHEMA_VERSION,
  type SimulationSemanticEvent,
  type SimulationTelemetrySnapshot,
  type SimulationWorkerRequest,
  type SimulationWorkerResponse,
} from "../sim/simulation-protocol";
import {
  createSimulationRuntime,
  runSimulationModuleReplay,
  type SimulationRuntime,
} from "../sim/simulation-runtime";
import {
  createSimulationSnapshotBufferWriter,
  type SimulationSnapshotBufferWriter,
  simulationSnapshotBufferBytes,
} from "../sim/simulation-snapshot-buffer";

interface SimulationWorkerScope {
  close(): void;
  onmessage: ((event: MessageEvent<SimulationWorkerRequest>) => void) | null;
  postMessage(response: SimulationWorkerResponse): void;
}

const scope = globalThis as unknown as SimulationWorkerScope;
const MAXIMUM_CATCH_UP_TICKS = 5;

let gameModule: GameSimulationModule | null = null;
let runtime: SimulationRuntime | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let lastSchedulerAt = 0;
let accumulatorMs = 0;
let snapshotCadenceTicks = 1;
let tickDurationMs = 0;
let pendingEvents: SimulationSemanticEvent[] = [];
let telemetry = initialTelemetry(0);
let snapshotWriter: SimulationSnapshotBufferWriter | null = null;

scope.onmessage = (event: MessageEvent<SimulationWorkerRequest>): void => {
  void handleRequest(event.data).catch((error: unknown) => fail(error));
};

async function handleRequest(request: SimulationWorkerRequest): Promise<void> {
  if (request.kind === "start") {
    if (runtime !== null || telemetry.state !== "idle")
      throw new Error("Simulation already started");
    validateStart(request.options.timestepHz, request.options.snapshotCadenceTicks);
    if (
      request.snapshotBuffer.byteLength !==
      simulationSnapshotBufferBytes(request.options.entityCapacity)
    ) {
      throw new Error("Simulation snapshot buffer does not match its declared entity capacity");
    }
    telemetry = Object.freeze({
      ...initialTelemetry(request.workerGeneration),
      state: "starting",
      timestepHz: request.options.timestepHz,
    });
    publishTelemetry();
    const moduleUrl = validateGameModuleUrl(request.options.gameModuleUrl);
    const imported = (await import(/* @vite-ignore */ moduleUrl)) as unknown;
    gameModule = validateGameModule(imported);
    simulationWorld = request.options.world;
    const gameContext = Object.freeze({
      timestepHz: request.options.timestepHz,
      world: request.options.world,
    });
    const liveAdapter = gameModule.createGameSimulationAdapter(gameContext);
    runtime = createSimulationRuntime(
      liveAdapter,
      request.options.seed,
      request.options.timestepHz,
    );
    snapshotWriter = createSimulationSnapshotBufferWriter(request.snapshotBuffer);
    snapshotCadenceTicks = request.options.snapshotCadenceTicks;
    tickDurationMs = 1_000 / request.options.timestepHz;
    lastSchedulerAt = performance.now();
    telemetry = Object.freeze({
      ...telemetry,
      snapshotEntityCapacity: request.options.entityCapacity,
      snapshotSharedBytes: request.snapshotBuffer.byteLength,
      gameCounters: activeGameCounters(),
      highestAcceptedCommandSequence: activeRuntimeHighestAcceptedCommandSequence(),
      state: "running",
    });
    publishSnapshot();
    timer = setInterval(schedule, Math.max(1, Math.floor(tickDurationMs / 2)));
    return;
  }
  if (request.kind === "dispose") {
    stopTimer();
    telemetry = Object.freeze({ ...telemetry, state: "disposed" });
    post({ kind: "disposed", telemetry });
    scope.close();
    return;
  }
  const activeRuntime = requireRuntime();
  if (request.kind === "command") {
    const accepted = activeRuntime.enqueue(request.command);
    telemetry = Object.freeze({
      ...telemetry,
      queuedCommandCount: telemetry.queuedCommandCount + (accepted ? 1 : 0),
      highestAcceptedCommandSequence: activeRuntime.highestAcceptedCommandSequence,
      queuedCommandCountHighWater: Math.max(
        telemetry.queuedCommandCountHighWater,
        telemetry.queuedCommandCount + (accepted ? 1 : 0),
      ),
      rejectedCommandCount: telemetry.rejectedCommandCount + (accepted ? 0 : 1),
    });
    if (!accepted) publishTelemetry();
    return;
  }
  if (request.kind === "save") {
    try {
      const saved = activeRuntime.save();
      telemetry = Object.freeze({ ...telemetry, saveCount: telemetry.saveCount + 1 });
      post({ bytes: saved.saveBytes, kind: "saved", requestId: request.requestId, telemetry });
    } catch (error: unknown) {
      failRequest(request.requestId, error);
    }
    return;
  }
  if (request.kind === "load") {
    try {
      const loaded = activeRuntime.load(request.bytes);
      pendingEvents = [];
      accumulatorMs = 0;
      lastSchedulerAt = performance.now();
      telemetry = Object.freeze({
        ...telemetry,
        gameCounters: activeRuntime.gameCounters,
        highestAcceptedCommandSequence: activeRuntime.highestAcceptedCommandSequence,
        latestStateHash: loaded.presentation.stateHash,
        loadCount: telemetry.loadCount + 1,
        queuedCommandCount: activeRuntime.queuedCommandCount,
        queuedCommandCountHighWater: Math.max(
          telemetry.queuedCommandCountHighWater,
          activeRuntime.queuedCommandCount,
        ),
        snapshotCount: telemetry.snapshotCount + 1,
        tick: activeRuntime.tick,
      });
      post({
        kind: "loaded",
        requestId: request.requestId,
        snapshot: loaded.presentation,
        telemetry,
      });
    } catch (error: unknown) {
      failRequest(request.requestId, error);
    }
    return;
  }
  if (request.kind === "query-game-state") {
    try {
      post({
        kind: "game-state-query-result",
        requestId: request.requestId,
        result: Object.freeze({
          payload: activeRuntime.queryGameState(request.query),
          tick: activeRuntime.tick,
        }),
      });
    } catch (error: unknown) {
      failRequest(request.requestId, error);
    }
    return;
  }
  try {
    const activeGameModule = gameModule;
    if (activeGameModule === null) throw new Error("Simulation game module is unavailable");
    const result = runSimulationModuleReplay(
      activeGameModule,
      Object.freeze({ timestepHz: telemetry.timestepHz, world: requireWorld() }),
      request.seed,
      telemetry.timestepHz,
      request.commands,
      request.ticks,
    );
    post({ kind: "replayed", requestId: request.requestId, result });
  } catch (error: unknown) {
    failRequest(request.requestId, error);
  }
}

function schedule(): void {
  const activeRuntime = runtime;
  if (activeRuntime === null || telemetry.state !== "running") return;
  const now = performance.now();
  const elapsed = Math.max(0, now - lastSchedulerAt);
  lastSchedulerAt = now;
  accumulatorMs += elapsed;
  let steps = 0;
  while (accumulatorMs >= tickDurationMs && steps < MAXIMUM_CATCH_UP_TICKS) {
    const startedAt = performance.now();
    const result = activeRuntime.step();
    const duration = performance.now() - startedAt;
    pendingEvents.push(...result.events);
    telemetry = Object.freeze({
      ...telemetry,
      appliedCommandCount: telemetry.appliedCommandCount + result.appliedCommandCount,
      emittedEventCount: telemetry.emittedEventCount + result.events.length,
      queuedCommandCount: activeRuntime.queuedCommandCount,
      gameCounters: activeRuntime.gameCounters,
      stepDurationHighWaterMs: Math.max(telemetry.stepDurationHighWaterMs, duration),
      tick: activeRuntime.tick,
    });
    accumulatorMs -= tickDurationMs;
    steps += 1;
    if (activeRuntime.tick % snapshotCadenceTicks === 0) publishSnapshot();
  }
  if (steps === MAXIMUM_CATCH_UP_TICKS && accumulatorMs >= tickDurationMs) {
    const dropped = Math.floor(accumulatorMs / tickDurationMs);
    accumulatorMs %= tickDurationMs;
    telemetry = Object.freeze({
      ...telemetry,
      droppedCatchUpTickCount: telemetry.droppedCatchUpTickCount + dropped,
    });
  }
  telemetry = Object.freeze({
    ...telemetry,
    schedulerLagHighWaterMs: Math.max(telemetry.schedulerLagHighWaterMs, elapsed),
  });
}

function publishSnapshot(): void {
  const activeRuntime = requireRuntime();
  const presentation = activeRuntime.presentation();
  const writer = snapshotWriter;
  if (writer === null) throw new Error("Simulation snapshot writer is unavailable");
  const publication = writer.publish(presentation);
  const events = Object.freeze(pendingEvents);
  pendingEvents = [];
  telemetry = Object.freeze({
    ...telemetry,
    latestStateHash: presentation.stateHash,
    snapshotCount: telemetry.snapshotCount + 1,
    tick: activeRuntime.tick,
  });
  post({
    events,
    kind: "snapshot",
    snapshot: { ...publication, stateHash: presentation.stateHash },
    telemetry,
  });
}

function initialTelemetry(workerGeneration: number): SimulationTelemetrySnapshot {
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
    workerGeneration,
  });
}

function validateGameModule(value: unknown): GameSimulationModule {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof Reflect.get(value, "createGameSimulationAdapter") !== "function"
  ) {
    throw new Error("Game simulation module does not export createGameSimulationAdapter");
  }
  return value as GameSimulationModule;
}

function validateGameModuleUrl(value: string): string {
  const url = new URL(value);
  if (
    url.origin !== location.origin ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (!/^\/immutable\/game-simulation-[a-f0-9]{64}\.js$/u.test(url.pathname) &&
      url.pathname !== "/game/src/sim/m3-simulation.ts")
  ) {
    throw new Error("Game simulation module URL is not an admitted same-origin artifact");
  }
  return url.href;
}

function validateStart(timestepHz: number, cadence: number): void {
  if (
    SIMULATION_PROTOCOL_VERSION !== 4 ||
    !Number.isSafeInteger(timestepHz) ||
    timestepHz <= 0 ||
    !Number.isSafeInteger(cadence) ||
    cadence <= 0
  ) {
    throw new Error("Simulation start options are invalid");
  }
}

let simulationWorld: import("../sim/simulation-protocol").SimulationWorldDefinition | null = null;

function requireWorld(): import("../sim/simulation-protocol").SimulationWorldDefinition {
  if (simulationWorld === null) throw new Error("Simulation world is unavailable");
  return simulationWorld;
}

function activeGameCounters(): Readonly<Record<string, number>> {
  return runtime?.gameCounters ?? Object.freeze({});
}

function activeRuntimeHighestAcceptedCommandSequence(): number {
  return runtime?.highestAcceptedCommandSequence ?? -1;
}

function requireRuntime(): SimulationRuntime {
  if (runtime === null || telemetry.state !== "running")
    throw new Error("Simulation is not running");
  return runtime;
}

function publishTelemetry(): void {
  post({ kind: "telemetry", telemetry });
}

function failRequest(requestId: number, error: unknown): void {
  post({ kind: "failure", message: errorMessage(error), requestId, telemetry });
}

function fail(error: unknown): void {
  stopTimer();
  const message = errorMessage(error);
  telemetry = Object.freeze({ ...telemetry, failureMessage: message, state: "failed" });
  post({ kind: "failure", message, requestId: null, telemetry });
}

function stopTimer(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "Simulation worker failed";
}

function post(response: SimulationWorkerResponse): void {
  scope.postMessage(response);
}
