import { describe, expect, it, vi } from "vitest";
import {
  evaluatePostRunIdentity,
  invalidFinalizationEvidence,
  measuredFinalizationEvidence,
  persistJsonPrimaryReport,
} from "./report-finalization.js";

const source = Object.freeze({
  commit: "a".repeat(40),
  dirtyTreeDigest: "b".repeat(64),
});

describe("post-run identity finalization", () => {
  it("retains late build and source drift as invalid evidence", async () => {
    const evidence = await evaluatePostRunIdentity("c".repeat(64), source, {
      readArtifactDigest: async () => "d".repeat(64),
      readSourceIdentity: async () => ({
        commit: "e".repeat(40),
        dirtyTreeDigest: null,
      }),
    });

    expect(evidence).toMatchObject({ state: "invalid" });
    expect(evidence.reason).toContain("Built artifact identity changed during the run");
    expect(evidence.reason).toContain("Source identity changed during the run");
  });

  it("retains revalidation probe failures instead of throwing", async () => {
    const evidence = await evaluatePostRunIdentity("c".repeat(64), source, {
      readArtifactDigest: async () => {
        throw new Error("manifest unreadable");
      },
      readSourceIdentity: async () => {
        throw new Error("git unavailable");
      },
    });

    expect(evidence).toEqual(
      invalidFinalizationEvidence(
        "Post-run artifact identity revalidation failed: manifest unreadable | Post-run source identity revalidation failed: git unavailable",
      ),
    );
  });
});

describe("JSON-primary report persistence", () => {
  it("surfaces a primary JSON write failure before attempting Markdown", async () => {
    const writeMarkdown = vi.fn();
    await expect(
      persistJsonPrimaryReport({
        dependencies: {
          publishMarkdown: async () => {},
          removePendingMarkdown: async () => {},
          writeJson: async () => {
            throw new Error("JSON storage unavailable");
          },
          writePendingMarkdown: writeMarkdown,
        },
        failedReport: (reason) => ({ persistence: invalidFinalizationEvidence(reason) }),
        formatMarkdown: () => "# report\n",
        jsonPath: "report.json",
        markdownPath: "report.md",
        pendingReport: { persistence: invalidFinalizationEvidence("pending") },
        successfulReport: { persistence: measuredFinalizationEvidence() },
      }),
    ).rejects.toThrow("JSON storage unavailable");
    expect(writeMarkdown).not.toHaveBeenCalled();
  });

  it("writes pending JSON first and advances it only after Markdown succeeds", async () => {
    const writes: string[] = [];
    const result = await persistJsonPrimaryReport({
      dependencies: {
        publishMarkdown: async (pendingPath, finalPath) => {
          writes.push(`publish:${pendingPath}->${finalPath}`);
        },
        removePendingMarkdown: async () => {},
        writeJson: async (_path, contents) => {
          writes.push(`json:${contents}`);
        },
        writePendingMarkdown: async (_path, contents) => {
          writes.push(`markdown:${contents}`);
        },
      },
      failedReport: (reason) => ({ persistence: invalidFinalizationEvidence(reason) }),
      formatMarkdown: () => "# report\n",
      jsonPath: "report.json",
      markdownPath: "report.md",
      pendingReport: { persistence: invalidFinalizationEvidence("pending") },
      successfulReport: { persistence: measuredFinalizationEvidence() },
    });

    expect(writes).toHaveLength(4);
    expect(writes[0]).toContain('"reason": "pending"');
    expect(writes[1]).toBe("markdown:# report\n");
    expect(writes[2]).toContain('"state": "measured"');
    expect(writes[3]).toMatch(/^publish:report\.md\.pending-.+->report\.md$/);
    expect(result.secondaryFailure).toBeNull();
  });

  it("does not publish Markdown when the final measured JSON write fails", async () => {
    let jsonWriteCount = 0;
    const publishMarkdown = vi.fn();
    const removePendingMarkdown = vi.fn(async () => {});
    await expect(
      persistJsonPrimaryReport({
        dependencies: {
          publishMarkdown,
          removePendingMarkdown,
          writeJson: async () => {
            jsonWriteCount += 1;
            if (jsonWriteCount === 2) throw new Error("final JSON storage failed");
          },
          writePendingMarkdown: async () => {},
        },
        failedReport: (reason) => ({ persistence: invalidFinalizationEvidence(reason) }),
        formatMarkdown: () => "# report\n",
        jsonPath: "report.json",
        markdownPath: "report.md",
        pendingReport: { persistence: invalidFinalizationEvidence("pending") },
        successfulReport: { persistence: measuredFinalizationEvidence() },
      }),
    ).rejects.toThrow("final JSON storage failed");

    expect(publishMarkdown).not.toHaveBeenCalled();
    expect(removePendingMarkdown).toHaveBeenCalledOnce();
  });

  it("retains fail-closed JSON when Markdown formatting fails", async () => {
    const jsonWrites: string[] = [];
    const writeMarkdown = vi.fn();
    const result = await persistJsonPrimaryReport({
      dependencies: {
        publishMarkdown: async () => {},
        removePendingMarkdown: async () => {},
        writeJson: async (_path, contents) => {
          jsonWrites.push(contents);
        },
        writePendingMarkdown: writeMarkdown,
      },
      failedReport: (reason) => ({ persistence: invalidFinalizationEvidence(reason) }),
      formatMarkdown: () => {
        throw new Error("formatter exploded");
      },
      jsonPath: "report.json",
      markdownPath: "report.md",
      pendingReport: { persistence: invalidFinalizationEvidence("pending") },
      successfulReport: { persistence: measuredFinalizationEvidence() },
    });

    expect(jsonWrites).toHaveLength(2);
    expect(jsonWrites[0]).toContain('"reason": "pending"');
    expect(jsonWrites[1]).toContain("Human-readable report formatting failed: formatter exploded");
    expect(writeMarkdown).not.toHaveBeenCalled();
    expect(result.finalReport).toMatchObject({ persistence: { state: "invalid" } });
  });

  it("never publishes the final Markdown path when a writer retains bytes then rejects", async () => {
    const jsonWrites: string[] = [];
    const retainedMarkdown = new Map<string, string>();
    const publishedPaths: string[] = [];
    const removedPaths: string[] = [];
    const result = await persistJsonPrimaryReport({
      dependencies: {
        publishMarkdown: async (_pendingPath, finalPath) => {
          publishedPaths.push(finalPath);
        },
        removePendingMarkdown: async (path) => {
          removedPaths.push(path);
          retainedMarkdown.delete(path);
        },
        writeJson: async (_path, contents) => {
          jsonWrites.push(contents);
        },
        writePendingMarkdown: async (path, contents) => {
          retainedMarkdown.set(path, contents);
          throw new Error("disk rejected Markdown");
        },
      },
      failedReport: (reason) => ({ persistence: invalidFinalizationEvidence(reason) }),
      formatMarkdown: () => "# report\n",
      jsonPath: "report.json",
      markdownPath: "report.md",
      pendingReport: { persistence: invalidFinalizationEvidence("pending") },
      successfulReport: { persistence: measuredFinalizationEvidence() },
    });

    expect(jsonWrites).toHaveLength(2);
    expect(jsonWrites[1]).toContain("Human-readable report write failed: disk rejected Markdown");
    expect(publishedPaths).toEqual([]);
    expect(removedPaths).toHaveLength(1);
    expect(removedPaths[0]).toMatch(/^report\.md\.pending-/);
    expect(retainedMarkdown.size).toBe(0);
    expect(result.secondaryFailure).toBe(
      "Human-readable report write failed: disk rejected Markdown",
    );
  });

  it("retains fail-closed JSON and removes pending Markdown when publish fails", async () => {
    const jsonWrites: string[] = [];
    const pendingPaths: string[] = [];
    const removedPaths: string[] = [];
    const result = await persistJsonPrimaryReport({
      dependencies: {
        publishMarkdown: async () => {
          throw new Error("rename denied");
        },
        removePendingMarkdown: async (path) => {
          removedPaths.push(path);
        },
        writeJson: async (_path, contents) => {
          jsonWrites.push(contents);
        },
        writePendingMarkdown: async (path) => {
          pendingPaths.push(path);
        },
      },
      failedReport: (reason) => ({ persistence: invalidFinalizationEvidence(reason) }),
      formatMarkdown: () => "# report\n",
      jsonPath: "report.json",
      markdownPath: "report.md",
      pendingReport: { persistence: invalidFinalizationEvidence("pending") },
      successfulReport: { persistence: measuredFinalizationEvidence() },
    });

    expect(jsonWrites).toHaveLength(3);
    expect(jsonWrites[1]).toContain('"state": "measured"');
    expect(jsonWrites[2]).toContain("Human-readable report publish failed: rename denied");
    expect(pendingPaths).toHaveLength(1);
    expect(removedPaths).toEqual(pendingPaths);
    expect(result.finalReport).toMatchObject({ persistence: { state: "invalid" } });
  });
});
