import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ASSET_UPDATE_V8_CONTRACT,
  ASSET_UPDATE_V8_SCHEMA_VERSION,
  type AssetUpdateV8Evidence,
  assetUpdateJsonEqual,
  validateAssetUpdateV8Evidence,
} from "./asset-update-v8-evidence.js";
import {
  closeAssetUpdateV8ResultAfterFailure,
  hasOpenAssetUpdateV8ResultHandle,
  reserveAssetUpdateV8Result,
  validateAssetUpdateV8ResultPair,
} from "./asset-update-v8-result.js";

const startedAt = "2026-07-30T04:00:00.000Z";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("asset-update V8 result pair", () => {
  it("treats absent files and closed handles as fully closed", () => {
    expect(hasOpenAssetUpdateV8ResultHandle([null, { handle: null }])).toBe(false);
    expect(hasOpenAssetUpdateV8ResultHandle([null, { handle: {} }])).toBe(true);
  });

  it("closes the JSON handle even when the companion close hook keeps failing", async () => {
    const root = await resultRoot();
    const closeAttempts: string[] = [];
    const reservation = await reserveAssetUpdateV8Result(
      root,
      startedAt,
      ({ companionPath, reservationId }) => pending(companionPath, reservationId),
      {
        beforeClose: async (_path, logicalPath) => {
          closeAttempts.push(logicalPath);
          if (logicalPath === "result-markdown")
            throw new Error("injected companion close failure");
        },
      },
    );

    await expect(reservation.close()).rejects.toThrow("result handles did not close");
    expect(closeAttempts).toContain("result-json");
    await expect(reservation.close()).resolves.toBeUndefined();
  });

  it("retains the primary failure when result-handle close also fails", async () => {
    const primary = new Error("primary publication failure");
    const closeFailure = new Error("result close failure");
    await expect(
      closeAssetUpdateV8ResultAfterFailure({ close: () => Promise.reject(closeFailure) }, primary),
    ).rejects.toMatchObject({ cause: primary, errors: [primary, closeFailure] });
    await expect(
      closeAssetUpdateV8ResultAfterFailure({ close: () => Promise.resolve() }, primary),
    ).rejects.toBe(primary);
  });

  it.each([
    ["asset-update-v8-v2-2026-07-30T07-36-11-804Z", "failed"],
    ["asset-update-v8-v2-2026-07-30T07-53-40-357Z", "failed"],
    ["asset-update-v8-v2-2026-07-30T10-05-24-152Z", "passed"],
  ] as const)("validates actual immutable lifecycle-v2 pair %s", async (stem, state) => {
    const root = join(process.cwd(), "harness", "results", "asset-update-v8");
    expect(
      (await validateAssetUpdateV8ResultPair(join(root, `${stem}.json`), join(root, `${stem}.md`)))
        .state,
    ).toBe(state);
  });

  it.each([
    "preRelease",
    "postRelease",
  ] as const)("rejects an internally rebound content-addressed path in retained lifecycle-v2 %s evidence", async (boundary) => {
    const path = join(
      process.cwd(),
      "harness",
      "results",
      "asset-update-v8",
      "asset-update-v8-v2-2026-07-30T10-05-24-152Z.json",
    );
    const retained = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    const result = retained.result as Record<string, Record<string, unknown>>;
    forgeRetainedContentAddressedPath(result[boundary] as Record<string, unknown>);
    expect(() => validateAssetUpdateV8Evidence(retained)).toThrow(
      "Content-addressed JavaScript path does not bind its artifact SHA-256",
    );
  });

  it("pins the actual lifecycle-v2 browser protocol authority", async () => {
    const path = join(
      process.cwd(),
      "harness",
      "results",
      "asset-update-v8",
      "asset-update-v8-v2-2026-07-30T10-05-24-152Z.json",
    );
    const retained = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    const browser = (retained.authority as Record<string, Record<string, unknown>>)
      .browser as Record<string, unknown>;
    browser.protocolVersion = "1.4";
    expect(() => validateAssetUpdateV8Evidence(retained)).toThrow(
      "Browser authority protocolVersion is invalid",
    );

    browser.protocolVersion = "1.3";
    browser.unknown = "private-value";
    expect(() => validateAssetUpdateV8Evidence(retained)).toThrow(
      "browser has unsupported or missing keys",
    );

    delete browser.unknown;
    const result = retained.result as Record<string, unknown>;
    const publication = result.publication as Record<string, unknown>;
    const preTransfer = publication.preTransfer as Record<string, unknown>;
    preTransfer.schemaVersion = 6;
    expect(() => validateAssetUpdateV8Evidence(retained)).toThrow(
      "installerTransfer schema is unsupported",
    );
  });

  it("suffixes an existing JSON collision without overwriting it", async () => {
    const root = await resultRoot();
    const stem = "asset-update-v8-v3-2026-07-30T04-00-00-000Z";
    const collisionPath = join(root, `${stem}.json`);
    await writeFile(collisionPath, "owned-by-someone-else");

    const reservation = await reserve(root);

    expect(reservation.stem).toBe(`${stem}-1`);
    expect(await readFile(collisionPath, "utf8")).toBe("owned-by-someone-else");
    await reservation.close();
  });

  it("retains a typed abandoned JSON reservation when the companion path collides", async () => {
    const root = await resultRoot();
    const stem = "asset-update-v8-v3-2026-07-30T04-00-00-000Z";
    const markdownCollision = join(root, `${stem}.md`);
    await writeFile(markdownCollision, "existing companion");

    const reservation = await reserve(root);
    const abandoned = JSON.parse(await readFile(join(root, `${stem}.json`), "utf8")) as {
      state: string;
      resultOwnership: { publicationState: string; reservationId: string };
    };

    expect(reservation.stem).toBe(`${stem}-1`);
    expect(await readFile(markdownCollision, "utf8")).toBe("existing companion");
    expect(abandoned).toMatchObject({
      resultOwnership: { publicationState: "reservation-abandoned" },
      state: "reservation-abandoned",
    });
    expect(abandoned.resultOwnership.reservationId).toMatch(/^[a-f0-9-]{36}$/);
    await reservation.close();
  });

  it("recovers a transient companion write failure as a valid failed pair", async () => {
    const root = await resultRoot();
    let companionFailures = 0;
    const reservation = await reserveAssetUpdateV8Result(
      root,
      startedAt,
      ({ companionPath, reservationId }) => pending(companionPath, reservationId),
      {
        beforeWrite: async (_path, logicalPath, state) => {
          if (logicalPath === "result-markdown" && state === "failed" && companionFailures === 0) {
            companionFailures += 1;
            throw new Error("injected companion write failure");
          }
        },
      },
    );
    const terminal = failed(
      basename(reservation.markdownPath),
      reservation.reservationId,
      "publication",
      "primary lifecycle failure",
    );

    const retained = await reservation.publishTerminal(terminal, (phase, error) =>
      failed(
        basename(reservation.markdownPath),
        reservation.reservationId,
        phase === "markdown" ? "companion-write" : "publication",
        error instanceof Error ? error.message : String(error),
      ),
    );

    expect(retained).toMatchObject({
      failure: { phase: "companion-write" },
      state: "failed",
    });
    const json = validateAssetUpdateV8Evidence(
      JSON.parse(await readFile(reservation.jsonPath, "utf8")) as unknown,
    );
    const markdown = await readFile(reservation.markdownPath, "utf8");
    expect(json).toEqual(retained);
    expect(markdown).toContain(
      `parallax-asset-update-v8-owner:${reservation.reservationId}:failed`,
    );
    expect(markdown).toContain("Failure phase: `companion-write`");
  });

  it("retains a minimal official failed pair when the terminal and recovery are invalid", async () => {
    const root = await resultRoot();
    const reservation = await reserve(root);
    const invalid = {
      ...failed(
        basename(reservation.markdownPath),
        reservation.reservationId,
        "publication",
        "original lifecycle validation failed",
      ),
      failure: {
        message:
          "\u0000 Authorization: Bearer abc.def.ghi api_key=private-value " +
          String.raw`\\corp-server\private-share\operator ` +
          "path=/home/operator/private.txt file:///Users/operator/private.txt",
        name: "secret=credential-in-name",
        phase: "publication",
      },
      partialResult: { publication: { malformed: true } },
    } as unknown as AssetUpdateV8Evidence;

    await expect(reservation.publishTerminal(invalid, () => invalid)).rejects.toThrow(
      "Asset-update V8 result json finalization failed",
    );
    const retained = await validateAssetUpdateV8ResultPair(
      reservation.jsonPath,
      reservation.markdownPath,
      undefined,
      reservation.retainedIdentity,
    );
    expect(retained).toMatchObject({
      authority: null,
      failure: {
        name: "AssetUpdateV8ResultPublicationError",
        phase: "publication",
      },
      failureContext: null,
      partialResult: null,
      postValidation: {
        authority: null,
        passed: false,
        performed: false,
      },
      state: "failed",
    });
    expect(await readFile(reservation.markdownPath, "utf8")).toContain(
      "Asset-update V8 publication failed",
    );
    const retainedJson = await readFile(reservation.jsonPath, "utf8");
    const retainedMarkdown = await readFile(reservation.markdownPath, "utf8");
    expect(retainedJson).not.toMatch(
      /abc\.def\.ghi|private-value|corp-server|private-share|operator|credential/u,
    );
    expect(retainedMarkdown).not.toMatch(
      /abc\.def\.ghi|private-value|corp-server|private-share|operator|credential/u,
    );
    expect(retainedJson).not.toContain("\u0000");
    expect(retainedMarkdown).not.toContain("\u0000");
  });

  it("retains a minimal official failed pair when recovery is structurally malformed", async () => {
    const root = await resultRoot();
    const reservation = await reserve(root);
    const invalidTerminal = {
      ...failed(
        basename(reservation.markdownPath),
        reservation.reservationId,
        "publication",
        "invalid terminal",
      ),
      partialResult: { publication: { malformed: true } },
    } as unknown as AssetUpdateV8Evidence;
    const malformedRecovery = { state: "failed" } as AssetUpdateV8Evidence;

    await expect(
      reservation.publishTerminal(invalidTerminal, () => malformedRecovery),
    ).rejects.toThrow("Asset-update V8 result json finalization failed");

    const retained = await validateAssetUpdateV8ResultPair(
      reservation.jsonPath,
      reservation.markdownPath,
      undefined,
      reservation.retainedIdentity,
    );
    expect(retained).toMatchObject({
      authority: null,
      companion: {
        path: basename(reservation.markdownPath),
        state: "failed",
      },
      failure: {
        name: "AssetUpdateV8ResultPublicationError",
        phase: "publication",
      },
      partialResult: null,
      resultOwnership: {
        publicationState: "failed",
        reservationId: reservation.reservationId,
      },
      startedAt,
      state: "failed",
    });
  });

  it("retains a close failure as typed failed evidence and closes on retry", async () => {
    const root = await resultRoot();
    let closeFailures = 0;
    const closeOrder: string[] = [];
    const reservation = await reserveAssetUpdateV8Result(
      root,
      startedAt,
      ({ companionPath, reservationId }) => pending(companionPath, reservationId),
      {
        beforeClose: async (_path, logicalPath) => {
          closeOrder.push(logicalPath);
          if (logicalPath === "result-markdown" && closeFailures === 0) {
            closeFailures += 1;
            throw new Error("injected close failure");
          }
        },
      },
    );

    const retained = await reservation.publishTerminal(
      failed(
        basename(reservation.markdownPath),
        reservation.reservationId,
        "publication",
        "primary lifecycle failure",
      ),
      (phase, error) =>
        failed(
          basename(reservation.markdownPath),
          reservation.reservationId,
          phase === "close" ? "result-close" : "publication",
          error instanceof Error ? error.message : String(error),
        ),
    );

    expect(retained).toMatchObject({
      failure: { phase: "result-close" },
      state: "failed",
    });
    expect(closeOrder.slice(0, 3)).toEqual([
      "result-markdown",
      "result-markdown",
      "result-markdown",
    ]);
    expect(closeOrder.indexOf("result-json")).toBeGreaterThanOrEqual(3);
    expect(
      validateAssetUpdateV8Evidence(
        JSON.parse(await readFile(reservation.jsonPath, "utf8")) as unknown,
      ),
    ).toEqual(retained);
  });

  it("writes the companion before the primary and recovers a primary terminal-write failure", async () => {
    const root = await resultRoot();
    const writes: string[] = [];
    let primaryFailures = 0;
    const reservation = await reserveAssetUpdateV8Result(
      root,
      startedAt,
      ({ companionPath, reservationId }) => pending(companionPath, reservationId),
      {
        beforeWrite: async (_path, logicalPath, state) => {
          if (state !== "failed") return;
          writes.push(logicalPath);
          if (logicalPath === "result-json" && primaryFailures === 0) {
            primaryFailures += 1;
            throw new Error("injected primary terminal-write failure");
          }
        },
      },
    );

    const retained = await reservation.publishTerminal(
      failed(
        basename(reservation.markdownPath),
        reservation.reservationId,
        "publication",
        "primary lifecycle failure",
      ),
      (phase, error) =>
        failed(
          basename(reservation.markdownPath),
          reservation.reservationId,
          phase === "markdown" ? "companion-write" : "publication",
          error instanceof Error ? error.message : String(error),
        ),
    );

    expect(writes.slice(0, 2)).toEqual(["result-markdown", "result-json"]);
    expect(retained.state).toBe("failed");
    expect(
      validateAssetUpdateV8Evidence(
        JSON.parse(await readFile(reservation.jsonPath, "utf8")) as unknown,
      ),
    ).toEqual(retained);
  });

  it("retains an official failed pair when normal recovery publication also fails", async () => {
    const root = await resultRoot();
    let markdownFailures = 0;
    const reservation = await reserveAssetUpdateV8Result(
      root,
      startedAt,
      ({ companionPath, reservationId }) => pending(companionPath, reservationId),
      {
        beforeWrite: async (_path, logicalPath, state) => {
          if (logicalPath === "result-markdown" && state === "failed" && markdownFailures < 2) {
            markdownFailures += 1;
            throw new Error(`injected finalization failure ${markdownFailures}`);
          }
        },
      },
    );

    await expect(
      reservation.publishTerminal(
        failed(
          basename(reservation.markdownPath),
          reservation.reservationId,
          "publication",
          "primary lifecycle failure",
        ),
        (phase, error) =>
          failed(
            basename(reservation.markdownPath),
            reservation.reservationId,
            phase === "markdown" ? "companion-write" : "publication",
            error instanceof Error ? error.message : String(error),
          ),
      ),
    ).rejects.toThrow("finalization failed");

    const json = validateAssetUpdateV8Evidence(
      JSON.parse(await readFile(reservation.jsonPath, "utf8")) as unknown,
    );
    const markdown = await readFile(reservation.markdownPath, "utf8");
    expect(json.state).toBe("failed");
    expect(markdown).toContain(
      `parallax-asset-update-v8-owner:${reservation.reservationId}:failed`,
    );
    expect(markdown).not.toContain("finalization-failed");
  });

  it("rejects a replaced Markdown companion during exact retained-pair validation", async () => {
    const root = await resultRoot();
    const reservation = await reserve(root);
    await reservation.publishTerminal(
      failed(
        basename(reservation.markdownPath),
        reservation.reservationId,
        "publication",
        "primary lifecycle failure",
      ),
      (phase, error) =>
        failed(
          basename(reservation.markdownPath),
          reservation.reservationId,
          phase === "markdown" ? "companion-write" : "publication",
          error instanceof Error ? error.message : String(error),
        ),
    );
    await writeFile(reservation.markdownPath, "replacement companion");

    await expect(
      validateAssetUpdateV8ResultPair(reservation.jsonPath, reservation.markdownPath),
    ).rejects.toThrow("exact JSON companion");
  });

  it("rejects close-time same-inode replacement with the reserved pending primary", async () => {
    const root = await resultRoot();
    let pendingPrimary = "";
    let replaced = false;
    const reservation = await reserveAssetUpdateV8Result(
      root,
      startedAt,
      ({ companionPath, reservationId }) => pending(companionPath, reservationId),
      {
        beforeClose: async (path, logicalPath) => {
          if (logicalPath === "result-json" && !replaced) {
            replaced = true;
            await writeFile(path, pendingPrimary);
          }
        },
      },
    );
    pendingPrimary = await readFile(reservation.jsonPath, "utf8");
    const terminal = failed(
      basename(reservation.markdownPath),
      reservation.reservationId,
      "publication",
      "terminal failure",
    );

    expect(await reservation.publishTerminal(terminal, () => terminal)).toEqual(terminal);
    await expect(
      validateAssetUpdateV8ResultPair(
        reservation.jsonPath,
        reservation.markdownPath,
        undefined,
        reservation.retainedIdentity,
      ),
    ).rejects.toThrow();
    const recovery = failed(
      basename(reservation.markdownPath),
      reservation.reservationId,
      "publication",
      "close-time primary substitution rejected",
    );
    expect(await reservation.publishTerminal(recovery, () => recovery)).toEqual(recovery);
    expect(
      await validateAssetUpdateV8ResultPair(
        reservation.jsonPath,
        reservation.markdownPath,
        undefined,
        reservation.retainedIdentity,
      ),
    ).toEqual(recovery);
  });

  it("rejects copied ownership bytes after a path swap", async () => {
    const root = await resultRoot();
    const reservation = await reserve(root);
    const terminal = failed(
      basename(reservation.markdownPath),
      reservation.reservationId,
      "publication",
      "terminal failure",
    );
    await reservation.publishTerminal(terminal, () => terminal);
    const copied = await readFile(reservation.jsonPath);
    await rm(reservation.jsonPath);
    await writeFile(reservation.jsonPath, copied);

    await expect(
      validateAssetUpdateV8ResultPair(
        reservation.jsonPath,
        reservation.markdownPath,
        undefined,
        reservation.retainedIdentity,
      ),
    ).rejects.toThrow("read/identity/close validation failed");
  });

  it("publishes and revalidates noncanonical construction order by semantic structure", async () => {
    const root = await resultRoot();
    const reservation = await reserve(root);
    const terminal = reverseJsonKeys(
      failed(
        basename(reservation.markdownPath),
        reservation.reservationId,
        "publication",
        "terminal failure",
      ),
    ) as AssetUpdateV8Evidence;

    const retained = await reservation.publishTerminal(terminal, () => terminal);
    const reopened = await validateAssetUpdateV8ResultPair(
      reservation.jsonPath,
      reservation.markdownPath,
      undefined,
      reservation.retainedIdentity,
    );

    expect(JSON.stringify(reopened)).not.toBe(JSON.stringify(terminal));
    expect(assetUpdateJsonEqual(retained, terminal)).toBe(true);
    expect(assetUpdateJsonEqual(reopened, terminal)).toBe(true);
  });

  it("rejects hard-linked and symbolic-link pair substitutions", async () => {
    const hardRoot = await resultRoot();
    const hardReservation = await reserve(hardRoot);
    const hardTerminal = failed(
      basename(hardReservation.markdownPath),
      hardReservation.reservationId,
      "publication",
      "terminal failure",
    );
    await hardReservation.publishTerminal(hardTerminal, () => hardTerminal);
    await rm(hardReservation.markdownPath);
    await link(hardReservation.jsonPath, hardReservation.markdownPath);
    await expect(
      validateAssetUpdateV8ResultPair(hardReservation.jsonPath, hardReservation.markdownPath),
    ).rejects.toThrow("read/identity/close validation failed");

    const symbolicRoot = await resultRoot();
    const symbolicReservation = await reserve(symbolicRoot);
    const symbolicTerminal = failed(
      basename(symbolicReservation.markdownPath),
      symbolicReservation.reservationId,
      "publication",
      "terminal failure",
    );
    await symbolicReservation.publishTerminal(symbolicTerminal, () => symbolicTerminal);
    await rm(symbolicReservation.markdownPath);
    const symbolicTarget = join(symbolicRoot, "symbolic-target");
    await mkdir(symbolicTarget);
    await symlink(symbolicTarget, symbolicReservation.markdownPath, "junction");
    await expect(
      validateAssetUpdateV8ResultPair(
        symbolicReservation.jsonPath,
        symbolicReservation.markdownPath,
      ),
    ).rejects.toThrow("read/identity/close validation failed");
  });

  it("rejects arbitrary companion paths and non-canonical JSON mutation", async () => {
    const root = await resultRoot();
    const reservation = await reserve(root);
    const terminal = failed(
      basename(reservation.markdownPath),
      reservation.reservationId,
      "publication",
      "terminal failure",
    );
    await reservation.publishTerminal(terminal, () => terminal);
    const arbitrary = join(root, "arbitrary.md");
    await writeFile(arbitrary, await readFile(reservation.markdownPath));
    await expect(validateAssetUpdateV8ResultPair(reservation.jsonPath, arbitrary)).rejects.toThrow(
      "exact same-stem pair",
    );

    await writeFile(
      reservation.jsonPath,
      `${(await readFile(reservation.jsonPath, "utf8")).trimEnd()} \n`,
    );
    await expect(
      validateAssetUpdateV8ResultPair(reservation.jsonPath, reservation.markdownPath),
    ).rejects.toThrow("not exact canonical bytes");
  });

  it("rejects reordered and duplicate-key JSON even when it parses to valid evidence", async () => {
    const reorderedRoot = await resultRoot();
    const reorderedReservation = await reserve(reorderedRoot);
    const reorderedTerminal = failed(
      basename(reorderedReservation.markdownPath),
      reorderedReservation.reservationId,
      "publication",
      "terminal failure",
    );
    await reorderedReservation.publishTerminal(reorderedTerminal, () => reorderedTerminal);
    const parsed = JSON.parse(await readFile(reorderedReservation.jsonPath, "utf8")) as Record<
      string,
      unknown
    >;
    const reordered = Object.fromEntries(Object.entries(parsed).reverse());
    await writeFile(reorderedReservation.jsonPath, `${JSON.stringify(reordered)}\n`);
    await expect(
      validateAssetUpdateV8ResultPair(
        reorderedReservation.jsonPath,
        reorderedReservation.markdownPath,
      ),
    ).rejects.toThrow("not exact canonical bytes");

    const duplicateRoot = await resultRoot();
    const duplicateReservation = await reserve(duplicateRoot);
    const duplicateTerminal = failed(
      basename(duplicateReservation.markdownPath),
      duplicateReservation.reservationId,
      "publication",
      "terminal failure",
    );
    await duplicateReservation.publishTerminal(duplicateTerminal, () => duplicateTerminal);
    const canonical = await readFile(duplicateReservation.jsonPath, "utf8");
    await writeFile(duplicateReservation.jsonPath, canonical.replace(/^\{/, '{"state":"failed",'));
    await expect(
      validateAssetUpdateV8ResultPair(
        duplicateReservation.jsonPath,
        duplicateReservation.markdownPath,
      ),
    ).rejects.toThrow("not exact canonical bytes");
  });

  it("does not reinterpret a non-EEXIST creation failure as a collision", async () => {
    const root = await resultRoot();
    await expect(
      reserveAssetUpdateV8Result(
        root,
        startedAt,
        ({ companionPath, reservationId }) => pending(companionPath, reservationId),
        {
          beforeCreate: async (_path, logicalPath) => {
            if (logicalPath === "result-json") {
              throw Object.assign(new Error("permission denied"), { code: "EACCES" });
            }
          },
        },
      ),
    ).rejects.toThrow("permission denied");
  });

  it("retains typed abandonment when initial validation fails after exclusive creation", async () => {
    const root = await resultRoot();
    const stem = "asset-update-v8-v3-2026-07-30T04-00-00-000Z";

    await expect(
      reserveAssetUpdateV8Result(
        root,
        startedAt,
        ({ companionPath, reservationId }) => pending(companionPath, reservationId),
        {
          afterCreate: async (_path, logicalPath) => {
            if (logicalPath === "result-json") {
              throw new Error("injected initial identity failure");
            }
          },
        },
      ),
    ).rejects.toThrow("injected initial identity failure");

    const abandoned = JSON.parse(await readFile(join(root, `${stem}.json`), "utf8")) as {
      failure: { message: string; phase: string };
      resultOwnership: { publicationState: string; reservationId: string };
      state: string;
    };
    expect(abandoned).toMatchObject({
      failure: {
        message: "injected initial identity failure",
        phase: "reservation",
      },
      resultOwnership: { publicationState: "reservation-abandoned" },
      state: "reservation-abandoned",
    });
  });
});

async function resultRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "asset-update-v8-result-test-"));
  roots.push(root);
  return root;
}

function reserve(root: string) {
  return reserveAssetUpdateV8Result(root, startedAt, ({ companionPath, reservationId }) =>
    pending(companionPath, reservationId),
  );
}

function pending(companionPath: string, reservationId: string): AssetUpdateV8Evidence {
  return {
    authority: null,
    companion: { path: companionPath, state: "pending" },
    contract: ASSET_UPDATE_V8_CONTRACT,
    postValidation: { authority: null, passed: null, performed: false, ready: null, target: null },
    resultOwnership: { publicationState: "pending", reservationId },
    schemaVersion: ASSET_UPDATE_V8_SCHEMA_VERSION,
    startedAt,
    state: "pending",
  };
}

function failed(
  companionPath: string,
  reservationId: string,
  phase: "companion-write" | "publication" | "result-close",
  message: string,
): AssetUpdateV8Evidence {
  return {
    authority: null,
    companion: { path: companionPath, state: "failed" },
    completedAt: "2026-07-30T04:01:00.000Z",
    contract: ASSET_UPDATE_V8_CONTRACT,
    failure: { message: message.slice(0, 400), name: "Error", phase },
    failureContext: null,
    partialResult: null,
    postValidation: { authority: null, passed: false, performed: false, ready: null, target: null },
    resultOwnership: { publicationState: "failed", reservationId },
    schemaVersion: ASSET_UPDATE_V8_SCHEMA_VERSION,
    startedAt,
    state: "failed",
  };
}

function reverseJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseJsonKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([key, item]) => [key, reverseJsonKeys(item)]),
  );
}

function forgeRetainedContentAddressedPath(release: Record<string, unknown>): void {
  const manifest = JSON.parse(
    Buffer.from(String(release.buildManifestBase64), "base64").toString("utf8"),
  ) as { artifacts: Array<{ bytes: number; path: string; sha256: string }> };
  const installManifest = JSON.parse(
    Buffer.from(String(release.installManifestBase64), "base64").toString("utf8"),
  ) as { resources: Array<{ source: string }> };
  const artifact = manifest.artifacts.find(({ path }) => path.startsWith("immutable/app-"));
  if (artifact === undefined) throw new Error("Retained release omitted its app module");
  const originalPath = artifact.path;
  const forgedDigest = artifact.sha256 === "f".repeat(64) ? "0".repeat(64) : "f".repeat(64);
  artifact.path = `immutable/app-${forgedDigest}.js`;
  const resource = installManifest.resources.find(({ source }) => source === originalPath);
  if (resource === undefined) throw new Error("Retained release omitted its app resource");
  resource.source = artifact.path;
  const installBytes = Buffer.from(`${JSON.stringify(installManifest)}\n`);
  release.installManifestBase64 = installBytes.toString("base64");
  release.releaseDigest = createHash("sha256").update(installBytes).digest("hex");
  const installArtifact = manifest.artifacts.find(({ path }) => path === "install-manifest.json");
  if (installArtifact === undefined)
    throw new Error("Retained release omitted its install manifest");
  installArtifact.bytes = installBytes.byteLength;
  installArtifact.sha256 = String(release.releaseDigest);
  const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  release.buildManifestBase64 = bytes.toString("base64");
  release.artifactDigest = createHash("sha256").update(bytes).digest("hex");
}
