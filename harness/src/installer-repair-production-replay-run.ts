import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { open, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS,
  assertInstallStorePath,
  createInstallerFailureDiagnostic,
  createInstallerRepairState,
  createInstallerRepairTransferObserver,
  createInstallerWorkerSession,
  createOpfsReleaseStore,
  executeInstallerRepairWorkerOperation,
  INSTALL_STORE_ROOT,
  type InstallerResponse,
  type InstallerSnapshot,
  type InstallerTransferPlatform,
  type InstallerTransferTelemetrySnapshot,
  type InstallResource,
  InstallStoreIntegrityError,
  type InstallStoreListOptions,
  InstallStorePathNotFoundError,
  type InstallStorePlatform,
  type InstallStorePlatformEntry,
  idleInstallerTransferTelemetrySnapshot,
  parseInstallerBuildManifest,
  parseInstallerResponse,
  parseInstallManifestDocument,
  serializeInstallStoreRecord,
  validateInstallerManifestBytes,
} from "@parallax/engine";
import { compareUnicodeScalarStrings } from "./canonical-json.js";
import {
  INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT,
  INSTALLER_REPAIR_PRODUCTION_REPLAY_LIFETIME_MODES,
  INSTALLER_REPAIR_PRODUCTION_REPLAY_SCHEMA_VERSION,
  INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_DIGEST,
  INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_VERSION,
  type ProductionReplayFetchObservation,
  type ProductionReplayLifetimeMode,
  type ProductionReplaySourceReads,
  recomputeProductionReplaySemanticContractDigest,
  validateProductionReplayObservation,
  validateProductionReplayResult,
} from "./installer-repair-production-replay-contract.js";
import {
  reserveProductionReplayEvidence,
  sanitizeProductionReplayFailure,
} from "./installer-repair-production-replay-evidence.js";
import { readSourceIdentity } from "./source-identity.js";

export const INSTALLER_REPAIR_PRODUCTION_REPLAY_COMMAND =
  "pnpm harness:installer-repair-production-replay";
export const INSTALLER_REPAIR_PRODUCTION_REPLAY_PROTOCOL_IDENTITY =
  "installer-repair-production-replay@4";
export {
  INSTALLER_REPAIR_PRODUCTION_REPLAY_SCHEMA_VERSION,
  INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_DIGEST,
  INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_VERSION,
  recomputeProductionReplaySemanticContractDigest,
};

const EXPECTED_OPFS_BYTES = INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.opfs.bytes;
const EXPECTED_OPFS_RESOURCES = INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.opfs.resources;
const EXPECTED_RESOURCE_IDENTITY =
  INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.identities.resourceIdentitySha256;
const encoder = new TextEncoder();

interface Metrics {
  readonly distinctSourcePaths: number;
  readonly distinctVerifiedMarkerPaths: number;
  readonly sourceReadBytes: number;
  readonly sourceReadOperations: number;
}

export interface ProductionReplayPublicationMetadataEntry {
  readonly bytes: number;
  readonly path: string;
  readonly sha256: string;
}

export interface ProductionReplayPublicationMetadataDelta {
  readonly changed: readonly Readonly<{
    readonly after: ProductionReplayPublicationMetadataEntry;
    readonly before: ProductionReplayPublicationMetadataEntry;
    readonly path: string;
  }>[];
  readonly changedCount: number;
  readonly extra: readonly ProductionReplayPublicationMetadataEntry[];
  readonly extraCount: number;
  readonly missing: readonly ProductionReplayPublicationMetadataEntry[];
  readonly missingCount: number;
}

export class ProductionReplayPublicationMetadataError extends AggregateError {
  public readonly delta: ProductionReplayPublicationMetadataDelta;

  public constructor(delta: ProductionReplayPublicationMetadataDelta) {
    super(publicationDeltaCauses(delta), publicationDeltaMessage(delta));
    this.name = "ProductionReplayPublicationMetadataError";
    this.delta = delta;
  }
}

interface ReplayPlatform extends InstallStorePlatform {
  bindSource(path: string, sourcePath: string, bytes: number): void;
  metrics(): Metrics;
  replaceWithOwned(path: string, bytes: Uint8Array): void;
  resetMetrics(): void;
}

interface ReplayState {
  active: boolean;
  readonly directories: Set<string>;
  readonly owned: Map<string, Uint8Array>;
  readonly queue: Array<() => Promise<void>>;
  sourceReadBytes: number;
  sourceReadOperations: number;
  readonly sourceReadPaths: Set<string>;
  readonly sources: Map<string, Readonly<{ bytes: number; sourcePath: string }>>;
  readonly verifiedMarkerReadPaths: Set<string>;
}

async function main(): Promise<void> {
  const repositoryRoot = resolve(import.meta.dirname, "../../..");
  const startedAt = new Date();
  const pending = {
    command: INSTALLER_REPAIR_PRODUCTION_REPLAY_COMMAND,
    completedAt: null,
    durationMs: null,
    failure: null,
    schemaVersion: INSTALLER_REPAIR_PRODUCTION_REPLAY_SCHEMA_VERSION,
    startedAt: startedAt.toISOString(),
    state: "pending",
  } as const;
  const evidence = await reserveProductionReplayEvidence(
    repositoryRoot,
    startedAt.toISOString(),
    pending,
  );
  let terminal: Readonly<Record<string, unknown>>;
  try {
    const replay = await executeReplay(repositoryRoot);
    terminal = Object.freeze({
      ...pending,
      completedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - replay.startedPerformance),
      replay: replay.result,
      sourceIdentity: await readSourceIdentity(repositoryRoot),
      state: "passed",
    });
  } catch (error: unknown) {
    terminal = Object.freeze({
      ...pending,
      completedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - startedAt.getTime()),
      failure: sanitizeProductionReplayFailure(error),
      sourceIdentity: await readSourceIdentity(repositoryRoot).catch(() => null),
      state: "failed",
    });
  }
  const hashes = await evidence.publishTerminal(
    terminal,
    terminal.state === "passed" ? "passed" : "failed",
  );
  const summary = {
    canonicalPayloadSha256: hashes.canonicalPayloadSha256,
    jsonPath: evidence.jsonPath,
    jsonSha256: hashes.jsonSha256,
    markdownPath: evidence.markdownPath,
    markdownSha256: hashes.markdownSha256,
    recoveryPath: evidence.recoveryPath,
    recoverySha256: hashes.recoverySha256,
    state: terminal.state,
  };
  console.info(
    `${INSTALLER_REPAIR_PRODUCTION_REPLAY_PROTOCOL_IDENTITY} ${JSON.stringify(summary)}`,
  );
  if (terminal.state !== "passed") {
    throw new Error(`Production Repair replay failed: ${String(terminal.failure)}`);
  }
}

export async function executeReplay(repositoryRoot: string): Promise<{
  readonly result: Readonly<Record<string, unknown>>;
  readonly startedPerformance: number;
}> {
  const startedPerformance = performance.now();
  const buildBytes = new Uint8Array(
    await readFile(resolve(repositoryRoot, "dist/build-manifest.json")),
  );
  const installBytes = new Uint8Array(
    await readFile(resolve(repositoryRoot, "dist/install-manifest.json")),
  );
  return executeAfterProductionReplayIdentityValidation(
    buildBytes,
    installBytes,
    async (artifacts) => {
      const restarted = (await executeReplayMode(repositoryRoot, "restarted", artifacts)).result;
      const sameWorker = (await executeReplayMode(repositoryRoot, "same-worker", artifacts)).result;
      assert.deepEqual(restarted.identities, sameWorker.identities);
      assert.deepEqual(restarted.sourceReads, sameWorker.sourceReads);
      assert.deepEqual(restarted.postValidation, sameWorker.postValidation);
      assert.deepEqual(restarted.worker.fetch, sameWorker.worker.fetch);
      assert.ok("requestId" in restarted.worker.protocolResponse);
      assert.deepEqual(restarted.worker.protocolResponse, {
        ...sameWorker.worker.protocolResponse,
        requestId: restarted.worker.protocolResponse.requestId,
      });
      const result = validateProductionReplayResult(
        Object.freeze({
          crossMode: Object.freeze({
            identitiesEqual: true,
            noRepublishEqual: true,
            publicationEqual: true,
            repairRequestSemanticsEqual: true,
            sessionRequestSequencesBound: true,
            sourceReadsEqual: true,
            storeEqual: true,
          }),
          lifetimeModes: INSTALLER_REPAIR_PRODUCTION_REPLAY_LIFETIME_MODES,
          modes: Object.freeze({ restarted, "same-worker": sameWorker }),
          semanticContractDigest: INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_DIGEST,
          semanticContractVersion: INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_VERSION,
        }),
      );
      return Object.freeze({
        result,
        startedPerformance,
      });
    },
  );
}

interface ValidatedProductionReplayArtifacts {
  readonly appEntrypoint: string;
  readonly buildBytes: Uint8Array;
  readonly buildManifest: ReturnType<typeof parseInstallerBuildManifest>;
  readonly identity: ReturnType<typeof validateInstallerManifestBytes>;
  readonly installBytes: Uint8Array;
  readonly opfs: readonly InstallResource[];
  readonly parsed: ReturnType<typeof parseInstallManifestDocument>;
  readonly resourceIdentitySha256: string;
  readonly resources: readonly InstallResource[];
}

export async function executeAfterProductionReplayIdentityValidation<T>(
  buildBytes: Uint8Array,
  installBytes: Uint8Array,
  executeModes: (artifacts: ValidatedProductionReplayArtifacts) => Promise<T>,
): Promise<T> {
  const artifacts = validateProductionReplayArtifactIdentity(buildBytes, installBytes);
  return executeModes(artifacts);
}

export function validateProductionReplayArtifactIdentity(
  buildBytes: Uint8Array,
  installBytes: Uint8Array,
): ValidatedProductionReplayArtifacts {
  const contract = INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT;
  const buildManifest = parseInstallerBuildManifest(
    JSON.parse(new TextDecoder().decode(buildBytes)),
  );
  const appEntrypoint = buildManifest.artifacts.find(({ path }) =>
    /^immutable\/app-[a-f0-9]{64}\.js$/u.test(path),
  )?.path;
  assert.equal(appEntrypoint, contract.identities.appEntrypointPath, "app entrypoint identity");
  assert.equal(sha256(buildBytes), contract.identities.buildManifestSha256, "build manifest SHA");
  assert.equal(
    sha256(installBytes),
    contract.identities.installManifestSha256,
    "install manifest SHA",
  );
  const identity = validateInstallerManifestBytes(buildManifest, installBytes);
  assert.equal(identity.releaseDigest, contract.identities.releaseDigest, "release digest");
  const parsed = parseInstallManifestDocument(JSON.parse(new TextDecoder().decode(installBytes)));
  const resources = parsed.manifest.resources;
  const opfs = resources.filter((resource) => resource.target === "opfs");
  const resourceIdentitySha256 = sha256(encoder.encode(JSON.stringify(opfs)));
  assert.equal(opfs.length, contract.opfs.resources, "OPFS resource count");
  assert.equal(parsed.summary.bytesByTarget.opfs, contract.opfs.bytes, "OPFS bytes");
  assert.equal(
    resourceIdentitySha256,
    contract.identities.resourceIdentitySha256,
    "OPFS resource identity",
  );
  for (const lifetimeMode of contract.result.modes) {
    for (const request of contract.result.requestSequences[lifetimeMode]) {
      assert.equal(
        request.shellEntrypointPath,
        appEntrypoint,
        `${lifetimeMode} request app entrypoint`,
      );
    }
  }
  return Object.freeze({
    appEntrypoint,
    buildBytes,
    buildManifest,
    identity,
    installBytes,
    opfs: Object.freeze([...opfs]),
    parsed,
    resourceIdentitySha256,
    resources,
  });
}

interface ProductionReplayModeResult {
  readonly identities: Readonly<Record<string, unknown>>;
  readonly lifetimeMode: ProductionReplayLifetimeMode;
  readonly postValidation: Readonly<Record<string, unknown>>;
  readonly requests: readonly Readonly<Record<string, unknown>>[];
  readonly sourceReads: ProductionReplaySourceReads;
  readonly worker: Readonly<{
    readonly fetch: ProductionReplayFetchObservation;
    readonly protocolResponse: InstallerResponse;
    readonly publicComposite: InstallerSnapshot;
    readonly transferTelemetry: InstallerTransferTelemetrySnapshot;
  }>;
}

async function executeReplayMode(
  repositoryRoot: string,
  lifetimeMode: ProductionReplayLifetimeMode,
  artifacts: ValidatedProductionReplayArtifacts,
): Promise<{
  readonly result: ProductionReplayModeResult;
  readonly startedPerformance: number;
}> {
  const startedPerformance = performance.now();
  const {
    appEntrypoint,
    buildBytes,
    identity,
    installBytes,
    opfs,
    resourceIdentitySha256,
    resources,
  } = artifacts;
  assert.equal(resourceIdentitySha256, EXPECTED_RESOURCE_IDENTITY);
  const admitted = [...opfs].sort((left, right) => left.bytes - right.bytes)[0];
  assert.ok(admitted);
  assert.deepEqual(
    { bytes: admitted.bytes, id: admitted.id, sha256: admitted.sha256, source: admitted.source },
    INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.admittedResource.value,
  );
  const platform = createReplayPlatform();
  const store = createOpfsReleaseStore(platform);
  const staged = await store.stageRelease(installBytes);
  assert.equal(staged.releaseDigest, identity.releaseDigest);
  let transfer: InstallerTransferTelemetrySnapshot = Object.freeze({
    ...idleInstallerTransferTelemetrySnapshot(1, 8 * 1024 * 1024),
    activeReleaseDigest: staged.releaseDigest,
    resourceCount: opfs.length,
    totalBytes: EXPECTED_OPFS_BYTES,
  });
  const update = (partial: Partial<InstallerTransferTelemetrySnapshot>): void => {
    transfer = Object.freeze({ ...transfer, ...partial });
  };
  const unsubscribe = store.subscribe((snapshot) =>
    update({
      finalVerificationBytes: snapshot.finalVerificationBytes,
      finalVerificationPhase: snapshot.finalVerificationPhase,
      finalVerificationResourceCount: snapshot.finalVerificationResourceCount,
      finalVerificationTotalBytes: snapshot.finalVerificationTotalBytes,
      finalVerificationTotalResourceCount: snapshot.finalVerificationTotalResourceCount,
    }),
  );
  let seedCompletedResourceCount = 0;
  let seedVerifiedBytes = 0;
  let initialMetrics: ReturnType<ReplayPlatform["metrics"]> | null = null;
  let baselineMetadata: readonly ProductionReplayPublicationMetadataEntry[] | null = null;
  let publicationCount: number | null = null;
  const seedProductionRelease = async (): Promise<{
    readonly readyBytes: number;
    readonly readyResourceCount: number;
    readonly releaseDigest: string;
  }> => {
    if (seedCompletedResourceCount !== 0 || seedVerifiedBytes !== 0) {
      throw new Error("Production seed install was requested more than once");
    }
    update({
      plannedDownloadBytes: EXPECTED_OPFS_BYTES,
      resourceCount: opfs.length,
      reusedBytes: 0,
      state: "transferring",
      totalBytes: EXPECTED_OPFS_BYTES,
    });
    for (const resource of opfs) {
      assert.notEqual(resource.scope, "app-shell");
      const sourcePath = sourcePathFor(repositoryRoot, resource);
      const sourceStat = await stat(sourcePath);
      assert.equal(sourceStat.isFile(), true);
      assert.equal(sourceStat.size, resource.bytes);
      const objectPath = objectPathFor(resource);
      platform.bindSource(objectPath, sourcePath, resource.bytes);
      await platform.writeRecord(
        objectPath.replace(/\.data$/u, ".verified.json"),
        serializeInstallStoreRecord({
          bytes: resource.bytes,
          schemaVersion: 1,
          scope: resource.scope as "common" | "game-specific",
          sha256: resource.sha256,
        }),
      );
      seedCompletedResourceCount += 1;
      seedVerifiedBytes += resource.bytes;
      update({
        completedResourceCount: seedCompletedResourceCount,
        verifiedBytes: seedVerifiedBytes,
      });
    }
    assert.equal(seedCompletedResourceCount, opfs.length);
    assert.equal(seedVerifiedBytes, EXPECTED_OPFS_BYTES);
    await store.reconcile();
    platform.resetMetrics();
    const initialVerification = await store.verifyRelease(staged.releaseDigest);
    assert.equal(initialVerification.ok, true);
    assert.equal(initialVerification.bytes, EXPECTED_OPFS_BYTES);
    initialMetrics = platform.metrics();
    await store.markReleaseReady(staged.releaseDigest);
    await store.publishRelease(staged.releaseDigest);
    baselineMetadata = await publicationMetadata(platform, staged.releaseDigest);
    publicationCount = store.snapshot().publicationCount;
    update({
      plannedDownloadBytes: 0,
      reusedBytes: EXPECTED_OPFS_BYTES,
    });
    return Object.freeze({
      readyBytes: EXPECTED_OPFS_BYTES,
      readyResourceCount: opfs.length,
      releaseDigest: staged.releaseDigest,
    });
  };
  let admission: Awaited<ReturnType<typeof store.admitRepairRelease>> | null = null;
  let repairTransferPlatform: InstallerTransferPlatform | null = null;
  const responses = new Map<number, (response: InstallerResponse) => void>();
  const createSession = () =>
    createInstallerWorkerSession({
      classifyFailure: (error, operation) =>
        createInstallerFailureDiagnostic(
          "unknown",
          "terminal",
          "terminal-unclassified",
          error,
          null,
          operation,
        ),
      executeOperation: async (context) => {
        if (context.operation === "install") {
          return seedProductionRelease();
        }
        assert.ok(admission);
        assert.ok(repairTransferPlatform);
        const observer = createInstallerRepairTransferObserver(
          {
            accumulate: (partial) => {
              transfer = Object.freeze({ ...transfer, ...partial });
            },
            snapshot: () => transfer,
            update,
          },
          new Set(opfs.map(({ id }) => id)),
          context.completionCredit,
        );
        return executeInstallerRepairWorkerOperation({
          admission,
          beginCompletion: () => {
            context.control.cancelable = false;
          },
          identity,
          observer,
          request: {
            expectedReleaseDigest: staged.releaseDigest,
            kind: "repair",
            requestId: context.requestId,
            shellEntrypointPath: context.shellEntrypointPath,
          },
          signal: context.signal,
          store,
          transferInput: {
            baseUrl: "https://example.test/",
            policy: {
              checkpointBytes: 8 * 1024 * 1024,
              concurrency: 1,
              requestTimeoutMs: 30_000,
            },
            releaseDigest: staged.releaseDigest,
            repairState: createInstallerRepairState(),
            resources,
            signal: context.signal,
          },
          transferPlatform: repairTransferPlatform,
        });
      },
      now: () => performance.now(),
      post: (response) => {
        responses.get(response.kind === "ready" ? 0 : (response.requestId ?? 0))?.(response);
      },
      publishSnapshot: () => undefined,
      requestLock: (_name, _signal, operation) => operation(),
      snapshotTransfer: () => transfer,
      targetStatus: async () =>
        Object.freeze({
          active: true,
          activeReleaseDigest: staged.releaseDigest,
          releaseDigest: staged.releaseDigest,
        }),
      update,
    });
  let workerSession = createSession();
  const send = (request: {
    readonly expectedReleaseDigest?: string;
    readonly kind: "install" | "repair";
    readonly requestId: number;
    readonly shellEntrypointPath: string;
  }): Promise<InstallerResponse> =>
    new Promise((resolveResponse) => {
      responses.set(request.requestId, resolveResponse);
      workerSession.message(request);
    });
  const sessionRequests: Array<Readonly<Record<string, unknown>>> = [];
  if (lifetimeMode === "same-worker") {
    const seedRequest = {
      kind: "install",
      requestId: 1,
      shellEntrypointPath: appEntrypoint,
    } as const;
    const seedResponse = parseInstallerResponse(await send(seedRequest));
    assert.equal(seedResponse.kind, "install-complete");
    sessionRequests.push(Object.freeze({ request: seedRequest, response: seedResponse }));
  } else {
    await seedProductionRelease();
    transfer = Object.freeze({
      ...idleInstallerTransferTelemetrySnapshot(1, 8 * 1024 * 1024),
      activeReleaseDigest: staged.releaseDigest,
      finalVerificationBytes: EXPECTED_OPFS_BYTES,
      finalVerificationPhase: "complete",
      finalVerificationResourceCount: opfs.length,
      finalVerificationTotalBytes: EXPECTED_OPFS_BYTES,
      finalVerificationTotalResourceCount: opfs.length,
      resourceCount: opfs.length,
      reusedBytes: EXPECTED_OPFS_BYTES,
      state: "ready",
      totalBytes: EXPECTED_OPFS_BYTES,
    });
    workerSession = createSession();
  }
  const initialMetricsExact = requiredReplayValue<ReturnType<ReplayPlatform["metrics"]>>(
    initialMetrics,
    "initial metrics",
  );
  const baselineMetadataExact = requiredReplayValue<
    readonly ProductionReplayPublicationMetadataEntry[]
  >(baselineMetadata, "baseline publication metadata");
  const publicationCountExact = requiredReplayValue<number>(
    publicationCount,
    "baseline publication count",
  );
  const admittedReference = await store.getResource(staged.releaseDigest, admitted.id);
  const admittedBytes = new Uint8Array(await readFile(sourcePathFor(repositoryRoot, admitted)));
  const corruptBytes = admittedBytes.slice();
  corruptBytes[0] = (corruptBytes[0] ?? 0) ^ 0xff;
  platform.replaceWithOwned(admittedReference.path, corruptBytes);
  const corruption = await store.verifyObject(admittedReference);
  assert.equal(corruption.ok, false);
  assert.equal((await store.getSelection()).activeReleaseDigest, null);
  platform.resetMetrics();
  admission = await store.admitRepairRelease(staged.releaseDigest);
  const admissionMetrics = platform.metrics();
  assert.equal(admission.resourceId, admitted.id);
  assert.equal(admission.state, "repair-required");

  const fetches: ProductionReplayFetchObservation[] = [];
  repairTransferPlatform = Object.freeze({
    clearTimeout: () => undefined,
    async fetch(url: string, init?: RequestInit) {
      assert.equal(url, new URL(admitted.source, "https://example.test/").href);
      const headers = new Headers(init?.headers);
      fetches.push(
        Object.freeze({
          bodyBytes: admittedBytes.byteLength,
          ifRange: headers.get("if-range"),
          range: headers.get("range"),
          url,
        }),
      );
      const response = new Response(admittedBytes, {
        headers: {
          "content-length": String(admittedBytes.byteLength),
          "content-range": `bytes 0-${admittedBytes.byteLength - 1}/${admittedBytes.byteLength}`,
          etag: '"production-repair-replay"',
        },
        status: 206,
      });
      Object.defineProperty(response, "url", { value: url });
      return response;
    },
    now: () => 0,
    setTimeout: () => 0,
    sleep: async () => undefined,
  });
  platform.resetMetrics();
  const repairRequestId = lifetimeMode === "same-worker" ? 2 : 1;
  const repairRequest = {
    expectedReleaseDigest: staged.releaseDigest,
    kind: "repair",
    requestId: repairRequestId,
    shellEntrypointPath: appEntrypoint,
  } as const;
  const workerResponse = parseInstallerResponse(await send(repairRequest));
  sessionRequests.push(Object.freeze({ request: repairRequest, response: workerResponse }));
  const repairMetrics = platform.metrics();
  unsubscribe();
  assert.equal(workerResponse.kind, "install-complete");
  assert.equal(transfer.state, "ready");
  assert.equal(transfer.operationRepairedBytes, admitted.bytes);
  assert.equal(transfer.integrityFailureCount, 0);
  assert.equal(transfer.finalVerificationBytes, EXPECTED_OPFS_BYTES);
  const storeSnapshot = store.snapshot();
  assert.equal(storeSnapshot.activeReleaseDigest, staged.releaseDigest);
  assert.equal(storeSnapshot.readyReleaseCount, 1);
  assert.equal(storeSnapshot.state, "ready");
  assert.equal(storeSnapshot.publicationCount, publicationCountExact);
  assert.equal(transfer.finalVerificationBytes, storeSnapshot.finalVerificationBytes);
  const eligibilityPath = exactProductionReplayRepairEligibilityPath(staged.releaseDigest);
  assert.equal(
    await platform.size(eligibilityPath),
    null,
    "Successful Repair retained its transient eligibility record",
  );
  assertExactProductionReplayPublicationMetadata(
    baselineMetadataExact,
    await publicationMetadata(platform, staged.releaseDigest),
  );

  const second = opfs[0];
  assert.ok(second && second.id !== admitted.id);
  const secondReference = await store.getResource(staged.releaseDigest, second.id);
  platform.replaceWithOwned(admittedReference.path, corruptBytes);
  assert.equal((await store.verifyObject(admittedReference)).ok, false);
  const eligibility = await platform.read(eligibilityPath);
  assert.ok(eligibility);
  const secondBytes = new Uint8Array(await readFile(sourcePathFor(repositoryRoot, second)));
  secondBytes[0] = (secondBytes[0] ?? 0) ^ 0xff;
  platform.replaceWithOwned(secondReference.path, secondBytes);
  let secondCorruptionFailure: unknown = null;
  try {
    await store.admitRepairRelease(staged.releaseDigest);
  } catch (error: unknown) {
    secondCorruptionFailure = error;
  }
  assert.ok(secondCorruptionFailure instanceof InstallStoreIntegrityError);
  assert.match(secondCorruptionFailure.message, /corrupt resource/u);
  assert.deepEqual(await platform.read(eligibilityPath), eligibility);
  const finalPublicationMetadata = await publicationMetadata(platform, staged.releaseDigest);
  assertExactProductionReplayPublicationMetadata(baselineMetadataExact, finalPublicationMetadata);
  const validated = validateProductionReplayObservation({
    admittedResource: Object.freeze({
      bytes: admitted.bytes,
      id: admitted.id,
      sha256: admitted.sha256,
      source: admitted.source,
    }),
    appEntrypointPath: appEntrypoint,
    buildManifestSha256: sha256(buildBytes),
    fetches,
    installStore: storeSnapshot,
    installManifestSha256: sha256(installBytes),
    lifetimeMode,
    opfsBytes: EXPECTED_OPFS_BYTES,
    opfsResourceCount: EXPECTED_OPFS_RESOURCES,
    publicComposite: Object.freeze({
      installStore: storeSnapshot,
      installerTransfer: transfer,
    }),
    publicationAfter: finalPublicationMetadata,
    publicationBefore: baselineMetadataExact,
    publicationCountBefore: publicationCountExact,
    releaseDigest: staged.releaseDigest,
    resourceIdentitySha256,
    semanticContractDigest: INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_DIGEST,
    semanticContractVersion: INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_VERSION,
    secondCorruption: Object.freeze({
      admissionUnchanged: true,
      failureCode: "integrity",
      recoveryAction: "repair",
      rejected: true,
    }),
    sourceReads: Object.freeze({
      admission: admissionMetrics,
      initial: initialMetricsExact,
      repair: repairMetrics,
      totalBytes:
        initialMetricsExact.sourceReadBytes +
        admissionMetrics.sourceReadBytes +
        repairMetrics.sourceReadBytes,
    }),
    transferTelemetry: transfer,
    workerResponse,
  });

  return {
    startedPerformance,
    result: Object.freeze({
      identities: Object.freeze({
        appEntrypointPath: appEntrypoint,
        buildManifestSha256: sha256(buildBytes),
        installManifestSha256: sha256(installBytes),
        opfsBytes: EXPECTED_OPFS_BYTES,
        opfsResourceCount: EXPECTED_OPFS_RESOURCES,
        releaseDigest: staged.releaseDigest,
        resourceIdentitySha256,
      }),
      lifetimeMode,
      requests: Object.freeze(sessionRequests),
      sourceReads: validated.sourceReads,
      worker: Object.freeze({
        fetch: validated.fetch,
        protocolResponse: validated.workerResponse,
        publicComposite: validated.publicComposite,
        transferTelemetry: validated.transferTelemetry,
      }),
      postValidation: Object.freeze({
        ...validated.postValidation,
        publication: validated.publication,
      }),
    }),
  };
}

function createReplayPlatform(): ReplayPlatform {
  const state: ReplayState = {
    active: false,
    directories: new Set(),
    owned: new Map(),
    queue: [],
    sourceReadBytes: 0,
    sourceReadOperations: 0,
    sourceReadPaths: new Set(),
    sources: new Map(),
    verifiedMarkerReadPaths: new Set(),
  };
  const exists = (path: string): boolean => state.owned.has(path) || state.sources.has(path);
  const platform: ReplayPlatform = {
    async append(path, expectedOffset, bytes) {
      assertInstallStorePath(path);
      retainReplayParentDirectories(state, path);
      const current = state.owned.get(path) ?? new Uint8Array();
      if (state.sources.has(path) || current.byteLength !== expectedOffset)
        throw new Error("Append offset mismatch");
      const next = new Uint8Array(current.byteLength + bytes.byteLength);
      next.set(current);
      next.set(bytes, current.byteLength);
      state.owned.set(path, next);
      return bytes.byteLength;
    },
    bindSource(path, sourcePath, bytes) {
      assertInstallStorePath(path);
      if (exists(path)) throw new Error(`Duplicate source-backed path ${path}`);
      retainReplayParentDirectories(state, path);
      state.sources.set(path, Object.freeze({ bytes, sourcePath }));
    },
    async flush(path) {
      if (!exists(path)) throw new InstallStorePathNotFoundError(path);
    },
    async list(directory, options) {
      return listEntries(state, directory, options);
    },
    metrics: () =>
      Object.freeze({
        distinctSourcePaths: state.sourceReadPaths.size,
        distinctVerifiedMarkerPaths: state.verifiedMarkerReadPaths.size,
        sourceReadBytes: state.sourceReadBytes,
        sourceReadOperations: state.sourceReadOperations,
      }),
    now: () => performance.now(),
    async probe(bytes) {
      const path = `${INSTALL_STORE_ROOT}/replay-probe.bin`;
      await platform.remove(path);
      await platform.append(path, 0, bytes);
      await platform.remove(path);
    },
    async read(path) {
      const owned = state.owned.get(path);
      if (owned !== undefined) {
        if (path.endsWith(".verified.json")) state.verifiedMarkerReadPaths.add(path);
        return owned.slice();
      }
      const source = state.sources.get(path);
      return source === undefined ? null : new Uint8Array(await readFile(source.sourcePath));
    },
    async *readChunks(path, chunkBytes) {
      const owned = state.owned.get(path);
      if (owned !== undefined) {
        for (let offset = 0; offset < owned.byteLength; offset += chunkBytes) {
          yield owned.slice(offset, Math.min(owned.byteLength, offset + chunkBytes));
        }
        return;
      }
      const source = state.sources.get(path);
      if (source === undefined) throw new InstallStorePathNotFoundError(path);
      state.sourceReadOperations += 1;
      state.sourceReadPaths.add(path);
      const handle = await open(source.sourcePath, "r");
      let observed = 0;
      try {
        const buffer = Buffer.allocUnsafe(Math.min(chunkBytes, source.bytes));
        while (observed < source.bytes) {
          const expected = Math.min(buffer.byteLength, source.bytes - observed);
          const { bytesRead } = await handle.read(buffer, 0, expected, observed);
          if (bytesRead === 0) break;
          observed += bytesRead;
          state.sourceReadBytes += bytesRead;
          yield new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead).slice();
        }
      } finally {
        await handle.close();
      }
      if (observed !== source.bytes) throw new Error(`Short source-backed read ${path}`);
    },
    async remove(path, recursive = false) {
      for (const candidate of [...state.owned.keys(), ...state.sources.keys()]) {
        if (candidate === path || (recursive && candidate.startsWith(`${path}/`))) {
          state.owned.delete(candidate);
          state.sources.delete(candidate);
        }
      }
      for (const candidate of [...state.directories]) {
        if (candidate === path || (recursive && candidate.startsWith(`${path}/`))) {
          state.directories.delete(candidate);
        }
      }
    },
    replaceWithOwned(path, bytes) {
      if (!exists(path)) throw new InstallStorePathNotFoundError(path);
      state.sources.delete(path);
      state.owned.set(path, bytes.slice());
    },
    resetMetrics() {
      state.sourceReadBytes = 0;
      state.sourceReadOperations = 0;
      state.sourceReadPaths.clear();
      state.verifiedMarkerReadPaths.clear();
    },
    runExclusive<T>(operation: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolveOperation, rejectOperation) => {
        state.queue.push(async () => {
          try {
            resolveOperation(await operation());
          } catch (error: unknown) {
            rejectOperation(error);
          }
        });
        drain(state);
      });
    },
    async size(path) {
      return state.owned.get(path)?.byteLength ?? state.sources.get(path)?.bytes ?? null;
    },
    async truncate(path, bytes) {
      const current = state.owned.get(path);
      if (current === undefined || bytes < 0 || bytes > current.byteLength)
        throw new Error("Invalid truncate");
      state.owned.set(path, current.slice(0, bytes));
    },
    async writeRecord(path, bytes) {
      retainReplayParentDirectories(state, path);
      state.sources.delete(path);
      state.owned.set(path, bytes.slice());
    },
  };
  return Object.freeze(platform);
}

function drain(state: ReplayState): void {
  if (state.active) return;
  const next = state.queue.shift();
  if (next === undefined) return;
  state.active = true;
  void next().finally(() => {
    state.active = false;
    drain(state);
  });
}

async function listEntries(
  state: ReplayState,
  directory: string,
  options?: InstallStoreListOptions,
): Promise<readonly InstallStorePlatformEntry[]> {
  assertInstallStorePath(directory);
  const recursive = options?.recursive === true;
  const entries = new Map<string, InstallStorePlatformEntry>();
  const prefix = `${directory}/`;
  for (const path of state.directories) {
    if (!path.startsWith(prefix)) continue;
    const segments = path.slice(prefix.length).split("/");
    const directoryPath = recursive ? path : `${directory}/${segments[0]}`;
    entries.set(directoryPath, { kind: "directory", path: directoryPath, size: 0 });
  }
  for (const path of new Set([...state.owned.keys(), ...state.sources.keys()])) {
    if (!path.startsWith(prefix)) continue;
    const segments = path.slice(prefix.length).split("/");
    const filePath = recursive ? path : `${directory}/${segments[0]}`;
    if (!recursive && segments.length > 1) {
      entries.set(filePath, { kind: "directory", path: filePath, size: 0 });
      continue;
    }
    if (recursive) {
      for (let depth = 1; depth < segments.length; depth += 1) {
        const path_ = `${directory}/${segments.slice(0, depth).join("/")}`;
        entries.set(path_, { kind: "directory", path: path_, size: 0 });
      }
    }
    entries.set(filePath, {
      kind: "file",
      path: filePath,
      size: state.owned.get(path)?.byteLength ?? state.sources.get(path)?.bytes ?? 0,
    });
  }
  return [...entries.values()].sort((left, right) =>
    compareUnicodeScalarStrings(left.path, right.path),
  );
}

function retainReplayParentDirectories(state: ReplayState, path: string): void {
  const segments = path.split("/");
  for (let depth = 2; depth < segments.length; depth += 1) {
    state.directories.add(segments.slice(0, depth).join("/"));
  }
}

function objectPathFor(resource: InstallResource): string {
  assert.ok(resource.scope === "common" || resource.scope === "game-specific");
  const namespace = resource.scope === "common" ? "objects/common" : "objects/games/parallax";
  return `${INSTALL_STORE_ROOT}/${namespace}/sha256/${resource.sha256.slice(0, 2)}/${resource.sha256}.data`;
}

function sourcePathFor(repositoryRoot: string, resource: InstallResource): string {
  const model = APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.find(
    ({ sha256: digest }) => digest === resource.sha256,
  );
  return model === undefined
    ? resolve(repositoryRoot, "dist", resource.source)
    : join(
        homedir(),
        ".parallax",
        "harness",
        "models",
        "gemma-4-E2B-it-qat-GGUF-66a399f6",
        model.path,
      );
}

function requiredReplayValue<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`Production replay ${label} is absent`);
  return value;
}

async function publicationMetadata(
  platform: InstallStorePlatform,
  releaseDigest: string,
  includeRepairEligibility = false,
): Promise<readonly ProductionReplayPublicationMetadataEntry[]> {
  const entries = [
    ...(await platform.list(`${INSTALL_STORE_ROOT}/releases/${releaseDigest}`, {
      recursive: true,
    })),
    ...(await platform.list(`${INSTALL_STORE_ROOT}/commits`, { recursive: true })),
  ]
    .filter(
      ({ kind, path }) =>
        kind === "file" &&
        (includeRepairEligibility ||
          !isExactProductionReplayRepairEligibilityPath(path, releaseDigest)),
    )
    .sort((left, right) => compareUnicodeScalarStrings(left.path, right.path));
  return Promise.all(
    entries.map(async ({ path, size }) => {
      const bytes = await platform.read(path);
      assert.ok(bytes);
      assert.equal(bytes.byteLength, size);
      return Object.freeze({ bytes: size, path, sha256: sha256(bytes) });
    }),
  );
}

export function exactProductionReplayRepairEligibilityPath(releaseDigest: string): string {
  if (!/^[a-f0-9]{64}$/u.test(releaseDigest)) {
    throw new Error("Production replay release digest is invalid");
  }
  return `${INSTALL_STORE_ROOT}/releases/${releaseDigest}/repair-eligibility.json`;
}

export function isExactProductionReplayRepairEligibilityPath(
  path: string,
  releaseDigest: string,
): boolean {
  assertInstallStorePath(path);
  return path === exactProductionReplayRepairEligibilityPath(releaseDigest);
}

export function assertExactProductionReplayPublicationMetadata(
  before: readonly ProductionReplayPublicationMetadataEntry[],
  after: readonly ProductionReplayPublicationMetadataEntry[],
): void {
  const beforeByPath = publicationMetadataByPath(before);
  const afterByPath = publicationMetadataByPath(after);
  const missing: ProductionReplayPublicationMetadataEntry[] = [];
  const extra: ProductionReplayPublicationMetadataEntry[] = [];
  const changed: Array<{
    readonly after: ProductionReplayPublicationMetadataEntry;
    readonly before: ProductionReplayPublicationMetadataEntry;
    readonly path: string;
  }> = [];
  for (const [path, entry] of beforeByPath) {
    const candidate = afterByPath.get(path);
    if (candidate === undefined) {
      missing.push(entry);
    } else if (candidate.bytes !== entry.bytes || candidate.sha256 !== entry.sha256) {
      changed.push(Object.freeze({ after: candidate, before: entry, path }));
    }
  }
  for (const [path, entry] of afterByPath) {
    if (!beforeByPath.has(path)) extra.push(entry);
  }
  if (missing.length === 0 && extra.length === 0 && changed.length === 0) return;
  const boundedMissing = missing.slice(0, 8);
  const boundedExtra = extra.slice(0, 8 - boundedMissing.length);
  const boundedChanged = changed.slice(0, 8 - boundedMissing.length - boundedExtra.length);
  throw new ProductionReplayPublicationMetadataError(
    Object.freeze({
      changed: Object.freeze(boundedChanged),
      changedCount: changed.length,
      extra: Object.freeze(boundedExtra),
      extraCount: extra.length,
      missing: Object.freeze(boundedMissing),
      missingCount: missing.length,
    }),
  );
}

function publicationMetadataByPath(
  entries: readonly ProductionReplayPublicationMetadataEntry[],
): ReadonlyMap<string, ProductionReplayPublicationMetadataEntry> {
  const result = new Map<string, ProductionReplayPublicationMetadataEntry>();
  for (const entry of entries) {
    assertInstallStorePath(entry.path);
    if (
      entry.path.length > 128 ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      !/^[a-f0-9]{64}$/u.test(entry.sha256) ||
      result.has(entry.path)
    ) {
      throw new Error("Production replay publication metadata entry is invalid");
    }
    result.set(entry.path, Object.freeze({ ...entry }));
  }
  return result;
}

function publicationDeltaMessage(delta: ProductionReplayPublicationMetadataDelta): string {
  return `publication-metadata-mismatch missing=${String(delta.missingCount)} extra=${String(delta.extraCount)} changed=${String(delta.changedCount)} retained-details=${String(delta.missing.length + delta.extra.length + delta.changed.length)}`;
}

function publicationDeltaCauses(delta: ProductionReplayPublicationMetadataDelta): readonly Error[] {
  return Object.freeze([
    ...delta.missing.map((entry) => new Error(`missing:${metadataToken(entry)}`)),
    ...delta.extra.map((entry) => new Error(`extra:${metadataToken(entry)}`)),
    ...delta.changed.map(
      (entry) =>
        new Error(
          `changed:${entry.path},before=${entry.before.bytes}:${entry.before.sha256},after=${entry.after.bytes}:${entry.after.sha256}`,
        ),
    ),
  ]);
}

function metadataToken(entry: ProductionReplayPublicationMetadataEntry): string {
  return `${entry.path},bytes=${String(entry.bytes)},sha256=${entry.sha256}`;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  void main();
}
