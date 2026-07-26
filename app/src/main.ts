import {
  createAppOwnedLlmSpikeService,
  createBenchmarkService,
  createBrowserBenchmarkPlatform,
  createFlythroughService,
  createRenderService,
  createWasmThreadSpikeService,
  createWorldStreamingService,
  initializeEngine,
  installTelemetryExport,
} from "@parallax/engine";
import {
  APP_OWNED_LLM_CONTEXT_FIRST_FIXTURE_SET,
  APP_OWNED_LLM_SPIKE_FIXTURE_SET,
  createGreyboxScene,
  DISTRICT_1_FLYTHROUGH,
  formatM1BenchmarkPreset,
  formatM1BenchmarkReport,
  formatM1BenchmarkStatus,
  GREYBOX_DISTRICT_SPECS,
  identifyGame,
  M1_BENCHMARK_DEFINITION,
  M1_BENCHMARK_UI_COPY,
} from "@parallax/game";
import { runBenchmarkUiAction } from "./benchmark-ui-action";
import { mountStreamingDashboard } from "./streaming-dashboard";

const identity = identifyGame(initializeEngine());
const status = document.querySelector("#status");
const canvas = document.querySelector("#render-canvas");

if (!(status instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
  throw new Error("App shell render elements are missing");
}

const renderService = createRenderService();
const appOwnedLlmSpikeService = createAppOwnedLlmSpikeService();
const wasmThreadSpikeService = createWasmThreadSpikeService();
const streamingService = createWorldStreamingService();
const previewDistrict = GREYBOX_DISTRICT_SPECS[0];
if (previewDistrict === undefined) throw new Error("Game build contains no greybox districts");
const worldGenerationStartedAt = performance.now();
const previewScene = createGreyboxScene(previewDistrict);
const flythroughService = createFlythroughService(
  renderService,
  streamingService,
  DISTRICT_1_FLYTHROUGH,
  previewScene.world.bounds,
);
const benchmarkService = createBenchmarkService(
  renderService,
  flythroughService,
  M1_BENCHMARK_DEFINITION,
  createBrowserBenchmarkPlatform(),
);
const mainThreadWorldGenerationMs = performance.now() - worldGenerationStartedAt;
let streamingMovementStartedAt: number | null = null;
let streamingMovementTimer: number | null = null;
const startStreamingTraversal = (): void => {
  const benchmarkState = benchmarkService.snapshot().state;
  if (
    benchmarkState !== "idle" &&
    benchmarkState !== "completed" &&
    benchmarkState !== "failed" &&
    benchmarkState !== "disposed"
  ) {
    throw new Error("Streaming traversal is unavailable while benchmark mode owns the scenario");
  }
  if (streamingService.snapshot().state !== "streaming") {
    throw new Error("Streaming traversal requires completed initial residency");
  }
  if (streamingMovementTimer !== null) return;
  streamingMovementStartedAt = performance.now();
  streamingMovementTimer = window.setInterval(() => {
    const state = benchmarkService.snapshot().state;
    if (state !== "idle" && state !== "completed" && state !== "failed" && state !== "disposed") {
      if (streamingMovementTimer !== null) window.clearInterval(streamingMovementTimer);
      streamingMovementTimer = null;
      streamingMovementStartedAt = null;
      return;
    }
    const elapsedSeconds = (performance.now() - (streamingMovementStartedAt ?? 0)) / 1_000;
    // Reverse diagonally across a four-cell corner. Each 2.121 m one-way traversal
    // changes three members of the nine-cell target set; at 12 m/s this supplies
    // at least 15 replacement opportunities in every one-second smoke window.
    const endpointCoordinate = 0.75;
    const oneWayMeters = Math.hypot(endpointCoordinate * 2, endpointCoordinate * 2);
    const progress =
      (elapsedSeconds * previewScene.world.standardTraversalMetersPerSecond) % (oneWayMeters * 2);
    const distanceAlongPath = progress <= oneWayMeters ? progress : oneWayMeters * 2 - progress;
    const fraction = distanceAlongPath / oneWayMeters;
    const coordinate = -endpointCoordinate + endpointCoordinate * 2 * fraction;
    streamingService.setObservers([[coordinate, 12, coordinate]]);
  }, 50);
};
const telemetryExport = installTelemetryExport(
  renderService,
  appOwnedLlmSpikeService,
  wasmThreadSpikeService,
  streamingService,
  flythroughService,
  benchmarkService,
  formatM1BenchmarkReport,
  startStreamingTraversal,
  {
    engineVersion: identity.engine.version,
    gameVersion: identity.version,
  },
);
const streamingDashboard = document.querySelector("#streaming-dashboard");
if (!(streamingDashboard instanceof HTMLElement)) {
  throw new Error("Streaming dashboard panel is missing");
}
mountStreamingDashboard(streamingDashboard, streamingService);
mountBenchmarkUi();

function mountBenchmarkUi(): void {
  const panel = document.querySelector("#benchmark-mode");
  if (!(panel instanceof HTMLElement)) throw new Error("Benchmark mode panel is missing");

  const title = document.createElement("h2");
  title.textContent = M1_BENCHMARK_UI_COPY.title;
  const summary = document.createElement("p");
  summary.className = "benchmark-summary";
  summary.textContent = M1_BENCHMARK_UI_COPY.summary;
  const presetLabel = document.createElement("label");
  presetLabel.htmlFor = "benchmark-preset";
  presetLabel.textContent = M1_BENCHMARK_UI_COPY.presetLabel;
  const presetSelect = document.createElement("select");
  presetSelect.id = "benchmark-preset";
  for (const preset of M1_BENCHMARK_DEFINITION.qualityPresets) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = formatM1BenchmarkPreset(preset);
    presetSelect.append(option);
  }
  const progressLabel = document.createElement("label");
  progressLabel.htmlFor = "benchmark-progress";
  progressLabel.textContent = M1_BENCHMARK_UI_COPY.progressLabel;
  const progress = document.createElement("progress");
  progress.id = "benchmark-progress";
  progress.max = 1;
  progress.value = 0;
  const benchmarkStatus = document.createElement("p");
  benchmarkStatus.setAttribute("aria-live", "polite");
  benchmarkStatus.textContent = M1_BENCHMARK_UI_COPY.idleStatus;
  const actions = document.createElement("div");
  actions.className = "benchmark-actions";
  const start = benchmarkButton(M1_BENCHMARK_UI_COPY.start);
  const downloadJson = benchmarkButton(M1_BENCHMARK_UI_COPY.downloadJson);
  const downloadText = benchmarkButton(M1_BENCHMARK_UI_COPY.downloadText);
  const copySummary = benchmarkButton(M1_BENCHMARK_UI_COPY.copySummary);
  downloadJson.disabled = true;
  downloadText.disabled = true;
  copySummary.disabled = true;
  actions.append(start, downloadJson, downloadText, copySummary);
  const result = document.createElement("details");
  result.className = "benchmark-result";
  const resultSummary = document.createElement("summary");
  resultSummary.textContent = M1_BENCHMARK_UI_COPY.resultDetails;
  const resultBody = document.createElement("pre");
  result.append(resultSummary, resultBody);
  panel.append(
    title,
    summary,
    presetLabel,
    presetSelect,
    progressLabel,
    progress,
    benchmarkStatus,
    actions,
    result,
  );

  const benchmarkMode = new URL(location.href).searchParams.get("benchmark");
  if (benchmarkMode !== null && benchmarkMode !== "manual" && benchmarkMode !== "auto") {
    throw new Error(`Unsupported benchmark mode ${JSON.stringify(benchmarkMode)}`);
  }
  const requestedPreset = new URL(location.href).searchParams.get("benchmarkPreset");
  if (requestedPreset !== null) {
    if (!M1_BENCHMARK_DEFINITION.qualityPresets.some((preset) => preset.id === requestedPreset)) {
      throw new Error(`Unsupported benchmark preset ${JSON.stringify(requestedPreset)}`);
    }
    telemetryExport.configureBenchmark(requestedPreset);
  }

  let autoStarted = false;
  let benchmarkActive = false;
  const benchmarkPrerequisitesReady = (): boolean =>
    renderService.snapshot().state === "ready" &&
    streamingService.snapshot().state === "streaming" &&
    wasmThreadSpikeService.snapshot().state === "completed";
  const updateStartAvailability = (): void => {
    start.disabled = benchmarkActive || !benchmarkPrerequisitesReady();
    if (!benchmarkActive && benchmarkService.snapshot().state === "idle") {
      benchmarkStatus.textContent = benchmarkPrerequisitesReady()
        ? M1_BENCHMARK_UI_COPY.idleStatus
        : M1_BENCHMARK_UI_COPY.waitingStatus;
    }
  };
  const performBenchmarkUiAction = (action: () => void | Promise<void>): void => {
    runBenchmarkUiAction({
      action,
      announce: (message) => {
        benchmarkStatus.textContent = message;
      },
      failurePrefix: M1_BENCHMARK_UI_COPY.actionFailed,
      formatStatus: formatM1BenchmarkStatus,
      snapshot: benchmarkService.snapshot,
    });
  };
  const startBenchmark = (): void => {
    performBenchmarkUiAction(async () => {
      const snapshot = benchmarkService.snapshot();
      if (snapshot.state === "completed" || snapshot.state === "failed") {
        await telemetryExport.resetBenchmark();
      }
      telemetryExport.startBenchmark();
    });
  };
  const maybeAutoStart = (): void => {
    if (benchmarkMode === "auto" && !autoStarted && benchmarkPrerequisitesReady()) {
      autoStarted = true;
      startBenchmark();
    }
  };
  start.addEventListener("click", startBenchmark);
  presetSelect.addEventListener("change", () => {
    performBenchmarkUiAction(() => {
      telemetryExport.configureBenchmark(presetSelect.value);
    });
  });
  downloadJson.addEventListener("click", () => {
    const contents = telemetryExport.benchmarkResultJson();
    if (contents !== null) downloadBenchmarkResult(contents, "json", "application/json");
  });
  downloadText.addEventListener("click", () => {
    const contents = telemetryExport.benchmarkResultText();
    if (contents !== null) downloadBenchmarkResult(contents, "md", "text/markdown");
  });
  copySummary.addEventListener("click", async () => {
    const contents = telemetryExport.benchmarkResultText();
    if (contents === null || navigator.clipboard === undefined) return;
    copySummary.disabled = true;
    try {
      await navigator.clipboard.writeText(contents);
      benchmarkStatus.textContent = M1_BENCHMARK_UI_COPY.copySucceeded;
    } catch (error: unknown) {
      benchmarkStatus.textContent = `${M1_BENCHMARK_UI_COPY.copyFailed}: ${
        error instanceof Error ? error.message : String(error)
      }`;
    } finally {
      copySummary.disabled = benchmarkService.snapshot().report === null;
    }
  });
  benchmarkService.subscribe((snapshot) => {
    panel.dataset.state = snapshot.state;
    panel.dataset.resultContract = snapshot.report?.resultContract ?? "";
    panel.dataset.activeRepeat = snapshot.activeRepeat?.toString() ?? "";
    panel.dataset.completedRepeats = snapshot.completedRepeats.toString();
    progress.value = snapshot.progress;
    benchmarkStatus.textContent = formatM1BenchmarkStatus(snapshot);
    presetSelect.value = snapshot.presetId;
    const active =
      snapshot.state !== "idle" &&
      snapshot.state !== "completed" &&
      snapshot.state !== "failed" &&
      snapshot.state !== "disposed";
    benchmarkActive = active;
    start.textContent =
      snapshot.state === "completed" || snapshot.state === "failed"
        ? M1_BENCHMARK_UI_COPY.runAgain
        : M1_BENCHMARK_UI_COPY.start;
    presetSelect.disabled = active;
    const hasReport = snapshot.report !== null;
    downloadJson.disabled = !hasReport;
    downloadText.disabled = !hasReport;
    copySummary.disabled = !hasReport || navigator.clipboard === undefined;
    resultBody.textContent =
      snapshot.report === null ? "" : formatM1BenchmarkReport(snapshot.report);
    updateStartAvailability();
  });
  const readinessChanged = (): void => {
    updateStartAvailability();
    maybeAutoStart();
  };
  renderService.subscribe(readinessChanged);
  streamingService.subscribe(readinessChanged);
  wasmThreadSpikeService.subscribe(readinessChanged);
}

function benchmarkButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  return button;
}

function downloadBenchmarkResult(contents: string, extension: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.download = `parallax-m1-benchmark.${extension}`;
  anchor.href = url;
  anchor.click();
  URL.revokeObjectURL(url);
}

const appOwnedLlmMode = new URL(location.href).searchParams.get("appOwnedLlmSpike");
const appOwnedLlmDevice =
  new URL(location.href).searchParams.get("appOwnedLlmDevice") ?? "wllama-webgpu";
const appOwnedLlmModelUrl =
  new URL(location.href).searchParams.get("appOwnedLlmModelUrl") ?? undefined;
if (appOwnedLlmDevice !== "wllama-webgpu" && appOwnedLlmDevice !== "wllama-wasm") {
  throw new Error(`Unsupported app-owned LLM device ${JSON.stringify(appOwnedLlmDevice)}`);
}
if (
  appOwnedLlmMode !== null &&
  appOwnedLlmMode !== "manual" &&
  appOwnedLlmMode !== "context-first"
) {
  throw new Error(`Unsupported app-owned LLM scenario mode ${JSON.stringify(appOwnedLlmMode)}`);
}
const appOwnedLlmPanel = document.querySelector("#app-owned-llm-spike");
const appOwnedLlmStart = document.querySelector("#app-owned-llm-start");
const appOwnedLlmStatus = document.querySelector("#app-owned-llm-status");
if (appOwnedLlmMode === "manual" || appOwnedLlmMode === "context-first") {
  if (
    !(appOwnedLlmPanel instanceof HTMLElement) ||
    !(appOwnedLlmStart instanceof HTMLButtonElement) ||
    !(appOwnedLlmStatus instanceof HTMLElement)
  ) {
    throw new Error("App-owned LLM spike controls are missing");
  }
  appOwnedLlmPanel.hidden = false;
  appOwnedLlmStart.addEventListener("click", () => {
    appOwnedLlmSpikeService.start(
      appOwnedLlmMode === "context-first"
        ? APP_OWNED_LLM_CONTEXT_FIRST_FIXTURE_SET
        : APP_OWNED_LLM_SPIKE_FIXTURE_SET,
      appOwnedLlmDevice,
      appOwnedLlmModelUrl,
    );
  });
  appOwnedLlmSpikeService.subscribe((llm) => {
    appOwnedLlmStart.disabled = llm.state !== "idle";
    const load = llm.loadElapsedMs === null ? "" : ` · load ${llm.loadElapsedMs.toFixed(0)} ms`;
    const active = llm.activeFixtureId === null ? "" : ` · ${llm.activeFixtureId}`;
    appOwnedLlmStatus.textContent = `${llm.state} · ${(llm.progress * 100).toFixed(1)}% · ${llm.generations.length} samples${load}${active}`;
  });
}
const updateStatus = (): void => {
  const render = renderService.snapshot();
  const wasmThreads = wasmThreadSpikeService.snapshot();
  status.dataset.state = render.state;
  status.dataset.frameCount = render.frameCount.toString();
  status.dataset.wasmThreadState = wasmThreads.state;
  status.dataset.wasmThreadCompletedTasks = wasmThreads.completedTasks.toString();
  status.dataset.wasmThreadWorkerMask = wasmThreads.workerMask.toString();
  const buildIdentity = `${identity.name} ${identity.version} / engine ${identity.engine.version}`;
  if (render.state === "ready") {
    const world = render.greyboxWorld;
    const worldStatus =
      world === null
        ? ""
        : ` · ${world.cellCount} cells · ${world.renderedTerrainPatchCount.toLocaleString()} terrain patches · ${world.renderedFeaturePrimitiveCount.toLocaleString()} box features`;
    const wasmStatus =
      wasmThreads.state === "completed"
        ? ` · WASM threads ${wasmThreads.completedTasks.toLocaleString()}/${wasmThreads.taskCount.toLocaleString()} tasks in ${wasmThreads.elapsedMs?.toFixed(1) ?? "?"} ms`
        : wasmThreads.state === "failed"
          ? ` · WASM threads failed: ${wasmThreads.failureMessage ?? "unknown error"}`
          : wasmThreads.state === "running"
            ? " · WASM threads running"
            : "";
    status.textContent = `${buildIdentity} · WebGPU render worker ready · ${render.frameCount} frames${worldStatus}${wasmStatus}`;
  } else if (render.state === "failed") {
    status.textContent = `${buildIdentity} · Render worker failed: ${render.failureMessage ?? "unknown error"}`;
  } else {
    status.textContent = `${buildIdentity} · Render worker: ${render.state}`;
  }
};
renderService.subscribe(() => {
  updateStatus();
});
wasmThreadSpikeService.subscribe(() => {
  updateStatus();
});
let wasmThreadSpikeStarted = false;
renderService.subscribe((telemetry) => {
  if (
    telemetry.state === "ready" &&
    telemetry.sabRingBufferSpike.state === "completed" &&
    !wasmThreadSpikeStarted
  ) {
    wasmThreadSpikeStarted = true;
    wasmThreadSpikeService.start();
  }
});
const streamingRenderPort = streamingService.start({
  buildManifestUrl: new URL("/build-manifest.json", location.href).href,
  districtId: previewScene.world.id,
  // The observer starts just inside the southwest side of a four-cell corner and
  // then traverses its diagonal at D-090's standard speed.
  initialObservers: [[-0.75, 12, -0.75]],
});
streamingService.subscribe((streaming) => {
  status.dataset.streamingState = streaming.state;
  status.dataset.streamingResidentCells = streaming.residentCellCount.toString();
  status.dataset.streamingFailure = streaming.failureMessage ?? "";
  status.dataset.streamingLoadSamples = streaming.cellLoadSamples.length.toString();
  status.dataset.streamingLoadMaximumMs = Math.max(
    0,
    ...streaming.cellLoadSamples.map(({ totalMs }) => totalMs),
  ).toFixed(3);
  const sortedLoadTimes = streaming.cellLoadSamples
    .map(({ totalMs }) => totalMs)
    .sort((left, right) => left - right);
  const p95Rank = Math.max(0, Math.ceil(sortedLoadTimes.length * 0.95) - 1);
  status.dataset.streamingLoadP95Ms = (sortedLoadTimes[p95Rank] ?? 0).toFixed(3);
  status.dataset.streamingProactiveEvictions = streaming.proactiveEvictionCount.toString();
  status.dataset.streamingCpuBudgetRejections = streaming.cpuBudgetRejectionCount.toString();
  status.dataset.streamingDecodeWorkers = streaming.decodeWorkerCount.toString();
  status.dataset.streamingResidentEncodedBytes = streaming.residentEncodedBytes.toString();
  status.dataset.streamingResidentGpuBytes = streaming.residentGpuBytes.toString();
  if (streaming.state === "failed") {
    renderService.failAfterStreamingFailure(
      streaming.failureMessage ?? "Streaming worker failed without a diagnostic",
    );
  }
  if (
    streamingMovementTimer !== null &&
    streaming.state !== "streaming" &&
    streaming.state !== "provisioning"
  ) {
    window.clearInterval(streamingMovementTimer);
    streamingMovementTimer = null;
  }
});
if (new URL(location.href).searchParams.get("streamingTraversal") === "auto") {
  let automaticStreamingTraversalStarted = false;
  streamingService.subscribe((streaming) => {
    if (streaming.state === "streaming" && !automaticStreamingTraversalStarted) {
      automaticStreamingTraversalStarted = true;
      startStreamingTraversal();
    }
  });
}
renderService.start(canvas, previewScene, {
  failStreamingCohort: (message) => streamingService.failAfterRenderFailure(message),
  mainThreadWorldGenerationMs,
  restartStreamingCohort: (checkpoint) => streamingService.restartAfterRenderFailure(checkpoint),
  streamingPort: streamingRenderPort,
});
