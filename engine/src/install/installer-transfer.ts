import type { InstallResource } from "../storage/install-manifest";
import type {
  IntegrityResult,
  PartialSnapshot,
  VerifiedObjectRef,
} from "../storage/opfs-release-store";
import { InstallStoreIntegrityError, isStrongEtag } from "../storage/opfs-release-store-contract";

export const INSTALLER_RETRY_DELAYS_MS = Object.freeze([250, 1_000]);
export const INSTALLER_MAXIMUM_ATTEMPTS = INSTALLER_RETRY_DELAYS_MS.length + 1;
export const INSTALLER_QUOTA_PROBE_BYTES = 1024 * 1024;
export const INSTALLER_QUOTA_METADATA_RESERVE_BYTES = 16 * 1024 * 1024;

export interface InstallerQuotaAdmission {
  readonly estimateClearlyInsufficient: boolean;
  readonly requiredPeakBytes: number;
}

export function evaluateInstallerQuotaAdmission(
  availableBytes: number | null,
  largestUnverifiedResourceBytes: number,
): InstallerQuotaAdmission {
  if (
    (availableBytes !== null && (!Number.isSafeInteger(availableBytes) || availableBytes < 0)) ||
    !Number.isSafeInteger(largestUnverifiedResourceBytes) ||
    largestUnverifiedResourceBytes < 0
  ) {
    throw new Error("Invalid installer quota admission dimensions");
  }
  const nextAtomicBytes = Math.max(largestUnverifiedResourceBytes, INSTALLER_QUOTA_PROBE_BYTES);
  const requiredPeakBytes = safeAdd(nextAtomicBytes, INSTALLER_QUOTA_METADATA_RESERVE_BYTES);
  return Object.freeze({
    estimateClearlyInsufficient: availableBytes !== null && availableBytes < requiredPeakBytes,
    requiredPeakBytes,
  });
}

export interface InstallerTransferPolicy {
  readonly checkpointBytes: number;
  readonly concurrency: number;
  readonly requestTimeoutMs: number;
}

export interface PreparedInstallResource {
  readonly bytesCommitted: number;
  readonly expectedBytes: number;
  readonly state: "partial" | "verified";
  readonly strongEtag: string | null;
  readonly reference?: VerifiedObjectRef;
}

export interface InstallReleasePlan {
  readonly largestUnverifiedResourceBytes: number;
  readonly missingBytes: number;
  readonly missingResourceCount: number;
  readonly partialBytes: number;
  readonly partialResources: readonly Readonly<{
    bytesCommitted: number;
    resourceId: string;
  }>[];
  readonly partialResourceCount: number;
  readonly reusedBytes: number;
  readonly reusedResourceIds: readonly string[];
  readonly reusedResourceCount: number;
  readonly totalBytes: number;
  readonly totalResourceCount: number;
}

export interface InstallerTransferStore {
  appendPartial(input: {
    readonly bytes: Uint8Array;
    readonly expectedOffset: number;
    readonly releaseDigest: string;
    readonly resourceId: string;
    readonly strongEtag: string;
  }): Promise<PartialSnapshot>;
  discardPartial(releaseDigest: string, resourceId: string): Promise<void>;
  /**
   * Publishes a verified object reference only after the release store has established the
   * exact-size/SHA-256 object and its immutable verified marker. A newly published object is
   * flushed, reread, and rehashed before this promise resolves.
   */
  finalizePartial(releaseDigest: string, resourceId: string): Promise<VerifiedObjectRef>;
  prepareResource(releaseDigest: string, resourceId: string): Promise<PreparedInstallResource>;
  /** Rehashes a preexisting verified object before the transfer executor reuses it. */
  verifyObject(reference: VerifiedObjectRef): Promise<IntegrityResult>;
}

export interface InstallerTransferPlatform {
  fetch(input: string, init: RequestInit): Promise<Response>;
  now(): number;
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
  sleep(milliseconds: number, signal: AbortSignal): Promise<void>;
}

export interface InstallerTransferObserver {
  checkpoint(bytes: number): void;
  downloaded(bytes: number): void;
  httpRequest(range: boolean): void;
  integrityFailure(resourceId: string): void;
  resourceActive(resourceId: string): void;
  resourceComplete(resourceId: string, bytes: number): void;
  resourceInactive(resourceId: string): void;
  repairCompletionCreditRevoked(resourceId: string, bytes: number): boolean;
  repairComplete(resourceId: string, bytes: number): void;
  repairStarted(resourceId: string, bytes: number): void;
  resumed(bytes: number): void;
  retry(resourceId: string): void;
  transportFailure(resourceId: string): void;
  validatorFailure(resourceId: string): void;
  verified(bytes: number): void;
}

export interface InstallerRepairState {
  readonly attemptedResourceIds: Set<string>;
  readonly completionCreditRevokedResourceIds: Set<string>;
}

export interface InstallerTransferInput {
  readonly baseUrl: string;
  readonly policy: InstallerTransferPolicy;
  readonly releaseDigest: string;
  readonly repairState?: InstallerRepairState;
  readonly resources: readonly InstallResource[];
  readonly signal: AbortSignal;
}

export function createInstallerRepairState(): InstallerRepairState {
  return {
    attemptedResourceIds: new Set<string>(),
    completionCreditRevokedResourceIds: new Set<string>(),
  };
}

export interface InstallerTransferResult {
  readonly readyBytes: number;
  readonly readyResourceCount: number;
}

export class InstallerTransferError extends Error {
  public constructor(
    public readonly category: "integrity" | "transport" | "validator",
    message: string,
    public readonly resourceId: string | null,
  ) {
    super(message);
    this.name = "InstallerTransferError";
  }
}

export class InstallerStoreError extends Error {
  public constructor(
    public readonly operation:
      | "append-partial"
      | "discard-partial"
      | "finalize-partial"
      | "prepare-resource"
      | "verify-release"
      | "verify-object",
    public readonly resourceId: string | null,
    cause: unknown,
  ) {
    super(`Installer store ${operation} failed`, { cause });
    this.name = "InstallerStoreError";
  }
}

export class InstallerQuotaError extends DOMException {
  public constructor(
    public readonly resourceId: string | null,
    message = "Installer resource write exceeded quota",
  ) {
    super(message, "QuotaExceededError");
  }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const CONTENT_RANGE = /^bytes ([0-9]+)-([0-9]+)\/([0-9]+)$/;
const UNSATISFIED_RANGE = /^bytes \*\/([0-9]+)$/;

export function createBrowserInstallerTransferPlatform(): InstallerTransferPlatform {
  return Object.freeze({
    clearTimeout: (handle: unknown) => globalThis.clearTimeout(handle as number),
    fetch: (input: string, init: RequestInit) => globalThis.fetch(input, init),
    now: () => performance.now(),
    setTimeout: (callback: () => void, milliseconds: number) =>
      globalThis.setTimeout(callback, milliseconds),
    sleep: (milliseconds: number, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        const handle = globalThis.setTimeout(resolve, milliseconds);
        signal.addEventListener(
          "abort",
          () => {
            globalThis.clearTimeout(handle);
            reject(signal.reason);
          },
          { once: true },
        );
      }),
  });
}

export async function transferInstallResources(
  store: InstallerTransferStore,
  platform: InstallerTransferPlatform,
  observer: InstallerTransferObserver,
  input: InstallerTransferInput,
): Promise<InstallerTransferResult> {
  validatePolicy(input.policy);
  const resources = input.resources.filter(({ target }) => target === "opfs");
  const executionAbort = new AbortController();
  let primaryFailure: unknown;
  let hasPrimaryFailure = false;
  const abortExecution = (failure: unknown): void => {
    if (executionAbort.signal.aborted) return;
    primaryFailure = failure;
    hasPrimaryFailure = true;
    executionAbort.abort(failure);
  };
  const abortFromOwner = (): void => abortExecution(abortReason(input.signal));
  input.signal.addEventListener("abort", abortFromOwner, { once: true });
  if (input.signal.aborted) abortFromOwner();
  const executionInput: InstallerTransferInput = Object.freeze({
    ...input,
    signal: executionAbort.signal,
  });
  let cursor = 0;
  let readyBytes = 0;
  let readyResourceCount = 0;
  const worker = async (): Promise<void> => {
    try {
      while (true) {
        throwIfAborted(executionInput.signal);
        const index = cursor;
        cursor += 1;
        const resource = resources[index];
        if (resource === undefined) return;
        observer.resourceActive(resource.id);
        try {
          const verified = await transferResource(
            store,
            platform,
            observer,
            executionInput,
            resource,
          );
          throwIfAborted(executionInput.signal);
          readyBytes = safeAdd(readyBytes, verified.bytes);
          readyResourceCount += 1;
          observer.resourceComplete(resource.id, verified.bytes);
        } finally {
          observer.resourceInactive(resource.id);
        }
      }
    } catch (error: unknown) {
      abortExecution(error);
      throw error;
    }
  };
  try {
    await Promise.allSettled(
      Array.from({ length: Math.min(input.policy.concurrency, resources.length) }, worker),
    );
  } finally {
    input.signal.removeEventListener("abort", abortFromOwner);
  }
  if (hasPrimaryFailure) throw primaryFailure;
  return Object.freeze({ readyBytes, readyResourceCount });
}

export async function repairInstallResource(
  store: InstallerTransferStore,
  platform: InstallerTransferPlatform,
  observer: InstallerTransferObserver,
  input: InstallerTransferInput,
  resource: InstallResource,
  revokeCompletionCredit = false,
): Promise<VerifiedObjectRef> {
  const repairState = input.repairState ?? createInstallerRepairState();
  beginRepair(observer, repairState, resource, revokeCompletionCredit);
  const prepared = await prepare(store, observer, resource, input.releaseDigest);
  requireFreshRepairPartial(observer, resource, prepared);
  const reference = await transferPreparedResource(
    store,
    platform,
    observer,
    input,
    resource,
    prepared,
  );
  observer.repairComplete(resource.id, resource.bytes);
  if (repairState.completionCreditRevokedResourceIds.delete(resource.id)) {
    observer.resourceComplete(resource.id, resource.bytes);
  }
  return reference;
}

async function transferResource(
  store: InstallerTransferStore,
  platform: InstallerTransferPlatform,
  observer: InstallerTransferObserver,
  input: InstallerTransferInput,
  resource: InstallResource,
): Promise<VerifiedObjectRef> {
  const repairState = input.repairState ?? createInstallerRepairState();
  const prepared = await prepare(store, observer, resource, input.releaseDigest);
  if (prepared.state === "verified") {
    if (prepared.reference === undefined) {
      throw validator(observer, resource.id, "Verified resource has no object reference");
    }
    const integrity = await callStore("verify-object", resource.id, () =>
      store.verifyObject(prepared.reference as VerifiedObjectRef),
    );
    throwIfAborted(input.signal);
    if (
      !integrity.ok ||
      integrity.bytes !== resource.bytes ||
      integrity.sha256 !== resource.sha256
    ) {
      observer.integrityFailure(resource.id);
      return repairInstallResource(store, platform, observer, { ...input, repairState }, resource);
    }
    observer.verified(resource.bytes);
    return prepared.reference;
  }
  return transferPreparedResource(store, platform, observer, input, resource, prepared);
}

async function transferPreparedResource(
  store: InstallerTransferStore,
  platform: InstallerTransferPlatform,
  observer: InstallerTransferObserver,
  input: InstallerTransferInput,
  resource: InstallResource,
  initialPrepared: PreparedInstallResource,
): Promise<VerifiedObjectRef> {
  let creditedResumedBytes = 0;
  let staleValidatorRecoveryUsed = false;
  let initialPreparedAvailable = true;
  for (let attempt = 0; attempt < INSTALLER_MAXIMUM_ATTEMPTS; attempt += 1) {
    if (input.signal.aborted) throw abortReason(input.signal);
    const prepared = initialPreparedAvailable
      ? initialPrepared
      : await prepare(store, observer, resource, input.releaseDigest);
    initialPreparedAvailable = false;
    if (prepared.state !== "partial") {
      throw validator(
        observer,
        resource.id,
        "Unverified transfer unexpectedly became a verified object",
      );
    }
    try {
      await transferAttempt(store, platform, observer, input, resource, prepared, () => {
        if (prepared.bytesCommitted > creditedResumedBytes) {
          observer.resumed(prepared.bytesCommitted - creditedResumedBytes);
          creditedResumedBytes = prepared.bytesCommitted;
        }
      });
      throwIfAborted(input.signal);
      let reference: VerifiedObjectRef;
      try {
        reference = await callStore("finalize-partial", resource.id, () =>
          store.finalizePartial(input.releaseDigest, resource.id),
        );
      } catch (error: unknown) {
        if (error instanceof InstallerTransferError && error.category === "integrity") {
          observer.integrityFailure(resource.id);
        }
        throw error;
      }
      throwIfAborted(input.signal);
      observer.verified(resource.bytes);
      return reference;
    } catch (error: unknown) {
      if (input.signal.aborted) throw input.signal.reason;
      if (error instanceof StalePartialValidatorError) {
        if (staleValidatorRecoveryUsed) {
          throw validator(
            observer,
            resource.id,
            "Resource validator changed again after its single stale-partial recovery",
          );
        }
        staleValidatorRecoveryUsed = true;
        await callStore("discard-partial", resource.id, () =>
          store.discardPartial(input.releaseDigest, resource.id),
        );
        attempt -= 1;
        continue;
      }
      if (
        error instanceof InstallerTransferError &&
        (error.category === "integrity" || error.category === "validator")
      ) {
        throw error;
      }
      if (error instanceof InstallerStoreError || isQuotaExceededError(error)) throw error;
      if (attempt >= INSTALLER_RETRY_DELAYS_MS.length) {
        if (error instanceof InstallerTransferError) throw error;
        observer.transportFailure(resource.id);
        throw new InstallerTransferError(
          "transport",
          error instanceof Error ? error.message : String(error),
          resource.id,
        );
      }
      observer.retry(resource.id);
      await platform.sleep(INSTALLER_RETRY_DELAYS_MS[attempt] ?? 0, input.signal);
    }
  }
  throw new Error("Unreachable installer retry state");
}

async function prepare(
  store: InstallerTransferStore,
  observer: InstallerTransferObserver,
  resource: InstallResource,
  releaseDigest: string,
): Promise<PreparedInstallResource> {
  const prepared = await callStore("prepare-resource", resource.id, () =>
    store.prepareResource(releaseDigest, resource.id),
  );
  if (prepared.expectedBytes !== resource.bytes) {
    throw validator(observer, resource.id, "Prepared resource size does not match manifest");
  }
  return prepared;
}

function beginRepair(
  observer: InstallerTransferObserver,
  repairState: InstallerRepairState,
  resource: InstallResource,
  revokeCompletionCredit: boolean,
): void {
  if (revokeCompletionCredit && !repairState.completionCreditRevokedResourceIds.has(resource.id)) {
    if (observer.repairCompletionCreditRevoked(resource.id, resource.bytes)) {
      repairState.completionCreditRevokedResourceIds.add(resource.id);
    }
  }
  if (repairState.attemptedResourceIds.has(resource.id)) {
    throw new InstallerTransferError(
      "integrity",
      "Resource failed integrity after its single repair cycle",
      resource.id,
    );
  }
  repairState.attemptedResourceIds.add(resource.id);
  observer.repairStarted(resource.id, resource.bytes);
}

function requireFreshRepairPartial(
  observer: InstallerTransferObserver,
  resource: InstallResource,
  prepared: PreparedInstallResource,
): void {
  if (
    prepared.state !== "partial" ||
    prepared.bytesCommitted !== 0 ||
    prepared.strongEtag !== null
  ) {
    throw validator(
      observer,
      resource.id,
      "Invalidated verified object did not re-prepare as a fresh zero-offset transfer",
    );
  }
}

async function transferAttempt(
  store: InstallerTransferStore,
  platform: InstallerTransferPlatform,
  observer: InstallerTransferObserver,
  input: InstallerTransferInput,
  resource: InstallResource,
  prepared: PreparedInstallResource,
  creditResumedBytes: () => void,
): Promise<void> {
  const offset = prepared.bytesCommitted;
  const url = new URL(resource.source, input.baseUrl).href;
  if (new URL(url).origin !== new URL(input.baseUrl).origin) {
    throw validator(observer, resource.id, "Installer resource source is not same-origin");
  }
  const headers = new Headers({ Range: `bytes=${offset}-` });
  if (offset > 0) {
    if (prepared.strongEtag === null || !isStrongEtag(prepared.strongEtag)) {
      throw validator(observer, resource.id, "Resume requires a persisted strong ETag");
    }
    headers.set("If-Range", prepared.strongEtag);
  }
  const abort = new AbortController();
  const abortFromOwner = (): void => abort.abort(input.signal.reason);
  input.signal.addEventListener("abort", abortFromOwner, { once: true });
  if (input.signal.aborted) abortFromOwner();
  let timeout: unknown;
  const clearIdleDeadline = (): void => {
    if (timeout === undefined) return;
    platform.clearTimeout(timeout);
    timeout = undefined;
  };
  const armIdleDeadline = (): void => {
    clearIdleDeadline();
    timeout = platform.setTimeout(
      () => abort.abort(new DOMException("Installer request stalled", "TimeoutError")),
      input.policy.requestTimeoutMs,
    );
  };
  armIdleDeadline();
  observer.httpRequest(true);
  try {
    let response: Response;
    try {
      response = await platform.fetch(url, {
        cache: "no-store",
        credentials: "same-origin",
        headers,
        redirect: "error",
        signal: abort.signal,
      });
    } catch (error: unknown) {
      if (input.signal.aborted) throw abortReason(input.signal);
      observer.transportFailure(resource.id);
      throw new InstallerTransferError(
        "transport",
        error instanceof Error ? error.message : String(error),
        resource.id,
      );
    }
    if (RETRYABLE_STATUS.has(response.status)) {
      await cancelBody(response);
      observer.transportFailure(resource.id);
      throw new InstallerTransferError(
        "transport",
        `Retryable HTTP status ${response.status}`,
        resource.id,
      );
    }
    if (offset > 0 && response.status === 200) {
      await cancelBody(response);
      throw new StalePartialValidatorError();
    }
    if (response.status === 416) {
      const match = response.headers.get("content-range")?.match(UNSATISFIED_RANGE);
      await cancelBody(response);
      if (
        offset === resource.bytes &&
        match !== undefined &&
        match !== null &&
        Number(match[1]) === resource.bytes
      ) {
        creditResumedBytes();
        return;
      }
      throw validator(observer, resource.id, "Unsatisfied range does not prove exact completion");
    }
    if (response.status !== 206) {
      await cancelBody(response);
      throw validator(
        observer,
        resource.id,
        `Range request returned forbidden status ${response.status}`,
      );
    }
    const etag = response.headers.get("etag");
    const contentRange = response.headers.get("content-range")?.match(CONTENT_RANGE);
    const contentLength = parseDecimal(response.headers.get("content-length"));
    const expectedRemaining = resource.bytes - offset;
    if (
      response.url !== url ||
      contentRange === undefined ||
      contentRange === null ||
      Number(contentRange[1]) !== offset ||
      Number(contentRange[2]) !== resource.bytes - 1 ||
      Number(contentRange[3]) !== resource.bytes ||
      contentLength !== expectedRemaining ||
      response.headers.has("content-encoding") ||
      etag === null ||
      !isStrongEtag(etag) ||
      response.body === null
    ) {
      await cancelBody(response);
      throw validator(
        observer,
        resource.id,
        "206 response violates exact range/validator contract",
      );
    }
    if (prepared.strongEtag !== null && prepared.strongEtag !== etag) {
      await cancelBody(response);
      throw new StalePartialValidatorError();
    }
    creditResumedBytes();
    try {
      await consumeBody(
        store,
        observer,
        response.body.getReader(),
        input,
        resource,
        offset,
        etag,
        clearIdleDeadline,
        armIdleDeadline,
      );
    } catch (error: unknown) {
      if (
        input.signal.aborted ||
        error instanceof InstallerTransferError ||
        error instanceof InstallerStoreError ||
        isQuotaExceededError(error)
      ) {
        throw error;
      }
      observer.transportFailure(resource.id);
      throw new InstallerTransferError(
        "transport",
        error instanceof Error ? error.message : String(error),
        resource.id,
      );
    }
  } finally {
    clearIdleDeadline();
    input.signal.removeEventListener("abort", abortFromOwner);
  }
}

class StalePartialValidatorError extends Error {}

async function consumeBody(
  store: InstallerTransferStore,
  observer: InstallerTransferObserver,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  input: InstallerTransferInput,
  resource: InstallResource,
  initialOffset: number,
  strongEtag: string,
  pauseIdleDeadline: () => void,
  armIdleDeadline: () => void,
): Promise<void> {
  let durableOffset = initialOffset;
  let tail = new Uint8Array(input.policy.checkpointBytes);
  let tailBytes = 0;
  let firstRead = true;
  try {
    while (true) {
      if (input.signal.aborted) {
        await reader.cancel(input.signal.reason).catch(() => undefined);
        throw input.signal.reason;
      }
      if (!firstRead) armIdleDeadline();
      const result = await reader.read();
      pauseIdleDeadline();
      firstRead = false;
      if (result.done) break;
      if (!(result.value instanceof Uint8Array) || result.value.byteLength === 0) {
        throw validator(observer, resource.id, "Response stream produced an invalid chunk");
      }
      if (safeAdd(safeAdd(durableOffset, tailBytes), result.value.byteLength) > resource.bytes) {
        throw validator(observer, resource.id, "Response body overflowed expected resource size");
      }
      observer.downloaded(result.value.byteLength);
      let cursor = 0;
      while (cursor < result.value.byteLength) {
        const copy = Math.min(tail.byteLength - tailBytes, result.value.byteLength - cursor);
        tail.set(result.value.subarray(cursor, cursor + copy), tailBytes);
        tailBytes += copy;
        cursor += copy;
        if (tailBytes === tail.byteLength) {
          const checkpoint = tail;
          const snapshot = await callStore("append-partial", resource.id, () =>
            store.appendPartial({
              bytes: checkpoint,
              expectedOffset: durableOffset,
              releaseDigest: input.releaseDigest,
              resourceId: resource.id,
              strongEtag,
            }),
          );
          durableOffset = snapshot.bytesCommitted;
          observer.checkpoint(checkpoint.byteLength);
          tail = new Uint8Array(input.policy.checkpointBytes);
          tailBytes = 0;
        }
      }
    }
    if (tailBytes > 0) {
      if (durableOffset + tailBytes !== resource.bytes) {
        throw validator(
          observer,
          resource.id,
          "Short final checkpoint does not end at resource size",
        );
      }
      const checkpoint = tail.slice(0, tailBytes);
      const snapshot = await callStore("append-partial", resource.id, () =>
        store.appendPartial({
          bytes: checkpoint,
          expectedOffset: durableOffset,
          releaseDigest: input.releaseDigest,
          resourceId: resource.id,
          strongEtag,
        }),
      );
      durableOffset = snapshot.bytesCommitted;
      observer.checkpoint(checkpoint.byteLength);
    }
    if (durableOffset !== resource.bytes) {
      throw validator(observer, resource.id, "Response body ended before expected resource size");
    }
  } catch (error: unknown) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function validator(
  observer: InstallerTransferObserver,
  resourceId: string,
  message: string,
): InstallerTransferError {
  observer.validatorFailure(resourceId);
  return new InstallerTransferError("validator", message, resourceId);
}

function parseDecimal(value: string | null): number | null {
  if (value === null || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function validatePolicy(policy: InstallerTransferPolicy): void {
  if (
    !Number.isSafeInteger(policy.checkpointBytes) ||
    policy.checkpointBytes <= 0 ||
    !Number.isSafeInteger(policy.concurrency) ||
    policy.concurrency <= 0 ||
    policy.concurrency > 16 ||
    !Number.isSafeInteger(policy.requestTimeoutMs) ||
    policy.requestTimeoutMs <= 0
  ) {
    throw new Error("Invalid installer transfer policy");
  }
}

function safeAdd(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw new Error("Installer byte total exceeds safe integer");
  return sum;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Installer transfer aborted", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}

async function callStore<T>(
  operation: InstallerStoreError["operation"],
  resourceId: string,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error: unknown) {
    if (error instanceof InstallerQuotaError || error instanceof InstallerStoreError) throw error;
    if (error instanceof InstallStoreIntegrityError) {
      throw new InstallerTransferError("integrity", error.message, resourceId);
    }
    if (isQuotaExceededError(error)) {
      throw new InstallerQuotaError(resourceId, error.message);
    }
    throw new InstallerStoreError(operation, resourceId, error);
  }
}

function isQuotaExceededError(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}
