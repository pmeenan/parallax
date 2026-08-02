import { isSanitizedModelSourceFailureText } from "./model-source-failure-sanitization.js";

const HEX_64 = /^[a-f0-9]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const LOCAL_SOURCE_KEY = "production-model-content";
const REMOTE_HOST = "plex";
const REMOTE_WEB_ROOT = "/var/www/parallax-web.com";
const REMOTE_IMMUTABLE = `${REMOTE_WEB_ROOT}/immutable`;
const PINNED_MODELS: ReadonlyMap<
  string,
  { readonly bytes: number; readonly id: string; readonly localName: string }
> = new Map([
  [
    "ff074d7cae3cbda06f7a32b6d42c206bf88c2bee84c9d6165a0937ec2b61958d",
    {
      bytes: 23_532_320,
      id: "common-model-gemma-4-e2b-it-qat-ud-q4_k_xl-split-00001-of-00005.gguf",
      localName: "gemma-4-E2B-it-qat-UD-Q4_K_XL-split-00001-of-00005.gguf",
    },
  ],
  [
    "1c5368744032e95ba212561c1985cd8017de6fd165fef1f648528e0be265d4a8",
    {
      bytes: 1_321_205_952,
      id: "common-model-gemma-4-e2b-it-qat-ud-q4_k_xl-split-00002-of-00005.gguf",
      localName: "gemma-4-E2B-it-qat-UD-Q4_K_XL-split-00002-of-00005.gguf",
    },
  ],
  [
    "f8c3b5b6f05090ef292ed643357fed6b1df5381d0a21e11d3515580af3ef48f3",
    {
      bytes: 508_734_272,
      id: "common-model-gemma-4-e2b-it-qat-ud-q4_k_xl-split-00003-of-00005.gguf",
      localName: "gemma-4-E2B-it-qat-UD-Q4_K_XL-split-00003-of-00005.gguf",
    },
  ],
  [
    "ca3403a90060fc56b92e6b35acb0090eebb8b7eb11c4919536ba645f4d45c461",
    {
      bytes: 510_543_744,
      id: "common-model-gemma-4-e2b-it-qat-ud-q4_k_xl-split-00004-of-00005.gguf",
      localName: "gemma-4-E2B-it-qat-UD-Q4_K_XL-split-00004-of-00005.gguf",
    },
  ],
  [
    "30c5c95b427827e9f1993f7df2e4d6cbdea2354811ab5dcafd6db41190cfb9f9",
    {
      bytes: 256_355_264,
      id: "common-model-gemma-4-e2b-it-qat-ud-q4_k_xl-split-00005-of-00005.gguf",
      localName: "gemma-4-E2B-it-qat-UD-Q4_K_XL-split-00005-of-00005.gguf",
    },
  ],
]);
const BASE_KEYS = [
  "artifactDigest",
  "node",
  "releaseDigest",
  "schemaVersion",
  "source",
  "startedAt",
  "state",
] as const;

interface ModelSourceVerificationBase {
  readonly artifactDigest: string;
  readonly node: {
    readonly executable: string;
    readonly executableSha256: string;
    readonly version: string;
  };
  readonly releaseDigest: string;
  readonly schemaVersion: 2;
  readonly source: { readonly commit: string; readonly dirtyTreeDigest: string | null };
  readonly startedAt: string;
}

export interface ModelSourceVerificationPending extends ModelSourceVerificationBase {
  readonly state: "pending";
}

export interface ModelSourceVerificationFailed extends ModelSourceVerificationBase {
  readonly completedAt: string;
  readonly failure: string;
  readonly state: "failed";
}

export interface ModelSourceVerificationPassed extends ModelSourceVerificationBase {
  readonly completedAt: string;
  readonly remote: ModelSourceVerificationRemoteRoot;
  readonly resources: readonly ModelSourceVerificationResource[];
  readonly state: "passed";
}

export type ModelSourceVerificationResult =
  | ModelSourceVerificationFailed
  | ModelSourceVerificationPassed
  | ModelSourceVerificationPending;

export interface ModelSourceVerificationRemoteRoot {
  readonly gid: number;
  readonly host: "plex";
  readonly immutableMode: "755";
  readonly immutablePath: "/var/www/parallax-web.com/immutable";
  readonly uid: number;
  readonly webRoot: "/var/www/parallax-web.com";
  readonly webRootMode: "755";
}

export interface ModelSourceVerificationRemoteResource {
  readonly bytes: number;
  readonly gid: number;
  readonly mode: "644";
  readonly path: string;
  readonly sha256: string;
  readonly symlink: false;
  readonly type: "regular-file";
  readonly uid: number;
}

export interface ModelSourceVerificationResource {
  readonly bytes: number;
  readonly etag: string;
  readonly id: string;
  readonly local: { readonly bytes: number; readonly sha256: string; readonly source: string };
  readonly remote: ModelSourceVerificationRemoteResource;
  readonly requests: readonly {
    readonly contentLength: number | null;
    readonly contentRange: string | null;
    readonly contentEncoding: string | null;
    readonly downloadedBytes: number;
    readonly etag: string | null;
    readonly headers: {
      readonly acceptRanges: string | null;
      readonly cacheControl: string | null;
      readonly contentType: string | null;
      readonly crossOriginEmbedderPolicy: string | null;
      readonly crossOriginOpenerPolicy: string | null;
      readonly xContentTypeOptions: string | null;
    };
    readonly kind:
      | "head"
      | "if-range-match"
      | "if-range-stale"
      | "range-0-0"
      | "range-unsatisfiable";
    readonly status: number;
    readonly url: string;
  }[];
  readonly sha256: string;
  readonly url: string;
}

export function validateModelSourceVerificationResult(
  value: unknown,
): asserts value is ModelSourceVerificationResult {
  if (!record(value) || typeof value.state !== "string") throw new Error("result is not an object");
  const stateKeys =
    value.state === "pending"
      ? BASE_KEYS
      : value.state === "failed"
        ? [...BASE_KEYS, "completedAt", "failure"]
        : value.state === "passed"
          ? [...BASE_KEYS, "completedAt", "remote", "resources"]
          : [];
  if (stateKeys.length === 0 || !exactKeys(value, stateKeys)) {
    throw new Error("result has invalid state-specific keys");
  }
  validateBase(value);
  if (value.state === "pending") return;
  if (
    typeof value.completedAt !== "string" ||
    !ISO_UTC.test(value.completedAt) ||
    Date.parse(value.completedAt) < Date.parse(value.startedAt as string)
  ) {
    throw new Error("result completion time is invalid");
  }
  if (value.state === "failed") {
    if (!isSanitizedModelSourceFailureText(value.failure)) {
      throw new Error("failed result requires an honest failure message");
    }
    return;
  }
  validatePassed(value);
}

export function formatModelSourceVerificationMarkdown(
  report: ModelSourceVerificationFailed | ModelSourceVerificationPassed,
): string {
  const common = [
    "# Production model-source verification",
    "",
    `- State: \`${report.state}\``,
    `- Started: \`${report.startedAt}\``,
    `- Completed: \`${report.completedAt}\``,
    `- Artifact digest: \`${report.artifactDigest}\``,
    `- Release digest: \`${report.releaseDigest}\``,
    `- Source: \`${report.source.commit}/${report.source.dirtyTreeDigest ?? "clean"}\``,
    `- Node: \`${report.node.version}/${report.node.executableSha256}\``,
  ];
  if (report.state === "failed") {
    return [...common, `- Failure: ${report.failure}`, ""].join("\n");
  }
  return [
    ...common,
    `- Remote SSH root: \`${report.remote.host}:${report.remote.immutablePath}\`, ` +
      `uid/gid ${report.remote.uid}/${report.remote.gid}, modes ` +
      `${report.remote.webRootMode}/${report.remote.immutableMode}`,
    "",
    ...report.resources.flatMap((resource) => [
      `## ${resource.id}`,
      "",
      `- URL: \`${resource.url}\``,
      `- Identity: ${resource.bytes} bytes / \`${resource.sha256}\` / ETag \`${resource.etag}\``,
      `- SSH byte identity: ${resource.remote.bytes} bytes / ` +
        `\`${resource.remote.sha256}\` / uid/gid ` +
        `${resource.remote.uid}/${resource.remote.gid} / mode ${resource.remote.mode}`,
      ...resource.requests.map(
        (request) =>
          `- ${request.kind}: ${request.status}, ${request.downloadedBytes} bytes downloaded, ` +
          `Content-Length ${request.contentLength}, Content-Range ${request.contentRange ?? "none"}`,
      ),
      "",
    ]),
  ].join("\n");
}

function validateBase(value: Record<string, unknown>): void {
  if (
    value.schemaVersion !== 2 ||
    !["pending", "passed", "failed"].includes(String(value.state)) ||
    typeof value.artifactDigest !== "string" ||
    !HEX_64.test(value.artifactDigest) ||
    typeof value.releaseDigest !== "string" ||
    !HEX_64.test(value.releaseDigest) ||
    typeof value.startedAt !== "string" ||
    !ISO_UTC.test(value.startedAt) ||
    !record(value.node) ||
    !exactKeys(value.node, ["executable", "executableSha256", "version"]) ||
    typeof value.node.executable !== "string" ||
    !/^[A-Za-z0-9._-]+$/.test(value.node.executable) ||
    typeof value.node.executableSha256 !== "string" ||
    !HEX_64.test(value.node.executableSha256) ||
    typeof value.node.version !== "string" ||
    !/^v\d+\.\d+\.\d+$/.test(value.node.version) ||
    !record(value.source) ||
    !exactKeys(value.source, ["commit", "dirtyTreeDigest"]) ||
    typeof value.source.commit !== "string" ||
    !/^[a-f0-9]{40}$/.test(value.source.commit) ||
    !(
      value.source.dirtyTreeDigest === null ||
      (typeof value.source.dirtyTreeDigest === "string" &&
        HEX_64.test(value.source.dirtyTreeDigest))
    )
  ) {
    throw new Error("result identity or base envelope is invalid");
  }
}

function validatePassed(value: Record<string, unknown>): void {
  if (!record(value.remote) || !Array.isArray(value.resources) || value.resources.length !== 5) {
    throw new Error("passed result evidence is invalid");
  }
  const remote = validateRemoteRoot(value.remote);
  const ids = new Set<string>();
  const hashes = new Set<string>();
  for (const candidate of value.resources) validateResource(candidate, remote, ids, hashes);
  const expectedHashes = [...PINNED_MODELS.keys()];
  const actualHashes = value.resources.map((resource) =>
    record(resource) && typeof resource.sha256 === "string" ? resource.sha256 : "",
  );
  if (
    expectedHashes.some((hash) => !hashes.has(hash)) ||
    actualHashes.some((hash, index) => hash !== expectedHashes[index])
  ) {
    throw new Error("result does not contain the exact pinned model set");
  }
}

function validateRemoteRoot(value: Record<string, unknown>): ModelSourceVerificationRemoteRoot {
  if (
    !exactKeys(value, [
      "gid",
      "host",
      "immutableMode",
      "immutablePath",
      "uid",
      "webRoot",
      "webRootMode",
    ]) ||
    value.host !== REMOTE_HOST ||
    value.webRoot !== REMOTE_WEB_ROOT ||
    value.immutablePath !== REMOTE_IMMUTABLE ||
    value.webRootMode !== "755" ||
    value.immutableMode !== "755" ||
    !safeIdentity(value.uid) ||
    !safeIdentity(value.gid)
  ) {
    throw new Error("remote SSH root identity is invalid");
  }
  return value as unknown as ModelSourceVerificationRemoteRoot;
}

function validateResource(
  value: unknown,
  root: ModelSourceVerificationRemoteRoot,
  ids: Set<string>,
  hashes: Set<string>,
): void {
  const pinned =
    record(value) && typeof value.sha256 === "string" ? PINNED_MODELS.get(value.sha256) : undefined;
  if (pinned === undefined) throw new Error("result resource is not a pinned model");
  if (
    !record(value) ||
    !exactKeys(value, ["bytes", "etag", "id", "local", "remote", "requests", "sha256", "url"]) ||
    !Number.isSafeInteger(value.bytes) ||
    pinned.bytes !== value.bytes ||
    typeof value.id !== "string" ||
    ids.has(value.id) ||
    pinned.id !== value.id ||
    typeof value.sha256 !== "string" ||
    hashes.has(value.sha256) ||
    typeof value.url !== "string" ||
    value.url !== `https://parallax-web.com/immutable/model-${value.sha256}.gguf` ||
    typeof value.etag !== "string" ||
    !strongEtag(value.etag) ||
    !record(value.local) ||
    !exactKeys(value.local, ["bytes", "sha256", "source"]) ||
    value.local.bytes !== value.bytes ||
    value.local.sha256 !== value.sha256 ||
    value.local.source !== `${LOCAL_SOURCE_KEY}/${pinned.localName}` ||
    !record(value.remote) ||
    !validRemoteResource(value.remote, root, value.sha256, value.bytes) ||
    !Array.isArray(value.requests) ||
    value.requests.length !== 5
  ) {
    throw new Error("result resource identity is invalid");
  }
  ids.add(value.id);
  hashes.add(value.sha256);
  validateRequests(value as unknown as ModelSourceVerificationResource);
}

function validRemoteResource(
  value: Record<string, unknown>,
  root: ModelSourceVerificationRemoteRoot,
  sha256: string,
  bytes: unknown,
): boolean {
  return (
    exactKeys(value, ["bytes", "gid", "mode", "path", "sha256", "symlink", "type", "uid"]) &&
    value.bytes === bytes &&
    value.sha256 === sha256 &&
    value.path === `${REMOTE_IMMUTABLE}/model-${sha256}.gguf` &&
    value.type === "regular-file" &&
    value.symlink === false &&
    value.uid === root.uid &&
    value.gid === root.gid &&
    value.mode === "644"
  );
}

function validateRequests(resource: ModelSourceVerificationResource): void {
  const kinds = new Set<string>();
  for (const request of resource.requests) {
    if (
      !record(request) ||
      !exactKeys(request, [
        "contentLength",
        "contentRange",
        "contentEncoding",
        "downloadedBytes",
        "etag",
        "headers",
        "kind",
        "status",
        "url",
      ]) ||
      typeof request.kind !== "string" ||
      kinds.has(request.kind) ||
      request.url !== resource.url ||
      !(
        request.contentLength === null ||
        (Number.isSafeInteger(request.contentLength) && request.contentLength >= 0)
      ) ||
      !Number.isSafeInteger(request.downloadedBytes) ||
      request.downloadedBytes < 0 ||
      !(request.contentRange === null || typeof request.contentRange === "string") ||
      !(request.contentEncoding === null || typeof request.contentEncoding === "string") ||
      !(request.etag === null || typeof request.etag === "string") ||
      !record(request.headers) ||
      !exactKeys(request.headers, [
        "acceptRanges",
        "cacheControl",
        "contentType",
        "crossOriginEmbedderPolicy",
        "crossOriginOpenerPolicy",
        "xContentTypeOptions",
      ]) ||
      !nullableString(request.headers.acceptRanges) ||
      !nullableString(request.headers.cacheControl) ||
      !nullableString(request.headers.contentType) ||
      !nullableString(request.headers.crossOriginEmbedderPolicy) ||
      !nullableString(request.headers.crossOriginOpenerPolicy) ||
      !nullableString(request.headers.xContentTypeOptions)
    ) {
      throw new Error("result request evidence is invalid");
    }
    kinds.add(request.kind);
  }
  const expectedKinds = [
    "head",
    "if-range-match",
    "if-range-stale",
    "range-0-0",
    "range-unsatisfiable",
  ];
  if (resource.requests.some((request, index) => request.kind !== expectedKinds[index])) {
    throw new Error("result request set is invalid");
  }
  requireFullResponse(resource, "head", "immutable");
  requirePartialResponse(resource, "range-0-0");
  requirePartialResponse(resource, "if-range-match");
  requireFullResponse(resource, "if-range-stale", "no-cache");
  const unsatisfiable = resource.requests.find((request) => request.kind === "range-unsatisfiable");
  if (
    unsatisfiable?.status !== 416 ||
    unsatisfiable.contentRange !== `bytes */${resource.bytes}` ||
    unsatisfiable.downloadedBytes > 65_536 ||
    !hasCachePolicy(unsatisfiable.headers.cacheControl, "no-cache")
  ) {
    throw new Error("unsatisfiable-range evidence is invalid");
  }
}

function requireFullResponse(
  resource: ModelSourceVerificationResource,
  kind: "head" | "if-range-stale",
  cachePolicy: "immutable" | "no-cache",
): void {
  const request = resource.requests.find((candidate) => candidate.kind === kind);
  if (
    request?.status !== 200 ||
    request.contentLength !== resource.bytes ||
    request.contentRange !== null ||
    request.downloadedBytes !== 0 ||
    request.contentEncoding !== null ||
    request.etag !== resource.etag ||
    request.headers.acceptRanges !== "bytes" ||
    request.headers.contentType !== "application/octet-stream" ||
    request.headers.crossOriginEmbedderPolicy !== "require-corp" ||
    request.headers.crossOriginOpenerPolicy !== "same-origin" ||
    request.headers.xContentTypeOptions !== "nosniff" ||
    !hasCachePolicy(request.headers.cacheControl, cachePolicy)
  ) {
    throw new Error(`${kind} evidence is invalid`);
  }
}

function requirePartialResponse(
  resource: ModelSourceVerificationResource,
  kind: "if-range-match" | "range-0-0",
): void {
  const request = resource.requests.find((candidate) => candidate.kind === kind);
  if (
    request?.status !== 206 ||
    request.contentLength !== 1 ||
    request.contentRange !== `bytes 0-0/${resource.bytes}` ||
    request.downloadedBytes !== 1 ||
    request.contentEncoding !== null ||
    request.etag !== resource.etag ||
    !(request.headers.acceptRanges === null || request.headers.acceptRanges === "bytes") ||
    request.headers.contentType !== "application/octet-stream" ||
    request.headers.crossOriginEmbedderPolicy !== "require-corp" ||
    request.headers.crossOriginOpenerPolicy !== "same-origin" ||
    request.headers.xContentTypeOptions !== "nosniff" ||
    !hasCachePolicy(request.headers.cacheControl, "no-cache")
  ) {
    throw new Error(`${kind} evidence is invalid`);
  }
}

function hasCachePolicy(value: string | null, policy: "immutable" | "no-cache"): boolean {
  if (value === null) return false;
  const required =
    policy === "no-cache"
      ? (["no-cache"] as const)
      : (["public", "max-age=31536000", "immutable"] as const);
  const allowed = new Set<string>(required);
  const observed = new Set<string>();
  for (const rawDirective of value.split(",")) {
    const directive = rawDirective.trim().toLowerCase();
    if (directive === "" || !allowed.has(directive)) return false;
    observed.add(directive);
  }
  return observed.size === required.length;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function safeIdentity(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function strongEtag(value: string): boolean {
  return /^"[\x21\x23-\x7e]+"$/.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
