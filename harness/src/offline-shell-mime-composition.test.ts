import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  initialOfflineShellStoreRecord,
  type OfflineShellFetchedResource,
  type OfflineShellStorePlatform,
  type OfflineShellStoreRecord,
  prepareAndActivateOfflineShellGeneration,
} from "@parallax/engine";
import { afterEach, describe, expect, it } from "vitest";
import { readAndValidateBuildManifest } from "./build-manifest.js";
import { createLocalServer, listenLocalServer, stopLocalServer } from "./server.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const buildRoot = resolve(repositoryRoot, "dist");
const servers: import("node:http").Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => stopLocalServer(server)));
});

describe("built offline-shell MIME composition", () => {
  it("prepares the exact built generation through ordinary local transport", async () => {
    const build = await readAndValidateBuildManifest(buildRoot);
    const server = createLocalServer({
      exactRangeResources: build.installManifest.resources,
      root: buildRoot,
    });
    servers.push(server);
    const address = await listenLocalServer(server);
    const origin = `http://127.0.0.1:${address.port}`;
    const platform = new HttpCompositionPlatform(origin);
    const app = build.installManifest.resources.find(
      (resource) => resource.id === "app-shell-module-app",
    );
    if (app === undefined) throw new Error("Built install manifest has no app shell module");

    const generation = await prepareAndActivateOfflineShellGeneration(platform, app.source);

    expect(generation.artifactDigest).toBe(build.artifactDigest);
    expect(generation.releaseDigest).toBe(build.releaseDigest);
    const javaScriptResources = generation.resources.filter((resource) =>
      resource.path.endsWith(".js"),
    );
    expect(javaScriptResources.length).toBeGreaterThanOrEqual(3);
    expect(
      javaScriptResources.every((resource) => resource.mimeType === "application/javascript"),
    ).toBe(true);
    for (const resource of javaScriptResources) {
      const response = await fetch(`${origin}/${resource.path}`);
      expect(response.headers.get("content-type")).toBe("application/javascript");
    }
  });

  it("reproduces the retained v2 first-module failure under the former local MIME", async () => {
    const build = await readAndValidateBuildManifest(buildRoot);
    const app = build.installManifest.resources.find(
      (resource) => resource.id === "app-shell-module-app",
    );
    if (app === undefined) throw new Error("Built install manifest has no app shell module");
    const platform = new HttpCompositionPlatform("http://127.0.0.1:1");
    platform.fetchOverride = async (path) => {
      const file = await readFile(resolve(buildRoot, path));
      return response(
        `http://127.0.0.1:1/${path}`,
        file,
        path.endsWith(".js") ? "text/javascript; charset=utf-8" : mime(path),
        path.startsWith("immutable/") ? "public, max-age=31536000, immutable" : "no-cache",
      );
    };

    await expect(
      prepareAndActivateOfflineShellGeneration(platform, app.source),
    ).rejects.toMatchObject({ code: "shell-contract" });
    expect(platform.fetches.slice(0, 3)).toEqual([
      "build-manifest.json",
      "install-manifest.json",
      app.source,
    ]);
  });
});

class HttpCompositionPlatform implements OfflineShellStorePlatform {
  public readonly caches = new Map<string, Map<string, OfflineShellFetchedResource>>();
  public fetchOverride: ((path: string) => Promise<OfflineShellFetchedResource>) | null = null;
  public readonly fetches: string[] = [];
  public readonly origin: string;
  private record = initialOfflineShellStoreRecord();

  public collectGenerations(retainedGenerationIds: ReadonlySet<string>): Promise<void> {
    for (const generationId of [...this.caches.keys()]) {
      if (!retainedGenerationIds.has(generationId)) this.caches.delete(generationId);
    }
    return Promise.resolve();
  }
  private clock = 0;

  public constructor(origin: string) {
    this.origin = origin;
  }

  public deleteGeneration(generationId: string): Promise<void> {
    this.caches.delete(generationId);
    return Promise.resolve();
  }

  public async fetch(path: string): Promise<OfflineShellFetchedResource> {
    this.fetches.push(path);
    if (this.fetchOverride !== null) return this.fetchOverride(path);
    const fetched = await fetch(`${this.origin}/${path}`, { cache: "reload", redirect: "error" });
    return Object.freeze({
      bytes: new Uint8Array(await fetched.arrayBuffer()),
      headers: Object.freeze(Object.fromEntries(fetched.headers)),
      status: fetched.status,
      url: fetched.url,
    });
  }

  public match(generationId: string, path: string): Promise<OfflineShellFetchedResource | null> {
    return Promise.resolve(this.caches.get(generationId)?.get(path) ?? null);
  }

  public now(): number {
    this.clock += 1;
    return this.clock;
  }

  public put(
    generationId: string,
    path: string,
    fetched: OfflineShellFetchedResource,
  ): Promise<void> {
    const cache = this.caches.get(generationId) ?? new Map();
    cache.set(path, fetched);
    this.caches.set(generationId, cache);
    return Promise.resolve();
  }

  public readRecord(): Promise<OfflineShellStoreRecord> {
    return Promise.resolve(this.record);
  }

  public runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    return operation();
  }

  public runPrepareExclusive<T>(operation: () => Promise<T>): Promise<T> {
    return operation();
  }

  public updateRecord(
    update: (record: OfflineShellStoreRecord) => OfflineShellStoreRecord,
  ): Promise<OfflineShellStoreRecord> {
    this.record = update(this.record);
    return Promise.resolve(this.record);
  }

  public writeRecord(record: OfflineShellStoreRecord): Promise<void> {
    this.record = record;
    return Promise.resolve();
  }
}

function response(
  url: string,
  bytes: Uint8Array,
  contentType: string,
  cacheControl: string,
): OfflineShellFetchedResource {
  return Object.freeze({
    bytes,
    headers: Object.freeze({
      "cache-control": cacheControl,
      "content-type": contentType,
      "cross-origin-embedder-policy": "require-corp",
      "cross-origin-opener-policy": "same-origin",
      "x-content-type-options": "nosniff",
    }),
    status: 200,
    url,
  });
}

function mime(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}
