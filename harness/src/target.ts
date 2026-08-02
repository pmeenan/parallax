import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { extname, join } from "node:path";
import {
  type BuildManifest,
  type InstallOnlyFile,
  type ManifestArtifact,
  readAndValidateBuildManifest,
} from "./build-manifest.js";
import {
  createLocalServer,
  type LocalServerDetailedJournalEntry,
  type LocalServerJournalEntry,
  type LocalServerOptions,
  listenLocalServer,
  stopLocalServer,
} from "./server.js";

export const PRODUCTION_ORIGIN = "https://parallax-web.com";
export const AUTOMATION_RUNTIME_QUERY = "parallaxAutomation";
export const AUTOMATION_RUNTIME_VALUE = "runtime";
export const TARGET_HEADER_TIMEOUT_MS = 10_000;
export const TARGET_BODY_TIMEOUT_MS = 30_000;
export const TARGET_MANIFEST_MAX_BYTES = 1_048_576;
export const TARGET_VERIFICATION_CONCURRENCY = 8;

export type HarnessTargetRequest = "local" | typeof PRODUCTION_ORIGIN;
export type HarnessTargetKind = "local" | "production";
export type HarnessRepresentationClass =
  | "html"
  | "javascript"
  | "json"
  | "ktx2"
  | "meshopt"
  | "wasm";

export interface HarnessRepresentationSummary {
  readonly bytes: number;
  readonly count: number;
  readonly mimeTypes: readonly string[];
  readonly representation: HarnessRepresentationClass;
}

export interface HarnessTargetIdentity {
  readonly artifactDigest: string;
  readonly artifactDigestVerified: true;
  readonly kind: HarnessTargetKind;
  readonly localServerStarted: boolean;
  readonly origin: string;
  readonly releaseDigest: string;
  readonly releaseDigestVerified: true;
  readonly servingContract: Readonly<{
    readonly artifactBytes: number;
    readonly artifactCount: number;
    readonly conditionalArtifactCount: number;
    readonly documentCacheControl: string;
    readonly documentConditionalStatus: 304;
    readonly documentMimeType: string;
    readonly documentStatus: 200;
    readonly isolation: "coop-coep";
    readonly manifestCacheControl: string;
    readonly manifestConditionalStatus: 304;
    readonly manifestStatus: 200;
    readonly nosniff: true;
    readonly representations: readonly HarnessRepresentationSummary[];
  }>;
}

export type HarnessTargetVerificationEvidence =
  | Readonly<{
      readonly identity: HarnessTargetIdentity;
      readonly state: "verified";
    }>
  | Readonly<{
      readonly reason: string;
      readonly state: "failed";
    }>;

export interface ParsedHarnessTarget {
  readonly remainingArguments: readonly string[];
  readonly request: HarnessTargetRequest;
}

export interface HarnessTargetSession {
  readonly baseUrl: string;
  readonly identity: HarnessTargetIdentity;
  readonly localServerMetricsAvailable: boolean;
  readonly probeUrl: string;
  revalidate(): Promise<HarnessTargetIdentity>;
  stop(): Promise<void>;
}

interface StartHarnessTargetInput {
  readonly artifactDigest: string;
  readonly buildManifest: BuildManifest;
  readonly buildRoot: string;
  readonly documentOverride?: LocalServerOptions["documentOverride"];
  readonly exactRangeResources?: LocalServerOptions["exactRangeResources"];
  readonly installOnlyFiles?: readonly InstallOnlyFile[];
  readonly localHostname?: "127.0.0.1" | "localhost";
  readonly onLocalResponse?: (entry: LocalServerJournalEntry) => void;
  readonly onLocalDetailedResponse?: (entry: LocalServerDetailedJournalEntry) => void;
  readonly request: HarnessTargetRequest;
}

interface BoundedResponse {
  readonly body: Buffer;
  readonly headers: Headers;
  readonly status: number;
  readonly url: string;
}

export function harnessRuntimeUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set(AUTOMATION_RUNTIME_QUERY, AUTOMATION_RUNTIME_VALUE);
  return url.href;
}

export function parseHarnessTargetArguments(arguments_: readonly string[]): ParsedHarnessTarget {
  let request: HarnessTargetRequest = "local";
  let targetSeen = false;
  const remainingArguments: string[] = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument !== "--target") {
      remainingArguments.push(argument ?? "");
      continue;
    }
    if (targetSeen) throw new Error("--target may only be specified once");
    const value = arguments_[index + 1];
    if (value === undefined) {
      throw new Error(`--target requires "local" or "${PRODUCTION_ORIGIN}"`);
    }
    if (value !== "local" && value !== PRODUCTION_ORIGIN) {
      throw new Error(
        `Unsupported harness target ${JSON.stringify(value)}; expected "local" or "${PRODUCTION_ORIGIN}"`,
      );
    }
    request = value;
    targetSeen = true;
    index += 1;
  }
  return Object.freeze({
    remainingArguments: Object.freeze(remainingArguments),
    request,
  });
}

export async function startHarnessTarget(
  input: StartHarnessTargetInput,
): Promise<HarnessTargetSession> {
  assertInstallOnlyFilesAreExactRangeResources(
    input.installOnlyFiles ?? [],
    input.exactRangeResources ?? [],
  );
  const buildManifestDigest = sha256(readFileSync(join(input.buildRoot, "build-manifest.json")));
  const releaseDigest = input.buildManifest.artifacts.find(
    (artifact) => artifact.path === input.buildManifest.installManifestEntrypoint.path,
  )?.sha256;
  if (releaseDigest === undefined) throw new Error("Build manifest omits release identity");
  let server: Server | null = null;
  let baseUrl: string;
  let probeUrl: string;
  const kind: HarnessTargetKind = input.request === "local" ? "local" : "production";
  if (kind === "local") {
    server = createLocalServer({
      ...(input.documentOverride === undefined ? {} : { documentOverride: input.documentOverride }),
      ...(input.exactRangeResources === undefined
        ? {}
        : { exactRangeResources: input.exactRangeResources }),
      ...(input.onLocalResponse === undefined ? {} : { onResponse: input.onLocalResponse }),
      ...(input.onLocalDetailedResponse === undefined
        ? {}
        : { onDetailedResponse: input.onLocalDetailedResponse }),
      root: input.buildRoot,
    });
    const address = await listenLocalServer(server);
    baseUrl = `http://${input.localHostname ?? "127.0.0.1"}:${address.port}`;
    probeUrl = `${baseUrl}/__parallax/identity`;
  } else {
    baseUrl = PRODUCTION_ORIGIN;
    probeUrl = `${baseUrl}/`;
  }

  try {
    const verify = async (): Promise<HarnessTargetIdentity> => {
      if (kind === "local" && input.installOnlyFiles !== undefined) {
        const local = await readAndValidateBuildManifest(input.buildRoot, {
          installOnlyFiles: input.installOnlyFiles,
        });
        if (
          local.artifactDigest !== input.artifactDigest ||
          local.releaseDigest !== releaseDigest
        ) {
          throw new Error("Local target combined build/install-only inventory identity drifted");
        }
      }
      return verifyHarnessTarget({
        artifactDigest: input.artifactDigest,
        baseUrl,
        buildManifest: input.buildManifest,
        buildManifestDigest,
        kind,
        releaseDigest,
      });
    };
    const identity = await verify();
    return Object.freeze({
      baseUrl,
      identity,
      localServerMetricsAvailable: kind === "local",
      probeUrl,
      revalidate: verify,
      stop: () => (server === null ? Promise.resolve() : stopLocalServer(server)),
    });
  } catch (error: unknown) {
    if (server !== null) {
      try {
        await stopLocalServer(server);
      } catch (stopError: unknown) {
        throw new AggregateError(
          [error, stopError],
          "Harness target startup and local-server shutdown both failed",
        );
      }
    }
    throw error;
  }
}

function assertInstallOnlyFilesAreExactRangeResources(
  installOnlyFiles: readonly InstallOnlyFile[],
  exactRangeResources: readonly Readonly<{
    readonly bytes: number;
    readonly sha256: string;
    readonly source: string;
  }>[],
): void {
  for (const file of installOnlyFiles) {
    const matches = exactRangeResources.filter(
      (resource) =>
        resource.source === file.source &&
        resource.bytes === file.bytes &&
        resource.sha256 === file.sha256,
    );
    if (matches.length !== 1) {
      throw new Error(`Install-only model lacks one exact Range binding: ${file.source}`);
    }
  }
}

export function verifiedTargetEvidence(
  identity: HarnessTargetIdentity,
): HarnessTargetVerificationEvidence {
  return Object.freeze({ identity, state: "verified" });
}

export function failedTargetEvidence(error: unknown): HarnessTargetVerificationEvidence {
  return Object.freeze({
    reason: error instanceof Error ? error.message : String(error),
    state: "failed",
  });
}

export async function captureTargetPostflight(
  revalidate: () => Promise<HarnessTargetIdentity>,
): Promise<HarnessTargetVerificationEvidence> {
  try {
    return verifiedTargetEvidence(await revalidate());
  } catch (error: unknown) {
    return failedTargetEvidence(error);
  }
}

export interface HarnessTargetPostflightCaptureState {
  readonly attempted: boolean;
  readonly evidence: HarnessTargetVerificationEvidence;
}

export function pendingTargetPostflightCapture(
  reason = "Serving target postflight has not run",
): HarnessTargetPostflightCaptureState {
  return Object.freeze({
    attempted: false,
    evidence: failedTargetEvidence(reason),
  });
}

export async function captureTargetPostflightOnce(
  preflight: HarnessTargetIdentity,
  state: HarnessTargetPostflightCaptureState,
  revalidate: () => Promise<HarnessTargetIdentity>,
): Promise<HarnessTargetPostflightCaptureState> {
  if (state.attempted) return state;
  return Object.freeze({
    attempted: true,
    evidence: reconcileTargetPostflight(preflight, await captureTargetPostflight(revalidate)),
  });
}

export function reconcileTargetPostflight(
  preflight: HarnessTargetIdentity,
  observed: HarnessTargetVerificationEvidence,
): HarnessTargetVerificationEvidence {
  if (observed.state === "failed") return observed;
  if (JSON.stringify(preflight) === JSON.stringify(observed.identity)) return observed;
  return failedTargetEvidence(
    "Serving target identity changed between preflight and postflight verification",
  );
}

export function formatTargetVerificationEvidence(
  evidence: HarnessTargetVerificationEvidence,
): string {
  return evidence.state === "verified" ? "verified" : `failed — ${evidence.reason}`;
}

export function assertHarnessNavigationUrl(
  actualUrl: string,
  expectedUrl: string,
  label: string,
): void {
  if (actualUrl !== expectedUrl) {
    throw new Error(`${label} navigated to ${actualUrl}; expected exact target ${expectedUrl}`);
  }
}

export function validateHarnessTargetEvidence(
  value: unknown,
  label = "harness target evidence",
): asserts value is HarnessTargetVerificationEvidence {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  if (value.state === "verified") {
    if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["identity", "state"])) {
      throw new Error(`${label} verified fields are invalid`);
    }
    validateHarnessTargetIdentity(value.identity, `${label} identity`);
    return;
  }
  if (
    value.state !== "failed" ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["reason", "state"]) ||
    typeof value.reason !== "string" ||
    value.reason.trim() === ""
  ) {
    throw new Error(`${label} failure is invalid`);
  }
}

export function validateHarnessTargetIdentity(
  value: unknown,
  label = "harness target",
): asserts value is HarnessTargetIdentity {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const keys = Object.keys(value).sort();
  const expectedKeys = [
    "artifactDigest",
    "artifactDigestVerified",
    "kind",
    "localServerStarted",
    "origin",
    "releaseDigest",
    "releaseDigestVerified",
    "servingContract",
  ];
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`${label} fields are invalid`);
  }
  if (
    !/^[a-f0-9]{64}$/.test(String(value.artifactDigest)) ||
    value.artifactDigestVerified !== true ||
    !/^[a-f0-9]{64}$/.test(String(value.releaseDigest)) ||
    value.releaseDigestVerified !== true ||
    (value.kind !== "local" && value.kind !== "production") ||
    typeof value.localServerStarted !== "boolean" ||
    typeof value.origin !== "string" ||
    !isRecord(value.servingContract)
  ) {
    throw new Error(`${label} identity is invalid`);
  }
  if (
    (value.kind === "production" &&
      (value.origin !== PRODUCTION_ORIGIN || value.localServerStarted !== false)) ||
    (value.kind === "local" &&
      (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(value.origin) ||
        value.localServerStarted !== true))
  ) {
    throw new Error(`${label} kind/origin is contradictory`);
  }
  const contract = value.servingContract;
  const expectedContractKeys = [
    "artifactBytes",
    "artifactCount",
    "conditionalArtifactCount",
    "documentCacheControl",
    "documentConditionalStatus",
    "documentMimeType",
    "documentStatus",
    "isolation",
    "manifestCacheControl",
    "manifestConditionalStatus",
    "manifestStatus",
    "nosniff",
    "representations",
  ];
  if (
    JSON.stringify(Object.keys(contract).sort()) !== JSON.stringify(expectedContractKeys) ||
    !positiveInteger(contract.artifactCount) ||
    !positiveInteger(contract.artifactBytes) ||
    contract.conditionalArtifactCount !== contract.artifactCount ||
    contract.documentStatus !== 200 ||
    contract.documentConditionalStatus !== 304 ||
    contract.manifestStatus !== 200 ||
    contract.manifestConditionalStatus !== 304 ||
    contract.isolation !== "coop-coep" ||
    contract.nosniff !== true ||
    typeof contract.documentCacheControl !== "string" ||
    typeof contract.manifestCacheControl !== "string" ||
    typeof contract.documentMimeType !== "string" ||
    mimeBase(contract.documentMimeType) !== "text/html" ||
    !Array.isArray(contract.representations)
  ) {
    throw new Error(`${label} serving contract is invalid`);
  }
  requireMutableCacheControlValue(contract.documentCacheControl, `${label} document`);
  requireMutableCacheControlValue(contract.manifestCacheControl, `${label} manifest`);
  const representations = contract.representations;
  const names = representations.map((entry) =>
    isRecord(entry) ? String(entry.representation) : "",
  );
  if (
    new Set(names).size !== names.length ||
    representations.some(
      (entry) =>
        !isRecord(entry) ||
        !isRepresentationClass(entry.representation) ||
        !positiveInteger(entry.count) ||
        !positiveInteger(entry.bytes) ||
        !Array.isArray(entry.mimeTypes) ||
        entry.mimeTypes.length === 0 ||
        entry.mimeTypes.some((mime) => typeof mime !== "string" || mime.trim() === ""),
    )
  ) {
    throw new Error(`${label} representation summary is invalid`);
  }
  const representationCount = representations.reduce(
    (total, entry) => total + Number((entry as Record<string, unknown>).count),
    0,
  );
  const representationBytes = representations.reduce(
    (total, entry) => total + Number((entry as Record<string, unknown>).bytes),
    0,
  );
  for (const entry of representations) {
    if (!isRecord(entry) || !isRepresentationClass(entry.representation)) continue;
    const expected = expectedRepresentationMimeTypes(entry.representation);
    if (
      !Array.isArray(entry.mimeTypes) ||
      entry.mimeTypes.some((mime) => typeof mime !== "string" || !expected.has(mimeBase(mime)))
    ) {
      throw new Error(`${label} representation MIME summary is invalid`);
    }
  }
  if (
    representationCount !== contract.artifactCount ||
    representationBytes !== contract.artifactBytes
  ) {
    throw new Error(`${label} representation totals are inconsistent`);
  }
}

async function verifyHarnessTarget(input: {
  readonly artifactDigest: string;
  readonly baseUrl: string;
  readonly buildManifest: BuildManifest;
  readonly buildManifestDigest: string;
  readonly kind: HarnessTargetKind;
  readonly releaseDigest: string;
}): Promise<HarnessTargetIdentity> {
  const expectedOrigin = new URL(input.baseUrl).origin;
  const indexArtifact = input.buildManifest.artifacts.find(
    (artifact) => artifact.path === "index.html",
  );
  if (indexArtifact === undefined) throw new Error("Build manifest does not list index.html");

  const manifestUrl = new URL("/build-manifest.json", `${input.baseUrl}/`);
  const manifestResponse = await boundedExactRequest(
    manifestUrl,
    { cache: "no-store" },
    TARGET_MANIFEST_MAX_BYTES,
    "build manifest",
  );
  requireExactFinalOrigin(manifestResponse, manifestUrl, expectedOrigin, "build manifest");
  requireStatus(manifestResponse, 200, "build manifest");
  requireServingHeaders(manifestResponse, "build manifest");
  requireMimeType(manifestResponse, "application/json", "build manifest");
  const manifestCacheControl = requireMutableCacheControl(manifestResponse, "build manifest");
  const manifestEtag = requireHeader(manifestResponse, "etag", "build manifest");
  const observedBuildManifestDigest = sha256(manifestResponse.body);
  if (
    observedBuildManifestDigest !== input.buildManifestDigest ||
    observedBuildManifestDigest !== input.artifactDigest
  ) {
    throw new Error(
      `Harness target build-manifest mismatch: expected ${input.buildManifestDigest}, received ${observedBuildManifestDigest}`,
    );
  }
  const conditionalManifest = await boundedExactRequest(
    manifestUrl,
    {
      cache: "no-store",
      headers: { "If-None-Match": manifestEtag },
    },
    0,
    "conditional build manifest",
  );
  requireExactFinalOrigin(
    conditionalManifest,
    manifestUrl,
    expectedOrigin,
    "conditional build manifest",
  );
  requireStatus(conditionalManifest, 304, "conditional build manifest");
  requireServingHeaders(conditionalManifest, "conditional build manifest");
  requireMutableCacheControl(conditionalManifest, "conditional build manifest");
  requireMatchingEtag(conditionalManifest, manifestEtag, "conditional build manifest");

  const documentUrl = new URL("/", `${input.baseUrl}/`);
  const document = await verifyArtifactRepresentation({
    artifact: indexArtifact,
    expectedOrigin,
    label: "root document",
    url: documentUrl,
  });
  const documentCacheControl = requireMutableCacheControl(document.response, "root document");

  const artifactObservations = await mapWithConcurrency(
    input.buildManifest.artifacts.filter((artifact) => artifact.path !== "index.html"),
    TARGET_VERIFICATION_CONCURRENCY,
    async (artifact) =>
      verifyArtifactRepresentation({
        artifact,
        expectedOrigin,
        label: `manifest artifact ${artifact.path}`,
        url: new URL(`/${artifact.path}`, `${input.baseUrl}/`),
      }),
  );
  const observations = [document, ...artifactObservations];
  const installObservation = observations.find(
    (observation) =>
      observation.artifact.path === input.buildManifest.installManifestEntrypoint.path,
  );
  if (
    installObservation === undefined ||
    sha256(installObservation.response.body) !== input.releaseDigest
  ) {
    throw new Error("Harness target install-manifest release identity does not match");
  }
  const representationMap = new Map<
    HarnessRepresentationClass,
    { bytes: number; count: number; mimeTypes: Set<string> }
  >();
  for (const observation of observations) {
    const representation = representationClass(observation.artifact.path);
    const current = representationMap.get(representation) ?? {
      bytes: 0,
      count: 0,
      mimeTypes: new Set<string>(),
    };
    current.bytes += observation.artifact.bytes;
    current.count += 1;
    current.mimeTypes.add(
      mimeBase(requireHeader(observation.response, "content-type", "artifact")),
    );
    representationMap.set(representation, current);
  }
  const representations = Object.freeze(
    [...representationMap.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([representation, summary]) =>
        Object.freeze({
          bytes: summary.bytes,
          count: summary.count,
          mimeTypes: Object.freeze([...summary.mimeTypes].sort()),
          representation,
        }),
      ),
  );

  return Object.freeze({
    artifactDigest: input.artifactDigest,
    artifactDigestVerified: true,
    kind: input.kind,
    localServerStarted: input.kind === "local",
    origin: input.baseUrl,
    releaseDigest: input.releaseDigest,
    releaseDigestVerified: true,
    servingContract: Object.freeze({
      artifactBytes: input.buildManifest.artifacts.reduce(
        (total, artifact) => total + artifact.bytes,
        0,
      ),
      artifactCount: input.buildManifest.artifacts.length,
      conditionalArtifactCount: observations.length,
      documentCacheControl,
      documentConditionalStatus: 304,
      documentMimeType: requireHeader(document.response, "content-type", "root document"),
      documentStatus: 200,
      isolation: "coop-coep",
      manifestCacheControl,
      manifestConditionalStatus: 304,
      manifestStatus: 200,
      nosniff: true,
      representations,
    }),
  });
}

async function verifyArtifactRepresentation(input: {
  readonly artifact: ManifestArtifact;
  readonly expectedOrigin: string;
  readonly label: string;
  readonly url: URL;
}): Promise<Readonly<{ artifact: ManifestArtifact; response: BoundedResponse }>> {
  const response = await boundedExactRequest(
    input.url,
    { cache: "no-store" },
    input.artifact.bytes,
    input.label,
  );
  requireExactFinalOrigin(response, input.url, input.expectedOrigin, input.label);
  requireStatus(response, 200, input.label);
  requireServingHeaders(response, input.label);
  requireMimeType(response, expectedMimeType(input.artifact.path), input.label);
  const immutable = input.artifact.path.startsWith("immutable/");
  if (immutable) requireImmutableCacheControl(response, input.label);
  else requireMutableCacheControl(response, input.label);
  const etag = requireHeader(response, "etag", input.label);
  if (
    response.body.byteLength !== input.artifact.bytes ||
    sha256(response.body) !== input.artifact.sha256
  ) {
    throw new Error(`${input.label} bytes do not match the build manifest`);
  }
  const conditional = await boundedExactRequest(
    input.url,
    {
      cache: "no-store",
      headers: { "If-None-Match": etag },
      method: "HEAD",
    },
    0,
    `conditional ${input.label}`,
  );
  requireExactFinalOrigin(
    conditional,
    input.url,
    input.expectedOrigin,
    `conditional ${input.label}`,
  );
  requireStatus(conditional, 304, `conditional ${input.label}`);
  requireServingHeaders(conditional, `conditional ${input.label}`);
  requireMatchingEtag(conditional, etag, `conditional ${input.label}`);
  if (immutable) requireImmutableCacheControl(conditional, `conditional ${input.label}`);
  else requireMutableCacheControl(conditional, `conditional ${input.label}`);
  return Object.freeze({ artifact: input.artifact, response });
}

async function boundedExactRequest(
  url: URL,
  init: RequestInit,
  maximumBytes: number,
  label: string,
): Promise<BoundedResponse> {
  const controller = new AbortController();
  const headerTimer = setTimeout(
    () => controller.abort(new Error(`${label} response headers timed out`)),
    TARGET_HEADER_TIMEOUT_MS,
  );
  headerTimer.unref?.();
  let response: Response;
  try {
    const headers = new Headers(init.headers);
    headers.set("Accept-Encoding", "identity");
    response = await fetch(url, {
      ...init,
      headers,
      redirect: "error",
      signal: controller.signal,
    });
  } catch (error: unknown) {
    throw requestFailure(label, "headers", error);
  } finally {
    clearTimeout(headerTimer);
  }

  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes)
  ) {
    controller.abort();
    throw new Error(`${label} Content-Length exceeds the ${maximumBytes}-byte limit`);
  }
  const bodyTimer = setTimeout(
    () => controller.abort(new Error(`${label} response body timed out`)),
    TARGET_BODY_TIMEOUT_MS,
  );
  bodyTimer.unref?.();
  try {
    const body = await readBoundedBody(response, maximumBytes, label);
    return Object.freeze({
      body,
      headers: response.headers,
      status: response.status,
      url: response.url === "" ? url.href : response.url,
    });
  } catch (error: unknown) {
    throw requestFailure(label, "body", error);
  } finally {
    clearTimeout(bodyTimer);
  }
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
  label: string,
): Promise<Buffer> {
  if (response.body === null) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw new Error(`${label} body exceeds the ${maximumBytes}-byte limit`);
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes);
}

function requestFailure(label: string, phase: "body" | "headers", error: unknown): Error {
  const reason =
    error instanceof Error && error.message !== ""
      ? error.message
      : String(error ?? "unknown error");
  return new Error(`${label} response ${phase} failed: ${reason}`, { cause: error });
}

async function mapWithConcurrency<T, U>(
  values: readonly T[],
  concurrency: number,
  action: (value: T) => Promise<U>,
): Promise<readonly U[]> {
  const results = new Array<U>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= values.length) return;
        const value = values[index];
        if (value === undefined) throw new Error("Target verification work queue drifted");
        results[index] = await action(value);
      }
    }),
  );
  return Object.freeze(results);
}

function requireExactFinalOrigin(
  response: BoundedResponse,
  requested: URL,
  expectedOrigin: string,
  label: string,
): void {
  const final = new URL(response.url);
  if (final.href !== requested.href || final.origin !== expectedOrigin) {
    throw new Error(
      `${label} redirected or changed origin: expected ${requested.href}, received ${final.href}`,
    );
  }
}

function requireStatus(response: BoundedResponse, expected: number, label: string): void {
  if (response.status !== expected) {
    throw new Error(`${label} expected HTTP ${expected}, received ${response.status}`);
  }
}

function requireServingHeaders(response: BoundedResponse, label: string): void {
  if (
    response.headers.get("cross-origin-opener-policy") !== "same-origin" ||
    response.headers.get("cross-origin-embedder-policy") !== "require-corp"
  ) {
    throw new Error(`${label} did not retain the required COOP/COEP headers`);
  }
  if (response.headers.get("x-content-type-options") !== "nosniff") {
    throw new Error(`${label} did not retain X-Content-Type-Options: nosniff`);
  }
}

function requireMutableCacheControl(response: BoundedResponse, label: string): string {
  const value = requireHeader(response, "cache-control", label);
  requireMutableCacheControlValue(value, label);
  return value;
}

function requireMutableCacheControlValue(value: string, label: string): void {
  const directives = parseCacheDirectives(value, label);
  const maxAge = directives.get("max-age");
  if (
    !directives.has("no-cache") ||
    directives.has("no-store") ||
    directives.has("private") ||
    directives.has("immutable") ||
    (maxAge !== undefined && maxAge !== "0")
  ) {
    throw new Error(`${label} must use a non-conflicting Cache-Control: no-cache policy`);
  }
}

function requireImmutableCacheControl(response: BoundedResponse, label: string): string {
  const value = requireHeader(response, "cache-control", label);
  const directives = parseCacheDirectives(value, label);
  if (
    directives.get("public") !== null ||
    directives.get("immutable") !== null ||
    directives.get("max-age") !== "31536000" ||
    directives.has("no-store") ||
    directives.has("private") ||
    directives.has("no-cache")
  ) {
    throw new Error(`${label} must use Cache-Control: public, max-age=31536000, immutable`);
  }
  return value;
}

function parseCacheDirectives(value: string, label: string): ReadonlyMap<string, string | null> {
  const directives = new Map<string, string | null>();
  for (const rawPart of value.split(",")) {
    const part = rawPart.trim();
    const match = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+)(?:=([!#$%&'*+\-.^_`|~0-9A-Za-z]+))?$/.exec(part);
    if (match === null) throw new Error(`${label} has malformed Cache-Control directive ${part}`);
    const name = match[1]?.toLowerCase() ?? "";
    if (directives.has(name)) {
      throw new Error(`${label} has duplicate Cache-Control directive ${name}`);
    }
    directives.set(name, match[2]?.toLowerCase() ?? null);
  }
  return directives;
}

function requireMimeType(response: BoundedResponse, expected: string, label: string): void {
  const actual = mimeBase(requireHeader(response, "content-type", label));
  if (actual !== expected) {
    throw new Error(`${label} expected MIME ${expected}, received ${actual}`);
  }
}

function expectedMimeType(path: string): string {
  switch (extname(path)) {
    case ".html":
      return "text/html";
    case ".js":
      return "application/javascript";
    case ".json":
      return "application/json";
    case ".ktx2":
      return "image/ktx2";
    case ".meshopt":
      return "application/octet-stream";
    case ".wasm":
      return "application/wasm";
    default:
      throw new Error(`No serving-contract MIME is registered for ${path}`);
  }
}

function representationClass(path: string): HarnessRepresentationClass {
  switch (extname(path)) {
    case ".html":
      return "html";
    case ".js":
      return "javascript";
    case ".json":
      return "json";
    case ".ktx2":
      return "ktx2";
    case ".meshopt":
      return "meshopt";
    case ".wasm":
      return "wasm";
    default:
      throw new Error(`No representation class is registered for ${path}`);
  }
}

function isRepresentationClass(value: unknown): value is HarnessRepresentationClass {
  return (
    value === "html" ||
    value === "javascript" ||
    value === "json" ||
    value === "ktx2" ||
    value === "meshopt" ||
    value === "wasm"
  );
}

function expectedRepresentationMimeTypes(
  representation: HarnessRepresentationClass,
): ReadonlySet<string> {
  switch (representation) {
    case "html":
      return new Set(["text/html"]);
    case "javascript":
      return new Set(["application/javascript"]);
    case "json":
      return new Set(["application/json"]);
    case "ktx2":
      return new Set(["image/ktx2"]);
    case "meshopt":
      return new Set(["application/octet-stream"]);
    case "wasm":
      return new Set(["application/wasm"]);
  }
}

function mimeBase(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function requireHeader(response: BoundedResponse, name: string, label: string): string {
  const value = response.headers.get(name);
  if (value === null || value.trim() === "") throw new Error(`${label} omitted ${name}`);
  return value;
}

function requireMatchingEtag(response: BoundedResponse, expected: string, label: string): void {
  const actual = requireHeader(response, "etag", label);
  if (actual !== expected) {
    throw new Error(`${label} ETag changed: expected ${expected}, received ${actual}`);
  }
}

function sha256(bytes: NodeJS.ArrayBufferView): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
