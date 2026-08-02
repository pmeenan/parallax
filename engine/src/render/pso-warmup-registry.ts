import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  idlePsoWarmupTelemetrySnapshot,
  incompatibilityFailure,
  isPsoWarmupFailureError,
  type PsoWarmupFailure,
  type PsoWarmupFailureError,
  type PsoWarmupTelemetrySnapshot,
  type PsoWarmupTraceBundle,
  type PsoWarmupTraceBundleReady,
  parsePsoWarmupTraceBundle,
  psoWarmupFailureError,
  sanitizePsoWarmupFailureDetail,
} from "./pso-warmup-contract";

export interface PsoWarmupRegistry {
  finish(): Promise<void>;
  request(entryId: string, stateDigest: string, compile: () => void | Promise<void>): Promise<void>;
  requestObserved(entryId: string, compile: () => string | Promise<string>): Promise<void>;
  snapshot(): PsoWarmupTelemetrySnapshot;
}

export interface PsoWarmupTelemetryFailureError extends PsoWarmupFailureError {
  readonly telemetry: PsoWarmupTelemetrySnapshot;
}

export interface PsoWarmupRegistryPlatform {
  now(): number;
  yieldToBoot(): Promise<void>;
}

const browserPlatform: PsoWarmupRegistryPlatform = Object.freeze({
  now: () => performance.now(),
  yieldToBoot: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
});
const ENTRY_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const INVALID_ENTRY_SENTINEL_PREFIX = "invalid-entry-sha256-";

export function createPsoWarmupRegistry(
  bundle: PsoWarmupTraceBundle,
  platform: PsoWarmupRegistryPlatform = browserPlatform,
): PsoWarmupRegistry {
  let validatedBundle: PsoWarmupTraceBundleReady;
  try {
    validatedBundle = parsePsoWarmupTraceBundle(bundle);
  } catch (error: unknown) {
    const failure = isPsoWarmupFailureError(error)
      ? error.failure
      : incompatibilityFailure("trace-validation", "PSO warmup trace bundle validation failed");
    throw telemetryFailureError(failure, failedTelemetryFromBundle(bundle, failure), error);
  }
  const entries = new Map(validatedBundle.trace.entries.map((entry) => [entry.id, entry] as const));
  const observations = new Map<
    string,
    Readonly<{
      compileAttemptCount: number;
      compileDurationMs: number;
      compiled: boolean;
      requestCount: number;
    }>
  >();
  const pendingEntries = new Set<string>();
  let telemetry: PsoWarmupTelemetrySnapshot = Object.freeze({
    ...idlePsoWarmupTelemetrySnapshot(),
    buildCompatibilityDigest: validatedBundle.trace.buildCompatibilityDigest,
    releaseDigest: validatedBundle.releaseDigest,
    source: validatedBundle.source,
    state: "warming",
    traceEntryCount: validatedBundle.trace.entries.length,
    traceSha256: validatedBundle.sha256,
  });
  const startedAt = platform.now();
  let finished = false;
  let pending = 0;

  const snapshotEntries = (): PsoWarmupTelemetrySnapshot["entries"] =>
    Object.freeze(
      validatedBundle.trace.entries.flatMap((entry) => {
        const observation = observations.get(entry.id);
        return observation === undefined
          ? []
          : [
              Object.freeze({
                compileAttemptCount: observation.compileAttemptCount,
                compileDurationMs: observation.compileDurationMs,
                compiled: observation.compiled,
                id: entry.id,
                requestCount: observation.requestCount,
                stateDigest: entry.stateDigest,
              }),
            ];
      }),
    );

  const fail = (failure: PsoWarmupFailure, cause?: unknown): never => {
    telemetry = Object.freeze({
      ...telemetry,
      entries: snapshotEntries(),
      failure,
      failureCount: telemetry.failureCount + 1,
      state: "failed",
      totalDurationMs: Math.max(0, platform.now() - startedAt),
    });
    throw telemetryFailureError(failure, telemetry, cause);
  };

  const beginRequest = (entryId: string): NonNullable<ReturnType<typeof entries.get>> => {
    if (finished || telemetry.state !== "warming") {
      return fail(
        incompatibilityFailure(
          "request-validation",
          "PSO warmup request arrived outside the warming phase",
          entryId,
          telemetry.requestedCount + 1,
          traceIndexFor(entries, entryId),
        ),
      );
    }
    const entry = entries.get(entryId);
    if (entry === undefined) {
      return fail(
        Object.freeze({
          class: "unknown-entry",
          detail: "PSO warmup request does not identify a trace entry",
          entryId: boundedEntryId(entryId, entries),
          phase: "request-validation",
          requestIndex: telemetry.requestedCount + 1,
          traceIndex: null,
        }),
      );
    }
    if (pendingEntries.has(entryId)) {
      return fail(
        incompatibilityFailure(
          "request-validation",
          "PSO warmup trace entry already has a pending compile",
          entryId,
          telemetry.requestedCount + 1,
          traceIndexFor(entries, entryId),
        ),
      );
    }
    return entry as NonNullable<typeof entry>;
  };

  const acceptRequest = (): void => {
    telemetry = Object.freeze({
      ...telemetry,
      requestedCount: telemetry.requestedCount + 1,
    });
  };

  const compileMiss = async (
    entryId: string,
    compile: () => void | Promise<void>,
  ): Promise<void> => {
    pending += 1;
    pendingEntries.add(entryId);
    telemetry = Object.freeze({
      ...telemetry,
      cacheMissCount: telemetry.cacheMissCount + 1,
      queueHighWater: Math.max(telemetry.queueHighWater, pending),
      deferredCount: telemetry.deferredCount + 1,
    });
    observations.set(
      entryId,
      Object.freeze({
        compileAttemptCount: 1,
        compileDurationMs: 0,
        compiled: false,
        requestCount: 1,
      }),
    );
    await platform.yieldToBoot();
    const compileStartedAt = platform.now();
    try {
      await compile();
    } catch (error: unknown) {
      pending -= 1;
      pendingEntries.delete(entryId);
      const duration = Math.max(0, platform.now() - compileStartedAt);
      observations.set(
        entryId,
        Object.freeze({
          compileAttemptCount: 1,
          compileDurationMs: duration,
          compiled: false,
          requestCount: 1,
        }),
      );
      telemetry = Object.freeze({
        ...telemetry,
        maximumCompileDurationMs: Math.max(telemetry.maximumCompileDurationMs, duration),
      });
      if (isPsoWarmupFailureError(error)) return fail(error.failure, error);
      return fail(
        Object.freeze({
          class: "compile",
          detail: sanitizePsoWarmupFailureDetail(error),
          entryId,
          phase: "compile",
          requestIndex: telemetry.requestedCount,
          traceIndex: traceIndexFor(entries, entryId) ?? 0,
        }),
        error,
      );
    }
    pending -= 1;
    pendingEntries.delete(entryId);
    const duration = Math.max(0, platform.now() - compileStartedAt);
    observations.set(
      entryId,
      Object.freeze({
        compileAttemptCount: 1,
        compileDurationMs: duration,
        compiled: true,
        requestCount: 1,
      }),
    );
    telemetry = Object.freeze({
      ...telemetry,
      compiledCount: telemetry.compiledCount + 1,
      maximumCompileDurationMs: Math.max(telemetry.maximumCompileDurationMs, duration),
    });
  };

  const recordHit = (entryId: string): void => {
    const prior = observations.get(entryId);
    if (prior === undefined) throw new Error("PSO warmup cache-hit accounting lost its entry");
    observations.set(entryId, Object.freeze({ ...prior, requestCount: prior.requestCount + 1 }));
    telemetry = Object.freeze({
      ...telemetry,
      cacheHitCount: telemetry.cacheHitCount + 1,
    });
  };

  return Object.freeze({
    async finish(): Promise<void> {
      if (finished || telemetry.state === "failed") {
        throw new Error("PSO warmup registry cannot finish twice or after failure");
      }
      const missing = validatedBundle.trace.entries.filter(
        (entry) => observations.get(entry.id)?.compiled !== true,
      );
      if (missing.length !== 0) {
        const missingEntry = missing[0];
        return fail(
          incompatibilityFailure(
            "completion",
            "PSO warmup trace entry was not requested",
            missingEntry?.id ?? null,
            null,
            missingEntry === undefined ? null : validatedBundle.trace.entries.indexOf(missingEntry),
          ),
        );
      }
      finished = true;
      telemetry = Object.freeze({
        ...telemetry,
        entries: snapshotEntries(),
        state: "ready",
        totalDurationMs: Math.max(0, platform.now() - startedAt),
      });
    },
    async request(
      entryId: string,
      stateDigest: string,
      compile: () => void | Promise<void>,
    ): Promise<void> {
      const entry = beginRequest(entryId);
      if (entry.stateDigest !== stateDigest) {
        return fail(
          incompatibilityFailure(
            "request-validation",
            "PSO warmup request state digest is incompatible",
            entryId,
            telemetry.requestedCount + 1,
            traceIndexFor(entries, entryId),
          ),
        );
      }
      acceptRequest();
      const prior = observations.get(entryId);
      if (prior !== undefined) {
        recordHit(entryId);
        return;
      }
      await compileMiss(entryId, compile);
    },
    async requestObserved(entryId: string, compile: () => string | Promise<string>): Promise<void> {
      const entry = beginRequest(entryId);
      acceptRequest();
      if (observations.get(entryId)?.compiled === true) {
        recordHit(entryId);
        return;
      }
      await compileMiss(entryId, async () => {
        const observedStateDigest = await compile();
        if (observedStateDigest !== entry.stateDigest) {
          throw psoWarmupFailureError(
            incompatibilityFailure(
              "request-validation",
              "PSO warmup observed state digest is incompatible",
              entryId,
              telemetry.requestedCount,
              traceIndexFor(entries, entryId),
            ),
          );
        }
      });
    },
    snapshot(): PsoWarmupTelemetrySnapshot {
      return telemetry;
    },
  });
}

export function psoWarmupTelemetryFailureSnapshot(
  error: unknown,
): PsoWarmupTelemetrySnapshot | null {
  if (!isPsoWarmupTelemetryFailureError(error)) return null;
  return error.telemetry;
}

function isPsoWarmupTelemetryFailureError(error: unknown): error is PsoWarmupTelemetryFailureError {
  return (
    isPsoWarmupFailureError(error) &&
    "telemetry" in error &&
    typeof error.telemetry === "object" &&
    error.telemetry !== null
  );
}

function telemetryFailureError(
  failure: PsoWarmupFailure,
  telemetry: PsoWarmupTelemetrySnapshot,
  cause?: unknown,
): PsoWarmupTelemetryFailureError {
  const error = psoWarmupFailureError(failure, cause) as PsoWarmupTelemetryFailureError & {
    telemetry: PsoWarmupTelemetrySnapshot;
  };
  Object.defineProperty(error, "telemetry", {
    configurable: false,
    enumerable: true,
    value: telemetry,
    writable: false,
  });
  return error;
}

function failedTelemetryFromBundle(
  bundle: PsoWarmupTraceBundle,
  failure: PsoWarmupFailure,
): PsoWarmupTelemetrySnapshot {
  const idle = idlePsoWarmupTelemetrySnapshot();
  const sha256 = /^[a-f0-9]{64}$/;
  const installedIdentityValid =
    bundle?.source === "installed-release" &&
    typeof bundle.releaseDigest === "string" &&
    sha256.test(bundle.releaseDigest);
  const embeddedIdentityValid =
    bundle?.source === "privileged-embedded" && bundle.releaseDigest === null;
  return Object.freeze({
    ...idle,
    buildCompatibilityDigest:
      typeof bundle?.trace?.buildCompatibilityDigest === "string" &&
      sha256.test(bundle.trace.buildCompatibilityDigest)
        ? bundle.trace.buildCompatibilityDigest
        : null,
    failure,
    failureCount: 1,
    releaseDigest: installedIdentityValid ? bundle.releaseDigest : null,
    source: installedIdentityValid || embeddedIdentityValid ? bundle.source : null,
    state: "failed",
    traceEntryCount:
      Array.isArray(bundle?.trace?.entries) && Number.isSafeInteger(bundle.trace.entries.length)
        ? bundle.trace.entries.length
        : 0,
    traceSha256:
      typeof bundle?.sha256 === "string" && sha256.test(bundle.sha256) ? bundle.sha256 : null,
  });
}

function traceIndexFor(entries: ReadonlyMap<string, unknown>, entryId: string): number | null {
  const index = [...entries.keys()].indexOf(entryId);
  return index < 0 ? null : index;
}

function boundedEntryId(entryId: string, entries: ReadonlyMap<string, unknown>): string {
  if (ENTRY_ID.test(entryId)) return entryId;
  const sentinel = `${INVALID_ENTRY_SENTINEL_PREFIX}${bytesToHex(
    sha256(new TextEncoder().encode(entryId)),
  )}`;
  if (!ENTRY_ID.test(sentinel) || entries.has(sentinel)) {
    throw new Error("PSO warmup invalid-entry sentinel collides with the trace registry");
  }
  return sentinel;
}
