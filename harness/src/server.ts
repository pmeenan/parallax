import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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

type PathClass = "document" | "immutable" | "other";

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
    pathClasses: { document: 0, immutable: 0, other: 0 },
    requests: 0,
    statuses: {},
  };

  return createServer(async (request, response) => {
    response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("X-Content-Type-Options", "nosniff");

    let pathClass: PathClass = "other";
    let requestMetadataCacheHits = 0;
    let requestMetadataCacheMisses = 0;
    const send = (status: number, body?: Buffer): void => {
      const responseBody = request.method === "HEAD" ? undefined : body;
      response.once("finish", () => {
        metrics.requests += 1;
        metrics.statuses[String(status)] = (metrics.statuses[String(status)] ?? 0) + 1;
        metrics.pathClasses[pathClass] += 1;
        metrics.metadataCacheHits += requestMetadataCacheHits;
        metrics.metadataCacheMisses += requestMetadataCacheMisses;
        metrics.bytesServed += responseBody?.byteLength ?? 0;
      });
      response.writeHead(status).end(responseBody);
    };

    try {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      const pathname = decodeURIComponent(requestUrl.pathname);

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

      pathClass = classifyPath(pathname);
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        send(405);
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
        requestMetadataCacheHits += 1;
        metadata = cached;
      } else {
        requestMetadataCacheMisses += 1;
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

export function listenLocalServer(server: Server): Promise<AddressInfo> {
  return new Promise<AddressInfo>((resolveListen, rejectListen) => {
    const onError = (error: Error): void => rejectListen(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
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

export function stopLocalServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
  });
}

function classifyPath(pathname: string): PathClass {
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
