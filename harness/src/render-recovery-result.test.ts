import { describe, expect, it } from "vitest";
import {
  renderRecoveryEnvironmentMatchesReference,
  validateRenderRecoveryReportContract,
} from "./render-recovery-result.js";
import {
  RENDER_RECOVERY_ATTEMPTS,
  RENDER_RECOVERY_MANDATORY_METRICS,
} from "./runs/render-recovery.js";

describe("render-recovery result schema", () => {
  it("accepts a structurally complete invalid report with retained partial shells", () => {
    expect(() => validateRenderRecoveryReportContract(invalidReport())).not.toThrow();
  });

  it("keeps environment eligibility independent from failed recovery evidence", () => {
    const value = invalidReport();
    const { actual, pin, reference } = eligibleEnvironment();
    expect(() =>
      validateRenderRecoveryReportContract({
        ...value,
        attempts: value.attempts.map((attempt) => ({ ...attempt, environment: actual })),
        chromePin: {
          ...value.chromePin,
          executableSha256: pin.executableSha256,
          version: pin.version,
        },
        environment: {
          ...value.environment,
          ...reference,
          gateIdentity: { state: "measured", value: true },
          machineId: "dev-01",
        },
        facets: {
          ...value.facets,
          environment: { reasons: [], status: "passed" },
        },
      }),
    ).not.toThrow();
  });

  it.each([
    ["idle", initialLatestTelemetry()],
    ["worker-startup idle generation 1", workerStartupIdleLatestTelemetry(1)],
    ["recovery worker-startup idle generation 2", workerStartupIdleLatestTelemetry(2)],
    ["starting", startingLatestTelemetry()],
    ["recovery service starting", recoveryStartingLatestTelemetry()],
    ["provisioning", provisioningLatestTelemetry()],
    ["provisioning after decode-pool creation", provisioningLatestTelemetry(16, 4)],
    ["streaming", streamingLatestTelemetry()],
    ["recovering", recoveringLatestTelemetry()],
    [
      "streaming disposed before first settlement",
      streamingDisposedBeforeSettlementLatestTelemetry(),
    ],
    ["streaming disposed", streamingDisposedLatestTelemetry()],
    ["recovery streaming disposed", streamingDisposedLatestTelemetry(2)],
    ["render disposed during recovery", renderDisposedDuringRecoveryLatestTelemetry()],
    ["render disposed after failure", renderDisposedAfterFailureLatestTelemetry()],
    ["render failed after ready", readyRenderFailureLatestTelemetry()],
    ["render disposed after ready failure", readyRenderFailureLatestTelemetry(true)],
    ["render failed during replacement startup", recoveryRenderFailureLatestTelemetry(false)],
    ["render failed after recovery", recoveryRenderFailureLatestTelemetry(true)],
    [
      "render disposed after post-recovery failure",
      recoveryRenderFailureLatestTelemetry(true, true),
    ],
    ["streaming failed before start identity", preIdentityStreamingFailureLatestTelemetry()],
    [
      "streaming failed during service generation-1 start",
      streamingFailureFromLatestTelemetry(startingLatestTelemetry()),
    ],
    [
      "streaming failed during service generation-2 start",
      streamingFailureFromLatestTelemetry(recoveryStartingLatestTelemetry()),
    ],
    [
      "streaming failed after generation-1 identity but before observers",
      streamingFailureFromLatestTelemetry(workerStartupIdleLatestTelemetry(1)),
    ],
    [
      "streaming failed after generation-2 identity but before observers",
      streamingFailureFromLatestTelemetry(workerStartupIdleLatestTelemetry(2)),
    ],
    ["streaming failed before decode-pool creation", streamingFailureLatestTelemetry(false)],
    [
      "streaming failed during recovery before decode-pool creation",
      streamingFailureFromLatestTelemetry(recoveryProvisioningLatestTelemetry()),
    ],
    [
      "streaming failed after decode-pool creation but before settlement",
      preSettlementDecodePoolStreamingFailureLatestTelemetry(),
    ],
    [
      "streaming failed during recovery after decode-pool creation but before settlement",
      streamingFailureFromLatestTelemetry(recoveryProvisioningLatestTelemetry(4)),
    ],
    ["streaming failed after decode-pool creation", streamingFailureLatestTelemetry(true)],
    [
      "streaming failed after recovery settlement",
      streamingFailureFromLatestTelemetry(streamingLatestTelemetry(2)),
    ],
    ["failed", failedLatestTelemetry()],
  ])("accepts a valid %s partial telemetry lifecycle without changing failed evidence", (_, telemetry) => {
    const value = reportWithLatestTelemetry(telemetry);
    expect(value.facets.evidenceCompleteness.status).toBe("failed");
    expect(value.facets.budgetEvaluation.status).toBe("not-evaluated");
    expect(value.passed).toBe(false);
    expect(() => validateRenderRecoveryReportContract(value)).not.toThrow();
  });

  it.each([
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 2],
    [5, 3],
    [6, 4],
    [64, 4],
  ])("accepts hardwareConcurrency %i with producer decode-pool size %i", (hardwareConcurrency, decodeWorkerCount) => {
    expect(() =>
      validateRenderRecoveryReportContract(
        reportWithLatestTelemetry(
          streamingLatestTelemetry(1, hardwareConcurrency, decodeWorkerCount),
        ),
      ),
    ).not.toThrow();
    expect(() =>
      validateRenderRecoveryReportContract(
        reportWithLatestTelemetry(
          provisioningLatestTelemetry(hardwareConcurrency, decodeWorkerCount),
        ),
      ),
    ).not.toThrow();
  });

  it.each([
    [
      "service-idle render generation",
      () => {
        const telemetry = initialLatestTelemetry();
        return {
          ...telemetry,
          render: {
            ...telemetry.render,
            recovery: { ...telemetry.render.recovery, workerGeneration: 1 },
          },
        };
      },
    ],
    [
      "generation-1 worker-startup idle with restored observer counters",
      () => {
        const telemetry = workerStartupIdleLatestTelemetry(1);
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            observerUpdateCount: 1,
            settledObserverUpdateCount: 1,
          },
        };
      },
    ],
    [
      "generation-2 worker-startup idle with an unsettled restored counter",
      () => {
        const telemetry = workerStartupIdleLatestTelemetry(2);
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            settledObserverUpdateCount: telemetry.streaming.observerUpdateCount - 1,
          },
        };
      },
    ],
    [
      "worker-startup idle with a checkpoint published before provisioning",
      () => {
        const telemetry = workerStartupIdleLatestTelemetry(2);
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            settledRecoveryCheckpoint: { ...settledCheckpoint(), workerGeneration: 2 },
          },
        };
      },
    ],
    [
      "idle streaming observers",
      () => {
        const telemetry = initialLatestTelemetry();
        return {
          ...telemetry,
          streaming: { ...telemetry.streaming, currentObservers: [[0, 0, 0]] },
        };
      },
    ],
    [
      "starting render output",
      () => {
        const telemetry = startingLatestTelemetry();
        return { ...telemetry, render: { ...telemetry.render, frameCount: 1 } };
      },
    ],
    [
      "generation-1 service starting with worker hardware identity",
      () => {
        const telemetry = startingLatestTelemetry();
        return {
          ...telemetry,
          streaming: { ...telemetry.streaming, hardwareConcurrency: 16 },
        };
      },
    ],
    [
      "generation-2 service starting without retained hardware identity",
      () => {
        const telemetry = recoveryStartingLatestTelemetry();
        return {
          ...telemetry,
          streaming: { ...telemetry.streaming, hardwareConcurrency: 0 },
        };
      },
    ],
    [
      "starting streaming generation",
      () => {
        const telemetry = startingLatestTelemetry();
        return { ...telemetry, streaming: { ...telemetry.streaming, workerGeneration: 0 } };
      },
    ],
    [
      "provisioning without observers",
      () => {
        const telemetry = provisioningLatestTelemetry();
        return { ...telemetry, streaming: { ...telemetry.streaming, currentObservers: [] } };
      },
    ],
    [
      "provisioning with a settled checkpoint",
      () => {
        const telemetry = provisioningLatestTelemetry();
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            settledRecoveryCheckpoint: settledCheckpoint(),
          },
        };
      },
    ],
    [
      "provisioning without worker hardware identity",
      () => {
        const telemetry = provisioningLatestTelemetry();
        return {
          ...telemetry,
          streaming: { ...telemetry.streaming, hardwareConcurrency: 0 },
        };
      },
    ],
    [
      "provisioning with a non-producer decode-pool size",
      () => {
        const telemetry = provisioningLatestTelemetry(4, 1);
        return {
          ...telemetry,
          streaming: { ...telemetry.streaming, decodeWorkerCount: 3 },
        };
      },
    ],
    [
      "provisioning before decode-pool creation with decode-produced residency",
      () => {
        const telemetry = provisioningLatestTelemetry();
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            residentCellCount: 1,
            residentCellIds: ["d1:0:0"],
          },
        };
      },
    ],
    [
      "streaming before decode-pool publication",
      () => {
        const telemetry = streamingLatestTelemetry();
        return {
          ...telemetry,
          streaming: { ...telemetry.streaming, decodeWorkerCount: 0 },
        };
      },
    ],
    [
      "streaming with a non-producer low-core decode-pool size",
      () => {
        const telemetry = streamingLatestTelemetry();
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            decodeWorkerCount: 2,
            hardwareConcurrency: 3,
          },
        };
      },
    ],
    [
      "failed render without failure identity",
      () => {
        const telemetry = failedLatestTelemetry();
        return { ...telemetry, render: { ...telemetry.render, failureMessage: null } };
      },
    ],
    [
      "failed render with a half-published ready payload",
      () => {
        const telemetry = failedLatestTelemetry();
        return {
          ...telemetry,
          render: { ...telemetry.render, frameCount: 1 },
        };
      },
    ],
    [
      "disposed failed render with a half-published ready payload",
      () => {
        const telemetry = renderDisposedAfterFailureLatestTelemetry();
        return {
          ...telemetry,
          render: { ...telemetry.render, frameCount: 1 },
        };
      },
    ],
    [
      "replacement-startup render failure with a completed restart duration",
      () => {
        const telemetry = recoveryRenderFailureLatestTelemetry(false);
        return {
          ...telemetry,
          render: {
            ...telemetry.render,
            recovery: { ...telemetry.render.recovery, lastRestartDurationMs: 1 },
          },
        };
      },
    ],
    [
      "post-recovery render failure without its completed restart duration",
      () => {
        const telemetry = recoveryRenderFailureLatestTelemetry(true);
        return {
          ...telemetry,
          render: {
            ...telemetry.render,
            recovery: { ...telemetry.render.recovery, lastRestartDurationMs: null },
          },
        };
      },
    ],
    [
      "failed streaming without failure identity",
      () => {
        const telemetry = failedLatestTelemetry();
        return { ...telemetry, streaming: { ...telemetry.streaming, failureMessage: null } };
      },
    ],
    [
      "failed streaming with a checkpoint but no published decode pool",
      () => {
        const telemetry = streamingFailureLatestTelemetry(true);
        return {
          ...telemetry,
          streaming: { ...telemetry.streaming, decodeWorkerCount: 0 },
        };
      },
    ],
    // The adversarial states below cite the producer order in
    // world-streaming-service.ts launchWorker() and streaming-worker.ts
    // initialize()/createDecodePool(): generation identity precedes observers,
    // while decode-pool publication follows observers.
    [
      "generation-0 failed streaming with a fabricated decode pool",
      () => {
        const telemetry = preIdentityStreamingFailureLatestTelemetry();
        return {
          ...telemetry,
          streaming: { ...telemetry.streaming, decodeWorkerCount: 4 },
        };
      },
    ],
    [
      "generation-1 failed streaming with a decode pool before observers",
      () => {
        const telemetry = streamingFailureFromLatestTelemetry(workerStartupIdleLatestTelemetry(1));
        return {
          ...telemetry,
          streaming: { ...telemetry.streaming, decodeWorkerCount: 4 },
        };
      },
    ],
    [
      "generation-2 failed streaming with a decode pool before observers",
      () => {
        const telemetry = streamingFailureFromLatestTelemetry(workerStartupIdleLatestTelemetry(2));
        return {
          ...telemetry,
          streaming: { ...telemetry.streaming, decodeWorkerCount: 4 },
        };
      },
    ],
    [
      "generation-0 failed streaming with observers before start identity",
      () => {
        const telemetry = preIdentityStreamingFailureLatestTelemetry();
        return {
          ...telemetry,
          streaming: { ...telemetry.streaming, currentObservers: [[0, 12, 0]] },
        };
      },
    ],
    [
      "generation-1 pre-checkpoint failure with a fabricated settled count",
      () => {
        const telemetry = preSettlementDecodePoolStreamingFailureLatestTelemetry();
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            observerUpdateCount: 1,
            settledObserverUpdateCount: 1,
          },
        };
      },
    ],
    [
      "generation-1 pre-checkpoint failure with a direct-only observer delta",
      () => {
        const telemetry = preSettlementDecodePoolStreamingFailureLatestTelemetry();
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            observerUpdateCount: 1,
          },
        };
      },
    ],
    [
      "checkpoint-bearing failure whose flythrough delta exceeds its total observer delta",
      () => {
        const telemetry = streamingFailureFromLatestTelemetry(streamingLatestTelemetry(2));
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            flythroughObserverUpdateCount: 9,
            observerUpdateCount: 9,
          },
        };
      },
    ],
    [
      "checkpoint-bearing settled failure whose observers diverge from the checkpoint",
      () => {
        const telemetry = streamingFailureLatestTelemetry(true);
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            currentObservers: [[96, 12, 0]],
          },
        };
      },
    ],
    [
      "checkpoint-null post-pool failure with a recorded sample count",
      () => {
        const telemetry = preSettlementDecodePoolStreamingFailureLatestTelemetry();
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            cellLoadSampleCount: 1,
            cellLoadSamples: [streamingCellLoadSample()],
          },
        };
      },
    ],
    [
      "checkpoint-null post-pool failure with sample count but no retained sample",
      () => {
        const telemetry = preSettlementDecodePoolStreamingFailureLatestTelemetry();
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            cellLoadSampleCount: 1,
          },
        };
      },
    ],
    [
      "empty current residency with encoded bytes",
      () => {
        const telemetry = preSettlementDecodePoolStreamingFailureLatestTelemetry();
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            residentEncodedBytes: 1,
            residentEncodedBytesHighWater: 1,
          },
        };
      },
    ],
    [
      "nonempty current residency without GPU bytes",
      () => {
        const telemetry = preSettlementDecodePoolStreamingFailureLatestTelemetry();
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            residentCellCount: 1,
            residentCellIds: ["d1:0:0"],
            residentEncodedBytes: 1,
            residentEncodedBytesHighWater: 1,
          },
        };
      },
    ],
    [
      "current residency count that diverges from its unique IDs",
      () => {
        const telemetry = streamingFailureLatestTelemetry(true);
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            residentCellCount: 8,
          },
        };
      },
    ],
    [
      "current residency with duplicate IDs",
      () => {
        const telemetry = streamingFailureLatestTelemetry(true);
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            residentCellIds: ["d1:0:0", "d1:0:0", ...settledCheckpoint().residentCellIds.slice(2)],
          },
        };
      },
    ],
    [
      "disposed streaming residency that was not drained",
      () => {
        const telemetry = streamingDisposedLatestTelemetry();
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            residentCellCount: 1,
            residentCellIds: ["d1:0:0"],
            residentEncodedBytes: 1,
            residentGpuBytes: 1,
          },
        };
      },
    ],
    [
      "disposed streaming checkpoint whose observers do not match",
      () => {
        const telemetry = streamingDisposedLatestTelemetry();
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            currentObservers: [[96, 12, 0]],
          },
        };
      },
    ],
    [
      "generation-1 streaming disposal with restored recovery counters",
      () => {
        const telemetry = streamingDisposedBeforeSettlementLatestTelemetry();
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            observerUpdateCount: 1,
            settledObserverUpdateCount: 1,
          },
        };
      },
    ],
    [
      "disposed streaming residency without decode work",
      () => {
        const telemetry = streamingDisposedLatestTelemetry();
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            decodeQueueDepthHighWater: 0,
          },
        };
      },
    ],
    [
      "disposed streaming lifecycle with an impossible decode pool",
      () => {
        const telemetry = streamingDisposedBeforeSettlementLatestTelemetry();
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            decodeWorkerCount: 3,
          },
        };
      },
    ],
    [
      "checkpoint-null disposed streaming after decode-pool creation",
      () => {
        const telemetry = streamingDisposedBeforeSettlementLatestTelemetry();
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            decodeWorkerCount: 4,
          },
        };
      },
    ],
    [
      "checkpoint-bearing disposed streaming before decode-pool creation",
      () => {
        const telemetry = streamingDisposedLatestTelemetry();
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            decodeWorkerCount: 0,
          },
        };
      },
    ],
    [
      "disposed streaming lifecycle with a failure",
      () => {
        const telemetry = streamingDisposedLatestTelemetry();
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            failureMessage: "disposal failed",
          },
        };
      },
    ],
    [
      "disposed streaming recovery identity mismatch",
      () => {
        const telemetry = streamingDisposedLatestTelemetry(2);
        return {
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            renderRecoveryCount: 0,
          },
        };
      },
    ],
    [
      "disposed render that fabricates exhaustion without a failure",
      () => {
        const telemetry = recoveringLatestTelemetry();
        return {
          ...telemetry,
          render: {
            ...telemetry.render,
            recovery: { ...telemetry.render.recovery, state: "exhausted" },
            state: "disposed",
          },
        };
      },
    ],
    [
      "disposed render failure that does not preserve exhaustion",
      () => {
        const telemetry = renderDisposedAfterFailureLatestTelemetry();
        return {
          ...telemetry,
          render: {
            ...telemetry.render,
            recovery: { ...telemetry.render.recovery, state: "restarting" },
          },
        };
      },
    ],
  ])("rejects the %s partial telemetry contradiction", (_, mutate) => {
    expect(() => validateRenderRecoveryReportContract(reportWithLatestTelemetry(mutate()))).toThrow(
      /lifecycle|contradictory/,
    );
  });

  it("accepts valid failed observer transitions and partial residency disposal", () => {
    const generationOne = preSettlementDecodePoolStreamingFailureLatestTelemetry();
    expect(() =>
      validateRenderRecoveryReportContract(
        reportWithLatestTelemetry({
          ...generationOne,
          streaming: {
            ...generationOne.streaming,
            flythroughObserverUpdateCount: 1,
            observerUpdateCount: 1,
          },
        }),
      ),
    ).not.toThrow();

    const preSettlementMovement = preSettlementDecodePoolStreamingFailureLatestTelemetry();
    expect(() =>
      validateRenderRecoveryReportContract(
        reportWithLatestTelemetry({
          ...preSettlementMovement,
          streaming: {
            ...preSettlementMovement.streaming,
            currentObservers: [[96, 12, 0]],
            decodeQueueDepthHighWater: 9,
            encodedBytesRead: 9_000,
            flythroughObserverUpdateCount: 2,
            observerUpdateCount: 2,
            proactiveEvictionCount: 1,
            residentCellCount: 8,
            residentCellIds: settledCheckpoint().residentCellIds.slice(0, -1),
            residentEncodedBytes: 8_000,
            residentEncodedBytesHighWater: 9_000,
            residentGpuBytes: 16_000,
            residentGpuBytesHighWater: 18_000,
          },
        }),
      ),
    ).not.toThrow();

    const checkpointTransition = streamingFailureFromLatestTelemetry(streamingLatestTelemetry(2));
    expect(() =>
      validateRenderRecoveryReportContract(
        reportWithLatestTelemetry({
          ...checkpointTransition,
          streaming: {
            ...checkpointTransition.streaming,
            currentObservers: [[96, 12, 0]],
            flythroughObserverUpdateCount: 8,
            observerUpdateCount: 10,
          },
        }),
      ),
    ).not.toThrow();

    const partialDisposal = streamingFailureLatestTelemetry(true);
    expect(() =>
      validateRenderRecoveryReportContract(
        reportWithLatestTelemetry({
          ...partialDisposal,
          streaming: {
            ...partialDisposal.streaming,
            residentCellCount: 8,
            residentCellIds: settledCheckpoint().residentCellIds.slice(0, -1),
            residentEncodedBytes: 8_000,
            residentGpuBytes: 16_000,
          },
        }),
      ),
    ).not.toThrow();
  });

  it("binds generation-2 checkpoint-null telemetry to its retained pre-fault baseline", () => {
    const telemetry = streamingFailureFromLatestTelemetry(recoveryProvisioningLatestTelemetry(4));
    expect(() =>
      validateRenderRecoveryReportContract(reportWithLatestTelemetry(telemetry)),
    ).not.toThrow();
  });

  it.each([
    [
      "flythrough and total observer advancement",
      { flythroughObserverUpdateCount: 8, observerUpdateCount: 9 },
    ],
    ["direct observer advancement", { observerUpdateCount: 9 }],
    ["settled counter divergence", { settledObserverUpdateCount: 7 }],
    ["observer position divergence", { currentObservers: [[96, 12, 0]] }],
  ])("rejects generation-2 checkpoint-null %s from the pre-fault baseline", (_, patch) => {
    const telemetry = streamingFailureFromLatestTelemetry(recoveryProvisioningLatestTelemetry(4));
    expect(() =>
      validateRenderRecoveryReportContract(
        reportWithLatestTelemetry({
          ...telemetry,
          streaming: {
            ...telemetry.streaming,
            ...patch,
          },
        }),
      ),
    ).toThrow(/baseline|diverges/);
  });

  it("rejects generation-2 checkpoint-null telemetry without a retained pre-fault baseline", () => {
    expect(() =>
      validateRenderRecoveryReportContract(
        reportWithLatestTelemetry(recoveryProvisioningLatestTelemetry(4), null),
      ),
    ).toThrow(/baseline/);
  });

  it("rejects an empty measured result and an empty facet shell", () => {
    const value = invalidReport();
    expect(() =>
      validateRenderRecoveryReportContract({
        ...value,
        attempts: value.attempts.map((attempt, index) =>
          index === 0
            ? {
                browserErrors: [],
                environment: {},
                failureMessage: null,
                id: attempt.id,
                profileLineage: attempt.profileLineage,
                result: {},
                state: "measured",
              }
            : attempt,
        ),
      }),
    ).toThrow();
    expect(() => validateRenderRecoveryReportContract({ ...value, facets: {} })).toThrow(/facet/i);
  });

  it("rejects tampered source, runtime, time, profile, and verdict evidence", () => {
    const value = invalidReport();
    expect(() =>
      validateRenderRecoveryReportContract({
        ...value,
        source: { ...value.source, commit: "not-a-commit" },
      }),
    ).toThrow(/source commit/);
    expect(() =>
      validateRenderRecoveryReportContract({
        ...value,
        harnessRuntime: { ...value.harnessRuntime, eligible: false },
      }),
    ).toThrow(/eligibility/);
    expect(() =>
      validateRenderRecoveryReportContract({ ...value, generatedAt: "yesterday" }),
    ).toThrow(/time/);
    expect(() =>
      validateRenderRecoveryReportContract({
        ...value,
        attempts: value.attempts.map((attempt, index) =>
          index === 0
            ? { ...attempt, profileLineage: { history: ["warm"], id: "forged" } }
            : attempt,
        ),
      }),
    ).toThrow(/profile lineage/);
    expect(() => validateRenderRecoveryReportContract({ ...value, passed: true })).toThrow(
      /verdict/,
    );
    expect(() =>
      validateRenderRecoveryReportContract({
        ...value,
        attempts: value.attempts.map((attempt, index) =>
          index === 0
            ? { ...attempt, partial: { ...attempt.partial, latestTelemetry: {} } }
            : attempt,
        ),
      }),
    ).toThrow(/latest telemetry/);
  });

  it("recomputes pinned, sandboxed, local-display environment identity from retained fields", () => {
    const { actual, pin, reference } = eligibleEnvironment();
    expect(renderRecoveryEnvironmentMatchesReference(actual, reference, pin)).toBe(true);
    for (const mutation of [
      { ...actual, browserProduct: "Chrome/999.0.0.0" },
      { ...actual, executableSha256: "f".repeat(64) },
      { ...actual, browserCommandLine: "chrome --start-fullscreen --no-sandbox" },
      { ...actual, requestedTier: "standard" },
      { ...actual, targetDisplayMode: "2560x1440@120Hz" },
      { ...actual, hostAfter: { ...actual.hostAfter, remoteSession: true } },
      { ...actual, sandboxVerified: false },
    ]) {
      expect(renderRecoveryEnvironmentMatchesReference(mutation, reference, pin)).toBe(false);
    }
    expect(
      renderRecoveryEnvironmentMatchesReference(
        actual,
        { ...reference, executableSha256: "f".repeat(64) },
        pin,
      ),
    ).toBe(false);
  });
});

function eligibleEnvironment() {
  const display = {
    probeFailures: [],
    refreshRatesHz: [60],
    screen: {
      availHeight: 2_160,
      availWidth: 3_840,
      colorDepth: 24,
      devicePixelRatio: 1,
      height: 2_160,
      width: 3_840,
    },
  };
  const host = {
    cpu: { cores: 8, logicalProcessors: 16, name: "CPU" },
    os: { build: "1", caption: "Windows" },
    physicalMemoryBytes: 32_000_000_000,
    power: { guid: "power", name: "Performance" },
    remoteSession: false,
    videoControllers: [],
  };
  const adapter = {
    architecture: "gpu",
    backend: null,
    description: "GPU",
    device: "device",
    driver: null,
    isFallbackAdapter: false,
    type: null,
    vendor: "vendor",
  };
  const digest = "c".repeat(64);
  const gpuDevices = [
    {
      deviceId: 1,
      deviceString: "GPU",
      driverVendor: "vendor",
      driverVersion: "1",
      revision: 1,
      subSysId: 1,
      vendorId: 1,
      vendorString: "vendor",
    },
  ];
  const pin = {
    executableSha256: { win64: digest },
    version: "151.0.7922.34",
  };
  const reference = {
    adapter,
    browserDisplay: display,
    browserProduct: "Chrome/151.0.7922.34",
    browserRevision: "revision",
    browserUserAgent: "agent",
    executableSha256: digest,
    gpuDevices,
    host,
    hostAfterRuns: host,
    identityProbeBrowserCommandLine: "chrome --start-fullscreen",
    jsVersion: "v8",
    requestedTier: "showcase",
    sandboxVerified: true,
    targetDisplayMode: "3840x2160@60Hz",
  };
  const actual = {
    adapter,
    browserCommandLine: "chrome --start-fullscreen",
    browserDisplayAfter: display,
    browserDisplayBefore: display,
    browserProduct: reference.browserProduct,
    browserRevision: reference.browserRevision,
    browserUserAgent: reference.browserUserAgent,
    executableSha256: digest,
    gpuDevices,
    hostAfter: host,
    hostBefore: host,
    jsVersion: reference.jsVersion,
    requestedTier: "showcase",
    sandboxVerified: true,
    targetDisplayMode: "3840x2160@60Hz",
  };
  return { actual, pin, reference };
}

function invalidReport() {
  return {
    artifactDigest: "a".repeat(64),
    attempts: RENDER_RECOVERY_ATTEMPTS.map(({ id }) => ({
      browserErrors: ["attempt failed"],
      environment: null,
      failureMessage: "attempt failed",
      id,
      partial: {
        afterFirstRecovery: null,
        afterSecondFault: null,
        beforeFault: null,
        elapsedMs: null,
        initial: null,
        latestTelemetry: null,
        visibleCanvas: null,
      },
      profileLineage: { history: ["fresh"], id: `independent-fresh-${id}` },
      result: null,
      state: "invalid",
    })),
    chromePin: {
      channel: "stable",
      downloads: { win64: "https://example.invalid/chrome.zip" },
      executableSha256: { win64: "c".repeat(64) },
      revision: "123",
      version: "151.0.7922.34",
    },
    environment: {
      adapter: null,
      browserDisplay: null,
      browserProduct: "unavailable",
      browserRevision: "unavailable",
      browserUserAgent: "unavailable",
      executableSha256: "d".repeat(64),
      gateIdentity: { reasons: ["identity unavailable"], state: "invalid", value: false },
      gpuDevices: [],
      host: null,
      hostAfterRuns: null,
      identityProbeBrowserCommandLine: "unavailable",
      jsVersion: "unavailable",
      machineId: "dev-01",
      requestedTier: "showcase",
      sandboxVerified: true,
      targetDisplayMode: "1920x1080@60",
    },
    facets: {
      budgetEvaluation: {
        evaluatedChecks: 0,
        reasons: ["Mandatory metric evidence is incomplete"],
        status: "not-evaluated",
      },
      environment: { reasons: ["identity unavailable"], status: "failed" },
      evidenceCompleteness: { reasons: ["attempts failed"], status: "failed" },
    },
    generatedAt: "2026-07-25T12:00:00.000Z",
    harnessRuntime: {
      eligible: true,
      expectedNodeVersion: "24.18.0",
      nodeExecutableSha256: "e".repeat(64),
      nodeVersion: "v24.18.0",
    },
    mandatoryMetricSet: {
      metrics: RENDER_RECOVERY_MANDATORY_METRICS,
      version: 3,
    },
    passed: false,
    runFailure: null,
    scenario: "render-recovery@1",
    schemaVersion: 11,
    source: { commit: "b".repeat(40), dirtyTreeDigest: null },
  };
}

function reportWithLatestTelemetry(
  latestTelemetry: unknown,
  beforeFault: unknown = needsRecoveryBaseline(latestTelemetry) ? beforeFaultBoundary() : null,
) {
  const value = invalidReport();
  return {
    ...value,
    attempts: value.attempts.map((attempt, index) =>
      index === 0
        ? { ...attempt, partial: { ...attempt.partial, beforeFault, latestTelemetry } }
        : attempt,
    ),
  };
}

function needsRecoveryBaseline(latestTelemetry: unknown): boolean {
  if (
    typeof latestTelemetry !== "object" ||
    latestTelemetry === null ||
    !("streaming" in latestTelemetry)
  ) {
    return false;
  }
  const streaming = latestTelemetry.streaming;
  return (
    typeof streaming === "object" &&
    streaming !== null &&
    "workerGeneration" in streaming &&
    streaming.workerGeneration === 2 &&
    "settledRecoveryCheckpoint" in streaming &&
    streaming.settledRecoveryCheckpoint === null
  );
}

function initialLatestTelemetry() {
  return {
    appOwnedLlmSpike: {},
    flythrough: {
      checkpointEvidence: [],
      failureMessage: null,
      preflightElapsedMs: null,
      render: null,
      scenarioId: "flythrough-d1@1",
      schemaVersion: 3,
      state: "idle",
      streamingAtMeasurementEnd: null,
      streamingAtMeasurementStart: null,
      validation: {},
    },
    identity: {},
    render: {
      decoderBootstrap: null,
      decoderFixtures: null,
      failureMessage: null,
      flythrough: null,
      frameCount: 0,
      greyboxWorld: null,
      recentFrames: [],
      recovery: {
        lastCause: null,
        lastFailureMessage: null,
        lastRestartDurationMs: null,
        maximumAutomaticRestarts: 1,
        restartCount: 0,
        state: "not-needed",
        workerGeneration: 0,
      },
      sabRingBufferSpike: {
        capacityRecords: 256,
        cooperativeRoundTripsPerSecond: null,
        elapsedMs: null,
        failureMessage: null,
        mainConsumerEmptyPolls: 0,
        mainProducerStalls: 0,
        mainPumpMaxDurationMs: 0,
        messageCount: 100_000,
        payloadErrors: 0,
        recordWords: 4,
        responsesReceived: 0,
        state: "pending",
        totalSABBytes: 8_224,
        workerConcurrentFrameCount: 0,
        workerConcurrentFrameIntervalMaxMs: null,
        workerConcurrentRenderDurationMaxMs: null,
        workerElapsedMs: null,
        workerInboundWaits: 0,
        workerOutboundStalls: 0,
        workerSequenceErrors: 0,
      },
      state: "idle",
      workerInitToFirstFrameMs: null,
      workerStartupToFirstFrameMs: null,
    },
    schemaVersion: 25,
    streaming: initialStreaming(),
    wasmThreadSpike: {},
  };
}

function initialStreaming() {
  return {
    cellLoadSampleCount: 0,
    cellLoadSamples: [],
    cpuBudgetRejectionCount: 0,
    currentObservers: [],
    decodeQueueDepthHighWater: 0,
    decodeWorkerCount: 0,
    encodedBytesRead: 0,
    failureMessage: null,
    flythroughObserverUpdateCount: 0,
    hardwareConcurrency: 0,
    observerUpdateCount: 0,
    opfsAccessHandleCount: 0,
    opfsAccessHandleOpenDurationMs: 0,
    opfsPackageCount: 0,
    opfsProvisionedBytes: 0,
    proactiveEvictionCount: 0,
    renderRecoveryCount: 0,
    residentCellCount: 0,
    residentCellIds: [],
    residentEncodedBytes: 0,
    residentEncodedBytesHighWater: 0,
    residentGpuBytes: 0,
    residentGpuBytesHighWater: 0,
    schemaVersion: 7,
    settledObserverUpdateCount: 0,
    settledRecoveryCheckpoint: null,
    state: "idle",
    workerGeneration: 0,
  };
}

function startingLatestTelemetry() {
  const telemetry = initialLatestTelemetry();
  return {
    ...telemetry,
    render: { ...telemetry.render, state: "starting" },
    streaming: {
      ...telemetry.streaming,
      state: "starting",
      workerGeneration: 1,
    },
  };
}

function recoveryStartingLatestTelemetry() {
  const telemetry = recoveringLatestTelemetry();
  return {
    ...telemetry,
    streaming: {
      ...initialStreaming(),
      hardwareConcurrency: 16,
      renderRecoveryCount: 1,
      state: "starting",
      workerGeneration: 2,
    },
  };
}

function workerStartupIdleLatestTelemetry(workerGeneration: 1 | 2) {
  const telemetry = initialLatestTelemetry();
  const recovering = workerGeneration === 2;
  return {
    ...telemetry,
    render: recovering
      ? {
          ...telemetry.render,
          recovery: {
            ...telemetry.render.recovery,
            lastCause: "device-loss",
            lastFailureMessage: "injected fault",
            restartCount: 1,
            state: "restarting",
            workerGeneration: 2,
          },
          state: "recovering",
        }
      : {
          ...telemetry.render,
          recovery: { ...telemetry.render.recovery, workerGeneration: 1 },
          state: "starting",
        },
    streaming: {
      ...telemetry.streaming,
      flythroughObserverUpdateCount: recovering ? 7 : 0,
      hardwareConcurrency: 16,
      observerUpdateCount: recovering ? 8 : 0,
      renderRecoveryCount: recovering ? 1 : 0,
      settledObserverUpdateCount: recovering ? 8 : 0,
      state: "idle",
      workerGeneration,
    },
  };
}

function provisioningLatestTelemetry(hardwareConcurrency = 16, decodeWorkerCount = 0) {
  const telemetry = startingLatestTelemetry();
  return {
    ...telemetry,
    render: {
      ...telemetry.render,
      recovery: { ...telemetry.render.recovery, workerGeneration: 1 },
    },
    streaming: {
      ...telemetry.streaming,
      currentObservers: [[0, 12, 0]],
      decodeWorkerCount,
      hardwareConcurrency,
      opfsAccessHandleCount: decodeWorkerCount === 0 ? 0 : 256,
      opfsAccessHandleOpenDurationMs: decodeWorkerCount === 0 ? 0 : 10,
      opfsPackageCount: decodeWorkerCount === 0 ? 0 : 256,
      opfsProvisionedBytes: 1_024,
      state: "provisioning",
    },
  };
}

function recoveryProvisioningLatestTelemetry(decodeWorkerCount = 0) {
  const telemetry = workerStartupIdleLatestTelemetry(2);
  return {
    ...telemetry,
    streaming: {
      ...telemetry.streaming,
      currentObservers: [[0, 12, 0]],
      decodeWorkerCount,
      opfsAccessHandleCount: decodeWorkerCount === 0 ? 0 : 256,
      opfsAccessHandleOpenDurationMs: decodeWorkerCount === 0 ? 0 : 10,
      opfsPackageCount: decodeWorkerCount === 0 ? 0 : 256,
      opfsProvisionedBytes: 1_024,
      state: "provisioning",
    },
  };
}

function streamingLatestTelemetry(
  workerGeneration: 1 | 2 = 1,
  hardwareConcurrency = 16,
  decodeWorkerCount = 4,
) {
  const recovering = workerGeneration === 2;
  const telemetry = recovering ? recoveringLatestTelemetry() : provisioningLatestTelemetry();
  const checkpoint = {
    ...settledCheckpoint(),
    flythroughObserverUpdateCount: recovering ? 7 : 0,
    observerUpdateCount: recovering ? 8 : 0,
    workerGeneration,
  };
  const residentCellIds = checkpoint.residentCellIds;
  return {
    ...telemetry,
    streaming: {
      ...telemetry.streaming,
      currentObservers: checkpoint.observers,
      decodeQueueDepthHighWater: residentCellIds.length,
      decodeWorkerCount,
      encodedBytesRead: 9_000,
      hardwareConcurrency,
      opfsAccessHandleCount: 256,
      opfsAccessHandleOpenDurationMs: 10,
      opfsPackageCount: 256,
      residentCellCount: residentCellIds.length,
      residentCellIds,
      residentEncodedBytes: 9_000,
      residentEncodedBytesHighWater: 9_000,
      residentGpuBytes: 18_000,
      residentGpuBytesHighWater: 18_000,
      settledRecoveryCheckpoint: checkpoint,
      state: "streaming",
    },
  };
}

function recoveringLatestTelemetry() {
  return workerStartupIdleLatestTelemetry(2);
}

function streamingDisposedBeforeSettlementLatestTelemetry() {
  const telemetry = provisioningLatestTelemetry();
  return {
    ...telemetry,
    streaming: {
      ...telemetry.streaming,
      state: "disposed",
    },
  };
}

function streamingDisposedLatestTelemetry(workerGeneration: 1 | 2 = 1) {
  const telemetry = streamingLatestTelemetry(workerGeneration);
  return {
    ...telemetry,
    streaming: {
      ...telemetry.streaming,
      proactiveEvictionCount: 9,
      opfsAccessHandleCount: 0,
      residentCellCount: 0,
      residentCellIds: [],
      residentEncodedBytes: 0,
      residentGpuBytes: 0,
      state: "disposed",
    },
  };
}

function failedLatestTelemetry() {
  const telemetry = initialLatestTelemetry();
  return {
    ...telemetry,
    render: {
      ...telemetry.render,
      failureMessage: "Render startup failed",
      recovery: {
        ...telemetry.render.recovery,
        lastCause: "startup",
        lastFailureMessage: "Render startup failed",
        state: "exhausted",
      },
      state: "failed",
    },
    streaming: {
      ...telemetry.streaming,
      failureMessage: "Streaming startup failed",
      state: "failed",
    },
  };
}

function streamingFailureLatestTelemetry(afterDecodePoolCreation: boolean) {
  const telemetry = afterDecodePoolCreation
    ? streamingLatestTelemetry()
    : provisioningLatestTelemetry();
  return streamingFailureFromLatestTelemetry(telemetry);
}

function streamingFailureFromLatestTelemetry<T extends Readonly<object>>(
  telemetry: T & Readonly<{ streaming: Readonly<object> }>,
): Readonly<{
  [key: string]: unknown;
  streaming: Readonly<Record<string, unknown>>;
}> {
  return {
    ...telemetry,
    streaming: {
      ...telemetry.streaming,
      failureMessage: "Streaming worker failed",
      opfsAccessHandleCount: 0,
      state: "failed",
    },
  };
}

function preIdentityStreamingFailureLatestTelemetry() {
  const telemetry = failedLatestTelemetry();
  return {
    ...telemetry,
    streaming: {
      ...telemetry.streaming,
      hardwareConcurrency: 16,
    },
  };
}

function preSettlementDecodePoolStreamingFailureLatestTelemetry() {
  const telemetry = provisioningLatestTelemetry(16, 4);
  return streamingFailureFromLatestTelemetry(telemetry);
}

function renderDisposedAfterFailureLatestTelemetry() {
  const telemetry = failedLatestTelemetry();
  return {
    ...telemetry,
    render: { ...telemetry.render, state: "disposed" },
  };
}

function renderDisposedDuringRecoveryLatestTelemetry() {
  const telemetry = recoveringLatestTelemetry();
  return {
    ...telemetry,
    render: { ...telemetry.render, state: "disposed" },
  };
}

function readyRenderFailureLatestTelemetry(disposed = false) {
  const telemetry = failedLatestTelemetry();
  return {
    ...telemetry,
    render: {
      ...telemetry.render,
      ...readyRenderWorkerFields(),
      failureMessage: "Render failed after ready",
      recovery: {
        ...telemetry.render.recovery,
        lastCause: "render-error",
        lastFailureMessage: "Render failed after ready",
        workerGeneration: 1,
      },
      state: disposed ? "disposed" : "failed",
    },
  };
}

function recoveryRenderFailureLatestTelemetry(ready: boolean, disposed = false) {
  const telemetry = recoveringLatestTelemetry();
  return {
    ...telemetry,
    render: {
      ...telemetry.render,
      ...(ready ? readyRenderWorkerFields() : {}),
      failureMessage: "Replacement render failed",
      recovery: {
        ...telemetry.render.recovery,
        lastCause: "render-error",
        lastFailureMessage: "Replacement render failed",
        lastRestartDurationMs: ready ? 1 : null,
        state: "exhausted",
      },
      state: disposed ? "disposed" : "failed",
    },
  };
}

function readyRenderWorkerFields() {
  return {
    decoderBootstrap: {
      installedAtMs: 1,
      paths: {
        draco: "preinstalled-global",
        ktx2: "preinstalled-global",
        meshopt: "preinstalled-global",
      },
      versions: { draco: "1.5.7", ktx2: "9.17.0", meshopt: "1.2.0" },
    },
    decoderFixtures: {
      draco: { durationMs: 1, faces: 1 },
      ktx2: { durationMs: 1, height: 1, transcoder: "fixture", width: 1 },
      meshopt: { bytes: 1, durationMs: 1 },
    },
    frameCount: 1,
    greyboxWorld: {
      cellCount: 1,
      clearColor: [0, 0, 0, 1],
      colliderCount: 1,
      districtId: "d1",
      dynamicLighting: true,
      heightSampleCount: 1,
      mainThreadScenePostMessageMs: 1,
      mainThreadWorldGenerationMs: 1,
      materialCount: 1,
      materializationMs: 1,
      renderedFeaturePrimitiveCount: 1,
      renderedTerrainPatchCount: 1,
      renderedTriangleCount: 2,
      selectedLodCellCounts: [1, 0, 0],
      worldBoundsMeters: {
        maximum: [1, 1, 1],
        minimum: [0, 0, 0],
      },
    },
    recentFrames: [
      {
        durationMs: 1,
        lightingIntensity: 1,
        lightingPhase: 0,
        presentIntervalMs: 1,
      },
    ],
    workerInitToFirstFrameMs: 1,
    workerStartupToFirstFrameMs: 2,
  };
}

function settledCheckpoint() {
  return {
    flythroughObserverUpdateCount: 0,
    observerUpdateCount: 0,
    observers: [[0, 12, 0]],
    residentCellIds: Array.from({ length: 9 }, (_, index) => `d1:${index}:0`),
    workerGeneration: 1,
  };
}

function beforeFaultBoundary() {
  const telemetry = streamingLatestTelemetry();
  const checkpoint = {
    ...settledCheckpoint(),
    flythroughObserverUpdateCount: 7,
    observerUpdateCount: 8,
  };
  const streaming = {
    ...telemetry.streaming,
    currentObservers: checkpoint.observers,
    flythroughObserverUpdateCount: checkpoint.flythroughObserverUpdateCount,
    observerUpdateCount: checkpoint.observerUpdateCount,
    settledObserverUpdateCount: checkpoint.observerUpdateCount,
    settledRecoveryCheckpoint: checkpoint,
  };
  return {
    checkpoint,
    decoderBootstrap: null,
    decoderFixtures: null,
    flythrough: { failureMessage: null, state: "running" },
    frameCount: 0,
    greyboxWorld: null,
    observers: checkpoint.observers,
    renderRecovery: telemetry.render.recovery,
    renderState: "ready",
    residentCellIds: checkpoint.residentCellIds,
    sab: {
      ...telemetry.render.sabRingBufferSpike,
      cooperativeRoundTripsPerSecond: 100_000_000,
      elapsedMs: 1,
      responsesReceived: 100_000,
      state: "completed",
      workerConcurrentFrameCount: 1,
      workerConcurrentFrameIntervalMaxMs: 1,
      workerConcurrentRenderDurationMaxMs: 1,
      workerElapsedMs: 1,
    },
    streaming,
  };
}

function streamingCellLoadSample() {
  return {
    batchCellCount: 1,
    batchCellOrdinal: 1,
    batchFlythroughObserverSequence: 1,
    batchObserverUpdateCount: 1,
    batchOrdinal: 2,
    cellId: "d1:0:0",
    decodeMs: 1,
    decodeRoundTripMs: 1,
    decodeWaitMs: 0,
    encodedBytes: 1,
    gpuBytes: 1,
    opfsAccessRoundTripMs: 1,
    opfsReadMs: 1,
    opfsWaitMs: 0,
    renderCommitRoundTripMs: 1,
    renderUploadRoundTripMs: 1,
    renderUploadWaitMs: 0,
    sequence: 1,
    streamingWorkerRemainderMs: 1,
    totalMs: 5,
    uploadMs: 1,
  };
}
