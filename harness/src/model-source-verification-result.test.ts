import { describe, expect, it } from "vitest";
import { sanitizeModelSourceFailureText } from "./model-source-failure-sanitization.js";
import {
  formatModelSourceVerificationMarkdown,
  type ModelSourceVerificationPassed,
  validateModelSourceVerificationResult,
} from "./model-source-verification-result.js";

describe("model source verification result contract", () => {
  it("accepts exact five-resource evidence", () => {
    expect(() => validateModelSourceVerificationResult(fixture())).not.toThrow();
  });

  it("treats host-path-bearing schema v1 as historical-only", () => {
    const historical = fixture() as unknown as Record<string, unknown>;
    historical.schemaVersion = 1;
    expect(() => validateModelSourceVerificationResult(historical)).toThrow(
      /identity or base envelope/,
    );
  });

  it("rejects stale If-Range body consumption and URL/hash drift", () => {
    const consumed = fixture();
    const stale = consumed.resources[0]?.requests.find(
      (request) => request.kind === "if-range-stale",
    );
    if (stale === undefined) throw new Error("Fixture omitted stale If-Range evidence");
    stale.downloadedBytes = 1;
    expect(() => validateModelSourceVerificationResult(consumed)).toThrow(/if-range-stale/);

    const drift = fixture();
    const resource = drift.resources[0];
    if (resource === undefined) throw new Error("Fixture omitted resource");
    resource.url = "https://example.test/model.gguf";
    expect(() => validateModelSourceVerificationResult(drift)).toThrow(/resource identity/);
  });

  it("requires HEAD range advertisement and validates partial Accept-Ranges by kind", () => {
    const missingHeadAdvertisement = fixture();
    const head = missingHeadAdvertisement.resources[0]?.requests.find(
      (request) => request.kind === "head",
    );
    if (head === undefined) throw new Error("Fixture omitted HEAD evidence");
    head.headers.acceptRanges = null;
    expect(() => validateModelSourceVerificationResult(missingHeadAdvertisement)).toThrow(
      /head evidence/,
    );

    const badPartialAdvertisement = fixture();
    const range = badPartialAdvertisement.resources[0]?.requests.find(
      (request) => request.kind === "range-0-0",
    );
    if (range === undefined) throw new Error("Fixture omitted range evidence");
    Reflect.set(range.headers, "acceptRanges", "none");
    expect(() => validateModelSourceVerificationResult(badPartialAdvertisement)).toThrow(
      /range-0-0 evidence/,
    );

    const omittedPartialAdvertisement = fixture();
    const omitted = omittedPartialAdvertisement.resources[0]?.requests.find(
      (request) => request.kind === "range-0-0",
    );
    if (omitted === undefined) throw new Error("Fixture omitted range evidence");
    omitted.headers.acceptRanges = null;
    expect(() => validateModelSourceVerificationResult(omittedPartialAdvertisement)).not.toThrow();
  });

  it("accepts nginx-shaped 416 and repeated semantic no-cache directives", () => {
    const report = fixture();
    for (const resource of report.resources) {
      for (const request of resource.requests) {
        if (request.kind !== "head") request.headers.cacheControl = "no-cache, no-cache";
        if (request.kind === "range-unsatisfiable") {
          request.contentLength = 146;
          request.downloadedBytes = 146;
          request.etag = null;
          Reflect.set(request, "contentEncoding", "gzip");
          request.headers.acceptRanges = null;
          request.headers.contentType = "text/html";
          request.headers.crossOriginEmbedderPolicy = null;
          request.headers.crossOriginOpenerPolicy = "same-origin, same-origin";
          request.headers.xContentTypeOptions = null;
        }
      }
    }
    expect(() => validateModelSourceVerificationResult(report)).not.toThrow();

    const conflicting = fixture();
    const stale = conflicting.resources[0]?.requests.find(
      (request) => request.kind === "if-range-stale",
    );
    if (stale === undefined) throw new Error("Fixture omitted stale response");
    stale.headers.cacheControl = "no-cache, immutable";
    expect(() => validateModelSourceVerificationResult(conflicting)).toThrow(
      /if-range-stale evidence/,
    );
  });

  it("independently enforces the collector cache-policy behavior matrix", () => {
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
      const report = fixture();
      for (const resource of report.resources) {
        for (const request of resource.requests) {
          if ((request.kind === "head") === (testCase.policy === "immutable")) {
            request.headers.cacheControl = testCase.value;
          }
        }
      }
      if (testCase.expected) {
        expect(() => validateModelSourceVerificationResult(report), testCase.value).not.toThrow();
      } else {
        expect(() => validateModelSourceVerificationResult(report), testCase.value).toThrow(
          /evidence is invalid/,
        );
      }
    }
  });

  it("enforces exact pending and failed lifecycle envelopes", () => {
    const passed = fixture();
    const base = {
      artifactDigest: passed.artifactDigest,
      node: passed.node,
      releaseDigest: passed.releaseDigest,
      schemaVersion: 2,
      source: passed.source,
      startedAt: passed.startedAt,
    } as const;
    expect(() =>
      validateModelSourceVerificationResult({ ...base, state: "pending" }),
    ).not.toThrow();
    expect(() =>
      validateModelSourceVerificationResult({
        ...base,
        completedAt: passed.completedAt,
        state: "pending",
      }),
    ).toThrow(/state-specific keys/);
    const failed = {
      ...base,
      completedAt: passed.completedAt,
      failure: "remote SSH identity mismatch",
      state: "failed",
    } as const;
    expect(() => validateModelSourceVerificationResult(failed)).not.toThrow();
    expect(() => validateModelSourceVerificationResult({ ...failed, failure: " " })).toThrow(
      /honest failure/,
    );
    expect(() =>
      validateModelSourceVerificationResult({
        ...failed,
        failure: "could not read C:\\Users\\someone\\private\\model.gguf",
      }),
    ).toThrow(/honest failure/);
    expect(() =>
      validateModelSourceVerificationResult({
        ...failed,
        failure: `SSH failed for /home/someone/private/model.gguf at https://secret.example/model?token=abc ${"x".repeat(600)}`,
      }),
    ).toThrow(/honest failure/);
    for (const failure of [
      "connect to plex failed",
      "connect to model-cache failed",
      "connect to model-cache.internal failed",
      "model-cache.internal",
      "10.20.30.40",
      "https://model-cache.internal/private/model.gguf",
      "ssh://model-cache.internal/private/model.gguf",
      "GET https://model-cache.internal/private/model.gguf failed",
      "ssh deploy@plex:/var/private/model.gguf failed",
      "connect 10.20.30.40:8443 failed",
      "connect [fd00:1234::5]:8443 failed",
      "connect [fd00:1234::5] failed",
      "getaddrinfo ENOTFOUND model-cache",
      "dial tcp model-cache:8443",
      "ssh: model-cache: connection refused",
      "getaddrinfo ENOTFOUND model\u{e000}-cache",
      "ssh: model\u{e001}-cache: connection refused",
      "model\u{f0000}-cache.internal",
      "open /srv/private/model.gguf failed",
      "GET https://user:password@model-cache.internal/private/model.gguf?token=secret failed",
    ]) {
      expect(() => validateModelSourceVerificationResult({ ...failed, failure }), failure).toThrow(
        /honest failure/,
      );
      const sanitized = sanitizeModelSourceFailureText(failure);
      expect(sanitizeModelSourceFailureText(sanitized), failure).toBe(sanitized);
      expect(() =>
        validateModelSourceVerificationResult({ ...failed, failure: sanitized }),
      ).not.toThrow();
    }
    expect(() =>
      validateModelSourceVerificationResult({ ...failed, failure: "No such host is known" }),
    ).not.toThrow();
    expect(() =>
      validateModelSourceVerificationResult({
        ...failed,
        failure: `${"x".repeat(505)}<remote`,
      }),
    ).toThrow(/honest failure/);
    expect(() =>
      validateModelSourceVerificationResult({
        ...failed,
        node: { ...failed.node, executable: "C:\\tools\\node.exe" },
      }),
    ).toThrow(/identity or base envelope/);
    expect(() =>
      validateModelSourceVerificationResult({ ...failed, resources: passed.resources }),
    ).toThrow(/state-specific keys/);
  });

  it("binds SSH byte identity and produces state-honest Markdown", () => {
    const wrongMode = fixture();
    const first = wrongMode.resources[0];
    if (first === undefined) throw new Error("Fixture omitted resource");
    Reflect.set(first.remote, "mode", "664");
    expect(() => validateModelSourceVerificationResult(wrongMode)).toThrow(/resource identity/);

    const passed = fixture();
    const passedMarkdown = formatModelSourceVerificationMarkdown(
      passed as ModelSourceVerificationPassed,
    );
    expect(passedMarkdown).toContain("- State: `passed`");
    expect(passedMarkdown).toContain("Remote SSH root");
    expect(passedMarkdown).toContain("SSH byte identity");
    expect(passedMarkdown).not.toContain("- Failure:");
    expect(JSON.stringify(passed)).not.toMatch(/[A-Za-z]:[\\\\/](?:Users|home)[\\\\/]/i);

    const failed = {
      artifactDigest: passed.artifactDigest,
      completedAt: passed.completedAt,
      failure: "fixed-target SSH preflight failed",
      node: passed.node,
      releaseDigest: passed.releaseDigest,
      schemaVersion: 2 as const,
      source: passed.source,
      startedAt: passed.startedAt,
      state: "failed" as const,
    };
    const failedMarkdown = formatModelSourceVerificationMarkdown(failed);
    expect(failedMarkdown).toContain("- State: `failed`");
    expect(failedMarkdown).toContain("- Failure: fixed-target SSH preflight failed");
    expect(failedMarkdown).not.toContain("SSH byte identity");
  });
});

function fixture() {
  const etag = '"fixture"';
  const pinned = [
    ["ff074d7cae3cbda06f7a32b6d42c206bf88c2bee84c9d6165a0937ec2b61958d", 23_532_320, "00001"],
    ["1c5368744032e95ba212561c1985cd8017de6fd165fef1f648528e0be265d4a8", 1_321_205_952, "00002"],
    ["f8c3b5b6f05090ef292ed643357fed6b1df5381d0a21e11d3515580af3ef48f3", 508_734_272, "00003"],
    ["ca3403a90060fc56b92e6b35acb0090eebb8b7eb11c4919536ba645f4d45c461", 510_543_744, "00004"],
    ["30c5c95b427827e9f1993f7df2e4d6cbdea2354811ab5dcafd6db41190cfb9f9", 256_355_264, "00005"],
  ] as const;
  const headers = (cacheControl: string) => ({
    acceptRanges: "bytes" as const,
    cacheControl,
    contentType: "application/octet-stream" as const,
    crossOriginEmbedderPolicy: "require-corp" as const,
    crossOriginOpenerPolicy: "same-origin" as const,
    xContentTypeOptions: "nosniff" as const,
  });
  const resources = pinned.map(([resourceSha, bytes, ordinal]) => {
    const resourceUrl = `https://parallax-web.com/immutable/model-${resourceSha}.gguf`;
    const localName = `gemma-4-E2B-it-qat-UD-Q4_K_XL-split-${ordinal}-of-00005.gguf`;
    return {
      bytes,
      etag,
      id: `common-model-${localName.toLowerCase()}`,
      local: {
        bytes,
        sha256: resourceSha,
        source: `production-model-content/${localName}`,
      },
      remote: {
        bytes,
        gid: 1000,
        mode: "644" as "644",
        path: `/var/www/parallax-web.com/immutable/model-${resourceSha}.gguf`,
        sha256: resourceSha,
        symlink: false as false,
        type: "regular-file" as "regular-file",
        uid: 1000,
      },
      requests: [
        {
          contentLength: bytes,
          contentRange: null,
          contentEncoding: null,
          downloadedBytes: 0,
          etag,
          headers: headers("public, max-age=31536000, immutable"),
          kind: "head",
          status: 200,
          url: resourceUrl,
        },
        {
          contentLength: 1,
          contentRange: `bytes 0-0/${bytes}`,
          contentEncoding: null,
          downloadedBytes: 1,
          etag,
          headers: headers("no-cache"),
          kind: "if-range-match",
          status: 206,
          url: resourceUrl,
        },
        {
          contentLength: bytes,
          contentRange: null,
          contentEncoding: null,
          downloadedBytes: 0,
          etag,
          headers: headers("no-cache"),
          kind: "if-range-stale",
          status: 200,
          url: resourceUrl,
        },
        {
          contentLength: 1,
          contentRange: `bytes 0-0/${bytes}`,
          contentEncoding: null,
          downloadedBytes: 1,
          etag,
          headers: headers("no-cache"),
          kind: "range-0-0",
          status: 206,
          url: resourceUrl,
        },
        {
          contentLength: 146,
          contentRange: `bytes */${bytes}`,
          contentEncoding: null,
          downloadedBytes: 146,
          etag: null,
          headers: {
            acceptRanges: null,
            cacheControl: "no-cache",
            contentType: "text/html",
            crossOriginEmbedderPolicy: null,
            crossOriginOpenerPolicy: "same-origin, same-origin",
            xContentTypeOptions: null,
          },
          kind: "range-unsatisfiable",
          status: 416,
          url: resourceUrl,
        },
      ],
      sha256: resourceSha,
      url: resourceUrl,
    };
  });
  return {
    artifactDigest: "a".repeat(64),
    completedAt: "2026-07-29T04:00:01.000Z",
    node: { executable: "node.exe", executableSha256: "b".repeat(64), version: "v24.18.0" },
    releaseDigest: "c".repeat(64),
    remote: {
      gid: 1000,
      host: "plex" as "plex",
      immutableMode: "755" as "755",
      immutablePath: "/var/www/parallax-web.com/immutable" as const,
      uid: 1000,
      webRoot: "/var/www/parallax-web.com" as const,
      webRootMode: "755" as "755",
    },
    resources,
    schemaVersion: 2,
    source: { commit: "d".repeat(40), dirtyTreeDigest: "e".repeat(64) },
    startedAt: "2026-07-29T04:00:00.000Z",
    state: "passed",
  };
}
