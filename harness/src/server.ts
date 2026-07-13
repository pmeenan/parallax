import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, resolve, sep } from "node:path";

const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
});

const IMMUTABLE_PATH = /^\/immutable\/[a-z0-9-]+-([a-f0-9]{64})\.[a-z0-9]+$/;
const METRICS_PATH = "/__parallax/metrics";

type PathClass = "document" | "immutable" | "metrics" | "other";

interface CachedMetadata {
  readonly digestHex: string;
  readonly etag: string;
  readonly signature: string;
}

interface MutableMetrics {
  bytesServed: number;
  metadataCacheHits: number;
  metadataCacheMisses: number;
  pathClasses: Record<PathClass, number>;
  requests: number;
  statuses: Record<string, number>;
}

export interface LocalServerMetrics {
  readonly bytesServed: number;
  readonly metadataCacheHits: number;
  readonly metadataCacheMisses: number;
  readonly pathClasses: Readonly<Record<PathClass, number>>;
  readonly requests: number;
  readonly schemaVersion: 1;
  readonly statuses: Readonly<Record<string, number>>;
}

export interface LocalServerOptions {
  readonly root: string;
}

export function createLocalServer(options: LocalServerOptions): Server {
  const root = resolve(options.root);
  const metadataCache = new Map<string, CachedMetadata>();
  const metrics: MutableMetrics = {
    bytesServed: 0,
    metadataCacheHits: 0,
    metadataCacheMisses: 0,
    pathClasses: { document: 0, immutable: 0, metrics: 0, other: 0 },
    requests: 0,
    statuses: {},
  };

  return createServer(async (request, response) => {
    metrics.requests += 1;
    response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("X-Content-Type-Options", "nosniff");

    let pathClass: PathClass = "other";
    const send = (status: number, body?: Buffer): void => {
      metrics.statuses[String(status)] = (metrics.statuses[String(status)] ?? 0) + 1;
      metrics.pathClasses[pathClass] += 1;
      const responseBody = request.method === "HEAD" ? undefined : body;
      metrics.bytesServed += responseBody?.byteLength ?? 0;
      response.writeHead(status).end(responseBody);
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      send(405);
      return;
    }

    try {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      const pathname = decodeURIComponent(requestUrl.pathname);
      pathClass = classifyPath(pathname);

      if (pathname === METRICS_PATH) {
        const body = Buffer.from(`${JSON.stringify(snapshotMetrics(metrics), null, 2)}\n`);
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Content-Length", body.byteLength);
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        send(200, body);
        return;
      }

      const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
      const filePath = resolve(root, relativePath);

      if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
        send(403);
        return;
      }

      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        send(404);
        return;
      }

      const signature = `${fileStat.size}:${fileStat.mtimeMs}:${fileStat.ctimeMs}`;
      const cached = metadataCache.get(filePath);
      let body: Buffer | undefined;
      let metadata: CachedMetadata;
      if (cached?.signature === signature) {
        metrics.metadataCacheHits += 1;
        metadata = cached;
      } else {
        metrics.metadataCacheMisses += 1;
        body = await readFile(filePath);
        metadata = createMetadata(signature, body);
        metadataCache.set(filePath, metadata);
      }

      response.setHeader(
        "Cache-Control",
        isContentAddressed(pathname, metadata.digestHex)
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      );
      response.setHeader(
        "Content-Type",
        CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
      );
      response.setHeader("ETag", metadata.etag);

      if (matchesIfNoneMatch(request.headers["if-none-match"], metadata.etag)) {
        send(304);
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
      send(500);
    }
  });
}

function classifyPath(pathname: string): PathClass {
  if (pathname === METRICS_PATH) return "metrics";
  if (pathname === "/" || pathname.endsWith(".html")) return "document";
  if (pathname.startsWith("/immutable/")) return "immutable";
  return "other";
}

function createMetadata(signature: string, body: Buffer): CachedMetadata {
  const digest = createHash("sha256").update(body).digest();
  const digestHex = digest.toString("hex");
  return {
    digestHex,
    etag: `"${digest.toString("base64url")}"`,
    signature,
  };
}

function isContentAddressed(pathname: string, digestHex: string): boolean {
  return pathname.match(IMMUTABLE_PATH)?.[1] === digestHex;
}

function snapshotMetrics(metrics: MutableMetrics): LocalServerMetrics {
  return {
    bytesServed: metrics.bytesServed,
    metadataCacheHits: metrics.metadataCacheHits,
    metadataCacheMisses: metrics.metadataCacheMisses,
    pathClasses: { ...metrics.pathClasses },
    requests: metrics.requests,
    schemaVersion: 1,
    statuses: { ...metrics.statuses },
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
