import type { RenderService, RenderTelemetrySnapshot } from "../render/render-service";

export const TELEMETRY_SCHEMA_VERSION = 1;
export const TELEMETRY_GLOBAL_NAME = "__PARALLAX_TELEMETRY__";
// The render worker publishes frame telemetry once per batch of this many rendered
// frames, so an observed render.frameCount can trail the true rendered frame count by
// up to TELEMETRY_FRAME_BATCH_FRAMES - 1 frames. Consumers that need frame windows
// aligned to an external marker (the harness) must pad the window start by one full
// batch to guarantee every selected frame was rendered after the marker.
export const TELEMETRY_FRAME_BATCH_FRAMES = 60;

export interface ParallaxRuntimeIdentity {
  readonly engineVersion: string;
  readonly gameVersion: string;
}

export interface ParallaxTelemetrySnapshot {
  readonly identity: ParallaxRuntimeIdentity;
  readonly render: RenderTelemetrySnapshot;
  readonly schemaVersion: typeof TELEMETRY_SCHEMA_VERSION;
}

export interface ParallaxTelemetryExport {
  snapshot(): ParallaxTelemetrySnapshot;
  subscribe(listener: (snapshot: ParallaxTelemetrySnapshot) => void): () => void;
}

export function installTelemetryExport(
  renderService: RenderService,
  identity: ParallaxRuntimeIdentity,
): ParallaxTelemetryExport {
  if (Object.hasOwn(globalThis, TELEMETRY_GLOBAL_NAME)) {
    throw new Error(`${TELEMETRY_GLOBAL_NAME} is already installed in this realm`);
  }
  const frozenIdentity = Object.freeze({ ...identity });
  const telemetryExport: ParallaxTelemetryExport = Object.freeze({
    snapshot: () => snapshot(renderService.snapshot(), frozenIdentity),
    subscribe(listener: (snapshot: ParallaxTelemetrySnapshot) => void): () => void {
      return renderService.subscribe((render) => listener(snapshot(render, frozenIdentity)));
    },
  });
  Object.defineProperty(globalThis, TELEMETRY_GLOBAL_NAME, {
    configurable: false,
    enumerable: false,
    value: telemetryExport,
    writable: false,
  });
  return telemetryExport;
}

function snapshot(
  render: RenderTelemetrySnapshot,
  identity: ParallaxRuntimeIdentity,
): ParallaxTelemetrySnapshot {
  return Object.freeze({
    identity,
    render,
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
  });
}
