import {
  createOpfsReadSpikeService,
  createRenderService,
  initializeEngine,
  installTelemetryExport,
} from "@parallax/engine";
import { createWalkingSkeletonScene, identifyGame } from "@parallax/game";

const identity = identifyGame(initializeEngine());
const status = document.querySelector("#status");
const canvas = document.querySelector("#render-canvas");

if (!(status instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
  throw new Error("App shell render elements are missing");
}

const renderService = createRenderService();
const opfsReadSpikeService = createOpfsReadSpikeService();
installTelemetryExport(renderService, opfsReadSpikeService, {
  engineVersion: identity.engine.version,
  gameVersion: identity.version,
});
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
