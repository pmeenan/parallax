import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fixedRemoteIdentityCommand,
  readFixedRemoteModelIdentity,
  verifyModelSourceResource,
} from "./model-source-verification.js";

const bytes = 123;
const sha256 = "a".repeat(64);
const url = `https://parallax-web.com/immutable/model-${sha256}.gguf`;
const etag = '"exact-etag"';
const remote = {
  bytes,
  gid: 1000,
  mode: "644" as const,
  path: `/var/www/parallax-web.com/immutable/model-${sha256}.gguf`,
  sha256,
  symlink: false as const,
  type: "regular-file" as const,
  uid: 1000,
};

afterEach(() => vi.unstubAllGlobals());

describe("bounded model source verifier", () => {
  it("checks all five response kinds, accepts nginx-shaped 416, and cancels stale 200", async () => {
    const calls: RequestInit[] = [];
    const fixture = successfulFetch();
    vi.stubGlobal("fetch", async (requestUrl: string, init: RequestInit) => {
      calls.push(init);
      return fixture.fetch(requestUrl, init);
    });

    const resource = await verifyModelSourceResource({
      bytes,
      id: "common-model-fixture",
      localSource: "production-model-content/fixture.gguf",
      remote,
      sha256,
      url,
    });
    expect(calls).toHaveLength(5);
    expect(fixture.staleCancelled()).toBe(true);
    expect(resource.requests.find((request) => request.kind === "if-range-stale")).toMatchObject({
      downloadedBytes: 0,
      headers: { cacheControl: "no-cache" },
      status: 200,
    });
    expect(
      resource.requests.find((request) => request.kind === "range-unsatisfiable"),
    ).toMatchObject({
      contentLength: 17,
      downloadedBytes: 17,
      etag: null,
      headers: {
        acceptRanges: null,
        contentType: "text/html",
        crossOriginEmbedderPolicy: null,
        crossOriginOpenerPolicy: "same-origin, same-origin",
        xContentTypeOptions: null,
      },
      status: 416,
    });
  });

  it("requires HEAD to advertise byte ranges", async () => {
    const fixture = successfulFetch({ headAcceptRanges: null });
    vi.stubGlobal("fetch", fixture.fetch);
    await expect(verifyFixture()).rejects.toThrow(/head headers mismatch/);
  });

  it("rejects bad partial-response Accept-Ranges but permits omission", async () => {
    const bad = successfulFetch({ partialAcceptRanges: "none" });
    vi.stubGlobal("fetch", bad.fetch);
    await expect(verifyFixture()).rejects.toThrow(/range-0-0 headers mismatch/);
    vi.unstubAllGlobals();

    const omitted = successfulFetch({ partialAcceptRanges: null });
    vi.stubGlobal("fetch", omitted.fetch);
    await expect(verifyFixture()).resolves.toBeDefined();
  });

  it("evaluates cache directives semantically across the response matrix", async () => {
    const cases = [
      { expected: true, policy: "no-cache", value: "no-cache" },
      { expected: true, policy: "no-cache", value: " NO-CACHE, no-cache " },
      { expected: false, policy: "no-cache", value: "no-cache, immutable" },
      { expected: false, policy: "no-cache", value: "no-cache," },
      {
        expected: true,
        policy: "immutable",
        value: "immutable, PUBLIC, max-age=31536000, public",
      },
      {
        expected: false,
        policy: "immutable",
        value: "public, max-age=31536000",
      },
      {
        expected: false,
        policy: "immutable",
        value: "public, max-age=0, immutable",
      },
    ] as const;
    for (const testCase of cases) {
      const fixture = successfulFetch(
        testCase.policy === "immutable"
          ? { headCacheControl: testCase.value }
          : { partialCacheControl: testCase.value },
      );
      vi.stubGlobal("fetch", fixture.fetch);
      if (testCase.expected) await expect(verifyFixture(), testCase.value).resolves.toBeDefined();
      else await expect(verifyFixture(), testCase.value).rejects.toThrow(/cache-control mismatch/);
      vi.unstubAllGlobals();
    }
  });

  it("fails before reading a malformed encoded response", async () => {
    let cancelled = false;
    vi.stubGlobal("fetch", async () => {
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
      });
      const response = new Response(body, {
        headers: {
          "accept-ranges": "bytes",
          "cache-control": "public, max-age=31536000, immutable",
          "content-encoding": "gzip",
          "content-length": String(bytes),
          "content-type": "application/octet-stream",
          "cross-origin-embedder-policy": "require-corp",
          "cross-origin-opener-policy": "same-origin",
          etag,
          "x-content-type-options": "nosniff",
        },
        status: 200,
      });
      Object.defineProperty(response, "url", { value: url });
      return response;
    });
    await expect(
      verifyModelSourceResource({
        bytes,
        id: "common-model-fixture",
        localSource: "production-model-content/fixture.gguf",
        remote,
        sha256,
        url,
      }),
    ).rejects.toThrow(/headers mismatch/);
    expect(cancelled).toBe(true);
  });
});

function verifyFixture() {
  return verifyModelSourceResource({
    bytes,
    id: "common-model-fixture",
    localSource: "production-model-content/fixture.gguf",
    remote,
    sha256,
    url,
  });
}

function successfulFetch(
  options: Readonly<{
    headAcceptRanges?: string | null;
    headCacheControl?: string;
    partialAcceptRanges?: string | null;
    partialCacheControl?: string;
    staleCacheControl?: string;
    unsatisfiableCacheControl?: string;
  }> = {},
) {
  let cancelled = false;
  return {
    fetch: async (_url: string | URL | Request, init: RequestInit = {}) => {
      const requestHeaders = new Headers(init.headers);
      const range = requestHeaders.get("range");
      const ifRange = requestHeaders.get("if-range");
      let response: Response;
      if (init.method === "HEAD") {
        const headers = successfulHeaders(
          options.headCacheControl ?? "public, max-age=31536000, immutable",
        );
        setNullable(headers, "accept-ranges", options.headAcceptRanges, "bytes");
        headers.set("content-length", String(bytes));
        response = new Response(null, { headers, status: 200 });
      } else if (range === `bytes=${bytes}-${bytes}`) {
        const body = new TextEncoder().encode("nginx range error");
        response = new Response(body, {
          headers: {
            "cache-control": options.unsatisfiableCacheControl ?? "no-cache",
            "content-length": String(body.byteLength),
            "content-range": `bytes */${bytes}`,
            "content-type": "text/html",
            "cross-origin-opener-policy": "same-origin, same-origin",
          },
          status: 416,
        });
      } else if (ifRange === '"parallax-stale-validator"') {
        const headers = successfulHeaders(options.staleCacheControl ?? "no-cache");
        headers.set("content-length", String(bytes));
        const body = new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
          pull(controller) {
            controller.enqueue(new Uint8Array(1024 * 1024));
          },
        });
        response = new Response(body, { headers, status: 200 });
      } else {
        const headers = successfulHeaders(options.partialCacheControl ?? "no-cache");
        setNullable(headers, "accept-ranges", options.partialAcceptRanges, "bytes");
        headers.set("content-length", "1");
        headers.set("content-range", `bytes 0-0/${bytes}`);
        response = new Response(new Uint8Array([7]), { headers, status: 206 });
      }
      Object.defineProperty(response, "url", { value: url });
      return response;
    },
    staleCancelled: () => cancelled,
  };
}

function successfulHeaders(cacheControl: string): Headers {
  return new Headers({
    "accept-ranges": "bytes",
    "cache-control": cacheControl,
    "content-type": "application/octet-stream",
    "cross-origin-embedder-policy": "require-corp",
    "cross-origin-opener-policy": "same-origin",
    etag,
    "x-content-type-options": "nosniff",
  });
}

function setNullable(
  headers: Headers,
  name: string,
  value: string | null | undefined,
  defaultValue: string,
): void {
  if (value === null) headers.delete(name);
  else headers.set(name, value ?? defaultValue);
}

describe("fixed-target SSH model identity", () => {
  it("uses only ssh.exe, plex, and the exact immutable five-file inventory", async () => {
    let observedExecutable = "";
    let observedArguments: readonly string[] = [];
    const identity = await readFixedRemoteModelIdentity(async (executable, arguments_) => {
      observedExecutable = executable;
      observedArguments = arguments_;
      return { stdout: fixedIdentityOutput() };
    });
    expect(observedExecutable).toBe("ssh.exe");
    expect(observedArguments[0]).toBe("plex");
    expect(observedArguments).toHaveLength(2);
    expect(observedArguments[1]).toBe(fixedRemoteIdentityCommand());
    expect(observedArguments[1]).toContain("w=/var/www/parallax-web.com");
    expect(observedArguments[1]).toContain("d=/var/www/parallax-web.com/immutable");
    expect(observedArguments[1]).toContain("-name 'model-*.gguf'");
    expect(observedArguments[1]).toContain('test "$actual" = "$expected"');
    expect(observedArguments[1]?.match(/sha256sum/g)).toHaveLength(5);
    expect(identity.resources.size).toBe(5);
    expect(identity.root).toEqual({
      gid: 1000,
      host: "plex",
      immutableMode: "755",
      immutablePath: "/var/www/parallax-web.com/immutable",
      uid: 1000,
      webRoot: "/var/www/parallax-web.com",
      webRootMode: "755",
    });
  });

  it("fails closed on remote ownership, mode, hash, or inventory drift", async () => {
    const mutations = [
      (text: string) => text.replace("DIRECTORY 1000 1000 755", "DIRECTORY 1001 1000 755"),
      (text: string) => text.replace(/ 1000 1000 644\r?\n/, " 1000 1000 664\n"),
      (text: string) =>
        text.replace(
          "ff074d7cae3cbda06f7a32b6d42c206bf88c2bee84c9d6165a0937ec2b61958d 1000",
          `${"0".repeat(64)} 1000`,
        ),
      (text: string) => text.split(/\r?\n/).slice(0, -2).join("\n"),
    ];
    for (const mutate of mutations) {
      await expect(
        readFixedRemoteModelIdentity(async () => ({ stdout: mutate(fixedIdentityOutput()) })),
      ).rejects.toThrow();
    }
  });
});

function fixedIdentityOutput(): string {
  const files = [
    ["ff074d7cae3cbda06f7a32b6d42c206bf88c2bee84c9d6165a0937ec2b61958d", 23_532_320],
    ["1c5368744032e95ba212561c1985cd8017de6fd165fef1f648528e0be265d4a8", 1_321_205_952],
    ["f8c3b5b6f05090ef292ed643357fed6b1df5381d0a21e11d3515580af3ef48f3", 508_734_272],
    ["ca3403a90060fc56b92e6b35acb0090eebb8b7eb11c4919536ba645f4d45c461", 510_543_744],
    ["30c5c95b427827e9f1993f7df2e4d6cbdea2354811ab5dcafd6db41190cfb9f9", 256_355_264],
  ] as const;
  return [
    "ROOT 1000 1000 755",
    "DIRECTORY 1000 1000 755",
    ...files.map(
      ([hash, fileBytes]) => `FILE model-${hash}.gguf ${fileBytes} ${hash} 1000 1000 644`,
    ),
    "",
  ].join("\n");
}
