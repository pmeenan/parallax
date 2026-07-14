import { describe, expect, it } from "vitest";
import { evaluateResultFacets, resultFacetsPassed } from "./result-facets.js";

describe("result facets", () => {
  it("passes only when the environment, evidence, and evaluated checks all pass", () => {
    const facets = evaluateResultFacets({
      budgetChecks: [{ description: "frame p95 is within budget", passed: true }],
      environment: { failures: [], measured: true },
      evidenceChecks: [],
    });

    expect(facets).toEqual({
      budgetEvaluation: { evaluatedChecks: 1, reasons: [], status: "passed" },
      environment: { reasons: [], status: "passed" },
      evidenceCompleteness: { reasons: [], status: "passed" },
    });
    expect(resultFacetsPassed(facets)).toBe(true);
  });

  it("keeps a valid environment visible when mandatory evidence is incomplete", () => {
    const facets = evaluateResultFacets({
      budgetChecks: [{ description: "long tasks are within budget", passed: true }],
      environment: { failures: [], measured: true },
      evidenceChecks: [
        { description: "presentation interval: invalid", mandatory: true, measured: false },
      ],
    });

    expect(facets.environment.status).toBe("passed");
    expect(facets.evidenceCompleteness.status).toBe("failed");
    expect(facets.budgetEvaluation).toMatchObject({
      evaluatedChecks: 1,
      status: "not-evaluated",
    });
    expect(resultFacetsPassed(facets)).toBe(false);
  });

  it("does not turn an empty set of budget checks green", () => {
    const facets = evaluateResultFacets({
      budgetChecks: [],
      environment: { failures: [], measured: true },
      evidenceChecks: [],
    });

    expect(facets.budgetEvaluation).toEqual({
      evaluatedChecks: 0,
      reasons: ["No budget checks were evaluated"],
      status: "not-evaluated",
    });
    expect(resultFacetsPassed(facets)).toBe(false);
  });

  it("keeps a completed budget evaluation visible when only the environment is invalid", () => {
    const facets = evaluateResultFacets({
      budgetChecks: [{ description: "long tasks are within budget", passed: true }],
      environment: { failures: ["display mode changed"], measured: false },
      evidenceChecks: [],
    });

    expect(facets.environment.status).toBe("failed");
    expect(facets.evidenceCompleteness.status).toBe("passed");
    expect(facets.budgetEvaluation.status).toBe("passed");
    expect(resultFacetsPassed(facets)).toBe(false);
  });

  it("fails closed when the environment is not measured but has no reason", () => {
    const facets = evaluateResultFacets({
      budgetChecks: [{ description: "long tasks are within budget", passed: true }],
      environment: { failures: [], measured: false },
      evidenceChecks: [],
    });

    expect(facets.environment.status).toBe("failed");
    expect(facets.environment.reasons[0]).toContain("no reason was supplied");
    expect(resultFacetsPassed(facets)).toBe(false);
  });

  it("fails closed on a contradictory measured environment with failure reasons", () => {
    const facets = evaluateResultFacets({
      budgetChecks: [{ description: "long tasks are within budget", passed: true }],
      environment: { failures: ["display changed during the run"], measured: true },
      evidenceChecks: [],
    });

    expect(facets.environment).toEqual({
      reasons: ["display changed during the run"],
      status: "failed",
    });
    expect(resultFacetsPassed(facets)).toBe(false);
  });

  it("fails on an observed budget violation even if other evidence is incomplete", () => {
    const facets = evaluateResultFacets({
      budgetChecks: [{ description: "frame p95 20 > 16.67", passed: false }],
      environment: { failures: ["display mode changed"], measured: false },
      evidenceChecks: [
        { description: "GPU memory: unsupported", mandatory: true, measured: false },
      ],
    });

    expect(facets.environment).toEqual({
      reasons: ["display mode changed"],
      status: "failed",
    });
    expect(facets.budgetEvaluation).toEqual({
      evaluatedChecks: 1,
      reasons: ["frame p95 20 > 16.67"],
      status: "failed",
    });
    expect(resultFacetsPassed(facets)).toBe(false);
  });
});
