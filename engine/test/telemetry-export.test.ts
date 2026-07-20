import { describe, expect, it, vi } from "vitest";
import { createAppOwnedLlmSpikeService } from "../src/ai/app-owned-llm-spike-service";
import {
  createPromptApiSpikeService,
  type PromptApiSpikeService,
} from "../src/ai/prompt-api-spike-service";
import { createRenderService } from "../src/render/render-service";
import { createOpfsReadSpikeService } from "../src/storage/opfs-read-spike-service";
import { installTelemetryExport } from "../src/telemetry/telemetry-export";
import { createWasmThreadSpikeService } from "../src/wasm/wasm-thread-spike-service";

describe("combined telemetry export", () => {
  it("delivers one initial snapshot and returns teardown when the listener throws", () => {
    const telemetry = installTelemetryExport(
      createRenderService(),
      createOpfsReadSpikeService(),
      createPromptApiSpikeService(
        { offlinePrompt: "offline", prompt: "online" },
        {
          languageModel: null,
          now: () => 0,
          probeDedicatedWorkerExposure: async () => false,
          userActivationIsActive: () => false,
        },
      ),
      createAppOwnedLlmSpikeService(),
      createWasmThreadSpikeService(),
      {
        engineVersion: "test",
        gameVersion: "test",
      },
      {},
    );
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

  it("reads the current Prompt API snapshot instead of a captured install-time value", async () => {
    const promptApiSpikeService = createPromptService();
    const telemetry = installTestTelemetry(promptApiSpikeService);

    expect(telemetry.snapshot().promptApiSpike.state).toBe("idle");
    await promptApiSpikeService.probe();

    expect(telemetry.snapshot().promptApiSpike).toMatchObject({
      initialAvailability: "available",
      state: "awaiting-user-activation",
    });
  });

  it("publishes Prompt API state changes immediately to combined subscribers", async () => {
    const promptApiSpikeService = createPromptService();
    const telemetry = installTestTelemetry(promptApiSpikeService);
    const states: string[] = [];
    const unsubscribe = telemetry.subscribe((snapshot) => {
      states.push(snapshot.promptApiSpike.state);
    });

    await promptApiSpikeService.probe();

    expect(states[0]).toBe("idle");
    expect(states).toContain("probing");
    expect(states.at(-1)).toBe("awaiting-user-activation");
    unsubscribe();
  });
});

function createPromptService(): PromptApiSpikeService {
  return createPromptApiSpikeService(
    { offlinePrompt: "offline", prompt: "online" },
    {
      languageModel: {
        availability: async () => "available",
        create: async () => {
          throw new Error("not used");
        },
      },
      now: () => 0,
      probeDedicatedWorkerExposure: async () => false,
      userActivationIsActive: () => false,
    },
  );
}

function installTestTelemetry(promptApiSpikeService: PromptApiSpikeService) {
  return installTelemetryExport(
    createRenderService(),
    createOpfsReadSpikeService(),
    promptApiSpikeService,
    createAppOwnedLlmSpikeService(),
    createWasmThreadSpikeService(),
    { engineVersion: "test", gameVersion: "test" },
    {},
  );
}
