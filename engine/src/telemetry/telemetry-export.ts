import type { RenderService, RenderTelemetrySnapshot } from "../render/render-service";
import type { OpfsReadSpikeTelemetrySnapshot } from "../storage/opfs-read-spike-protocol";
import type { OpfsReadSpikeService } from "../storage/opfs-read-spike-service";

export const TELEMETRY_SCHEMA_VERSION = 3;
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
  readonly opfsReadSpike: OpfsReadSpikeTelemetrySnapshot;
  readonly render: RenderTelemetrySnapshot;
  readonly schemaVersion: typeof TELEMETRY_SCHEMA_VERSION;
}

export interface ParallaxTelemetryExport {
  snapshot(): ParallaxTelemetrySnapshot;
  // D-058 keeps the M0 spike control explicit and typed. M1 should revisit a source
  // registry only once production streaming telemetry supplies a second durable case.
  startOpfsReadSpike(): void;
  subscribe(listener: (snapshot: ParallaxTelemetrySnapshot) => void): () => void;
}

export function installTelemetryExport(
  renderService: RenderService,
  opfsReadSpikeService: OpfsReadSpikeService,
  identity: ParallaxRuntimeIdentity,
): ParallaxTelemetryExport {
  if (Object.hasOwn(globalThis, TELEMETRY_GLOBAL_NAME)) {
    throw new Error(`${TELEMETRY_GLOBAL_NAME} is already installed in this realm`);
  }
  const frozenIdentity = Object.freeze({ ...identity });
  const telemetryExport: ParallaxTelemetryExport = Object.freeze({
    snapshot: () =>
      snapshot(renderService.snapshot(), opfsReadSpikeService.snapshot(), frozenIdentity),
    startOpfsReadSpike(): void {
      opfsReadSpikeService.start();
    },
    subscribe(listener: (snapshot: ParallaxTelemetrySnapshot) => void): () => void {
      const publish = (): void => {
        try {
          listener(
            snapshot(renderService.snapshot(), opfsReadSpikeService.snapshot(), frozenIdentity),
          );
        } catch (error: unknown) {
          console.error("Combined telemetry listener failed", error);
        }
      };
      // Both service subscriptions synchronously deliver their initial state. Suppress
      // those wiring callbacks and publish exactly one combined initial snapshot.
      let wiring = true;
      const publishAfterWiring = (): void => {
        if (!wiring) publish();
      };
      const unsubscribeRender = renderService.subscribe(publishAfterWiring);
      const unsubscribeOpfs = opfsReadSpikeService.subscribe(publishAfterWiring);
      wiring = false;
      publish();
      return () => {
        unsubscribeRender();
        unsubscribeOpfs();
      };
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
  opfsReadSpike: OpfsReadSpikeTelemetrySnapshot,
  identity: ParallaxRuntimeIdentity,
): ParallaxTelemetrySnapshot {
  return Object.freeze({
    identity,
    opfsReadSpike,
    render,
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
  });
}
