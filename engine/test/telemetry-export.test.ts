import { describe, expect, it, vi } from "vitest";
import { createAppOwnedLlmSpikeService } from "../src/ai/app-owned-llm-spike-service";
import { createRenderService } from "../src/render/render-service";
import { createWorldStreamingService } from "../src/streaming/world-streaming-service";
import { installTelemetryExport } from "../src/telemetry/telemetry-export";
import { createMemory64SpikeService } from "../src/wasm/memory64-spike-service";
import { createWasmThreadSpikeService } from "../src/wasm/wasm-thread-spike-service";

describe("combined telemetry export", () => {
  it("delivers one current initial snapshot and returns teardown when the listener throws", () => {
    const telemetry = installTelemetryExport(
      createRenderService(),
      createAppOwnedLlmSpikeService(),
      createWasmThreadSpikeService(),
      createMemory64SpikeService(),
      createWorldStreamingService(),
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
      identity: { engineVersion: "test", gameVersion: "test" },
      memory64Spike: { state: "idle" },
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
    unsubscribe();
    consoleError.mockRestore();
  });
});
