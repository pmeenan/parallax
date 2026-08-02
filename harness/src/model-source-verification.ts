import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  ModelSourceVerificationRemoteResource,
  ModelSourceVerificationRemoteRoot,
  ModelSourceVerificationResource,
} from "./model-source-verification-result.js";

const execFileAsync = promisify(execFile);
const REMOTE_HOST = "plex";
const REMOTE_WEB_ROOT = "/var/www/parallax-web.com";
const REMOTE_IMMUTABLE = `${REMOTE_WEB_ROOT}/immutable`;
const REMOTE_FILES = [
  "model-ff074d7cae3cbda06f7a32b6d42c206bf88c2bee84c9d6165a0937ec2b61958d.gguf",
  "model-1c5368744032e95ba212561c1985cd8017de6fd165fef1f648528e0be265d4a8.gguf",
  "model-f8c3b5b6f05090ef292ed643357fed6b1df5381d0a21e11d3515580af3ef48f3.gguf",
  "model-ca3403a90060fc56b92e6b35acb0090eebb8b7eb11c4919536ba645f4d45c461.gguf",
  "model-30c5c95b427827e9f1993f7df2e4d6cbdea2354811ab5dcafd6db41190cfb9f9.gguf",
] as const;
const REMOTE_BYTES: Readonly<Record<(typeof REMOTE_FILES)[number], number>> = {
  "model-ff074d7cae3cbda06f7a32b6d42c206bf88c2bee84c9d6165a0937ec2b61958d.gguf": 23_532_320,
  "model-1c5368744032e95ba212561c1985cd8017de6fd165fef1f648528e0be265d4a8.gguf": 1_321_205_952,
  "model-f8c3b5b6f05090ef292ed643357fed6b1df5381d0a21e11d3515580af3ef48f3.gguf": 508_734_272,
  "model-ca3403a90060fc56b92e6b35acb0090eebb8b7eb11c4919536ba645f4d45c461.gguf": 510_543_744,
  "model-30c5c95b427827e9f1993f7df2e4d6cbdea2354811ab5dcafd6db41190cfb9f9.gguf": 256_355_264,
};

export interface FixedRemoteModelIdentity {
  readonly resources: ReadonlyMap<string, ModelSourceVerificationRemoteResource>;
  readonly root: ModelSourceVerificationRemoteRoot;
}

type FixedSshRunner = (
  executable: "ssh.exe",
  arguments_: readonly [host: "plex", command: string],
) => Promise<{ readonly stdout: string }>;

export async function readFixedRemoteModelIdentity(
  run: FixedSshRunner = runFixedSsh,
): Promise<FixedRemoteModelIdentity> {
  const command = fixedRemoteIdentityCommand();
  const { stdout } = await run("ssh.exe", [REMOTE_HOST, command]);
  const lines = stdout.split(/\r?\n/).filter((line) => line !== "");
  if (lines.length !== 7)
    throw new Error("Remote model identity returned an unexpected line count");
  const rootMatch = /^ROOT ([0-9]+) ([0-9]+) ([0-7]+)$/.exec(lines[0] ?? "");
  const directoryMatch = /^DIRECTORY ([0-9]+) ([0-9]+) ([0-7]+)$/.exec(lines[1] ?? "");
  if (rootMatch === null || directoryMatch === null) {
    throw new Error("Remote model root identity is malformed");
  }
  const uid = safeNumber(rootMatch[1], "remote uid");
  const gid = safeNumber(rootMatch[2], "remote gid");
  if (
    rootMatch[3] !== "755" ||
    directoryMatch[3] !== "755" ||
    safeNumber(directoryMatch[1], "immutable uid") !== uid ||
    safeNumber(directoryMatch[2], "immutable gid") !== gid
  ) {
    throw new Error("Remote model root ownership or mode is unsafe");
  }
  const root: ModelSourceVerificationRemoteRoot = {
    gid,
    host: REMOTE_HOST,
    immutableMode: "755",
    immutablePath: REMOTE_IMMUTABLE,
    uid,
    webRoot: REMOTE_WEB_ROOT,
    webRootMode: "755",
  };
  const resources = new Map<string, ModelSourceVerificationRemoteResource>();
  for (const line of lines.slice(2)) {
    const match =
      /^FILE (model-([a-f0-9]{64})\.gguf) ([0-9]+) ([a-f0-9]{64}) ([0-9]+) ([0-9]+) ([0-7]+)$/.exec(
        line,
      );
    if (match === null || !REMOTE_FILES.includes(match[1] as (typeof REMOTE_FILES)[number])) {
      throw new Error("Remote model file identity is malformed or unexpected");
    }
    const sha256 = match[2] ?? "";
    const bytes = safeNumber(match[3], "remote model bytes");
    if (
      bytes !== REMOTE_BYTES[match[1] as (typeof REMOTE_FILES)[number]] ||
      match[4] !== sha256 ||
      safeNumber(match[5], "remote model uid") !== uid ||
      safeNumber(match[6], "remote model gid") !== gid ||
      match[7] !== "644" ||
      resources.has(sha256)
    ) {
      throw new Error("Remote model file identity does not match its fixed content path");
    }
    resources.set(sha256, {
      bytes,
      gid,
      mode: "644",
      path: `${REMOTE_IMMUTABLE}/${match[1]}`,
      sha256,
      symlink: false,
      type: "regular-file",
      uid,
    });
  }
  if (resources.size !== 5) throw new Error("Remote model identity omitted a pinned file");
  return Object.freeze({ resources, root });
}

export function fixedRemoteIdentityCommand(): string {
  const expectedInventory = REMOTE_FILES.map((name) => `'${name}'`).join(" ");
  const probes = REMOTE_FILES.map(
    (name) =>
      `p=${REMOTE_IMMUTABLE}/${name}; test -f "$p"; test ! -L "$p"; ` +
      `set -- $(stat -c '%s %u %g %a' "$p"); bytes=$1; uid=$2; gid=$3; mode=$4; ` +
      `sha=$(sha256sum -- "$p" | cut -d ' ' -f 1); ` +
      `printf 'FILE ${name} %s %s %s %s %s\\n' "$bytes" "$sha" "$uid" "$gid" "$mode";`,
  ).join(" ");
  return (
    `set -eu; w=${REMOTE_WEB_ROOT}; d=${REMOTE_IMMUTABLE}; ` +
    `test -d "$w"; test ! -L "$w"; test -d "$d"; test ! -L "$d"; ` +
    `actual=$(find "$d" -mindepth 1 -maxdepth 1 -name 'model-*.gguf' -printf '%f\\n' | LC_ALL=C sort); ` +
    `expected=$(printf '%s\\n' ${expectedInventory} | LC_ALL=C sort); test "$actual" = "$expected"; ` +
    `set -- $(stat -c '%u %g %a' "$w"); printf 'ROOT %s %s %s\\n' "$1" "$2" "$3"; ` +
    `set -- $(stat -c '%u %g %a' "$d"); printf 'DIRECTORY %s %s %s\\n' "$1" "$2" "$3"; ` +
    probes
  );
}

async function runFixedSsh(
  executable: "ssh.exe",
  arguments_: readonly [host: "plex", command: string],
): Promise<{ readonly stdout: string }> {
  const result = await execFileAsync(executable, [...arguments_], {
    encoding: "utf8",
    maxBuffer: 64 * 1024,
    windowsHide: true,
  });
  return { stdout: result.stdout };
}

function safeNumber(value: string | undefined, label: string): number {
  if (value === undefined || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} is malformed`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} is unsafe`);
  return parsed;
}

export async function verifyModelSourceResource(input: {
  readonly bytes: number;
  readonly id: string;
  readonly localSource: string;
  readonly sha256: string;
  readonly url: string;
  readonly remote: ModelSourceVerificationRemoteResource;
}): Promise<ModelSourceVerificationResource> {
  const head = await request(input, "head", { method: "HEAD" }, 0);
  const etag = head.etag;
  if (etag === null || !/^"[\x21\x23-\x7e]+"$/.test(etag)) {
    throw new Error(`${input.id} has no strong ETag`);
  }
  const range = await request(input, "range-0-0", { headers: { Range: "bytes=0-0" } }, 1);
  const unsatisfiable = await request(
    input,
    "range-unsatisfiable",
    { headers: { Range: `bytes=${input.bytes}-${input.bytes}` } },
    65_536,
  );
  const matching = await request(
    input,
    "if-range-match",
    { headers: { "If-Range": etag, Range: "bytes=0-0" } },
    1,
  );
  const stale = await request(
    input,
    "if-range-stale",
    { headers: { "If-Range": '"parallax-stale-validator"', Range: "bytes=0-0" } },
    0,
  );
  const requests = [head, matching, stale, range, unsatisfiable].sort((left, right) =>
    left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0,
  );
  for (const response of requests) {
    if (response.kind !== "range-unsatisfiable" && response.etag !== etag) {
      throw new Error(`${input.id}/${response.kind} ETag changed`);
    }
  }
  return {
    bytes: input.bytes,
    etag,
    id: input.id,
    local: { bytes: input.bytes, sha256: input.sha256, source: input.localSource },
    remote: input.remote,
    requests,
    sha256: input.sha256,
    url: input.url,
  };
}

async function request(
  input: { readonly bytes: number; readonly id: string; readonly url: string },
  kind: ModelSourceVerificationResource["requests"][number]["kind"],
  init: RequestInit,
  bodyLimit: number,
): Promise<ModelSourceVerificationResource["requests"][number]> {
  const response = await fetch(input.url, {
    ...init,
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  if (response.url !== input.url) {
    await response.body?.cancel();
    throw new Error(`${input.id}/${kind} final URL changed`);
  }
  const contentLengthText = response.headers.get("content-length");
  const contentLength =
    contentLengthText === null || !/^(?:0|[1-9][0-9]*)$/.test(contentLengthText)
      ? null
      : Number(contentLengthText);
  const etag = response.headers.get("etag");
  const evidence = {
    contentEncoding: response.headers.get("content-encoding"),
    contentLength,
    contentRange: response.headers.get("content-range"),
    downloadedBytes: 0,
    etag,
    headers: {
      acceptRanges: response.headers.get("accept-ranges"),
      cacheControl: response.headers.get("cache-control"),
      contentType: response.headers.get("content-type"),
      crossOriginEmbedderPolicy: response.headers.get("cross-origin-embedder-policy"),
      crossOriginOpenerPolicy: response.headers.get("cross-origin-opener-policy"),
      xContentTypeOptions: response.headers.get("x-content-type-options"),
    },
    kind,
    status: response.status,
    url: response.url,
  };
  const expectedStatus =
    kind === "range-unsatisfiable" ? 416 : kind === "head" || kind === "if-range-stale" ? 200 : 206;
  if (response.status !== expectedStatus) {
    await response.body?.cancel();
    throw new Error(`${input.id}/${kind} status mismatch`);
  }
  const expectedCache = kind === "head" ? "immutable" : "no-cache";
  if (!hasCachePolicy(evidence.headers.cacheControl, expectedCache)) {
    await response.body?.cancel();
    throw new Error(`${input.id}/${kind} cache-control mismatch`);
  }
  if (kind === "range-unsatisfiable") {
    if (evidence.contentRange !== `bytes */${input.bytes}`) {
      await response.body?.cancel();
      throw new Error(`${input.id}/${kind} Content-Range mismatch`);
    }
    const downloadedBytes = await consumeBounded(response, bodyLimit);
    return { ...evidence, downloadedBytes };
  }
  const fullResponse = kind === "head" || kind === "if-range-stale";
  if (
    evidence.contentEncoding !== null ||
    (fullResponse && evidence.headers.acceptRanges !== "bytes") ||
    (!fullResponse &&
      !(evidence.headers.acceptRanges === null || evidence.headers.acceptRanges === "bytes")) ||
    evidence.headers.contentType !== "application/octet-stream" ||
    evidence.headers.crossOriginEmbedderPolicy !== "require-corp" ||
    evidence.headers.crossOriginOpenerPolicy !== "same-origin" ||
    evidence.headers.xContentTypeOptions !== "nosniff" ||
    etag === null ||
    !/^"[\x21\x23-\x7e]+"$/.test(etag)
  ) {
    await response.body?.cancel();
    throw new Error(`${input.id}/${kind} headers mismatch`);
  }
  if (
    fullResponse
      ? contentLength !== input.bytes || evidence.contentRange !== null
      : contentLength !== 1 || evidence.contentRange !== `bytes 0-0/${input.bytes}`
  ) {
    await response.body?.cancel();
    throw new Error(`${input.id}/${kind} length or range mismatch`);
  }
  if (kind === "if-range-stale") {
    await response.body?.cancel();
    return {
      ...evidence,
      downloadedBytes: 0,
    } as ModelSourceVerificationResource["requests"][number];
  }
  const downloadedBytes = await consumeBounded(response, bodyLimit);
  if (!fullResponse && downloadedBytes !== 1) {
    throw new Error(`${input.id}/${kind} body length mismatch`);
  }
  return { ...evidence, downloadedBytes };
}

function hasCachePolicy(value: string | null, policy: "immutable" | "no-cache"): boolean {
  if (value === null) return false;
  const directives = value.split(",").map((directive) => directive.trim().toLowerCase());
  if (directives.some((directive) => directive === "")) return false;
  const unique = new Set(directives);
  return policy === "no-cache"
    ? unique.size === 1 && unique.has("no-cache")
    : unique.size === 3 &&
        unique.has("public") &&
        unique.has("max-age=31536000") &&
        unique.has("immutable");
}

async function consumeBounded(response: Response, limit: number): Promise<number> {
  if (response.body === null) return 0;
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return bytes;
      bytes += result.value.byteLength;
      if (bytes > limit) throw new Error(`HTTP verification body exceeded ${limit} bytes`);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
