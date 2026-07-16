import type {
  ParallaxTelemetrySnapshot,
  PromptApiSpikeTelemetrySnapshot,
  RenderFrameSample,
} from "@parallax/engine";
import { TELEMETRY_GLOBAL_NAME } from "@parallax/engine";
import type { Page } from "playwright-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MachineDescriptor, WindowsHostIdentity } from "./environment.js";
import type { PromptApiProfileLineage } from "./prompt-api-profile.js";
import {
  createPromptEnvironmentIdentity,
  executePromptApiEntrypoint,
  installLongTaskObserver,
  installRuntimeCollectors,
  type RuntimeCollectors,
  removePromptApiProfile,
  resolveRuntimeCapture,
  revalidateHostEnvironment,
} from "./prompt-api-spike-run.js";
import { PROMPT_API_SPIKE_PROFILE_LINEAGE_SCHEMA_VERSION } from "./runs/prompt-api-spike.js";

const COLLECTOR_NAME = "__PARALLAX_PROMPT_COLLECTORS__";
const LONG_TASK_COLLECTOR_NAME = "__PARALLAX_PROMPT_LONG_TASKS__";

afterEach(() => {
  Reflect.deleteProperty(globalThis, TELEMETRY_GLOBAL_NAME);
  Reflect.deleteProperty(globalThis, COLLECTOR_NAME);
  Reflect.deleteProperty(globalThis, LONG_TASK_COLLECTOR_NAME);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Prompt API spike runner seams", () => {
  it("applies the full telemetry-batch guard band and filters long tasks to inference", async () => {
    let current = runtimeSnapshot("awaiting-user-activation", 100, []);
    let subscriber: ((snapshot: ParallaxTelemetrySnapshot) => void) | null = null;
    Reflect.set(globalThis, TELEMETRY_GLOBAL_NAME, {
      snapshot: () => current,
      subscribe: (listener: (snapshot: ParallaxTelemetrySnapshot) => void) => {
        subscriber = listener;
        listener(current);
        return () => undefined;
      },
    });
    Reflect.set(globalThis, LONG_TASK_COLLECTOR_NAME, {
      snapshot: () => ({
        failureMessage: null,
        records: [
          { duration: 5, startTime: 0 },
          { duration: 2, startTime: 9 },
          { duration: 3, startTime: 19 },
          { duration: 5, startTime: 20 },
        ],
      }),
    });
    vi.spyOn(performance, "now").mockReturnValueOnce(10).mockReturnValueOnce(20);

    await installRuntimeCollectors(immediateEvaluatePage());
    const publish = (next: ParallaxTelemetrySnapshot): void => {
      current = next;
      subscriber?.(next);
    };
    publish(runtimeSnapshot("running-inference", 100, []));
    publish(runtimeSnapshot("running-inference", 160, frames(60, 1)));
    publish(runtimeSnapshot("running-inference", 190, frames(30, 2)));
    publish(runtimeSnapshot("completed", 191, frames(1, 3)));

    const result = readInstalledCollectors();
    expect(result.frameWindowFailureMessage).toBeNull();
    expect(result.frames).toHaveLength(31);
    expect(result.frames.every((frame) => frame.durationMs !== 1)).toBe(true);
    expect(result.longTaskFailureMessage).toBeNull();
    expect(result.longTaskDurationsMs).toEqual([2, 3]);
  });

  it("marks long-task evidence invalid instead of producing a vacuous budget pass", () => {
    const capture = resolveRuntimeCapture(
      completedPromptTelemetry(),
      {
        frameWindowFailureMessage: null,
        frames: frames(30, 16),
        longTaskDurationsMs: [],
        longTaskFailureMessage: "Long Tasks API unavailable",
      },
      "showcase",
      freshLineage(),
    );

    expect(capture.longTasks).toEqual({
      reason: "Long Tasks API unavailable",
      state: "invalid",
    });
    expect(capture.budgetChecks).toEqual([]);
  });

  it("detects unsupported long-task observation and uses the buffered single-type form", async () => {
    class UnsupportedObserver {
      static readonly supportedEntryTypes: readonly string[] = [];
      constructor(readonly callback: PerformanceObserverCallback) {}
      observe(_options: PerformanceObserverInit): void {}
      takeRecords(): PerformanceEntryList {
        return [];
      }
    }
    vi.stubGlobal("PerformanceObserver", UnsupportedObserver);
    await installLongTaskObserver(immediateInitScriptPage());
    expect(readLongTaskCollector().failureMessage).toContain("not supported");

    let observed: PerformanceObserverInit | null = null;
    class SupportedObserver {
      static readonly supportedEntryTypes = ["longtask"];
      constructor(readonly callback: PerformanceObserverCallback) {}
      observe(options: PerformanceObserverInit): void {
        observed = options;
      }
      takeRecords(): PerformanceEntryList {
        return [];
      }
    }
    vi.stubGlobal("PerformanceObserver", SupportedObserver);
    await installLongTaskObserver(immediateInitScriptPage());
    expect(observed).toEqual({ buffered: true, type: "longtask" });
    expect(readLongTaskCollector().failureMessage).toBeNull();
  });

  it("reports fatal entrypoint failures before returning the failure outcome", async () => {
    const reportFatal = vi.fn(async (_message: string) => undefined);

    const failure = await executePromptApiEntrypoint(async () => {
      throw new Error("launch failed");
    }, reportFatal);

    expect(reportFatal).toHaveBeenCalledWith("launch failed");
    expect(failure).toEqual({ message: "launch failed", reportFailure: null });
  });

  it("does not let temporary-profile cleanup overwrite the run outcome", async () => {
    const warning = vi.fn<(message: string) => void>();
    await expect(
      removePromptApiProfile(
        {
          remove: async () => {
            throw new Error("locked profile");
          },
        },
        warning,
      ),
    ).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("locked profile"));
  });

  it("derives machine ID and display mode and retains a matching post-run host", () => {
    const host = { marker: "same-host" } as unknown as WindowsHostIdentity;
    const environment = createPromptEnvironmentIdentity({
      adapter: null,
      browser: null,
      browserDisplay: null,
      gate: { state: "measured", value: true },
      gpuDevices: [],
      host,
      hostAfterRuns: null,
      machine: { id: "descriptor-id" } as MachineDescriptor,
      profileLineage: freshLineage(),
      qualityTier: "showcase",
      requestedMachineId: "environment-id",
      runScript: "prompt-api-spike@1",
    });

    expect(environment.machineId).toBe("descriptor-id");
    expect(environment.targetDisplayMode).toBe("3840x2160@60Hz");
    expect(revalidateHostEnvironment(environment, { host, state: "measured" })).toMatchObject({
      gate: { state: "measured" },
      hostAfterRuns: host,
    });

    const fallback = createPromptEnvironmentIdentity({
      ...environment,
      hostAfterRuns: null,
      machine: null,
      requestedMachineId: "environment-id",
    });
    expect(fallback.machineId).toBe("environment-id");
  });
});

function immediateEvaluatePage(): Page {
  return {
    evaluate: async (
      callback: (input: { batchFrames: number; globalName: string }) => unknown,
      input: { batchFrames: number; globalName: string },
    ) => callback(input),
  } as unknown as Page;
}

function immediateInitScriptPage(): Page {
  return {
    addInitScript: async (callback: () => unknown) => callback(),
  } as unknown as Page;
}

function readInstalledCollectors(): RuntimeCollectors {
  const collectors = Reflect.get(globalThis, COLLECTOR_NAME) as {
    snapshot(): RuntimeCollectors;
  };
  return collectors.snapshot();
}

function readLongTaskCollector(): Readonly<{
  failureMessage: string | null;
  records: readonly Readonly<{ duration: number; startTime: number }>[];
}> {
  const collector = Reflect.get(globalThis, LONG_TASK_COLLECTOR_NAME) as {
    snapshot(): Readonly<{
      failureMessage: string | null;
      records: readonly Readonly<{ duration: number; startTime: number }>[];
    }>;
  };
  return collector.snapshot();
}

function runtimeSnapshot(
  state: PromptApiSpikeTelemetrySnapshot["state"],
  frameCount: number,
  recentFrames: readonly RenderFrameSample[],
): ParallaxTelemetrySnapshot {
  return {
    promptApiSpike: { state },
    render: { frameCount, recentFrames },
  } as unknown as ParallaxTelemetrySnapshot;
}

function frames(count: number, durationMs: number): RenderFrameSample[] {
  return Array.from({ length: count }, () => ({
    durationMs,
    presentIntervalMs: durationMs,
  }));
}

function completedPromptTelemetry(): PromptApiSpikeTelemetrySnapshot {
  return {
    download: {
      eventsObserved: 2,
      invalidEventsObserved: 0,
      invalidSamples: [],
      longestProgressGapMs: 1_000,
      maxProgress: 1,
      regressiveEventsObserved: 0,
      samples: [
        { elapsedMs: 0, loaded: 0 },
        { elapsedMs: 500, loaded: 0.5 },
        { elapsedMs: 1_000, loaded: 1 },
      ],
    },
    inference: { firstChunkLatencyMs: 100 },
    initialAvailability: "downloadable",
    state: "completed",
  } as unknown as PromptApiSpikeTelemetrySnapshot;
}

function freshLineage(): PromptApiProfileLineage {
  return {
    history: ["fresh"],
    id: "test-profile",
    profile: "fresh",
    schemaVersion: PROMPT_API_SPIKE_PROFILE_LINEAGE_SCHEMA_VERSION,
  };
}
