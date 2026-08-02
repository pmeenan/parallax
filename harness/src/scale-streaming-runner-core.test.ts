import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ParallaxTelemetrySnapshot, WorldStreamingTelemetrySnapshot } from "@parallax/engine";
import { afterEach, describe, expect, it } from "vitest";
import type { InstallResource } from "./install-manifest.js";
import {
  DEGRADED_DURABILITY_WARNING,
  ProgressLivenessError,
  type ProgressLivenessSnapshot,
  waitForProgressLiveness,
} from "./progress-liveness.js";
import { sanitizeScaleStreamingCause } from "./scale-streaming-evidence.js";
import {
  assertGeneratedExactRangePathDisjoint,
  captureScaleStreamingHydrationSamples,
  collectScaleStreamingHydrationMismatches,
  collectScaleStreamingInstallerAuthorityMismatches,
  collectScaleStreamingRuntimeAuthorityMismatches,
  collectScaleStreamingTraversalMismatches,
  deriveScaleStreamingConsumerPopulation,
  deriveScaleStreamingInstallTargetPopulation,
  type MaterializedScaleStreamingTarget,
  observeScaleStreamingRuntimeReadiness,
  requireScaleStreamingHydration,
  requireScaleStreamingInstallerAuthority,
  requireScaleStreamingRuntimeAuthority,
  requireScaleStreamingTraversal,
  runScaleStreamingBrowserSequence,
  type ScaleStreamingHydrationMismatchField,
  type ScaleStreamingRuntimeAuthorityMismatchField,
  type ScaleStreamingTraversalMismatchField,
  validateScaleStreamingSourceTree,
  waitForScaleStreamingRuntimeReady,
} from "./scale-streaming-runner-core.js";
import type { StreamingEvidence } from "./streaming-evidence.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("scale-streaming runner-core orchestration", () => {
  it("uses one fresh isolated profile and preserves the ordinary Install/Ready/Launch/traversal order", async () => {
    const phases: string[] = [];
    const result = await runScaleStreamingBrowserSequence({
      closeProfile: async (profile) => {
        expect(profile).toBe("fresh-profile");
        phases.push("profile-closed");
      },
      createFreshIsolatedProfile: async () => {
        phases.push("fresh-profile-created");
        return "fresh-profile" as const;
      },
      install: async () => {
        phases.push("install-clicked");
      },
      launch: async () => {
        phases.push("launch-clicked");
      },
      navigateOrdinary: async () => {
        phases.push("ordinary-navigation");
      },
      observeInstall: async () => {
        phases.push("ready-observed");
        return "ready" as const;
      },
      observeRuntime: async () => {
        phases.push("installed-runtime-observed");
        return "runtime" as const;
      },
      observeTraversal: async () => {
        phases.push("traversal-observed");
        return "end" as const;
      },
      snapshotTraversalStart: async () => {
        phases.push("traversal-start-snapshotted");
        return "start" as const;
      },
      startStandardTraversal: async () => {
        phases.push("standard-d1-traversal-started");
      },
    });

    expect(result).toEqual({ end: "end", install: "ready", runtime: "runtime", start: "start" });
    expect(phases).toEqual([
      "fresh-profile-created",
      "ordinary-navigation",
      "install-clicked",
      "ready-observed",
      "launch-clicked",
      "installed-runtime-observed",
      "traversal-start-snapshotted",
      "standard-d1-traversal-started",
      "traversal-observed",
      "profile-closed",
    ]);
  });

  it.each([
    "navigation",
    "install",
    "ready",
    "launch",
    "runtime",
    "traversal",
  ] as const)("closes the exact fresh profile after a %s failure", async (failurePhase) => {
    const phases: string[] = [];
    const fail = (phase: typeof failurePhase): void => {
      phases.push(phase);
      if (failurePhase === phase) throw new Error(`${phase} failed`);
    };
    await expect(
      runScaleStreamingBrowserSequence({
        closeProfile: async () => {
          phases.push("closed");
        },
        createFreshIsolatedProfile: async () => "profile" as const,
        install: async () => fail("install"),
        launch: async () => fail("launch"),
        navigateOrdinary: async () => fail("navigation"),
        observeInstall: async () => {
          fail("ready");
          return "ready";
        },
        observeRuntime: async () => {
          fail("runtime");
          return "runtime";
        },
        observeTraversal: async () => {
          fail("traversal");
          return "end";
        },
        snapshotTraversalStart: async () => "start",
        startStandardTraversal: async () => undefined,
      }),
    ).rejects.toThrow(`${failurePhase} failed`);
    expect(phases.at(-1)).toBe("closed");
    expect(phases.filter((phase) => phase === "closed")).toHaveLength(1);
  });

  it("does not hide the profile cleanup failure", async () => {
    await expect(
      runScaleStreamingBrowserSequence({
        closeProfile: async () => {
          throw new Error("profile cleanup failed");
        },
        createFreshIsolatedProfile: async () => "profile" as const,
        install: async () => undefined,
        launch: async () => undefined,
        navigateOrdinary: async () => undefined,
        observeInstall: async () => "ready",
        observeRuntime: async () => "runtime",
        observeTraversal: async () => "end",
        snapshotTraversalStart: async () => "start",
        startStandardTraversal: async () => undefined,
      }),
    ).rejects.toThrow("profile cleanup failed");
  });

  it("retains both the primary failure and cleanup failure", async () => {
    const failure = await runScaleStreamingBrowserSequence({
      closeProfile: async () => {
        throw new Error("profile cleanup failed");
      },
      createFreshIsolatedProfile: async () => "profile" as const,
      install: async () => {
        throw new Error("install failed");
      },
      launch: async () => undefined,
      navigateOrdinary: async () => undefined,
      observeInstall: async () => "ready",
      observeRuntime: async () => "runtime",
      observeTraversal: async () => "end",
      snapshotTraversalStart: async () => "start",
      startStandardTraversal: async () => undefined,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toMatchObject([
      { message: "install failed" },
      { message: "profile cleanup failed" },
    ]);
  });
});

describe("scale-streaming materializer boundaries", () => {
  it("derives installer authority from OPFS resources while conserving nonzero shell inventory", () => {
    expect(
      deriveScaleStreamingInstallTargetPopulation({
        bytesByScope: { "app-shell": 20, common: 30, "game-specific": 70 },
        bytesByTarget: { opfs: 100, shell: 20 },
        countByScope: { "app-shell": 2, common: 1, "game-specific": 3 },
        countByTarget: { opfs: 4, shell: 2 },
        resourceBytes: 120,
        resourceCount: 6,
      }),
    ).toEqual({
      manifestBytes: 120,
      manifestResourceCount: 6,
      opfsBytes: 100,
      opfsResourceCount: 4,
      shellBytes: 20,
      shellResourceCount: 2,
    });
    expect(() =>
      deriveScaleStreamingInstallTargetPopulation({
        bytesByScope: { "app-shell": 20, common: 30, "game-specific": 70 },
        bytesByTarget: { opfs: 100, shell: 20 },
        countByScope: { "app-shell": 2, common: 1, "game-specific": 3 },
        countByTarget: { opfs: 4, shell: 2 },
        resourceBytes: 121,
        resourceCount: 6,
      }),
    ).toThrow(/does not conserve manifest totals/u);
  });

  it("partitions the exact OPFS streaming subset, models, and unconstrained remainder", () => {
    const resources = [
      installResource("stream-index", 10, "district-index", "opfs"),
      installResource("stream-cell", 20, "world-cell", "opfs"),
      installResource("model", 40, "model", "opfs"),
      installResource("pso-or-other", 30, "asset-pack", "opfs"),
      installResource("shell", 50, "module", "shell"),
    ];
    expect(
      deriveScaleStreamingConsumerPopulation(resources, new Set(["stream-index", "stream-cell"])),
    ).toEqual({
      modelBytes: 40,
      modelResourceCount: 1,
      opfsBytes: 100,
      opfsResourceCount: 4,
      otherBytes: 30,
      otherResourceCount: 1,
      representativeBytes: 30,
      representativeResourceCount: 2,
    });
    expect(() =>
      deriveScaleStreamingConsumerPopulation(resources, new Set(["stream-index", "absent"])),
    ).toThrow(/not an exact OPFS subset/u);
    expect(() => deriveScaleStreamingConsumerPopulation(resources, new Set(["model"]))).toThrow(
      /not an exact OPFS subset/u,
    );
  });

  it("accepts only a direct contained regular tree and rejects a junction before copying", async () => {
    const root = await temporary("scale-runner-tree-");
    const outside = await temporary("scale-runner-outside-");
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", "direct.bin"), "direct");
    await expect(validateScaleStreamingSourceTree(root, "fixture")).resolves.toBe(root);

    await symlink(outside, join(root, "nested", "junction"), "junction");
    await expect(validateScaleStreamingSourceTree(root, "fixture")).rejects.toThrow(
      /link or reparse point/u,
    );
  });

  it("rejects generated path duplication and overlap with an existing exact Range path", () => {
    const corpus = {
      graphs: [{ resources: [{ source: "immutable/generated.bin" }] }],
    } as never;
    expect(() =>
      assertGeneratedExactRangePathDisjoint(corpus, [{ source: "immutable/generated.bin" }]),
    ).toThrow(/overlaps an exact Range path/u);
    expect(() => assertGeneratedExactRangePathDisjoint(corpus, [])).not.toThrow();
  });
});

describe("scale-streaming Ready and runtime authority", () => {
  it("requires exact terminal verification totals at the installer Ready boundary", () => {
    const target = targetFixture();
    const authority = authorityFixture();
    const liveness = livenessFixture();
    expect(() =>
      requireScaleStreamingInstallerAuthority(authority, liveness, target),
    ).not.toThrow();
    expect(() =>
      requireScaleStreamingInstallerAuthority(
        authority,
        {
          ...liveness,
          lastProgressTuple: { ...liveness.lastProgressTuple, finalVerificationBytes: 99 },
        },
        target,
      ),
    ).toThrow(/Ready authority/u);
  });

  it("names every installer Ready predicate with bounded expected and actual values", () => {
    const cases = [
      {
        actual: "installing",
        expected: "ready",
        field: "authority.state",
        mutate: () => ({ authority: { ...authorityFixture(), state: "installing" } }),
      },
      {
        actual: false,
        expected: true,
        field: "authority.launchEnabled",
        mutate: () => ({ authority: { ...authorityFixture(), launchEnabled: false } }),
      },
      {
        actual: `sha256:${"c".repeat(12)}`,
        expected: `sha256:${"b".repeat(12)}`,
        field: "authority.releaseDigest",
        mutate: () => ({ authority: { ...authorityFixture(), releaseDigest: "c".repeat(64) } }),
      },
      {
        actual: `generation:${"a".repeat(12)}:${"c".repeat(12)}`,
        expected: `generation:${"a".repeat(12)}:${"b".repeat(12)}`,
        field: "authority.shellGenerationId",
        mutate: () => ({
          authority: {
            ...authorityFixture(),
            shellGenerationId: `${"a".repeat(64)}:${"c".repeat(64)}`,
          },
        }),
      },
      {
        actual: "requesting",
        expected: "granted|denied",
        field: "authority.persistence",
        mutate: () => ({ authority: { ...authorityFixture(), persistence: "requesting" } }),
      },
      {
        actual: false,
        expected: true,
        field: "authority.durabilityClaimed",
        mutate: () => ({ authority: { ...authorityFixture(), durabilityClaimed: false } }),
      },
      {
        actual: "<other-non-null>",
        expected: null,
        field: "authority.persistenceWarning",
        mutate: () => ({
          authority: { ...authorityFixture(), persistenceWarning: "C:\\private\\warning" },
        }),
      },
      {
        actual: "verifying",
        expected: "complete",
        field: "liveness.finalVerificationPhase",
        mutate: () => ({ liveness: mutateLiveness({ finalVerificationPhase: "verifying" }) }),
      },
      {
        actual: 99,
        expected: 100,
        field: "liveness.finalVerificationBytes",
        mutate: () => ({ liveness: mutateLiveness({ finalVerificationBytes: 99 }) }),
      },
      {
        actual: 99,
        expected: 100,
        field: "liveness.finalVerificationTotalBytes",
        mutate: () => ({ liveness: mutateLiveness({ finalVerificationTotalBytes: 99 }) }),
      },
      {
        actual: 3,
        expected: 4,
        field: "liveness.finalVerificationResourceCount",
        mutate: () => ({ liveness: mutateLiveness({ finalVerificationResourceCount: 3 }) }),
      },
      {
        actual: 3,
        expected: 4,
        field: "liveness.finalVerificationTotalResourceCount",
        mutate: () => ({ liveness: mutateLiveness({ finalVerificationTotalResourceCount: 3 }) }),
      },
      {
        actual: 3,
        expected: 4,
        field: "liveness.completedResourceCount",
        mutate: () => ({ liveness: mutateLiveness({ completedResourceCount: 3 }) }),
      },
    ] as const;
    for (const testCase of cases) {
      const mutated = testCase.mutate() as Readonly<{
        authority?: ReturnType<typeof authorityFixture>;
        liveness?: ProgressLivenessSnapshot;
      }>;
      const mismatches = collectScaleStreamingInstallerAuthorityMismatches(
        mutated.authority ?? authorityFixture(),
        mutated.liveness ?? livenessFixture(),
        targetFixture(),
      );
      expect(mismatches, testCase.field).toEqual([
        {
          actual: testCase.actual,
          expected: testCase.expected,
          field: testCase.field,
        },
      ]);
      let failure: unknown = null;
      try {
        requireScaleStreamingInstallerAuthority(
          mutated.authority ?? authorityFixture(),
          mutated.liveness ?? livenessFixture(),
          targetFixture(),
        );
      } catch (error: unknown) {
        failure = error;
      }
      const retained = sanitizeScaleStreamingCause(failure);
      expect(retained, testCase.field).toContain(testCase.field);
      expect(retained, testCase.field).toContain(`expected=${JSON.stringify(testCase.expected)}`);
      expect(retained, testCase.field).toContain(`actual=${JSON.stringify(testCase.actual)}`);
      expect(retained, testCase.field).not.toContain("private");
    }
    const wrongAllOpfsStreaming = runtimeCase(
      "streaming.installedResourceCount",
      3,
      4,
      "streaming",
      { installedResourceBytes: 100, installedResourceCount: 4 },
    ).mutate(runtimeFixture());
    expect(
      collectScaleStreamingRuntimeAuthorityMismatches(
        wrongAllOpfsStreaming,
        authorityFixture(),
        targetFixture(),
      ),
    ).toEqual([
      { actual: 4, expected: 3, field: "streaming.installedResourceCount" },
      { actual: 100, expected: 60, field: "streaming.installedResourceBytes" },
    ]);
  });

  it("orders multiple installer mismatches and accepts both valid persistence outcomes", () => {
    const authority = {
      ...authorityFixture(),
      launchEnabled: false,
      releaseDigest: "c".repeat(64),
      state: "installing",
    };
    const liveness = mutateLiveness({
      completedResourceCount: 3,
      finalVerificationBytes: 99,
    });
    expect(
      collectScaleStreamingInstallerAuthorityMismatches(authority, liveness, targetFixture()).map(
        ({ field }) => field,
      ),
    ).toEqual([
      "authority.state",
      "authority.launchEnabled",
      "authority.releaseDigest",
      "liveness.finalVerificationBytes",
      "liveness.completedResourceCount",
    ]);
    expect(() =>
      requireScaleStreamingInstallerAuthority(
        authorityFixture(),
        livenessFixture(),
        targetFixture(),
      ),
    ).not.toThrow();
    expect(() =>
      requireScaleStreamingInstallerAuthority(
        {
          ...authorityFixture(),
          durabilityClaimed: false,
          persistence: "denied",
          persistenceWarning: DEGRADED_DURABILITY_WARNING,
        },
        livenessFixture(),
        targetFixture(),
      ),
    ).not.toThrow();
    expect(
      collectScaleStreamingInstallerAuthorityMismatches(
        {
          ...authorityFixture(),
          durabilityClaimed: true,
          persistence: "denied",
          persistenceWarning: DEGRADED_DURABILITY_WARNING,
        },
        livenessFixture(),
        targetFixture(),
      ).map(({ field }) => field),
    ).toContain("authority.durabilityClaimed");
  });

  it("derives durability independently from browser and transfer persistence state", async () => {
    const source = await readFile(
      new URL("./scale-streaming-runner-core.ts", import.meta.url),
      "utf8",
    );
    const pageOperations = source.slice(
      source.indexOf("export function createScaleStreamingPageOperations"),
      source.indexOf("export function requireScaleStreamingInstallerAuthority"),
    );
    expect(pageOperations).toContain("await navigator.storage.persisted()");
    expect(pageOperations).toContain("transfer.persistedState");
    expect(pageOperations).toContain("const durabilityClaimed = transferPersistedState === true");
    expect(pageOperations).not.toContain('durabilityClaimed: ui.persistence === "granted"');
  });

  it("names every runtime predicate with bounded deterministic expected and actual values", () => {
    const digestA = `sha256:${"a".repeat(12)}`;
    const digestB = `sha256:${"b".repeat(12)}`;
    const digestC = `sha256:${"c".repeat(12)}`;
    const generationC = `generation:${"a".repeat(12)}:${"c".repeat(12)}`;
    const generationExpected = `generation:${"a".repeat(12)}:${"b".repeat(12)}`;
    const cases = [
      runtimeCase("installStore.state", "ready", "idle", "installStore", { state: "idle" }),
      runtimeCase("installStore.activeReleaseDigest", digestB, digestC, "installStore", {
        activeReleaseDigest: "c".repeat(64),
      }),
      runtimeCase("installStore.currentReleaseDigest", null, digestC, "installStore", {
        currentReleaseDigest: "c".repeat(64),
      }),
      runtimeCase("installStore.currentResourceId", null, "<non-null>", "installStore", {
        currentResourceId: "C:\\private\\resource",
      }),
      runtimeCase("installStore.failureMessage", null, "<non-null>", "installStore", {
        failureMessage: "C:\\private\\failure",
      }),
      runtimeCase("installStore.partialBytes", 0, 1, "installStore", { partialBytes: 1 }),
      runtimeCase("installStore.partialResourceCount", 0, 1, "installStore", {
        partialResourceCount: 1,
      }),
      runtimeCase("installStore.garbageCollectionRemaining", false, true, "installStore", {
        garbageCollectionRemaining: true,
      }),
      runtimeCase("installStore.finalVerificationPhase", "complete", "verifying", "installStore", {
        finalVerificationPhase: "verifying",
      }),
      runtimeCase("installStore.finalVerificationBytes", 100, 99, "installStore", {
        finalVerificationBytes: 99,
      }),
      runtimeCase("installStore.finalVerificationTotalBytes", 100, 99, "installStore", {
        finalVerificationTotalBytes: 99,
      }),
      runtimeCase("installStore.finalVerificationResourceCount", 4, 3, "installStore", {
        finalVerificationResourceCount: 3,
      }),
      runtimeCase("installStore.finalVerificationTotalResourceCount", 4, 3, "installStore", {
        finalVerificationTotalResourceCount: 3,
      }),
      runtimeCase("installerTransfer.activeReleaseDigest", digestB, digestC, "installerTransfer", {
        activeReleaseDigest: "c".repeat(64),
      }),
      runtimeCase("installerTransfer.state", "ready", "verifying", "installerTransfer", {
        state: "verifying",
      }),
      runtimeCase("installerTransfer.failureMessage", null, "<non-null>", "installerTransfer", {
        failureMessage: "C:\\private\\failure",
      }),
      runtimeCase(
        "installerTransfer.finalVerificationPhase",
        "complete",
        "verifying",
        "installerTransfer",
        { finalVerificationPhase: "verifying" },
      ),
      runtimeCase("installerTransfer.finalVerificationBytes", 100, 99, "installerTransfer", {
        finalVerificationBytes: 99,
      }),
      runtimeCase("installerTransfer.finalVerificationTotalBytes", 100, 99, "installerTransfer", {
        finalVerificationTotalBytes: 99,
      }),
      runtimeCase("installerTransfer.finalVerificationResourceCount", 4, 3, "installerTransfer", {
        finalVerificationResourceCount: 3,
      }),
      runtimeCase(
        "installerTransfer.finalVerificationTotalResourceCount",
        4,
        3,
        "installerTransfer",
        { finalVerificationTotalResourceCount: 3 },
      ),
      runtimeCase("installerTransfer.totalBytes", 100, 99, "installerTransfer", {
        totalBytes: 99,
      }),
      runtimeCase("installerTransfer.resourceCount", 4, 3, "installerTransfer", {
        resourceCount: 3,
      }),
      runtimeCase("offlineShell.state", "active", "preparing", "offlineShell", {
        state: "preparing",
      }),
      runtimeCase("offlineShell.activeArtifactDigest", digestA, digestC, "offlineShell", {
        activeArtifactDigest: "c".repeat(64),
      }),
      runtimeCase("offlineShell.activeReleaseDigest", digestB, digestC, "offlineShell", {
        activeReleaseDigest: "c".repeat(64),
      }),
      runtimeCase(
        "offlineShell.activeGenerationId",
        generationExpected,
        generationC,
        "offlineShell",
        { activeGenerationId: `${"a".repeat(64)}:${"c".repeat(64)}` },
      ),
      runtimeCase("offlineShell.failureCode", null, "shell-contract", "offlineShell", {
        failureCode: "shell-contract",
      }),
      runtimeCase("offlineShell.failureMessage", null, "<non-null>", "offlineShell", {
        failureMessage: "C:\\private\\failure",
      }),
      runtimeCase("offlineShell.mixedGenerationCount", 0, 1, "offlineShell", {
        mixedGenerationCount: 1,
      }),
      runtimeCase("installedModelSource.state", "ready", "resolving", "installedModelSource", {
        state: "resolving",
      }),
      runtimeCase("installedModelSource.releaseDigest", digestB, digestC, "installedModelSource", {
        releaseDigest: "c".repeat(64),
      }),
      runtimeCase("installedModelSource.resolvedArtifactCount", 5, 4, "installedModelSource", {
        resolvedArtifactCount: 4,
      }),
      runtimeCase(
        "installedModelSource.resolvedArtifactBytes",
        2_620_371_552,
        2_620_371_551,
        "installedModelSource",
        { resolvedArtifactBytes: 2_620_371_551 },
      ),
      runtimeCase("streaming.installedReleaseDigest", digestB, digestC, "streaming", {
        installedReleaseDigest: "c".repeat(64),
      }),
      runtimeCase("streaming.legacyNetworkRequestCount", 0, 1, "streaming", {
        legacyNetworkRequestCount: 1,
      }),
      runtimeCase("streaming.installedResourceCount", 3, 4, "streaming", {
        installedResourceCount: 4,
      }),
      runtimeCase("streaming.installedResourceBytes", 60, 100, "streaming", {
        installedResourceBytes: 100,
      }),
    ] as const;
    expect(cases).toHaveLength(38);
    for (const testCase of cases) {
      const runtime = testCase.mutate(runtimeFixture());
      const mismatches = collectScaleStreamingRuntimeAuthorityMismatches(
        runtime,
        authorityFixture(),
        targetFixture(),
      );
      expect(mismatches, testCase.field).toEqual([
        { actual: testCase.actual, expected: testCase.expected, field: testCase.field },
      ]);
      let failure: unknown = null;
      try {
        requireScaleStreamingRuntimeAuthority(runtime, authorityFixture(), targetFixture());
      } catch (error: unknown) {
        failure = error;
      }
      const retained = sanitizeScaleStreamingCause(failure);
      expect(retained, testCase.field).toContain(testCase.field);
      expect(retained, testCase.field).toContain(`expected=${JSON.stringify(testCase.expected)}`);
      expect(retained, testCase.field).toContain(`actual=${JSON.stringify(testCase.actual)}`);
      expect(retained, testCase.field).not.toContain("private");
    }
  });

  it("rejects all-resource or byte/count-swapped totals at installer and runtime boundaries", () => {
    const target = targetFixture();
    const allResourceTarget = {
      ...target,
      population: { ...target.population, installBytes: 120, installResourceCount: 6 },
    } as MaterializedScaleStreamingTarget;
    expect(() =>
      requireScaleStreamingInstallerAuthority(
        authorityFixture(),
        livenessFixture(),
        allResourceTarget,
      ),
    ).toThrow(/liveness\.finalVerificationBytes/u);
    expect(() =>
      requireScaleStreamingRuntimeAuthority(
        runtimeFixture(),
        authorityFixture(),
        allResourceTarget,
      ),
    ).toThrow(/runtime authority/u);

    const swappedTarget = {
      ...target,
      population: { ...target.population, installBytes: 4, installResourceCount: 100 },
    } as MaterializedScaleStreamingTarget;
    expect(() =>
      requireScaleStreamingInstallerAuthority(authorityFixture(), livenessFixture(), swappedTarget),
    ).toThrow(/liveness\.finalVerificationBytes/u);
    expect(() =>
      requireScaleStreamingRuntimeAuthority(runtimeFixture(), authorityFixture(), swappedTarget),
    ).toThrow(/runtime authority/u);
  });

  it("requires exact ready store/shell identities and rejects partial or pending GC state", () => {
    const target = targetFixture();
    const authority = authorityFixture();
    const runtime = runtimeFixture();
    expect(() => requireScaleStreamingRuntimeAuthority(runtime, authority, target)).not.toThrow();
    for (const installStore of [
      { ...runtime.installStore, partialResourceCount: 1 },
      { ...runtime.installStore, garbageCollectionRemaining: true },
      { ...runtime.installStore, finalVerificationTotalBytes: 101 },
    ]) {
      expect(() =>
        requireScaleStreamingRuntimeAuthority(
          { ...runtime, installStore } as ParallaxTelemetrySnapshot,
          authority,
          target,
        ),
      ).toThrow(/runtime authority/u);
    }
    expect(() =>
      requireScaleStreamingRuntimeAuthority(
        {
          ...runtime,
          offlineShell: { ...runtime.offlineShell, activeGenerationId: "wrong" },
        } as ParallaxTelemetrySnapshot,
        authority,
        target,
      ),
    ).toThrow(/runtime authority/u);
  });
});

describe("scale-streaming hydration and traversal accounting", () => {
  it("captures an immutable initial sample set that remains distinct from traversal samples", () => {
    const hydration = hydrationSnapshot();
    const captured = captureScaleStreamingHydrationSamples(hydration);
    const traversal = traversalEvidence();
    expect(captured).toEqual(hydration.cellLoadSamples);
    expect(captured).not.toBe(hydration.cellLoadSamples);
    expect(captured[0]).not.toBe(hydration.cellLoadSamples[0]);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(captured.every(Object.isFrozen)).toBe(true);
    expect(captured.map(({ dependencyEncodedBytes }) => dependencyEncodedBytes)).toEqual([40]);
    expect(
      traversal.measurementCellLoadSamples.map(
        ({ dependencyEncodedBytes }) => dependencyEncodedBytes,
      ),
    ).toEqual([20, 20]);
  });

  it("retains the truthful hydration pipeline summary", () => {
    const snapshot = hydrationSnapshot();
    expect(requireScaleStreamingHydration(snapshot)).toEqual({
      decodeCacheMissCount: 2,
      decodeQueueDepthHighWater: 4,
      decodeWorkerCount: 4,
      decodedBytes: 80,
      encodedBytesRead: 40,
      gpuCacheMissCount: 2,
      psoWarmupGameplayOverlapCount: 0,
      readCount: 2,
      renderBatchCellCountHighWater: 2,
      uploadBytes: 80,
      uploadCount: 2,
    });
  });

  it("accepts same-sample and split cross-sample hydration attribution", () => {
    expect(collectScaleStreamingHydrationMismatches(hydrationSnapshot())).toEqual([]);
    const split = splitHydrationSnapshot();
    expect(collectScaleStreamingHydrationMismatches(split)).toEqual([]);
    expect(requireScaleStreamingHydration(split)).toEqual({
      decodeCacheMissCount: 2,
      decodeQueueDepthHighWater: 4,
      decodeWorkerCount: 4,
      decodedBytes: 80,
      encodedBytesRead: 40,
      gpuCacheMissCount: 2,
      psoWarmupGameplayOverlapCount: 0,
      readCount: 2,
      renderBatchCellCountHighWater: 2,
      uploadBytes: 80,
      uploadCount: 2,
    });
  });

  it("rejects missing read, decode, or upload attribution and exact sum divergence", () => {
    const split = splitHydrationSnapshot();
    const stages = [
      {
        bytes: "dependencyEncodedBytes",
        contribution: "cellLoadSamples.readContribution",
        sum: "cellLoadSamples.encodedBytes",
      },
      {
        bytes: "dependencyDecodedBytes",
        contribution: "cellLoadSamples.decodeContribution",
        sum: "cellLoadSamples.decodedBytes",
      },
      {
        bytes: "dependencyUploadBytes",
        contribution: "cellLoadSamples.uploadContribution",
        sum: "cellLoadSamples.uploadBytes",
      },
    ] as const;
    for (const stage of stages) {
      const snapshot = {
        ...split,
        cellLoadSamples: split.cellLoadSamples.map((sample) => ({
          ...sample,
          [stage.bytes]: 0,
        })),
      } as WorldStreamingTelemetrySnapshot;
      expect(
        collectScaleStreamingHydrationMismatches(snapshot).map(({ field }) => field),
        stage.bytes,
      ).toEqual([stage.contribution, stage.sum]);
    }

    const [first, ...rest] = split.cellLoadSamples;
    if (first === undefined) throw new Error("Split hydration fixture is empty");
    const divergent = {
      ...split,
      cellLoadSamples: [
        { ...first, dependencyEncodedBytes: (first.dependencyEncodedBytes ?? 0) - 1 },
        ...rest,
      ],
    } as WorldStreamingTelemetrySnapshot;
    expect(collectScaleStreamingHydrationMismatches(divergent)).toEqual([
      { actual: 39, expected: 40, field: "cellLoadSamples.encodedBytes" },
    ]);
  });

  it("rejects invalid dependency attribution timing or count", () => {
    const split = splitHydrationSnapshot();
    const [first, second] = split.cellLoadSamples;
    if (first === undefined || second === undefined) {
      throw new Error("Split hydration fixture is incomplete");
    }
    const invalid = [
      {
        ...split,
        cellLoadSamples: [{ ...first, dependencyReadMs: -1 }, second],
      },
      {
        ...split,
        cellLoadSampleCount: 3,
        cellLoadSamples: [
          first,
          second,
          {
            ...second,
            dependencyCount: -1,
            dependencyDecodedBytes: 0,
            dependencyEncodedBytes: 0,
            dependencyUploadBytes: 0,
          },
        ],
      },
    ] as unknown as readonly WorldStreamingTelemetrySnapshot[];
    for (const snapshot of invalid) {
      expect(collectScaleStreamingHydrationMismatches(snapshot)).toEqual([
        { actual: false, expected: true, field: "cellLoadSamples.attribution" },
      ]);
    }
  });

  it("fails closed when initial hydration samples are truncated or exceed the 256-sample limit", () => {
    const sameCell = hydrationSnapshot();
    expect(
      collectScaleStreamingHydrationMismatches({
        ...sameCell,
        cellLoadSampleCount: 2,
      }).map(({ field }) => field),
    ).toEqual(["cellLoadSamples.retainedCount"]);
    const first = sameCell.cellLoadSamples[0];
    if (first === undefined) throw new Error("Same-cell hydration fixture is empty");
    const zeroContribution = {
      ...first,
      dependencyCount: 0,
      dependencyDecodeMs: 0,
      dependencyDecodedBytes: 0,
      dependencyEncodedBytes: 0,
      dependencyReadMs: 0,
      dependencyUploadBytes: 0,
      dependencyUploadMs: 0,
    };
    const overLimit = {
      ...sameCell,
      cellLoadSampleCount: 257,
      cellLoadSamples: [first, ...Array.from({ length: 256 }, () => ({ ...zeroContribution }))],
    } as WorldStreamingTelemetrySnapshot;
    expect(collectScaleStreamingHydrationMismatches(overLimit)).toEqual([
      { actual: 257, expected: "<=256", field: "cellLoadSamples.sampleLimit" },
    ]);
  });

  it("keeps an authority-ready runtime launching until hydration settles on a later poll", async () => {
    const clock = new FakeReadyClock();
    const pendingHydration = runtimeHydrationFixture({
      ...hydrationSnapshot(),
      dependencyUploadCount: 0,
    });
    const settledHydration = runtimeHydrationFixture();
    const observedStates: (string | null)[] = [];
    let reads = 0;
    const pending = waitForProgressLiveness(async () => {
      const snapshot = reads === 0 ? pendingHydration : settledHydration;
      reads += 1;
      const observation = observeScaleStreamingRuntimeReadiness(snapshot, targetFixture());
      observedStates.push(observation.state);
      return { observation, value: snapshot };
    }, clock.platform);
    await clock.runUntil(() => reads === 2);
    const result = await pending;
    expect(observedStates).toEqual(["launching", "ready"]);
    expect(result.value).toBe(settledHydration);
    expect(reads).toBe(2);

    const failed = {
      ...pendingHydration,
      render: { ...pendingHydration.render, state: "failed" },
    } as ParallaxTelemetrySnapshot;
    expect(observeScaleStreamingRuntimeReadiness(failed, targetFixture()).state).toBe("failed");

    const shellPending = {
      ...settledHydration,
      offlineShell: { ...settledHydration.offlineShell, state: "preparing" },
    } as ParallaxTelemetrySnapshot;
    expect(observeScaleStreamingRuntimeReadiness(shellPending, targetFixture()).state).toBe(
      "launching",
    );

    const shellFailed = {
      ...settledHydration,
      offlineShell: {
        ...settledHydration.offlineShell,
        failureCode: "shell-contract",
        failureMessage: "shell terminal failure",
        state: "failed",
      },
    } as ParallaxTelemetrySnapshot;
    expect(observeScaleStreamingRuntimeReadiness(shellFailed, targetFixture())).toMatchObject({
      state: "failed",
      terminalCause: "shell terminal failure",
    });

    const transferFailed = {
      ...settledHydration,
      installerTransfer: {
        ...settledHydration.installerTransfer,
        failureCode: "transport",
        failureMessage: "transfer terminal failure",
        state: "failed",
      },
    } as ParallaxTelemetrySnapshot;
    expect(observeScaleStreamingRuntimeReadiness(transferFailed, targetFixture())).toMatchObject({
      state: "failed",
      terminalCause: "transfer terminal failure",
    });
  });

  it("retains the stall classification with exact final hydration mismatches", async () => {
    const clock = new FakeReadyClock();
    const pendingHydration = runtimeHydrationFixture({
      ...hydrationSnapshot(),
      dependencyUploadCount: 0,
    });
    let reads = 0;
    const pending = waitForScaleStreamingRuntimeReady({
      authority: authorityFixture(),
      platform: clock.platform,
      profile: "profile",
      readRuntime: async () => {
        reads += 1;
        return pendingHydration;
      },
      target: targetFixture(),
    }).catch((error: unknown) => error);
    await clock.runUntil(() => reads === 121);
    const failure = await pending;
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("runtime stall timeout");
    expect((failure as Error).message).toContain("final hydration mismatches");
    expect((failure as Error).message).toContain('dependencyUploadCount[expected=">0",actual=0]');
    expect((failure as Error).cause).toBeInstanceOf(ProgressLivenessError);
    expect(((failure as Error).cause as ProgressLivenessError).liveness).toMatchObject({
      timeoutClassification: "stall",
    });
  });

  it("accepts a hydration-complete final read that wins the timeout race", async () => {
    const clock = new FakeReadyClock();
    const pendingHydration = runtimeHydrationFixture({
      ...hydrationSnapshot(),
      dependencyUploadCount: 0,
    });
    const settledHydration = runtimeHydrationFixture();
    let reads = 0;
    const pending = waitForScaleStreamingRuntimeReady({
      authority: authorityFixture(),
      platform: clock.platform,
      profile: "profile",
      readRuntime: async () => {
        reads += 1;
        return reads === 121 ? settledHydration : pendingHydration;
      },
      target: targetFixture(),
    });
    await clock.runUntil(() => reads === 121);
    await expect(pending).resolves.toBe(settledHydration);
  });

  it("rejects hydration-valid final races with any full runtime authority mismatch", async () => {
    const valid = runtimeHydrationFixture();
    const cases = [
      {
        field: "installStore.partialBytes",
        snapshot: {
          ...valid,
          installStore: { ...valid.installStore, partialBytes: 1 },
        } as ParallaxTelemetrySnapshot,
      },
      {
        field: "offlineShell.activeGenerationId",
        snapshot: {
          ...valid,
          offlineShell: {
            ...valid.offlineShell,
            activeGenerationId: `${"a".repeat(64)}:${"c".repeat(64)}`,
          },
        } as ParallaxTelemetrySnapshot,
      },
      {
        field: "streaming.installedResourceCount",
        snapshot: {
          ...valid,
          streaming: {
            ...valid.streaming,
            installedResourceBytes: 100,
            installedResourceCount: 4,
          },
        } as ParallaxTelemetrySnapshot,
      },
    ] as const;
    for (const testCase of cases) {
      const failure = await runtimeTimeoutOutcome(testCase.snapshot);
      expect(failure, testCase.field).toBeInstanceOf(Error);
      expect((failure as Error).message, testCase.field).toContain("runtime stall timeout");
      expect((failure as Error).message, testCase.field).toContain("final authority mismatches");
      expect((failure as Error).message, testCase.field).toContain(testCase.field);
      expect((failure as Error).cause, testCase.field).toBeInstanceOf(ProgressLivenessError);
    }
  });

  it("retains combined final authority and hydration mismatches under one timeout cause", async () => {
    const valid = runtimeHydrationFixture();
    const failure = await runtimeTimeoutOutcome({
      ...valid,
      installStore: { ...valid.installStore, partialBytes: 1 },
      streaming: { ...valid.streaming, dependencyUploadCount: 0 },
    } as ParallaxTelemetrySnapshot);
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain("runtime stall timeout");
    expect(message).toContain("final authority mismatches");
    expect(message).toContain("installStore.partialBytes[expected=0,actual=1]");
    expect(message).toContain("final hydration mismatches");
    expect(message).toContain('dependencyUploadCount[expected=">0",actual=0]');
    expect(message.indexOf("final authority mismatches")).toBeLessThan(
      message.indexOf("final hydration mismatches"),
    );
    expect((failure as Error).cause).toBeInstanceOf(ProgressLivenessError);
  });

  it("preserves liveness authority and sanitizes a final telemetry read failure", async () => {
    const clock = new FakeReadyClock();
    const pendingHydration = runtimeHydrationFixture({
      ...hydrationSnapshot(),
      dependencyUploadCount: 0,
    });
    let finalSignal: AbortSignal | undefined;
    let reads = 0;
    const pending = waitForScaleStreamingRuntimeReady({
      authority: authorityFixture(),
      platform: clock.platform,
      profile: "profile",
      readRuntime: async (_profile, signal) => {
        reads += 1;
        if (reads === 121) {
          finalSignal = signal;
          throw new Error("C:\\secret\\runtime.json token=hunter2");
        }
        return pendingHydration;
      },
      target: targetFixture(),
    }).catch((error: unknown) => error);
    await clock.runUntil(() => reads === 121);
    const failure = await pending;
    expect(failure).toBeInstanceOf(AggregateError);
    const aggregate = failure as AggregateError;
    expect(aggregate.errors[0]).toBeInstanceOf(ProgressLivenessError);
    expect(aggregate.errors[1]).toBeInstanceOf(Error);
    expect((aggregate.errors[1] as Error).message).not.toMatch(/secret|hunter2/u);
    expect(aggregate.message).not.toMatch(/secret|hunter2/u);
    expect(sanitizeScaleStreamingCause(aggregate)).not.toMatch(/secret|hunter2/u);
    expect(finalSignal?.aborted).toBe(true);
  });

  it("aborts a nonsettling final telemetry read at one polling interval", async () => {
    const clock = new FakeReadyClock();
    const pendingHydration = runtimeHydrationFixture({
      ...hydrationSnapshot(),
      dependencyUploadCount: 0,
    });
    let finalAborted = false;
    let reads = 0;
    const pending = waitForScaleStreamingRuntimeReady({
      authority: authorityFixture(),
      platform: clock.platform,
      profile: "profile",
      readRuntime: async (_profile, signal) => {
        reads += 1;
        if (reads !== 121) return pendingHydration;
        return new Promise<ParallaxTelemetrySnapshot | null>(() => {
          signal?.addEventListener("abort", () => {
            finalAborted = true;
          });
        });
      },
      target: targetFixture(),
    }).catch((error: unknown) => error);
    await clock.runUntil(() => reads === 121);
    clock.advanceTo(clock.now + 1_000);
    await clock.flush();
    const failure = await pending;
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).message).toContain(
      "final telemetry read failed: Final runtime telemetry read exceeded one polling interval",
    );
    expect((failure as AggregateError).errors[0]).toBeInstanceOf(ProgressLivenessError);
    expect(finalAborted).toBe(true);
  });

  it("sanitizes a failed subsystem's final secondary cause without losing the timeout", async () => {
    const clock = new FakeReadyClock();
    const pendingHydration = runtimeHydrationFixture({
      ...hydrationSnapshot(),
      dependencyUploadCount: 0,
    });
    const failedRuntime = {
      ...pendingHydration,
      render: {
        ...pendingHydration.render,
        failureMessage: "C:\\secret\\render.log password=hidden",
        state: "failed",
      },
    } as ParallaxTelemetrySnapshot;
    let reads = 0;
    const pending = waitForScaleStreamingRuntimeReady({
      authority: authorityFixture(),
      platform: clock.platform,
      profile: "profile",
      readRuntime: async () => {
        reads += 1;
        return reads === 121 ? failedRuntime : pendingHydration;
      },
      target: targetFixture(),
    }).catch((error: unknown) => error);
    await clock.runUntil(() => reads === 121);
    const failure = await pending;
    expect(failure).toBeInstanceOf(AggregateError);
    const aggregate = failure as AggregateError;
    expect(aggregate.errors[0]).toBeInstanceOf(ProgressLivenessError);
    expect(aggregate.message).toContain("stall timeout");
    expect(aggregate.message).not.toMatch(/secret|hidden/u);
    expect((aggregate.errors[1] as Error).message).not.toMatch(/secret|hidden/u);
  });

  it("names every hydration predicate with bounded deterministic diagnostics", () => {
    const decodeCache = hydrationSnapshot().dependencyCache;
    const gpuCache = hydrationSnapshot().dependencyGpuCache;
    if (decodeCache === undefined || gpuCache === undefined) {
      throw new Error("Hydration cache fixtures are absent");
    }
    const cases = [
      hydrationCase("dependencyDecodeFailureCount", 0, 1, {
        dependencyDecodeFailureCount: 1,
      }),
      hydrationCase("dependencyDecodedBytes", ">0", 0, { dependencyDecodedBytes: 0 }),
      hydrationCase("dependencyEncodedBytesRead", ">0", 0, {
        dependencyEncodedBytesRead: 0,
      }),
      hydrationCase("dependencyReadCount", ">0", 0, { dependencyReadCount: 0 }),
      hydrationCase("dependencyUploadBytes", ">0", 0, { dependencyUploadBytes: 0 }),
      hydrationCase("dependencyUploadCount", ">0", 0, { dependencyUploadCount: 0 }),
      hydrationCase("decodeQueueDepthHighWater", ">=4", 3, {
        decodeQueueDepthHighWater: 3,
      }),
      hydrationCase("renderBatchCellCountHighWater", ">1", 1, {
        renderBatchCellCountHighWater: 1,
      }),
      hydrationCase("psoWarmupGameplayOverlapCount", 0, 1, {
        psoWarmupGameplayOverlapCount: 1,
      }),
      hydrationCase("dependencyCache.available", "present", "absent", {
        dependencyCache: undefined,
      }),
      hydrationCase("dependencyCache.acquireCount", 3, 2, {
        dependencyCache: { ...decodeCache, hitCount: 1 },
      }),
      hydrationCase("dependencyCache.missCount", ">0", 0, {
        dependencyCache: cache(0, 0, 0, 0),
      }),
      hydrationCase("dependencyCache.liveResourceCount", 2, 1, {
        dependencyCache: { ...decodeCache, liveResourceCount: 1 },
      }),
      hydrationCase("dependencyCache.liveRefCount", 2, 1, {
        dependencyCache: { ...decodeCache, liveRefCount: 1 },
      }),
      hydrationCase("dependencyCache.liveOwnedBytes", 50, 49, {
        dependencyCache: { ...decodeCache, liveEncodedBytes: 19 },
      }),
      hydrationCase("dependencyCache.formatCount", 2, 1, {
        dependencyCache: oneFormatCache(decodeCache),
      }),
      hydrationCase("dependencyGpuCache.available", "present", "absent", {
        dependencyGpuCache: undefined,
      }),
      hydrationCase("dependencyGpuCache.acquireCount", 3, 2, {
        dependencyGpuCache: { ...gpuCache, hitCount: 1 },
      }),
      hydrationCase("dependencyGpuCache.missCount", ">0", 0, {
        dependencyGpuCache: cache(0, 0, 0, 0),
      }),
      hydrationCase("dependencyGpuCache.liveResourceCount", 2, 1, {
        dependencyGpuCache: { ...gpuCache, liveResourceCount: 1 },
      }),
      hydrationCase("dependencyGpuCache.liveRefCount", 2, 1, {
        dependencyGpuCache: { ...gpuCache, liveRefCount: 1 },
      }),
      hydrationCase("dependencyGpuCache.liveOwnedBytes", 50, 49, {
        dependencyGpuCache: { ...gpuCache, liveEncodedBytes: 19 },
      }),
      hydrationCase("dependencyGpuCache.formatCount", 2, 1, {
        dependencyGpuCache: oneFormatCache(gpuCache),
      }),
    ] as const;
    expect(cases).toHaveLength(23);
    for (const testCase of cases) {
      const snapshot = testCase.mutate(hydrationSnapshot());
      expect(collectScaleStreamingHydrationMismatches(snapshot), testCase.field).toContainEqual({
        actual: testCase.actual,
        expected: testCase.expected,
        field: testCase.field,
      });
      let failure: unknown = null;
      try {
        requireScaleStreamingHydration(snapshot);
      } catch (error: unknown) {
        failure = error;
      }
      const retained = sanitizeScaleStreamingCause(failure);
      expect(retained, testCase.field).toContain(testCase.field);
      expect(retained, testCase.field).toContain(`expected=${JSON.stringify(testCase.expected)}`);
      expect(retained, testCase.field).toContain(`actual=${JSON.stringify(testCase.actual)}`);
    }
    expect(
      collectScaleStreamingHydrationMismatches({
        ...hydrationSnapshot(),
        dependencyCache: undefined,
        dependencyDecodedBytes: 0,
        psoWarmupGameplayOverlapCount: 1,
      } as unknown as WorldStreamingTelemetrySnapshot).map(({ field }) => field),
    ).toEqual([
      "dependencyDecodedBytes",
      "cellLoadSamples.decodedBytes",
      "psoWarmupGameplayOverlapCount",
      "dependencyCache.available",
    ]);
  });

  it("returns exact traversal reuse deltas for the valid fixture", () => {
    const start = traversalStartSnapshot();
    const end = traversalEvidence();
    expect(collectScaleStreamingTraversalMismatches(end, start)).toEqual([]);
    expect(requireScaleStreamingTraversal(end, start)).toEqual({
      decodeAcquireDelta: 4,
      decodeHitDelta: 2,
      decodeMissDelta: 2,
      decodeReleaseDelta: 4,
      gpuAcquireDelta: 4,
      gpuHitDelta: 2,
      gpuMissDelta: 2,
      gpuReleaseDelta: 4,
      psoWarmupGameplayOverlapCount: 0,
    });
  });

  it("persists the observed hydration overlap counter instead of a synthesized zero", () => {
    let reads = 0;
    const drifting = {
      ...hydrationSnapshot(),
      get psoWarmupGameplayOverlapCount() {
        reads += 1;
        return reads === 1 ? 0 : 1;
      },
    } as WorldStreamingTelemetrySnapshot;
    expect(() => requireScaleStreamingHydration(drifting)).toThrow(/changed after validation/u);
  });

  it("rejects contradictory hydration cache accounting with its existing diagnostics", () => {
    const hydration = hydrationSnapshot();
    expect(() =>
      requireScaleStreamingHydration({
        ...hydration,
        dependencyCache: { ...cache(2, 0, 2, 0), hitCount: 1 },
      }),
    ).toThrow(/dependencyCache\.acquireCount/u);
  });

  it.each(
    traversalMismatchCases(),
  )("reports the typed traversal mismatch for %s", (_name, testCase) => {
    const start = testCase.mutateStart(traversalStartSnapshot());
    const end = testCase.mutateEnd(traversalEvidence());
    expect(collectScaleStreamingTraversalMismatches(end, start)).toContainEqual({
      actual: testCase.actual,
      expected: testCase.expected,
      field: testCase.field,
    });
    let failure: unknown = null;
    try {
      requireScaleStreamingTraversal(end, start);
    } catch (error: unknown) {
      failure = error;
    }
    const retained = sanitizeScaleStreamingCause(failure);
    expect(retained).toContain(testCase.field);
    expect(retained).toContain(`expected=${JSON.stringify(testCase.expected)}`);
    expect(retained).toContain(`actual=${JSON.stringify(testCase.actual)}`);
  });

  it("retains combined traversal mismatches in deterministic predicate order", () => {
    const start = traversalStartSnapshot();
    const end = {
      ...traversalEvidence(),
      cellLoadP95Ms: 251,
      dependencyDecodeFailureCount: 1,
      dependencyDecodedBytes: 161,
      dependencyCache: { ...decodeCache(6, 2, 4, 4), releaseCount: 3 },
      psoWarmupGameplayOverlapCount: 1,
    } as StreamingEvidence;
    expect(collectScaleStreamingTraversalMismatches(end, start).map(({ field }) => field)).toEqual([
      "cellLoadP95Ms",
      "dependencyDecodeFailureCount",
      "psoWarmupGameplayOverlapCount",
      "dependencyCache.releaseConservation",
      "phase.decodedBytesDeltaVsSampleBytes",
    ]);
  });
});

type RuntimeAuthoritySection =
  | "installedModelSource"
  | "installerTransfer"
  | "installStore"
  | "offlineShell"
  | "streaming";

function runtimeCase(
  field: ScaleStreamingRuntimeAuthorityMismatchField,
  expected: boolean | number | string | null,
  actual: boolean | number | string | null,
  section: RuntimeAuthoritySection,
  patch: Readonly<Record<string, unknown>>,
) {
  return Object.freeze({
    actual,
    expected,
    field,
    mutate(snapshot: ParallaxTelemetrySnapshot): ParallaxTelemetrySnapshot {
      return {
        ...snapshot,
        [section]: Object.freeze({ ...snapshot[section], ...patch }),
      } as ParallaxTelemetrySnapshot;
    },
  });
}

function hydrationCase(
  field: ScaleStreamingHydrationMismatchField,
  expected: boolean | number | string | null,
  actual: boolean | number | string | null,
  patch: Readonly<Record<string, unknown>>,
) {
  return Object.freeze({
    actual,
    expected,
    field,
    mutate(snapshot: WorldStreamingTelemetrySnapshot): WorldStreamingTelemetrySnapshot {
      return { ...snapshot, ...patch } as WorldStreamingTelemetrySnapshot;
    },
  });
}

interface TraversalMismatchCase {
  readonly actual: boolean | number | string | null;
  readonly expected: boolean | number | string | null;
  readonly field: ScaleStreamingTraversalMismatchField;
  readonly mutateEnd: (snapshot: StreamingEvidence) => StreamingEvidence;
  readonly mutateStart: (
    snapshot: WorldStreamingTelemetrySnapshot,
  ) => WorldStreamingTelemetrySnapshot;
}

function traversalCase(
  field: ScaleStreamingTraversalMismatchField,
  expected: TraversalMismatchCase["expected"],
  actual: TraversalMismatchCase["actual"],
  mutateEnd: TraversalMismatchCase["mutateEnd"],
  mutateStart: TraversalMismatchCase["mutateStart"] = (snapshot) => snapshot,
): readonly [string, TraversalMismatchCase] {
  return Object.freeze([
    field,
    Object.freeze({ actual, expected, field, mutateEnd, mutateStart }),
  ] as const);
}

function traversalMismatchCases(): readonly (readonly [string, TraversalMismatchCase])[] {
  const cases: Array<readonly [string, TraversalMismatchCase]> = [
    traversalCase("cellLoadP95Ms", "<=250", 251, (snapshot) => ({
      ...snapshot,
      cellLoadP95Ms: 251,
    })),
    traversalCase("measurementProactiveEvictionCount", ">0", 0, (snapshot) => ({
      ...snapshot,
      measurementProactiveEvictionCount: 0,
    })),
    traversalCase("dependencyDecodeFailureCount", 0, 1, (snapshot) => ({
      ...snapshot,
      dependencyDecodeFailureCount: 1,
    })),
    ...(
      [
        "dependencyDecodedBytes",
        "dependencyEncodedBytesRead",
        "dependencyReadCount",
        "dependencyUploadBytes",
        "dependencyUploadCount",
      ] as const
    ).map((field) => traversalCase(field, ">0", 0, (snapshot) => ({ ...snapshot, [field]: 0 }))),
    traversalCase("measurementCellLoadSamples.attribution", true, false, (snapshot) => ({
      ...snapshot,
      measurementCellLoadSamples: snapshot.measurementCellLoadSamples.map((sample, index) =>
        index === 0 ? { ...sample, dependencyCount: 0 } : sample,
      ),
    })),
    traversalCase("psoWarmupGameplayOverlapCount", 0, 1, (snapshot) => ({
      ...snapshot,
      psoWarmupGameplayOverlapCount: 1,
    })),
    ...traversalCacheMismatchCases("dependencyCache"),
    ...traversalCacheMismatchCases("dependencyGpuCache"),
    traversalCase("phase.decodeAcquireVsSampleDependencyCount", 4, 5, (snapshot) => ({
      ...snapshot,
      dependencyCache: decodeCache(7, 3, 4, 5),
    })),
    traversalCase("phase.gpuAcquireVsSampleDependencyCount", 4, 5, (snapshot) => ({
      ...snapshot,
      dependencyGpuCache: cache(7, 3, 4, 5),
    })),
    traversalCase("phase.readCountDeltaVsDecodeMissDelta", 2, 3, (snapshot) => ({
      ...snapshot,
      dependencyReadCount: 5,
    })),
    traversalCase("phase.encodedBytesDeltaVsSampleBytes", 40, 41, (snapshot) => ({
      ...snapshot,
      dependencyEncodedBytesRead: 81,
    })),
    traversalCase("phase.decodedBytesDeltaVsSampleBytes", 80, 81, (snapshot) => ({
      ...snapshot,
      dependencyDecodedBytes: 161,
    })),
    traversalCase("phase.uploadCountDeltaVsGpuMissDelta", 2, 3, (snapshot) => ({
      ...snapshot,
      dependencyUploadCount: 5,
    })),
    traversalCase("phase.uploadBytesDeltaVsSampleBytes", 80, 81, (snapshot) => ({
      ...snapshot,
      dependencyUploadBytes: 161,
    })),
  ];
  return Object.freeze(cases);
}

function traversalCacheMismatchCases(
  prefix: "dependencyCache" | "dependencyGpuCache",
): readonly (readonly [string, TraversalMismatchCase])[] {
  const decode = prefix === "dependencyCache";
  const mutateEndCache =
    (
      mutate: (
        value: NonNullable<WorldStreamingTelemetrySnapshot[typeof prefix]>,
      ) => WorldStreamingTelemetrySnapshot[typeof prefix],
    ): TraversalMismatchCase["mutateEnd"] =>
    (snapshot) => ({
      ...snapshot,
      [prefix]: mutate(
        snapshot[prefix] as NonNullable<WorldStreamingTelemetrySnapshot[typeof prefix]>,
      ),
    });
  const mutateStartCache =
    (
      mutate: (
        value: NonNullable<WorldStreamingTelemetrySnapshot[typeof prefix]>,
      ) => WorldStreamingTelemetrySnapshot[typeof prefix],
    ): TraversalMismatchCase["mutateStart"] =>
    (snapshot) => ({
      ...snapshot,
      [prefix]: mutate(
        snapshot[prefix] as NonNullable<WorldStreamingTelemetrySnapshot[typeof prefix]>,
      ),
    });
  const patchEnd = (patch: Readonly<Record<string, unknown>>): TraversalMismatchCase["mutateEnd"] =>
    mutateEndCache((value) => ({ ...value, ...patch }));
  const resourcePatch = (
    patch: Readonly<Record<string, unknown>>,
  ): TraversalMismatchCase["mutateEnd"] =>
    mutateEndCache((value) => ({
      ...value,
      resources: value.resources.map((resource, index) =>
        index === 0 ? { ...resource, ...patch } : resource,
      ),
    }));
  return Object.freeze([
    traversalCase(`${prefix}.available`, "start-and-end", "end-absent", () => ({
      ...traversalEvidence(),
      [prefix]: undefined,
    })),
    traversalCase(`${prefix}.resources`, "array", "<invalid>", patchEnd({ resources: null })),
    traversalCase(`${prefix}.endAcquireConservation`, 6, 7, patchEnd({ acquireCount: 7 })),
    traversalCase(`${prefix}.acquireMonotonic`, ">=2", 1, patchEnd({ acquireCount: 1 })),
    traversalCase(`${prefix}.hitMonotonic`, ">=0", "<invalid>", patchEnd({ hitCount: -1 })),
    traversalCase(`${prefix}.missMonotonic`, ">=2", 1, patchEnd({ missCount: 1 })),
    traversalCase(`${prefix}.releaseMonotonic`, ">=0", "<invalid>", patchEnd({ releaseCount: -1 })),
    traversalCase(`${prefix}.acquireDelta`, ">0", 0, patchEnd({ acquireCount: 2 })),
    traversalCase(
      `${prefix}.deltaConservation`,
      4,
      3,
      (snapshot) => snapshot,
      mutateStartCache((value) => ({ ...value, acquireCount: 3 })),
    ),
    traversalCase(`${prefix}.hitDelta`, ">0", 0, patchEnd({ acquireCount: 4, hitCount: 0 })),
    traversalCase(`${prefix}.releaseDelta`, ">0", 0, patchEnd({ releaseCount: 0 })),
    traversalCase(`${prefix}.releaseConservation`, 4, 3, patchEnd({ releaseCount: 3 })),
    traversalCase(`${prefix}.liveResourceCount`, 2, 1, patchEnd({ liveResourceCount: 1 })),
    traversalCase(`${prefix}.liveRefCount`, 2, 1, patchEnd({ liveRefCount: 1 })),
    ...(decode
      ? [
          traversalCase(`${prefix}.liveEncodedBytes`, 0, 1, patchEnd({ liveEncodedBytes: 1 })),
          traversalCase(`${prefix}.liveDecodedBytes`, 0, 1, patchEnd({ liveDecodedBytes: 1 })),
          traversalCase(`${prefix}.liveOwnedBytes`, 0, 19, patchEnd({ liveEncodedBytes: 19 })),
        ]
      : [traversalCase(`${prefix}.liveOwnedBytes`, 50, 49, patchEnd({ liveEncodedBytes: 19 }))]),
    traversalCase(
      `${prefix}.resourceCacheKey`,
      "non-empty",
      "<empty>",
      resourcePatch({
        cacheKey: "",
      }),
    ),
    traversalCase(
      `${prefix}.resourceId`,
      "non-empty",
      "<empty>",
      resourcePatch({
        resourceId: "",
      }),
    ),
    ...(decode
      ? [traversalCase(`${prefix}.resourceOwnedBytes`, 0, 1, resourcePatch({ ownedBytes: 1 }))]
      : [
          traversalCase(
            `${prefix}.resourceOwnedBytes`,
            ">0 integer",
            0,
            resourcePatch({ ownedBytes: 0 }),
          ),
          traversalCase(
            `${prefix}.resourceOwnedBytes`,
            ">0 integer",
            -1,
            resourcePatch({ ownedBytes: -1 }),
          ),
        ]),
    traversalCase(
      `${prefix}.resourceRefCount`,
      ">0 integer",
      false,
      resourcePatch({
        refCount: 0,
      }),
    ),
    traversalCase(
      `${prefix}.cacheKeyCount`,
      2,
      1,
      mutateEndCache((value) => ({
        ...value,
        resources: value.resources.map((resource) => ({ ...resource, cacheKey: "duplicate" })),
      })),
    ),
    traversalCase(
      `${prefix}.formatCount`,
      2,
      1,
      mutateEndCache((value) => oneFormatCache(value)),
    ),
  ]);
}

function oneFormatCache(
  value: NonNullable<WorldStreamingTelemetrySnapshot["dependencyCache"]>,
): NonNullable<WorldStreamingTelemetrySnapshot["dependencyCache"]> {
  return {
    ...value,
    resources: value.resources.map((resource) => ({ ...resource, format: "meshopt" as const })),
  };
}

function installResource(
  id: string,
  bytes: number,
  kind: InstallResource["kind"],
  target: InstallResource["target"],
): InstallResource {
  return {
    bytes,
    id,
    kind,
    scope: target === "shell" ? "app-shell" : "game-specific",
    sha256: "a".repeat(64),
    source: `immutable/${id}`,
    target,
  };
}

async function temporary(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(path);
  return path;
}

function targetFixture(): MaterializedScaleStreamingTarget {
  return {
    artifactDigest: "a".repeat(64),
    population: {
      installBytes: 100,
      installResourceCount: 4,
      representativeBytes: 60,
      representativeResourceCount: 3,
    },
    releaseDigest: "b".repeat(64),
  } as MaterializedScaleStreamingTarget;
}

function authorityFixture() {
  return {
    durabilityClaimed: true,
    launchEnabled: true,
    persistence: "granted",
    persistenceWarning: null,
    releaseDigest: "b".repeat(64),
    shellGenerationId: `${"a".repeat(64)}:${"b".repeat(64)}`,
    state: "ready",
  } as const;
}

function livenessFixture(): ProgressLivenessSnapshot {
  return {
    lastProgressTuple: {
      checkpointedBytes: 100,
      completedResourceCount: 4,
      downloadedBytes: 100,
      finalVerificationBytes: 100,
      finalVerificationPhase: "complete",
      finalVerificationResourceCount: 4,
      finalVerificationTotalBytes: 100,
      finalVerificationTotalResourceCount: 4,
      verifiedBytes: 100,
    },
  } as ProgressLivenessSnapshot;
}

function mutateLiveness(
  progress: Partial<ProgressLivenessSnapshot["lastProgressTuple"]>,
): ProgressLivenessSnapshot {
  const liveness = livenessFixture();
  return {
    ...liveness,
    lastProgressTuple: { ...liveness.lastProgressTuple, ...progress },
  };
}

function runtimeFixture(): ParallaxTelemetrySnapshot {
  const target = targetFixture();
  const authority = authorityFixture();
  return {
    installStore: {
      activeReleaseDigest: target.releaseDigest,
      currentReleaseDigest: null,
      currentResourceId: null,
      failureMessage: null,
      finalVerificationBytes: 100,
      finalVerificationPhase: "complete",
      finalVerificationResourceCount: 4,
      finalVerificationTotalBytes: 100,
      finalVerificationTotalResourceCount: 4,
      garbageCollectionRemaining: false,
      partialBytes: 0,
      partialResourceCount: 0,
      state: "ready",
    },
    installedModelSource: {
      releaseDigest: target.releaseDigest,
      resolvedArtifactBytes: 2_620_371_552,
      resolvedArtifactCount: 5,
      state: "ready",
    },
    installerTransfer: {
      activeReleaseDigest: target.releaseDigest,
      failureMessage: null,
      finalVerificationBytes: 100,
      finalVerificationPhase: "complete",
      finalVerificationResourceCount: 4,
      finalVerificationTotalBytes: 100,
      finalVerificationTotalResourceCount: 4,
      resourceCount: 4,
      state: "ready",
      totalBytes: 100,
    },
    offlineShell: {
      activeArtifactDigest: target.artifactDigest,
      activeGenerationId: authority.shellGenerationId,
      activeReleaseDigest: target.releaseDigest,
      failureCode: null,
      failureMessage: null,
      mixedGenerationCount: 0,
      state: "active",
    },
    streaming: {
      installedReleaseDigest: target.releaseDigest,
      installedResourceBytes: 60,
      installedResourceCount: 3,
      legacyNetworkRequestCount: 0,
    },
  } as ParallaxTelemetrySnapshot;
}

function runtimeHydrationFixture(
  hydration: WorldStreamingTelemetrySnapshot = hydrationSnapshot(),
): ParallaxTelemetrySnapshot {
  const runtime = runtimeFixture();
  return {
    ...runtime,
    render: { failureMessage: null, state: "ready" },
    streaming: {
      ...hydration,
      ...runtime.streaming,
      encodedBytesRead: hydration.dependencyEncodedBytesRead ?? 0,
      failureMessage: null,
      state: "streaming",
    },
  } as ParallaxTelemetrySnapshot;
}

async function runtimeTimeoutOutcome(finalSnapshot: ParallaxTelemetrySnapshot): Promise<unknown> {
  const clock = new FakeReadyClock();
  const pendingHydration = runtimeHydrationFixture({
    ...hydrationSnapshot(),
    dependencyUploadCount: 0,
  });
  let reads = 0;
  const pending = waitForScaleStreamingRuntimeReady({
    authority: authorityFixture(),
    platform: clock.platform,
    profile: "profile",
    readRuntime: async () => {
      reads += 1;
      return reads === 121 ? finalSnapshot : pendingHydration;
    },
    target: targetFixture(),
  }).catch((error: unknown) => error);
  await clock.runUntil(() => reads === 121);
  return pending;
}

class FakeReadyClock {
  public now = 0;
  readonly #timers = new Map<
    number,
    Readonly<{ atMs: number; callback: () => void; ordinal: number }>
  >();
  #nextHandle = 0;

  public readonly platform = Object.freeze({
    clearTimeout: (handle: unknown): void => {
      this.#timers.delete(handle as number);
    },
    now: (): number => this.now,
    setTimeout: (callback: () => void, milliseconds: number): number => {
      const handle = ++this.#nextHandle;
      this.#timers.set(handle, {
        atMs: this.now + milliseconds,
        callback,
        ordinal: handle,
      });
      return handle;
    },
  });

  public advanceTo(atMs: number): void {
    if (atMs < this.now) throw new Error("Fake clock cannot regress");
    this.now = atMs;
    const due = [...this.#timers.entries()]
      .filter(([, timer]) => timer.atMs <= atMs)
      .sort((left, right) => left[1].atMs - right[1].atMs || left[1].ordinal - right[1].ordinal);
    for (const [handle, timer] of due) {
      if (!this.#timers.delete(handle)) continue;
      timer.callback();
    }
  }

  public async flush(): Promise<void> {
    for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
  }

  public async runUntil(predicate: () => boolean): Promise<void> {
    for (let step = 0; step < 200 && !predicate(); step += 1) {
      await this.flush();
      const next = [...this.#timers.values()].sort(
        (left, right) => left.atMs - right.atMs || left.ordinal - right.ordinal,
      )[0];
      if (next !== undefined) this.advanceTo(next.atMs);
    }
    await this.flush();
    if (!predicate()) throw new Error("Fake clock predicate did not settle");
  }
}

function cache(acquireCount: number, hitCount: number, missCount: number, releaseCount: number) {
  return {
    acquireCount,
    hitCount,
    liveDecodedBytes: 30,
    liveEncodedBytes: 20,
    liveRefCount: 2,
    liveResourceCount: 2,
    missCount,
    releaseCount,
    resources: [
      { cacheKey: "mesh", format: "meshopt", ownedBytes: 25, refCount: 1, resourceId: "mesh" },
      { cacheKey: "texture", format: "ktx2", ownedBytes: 25, refCount: 1, resourceId: "texture" },
    ],
  } as const;
}

function decodeCache(
  acquireCount: number,
  hitCount: number,
  missCount: number,
  releaseCount: number,
) {
  const value = cache(acquireCount, hitCount, missCount, releaseCount);
  return {
    ...value,
    liveDecodedBytes: 0,
    liveEncodedBytes: 0,
    resources: value.resources.map((resource) => ({ ...resource, ownedBytes: 0 })),
  } as const;
}

function traversalStartSnapshot(): WorldStreamingTelemetrySnapshot {
  return { ...hydrationSnapshot(), dependencyCache: decodeCache(2, 0, 2, 0) };
}

function hydrationSnapshot(): WorldStreamingTelemetrySnapshot {
  return {
    cellLoadSamples: [
      {
        dependencyCount: 2,
        dependencyDecodeMs: 1,
        dependencyDecodedBytes: 80,
        dependencyEncodedBytes: 40,
        dependencyReadMs: 1,
        dependencyUploadBytes: 80,
        dependencyUploadMs: 1,
      },
    ],
    cellLoadSampleCount: 1,
    decodeQueueDepthHighWater: 4,
    decodeWorkerCount: 4,
    dependencyCache: cache(2, 0, 2, 0),
    dependencyDecodeFailureCount: 0,
    dependencyDecodedBytes: 80,
    dependencyEncodedBytesRead: 40,
    dependencyGpuCache: cache(2, 0, 2, 0),
    dependencyReadCount: 2,
    dependencyUploadBytes: 80,
    dependencyUploadCount: 2,
    psoWarmupGameplayOverlapCount: 0,
    renderBatchCellCountHighWater: 2,
  } as unknown as WorldStreamingTelemetrySnapshot;
}

function splitHydrationSnapshot(): WorldStreamingTelemetrySnapshot {
  const snapshot = hydrationSnapshot();
  const sample = snapshot.cellLoadSamples[0];
  if (sample === undefined) throw new Error("Hydration fixture sample is absent");
  return {
    ...snapshot,
    cellLoadSampleCount: 2,
    cellLoadSamples: [
      {
        ...sample,
        dependencyDecodeMs: 0,
        dependencyDecodedBytes: 0,
        dependencyEncodedBytes: 40,
        dependencyReadMs: 1,
        dependencyUploadBytes: 0,
        dependencyUploadMs: 0,
      },
      {
        ...sample,
        dependencyDecodeMs: 1,
        dependencyDecodedBytes: 80,
        dependencyEncodedBytes: 0,
        dependencyReadMs: 0,
        dependencyUploadBytes: 80,
        dependencyUploadMs: 1,
      },
    ],
  } as WorldStreamingTelemetrySnapshot;
}

function traversalEvidence(): StreamingEvidence {
  const samples = [
    {
      dependencyCount: 2,
      dependencyDecodeMs: 1,
      dependencyDecodedBytes: 40,
      dependencyEncodedBytes: 20,
      dependencyReadMs: 1,
      dependencyUploadBytes: 40,
      dependencyUploadMs: 1,
    },
    {
      dependencyCount: 2,
      dependencyDecodeMs: 1,
      dependencyDecodedBytes: 40,
      dependencyEncodedBytes: 20,
      dependencyReadMs: 1,
      dependencyUploadBytes: 40,
      dependencyUploadMs: 1,
    },
  ];
  return {
    cellLoadP95Ms: 10,
    dependencyCache: decodeCache(6, 2, 4, 4),
    dependencyDecodeFailureCount: 0,
    dependencyDecodedBytes: 160,
    dependencyEncodedBytesRead: 80,
    dependencyGpuCache: cache(6, 2, 4, 4),
    dependencyReadCount: 4,
    dependencyUploadBytes: 160,
    dependencyUploadCount: 4,
    measurementCellLoadSamples: samples,
    measurementProactiveEvictionCount: 1,
    psoWarmupGameplayOverlapCount: 0,
  } as unknown as StreamingEvidence;
}
