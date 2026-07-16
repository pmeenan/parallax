import {
  PROMPT_API_SPIKE_TELEMETRY_SCHEMA_VERSION,
  TELEMETRY_SCHEMA_VERSION,
} from "@parallax/engine";
import { describe, expect, it } from "vitest";
import {
  PROMPT_API_CHROME_LAUNCH_ARGS,
  PROMPT_API_IGNORED_PLAYWRIGHT_DEFAULT_ARGS,
  PROMPT_API_PRESERVED_DISABLED_FEATURES,
  validatePromptApiChromeCommandLine,
} from "../chrome-pin.js";
import {
  evaluatePromptApiBudgets,
  evaluatePromptApiCallbackPacing,
  evaluatePromptApiCallbackPacingDiagnostics,
  evaluatePromptApiDownloadEvidence,
  evaluatePromptApiRunPass,
  PROMPT_API_PROGRESS_STALL_TIMEOUT_MS,
  PROMPT_API_SPIKE_COMPLETION_TIMEOUT_MS,
  PROMPT_API_SPIKE_FIRST_TOKEN_LIMIT_MS,
  PROMPT_API_SPIKE_REPORT_SCHEMA_VERSION,
  PROMPT_API_SPIKE_SCENARIO,
  summarizePromptApiCallbackPacing,
  waitForPromptApiCompletion,
} from "./prompt-api-spike.js";

describe("prompt-api-spike@1 contract", () => {
  const completeDownload = Object.freeze({
    eventsObserved: 4,
    invalidEventsObserved: 0,
    invalidSamples: Object.freeze([]),
    longestProgressGapMs: 1_000,
    maxProgress: 1,
    regressiveEventsObserved: 0,
    samples: Object.freeze([
      Object.freeze({ elapsedMs: 0, loaded: 0 }),
      Object.freeze({ elapsedMs: 1_000, loaded: 0.5 }),
      Object.freeze({ elapsedMs: 2_000, loaded: 1 }),
    ]),
  });

  it("pins its scenario, report, telemetry, and completion contracts", () => {
    expect(PROMPT_API_SPIKE_SCENARIO).toBe("prompt-api-spike@1");
    expect(PROMPT_API_SPIKE_REPORT_SCHEMA_VERSION).toBe(6);
    expect(TELEMETRY_SCHEMA_VERSION).toBe(3);
    expect(PROMPT_API_SPIKE_TELEMETRY_SCHEMA_VERSION).toBe(3);
    expect(PROMPT_API_SPIKE_COMPLETION_TIMEOUT_MS).toBe(1_800_000);
    expect(PROMPT_API_PROGRESS_STALL_TIMEOUT_MS).toBe(120_000);
    expect(PROMPT_API_SPIKE_FIRST_TOKEN_LIMIT_MS).toBe(1_500);
  });

  it("preserves Chrome services required for Prompt API model delivery", () => {
    expect(PROMPT_API_IGNORED_PLAYWRIGHT_DEFAULT_ARGS).toContain("--disable-background-networking");
    expect(PROMPT_API_IGNORED_PLAYWRIGHT_DEFAULT_ARGS).toContain("--disable-component-update");
    expect(
      PROMPT_API_IGNORED_PLAYWRIGHT_DEFAULT_ARGS.some((value) =>
        value.includes("OptimizationHints"),
      ),
    ).toBe(true);
    expect(PROMPT_API_PRESERVED_DISABLED_FEATURES).toHaveLength(15);
    expect(PROMPT_API_PRESERVED_DISABLED_FEATURES).not.toContain("OptimizationHints");
    expect(PROMPT_API_CHROME_LAUNCH_ARGS[0]).toContain("PaintHolding");
    expect(PROMPT_API_CHROME_LAUNCH_ARGS[0]).toContain("RenderDocument");
    expect(PROMPT_API_CHROME_LAUNCH_ARGS).toContain("--enable-webgpu-developer-features");
  });

  it("validates the effective Prompt API Chrome command line and fails closed on drift", () => {
    const surgicalCommandLine = `chrome.exe ${PROMPT_API_CHROME_LAUNCH_ARGS.join(" ")}`;
    expect(validatePromptApiChromeCommandLine(surgicalCommandLine)).toMatchObject({
      modelDeliverySwitchesVerified: true,
      webGpuDeveloperFeaturesEnabled: true,
    });
    expect(() =>
      validatePromptApiChromeCommandLine(
        `${surgicalCommandLine} --disable-features=OptimizationHints,NewPlaywrightDefault`,
      ),
    ).toThrow(/OptimizationHints/);
    expect(() =>
      validatePromptApiChromeCommandLine(`${surgicalCommandLine} --disable-component-update`),
    ).toThrow(/disable-component-update/);
    expect(() =>
      validatePromptApiChromeCommandLine(surgicalCommandLine.replace("PaintHolding,", "")),
    ).toThrow(/PaintHolding/);
    expect(() =>
      validatePromptApiChromeCommandLine(
        surgicalCommandLine.replace(" --enable-webgpu-developer-features", ""),
      ),
    ).toThrow(/enable-webgpu-developer-features/);
  });

  it("passes the gating Prompt API budgets when both boundaries are satisfied", () => {
    const checks = evaluatePromptApiBudgets({
      firstChunkLatencyMs: 1_500,
      longTasksOver50Ms: 0,
    });

    expect(checks).toHaveLength(2);
    expect(checks.map((check) => check.passed)).toEqual([true, true]);
  });

  it("fails every gating Prompt API performance boundary independently", () => {
    const checks = evaluatePromptApiBudgets({
      firstChunkLatencyMs: 1_501,
      longTasksOver50Ms: 1,
    });

    expect(checks.map((check) => [check.metric, check.passed])).toEqual([
      ["dialogFirstTokenLatencyMs", false],
      ["mainThreadLongTasksOver50Ms", false],
    ]);
  });

  it("keeps only meaningful short-scenario callback-pacing diagnostics", () => {
    const pacing = summarizePromptApiCallbackPacing([...Array<number>(58).fill(16), 40]);
    expect(pacing).toMatchObject({
      max: 40,
      sampleCount: 59,
    });
    expect(
      evaluatePromptApiCallbackPacingDiagnostics(pacing, "showcase").map((check) => check.metric),
    ).toEqual([
      "promptGenerationCallbackIntervalP50Ms",
      "promptGenerationCallbackIntervalP95Ms",
      "promptGenerationCallbackIntervalMaxMs",
    ]);
  });

  it("passes complete evidence without making callback pacing a gate", () => {
    expect(
      evaluatePromptApiRunPass({
        budgetChecks: evaluatePromptApiBudgets({
          firstChunkLatencyMs: 1_500,
          longTasksOver50Ms: 0,
        }),
        concurrentSessionsMeasured: true,
        downloadMeasured: true,
        environmentMeasured: true,
        errorCount: 0,
        firstTokenMeasured: true,
        longTasksMeasured: true,
        modelComponentMeasured: true,
        offlineMeasured: true,
        offlinePromptSucceeded: true,
        telemetryCompleted: true,
      }),
    ).toBe(true);
  });

  const passingRun = Object.freeze({
    budgetChecks: Object.freeze([{ actual: 0, limit: 0, metric: "test", passed: true }]),
    concurrentSessionsMeasured: true,
    downloadMeasured: true,
    environmentMeasured: true,
    errorCount: 0,
    firstTokenMeasured: true,
    longTasksMeasured: true,
    modelComponentMeasured: true,
    offlineMeasured: true,
    offlinePromptSucceeded: true,
    telemetryCompleted: true,
  });

  it.each([
    ["environment evidence", { environmentMeasured: false }],
    ["download evidence", { downloadMeasured: false }],
    ["first-token evidence", { firstTokenMeasured: false }],
    ["long-task evidence", { longTasksMeasured: false }],
    ["at least one budget check", { budgetChecks: [] }],
    [
      "every budget check passing",
      { budgetChecks: [{ actual: 1, limit: 0, metric: "test", passed: false }] },
    ],
    ["model-component evidence", { modelComponentMeasured: false }],
    ["completed telemetry", { telemetryCompleted: false }],
    ["concurrent-session evidence", { concurrentSessionsMeasured: false }],
    ["offline evidence", { offlineMeasured: false }],
    ["successful offline prompt", { offlinePromptSucceeded: false }],
    ["zero runner errors", { errorCount: 1 }],
  ])("fails when %s is the only missing pass condition", (_label, override) => {
    expect(evaluatePromptApiRunPass({ ...passingRun, ...override })).toBe(false);
  });

  it("fails closed when Prompt API availability prevents runtime evidence", () => {
    expect(
      evaluatePromptApiRunPass({
        budgetChecks: [],
        concurrentSessionsMeasured: false,
        downloadMeasured: false,
        environmentMeasured: true,
        errorCount: 0,
        firstTokenMeasured: false,
        longTasksMeasured: true,
        modelComponentMeasured: false,
        offlineMeasured: false,
        offlinePromptSucceeded: false,
        telemetryCompleted: false,
      }),
    ).toBe(false);
  });

  it("requires fresh-profile normalized download evidence", () => {
    expect(
      evaluatePromptApiDownloadEvidence({
        download: completeDownload,
        initialAvailability: "downloadable",
        profile: "fresh",
      }).state,
    ).toBe("measured");
    expect(
      evaluatePromptApiDownloadEvidence({
        download: completeDownload,
        initialAvailability: "available",
        profile: "fresh",
      }).state,
    ).toBe("invalid");
  });

  it("fails download evidence that violates the normalized progress contract", () => {
    expect(
      evaluatePromptApiDownloadEvidence({
        download: {
          ...completeDownload,
          invalidEventsObserved: 1,
          invalidSamples: [{ type: "number", value: "4269934835" }],
        },
        initialAvailability: "downloadable",
        profile: "fresh",
      }).state,
    ).toBe("invalid");
  });

  it("requires both normalized download endpoints", () => {
    for (const samples of [
      [0.01, 0.5, 1],
      [0, 0.5, 0.99],
    ]) {
      expect(
        evaluatePromptApiDownloadEvidence({
          download: {
            ...completeDownload,
            samples: samples.map((loaded, index) => ({ elapsedMs: index * 1_000, loaded })),
          },
          initialAvailability: "downloadable",
          profile: "fresh",
        }).state,
      ).toBe("invalid");
    }
  });

  it("requires at least two observed progress events", () => {
    expect(
      evaluatePromptApiDownloadEvidence({
        download: { ...completeDownload, eventsObserved: 1 },
        initialAvailability: "downloadable",
        profile: "fresh",
      }).state,
    ).toBe("invalid");
  });

  it("requires intermediate, monotonic, live progress", () => {
    expect(
      evaluatePromptApiDownloadEvidence({
        download: {
          ...completeDownload,
          samples: [
            { elapsedMs: 0, loaded: 0 },
            { elapsedMs: 1_000, loaded: 1 },
          ],
        },
        initialAvailability: "downloadable",
        profile: "fresh",
      }),
    ).toMatchObject({ reason: expect.stringContaining("intermediate"), state: "invalid" });
    expect(
      evaluatePromptApiDownloadEvidence({
        download: { ...completeDownload, regressiveEventsObserved: 1 },
        initialAvailability: "downloadable",
        profile: "fresh",
      }),
    ).toMatchObject({ reason: expect.stringContaining("regressed"), state: "invalid" });
    expect(
      evaluatePromptApiDownloadEvidence({
        download: {
          ...completeDownload,
          longestProgressGapMs: PROMPT_API_PROGRESS_STALL_TIMEOUT_MS,
        },
        initialAvailability: "downloadable",
        profile: "fresh",
      }),
    ).toMatchObject({ reason: expect.stringContaining("stalled"), state: "invalid" });
  });

  it("aborts a silent download at the progress-stall threshold", async () => {
    let clock = 0;
    let reads = 0;
    const result = await waitForPromptApiCompletion(
      async () => {
        reads += 1;
        return progressSnapshot("creating", null, 0);
      },
      {
        completionTimeoutMs: 10_000,
        now: () => clock,
        pollIntervalMs: 1_000,
        progressStallTimeoutMs: 2_000,
        sleep: async (delayMs) => {
          clock += delayMs;
        },
      },
    );

    expect(reads).toBe(3);
    expect(result.failureMessage).toContain("no forward progress for 2000 ms");
  });

  it("does not let duplicate progress events mask a stalled download", async () => {
    let clock = 0;
    const result = await waitForPromptApiCompletion(
      async () => progressSnapshot("creating", 0.25, 50),
      {
        completionTimeoutMs: 10_000,
        now: () => clock,
        pollIntervalMs: 1_000,
        progressStallTimeoutMs: 2_000,
        sleep: async (delayMs) => {
          clock += delayMs;
        },
      },
    );

    expect(result.failureMessage).toContain("last observed progress 0.2500");
  });

  it("keeps the completion ceiling while forward progress remains live", async () => {
    let clock = 0;
    let index = 0;
    const snapshots = [
      progressSnapshot("creating", null, 0),
      progressSnapshot("creating", 0.1, 2),
      progressSnapshot("creating", 0.2, 3),
      progressSnapshot("completed", 1, 4),
    ];
    const result = await waitForPromptApiCompletion(
      async () => {
        const snapshot = snapshots[Math.min(index++, snapshots.length - 1)];
        if (snapshot === undefined) throw new Error("Progress snapshot fixture is empty");
        return snapshot;
      },
      {
        completionTimeoutMs: 10_000,
        now: () => clock,
        pollIntervalMs: 1_000,
        progressStallTimeoutMs: 1_500,
        sleep: async (delayMs) => {
          clock += delayMs;
        },
      },
    );

    expect(result.failureMessage).toBeNull();
    expect(result.snapshot.state).toBe("completed");
  });

  it("rejects first-download evidence from a warm profile at runtime", () => {
    expect(
      evaluatePromptApiDownloadEvidence({
        download: completeDownload,
        initialAvailability: "downloadable",
        profile: "warm",
      }),
    ).toMatchObject({ reason: expect.stringContaining("fresh"), state: "invalid" });
  });

  it("requires enough marker-aligned callbacks to describe a distribution", () => {
    expect(evaluatePromptApiCallbackPacing(Array<number>(29).fill(16), null)).toMatchObject({
      reason: expect.stringContaining("30"),
      state: "invalid",
    });
    expect(evaluatePromptApiCallbackPacing(Array<number>(30).fill(16), null)).toMatchObject({
      state: "measured",
      value: { sampleCount: 30 },
    });
    expect(evaluatePromptApiCallbackPacing(Array<number>(30).fill(16), "retention loss")).toEqual({
      reason: "retention loss",
      state: "invalid",
    });
  });
});

function progressSnapshot(
  state: "creating" | "completed",
  maxProgress: number | null,
  eventsObserved: number,
): import("@parallax/engine").PromptApiSpikeTelemetrySnapshot {
  return {
    download: {
      eventsObserved,
      invalidEventsObserved: 0,
      invalidSamples: [],
      longestProgressGapMs: 0,
      maxProgress,
      regressiveEventsObserved: 0,
      samples: [],
    },
    state,
  } as unknown as import("@parallax/engine").PromptApiSpikeTelemetrySnapshot;
}
