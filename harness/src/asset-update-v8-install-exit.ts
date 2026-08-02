import type { InstallManifest } from "./install-manifest.js";

export const INITIAL_INSTALL_BUDGET_MS = 90_000;
export const FRESH_INSTALLED_LAUNCH_BUDGET_MS = 30_000;
export const INSTALL_EXIT_CONTRACT = "installed-lifecycle-exit@1";
export const FINAL_VERIFICATION_POLL_INTERVAL_MS = 20;
export const FINAL_VERIFICATION_POST_READY_TIMEOUT_MS = 10_000;

export interface InstallControlIdentity {
  readonly bodyBytes: number;
  readonly etag: string;
  readonly source: "build-manifest.json" | "install-manifest.json";
}

export function installControlIdentities(
  authority: Readonly<{
    readonly artifactDigest: string;
    readonly buildManifestBase64: string;
    readonly installManifestBase64: string;
    readonly releaseDigest: string;
  }>,
): readonly InstallControlIdentity[] {
  return Object.freeze([
    Object.freeze({
      bodyBytes: Buffer.from(authority.buildManifestBase64, "base64").byteLength,
      etag: `"sha256-${authority.artifactDigest}"`,
      source: "build-manifest.json" as const,
    }),
    Object.freeze({
      bodyBytes: Buffer.from(authority.installManifestBase64, "base64").byteLength,
      etag: `"sha256-${authority.releaseDigest}"`,
      source: "install-manifest.json" as const,
    }),
  ]);
}

export interface InstallControlRequestInterval {
  readonly bodyBytes: number;
  readonly endedAtMs: number;
  readonly etag: string;
  readonly range: null;
  readonly requestId: string;
  readonly source: InstallControlIdentity["source"];
  readonly startedAtMs: number;
  readonly status: 200;
}

export interface InstallNetworkRequestInterval {
  readonly bodyBytes: number;
  readonly contentRange: string;
  readonly endedAtMs: number;
  readonly etag: string;
  readonly range: string;
  readonly requestId: string;
  readonly source: string;
  readonly startedAtMs: number;
  readonly status: 206;
}

export interface InitialInstallExitEvidence {
  readonly contract: typeof INSTALL_EXIT_CONTRACT;
  readonly finalVerificationObservation: Readonly<{
    readonly firstObservedCompleteAtMs: number;
    readonly firstObservedVerifyingAtMs: number;
    readonly observedSpanMs: number;
    readonly pollIntervalMs: typeof FINAL_VERIFICATION_POLL_INTERVAL_MS;
  }>;
  readonly installWall: Readonly<{
    readonly durationMs: number;
    readonly readyAtMs: number;
    readonly startedAtMs: number;
  }>;
  readonly network: Readonly<{
    readonly activeIntervalUnionMs: number;
    readonly controlBodyBytes: number;
    readonly controlRequestCount: number;
    readonly controlRequests: readonly InstallControlRequestInterval[];
    readonly resourceBodyBytes: number;
    readonly resourceCount: number;
    readonly resourceRequestCount: number;
    readonly resourceRequests: readonly InstallNetworkRequestInterval[];
    readonly source: "cdp-installer-worker-network@1";
    readonly workerSource: string;
  }>;
  readonly networkIdleLocalCriticalPathBudgetMs: typeof INITIAL_INSTALL_BUDGET_MS;
  readonly networkIdleLocalCriticalPathMs: number;
}

export interface InitialInstallExitBreakdown {
  readonly contract: typeof INSTALL_EXIT_CONTRACT;
  readonly finalVerificationObservation: InitialInstallExitEvidence["finalVerificationObservation"];
  readonly installWall: InitialInstallExitEvidence["installWall"];
  readonly network: Readonly<
    Omit<InitialInstallExitEvidence["network"], "controlRequests" | "resourceRequests">
  >;
  readonly networkIdleLocalCriticalPathBudgetMs: typeof INITIAL_INSTALL_BUDGET_MS;
  readonly networkIdleLocalCriticalPathMs: number;
  readonly state: "independently-validated";
}

interface MutableRequest {
  bodyBytes: number | null;
  contentRange: string | null;
  endedAtMs: number | null;
  etag: string | null;
  range: string | null;
  requestId: string;
  source: string;
  startedAtMs: number;
  status: number | null;
  type: "control" | "resource";
}

export interface CdpNetworkCapture {
  readonly requestWillBeSent: (event: {
    readonly requestId: string;
    readonly request: Readonly<{
      readonly headers: Record<string, unknown>;
      readonly method: string;
      readonly url: string;
    }>;
    readonly redirectResponse?: unknown;
    readonly timestamp: number;
  }) => void;
  readonly responseReceived: (event: {
    readonly requestId: string;
    readonly response: Readonly<{
      readonly headers: Record<string, unknown>;
      readonly status: number;
      readonly url: string;
    }>;
  }) => void;
  readonly loadingFinished: (event: {
    readonly requestId: string;
    readonly timestamp: number;
  }) => void;
  readonly loadingFailed: (event: {
    readonly errorText: string;
    readonly requestId: string;
  }) => void;
  readonly finish: () => Readonly<{
    readonly controlRequests: readonly InstallControlRequestInterval[];
    readonly resourceRequests: readonly InstallNetworkRequestInterval[];
  }>;
}

export function createInstallCdpNetworkCapture(
  origin: string,
  manifest: InstallManifest,
  controls: readonly InstallControlIdentity[],
): CdpNetworkCapture {
  const expectedResources = new Map(
    manifest.resources
      .filter(({ target }) => target === "opfs")
      .map((resource) => [new URL(resource.source, origin).href, resource] as const),
  );
  const expectedControls = new Map(
    controls.map((control) => [new URL(control.source, origin).href, control] as const),
  );
  const requests = new Map<string, MutableRequest>();
  let failure: Error | null = null;
  const fail = (message: string): void => {
    failure ??= new Error(message);
  };
  const requestWillBeSent: CdpNetworkCapture["requestWillBeSent"] = (event) => {
    const resource = expectedResources.get(event.request.url);
    const control = expectedControls.get(event.request.url);
    if (
      (resource === undefined && control === undefined) ||
      event.request.method !== "GET" ||
      event.redirectResponse !== undefined
    ) {
      fail(
        `Initial-install installer-worker request was unknown or redirected: ${event.request.url}`,
      );
      return;
    }
    if (requests.has(event.requestId)) {
      fail(`Initial-install CDP request ID was duplicated: ${event.requestId}`);
      return;
    }
    requests.set(event.requestId, {
      bodyBytes: null,
      contentRange: null,
      endedAtMs: null,
      etag: null,
      range: header(event.request.headers, "range"),
      requestId: event.requestId,
      source: resource?.source ?? control?.source ?? "invalid",
      startedAtMs: event.timestamp * 1_000,
      status: null,
      type: resource === undefined ? "control" : "resource",
    });
  };
  const responseReceived: CdpNetworkCapture["responseReceived"] = (event) => {
    const request = requests.get(event.requestId);
    if (request === undefined) {
      fail(`Initial-install CDP response had no exact request: ${event.requestId}`);
      return;
    }
    if (event.response.url !== new URL(request.source, origin).href || request.status !== null) {
      fail(`Initial-install CDP response URL or multiplicity was invalid: ${request.source}`);
      return;
    }
    request.status = event.response.status;
    request.contentRange = header(event.response.headers, "content-range");
    request.etag = header(event.response.headers, "etag");
    const length = header(event.response.headers, "content-length");
    request.bodyBytes = length === null ? null : Number(length);
  };
  const loadingFinished: CdpNetworkCapture["loadingFinished"] = (event) => {
    const request = requests.get(event.requestId);
    if (request === undefined || request.endedAtMs !== null) {
      fail(`Initial-install CDP completion had no unique request: ${event.requestId}`);
      return;
    }
    request.endedAtMs = event.timestamp * 1_000;
  };
  const loadingFailed: CdpNetworkCapture["loadingFailed"] = (event) => {
    fail(`Initial-install CDP request failed: ${event.requestId}: ${event.errorText}`);
  };
  return Object.freeze({
    finish: () => {
      if (failure !== null) throw failure;
      const completed = [...requests.values()]
        .sort((left, right) =>
          left.source < right.source ? -1 : left.source > right.source ? 1 : 0,
        )
        .map((request) => {
          if (
            request.endedAtMs === null ||
            request.status === null ||
            request.bodyBytes === null ||
            request.etag === null ||
            (request.type === "resource" &&
              (request.contentRange === null || request.range === null)) ||
            (request.type === "control" &&
              (request.contentRange !== null || request.range !== null))
          ) {
            throw new Error(`Initial-install CDP request was incomplete: ${request.source}`);
          }
          return Object.freeze({
            bodyBytes: request.bodyBytes,
            endedAtMs: request.endedAtMs,
            etag: request.etag,
            range: request.range,
            requestId: request.requestId,
            source: request.source,
            startedAtMs: request.startedAtMs,
            status: request.status,
            type: request.type,
          });
        });
      return Object.freeze({
        controlRequests: Object.freeze(
          completed
            .filter(({ type }) => type === "control")
            .map(({ type: _type, ...request }) => request as InstallControlRequestInterval),
        ),
        resourceRequests: Object.freeze(
          completed
            .filter(({ type }) => type === "resource")
            .map(
              ({ type: _type, ...request }) =>
                ({
                  ...request,
                  contentRange: requests.get(request.requestId)?.contentRange ?? "",
                }) as InstallNetworkRequestInterval,
            ),
        ),
      });
    },
    loadingFinished,
    loadingFailed,
    requestWillBeSent,
    responseReceived,
  });
}

export function buildInitialInstallExitEvidence(input: {
  readonly controlRequests: readonly InstallControlRequestInterval[];
  readonly finalVerificationFirstObservedCompleteAtMs: number;
  readonly finalVerificationFirstObservedVerifyingAtMs: number;
  readonly installReadyAtMs: number;
  readonly installStartedAtMs: number;
  readonly installerWorkerSource: string;
  readonly manifest: InstallManifest;
  readonly controls: readonly InstallControlIdentity[];
  readonly resourceRequests: readonly InstallNetworkRequestInterval[];
}): InitialInstallExitEvidence {
  const installWallMs = input.installReadyAtMs - input.installStartedAtMs;
  const networkUnionMs = mergeIntervalUnionMs([
    ...input.controlRequests,
    ...input.resourceRequests,
  ]);
  const residual = installWallMs - networkUnionMs;
  const evidence: InitialInstallExitEvidence = Object.freeze({
    contract: INSTALL_EXIT_CONTRACT,
    finalVerificationObservation: Object.freeze({
      firstObservedCompleteAtMs: input.finalVerificationFirstObservedCompleteAtMs,
      firstObservedVerifyingAtMs: input.finalVerificationFirstObservedVerifyingAtMs,
      observedSpanMs:
        input.finalVerificationFirstObservedCompleteAtMs -
        input.finalVerificationFirstObservedVerifyingAtMs,
      pollIntervalMs: FINAL_VERIFICATION_POLL_INTERVAL_MS,
    }),
    installWall: Object.freeze({
      durationMs: installWallMs,
      readyAtMs: input.installReadyAtMs,
      startedAtMs: input.installStartedAtMs,
    }),
    network: Object.freeze({
      activeIntervalUnionMs: networkUnionMs,
      controlBodyBytes: input.controlRequests.reduce((sum, request) => sum + request.bodyBytes, 0),
      controlRequestCount: input.controlRequests.length,
      controlRequests: Object.freeze([...input.controlRequests]),
      resourceBodyBytes: input.resourceRequests.reduce(
        (sum, request) => sum + request.bodyBytes,
        0,
      ),
      resourceCount: new Set(input.resourceRequests.map(({ source }) => source)).size,
      resourceRequestCount: input.resourceRequests.length,
      resourceRequests: Object.freeze([...input.resourceRequests]),
      source: "cdp-installer-worker-network@1" as const,
      workerSource: input.installerWorkerSource,
    }),
    networkIdleLocalCriticalPathBudgetMs: INITIAL_INSTALL_BUDGET_MS,
    networkIdleLocalCriticalPathMs: residual,
  });
  validateInitialInstallExitEvidence(
    evidence,
    input.manifest,
    input.installerWorkerSource,
    input.controls,
  );
  return evidence;
}

export function validateInitialInstallExitEvidence(
  input: unknown,
  manifest: InstallManifest,
  installerWorkerSource: string,
  controls: readonly InstallControlIdentity[],
): asserts input is InitialInstallExitEvidence {
  const evidence = object(input, "initial-install exit evidence");
  exactKeys(evidence, [
    "contract",
    "finalVerificationObservation",
    "installWall",
    "network",
    "networkIdleLocalCriticalPathBudgetMs",
    "networkIdleLocalCriticalPathMs",
  ]);
  if (
    evidence.contract !== INSTALL_EXIT_CONTRACT ||
    evidence.networkIdleLocalCriticalPathBudgetMs !== INITIAL_INSTALL_BUDGET_MS
  ) {
    throw new Error("Initial-install exit contract or budget is unsupported");
  }
  const wall = timing(evidence.installWall, "install wall", "readyAtMs");
  const verification = object(
    evidence.finalVerificationObservation,
    "final verification observation",
  );
  exactKeys(verification, [
    "firstObservedCompleteAtMs",
    "firstObservedVerifyingAtMs",
    "observedSpanMs",
    "pollIntervalMs",
  ]);
  if (
    verification.pollIntervalMs !== FINAL_VERIFICATION_POLL_INTERVAL_MS ||
    !finite(verification.firstObservedVerifyingAtMs) ||
    !finite(verification.firstObservedCompleteAtMs) ||
    !finite(verification.observedSpanMs) ||
    verification.firstObservedVerifyingAtMs < wall.startedAtMs ||
    verification.firstObservedVerifyingAtMs > wall.endedAtMs ||
    verification.firstObservedCompleteAtMs < verification.firstObservedVerifyingAtMs ||
    verification.firstObservedCompleteAtMs >
      wall.endedAtMs + FINAL_VERIFICATION_POST_READY_TIMEOUT_MS ||
    verification.observedSpanMs !==
      verification.firstObservedCompleteAtMs - verification.firstObservedVerifyingAtMs
  ) {
    throw new Error("Final-verification polling observation is inconsistent");
  }
  const network = object(evidence.network, "initial-install network");
  exactKeys(network, [
    "activeIntervalUnionMs",
    "controlBodyBytes",
    "controlRequestCount",
    "controlRequests",
    "resourceBodyBytes",
    "resourceCount",
    "resourceRequestCount",
    "resourceRequests",
    "source",
    "workerSource",
  ]);
  if (
    network.source !== "cdp-installer-worker-network@1" ||
    network.workerSource !== installerWorkerSource ||
    !Array.isArray(network.controlRequests) ||
    !Array.isArray(network.resourceRequests)
  ) {
    throw new Error("Initial-install network capture is not exact CDP evidence");
  }
  const resourceRequests = network.resourceRequests.map((candidate, index) =>
    validateRequest(candidate, index, wall),
  );
  const controlRequests = network.controlRequests.map((candidate, index) =>
    validateControlRequest(candidate, index, wall),
  );
  const allRequests = [...controlRequests, ...resourceRequests];
  const ids = new Set(allRequests.map(({ requestId }) => requestId));
  if (ids.size !== allRequests.length)
    throw new Error("Initial-install CDP request IDs are duplicate");
  const expected = manifest.resources.filter(({ target }) => target === "opfs");
  if (expected.length === 0) {
    throw new Error("Initial-install manifest contains no OPFS transfer resources");
  }
  const expectedBySource = new Map(expected.map((resource) => [resource.source, resource]));
  for (const request of resourceRequests) {
    if (!expectedBySource.has(request.source)) {
      throw new Error(`Initial-install CDP captured unknown resource: ${request.source}`);
    }
  }
  for (const resource of expected) {
    const observed = resourceRequests.filter(({ source }) => source === resource.source);
    if (observed.length === 0) {
      throw new Error(`Initial-install CDP did not observe worker resource: ${resource.source}`);
    }
    validateResourceCoverage(resource.source, resource.bytes, resource.sha256, observed);
  }
  validateControlCoverage(controlRequests, controls);
  const lastControlEnd = Math.max(...controlRequests.map(({ endedAtMs }) => endedAtMs));
  const firstResourceStart = Math.min(...resourceRequests.map(({ startedAtMs }) => startedAtMs));
  if (lastControlEnd > firstResourceStart) {
    throw new Error("Initial-install control documents did not complete before OPFS transfer");
  }
  const union = mergeIntervalUnionMs(allRequests);
  const resourceBodyBytes = resourceRequests.reduce((sum, request) => sum + request.bodyBytes, 0);
  const controlBodyBytes = controlRequests.reduce((sum, request) => sum + request.bodyBytes, 0);
  if (
    network.controlRequestCount !== 2 ||
    network.controlBodyBytes !== controlBodyBytes ||
    network.resourceRequestCount !== resourceRequests.length ||
    network.resourceCount !== expected.length ||
    network.resourceBodyBytes !== resourceBodyBytes ||
    network.activeIntervalUnionMs !== union
  ) {
    throw new Error("Initial-install CDP summary is not an exact request projection");
  }
  const residual = wall.durationMs - union;
  if (
    !finite(evidence.networkIdleLocalCriticalPathMs) ||
    residual < 0 ||
    evidence.networkIdleLocalCriticalPathMs !== residual
  ) {
    throw new Error(
      "Initial-install network-idle wall-clock critical-path residual is inconsistent",
    );
  }
}

export function validatedInitialInstallExitBreakdown(
  input: unknown,
  manifest: InstallManifest,
  installerWorkerSource: string,
  controls: readonly InstallControlIdentity[],
): InitialInstallExitBreakdown {
  validateInitialInstallExitEvidence(input, manifest, installerWorkerSource, controls);
  return Object.freeze({
    contract: input.contract,
    finalVerificationObservation: Object.freeze({ ...input.finalVerificationObservation }),
    installWall: Object.freeze({ ...input.installWall }),
    network: Object.freeze({
      activeIntervalUnionMs: input.network.activeIntervalUnionMs,
      controlBodyBytes: input.network.controlBodyBytes,
      controlRequestCount: input.network.controlRequestCount,
      resourceBodyBytes: input.network.resourceBodyBytes,
      resourceCount: input.network.resourceCount,
      resourceRequestCount: input.network.resourceRequestCount,
      source: input.network.source,
      workerSource: input.network.workerSource,
    }),
    networkIdleLocalCriticalPathBudgetMs: input.networkIdleLocalCriticalPathBudgetMs,
    networkIdleLocalCriticalPathMs: input.networkIdleLocalCriticalPathMs,
    state: "independently-validated",
  });
}

export function validateInitialInstallExitBudget(evidence: InitialInstallExitEvidence): void {
  if (evidence.networkIdleLocalCriticalPathMs > INITIAL_INSTALL_BUDGET_MS) {
    throw new Error(
      "Initial-install network-idle wall-clock critical-path residual exceeds 90000 ms",
    );
  }
}

export function mergeIntervalUnionMs(
  intervals: readonly Readonly<{ readonly endedAtMs: number; readonly startedAtMs: number }>[],
): number {
  if (intervals.length === 0) return 0;
  const ordered = [...intervals].sort(
    (left, right) => left.startedAtMs - right.startedAtMs || left.endedAtMs - right.endedAtMs,
  );
  let total = 0;
  let start = ordered[0]?.startedAtMs ?? 0;
  let end = ordered[0]?.endedAtMs ?? 0;
  for (const interval of ordered) {
    if (
      !finite(interval.startedAtMs) ||
      !finite(interval.endedAtMs) ||
      interval.endedAtMs < interval.startedAtMs
    ) {
      throw new Error("Initial-install network interval is impossible");
    }
    if (interval.startedAtMs <= end) end = Math.max(end, interval.endedAtMs);
    else {
      total += end - start;
      start = interval.startedAtMs;
      end = interval.endedAtMs;
    }
  }
  return total + end - start;
}

function validateControlCoverage(
  requests: readonly InstallControlRequestInterval[],
  expected: readonly InstallControlIdentity[],
): void {
  if (expected.length !== 2 || requests.length !== 2) {
    throw new Error("Initial-install control-document coverage is incomplete or duplicate");
  }
  for (const identity of expected) {
    const observed = requests.filter(({ source }) => source === identity.source);
    const request = observed[0];
    if (
      observed.length !== 1 ||
      request === undefined ||
      request.status !== 200 ||
      request.range !== null ||
      request.bodyBytes !== identity.bodyBytes ||
      request.etag !== identity.etag
    ) {
      throw new Error(`Initial-install control-document identity is invalid: ${identity.source}`);
    }
  }
}

function validateResourceCoverage(
  source: string,
  bytes: number,
  sha256: string,
  requests: readonly InstallNetworkRequestInterval[],
): void {
  const request = requests[0];
  if (
    requests.length !== 1 ||
    request === undefined ||
    request.status !== 206 ||
    request.range !== "bytes=0-" ||
    request.contentRange !== `bytes 0-${bytes - 1}/${bytes}` ||
    request.bodyBytes !== bytes ||
    request.etag !== `"sha256-${sha256}"`
  ) {
    throw new Error(`Initial-install Range coverage or identity is invalid: ${source}`);
  }
}

function validateRequest(
  input: unknown,
  index: number,
  wall: Readonly<{ durationMs: number; endedAtMs: number; startedAtMs: number }>,
): InstallNetworkRequestInterval {
  const request = object(input, `initial-install request ${index + 1}`);
  exactKeys(request, [
    "bodyBytes",
    "contentRange",
    "endedAtMs",
    "etag",
    "range",
    "requestId",
    "source",
    "startedAtMs",
    "status",
  ]);
  if (
    typeof request.requestId !== "string" ||
    request.requestId.length === 0 ||
    request.requestId.length > 256 ||
    typeof request.source !== "string" ||
    request.source.startsWith("/") ||
    request.source.includes("..") ||
    !Number.isSafeInteger(request.bodyBytes) ||
    (request.bodyBytes as number) <= 0 ||
    request.status !== 206 ||
    typeof request.range !== "string" ||
    typeof request.contentRange !== "string" ||
    typeof request.etag !== "string" ||
    !finite(request.startedAtMs) ||
    !finite(request.endedAtMs) ||
    (request.endedAtMs as number) < (request.startedAtMs as number)
  )
    throw new Error("Initial-install CDP request is malformed");
  // CDP has its own monotonic epoch. Only durations, not absolute alignment with Node, are comparable.
  if ((request.endedAtMs as number) - (request.startedAtMs as number) > wall.durationMs) {
    throw new Error("Initial-install CDP request duration exceeds the install wall");
  }
  return request as unknown as InstallNetworkRequestInterval;
}

function validateControlRequest(
  input: unknown,
  index: number,
  wall: Readonly<{ durationMs: number; endedAtMs: number; startedAtMs: number }>,
): InstallControlRequestInterval {
  const request = object(input, `initial-install control request ${index + 1}`);
  exactKeys(request, [
    "bodyBytes",
    "endedAtMs",
    "etag",
    "range",
    "requestId",
    "source",
    "startedAtMs",
    "status",
  ]);
  if (
    typeof request.requestId !== "string" ||
    request.requestId.length === 0 ||
    request.requestId.length > 256 ||
    (request.source !== "build-manifest.json" && request.source !== "install-manifest.json") ||
    !Number.isSafeInteger(request.bodyBytes) ||
    (request.bodyBytes as number) <= 0 ||
    request.status !== 200 ||
    request.range !== null ||
    typeof request.etag !== "string" ||
    !finite(request.startedAtMs) ||
    !finite(request.endedAtMs) ||
    (request.endedAtMs as number) < (request.startedAtMs as number) ||
    (request.endedAtMs as number) - (request.startedAtMs as number) > wall.durationMs
  ) {
    throw new Error("Initial-install control CDP request is malformed");
  }
  return request as unknown as InstallControlRequestInterval;
}

function timing(input: unknown, label: string, endKey: "completedAtMs" | "readyAtMs") {
  const value = object(input, label);
  exactKeys(value, [endKey, "durationMs", "startedAtMs"]);
  const end = value[endKey];
  if (
    !finite(value.startedAtMs) ||
    !finite(end) ||
    !finite(value.durationMs) ||
    (value.durationMs as number) < 0 ||
    (end as number) - (value.startedAtMs as number) !== value.durationMs
  ) {
    throw new Error(`${label} timing is impossible`);
  }
  return {
    durationMs: value.durationMs as number,
    endedAtMs: end as number,
    startedAtMs: value.startedAtMs as number,
  };
}

function header(headers: Record<string, unknown>, name: string): string | null {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  const value = key === undefined ? undefined : headers[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function object(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new Error(`${label} is not an object`);
  return input as Record<string, unknown>;
}

function exactKeys(input: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(input).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new Error("Initial-install evidence has unsupported or missing keys");
}

function finite(input: unknown): input is number {
  return typeof input === "number" && Number.isFinite(input);
}
