import type { BenchmarkReport } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import {
  formatM1BenchmarkPreset,
  formatM1BenchmarkReport,
  formatM1BenchmarkStatus,
  M1_BENCHMARK_DEFINITION,
} from "../src/benchmark/m1-benchmark-mode";

describe("M1 benchmark mode", () => {
  it("owns the canonical fixed-seed route and two explicit quality presets", () => {
    expect(M1_BENCHMARK_DEFINITION).toMatchObject({
      id: "m1-benchmark@1",
      repeatCount: 3,
      scenario: {
        durationMs: 600_000,
        id: "flythrough-d1@1",
      },
    });
    expect(M1_BENCHMARK_DEFINITION.qualityPresets.map(formatM1BenchmarkPreset)).toEqual([
      "Showcase · 3840×2160 · 60 Hz target",
      "Standard · 2560×1440 · 120 Hz target",
    ]);
    expect(M1_BENCHMARK_DEFINITION.worldSeed).toBeGreaterThan(0);
  });

  it("renders advisory and unsupported evidence without turning it into a pass", () => {
    const report = {
      artifactDigest: { state: "measured", value: "a".repeat(64) },
      attempts: [],
      checks: [
        {
          actual: 300,
          limit: 250,
          metric: "repeat 1 streamingCellLoadP95Ms",
          passed: false,
          state: "measured",
        },
      ],
      definitionId: "m1-benchmark@1",
      environmentComparisonPolicy: {
        excludedRecordedFields: ["screen.viewportCssPixels"],
        id: "fixed-worker-render-pixels@1",
      },
      environmentCaptures: [],
      facets: {
        budgetEvaluation: { reasons: ["unsupported"], status: "not-evaluated" },
        referenceEligibility: { reasons: ["page unavailable"], status: "not-evaluated" },
        scenarioEvidence: { reasons: [], status: "passed" },
      },
      generatedAt: "2026-07-25T00:00:00.000Z",
      metricStates: {
        allRealmJsHeap: "unsupported",
        attributableGpuMemory: "unsupported",
        dawnPipelineActivity: "unsupported",
        mainThreadLongTasks: "measured",
        presentationIntervals: "unsupported",
        renderWorkerCallbackIntervals: "measured",
        renderWorkerDurations: "measured",
        streamingCellLoads: "measured",
        workerLongTasks: "unsupported",
      },
      preset: M1_BENCHMARK_DEFINITION.qualityPresets[0],
      provenance: {
        invocation: "manual-or-automation-equivalent",
        launcherCollectorTimings: "not-applicable",
        measurementOwner: "in-game",
      },
      repeatPolicy: { count: 3, lineage: "continuous-page", resetBetweenRepeats: true },
      resultContract: "benchmark-result@1",
      scenario: "flythrough-d1@1",
      scenarioContract: M1_BENCHMARK_DEFINITION.scenario,
      schemaVersion: 3,
      verdict: {
        kind: "advisory",
        label: "Google Chrome advisory result",
        passed: null,
        reasons: ["Reference-machine eligibility is not established in-game"],
      },
      warmupPolicy: {
        checkpointCount: 6,
        kind: "streamed-checkpoint-preflight-plus-fixed-stabilization",
        stabilizationMs: 10_000,
      },
      worldSeed: M1_BENCHMARK_DEFINITION.worldSeed,
    } as unknown as BenchmarkReport;

    const text = formatM1BenchmarkReport(report);
    expect(text).toContain("Google Chrome advisory result");
    expect(text).toContain("allRealmJsHeap: unsupported");
    expect(text).toContain("Budget evaluation: **not-evaluated**");
    expect(text).toContain("repeat 1 streamingCellLoadP95Ms: **failed**");
    expect(text).toContain("budgetEvaluation: unsupported");
    expect(text).toContain(
      "recorded diagnostic excluded from equality: `screen.viewportCssPixels`",
    );
    expect(
      formatM1BenchmarkStatus({
        activeRepeat: null,
        completedRepeats: 3,
        failureMessage: null,
        presetId: report.preset.id,
        progress: 1,
        report,
        schemaVersion: 2,
        state: "completed",
      }),
    ).toContain("advisory");
  });
});
