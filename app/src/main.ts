import {
  createOpfsReadSpikeService,
  createPromptApiSpikeService,
  createRenderService,
  initializeEngine,
  installTelemetryExport,
} from "@parallax/engine";
import { createWalkingSkeletonScene, identifyGame, PROMPT_API_SPIKE_FIXTURE } from "@parallax/game";

const identity = identifyGame(initializeEngine());
const status = document.querySelector("#status");
const canvas = document.querySelector("#render-canvas");

if (!(status instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
  throw new Error("App shell render elements are missing");
}

const renderService = createRenderService();
const opfsReadSpikeService = createOpfsReadSpikeService();
const promptApiSpikeService = createPromptApiSpikeService(PROMPT_API_SPIKE_FIXTURE);
installTelemetryExport(renderService, opfsReadSpikeService, promptApiSpikeService, {
  engineVersion: identity.engine.version,
  gameVersion: identity.version,
});
const promptApiSpikePanel = document.querySelector("#prompt-api-spike");
const promptApiStart = document.querySelector("#prompt-api-start");
const promptApiOffline = document.querySelector("#prompt-api-offline");
const promptApiStatus = document.querySelector("#prompt-api-status");
if (new URL(location.href).searchParams.get("promptApiSpike") === "manual") {
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
  status.dataset.state = render.state;
  status.dataset.frameCount = render.frameCount.toString();
  status.dataset.opfsState = opfs.state;
  const buildIdentity = `${identity.name} ${identity.version} / engine ${identity.engine.version}`;
  if (render.state === "ready") {
    const storageStatus =
      opfs.state === "completed" && opfs.sequential !== null
        ? ` · OPFS sequential ${(opfs.sequential.readCallThroughputBytesPerSecond / 1024 ** 3).toFixed(2)} GiB/s`
        : opfs.state === "failed"
          ? ` · OPFS spike failed: ${opfs.failureMessage ?? "unknown error"}`
          : opfs.state === "running"
            ? " · OPFS spike running"
            : "";
    status.textContent = `${buildIdentity} · WebGPU render worker ready · ${render.frameCount} frames${storageStatus}`;
  } else if (render.state === "failed") {
    status.textContent = `${buildIdentity} · Render worker failed: ${render.failureMessage ?? "unknown error"}`;
  } else {
    status.textContent = `${buildIdentity} · Render worker: ${render.state}`;
  }
};
renderService.subscribe(() => {
  updateStatus();
});
opfsReadSpikeService.subscribe(() => {
  updateStatus();
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
renderService.start(canvas, createWalkingSkeletonScene());
