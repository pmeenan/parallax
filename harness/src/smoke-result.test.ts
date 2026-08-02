import { describe, expect, it } from "vitest";
import { invalidEnvironmentGate } from "./environment.js";
import { evaluateResultFacets } from "./result-facets.js";
import type { LocalServerMetrics } from "./server.js";
import {
  collectSmokeBudgetFacetChecks,
  collectSmokeEnvironmentFacetInput,
  collectSmokeEvidenceChecks,
  collectSmokeInformationalFailures,
  formatSmokeFacetSummary,
} from "./smoke-result.js";

const measuredEnvironment = collectSmokeEnvironmentFacetInput({ state: "measured", value: true });

const completedCoreRuns = { completedRuns: 6, expectedRuns: 6, failure: null };

function httpDelta(overrides: Partial<LocalServerMetrics> = {}): {
  readonly state: "measured";
  readonly value: LocalServerMetrics;
} {
  return {
    state: "measured",
    value: {
      bytesServed: 1_024,
      bytesServedByPathClass: { document: 512, immutable: 512, other: 0 },
      metadataCacheHits: 0,
      metadataCacheMisses: 2,
      pathClasses: { document: 1, immutable: 1, other: 0 },
      requests: 2,
      schemaVersion: 2,
      statuses: { "200": 2 },
      statusesByPathClass: { document: { "200": 1 }, immutable: { "200": 1 }, other: {} },
      ...overrides,
    },
  };
}

describe("smoke result adapters", () => {
  it("keeps presentation, GPU-memory, and V8 evidence failures informational", () => {
    const evidenceChecks = collectSmokeEvidenceChecks({
      callbackPacingVariance: [{ profile: "fresh", state: "measured" }],
      coreRunCompletion: completedCoreRuns,
      incompleteMetrics: [
        {
          mandatoryForHarnessV1: false,
          metric: "compositor presentation interval",
          reason: "scan-out success is unobservable",
          state: "invalid",
        },
      ],
      reportFinalization: { state: "measured" },
      runs: [
        {
          dawnPipeline: { state: "measured" },
          greyboxWorld: { state: "measured" },
          gpuMemory: { reason: "no page-attributed resident total", state: "unsupported" },
          http: httpDelta(),
          jsHeap: { state: "measured" },
          profile: "fresh",
          psoWarmup: { state: "measured" },
          repeat: 1,
          sabRingBuffer: { state: "measured" },
          streaming: { state: "measured" },
          wasmThreads: { state: "measured" },
        },
      ],
      streamingCellLoadP95Variance: [{ profile: "fresh", state: "measured" }],
      v8CodeCacheDiagnostics: [
        {
          production: { reason: "worker production is unobservable", state: "invalid" },
          profile: "warm",
          repeat: 1,
          v8CodeCache: { reason: "consumption is unobservable", state: "invalid" },
        },
      ],
      vizPresentationFeedbackCallbackVariance: [
        { profile: "fresh", reason: "trace completion timed out", state: "invalid" },
      ],
    });
    const facets = evaluateResultFacets({
      budgetChecks: [{ description: "long-task budget", passed: true }],
      environment: measuredEnvironment,
      evidenceChecks,
    });

    expect(
      evidenceChecks.find((check) => check.description.includes("presentation-feedback")),
    ).toMatchObject({ mandatory: false, measured: false });
    expect(
      evidenceChecks.find((check) => check.description.includes("all-worker JS heap")),
    ).toEqual(expect.objectContaining({ mandatory: true, measured: true }));
    expect(
      evidenceChecks.find((check) => check.description.includes("attributable GPU memory")),
    ).toEqual(expect.objectContaining({ mandatory: false, measured: false }));
    expect(facets.evidenceCompleteness.status).toBe("passed");
    expect(facets.budgetEvaluation.status).toBe("passed");
    expect(
      collectSmokeInformationalFailures({
        evidenceChecks,
        v8CodeCacheDiagnostics: [],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("compositor presentation interval"),
        expect.stringContaining("code-cache production invalid"),
        expect.stringContaining("V8 code-cache evidence invalid"),
        expect.stringContaining("attributable GPU memory unsupported"),
        expect.stringContaining("presentation-feedback variance"),
      ]),
    );
  });

  it("derives every evidence-check mandatory flag from the metric registry", () => {
    const evidenceChecks = collectSmokeEvidenceChecks({
      callbackPacingVariance: [{ profile: "fresh", state: "measured" }],
      coreRunCompletion: completedCoreRuns,
      incompleteMetrics: [],
      reportFinalization: { state: "measured" },
      runs: [
        {
          dawnPipeline: { state: "measured" },
          greyboxWorld: { state: "measured" },
          gpuMemory: { state: "measured" },
          http: httpDelta(),
          jsHeap: { state: "measured" },
          profile: "fresh",
          psoWarmup: { state: "measured" },
          repeat: 1,
          sabRingBuffer: { state: "measured" },
          streaming: { state: "measured" },
          wasmThreads: { state: "measured" },
        },
      ],
      streamingCellLoadP95Variance: [{ profile: "fresh", state: "measured" }],
      v8CodeCacheDiagnostics: [],
      vizPresentationFeedbackCallbackVariance: [{ profile: "fresh", state: "measured" }],
    });

    expect(
      evidenceChecks.find((check) => check.description.includes("callback pacing variance")),
    ).toMatchObject({ mandatory: true, measured: true });
    expect(
      evidenceChecks.find((check) => check.description.includes("report finalization")),
    ).toMatchObject({ mandatory: true, measured: true });
    expect(
      evidenceChecks.find((check) =>
        check.description.includes("streaming cell-load p95 variance"),
      ),
    ).toMatchObject({ mandatory: false, measured: true });
    expect(
      evidenceChecks.find((check) => check.description.includes("core measurement runs completed")),
    ).toMatchObject({ mandatory: true, measured: true });
    for (const check of evidenceChecks.filter(
      (candidate) =>
        candidate.description.includes("HTTP") || candidate.description.includes("immutable"),
    )) {
      expect(check.mandatory).toBe(false);
    }
  });

  it("keeps over-1ms short-smoke streaming repeatability diagnostic while all facets and 30 checks pass", () => {
    const evidenceChecks = collectSmokeEvidenceChecks({
      callbackPacingVariance: [{ profile: "fresh", state: "measured" }],
      coreRunCompletion: completedCoreRuns,
      incompleteMetrics: [],
      reportFinalization: { state: "measured" },
      runs: [],
      streamingCellLoadP95Variance: [
        {
          profile: "fresh",
          reason: "streaming cell-load p95 absolute range 1.15 exceeds the allowed 1",
          state: "invalid",
        },
      ],
      v8CodeCacheDiagnostics: [],
      vizPresentationFeedbackCallbackVariance: [],
    });
    const facets = evaluateResultFacets({
      budgetChecks: Array.from({ length: 30 }, (_, index) => ({
        description: `budget check ${index + 1}`,
        passed: true,
      })),
      environment: measuredEnvironment,
      evidenceChecks,
    });

    expect(
      evidenceChecks.find((check) =>
        check.description.includes("streaming cell-load p95 variance"),
      ),
    ).toMatchObject({ mandatory: false, measured: false });
    expect(
      collectSmokeInformationalFailures({ evidenceChecks, v8CodeCacheDiagnostics: [] }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("streaming cell-load p95 absolute range 1.15"),
      ]),
    );
    expect(facets).toMatchObject({
      budgetEvaluation: { evaluatedChecks: 30, status: "passed" },
      environment: { status: "passed" },
      evidenceCompleteness: { status: "passed" },
    });
  });

  it.each([
    "streaming cell-load p95 is missing",
    "streaming cell-load p95 is non-finite",
  ])("still fails mandatory evidence when a per-launch streaming metric is invalid: %s", (reason) => {
    const evidenceChecks = collectSmokeEvidenceChecks({
      callbackPacingVariance: [],
      coreRunCompletion: completedCoreRuns,
      incompleteMetrics: [],
      reportFinalization: { state: "measured" },
      runs: [
        {
          dawnPipeline: { state: "measured" },
          greyboxWorld: { state: "measured" },
          gpuMemory: { state: "measured" },
          http: httpDelta(),
          jsHeap: { state: "measured" },
          profile: "fresh",
          psoWarmup: { state: "measured" },
          repeat: 1,
          sabRingBuffer: { state: "measured" },
          streaming: { reason, state: "invalid" },
          wasmThreads: { state: "measured" },
        },
      ],
      streamingCellLoadP95Variance: [
        { profile: "fresh", reason: "diagnostic cohort is incomplete", state: "invalid" },
      ],
      v8CodeCacheDiagnostics: [],
      vizPresentationFeedbackCallbackVariance: [],
    });
    const facets = evaluateResultFacets({
      budgetChecks: Array.from({ length: 30 }, (_, index) => ({
        description: `budget check ${index + 1}`,
        passed: true,
      })),
      environment: measuredEnvironment,
      evidenceChecks,
    });

    expect(
      evidenceChecks.find((check) => check.description.includes("world streaming pipeline")),
    ).toMatchObject({ mandatory: true, measured: false });
    expect(facets.evidenceCompleteness.status).toBe("failed");
    expect(facets.budgetEvaluation).toMatchObject({
      evaluatedChecks: 30,
      status: "not-evaluated",
    });
  });

  it("still fails the unchanged 250ms per-launch streaming budget", () => {
    const evidenceChecks = collectSmokeEvidenceChecks({
      callbackPacingVariance: [],
      coreRunCompletion: completedCoreRuns,
      incompleteMetrics: [],
      reportFinalization: { state: "measured" },
      runs: [],
      streamingCellLoadP95Variance: [
        { profile: "fresh", reason: "diagnostic range exceeds 1ms", state: "invalid" },
      ],
      v8CodeCacheDiagnostics: [],
      vizPresentationFeedbackCallbackVariance: [],
    });
    const budgetChecks = collectSmokeBudgetFacetChecks({
      runs: [
        {
          budgetChecks: [
            ...Array.from({ length: 29 }, (_, index) => ({
              actual: 0,
              limit: 1,
              metric: `passingBudget${index + 1}`,
              passed: true,
            })),
            {
              actual: 251,
              limit: 250,
              metric: "streamingCellLoadP95Ms",
              passed: false,
            },
          ],
          profile: "fresh",
          repeat: 1,
        },
      ],
    });
    const facets = evaluateResultFacets({
      budgetChecks,
      environment: measuredEnvironment,
      evidenceChecks,
    });

    expect(facets.evidenceCompleteness.status).toBe("passed");
    expect(facets.budgetEvaluation).toMatchObject({
      evaluatedChecks: 30,
      reasons: ["fresh repeat 1: streamingCellLoadP95Ms 251 > 250"],
      status: "failed",
    });
  });

  it("fails the mandatory core-run-completion check when core runs are incomplete", () => {
    const evidenceChecks = collectSmokeEvidenceChecks({
      callbackPacingVariance: [
        { profile: "fresh", state: "measured" },
        { profile: "warm", reason: "No completed warm core measurement runs", state: "invalid" },
      ],
      coreRunCompletion: {
        completedRuns: 3,
        expectedRuns: 6,
        failure: "core warm repeat 2 failed: Browser errors: boom",
      },
      incompleteMetrics: [],
      reportFinalization: { state: "measured" },
      runs: [
        {
          dawnPipeline: { state: "measured" },
          greyboxWorld: { state: "measured" },
          gpuMemory: { state: "measured" },
          http: httpDelta(),
          jsHeap: { state: "measured" },
          profile: "fresh",
          psoWarmup: { state: "measured" },
          repeat: 1,
          sabRingBuffer: { state: "measured" },
          streaming: { state: "measured" },
          wasmThreads: { state: "measured" },
        },
      ],
      streamingCellLoadP95Variance: [
        { profile: "fresh", state: "measured" },
        { profile: "warm", reason: "No completed warm core measurement runs", state: "invalid" },
      ],
      v8CodeCacheDiagnostics: [],
      vizPresentationFeedbackCallbackVariance: [{ profile: "fresh", state: "measured" }],
    });
    const facets = evaluateResultFacets({
      budgetChecks: [{ description: "long-task budget", passed: true }],
      environment: measuredEnvironment,
      evidenceChecks,
    });

    const completionCheck = evidenceChecks.find((check) =>
      check.description.includes("core measurement runs completed"),
    );
    expect(completionCheck).toMatchObject({ mandatory: true, measured: false });
    expect(completionCheck?.description).toBe(
      "core measurement runs completed (3 of 6) — core warm repeat 2 failed: Browser errors: boom",
    );
    expect(facets.evidenceCompleteness.status).toBe("failed");
    expect(facets.budgetEvaluation.status).toBe("not-evaluated");
  });

  it("keeps HTTP serving discipline misses informational", () => {
    const evidenceChecks = collectSmokeEvidenceChecks({
      callbackPacingVariance: [{ profile: "warm", state: "measured" }],
      coreRunCompletion: completedCoreRuns,
      incompleteMetrics: [],
      reportFinalization: { state: "measured" },
      runs: [
        {
          dawnPipeline: { state: "measured" },
          greyboxWorld: { state: "measured" },
          gpuMemory: { state: "measured" },
          http: httpDelta({
            pathClasses: { document: 1, immutable: 2, other: 0 },
            requests: 3,
            statuses: { "200": 3 },
            statusesByPathClass: { document: { "200": 1 }, immutable: { "200": 2 }, other: {} },
          }),
          jsHeap: { state: "measured" },
          profile: "warm",
          psoWarmup: { state: "measured" },
          repeat: 1,
          sabRingBuffer: { state: "measured" },
          streaming: { state: "measured" },
          wasmThreads: { state: "measured" },
        },
      ],
      streamingCellLoadP95Variance: [{ profile: "warm", state: "measured" }],
      v8CodeCacheDiagnostics: [],
      vizPresentationFeedbackCallbackVariance: [{ profile: "warm", state: "measured" }],
    });
    const facets = evaluateResultFacets({
      budgetChecks: [{ description: "long-task budget", passed: true }],
      environment: measuredEnvironment,
      evidenceChecks,
    });
    const informationalFailures = collectSmokeInformationalFailures({
      evidenceChecks,
      v8CodeCacheDiagnostics: [],
    });

    expect(facets.evidenceCompleteness.status).toBe("passed");
    expect(facets.budgetEvaluation.status).toBe("passed");
    expect(informationalFailures).toEqual(
      expect.arrayContaining([
        expect.stringContaining("immutable requests reaching the server expected zero"),
        expect.stringContaining("expected to revalidate via 304"),
      ]),
    );
  });

  it("preserves invalid environment state even when its reason list is empty", () => {
    const environment = collectSmokeEnvironmentFacetInput(invalidEnvironmentGate([]));
    const facets = evaluateResultFacets({
      budgetChecks: [{ description: "long-task budget", passed: true }],
      environment,
      evidenceChecks: [],
    });

    expect(environment).toEqual({ failures: [], measured: false });
    expect(facets.environment.status).toBe("failed");
    expect(facets.environment.reasons[0]).toContain("no reason was supplied");
  });

  it("fails closed when mandatory all-worker JS heap evidence is invalid", () => {
    const evidenceChecks = collectSmokeEvidenceChecks({
      callbackPacingVariance: [{ profile: "fresh", state: "measured" }],
      coreRunCompletion: completedCoreRuns,
      incompleteMetrics: [],
      reportFinalization: { state: "measured" },
      runs: [
        {
          dawnPipeline: { state: "measured" },
          greyboxWorld: { state: "measured" },
          gpuMemory: { reason: "no page-attributed resident total", state: "unsupported" },
          http: httpDelta(),
          jsHeap: { reason: "worker target disappeared", state: "invalid" },
          profile: "fresh",
          psoWarmup: { state: "measured" },
          repeat: 1,
          sabRingBuffer: { state: "measured" },
          streaming: { state: "measured" },
          wasmThreads: { state: "measured" },
        },
      ],
      streamingCellLoadP95Variance: [{ profile: "fresh", state: "measured" }],
      v8CodeCacheDiagnostics: [
        {
          production: { state: "measured" },
          profile: "warm",
          repeat: 1,
          v8CodeCache: { state: "measured" },
        },
      ],
      vizPresentationFeedbackCallbackVariance: [{ profile: "fresh", state: "measured" }],
    });
    const facets = evaluateResultFacets({
      budgetChecks: [{ description: "observed checks passed", passed: true }],
      environment: measuredEnvironment,
      evidenceChecks,
    });

    expect(facets.evidenceCompleteness.status).toBe("failed");
    expect(facets.evidenceCompleteness.reasons.join(" ")).toContain("all-worker JS heap invalid");
    expect(facets.budgetEvaluation.status).toBe("not-evaluated");
  });

  it("fails closed when the mandatory SAB transport spike is invalid", () => {
    const evidenceChecks = collectSmokeEvidenceChecks({
      callbackPacingVariance: [{ profile: "fresh", state: "measured" }],
      coreRunCompletion: completedCoreRuns,
      incompleteMetrics: [],
      reportFinalization: { state: "measured" },
      runs: [
        {
          dawnPipeline: { state: "measured" },
          greyboxWorld: { state: "measured" },
          gpuMemory: { state: "measured" },
          http: httpDelta(),
          jsHeap: { state: "measured" },
          profile: "fresh",
          psoWarmup: { state: "measured" },
          repeat: 1,
          sabRingBuffer: { reason: "record corruption", state: "invalid" },
          streaming: { state: "measured" },
          wasmThreads: { state: "measured" },
        },
      ],
      streamingCellLoadP95Variance: [{ profile: "fresh", state: "measured" }],
      v8CodeCacheDiagnostics: [],
      vizPresentationFeedbackCallbackVariance: [{ profile: "fresh", state: "measured" }],
    });
    const facets = evaluateResultFacets({
      budgetChecks: [{ description: "observed checks passed", passed: true }],
      environment: measuredEnvironment,
      evidenceChecks,
    });

    expect(facets.evidenceCompleteness.status).toBe("failed");
    expect(facets.evidenceCompleteness.reasons.join(" ")).toContain(
      "SAB ring-buffer transport invalid",
    );
    expect(facets.budgetEvaluation.status).toBe("not-evaluated");
  });

  it("separates blocking core budgets from informational V8 diagnostics", () => {
    const budgetChecks = collectSmokeBudgetFacetChecks({
      runs: [
        {
          budgetChecks: [
            { actual: 0, limit: 0, metric: "mainThreadLongTasksOver50Ms", passed: true },
          ],
          profile: "fresh",
          repeat: 1,
        },
      ],
    });
    const informationalFailures = collectSmokeInformationalFailures({
      evidenceChecks: [],
      v8CodeCacheDiagnostics: [
        {
          diagnosticChecks: [
            {
              actual: 1,
              expectedMaximum: 0,
              metric: "v8CodeCacheRejectedArtifacts",
              satisfied: false,
            },
          ],
          profile: "warm",
          repeat: 2,
        },
      ],
    });

    expect(budgetChecks).toEqual([
      {
        description: "fresh repeat 1: mainThreadLongTasksOver50Ms 0 > 0",
        passed: true,
      },
    ]);
    expect(informationalFailures).toEqual([
      "V8 diagnostic warm repeat 2: v8CodeCacheRejectedArtifacts 1 > 0",
    ]);
  });

  it("leaves an empty collected budget set explicitly not evaluated", () => {
    const facets = evaluateResultFacets({
      budgetChecks: collectSmokeBudgetFacetChecks({ runs: [] }),
      environment: measuredEnvironment,
      evidenceChecks: [],
    });

    expect(facets.budgetEvaluation).toMatchObject({
      evaluatedChecks: 0,
      status: "not-evaluated",
    });
  });

  it("renders why a partial budget verdict was withheld", () => {
    const facets = evaluateResultFacets({
      budgetChecks: [{ description: "long-task budget", passed: true }],
      environment: measuredEnvironment,
      evidenceChecks: [
        { description: "presentation interval: invalid", mandatory: true, measured: false },
      ],
    });

    expect(formatSmokeFacetSummary(facets)[2]).toBe(
      "- Budget evaluation: **NOT EVALUATED** — 1 check executed; verdict withheld: Mandatory metric evidence is incomplete; a complete budget verdict cannot be evaluated",
    );
  });

  it("summarizes failed budgets without duplicating their detailed descriptions", () => {
    const facets = evaluateResultFacets({
      budgetChecks: [
        { description: "fresh repeat 1: frame p95 20 > 16.67", passed: false },
        { description: "warm repeat 1: long tasks 1 > 0", passed: false },
      ],
      environment: measuredEnvironment,
      evidenceChecks: [],
    });

    expect(formatSmokeFacetSummary(facets)[2]).toBe(
      "- Budget evaluation: **FAILED** — 2 checks executed; 2 checks failed (see Failures below)",
    );
  });
});
