import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { containsSensitiveEvidenceText } from "./evidence-redaction.js";
import {
  createOpfsAdapterCleanupOperations,
  type OpfsAdapterReport,
  publishOpfsAdapterReport,
  sanitizeOpfsAdapterFailure,
} from "./opfs-release-store-adapter-run.js";
import { reserveResultPair } from "./result-pair.js";

const startedAt = "2026-08-02T12:00:00.000Z";

function passedReport(): OpfsAdapterReport {
  return {
    artifactDigest: "a".repeat(64),
    browser: { executableSha256: "b".repeat(64), version: "151.0.7922.34" },
    completedAt: "2026-08-02T12:00:01.000Z",
    evidence: {
      blockedBeforeRelease: true,
      firstFinalization: true,
      lifecycle: true,
      reopenReconciliation: true,
      terminatedOwnerReleasedLock: true,
    },
    failure: null,
    releaseDigest: "c".repeat(64),
    schemaVersion: 2,
    source: { commit: "d".repeat(40), dirtyTreeDigest: null },
    startedAt,
    state: "passed",
  };
}

describe("OPFS release-store adapter runner protocol", () => {
  it("acknowledges queued Web Lock requests before timing or terminating the owner", async () => {
    const source = await readFile(
      new URL("./opfs-release-store-adapter-run.ts", import.meta.url),
      "utf8",
    );
    const requestCall = source.indexOf("const pending = base.runExclusive(operation);");
    const requestAck = source.indexOf('self.postMessage({ kind: "lock-requested" });');
    expect(requestCall).toBeGreaterThan(-1);
    expect(requestAck).toBeGreaterThan(requestCall);

    const secondAck = source.indexOf("await secondRequested;");
    const quietWindow = source.indexOf("setTimeout(resolveDelay, 200)");
    expect(secondAck).toBeGreaterThan(requestAck);
    expect(quietWindow).toBeGreaterThan(secondAck);

    const waiterAck = source.indexOf("await waiterRequested;");
    const ownerTermination = source.indexOf("owner.terminate();");
    expect(waiterAck).toBeGreaterThan(quietWindow);
    expect(ownerTermination).toBeGreaterThan(waiterAck);
  });

  it("redacts host paths from retained failure text", () => {
    const failure = sanitizeOpfsAdapterFailure(
      new Error("Failed opening C:\\Users\\private\\profile and /home/private/profile"),
    );
    expect(failure).toContain("<local-path>");
    expect(containsSensitiveEvidenceText(failure)).toBe(false);
  });

  it("tolerates partial setup and removes a profile created before a later setup failure", async () => {
    expect(createOpfsAdapterCleanupOperations({ profile: null, server: null })).toEqual([]);

    const profile = await mkdtemp(join(tmpdir(), "parallax-opfs-adapter-cleanup-test-"));
    try {
      const operations = createOpfsAdapterCleanupOperations({ profile, server: null });
      expect(operations.map((operation) => operation.label)).toEqual(["profile"]);
      await operations[0]?.run();
      await expect(readFile(profile)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(profile, { force: true, recursive: true });
    }
  });

  it("creates fallible profile and server resources inside the guarded run boundary", async () => {
    const source = await readFile(
      new URL("./opfs-release-store-adapter-run.ts", import.meta.url),
      "utf8",
    );
    const reservation = source.indexOf("const reservation = await reserveResultPair");
    const setupBuild = source.indexOf("const build = await readAndValidateBuildManifest");
    const guardedStart = source.lastIndexOf("  try {", setupBuild);
    expect(reservation).toBeGreaterThan(-1);
    expect(guardedStart).toBeGreaterThan(reservation);
    expect(setupBuild).toBeGreaterThan(reservation);
    expect(source.indexOf("profile = await mkdtemp", guardedStart)).toBeGreaterThan(guardedStart);
    expect(source.indexOf("server = createLocalServer", guardedStart)).toBeGreaterThan(
      guardedStart,
    );
  });

  it("reserves a collision-free pair without changing a foreign deterministic pair", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-opfs-adapter-collision-"));
    const baseStem = "adapter-v2-2026-08-02T12-00-00-000Z";
    const foreignJson = join(root, `${baseStem}.json`);
    const foreignMarkdown = join(root, `${baseStem}.md`);
    try {
      await Promise.all([
        writeFile(foreignJson, "foreign-json", { flag: "wx" }),
        writeFile(foreignMarkdown, "foreign-markdown", { flag: "wx" }),
      ]);
      const reservation = await reserveResultPair(
        root,
        startedAt,
        { schemaVersion: 2, startedAt, state: "pending" },
        {},
        "adapter",
        "OPFS release-store browser adapter",
      );
      expect(reservation.stem).toBe(`${baseStem}-1`);
      await publishOpfsAdapterReport(reservation, passedReport());
      await expect(readFile(foreignJson, "utf8")).resolves.toBe("foreign-json");
      await expect(readFile(foreignMarkdown, "utf8")).resolves.toBe("foreign-markdown");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not replace a foreign Markdown file introduced after pair creation", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-opfs-adapter-foreign-markdown-"));
    let markdownPath = "";
    try {
      await expect(
        reserveResultPair(
          root,
          startedAt,
          { schemaVersion: 2, startedAt, state: "pending" },
          {
            afterPairCreate: async () => {
              await rename(markdownPath, `${markdownPath}.reserved`);
              await writeFile(markdownPath, "foreign-markdown", { flag: "wx" });
            },
            beforeCreate: async (path) => {
              if (path.endsWith(".md")) markdownPath = path;
            },
          },
          "adapter",
          "OPFS release-store browser adapter",
        ),
      ).rejects.toThrow();
      await expect(readFile(markdownPath, "utf8")).resolves.toBe("foreign-markdown");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("ignores and preserves an unowned deterministic temporary path", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-opfs-adapter-foreign-tmp-"));
    const foreignTemporary = join(root, "adapter-v2-2026-08-02T12-00-00-000Z.json.tmp");
    try {
      await writeFile(foreignTemporary, "foreign-temporary", { flag: "wx" });
      const reservation = await reserveResultPair(
        root,
        startedAt,
        { schemaVersion: 2, startedAt, state: "pending" },
        {},
        "adapter",
        "OPFS release-store browser adapter",
      );
      await publishOpfsAdapterReport(reservation, passedReport());
      await expect(readFile(foreignTemporary, "utf8")).resolves.toBe("foreign-temporary");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("retains failed terminal evidence when setup fails after reservation", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-opfs-adapter-setup-failure-"));
    try {
      const reservation = await reserveResultPair(
        root,
        startedAt,
        { schemaVersion: 2, startedAt, state: "pending" },
        {},
        "adapter",
        "OPFS release-store browser adapter",
      );
      const setupFailure: OpfsAdapterReport = {
        ...passedReport(),
        artifactDigest: null,
        browser: null,
        evidence: null,
        failure: "setup failed",
        releaseDigest: null,
        source: null,
        state: "failed",
      };
      await publishOpfsAdapterReport(reservation, setupFailure);
      await expect(readFile(reservation.jsonPath, "utf8")).resolves.toContain('"state": "failed"');
      await expect(readFile(reservation.markdownPath, "utf8")).resolves.toContain("setup failed");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("retains terminal JSON and a recovery companion when Markdown finalization fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-opfs-adapter-markdown-failure-"));
    try {
      const reservation = await reserveResultPair(
        root,
        startedAt,
        { schemaVersion: 2, startedAt, state: "pending" },
        {
          beforeOwnedWrite: async (path, state) => {
            if (path.endsWith(".md") && state === "passed") {
              throw new Error("injected Markdown failure");
            }
          },
        },
        "adapter",
        "OPFS release-store browser adapter",
      );
      const failure = await publishOpfsAdapterReport(reservation, passedReport()).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors[0]).toMatchObject({ phase: "markdown" });
      expect(reservation.handleState()).toEqual({ jsonClosed: true, markdownClosed: true });
      await expect(readFile(reservation.jsonPath, "utf8")).resolves.toContain('"state": "passed"');
      await expect(readFile(reservation.markdownPath, "utf8")).resolves.toContain(
        "Primary terminal JSON retained",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("retries and aggregates a forced publication plus close failure without leaking handles", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-opfs-adapter-close-failure-"));
    try {
      const reservation = await reserveResultPair(
        root,
        startedAt,
        { schemaVersion: 2, startedAt, state: "pending" },
        {
          beforeHandleClose: async (_path, _logicalPath, attempt) => {
            if (attempt === 1) throw new Error("injected first close failure");
          },
          beforeOwnedWrite: async (path, state) => {
            if (path.endsWith(".json") && state === "passed") {
              throw new Error("injected terminal publication failure");
            }
          },
        },
        "adapter",
        "OPFS release-store browser adapter",
      );
      const failure = await publishOpfsAdapterReport(reservation, passedReport()).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toHaveLength(2);
      expect(reservation.handleState()).toEqual({ jsonClosed: true, markdownClosed: true });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("keeps the raw browser executable path out of retained reports and stdout", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-opfs-adapter-redaction-"));
    const rawExecutable = String.raw`C:\Users\private\Chrome\chrome.exe`;
    try {
      await mkdir(root, { recursive: true });
      const reservation = await reserveResultPair(
        root,
        startedAt,
        { schemaVersion: 2, startedAt, state: "pending" },
        {},
        "adapter",
        "OPFS release-store browser adapter",
      );
      const report = passedReport();
      await publishOpfsAdapterReport(reservation, report);
      const retained = `${await readFile(reservation.jsonPath, "utf8")}\n${await readFile(
        reservation.markdownPath,
        "utf8",
      )}\n${JSON.stringify(report)}`;
      expect(retained).not.toContain(rawExecutable);
      expect(retained).not.toMatch(/[A-Za-z]:\\/u);
      const source = await readFile(
        new URL("./opfs-release-store-adapter-run.ts", import.meta.url),
        "utf8",
      );
      expect(source).not.toContain("browser: Object.freeze({ executable,");
      expect(source).not.toContain("executablePath:");
      expect(source).not.toContain(".json.tmp");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
