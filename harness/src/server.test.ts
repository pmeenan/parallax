import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseServerPort } from "./config.js";
import {
  createLocalServer,
  type LocalServerMetrics,
  listenLocalServer,
  stopLocalServer,
} from "./server.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("local build server", () => {
  it("streams only exact-manifest external model artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-server-"));
    const modelRoot = await mkdtemp(join(tmpdir(), "parallax-model-"));
    cleanup.push(root, modelRoot);
    await writeFile(join(root, "index.html"), "<!doctype html><title>Parallax</title>");
    const modelBody = Buffer.from("GGUF-test-shard");
    const modelName = "model-00001-of-00001.gguf";
    const sha256 = createHash("sha256").update(modelBody).digest("hex");
    await writeFile(join(modelRoot, modelName), modelBody);
    const server = createLocalServer({
      externalModel: {
        artifacts: [{ bytes: modelBody.byteLength, path: modelName, sha256 }],
        root: modelRoot,
      },
      root,
    });
    const address = await listenLocalServer(server);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const modelUrl = `${baseUrl}/__parallax/models/${modelName}`;

    try {
      const head = await fetch(modelUrl, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(head.headers.get("content-length")).toBe(String(modelBody.byteLength));
      expect(head.headers.get("etag")).toBe(`"sha256-${sha256}"`);

      const response = await fetch(modelUrl);
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(modelBody);

      const revalidated = await fetch(modelUrl, {
        headers: { "If-None-Match": `"sha256-${sha256}"` },
      });
      expect(revalidated.status).toBe(304);
      expect((await fetch(`${baseUrl}/__parallax/models/not-in-manifest.gguf`)).status).toBe(404);
    } finally {
      await stopLocalServer(server);
    }
  });

  it("records an aborted external-model transfer and closes its pipeline", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-server-"));
    const modelRoot = await mkdtemp(join(tmpdir(), "parallax-model-"));
    cleanup.push(root, modelRoot);
    await writeFile(join(root, "index.html"), "<!doctype html><title>Parallax</title>");
    const modelBody = Buffer.alloc(8 * 1024 * 1024, 0x5a);
    const modelName = "large-model.gguf";
    const sha256 = createHash("sha256").update(modelBody).digest("hex");
    await writeFile(join(modelRoot, modelName), modelBody);
    const server = createLocalServer({
      externalModel: {
        artifacts: [{ bytes: modelBody.byteLength, path: modelName, sha256 }],
        root: modelRoot,
      },
      root,
    });
    const address = await listenLocalServer(server);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      await new Promise<void>((resolveAbort, rejectAbort) => {
        const request = httpRequest(`${baseUrl}/__parallax/models/${modelName}`, (response) => {
          response.once("data", () => response.destroy());
          response.once("close", resolveAbort);
          response.on("error", () => undefined);
        });
        request.once("error", rejectAbort);
        request.end();
      });

      await expect
        .poll(async () => {
          const metrics = (await (
            await fetch(`${baseUrl}/__parallax/metrics`)
          ).json()) as LocalServerMetrics;
          return metrics.statuses["499"] ?? 0;
        })
        .toBe(1);
    } finally {
      await stopLocalServer(server);
    }
  });

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
    const address = await listenLocalServer(server);
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

      const metricsBeforeIdentity = (await (
        await fetch(`${baseUrl}/__parallax/metrics`)
      ).json()) as LocalServerMetrics;
      const identityResponse = await fetch(`${baseUrl}/__parallax/identity`);
      expect(identityResponse.status).toBe(200);
      expect(identityResponse.headers.get("cache-control")).toBe("no-cache");
      expect(identityResponse.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await identityResponse.text()).toContain("Parallax harness identity probe");
      const identityPostResponse = await fetch(`${baseUrl}/__parallax/identity`, {
        method: "POST",
      });
      expect(identityPostResponse.status).toBe(405);
      expect(identityPostResponse.headers.get("allow")).toBe("GET, HEAD");
      expect(await (await fetch(`${baseUrl}/__parallax/metrics`)).json()).toEqual(
        metricsBeforeIdentity,
      );

      const metricsResponse = await fetch(`${baseUrl}/__parallax/metrics`);
      const metrics = (await metricsResponse.json()) as LocalServerMetrics;
      expect(metricsResponse.status).toBe(200);
      expect(metrics.schemaVersion).toBe(2);
      expect(metrics.requests).toBeGreaterThan(0);
      expect(metrics.bytesServed).toBeGreaterThan(0);
      expect(metrics.metadataCacheHits).toBeGreaterThan(0);
      expect(metrics.metadataCacheMisses).toBeGreaterThan(0);
      expect(metrics.statuses["304"]).toBeGreaterThan(0);
      expect(metrics.statuses["400"]).toBe(1);
      expect(metrics.statuses["404"]).toBe(1);
      expect(metrics.statuses["405"]).toBe(1);
      expect(metrics.pathClasses.immutable).toBeGreaterThan(0);
      // Correlated counters attribute each status and byte to its path class.
      expect(metrics.statusesByPathClass.document["200"]).toBe(1);
      expect(metrics.statusesByPathClass.immutable["200"]).toBeGreaterThan(0);
      expect(metrics.statusesByPathClass.immutable["304"]).toBeGreaterThan(0);
      expect(metrics.bytesServedByPathClass.immutable).toBeGreaterThan(0);
      for (const pathClass of ["document", "immutable", "other"] as const) {
        expect(
          Object.values(metrics.statusesByPathClass[pathClass]).reduce(
            (total, count) => total + count,
            0,
          ),
        ).toBe(metrics.pathClasses[pathClass]);
      }
      expect(
        metrics.bytesServedByPathClass.document +
          metrics.bytesServedByPathClass.immutable +
          metrics.bytesServedByPathClass.other,
      ).toBe(metrics.bytesServed);

      const metricsPostResponse = await fetch(`${baseUrl}/__parallax/metrics`, {
        method: "POST",
      });
      expect(metricsPostResponse.status).toBe(405);
      const secondMetricsResponse = await fetch(`${baseUrl}/__parallax/metrics`);
      expect(await secondMetricsResponse.json()).toEqual(metrics);
    } finally {
      await stopLocalServer(server);
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
