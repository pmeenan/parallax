import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publishModelSourceVerificationResult } from "./model-source-verification-publication.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("model-source result publication", () => {
  it("publishes and validates terminal JSON before attempting the Markdown companion", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-model-source-publication-"));
    cleanup.push(root);
    const jsonPath = join(root, "result.json");
    const markdownPath = join(root, "result.md");
    const markdownTemporaryPath = join(root, "blocked-markdown.tmp");
    await writeFile(jsonPath, '{"state":"pending"}\n');
    await writeFile(markdownPath, "# Pending\n");
    await mkdir(markdownTemporaryPath);
    const report = {
      artifactDigest: "a".repeat(64),
      completedAt: "2026-08-02T12:00:01.000Z",
      failure: "bounded failure",
      node: {
        executable: "node.exe",
        executableSha256: "b".repeat(64),
        version: "v24.18.1",
      },
      releaseDigest: "c".repeat(64),
      schemaVersion: 2 as const,
      source: { commit: "d".repeat(40), dirtyTreeDigest: null },
      startedAt: "2026-08-02T12:00:00.000Z",
      state: "failed" as const,
    };

    await expect(
      publishModelSourceVerificationResult({
        jsonPath,
        jsonTemporaryPath: join(root, "result.json.tmp"),
        markdown: "# Failed\n",
        markdownPath,
        markdownTemporaryPath,
        report,
      }),
    ).rejects.toThrow();
    expect(JSON.parse(await readFile(jsonPath, "utf8"))).toEqual(report);
    expect(await readFile(markdownPath, "utf8")).toBe("# Pending\n");
  });
});
