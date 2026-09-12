import assert from "node:assert/strict";
import { mkdir, open, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { ANIMATION_IMPORT_POLICY } from "./animation-policy.ts";
import { sha256, validateAnimationSource } from "./animation-validation.ts";

export async function importAnimationCandidate(
  sourcePath: string,
  profilePath: string,
  outputPath: string,
  resultsRoot: string,
) {
  // Resolve the parent before creating anything: junctions cannot redirect output into source/library.
  const root = await realpath(resultsRoot);
  const output = resolve(outputPath);
  const parent = await realpath(dirname(output));
  const scoped = relative(root, parent);
  assert(
    !isAbsolute(scoped) &&
      scoped !== ".." &&
      !scoped.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`),
    "Animation candidates belong under ignored harness/results",
  );
  await mkdir(output); // New directory only; reruns cannot replace candidate evidence.
  const reportPath = resolve(output, "validation.json");
  const envelope: Record<string, unknown> = {
    schemaVersion: 1,
    status: "running",
    sourcePath: resolve(sourcePath),
    profilePath: resolve(profilePath),
  };
  const persist = async (): Promise<void> => {
    await writeFile(reportPath, `${JSON.stringify(envelope, null, 2)}\n`);
  };
  await persist();
  try {
    const source = await readBoundedFile(sourcePath, ANIMATION_IMPORT_POLICY.maximumSourceBytes);
    const profileBytes = await readBoundedFile(profilePath, 1024 * 1024);
    Object.assign(envelope, { sourceSha256: sha256(source), profileSha256: sha256(profileBytes) });
    const profile = JSON.parse(profileBytes.toString("utf8")) as unknown;
    const report = await validateAnimationSource(source, profile);
    const sourceFile = `${report.sourceSha256}.glb`;
    await writeFile(resolve(output, sourceFile), source, { flag: "wx" });
    await writeFile(resolve(output, "profile.json"), profileBytes, { flag: "wx" });
    Object.assign(envelope, { status: "source-validated-admission-pending", report });
    await persist();
    const manifest = {
      schemaVersion: 1,
      status: "source-validated-admission-pending",
      assetId: report.assetId,
      source: { file: sourceFile, sha256: report.sourceSha256, bytes: source.byteLength },
      profile: { file: "profile.json", sha256: sha256(profileBytes) },
      validation: { file: "validation.json", sha256: sha256(await readFile(reportPath)) },
      rigSha256: report.rigSha256,
      pending: [
        "Babylon worker roundtrip",
        "class mesh/material/LOD and compressed-export QA",
        "rights approval if unreviewed",
        "library admission",
        "installed scene motion and artistic acceptance",
      ],
    };
    await writeFile(resolve(output, "candidate.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx",
    });
    return manifest;
  } catch (error: unknown) {
    Object.assign(envelope, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    await persist();
    throw error;
  }
}

async function readBoundedFile(path: string, maximumBytes: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const stat = await handle.stat();
    assert(
      stat.isFile() && stat.size > 0 && stat.size <= maximumBytes,
      "Input is not a file within the byte limit",
    );
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      assert(bytesRead > 0, "Input changed while reading");
      offset += bytesRead;
    }
    const after = await handle.stat();
    assert(
      after.size === stat.size && after.mtimeMs === stat.mtimeMs,
      "Input changed while reading",
    );
    return bytes;
  } finally {
    await handle.close();
  }
}
