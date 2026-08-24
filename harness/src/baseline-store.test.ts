import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateBoundedRepeatability } from "./aggregate.js";
import {
  type BaselineEligibleReport,
  type BaselineRecord,
  evaluateBaseline,
  evaluateBaselineSafely,
  loadBaselineStore,
  parseBaselineEligibleReport,
  promoteBaseline,
} from "./baseline-store.js";
import { resolveExpectedPsoWarmupTraceIdentity } from "./pso-warmup-trace.js";
import {
  SMOKE_MANDATORY_METRIC_SET_VERSION,
  SMOKE_METRICS,
  SMOKE_REPORT_SCHEMA_VERSION,
  SMOKE_STREAMING_P95_ABSOLUTE_RANGE_FLOOR_MS,
  SMOKE_STREAMING_P95_RELATIVE_RANGE_LIMIT,
} from "./runs/smoke.js";
import { requireStreamingEvidence } from "./streaming-evidence.js";

const cleanup: string[] = [];
const psoIdentity = resolveExpectedPsoWarmupTraceIdentity();
const validPsoWarmup = Object.freeze({
  buildCompatibilityDigest: psoIdentity.buildCompatibilityDigest,
  cacheHitCount: 1,
  cacheMissCount: 1,
  compiledCount: 1,
  contract: "pso-warmup-telemetry@1" as const,
  deferredCount: 1,
  entries: Object.freeze([
    Object.freeze({
      compileAttemptCount: 1,
      compileDurationMs: 1,
      compiled: true,
      id: psoIdentity.entry.id,
      requestCount: 2,
      stateDigest: psoIdentity.entry.stateDigest,
    }),
  ]),
  failure: null,
  failureCount: 0,
  maximumCompileDurationMs: 1,
  queueHighWater: 1,
  releaseDigest: null,
  requestedCount: 2,
  schemaVersion: 1 as const,
  source: "privileged-embedded" as const,
  state: "ready" as const,
  totalDurationMs: 2,
  traceEntryCount: 1,
  traceSha256: psoIdentity.sha256,
});

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

function simulationGameplayEvidence() {
  return Object.freeze({
    adapterInitializationHighWaterMs: 4,
    movementDistanceMeters: 10,
    navigationEdgeCount: 100,
    navigationExpandedNodeCount: 24,
    navigationGridBytes: 1_000,
    navigationNodeCount: 50,
    navigationPathNodeCount: 16,
    navigationPathQueryCount: 8,
    navigationTileCount: 256,
    npcAgentCount: 48,
    npcAvoidanceAdjustmentCount: 12,
    npcMovementDistanceMeters: 20,
    npcMovingAgentCount: 40,
    npcScheduleTransitionCount: 8,
    replayFinalStateHash: "d".repeat(64),
    replayHashMatch: true,
    replayLoadedStateHash: "d".repeat(64),
    replaySecondStateHash: "d".repeat(64),
    replayTick: 120,
    saveLoadHashMatch: true,
    saveLoadReloadedStateHash: "d".repeat(64),
    saveLoadStateHash: "d".repeat(64),
    stepDurationHighWaterMs: 0.25,
    m35Exit: Object.freeze({
      adapterInitializationHighWaterMs: 5,
      combatMonstersDefeated: 3,
      commandCount: 34,
      finalSaveBytes: 10_000,
      finalStateHash: "f".repeat(64),
      itemBuyCount: 3,
      itemCraftCount: 1,
      itemLootAwardCount: 3,
      loadedStateHash: "f".repeat(64),
      progressionLevel: 3,
      questAcceptedCount: 2,
      questCompletedCount: 2,
      questObjectiveProgressCount: 5,
      questStageCompletionCount: 2,
      replayBytesMatch: true as const,
      replayHashMatch: true as const,
      reloadedStateHash: "f".repeat(64),
      scenarioId: "m35-gameplay-slice@1",
      scenarioSeed: 424_242,
      scenarioVersion: 1,
      stepDurationHighWaterMs: 0.5,
      tick: 8_000,
    }),
    m3Exit: Object.freeze({
      dialogRequestCountBefore: 0,
      dialogRequestCount: 1,
      dialogState: "unavailable" as const,
      gameplayInteractionPressCountBefore: 0,
      gameplayInteractionPressCount: 1,
      installedModelState: "unavailable" as const,
      interactionActivationCountBefore: 0,
      interactionActivationCount: 1,
      knowledgeEntryCountBefore: 0,
      knowledgeEntryCount: 1,
      knowledgeRequestCountBefore: 0,
      knowledgeRequestCount: 1,
      loadedStateHash: "e".repeat(64),
      npcEntityId: 1_000,
      positioningReplayStateHash: "e".repeat(64),
      positioningReplayTick: 4_497,
      playerQuestion: "Is the road safe?",
      response:
        "The east road leaves the village through the east gate and follows the marked landward path.",
      responseUsedRetrievedState: true as const,
      speaker: "Mara Venn",
    }),
  });
}

const validStreamingSamples = Object.freeze(
  Array.from({ length: 10 }, (_, index) =>
    Object.freeze({
      batchDirectUploadMs: index < 9 ? 27 : 3,
      batchCellCount: index < 9 ? 9 : 1,
      batchCellOrdinal: index < 9 ? index + 1 : 1,
      batchFlythroughObserverSequence: 0,
      batchObserverUpdateCount: index < 9 ? 1 : 2,
      batchOrdinal: index < 9 ? 2 : 3,
      batchTransactionId: index < 9 ? "1:2:1:0" : "1:3:2:0",
      cellId: `cell-${index}`,
      decodeMs: 1,
      decodeRoundTripMs: 2,
      decodeWaitMs: 1,
      encodedBytes: 10_000,
      gpuBytes: 20_000,
      opfsAccessRoundTripMs: 3,
      opfsReadMs: 2,
      opfsWaitMs: 1,
      renderTransactionRoundTripMs: 5,
      renderTransactionWaitMs: 2,
      sequence: index + 1,
      streamingWorkerRemainderMs: 1 + index,
      totalMs: 11 + index,
      uploadMs: 3,
    }),
  ),
);
const validStreaming = Object.freeze({
  cellLoadAttributionP95: Object.freeze({
    decodeMs: 1,
    decodeRoundTripMs: 2,
    decodeWaitMs: 1,
    opfsAccessRoundTripMs: 3,
    opfsReadMs: 2,
    opfsWaitMs: 1,
    renderTransactionRoundTripMs: 5,
    renderTransactionWaitMs: 2,
    streamingWorkerRemainderMs: 10,
    uploadMs: 3,
  }),
  cellLoadP95Ms: 20,
  cellLoadSampleCount: 10,
  cellLoadSamples: validStreamingSamples,
  decodeQueueDepthHighWater: 9,
  decodeWorkerCount: 4,
  cpuBudgetRejectionCount: 0,
  currentObservers: Object.freeze([[0, 12, 0] as const]),
  districtId: "district-1-surface",
  districtSwapCount: 0,
  districtSwapInProgress: false,
  districtSwapSamples: Object.freeze([]),
  encodedBytesRead: 190_000,
  failureMessage: null,
  flythroughObserverUpdateCount: 0,
  hardwareConcurrency: 16,
  installedReleaseDigest: null,
  installedResourceBytes: 0,
  installedResourceCount: 0,
  legacyNetworkRequestCount: 2,
  observerUpdateCount: 10,
  opfsAccessHandleCount: 256,
  opfsAccessHandleOpenDurationMs: 10,
  opfsPackageCount: 256,
  measurementCellLoadSamples: validStreamingSamples,
  measurementProactiveEvictionCount: 10,
  measurementStartBatch: null,
  measurementStartCellLoadSampleCount: 0,
  measurementStartFlythroughObserverUpdateCount: 0,
  measurementStartObserverUpdateCount: 0,
  measurementStartProactiveEvictionCount: 0,
  measurementStartResidentCellCount: 9,
  measurementStartSettledObserverUpdateCount: 0,
  opfsProvisionedBytes: 3_000_000,
  proactiveEvictionCount: 10,
  residentCellCount: 9,
  residentCellIds: Object.freeze(["a", "b", "c", "d", "e", "f", "g", "h", "i"]),
  residentEncodedBytes: 90_000,
  residentEncodedBytesHighWater: 90_000,
  residentGpuBytes: 180_000,
  residentGpuBytesHighWater: 180_000,
  renderRecoveryCount: 0,
  renderBatchCellCountHighWater: 9,
  renderBatchDirectUploadMsHighWater: 27,
  renderBatchRequestCount: 2,
  renderBatchTransactionCount: 2,
  schemaVersion: 13 as const,
  settledRecoveryCheckpoint: Object.freeze({
    flythroughObserverUpdateCount: 0,
    observerUpdateCount: 10,
    observers: Object.freeze([[0, 12, 0] as const]),
    residentCellIds: Object.freeze(["a", "b", "c", "d", "e", "f", "g", "h", "i"]),
    workerGeneration: 1,
  }),
  settledObserverUpdateCount: 10,
  state: "streaming" as const,
  startupTiming: {
    accessHandlesOpenedAtMs: 4,
    contract: "streaming-startup-timing@1" as const,
    decodePoolCreatedAtMs: 5,
    finalAdmissionCompletedAtMs: null,
    initialResidencyReadyAtMs: 6,
    provisioningStartedAtMs: 2,
    releaseBindingCompletedAtMs: null,
    releaseResolutionCompletedAtMs: 3,
    schemaVersion: 1 as const,
    sourceKind: "privileged-legacy-network" as const,
    workerStartedAtMs: 1,
  },
  workerGeneration: 1,
});

const validHybridUi = Object.freeze({
  dialogDomActionCount: 0,
  domMutationDurationHighWaterMs: 1,
  domNodeCountHighWater: 8,
  forwardedInputCount: 0,
  imeDomActionCount: 0,
  presentationCount: 1,
  presentationRevision: 0,
  schemaVersion: 1,
  semanticNodeCountHighWater: 0,
  state: "ready" as const,
  worker: Object.freeze({
    actionCount: 0,
    heavyPrimitiveCapacity: 256,
    heavyPrimitiveCount: 0,
    hitTestDurationHighWaterMs: 0,
    inputCount: 0,
    presentationCount: 1,
    presentationRevision: 0,
    presentationUpdateDurationHighWaterMs: 1,
    schemaVersion: 1,
    worldAnchorCapacity: 64,
    worldAnchorCount: 1,
  }),
  workerActionCount: 0,
});

const mandatoryMetricNames = Object.freeze(
  SMOKE_METRICS.filter((metric) => metric.mandatoryForHarnessV1).map((metric) => metric.name),
);

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

function report(overrides: Partial<BaselineEligibleReport> = {}): BaselineEligibleReport {
  const target = targetIdentity("a".repeat(64));
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
    { actual: 0.25, limit: 2, metric: "simulationGameplayStepHighWaterMs", passed: true },
    { actual: 20, limit: 250, metric: "streamingCellLoadP95Ms", passed: true },
  ];
  const runs = [
    ...[10, 11, 12].map((actual, index) => ({
      budgetChecks: budgetChecks(actual),
      greyboxWorld: { state: "measured" as const, value: validGreyboxWorld },
      hybridUi: { state: "measured" as const, value: validHybridUi },
      profile: "fresh" as const,
      psoWarmup: { state: "measured" as const, value: validPsoWarmup },
      repeat: index + 1,
      simulationController: {
        state: "measured" as const,
        value: simulationGameplayEvidence(),
      },
      streaming: { state: "measured" as const, value: validStreaming },
    })),
    ...[8, 9, 10].map((actual, index) => ({
      budgetChecks: budgetChecks(actual),
      greyboxWorld: { state: "measured" as const, value: validGreyboxWorld },
      hybridUi: { state: "measured" as const, value: validHybridUi },
      profile: "warm" as const,
      psoWarmup: { state: "measured" as const, value: validPsoWarmup },
      repeat: index + 1,
      simulationController: {
        state: "measured" as const,
        value: simulationGameplayEvidence(),
      },
      streaming: { state: "measured" as const, value: validStreaming },
    })),
  ];
  return {
    artifactDigest: "a".repeat(64),
    baseline: { reason: "No promoted baseline exists", state: "untracked" },
    build: { engineAndRenderWorkerBytes: 500, totalBuildBytes: 1_000 },
    callbackPacingVariance: [],
    chromePin: {
      channel: "stable",
      downloads: { win64: "https://example.invalid/chrome.zip" },
      executableSha256: { win64: "b".repeat(64) },
      revision: "100",
      version: "150.0.0.0",
    },
    coreRunFailure: null,
    environment: {
      adapter: { backend: "D3D12", driver: "1" },
      browserCommandLine: "chrome.exe --enable-webgpu-developer-features",
      browserDisplay: { screen: { height: 2160, width: 3840 } },
      browserProduct: "Chrome/150.0.0.0",
      browserRevision: "revision-100",
      browserUserAgent: "Chrome/150.0.0.0",
      executableSha256: "b".repeat(64),
      gateIdentity: { state: "measured", value: true },
      gpuDevices: [{ deviceId: 1, vendorId: 1 }],
      host: { os: "Windows" },
      hostAfterRuns: { os: "Windows" },
      jsVersion: "15.0.0",
      machine: { id: "dev-01" },
      machineId: "dev-01",
      requestedTier: "showcase",
      sandboxVerified: true,
      target,
      targetPostflight: { identity: target, state: "verified" },
      targetPreflight: { identity: target, state: "verified" },
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
    finalizationFailure: null,
    generatedAt: "2026-07-20T00:00:00.000Z",
    harnessRuntime: { nodeExecutableSha256: "e".repeat(64), nodeVersion: "v24.18.0" },
    incompleteMetrics: [],
    informationalFailures: [],
    mandatoryMetricSet: {
      metrics: mandatoryMetricNames,
      version: SMOKE_MANDATORY_METRIC_SET_VERSION,
    },
    passed: true,
    postRunIdentity: { state: "measured" },
    reportPersistence: { state: "measured" },
    releaseDigest: "b".repeat(64),
    runs,
    scenario: "smoke@1",
    schemaVersion: SMOKE_REPORT_SCHEMA_VERSION,
    source: { commit: "c".repeat(40), dirtyTreeDigest: null },
    streamingCellLoadP95Variance: [
      {
        absoluteP95RangeMs: 0,
        allowedAbsoluteP95RangeMs: 2,
        profile: "fresh",
        relativeP95Range: 0,
        state: "measured",
      },
      {
        absoluteP95RangeMs: 0,
        allowedAbsoluteP95RangeMs: 2,
        profile: "warm",
        relativeP95Range: 0,
        state: "measured",
      },
    ],
    v8CodeCacheDiagnostics: [],
    v8CodeCacheDiagnosticsRequested: false,
    vizPresentationFeedbackCallbackVariance: [],
    ...overrides,
  };
}

function targetIdentity(artifactDigest: string): BaselineEligibleReport["environment"]["target"] {
  return {
    artifactDigest,
    artifactDigestVerified: true,
    kind: "local",
    localServerStarted: true,
    origin: "http://127.0.0.1:4173",
    releaseDigest: "b".repeat(64),
    releaseDigestVerified: true,
    servingContract: {
      artifactBytes: 100,
      artifactCount: 4,
      conditionalArtifactCount: 4,
      documentCacheControl: "no-cache",
      documentConditionalStatus: 304,
      documentMimeType: "text/html; charset=utf-8",
      documentStatus: 200,
      isolation: "coop-coep",
      manifestCacheControl: "no-cache",
      manifestConditionalStatus: 304,
      manifestStatus: 200,
      nosniff: true,
      representations: [
        { bytes: 25, count: 1, mimeTypes: ["text/html"], representation: "html" },
        {
          bytes: 25,
          count: 1,
          mimeTypes: ["application/javascript"],
          representation: "javascript",
        },
        { bytes: 25, count: 1, mimeTypes: ["application/json"], representation: "json" },
        { bytes: 25, count: 1, mimeTypes: ["application/wasm"], representation: "wasm" },
      ],
    },
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
      chromePin: { ...report().chromePin, revision: "101", version: "151.0.0.0" },
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

  it("preserves a real schema-v1 three-part D-087 anchor as an ineligible local predecessor", async () => {
    const paths = await fixture();
    const candidateBytes = Buffer.from(JSON.stringify(report()));
    await promoteBaseline({
      actor: "legacy-actor",
      reason: "pre-D-121 local anchor",
      reportBytes: candidateBytes,
      reportPath: paths.reportPath,
      storePath: paths.storePath,
    });
    const qualified = await loadBaselineStore(paths.storePath);
    const qualifiedKey = "smoke@1|dev-01|showcase|local|http://127.0.0.1";
    const qualifiedRecord = qualified.entries[qualifiedKey];
    if (qualifiedRecord === undefined) throw new Error("Expected qualified fixture anchor");
    const { target: _removedTarget, ...legacyComparisonEnvironment } =
      qualifiedRecord.comparisonEnvironment;
    const legacyRecord: BaselineRecord = {
      ...qualifiedRecord,
      comparisonEnvironment: legacyComparisonEnvironment,
    };
    await writeFile(
      paths.storePath,
      `${JSON.stringify(
        {
          entries: { "smoke@1|dev-01|showcase": legacyRecord },
          schemaVersion: 1,
        },
        null,
        2,
      )}\n`,
    );
    const legacyStore = await loadBaselineStore(paths.storePath);
    const legacyEvaluation = evaluateBaseline(report(), legacyStore);
    expect(legacyEvaluation).toMatchObject({
      baseline: { promotedBy: "legacy-actor", promotionReason: "pre-D-121 local anchor" },
      reason: expect.stringContaining("Pre-D-121 local baseline predecessor"),
      state: "ineligible",
    });
    const candidate = report({ baseline: legacyEvaluation });
    await expect(
      promoteBaseline({
        actor: "migration-actor",
        reason: "implicit migration must fail",
        reportBytes: Buffer.from(JSON.stringify(candidate)),
        reportPath: paths.reportPath,
        storePath: paths.storePath,
      }),
    ).rejects.toThrow(/--rebaseline/);

    const staleCandidate = report({
      baseline:
        legacyEvaluation.state === "ineligible"
          ? {
              ...legacyEvaluation,
              baseline: { ...legacyEvaluation.baseline, reportDigest: "f".repeat(64) },
            }
          : legacyEvaluation,
    });
    await expect(
      promoteBaseline({
        actor: "migration-actor",
        allowIneligible: true,
        reason: "stale explicit migration",
        reportBytes: Buffer.from(JSON.stringify(staleCandidate)),
        reportPath: paths.reportPath,
        storePath: paths.storePath,
      }),
    ).rejects.toThrow(/stale/);

    await promoteBaseline({
      actor: "migration-actor",
      allowIneligible: true,
      reason: "reviewed target-qualified migration",
      reportBytes: Buffer.from(JSON.stringify(candidate)),
      reportPath: paths.reportPath,
      storePath: paths.storePath,
    });
    const migrated = await loadBaselineStore(paths.storePath);
    expect(migrated.entries["smoke@1|dev-01|showcase"]).toEqual(legacyRecord);
    expect(migrated.entries[qualifiedKey]).toMatchObject({
      promotedBy: "migration-actor",
      promotionReason: "reviewed target-qualified migration",
    });
  });

  it.each([
    {
      corrupt: (baseline: BaselineRecord) => ({ ...baseline, metrics: null }),
      label: "a non-array metrics value",
    },
    {
      corrupt: (baseline: BaselineRecord) => ({ ...baseline, metrics: [] }),
      label: "an empty metrics array",
    },
    {
      corrupt: (baseline: BaselineRecord) => ({
        ...baseline,
        browser: { ...baseline.browser, version: 151 },
      }),
      label: "a malformed browser field",
    },
  ])("keeps $label from invalidating a completed report", async ({ corrupt }) => {
    const paths = await fixture();
    await promoteBaseline({
      actor: "lead-agent",
      reason: "valid anchor before corruption",
      reportBytes: Buffer.from(JSON.stringify(report())),
      reportPath: paths.reportPath,
      storePath: paths.storePath,
    });
    const store = await loadBaselineStore(paths.storePath);
    const [key] = Object.keys(store.entries);
    if (key === undefined) throw new Error("Test baseline store is empty");
    const baseline = store.entries[key];
    if (baseline === undefined) throw new Error("Test baseline record is missing");
    const malformed = {
      ...store,
      entries: {
        ...store.entries,
        [key]: corrupt(baseline),
      },
    } as unknown as Parameters<typeof evaluateBaselineSafely>[1];

    expect(evaluateBaselineSafely(report(), malformed)).toMatchObject({
      reason: expect.stringContaining("Baseline comparison unavailable"),
      state: "untracked",
    });
  });

  it("keeps a structurally valid pre-D-126 metric set v26 ineligible before comparing metric keys", async () => {
    const paths = await fixture();
    await promoteBaseline({
      actor: "lead-agent",
      reason: "valid anchor before metric-set advance",
      reportBytes: Buffer.from(JSON.stringify(report())),
      reportPath: paths.reportPath,
      storePath: paths.storePath,
    });
    const store = await loadBaselineStore(paths.storePath);
    const [key] = Object.keys(store.entries);
    if (key === undefined) throw new Error("Test baseline store is empty");
    const baseline = store.entries[key];
    if (baseline === undefined) throw new Error("Test baseline record is missing");
    const olderMetricSet = {
      ...store,
      entries: {
        ...store.entries,
        [key]: {
          ...baseline,
          mandatoryMetricSetVersion: 26,
          metrics: baseline.metrics.slice(0, -1),
        },
      },
    };

    expect(evaluateBaselineSafely(report(), olderMetricSet)).toMatchObject({
      reason: expect.stringContaining("not comparable"),
      state: "ineligible",
    });
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

  it("rejects a verified postflight identity that validly drifted from preflight", () => {
    const value = report();
    const driftedTarget = {
      ...value.environment.target,
      servingContract: {
        ...value.environment.target.servingContract,
        documentCacheControl: "no-cache, must-revalidate",
      },
    };
    expect(() =>
      parseBaselineEligibleReport({
        ...value,
        environment: {
          ...value.environment,
          targetPostflight: { identity: driftedTarget, state: "verified" },
        },
      }),
    ).toThrow(/target preflight\/postflight evidence is contradictory/);
  });

  it("requires the exact current mandatory metric list and measured D-090/PSO evidence in every run", () => {
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        mandatoryMetricSet: {
          metrics: mandatoryMetricNames.filter((metric) => metric !== "greybox world content"),
          version: SMOKE_MANDATORY_METRIC_SET_VERSION,
        },
      }),
    ).toThrow(/mandatoryMetricSet\.metrics must contain exactly.*greybox world content/);
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        mandatoryMetricSet: {
          metrics: [...mandatoryMetricNames, "greybox world content"],
          version: SMOKE_MANDATORY_METRIC_SET_VERSION,
        },
      }),
    ).toThrow(/mandatoryMetricSet\.metrics must contain exactly/);
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        streamingCellLoadP95Variance: [
          {
            absoluteP95RangeMs: 0,
            allowedAbsoluteP95RangeMs: 2,
            profile: "fresh",
            relativeP95Range: 0,
            state: "measured",
          },
        ],
      }),
    ).toThrow(/streamingCellLoadP95Variance must contain exactly fresh and warm summaries/);
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        streamingCellLoadP95Variance: [
          {
            absoluteP95RangeMs: 2.01,
            allowedAbsoluteP95RangeMs: 2,
            profile: "fresh",
            relativeP95Range: 0.1005,
            state: "measured",
          },
          report().streamingCellLoadP95Variance[1],
        ],
      }),
    ).toThrow(/measured absolute p95 range must not exceed its allowance/);
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        streamingCellLoadP95Variance: [
          {
            ...report().streamingCellLoadP95Variance[0],
            allowedAbsoluteP95RangeMs: 1,
          },
          report().streamingCellLoadP95Variance[1],
        ],
      }),
    ).toThrow(/fresh summary must equal the variance recomputed from run evidence/);
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
    for (const invalidStreaming of [
      { ...validStreaming, cellLoadSamples: [] },
      {
        ...validStreaming,
        cellLoadSamples: validStreamingSamples.map((sample, index) =>
          index === 0 ? { ...sample, totalMs: Number.NaN } : sample,
        ),
      },
    ]) {
      expect(() =>
        parseBaselineEligibleReport({
          ...report(),
          runs: report().runs.map((run, index) =>
            index === 0
              ? {
                  ...run,
                  streaming: {
                    state: "measured",
                    value: invalidStreaming,
                  },
                }
              : run,
          ),
        }),
      ).toThrow(/runs\[0\]\.streaming\.value is invalid/);
    }
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
                    measurementStartBatch: {
                      batchDirectUploadMs: 27,
                      batchCellCount: 9,
                      batchFlythroughObserverSequence: 0,
                      batchObserverUpdateCount: 1,
                      batchOrdinal: 2,
                      batchTransactionId: "1:2:1:0",
                      completedCellIds: validStreamingSamples
                        .slice(0, 9)
                        .map((sample) => sample.cellId),
                      completedCellOrdinals: [1, 2, 3, 4, 5, 6, 7, 8, 9],
                    },
                    measurementStartCellLoadSampleCount: 9,
                    measurementStartObserverUpdateCount: 1,
                    measurementStartProactiveEvictionCount: 9,
                    measurementStartSettledObserverUpdateCount: 1,
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
          index === 1
            ? {
                ...run,
                streaming: {
                  state: "measured",
                  value: {
                    ...validStreaming,
                    measurementStartResidentCellCount: undefined,
                  },
                },
              }
            : run,
        ),
      }),
    ).toThrow(/measurementStartResidentCellCount must be an integer/);
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
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        runs: report().runs.map((run, index) => {
          if (index !== 0) return run;
          const { simulationController: _omitted, ...withoutController } = run;
          return withoutController;
        }),
      }),
    ).toThrow(/simulationController/);
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        runs: report().runs.map((run, index) =>
          index === 0
            ? {
                ...run,
                simulationController: {
                  state: "measured",
                  value: {
                    ...run.simulationController.value,
                    stepDurationHighWaterMs: Number.NaN,
                  },
                },
              }
            : run,
        ),
      }),
    ).toThrow(/stepDurationHighWaterMs must be a finite nonnegative number/);
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        runs: report().runs.map((run, index) =>
          index === 0
            ? {
                ...run,
                simulationController: {
                  state: "measured",
                  value: {
                    ...run.simulationController.value,
                    m3Exit: {
                      ...run.simulationController.value.m3Exit,
                      loadedStateHash: "f".repeat(64),
                    },
                  },
                },
              }
            : run,
        ),
      }),
    ).toThrow(/invalid playable fallback evidence/);
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        runs: report().runs.map((run, index) =>
          index === 0
            ? {
                ...run,
                simulationController: {
                  state: "measured",
                  value: {
                    ...run.simulationController.value,
                    m35Exit: {
                      ...run.simulationController.value.m35Exit,
                      questCompletedCount: 1,
                    },
                  },
                },
              }
            : run,
        ),
      }),
    ).toThrow(/invalid end-to-end gameplay evidence/);
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        runs: report().runs.map((run, index) =>
          index === 0
            ? {
                ...run,
                simulationController: {
                  state: "measured",
                  value: {
                    ...run.simulationController.value,
                    replaySecondStateHash: "a".repeat(64),
                  },
                },
              }
            : run,
        ),
      }),
    ).toThrow(/invalid replay\/save-load evidence/);
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        runs: report().runs.map((run, index) =>
          index === 0
            ? {
                ...run,
                simulationController: {
                  state: "measured",
                  value: {
                    ...run.simulationController.value,
                    saveLoadReloadedStateHash: "f".repeat(64),
                    saveLoadStateHash: "f".repeat(64),
                  },
                },
              }
            : run,
        ),
      }),
    ).toThrow(/invalid replay\/save-load evidence/);
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        runs: report().runs.map((run, index) =>
          index === 0
            ? {
                ...run,
                simulationController: {
                  state: "measured",
                  value: {
                    ...run.simulationController.value,
                    m3Exit: {
                      ...run.simulationController.value.m3Exit,
                      response: "The road is probably fine.",
                    },
                  },
                },
              }
            : run,
        ),
      }),
    ).toThrow(/invalid playable fallback evidence/);
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        runs: report().runs.map((run, index) =>
          index === 0
            ? {
                ...run,
                budgetChecks: run.budgetChecks.map((check) =>
                  check.metric === "simulationGameplayStepHighWaterMs"
                    ? { ...check, actual: 0.5 }
                    : check,
                ),
              }
            : run,
        ),
      }),
    ).toThrow(/controller budget check must agree/);
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        runs: report().runs.map((run, index) =>
          index === 0
            ? {
                ...run,
                budgetChecks: run.budgetChecks.map((check) =>
                  check.metric === "simulationGameplayStepHighWaterMs"
                    ? { ...check, actual: 50, limit: 100, passed: true }
                    : check,
                ),
                simulationController: {
                  state: "measured",
                  value: { ...run.simulationController.value, stepDurationHighWaterMs: 50 },
                },
              }
            : run,
        ),
      }),
    ).toThrow(/authoritative gameplay limit/);
    for (const [field, value] of [
      ["npcAgentCount", 1],
      ["navigationPathQueryCount", 1],
      ["navigationTileCount", 1],
      ["npcAvoidanceAdjustmentCount", 1.5],
    ] as const) {
      expect(() =>
        parseBaselineEligibleReport({
          ...report(),
          runs: report().runs.map((run, index) =>
            index === 0
              ? {
                  ...run,
                  simulationController: {
                    state: "measured",
                    value: { ...run.simulationController.value, [field]: value },
                  },
                }
              : run,
          ),
        }),
      ).toThrow(/gameplay crowd evidence|safe integer/);
    }
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        runs: report().runs.map((run, index) =>
          index === 0
            ? {
                ...run,
                psoWarmup: {
                  state: "measured",
                  value: { ...validPsoWarmup, traceSha256: "e".repeat(64) },
                },
              }
            : run,
        ),
      }),
    ).toThrow(/PSO warmup telemetry does not match the exact trace identity/);
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        runs: report().runs.map((run, index) =>
          index === 0
            ? {
                ...run,
                psoWarmup: {
                  reason: "PSO warmup retained a failed prior worker generation 1",
                  state: "invalid",
                },
              }
            : run,
        ),
      }),
    ).toThrow(/runs\[0\]\.psoWarmup\.state must be measured/);
  });

  it("rejects a reason on measured streaming cell-load p95 variance evidence", () => {
    expect(() =>
      parseBaselineEligibleReport({
        ...report(),
        streamingCellLoadP95Variance: [
          {
            ...report().streamingCellLoadP95Variance[0],
            reason: "measured evidence must not carry an invalidity reason",
          },
          report().streamingCellLoadP95Variance[1],
        ],
      }),
    ).toThrow(/streamingCellLoadP95Variance\[0\]\.reason must be absent when state is measured/);
  });

  it("validates bounded streaming repeatability while allowing invalid diagnostics to be promoted", async () => {
    const p95Values = [2.435, 1.85, 2.375, 2.445, 1.965, 2.355];
    const scaledStreaming = (targetP95: number) => {
      const scale = targetP95 / 20;
      const scaledSamples = validStreamingSamples.map((sample) => ({
        ...sample,
        decodeMs: sample.decodeMs * scale,
        decodeRoundTripMs: sample.decodeRoundTripMs * scale,
        decodeWaitMs: sample.decodeWaitMs * scale,
        opfsAccessRoundTripMs: sample.opfsAccessRoundTripMs * scale,
        opfsReadMs: sample.opfsReadMs * scale,
        opfsWaitMs: sample.opfsWaitMs * scale,
        renderTransactionRoundTripMs: sample.renderTransactionRoundTripMs * scale,
        renderTransactionWaitMs: sample.renderTransactionWaitMs * scale,
        streamingWorkerRemainderMs: sample.streamingWorkerRemainderMs * scale,
        totalMs: sample.totalMs * scale,
        uploadMs: sample.uploadMs * scale,
      }));
      return {
        ...validStreaming,
        cellLoadSamples: scaledSamples,
        measurementCellLoadSamples: scaledSamples,
      };
    };
    const runs = report().runs.map((run, index) => ({
      ...run,
      budgetChecks: run.budgetChecks.map((check) =>
        check.metric === "streamingCellLoadP95Ms"
          ? { ...check, actual: p95Values[index] ?? 0 }
          : check,
      ),
      streaming: {
        state: "measured" as const,
        value: scaledStreaming(p95Values[index] ?? 0),
      },
    }));
    const summariesFor = (candidateRuns: typeof runs) =>
      (["fresh", "warm"] as const).map((profile) => {
        const repeatability = evaluateBoundedRepeatability(
          candidateRuns
            .filter((run) => run.profile === profile)
            .map((run) => requireStreamingEvidence(run.streaming.value).cellLoadP95Ms),
          3,
          "streaming cell-load p95",
          SMOKE_STREAMING_P95_RELATIVE_RANGE_LIMIT,
          SMOKE_STREAMING_P95_ABSOLUTE_RANGE_FLOOR_MS,
        );
        return repeatability.state === "invalid"
          ? {
              absoluteP95RangeMs: repeatability.absoluteRange,
              allowedAbsoluteP95RangeMs: repeatability.allowedAbsoluteRange,
              profile,
              reason: repeatability.reason,
              relativeP95Range: repeatability.relativeRange,
              state: repeatability.state,
            }
          : {
              absoluteP95RangeMs: repeatability.absoluteRange,
              allowedAbsoluteP95RangeMs: repeatability.allowedAbsoluteRange,
              profile,
              relativeP95Range: repeatability.relativeRange,
              state: repeatability.state,
            };
      });
    const summaries = summariesFor(runs);
    const bounded = report({
      runs,
      streamingCellLoadP95Variance: summaries,
    });

    expect(parseBaselineEligibleReport(bounded)).toMatchObject({ passed: true });
    expect(() =>
      parseBaselineEligibleReport({
        ...bounded,
        streamingCellLoadP95Variance: bounded.streamingCellLoadP95Variance.map((summary, index) =>
          index === 0 ? { ...summary, allowedAbsoluteP95RangeMs: 1.001 } : summary,
        ),
      }),
    ).toThrow(/fresh summary must equal the variance recomputed from run evidence/);

    const overLimitRuns = runs.map((run, index) => {
      if (index !== 0) return run;
      const cellLoadP95Ms = 3.2;
      return {
        ...run,
        budgetChecks: run.budgetChecks.map((check) =>
          check.metric === "streamingCellLoadP95Ms" ? { ...check, actual: cellLoadP95Ms } : check,
        ),
        streaming: { state: "measured" as const, value: scaledStreaming(cellLoadP95Ms) },
      };
    });
    const overLimitSummaries = summariesFor(overLimitRuns);
    expect(overLimitSummaries[0]).toMatchObject({ state: "invalid" });
    const diagnosticBounded = report({
      informationalFailures: overLimitSummaries.flatMap((summary) =>
        summary.state === "invalid"
          ? [`${summary.profile} streaming cell-load p95 variance: ${summary.reason}`]
          : [],
      ),
      runs: overLimitRuns,
      streamingCellLoadP95Variance: overLimitSummaries,
    });
    expect(parseBaselineEligibleReport(diagnosticBounded)).toMatchObject({
      facets: {
        budgetEvaluation: { evaluatedChecks: 36, status: "passed" },
        environment: { status: "passed" },
        evidenceCompleteness: { status: "passed" },
      },
      passed: true,
    });
    const paths = await fixture();
    await expect(
      promoteBaseline({
        actor: "lead-agent",
        reason: "informational repeatability must not block promotion",
        reportBytes: Buffer.from(JSON.stringify(diagnosticBounded)),
        reportPath: paths.reportPath,
        storePath: paths.storePath,
      }),
    ).resolves.toMatchObject({
      mandatoryMetricSetVersion: SMOKE_MANDATORY_METRIC_SET_VERSION,
      reportSchemaVersion: SMOKE_REPORT_SCHEMA_VERSION,
    });
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

  it("requires top-level release identity to match the verified target before promotion", () => {
    const { releaseDigest: _omitted, ...missingRelease } = report();
    expect(() => parseBaselineEligibleReport(missingRelease)).toThrow(/releaseDigest/);
    expect(() =>
      parseBaselineEligibleReport({ ...report(), releaseDigest: "c".repeat(64) }),
    ).toThrow(/target release digest must match releaseDigest/);
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
    ).toThrow(/evaluatedChecks must equal 36/);

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
    const firstBaseline = firstStore.entries["smoke@1|dev-01|showcase|local|http://127.0.0.1"];
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
    expect(replaced.entries["smoke@1|dev-01|showcase|local|http://127.0.0.1"]).toMatchObject({
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
    const firstBaseline = firstStore.entries["smoke@1|dev-01|showcase|local|http://127.0.0.1"];
    if (firstBaseline === undefined) throw new Error("Expected the first promoted baseline");
    const originalEnvironment = report().environment;
    const changedArtifact = report({
      artifactDigest: "d".repeat(64),
      baseline: {
        baseline: firstBaseline,
        reason: "artifact differs",
        state: "ineligible",
      },
      environment: {
        ...originalEnvironment,
        target: targetIdentity("d".repeat(64)),
        targetPostflight: {
          identity: targetIdentity("d".repeat(64)),
          state: "verified",
        },
        targetPreflight: {
          identity: targetIdentity("d".repeat(64)),
          state: "verified",
        },
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
      chromePin: { ...report().chromePin, revision: "101", version: "151.0.0.0" },
      environment: {
        ...report().environment,
        browserProduct: "Chrome/151.0.0.0",
      },
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
      "smoke@1|dev-01|showcase|local|http://127.0.0.1",
      "smoke@1|dev-02|showcase|local|http://127.0.0.1",
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
