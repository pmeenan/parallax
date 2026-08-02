import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  assertCompatibleInstallerShellEntrypoint,
  type InstallerBuildArtifact,
  type InstallerBuildManifest,
  parseInstallerBuildManifest,
  validateInstallerManifestBytes,
} from "../install/installer-build-manifest";
import type { InstallResource } from "../storage/install-manifest";
import {
  compatibleOfflineShellGenerations,
  idleOfflineShellTelemetrySnapshot,
  OFFLINE_SHELL_GENERATION_SCHEMA_VERSION,
  OFFLINE_SHELL_SAVE_SCHEMA_VERSION,
  OFFLINE_SHELL_SERVICE_WORKER_PATH,
  type OfflineShellAdmission,
  type OfflineShellFailureCode,
  type OfflineShellGeneration,
  type OfflineShellResource,
  type OfflineShellStoreRecord,
  type OfflineShellTelemetrySnapshot,
  parseOfflineShellGeneration,
  parseOfflineShellStoreRecord,
} from "./shell-generation-contract";

export interface OfflineShellFetchedResource {
  readonly bytes: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
  readonly status: number;
  readonly url: string;
}

export interface OfflineShellStorePlatform {
  readonly origin: string;
  collectGenerations(retainedGenerationIds: ReadonlySet<string>): Promise<void>;
  deleteGeneration(generationId: string): Promise<void>;
  fetch(path: string): Promise<OfflineShellFetchedResource>;
  match(generationId: string, path: string): Promise<OfflineShellFetchedResource | null>;
  now(): number;
  put(generationId: string, path: string, response: OfflineShellFetchedResource): Promise<void>;
  readRecord(): Promise<OfflineShellStoreRecord>;
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
  runPrepareExclusive<T>(operation: () => Promise<T>): Promise<T>;
  updateRecord(
    update: (record: OfflineShellStoreRecord) => OfflineShellStoreRecord,
  ): Promise<OfflineShellStoreRecord>;
  writeRecord(record: OfflineShellStoreRecord): Promise<void>;
}

export interface OfflineShellResolvedResource {
  readonly generationId: string;
  readonly response: OfflineShellFetchedResource;
}

interface OfflineShellVerificationMeasurement {
  readonly durationMs: number;
  readonly verifiedBytes: number;
}

export class OfflineShellStoreError extends Error {
  public readonly code: OfflineShellFailureCode;

  public constructor(code: OfflineShellFailureCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OfflineShellStoreError";
    this.code = code;
  }
}

export class OfflineShellAdmissionMismatchError extends OfflineShellStoreError {
  public constructor() {
    super("shell-release-mismatch", "Selected offline shell changed before launch admission");
    this.name = "OfflineShellAdmissionMismatchError";
  }
}

class OfflineShellVerificationError extends OfflineShellStoreError {
  public readonly measurement: OfflineShellVerificationMeasurement;

  public constructor(
    code: OfflineShellFailureCode,
    message: string,
    measurement: OfflineShellVerificationMeasurement,
    options?: ErrorOptions,
  ) {
    super(code, message, options);
    this.name = "OfflineShellVerificationError";
    this.measurement = measurement;
  }
}

export async function prepareAndActivateOfflineShellGeneration(
  platform: OfflineShellStorePlatform,
  shellEntrypointPath: string,
  options: Readonly<{ allowUpdate: boolean }> = Object.freeze({ allowUpdate: false }),
): Promise<OfflineShellGeneration> {
  return platform.runPrepareExclusive(async () => {
    const plan = await platform.runExclusive(async () => {
      const record = parseOfflineShellStoreRecord(await platform.readRecord());
      if (record.candidate === null) return Object.freeze({ record, staleCandidate: null });
      const staleCandidate = record.candidate;
      const next = withSelection(record, {
        candidate: null,
        telemetry: telemetry(record, {
          candidateGenerationId: null,
          failureCode: null,
          failureMessage: null,
          state: record.active === null ? "idle" : "active",
        }),
      });
      await platform.writeRecord(next);
      return Object.freeze({ record: next, staleCandidate });
    });
    const planned = plan.record;
    const staleCandidate = plan.staleCandidate;
    if (
      staleCandidate !== null &&
      staleCandidate.generationId !== planned.active?.generationId &&
      staleCandidate.generationId !== planned.previous?.generationId
    ) {
      await platform.deleteGeneration(staleCandidate.generationId).catch(() => undefined);
    }
    await collectUnreferencedGenerations(platform, planned);

    if (
      !options.allowUpdate &&
      planned.active !== null &&
      planned.active.appEntrypoint.path === shellEntrypointPath
    ) {
      return verifyPlannedActive(platform, planned, shellEntrypointPath);
    }

    if (!options.allowUpdate && planned.active !== null) {
      throw new OfflineShellStoreError(
        "shell-release-mismatch",
        "The loaded shell entrypoint differs from the explicitly selected offline generation",
      );
    }

    let prefetchedBuild: OfflineShellFetchedResource | undefined;
    let candidate: OfflineShellGeneration | null = null;
    let candidatePublished = false;
    let ownsFreshCandidate = false;
    try {
      if (options.allowUpdate && planned.active !== null) {
        try {
          prefetchedBuild = await platform.fetch("build-manifest.json");
        } catch (error: unknown) {
          if (planned.active.appEntrypoint.path !== shellEntrypointPath) {
            throw new OfflineShellStoreError(
              "shell-release-mismatch",
              "Network target is unavailable and the loaded shell differs from the active offline generation",
              { cause: error },
            );
          }
          return verifyPlannedActive(platform, planned, shellEntrypointPath);
        }
        validateCommonResponse(
          prefetchedBuild,
          "build-manifest.json",
          "application/json",
          false,
          platform.origin,
        );
        if (
          digest(prefetchedBuild.bytes) === planned.active.artifactDigest &&
          planned.active.appEntrypoint.path === shellEntrypointPath
        ) {
          return verifyPlannedActive(platform, planned, shellEntrypointPath);
        }
      }

      const prepared = await fetchGeneration(platform, shellEntrypointPath, prefetchedBuild);
      candidate = prepared.generation;
      await platform.runExclusive(async () => {
        const current = parseOfflineShellStoreRecord(await platform.readRecord());
        assertSelectionUnchanged(current, planned);
        const next = withSelection(current, {
          candidate,
          telemetry: telemetry(current, {
            candidateGenerationId: candidate?.generationId ?? null,
            failureCode: null,
            failureMessage: null,
            prepareCount: current.telemetry.prepareCount + 1,
            state: "preparing",
          }),
        });
        await platform.writeRecord(next);
      });
      candidatePublished = true;
      const reusesAuthorized =
        candidate.generationId === planned.active?.generationId ||
        candidate.generationId === planned.previous?.generationId;
      ownsFreshCandidate = !reusesAuthorized;
      if (!reusesAuthorized) {
        await platform.deleteGeneration(candidate.generationId);
        for (const resource of prepared.resources) {
          await platform.put(candidate.generationId, resource.path, resource.response);
        }
      }
      const verification = await verifyCachedGeneration(platform, candidate);
      await platform.runExclusive(async () => {
        const current = parseOfflineShellStoreRecord(await platform.readRecord());
        assertCandidatePlanUnchanged(current, planned, candidate as OfflineShellGeneration);
        const previous =
          current.active?.generationId === candidate?.generationId
            ? current.previous
            : current.active;
        const next = createRecord({
          active: candidate,
          candidate: null,
          previous,
          telemetry: telemetryWithVerification(current, verification, {
            activateCount:
              current.active?.generationId === candidate?.generationId
                ? current.telemetry.activateCount
                : current.telemetry.activateCount + 1,
            activeArtifactDigest: candidate?.artifactDigest ?? null,
            activeGenerationId: candidate?.generationId ?? null,
            activeReleaseDigest: candidate?.releaseDigest ?? null,
            candidateGenerationId: null,
            failureCode: null,
            failureMessage: null,
            previousGenerationId: previous?.generationId ?? null,
            state: "active",
          }),
        });
        await platform.writeRecord(next);
      });
      const committed = await platform.runExclusive(async () =>
        parseOfflineShellStoreRecord(await platform.readRecord()),
      );
      await collectUnreferencedGenerations(platform, committed);
      return candidate;
    } catch (error: unknown) {
      let deleteCandidate = false;
      await platform.runExclusive(async () => {
        const current = parseOfflineShellStoreRecord(await platform.readRecord());
        if (candidatePublished && candidate !== null) {
          deleteCandidate =
            ownsFreshCandidate &&
            candidate.generationId !== current.active?.generationId &&
            candidate.generationId !== current.previous?.generationId;
          if (!sameGeneration(current.candidate, candidate)) return;
          if (!sameSelectionExceptCandidate(current, planned)) return;
        } else if (!sameSelection(current, planned)) {
          return;
        }
        const failedVerification = verificationMeasurement(error);
        const failed = createRecord({
          active: current.active,
          candidate: null,
          previous: current.previous,
          telemetry: telemetryWithVerifications(
            current,
            failedVerification === null ? [] : [failedVerification],
            {
              candidateGenerationId: null,
              failureCode: failureCode(error),
              failureCount: current.telemetry.failureCount + 1,
              failureMessage: message(error),
              state: "failed",
            },
          ),
        });
        await platform.writeRecord(failed);
      });
      if (deleteCandidate && candidate !== null) {
        await platform.deleteGeneration(candidate.generationId).catch(() => undefined);
      }
      throw error instanceof OfflineShellStoreError
        ? error
        : new OfflineShellStoreError(failureCode(error), message(error), { cause: error });
    }
  });
}

async function verifyPlannedActive(
  platform: OfflineShellStorePlatform,
  planned: OfflineShellStoreRecord,
  shellEntrypointPath: string,
): Promise<OfflineShellGeneration> {
  const active = planned.active;
  if (active === null) {
    throw new OfflineShellStoreError("shell-unavailable", "Offline shell has no active generation");
  }
  try {
    const verification = await verifyCachedGeneration(platform, active);
    await platform.runExclusive(async () => {
      const current = parseOfflineShellStoreRecord(await platform.readRecord());
      assertSelectionUnchanged(current, planned);
      await platform.writeRecord(
        withSelection(current, {
          telemetry: telemetryWithVerification(current, verification, {
            failureCode: null,
            failureMessage: null,
            state: "active",
          }),
        }),
      );
    });
    return active;
  } catch (error: unknown) {
    const activeMeasurement = verificationMeasurement(error);
    const previous = planned.previous;
    let previousMeasurement: OfflineShellVerificationMeasurement | null = null;
    let previousError: unknown = null;
    if (previous !== null && compatibleOfflineShellGenerations(active, previous)) {
      try {
        previousMeasurement = await verifyCachedGeneration(platform, previous);
      } catch (caught: unknown) {
        previousError = caught;
      }
    }
    const rolledBack = await platform.runExclusive(async () => {
      const current = parseOfflineShellStoreRecord(await platform.readRecord());
      assertSelectionUnchanged(current, planned);
      const attempts = [
        ...(activeMeasurement === null ? [] : [activeMeasurement]),
        ...(verificationMeasurement(previousError) === null
          ? []
          : [verificationMeasurement(previousError) as OfflineShellVerificationMeasurement]),
      ];
      if (previous === null || previousMeasurement === null) {
        const diagnostic =
          previousError === null
            ? `Selected offline shell is unusable and no compatible previous generation exists: ${message(error)}`
            : `Selected offline shell is unusable: ${message(error)}; previous generation is unusable: ${message(previousError)}`;
        await platform.writeRecord(
          createRecord({
            active: current.active,
            candidate: null,
            previous: current.previous,
            telemetry: telemetryWithVerifications(current, attempts, {
              candidateGenerationId: null,
              failureCode: "shell-unavailable",
              failureCount: current.telemetry.failureCount + 1,
              failureMessage: diagnostic,
              state: "failed",
            }),
          }),
        );
        throw new OfflineShellStoreError("shell-unavailable", diagnostic, { cause: error });
      }
      await platform.writeRecord(
        createRecord({
          active: previous,
          candidate: null,
          previous: null,
          telemetry: telemetryWithVerifications(current, [...attempts, previousMeasurement], {
            activeArtifactDigest: previous.artifactDigest,
            activeGenerationId: previous.generationId,
            activeReleaseDigest: previous.releaseDigest,
            candidateGenerationId: null,
            failureCode: null,
            failureCount: current.telemetry.failureCount + 1,
            failureMessage: null,
            previousGenerationId: null,
            rollbackCount: current.telemetry.rollbackCount + 1,
            state: "active",
          }),
        }),
      );
      return previous;
    });
    await platform.deleteGeneration(active.generationId).catch(() => undefined);
    if (rolledBack.appEntrypoint.path !== shellEntrypointPath) {
      throw new OfflineShellStoreError(
        "shell-release-mismatch",
        "The loaded shell entrypoint is not the rolled-back generation",
        { cause: error },
      );
    }
    return rolledBack;
  }
}

function assertSelectionUnchanged(
  current: OfflineShellStoreRecord,
  planned: OfflineShellStoreRecord,
): void {
  if (!sameSelection(current, planned)) {
    throw new OfflineShellStoreError(
      "shell-release-mismatch",
      "Offline shell selection changed during preparation",
    );
  }
}

function assertCandidatePlanUnchanged(
  current: OfflineShellStoreRecord,
  planned: OfflineShellStoreRecord,
  candidate: OfflineShellGeneration,
): void {
  if (
    !sameSelectionExceptCandidate(current, planned) ||
    !sameGeneration(current.candidate, candidate)
  ) {
    throw new OfflineShellStoreError(
      "shell-release-mismatch",
      "Offline shell candidate or selection changed during preparation",
    );
  }
}

function sameSelection(left: OfflineShellStoreRecord, right: OfflineShellStoreRecord): boolean {
  return (
    sameGeneration(left.active, right.active) &&
    sameGeneration(left.previous, right.previous) &&
    sameGeneration(left.candidate, right.candidate)
  );
}

function sameSelectionExceptCandidate(
  left: OfflineShellStoreRecord,
  right: OfflineShellStoreRecord,
): boolean {
  return sameGeneration(left.active, right.active) && sameGeneration(left.previous, right.previous);
}

function sameGeneration(
  left: OfflineShellGeneration | null,
  right: OfflineShellGeneration | null,
): boolean {
  return left?.generationId === right?.generationId;
}

export async function admitOfflineShellGeneration(
  platform: OfflineShellStorePlatform,
  expected: OfflineShellAdmission,
): Promise<OfflineShellTelemetrySnapshot> {
  return platform.runExclusive(async () => {
    const record = parseOfflineShellStoreRecord(await platform.readRecord());
    if (
      record.active === null ||
      record.active.generationId !== expected.generationId ||
      record.active.releaseDigest !== expected.releaseDigest
    ) {
      throw new OfflineShellAdmissionMismatchError();
    }
    let verification: OfflineShellVerificationMeasurement;
    try {
      verification = await verifyCachedGeneration(platform, record.active);
    } catch (error: unknown) {
      const rollback = await rollbackOfflineShellGenerationLocked(
        platform,
        record,
        message(error),
        verificationMeasurement(error),
      );
      const failure = new OfflineShellStoreError(
        "shell-release-mismatch",
        "Selected offline shell failed launch admission and was rolled back",
        { cause: error },
      );
      const failed = withSelection(rollback.record, {
        telemetry: telemetry(rollback.record, {
          failureCode: failure.code,
          failureMessage: failure.message,
          state: "failed",
        }),
      });
      await platform.writeRecord(failed);
      throw failure;
    }
    const next = withSelection(record, {
      telemetry: telemetryWithVerification(record, verification, {
        failureCode: null,
        failureMessage: null,
        state: "active",
      }),
    });
    await platform.writeRecord(next);
    return next.telemetry;
  });
}

export async function recordOfflineShellFailure(
  platform: OfflineShellStorePlatform,
  code: OfflineShellFailureCode,
  diagnostic: string,
): Promise<OfflineShellTelemetrySnapshot> {
  return platform.runExclusive(async () => {
    const record = parseOfflineShellStoreRecord(await platform.readRecord());
    if (
      record.telemetry.state === "failed" &&
      record.telemetry.failureCode === code &&
      record.telemetry.failureMessage === diagnostic
    ) {
      return record.telemetry;
    }
    return (await writeFailureRecordLocked(platform, record, code, diagnostic)).telemetry;
  });
}

export async function resolveOfflineShellRequestFailureTelemetry(
  platform: OfflineShellStorePlatform,
  error: unknown,
  code: OfflineShellFailureCode,
  diagnostic: string,
): Promise<OfflineShellTelemetrySnapshot> {
  if (error instanceof OfflineShellAdmissionMismatchError) {
    return platform.runExclusive(async () => {
      const record = parseOfflineShellStoreRecord(await platform.readRecord());
      return telemetry(record, {
        failureCode: code,
        failureCount: record.telemetry.failureCount + 1,
        failureMessage: diagnostic,
        state: "failed",
      });
    });
  }
  return recordOfflineShellFailure(platform, code, diagnostic);
}

export async function resolveOfflineShellResource(
  platform: OfflineShellStorePlatform,
  path: string,
): Promise<OfflineShellResolvedResource | null> {
  return platform.runExclusive(() => resolveOfflineShellResourceLocked(platform, path));
}

async function resolveOfflineShellResourceLocked(
  platform: OfflineShellStorePlatform,
  path: string,
): Promise<OfflineShellResolvedResource | null> {
  if (!safePath(path)) return null;
  const record = parseOfflineShellStoreRecord(await platform.readRecord());
  const active = record.active;
  if (active === null) return null;
  const descriptor = active.resources.find((resource) => resource.path === path);
  if (descriptor === undefined) {
    if (
      record.previous?.resources.some((resource) => resource.path === path) === true ||
      isReservedShellPath(path)
    ) {
      await incrementMixedGeneration(platform);
      throw new OfflineShellStoreError(
        "shell-release-mismatch",
        `Refusing to mix ${path} into offline generation ${active.generationId}`,
      );
    }
    return null;
  }
  const response = await platform.match(active.generationId, path);
  if (response !== null) {
    try {
      validateResourceResponse(response, descriptor, platform.origin);
      await incrementCacheHit(platform);
      return Object.freeze({ generationId: active.generationId, response });
    } catch (error: unknown) {
      const rollback = await rollbackOfflineShellGenerationLocked(platform, record, message(error));
      return resolveRolledBackResource(platform, rollback.active, path, error);
    }
  }
  await incrementCacheMiss(platform);
  const rollback = await rollbackOfflineShellGenerationLocked(
    platform,
    record,
    `Missing cached ${path}`,
  );
  return resolveRolledBackResource(platform, rollback.active, path);
}

export function initialOfflineShellStoreRecord(): OfflineShellStoreRecord {
  return createRecord({
    active: null,
    candidate: null,
    previous: null,
    telemetry: idleOfflineShellTelemetrySnapshot(),
  });
}

async function fetchGeneration(
  platform: OfflineShellStorePlatform,
  shellEntrypointPath: string,
  prefetchedBuild?: OfflineShellFetchedResource,
): Promise<{
  readonly generation: OfflineShellGeneration;
  readonly resources: readonly Readonly<{
    path: string;
    response: OfflineShellFetchedResource;
  }>[];
}> {
  const buildResponse = prefetchedBuild ?? (await platform.fetch("build-manifest.json"));
  validateCommonResponse(
    buildResponse,
    "build-manifest.json",
    "application/json",
    false,
    platform.origin,
  );
  const artifactDigest = digest(buildResponse.bytes);
  const build = parseBuildManifestBytes(buildResponse.bytes);
  const installArtifact = requireArtifact(build, build.installManifestEntrypoint.path);
  const installResponse = await platform.fetch(build.installManifestEntrypoint.path);
  validateResourceResponse(
    installResponse,
    {
      bytes: installArtifact.bytes,
      mimeType: "application/json",
      path: installArtifact.path,
      sha256: installArtifact.sha256,
    },
    platform.origin,
  );
  const identity = validateInstallerManifestBytes(build, installResponse.bytes);
  if (identity.releaseDigest !== installArtifact.sha256) {
    throw new OfflineShellStoreError(
      "shell-contract",
      "Install-manifest release identity changed during shell preparation",
    );
  }
  const app = assertCompatibleInstallerShellEntrypoint(build, shellEntrypointPath);
  const engine = requireShellResource(identity.installManifest.manifest.resources, {
    id: "common-module-engine",
    kind: "module",
  });
  const serviceWorker = requireArtifact(build, OFFLINE_SHELL_SERVICE_WORKER_PATH);
  const shellResources = identity.installManifest.manifest.resources.filter(
    (resource) => resource.target === "shell",
  );
  const descriptors: OfflineShellResource[] = [
    Object.freeze({
      bytes: buildResponse.bytes.byteLength,
      mimeType: "application/json",
      path: "build-manifest.json",
      sha256: artifactDigest,
    }),
    ...shellResources.map(shellDescriptor),
    Object.freeze({
      bytes: installArtifact.bytes,
      mimeType: "application/json",
      path: installArtifact.path,
      sha256: installArtifact.sha256,
    }),
  ].sort((left, right) => compareCodepoints(left.path, right.path));
  const paths = new Set<string>();
  for (const descriptor of descriptors) {
    if (paths.has(descriptor.path)) {
      throw new OfflineShellStoreError(
        "shell-contract",
        `Offline shell has a duplicate resource path: ${descriptor.path}`,
      );
    }
    paths.add(descriptor.path);
  }
  if (
    !paths.has("index.html") ||
    !paths.has(app.path) ||
    !paths.has(engine.source) ||
    !paths.has(serviceWorker.path)
  ) {
    throw new OfflineShellStoreError(
      "shell-contract",
      "Offline shell is missing navigation, app, engine, or service-worker identity",
    );
  }
  const generation = parseOfflineShellGeneration({
    appEntrypoint: artifactIdentity(app),
    artifactDigest,
    buildManifestSchemaVersion: build.schemaVersion,
    engineArtifact: Object.freeze({
      bytes: engine.bytes,
      path: engine.source,
      sha256: engine.sha256,
    }),
    generationId: `${artifactDigest}:${identity.releaseDigest}`,
    installManifestSchemaVersion: build.installManifestEntrypoint.schemaVersion,
    releaseDigest: identity.releaseDigest,
    resources: Object.freeze(descriptors),
    saveSchemaVersion: build.offlineShell.saveSchemaVersion,
    schemaVersion: OFFLINE_SHELL_GENERATION_SCHEMA_VERSION,
    serviceWorker: Object.freeze({
      ...artifactIdentity(serviceWorker),
      path: OFFLINE_SHELL_SERVICE_WORKER_PATH,
    }),
  });
  if (
    build.offlineShell.generationSchemaVersion !== OFFLINE_SHELL_GENERATION_SCHEMA_VERSION ||
    build.offlineShell.saveSchemaVersion !== OFFLINE_SHELL_SAVE_SCHEMA_VERSION ||
    build.offlineShell.serviceWorkerPath !== OFFLINE_SHELL_SERVICE_WORKER_PATH
  ) {
    throw new OfflineShellStoreError(
      "shell-release-mismatch",
      "Target build has an incompatible offline-shell generation contract",
    );
  }

  const fetched = new Map<string, OfflineShellFetchedResource>([
    ["build-manifest.json", buildResponse],
    [installArtifact.path, installResponse],
  ]);
  for (const descriptor of descriptors) {
    if (fetched.has(descriptor.path)) continue;
    const response = await platform.fetch(descriptor.path);
    validateResourceResponse(response, descriptor, platform.origin);
    fetched.set(descriptor.path, response);
  }
  return Object.freeze({
    generation,
    resources: Object.freeze(
      descriptors.map((descriptor) =>
        Object.freeze({
          path: descriptor.path,
          response: requireFetched(fetched, descriptor.path),
        }),
      ),
    ),
  });
}

async function verifyCachedGeneration(
  platform: OfflineShellStorePlatform,
  generation: OfflineShellGeneration,
): Promise<OfflineShellVerificationMeasurement> {
  const startedAt = platform.now();
  let verifiedBytes = 0;
  try {
    for (const resource of generation.resources) {
      const response = await platform.match(generation.generationId, resource.path);
      if (response === null) {
        throw new OfflineShellStoreError(
          "shell-unavailable",
          `Offline shell cache is missing ${resource.path}`,
        );
      }
      validateResourceResponse(response, resource, platform.origin);
      verifiedBytes += resource.bytes;
    }
    return Object.freeze({
      durationMs: Math.max(0, platform.now() - startedAt),
      verifiedBytes,
    });
  } catch (error: unknown) {
    throw new OfflineShellVerificationError(
      failureCode(error),
      message(error),
      Object.freeze({
        durationMs: Math.max(0, platform.now() - startedAt),
        verifiedBytes,
      }),
      { cause: error },
    );
  }
}

async function resolveRolledBackResource(
  platform: OfflineShellStorePlatform,
  rollback: OfflineShellGeneration,
  path: string,
  cause?: unknown,
): Promise<OfflineShellResolvedResource> {
  const descriptor = rollback.resources.find((resource) => resource.path === path);
  if (descriptor === undefined) {
    throw new OfflineShellStoreError(
      "shell-release-mismatch",
      `Rolled-back offline shell cannot serve the failed generation path: ${path}`,
      { cause },
    );
  }
  const response = await platform.match(rollback.generationId, path);
  if (response === null) {
    throw new OfflineShellStoreError(
      "shell-unavailable",
      `Rolled-back offline shell is missing ${path}`,
      { cause },
    );
  }
  validateResourceResponse(response, descriptor, platform.origin);
  await incrementCacheHit(platform);
  return Object.freeze({ generationId: rollback.generationId, response });
}

async function rollbackOfflineShellGenerationLocked(
  platform: OfflineShellStorePlatform,
  record: OfflineShellStoreRecord,
  diagnostic: string,
  failedVerification: OfflineShellVerificationMeasurement | null = null,
): Promise<Readonly<{ active: OfflineShellGeneration; record: OfflineShellStoreRecord }>> {
  const attempted = failedVerification === null ? [] : [failedVerification];
  if (
    record.active === null ||
    record.previous === null ||
    !compatibleOfflineShellGenerations(record.active, record.previous)
  ) {
    const failureMessage = `Selected offline shell is unusable and no compatible previous generation exists: ${diagnostic}`;
    const failed = createRecord({
      active: record.active,
      candidate: null,
      previous: record.previous,
      telemetry: telemetryWithVerifications(record, attempted, {
        candidateGenerationId: null,
        failureCode: "shell-unavailable",
        failureCount: record.telemetry.failureCount + 1,
        failureMessage,
        state: "failed",
      }),
    });
    await platform.writeRecord(failed);
    throw new OfflineShellStoreError("shell-unavailable", failureMessage);
  }
  let previousVerification: OfflineShellVerificationMeasurement;
  try {
    previousVerification = await verifyCachedGeneration(platform, record.previous);
  } catch (error: unknown) {
    const previousAttempt = verificationMeasurement(error);
    const failureMessage = `Selected offline shell is unusable: ${diagnostic}; previous generation is unusable: ${message(error)}`;
    const failed = createRecord({
      active: record.active,
      candidate: null,
      previous: record.previous,
      telemetry: telemetryWithVerifications(
        record,
        [...attempted, ...(previousAttempt === null ? [] : [previousAttempt])],
        {
          candidateGenerationId: null,
          failureCode: "shell-unavailable",
          failureCount: record.telemetry.failureCount + 1,
          failureMessage,
          state: "failed",
        },
      ),
    });
    await platform.writeRecord(failed);
    throw new OfflineShellStoreError("shell-unavailable", failureMessage, { cause: error });
  }
  const failedActive = record.active;
  const next = createRecord({
    active: record.previous,
    candidate: null,
    previous: null,
    telemetry: telemetryWithVerifications(record, [...attempted, previousVerification], {
      activeArtifactDigest: record.previous.artifactDigest,
      activeGenerationId: record.previous.generationId,
      activeReleaseDigest: record.previous.releaseDigest,
      candidateGenerationId: null,
      failureCode: null,
      failureCount: record.telemetry.failureCount + 1,
      failureMessage: null,
      previousGenerationId: null,
      rollbackCount: record.telemetry.rollbackCount + 1,
      state: "active",
    }),
  });
  await platform.writeRecord(next);
  await platform.deleteGeneration(failedActive.generationId).catch(() => undefined);
  return Object.freeze({ active: record.previous, record: next });
}

function validateResourceResponse(
  response: OfflineShellFetchedResource,
  resource: OfflineShellResource,
  origin: string,
): void {
  validateCommonResponse(
    response,
    resource.path,
    resource.mimeType,
    resource.path.startsWith("immutable/"),
    origin,
  );
  if (response.bytes.byteLength !== resource.bytes || digest(response.bytes) !== resource.sha256) {
    throw new OfflineShellStoreError(
      "shell-contract",
      `Offline shell bytes do not match ${resource.path}`,
    );
  }
}

function validateCommonResponse(
  response: OfflineShellFetchedResource,
  path: string,
  mimeType: string,
  immutable: boolean,
  origin: string,
): void {
  const url = new URL(response.url);
  if (
    response.status !== 200 ||
    url.origin !== origin ||
    url.pathname !== `/${path}` ||
    url.search !== "" ||
    url.hash !== "" ||
    mimeBase(response.headers["content-type"]) !== mimeType ||
    response.headers["cross-origin-opener-policy"] !== "same-origin" ||
    response.headers["cross-origin-embedder-policy"] !== "require-corp" ||
    response.headers["x-content-type-options"] !== "nosniff"
  ) {
    throw new OfflineShellStoreError(
      "shell-contract",
      `Offline shell response contract failed for ${path}`,
    );
  }
  const cacheControl = parseCacheControl(response.headers["cache-control"]);
  if (
    immutable
      ? cacheControl.get("public") !== null ||
        cacheControl.get("max-age") !== "31536000" ||
        cacheControl.get("immutable") !== null
      : cacheControl.get("no-cache") !== null
  ) {
    throw new OfflineShellStoreError(
      "shell-contract",
      `Offline shell cache policy failed for ${path}`,
    );
  }
}

function shellDescriptor(resource: InstallResource): OfflineShellResource {
  return Object.freeze({
    bytes: resource.bytes,
    mimeType: mimeFor(resource),
    path: resource.source,
    sha256: resource.sha256,
  });
}

function mimeFor(resource: InstallResource): string {
  switch (resource.kind) {
    case "document":
      return "text/html";
    case "module":
    case "worker":
      return "application/javascript";
    case "wasm":
      return "application/wasm";
    default:
      throw new OfflineShellStoreError(
        "shell-contract",
        `Unsupported shell resource kind ${resource.kind}`,
      );
  }
}

function parseBuildManifestBytes(bytes: Uint8Array): InstallerBuildManifest {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return parseInstallerBuildManifest(JSON.parse(text) as unknown);
  } catch (error: unknown) {
    throw new OfflineShellStoreError(
      "shell-contract",
      "Build manifest is not strict compatible JSON",
      { cause: error },
    );
  }
}

function requireArtifact(build: InstallerBuildManifest, path: string): InstallerBuildArtifact {
  const artifact = build.artifacts.find((candidate) => candidate.path === path);
  if (artifact === undefined) {
    throw new OfflineShellStoreError("shell-contract", `Build manifest omits ${path}`);
  }
  return artifact;
}

function requireShellResource(
  resources: readonly InstallResource[],
  identity: Readonly<{ id: string; kind: InstallResource["kind"] }>,
): InstallResource {
  const matches = resources.filter(
    (resource) =>
      resource.id === identity.id && resource.kind === identity.kind && resource.target === "shell",
  );
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new OfflineShellStoreError(
      "shell-contract",
      `Install manifest requires one exact ${identity.id} shell resource`,
    );
  }
  return matches[0];
}

function requireFetched(
  fetched: ReadonlyMap<string, OfflineShellFetchedResource>,
  path: string,
): OfflineShellFetchedResource {
  const response = fetched.get(path);
  if (response === undefined) throw new Error(`Offline-shell response disappeared: ${path}`);
  return response;
}

function artifactIdentity(
  artifact: InstallerBuildArtifact,
): Readonly<{ bytes: number; path: string; sha256: string }> {
  return Object.freeze({
    bytes: artifact.bytes,
    path: artifact.path,
    sha256: artifact.sha256,
  });
}

function createRecord(input: {
  active: OfflineShellGeneration | null;
  candidate: OfflineShellGeneration | null;
  previous: OfflineShellGeneration | null;
  telemetry: OfflineShellTelemetrySnapshot;
}): OfflineShellStoreRecord {
  return parseOfflineShellStoreRecord({
    ...input,
    schemaVersion: 1,
  });
}

function withSelection(
  record: OfflineShellStoreRecord,
  update: Partial<{
    active: OfflineShellGeneration | null;
    candidate: OfflineShellGeneration | null;
    previous: OfflineShellGeneration | null;
    telemetry: OfflineShellTelemetrySnapshot;
  }>,
): OfflineShellStoreRecord {
  return createRecord({
    active: update.active === undefined ? record.active : update.active,
    candidate: update.candidate === undefined ? record.candidate : update.candidate,
    previous: update.previous === undefined ? record.previous : update.previous,
    telemetry: update.telemetry ?? record.telemetry,
  });
}

function telemetry(
  record: OfflineShellStoreRecord,
  update: Partial<OfflineShellTelemetrySnapshot>,
): OfflineShellTelemetrySnapshot {
  return Object.freeze({ ...record.telemetry, ...update });
}

function telemetryWithVerification(
  record: OfflineShellStoreRecord,
  measurement: OfflineShellVerificationMeasurement,
  update: Partial<OfflineShellTelemetrySnapshot>,
): OfflineShellTelemetrySnapshot {
  return telemetryWithVerifications(record, [measurement], update);
}

function telemetryWithVerifications(
  record: OfflineShellStoreRecord,
  measurements: readonly OfflineShellVerificationMeasurement[],
  update: Partial<OfflineShellTelemetrySnapshot>,
): OfflineShellTelemetrySnapshot {
  return telemetry(record, {
    verifiedBytes:
      record.telemetry.verifiedBytes +
      measurements.reduce((total, measurement) => total + measurement.verifiedBytes, 0),
    verifyCount: record.telemetry.verifyCount + measurements.length,
    verifyDurationMs:
      record.telemetry.verifyDurationMs +
      measurements.reduce((total, measurement) => total + measurement.durationMs, 0),
    verifyHighWaterMs: Math.max(
      record.telemetry.verifyHighWaterMs,
      ...measurements.map((measurement) => measurement.durationMs),
    ),
    ...update,
  });
}

function verificationMeasurement(error: unknown): OfflineShellVerificationMeasurement | null {
  return error instanceof OfflineShellVerificationError ? error.measurement : null;
}

async function writeFailureRecordLocked(
  platform: OfflineShellStorePlatform,
  record: OfflineShellStoreRecord,
  code: OfflineShellFailureCode,
  diagnostic: string,
): Promise<OfflineShellStoreRecord> {
  const failed = withSelection(record, {
    telemetry: telemetry(record, {
      activeArtifactDigest: record.active?.artifactDigest ?? null,
      activeGenerationId: record.active?.generationId ?? null,
      activeReleaseDigest: record.active?.releaseDigest ?? null,
      candidateGenerationId: record.candidate?.generationId ?? null,
      failureCode: code,
      failureCount: record.telemetry.failureCount + 1,
      failureMessage: diagnostic,
      previousGenerationId: record.previous?.generationId ?? null,
      state: "failed",
    }),
  });
  await platform.writeRecord(failed);
  return failed;
}

async function incrementCacheHit(platform: OfflineShellStorePlatform): Promise<void> {
  await platform.updateRecord((record) =>
    withSelection(record, {
      telemetry: telemetry(record, {
        cacheHitCount: record.telemetry.cacheHitCount + 1,
      }),
    }),
  );
}

async function incrementCacheMiss(platform: OfflineShellStorePlatform): Promise<void> {
  await platform.updateRecord((record) =>
    withSelection(record, {
      telemetry: telemetry(record, {
        cacheMissCount: record.telemetry.cacheMissCount + 1,
      }),
    }),
  );
}

async function incrementMixedGeneration(platform: OfflineShellStorePlatform): Promise<void> {
  await platform.updateRecord((record) =>
    withSelection(record, {
      telemetry: telemetry(record, {
        mixedGenerationCount: record.telemetry.mixedGenerationCount + 1,
      }),
    }),
  );
}

async function collectUnreferencedGenerations(
  platform: OfflineShellStorePlatform,
  record: OfflineShellStoreRecord,
): Promise<void> {
  const retained = new Set<string>();
  for (const generation of [record.active, record.previous, record.candidate]) {
    if (generation !== null) retained.add(generation.generationId);
  }
  await platform.collectGenerations(retained).catch(() => undefined);
}

function parseCacheControl(value: string | undefined): ReadonlyMap<string, string | null> {
  if (value === undefined) return new Map();
  const directives = new Map<string, string | null>();
  for (const part of value.split(",")) {
    const [rawName, ...rest] = part.trim().toLowerCase().split("=");
    if (rawName === undefined || rawName === "") continue;
    const directiveValue = rest.length === 0 ? null : rest.join("=");
    if (directives.has(rawName) && directives.get(rawName) !== directiveValue) {
      throw new OfflineShellStoreError(
        "shell-contract",
        `Conflicting Cache-Control directive ${rawName}`,
      );
    }
    directives.set(rawName, directiveValue);
  }
  return directives;
}

function mimeBase(value: string | undefined): string | null {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
}

function digest(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

function isReservedShellPath(path: string): boolean {
  return (
    path === "index.html" ||
    path === "build-manifest.json" ||
    path === "install-manifest.json" ||
    path === OFFLINE_SHELL_SERVICE_WORKER_PATH ||
    /^immutable\/[a-z0-9-]+-[a-f0-9]{64}\.(?:js|wasm)$/.test(path)
  );
}

function safePath(value: string): boolean {
  return (
    value !== "" &&
    /^[A-Za-z0-9._/-]+$/.test(value) &&
    !value.startsWith("/") &&
    value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

function failureCode(error: unknown): OfflineShellFailureCode {
  return error instanceof OfflineShellStoreError ? error.code : "shell-unavailable";
}

function message(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : String(error);
}

function compareCodepoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
