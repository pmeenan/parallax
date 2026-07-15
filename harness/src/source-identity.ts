import { execFileSync, spawn } from "node:child_process";
import { createHash, type Hash } from "node:crypto";
import { join } from "node:path";
import { sha256File } from "./build-manifest.js";

export interface SourceIdentity {
  readonly commit: string;
  readonly dirtyTreeDigest: string | null;
}

export async function readSourceIdentity(repositoryRoot: string): Promise<SourceIdentity> {
  const commit = gitText(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  const digest = createHash("sha256").update("tracked\0");
  const trackedBytes = await hashGitDiff(repositoryRoot, digest);
  const untracked = nullSeparatedPaths(
    execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
      cwd: repositoryRoot,
      encoding: null,
      maxBuffer: 64 * 1024 * 1024,
    }),
  ).sort();
  if (trackedBytes === 0 && untracked.length === 0) {
    return Object.freeze({ commit, dirtyTreeDigest: null });
  }
  for (const path of untracked) {
    const fileDigest = await sha256File(join(repositoryRoot, path));
    digest
      .update("untracked\0")
      .update(path)
      .update("\0")
      .update(String(fileDigest.bytes))
      .update("\0")
      .update(fileDigest.sha256);
  }
  return Object.freeze({ commit, dirtyTreeDigest: digest.digest("hex") });
}

async function hashGitDiff(repositoryRoot: string, digest: Hash): Promise<number> {
  // The digest hashes raw diff bytes, so every knob that alters diff rendering is
  // pinned explicitly — otherwise per-user git config (colors, prefixes, quoting,
  // diff algorithm, context sizes, external diff drivers, rename detection, order
  // files, attribute files) would change the digest for identical trees. An empty
  // core.attributesfile means "no file configured", but an empty diff.orderfile is a
  // fatal error (git tries to read ""), so the orderfile is cancelled with /dev/null —
  // the documented cancellation value, which Git for Windows maps internally.
  const child = spawn(
    "git",
    [
      "-c",
      "core.attributesfile=",
      "-c",
      "core.quotepath=on",
      "-c",
      "diff.orderfile=/dev/null",
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--diff-algorithm=myers",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--unified=3",
      "--inter-hunk-context=0",
      "--binary",
      "HEAD",
      "--",
      ".",
    ],
    {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stderr: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const completion = new Promise<number>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("close", (code) => resolveExit(code ?? 1));
  });
  let bytes = 0;
  for await (const chunk of child.stdout) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    digest.update(buffer);
  }
  const exitCode = await completion;
  if (exitCode !== 0) {
    throw new Error(`git diff failed (${exitCode}): ${Buffer.concat(stderr).toString("utf8")}`);
  }
  return bytes;
}

function gitText(repositoryRoot: string, arguments_: readonly string[]): string {
  return execFileSync("git", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024,
  });
}

function nullSeparatedPaths(output: Buffer): string[] {
  const paths: string[] = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0) continue;
    if (index > start) paths.push(output.subarray(start, index).toString("utf8"));
    start = index + 1;
  }
  if (start !== output.length) throw new Error("git ls-files output was not NUL-terminated");
  return paths;
}
