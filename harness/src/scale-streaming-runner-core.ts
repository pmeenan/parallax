import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  cp,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS,
  APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
  type ParallaxTelemetryExport,
  type ParallaxTelemetrySnapshot,
  parseStreamingDistrictIndex,
  STREAMING_CELL_LOAD_BUDGET_MS,
  streamingResourceCacheKey,
  TELEMETRY_GLOBAL_NAME,
  type WorldStreamingTelemetrySnapshot,
} from "@parallax/engine";
import type { Page } from "playwright-core";
import type { InstallOnlyFile } from "./build-manifest.js";
import { type BuildManifest, readAndValidateBuildManifest } from "./build-manifest.js";
import { sanitizeDiagnosticCause } from "./diagnostic-redaction.js";
import type { InstallManifestSummary, InstallResource } from "./install-manifest.js";
import {
  DEGRADED_DURABILITY_WARNING,
  ProgressLivenessError,
  type ProgressLivenessObservation,
  type ProgressLivenessSnapshot,
  type ProgressLivenessWaitPlatform,
  waitForProgressLiveness,
} from "./progress-liveness.js";
import {
  createScaleStreamingManifestModel,
  createScaleStreamingTargetDocuments,
  type GeneratedScaleStreamingCorpus,
  parseGeneratedScaleStreamingCorpus,
  readGeneratedScaleStreamingCorpus,
  type ScaleStreamingManifestModel,
} from "./scale-streaming-corpus.js";
import type { LocalServerOptions } from "./server.js";
import { requireStreamingEvidence, requireWorldStreamingSnapshot } from "./streaming-evidence.js";
import { readTelemetry } from "./telemetry.js";

type StreamingResourceCacheTelemetry = NonNullable<
  WorldStreamingTelemetrySnapshot["dependencyCache"]
>;

const TARGET_PREFIX = "parallax-scale-streaming-target-";
export const SCALE_STREAMING_INITIAL_SAMPLE_LIMIT = 256;
const MODEL_ROOT = join(
  homedir(),
  ".parallax",
  "harness",
  "models",
  "gemma-4-E2B-it-qat-GGUF-66a399f6",
);

export type ScaleStreamingPipelineSamplePhase = "hydration" | "traversal";
export type ScaleStreamingCacheKind = "decode" | "gpu";

export interface ScaleStreamingPipelineAttributionSample {
  readonly dependencyCount?: number;
  readonly dependencyDecodeMs?: number;
  readonly dependencyDecodedBytes?: number;
  readonly dependencyEncodedBytes?: number;
  readonly dependencyReadMs?: number;
  readonly dependencyUploadBytes?: number;
  readonly dependencyUploadMs?: number;
}

export function validScaleStreamingPipelineSample(
  sample: ScaleStreamingPipelineAttributionSample,
  phase: ScaleStreamingPipelineSamplePhase,
): boolean {
  if (
    phase === "traversal"
      ? !positiveInteger(sample.dependencyCount)
      : !nonNegativeInteger(sample.dependencyCount)
  ) {
    return false;
  }
  return (
    sample.dependencyCount === 0 ||
    (nonNegativeInteger(sample.dependencyDecodedBytes) &&
      nonNegativeInteger(sample.dependencyEncodedBytes) &&
      nonNegativeFinite(sample.dependencyDecodeMs) &&
      nonNegativeFinite(sample.dependencyReadMs) &&
      nonNegativeInteger(sample.dependencyUploadBytes) &&
      nonNegativeFinite(sample.dependencyUploadMs))
  );
}

export function validScaleStreamingResourceOwnedBytes(
  value: unknown,
  cacheKind: ScaleStreamingCacheKind,
): value is number {
  return cacheKind === "decode" ? value === 0 : positiveInteger(value);
}

export interface ScaleStreamingMaterializedPopulation {
  readonly dependencyBytes: number;
  readonly dependencyCount: number;
  readonly districtCellBytes: number;
  readonly districtCellCount: number;
  readonly districtIndexBytes: number;
  readonly installBytes: number;
  readonly installResourceCount: number;
  readonly representativeBytes: number;
  readonly representativeResourceCount: number;
}

export interface ScaleStreamingInstallTargetPopulation {
  readonly manifestBytes: number;
  readonly manifestResourceCount: number;
  readonly opfsBytes: number;
  readonly opfsResourceCount: number;
  readonly shellBytes: number;
  readonly shellResourceCount: number;
}

export interface ScaleStreamingConsumerPopulation {
  readonly modelBytes: number;
  readonly modelResourceCount: number;
  readonly opfsBytes: number;
  readonly opfsResourceCount: number;
  readonly otherBytes: number;
  readonly otherResourceCount: number;
  readonly representativeBytes: number;
  readonly representativeResourceCount: number;
}

export function deriveScaleStreamingInstallTargetPopulation(
  summary: InstallManifestSummary,
): ScaleStreamingInstallTargetPopulation {
  const population = Object.freeze({
    manifestBytes: summary.resourceBytes,
    manifestResourceCount: summary.resourceCount,
    opfsBytes: summary.bytesByTarget.opfs,
    opfsResourceCount: summary.countByTarget.opfs,
    shellBytes: summary.bytesByTarget.shell,
    shellResourceCount: summary.countByTarget.shell,
  });
  if (
    population.opfsBytes + population.shellBytes !== population.manifestBytes ||
    population.opfsResourceCount + population.shellResourceCount !==
      population.manifestResourceCount
  ) {
    throw new Error("Scale-streaming install target population does not conserve manifest totals");
  }
  return population;
}

export function deriveScaleStreamingConsumerPopulation(
  resources: readonly InstallResource[],
  representativeResourceIds: ReadonlySet<string>,
): ScaleStreamingConsumerPopulation {
  const opfsResources = resources.filter(({ target }) => target === "opfs");
  const representativeResources = opfsResources.filter(({ id }) =>
    representativeResourceIds.has(id),
  );
  if (
    representativeResources.length !== representativeResourceIds.size ||
    representativeResources.some(({ kind }) => kind === "model")
  ) {
    throw new Error(
      "Scale-streaming representative consumer population is not an exact OPFS subset",
    );
  }
  const modelResources = opfsResources.filter(({ kind }) => kind === "model");
  const otherResources = opfsResources.filter(
    ({ id, kind }) => kind !== "model" && !representativeResourceIds.has(id),
  );
  const sumBytes = (values: readonly InstallResource[]): number =>
    values.reduce((sum, { bytes }) => sum + bytes, 0);
  const population = Object.freeze({
    modelBytes: sumBytes(modelResources),
    modelResourceCount: modelResources.length,
    opfsBytes: sumBytes(opfsResources),
    opfsResourceCount: opfsResources.length,
    otherBytes: sumBytes(otherResources),
    otherResourceCount: otherResources.length,
    representativeBytes: sumBytes(representativeResources),
    representativeResourceCount: representativeResources.length,
  });
  if (
    population.representativeBytes + population.modelBytes + population.otherBytes !==
      population.opfsBytes ||
    population.representativeResourceCount +
      population.modelResourceCount +
      population.otherResourceCount !==
      population.opfsResourceCount
  ) {
    throw new Error("Scale-streaming OPFS consumer populations do not conserve exact totals");
  }
  return population;
}

export interface MaterializedScaleStreamingTarget {
  readonly artifactDigest: string;
  readonly buildManifest: BuildManifest;
  readonly exactRangeResources: NonNullable<LocalServerOptions["exactRangeResources"]>;
  readonly expectedStreamingResourceCacheKeys: Readonly<Record<string, string>>;
  readonly installOnlyFiles: readonly InstallOnlyFile[];
  readonly modelHardLinkBytes: typeof APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES;
  readonly modelHardLinkCount: number;
  readonly modeled: ScaleStreamingManifestModel;
  readonly population: ScaleStreamingMaterializedPopulation;
  readonly releaseDigest: string;
  readonly root: string;
}

export interface ScaleStreamingInstallerAuthority {
  readonly durabilityClaimed: boolean;
  readonly launchEnabled: boolean;
  readonly persistence: string | null;
  readonly persistenceWarning: string | null;
  readonly releaseDigest: string | null;
  readonly shellGenerationId: string | null;
  readonly state: string | null;
}

export interface ScaleStreamingInstallRead {
  readonly authority: ScaleStreamingInstallerAuthority;
  readonly observation: ProgressLivenessObservation;
}

export interface ScaleStreamingBrowserOperations<Profile> {
  closeProfile(profile: Profile): Promise<void>;
  createFreshIsolatedProfile(): Promise<Profile>;
  install(profile: Profile): Promise<void>;
  launch(profile: Profile): Promise<void>;
  navigateOrdinary(profile: Profile): Promise<void>;
  readInstall(profile: Profile, signal: AbortSignal): Promise<ScaleStreamingInstallRead>;
  readRuntime(profile: Profile, signal?: AbortSignal): Promise<ParallaxTelemetrySnapshot | null>;
  readTraversal(profile: Profile): Promise<ParallaxTelemetrySnapshot>;
  startStandardTraversal(profile: Profile): Promise<void>;
}

export interface ScaleStreamingBrowserSequence<Install, Runtime, Start, End> {
  readonly end: End;
  readonly install: Install;
  readonly runtime: Runtime;
  readonly start: Start;
}

export interface ScaleStreamingRunnerCoreResult {
  readonly authority: ScaleStreamingInstallerAuthority;
  readonly installLiveness: ProgressLivenessSnapshot;
  readonly modeled: ScaleStreamingManifestModel;
  readonly population: ScaleStreamingMaterializedPopulation;
  readonly runtime: Readonly<{
    readonly activeReleaseDigest: string;
    readonly activeShellGenerationId: string;
    readonly installedModelBytes: number;
    readonly installedModelCount: number;
    readonly installedStreamingBytes: number;
    readonly installedStreamingCount: number;
  }>;
  readonly hydration: ScaleStreamingPipelineSummary;
  readonly hydrationSamples: WorldStreamingTelemetrySnapshot["cellLoadSamples"];
  readonly streaming: ReturnType<typeof requireStreamingEvidence>;
  readonly traversalReuse: ScaleStreamingTraversalReuseSummary;
}

export interface ScaleStreamingPipelineSummary {
  readonly decodeCacheMissCount: number;
  readonly decodeQueueDepthHighWater: number;
  readonly decodeWorkerCount: number;
  readonly decodedBytes: number;
  readonly encodedBytesRead: number;
  readonly gpuCacheMissCount: number;
  readonly psoWarmupGameplayOverlapCount: 0;
  readonly readCount: number;
  readonly renderBatchCellCountHighWater: number;
  readonly uploadBytes: number;
  readonly uploadCount: number;
}

export interface ScaleStreamingTraversalReuseSummary {
  readonly decodeAcquireDelta: number;
  readonly decodeHitDelta: number;
  readonly decodeMissDelta: number;
  readonly decodeReleaseDelta: number;
  readonly gpuAcquireDelta: number;
  readonly gpuHitDelta: number;
  readonly gpuMissDelta: number;
  readonly gpuReleaseDelta: number;
  readonly psoWarmupGameplayOverlapCount: 0;
}

export function deriveScaleStreamingResourceCacheKeyAuthority(
  composedDistrictIndex: unknown,
): Readonly<Record<string, string>> {
  const parsed = parseStreamingDistrictIndex(composedDistrictIndex, "district-1-surface");
  const resources = parsed.resources;
  if (resources === undefined || resources.length === 0) {
    throw new Error("Composed scale-streaming district has no dependency resources");
  }
  return Object.freeze(
    Object.fromEntries(
      resources.map((resource) => [resource.resourceId, streamingResourceCacheKey(resource)]),
    ),
  );
}

export async function materializeScaleStreamingTarget(input: {
  readonly corpusDocument: unknown;
  readonly corpusRoot: string;
  readonly productionRoot: string;
  readonly modelRoot?: string;
}): Promise<MaterializedScaleStreamingTarget> {
  const root = await mkdtemp(join(tmpdir(), TARGET_PREFIX));
  try {
    const productionRoot = await validateScaleStreamingSourceTree(
      input.productionRoot,
      "production",
    );
    const corpusRoot = await validateScaleStreamingSourceTree(input.corpusRoot, "corpus");
    const modelRoot = await validateScaleStreamingSourceTree(
      input.modelRoot ?? MODEL_ROOT,
      "model",
    );
    await cp(productionRoot, root, { recursive: true });
    await validateScaleStreamingSourceTree(root, "materialized target");
    const production = await readAndValidateBuildManifest(root);
    const installOnlyFiles = Object.freeze(
      production.installManifest.resources
        .filter(({ kind }) => kind === "model")
        .map(({ bytes, sha256, source }) => Object.freeze({ bytes, sha256, source })),
    );
    await materializeModelLinks(root, modelRoot);
    const corpus = await readGeneratedScaleStreamingCorpus(corpusRoot, input.corpusDocument);
    assertGeneratedExactRangePathDisjoint(corpus, production.installManifest.resources);
    const district = production.manifest.gameContentEntrypoints.find(
      ({ districtId }) => districtId === "district-1-surface",
    );
    if (district === undefined) throw new Error("Production D1 entrypoint is absent");
    const districtIndex = JSON.parse(await readFile(join(root, district.path), "utf8")) as unknown;
    const documents = createScaleStreamingTargetDocuments(
      production.manifest,
      production.installManifest,
      districtIndex,
      corpus,
    );
    const expectedStreamingResourceCacheKeys = deriveScaleStreamingResourceCacheKeyAuthority(
      JSON.parse(documents.districtIndexBytes.toString("utf8")) as unknown,
    );
    if (Object.keys(expectedStreamingResourceCacheKeys).length !== documents.dependencyCount) {
      throw new Error("Composed scale-streaming cache-key authority is incomplete");
    }
    for (const resource of corpus.graphs.flatMap(({ resources }) => resources)) {
      const destination = safeTargetPath(root, resource.source);
      await mkdir(resolve(destination, ".."), { recursive: true });
      const source = await requireDirectContainedRegularFile(corpusRoot, resource.source, "corpus");
      await requireDirectContainedDirectory(root, resolve(destination, ".."), "target");
      await copyFile(source, destination);
    }
    if (district.path !== documents.districtIndexPath) {
      const supersededDistrictIndex = await requireDirectContainedRegularFile(
        root,
        district.path,
        "target",
      );
      await rm(supersededDistrictIndex);
    }
    const districtIndexPath = safeTargetPath(root, documents.districtIndexPath);
    await requireDirectContainedDirectory(root, resolve(districtIndexPath, ".."), "target");
    await writeFile(districtIndexPath, documents.districtIndexBytes);
    await requireDirectContainedDirectory(root, root, "target");
    await writeFile(join(root, "install-manifest.json"), documents.installManifestBytes);
    await writeFile(join(root, "build-manifest.json"), documents.buildManifestBytes);
    const validated = await readAndValidateBuildManifest(root, { installOnlyFiles });
    if (
      validated.artifactDigest !== documents.buildManifestDigest ||
      validated.releaseDigest !== documents.releaseDigest
    ) {
      throw new Error("Materialized scale-streaming target identity drifted after validation");
    }
    const cells = validated.installManifest.resources.filter(({ kind }) => kind === "world-cell");
    const installPopulation = deriveScaleStreamingInstallTargetPopulation(validated.installSummary);
    const districtIndexResource = validated.installManifest.resources.find(
      ({ kind, source }) => kind === "district-index" && source === documents.districtIndexPath,
    );
    if (districtIndexResource === undefined) {
      throw new Error("Materialized scale-streaming district index resource is absent");
    }
    const representativeResourceIds = new Set([
      districtIndexResource.id,
      ...cells.map(({ id }) => id),
      ...corpus.graphs.flatMap(({ resources }) => resources.map(({ resourceId }) => resourceId)),
    ]);
    const consumerPopulation = deriveScaleStreamingConsumerPopulation(
      validated.installManifest.resources,
      representativeResourceIds,
    );
    if (
      representativeResourceIds.size !== documents.materializedSampleResourceCount ||
      consumerPopulation.representativeBytes !== documents.materializedSampleBytes ||
      consumerPopulation.representativeResourceCount !==
        documents.materializedSampleResourceCount ||
      consumerPopulation.modelBytes !== APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES ||
      consumerPopulation.modelResourceCount !== APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.length ||
      consumerPopulation.opfsBytes !== installPopulation.opfsBytes ||
      consumerPopulation.opfsResourceCount !== installPopulation.opfsResourceCount
    ) {
      throw new Error("Materialized scale-streaming consumer population drifted after validation");
    }
    const exactRangeResources = Object.freeze(
      validated.installManifest.resources
        .map(({ bytes, sha256, source }) => Object.freeze({ bytes, sha256, source }))
        .sort((left, right) => compare(left.source, right.source)),
    );
    return Object.freeze({
      artifactDigest: validated.artifactDigest,
      buildManifest: validated.manifest,
      exactRangeResources,
      expectedStreamingResourceCacheKeys,
      installOnlyFiles,
      modelHardLinkBytes: APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
      modelHardLinkCount: APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.length,
      modeled: createScaleStreamingManifestModel(corpus),
      population: Object.freeze({
        dependencyBytes: documents.dependencyBytes,
        dependencyCount: documents.dependencyCount,
        districtCellBytes: cells.reduce((sum, resource) => sum + resource.bytes, 0),
        districtCellCount: cells.length,
        districtIndexBytes: documents.districtIndexBytes.byteLength,
        installBytes: installPopulation.opfsBytes,
        installResourceCount: installPopulation.opfsResourceCount,
        representativeBytes: documents.materializedSampleBytes,
        representativeResourceCount: documents.materializedSampleResourceCount,
      }),
      releaseDigest: validated.releaseDigest,
      root,
    });
  } catch (error: unknown) {
    await removeMaterializedScaleStreamingTarget(root).catch((cleanupError: unknown) => {
      throw new AggregateError(
        [error, cleanupError],
        "Scale-streaming materialization and cleanup failed",
      );
    });
    throw error;
  }
}

export async function removeMaterializedScaleStreamingTarget(root: string): Promise<void> {
  const resolved = resolve(root);
  const temporaryRoot = resolve(tmpdir());
  if (
    !resolved.startsWith(`${temporaryRoot}${sep}`) ||
    !resolved.slice(temporaryRoot.length + 1).startsWith(TARGET_PREFIX)
  ) {
    throw new Error("Refusing to remove a non-scale-streaming temporary target");
  }
  await rm(resolved, { force: true, recursive: true });
}

export async function waitForScaleStreamingRuntimeReady<Profile>(
  input: Readonly<{
    authority: ScaleStreamingInstallerAuthority;
    platform: ProgressLivenessWaitPlatform | undefined;
    profile: Profile;
    readRuntime(profile: Profile, signal?: AbortSignal): Promise<ParallaxTelemetrySnapshot | null>;
    target: MaterializedScaleStreamingTarget;
  }>,
): Promise<ParallaxTelemetrySnapshot> {
  try {
    const result = await waitForProgressLiveness(async (signal) => {
      const snapshot = await input.readRuntime(input.profile, signal);
      return Object.freeze({
        observation: observeScaleStreamingRuntimeReadiness(snapshot, input.target),
        value: snapshot,
      });
    }, input.platform);
    if (result.value === null) {
      throw new Error("Runtime Ready observation returned no public telemetry");
    }
    return result.value;
  } catch (error: unknown) {
    if (
      !(error instanceof ProgressLivenessError) ||
      (error.liveness.timeoutClassification !== "stall" &&
        error.liveness.timeoutClassification !== "absolute")
    ) {
      throw error;
    }
    return adjudicateScaleStreamingRuntimeTimeout(input, error);
  }
}

async function adjudicateScaleStreamingRuntimeTimeout<Profile>(
  input: Readonly<{
    authority: ScaleStreamingInstallerAuthority;
    platform: ProgressLivenessWaitPlatform | undefined;
    profile: Profile;
    readRuntime(profile: Profile, signal?: AbortSignal): Promise<ParallaxTelemetrySnapshot | null>;
    target: MaterializedScaleStreamingTarget;
  }>,
  timeout: ProgressLivenessError,
): Promise<ParallaxTelemetrySnapshot> {
  const classification = timeout.liveness.timeoutClassification;
  let snapshot: ParallaxTelemetrySnapshot | null;
  try {
    snapshot = await boundedFinalRuntimeRead(
      input.profile,
      input.readRuntime,
      input.platform,
      timeout.liveness.pollIntervalMs,
    );
  } catch (secondary: unknown) {
    throw runtimeLivenessWithSecondary(timeout, "final telemetry read failed", secondary);
  }
  if (snapshot === null) {
    throw runtimeLivenessWithSecondary(
      timeout,
      "final telemetry remained unavailable",
      new Error("Runtime public telemetry was absent"),
    );
  }
  if (runtimeAuthoritySubsystemFailed(snapshot)) {
    const observation = observeScaleStreamingRuntimeReadiness(snapshot, input.target);
    throw runtimeLivenessWithSecondary(
      timeout,
      "final runtime subsystem failed",
      observation.terminalCause ?? new Error("Runtime subsystem entered failed state"),
    );
  }
  const authorityMismatches = collectScaleStreamingRuntimeAuthorityMismatches(
    snapshot,
    input.authority,
    input.target,
  );
  const hydrationMismatches = collectScaleStreamingHydrationMismatches(snapshot.streaming);
  if (
    runtimeAuthoritySubsystemsReady(snapshot, input.target) &&
    authorityMismatches.length === 0 &&
    hydrationMismatches.length === 0
  ) {
    return snapshot;
  }
  if (authorityMismatches.length !== 0 || hydrationMismatches.length !== 0) {
    const diagnostics = [
      authorityMismatches.length === 0
        ? null
        : `final authority mismatches: ${formatRuntimeAuthorityMismatches(authorityMismatches)}`,
      hydrationMismatches.length === 0
        ? null
        : `final hydration mismatches: ${formatHydrationMismatches(hydrationMismatches)}`,
    ].filter((value): value is string => value !== null);
    throw new Error(
      `Scale-streaming runtime ${classification} timeout; ${diagnostics.join("; ")}`,
      { cause: timeout },
    );
  }
  throw runtimeLivenessWithSecondary(
    timeout,
    "final runtime authority remained unsettled",
    new Error("Runtime authority subsystems were not ready"),
  );
}

async function boundedFinalRuntimeRead<Profile>(
  profile: Profile,
  readRuntime: (
    profile: Profile,
    signal?: AbortSignal,
  ) => Promise<ParallaxTelemetrySnapshot | null>,
  injectedPlatform: ProgressLivenessWaitPlatform | undefined,
  timeoutMs: number,
): Promise<ParallaxTelemetrySnapshot | null> {
  const platform = injectedPlatform ?? runtimeReadWaitPlatform();
  const controller = new AbortController();
  let timer: unknown;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = platform.setTimeout(() => {
      reject(new Error("Final runtime telemetry read exceeded one polling interval"));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => readRuntime(profile, controller.signal)),
      deadline,
    ]);
  } finally {
    platform.clearTimeout(timer);
    controller.abort();
  }
}

function runtimeLivenessWithSecondary(
  timeout: ProgressLivenessError,
  context: string,
  secondary: unknown,
): AggregateError {
  const sanitized = sanitizeDiagnosticCause(secondary);
  const sanitizedSecondary = new Error(`${sanitized.name}: ${sanitized.message}`);
  return new AggregateError(
    [timeout, sanitizedSecondary],
    `Scale-streaming runtime ${timeout.liveness.timeoutClassification} timeout; ${context}: ${sanitized.message}`,
    { cause: timeout },
  );
}

function runtimeReadWaitPlatform(): ProgressLivenessWaitPlatform {
  return Object.freeze({
    clearTimeout: (handle: unknown) => globalThis.clearTimeout(handle as number),
    now: () => Date.now(),
    setTimeout: (callback: () => void, milliseconds: number) =>
      globalThis.setTimeout(callback, milliseconds),
  });
}

export async function runScaleStreamingBrowserSequence<Profile, Install, Runtime, Start, End>(
  operations: Readonly<{
    closeProfile(profile: Profile): Promise<void>;
    createFreshIsolatedProfile(): Promise<Profile>;
    install(profile: Profile): Promise<void>;
    launch(profile: Profile): Promise<void>;
    navigateOrdinary(profile: Profile): Promise<void>;
    observeInstall(profile: Profile): Promise<Install>;
    observeRuntime(profile: Profile): Promise<Runtime>;
    observeTraversal(profile: Profile): Promise<End>;
    snapshotTraversalStart(profile: Profile): Promise<Start>;
    startStandardTraversal(profile: Profile): Promise<void>;
  }>,
): Promise<ScaleStreamingBrowserSequence<Install, Runtime, Start, End>> {
  const profile = await operations.createFreshIsolatedProfile();
  let primaryFailure: unknown = null;
  try {
    await operations.navigateOrdinary(profile);
    await operations.install(profile);
    const install = await operations.observeInstall(profile);
    await operations.launch(profile);
    const runtime = await operations.observeRuntime(profile);
    const start = await operations.snapshotTraversalStart(profile);
    await operations.startStandardTraversal(profile);
    const end = await operations.observeTraversal(profile);
    return Object.freeze({ end, install, runtime, start });
  } catch (error: unknown) {
    primaryFailure = error;
    throw error;
  } finally {
    await operations.closeProfile(profile).catch((cleanupFailure: unknown) => {
      if (primaryFailure !== null) {
        throw new AggregateError(
          [primaryFailure, cleanupFailure],
          "Scale-streaming browser orchestration and profile cleanup failed",
        );
      }
      throw cleanupFailure;
    });
  }
}

export async function runScaleStreamingRunnerCore<Profile>(input: {
  readonly operations: ScaleStreamingBrowserOperations<Profile>;
  readonly readyWaitPlatform?: ProgressLivenessWaitPlatform;
  readonly target: MaterializedScaleStreamingTarget;
}): Promise<ScaleStreamingRunnerCoreResult> {
  let installerAuthority: ScaleStreamingInstallerAuthority | null = null;
  let traversalStart: ParallaxTelemetrySnapshot | null = null;
  const sequence = await runScaleStreamingBrowserSequence({
    closeProfile: input.operations.closeProfile,
    createFreshIsolatedProfile: input.operations.createFreshIsolatedProfile,
    install: input.operations.install,
    launch: input.operations.launch,
    navigateOrdinary: input.operations.navigateOrdinary,
    observeInstall: async (profile) => {
      const ready = await waitForProgressLiveness(async (signal) => {
        const current = await input.operations.readInstall(profile, signal);
        return Object.freeze({ observation: current.observation, value: current.authority });
      }, input.readyWaitPlatform);
      installerAuthority = ready.value;
      return ready;
    },
    observeRuntime: (profile) => {
      if (installerAuthority === null) {
        throw new Error("Runtime observation preceded installer authority");
      }
      return waitForScaleStreamingRuntimeReady({
        authority: installerAuthority,
        platform: input.readyWaitPlatform,
        profile,
        readRuntime: input.operations.readRuntime,
        target: input.target,
      });
    },
    observeTraversal: async (profile) => {
      const start = traversalStart;
      if (start === null) throw new Error("Scale-streaming traversal start was not captured");
      return (
        await waitForProgressLiveness(async () => {
          const snapshot = await input.operations.readTraversal(profile);
          return Object.freeze({
            observation: traversalObservation(snapshot.streaming, start.streaming),
            value: snapshot,
          });
        }, input.readyWaitPlatform)
      ).value;
    },
    snapshotTraversalStart: async (profile) => {
      traversalStart = await input.operations.readRuntime(profile);
      if (traversalStart === null) {
        throw new Error("Runtime telemetry disappeared before traversal");
      }
      return traversalStart;
    },
    startStandardTraversal: input.operations.startStandardTraversal,
  });
  const authority = sequence.install.value;
  requireInstallerAuthority(authority, sequence.install.liveness, input.target);
  requireRuntimeAuthority(sequence.runtime, authority, input.target);
  const start = requireWorldStreamingSnapshot(sequence.start.streaming, "settled-hydration");
  const hydration = requireRepresentativeHydration(start);
  const hydrationSamples = captureScaleStreamingHydrationSamples(start);
  const streaming = requireStreamingEvidence(sequence.end.streaming, start);
  const traversalReuse = requireRepresentativeStreaming(streaming, start);
  return Object.freeze({
    authority,
    installLiveness: sequence.install.liveness,
    hydration,
    hydrationSamples,
    modeled: input.target.modeled,
    population: input.target.population,
    runtime: Object.freeze({
      activeReleaseDigest: input.target.releaseDigest,
      activeShellGenerationId: authority.shellGenerationId ?? "",
      installedModelBytes: sequence.runtime.installedModelSource.resolvedArtifactBytes,
      installedModelCount: sequence.runtime.installedModelSource.resolvedArtifactCount,
      installedStreamingBytes: sequence.runtime.streaming.installedResourceBytes,
      installedStreamingCount: sequence.runtime.streaming.installedResourceCount,
    }),
    streaming,
    traversalReuse,
  });
}

export function captureScaleStreamingHydrationSamples(
  snapshot: WorldStreamingTelemetrySnapshot,
): WorldStreamingTelemetrySnapshot["cellLoadSamples"] {
  return Object.freeze(snapshot.cellLoadSamples.map((sample) => Object.freeze({ ...sample })));
}

export function observeScaleStreamingRuntimeReadiness(
  snapshot: ParallaxTelemetrySnapshot | null,
  target: MaterializedScaleStreamingTarget,
): ProgressLivenessObservation {
  if (snapshot === null) {
    return Object.freeze({
      durabilityClaimed: false,
      persistence: "granted",
      persistenceWarning: null,
      progress: Object.freeze({
        checkpointedBytes: 0,
        completedResourceCount: 0,
        downloadedBytes: 0,
        finalVerificationBytes: 0,
        finalVerificationPhase: "idle",
        finalVerificationResourceCount: 0,
        finalVerificationTotalBytes: target.population.installBytes,
        finalVerificationTotalResourceCount: target.population.installResourceCount,
        verifiedBytes: 0,
      }),
      state: "launching",
      terminalCause: null,
    });
  }
  const authorityReady = runtimeAuthoritySubsystemsReady(snapshot, target);
  const failed = runtimeAuthoritySubsystemFailed(snapshot);
  const ready =
    authorityReady && collectScaleStreamingHydrationMismatches(snapshot.streaming).length === 0;
  const total = target.population.installBytes;
  const completed = ready ? total : Math.min(total, snapshot.streaming.encodedBytesRead);
  return Object.freeze({
    durabilityClaimed: false,
    persistence: "granted",
    persistenceWarning: null,
    progress: Object.freeze({
      checkpointedBytes: completed,
      completedResourceCount: ready ? target.population.installResourceCount : 0,
      downloadedBytes: completed,
      finalVerificationBytes: ready ? total : 0,
      finalVerificationPhase: ready ? "complete" : "idle",
      finalVerificationResourceCount: ready ? target.population.installResourceCount : 0,
      finalVerificationTotalBytes: total,
      finalVerificationTotalResourceCount: target.population.installResourceCount,
      verifiedBytes: completed,
    }),
    state: failed ? "failed" : ready ? "ready" : "launching",
    terminalCause:
      snapshot.render.failureMessage ??
      snapshot.streaming.failureMessage ??
      snapshot.installedModelSource.failureMessage ??
      snapshot.installerTransfer.failureMessage ??
      snapshot.offlineShell.failureMessage,
  });
}

function runtimeAuthoritySubsystemsReady(
  snapshot: ParallaxTelemetrySnapshot,
  target: MaterializedScaleStreamingTarget,
): boolean {
  return (
    snapshot.render.state === "ready" &&
    snapshot.streaming.state === "streaming" &&
    snapshot.installedModelSource.state === "ready" &&
    snapshot.installerTransfer.state === "ready" &&
    snapshot.offlineShell.state === "active" &&
    snapshot.streaming.installedReleaseDigest === target.releaseDigest
  );
}

function runtimeAuthoritySubsystemFailed(snapshot: ParallaxTelemetrySnapshot): boolean {
  return (
    snapshot.render.state === "failed" ||
    snapshot.streaming.state === "failed" ||
    snapshot.installedModelSource.state === "failed" ||
    snapshot.installerTransfer.state === "failed" ||
    snapshot.offlineShell.state === "failed"
  );
}

function traversalObservation(
  end: WorldStreamingTelemetrySnapshot,
  start: WorldStreamingTelemetrySnapshot,
): ProgressLivenessObservation {
  const sampleDelta = Math.max(0, end.cellLoadSampleCount - start.cellLoadSampleCount);
  const evictionDelta = Math.max(0, end.proactiveEvictionCount - start.proactiveEvictionCount);
  const ready = sampleDelta >= 10 && evictionDelta > 0;
  const failed = end.state === "failed";
  return Object.freeze({
    durabilityClaimed: false,
    persistence: "granted",
    persistenceWarning: null,
    progress: Object.freeze({
      checkpointedBytes: Math.max(0, end.dependencyEncodedBytesRead ?? 0),
      completedResourceCount: sampleDelta,
      downloadedBytes: Math.max(0, end.encodedBytesRead),
      finalVerificationBytes: ready ? sampleDelta : 0,
      finalVerificationPhase: ready ? "complete" : "idle",
      finalVerificationResourceCount: ready ? sampleDelta : 0,
      finalVerificationTotalBytes: ready ? sampleDelta : 0,
      finalVerificationTotalResourceCount: ready ? sampleDelta : 0,
      verifiedBytes: Math.max(0, end.dependencyDecodedBytes ?? 0),
    }),
    state: failed ? "failed" : ready ? "ready" : "streaming",
    terminalCause: end.failureMessage,
  });
}

export function createScaleStreamingPageOperations(baseUrl: string) {
  return Object.freeze({
    async install(page: Page): Promise<void> {
      await page.locator("#installer-start").click();
    },
    async launch(page: Page): Promise<void> {
      await page.locator("#installer-launch").click();
    },
    async navigateOrdinary(page: Page): Promise<void> {
      const url = new URL(baseUrl);
      if (url.searchParams.has("parallaxAutomation")) {
        throw new Error("Scale-streaming runner forbids the privileged legacy consumer route");
      }
      await page.goto(url.href, { waitUntil: "domcontentloaded" });
    },
    async readInstall(page: Page, signal: AbortSignal): Promise<ScaleStreamingInstallRead> {
      return abortable(
        page.evaluate(async () => {
          const getter = (
            globalThis as unknown as {
              __parallaxInstallerDiagnosticsV1?: () => Record<string, unknown>;
            }
          ).__parallaxInstallerDiagnosticsV1;
          if (typeof getter !== "function")
            throw new Error("Installer diagnostics are unavailable");
          const diagnostics = getter() as {
            installer: { installerTransfer: Record<string, unknown> };
            ui: Record<string, unknown>;
          };
          const root = document.querySelector("#installer-shell");
          const launch = document.querySelector("#installer-launch");
          const warning = document.querySelector("#installer-warning");
          if (!(root instanceof HTMLElement) || !(launch instanceof HTMLButtonElement)) {
            throw new Error("Ordinary installer authority controls are unavailable");
          }
          const transfer = diagnostics.installer.installerTransfer;
          const ui = diagnostics.ui;
          const browserPersistedState = await navigator.storage.persisted();
          const transferPersistedState = transfer.persistedState;
          if (
            transferPersistedState !== null &&
            (typeof transferPersistedState !== "boolean" ||
              transferPersistedState !== browserPersistedState)
          ) {
            throw new Error("Installer persistence telemetry differs from browser storage state");
          }
          const durabilityClaimed = transferPersistedState === true;
          const number = (key: string): number => Number(transfer[key] ?? 0);
          const state = typeof ui.state === "string" ? ui.state : null;
          return {
            authority: {
              durabilityClaimed,
              launchEnabled: !launch.disabled,
              persistence: typeof ui.persistence === "string" ? ui.persistence : null,
              persistenceWarning: warning?.textContent || null,
              releaseDigest: root.dataset.releaseDigest || null,
              shellGenerationId: root.dataset.shellGenerationId || null,
              state,
            },
            observation: {
              durabilityClaimed,
              persistence: typeof ui.persistence === "string" ? ui.persistence : null,
              persistenceWarning: warning?.textContent || null,
              progress: {
                checkpointedBytes: number("checkpointedBytes"),
                completedResourceCount: number("completedResourceCount"),
                downloadedBytes: number("downloadedBytes"),
                finalVerificationBytes: number("finalVerificationBytes"),
                finalVerificationPhase: transfer.finalVerificationPhase,
                finalVerificationResourceCount: number("finalVerificationResourceCount"),
                finalVerificationTotalBytes: number("finalVerificationTotalBytes"),
                finalVerificationTotalResourceCount: number("finalVerificationTotalResourceCount"),
                verifiedBytes: number("verifiedBytes"),
              },
              state,
              terminalCause: ui.failure ?? null,
            },
          } as ScaleStreamingInstallRead;
        }),
        signal,
      );
    },
    readRuntime(page: Page, signal?: AbortSignal): Promise<ParallaxTelemetrySnapshot | null> {
      const read = async (): Promise<ParallaxTelemetrySnapshot | null> => {
        const available = await page.evaluate(
          (globalName) => typeof Reflect.get(globalThis, globalName)?.snapshot === "function",
          TELEMETRY_GLOBAL_NAME,
        );
        return available ? readTelemetry(page) : null;
      };
      const operation = read();
      return signal === undefined ? operation : abortable(operation, signal);
    },
    readTraversal: (page: Page) => readTelemetry(page),
    async startStandardTraversal(page: Page): Promise<void> {
      await page.evaluate((globalName) => {
        const telemetry = Reflect.get(globalThis, globalName) as ParallaxTelemetryExport;
        telemetry.startStreamingTraversal();
      }, TELEMETRY_GLOBAL_NAME);
    },
  });
}

export function requireScaleStreamingInstallerAuthority(
  authority: ScaleStreamingInstallerAuthority,
  liveness: ProgressLivenessSnapshot,
  target: MaterializedScaleStreamingTarget,
): void {
  const mismatches = collectScaleStreamingInstallerAuthorityMismatches(authority, liveness, target);
  if (mismatches.length !== 0) {
    throw new Error(
      `Ordinary installer Ready authority mismatches: ${mismatches
        .map(
          ({ actual, expected, field }) =>
            `${field}[expected=${JSON.stringify(expected)},actual=${JSON.stringify(actual)}]`,
        )
        .join(";")}`,
    );
  }
}

export type ScaleStreamingInstallerAuthorityMismatchField =
  | "authority.state"
  | "authority.launchEnabled"
  | "authority.releaseDigest"
  | "authority.shellGenerationId"
  | "authority.persistence"
  | "authority.durabilityClaimed"
  | "authority.persistenceWarning"
  | "liveness.finalVerificationPhase"
  | "liveness.finalVerificationBytes"
  | "liveness.finalVerificationTotalBytes"
  | "liveness.finalVerificationResourceCount"
  | "liveness.finalVerificationTotalResourceCount"
  | "liveness.completedResourceCount";

export interface ScaleStreamingInstallerAuthorityMismatch {
  readonly actual: boolean | number | string | null;
  readonly expected: boolean | number | string | null;
  readonly field: ScaleStreamingInstallerAuthorityMismatchField;
}

export function collectScaleStreamingInstallerAuthorityMismatches(
  authority: ScaleStreamingInstallerAuthority,
  liveness: ProgressLivenessSnapshot,
  target: MaterializedScaleStreamingTarget,
): readonly ScaleStreamingInstallerAuthorityMismatch[] {
  const final = liveness.lastProgressTuple;
  const mismatches: ScaleStreamingInstallerAuthorityMismatch[] = [];
  const add = (
    field: ScaleStreamingInstallerAuthorityMismatchField,
    expected: ScaleStreamingInstallerAuthorityMismatch["expected"],
    actual: ScaleStreamingInstallerAuthorityMismatch["actual"],
  ): void => {
    mismatches.push(Object.freeze({ actual, expected, field }));
  };
  if (authority.state !== "ready") {
    add(
      "authority.state",
      "ready",
      safeCategory(authority.state, [
        "cancelled",
        "cancelling",
        "checking",
        "failed",
        "idle",
        "installing",
        "launched",
        "launching",
        "ready",
        "repairing",
        "requesting-persistence",
      ]),
    );
  }
  if (!authority.launchEnabled) {
    add("authority.launchEnabled", true, safeBoolean(authority.launchEnabled));
  }
  if (authority.releaseDigest !== target.releaseDigest) {
    add(
      "authority.releaseDigest",
      digestDiagnostic(target.releaseDigest),
      digestDiagnostic(authority.releaseDigest),
    );
  }
  const expectedGenerationId = `${target.artifactDigest}:${target.releaseDigest}`;
  if (authority.shellGenerationId !== expectedGenerationId) {
    add(
      "authority.shellGenerationId",
      generationDiagnostic(expectedGenerationId),
      generationDiagnostic(authority.shellGenerationId),
    );
  }
  const persistenceValid =
    authority.persistence === "granted" || authority.persistence === "denied";
  if (!persistenceValid) {
    add(
      "authority.persistence",
      "granted|denied",
      safeCategory(authority.persistence, [
        "denied",
        "failed",
        "granted",
        "not-requested",
        "requesting",
      ]),
    );
  } else {
    const expectedDurability = authority.persistence === "granted";
    if (authority.durabilityClaimed !== expectedDurability) {
      add(
        "authority.durabilityClaimed",
        expectedDurability,
        safeBoolean(authority.durabilityClaimed),
      );
    }
    const expectedWarning =
      authority.persistence === "granted" ? null : "degraded-durability-warning";
    if (
      authority.persistenceWarning !==
      (authority.persistence === "granted" ? null : DEGRADED_DURABILITY_WARNING)
    ) {
      add(
        "authority.persistenceWarning",
        expectedWarning,
        persistenceWarningDiagnostic(authority.persistenceWarning),
      );
    }
  }
  if (final.finalVerificationPhase !== "complete") {
    add(
      "liveness.finalVerificationPhase",
      "complete",
      safeCategory(final.finalVerificationPhase, ["complete", "idle", "verifying"]),
    );
  }
  if (final.finalVerificationBytes !== target.population.installBytes) {
    add(
      "liveness.finalVerificationBytes",
      target.population.installBytes,
      safeCount(final.finalVerificationBytes),
    );
  }
  if (final.finalVerificationTotalBytes !== target.population.installBytes) {
    add(
      "liveness.finalVerificationTotalBytes",
      target.population.installBytes,
      safeCount(final.finalVerificationTotalBytes),
    );
  }
  if (final.finalVerificationResourceCount !== target.population.installResourceCount) {
    add(
      "liveness.finalVerificationResourceCount",
      target.population.installResourceCount,
      safeCount(final.finalVerificationResourceCount),
    );
  }
  if (final.finalVerificationTotalResourceCount !== target.population.installResourceCount) {
    add(
      "liveness.finalVerificationTotalResourceCount",
      target.population.installResourceCount,
      safeCount(final.finalVerificationTotalResourceCount),
    );
  }
  if (final.completedResourceCount !== target.population.installResourceCount) {
    add(
      "liveness.completedResourceCount",
      target.population.installResourceCount,
      safeCount(final.completedResourceCount),
    );
  }
  return Object.freeze(mismatches);
}

function digestDiagnostic(value: string | null): string | null {
  return value === null
    ? null
    : /^[a-f0-9]{64}$/u.test(value)
      ? `sha256:${value.slice(0, 12)}`
      : "<invalid>";
}

function generationDiagnostic(value: string | null): string | null {
  if (value === null) return null;
  const match = /^([a-f0-9]{64}):([a-f0-9]{64})$/u.exec(value);
  return match === null
    ? "<invalid>"
    : `generation:${match[1]?.slice(0, 12)}:${match[2]?.slice(0, 12)}`;
}

function persistenceWarningDiagnostic(value: string | null): string | null {
  if (value === null) return null;
  return value === DEGRADED_DURABILITY_WARNING ? "degraded-durability-warning" : "<other-non-null>";
}

function nonNullDiagnostic(value: unknown): string | null {
  return value === null ? null : "<non-null>";
}

function safeBoolean(value: unknown): boolean | string {
  return typeof value === "boolean" ? value : "<invalid>";
}

function safeCategory(value: unknown, allowed: readonly string[]): string | null {
  if (value === null) return null;
  return typeof value === "string" && allowed.includes(value) ? value : "<invalid>";
}

function safeCount(value: unknown): number | string {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : "<invalid>";
}

function safeInteger(value: unknown): number | string {
  return Number.isSafeInteger(value) ? Number(value) : "<invalid>";
}

function safeFinite(value: unknown): number | string {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= Number.MAX_SAFE_INTEGER
    ? value
    : "<invalid>";
}

const requireInstallerAuthority = requireScaleStreamingInstallerAuthority;

export function requireScaleStreamingRuntimeAuthority(
  snapshot: ParallaxTelemetrySnapshot,
  authority: ScaleStreamingInstallerAuthority,
  target: MaterializedScaleStreamingTarget,
): void {
  const mismatches = collectScaleStreamingRuntimeAuthorityMismatches(snapshot, authority, target);
  if (mismatches.length !== 0) {
    throw new Error(
      `Launched runtime authority mismatches: ${formatRuntimeAuthorityMismatches(mismatches)}`,
    );
  }
}

export type ScaleStreamingRuntimeAuthorityMismatchField =
  | "installStore.state"
  | "installStore.activeReleaseDigest"
  | "installStore.currentReleaseDigest"
  | "installStore.currentResourceId"
  | "installStore.failureMessage"
  | "installStore.partialBytes"
  | "installStore.partialResourceCount"
  | "installStore.garbageCollectionRemaining"
  | "installStore.finalVerificationPhase"
  | "installStore.finalVerificationBytes"
  | "installStore.finalVerificationTotalBytes"
  | "installStore.finalVerificationResourceCount"
  | "installStore.finalVerificationTotalResourceCount"
  | "installerTransfer.activeReleaseDigest"
  | "installerTransfer.state"
  | "installerTransfer.failureMessage"
  | "installerTransfer.finalVerificationPhase"
  | "installerTransfer.finalVerificationBytes"
  | "installerTransfer.finalVerificationTotalBytes"
  | "installerTransfer.finalVerificationResourceCount"
  | "installerTransfer.finalVerificationTotalResourceCount"
  | "installerTransfer.totalBytes"
  | "installerTransfer.resourceCount"
  | "offlineShell.state"
  | "offlineShell.activeArtifactDigest"
  | "offlineShell.activeReleaseDigest"
  | "offlineShell.activeGenerationId"
  | "offlineShell.failureCode"
  | "offlineShell.failureMessage"
  | "offlineShell.mixedGenerationCount"
  | "installedModelSource.state"
  | "installedModelSource.releaseDigest"
  | "installedModelSource.resolvedArtifactCount"
  | "installedModelSource.resolvedArtifactBytes"
  | "streaming.installedReleaseDigest"
  | "streaming.legacyNetworkRequestCount"
  | "streaming.installedResourceCount"
  | "streaming.installedResourceBytes";

export interface ScaleStreamingRuntimeAuthorityMismatch {
  readonly actual: boolean | number | string | null;
  readonly expected: boolean | number | string | null;
  readonly field: ScaleStreamingRuntimeAuthorityMismatchField;
}

function formatRuntimeAuthorityMismatches(
  mismatches: readonly ScaleStreamingRuntimeAuthorityMismatch[],
): string {
  return mismatches
    .map(
      ({ actual, expected, field }) =>
        `${field}[expected=${JSON.stringify(expected)},actual=${JSON.stringify(actual)}]`,
    )
    .join(";");
}

export function collectScaleStreamingRuntimeAuthorityMismatches(
  snapshot: ParallaxTelemetrySnapshot,
  authority: ScaleStreamingInstallerAuthority,
  target: MaterializedScaleStreamingTarget,
): readonly ScaleStreamingRuntimeAuthorityMismatch[] {
  const expectedReleaseDigest = target.releaseDigest;
  const mismatches: ScaleStreamingRuntimeAuthorityMismatch[] = [];
  const add = (
    field: ScaleStreamingRuntimeAuthorityMismatchField,
    expected: ScaleStreamingRuntimeAuthorityMismatch["expected"],
    actual: ScaleStreamingRuntimeAuthorityMismatch["actual"],
  ): void => {
    mismatches.push(Object.freeze({ actual, expected, field }));
  };
  if (snapshot.installStore.state !== "ready") {
    add(
      "installStore.state",
      "ready",
      safeCategory(snapshot.installStore.state, [
        "failed",
        "garbage-collecting",
        "idle",
        "publishing",
        "ready",
        "reconciling",
        "staging",
        "unavailable",
        "verifying",
        "writing",
      ]),
    );
  }
  if (snapshot.installStore.activeReleaseDigest !== expectedReleaseDigest) {
    add(
      "installStore.activeReleaseDigest",
      digestDiagnostic(expectedReleaseDigest),
      digestDiagnostic(snapshot.installStore.activeReleaseDigest),
    );
  }
  if (snapshot.installStore.currentReleaseDigest !== null) {
    add(
      "installStore.currentReleaseDigest",
      null,
      digestDiagnostic(snapshot.installStore.currentReleaseDigest),
    );
  }
  if (snapshot.installStore.currentResourceId !== null) {
    add(
      "installStore.currentResourceId",
      null,
      nonNullDiagnostic(snapshot.installStore.currentResourceId),
    );
  }
  if (snapshot.installStore.failureMessage !== null) {
    add(
      "installStore.failureMessage",
      null,
      nonNullDiagnostic(snapshot.installStore.failureMessage),
    );
  }
  if (snapshot.installStore.partialBytes !== 0) {
    add("installStore.partialBytes", 0, safeCount(snapshot.installStore.partialBytes));
  }
  if (snapshot.installStore.partialResourceCount !== 0) {
    add(
      "installStore.partialResourceCount",
      0,
      safeCount(snapshot.installStore.partialResourceCount),
    );
  }
  if (snapshot.installStore.garbageCollectionRemaining) {
    add(
      "installStore.garbageCollectionRemaining",
      false,
      safeBoolean(snapshot.installStore.garbageCollectionRemaining),
    );
  }
  if (snapshot.installStore.finalVerificationPhase !== "complete") {
    add(
      "installStore.finalVerificationPhase",
      "complete",
      safeCategory(snapshot.installStore.finalVerificationPhase, ["complete", "idle", "verifying"]),
    );
  }
  if (snapshot.installStore.finalVerificationBytes !== target.population.installBytes) {
    add(
      "installStore.finalVerificationBytes",
      target.population.installBytes,
      safeCount(snapshot.installStore.finalVerificationBytes),
    );
  }
  if (snapshot.installStore.finalVerificationTotalBytes !== target.population.installBytes) {
    add(
      "installStore.finalVerificationTotalBytes",
      target.population.installBytes,
      safeCount(snapshot.installStore.finalVerificationTotalBytes),
    );
  }
  if (
    snapshot.installStore.finalVerificationResourceCount !== target.population.installResourceCount
  ) {
    add(
      "installStore.finalVerificationResourceCount",
      target.population.installResourceCount,
      safeCount(snapshot.installStore.finalVerificationResourceCount),
    );
  }
  if (
    snapshot.installStore.finalVerificationTotalResourceCount !==
    target.population.installResourceCount
  ) {
    add(
      "installStore.finalVerificationTotalResourceCount",
      target.population.installResourceCount,
      safeCount(snapshot.installStore.finalVerificationTotalResourceCount),
    );
  }
  if (snapshot.installerTransfer.activeReleaseDigest !== expectedReleaseDigest) {
    add(
      "installerTransfer.activeReleaseDigest",
      digestDiagnostic(expectedReleaseDigest),
      digestDiagnostic(snapshot.installerTransfer.activeReleaseDigest),
    );
  }
  if (snapshot.installerTransfer.state !== "ready") {
    add(
      "installerTransfer.state",
      "ready",
      safeCategory(snapshot.installerTransfer.state, [
        "cancelled",
        "cancelling",
        "disposed",
        "failed",
        "idle",
        "planning",
        "probing-quota",
        "ready",
        "transferring",
        "verifying",
        "waiting-lock",
      ]),
    );
  }
  if (snapshot.installerTransfer.failureMessage !== null) {
    add(
      "installerTransfer.failureMessage",
      null,
      nonNullDiagnostic(snapshot.installerTransfer.failureMessage),
    );
  }
  if (snapshot.installerTransfer.finalVerificationPhase !== "complete") {
    add(
      "installerTransfer.finalVerificationPhase",
      "complete",
      safeCategory(snapshot.installerTransfer.finalVerificationPhase, [
        "complete",
        "idle",
        "verifying",
      ]),
    );
  }
  if (snapshot.installerTransfer.finalVerificationBytes !== target.population.installBytes) {
    add(
      "installerTransfer.finalVerificationBytes",
      target.population.installBytes,
      safeCount(snapshot.installerTransfer.finalVerificationBytes),
    );
  }
  if (snapshot.installerTransfer.finalVerificationTotalBytes !== target.population.installBytes) {
    add(
      "installerTransfer.finalVerificationTotalBytes",
      target.population.installBytes,
      safeCount(snapshot.installerTransfer.finalVerificationTotalBytes),
    );
  }
  if (
    snapshot.installerTransfer.finalVerificationResourceCount !==
    target.population.installResourceCount
  ) {
    add(
      "installerTransfer.finalVerificationResourceCount",
      target.population.installResourceCount,
      safeCount(snapshot.installerTransfer.finalVerificationResourceCount),
    );
  }
  if (
    snapshot.installerTransfer.finalVerificationTotalResourceCount !==
    target.population.installResourceCount
  ) {
    add(
      "installerTransfer.finalVerificationTotalResourceCount",
      target.population.installResourceCount,
      safeCount(snapshot.installerTransfer.finalVerificationTotalResourceCount),
    );
  }
  if (snapshot.installerTransfer.totalBytes !== target.population.installBytes) {
    add(
      "installerTransfer.totalBytes",
      target.population.installBytes,
      safeCount(snapshot.installerTransfer.totalBytes),
    );
  }
  if (snapshot.installerTransfer.resourceCount !== target.population.installResourceCount) {
    add(
      "installerTransfer.resourceCount",
      target.population.installResourceCount,
      safeCount(snapshot.installerTransfer.resourceCount),
    );
  }
  if (snapshot.offlineShell.state !== "active") {
    add(
      "offlineShell.state",
      "active",
      safeCategory(snapshot.offlineShell.state, [
        "active",
        "failed",
        "idle",
        "preparing",
        "rolling-back",
        "unavailable",
        "verifying",
      ]),
    );
  }
  if (snapshot.offlineShell.activeArtifactDigest !== target.artifactDigest) {
    add(
      "offlineShell.activeArtifactDigest",
      digestDiagnostic(target.artifactDigest),
      digestDiagnostic(snapshot.offlineShell.activeArtifactDigest),
    );
  }
  if (snapshot.offlineShell.activeReleaseDigest !== expectedReleaseDigest) {
    add(
      "offlineShell.activeReleaseDigest",
      digestDiagnostic(expectedReleaseDigest),
      digestDiagnostic(snapshot.offlineShell.activeReleaseDigest),
    );
  }
  if (snapshot.offlineShell.activeGenerationId !== authority.shellGenerationId) {
    add(
      "offlineShell.activeGenerationId",
      generationDiagnostic(authority.shellGenerationId),
      generationDiagnostic(snapshot.offlineShell.activeGenerationId),
    );
  }
  if (snapshot.offlineShell.failureCode !== null) {
    add(
      "offlineShell.failureCode",
      null,
      safeCategory(snapshot.offlineShell.failureCode, [
        "shell-contract",
        "shell-release-mismatch",
        "shell-unavailable",
      ]),
    );
  }
  if (snapshot.offlineShell.failureMessage !== null) {
    add(
      "offlineShell.failureMessage",
      null,
      nonNullDiagnostic(snapshot.offlineShell.failureMessage),
    );
  }
  if (snapshot.offlineShell.mixedGenerationCount !== 0) {
    add(
      "offlineShell.mixedGenerationCount",
      0,
      safeCount(snapshot.offlineShell.mixedGenerationCount),
    );
  }
  if (snapshot.installedModelSource.state !== "ready") {
    add(
      "installedModelSource.state",
      "ready",
      safeCategory(snapshot.installedModelSource.state, [
        "failed",
        "idle",
        "ready",
        "resolving",
        "unavailable",
      ]),
    );
  }
  if (snapshot.installedModelSource.releaseDigest !== expectedReleaseDigest) {
    add(
      "installedModelSource.releaseDigest",
      digestDiagnostic(expectedReleaseDigest),
      digestDiagnostic(snapshot.installedModelSource.releaseDigest),
    );
  }
  if (
    snapshot.installedModelSource.resolvedArtifactCount !==
    APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.length
  ) {
    add(
      "installedModelSource.resolvedArtifactCount",
      APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.length,
      safeCount(snapshot.installedModelSource.resolvedArtifactCount),
    );
  }
  if (
    snapshot.installedModelSource.resolvedArtifactBytes !== APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES
  ) {
    add(
      "installedModelSource.resolvedArtifactBytes",
      APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
      safeCount(snapshot.installedModelSource.resolvedArtifactBytes),
    );
  }
  if (snapshot.streaming.installedReleaseDigest !== expectedReleaseDigest) {
    add(
      "streaming.installedReleaseDigest",
      digestDiagnostic(expectedReleaseDigest),
      digestDiagnostic(snapshot.streaming.installedReleaseDigest),
    );
  }
  if (snapshot.streaming.legacyNetworkRequestCount !== 0) {
    add(
      "streaming.legacyNetworkRequestCount",
      0,
      safeCount(snapshot.streaming.legacyNetworkRequestCount),
    );
  }
  if (snapshot.streaming.installedResourceCount !== target.population.representativeResourceCount) {
    add(
      "streaming.installedResourceCount",
      target.population.representativeResourceCount,
      safeCount(snapshot.streaming.installedResourceCount),
    );
  }
  if (snapshot.streaming.installedResourceBytes !== target.population.representativeBytes) {
    add(
      "streaming.installedResourceBytes",
      target.population.representativeBytes,
      safeCount(snapshot.streaming.installedResourceBytes),
    );
  }
  return Object.freeze(mismatches);
}

const requireRuntimeAuthority = requireScaleStreamingRuntimeAuthority;

export function requireScaleStreamingTraversal(
  end: ReturnType<typeof requireStreamingEvidence>,
  start: WorldStreamingTelemetrySnapshot,
): ScaleStreamingTraversalReuseSummary {
  const evaluation = evaluateScaleStreamingTraversal(end, start);
  if (evaluation.mismatches.length !== 0) {
    throw new Error(
      `Representative traversal mismatches: ${formatTraversalMismatches(evaluation.mismatches)}`,
    );
  }
  return Object.freeze({
    decodeAcquireDelta: evaluation.decode.acquireDelta,
    decodeHitDelta: evaluation.decode.hitDelta,
    decodeMissDelta: evaluation.decode.missDelta,
    decodeReleaseDelta: evaluation.decode.releaseDelta,
    gpuAcquireDelta: evaluation.gpu.acquireDelta,
    gpuHitDelta: evaluation.gpu.hitDelta,
    gpuMissDelta: evaluation.gpu.missDelta,
    gpuReleaseDelta: evaluation.gpu.releaseDelta,
    psoWarmupGameplayOverlapCount: 0,
  });
}

const requireRepresentativeStreaming = requireScaleStreamingTraversal;

type ScaleStreamingTraversalCacheMismatchField = `${"dependencyCache" | "dependencyGpuCache"}.${
  | "available"
  | "resources"
  | "endAcquireConservation"
  | "acquireMonotonic"
  | "hitMonotonic"
  | "missMonotonic"
  | "releaseMonotonic"
  | "acquireDelta"
  | "deltaConservation"
  | "hitDelta"
  | "releaseDelta"
  | "releaseConservation"
  | "liveResourceCount"
  | "liveRefCount"
  | "liveEncodedBytes"
  | "liveDecodedBytes"
  | "liveOwnedBytes"
  | "resourceCacheKey"
  | "resourceId"
  | "resourceOwnedBytes"
  | "resourceRefCount"
  | "cacheKeyCount"
  | "formatCount"}`;

export type ScaleStreamingTraversalMismatchField =
  | "cellLoadP95Ms"
  | "measurementProactiveEvictionCount"
  | "dependencyDecodeFailureCount"
  | "dependencyDecodedBytes"
  | "dependencyEncodedBytesRead"
  | "dependencyReadCount"
  | "dependencyUploadBytes"
  | "dependencyUploadCount"
  | "measurementCellLoadSamples.attribution"
  | "psoWarmupGameplayOverlapCount"
  | "phase.decodeAcquireVsSampleDependencyCount"
  | "phase.gpuAcquireVsSampleDependencyCount"
  | "phase.readCountDeltaVsDecodeMissDelta"
  | "phase.encodedBytesDeltaVsSampleBytes"
  | "phase.decodedBytesDeltaVsSampleBytes"
  | "phase.uploadCountDeltaVsGpuMissDelta"
  | "phase.uploadBytesDeltaVsSampleBytes"
  | ScaleStreamingTraversalCacheMismatchField;

export interface ScaleStreamingTraversalMismatch {
  readonly actual: boolean | number | string | null;
  readonly expected: boolean | number | string | null;
  readonly field: ScaleStreamingTraversalMismatchField;
}

interface ScaleStreamingCacheDeltas {
  readonly acquireDelta: number;
  readonly hitDelta: number;
  readonly missDelta: number;
  readonly releaseDelta: number;
}

interface ScaleStreamingTraversalEvaluation {
  readonly decode: ScaleStreamingCacheDeltas;
  readonly gpu: ScaleStreamingCacheDeltas;
  readonly mismatches: readonly ScaleStreamingTraversalMismatch[];
}

export function collectScaleStreamingTraversalMismatches(
  end: ReturnType<typeof requireStreamingEvidence>,
  start: WorldStreamingTelemetrySnapshot,
): readonly ScaleStreamingTraversalMismatch[] {
  return evaluateScaleStreamingTraversal(end, start).mismatches;
}

function evaluateScaleStreamingTraversal(
  end: ReturnType<typeof requireStreamingEvidence>,
  start: WorldStreamingTelemetrySnapshot,
): ScaleStreamingTraversalEvaluation {
  const mismatches: ScaleStreamingTraversalMismatch[] = [];
  const add = (
    field: ScaleStreamingTraversalMismatchField,
    expected: ScaleStreamingTraversalMismatch["expected"],
    actual: ScaleStreamingTraversalMismatch["actual"],
  ): void => {
    mismatches.push(Object.freeze({ actual, expected, field }));
  };
  if (!nonNegativeFinite(end.cellLoadP95Ms) || end.cellLoadP95Ms > STREAMING_CELL_LOAD_BUDGET_MS) {
    add("cellLoadP95Ms", `<=${STREAMING_CELL_LOAD_BUDGET_MS}`, safeFinite(end.cellLoadP95Ms));
  }
  if (!positiveInteger(end.measurementProactiveEvictionCount)) {
    add(
      "measurementProactiveEvictionCount",
      ">0",
      safeCount(end.measurementProactiveEvictionCount),
    );
  }
  if (end.dependencyDecodeFailureCount !== 0) {
    add("dependencyDecodeFailureCount", 0, safeCount(end.dependencyDecodeFailureCount));
  }
  for (const [field, value] of [
    ["dependencyDecodedBytes", end.dependencyDecodedBytes],
    ["dependencyEncodedBytesRead", end.dependencyEncodedBytesRead],
    ["dependencyReadCount", end.dependencyReadCount],
    ["dependencyUploadBytes", end.dependencyUploadBytes],
    ["dependencyUploadCount", end.dependencyUploadCount],
  ] as const) {
    if (!positiveInteger(value)) add(field, ">0", safeCount(value));
  }
  if (
    end.measurementCellLoadSamples.some(
      (sample) => !validScaleStreamingPipelineSample(sample, "traversal"),
    )
  ) {
    add("measurementCellLoadSamples.attribution", true, false);
  }
  if (end.psoWarmupGameplayOverlapCount !== 0) {
    add("psoWarmupGameplayOverlapCount", 0, safeCount(end.psoWarmupGameplayOverlapCount));
  }
  const decode = collectTraversalCacheMismatches(
    "dependencyCache",
    end.dependencyCache,
    start.dependencyCache,
    add,
  );
  const gpu = collectTraversalCacheMismatches(
    "dependencyGpuCache",
    end.dependencyGpuCache,
    start.dependencyGpuCache,
    add,
  );
  collectTraversalPhaseMismatches(end, start, decode, gpu, add);
  return Object.freeze({ decode, gpu, mismatches: Object.freeze(mismatches) });
}

type ScaleStreamingHydrationCacheMismatchField = `${"dependencyCache" | "dependencyGpuCache"}.${
  | "available"
  | "acquireCount"
  | "missCount"
  | "liveResourceCount"
  | "liveRefCount"
  | "liveOwnedBytes"
  | "formatCount"}`;

export type ScaleStreamingHydrationMismatchField =
  | "dependencyDecodeFailureCount"
  | "dependencyDecodedBytes"
  | "dependencyEncodedBytesRead"
  | "dependencyReadCount"
  | "dependencyUploadBytes"
  | "dependencyUploadCount"
  | "cellLoadSamples.sampleLimit"
  | "cellLoadSamples.retainedCount"
  | "cellLoadSamples.attribution"
  | "cellLoadSamples.readContribution"
  | "cellLoadSamples.decodeContribution"
  | "cellLoadSamples.uploadContribution"
  | "cellLoadSamples.encodedBytes"
  | "cellLoadSamples.decodedBytes"
  | "cellLoadSamples.uploadBytes"
  | "decodeQueueDepthHighWater"
  | "renderBatchCellCountHighWater"
  | "psoWarmupGameplayOverlapCount"
  | ScaleStreamingHydrationCacheMismatchField;

export interface ScaleStreamingHydrationMismatch {
  readonly actual: boolean | number | string | null;
  readonly expected: boolean | number | string | null;
  readonly field: ScaleStreamingHydrationMismatchField;
}

export function collectScaleStreamingHydrationMismatches(
  snapshot: WorldStreamingTelemetrySnapshot,
): readonly ScaleStreamingHydrationMismatch[] {
  const mismatches: ScaleStreamingHydrationMismatch[] = [];
  const add = (
    field: ScaleStreamingHydrationMismatchField,
    expected: ScaleStreamingHydrationMismatch["expected"],
    actual: ScaleStreamingHydrationMismatch["actual"],
  ): void => {
    mismatches.push(Object.freeze({ actual, expected, field }));
  };
  const positiveCounters = [
    ["dependencyDecodedBytes", snapshot.dependencyDecodedBytes],
    ["dependencyEncodedBytesRead", snapshot.dependencyEncodedBytesRead],
    ["dependencyReadCount", snapshot.dependencyReadCount],
    ["dependencyUploadBytes", snapshot.dependencyUploadBytes],
    ["dependencyUploadCount", snapshot.dependencyUploadCount],
  ] as const;
  if (snapshot.dependencyDecodeFailureCount !== 0) {
    add("dependencyDecodeFailureCount", 0, safeCount(snapshot.dependencyDecodeFailureCount));
  }
  for (const [field, value] of positiveCounters) {
    if (!positiveInteger(value)) add(field, ">0", safeCount(value));
  }
  if (snapshot.cellLoadSampleCount > SCALE_STREAMING_INITIAL_SAMPLE_LIMIT) {
    add(
      "cellLoadSamples.sampleLimit",
      `<=${SCALE_STREAMING_INITIAL_SAMPLE_LIMIT}`,
      safeCount(snapshot.cellLoadSampleCount),
    );
  }
  if (snapshot.cellLoadSamples.length !== snapshot.cellLoadSampleCount) {
    add(
      "cellLoadSamples.retainedCount",
      safeCount(snapshot.cellLoadSampleCount),
      snapshot.cellLoadSamples.length,
    );
  }
  const dependencySamples = snapshot.cellLoadSamples.filter(({ dependencyCount }) =>
    positiveInteger(dependencyCount),
  );
  if (
    snapshot.cellLoadSamples.some(
      (sample) => !validScaleStreamingPipelineSample(sample, "hydration"),
    )
  ) {
    add("cellLoadSamples.attribution", true, false);
  }
  const sampleSums = dependencySamples.reduce(
    (sums, sample) => ({
      decodedBytes: sums.decodedBytes + (sample.dependencyDecodedBytes ?? 0),
      encodedBytes: sums.encodedBytes + (sample.dependencyEncodedBytes ?? 0),
      uploadBytes: sums.uploadBytes + (sample.dependencyUploadBytes ?? 0),
    }),
    { decodedBytes: 0, encodedBytes: 0, uploadBytes: 0 },
  );
  if (sampleSums.encodedBytes <= 0) add("cellLoadSamples.readContribution", ">0", 0);
  if (sampleSums.decodedBytes <= 0) add("cellLoadSamples.decodeContribution", ">0", 0);
  if (sampleSums.uploadBytes <= 0) add("cellLoadSamples.uploadContribution", ">0", 0);
  if (sampleSums.encodedBytes !== snapshot.dependencyEncodedBytesRead) {
    add(
      "cellLoadSamples.encodedBytes",
      safeCount(snapshot.dependencyEncodedBytesRead),
      safeCount(sampleSums.encodedBytes),
    );
  }
  if (sampleSums.decodedBytes !== snapshot.dependencyDecodedBytes) {
    add(
      "cellLoadSamples.decodedBytes",
      safeCount(snapshot.dependencyDecodedBytes),
      safeCount(sampleSums.decodedBytes),
    );
  }
  if (sampleSums.uploadBytes !== snapshot.dependencyUploadBytes) {
    add(
      "cellLoadSamples.uploadBytes",
      safeCount(snapshot.dependencyUploadBytes),
      safeCount(sampleSums.uploadBytes),
    );
  }
  if (snapshot.decodeQueueDepthHighWater < snapshot.decodeWorkerCount) {
    add(
      "decodeQueueDepthHighWater",
      `>=${safeCount(snapshot.decodeWorkerCount)}`,
      safeCount(snapshot.decodeQueueDepthHighWater),
    );
  }
  if (snapshot.renderBatchCellCountHighWater <= 1) {
    add("renderBatchCellCountHighWater", ">1", safeCount(snapshot.renderBatchCellCountHighWater));
  }
  if (snapshot.psoWarmupGameplayOverlapCount !== 0) {
    add("psoWarmupGameplayOverlapCount", 0, safeCount(snapshot.psoWarmupGameplayOverlapCount));
  }
  collectHydrationCacheMismatches("dependencyCache", snapshot.dependencyCache, add);
  collectHydrationCacheMismatches("dependencyGpuCache", snapshot.dependencyGpuCache, add);
  return Object.freeze(mismatches);
}

function collectHydrationCacheMismatches(
  prefix: "dependencyCache" | "dependencyGpuCache",
  cache: StreamingResourceCacheTelemetry | undefined,
  add: (
    field: ScaleStreamingHydrationMismatchField,
    expected: ScaleStreamingHydrationMismatch["expected"],
    actual: ScaleStreamingHydrationMismatch["actual"],
  ) => void,
): void {
  if (cache === undefined) {
    add(`${prefix}.available`, "present", "absent");
    return;
  }
  const expectedAcquireCount = cache.hitCount + cache.missCount;
  if (cache.acquireCount !== expectedAcquireCount) {
    add(`${prefix}.acquireCount`, safeCount(expectedAcquireCount), safeCount(cache.acquireCount));
  }
  if (cache.missCount <= 0) {
    add(`${prefix}.missCount`, ">0", safeCount(cache.missCount));
  }
  if (cache.liveResourceCount !== cache.resources.length) {
    add(`${prefix}.liveResourceCount`, cache.resources.length, safeCount(cache.liveResourceCount));
  }
  const expectedRefCount = cache.resources.reduce((sum, resource) => sum + resource.refCount, 0);
  if (cache.liveRefCount !== expectedRefCount) {
    add(`${prefix}.liveRefCount`, safeCount(expectedRefCount), safeCount(cache.liveRefCount));
  }
  const actualOwnedBytes = cache.liveEncodedBytes + cache.liveDecodedBytes;
  const expectedOwnedBytes = cache.resources.reduce(
    (sum, resource) => sum + resource.ownedBytes,
    0,
  );
  if (actualOwnedBytes !== expectedOwnedBytes) {
    add(`${prefix}.liveOwnedBytes`, safeCount(expectedOwnedBytes), safeCount(actualOwnedBytes));
  }
  const formatCount = new Set(cache.resources.map(({ format }) => format)).size;
  if (formatCount !== 2) add(`${prefix}.formatCount`, 2, formatCount);
}

function formatHydrationMismatches(mismatches: readonly ScaleStreamingHydrationMismatch[]): string {
  return mismatches
    .map(
      ({ actual, expected, field }) =>
        `${field}[expected=${JSON.stringify(expected)},actual=${JSON.stringify(actual)}]`,
    )
    .join(";");
}

export function requireScaleStreamingHydration(
  snapshot: WorldStreamingTelemetrySnapshot,
): ScaleStreamingPipelineSummary {
  const mismatches = collectScaleStreamingHydrationMismatches(snapshot);
  if (mismatches.length !== 0) {
    throw new Error(
      `Initial representative hydration mismatches: ${formatHydrationMismatches(mismatches)}`,
    );
  }
  const psoWarmupGameplayOverlapCount = snapshot.psoWarmupGameplayOverlapCount;
  if (psoWarmupGameplayOverlapCount !== 0) {
    throw new Error("Initial representative hydration changed after validation");
  }
  return Object.freeze({
    decodeCacheMissCount: snapshot.dependencyCache?.missCount ?? 0,
    decodeQueueDepthHighWater: snapshot.decodeQueueDepthHighWater,
    decodeWorkerCount: snapshot.decodeWorkerCount,
    decodedBytes: snapshot.dependencyDecodedBytes ?? 0,
    encodedBytesRead: snapshot.dependencyEncodedBytesRead ?? 0,
    gpuCacheMissCount: snapshot.dependencyGpuCache?.missCount ?? 0,
    psoWarmupGameplayOverlapCount,
    readCount: snapshot.dependencyReadCount ?? 0,
    renderBatchCellCountHighWater: snapshot.renderBatchCellCountHighWater,
    uploadBytes: snapshot.dependencyUploadBytes ?? 0,
    uploadCount: snapshot.dependencyUploadCount ?? 0,
  });
}

const requireRepresentativeHydration = requireScaleStreamingHydration;

function collectTraversalCacheMismatches(
  prefix: "dependencyCache" | "dependencyGpuCache",
  end: StreamingResourceCacheTelemetry | undefined,
  start: StreamingResourceCacheTelemetry | undefined,
  add: (
    field: ScaleStreamingTraversalMismatchField,
    expected: ScaleStreamingTraversalMismatch["expected"],
    actual: ScaleStreamingTraversalMismatch["actual"],
  ) => void,
): ScaleStreamingCacheDeltas {
  if (end === undefined || start === undefined) {
    add(`${prefix}.available`, "start-and-end", end === undefined ? "end-absent" : "start-absent");
    return Object.freeze({ acquireDelta: 0, hitDelta: 0, missDelta: 0, releaseDelta: 0 });
  }
  const acquireDelta = end.acquireCount - start.acquireCount;
  const hitDelta = end.hitCount - start.hitCount;
  const missDelta = end.missCount - start.missCount;
  const releaseDelta = end.releaseCount - start.releaseCount;
  if (end.acquireCount !== end.hitCount + end.missCount) {
    add(
      `${prefix}.endAcquireConservation`,
      safeInteger(end.hitCount + end.missCount),
      safeCount(end.acquireCount),
    );
  }
  for (const [field, endValue, startValue] of [
    ["acquireMonotonic", end.acquireCount, start.acquireCount],
    ["hitMonotonic", end.hitCount, start.hitCount],
    ["missMonotonic", end.missCount, start.missCount],
    ["releaseMonotonic", end.releaseCount, start.releaseCount],
  ] as const) {
    if (endValue < startValue) {
      add(`${prefix}.${field}`, `>=${safeCount(startValue)}`, safeCount(endValue));
    }
  }
  if (acquireDelta <= 0) add(`${prefix}.acquireDelta`, ">0", safeInteger(acquireDelta));
  if (acquireDelta !== hitDelta + missDelta) {
    add(
      `${prefix}.deltaConservation`,
      safeInteger(hitDelta + missDelta),
      safeInteger(acquireDelta),
    );
  }
  if (hitDelta <= 0) add(`${prefix}.hitDelta`, ">0", safeInteger(hitDelta));
  if (releaseDelta <= 0) add(`${prefix}.releaseDelta`, ">0", safeInteger(releaseDelta));
  if (releaseDelta !== acquireDelta) {
    add(`${prefix}.releaseConservation`, safeInteger(acquireDelta), safeInteger(releaseDelta));
  }
  const resources = Array.isArray(end.resources) ? end.resources : [];
  if (!Array.isArray(end.resources)) add(`${prefix}.resources`, "array", "<invalid>");
  if (end.liveResourceCount !== resources.length) {
    add(`${prefix}.liveResourceCount`, resources.length, safeCount(end.liveResourceCount));
  }
  const expectedRefCount = resources.reduce((sum, resource) => sum + resource.refCount, 0);
  if (end.liveRefCount !== expectedRefCount) {
    add(`${prefix}.liveRefCount`, safeInteger(expectedRefCount), safeCount(end.liveRefCount));
  }
  const expectedOwnedBytes = resources.reduce((sum, resource) => sum + resource.ownedBytes, 0);
  const actualOwnedBytes = end.liveEncodedBytes + end.liveDecodedBytes;
  if (prefix === "dependencyCache" && end.liveEncodedBytes !== 0) {
    add(`${prefix}.liveEncodedBytes`, 0, safeCount(end.liveEncodedBytes));
  }
  if (prefix === "dependencyCache" && end.liveDecodedBytes !== 0) {
    add(`${prefix}.liveDecodedBytes`, 0, safeCount(end.liveDecodedBytes));
  }
  if (actualOwnedBytes !== expectedOwnedBytes) {
    add(`${prefix}.liveOwnedBytes`, safeInteger(expectedOwnedBytes), safeInteger(actualOwnedBytes));
  }
  if (resources.some(({ cacheKey }) => cacheKey === "")) {
    add(`${prefix}.resourceCacheKey`, "non-empty", "<empty>");
  }
  if (resources.some(({ resourceId }) => resourceId === "")) {
    add(`${prefix}.resourceId`, "non-empty", "<empty>");
  }
  const invalidOwnedResource = resources.find(
    ({ ownedBytes }) =>
      !validScaleStreamingResourceOwnedBytes(
        ownedBytes,
        prefix === "dependencyCache" ? "decode" : "gpu",
      ),
  );
  if (invalidOwnedResource !== undefined) {
    add(
      `${prefix}.resourceOwnedBytes`,
      prefix === "dependencyCache" ? 0 : ">0 integer",
      safeInteger(invalidOwnedResource.ownedBytes),
    );
  }
  if (resources.some(({ refCount }) => !positiveInteger(refCount))) {
    add(`${prefix}.resourceRefCount`, ">0 integer", false);
  }
  const cacheKeyCount = new Set(resources.map(({ cacheKey }) => cacheKey)).size;
  if (cacheKeyCount !== resources.length) {
    add(`${prefix}.cacheKeyCount`, resources.length, cacheKeyCount);
  }
  const formatCount = new Set(resources.map(({ format }) => format)).size;
  if (formatCount !== 2) add(`${prefix}.formatCount`, 2, formatCount);
  return Object.freeze({ acquireDelta, hitDelta, missDelta, releaseDelta });
}

function collectTraversalPhaseMismatches(
  end: ReturnType<typeof requireStreamingEvidence>,
  start: WorldStreamingTelemetrySnapshot,
  decode: ScaleStreamingCacheDeltas,
  gpu: ScaleStreamingCacheDeltas,
  add: (
    field: ScaleStreamingTraversalMismatchField,
    expected: ScaleStreamingTraversalMismatch["expected"],
    actual: ScaleStreamingTraversalMismatch["actual"],
  ) => void,
): void {
  const sum = (
    select: (sample: (typeof end.measurementCellLoadSamples)[number]) => number,
  ): number => end.measurementCellLoadSamples.reduce((total, sample) => total + select(sample), 0);
  const sampleDependencyCount = sum((sample) => sample.dependencyCount ?? 0);
  const sampleEncodedBytes = sum((sample) => sample.dependencyEncodedBytes ?? 0);
  const sampleDecodedBytes = sum((sample) => sample.dependencyDecodedBytes ?? 0);
  const sampleUploadBytes = sum((sample) => sample.dependencyUploadBytes ?? 0);
  const readCountDelta = (end.dependencyReadCount ?? 0) - (start.dependencyReadCount ?? 0);
  const encodedBytesDelta =
    (end.dependencyEncodedBytesRead ?? 0) - (start.dependencyEncodedBytesRead ?? 0);
  const decodedBytesDelta = (end.dependencyDecodedBytes ?? 0) - (start.dependencyDecodedBytes ?? 0);
  const uploadCountDelta = (end.dependencyUploadCount ?? 0) - (start.dependencyUploadCount ?? 0);
  const uploadBytesDelta = (end.dependencyUploadBytes ?? 0) - (start.dependencyUploadBytes ?? 0);
  for (const [field, expected, actual] of [
    ["phase.decodeAcquireVsSampleDependencyCount", sampleDependencyCount, decode.acquireDelta],
    ["phase.gpuAcquireVsSampleDependencyCount", sampleDependencyCount, gpu.acquireDelta],
    ["phase.readCountDeltaVsDecodeMissDelta", decode.missDelta, readCountDelta],
    ["phase.encodedBytesDeltaVsSampleBytes", sampleEncodedBytes, encodedBytesDelta],
    ["phase.decodedBytesDeltaVsSampleBytes", sampleDecodedBytes, decodedBytesDelta],
    ["phase.uploadCountDeltaVsGpuMissDelta", gpu.missDelta, uploadCountDelta],
    ["phase.uploadBytesDeltaVsSampleBytes", sampleUploadBytes, uploadBytesDelta],
  ] as const) {
    if (actual !== expected) add(field, safeInteger(expected), safeInteger(actual));
  }
}

function formatTraversalMismatches(mismatches: readonly ScaleStreamingTraversalMismatch[]): string {
  return mismatches
    .map(
      ({ actual, expected, field }) =>
        `${field}[expected=${JSON.stringify(expected)},actual=${JSON.stringify(actual)}]`,
    )
    .join(";");
}

async function materializeModelLinks(root: string, modelRoot: string): Promise<void> {
  await mkdir(join(root, "immutable"), { recursive: true });
  for (const artifact of APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS) {
    const source = await requireDirectContainedRegularFile(modelRoot, artifact.path, "model");
    const destination = join(root, "immutable", `model-${artifact.sha256}.gguf`);
    await requireDirectContainedDirectory(root, resolve(destination, ".."), "target");
    const sourceStat = await lstat(source, { bigint: true });
    if (
      sourceStat.isSymbolicLink() ||
      !sourceStat.isFile() ||
      sourceStat.size !== BigInt(artifact.bytes)
    ) {
      throw new Error(`Scale-streaming model source is invalid: ${artifact.path}`);
    }
    if ((await sha256File(source)) !== artifact.sha256) {
      throw new Error(`Scale-streaming model source digest drifted: ${artifact.path}`);
    }
    await link(source, destination);
    const destinationStat = await stat(destination, { bigint: true });
    if (
      !destinationStat.isFile() ||
      destinationStat.dev !== sourceStat.dev ||
      destinationStat.ino !== sourceStat.ino ||
      destinationStat.size !== sourceStat.size
    ) {
      throw new Error(`Scale-streaming model was not exact hard-link reuse: ${artifact.path}`);
    }
  }
}

export function assertGeneratedExactRangePathDisjoint(
  corpus: GeneratedScaleStreamingCorpus,
  exactResources: readonly Readonly<{ readonly source: string }>[],
): void {
  const exact = new Set(exactResources.map(({ source }) => normalizedRelativePath(source)));
  const generated = new Set<string>();
  for (const resource of corpus.graphs.flatMap(({ resources }) => resources)) {
    const path = normalizedRelativePath(resource.source);
    if (generated.has(path) || exact.has(path)) {
      throw new Error(`Generated scale-streaming path overlaps an exact Range path: ${path}`);
    }
    generated.add(path);
  }
}

export async function validateScaleStreamingSourceTree(
  root: string,
  label: string,
): Promise<string> {
  const resolvedRoot = resolve(root);
  const rootStat = await lstat(resolvedRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`Scale-streaming ${label} root is not a direct directory`);
  }
  const canonicalRoot = await realpath(resolvedRoot);
  if (!samePath(canonicalRoot, resolvedRoot)) {
    throw new Error(`Scale-streaming ${label} root traverses a reparse point`);
  }
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const entryStat = await lstat(path);
      if (entry.isSymbolicLink() || entryStat.isSymbolicLink()) {
        throw new Error(`Scale-streaming ${label} tree contains a link or reparse point`);
      }
      const canonicalPath = await realpath(path);
      assertContained(canonicalRoot, canonicalPath, `${label} tree`);
      if (!samePath(canonicalPath, path)) {
        throw new Error(`Scale-streaming ${label} tree traverses a reparse point`);
      }
      if (entryStat.isDirectory()) await visit(path);
      else if (!entryStat.isFile()) {
        throw new Error(`Scale-streaming ${label} tree contains a non-regular entry`);
      }
    }
  };
  await visit(resolvedRoot);
  return canonicalRoot;
}

async function requireDirectContainedRegularFile(
  canonicalRoot: string,
  relative: string,
  label: string,
): Promise<string> {
  const path = safeTargetPath(canonicalRoot, relative);
  const entryStat = await lstat(path);
  if (entryStat.isSymbolicLink() || !entryStat.isFile()) {
    throw new Error(`Scale-streaming ${label} source is not a direct regular file: ${relative}`);
  }
  const canonicalPath = await realpath(path);
  assertContained(canonicalRoot, canonicalPath, `${label} source`);
  if (!samePath(canonicalPath, path)) {
    throw new Error(`Scale-streaming ${label} source traverses a reparse point: ${relative}`);
  }
  return canonicalPath;
}

async function requireDirectContainedDirectory(
  canonicalRoot: string,
  directory: string,
  label: string,
): Promise<void> {
  const entryStat = await lstat(directory);
  if (entryStat.isSymbolicLink() || !entryStat.isDirectory()) {
    throw new Error(`Scale-streaming ${label} destination parent is not a direct directory`);
  }
  const canonicalDirectory = await realpath(directory);
  assertContained(canonicalRoot, canonicalDirectory, `${label} destination`);
  if (!samePath(canonicalDirectory, directory)) {
    throw new Error(`Scale-streaming ${label} destination traverses a reparse point`);
  }
}

function assertContained(root: string, candidate: string, label: string): void {
  const normalizedRoot = normalizePath(root);
  const normalizedCandidate = normalizePath(candidate);
  if (
    normalizedCandidate !== normalizedRoot &&
    !normalizedCandidate.startsWith(`${normalizedRoot}${sep}`)
  ) {
    throw new Error(`Scale-streaming ${label} escapes its real root`);
  }
}

function normalizedRelativePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (normalized === "" || normalized.startsWith("/") || normalized.includes("../")) {
    throw new Error(`Scale-streaming exact Range path is invalid: ${value}`);
  }
  return normalized;
}

function normalizePath(value: string): string {
  const normalized = resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function samePath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right);
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolveDigest, rejectDigest) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", rejectDigest);
    stream.once("end", () => resolveDigest(hash.digest("hex")));
  });
}

function safeTargetPath(root: string, relative: string): string {
  const resolvedRoot = resolve(root);
  const path = resolve(resolvedRoot, relative);
  if (!path.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`Scale-streaming path escapes its root: ${relative}`);
  }
  return path;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("Scale-streaming observation was aborted"));
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const aborted = (): void => rejectPromise(new Error("Scale-streaming observation was aborted"));
    signal.addEventListener("abort", aborted, { once: true });
    operation.then(resolvePromise, rejectPromise).finally(() => {
      signal.removeEventListener("abort", aborted);
    });
  });
}

export function parseScaleStreamingCorpusForRunner(input: unknown): GeneratedScaleStreamingCorpus {
  return parseGeneratedScaleStreamingCorpus(input);
}
