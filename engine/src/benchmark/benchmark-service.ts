import { minimumObservedFlythroughRouteSpan } from "../flythrough/flythrough-contract";
import type { FlythroughService } from "../flythrough/flythrough-service";
import { FLYTHROUGH_STABILIZATION_MS } from "../flythrough/flythrough-service";
import type { RenderDistributionTelemetry } from "../render/render-protocol";
import type { RenderService } from "../render/render-service";
import { STREAMING_CELL_LOAD_BUDGET_MS } from "../streaming/streaming-protocol";
import {
  BENCHMARK_REPEAT_RELATIVE_RANGE_LIMIT,
  BENCHMARK_RESULT_CONTRACT,
  BENCHMARK_RESULT_SCHEMA_VERSION,
  BENCHMARK_TELEMETRY_SCHEMA_VERSION,
  type BenchmarkAttempt,
  type BenchmarkAttemptMetrics,
  type BenchmarkCheck,
  type BenchmarkDefinition,
  type BenchmarkEnvironmentIdentity,
  type BenchmarkFacet,
  type BenchmarkMetric,
  type BenchmarkQualityPreset,
  type BenchmarkReport,
  type BenchmarkTelemetrySnapshot,
  type BenchmarkVarianceMetric,
  invalidMetric,
  measuredMetric,
  unsupportedMetric,
} from "./benchmark-contract";
import type { BenchmarkPlatform } from "./benchmark-environment";

const PREFLIGHT_TIMEOUT_MS = 180_000;
const ROUTE_TIMEOUT_HEADROOM_MS = 20_000;
const ENVIRONMENT_COMPARISON_POLICY = Object.freeze({
  excludedRecordedFields: Object.freeze(["screen.viewportCssPixels"] as const),
  id: "fixed-worker-render-pixels@1" as const,
});
const MAIN_THREAD_LONG_TASK_LIMIT = 0;
const REQUIRED_CAPABILITIES = Object.freeze([
  "cross-origin-isolated",
  "offscreen-canvas",
  "opfs",
  "shared-array-buffer",
  "wasm-simd",
  "wasm-threads",
  "webgpu",
] as const);

export type BenchmarkListener = (snapshot: BenchmarkTelemetrySnapshot) => void;

export interface BenchmarkService {
  configure(presetId: string): void;
  dispose(): void;
  reset(): Promise<void>;
  snapshot(): BenchmarkTelemetrySnapshot;
  start(): void;
  subscribe(listener: BenchmarkListener): () => void;
}

export function createBenchmarkService(
  renderService: RenderService,
  flythroughService: FlythroughService,
  definition: BenchmarkDefinition,
  platform: BenchmarkPlatform,
): BenchmarkService {
  validateDefinition(definition);
  let disposed = false;
  let generation = 0;
  let selectedPreset = requirePreset(definition, definition.qualityPresets[0]?.id ?? "");
  let telemetry: BenchmarkTelemetrySnapshot = Object.freeze({
    activeRepeat: null,
    completedRepeats: 0,
    failureMessage: null,
    presetId: selectedPreset.id,
    progress: 0,
    report: null,
    schemaVersion: BENCHMARK_TELEMETRY_SCHEMA_VERSION,
    state: "idle",
  });
  const listeners = new Set<BenchmarkListener>();
  let activeRunAbort: AbortController | null = null;
  let resetInFlight: Promise<void> | null = null;
  let renderOwnership: Readonly<{
    readonly previousOverride: ReturnType<RenderService["snapshot"]>["renderPixelSizeOverride"];
    readonly runGeneration: number;
  }> | null = null;

  const publish = (patch: Partial<BenchmarkTelemetrySnapshot>): void => {
    telemetry = Object.freeze({ ...telemetry, ...patch });
    const published = telemetry;
    for (const listener of listeners) {
      try {
        listener(published);
      } catch (error: unknown) {
        console.error("Benchmark telemetry listener failed", error);
      }
    }
  };

  const run = async (runGeneration: number, signal: AbortSignal): Promise<void> => {
    const attempts: BenchmarkAttempt[] = [];
    const environmentCaptures: BenchmarkEnvironmentIdentity[] = [];
    let initialEnvironment: BenchmarkEnvironmentIdentity | null = null;
    let activeRepeat = 0;
    let environmentBefore: BenchmarkEnvironmentIdentity | null = null;
    let longTasks: ReturnType<BenchmarkPlatform["createLongTaskMonitor"]> | null = null;
    let mainThreadLongTasks: BenchmarkMetric<number> | null = null;
    const restoreOwnership = (): void => {
      const ownership = renderOwnership;
      if (ownership === null || ownership.runGeneration !== runGeneration) {
        if (activeRunAbort?.signal === signal) activeRunAbort = null;
        return;
      }
      renderOwnership = null;
      const renderState = renderService.snapshot().state;
      if (renderState !== "failed" && renderState !== "disposed") {
        renderService.setRenderPixelSizeOverride(ownership.previousOverride);
      }
      if (activeRunAbort?.signal === signal) activeRunAbort = null;
    };
    try {
      await resetTerminalFlythrough(flythroughService);
      requireCurrent(runGeneration, signal);
      if (flythroughService.snapshot().state !== "idle") {
        throw new Error("Benchmark requires exclusive ownership of an idle flythrough");
      }
      renderOwnership = Object.freeze({
        previousOverride: renderService.snapshot().renderPixelSizeOverride,
        runGeneration,
      });
      renderService.setRenderPixelSizeOverride(selectedPreset.renderSize);
      publish({
        activeRepeat: null,
        completedRepeats: 0,
        failureMessage: null,
        progress: 0,
        report: null,
        state: "capturing-environment",
      });
      initialEnvironment = await platform.captureEnvironment(selectedPreset);
      environmentCaptures.push(initialEnvironment);
      requireCurrent(runGeneration, signal);
      const missingCapabilities = initialEnvironment.capabilities
        .filter(
          (capability) =>
            REQUIRED_CAPABILITIES.includes(
              capability.id as (typeof REQUIRED_CAPABILITIES)[number],
            ) && capability.state === "unavailable",
        )
        .map((capability) => capability.id);
      if (missingCapabilities.length > 0) {
        const report = capabilityFailureReport(
          definition,
          selectedPreset,
          initialEnvironment,
          missingCapabilities,
          platform.generatedAt(),
        );
        restoreOwnership();
        publish({
          failureMessage: report.verdict.reasons.join(" | "),
          progress: 1,
          report,
          state: "failed",
        });
        return;
      }

      for (let repeat = 1; repeat <= definition.repeatCount; repeat += 1) {
        activeRepeat = repeat;
        requireCurrent(runGeneration, signal);
        await resetTerminalFlythrough(flythroughService);
        requireCurrent(runGeneration, signal);
        if (flythroughService.snapshot().state !== "idle") {
          throw new Error("Benchmark lost exclusive flythrough ownership between repeats");
        }
        environmentBefore =
          repeat === 1 ? initialEnvironment : await platform.captureEnvironment(selectedPreset);
        if (repeat !== 1) environmentCaptures.push(environmentBefore);
        requireCurrent(runGeneration, signal);
        publish({
          activeRepeat: repeat,
          progress: repeatProgress(repeat, 0),
          state: "preflighting",
        });
        flythroughService.prepare();
        const prepared = await waitForFlythrough(
          flythroughService,
          ["prepared", "failed", "aborted"],
          PREFLIGHT_TIMEOUT_MS,
          signal,
          (flythrough) => {
            if (!current(runGeneration)) return;
            const checkpointProgress =
              flythrough.checkpointEvidence.length /
              Math.max(1, definition.scenario.environmentPhases.length);
            publish({
              progress: repeatProgress(repeat, checkpointProgress * 0.08),
              state:
                flythrough.state === "stabilizing"
                  ? "stabilizing"
                  : flythrough.state === "preflighting"
                    ? "preflighting"
                    : telemetry.state,
            });
          },
        );
        requireCurrent(runGeneration, signal);
        if (prepared.state !== "prepared") {
          const environmentAfter = await platform.captureEnvironment(selectedPreset);
          environmentCaptures.push(environmentAfter);
          attempts.push(
            invalidAttempt(
              repeat,
              environmentBefore,
              environmentAfter,
              prepared.failureMessage ?? "Flythrough preflight failed",
              prepared,
            ),
          );
          break;
        }

        longTasks = platform.createLongTaskMonitor();
        const measurementStartedAt = performance.now();
        publish({
          progress: repeatProgress(repeat, 0.1),
          state: "running",
        });
        flythroughService.start();
        const progressTimer = setInterval(() => {
          if (!current(runGeneration) || telemetry.state !== "running") return;
          const routeProgress = Math.min(
            1,
            Math.max(
              0,
              (performance.now() - measurementStartedAt) / definition.scenario.durationMs,
            ),
          );
          publish({ progress: repeatProgress(repeat, 0.1 + routeProgress * 0.9) });
        }, 1_000);
        let completed: ReturnType<FlythroughService["snapshot"]>;
        try {
          completed = await waitForFlythrough(
            flythroughService,
            ["completed", "failed", "aborted"],
            definition.scenario.durationMs + ROUTE_TIMEOUT_HEADROOM_MS,
            signal,
          );
        } finally {
          clearInterval(progressTimer);
          const monitor = longTasks;
          longTasks = null;
          mainThreadLongTasks = finishLongTaskMonitor(monitor);
        }
        requireCurrent(runGeneration, signal);
        publish({ progress: repeatProgress(repeat, 1), state: "aggregating" });
        const environmentAfter = await platform.captureEnvironment(selectedPreset);
        environmentCaptures.push(environmentAfter);
        const attempt = assembleAttempt(
          repeat,
          definition,
          selectedPreset,
          initialEnvironment,
          environmentBefore,
          environmentAfter,
          completed,
          mainThreadLongTasks,
        );
        mainThreadLongTasks = null;
        attempts.push(attempt);
        if (attempt.state === "invalid") break;
        publish({ completedRepeats: repeat });
      }
      requireCurrent(runGeneration, signal);
      const report = assembleReport(
        definition,
        selectedPreset,
        attempts,
        environmentCaptures,
        platform.generatedAt(),
      );
      restoreOwnership();
      publishCompletedReport(report, attempts);
    } catch (error: unknown) {
      if (!current(runGeneration)) return;
      let failure = errorMessage(error);
      if (longTasks !== null) {
        const monitor = longTasks;
        longTasks = null;
        mainThreadLongTasks = finishLongTaskMonitor(monitor);
      }
      try {
        await flythroughService.abort(failure);
      } catch (abortError: unknown) {
        failure = `${failure}; flythrough abort failed: ${errorMessage(abortError)}`;
      }
      if (!current(runGeneration)) return;
      let environmentAfter: BenchmarkEnvironmentIdentity | null = null;
      try {
        environmentAfter = await platform.captureEnvironment(selectedPreset);
        requireCurrent(runGeneration, signal);
        environmentCaptures.push(environmentAfter);
      } catch {
        // The missing capture remains explicit as null in the invalid attempt.
      }
      if (!current(runGeneration) || signal.aborted) return;
      attempts.push(
        invalidAttempt(
          Math.max(1, activeRepeat),
          environmentBefore ?? initialEnvironment,
          environmentAfter,
          failure,
          flythroughService.snapshot(),
          mainThreadLongTasks ?? invalidMetric("Measurement did not complete"),
        ),
      );
      const report = assembleReport(
        definition,
        selectedPreset,
        attempts,
        environmentCaptures,
        platform.generatedAt(),
      );
      restoreOwnership();
      publishCompletedReport(report, attempts);
    } finally {
      if (longTasks !== null) finishLongTaskMonitor(longTasks);
      restoreOwnership();
    }
  };

  const current = (runGeneration: number): boolean => !disposed && generation === runGeneration;
  const requireCurrent = (runGeneration: number, signal: AbortSignal): void => {
    if (!current(runGeneration) || signal.aborted) {
      throw new Error("Benchmark run was aborted");
    }
  };

  const publishCompletedReport = (
    report: BenchmarkReport,
    attempts: readonly BenchmarkAttempt[],
  ): void => {
    publish({
      activeRepeat: null,
      completedRepeats: attempts.filter((attempt) => attempt.state === "measured").length,
      failureMessage:
        report.facets.scenarioEvidence.status === "failed"
          ? report.facets.scenarioEvidence.reasons.join(" | ")
          : null,
      progress: 1,
      report,
      state: report.facets.scenarioEvidence.status === "failed" ? "failed" : "completed",
    });
  };

  return Object.freeze({
    configure(presetId: string): void {
      if (disposed) throw new Error("Benchmark service is disposed");
      if (
        telemetry.state !== "idle" &&
        telemetry.state !== "completed" &&
        telemetry.state !== "failed"
      ) {
        throw new Error("Benchmark quality cannot change during a run");
      }
      selectedPreset = requirePreset(definition, presetId);
      publish({ presetId: selectedPreset.id });
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      activeRunAbort?.abort();
      activeRunAbort = null;
      const ownership = renderOwnership;
      if (ownership !== null) {
        renderOwnership = null;
        const renderState = renderService.snapshot().state;
        if (renderState !== "failed" && renderState !== "disposed") {
          renderService.setRenderPixelSizeOverride(ownership.previousOverride);
        }
      }
      void flythroughService
        .abort("Benchmark service was disposed")
        .catch((error: unknown) => console.error("Benchmark flythrough disposal failed", error));
      generation += 1;
      publish({ state: "disposed" });
    },

    reset(): Promise<void> {
      if (resetInFlight !== null) return resetInFlight;
      if (
        telemetry.state !== "completed" &&
        telemetry.state !== "failed" &&
        telemetry.state !== "idle"
      ) {
        throw new Error("Benchmark reset cannot interrupt an active run");
      }
      activeRunAbort?.abort();
      activeRunAbort = null;
      generation += 1;
      const resetGeneration = generation;
      publish({ state: "resetting" });
      let inFlight!: Promise<void>;
      const clearResetOwnership = (): void => {
        if (resetInFlight === inFlight) resetInFlight = null;
      };
      const reset = resetTerminalFlythrough(flythroughService).then(
        () => {
          if (disposed || generation !== resetGeneration) return;
          clearResetOwnership();
          publish({
            activeRepeat: null,
            completedRepeats: 0,
            failureMessage: null,
            progress: 0,
            report: null,
            state: "idle",
          });
        },
        (error: unknown) => {
          if (!disposed && generation === resetGeneration) {
            clearResetOwnership();
            publish({
              failureMessage: `Benchmark reset failed: ${errorMessage(error)}`,
              state: "failed",
            });
          }
          throw error;
        },
      );
      inFlight = reset.finally(clearResetOwnership);
      resetInFlight = inFlight;
      return inFlight;
    },

    snapshot(): BenchmarkTelemetrySnapshot {
      return telemetry;
    },

    start(): void {
      if (disposed) throw new Error("Benchmark service is disposed");
      if (resetInFlight !== null) throw new Error("Benchmark reset is still settling");
      if (
        telemetry.state !== "idle" &&
        telemetry.state !== "completed" &&
        telemetry.state !== "failed"
      ) {
        throw new Error("Benchmark is already running");
      }
      activeRunAbort?.abort();
      const controller = new AbortController();
      activeRunAbort = controller;
      generation += 1;
      const runGeneration = generation;
      publish({
        activeRepeat: null,
        completedRepeats: 0,
        failureMessage: null,
        progress: 0,
        report: null,
        state: "resetting",
      });
      void run(runGeneration, controller.signal);
    },

    subscribe(listener: BenchmarkListener): () => void {
      listeners.add(listener);
      try {
        listener(telemetry);
      } catch (error: unknown) {
        console.error("Benchmark telemetry listener failed", error);
      }
      return () => listeners.delete(listener);
    },
  });
}

function assembleAttempt(
  repeat: number,
  definition: BenchmarkDefinition,
  preset: BenchmarkQualityPreset,
  initialEnvironment: BenchmarkEnvironmentIdentity,
  environmentBefore: BenchmarkEnvironmentIdentity,
  environmentAfter: BenchmarkEnvironmentIdentity,
  flythrough: ReturnType<FlythroughService["snapshot"]>,
  mainThreadLongTasks: BenchmarkMetric<number>,
): BenchmarkAttempt {
  const metrics = attemptMetrics(flythrough, mainThreadLongTasks);
  const failures = validateBenchmarkFlythrough(definition, preset, flythrough);
  if (metrics.streamingCellLoadP95Ms.state !== "measured") {
    failures.push(metricReason(metrics.streamingCellLoadP95Ms));
  }
  if (
    !sameComparisonRelevantEnvironment(initialEnvironment, environmentBefore) ||
    !sameComparisonRelevantEnvironment(initialEnvironment, environmentAfter)
  ) {
    failures.push(
      "Captured comparison-relevant in-game environment identity changed across benchmark repeats",
    );
  }
  return Object.freeze({
    environmentAfter,
    environmentBefore,
    failureMessage: failures.length === 0 ? null : failures.join(" | "),
    flythrough,
    metrics,
    profileLineage: Object.freeze({
      history: Object.freeze(["continuous-page"] as const),
      id: "in-game-continuous-page" as const,
    }),
    repeat,
    state: failures.length === 0 ? "measured" : "invalid",
  });
}

function invalidAttempt(
  repeat: number,
  environmentBefore: BenchmarkEnvironmentIdentity | null,
  environmentAfter: BenchmarkEnvironmentIdentity | null,
  failureMessage: string,
  flythrough: ReturnType<FlythroughService["snapshot"]>,
  mainThreadLongTasks: BenchmarkMetric<number> = invalidMetric(
    "Measurement did not start because flythrough preflight failed",
  ),
): BenchmarkAttempt {
  return Object.freeze({
    environmentAfter,
    environmentBefore,
    failureMessage,
    flythrough,
    metrics: attemptMetrics(flythrough, mainThreadLongTasks),
    profileLineage: Object.freeze({
      history: Object.freeze(["continuous-page"] as const),
      id: "in-game-continuous-page" as const,
    }),
    repeat,
    state: "invalid",
  });
}

function validateBenchmarkFlythrough(
  definition: BenchmarkDefinition,
  preset: BenchmarkQualityPreset,
  flythrough: ReturnType<FlythroughService["snapshot"]>,
): string[] {
  const failures: string[] = [];
  const scenario = definition.scenario;
  const render = flythrough.render;
  const expectedDistance = (scenario.durationMs / 1_000) * scenario.speedMetersPerSecond;
  if (flythrough.state !== "completed" || flythrough.failureMessage !== null || render === null) {
    return [flythrough.failureMessage ?? "Flythrough did not complete"];
  }
  if (
    flythrough.scenarioId !== scenario.id ||
    flythrough.validation.scenarioId !== scenario.id ||
    flythrough.validation.durationMs !== scenario.durationMs ||
    flythrough.validation.distanceMeters !== expectedDistance ||
    !arrayEquals(
      flythrough.validation.environmentPhaseIds,
      scenario.environmentPhases.map((phase) => phase.id),
    ) ||
    JSON.stringify(render.scenario) !== JSON.stringify(scenario) ||
    render.scenarioId !== scenario.id ||
    render.completedElapsedMs !== scenario.durationMs ||
    render.completedDistanceMeters !== expectedDistance ||
    !arrayEquals(render.finalObserver, scenario.path.at(-1) ?? []) ||
    !arrayEquals(
      render.environmentPhaseOrder,
      scenario.environmentPhases.map((phase) => phase.id),
    )
  ) {
    failures.push("Render-worker route, scenario, or phase attestation is invalid");
  }
  const minimumObserverUpdates = Math.max(1, Math.floor(scenario.durationMs / 75));
  const minimumRouteSpan = minimumObservedFlythroughRouteSpan(scenario);
  if (
    render.state !== "completed" ||
    render.frameCount <= 0 ||
    render.previewVisibleFrameCount !== 0 ||
    render.streamedPresentationFrameCount !== render.frameCount ||
    render.minimumVisibleStreamingMeshCount <= 0 ||
    render.observerUpdateCount < minimumObserverUpdates ||
    !validDistribution(render.callbackIntervalMs, render.frameCount - 1) ||
    !validDistribution(render.renderDurationMs, render.frameCount) ||
    Object.values(render.environmentFrameCounts).reduce((sum, count) => sum + count, 0) !==
      render.frameCount ||
    !arrayEquals(
      Object.keys(render.environmentFrameCounts).sort(),
      scenario.environmentPhases.map((phase) => phase.id).sort(),
    ) ||
    scenario.environmentPhases.some(
      (phase) => !positiveInteger(render.environmentFrameCounts[phase.id]),
    ) ||
    !orderedFiniteBounds(render.cameraPositionMinimum, render.cameraPositionMaximum) ||
    !orderedFiniteBounds(render.cameraTargetMinimum, render.cameraTargetMaximum) ||
    !observedRouteSpanMeetsMinimum(
      render.cameraPositionMinimum,
      render.cameraPositionMaximum,
      minimumRouteSpan,
    ) ||
    !observedRouteSpanMeetsMinimum(
      render.cameraTargetMinimum,
      render.cameraTargetMaximum,
      minimumRouteSpan,
    )
  ) {
    failures.push(
      "Render-worker frame, presentation, observer, or distribution evidence is invalid",
    );
  }
  failures.push(...checkpointFailures(scenario, preset, flythrough.checkpointEvidence));
  const start = flythrough.streamingAtMeasurementStart;
  const end = flythrough.streamingAtMeasurementEnd;
  if (
    start === null ||
    end === null ||
    end.workerGeneration !== start.workerGeneration ||
    end.renderRecoveryCount !== start.renderRecoveryCount ||
    !Number.isSafeInteger(start.opfsPackageCount) ||
    start.opfsPackageCount <= 0 ||
    !Number.isSafeInteger(start.opfsAccessHandleCount) ||
    start.opfsAccessHandleCount !== start.opfsPackageCount ||
    !Number.isFinite(start.opfsAccessHandleOpenDurationMs) ||
    start.opfsAccessHandleOpenDurationMs < 0 ||
    !Number.isSafeInteger(end.opfsPackageCount) ||
    end.opfsPackageCount !== start.opfsPackageCount ||
    !Number.isSafeInteger(end.opfsAccessHandleCount) ||
    end.opfsAccessHandleCount !== end.opfsPackageCount ||
    !Number.isFinite(end.opfsAccessHandleOpenDurationMs) ||
    end.opfsAccessHandleOpenDurationMs < 0 ||
    end.opfsAccessHandleOpenDurationMs !== start.opfsAccessHandleOpenDurationMs ||
    end.flythroughObserverUpdateCount - start.flythroughObserverUpdateCount !==
      render.observerUpdateCount ||
    end.observerUpdateCount - start.observerUpdateCount !== render.observerUpdateCount ||
    end.settledObserverUpdateCount < end.observerUpdateCount ||
    !arrayEquals(end.currentObservers[0] ?? [], render.finalObserver) ||
    end.currentObservers.length !== 1
  ) {
    failures.push("Streaming boundaries do not attest exclusive canonical observer ownership");
  }
  return failures;
}

function checkpointFailures(
  scenario: BenchmarkDefinition["scenario"],
  preset: BenchmarkQualityPreset,
  checkpoints: ReturnType<FlythroughService["snapshot"]>["checkpointEvidence"],
): string[] {
  if (checkpoints.length !== scenario.environmentPhases.length) {
    return [
      `Rendered checkpoint count=${checkpoints.length}; expected ${scenario.environmentPhases.length}`,
    ];
  }
  const failures: string[] = [];
  for (const [index, checkpoint] of checkpoints.entries()) {
    const phase = scenario.environmentPhases[index];
    if (phase === undefined) {
      failures.push(`Rendered checkpoint ${index} has no scenario phase`);
      continue;
    }
    const expectedElapsedMs = phase.startMs + (phase.endMs - phase.startMs) / 2;
    if (
      checkpoint.checkpointId !== phase.id ||
      checkpoint.environmentPhaseId !== phase.id ||
      JSON.stringify(checkpoint.environment) !== JSON.stringify(phase) ||
      checkpoint.elapsedMs !== expectedElapsedMs ||
      checkpoint.width !== preset.renderSize.width ||
      checkpoint.height !== preset.renderSize.height ||
      checkpoint.sampledPixelCount !== preset.renderSize.width * preset.renderSize.height ||
      !Number.isSafeInteger(checkpoint.visiblePixelCount) ||
      checkpoint.visiblePixelCount <= 0 ||
      checkpoint.visiblePixelCount > checkpoint.sampledPixelCount ||
      checkpoint.previewVisibleMeshCount !== 0 ||
      checkpoint.streamedVisibleMeshCount <= 0 ||
      !Number.isFinite(checkpoint.visiblePixelRatio) ||
      checkpoint.visiblePixelRatio < 0.1 ||
      checkpoint.visiblePixelRatio >= 0.999 ||
      Math.abs(
        checkpoint.visiblePixelRatio - checkpoint.visiblePixelCount / checkpoint.sampledPixelCount,
      ) > Number.EPSILON ||
      checkpoint.clearColorRgb.some((component) => !Number.isFinite(component)) ||
      checkpoint.cameraPosition.some((component) => !Number.isFinite(component)) ||
      checkpoint.cameraTarget.some((component) => !Number.isFinite(component)) ||
      !Number.isFinite(checkpoint.clearColorDistanceThreshold) ||
      checkpoint.clearColorDistanceThreshold < 2 ||
      checkpoint.clearColorDistanceThreshold > 24 ||
      !/^[0-9a-f]{64}$/.test(checkpoint.rgbaSha256)
    ) {
      failures.push(
        `Rendered checkpoint ${index} (${phase.id}) is invalid for preset ${preset.id}`,
      );
    }
  }
  if (new Set(checkpoints.map((checkpoint) => checkpoint.rgbaSha256)).size !== checkpoints.length) {
    failures.push("Rendered checkpoints are not visually distinct");
  }
  return failures;
}

function attemptMetrics(
  flythrough: ReturnType<FlythroughService["snapshot"]>,
  mainThreadLongTasks: BenchmarkMetric<number>,
): BenchmarkAttemptMetrics {
  const render = flythrough.render;
  return Object.freeze({
    allRealmJsHeapHighWaterBytes: unsupportedMetric<number>(
      "Page JavaScript cannot collect synchronized used-heap high water across the window, render, streaming, and decode realms",
    ),
    attributableGpuMemoryHighWaterBytes: unsupportedMetric<number>(
      "WebGPU exposes no page-attributable resident GPU-memory high-water metric",
    ),
    dawnPipelineActivity: unsupportedMetric<number>(
      "Dawn pipeline trace and cache histograms require privileged browser diagnostics",
    ),
    mainThreadLongTasksOver50Ms: mainThreadLongTasks,
    presentationIntervalMs: unsupportedMetric<RenderDistributionTelemetry>(
      "The in-game page has no authoritative successful compositor presentation interval",
    ),
    renderWorkerCallbackIntervalMs:
      render === null
        ? invalidMetric<RenderDistributionTelemetry>(
            "Render-worker flythrough aggregate is unavailable",
          )
        : measuredMetric(render.callbackIntervalMs),
    renderWorkerRenderDurationMs:
      render === null
        ? invalidMetric<RenderDistributionTelemetry>(
            "Render-worker flythrough aggregate is unavailable",
          )
        : measuredMetric(render.renderDurationMs),
    streamingCellLoadP95Ms: streamingP95(flythrough),
    workerLongTasksOver50Ms: unsupportedMetric<number>(
      "The Long Tasks API is Window-scoped and does not expose worker event loops",
    ),
  });
}

function finishLongTaskMonitor(
  monitor: ReturnType<BenchmarkPlatform["createLongTaskMonitor"]>,
): BenchmarkMetric<number> {
  try {
    return monitor.finish();
  } catch (error: unknown) {
    return invalidMetric(`Window Long Tasks observer cleanup failed: ${errorMessage(error)}`);
  }
}

function streamingP95(
  flythrough: ReturnType<FlythroughService["snapshot"]>,
): BenchmarkMetric<number> {
  const start = flythrough.streamingAtMeasurementStart;
  const end = flythrough.streamingAtMeasurementEnd;
  if (start === null || end === null) {
    return invalidMetric("Streaming measurement boundaries are unavailable");
  }
  const sampleCount = end.cellLoadSampleCount - start.cellLoadSampleCount;
  if (
    !Number.isSafeInteger(sampleCount) ||
    sampleCount < 10 ||
    sampleCount > end.cellLoadSamples.length
  ) {
    return invalidMetric(
      `Streaming window requires at least 10 retained samples; delta=${sampleCount}, retained=${end.cellLoadSamples.length}`,
    );
  }
  const samples = end.cellLoadSamples.slice(-sampleCount);
  const firstSequence = start.cellLoadSampleCount + 1;
  if (
    samples.some(
      (sample, index) =>
        sample.sequence !== firstSequence + index ||
        !Number.isFinite(sample.totalMs) ||
        sample.totalMs < 0,
    )
  ) {
    return invalidMetric("Streaming samples are not a contiguous finite measurement suffix");
  }
  const sorted = samples.map((sample) => sample.totalMs).sort((left, right) => left - right);
  const value = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
  return value === undefined
    ? invalidMetric("Streaming p95 sample is missing")
    : measuredMetric(value);
}

function assembleReport(
  definition: BenchmarkDefinition,
  preset: BenchmarkQualityPreset,
  attempts: readonly BenchmarkAttempt[],
  environmentCaptures: readonly BenchmarkEnvironmentIdentity[],
  generatedAt: string,
): BenchmarkReport {
  const variance = Object.freeze([
    varianceMetric(
      "renderWorkerCallbackIntervalP95Ms",
      attempts,
      (attempt) => metricValue(attempt.metrics.renderWorkerCallbackIntervalMs)?.p95 ?? null,
      definition.repeatCount,
    ),
    varianceMetric(
      "renderWorkerRenderDurationP95Ms",
      attempts,
      (attempt) => metricValue(attempt.metrics.renderWorkerRenderDurationMs)?.p95 ?? null,
      definition.repeatCount,
    ),
    varianceMetric(
      "streamingCellLoadP95Ms",
      attempts,
      (attempt) => metricValue(attempt.metrics.streamingCellLoadP95Ms),
      definition.repeatCount,
    ),
  ]);
  const scenarioReasons = [
    ...(attempts.length === definition.repeatCount &&
    attempts.every((attempt) => attempt.state === "measured")
      ? []
      : [
          `completed ${attempts.filter((attempt) => attempt.state === "measured").length} of ${definition.repeatCount} repeats`,
        ]),
    ...attempts.flatMap((attempt) =>
      attempt.state === "invalid"
        ? [`repeat ${attempt.repeat}: ${attempt.failureMessage ?? "invalid"}`]
        : [],
    ),
    ...variance.flatMap((metric) =>
      metric.state === "invalid" ? [`${metric.metric}: ${metric.reason ?? "invalid"}`] : [],
    ),
  ];
  const referenceReasons = unique(
    attempts.flatMap((attempt) =>
      [attempt.environmentBefore, attempt.environmentAfter].flatMap((environment) =>
        environment === null
          ? ["Benchmark environment capture is missing"]
          : environment.referenceEligibility.state === "measured"
            ? []
            : [metricReason(environment.referenceEligibility)],
      ),
    ),
  );
  const scenarioEvidence = facet(
    scenarioReasons.length === 0 ? "passed" : "failed",
    scenarioReasons,
  );
  const referenceEligibility = facet(
    referenceReasons.length === 0 && attempts.length === definition.repeatCount
      ? "passed"
      : "not-evaluated",
    referenceReasons,
  );
  const checks = benchmarkChecks(attempts, variance);
  const blockingUnsupported = attempts.some(
    (attempt) =>
      attempt.metrics.allRealmJsHeapHighWaterBytes.state !== "measured" ||
      attempt.metrics.dawnPipelineActivity.state !== "measured" ||
      attempt.metrics.presentationIntervalMs.state !== "measured" ||
      attempt.metrics.workerLongTasksOver50Ms.state !== "measured" ||
      attempt.metrics.attributableGpuMemoryHighWaterBytes.state !== "measured",
  );
  const measuredChecks = checks.filter((check) => check.state === "measured");
  const budgetEvaluation =
    scenarioEvidence.status !== "passed" ||
    referenceEligibility.status !== "passed" ||
    blockingUnsupported ||
    measuredChecks.length === 0
      ? facet("not-evaluated", [
          ...(blockingUnsupported
            ? [
                "Standing M1 budget metrics requiring privileged or unavailable page observability are unsupported",
              ]
            : []),
          ...(referenceEligibility.status !== "passed"
            ? ["Reference-machine eligibility is not established in-game"]
            : []),
        ])
      : facet(
          measuredChecks.every((check) => check.passed === true) ? "passed" : "failed",
          measuredChecks
            .filter((check) => check.passed === false)
            .map((check) => `${check.metric} exceeded ${check.limit}`),
        );
  const firstEnvironment = environmentCaptures[0];
  const artifactDigest =
    firstEnvironment?.artifactDigest ??
    invalidMetric<string>("No benchmark attempt captured artifact identity");
  const releaseDigest =
    firstEnvironment?.releaseDigest ??
    invalidMetric<string>("No benchmark attempt captured release identity");
  const browserName = firstEnvironment?.browser.name ?? "unknown";
  const verdict =
    budgetEvaluation.status === "passed" || budgetEvaluation.status === "failed"
      ? Object.freeze({
          kind: "budget" as const,
          label: budgetEvaluation.status === "passed" ? "Budget pass" : "Budget failure",
          passed: budgetEvaluation.status === "passed",
          reasons: budgetEvaluation.reasons,
        })
      : Object.freeze({
          kind: "advisory" as const,
          label:
            scenarioEvidence.status === "passed"
              ? `${browserName} advisory result`
              : `${browserName} advisory result with invalid evidence`,
          passed: null,
          reasons: Object.freeze([
            ...referenceEligibility.reasons,
            ...budgetEvaluation.reasons,
            ...scenarioEvidence.reasons,
          ]),
        });
  return cloneAndDeepFreezeReport({
    artifactDigest,
    attempts: Object.freeze([...attempts]),
    checks,
    definitionId: definition.id,
    environmentComparisonPolicy: ENVIRONMENT_COMPARISON_POLICY,
    environmentCaptures: Object.freeze([...environmentCaptures]),
    releaseDigest,
    facets: Object.freeze({ budgetEvaluation, referenceEligibility, scenarioEvidence }),
    generatedAt,
    metricStates: metricStates(attempts),
    preset,
    provenance: Object.freeze({
      invocation: "manual-or-automation-equivalent" as const,
      launcherCollectorTimings: "not-applicable" as const,
      measurementOwner: "in-game" as const,
    }),
    repeatPolicy: Object.freeze({
      count: definition.repeatCount,
      lineage: "continuous-page" as const,
      resetBetweenRepeats: true as const,
    }),
    resultContract: BENCHMARK_RESULT_CONTRACT,
    scenario: definition.scenario.id,
    scenarioContract: definition.scenario,
    schemaVersion: BENCHMARK_RESULT_SCHEMA_VERSION,
    verdict,
    variance,
    warmupPolicy: Object.freeze({
      checkpointCount: definition.scenario.environmentPhases.length,
      kind: "streamed-checkpoint-preflight-plus-fixed-stabilization" as const,
      stabilizationMs: FLYTHROUGH_STABILIZATION_MS,
    }),
    worldSeed: definition.worldSeed,
  });
}

function capabilityFailureReport(
  definition: BenchmarkDefinition,
  preset: BenchmarkQualityPreset,
  environment: BenchmarkEnvironmentIdentity,
  missingCapabilities: readonly string[],
  generatedAt: string,
): BenchmarkReport {
  const reasons = Object.freeze(
    missingCapabilities.map((capability) => `Required capability unavailable: ${capability}`),
  );
  const notEvaluated = facet("not-evaluated", reasons);
  return cloneAndDeepFreezeReport({
    artifactDigest: environment.artifactDigest,
    attempts: Object.freeze([]),
    checks: Object.freeze([]),
    definitionId: definition.id,
    environmentComparisonPolicy: ENVIRONMENT_COMPARISON_POLICY,
    environmentCaptures: Object.freeze([environment]),
    releaseDigest: environment.releaseDigest,
    facets: Object.freeze({
      budgetEvaluation: notEvaluated,
      referenceEligibility: notEvaluated,
      scenarioEvidence: facet("failed", reasons),
    }),
    generatedAt,
    metricStates: metricStates([]),
    preset,
    provenance: Object.freeze({
      invocation: "manual-or-automation-equivalent" as const,
      launcherCollectorTimings: "not-applicable" as const,
      measurementOwner: "in-game" as const,
    }),
    repeatPolicy: Object.freeze({
      count: definition.repeatCount,
      lineage: "continuous-page" as const,
      resetBetweenRepeats: true as const,
    }),
    resultContract: BENCHMARK_RESULT_CONTRACT,
    scenario: definition.scenario.id,
    scenarioContract: definition.scenario,
    schemaVersion: BENCHMARK_RESULT_SCHEMA_VERSION,
    verdict: Object.freeze({
      kind: "capability-failure" as const,
      label: "Capability failure",
      passed: false,
      reasons,
    }),
    variance: Object.freeze([]),
    warmupPolicy: Object.freeze({
      checkpointCount: definition.scenario.environmentPhases.length,
      kind: "streamed-checkpoint-preflight-plus-fixed-stabilization" as const,
      stabilizationMs: FLYTHROUGH_STABILIZATION_MS,
    }),
    worldSeed: definition.worldSeed,
  });
}

function cloneAndDeepFreezeReport(report: BenchmarkReport): BenchmarkReport {
  return deepFreeze(structuredClone(report));
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}

function benchmarkChecks(
  attempts: readonly BenchmarkAttempt[],
  variance: readonly BenchmarkVarianceMetric[],
): readonly BenchmarkCheck[] {
  const checks: BenchmarkCheck[] = [];
  for (const attempt of attempts) {
    checks.push(
      metricCheck(
        `repeat ${attempt.repeat} streamingCellLoadP95Ms`,
        attempt.metrics.streamingCellLoadP95Ms,
        STREAMING_CELL_LOAD_BUDGET_MS,
      ),
      metricCheck(
        `repeat ${attempt.repeat} mainThreadLongTasksOver50Ms`,
        attempt.metrics.mainThreadLongTasksOver50Ms,
        MAIN_THREAD_LONG_TASK_LIMIT,
      ),
    );
  }
  for (const metric of variance) {
    checks.push(
      Object.freeze({
        actual: metric.relativeRange,
        limit: BENCHMARK_REPEAT_RELATIVE_RANGE_LIMIT,
        metric: `${metric.metric} relative range`,
        passed:
          metric.state === "measured" && metric.relativeRange !== null
            ? metric.relativeRange <= BENCHMARK_REPEAT_RELATIVE_RANGE_LIMIT
            : null,
        state: metric.state,
      }),
    );
  }
  return Object.freeze(checks);
}

function metricCheck(name: string, metric: BenchmarkMetric<number>, limit: number): BenchmarkCheck {
  return metric.state === "measured"
    ? Object.freeze({
        actual: metric.value,
        limit,
        metric: name,
        passed: metric.value <= limit,
        state: "measured" as const,
      })
    : Object.freeze({
        actual: null,
        limit,
        metric: name,
        passed: null,
        state: metric.state === "unsupported" ? ("unsupported" as const) : ("invalid" as const),
      });
}

function varianceMetric(
  metric: BenchmarkVarianceMetric["metric"],
  attempts: readonly BenchmarkAttempt[],
  read: (attempt: BenchmarkAttempt) => number | null,
  expectedCount: number,
): BenchmarkVarianceMetric {
  const values = attempts.flatMap((attempt) => {
    const value = read(attempt);
    return attempt.state === "measured" && value !== null ? [value] : [];
  });
  if (values.length !== expectedCount) {
    return Object.freeze({
      metric,
      reason: `variance requires ${expectedCount} measured repeats; received ${values.length}`,
      relativeRange: null,
      state: "invalid",
      values: Object.freeze(values),
    });
  }
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const relativeRange = minimum === 0 ? (maximum === 0 ? 0 : null) : (maximum - minimum) / minimum;
  if (relativeRange === null || relativeRange > BENCHMARK_REPEAT_RELATIVE_RANGE_LIMIT) {
    return Object.freeze({
      metric,
      reason:
        relativeRange === null
          ? "relative range is unbounded because the minimum is zero"
          : `relative range ${relativeRange} exceeds ${BENCHMARK_REPEAT_RELATIVE_RANGE_LIMIT}`,
      relativeRange,
      state: "invalid",
      values: Object.freeze(values),
    });
  }
  return Object.freeze({
    metric,
    reason: null,
    relativeRange,
    state: "measured",
    values: Object.freeze(values),
  });
}

function metricStates(attempts: readonly BenchmarkAttempt[]): BenchmarkReport["metricStates"] {
  const state = <K extends keyof BenchmarkAttemptMetrics>(
    key: K,
    fallback: "invalid" | "unsupported",
  ): "invalid" | "measured" | "unsupported" => {
    if (attempts.length === 0) return fallback;
    const states = attempts.map((attempt) => attempt.metrics[key].state);
    if (states.every((value) => value === "measured")) return "measured";
    return states.some((value) => value === "invalid") ? "invalid" : "unsupported";
  };
  return Object.freeze({
    allRealmJsHeap: "unsupported",
    attributableGpuMemory: "unsupported",
    dawnPipelineActivity: "unsupported",
    mainThreadLongTasks: state("mainThreadLongTasksOver50Ms", "unsupported"),
    presentationIntervals: "unsupported",
    renderWorkerCallbackIntervals:
      state("renderWorkerCallbackIntervalMs", "invalid") === "measured" ? "measured" : "invalid",
    renderWorkerDurations:
      state("renderWorkerRenderDurationMs", "invalid") === "measured" ? "measured" : "invalid",
    streamingCellLoads:
      state("streamingCellLoadP95Ms", "invalid") === "measured" ? "measured" : "invalid",
    workerLongTasks: "unsupported",
  });
}

function facet(status: BenchmarkFacet["status"], reasons: readonly string[]): BenchmarkFacet {
  return Object.freeze({ reasons: Object.freeze(unique(reasons)), status });
}

function sameComparisonRelevantEnvironment(
  before: BenchmarkEnvironmentIdentity,
  after: BenchmarkEnvironmentIdentity,
): boolean {
  return (
    JSON.stringify(comparisonRelevantEnvironment(before)) ===
    JSON.stringify(comparisonRelevantEnvironment(after))
  );
}

function comparisonRelevantEnvironment(environment: BenchmarkEnvironmentIdentity): Readonly<{
  readonly artifactDigest: BenchmarkEnvironmentIdentity["artifactDigest"];
  readonly browser: BenchmarkEnvironmentIdentity["browser"];
  readonly capabilities: BenchmarkEnvironmentIdentity["capabilities"];
  readonly gpuAdapter: BenchmarkEnvironmentIdentity["gpuAdapter"];
  readonly hardwareConcurrency: BenchmarkEnvironmentIdentity["hardwareConcurrency"];
  readonly hostIdentity: BenchmarkEnvironmentIdentity["hostIdentity"];
  readonly powerAndSessionState: BenchmarkEnvironmentIdentity["powerAndSessionState"];
  readonly referenceEligibility: BenchmarkEnvironmentIdentity["referenceEligibility"];
  readonly releaseDigest: BenchmarkEnvironmentIdentity["releaseDigest"];
  readonly screen: Omit<BenchmarkEnvironmentIdentity["screen"], "viewportCssPixels">;
}> {
  const { viewportCssPixels: _recordedDiagnostic, ...comparisonRelevantScreen } =
    environment.screen;
  return Object.freeze({
    artifactDigest: environment.artifactDigest,
    browser: environment.browser,
    capabilities: environment.capabilities,
    gpuAdapter: environment.gpuAdapter,
    hardwareConcurrency: environment.hardwareConcurrency,
    hostIdentity: environment.hostIdentity,
    powerAndSessionState: environment.powerAndSessionState,
    referenceEligibility: environment.referenceEligibility,
    releaseDigest: environment.releaseDigest,
    screen: Object.freeze(comparisonRelevantScreen),
  });
}

function resetTerminalFlythrough(service: FlythroughService): Promise<void> {
  const state = service.snapshot().state;
  return state === "completed" || state === "failed" || state === "aborted"
    ? service.reset()
    : Promise.resolve();
}

function validDistribution(
  value: RenderDistributionTelemetry,
  expectedSampleCount: number,
): boolean {
  return (
    value.sampleCount === expectedSampleCount &&
    [value.p50, value.p95, value.p999, value.maximum].every(
      (sample) => Number.isFinite(sample) && sample >= 0,
    ) &&
    value.p50 <= value.p95 &&
    value.p95 <= value.p999 &&
    value.p999 <= value.maximum
  );
}

function arrayEquals(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function orderedFiniteBounds(
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

function observedRouteSpanMeetsMinimum(
  minimum: readonly [number, number, number],
  maximum: readonly [number, number, number],
  expected: readonly [number, number, number],
): boolean {
  return expected.every((minimumSpan, axis) => {
    const maximumValue = maximum[axis];
    const minimumValue = minimum[axis];
    return (
      maximumValue !== undefined &&
      minimumValue !== undefined &&
      maximumValue - minimumValue >= minimumSpan
    );
  });
}

function metricValue<T>(metric: BenchmarkMetric<T>): T | null {
  return metric.state === "measured" ? metric.value : null;
}

function metricReason(metric: BenchmarkMetric<unknown>): string {
  return metric.state === "measured" ? "measured" : metric.reason;
}

function repeatProgress(repeat: number, withinRepeat: number): number {
  return Math.min(1, Math.max(0, (repeat - 1 + withinRepeat) / 3));
}

function validateDefinition(definition: BenchmarkDefinition): void {
  if (
    definition.id === "" ||
    definition.repeatCount !== 3 ||
    !Number.isSafeInteger(definition.worldSeed) ||
    definition.qualityPresets.length === 0 ||
    new Set(definition.qualityPresets.map((preset) => preset.id)).size !==
      definition.qualityPresets.length
  ) {
    throw new Error("Benchmark definition is invalid");
  }
  for (const preset of definition.qualityPresets) {
    if (
      preset.id === "" ||
      preset.qualityVersion === "" ||
      !Number.isSafeInteger(preset.renderSize.width) ||
      preset.renderSize.width <= 0 ||
      !Number.isSafeInteger(preset.renderSize.height) ||
      preset.renderSize.height <= 0 ||
      !Number.isFinite(preset.targetRefreshRateHz) ||
      preset.targetRefreshRateHz <= 0
    ) {
      throw new Error(`Benchmark quality preset ${preset.id} is invalid`);
    }
  }
}

function requirePreset(definition: BenchmarkDefinition, presetId: string): BenchmarkQualityPreset {
  const preset = definition.qualityPresets.find((candidate) => candidate.id === presetId);
  if (preset === undefined) throw new Error(`Unknown benchmark quality preset ${presetId}`);
  return preset;
}

function waitForFlythrough(
  service: FlythroughService,
  states: readonly ReturnType<FlythroughService["snapshot"]>["state"][],
  timeoutMs: number,
  signal: AbortSignal,
  onSnapshot?: (snapshot: ReturnType<FlythroughService["snapshot"]>) => void,
): Promise<ReturnType<FlythroughService["snapshot"]>> {
  return new Promise((resolve, reject) => {
    let done = false;
    let unsubscribe = (): void => undefined;
    const finish = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      unsubscribe();
    };
    const abort = (): void => {
      if (done) return;
      done = true;
      finish();
      reject(new Error("Benchmark wait was aborted"));
    };
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      finish();
      reject(new Error(`Flythrough did not reach ${states.join("/")} within ${timeoutMs} ms`));
    }, timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    unsubscribe = service.subscribe((snapshot) => {
      onSnapshot?.(snapshot);
      if (done || !states.includes(snapshot.state)) return;
      done = true;
      finish();
      resolve(snapshot);
    });
    if (signal.aborted) abort();
    else if (done) unsubscribe();
  });
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value !== ""))];
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : String(error);
}
