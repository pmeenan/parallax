import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  INSTALL_MANIFEST_SCHEMA_VERSION,
  type InstallManifest,
  type InstallResource,
  parseInstallManifestDocument,
} from "./install-manifest";
import { createBrowserInstallStorePlatform } from "./opfs-release-store-browser";
import {
  canonicalInstallStoreRecord,
  formatInstallStoreOrdinal,
  INSTALL_STORE_ROOT,
  INSTALL_STORE_TELEMETRY_SCHEMA_VERSION,
  InstallStoreIntegrityError,
  type InstallStoreRecord,
  type InstallStoreTelemetrySnapshot,
  isInstallStoreDigest,
  isStrongEtag,
  type PartialCheckpointRecord,
  parseJsonRecord,
  parsePartialCheckpointRecord,
  parseReleaseAbandonedRecord,
  parseReleaseCommitRecord,
  parseReleasePublishedRecord,
  parseReleaseReadyRecord,
  parseReleaseRepairEligibilityRecord,
  parseReleaseStagedRecord,
  parseVerifiedObjectRecord,
  type ReleaseAbandonedRecord,
  type ReleaseCommitRecord,
  type ReleasePublishedRecord,
  type ReleaseReadyRecord,
  type ReleaseRepairEligibilityRecord,
  type ReleaseStagedRecord,
  serializeInstallStoreRecord,
  type VerifiedObjectRecord,
} from "./opfs-release-store-contract";
import {
  InstallStorePathChangedError,
  InstallStorePathNotFoundError,
  type InstallStorePlatform,
  type InstallStorePlatformEntry,
} from "./opfs-release-store-platform";

export interface ReleaseSelection {
  readonly activeReleaseDigest: string | null;
  readonly previousReleaseDigest: string | null;
}

export interface ReleaseSnapshot {
  readonly ready: boolean;
  readonly releaseDigest: string;
  readonly staged: boolean;
}

export interface PartialSnapshot {
  readonly bytesCommitted: number;
  readonly expectedBytes: number;
  readonly releaseDigest: string;
  readonly resourceId: string;
  readonly strongEtag: string | null;
}

export interface PrepareResourceResult {
  readonly state: "verified" | "partial";
  readonly bytesCommitted: number;
  readonly expectedBytes: number;
  readonly strongEtag: string | null;
  readonly reference?: VerifiedObjectRef;
}

export interface ReleasePlan {
  readonly largestUnverifiedResourceBytes: number;
  readonly missingBytes: number;
  readonly missingResourceCount: number;
  readonly partialBytes: number;
  readonly partialResources: readonly Readonly<{
    bytesCommitted: number;
    resourceId: string;
  }>[];
  readonly partialResourceCount: number;
  readonly reusedBytes: number;
  readonly reusedResourceIds: readonly string[];
  readonly reusedResourceCount: number;
  readonly totalBytes: number;
  readonly totalResourceCount: number;
}

export interface QuotaProbeResult {
  readonly bytes: number;
  readonly completed: boolean;
}

/**
 * Store-admitted immutable-object identity. Its verified marker can be created only after the
 * published bytes have been flushed, reread, and matched to the exact size/SHA-256. Callers that
 * discover a preexisting reference still use `verifyObject` to detect corruption after admission.
 */
export interface VerifiedObjectRef {
  readonly bytes: number;
  readonly path: string;
  readonly releaseDigest: string;
  readonly resourceId: string;
  readonly scope: "common" | "game-specific";
  readonly sha256: string;
}

export interface IntegrityResult {
  readonly bytes: number;
  readonly ok: boolean;
  readonly sha256: string;
}

export interface InstallerRepairAdmission {
  readonly bytes: number;
  readonly recordSha256: string;
  readonly releaseDigest: string;
  readonly resourceId: string;
  readonly scope: "common" | "game-specific";
  readonly sha256: string;
  readonly state: "completion-pending" | "repair-required";
}

export interface ReconciliationResult extends ReleaseSelection {
  readonly cleanupBytesRemoved: number;
  readonly cleanupEntriesRemoved: number;
  readonly cleanupMutations: number;
  readonly cleanupRemaining: boolean;
  readonly recoveredPartials: number;
  readonly unknownTopLevelPaths: readonly string[];
}

export interface GarbageCollectionResult {
  readonly bytesRemoved: number;
  readonly entriesRemoved: number;
  readonly remainingWork: boolean;
}

export interface OpfsReleaseStore {
  admitActiveRelease(releaseDigest: string): Promise<InstallManifest>;
  admitRepairRelease(releaseDigest: string): Promise<InstallerRepairAdmission>;
  abandonRelease(releaseDigest: string): Promise<void>;
  appendPartial(input: {
    readonly bytes: Uint8Array;
    readonly expectedOffset: number;
    readonly releaseDigest: string;
    readonly resourceId: string;
    readonly strongEtag: string;
  }): Promise<PartialSnapshot>;
  beginPartial(releaseDigest: string, resourceId: string): Promise<PartialSnapshot>;
  collectGarbage(options: { readonly maxEntries: number }): Promise<GarbageCollectionResult>;
  completeRepairRelease(admission: InstallerRepairAdmission): Promise<ReleaseSelection>;
  discardPartial(releaseDigest: string, resourceId: string): Promise<void>;
  /**
   * Returns only an admitted `VerifiedObjectRef`; newly published bytes are flushed, reread, and
   * rehashed before the immutable verified marker is written and this promise resolves.
   */
  finalizePartial(releaseDigest: string, resourceId: string): Promise<VerifiedObjectRef>;
  findRepairRelease(releaseDigest: string): Promise<InstallerRepairAdmission | null>;
  getManifest(releaseDigest: string): Promise<InstallManifest>;
  getActiveReleaseDigest(): Promise<string | null>;
  getResource(releaseDigest: string, resourceId: string): Promise<VerifiedObjectRef>;
  getResources(
    releaseDigest: string,
    resourceIds: readonly string[],
  ): Promise<readonly VerifiedObjectRef[]>;
  getSelection(): Promise<ReleaseSelection>;
  markReleaseReady(releaseDigest: string): Promise<ReleaseSnapshot>;
  planRelease(releaseDigest: string): Promise<ReleasePlan>;
  prepareResource(releaseDigest: string, resourceId: string): Promise<PrepareResourceResult>;
  probeQuota(bytes: number): Promise<QuotaProbeResult>;
  publishRelease(releaseDigest: string): Promise<ReleaseSelection>;
  reconcile(options?: { readonly maxCleanupEntries?: number }): Promise<ReconciliationResult>;
  rollbackToPrevious(): Promise<ReleaseSelection>;
  snapshot(): InstallStoreTelemetrySnapshot;
  stageRelease(manifestBytes: Uint8Array): Promise<ReleaseSnapshot>;
  subscribe(listener: (snapshot: InstallStoreTelemetrySnapshot) => void): () => void;
  /** Fully rereads and hashes a preexisting admitted object to detect later corruption. */
  verifyObject(reference: VerifiedObjectRef): Promise<IntegrityResult>;
  verifyRelease(
    releaseDigest: string,
    listener?: (reference: VerifiedObjectRef, result: IntegrityResult) => void,
  ): Promise<IntegrityResult>;
}

export interface InstallStoreInventoryInstrumentation {
  record(operation: "manifest-hash" | "manifest-parse"): void;
}

interface TelemetryMutable {
  activeReleaseDigest: string | null;
  currentReleaseDigest: string | null;
  currentResourceId: string | null;
  currentCheckpointCount: number;
  etagBoundPartialCount: number;
  failureMessage: string | null;
  finalVerificationBytes: number;
  finalVerificationPhase: InstallStoreTelemetrySnapshot["finalVerificationPhase"];
  finalVerificationResourceCount: number;
  finalVerificationTotalBytes: number;
  finalVerificationTotalResourceCount: number;
  garbageCollectedBytes: number;
  garbageCollectedEntries: number;
  garbageCollectionRemaining: boolean;
  hashedBytes: number;
  integrityFailures: number;
  lastOperationDurationMs: number;
  partialBytes: number;
  partialResourceCount: number;
  previousReleaseDigest: string | null;
  publicationCount: number;
  checkpointWriteCount: number;
  quotaExceededCount: number;
  readyReleaseCount: number;
  reconciliationCount: number;
  recoveryCount: number;
  resumedBytes: number;
  reusedBytes: number;
  rollbackCount: number;
  stagedReleaseCount: number;
  state: InstallStoreTelemetrySnapshot["state"];
  verifiedObjectBytes: number;
  verifiedObjectCount: number;
  writtenBytes: number;
}

interface CleanupBudget {
  bytesRemoved: number;
  entriesRemoved: number;
  mutations: number;
  remaining: number;
}

interface PartialInventoryEntry {
  readonly bytes: number;
  readonly checkpointCount: number;
  readonly dataPresent: boolean;
  readonly etagBound: boolean;
}

interface LiveInventory {
  readonly partials: Map<string, PartialInventoryEntry>;
  readonly readyReleases: Set<string>;
  readonly stagedReleases: Set<string>;
  readonly verifiedObjects: Map<string, number>;
}

interface ValidatedReleaseCache {
  readonly manifest: InstallManifest;
  readonly releaseDigest: string;
  readonly resourcesById: ReadonlyMap<string, InstallResource>;
}

const textDecoder = new TextDecoder("utf-8", { fatal: true });
const COMMIT_NAME = /^([0-9]{20})-([a-f0-9]{64})\.json$/;
const CHECKPOINT_NAME = /^([0-9]{20})\.json$/;
const HASH_CHUNK_BYTES = 4 * 1024 * 1024;
const CHECKPOINT_RETENTION = 2;
const MAX_QUOTA_PROBE_BYTES = 1024 * 1024;
const COMMIT_ORDINAL_RETENTION = 64;
const PUBLICATION_CLEANUP_MUTATION_LIMIT = COMMIT_ORDINAL_RETENTION + 2;
const EMPTY_SHA256 = bytesToHex(sha256(new Uint8Array()));
const COMMON_OBJECT =
  /^parallax-install-v1\/objects\/common\/sha256\/([a-f0-9]{2})\/([a-f0-9]{64})\.(data|verified\.json)$/;
const GAME_OBJECT =
  /^parallax-install-v1\/objects\/games\/parallax\/sha256\/([a-f0-9]{2})\/([a-f0-9]{64})\.(data|verified\.json)$/;

export function unavailableInstallStoreTelemetrySnapshot(): InstallStoreTelemetrySnapshot {
  return freezeTelemetry(initialTelemetry("unavailable"));
}

export function createOpfsReleaseStore(
  platform: InstallStorePlatform = createBrowserInstallStorePlatform(),
  instrumentation?: InstallStoreInventoryInstrumentation,
): OpfsReleaseStore {
  const telemetry = initialTelemetry("idle");
  const inventory: LiveInventory = {
    partials: new Map(),
    readyReleases: new Set(),
    stagedReleases: new Set(),
    verifiedObjects: new Map(),
  };
  const releaseCache = new Map<string, ValidatedReleaseCache>();
  const listeners = new Set<(snapshot: InstallStoreTelemetrySnapshot) => void>();
  const resumedOffsets = new Map<string, number>();

  const cacheRelease = (
    releaseDigest: string,
    manifest: InstallManifest,
  ): ValidatedReleaseCache => {
    const cached = Object.freeze({
      manifest,
      releaseDigest,
      resourcesById: new Map(manifest.resources.map((resource) => [resource.id, resource])),
    });
    releaseCache.set(releaseDigest, cached);
    return cached;
  };
  const requireCachedRelease = async (releaseDigest: string): Promise<ValidatedReleaseCache> => {
    const cached = releaseCache.get(releaseDigest);
    if (cached !== undefined) {
      if (cached.releaseDigest !== releaseDigest) {
        releaseCache.clear();
        throw new Error("Install-store manifest cache identity is contradictory");
      }
      return cached;
    }
    const manifest = await requireManifest(platform, releaseDigest, instrumentation);
    return cacheRelease(releaseDigest, manifest);
  };
  const requireCachedResource = async (
    releaseDigest: string,
    resourceId: string,
  ): Promise<InstallResource> => {
    const resource = (await requireCachedRelease(releaseDigest)).resourcesById.get(resourceId);
    if (resource === undefined || resource.target !== "opfs" || resource.scope === "app-shell") {
      throw new Error(`Release ${releaseDigest} has no OPFS resource ${resourceId}`);
    }
    return resource;
  };
  const validateActiveRelease = async (): Promise<ValidatedReleaseCache | null> => {
    const eligibleManifests = new Map<string, InstallManifest>();
    const activeReleaseDigest = await selectActiveRelease(platform, async (digest) => {
      const manifest = await eligibleReleaseManifest(platform, digest, instrumentation);
      if (manifest === null) return false;
      eligibleManifests.set(digest, manifest);
      return true;
    });
    if (activeReleaseDigest === null) return null;
    const manifest = eligibleManifests.get(activeReleaseDigest);
    if (manifest === undefined) {
      throw new Error("Install-store active release manifest was not retained");
    }
    return cacheRelease(activeReleaseDigest, manifest);
  };

  const publishTelemetry = (): void => {
    const current = freezeTelemetry(telemetry);
    for (const listener of listeners) {
      try {
        listener(current);
      } catch {
        // Observability is not allowed to change durable store behavior.
      }
    }
  };
  const operation = async <T>(
    state: InstallStoreTelemetrySnapshot["state"],
    releaseDigest: string | null,
    resourceId: string | null,
    body: () => Promise<T>,
  ): Promise<T> => {
    return platform.runExclusive(async () => {
      const started = platform.now();
      telemetry.state = state;
      telemetry.currentReleaseDigest = releaseDigest;
      telemetry.currentResourceId = resourceId;
      telemetry.failureMessage = null;
      publishTelemetry();
      try {
        return await body();
      } catch (error: unknown) {
        telemetry.state = "failed";
        telemetry.failureMessage = installStoreFailureMessage(error);
        if (error instanceof DOMException && error.name === "QuotaExceededError") {
          telemetry.quotaExceededCount += 1;
        }
        releaseCache.clear();
        try {
          await refreshInventory(platform, telemetry, inventory);
          await selection(platform, telemetry);
        } catch (recoveryError: unknown) {
          throw new AggregateError(
            [error, recoveryError],
            "Install-store operation and authoritative inventory recovery both failed",
          );
        }
        throw error;
      } finally {
        telemetry.lastOperationDurationMs = Math.max(0, platform.now() - started);
        telemetry.currentReleaseDigest = null;
        telemetry.currentResourceId = null;
        if (telemetry.state !== "failed") {
          telemetry.state = telemetry.readyReleaseCount > 0 ? "ready" : "idle";
        }
        publishTelemetry();
      }
    });
  };

  const api: OpfsReleaseStore = {
    admitActiveRelease: (releaseDigest) =>
      operation("reconciling", releaseDigest, null, async () => {
        const active = await validateActiveRelease();
        // Do not publish an active-only result into the active/previous telemetry pair:
        // that pair is updated only by operations that establish the complete selection.
        if (active?.releaseDigest !== releaseDigest) {
          throw new Error(
            `Installed runtime release ${releaseDigest} is not the exact active selection`,
          );
        }
        return active.manifest;
      }),
    admitRepairRelease: (releaseDigest) =>
      operation("reconciling", releaseDigest, null, async () => {
        const { admission, record, reference } = await requireRepairEligibility(
          platform,
          releaseDigest,
          instrumentation,
          telemetry,
        );
        try {
          await platform.remove(partialRoot(releaseDigest, record.resourceId), true);
          await refreshPartialInventory(
            platform,
            telemetry,
            inventory,
            releaseDigest,
            await requireCachedResource(releaseDigest, record.resourceId),
          );
          if (
            (
              await platform.list(partialRoot(releaseDigest, record.resourceId), {
                recursive: true,
              })
            ).length !== 0
          ) {
            throw new Error("Repair admission left partial or checkpoint residue");
          }
        } catch (error: unknown) {
          throw new InstallStoreIntegrityError(
            "Exact repair admission could not clear prior partial/checkpoint residue",
            { cause: error },
          );
        }
        await assertExclusiveRepairBoundary(
          platform,
          releaseDigest,
          await requireManifest(platform, releaseDigest, instrumentation),
          reference,
          telemetry,
        );
        return Object.freeze({
          ...admission,
          state: (await validatesObject(platform, reference))
            ? "completion-pending"
            : "repair-required",
        });
      }),
    abandonRelease: (releaseDigest) =>
      operation("staging", releaseDigest, null, async () => {
        await requireCachedRelease(releaseDigest);
        if (
          (await isReleaseReady(platform, releaseDigest)) ||
          (await isReleasePublished(platform, releaseDigest))
        ) {
          throw new Error("A ready or published release cannot be abandoned");
        }
        const committed = await committedReleaseDigests(platform);
        if (committed.has(releaseDigest)) {
          throw new Error("A committed release cannot be abandoned");
        }
        if (await isReleaseAbandoned(platform, releaseDigest)) return;
        const record: ReleaseAbandonedRecord = { releaseDigest, schemaVersion: 1 };
        await writeImmutableRecord(
          platform,
          releasePath(releaseDigest, "abandoned.json"),
          record,
          parseReleaseAbandonedRecord,
        );
        releaseCache.delete(releaseDigest);
        await refreshInventory(platform, telemetry, inventory);
      }),
    appendPartial: (input) =>
      operation("writing", input.releaseDigest, input.resourceId, async () => {
        if (!Number.isSafeInteger(input.expectedOffset) || input.expectedOffset < 0) {
          throw new Error("Partial append expectedOffset must be a non-negative safe integer");
        }
        if (!isStrongEtag(input.strongEtag)) {
          throw new Error("Partial append requires a valid strong ETag");
        }
        if (input.bytes.byteLength === 0) {
          throw new Error("Partial append bytes must not be empty");
        }
        const resource = await requireCachedResource(input.releaseDigest, input.resourceId);
        await assertReleaseNotAbandoned(platform, input.releaseDigest);
        const recovered = await recoverPartial(platform, input.releaseDigest, resource, telemetry);
        if (recovered.bytesCommitted !== input.expectedOffset) {
          throw new Error(
            `Partial append offset ${input.expectedOffset} does not match durable checkpoint ${recovered.bytesCommitted}`,
          );
        }
        if (recovered.strongEtag !== null && recovered.strongEtag !== input.strongEtag) {
          throw new Error("Partial append strong ETag does not match the durable checkpoint");
        }
        const next = safeAdd(input.expectedOffset, input.bytes.byteLength);
        if (next > resource.bytes)
          throw new Error("Partial append exceeds the expected object size");
        const dataPath = partialDataPath(input.releaseDigest, input.resourceId);
        const written = await platform.append(dataPath, input.expectedOffset, input.bytes);
        telemetry.writtenBytes = safeAdd(telemetry.writtenBytes, written);
        if (written !== input.bytes.byteLength) {
          throw new Error(
            `Short partial write: expected ${input.bytes.byteLength}, wrote ${written}`,
          );
        }
        await platform.flush(dataPath);
        const checkpoint = checkpointFor(input.releaseDigest, resource, next, input.strongEtag);
        await writeImmutableRecord(
          platform,
          checkpointPath(input.releaseDigest, input.resourceId, next),
          checkpoint,
          parsePartialCheckpointRecord,
        );
        telemetry.checkpointWriteCount = safeAdd(telemetry.checkpointWriteCount, 1);
        await pruneCheckpoints(platform, input.releaseDigest, resource, input.strongEtag, next);
        await refreshPartialInventory(
          platform,
          telemetry,
          inventory,
          input.releaseDigest,
          resource,
        );
        return partialSnapshot(input.releaseDigest, resource, next, input.strongEtag);
      }),
    beginPartial: (releaseDigest, resourceId) =>
      operation("writing", releaseDigest, resourceId, async () => {
        const resource = await requireCachedResource(releaseDigest, resourceId);
        await assertReleaseNotAbandoned(platform, releaseDigest);
        const recovered = await recoverPartial(platform, releaseDigest, resource, telemetry);
        const key = `${releaseDigest}/${resourceId}`;
        const previouslyCredited = resumedOffsets.get(key) ?? 0;
        if (recovered.bytesCommitted > previouslyCredited) {
          telemetry.resumedBytes = safeAdd(
            telemetry.resumedBytes,
            recovered.bytesCommitted - previouslyCredited,
          );
          resumedOffsets.set(key, recovered.bytesCommitted);
        }
        await refreshPartialInventory(platform, telemetry, inventory, releaseDigest, resource);
        return recovered;
      }),
    collectGarbage: ({ maxEntries }) =>
      operation("garbage-collecting", null, null, async () => {
        positiveBound(maxEntries, "maxEntries");
        const budget = createCleanupBudget(maxEntries);
        const commitWorkRemaining = await compactCommits(platform, budget);
        const candidates = await garbageCandidates(platform);
        let garbageRemoved = 0;
        for (const candidate of candidates) {
          if (!consumeCleanupMutation(budget)) break;
          await platform.remove(candidate.path);
          recordCleanupRemoval(budget, candidate.size);
          garbageRemoved += 1;
        }
        const result = {
          bytesRemoved: budget.bytesRemoved,
          entriesRemoved: budget.entriesRemoved,
          remainingWork: commitWorkRemaining || candidates.length > garbageRemoved,
        };
        telemetry.garbageCollectedBytes = safeAdd(
          telemetry.garbageCollectedBytes,
          budget.bytesRemoved,
        );
        telemetry.garbageCollectedEntries = safeAdd(
          telemetry.garbageCollectedEntries,
          budget.entriesRemoved,
        );
        telemetry.garbageCollectionRemaining = result.remainingWork;
        releaseCache.clear();
        await refreshInventory(platform, telemetry, inventory);
        return Object.freeze(result);
      }),
    completeRepairRelease: (admission) =>
      operation("verifying", admission.releaseDigest, admission.resourceId, async () => {
        const exact = await requireRepairEligibility(
          platform,
          admission.releaseDigest,
          instrumentation,
          telemetry,
        );
        if (
          exact.admission.bytes !== admission.bytes ||
          exact.admission.recordSha256 !== admission.recordSha256 ||
          exact.admission.releaseDigest !== admission.releaseDigest ||
          exact.admission.resourceId !== admission.resourceId ||
          exact.admission.scope !== admission.scope ||
          exact.admission.sha256 !== admission.sha256
        ) {
          throw new InstallStoreIntegrityError(
            "Repair completion admission differs from its exact durable failure record",
          );
        }
        const manifest = await requireManifest(platform, admission.releaseDigest, instrumentation);
        await assertExclusiveRepairBoundary(
          platform,
          admission.releaseDigest,
          manifest,
          exact.reference,
          telemetry,
        );
        for (const resource of opfsResources(manifest)) {
          await assertExactAuthorizedReference(
            platform,
            objectReference(admission.releaseDigest, resource),
            telemetry,
          );
        }
        const cleanupFailures: unknown[] = [];
        try {
          await platform.remove(repairEligibilityPath(admission.releaseDigest));
          if ((await platform.size(repairEligibilityPath(admission.releaseDigest))) !== null) {
            throw new Error("Completed repair eligibility record remained after cleanup");
          }
        } catch (error: unknown) {
          cleanupFailures.push(error);
        }
        let selected: ReleaseSelection | null = null;
        let primaryFailure: unknown;
        try {
          releaseCache.clear();
          await refreshInventory(platform, telemetry, inventory);
          selected = await selection(platform, telemetry);
          if (
            selected.activeReleaseDigest !== admission.releaseDigest ||
            telemetry.activeReleaseDigest !== admission.releaseDigest ||
            telemetry.readyReleaseCount < 1
          ) {
            primaryFailure = new InstallStoreIntegrityError(
              "Repaired release did not restore exact ready inventory and active selection",
            );
          }
        } catch (error: unknown) {
          primaryFailure = error;
        }
        if (primaryFailure !== undefined || cleanupFailures.length !== 0) {
          throw new InstallStoreIntegrityError(
            "Repair completion or durable repair-record cleanup did not complete",
            {
              cause: new AggregateError(
                [...(primaryFailure === undefined ? [] : [primaryFailure]), ...cleanupFailures],
                "Repair completion retained every exact primary and cleanup failure",
              ),
            },
          );
        }
        return selected as ReleaseSelection;
      }),
    discardPartial: (releaseDigest, resourceId) =>
      operation("writing", releaseDigest, resourceId, async () => {
        const resource = await requireCachedResource(releaseDigest, resourceId);
        await assertReleaseNotAbandoned(platform, releaseDigest);
        await platform.remove(partialRoot(releaseDigest, resourceId), true);
        await refreshPartialInventory(platform, telemetry, inventory, releaseDigest, resource);
      }),
    finalizePartial: (releaseDigest, resourceId) =>
      operation("verifying", releaseDigest, resourceId, async () => {
        const resource = await requireCachedResource(releaseDigest, resourceId);
        await assertReleaseNotAbandoned(platform, releaseDigest);
        const reference = objectReference(releaseDigest, resource);
        if (await validatesObject(platform, reference)) {
          telemetry.reusedBytes = safeAdd(telemetry.reusedBytes, resource.bytes);
          await platform.remove(partialRoot(releaseDigest, resourceId), true);
          await refreshPartialInventory(platform, telemetry, inventory, releaseDigest, resource);
          await refreshVerifiedObjectInventory(platform, telemetry, inventory, reference);
          return reference;
        }
        const recovered = await recoverPartial(platform, releaseDigest, resource, telemetry);
        if (recovered.bytesCommitted !== resource.bytes) {
          throw new Error("Cannot finalize an incomplete partial");
        }
        const partial = partialDataPath(releaseDigest, resourceId);
        const digest = await hashPath(platform, partial, telemetry);
        if (digest.sha256 !== resource.sha256 || digest.bytes !== resource.bytes) {
          telemetry.integrityFailures += 1;
          const integrityError = new InstallStoreIntegrityError(
            "Partial object failed exact size/SHA-256 verification",
          );
          try {
            await platform.remove(partialRoot(releaseDigest, resourceId), true);
            await refreshPartialInventory(platform, telemetry, inventory, releaseDigest, resource);
          } catch (cleanupError: unknown) {
            throw new InstallStoreIntegrityError(
              "Partial object failed exact size/SHA-256 verification and corrupt partial cleanup did not complete",
              {
                cause: new AggregateError(
                  [integrityError, cleanupError],
                  "Corrupt partial verification and cleanup retained exact failures",
                ),
              },
            );
          }
          throw integrityError;
        }
        await platform.remove(verifiedPath(reference));
        await platform.remove(reference.path);
        let offset = 0;
        for await (const chunk of platform.readChunks(partial, HASH_CHUNK_BYTES)) {
          const written = await platform.append(reference.path, offset, chunk);
          if (written !== chunk.byteLength) throw new Error("Short object publication write");
          offset = safeAdd(offset, written);
        }
        await platform.flush(reference.path);
        const reread = await hashPath(platform, reference.path, telemetry);
        if (reread.bytes !== resource.bytes || reread.sha256 !== resource.sha256) {
          telemetry.integrityFailures += 1;
          await platform.remove(verifiedPath(reference));
          await platform.remove(reference.path);
          throw new InstallStoreIntegrityError("Published object failed exact reread verification");
        }
        const marker: VerifiedObjectRecord = {
          bytes: resource.bytes,
          schemaVersion: 1,
          scope: reference.scope,
          sha256: resource.sha256,
        };
        await writeImmutableRecord(
          platform,
          verifiedPath(reference),
          marker,
          parseVerifiedObjectRecord,
        );
        await platform.remove(partialRoot(releaseDigest, resourceId), true);
        await refreshPartialInventory(platform, telemetry, inventory, releaseDigest, resource);
        await refreshVerifiedObjectInventory(platform, telemetry, inventory, reference);
        return reference;
      }),
    findRepairRelease: (releaseDigest) =>
      operation("reconciling", releaseDigest, null, async () => {
        if ((await platform.size(repairEligibilityPath(releaseDigest))) === null) return null;
        const exact = await requireRepairEligibility(
          platform,
          releaseDigest,
          instrumentation,
          telemetry,
        );
        try {
          await platform.remove(partialRoot(releaseDigest, exact.record.resourceId), true);
          await refreshPartialInventory(
            platform,
            telemetry,
            inventory,
            releaseDigest,
            await requireCachedResource(releaseDigest, exact.record.resourceId),
          );
          if (
            (
              await platform.list(partialRoot(releaseDigest, exact.record.resourceId), {
                recursive: true,
              })
            ).length !== 0
          ) {
            throw new Error("Repair discovery left partial or checkpoint residue");
          }
        } catch (error: unknown) {
          throw new InstallStoreIntegrityError(
            "Exact repair discovery could not clear prior partial/checkpoint residue",
            { cause: error },
          );
        }
        await assertExclusiveRepairBoundary(
          platform,
          releaseDigest,
          await requireManifest(platform, releaseDigest, instrumentation),
          exact.reference,
          telemetry,
        );
        return Object.freeze({
          ...exact.admission,
          state: (await validatesObject(platform, exact.reference))
            ? "completion-pending"
            : "repair-required",
        });
      }),
    getManifest: (releaseDigest) =>
      operation("reconciling", releaseDigest, null, async () => {
        await assertReleaseNotAbandoned(platform, releaseDigest);
        return (await requireCachedRelease(releaseDigest)).manifest;
      }),
    getActiveReleaseDigest: () =>
      operation("reconciling", null, null, async () => {
        // Active-only status is not a complete rollback selection and therefore must
        // not update the active/previous telemetry pair.
        return (await validateActiveRelease())?.releaseDigest ?? null;
      }),
    getResource: (releaseDigest, resourceId) =>
      operation("verifying", releaseDigest, resourceId, async () => {
        const resource = await requireCachedResource(releaseDigest, resourceId);
        await assertReleaseNotAbandoned(platform, releaseDigest);
        const reference = objectReference(releaseDigest, resource);
        if (!(await validatesObject(platform, reference))) {
          throw new Error(`Resource ${resourceId} has no exact verified object`);
        }
        return reference;
      }),
    getResources: (releaseDigest, resourceIds) =>
      operation("verifying", releaseDigest, null, async () => {
        if (resourceIds.length === 0 || new Set(resourceIds).size !== resourceIds.length) {
          throw new Error("Resource batch must contain distinct resource IDs");
        }
        await assertReleaseNotAbandoned(platform, releaseDigest);
        const manifest = (await requireCachedRelease(releaseDigest)).manifest;
        const resourcesById = new Map(
          opfsResources(manifest).map((resource) => [resource.id, resource] as const),
        );
        const references: VerifiedObjectRef[] = [];
        for (const resourceId of resourceIds) {
          const resource = resourcesById.get(resourceId);
          if (resource === undefined) {
            throw new Error(`Release ${releaseDigest} has no OPFS resource ${resourceId}`);
          }
          const reference = objectReference(releaseDigest, resource);
          if (!(await validatesObject(platform, reference))) {
            throw new Error(`Resource ${resourceId} has no exact verified object`);
          }
          references.push(reference);
        }
        return Object.freeze(references);
      }),
    getSelection: () =>
      operation("reconciling", null, null, async () => selection(platform, telemetry)),
    markReleaseReady: (releaseDigest) =>
      operation("verifying", releaseDigest, null, async () => {
        const manifest = (await requireCachedRelease(releaseDigest)).manifest;
        await assertReleaseNotAbandoned(platform, releaseDigest);
        let opfsBytes = 0;
        let opfsResourceCount = 0;
        for (const resource of opfsResources(manifest)) {
          if (!(await validatesObject(platform, objectReference(releaseDigest, resource)))) {
            throw new Error(`Release ${releaseDigest} resource ${resource.id} is not verified`);
          }
          opfsBytes = safeAdd(opfsBytes, resource.bytes);
          opfsResourceCount += 1;
        }
        const record: ReleaseReadyRecord = {
          opfsBytes,
          opfsResourceCount,
          releaseDigest,
          schemaVersion: 1,
        };
        await writeImmutableRecord(
          platform,
          releasePath(releaseDigest, "ready.json"),
          record,
          parseReleaseReadyRecord,
        );
        inventory.readyReleases.add(releaseDigest);
        telemetry.readyReleaseCount = inventory.readyReleases.size;
        return Object.freeze({ ready: true, releaseDigest, staged: true });
      }),
    planRelease: (releaseDigest) =>
      operation("reconciling", releaseDigest, null, async () => {
        const manifest = (await requireCachedRelease(releaseDigest)).manifest;
        await assertReleaseNotAbandoned(platform, releaseDigest);
        let largestUnverifiedResourceBytes = 0;
        let missingBytes = 0;
        let missingResourceCount = 0;
        let partialBytes = 0;
        const partialResources: Array<{ bytesCommitted: number; resourceId: string }> = [];
        let partialResourceCount = 0;
        let reusedBytes = 0;
        const reusedResourceIds: string[] = [];
        let reusedResourceCount = 0;
        let totalBytes = 0;
        const resources = opfsResources(manifest);
        for (const resource of resources) {
          totalBytes = safeAdd(totalBytes, resource.bytes);
          const reference = objectReference(releaseDigest, resource);
          if (await validatesObject(platform, reference)) {
            reusedBytes = safeAdd(reusedBytes, resource.bytes);
            reusedResourceIds.push(resource.id);
            reusedResourceCount += 1;
            continue;
          }
          largestUnverifiedResourceBytes = Math.max(largestUnverifiedResourceBytes, resource.bytes);
          const partial = await recoverPartial(platform, releaseDigest, resource, telemetry);
          missingBytes = safeAdd(missingBytes, resource.bytes - partial.bytesCommitted);
          if (partial.bytesCommitted > 0) {
            partialBytes = safeAdd(partialBytes, partial.bytesCommitted);
            partialResources.push({
              bytesCommitted: partial.bytesCommitted,
              resourceId: resource.id,
            });
            partialResourceCount += 1;
          } else {
            missingResourceCount += 1;
          }
        }
        await refreshInventory(platform, telemetry, inventory);
        return Object.freeze({
          largestUnverifiedResourceBytes,
          missingBytes,
          missingResourceCount,
          partialBytes,
          partialResources: Object.freeze(partialResources.map((entry) => Object.freeze(entry))),
          partialResourceCount,
          reusedBytes,
          reusedResourceIds: Object.freeze(reusedResourceIds),
          reusedResourceCount,
          totalBytes,
          totalResourceCount: resources.length,
        });
      }),
    prepareResource: (releaseDigest, resourceId) =>
      operation("reconciling", releaseDigest, resourceId, async () => {
        const resource = await requireCachedResource(releaseDigest, resourceId);
        await assertReleaseNotAbandoned(platform, releaseDigest);
        const reference = objectReference(releaseDigest, resource);
        if (await validatesObject(platform, reference)) {
          await platform.remove(partialRoot(releaseDigest, resourceId), true);
          await refreshPartialInventory(platform, telemetry, inventory, releaseDigest, resource);
          await refreshVerifiedObjectInventory(platform, telemetry, inventory, reference);
          return Object.freeze({
            bytesCommitted: resource.bytes,
            expectedBytes: resource.bytes,
            reference,
            state: "verified" as const,
            strongEtag: null,
          });
        }
        const partial = await recoverPartial(platform, releaseDigest, resource, telemetry);
        const key = `${releaseDigest}/${resourceId}`;
        const previouslyCredited = resumedOffsets.get(key) ?? 0;
        if (partial.bytesCommitted > previouslyCredited) {
          telemetry.resumedBytes = safeAdd(
            telemetry.resumedBytes,
            partial.bytesCommitted - previouslyCredited,
          );
          resumedOffsets.set(key, partial.bytesCommitted);
        }
        await refreshPartialInventory(platform, telemetry, inventory, releaseDigest, resource);
        return Object.freeze({
          bytesCommitted: partial.bytesCommitted,
          expectedBytes: partial.expectedBytes,
          state: "partial" as const,
          strongEtag: partial.strongEtag,
        });
      }),
    probeQuota: (bytes) =>
      operation("writing", null, null, async () => {
        positiveBound(bytes, "quota probe bytes");
        if (bytes > MAX_QUOTA_PROBE_BYTES) {
          throw new Error(`quota probe bytes must not exceed ${MAX_QUOTA_PROBE_BYTES}`);
        }
        try {
          await platform.probe(new Uint8Array(bytes));
          return Object.freeze({ bytes, completed: true });
        } catch (error: unknown) {
          if (error instanceof DOMException && error.name === "QuotaExceededError") {
            telemetry.quotaExceededCount = safeAdd(telemetry.quotaExceededCount, 1);
            return Object.freeze({ bytes, completed: false });
          }
          throw error;
        }
      }),
    publishRelease: (releaseDigest) =>
      operation("publishing", releaseDigest, null, async () => {
        await assertReleaseNotAbandoned(platform, releaseDigest);
        if (!(await releaseEligible(platform, releaseDigest))) {
          throw new Error(`Release ${releaseDigest} is not eligible for publication`);
        }
        await appendCommit(platform, releaseDigest);
        await markReleasePublished(platform, releaseDigest);
        await compactCommits(platform, createCleanupBudget(PUBLICATION_CLEANUP_MUTATION_LIMIT));
        telemetry.publicationCount += 1;
        const selected = await selection(platform, telemetry);
        releaseCache.clear();
        return selected;
      }),
    reconcile: (options) =>
      operation("reconciling", null, null, async () => {
        releaseCache.clear();
        const maxCleanupEntries = options?.maxCleanupEntries ?? 128;
        nonnegativeBound(maxCleanupEntries, "maxCleanupEntries");
        let recoveredPartials = 0;
        const releases = await validStagedReleases(platform);
        for (const releaseDigest of releases) {
          const manifest = (await requireCachedRelease(releaseDigest)).manifest;
          for (const resource of opfsResources(manifest)) {
            const before = await platform.size(partialDataPath(releaseDigest, resource.id));
            if (before !== null) {
              const after = await recoverPartial(platform, releaseDigest, resource, telemetry);
              if (after.bytesCommitted !== before) recoveredPartials += 1;
            }
          }
        }
        const cleanup = createCleanupBudget(maxCleanupEntries);
        const repairWorkRemaining = await reconcileRepairEligibilityRecords(
          platform,
          cleanup,
          instrumentation,
          telemetry,
        );
        telemetry.reconciliationCount += 1;
        const top = new Set(
          (await platform.list(INSTALL_STORE_ROOT))
            .map((entry) => entry.path.split("/")[1])
            .filter((name): name is string => name !== undefined),
        );
        const unknownTopLevelPaths = [...top]
          .filter((name) => !["commits", "objects", "partials", "releases"].includes(name))
          .sort();
        const invalidWorkRemaining =
          repairWorkRemaining && cleanup.remaining === 0
            ? true
            : await cleanupInvalidRecords(platform, cleanup);
        const commitWorkRemaining =
          (repairWorkRemaining || invalidWorkRemaining) && cleanup.remaining === 0
            ? true
            : await compactCommits(platform, cleanup);
        const selected = await selection(platform, telemetry);
        await refreshInventory(platform, telemetry, inventory);
        return Object.freeze({
          ...selected,
          cleanupBytesRemoved: cleanup.bytesRemoved,
          cleanupEntriesRemoved: cleanup.entriesRemoved,
          cleanupMutations: cleanup.mutations,
          cleanupRemaining: repairWorkRemaining || invalidWorkRemaining || commitWorkRemaining,
          recoveredPartials,
          unknownTopLevelPaths,
        });
      }),
    rollbackToPrevious: () =>
      operation("publishing", null, null, async () => {
        const current = await selection(platform, telemetry);
        if (current.previousReleaseDigest === null) {
          throw new Error("No previous release is eligible for rollback");
        }
        await appendCommit(platform, current.previousReleaseDigest);
        await markReleasePublished(platform, current.previousReleaseDigest);
        await compactCommits(platform, createCleanupBudget(PUBLICATION_CLEANUP_MUTATION_LIMIT));
        telemetry.rollbackCount += 1;
        telemetry.publicationCount += 1;
        const selected = await selection(platform, telemetry);
        releaseCache.clear();
        return selected;
      }),
    snapshot: () => freezeTelemetry(telemetry),
    stageRelease: (manifestBytes) =>
      operation("staging", null, null, async () => {
        const releaseDigest = manifestDigest(manifestBytes, instrumentation);
        const manifest = parseStoredManifest(manifestBytes, instrumentation);
        if (manifest.gameId !== "parallax") throw new Error("Unsupported staged game");
        if (await isReleaseAbandoned(platform, releaseDigest)) {
          throw new Error("An abandoned release digest cannot be staged again");
        }
        const manifestPath = releasePath(releaseDigest, "install-manifest.json");
        const existing = await platform.read(manifestPath);
        const existingDigest = existing === null ? null : manifestDigest(existing, instrumentation);
        if (existingDigest !== null && existingDigest !== releaseDigest) {
          await platform.remove(manifestPath);
        }
        if (existingDigest !== releaseDigest) {
          await platform.writeRecord(manifestPath, manifestBytes);
        }
        const reread = await platform.read(manifestPath);
        if (reread === null || manifestDigest(reread, instrumentation) !== releaseDigest) {
          throw new Error("Staged manifest failed exact reread verification");
        }
        const validatedManifest = parseStoredManifest(reread, instrumentation);
        const staged: ReleaseStagedRecord = {
          gameId: "parallax",
          installManifestSchemaVersion: INSTALL_MANIFEST_SCHEMA_VERSION,
          releaseDigest,
          schemaVersion: 1,
        };
        await writeImmutableRecord(
          platform,
          releasePath(releaseDigest, "staged.json"),
          staged,
          parseReleaseStagedRecord,
        );
        inventory.stagedReleases.add(releaseDigest);
        telemetry.stagedReleaseCount = inventory.stagedReleases.size;
        cacheRelease(releaseDigest, validatedManifest);
        return Object.freeze({ ready: false, releaseDigest, staged: true });
      }),
    subscribe(listener) {
      listener(freezeTelemetry(telemetry));
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    verifyObject: (reference) =>
      operation("verifying", reference.releaseDigest, reference.resourceId, async () => {
        const resource = await requireCachedResource(reference.releaseDigest, reference.resourceId);
        await assertReleaseNotAbandoned(platform, reference.releaseDigest);
        const expected = objectReference(reference.releaseDigest, resource);
        assertReferenceIdentity(reference, expected);
        const integrity = await verifyReference(platform, expected, telemetry);
        if (!integrity.ok) {
          await refreshInventory(platform, telemetry, inventory);
          await selection(platform, telemetry);
        }
        return integrity;
      }),
    verifyRelease: (releaseDigest, listener) =>
      operation("verifying", releaseDigest, null, async () => {
        const manifest = (await requireCachedRelease(releaseDigest)).manifest;
        await assertReleaseNotAbandoned(platform, releaseDigest);
        const hasher = sha256.create();
        let bytes = 0;
        const resources = opfsResources(manifest);
        telemetry.finalVerificationBytes = 0;
        telemetry.finalVerificationPhase = "verifying";
        telemetry.finalVerificationResourceCount = 0;
        telemetry.finalVerificationTotalBytes = resources.reduce(
          (total, resource) => safeAdd(total, resource.bytes),
          0,
        );
        telemetry.finalVerificationTotalResourceCount = resources.length;
        publishTelemetry();
        for (const resource of resources) {
          const reference = objectReference(releaseDigest, resource);
          const integrity = await verifyReference(platform, reference, telemetry, (chunkBytes) => {
            telemetry.finalVerificationBytes = safeAdd(
              telemetry.finalVerificationBytes,
              chunkBytes,
            );
            publishTelemetry();
          });
          try {
            listener?.(reference, integrity);
          } catch {
            // Integrity observers cannot abort verification or durable marker invalidation.
          }
          if (!integrity.ok) {
            await refreshInventory(platform, telemetry, inventory);
            await selection(platform, telemetry);
            return Object.freeze({ bytes, ok: false, sha256: bytesToHex(hasher.digest()) });
          }
          hasher.update(new TextEncoder().encode(`${resource.sha256}:${resource.bytes}\n`));
          bytes = safeAdd(bytes, resource.bytes);
          telemetry.finalVerificationResourceCount += 1;
          publishTelemetry();
        }
        telemetry.finalVerificationPhase = "complete";
        publishTelemetry();
        return Object.freeze({ bytes, ok: true, sha256: bytesToHex(hasher.digest()) });
      }),
  };
  return Object.freeze(api);
}

async function requireManifest(
  platform: InstallStorePlatform,
  releaseDigest: string,
  instrumentation?: InstallStoreInventoryInstrumentation,
): Promise<InstallManifest> {
  if (!isInstallStoreDigest(releaseDigest)) throw new Error("Invalid release digest");
  const bytes = await platform.read(releasePath(releaseDigest, "install-manifest.json"));
  if (bytes === null || manifestDigest(bytes, instrumentation) !== releaseDigest) {
    throw new Error(`Release ${releaseDigest} has no exact install manifest`);
  }
  const staged = await readRecord(
    platform,
    releasePath(releaseDigest, "staged.json"),
    parseReleaseStagedRecord,
  );
  if (staged?.releaseDigest !== releaseDigest)
    throw new Error("Release has no valid staged marker");
  return parseStoredManifest(bytes, instrumentation);
}

function parseStoredManifest(
  bytes: Uint8Array,
  instrumentation?: InstallStoreInventoryInstrumentation,
): InstallManifest {
  instrumentation?.record("manifest-parse");
  const input = JSON.parse(textDecoder.decode(bytes)) as unknown;
  return parseInstallManifestDocument(input).manifest;
}

function manifestDigest(
  bytes: Uint8Array,
  instrumentation?: InstallStoreInventoryInstrumentation,
): string {
  instrumentation?.record("manifest-hash");
  return bytesToHex(sha256(bytes));
}

function checkpointFor(
  releaseDigest: string,
  resource: InstallResource,
  bytesCommitted: number,
  strongEtag: string,
): PartialCheckpointRecord {
  return Object.freeze({
    bytesCommitted,
    expectedBytes: resource.bytes,
    expectedSha256: resource.sha256,
    releaseDigest,
    resourceId: resource.id,
    schemaVersion: 2,
    source: resource.source,
    strongEtag,
  });
}

async function recoverPartial(
  platform: InstallStorePlatform,
  releaseDigest: string,
  resource: InstallResource,
  telemetry: TelemetryMutable,
): Promise<PartialSnapshot> {
  const dataPath = partialDataPath(releaseDigest, resource.id);
  const size = (await platform.size(dataPath)) ?? 0;
  const checkpoints = await platform.list(`${partialRoot(releaseDigest, resource.id)}/checkpoints`);
  const valid: Array<{ path: string; record: PartialCheckpointRecord }> = [];
  for (const entry of checkpoints) {
    if (entry.kind !== "file") continue;
    const name = entry.path.split("/").at(-1) ?? "";
    const match = CHECKPOINT_NAME.exec(name);
    if (
      match === null ||
      entry.path !== `${partialRoot(releaseDigest, resource.id)}/checkpoints/${match[0]}`
    ) {
      continue;
    }
    const record = await readRecord(platform, entry.path, parsePartialCheckpointRecord);
    if (
      record !== null &&
      record.bytesCommitted === Number(match[1]) &&
      record.bytesCommitted <= size &&
      record.expectedBytes === resource.bytes &&
      record.expectedSha256 === resource.sha256 &&
      record.releaseDigest === releaseDigest &&
      record.resourceId === resource.id &&
      record.source === resource.source
    ) {
      valid.push({ path: entry.path, record });
    }
  }
  const etags = new Set(valid.map(({ record }) => record.strongEtag));
  const acceptedStrongEtag = etags.size === 1 ? (valid[0]?.record.strongEtag ?? null) : null;
  const durable =
    acceptedStrongEtag === null
      ? 0
      : valid.reduce((maximum, { record }) => Math.max(maximum, record.bytesCommitted), 0);
  if (size > durable) {
    await platform.truncate(dataPath, durable);
    telemetry.recoveryCount += 1;
  }
  await pruneCheckpoints(platform, releaseDigest, resource, acceptedStrongEtag, durable);
  return partialSnapshot(releaseDigest, resource, durable, acceptedStrongEtag);
}

async function pruneCheckpoints(
  platform: InstallStorePlatform,
  releaseDigest: string,
  resource: InstallResource,
  acceptedStrongEtag: string | null,
  durable: number,
): Promise<void> {
  const root = `${partialRoot(releaseDigest, resource.id)}/checkpoints`;
  const validPaths: string[] = [];
  for (const entry of await platform.list(root)) {
    const match = CHECKPOINT_NAME.exec(entry.path.split("/").at(-1) ?? "");
    const record =
      entry.kind === "file" && entry.path.split("/").length === 6 && match !== null
        ? await readRecord(platform, entry.path, parsePartialCheckpointRecord)
        : null;
    if (
      record !== null &&
      record.bytesCommitted === Number(match?.[1]) &&
      record.expectedBytes === resource.bytes &&
      record.expectedSha256 === resource.sha256 &&
      record.releaseDigest === releaseDigest &&
      record.resourceId === resource.id &&
      record.source === resource.source &&
      record.strongEtag === acceptedStrongEtag &&
      record.bytesCommitted <= durable
    ) {
      validPaths.push(entry.path);
    } else if (entry.kind === "file") {
      await platform.remove(entry.path);
    }
  }
  validPaths.sort((left, right) => right.localeCompare(left));
  for (const path of validPaths.slice(CHECKPOINT_RETENTION)) {
    await platform.remove(path);
  }
}

function partialSnapshot(
  releaseDigest: string,
  resource: InstallResource,
  bytesCommitted: number,
  strongEtag: string | null,
): PartialSnapshot {
  return Object.freeze({
    bytesCommitted,
    expectedBytes: resource.bytes,
    releaseDigest,
    resourceId: resource.id,
    strongEtag,
  });
}

function objectReference(releaseDigest: string, resource: InstallResource): VerifiedObjectRef {
  if (resource.scope !== "common" && resource.scope !== "game-specific") {
    throw new Error("OPFS objects require common or game-specific scope");
  }
  const namespace = resource.scope === "common" ? "objects/common" : "objects/games/parallax";
  return Object.freeze({
    bytes: resource.bytes,
    path: `${INSTALL_STORE_ROOT}/${namespace}/sha256/${resource.sha256.slice(0, 2)}/${resource.sha256}.data`,
    releaseDigest,
    resourceId: resource.id,
    scope: resource.scope,
    sha256: resource.sha256,
  });
}

function verifiedPath(reference: VerifiedObjectRef): string {
  return reference.path.replace(/\.data$/, ".verified.json");
}

async function validatesObject(
  platform: InstallStorePlatform,
  reference: VerifiedObjectRef,
): Promise<boolean> {
  return markerMatchesObjectPath(
    platform,
    verifiedPath(reference),
    reference.scope,
    reference.sha256,
    reference.bytes,
  );
}

interface ParsedObjectPath {
  readonly extension: "data" | "verified.json";
  readonly scope: "common" | "game-specific";
  readonly sha256: string;
}

function parseObjectEntry(path: string): ParsedObjectPath | null {
  const common = COMMON_OBJECT.exec(path);
  const game = GAME_OBJECT.exec(path);
  const match = common ?? game;
  if (match === null || match[1] !== match[2]?.slice(0, 2)) return null;
  return {
    extension: match[3] as "data" | "verified.json",
    scope: common === null ? "game-specific" : "common",
    sha256: match[2] as string,
  };
}

async function markerMatchesObjectPath(
  platform: InstallStorePlatform,
  markerPath: string,
  scope: "common" | "game-specific",
  expectedSha256: string,
  expectedBytes?: number,
): Promise<boolean> {
  const parsed = parseObjectEntry(markerPath);
  if (
    parsed === null ||
    parsed.extension !== "verified.json" ||
    parsed.scope !== scope ||
    parsed.sha256 !== expectedSha256
  ) {
    return false;
  }
  const marker = await readRecord(platform, markerPath, parseVerifiedObjectRecord);
  if (
    marker === null ||
    marker.scope !== scope ||
    marker.sha256 !== expectedSha256 ||
    (expectedBytes !== undefined && marker.bytes !== expectedBytes)
  ) {
    return false;
  }
  const dataPath = markerPath.replace(/\.verified\.json$/, ".data");
  return (await platform.size(dataPath)) === marker.bytes;
}

function assertReferenceIdentity(supplied: VerifiedObjectRef, expected: VerifiedObjectRef): void {
  if (
    supplied.bytes !== expected.bytes ||
    supplied.path !== expected.path ||
    supplied.releaseDigest !== expected.releaseDigest ||
    supplied.resourceId !== expected.resourceId ||
    supplied.scope !== expected.scope ||
    supplied.sha256 !== expected.sha256
  ) {
    throw new Error("Verified object reference does not match its staged manifest resource");
  }
}

async function verifyReference(
  platform: InstallStorePlatform,
  reference: VerifiedObjectRef,
  telemetry: TelemetryMutable,
  onChunk?: (bytes: number) => void,
  options: Readonly<{ readonly recordRepairEligibility: boolean }> = {
    recordRepairEligibility: true,
  },
): Promise<IntegrityResult> {
  let result: { bytes: number; sha256: string };
  let reportedBytes = 0;
  const reportChunk =
    onChunk === undefined
      ? undefined
      : (bytes: number): void => {
          const reportable = Math.min(bytes, Math.max(0, reference.bytes - reportedBytes));
          if (reportable === 0) return;
          reportedBytes = safeAdd(reportedBytes, reportable);
          onChunk(reportable);
        };
  try {
    result = await hashPath(platform, reference.path, telemetry, reportChunk);
  } catch (error: unknown) {
    if (error instanceof InstallStorePathChangedError) {
      result = await hashPathWithoutTelemetry(platform, reference.path, reportChunk);
    } else {
      if (!(error instanceof InstallStorePathNotFoundError)) throw error;
      result = { bytes: 0, sha256: EMPTY_SHA256 };
    }
  }
  const ok = result.bytes === reference.bytes && result.sha256 === reference.sha256;
  if (!ok) {
    telemetry.integrityFailures += 1;
    const failures: unknown[] = [];
    if (options.recordRepairEligibility) {
      try {
        await recordRepairEligibility(platform, reference, result);
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    try {
      await platform.remove(verifiedPath(reference));
    } catch (error: unknown) {
      failures.push(error);
    }
    if (failures.length !== 0) {
      const primary = new InstallStoreIntegrityError(
        `Installed object ${reference.resourceId} failed exact integrity verification`,
      );
      throw new InstallStoreIntegrityError(
        "Corrupt object authorization revocation or durable repair admission did not complete",
        {
          cause: new AggregateError(
            [primary, ...failures],
            "Install-store corruption handling retained the primary and every cleanup failure",
          ),
        },
      );
    }
  }
  return Object.freeze({ ...result, ok });
}

async function recordRepairEligibility(
  platform: InstallStorePlatform,
  reference: VerifiedObjectRef,
  observed: Readonly<{ readonly bytes: number; readonly sha256: string }>,
): Promise<void> {
  const commit = await newestUnambiguousCommit(platform);
  if (commit === null || commit.record.releaseDigest !== reference.releaseDigest) return;
  const ready = await exactRecordBytes(
    platform,
    releasePath(reference.releaseDigest, "ready.json"),
    parseReleaseReadyRecord,
  );
  const published = await exactRecordBytes(
    platform,
    releasePath(reference.releaseDigest, "published.json"),
    parseReleasePublishedRecord,
  );
  const verified = await exactRecordBytes(
    platform,
    verifiedPath(reference),
    parseVerifiedObjectRecord,
  );
  if (
    ready === null ||
    published === null ||
    verified === null ||
    ready.record.releaseDigest !== reference.releaseDigest ||
    published.record.releaseDigest !== reference.releaseDigest ||
    verified.record.bytes !== reference.bytes ||
    verified.record.scope !== reference.scope ||
    verified.record.sha256 !== reference.sha256
  ) {
    return;
  }
  const record: ReleaseRepairEligibilityRecord = {
    bytes: reference.bytes,
    commitOrdinal: commit.record.ordinal,
    commitRecordSha256: commit.sha256,
    observedBytes: observed.bytes,
    observedSha256: observed.sha256,
    publishedRecordSha256: published.sha256,
    readyRecordSha256: ready.sha256,
    releaseDigest: reference.releaseDigest,
    resourceId: reference.resourceId,
    schemaVersion: 2,
    scope: reference.scope,
    sha256: reference.sha256,
    verifiedRecordSha256: verified.sha256,
  };
  await writeImmutableRecord(
    platform,
    repairEligibilityPath(reference.releaseDigest),
    record,
    parseReleaseRepairEligibilityRecord,
  );
}

async function requireRepairEligibility(
  platform: InstallStorePlatform,
  releaseDigest: string,
  instrumentation?: InstallStoreInventoryInstrumentation,
  telemetry?: TelemetryMutable,
  options?: { readonly deferAuthorizationRevocation?: boolean },
): Promise<
  Readonly<{
    readonly admission: Omit<InstallerRepairAdmission, "state">;
    readonly authorizationRevocation: Readonly<{
      readonly bytes: number;
      readonly path: string;
    }> | null;
    readonly record: ReleaseRepairEligibilityRecord;
    readonly reference: VerifiedObjectRef;
  }>
> {
  const eligibility = await exactRecordBytes(
    platform,
    repairEligibilityPath(releaseDigest),
    parseReleaseRepairEligibilityRecord,
  );
  if (eligibility === null || eligibility.record.releaseDigest !== releaseDigest) {
    throw new InstallStoreIntegrityError(
      "Repair requires an exact durable corruption eligibility record for the target release",
    );
  }
  const manifest = await requireManifest(platform, releaseDigest, instrumentation);
  const resource = manifest.resources.find(
    (candidate) => candidate.id === eligibility.record.resourceId,
  );
  if (
    resource === undefined ||
    resource.target !== "opfs" ||
    resource.scope === "app-shell" ||
    resource.bytes !== eligibility.record.bytes ||
    resource.scope !== eligibility.record.scope ||
    resource.sha256 !== eligibility.record.sha256
  ) {
    throw new InstallStoreIntegrityError(
      "Repair eligibility does not match the exact staged manifest resource",
    );
  }
  const reference = objectReference(releaseDigest, resource);
  const ready = await exactRecordBytes(
    platform,
    releasePath(releaseDigest, "ready.json"),
    parseReleaseReadyRecord,
  );
  const published = await exactRecordBytes(
    platform,
    releasePath(releaseDigest, "published.json"),
    parseReleasePublishedRecord,
  );
  const commit = await newestUnambiguousCommit(platform);
  if (
    ready === null ||
    published === null ||
    ready.record.releaseDigest !== releaseDigest ||
    published.record.releaseDigest !== releaseDigest ||
    ready.sha256 !== eligibility.record.readyRecordSha256 ||
    published.sha256 !== eligibility.record.publishedRecordSha256 ||
    commit === null ||
    commit.record.ordinal !== eligibility.record.commitOrdinal ||
    commit.record.releaseDigest !== releaseDigest ||
    commit.sha256 !== eligibility.record.commitRecordSha256
  ) {
    throw new InstallStoreIntegrityError(
      "Repair eligibility no longer identifies the exact ready/published/current commit target",
    );
  }
  const actual = await hashPathWithoutTelemetry(platform, reference.path);
  const objectIsExpected = actual.bytes === reference.bytes && actual.sha256 === reference.sha256;
  if (
    !objectIsExpected &&
    (actual.bytes !== eligibility.record.observedBytes ||
      actual.sha256 !== eligibility.record.observedSha256)
  ) {
    throw new InstallStoreIntegrityError(
      "Repair target no longer matches its exact invalidated object observation",
    );
  }
  const markerPath = verifiedPath(reference);
  const markerSize = await platform.size(markerPath);
  const marker =
    markerSize === null
      ? null
      : await exactRecordBytes(platform, markerPath, parseVerifiedObjectRecord);
  const markerIsRecorded =
    marker !== null &&
    marker.sha256 === eligibility.record.verifiedRecordSha256 &&
    marker.record.bytes === reference.bytes &&
    marker.record.scope === reference.scope &&
    marker.record.sha256 === reference.sha256;
  if (markerSize !== null && !markerIsRecorded) {
    throw new InstallStoreIntegrityError(
      "Repair target verified marker differs from its exact pre-revocation record",
    );
  }
  if (objectIsExpected && !markerIsRecorded) {
    throw new InstallStoreIntegrityError(
      "Repair completion has exact object bytes without the required verified marker",
    );
  }
  if (!objectIsExpected) {
    const authorizationRevocation =
      marker === null ? null : Object.freeze({ bytes: marker.bytes.byteLength, path: markerPath });
    if (options?.deferAuthorizationRevocation === true) {
      return Object.freeze({
        admission: Object.freeze({
          bytes: reference.bytes,
          recordSha256: eligibility.sha256,
          releaseDigest,
          resourceId: reference.resourceId,
          scope: reference.scope,
          sha256: reference.sha256,
        }),
        authorizationRevocation,
        record: eligibility.record,
        reference,
      });
    }
    const primary = new InstallStoreIntegrityError(
      "Installed object matches the exact durable corruption observation",
    );
    const recoveryFailures: unknown[] = [];
    if (markerIsRecorded) {
      try {
        await platform.remove(markerPath);
      } catch (error: unknown) {
        recoveryFailures.push(error);
      }
    }
    try {
      if ((await platform.size(markerPath)) !== null) {
        throw new Error("Corrupt object verified marker remained after repair reconciliation");
      }
    } catch (error: unknown) {
      recoveryFailures.push(error);
    }
    if (telemetry !== undefined) {
      try {
        await selection(platform, telemetry);
      } catch (error: unknown) {
        recoveryFailures.push(error);
      }
    }
    if (recoveryFailures.length !== 0) {
      throw new InstallStoreIntegrityError(
        "Durable repair reconciliation could not finish exact authorization revocation",
        {
          cause: new AggregateError(
            [primary, ...recoveryFailures],
            "Repair reconciliation retained the corruption primary and every cleanup failure",
          ),
        },
      );
    }
  }
  return Object.freeze({
    admission: Object.freeze({
      bytes: reference.bytes,
      recordSha256: eligibility.sha256,
      releaseDigest,
      resourceId: reference.resourceId,
      scope: reference.scope,
      sha256: reference.sha256,
    }),
    authorizationRevocation: null,
    record: eligibility.record,
    reference,
  });
}

async function reconcileRepairEligibilityRecords(
  platform: InstallStorePlatform,
  budget: CleanupBudget,
  instrumentation?: InstallStoreInventoryInstrumentation,
  telemetry?: TelemetryMutable,
): Promise<boolean> {
  const records = (await platform.list(`${INSTALL_STORE_ROOT}/releases`, { recursive: true }))
    .flatMap((entry) => {
      if (entry.kind !== "file") return [];
      const match =
        /^parallax-install-v1\/releases\/([a-f0-9]{64})\/repair-eligibility\.json$/.exec(
          entry.path,
        );
      const releaseDigest = match?.[1];
      return releaseDigest === undefined ? [] : [{ entry, releaseDigest }];
    })
    .sort((left, right) => left.entry.path.localeCompare(right.entry.path));
  if (records.length === 0) return false;

  const commits = await parsedCommitEntries(platform);
  const maximum = Math.max(0, ...commits.map(({ record }) => record.ordinal));
  const atMaximum = commits.filter(({ record }) => record.ordinal === maximum);
  if (atMaximum.length > 1) {
    throw new InstallStoreIntegrityError(
      "Repair reconciliation retained records because newest commit authority is ambiguous",
    );
  }
  const current = atMaximum[0];
  const currentBytes = current === undefined ? null : await platform.read(current.entry.path);
  if (current !== undefined && currentBytes === null) {
    throw new InstallStoreIntegrityError(
      "Repair reconciliation could not reread newest commit authority",
    );
  }
  const currentSha256 = currentBytes === null ? null : bytesToHex(sha256(currentBytes));

  const staleRecords: typeof records = [];
  let currentAuthorizationRevocation: Readonly<{
    readonly bytes: number;
    readonly path: string;
  }> | null = null;
  for (const { entry, releaseDigest } of records) {
    const eligibility = await exactRecordBytes(
      platform,
      entry.path,
      parseReleaseRepairEligibilityRecord,
    );
    const purportsCurrentAuthority =
      current !== undefined &&
      (releaseDigest === current.record.releaseDigest ||
        eligibility?.record.releaseDigest === current.record.releaseDigest ||
        eligibility?.record.commitOrdinal === current.record.ordinal ||
        eligibility?.record.commitRecordSha256 === currentSha256);
    if (purportsCurrentAuthority) {
      if (releaseDigest !== current.record.releaseDigest) {
        throw new InstallStoreIntegrityError(
          "Repair eligibility outside the current release purports to authorize current commit authority",
        );
      }
      const validated = await requireRepairEligibility(
        platform,
        releaseDigest,
        instrumentation,
        telemetry,
        { deferAuthorizationRevocation: true },
      );
      currentAuthorizationRevocation = validated.authorizationRevocation;
      continue;
    }
    staleRecords.push({ entry, releaseDigest });
  }

  let workRemaining = false;
  if (currentAuthorizationRevocation !== null) {
    if (!consumeCleanupMutation(budget)) {
      workRemaining = true;
    } else {
      await platform.remove(currentAuthorizationRevocation.path);
      if ((await platform.size(currentAuthorizationRevocation.path)) !== null) {
        throw new InstallStoreIntegrityError(
          "Corrupt object verified marker remained after budgeted repair reconciliation",
        );
      }
      recordCleanupRemoval(budget, currentAuthorizationRevocation.bytes);
    }
  }
  for (const { entry } of staleRecords) {
    if (!consumeCleanupMutation(budget)) {
      workRemaining = true;
      continue;
    }
    await platform.remove(entry.path);
    recordCleanupRemoval(budget, entry.size);
  }
  return workRemaining;
}

async function assertExclusiveRepairBoundary(
  platform: InstallStorePlatform,
  releaseDigest: string,
  manifest: InstallManifest,
  admitted: VerifiedObjectRef,
  telemetry?: TelemetryMutable,
): Promise<void> {
  const repairRecords = (
    await platform.list(`${INSTALL_STORE_ROOT}/releases`, { recursive: true })
  ).filter((entry) => entry.kind === "file" && entry.path.endsWith("/repair-eligibility.json"));
  if (
    repairRecords.length !== 1 ||
    repairRecords[0]?.path !== repairEligibilityPath(releaseDigest)
  ) {
    throw new InstallStoreIntegrityError(
      "Repair admission requires exactly one target repair record and no competing record",
    );
  }
  const residue = await platform.list(`${INSTALL_STORE_ROOT}/partials`, {
    recursive: true,
  });
  if (residue.some((entry) => entry.kind !== "directory")) {
    throw new InstallStoreIntegrityError(
      "Repair admission rejects unrelated partial or checkpoint residue",
    );
  }
  for (const resource of opfsResources(manifest)) {
    if (resource.id === admitted.resourceId) continue;
    await assertExactAuthorizedReference(
      platform,
      objectReference(releaseDigest, resource),
      telemetry,
    );
  }
}

async function assertExactAuthorizedReference(
  platform: InstallStorePlatform,
  reference: VerifiedObjectRef,
  telemetry?: TelemetryMutable,
): Promise<void> {
  const markerPath = verifiedPath(reference);
  const markerSize = await platform.size(markerPath);
  const marker =
    markerSize === null
      ? null
      : await exactRecordBytes(platform, markerPath, parseVerifiedObjectRecord);
  if (
    marker === null ||
    marker.record.bytes !== reference.bytes ||
    marker.record.scope !== reference.scope ||
    marker.record.sha256 !== reference.sha256
  ) {
    throw new InstallStoreIntegrityError(
      `Repair boundary rejects unverified resource ${reference.resourceId}`,
    );
  }
  let actual: { bytes: number; sha256: string };
  try {
    actual =
      telemetry === undefined
        ? await hashPathWithoutTelemetry(platform, reference.path)
        : await hashPath(platform, reference.path, telemetry);
  } catch (error: unknown) {
    if (!(error instanceof InstallStorePathNotFoundError)) throw error;
    throw new InstallStoreIntegrityError(
      `Repair boundary rejects missing resource ${reference.resourceId}`,
      { cause: error },
    );
  }
  if (actual.bytes !== reference.bytes || actual.sha256 !== reference.sha256) {
    throw new InstallStoreIntegrityError(
      `Repair boundary rejects corrupt resource ${reference.resourceId}`,
    );
  }
}

async function releaseEligible(
  platform: InstallStorePlatform,
  releaseDigest: string,
): Promise<boolean> {
  return (await eligibleReleaseManifest(platform, releaseDigest)) !== null;
}

async function eligibleReleaseManifest(
  platform: InstallStorePlatform,
  releaseDigest: string,
  instrumentation?: InstallStoreInventoryInstrumentation,
): Promise<InstallManifest | null> {
  try {
    if ((await platform.size(repairEligibilityPath(releaseDigest))) !== null) return null;
    if (await isReleaseAbandoned(platform, releaseDigest)) return null;
    const manifest = await requireManifest(platform, releaseDigest, instrumentation);
    const ready = await readRecord(
      platform,
      releasePath(releaseDigest, "ready.json"),
      parseReleaseReadyRecord,
    );
    if (ready?.releaseDigest !== releaseDigest) return null;
    let bytes = 0;
    let count = 0;
    for (const resource of opfsResources(manifest)) {
      if (!(await validatesObject(platform, objectReference(releaseDigest, resource)))) return null;
      bytes = safeAdd(bytes, resource.bytes);
      count += 1;
    }
    return ready.opfsBytes === bytes && ready.opfsResourceCount === count ? manifest : null;
  } catch {
    return null;
  }
}

async function selectActiveRelease(
  platform: InstallStorePlatform,
  eligible: (releaseDigest: string) => Promise<boolean>,
): Promise<string | null> {
  const byOrdinal = new Map<number, ParsedCommitEntry[]>();
  for (const candidate of await parsedCommitEntries(platform)) {
    const candidates = byOrdinal.get(candidate.record.ordinal) ?? [];
    candidates.push(candidate);
    byOrdinal.set(candidate.record.ordinal, candidates);
  }
  const eligibility = new Map<string, boolean>();
  for (const ordinal of [...byOrdinal.keys()].sort((left, right) => right - left)) {
    const candidates = byOrdinal.get(ordinal) ?? [];
    const eligibleCandidates: ParsedCommitEntry[] = [];
    for (const candidate of candidates) {
      let accepted = eligibility.get(candidate.record.releaseDigest);
      if (accepted === undefined) {
        accepted = await eligible(candidate.record.releaseDigest);
        eligibility.set(candidate.record.releaseDigest, accepted);
      }
      if (accepted) eligibleCandidates.push(candidate);
    }
    if (eligibleCandidates.length === 1) {
      return eligibleCandidates[0]?.record.releaseDigest ?? null;
    }
  }
  return null;
}

async function isReleaseAbandoned(
  platform: InstallStorePlatform,
  releaseDigest: string,
): Promise<boolean> {
  const record = await readRecord(
    platform,
    releasePath(releaseDigest, "abandoned.json"),
    parseReleaseAbandonedRecord,
  );
  return record?.releaseDigest === releaseDigest;
}

async function assertReleaseNotAbandoned(
  platform: InstallStorePlatform,
  releaseDigest: string,
): Promise<void> {
  if (await isReleaseAbandoned(platform, releaseDigest)) {
    throw new Error(`Release ${releaseDigest} is permanently abandoned`);
  }
}

async function isReleaseReady(
  platform: InstallStorePlatform,
  releaseDigest: string,
): Promise<boolean> {
  const record = await readRecord(
    platform,
    releasePath(releaseDigest, "ready.json"),
    parseReleaseReadyRecord,
  );
  return record?.releaseDigest === releaseDigest;
}

async function isReleasePublished(
  platform: InstallStorePlatform,
  releaseDigest: string,
): Promise<boolean> {
  const record = await readRecord(
    platform,
    releasePath(releaseDigest, "published.json"),
    parseReleasePublishedRecord,
  );
  return record?.releaseDigest === releaseDigest;
}

async function markReleasePublished(
  platform: InstallStorePlatform,
  releaseDigest: string,
): Promise<void> {
  const record: ReleasePublishedRecord = { releaseDigest, schemaVersion: 1 };
  await writeImmutableRecord(
    platform,
    releasePath(releaseDigest, "published.json"),
    record,
    parseReleasePublishedRecord,
  );
}

async function appendCommit(platform: InstallStorePlatform, releaseDigest: string): Promise<void> {
  const entries = await platform.list(`${INSTALL_STORE_ROOT}/commits`);
  let maximum = 0;
  for (const entry of entries) {
    if (entry.kind !== "file" || entry.path.split("/").length !== 3) continue;
    const match = COMMIT_NAME.exec(entry.path.split("/").at(-1) ?? "");
    if (match !== null) maximum = Math.max(maximum, Number(match[1]));
  }
  if (!Number.isSafeInteger(maximum) || maximum >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Commit ordinal namespace is exhausted");
  }
  const ordinal = maximum + 1;
  const record: ReleaseCommitRecord = { ordinal, releaseDigest, schemaVersion: 1 };
  await writeImmutableRecord(
    platform,
    `${INSTALL_STORE_ROOT}/commits/${formatInstallStoreOrdinal(ordinal)}-${releaseDigest}.json`,
    record,
    parseReleaseCommitRecord,
  );
}

interface ParsedCommitEntry {
  readonly entry: InstallStorePlatformEntry;
  readonly record: ReleaseCommitRecord;
}

interface ExactRecordBytes<T> {
  readonly bytes: Uint8Array;
  readonly record: T;
  readonly sha256: string;
}

async function parsedCommitEntries(platform: InstallStorePlatform): Promise<ParsedCommitEntry[]> {
  const commits: ParsedCommitEntry[] = [];
  for (const entry of await platform.list(`${INSTALL_STORE_ROOT}/commits`)) {
    if (entry.kind !== "file" || entry.path.split("/").length !== 3) continue;
    const match = COMMIT_NAME.exec(entry.path.split("/").at(-1) ?? "");
    if (match === null) continue;
    const record = await readRecord(platform, entry.path, parseReleaseCommitRecord);
    if (
      record !== null &&
      record.ordinal === Number(match[1]) &&
      record.releaseDigest === match[2]
    ) {
      commits.push({ entry, record });
    }
  }
  return commits;
}

async function newestUnambiguousCommit(
  platform: InstallStorePlatform,
): Promise<(ParsedCommitEntry & Readonly<{ readonly sha256: string }>) | null> {
  const parsed = await parsedCommitEntries(platform);
  const maximum = Math.max(0, ...parsed.map(({ record }) => record.ordinal));
  const atMaximum = parsed.filter(({ record }) => record.ordinal === maximum);
  if (atMaximum.length !== 1) return null;
  const newest = atMaximum[0];
  if (newest === undefined) return null;
  const bytes = await platform.read(newest.entry.path);
  if (bytes === null) return null;
  return Object.freeze({
    ...newest,
    sha256: bytesToHex(sha256(bytes)),
  });
}

async function compactCommits(
  platform: InstallStorePlatform,
  budget: CleanupBudget,
): Promise<boolean> {
  const parsed = await parsedCommitEntries(platform);
  const repairDigests = new Set<string>();
  for (const { record } of parsed) {
    if (
      !(await isReleasePublished(platform, record.releaseDigest)) &&
      (await isReleaseReady(platform, record.releaseDigest)) &&
      (await platform.size(releasePath(record.releaseDigest, "install-manifest.json"))) !== null
    ) {
      repairDigests.add(record.releaseDigest);
    }
  }
  const repairs = [...repairDigests].sort();
  let repairsCompleted = 0;
  for (const releaseDigest of repairs) {
    if (!consumeCleanupMutation(budget)) return true;
    await markReleasePublished(platform, releaseDigest);
    repairsCompleted += 1;
  }
  if (repairsCompleted < repairs.length) return true;

  const ordinals = [...new Set(parsed.map(({ record }) => record.ordinal))].sort(
    (left, right) => right - left,
  );
  const retainedOrdinals = new Set(ordinals.slice(0, COMMIT_ORDINAL_RETENTION));
  const retainPaths = new Set(
    parsed
      .filter(({ record }) => retainedOrdinals.has(record.ordinal))
      .map(({ entry }) => entry.path),
  );
  const eligible: ParsedCommitEntry[] = [];
  for (const candidate of parsed) {
    if (await releaseEligible(platform, candidate.record.releaseDigest)) eligible.push(candidate);
  }
  const ordinalCounts = new Map<number, number>();
  for (const candidate of eligible) {
    ordinalCounts.set(
      candidate.record.ordinal,
      (ordinalCounts.get(candidate.record.ordinal) ?? 0) + 1,
    );
  }
  const unambiguous = eligible
    .filter((candidate) => ordinalCounts.get(candidate.record.ordinal) === 1)
    .sort((left, right) => right.record.ordinal - left.record.ordinal);
  const active = unambiguous[0];
  const previous = unambiguous.find(
    (candidate) => candidate.record.releaseDigest !== active?.record.releaseDigest,
  );
  for (const candidate of [active, previous]) {
    if (candidate !== undefined) retainPaths.add(candidate.entry.path);
  }
  const removals = parsed
    .filter(({ entry }) => !retainPaths.has(entry.path))
    .sort((left, right) => left.entry.path.localeCompare(right.entry.path));
  let removalsCompleted = 0;
  for (const { entry } of removals) {
    if (!consumeCleanupMutation(budget)) return true;
    await platform.remove(entry.path);
    recordCleanupRemoval(budget, entry.size);
    removalsCompleted += 1;
  }
  return removalsCompleted < removals.length;
}

async function selection(
  platform: InstallStorePlatform,
  telemetry: TelemetryMutable,
): Promise<ReleaseSelection> {
  const commits: ReleaseCommitRecord[] = [];
  for (const { record } of await parsedCommitEntries(platform)) {
    if (await releaseEligible(platform, record.releaseDigest)) {
      commits.push(record);
    }
  }
  const ordinalCounts = new Map<number, number>();
  for (const commit of commits) {
    ordinalCounts.set(commit.ordinal, (ordinalCounts.get(commit.ordinal) ?? 0) + 1);
  }
  const unambiguous = commits
    .filter((commit) => ordinalCounts.get(commit.ordinal) === 1)
    .sort((left, right) => right.ordinal - left.ordinal);
  const active = unambiguous[0]?.releaseDigest ?? null;
  const previous =
    unambiguous.find((commit) => commit.releaseDigest !== active)?.releaseDigest ?? null;
  telemetry.activeReleaseDigest = active;
  telemetry.previousReleaseDigest = previous;
  return Object.freeze({ activeReleaseDigest: active, previousReleaseDigest: previous });
}

async function validStagedReleases(platform: InstallStorePlatform): Promise<string[]> {
  const releases = new Set<string>();
  for (const entry of await platform.list(`${INSTALL_STORE_ROOT}/releases`)) {
    const parts = entry.path.split("/");
    const digest = parts[2];
    if (
      entry.kind === "directory" &&
      parts.length === 3 &&
      digest !== undefined &&
      isInstallStoreDigest(digest)
    ) {
      try {
        await requireManifest(platform, digest);
        releases.add(digest);
      } catch {
        // Torn or invalid releases are not roots.
      }
    }
  }
  return [...releases].sort();
}

async function garbageCandidates(
  platform: InstallStorePlatform,
): Promise<readonly { path: string; size: number }[]> {
  const placeholder = initialTelemetry("idle");
  const selected = await selection(platform, placeholder);
  const liveReleases = new Set<string>(
    [selected.activeReleaseDigest, selected.previousReleaseDigest].filter(
      (value): value is string => value !== null,
    ),
  );
  const publishedReleases = await committedReleaseDigests(platform);
  for (const digest of await validStagedReleases(platform)) {
    if (await isReleaseAbandoned(platform, digest)) continue;
    const repairPending =
      publishedReleases.has(digest) && (await hasExactPendingRepairAuthority(platform, digest));
    if (
      repairPending ||
      (!(await isReleasePublished(platform, digest)) && !publishedReleases.has(digest))
    ) {
      liveReleases.add(digest);
    }
  }
  const liveObjects = new Set<string>();
  for (const digest of liveReleases) {
    try {
      const manifest = await requireManifest(platform, digest);
      for (const resource of opfsResources(manifest)) {
        const reference = objectReference(digest, resource);
        liveObjects.add(reference.path);
        liveObjects.add(verifiedPath(reference));
      }
    } catch {
      // Invalid metadata cannot authorize retention.
    }
  }
  const entries = await platform.list(INSTALL_STORE_ROOT, { recursive: true });
  const candidates = new Map<string, { path: string; priority: number; size: number }>();
  const safeDirectoryRoots = new Set<string>();
  const unsafeDirectoryRoots = new Set<string>();
  for (const entry of entries) {
    const parts = entry.path.split("/");
    const releaseDigest = parts[2];
    if (
      (parts[1] === "releases" || parts[1] === "partials") &&
      releaseDigest !== undefined &&
      isInstallStoreDigest(releaseDigest) &&
      !liveReleases.has(releaseDigest)
    ) {
      const root = `${INSTALL_STORE_ROOT}/${parts[1]}/${releaseDigest}`;
      const recognized =
        parts[1] === "releases"
          ? isCanonicalReleaseEntry(entry, releaseDigest)
          : isCanonicalPartialEntry(entry, releaseDigest);
      if (recognized) {
        safeDirectoryRoots.add(root);
        if (entry.kind === "file") {
          candidates.set(entry.path, { path: entry.path, priority: 10, size: entry.size });
        }
      } else {
        unsafeDirectoryRoots.add(root);
      }
      continue;
    }
    if (entry.kind !== "file") continue;
    const object = parseObjectEntry(entry.path);
    if (object === null) continue;
    if (!liveObjects.has(entry.path)) {
      candidates.set(entry.path, {
        path: entry.path,
        priority: object.extension === "verified.json" ? 0 : 1,
        size: entry.size,
      });
    } else if (
      object.extension === "verified.json" &&
      !(await markerMatchesObjectPath(platform, entry.path, object.scope, object.sha256))
    ) {
      candidates.set(entry.path, { path: entry.path, priority: 0, size: entry.size });
    }
  }
  for (const root of safeDirectoryRoots) {
    if (unsafeDirectoryRoots.has(root)) continue;
    const directories = entries
      .filter(
        (entry) =>
          entry.kind === "directory" && (entry.path === root || entry.path.startsWith(`${root}/`)),
      )
      .sort((left, right) => right.path.split("/").length - left.path.split("/").length);
    for (const entry of directories) {
      candidates.set(entry.path, {
        path: entry.path,
        priority: 20 - entry.path.split("/").length,
        size: 0,
      });
    }
  }
  return [...candidates.values()]
    .sort((left, right) => left.priority - right.priority || left.path.localeCompare(right.path))
    .map(({ path, size }) => ({ path, size }));
}

async function hasExactPendingRepairAuthority(
  platform: InstallStorePlatform,
  releaseDigest: string,
): Promise<boolean> {
  if ((await platform.size(repairEligibilityPath(releaseDigest))) === null) return false;
  try {
    await requireRepairEligibility(platform, releaseDigest, undefined, undefined, {
      deferAuthorizationRevocation: true,
    });
    return true;
  } catch (error: unknown) {
    if (error instanceof InstallStoreIntegrityError) return false;
    throw error;
  }
}

function isCanonicalReleaseEntry(entry: InstallStorePlatformEntry, releaseDigest: string): boolean {
  const root = `${INSTALL_STORE_ROOT}/releases/${releaseDigest}`;
  if (entry.path === root) return entry.kind === "directory";
  if (entry.kind !== "file" || entry.path.split("/").length !== 4) return false;
  return [
    "abandoned.json",
    "install-manifest.json",
    "published.json",
    "ready.json",
    "repair-eligibility.json",
    "staged.json",
  ].includes(entry.path.slice(root.length + 1));
}

function isCanonicalPartialEntry(entry: InstallStorePlatformEntry, releaseDigest: string): boolean {
  const root = `${INSTALL_STORE_ROOT}/partials/${releaseDigest}`;
  if (!entry.path.startsWith(`${root}/`) && entry.path !== root) return false;
  const parts = entry.path.split("/");
  if (entry.kind === "directory") {
    return (
      parts.length === 3 || parts.length === 4 || (parts.length === 5 && parts[4] === "checkpoints")
    );
  }
  if (parts.length === 5 && parts[4] === "data.partial") return true;
  return parts.length === 6 && parts[4] === "checkpoints" && CHECKPOINT_NAME.test(parts[5] ?? "");
}

async function committedReleaseDigests(platform: InstallStorePlatform): Promise<Set<string>> {
  const releases = new Set<string>();
  for (const { record } of await parsedCommitEntries(platform)) {
    releases.add(record.releaseDigest);
  }
  return releases;
}

async function refreshInventory(
  platform: InstallStorePlatform,
  telemetry: TelemetryMutable,
  inventory: LiveInventory,
): Promise<void> {
  const staged = await validStagedReleases(platform);
  const readyReleases = new Set<string>();
  for (const digest of staged) {
    if (await releaseEligible(platform, digest)) readyReleases.add(digest);
  }
  let partialBytes = 0;
  let partialResourceCount = 0;
  let currentCheckpointCount = 0;
  const etagBoundPartials = new Set<string>();
  const partialInventory = new Map<string, PartialInventoryEntry>();
  const partialEntries = await platform.list(`${INSTALL_STORE_ROOT}/partials`, {
    recursive: true,
  });
  for (const entry of partialEntries) {
    if (
      entry.kind === "file" &&
      /^parallax-install-v1\/partials\/[a-f0-9]{64}\/[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?\/data\.partial$/.test(
        entry.path,
      )
    ) {
      partialBytes = safeAdd(partialBytes, entry.size);
      partialResourceCount += 1;
      const parts = entry.path.split("/");
      const key = `${parts[2]}/${parts[3]}`;
      const current = partialInventory.get(key);
      partialInventory.set(key, {
        bytes: entry.size,
        checkpointCount: current?.checkpointCount ?? 0,
        dataPresent: true,
        etagBound: current?.etagBound ?? false,
      });
    }
    const checkpointMatch =
      entry.kind === "file"
        ? /^parallax-install-v1\/partials\/([a-f0-9]{64})\/([a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?)\/checkpoints\/[0-9]{20}\.json$/.exec(
            entry.path,
          )
        : null;
    if (
      checkpointMatch !== null &&
      (await readRecord(platform, entry.path, parsePartialCheckpointRecord)) !== null
    ) {
      currentCheckpointCount += 1;
      const key = `${checkpointMatch[1]}/${checkpointMatch[2]}`;
      etagBoundPartials.add(key);
      const current = partialInventory.get(key) ?? {
        bytes: 0,
        checkpointCount: 0,
        dataPresent: false,
        etagBound: false,
      };
      partialInventory.set(key, {
        bytes: current.bytes,
        checkpointCount: current.checkpointCount + 1,
        dataPresent: current.dataPresent,
        etagBound: true,
      });
    }
  }
  let verifiedObjectBytes = 0;
  let verifiedObjectCount = 0;
  const verifiedObjects = new Map<string, number>();
  for (const entry of await platform.list(`${INSTALL_STORE_ROOT}/objects`, {
    recursive: true,
  })) {
    if (entry.kind !== "file") continue;
    const object = parseObjectEntry(entry.path);
    if (
      object?.extension === "verified.json" &&
      (await markerMatchesObjectPath(platform, entry.path, object.scope, object.sha256))
    ) {
      const marker = await readRecord(platform, entry.path, parseVerifiedObjectRecord);
      if (marker === null) continue;
      verifiedObjectBytes = safeAdd(verifiedObjectBytes, marker.bytes);
      verifiedObjectCount += 1;
      verifiedObjects.set(entry.path, marker.bytes);
    }
  }
  telemetry.partialBytes = partialBytes;
  telemetry.partialResourceCount = partialResourceCount;
  telemetry.currentCheckpointCount = currentCheckpointCount;
  telemetry.etagBoundPartialCount = etagBoundPartials.size;
  telemetry.readyReleaseCount = readyReleases.size;
  telemetry.stagedReleaseCount = staged.length;
  telemetry.verifiedObjectBytes = verifiedObjectBytes;
  telemetry.verifiedObjectCount = verifiedObjectCount;
  inventory.partials.clear();
  for (const [key, value] of partialInventory) inventory.partials.set(key, value);
  inventory.readyReleases.clear();
  for (const digest of readyReleases) inventory.readyReleases.add(digest);
  inventory.stagedReleases.clear();
  for (const digest of staged) inventory.stagedReleases.add(digest);
  inventory.verifiedObjects.clear();
  for (const [path, bytes] of verifiedObjects) inventory.verifiedObjects.set(path, bytes);
}

async function refreshPartialInventory(
  platform: InstallStorePlatform,
  telemetry: TelemetryMutable,
  inventory: LiveInventory,
  releaseDigest: string,
  resource: InstallResource,
): Promise<void> {
  const key = `${releaseDigest}/${resource.id}`;
  const previous = inventory.partials.get(key);
  const root = partialRoot(releaseDigest, resource.id);
  const dataSize = await platform.size(partialDataPath(releaseDigest, resource.id));
  const dataBytes = dataSize ?? 0;
  const dataPresent = dataSize !== null;
  let checkpointCount = 0;
  let etagBound = false;
  for (const entry of await platform.list(`${root}/checkpoints`)) {
    if (entry.kind !== "file") continue;
    const match = CHECKPOINT_NAME.exec(entry.path.split("/").at(-1) ?? "");
    const record =
      match === null ? null : await readRecord(platform, entry.path, parsePartialCheckpointRecord);
    if (
      record !== null &&
      record.releaseDigest === releaseDigest &&
      record.resourceId === resource.id &&
      record.expectedBytes === resource.bytes &&
      record.expectedSha256 === resource.sha256 &&
      record.source === resource.source &&
      record.bytesCommitted === Number(match?.[1]) &&
      record.bytesCommitted <= dataBytes
    ) {
      checkpointCount += 1;
      etagBound = true;
    }
  }
  if (previous !== undefined) {
    telemetry.partialBytes -= previous.bytes;
    telemetry.partialResourceCount -= previous.dataPresent ? 1 : 0;
    telemetry.currentCheckpointCount -= previous.checkpointCount;
    telemetry.etagBoundPartialCount -= previous.etagBound ? 1 : 0;
  }
  if (!dataPresent && checkpointCount === 0) {
    inventory.partials.delete(key);
    return;
  }
  const next = { bytes: dataBytes, checkpointCount, dataPresent, etagBound };
  inventory.partials.set(key, next);
  telemetry.partialBytes = safeAdd(telemetry.partialBytes, dataBytes);
  telemetry.partialResourceCount += dataPresent ? 1 : 0;
  telemetry.currentCheckpointCount = safeAdd(telemetry.currentCheckpointCount, checkpointCount);
  telemetry.etagBoundPartialCount += etagBound ? 1 : 0;
}

async function refreshVerifiedObjectInventory(
  platform: InstallStorePlatform,
  telemetry: TelemetryMutable,
  inventory: LiveInventory,
  reference: VerifiedObjectRef,
): Promise<void> {
  const markerPath = verifiedPath(reference);
  const previous = inventory.verifiedObjects.get(markerPath);
  const valid = await validatesObject(platform, reference);
  if (previous !== undefined) {
    telemetry.verifiedObjectBytes -= previous;
    telemetry.verifiedObjectCount -= 1;
    inventory.verifiedObjects.delete(markerPath);
  }
  if (!valid) return;
  inventory.verifiedObjects.set(markerPath, reference.bytes);
  telemetry.verifiedObjectBytes = safeAdd(telemetry.verifiedObjectBytes, reference.bytes);
  telemetry.verifiedObjectCount += 1;
}

async function cleanupInvalidRecords(
  platform: InstallStorePlatform,
  budget: CleanupBudget,
): Promise<boolean> {
  const invalid: InstallStorePlatformEntry[] = [];
  for (const entry of await platform.list(`${INSTALL_STORE_ROOT}/commits`)) {
    if (entry.kind !== "file" || entry.path.split("/").length !== 3) {
      continue;
    }
    const match = COMMIT_NAME.exec(entry.path.split("/").at(-1) ?? "");
    const record =
      match === null ? null : await readRecord(platform, entry.path, parseReleaseCommitRecord);
    if (
      match === null ||
      record === null ||
      record.ordinal !== Number(match[1]) ||
      record.releaseDigest !== match[2]
    ) {
      invalid.push(entry);
    }
  }
  invalid.sort((left, right) => left.path.localeCompare(right.path));
  let removed = 0;
  for (const entry of invalid) {
    if (!consumeCleanupMutation(budget)) return true;
    await platform.remove(entry.path);
    recordCleanupRemoval(budget, entry.size);
    removed += 1;
  }
  return removed < invalid.length;
}

async function hashPath(
  platform: InstallStorePlatform,
  path: string,
  telemetry: TelemetryMutable,
  onChunk?: (bytes: number) => void,
): Promise<{ bytes: number; sha256: string }> {
  const hasher = sha256.create();
  let bytes = 0;
  for await (const chunk of platform.readChunks(path, HASH_CHUNK_BYTES)) {
    bytes = safeAdd(bytes, chunk.byteLength);
    hasher.update(chunk);
    onChunk?.(chunk.byteLength);
  }
  telemetry.hashedBytes = safeAdd(telemetry.hashedBytes, bytes);
  return { bytes, sha256: bytesToHex(hasher.digest()) };
}

async function hashPathWithoutTelemetry(
  platform: InstallStorePlatform,
  path: string,
  onChunk?: (bytes: number) => void,
): Promise<{ bytes: number; sha256: string }> {
  const hasher = sha256.create();
  let bytes = 0;
  try {
    for await (const chunk of platform.readChunks(path, HASH_CHUNK_BYTES)) {
      bytes = safeAdd(bytes, chunk.byteLength);
      hasher.update(chunk);
      onChunk?.(chunk.byteLength);
    }
  } catch (error: unknown) {
    if (!(error instanceof InstallStorePathNotFoundError)) throw error;
    return { bytes: 0, sha256: EMPTY_SHA256 };
  }
  return { bytes, sha256: bytesToHex(hasher.digest()) };
}

async function exactRecordBytes<T extends InstallStoreRecord>(
  platform: InstallStorePlatform,
  path: string,
  parse: (input: unknown) => T,
): Promise<ExactRecordBytes<T> | null> {
  const bytes = await platform.read(path);
  if (bytes === null) return null;
  try {
    const record = parseJsonRecord(bytes, parse);
    const canonical = serializeInstallStoreRecord(record);
    if (
      bytes.byteLength !== canonical.byteLength ||
      bytes.some((value, index) => value !== canonical[index])
    ) {
      return null;
    }
    return Object.freeze({
      bytes,
      record,
      sha256: bytesToHex(sha256(bytes)),
    });
  } catch {
    return null;
  }
}

async function writeImmutableRecord<T extends InstallStoreRecord>(
  platform: InstallStorePlatform,
  path: string,
  record: T,
  parse: (input: unknown) => T,
): Promise<void> {
  const bytes = serializeInstallStoreRecord(record);
  const existing = await platform.read(path);
  if (existing !== null) {
    try {
      const parsed = parseJsonRecord(existing, parse);
      if (canonicalInstallStoreRecord(parsed) !== canonicalInstallStoreRecord(record)) {
        throw new Error(`Refusing to replace immutable install-store record ${path}`);
      }
      return;
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message.startsWith("Refusing to replace immutable install-store record")
      ) {
        throw error;
      }
      try {
        await platform.remove(path);
      } catch (cleanupError: unknown) {
        throw new InstallStoreIntegrityError(
          `Invalid immutable install-store record ${path} could not be removed`,
          {
            cause: new AggregateError(
              [error, cleanupError],
              "Immutable record validation retained the primary and cleanup failure",
            ),
          },
        );
      }
    }
  }
  await platform.writeRecord(path, bytes);
  const reread = await platform.read(path);
  if (reread === null) throw new Error(`Install-store record ${path} disappeared`);
  const parsed = parseJsonRecord(reread, parse);
  if (canonicalInstallStoreRecord(parsed) !== canonicalInstallStoreRecord(record)) {
    throw new Error(`Install-store record ${path} failed exact reread validation`);
  }
}

async function readRecord<T>(
  platform: InstallStorePlatform,
  path: string,
  parse: (input: unknown) => T,
): Promise<T | null> {
  const bytes = await platform.read(path);
  if (bytes === null) return null;
  try {
    return parseJsonRecord(bytes, parse);
  } catch {
    return null;
  }
}

function opfsResources(manifest: InstallManifest): readonly InstallResource[] {
  return manifest.resources.filter((resource) => resource.target === "opfs");
}

function releasePath(releaseDigest: string, name: string): string {
  if (!isInstallStoreDigest(releaseDigest)) throw new Error("Invalid release digest");
  return `${INSTALL_STORE_ROOT}/releases/${releaseDigest}/${name}`;
}

function repairEligibilityPath(releaseDigest: string): string {
  return releasePath(releaseDigest, "repair-eligibility.json");
}

function partialRoot(releaseDigest: string, resourceId: string): string {
  return `${INSTALL_STORE_ROOT}/partials/${releaseDigest}/${resourceId}`;
}

function partialDataPath(releaseDigest: string, resourceId: string): string {
  return `${partialRoot(releaseDigest, resourceId)}/data.partial`;
}

function checkpointPath(releaseDigest: string, resourceId: string, bytesCommitted: number): string {
  const offset = String(bytesCommitted).padStart(20, "0");
  if (offset.length !== 20) throw new Error("Checkpoint offset exceeds the 20-digit namespace");
  return `${partialRoot(releaseDigest, resourceId)}/checkpoints/${offset}.json`;
}

function installStoreFailureMessage(error: unknown): string {
  const value = error instanceof Error && error.message !== "" ? error.message : String(error);
  return value === "" ? "Unknown install-store failure" : value;
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error("Install-store byte counter overflow");
  return result;
}

function positiveBound(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be positive`);
}

function nonnegativeBound(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function createCleanupBudget(maxMutations: number): CleanupBudget {
  nonnegativeBound(maxMutations, "cleanup mutation budget");
  return {
    bytesRemoved: 0,
    entriesRemoved: 0,
    mutations: 0,
    remaining: maxMutations,
  };
}

function consumeCleanupMutation(budget: CleanupBudget): boolean {
  if (budget.remaining === 0) return false;
  budget.remaining -= 1;
  budget.mutations += 1;
  return true;
}

function recordCleanupRemoval(budget: CleanupBudget, bytes: number): void {
  budget.bytesRemoved = safeAdd(budget.bytesRemoved, bytes);
  budget.entriesRemoved = safeAdd(budget.entriesRemoved, 1);
}

function initialTelemetry(state: InstallStoreTelemetrySnapshot["state"]): TelemetryMutable {
  return {
    activeReleaseDigest: null,
    checkpointWriteCount: 0,
    currentCheckpointCount: 0,
    currentReleaseDigest: null,
    currentResourceId: null,
    etagBoundPartialCount: 0,
    failureMessage: null,
    finalVerificationBytes: 0,
    finalVerificationPhase: "idle",
    finalVerificationResourceCount: 0,
    finalVerificationTotalBytes: 0,
    finalVerificationTotalResourceCount: 0,
    garbageCollectedBytes: 0,
    garbageCollectedEntries: 0,
    garbageCollectionRemaining: false,
    hashedBytes: 0,
    integrityFailures: 0,
    lastOperationDurationMs: 0,
    partialBytes: 0,
    partialResourceCount: 0,
    previousReleaseDigest: null,
    publicationCount: 0,
    quotaExceededCount: 0,
    readyReleaseCount: 0,
    reconciliationCount: 0,
    recoveryCount: 0,
    resumedBytes: 0,
    reusedBytes: 0,
    rollbackCount: 0,
    stagedReleaseCount: 0,
    state,
    verifiedObjectBytes: 0,
    verifiedObjectCount: 0,
    writtenBytes: 0,
  };
}

function freezeTelemetry(value: TelemetryMutable): InstallStoreTelemetrySnapshot {
  return Object.freeze({
    ...value,
    schemaVersion: INSTALL_STORE_TELEMETRY_SCHEMA_VERSION,
  });
}
