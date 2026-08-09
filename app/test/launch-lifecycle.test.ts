import {
  LAUNCH_LIFECYCLE_CONTRACT as ENGINE_LAUNCH_LIFECYCLE_CONTRACT,
  LAUNCH_LIFECYCLE_SCHEMA_VERSION as ENGINE_LAUNCH_LIFECYCLE_SCHEMA_VERSION,
} from "@parallax/engine";
import { describe, expect, it } from "vitest";
import {
  createLaunchLifecycleTracker,
  LAUNCH_LIFECYCLE_CONTRACT,
  LAUNCH_LIFECYCLE_SCHEMA_VERSION,
} from "../src/launch-lifecycle";

const releaseDigest = "a".repeat(64);

describe("Launch-to-interactive lifecycle", () => {
  it("re-exports the engine-owned public contract identity", () => {
    expect(LAUNCH_LIFECYCLE_CONTRACT).toBe(ENGINE_LAUNCH_LIFECYCLE_CONTRACT);
    expect(LAUNCH_LIFECYCLE_SCHEMA_VERSION).toBe(ENGINE_LAUNCH_LIFECYCLE_SCHEMA_VERSION);
  });

  it("measures the complete ordered in-app boundary", () => {
    const times = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220];
    const tracker = createLaunchLifecycleTracker(() => times.shift() ?? 220);

    tracker.begin(releaseDigest);
    tracker.markInstalledPreflightPhase("initial-release-admission");
    tracker.markInstalledPreflightPhase("model-source-ready");
    tracker.markInstalledPreflightPhase("streaming-references-ready");
    tracker.markInstalledPreflightPhase("pso-trace-ready");
    tracker.markInstalledPreflightPhase("final-release-admission");
    tracker.markShellAdmission();
    tracker.markStreamingWorkerRequested();
    tracker.markSimulationWorkerRequested();
    tracker.markStreamingReady(streamingStartupTiming());
    tracker.markRenderFirstFrame();
    expect(tracker.snapshot().state).toBe("launching");
    tracker.markSimulationReady();

    expect(tracker.snapshot()).toEqual({
      attempt: 1,
      contract: LAUNCH_LIFECYCLE_CONTRACT,
      durationMs: 120,
      failureMessage: null,
      interactiveAtMs: 220,
      preflightTiming: {
        finalReleaseAdmissionAtMs: 150,
        initialReleaseAdmissionAtMs: 110,
        modelSourceReadyAtMs: 120,
        psoTraceReadyAtMs: 140,
        streamingReferencesReadyAtMs: 130,
      },
      releaseDigest,
      renderFirstFrameAtMs: 200,
      schemaVersion: LAUNCH_LIFECYCLE_SCHEMA_VERSION,
      shellAdmissionAtMs: 160,
      simulationReadyAtMs: 210,
      simulationWorkerRequestedAtMs: 180,
      startedAtMs: 100,
      state: "interactive",
      streamingReadyAtMs: 190,
      streamingStartupTiming: streamingStartupTiming(),
      streamingWorkerRequestedAtMs: 170,
    });
  });

  it("retains a typed failed terminal state without fabricating a duration", () => {
    const tracker = createLaunchLifecycleTracker(() => 10);
    tracker.begin(releaseDigest);
    tracker.fail(new Error("streaming failed"));

    expect(tracker.snapshot()).toMatchObject({
      durationMs: null,
      failureMessage: "streaming failed",
      state: "failed",
    });
  });

  it("starts a clean second attempt after a failed launch", () => {
    const nextReleaseDigest = "b".repeat(64);
    const times = [10, 20];
    const tracker = createLaunchLifecycleTracker(() => times.shift() ?? 20);
    tracker.begin(releaseDigest);
    tracker.fail(new Error("first launch failed"));

    expect(() => tracker.begin(nextReleaseDigest)).not.toThrow();
    expect(tracker.snapshot()).toMatchObject({
      attempt: 2,
      failureMessage: null,
      preflightTiming: {
        finalReleaseAdmissionAtMs: null,
        initialReleaseAdmissionAtMs: null,
        modelSourceReadyAtMs: null,
        psoTraceReadyAtMs: null,
        streamingReferencesReadyAtMs: null,
      },
      releaseDigest: nextReleaseDigest,
      startedAtMs: 20,
      state: "launching",
    });
  });

  it("ignores late subsystem milestones after a terminal failure", () => {
    const tracker = createLaunchLifecycleTracker(() => 10);
    tracker.begin(releaseDigest);
    tracker.fail(new Error("streaming failed first"));
    const failed = tracker.snapshot();

    expect(() => {
      tracker.markInstalledPreflightPhase("initial-release-admission");
      tracker.markShellAdmission();
      tracker.markStreamingWorkerRequested();
      tracker.markSimulationWorkerRequested();
      tracker.markRenderFirstFrame();
      tracker.markStreamingReady(streamingStartupTiming());
      tracker.markSimulationReady();
    }).not.toThrow();
    expect(tracker.snapshot()).toEqual(failed);
  });

  it("records a launch-control failure even when admitted identity was omitted before begin", () => {
    const tracker = createLaunchLifecycleTracker(() => 25);

    tracker.fail(new Error("Launch control omitted its admitted release identity"));

    expect(tracker.snapshot()).toMatchObject({
      attempt: 1,
      durationMs: null,
      failureMessage: "Launch control omitted its admitted release identity",
      releaseDigest: null,
      startedAtMs: 25,
      state: "failed",
    });
  });

  it("rejects identity and ordering forgery", () => {
    const invalid = createLaunchLifecycleTracker(() => 0);
    expect(() => invalid.begin("not-a-digest")).toThrow("exact release digest");

    const times = [100, 120, 90];
    const backwards = createLaunchLifecycleTracker(() => times.shift() ?? 90);
    backwards.begin(releaseDigest);
    backwards.markInstalledPreflightPhase("initial-release-admission");
    expect(() => backwards.markInstalledPreflightPhase("model-source-ready")).toThrow(
      "timestamp is invalid",
    );

    const skipped = createLaunchLifecycleTracker(() => 100);
    skipped.begin(releaseDigest);
    expect(() => skipped.markInstalledPreflightPhase("model-source-ready")).toThrow(
      "before its prerequisite",
    );
    expect(() => skipped.markShellAdmission()).toThrow("requires completed");
    expect(() => skipped.markStreamingWorkerRequested()).toThrow("requires shell admission");
    expect(() => skipped.markSimulationWorkerRequested()).toThrow(
      "requires a streaming worker request",
    );
    expect(() => skipped.markSimulationReady()).toThrow("requires a simulation worker request");
    expect(() => skipped.markStreamingReady(streamingStartupTiming())).toThrow(
      "requires complete worker startup timing",
    );

    const terminalTimes = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 175];
    const terminalBackwards = createLaunchLifecycleTracker(() => terminalTimes.shift() ?? 175);
    terminalBackwards.begin(releaseDigest);
    terminalBackwards.markInstalledPreflightPhase("initial-release-admission");
    terminalBackwards.markInstalledPreflightPhase("model-source-ready");
    terminalBackwards.markInstalledPreflightPhase("streaming-references-ready");
    terminalBackwards.markInstalledPreflightPhase("pso-trace-ready");
    terminalBackwards.markInstalledPreflightPhase("final-release-admission");
    terminalBackwards.markShellAdmission();
    terminalBackwards.markStreamingWorkerRequested();
    terminalBackwards.markSimulationWorkerRequested();
    terminalBackwards.markStreamingReady(streamingStartupTiming());
    terminalBackwards.markRenderFirstFrame();
    expect(() => terminalBackwards.markSimulationReady()).toThrow("clock moved backwards");
  });
});

function streamingStartupTiming() {
  return {
    accessHandlesOpenedAtMs: 5,
    contract: "streaming-startup-timing@1",
    decodePoolCreatedAtMs: 7,
    finalAdmissionCompletedAtMs: 6,
    initialResidencyReadyAtMs: 8,
    provisioningStartedAtMs: 2,
    releaseBindingCompletedAtMs: 3,
    releaseResolutionCompletedAtMs: 4,
    schemaVersion: 1,
    sourceKind: "installed-release",
    workerStartedAtMs: 1,
  } as const;
}
