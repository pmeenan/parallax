import type { AppOwnedLlmSpikeTelemetrySnapshot } from "../ai/app-owned-llm-spike-protocol";
import type { AppOwnedLlmSpikeService } from "../ai/app-owned-llm-spike-service";
import type {
  InstalledModelSource,
  InstalledModelSourceTelemetrySnapshot,
} from "../ai/installed-model-source";
import type { BenchmarkReport, BenchmarkTelemetrySnapshot } from "../benchmark/benchmark-contract";
import type { BenchmarkService } from "../benchmark/benchmark-service";
import type {
  FlythroughService,
  FlythroughTelemetrySnapshot,
} from "../flythrough/flythrough-service";
import type { InstallerTransferTelemetrySnapshot } from "../install/installer-protocol";
import type { InstallerService } from "../install/installer-service";
import type { OfflineShellService } from "../offline-shell/offline-shell-service";
import {
  type OfflineShellTelemetrySnapshot,
  unavailableOfflineShellTelemetrySnapshot,
} from "../offline-shell/shell-generation-contract";
import type {
  RenderRecoveryProbeKind,
  RenderService,
  RenderTelemetrySnapshot,
} from "../render/render-service";
import type { InstallStoreTelemetrySnapshot } from "../storage/opfs-release-store-contract";
import type {
  StreamingRecoveryCheckpoint,
  WorldStreamingTelemetrySnapshot,
} from "../streaming/streaming-protocol";
import type { WorldStreamingService } from "../streaming/world-streaming-service";
import type { WasmThreadSpikeTelemetrySnapshot } from "../wasm/wasm-thread-spike-protocol";
import type { WasmThreadSpikeService } from "../wasm/wasm-thread-spike-service";

// Public telemetry v38 advances solely for D-151's truthful store-discard-partial
// failure-evidence tuple.
export const TELEMETRY_SCHEMA_VERSION = 38;
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
  readonly benchmark: BenchmarkTelemetrySnapshot;
  readonly identity: ParallaxRuntimeIdentity;
  readonly flythrough: FlythroughTelemetrySnapshot;
  readonly installedModelSource: InstalledModelSourceTelemetrySnapshot;
  readonly installStore: InstallStoreTelemetrySnapshot;
  readonly installerTransfer: InstallerTransferTelemetrySnapshot;
  readonly offlineShell: OfflineShellTelemetrySnapshot;
  readonly render: RenderTelemetrySnapshot;
  readonly schemaVersion: typeof TELEMETRY_SCHEMA_VERSION;
  readonly streaming: WorldStreamingTelemetrySnapshot;
  readonly wasmThreadSpike: WasmThreadSpikeTelemetrySnapshot;
}

export interface ParallaxTelemetryExport {
  benchmarkResult(): BenchmarkReport | null;
  benchmarkResultJson(): string | null;
  benchmarkResultText(): string | null;
  configureBenchmark(presetId: string): void;
  exerciseRenderRecovery(probe: RenderRecoveryProbeKind): void;
  exerciseRenderRecoveryAtBoundary(
    probe: RenderRecoveryProbeKind,
  ): Promise<StreamingRecoveryCheckpoint>;
  prepareFlythrough(): void;
  resetBenchmark(): Promise<void>;
  snapshot(): ParallaxTelemetrySnapshot;
  startFlythrough(): void;
  startBenchmark(): void;
  subscribe(listener: (snapshot: ParallaxTelemetrySnapshot) => void): () => void;
  startStreamingTraversal(): void;
}

export function installTelemetryExport(
  renderService: RenderService,
  appOwnedLlmSpikeService: AppOwnedLlmSpikeService,
  wasmThreadSpikeService: WasmThreadSpikeService,
  streamingService: WorldStreamingService,
  flythroughService: FlythroughService,
  benchmarkService: BenchmarkService,
  installerService: InstallerService,
  installedModelSource: InstalledModelSource,
  offlineShellService: OfflineShellService | null,
  formatBenchmarkReport: (report: BenchmarkReport) => string,
  startStreamingTraversal: () => void,
  identity: ParallaxRuntimeIdentity,
  target: object = globalThis,
): ParallaxTelemetryExport {
  if (Object.hasOwn(target, TELEMETRY_GLOBAL_NAME)) {
    throw new Error(`${TELEMETRY_GLOBAL_NAME} is already installed in this realm`);
  }
  const frozenIdentity = Object.freeze({ ...identity });
  const assertBenchmarkDoesNotOwnScenario = (action: string): void => {
    const state = benchmarkService.snapshot().state;
    if (state !== "idle" && state !== "completed" && state !== "failed" && state !== "disposed") {
      throw new Error(`${action} is unavailable while the in-game benchmark owns the scenario`);
    }
  };
  const telemetryExport: ParallaxTelemetryExport = Object.freeze({
    benchmarkResult(): BenchmarkReport | null {
      return benchmarkService.snapshot().report;
    },
    benchmarkResultJson(): string | null {
      const report = benchmarkService.snapshot().report;
      return report === null ? null : `${JSON.stringify(report, null, 2)}\n`;
    },
    benchmarkResultText(): string | null {
      const report = benchmarkService.snapshot().report;
      return report === null ? null : formatBenchmarkReport(report);
    },
    configureBenchmark(presetId: string): void {
      benchmarkService.configure(presetId);
    },
    exerciseRenderRecovery(probe: RenderRecoveryProbeKind): void {
      renderService.exerciseRecovery(probe);
    },
    exerciseRenderRecoveryAtBoundary(
      probe: RenderRecoveryProbeKind,
    ): Promise<StreamingRecoveryCheckpoint> {
      return renderService.exerciseRecoveryAtBoundary(probe);
    },
    snapshot: () =>
      snapshot(
        renderService.snapshot(),
        appOwnedLlmSpikeService.snapshot(),
        wasmThreadSpikeService.snapshot(),
        streamingService.snapshot(),
        flythroughService.snapshot(),
        benchmarkService.snapshot(),
        installerService.snapshot(),
        installedModelSource.snapshot(),
        offlineShellService?.snapshot() ?? unavailableOfflineShellTelemetrySnapshot(),
        frozenIdentity,
      ),
    prepareFlythrough(): void {
      assertBenchmarkDoesNotOwnScenario("Standalone flythrough preflight");
      flythroughService.prepare();
    },
    resetBenchmark(): Promise<void> {
      return benchmarkService.reset();
    },
    startBenchmark(): void {
      benchmarkService.start();
    },
    startFlythrough(): void {
      assertBenchmarkDoesNotOwnScenario("Standalone flythrough start");
      flythroughService.start();
    },
    startStreamingTraversal(): void {
      assertBenchmarkDoesNotOwnScenario("Synthetic streaming traversal");
      startStreamingTraversal();
    },
    subscribe(listener: (snapshot: ParallaxTelemetrySnapshot) => void): () => void {
      const publish = (): void => {
        try {
          listener(
            snapshot(
              renderService.snapshot(),
              appOwnedLlmSpikeService.snapshot(),
              wasmThreadSpikeService.snapshot(),
              streamingService.snapshot(),
              flythroughService.snapshot(),
              benchmarkService.snapshot(),
              installerService.snapshot(),
              installedModelSource.snapshot(),
              offlineShellService?.snapshot() ?? unavailableOfflineShellTelemetrySnapshot(),
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
      const unsubscribeAppOwnedLlm = appOwnedLlmSpikeService.subscribe(publishAfterWiring);
      const unsubscribeWasmThread = wasmThreadSpikeService.subscribe(publishAfterWiring);
      const unsubscribeStreaming = streamingService.subscribe(publishAfterWiring);
      const unsubscribeFlythrough = flythroughService.subscribe(publishAfterWiring);
      const unsubscribeBenchmark = benchmarkService.subscribe(publishAfterWiring);
      const unsubscribeInstaller = installerService.subscribe(publishAfterWiring);
      const unsubscribeInstalledModelSource = installedModelSource.subscribe(publishAfterWiring);
      const unsubscribeOfflineShell =
        offlineShellService?.subscribe(publishAfterWiring) ?? (() => undefined);
      wiring = false;
      publish();
      return () => {
        unsubscribeRender();
        unsubscribeAppOwnedLlm();
        unsubscribeWasmThread();
        unsubscribeStreaming();
        unsubscribeFlythrough();
        unsubscribeBenchmark();
        unsubscribeInstaller();
        unsubscribeInstalledModelSource();
        unsubscribeOfflineShell();
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
  appOwnedLlmSpike: AppOwnedLlmSpikeTelemetrySnapshot,
  wasmThreadSpike: WasmThreadSpikeTelemetrySnapshot,
  streaming: WorldStreamingTelemetrySnapshot,
  flythrough: FlythroughTelemetrySnapshot,
  benchmark: BenchmarkTelemetrySnapshot,
  installer: ReturnType<InstallerService["snapshot"]>,
  installedModelSource: InstalledModelSourceTelemetrySnapshot,
  offlineShell: OfflineShellTelemetrySnapshot,
  identity: ParallaxRuntimeIdentity,
): ParallaxTelemetrySnapshot {
  return Object.freeze({
    appOwnedLlmSpike,
    benchmark,
    flythrough,
    identity,
    installedModelSource,
    installStore: installer.installStore,
    installerTransfer: installer.installerTransfer,
    offlineShell,
    render,
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    streaming,
    wasmThreadSpike,
  });
}
