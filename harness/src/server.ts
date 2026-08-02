import { createHash } from "node:crypto";
import { type BigIntStats, createReadStream } from "node:fs";
import { type FileHandle, open, readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".json": "application/json; charset=utf-8",
  ".ktx2": "image/ktx2",
  ".map": "application/json; charset=utf-8",
  ".meshopt": "application/octet-stream",
  ".wasm": "application/wasm",
});

const IMMUTABLE_PATH = /^\/immutable\/[a-z0-9-]+-([a-f0-9]{64})\.[a-z0-9]+$/;
const IDENTITY_PATH = "/__parallax/identity";
export const LOCAL_SERVER_IDENTITY_PROBE_MARKER = "parallax-harness-inert-v1" as const;
const METRICS_PATH = "/__parallax/metrics";
export const UNINSTALL_PATH = "/uninstall" as const;
const UNINSTALL_SENTINEL_PREFIX = /^(?:client-side|clear-site-data)-[A-Za-z0-9_-]{24}$/u;
const UNINSTALL_SENTINEL_WORKER_PATH =
  /^\/__parallax-uninstall-sentinel-((?:client-side|clear-site-data)-[A-Za-z0-9_-]{24})\/service-worker\.js$/u;
export const UNINSTALL_FETCH_METADATA = Object.freeze({
  dest: "document",
  mode: "navigate",
  site: "same-origin",
  user: "?1",
});
const IDENTITY_DOCUMENT = Buffer.from(
  `<!doctype html><meta charset=utf-8><meta name=parallax-harness-probe content=${LOCAL_SERVER_IDENTITY_PROBE_MARKER}><title>Parallax harness identity probe</title>`,
);
const UNINSTALL_DOCUMENT = Buffer.from(
  "<!doctype html><meta charset=utf-8><title>Parallax uninstalled</title><h1>Parallax site-data removal requested</h1><p>Chrome was asked to clear this origin's storage and cache. Close this tab before reinstalling.</p>",
);
const UNINSTALL_SENTINEL_WORKER = Buffer.from(
  'self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));\n',
);
const MAX_EXACT_RANGE_TRANSFORM_BYTES = 8 * 1024 * 1024;

export type ExactRangeFilePhase = "after-hash" | "closed" | "opened" | "validated" | "before-serve";

export function uninstallSentinelWorkerPath(prefix: string): string {
  if (!UNINSTALL_SENTINEL_PREFIX.test(prefix)) {
    throw new Error("Uninstall sentinel prefix is invalid");
  }
  return `/__parallax-uninstall-sentinel-${prefix}/service-worker.js`;
}

export type PathClass = "document" | "immutable" | "other";

interface CachedMetadata {
  readonly digestHex: string;
  readonly etag: string;
  readonly signature: string;
}

interface MutableMetrics {
  bytesServed: number;
  bytesServedByPathClass: Record<PathClass, number>;
  metadataCacheHits: number;
  metadataCacheMisses: number;
  pathClasses: Record<PathClass, number>;
  requests: number;
  statuses: Record<string, number>;
  statusesByPathClass: Record<PathClass, Record<string, number>>;
}

// schemaVersion 2 added the correlated per-path-class counters (statusesByPathClass,
// bytesServedByPathClass) so serving-discipline evidence can prove *which* class
// produced a status or the served bytes, not just that the aggregates coincided.
export interface LocalServerMetrics {
  readonly bytesServed: number;
  readonly bytesServedByPathClass: Readonly<Record<PathClass, number>>;
  readonly metadataCacheHits: number;
  readonly metadataCacheMisses: number;
  readonly pathClasses: Readonly<Record<PathClass, number>>;
  readonly requests: number;
  readonly schemaVersion: 2;
  readonly statuses: Readonly<Record<string, number>>;
  readonly statusesByPathClass: Readonly<Record<PathClass, Readonly<Record<string, number>>>>;
}

export interface LocalServerOptions {
  readonly documentOverride?: (
    pathname: "/build-manifest.json" | "/install-manifest.json",
  ) => Buffer | null;
  readonly exactRangeBodyTransform?: Readonly<{
    readonly path: string;
    readonly transform: (
      input: Readonly<{
        readonly body: Uint8Array;
        readonly end: number;
        readonly etag: string;
        readonly ifRange: string | null;
        readonly path: string;
        readonly range: string;
        readonly start: number;
      }>,
    ) => Uint8Array;
  }>;
  readonly exactRangeResources?: readonly Readonly<{
    readonly bytes: number;
    readonly sha256: string;
    readonly source: string;
  }>[];
  readonly onExactRangeFilePhase?: (
    event: Readonly<{ readonly path: string; readonly phase: ExactRangeFilePhase }>,
  ) => Promise<void> | void;
  readonly externalModel?: Readonly<{
    readonly artifacts: readonly Readonly<{
      readonly bytes: number;
      readonly path: string;
      readonly sha256: string;
    }>[];
    readonly root: string;
  }>;
  readonly onResponse?: (entry: LocalServerJournalEntry) => void;
  readonly onDetailedResponse?: (entry: LocalServerDetailedJournalEntry) => void;
  readonly root: string;
}

export interface LocalServerJournalEntry {
  readonly cacheControl: string | null;
  readonly clearSiteData?: string | null;
  readonly completion?: "client-closed" | "completed";
  readonly contentType: string | null;
  readonly coop: string | null;
  readonly coep: string | null;
  readonly ifRange: string | null;
  readonly intendedStatus?: number;
  readonly method: string;
  readonly nosniff: string | null;
  readonly path: string;
  readonly range: string | null;
  readonly headersSent?: boolean;
  readonly status: number;
}

export interface LocalServerDetailedJournalEntry extends LocalServerJournalEntry {
  readonly bodyBytes: number;
  readonly contentRange: string | null;
  readonly etag: string | null;
  readonly ifNoneMatch: string | null;
}

export const LOCAL_SERVER_JOURNAL_EVIDENCE_KEYS = Object.freeze([
  "cacheControl",
  "contentType",
  "coop",
  "coep",
  "ifRange",
  "method",
  "nosniff",
  "path",
  "range",
  "status",
] as const);

export const LOCAL_SERVER_DETAILED_JOURNAL_EVIDENCE_KEYS = Object.freeze([
  "bodyBytes",
  ...LOCAL_SERVER_JOURNAL_EVIDENCE_KEYS,
  "contentRange",
  "etag",
  "ifNoneMatch",
] as const);

export type LocalServerJournalEvidenceEntry = Readonly<
  Pick<LocalServerJournalEntry, (typeof LOCAL_SERVER_JOURNAL_EVIDENCE_KEYS)[number]>
>;

export type LocalServerDetailedJournalEvidenceEntry = Readonly<
  Pick<
    LocalServerDetailedJournalEntry,
    (typeof LOCAL_SERVER_DETAILED_JOURNAL_EVIDENCE_KEYS)[number]
  >
>;

interface LocalServerCallbackFailureState {
  count: number;
  readonly failures: { readonly callback: "onDetailedResponse" | "onResponse"; error: unknown }[];
}

const localServerCallbackFailures = new WeakMap<Server, LocalServerCallbackFailureState>();
const MAX_RETAINED_CALLBACK_FAILURES = 16;

export class LocalServerCallbackError extends AggregateError {
  public readonly failureCount: number;

  public constructor(state: Readonly<LocalServerCallbackFailureState>) {
    super(
      state.failures.map((failure) => failure.error),
      `Local server response callback collection failed ${state.count} time(s): ${state.failures
        .map((failure) => failure.callback)
        .join(", ")}`,
    );
    this.name = "LocalServerCallbackError";
    this.failureCount = state.count;
  }
}

export class LocalServerJournalCollectionError extends Error {
  public readonly failureCount: number;

  public constructor(label: string, failureCount: number, cause: unknown) {
    super(`${label} failed ${failureCount} time(s)`, { cause });
    this.name = "LocalServerJournalCollectionError";
    this.failureCount = failureCount;
  }
}

export function projectLocalServerJournalEntry(
  entry: LocalServerJournalEntry,
): LocalServerJournalEvidenceEntry {
  return Object.freeze({
    cacheControl: entry.cacheControl,
    contentType: entry.contentType,
    coop: entry.coop,
    coep: entry.coep,
    ifRange: entry.ifRange,
    method: entry.method,
    nosniff: entry.nosniff,
    path: entry.path,
    range: entry.range,
    status: entry.status,
  });
}

export function projectLocalServerDetailedJournalEntry(
  entry: LocalServerDetailedJournalEntry,
): LocalServerDetailedJournalEvidenceEntry {
  return Object.freeze({
    bodyBytes: entry.bodyBytes,
    ...projectLocalServerJournalEntry(entry),
    contentRange: entry.contentRange,
    etag: entry.etag,
    ifNoneMatch: entry.ifNoneMatch,
  });
}

export function createLocalServerJournalCollector<T>(
  label: string,
  collect: (entry: T) => void,
): Readonly<{ assertComplete(): void; record(entry: T): void }> {
  let failureCount = 0;
  let firstFailure: unknown = null;
  return Object.freeze({
    assertComplete(): void {
      if (failureCount !== 0) {
        throw new LocalServerJournalCollectionError(label, failureCount, firstFailure);
      }
    },
    record(entry: T): void {
      try {
        collect(entry);
      } catch (error: unknown) {
        failureCount += 1;
        firstFailure ??= error;
      }
    },
  });
}

export function assertLocalServerCallbacks(server: Server): void {
  const state = localServerCallbackFailures.get(server);
  if (state !== undefined && state.count !== 0) throw new LocalServerCallbackError(state);
}

export function createLocalServer(options: LocalServerOptions): Server {
  const root = resolve(options.root);
  const exactRangeResources = validateExactRangeResources(options.exactRangeResources ?? []);
  const externalModelRoot =
    options.externalModel === undefined ? null : resolve(options.externalModel.root);
  const externalModelArtifacts = new Map(
    (options.externalModel?.artifacts ?? []).map((artifact) => [artifact.path, artifact]),
  );
  const metadataCache = new Map<string, CachedMetadata>();
  const metrics: MutableMetrics = {
    bytesServed: 0,
    bytesServedByPathClass: { document: 0, immutable: 0, other: 0 },
    metadataCacheHits: 0,
    metadataCacheMisses: 0,
    pathClasses: { document: 0, immutable: 0, other: 0 },
    requests: 0,
    statuses: {},
    statusesByPathClass: { document: {}, immutable: {}, other: {} },
  };
  const callbackFailures: LocalServerCallbackFailureState = { count: 0, failures: [] };

  const server = createServer(async (request, response) => {
    response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("X-Content-Type-Options", "nosniff");

    let pathClass: PathClass = "other";
    let journalPath = "<unparsed>";
    let requestMetadataCacheHits = 0;
    let requestMetadataCacheMisses = 0;
    const recordResponse = (
      status: number,
      bodyBytes: number,
      interruptedBodyBytes: (() => number) | null = null,
    ): void => {
      let recorded = false;
      const record = (
        completedStatus: number,
        completedBodyBytes: number,
        completion: NonNullable<LocalServerJournalEntry["completion"]>,
      ): void => {
        if (recorded) return;
        recorded = true;
        const statusKey = String(completedStatus);
        const classStatuses = metrics.statusesByPathClass[pathClass];
        metrics.requests += 1;
        metrics.statuses[statusKey] = (metrics.statuses[statusKey] ?? 0) + 1;
        metrics.pathClasses[pathClass] += 1;
        classStatuses[statusKey] = (classStatuses[statusKey] ?? 0) + 1;
        metrics.metadataCacheHits += requestMetadataCacheHits;
        metrics.metadataCacheMisses += requestMetadataCacheMisses;
        metrics.bytesServed += completedBodyBytes;
        metrics.bytesServedByPathClass[pathClass] += completedBodyBytes;
        const entry = Object.freeze({
          cacheControl: headerValue(response.getHeader("cache-control")),
          clearSiteData: headerValue(response.getHeader("clear-site-data")),
          completion,
          contentType: headerValue(response.getHeader("content-type")),
          coop: headerValue(response.getHeader("cross-origin-opener-policy")),
          coep: headerValue(response.getHeader("cross-origin-embedder-policy")),
          ifRange: singleHeader(request.headers["if-range"]) ?? null,
          intendedStatus: status,
          method: request.method ?? "<missing>",
          nosniff: headerValue(response.getHeader("x-content-type-options")),
          path: journalPath,
          range: singleHeader(request.headers.range) ?? null,
          headersSent: response.headersSent,
          status: completedStatus,
        });
        invokeResponseCallback(callbackFailures, "onResponse", options.onResponse, entry);
        invokeResponseCallback(
          callbackFailures,
          "onDetailedResponse",
          options.onDetailedResponse,
          Object.freeze({
            ...entry,
            bodyBytes: completedBodyBytes,
            contentRange: headerValue(response.getHeader("content-range")),
            etag: headerValue(response.getHeader("etag")),
            ifNoneMatch: singleHeader(request.headers["if-none-match"]) ?? null,
          }),
        );
      };
      response.once("finish", () => record(status, bodyBytes, "completed"));
      // Node does not emit `finish` when the peer aborts or a source stream fails.
      // Retain the request as an explicit client-closed result instead of silently
      // dropping it from the harness evidence. Partial bytes are conservatively 0.
      response.once("close", () => {
        if (!response.writableFinished) record(499, interruptedBodyBytes?.() ?? 0, "client-closed");
      });
    };
    const send = (status: number, body?: Buffer): void => {
      const responseBody = request.method === "HEAD" ? undefined : body;
      recordResponse(status, responseBody?.byteLength ?? 0);
      response.writeHead(status).end(responseBody);
    };

    try {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      const pathname = decodeURIComponent(requestUrl.pathname);
      journalPath = pathname;

      if (pathname === IDENTITY_PATH) {
        // Identity probing is harness control traffic, not application workload.
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.setHeader("Allow", "GET, HEAD");
          response.writeHead(405).end();
          return;
        }
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Content-Length", IDENTITY_DOCUMENT.byteLength);
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.writeHead(200).end(request.method === "HEAD" ? undefined : IDENTITY_DOCUMENT);
        return;
      }

      if (pathname === METRICS_PATH) {
        // Metrics reads are out-of-band: all methods are excluded from counters, and
        // ordinary requests publish their complete counter delta atomically on finish.
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.setHeader("Allow", "GET, HEAD");
          response.writeHead(405).end();
          return;
        }
        const body = Buffer.from(`${JSON.stringify(snapshotMetrics(metrics), null, 2)}\n`);
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Content-Length", body.byteLength);
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.writeHead(200).end(request.method === "HEAD" ? undefined : body);
        return;
      }

      if (pathname === UNINSTALL_PATH) {
        pathClass = "document";
        if (request.method !== "POST") {
          response.setHeader("Allow", "POST");
          send(405);
          return;
        }
        if (
          requestUrl.search !== "" ||
          singleHeader(request.headers["sec-fetch-site"]) !== UNINSTALL_FETCH_METADATA.site ||
          singleHeader(request.headers["sec-fetch-mode"]) !== UNINSTALL_FETCH_METADATA.mode ||
          singleHeader(request.headers["sec-fetch-user"]) !== UNINSTALL_FETCH_METADATA.user ||
          singleHeader(request.headers["sec-fetch-dest"]) !== UNINSTALL_FETCH_METADATA.dest
        ) {
          send(403);
          return;
        }
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Clear-Site-Data", '"storage", "cache"');
        response.setHeader("Content-Length", UNINSTALL_DOCUMENT.byteLength);
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        send(200, UNINSTALL_DOCUMENT);
        return;
      }

      if (UNINSTALL_SENTINEL_WORKER_PATH.test(pathname)) {
        if (requestUrl.search !== "" || (request.method !== "GET" && request.method !== "HEAD")) {
          response.setHeader("Allow", "GET, HEAD");
          send(405);
          return;
        }
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Length", UNINSTALL_SENTINEL_WORKER.byteLength);
        response.setHeader("Content-Type", "application/javascript");
        send(200, request.method === "HEAD" ? undefined : UNINSTALL_SENTINEL_WORKER);
        return;
      }

      pathClass = classifyPath(pathname);
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        send(405);
        return;
      }

      if (pathname === "/build-manifest.json" || pathname === "/install-manifest.json") {
        const override = options.documentOverride?.(pathname) ?? null;
        if (override !== null) {
          const metadata = createMetadata(
            `override:${createHash("sha256").update(override).digest("hex")}`,
            override,
          );
          response.setHeader("Cache-Control", "no-cache");
          response.setHeader("Content-Length", override.byteLength);
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("ETag", metadata.etag);
          send(200, override);
          return;
        }
      }

      const externalModelPrefix = "/__parallax/models/";
      if (pathname.startsWith(externalModelPrefix)) {
        const relativePath = pathname.slice(externalModelPrefix.length);
        const artifact = externalModelArtifacts.get(relativePath);
        if (externalModelRoot === null || artifact === undefined) {
          send(404);
          return;
        }
        const filePath = resolve(externalModelRoot, relativePath);
        if (filePath !== externalModelRoot && !filePath.startsWith(`${externalModelRoot}${sep}`)) {
          send(403);
          return;
        }
        const fileStat = await stat(filePath);
        if (!fileStat.isFile() || fileStat.size !== artifact.bytes) {
          send(409);
          return;
        }
        const etag = `"sha256-${artifact.sha256}"`;
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Content-Length", artifact.bytes);
        response.setHeader("Content-Type", "application/octet-stream");
        response.setHeader("ETag", etag);
        if (matchesIfNoneMatch(request.headers["if-none-match"], etag)) {
          send(304);
          return;
        }
        if (request.method === "HEAD") {
          send(200);
          return;
        }
        let streamedBytes = 0;
        recordResponse(200, artifact.bytes, () => streamedBytes);
        response.writeHead(200);
        try {
          await pipeline(
            createReadStream(filePath),
            byteCounter((bytes) => {
              streamedBytes += bytes;
            }),
            response,
          );
        } catch (error: unknown) {
          if (!response.destroyed) {
            response.destroy(error instanceof Error ? error : new Error(String(error)));
          }
        }
        return;
      }

      const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
      const filePath = resolve(root, relativePath);

      if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
        send(403);
        return;
      }

      const exactRangeResource = exactRangeResources.get(pathname);
      if (exactRangeResource !== undefined) {
        requestMetadataCacheMisses += 1;
        await serveExactRangeResource({
          exactRangeBodyTransform: options.exactRangeBodyTransform,
          expected: exactRangeResource,
          filePath,
          onPhase: options.onExactRangeFilePhase,
          pathname,
          recordResponse,
          request,
          response,
          send,
        });
        return;
      }

      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        send(404);
        return;
      }

      const signature = `${fileStat.dev}:${fileStat.ino}:${fileStat.size}:${fileStat.mtimeMs}:${fileStat.ctimeMs}`;
      const cached = metadataCache.get(filePath);
      let body: Buffer | undefined;
      let metadata: CachedMetadata;
      if (cached?.signature === signature) {
        requestMetadataCacheHits += 1;
        metadata = cached;
      } else {
        requestMetadataCacheMisses += 1;
        body = await readFile(filePath);
        metadata = createMetadata(signature, body);
        metadataCache.set(filePath, metadata);
      }

      const rangeHeader = singleHeader(request.headers.range);
      response.setHeader(
        "Cache-Control",
        rangeHeader === undefined && isContentAddressed(pathname, metadata.digestHex)
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      );
      response.setHeader(
        "Content-Type",
        CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
      );
      response.setHeader("ETag", metadata.etag);
      response.setHeader("Accept-Ranges", "bytes");

      if (matchesIfNoneMatch(request.headers["if-none-match"], metadata.etag)) {
        send(304);
        return;
      }

      const range = parseExactRange(
        rangeHeader,
        singleHeader(request.headers["if-range"]),
        metadata.etag,
        fileStat.size,
      );
      if (range.kind === "unsatisfiable") {
        response.setHeader("Content-Length", "0");
        response.setHeader("Content-Range", `bytes */${fileStat.size}`);
        send(416);
        return;
      }
      if (range.kind === "partial") {
        const bodyBytes = range.end - range.start + 1;
        response.setHeader("Content-Length", bodyBytes);
        response.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${fileStat.size}`);
        await streamFileResponse(
          request.method,
          response,
          filePath,
          206,
          bodyBytes,
          recordResponse,
          range.start,
          range.end,
        );
        return;
      }

      if (request.method === "HEAD") {
        response.setHeader("Content-Length", fileStat.size);
        send(200);
        return;
      }

      body ??= await readFile(filePath);
      response.setHeader("Content-Length", body.byteLength);
      send(200, body);
    } catch (error: unknown) {
      if (error instanceof URIError) {
        send(400);
        return;
      }
      if (isFileNotFound(error)) {
        send(404);
        return;
      }
      if (response.headersSent) {
        if (!response.destroyed) response.destroy();
        return;
      }
      for (const header of [
        "accept-ranges",
        "cache-control",
        "content-length",
        "content-range",
        "content-type",
        "etag",
      ]) {
        response.removeHeader(header);
      }
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Length", "0");
      send(500);
    }
  });
  localServerCallbackFailures.set(server, callbackFailures);
  return server;
}

async function serveExactRangeResource(
  input: Readonly<{
    exactRangeBodyTransform: LocalServerOptions["exactRangeBodyTransform"];
    expected: Readonly<{ readonly bytes: number; readonly sha256: string }>;
    filePath: string;
    onPhase: LocalServerOptions["onExactRangeFilePhase"];
    pathname: string;
    recordResponse: (
      status: number,
      bodyBytes: number,
      interruptedBodyBytes?: (() => number) | null,
    ) => void;
    request: IncomingMessage;
    response: ServerResponse;
    send: (status: number, body?: Buffer) => void;
  }>,
): Promise<void> {
  await withOwnedExactRangeFile(input.filePath, input.pathname, input.onPhase, async (handle) => {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size !== BigInt(input.expected.bytes)) {
      input.send(409);
      return;
    }
    const observedDigest = await sha256FileHandle(handle, input.expected.bytes);
    await input.onPhase?.({ path: input.pathname, phase: "after-hash" });
    const afterHash = await handle.stat({ bigint: true });
    if (!sameExactRangeFileStat(before, afterHash) || observedDigest !== input.expected.sha256) {
      input.send(409);
      return;
    }

    const etag = `"sha256-${input.expected.sha256}"`;
    const rangeHeader = singleHeader(input.request.headers.range);
    const range = parseExactRange(
      rangeHeader,
      singleHeader(input.request.headers["if-range"]),
      etag,
      input.expected.bytes,
    );

    await input.onPhase?.({ path: input.pathname, phase: "validated" });
    await input.onPhase?.({ path: input.pathname, phase: "before-serve" });
    const beforeConditional = await handle.stat({ bigint: true });
    if (!sameExactRangeFileStat(afterHash, beforeConditional)) {
      input.send(409);
      return;
    }
    if (matchesIfNoneMatch(input.request.headers["if-none-match"], etag)) {
      setExactRangeResponseHeaders(input, rangeHeader, etag);
      input.send(304);
      return;
    }

    let transformedBody: Buffer | null = null;
    if (
      range.kind === "partial" &&
      input.exactRangeBodyTransform?.path === input.pathname &&
      input.request.method === "GET"
    ) {
      const bodyBytes = range.end - range.start + 1;
      if (bodyBytes > MAX_EXACT_RANGE_TRANSFORM_BYTES) {
        throw new Error("Exact Range body transform exceeded its bounded input limit");
      }
      const body = await readFileHandleRange(handle, range.start, bodyBytes);
      const transformed = input.exactRangeBodyTransform.transform({
        body,
        end: range.end,
        etag,
        ifRange: singleHeader(input.request.headers["if-range"]) ?? null,
        path: input.pathname,
        range: rangeHeader ?? "",
        start: range.start,
      });
      if (transformed.byteLength !== bodyBytes) {
        throw new Error("Exact Range body transform changed response length");
      }
      transformedBody = Buffer.from(transformed);
    }

    const beforeResponse = await handle.stat({ bigint: true });
    if (!sameExactRangeFileStat(beforeConditional, beforeResponse)) {
      input.send(409);
      return;
    }
    setExactRangeResponseHeaders(input, rangeHeader, etag);
    if (range.kind === "unsatisfiable") {
      input.response.setHeader("Content-Length", "0");
      input.response.setHeader("Content-Range", `bytes */${input.expected.bytes}`);
      input.send(416);
      return;
    }
    if (range.kind === "partial") {
      const bodyBytes = range.end - range.start + 1;
      input.response.setHeader("Content-Length", bodyBytes);
      input.response.setHeader(
        "Content-Range",
        `bytes ${range.start}-${range.end}/${input.expected.bytes}`,
      );
      if (transformedBody !== null) {
        input.send(206, transformedBody);
        return;
      }
      await streamFileHandleResponse(
        input.request.method,
        input.response,
        handle,
        206,
        bodyBytes,
        input.recordResponse,
        range.start,
        range.end,
      );
      return;
    }
    input.response.setHeader("Content-Length", input.expected.bytes);
    if (input.request.method === "HEAD") {
      input.send(200);
      return;
    }
    await streamFileHandleResponse(
      input.request.method,
      input.response,
      handle,
      200,
      input.expected.bytes,
      input.recordResponse,
    );
  });
}

function setExactRangeResponseHeaders(
  input: Readonly<{
    expected: Readonly<{ readonly sha256: string }>;
    filePath: string;
    pathname: string;
    response: ServerResponse;
  }>,
  rangeHeader: string | undefined,
  etag: string,
): void {
  input.response.setHeader(
    "Cache-Control",
    rangeHeader === undefined && isContentAddressed(input.pathname, input.expected.sha256)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  );
  input.response.setHeader(
    "Content-Type",
    CONTENT_TYPES[extname(input.filePath)] ?? "application/octet-stream",
  );
  input.response.setHeader("ETag", etag);
  input.response.setHeader("Accept-Ranges", "bytes");
}

async function withOwnedExactRangeFile<T>(
  filePath: string,
  pathname: string,
  onPhase: LocalServerOptions["onExactRangeFilePhase"],
  operation: (handle: FileHandle) => Promise<T>,
): Promise<T> {
  const handle = await open(filePath, "r");
  let outcome:
    | { readonly ok: true; readonly value: T }
    | { readonly error: unknown; readonly ok: false };
  try {
    await onPhase?.({ path: pathname, phase: "opened" });
    outcome = { ok: true, value: await operation(handle) };
  } catch (error: unknown) {
    outcome = { error, ok: false };
  }

  const closeErrors: unknown[] = [];
  await handle.close().catch((error: unknown) => closeErrors.push(error));
  try {
    await onPhase?.({ path: pathname, phase: "closed" });
  } catch (error: unknown) {
    closeErrors.push(error);
  }
  if (closeErrors.length !== 0) {
    throw new AggregateError(
      outcome.ok ? closeErrors : [outcome.error, ...closeErrors],
      "Exact Range file operation/close failed",
    );
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

async function sha256FileHandle(handle: FileHandle, expectedBytes: number): Promise<string> {
  const digest = createHash("sha256");
  const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, expectedBytes));
  let position = 0;
  while (position < expectedBytes) {
    const length = Math.min(buffer.byteLength, expectedBytes - position);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    if (bytesRead === 0) throw new Error("Exact Range file ended during digest validation");
    digest.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return digest.digest("hex");
}

async function readFileHandleRange(
  handle: FileHandle,
  start: number,
  bytes: number,
): Promise<Uint8Array> {
  const body = Buffer.allocUnsafe(bytes);
  let offset = 0;
  while (offset < bytes) {
    const { bytesRead } = await handle.read(body, offset, bytes - offset, start + offset);
    if (bytesRead === 0) throw new Error("Exact Range file ended during bounded transform read");
    offset += bytesRead;
  }
  return body;
}

function sameExactRangeFileStat(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function invokeResponseCallback<T>(
  state: LocalServerCallbackFailureState,
  callbackName: "onDetailedResponse" | "onResponse",
  callback: ((entry: T) => void) | undefined,
  entry: T,
): void {
  if (callback === undefined) return;
  try {
    callback(entry);
  } catch (error: unknown) {
    state.count += 1;
    if (state.failures.length < MAX_RETAINED_CALLBACK_FAILURES) {
      state.failures.push({ callback: callbackName, error });
    }
  }
}

function validateExactRangeResources(
  resources: readonly Readonly<{
    readonly bytes: number;
    readonly sha256: string;
    readonly source: string;
  }>[],
): ReadonlyMap<string, Readonly<{ readonly bytes: number; readonly sha256: string }>> {
  const validated = new Map<
    string,
    Readonly<{ readonly bytes: number; readonly sha256: string }>
  >();
  for (const resource of resources) {
    if (
      !Number.isSafeInteger(resource.bytes) ||
      resource.bytes <= 0 ||
      !/^[a-f0-9]{64}$/.test(resource.sha256) ||
      resource.source === "" ||
      !/^[A-Za-z0-9._/-]+$/.test(resource.source) ||
      resource.source.startsWith("/") ||
      resource.source.includes("\\") ||
      resource.source
        .split("/")
        .some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      throw new Error(`Invalid exact Range resource: ${JSON.stringify(resource)}`);
    }
    const pathname = `/${resource.source}`;
    if (validated.has(pathname)) {
      throw new Error(`Duplicate exact Range resource source: ${resource.source}`);
    }
    validated.set(pathname, Object.freeze({ bytes: resource.bytes, sha256: resource.sha256 }));
  }
  return validated;
}

function parseExactRange(
  rangeHeader: string | undefined,
  ifRangeHeader: string | undefined,
  etag: string,
  bytes: number,
):
  | Readonly<{ readonly kind: "full" }>
  | Readonly<{ readonly end: number; readonly kind: "partial"; readonly start: number }>
  | Readonly<{ readonly kind: "unsatisfiable" }> {
  if (rangeHeader === undefined || (ifRangeHeader !== undefined && ifRangeHeader !== etag)) {
    return { kind: "full" };
  }
  const match = /^bytes=(0|[1-9][0-9]*)-(0|[1-9][0-9]*)?$/.exec(rangeHeader);
  // This local server implements the single-range form consumed by Parallax. Other
  // units and unsupported bytes forms are ignored like an origin that does not
  // understand that Range shape; they are not proof that a representation is short.
  if (match === null) return { kind: "full" };
  const start = Number(match[1]);
  const requestedEnd = match[2] === undefined ? bytes - 1 : Number(match[2]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start >= bytes ||
    requestedEnd < start
  ) {
    return { kind: "unsatisfiable" };
  }
  return { end: Math.min(requestedEnd, bytes - 1), kind: "partial", start };
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(",") : value;
}

function headerValue(value: number | string | readonly string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? value.join(",") : String(value);
}

async function streamFileResponse(
  method: string | undefined,
  response: import("node:http").ServerResponse,
  filePath: string,
  status: number,
  bodyBytes: number,
  recordResponse: (
    status: number,
    bodyBytes: number,
    interruptedBodyBytes?: (() => number) | null,
  ) => void,
  start?: number,
  end?: number,
): Promise<void> {
  let streamedBytes = 0;
  recordResponse(status, method === "HEAD" ? 0 : bodyBytes, () => streamedBytes);
  response.writeHead(status);
  if (method === "HEAD") {
    response.end();
    return;
  }
  try {
    await pipeline(
      createReadStream(filePath, start === undefined ? undefined : { end, start }),
      byteCounter((bytes) => {
        streamedBytes += bytes;
      }),
      response,
    );
  } catch (error: unknown) {
    if (!response.destroyed) {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

async function streamFileHandleResponse(
  method: string | undefined,
  response: ServerResponse,
  handle: FileHandle,
  status: number,
  bodyBytes: number,
  recordResponse: (
    status: number,
    bodyBytes: number,
    interruptedBodyBytes?: (() => number) | null,
  ) => void,
  start = 0,
  end?: number,
): Promise<void> {
  let streamedBytes = 0;
  recordResponse(status, method === "HEAD" ? 0 : bodyBytes, () => streamedBytes);
  response.writeHead(status);
  if (method === "HEAD") {
    response.end();
    return;
  }
  try {
    await pipeline(
      handle.createReadStream({ autoClose: false, end, start }),
      byteCounter((bytes) => {
        streamedBytes += bytes;
      }),
      response,
    );
  } catch (error: unknown) {
    if (!response.destroyed) {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

function byteCounter(record: (bytes: number) => void): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      record(chunk.byteLength);
      callback(null, chunk);
    },
  });
}

export function listenLocalServer(server: Server, port = 0): Promise<AddressInfo> {
  return new Promise<AddressInfo>((resolveListen, rejectListen) => {
    const onError = (error: Error): void => rejectListen(error);
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      const address = server.address();
      if (address === null || typeof address === "string") {
        rejectListen(new Error("Local server did not expose a TCP address"));
        return;
      }
      resolveListen(address);
    });
  });
}

export async function stopLocalServer(server: Server): Promise<void> {
  const failures: unknown[] = [];
  if (server.listening) {
    await new Promise<void>((resolveClose) => {
      try {
        server.close((error) => {
          if (error !== undefined) failures.push(error);
          resolveClose();
        });
      } catch (error: unknown) {
        failures.push(error);
        resolveClose();
      }
    });
  }
  try {
    assertLocalServerCallbacks(server);
  } catch (error: unknown) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      "Local server shutdown and response callback collection both failed",
    );
  }
}

function classifyPath(pathname: string): PathClass {
  if (pathname === "/" || pathname === UNINSTALL_PATH || pathname.endsWith(".html"))
    return "document";
  if (pathname.startsWith("/immutable/")) return "immutable";
  return "other";
}

function createMetadata(signature: string, body: Buffer): CachedMetadata {
  const digest = createHash("sha256").update(body).digest();
  const digestHex = digest.toString("hex");
  return {
    digestHex,
    etag: `"sha256-${digestHex}"`,
    signature,
  };
}

function isContentAddressed(pathname: string, digestHex: string): boolean {
  return pathname.match(IMMUTABLE_PATH)?.[1] === digestHex;
}

function snapshotMetrics(metrics: MutableMetrics): LocalServerMetrics {
  return {
    bytesServed: metrics.bytesServed,
    bytesServedByPathClass: { ...metrics.bytesServedByPathClass },
    metadataCacheHits: metrics.metadataCacheHits,
    metadataCacheMisses: metrics.metadataCacheMisses,
    pathClasses: { ...metrics.pathClasses },
    requests: metrics.requests,
    schemaVersion: 2,
    statuses: { ...metrics.statuses },
    statusesByPathClass: {
      document: { ...metrics.statusesByPathClass.document },
      immutable: { ...metrics.statusesByPathClass.immutable },
      other: { ...metrics.statusesByPathClass.other },
    },
  };
}

function matchesIfNoneMatch(header: string | undefined, currentTag: string): boolean {
  if (header === undefined) return false;
  if (header.trim() === "*") return true;

  const currentOpaqueTag = currentTag.replace(/^W\//, "");
  const candidates = header.match(/(?:W\/)?"[^"]*"/g) ?? [];
  return candidates.some((candidate) => candidate.replace(/^W\//, "") === currentOpaqueTag);
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
