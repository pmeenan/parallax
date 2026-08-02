import { randomUUID } from "node:crypto";
import { type FileHandle, lstat, mkdir, open } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  ASSET_UPDATE_V8_CONTRACT,
  ASSET_UPDATE_V8_SCHEMA_VERSION,
  type AssetUpdateExpectedAuthority,
  type AssetUpdateV8Evidence,
  formatAssetUpdateV8Markdown,
  type ValidatedAssetUpdateV8Evidence,
  validateAssetUpdateV8Evidence,
} from "./asset-update-v8-evidence.js";
import { sanitizeAssetUpdateDiagnostic as boundedMessage } from "./asset-update-v8-sanitization.js";

const MAX_COLLISION_ATTEMPTS = 100;
const MAX_CLOSE_ATTEMPTS = 3;
const MAX_RESULT_BYTES = 16 * 1024 * 1024;

type LogicalResultPath = "result-json" | "result-markdown";
type PublicationState = "failed" | "passed" | "pending" | "reservation-abandoned";
type PublicationPhase = "close" | "json" | "markdown";

export interface AssetUpdateV8ResultHooks {
  readonly afterCreate?: (path: string, logicalPath: LogicalResultPath) => Promise<void>;
  readonly beforeClose?: (
    path: string,
    logicalPath: LogicalResultPath,
    attempt: number,
  ) => Promise<void>;
  readonly beforeCreate?: (path: string, logicalPath: LogicalResultPath) => Promise<void>;
  readonly beforeInitialWrite?: (path: string, logicalPath: LogicalResultPath) => Promise<void>;
  readonly beforeWrite?: (
    path: string,
    logicalPath: LogicalResultPath,
    state: PublicationState,
  ) => Promise<void>;
}

export interface AssetUpdateV8ResultIdentity {
  readonly companionPath: string;
  readonly reservationId: string;
}

export interface AssetUpdateV8ResultReservation {
  readonly close: () => Promise<void>;
  readonly jsonPath: string;
  readonly markdownPath: string;
  readonly publishTerminal: (
    evidence: AssetUpdateV8Evidence,
    recover: (phase: PublicationPhase, error: unknown) => AssetUpdateV8Evidence,
  ) => Promise<AssetUpdateV8Evidence>;
  readonly retainedIdentity: AssetUpdateV8RetainedPairIdentity;
  readonly reservationId: string;
  readonly stem: string;
}

export interface AssetUpdateV8RetainedPairIdentity {
  readonly json: Readonly<{ readonly dev: bigint; readonly ino: bigint }>;
  readonly markdown: Readonly<{ readonly dev: bigint; readonly ino: bigint }>;
}

export async function closeAssetUpdateV8ResultAfterFailure(
  reservation: Pick<AssetUpdateV8ResultReservation, "close">,
  primaryFailure: unknown,
): Promise<never> {
  try {
    await reservation.close();
  } catch (closeFailure: unknown) {
    throw new AggregateError(
      [primaryFailure, closeFailure],
      "Asset-update V8 primary operation and result-handle close both failed",
      { cause: primaryFailure },
    );
  }
  throw primaryFailure;
}

export class AssetUpdateV8ResultPublicationError extends Error {
  public readonly failures: readonly string[];
  public readonly phase: PublicationPhase;

  public constructor(phase: PublicationPhase, failures: readonly string[]) {
    super(
      `Asset-update V8 result ${phase} finalization failed (${failures.length} retained failure(s))`,
    );
    this.name = "AssetUpdateV8ResultPublicationError";
    this.phase = phase;
    this.failures = failures;
  }
}

interface OwnedResultFile {
  closeAttempts: number;
  handle: FileHandle | null;
  readonly identity: Readonly<{ readonly dev: bigint; readonly ino: bigint }>;
  readonly logicalPath: LogicalResultPath;
  readonly path: string;
  readonly reservationId: string;
}

class ResultCollisionError extends Error {
  public readonly original: unknown;

  public constructor(original: unknown) {
    super("Asset-update V8 result path already exists");
    this.name = "ResultCollisionError";
    this.original = original;
  }
}

class ResultWriteError extends Error {
  public readonly logicalPath: LogicalResultPath;
  public readonly original: unknown;

  public constructor(logicalPath: LogicalResultPath, original: unknown) {
    super(`Asset-update V8 ${logicalPath} write failed: ${boundedMessage(original)}`);
    this.name = "ResultWriteError";
    this.logicalPath = logicalPath;
    this.original = original;
  }
}

export async function reserveAssetUpdateV8Result(
  resultRoot: string,
  startedAt: string,
  pendingFactory: (identity: AssetUpdateV8ResultIdentity) => AssetUpdateV8Evidence,
  hooks: AssetUpdateV8ResultHooks = {},
): Promise<AssetUpdateV8ResultReservation> {
  const parsedStartedAt = new Date(startedAt);
  if (!Number.isFinite(parsedStartedAt.valueOf()) || parsedStartedAt.toISOString() !== startedAt) {
    throw new Error("Asset-update V8 result start time is not a canonical ISO timestamp");
  }
  await mkdir(resultRoot, { recursive: true });
  const baseStem = `asset-update-v8-v${ASSET_UPDATE_V8_SCHEMA_VERSION}-${startedAt.replaceAll(
    /[:.]/g,
    "-",
  )}`;
  for (let ordinal = 0; ordinal < MAX_COLLISION_ATTEMPTS; ordinal += 1) {
    const stem = ordinal === 0 ? baseStem : `${baseStem}-${ordinal}`;
    const jsonPath = join(resultRoot, `${stem}.json`);
    const markdownPath = join(resultRoot, `${stem}.md`);
    const reservationId = randomUUID();
    const pending = pendingFactory({
      companionPath: basename(markdownPath),
      reservationId,
    });
    validateOwnedEvidence(pending, reservationId, basename(markdownPath), "pending");
    let json: OwnedResultFile | null = null;
    let markdown: OwnedResultFile | null = null;
    try {
      json = await createOwnedFile(
        jsonPath,
        "result-json",
        reservationId,
        formatOwnedJson(pending),
        startedAt,
        hooks,
      );
      markdown = await createOwnedFile(
        markdownPath,
        "result-markdown",
        reservationId,
        formatOwnedMarkdown(pending),
        startedAt,
        hooks,
      );
      await validatePair(json, markdown);
      return createReservation({
        hooks,
        json,
        markdown,
        pending,
        stem,
      });
    } catch (error: unknown) {
      const original = error instanceof ResultCollisionError ? error.original : error;
      const failures = await abandonPartialReservation(
        [markdown, json],
        startedAt,
        original,
        hooks,
      );
      if (failures.length !== 0) {
        throw new AggregateError(
          [original, ...failures],
          "Asset-update V8 result reservation and abandonment failed",
        );
      }
      if (error instanceof ResultCollisionError) continue;
      throw original;
    }
  }
  throw new Error(
    `Asset-update V8 result exhausted ${MAX_COLLISION_ATTEMPTS} collision-safe suffixes`,
  );
}

function createReservation(input: {
  readonly hooks: AssetUpdateV8ResultHooks;
  readonly json: OwnedResultFile;
  readonly markdown: OwnedResultFile;
  pending: AssetUpdateV8Evidence;
  readonly stem: string;
}): AssetUpdateV8ResultReservation {
  const publish = async (
    evidence: AssetUpdateV8Evidence,
    state: "failed" | "passed",
  ): Promise<void> => {
    validateOwnedEvidence(evidence, input.json.reservationId, basename(input.markdown.path), state);
    await validatePair(input.json, input.markdown);
    await writeOwnedFile(input.markdown, formatOwnedMarkdown(evidence), state, input.hooks);
    await validatePair(input.json, input.markdown);
    await writeOwnedFile(input.json, formatOwnedJson(evidence), state, input.hooks);
    await validatePair(input.json, input.markdown);
  };
  const close = async (): Promise<void> => {
    const failures = await closeFilesBoundedly([input.markdown, input.json], input.hooks);
    if (failures.length !== 0) {
      throw new AggregateError(failures, "Asset-update V8 result handles did not close");
    }
  };
  return Object.freeze({
    close,
    jsonPath: input.json.path,
    markdownPath: input.markdown.path,
    async publishTerminal(
      evidence: AssetUpdateV8Evidence,
      recover: (phase: PublicationPhase, error: unknown) => AssetUpdateV8Evidence,
    ): Promise<AssetUpdateV8Evidence> {
      if (evidence.state === "pending") {
        throw new Error("Asset-update V8 terminal publication received pending evidence");
      }
      let phase: PublicationPhase = "json";
      try {
        await publish(evidence, evidence.state);
        phase = "close";
        const closeFailures = await closeTerminalPair(input.markdown, input.json, input.hooks);
        if (closeFailures.length !== 0) {
          throw new AggregateError(closeFailures, "Asset-update V8 terminal pair did not close");
        }
        return evidence;
      } catch (error: unknown) {
        if (error instanceof ResultWriteError) {
          phase = error.logicalPath === "result-markdown" ? "markdown" : "json";
        }
        let recovery: AssetUpdateV8Evidence;
        try {
          recovery = recover(phase, error);
          if (recovery.state !== "failed") {
            throw new Error("Asset-update V8 result recovery did not produce failed evidence");
          }
          await ensureOpen(input.json);
          await ensureOpen(input.markdown);
          await publish(recovery, "failed");
          input.pending = recovery;
          const closeFailures = await closeTerminalPair(input.markdown, input.json, input.hooks);
          if (closeFailures.length !== 0) {
            throw new AggregateError(
              closeFailures,
              "Recovered asset-update V8 result handles did not close",
            );
          }
          return recovery;
        } catch (recoveryError: unknown) {
          const failures = [boundedMessage(error), boundedMessage(recoveryError)];
          const finalizationFailure = officialFinalizationFailure(
            input.pending,
            phase,
            new AggregateError([error, recoveryError], "Asset-update V8 publication failed"),
          );
          input.pending = finalizationFailure;
          await retainFinalizationFailure(
            [input.markdown, input.json],
            finalizationFailure,
            input.hooks,
          ).catch((finalizationError: unknown) => {
            failures.push(boundedMessage(finalizationError));
          });
          const closeFailures = await closeTerminalPair(input.markdown, input.json, input.hooks);
          failures.push(...closeFailures.map(boundedMessage));
          throw new AssetUpdateV8ResultPublicationError(phase, Object.freeze(failures));
        }
      }
    },
    retainedIdentity: Object.freeze({
      json: input.json.identity,
      markdown: input.markdown.identity,
    }),
    reservationId: input.json.reservationId,
    stem: input.stem,
  });
}

async function createOwnedFile(
  path: string,
  logicalPath: LogicalResultPath,
  reservationId: string,
  initial: string,
  startedAt: string,
  hooks: AssetUpdateV8ResultHooks,
): Promise<OwnedResultFile> {
  let handle: FileHandle;
  try {
    await hooks.beforeCreate?.(path, logicalPath);
    handle = await open(path, "wx+");
  } catch (error: unknown) {
    if (isAlreadyExists(error)) throw new ResultCollisionError(error);
    throw error;
  }
  const file: OwnedResultFile = {
    closeAttempts: 0,
    handle,
    identity: Object.freeze({ dev: 0n, ino: 0n }),
    logicalPath,
    path,
    reservationId,
  };
  let owned: OwnedResultFile | null = null;
  try {
    await hooks.afterCreate?.(path, logicalPath);
    const stat = await handle.stat({ bigint: true });
    owned = {
      ...file,
      identity: Object.freeze({ dev: stat.dev, ino: stat.ino }),
    };
    await validateOwnedFile(owned, false);
    await hooks.beforeInitialWrite?.(path, logicalPath);
    await writeBytes(handle, initial);
    await validateOwnedFile(owned, true);
    return owned;
  } catch (error: unknown) {
    const failures =
      owned === null
        ? await abandonPreIdentityReservation(file, startedAt, error, hooks)
        : await abandonPartialReservation([owned], startedAt, error, hooks);
    if (failures.length !== 0) {
      throw new AggregateError(
        [error, ...failures],
        `Asset-update V8 ${logicalPath} initial reservation and abandonment failed`,
      );
    }
    throw error;
  }
}

async function validatePair(json: OwnedResultFile, markdown: OwnedResultFile): Promise<void> {
  await validateOwnedFile(json, true);
  await validateOwnedFile(markdown, true);
  if (json.identity.dev === markdown.identity.dev && json.identity.ino === markdown.identity.ino) {
    throw new Error("Asset-update V8 result JSON and Markdown reservations alias");
  }
}

async function validateOwnedFile(file: OwnedResultFile, requireToken: boolean): Promise<void> {
  const handle = await ensureOpen(file);
  const [handleStat, pathStat] = await Promise.all([
    handle.stat({ bigint: true }),
    lstat(file.path, { bigint: true }),
  ]);
  if (
    !handleStat.isFile() ||
    handleStat.isSymbolicLink() ||
    !pathStat.isFile() ||
    pathStat.isSymbolicLink() ||
    handleStat.nlink !== 1n ||
    pathStat.nlink !== 1n ||
    handleStat.dev !== file.identity.dev ||
    handleStat.ino !== file.identity.ino ||
    pathStat.dev !== file.identity.dev ||
    pathStat.ino !== file.identity.ino
  ) {
    throw new Error(`Asset-update V8 ${file.logicalPath} filesystem identity changed`);
  }
  if (requireToken && !(await readHandleText(handle)).includes(file.reservationId)) {
    throw new Error(`Asset-update V8 ${file.logicalPath} ownership token changed`);
  }
}

async function ensureOpen(file: OwnedResultFile): Promise<FileHandle> {
  if (file.handle !== null) return file.handle;
  const handle = await open(file.path, "r+");
  file.handle = handle;
  try {
    await validateOwnedFile(file, true);
    return handle;
  } catch (error: unknown) {
    try {
      await closeHandle(file);
    } catch (closeError: unknown) {
      throw new AggregateError(
        [error, closeError],
        `Asset-update V8 ${file.logicalPath} reopen validation and close failed`,
      );
    }
    throw error;
  }
}

async function writeOwnedFile(
  file: OwnedResultFile,
  value: string,
  state: PublicationState,
  hooks: AssetUpdateV8ResultHooks,
): Promise<void> {
  try {
    await hooks.beforeWrite?.(file.path, file.logicalPath, state);
    await validateOwnedFile(file, true);
    if (!value.includes(file.reservationId)) {
      throw new Error("Asset-update V8 owned result write omitted its reservation token");
    }
    await writeBytes(await ensureOpen(file), value);
    await validateOwnedFile(file, true);
  } catch (error: unknown) {
    if (error instanceof ResultWriteError) throw error;
    throw new ResultWriteError(file.logicalPath, error);
  }
}

async function writeBytes(handle: FileHandle, value: string): Promise<void> {
  const bytes = Buffer.from(value);
  if (bytes.byteLength > MAX_RESULT_BYTES) {
    throw new Error("Asset-update V8 result exceeds the bounded evidence size");
  }
  let written = 0;
  while (written < bytes.byteLength) {
    const result = await handle.write(bytes, written, bytes.byteLength - written, written);
    if (result.bytesWritten <= 0) {
      throw new Error("Asset-update V8 result write made no progress");
    }
    written += result.bytesWritten;
  }
  await handle.truncate(bytes.byteLength);
  await handle.sync();
}

async function readHandleText(handle: FileHandle): Promise<string> {
  const stat = await handle.stat();
  if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > MAX_RESULT_BYTES) {
    throw new Error("Asset-update V8 owned result size is invalid");
  }
  const bytes = Buffer.alloc(stat.size);
  let read = 0;
  while (read < bytes.byteLength) {
    const result = await handle.read(bytes, read, bytes.byteLength - read, read);
    if (result.bytesRead <= 0) {
      throw new Error("Asset-update V8 owned result read ended early");
    }
    read += result.bytesRead;
  }
  return bytes.toString("utf8");
}

async function abandonPartialReservation(
  files: readonly (OwnedResultFile | null)[],
  startedAt: string,
  original: unknown,
  hooks: AssetUpdateV8ResultHooks,
): Promise<readonly unknown[]> {
  const failures: unknown[] = [];
  for (const file of files) {
    if (file === null) continue;
    const state = "reservation-abandoned" as const;
    const value = reservationAbandonedValue(file, startedAt, original);
    await writeOwnedFile(file, value, state, hooks).catch((error: unknown) => {
      failures.push(error);
    });
  }
  failures.push(...(await closeFilesBoundedly(files, hooks)));
  return Object.freeze(failures);
}

async function abandonPreIdentityReservation(
  file: OwnedResultFile,
  startedAt: string,
  original: unknown,
  hooks: AssetUpdateV8ResultHooks,
): Promise<readonly unknown[]> {
  const failures: unknown[] = [];
  if (file.handle !== null) {
    await writeBytes(file.handle, reservationAbandonedValue(file, startedAt, original)).catch(
      (error: unknown) => {
        failures.push(error);
      },
    );
  }
  failures.push(...(await closeFilesBoundedly([file], hooks)));
  return Object.freeze(failures);
}

function reservationAbandonedValue(
  file: Pick<OwnedResultFile, "logicalPath" | "reservationId">,
  startedAt: string,
  original: unknown,
): string {
  const state = "reservation-abandoned" as const;
  return file.logicalPath === "result-json"
    ? `${JSON.stringify(
        {
          contract: ASSET_UPDATE_V8_CONTRACT,
          failure: {
            message: boundedMessage(original),
            phase: "reservation",
          },
          resultOwnership: {
            publicationState: state,
            reservationId: file.reservationId,
          },
          schemaVersion: ASSET_UPDATE_V8_SCHEMA_VERSION,
          startedAt,
          state,
        },
        null,
        2,
      )}\n`
    : [
        `<!-- parallax-asset-update-v8-owner:${file.reservationId}:${state} -->`,
        "# Asset-only update V8 lifecycle",
        "",
        `- State: \`${state}\``,
        `- Reservation failure: ${boundedMessage(original)}`,
        "",
      ].join("\n");
}

async function retainFinalizationFailure(
  files: readonly OwnedResultFile[],
  failure: AssetUpdateV8Evidence,
  hooks: AssetUpdateV8ResultHooks,
): Promise<void> {
  if (failure.state !== "failed") {
    throw new Error("Asset-update V8 finalization retention requires official failed evidence");
  }
  validateOwnedEvidence(
    failure,
    failure.resultOwnership.reservationId,
    failure.companion.path,
    "failed",
  );
  const failures: unknown[] = [];
  for (const file of files) {
    await ensureOpen(file).catch((error: unknown) => {
      failures.push(error);
    });
    if (file.handle === null) continue;
    const value =
      file.logicalPath === "result-json" ? formatOwnedJson(failure) : formatOwnedMarkdown(failure);
    await writeOwnedFile(file, value, "failed", hooks).catch((error: unknown) => {
      failures.push(error);
    });
  }
  if (failures.length !== 0) {
    throw new AggregateError(failures, "Asset-update V8 finalization marker write failed");
  }
}

function officialFinalizationFailure(
  latest: AssetUpdateV8Evidence,
  phase: PublicationPhase,
  error: unknown,
): AssetUpdateV8Evidence {
  const evidence: AssetUpdateV8Evidence = {
    authority: null,
    companion: { path: latest.companion.path, state: "failed" },
    completedAt: new Date().toISOString(),
    contract: ASSET_UPDATE_V8_CONTRACT,
    failure: {
      message: boundedMessage(error),
      name: "AssetUpdateV8ResultPublicationError",
      phase:
        phase === "close"
          ? "result-close"
          : phase === "markdown"
            ? "companion-write"
            : "publication",
    },
    failureContext: null,
    partialResult: null,
    postValidation: {
      authority: null,
      passed: false,
      performed: false,
      ready: null,
      target: null,
    },
    resultOwnership: {
      publicationState: "failed",
      reservationId: latest.resultOwnership.reservationId,
    },
    schemaVersion: ASSET_UPDATE_V8_SCHEMA_VERSION,
    startedAt: latest.startedAt,
    state: "failed",
  };
  validateOwnedEvidence(
    evidence,
    latest.resultOwnership.reservationId,
    latest.companion.path,
    "failed",
  );
  return evidence;
}

async function closeFilesBoundedly(
  files: readonly (OwnedResultFile | null)[],
  hooks: AssetUpdateV8ResultHooks,
): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (let round = 0; round < MAX_CLOSE_ATTEMPTS; round += 1) {
    if (!hasOpenAssetUpdateV8ResultHandle(files)) break;
    for (const file of files) {
      if (file?.handle === null || file === null) continue;
      file.closeAttempts += 1;
      try {
        await hooks.beforeClose?.(file.path, file.logicalPath, file.closeAttempts);
        await closeHandle(file);
      } catch (error: unknown) {
        failures.push(error);
      }
    }
  }
  for (const file of files) {
    if (file?.handle === null || file === null) continue;
    await closeHandle(file).catch((error: unknown) => {
      failures.push(error);
    });
  }
  return failures;
}

export function hasOpenAssetUpdateV8ResultHandle(
  files: readonly (Readonly<{ handle: unknown | null }> | null)[],
): boolean {
  return files.some((file) => file !== null && file.handle !== null);
}

async function closeTerminalPair(
  markdown: OwnedResultFile,
  json: OwnedResultFile,
  hooks: AssetUpdateV8ResultHooks,
): Promise<unknown[]> {
  const markdownFailures = await closeOneBoundedly(markdown, hooks);
  if (markdownFailures.length !== 0) {
    // The primary stays open so recovery can publish a failed primary after any
    // companion close or ownership failure.
    return markdownFailures;
  }
  return closeOneBoundedly(json, hooks);
}

async function closeOneBoundedly(
  file: OwnedResultFile,
  hooks: AssetUpdateV8ResultHooks,
): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (let attempt = 0; attempt < MAX_CLOSE_ATTEMPTS && file.handle !== null; attempt += 1) {
    file.closeAttempts += 1;
    try {
      await hooks.beforeClose?.(file.path, file.logicalPath, file.closeAttempts);
      await closeHandle(file);
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  if (file.handle !== null) {
    await closeHandle(file).catch((error: unknown) => {
      failures.push(error);
    });
  }
  return failures;
}

async function closeHandle(file: OwnedResultFile): Promise<void> {
  if (file.handle === null) return;
  const handle = file.handle;
  await handle.close();
  file.handle = null;
}

function formatOwnedJson(evidence: ValidatedAssetUpdateV8Evidence): string {
  return `${JSON.stringify(canonicalJsonValue(evidence))}\n`;
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonicalJsonValue(item)]),
  );
}

function formatOwnedMarkdown(evidence: ValidatedAssetUpdateV8Evidence): string {
  return [
    `<!-- parallax-asset-update-v8-owner:${evidence.resultOwnership.reservationId}:${evidence.state} -->`,
    formatAssetUpdateV8Markdown(evidence).trimEnd(),
    `- Result reservation: \`${evidence.resultOwnership.reservationId}\``,
    `- Publication state: \`${evidence.state}\``,
    "",
  ].join("\n");
}

function validateOwnedEvidence(
  evidence: AssetUpdateV8Evidence,
  reservationId: string,
  companionPath: string,
  state: "failed" | "passed" | "pending",
): void {
  const validated = validateAssetUpdateV8Evidence(evidence);
  if (
    validated.state !== state ||
    validated.resultOwnership.reservationId !== reservationId ||
    validated.resultOwnership.publicationState !== state ||
    validated.companion.path !== companionPath ||
    validated.companion.state !== state
  ) {
    throw new Error("Asset-update V8 result evidence does not match its reserved pair");
  }
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

export async function readAssetUpdateV8Result(
  path: string,
): Promise<ValidatedAssetUpdateV8Evidence> {
  const json = await readRetainedFile(path);
  const evidence = parseCanonicalEvidence(json.bytes);
  return validateAssetUpdateV8ResultPair(
    path,
    join(dirname(path), evidence.companion.path),
    undefined,
    { json: json.identity },
  );
}

export async function validateAssetUpdateV8ResultPair(
  jsonPath: string,
  markdownPath: string,
  expected?: AssetUpdateExpectedAuthority,
  expectedIdentity?: Readonly<{
    readonly json: Readonly<{ readonly dev: bigint; readonly ino: bigint }>;
    readonly markdown?: Readonly<{ readonly dev: bigint; readonly ino: bigint }>;
  }>,
): Promise<ValidatedAssetUpdateV8Evidence> {
  const resolvedJson = resolve(jsonPath);
  const resolvedMarkdown = resolve(markdownPath);
  const jsonName = basename(resolvedJson);
  const markdownName = basename(resolvedMarkdown);
  if (
    dirname(resolvedJson) !== dirname(resolvedMarkdown) ||
    !jsonName.endsWith(".json") ||
    !markdownName.endsWith(".md") ||
    jsonName.slice(0, -5) !== markdownName.slice(0, -3)
  ) {
    throw new Error("Asset-update V8 retained companion path is not the exact same-stem pair");
  }
  const [json, markdown] = await Promise.all([
    readRetainedFile(resolvedJson, expectedIdentity?.json),
    readRetainedFile(resolvedMarkdown, expectedIdentity?.markdown),
  ]);
  if (json.identity.dev === markdown.identity.dev && json.identity.ino === markdown.identity.ino) {
    throw new Error("Asset-update V8 retained JSON and Markdown identities alias");
  }
  const evidence = parseCanonicalEvidence(json.bytes, expected);
  if (evidence.companion.path !== markdownName) {
    throw new Error("Asset-update V8 evidence companion does not bind the supplied Markdown path");
  }
  if (markdown.bytes.toString("utf8") !== formatOwnedMarkdown(evidence)) {
    throw new Error("Asset-update V8 retained Markdown is not the exact JSON companion");
  }
  return evidence;
}

async function readRetainedFile(
  path: string,
  expectedIdentity?: Readonly<{ readonly dev: bigint; readonly ino: bigint }>,
): Promise<
  Readonly<{
    readonly bytes: Buffer;
    readonly identity: Readonly<{ readonly dev: bigint; readonly ino: bigint }>;
  }>
> {
  const handle = await open(path, "r");
  let result:
    | Readonly<{
        readonly bytes: Buffer;
        readonly identity: Readonly<{ readonly dev: bigint; readonly ino: bigint }>;
      }>
    | undefined;
  let readFailure: unknown;
  try {
    const before = await validateReadIdentity(handle, path, expectedIdentity);
    const bytes = await readHandleBytes(handle);
    const after = await validateReadIdentity(handle, path, before);
    if (before.dev !== after.dev || before.ino !== after.ino) {
      throw new Error("Asset-update V8 retained file identity changed during read");
    }
    result = Object.freeze({ bytes, identity: before });
  } catch (error: unknown) {
    readFailure = error;
  }
  let closeFailure: unknown;
  try {
    await handle.close();
  } catch (error: unknown) {
    closeFailure = error;
  }
  if (readFailure !== undefined || closeFailure !== undefined) {
    const failures = [readFailure, closeFailure].filter(
      (failure): failure is Exclude<typeof failure, undefined> => failure !== undefined,
    );
    throw new AggregateError(
      failures,
      "Asset-update V8 retained file read/identity/close validation failed",
    );
  }
  if (result === undefined) {
    throw new Error("Asset-update V8 retained file read produced no result");
  }
  return result;
}

async function validateReadIdentity(
  handle: FileHandle,
  path: string,
  expected?: Readonly<{ readonly dev: bigint; readonly ino: bigint }>,
): Promise<Readonly<{ readonly dev: bigint; readonly ino: bigint }>> {
  const [handleStat, pathStat] = await Promise.all([
    handle.stat({ bigint: true }),
    lstat(path, { bigint: true }),
  ]);
  if (
    !handleStat.isFile() ||
    handleStat.isSymbolicLink() ||
    !pathStat.isFile() ||
    pathStat.isSymbolicLink() ||
    handleStat.nlink !== 1n ||
    pathStat.nlink !== 1n ||
    handleStat.dev !== pathStat.dev ||
    handleStat.ino !== pathStat.ino ||
    (expected !== undefined && (handleStat.dev !== expected.dev || handleStat.ino !== expected.ino))
  ) {
    throw new Error("Asset-update V8 retained result filesystem identity is invalid");
  }
  return Object.freeze({ dev: handleStat.dev, ino: handleStat.ino });
}

async function readHandleBytes(handle: FileHandle): Promise<Buffer> {
  const stat = await handle.stat();
  if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > MAX_RESULT_BYTES) {
    throw new Error("Asset-update V8 retained result size is invalid");
  }
  const bytes = Buffer.alloc(stat.size);
  let offset = 0;
  while (offset < bytes.byteLength) {
    const read = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
    if (read.bytesRead <= 0) {
      throw new Error("Asset-update V8 retained result read ended early");
    }
    offset += read.bytesRead;
  }
  return bytes;
}

function parseCanonicalEvidence(
  bytes: Buffer,
  expected?: AssetUpdateExpectedAuthority,
): ValidatedAssetUpdateV8Evidence {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error: unknown) {
    throw new Error(`Asset-update V8 retained JSON is invalid: ${boundedMessage(error)}`);
  }
  const evidence = validateAssetUpdateV8Evidence(parsed, expected);
  if (!bytes.equals(Buffer.from(formatOwnedJson(evidence)))) {
    throw new Error("Asset-update V8 retained JSON is not exact canonical bytes");
  }
  return evidence;
}
