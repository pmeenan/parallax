import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type BenchmarkDefinition,
  type BenchmarkEnvironmentIdentity,
  measuredMetric,
  unsupportedMetric,
} from "../src/benchmark/benchmark-contract";
import { type BenchmarkPlatform, supportsWasmSimd } from "../src/benchmark/benchmark-environment";
import { createBenchmarkService } from "../src/benchmark/benchmark-service";
import type { FlythroughScenario } from "../src/flythrough/flythrough-contract";
import type {
  FlythroughListener,
  FlythroughService,
  FlythroughTelemetrySnapshot,
} from "../src/flythrough/flythrough-service";
import { createFlythroughService } from "../src/flythrough/flythrough-service";
import type { RenderFlythroughTelemetry } from "../src/render/render-protocol";
import type {
  RenderService,
  RenderServiceListener,
  RenderTelemetrySnapshot,
} from "../src/render/render-service";
import type {
  StreamingCellLoadTelemetry,
  WorldStreamingTelemetrySnapshot,
} from "../src/streaming/streaming-protocol";
import type {
  WorldStreamingListener,
  WorldStreamingService,
} from "../src/streaming/world-streaming-service";

describe("benchmark service", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("owns three reset-separated repeats and emits an advisory browser-neutral report", async () => {
    const flythrough = flythroughHarness();
    const renderSizes: unknown[] = [];
    let monitorCount = 0;
    const service = createBenchmarkService(
      {
        snapshot: () => ({ renderPixelSizeOverride: null, state: "ready" }),
        setRenderPixelSizeOverride: (
          size: Readonly<{ readonly height: number; readonly width: number }> | null,
        ) => renderSizes.push(size),
      } as unknown as RenderService,
      flythrough.service,
      definition,
      platform({
        onMonitor: () => {
          monitorCount += 1;
        },
      }),
    );

    service.start();
    await settle(service);

    const snapshot = service.snapshot();
    expect(snapshot.state).toBe("completed");
    expect(snapshot.completedRepeats).toBe(3);
    expect(flythrough.prepareCount()).toBe(3);
    expect(flythrough.startCount()).toBe(3);
    expect(flythrough.resetCount()).toBe(2);
    expect(monitorCount).toBe(3);
    expect(renderSizes).toEqual([{ height: 720, width: 1_280 }, null]);
    expect(snapshot.report).toMatchObject({
      environmentComparisonPolicy: {
        excludedRecordedFields: ["screen.viewportCssPixels"],
        id: "fixed-worker-render-pixels@1",
      },
      resultContract: "benchmark-result@1",
      schemaVersion: 3,
      repeatPolicy: {
        count: 3,
        lineage: "continuous-page",
        resetBetweenRepeats: true,
      },
      facets: {
        budgetEvaluation: { status: "not-evaluated" },
        referenceEligibility: { status: "not-evaluated" },
        scenarioEvidence: { status: "passed" },
      },
      verdict: { kind: "advisory", passed: null },
    });
    expect(snapshot.report?.attempts).toHaveLength(3);
    expect(snapshot.report?.attempts[0]?.metrics.streamingCellLoadP95Ms).toEqual(
      measuredMetric(10),
    );
    expect(snapshot.report?.metricStates).toMatchObject({
      allRealmJsHeap: "unsupported",
      attributableGpuMemory: "unsupported",
      dawnPipelineActivity: "unsupported",
      mainThreadLongTasks: "measured",
      presentationIntervals: "unsupported",
      workerLongTasks: "unsupported",
    });

    await service.reset();
    expect(service.snapshot().state).toBe("idle");
    service.start();
    await settle(service);
    expect(service.snapshot().state).toBe("completed");
    expect(flythrough.prepareCount()).toBe(6);
    expect(flythrough.startCount()).toBe(6);
    expect(flythrough.resetCount()).toBe(5);
  });

  it("returns deeply frozen report evidence isolated from mutable flythrough sources", async () => {
    const sources: {
      checkpointCamera?: [number, number, number];
      path?: [number, number, number][];
    } = {};
    const flythrough = flythroughHarness({
      transformCompleted(snapshot) {
        const render = snapshot.render;
        const checkpoint = snapshot.checkpointEvidence[0];
        if (render === null || checkpoint === undefined) {
          throw new Error("Test fixture lost completed flythrough evidence");
        }
        sources.path = render.scenario.path.map((point) => [...point]);
        sources.checkpointCamera = [...checkpoint.cameraPosition];
        const mutableScenario: FlythroughScenario = {
          ...render.scenario,
          camera: { ...render.scenario.camera },
          environmentPhases: render.scenario.environmentPhases.map((phase) => ({ ...phase })),
          path: sources.path,
        };
        return {
          ...snapshot,
          checkpointEvidence: [
            {
              ...checkpoint,
              cameraPosition: sources.checkpointCamera,
              environment: { ...checkpoint.environment },
            },
          ],
          render: {
            ...render,
            scenario: mutableScenario,
          },
        };
      },
    });
    const service = createBenchmarkService(
      renderHarness(),
      flythrough.service,
      definition,
      platform({}),
    );

    service.start();
    await settle(service);
    const report = service.snapshot().report;
    const sourcePath = sources.path;
    const sourceCheckpointCamera = sources.checkpointCamera;
    if (report === null || sourcePath === undefined || sourceCheckpointCamera === undefined) {
      throw new Error("Test did not produce benchmark report evidence");
    }
    const flythroughReport = report.attempts[0]?.flythrough;
    const checkpoint = flythroughReport?.checkpointEvidence[0];
    const render = flythroughReport?.render;
    if (checkpoint === undefined || render === null || render === undefined) {
      throw new Error("Test report lost nested flythrough evidence");
    }
    const exported = JSON.stringify(report);

    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(checkpoint.cameraPosition)).toBe(true);
    expect(Object.isFrozen(render.scenario.path)).toBe(true);
    expect(Object.isFrozen(render.scenario.path[0])).toBe(true);
    expect(() => {
      (checkpoint.cameraPosition as unknown as number[])[0] = 999;
    }).toThrow(TypeError);
    expect(() => {
      (render.scenario.path[0] as unknown as number[])[0] = 999;
    }).toThrow(TypeError);

    sourceCheckpointCamera[0] = 999;
    const firstSourcePoint = sourcePath[0];
    if (firstSourcePoint === undefined) throw new Error("Mutable source path is empty");
    firstSourcePoint[0] = 999;
    expect(JSON.stringify(service.snapshot().report)).toBe(exported);
  });

  it("fails closed on short render camera bound tuples", async () => {
    const flythrough = flythroughHarness({
      transformCompleted(snapshot) {
        const render = snapshot.render;
        if (render === null) throw new Error("Test fixture lost completed flythrough evidence");
        return {
          ...snapshot,
          render: {
            ...render,
            cameraPositionMinimum: [] as unknown as readonly [number, number, number],
          },
        };
      },
    });
    const service = createBenchmarkService(
      renderHarness(),
      flythrough.service,
      definition,
      platform({}),
    );

    service.start();
    await settle(service);

    expect(service.snapshot()).toMatchObject({
      report: {
        attempts: [{ state: "invalid" }],
        facets: { scenarioEvidence: { status: "failed" } },
      },
      state: "failed",
    });
  });

  it("fails closed before preflight when a baseline capability is missing", async () => {
    const flythrough = flythroughHarness();
    const service = createBenchmarkService(
      {
        snapshot: () => ({ renderPixelSizeOverride: null, state: "ready" }),
        setRenderPixelSizeOverride: () => undefined,
      } as unknown as RenderService,
      flythrough.service,
      definition,
      platform({ unavailableCapability: "wasm-simd" }),
    );

    service.start();
    await settle(service);

    expect(service.snapshot()).toMatchObject({
      state: "failed",
      report: {
        attempts: [],
        verdict: { kind: "capability-failure", passed: false },
      },
    });
    expect(service.snapshot().failureMessage).toContain("wasm-simd");
    expect(flythrough.prepareCount()).toBe(0);
  });

  it("invalidates evidence when repeat variance exceeds the fixed ten-percent limit", async () => {
    const flythrough = flythroughHarness({ callbackP95ByRepeat: [1, 1, 2] });
    const service = createBenchmarkService(
      {
        snapshot: () => ({ renderPixelSizeOverride: null, state: "ready" }),
        setRenderPixelSizeOverride: () => undefined,
      } as unknown as RenderService,
      flythrough.service,
      definition,
      platform({}),
    );

    service.start();
    await settle(service);

    expect(service.snapshot().state).toBe("failed");
    expect(service.snapshot().report?.facets.scenarioEvidence.status).toBe("failed");
    expect(
      service
        .snapshot()
        .report?.variance.find((metric) => metric.metric === "renderWorkerCallbackIntervalP95Ms"),
    ).toMatchObject({ relativeRange: 1, state: "invalid" });
  });

  it("invalidates a repeat when a comparison-relevant environment field drifts", async () => {
    const flythrough = flythroughHarness();
    const service = createBenchmarkService(
      {
        snapshot: () => ({ renderPixelSizeOverride: null, state: "ready" }),
        setRenderPixelSizeOverride: () => undefined,
      } as unknown as RenderService,
      flythrough.service,
      definition,
      platform({ driftAfterFirstCapture: true }),
    );

    service.start();
    await settle(service);

    expect(service.snapshot().state).toBe("failed");
    expect(service.snapshot().report?.attempts[0]).toMatchObject({
      failureMessage: expect.stringContaining(
        "Captured comparison-relevant in-game environment identity changed across benchmark repeats",
      ),
      state: "invalid",
    });
  });

  it("invalidates cross-repeat identity drift even when each repeat is internally stable", async () => {
    const flythrough = flythroughHarness();
    const service = createBenchmarkService(
      renderHarness(),
      flythrough.service,
      definition,
      platform({ driftFromCapture: 3 }),
    );

    service.start();
    await settle(service);

    expect(service.snapshot().report?.attempts[0]?.state).toBe("measured");
    expect(service.snapshot().report?.attempts[1]).toMatchObject({
      failureMessage: expect.stringContaining("changed across benchmark repeats"),
      state: "invalid",
    });
  });

  it("retains CSS viewport drift without treating it as fixed-worker workload drift", async () => {
    const service = createBenchmarkService(
      renderHarness(),
      flythroughHarness().service,
      definition,
      platform({ viewportDriftAfterFirstCapture: true }),
    );

    service.start();
    await settle(service);

    const report = service.snapshot().report;
    expect(service.snapshot().state).toBe("completed");
    expect(report?.facets.scenarioEvidence.status).toBe("passed");
    expect(
      report?.environmentCaptures.map(({ screen }) => screen.viewportCssPixels.height),
    ).toEqual([1_080, 1_079, 1_079, 1_079, 1_079, 1_079]);
  });

  it("rejects wrong worker-rendered preset dimensions and observer contamination", async () => {
    const flythrough = flythroughHarness({
      transformCompleted(snapshot) {
        const checkpoint = snapshot.checkpointEvidence[0];
        const end = snapshot.streamingAtMeasurementEnd;
        if (checkpoint === undefined || end === null) {
          throw new Error("Test fixture lost completed benchmark evidence");
        }
        return Object.freeze({
          ...snapshot,
          checkpointEvidence: Object.freeze([
            Object.freeze({ ...checkpoint, sampledPixelCount: 1_279 * 720, width: 1_279 }),
          ]),
          streamingAtMeasurementEnd: Object.freeze({
            ...end,
            observerUpdateCount: end.observerUpdateCount + 1,
            settledObserverUpdateCount: end.settledObserverUpdateCount + 1,
          }),
        });
      },
    });
    const service = createBenchmarkService(
      renderHarness(),
      flythrough.service,
      definition,
      platform({}),
    );

    service.start();
    await settle(service);

    expect(service.snapshot().report?.attempts[0]?.failureMessage).toContain("invalid for preset");
    expect(service.snapshot().report?.attempts[0]?.failureMessage).toContain(
      "exclusive canonical observer ownership",
    );
  });

  it("rejects an incomplete or drifting startup-open OPFS handle set", async () => {
    const flythrough = flythroughHarness({
      transformCompleted(snapshot) {
        const end = snapshot.streamingAtMeasurementEnd;
        if (end === null) throw new Error("Test fixture lost completed streaming evidence");
        return Object.freeze({
          ...snapshot,
          streamingAtMeasurementEnd: Object.freeze({
            ...end,
            opfsAccessHandleCount: end.opfsPackageCount - 1,
          }),
        });
      },
    });
    const service = createBenchmarkService(
      renderHarness(),
      flythrough.service,
      definition,
      platform({}),
    );

    service.start();
    await settle(service);

    expect(service.snapshot().report?.attempts[0]?.failureMessage).toContain(
      "exclusive canonical observer ownership",
    );
  });

  it("rejects malformed startup-open OPFS handle telemetry", async () => {
    for (const invalid of [
      { count: 256.5, durationMs: 10 },
      { count: Number.POSITIVE_INFINITY, durationMs: 10 },
      { count: 256, durationMs: -1 },
      { count: 256, durationMs: Number.POSITIVE_INFINITY },
    ]) {
      const flythrough = flythroughHarness({
        transformCompleted(snapshot) {
          const start = snapshot.streamingAtMeasurementStart;
          const end = snapshot.streamingAtMeasurementEnd;
          if (start === null || end === null) {
            throw new Error("Test fixture lost completed streaming evidence");
          }
          const storage = {
            opfsAccessHandleCount: invalid.count,
            opfsAccessHandleOpenDurationMs: invalid.durationMs,
            opfsPackageCount: invalid.count,
          };
          return Object.freeze({
            ...snapshot,
            streamingAtMeasurementEnd: Object.freeze({ ...end, ...storage }),
            streamingAtMeasurementStart: Object.freeze({ ...start, ...storage }),
          });
        },
      });
      const service = createBenchmarkService(
        renderHarness(),
        flythrough.service,
        definition,
        platform({}),
      );

      service.start();
      await settle(service);

      expect(service.snapshot().report?.attempts[0]?.failureMessage).toContain(
        "exclusive canonical observer ownership",
      );
    }
  });

  it("rejects a non-completed render aggregate and collapsed camera route coverage", async () => {
    const flythrough = flythroughHarness({
      transformCompleted(snapshot) {
        const render = snapshot.render;
        if (render === null) throw new Error("Test fixture lost render evidence");
        return Object.freeze({
          ...snapshot,
          render: {
            ...render,
            cameraPositionMaximum: [0, 10, 0],
            cameraPositionMinimum: [0, 10, 0],
            cameraTargetMaximum: [0, 10, 0],
            cameraTargetMinimum: [0, 10, 0],
            state: "running",
          } as unknown as RenderFlythroughTelemetry,
        });
      },
    });
    const service = createBenchmarkService(
      renderHarness(),
      flythrough.service,
      definition,
      platform({}),
    );

    service.start();
    await settle(service);

    expect(service.snapshot().report?.attempts[0]).toMatchObject({
      failureMessage: expect.stringContaining(
        "Render-worker frame, presentation, observer, or distribution evidence is invalid",
      ),
      state: "invalid",
    });
  });

  it("retains capability environment evidence", async () => {
    const service = createBenchmarkService(
      renderHarness(),
      flythroughHarness().service,
      definition,
      platform({ unavailableCapability: "wasm-simd" }),
    );
    service.start();
    await settle(service);
    const report = service.snapshot().report;
    expect(report).toMatchObject({
      environmentComparisonPolicy: {
        excludedRecordedFields: ["screen.viewportCssPixels"],
        id: "fixed-worker-render-pixels@1",
      },
      schemaVersion: 3,
    });
    expect(report?.environmentCaptures).toHaveLength(1);
    expect(report?.environmentCaptures[0]?.capabilities).toContainEqual({
      id: "wasm-simd",
      state: "unavailable",
    });
  });

  it("resets and reruns after a failed flythrough without reloading the page", async () => {
    let failFirst = true;
    const flythrough = flythroughHarness({
      transformCompleted(snapshot) {
        if (!failFirst) return snapshot;
        failFirst = false;
        return Object.freeze({
          ...snapshot,
          failureMessage: "injected flythrough failure",
          render: null,
          state: "failed",
        });
      },
    });
    const service = createBenchmarkService(
      renderHarness(),
      flythrough.service,
      definition,
      platform({}),
    );
    service.start();
    await settle(service);
    expect(service.snapshot().state).toBe("failed");

    await service.reset();
    service.start();
    await settle(service);
    expect(service.snapshot()).toMatchObject({ completedRepeats: 3, state: "completed" });
  });

  it("aborts timed-out preflight, emits an invalid attempt, and restores the prior size", async () => {
    vi.useFakeTimers();
    const flythrough = flythroughHarness({
      abortError: new Error("reset acknowledgement timed out"),
      stallPrepare: true,
    });
    const renderSizes: unknown[] = [];
    const service = createBenchmarkService(
      renderHarness((size) => renderSizes.push(size), { height: 600, width: 800 }),
      flythrough.service,
      definition,
      platform({}),
    );
    service.start();
    await vi.advanceTimersByTimeAsync(180_001);
    await settle(service);
    expect(service.snapshot()).toMatchObject({
      state: "failed",
      report: { attempts: [{ state: "invalid" }] },
    });
    expect(service.snapshot().report?.attempts[0]?.failureMessage).toContain(
      "flythrough abort failed: reset acknowledgement timed out",
    );
    expect(flythrough.abortCount()).toBe(1);
    expect(renderSizes).toEqual([
      { height: 720, width: 1_280 },
      { height: 600, width: 800 },
    ]);
  });

  it("retains a real flythrough abort-reset failure in the attempt and verdict", async () => {
    vi.useFakeTimers();
    const composition = realFlythroughAbortComposition();
    const service = createBenchmarkService(
      composition.render,
      composition.flythrough,
      abortDefinition,
      platform({}),
    );

    service.start();
    await vi.advanceTimersByTimeAsync(180_001);
    await settle(service);

    const cleanupFailure =
      "flythrough abort failed: Flythrough did not reach prepared/failed/aborted within 180000 ms; flythrough reset failed: reset acknowledgement timed out";
    expect(service.snapshot().report?.attempts[0]?.failureMessage).toContain(cleanupFailure);
    expect(service.snapshot().report?.verdict.reasons.join(" | ")).toContain(cleanupFailure);
    expect(composition.flythrough.snapshot()).toMatchObject({
      failureMessage:
        "Flythrough did not reach prepared/failed/aborted within 180000 ms; flythrough reset failed: reset acknowledgement timed out",
      state: "failed",
    });
  });

  it("finishes the Long Tasks observer when the measured route times out", async () => {
    vi.useFakeTimers();
    let monitorFinished = 0;
    const flythrough = flythroughHarness({ stallStart: true });
    const service = createBenchmarkService(
      renderHarness(),
      flythrough.service,
      definition,
      platform({ onMonitorFinish: () => (monitorFinished += 1) }),
    );
    service.start();
    await vi.advanceTimersByTimeAsync(20_002);
    await settle(service);
    expect(service.snapshot()).toMatchObject({
      state: "failed",
      report: { attempts: [{ state: "invalid" }] },
    });
    expect(monitorFinished).toBe(1);
  });

  it("restores render ownership before a terminal subscriber synchronously starts again", async () => {
    const flythrough = flythroughHarness();
    let currentOverride: Readonly<{ height: number; width: number }> | null = {
      height: 600,
      width: 800,
    };
    const service = createBenchmarkService(
      renderHarness((size) => {
        currentOverride = size;
      }, currentOverride),
      flythrough.service,
      definition,
      platform({}),
    );
    let restarted = false;
    let secondSubscriberSawFirstTerminal = false;
    service.subscribe((snapshot) => {
      if (snapshot.state !== "completed" || restarted) return;
      restarted = true;
      expect(currentOverride).toEqual({ height: 600, width: 800 });
      service.start();
    });
    service.subscribe((snapshot) => {
      if (snapshot.state === "completed" && flythrough.startCount() === 3) {
        secondSubscriberSawFirstTerminal = true;
      }
    });

    service.start();
    await settle(service);
    await Promise.resolve();
    await settle(service);

    expect(restarted).toBe(true);
    expect(secondSubscriberSawFirstTerminal).toBe(true);
    expect(service.snapshot()).toMatchObject({ completedRepeats: 3, state: "completed" });
    expect(flythrough.startCount()).toBe(6);
    expect(currentOverride).toEqual({ height: 600, width: 800 });
  });

  it("claims reset ownership synchronously and rejects duplicate starts and configuration", async () => {
    const reset = deferredVoid();
    const flythrough = flythroughHarness({
      initialState: "completed",
      resetDeferred: reset,
    });
    const service = createBenchmarkService(
      renderHarness(),
      flythrough.service,
      definition,
      platform({}),
    );

    service.start();
    expect(service.snapshot().state).toBe("resetting");
    expect(() => service.start()).toThrow(/already running/);
    expect(() => service.configure("test-720p@1")).toThrow(/cannot change during a run/);

    reset.resolve();
    await settle(service);
    expect(service.snapshot().state).toBe("completed");
  });

  it("locks ownership while a direct reset is settling", async () => {
    const reset = deferredVoid();
    const flythrough = flythroughHarness({
      initialState: "completed",
      resetDeferred: reset,
    });
    const service = createBenchmarkService(
      renderHarness(),
      flythrough.service,
      definition,
      platform({}),
    );

    const firstReset = service.reset();
    expect(service.snapshot().state).toBe("resetting");
    expect(service.reset()).toBe(firstReset);
    expect(() => service.start()).toThrow(/reset is still settling/);
    expect(() => service.configure("test-720p@1")).toThrow(/cannot change during a run/);

    reset.resolve();
    await expect(firstReset).resolves.toBeUndefined();
    expect(service.snapshot().state).toBe("idle");
  });

  it("clears reset ownership before idle publication and permits only one reentrant subscriber start", async () => {
    const reset = deferredVoid();
    const flythrough = flythroughHarness({
      initialState: "completed",
      resetDeferred: reset,
    });
    const service = createBenchmarkService(
      renderHarness(),
      flythrough.service,
      definition,
      platform({}),
    );
    const restartOutcomes: string[] = [];
    let observeResetTerminal = false;
    for (const label of ["first", "second"]) {
      service.subscribe((snapshot) => {
        if (!observeResetTerminal || snapshot.state !== "idle") return;
        try {
          service.start();
          restartOutcomes.push(`${label}:accepted`);
        } catch {
          restartOutcomes.push(`${label}:rejected`);
        }
      });
    }

    const resetPromise = service.reset();
    observeResetTerminal = true;
    reset.resolve();
    await expect(resetPromise).resolves.toBeUndefined();
    await settle(service);

    expect(restartOutcomes).toEqual(["first:accepted", "second:rejected"]);
    expect(service.snapshot()).toMatchObject({ completedRepeats: 3, state: "completed" });
  });

  it("clears reset ownership before failed publication and permits one reentrant recovery start", async () => {
    const flythrough = flythroughHarness({
      initialState: "completed",
      resetFailureOnce: new Error("injected reset failure"),
    });
    const service = createBenchmarkService(
      renderHarness(),
      flythrough.service,
      definition,
      platform({}),
    );
    const restartOutcomes: string[] = [];
    let observeResetTerminal = false;
    for (const label of ["first", "second"]) {
      service.subscribe((snapshot) => {
        if (!observeResetTerminal || snapshot.state !== "failed") return;
        expect(snapshot.failureMessage).toContain("injected reset failure");
        try {
          service.start();
          restartOutcomes.push(`${label}:accepted`);
        } catch {
          restartOutcomes.push(`${label}:rejected`);
        }
      });
    }

    const resetPromise = service.reset();
    const resetRejection = expect(resetPromise).rejects.toThrow("injected reset failure");
    observeResetTerminal = true;
    await resetRejection;
    await settle(service);

    expect(restartOutcomes).toEqual(["first:accepted", "second:rejected"]);
    expect(service.snapshot()).toMatchObject({ completedRepeats: 3, state: "completed" });
  });

  it("does not mutate render state after a disposed start reset continuation", async () => {
    const reset = deferredVoid();
    const renderSizes: unknown[] = [];
    const service = createBenchmarkService(
      renderHarness((size) => renderSizes.push(size)),
      flythroughHarness({
        initialState: "completed",
        resetDeferred: reset,
      }).service,
      definition,
      platform({}),
    );
    service.start();
    service.dispose();

    reset.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(service.snapshot().state).toBe("disposed");
    expect(renderSizes).toEqual([]);
  });

  it("permits only one synchronous terminal-subscriber restart", async () => {
    const flythrough = flythroughHarness();
    const service = createBenchmarkService(
      renderHarness(),
      flythrough.service,
      definition,
      platform({}),
    );
    const restartOutcomes: string[] = [];
    for (const label of ["first", "second"]) {
      let attempted = false;
      service.subscribe((snapshot) => {
        if (snapshot.state !== "completed" || attempted) return;
        attempted = true;
        try {
          service.start();
          restartOutcomes.push(`${label}:accepted`);
        } catch {
          restartOutcomes.push(`${label}:rejected`);
        }
      });
    }

    service.start();
    await settle(service);
    await Promise.resolve();
    await settle(service);

    expect(restartOutcomes).toEqual(["first:accepted", "second:rejected"]);
    expect(flythrough.startCount()).toBe(6);
  });

  it("restores the preset synchronously on disposal despite a never-settling capture", async () => {
    const environmentCapture = deferredEnvironment();
    const renderSizes: unknown[] = [];
    const service = createBenchmarkService(
      renderHarness((size) => renderSizes.push(size), Object.freeze({ height: 600, width: 800 })),
      flythroughHarness().service,
      definition,
      {
        captureEnvironment: () => environmentCapture.promise,
        createLongTaskMonitor: () => ({ finish: () => measuredMetric(0) }),
        generatedAt: () => "2026-07-25T00:00:00.000Z",
      },
    );
    service.start();
    await vi.waitFor(() => expect(service.snapshot().state).toBe("capturing-environment"));

    service.dispose();

    expect(service.snapshot().state).toBe("disposed");
    expect(renderSizes).toEqual([
      { height: 720, width: 1_280 },
      { height: 600, width: 800 },
    ]);
  });

  it("uses a valid SIMD module for the baseline capability probe", () => {
    expect(supportsWasmSimd()).toBe(true);
  });
});

const scenario = Object.freeze({
  camera: Object.freeze({ beta: 1, heightMeters: 10, radiusMeters: 20 }),
  durationMs: 1,
  environmentPhases: Object.freeze([
    Object.freeze({
      endMs: 1,
      id: "day",
      startMs: 0,
      timeOfDay: "daylight",
      timeOfDayPhase: 0.25,
      weather: "clear",
    }),
  ]),
  id: "benchmark-test@1",
  path: Object.freeze([Object.freeze([0, 10, 0] as const), Object.freeze([1, 10, 0] as const)]),
  schemaVersion: 1,
  speedMetersPerSecond: 1_000,
}) satisfies FlythroughScenario;

const definition = Object.freeze({
  id: "benchmark-test@1",
  qualityPresets: Object.freeze([
    Object.freeze({
      expectedReferenceMachineId: null,
      id: "test-720p@1",
      qualityVersion: "test@1",
      renderSize: Object.freeze({ height: 720, width: 1_280 }),
      targetRefreshRateHz: 60,
      tier: "standard",
    }),
  ]),
  repeatCount: 3,
  scenario,
  worldSeed: 42,
}) satisfies BenchmarkDefinition;

const abortScenario = Object.freeze({
  camera: Object.freeze({ beta: 1, heightMeters: 10, radiusMeters: 20 }),
  durationMs: 1_000,
  environmentPhases: Object.freeze([
    Object.freeze({
      endMs: 250,
      id: "clear-daylight",
      startMs: 0,
      timeOfDay: "daylight",
      timeOfDayPhase: 0.25,
      weather: "clear",
    }),
    Object.freeze({
      endMs: 500,
      id: "overcast-dawn",
      startMs: 250,
      timeOfDay: "dawn",
      timeOfDayPhase: 0,
      weather: "overcast",
    }),
    Object.freeze({
      endMs: 750,
      id: "storm-dusk",
      startMs: 500,
      timeOfDay: "dusk",
      timeOfDayPhase: 0.5,
      weather: "storm",
    }),
    Object.freeze({
      endMs: 1_000,
      id: "storm-night",
      startMs: 750,
      timeOfDay: "night",
      timeOfDayPhase: 0.75,
      weather: "storm",
    }),
  ]),
  id: "abort-composition@1",
  path: Object.freeze([Object.freeze([0, 10, 0] as const), Object.freeze([1, 10, 0] as const)]),
  schemaVersion: 1,
  speedMetersPerSecond: 1,
}) satisfies FlythroughScenario;

const abortDefinition = Object.freeze({
  ...definition,
  id: "abort-composition@1",
  scenario: abortScenario,
}) satisfies BenchmarkDefinition;

function platform(options: {
  readonly driftAfterFirstCapture?: boolean;
  readonly driftFromCapture?: number;
  readonly onMonitor?: () => void;
  readonly onMonitorFinish?: () => void;
  readonly unavailableCapability?: string;
  readonly viewportDriftAfterFirstCapture?: boolean;
}): BenchmarkPlatform {
  let captureCount = 0;
  return {
    async captureEnvironment() {
      captureCount += 1;
      return environment(
        options.unavailableCapability,
        (options.driftAfterFirstCapture === true && captureCount > 1) ||
          (options.driftFromCapture !== undefined && captureCount >= options.driftFromCapture)
          ? 4
          : 8,
        options.viewportDriftAfterFirstCapture === true && captureCount > 1 ? 1_079 : 1_080,
      );
    },
    createLongTaskMonitor() {
      options.onMonitor?.();
      return {
        finish: () => {
          options.onMonitorFinish?.();
          return measuredMetric(0);
        },
      };
    },
    generatedAt: () => "2026-07-25T00:00:00.000Z",
  };
}

function environment(
  unavailableCapability?: string,
  hardwareConcurrency = 8,
  viewportHeight = 1_080,
): BenchmarkEnvironmentIdentity {
  const capabilityIds = [
    "cross-origin-isolated",
    "offscreen-canvas",
    "opfs",
    "shared-array-buffer",
    "wasm-simd",
    "wasm-threads",
    "webgpu",
    "window-long-tasks",
  ] as const;
  return Object.freeze({
    artifactDigest: measuredMetric("a".repeat(64)),
    browser: Object.freeze({
      engine: "Chromium",
      fullVersionList: Object.freeze([
        Object.freeze({ brand: "Google Chrome", version: "151.0.0.0" }),
      ]),
      mobile: false,
      name: "Google Chrome",
      platform: "Windows",
      platformVersion: "19.0.0",
      userAgent: "test",
      version: "151.0.0.0",
    }),
    capabilities: Object.freeze(
      capabilityIds.map((id) =>
        Object.freeze({
          id,
          state: id === unavailableCapability ? ("unavailable" as const) : ("available" as const),
        }),
      ),
    ),
    gpuAdapter: measuredMetric(
      Object.freeze({
        architecture: "test",
        description: "test",
        device: "test",
        isFallbackAdapter: false,
        source: "window-request-adapter" as const,
        vendor: "test",
      }),
    ),
    hardwareConcurrency,
    hostIdentity: unsupportedMetric<never>("page unavailable"),
    powerAndSessionState: unsupportedMetric<never>("page unavailable"),
    referenceEligibility: unsupportedMetric<true>("page unavailable"),
    screen: Object.freeze({
      availableCssPixels: Object.freeze({ height: 1_080, width: 1_920 }),
      colorDepth: 24,
      cssPixels: Object.freeze({ height: 1_080, width: 1_920 }),
      devicePixelRatio: 1,
      orientation: Object.freeze({ angle: 0, type: "landscape-primary" }),
      physicalPixelEstimate: Object.freeze({ height: 1_080, width: 1_920 }),
      viewportCssPixels: Object.freeze({ height: viewportHeight, width: 1_920 }),
    }),
  });
}

function realFlythroughAbortComposition(): Readonly<{
  readonly flythrough: FlythroughService;
  readonly render: RenderService;
}> {
  let renderSnapshot = {
    flythrough: null,
    renderPixelSizeOverride: null,
    state: "ready",
  } as unknown as RenderTelemetrySnapshot;
  const renderListeners = new Set<RenderServiceListener>();
  const render = {
    applyFlythroughPreflight: () => new Promise<void>(() => undefined),
    captureFlythroughCheckpoint: () =>
      Promise.reject(new Error("Checkpoint capture should remain unreachable")),
    dispose: () => undefined,
    exerciseRecovery: () => undefined,
    exerciseRecoveryAtBoundary: () =>
      Promise.reject(new Error("Recovery probe should remain unreachable")),
    failAfterStreamingFailure: () => undefined,
    resetFlythrough: () => Promise.reject(new Error("reset acknowledgement timed out")),
    setRenderPixelSizeOverride(
      size: Readonly<{ readonly height: number; readonly width: number }> | null,
    ): void {
      renderSnapshot = { ...renderSnapshot, renderPixelSizeOverride: size };
    },
    snapshot: () => renderSnapshot,
    start: () => undefined,
    startFlythrough: () => undefined,
    subscribe(listener: RenderServiceListener) {
      renderListeners.add(listener);
      listener(renderSnapshot);
      return () => renderListeners.delete(listener);
    },
  } as unknown as RenderService;

  let streaming = streamingSnapshot(0, 0);
  const streamingListeners = new Set<WorldStreamingListener>();
  const publishStreaming = (next: WorldStreamingTelemetrySnapshot): void => {
    streaming = next;
    for (const listener of streamingListeners) listener(streaming);
  };
  const streamingService = {
    dispose: () => undefined,
    setObservers(observers: readonly (readonly [number, number, number])[]): void {
      const observerUpdateCount = streaming.observerUpdateCount + 1;
      publishStreaming(
        Object.freeze({
          ...streaming,
          currentObservers: Object.freeze(
            observers.map(
              (observer) => Object.freeze([...observer]) as readonly [number, number, number],
            ),
          ),
          observerUpdateCount,
          settledObserverUpdateCount: observerUpdateCount,
        }),
      );
    },
    snapshot: () => streaming,
    start: () => undefined,
    subscribe(listener: WorldStreamingListener) {
      streamingListeners.add(listener);
      listener(streaming);
      return () => streamingListeners.delete(listener);
    },
  } as unknown as WorldStreamingService;

  return Object.freeze({
    flythrough: createFlythroughService(render, streamingService, abortScenario, {
      maximum: [1, 20, 1],
      minimum: [0, 0, -1],
    }),
    render,
  });
}

function flythroughHarness(
  options: {
    readonly abortError?: Error;
    readonly callbackP95ByRepeat?: readonly number[];
    readonly initialState?: FlythroughTelemetrySnapshot["state"];
    readonly resetDeferred?: ReturnType<typeof deferredVoid>;
    readonly resetFailureOnce?: Error;
    readonly stallPrepare?: boolean;
    readonly stallStart?: boolean;
    readonly transformCompleted?: (
      snapshot: FlythroughTelemetrySnapshot,
    ) => FlythroughTelemetrySnapshot;
  } = {},
): Readonly<{
  abortCount(): number;
  prepareCount(): number;
  resetCount(): number;
  readonly service: FlythroughService;
  startCount(): number;
}> {
  let aborts = 0;
  let prepares = 0;
  let resets = 0;
  let starts = 0;
  let snapshot = flythroughSnapshot(options.initialState ?? "idle", null);
  const listeners = new Set<FlythroughListener>();
  const publish = (next: FlythroughTelemetrySnapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
  };
  return Object.freeze({
    abortCount: () => aborts,
    prepareCount: () => prepares,
    resetCount: () => resets,
    service: {
      abort(reason): Promise<void> {
        aborts += 1;
        if (options.abortError !== undefined) return Promise.reject(options.abortError);
        publish(Object.freeze({ ...snapshot, failureMessage: reason, state: "aborted" }));
        return Promise.resolve();
      },
      dispose: () => undefined,
      prepare(): void {
        prepares += 1;
        publish(
          flythroughSnapshot(options.stallPrepare === true ? "preflighting" : "prepared", null),
        );
      },
      reset(): Promise<void> {
        resets += 1;
        if (options.resetFailureOnce !== undefined && resets === 1) {
          return Promise.reject(options.resetFailureOnce);
        }
        if (options.resetDeferred !== undefined) {
          return options.resetDeferred.promise.then(() =>
            publish(flythroughSnapshot("idle", null)),
          );
        }
        publish(flythroughSnapshot("idle", null));
        return Promise.resolve();
      },
      snapshot: () => snapshot,
      start(): void {
        starts += 1;
        if (options.stallStart === true) {
          publish(flythroughSnapshot("running", null));
          return;
        }
        const completed = flythroughSnapshot(
          "completed",
          renderFlythrough(options.callbackP95ByRepeat?.[starts - 1] ?? 1),
        );
        publish(options.transformCompleted?.(completed) ?? completed);
      },
      subscribe(listener: FlythroughListener) {
        listeners.add(listener);
        listener(snapshot);
        return () => listeners.delete(listener);
      },
    },
    startCount: () => starts,
  });
}

function renderHarness(
  onSize: (
    size: Readonly<{ readonly height: number; readonly width: number }> | null,
  ) => void = () => undefined,
  initialOverride: Readonly<{ readonly height: number; readonly width: number }> | null = null,
): RenderService {
  return {
    snapshot: () => ({ renderPixelSizeOverride: initialOverride, state: "ready" }),
    setRenderPixelSizeOverride: onSize,
  } as unknown as RenderService;
}

function flythroughSnapshot(
  state: FlythroughTelemetrySnapshot["state"],
  render: RenderFlythroughTelemetry | null,
): FlythroughTelemetrySnapshot {
  const environment = scenario.environmentPhases[0];
  if (environment === undefined) throw new Error("Test scenario has no environment phase");
  return Object.freeze({
    checkpointEvidence:
      render === null
        ? Object.freeze([])
        : Object.freeze([
            Object.freeze({
              cameraPosition: [0, 10, 0] as const,
              cameraTarget: [0, 10, 0] as const,
              checkpointId: "day",
              clearColorDistanceThreshold: 8,
              clearColorRgb: [0, 0, 0] as const,
              environment,
              environmentPhaseId: "day",
              elapsedMs: 0.5,
              height: 720,
              previewVisibleMeshCount: 0,
              rgbaSha256: "b".repeat(64),
              sampledPixelCount: 1_280 * 720,
              streamedVisibleMeshCount: 1,
              visiblePixelCount: (1_280 * 720) / 2,
              visiblePixelRatio: 0.5,
              width: 1_280,
            }),
          ]),
    failureMessage: null,
    preflightElapsedMs: state === "idle" ? null : 10_000,
    render,
    scenarioId: scenario.id,
    schemaVersion: 3,
    state,
    streamingAtMeasurementEnd: render === null ? null : streamingSnapshot(10, 1),
    streamingAtMeasurementStart: render === null ? null : streamingSnapshot(0, 0),
    validation: Object.freeze({
      distanceMeters: 1,
      durationMs: 1,
      environmentPhaseIds: Object.freeze(["day"]),
      scenarioId: scenario.id,
    }),
  });
}

function renderFlythrough(callbackP95: number): RenderFlythroughTelemetry {
  return Object.freeze({
    callbackIntervalMs: distribution(callbackP95, 9),
    cameraPositionMaximum: [1, 10, 0] as const,
    cameraPositionMinimum: [0, 10, 0] as const,
    cameraTargetMaximum: [1, 10, 0] as const,
    cameraTargetMinimum: [0, 10, 0] as const,
    completedDistanceMeters: 1,
    completedElapsedMs: 1,
    environmentFrameCounts: Object.freeze({ day: 10 }),
    environmentPhaseOrder: Object.freeze(["day"]),
    finalObserver: [1, 10, 0] as const,
    frameCount: 10,
    minimumVisibleStreamingMeshCount: 1,
    observerUpdateCount: 1,
    previewVisibleFrameCount: 0,
    renderDurationMs: distribution(1),
    scenario,
    scenarioId: scenario.id,
    state: "completed",
    streamedPresentationFrameCount: 10,
  });
}

function distribution(p95: number, sampleCount = 10) {
  return Object.freeze({
    maximum: p95,
    p50: p95,
    p95,
    p999: p95,
    sampleCount,
  });
}

function streamingSnapshot(
  sampleCount: number,
  observerUpdateCount: number,
): WorldStreamingTelemetrySnapshot {
  const samples = Object.freeze(
    Array.from({ length: sampleCount }, (_, index) => streamingSample(index + 1)),
  );
  return Object.freeze({
    cellLoadSampleCount: sampleCount,
    cellLoadSamples: samples,
    cpuBudgetRejectionCount: 0,
    currentObservers: Object.freeze([[1, 10, 0] as const]),
    decodeQueueDepthHighWater: 1,
    decodeWorkerCount: 1,
    encodedBytesRead: sampleCount,
    failureMessage: null,
    flythroughObserverUpdateCount: observerUpdateCount,
    hardwareConcurrency: 8,
    observerUpdateCount,
    opfsAccessHandleCount: 256,
    opfsAccessHandleOpenDurationMs: 10,
    opfsPackageCount: 256,
    opfsProvisionedBytes: 1,
    proactiveEvictionCount: 1,
    residentCellCount: 9,
    residentCellIds: Object.freeze(["0", "1", "2", "3", "4", "5", "6", "7", "8"]),
    residentEncodedBytes: 1,
    residentEncodedBytesHighWater: 1,
    residentGpuBytes: 1,
    residentGpuBytesHighWater: 1,
    renderRecoveryCount: 0,
    schemaVersion: 7,
    settledObserverUpdateCount: observerUpdateCount,
    settledRecoveryCheckpoint: null,
    state: "streaming",
    workerGeneration: 1,
  });
}

function streamingSample(sequence: number): StreamingCellLoadTelemetry {
  return {
    batchCellCount: 1,
    batchCellOrdinal: 1,
    batchFlythroughObserverSequence: sequence,
    batchObserverUpdateCount: sequence,
    batchOrdinal: sequence,
    cellId: `${sequence}`,
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
    sequence,
    streamingWorkerRemainderMs: 1,
    totalMs: sequence,
    uploadMs: 1,
  };
}

async function settle(service: ReturnType<typeof createBenchmarkService>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (service.snapshot().state === "completed" || service.snapshot().state === "failed") return;
    await Promise.resolve();
  }
  throw new Error(`Benchmark did not settle; state=${service.snapshot().state}`);
}

function deferredVoid(): Readonly<{ promise: Promise<void>; resolve(): void }> {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function deferredEnvironment(): Readonly<{
  promise: Promise<BenchmarkEnvironmentIdentity>;
  resolve(value: BenchmarkEnvironmentIdentity): void;
}> {
  let resolve!: (value: BenchmarkEnvironmentIdentity) => void;
  const promise = new Promise<BenchmarkEnvironmentIdentity>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
