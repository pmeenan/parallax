import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type BaselineEligibleReport,
  evaluateBaseline,
  loadBaselineStore,
  parseBaselineEligibleReport,
  promoteBaseline,
} from "./baseline-store.js";
import { SMOKE_METRICS } from "./runs/smoke.js";

const cleanup: string[] = [];

const validGreyboxWorld = Object.freeze({
  cellCount: 256,
  clearColor: Object.freeze([0.32, 0.64, 0.92, 1] as const),
  colliderCount: 708,
  districtId: "district-1-surface",
  dynamicLighting: true,
  heightSampleCount: 256 * 17 * 17,
  materialCount: 8,
  mainThreadWorldGenerationMs: 20,
  mainThreadScenePostMessageMs: 4,
  materializationMs: 12.5,
  observedLighting: Object.freeze({
    intensityMaximum: 0.8,
    intensityMinimum: 0.6,
    intensityRange: 0.2,
    phaseMaximum: 0.7,
    phaseMinimum: 0.5,
    phaseRange: 0.2,
    sampleCount: 120,
  }),
  renderedOutput: Object.freeze({
    clearColorRgb: Object.freeze([82, 163, 235] as const),
    height: 720,
    pngSha256: "d".repeat(64),
    visiblePixelCount: 500_000,
    visiblePixelRatio: 500_000 / (1_280 * 720),
    width: 1_280,
  }),
  renderedFeaturePrimitiveCount: 318,
  renderedTerrainPatchCount: 256,
  renderedTriangleCount: 10_000,
  selectedLodCellCounts: Object.freeze([12, 48, 196] as const),
  worldBoundsMeters: Object.freeze({
    maximum: Object.freeze([2_048, 256, 2_048] as const),
    minimum: Object.freeze([-2_048, -32, -2_048] as const),
  }),
});

const validStreamingSamples = Object.freeze(
  Array.from({ length: 10 }, (_, index) =>
    Object.freeze({
      cellId: `cell-${index}`,
      decodeMs: 1,
      encodedBytes: 10_000,
      gpuBytes: 20_000,
      opfsReadMs: 2,
      sequence: index + 1,
      totalMs: 11 + index,
      uploadMs: 3,
    }),
  ),
);
const validStreaming = Object.freeze({
  cellLoadP95Ms: 20,
  cellLoadSampleCount: 10,
  cellLoadSamples: validStreamingSamples,
  decodeQueueDepthHighWater: 9,
  decodeWorkerCount: 4,
  cpuBudgetRejectionCount: 0,
  encodedBytesRead: 190_000,
  failureMessage: null,
  hardwareConcurrency: 16,
  measurementCellLoadSamples: validStreamingSamples,
  measurementProactiveEvictionCount: 10,
  measurementStartCellLoadSampleCount: 0,
  measurementStartProactiveEvictionCount: 0,
  opfsProvisionedBytes: 3_000_000,
  proactiveEvictionCount: 10,
  residentCellCount: 9,
  residentEncodedBytes: 90_000,
  residentEncodedBytesHighWater: 90_000,
  residentGpuBytes: 180_000,
  residentGpuBytesHighWater: 180_000,
  schemaVersion: 1 as const,
  state: "streaming" as const,
});

const mandatoryMetricNames = Object.freeze(
  SMOKE_METRICS.filter((metric) => metric.mandatoryForHarnessV1).map((metric) => metric.name),
);

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

function report(overrides: Partial<BaselineEligibleReport> = {}): BaselineEligibleReport {
  const budgetChecks = (heapActual: number) => [
    {
      actual: heapActual,
      limit: 20,
      metric: "allRealmJsHeapHighWaterBytes",
      passed: true,
    },
    { actual: 0, limit: 0, metric: "mainThreadLongTasksOver50Ms", passed: true },
    {
      actual: 0,
      limit: 0,
      metric: "pipelineCreationActivityOverlappingMeasurement",
      passed: true,
    },
    { actual: 0, limit: 0, metric: "shaderCompilationsOverlappingMeasurement", passed: true },
    { actual: 20, limit: 250, metric: "streamingCellLoadP95Ms", passed: true },
  ];
  const runs = [
    ...[10, 11, 12].map((actual, index) => ({
      budgetChecks: budgetChecks(actual),
      greyboxWorld: { state: "measured" as const, value: validGreyboxWorld },
      profile: "fresh" as const,
      repeat: index + 1,
      streaming: { state: "measured" as const, value: validStreaming },
    })),
    ...[8, 9, 10].map((actual, index) => ({
      budgetChecks: budgetChecks(actual),
      greyboxWorld: { state: "measured" as const, value: validGreyboxWorld },
      profile: "warm" as const,
      repeat: index + 1,
      streaming: { state: "measured" as const, value: validStreaming },
    })),
  ];
  return {
    artifactDigest: "a".repeat(64),
    baseline: { reason: "No promoted baseline exists", state: "untracked" },
    build: { engineAndRenderWorkerBytes: 500, totalBuildBytes: 1_000 },
    chromePin: { revision: "100", version: "150.0.0.0" },
    environment: {
      adapter: { backend: "D3D12", driver: "1" },
      executableSha256: "b".repeat(64),
      hostAfterRuns: { os: "Windows" },
      machine: { id: "dev-01" },
      machineId: "dev-01",
      requestedTier: "showcase",
      targetDisplayMode: "3840x2160@60Hz",
    },
    facets: {
      budgetEvaluation: {
        evaluatedChecks: runs.reduce((total, run) => total + run.budgetChecks.length, 0),
        reasons: [],
        status: "passed",
      },
      environment: { reasons: [], status: "passed" },
      evidenceCompleteness: { reasons: [], status: "passed" },
    },
    generatedAt: "2026-07-20T00:00:00.000Z",
    harnessRuntime: { nodeExecutableSha256: "e".repeat(64), nodeVersion: "v24.18.0" },
    mandatoryMetricSet: { metrics: mandatoryMetricNames, version: 15 },
    passed: true,
    runs,
    scenario: "smoke@1",
    schemaVersion: 31,
    source: { commit: "c".repeat(40), dirtyTreeDigest: null },
    v8CodeCacheDiagnosticsRequested: false,
    ...overrides,
  };
}

async function fixture(): Promise<{ reportPath: string; root: string; storePath: string }> {
  const root = await mkdtemp(join(tmpdir(), "parallax-baseline-"));
  cleanup.push(root);
  const reportPath = join(root, "results", "candidate.json");
  await mkdir(join(root, "results"));
  await writeFile(reportPath, JSON.stringify(report()));
  return { reportPath, root, storePath: join(root, "results", "baseline-store-v1.json") };
}

describe("baseline result store", () => {
  it("requires an explicit promotion and compares a new browser candidate", async () => {
    const paths = await fixture();
    const initial = await loadBaselineStore(paths.storePath);
    expect(evaluateBaseline(report(), initial)).toMatchObject({ state: "untracked" });

    const reportBytes = await readFile(paths.reportPath);
    await promoteBaseline({
      actor: "lead-agent",
      promotedAt: "2026-07-20T01:00:00.000Z",
      reason: "M0 physical gate passed",
      reportBytes,
      reportPath: paths.reportPath,
      storePath: paths.storePath,
    });
    const promoted = await loadBaselineStore(paths.storePath);
    expect(evaluateBaseline(report(), promoted)).toMatchObject({ state: "current" });

    const candidate = report({
      chromePin: { revision: "101", version: "151.0.0.0" },
      runs: report().runs.map((run) => ({
        ...run,
        budgetChecks: run.budgetChecks.map((check) =>
          check.metric === "allRealmJsHeapHighWaterBytes" ? { ...check, actual: 13.2 } : check,
        ),
      })),
    });
    const comparison = evaluateBaseline(candidate, promoted);
    expect(comparison).toMatchObject({ state: "candidate" });
    if (comparison.state !== "candidate") throw new Error("Expected a candidate comparison");
    const frameComparison = comparison.metrics.find(
      (metric) => metric.key === "fresh.allRealmJsHeapHighWaterBytes",
    );
    expect(frameComparison?.baseline).toBe(11);
    expect(frameComparison?.candidate).toBeCloseTo(13.2);
    expect(frameComparison?.relativeDelta).toBeCloseTo(0.2);
  });

  it("rejects failed reports and records the actor, reason, and report digest", async () => {
    const paths = await fixture();
    const reportBytes = await readFile(paths.reportPath);
    const failedReport = report({ passed: false });
    await expect(
      promoteBaseline({
        actor: "lead-agent",
        reason: "must not pass",
        reportBytes: Buffer.from(JSON.stringify(failedReport)),
        reportPath: paths.reportPath,
        storePath: paths.storePath,
      }),
    ).rejects.toThrow(/aggregate-passing/);

    const promoted = await promoteBaseline({
      actor: "lead-agent",
      reason: "reviewed Chrome advance",
      reportBytes,
      reportPath: paths.reportPath,
      storePath: paths.storePath,
    });
    expect(promoted).toMatchObject({
      promotedBy: "lead-agent",
      promotionReason: "reviewed Chrome advance",
      reportFile: "candidate.json",
    });
    expect(promoted.reportDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("refuses to attribute a different built artifact to a browser transition", async () => {
    const paths = await fixture();
    const reportBytes = await readFile(paths.reportPath);
    await promoteBaseline({
      actor: "lead-agent",
      reason: "old browser baseline",
      reportBytes,
      reportPath: paths.reportPath,
      storePath: paths.storePath,
    });
    const store = await loadBaselineStore(paths.storePath);

    expect(evaluateBaseline(report({ artifactDigest: "d".repeat(64) }), store)).toMatchObject({
      reason: expect.stringContaining("not comparable"),
      state: "ineligible",
    });
    expect(
      evaluateBaseline(
        report({
          harnessRuntime: {
            nodeExecutableSha256: "f".repeat(64),
            nodeVersion: "v24.18.0",
          },
        }),
        store,
      ),
    ).toMatchObject({
      reason: expect.stringContaining("Node collector identity"),
      state: "ineligible",
    });
  });

  it("compares environment identity structurally rather than by JSON key order", async () => {
    const paths = await fixture();
    await promoteBaseline({
      actor: "lead-agent",
      reason: "ordered environment",
      reportBytes: Buffer.from(JSON.stringify(report())),
      reportPath: paths.reportPath,
      storePath: paths.storePath,
    });
    const store = await loadBaselineStore(paths.storePath);
    const reorderedEnvironment = report({
      environment: {
        ...report().environment,
        adapter: { driver: "1", backend: "D3D12" },
      },
    });

    expect(evaluateBaseline(reorderedEnvironment, store)).toMatchObject({ state: "current" });
  });

  it("rejects malformed identity and empty budget evidence before promotion", () => {
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        environment: { ...report().environment, executableSha256: "not-a-digest" },
      }),
    ).toThrow(/environment\.executableSha256/);
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        runs: [{ budgetChecks: [], profile: "fresh", repeat: 1 }],
      }),
    ).toThrow(/budgetChecks must contain measured observations/);
  });

  it("requires the exact v15 mandatory metric list and measured D-090 evidence in every run", () => {
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        mandatoryMetricSet: {
          metrics: mandatoryMetricNames.filter((metric) => metric !== "greybox world content"),
          version: 15,
        },
      }),
    ).toThrow(/mandatoryMetricSet\.metrics must contain exactly.*greybox world content/);
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        mandatoryMetricSet: {
          metrics: [...mandatoryMetricNames, "greybox world content"],
          version: 15,
        },
      }),
    ).toThrow(/mandatoryMetricSet\.metrics must contain exactly/);
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        runs: report().runs.map((run, index) =>
          index === 0 ? { ...run, greyboxWorld: { state: "invalid" } } : run,
        ),
      }),
    ).toThrow(/runs\[0\]\.greyboxWorld\.state must be measured/);
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        runs: report().runs.map((run, index) =>
          index === 5
            ? {
                ...run,
                greyboxWorld: {
                  state: "measured",
                  value: { ...validGreyboxWorld, heightSampleCount: 17 * 17 },
                },
              }
            : run,
        ),
      }),
    ).toThrow(/runs\[5\]\.greyboxWorld\.value is invalid/);
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        runs: report().runs.map((run, index) =>
          index === 0 ? { ...run, streaming: { state: "invalid" } } : run,
        ),
      }),
    ).toThrow(/runs\[0\]\.streaming\.state must be measured/);
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        runs: report().runs.map((run, index) =>
          index === 1
            ? {
                ...run,
                streaming: {
                  state: "measured",
                  value: { ...validStreaming, residentCellCount: 8 },
                },
              }
            : run,
        ),
      }),
    ).toThrow(/runs\[1\]\.streaming\.value is invalid/);
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        runs: report().runs.map((run, index) =>
          index === 1
            ? {
                ...run,
                streaming: {
                  state: "measured",
                  value: {
                    ...validStreaming,
                    measurementStartCellLoadSampleCount: 9,
                    measurementStartProactiveEvictionCount: 9,
                  },
                },
              }
            : run,
        ),
      }),
    ).toThrow(/at least 10 completed replacements/);
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        runs: report().runs.map((run, index) =>
          index === 2
            ? {
                ...run,
                budgetChecks: run.budgetChecks.map((check) =>
                  check.metric === "streamingCellLoadP95Ms" ? { ...check, actual: 19 } : check,
                ),
              }
            : run,
        ),
      }),
    ).toThrow(/streaming budget checks must agree/);
  });

  it("validates the same report bytes recorded by the audit digest", async () => {
    const paths = await fixture();
    await expect(
      promoteBaseline({
        actor: "lead-agent",
        reason: "unrelated bytes",
        reportBytes: Buffer.from("{}"),
        reportPath: paths.reportPath,
        storePath: paths.storePath,
      }),
    ).rejects.toThrow(/artifactDigest/);
  });

  it("rejects partial, duplicate, contradictory, and facet-inconsistent gate evidence", async () => {
    expect(() =>
      parseBaselineEligibleReport({ ...report(), runs: report().runs.slice(0, 1) }),
    ).toThrow(/fresh runs must contain repeats/);
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        runs: report().runs.map((run, index) => (index === 1 ? { ...run, repeat: 1 } : run)),
      }),
    ).toThrow(/duplicate fresh repeat 1/);
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        facets: {
          ...report().facets,
          budgetEvaluation: {
            ...report().facets.budgetEvaluation,
            evaluatedChecks: 1,
          },
        },
      }),
    ).toThrow(/evaluatedChecks must equal 30/);

    const paths = await fixture();
    const failedCheckReport = report({
      runs: report().runs.map((run, index) =>
        index === 0
          ? {
              ...run,
              budgetChecks: run.budgetChecks.map((check) =>
                check.metric === "mainThreadLongTasksOver50Ms"
                  ? { ...check, actual: 1, passed: false }
                  : check,
              ),
            }
          : run,
      ),
    });
    await expect(
      promoteBaseline({
        actor: "lead-agent",
        reason: "contradictory report",
        reportBytes: Buffer.from(JSON.stringify(failedCheckReport)),
        reportPath: paths.reportPath,
        storePath: paths.storePath,
      }),
    ).rejects.toThrow(/no failed checks/);
  });

  it("atomically replaces an existing store record", async () => {
    const paths = await fixture();
    const reportBytes = await readFile(paths.reportPath);
    await promoteBaseline({
      actor: "first",
      reason: "first baseline",
      reportBytes,
      reportPath: paths.reportPath,
      storePath: paths.storePath,
    });
    const firstStore = await loadBaselineStore(paths.storePath);
    const firstBaseline = firstStore.entries["smoke@1|dev-01|showcase"];
    if (firstBaseline === undefined) throw new Error("Expected the first promoted baseline");
    const replacementReport = report({
      baseline: { baseline: firstBaseline, metrics: [], state: "current" },
    });
    await promoteBaseline({
      actor: "second",
      reason: "replacement baseline",
      reportBytes: Buffer.from(JSON.stringify(replacementReport)),
      reportPath: paths.reportPath,
      storePath: paths.storePath,
    });

    const replaced = await loadBaselineStore(paths.storePath);
    expect(replaced.entries["smoke@1|dev-01|showcase"]).toMatchObject({
      promotedBy: "second",
      promotionReason: "replacement baseline",
    });
  });

  it("rejects ineligible and stale promotions unless the current anchor is acknowledged", async () => {
    const paths = await fixture();
    await promoteBaseline({
      actor: "first",
      reason: "first baseline",
      reportBytes: Buffer.from(JSON.stringify(report())),
      reportPath: paths.reportPath,
      storePath: paths.storePath,
    });
    const firstStore = await loadBaselineStore(paths.storePath);
    const firstBaseline = firstStore.entries["smoke@1|dev-01|showcase"];
    if (firstBaseline === undefined) throw new Error("Expected the first promoted baseline");
    const changedArtifact = report({
      artifactDigest: "d".repeat(64),
      baseline: {
        baseline: firstBaseline,
        reason: "artifact differs",
        state: "ineligible",
      },
    });
    await expect(
      promoteBaseline({
        actor: "second",
        reason: "implicit rebaseline",
        reportBytes: Buffer.from(JSON.stringify(changedArtifact)),
        reportPath: paths.reportPath,
        storePath: paths.storePath,
      }),
    ).rejects.toThrow(/--rebaseline/);
    const changedEnvironment = report({
      baseline: {
        baseline: firstBaseline,
        reason: "Node collector differs",
        state: "ineligible",
      },
      harnessRuntime: {
        nodeExecutableSha256: "f".repeat(64),
        nodeVersion: "v24.18.1",
      },
    });
    await expect(
      promoteBaseline({
        actor: "second",
        reason: "implicit environment rebaseline",
        reportBytes: Buffer.from(JSON.stringify(changedEnvironment)),
        reportPath: paths.reportPath,
        storePath: paths.storePath,
      }),
    ).rejects.toThrow(/--rebaseline/);

    await promoteBaseline({
      actor: "second",
      allowIneligible: true,
      reason: "intentional rebaseline",
      reportBytes: Buffer.from(JSON.stringify(changedArtifact)),
      reportPath: paths.reportPath,
      storePath: paths.storePath,
    });
    const staleCandidate = report({
      baseline: { baseline: firstBaseline, metrics: [], state: "candidate" },
      chromePin: { revision: "101", version: "151.0.0.0" },
    });
    await expect(
      promoteBaseline({
        actor: "stale",
        allowIneligible: true,
        reason: "stale candidate",
        reportBytes: Buffer.from(JSON.stringify(staleCandidate)),
        reportPath: paths.reportPath,
        storePath: paths.storePath,
      }),
    ).rejects.toThrow(/stale/);
  });

  it("serializes concurrent promotions without losing distinct records", async () => {
    const paths = await fixture();
    const first = report();
    const second = report({
      environment: {
        ...report().environment,
        machine: { id: "dev-02" },
        machineId: "dev-02",
      },
    });
    await Promise.all(
      [first, second].map((candidate, index) =>
        promoteBaseline({
          actor: `actor-${index}`,
          reason: `concurrent-${index}`,
          reportBytes: Buffer.from(JSON.stringify(candidate)),
          reportPath: paths.reportPath,
          storePath: paths.storePath,
        }),
      ),
    );

    const store = await loadBaselineStore(paths.storePath);
    expect(Object.keys(store.entries).sort()).toEqual([
      "smoke@1|dev-01|showcase",
      "smoke@1|dev-02|showcase",
    ]);
  });

  it("recovers a stale lock owned by a dead process", async () => {
    const paths = await fixture();
    await writeFile(
      `${paths.storePath}.lock`,
      JSON.stringify({
        createdAt: "2000-01-01T00:00:00.000Z",
        pid: 2_147_483_647,
        token: "stale",
      }),
    );
    const candidate = report();
    await promoteBaseline({
      actor: "lead-agent",
      reason: "stale lock recovery",
      reportBytes: Buffer.from(JSON.stringify(candidate)),
      reportPath: paths.reportPath,
      storePath: paths.storePath,
    });
    await expect(loadBaselineStore(paths.storePath)).resolves.toMatchObject({ schemaVersion: 1 });
  });

  it("treats an expired lock as stale even when its PID has been reused", async () => {
    const paths = await fixture();
    await writeFile(
      `${paths.storePath}.lock`,
      JSON.stringify({
        createdAt: "2000-01-01T00:00:00.000Z",
        pid: process.pid,
        token: "expired",
      }),
    );

    await promoteBaseline({
      actor: "lead-agent",
      reason: "expired lock recovery",
      reportBytes: Buffer.from(JSON.stringify(report())),
      reportPath: paths.reportPath,
      storePath: paths.storePath,
    });

    await expect(loadBaselineStore(paths.storePath)).resolves.toMatchObject({ schemaVersion: 1 });
  });
});
