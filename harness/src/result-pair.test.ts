import {
  access,
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ResultPairPublicationError, reserveResultPair } from "./result-pair";

const cleanup: string[] = [];
type ResultLogicalPathForTest = "result-json" | "result-markdown";

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("owned result-pair evidence", () => {
  it("reserves a second owned pair after the first pair has already published", async () => {
    const root = await resultRoot();
    const startedAt = "2026-07-29T20:00:00.000Z";
    const first = await reserveResultPair(root, startedAt, {
      schemaVersion: 4,
      state: "pending",
    });
    expect(first.stem).toBe("result-v4-2026-07-29T20-00-00-000Z");
    await first.publishPair({ state: "passed" }, "# Result\n\n- State: `passed`\n", "passed");
    const firstJson = await readFile(first.jsonPath);
    const firstMarkdown = await readFile(first.markdownPath);

    const second = await reserveResultPair(root, startedAt, {
      schemaVersion: 4,
      state: "pending",
    });
    await second.publishPair(
      { failure: { primary: "second failed" }, state: "failed" },
      "# Result\n\n- State: `failed`\n",
      "failed",
    );

    expect(second.stem).toBe(`${first.stem}-1`);
    expect(await readFile(first.jsonPath)).toEqual(firstJson);
    expect(await readFile(first.markdownPath)).toEqual(firstMarkdown);
  });

  it("derives the result stem from the pending schema and rejects invalid schemas", async () => {
    const root = await resultRoot();
    const reservation = await reserveResultPair(root, "2026-07-29T20:00:30.000Z", {
      schemaVersion: 8,
      state: "pending",
    });
    expect(reservation.stem).toBe("result-v8-2026-07-29T20-00-30-000Z");
    await reservation.close();
    for (const schemaVersion of [undefined, 0, -1, 1.5]) {
      await expect(
        reserveResultPair(root, "2026-07-29T20:00:31.000Z", {
          schemaVersion,
          state: "pending",
        }),
      ).rejects.toThrow(/schema/);
    }
  });

  it("closes an aborted setup reservation without performing late abandonment writes", async () => {
    const root = await resultRoot();
    const controller = new AbortController();
    const closed: string[] = [];
    const aborted = new Error("injected reservation abort");
    await expect(
      reserveResultPair(
        root,
        "2026-07-29T20:00:40.000Z",
        { schemaVersion: 4, state: "pending" },
        {
          afterHandleClose: async (_path, logicalPath) => {
            closed.push(logicalPath);
          },
          afterPairCreate: async () => controller.abort(aborted),
          signal: controller.signal,
        },
      ),
    ).rejects.toBe(aborted);
    expect(closed.sort()).toEqual(["result-json", "result-markdown"]);
    const retained = await Promise.all(
      (await readdir(root)).map((name) => readFile(join(root, name), "utf8")),
    );
    expect(retained).toHaveLength(2);
    expect(retained.every((text) => text.includes("pending"))).toBe(true);
    expect(retained.every((text) => !text.includes("reservation-abandoned"))).toBe(true);
  });

  it("gives concurrent reservations distinct fully owned JSON and Markdown pairs", async () => {
    const root = await resultRoot();
    const startedAt = "2026-07-29T20:01:00.000Z";
    const reservations = await Promise.all(
      Array.from({ length: 4 }, () =>
        reserveResultPair(root, startedAt, { schemaVersion: 4, state: "pending" }),
      ),
    );

    expect(new Set(reservations.map((reservation) => reservation.stem))).toHaveLength(4);
    for (const reservation of reservations) {
      const json = await readFile(reservation.jsonPath, "utf8");
      const markdown = await readFile(reservation.markdownPath, "utf8");
      expect(json).toContain(reservation.ownership.reservationId);
      expect(markdown).toContain(reservation.ownership.reservationId);
    }
    await Promise.all(reservations.map((reservation) => reservation.close()));
  });

  it("removes only its partial JSON placeholder when Markdown creation collides", async () => {
    const root = await resultRoot();
    const startedAt = "2026-07-29T20:02:00.000Z";
    const stem = "result-v4-2026-07-29T20-02-00-000Z";
    const existingMarkdown = Buffer.from("# Unrelated retained result\n");
    const collidingMarkdownPath = join(root, `${stem}.md`);
    const collidingJsonPath = join(root, `${stem}.json`);
    await writeFile(collidingMarkdownPath, existingMarkdown, { flag: "wx" });

    const reservation = await reserveResultPair(root, startedAt, {
      schemaVersion: 4,
      state: "pending",
    });

    expect(reservation.stem).toBe(`${stem}-1`);
    await expect(readJson(collidingJsonPath)).resolves.toMatchObject({
      resultOwnership: {
        failure: { code: "EEXIST", path: "result-markdown" },
        publicationState: "reservation-abandoned",
      },
      state: "reservation-abandoned",
    });
    expect(await readFile(collidingMarkdownPath)).toEqual(existingMarkdown);
    await reservation.close();
  });

  it("fails closed after bounded suffix exhaustion without changing unrelated bytes", async () => {
    const root = await resultRoot();
    const startedAt = "2026-07-29T20:03:00.000Z";
    const baseStem = "result-v4-2026-07-29T20-03-00-000Z";
    const existing = Buffer.from("# Existing\n");
    for (let ordinal = 0; ordinal < 100; ordinal += 1) {
      const stem = ordinal === 0 ? baseStem : `${baseStem}-${ordinal}`;
      await writeFile(join(root, `${stem}.md`), existing, { flag: "wx" });
    }

    await expect(
      reserveResultPair(root, startedAt, { schemaVersion: 4, state: "pending" }),
    ).rejects.toThrow(/exhausted 100 result-pair suffixes/);
    for (let ordinal = 0; ordinal < 100; ordinal += 1) {
      const stem = ordinal === 0 ? baseStem : `${baseStem}-${ordinal}`;
      expect(await readFile(join(root, `${stem}.md`))).toEqual(existing);
      await expect(readJson(join(root, `${stem}.json`))).resolves.toMatchObject({
        resultOwnership: { publicationState: "reservation-abandoned" },
        state: "reservation-abandoned",
      });
    }
  });

  it("publishes passed and failed pairs with matching ownership and terminal state", async () => {
    const root = await resultRoot();
    const passed = await reserveResultPair(root, "2026-07-29T20:04:00.000Z", {
      schemaVersion: 4,
      state: "pending",
    });
    const failed = await reserveResultPair(root, "2026-07-29T20:05:00.000Z", {
      schemaVersion: 4,
      state: "pending",
    });
    await passed.publishPair({ state: "passed" }, "# Result\n\n- State: `passed`\n", "passed");
    await failed.publishPair(
      { failure: { primary: "failed" }, state: "failed" },
      "# Result\n\n- State: `failed`\n",
      "failed",
    );

    await expectOwnedPair(passed, "passed");
    await expectOwnedPair(failed, "failed");
  });

  it("restores both owned placeholders after one terminal write fails, then records failure", async () => {
    const root = await resultRoot();
    let failPassedMarkdown = true;
    const reservation = await reserveResultPair(
      root,
      "2026-07-29T20:06:00.000Z",
      { schemaVersion: 4, state: "pending" },
      {
        beforeOwnedWrite: (path, state) => {
          if (failPassedMarkdown && path.endsWith(".md") && state === "passed") {
            failPassedMarkdown = false;
            return Promise.reject(new Error("injected Markdown finalization failure"));
          }
          return Promise.resolve();
        },
      },
    );

    await expect(
      reservation.publishPair({ state: "passed" }, "# Result\n\n- State: `passed`\n", "passed"),
    ).rejects.toMatchObject({
      phase: "markdown",
      recoveryFailures: [],
    });
    const recoveredJson = readJson(reservation.jsonPath);
    await expect(recoveredJson).resolves.toMatchObject({
      resultOwnership: {
        failurePhase: "markdown",
        publicationState: "finalization-failed",
        reservationId: reservation.ownership.reservationId,
        terminalState: "passed",
      },
      schemaVersion: 4,
      state: "pending",
    });
    expect(await readFile(reservation.markdownPath, "utf8")).toContain(
      "- Publication state: `finalization-failed`",
    );

    await reservation.publishPair(
      { failure: { primary: "finalization failed" }, state: "failed" },
      "# Result\n\n- State: `failed`\n",
      "failed",
    );
    await expectOwnedPair(reservation, "failed");
  });

  it("retains terminal JSON as primary when an opted-in Markdown companion fails", async () => {
    const root = await resultRoot();
    let failMarkdown = true;
    const reservation = await reserveResultPair(
      root,
      "2026-07-29T20:06:05.000Z",
      { schemaVersion: 4, state: "pending" },
      {
        beforeOwnedWrite: (path, state) => {
          if (failMarkdown && path.endsWith(".md") && state === "passed") {
            failMarkdown = false;
            return Promise.reject(new Error("injected companion failure"));
          }
          return Promise.resolve();
        },
      },
      "installer-trust-faults",
      "Installer trust + fault qualification",
    );

    await expect(
      reservation.publishPair(
        { canonicalBinding: { sha256: "a".repeat(64) }, state: "passed" },
        "# Result\n\n- State: `passed`\n",
        "passed",
        { retainJsonPrimaryOnMarkdownFailure: true },
      ),
    ).rejects.toMatchObject({ phase: "markdown" });
    await expect(readJson(reservation.jsonPath)).resolves.toMatchObject({
      canonicalBinding: { sha256: "a".repeat(64) },
      resultOwnership: {
        publicationState: "passed",
      },
      state: "passed",
    });
    const fallbackMarkdown = await readFile(reservation.markdownPath, "utf8");
    expect(fallbackMarkdown).toContain("# Installer trust + fault qualification");
    expect(fallbackMarkdown).not.toContain("Harness result");
    expect(fallbackMarkdown).toContain("- Primary terminal JSON retained: `true`");
  });

  it("persists failed JSON before an opted-in Markdown formatter runs", async () => {
    const root = await resultRoot();
    const reservation = await reserveResultPair(root, "2026-07-29T20:06:06.000Z", {
      schemaVersion: 4,
      state: "pending",
    });

    await expect(
      reservation.publishPair(
        { failure: { primary: "runtime failed" }, schemaVersion: 4, state: "failed" },
        () => {
          throw new Error("injected formatter failure");
        },
        "failed",
        { retainJsonPrimaryOnMarkdownFailure: true },
      ),
    ).rejects.toMatchObject({ phase: "markdown" });
    await expect(readJson(reservation.jsonPath)).resolves.toMatchObject({
      failure: { primary: "runtime failed" },
      resultOwnership: { publicationState: "failed" },
      schemaVersion: 4,
      state: "failed",
    });
    expect(await readFile(reservation.markdownPath, "utf8")).toContain(
      "- Primary terminal JSON retained: `true`",
    );
  });

  it.each([
    ["first", ["result-json"]],
    ["second", ["result-markdown"]],
    ["both", ["result-json", "result-markdown"]],
  ] as const)("restores a matching failure pair and closes every handle after %s close failure", async (_label, failingPaths) => {
    const root = await resultRoot();
    const failOnce = new Set<ResultLogicalPathForTest>(failingPaths);
    const reservation = await reserveResultPair(
      root,
      `2026-07-29T20:06:1${failingPaths.length}.000Z`,
      { schemaVersion: 4, state: "pending" },
      {
        beforeHandleClose: (_path, logicalPath, attempt) => {
          if (attempt === 1 && failOnce.has(logicalPath)) {
            return Promise.reject(new Error(`injected ${logicalPath} close failure`));
          }
          return Promise.resolve();
        },
      },
    );

    await expect(
      reservation.publishPair({ state: "passed" }, "# Result\n\n- State: `passed`\n", "passed"),
    ).rejects.toMatchObject({
      phase: "close",
      recoveryFailures: failingPaths.map((path) => ({ path })),
    });
    await expect(readJson(reservation.jsonPath)).resolves.toMatchObject({
      resultOwnership: {
        failurePhase: "close",
        publicationState: "finalization-failed",
        terminalState: "passed",
      },
      schemaVersion: 4,
      state: "pending",
    });
    expect(await readFile(reservation.markdownPath, "utf8")).toContain(
      "- Publication state: `finalization-failed`",
    );

    await reservation.publishPair(
      { failure: { primary: "close failed" }, state: "failed" },
      "# Result\n\n- State: `failed`\n",
      "failed",
    );
    await expectOwnedPair(reservation, "failed");
    expect(reservation.handleState()).toEqual({
      jsonClosed: true,
      markdownClosed: true,
    });
    await reservation.close();
    expect(reservation.handleState()).toEqual({
      jsonClosed: true,
      markdownClosed: true,
    });
  });

  it("retains a publication recovery failure, leaves a swapped path untouched, and closes both handles", async () => {
    const root = await resultRoot();
    const unrelated = Buffer.from('{"state":"unrelated-replacement"}\n');
    let injected = false;
    let reservation: Awaited<ReturnType<typeof reserveResultPair>> | undefined;
    reservation = await reserveResultPair(
      root,
      "2026-07-29T20:06:20.000Z",
      { schemaVersion: 4, state: "pending" },
      {
        beforeOwnedWrite: async (path, state) => {
          if (
            !injected &&
            reservation !== undefined &&
            path.endsWith(".md") &&
            state === "passed"
          ) {
            injected = true;
            await rm(reservation.jsonPath);
            await writeFile(reservation.jsonPath, unrelated, { flag: "wx" });
            throw new Error("injected Markdown publication failure");
          }
        },
      },
    );

    await expect(
      reservation.publishPair({ state: "passed" }, "# Result\n\n- State: `passed`\n", "passed"),
    ).rejects.toMatchObject({
      phase: "markdown",
      recoveryFailures: [{ path: "result-json" }],
    });
    expect(await readFile(reservation.jsonPath)).toEqual(unrelated);
    expect(await readFile(reservation.markdownPath, "utf8")).toContain(
      "- Publication state: `finalization-failed`",
    );
    await reservation.close();
    expect(reservation.handleState()).toEqual({
      jsonClosed: true,
      markdownClosed: true,
    });
  });

  it("rejects an actual JSON-to-Markdown hardlink replacement without writing either path", async () => {
    const root = await resultRoot();
    const reservation = await reserveResultPair(root, "2026-07-29T20:07:00.000Z", {
      schemaVersion: 4,
      state: "pending",
    });
    const markdown = await readFile(reservation.markdownPath);
    await rm(reservation.jsonPath);
    await link(reservation.markdownPath, reservation.jsonPath);

    const publication = expect(
      reservation.publishPair({ state: "passed" }, "# Result\n\n- State: `passed`\n", "passed"),
    ).rejects;
    await publication.toBeInstanceOf(ResultPairPublicationError);
    await publication.toMatchObject({
      recoveryFailures: [{ path: "result-json" }, { path: "result-markdown" }],
    });
    expect(await readFile(reservation.jsonPath)).toEqual(markdown);
    expect(await readFile(reservation.markdownPath)).toEqual(markdown);
    await reservation.close();
  });

  it("rejects an extra hardlink while leaving both linked bytes unchanged", async () => {
    const root = await resultRoot();
    const reservation = await reserveResultPair(root, "2026-07-29T20:08:00.000Z", {
      schemaVersion: 4,
      state: "pending",
    });
    const extra = join(root, "extra-json-link");
    const json = await readFile(reservation.jsonPath);
    await link(reservation.jsonPath, extra);

    await expect(
      reservation.publishPair({ state: "passed" }, "# Result\n\n- State: `passed`\n", "passed"),
    ).rejects.toBeInstanceOf(ResultPairPublicationError);
    expect(await readFile(reservation.jsonPath)).toEqual(json);
    expect(await readFile(extra)).toEqual(json);
    await reservation.close();
  });

  it("rejects a regular path replacement and leaves the unrelated replacement unchanged", async () => {
    const root = await resultRoot();
    const reservation = await reserveResultPair(root, "2026-07-29T20:09:00.000Z", {
      schemaVersion: 4,
      state: "pending",
    });
    const unrelated = Buffer.from('{"state":"unrelated"}\n');
    await rm(reservation.jsonPath);
    await writeFile(reservation.jsonPath, unrelated, { flag: "wx" });

    await expect(
      reservation.publishPair({ state: "passed" }, "# Result\n\n- State: `passed`\n", "passed"),
    ).rejects.toBeInstanceOf(ResultPairPublicationError);
    expect(await readFile(reservation.jsonPath)).toEqual(unrelated);
    await reservation.close();
  });

  it("rejects a copied-token impostor by file identity and leaves it unchanged", async () => {
    const root = await resultRoot();
    const reservation = await reserveResultPair(root, "2026-07-29T20:10:00.000Z", {
      schemaVersion: 4,
      state: "pending",
    });
    const copied = await readFile(reservation.jsonPath);
    await rm(reservation.jsonPath);
    await writeFile(reservation.jsonPath, copied, { flag: "wx" });

    await expect(
      reservation.publishPair({ state: "passed" }, "# Result\n\n- State: `passed`\n", "passed"),
    ).rejects.toBeInstanceOf(ResultPairPublicationError);
    expect(await readFile(reservation.jsonPath)).toEqual(copied);
    await reservation.close();
  });

  it("rejects a file symlink replacement when Windows permits creating one", async () => {
    const root = await resultRoot();
    const reservation = await reserveResultPair(root, "2026-07-29T20:11:00.000Z", {
      schemaVersion: 4,
      state: "pending",
    });
    const target = join(root, "symlink-target.json");
    const targetBytes = Buffer.from('{"state":"symlink-target"}\n');
    await writeFile(target, targetBytes, { flag: "wx" });
    await rm(reservation.jsonPath);
    try {
      await symlink(target, reservation.jsonPath, "file");
    } catch (error: unknown) {
      await reservation.close();
      if (isWindowsSymlinkPrivilegeError(error)) return;
      throw error;
    }

    await expect(
      reservation.publishPair({ state: "passed" }, "# Result\n\n- State: `passed`\n", "passed"),
    ).rejects.toBeInstanceOf(ResultPairPublicationError);
    expect(await readFile(target)).toEqual(targetBytes);
    await reservation.close();
  });

  it("rejects a junction replacement and leaves its target directory unchanged", async () => {
    const root = await resultRoot();
    const reservation = await reserveResultPair(root, "2026-07-29T20:12:00.000Z", {
      schemaVersion: 4,
      state: "pending",
    });
    const target = join(root, "junction-target");
    const sentinel = join(target, "sentinel.txt");
    await mkdir(target);
    await writeFile(sentinel, "sentinel", { flag: "wx" });
    await rm(reservation.jsonPath);
    await symlink(target, reservation.jsonPath, "junction");

    await expect(
      reservation.publishPair({ state: "passed" }, "# Result\n\n- State: `passed`\n", "passed"),
    ).rejects.toBeInstanceOf(ResultPairPublicationError);
    expect(await readFile(sentinel, "utf8")).toBe("sentinel");
    await reservation.close();
  });

  it("retains and closes a newly created result when its initial handle stat fails", async () => {
    const root = await resultRoot();
    const statError = errno("EIO", "injected initial handle stat failure");
    const closed: Array<Readonly<{ attempt: number; path: ResultLogicalPathForTest }>> = [];

    await expect(
      reserveResultPair(
        root,
        "2026-07-29T20:12:10.000Z",
        { schemaVersion: 4, state: "pending" },
        {
          afterHandleClose: (_path, logicalPath, attempt) => {
            closed.push({ attempt, path: logicalPath });
            return Promise.resolve();
          },
          beforeHandleStat: (_path, phase) =>
            phase === "initial" ? Promise.reject(statError) : Promise.resolve(),
        },
      ),
    ).rejects.toBe(statError);

    expect(closed).toEqual([{ attempt: 1, path: "result-json" }]);
    await expect(
      readJson(join(root, "result-v4-2026-07-29T20-12-10-000Z.json")),
    ).resolves.toMatchObject({
      resultOwnership: {
        failure: { code: "EIO", path: "result-json" },
        publicationState: "reservation-abandoned",
      },
      state: "reservation-abandoned",
    });
  });

  it("retains a reopened handle when validation and its immediate close both fail", async () => {
    const root = await resultRoot();
    const validationError = errno("EIO", "injected reopen validation failure");
    const closeError = errno("EBUSY", "injected reopen close failure");
    const closed: Array<Readonly<{ attempt: number; path: ResultLogicalPathForTest }>> = [];
    const reservation = await reserveResultPair(
      root,
      "2026-07-29T20:12:20.000Z",
      { schemaVersion: 4, state: "pending" },
      {
        afterHandleClose: (_path, logicalPath, attempt) => {
          closed.push({ attempt, path: logicalPath });
          return Promise.resolve();
        },
        beforeHandleClose: (_path, logicalPath, attempt) =>
          logicalPath === "result-json" && attempt === 2
            ? Promise.reject(closeError)
            : Promise.resolve(),
        beforeHandleStat: (path, phase) =>
          path.endsWith(".json") && phase === "reopen"
            ? Promise.reject(validationError)
            : Promise.resolve(),
      },
    );
    await reservation.close();

    const failure = await reservation.publishPendingJson({ state: "pending" }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([validationError, closeError]);
    expect(reservation.handleState()).toEqual({
      jsonClosed: false,
      markdownClosed: true,
    });

    await reservation.close();
    expect(reservation.handleState()).toEqual({
      jsonClosed: true,
      markdownClosed: true,
    });
    expect(closed).toEqual([
      { attempt: 1, path: "result-json" },
      { attempt: 1, path: "result-markdown" },
      { attempt: 3, path: "result-json" },
    ]);
  });

  it.each([
    "EACCES",
    "ENOSPC",
    "EIO",
  ] as const)("fails immediately on non-collision create error %s", async (code) => {
    const root = await resultRoot();
    const error = errno(code, `injected ${code}`);
    let creates = 0;

    await expect(
      reserveResultPair(
        root,
        "2026-07-29T20:13:00.000Z",
        { schemaVersion: 4, state: "pending" },
        {
          beforeCreate: () => {
            creates += 1;
            return Promise.reject(error);
          },
        },
      ),
    ).rejects.toBe(error);
    expect(creates).toBe(1);
    expect(await directoryEntries(root)).toEqual([]);
  });

  it("retries only the still-open partial handle and reports an eventual close", async () => {
    const root = await resultRoot();
    const createError = errno("EIO", "injected Markdown create failure");
    const closeError = errno("EBUSY", "injected first JSON close failure");
    const attempts: number[] = [];
    const closed: number[] = [];

    const failure = await reserveResultPair(
      root,
      "2026-07-29T20:14:10.000Z",
      { schemaVersion: 4, state: "pending" },
      {
        afterHandleClose: (_path, logicalPath, attempt) => {
          if (logicalPath === "result-json") closed.push(attempt);
          return Promise.resolve();
        },
        beforeCreate: (path) =>
          path.endsWith(".md") ? Promise.reject(createError) : Promise.resolve(),
        beforeHandleClose: (_path, logicalPath, attempt) => {
          if (logicalPath === "result-json") attempts.push(attempt);
          return logicalPath === "result-json" && attempt === 1
            ? Promise.reject(closeError)
            : Promise.resolve();
        },
      },
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([createError, closeError]);
    expect(attempts).toEqual([1, 2]);
    expect(closed).toEqual([2]);
  });

  it("uses its final owned close after bounded partial-close failures and reports every attempt", async () => {
    const root = await resultRoot();
    const createError = errno("EIO", "injected Markdown create failure");
    const closeErrors = [1, 2, 3].map((attempt) =>
      errno("EBUSY", `injected JSON close failure ${attempt}`),
    );
    const attempts: number[] = [];
    const closed: number[] = [];

    const failure = await reserveResultPair(
      root,
      "2026-07-29T20:14:20.000Z",
      { schemaVersion: 4, state: "pending" },
      {
        afterHandleClose: (_path, logicalPath, attempt) => {
          if (logicalPath === "result-json") closed.push(attempt);
          return Promise.resolve();
        },
        beforeCreate: (path) =>
          path.endsWith(".md") ? Promise.reject(createError) : Promise.resolve(),
        beforeHandleClose: (_path, logicalPath, attempt) => {
          if (logicalPath !== "result-json") return Promise.resolve();
          attempts.push(attempt);
          return Promise.reject(closeErrors[attempt - 1]);
        },
      },
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([createError, ...closeErrors]);
    expect(attempts).toEqual([1, 2, 3]);
    expect(closed).toEqual([4]);
  });

  it("retains the non-collision Markdown create error after cleaning its JSON placeholder", async () => {
    const root = await resultRoot();
    const error = errno("EIO", "injected Markdown create failure");

    await expect(
      reserveResultPair(
        root,
        "2026-07-29T20:14:00.000Z",
        { schemaVersion: 4, state: "pending" },
        {
          beforeCreate: (path) =>
            path.endsWith(".md") ? Promise.reject(error) : Promise.resolve(),
        },
      ),
    ).rejects.toBe(error);
    expect(await directoryEntries(root)).toHaveLength(1);
    await expect(
      readJson(join(root, "result-v4-2026-07-29T20-14-00-000Z.json")),
    ).resolves.toMatchObject({
      resultOwnership: {
        failure: { code: "EIO", path: "result-markdown" },
        publicationState: "reservation-abandoned",
      },
      state: "reservation-abandoned",
    });
  });

  it("aggregates the original create error with its partial-placeholder abandonment error", async () => {
    const root = await resultRoot();
    const createError = errno("EIO", "injected Markdown create failure");
    const cleanupError = errno("EACCES", "injected JSON cleanup failure");

    const failure = await reserveResultPair(
      root,
      "2026-07-29T20:15:00.000Z",
      { schemaVersion: 4, state: "pending" },
      {
        beforeCreate: (path) =>
          path.endsWith(".md") ? Promise.reject(createError) : Promise.resolve(),
        beforePartialAbandon: () => Promise.reject(cleanupError),
      },
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([createError, cleanupError]);
    expect(await directoryEntries(root)).toHaveLength(1);
  });

  it("never deletes a replaced partial-reservation path during abandonment", async () => {
    const root = await resultRoot();
    const startedAt = "2026-07-29T20:16:00.000Z";
    const stem = "result-v4-2026-07-29T20-16-00-000Z";
    const markdown = Buffer.from("# Existing Markdown\n");
    const replacement = Buffer.from('{"state":"replacement"}\n');
    const jsonPath = join(root, `${stem}.json`);
    const markdownPath = join(root, `${stem}.md`);
    await writeFile(markdownPath, markdown, { flag: "wx" });

    const failure = await reserveResultPair(
      root,
      startedAt,
      { schemaVersion: 4, state: "pending" },
      {
        beforePartialAbandon: async (path, logicalPath) => {
          if (logicalPath !== "result-json") return;
          await rm(path);
          await writeFile(path, replacement, { flag: "wx" });
        },
      },
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect(await readFile(jsonPath)).toEqual(replacement);
    expect(await readFile(markdownPath)).toEqual(markdown);
    await expect(access(join(root, `${stem}-1.json`))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("contains no pathname deletion call in the evidence owner", async () => {
    const source = await readFile(join(import.meta.dirname, "result-pair.ts"), "utf8");
    expect(source).not.toMatch(/\b(?:rm|unlink)\s*\(/);
  });
});

async function resultRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "parallax-result-pair-"));
  cleanup.push(root);
  return root;
}

function errno(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

function isWindowsSymlinkPrivilegeError(error: unknown): boolean {
  return (
    process.platform === "win32" &&
    error instanceof Error &&
    "code" in error &&
    (error.code === "EPERM" || error.code === "EACCES")
  );
}

function directoryEntries(path: string): Promise<string[]> {
  return readdir(path).then((entries) => entries.sort());
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function expectOwnedPair(
  reservation: Awaited<ReturnType<typeof reserveResultPair>>,
  state: "failed" | "passed",
): Promise<void> {
  await expect(readJson(reservation.jsonPath)).resolves.toMatchObject({
    resultOwnership: {
      publicationState: state,
      reservationId: reservation.ownership.reservationId,
    },
    state,
  });
  const markdown = await readFile(reservation.markdownPath, "utf8");
  expect(markdown).toContain(`- State: \`${state}\``);
  expect(markdown).toContain(`- Result reservation: \`${reservation.ownership.reservationId}\``);
  expect(markdown).toContain(`- Publication state: \`${state}\``);
}
