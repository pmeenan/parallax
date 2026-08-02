import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { STREAMING_CELL_LOAD_BUDGET_MS, streamingResourceCacheKey } from "@parallax/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reserveResultPair } from "./result-pair.js";
import {
  createScaleStreamingManifestModel,
  type GeneratedScaleStreamingCorpus,
  parseGeneratedScaleStreamingCorpus,
} from "./scale-streaming-corpus.js";
import {
  createScaleStreamingPersistedEvidence,
  type ScaleStreamingEvidenceAuthority,
  type ScaleStreamingTerminalReport,
  sanitizeScaleStreamingCause,
  validateScaleStreamingOwnedReport,
  validateScaleStreamingPendingReport,
  validateScaleStreamingTerminalReport,
} from "./scale-streaming-evidence.js";
import type {
  MaterializedScaleStreamingTarget,
  ScaleStreamingRunnerCoreResult,
} from "./scale-streaming-runner-core.js";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(import.meta.dirname, "../..");
let corpusRoot = "";
let corpus: GeneratedScaleStreamingCorpus;

beforeAll(async () => {
  corpusRoot = await mkdtemp(join(tmpdir(), "parallax-scale-evidence-corpus-"));
  await execFile(
    process.execPath,
    [
      join(repositoryRoot, "harness/scripts/generate-scale-streaming-corpus.mjs"),
      "--output",
      corpusRoot,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  corpus = parseGeneratedScaleStreamingCorpus(
    JSON.parse(await readFile(join(corpusRoot, "scale-streaming-corpus.json"), "utf8")) as unknown,
  );
});

afterAll(async () => rm(corpusRoot, { force: true, recursive: true }));

describe("scale-streaming exact evidence contract", () => {
  it("persists hydration from the captured initial snapshot and traversal from its measurement window", () => {
    const evidence = fixture().report.evidence;
    if (evidence === null) throw new Error("Scale-streaming evidence fixture is absent");
    expect(
      evidence.hydration.samples.map(({ dependencyEncodedBytes }) => dependencyEncodedBytes),
    ).toEqual([40, 0]);
    expect(
      evidence.traversal.samples.map(({ dependencyEncodedBytes }) => dependencyEncodedBytes),
    ).toEqual([40, ...Array.from({ length: 9 }, () => 0)]);
  });

  it("accepts a physical-shaped split pipeline with transferred decode and resident GPU ownership", () => {
    const { authority, report } = fixture();
    const evidence = report.evidence;
    if (
      evidence === null ||
      evidence.traversal.decodeCache === null ||
      evidence.traversal.gpuCache === null
    ) {
      throw new Error("Physical scale-streaming fixture is incomplete");
    }
    expect(evidence.hydration.samples).toEqual([
      expect.objectContaining({
        dependencyDecodedBytes: 0,
        dependencyEncodedBytes: 40,
        dependencyUploadBytes: 0,
      }),
      expect.objectContaining({
        dependencyDecodedBytes: 80,
        dependencyEncodedBytes: 0,
        dependencyUploadBytes: 80,
      }),
    ]);
    expect(evidence.traversal.samples.at(-1)).toEqual(
      expect.objectContaining({
        dependencyCount: 1,
        dependencyDecodedBytes: 0,
        dependencyEncodedBytes: 0,
        dependencyUploadBytes: 0,
      }),
    );
    const decodeResources = evidence.traversal.decodeCache.resources as readonly Readonly<
      Record<string, unknown>
    >[];
    expect(decodeResources).toEqual([
      expect.objectContaining({ ownedBytes: 0 }),
      expect.objectContaining({ ownedBytes: 0 }),
    ]);
    expect(decodeResources.find(({ format }) => format === "meshopt")?.cacheKey).toHaveLength(542);
    expect(evidence.traversal.gpuCache.resources).toEqual([
      expect.objectContaining({ ownedBytes: 25 }),
      expect.objectContaining({ ownedBytes: 25 }),
    ]);
    expect(validateScaleStreamingTerminalReport(report, authority)).toBe(report);
    const zeroContribution = {
      dependencyCount: 0,
      dependencyDecodeMs: 0,
      dependencyDecodedBytes: 0,
      dependencyEncodedBytes: 0,
      dependencyReadMs: 0,
      dependencyUploadBytes: 0,
      dependencyUploadMs: 0,
    };
    const withNonDependencyHydration = {
      ...report,
      evidence: {
        ...evidence,
        hydration: {
          ...evidence.hydration,
          samples: [...evidence.hydration.samples, zeroContribution],
        },
      },
    };
    expect(validateScaleStreamingTerminalReport(withNonDependencyHydration, authority)).toBe(
      withNonDependencyHydration,
    );
  });

  it("rejects invalid hydration topology independently of passing traversal high-waters", () => {
    const { authority, report } = fixture();
    const evidence = report.evidence;
    if (evidence === null) throw new Error("Physical scale-streaming fixture is incomplete");
    expect(evidence.hydration.pipeline.decodeQueueDepthHighWater).toBe(4);
    expect(evidence.hydration.pipeline.renderBatchCellCountHighWater).toBe(2);
    expect(evidence.traversal.decodeQueueHighWater).toBe(6);
    expect(evidence.traversal.batchHighWater).toBe(3);
    for (const pipeline of [
      {
        ...evidence.hydration.pipeline,
        decodeQueueDepthHighWater: 1,
        decodeWorkerCount: 4,
      },
      {
        ...evidence.hydration.pipeline,
        renderBatchCellCountHighWater: 1,
      },
    ]) {
      expect(() =>
        validateScaleStreamingTerminalReport(
          {
            ...report,
            evidence: {
              ...evidence,
              hydration: { ...evidence.hydration, pipeline },
            },
          },
          authority,
        ),
      ).toThrow(/runtime evidence is contradictory or incomplete/u);
    }
  });

  it("rejects every aggregate or cache-ownership weakening around the physical fixture", () => {
    const { authority, report } = fixture();
    const evidence = report.evidence;
    if (
      evidence === null ||
      evidence.traversal.decodeCache === null ||
      evidence.traversal.gpuCache === null
    ) {
      throw new Error("Physical scale-streaming fixture is incomplete");
    }
    const decodeCache = evidence.traversal.decodeCache;
    const gpuCache = evidence.traversal.gpuCache;
    const [hydrationFirst, ...hydrationRest] = evidence.hydration.samples;
    const [traversalFirst, ...traversalRest] = evidence.traversal.samples;
    const [decodeFirst, ...decodeRest] = decodeCache.resources as readonly Readonly<
      Record<string, unknown>
    >[];
    const [gpuFirst, ...gpuRest] = gpuCache.resources as readonly Readonly<
      Record<string, unknown>
    >[];
    if (
      hydrationFirst === undefined ||
      traversalFirst === undefined ||
      decodeFirst === undefined ||
      gpuFirst === undefined
    ) {
      throw new Error("Physical scale-streaming fixture resources are incomplete");
    }
    const zeroContribution = {
      dependencyCount: 0,
      dependencyDecodeMs: 0,
      dependencyDecodedBytes: 0,
      dependencyEncodedBytes: 0,
      dependencyReadMs: 0,
      dependencyUploadBytes: 0,
      dependencyUploadMs: 0,
    };
    const mutations = [
      {
        ...evidence,
        traversal: {
          ...evidence.traversal,
          decodeCache: {
            ...decodeCache,
            resources: [
              { ...decodeFirst, cacheKey: `${String(decodeFirst.cacheKey)}-mutated` },
              ...decodeRest,
            ],
          },
        },
      },
      {
        ...evidence,
        hydration: {
          ...evidence.hydration,
          samples: [{ ...hydrationFirst, dependencyEncodedBytes: 39 }, ...hydrationRest],
        },
      },
      {
        ...evidence,
        traversal: {
          ...evidence.traversal,
          samples: [{ ...traversalFirst, dependencyDecodedBytes: 79 }, ...traversalRest],
        },
      },
      {
        ...evidence,
        hydration: {
          ...evidence.hydration,
          samples: [
            ...evidence.hydration.samples,
            ...Array.from({ length: 255 }, () => zeroContribution),
          ],
        },
      },
      {
        ...evidence,
        traversal: {
          ...evidence.traversal,
          measurementEvictionCount: Number.NaN,
        },
      },
      {
        ...evidence,
        traversal: {
          ...evidence.traversal,
          decodeCache: {
            ...decodeCache,
            hitCount: 10,
            missCount: 3,
          },
        },
      },
      {
        ...evidence,
        traversal: {
          ...evidence.traversal,
          gpuCache: {
            ...gpuCache,
            resources: [...gpuRest, gpuFirst],
          },
        },
      },
      {
        ...evidence,
        traversal: {
          ...evidence.traversal,
          gpuCache: {
            ...gpuCache,
            resources: [{ ...gpuFirst, resourceId: "gpu-only" }, ...gpuRest],
          },
        },
      },
      {
        ...evidence,
        traversal: {
          ...evidence.traversal,
          decodeCache: {
            ...decodeCache,
            liveDecodedBytes: 1,
            resources: [{ ...decodeFirst, ownedBytes: 1 }, ...decodeRest],
          },
        },
      },
      {
        ...evidence,
        traversal: {
          ...evidence.traversal,
          gpuCache: {
            ...gpuCache,
            liveDecodedBytes: 25,
            resources: [{ ...gpuFirst, ownedBytes: 0 }, ...gpuRest],
          },
        },
      },
      {
        ...evidence,
        traversal: {
          ...evidence.traversal,
          samples: [{ ...traversalFirst, dependencyCount: 0 }, ...traversalRest],
        },
      },
    ];
    for (const mutation of mutations) {
      expect(() =>
        validateScaleStreamingTerminalReport({ ...report, evidence: mutation }, authority),
      ).toThrow();
    }
  });

  it("accepts exact evidence and rejects identity, population, cache, and p95 mutations", () => {
    const { authority, report } = fixture();
    const exactBuild = report.build;
    const exactTarget = report.target;
    const exactEvidence = report.evidence;
    if (
      exactBuild === null ||
      exactTarget === null ||
      exactEvidence === null ||
      exactEvidence.traversal.decodeCache === null
    ) {
      throw new Error("Exact scale-streaming fixture is incomplete");
    }
    const exactCache = exactEvidence.traversal.decodeCache;
    expect(validateScaleStreamingTerminalReport(report, authority)).toBe(report);
    for (const mutate of [
      () => ({ ...report, build: { ...exactBuild, artifactDigest: "f".repeat(64) } }),
      () => ({
        ...report,
        target: {
          ...exactTarget,
          population: { ...exactTarget.population, installBytes: 101 },
        },
      }),
      () => ({
        ...report,
        evidence: {
          ...exactEvidence,
          traversal: {
            ...exactEvidence.traversal,
            p95Ms: STREAMING_CELL_LOAD_BUDGET_MS + 1,
          },
        },
      }),
      () => ({
        ...report,
        evidence: {
          ...exactEvidence,
          traversal: {
            ...exactEvidence.traversal,
            decodeCache: { ...exactCache, liveRefCount: 3 },
          },
        },
      }),
      () => ({
        ...report,
        evidence: {
          ...exactEvidence,
          authority: { ...exactEvidence.authority, persistence: "unknown" },
        },
      }),
      () => ({
        ...report,
        evidence: {
          ...exactEvidence,
          authority: {
            ...exactEvidence.authority,
            durabilityClaimed: false,
            persistence: "denied",
            persistenceWarning: null,
          },
        },
      }),
      () => ({
        ...report,
        evidence: {
          ...exactEvidence,
          installLiveness: { ...exactEvidence.installLiveness, pollIntervalMs: 999 },
        },
      }),
      () => ({
        ...report,
        evidence: {
          ...exactEvidence,
          installLiveness: {
            ...exactEvidence.installLiveness,
            lastProgressTuple: {
              ...exactEvidence.installLiveness.lastProgressTuple,
              downloadedBytes: 99,
            },
          },
        },
      }),
      () => ({
        ...report,
        evidence: {
          ...exactEvidence,
          runtime: { ...exactEvidence.runtime, installedModelCount: -1 },
        },
      }),
      () => ({
        ...report,
        evidence: {
          ...exactEvidence,
          runtime: {
            ...exactEvidence.runtime,
            installedStreamingBytes: exactTarget.population.installBytes,
            installedStreamingCount: exactTarget.population.installResourceCount,
          },
        },
      }),
      () => ({
        ...report,
        evidence: {
          ...exactEvidence,
          traversal: { ...exactEvidence.traversal, p95Ms: Number.NaN },
        },
      }),
      () => ({
        ...report,
        evidence: {
          ...exactEvidence,
          traversal: { ...exactEvidence.traversal, decodeQueueHighWater: -1 },
        },
      }),
      () => ({
        ...report,
        evidence: {
          ...exactEvidence,
          traversal: {
            ...exactEvidence.traversal,
            decodeCache: {
              ...exactCache,
              resources: [
                {
                  cacheKey: "a",
                  format: "invalid",
                  ownedBytes: 25,
                  refCount: 2,
                  resourceId: "a",
                },
              ],
            },
          },
        },
      }),
      () => ({
        ...report,
        evidence: {
          ...exactEvidence,
          traversal: {
            ...exactEvidence.traversal,
            reuse: { ...exactEvidence.traversal.reuse, decodeHitDelta: 0 },
          },
        },
      }),
      () => ({
        ...report,
        evidence: {
          ...exactEvidence,
          traversal: {
            ...exactEvidence.traversal,
            decodeCache: {
              ...exactCache,
              resources: [
                {
                  cacheKey: "../unsafe",
                  format: "meshopt",
                  ownedBytes: 25,
                  refCount: 1,
                  resourceId: "a",
                },
                {
                  cacheKey: "b",
                  format: "ktx2",
                  ownedBytes: 25,
                  refCount: 1,
                  resourceId: "b",
                },
              ],
            },
          },
        },
      }),
    ]) {
      expect(() => validateScaleStreamingTerminalReport(mutate(), authority)).toThrow();
    }
  });

  it("validates pending and phase-consistent failed evidence exactly", () => {
    const pending = {
      contract: "scale-streaming@1",
      inputs: { machineId: "dev-01", tier: "showcase" },
      phase: "reservation",
      schemaVersion: 1,
      startedAt: "2026-08-01T00:00:00.000Z",
      state: "pending",
    } as const;
    expect(validateScaleStreamingPendingReport(pending)).toBe(pending);
    expect(() => validateScaleStreamingPendingReport({ ...pending, extra: true })).toThrow();

    const { report } = fixture();
    const failed = {
      ...report,
      browser: null,
      build: null,
      corpus: null,
      environment: null,
      evidence: null,
      failure: { message: "validation failed", phase: "validation" },
      postvalidation: null,
      progress: {
        cleanup: true,
        environment: false,
        materialization: false,
        postvalidation: false,
        runtime: false,
        validation: false,
      },
      source: null,
      state: "failed",
      target: null,
    } as const;
    const nullAuthority: ScaleStreamingEvidenceAuthority = {
      artifactDigest: null,
      browser: null,
      corpus: null,
      environment: null,
      releaseDigest: null,
      source: null,
      target: null,
    };
    expect(validateScaleStreamingTerminalReport(failed, nullAuthority)).toBe(failed);
    expect(() =>
      validateScaleStreamingTerminalReport(
        { ...failed, failure: { message: "validation failed", phase: "runtime" } },
        nullAuthority,
      ),
    ).toThrow();
    expect(() =>
      validateScaleStreamingTerminalReport({ ...failed, target: report.target }, nullAuthority),
    ).toThrow();
  });

  it("publishes, rereads, and validates owned passed, failed, and finalization-failed JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-scale-owned-"));
    try {
      for (const state of ["passed", "failed"] as const) {
        const { authority, report } = fixture();
        const reservation = await reserveResultPair(
          root,
          state === "passed" ? "2026-08-01T01:00:00.000Z" : "2026-08-01T01:01:00.000Z",
          validateScaleStreamingPendingReport({
            contract: "scale-streaming@1",
            inputs: { machineId: "dev-01", tier: "showcase" },
            phase: "reservation",
            schemaVersion: 1,
            startedAt: report.startedAt,
            state: "pending",
          }),
          {},
          "scale-streaming",
          "Representative scale streaming qualification",
        );
        const terminal =
          state === "passed"
            ? {
                ...report,
                companion: { path: reservation.markdownPath, state: "requested" as const },
              }
            : {
                ...report,
                cleanup: report.cleanup.map((item, index) =>
                  index === report.cleanup.length - 1
                    ? {
                        message: "cleanup failed",
                        operation: item.operation,
                        state: "failed" as const,
                      }
                    : item,
                ),
                companion: { path: reservation.markdownPath, state: "requested" as const },
                failure: { message: "cleanup failed", phase: "cleanup" as const },
                state: "failed" as const,
              };
        await reservation.publishPair(terminal, `# Result\n\n- State: \`${state}\`\n`, state);
        await reservation.close();
        const persisted = JSON.parse(await readFile(reservation.jsonPath, "utf8")) as unknown;
        expect(
          validateScaleStreamingOwnedReport(persisted, authority, reservation.markdownPath).report
            .state,
        ).toBe(state);
      }

      const { authority, report } = fixture();
      const reservation = await reserveResultPair(
        root,
        "2026-08-01T01:02:00.000Z",
        validateScaleStreamingPendingReport({
          contract: "scale-streaming@1",
          inputs: { machineId: "dev-01", tier: "showcase" },
          phase: "reservation",
          schemaVersion: 1,
          startedAt: report.startedAt,
          state: "pending",
        }),
        {
          beforeOwnedWrite: (path, state) =>
            path.endsWith(".md") && state === "passed"
              ? Promise.reject(new Error("injected Markdown failure"))
              : Promise.resolve(),
        },
        "scale-streaming",
        "Representative scale streaming qualification",
      );
      await expect(reservation.publishPair(report, "# Result\n", "passed")).rejects.toMatchObject({
        phase: "markdown",
      });
      await reservation.close();
      const persisted = JSON.parse(await readFile(reservation.jsonPath, "utf8")) as unknown;
      const owned = validateScaleStreamingOwnedReport(persisted, authority);
      expect(owned).toMatchObject({
        ownership: { publicationState: "finalization-failed", terminalState: "passed" },
        report: { state: "pending" },
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("bounds and sanitizes retained failure causes", () => {
    expect(sanitizeScaleStreamingCause(new Error(`C:\\secret\\file ${"x".repeat(300)}`))).toBe(
      `[path] ${"x".repeat(233)}`,
    );
  });
});

function generatedCacheAuthorityFixture(): Readonly<{
  expected: Readonly<Record<string, string>>;
  index: Readonly<{ cacheKey: string; resourceId: string }>;
  texture: Readonly<{ cacheKey: string; resourceId: string }>;
}> {
  const hero = corpus.graphs.find(({ id }) => id === "hero");
  const [texture, vertices, indices] = hero?.resources ?? [];
  if (
    hero === undefined ||
    texture === undefined ||
    vertices === undefined ||
    indices === undefined
  ) {
    throw new Error("Generated hero dependency graph is incomplete");
  }
  const textureKey = streamingResourceCacheKey({
    bytes: texture.bytes,
    decode: {
      colorSpace: "srgb",
      format: "rgba8",
      height: hero.texture.height,
      version: 1,
      width: hero.texture.width,
    },
    dependencies: [],
    format: "ktx2",
    path: texture.source,
    resourceId: texture.resourceId,
    sha256: texture.sha256,
  });
  const indexKey = streamingResourceCacheKey({
    bytes: indices.bytes,
    decode: {
      count: hero.indexCount,
      indexFormat: "uint32",
      mode: "TRIANGLES",
      stride: 4,
      version: 1,
      vertexCount: hero.vertexCount,
    },
    dependencies: [texture.resourceId, vertices.resourceId],
    format: "meshopt",
    path: indices.source,
    resourceId: indices.resourceId,
    sha256: indices.sha256,
  });
  return Object.freeze({
    expected: Object.freeze({
      [indices.resourceId]: indexKey,
      [texture.resourceId]: textureKey,
    }),
    index: Object.freeze({ cacheKey: indexKey, resourceId: indices.resourceId }),
    texture: Object.freeze({ cacheKey: textureKey, resourceId: texture.resourceId }),
  });
}

function fixture(): {
  authority: ScaleStreamingEvidenceAuthority;
  report: ScaleStreamingTerminalReport;
} {
  const modeled = createScaleStreamingManifestModel(corpus);
  const cacheAuthority = generatedCacheAuthorityFixture();
  const population = {
    dependencyBytes: 20,
    dependencyCount: 2,
    districtCellBytes: 30,
    districtCellCount: 9,
    districtIndexBytes: 10,
    installBytes: 100,
    installResourceCount: 4,
    representativeBytes: 60,
    representativeResourceCount: 3,
  };
  const target = {
    artifactDigest: "a".repeat(64),
    expectedStreamingResourceCacheKeys: cacheAuthority.expected,
    modelHardLinkBytes: 2_620_371_552,
    modelHardLinkCount: 5,
    modeled,
    population,
    releaseDigest: "b".repeat(64),
  } as MaterializedScaleStreamingTarget;
  const gpuCache = {
    acquireCount: 13,
    hitCount: 9,
    liveDecodedBytes: 50,
    liveEncodedBytes: 0,
    liveRefCount: 2,
    liveResourceCount: 2,
    missCount: 4,
    releaseCount: 11,
    resources: [
      {
        cacheKey: cacheAuthority.index.cacheKey,
        format: "meshopt",
        ownedBytes: 25,
        refCount: 1,
        resourceId: cacheAuthority.index.resourceId,
      },
      {
        cacheKey: cacheAuthority.texture.cacheKey,
        format: "ktx2",
        ownedBytes: 25,
        refCount: 1,
        resourceId: cacheAuthority.texture.resourceId,
      },
    ],
  };
  const decodeCache = {
    ...gpuCache,
    liveDecodedBytes: 0,
    resources: gpuCache.resources.map((resource) => ({ ...resource, ownedBytes: 0 })),
  };
  const hydrationReadSample = {
    dependencyCount: 2,
    dependencyDecodeMs: 0,
    dependencyDecodedBytes: 0,
    dependencyEncodedBytes: 40,
    dependencyReadMs: 1,
    dependencyUploadBytes: 0,
    dependencyUploadMs: 0,
  };
  const hydrationDecodeUploadSample = {
    ...hydrationReadSample,
    dependencyDecodeMs: 1,
    dependencyDecodedBytes: 80,
    dependencyEncodedBytes: 0,
    dependencyReadMs: 0,
    dependencyUploadBytes: 80,
    dependencyUploadMs: 1,
  };
  const traversalMissSample = {
    ...hydrationReadSample,
    dependencyDecodeMs: 1,
    dependencyDecodedBytes: 80,
    dependencyUploadBytes: 80,
    dependencyUploadMs: 1,
  };
  const traversalHitSample = {
    ...traversalMissSample,
    dependencyCount: 1,
    dependencyDecodeMs: 0,
    dependencyDecodedBytes: 0,
    dependencyEncodedBytes: 0,
    dependencyReadMs: 0,
    dependencyUploadBytes: 0,
    dependencyUploadMs: 0,
  };
  const traversalHitSamples = Array.from({ length: 9 }, () => ({ ...traversalHitSample }));
  const core = {
    authority: {
      durabilityClaimed: true,
      launchEnabled: true,
      persistence: "granted",
      persistenceWarning: null,
      releaseDigest: target.releaseDigest,
      shellGenerationId: `${target.artifactDigest}:${target.releaseDigest}`,
      state: "ready",
    },
    hydration: {
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
    },
    hydrationSamples: [hydrationReadSample, hydrationDecodeUploadSample],
    modeled,
    population,
    installLiveness: {
      absoluteTimeoutMs: 1_800_000,
      lastProgressAtMs: 2,
      lastProgressGapMs: 0,
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
      maxProgressGapMs: 1,
      pollIntervalMs: 1_000,
      stallTimeoutMs: 120_000,
      startedAtMs: 1,
      terminalCause: null,
      timeoutClassification: null,
    },
    runtime: {
      activeReleaseDigest: target.releaseDigest,
      activeShellGenerationId: `${target.artifactDigest}:${target.releaseDigest}`,
      installedModelBytes: 2_620_371_552,
      installedModelCount: 5,
      installedStreamingBytes: 60,
      installedStreamingCount: 3,
    },
    streaming: {
      cellLoadSamples: [
        hydrationReadSample,
        hydrationDecodeUploadSample,
        traversalMissSample,
        ...traversalHitSamples,
      ],
      cellLoadP95Ms: 10,
      decodeQueueDepthHighWater: 6,
      dependencyCache: decodeCache,
      dependencyDecodeFailureCount: 0,
      dependencyGpuCache: gpuCache,
      dependencyDecodedBytes: 160,
      dependencyEncodedBytesRead: 80,
      dependencyReadCount: 4,
      dependencyUploadBytes: 160,
      dependencyUploadCount: 4,
      measurementCellLoadSamples: [traversalMissSample, ...traversalHitSamples],
      measurementProactiveEvictionCount: 1,
      psoWarmupGameplayOverlapCount: 0,
      renderBatchCellCountHighWater: 3,
    },
    traversalReuse: {
      decodeAcquireDelta: 11,
      decodeHitDelta: 9,
      decodeMissDelta: 2,
      decodeReleaseDelta: 11,
      gpuAcquireDelta: 11,
      gpuHitDelta: 9,
      gpuMissDelta: 2,
      gpuReleaseDelta: 11,
      psoWarmupGameplayOverlapCount: 0,
    },
  } as unknown as ScaleStreamingRunnerCoreResult;
  const evidence = createScaleStreamingPersistedEvidence(core);
  const source = { commit: "c".repeat(40), dirtyTreeDigest: "d".repeat(64) };
  const browser = { executableSha256: "e".repeat(64), revision: "r", version: "151" };
  const environment = {
    browserRevision: browser.revision,
    executableSha256: browser.executableSha256,
    gateIdentity: { state: "measured" },
    machineId: "dev-01",
    requestedTier: "showcase",
    sandboxVerified: true,
  } as never;
  const startedAt = "2026-08-01T00:00:00.000Z";
  const report = {
    browser,
    build: { artifactDigest: target.artifactDigest, releaseDigest: target.releaseDigest },
    cleanup: [
      "browser-close",
      "target-stop",
      "runtime-profile-remove",
      "environment-profile-remove",
      "materialized-target-remove",
      "generated-corpus-remove",
    ].map((operation) => ({ message: null, operation, state: "passed" as const })),
    companion: { path: "result.md", state: "requested" },
    completedAt: "2026-08-01T00:01:00.000Z",
    contract: "scale-streaming@1",
    corpus,
    environment,
    evidence,
    failure: null,
    inputs: {
      corpusDocumentPath: "corpus.json",
      corpusRoot: "corpus",
      machineId: "dev-01",
      tier: "showcase",
    },
    phase: "complete",
    postvalidation: {
      build: { artifactDigest: target.artifactDigest, releaseDigest: target.releaseDigest },
      source,
      target: { artifactDigest: target.artifactDigest, releaseDigest: target.releaseDigest },
    },
    progress: {
      cleanup: true,
      environment: true,
      materialization: true,
      postvalidation: true,
      runtime: true,
      validation: true,
    },
    schemaVersion: 1,
    source,
    startedAt,
    state: "passed",
    target: {
      artifactDigest: target.artifactDigest,
      modelHardLinkBytes: target.modelHardLinkBytes,
      modelHardLinkCount: target.modelHardLinkCount,
      modeled,
      population,
      releaseDigest: target.releaseDigest,
    },
  } as const satisfies ScaleStreamingTerminalReport;
  return {
    authority: {
      artifactDigest: target.artifactDigest,
      browser,
      corpus,
      environment,
      releaseDigest: target.releaseDigest,
      source,
      target,
    },
    report,
  };
}
