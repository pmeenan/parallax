import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { sanitizeModelSourceFailure } from "./model-source-verification-command.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../..");

describe("model source verification command boundary", () => {
  it("turns a rejected HTTP-contract operation into a clean subprocess exit 1", async () => {
    const moduleUrl = new URL(
      "./harness/dist/types/model-source-verification-command.js",
      `file:///${repositoryRoot.replaceAll("\\", "/")}/`,
    ).href;
    const source =
      `import { runModelSourceVerificationCommand } from ${JSON.stringify(moduleUrl)};` +
      "await runModelSourceVerificationCommand(async () => {" +
      "throw new Error('fixture HTTP-contract failure');" +
      "});";
    const error = await execFileAsync(process.execPath, ["--input-type=module", "--eval", source], {
      cwd: repositoryRoot,
      windowsHide: true,
    }).catch((candidate: unknown) => candidate);
    expect(error).toMatchObject({
      code: 1,
      stderr: "Model-source verification failed: fixture HTTP-contract failure\n",
      stdout: "",
    });
  });

  it("redacts drive and UNC paths from pre-pending command failures", () => {
    expect(sanitizeModelSourceFailure(new Error("open C:\\private\\model.gguf failed"))).toBe(
      "open <local-path>",
    );
    expect(sanitizeModelSourceFailure(new Error("open \\\\server\\share\\model.gguf failed"))).toBe(
      "open <local-path>",
    );
  });

  it("redacts every model-source target form idempotently within the exact bound", () => {
    const cases = [
      ["connect to plex failed", "connect to <remote-host> failed"],
      ["connect to model-cache failed", "connect to <remote-host> failed"],
      ["connect to model-cache.internal failed", "connect to <remote-host> failed"],
      ["model-cache.internal", "<remote-host>"],
      ["10.20.30.40", "<remote-host>"],
      ["https://model-cache.internal/private/model.gguf", "<remote-target>"],
      ["ssh://model-cache.internal/private/model.gguf", "<remote-target>"],
      [
        "GET https://model-cache.internal/private/models/model.gguf failed",
        "GET <remote-target> failed",
      ],
      ["ssh deploy@plex:/var/private/model.gguf failed", "ssh <remote-target> failed"],
      ["connect 10.20.30.40:8443 failed", "connect <remote-host> failed"],
      ["connect [fd00:1234::5]:8443 failed", "connect <remote-host> failed"],
      ["connect [fd00:1234::5] failed", "connect <remote-host> failed"],
      ["getaddrinfo ENOTFOUND model-cache", "getaddrinfo ENOTFOUND <remote-host>"],
      ["dial tcp model-cache:8443", "dial tcp <remote-host>"],
      ["ssh: model-cache: connection refused", "ssh: <remote-host>: connection refused"],
      ["open C:\\private\\model.gguf failed", "open <local-path>"],
      ["open /srv/private/model.gguf failed", "open <local-path>"],
      [
        "GET https://user:password@model-cache.internal/private/model.gguf?token=secret failed",
        "GET <remote-target> failed",
      ],
    ] as const;
    for (const [raw, expected] of cases) {
      const sanitized = sanitizeModelSourceFailure(new Error(raw));
      expect(sanitized, raw).toBe(expected);
      expect(sanitizeModelSourceFailure(sanitized), raw).toBe(sanitized);
      expect(sanitized.length, raw).toBeLessThanOrEqual(512);
    }
    expect(sanitizeModelSourceFailure("x".repeat(600))).toBe("x".repeat(512));
    for (const raw of [
      "getaddrinfo ENOTFOUND model\u{e000}-cache",
      "ssh: model\u{e001}-cache: connection refused",
      "model\u{f0000}-cache.internal",
    ]) {
      const sanitized = sanitizeModelSourceFailure(raw);
      expect(sanitized).not.toMatch(/[\p{Co}]/u);
      expect(sanitized).not.toContain("model");
      expect(sanitized).not.toContain("cache");
      expect(sanitizeModelSourceFailure(sanitized)).toBe(sanitized);
    }
    const boundary = sanitizeModelSourceFailure(`${"x".repeat(505)} model-cache.internal`);
    expect(boundary).toBe("x".repeat(505));
    expect(boundary).not.toMatch(/<remote-(?:host|target)?$/u);
    expect(sanitizeModelSourceFailure(boundary)).toBe(boundary);
    for (const safe of [
      "No such host is known",
      "connect to <remote-host> failed",
      "GET <remote-target> failed",
    ]) {
      expect(sanitizeModelSourceFailure(safe)).toBe(safe);
      expect(sanitizeModelSourceFailure(sanitizeModelSourceFailure(safe))).toBe(safe);
    }
  });

  it("keeps pre-pending subprocess stderr path-free", async () => {
    const moduleUrl = new URL(
      "./harness/dist/types/model-source-verification-command.js",
      `file:///${repositoryRoot.replaceAll("\\", "/")}/`,
    ).href;
    const source =
      `import { runModelSourceVerificationCommand } from ${JSON.stringify(moduleUrl)};` +
      "await runModelSourceVerificationCommand(async () => {" +
      "throw new Error('open C:\\\\private\\\\model.gguf failed');" +
      "});";
    const error = await execFileAsync(process.execPath, ["--input-type=module", "--eval", source], {
      cwd: repositoryRoot,
      windowsHide: true,
    }).catch((candidate: unknown) => candidate as SubprocessFailure);
    expect(error).toMatchObject({
      code: 1,
      stderr: "Model-source verification failed: open <local-path>\n",
      stdout: "",
    });
  });

  it("persists path-free failed v2 evidence for every registry rejection", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "parallax-model-source-command-"));
    try {
      const sourceDirectory = join(fixtureRoot, "model-source");
      const nonDirectory = join(fixtureRoot, "not-a-directory");
      const junctionTarget = join(fixtureRoot, "junction-target");
      const junction = join(fixtureRoot, "junction");
      await Promise.all([
        mkdir(sourceDirectory),
        mkdir(junctionTarget),
        writeFile(nonDirectory, "fixture"),
      ]);
      await symlink(junctionTarget, junction, "junction");

      const cases = [
        { label: "missing", registry: join(fixtureRoot, "missing.json") },
        { label: "malformed", registryBody: "{", registry: join(fixtureRoot, "malformed.json") },
        {
          label: "wrong-version",
          registry: join(fixtureRoot, "wrong-version.json"),
          version: "wrong-model-version",
        },
        {
          label: "relative",
          path: ".\\model-source",
          registry: join(fixtureRoot, "relative.json"),
        },
        { label: "non-directory", path: nonDirectory, registry: join(fixtureRoot, "file.json") },
        { label: "junction", path: junction, registry: join(fixtureRoot, "junction.json") },
      ] as const;
      for (const scenario of cases) {
        const resultDirectory = join(fixtureRoot, `results-${scenario.label}`);
        if ("registryBody" in scenario) {
          await writeFile(scenario.registry, scenario.registryBody);
        } else if (scenario.label !== "missing") {
          await writeFile(
            scenario.registry,
            `${JSON.stringify(
              registryFixture(
                "version" in scenario ? scenario.version : "gemma-4-E2B-it-qat-GGUF-66a399f6",
                "path" in scenario ? scenario.path : sourceDirectory,
              ),
              null,
              2,
            )}\n`,
          );
        }
        const failure: SubprocessFailure = await execFileAsync(
          process.execPath,
          [resolve(repositoryRoot, "harness/dist/types/model-source-verification-run.js")],
          {
            cwd: repositoryRoot,
            env: {
              ...process.env,
              NODE_ENV: "test",
              PARALLAX_MODEL_SOURCE_REGISTRY_PATH: scenario.registry,
              PARALLAX_MODEL_SOURCE_RESULT_ROOT: resultDirectory,
            },
            timeout: 30_000,
            windowsHide: true,
          },
        ).then(
          () => {
            throw new Error(`${scenario.label} unexpectedly passed`);
          },
          (error: unknown) => error as SubprocessFailure,
        );
        expect(failure.code, scenario.label).toBe(1);
        expect(failure.stdout, scenario.label).toBe("");
        expect(failure.stderr, scenario.label).toBe(
          "Model-source verification failed: Machine-local model-content source resolution failed\n",
        );
        const names = (await readdir(resultDirectory)).sort();
        expect(names, scenario.label).toHaveLength(2);
        const jsonName = names.find((name) => name.endsWith(".json"));
        const markdownName = names.find((name) => name.endsWith(".md"));
        if (jsonName === undefined || markdownName === undefined) {
          throw new Error(`${scenario.label} omitted failed evidence companions`);
        }
        const [json, markdown] = await Promise.all([
          readFile(join(resultDirectory, jsonName), "utf8"),
          readFile(join(resultDirectory, markdownName), "utf8"),
        ]);
        expect(JSON.parse(json), scenario.label).toMatchObject({
          failure: "Machine-local model-content source resolution failed",
          schemaVersion: 2,
          state: "failed",
        });
        expect(markdown, scenario.label).toContain("- State: `failed`");
        expect(`${failure.stderr}\n${json}\n${markdown}`, scenario.label).not.toMatch(
          /(?:[A-Za-z]:[\\/]|\\\\)/,
        );
      }
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  }, 120_000);
});

interface SubprocessFailure {
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
}

function registryFixture(version: string, path: string): unknown {
  return {
    notice: "test fixture",
    repositoryRoot,
    schemaVersion: 1,
    tools: [
      {
        id: "production-model-content",
        path,
        pinSource: ["deploy/model-content.json"],
        role: "test fixture",
        verifiedAt: "2026-08-02",
        version,
      },
    ],
    updatedAt: "2026-08-02",
  };
}
