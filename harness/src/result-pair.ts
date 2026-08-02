import { randomUUID } from "node:crypto";
import { type FileHandle, lstat, mkdir, open } from "node:fs/promises";
import { join } from "node:path";

const MAX_RESULT_PATH_ATTEMPTS = 100;
const MAX_PARTIAL_CLOSE_ATTEMPTS = 3;
const MAX_OWNED_WRITE_CHUNK_BYTES = 4 * 1024;

type ResultPairPublicationState =
  | "failed"
  | "finalization-failed"
  | "passed"
  | "pending"
  | "reservation-abandoned"
  | "reserved";

type ResultLogicalPath = "result-json" | "result-markdown";

export interface ResultPairTestHooks {
  readonly afterOwnedWriteChunk?: (
    path: string,
    logicalPath: ResultLogicalPath,
    writtenBytes: number,
    totalBytes: number,
  ) => Promise<void>;
  readonly afterHandleClose?: (
    path: string,
    logicalPath: ResultLogicalPath,
    attempt: number,
  ) => Promise<void>;
  readonly afterPairCreate?: () => Promise<void>;
  readonly beforeCreate?: (path: string) => Promise<void>;
  readonly beforeHandleClose?: (
    path: string,
    logicalPath: ResultLogicalPath,
    attempt: number,
  ) => Promise<void>;
  readonly beforeHandleStat?: (
    path: string,
    phase: "initial" | "reopen" | "routine",
  ) => Promise<void>;
  readonly beforeOwnedWrite?: (path: string, state: ResultPairPublicationState) => Promise<void>;
  readonly beforePartialAbandon?: (path: string, logicalPath: ResultLogicalPath) => Promise<void>;
  readonly signal?: AbortSignal;
}

interface ReservedFileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
}

interface ReservedResultFile {
  closeAttempts: number;
  handle: FileHandle | null;
  readonly hooks: ResultPairTestHooks;
  identity: ReservedFileIdentity | null;
  readonly logicalPath: ResultLogicalPath;
  readonly path: string;
  readonly reservationId: string;
}

interface ResultFileFailure {
  readonly error: unknown;
  readonly message: string;
  readonly path: ResultLogicalPath;
}

// A real FileHandle.close() rejection after every bounded local attempt is not
// allowed to make the live descriptor unreachable. Node closes descriptors at
// process exit; retaining the owner here preserves that final process boundary.
const processRetainedResultFiles = new Set<ReservedResultFile>();

class ResultPairCollisionError extends Error {
  public readonly original: unknown;

  public constructor(original: unknown) {
    super("Result-pair path already exists");
    this.name = "ResultPairCollisionError";
    this.original = original;
  }
}

export interface ResultPairOwnership {
  readonly publicationState: ResultPairPublicationState;
  readonly reservationId: string;
}

export interface ResultPairReservation {
  readonly abort: (reason?: unknown) => void;
  readonly close: (signal?: AbortSignal) => Promise<void>;
  readonly forceClose: (reason?: unknown) => Promise<void>;
  readonly handleState: () => Readonly<{
    jsonClosed: boolean;
    markdownClosed: boolean;
  }>;
  readonly jsonPath: string;
  readonly markdownPath: string;
  readonly ownership: ResultPairOwnership;
  readonly publicationState: () => ResultPairPublicationState;
  readonly publishPair: (
    json: Readonly<Record<string, unknown>>,
    markdown: string | (() => string),
    state: "failed" | "passed",
    options?: Readonly<{
      retainJsonPrimaryOnMarkdownFailure?: true;
      signal?: AbortSignal;
    }>,
  ) => Promise<void>;
  readonly publishPendingJson: (
    json: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ) => Promise<void>;
  readonly stem: string;
}

export class ResultPairPublicationError extends Error {
  public readonly phase: "close" | "json" | "markdown";
  public readonly recoveryFailures: readonly Readonly<{
    message: string;
    path: ResultLogicalPath;
  }>[];

  public constructor(
    phase: "close" | "json" | "markdown",
    recoveryFailures: readonly Readonly<{
      message: string;
      path: ResultLogicalPath;
    }>[],
  ) {
    super(
      `Result-pair ${phase} finalization failed; ${recoveryFailures.length} close or recovery operations failed`,
    );
    this.name = "ResultPairPublicationError";
    this.phase = phase;
    this.recoveryFailures = recoveryFailures;
  }
}

export async function reserveResultPair(
  resultRoot: string,
  startedAt: string,
  pending: Readonly<Record<string, unknown>>,
  hooks: ResultPairTestHooks = {},
  stemPrefix = "result",
  documentTitle = "Harness result",
): Promise<ResultPairReservation> {
  throwIfAborted(hooks.signal);
  const schemaVersion = pending.schemaVersion;
  if (!Number.isSafeInteger(schemaVersion) || (schemaVersion as number) < 1) {
    throw new Error("Result-pair schemaVersion must be a positive safe integer");
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(stemPrefix)) {
    throw new Error("Result stem prefix is invalid");
  }
  if (
    documentTitle.length < 1 ||
    documentTitle.length > 96 ||
    !/^[A-Za-z0-9][A-Za-z0-9 +&:()/-]*$/u.test(documentTitle)
  ) {
    throw new Error("Result document title is invalid");
  }
  const baseStem = `${stemPrefix}-v${schemaVersion as number}-${startedAt.replaceAll(/[:.]/g, "-")}`;
  await mkdir(resultRoot, { recursive: true });
  throwIfAborted(hooks.signal);
  for (let ordinal = 0; ordinal < MAX_RESULT_PATH_ATTEMPTS; ordinal += 1) {
    throwIfAborted(hooks.signal);
    const stem = ordinal === 0 ? baseStem : `${baseStem}-${ordinal}`;
    const jsonPath = join(resultRoot, `${stem}.json`);
    const markdownPath = join(resultRoot, `${stem}.md`);
    const reservationId = randomUUID();
    const ownership = Object.freeze({
      publicationState: "reserved" as const,
      reservationId,
    });
    const reservedJson = formatOwnedJson(pending, ownership);
    const reservedMarkdown = formatOwnedMarkdown(
      `# ${documentTitle}\n\n- State: \`pending\`\n`,
      ownership,
    );
    let json: ReservedResultFile | null = null;
    let markdown: ReservedResultFile | null = null;
    let failurePath: ResultLogicalPath = "result-json";
    try {
      json = await createReservedFile(
        jsonPath,
        "result-json",
        reservationId,
        reservedJson,
        hooks,
        documentTitle,
      );
      throwIfAborted(hooks.signal);
      failurePath = "result-markdown";
      markdown = await createReservedFile(
        markdownPath,
        "result-markdown",
        reservationId,
        reservedMarkdown,
        hooks,
        documentTitle,
      );
      throwIfAborted(hooks.signal);
      await hooks.afterPairCreate?.();
      throwIfAborted(hooks.signal);
      await validateReservedPair(json, markdown);
      throwIfAborted(hooks.signal);
      return createReservation({
        hooks,
        json,
        markdown,
        ownership,
        pending,
        stem,
        documentTitle,
      });
    } catch (error: unknown) {
      const original = error instanceof ResultPairCollisionError ? error.original : error;
      const abandonFailures =
        hooks.signal?.aborted === true
          ? await closePartialFilesBoundedly([markdown, json], hooks)
          : await abandonPartialPair([markdown, json], original, failurePath, hooks, documentTitle);
      if (abandonFailures.length !== 0) {
        throw aggregateReservationFailure(original, abandonFailures);
      }
      if (error instanceof ResultPairCollisionError) continue;
      throw original;
    }
  }
  throw new Error(
    `Result pair exhausted ${MAX_RESULT_PATH_ATTEMPTS} result-pair suffixes; abandoned partial reservations are retained`,
  );
}

function createReservation(input: {
  readonly documentTitle: string;
  readonly hooks: ResultPairTestHooks;
  readonly json: ReservedResultFile;
  readonly markdown: ReservedResultFile;
  readonly ownership: ResultPairOwnership;
  readonly pending: Readonly<Record<string, unknown>>;
  readonly stem: string;
}): ResultPairReservation {
  let latestPending = input.pending;
  let aborted = false;
  let currentPublicationState: ResultPairPublicationState = "reserved";
  let abortReason: unknown = new Error("Result-pair reservation was aborted");
  let forceClosePromise: Promise<void> | null = null;
  const assertActive = (): void => {
    if (aborted) throw abortReason;
  };
  const abort = (reason: unknown = abortReason): void => {
    if (aborted) return;
    aborted = true;
    currentPublicationState = "reservation-abandoned";
    abortReason = reason;
    forceClosePromise = forceCloseReservedFiles([input.json, input.markdown]);
    void forceClosePromise.catch(() => undefined);
  };
  const forceClose = (reason?: unknown): Promise<void> => {
    abort(reason);
    return forceClosePromise as Promise<void>;
  };
  let publicationTail: Promise<void> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = publicationTail.then(operation, operation);
    publicationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const writeOwnedState = async (
    file: ReservedResultFile,
    text: string,
    state: ResultPairPublicationState,
    signal?: AbortSignal,
  ): Promise<void> => {
    assertActive();
    throwIfAborted(signal);
    await input.hooks.beforeOwnedWrite?.(file.path, state);
    assertActive();
    throwIfAborted(signal);
    await writeReservedFile(file, text, signal, assertActive);
    assertActive();
    throwIfAborted(signal);
  };
  const restoreFailedFinalization = async (
    terminalState: "failed" | "passed",
    phase: "close" | "json" | "markdown",
  ): Promise<readonly ResultFileFailure[]> => {
    assertActive();
    const ownership = Object.freeze({
      failurePhase: phase,
      publicationState: "finalization-failed" as const,
      reservationId: input.ownership.reservationId,
      terminalState,
    });
    const json = formatOwnedJson(latestPending, ownership);
    const markdown = formatOwnedMarkdown(
      [
        `# ${input.documentTitle}`,
        "",
        "- State: `pending`",
        `- Terminal publication failure phase: \`${phase}\``,
        "",
      ].join("\n"),
      ownership,
    );
    const failures: ResultFileFailure[] = [];
    await writeReservedFile(input.json, json, undefined, assertActive).catch((error: unknown) => {
      failures.push(resultFileFailure(input.json, error));
    });
    await writeReservedFile(input.markdown, markdown, undefined, assertActive).catch(
      (error: unknown) => {
        failures.push(resultFileFailure(input.markdown, error));
      },
    );
    return Object.freeze(failures);
  };
  const closeNow = async (signal?: AbortSignal): Promise<void> => {
    throwIfAborted(signal);
    const failures = await closeReservedFiles([input.json, input.markdown], input.hooks);
    if (failures.length !== 0) {
      throw new AggregateError(
        failures.map((failure) => failure.error),
        "Result-pair handles did not close",
      );
    }
    throwIfAborted(signal);
  };
  const close = (signal?: AbortSignal): Promise<void> => serialize(() => closeNow(signal));
  const handleState = () =>
    Object.freeze({
      jsonClosed: input.json.handle === null,
      markdownClosed: input.markdown.handle === null,
    });
  return Object.freeze({
    abort,
    close,
    forceClose,
    handleState,
    jsonPath: input.json.path,
    markdownPath: input.markdown.path,
    ownership: input.ownership,
    publicationState: () => currentPublicationState,
    publishPair(
      json: Readonly<Record<string, unknown>>,
      markdown: string | (() => string),
      state: "failed" | "passed",
      options: Readonly<{
        retainJsonPrimaryOnMarkdownFailure?: true;
        signal?: AbortSignal;
      }> = {},
    ): Promise<void> {
      return serialize(async () => {
        assertActive();
        const signal = options.signal;
        throwIfAborted(signal);
        const ownership = Object.freeze({
          publicationState: state,
          reservationId: input.ownership.reservationId,
        });
        let phase: "close" | "json" | "markdown" = "json";
        try {
          throwIfAborted(signal);
          await validateReservedPair(input.json, input.markdown);
          throwIfAborted(signal);
          await writeOwnedState(input.json, formatOwnedJson(json, ownership), state, signal);
          phase = "markdown";
          const markdownText = typeof markdown === "function" ? markdown() : markdown;
          throwIfAborted(signal);
          await writeOwnedState(
            input.markdown,
            formatOwnedMarkdown(markdownText, ownership),
            state,
            signal,
          );
          throwIfAborted(signal);
          await validateReservedPair(input.json, input.markdown);
          throwIfAborted(signal);
          phase = "close";
          const closeFailures = await closeReservedFiles([input.json, input.markdown], input.hooks);
          if (closeFailures.length !== 0) {
            const recoveryFailures = await restoreFailedFinalization(state, phase);
            throw new ResultPairPublicationError(
              phase,
              toPublicFailures([...closeFailures, ...recoveryFailures]),
            );
          }
          currentPublicationState = state;
        } catch (error: unknown) {
          if (aborted) {
            await forceClosePromise?.catch(() => undefined);
            throw new ResultPairPublicationError(
              phase,
              toPublicFailures([resultFileFailure(input.json, abortReason)]),
            );
          }
          if (error instanceof ResultPairPublicationError) throw error;
          if (signal?.aborted === true) {
            const closeFailures = await closeReservedFiles(
              [input.json, input.markdown],
              input.hooks,
            );
            throw new ResultPairPublicationError(
              phase,
              toPublicFailures([resultFileFailure(input.json, error), ...closeFailures]),
            );
          }
          if (phase === "markdown" && options.retainJsonPrimaryOnMarkdownFailure === true) {
            const recoveryFailures: ResultFileFailure[] = [];
            const markdownOwnership = Object.freeze({
              failurePhase: phase,
              publicationState: "finalization-failed" as const,
              reservationId: input.ownership.reservationId,
              terminalState: state,
            });
            await writeReservedFile(
              input.markdown,
              formatOwnedMarkdown(
                [
                  `# ${input.documentTitle}`,
                  "",
                  "- State: `finalization-failed`",
                  "- Primary terminal JSON retained: `true`",
                  "",
                ].join("\n"),
                markdownOwnership,
              ),
              undefined,
              assertActive,
            ).catch((recoveryError: unknown) => {
              recoveryFailures.push(resultFileFailure(input.markdown, recoveryError));
            });
            const closeFailures = await closeReservedFiles(
              [input.json, input.markdown],
              input.hooks,
            );
            throw new ResultPairPublicationError(
              phase,
              toPublicFailures([
                resultFileFailure(input.markdown, error),
                ...recoveryFailures,
                ...closeFailures,
              ]),
            );
          }
          const recoveryFailures = await restoreFailedFinalization(state, phase);
          throw new ResultPairPublicationError(phase, toPublicFailures(recoveryFailures));
        }
      });
    },
    publishPendingJson(
      json: Readonly<Record<string, unknown>>,
      signal?: AbortSignal,
    ): Promise<void> {
      return serialize(async () => {
        assertActive();
        throwIfAborted(signal);
        latestPending = json;
        const ownership = Object.freeze({
          publicationState: "pending" as const,
          reservationId: input.ownership.reservationId,
        });
        await validateReservedPair(input.json, input.markdown);
        throwIfAborted(signal);
        currentPublicationState = "pending";
        await writeOwnedState(input.json, formatOwnedJson(json, ownership), "pending", signal);
        throwIfAborted(signal);
        await validateReservedPair(input.json, input.markdown);
        throwIfAborted(signal);
      });
    },
    stem: input.stem,
  });
}

async function createReservedFile(
  path: string,
  logicalPath: ResultLogicalPath,
  reservationId: string,
  initial: string,
  hooks: ResultPairTestHooks,
  documentTitle: string,
): Promise<ReservedResultFile> {
  let handle: FileHandle;
  try {
    await hooks.beforeCreate?.(path);
    handle = await open(path, "wx+");
  } catch (error: unknown) {
    if (isAlreadyExists(error)) throw new ResultPairCollisionError(error);
    throw error;
  }
  const file: ReservedResultFile = {
    closeAttempts: 0,
    handle,
    hooks,
    identity: null,
    logicalPath,
    path,
    reservationId,
  };
  try {
    await hooks.beforeHandleStat?.(path, "initial");
    const stat = await handle.stat({ bigint: true });
    file.identity = Object.freeze({ dev: stat.dev, ino: stat.ino });
    await validateReservedFile(file, false);
    await writeBytes(handle, initial);
    await validateReservedFile(file, true);
    return file;
  } catch (error: unknown) {
    const abandonFailures = await abandonPartialPair(
      [file],
      error,
      logicalPath,
      hooks,
      documentTitle,
    );
    if (abandonFailures.length !== 0) {
      throw aggregateReservationFailure(error, abandonFailures);
    }
    throw error;
  }
}

async function validateReservedPair(
  json: ReservedResultFile,
  markdown: ReservedResultFile,
): Promise<void> {
  await validateReservedFile(json, true);
  await validateReservedFile(markdown, true);
  const jsonIdentity = requireReservedIdentity(json);
  const markdownIdentity = requireReservedIdentity(markdown);
  if (sameIdentity(jsonIdentity, markdownIdentity)) {
    throw new Error("Result pair resolves to one file identity");
  }
}

async function validateReservedFile(
  file: ReservedResultFile,
  requireToken: boolean,
): Promise<void> {
  const handle = await ensureReservedHandle(file);
  await file.hooks.beforeHandleStat?.(file.path, "routine");
  const [handleStat, pathStat] = await Promise.all([
    handle.stat({ bigint: true }),
    lstat(file.path, { bigint: true }),
  ]);
  if (
    !handleStat.isFile() ||
    handleStat.isSymbolicLink() ||
    !pathStat.isFile() ||
    pathStat.isSymbolicLink()
  ) {
    throw new Error(`Result-pair ${file.logicalPath} is not a regular direct file`);
  }
  if (handleStat.nlink !== 1n || pathStat.nlink !== 1n) {
    throw new Error(`Result-pair ${file.logicalPath} link count is not one`);
  }
  if (
    !sameIdentity(requireReservedIdentity(file), { dev: handleStat.dev, ino: handleStat.ino }) ||
    !sameIdentity(requireReservedIdentity(file), { dev: pathStat.dev, ino: pathStat.ino })
  ) {
    throw new Error(`Result-pair ${file.logicalPath} path identity changed`);
  }
  if (requireToken) {
    assertOwned(await readHandleText(handle), file.reservationId);
  }
}

async function ensureReservedHandle(file: ReservedResultFile): Promise<FileHandle> {
  if (file.handle !== null) return file.handle;
  const identity = requireReservedIdentity(file);
  const handle = await open(file.path, "r+");
  file.handle = handle;
  try {
    await file.hooks.beforeHandleStat?.(file.path, "reopen");
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
      !sameIdentity(identity, { dev: handleStat.dev, ino: handleStat.ino }) ||
      !sameIdentity(identity, { dev: pathStat.dev, ino: pathStat.ino })
    ) {
      throw new Error(`Result-pair ${file.logicalPath} cannot reopen exact identity`);
    }
    assertOwned(await readHandleText(handle), file.reservationId);
    return handle;
  } catch (error: unknown) {
    const closeFailure = await closeReservedFile(file, file.hooks, true);
    if (closeFailure !== null) {
      throw new AggregateError(
        [error, closeFailure.error],
        `Result-pair ${file.logicalPath} reopen validation and close failed`,
      );
    }
    throw error;
  }
}

function requireReservedIdentity(file: ReservedResultFile): ReservedFileIdentity {
  if (file.identity === null) {
    throw new Error(`Result-pair ${file.logicalPath} identity is unavailable`);
  }
  return file.identity;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw signal.reason;
}

async function writeReservedFile(
  file: ReservedResultFile,
  value: string,
  signal?: AbortSignal,
  assertWritable: () => void = () => undefined,
): Promise<void> {
  assertWritable();
  throwIfAborted(signal);
  await validateReservedFile(file, true);
  assertWritable();
  throwIfAborted(signal);
  assertOwned(value, file.reservationId);
  const handle = await ensureReservedHandle(file);
  assertWritable();
  throwIfAborted(signal);
  await writeBytes(handle, value, signal, assertWritable, async (writtenBytes, totalBytes) => {
    await file.hooks.afterOwnedWriteChunk?.(file.path, file.logicalPath, writtenBytes, totalBytes);
  });
  assertWritable();
  throwIfAborted(signal);
  await validateReservedFile(file, true);
  assertWritable();
  throwIfAborted(signal);
}

async function writeBytes(
  handle: FileHandle,
  value: string,
  signal?: AbortSignal,
  assertWritable: () => void = () => undefined,
  afterChunk: (writtenBytes: number, totalBytes: number) => Promise<void> = async () => undefined,
): Promise<void> {
  const bytes = Buffer.from(value);
  let written = 0;
  while (written < bytes.length) {
    assertWritable();
    throwIfAborted(signal);
    const chunkBytes = Math.min(MAX_OWNED_WRITE_CHUNK_BYTES, bytes.length - written);
    const result = await handle.write(bytes, written, chunkBytes, written);
    assertWritable();
    throwIfAborted(signal);
    if (result.bytesWritten <= 0) {
      throw new Error("Owned result-pair write made no progress");
    }
    written += result.bytesWritten;
    await afterChunk(written, bytes.length);
    assertWritable();
    throwIfAborted(signal);
  }
  assertWritable();
  throwIfAborted(signal);
  await handle.truncate(bytes.length);
  assertWritable();
  throwIfAborted(signal);
  await handle.sync();
  assertWritable();
  throwIfAborted(signal);
}

async function forceCloseReservedFiles(
  files: readonly (ReservedResultFile | null)[],
): Promise<void> {
  const failures = (
    await Promise.all(
      files.map(async (file) => {
        if (file === null || file.handle === null) return null;
        return closeReservedFile(file, file.hooks, false);
      }),
    )
  )
    .filter((failure) => failure !== null)
    .map((failure) => failure.error);
  if (failures.length !== 0) {
    throw new AggregateError(failures, "Result-pair force-close failed");
  }
}

async function readHandleText(handle: FileHandle): Promise<string> {
  const stat = await handle.stat();
  if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > 8 * 1024 * 1024) {
    throw new Error("Owned result-pair size is invalid");
  }
  const bytes = Buffer.alloc(stat.size);
  let read = 0;
  while (read < bytes.length) {
    const result = await handle.read(bytes, read, bytes.length - read, read);
    if (result.bytesRead <= 0) {
      throw new Error("Owned result-pair read ended early");
    }
    read += result.bytesRead;
  }
  return bytes.toString("utf8");
}

async function abandonPartialPair(
  files: readonly (ReservedResultFile | null)[],
  original: unknown,
  failurePath: ResultLogicalPath,
  hooks: ResultPairTestHooks,
  documentTitle = "Harness result",
): Promise<readonly ResultFileFailure[]> {
  const failures: ResultFileFailure[] = [];
  const failure = boundedFailure(original, failurePath);
  try {
    for (const file of files) {
      if (file === null) continue;
      try {
        await hooks.beforePartialAbandon?.(file.path, file.logicalPath);
        const ownership = Object.freeze({
          failure,
          publicationState: "reservation-abandoned" as const,
          reservationId: file.reservationId,
        });
        const value =
          file.logicalPath === "result-json"
            ? formatOwnedJson({ failure, state: "reservation-abandoned" }, ownership)
            : formatOwnedMarkdown(
                [
                  `# ${documentTitle}`,
                  "",
                  "- State: `reservation-abandoned`",
                  `- Reservation failure path: \`${failure.path}\``,
                  `- Reservation failure message: ${failure.message}`,
                  "",
                ].join("\n"),
                ownership,
              );
        if (file.identity === null) {
          if (file.handle === null) {
            throw new Error(
              `Result-pair ${file.logicalPath} lost its pre-identity reservation handle`,
            );
          }
          assertOwned(value, file.reservationId);
          await writeBytes(file.handle, value);
        } else {
          await writeReservedFile(file, value);
        }
      } catch (error: unknown) {
        failures.push(resultFileFailure(file, error));
      }
    }
  } finally {
    failures.push(...(await closePartialFilesBoundedly(files, hooks)));
  }
  return Object.freeze(failures);
}

async function closePartialFilesBoundedly(
  files: readonly (ReservedResultFile | null)[],
  hooks: ResultPairTestHooks,
): Promise<readonly ResultFileFailure[]> {
  const failures: ResultFileFailure[] = [];
  for (let attempt = 0; attempt < MAX_PARTIAL_CLOSE_ATTEMPTS; attempt += 1) {
    if (!files.some((file) => file !== null && file.handle !== null)) break;
    failures.push(...(await closeReservedFiles(files, hooks)));
  }

  // Keep the complete owner array reachable through one last uninstrumented
  // close attempt. Test hooks cannot manufacture a leaked descriptor by
  // rejecting before the actual FileHandle.close().
  for (const file of files) {
    if (file === null || file.handle === null) continue;
    const finalFailure = await closeReservedFile(file, hooks, false);
    if (finalFailure !== null) {
      failures.push(finalFailure);
      processRetainedResultFiles.add(file);
    }
  }
  return Object.freeze(failures);
}

async function closeReservedFiles(
  files: readonly (ReservedResultFile | null)[],
  hooks: ResultPairTestHooks,
): Promise<readonly ResultFileFailure[]> {
  const failures: ResultFileFailure[] = [];
  for (const file of files) {
    if (file === null || file.handle === null) continue;
    const failure = await closeReservedFile(file, hooks, true);
    if (failure !== null) failures.push(failure);
  }
  return Object.freeze(failures);
}

async function closeReservedFile(
  file: ReservedResultFile,
  hooks: ResultPairTestHooks,
  useHook: boolean,
): Promise<ResultFileFailure | null> {
  if (file.handle === null) return null;
  const handle = file.handle;
  file.closeAttempts += 1;
  try {
    if (useHook) {
      await hooks.beforeHandleClose?.(file.path, file.logicalPath, file.closeAttempts);
    }
    await handle.close();
    file.handle = null;
    processRetainedResultFiles.delete(file);
    await hooks.afterHandleClose?.(file.path, file.logicalPath, file.closeAttempts);
    return null;
  } catch (error: unknown) {
    return resultFileFailure(file, error);
  }
}

function aggregateReservationFailure(
  original: unknown,
  failures: readonly ResultFileFailure[],
): AggregateError {
  return new AggregateError(
    [original, ...failures.map((failure) => failure.error)],
    "Result-pair reservation and abandonment failed",
  );
}

function boundedFailure(
  error: unknown,
  path: ResultLogicalPath,
): Readonly<{ code: string | null; message: string; path: ResultLogicalPath }> {
  return Object.freeze({
    code:
      error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : null,
    message: boundedMessage(error),
    path,
  });
}

function resultFileFailure(file: ReservedResultFile, error: unknown): ResultFileFailure {
  return Object.freeze({
    error,
    message: boundedMessage(error),
    path: file.logicalPath,
  });
}

function toPublicFailures(
  failures: readonly ResultFileFailure[],
): readonly Readonly<{ message: string; path: ResultLogicalPath }>[] {
  return Object.freeze(failures.map(({ message, path }) => Object.freeze({ message, path })));
}

function formatOwnedJson(
  value: Readonly<Record<string, unknown>>,
  ownership: Readonly<Record<string, unknown>>,
): string {
  const payload = { ...value };
  delete payload.resultOwnership;
  delete payload.resultReservationId;
  return `${JSON.stringify(
    {
      resultReservationId: ownership.reservationId,
      ...payload,
      resultOwnership: ownership,
    },
    null,
    2,
  )}\n`;
}

function formatOwnedMarkdown(value: string, ownership: Readonly<Record<string, unknown>>): string {
  const lines = [
    `<!-- parallax-result-reservation:${String(ownership.reservationId)} -->`,
    value.trimEnd(),
    `- Result reservation: \`${String(ownership.reservationId)}\``,
    `- Publication state: \`${String(ownership.publicationState)}\``,
  ];
  if ("terminalState" in ownership) {
    lines.push(`- Intended terminal state: \`${String(ownership.terminalState)}\``);
  }
  return `${lines.join("\n")}\n`;
}

function assertOwned(value: string, reservationId: string): void {
  if (!value.includes(reservationId)) {
    throw new Error("Result-pair ownership token does not match");
  }
}

function sameIdentity(left: ReservedFileIdentity, right: ReservedFileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function boundedMessage(error: unknown): string {
  return (error instanceof Error && error.message !== "" ? error.message : String(error))
    .replaceAll(/\s+/g, " ")
    .replaceAll(/\b[A-Za-z]:\\[^\s'"]+/g, "<path>")
    .replaceAll(/(?:^|\s)\/[^\s'"]+/g, " <path>")
    .replaceAll(/\b(token|password|authorization|secret)=([^\s&]+)/gi, "$1=<redacted>")
    .trim()
    .slice(0, 200);
}
