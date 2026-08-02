import {
  ASSET_UPDATE_V8_CONTRACT,
  ASSET_UPDATE_V8_SCHEMA_VERSION,
  type AssetUpdateFailureContext,
  type AssetUpdateFailureInitialInstall,
  type AssetUpdateLifecycleResult,
  type AssetUpdatePartialValidationRejection,
  type AssetUpdateRunAuthority,
  type AssetUpdateV8Evidence,
  validateAssetUpdateInitialInstallBreakdown,
  validateAssetUpdateRunAuthority,
  validateAssetUpdateV8Evidence,
} from "./asset-update-v8-evidence.js";
import type { AssetUpdateV8FailurePhase } from "./asset-update-v8-failure-phase.js";
import {
  sanitizeAssetUpdateDiagnostic,
  sanitizedAssetUpdateErrorName,
} from "./asset-update-v8-sanitization.js";

export type { AssetUpdateV8FailurePhase } from "./asset-update-v8-failure-phase.js";

export function createAssetUpdateV8FailedEvidence(input: {
  readonly authority: AssetUpdateRunAuthority | null;
  readonly companionPath: string;
  readonly completedAt?: string;
  readonly error: unknown;
  readonly partialResult: AssetUpdateLifecycleResult | null;
  readonly phase: AssetUpdateV8FailurePhase;
  readonly postValidationPerformed: boolean;
  readonly reservationId: string;
  readonly startedAt: string;
}): AssetUpdateV8Evidence {
  const error = input.error instanceof Error ? input.error : new Error(String(input.error));
  const failure = Object.freeze({
    message: sanitizeAssetUpdateDiagnostic(error),
    name: sanitizedAssetUpdateErrorName(error),
    phase: input.phase,
  });
  const context = createAssetUpdateFailureContext(input.partialResult);
  const completedAt = input.completedAt ?? new Date().toISOString();
  const candidate: AssetUpdateV8Evidence = Object.freeze({
    authority: input.authority,
    companion: Object.freeze({ path: input.companionPath, state: "failed" as const }),
    completedAt,
    contract: ASSET_UPDATE_V8_CONTRACT,
    failure,
    failureContext: context,
    partialResult: input.partialResult,
    postValidation: Object.freeze({
      authority: input.postValidationPerformed ? input.authority : null,
      passed: false,
      performed: input.postValidationPerformed,
      ready: null,
      target: null,
    }),
    resultOwnership: Object.freeze({
      publicationState: "failed" as const,
      reservationId: input.reservationId,
    }),
    schemaVersion: ASSET_UPDATE_V8_SCHEMA_VERSION,
    startedAt: input.startedAt,
    state: "failed" as const,
  });
  try {
    validateAssetUpdateV8Evidence(candidate);
    return candidate;
  } catch (validationError: unknown) {
    const validationCause =
      validationError instanceof Error ? validationError : new Error(String(validationError));
    const rejection = Object.freeze({
      message: sanitizeAssetUpdateDiagnostic(validationCause),
      name: sanitizedAssetUpdateErrorName(validationCause),
      state: "rejected" as const,
    });
    const fallbackContext = createAssetUpdateFailureContext(input.partialResult, {
      initialInstall: independentlyValidatedInitialInstall(input.partialResult),
      partialValidation: rejection,
    });
    const fallbackAuthority = independentlyValidatedAuthority(input.authority);
    const fallback: AssetUpdateV8Evidence = Object.freeze({
      authority: fallbackAuthority,
      companion: candidate.companion,
      completedAt,
      contract: ASSET_UPDATE_V8_CONTRACT,
      failure,
      failureContext: fallbackContext,
      partialResult: null,
      postValidation: Object.freeze({
        authority: null,
        passed: false,
        performed: false,
        ready: null,
        target: null,
      }),
      resultOwnership: candidate.resultOwnership,
      schemaVersion: ASSET_UPDATE_V8_SCHEMA_VERSION,
      startedAt: input.startedAt,
      state: "failed",
    });
    try {
      validateAssetUpdateV8Evidence(fallback);
      return fallback;
    } catch {
      const minimal: AssetUpdateV8Evidence = Object.freeze({
        ...fallback,
        failure: Object.freeze({
          ...failure,
          message: sanitizeAssetUpdateDiagnostic(failure.message),
        }),
        failureContext: Object.freeze({
          initialInstall: null,
          journal: null,
          partialValidation: rejection,
          state: "rejected-lifecycle-snapshot" as const,
          transfer: null,
        }),
      });
      validateAssetUpdateV8Evidence(minimal);
      return minimal;
    }
  }
}

export function createAssetUpdateFailureContext(
  partialResult: AssetUpdateLifecycleResult | null,
  validation: Readonly<{
    readonly initialInstall: AssetUpdateFailureInitialInstall | null;
    readonly partialValidation: Readonly<AssetUpdatePartialValidationRejection>;
  }> | null = null,
): AssetUpdateFailureContext | null {
  if (partialResult === null) return failureContextWithoutSnapshot(validation);
  const publication = asRecord(partialResult).publication;
  if (!isRecord(publication)) return failureContextWithoutSnapshot(validation);
  const transferInput = publication.postTransfer;
  const journalInput = publication.updateServerJournal;
  const transfer = isRecord(transferInput)
    ? Object.freeze({
        activeReleaseDigest:
          typeof transferInput.activeReleaseDigest === "string" &&
          /^[a-f0-9]{64}$/.test(transferInput.activeReleaseDigest)
            ? transferInput.activeReleaseDigest
            : null,
        checkpointedBytes: nonnegativeIntegerOrNull(transferInput.checkpointedBytes),
        completedResourceCount: nonnegativeIntegerOrNull(transferInput.completedResourceCount),
        downloadedBytes: nonnegativeIntegerOrNull(transferInput.downloadedBytes),
        hashedBytes: nonnegativeIntegerOrNull(transferInput.hashedBytes),
        httpRequestCount: nonnegativeIntegerOrNull(transferInput.httpRequestCount),
        plannedDownloadBytes: nonnegativeIntegerOrNull(transferInput.plannedDownloadBytes),
        rangeRequestCount: nonnegativeIntegerOrNull(transferInput.rangeRequestCount),
        resourceCount: nonnegativeIntegerOrNull(transferInput.resourceCount),
        resumedBytes: nonnegativeIntegerOrNull(transferInput.resumedBytes),
        reusedBytes: nonnegativeIntegerOrNull(transferInput.reusedBytes),
        totalBytes: nonnegativeIntegerOrNull(transferInput.totalBytes),
        verifiedBytes: nonnegativeIntegerOrNull(transferInput.verifiedBytes),
      })
    : null;
  let journal: AssetUpdateFailureContext["journal"] = null;
  if (isRecord(journalInput) && Array.isArray(journalInput.entries)) {
    const retainedEntries = journalInput.entries.slice(0, 256).map((candidate) => {
      const entry = isRecord(candidate) ? candidate : {};
      return Object.freeze({
        bodyBytes: nonnegativeIntegerOrNull(entry.bodyBytes),
        path:
          typeof entry.path === "string" &&
          entry.path.length <= 512 &&
          /^\/[A-Za-z0-9._/-]*$/.test(entry.path)
            ? entry.path
            : "/invalid",
        range:
          typeof entry.range === "string" &&
          entry.range.length <= 128 &&
          /^bytes=[0-9]+-(?:[0-9]+)?$/.test(entry.range)
            ? entry.range
            : null,
        sequence: nonnegativeIntegerOrNull(entry.sequence),
        status: nonnegativeIntegerOrNull(entry.status),
      });
    });
    const sourceOverflowed =
      typeof journalInput.overflowed === "boolean" ? journalInput.overflowed : null;
    journal = Object.freeze({
      entries: Object.freeze(retainedEntries),
      observedEntryCount: journalInput.entries.length,
      retainedEntryCount: retainedEntries.length,
      sourceMaximumEntries: nonnegativeIntegerOrNull(journalInput.maximumEntries),
      sourceOverflowed,
      truncated: sourceOverflowed === true || journalInput.entries.length > retainedEntries.length,
    });
  }
  if (transfer === null && journal === null && validation === null) return null;
  return validation === null
    ? Object.freeze({
        journal,
        state: "unvalidated-lifecycle-snapshot",
        transfer,
      })
    : Object.freeze({
        initialInstall: validation.initialInstall,
        journal,
        partialValidation: validation.partialValidation,
        state: "rejected-lifecycle-snapshot",
        transfer,
      });
}

function failureContextWithoutSnapshot(
  validation: Readonly<{
    readonly initialInstall: AssetUpdateFailureInitialInstall | null;
    readonly partialValidation: Readonly<AssetUpdatePartialValidationRejection>;
  }> | null,
): AssetUpdateFailureContext | null {
  return validation === null
    ? null
    : Object.freeze({
        initialInstall: validation.initialInstall,
        journal: null,
        partialValidation: validation.partialValidation,
        state: "rejected-lifecycle-snapshot",
        transfer: null,
      });
}

function independentlyValidatedAuthority(
  authority: AssetUpdateRunAuthority | null,
): AssetUpdateRunAuthority | null {
  if (authority === null) return null;
  try {
    return validateAssetUpdateRunAuthority(authority);
  } catch {
    return null;
  }
}

function independentlyValidatedInitialInstall(
  partialResult: AssetUpdateLifecycleResult | null,
): AssetUpdateFailureInitialInstall | null {
  if (partialResult === null) return null;
  try {
    return validateAssetUpdateInitialInstallBreakdown(partialResult);
  } catch {
    return null;
  }
}

function nonnegativeIntegerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function asRecord(value: object): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
