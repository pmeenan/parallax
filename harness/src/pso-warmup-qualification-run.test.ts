import { link, mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { PsoWarmupTelemetrySnapshot } from "@parallax/engine";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readAndValidateBuildManifest, type ValidatedBuildManifest } from "./build-manifest.js";
import { type ChromePin, loadChromePin } from "./chrome-pin.js";
import { completePsoQualificationSmokeReport } from "./pso-warmup-qualification.test-fixture.js";
import {
  createPsoWarmupQualificationRunDependencies,
  type PsoWarmupQualificationEvidenceHandle,
  runPsoWarmupQualification,
  validatePsoWarmupQualificationEvidence,
} from "./pso-warmup-qualification-run.js";
import { readSourceIdentity, type SourceIdentity } from "./source-identity.js";

const repositoryRoot = resolve(process.cwd());
const cleanup: string[] = [];
let build: ValidatedBuildManifest;
let chromePin: ChromePin;
let source: SourceIdentity;

beforeAll(async () => {
  build = await readAndValidateBuildManifest(resolve(repositoryRoot, "dist"));
  chromePin = await loadChromePin(resolve(repositoryRoot, "harness/chrome/stable.json"));
  source = await readSourceIdentity(repositoryRoot);
});

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("PSO warmup qualification result lifecycle", () => {
  it("establishes JSON-primary pending evidence before report validation", async () => {
    const root = await temporaryRoot();
    const inputPath = join(root, "invalid-smoke.json");
    const outputPath = join(root, "qualification.json");
    await writeFile(inputPath, "{}\n");
    let releaseRead: ((bytes: Uint8Array) => void) | undefined;
    const blockedRead = new Promise<Uint8Array>((resolveRead) => {
      releaseRead = resolveRead;
    });
    const defaults = createPsoWarmupQualificationRunDependencies();
    const running = runPsoWarmupQualification(runInput(inputPath, outputPath), {
      ...defaults,
      io: { ...defaults.io, readFile: () => blockedRead },
    });
    await expect
      .poll(async () => {
        const parsed = JSON.parse(await readFile(outputPath, "utf8")) as { state: string };
        return parsed.state;
      })
      .toBe("pending");
    const pending = await json(outputPath);
    expect(() => validatePsoWarmupQualificationEvidence(pending)).not.toThrow();
    expect(() =>
      validatePsoWarmupQualificationEvidence({
        ...pending,
        completedAt: "2026-07-29T00:00:00.000Z",
      }),
    ).toThrow(/fields are invalid/);
    releaseRead?.(new TextEncoder().encode("{}\n"));
    expect((await running).state).toBe("failed");
  });

  it("retains validation failure with exact available input and authority", async () => {
    const root = await temporaryRoot();
    const inputPath = join(root, "invalid-smoke.json");
    const outputPath = join(root, "qualification.json");
    const invalidReport = completePsoQualificationSmokeReport({
      artifactDigest: build.artifactDigest,
      chromePin,
      executableSha256: chromePin.executableSha256.win64 ?? "",
      psoWarmup: exactPsoSnapshot(),
      releaseDigest: build.releaseDigest,
      source,
    });
    invalidReport.schemaVersion = 59;
    await writeFile(inputPath, `${JSON.stringify(invalidReport, null, 2)}\n`);
    const outcome = await runPsoWarmupQualification(runInput(inputPath, outputPath));
    const report = await json(outcome.jsonPath);
    expect(outcome.state).toBe("failed");
    expect(report).toMatchObject({
      authority: {
        artifactDigest: build.artifactDigest,
        browser: {
          executableSha256: chromePin.executableSha256.win64,
          product: `Chrome/${chromePin.version}`,
          revision: chromePin.browserRevision,
        },
        releaseDigest: build.releaseDigest,
        traceSha256: build.psoWarmupTrace.sha256,
      },
      failure: { phase: "qualification" },
      smokeReport: { path: "external/invalid-smoke.json" },
      state: "failed",
    });
    expect((report.smokeReport as { sha256: string }).sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(() =>
      validatePsoWarmupQualificationEvidence({
        ...report,
        qualification: { passed: true },
      }),
    ).toThrow(/fields are invalid/);
  });

  it("keeps truthful primary failure when companion formatting fails", async () => {
    const root = await temporaryRoot();
    const inputPath = await writeValidReport(root);
    const outputPath = join(root, "qualification.json");
    const defaults = createPsoWarmupQualificationRunDependencies();
    const outcome = await runPsoWarmupQualification(runInput(inputPath, outputPath), {
      ...defaults,
      formatCompanion: () => {
        throw new Error("formatter token=secret-value");
      },
    });
    expect(outcome.state).toBe("failed");
    expect(await json(outcome.jsonPath)).toMatchObject({
      companion: { state: "failed" },
      failure: {
        message: "formatter token=<redacted>",
        phase: "companion-format",
      },
      state: "failed",
    });
  });

  it("keeps truthful primary failure when companion writing fails", async () => {
    const root = await temporaryRoot();
    const inputPath = await writeValidReport(root);
    const outputPath = join(root, "qualification.json");
    const defaults = createPsoWarmupQualificationRunDependencies();
    const writes = new Map<string, number>();
    const outcome = await runPsoWarmupQualification(runInput(inputPath, outputPath), {
      ...defaults,
      io: {
        ...defaults.io,
        createExclusive: async (path) => {
          const handle = await createRealHandle(path);
          return {
            ...handle,
            writeText: async (value) => {
              const count = (writes.get(path) ?? 0) + 1;
              writes.set(path, count);
              if (path.endsWith(".md") && count === 2) {
                throw new Error("injected companion write failure");
              }
              await handle.writeText(value);
            },
          };
        },
      },
    });
    expect(outcome.state).toBe("failed");
    expect(await json(outcome.jsonPath)).toMatchObject({
      companion: { state: "failed" },
      failure: { phase: "companion-write" },
      state: "failed",
    });
  });

  it("uses a collision-safe suffix without overwriting an existing result", async () => {
    const root = await temporaryRoot();
    const inputPath = await writeValidReport(root);
    const outputPath = join(root, "qualification.json");
    await writeFile(outputPath, "unrelated\n", { flag: "wx" });
    const outcome = await runPsoWarmupQualification(runInput(inputPath, outputPath));
    expect(outcome).toMatchObject({
      jsonPath: join(root, "qualification-1.json"),
      markdownPath: join(root, "qualification-1.md"),
      state: "passed",
    });
    expect(await readFile(outputPath, "utf8")).toBe("unrelated\n");
  });

  it("does not overwrite a colliding companion and retains the abandoned primary failure", async () => {
    const root = await temporaryRoot();
    const inputPath = await writeValidReport(root);
    const outputPath = join(root, "qualification.json");
    const markdownPath = join(root, "qualification.md");
    await writeFile(markdownPath, "unrelated companion\n", { flag: "wx" });
    const outcome = await runPsoWarmupQualification(runInput(inputPath, outputPath));
    expect(outcome.jsonPath).toBe(join(root, "qualification-1.json"));
    expect(outcome.state).toBe("passed");
    expect(await readFile(markdownPath, "utf8")).toBe("unrelated companion\n");
    expect(await json(outputPath)).toMatchObject({
      companion: { state: "failed" },
      failure: { phase: "companion-write" },
      state: "failed",
    });
  });

  it("rejects ambiguous input/output aliases and non-JSON output locations", async () => {
    const root = await temporaryRoot();
    const inputPath = await writeValidReport(root);
    await expect(runPsoWarmupQualification(runInput(inputPath, inputPath))).rejects.toThrow(
      /must be distinct/,
    );
    await expect(
      runPsoWarmupQualification(runInput(inputPath, join(root, "qualification.md"))),
    ).rejects.toThrow(/exact \.json extension/);
  });

  it("publishes exact post-validated JSON and human-readable success evidence", async () => {
    const root = await temporaryRoot();
    const inputPath = await writeValidReport(root);
    const outcome = await runPsoWarmupQualification(
      runInput(inputPath, join(root, "qualification.json")),
    );
    expect(outcome.state).toBe("passed");
    const report = await json(outcome.jsonPath);
    expect(report).toMatchObject({
      companion: { path: "qualification.md", state: "passed" },
      postValidation: { passed: true, performed: true },
      qualification: {
        artifactDigest: build.artifactDigest,
        passed: true,
        releaseDigest: build.releaseDigest,
      },
      state: "passed",
    });
    expect(() => validatePsoWarmupQualificationEvidence(report)).not.toThrow();
    expect(() =>
      validatePsoWarmupQualificationEvidence({
        ...report,
        failure: { message: "contradiction", name: "Error", phase: "qualification" },
      }),
    ).toThrow(/fields are invalid/);
    expect(await readFile(outcome.markdownPath, "utf8")).toContain("- State: `passed`");
  });

  it("rejects coordinated evidence forgery against independently retained authority", async () => {
    const root = await temporaryRoot();
    const inputPath = await writeValidReport(root);
    const outcome = await runPsoWarmupQualification(
      runInput(inputPath, join(root, "qualification.json")),
    );
    const report = await json(outcome.jsonPath);
    const forged = structuredClone(report);
    const authority = forged.authority as Record<string, unknown>;
    const authorityBrowser = authority.browser as Record<string, unknown>;
    const authorityPin = authorityBrowser.pin as Record<string, unknown>;
    authorityPin.version = "0.0.0.0";
    authorityBrowser.product = "Chrome/0.0.0.0";
    const qualification = forged.qualification as Record<string, unknown>;
    const qualificationBrowser = qualification.browser as Record<string, unknown>;
    (qualificationBrowser.pin as Record<string, unknown>).version = "0.0.0.0";
    qualificationBrowser.product = "Chrome/0.0.0.0";
    expect(() =>
      validatePsoWarmupQualificationEvidence(forged, {
        authority: report.authority as never,
        qualification: report.qualification as never,
      }),
    ).toThrow(/differs from preflight/);
  });

  it("turns late post-validation drift into retained failed evidence", async () => {
    const root = await temporaryRoot();
    const inputPath = await writeValidReport(root);
    const defaults = createPsoWarmupQualificationRunDependencies();
    let checks = 0;
    const outcome = await runPsoWarmupQualification(
      runInput(inputPath, join(root, "qualification.json")),
      {
        ...defaults,
        assertPreflightUnchanged: async (preflight) => {
          checks += 1;
          if (checks === 2) throw new Error("late source/build drift");
          await defaults.assertPreflightUnchanged(preflight);
        },
      },
    );
    expect(outcome.state).toBe("failed");
    expect(await json(outcome.jsonPath)).toMatchObject({
      failure: { message: "late source/build drift", phase: "post-validation" },
      postValidation: { passed: false, performed: true },
      state: "failed",
    });
  });

  it("marks the first authority recheck as performed post-validation", async () => {
    const root = await temporaryRoot();
    const inputPath = await writeValidReport(root);
    const defaults = createPsoWarmupQualificationRunDependencies();
    const outcome = await runPsoWarmupQualification(
      runInput(inputPath, join(root, "qualification.json")),
      {
        ...defaults,
        assertPreflightUnchanged: () => Promise.reject(new Error("first authority drift")),
      },
    );
    expect(outcome.state).toBe("failed");
    expect(await json(outcome.jsonPath)).toMatchObject({
      failure: { message: "first authority drift", phase: "post-validation" },
      postValidation: { passed: false, performed: true },
      state: "failed",
    });
  });

  it("rejects pathname replacement without overwriting replacement bytes", async () => {
    const root = await temporaryRoot();
    const inputPath = await writeValidReport(root);
    const outputPath = join(root, "qualification.json");
    const displacedPath = join(root, "displaced.json");
    const defaults = createPsoWarmupQualificationRunDependencies();
    let replaced = false;
    await expect(
      runPsoWarmupQualification(runInput(inputPath, outputPath), {
        ...defaults,
        io: {
          ...defaults.io,
          readFile: async (path) => {
            const bytes = await defaults.io.readFile(path);
            if (!replaced) {
              replaced = true;
              await rename(outputPath, displacedPath);
              await writeFile(outputPath, "unrelated replacement\n", { flag: "wx" });
            }
            return bytes;
          },
        },
      }),
    ).rejects.toThrow(/pathname identity|result close/);
    expect(await readFile(outputPath, "utf8")).toBe("unrelated replacement\n");
  });

  it("rejects a hard-linked owned result before another write", async () => {
    const root = await temporaryRoot();
    const inputPath = await writeValidReport(root);
    const outputPath = join(root, "qualification.json");
    const hardlinkPath = join(root, "qualification-hardlink.json");
    const defaults = createPsoWarmupQualificationRunDependencies();
    let linked = false;
    await expect(
      runPsoWarmupQualification(runInput(inputPath, outputPath), {
        ...defaults,
        io: {
          ...defaults.io,
          readFile: async (path) => {
            const bytes = await defaults.io.readFile(path);
            if (!linked) {
              linked = true;
              await link(outputPath, hardlinkPath);
            }
            return bytes;
          },
        },
      }),
    ).rejects.toThrow(/link count|result close/);
    expect(await readFile(outputPath, "utf8")).toContain('"state": "pending"');
  });

  it("turns a close failure into failed primary evidence and retries the open owner", async () => {
    const root = await temporaryRoot();
    const inputPath = await writeValidReport(root);
    const outputPath = join(root, "qualification.json");
    const defaults = createPsoWarmupQualificationRunDependencies();
    let closeFailed = false;
    const outcome = await runPsoWarmupQualification(runInput(inputPath, outputPath), {
      ...defaults,
      io: {
        ...defaults.io,
        createExclusive: async (path) => {
          const handle = await createRealHandle(path);
          if (!path.endsWith(".json")) return handle;
          return {
            ...handle,
            close: async () => {
              if (!closeFailed) {
                closeFailed = true;
                throw new Error("injected JSON close failure");
              }
              await handle.close();
            },
          };
        },
      },
    });
    expect(outcome.state).toBe("failed");
    expect(await json(outcome.jsonPath)).toMatchObject({
      failure: { phase: "result-close" },
      state: "failed",
    });
  });

  it("reopens the exact original JSON owner when close closes underneath and then rejects", async () => {
    const root = await temporaryRoot();
    const inputPath = await writeValidReport(root);
    const outputPath = join(root, "qualification.json");
    const defaults = createPsoWarmupQualificationRunDependencies();
    let injected = false;
    const outcome = await runPsoWarmupQualification(runInput(inputPath, outputPath), {
      ...defaults,
      io: {
        ...defaults.io,
        createExclusive: async (path) => {
          const handle = await createRealHandle(path);
          if (!path.endsWith(".json")) return handle;
          return {
            ...handle,
            close: async () => {
              await handle.close();
              if (!injected) {
                injected = true;
                throw new Error("injected raw JSON close then throw");
              }
            },
          };
        },
      },
    });
    expect(outcome.state).toBe("failed");
    expect(await json(outputPath)).toMatchObject({
      failure: {
        message: "PSO warmup qualification result-json close failed",
        phase: "result-close",
      },
      state: "failed",
    });
  });

  it("never writes through a recovery reopen after pathname replacement", async () => {
    const root = await temporaryRoot();
    const inputPath = await writeValidReport(root);
    const outputPath = join(root, "qualification.json");
    const displacedPath = join(root, "qualification-displaced.json");
    const defaults = createPsoWarmupQualificationRunDependencies();
    let injected = false;
    await expect(
      runPsoWarmupQualification(runInput(inputPath, outputPath), {
        ...defaults,
        io: {
          ...defaults.io,
          createExclusive: async (path) => {
            const handle = await createRealHandle(path);
            if (!path.endsWith(".json")) return handle;
            return {
              ...handle,
              close: async () => {
                await handle.close();
                if (!injected) {
                  injected = true;
                  throw new Error("injected raw JSON close then throw");
                }
              },
            };
          },
          openExisting: async (path) => {
            await rename(path, displacedPath);
            await writeFile(path, "unrelated replacement\n", { flag: "wx" });
            return defaults.io.openExisting(path);
          },
        },
      }),
    ).rejects.toThrow(/result close and failure evidence finalization failed/);
    expect(await readFile(outputPath, "utf8")).toBe("unrelated replacement\n");
    expect(await readFile(displacedPath, "utf8")).toContain('"state": "passed"');
  });

  it("never writes through a recovery descriptor when the pathname races after reopen", async () => {
    const root = await temporaryRoot();
    const inputPath = await writeValidReport(root);
    const outputPath = join(root, "qualification.json");
    const displacedPath = join(root, "qualification-displaced.json");
    const defaults = createPsoWarmupQualificationRunDependencies();
    let injected = false;
    await expect(
      runPsoWarmupQualification(runInput(inputPath, outputPath), {
        ...defaults,
        io: {
          ...defaults.io,
          createExclusive: async (path) => {
            const handle = await createRealHandle(path);
            if (!path.endsWith(".json")) return handle;
            return {
              ...handle,
              close: async () => {
                await handle.close();
                if (!injected) {
                  injected = true;
                  throw new Error("injected raw JSON close then throw");
                }
              },
            };
          },
          openExisting: async (path) => {
            const reopened = await defaults.io.openExisting(path);
            await rename(path, displacedPath);
            await writeFile(path, "racing replacement\n", { flag: "wx" });
            return reopened;
          },
        },
      }),
    ).rejects.toThrow(/result close and failure evidence finalization failed/);
    expect(await readFile(outputPath, "utf8")).toBe("racing replacement\n");
    expect(await readFile(displacedPath, "utf8")).toContain('"state": "passed"');
  });

  it("retains failed JSON when the recovery descriptor closes underneath and then rejects", async () => {
    const root = await temporaryRoot();
    const inputPath = await writeValidReport(root);
    const outputPath = join(root, "qualification.json");
    const defaults = createPsoWarmupQualificationRunDependencies();
    let originalInjected = false;
    await expect(
      runPsoWarmupQualification(runInput(inputPath, outputPath), {
        ...defaults,
        io: {
          ...defaults.io,
          createExclusive: async (path) => {
            const handle = await createRealHandle(path);
            if (!path.endsWith(".json")) return handle;
            return {
              ...handle,
              close: async () => {
                await handle.close();
                if (!originalInjected) {
                  originalInjected = true;
                  throw new Error("injected raw JSON close then throw");
                }
              },
            };
          },
          openExisting: async (path) => {
            const handle = await defaults.io.openExisting(path);
            return {
              ...handle,
              close: async () => {
                await handle.close();
                throw new Error("injected recovery JSON close then throw");
              },
            };
          },
        },
      }),
    ).rejects.toThrow(/result close and failure evidence finalization failed/);
    expect(await json(outputPath)).toMatchObject({
      failure: { phase: "result-close" },
      state: "failed",
    });
  });

  it("keeps JSON open until a one-shot Markdown close failure is recorded truthfully", async () => {
    const root = await temporaryRoot();
    const inputPath = await writeValidReport(root);
    const outputPath = join(root, "qualification.json");
    const defaults = createPsoWarmupQualificationRunDependencies();
    let markdownCloseAttempts = 0;
    const outcome = await runPsoWarmupQualification(runInput(inputPath, outputPath), {
      ...defaults,
      io: {
        ...defaults.io,
        createExclusive: async (path) => {
          const handle = await createRealHandle(path);
          if (!path.endsWith(".md")) return handle;
          return {
            ...handle,
            close: async () => {
              markdownCloseAttempts += 1;
              if (markdownCloseAttempts === 1) {
                throw new Error("injected one-shot Markdown close failure");
              }
              await handle.close();
            },
          };
        },
      },
    });
    expect(markdownCloseAttempts).toBe(2);
    expect(outcome.state).toBe("failed");
    expect(await json(outcome.jsonPath)).toMatchObject({
      companion: { state: "failed" },
      failure: {
        message: "PSO warmup qualification result-markdown close failed",
        phase: "result-close",
      },
      state: "failed",
    });
    expect(await readFile(outcome.markdownPath, "utf8")).toContain("- State: `failed`");
  });

  it("retains failed primary evidence and rejects a persistent Markdown close failure", async () => {
    const root = await temporaryRoot();
    const inputPath = await writeValidReport(root);
    const outputPath = join(root, "qualification.json");
    const defaults = createPsoWarmupQualificationRunDependencies();
    let rawMarkdownClose: (() => Promise<void>) | undefined;
    await expect(
      runPsoWarmupQualification(runInput(inputPath, outputPath), {
        ...defaults,
        io: {
          ...defaults.io,
          createExclusive: async (path) => {
            const handle = await createRealHandle(path);
            if (!path.endsWith(".md")) return handle;
            rawMarkdownClose = handle.close;
            return {
              ...handle,
              close: () => Promise.reject(new Error("persistent Markdown close failure")),
            };
          },
        },
      }),
    ).rejects.toThrow(/result close and failure evidence finalization failed/);
    expect(await json(outputPath)).toMatchObject({
      companion: { state: "failed" },
      failure: { phase: "result-close" },
      state: "failed",
    });
    await rawMarkdownClose?.();
  });

  it("aggregates persistent Markdown and JSON close failures after publishing failed JSON", async () => {
    const root = await temporaryRoot();
    const inputPath = await writeValidReport(root);
    const outputPath = join(root, "qualification.json");
    const defaults = createPsoWarmupQualificationRunDependencies();
    const rawCloses: (() => Promise<void>)[] = [];
    let thrown: unknown;
    try {
      await runPsoWarmupQualification(runInput(inputPath, outputPath), {
        ...defaults,
        io: {
          ...defaults.io,
          createExclusive: async (path) => {
            const handle = await createRealHandle(path);
            rawCloses.push(handle.close);
            return {
              ...handle,
              close: () =>
                Promise.reject(
                  new Error(
                    path.endsWith(".md")
                      ? "persistent Markdown close failure"
                      : "persistent JSON close failure",
                  ),
                ),
            };
          },
        },
      });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(flattenErrorMessages(thrown)).toEqual(
      expect.arrayContaining([
        "persistent Markdown close failure",
        "persistent JSON close failure",
      ]),
    );
    expect(await json(outputPath)).toMatchObject({
      failure: { phase: "result-close" },
      state: "failed",
    });
    await Promise.all(rawCloses.map((close) => close()));
  });

  it("detects same-inode Markdown mutation during close and publishes failed JSON", async () => {
    const root = await temporaryRoot();
    const inputPath = await writeValidReport(root);
    const outputPath = join(root, "qualification.json");
    const defaults = createPsoWarmupQualificationRunDependencies();
    let mutated = false;
    const outcome = await runPsoWarmupQualification(runInput(inputPath, outputPath), {
      ...defaults,
      io: {
        ...defaults.io,
        createExclusive: async (path) => {
          const handle = await createRealHandle(path);
          if (!path.endsWith(".md")) return handle;
          return {
            ...handle,
            close: async () => {
              if (!mutated) {
                mutated = true;
                const current = await readFile(path, "utf8");
                await writeFile(path, `${current}\nmutated-with-token\n`);
              }
              await handle.close();
            },
          };
        },
      },
    });
    expect(outcome.state).toBe("failed");
    expect(await json(outputPath)).toMatchObject({
      failure: { phase: "result-close" },
      state: "failed",
    });
  });

  it("detects same-inode JSON mutation during close and never returns a passed outcome", async () => {
    const root = await temporaryRoot();
    const inputPath = await writeValidReport(root);
    const outputPath = join(root, "qualification.json");
    const defaults = createPsoWarmupQualificationRunDependencies();
    let mutated = false;
    await expect(
      runPsoWarmupQualification(runInput(inputPath, outputPath), {
        ...defaults,
        io: {
          ...defaults.io,
          createExclusive: async (path) => {
            const handle = await createRealHandle(path);
            if (!path.endsWith(".json")) return handle;
            return {
              ...handle,
              close: async () => {
                if (!mutated) {
                  mutated = true;
                  const current = await readFile(path, "utf8");
                  await writeFile(
                    path,
                    current.replace(
                      /\n {2}"state": "passed"\n\}\n$/u,
                      '\n  "state": "paszed"\n}\n',
                    ),
                  );
                }
                await handle.close();
              },
            };
          },
        },
      }),
    ).rejects.toThrow(/result close and failure evidence finalization failed/);
    expect(await readFile(outputPath, "utf8")).toMatch(/\n {2}"state": "paszed"\n\}\n$/u);
  });

  it("retains failed JSON when initial Markdown reservation writing fails", async () => {
    const root = await temporaryRoot();
    const inputPath = await writeValidReport(root);
    const outputPath = join(root, "qualification.json");
    const defaults = createPsoWarmupQualificationRunDependencies();
    await expect(
      runPsoWarmupQualification(runInput(inputPath, outputPath), {
        ...defaults,
        io: {
          ...defaults.io,
          createExclusive: async (path) => {
            const handle = await createRealHandle(path);
            if (!path.endsWith(".md")) return handle;
            return {
              ...handle,
              writeText: () => Promise.reject(new Error("injected pending Markdown write failure")),
            };
          },
        },
      }),
    ).rejects.toThrow(/reservation failed/);
    expect(await json(outputPath)).toMatchObject({
      companion: { state: "failed" },
      state: "failed",
    });
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "parallax-pso-run-"));
  cleanup.push(root);
  return root;
}

function runInput(inputPath: string, outputPath: string) {
  return {
    buildRoot: resolve(repositoryRoot, "dist"),
    inputPath,
    outputPath,
    repositoryRoot,
  };
}

async function writeValidReport(root: string): Promise<string> {
  const path = join(root, "smoke.json");
  const report = completePsoQualificationSmokeReport({
    artifactDigest: build.artifactDigest,
    chromePin,
    executableSha256: chromePin.executableSha256.win64 ?? "",
    psoWarmup: exactPsoSnapshot(),
    releaseDigest: build.releaseDigest,
    source,
  });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

function exactPsoSnapshot(): PsoWarmupTelemetrySnapshot {
  const identity = build.psoWarmupTrace;
  return {
    buildCompatibilityDigest: identity.buildCompatibilityDigest,
    cacheHitCount: 1,
    cacheMissCount: 3,
    compiledCount: 3,
    contract: "pso-warmup-telemetry@1",
    deferredCount: 3,
    entries: Object.freeze(
      identity.entries.map((entry, index) =>
        Object.freeze({
          compileAttemptCount: 1,
          compileDurationMs: 1,
          compiled: true,
          id: entry.id,
          requestCount: index === 0 ? 2 : 1,
          stateDigest: entry.stateDigest,
        }),
      ),
    ),
    failure: null,
    failureCount: 0,
    maximumCompileDurationMs: 1,
    queueHighWater: 3,
    releaseDigest: null,
    requestedCount: 4,
    schemaVersion: 1,
    source: "privileged-embedded",
    state: "ready",
    totalDurationMs: 2,
    traceEntryCount: 3,
    traceSha256: identity.sha256,
  };
}

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function createRealHandle(path: string): Promise<PsoWarmupQualificationEvidenceHandle> {
  const handle = await open(path, "wx+");
  return {
    close: () => handle.close(),
    readText: async () => {
      const size = Number((await handle.stat()).size);
      const bytes = Buffer.alloc(size);
      if (size > 0) await handle.read(bytes, 0, size, 0);
      return bytes.toString("utf8");
    },
    stat: () => handle.stat({ bigint: true }),
    writeText: async (value) => {
      await handle.truncate(0);
      await handle.write(value, 0, "utf8");
      await handle.sync();
    },
  };
}

function flattenErrorMessages(error: unknown): string[] {
  if (!(error instanceof Error)) return [String(error)];
  return [
    error.message,
    ...(error instanceof AggregateError
      ? error.errors.flatMap((nested: unknown) => flattenErrorMessages(nested))
      : []),
  ];
}
