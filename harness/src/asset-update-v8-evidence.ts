import { createHash } from "node:crypto";
import {
  BUILD_MANIFEST_SCHEMA_VERSION,
  INSTALL_MANIFEST_GAME_ID,
  INSTALL_MANIFEST_PATH,
  INSTALL_MANIFEST_SCHEMA_VERSION,
  INSTALLER_TRANSFER_TELEMETRY_SCHEMA_VERSION,
  type InstallerTransferTelemetrySnapshot,
  LAUNCH_LIFECYCLE_SCHEMA_VERSION,
  OFFLINE_SHELL_GENERATION_SCHEMA_VERSION,
  OFFLINE_SHELL_SAVE_SCHEMA_VERSION,
  STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
  STREAMING_STARTUP_TIMING_CONTRACT,
  STREAMING_STARTUP_TIMING_SCHEMA_VERSION,
  type StreamingStartupTimingSnapshot,
} from "@parallax/engine";
import {
  type AssetOnlyReleaseUpdateAnalysis,
  analyzeAssetOnlyReleaseUpdate,
} from "./asset-only-release-update.js";
import { ASSET_UPDATE_V8_FAILURE_PHASES } from "./asset-update-v8-failure-phase.js";
import {
  FINAL_VERIFICATION_POLL_INTERVAL_MS,
  FINAL_VERIFICATION_POST_READY_TIMEOUT_MS,
  FRESH_INSTALLED_LAUNCH_BUDGET_MS,
  INITIAL_INSTALL_BUDGET_MS,
  INSTALL_EXIT_CONTRACT,
  type InitialInstallExitBreakdown,
  type InitialInstallExitEvidence,
  installControlIdentities,
  validatedInitialInstallExitBreakdown,
  validateInitialInstallExitBudget,
  validateInitialInstallExitEvidence,
} from "./asset-update-v8-install-exit.js";
import {
  isSanitizedAssetUpdateDiagnostic,
  isSanitizedAssetUpdateErrorName,
  sanitizeAssetUpdateDiagnostic,
} from "./asset-update-v8-sanitization.js";
import { assetUpdateResourceContentType } from "./asset-update-v8-target-representation.js";
import {
  type BuildManifest,
  validateBuildManifestContentAddressedPaths,
} from "./build-manifest.js";
import {
  evaluateGateEnvironment,
  type GateEnvironmentObservation,
  type MachineDescriptor,
} from "./environment.js";
import type { InstallManifest, InstallResource } from "./install-manifest.js";
import { validateInstallerTransferTelemetrySnapshot } from "./installer-transfer-telemetry.js";
import type { SourceIdentity } from "./source-identity.js";
import type {
  V8CodeCacheMetric,
  V8CodeCacheProductionMetric,
  V8ScriptArtifact,
} from "./v8-code-cache-trace.js";
import { V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS } from "./v8-code-cache-trace.js";
import { selectV8ScriptManifestArtifacts } from "./v8-script-artifacts.js";

export const ASSET_UPDATE_V8_CONTRACT = "asset-update-v8-lifecycle@3";
export const ASSET_UPDATE_V8_SCHEMA_VERSION = 3;
const LEGACY_ASSET_UPDATE_V8_CONTRACT = "asset-update-v8-lifecycle@2";
const LEGACY_ASSET_UPDATE_V8_SCHEMA_VERSION = 2;
export const WARM_LAUNCH_BUDGET_MS = 10_000;

export function assetUpdateJsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJsonValue(left)) === JSON.stringify(canonicalJsonValue(right));
}

const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const PROFILE_ID = /^[a-f0-9-]{16,64}$/;
const INSTALL_RESOURCE_KINDS = new Set([
  "asset-pack",
  "district-index",
  "document",
  "model",
  "module",
  "wasm",
  "worker",
  "world-cell",
]);
const INSTALL_RESOURCE_SCOPES = new Set(["app-shell", "common", "game-specific"]);
const INSTALL_RESOURCE_TARGETS = new Set(["opfs", "shell"]);
const RESULT_PHASES: ReadonlySet<string> = new Set(ASSET_UPDATE_V8_FAILURE_PHASES);

export interface AssetUpdateReleaseAuthority {
  readonly artifactDigest: string;
  readonly buildManifestBase64: string;
  readonly buildManifestSchemaVersion: number;
  readonly installManifestBase64: string;
  readonly releaseDigest: string;
}

export interface AssetUpdateTargetObservation {
  readonly artifactDigest: string;
  readonly buildManifestEtag: string;
  readonly buildManifestSha256: string;
  readonly resourceRepresentations: readonly Readonly<{
    readonly bytes: number;
    readonly cacheControl: "no-cache" | "public, max-age=31536000, immutable";
    readonly conditionalStatus: 304;
    readonly contentType:
      | "application/javascript"
      | "application/json; charset=utf-8"
      | "application/octet-stream"
      | "application/wasm"
      | "image/ktx2"
      | "text/html; charset=utf-8";
    readonly etag: string;
    readonly kind: string;
    readonly sha256: string;
    readonly source: string;
    readonly status: 200 | 206;
    readonly validation: "bounded-range-and-filesystem-sha256" | "full-body-sha256";
  }>[];
  readonly installManifestEtag: string;
  readonly installManifestSha256: string;
  readonly origin: string;
  readonly releaseDigest: string;
}

export interface AssetUpdateReadyAuthority {
  readonly artifactDigest: string;
  readonly generationId: string;
  readonly installStore: Readonly<{
    readonly activeReleaseDigest: string;
    readonly previousReleaseDigest: string | null;
    readonly state: "ready";
  }>;
  readonly launchEnabled: true;
  readonly offlineShell: Readonly<{
    readonly activeArtifactDigest: string;
    readonly activeGenerationId: string;
    readonly activeReleaseDigest: string;
    readonly state: "active";
  }>;
  readonly releaseDigest: string;
  readonly uiState: "ready";
}

export interface LaunchToInteractiveEvidence {
  readonly attempt: 1;
  readonly contract: "launch-to-interactive@2";
  readonly durationMs: number;
  readonly failureMessage: null;
  readonly interactiveAtMs: number;
  readonly preflightTiming: Readonly<{
    readonly finalReleaseAdmissionAtMs: number;
    readonly initialReleaseAdmissionAtMs: number;
    readonly modelSourceReadyAtMs: number;
    readonly psoTraceReadyAtMs: number;
    readonly streamingReferencesReadyAtMs: number;
  }>;
  readonly releaseDigest: string;
  readonly renderFirstFrameAtMs: number;
  readonly schemaVersion: 2;
  readonly shellAdmissionAtMs: number;
  readonly startedAtMs: number;
  readonly state: "interactive";
  readonly streamingStartupTiming: StreamingStartupTimingSnapshot;
  readonly streamingWorkerRequestedAtMs: number;
  readonly streamingReadyAtMs: number;
}

export interface AssetUpdateV8LaunchEvidence {
  readonly cacheState: "setup" | "stable-consume";
  readonly lifecycle: LaunchToInteractiveEvidence;
  readonly ordinal: 1 | 4 | 5;
  readonly persistentProfileId: string;
  readonly phase: "fresh" | "post-warm" | "pre-warm";
  readonly releaseDigest: string;
}

export interface AssetUpdateV8TraceEvidence {
  readonly dataLossOccurred: boolean | null;
  readonly eventCount: number;
  readonly reason?: string;
  readonly state: "invalid" | "measured";
}

export interface AssetUpdateWasmStreamingEvidence {
  readonly api: "compileStreaming";
  readonly artifact: Readonly<{
    readonly bytes: number;
    readonly path: string;
    readonly sha256: string;
  }>;
  readonly durationMs: number | null;
  readonly reason: string | null;
  readonly state: "invalid" | "measured" | "not-applicable";
}

export interface AssetUpdateV8Diagnostics {
  readonly cache: V8CodeCacheMetric;
  readonly phase: "fresh" | "post-warm" | "pre-warm" | "produce";
  readonly persistentProfileId: string;
  readonly production: V8CodeCacheProductionMetric;
  readonly profile: "fresh" | "produce" | "warm";
  readonly runtimeOrdinal: 1 | 2 | 3 | 6;
  readonly scriptArtifacts: readonly V8ScriptArtifact[];
  readonly trace: AssetUpdateV8TraceEvidence;
  readonly wasmStreaming: AssetUpdateWasmStreamingEvidence;
  readonly workerStartupToFirstFrameMs: number | null;
}

export interface AssetUpdateLifecycleResult {
  readonly analysis: AssetOnlyReleaseUpdateAnalysis;
  readonly deltaMs: number;
  readonly initialInstall: InitialInstallExitEvidence;
  readonly lifecycle: readonly Readonly<{
    readonly name:
      | "initial-install-ready"
      | "fresh-launch-interactive"
      | "produce-diagnostic-complete"
      | "pre-warm-launch-interactive"
      | "pre-diagnostic-complete"
      | "asset-update-published"
      | "update-ready"
      | "post-warm-launch-interactive"
      | "post-diagnostic-complete";
    readonly completedAtMs: number;
    readonly persistentProfileId: string;
    readonly releaseDigest: string;
    readonly sequence: number;
  }>[];
  readonly launches: Readonly<{
    readonly fresh: AssetUpdateV8LaunchEvidence;
    readonly post: AssetUpdateV8LaunchEvidence;
    readonly pre: AssetUpdateV8LaunchEvidence;
  }>;
  readonly postRelease: AssetUpdateReleaseAuthority;
  readonly preRelease: AssetUpdateReleaseAuthority;
  readonly publication: Readonly<{
    readonly postReady: AssetUpdateReadyAuthority;
    readonly postTransfer: InstallerTransferTelemetrySnapshot;
    readonly preReady: AssetUpdateReadyAuthority;
    readonly preTransfer: InstallerTransferTelemetrySnapshot;
    readonly updateServerJournal: Readonly<{
      readonly entries: readonly AssetUpdateServerJournalEntry[];
      readonly maximumEntries: 4096;
      readonly overflowed: false;
    }>;
    readonly updateDiscovery: Readonly<{
      readonly code: "shell-release-mismatch";
      readonly recovery: "retry";
      readonly state: "failed";
    }>;
  }>;
  readonly relativeRegressionThreshold: null;
  readonly target: Readonly<{
    readonly post: AssetUpdateTargetObservation;
    readonly pre: AssetUpdateTargetObservation;
  }>;
  readonly v8: Readonly<{
    readonly fresh: AssetUpdateV8Diagnostics;
    readonly post: AssetUpdateV8Diagnostics;
    readonly pre: AssetUpdateV8Diagnostics;
    readonly produce: AssetUpdateV8Diagnostics;
  }>;
  readonly warmLaunchBudgetMs: typeof WARM_LAUNCH_BUDGET_MS;
}

export interface AssetUpdateServerJournalEntry {
  readonly bodyBytes: number;
  readonly cacheControl: string | null;
  readonly coep: string | null;
  readonly contentType: string | null;
  readonly coop: string | null;
  readonly etag: string | null;
  readonly ifNoneMatch: string | null;
  readonly ifRange: string | null;
  readonly method: string;
  readonly nosniff: string | null;
  readonly path: string;
  readonly range: string | null;
  readonly sequence: number;
  readonly status: number;
}

export interface AssetUpdateRunAuthority {
  readonly baseBuild: Readonly<{
    readonly artifactDigest: string;
    readonly releaseDigest: string;
  }>;
  readonly browser: Readonly<{
    readonly executableSha256: string;
    readonly jsVersion: string;
    readonly product: string;
    readonly protocolVersion: "1.3";
    readonly revision: string;
    readonly userAgent: string;
    readonly version: string;
  }>;
  readonly machine: Readonly<{
    readonly descriptorBase64: string;
    readonly descriptorSha256: string;
    readonly gate: Readonly<{
      readonly post: Readonly<{ readonly state: "measured"; readonly value: true }>;
      readonly pre: Readonly<{ readonly state: "measured"; readonly value: true }>;
    }>;
    readonly id: string;
    readonly postObservation: GateEnvironmentObservation;
    readonly preObservation: GateEnvironmentObservation;
  }>;
  readonly persistentProfileId: string;
  readonly source: SourceIdentity;
  readonly targetOrigin: string;
}

interface AssetUpdateFailureSnapshot {
  readonly journal: Readonly<{
    readonly entries: readonly Readonly<{
      readonly bodyBytes: number | null;
      readonly path: string;
      readonly range: string | null;
      readonly sequence: number | null;
      readonly status: number | null;
    }>[];
    readonly observedEntryCount: number;
    readonly retainedEntryCount: number;
    readonly sourceMaximumEntries: number | null;
    readonly sourceOverflowed: boolean | null;
    readonly truncated: boolean;
  }> | null;
  readonly transfer: Readonly<{
    readonly activeReleaseDigest: string | null;
    readonly checkpointedBytes: number | null;
    readonly completedResourceCount: number | null;
    readonly downloadedBytes: number | null;
    readonly hashedBytes: number | null;
    readonly httpRequestCount: number | null;
    readonly plannedDownloadBytes: number | null;
    readonly rangeRequestCount: number | null;
    readonly resourceCount: number | null;
    readonly resumedBytes: number | null;
    readonly reusedBytes: number | null;
    readonly totalBytes: number | null;
    readonly verifiedBytes: number | null;
  }> | null;
}

export type AssetUpdateFailureInitialInstall = InitialInstallExitBreakdown;

export interface AssetUpdatePartialValidationRejection {
  readonly message: string;
  readonly name: string;
  readonly state: "rejected";
}

export type AssetUpdateFailureContext = Readonly<
  AssetUpdateFailureSnapshot &
    (
      | {
          readonly state: "unvalidated-lifecycle-snapshot";
        }
      | {
          readonly initialInstall: AssetUpdateFailureInitialInstall | null;
          readonly partialValidation: Readonly<AssetUpdatePartialValidationRejection>;
          readonly state: "rejected-lifecycle-snapshot";
        }
    )
>;

export type AssetUpdateEvidenceState = "failed" | "passed" | "pending";

interface AssetUpdateEvidenceBase {
  readonly authority: AssetUpdateRunAuthority | null;
  readonly companion: Readonly<{
    readonly path: string;
    readonly state: AssetUpdateEvidenceState;
  }>;
  readonly contract: typeof ASSET_UPDATE_V8_CONTRACT;
  readonly postValidation: Readonly<{
    readonly authority: AssetUpdateRunAuthority | null;
    readonly passed: boolean | null;
    readonly performed: boolean;
    readonly ready: AssetUpdateReadyAuthority | null;
    readonly target: AssetUpdateTargetObservation | null;
  }>;
  readonly resultOwnership: Readonly<{
    readonly publicationState: AssetUpdateEvidenceState;
    readonly reservationId: string;
  }>;
  readonly schemaVersion: typeof ASSET_UPDATE_V8_SCHEMA_VERSION;
  readonly startedAt: string;
  readonly state: AssetUpdateEvidenceState;
}

export type AssetUpdateV8Evidence =
  | Readonly<
      AssetUpdateEvidenceBase & {
        readonly authority: null;
        readonly state: "pending";
      }
    >
  | Readonly<
      AssetUpdateEvidenceBase & {
        readonly completedAt: string;
        readonly failure: Readonly<{
          readonly message: string;
          readonly name: string;
          readonly phase: string;
        }>;
        readonly failureContext: AssetUpdateFailureContext | null;
        readonly partialResult: AssetUpdateLifecycleResult | null;
        readonly state: "failed";
      }
    >
  | Readonly<
      AssetUpdateEvidenceBase & {
        readonly authority: AssetUpdateRunAuthority;
        readonly completedAt: string;
        readonly result: AssetUpdateLifecycleResult;
        readonly state: "passed";
      }
    >;

type LegacyInstallerTransferTelemetrySnapshot = Omit<
  InstallerTransferTelemetrySnapshot,
  | "failureClass"
  | "failureEvidence"
  | "failureOperation"
  | "failureResourceId"
  | "operationRepairAttemptCount"
  | "operationRepairedBytes"
  | "operationRepairedResourceCount"
  | "plannedResumeBytes"
  | "schemaVersion"
> & { readonly schemaVersion: 3 };

type LegacyAssetUpdateV8Diagnostics = Omit<AssetUpdateV8Diagnostics, "wasmStreaming"> & {
  readonly wasmStreaming: Omit<AssetUpdateWasmStreamingEvidence, "api"> & {
    readonly api: "instantiateStreaming";
  };
};

type LegacyAssetUpdateLifecycleResult = Omit<
  AssetUpdateLifecycleResult,
  "initialInstall" | "publication" | "v8"
> & {
  readonly publication: Omit<
    AssetUpdateLifecycleResult["publication"],
    "postTransfer" | "preTransfer"
  > & {
    readonly postTransfer: LegacyInstallerTransferTelemetrySnapshot;
    readonly preTransfer: LegacyInstallerTransferTelemetrySnapshot;
  };
  readonly v8: Readonly<{
    readonly fresh: LegacyAssetUpdateV8Diagnostics;
    readonly post: LegacyAssetUpdateV8Diagnostics;
    readonly pre: LegacyAssetUpdateV8Diagnostics;
    readonly produce: LegacyAssetUpdateV8Diagnostics;
  }>;
};

type LegacyEvidenceIdentity = Readonly<{
  readonly contract: typeof LEGACY_ASSET_UPDATE_V8_CONTRACT;
  readonly schemaVersion: typeof LEGACY_ASSET_UPDATE_V8_SCHEMA_VERSION;
}>;

type ReidentifiedAssetUpdateV8Evidence<T> =
  T extends Readonly<{
    readonly result: AssetUpdateLifecycleResult;
  }>
    ? Omit<T, "contract" | "result" | "schemaVersion"> &
        LegacyEvidenceIdentity & { readonly result: LegacyAssetUpdateLifecycleResult }
    : T extends Readonly<{ readonly partialResult: AssetUpdateLifecycleResult | null }>
      ? Omit<T, "contract" | "partialResult" | "schemaVersion"> &
          LegacyEvidenceIdentity & {
            readonly partialResult: LegacyAssetUpdateLifecycleResult | null;
          }
      : Omit<T, "contract" | "schemaVersion"> & LegacyEvidenceIdentity;

export type LegacyAssetUpdateV8Evidence = ReidentifiedAssetUpdateV8Evidence<AssetUpdateV8Evidence>;
export type ValidatedAssetUpdateV8Evidence = AssetUpdateV8Evidence | LegacyAssetUpdateV8Evidence;

export interface AssetUpdateExpectedAuthority {
  readonly authority: AssetUpdateRunAuthority;
  readonly postArtifactDigest: string;
  readonly postReleaseDigest: string;
}

export function validateAssetUpdateRunAuthority(input: unknown): AssetUpdateRunAuthority {
  return validateAuthority(input);
}

export function validateAssetUpdateInitialInstallBreakdown(
  partialResult: unknown,
): InitialInstallExitBreakdown {
  const result = record(partialResult, "partial result");
  const preRelease = validateReleaseAuthority(result.preRelease, "pre");
  return validatedInitialInstallExitBreakdown(
    result.initialInstall,
    preRelease.installManifest,
    installerWorkerSource(preRelease.buildManifest),
    installControlIdentities(preRelease),
  );
}

export function validateAssetUpdateV8Evidence(
  input: unknown,
  expected?: AssetUpdateExpectedAuthority,
): ValidatedAssetUpdateV8Evidence {
  const report = record(input, "evidence");
  const legacyV2 =
    report.contract === LEGACY_ASSET_UPDATE_V8_CONTRACT &&
    report.schemaVersion === LEGACY_ASSET_UPDATE_V8_SCHEMA_VERSION;
  if (
    (!legacyV2 &&
      (report.contract !== ASSET_UPDATE_V8_CONTRACT ||
        report.schemaVersion !== ASSET_UPDATE_V8_SCHEMA_VERSION)) ||
    (report.state !== "pending" && report.state !== "failed" && report.state !== "passed")
  ) {
    throw new Error("Asset-update V8 evidence has an unsupported contract identity");
  }
  if (typeof report.startedAt !== "string" || !validIso(report.startedAt)) {
    throw new Error("Asset-update V8 evidence start time is invalid");
  }
  const ownership = record(report.resultOwnership, "resultOwnership");
  requireExactKeys(ownership, ["publicationState", "reservationId"], "resultOwnership");
  if (
    ownership.publicationState !== report.state ||
    typeof ownership.reservationId !== "string" ||
    !PROFILE_ID.test(ownership.reservationId)
  ) {
    throw new Error("Asset-update V8 evidence ownership is inconsistent");
  }
  const companion = record(report.companion, "companion");
  requireExactKeys(companion, ["path", "state"], "companion");
  if (
    companion.state !== report.state ||
    typeof companion.path !== "string" ||
    !new RegExp(`^asset-update-v8-v${legacyV2 ? 2 : 3}-[A-Za-z0-9._-]+\\.md$`).test(
      companion.path as string,
    )
  ) {
    throw new Error("Asset-update V8 evidence companion identity is inconsistent");
  }
  const postValidation = record(report.postValidation, "postValidation");
  requireExactKeys(
    postValidation,
    ["authority", "passed", "performed", "ready", "target"],
    "postValidation",
  );

  if (report.state === "pending") {
    requireExactKeys(
      report,
      [
        "authority",
        "companion",
        "contract",
        "postValidation",
        "resultOwnership",
        "schemaVersion",
        "startedAt",
        "state",
      ],
      "pending evidence",
    );
    if (
      report.authority !== null ||
      postValidation.authority !== null ||
      postValidation.performed !== false ||
      postValidation.passed !== null ||
      postValidation.ready !== null ||
      postValidation.target !== null
    ) {
      throw new Error("Pending asset-update V8 evidence claims authority or validation");
    }
    return report as unknown as ValidatedAssetUpdateV8Evidence;
  }

  if (typeof report.completedAt !== "string" || !validIso(report.completedAt)) {
    throw new Error("Terminal asset-update V8 evidence omits completion time");
  }
  if (report.state === "failed") {
    requireExactKeys(
      report,
      [
        "authority",
        "companion",
        "completedAt",
        "contract",
        "failure",
        "failureContext",
        "partialResult",
        "postValidation",
        "resultOwnership",
        "schemaVersion",
        "startedAt",
        "state",
      ],
      "failed evidence",
    );
    validateFailure(report.failure);
    validateFailureContext(report.failureContext);
    const failedAuthority =
      report.authority === null ? null : validateAuthority(report.authority, expected?.authority);
    if (report.partialResult !== null) {
      const authority =
        failedAuthority === null
          ? undefined
          : {
              authority: failedAuthority,
              postArtifactDigest: digestFromPartial(report.partialResult, "artifact"),
              postReleaseDigest: digestFromPartial(report.partialResult, "release"),
            };
      validateLifecycleResult(report.partialResult, authority, {
        allowBudgetFailure: true,
        legacyV2,
      });
    }
    if (
      typeof postValidation.performed !== "boolean" ||
      postValidation.passed !== false ||
      postValidation.ready !== null ||
      postValidation.target !== null ||
      (postValidation.authority !== null &&
        (report.authority === null || !sameJson(postValidation.authority, report.authority)))
    ) {
      throw new Error("Failed asset-update V8 evidence has contradictory post-validation state");
    }
    return report as unknown as ValidatedAssetUpdateV8Evidence;
  }

  requireExactKeys(
    report,
    [
      "authority",
      "companion",
      "completedAt",
      "contract",
      "postValidation",
      "result",
      "resultOwnership",
      "schemaVersion",
      "startedAt",
      "state",
    ],
    "passed evidence",
  );
  const authority = validateAuthority(report.authority, expected?.authority);
  if (
    postValidation.performed !== true ||
    postValidation.passed !== true ||
    !sameJson(postValidation.authority, authority)
  ) {
    throw new Error("Passed asset-update V8 evidence lacks exact post-validation authority");
  }
  const expectedResultAuthority: AssetUpdateExpectedAuthority = expected ?? {
    authority,
    postArtifactDigest: digestFromPartial(report.result, "artifact"),
    postReleaseDigest: digestFromPartial(report.result, "release"),
  };
  validateLifecycleResult(report.result, expectedResultAuthority, { legacyV2 });
  const resultRecord = record(report.result, "result");
  const postRelease = validateReleaseAuthority(resultRecord.postRelease, "post", legacyV2);
  const preRelease = validateReleaseAuthority(resultRecord.preRelease, "pre", legacyV2);
  validateReadyAuthority(postValidation.ready, postRelease, preRelease.releaseDigest);
  validateTarget(postValidation.target, postRelease, authority.targetOrigin);
  const publication = record(resultRecord.publication, "publication");
  const target = record(resultRecord.target, "target");
  if (
    !sameJson(postValidation.ready, publication.postReady) ||
    !sameJson(postValidation.target, target.post)
  ) {
    throw new Error("Passed post-validation is not the exact fresh Ready/target observation");
  }
  return report as unknown as ValidatedAssetUpdateV8Evidence;
}

export function formatAssetUpdateV8Markdown(evidence: ValidatedAssetUpdateV8Evidence): string {
  const lines = [
    "# Asset-only update V8 lifecycle",
    "",
    `- State: \`${evidence.state}\``,
    `- Contract: \`${evidence.contract}\``,
    `- Started: \`${evidence.startedAt}\``,
  ];
  if (evidence.state === "passed") {
    const legacyV2 = isLegacyV2Evidence(evidence);
    const installLines = legacyV2
      ? []
      : [
          `- Fresh installed Launch → interactive: \`${evidence.result.launches.fresh.lifecycle.durationMs.toFixed(3)} ms\``,
          `- Initial install wall: \`${evidence.result.initialInstall.installWall.durationMs.toFixed(3)} ms\``,
          `- Network-active union: \`${evidence.result.initialInstall.network.activeIntervalUnionMs.toFixed(3)} ms\``,
          `- Network-idle wall-clock critical-path residual: \`${evidence.result.initialInstall.networkIdleLocalCriticalPathMs.toFixed(3)} ms\``,
          `- Final verification first-observed span (${evidence.result.initialInstall.finalVerificationObservation.pollIntervalMs} ms polling): \`${evidence.result.initialInstall.finalVerificationObservation.observedSpanMs.toFixed(3)} ms\``,
        ];
    const v8Lines = legacyV2
      ? [
          `- V8 produce diagnostic: \`${evidence.result.v8.produce.trace.state}\``,
          `- V8 fresh diagnostic: \`${evidence.result.v8.fresh.trace.state}\``,
          `- V8 pre-warm diagnostic: \`${evidence.result.v8.pre.trace.state}\``,
          `- V8 post-warm diagnostic: \`${evidence.result.v8.post.trace.state}\``,
        ]
      : [
          `- V8 produce trace: \`${evidence.result.v8.produce.trace.state}\``,
          `- V8 produce cache: \`${evidence.result.v8.produce.cache.state}\``,
          `- V8 produce production: \`${evidence.result.v8.produce.production.state}\``,
          `- V8 fresh trace: \`${evidence.result.v8.fresh.trace.state}\``,
          `- V8 fresh cache: \`${evidence.result.v8.fresh.cache.state}\``,
          `- V8 fresh production: \`${evidence.result.v8.fresh.production.state}\``,
          `- V8 pre-warm trace: \`${evidence.result.v8.pre.trace.state}\``,
          `- V8 pre-warm cache: \`${evidence.result.v8.pre.cache.state}\``,
          `- V8 pre-warm production: \`${evidence.result.v8.pre.production.state}\``,
          `- V8 post-warm trace: \`${evidence.result.v8.post.trace.state}\``,
          `- V8 post-warm cache: \`${evidence.result.v8.post.cache.state}\``,
          `- V8 post-warm production: \`${evidence.result.v8.post.production.state}\``,
        ];
    lines.push(
      `- Completed: \`${evidence.completedAt}\``,
      `- Pre release: \`${evidence.result.preRelease.releaseDigest}\``,
      `- Post release: \`${evidence.result.postRelease.releaseDigest}\``,
      `- Pre warm Launch → interactive: \`${evidence.result.launches.pre.lifecycle.durationMs.toFixed(3)} ms\``,
      `- Post warm Launch → interactive: \`${evidence.result.launches.post.lifecycle.durationMs.toFixed(3)} ms\``,
      ...installLines,
      `- Signed post − pre delta: \`${evidence.result.deltaMs.toFixed(3)} ms\``,
      "- Relative regression threshold: `not calibrated`",
      `- Changed non-executable resources: \`${evidence.result.analysis.changedResources.map(({ id }) => id).join(", ")}\``,
      ...v8Lines,
      "- Post-validation authority: `exact`",
    );
  } else if (evidence.state === "failed") {
    lines.push(
      `- Completed: \`${evidence.completedAt}\``,
      `- Failure phase: \`${evidence.failure.phase}\``,
      `- Failure: ${evidence.failure.message}`,
    );
    if (evidence.failureContext !== null) {
      lines.push(
        evidence.failureContext.state === "rejected-lifecycle-snapshot"
          ? "- Failure context: `rejected partial lifecycle; independently validated bounded breakdown only`"
          : "- Failure context: `unvalidated bounded lifecycle snapshot`",
        "",
        "```json",
        JSON.stringify(evidence.failureContext),
        "```",
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function validateLifecycleResult(
  input: unknown,
  expected: AssetUpdateExpectedAuthority | undefined,
  options: Readonly<{
    readonly allowBudgetFailure?: boolean;
    readonly legacyV2?: boolean;
  }> = {},
): AssetUpdateLifecycleResult {
  const result = record(input, "result");
  const resultKeys = [
    "analysis",
    "deltaMs",
    "launches",
    "lifecycle",
    "postRelease",
    "preRelease",
    "publication",
    "relativeRegressionThreshold",
    "target",
    "v8",
    "warmLaunchBudgetMs",
  ];
  if (options.legacyV2 !== true) resultKeys.push("initialInstall");
  requireExactKeys(result, resultKeys, "result");
  if (
    result.warmLaunchBudgetMs !== WARM_LAUNCH_BUDGET_MS ||
    result.relativeRegressionThreshold !== null
  ) {
    throw new Error(
      "Asset-update result changed the launch budget or invented a relative threshold",
    );
  }
  const preRelease = validateReleaseAuthority(result.preRelease, "pre", options.legacyV2 === true);
  const postRelease = validateReleaseAuthority(
    result.postRelease,
    "post",
    options.legacyV2 === true,
  );
  if (
    preRelease.artifactDigest === postRelease.artifactDigest ||
    preRelease.releaseDigest === postRelease.releaseDigest
  ) {
    throw new Error("Asset-update result did not advance exact release identity");
  }
  if (
    expected !== undefined &&
    (preRelease.artifactDigest !== expected.authority.baseBuild.artifactDigest ||
      preRelease.releaseDigest !== expected.authority.baseBuild.releaseDigest ||
      postRelease.artifactDigest !== expected.postArtifactDigest ||
      postRelease.releaseDigest !== expected.postReleaseDigest)
  ) {
    throw new Error("Asset-update result release authority does not match the run authority");
  }
  const recomputed = analyzeAssetOnlyReleaseUpdate(
    releaseForAnalysis(preRelease),
    releaseForAnalysis(postRelease),
  );
  if (!sameJson(result.analysis, recomputed)) {
    throw new Error("Asset-update result analysis is not an exact manifest projection");
  }

  const profileId = expected?.authority.persistentProfileId;
  validateLifecycleSequence(
    result.lifecycle,
    profileId,
    preRelease.releaseDigest,
    postRelease.releaseDigest,
  );
  const launches = record(result.launches, "launches");
  requireExactKeys(launches, ["fresh", "post", "pre"], "launches");
  const fresh = validateLaunch(
    launches.fresh,
    "fresh",
    1,
    preRelease.releaseDigest,
    profileId,
    false,
  );
  if (options.legacyV2 !== true) {
    validateInitialInstallExitEvidence(
      result.initialInstall,
      preRelease.installManifest,
      installerWorkerSource(preRelease.buildManifest),
      installControlIdentities(preRelease),
    );
    if (options.allowBudgetFailure !== true) {
      validateInitialInstallExitBudget(result.initialInstall as InitialInstallExitEvidence);
    }
    if (
      options.allowBudgetFailure !== true &&
      fresh.lifecycle.durationMs > FRESH_INSTALLED_LAUNCH_BUDGET_MS
    ) {
      throw new Error("Fresh installed Launch-to-interactive exceeds 30000 ms");
    }
  }
  const pre = validateLaunch(
    launches.pre,
    "pre-warm",
    4,
    preRelease.releaseDigest,
    profileId,
    options.allowBudgetFailure !== true,
  );
  const post = validateLaunch(
    launches.post,
    "post-warm",
    5,
    postRelease.releaseDigest,
    profileId,
    options.allowBudgetFailure !== true,
  );
  if (
    fresh.cacheState !== "setup" ||
    pre.cacheState !== "stable-consume" ||
    post.cacheState !== "stable-consume"
  ) {
    throw new Error("Launch cache-state comparability is invalid");
  }
  const expectedDelta = post.lifecycle.durationMs - pre.lifecycle.durationMs;
  if (!finite(result.deltaMs) || result.deltaMs !== expectedDelta) {
    throw new Error("Asset-update result signed launch delta is inconsistent");
  }

  const publication = record(result.publication, "publication");
  requireExactKeys(
    publication,
    [
      "postReady",
      "postTransfer",
      "preReady",
      "preTransfer",
      "updateDiscovery",
      "updateServerJournal",
    ],
    "publication",
  );
  validateReadyAuthority(publication.preReady, preRelease, null);
  validateReadyAuthority(publication.postReady, postRelease, preRelease.releaseDigest);
  validateReadyTransferAuthority(
    publication.preTransfer,
    preRelease,
    null,
    options.legacyV2 === true,
  );
  validateReadyTransferAuthority(
    publication.postTransfer,
    postRelease,
    preRelease,
    options.legacyV2 === true,
  );
  validateUpdateServerJournal(
    publication.updateServerJournal,
    recomputed,
    preRelease,
    postRelease,
    publication.postTransfer,
    options.legacyV2 === true,
  );
  const discovery = record(publication.updateDiscovery, "updateDiscovery");
  if (
    !sameJson(discovery, {
      code: "shell-release-mismatch",
      recovery: "retry",
      state: "failed",
    })
  ) {
    throw new Error("Asset update did not retain the ordinary mismatch-to-retry discovery");
  }

  const target = record(result.target, "target");
  requireExactKeys(target, ["post", "pre"], "target");
  const targetOrigin = expected?.authority.targetOrigin;
  validateTarget(target.pre, preRelease, targetOrigin);
  validateTarget(target.post, postRelease, targetOrigin);
  if (record(target.pre, "pre target").origin !== record(target.post, "post target").origin) {
    throw new Error("Asset-update target origin changed across the persistent-profile lineage");
  }

  const v8 = record(result.v8, "v8");
  requireExactKeys(v8, ["fresh", "post", "pre", "produce"], "v8");
  const expectedScripts = expectedV8ScriptArtifacts(preRelease, postRelease);
  const expectedWasm = expectedThreadedWasmArtifact(preRelease, postRelease);
  const freshDiagnostics = validateV8Diagnostics(
    v8.fresh,
    "fresh",
    expectedScripts,
    expectedWasm,
    options.legacyV2 === true,
  );
  const produceDiagnostics = validateV8Diagnostics(
    v8.produce,
    "produce",
    expectedScripts,
    expectedWasm,
    options.legacyV2 === true,
  );
  const preDiagnostics = validateV8Diagnostics(
    v8.pre,
    "pre-warm",
    expectedScripts,
    expectedWasm,
    options.legacyV2 === true,
  );
  const postDiagnostics = validateV8Diagnostics(
    v8.post,
    "post-warm",
    expectedScripts,
    expectedWasm,
    options.legacyV2 === true,
  );
  if (
    !sameJson(freshDiagnostics.scriptArtifacts, produceDiagnostics.scriptArtifacts) ||
    !sameJson(produceDiagnostics.scriptArtifacts, preDiagnostics.scriptArtifacts) ||
    !sameJson(preDiagnostics.scriptArtifacts, postDiagnostics.scriptArtifacts) ||
    [freshDiagnostics, produceDiagnostics, preDiagnostics, postDiagnostics].some(
      ({ persistentProfileId }) => persistentProfileId !== profileId,
    )
  ) {
    throw new Error("V8 diagnostics changed profile or executable script identity across update");
  }
  const executableResources = new Map(
    recomputed.executableResources
      .filter((resource) => resource.source.endsWith(".js"))
      .map((resource) => [resource.source, resource] as const),
  );
  for (const artifact of expectedScripts) {
    const resource = executableResources.get(artifact.path);
    if (
      resource === undefined ||
      resource.bytes !== artifact.bytes ||
      resource.sha256 !== artifact.sha256
    ) {
      throw new Error(`V8 diagnostics attributed undeclared executable ${artifact.path}`);
    }
  }
  return result as unknown as AssetUpdateLifecycleResult;
}

function installerWorkerSource(manifest: BuildManifest): string {
  const matches = manifest.workerEntrypoints.filter(({ role }) => role === "installer");
  const source = matches[0]?.path;
  if (matches.length !== 1 || source === undefined) {
    throw new Error("Embedded build manifest does not expose one exact installer worker");
  }
  return source;
}

function isLegacyV2Evidence(
  evidence: ValidatedAssetUpdateV8Evidence,
): evidence is LegacyAssetUpdateV8Evidence {
  const identity = evidence as { readonly contract: string; readonly schemaVersion: number };
  return (
    identity.contract === LEGACY_ASSET_UPDATE_V8_CONTRACT &&
    identity.schemaVersion === LEGACY_ASSET_UPDATE_V8_SCHEMA_VERSION
  );
}

function validateReleaseAuthority(
  input: unknown,
  label: "post" | "pre",
  legacyV2 = false,
): AssetUpdateReleaseAuthority & {
  readonly buildManifest: BuildManifest;
  readonly installManifest: InstallManifest;
} {
  const release = record(input, `${label} release`);
  requireExactKeys(
    release,
    [
      "artifactDigest",
      "buildManifestBase64",
      "buildManifestSchemaVersion",
      "installManifestBase64",
      "releaseDigest",
    ],
    `${label} release`,
  );
  requireDigest(release.artifactDigest, `${label} artifact`);
  requireDigest(release.releaseDigest, `${label} release`);
  const buildBytes = decodeBase64(release.buildManifestBase64, `${label} build manifest`);
  const installBytes = decodeBase64(release.installManifestBase64, `${label} install manifest`);
  if (
    sha256(buildBytes) !== release.artifactDigest ||
    sha256(installBytes) !== release.releaseDigest
  ) {
    throw new Error(`${label} release manifest bytes do not match their exact digests`);
  }
  const buildManifest = parseJsonObject(
    buildBytes,
    `${label} build manifest`,
  ) as unknown as BuildManifest;
  const installManifest = parseJsonObject(
    installBytes,
    `${label} install manifest`,
  ) as unknown as InstallManifest;
  validateEmbeddedReleaseStructure(buildManifest, installManifest, label, legacyV2);
  if (buildManifest.schemaVersion !== release.buildManifestSchemaVersion) {
    throw new Error(`${label} release embedded manifest contract is invalid`);
  }
  const installArtifact = buildManifest.artifacts.find(
    (artifact) => artifact.path === "install-manifest.json",
  );
  if (
    installArtifact === undefined ||
    installArtifact.sha256 !== release.releaseDigest ||
    installArtifact.bytes !== installBytes.byteLength
  ) {
    throw new Error(`${label} build manifest does not bind its exact install manifest`);
  }
  return Object.freeze({
    ...(release as unknown as AssetUpdateReleaseAuthority),
    buildManifest,
    installManifest,
  });
}

function validateEmbeddedReleaseStructure(
  manifest: BuildManifest,
  install: InstallManifest,
  label: "post" | "pre",
  legacyV2: boolean,
): void {
  const manifestRecord = record(manifest, `${label} build manifest`);
  const installRecord = record(install, `${label} install manifest`);
  requireExactKeys(
    manifestRecord,
    [
      "artifacts",
      "gameContentEntrypoints",
      "installManifestEntrypoint",
      "offlineShell",
      "schemaVersion",
      "workerEntrypoints",
    ],
    `${label} build manifest`,
  );
  requireExactKeys(
    installRecord,
    ["gameId", "resources", "schemaVersion"],
    `${label} install manifest`,
  );
  if (
    manifest.schemaVersion !== BUILD_MANIFEST_SCHEMA_VERSION ||
    !Array.isArray(manifest.artifacts) ||
    !Array.isArray(manifest.gameContentEntrypoints) ||
    !Array.isArray(manifest.workerEntrypoints)
  ) {
    throw new Error(`${label} release embedded build manifest arrays are invalid`);
  }
  const installEntrypoint = record(
    manifest.installManifestEntrypoint,
    `${label} install entrypoint`,
  );
  requireExactKeys(installEntrypoint, ["path", "schemaVersion"], `${label} install entrypoint`);
  const offlineShell = record(manifest.offlineShell, `${label} offline shell`);
  requireExactKeys(
    offlineShell,
    ["generationSchemaVersion", "saveSchemaVersion", "serviceWorkerPath"],
    `${label} offline shell`,
  );
  if (
    manifest.installManifestEntrypoint.path !== INSTALL_MANIFEST_PATH ||
    manifest.installManifestEntrypoint.schemaVersion !== INSTALL_MANIFEST_SCHEMA_VERSION ||
    manifest.offlineShell.generationSchemaVersion !== OFFLINE_SHELL_GENERATION_SCHEMA_VERSION ||
    manifest.offlineShell.saveSchemaVersion !== OFFLINE_SHELL_SAVE_SCHEMA_VERSION ||
    manifest.offlineShell.serviceWorkerPath !== "service-worker.js" ||
    install.schemaVersion !== INSTALL_MANIFEST_SCHEMA_VERSION ||
    install.gameId !== INSTALL_MANIFEST_GAME_ID ||
    !Array.isArray(install.resources)
  ) {
    throw new Error(`${label} release embedded manifest contract is invalid`);
  }

  const artifacts = new Map<string, Readonly<{ bytes: number; sha256: string }>>();
  const artifactDigests = new Set<string>();
  for (const candidate of manifest.artifacts) {
    const artifact = record(candidate, `${label} build artifact`);
    requireExactKeys(artifact, ["bytes", "path", "sha256"], `${label} build artifact`);
    if (
      typeof artifact.path !== "string" ||
      !safeRelativePath(artifact.path) ||
      typeof artifact.bytes !== "number" ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes <= 0 ||
      typeof artifact.sha256 !== "string" ||
      !SHA256.test(artifact.sha256) ||
      artifacts.has(artifact.path) ||
      artifactDigests.has(artifact.sha256)
    ) {
      throw new Error(`${label} release has an invalid or duplicate build artifact`);
    }
    artifacts.set(artifact.path, { bytes: artifact.bytes, sha256: artifact.sha256 });
    artifactDigests.add(artifact.sha256);
  }
  if (
    !artifacts.has("install-manifest.json") ||
    !artifacts.has("service-worker.js") ||
    manifest.gameContentEntrypoints.length === 0
  ) {
    throw new Error(`${label} release omits a required manifest/service/content artifact`);
  }

  const workerRoles = new Set<string>();
  const workerPaths = new Set<string>();
  for (const candidate of manifest.workerEntrypoints) {
    const worker = record(candidate, `${label} worker entrypoint`);
    requireExactKeys(worker, ["path", "role", "targetType"], `${label} worker entrypoint`);
    if (
      typeof worker.path !== "string" ||
      !artifacts.has(worker.path) ||
      worker.targetType !== "worker" ||
      typeof worker.role !== "string" ||
      !new Set(["decode", "installer", "render", "streaming", "wasm-thread"]).has(worker.role) ||
      workerRoles.has(worker.role) ||
      workerPaths.has(worker.path)
    ) {
      throw new Error(`${label} release has an invalid worker topology`);
    }
    workerRoles.add(worker.role);
    workerPaths.add(worker.path);
  }
  if (
    workerRoles.size !== 5 ||
    !["decode", "installer", "render", "streaming", "wasm-thread"].every((role) =>
      workerRoles.has(role),
    )
  ) {
    throw new Error(`${label} release lacks the exact five-worker topology`);
  }
  validateBuildManifestContentAddressedPaths(manifest);

  const districtIds = new Set<string>();
  const districtPaths = new Set<string>();
  for (const candidate of manifest.gameContentEntrypoints) {
    const entrypoint = record(candidate, `${label} game content entrypoint`);
    requireExactKeys(
      entrypoint,
      ["districtId", "path", "schemaVersion", "scope", "targetType"],
      `${label} game content entrypoint`,
    );
    if (
      typeof entrypoint.districtId !== "string" ||
      entrypoint.districtId === "" ||
      typeof entrypoint.path !== "string" ||
      !artifacts.has(entrypoint.path) ||
      entrypoint.schemaVersion !== (legacyV2 ? 1 : STREAMING_DISTRICT_INDEX_SCHEMA_VERSION) ||
      entrypoint.scope !== "game-specific" ||
      entrypoint.targetType !== "district" ||
      districtIds.has(entrypoint.districtId) ||
      districtPaths.has(entrypoint.path)
    ) {
      throw new Error(`${label} release has an invalid game content entrypoint`);
    }
    districtIds.add(entrypoint.districtId);
    districtPaths.add(entrypoint.path);
  }

  const resources = new Map<string, InstallManifest["resources"][number]>();
  const sources = new Set<string>();
  for (const candidate of install.resources) {
    const resource = record(candidate, `${label} install resource`);
    requireExactKeys(
      resource,
      ["bytes", "id", "kind", "scope", "sha256", "source", "target"],
      `${label} install resource`,
    );
    if (
      typeof resource.id !== "string" ||
      resource.id === "" ||
      resources.has(resource.id) ||
      typeof resource.source !== "string" ||
      sources.has(resource.source) ||
      !safeRelativePath(resource.source) ||
      typeof resource.bytes !== "number" ||
      !Number.isSafeInteger(resource.bytes) ||
      resource.bytes <= 0 ||
      typeof resource.sha256 !== "string" ||
      !SHA256.test(resource.sha256) ||
      typeof resource.kind !== "string" ||
      !INSTALL_RESOURCE_KINDS.has(resource.kind) ||
      typeof resource.scope !== "string" ||
      !INSTALL_RESOURCE_SCOPES.has(resource.scope) ||
      typeof resource.target !== "string" ||
      !INSTALL_RESOURCE_TARGETS.has(resource.target)
    ) {
      throw new Error(`${label} release has an invalid or duplicate install resource`);
    }
    const typedResource = resource as unknown as InstallManifest["resources"][number];
    resources.set(resource.id, typedResource);
    sources.add(resource.source);
    const artifact = artifacts.get(resource.source);
    if (
      resource.kind !== "model" &&
      (artifact === undefined ||
        artifact.bytes !== resource.bytes ||
        artifact.sha256 !== resource.sha256)
    ) {
      throw new Error(`${label} install resource does not bind an exact build artifact`);
    }
  }
  const appDocument = resources.get("app-shell-document-index");
  const appModule = resources.get("app-shell-module-app");
  const serviceWorker = resources.get("common-worker-service");
  if (
    appDocument?.kind !== "document" ||
    appDocument.scope !== "app-shell" ||
    appDocument.source !== "index.html" ||
    appDocument.target !== "shell" ||
    appModule?.kind !== "module" ||
    appModule.scope !== "app-shell" ||
    !/^immutable\/app-[a-f0-9]{64}\.js$/.test(appModule.source) ||
    appModule.target !== "shell" ||
    serviceWorker?.kind !== "worker" ||
    serviceWorker.scope !== "common" ||
    serviceWorker.source !== "service-worker.js" ||
    serviceWorker.target !== "shell"
  ) {
    throw new Error(`${label} release lacks its exact ordinary app-shell executable topology`);
  }
  for (const [path, artifact] of artifacts) {
    if (path === "install-manifest.json") continue;
    const resource = install.resources.find(({ source }) => source === path);
    if (
      resource === undefined ||
      resource.bytes !== artifact.bytes ||
      resource.sha256 !== artifact.sha256
    ) {
      throw new Error(`${label} build artifact lacks an exact install resource`);
    }
  }
  for (const workerPath of workerPaths) {
    if (!install.resources.some(({ kind, source }) => kind === "worker" && source === workerPath)) {
      throw new Error(`${label} worker entrypoint lacks its exact install resource`);
    }
  }
  for (const districtPath of districtPaths) {
    if (
      !install.resources.some(
        ({ kind, source }) => kind === "district-index" && source === districtPath,
      )
    ) {
      throw new Error(`${label} district entrypoint lacks its exact install resource`);
    }
  }
  validateBuildManifestContentAddressedPaths(manifest, install);
}

function safeRelativePath(value: string): boolean {
  return (
    value !== "" &&
    /^[A-Za-z0-9._/-]+$/.test(value) &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

function releaseForAnalysis(release: ReturnType<typeof validateReleaseAuthority>): {
  readonly artifactDigest: string;
  readonly installManifest: InstallManifest;
  readonly manifest: BuildManifest;
  readonly releaseDigest: string;
} {
  return {
    artifactDigest: release.artifactDigest,
    installManifest: release.installManifest,
    manifest: release.buildManifest,
    releaseDigest: release.releaseDigest,
  };
}

function validateLaunch(
  input: unknown,
  phase: AssetUpdateV8LaunchEvidence["phase"],
  ordinal: AssetUpdateV8LaunchEvidence["ordinal"],
  releaseDigest: string,
  expectedProfileId: string | undefined,
  enforceBudget: boolean,
): AssetUpdateV8LaunchEvidence {
  const launch = record(input, `${phase} launch`);
  requireExactKeys(
    launch,
    ["cacheState", "lifecycle", "ordinal", "persistentProfileId", "phase", "releaseDigest"],
    `${phase} launch`,
  );
  if (
    launch.phase !== phase ||
    launch.ordinal !== ordinal ||
    launch.cacheState !== (phase === "fresh" ? "setup" : "stable-consume") ||
    launch.releaseDigest !== releaseDigest ||
    typeof launch.persistentProfileId !== "string" ||
    !PROFILE_ID.test(launch.persistentProfileId) ||
    (expectedProfileId !== undefined && launch.persistentProfileId !== expectedProfileId)
  ) {
    throw new Error(`${phase} launch identity or persistent-profile lineage is invalid`);
  }
  const lifecycle = validateLaunchLifecycle(launch.lifecycle, releaseDigest);
  if (enforceBudget && lifecycle.durationMs > WARM_LAUNCH_BUDGET_MS) {
    throw new Error(
      `${phase} Launch-to-interactive duration ${lifecycle.durationMs} exceeds ${WARM_LAUNCH_BUDGET_MS} ms`,
    );
  }
  return launch as unknown as AssetUpdateV8LaunchEvidence;
}

function validateLaunchLifecycle(
  input: unknown,
  releaseDigest: string,
): LaunchToInteractiveEvidence {
  const lifecycle = record(input, "launch lifecycle");
  requireExactKeys(
    lifecycle,
    [
      "attempt",
      "contract",
      "durationMs",
      "failureMessage",
      "interactiveAtMs",
      "preflightTiming",
      "releaseDigest",
      "renderFirstFrameAtMs",
      "schemaVersion",
      "shellAdmissionAtMs",
      "startedAtMs",
      "state",
      "streamingStartupTiming",
      "streamingWorkerRequestedAtMs",
      "streamingReadyAtMs",
    ],
    "launch lifecycle",
  );
  for (const key of [
    "durationMs",
    "interactiveAtMs",
    "renderFirstFrameAtMs",
    "shellAdmissionAtMs",
    "startedAtMs",
    "streamingWorkerRequestedAtMs",
    "streamingReadyAtMs",
  ]) {
    if (!finite(lifecycle[key]) || (lifecycle[key] as number) < 0) {
      throw new Error(`Launch lifecycle ${key} is invalid`);
    }
  }
  if (
    lifecycle.attempt !== 1 ||
    lifecycle.contract !== "launch-to-interactive@2" ||
    lifecycle.schemaVersion !== LAUNCH_LIFECYCLE_SCHEMA_VERSION ||
    lifecycle.state !== "interactive" ||
    lifecycle.failureMessage !== null ||
    lifecycle.releaseDigest !== releaseDigest
  ) {
    throw new Error("Launch lifecycle terminal identity is invalid");
  }
  const started = lifecycle.startedAtMs as number;
  const preflight = validatePreflightTiming(lifecycle.preflightTiming);
  const admitted = lifecycle.shellAdmissionAtMs as number;
  const workerRequested = lifecycle.streamingWorkerRequestedAtMs as number;
  const rendered = lifecycle.renderFirstFrameAtMs as number;
  const streaming = lifecycle.streamingReadyAtMs as number;
  const interactive = lifecycle.interactiveAtMs as number;
  const workerStartupDurationMs = validateStreamingStartupTiming(lifecycle.streamingStartupTiming);
  const initialPreflight = preflight[0];
  const finalPreflight = preflight.at(-1);
  if (initialPreflight === undefined || finalPreflight === undefined) {
    throw new Error("Launch preflight timing is incomplete");
  }
  if (
    initialPreflight < started ||
    preflight.some((value, index) => index > 0 && value < (preflight[index - 1] as number)) ||
    admitted < finalPreflight ||
    workerRequested < admitted ||
    rendered < workerRequested ||
    streaming < workerRequested ||
    streaming - workerRequested < workerStartupDurationMs ||
    interactive < rendered ||
    interactive < streaming ||
    lifecycle.durationMs !== interactive - started
  ) {
    throw new Error("Launch lifecycle milestone ordering or duration is inconsistent");
  }
  return lifecycle as unknown as LaunchToInteractiveEvidence;
}

function validatePreflightTiming(input: unknown): readonly number[] {
  const timing = record(input, "launch preflight timing");
  const keys = [
    "initialReleaseAdmissionAtMs",
    "modelSourceReadyAtMs",
    "streamingReferencesReadyAtMs",
    "psoTraceReadyAtMs",
    "finalReleaseAdmissionAtMs",
  ] as const;
  requireExactKeys(timing, [...keys], "launch preflight timing");
  const ordered = keys.map((key) => timing[key]);
  if (ordered.some((value) => !finite(value) || value < 0)) {
    throw new Error("Launch preflight timing contains an invalid milestone");
  }
  return ordered as readonly number[];
}

function validateStreamingStartupTiming(input: unknown): number {
  const timing = record(input, "streaming startup timing");
  requireExactKeys(
    timing,
    [
      "accessHandlesOpenedAtMs",
      "contract",
      "decodePoolCreatedAtMs",
      "finalAdmissionCompletedAtMs",
      "initialResidencyReadyAtMs",
      "provisioningStartedAtMs",
      "releaseBindingCompletedAtMs",
      "releaseResolutionCompletedAtMs",
      "schemaVersion",
      "sourceKind",
      "workerStartedAtMs",
    ],
    "streaming startup timing",
  );
  const ordered = [
    timing.workerStartedAtMs,
    timing.provisioningStartedAtMs,
    timing.releaseBindingCompletedAtMs,
    timing.releaseResolutionCompletedAtMs,
    timing.accessHandlesOpenedAtMs,
    timing.finalAdmissionCompletedAtMs,
    timing.decodePoolCreatedAtMs,
    timing.initialResidencyReadyAtMs,
  ];
  if (
    timing.contract !== STREAMING_STARTUP_TIMING_CONTRACT ||
    timing.schemaVersion !== STREAMING_STARTUP_TIMING_SCHEMA_VERSION ||
    timing.sourceKind !== "installed-release" ||
    ordered.some((value) => !finite(value) || value < 0) ||
    ordered.some((value, index) => index > 0 && (value as number) < (ordered[index - 1] as number))
  ) {
    throw new Error("Streaming startup timing identity or ordering is invalid");
  }
  return (timing.initialResidencyReadyAtMs as number) - (timing.workerStartedAtMs as number);
}

function validateLifecycleSequence(
  input: unknown,
  expectedProfileId: string | undefined,
  preReleaseDigest: string,
  postReleaseDigest: string,
): void {
  if (!Array.isArray(input) || input.length !== 9) {
    throw new Error("Asset-update lifecycle requires the exact nine ordered boundaries");
  }
  const expected = [
    ["initial-install-ready", preReleaseDigest],
    ["fresh-launch-interactive", preReleaseDigest],
    ["produce-diagnostic-complete", preReleaseDigest],
    ["pre-diagnostic-complete", preReleaseDigest],
    ["pre-warm-launch-interactive", preReleaseDigest],
    ["asset-update-published", postReleaseDigest],
    ["update-ready", postReleaseDigest],
    ["post-warm-launch-interactive", postReleaseDigest],
    ["post-diagnostic-complete", postReleaseDigest],
  ] as const;
  let previousCompletedAtMs = -1;
  input.forEach((candidate, index) => {
    const event = record(candidate, `lifecycle ${index + 1}`);
    requireExactKeys(
      event,
      ["completedAtMs", "name", "persistentProfileId", "releaseDigest", "sequence"],
      `lifecycle ${index + 1}`,
    );
    if (
      event.sequence !== index + 1 ||
      !finite(event.completedAtMs) ||
      (event.completedAtMs as number) < previousCompletedAtMs ||
      event.name !== expected[index]?.[0] ||
      event.releaseDigest !== expected[index]?.[1] ||
      typeof event.persistentProfileId !== "string" ||
      !PROFILE_ID.test(event.persistentProfileId) ||
      (expectedProfileId !== undefined && event.persistentProfileId !== expectedProfileId) ||
      (index > 0 &&
        event.persistentProfileId !==
          record(input[index - 1], `lifecycle ${index}`).persistentProfileId)
    ) {
      throw new Error("Asset-update lifecycle ordering or persistent-profile identity drifted");
    }
    previousCompletedAtMs = event.completedAtMs as number;
  });
}

function validateReadyAuthority(
  input: unknown,
  release: ReturnType<typeof validateReleaseAuthority>,
  expectedPreviousReleaseDigest: string | null,
): void {
  const ready = record(input, "Ready authority");
  requireExactKeys(
    ready,
    [
      "artifactDigest",
      "generationId",
      "installStore",
      "launchEnabled",
      "offlineShell",
      "releaseDigest",
      "uiState",
    ],
    "Ready authority",
  );
  const generationId = `${release.artifactDigest}:${release.releaseDigest}`;
  const store = record(ready.installStore, "Ready installStore");
  const shell = record(ready.offlineShell, "Ready offlineShell");
  if (
    ready.artifactDigest !== release.artifactDigest ||
    ready.releaseDigest !== release.releaseDigest ||
    ready.generationId !== generationId ||
    ready.launchEnabled !== true ||
    ready.uiState !== "ready" ||
    !sameJson(store, {
      activeReleaseDigest: release.releaseDigest,
      previousReleaseDigest: expectedPreviousReleaseDigest,
      state: "ready",
    }) ||
    !sameJson(shell, {
      activeArtifactDigest: release.artifactDigest,
      activeGenerationId: generationId,
      activeReleaseDigest: release.releaseDigest,
      state: "active",
    })
  ) {
    throw new Error("Ready authority does not bind exact publication/offline-shell selection");
  }
}

function validateCurrentOrRetainedInstallerTransferTelemetry(
  transfer: Record<string, unknown>,
  resources: readonly InstallResource[],
  previousResources: readonly InstallResource[] | null,
  legacyV2: boolean,
): void {
  if (
    (legacyV2 && transfer.schemaVersion !== 3) ||
    (!legacyV2 && transfer.schemaVersion !== INSTALLER_TRANSFER_TELEMETRY_SCHEMA_VERSION)
  ) {
    throw new Error("Ready operation installerTransfer schema is unsupported");
  }
  if (legacyV2) validateInstallerTransferTelemetrySnapshot(transfer, 3);
  else
    validateInstallerTransferTelemetrySnapshot(
      transfer,
      INSTALLER_TRANSFER_TELEMETRY_SCHEMA_VERSION,
    );
  const missingResources = resources.filter(
    (resource) =>
      previousResources === null ||
      !previousResources.some(
        (previous) =>
          previous.bytes === resource.bytes &&
          previous.scope === resource.scope &&
          previous.sha256 === resource.sha256,
      ),
  );
  const largestUnverifiedBytes = missingResources.reduce(
    (largest, resource) => Math.max(largest, resource.bytes),
    0,
  );
  const expectedRequiredPeakBytes =
    transfer.schemaVersion === 3
      ? safeQuotaAdd(
          safeQuotaAdd(transfer.plannedDownloadBytes, largestUnverifiedBytes),
          16 * 1024 * 1024,
        )
      : safeQuotaAdd(Math.max(largestUnverifiedBytes, 1024 * 1024), 16 * 1024 * 1024);
  if (transfer.quotaRequiredPeakBytes !== expectedRequiredPeakBytes) {
    throw new Error("Ready operation transfer quota evidence is inconsistent");
  }
}

function safeQuotaAdd(left: unknown, right: number): number {
  const total = (left as number) + right;
  if (!Number.isSafeInteger(total)) {
    throw new Error("Ready operation transfer quota total exceeds safe integer");
  }
  return total;
}

function validateReadyTransferAuthority(
  input: unknown,
  release: ReturnType<typeof validateReleaseAuthority>,
  previousRelease: ReturnType<typeof validateReleaseAuthority> | null,
  legacyV2: boolean,
): void {
  const transfer = record(input, "Ready operation installerTransfer");
  const transferResources = release.installManifest.resources.filter(
    (resource) => resource.target === "opfs",
  );
  const releaseBytes = transferResources.reduce((total, resource) => total + resource.bytes, 0);
  const releaseResourceCount = transferResources.length;
  if (transfer.totalBytes !== releaseBytes || transfer.resourceCount !== releaseResourceCount) {
    throw new Error("Ready operation transfer does not bind exact completed publication");
  }
  validateCurrentOrRetainedInstallerTransferTelemetry(
    transfer,
    transferResources,
    previousRelease?.installManifest.resources.filter((resource) => resource.target === "opfs") ??
      null,
    legacyV2,
  );
  if (
    transfer.activeReleaseDigest !== release.releaseDigest ||
    transfer.state !== "ready" ||
    transfer.activeRequestId !== null ||
    transfer.activeResourceCount !== 0 ||
    transfer.activeResourceId !== null ||
    transfer.cancellationCount !== 0 ||
    transfer.checkpointBytes !== 8 * 1024 * 1024 ||
    transfer.checkpointedBytes !== transfer.downloadedBytes ||
    transfer.concurrency !== 1 ||
    transfer.failureCode !== null ||
    transfer.failureMessage !== null ||
    transfer.finalVerificationPhase !== "complete" ||
    transfer.finalVerificationBytes !== transfer.totalBytes ||
    transfer.finalVerificationResourceCount !== transfer.resourceCount ||
    transfer.finalVerificationTotalBytes !== transfer.totalBytes ||
    transfer.finalVerificationTotalResourceCount !== transfer.resourceCount ||
    transfer.totalBytes !== releaseBytes ||
    transfer.resourceCount !== releaseResourceCount ||
    transfer.integrityFailureCount !== 0 ||
    (!legacyV2 &&
      (transfer.operationRepairAttemptCount !== 0 ||
        transfer.operationRepairedBytes !== 0 ||
        transfer.operationRepairedResourceCount !== 0 ||
        transfer.plannedResumeBytes !== 0)) ||
    transfer.quotaFailureCount !== 0 ||
    transfer.quotaProbeBytes !== 1024 * 1024 ||
    transfer.quotaProbeCompleted !== true ||
    (transfer.quotaRequiredPeakBytes as number) <= 0 ||
    transfer.transportFailureCount !== 0 ||
    transfer.validatorFailureCount !== 0 ||
    transfer.retryCount !== 0 ||
    (previousRelease === null &&
      (transfer.plannedDownloadBytes !== releaseBytes ||
        transfer.downloadedBytes !== releaseBytes ||
        transfer.verifiedBytes !== releaseBytes ||
        transfer.hashedBytes !== releaseBytes ||
        transfer.completedResourceCount !== releaseResourceCount ||
        transfer.reusedBytes !== 0 ||
        transfer.resumedBytes !== 0 ||
        transfer.httpRequestCount !== releaseResourceCount ||
        transfer.httpRequestCount !== transfer.rangeRequestCount))
  ) {
    throw new Error("Ready operation transfer does not bind exact completed publication");
  }
}

function validateUpdateServerJournal(
  input: unknown,
  analysis: AssetOnlyReleaseUpdateAnalysis,
  pre: ReturnType<typeof validateReleaseAuthority>,
  post: ReturnType<typeof validateReleaseAuthority>,
  transferInput: unknown,
  legacyV2: boolean,
): void {
  const journal = record(input, "update server journal");
  requireExactKeys(journal, ["entries", "maximumEntries", "overflowed"], "update server journal");
  if (
    journal.maximumEntries !== 4096 ||
    journal.overflowed !== false ||
    !Array.isArray(journal.entries) ||
    journal.entries.length === 0 ||
    journal.entries.length > 4096
  ) {
    throw new Error("Update server journal is absent, truncated, or unbounded");
  }
  const resourceSources = new Set(post.installManifest.resources.map(({ source }) => `/${source}`));
  const changed = new Map(
    analysis.changedResources
      .filter(({ after }) => after.target === "opfs")
      .map(({ after }) => [`/${after.source}`, after]),
  );
  const transferEntries: Record<string, unknown>[] = [];
  for (const [index, candidate] of journal.entries.entries()) {
    const entry = record(candidate, `update server journal entry ${index + 1}`);
    requireExactKeys(
      entry,
      [
        "bodyBytes",
        "cacheControl",
        "coep",
        "contentType",
        "coop",
        "etag",
        "ifNoneMatch",
        "ifRange",
        "method",
        "nosniff",
        "path",
        "range",
        "sequence",
        "status",
      ],
      `update server journal entry ${index + 1}`,
    );
    if (
      entry.sequence !== index + 1 ||
      typeof entry.path !== "string" ||
      !/^\/[A-Za-z0-9._/-]*$/.test(entry.path) ||
      (entry.method !== "GET" && entry.method !== "HEAD") ||
      !Number.isSafeInteger(entry.status) ||
      (entry.status as number) < 200 ||
      (entry.status as number) >= 400 ||
      !nonnegativeSafeInteger(entry.bodyBytes) ||
      (entry.method === "HEAD" && entry.bodyBytes !== 0) ||
      (entry.status === 304 && entry.bodyBytes !== 0) ||
      entry.coop !== "same-origin" ||
      entry.coep !== "require-corp" ||
      entry.nosniff !== "nosniff" ||
      (entry.cacheControl !== null && typeof entry.cacheControl !== "string") ||
      (entry.contentType !== null && typeof entry.contentType !== "string") ||
      (entry.range !== null && typeof entry.range !== "string") ||
      (entry.etag !== null && typeof entry.etag !== "string") ||
      (entry.ifNoneMatch !== null && typeof entry.ifNoneMatch !== "string") ||
      (entry.ifRange !== null && typeof entry.ifRange !== "string")
    ) {
      throw new Error("Update server journal entry identity is invalid");
    }
    if (entry.range !== null && resourceSources.has(entry.path)) {
      transferEntries.push(entry);
    }
  }

  const transfer = record(transferInput, "post Ready installer transfer");
  const changedBytes = [...changed.values()].reduce((total, resource) => total + resource.bytes, 0);
  const postTransferResources = post.installManifest.resources.filter(
    (resource) => resource.target === "opfs",
  );
  const preTransferResources = pre.installManifest.resources.filter(
    (resource) => resource.target === "opfs",
  );
  const totalBytes = postTransferResources.reduce((total, resource) => total + resource.bytes, 0);
  if (
    transfer.verifiedBytes !== totalBytes ||
    transfer.hashedBytes !== totalBytes ||
    transfer.completedResourceCount !== postTransferResources.length
  ) {
    throw new Error("Update transfer counters/journal do not prove changed-only transfer");
  }
  validateCurrentOrRetainedInstallerTransferTelemetry(
    transfer,
    postTransferResources,
    preTransferResources,
    legacyV2,
  );
  let transferredBodyBytes = 0;
  const changedPathCounts = new Map<string, number>();
  const changedPathsSeen = new Set<string>();
  for (const entry of transferEntries) {
    const changedResource = typeof entry.path === "string" ? changed.get(entry.path) : undefined;
    if (
      changedResource === undefined ||
      entry.method !== "GET" ||
      entry.status !== 206 ||
      entry.bodyBytes !== changedResource.bytes ||
      entry.range !== "bytes=0-" ||
      entry.etag !== `"sha256-${changedResource.sha256}"` ||
      entry.ifNoneMatch !== null ||
      entry.ifRange !== null ||
      entry.cacheControl !== "no-cache" ||
      entry.contentType !==
        assetUpdateResourceContentType(changedResource.kind, changedResource.source)
    ) {
      throw new Error("Update server journal shows a non-changed or invalid transfer response");
    }
    const path = entry.path as string;
    changedPathsSeen.add(path);
    changedPathCounts.set(path, (changedPathCounts.get(path) ?? 0) + 1);
    transferredBodyBytes += entry.bodyBytes as number;
  }
  if (
    changedPathsSeen.size !== changed.size ||
    [...changed.keys()].some((path) => !changedPathsSeen.has(path)) ||
    [...changed.keys()].some((path) => changedPathCounts.get(path) !== 1) ||
    transferEntries.length !== changed.size ||
    transferredBodyBytes !== changedBytes ||
    transferEntries.length !== transfer.httpRequestCount ||
    transferEntries.length !== transfer.rangeRequestCount ||
    transfer.plannedDownloadBytes !== changedBytes ||
    transfer.downloadedBytes !== changedBytes ||
    transfer.verifiedBytes !== totalBytes ||
    transfer.hashedBytes !== totalBytes ||
    transfer.completedResourceCount !== postTransferResources.length ||
    transfer.resourceCount !== postTransferResources.length ||
    transfer.totalBytes !== totalBytes ||
    transfer.reusedBytes !== totalBytes - changedBytes ||
    transfer.resumedBytes !== 0 ||
    transfer.retryCount !== 0 ||
    transfer.transportFailureCount !== 0 ||
    transfer.validatorFailureCount !== 0 ||
    transfer.integrityFailureCount !== 0 ||
    (!legacyV2 &&
      (transfer.operationRepairAttemptCount !== 0 ||
        transfer.operationRepairedBytes !== 0 ||
        transfer.operationRepairedResourceCount !== 0 ||
        transfer.plannedResumeBytes !== 0)) ||
    preTransferResources.length !== postTransferResources.length
  ) {
    throw new Error("Update transfer counters/journal do not prove changed-only transfer");
  }
}

function validateTarget(
  input: unknown,
  release: ReturnType<typeof validateReleaseAuthority>,
  expectedOrigin: string | undefined,
): void {
  const target = record(input, "target observation");
  requireExactKeys(
    target,
    [
      "artifactDigest",
      "buildManifestEtag",
      "buildManifestSha256",
      "installManifestEtag",
      "installManifestSha256",
      "origin",
      "releaseDigest",
      "resourceRepresentations",
    ],
    "target observation",
  );
  if (
    target.artifactDigest !== release.artifactDigest ||
    target.buildManifestSha256 !== release.artifactDigest ||
    target.installManifestSha256 !== release.releaseDigest ||
    target.releaseDigest !== release.releaseDigest ||
    typeof target.origin !== "string" ||
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(target.origin) ||
    (expectedOrigin !== undefined && target.origin !== expectedOrigin) ||
    target.buildManifestEtag !== `"sha256-${release.artifactDigest}"` ||
    target.installManifestEtag !== `"sha256-${release.releaseDigest}"`
  ) {
    throw new Error("Target observation does not bind exact same-origin release identity");
  }
  if (
    !Array.isArray(target.resourceRepresentations) ||
    target.resourceRepresentations.length !== release.installManifest.resources.length
  ) {
    throw new Error("Target observation has an incomplete resource representation inventory");
  }
  const expectedRepresentations = new Map(
    release.installManifest.resources.map((resource) => [resource.source, resource]),
  );
  let previousSource = "";
  for (const candidate of target.resourceRepresentations) {
    const representation = record(candidate, "resource representation");
    requireExactKeys(
      representation,
      [
        "bytes",
        "cacheControl",
        "conditionalStatus",
        "contentType",
        "etag",
        "kind",
        "sha256",
        "source",
        "status",
        "validation",
      ],
      "resource representation",
    );
    const source = typeof representation.source === "string" ? representation.source : null;
    const resource = source === null ? undefined : expectedRepresentations.get(source);
    const expectedContentType =
      resource === undefined
        ? null
        : assetUpdateResourceContentType(resource.kind, resource.source);
    const expectedCacheControl =
      resource?.kind === "model"
        ? "no-cache"
        : source?.startsWith("immutable/")
          ? "public, max-age=31536000, immutable"
          : "no-cache";
    const expectedValidation =
      resource?.kind === "model" ? "bounded-range-and-filesystem-sha256" : "full-body-sha256";
    const expectedStatus = resource?.kind === "model" ? 206 : 200;
    if (
      resource === undefined ||
      representation.bytes !== resource.bytes ||
      representation.kind !== resource.kind ||
      representation.sha256 !== resource.sha256 ||
      representation.etag !== `"sha256-${resource.sha256}"` ||
      representation.cacheControl !== expectedCacheControl ||
      representation.contentType !== expectedContentType ||
      representation.status !== expectedStatus ||
      representation.conditionalStatus !== 304 ||
      representation.validation !== expectedValidation ||
      source === null ||
      source <= previousSource
    ) {
      throw new Error("Target resource representation lacks exact bytes/transport authority");
    }
    previousSource = source;
    expectedRepresentations.delete(source);
  }
  if (expectedRepresentations.size !== 0) {
    throw new Error("Target resource representation inventory is incomplete");
  }
}

function expectedV8ScriptArtifacts(
  pre: ReturnType<typeof validateReleaseAuthority>,
  post: ReturnType<typeof validateReleaseAuthority>,
): readonly Readonly<{
  readonly bytes: number;
  readonly path: string;
  readonly sha256: string;
}>[] {
  const project = (release: ReturnType<typeof validateReleaseAuthority>) =>
    selectV8ScriptManifestArtifacts(release.buildManifest).map(
      ({ bytes, path, sha256: digest }) => {
        const resource = release.installManifest.resources.find(
          (candidate) => candidate.source === path,
        );
        if (
          resource === undefined ||
          (resource.kind !== "module" && resource.kind !== "worker") ||
          resource.bytes !== bytes ||
          resource.sha256 !== digest
        ) {
          throw new Error(`V8 script artifact lacks exact install identity: ${path}`);
        }
        return Object.freeze({ bytes, path, sha256: digest });
      },
    );
  const preScripts = project(pre);
  const postScripts = project(post);
  if (
    preScripts.length === 0 ||
    !sameJson(preScripts, postScripts) ||
    new Set(preScripts.map(({ path }) => path)).size !== preScripts.length
  ) {
    throw new Error("Asset update changed or omitted the exact V8 script inventory");
  }
  return Object.freeze(preScripts);
}

function expectedThreadedWasmArtifact(
  pre: ReturnType<typeof validateReleaseAuthority>,
  post: ReturnType<typeof validateReleaseAuthority>,
): Readonly<{ readonly bytes: number; readonly path: string; readonly sha256: string }> {
  const project = (release: ReturnType<typeof validateReleaseAuthority>) => {
    const matches = release.installManifest.resources.filter(
      ({ kind, source }) =>
        kind === "wasm" && /^immutable\/wasm-thread-spike-[a-f0-9]{64}\.wasm$/.test(source),
    );
    const resource = matches[0];
    if (matches.length !== 1 || resource === undefined) {
      throw new Error("Release lacks the exact threaded-Wasm streaming artifact");
    }
    return Object.freeze({
      bytes: resource.bytes,
      path: resource.source,
      sha256: resource.sha256,
    });
  };
  const preWasm = project(pre);
  const postWasm = project(post);
  if (!sameJson(preWasm, postWasm)) {
    throw new Error("Asset update changed the threaded-Wasm streaming artifact");
  }
  return preWasm;
}

function validateV8Diagnostics(
  input: unknown,
  phase: AssetUpdateV8Diagnostics["phase"],
  expectedScripts: readonly Readonly<{ readonly bytes: number; readonly path: string }>[],
  expectedWasm: Readonly<{
    readonly bytes: number;
    readonly path: string;
    readonly sha256: string;
  }>,
  legacyV2: boolean,
): AssetUpdateV8Diagnostics | LegacyAssetUpdateV8Diagnostics {
  const diagnostics = record(input, `${phase} V8 diagnostics`);
  requireExactKeys(
    diagnostics,
    [
      "cache",
      "phase",
      "persistentProfileId",
      "production",
      "profile",
      "runtimeOrdinal",
      "scriptArtifacts",
      "trace",
      "wasmStreaming",
      "workerStartupToFirstFrameMs",
    ],
    `${phase} V8 diagnostics`,
  );
  if (
    diagnostics.phase !== phase ||
    typeof diagnostics.persistentProfileId !== "string" ||
    !PROFILE_ID.test(diagnostics.persistentProfileId) ||
    diagnostics.profile !==
      (phase === "fresh" ? "fresh" : phase === "produce" ? "produce" : "warm") ||
    diagnostics.runtimeOrdinal !==
      (phase === "fresh" ? 1 : phase === "produce" ? 2 : phase === "pre-warm" ? 3 : 6) ||
    (diagnostics.workerStartupToFirstFrameMs !== null &&
      (!finite(diagnostics.workerStartupToFirstFrameMs) ||
        diagnostics.workerStartupToFirstFrameMs < 0))
  ) {
    throw new Error(`${phase} V8 diagnostic identity is invalid`);
  }
  const trace = record(diagnostics.trace, `${phase} trace`);
  const traceEventCount = trace.eventCount;
  requireExactKeys(
    trace,
    trace.state === "measured"
      ? ["dataLossOccurred", "eventCount", "state"]
      : ["dataLossOccurred", "eventCount", "reason", "state"],
    `${phase} trace`,
  );
  if (
    (trace.state !== "measured" && trace.state !== "invalid") ||
    typeof traceEventCount !== "number" ||
    !Number.isSafeInteger(traceEventCount) ||
    traceEventCount < 0 ||
    (trace.dataLossOccurred !== null && typeof trace.dataLossOccurred !== "boolean") ||
    (trace.state === "measured" && trace.dataLossOccurred !== false) ||
    (trace.state === "invalid" && !isSanitizedAssetUpdateDiagnostic(trace.reason)) ||
    (trace.state === "measured" && "reason" in trace)
  ) {
    throw new Error(`${phase} V8 trace evidence is malformed`);
  }
  if (
    !Array.isArray(diagnostics.scriptArtifacts) ||
    diagnostics.scriptArtifacts.length !== expectedScripts.length
  ) {
    throw new Error(`${phase} V8 diagnostic has an incomplete executable script inventory`);
  }
  const paths = new Set<string>();
  for (const [index, artifact] of diagnostics.scriptArtifacts.entries()) {
    const item = record(artifact, `${phase} script artifact`);
    requireExactKeys(item, ["bytes", "path", "sourceCodeUnits"], `${phase} script artifact`);
    const bytes = item.bytes;
    const sourceCodeUnits = item.sourceCodeUnits;
    if (
      typeof bytes !== "number" ||
      !Number.isSafeInteger(bytes) ||
      bytes <= 0 ||
      typeof item.path !== "string" ||
      !/^immutable\/[A-Za-z0-9._/-]+\.js$/.test(item.path) ||
      typeof sourceCodeUnits !== "number" ||
      !Number.isSafeInteger(sourceCodeUnits) ||
      sourceCodeUnits <= 0 ||
      sourceCodeUnits > bytes ||
      paths.has(item.path) ||
      item.path !== expectedScripts[index]?.path ||
      bytes !== expectedScripts[index]?.bytes
    ) {
      throw new Error(`${phase} V8 script artifact identity is invalid`);
    }
    paths.add(item.path);
  }
  validateWasmStreaming(
    diagnostics.wasmStreaming,
    phase,
    expectedWasm,
    legacyV2 ? "instantiateStreaming" : "compileStreaming",
  );
  validateV8Metric(
    diagnostics.cache,
    diagnostics.scriptArtifacts,
    "cache",
    diagnostics.profile as AssetUpdateV8Diagnostics["profile"],
  );
  validateV8Metric(
    diagnostics.production,
    diagnostics.scriptArtifacts,
    "production",
    diagnostics.profile as AssetUpdateV8Diagnostics["profile"],
  );
  if (
    trace.state === "invalid" &&
    (record(diagnostics.cache, `${phase} cache`).state !== "invalid" ||
      record(diagnostics.production, `${phase} production`).state !== "invalid")
  ) {
    throw new Error(`${phase} trace data loss must invalidate cache and production metrics`);
  }
  return diagnostics as unknown as AssetUpdateV8Diagnostics | LegacyAssetUpdateV8Diagnostics;
}

function validateWasmStreaming(
  input: unknown,
  phase: AssetUpdateV8Diagnostics["phase"],
  expected: Readonly<{ readonly bytes: number; readonly path: string; readonly sha256: string }>,
  expectedApi: "compileStreaming" | "instantiateStreaming",
): void {
  const wasm = record(input, `${phase} threaded-Wasm streaming`);
  requireExactKeys(
    wasm,
    ["api", "artifact", "durationMs", "reason", "state"],
    `${phase} threaded-Wasm streaming`,
  );
  const artifact = record(wasm.artifact, `${phase} threaded-Wasm artifact`);
  requireExactKeys(artifact, ["bytes", "path", "sha256"], `${phase} threaded-Wasm artifact`);
  if (
    wasm.api !== expectedApi ||
    !sameJson(artifact, expected) ||
    (wasm.state !== "measured" && wasm.state !== "invalid" && wasm.state !== "not-applicable") ||
    (wasm.state === "measured" &&
      (!finite(wasm.durationMs) || wasm.durationMs < 0 || wasm.reason !== null)) ||
    (wasm.state !== "measured" &&
      (wasm.durationMs !== null || !isSanitizedAssetUpdateDiagnostic(wasm.reason))) ||
    (phase === "fresh" && wasm.state !== "not-applicable") ||
    (phase !== "fresh" && wasm.state === "not-applicable")
  ) {
    throw new Error(`${phase} threaded-Wasm streaming evidence is malformed`);
  }
}

function validateV8Metric(
  input: unknown,
  scripts: readonly V8ScriptArtifact[],
  kind: "cache" | "production",
  profile: AssetUpdateV8Diagnostics["profile"],
): void {
  const metric = record(input, `V8 ${kind} metric`);
  if (
    metric.state !== "measured" &&
    metric.state !== "invalid" &&
    metric.state !== "not-applicable"
  ) {
    throw new Error(`V8 ${kind} metric state is unsupported`);
  }
  requireExactKeys(
    metric,
    metric.state === "measured" ? ["evidence", "state"] : ["evidence", "reason", "state"],
    `V8 ${kind} metric`,
  );
  if (metric.state !== "measured" && !isSanitizedAssetUpdateDiagnostic(metric.reason)) {
    throw new Error(`V8 ${kind} non-measured metric omits its reason`);
  }
  const cacheableArtifactCount = scripts.filter(
    ({ sourceCodeUnits }) => sourceCodeUnits >= V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS,
  ).length;
  const noCacheableArtifactReason =
    "no immutable JavaScript artifact meets Chrome 150's cacheability threshold";
  if (metric.evidence === null) {
    if (metric.state === "measured") throw new Error(`Measured V8 ${kind} metric omits evidence`);
    const projectedMetricState = cacheableArtifactCount === 0 ? "not-applicable" : "invalid";
    if (metric.state !== projectedMetricState) {
      throw new Error(`V8 ${kind} metric state is not an exact script-inventory projection`);
    }
    if (metric.state === "not-applicable" && metric.reason !== noCacheableArtifactReason) {
      throw new Error(`V8 ${kind} metric reason is not an exact script-inventory projection`);
    }
    return;
  }
  const evidence = record(metric.evidence, `V8 ${kind} evidence`);
  const counterNames =
    kind === "cache"
      ? ["artifacts", "cacheableArtifactCount", "consumedArtifactCount", "rejectedArtifactCount"]
      : ["artifacts", "cacheableArtifactCount", "producedArtifactCount", "producedBytes"];
  requireExactKeys(evidence, counterNames, `V8 ${kind} evidence`);
  if (!Array.isArray(evidence.artifacts) || evidence.artifacts.length !== scripts.length) {
    throw new Error(`V8 ${kind} evidence artifact inventory is incomplete`);
  }
  const expected = new Map(scripts.map((script) => [script.path, script]));
  let consumedArtifactCount = 0;
  let producedArtifactCount = 0;
  let producedBytes = 0;
  let rejectedArtifactCount = 0;
  let invalidArtifactCount = 0;
  const invalidMetricReasons: string[] = [];
  for (const candidate of evidence.artifacts) {
    const artifact = record(candidate, `V8 ${kind} artifact`);
    const script = typeof artifact.artifact === "string" ? expected.get(artifact.artifact) : null;
    if (
      script === null ||
      script === undefined ||
      artifact.bytes !== script.bytes ||
      artifact.sourceCodeUnits !== script.sourceCodeUnits
    ) {
      throw new Error(`V8 ${kind} evidence does not match its executable inventory`);
    }
    expected.delete(script.path);
    if (kind === "cache") {
      requireExactKeys(
        artifact,
        ["artifact", "bytes", "cache", "compileDurationUs", "compilations", "sourceCodeUnits"],
        "V8 cache artifact",
      );
      if (
        !finite(artifact.compileDurationUs) ||
        artifact.compileDurationUs < 0 ||
        !Array.isArray(artifact.compilations) ||
        artifact.compilations.length === 0
      ) {
        throw new Error("V8 cache evidence has invalid compile duration");
      }
      const aggregate = validateCacheOutcome(artifact.cache, "V8 cache artifact outcome");
      let compileDurationUs = 0;
      let rejected = false;
      const compilationOutcomes: ValidatedCacheOutcome[] = [];
      for (const candidateCompilation of artifact.compilations) {
        const compilation = record(candidateCompilation, "V8 cache compilation");
        requireExactKeys(
          compilation,
          ["cache", "compilation", "compileDurationUs", "processId", "streamed", "threadId"],
          "V8 cache compilation",
        );
        if (
          (compilation.compilation !== "classic" && compilation.compilation !== "module") ||
          !finite(compilation.compileDurationUs) ||
          compilation.compileDurationUs < 0 ||
          !nonnegativeSafeInteger(compilation.processId) ||
          !nonnegativeSafeInteger(compilation.threadId) ||
          typeof compilation.streamed !== "boolean"
        ) {
          throw new Error("V8 cache compilation evidence is malformed");
        }
        compileDurationUs += compilation.compileDurationUs;
        const outcome = validateCacheOutcome(compilation.cache, "V8 cache compilation outcome");
        validateCacheCompilationProfileOutcome(outcome, script.sourceCodeUnits, profile);
        compilationOutcomes.push(outcome);
        if (outcome.state === "measured" && outcome.outcome === "rejected") rejected = true;
      }
      if (compileDurationUs !== artifact.compileDurationUs) {
        throw new Error("V8 cache artifact compile duration is not an exact event sum");
      }
      const projectedAggregate = projectCacheAggregate(
        compilationOutcomes,
        script.sourceCodeUnits,
        profile,
      );
      if (!sameJson(aggregate, projectedAggregate)) {
        throw new Error("V8 cache artifact outcome is not an exact compilation projection");
      }
      if (aggregate.state === "invalid") invalidArtifactCount += 1;
      if (aggregate.state === "invalid") {
        invalidMetricReasons.push(`${script.path}: ${aggregate.reason}`);
      }
      if (aggregate.state === "measured" && aggregate.outcome === "consumed") {
        consumedArtifactCount += 1;
      }
      if (rejected) rejectedArtifactCount += 1;
    } else {
      requireExactKeys(
        artifact,
        artifact.state === "measured"
          ? ["artifact", "bytes", "productions", "sourceCodeUnits", "state"]
          : ["artifact", "bytes", "productions", "reason", "sourceCodeUnits", "state"],
        "V8 production artifact",
      );
      if (
        (artifact.state !== "measured" &&
          artifact.state !== "invalid" &&
          artifact.state !== "not-applicable") ||
        (artifact.state !== "measured" && !isSanitizedAssetUpdateDiagnostic(artifact.reason)) ||
        !Array.isArray(artifact.productions)
      ) {
        throw new Error("V8 production artifact evidence is malformed");
      }
      let invalidProductionCount = 0;
      let measuredProductionCount = 0;
      for (const candidateProduction of artifact.productions) {
        const production = record(candidateProduction, "V8 production event");
        requireExactKeys(
          production,
          production.state === "measured"
            ? ["processId", "producedBytes", "state", "threadId"]
            : ["processId", "reason", "state", "threadId"],
          "V8 production event",
        );
        if (
          !nonnegativeSafeInteger(production.processId) ||
          !nonnegativeSafeInteger(production.threadId) ||
          (production.state !== "measured" && production.state !== "invalid") ||
          (production.state === "measured" &&
            (!nonnegativeSafeInteger(production.producedBytes) ||
              production.producedBytes === 0)) ||
          (production.state === "invalid" && !isSanitizedAssetUpdateDiagnostic(production.reason))
        ) {
          throw new Error("V8 production event evidence is malformed");
        }
        if (production.state === "measured") {
          measuredProductionCount += 1;
          producedBytes += production.producedBytes as number;
        } else {
          invalidProductionCount += 1;
        }
      }
      const projectedProduction = projectProductionArtifact(
        script.sourceCodeUnits,
        artifact.productions.length,
        invalidProductionCount,
        measuredProductionCount,
        profile,
      );
      if (
        artifact.state !== projectedProduction.state ||
        (projectedProduction.state === "measured"
          ? "reason" in artifact
          : artifact.reason !== projectedProduction.reason)
      ) {
        throw new Error("V8 production artifact is not an exact event/profile projection");
      }
      if (artifact.state === "invalid") {
        invalidArtifactCount += 1;
        invalidMetricReasons.push(`${script.path}: ${artifact.reason as string}`);
      }
      if (artifact.state === "measured") producedArtifactCount += 1;
    }
  }
  if (expected.size !== 0) {
    throw new Error(`V8 ${kind} evidence artifact inventory is incomplete`);
  }
  if (
    evidence.cacheableArtifactCount !== cacheableArtifactCount ||
    (kind === "cache" &&
      (evidence.consumedArtifactCount !== consumedArtifactCount ||
        evidence.rejectedArtifactCount !== rejectedArtifactCount)) ||
    (kind === "production" &&
      (evidence.producedArtifactCount !== producedArtifactCount ||
        evidence.producedBytes !== producedBytes))
  ) {
    throw new Error(`V8 ${kind} evidence counters are not exact event projections`);
  }
  if (
    kind === "cache" &&
    profile !== "warm" &&
    (evidence.consumedArtifactCount !== 0 || evidence.rejectedArtifactCount !== 0)
  ) {
    throw new Error(`V8 ${profile} cache counters claim impossible cache consumption`);
  }
  const projectedMetricState =
    cacheableArtifactCount === 0
      ? "not-applicable"
      : invalidArtifactCount > 0
        ? "invalid"
        : "measured";
  if (metric.state !== projectedMetricState) {
    throw new Error(`V8 ${kind} metric state is not an exact artifact projection`);
  }
  const projectedMetricReason =
    cacheableArtifactCount === 0
      ? noCacheableArtifactReason
      : invalidMetricReasons.length > 0
        ? sanitizeAssetUpdateDiagnostic(invalidMetricReasons.join(" | "))
        : null;
  if (metric.state !== "measured" && metric.reason !== projectedMetricReason) {
    throw new Error(`V8 ${kind} metric reason is not an exact artifact projection`);
  }
}

type ValidatedCacheOutcome =
  | Readonly<{
      readonly consumedBytes: number | null;
      readonly outcome: "consumed" | "rejected";
      readonly state: "measured";
    }>
  | Readonly<{ readonly reason: string; readonly state: "invalid" | "not-applicable" }>;

function validateCacheOutcome(input: unknown, label: string): ValidatedCacheOutcome {
  const outcome = record(input, label);
  if (outcome.state === "measured") {
    requireExactKeys(outcome, ["consumedBytes", "outcome", "state"], label);
    if (
      (outcome.outcome !== "consumed" && outcome.outcome !== "rejected") ||
      (outcome.consumedBytes !== null &&
        (!nonnegativeSafeInteger(outcome.consumedBytes) || outcome.consumedBytes === 0)) ||
      (outcome.outcome === "consumed" && outcome.consumedBytes === null)
    ) {
      throw new Error(`${label} is malformed`);
    }
  } else {
    requireExactKeys(outcome, ["reason", "state"], label);
    if (
      (outcome.state !== "invalid" && outcome.state !== "not-applicable") ||
      !isSanitizedAssetUpdateDiagnostic(outcome.reason)
    ) {
      throw new Error(`${label} is malformed`);
    }
  }
  return outcome as unknown as ValidatedCacheOutcome;
}

function projectCacheAggregate(
  outcomes: readonly ValidatedCacheOutcome[],
  sourceCodeUnits: number,
  profile: AssetUpdateV8Diagnostics["profile"],
): ValidatedCacheOutcome {
  const first = outcomes[0];
  if (first === undefined) throw new Error("V8 cache compilation projection is empty");
  if (sourceCodeUnits < V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS) return first;
  const invalidReasons = outcomes.flatMap((outcome) =>
    outcome.state === "invalid" ? [outcome.reason] : [],
  );
  if (invalidReasons.length > 0) {
    return Object.freeze({
      reason: `${invalidReasons.length}/${outcomes.length} compilation events lack trustworthy cache evidence: ${[...new Set(invalidReasons)].join("; ")}`,
      state: "invalid" as const,
    });
  }
  if (profile !== "warm") return first;
  const rejected = outcomes.filter(
    (outcome): outcome is Extract<ValidatedCacheOutcome, { readonly state: "measured" }> =>
      outcome.state === "measured" && outcome.outcome === "rejected",
  );
  return Object.freeze({
    consumedBytes: sumKnownCacheBytes(rejected.length > 0 ? rejected : outcomes),
    outcome: rejected.length > 0 ? ("rejected" as const) : ("consumed" as const),
    state: "measured" as const,
  });
}

function validateCacheCompilationProfileOutcome(
  outcome: ValidatedCacheOutcome,
  sourceCodeUnits: number,
  profile: AssetUpdateV8Diagnostics["profile"],
): void {
  if (profile === "warm") return;
  const thresholdReason = `artifact source is smaller than Chrome 150's ${V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS}-code-unit external-script cache threshold`;
  if (sourceCodeUnits < V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS) {
    if (outcome.state === "not-applicable" && outcome.reason === thresholdReason) return;
  } else {
    const nonConsumptionReason =
      profile === "fresh"
        ? "fresh profile has no prior persistent V8 code cache to consume"
        : "produce profile has only a prior hot timestamp and no code cache to consume";
    if (outcome.state === "not-applicable" && outcome.reason === nonConsumptionReason) return;
    if (
      outcome.state === "invalid" &&
      outcome.reason === `${profile} profile unexpectedly reported a V8 cache-consumption result`
    ) {
      return;
    }
  }
  throw new Error(`V8 ${profile} cache compilation outcome is not extractor-reachable`);
}

function sumKnownCacheBytes(outcomes: readonly ValidatedCacheOutcome[]): number | null {
  let total = 0;
  for (const outcome of outcomes) {
    if (outcome.state !== "measured" || outcome.consumedBytes === null) return null;
    total += outcome.consumedBytes;
  }
  return total;
}

function projectProductionArtifact(
  sourceCodeUnits: number,
  productionCount: number,
  invalidProductionCount: number,
  measuredProductionCount: number,
  profile: AssetUpdateV8Diagnostics["profile"],
):
  | Readonly<{ readonly state: "measured" }>
  | Readonly<{ readonly reason: string; readonly state: "invalid" | "not-applicable" }> {
  if (invalidProductionCount > 0) {
    return Object.freeze({
      reason: `${invalidProductionCount}/${productionCount} production events lack a positive producedCacheSize`,
      state: "invalid" as const,
    });
  }
  if (sourceCodeUnits < V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS) {
    return productionCount === 0
      ? Object.freeze({
          reason: `artifact source is smaller than Chrome 150's ${V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS}-code-unit external-script cache threshold`,
          state: "not-applicable" as const,
        })
      : Object.freeze({
          reason: `artifact below Chrome 150's cacheability threshold unexpectedly emitted ${productionCount} production event${productionCount === 1 ? "" : "s"}`,
          state: "invalid" as const,
        });
  }
  if (productionCount === 0) {
    return Object.freeze({
      reason:
        profile === "fresh"
          ? "fresh launch emitted no unexpected URL-attributed code-cache production event"
          : profile === "warm"
            ? "warm launch emitted no URL-attributed code-cache re-production event"
            : "no URL-attributed code-cache production event was observed",
      state: profile === "produce" ? ("invalid" as const) : ("not-applicable" as const),
    });
  }
  if (profile === "fresh") {
    return Object.freeze({
      reason: `fresh launch unexpectedly emitted ${measuredProductionCount} URL-attributed code-cache production event${measuredProductionCount === 1 ? "" : "s"}`,
      state: "invalid" as const,
    });
  }
  return Object.freeze({ state: "measured" as const });
}

function nonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validateAuthority(
  input: unknown,
  expected?: AssetUpdateRunAuthority,
): AssetUpdateRunAuthority {
  const authority = record(input, "authority");
  requireExactKeys(
    authority,
    ["baseBuild", "browser", "machine", "persistentProfileId", "source", "targetOrigin"],
    "authority",
  );
  const baseBuild = record(authority.baseBuild, "baseBuild");
  requireExactKeys(baseBuild, ["artifactDigest", "releaseDigest"], "baseBuild");
  requireDigest(baseBuild.artifactDigest, "base artifact");
  requireDigest(baseBuild.releaseDigest, "base release");
  const browser = record(authority.browser, "browser");
  requireExactKeys(
    browser,
    [
      "executableSha256",
      "jsVersion",
      "product",
      "protocolVersion",
      "revision",
      "userAgent",
      "version",
    ],
    "browser",
  );
  requireDigest(browser.executableSha256, "browser executable");
  for (const key of ["jsVersion", "product", "revision", "userAgent", "version"]) {
    if (typeof browser[key] !== "string" || browser[key] === "") {
      throw new Error(`Browser authority ${key} is invalid`);
    }
  }
  if (browser.product !== `Chrome/${browser.version}`) {
    throw new Error("Browser authority product/version is inconsistent");
  }
  if (browser.protocolVersion !== "1.3") {
    throw new Error("Browser authority protocolVersion is invalid");
  }
  const machine = record(authority.machine, "machine");
  requireExactKeys(
    machine,
    ["descriptorBase64", "descriptorSha256", "gate", "id", "postObservation", "preObservation"],
    "machine",
  );
  requireDigest(machine.descriptorSha256, "machine descriptor");
  const machineBytes = decodeBase64(machine.descriptorBase64, "machine descriptor");
  const descriptor = parseJsonObject(
    machineBytes,
    "machine descriptor",
  ) as unknown as MachineDescriptor;
  validateMachineDescriptorAuthority(descriptor);
  const gate = record(machine.gate, "machine gate");
  requireExactKeys(gate, ["post", "pre"], "machine gate");
  const preObservation = validateMachineObservation(machine.preObservation, "pre");
  const postObservation = validateMachineObservation(machine.postObservation, "post");
  if (
    sha256(machineBytes) !== machine.descriptorSha256 ||
    typeof machine.id !== "string" ||
    descriptor.id !== machine.id
  ) {
    throw new Error("Machine authority descriptor identity is inconsistent");
  }
  let preGate: ReturnType<typeof evaluateGateEnvironment>;
  let postGate: ReturnType<typeof evaluateGateEnvironment>;
  try {
    preGate = evaluateGateEnvironment(descriptor, preObservation);
    postGate = evaluateGateEnvironment(descriptor, postObservation);
  } catch (error: unknown) {
    throw new Error("Machine authority observation cannot be evaluated", { cause: error });
  }
  if (
    !sameJson(preGate, { state: "measured", value: true }) ||
    !sameJson(postGate, { state: "measured", value: true }) ||
    !sameJson(gate.pre, preGate) ||
    !sameJson(gate.post, postGate)
  ) {
    throw new Error("Machine authority does not pass exact pre/post registered-environment gates");
  }
  const source = record(authority.source, "source");
  requireExactKeys(source, ["commit", "dirtyTreeDigest"], "source");
  if (
    typeof source.commit !== "string" ||
    !COMMIT.test(source.commit) ||
    (source.dirtyTreeDigest !== null &&
      (typeof source.dirtyTreeDigest !== "string" || !SHA256.test(source.dirtyTreeDigest))) ||
    typeof authority.persistentProfileId !== "string" ||
    !PROFILE_ID.test(authority.persistentProfileId) ||
    typeof authority.targetOrigin !== "string" ||
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(authority.targetOrigin)
  ) {
    throw new Error("Source/profile/target authority is invalid");
  }
  if (expected !== undefined && !sameJson(authority, expected)) {
    throw new Error("Asset-update evidence authority differs from expected exact authority");
  }
  return authority as unknown as AssetUpdateRunAuthority;
}

function validateMachineDescriptorAuthority(input: MachineDescriptor): void {
  const descriptor = record(input, "machine descriptor");
  requireExactKeys(
    descriptor,
    [
      "arch",
      "cpu",
      "display",
      "gateTiers",
      "gpu",
      "id",
      "minimumPhysicalMemoryBytes",
      "osBuild",
      "platform",
      "powerSchemeGuid",
      "schemaVersion",
    ],
    "machine descriptor",
  );
  const cpu = record(descriptor.cpu, "machine descriptor CPU");
  const display = record(descriptor.display, "machine descriptor display");
  const gpu = record(descriptor.gpu, "machine descriptor GPU");
  requireExactKeys(cpu, ["cores", "logicalProcessors", "name"], "machine descriptor CPU");
  requireExactKeys(
    display,
    ["dimensionTolerancePixels", "height", "refreshRateHz", "refreshRateToleranceHz", "width"],
    "machine descriptor display",
  );
  requireExactKeys(
    gpu,
    [
      "architecture",
      "backend",
      "deviceId",
      "driverVersion",
      "name",
      "subSysId",
      "vendor",
      "vendorId",
    ],
    "machine descriptor GPU",
  );
  if (
    descriptor.schemaVersion !== 1 ||
    typeof descriptor.arch !== "string" ||
    typeof descriptor.id !== "string" ||
    typeof descriptor.osBuild !== "string" ||
    typeof descriptor.platform !== "string" ||
    typeof descriptor.powerSchemeGuid !== "string" ||
    !nonnegativeSafeInteger(descriptor.minimumPhysicalMemoryBytes) ||
    !Array.isArray(descriptor.gateTiers) ||
    descriptor.gateTiers.some((tier) => tier !== "showcase" && tier !== "standard") ||
    typeof cpu.name !== "string" ||
    !nonnegativeSafeInteger(cpu.cores) ||
    !nonnegativeSafeInteger(cpu.logicalProcessors) ||
    !finiteRecordNumbers(display) ||
    typeof gpu.architecture !== "string" ||
    typeof gpu.backend !== "string" ||
    typeof gpu.driverVersion !== "string" ||
    typeof gpu.name !== "string" ||
    typeof gpu.vendor !== "string" ||
    !nonnegativeSafeInteger(gpu.deviceId) ||
    !nonnegativeSafeInteger(gpu.subSysId) ||
    !nonnegativeSafeInteger(gpu.vendorId)
  ) {
    throw new Error("Machine authority descriptor structure is invalid");
  }
}

function validateMachineObservation(
  input: unknown,
  phase: "post" | "pre",
): GateEnvironmentObservation {
  const observation = record(input, `${phase} machine observation`);
  requireExactKeys(
    observation,
    ["adapter", "arch", "browserDisplay", "host", "platform", "primaryGpu", "requestedTier"],
    `${phase} machine observation`,
  );
  const adapter = record(observation.adapter, `${phase} WebGPU adapter`);
  const browserDisplay = record(observation.browserDisplay, `${phase} browser display`);
  const host = record(observation.host, `${phase} host`);
  const primaryGpu = record(observation.primaryGpu, `${phase} primary GPU`);
  requireExactKeys(
    adapter,
    [
      "architecture",
      "backend",
      "description",
      "device",
      "driver",
      "isFallbackAdapter",
      "type",
      "vendor",
    ],
    `${phase} WebGPU adapter`,
  );
  requireExactKeys(
    browserDisplay,
    ["probeFailures", "refreshRatesHz", "screen"],
    `${phase} browser display`,
  );
  requireExactKeys(
    host,
    ["cpu", "os", "physicalMemoryBytes", "power", "remoteSession", "videoControllers"],
    `${phase} host`,
  );
  requireExactKeys(
    primaryGpu,
    [
      "deviceId",
      "deviceString",
      "driverVendor",
      "driverVersion",
      "revision",
      "subSysId",
      "vendorId",
      "vendorString",
    ],
    `${phase} primary GPU`,
  );
  const hostCpu = record(host.cpu, `${phase} host CPU`);
  const hostOs = record(host.os, `${phase} host OS`);
  const hostPower = record(host.power, `${phase} host power`);
  requireExactKeys(hostCpu, ["cores", "logicalProcessors", "name"], `${phase} host CPU`);
  requireExactKeys(hostOs, ["build", "caption"], `${phase} host OS`);
  requireExactKeys(hostPower, ["guid", "name"], `${phase} host power`);
  if (!Array.isArray(host.videoControllers)) {
    throw new Error(`${phase} machine observation video-controller inventory is invalid`);
  }
  for (const candidate of host.videoControllers) {
    const controller = record(candidate, `${phase} video controller`);
    requireExactKeys(
      controller,
      ["driverVersion", "height", "name", "pnpDeviceId", "refreshRateHz", "width"],
      `${phase} video controller`,
    );
    if (
      typeof controller.driverVersion !== "string" ||
      typeof controller.name !== "string" ||
      typeof controller.pnpDeviceId !== "string" ||
      !nullableFinite(controller.height) ||
      !nullableFinite(controller.refreshRateHz) ||
      !nullableFinite(controller.width)
    ) {
      throw new Error(`${phase} machine observation video-controller identity is invalid`);
    }
  }
  if (browserDisplay.screen !== null) {
    const screen = record(browserDisplay.screen, `${phase} browser screen`);
    requireExactKeys(
      screen,
      ["availHeight", "availWidth", "colorDepth", "devicePixelRatio", "height", "width"],
      `${phase} browser screen`,
    );
    if (!finiteRecordNumbers(screen)) {
      throw new Error(`${phase} machine observation browser screen is invalid`);
    }
  }
  if (
    observation.arch !== "x64" ||
    observation.platform !== "win32" ||
    observation.requestedTier !== "showcase" ||
    typeof adapter.architecture !== "string" ||
    !nullableString(adapter.backend) ||
    typeof adapter.description !== "string" ||
    typeof adapter.device !== "string" ||
    !nullableString(adapter.driver) ||
    typeof adapter.isFallbackAdapter !== "boolean" ||
    !nullableString(adapter.type) ||
    typeof adapter.vendor !== "string" ||
    !Array.isArray(browserDisplay.probeFailures) ||
    browserDisplay.probeFailures.some((failure) => typeof failure !== "string") ||
    !Array.isArray(browserDisplay.refreshRatesHz) ||
    browserDisplay.refreshRatesHz.some((rate) => !finite(rate)) ||
    typeof hostCpu.name !== "string" ||
    !nonnegativeSafeInteger(hostCpu.cores) ||
    !nonnegativeSafeInteger(hostCpu.logicalProcessors) ||
    typeof hostOs.build !== "string" ||
    typeof hostOs.caption !== "string" ||
    typeof hostPower.guid !== "string" ||
    !nullableString(hostPower.name) ||
    !nonnegativeSafeInteger(host.physicalMemoryBytes) ||
    typeof host.remoteSession !== "boolean" ||
    typeof primaryGpu.deviceString !== "string" ||
    typeof primaryGpu.driverVendor !== "string" ||
    typeof primaryGpu.driverVersion !== "string" ||
    typeof primaryGpu.vendorString !== "string" ||
    !nonnegativeSafeInteger(primaryGpu.deviceId) ||
    !nonnegativeSafeInteger(primaryGpu.revision) ||
    !nonnegativeSafeInteger(primaryGpu.subSysId) ||
    !nonnegativeSafeInteger(primaryGpu.vendorId)
  ) {
    throw new Error(`${phase} machine observation structure is invalid`);
  }
  return observation as unknown as GateEnvironmentObservation;
}

function finiteRecordNumbers(input: Record<string, unknown>): boolean {
  return Object.values(input).every(finite);
}

function nullableFinite(value: unknown): boolean {
  return value === null || finite(value);
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function validateFailure(input: unknown): void {
  const failure = record(input, "failure");
  requireExactKeys(failure, ["message", "name", "phase"], "failure");
  if (
    !isSanitizedAssetUpdateErrorName(failure.name) ||
    !isSanitizedAssetUpdateDiagnostic(failure.message) ||
    typeof failure.phase !== "string" ||
    !RESULT_PHASES.has(failure.phase) ||
    failure.name.length > 80 ||
    failure.message.length > 400
  ) {
    throw new Error("Asset-update failure evidence is malformed or unsanitized");
  }
}

function validateFailureContext(input: unknown): void {
  if (input === null) return;
  const context = record(input, "failureContext");
  const rejected = context.state === "rejected-lifecycle-snapshot";
  requireExactKeys(
    context,
    rejected
      ? ["initialInstall", "journal", "partialValidation", "state", "transfer"]
      : ["journal", "state", "transfer"],
    "failureContext",
  );
  if (!rejected && context.state !== "unvalidated-lifecycle-snapshot") {
    throw new Error("Asset-update failure context state is invalid");
  }
  if (rejected) {
    validateFailureContextInitialInstall(context.initialInstall);
    const rejection = record(context.partialValidation, "failureContext partialValidation");
    requireExactKeys(rejection, ["message", "name", "state"], "failureContext partialValidation");
    if (
      rejection.state !== "rejected" ||
      !isSanitizedAssetUpdateErrorName(rejection.name) ||
      !isSanitizedAssetUpdateDiagnostic(rejection.message) ||
      rejection.name.length > 80 ||
      rejection.message.length > 400
    ) {
      throw new Error("Asset-update partial-validation rejection is malformed or unsanitized");
    }
  }
  if (context.transfer !== null) {
    const transfer = record(context.transfer, "failureContext transfer");
    const transferKeys = [
      "activeReleaseDigest",
      "checkpointedBytes",
      "completedResourceCount",
      "downloadedBytes",
      "hashedBytes",
      "httpRequestCount",
      "plannedDownloadBytes",
      "rangeRequestCount",
      "resourceCount",
      "resumedBytes",
      "reusedBytes",
      "totalBytes",
      "verifiedBytes",
    ];
    requireExactKeys(transfer, transferKeys, "failureContext transfer");
    if (
      (transfer.activeReleaseDigest !== null &&
        (typeof transfer.activeReleaseDigest !== "string" ||
          !SHA256.test(transfer.activeReleaseDigest))) ||
      transferKeys
        .filter((key) => key !== "activeReleaseDigest")
        .some((key) => transfer[key] !== null && !nonnegativeSafeInteger(transfer[key]))
    ) {
      throw new Error("Asset-update failure transfer context is malformed");
    }
  }
  if (context.journal === null) return;
  const journal = record(context.journal, "failureContext journal");
  requireExactKeys(
    journal,
    [
      "entries",
      "observedEntryCount",
      "retainedEntryCount",
      "sourceMaximumEntries",
      "sourceOverflowed",
      "truncated",
    ],
    "failureContext journal",
  );
  if (
    !Array.isArray(journal.entries) ||
    journal.entries.length > 256 ||
    !nonnegativeSafeInteger(journal.observedEntryCount) ||
    journal.retainedEntryCount !== journal.entries.length ||
    (journal.sourceMaximumEntries !== null &&
      !nonnegativeSafeInteger(journal.sourceMaximumEntries)) ||
    (journal.sourceOverflowed !== null && typeof journal.sourceOverflowed !== "boolean") ||
    typeof journal.truncated !== "boolean" ||
    journal.truncated !==
      (journal.sourceOverflowed === true ||
        (journal.observedEntryCount as number) > journal.entries.length)
  ) {
    throw new Error("Asset-update failure journal context is malformed or unbounded");
  }
  for (const [index, candidate] of journal.entries.entries()) {
    const entry = record(candidate, `failureContext journal entry ${index + 1}`);
    requireExactKeys(
      entry,
      ["bodyBytes", "path", "range", "sequence", "status"],
      "failureContext journal entry",
    );
    if (
      (entry.bodyBytes !== null && !nonnegativeSafeInteger(entry.bodyBytes)) ||
      typeof entry.path !== "string" ||
      entry.path.length > 512 ||
      !/^\/[A-Za-z0-9._/-]*$/.test(entry.path) ||
      (entry.range !== null &&
        (typeof entry.range !== "string" ||
          entry.range.length > 128 ||
          !/^bytes=[0-9]+-(?:[0-9]+)?$/.test(entry.range))) ||
      (entry.sequence !== null && !nonnegativeSafeInteger(entry.sequence)) ||
      (entry.status !== null && !nonnegativeSafeInteger(entry.status))
    ) {
      throw new Error("Asset-update failure journal entry is malformed or unsanitized");
    }
  }
}

function validateFailureContextInitialInstall(input: unknown): void {
  if (input === null) return;
  const initial = record(input, "failureContext initialInstall");
  requireExactKeys(
    initial,
    [
      "contract",
      "finalVerificationObservation",
      "installWall",
      "network",
      "networkIdleLocalCriticalPathBudgetMs",
      "networkIdleLocalCriticalPathMs",
      "state",
    ],
    "failureContext initialInstall",
  );
  if (
    initial.contract !== INSTALL_EXIT_CONTRACT ||
    initial.state !== "independently-validated" ||
    initial.networkIdleLocalCriticalPathBudgetMs !== INITIAL_INSTALL_BUDGET_MS
  ) {
    throw new Error("Asset-update initial-install failure breakdown identity is invalid");
  }
  const wall = record(initial.installWall, "failureContext initialInstall wall");
  requireExactKeys(wall, ["durationMs", "readyAtMs", "startedAtMs"], "initialInstall wall");
  const verification = record(
    initial.finalVerificationObservation,
    "failureContext finalVerificationObservation",
  );
  requireExactKeys(
    verification,
    ["firstObservedCompleteAtMs", "firstObservedVerifyingAtMs", "observedSpanMs", "pollIntervalMs"],
    "failureContext finalVerificationObservation",
  );
  const network = record(initial.network, "failureContext initialInstall network");
  const networkKeys = [
    "activeIntervalUnionMs",
    "controlBodyBytes",
    "controlRequestCount",
    "resourceBodyBytes",
    "resourceCount",
    "resourceRequestCount",
    "source",
    "workerSource",
  ];
  requireExactKeys(network, networkKeys, "failureContext initialInstall network");
  if (
    !finite(wall.startedAtMs) ||
    !finite(wall.readyAtMs) ||
    !finite(wall.durationMs) ||
    wall.readyAtMs < wall.startedAtMs ||
    wall.durationMs !== wall.readyAtMs - wall.startedAtMs ||
    verification.pollIntervalMs !== FINAL_VERIFICATION_POLL_INTERVAL_MS ||
    !finite(verification.firstObservedVerifyingAtMs) ||
    !finite(verification.firstObservedCompleteAtMs) ||
    !finite(verification.observedSpanMs) ||
    verification.firstObservedVerifyingAtMs < wall.startedAtMs ||
    verification.firstObservedVerifyingAtMs > wall.readyAtMs ||
    verification.firstObservedCompleteAtMs < verification.firstObservedVerifyingAtMs ||
    verification.firstObservedCompleteAtMs >
      wall.readyAtMs + FINAL_VERIFICATION_POST_READY_TIMEOUT_MS ||
    verification.observedSpanMs !==
      verification.firstObservedCompleteAtMs - verification.firstObservedVerifyingAtMs ||
    network.source !== "cdp-installer-worker-network@1" ||
    typeof network.workerSource !== "string" ||
    !/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/.test(network.workerSource) ||
    network.controlRequestCount !== 2 ||
    networkKeys
      .filter((key) => !["activeIntervalUnionMs", "source", "workerSource"].includes(key))
      .some((key) => !nonnegativeSafeInteger(network[key])) ||
    !finite(network.activeIntervalUnionMs) ||
    network.activeIntervalUnionMs < 0 ||
    !finite(initial.networkIdleLocalCriticalPathMs) ||
    initial.networkIdleLocalCriticalPathMs < 0 ||
    initial.networkIdleLocalCriticalPathMs !==
      (wall.durationMs as number) - (network.activeIntervalUnionMs as number)
  ) {
    throw new Error("Asset-update initial-install failure breakdown is malformed");
  }
}

function digestFromPartial(input: unknown, kind: "artifact" | "release"): string {
  const result = record(input, "partial result");
  const release = record(result.postRelease, "partial post release");
  const value = kind === "artifact" ? release.artifactDigest : release.releaseDigest;
  if (typeof value !== "string") throw new Error("Partial result post identity is unavailable");
  return value;
}

function decodeBase64(value: unknown, label: string): Buffer {
  if (typeof value !== "string" || value === "" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`${label} bytes are not canonical base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value)
    throw new Error(`${label} bytes are not canonical base64`);
  return bytes;
}

function parseJsonObject(bytes: Uint8Array, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (error: unknown) {
    throw new Error(`${label} is not exact UTF-8 JSON`, { cause: error });
  }
  return record(parsed, label);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Asset-update ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort(compareCodepoints);
  const sortedExpected = [...expected].sort(compareCodepoints);
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error(`Asset-update ${label} has unsupported or missing keys`);
  }
}

function requireDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`Asset-update ${label} is not a lower-case SHA-256`);
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function validIso(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  return assetUpdateJsonEqual(left, right);
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodepoints(left, right))
      .map(([key, item]) => [key, canonicalJsonValue(item)]),
  );
}

function compareCodepoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
