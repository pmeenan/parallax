import { describe, expect, it } from "vitest";
import {
  createStreamingStartupTimingTracker,
  STREAMING_STARTUP_TIMING_CONTRACT,
} from "../src/streaming/streaming-startup-telemetry";

describe("streaming startup timing telemetry", () => {
  it("records the exact installed-release startup sequence", () => {
    const times = [10, 11, 20, 30, 50, 55, 60, 100];
    const tracker = createStreamingStartupTimingTracker(
      "installed-release",
      () => times.shift() ?? 100,
    );
    tracker.markProvisioningStarted();
    tracker.markReleaseBindingCompleted();
    tracker.markReleaseResolutionCompleted();
    tracker.markAccessHandlesOpened();
    tracker.markFinalAdmissionCompleted();
    tracker.markDecodePoolCreated();
    tracker.markInitialResidencyReady();

    expect(tracker.snapshot()).toEqual({
      accessHandlesOpenedAtMs: 50,
      contract: STREAMING_STARTUP_TIMING_CONTRACT,
      decodePoolCreatedAtMs: 60,
      finalAdmissionCompletedAtMs: 55,
      initialResidencyReadyAtMs: 100,
      provisioningStartedAtMs: 11,
      releaseBindingCompletedAtMs: 20,
      releaseResolutionCompletedAtMs: 30,
      schemaVersion: 1,
      sourceKind: "installed-release",
      workerStartedAtMs: 10,
    });
  });

  it("rejects skipped, duplicate, cross-source, and backwards milestones", () => {
    const skipped = createStreamingStartupTimingTracker("installed-release", () => 1);
    expect(() => skipped.markReleaseResolutionCompleted()).toThrow("before its prerequisite");

    const duplicate = createStreamingStartupTimingTracker("privileged-legacy-network", () => 1);
    duplicate.markProvisioningStarted();
    expect(() => duplicate.markProvisioningStarted()).toThrow("already recorded");
    expect(() => duplicate.markReleaseBindingCompleted()).toThrow(
      "cannot record installed-release binding",
    );
    expect(() => duplicate.markFinalAdmissionCompleted()).toThrow(
      "cannot record installed-release admission",
    );

    const times = [10, 20, 19];
    const backwards = createStreamingStartupTimingTracker(
      "privileged-legacy-network",
      () => times.shift() ?? 19,
    );
    backwards.markProvisioningStarted();
    expect(() => backwards.markReleaseResolutionCompleted()).toThrow("timestamp is invalid");
  });

  it("retains an explicit worker time-origin boundary without consuming the phase clock", () => {
    const times = [25, 30, 35, 40, 45];
    const tracker = createStreamingStartupTimingTracker(
      "privileged-legacy-network",
      () => times.shift() ?? 45,
      0,
    );
    tracker.markProvisioningStarted();
    tracker.markReleaseResolutionCompleted();
    tracker.markAccessHandlesOpened();
    tracker.markDecodePoolCreated();
    tracker.markInitialResidencyReady();

    expect(tracker.snapshot()).toMatchObject({
      initialResidencyReadyAtMs: 45,
      provisioningStartedAtMs: 25,
      workerStartedAtMs: 0,
    });
  });
});
