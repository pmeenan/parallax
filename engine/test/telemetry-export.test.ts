import { describe, expect, it, vi } from "vitest";
import { createRenderService } from "../src/render/render-service";
import { createOpfsReadSpikeService } from "../src/storage/opfs-read-spike-service";
import { installTelemetryExport } from "../src/telemetry/telemetry-export";

describe("combined telemetry export", () => {
  it("delivers one initial snapshot and returns teardown when the listener throws", () => {
    const telemetry = installTelemetryExport(createRenderService(), createOpfsReadSpikeService(), {
      engineVersion: "test",
      gameVersion: "test",
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let deliveries = 0;

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
