import type { AppOwnedLlmSpikeTelemetrySnapshot } from "../ai/app-owned-llm-spike-protocol";
import type { AppOwnedLlmSpikeService } from "../ai/app-owned-llm-spike-service";
import type {
  PromptApiSpikeService,
  PromptApiSpikeTelemetrySnapshot,
} from "../ai/prompt-api-spike-service";
import type { RenderService, RenderTelemetrySnapshot } from "../render/render-service";
import type { OpfsReadSpikeTelemetrySnapshot } from "../storage/opfs-read-spike-protocol";
import type { OpfsReadSpikeService } from "../storage/opfs-read-spike-service";
import type { WorldStreamingTelemetrySnapshot } from "../streaming/streaming-protocol";
import type { WorldStreamingService } from "../streaming/world-streaming-service";
import type { Memory64SpikeTelemetrySnapshot } from "../wasm/memory64-spike-protocol";
import type { Memory64SpikeService } from "../wasm/memory64-spike-service";
import type { WasmThreadSpikeTelemetrySnapshot } from "../wasm/wasm-thread-spike-protocol";
import type { WasmThreadSpikeService } from "../wasm/wasm-thread-spike-service";

// The v10 envelope adds the production-shaped M1 streaming pipeline.
// Subsystems retain their own section schemas so platform experiments do not silently
// rewrite unrelated history.
export const TELEMETRY_SCHEMA_VERSION = 10;
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
  readonly appOwnedLlmSpike: AppOwnedLlmSpikeTelemetrySnapshot;
  readonly identity: ParallaxRuntimeIdentity;
  readonly memory64Spike: Memory64SpikeTelemetrySnapshot;
  readonly opfsReadSpike: OpfsReadSpikeTelemetrySnapshot;
  readonly promptApiSpike: PromptApiSpikeTelemetrySnapshot;
  readonly render: RenderTelemetrySnapshot;
  readonly schemaVersion: typeof TELEMETRY_SCHEMA_VERSION;
  readonly streaming: WorldStreamingTelemetrySnapshot;
  readonly wasmThreadSpike: WasmThreadSpikeTelemetrySnapshot;
}

export interface ParallaxTelemetryExport {
  snapshot(): ParallaxTelemetrySnapshot;
  // Remotely driven M0 spike controls stay explicit and typed. The activation-bound
  // Prompt API probe is app-owned and deliberately absent here.
  startOpfsReadSpike(): void;
  startMemory64Spike(): void;
  subscribe(listener: (snapshot: ParallaxTelemetrySnapshot) => void): () => void;
  startStreamingTraversal(): void;
}

export function installTelemetryExport(
  renderService: RenderService,
  opfsReadSpikeService: OpfsReadSpikeService,
  promptApiSpikeService: PromptApiSpikeService,
  appOwnedLlmSpikeService: AppOwnedLlmSpikeService,
  wasmThreadSpikeService: WasmThreadSpikeService,
  memory64SpikeService: Memory64SpikeService,
  streamingService: WorldStreamingService,
  startStreamingTraversal: () => void,
  identity: ParallaxRuntimeIdentity,
  target: object = globalThis,
): ParallaxTelemetryExport {
  if (Object.hasOwn(target, TELEMETRY_GLOBAL_NAME)) {
    throw new Error(`${TELEMETRY_GLOBAL_NAME} is already installed in this realm`);
  }
  const frozenIdentity = Object.freeze({ ...identity });
  const telemetryExport: ParallaxTelemetryExport = Object.freeze({
    snapshot: () =>
      snapshot(
        renderService.snapshot(),
        opfsReadSpikeService.snapshot(),
        promptApiSpikeService.snapshot(),
        appOwnedLlmSpikeService.snapshot(),
        wasmThreadSpikeService.snapshot(),
        memory64SpikeService.snapshot(),
        streamingService.snapshot(),
        frozenIdentity,
      ),
    startOpfsReadSpike(): void {
      opfsReadSpikeService.start();
    },
    startMemory64Spike(): void {
      memory64SpikeService.start();
    },
    startStreamingTraversal(): void {
      startStreamingTraversal();
    },
    subscribe(listener: (snapshot: ParallaxTelemetrySnapshot) => void): () => void {
      const publish = (): void => {
        try {
          listener(
            snapshot(
              renderService.snapshot(),
              opfsReadSpikeService.snapshot(),
              promptApiSpikeService.snapshot(),
              appOwnedLlmSpikeService.snapshot(),
              wasmThreadSpikeService.snapshot(),
              memory64SpikeService.snapshot(),
              streamingService.snapshot(),
              frozenIdentity,
            ),
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
      const unsubscribePromptApi = promptApiSpikeService.subscribe(publishAfterWiring);
      const unsubscribeAppOwnedLlm = appOwnedLlmSpikeService.subscribe(publishAfterWiring);
      const unsubscribeWasmThread = wasmThreadSpikeService.subscribe(publishAfterWiring);
      const unsubscribeMemory64 = memory64SpikeService.subscribe(publishAfterWiring);
      const unsubscribeStreaming = streamingService.subscribe(publishAfterWiring);
      wiring = false;
      publish();
      return () => {
        unsubscribeRender();
        unsubscribeOpfs();
        unsubscribePromptApi();
        unsubscribeAppOwnedLlm();
        unsubscribeWasmThread();
        unsubscribeMemory64();
        unsubscribeStreaming();
      };
    },
  });
  Object.defineProperty(target, TELEMETRY_GLOBAL_NAME, {
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
  promptApiSpike: PromptApiSpikeTelemetrySnapshot,
  appOwnedLlmSpike: AppOwnedLlmSpikeTelemetrySnapshot,
  wasmThreadSpike: WasmThreadSpikeTelemetrySnapshot,
  memory64Spike: Memory64SpikeTelemetrySnapshot,
  streaming: WorldStreamingTelemetrySnapshot,
  identity: ParallaxRuntimeIdentity,
): ParallaxTelemetrySnapshot {
  return Object.freeze({
    appOwnedLlmSpike,
    identity,
    memory64Spike,
    opfsReadSpike,
    promptApiSpike,
    render,
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    streaming,
    wasmThreadSpike,
  });
}
