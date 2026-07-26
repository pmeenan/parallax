import { describe, expect, it, vi } from "vitest";
import { createAppOwnedLlmSpikeService } from "../src/ai/app-owned-llm-spike-service";
import { createRenderService } from "../src/render/render-service";
import { createWorldStreamingService } from "../src/streaming/world-streaming-service";
import { installTelemetryExport } from "../src/telemetry/telemetry-export";
import { createWasmThreadSpikeService } from "../src/wasm/wasm-thread-spike-service";

describe("combined telemetry export", () => {
  it("delivers one current initial snapshot and returns teardown when the listener throws", () => {
    let benchmarkState: "idle" | "resetting" | "running" = "idle";
    const telemetry = installTelemetryExport(
      createRenderService(),
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
            schemaVersion: 2,
            state: benchmarkState,
          }) as const,
        start: () => undefined,
        subscribe: () => () => undefined,
      },
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
      streaming: { state: "idle" },
      wasmThreadSpike: { state: "idle" },
    });

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
