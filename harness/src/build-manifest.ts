import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

export interface ManifestArtifact {
  readonly bytes: number;
  readonly path: string;
  readonly sha256: string;
}

export interface BuildManifest {
  readonly artifacts: readonly ManifestArtifact[];
  readonly schemaVersion: 1;
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
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.artifacts)) {
    throw new Error(`Unsupported build manifest ${String(manifest.schemaVersion)}`);
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
  return Object.freeze({
    artifactDigest: sha256Hex(manifestBytes),
    manifest,
  });
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
