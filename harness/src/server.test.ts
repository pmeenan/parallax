import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, rename, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseServerPort } from "./config.js";
import {
  assertLocalServerCallbacks,
  createLocalServer,
  createLocalServerJournalCollector,
  LOCAL_SERVER_DETAILED_JOURNAL_EVIDENCE_KEYS,
  LOCAL_SERVER_JOURNAL_EVIDENCE_KEYS,
  LocalServerCallbackError,
  type LocalServerDetailedJournalEntry,
  LocalServerJournalCollectionError,
  type LocalServerJournalEntry,
  type LocalServerMetrics,
  listenLocalServer,
  projectLocalServerDetailedJournalEntry,
  projectLocalServerJournalEntry,
  stopLocalServer,
  UNINSTALL_FETCH_METADATA,
  UNINSTALL_PATH,
  uninstallSentinelWorkerPath,
} from "./server.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("local build server", () => {
  it("makes journal listeners total and surfaces bounded collection failure explicitly", () => {
    const collector = createLocalServerJournalCollector<number>("test journal collection", () => {
      throw new Error("validation or overflow");
    });
    expect(() => collector.record(1)).not.toThrow();
    expect(() => collector.record(2)).not.toThrow();
    try {
      collector.assertComplete();
      throw new Error("Expected collection assertion to fail");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(LocalServerJournalCollectionError);
      expect(error).toMatchObject({ failureCount: 2, name: "LocalServerJournalCollectionError" });
    }
  });

  it("captures finish callback throws without skipping either callback", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-server-callback-finish-"));
    cleanup.push(root);
    await writeFile(join(root, "index.html"), "<!doctype html><title>Parallax</title>");
    const callbacks: string[] = [];
    const server = createLocalServer({
      onDetailedResponse: (entry) => {
        callbacks.push(`detailed:${entry.completion}`);
        throw new Error("detailed finish collection failed");
      },
      onResponse: (entry) => {
        callbacks.push(`response:${entry.completion}`);
        throw new Error("response finish collection failed");
      },
      root,
    });
    const address = await listenLocalServer(server);
    try {
      expect((await fetch(`http://127.0.0.1:${address.port}/`)).status).toBe(200);
      await expect.poll(() => callbacks.length).toBe(2);
      expect(callbacks).toEqual(["response:completed", "detailed:completed"]);
      expect(() => assertLocalServerCallbacks(server)).toThrow(LocalServerCallbackError);
      try {
        assertLocalServerCallbacks(server);
      } catch (error: unknown) {
        expect(error).toMatchObject({ failureCount: 2, name: "LocalServerCallbackError" });
      }
    } finally {
      if (server.listening) await stopLocalServer(server).catch(() => undefined);
    }
  });

  it("captures close callback throws and retains exact producer projections", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-server-callback-close-"));
    cleanup.push(root);
    const bytes = 64 * 1024 * 1024;
    const source = "large.bin";
    const file = await open(join(root, source), "wx");
    await file.truncate(bytes);
    await file.close();
    const digest = createHash("sha256");
    const zeroChunk = Buffer.alloc(1024 * 1024);
    for (let offset = 0; offset < bytes; offset += zeroChunk.byteLength) {
      digest.update(zeroChunk);
    }
    const callbacks: LocalServerDetailedJournalEntry[] = [];
    const server = createLocalServer({
      exactRangeResources: [{ bytes, sha256: digest.digest("hex"), source }],
      onDetailedResponse: (entry) => {
        callbacks.push(entry);
        throw new Error("detailed close collection failed");
      },
      onResponse: () => {
        throw new Error("response close collection failed");
      },
      root,
    });
    const address = await listenLocalServer(server);
    try {
      await new Promise<void>((resolveAbort, rejectAbort) => {
        const request = httpRequest(`http://127.0.0.1:${address.port}/${source}`);
        request.once("error", (error) => {
          if ((error as NodeJS.ErrnoException).code === "ECONNRESET") resolveAbort();
          else rejectAbort(error);
        });
        request.once("response", (response) => {
          response.once("data", () => {
            response.destroy();
            resolveAbort();
          });
        });
        request.end();
      });
      await expect.poll(() => callbacks.length).toBe(1);
      const callback = callbacks[0];
      if (callback === undefined) throw new Error("Close callback was not retained");
      expect(callback.completion).toBe("client-closed");
      expect(callback.status).toBe(499);
      expect(Object.keys(projectLocalServerJournalEntry(callback)).sort()).toEqual(
        [...LOCAL_SERVER_JOURNAL_EVIDENCE_KEYS].sort(),
      );
      expect(Object.keys(projectLocalServerDetailedJournalEntry(callback)).sort()).toEqual(
        [...LOCAL_SERVER_DETAILED_JOURNAL_EVIDENCE_KEYS].sort(),
      );
      expect(() => assertLocalServerCallbacks(server)).toThrow(LocalServerCallbackError);
      await expect(stopLocalServer(server)).rejects.toMatchObject({ failureCount: 2 });
    } finally {
      if (server.listening) await stopLocalServer(server).catch(() => undefined);
    }
  });

  it("makes callback-only failures fail the standard stop boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-server-callback-stop-"));
    cleanup.push(root);
    await writeFile(join(root, "index.html"), "<!doctype html><title>Parallax</title>");
    const server = createLocalServer({
      onResponse: () => {
        throw new Error("callback-only failure");
      },
      root,
    });
    const address = await listenLocalServer(server);
    await fetch(`http://127.0.0.1:${address.port}/`);
    await expect(stopLocalServer(server)).rejects.toBeInstanceOf(LocalServerCallbackError);
    await expect(stopLocalServer(server)).rejects.toBeInstanceOf(LocalServerCallbackError);
  });

  it("surfaces stop-only failures and aggregates them with callback failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-server-stop-errors-"));
    cleanup.push(root);
    await writeFile(join(root, "index.html"), "<!doctype html><title>Parallax</title>");
    const server = createLocalServer({
      onResponse: () => {
        throw new Error("combined callback failure");
      },
      root,
    });
    const address = await listenLocalServer(server);
    await fetch(`http://127.0.0.1:${address.port}/`);
    const stopFailure = new Error("injected stop failure");
    const close = vi.spyOn(server, "close").mockImplementation(((
      callback?: (error?: Error) => void,
    ) => {
      callback?.(stopFailure);
      return server;
    }) as typeof server.close);
    try {
      await expect(stopLocalServer(server)).rejects.toMatchObject({
        errors: [stopFailure, expect.any(LocalServerCallbackError)],
        message: "Local server shutdown and response callback collection both failed",
      });
    } finally {
      close.mockRestore();
      await stopLocalServer(server).catch(() => undefined);
    }

    const clean = createLocalServer({ root });
    await listenLocalServer(clean);
    const cleanCloseFailure = new Error("stop-only failure");
    const cleanClose = vi.spyOn(clean, "close").mockImplementation(((
      callback?: (error?: Error) => void,
    ) => {
      callback?.(cleanCloseFailure);
      return clean;
    }) as typeof clean.close);
    try {
      await expect(stopLocalServer(clean)).rejects.toBe(cleanCloseFailure);
    } finally {
      cleanClose.mockRestore();
      await stopLocalServer(clean);
    }
  });
  it("serves only bounded harness-owned uninstall sentinel workers", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-server-uninstall-sentinel-"));
    cleanup.push(root);
    await writeFile(join(root, "index.html"), "<!doctype html><title>Parallax</title>");
    const server = createLocalServer({ root });
    const address = await listenLocalServer(server);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const path = uninstallSentinelWorkerPath("client-side-012345678901234567890123");
    try {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).toBe("application/javascript");
      expect(await response.text()).toContain("skipWaiting");
      expect((await fetch(`${baseUrl}${path}?mutable=1`)).status).toBe(405);
      expect(
        (await fetch(`${baseUrl}/__parallax-uninstall-sentinel-invalid/service-worker.js`)).status,
      ).toBe(404);
      expect(() => uninstallSentinelWorkerPath("invalid")).toThrow(/prefix/u);
    } finally {
      await stopLocalServer(server);
    }
  });

  it("serves only the fixed uninstall route with the exact Clear-Site-Data contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-server-uninstall-"));
    cleanup.push(root);
    await writeFile(join(root, "index.html"), "<!doctype html><title>Parallax</title>");
    const journal: LocalServerJournalEntry[] = [];
    const server = createLocalServer({ onResponse: (entry) => journal.push(entry), root });
    const address = await listenLocalServer(server);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const response = await rawRequest(`${baseUrl}${UNINSTALL_PATH}`, {
        headers: {
          "Sec-Fetch-Dest": UNINSTALL_FETCH_METADATA.dest,
          "Sec-Fetch-Mode": UNINSTALL_FETCH_METADATA.mode,
          "Sec-Fetch-Site": UNINSTALL_FETCH_METADATA.site,
          "Sec-Fetch-User": UNINSTALL_FETCH_METADATA.user,
        },
        method: "POST",
      });
      expect(response.status).toBe(200);
      expect(response.headers["clear-site-data"]).toBe('"storage", "cache"');
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(response.body).toContain("site-data removal requested");

      const query = await rawRequest(`${baseUrl}${UNINSTALL_PATH}?ignored=1`, {
        headers: {
          "Sec-Fetch-Dest": UNINSTALL_FETCH_METADATA.dest,
          "Sec-Fetch-Mode": UNINSTALL_FETCH_METADATA.mode,
          "Sec-Fetch-Site": UNINSTALL_FETCH_METADATA.site,
          "Sec-Fetch-User": UNINSTALL_FETCH_METADATA.user,
        },
        method: "POST",
      });
      expect(query.status).toBe(403);
      expect(query.headers["clear-site-data"]).toBeUndefined();
      expect((await fetch(`${baseUrl}/uninstall/child`)).status).toBe(404);
      for (const request of [
        {},
        { method: "HEAD" },
        { method: "POST" },
        {
          headers: {
            "Sec-Fetch-Dest": UNINSTALL_FETCH_METADATA.dest,
            "Sec-Fetch-Mode": UNINSTALL_FETCH_METADATA.mode,
            "Sec-Fetch-Site": "cross-site",
            "Sec-Fetch-User": UNINSTALL_FETCH_METADATA.user,
          },
          method: "POST",
        },
      ] as const) {
        const rejected = await rawRequest(`${baseUrl}${UNINSTALL_PATH}`, request);
        expect([403, 405]).toContain(rejected.status);
        expect(rejected.headers["clear-site-data"]).toBeUndefined();
      }
      expect(journal).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            cacheControl: "no-store",
            clearSiteData: '"storage", "cache"',
            completion: "completed",
            headersSent: true,
            intendedStatus: 200,
            path: UNINSTALL_PATH,
            status: 200,
          }),
        ]),
      );
    } finally {
      await stopLocalServer(server);
    }
  });

  it("can rebind an explicitly retained loopback port after a complete stop", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-server-rebind-"));
    cleanup.push(root);
    await writeFile(join(root, "index.html"), "<!doctype html><title>Parallax</title>");
    const first = createLocalServer({ root });
    const firstAddress = await listenLocalServer(first);
    await stopLocalServer(first);

    const second = createLocalServer({ root });
    try {
      const secondAddress = await listenLocalServer(second, firstAddress.port);
      expect(secondAddress.port).toBe(firstAddress.port);
      expect((await fetch(`http://127.0.0.1:${secondAddress.port}/`)).status).toBe(200);
    } finally {
      await stopLocalServer(second);
    }
  });

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

  it("serves exact shell and model resources with resume and completed Range semantics", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-server-"));
    cleanup.push(root);
    const immutable = join(root, "immutable");
    await mkdir(immutable);
    const shellBody = Buffer.from("export const adapter = true;");
    const modelBody = Buffer.from("GGUF-adapter-model");
    const shellSha256 = createHash("sha256").update(shellBody).digest("hex");
    const modelSha256 = createHash("sha256").update(modelBody).digest("hex");
    const shellSource = `immutable/app-${shellSha256}.js`;
    const modelSource = `immutable/model-${modelSha256}.gguf`;
    await writeFile(join(root, shellSource), shellBody);
    await writeFile(join(root, modelSource), modelBody);
    const journal: LocalServerJournalEntry[] = [];
    const detailedJournal: LocalServerDetailedJournalEntry[] = [];
    const server = createLocalServer({
      exactRangeResources: [
        { bytes: shellBody.byteLength, sha256: shellSha256, source: shellSource },
        { bytes: modelBody.byteLength, sha256: modelSha256, source: modelSource },
      ],
      onResponse: (entry) => journal.push(entry),
      onDetailedResponse: (entry) => detailedJournal.push(entry),
      root,
    });
    const address = await listenLocalServer(server);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      for (const fixture of [
        { body: shellBody, sha256: shellSha256, source: shellSource },
        { body: modelBody, sha256: modelSha256, source: modelSource },
      ]) {
        const etag = `"sha256-${fixture.sha256}"`;
        const resumed = await fetch(`${baseUrl}/${fixture.source}`, {
          headers: { "If-Range": etag, Range: "bytes=5-" },
        });
        expect(resumed.status).toBe(206);
        expect(resumed.headers.get("accept-ranges")).toBe("bytes");
        expect(resumed.headers.get("cache-control")).toBe("no-cache");
        expect(resumed.headers.get("content-range")).toBe(
          `bytes 5-${fixture.body.byteLength - 1}/${fixture.body.byteLength}`,
        );
        expect(resumed.headers.get("etag")).toBe(etag);
        if (fixture.source.endsWith(".js")) {
          expect(resumed.headers.get("content-type")).toBe("application/javascript");
        }
        expect(Buffer.from(await resumed.arrayBuffer())).toEqual(fixture.body.subarray(5));

        const bounded = await fetch(`${baseUrl}/${fixture.source}`, {
          headers: { Range: "bytes=0-0" },
        });
        expect(bounded.status).toBe(206);
        expect(bounded.headers.get("content-length")).toBe("1");
        expect(bounded.headers.get("content-range")).toBe(`bytes 0-0/${fixture.body.byteLength}`);
        expect(Buffer.from(await bounded.arrayBuffer())).toEqual(fixture.body.subarray(0, 1));

        const completed = await fetch(`${baseUrl}/${fixture.source}`, {
          headers: {
            "If-Range": etag,
            Range: `bytes=${fixture.body.byteLength}-`,
          },
        });
        expect(completed.status).toBe(416);
        expect(completed.headers.get("content-range")).toBe(`bytes */${fixture.body.byteLength}`);
        expect(completed.headers.get("cache-control")).toBe("no-cache");
        expect((await completed.arrayBuffer()).byteLength).toBe(0);

        const reversed = await fetch(`${baseUrl}/${fixture.source}`, {
          headers: { Range: "bytes=5-4" },
        });
        expect(reversed.status).toBe(416);
        expect(reversed.headers.get("content-range")).toBe(`bytes */${fixture.body.byteLength}`);

        const changed = await fetch(`${baseUrl}/${fixture.source}`, {
          headers: { "If-Range": '"different"', Range: "bytes=5-" },
        });
        expect(changed.status).toBe(200);
        expect(Buffer.from(await changed.arrayBuffer())).toEqual(fixture.body);
      }
      expect(journal).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            cacheControl: "no-cache",
            coep: "require-corp",
            contentType: "application/javascript",
            coop: "same-origin",
            ifRange: `"sha256-${shellSha256}"`,
            method: "GET",
            nosniff: "nosniff",
            path: `/${shellSource}`,
            range: "bytes=5-",
            status: 206,
          }),
        ]),
      );
      expect(detailedJournal).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            bodyBytes: 1,
            contentRange: `bytes 0-0/${modelBody.byteLength}`,
            path: `/${modelSource}`,
            range: "bytes=0-0",
            status: 206,
          }),
          expect.objectContaining({
            bodyBytes: shellBody.byteLength - 5,
            contentRange: `bytes 5-${shellBody.byteLength - 1}/${shellBody.byteLength}`,
            etag: `"sha256-${shellSha256}"`,
            ifNoneMatch: null,
            path: `/${shellSource}`,
            range: "bytes=5-",
            status: 206,
          }),
        ]),
      );
    } finally {
      await stopLocalServer(server);
    }
  });

  it("matches static-origin single-Range handling for ignored and unsatisfiable shapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-server-range-parity-"));
    cleanup.push(root);
    const body = Buffer.from("0123456789");
    await writeFile(join(root, "asset.bin"), body);
    const server = createLocalServer({ root });
    const address = await listenLocalServer(server);
    const url = `http://127.0.0.1:${address.port}/asset.bin`;
    try {
      for (const range of ["bytes=-2", "bytes=0-0,2-2", "items=0-1"]) {
        const response = await fetch(url, { headers: { Range: range } });
        expect(response.status, range).toBe(200);
        expect(Buffer.from(await response.arrayBuffer()), range).toEqual(body);
      }

      const unsatisfiable = await fetch(url, { headers: { Range: `bytes=${body.length}-` } });
      expect(unsatisfiable.status).toBe(416);
      expect(unsatisfiable.headers.get("content-range")).toBe(`bytes */${body.length}`);

      const partial = await fetch(url, { headers: { Range: "bytes=2-999" } });
      expect(partial.status).toBe(206);
      expect(partial.headers.get("content-range")).toBe(`bytes 2-9/${body.length}`);
      expect(Buffer.from(await partial.arrayBuffer())).toEqual(body.subarray(2));
    } finally {
      await stopLocalServer(server);
    }
  });

  it("applies an exact-path Range body transform at the server response boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-server-transform-"));
    cleanup.push(root);
    const immutable = join(root, "immutable");
    await mkdir(immutable);
    const body = Buffer.from("exact-body");
    const sha256 = createHash("sha256").update(body).digest("hex");
    const source = `immutable/resource-${sha256}.bin`;
    await writeFile(join(root, source), body);
    const journal: LocalServerDetailedJournalEntry[] = [];
    let useCount = 0;
    const server = createLocalServer({
      exactRangeBodyTransform: {
        path: `/${source}`,
        transform: (input) => {
          useCount += 1;
          expect(input.start).toBe(0);
          const transformed = new Uint8Array(input.body);
          transformed[0] = (transformed[0] ?? 0) ^ 0xff;
          return transformed;
        },
      },
      exactRangeResources: [{ bytes: body.byteLength, sha256, source }],
      onDetailedResponse: (entry) => journal.push(entry),
      root,
    });
    const address = await listenLocalServer(server);
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/${source}`, {
        headers: { Range: "bytes=0-" },
      });
      const received = new Uint8Array(await response.arrayBuffer());
      expect(received[0]).toBe((body[0] ?? 0) ^ 0xff);
      expect(received.byteLength).toBe(body.byteLength);
      expect(useCount).toBe(1);
      await expect.poll(() => journal.length).toBe(1);
      expect(journal[0]).toMatchObject({
        bodyBytes: body.byteLength,
        etag: `"sha256-${sha256}"`,
        path: `/${source}`,
        range: "bytes=0-",
        status: 206,
      });
    } finally {
      await stopLocalServer(server);
    }
  });

  it("does not leak partial-response headers when an exact Range transform fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-server-transform-failure-"));
    cleanup.push(root);
    const body = Buffer.from("exact-body");
    const sha256 = createHash("sha256").update(body).digest("hex");
    const source = `resource-${sha256}.bin`;
    await writeFile(join(root, source), body);
    const phases: string[] = [];
    const server = createLocalServer({
      exactRangeBodyTransform: {
        path: `/${source}`,
        transform: () => {
          throw new Error("injected transform failure");
        },
      },
      exactRangeResources: [{ bytes: body.byteLength, sha256, source }],
      onExactRangeFilePhase: ({ phase }) => {
        phases.push(phase);
      },
      root,
    });
    const address = await listenLocalServer(server);
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/${source}`, {
        headers: { Range: "bytes=0-0" },
      });
      expect(response.status).toBe(500);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-length")).toBe("0");
      expect(response.headers.get("content-range")).toBeNull();
      expect(response.headers.get("etag")).toBeNull();
      expect((await response.arrayBuffer()).byteLength).toBe(0);
      expect(phases.filter((phase) => phase === "closed")).toHaveLength(1);
    } finally {
      await stopLocalServer(server);
    }
  });

  it("fails closed on invalid exact Range resource contracts and file sizes", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-server-"));
    cleanup.push(root);
    expect(() =>
      createLocalServer({
        exactRangeResources: [{ bytes: 1, sha256: "not-a-hash", source: "../asset.bin" }],
        root,
      }),
    ).toThrow(/Invalid exact Range resource/);

    const sha256 = "a".repeat(64);
    expect(() =>
      createLocalServer({
        exactRangeResources: [
          { bytes: 1, sha256, source: "asset.bin" },
          { bytes: 1, sha256: "b".repeat(64), source: "asset.bin" },
        ],
        root,
      }),
    ).toThrow(/Duplicate exact Range resource/);

    await writeFile(join(root, "asset.bin"), "wrong-size");
    const server = createLocalServer({
      exactRangeResources: [{ bytes: 1, sha256, source: "asset.bin" }],
      root,
    });
    const address = await listenLocalServer(server);
    try {
      expect((await fetch(`http://127.0.0.1:${address.port}/asset.bin`)).status).toBe(409);
    } finally {
      await stopLocalServer(server);
    }

    const expectedBody = Buffer.from("expected");
    const wrongBody = Buffer.from("corrupt!");
    const expectedSha256 = createHash("sha256").update(expectedBody).digest("hex");
    await writeFile(join(root, "asset.bin"), expectedBody);
    const replacement = join(root, "replacement.bin");
    await writeFile(replacement, wrongBody);
    let replaced = false;
    const phases: string[] = [];
    const digestServer = createLocalServer({
      exactRangeResources: [
        { bytes: expectedBody.byteLength, sha256: expectedSha256, source: "asset.bin" },
      ],
      onExactRangeFilePhase: async ({ phase }) => {
        phases.push(phase);
        if (phase === "after-hash" && !replaced) {
          replaced = true;
          await rm(join(root, "asset.bin"));
          await rename(replacement, join(root, "asset.bin"));
        }
      },
      root,
    });
    const digestAddress = await listenLocalServer(digestServer);
    try {
      const url = `http://127.0.0.1:${digestAddress.port}/asset.bin`;
      const initial = await fetch(url);
      expect(initial.status).toBe(200);
      expect(Buffer.from(await initial.arrayBuffer())).toEqual(expectedBody);

      const corrupted = await fetch(url);
      expect(corrupted.status).toBe(409);
      expect(corrupted.headers.get("etag")).toBeNull();
      await expect.poll(() => phases.filter((phase) => phase === "closed").length).toBe(2);
    } finally {
      await stopLocalServer(digestServer);
    }
  });

  it("rejects same-handle in-place mutation before emitting identity headers", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-server-in-place-mutation-"));
    cleanup.push(root);
    const expectedBody = Buffer.from("expected");
    const wrongBody = Buffer.from("corrupt!");
    const sha256 = createHash("sha256").update(expectedBody).digest("hex");
    const filePath = join(root, "asset.bin");
    await writeFile(filePath, expectedBody);
    const phases: string[] = [];
    let mutated = false;
    const server = createLocalServer({
      exactRangeResources: [{ bytes: expectedBody.byteLength, sha256, source: "asset.bin" }],
      onExactRangeFilePhase: async ({ phase }) => {
        phases.push(phase);
        if (phase === "after-hash" && !mutated) {
          mutated = true;
          await writeFile(filePath, wrongBody);
        }
      },
      root,
    });
    const address = await listenLocalServer(server);
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/asset.bin`);
      expect(response.status).toBe(409);
      expect(response.headers.get("etag")).toBeNull();
      expect(response.headers.get("accept-ranges")).toBeNull();
      await expect.poll(() => phases.filter((phase) => phase === "closed").length).toBe(1);
    } finally {
      await stopLocalServer(server);
    }
  });

  it("validates conditional exact-resource HEAD and 304 against owned handles", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-server-owned-head-"));
    cleanup.push(root);
    const body = Buffer.from("owned-head-body");
    const sha256 = createHash("sha256").update(body).digest("hex");
    const source = `resource-${sha256}.bin`;
    await writeFile(join(root, source), body);
    const phases: string[] = [];
    const server = createLocalServer({
      exactRangeResources: [{ bytes: body.byteLength, sha256, source }],
      onExactRangeFilePhase: ({ phase }) => {
        phases.push(phase);
      },
      root,
    });
    const address = await listenLocalServer(server);
    const url = `http://127.0.0.1:${address.port}/${source}`;
    const etag = `"sha256-${sha256}"`;
    try {
      const head = await fetch(url, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(head.headers.get("content-length")).toBe(String(body.byteLength));
      expect(head.headers.get("etag")).toBe(etag);
      expect((await head.arrayBuffer()).byteLength).toBe(0);

      const notModified = await fetch(url, {
        headers: { "If-None-Match": etag },
        method: "HEAD",
      });
      expect(notModified.status).toBe(304);
      expect(notModified.headers.get("etag")).toBe(etag);
      expect((await notModified.arrayBuffer()).byteLength).toBe(0);
      expect(phases.filter((phase) => phase === "opened")).toHaveLength(2);
      await expect.poll(() => phases.filter((phase) => phase === "closed").length).toBe(2);
    } finally {
      await stopLocalServer(server);
    }
  });

  it("returns validated conditional GET Range 304s before success or throwing transforms", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-server-conditional-transform-"));
    cleanup.push(root);
    const body = Buffer.from("conditional-transform-body");
    const sha256 = createHash("sha256").update(body).digest("hex");
    const source = `resource-${sha256}.bin`;
    await writeFile(join(root, source), body);
    const etag = `"sha256-${sha256}"`;

    for (const mode of ["success", "throw"] as const) {
      const phases: string[] = [];
      const transform =
        mode === "success"
          ? vi.fn((input: Readonly<{ body: Uint8Array }>) => input.body)
          : vi.fn((_input: Readonly<{ body: Uint8Array }>): Uint8Array => {
              throw new Error("conditional transform must not run");
            });
      const server = createLocalServer({
        exactRangeBodyTransform: { path: `/${source}`, transform },
        exactRangeResources: [{ bytes: body.byteLength, sha256, source }],
        onExactRangeFilePhase: ({ phase }) => {
          phases.push(phase);
        },
        root,
      });
      const address = await listenLocalServer(server);
      try {
        const response = await fetch(`http://127.0.0.1:${address.port}/${source}`, {
          headers: { "If-None-Match": etag, Range: "bytes=0-0" },
        });
        expect(response.status).toBe(304);
        expect(response.headers.get("etag")).toBe(etag);
        expect(response.headers.get("accept-ranges")).toBe("bytes");
        expect(response.headers.get("cache-control")).toBe("no-cache");
        expect(response.headers.get("content-range")).toBeNull();
        expect((await response.arrayBuffer()).byteLength).toBe(0);
        expect(transform).not.toHaveBeenCalled();
        expect(phases.filter((phase) => phase === "opened")).toHaveLength(1);
        await expect.poll(() => phases.filter((phase) => phase === "closed").length).toBe(1);
      } finally {
        await stopLocalServer(server);
      }
    }
  });

  it("serves isolation and cache headers on 200 and 304 responses", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-server-"));
    cleanup.push(root);
    await writeFile(join(root, "index.html"), "<!doctype html><title>Parallax</title>");
    const buildManifestBody = Buffer.from('{"schemaVersion":15}\n');
    const installManifestBody = Buffer.from('{"schemaVersion":1}\n');
    await writeFile(join(root, "build-manifest.json"), buildManifestBody);
    await writeFile(join(root, "install-manifest.json"), installManifestBody);
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

      for (const [path, body] of [
        ["build-manifest.json", buildManifestBody],
        ["install-manifest.json", installManifestBody],
      ] as const) {
        const manifestResponse = await fetch(`${baseUrl}/${path}`);
        const manifestEtag = `"sha256-${createHash("sha256").update(body).digest("hex")}"`;
        expect(manifestResponse.status).toBe(200);
        expect(manifestResponse.headers.get("cache-control")).toBe("no-cache");
        expect(manifestResponse.headers.get("etag")).toBe(manifestEtag);
        expect(Buffer.from(await manifestResponse.arrayBuffer())).toEqual(body);
        expect(
          (
            await fetch(`${baseUrl}/${path}`, {
              headers: { "If-None-Match": manifestEtag },
            })
          ).status,
        ).toBe(304);
      }

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

function rawRequest(
  url: string,
  options: Readonly<{
    readonly headers?: Readonly<Record<string, string>>;
    readonly method?: string;
  }>,
): Promise<
  Readonly<{
    body: string;
    headers: Readonly<Record<string, string | string[] | undefined>>;
    status: number;
  }>
> {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest(url, options, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () =>
        resolveRequest({
          body: Buffer.concat(chunks).toString("utf8"),
          headers: response.headers,
          status: response.statusCode ?? 0,
        }),
      );
    });
    request.once("error", rejectRequest);
    request.end();
  });
}

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
