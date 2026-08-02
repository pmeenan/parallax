export const OFFLINE_SHELL_GENERATION_SCHEMA_VERSION = 1;
export const OFFLINE_SHELL_SAVE_SCHEMA_VERSION = 1;
export const OFFLINE_SHELL_SERVICE_WORKER_PATH = "service-worker.js";
export const OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION = 1;
export const OFFLINE_SHELL_TELEMETRY_SCHEMA_VERSION = 2;
export const OFFLINE_SHELL_LOCK_NAME = "parallax-offline-shell-v1";
export const OFFLINE_SHELL_PREPARE_LOCK_NAME = "parallax-offline-shell-prepare-v1";

export type OfflineShellState =
  | "active"
  | "failed"
  | "idle"
  | "preparing"
  | "rolling-back"
  | "unavailable"
  | "verifying";

export type OfflineShellFailureCode =
  | "shell-contract"
  | "shell-release-mismatch"
  | "shell-unavailable";

export interface OfflineShellResource {
  readonly bytes: number;
  readonly mimeType: string;
  readonly path: string;
  readonly sha256: string;
}

export interface OfflineShellGeneration {
  readonly appEntrypoint: Readonly<{
    readonly bytes: number;
    readonly path: string;
    readonly sha256: string;
  }>;
  readonly artifactDigest: string;
  readonly buildManifestSchemaVersion: number;
  readonly engineArtifact: Readonly<{
    readonly bytes: number;
    readonly path: string;
    readonly sha256: string;
  }>;
  readonly generationId: string;
  readonly installManifestSchemaVersion: number;
  readonly releaseDigest: string;
  readonly resources: readonly OfflineShellResource[];
  readonly saveSchemaVersion: number;
  readonly schemaVersion: typeof OFFLINE_SHELL_GENERATION_SCHEMA_VERSION;
  readonly serviceWorker: Readonly<{
    readonly bytes: number;
    readonly path: typeof OFFLINE_SHELL_SERVICE_WORKER_PATH;
    readonly sha256: string;
  }>;
}

export interface OfflineShellAdmission {
  readonly generationId: string;
  readonly releaseDigest: string;
}

export interface OfflineShellTelemetrySnapshot {
  readonly activateCount: number;
  readonly activeArtifactDigest: string | null;
  readonly activeGenerationId: string | null;
  readonly activeReleaseDigest: string | null;
  readonly cacheHitCount: number;
  readonly cacheMissCount: number;
  readonly candidateGenerationId: string | null;
  readonly failureCode: OfflineShellFailureCode | null;
  readonly failureCount: number;
  readonly failureMessage: string | null;
  readonly mixedGenerationCount: number;
  readonly prepareCount: number;
  readonly previousGenerationId: string | null;
  readonly rollbackCount: number;
  readonly schemaVersion: typeof OFFLINE_SHELL_TELEMETRY_SCHEMA_VERSION;
  readonly state: OfflineShellState;
  readonly verifiedBytes: number;
  readonly verifyCount: number;
  readonly verifyDurationMs: number;
  readonly verifyHighWaterMs: number;
}

export interface OfflineShellStoreRecord {
  readonly active: OfflineShellGeneration | null;
  readonly candidate: OfflineShellGeneration | null;
  readonly previous: OfflineShellGeneration | null;
  readonly schemaVersion: 1;
  readonly telemetry: OfflineShellTelemetrySnapshot;
}

export type OfflineShellWorkerRequest =
  | Readonly<{
      admission: OfflineShellAdmission;
      kind: "admit";
      protocolVersion: typeof OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION;
      requestId: number;
    }>
  | Readonly<{
      kind: "prepare";
      protocolVersion: typeof OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION;
      requestId: number;
      shellEntrypointPath: string;
    }>
  | Readonly<{
      kind: "snapshot";
      protocolVersion: typeof OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION;
      requestId: number;
    }>;

export type OfflineShellWorkerResponse =
  | Readonly<{
      admission: OfflineShellAdmission;
      kind: "admitted";
      protocolVersion: typeof OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION;
      requestId: number;
      telemetry: OfflineShellTelemetrySnapshot;
    }>
  | Readonly<{
      code: OfflineShellFailureCode;
      kind: "failure";
      message: string;
      protocolVersion: typeof OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION;
      requestId: number;
      telemetry: OfflineShellTelemetrySnapshot;
    }>
  | Readonly<{
      generation: OfflineShellGeneration;
      kind: "prepared";
      protocolVersion: typeof OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION;
      requestId: number;
      telemetry: OfflineShellTelemetrySnapshot;
    }>
  | Readonly<{
      kind: "snapshot";
      protocolVersion: typeof OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION;
      requestId: number;
      telemetry: OfflineShellTelemetrySnapshot;
    }>;

export type OfflineShellWorkerNotification = Readonly<{
  kind: "selection-changed";
  protocolVersion: typeof OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION;
  telemetry: OfflineShellTelemetrySnapshot;
}>;

const SHA256 = /^[a-f0-9]{64}$/;

export function unavailableOfflineShellTelemetrySnapshot(): OfflineShellTelemetrySnapshot {
  return freezeTelemetry({
    ...emptyTelemetry(),
    state: "unavailable",
  });
}

export function idleOfflineShellTelemetrySnapshot(): OfflineShellTelemetrySnapshot {
  return freezeTelemetry(emptyTelemetry());
}

export function failedOfflineShellTelemetrySnapshot(
  code: OfflineShellFailureCode,
  diagnostic: string,
): OfflineShellTelemetrySnapshot {
  return freezeTelemetry({
    ...emptyTelemetry(),
    failureCode: code,
    failureCount: 1,
    failureMessage: diagnostic,
    state: "failed",
  });
}

export function parseOfflineShellWorkerRequest(input: unknown): OfflineShellWorkerRequest {
  const value = record(input, "offline-shell request");
  if (value.kind === "admit") {
    exactKeys(value, ["admission", "kind", "protocolVersion", "requestId"]);
    commonMessage(value);
    parseOfflineShellAdmission(value.admission);
    return Object.freeze(value) as unknown as OfflineShellWorkerRequest;
  }
  if (value.kind === "prepare") {
    exactKeys(value, ["kind", "protocolVersion", "requestId", "shellEntrypointPath"]);
    commonMessage(value);
    if (typeof value.shellEntrypointPath !== "string" || !safePath(value.shellEntrypointPath)) {
      throw new Error("Offline-shell prepare request has an invalid shell entrypoint");
    }
    return Object.freeze(value) as unknown as OfflineShellWorkerRequest;
  }
  if (value.kind === "snapshot") {
    exactKeys(value, ["kind", "protocolVersion", "requestId"]);
    commonMessage(value);
    return Object.freeze(value) as unknown as OfflineShellWorkerRequest;
  }
  throw new Error("Offline-shell request has an unsupported kind");
}

export function parseOfflineShellWorkerResponse(input: unknown): OfflineShellWorkerResponse {
  const value = record(input, "offline-shell response");
  if (value.kind === "admitted") {
    exactKeys(value, ["admission", "kind", "protocolVersion", "requestId", "telemetry"]);
    commonMessage(value);
    parseOfflineShellAdmission(value.admission);
    parseOfflineShellTelemetry(value.telemetry);
    return Object.freeze(value) as unknown as OfflineShellWorkerResponse;
  }
  if (value.kind === "failure") {
    exactKeys(value, ["code", "kind", "message", "protocolVersion", "requestId", "telemetry"]);
    commonMessage(value);
    if (
      (value.code !== "shell-contract" &&
        value.code !== "shell-release-mismatch" &&
        value.code !== "shell-unavailable") ||
      typeof value.message !== "string" ||
      value.message === ""
    ) {
      throw new Error("Offline-shell failure response is invalid");
    }
    const failureTelemetry = parseOfflineShellTelemetry(value.telemetry);
    if (
      failureTelemetry.state !== "failed" ||
      failureTelemetry.failureCode !== value.code ||
      failureTelemetry.failureMessage !== value.message
    ) {
      throw new Error("Offline-shell failure response does not match its telemetry");
    }
    return Object.freeze(value) as unknown as OfflineShellWorkerResponse;
  }
  if (value.kind === "prepared") {
    exactKeys(value, ["generation", "kind", "protocolVersion", "requestId", "telemetry"]);
    commonMessage(value);
    parseOfflineShellGeneration(value.generation);
    parseOfflineShellTelemetry(value.telemetry);
    return Object.freeze(value) as unknown as OfflineShellWorkerResponse;
  }
  if (value.kind === "snapshot") {
    exactKeys(value, ["kind", "protocolVersion", "requestId", "telemetry"]);
    commonMessage(value);
    parseOfflineShellTelemetry(value.telemetry);
    return Object.freeze(value) as unknown as OfflineShellWorkerResponse;
  }
  throw new Error("Offline-shell response has an unsupported kind");
}

export function parseOfflineShellWorkerNotification(
  input: unknown,
): OfflineShellWorkerNotification {
  const value = record(input, "offline-shell notification");
  exactKeys(value, ["kind", "protocolVersion", "telemetry"]);
  if (
    value.kind !== "selection-changed" ||
    value.protocolVersion !== OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION
  ) {
    throw new Error("Offline-shell notification has an unsupported kind or version");
  }
  parseOfflineShellTelemetry(value.telemetry);
  return Object.freeze(value) as unknown as OfflineShellWorkerNotification;
}

export function parseOfflineShellAdmission(input: unknown): OfflineShellAdmission {
  const value = record(input, "offline-shell admission");
  exactKeys(value, ["generationId", "releaseDigest"]);
  if (
    typeof value.generationId !== "string" ||
    !/^[a-f0-9]{64}:[a-f0-9]{64}$/.test(value.generationId) ||
    typeof value.releaseDigest !== "string" ||
    !SHA256.test(value.releaseDigest) ||
    !value.generationId.endsWith(`:${value.releaseDigest}`)
  ) {
    throw new Error("Offline-shell admission identity is invalid");
  }
  return Object.freeze(value) as unknown as OfflineShellAdmission;
}

export function parseOfflineShellGeneration(input: unknown): OfflineShellGeneration {
  const value = record(input, "offline-shell generation");
  exactKeys(value, [
    "appEntrypoint",
    "artifactDigest",
    "buildManifestSchemaVersion",
    "engineArtifact",
    "generationId",
    "installManifestSchemaVersion",
    "releaseDigest",
    "resources",
    "saveSchemaVersion",
    "schemaVersion",
    "serviceWorker",
  ]);
  if (
    value.schemaVersion !== OFFLINE_SHELL_GENERATION_SCHEMA_VERSION ||
    typeof value.artifactDigest !== "string" ||
    !SHA256.test(value.artifactDigest) ||
    typeof value.releaseDigest !== "string" ||
    !SHA256.test(value.releaseDigest) ||
    value.generationId !== `${value.artifactDigest}:${value.releaseDigest}` ||
    !positiveSafeInteger(value.buildManifestSchemaVersion) ||
    !positiveSafeInteger(value.installManifestSchemaVersion) ||
    !positiveSafeInteger(value.saveSchemaVersion) ||
    !Array.isArray(value.resources) ||
    value.resources.length < 5
  ) {
    throw new Error("Offline-shell generation identity is invalid");
  }
  const resources = value.resources.map(parseResource);
  const paths = new Set(resources.map(({ path }) => path));
  if (paths.size !== resources.length) {
    throw new Error("Offline-shell generation contains duplicate resource paths");
  }
  const appEntrypoint = parseIdentity(value.appEntrypoint, "app entrypoint");
  const engineArtifact = parseIdentity(value.engineArtifact, "engine artifact");
  const serviceWorker = parseIdentity(value.serviceWorker, "service worker");
  if (
    !paths.has(appEntrypoint.path) ||
    !paths.has(engineArtifact.path) ||
    serviceWorker.path !== OFFLINE_SHELL_SERVICE_WORKER_PATH ||
    !paths.has(serviceWorker.path) ||
    !paths.has("index.html") ||
    !paths.has("build-manifest.json") ||
    !paths.has("install-manifest.json")
  ) {
    throw new Error("Offline-shell generation omits a required shell identity");
  }
  return Object.freeze({
    appEntrypoint,
    artifactDigest: value.artifactDigest,
    buildManifestSchemaVersion: value.buildManifestSchemaVersion,
    engineArtifact,
    generationId: value.generationId,
    installManifestSchemaVersion: value.installManifestSchemaVersion,
    releaseDigest: value.releaseDigest,
    resources: Object.freeze(resources),
    saveSchemaVersion: value.saveSchemaVersion,
    schemaVersion: OFFLINE_SHELL_GENERATION_SCHEMA_VERSION,
    serviceWorker: Object.freeze({
      ...serviceWorker,
      path: OFFLINE_SHELL_SERVICE_WORKER_PATH,
    }),
  });
}

export function parseOfflineShellTelemetry(input: unknown): OfflineShellTelemetrySnapshot {
  const value = record(input, "offline-shell telemetry");
  exactKeys(value, [
    "activateCount",
    "activeArtifactDigest",
    "activeGenerationId",
    "activeReleaseDigest",
    "cacheHitCount",
    "cacheMissCount",
    "candidateGenerationId",
    "failureCode",
    "failureCount",
    "failureMessage",
    "mixedGenerationCount",
    "prepareCount",
    "previousGenerationId",
    "rollbackCount",
    "schemaVersion",
    "state",
    "verifiedBytes",
    "verifyCount",
    "verifyDurationMs",
    "verifyHighWaterMs",
  ]);
  const counters = [
    value.activateCount,
    value.cacheHitCount,
    value.cacheMissCount,
    value.failureCount,
    value.mixedGenerationCount,
    value.prepareCount,
    value.rollbackCount,
    value.verifiedBytes,
    value.verifyCount,
  ];
  if (
    value.schemaVersion !== OFFLINE_SHELL_TELEMETRY_SCHEMA_VERSION ||
    counters.some((counter) => !nonnegativeSafeInteger(counter)) ||
    !nonnegativeFinite(value.verifyDurationMs) ||
    !nonnegativeFinite(value.verifyHighWaterMs) ||
    value.verifyHighWaterMs > value.verifyDurationMs ||
    (value.verifyCount === 0 &&
      (value.verifiedBytes !== 0 ||
        value.verifyDurationMs !== 0 ||
        value.verifyHighWaterMs !== 0)) ||
    !isState(value.state) ||
    !nullableDigest(value.activeArtifactDigest) ||
    !nullableDigest(value.activeReleaseDigest) ||
    !nullableGenerationId(value.activeGenerationId) ||
    !nullableGenerationId(value.candidateGenerationId) ||
    !nullableGenerationId(value.previousGenerationId) ||
    (value.failureCode !== null &&
      value.failureCode !== "shell-contract" &&
      value.failureCode !== "shell-release-mismatch" &&
      value.failureCode !== "shell-unavailable") ||
    (value.failureMessage !== null &&
      (typeof value.failureMessage !== "string" || value.failureMessage === "")) ||
    (value.failureCode === null) !== (value.failureMessage === null) ||
    (value.state === "failed") !== (value.failureCode !== null)
  ) {
    throw new Error("Offline-shell telemetry is invalid");
  }
  return freezeTelemetry(value as unknown as OfflineShellTelemetrySnapshot);
}

export function parseOfflineShellStoreRecord(input: unknown): OfflineShellStoreRecord {
  const value = record(input, "offline-shell store record");
  exactKeys(value, ["active", "candidate", "previous", "schemaVersion", "telemetry"]);
  if (value.schemaVersion !== 1) throw new Error("Unsupported offline-shell store schema");
  const active = value.active === null ? null : parseOfflineShellGeneration(value.active);
  const candidate = value.candidate === null ? null : parseOfflineShellGeneration(value.candidate);
  const previous = value.previous === null ? null : parseOfflineShellGeneration(value.previous);
  const telemetry = parseOfflineShellTelemetry(value.telemetry);
  if (
    telemetry.activeGenerationId !== (active?.generationId ?? null) ||
    telemetry.activeArtifactDigest !== (active?.artifactDigest ?? null) ||
    telemetry.activeReleaseDigest !== (active?.releaseDigest ?? null) ||
    telemetry.candidateGenerationId !== (candidate?.generationId ?? null) ||
    telemetry.previousGenerationId !== (previous?.generationId ?? null) ||
    (active !== null && previous !== null && active.generationId === previous.generationId)
  ) {
    throw new Error("Offline-shell store selection does not match telemetry");
  }
  return Object.freeze({ active, candidate, previous, schemaVersion: 1, telemetry });
}

export function compatibleOfflineShellGenerations(
  left: OfflineShellGeneration,
  right: OfflineShellGeneration,
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.buildManifestSchemaVersion === right.buildManifestSchemaVersion &&
    left.installManifestSchemaVersion === right.installManifestSchemaVersion &&
    left.saveSchemaVersion === right.saveSchemaVersion
  );
}

function emptyTelemetry(): OfflineShellTelemetrySnapshot {
  return {
    activateCount: 0,
    activeArtifactDigest: null,
    activeGenerationId: null,
    activeReleaseDigest: null,
    cacheHitCount: 0,
    cacheMissCount: 0,
    candidateGenerationId: null,
    failureCode: null,
    failureCount: 0,
    failureMessage: null,
    mixedGenerationCount: 0,
    prepareCount: 0,
    previousGenerationId: null,
    rollbackCount: 0,
    schemaVersion: OFFLINE_SHELL_TELEMETRY_SCHEMA_VERSION,
    state: "idle",
    verifiedBytes: 0,
    verifyCount: 0,
    verifyDurationMs: 0,
    verifyHighWaterMs: 0,
  };
}

function parseResource(input: unknown): OfflineShellResource {
  const value = record(input, "offline-shell resource");
  exactKeys(value, ["bytes", "mimeType", "path", "sha256"]);
  if (
    !positiveSafeInteger(value.bytes) ||
    typeof value.mimeType !== "string" ||
    value.mimeType === "" ||
    typeof value.path !== "string" ||
    !safePath(value.path) ||
    typeof value.sha256 !== "string" ||
    !SHA256.test(value.sha256)
  ) {
    throw new Error("Offline-shell resource is invalid");
  }
  return Object.freeze(value) as unknown as OfflineShellResource;
}

function parseIdentity(
  input: unknown,
  label: string,
): Readonly<{ bytes: number; path: string; sha256: string }> {
  const value = record(input, `offline-shell ${label}`);
  exactKeys(value, ["bytes", "path", "sha256"]);
  if (
    !positiveSafeInteger(value.bytes) ||
    typeof value.path !== "string" ||
    !safePath(value.path) ||
    typeof value.sha256 !== "string" ||
    !SHA256.test(value.sha256)
  ) {
    throw new Error(`Offline-shell ${label} identity is invalid`);
  }
  return Object.freeze(value) as unknown as Readonly<{
    bytes: number;
    path: string;
    sha256: string;
  }>;
}

function commonMessage(value: Record<string, unknown>): void {
  if (
    value.protocolVersion !== OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION ||
    !positiveSafeInteger(value.requestId)
  ) {
    throw new Error("Offline-shell message version or request ID is invalid");
  }
}

function record(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`${label} must be an object`);
  }
  return input as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort(compareCodepoints);
  const sortedExpected = [...expected].sort(compareCodepoints);
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error("Offline-shell value has unsupported or missing keys");
  }
}

function safePath(value: string): boolean {
  return (
    value !== "" &&
    /^[A-Za-z0-9._/-]+$/.test(value) &&
    !value.startsWith("/") &&
    value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

function nullableDigest(value: unknown): boolean {
  return value === null || (typeof value === "string" && SHA256.test(value));
}

function nullableGenerationId(value: unknown): boolean {
  return value === null || (typeof value === "string" && /^[a-f0-9]{64}:[a-f0-9]{64}$/.test(value));
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function nonnegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isState(value: unknown): value is OfflineShellState {
  return (
    value === "active" ||
    value === "failed" ||
    value === "idle" ||
    value === "preparing" ||
    value === "rolling-back" ||
    value === "unavailable" ||
    value === "verifying"
  );
}

function freezeTelemetry(value: OfflineShellTelemetrySnapshot): OfflineShellTelemetrySnapshot {
  return Object.freeze({ ...value });
}

function compareCodepoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
