import { describe, expect, it, vi } from "vitest";
import { createAppOwnedLlmSpikeService } from "../src/ai/app-owned-llm-spike-service";
import { createInstalledModelSource } from "../src/ai/installed-model-source";
import { idleInstallerTransferTelemetrySnapshot } from "../src/install/installer-protocol";
import {
  idlePsoWarmupTelemetrySnapshot,
  type PsoWarmupFailure,
} from "../src/render/pso-warmup-contract";
import {
  createRenderService,
  type RenderService,
  type RenderTelemetrySnapshot,
} from "../src/render/render-service";
import { unavailableInstallStoreTelemetrySnapshot } from "../src/storage/opfs-release-store";
import { createWorldStreamingService } from "../src/streaming/world-streaming-service";
import { installTelemetryExport } from "../src/telemetry/telemetry-export";
import { createWasmThreadSpikeService } from "../src/wasm/wasm-thread-spike-service";

describe("combined telemetry export", () => {
  it("delivers one current initial snapshot and returns teardown when the listener throws", () => {
    let benchmarkState: "idle" | "resetting" | "running" = "idle";
    const baseRenderService = createRenderService();
    let renderOverride: RenderTelemetrySnapshot | null = null;
    const renderService: RenderService = {
      ...baseRenderService,
      snapshot: () => renderOverride ?? baseRenderService.snapshot(),
    };
    const telemetry = installTelemetryExport(
      renderService,
      createAppOwnedLlmSpikeService(),
      createWasmThreadSpikeService(),
      createWorldStreamingService(),
      {
        abort: () => Promise.resolve(),
        dispose: () => undefined,
        prepare: () => undefined,
        reset: () => Promise.resolve(),
        snapshot: () =>
          ({
            checkpointEvidence: [],
            failureMessage: null,
            preflightElapsedMs: null,
            render: null,
            scenarioId: "test@1",
            schemaVersion: 3,
            state: "idle",
            streamingAtMeasurementEnd: null,
            streamingAtMeasurementStart: null,
            validation: {
              distanceMeters: 12,
              durationMs: 1_000,
              environmentPhaseIds: ["test"],
              scenarioId: "test@1",
            },
          }) as const,
        start: () => undefined,
        subscribe: () => () => undefined,
      },
      {
        configure: () => undefined,
        dispose: () => undefined,
        reset: () => Promise.resolve(),
        snapshot: () =>
          ({
            activeRepeat: null,
            completedRepeats: 0,
            failureMessage: null,
            presetId: "test@1",
            progress: 0,
            report: null,
            schemaVersion: 5,
            state: benchmarkState,
          }) as const,
        start: () => undefined,
        subscribe: () => () => undefined,
      },
      {
        cancel: () => Promise.resolve(true),
        dispose: () => Promise.resolve(),
        install: () =>
          Promise.resolve({
            readyBytes: 0,
            readyResourceCount: 0,
            releaseDigest: "a".repeat(64),
          }),
        repair: () =>
          Promise.resolve({
            readyBytes: 0,
            readyResourceCount: 0,
            releaseDigest: "a".repeat(64),
          }),
        requestPersistence: () => Promise.resolve(true),
        snapshot: () => ({
          installStore: unavailableInstallStoreTelemetrySnapshot(),
          installerTransfer: idleInstallerTransferTelemetrySnapshot(),
        }),
        subscribe: () => () => undefined,
        targetStatus: () =>
          Promise.resolve({
            active: false,
            activeReleaseDigest: null,
            releaseDigest: "a".repeat(64),
          }),
      },
      createInstalledModelSource(null),
      null,
      () => "",
      () => undefined,
      {
        engineVersion: "test",
        gameVersion: "test",
      },
      {},
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let deliveries = 0;

    expect(telemetry.snapshot()).toMatchObject({
      appOwnedLlmSpike: { state: "idle" },
      benchmark: { state: "idle" },
      identity: { engineVersion: "test", gameVersion: "test" },
      installedModelSource: { state: "unavailable" },
      installStore: { schemaVersion: 3, state: "unavailable" },
      installerTransfer: {
        operationRepairAttemptCount: 0,
        operationRepairedBytes: 0,
        operationRepairedResourceCount: 0,
        schemaVersion: 9,
        state: "idle",
      },
      offlineShell: { schemaVersion: 2, state: "unavailable" },
      streaming: { state: "idle" },
      wasmThreadSpike: { state: "idle" },
    });

    for (const failure of psoFailures()) {
      const failed = failedPsoWarmupSnapshot(failure);
      renderOverride = Object.freeze({
        ...baseRenderService.snapshot(),
        psoWarmup: failed,
        retainedPsoWarmupFailure: Object.freeze({
          snapshot: failed,
          workerGeneration: 1,
        }),
        state: "failed",
      });
      expect(telemetry.snapshot().render).toMatchObject({
        psoWarmup: { failure, state: "failed" },
        retainedPsoWarmupFailure: {
          snapshot: { failure, state: "failed" },
          workerGeneration: 1,
        },
      });
    }

    const unsubscribe = telemetry.subscribe(() => {
      deliveries += 1;
      throw new Error("listener failure");
    });

    expect(deliveries).toBe(1);
    expect(unsubscribe).toBeTypeOf("function");
    expect(consoleError).toHaveBeenCalledWith(
      "Combined telemetry listener failed",
      expect.any(Error),
    );
    benchmarkState = "resetting";
    expect(() => telemetry.prepareFlythrough()).toThrow(/benchmark owns the scenario/);
    expect(() => telemetry.startFlythrough()).toThrow(/benchmark owns the scenario/);
    expect(() => telemetry.startStreamingTraversal()).toThrow(/benchmark owns the scenario/);
    benchmarkState = "running";
    expect(() => telemetry.startStreamingTraversal()).toThrow(/benchmark owns the scenario/);
    unsubscribe();
    consoleError.mockRestore();
  });
});

function failedPsoWarmupSnapshot(failure: PsoWarmupFailure) {
  const replayFailure = failure.class === "compile";
  return Object.freeze({
    ...idlePsoWarmupTelemetrySnapshot(),
    buildCompatibilityDigest: "a".repeat(64),
    cacheMissCount: replayFailure ? 1 : 0,
    compiledCount: 0,
    deferredCount: replayFailure ? 1 : 0,
    entries: replayFailure
      ? Object.freeze([
          Object.freeze({
            compileAttemptCount: 1,
            compileDurationMs: 2,
            compiled: false,
            id: failure.entryId,
            requestCount: 1,
            stateDigest: "b".repeat(64),
          }),
        ])
      : Object.freeze([]),
    failure,
    failureCount: 1,
    maximumCompileDurationMs: replayFailure ? 2 : 0,
    queueHighWater: replayFailure ? 1 : 0,
    requestedCount: replayFailure ? 1 : 0,
    source: "privileged-embedded" as const,
    state: "failed" as const,
    traceEntryCount: 1,
    traceSha256: "c".repeat(64),
  });
}

function psoFailures(): readonly PsoWarmupFailure[] {
  return Object.freeze([
    Object.freeze({
      class: "parse",
      detail: "Trace JSON is invalid",
      entryId: null,
      phase: "trace-parse",
      requestIndex: null,
      traceIndex: null,
    }),
    Object.freeze({
      class: "incompatibility",
      detail: "Renderer identity differs",
      entryId: null,
      phase: "trace-validation",
      requestIndex: null,
      traceIndex: null,
    }),
    Object.freeze({
      class: "unknown-entry",
      detail: "Trace entry is unknown",
      entryId: "unknown-entry",
      phase: "request-validation",
      requestIndex: 1,
      traceIndex: null,
    }),
    Object.freeze({
      class: "compile",
      detail: "Pipeline creation failed",
      entryId: "babylon-lite.standard-opaque-msaa4",
      phase: "compile",
      requestIndex: 1,
      traceIndex: 0,
    }),
  ]);
}
