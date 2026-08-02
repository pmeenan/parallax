import type { PsoWarmupTelemetrySnapshot, RenderTelemetrySnapshot } from "@parallax/engine";
import {
  type PsoWarmupTraceIdentity,
  resolveExpectedPsoWarmupTraceIdentity,
} from "./pso-warmup-trace.js";

const SHA256 = /^[a-f0-9]{64}$/;
const ENTRY_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const KEYS = Object.freeze([
  "buildCompatibilityDigest",
  "cacheHitCount",
  "cacheMissCount",
  "compiledCount",
  "contract",
  "deferredCount",
  "entries",
  "failure",
  "failureCount",
  "maximumCompileDurationMs",
  "queueHighWater",
  "releaseDigest",
  "requestedCount",
  "schemaVersion",
  "source",
  "state",
  "totalDurationMs",
  "traceEntryCount",
  "traceSha256",
]);
const ENTRY_KEYS = Object.freeze([
  "compileAttemptCount",
  "compileDurationMs",
  "compiled",
  "id",
  "requestCount",
  "stateDigest",
]);
const FAILURE_KEYS = Object.freeze([
  "class",
  "detail",
  "entryId",
  "phase",
  "requestIndex",
  "traceIndex",
]);

export function validatePsoWarmupTelemetrySnapshot(
  input: PsoWarmupTelemetrySnapshot,
): PsoWarmupTelemetrySnapshot {
  exact(input, KEYS, "PSO warmup telemetry");
  if (
    input.contract !== "pso-warmup-telemetry@1" ||
    input.schemaVersion !== 1 ||
    !["idle", "warming", "ready", "failed"].includes(input.state) ||
    (input.source !== null &&
      input.source !== "installed-release" &&
      input.source !== "privileged-embedded")
  ) {
    throw new Error("PSO warmup telemetry has unsupported schema, state, or source");
  }
  for (const value of [
    input.cacheHitCount,
    input.cacheMissCount,
    input.compiledCount,
    input.deferredCount,
    input.failureCount,
    input.queueHighWater,
    input.requestedCount,
    input.traceEntryCount,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("PSO warmup telemetry has an invalid counter");
    }
  }
  for (const value of [input.maximumCompileDurationMs, input.totalDurationMs]) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("PSO warmup telemetry has an invalid duration");
    }
  }
  const ids = new Set<string>();
  let entryRequestCount = 0;
  let entryAttemptCount = 0;
  let compiledEntryCount = 0;
  let maximumAttemptDurationMs = 0;
  for (const entry of input.entries) {
    exact(entry, ENTRY_KEYS, "PSO warmup telemetry entry");
    if (
      !ENTRY_ID.test(entry.id) ||
      ids.has(entry.id) ||
      !SHA256.test(entry.stateDigest) ||
      !Number.isSafeInteger(entry.compileAttemptCount) ||
      entry.compileAttemptCount !== 1 ||
      typeof entry.compiled !== "boolean" ||
      !Number.isSafeInteger(entry.requestCount) ||
      entry.requestCount <= 0 ||
      !Number.isFinite(entry.compileDurationMs) ||
      entry.compileDurationMs < 0
    ) {
      throw new Error("PSO warmup telemetry entry is invalid");
    }
    ids.add(entry.id);
    entryRequestCount += entry.requestCount;
    entryAttemptCount += entry.compileAttemptCount;
    compiledEntryCount += entry.compiled ? 1 : 0;
    maximumAttemptDurationMs = Math.max(maximumAttemptDurationMs, entry.compileDurationMs);
  }
  if (input.failure !== null) validateFailure(input.failure);
  if (
    (input.failure === null) !== (input.state !== "failed") ||
    input.failureCount !== (input.state === "failed" ? 1 : 0) ||
    input.requestedCount !== input.cacheHitCount + input.cacheMissCount ||
    input.deferredCount !== input.cacheMissCount ||
    input.compiledCount > input.cacheMissCount ||
    input.compiledCount !== compiledEntryCount ||
    input.cacheMissCount !== entryAttemptCount ||
    input.requestedCount !== entryRequestCount ||
    input.maximumCompileDurationMs !== maximumAttemptDurationMs ||
    input.queueHighWater > input.traceEntryCount ||
    (input.cacheMissCount === 0 ? input.queueHighWater !== 0 : input.queueHighWater <= 0) ||
    (input.source === "installed-release") !== (input.releaseDigest !== null) ||
    (input.releaseDigest !== null && !SHA256.test(input.releaseDigest)) ||
    (input.traceSha256 !== null && !SHA256.test(input.traceSha256)) ||
    (input.buildCompatibilityDigest !== null && !SHA256.test(input.buildCompatibilityDigest))
  ) {
    throw new Error("PSO warmup telemetry relationships are inconsistent");
  }
  if (input.state === "failed" && input.failure !== null) {
    validateFailureRelationships(input, input.failure);
  }
  if (
    input.state === "idle" &&
    (input.source !== null ||
      input.traceSha256 !== null ||
      input.buildCompatibilityDigest !== null ||
      input.releaseDigest !== null ||
      input.requestedCount !== 0 ||
      input.entries.length !== 0 ||
      input.failure !== null)
  ) {
    throw new Error("Idle PSO warmup telemetry claims trace activity");
  }
  if (
    input.state === "ready" &&
    (input.traceEntryCount <= 0 ||
      input.compiledCount !== input.traceEntryCount ||
      input.compiledCount !== input.cacheMissCount ||
      input.entries.some((entry) => !entry.compiled) ||
      input.source === null ||
      input.traceSha256 === null ||
      input.buildCompatibilityDigest === null ||
      input.failureCount !== 0)
  ) {
    throw new Error("Ready PSO warmup telemetry is incomplete");
  }
  return input;
}

function validateFailureRelationships(
  input: PsoWarmupTelemetrySnapshot,
  failure: NonNullable<PsoWarmupTelemetrySnapshot["failure"]>,
): void {
  if (failure.class === "parse") {
    if (
      input.requestedCount !== 0 ||
      input.cacheMissCount !== 0 ||
      input.compiledCount !== 0 ||
      input.entries.length !== 0
    ) {
      throw new Error("PSO warmup parse failure contradicts replay counters");
    }
    return;
  }
  if (failure.class === "unknown-entry") {
    if (failure.requestIndex !== input.requestedCount + 1) {
      throw new Error("PSO warmup unknown-entry failure position is inconsistent");
    }
    return;
  }
  if (failure.class === "compile") {
    const entry = input.entries.find((candidate) => candidate.id === failure.entryId);
    if (
      failure.requestIndex > input.requestedCount ||
      failure.traceIndex >= input.traceEntryCount ||
      entry === undefined ||
      entry.compiled ||
      input.compiledCount >= input.cacheMissCount
    ) {
      throw new Error("PSO warmup compile failure contradicts replay evidence");
    }
    return;
  }
  if (
    failure.phase === "request-validation" &&
    failure.requestIndex !== null &&
    failure.requestIndex > input.requestedCount + 1
  ) {
    throw new Error("PSO warmup incompatibility failure position is inconsistent");
  }
  if (failure.traceIndex !== null && failure.traceIndex >= input.traceEntryCount) {
    throw new Error("PSO warmup incompatibility trace position is inconsistent");
  }
}

export function validatePsoWarmupRetainedFailure(
  input: unknown,
): Readonly<{ snapshot: PsoWarmupTelemetrySnapshot; workerGeneration: number }> {
  const record = exactRecord(
    input,
    ["snapshot", "workerGeneration"],
    "Retained PSO warmup failure",
  );
  if (!Number.isSafeInteger(record.workerGeneration) || (record.workerGeneration as number) <= 0) {
    throw new Error("Retained PSO warmup failure has an invalid worker generation");
  }
  const snapshot = validatePsoWarmupTelemetrySnapshot(
    record.snapshot as PsoWarmupTelemetrySnapshot,
  );
  if (snapshot.state !== "failed" || snapshot.failure === null) {
    throw new Error("Retained PSO warmup evidence is not a failed snapshot");
  }
  return input as Readonly<{
    snapshot: PsoWarmupTelemetrySnapshot;
    workerGeneration: number;
  }>;
}

export function validatePsoWarmupRenderTelemetryRelationship(
  input: Pick<
    RenderTelemetrySnapshot,
    "psoWarmup" | "recovery" | "retainedPsoWarmupFailure" | "state"
  >,
): void {
  const current = validatePsoWarmupTelemetrySnapshot(input.psoWarmup);
  const retained =
    input.retainedPsoWarmupFailure === null
      ? null
      : validatePsoWarmupRetainedFailure(input.retainedPsoWarmupFailure);
  const recovery = input.recovery;

  if (
    !Number.isSafeInteger(recovery.workerGeneration) ||
    recovery.workerGeneration < 0 ||
    !Number.isSafeInteger(recovery.restartCount) ||
    recovery.restartCount < 0 ||
    recovery.restartCount > recovery.maximumAutomaticRestarts
  ) {
    throw new Error("Render recovery telemetry has an invalid generation or restart count");
  }
  if (
    (input.state === "recovering" && recovery.state !== "restarting") ||
    (input.state === "ready" &&
      recovery.state !== "not-needed" &&
      recovery.state !== "recovered") ||
    (input.state === "failed" && recovery.state !== "exhausted")
  ) {
    throw new Error("Render state contradicts its recovery state");
  }
  if (retained === null) return;

  if (
    retained.workerGeneration >= recovery.workerGeneration ||
    recovery.restartCount === 0 ||
    recovery.state === "not-needed" ||
    input.state === "idle" ||
    input.state === "starting"
  ) {
    throw new Error("Retained PSO warmup failure is not from a positive prior recovery generation");
  }
  if (
    (input.state === "recovering" && current.state !== "idle") ||
    (input.state === "ready" && (recovery.state !== "recovered" || current.state !== "ready")) ||
    (input.state === "failed" && recovery.state !== "exhausted")
  ) {
    throw new Error("Retained PSO warmup failure contradicts the current render generation");
  }
}

export function validateExactPsoWarmupTelemetrySnapshot(
  input: PsoWarmupTelemetrySnapshot,
  expected: PsoWarmupTraceIdentity = resolveExpectedPsoWarmupTraceIdentity(),
): PsoWarmupTelemetrySnapshot {
  const validated = validatePsoWarmupTelemetrySnapshot(input);
  const entry = validated.entries[0];
  if (
    validated.buildCompatibilityDigest !== expected.buildCompatibilityDigest ||
    validated.traceSha256 !== expected.sha256 ||
    validated.traceEntryCount !== 1 ||
    validated.entries.length !== 1 ||
    entry?.id !== expected.entry.id ||
    entry.stateDigest !== expected.entry.stateDigest
  ) {
    throw new Error("PSO warmup telemetry does not match the exact trace identity");
  }
  return validated;
}

function exact(input: unknown, keys: readonly string[], label: string): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(input).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has unsupported or missing keys`);
  }
}

function exactRecord(
  input: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  exact(input, keys, label);
  return input as Record<string, unknown>;
}

function validateFailure(failure: NonNullable<PsoWarmupTelemetrySnapshot["failure"]>): void {
  exact(failure, FAILURE_KEYS, "PSO warmup failure");
  if (
    typeof failure.detail !== "string" ||
    failure.detail.length === 0 ||
    failure.detail.length > 240 ||
    containsControlCharacter(failure.detail) ||
    /https?:\/\//i.test(failure.detail) ||
    /\b[A-Za-z]:[\\/]/.test(failure.detail) ||
    /(?:^|\s)\/(?:[^/\s]+\/)*[^/\s]*/.test(failure.detail)
  ) {
    throw new Error("PSO warmup failure detail is not bounded and sanitized");
  }
  switch (failure.class) {
    case "parse":
      if (
        failure.phase !== "trace-parse" ||
        failure.entryId !== null ||
        failure.requestIndex !== null ||
        failure.traceIndex !== null
      ) {
        throw new Error("PSO warmup parse failure fields are contradictory");
      }
      return;
    case "incompatibility":
      if (
        !["trace-load", "trace-validation", "request-validation", "completion"].includes(
          failure.phase,
        ) ||
        (failure.entryId !== null && !ENTRY_ID.test(failure.entryId)) ||
        !nullablePositiveInteger(failure.requestIndex) ||
        !nullableNonNegativeInteger(failure.traceIndex)
      ) {
        throw new Error("PSO warmup incompatibility failure fields are contradictory");
      }
      return;
    case "unknown-entry":
      if (
        failure.phase !== "request-validation" ||
        !ENTRY_ID.test(failure.entryId) ||
        !positiveInteger(failure.requestIndex) ||
        failure.traceIndex !== null
      ) {
        throw new Error("PSO warmup unknown-entry failure fields are contradictory");
      }
      return;
    case "compile":
      if (
        failure.phase !== "compile" ||
        !ENTRY_ID.test(failure.entryId) ||
        !positiveInteger(failure.requestIndex) ||
        !nonNegativeInteger(failure.traceIndex)
      ) {
        throw new Error("PSO warmup compile failure fields are contradictory");
      }
      return;
  }
  throw new Error("PSO warmup failure class is unsupported");
}

function containsControlCharacter(input: string): boolean {
  return Array.from(input).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
  });
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function nullablePositiveInteger(value: unknown): boolean {
  return value === null || positiveInteger(value);
}

function nullableNonNegativeInteger(value: unknown): boolean {
  return value === null || nonNegativeInteger(value);
}
