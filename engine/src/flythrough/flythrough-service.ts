import type {
  FlythroughCheckpointRenderEvidence,
  RenderFlythroughTelemetry,
} from "../render/render-protocol";
import type { RenderService, RenderTelemetrySnapshot } from "../render/render-service";
import type { WorldStreamingTelemetrySnapshot } from "../streaming/streaming-protocol";
import type { WorldStreamingService } from "../streaming/world-streaming-service";
import type { WorldBounds } from "../world/world-contract";
import {
  type FlythroughScenario,
  type FlythroughScenarioSample,
  type FlythroughScenarioValidation,
  sampleFlythroughScenario,
  validateFlythroughScenario,
} from "./flythrough-contract";

export const FLYTHROUGH_TELEMETRY_SCHEMA_VERSION = 4;
export const FLYTHROUGH_STABILIZATION_MS = 10_000;
const STREAMING_SETTLEMENT_TIMEOUT_MS = 15_000;

export interface FlythroughTelemetrySnapshot {
  readonly checkpointEvidence: readonly FlythroughCheckpointRenderEvidence[];
  readonly failureMessage: string | null;
  readonly preflightElapsedMs: number | null;
  readonly render: RenderFlythroughTelemetry | null;
  readonly scenarioId: string;
  readonly schemaVersion: typeof FLYTHROUGH_TELEMETRY_SCHEMA_VERSION;
  readonly state:
    | "idle"
    | "previewing"
    | "preflighting"
    | "stabilizing"
    | "prepared"
    | "running"
    | "completed"
    | "failed"
    | "aborted"
    | "disposed";
  readonly streamingAtMeasurementEnd: WorldStreamingTelemetrySnapshot | null;
  readonly streamingAtMeasurementStart: WorldStreamingTelemetrySnapshot | null;
  readonly validation: FlythroughScenarioValidation;
}

export type FlythroughListener = (snapshot: FlythroughTelemetrySnapshot) => void;

export interface ScenePreviewRequest {
  readonly observer: FlythroughScenarioSample["observer"];
  readonly headingRadians: number;
  readonly camera: FlythroughScenario["camera"];
  readonly environment: Pick<
    FlythroughScenarioSample["environment"],
    "timeOfDay" | "timeOfDayPhase" | "weather"
  >;
}

export interface FlythroughService {
  abort(reason: string): Promise<void>;
  dispose(): void;
  prepare(): void;
  previewScene(request: ScenePreviewRequest): Promise<FlythroughCheckpointRenderEvidence>;
  reset(): Promise<void>;
  snapshot(): FlythroughTelemetrySnapshot;
  start(): void;
  subscribe(listener: FlythroughListener): () => void;
}

export function createFlythroughService(
  renderService: RenderService,
  streamingService: WorldStreamingService,
  scenario: FlythroughScenario,
  worldBounds: WorldBounds,
): FlythroughService {
  const validation = validateFlythroughScenario(scenario, worldBounds);
  let telemetry: FlythroughTelemetrySnapshot = Object.freeze({
    checkpointEvidence: Object.freeze([]),
    failureMessage: null,
    preflightElapsedMs: null,
    render: null,
    scenarioId: scenario.id,
    schemaVersion: FLYTHROUGH_TELEMETRY_SCHEMA_VERSION,
    state: "idle",
    streamingAtMeasurementEnd: null,
    streamingAtMeasurementStart: null,
    validation,
  });
  let disposed = false;
  let finishing = false;
  let preparationGeneration = 0;
  let preparationAbort: AbortController | null = null;
  let runGeneration = 0;
  let resetInFlight: Promise<void> | null = null;
  let previewInFlight = false;
  const listeners = new Set<FlythroughListener>();

  const publish = (patch: Partial<FlythroughTelemetrySnapshot>): void => {
    telemetry = Object.freeze({ ...telemetry, ...patch });
    for (const listener of listeners) {
      try {
        listener(telemetry);
      } catch (error: unknown) {
        console.error("Flythrough telemetry listener failed", error);
      }
    }
  };
  const fail = (error: unknown): void => {
    if (
      disposed ||
      resetInFlight !== null ||
      telemetry.state === "idle" ||
      telemetry.state === "completed" ||
      telemetry.state === "failed" ||
      telemetry.state === "aborted"
    ) {
      return;
    }
    preparationAbort?.abort();
    preparationAbort = null;
    preparationGeneration += 1;
    runGeneration += 1;
    publish({
      failureMessage: error instanceof Error ? error.message : String(error),
      state: "failed",
    });
  };

  const unsubscribeRender = renderService.subscribe((render) => {
    if (
      (telemetry.state === "previewing" ||
        telemetry.state === "preflighting" ||
        telemetry.state === "stabilizing" ||
        telemetry.state === "prepared" ||
        telemetry.state === "running") &&
      (render.state === "recovering" || render.state === "failed")
    ) {
      fail(
        render.state === "recovering"
          ? `Render recovery invalidated flythrough ${scenario.id}`
          : (render.failureMessage ?? "Render service failed during flythrough"),
      );
      return;
    }
    if (telemetry.state !== "running" || render.flythrough === null || finishing) return;
    finishing = true;
    const generation = runGeneration;
    void finish(render, generation).catch(fail);
  });
  const unsubscribeStreaming = streamingService.subscribe((streaming) => {
    if (
      (telemetry.state === "previewing" ||
        telemetry.state === "preflighting" ||
        telemetry.state === "stabilizing" ||
        telemetry.state === "prepared" ||
        telemetry.state === "running") &&
      streaming.state === "failed"
    ) {
      fail(streaming.failureMessage ?? "Streaming service failed during flythrough");
    }
  });

  const prepare = async (): Promise<void> => {
    if (
      telemetry.state !== "idle" ||
      renderService.snapshot().state !== "ready" ||
      streamingService.snapshot().state !== "streaming"
    ) {
      throw new Error("Flythrough preflight requires idle, ready render and streaming services");
    }
    const generation = preparationGeneration + 1;
    preparationGeneration = generation;
    preparationAbort?.abort();
    const controller = new AbortController();
    preparationAbort = controller;
    const startedAt = performance.now();
    publish({ state: "preflighting" });
    const checkpointEvidence: FlythroughCheckpointRenderEvidence[] = [];
    for (const phase of scenario.environmentPhases) {
      if (disposed) return;
      const sample = sampleFlythroughScenario(
        scenario,
        phase.startMs + (phase.endMs - phase.startMs) / 2,
      );
      const expectedSettlement = streamingService.snapshot().observerUpdateCount + 1;
      streamingService.setObservers([sample.observer]);
      await waitForStreamingSettlement(streamingService, expectedSettlement, controller.signal);
      if (!preparationIsCurrent(generation, "preflighting")) return;
      await renderService.applyFlythroughPreflight(scenario.id, sample, scenario.camera);
      if (!preparationIsCurrent(generation, "preflighting")) return;
      const checkpoint = await renderService.captureFlythroughCheckpoint(phase.id);
      if (!preparationIsCurrent(generation, "preflighting")) return;
      checkpointEvidence.push(checkpoint);
      publish({ checkpointEvidence: Object.freeze([...checkpointEvidence]) });
    }
    if (!preparationIsCurrent(generation, "preflighting")) return;
    validateCheckpointEvidence(scenario, checkpointEvidence);
    const initial = sampleFlythroughScenario(scenario, 0);
    const expectedSettlement = streamingService.snapshot().observerUpdateCount + 1;
    streamingService.setObservers([initial.observer]);
    await waitForStreamingSettlement(streamingService, expectedSettlement, controller.signal);
    if (!preparationIsCurrent(generation, "preflighting")) return;
    await renderService.applyFlythroughPreflight(scenario.id, initial, scenario.camera);
    if (!preparationIsCurrent(generation, "preflighting")) return;
    publish({
      checkpointEvidence: Object.freeze(checkpointEvidence),
      preflightElapsedMs: performance.now() - startedAt,
      state: "stabilizing",
    });
    await delay(FLYTHROUGH_STABILIZATION_MS, controller.signal);
    if (preparationIsCurrent(generation, "stabilizing")) {
      preparationAbort = null;
      publish({ state: "prepared" });
    }
  };

  const preparationIsCurrent = (
    generation: number,
    expectedState: FlythroughTelemetrySnapshot["state"],
  ): boolean =>
    !disposed && preparationGeneration === generation && telemetry.state === expectedState;

  async function finish(render: RenderTelemetrySnapshot, generation: number): Promise<void> {
    const flythrough = render.flythrough;
    if (flythrough === null || telemetry.state !== "running") return;
    validateRenderCameraEvidence(scenario, flythrough);
    const streamingAtMeasurementStart = telemetry.streamingAtMeasurementStart;
    if (streamingAtMeasurementStart === null) {
      throw new Error("Flythrough completion lost its streaming start boundary");
    }
    const expectedFlythroughObserverUpdateCount =
      streamingAtMeasurementStart.flythroughObserverUpdateCount + flythrough.observerUpdateCount;
    const expectedTotalObserverUpdateCount =
      streamingAtMeasurementStart.observerUpdateCount + flythrough.observerUpdateCount;
    await waitForFlythroughStreamingSettlement(
      streamingService,
      expectedFlythroughObserverUpdateCount,
      expectedTotalObserverUpdateCount,
    );
    if (disposed || telemetry.state !== "running" || runGeneration !== generation) {
      return;
    }
    const streamingAtMeasurementEnd = streamingService.snapshot();
    if (
      streamingAtMeasurementEnd.state !== "streaming" ||
      streamingAtMeasurementEnd.flythroughObserverUpdateCount <
        expectedFlythroughObserverUpdateCount ||
      streamingAtMeasurementEnd.observerUpdateCount < expectedTotalObserverUpdateCount ||
      streamingAtMeasurementEnd.settledObserverUpdateCount < expectedTotalObserverUpdateCount
    ) {
      throw new Error("Streaming did not complete the final flythrough observer update");
    }
    publish({
      render: flythrough,
      state: "completed",
      streamingAtMeasurementEnd,
    });
  }

  return Object.freeze({
    async previewScene(request: ScenePreviewRequest): Promise<FlythroughCheckpointRenderEvidence> {
      if (
        disposed ||
        resetInFlight !== null ||
        previewInFlight ||
        !["idle", "previewing"].includes(telemetry.state) ||
        renderService.snapshot().state !== "ready" ||
        streamingService.snapshot().state !== "streaming"
      )
        throw new Error("Scene preview requires idle or settled preview ownership");
      const { observer, camera, environment } = request;
      if (
        observer.length !== 3 ||
        observer.some(
          (value, axis) =>
            !Number.isFinite(value) ||
            value < (worldBounds.minimum[axis] ?? Infinity) ||
            value > (worldBounds.maximum[axis] ?? -Infinity),
        ) ||
        !Number.isFinite(request.headingRadians) ||
        !Number.isFinite(camera.beta) ||
        camera.beta <= 0 ||
        camera.beta >= Math.PI ||
        !Number.isFinite(camera.heightMeters) ||
        camera.heightMeters <= 0 ||
        !Number.isFinite(camera.radiusMeters) ||
        camera.radiusMeters <= 0 ||
        !["clear", "overcast", "storm"].includes(environment.weather) ||
        !["dawn", "daylight", "dusk", "night"].includes(environment.timeOfDay) ||
        !Number.isFinite(environment.timeOfDayPhase) ||
        environment.timeOfDayPhase < 0 ||
        environment.timeOfDayPhase >= 1
      )
        throw new Error("Invalid scene preview state");
      const sample: FlythroughScenarioSample = Object.freeze({
        distanceMeters: 0,
        elapsedMs: 0,
        progress: 0,
        headingRadians: request.headingRadians,
        observer: Object.freeze([...observer]) as FlythroughScenarioSample["observer"],
        environment: Object.freeze({ ...environment, id: "visual-preview", startMs: 0, endMs: 1 }),
      });
      const fixedCamera = Object.freeze({ ...camera });
      const generation = ++preparationGeneration;
      const controller = new AbortController();
      preparationAbort = controller;
      previewInFlight = true;
      publish({ state: "previewing", checkpointEvidence: Object.freeze([]) });
      const requireCurrent = () => {
        if (!preparationIsCurrent(generation, "previewing"))
          throw new Error("Scene preview was cancelled");
      };
      try {
        const expectedSettlement = streamingService.snapshot().observerUpdateCount + 1;
        streamingService.setObservers([sample.observer]);
        await waitForStreamingSettlement(streamingService, expectedSettlement, controller.signal);
        requireCurrent();
        await renderService.applyFlythroughPreflight("visual-preview@1", sample, fixedCamera);
        requireCurrent();
        const evidence = await renderService.captureFlythroughCheckpoint("visual-preview");
        requireCurrent();
        publish({ checkpointEvidence: Object.freeze([evidence]) });
        return evidence;
      } catch (error: unknown) {
        if (preparationIsCurrent(generation, "previewing")) fail(error);
        throw error;
      } finally {
        previewInFlight = false;
        if (preparationGeneration === generation) preparationAbort = null;
      }
    },
    abort(reason: string): Promise<void> {
      if (
        disposed ||
        telemetry.state === "idle" ||
        telemetry.state === "completed" ||
        telemetry.state === "failed" ||
        telemetry.state === "aborted"
      ) {
        return Promise.resolve();
      }
      if (resetInFlight !== null) return resetInFlight;
      preparationGeneration += 1;
      runGeneration += 1;
      finishing = false;
      preparationAbort?.abort();
      preparationAbort = null;
      publish({ failureMessage: reason });
      const reset = renderService.resetFlythrough().then(
        () => {
          if (!disposed) publish({ state: "aborted" });
        },
        (error: unknown) => {
          const resetFailure = new Error(
            `${reason}; flythrough reset failed: ${errorMessage(error)}`,
            { cause: error },
          );
          if (!disposed) {
            publish({
              failureMessage: resetFailure.message,
              state: "failed",
            });
          }
          throw resetFailure;
        },
      );
      const inFlight = reset.finally(() => {
        if (resetInFlight === inFlight) resetInFlight = null;
      });
      resetInFlight = inFlight;
      return inFlight;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      preparationGeneration += 1;
      runGeneration += 1;
      preparationAbort?.abort();
      preparationAbort = null;
      void renderService
        .resetFlythrough()
        .catch((error: unknown) => console.error("Flythrough disposal cleanup failed", error));
      unsubscribeRender();
      unsubscribeStreaming();
      publish({ state: "disposed" });
    },

    prepare(): void {
      void prepare().catch(fail);
    },

    reset(): Promise<void> {
      if (
        telemetry.state !== "completed" &&
        telemetry.state !== "failed" &&
        telemetry.state !== "aborted"
      ) {
        throw new Error("Flythrough reset requires completed, failed, or aborted measurement");
      }
      if (resetInFlight !== null) return resetInFlight;
      const needsWorkerReset = telemetry.state !== "aborted";
      preparationGeneration += 1;
      runGeneration += 1;
      preparationAbort?.abort();
      preparationAbort = null;
      finishing = false;
      const reset = (needsWorkerReset ? renderService.resetFlythrough() : Promise.resolve()).then(
        () => {
          if (disposed) return;
          publish({
            checkpointEvidence: Object.freeze([]),
            failureMessage: null,
            preflightElapsedMs: null,
            render: null,
            state: "idle",
            streamingAtMeasurementEnd: null,
            streamingAtMeasurementStart: null,
          });
        },
      );
      const inFlight = reset.finally(() => {
        if (resetInFlight === inFlight) resetInFlight = null;
      });
      resetInFlight = inFlight;
      return inFlight;
    },

    snapshot(): FlythroughTelemetrySnapshot {
      return telemetry;
    },

    start(): void {
      if (telemetry.state !== "prepared") {
        throw new Error("Flythrough measurement requires completed preflight and stabilization");
      }
      const streamingAtMeasurementStart = streamingService.snapshot();
      if (streamingAtMeasurementStart.state !== "streaming") {
        throw new Error("Flythrough measurement requires settled streaming");
      }
      runGeneration += 1;
      finishing = false;
      publish({ state: "running", streamingAtMeasurementStart });
      try {
        renderService.startFlythrough(scenario);
      } catch (error: unknown) {
        fail(error);
      }
    },

    subscribe(listener: FlythroughListener): () => void {
      listeners.add(listener);
      try {
        listener(telemetry);
      } catch (error: unknown) {
        console.error("Flythrough telemetry listener failed", error);
      }
      return () => listeners.delete(listener);
    },
  });
}

function validateCheckpointEvidence(
  scenario: FlythroughScenario,
  evidence: readonly FlythroughCheckpointRenderEvidence[],
): void {
  if (evidence.length !== scenario.environmentPhases.length) {
    throw new Error(
      `Flythrough checkpoint count=${evidence.length}; expected ${scenario.environmentPhases.length}`,
    );
  }
  for (const [index, checkpoint] of evidence.entries()) {
    const phase = scenario.environmentPhases[index];
    if (phase === undefined) {
      throw new Error(`Flythrough checkpoint ${index} has no scenario phase`);
    }
    const label = `Flythrough checkpoint ${index} (${phase.id})`;
    if (checkpoint.checkpointId !== phase.id) {
      throw new Error(`${label} checkpointId=${checkpoint.checkpointId}`);
    }
    if (checkpoint.environmentPhaseId !== phase.id) {
      throw new Error(`${label} environmentPhaseId=${checkpoint.environmentPhaseId}`);
    }
    if (!environmentPhaseEquals(checkpoint.environment, phase)) {
      throw new Error(`${label} environment does not match the scenario phase`);
    }
    const expectedElapsedMs =
      checkpoint.environment.startMs +
      (checkpoint.environment.endMs - checkpoint.environment.startMs) / 2;
    if (checkpoint.elapsedMs !== expectedElapsedMs) {
      throw new Error(`${label} elapsedMs=${checkpoint.elapsedMs}; expected ${expectedElapsedMs}`);
    }
    if (checkpoint.previewVisibleMeshCount !== 0) {
      throw new Error(
        `${label} previewVisibleMeshCount=${checkpoint.previewVisibleMeshCount}; expected 0`,
      );
    }
    if (checkpoint.streamedVisibleMeshCount <= 0) {
      throw new Error(
        `${label} streamedVisibleMeshCount=${checkpoint.streamedVisibleMeshCount}; expected positive`,
      );
    }
    if (
      !Number.isSafeInteger(checkpoint.width) ||
      checkpoint.width <= 0 ||
      !Number.isSafeInteger(checkpoint.height) ||
      checkpoint.height <= 0 ||
      !Number.isSafeInteger(checkpoint.sampledPixelCount) ||
      checkpoint.sampledPixelCount !== checkpoint.width * checkpoint.height ||
      !Number.isSafeInteger(checkpoint.visiblePixelCount) ||
      checkpoint.visiblePixelCount <= 0 ||
      checkpoint.visiblePixelCount > checkpoint.sampledPixelCount
    ) {
      throw new Error(
        `${label} pixel counts are invalid for dimensions=${checkpoint.width}x${checkpoint.height}`,
      );
    }
    if (
      !Number.isFinite(checkpoint.clearColorDistanceThreshold) ||
      checkpoint.clearColorDistanceThreshold < 2 ||
      checkpoint.clearColorDistanceThreshold > 24
    ) {
      throw new Error(
        `${label} clearColorDistanceThreshold=${checkpoint.clearColorDistanceThreshold}; expected 2..24`,
      );
    }
    if (
      !Number.isFinite(checkpoint.visiblePixelRatio) ||
      checkpoint.visiblePixelRatio < 0.1 ||
      checkpoint.visiblePixelRatio >= 0.999 ||
      Math.abs(
        checkpoint.visiblePixelRatio - checkpoint.visiblePixelCount / checkpoint.sampledPixelCount,
      ) > Number.EPSILON
    ) {
      throw new Error(
        `${label} visiblePixelRatio=${checkpoint.visiblePixelRatio}; expected coherent 0.1..<0.999`,
      );
    }
    if (
      !finiteWorldVector(checkpoint.clearColorRgb) ||
      !finiteWorldVector(checkpoint.cameraPosition) ||
      !finiteWorldVector(checkpoint.cameraTarget)
    ) {
      throw new Error(`${label} contains a non-finite color or camera vector`);
    }
    if (!/^[0-9a-f]{64}$/.test(checkpoint.rgbaSha256)) {
      throw new Error(`${label} rgbaSha256 is invalid`);
    }
  }
  if (new Set(evidence.map((checkpoint) => checkpoint.rgbaSha256)).size !== evidence.length) {
    throw new Error("Flythrough rendered checkpoints did not produce distinct output");
  }
  const first = evidence[0];
  const last = evidence.at(-1);
  if (
    first === undefined ||
    last === undefined ||
    first.clearColorRgb.some((component, index) => component !== last.clearColorRgb[index]) ||
    Math.hypot(
      last.cameraPosition[0] - first.cameraPosition[0],
      last.cameraPosition[1] - first.cameraPosition[1],
      last.cameraPosition[2] - first.cameraPosition[2],
    ) < 100
  ) {
    throw new Error("Flythrough clear-daylight checkpoints did not prove camera traversal");
  }
}

function environmentPhaseEquals(
  actual: FlythroughCheckpointRenderEvidence["environment"],
  expected: FlythroughScenario["environmentPhases"][number] | undefined,
): boolean {
  return (
    expected !== undefined &&
    actual.id === expected.id &&
    actual.startMs === expected.startMs &&
    actual.endMs === expected.endMs &&
    actual.weather === expected.weather &&
    actual.timeOfDay === expected.timeOfDay &&
    actual.timeOfDayPhase === expected.timeOfDayPhase
  );
}

function finiteWorldVector(value: readonly number[]): boolean {
  return value.length === 3 && value.every((component) => Number.isFinite(component));
}

function validateRenderCameraEvidence(
  scenario: FlythroughScenario,
  render: RenderFlythroughTelemetry,
): void {
  const finalObserver = scenario.path.at(-1);
  if (
    finalObserver === undefined ||
    !orderedFiniteVectorBounds(render.cameraPositionMinimum, render.cameraPositionMaximum) ||
    !orderedFiniteVectorBounds(render.cameraTargetMinimum, render.cameraTargetMaximum) ||
    !finiteWorldVector(render.finalObserver) ||
    !render.finalObserver.every((component, index) => component === finalObserver[index])
  ) {
    throw new Error("Flythrough render camera bounds or final observer are invalid");
  }
}

function orderedFiniteVectorBounds(
  minimum: readonly [number, number, number],
  maximum: readonly [number, number, number],
): boolean {
  return (
    minimum.length === 3 &&
    maximum.length === 3 &&
    minimum.every((component, index) => {
      const maximumComponent = maximum[index];
      return (
        maximumComponent !== undefined &&
        Number.isFinite(component) &&
        Number.isFinite(maximumComponent) &&
        component <= maximumComponent
      );
    })
  );
}

function waitForFlythroughStreamingSettlement(
  service: WorldStreamingService,
  expectedFlythroughObserverUpdateCount: number,
  expectedTotalObserverUpdateCount: number,
): Promise<void> {
  return waitForStreaming(
    service,
    (snapshot) =>
      snapshot.flythroughObserverUpdateCount >= expectedFlythroughObserverUpdateCount &&
      snapshot.observerUpdateCount >= expectedTotalObserverUpdateCount &&
      snapshot.settledObserverUpdateCount >= expectedTotalObserverUpdateCount,
    `flythrough observer ${expectedFlythroughObserverUpdateCount} at total observer ${expectedTotalObserverUpdateCount}`,
  );
}

function waitForStreamingSettlement(
  service: WorldStreamingService,
  expectedObserverUpdateCount: number,
  signal: AbortSignal,
): Promise<void> {
  return waitForStreaming(
    service,
    (snapshot) => snapshot.settledObserverUpdateCount >= expectedObserverUpdateCount,
    `observer update ${expectedObserverUpdateCount}`,
    signal,
  );
}

function waitForStreaming(
  service: WorldStreamingService,
  isSettled: (snapshot: WorldStreamingTelemetrySnapshot) => boolean,
  label: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    let subscriptionReady = false;
    let done = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const cleanup = (): void => {
      if (timeout !== null) {
        clearTimeout(timeout);
        timeout = null;
      }
      signal?.removeEventListener("abort", abort);
      if (!subscriptionReady || unsubscribe === null) return;
      const currentUnsubscribe = unsubscribe;
      unsubscribe = null;
      currentUnsubscribe();
    };
    const finish = (complete: () => void): void => {
      if (done) return;
      done = true;
      cleanup();
      complete();
    };
    const abort = (): void => {
      finish(() => reject(new Error(`Streaming settlement ${label} was aborted`)));
    };
    if (signal?.aborted === true) {
      abort();
      return;
    }
    timeout = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            `Streaming did not settle ${label} within ${STREAMING_SETTLEMENT_TIMEOUT_MS} ms`,
          ),
        ),
      );
    }, STREAMING_SETTLEMENT_TIMEOUT_MS);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      unsubscribe = service.subscribe((snapshot) => {
        if (snapshot.state === "failed") {
          finish(() => reject(new Error(snapshot.failureMessage ?? "Streaming failed")));
          return;
        }
        if (snapshot.state === "streaming" && isSettled(snapshot)) {
          finish(resolve);
        }
      });
      subscriptionReady = true;
      if (done) cleanup();
    } catch (error: unknown) {
      finish(() => reject(error));
    }
  });
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = (): void => {
      clearTimeout(timeout);
      reject(new Error("Flythrough stabilization was aborted"));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : String(error);
}
