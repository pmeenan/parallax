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
  readonly value: LocalServerMetrics;
} {
  return {
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
      opfsThroughputVariance: [],
      runs: [
        {
          dawnPipeline: { state: "measured" },
          gpuMemory: { reason: "no page-attributed resident total", state: "unsupported" },
          http: httpDelta(),
          jsHeap: { state: "measured" },
          opfsReadSpike: { state: "measured" },
          profile: "fresh",
          repeat: 1,
          sabRingBuffer: { state: "measured" },
          wasmThreads: { state: "measured" },
        },
      ],
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
      opfsThroughputVariance: [],
      runs: [
        {
          dawnPipeline: { state: "measured" },
          gpuMemory: { state: "measured" },
          http: httpDelta(),
          jsHeap: { state: "measured" },
          opfsReadSpike: { state: "measured" },
          profile: "fresh",
          repeat: 1,
          sabRingBuffer: { state: "measured" },
          wasmThreads: { state: "measured" },
        },
      ],
      v8CodeCacheDiagnostics: [],
      vizPresentationFeedbackCallbackVariance: [{ profile: "fresh", state: "measured" }],
    });

    expect(
      evidenceChecks.find((check) => check.description.includes("callback pacing variance")),
    ).toMatchObject({ mandatory: true, measured: true });
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
      opfsThroughputVariance: [],
      runs: [
        {
          dawnPipeline: { state: "measured" },
          gpuMemory: { state: "measured" },
          http: httpDelta(),
          jsHeap: { state: "measured" },
          opfsReadSpike: { state: "measured" },
          profile: "fresh",
          repeat: 1,
          sabRingBuffer: { state: "measured" },
          wasmThreads: { state: "measured" },
        },
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
      opfsThroughputVariance: [],
      runs: [
        {
          dawnPipeline: { state: "measured" },
          gpuMemory: { state: "measured" },
          http: httpDelta({
            pathClasses: { document: 1, immutable: 2, other: 0 },
            requests: 3,
            statuses: { "200": 3 },
            statusesByPathClass: { document: { "200": 1 }, immutable: { "200": 2 }, other: {} },
          }),
          jsHeap: { state: "measured" },
          opfsReadSpike: { state: "measured" },
          profile: "warm",
          repeat: 1,
          sabRingBuffer: { state: "measured" },
          wasmThreads: { state: "measured" },
        },
      ],
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
      opfsThroughputVariance: [],
      runs: [
        {
          dawnPipeline: { state: "measured" },
          gpuMemory: { reason: "no page-attributed resident total", state: "unsupported" },
          http: httpDelta(),
          jsHeap: { reason: "worker target disappeared", state: "invalid" },
          opfsReadSpike: { state: "measured" },
          profile: "fresh",
          repeat: 1,
          sabRingBuffer: { state: "measured" },
          wasmThreads: { state: "measured" },
        },
      ],
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
      opfsThroughputVariance: [],
      runs: [
        {
          dawnPipeline: { state: "measured" },
          gpuMemory: { state: "measured" },
          http: httpDelta(),
          jsHeap: { state: "measured" },
          opfsReadSpike: { state: "measured" },
          profile: "fresh",
          repeat: 1,
          sabRingBuffer: { reason: "record corruption", state: "invalid" },
          wasmThreads: { state: "measured" },
        },
      ],
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

  it("fails closed when mandatory per-run OPFS throughput evidence is invalid", () => {
    const evidenceChecks = collectSmokeEvidenceChecks({
      callbackPacingVariance: [{ profile: "fresh", state: "measured" }],
      coreRunCompletion: completedCoreRuns,
      incompleteMetrics: [],
      opfsThroughputVariance: [
        {
          mode: "sequential",
          profile: "fresh",
          reason: "throughput relative range exceeded 10%",
          state: "invalid",
          timingScope: "read-call",
        },
      ],
      runs: [
        {
          dawnPipeline: { state: "measured" },
          gpuMemory: { state: "measured" },
          http: httpDelta(),
          jsHeap: { state: "measured" },
          opfsReadSpike: { reason: "short read", state: "invalid" },
          profile: "fresh",
          repeat: 1,
          sabRingBuffer: { state: "measured" },
          wasmThreads: { state: "measured" },
        },
      ],
      v8CodeCacheDiagnostics: [],
      vizPresentationFeedbackCallbackVariance: [{ profile: "fresh", state: "measured" }],
    });
    const facets = evaluateResultFacets({
      budgetChecks: [{ description: "observed checks passed", passed: true }],
      environment: measuredEnvironment,
      evidenceChecks,
    });

    expect(facets.evidenceCompleteness.status).toBe("failed");
    expect(facets.evidenceCompleteness.reasons.join(" ")).toContain("OPFS");
    expect(facets.budgetEvaluation.status).toBe("not-evaluated");
  });

  it("retains OPFS repeatability failures as informational findings", () => {
    const evidenceChecks = collectSmokeEvidenceChecks({
      callbackPacingVariance: [{ profile: "fresh", state: "measured" }],
      coreRunCompletion: completedCoreRuns,
      incompleteMetrics: [],
      opfsThroughputVariance: [
        {
          mode: "random",
          profile: "warm",
          reason: "throughput relative range exceeded 10%",
          state: "invalid",
          timingScope: "read-call",
        },
      ],
      runs: [
        {
          dawnPipeline: { state: "measured" },
          gpuMemory: { state: "measured" },
          http: httpDelta(),
          jsHeap: { state: "measured" },
          opfsReadSpike: { state: "measured" },
          profile: "warm",
          repeat: 1,
          sabRingBuffer: { state: "measured" },
          wasmThreads: { state: "measured" },
        },
      ],
      v8CodeCacheDiagnostics: [],
      vizPresentationFeedbackCallbackVariance: [{ profile: "warm", state: "measured" }],
    });
    const facets = evaluateResultFacets({
      budgetChecks: [{ description: "observed checks passed", passed: true }],
      environment: measuredEnvironment,
      evidenceChecks,
    });
    const repeatability = evidenceChecks.find((check) =>
      check.description.includes("OPFS read-call throughput variance"),
    );

    expect(repeatability).toMatchObject({ mandatory: false, measured: false });
    expect(facets.evidenceCompleteness.status).toBe("passed");
    expect(facets.budgetEvaluation.status).toBe("passed");
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
