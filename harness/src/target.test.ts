import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuildManifest, ManifestArtifact } from "./build-manifest.js";
import { LocalServerCallbackError } from "./server.js";
import {
  assertHarnessNavigationUrl,
  captureTargetPostflight,
  captureTargetPostflightOnce,
  failedTargetEvidence,
  formatTargetVerificationEvidence,
  harnessRuntimeUrl,
  PRODUCTION_ORIGIN,
  parseHarnessTargetArguments,
  pendingTargetPostflightCapture,
  reconcileTargetPostflight,
  startHarnessTarget,
  TARGET_BODY_TIMEOUT_MS,
  TARGET_HEADER_TIMEOUT_MS,
  validateHarnessTargetEvidence,
  validateHarnessTargetIdentity,
  verifiedTargetEvidence,
} from "./target.js";

const cleanup: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("harness target selection and identity", () => {
  it("makes local target stop fail closed on response callback errors", async () => {
    const fixture = await localBuildFixture();
    const target = await startHarnessTarget({
      artifactDigest: fixture.artifactDigest,
      buildManifest: fixture.manifest,
      buildRoot: fixture.root,
      onLocalResponse: () => {
        throw new Error("target response collection failed");
      },
      request: "local",
    });

    await expect(target.stop()).rejects.toBeInstanceOf(LocalServerCallbackError);
    await expect(target.stop()).rejects.toBeInstanceOf(LocalServerCallbackError);
  });

  it("adds the exact runtime automation route without discarding scenario parameters", () => {
    expect(harnessRuntimeUrl("https://parallax-web.com")).toBe(
      "https://parallax-web.com/?parallaxAutomation=runtime",
    );
    expect(harnessRuntimeUrl("http://127.0.0.1:8080/?scenario=smoke")).toBe(
      "http://127.0.0.1:8080/?scenario=smoke&parallaxAutomation=runtime",
    );
  });

  it("keeps local as the default and rejects unsupported target spellings", () => {
    expect(parseHarnessTargetArguments(["--include-v8-code-cache"])).toEqual({
      remainingArguments: ["--include-v8-code-cache"],
      request: "local",
    });
    expect(
      parseHarnessTargetArguments(["--target", PRODUCTION_ORIGIN, "--include-v8-code-cache"]),
    ).toEqual({
      remainingArguments: ["--include-v8-code-cache"],
      request: PRODUCTION_ORIGIN,
    });
    for (const arguments_ of [
      ["--target"],
      ["--target", "production"],
      ["--target", "http://parallax-web.com"],
      ["--target", "https://www.parallax-web.com"],
      ["--target", PRODUCTION_ORIGIN, "--target", "local"],
    ]) {
      expect(() => parseHarnessTargetArguments(arguments_)).toThrow();
    }
  });

  it("fully verifies every local artifact and summarizes all representation classes", async () => {
    const fixture = await localBuildFixture();
    const responsePaths: string[] = [];
    const target = await startHarnessTarget({
      artifactDigest: fixture.artifactDigest,
      buildManifest: fixture.manifest,
      buildRoot: fixture.root,
      localHostname: "localhost",
      onLocalResponse: ({ path }) => responsePaths.push(path),
      request: "local",
    });
    try {
      expect(target.identity).toMatchObject({
        artifactDigest: fixture.artifactDigest,
        artifactDigestVerified: true,
        kind: "local",
        localServerStarted: true,
        servingContract: {
          artifactCount: 8,
          conditionalArtifactCount: 8,
          documentConditionalStatus: 304,
          documentMimeType: "text/html; charset=utf-8",
          isolation: "coop-coep",
          nosniff: true,
        },
      });
      expect(
        target.identity.servingContract.representations.map((entry) => entry.representation),
      ).toEqual(["html", "javascript", "json", "ktx2", "meshopt", "wasm"]);
      expect(responsePaths).toContain("/build-manifest.json");
      expect(target.baseUrl).toMatch(/^http:\/\/localhost:\d+$/u);
      expect(() => validateHarnessTargetIdentity(target.identity)).not.toThrow();
      expect(() =>
        validateHarnessTargetEvidence(verifiedTargetEvidence(target.identity)),
      ).not.toThrow();
      expect(await target.revalidate()).toEqual(target.identity);
    } finally {
      await target.stop();
    }
  });

  it("passes an exact bounded file-backed Range inventory to the local target server", async () => {
    const fixture = await localBuildFixture();
    const artifact = fixture.manifest.artifacts.find(({ path }) => path.endsWith(".wasm"));
    if (artifact === undefined) throw new Error("Local target fixture has no Range artifact");
    const target = await startHarnessTarget({
      artifactDigest: fixture.artifactDigest,
      buildManifest: fixture.manifest,
      buildRoot: fixture.root,
      exactRangeResources: [
        { bytes: artifact.bytes, sha256: artifact.sha256, source: artifact.path },
      ],
      request: "local",
    });
    try {
      const response = await fetch(`${target.baseUrl}/${artifact.path}`, {
        headers: { Range: "bytes=0-0" },
      });
      expect(response.status).toBe(206);
      expect(response.headers.get("accept-ranges")).toBe("bytes");
      expect(response.headers.get("content-range")).toBe(`bytes 0-0/${artifact.bytes}`);
      expect(response.headers.get("etag")).toBe(`"sha256-${artifact.sha256}"`);
      expect((await response.arrayBuffer()).byteLength).toBe(1);
    } finally {
      await target.stop();
    }
  });

  it("requires every install-only file to have one identical exact Range binding", async () => {
    const fixture = await localBuildFixture();
    const artifact = fixture.manifest.artifacts.find(({ path }) => path.endsWith(".wasm"));
    if (artifact === undefined) throw new Error("Local target fixture has no exact artifact");
    await expect(
      startHarnessTarget({
        artifactDigest: fixture.artifactDigest,
        buildManifest: fixture.manifest,
        buildRoot: fixture.root,
        exactRangeResources: [],
        installOnlyFiles: [
          { bytes: artifact.bytes, sha256: artifact.sha256, source: artifact.path },
        ],
        request: "local",
      }),
    ).rejects.toThrow(/lacks one exact Range binding/u);
  });

  it("uses the fixed production origin and verifies every public artifact without localhost", async () => {
    const fixture = await localBuildFixture();
    const requests: string[] = [];
    vi.stubGlobal("fetch", productionFetch(fixture, requests));
    const target = await startHarnessTarget({
      artifactDigest: fixture.artifactDigest,
      buildManifest: fixture.manifest,
      buildRoot: fixture.root,
      request: PRODUCTION_ORIGIN,
    });
    expect(target.identity).toMatchObject({
      kind: "production",
      localServerStarted: false,
      origin: PRODUCTION_ORIGIN,
      servingContract: { artifactCount: 8, conditionalArtifactCount: 8 },
    });
    expect(target.localServerMetricsAvailable).toBe(false);
    expect(target.probeUrl).toBe(`${PRODUCTION_ORIGIN}/`);
    expect(new Set(requests)).toEqual(
      new Set([
        `${PRODUCTION_ORIGIN}/`,
        `${PRODUCTION_ORIGIN}/build-manifest.json`,
        ...fixture.manifest.artifacts
          .filter((artifact) => artifact.path !== "index.html")
          .map((artifact) => `${PRODUCTION_ORIGIN}/${artifact.path}`),
      ]),
    );
    await target.stop();
  });

  it("rejects a browser-valid JavaScript MIME alias outside the project contract", async () => {
    const fixture = await localBuildFixture();
    vi.stubGlobal(
      "fetch",
      productionFetch(fixture, [], {
        javascriptContentType: "text/javascript; charset=utf-8",
      }),
    );
    await expect(
      startHarnessTarget({
        artifactDigest: fixture.artifactDigest,
        buildManifest: fixture.manifest,
        buildRoot: fixture.root,
        request: PRODUCTION_ORIGIN,
      }),
    ).rejects.toThrow(/expected MIME application\/javascript, received text\/javascript/);
  });

  it.each([
    ["ktx2", "application/octet-stream", /expected MIME image\/ktx2/u],
    ["meshopt", "image/ktx2", /expected MIME application\/octet-stream/u],
  ] as const)("rejects the wrong %s representation MIME", async (kind, mime, expected) => {
    const fixture = await localBuildFixture();
    vi.stubGlobal(
      "fetch",
      productionFetch(fixture, [], {
        ...(kind === "ktx2" ? { ktx2ContentType: mime } : { meshoptContentType: mime }),
      }),
    );
    await expect(
      startHarnessTarget({
        artifactDigest: fixture.artifactDigest,
        buildManifest: fixture.manifest,
        buildRoot: fixture.root,
        request: PRODUCTION_ORIGIN,
      }),
    ).rejects.toThrow(expected);
  });

  it("rejects an unregistered manifest artifact extension", async () => {
    const fixture = await localBuildFixture();
    const artifact = fixture.manifest.artifacts.find(({ path }) => path.endsWith(".meshopt"));
    if (artifact === undefined) throw new Error("Local target fixture has no meshopt artifact");
    const artifactBody = fixture.bodies.get(artifact.path);
    if (artifactBody === undefined) throw new Error("Local target meshopt body is absent");
    const unknownPath = artifact.path.replace(/\.meshopt$/u, ".unknown");
    await writeFile(join(fixture.root, unknownPath), artifactBody);
    const manifest = {
      ...fixture.manifest,
      artifacts: fixture.manifest.artifacts.map((candidate) =>
        candidate.path === artifact.path ? { ...candidate, path: unknownPath } : candidate,
      ),
    } as BuildManifest;
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(fixture.root, "build-manifest.json"), manifestBytes);
    await expect(
      startHarnessTarget({
        artifactDigest: sha256(manifestBytes),
        buildManifest: manifest,
        buildRoot: fixture.root,
        request: "local",
      }),
    ).rejects.toThrow(/No serving-contract MIME is registered/u);
  });

  it("forces identity encoding on every exact 200 and conditional 304 request", async () => {
    const fixture = await localBuildFixture();
    const requests: string[] = [];
    const acceptEncodings: string[] = [];
    vi.stubGlobal(
      "fetch",
      productionFetch(fixture, requests, {
        acceptEncodings,
        weakenEtagWithoutIdentity: true,
      }),
    );
    const target = await startHarnessTarget({
      artifactDigest: fixture.artifactDigest,
      buildManifest: fixture.manifest,
      buildRoot: fixture.root,
      request: PRODUCTION_ORIGIN,
    });
    expect(acceptEncodings).toHaveLength(2 * (fixture.manifest.artifacts.length + 1));
    expect(new Set(acceptEncodings)).toEqual(new Set(["identity"]));
    expect(requests).toHaveLength(acceptEncodings.length);
    await target.stop();
  });

  it("rejects redirects, contradictory identity, and forged navigation identity", async () => {
    const fixture = await localBuildFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { headers: servingHeaders("no-cache"), status: 302 })),
    );
    await expect(
      startHarnessTarget({
        artifactDigest: fixture.artifactDigest,
        buildManifest: fixture.manifest,
        buildRoot: fixture.root,
        request: PRODUCTION_ORIGIN,
      }),
    ).rejects.toThrow(/expected HTTP 200/);
    expect(() =>
      assertHarnessNavigationUrl("https://www.parallax-web.com/", `${PRODUCTION_ORIGIN}/`, "app"),
    ).toThrow(/expected exact target/);

    vi.unstubAllGlobals();
    const target = await startHarnessTarget({
      artifactDigest: fixture.artifactDigest,
      buildManifest: fixture.manifest,
      buildRoot: fixture.root,
      request: "local",
    });
    try {
      expect(() =>
        validateHarnessTargetIdentity({ ...target.identity, kind: "production" }),
      ).toThrow("kind/origin is contradictory");
      expect(() => validateHarnessTargetEvidence({ reason: "", state: "failed" })).toThrow(
        "failure is invalid",
      );
      expect(() =>
        validateHarnessTargetEvidence(failedTargetEvidence("postflight stalled")),
      ).not.toThrow();
    } finally {
      await target.stop();
    }
  });
});

describe("bounded target requests and strict cache policy", () => {
  it("times out stalled response headers", async () => {
    const fixture = await localBuildFixture();
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
              once: true,
            });
          }),
      ),
    );
    const pending = startHarnessTarget({
      artifactDigest: fixture.artifactDigest,
      buildManifest: fixture.manifest,
      buildRoot: fixture.root,
      request: PRODUCTION_ORIGIN,
    });
    const expectation = expect(pending).rejects.toThrow(/headers timed out/);
    await vi.advanceTimersByTimeAsync(TARGET_HEADER_TIMEOUT_MS);
    await expectation;
  });

  it("times out a stalled response body", async () => {
    const fixture = await localBuildFixture();
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: unknown, init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), {
              once: true,
            });
          },
        });
        return Promise.resolve(
          new Response(body, {
            headers: {
              ...servingHeaders("no-cache"),
              "Content-Type": "application/json",
              ETag: '"stall"',
            },
            status: 200,
          }),
        );
      }),
    );
    const pending = startHarnessTarget({
      artifactDigest: fixture.artifactDigest,
      buildManifest: fixture.manifest,
      buildRoot: fixture.root,
      request: PRODUCTION_ORIGIN,
    });
    const expectation = expect(pending).rejects.toThrow(/body timed out/);
    await vi.advanceTimersByTimeAsync(TARGET_BODY_TIMEOUT_MS);
    await expectation;
  });

  it("converts a postflight verifier failure into explicit retained evidence", async () => {
    await expect(
      captureTargetPostflight(async () => {
        throw new Error("postflight response body timed out");
      }),
    ).resolves.toEqual({
      reason: "postflight response body timed out",
      state: "failed",
    });
  });

  it("converts a still-valid changed postflight identity into explicit drift evidence", async () => {
    const fixture = await localBuildFixture();
    const target = await startHarnessTarget({
      artifactDigest: fixture.artifactDigest,
      buildManifest: fixture.manifest,
      buildRoot: fixture.root,
      request: "local",
    });
    try {
      const changedIdentity = {
        ...target.identity,
        servingContract: {
          ...target.identity.servingContract,
          documentCacheControl: "no-cache, must-revalidate",
        },
      };
      expect(() => validateHarnessTargetIdentity(changedIdentity)).not.toThrow();
      const evidence = reconcileTargetPostflight(
        target.identity,
        verifiedTargetEvidence(changedIdentity),
      );
      expect(evidence).toEqual({
        reason: "Serving target identity changed between preflight and postflight verification",
        state: "failed",
      });
      expect(formatTargetVerificationEvidence(evidence)).toBe(
        "failed — Serving target identity changed between preflight and postflight verification",
      );
    } finally {
      await target.stop();
    }
  });

  it("retains the first failed postflight and never revalidates a second time", async () => {
    const fixture = await localBuildFixture();
    const target = await startHarnessTarget({
      artifactDigest: fixture.artifactDigest,
      buildManifest: fixture.manifest,
      buildRoot: fixture.root,
      request: "local",
    });
    try {
      let revalidations = 0;
      const revalidate = async () => {
        revalidations += 1;
        if (revalidations === 1) throw new Error("first postflight failed");
        return target.identity;
      };
      const failed = await captureTargetPostflightOnce(
        target.identity,
        pendingTargetPostflightCapture(),
        revalidate,
      );
      const retained = await captureTargetPostflightOnce(target.identity, failed, revalidate);
      expect(retained).toBe(failed);
      expect(retained).toMatchObject({
        attempted: true,
        evidence: { reason: "first postflight failed", state: "failed" },
      });
      expect(revalidations).toBe(1);
    } finally {
      await target.stop();
    }
  });

  it.each([
    "no-cache, no-cache",
    "no-cache, private",
    "no-cache, no-store",
    "no-cache, immutable",
    "no-cache, max-age=60",
    "no-cache,, must-revalidate",
    'no-cache, max-age="0"',
  ])("rejects malformed or conflicting mutable Cache-Control: %s", async (cacheControl) => {
    const fixture = await localBuildFixture();
    vi.stubGlobal("fetch", productionFetch(fixture, [], { manifestCacheControl: cacheControl }));
    await expect(
      startHarnessTarget({
        artifactDigest: fixture.artifactDigest,
        buildManifest: fixture.manifest,
        buildRoot: fixture.root,
        request: PRODUCTION_ORIGIN,
      }),
    ).rejects.toThrow(/Cache-Control/);
  });

  it.each([
    "public, max-age=31536000, immutable, immutable",
    "public, max-age=60, immutable",
    "public, max-age=31536000, immutable, no-cache",
    "public, max-age=31536000, immutable, private",
    "public, max-age=31536000, immutable, no-store",
  ])("rejects malformed or conflicting immutable Cache-Control: %s", async (cacheControl) => {
    const fixture = await localBuildFixture();
    vi.stubGlobal("fetch", productionFetch(fixture, [], { immutableCacheControl: cacheControl }));
    await expect(
      startHarnessTarget({
        artifactDigest: fixture.artifactDigest,
        buildManifest: fixture.manifest,
        buildRoot: fixture.root,
        request: PRODUCTION_ORIGIN,
      }),
    ).rejects.toThrow(/Cache-Control/);
  });
});

interface BuildFixture {
  readonly artifactDigest: string;
  readonly bodies: ReadonlyMap<string, Buffer>;
  readonly manifest: BuildManifest;
  readonly manifestBytes: Buffer;
  readonly root: string;
}

async function localBuildFixture(): Promise<BuildFixture> {
  const root = await mkdtemp(join(tmpdir(), "parallax-target-"));
  cleanup.push(root);
  const sources = new Map<string, Buffer>([
    ["index.html", Buffer.from("<!doctype html><title>fixture</title>")],
    ["service-worker.js", Buffer.from("export const serviceWorker = true;\n")],
    ["immutable/app.js", Buffer.from("export const fixture = true;\n")],
    ["immutable/data.json", Buffer.from('{"fixture":true}\n')],
    ["immutable/texture.ktx2", Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32])],
    ["immutable/geometry.meshopt", Buffer.from([0x4d, 0x45, 0x53, 0x48])],
    ["immutable/module.wasm", Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])],
  ]);
  const artifacts: ManifestArtifact[] = [];
  const bodies = new Map<string, Buffer>();
  for (const [sourcePath, body] of sources) {
    const digest = sha256(body);
    const extension = sourcePath.slice(sourcePath.lastIndexOf("."));
    const path =
      sourcePath === "index.html" || sourcePath === "service-worker.js"
        ? sourcePath
        : `${sourcePath.slice(0, sourcePath.lastIndexOf("."))}-${digest}${extension}`;
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), body);
    artifacts.push({ bytes: body.byteLength, path, sha256: digest });
    bodies.set(path, body);
  }
  const installManifestBytes = Buffer.from(
    '{"gameId":"parallax","resources":[],"schemaVersion":1}\n',
  );
  const installManifestArtifact = {
    bytes: installManifestBytes.byteLength,
    path: "install-manifest.json",
    sha256: sha256(installManifestBytes),
  };
  await writeFile(join(root, installManifestArtifact.path), installManifestBytes);
  artifacts.push(installManifestArtifact);
  bodies.set(installManifestArtifact.path, installManifestBytes);
  const manifest = {
    artifacts,
    gameContentEntrypoints: [],
    installManifestEntrypoint: { path: "install-manifest.json", schemaVersion: 1 },
    offlineShell: {
      generationSchemaVersion: 1,
      saveSchemaVersion: 1,
      serviceWorkerPath: "service-worker.js",
    },
    schemaVersion: 15,
    workerEntrypoints: [],
  } as unknown as BuildManifest;
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(root, "build-manifest.json"), manifestBytes);
  return {
    artifactDigest: sha256(manifestBytes),
    bodies,
    manifest,
    manifestBytes,
    root,
  };
}

function productionFetch(
  fixture: BuildFixture,
  requests: string[],
  overrides: Readonly<{
    acceptEncodings?: string[];
    immutableCacheControl?: string;
    javascriptContentType?: string;
    ktx2ContentType?: string;
    manifestCacheControl?: string;
    meshoptContentType?: string;
    weakenEtagWithoutIdentity?: boolean;
  }> = {},
): typeof fetch {
  return vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push(url.href);
    const requestHeaders = new Headers(init?.headers);
    const acceptEncoding = requestHeaders.get("Accept-Encoding") ?? "";
    overrides.acceptEncodings?.push(acceptEncoding);
    const conditional = requestHeaders.has("If-None-Match");
    const etag = (value: string): string =>
      overrides.weakenEtagWithoutIdentity === true && acceptEncoding !== "identity"
        ? `W/${value}`
        : value;
    if (url.pathname === "/build-manifest.json") {
      return conditional
        ? response304(overrides.manifestCacheControl ?? "no-cache", '"manifest"')
        : new Response(Uint8Array.from(fixture.manifestBytes), {
            headers: {
              ...servingHeaders(overrides.manifestCacheControl ?? "no-cache"),
              "Content-Type": "application/json; charset=utf-8",
              ETag: etag('"manifest"'),
            },
            status: 200,
          });
    }
    const path = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const body = fixture.bodies.get(path);
    if (body === undefined)
      return new Response(null, { headers: servingHeaders("no-cache"), status: 404 });
    const immutable = path.startsWith("immutable/");
    const cacheControl = immutable
      ? (overrides.immutableCacheControl ?? "public, max-age=31536000, immutable")
      : "no-cache";
    if (conditional) return response304(cacheControl, `"${path}"`);
    return new Response(Uint8Array.from(body), {
      headers: {
        ...servingHeaders(cacheControl),
        "Content-Type":
          path.endsWith(".js") && overrides.javascriptContentType !== undefined
            ? overrides.javascriptContentType
            : path.endsWith(".ktx2") && overrides.ktx2ContentType !== undefined
              ? overrides.ktx2ContentType
              : path.endsWith(".meshopt") && overrides.meshoptContentType !== undefined
                ? overrides.meshoptContentType
                : contentType(path),
        ETag: etag(`"${path}"`),
      },
      status: 200,
    });
  }) as typeof fetch;
}

function response304(cacheControl: string, etag: string): Response {
  return new Response(null, {
    headers: { ...servingHeaders(cacheControl), ETag: etag },
    status: 304,
  });
}

function servingHeaders(cacheControl: string): Record<string, string> {
  return {
    "Cache-Control": cacheControl,
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Opener-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  };
}

function contentType(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".ktx2")) return "image/ktx2";
  if (path.endsWith(".meshopt")) return "application/octet-stream";
  return "application/wasm";
}

function sha256(bytes: NodeJS.ArrayBufferView): string {
  return createHash("sha256").update(bytes).digest("hex");
}
