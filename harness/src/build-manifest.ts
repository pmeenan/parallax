import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

// The manifest itself cannot list its own hash; every other served file must be a
// listed artifact so the manifest-derived artifactDigest identifies the whole tree.
const UNLISTED_ALLOWLIST: ReadonlySet<string> = new Set(["build-manifest.json"]);

export interface ManifestArtifact {
  readonly bytes: number;
  readonly path: string;
  readonly sha256: string;
}

export interface BuildManifest {
  readonly artifacts: readonly ManifestArtifact[];
  readonly schemaVersion: 5;
  readonly workerEntrypoints: readonly ManifestWorkerEntrypoint[];
}

export interface ManifestWorkerEntrypoint {
  readonly path: string;
  readonly role: "ai" | "render" | "storage" | "wasm-thread";
  readonly targetType: "worker";
}

export interface FileDigest {
  readonly bytes: number;
  readonly sha256: string;
}

export interface ValidatedBuildManifest {
  readonly artifactDigest: string;
  readonly manifest: BuildManifest;
}

export async function readAndValidateBuildManifest(
  buildRoot: string,
): Promise<ValidatedBuildManifest> {
  const resolvedRoot = resolve(buildRoot);
  const manifestBytes = await readFile(resolve(resolvedRoot, "build-manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as BuildManifest;
  if (manifest.schemaVersion !== 5) {
    throw new Error(`Unsupported build manifest schema ${String(manifest.schemaVersion)}`);
  }
  if (!Array.isArray(manifest.artifacts) || !Array.isArray(manifest.workerEntrypoints)) {
    throw new Error("Build manifest v5 requires artifact and worker-entrypoint arrays");
  }
  const workerRoles = manifest.workerEntrypoints.map((entrypoint) => entrypoint.role);
  const workerPaths = new Set(
    manifest.workerEntrypoints.map((entrypoint) => resolve(resolvedRoot, entrypoint.path)),
  );
  if (
    manifest.workerEntrypoints.length !== 4 ||
    workerRoles.filter((role) => role === "ai").length !== 1 ||
    workerRoles.filter((role) => role === "render").length !== 1 ||
    workerRoles.filter((role) => role === "storage").length !== 1 ||
    workerRoles.filter((role) => role === "wasm-thread").length !== 1 ||
    workerPaths.size !== 4
  ) {
    throw new Error(
      "Build manifest v5 requires exactly one distinct AI, render, storage, and WASM-thread worker",
    );
  }
  for (const artifact of manifest.artifacts) {
    const artifactPath = resolve(resolvedRoot, artifact.path);
    if (!artifactPath.startsWith(`${resolvedRoot}${sep}`)) {
      throw new Error(`Build manifest artifact escapes the build root: ${artifact.path}`);
    }
    const actual = await sha256File(artifactPath);
    if (actual.bytes !== artifact.bytes || actual.sha256 !== artifact.sha256) {
      throw new Error(`Built artifact does not match its manifest: ${artifact.path}`);
    }
  }
  for (const entrypoint of manifest.workerEntrypoints) {
    if (
      (entrypoint.role !== "ai" &&
        entrypoint.role !== "render" &&
        entrypoint.role !== "storage" &&
        entrypoint.role !== "wasm-thread") ||
      entrypoint.targetType !== "worker" ||
      !manifest.artifacts.some((artifact) => artifact.path === entrypoint.path)
    ) {
      throw new Error(`Invalid build-manifest worker entrypoint: ${JSON.stringify(entrypoint)}`);
    }
  }
  const listed = new Set(manifest.artifacts.map((artifact) => artifact.path));
  const unexpected = (await listFilesRecursively(resolvedRoot)).filter(
    (path) => !listed.has(path) && !UNLISTED_ALLOWLIST.has(path),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Served build root contains files that are not in the build manifest: ${unexpected.join(", ")}`,
    );
  }
  return Object.freeze({
    artifactDigest: sha256Hex(manifestBytes),
    manifest,
  });
}

export async function listFilesRecursively(
  directory: string,
  prefix = "",
): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(resolve(directory, entry.name), relativePath)));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

export async function sha256File(path: string): Promise<FileDigest> {
  const digest = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    digest.update(buffer);
  }
  return Object.freeze({ bytes, sha256: digest.digest("hex") });
}

export function sha256Hex(bytes: NodeJS.ArrayBufferView): string {
  return createHash("sha256").update(bytes).digest("hex");
}
