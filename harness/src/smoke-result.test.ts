import { describe, expect, it } from "vitest";
import { invalidEnvironmentGate } from "./environment.js";
import { evaluateResultFacets } from "./result-facets.js";
import {
  collectSmokeBudgetFacetChecks,
  collectSmokeEnvironmentFacetInput,
  collectSmokeEvidenceChecks,
  formatSmokeFacetSummary,
} from "./smoke-result.js";

const measuredEnvironment = collectSmokeEnvironmentFacetInput({ state: "measured", value: true });

describe("smoke result adapters", () => {
  it("keeps an invalid Viz presentation-feedback diagnostic non-gating per D-035", () => {
    const evidenceChecks = collectSmokeEvidenceChecks({
      callbackPacingVariance: [{ profile: "fresh", state: "measured" }],
      incompleteMetrics: [],
      runs: [{ dawnPipeline: { state: "measured" }, profile: "fresh", repeat: 1 }],
      v8CodeCacheDiagnostics: [
        {
          production: { state: "measured" },
          profile: "warm",
          repeat: 1,
          v8CodeCache: { state: "measured" },
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
    expect(facets.evidenceCompleteness.status).toBe("passed");
    expect(facets.budgetEvaluation.status).toBe("passed");
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

  it("maps core and V8 budget checks with stable failure descriptions", () => {
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
      v8CodeCacheDiagnostics: [
        {
          budgetChecks: [
            { actual: 1, limit: 0, metric: "v8CodeCacheRejectedArtifacts", passed: false },
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
      {
        description: "V8 diagnostic warm repeat 2: v8CodeCacheRejectedArtifacts 1 > 0",
        passed: false,
      },
    ]);
  });

  it("leaves an empty collected budget set explicitly not evaluated", () => {
    const facets = evaluateResultFacets({
      budgetChecks: collectSmokeBudgetFacetChecks({ runs: [], v8CodeCacheDiagnostics: [] }),
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
