import { createRenderService, initializeEngine, installTelemetryExport } from "@parallax/engine";
import { createWalkingSkeletonScene, identifyGame } from "@parallax/game";

const identity = identifyGame(initializeEngine());
const status = document.querySelector("#status");
const canvas = document.querySelector("#render-canvas");

if (!(status instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
  throw new Error("App shell render elements are missing");
}

const renderService = createRenderService();
installTelemetryExport(renderService, {
  engineVersion: identity.engine.version,
  gameVersion: identity.version,
});
renderService.subscribe((telemetry) => {
  status.dataset.state = telemetry.state;
  status.dataset.frameCount = telemetry.frameCount.toString();
  const buildIdentity = `${identity.name} ${identity.version} / engine ${identity.engine.version}`;
  if (telemetry.state === "ready") {
    status.textContent = `${buildIdentity} · WebGPU render worker ready · ${telemetry.frameCount} frames`;
  } else if (telemetry.state === "failed") {
    status.textContent = `${buildIdentity} · Render worker failed: ${telemetry.failureMessage ?? "unknown error"}`;
  } else {
    status.textContent = `${buildIdentity} · Render worker: ${telemetry.state}`;
  }
});
renderService.start(canvas, createWalkingSkeletonScene());
