import { createHash } from "node:crypto";
import {
  link,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  adjudicateProductionReplayEvidence,
  bindProductionReplayEvidence,
  parseProductionReplayEvidence,
  RETAINED_PRODUCTION_REPLAY_V1_FAILED,
  RETAINED_PRODUCTION_REPLAY_V1_PASSED,
  reserveProductionReplayEvidence,
  sanitizeProductionReplayFailure,
  validateRetainedLegacyV1Pair,
} from "./installer-repair-production-replay-evidence";

const cleanup: string[] = [];
const JSON_BYTE_CEILING = 16 * 1024 * 1024;
const MARKDOWN_BYTE_CEILING = 16 * 1024 * 1024;
const RECOVERY_BYTE_CEILING = 1024 * 1024;

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("installer Repair production replay evidence", () => {
  it.each([
    ["partial create", "create", "markdown"],
    ["initial stat", "stat", "json"],
    ["pending JSON", "pending-write", "json"],
    ["pending Markdown", "pending-write", "markdown"],
    ["pending flush", "flush", "markdown"],
    ["pending verify", "verify", "json"],
  ] as const)("fails closed and cleans owned handles for %s", async (_label, operation, logicalPath) => {
    const root = await temporaryRepository();
    let injected = false;
    await expect(
      reserveProductionReplayEvidence(root, "2026-07-30T20:58:00.000Z", pending(), {
        beforeOperation: (candidateOperation, candidatePath) => {
          if (!injected && candidateOperation === operation && candidatePath === logicalPath) {
            injected = true;
            return Promise.reject(new Error(`injected ${operation} ${logicalPath}`));
          }
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow();
  });

  it("publishes exact bound pending JSON and Markdown before returning", async () => {
    const root = await temporaryRepository();
    const evidence = await reserveProductionReplayEvidence(
      root,
      "2026-07-30T20:59:00.000Z",
      pending(),
    );

    expect(await readJson(evidence.jsonPath)).toMatchObject({
      canonicalBinding: { payloadSha256: expect.stringMatching(/^[a-f0-9]{64}$/u) },
      resultOwnership: { publicationState: "pending" },
      state: "pending",
    });
    expect(evidence.jsonPath.endsWith(`${evidence.stem}.json`)).toBe(true);
    expect(evidence.jsonPath.endsWith(".json.json")).toBe(false);
    expect(evidence.markdownPath.endsWith(`${evidence.stem}.md`)).toBe(true);
    expect(evidence.recoveryPath.endsWith(`${evidence.stem}.recovery.json`)).toBe(true);
    expect(await readFile(evidence.markdownPath, "utf8")).toContain(
      "- Publication state: `pending`",
    );
    expect(await adjudicatePaths(evidence)).toMatchObject({
      pairState: "pending",
      recoveryState: "reservation-open",
      verdict: "reservation-open",
    });
    await evidence.publishTerminal({ ...pending(), state: "failed" }, "failed");
  });

  it("publishes, closes, reopens, and semantically verifies an exact terminal pair", async () => {
    const root = await temporaryRepository();
    const evidence = await reserveProductionReplayEvidence(
      root,
      "2026-07-30T21:00:00.000Z",
      pending(),
    );
    const hashes = await evidence.publishTerminal(
      {
        ...pending(),
        completedAt: "2026-07-30T21:00:01.000Z",
        durationMs: 1_000,
        replay: { verified: true },
        state: "passed",
      },
      "passed",
    );

    expect(hashes).toEqual({
      canonicalPayloadSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      jsonSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      markdownSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      recoverySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(parseProductionReplayEvidence(await readJson(evidence.jsonPath))).toMatchObject({
      resultOwnership: { publicationState: "passed" },
      state: "passed",
    });
    expect(await readFile(evidence.markdownPath, "utf8")).toContain(
      "- Publication state: `passed`",
    );
    expect(await readJson(evidence.recoveryPath)).toMatchObject({
      authorization: {
        canonicalPayloadSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        jsonSha256: hashes.jsonSha256,
        markdownSha256: hashes.markdownSha256,
        pairPublicationState: "passed",
      },
      resultOwnership: {
        publicationState: "pair-terminal-authorized",
        reservationId: evidence.reservationId,
      },
      state: "pair-terminal-authorized",
    });
    expect(await adjudicatePaths(evidence)).toEqual({
      pairState: "passed",
      recoveryState: "pair-terminal-authorized",
      verdict: "authorized-terminal",
    });
  });

  it("rejects authorization, pair-hash, pair-payload, and passed-without-authorization byte mutations", async () => {
    const root = await temporaryRepository();
    const evidence = await reserveProductionReplayEvidence(
      root,
      "2026-07-30T21:00:05.000Z",
      pending(),
    );
    const openRecovery = await readBounded(evidence.recoveryPath, RECOVERY_BYTE_CEILING);
    await evidence.publishTerminal(
      {
        ...pending(),
        completedAt: "2026-07-30T21:00:06.000Z",
        durationMs: 1_000,
        replay: { verified: true },
        state: "passed",
      },
      "passed",
    );
    const json = await readBounded(evidence.jsonPath, JSON_BYTE_CEILING);
    const markdown = await readBounded(evidence.markdownPath, MARKDOWN_BYTE_CEILING);
    const recovery = await readBounded(evidence.recoveryPath, RECOVERY_BYTE_CEILING);

    expect(() => adjudicateProductionReplayEvidence(json, markdown, openRecovery)).toThrow(
      /Open reservation cannot authorize a terminal pair/u,
    );

    const hashMismatch = Buffer.concat([Buffer.from(json), Buffer.from(" ")]);
    expect(() => adjudicateProductionReplayEvidence(hashMismatch, markdown, recovery)).toThrow(
      /differs from its durable recovery authorization/u,
    );

    const payloadMismatch = Buffer.from(json);
    const duration = Buffer.from('"durationMs": 1000');
    const durationOffset = payloadMismatch.indexOf(duration);
    expect(durationOffset).toBeGreaterThanOrEqual(0);
    payloadMismatch.set(Buffer.from('"durationMs": 1001'), durationOffset);
    expect(() => adjudicateProductionReplayEvidence(payloadMismatch, markdown, recovery)).toThrow(
      /Readable terminal JSON contradicts/u,
    );
    expect(adjudicateProductionReplayEvidence(new Uint8Array(), markdown, recovery)).toEqual({
      pairState: "unreadable",
      recoveryState: "pair-terminal-authorized",
      verdict: "authorized-terminal-not-published",
    });

    const truncatedMarkdown = markdown.subarray(0, Math.max(0, markdown.byteLength - 1));
    expect(() => adjudicateProductionReplayEvidence(json, truncatedMarkdown, recovery)).toThrow(
      /Readable terminal pair contradicts its JSON\/Markdown binding/u,
    );

    const recoveryRecord = JSON.parse(Buffer.from(recovery).toString("utf8")) as Record<
      string,
      unknown
    >;
    const authorization = {
      ...(recoveryRecord.authorization as Record<string, unknown>),
      jsonSha256: "b".repeat(64),
    };
    recoveryRecord.authorization = authorization;
    recoveryRecord.authorizationSha256 = createHash("sha256")
      .update(JSON.stringify(authorization))
      .digest("hex");
    const authorizationMismatch = rebindRecoveryRecord(recoveryRecord);
    expect(() => adjudicateProductionReplayEvidence(json, markdown, authorizationMismatch)).toThrow(
      /differs from its durable recovery authorization/u,
    );
  });

  it("durably authorizes the exact future pair before either pending artifact becomes terminal", async () => {
    const root = await temporaryRepository();
    let armed = false;
    let observed:
      | Readonly<{ pairState: unknown; recoveryState: unknown; authorization: unknown }>
      | undefined;
    const evidence = await reserveProductionReplayEvidence(
      root,
      "2026-07-30T21:00:10.000Z",
      pending(),
      {
        beforeOperation: async (operation, logicalPath) => {
          if (
            armed &&
            observed === undefined &&
            operation === "terminal-write" &&
            logicalPath === "json"
          ) {
            const pair = (await readJson(evidence.jsonPath)) as Record<string, unknown>;
            const recovery = (await readJson(evidence.recoveryPath)) as Record<string, unknown>;
            observed = Object.freeze({
              authorization: recovery.authorization,
              pairState: pair.state,
              recoveryState: recovery.state,
            });
          }
        },
      },
    );
    armed = true;
    await evidence.publishTerminal({ ...pending(), state: "passed" }, "passed");
    expect(observed).toMatchObject({
      authorization: {
        pairPublicationState: "passed",
      },
      pairState: "pending",
      recoveryState: "pair-terminal-authorized",
    });
  });

  it("retains owned reservation-abandoned evidence after the first identity stat fails", async () => {
    const root = await temporaryRepository();
    let injected = false;
    await expect(
      reserveProductionReplayEvidence(root, "2026-07-30T21:00:30.000Z", pending(), {
        beforeOperation: (operation, logicalPath) => {
          if (!injected && operation === "stat" && logicalPath === "json") {
            injected = true;
            return Promise.reject(new Error("first identity stat failed"));
          }
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow();
    const resultRoot = join(root, "harness/results/installer-repair-production-replay");
    const recovery = (await readdir(resultRoot)).find((name) => name.endsWith(".recovery.json"));
    expect(recovery).toBeDefined();
    expect(await readJson(join(resultRoot, recovery ?? ""))).toMatchObject({
      resultOwnership: { publicationState: "reservation-abandoned" },
      state: "reservation-abandoned",
    });
  });

  it("retains abandoned journal evidence when initial validation and close both fail", async () => {
    const root = await temporaryRepository();
    let statInjected = false;
    let closeInjected = false;
    await expect(
      reserveProductionReplayEvidence(root, "2026-07-30T21:00:35.000Z", pending(), {
        beforeOperation: (operation, logicalPath) => {
          if (!statInjected && operation === "stat" && logicalPath === "json") {
            statInjected = true;
            return Promise.reject(new Error("initial validation failed"));
          }
          if (!closeInjected && operation === "close" && logicalPath === "json") {
            closeInjected = true;
            return Promise.reject(new Error("initial close failed"));
          }
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow(/cleanup failed/u);
    const resultRoot = join(root, "harness/results/installer-repair-production-replay");
    const recovery = (await readdir(resultRoot)).find((name) => name.endsWith(".recovery.json"));
    expect(await readJson(join(resultRoot, recovery ?? ""))).toMatchObject({
      resultOwnership: { publicationState: "reservation-abandoned" },
      state: "reservation-abandoned",
    });
  });

  it("rejects an oversized retained file before allocating its body", async () => {
    const root = await temporaryRepository();
    let injected = false;
    await expect(
      reserveProductionReplayEvidence(root, "2026-07-30T21:00:40.000Z", pending(), {
        beforeOperation: async (operation, logicalPath, _attempt, path) => {
          if (!injected && operation === "verify" && logicalPath === "json") {
            injected = true;
            await truncate(path, 16 * 1024 * 1024 + 1);
          }
        },
      }),
    ).rejects.toThrow();
  });

  it("retains an immutable prior pair and selects a collision-safe suffix", async () => {
    const root = await temporaryRepository();
    const startedAt = "2026-07-30T21:01:00.000Z";
    const first = await reserveProductionReplayEvidence(root, startedAt, pending());
    await first.publishTerminal({ ...pending(), state: "failed" }, "failed");
    const firstJson = await readFile(first.jsonPath);
    const firstMarkdown = await readFile(first.markdownPath);

    const second = await reserveProductionReplayEvidence(root, startedAt, pending());
    expect(second.stem).toBe(`${first.stem}-1`);
    expect(second.jsonPath.endsWith(`${second.stem}.json`)).toBe(true);
    expect(second.markdownPath.endsWith(`${second.stem}.md`)).toBe(true);
    expect(second.recoveryPath.endsWith(`${second.stem}.recovery.json`)).toBe(true);
    await second.publishTerminal({ ...pending(), state: "passed" }, "passed");

    expect(await readFile(first.jsonPath)).toEqual(firstJson);
    expect(await readFile(first.markdownPath)).toEqual(firstMarkdown);
  });

  it("retains a structured finalization fallback when the Markdown companion fails", async () => {
    const root = await temporaryRepository();
    let injected = false;
    let recoveryWrites = 0;
    const evidence = await reserveProductionReplayEvidence(
      root,
      "2026-07-30T21:02:00.000Z",
      pending(),
      {
        beforeOperation: (operation, logicalPath) => {
          if (operation === "terminal-write" && logicalPath === "recovery") {
            recoveryWrites += 1;
          }
          if (!injected && operation === "terminal-write" && logicalPath === "markdown") {
            injected = true;
            return Promise.reject(new Error("injected companion failure"));
          }
          return Promise.resolve();
        },
      },
    );

    await expect(
      evidence.publishTerminal({ ...pending(), state: "passed" }, "passed"),
    ).rejects.toThrow(/finalization failed/u);
    expect(await readJson(evidence.jsonPath)).toMatchObject({
      evidenceFailure: {
        causes: [],
        kind: "error",
        message: "injected companion failure",
        operation: "terminal-publication",
      },
      resultOwnership: {
        publicationState: "finalization-failed",
      },
      state: "finalization-failed",
      terminalState: "passed",
    });
    expect(recoveryWrites).toBe(1);
    expect(await adjudicatePaths(evidence)).toEqual({
      pairState: "finalization-failed",
      recoveryState: "pair-terminal-authorized",
      verdict: "authorized-terminal-not-published",
    });
  });

  it.each([
    [
      "terminal JSON",
      "terminal-write",
      "json",
      "pair-terminal-authorized",
      "authorized-terminal-not-published",
      1,
    ],
    [
      "terminal Markdown",
      "terminal-write",
      "markdown",
      "pair-terminal-authorized",
      "authorized-terminal-not-published",
      1,
    ],
    [
      "authorization terminal write",
      "terminal-write",
      "recovery",
      "finalization-failed",
      "finalization-failed",
      2,
    ],
    [
      "terminal flush",
      "flush",
      "json",
      "pair-terminal-authorized",
      "authorized-terminal-not-published",
      1,
    ],
    [
      "Markdown flush",
      "flush",
      "markdown",
      "pair-terminal-authorized",
      "authorized-terminal-not-published",
      1,
    ],
    [
      "retained semantic verification",
      "verify",
      "json",
      "pair-terminal-authorized",
      "authorized-terminal-not-published",
      1,
    ],
    [
      "authorization semantic verification",
      "verify",
      "recovery",
      "finalization-failed",
      "finalization-failed",
      2,
    ],
    ["authorization flush", "flush", "recovery", "finalization-failed", "finalization-failed", 2],
    [
      "first close",
      "close",
      "json",
      "pair-terminal-authorized",
      "authorized-terminal-not-published",
      1,
    ],
    [
      "reopen",
      "reopen",
      "json",
      "pair-terminal-authorized",
      "authorized-terminal-not-published",
      1,
    ],
    [
      "reopen read",
      "reopen-read",
      "markdown",
      "pair-terminal-authorized",
      "authorized-terminal-not-published",
      1,
    ],
  ] as const)("retains actual structured failure for %s", async (_label, operation, logicalPath, expectedRecoveryState, expectedVerdict, expectedRecoveryWrites) => {
    const root = await temporaryRepository();
    let injected = false;
    let armed = false;
    let recoveryWrites = 0;
    const evidence = await reserveProductionReplayEvidence(
      root,
      `2026-07-30T21:03:0${String(cleanup.length)}.000Z`,
      pending(),
      {
        beforeOperation: (candidateOperation, candidatePath) => {
          if (armed && candidateOperation === "terminal-write" && candidatePath === "recovery") {
            recoveryWrites += 1;
          }
          if (
            armed &&
            !injected &&
            candidateOperation === operation &&
            candidatePath === logicalPath
          ) {
            injected = true;
            return Promise.reject(new Error(`injected ${operation} ${logicalPath}`));
          }
          return Promise.resolve();
        },
      },
    );
    armed = true;

    await expect(
      evidence.publishTerminal({ ...pending(), state: "passed" }, "passed"),
    ).rejects.toThrow(/finalization failed/u);
    const recovery = await readJson(evidence.recoveryPath);
    expect(recovery).toMatchObject({ state: expectedRecoveryState });
    if (expectedRecoveryState === "finalization-failed") {
      const record = recovery as Record<string, unknown>;
      expect(record).toMatchObject({
        failure: { operation: "terminal-publication" },
      });
      expect(record.failureSha256).toBe(
        createHash("sha256").update(JSON.stringify(record.failure)).digest("hex"),
      );
      expect(JSON.stringify(recovery)).toContain(`injected ${operation} ${logicalPath}`);
    } else {
      expect(recovery).toMatchObject({
        authorization: { pairPublicationState: "passed" },
        failure: null,
      });
    }
    expect(recoveryWrites).toBe(expectedRecoveryWrites);
    expect(await adjudicatePaths(evidence)).toMatchObject({
      recoveryState: expectedRecoveryState,
      verdict: expectedVerdict,
    });
    if (expectedRecoveryState === "finalization-failed") {
      expect(
        adjudicateProductionReplayEvidence(
          new Uint8Array(),
          new Uint8Array(),
          await readBounded(evidence.recoveryPath, RECOVERY_BYTE_CEILING),
        ),
      ).toEqual({
        pairState: "unreadable",
        recoveryState: "finalization-failed",
        verdict: "finalization-failed",
      });
    }
  });

  it("recovers a pre-authorization truncated journal without treating it as durable authority", async () => {
    const root = await temporaryRepository();
    let armed = false;
    let truncated = false;
    let recoveryWrites = 0;
    const evidence = await reserveProductionReplayEvidence(
      root,
      "2026-07-30T21:03:30.000Z",
      pending(),
      {
        beforeOperation: async (operation, logicalPath, _attempt, path) => {
          if (armed && operation === "terminal-write" && logicalPath === "recovery") {
            recoveryWrites += 1;
          }
          if (armed && !truncated && operation === "flush" && logicalPath === "recovery") {
            truncated = true;
            await truncate(path, 7);
          }
        },
      },
    );
    armed = true;

    await expect(
      evidence.publishTerminal({ ...pending(), state: "passed" }, "passed"),
    ).rejects.toThrow(/finalization failed/u);
    expect(truncated).toBe(true);
    expect(recoveryWrites).toBe(2);
    expect(await adjudicatePaths(evidence)).toEqual({
      pairState: "finalization-failed",
      recoveryState: "finalization-failed",
      verdict: "finalization-failed",
    });
  });

  it("detects hardlink identity changes before terminal publication", async () => {
    const root = await temporaryRepository();
    let linked = false;
    const evidence = await reserveProductionReplayEvidence(
      root,
      "2026-07-30T21:04:00.000Z",
      pending(),
      {
        beforeOperation: async (operation, logicalPath, _attempt, path) => {
          if (!linked && operation === "terminal-write" && logicalPath === "json") {
            linked = true;
            await link(path, `${path}.hardlink`);
          }
        },
      },
    );

    await expect(
      evidence.publishTerminal({ ...pending(), state: "passed" }, "passed"),
    ).rejects.toThrow(/finalization failed/u);
    expect(await readBounded(`${evidence.jsonPath}.hardlink`, JSON_BYTE_CEILING)).toEqual(
      await readBounded(evidence.jsonPath, JSON_BYTE_CEILING),
    );
    await expect(adjudicatePaths(evidence)).rejects.toThrow(
      /Readable terminal pair contradicts its JSON\/Markdown binding/u,
    );
  });

  it("detects pathname replacement during identity-bound reopen and records recovery", async () => {
    const root = await temporaryRepository();
    let replaced = false;
    const evidence = await reserveProductionReplayEvidence(
      root,
      "2026-07-30T21:05:00.000Z",
      pending(),
      {
        beforeOperation: async (operation, logicalPath, _attempt, path) => {
          if (!replaced && operation === "reopen" && logicalPath === "json") {
            replaced = true;
            await rename(path, `${path}.original`);
            await writeFile(path, "{}\n", { flag: "wx" });
          }
        },
      },
    );

    await expect(
      evidence.publishTerminal({ ...pending(), state: "passed" }, "passed"),
    ).rejects.toThrow(/finalization failed/u);
    expect(await readJson(evidence.recoveryPath)).toMatchObject({
      authorization: {
        pairPublicationState: "passed",
      },
      failure: null,
      state: "pair-terminal-authorized",
    });
    await expect(adjudicatePaths(evidence)).rejects.toThrow(
      /Readable terminal JSON contradicts its evidence contract/u,
    );
    const originalJson = await readBounded(`${evidence.jsonPath}.original`, JSON_BYTE_CEILING);
    const currentMarkdown = await readBounded(evidence.markdownPath, MARKDOWN_BYTE_CEILING);
    const currentRecovery = await readBounded(evidence.recoveryPath, RECOVERY_BYTE_CEILING);
    expect(() =>
      adjudicateProductionReplayEvidence(originalJson, currentMarkdown, currentRecovery),
    ).toThrow(/Readable terminal pair contradicts its JSON\/Markdown binding/u);
  });

  it("rejects wrong terminal ownership even when canonical payload bytes still agree", async () => {
    const root = await temporaryRepository();
    let armed = false;
    let injected = false;
    const evidence = await reserveProductionReplayEvidence(
      root,
      "2026-07-30T21:05:30.000Z",
      pending(),
      {
        beforeOperation: async (operation, logicalPath, _attempt, path) => {
          if (armed && !injected && operation === "verify" && logicalPath === "json") {
            injected = true;
            const value = (await readJson(path)) as Record<string, unknown>;
            value.resultReservationId = "wrong-reservation";
            await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
          }
        },
      },
    );
    armed = true;
    await expect(
      evidence.publishTerminal({ ...pending(), state: "passed" }, "passed"),
    ).rejects.toThrow(/finalization failed/u);
    expect(await readJson(evidence.recoveryPath)).toMatchObject({
      state: "pair-terminal-authorized",
    });
    expect(await adjudicatePaths(evidence)).toEqual({
      pairState: "finalization-failed",
      recoveryState: "pair-terminal-authorized",
      verdict: "authorized-terminal-not-published",
    });
  });

  it("retains no nominal passed pair after pair-close and recovery-close failures", async () => {
    const root = await temporaryRepository();
    let armed = false;
    let pairCloseInjected = false;
    let recoveryCloseInjected = false;
    const evidence = await reserveProductionReplayEvidence(
      root,
      "2026-07-30T21:05:40.000Z",
      pending(),
      {
        beforeOperation: (operation, logicalPath) => {
          if (armed && operation === "close" && logicalPath === "json" && !pairCloseInjected) {
            pairCloseInjected = true;
            return Promise.reject(new Error("pair close failed"));
          }
          if (
            armed &&
            operation === "close" &&
            logicalPath === "recovery" &&
            !recoveryCloseInjected
          ) {
            recoveryCloseInjected = true;
            return Promise.reject(new Error("recovery close failed"));
          }
          return Promise.resolve();
        },
      },
    );
    armed = true;
    await expect(
      evidence.publishTerminal({ ...pending(), state: "passed" }, "passed"),
    ).rejects.toThrow(/finalization failed/u);
    expect(await readJson(evidence.jsonPath)).toMatchObject({
      resultOwnership: { publicationState: "finalization-failed" },
      state: "finalization-failed",
      terminalState: "passed",
    });
    expect(await readJson(evidence.recoveryPath)).toMatchObject({
      resultOwnership: { publicationState: "finalization-failed" },
      state: "finalization-failed",
    });
    expect(pairCloseInjected).toBe(true);
    expect(recoveryCloseInjected).toBe(true);
    expect(await adjudicatePaths(evidence)).toEqual({
      pairState: "finalization-failed",
      recoveryState: "finalization-failed",
      verdict: "finalization-failed",
    });
  });

  it.each([
    ["JSON pre-close", "json", "pre"],
    ["JSON post-close", "json", "post"],
    ["Markdown pre-close", "markdown", "pre"],
    ["Markdown post-close", "markdown", "post"],
    ["authorization pre-close", "recovery", "pre"],
    ["authorization post-close", "recovery", "post"],
  ] as const)("adjudicates an actual %s rejection without leaking the owned handle", async (_label, target, timing) => {
    const root = await temporaryRepository();
    let armed = false;
    let injected = false;
    let targetHookCalls = 0;
    const evidence = await reserveProductionReplayEvidence(
      root,
      `2026-07-30T21:05:5${String(cleanup.length)}.000Z`,
      pending(),
      {
        closeOperation: async (logicalPath, _attempt, _path, close) => {
          if (!armed || injected || logicalPath !== target) {
            await close();
            return;
          }
          targetHookCalls += 1;
          injected = true;
          if (timing === "pre") throw new Error(`injected ${target} pre-close`);
          await close();
          throw new Error(`injected ${target} post-close-uncertain`);
        },
      },
    );
    armed = true;
    await expect(
      evidence.publishTerminal({ ...pending(), state: "passed" }, "passed"),
    ).rejects.toThrow(/finalization failed/u);
    expect(injected).toBe(true);
    expect(targetHookCalls).toBe(1);
    expect(await adjudicatePaths(evidence)).toEqual(
      target === "recovery"
        ? {
            pairState: "finalization-failed",
            recoveryState: "finalization-failed",
            verdict: "finalization-failed",
          }
        : {
            pairState: "finalization-failed",
            recoveryState: "pair-terminal-authorized",
            verdict: "authorized-terminal-not-published",
          },
    );
    await expect(rename(evidence.jsonPath, `${evidence.jsonPath}.closed`)).resolves.toBeUndefined();
    await expect(
      rename(evidence.markdownPath, `${evidence.markdownPath}.closed`),
    ).resolves.toBeUndefined();
    await expect(
      rename(evidence.recoveryPath, `${evidence.recoveryPath}.closed`),
    ).resolves.toBeUndefined();
  });

  it("retains an adjudicable authorization or failed pair across combined fallback close faults", async () => {
    const root = await temporaryRepository();
    let armed = false;
    let jsonPrimary = false;
    let markdownFallback = false;
    let markdownCloses = 0;
    let recoveryWrites = 0;
    const evidence = await reserveProductionReplayEvidence(
      root,
      "2026-07-30T21:05:59.000Z",
      pending(),
      {
        beforeOperation: async (operation, logicalPath) => {
          if (armed && operation === "terminal-write" && logicalPath === "recovery") {
            recoveryWrites += 1;
          }
        },
        closeOperation: async (logicalPath, _attempt, _path, close) => {
          if (!armed) {
            await close();
            return;
          }
          if (logicalPath === "json" && !jsonPrimary) {
            jsonPrimary = true;
            throw new Error("primary pair close failed");
          }
          if (logicalPath === "markdown") {
            markdownCloses += 1;
            if (jsonPrimary && !markdownFallback && markdownCloses >= 2) {
              markdownFallback = true;
              await close();
              throw new Error("fallback markdown close uncertain");
            }
          }
          await close();
        },
      },
    );
    armed = true;
    await expect(
      evidence.publishTerminal({ ...pending(), state: "passed" }, "passed"),
    ).rejects.toThrow(/finalization failed/u);
    expect(jsonPrimary).toBe(true);
    expect(markdownFallback).toBe(true);
    expect(markdownCloses).toBe(2);
    expect(recoveryWrites).toBe(1);
    expect(await adjudicatePaths(evidence)).toEqual({
      pairState: "finalization-failed",
      recoveryState: "pair-terminal-authorized",
      verdict: "authorized-terminal-not-published",
    });
  });

  it("retains a failed pair when authorization close and fallback recovery close both reject", async () => {
    const root = await temporaryRepository();
    let armed = false;
    let recoveryCloseCalls = 0;
    const evidence = await reserveProductionReplayEvidence(
      root,
      "2026-07-30T21:05:58.000Z",
      pending(),
      {
        closeOperation: async (logicalPath, _attempt, _path, close) => {
          if (!armed || logicalPath !== "recovery") {
            await close();
            return;
          }
          recoveryCloseCalls += 1;
          if (recoveryCloseCalls === 1) {
            throw new Error("authorization pre-close failed");
          }
          if (recoveryCloseCalls === 3) {
            await close();
            throw new Error("fallback recovery post-close uncertain");
          }
          await close();
        },
      },
    );
    armed = true;
    await expect(
      evidence.publishTerminal({ ...pending(), state: "passed" }, "passed"),
    ).rejects.toThrow(/finalization failed/u);
    expect(await readJson(evidence.jsonPath)).toMatchObject({
      state: "finalization-failed",
    });
    expect(await readJson(evidence.recoveryPath)).toMatchObject({
      failureSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      state: "finalization-failed",
    });
    expect(recoveryCloseCalls).toBe(3);
    expect(await adjudicatePaths(evidence)).toEqual({
      pairState: "finalization-failed",
      recoveryState: "finalization-failed",
      verdict: "finalization-failed",
    });
  });

  it("redacts paths, URLs, authentication, query secrets, controls, and Markdown delimiters", () => {
    const nested = new AggregateError(
      [
        new Error(
          "C:\\Users\\person\\secret.txt \\\\server\\share\\secret /home/person/private " +
            "file:///C:/private/key https://user:pass@example.test/path?token=abc " +
            "Authorization: Bearer abc password=hunter2\n`code`\u0000",
        ),
      ],
      "outer",
    );
    const text = JSON.stringify(sanitizeProductionReplayFailure(nested));

    expect(text).not.toMatch(
      /person|server|share|private|user:pass|token=abc|Bearer abc|hunter2|\\|`|\n/u,
    );
    expect(text).not.toContain(String.fromCharCode(0));
    expect(text).toContain("<path>");
  });

  it("bounds cyclic aggregate causes and unfolds injected headers without residual secrets", () => {
    const cyclic = new Error("Authorization:\r\n Bearer folded-secret /private/file");
    Object.defineProperty(cyclic, "cause", { value: cyclic });
    const aggregate = new AggregateError([cyclic, cyclic], "https://example.test/?token=secret");
    const text = JSON.stringify(sanitizeProductionReplayFailure(aggregate, "C:\\private\\op"));

    expect(text).toContain("cause-cycle");
    expect(text).not.toMatch(/folded-secret|private|example\.test|token=secret|\\|\r|\n|`/u);
  });

  it.each([
    {
      label: "hostile toString",
      value: Object.freeze({
        toString() {
          throw new Error("secret from hostile conversion");
        },
      }),
    },
    {
      label: "quoted and spaced paths",
      value: new Error(
        "\"C:\\Users\\private person\\quoted secret.txt\" '/home/private person/quoted secret'",
      ),
    },
    {
      label: "unquoted spaced paths",
      value: new Error(
        "C:\\Users\\private person\\unquoted secret.txt /home/private person/unquoted secret",
      ),
    },
    {
      label: "C1 bidi and zero width",
      value: new Error(
        `Authorization:\u0085 Basic hidden\u061csecret\u00advalue\u180e\u202e\u2066\u200b password=hidden`,
      ),
    },
  ])("sanitizer is total and residual-safe for $label", ({ value }) => {
    expect(() => sanitizeProductionReplayFailure(value)).not.toThrow();
    const text = JSON.stringify(sanitizeProductionReplayFailure(value));
    expect(text).not.toMatch(
      /private person|quoted secret|unquoted secret|hidden|secret from hostile|[\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u,
    );
  });

  it("sanitizes secret-bearing error names and operation labels through the message policy", () => {
    const error = new Error("safe");
    error.name = "token=hidden-name";
    const text = JSON.stringify(
      sanitizeProductionReplayFailure(error, "stage secret=hidden-stage Digest hidden-digest"),
    );
    expect(text).not.toMatch(/hidden-name|hidden-stage|hidden-digest|\p{Cc}|\p{Cf}/u);
    expect(text).toContain("<redacted>");
  });

  it("joins security-format controls before redacting full secret suffixes in every label", () => {
    const error = new Error("pass\u200bword=hunt\u200ber2 token=sensitive\u200b-secret");
    error.name = "to\u200bken=name\u200b-secret";
    const text = JSON.stringify(
      sanitizeProductionReplayFailure(error, "operation pass\u200bword=operation\u200b-secret"),
    );

    expect(text).not.toMatch(
      /hunter2|hunt|er2|sensitive-secret|name-secret|operation-secret|\p{Cc}|\p{Cf}/u,
    );
    expect(text.match(/<redacted>/gu)?.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps retained schema-v1 attempts parseable while binding schema-v3 exactly", () => {
    expect(() =>
      parseProductionReplayEvidence(
        bindProductionReplayEvidence({ schemaVersion: 1, state: "passed" }),
      ),
    ).toThrow(/missing keys/u);
    const bound = bindProductionReplayEvidence({
      command: "pnpm harness:installer-repair-production-replay",
      schemaVersion: 3,
      state: "failed",
    });
    expect(() => parseProductionReplayEvidence(bound)).toThrow(/reservation is invalid/u);
  });

  it("pins both immutable retained v1 pairs and rejects any byte mutation", async () => {
    const pairs = [
      {
        expectation: RETAINED_PRODUCTION_REPLAY_V1_FAILED,
        root: "harness/results/installer-repair-production-replay/installer-repair-production-replay-v1-2026-07-30T20-49-50Z",
      },
      {
        expectation: RETAINED_PRODUCTION_REPLAY_V1_PASSED,
        root: "harness/results/installer-repair-production-replay/installer-repair-production-replay-v1-2026-07-30T20-50-43Z",
      },
    ] as const;
    for (const pair of pairs) {
      const json = await readFile(join(process.cwd(), pair.root, "result.json"));
      const markdown = await readFile(join(process.cwd(), pair.root, "result.md"));
      expect(validateRetainedLegacyV1Pair(json, markdown, pair.expectation)).toMatchObject({
        state: pair.expectation.state,
      });
      const mutated = json.slice();
      mutated[0] = (mutated[0] ?? 0) ^ 1;
      expect(() => validateRetainedLegacyV1Pair(mutated, markdown, pair.expectation)).toThrow(
        /digest differs/u,
      );
    }
  });

  it("keeps the retained failed v3 legacy-named trio immutable and adjudicable", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-repair-production-replay",
      "installer-repair-production-replay-v3-2026-07-30T22-33-55-567Z",
    );
    const json = await readBounded(`${root}.json.json`, JSON_BYTE_CEILING);
    const markdown = await readBounded(`${root}.md`, MARKDOWN_BYTE_CEILING);
    const recovery = await readBounded(`${root}.recovery.json`, RECOVERY_BYTE_CEILING);
    expect(createHash("sha256").update(json).digest("hex")).toBe(
      "a48561987e58aa87563c354d5da818ec1ae63f7dfd89c6db8fa157c7277acd76",
    );
    expect(createHash("sha256").update(markdown).digest("hex")).toBe(
      "38cf642e3b60de77fcd8c79b69678a9fc097cfa69c0cc66f2f40cfcc58408382",
    );
    expect(createHash("sha256").update(recovery).digest("hex")).toBe(
      "f7ba4904e8579a759605e1878c7e16df28115f6ca71451d0db71bc4082f85925",
    );
    expect(
      (JSON.parse(Buffer.from(json).toString("utf8")) as Record<string, unknown>).canonicalBinding,
    ).toMatchObject({
      payloadSha256: "e2919213d05e1fb5d3cbfc50dfcd4636c31de12287ca157319af1d31c765c8cc",
    });
    expect(adjudicateProductionReplayEvidence(json, markdown, recovery)).toEqual({
      pairState: "failed",
      recoveryState: "pair-terminal-authorized",
      verdict: "authorized-terminal",
    });
  });

  it("keeps the retained failed v4 contract-drift trio immutable and adjudicable", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-repair-production-replay",
      "installer-repair-production-replay-v4-2026-07-31T01-01-10-795Z",
    );
    const json = await readBounded(`${root}.json`, JSON_BYTE_CEILING);
    const markdown = await readBounded(`${root}.md`, MARKDOWN_BYTE_CEILING);
    const recovery = await readBounded(`${root}.recovery.json`, RECOVERY_BYTE_CEILING);
    expect(createHash("sha256").update(json).digest("hex")).toBe(
      "425d4b9a433a5aa49475c54d7dd205423f33619bff68f5b0bf0e249b73dc2a65",
    );
    expect(createHash("sha256").update(markdown).digest("hex")).toBe(
      "f87d631dee7047e8a0319f561dd92ead510be4eabc12d1f7730de6ba9675755b",
    );
    expect(createHash("sha256").update(recovery).digest("hex")).toBe(
      "ef127dcc5e6f2254ce773ad1b43be0928fd421ffb29e93bd807213920db547db",
    );
    expect(
      (JSON.parse(Buffer.from(json).toString("utf8")) as Record<string, unknown>).canonicalBinding,
    ).toMatchObject({
      payloadSha256: "e79c1bea16107bab72646fff81c5c295f912fb35cccec483ec63845f166dcd44",
    });
    expect(adjudicateProductionReplayEvidence(json, markdown, recovery)).toEqual({
      pairState: "failed",
      recoveryState: "pair-terminal-authorized",
      verdict: "authorized-terminal",
    });
  });

  it("keeps the retained failed v4 cross-mode-assertion trio immutable and adjudicable", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-repair-production-replay",
      "installer-repair-production-replay-v4-2026-07-31T01-18-29-091Z",
    );
    const json = await readBounded(`${root}.json`, JSON_BYTE_CEILING);
    const markdown = await readBounded(`${root}.md`, MARKDOWN_BYTE_CEILING);
    const recovery = await readBounded(`${root}.recovery.json`, RECOVERY_BYTE_CEILING);
    expect(createHash("sha256").update(json).digest("hex")).toBe(
      "1b869dbe36b14aa8f6d08c622c14aedb6472aad3269f251df354543cd2818bfe",
    );
    expect(createHash("sha256").update(markdown).digest("hex")).toBe(
      "a82340cf7d60f690069f6488dbb7452684f28e8da4e51ae96fea20cb963382d8",
    );
    expect(createHash("sha256").update(recovery).digest("hex")).toBe(
      "b54cb24edbae1799b8bcc05b372a16307f0ca35f62c955cc69decdd81c449673",
    );
    expect(
      (JSON.parse(Buffer.from(json).toString("utf8")) as Record<string, unknown>).canonicalBinding,
    ).toMatchObject({
      payloadSha256: "9c90399eebbe8d9046aeb5f70fef5d8fa4b341924afffcd0f02ad009a76fc32f",
    });
    expect(adjudicateProductionReplayEvidence(json, markdown, recovery)).toEqual({
      pairState: "failed",
      recoveryState: "pair-terminal-authorized",
      verdict: "authorized-terminal",
    });
  });

  it("pins the accepted restarted v3 pass trio, adjudication, and exact semantic facts", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-repair-production-replay",
      "installer-repair-production-replay-v3-2026-07-30T22-54-15-321Z",
    );
    const json = await readBounded(`${root}.json`, JSON_BYTE_CEILING);
    const markdown = await readBounded(`${root}.md`, MARKDOWN_BYTE_CEILING);
    const recovery = await readBounded(`${root}.recovery.json`, RECOVERY_BYTE_CEILING);
    expect(createHash("sha256").update(json).digest("hex")).toBe(
      "510a93890370f2ed657624620dc57705cb0dec45f010f4c5dc5ca5bb083fd89e",
    );
    expect(createHash("sha256").update(markdown).digest("hex")).toBe(
      "91632044c7bcddae9c1abb7666b97977dd23358d08934301afca80d656c7cb91",
    );
    expect(createHash("sha256").update(recovery).digest("hex")).toBe(
      "8db028240368c94f4037a7742cfcac261092883e2bb5ccc3f612f60705767337",
    );
    const parsed = JSON.parse(Buffer.from(json).toString("utf8")) as {
      readonly canonicalBinding: { readonly payloadSha256: string };
      readonly replay: {
        readonly buildManifestSha256: string;
        readonly installManifestSha256: string;
        readonly opfsBytes: number;
        readonly opfsResourceCount: number;
        readonly postValidation: {
          readonly activeReleaseDigest: string;
          readonly publication: { readonly count: number };
          readonly secondCorruptionRejected: boolean;
        };
        readonly worker: {
          readonly transferTelemetry: {
            readonly completedResourceCount: number;
            readonly operationRepairedBytes: number;
            readonly operationRepairedResourceCount: number;
            readonly verifiedBytes: number;
          };
        };
      };
      readonly state: string;
    };
    expect(parsed).toMatchObject({
      canonicalBinding: {
        payloadSha256: "040f8213c7c7ee7392f66701b75a03b31681afa04715f1fdef46b99efad275df",
      },
      replay: {
        buildManifestSha256: "fa116bce825e3b5318cc776674234c4e79c0ce84dd3c38143555afe87edae42a",
        installManifestSha256: "5a6e1a915018b647db351639065dfb6a6ac52f250dccd612d0949e78b58650e7",
        opfsBytes: 2_621_434_134,
        opfsResourceCount: 263,
        postValidation: {
          activeReleaseDigest: "5a6e1a915018b647db351639065dfb6a6ac52f250dccd612d0949e78b58650e7",
          publication: { count: 1 },
          secondCorruptionRejected: true,
        },
        worker: {
          transferTelemetry: {
            completedResourceCount: 0,
            operationRepairedBytes: 2432,
            operationRepairedResourceCount: 1,
            verifiedBytes: 0,
          },
        },
      },
      state: "passed",
    });
    expect(adjudicateProductionReplayEvidence(json, markdown, recovery)).toEqual({
      pairState: "passed",
      recoveryState: "pair-terminal-authorized",
      verdict: "authorized-terminal",
    });
    const pinnedDigests = [
      "510a93890370f2ed657624620dc57705cb0dec45f010f4c5dc5ca5bb083fd89e",
      "91632044c7bcddae9c1abb7666b97977dd23358d08934301afca80d656c7cb91",
      "8db028240368c94f4037a7742cfcac261092883e2bb5ccc3f612f60705767337",
    ] as const;
    for (const [index, bytes] of [json, markdown, recovery].entries()) {
      const mutated = bytes.slice();
      mutated[index % mutated.byteLength] = (mutated[index % mutated.byteLength] ?? 0) ^ 1;
      expect(createHash("sha256").update(mutated).digest("hex")).not.toBe(pinnedDigests[index]);
    }
  });
});

function pending(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    command: "pnpm harness:installer-repair-production-replay",
    completedAt: null,
    durationMs: null,
    failure: null,
    schemaVersion: 3,
    startedAt: "2026-07-30T21:00:00.000Z",
    state: "pending",
  });
}

async function temporaryRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "parallax-repair-evidence-"));
  cleanup.push(root);
  return root;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readBounded(path: string, ceiling: number): Promise<Uint8Array> {
  const handle = await open(path, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > ceiling) {
      throw new Error(`Test evidence exceeds its byte ceiling: ${path}`);
    }
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (bytesRead === 0) throw new Error(`Test evidence read was short: ${path}`);
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== before.size || after.size > ceiling) {
      throw new Error(`Test evidence changed during bounded read: ${path}`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function adjudicatePaths(evidence: {
  readonly jsonPath: string;
  readonly markdownPath: string;
  readonly recoveryPath: string;
}): Promise<ReturnType<typeof adjudicateProductionReplayEvidence>> {
  return adjudicateProductionReplayEvidence(
    await readBounded(evidence.jsonPath, JSON_BYTE_CEILING),
    await readBounded(evidence.markdownPath, MARKDOWN_BYTE_CEILING),
    await readBounded(evidence.recoveryPath, RECOVERY_BYTE_CEILING),
  );
}

function rebindRecoveryRecord(record: Record<string, unknown>): Uint8Array {
  const reservationId = String(record.resultReservationId);
  const resultOwnership = record.resultOwnership;
  const base = { ...record };
  delete base.canonicalBinding;
  delete base.resultOwnership;
  delete base.resultReservationId;
  const bound = bindProductionReplayEvidence(base);
  return Buffer.from(
    `${JSON.stringify(
      {
        resultReservationId: reservationId,
        ...bound,
        resultOwnership,
      },
      null,
      2,
    )}\n`,
  );
}
