import type { PromptApiSpikeTelemetrySnapshot } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import {
  evaluatePromptApiBrandedDownload,
  PROMPT_API_BRANDED_REPORT_SCHEMA_VERSION,
  PROMPT_API_BRANDED_SCENARIO,
  waitForPromptApiRestartPoint,
} from "./prompt-api-branded.js";

describe("prompt-api-branded@1 contract", () => {
  it("pins the scenario and result schema", () => {
    expect(PROMPT_API_BRANDED_SCENARIO).toBe("prompt-api-branded@1");
    expect(PROMPT_API_BRANDED_REPORT_SCHEMA_VERSION).toBe(2);
  });

  it("waits for actionable intermediate progress before requesting restart", async () => {
    let clock = 0;
    let index = 0;
    const snapshots = [snapshot("creating", [0]), snapshot("creating", [0, 0.2])];
    const fallback = snapshots[0];
    if (fallback === undefined) throw new Error("Prompt progress fixture is empty");
    const result = await waitForPromptApiRestartPoint(
      async () => snapshots[Math.min(index++, snapshots.length - 1)] ?? fallback,
      {
        now: () => clock,
        pollIntervalMs: 1_000,
        sleep: async (delayMs) => {
          clock += delayMs;
        },
      },
    );

    expect(result).toMatchObject({ failureMessage: null, readyForRestart: true });
  });

  it("does not request restart after download progress has already reached one", async () => {
    let clock = 0;
    let index = 0;
    const snapshots = [snapshot("creating", [0, 0.2, 1]), snapshot("completed", [0, 0.2, 1])];
    const fallback = snapshots[0];
    if (fallback === undefined) throw new Error("Prompt progress fixture is empty");
    const result = await waitForPromptApiRestartPoint(
      async () => snapshots[Math.min(index++, snapshots.length - 1)] ?? fallback,
      {
        now: () => clock,
        pollIntervalMs: 1_000,
        sleep: async (delayMs) => {
          clock += delayMs;
        },
      },
    );

    expect(result.readyForRestart).toBe(false);
    expect(result.failureMessage).toContain("completed before the restart/resume boundary");
  });

  it("fails restart qualification when progress never starts", async () => {
    let clock = 0;
    const result = await waitForPromptApiRestartPoint(async () => snapshot("creating", []), {
      now: () => clock,
      pollIntervalMs: 1_000,
      progressStallTimeoutMs: 2_000,
      sleep: async (delayMs) => {
        clock += delayMs;
      },
    });

    expect(result.readyForRestart).toBe(false);
    expect(result.failureMessage).toContain("no forward progress for 2000 ms");
  });

  it("does not mislabel post-download session probing as a download stall", async () => {
    let clock = 0;
    const result = await waitForPromptApiRestartPoint(
      async () => snapshot("probing-sessions", [1]),
      {
        completionTimeoutMs: 3_000,
        now: () => clock,
        pollIntervalMs: 1_000,
        progressStallTimeoutMs: 2_000,
        sleep: async (delayMs) => {
          clock += delayMs;
        },
      },
    );

    expect(result.readyForRestart).toBe(false);
    expect(result.failureMessage).toContain("did not reach an intermediate progress update");
  });

  it("accepts uninterrupted and restart/resume progress as distinct monotonic segments", () => {
    const uninterrupted = evaluatePromptApiBrandedDownload("uninterrupted", [
      segment(1_000, "completed", [0, 0.4, 1]),
    ]);
    const resumed = evaluatePromptApiBrandedDownload("restart-resume", [
      segment(1_000, "interrupted-for-restart", [0, 0.35]),
      segment(5_000, "completed", [0, 0.7, 1]),
    ]);

    expect(uninterrupted.state).toBe("measured");
    expect(resumed).toMatchObject({
      state: "measured",
      value: { downloadDurationMs: 6_000, restartCount: 1 },
    });
  });

  it("rejects endpoint-only and non-interrupted restart evidence", () => {
    expect(
      evaluatePromptApiBrandedDownload("uninterrupted", [segment(0, "completed", [0, 1])]),
    ).toMatchObject({ reason: expect.stringContaining("intermediate"), state: "invalid" });
    expect(
      evaluatePromptApiBrandedDownload("restart-resume", [
        segment(0, "completed", [0, 0.2]),
        segment(1_000, "completed", [0.2, 1]),
      ]),
    ).toMatchObject({ reason: expect.stringContaining("not interrupted"), state: "invalid" });
    expect(
      evaluatePromptApiBrandedDownload("restart-resume", [
        segment(0, "interrupted-for-restart", [0, 0.2, 1]),
        segment(1_000, "completed", [0, 0.4, 1]),
      ]),
    ).toMatchObject({ reason: expect.stringContaining("strictly between"), state: "invalid" });
  });

  it("records the unobservable restart interval without treating it as no-progress", () => {
    expect(
      evaluatePromptApiBrandedDownload("restart-resume", [
        segment(0, "interrupted-for-restart", [0, 0.2]),
        segment(120_000, "completed", [0, 0.3, 1]),
      ]),
    ).toMatchObject({
      state: "measured",
      value: { restartObservationGapMs: 119_000 },
    });
  });

  it("compares restart liveness to the resumed phase baseline, not the prior fraction", () => {
    const resumed = segment(
      10_000,
      "completed",
      [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
    );
    const telemetry = {
      ...resumed.telemetry,
      download: {
        ...resumed.telemetry.download,
        longestProgressGapMs: 15_000,
        samples: resumed.telemetry.download.samples.map((sample, index) => ({
          ...sample,
          elapsedMs: index * 15_000,
        })),
      },
    };
    expect(
      evaluatePromptApiBrandedDownload("restart-resume", [
        segment(0, "interrupted-for-restart", [0, 0.8]),
        { ...resumed, telemetry },
      ]),
    ).toMatchObject({ state: "measured" });
  });

  it("accepts a resumed phase whose first retained sample is already complete", () => {
    expect(
      evaluatePromptApiBrandedDownload("restart-resume", [
        segment(0, "interrupted-for-restart", [0, 0.2]),
        segment(30_000, "completed", [1]),
      ]),
    ).toMatchObject({
      state: "measured",
      value: { restartObservationGapMs: 29_000 },
    });
  });

  it("uses engine forward-progress timing rather than retained-sample spacing", () => {
    const completed = segment(0, "completed", [0, 0.5, 1]);
    const telemetry = {
      ...completed.telemetry,
      download: {
        ...completed.telemetry.download,
        longestProgressGapMs: 17_000,
        samples: completed.telemetry.download.samples.map((sample, index) => ({
          ...sample,
          elapsedMs: index * 60_000,
        })),
      },
    };

    expect(
      evaluatePromptApiBrandedDownload("uninterrupted", [{ ...completed, telemetry }]),
    ).toMatchObject({
      state: "measured",
      value: { longestInProcessProgressGapMs: 17_000 },
    });
  });
});

function segment(
  activatedAtEpochMs: number,
  outcome: "completed" | "interrupted-for-restart",
  progress: readonly number[],
) {
  return {
    activatedAtEpochMs,
    initialAvailability: "downloadable" as const,
    outcome,
    telemetry: snapshot(outcome === "completed" ? "completed" : "creating", progress),
  };
}

function snapshot(
  state: "creating" | "completed" | "probing-sessions",
  progress: readonly number[],
): PromptApiSpikeTelemetrySnapshot {
  return {
    concurrentSessions:
      state === "completed" ? { attempted: 1, created: 1, failureMessage: null, target: 1 } : null,
    download: {
      eventsObserved: progress.length,
      invalidEventsObserved: 0,
      invalidSamples: [],
      longestProgressGapMs: progress.length > 1 ? 1_000 : 0,
      maxProgress: progress.at(-1) ?? null,
      regressiveEventsObserved: 0,
      samples: progress.map((loaded, index) => ({ elapsedMs: index * 1_000, loaded })),
    },
    executionContexts: {
      dedicatedWorker: { exposed: false, failureMessage: null, state: "measured" },
      windowExposed: true,
    },
    failureMessage: null,
    inference:
      state === "completed"
        ? {
            chunks: 1,
            contextUsageAfter: 1,
            contextUsageBefore: 0,
            contextWindow: 1_024,
            firstChunkLatencyMs: 100,
            fixtureContextUsage: 1,
            outputCharacters: 10,
            totalLatencyMs: 200,
          }
        : null,
    initialAvailability: "downloadable",
    offline: {
      availability: null,
      failureMessage: null,
      promptSucceeded: null,
      state: "not-run",
    },
    schemaVersion: 3,
    state,
    userActivationAtCreate: true,
  };
}
