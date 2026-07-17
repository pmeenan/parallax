import { describe, expect, it, vi } from "vitest";
import type {
  AppOwnedLlmFixtureSet,
  AppOwnedLlmSpikeTelemetrySnapshot,
  AppOwnedLlmWorkerStartRequest,
} from "../src/ai/app-owned-llm-spike-protocol";
import { createInitialAppOwnedLlmTelemetry } from "../src/ai/app-owned-llm-spike-protocol";

const { runWllamaSpike } = vi.hoisted(() => ({ runWllamaSpike: vi.fn() }));

vi.mock("../src/ai/app-owned-llm-wllama-runner", () => ({ runWllamaSpike }));

import { createAppOwnedLlmSpikeService } from "../src/ai/app-owned-llm-spike-service";

const FIXTURE_SET = Object.freeze({
  cases: Object.freeze([]),
  id: "service-lifecycle-test",
  version: 1,
}) satisfies AppOwnedLlmFixtureSet;

describe("app-owned LLM spike service", () => {
  it("aborts wllama work and ignores late telemetry after disposal", async () => {
    const observed: { finished: boolean; release?: () => void; signal?: AbortSignal } = {
      finished: false,
    };
    runWllamaSpike.mockImplementation(
      async (
        _request: AppOwnedLlmWorkerStartRequest,
        publish: (snapshot: AppOwnedLlmSpikeTelemetrySnapshot) => void,
        signal: AbortSignal,
      ) => {
        observed.signal = signal;
        await new Promise<void>((resolve) => {
          observed.release = resolve;
        });
        publish({ ...createInitialAppOwnedLlmTelemetry(), state: "completed" });
        observed.finished = true;
      },
    );
    const service = createAppOwnedLlmSpikeService();

    service.start(FIXTURE_SET, "wllama-webgpu", "https://models.example/model.gguf");
    service.dispose();
    observed.release?.();
    await vi.waitFor(() => expect(observed.finished).toBe(true));

    expect(observed.signal?.aborted).toBe(true);
    expect(service.snapshot().state).toBe("disposed");
  });

  it("does not replace a completed terminal snapshot with a late failure", async () => {
    runWllamaSpike.mockImplementation(
      async (
        _request: AppOwnedLlmWorkerStartRequest,
        publish: (snapshot: AppOwnedLlmSpikeTelemetrySnapshot) => void,
      ) => {
        publish({ ...createInitialAppOwnedLlmTelemetry(), state: "completed" });
        throw new Error("late cleanup failure");
      },
    );
    const service = createAppOwnedLlmSpikeService();

    service.start(FIXTURE_SET, "wllama-webgpu", "https://models.example/model.gguf");
    await vi.waitFor(() => expect(service.snapshot().state).toBe("completed"));

    expect(service.snapshot().failureMessage).toBeNull();
  });
});
