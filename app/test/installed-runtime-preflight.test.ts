import {
  createEmbeddedPsoWarmupTrace,
  failedPsoWarmupTraceBundle,
  type InstalledModelSource,
  type InstalledReleaseBinding,
  incompatibilityFailure,
} from "@parallax/engine";
import { describe, expect, it } from "vitest";
import {
  type InstalledRuntimePreflightDependencies,
  preflightInstalledRuntime,
} from "../src/installed-runtime-preflight";

describe("installed runtime preflight", () => {
  it("fails closed before PSO-ready and final admission when trace loading returns a failure", async () => {
    const phases: string[] = [];
    let readmitCount = 0;
    const dependencies: InstalledRuntimePreflightDependencies = {
      admit: async () => binding(),
      createModelSource: () => modelSource(async () => []),
      loadPsoWarmupTrace: async () =>
        failedPsoWarmupTraceBundle(
          "installed-release",
          "a".repeat(64),
          incompatibilityFailure("trace-load", "installed trace missing"),
        ),
      onPhaseCompleted: (phase) => phases.push(phase),
      readmit: async () => {
        readmitCount += 1;
      },
      resolveStreaming: async () => undefined,
    };

    await expect(preflightInstalledRuntime("a".repeat(64), dependencies)).rejects.toThrow(
      /installed trace missing/,
    );
    expect(phases).toEqual([
      "initial-release-admission",
      "model-source-ready",
      "streaming-references-ready",
    ]);
    expect(readmitCount).toBe(0);
  });

  it("settles a failed stage before rejecting and permits a nonoverlapping retry", async () => {
    const events: string[] = [];
    const completedPhases: string[] = [];
    let activeOperations = 0;
    let maximumActiveOperations = 0;
    let firstAttempt = true;
    let rejectModel!: (error: unknown) => void;
    const blockedModel = new Promise<readonly []>((_, reject) => {
      rejectModel = reject;
    });
    const begin = (event: string): void => {
      events.push(`${event}:begin`);
      activeOperations += 1;
      maximumActiveOperations = Math.max(maximumActiveOperations, activeOperations);
    };
    const end = (event: string): void => {
      activeOperations -= 1;
      events.push(`${event}:end`);
    };
    const dependencies: InstalledRuntimePreflightDependencies = {
      async admit() {
        begin("admit");
        end("admit");
        return binding();
      },
      createModelSource() {
        const failing = firstAttempt;
        firstAttempt = false;
        return modelSource(async () => {
          begin("model");
          try {
            if (failing) return await blockedModel;
            return [];
          } finally {
            end("model");
          }
        });
      },
      async loadPsoWarmupTrace() {
        begin("pso");
        end("pso");
        return createEmbeddedPsoWarmupTrace();
      },
      onPhaseCompleted(phase) {
        completedPhases.push(phase);
      },
      async readmit() {
        begin("readmit");
        end("readmit");
      },
      async resolveStreaming() {
        begin("streaming");
        end("streaming");
      },
    };

    const failed = preflightInstalledRuntime("a".repeat(64), dependencies);
    await Promise.resolve();
    expect(events).toEqual(["admit:begin", "admit:end", "model:begin"]);
    expect(activeOperations).toBe(1);
    rejectModel(new Error("model preflight failed"));
    await expect(failed).rejects.toThrow(/model preflight failed/);
    expect(activeOperations).toBe(0);
    expect(events).not.toContain("streaming:begin");
    expect(completedPhases).toEqual(["initial-release-admission"]);
    const settledEventCount = events.length;
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toHaveLength(settledEventCount);

    await expect(preflightInstalledRuntime("a".repeat(64), dependencies)).resolves.toMatchObject({
      binding: { releaseDigest: "a".repeat(64) },
    });
    expect(maximumActiveOperations).toBe(1);
    expect(activeOperations).toBe(0);
    expect(events.slice(settledEventCount)).toEqual([
      "admit:begin",
      "admit:end",
      "model:begin",
      "model:end",
      "streaming:begin",
      "streaming:end",
      "pso:begin",
      "pso:end",
      "readmit:begin",
      "readmit:end",
    ]);
    expect(completedPhases).toEqual([
      "initial-release-admission",
      "initial-release-admission",
      "model-source-ready",
      "streaming-references-ready",
      "pso-trace-ready",
      "final-release-admission",
    ]);
  });
});

function modelSource(initialize: () => Promise<readonly []>): InstalledModelSource {
  return {
    artifacts: () => [],
    initialize,
    snapshot: () =>
      ({
        expectedArtifactBytes: 0,
        expectedArtifactCount: 0,
        failureMessage: null,
        networkFallbackCount: 0,
        releaseDigest: "a".repeat(64),
        resolvedArtifactBytes: 0,
        resolvedArtifactCount: 0,
        schemaVersion: 1,
        state: "idle",
      }) as const,
    subscribe: () => () => undefined,
  };
}

function binding(): InstalledReleaseBinding {
  return {
    getResource: () => Promise.reject(new Error("unused")),
    getResources: () => Promise.reject(new Error("unused")),
    manifest: { gameId: "parallax", resources: [], schemaVersion: 1 },
    releaseDigest: "a".repeat(64),
    snapshot: () => ({
      failureMessage: null,
      networkFallbackCount: 0,
      referencedBytes: 0,
      referencedResourceCount: 0,
      releaseDigest: "a".repeat(64),
      schemaVersion: 1,
      state: "ready",
    }),
  };
}
