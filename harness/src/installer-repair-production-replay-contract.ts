import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  type InstallerSnapshot,
  type InstallerTransferTelemetrySnapshot,
  type InstallStoreTelemetrySnapshot,
  idleInstallerTransferTelemetrySnapshot,
  parseInstallerResponse,
  parseInstallerSnapshot,
  unavailableInstallStoreTelemetrySnapshot,
} from "@parallax/engine";

export const INSTALLER_REPAIR_PRODUCTION_REPLAY_SCHEMA_VERSION = 4;
export const INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_VERSION = 9;
export const INSTALLER_REPAIR_PRODUCTION_REPLAY_LIFETIME_MODES = Object.freeze([
  "restarted",
  "same-worker",
] as const);
export type ProductionReplayLifetimeMode =
  (typeof INSTALLER_REPAIR_PRODUCTION_REPLAY_LIFETIME_MODES)[number];

const EXPECTED_OPFS_BYTES = 2_621_639_471;
const EXPECTED_OPFS_RESOURCES = 331;
const ADMITTED_BYTES = 43;
const BUILD_MANIFEST_SHA256 = "a0b20b40bdebd4f983f22539cf41b335ab5a540b95ce5b22261941421e180fde";
const INSTALL_MANIFEST_SHA256 = "81c5cfec29612d08e3be48dd64cce2851a96c459c3e5ce5d15ef618bfb6b77d4";
const RESOURCE_IDENTITY_SHA256 = "6041a7050808a9ca93b3a3df5edbc30353edde19493d8b1902e25ccb19f087ba";
const APP_ENTRYPOINT_PATH =
  "immutable/app-b842d3ad5b9cca22beb4069bf88199d187a722bb4acb4520000a4872534983e5.js";

export const INSTALLER_REPAIR_PRODUCTION_REPLAY_RETAINED_PASS_IDENTITY = Object.freeze({
  appEntrypointPath:
    "immutable/app-6817f38b12a3546f0034e24a89fa671ecdb03d3050ea3bb87f203f7eb9d9dee5.js",
  buildManifestSha256: "781613904816da13e10813e29ecd46b0c0dc91dd6f24b75620277d0bd04bf066",
  canonicalBindingSha256: "156258155c5c0d6be69a58d58cd11c315e261c3907eed64f6e84a123e9098093",
  installManifestSha256: "c022f28007e4a65a278a1d12456760a22d690bd6a114e35cb925d3db8447e38e",
  jsonSha256: "58255201cfef4e831cc2b989af85874f0dca444b6ead50e61cd9466db4cdf8ce",
  markdownSha256: "e3f04061f64fcd211ba59d46fdd305b8502a04a29ebc8ed4b070105f496fdf7f",
  releaseDigest: "c022f28007e4a65a278a1d12456760a22d690bd6a114e35cb925d3db8447e38e",
  resourceIdentitySha256: "efccdb6aa126dcda0f866913bfd5977751e03013b9f5f842c5e313a84e34cff8",
  semanticContractDigest: "534b8271f7d9acb6000f45c856eba0e81bd314ac7aa7db44edf45aca21c7d725",
  semanticContractVersion: 7,
  stem: "installer-repair-production-replay-v4-2026-07-31T01-27-54-188Z",
});

export interface ProductionReplayReadMetrics {
  readonly distinctSourcePaths: number;
  readonly distinctVerifiedMarkerPaths: number;
  readonly sourceReadBytes: number;
  readonly sourceReadOperations: number;
}

export interface ProductionReplaySourceReads {
  readonly admission: ProductionReplayReadMetrics;
  readonly initial: ProductionReplayReadMetrics;
  readonly repair: ProductionReplayReadMetrics;
  readonly totalBytes: number;
}

export interface ProductionReplayFetchObservation {
  readonly bodyBytes: number;
  readonly ifRange: string | null;
  readonly range: string | null;
  readonly url: string;
}

export interface ProductionReplayPublicationEntry {
  readonly bytes: number;
  readonly path: string;
  readonly sha256: string;
}

export interface ProductionReplayObservation {
  readonly admittedResource: Readonly<{
    bytes: number;
    id: string;
    sha256: string;
    source: string;
  }>;
  readonly appEntrypointPath: string;
  readonly buildManifestSha256: string;
  readonly fetches: readonly ProductionReplayFetchObservation[];
  readonly installStore: unknown;
  readonly installManifestSha256: string;
  readonly lifetimeMode: ProductionReplayLifetimeMode;
  readonly opfsBytes: number;
  readonly opfsResourceCount: number;
  readonly publicComposite: unknown;
  readonly publicationAfter: readonly ProductionReplayPublicationEntry[];
  readonly publicationBefore: readonly ProductionReplayPublicationEntry[];
  readonly publicationCountBefore: number;
  readonly resourceIdentitySha256: string;
  readonly releaseDigest: string;
  readonly semanticContractDigest: string;
  readonly semanticContractVersion: number;
  readonly sourceReads: ProductionReplaySourceReads;
  readonly secondCorruption: Readonly<{
    admissionUnchanged: boolean;
    failureCode: string;
    recoveryAction: string;
    rejected: boolean;
  }>;
  readonly transferTelemetry: unknown;
  readonly workerResponse: unknown;
}

export interface ValidatedProductionReplay {
  readonly admittedResource: ProductionReplayObservation["admittedResource"];
  readonly fetch: ProductionReplayFetchObservation;
  readonly installStore: InstallStoreTelemetrySnapshot;
  readonly opfsBytes: number;
  readonly opfsResourceCount: number;
  readonly publicComposite: InstallerSnapshot;
  readonly publication: Readonly<{
    readonly bytes: number;
    count: number;
    readonly metadataSha256: string;
    entries: readonly ProductionReplayPublicationEntry[];
  }>;
  readonly releaseDigest: string;
  readonly postValidation: Readonly<{
    activeReleaseDigest: string;
    failureCode: "integrity";
    recoveryAction: "repair";
    readyReleaseCount: 1;
    secondCorruptionRejected: true;
    storeState: "ready";
  }>;
  readonly semanticContractDigest: string;
  readonly semanticContractVersion: number;
  readonly sourceReads: ProductionReplaySourceReads;
  readonly transferTelemetry: InstallerTransferTelemetrySnapshot;
  readonly workerResponse: ReturnType<typeof parseInstallerResponse>;
}

const expectedTransfer = Object.freeze({
  ...idleInstallerTransferTelemetrySnapshot(1, 8 * 1024 * 1024),
  activeReleaseDigest: INSTALL_MANIFEST_SHA256,
  checkpointedBytes: ADMITTED_BYTES,
  completedResourceCount: 0,
  downloadedBytes: ADMITTED_BYTES,
  finalVerificationBytes: EXPECTED_OPFS_BYTES,
  finalVerificationPhase: "complete" as const,
  finalVerificationResourceCount: EXPECTED_OPFS_RESOURCES,
  finalVerificationTotalBytes: EXPECTED_OPFS_BYTES,
  finalVerificationTotalResourceCount: EXPECTED_OPFS_RESOURCES,
  hashedBytes: ADMITTED_BYTES,
  httpRequestCount: 1,
  operationRepairAttemptCount: 1,
  operationRepairedBytes: ADMITTED_BYTES,
  operationRepairedResourceCount: 1,
  plannedDownloadBytes: ADMITTED_BYTES,
  rangeRequestCount: 1,
  resourceCount: EXPECTED_OPFS_RESOURCES,
  reusedBytes: EXPECTED_OPFS_BYTES - ADMITTED_BYTES,
  state: "ready" as const,
  totalBytes: EXPECTED_OPFS_BYTES,
  verifiedBytes: 0,
});

const baseStore = unavailableInstallStoreTelemetrySnapshot();
const expectedStore = Object.freeze({
  activeReleaseDigest: INSTALL_MANIFEST_SHA256,
  checkpointWriteCount: 1,
  currentCheckpointCount: 0,
  currentReleaseDigest: null,
  currentResourceId: null,
  etagBoundPartialCount: 0,
  failureMessage: null,
  finalVerificationBytes: EXPECTED_OPFS_BYTES,
  finalVerificationPhase: "complete",
  finalVerificationResourceCount: EXPECTED_OPFS_RESOURCES,
  finalVerificationTotalBytes: EXPECTED_OPFS_BYTES,
  finalVerificationTotalResourceCount: EXPECTED_OPFS_RESOURCES,
  garbageCollectedBytes: 0,
  garbageCollectedEntries: 0,
  garbageCollectionRemaining: false,
  hashedBytes: 5 * EXPECTED_OPFS_BYTES + ADMITTED_BYTES,
  integrityFailures: 1,
  partialBytes: 0,
  partialResourceCount: 0,
  previousReleaseDigest: null,
  publicationCount: 1,
  quotaExceededCount: 0,
  readyReleaseCount: 1,
  reconciliationCount: 1,
  recoveryCount: 0,
  resumedBytes: 0,
  reusedBytes: 0,
  rollbackCount: 0,
  schemaVersion: baseStore.schemaVersion,
  stagedReleaseCount: 1,
  state: "ready",
  verifiedObjectBytes: EXPECTED_OPFS_BYTES,
  verifiedObjectCount: EXPECTED_OPFS_RESOURCES,
  writtenBytes: ADMITTED_BYTES,
});

const expectedPublication = Object.freeze([
  Object.freeze({
    bytes: 115,
    path: `parallax-install-v1/commits/00000000000000000001-${INSTALL_MANIFEST_SHA256}.json`,
    sha256: "7c1ea66820abe3481be448c4ed9d9dd8dbffe906df13d08f77bdb939d081cbd2",
  }),
  Object.freeze({
    bytes: 138_831,
    path: `parallax-install-v1/releases/${INSTALL_MANIFEST_SHA256}/install-manifest.json`,
    sha256: INSTALL_MANIFEST_SHA256,
  }),
  Object.freeze({
    bytes: 103,
    path: `parallax-install-v1/releases/${INSTALL_MANIFEST_SHA256}/published.json`,
    sha256: "d6cb44222384d05054a627e68ea9fcf75391cc4fd8f43912b8fcc9d7af909ffb",
  }),
  Object.freeze({
    bytes: 150,
    path: `parallax-install-v1/releases/${INSTALL_MANIFEST_SHA256}/ready.json`,
    sha256: "286c959a121ef4ec6f62498960e4b4562a39f7671132f986d319c13b725a4041",
  }),
  Object.freeze({
    bytes: 156,
    path: `parallax-install-v1/releases/${INSTALL_MANIFEST_SHA256}/staged.json`,
    sha256: "92c589c21619995cbe29f899d44b401695a81d1c624018db182131bc2107aff9",
  }),
]);

const readMetricsFields = Object.freeze([
  "distinctSourcePaths",
  "distinctVerifiedMarkerPaths",
  "sourceReadBytes",
  "sourceReadOperations",
] as const);
const observationFields = Object.freeze([
  "admittedResource",
  "appEntrypointPath",
  "buildManifestSha256",
  "fetches",
  "installStore",
  "installManifestSha256",
  "lifetimeMode",
  "opfsBytes",
  "opfsResourceCount",
  "publicComposite",
  "publicationAfter",
  "publicationBefore",
  "publicationCountBefore",
  "releaseDigest",
  "resourceIdentitySha256",
  "secondCorruption",
  "semanticContractDigest",
  "semanticContractVersion",
  "sourceReads",
  "transferTelemetry",
  "workerResponse",
] as const);

export const INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT = Object.freeze({
  admittedResource: Object.freeze({
    fields: Object.freeze(["bytes", "id", "sha256", "source"]),
    value: Object.freeze({
      bytes: ADMITTED_BYTES,
      id: "game-specific-scale-streaming-02-indices-48dbc293f3641379bdd630b8933642b7863cd649102b47963ab6f6eebf237f17",
      sha256: "48dbc293f3641379bdd630b8933642b7863cd649102b47963ab6f6eebf237f17",
      source:
        "immutable/streaming-indices-48dbc293f3641379bdd630b8933642b7863cd649102b47963ab6f6eebf237f17.meshopt",
    }),
  }),
  identities: Object.freeze({
    appEntrypointPath: APP_ENTRYPOINT_PATH,
    buildManifestSha256: BUILD_MANIFEST_SHA256,
    installManifestSha256: INSTALL_MANIFEST_SHA256,
    releaseDigest: INSTALL_MANIFEST_SHA256,
    resourceIdentitySha256: RESOURCE_IDENTITY_SHA256,
  }),
  lifetimeMode: "restarted",
  lifetimeModes: INSTALLER_REPAIR_PRODUCTION_REPLAY_LIFETIME_MODES,
  observationFields,
  opfs: Object.freeze({ bytes: EXPECTED_OPFS_BYTES, resources: EXPECTED_OPFS_RESOURCES }),
  publication: Object.freeze({
    countBefore: 1,
    entries: expectedPublication,
    entryFields: Object.freeze(["bytes", "path", "sha256"]),
    equality: "publicationAfter-deep-equals-publicationBefore",
    metadataDigestFormula: "sha256(utf8(JSON.stringify(publicationAfter)))",
    totalBytesFormula: "sum(publicationAfter[].bytes)",
  }),
  publicComposite: Object.freeze({
    fields: Object.freeze(["installStore", "installerTransfer"]),
    mappings: Object.freeze({
      installStore: "observation.installStore",
      installerTransfer: "observation.transferTelemetry",
    }),
  }),
  request: Object.freeze({
    fetchCount: 1,
    fields: Object.freeze(["bodyBytes", "ifRange", "range", "url"]),
    value: Object.freeze({
      bodyBytes: ADMITTED_BYTES,
      ifRange: null,
      range: "bytes=0-",
      url: `https://example.test/immutable/streaming-indices-48dbc293f3641379bdd630b8933642b7863cd649102b47963ab6f6eebf237f17.meshopt`,
    }),
    urlFormula: "new URL(admittedResource.source, 'https://example.test/').href",
  }),
  secondCorruption: Object.freeze({
    fields: Object.freeze(["admissionUnchanged", "failureCode", "recoveryAction", "rejected"]),
    value: Object.freeze({
      admissionUnchanged: true,
      failureCode: "integrity",
      recoveryAction: "repair",
      rejected: true,
    }),
  }),
  sourceReads: Object.freeze({
    equations: Object.freeze({
      admission:
        "{bytes:totalBytes-admittedBytes,operations:resourceCount-1,sourcePaths:resourceCount-1,markerPaths:resourceCount-1}",
      initial:
        "{bytes:totalBytes,operations:resourceCount,sourcePaths:resourceCount,markerPaths:0}",
      repair:
        "{bytes:3*(totalBytes-admittedBytes),operations:3*(resourceCount-1),sourcePaths:resourceCount-1,markerPaths:resourceCount}",
      totalBytes: "initial.sourceReadBytes+admission.sourceReadBytes+repair.sourceReadBytes",
    }),
    fields: Object.freeze(["admission", "initial", "repair", "totalBytes"]),
    metricFields: readMetricsFields,
    value: computeProductionReplaySourceReads(
      EXPECTED_OPFS_BYTES,
      EXPECTED_OPFS_RESOURCES,
      ADMITTED_BYTES,
    ),
  }),
  result: Object.freeze({
    crossMode: Object.freeze({
      fields: Object.freeze([
        "identitiesEqual",
        "noRepublishEqual",
        "publicationEqual",
        "repairRequestSemanticsEqual",
        "sessionRequestSequencesBound",
        "sourceReadsEqual",
        "storeEqual",
      ]),
      projection: Object.freeze({
        installStoreNondeterministic: Object.freeze(["lastOperationDurationMs"] as const),
        protocolLifetimeSpecific: Object.freeze(["requestId"] as const),
        transferLifetimeSpecific: Object.freeze([
          "completedResourceCount",
          "verifiedBytes",
        ] as const),
        transferNondeterministic: Object.freeze([
          "lockWaitDurationMs",
          "operationDurationMs",
        ] as const),
      }),
      value: Object.freeze({
        identitiesEqual: true,
        noRepublishEqual: true,
        publicationEqual: true,
        repairRequestSemanticsEqual: true,
        sessionRequestSequencesBound: true,
        sourceReadsEqual: true,
        storeEqual: true,
      }),
    }),
    fields: Object.freeze([
      "crossMode",
      "lifetimeModes",
      "modes",
      "semanticContractDigest",
      "semanticContractVersion",
    ]),
    modeFields: Object.freeze([
      "identities",
      "lifetimeMode",
      "postValidation",
      "requests",
      "sourceReads",
      "worker",
    ]),
    modes: INSTALLER_REPAIR_PRODUCTION_REPLAY_LIFETIME_MODES,
    requestSequences: Object.freeze({
      restarted: Object.freeze([
        Object.freeze({
          expectedReleaseDigest: INSTALL_MANIFEST_SHA256,
          kind: "repair",
          requestId: 1,
          shellEntrypointPath: APP_ENTRYPOINT_PATH,
        }),
      ]),
      "same-worker": Object.freeze([
        Object.freeze({
          kind: "install",
          requestId: 1,
          shellEntrypointPath: APP_ENTRYPOINT_PATH,
        }),
        Object.freeze({
          expectedReleaseDigest: INSTALL_MANIFEST_SHA256,
          kind: "repair",
          requestId: 2,
          shellEntrypointPath: APP_ENTRYPOINT_PATH,
        }),
      ]),
    }),
  }),
  store: Object.freeze({
    exact: expectedStore,
    fields: Object.freeze(Object.keys(baseStore).sort()),
    formulas: Object.freeze({
      checkpointWriteCount: "one repaired-resource final checkpoint",
      finalVerificationBytes: "opfs.bytes",
      finalVerificationResourceCount: "opfs.resources",
      finalVerificationTotalBytes: "opfs.bytes",
      finalVerificationTotalResourceCount: "opfs.resources",
      hashedBytes: "5*opfs.bytes+admittedResource.bytes",
      integrityFailures: "one admitted corruption discovery",
      publicationCount: "one initial publication; Repair does not republish",
      readyReleaseCount: "one ready target release",
      reconciliationCount: "one explicit initial reconciliation",
      stagedReleaseCount: "one target release",
      verifiedObjectBytes: "opfs.bytes",
      verifiedObjectCount: "opfs.resources",
      writtenBytes: "admittedResource.bytes",
    }),
    finalVerificationFields: Object.freeze([
      "finalVerificationBytes",
      "finalVerificationPhase",
      "finalVerificationResourceCount",
      "finalVerificationTotalBytes",
      "finalVerificationTotalResourceCount",
    ]),
    schemaLabel: "install-store-v3",
    variableDomains: Object.freeze({
      lastOperationDurationMs: "finite-nonnegative-number",
    }),
  }),
  transfer: Object.freeze({
    deterministicFields: Object.freeze(
      Object.keys(expectedTransfer)
        .filter((field) => field !== "lockWaitDurationMs" && field !== "operationDurationMs")
        .sort(),
    ),
    fields: Object.freeze(Object.keys(expectedTransfer).sort()),
    value: expectedTransfer,
    variableDomains: Object.freeze({
      lockWaitDurationMs: "finite-nonnegative-number",
      operationDurationMs: "finite-nonnegative-number",
    }),
  }),
  version: INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_VERSION,
  workerResponse: Object.freeze({
    fields: Object.freeze([
      "kind",
      "readyBytes",
      "readyResourceCount",
      "releaseDigest",
      "requestId",
    ]),
    value: Object.freeze({
      kind: "install-complete",
      readyBytes: EXPECTED_OPFS_BYTES,
      readyResourceCount: EXPECTED_OPFS_RESOURCES,
      releaseDigest: INSTALL_MANIFEST_SHA256,
      requestId: 1,
    }),
  }),
});

export const INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_DIGEST =
  "d621e6efc56ce2fb99da8cce1a8004afbe21676e43249d4f212a319bad2edfbc";

export interface InstallerRepairProductionReplayCompiledModule {
  readonly INSTALLER_REPAIR_PRODUCTION_REPLAY_PROTOCOL_IDENTITY?: unknown;
  readonly INSTALLER_REPAIR_PRODUCTION_REPLAY_SCHEMA_VERSION?: unknown;
  readonly INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_DIGEST?: unknown;
  readonly INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_VERSION?: unknown;
  readonly executeReplay?: unknown;
  readonly recomputeProductionReplaySemanticContractDigest?: unknown;
  readonly validateProductionReplayArtifactIdentity?: unknown;
}

export function assertInstallerRepairProductionReplayCompiledModule(
  module: InstallerRepairProductionReplayCompiledModule,
): void {
  assert.equal(
    module.INSTALLER_REPAIR_PRODUCTION_REPLAY_PROTOCOL_IDENTITY,
    "installer-repair-production-replay@4",
  );
  assert.equal(
    module.INSTALLER_REPAIR_PRODUCTION_REPLAY_SCHEMA_VERSION,
    INSTALLER_REPAIR_PRODUCTION_REPLAY_SCHEMA_VERSION,
  );
  assert.equal(module.INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_VERSION, 9);
  assert.equal(
    module.INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_DIGEST,
    "d621e6efc56ce2fb99da8cce1a8004afbe21676e43249d4f212a319bad2edfbc",
  );
  assert.equal(typeof module.executeReplay, "function");
  assert.equal(typeof module.validateProductionReplayArtifactIdentity, "function");
  assert.equal(typeof module.recomputeProductionReplaySemanticContractDigest, "function");
  assert.equal(
    (module.recomputeProductionReplaySemanticContractDigest as () => string)(),
    "d621e6efc56ce2fb99da8cce1a8004afbe21676e43249d4f212a319bad2edfbc",
  );
}

export function deriveProductionReplaySourceReads(
  totalBytes: number = INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.opfs.bytes,
  resourceCount: number = INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.opfs.resources,
  admittedBytes: number = INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.admittedResource
    .value.bytes,
): ProductionReplaySourceReads {
  return computeProductionReplaySourceReads(totalBytes, resourceCount, admittedBytes);
}

function computeProductionReplaySourceReads(
  totalBytes: number,
  resourceCount: number,
  admittedBytes: number,
): ProductionReplaySourceReads {
  assertSafePositive(totalBytes, "totalBytes");
  assertSafePositive(resourceCount, "resourceCount");
  assertSafePositive(admittedBytes, "admittedBytes");
  assert.ok(admittedBytes < totalBytes, "admittedBytes must be smaller than totalBytes");
  const retainedBytes = totalBytes - admittedBytes;
  const retainedResources = resourceCount - 1;
  const initial = metrics(totalBytes, resourceCount, resourceCount, 0);
  const admission = metrics(retainedBytes, retainedResources, retainedResources, retainedResources);
  const repair = metrics(
    retainedBytes * 3,
    retainedResources * 3,
    retainedResources,
    resourceCount,
  );
  return Object.freeze({
    admission,
    initial,
    repair,
    totalBytes: initial.sourceReadBytes + admission.sourceReadBytes + repair.sourceReadBytes,
  });
}

export function validateProductionReplayObservation(
  observation: ProductionReplayObservation,
): ValidatedProductionReplay {
  const contract = INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT;
  assertExactKeys(observation as unknown as Record<string, unknown>, contract.observationFields);
  assert.equal(observation.opfsBytes, contract.opfs.bytes, "OPFS bytes");
  assert.equal(observation.opfsResourceCount, contract.opfs.resources, "OPFS resource count");
  assertExactKeys(
    observation.admittedResource as unknown as Record<string, unknown>,
    contract.admittedResource.fields,
  );
  assert.deepEqual(observation.admittedResource, contract.admittedResource.value);
  assert.equal(observation.appEntrypointPath, contract.identities.appEntrypointPath);
  assert.equal(observation.buildManifestSha256, contract.identities.buildManifestSha256);
  assert.equal(observation.installManifestSha256, contract.identities.installManifestSha256);
  assert.equal(observation.releaseDigest, contract.identities.releaseDigest);
  assert.equal(observation.installManifestSha256, observation.releaseDigest);
  assert.ok(
    contract.lifetimeModes.includes(observation.lifetimeMode),
    "production replay lifetime mode",
  );
  assert.equal(observation.resourceIdentitySha256, contract.identities.resourceIdentitySha256);
  assert.equal(
    observation.semanticContractDigest,
    INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_DIGEST,
  );
  assert.equal(observation.semanticContractVersion, contract.version);
  validateSourceReads(observation.sourceReads, contract.sourceReads);

  assert.equal(observation.fetches.length, contract.request.fetchCount, "exact Repair fetch count");
  const fetch = observation.fetches[0];
  assert.ok(fetch);
  assertExactKeys(fetch as unknown as Record<string, unknown>, contract.request.fields);
  assert.deepEqual(fetch, contract.request.value);

  assertRecord(observation.publicComposite, "public composite");
  assertExactKeys(observation.publicComposite, contract.publicComposite.fields);
  assertRecord(observation.installStore, "direct install store");
  assertRecord(observation.transferTelemetry, "direct transfer");
  assertExactKeys(observation.installStore, contract.store.fields);
  assertExactKeys(observation.transferTelemetry, contract.transfer.fields);

  const publicComposite = parseInstallerSnapshot(observation.publicComposite);
  const transferTelemetry = parseInstallerSnapshot({
    installStore: publicComposite.installStore,
    installerTransfer: observation.transferTelemetry,
  }).installerTransfer;
  const installStore = publicComposite.installStore;
  for (const [publicField, directField] of Object.entries(contract.publicComposite.mappings)) {
    const direct: unknown =
      directField === "observation.installStore"
        ? observation.installStore
        : observation.transferTelemetry;
    assert.deepEqual(
      observation.publicComposite[publicField],
      direct,
      `${publicField} public/direct mapping`,
    );
  }
  assert.deepEqual(publicComposite.installerTransfer, transferTelemetry);
  assert.deepEqual(observation.installStore, installStore);

  const workerResponse = parseInstallerResponse(observation.workerResponse);
  assertExactKeys(
    observation.workerResponse as Record<string, unknown>,
    contract.workerResponse.fields,
  );
  assert.deepEqual(
    workerResponse,
    observation.lifetimeMode === "same-worker"
      ? { ...contract.workerResponse.value, requestId: 2 }
      : contract.workerResponse.value,
  );
  const expectedTransferForMode =
    observation.lifetimeMode === "same-worker"
      ? {
          ...contract.transfer.value,
          completedResourceCount: contract.opfs.resources,
          verifiedBytes: contract.opfs.bytes,
        }
      : contract.transfer.value;
  assert.deepEqual(
    pickFields(transferTelemetry, contract.transfer.deterministicFields),
    pickFields(expectedTransferForMode, contract.transfer.deterministicFields),
  );
  for (const field of ["lockWaitDurationMs", "operationDurationMs"] as const) {
    assert.ok(
      Number.isFinite(transferTelemetry[field]) && transferTelemetry[field] >= 0,
      contract.transfer.variableDomains[field],
    );
  }
  assert.deepEqual(observation.secondCorruption, contract.secondCorruption.value);

  for (const entry of observation.publicationBefore) {
    assertExactKeys(entry as unknown as Record<string, unknown>, contract.publication.entryFields);
  }
  for (const entry of observation.publicationAfter) {
    assertExactKeys(entry as unknown as Record<string, unknown>, contract.publication.entryFields);
  }
  assert.deepEqual(observation.publicationBefore, contract.publication.entries);
  assert.deepEqual(observation.publicationAfter, contract.publication.entries);
  const publicationBytes = observation.publicationAfter.reduce(
    (total, entry) => total + entry.bytes,
    0,
  );
  const publicationMetadataSha256 = sha256(canonicalBytes(observation.publicationAfter));
  for (const [key, expected] of Object.entries(contract.store.exact)) {
    assert.deepEqual(installStore[key as keyof InstallStoreTelemetrySnapshot], expected, key);
  }
  assert.ok(
    Number.isFinite(installStore.lastOperationDurationMs) &&
      installStore.lastOperationDurationMs >= 0,
    contract.store.variableDomains.lastOperationDurationMs,
  );
  assert.deepEqual(
    pickFields(transferTelemetry, contract.store.finalVerificationFields),
    pickFields(installStore, contract.store.finalVerificationFields),
  );
  assert.equal(transferTelemetry.activeReleaseDigest, installStore.activeReleaseDigest);
  assert.equal(transferTelemetry.state, installStore.state);
  assert.equal(
    observation.publicationCountBefore,
    contract.publication.countBefore,
    "publicationCountBefore",
  );
  assert.deepEqual(
    observation.publicationAfter,
    observation.publicationBefore,
    contract.publication.equality,
  );

  return Object.freeze({
    admittedResource: Object.freeze({ ...observation.admittedResource }),
    fetch: Object.freeze({ ...fetch }),
    installStore,
    opfsBytes: observation.opfsBytes,
    opfsResourceCount: observation.opfsResourceCount,
    publicComposite,
    publication: Object.freeze({
      bytes: publicationBytes,
      count: observation.publicationCountBefore,
      entries: Object.freeze(
        observation.publicationAfter.map((entry) => Object.freeze({ ...entry })),
      ),
      metadataSha256: publicationMetadataSha256,
    }),
    postValidation: Object.freeze({
      activeReleaseDigest: contract.identities.releaseDigest,
      failureCode: contract.secondCorruption.value.failureCode,
      readyReleaseCount: contract.store.exact.readyReleaseCount,
      recoveryAction: contract.secondCorruption.value.recoveryAction,
      secondCorruptionRejected: contract.secondCorruption.value.rejected,
      storeState: contract.store.exact.state,
    }),
    releaseDigest: observation.releaseDigest,
    semanticContractDigest: INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_DIGEST,
    semanticContractVersion: contract.version,
    sourceReads: observation.sourceReads,
    transferTelemetry,
    workerResponse,
  });
}

export function validateProductionReplayResult(input: unknown): Readonly<Record<string, unknown>> {
  assertRecord(input, "production replay result");
  const contract = INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT;
  assertExactKeys(input, contract.result.fields);
  assert.equal(
    input.semanticContractDigest,
    INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_DIGEST,
  );
  assert.equal(input.semanticContractVersion, contract.version);
  assert.deepEqual(input.lifetimeModes, contract.result.modes);
  assertRecord(input.crossMode, "production replay cross-mode result");
  assertExactKeys(input.crossMode, contract.result.crossMode.fields);
  assert.deepEqual(input.crossMode, contract.result.crossMode.value);
  const modes = input.modes;
  assertRecord(modes, "production replay modes");
  assertExactKeys(modes, contract.result.modes);
  const validatedModes = contract.result.modes.map((lifetimeMode) => {
    const mode = modes[lifetimeMode];
    assertRecord(mode, `${lifetimeMode} production replay mode`);
    assertExactKeys(mode, contract.result.modeFields);
    assert.equal(mode.lifetimeMode, lifetimeMode);
    assert.deepEqual(
      mode.requests,
      contract.result.requestSequences[lifetimeMode].map((request) => ({
        request,
        response: { ...contract.workerResponse.value, requestId: request.requestId },
      })),
    );
    assert.deepEqual(mode.sourceReads, contract.sourceReads.value);
    assertRecord(mode.identities, `${lifetimeMode} identities`);
    assert.deepEqual(mode.identities, {
      appEntrypointPath: contract.identities.appEntrypointPath,
      buildManifestSha256: contract.identities.buildManifestSha256,
      installManifestSha256: contract.identities.installManifestSha256,
      opfsBytes: contract.opfs.bytes,
      opfsResourceCount: contract.opfs.resources,
      releaseDigest: contract.identities.releaseDigest,
      resourceIdentitySha256: contract.identities.resourceIdentitySha256,
    });
    assertRecord(mode.worker, `${lifetimeMode} worker`);
    assertExactKeys(mode.worker, [
      "fetch",
      "protocolResponse",
      "publicComposite",
      "transferTelemetry",
    ]);
    assert.deepEqual(mode.worker.fetch, contract.request.value);
    assert.deepEqual(mode.worker.protocolResponse, {
      ...contract.workerResponse.value,
      requestId: lifetimeMode === "same-worker" ? 2 : 1,
    });
    const publicComposite = parseInstallerSnapshot(mode.worker.publicComposite);
    assert.deepEqual(publicComposite.installStore, {
      ...contract.store.exact,
      lastOperationDurationMs: publicComposite.installStore.lastOperationDurationMs,
    });
    assert.deepEqual(publicComposite.installerTransfer, mode.worker.transferTelemetry);
    const expectedTransferForMode =
      lifetimeMode === "same-worker"
        ? {
            ...contract.transfer.value,
            completedResourceCount: contract.opfs.resources,
            verifiedBytes: contract.opfs.bytes,
          }
        : contract.transfer.value;
    assert.deepEqual(
      pickFields(publicComposite.installerTransfer, contract.transfer.deterministicFields),
      pickFields(expectedTransferForMode, contract.transfer.deterministicFields),
    );
    for (const field of ["lockWaitDurationMs", "operationDurationMs"] as const) {
      assert.ok(
        Number.isFinite(publicComposite.installerTransfer[field]) &&
          publicComposite.installerTransfer[field] >= 0,
        contract.transfer.variableDomains[field],
      );
    }
    assertRecord(mode.postValidation, `${lifetimeMode} post-validation`);
    assert.deepEqual(mode.postValidation, {
      activeReleaseDigest: contract.identities.releaseDigest,
      failureCode: contract.secondCorruption.value.failureCode,
      publication: {
        bytes: contract.publication.entries.reduce((total, entry) => total + entry.bytes, 0),
        count: contract.publication.countBefore,
        entries: contract.publication.entries,
        metadataSha256: sha256(canonicalBytes(contract.publication.entries)),
      },
      readyReleaseCount: contract.store.exact.readyReleaseCount,
      recoveryAction: contract.secondCorruption.value.recoveryAction,
      secondCorruptionRejected: contract.secondCorruption.value.rejected,
      storeState: contract.store.exact.state,
    });
    return mode;
  });
  assert.deepEqual(validatedModes[0]?.identities, validatedModes[1]?.identities);
  assert.deepEqual(validatedModes[0]?.sourceReads, validatedModes[1]?.sourceReads);
  assert.deepEqual(validatedModes[0]?.postValidation, validatedModes[1]?.postValidation);
  const restartedWorker = validatedModes[0]?.worker as Record<string, unknown> | undefined;
  const sameWorker = validatedModes[1]?.worker as Record<string, unknown> | undefined;
  assert.ok(restartedWorker && sameWorker);
  assert.deepEqual(restartedWorker.fetch, sameWorker.fetch);
  assert.deepEqual(
    projectCrossModeComposite(restartedWorker.publicComposite, contract),
    projectCrossModeComposite(sameWorker.publicComposite, contract),
  );
  assert.deepEqual(
    projectCrossModeTransfer(restartedWorker.transferTelemetry, contract),
    projectCrossModeTransfer(sameWorker.transferTelemetry, contract),
  );
  assert.deepEqual(
    omitFields(
      restartedWorker.protocolResponse,
      contract.result.crossMode.projection.protocolLifetimeSpecific,
    ),
    omitFields(
      sameWorker.protocolResponse,
      contract.result.crossMode.projection.protocolLifetimeSpecific,
    ),
  );
  return Object.freeze({ ...input });
}

function projectCrossModeComposite(
  input: unknown,
  contract: typeof INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT,
): Readonly<Record<string, unknown>> {
  assertRecord(input, "cross-mode public composite");
  assertRecord(input.installStore, "cross-mode public install store");
  return Object.freeze({
    installStore: omitFields(
      input.installStore,
      contract.result.crossMode.projection.installStoreNondeterministic,
    ),
    installerTransfer: projectCrossModeTransfer(input.installerTransfer, contract),
  });
}

function projectCrossModeTransfer(
  input: unknown,
  contract: typeof INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT,
): Readonly<Record<string, unknown>> {
  assertRecord(input, "cross-mode transfer");
  return omitFields(input, [
    ...contract.result.crossMode.projection.transferLifetimeSpecific,
    ...contract.result.crossMode.projection.transferNondeterministic,
  ] satisfies readonly (keyof InstallerTransferTelemetrySnapshot)[]);
}

function omitFields(input: unknown, fields: readonly string[]): Readonly<Record<string, unknown>> {
  assertRecord(input, "projected record");
  const excluded = new Set(fields);
  return Object.freeze(
    Object.fromEntries(Object.entries(input).filter(([field]) => !excluded.has(field))),
  );
}

export function recomputeProductionReplaySemanticContractDigest(): string {
  return sha256(canonicalBytes(INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT));
}

function validateSourceReads(
  value: ProductionReplaySourceReads,
  contract: typeof INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.sourceReads,
): void {
  assertExactKeys(value as unknown as Record<string, unknown>, contract.fields);
  for (const phase of ["admission", "initial", "repair"] as const) {
    assertExactKeys(value[phase] as unknown as Record<string, unknown>, contract.metricFields);
  }
  assert.deepEqual(value, contract.value);
}

function assertExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): void {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), label);
}

function pickFields<T extends object>(value: T, fields: readonly string[]) {
  return Object.fromEntries(fields.map((field) => [field, value[field as keyof T]])) as Record<
    string,
    unknown
  >;
}

function metrics(
  sourceReadBytes: number,
  sourceReadOperations: number,
  distinctSourcePaths: number,
  distinctVerifiedMarkerPaths: number,
): ProductionReplayReadMetrics {
  return Object.freeze({
    distinctSourcePaths,
    distinctVerifiedMarkerPaths,
    sourceReadBytes,
    sourceReadOperations,
  });
}

function assertSafePositive(value: number, label: string): void {
  assert.ok(Number.isSafeInteger(value) && value > 0, `${label} must be a positive safe integer`);
}

function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
