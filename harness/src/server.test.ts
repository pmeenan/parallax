import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseServerPort } from "./config.js";
import { createLocalServer } from "./server.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("local build server", () => {
  it("serves isolation and cache headers on 200 and 304 responses", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-server-"));
    cleanup.push(root);
    await writeFile(join(root, "index.html"), "<!doctype html><title>Parallax</title>");
    const immutable = join(root, "immutable");
    await mkdir(immutable);
    const artifactBody = "export const version = 1;";
    const artifactDigest = createHash("sha256").update(artifactBody).digest("hex");
    const artifactName = `engine-${artifactDigest}.js`;
    await writeFile(join(immutable, artifactName), artifactBody);
    await writeFile(join(immutable, "engine-abc123.js"), artifactBody);

    const server = createLocalServer({ root });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const documentResponse = await fetch(baseUrl);
      expect(documentResponse.status).toBe(200);
      expect(documentResponse.headers.get("cache-control")).toBe("no-cache");
      expect(documentResponse.headers.get("cross-origin-opener-policy")).toBe("same-origin");
      expect(documentResponse.headers.get("cross-origin-embedder-policy")).toBe("require-corp");

      const artifactUrl = `${baseUrl}/immutable/${artifactName}`;
      const artifactResponse = await fetch(artifactUrl);
      expect(artifactResponse.headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable",
      );
      expect(await artifactResponse.text()).toBe(artifactBody);
      const etag = artifactResponse.headers.get("etag");
      expect(etag).not.toBeNull();

      const revalidatedResponse = await fetch(artifactUrl, {
        headers: { "If-None-Match": etag ?? "" },
      });
      expect(revalidatedResponse.status).toBe(304);
      expect(revalidatedResponse.headers.get("cross-origin-opener-policy")).toBe("same-origin");
      expect(revalidatedResponse.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
      expect(revalidatedResponse.headers.get("cache-control")).toContain("immutable");

      for (const ifNoneMatch of ["*", `W/${etag}`, `"other", ${etag}`]) {
        const variantResponse = await fetch(artifactUrl, {
          headers: { "If-None-Match": ifNoneMatch },
        });
        expect(variantResponse.status).toBe(304);
      }

      const headResponse = await fetch(artifactUrl, {
        headers: { "If-None-Match": etag ?? "" },
        method: "HEAD",
      });
      expect(headResponse.status).toBe(304);

      const postResponse = await fetch(artifactUrl, {
        headers: { "If-None-Match": etag ?? "" },
        method: "POST",
      });
      expect(postResponse.status).toBe(405);
      expect(postResponse.headers.get("allow")).toBe("GET, HEAD");

      const unverifiedNameResponse = await fetch(`${baseUrl}/immutable/engine-abc123.js`);
      expect(unverifiedNameResponse.headers.get("cache-control")).toBe("no-cache");

      const invalidSubpathResponse = await fetch(`${baseUrl}/index.html/child.js`);
      expect(invalidSubpathResponse.status).toBe(404);

      const malformedPathResponse = await fetch(`${baseUrl}/%zz`);
      expect(malformedPathResponse.status).toBe(400);

      const metricsResponse = await fetch(`${baseUrl}/__parallax/metrics`);
      const metrics = (await metricsResponse.json()) as {
        readonly bytesServed: number;
        readonly metadataCacheHits: number;
        readonly metadataCacheMisses: number;
        readonly pathClasses: Readonly<Record<string, number>>;
        readonly requests: number;
        readonly schemaVersion: number;
        readonly statuses: Readonly<Record<string, number>>;
      };
      expect(metricsResponse.status).toBe(200);
      expect(metrics.schemaVersion).toBe(1);
      expect(metrics.requests).toBeGreaterThan(0);
      expect(metrics.bytesServed).toBeGreaterThan(0);
      expect(metrics.metadataCacheHits).toBeGreaterThan(0);
      expect(metrics.metadataCacheMisses).toBeGreaterThan(0);
      expect(metrics.statuses["304"]).toBeGreaterThan(0);
      expect(metrics.statuses["400"]).toBe(1);
      expect(metrics.statuses["404"]).toBe(1);
      expect(metrics.statuses["405"]).toBe(1);
      expect(metrics.pathClasses.immutable).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error === undefined ? resolveClose() : reject(error)));
      });
    }
  });
});

describe("local server configuration", () => {
  it("defaults an unset or empty port and rejects invalid values", () => {
    expect(parseServerPort(undefined)).toBe(4173);
    expect(parseServerPort("")).toBe(4173);
    expect(parseServerPort("8080")).toBe(8080);
    expect(() => parseServerPort("NaN")).toThrow(/PORT must be an integer/);
    expect(() => parseServerPort("0")).toThrow(/PORT must be an integer/);
    expect(() => parseServerPort("65536")).toThrow(/PORT must be an integer/);
  });
});
