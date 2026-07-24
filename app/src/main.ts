import {
  createAppOwnedLlmSpikeService,
  createMemory64SpikeService,
  createOpfsReadSpikeService,
  createPromptApiSpikeService,
  createRenderService,
  createWasmThreadSpikeService,
  initializeEngine,
  installTelemetryExport,
} from "@parallax/engine";
import {
  APP_OWNED_LLM_CONTEXT_FIRST_FIXTURE_SET,
  APP_OWNED_LLM_SPIKE_FIXTURE_SET,
  createGreyboxScene,
  GREYBOX_DISTRICT_SPECS,
  identifyGame,
  PROMPT_API_BRANDED_FIXTURE,
  PROMPT_API_SPIKE_FIXTURE,
} from "@parallax/game";

const identity = identifyGame(initializeEngine());
const status = document.querySelector("#status");
const canvas = document.querySelector("#render-canvas");

if (!(status instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
  throw new Error("App shell render elements are missing");
}

const renderService = createRenderService();
const opfsReadSpikeService = createOpfsReadSpikeService();
const promptApiModeValue = new URL(location.href).searchParams.get("promptApiSpike");
if (
  promptApiModeValue !== null &&
  promptApiModeValue !== "manual" &&
  promptApiModeValue !== "branded"
) {
  throw new Error(`Unsupported Prompt API scenario mode ${JSON.stringify(promptApiModeValue)}`);
}
const promptApiMode = promptApiModeValue;
const promptApiSpikeService = createPromptApiSpikeService(
  promptApiMode === "branded" ? PROMPT_API_BRANDED_FIXTURE : PROMPT_API_SPIKE_FIXTURE,
);
const appOwnedLlmSpikeService = createAppOwnedLlmSpikeService();
const wasmThreadSpikeService = createWasmThreadSpikeService();
const memory64SpikeService = createMemory64SpikeService();
const previewDistrict = GREYBOX_DISTRICT_SPECS[0];
if (previewDistrict === undefined) throw new Error("Game build contains no greybox districts");
const worldGenerationStartedAt = performance.now();
const previewScene = createGreyboxScene(previewDistrict);
const mainThreadWorldGenerationMs = performance.now() - worldGenerationStartedAt;
installTelemetryExport(
  renderService,
  opfsReadSpikeService,
  promptApiSpikeService,
  appOwnedLlmSpikeService,
  wasmThreadSpikeService,
  memory64SpikeService,
  {
    engineVersion: identity.engine.version,
    gameVersion: identity.version,
  },
);
const appOwnedLlmMode = new URL(location.href).searchParams.get("appOwnedLlmSpike");
const appOwnedLlmDevice = new URL(location.href).searchParams.get("appOwnedLlmDevice") ?? "webgpu";
const appOwnedLlmModelUrl =
  new URL(location.href).searchParams.get("appOwnedLlmModelUrl") ?? undefined;
if (
  appOwnedLlmDevice !== "webgpu" &&
  appOwnedLlmDevice !== "wasm" &&
  appOwnedLlmDevice !== "wllama-webgpu" &&
  appOwnedLlmDevice !== "wllama-wasm"
) {
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
const promptApiSpikePanel = document.querySelector("#prompt-api-spike");
const promptApiStart = document.querySelector("#prompt-api-start");
const promptApiOffline = document.querySelector("#prompt-api-offline");
const promptApiStatus = document.querySelector("#prompt-api-status");
if (promptApiMode === "manual" || promptApiMode === "branded") {
  if (
    !(promptApiSpikePanel instanceof HTMLElement) ||
    !(promptApiStart instanceof HTMLButtonElement) ||
    !(promptApiOffline instanceof HTMLButtonElement) ||
    !(promptApiStatus instanceof HTMLElement)
  ) {
    throw new Error("Prompt API spike controls are missing");
  }
  promptApiSpikePanel.hidden = false;
  promptApiStart.addEventListener("click", () => promptApiSpikeService.runFromUserActivation());
  promptApiOffline.addEventListener("click", () =>
    promptApiSpikeService.runOfflineProbeFromUserActivation(),
  );
  promptApiSpikeService.subscribe((prompt) => {
    promptApiStart.disabled = prompt.state !== "awaiting-user-activation";
    promptApiOffline.disabled = prompt.state !== "completed" || prompt.offline.state !== "not-run";
    const availability = prompt.initialAvailability ?? "pending";
    const inference =
      prompt.inference === null
        ? ""
        : ` · first chunk ${prompt.inference.firstChunkLatencyMs.toFixed(1)} ms · context ${prompt.inference.contextUsageAfter}/${prompt.inference.contextWindow}`;
    const contexts = prompt.executionContexts;
    const worker =
      contexts.dedicatedWorker.state === "measured"
        ? String(contexts.dedicatedWorker.exposed)
        : contexts.dedicatedWorker.state;
    const download =
      prompt.download.maxProgress === null
        ? ""
        : ` · download ${(prompt.download.maxProgress * 100).toFixed(1)}% · ${prompt.download.eventsObserved} progress events`;
    promptApiStatus.textContent = `${prompt.state} · availability ${availability} · window ${String(contexts.windowExposed)} · worker ${worker}${download}${inference}`;
  });
  void promptApiSpikeService.probe();
}
const updateStatus = (): void => {
  const render = renderService.snapshot();
  const opfs = opfsReadSpikeService.snapshot();
  const wasmThreads = wasmThreadSpikeService.snapshot();
  const memory64 = memory64SpikeService.snapshot();
  status.dataset.state = render.state;
  status.dataset.frameCount = render.frameCount.toString();
  status.dataset.opfsState = opfs.state;
  status.dataset.wasmThreadState = wasmThreads.state;
  status.dataset.wasmThreadCompletedTasks = wasmThreads.completedTasks.toString();
  status.dataset.wasmThreadWorkerMask = wasmThreads.workerMask.toString();
  status.dataset.memory64State = memory64.state;
  const buildIdentity = `${identity.name} ${identity.version} / engine ${identity.engine.version}`;
  if (render.state === "ready") {
    const world = render.greyboxWorld;
    const worldStatus =
      world === null
        ? ""
        : ` · ${world.cellCount} cells · ${world.renderedTerrainPatchCount.toLocaleString()} terrain patches · ${world.renderedFeaturePrimitiveCount.toLocaleString()} box features`;
    const storageStatus =
      opfs.state === "completed" && opfs.sequential !== null
        ? ` · OPFS sequential ${(opfs.sequential.readCallThroughputBytesPerSecond / 1024 ** 3).toFixed(2)} GiB/s`
        : opfs.state === "failed"
          ? ` · OPFS spike failed: ${opfs.failureMessage ?? "unknown error"}`
          : opfs.state === "running"
            ? " · OPFS spike running"
            : "";
    const wasmStatus =
      wasmThreads.state === "completed"
        ? ` · WASM threads ${wasmThreads.completedTasks.toLocaleString()}/${wasmThreads.taskCount.toLocaleString()} tasks in ${wasmThreads.elapsedMs?.toFixed(1) ?? "?"} ms`
        : wasmThreads.state === "failed"
          ? ` · WASM threads failed: ${wasmThreads.failureMessage ?? "unknown error"}`
          : wasmThreads.state === "running"
            ? " · WASM threads running"
            : "";
    status.textContent = `${buildIdentity} · WebGPU render worker ready · ${render.frameCount} frames${worldStatus}${storageStatus}${wasmStatus}`;
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
opfsReadSpikeService.subscribe(() => {
  updateStatus();
});
memory64SpikeService.subscribe(() => {
  updateStatus();
});
let wasmThreadSpikeStarted = false;
const memory64SpikeMode = new URL(location.href).searchParams.get("memory64Spike");
const memory64SpikeOwnsSyntheticWorkload =
  memory64SpikeMode === "auto" || memory64SpikeMode === "dedicated";
renderService.subscribe((telemetry) => {
  if (
    !memory64SpikeOwnsSyntheticWorkload &&
    telemetry.state === "ready" &&
    telemetry.sabRingBufferSpike.state === "completed" &&
    !wasmThreadSpikeStarted
  ) {
    wasmThreadSpikeStarted = true;
    wasmThreadSpikeService.start();
  }
});
if (new URL(location.href).searchParams.get("opfsSpike") === "auto") {
  let opfsSpikeStarted = false;
  renderService.subscribe((telemetry) => {
    if (telemetry.state === "ready" && !opfsSpikeStarted) {
      opfsSpikeStarted = true;
      opfsReadSpikeService.start();
    }
  });
}
if (memory64SpikeMode === "auto") {
  memory64SpikeService.start();
}
renderService.start(canvas, previewScene, { mainThreadWorldGenerationMs });
