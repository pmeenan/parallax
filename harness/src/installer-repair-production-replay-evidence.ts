import { createHash, randomUUID } from "node:crypto";
import { type FileHandle, lstat, mkdir, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  INSTALLER_REPAIR_PRODUCTION_REPLAY_SCHEMA_VERSION,
  validateProductionReplayResult,
} from "./installer-repair-production-replay-contract.js";

const MAX_RESULT_ATTEMPTS = 100;
const MAX_CLOSE_ATTEMPTS = 3;
const MAX_CAUSE_DEPTH = 5;
const MAX_CAUSE_CHILDREN = 12;
const MAX_FAILURE_MESSAGE = 320;
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_MARKDOWN_BYTES = 16 * 1024 * 1024;
const MAX_RECOVERY_BYTES = 1024 * 1024;

type LogicalPath = "json" | "markdown" | "recovery";
type EvidenceOperation =
  | "close"
  | "create"
  | "flush"
  | "pending-write"
  | "read"
  | "reopen"
  | "reopen-read"
  | "stat"
  | "terminal-write"
  | "verify";
export type ProductionReplayRecoveryState =
  | "finalization-failed"
  | "pair-terminal-authorized"
  | "reservation-open";
type RecoveryState = ProductionReplayRecoveryState;

interface PairAuthorization {
  readonly canonicalPayloadSha256: string;
  readonly jsonSha256: string;
  readonly markdownSha256: string;
  readonly pairPublicationState: "failed" | "passed";
}

export interface ProductionReplayEvidenceTestHooks {
  readonly beforeOperation?: (
    operation: EvidenceOperation,
    logicalPath: LogicalPath,
    attempt: number,
    path: string,
  ) => Promise<void>;
  readonly closeOperation?: (
    logicalPath: LogicalPath,
    attempt: number,
    path: string,
    close: () => Promise<void>,
  ) => Promise<void>;
}

export interface ProductionReplayFailureCause {
  readonly causes: readonly ProductionReplayFailureCause[];
  readonly kind: "aggregate" | "error" | "thrown";
  readonly message: string;
  readonly name: string;
  readonly operation: string;
}

export interface ProductionReplayCanonicalBinding {
  readonly payloadBase64url: string;
  readonly payloadSha256: string;
}

export interface ProductionReplayEvidenceHashes {
  readonly canonicalPayloadSha256: string;
  readonly jsonSha256: string;
  readonly markdownSha256: string;
  readonly recoverySha256: string;
}

export interface ProductionReplayEvidenceAdjudication {
  readonly pairState: string;
  readonly recoveryState: RecoveryState;
  readonly verdict:
    | "authorized-terminal"
    | "authorized-terminal-not-published"
    | "finalization-failed"
    | "reservation-open";
}

export interface RetainedLegacyV1Expectation {
  readonly canonicalPayloadSha256: string;
  readonly jsonSha256: string;
  readonly markdownSha256: string;
  readonly state: "failed" | "passed";
}

export const RETAINED_PRODUCTION_REPLAY_V1_FAILED = Object.freeze({
  canonicalPayloadSha256: "97ab87588b091d026a759af3e9f82ee536a784207059c76f2ef1346c7df91046",
  jsonSha256: "3f50b2e7fdcb74303f404bfb7c385510227a7cc10c1f12ca2b57eb4060eef60a",
  markdownSha256: "c068cf18e91a1507bbe1af338d3a2ba2efa1e5c10725ab98803987b12549b962",
  state: "failed" as const,
});
export const RETAINED_PRODUCTION_REPLAY_V1_PASSED = Object.freeze({
  canonicalPayloadSha256: "75e996456fbee1223a6008a04fb07105670217bfc1eb2fcb8aec541f195598a7",
  jsonSha256: "80c5c14bf550357c5815141e0c8398aeba0714a5eef0647c06616f50356938b6",
  markdownSha256: "252a3caf8b5edd15e3ab418ad7b45a88ada84841affaa444d55c3eec391e59f9",
  state: "passed" as const,
});

export interface ProductionReplayEvidenceReservation {
  readonly jsonPath: string;
  readonly markdownPath: string;
  readonly recoveryPath: string;
  readonly reservationId: string;
  readonly stem: string;
  readonly publishTerminal: (
    terminal: Readonly<Record<string, unknown>>,
    state: "failed" | "passed",
  ) => Promise<ProductionReplayEvidenceHashes>;
}

interface OwnedFile {
  closeAttempts: number;
  handle: FileHandle | null;
  identity: Readonly<{ dev: bigint; ino: bigint }> | null;
  readonly logicalPath: LogicalPath;
  readonly path: string;
}

interface OwnedReservation {
  readonly files: readonly OwnedFile[];
  readonly hooks: ProductionReplayEvidenceTestHooks;
  readonly json: OwnedFile;
  readonly markdown: OwnedFile;
  readonly recovery: OwnedFile;
  readonly reservationId: string;
  readonly stem: string;
}

export class ProductionReplayEvidenceError extends AggregateError {
  public readonly causes: readonly ProductionReplayFailureCause[];

  public constructor(message: string, failures: readonly unknown[]) {
    super(failures, message);
    this.name = "ProductionReplayEvidenceError";
    this.causes = Object.freeze(
      failures.map((failure) => sanitizeProductionReplayFailure(failure, "evidence-lifecycle")),
    );
  }
}

export async function reserveProductionReplayEvidence(
  repositoryRoot: string,
  startedAt: string,
  pending: Readonly<Record<string, unknown>>,
  hooks: ProductionReplayEvidenceTestHooks = {},
): Promise<ProductionReplayEvidenceReservation> {
  const resultRoot = resolve(repositoryRoot, "harness/results/installer-repair-production-replay");
  await mkdir(resultRoot, { recursive: true });
  const baseStem = `installer-repair-production-replay-v${String(
    pending.schemaVersion,
  )}-${startedAt.replaceAll(/[:.]/g, "-")}`;
  for (let ordinal = 0; ordinal < MAX_RESULT_ATTEMPTS; ordinal += 1) {
    const stem = ordinal === 0 ? baseStem : `${baseStem}-${ordinal}`;
    const reservationId = randomUUID();
    const created: OwnedFile[] = [];
    try {
      for (const logicalPath of ["json", "markdown", "recovery"] as const) {
        const extension =
          logicalPath === "json" ? "json" : logicalPath === "markdown" ? "md" : "recovery.json";
        await createOwnedFile(
          join(resultRoot, `${stem}.${extension}`),
          logicalPath,
          hooks,
          (file) => created.push(file),
        );
      }
      for (const file of created) {
        await establishOwnedIdentity(file, hooks);
      }
      const reservation: OwnedReservation = {
        files: created,
        hooks,
        json: requireOwned(created, "json"),
        markdown: requireOwned(created, "markdown"),
        recovery: requireOwned(created, "recovery"),
        reservationId,
        stem,
      };
      await writePendingPair(reservation, pending);
      await writeOwned(
        reservation,
        reservation.recovery,
        recoveryRecord(reservation, "reservation-open", null, null),
        "pending-write",
      );
      await verifyRetainedRecovery(reservation, "reservation-open", null, null);
      return publicReservation(reservation);
    } catch (error: unknown) {
      const collision = isAlreadyExists(error);
      const failure = sanitizeProductionReplayFailure(error, "reservation");
      const cleanup: unknown[] = [];
      for (const file of created) {
        if (file.identity === null && file.handle !== null) {
          await establishOwnedIdentity(file, hooks).catch((item: unknown) => cleanup.push(item));
        }
      }
      for (const file of created) {
        await writeOwnedRaw(
          file,
          ownedJson(
            {
              failure,
              schemaVersion: pending.schemaVersion,
              state: "reservation-abandoned",
            },
            reservationId,
            "reservation-abandoned",
          ),
          hooks,
          "terminal-write",
        ).catch((item: unknown) => cleanup.push(item));
      }
      cleanup.push(...(await closeAll(created, hooks)));
      if (cleanup.length !== 0) {
        throw new ProductionReplayEvidenceError("Evidence reservation cleanup failed", [
          error,
          ...cleanup,
        ]);
      }
      if (collision) continue;
      throw new ProductionReplayEvidenceError("Evidence reservation failed", [error]);
    }
  }
  throw new Error("Production replay evidence suffix space exhausted");
}

function publicReservation(reservation: OwnedReservation): ProductionReplayEvidenceReservation {
  return Object.freeze({
    jsonPath: reservation.json.path,
    markdownPath: reservation.markdown.path,
    recoveryPath: reservation.recovery.path,
    reservationId: reservation.reservationId,
    stem: reservation.stem,
    async publishTerminal(terminal: Readonly<Record<string, unknown>>, state: "failed" | "passed") {
      const bound = bindProductionReplayEvidence(terminal);
      const jsonText = ownedJson(bound, reservation.reservationId, state);
      const markdownText = ownedMarkdown(
        formatProductionReplayMarkdown(bound),
        reservation.reservationId,
        state,
      );
      const authorization: PairAuthorization = Object.freeze({
        canonicalPayloadSha256: parseCanonicalBinding(bound.canonicalBinding).payloadSha256,
        jsonSha256: sha256(new TextEncoder().encode(jsonText)),
        markdownSha256: sha256(new TextEncoder().encode(markdownText)),
        pairPublicationState: state,
      });
      const failures: unknown[] = [];
      let authorizationDurable = false;
      try {
        await writeOwned(
          reservation,
          reservation.recovery,
          recoveryRecord(reservation, "pair-terminal-authorized", authorization, null),
          "terminal-write",
        );
        await verifyRetainedRecovery(reservation, "pair-terminal-authorized", authorization, null);
        const authorizationClose = await closeAll([reservation.recovery], reservation.hooks);
        if (authorizationClose.length !== 0) {
          throw new AggregateError(authorizationClose, "authorization close failed");
        }
        const reopenedRecovery = await verifyReopenedRecovery(
          reservation,
          "pair-terminal-authorized",
          authorization,
          null,
        );
        authorizationDurable = true;

        await writeOwnedRaw(reservation.json, jsonText, reservation.hooks, "terminal-write");
        await writeOwnedRaw(
          reservation.markdown,
          markdownText,
          reservation.hooks,
          "terminal-write",
        );
        await verifyRetainedPair(reservation, bound, state);
        const closeFailures = await closeAll(
          [reservation.json, reservation.markdown],
          reservation.hooks,
        );
        if (closeFailures.length !== 0) {
          throw new AggregateError(closeFailures, "pair close failed");
        }
        const reopened = await verifyReopenedPair(reservation, bound, state);
        if (
          sha256(reopened.json) !== authorization.jsonSha256 ||
          sha256(reopened.markdown) !== authorization.markdownSha256
        ) {
          throw new Error("Terminal pair differs from its durable authorization");
        }
        return Object.freeze({
          canonicalPayloadSha256: authorization.canonicalPayloadSha256,
          jsonSha256: authorization.jsonSha256,
          markdownSha256: authorization.markdownSha256,
          recoverySha256: sha256(reopenedRecovery),
        });
      } catch (error: unknown) {
        failures.push(error);
        const structured = sanitizeProductionReplayFailure(error, "terminal-publication");
        const fallback = bindProductionReplayEvidence({
          ...terminal,
          evidenceFailure: structured,
          state: "finalization-failed",
          terminalState: state,
        });
        for (const file of [reservation.json, reservation.markdown]) {
          if (file.handle === null) {
            await reopenOwnedForWrite(file, reservation.hooks).catch((item: unknown) =>
              failures.push(item),
            );
          }
        }
        if (reservation.json.handle !== null) {
          await writeOwned(
            reservation,
            reservation.json,
            ownedJson(fallback, reservation.reservationId, "finalization-failed"),
            "terminal-write",
          ).catch((item: unknown) => failures.push(item));
        }
        if (reservation.markdown.handle !== null) {
          await writeOwned(
            reservation,
            reservation.markdown,
            ownedMarkdown(
              formatProductionReplayMarkdown(fallback),
              reservation.reservationId,
              "finalization-failed",
            ),
            "terminal-write",
          ).catch((item: unknown) => failures.push(item));
        }
        if (reservation.json.handle !== null && reservation.markdown.handle !== null) {
          await verifyRetainedPair(reservation, fallback, "finalization-failed").catch(
            (item: unknown) => failures.push(item),
          );
        }
        const fallbackClose = await closeAll(
          [reservation.json, reservation.markdown],
          reservation.hooks,
        );
        failures.push(...fallbackClose);
        if (fallbackClose.length === 0) {
          await verifyReopenedPair(reservation, fallback, "finalization-failed").catch(
            (item: unknown) => failures.push(item),
          );
        }
        const completeFailure = sanitizeProductionReplayFailure(
          new AggregateError(failures, "terminal evidence and cleanup failed"),
          "terminal-publication",
        );
        if (!authorizationDurable) {
          if (reservation.recovery.handle === null) {
            await reopenOwnedForWrite(reservation.recovery, reservation.hooks).catch(
              (item: unknown) => failures.push(item),
            );
          }
          if (reservation.recovery.handle !== null) {
            await writeOwned(
              reservation,
              reservation.recovery,
              recoveryRecord(reservation, "finalization-failed", null, completeFailure),
              "terminal-write",
            ).catch((item: unknown) => failures.push(item));
            await verifyRetainedRecovery(
              reservation,
              "finalization-failed",
              null,
              completeFailure,
            ).catch((item: unknown) => failures.push(item));
          }
          const recoveryClose = await closeAll([reservation.recovery], reservation.hooks);
          failures.push(...recoveryClose);
          if (recoveryClose.length === 0) {
            await verifyReopenedRecovery(
              reservation,
              "finalization-failed",
              null,
              completeFailure,
            ).catch((item: unknown) => failures.push(item));
          }
        }
        throw new ProductionReplayEvidenceError(
          "Production replay evidence finalization failed",
          failures,
        );
      }
    },
  });
}

async function createOwnedFile(
  path: string,
  logicalPath: LogicalPath,
  hooks: ProductionReplayEvidenceTestHooks,
  register: (file: OwnedFile) => void,
): Promise<OwnedFile> {
  await hook(hooks, "create", logicalPath, 1, path);
  const handle = await open(path, "wx+");
  const file: OwnedFile = {
    closeAttempts: 0,
    handle,
    identity: null,
    logicalPath,
    path,
  };
  register(file);
  return file;
}

async function reopenOwnedForWrite(
  file: OwnedFile,
  hooks: ProductionReplayEvidenceTestHooks,
): Promise<void> {
  await hook(hooks, "reopen", file.logicalPath, 1, file.path);
  const handle = await open(file.path, "r+");
  file.handle = handle;
  try {
    await validateOwned(file, hooks, "stat");
  } catch (error: unknown) {
    try {
      await handle.close();
      file.handle = null;
    } catch (closeError: unknown) {
      throw new ProductionReplayEvidenceError("Owned evidence reopen and close failed", [
        error,
        closeError,
      ]);
    }
    throw error;
  }
}

async function establishOwnedIdentity(
  file: OwnedFile,
  hooks: ProductionReplayEvidenceTestHooks,
): Promise<void> {
  const handle = requireHandle(file);
  await hook(hooks, "stat", file.logicalPath, 1, file.path);
  const stat = await handle.stat({ bigint: true });
  if (!stat.isFile() || stat.nlink !== 1n) {
    throw new Error("Reserved evidence is not a direct file");
  }
  file.identity = Object.freeze({ dev: stat.dev, ino: stat.ino });
  await validateOwned(file, hooks, "stat");
}

async function writePendingPair(
  reservation: OwnedReservation,
  pending: Readonly<Record<string, unknown>>,
): Promise<void> {
  const bound = bindProductionReplayEvidence(pending);
  await writeOwned(
    reservation,
    reservation.json,
    ownedJson(bound, reservation.reservationId, "pending"),
    "pending-write",
  );
  await writeOwned(
    reservation,
    reservation.markdown,
    ownedMarkdown(formatProductionReplayMarkdown(bound), reservation.reservationId, "pending"),
    "pending-write",
  );
  await verifyRetainedPair(reservation, bound, "pending");
}

async function writeOwned(
  reservation: OwnedReservation,
  file: OwnedFile,
  value: string,
  operation: "pending-write" | "terminal-write",
): Promise<void> {
  await writeOwnedRaw(file, value, reservation.hooks, operation);
}

async function writeOwnedRaw(
  file: OwnedFile,
  value: string,
  hooks: ProductionReplayEvidenceTestHooks,
  operation: "pending-write" | "terminal-write",
): Promise<void> {
  const handle = requireHandle(file);
  await validateOwned(file, hooks, "stat");
  await hook(hooks, operation, file.logicalPath, 1, file.path);
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength > byteCeiling(file.logicalPath)) {
    throw new Error("Evidence write exceeds its byte ceiling");
  }
  await handle.truncate(0);
  const { bytesWritten } = await handle.write(bytes, 0, bytes.byteLength, 0);
  if (bytesWritten !== bytes.byteLength) throw new Error("Evidence write was short");
  await hook(hooks, "flush", file.logicalPath, 1, file.path);
  await handle.sync();
  await validateOwned(file, hooks, "stat");
}

async function readOwned(
  file: OwnedFile,
  hooks: ProductionReplayEvidenceTestHooks,
  operation: "read" | "reopen-read",
): Promise<Uint8Array> {
  const handle = requireHandle(file);
  await validateOwned(file, hooks, "stat");
  await hook(hooks, operation, file.logicalPath, 1, file.path);
  const stat = await handle.stat();
  if (stat.size > byteCeiling(file.logicalPath)) {
    throw new Error("Evidence read exceeds its byte ceiling");
  }
  const bytes = Buffer.alloc(stat.size);
  const { bytesRead } = await handle.read(bytes, 0, bytes.byteLength, 0);
  if (bytesRead !== bytes.byteLength) throw new Error("Evidence read was short");
  return bytes;
}

async function verifyRetainedPair(
  reservation: OwnedReservation,
  bound: Readonly<Record<string, unknown>>,
  state: string,
): Promise<void> {
  await hook(reservation.hooks, "verify", "json", 1, reservation.json.path);
  const [json, markdown] = await Promise.all([
    readOwned(reservation.json, reservation.hooks, "read"),
    readOwned(reservation.markdown, reservation.hooks, "read"),
  ]);
  verifyPairBytes(json, markdown, bound, reservation.reservationId, state);
}

async function verifyReopenedPair(
  reservation: OwnedReservation,
  bound: Readonly<Record<string, unknown>>,
  state: string,
): Promise<Readonly<{ json: Uint8Array; markdown: Uint8Array }>> {
  const reopened: OwnedFile[] = [];
  try {
    for (const original of [reservation.json, reservation.markdown]) {
      await hook(reservation.hooks, "reopen", original.logicalPath, 1, original.path);
      const handle = await open(original.path, "r");
      const file: OwnedFile = { ...original, closeAttempts: 0, handle };
      reopened.push(file);
      await validateOwned(file, reservation.hooks, "stat");
    }
    const json = await readOwned(requireOwned(reopened, "json"), reservation.hooks, "reopen-read");
    const markdown = await readOwned(
      requireOwned(reopened, "markdown"),
      reservation.hooks,
      "reopen-read",
    );
    verifyPairBytes(json, markdown, bound, reservation.reservationId, state);
    const failures = await closeAll(reopened, reservation.hooks);
    if (failures.length !== 0) throw new AggregateError(failures, "reopen close failed");
    return Object.freeze({ json, markdown });
  } catch (error: unknown) {
    const failures = await closeAll(reopened, reservation.hooks);
    throw new ProductionReplayEvidenceError("Reopened evidence verification failed", [
      error,
      ...failures,
    ]);
  }
}

function verifyPairBytes(
  jsonBytes: Uint8Array,
  markdownBytes: Uint8Array,
  bound: Readonly<Record<string, unknown>>,
  reservationId: string,
  state: string,
): void {
  const parsed = parseProductionReplayEvidence(JSON.parse(Buffer.from(jsonBytes).toString("utf8")));
  assertExactOwnership(parsed, reservationId, state);
  const withoutOwnership = { ...parsed };
  delete withoutOwnership.resultOwnership;
  delete withoutOwnership.resultReservationId;
  if (JSON.stringify(withoutOwnership) !== JSON.stringify(bound)) {
    throw new Error("Evidence JSON semantic projection differs");
  }
  const expected = ownedMarkdown(formatProductionReplayMarkdown(bound), reservationId, state);
  if (Buffer.from(markdownBytes).toString("utf8") !== expected) {
    throw new Error("Evidence Markdown semantic projection differs");
  }
}

async function verifyRetainedRecovery(
  reservation: OwnedReservation,
  state: RecoveryState,
  authorization: PairAuthorization | null,
  failure: ProductionReplayFailureCause | null,
): Promise<Uint8Array> {
  await hook(reservation.hooks, "verify", "recovery", 1, reservation.recovery.path);
  const bytes = await readOwned(reservation.recovery, reservation.hooks, "read");
  parseRecoveryRecord(
    JSON.parse(Buffer.from(bytes).toString("utf8")),
    reservation,
    state,
    authorization,
    failure,
  );
  return bytes;
}

async function verifyReopenedRecovery(
  reservation: OwnedReservation,
  state: RecoveryState,
  authorization: PairAuthorization | null,
  failure: ProductionReplayFailureCause | null,
): Promise<Uint8Array> {
  await hook(reservation.hooks, "reopen", "recovery", 1, reservation.recovery.path);
  const handle = await open(reservation.recovery.path, "r");
  reservation.recovery.handle = handle;
  try {
    await validateOwned(reservation.recovery, reservation.hooks, "stat");
    const bytes = await readOwned(reservation.recovery, reservation.hooks, "reopen-read");
    parseRecoveryRecord(
      JSON.parse(Buffer.from(bytes).toString("utf8")),
      reservation,
      state,
      authorization,
      failure,
    );
    const failures = await closeAll([reservation.recovery], reservation.hooks);
    if (failures.length !== 0) throw new AggregateError(failures, "recovery reopen close failed");
    return bytes;
  } catch (error: unknown) {
    const failures = await closeAll([reservation.recovery], reservation.hooks);
    throw new ProductionReplayEvidenceError("Reopened recovery verification failed", [
      error,
      ...failures,
    ]);
  }
}

async function validateOwned(
  file: OwnedFile,
  hooks: ProductionReplayEvidenceTestHooks,
  operation: EvidenceOperation,
): Promise<void> {
  const handle = requireHandle(file);
  const identity = file.identity;
  if (identity === null) throw new Error("Evidence identity is not established");
  await hook(hooks, operation, file.logicalPath, 1, file.path);
  const [descriptor, pathname] = await Promise.all([
    handle.stat({ bigint: true }),
    lstat(file.path, { bigint: true }),
  ]);
  if (
    !descriptor.isFile() ||
    !pathname.isFile() ||
    descriptor.nlink !== 1n ||
    pathname.nlink !== 1n ||
    descriptor.size > BigInt(byteCeiling(file.logicalPath)) ||
    pathname.size > BigInt(byteCeiling(file.logicalPath)) ||
    descriptor.dev !== identity.dev ||
    descriptor.ino !== identity.ino ||
    pathname.dev !== identity.dev ||
    pathname.ino !== identity.ino
  ) {
    throw new Error("Evidence pathname/descriptor identity differs");
  }
}

async function closeAll(
  files: readonly OwnedFile[],
  hooks: ProductionReplayEvidenceTestHooks,
): Promise<readonly unknown[]> {
  const failures: unknown[] = [];
  for (const file of files) {
    for (let attempt = 1; file.handle !== null && attempt <= MAX_CLOSE_ATTEMPTS; attempt += 1) {
      file.closeAttempts += 1;
      try {
        await validateOwned(file, hooks, "stat");
        await hook(hooks, "close", file.logicalPath, attempt, file.path);
        let invoked = false;
        const close = async (): Promise<void> => {
          if (invoked) throw new Error("Evidence close dependency was invoked more than once");
          invoked = true;
          const handle = requireHandle(file);
          await handle.close();
          file.handle = null;
        };
        if (hooks.closeOperation === undefined) await close();
        else await hooks.closeOperation(file.logicalPath, attempt, file.path, close);
        if (!invoked) throw new Error("Evidence close dependency did not invoke the real close");
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    if (file.handle !== null) {
      try {
        await file.handle.close();
        file.handle = null;
      } catch (error: unknown) {
        failures.push(error);
      }
    }
  }
  return Object.freeze(failures);
}

export function bindProductionReplayEvidence(
  terminal: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const base = { ...terminal };
  delete base.canonicalBinding;
  delete base.resultOwnership;
  delete base.resultReservationId;
  const bytes = new TextEncoder().encode(JSON.stringify(base));
  return Object.freeze({
    ...base,
    canonicalBinding: Object.freeze({
      payloadBase64url: Buffer.from(bytes).toString("base64url"),
      payloadSha256: sha256(bytes),
    }),
  });
}

export function formatProductionReplayMarkdown(bound: Readonly<Record<string, unknown>>): string {
  const binding = parseCanonicalBinding(bound.canonicalBinding);
  const failure =
    bound.failure === null || bound.failure === undefined
      ? "none"
      : Buffer.from(JSON.stringify(bound.failure), "utf8").toString("base64url");
  return [
    "# Installer Repair production replay",
    "",
    `- Schema: \`${String(bound.schemaVersion)}\``,
    `- State: \`${String(bound.state)}\``,
    `- Command: \`${String(bound.command)}\``,
    `- Started: \`${String(bound.startedAt)}\``,
    `- Completed: \`${String(bound.completedAt)}\``,
    `- Duration: \`${String(bound.durationMs)} ms\``,
    `- Failure (base64url JSON): \`${failure}\``,
    `- Canonical SHA-256: \`${binding.payloadSha256}\``,
    `- Canonical base64url: \`${binding.payloadBase64url}\``,
    "",
  ].join("\n");
}

export function sanitizeProductionReplayFailure(
  error: unknown,
  operation = "unknown",
): ProductionReplayFailureCause {
  try {
    return sanitizeCause(error, operation, 0, new Set());
  } catch {
    return Object.freeze({
      causes: Object.freeze([]),
      kind: "thrown",
      message: "uninspectable-thrown-value",
      name: "unknown",
      operation: sanitizeOperation(safeString(operation)),
    });
  }
}

export function parseProductionReplayEvidence(input: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(input)) throw new Error("Production replay evidence must be an object");
  if (input.schemaVersion === 1) return parseLegacyV1(input);
  if (
    input.schemaVersion !== 3 &&
    input.schemaVersion !== INSTALLER_REPAIR_PRODUCTION_REPLAY_SCHEMA_VERSION
  ) {
    throw new Error("Production replay evidence schema is unsupported");
  }
  if (!["failed", "finalization-failed", "passed", "pending"].includes(String(input.state))) {
    throw new Error("Production replay evidence state is invalid");
  }
  if (typeof input.resultReservationId !== "string") {
    throw new Error("Production replay evidence reservation is invalid");
  }
  assertExactOwnership(input, input.resultReservationId, String(input.state));
  if (
    input.schemaVersion === INSTALLER_REPAIR_PRODUCTION_REPLAY_SCHEMA_VERSION &&
    input.state === "passed"
  ) {
    validateProductionReplayResult(input.replay);
  }
  verifyCanonicalObject(input);
  return Object.freeze({ ...input });
}

export function adjudicateProductionReplayEvidence(
  jsonBytes: Uint8Array,
  markdownBytes: Uint8Array,
  recoveryBytes: Uint8Array,
): ProductionReplayEvidenceAdjudication {
  if (
    jsonBytes.byteLength > MAX_JSON_BYTES ||
    markdownBytes.byteLength > MAX_MARKDOWN_BYTES ||
    recoveryBytes.byteLength > MAX_RECOVERY_BYTES
  ) {
    throw new Error("Production replay adjudication input exceeds its byte ceiling");
  }
  const recovery = parseRecoveryEnvelope(JSON.parse(Buffer.from(recoveryBytes).toString("utf8")));
  let pair: Readonly<Record<string, unknown>> | null = null;
  let pairState = "unreadable";
  let pairValid = false;
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(Buffer.from(jsonBytes).toString("utf8"));
  } catch {
    parsedJson = undefined;
  }
  if (parsedJson !== undefined) {
    try {
      pair = parseProductionReplayEvidence(parsedJson);
    } catch (error: unknown) {
      if (recovery.state === "pair-terminal-authorized") {
        throw new Error("Readable terminal JSON contradicts its evidence contract", {
          cause: error,
        });
      }
    }
  }
  if (pair !== null) {
    pairState = String(pair.state);
    const reservationId = String(pair.resultReservationId);
    const bound = { ...pair };
    delete bound.resultOwnership;
    delete bound.resultReservationId;
    try {
      verifyPairBytes(jsonBytes, markdownBytes, bound, reservationId, pairState);
    } catch (error: unknown) {
      if (recovery.state === "pair-terminal-authorized") {
        throw new Error("Readable terminal pair contradicts its JSON/Markdown binding", {
          cause: error,
        });
      }
    }
    pairValid = recovery.reservationId === reservationId;
  }
  if (recovery.state === "reservation-open") {
    if (pairValid && pairState !== "pending") {
      throw new Error("Open reservation cannot authorize a terminal pair");
    }
    return Object.freeze({ pairState, recoveryState: recovery.state, verdict: "reservation-open" });
  }
  if (recovery.state === "finalization-failed") {
    return Object.freeze({
      pairState,
      recoveryState: recovery.state,
      verdict: "finalization-failed",
    });
  }
  const authorization = recovery.authorization;
  if (authorization === null) throw new Error("Terminal authorization is absent");
  if (pair === null || pairState === "pending" || pairState === "finalization-failed") {
    return Object.freeze({
      pairState,
      recoveryState: recovery.state,
      verdict: "authorized-terminal-not-published",
    });
  }
  if (!pairValid) {
    throw new Error("Terminal pair reservation differs from its durable recovery authorization");
  }
  if (
    pairState !== authorization.pairPublicationState ||
    sha256(jsonBytes) !== authorization.jsonSha256 ||
    sha256(markdownBytes) !== authorization.markdownSha256 ||
    parseCanonicalBinding(pair.canonicalBinding).payloadSha256 !==
      authorization.canonicalPayloadSha256
  ) {
    throw new Error("Terminal pair differs from its durable recovery authorization");
  }
  return Object.freeze({
    pairState,
    recoveryState: recovery.state,
    verdict: "authorized-terminal",
  });
}

export function validateRetainedLegacyV1Pair(
  jsonBytes: Uint8Array,
  markdownBytes: Uint8Array,
  expectation: RetainedLegacyV1Expectation,
): Readonly<Record<string, unknown>> {
  if (
    sha256(jsonBytes) !== expectation.jsonSha256 ||
    sha256(markdownBytes) !== expectation.markdownSha256
  ) {
    throw new Error("Retained legacy production replay pair digest differs");
  }
  const parsed = parseLegacyV1(
    JSON.parse(Buffer.from(jsonBytes).toString("utf8")) as Record<string, unknown>,
  );
  const binding = parseCanonicalBinding(parsed.canonicalBinding);
  if (
    parsed.state !== expectation.state ||
    (expectation.canonicalPayloadSha256 !== "" &&
      binding.payloadSha256 !== expectation.canonicalPayloadSha256)
  ) {
    throw new Error("Retained legacy production replay expected facts differ");
  }
  return parsed;
}

function parseLegacyV1(input: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const required = [
    "canonicalBinding",
    "command",
    "completedAt",
    "durationMs",
    "failure",
    "schemaVersion",
    "sourceIdentity",
    "startedAt",
    "state",
  ];
  if (!["failed", "passed", "pending"].includes(String(input.state))) {
    throw new Error("Legacy production replay evidence has an invalid state");
  }
  if (input.state === "passed") required.push("replay");
  const actual = Object.keys(input).sort();
  const expected = required.sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error("Legacy production replay evidence has unsupported or missing keys");
  }
  if (
    input.schemaVersion !== 1 ||
    input.command !== "pnpm harness:installer-repair-production-replay" ||
    typeof input.startedAt !== "string" ||
    typeof input.completedAt !== "string" ||
    !Number.isSafeInteger(input.durationMs) ||
    (input.durationMs as number) < 0 ||
    (input.state === "passed" ? input.failure !== null : typeof input.failure !== "string") ||
    !isRecord(input.sourceIdentity)
  ) {
    throw new Error("Legacy production replay evidence facts are invalid");
  }
  verifyCanonicalObject(input);
  return Object.freeze({ ...input });
}

function sanitizeCause(
  input: unknown,
  operation: string,
  depth: number,
  seen: Set<unknown>,
): ProductionReplayFailureCause {
  if (depth >= MAX_CAUSE_DEPTH || seen.has(input)) {
    return Object.freeze({
      causes: Object.freeze([]),
      kind: "thrown",
      message: depth >= MAX_CAUSE_DEPTH ? "cause-depth-limit" : "cause-cycle",
      name: "RedactedCause",
      operation: sanitizeOperation(operation),
    });
  }
  seen.add(input);
  const isError = input instanceof Error;
  const aggregate = input instanceof AggregateError;
  const children: unknown[] = [];
  if (aggregate) children.push(...input.errors.slice(0, MAX_CAUSE_CHILDREN));
  if (isError && input.cause !== undefined) children.push(input.cause);
  return Object.freeze({
    causes: Object.freeze(
      children
        .slice(0, MAX_CAUSE_CHILDREN)
        .map((child) => sanitizeCause(child, operation, depth + 1, seen)),
    ),
    kind: aggregate ? "aggregate" : isError ? "error" : "thrown",
    message: sanitizeMessage(isError && input.message !== "" ? input.message : safeString(input)),
    name: sanitizeLabel(isError ? safeString(input.name) : typeof input),
    operation: sanitizeOperation(operation),
  });
}

function sanitizeMessage(input: string): string {
  const normalized = normalizeSecurityText(input);
  const result = redactSecrets(normalized)
    .replaceAll(/(["'])(?:[A-Za-z]:\\|\/)[^"']+\1/gu, "<path>")
    .replaceAll(/\b(?:https?|file):\/\/[^\s'"]+/giu, "<url>")
    .replaceAll(/\\\\.*$/gu, "<path>")
    .replaceAll(/\b[A-Za-z]:\\.*$/gu, "<path>")
    .replaceAll(/(^|\s)\/.*$/gu, "$1<path>")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_FAILURE_MESSAGE);
  return residualSanitize(result);
}

function residualSanitize(value: string): string {
  const normalized = redactSecrets(normalizeSecurityText(value))
    .replaceAll(/[`\\\r\n]/gu, " ")
    .replaceAll(/\b[A-Za-z]:[^\s]*/gu, "<path>")
    .replaceAll(/(?:https?|file):\/\/[^\s]*/giu, "<url>")
    .replaceAll(/(^|\s)\/[^\s]*/gu, "$1<path>")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_FAILURE_MESSAGE);
  const shadow = normalizeSecurityText(normalized);
  if (
    /\b(?:token|pass(?:word|wd)|secret|key|api[_-]?key)\b\s*[:=]\s*(?!<redacted>)[^\s&,;]+/iu.test(
      shadow,
    ) ||
    /\b(?:bearer|basic|digest)\s+(?!<redacted>)[^\s&,;]+/iu.test(shadow)
  ) {
    return "redacted-failure";
  }
  return normalized;
}

function normalizeSecurityText(value: string): string {
  return value.replaceAll(/\r?\n[ \t]+/gu, " ").replaceAll(/[\p{Cc}\p{Cf}`]/gu, "");
}

function redactSecrets(value: string): string {
  return value
    .replaceAll(
      /\bauthorization\b\s*:\s*(?:(?:bearer|basic|digest)\s+)?[^\s&,;]+/giu,
      "authorization=<redacted>",
    )
    .replaceAll(/\b(?:bearer|basic|digest)\s+[^\s&,;]+/giu, "credential=<redacted>")
    .replaceAll(
      /\b(token|pass(?:word|wd)|secret|key|api[_-]?key)\b\s*[:=]\s*[^\s&,;]+/giu,
      "$1=<redacted>",
    )
    .replaceAll(
      /[?&](?:token|pass(?:word|wd)|secret|key|authorization|api[_-]?key)=[^&\s]+/giu,
      "",
    );
}

function sanitizeLabel(input: string): string {
  const value = sanitizeMessage(input).slice(0, 64);
  return value === "" ? "unknown" : value;
}

function sanitizeOperation(input: string): string {
  return sanitizeLabel(input);
}

function safeString(input: unknown): string {
  try {
    return String(input);
  } catch {
    return "unprintable-thrown-value";
  }
}

function verifyCanonicalObject(input: Readonly<Record<string, unknown>>): void {
  const binding = parseCanonicalBinding(input.canonicalBinding);
  const base = { ...input };
  delete base.canonicalBinding;
  delete base.resultOwnership;
  delete base.resultReservationId;
  const bytes = new TextEncoder().encode(JSON.stringify(base));
  if (
    sha256(bytes) !== binding.payloadSha256 ||
    Buffer.from(bytes).toString("base64url") !== binding.payloadBase64url
  ) {
    throw new Error("Production replay canonical binding differs");
  }
}

function parseCanonicalBinding(input: unknown): ProductionReplayCanonicalBinding {
  if (
    !isRecord(input) ||
    JSON.stringify(Object.keys(input).sort()) !==
      JSON.stringify(["payloadBase64url", "payloadSha256"]) ||
    typeof input.payloadBase64url !== "string" ||
    !/^[A-Za-z0-9_-]+$/u.test(input.payloadBase64url) ||
    typeof input.payloadSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(input.payloadSha256)
  ) {
    throw new Error("Production replay canonical binding is invalid");
  }
  return Object.freeze({
    payloadBase64url: input.payloadBase64url,
    payloadSha256: input.payloadSha256,
  });
}

function ownedJson(
  value: Readonly<Record<string, unknown>>,
  reservationId: string,
  publicationState: string,
): string {
  return `${JSON.stringify(
    {
      resultReservationId: reservationId,
      ...value,
      resultOwnership: { publicationState, reservationId },
    },
    null,
    2,
  )}\n`;
}

function ownedMarkdown(value: string, reservationId: string, publicationState: string): string {
  return [
    `<!-- parallax-result-reservation:${reservationId} -->`,
    value.trimEnd(),
    `- Result reservation: \`${reservationId}\``,
    `- Publication state: \`${publicationState}\``,
    "",
  ].join("\n");
}

function recoveryRecord(
  reservation: OwnedReservation,
  state: RecoveryState,
  authorization: PairAuthorization | null,
  failure: ProductionReplayFailureCause | null,
): string {
  const authorizationSha256 = authorization === null ? null : sha256(canonicalBytes(authorization));
  const failureSha256 = failure === null ? null : sha256(canonicalBytes(failure));
  const bound = bindProductionReplayEvidence({
    authorization,
    authorizationSha256,
    failure,
    failureSha256,
    recoverySchemaVersion: 1,
    reservationId: reservation.reservationId,
    state,
    stem: reservation.stem,
    type: "installer-repair-production-replay-recovery",
  });
  return ownedJson(bound, reservation.reservationId, state);
}

interface ParsedRecoveryEnvelope {
  readonly authorization: PairAuthorization | null;
  readonly failure: ProductionReplayFailureCause | null;
  readonly reservationId: string;
  readonly state: RecoveryState;
  readonly stem: string;
}

function parseRecoveryEnvelope(input: unknown): ParsedRecoveryEnvelope {
  if (!isRecord(input)) throw new Error("Production replay recovery must be an object");
  const expectedKeys = [
    "authorization",
    "authorizationSha256",
    "canonicalBinding",
    "failure",
    "failureSha256",
    "recoverySchemaVersion",
    "reservationId",
    "resultOwnership",
    "resultReservationId",
    "state",
    "stem",
    "type",
  ];
  if (JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(expectedKeys.sort())) {
    throw new Error("Production replay recovery keys differ");
  }
  if (
    typeof input.reservationId !== "string" ||
    typeof input.stem !== "string" ||
    !["finalization-failed", "pair-terminal-authorized", "reservation-open"].includes(
      String(input.state),
    )
  ) {
    throw new Error("Production replay recovery identity is invalid");
  }
  const state = input.state as RecoveryState;
  assertExactOwnership(input, input.reservationId, state);
  if (
    input.recoverySchemaVersion !== 1 ||
    input.type !== "installer-repair-production-replay-recovery"
  ) {
    throw new Error("Production replay recovery schema facts differ");
  }
  if (input.authorization !== null && !isRecord(input.authorization)) {
    throw new Error("Production replay recovery authorization is invalid");
  }
  if (input.failure !== null && !isRecord(input.failure)) {
    throw new Error("Production replay recovery failure is invalid");
  }
  const authorization =
    input.authorization === null ? null : (input.authorization as unknown as PairAuthorization);
  const failure =
    input.failure === null ? null : (input.failure as unknown as ProductionReplayFailureCause);
  if (
    input.authorizationSha256 !==
      (authorization === null ? null : sha256(canonicalBytes(authorization))) ||
    input.failureSha256 !== (failure === null ? null : sha256(canonicalBytes(failure)))
  ) {
    throw new Error("Production replay recovery payload digest differs");
  }
  if (
    (state === "pair-terminal-authorized") !== (authorization !== null) ||
    (state === "finalization-failed") !== (failure !== null) ||
    (state === "reservation-open" && (authorization !== null || failure !== null))
  ) {
    throw new Error("Production replay recovery state payload differs");
  }
  if (authorization !== null) validatePairAuthorization(authorization);
  if (failure !== null) validateFailureCause(failure, 0);
  verifyCanonicalObject(input);
  return Object.freeze({
    authorization,
    failure,
    reservationId: input.reservationId,
    state,
    stem: input.stem,
  });
}

function parseRecoveryRecord(
  input: unknown,
  reservation: OwnedReservation,
  state: RecoveryState,
  authorization: PairAuthorization | null,
  failure: ProductionReplayFailureCause | null,
): Readonly<Record<string, unknown>> {
  const parsed = parseRecoveryEnvelope(input);
  if (
    parsed.reservationId !== reservation.reservationId ||
    parsed.stem !== reservation.stem ||
    parsed.state !== state
  ) {
    throw new Error("Production replay recovery facts differ");
  }
  if (
    JSON.stringify(parsed.authorization) !== JSON.stringify(authorization) ||
    JSON.stringify(parsed.failure) !== JSON.stringify(failure)
  ) {
    throw new Error("Production replay recovery exact payload differs");
  }
  return Object.freeze({ ...(input as Record<string, unknown>) });
}

function validatePairAuthorization(input: PairAuthorization): void {
  if (
    JSON.stringify(Object.keys(input).sort()) !==
      JSON.stringify([
        "canonicalPayloadSha256",
        "jsonSha256",
        "markdownSha256",
        "pairPublicationState",
      ]) ||
    !/^[a-f0-9]{64}$/u.test(input.canonicalPayloadSha256) ||
    !/^[a-f0-9]{64}$/u.test(input.jsonSha256) ||
    !/^[a-f0-9]{64}$/u.test(input.markdownSha256) ||
    !["failed", "passed"].includes(input.pairPublicationState)
  ) {
    throw new Error("Production replay pair authorization is invalid");
  }
}

function validateFailureCause(input: unknown, depth: number): void {
  if (!isRecord(input) || depth > MAX_CAUSE_DEPTH) {
    throw new Error("Production replay recovery failure cause is invalid");
  }
  const keys = ["causes", "kind", "message", "name", "operation"];
  if (JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(keys)) {
    throw new Error("Production replay recovery failure cause keys differ");
  }
  if (
    !Array.isArray(input.causes) ||
    input.causes.length > MAX_CAUSE_CHILDREN ||
    !["aggregate", "error", "thrown"].includes(String(input.kind)) ||
    typeof input.message !== "string" ||
    input.message.length > MAX_FAILURE_MESSAGE ||
    typeof input.name !== "string" ||
    input.name.length > 64 ||
    typeof input.operation !== "string" ||
    input.operation.length > 64
  ) {
    throw new Error("Production replay recovery failure cause facts differ");
  }
  for (const cause of input.causes) validateFailureCause(cause, depth + 1);
}

function assertExactOwnership(
  input: Readonly<Record<string, unknown>>,
  reservationId: string,
  publicationState: string,
): void {
  if (
    input.resultReservationId !== reservationId ||
    !isRecord(input.resultOwnership) ||
    JSON.stringify(Object.keys(input.resultOwnership).sort()) !==
      JSON.stringify(["publicationState", "reservationId"]) ||
    input.resultOwnership.publicationState !== publicationState ||
    input.resultOwnership.reservationId !== reservationId
  ) {
    throw new Error("Production replay result ownership differs");
  }
}

function requireOwned(files: readonly OwnedFile[], logicalPath: LogicalPath): OwnedFile {
  const file = files.find((candidate) => candidate.logicalPath === logicalPath);
  if (file === undefined) throw new Error(`Owned ${logicalPath} evidence file is absent`);
  return file;
}

function requireHandle(file: OwnedFile): FileHandle {
  if (file.handle === null) throw new Error(`Owned ${file.logicalPath} evidence handle is closed`);
  return file.handle;
}

function byteCeiling(logicalPath: LogicalPath): number {
  if (logicalPath === "json") return MAX_JSON_BYTES;
  if (logicalPath === "markdown") return MAX_MARKDOWN_BYTES;
  return MAX_RECOVERY_BYTES;
}

async function hook(
  hooks: ProductionReplayEvidenceTestHooks,
  operation: EvidenceOperation,
  logicalPath: LogicalPath,
  attempt: number,
  path = "",
): Promise<void> {
  await hooks.beforeOperation?.(operation, logicalPath, attempt, path);
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
