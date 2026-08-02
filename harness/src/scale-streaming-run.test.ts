import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { reserveResultPair } from "./result-pair.js";
import {
  SCALE_STREAMING_EVIDENCE_CONTRACT,
  SCALE_STREAMING_EVIDENCE_SCHEMA_VERSION,
  type ScaleStreamingEvidenceAuthority,
  type ScaleStreamingTerminalReport,
  validateScaleStreamingOwnedReport,
  validateScaleStreamingPendingReport,
} from "./scale-streaming-evidence.js";
import {
  createScaleStreamingBrowserExecutableState,
  orchestrateScaleStreamingAttempt,
  publishScaleStreamingTerminalReport,
  validateScaleStreamingPinnedNode,
} from "./scale-streaming-run.js";

describe("scale-streaming dependency-injected CLI orchestration", () => {
  it("owns browser executable state per attempt without module initialization or leakage", () => {
    const first = createScaleStreamingBrowserExecutableState();
    const second = createScaleStreamingBrowserExecutableState();
    expect(() => first.require()).toThrow(/unavailable/u);
    expect(() => second.require()).toThrow(/unavailable/u);

    first.set("C:\\pinned\\first-chrome.exe");
    expect(first.require()).toBe("C:\\pinned\\first-chrome.exe");
    expect(() => first.set("C:\\pinned\\replacement-chrome.exe")).toThrow(/already resolved/u);
    expect(() => second.require()).toThrow(/unavailable/u);

    second.set("C:\\pinned\\second-chrome.exe");
    expect(second.require()).toBe("C:\\pinned\\second-chrome.exe");
  });

  it("binds the registered Node path with platform semantics and corroborates process.version", () => {
    const registeredPath = "C:\\Pinned\\Node\\node.exe";
    expect(
      validateScaleStreamingPinnedNode({
        currentPath: "c:\\pinned\\node\\NODE.EXE",
        currentVersion: "v24.18.1",
        platform: "win32",
        registeredPath,
        registeredVersion: "24.18.1",
      }),
    ).toBe(registeredPath);
    expect(() =>
      validateScaleStreamingPinnedNode({
        currentPath: "c:\\pinned\\node\\NODE.EXE",
        currentVersion: "v24.18.1",
        platform: "linux",
        registeredPath,
        registeredVersion: "24.18.1",
      }),
    ).toThrow(/registered pinned Node/u);
    expect(() =>
      validateScaleStreamingPinnedNode({
        currentPath: registeredPath,
        currentVersion: "v24.18.0",
        platform: "win32",
        registeredPath,
        registeredVersion: "24.18.1",
      }),
    ).toThrow(/version contradicts/u);
  });

  it("instantiates browser executable state inside main before attempt callbacks", async () => {
    const source = await readFile(resolve(import.meta.dirname, "scale-streaming-run.ts"), "utf8");
    const placement = assertBrowserExecutableAttemptPlacement(source);
    const declarationText = source.slice(placement.statementStart, placement.statementEnd);
    const movedToModuleScope = `${source.slice(0, placement.statementStart)}${source.slice(
      placement.statementEnd,
    )}\n${declarationText}\n`;

    expect(() => assertBrowserExecutableAttemptPlacement(movedToModuleScope)).toThrow(
      /must be instantiated inside main/u,
    );
  });

  it.each([
    ["validation", "validate"],
    ["materialization", "materialize"],
    ["environment", "prepareEnvironment"],
    ["runtime", "run"],
    ["postvalidation", "postvalidate"],
  ] as const)("retains a %s failure without launching a browser", async (phase, failedStep) => {
    const result = await orchestrateScaleStreamingAttempt({
      cleanup: [{ operation: "cleanup", run: async () => undefined }],
      materialize: async () => {
        if (failedStep === "materialize") throw new Error("materialization failed");
      },
      postvalidate: async () => {
        if (failedStep === "postvalidate") throw new Error("postvalidation failed");
      },
      prepareEnvironment: async () => {
        if (failedStep === "prepareEnvironment") throw new Error("environment failed");
      },
      run: async () => {
        if (failedStep === "run") throw new Error("runtime failed");
        return "evidence";
      },
      validate: async () => {
        if (failedStep === "validate") throw new Error("validation failed");
      },
    });
    expect(result.failure).toMatchObject({ phase });
    expect(result.cleanup).toEqual([{ message: null, operation: "cleanup", state: "passed" }]);
  });

  it("aggregates every cleanup result and preserves success when all stages pass", async () => {
    const laterCleanup = vi.fn();
    const result = await orchestrateScaleStreamingAttempt({
      cleanup: [
        { operation: "first", run: async () => Promise.reject(new Error("first failed")) },
        { operation: "later", run: laterCleanup },
      ],
      materialize: async () => undefined,
      postvalidate: async () => undefined,
      prepareEnvironment: async () => undefined,
      run: async () => "evidence",
      validate: async () => undefined,
    });
    expect(result.value).toBe("evidence");
    expect(result.failure).toMatchObject({ message: "first failed", phase: "cleanup" });
    expect(result.cleanup).toHaveLength(2);
    expect(laterCleanup).toHaveBeenCalledOnce();

    const passed = await orchestrateScaleStreamingAttempt({
      cleanup: [{ operation: "cleanup", run: async () => undefined }],
      materialize: async () => undefined,
      postvalidate: async () => undefined,
      prepareEnvironment: async () => undefined,
      run: async () => "evidence",
      validate: async () => undefined,
    });
    expect(passed).toMatchObject({ failure: null, value: "evidence" });
  });

  it("audits the actual CLI for physical wake, ordinary routing, registry pin, and no retry", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../..");
    const source = await readFile(
      resolve(repositoryRoot, "harness/src/scale-streaming-run.ts"),
      "utf8",
    );
    const packageDocument = await readFile(resolve(repositoryRoot, "package.json"), "utf8");
    expect(source).toContain("launchAfterPhysicalConsoleDisplayWake");
    expect(source).toContain("validatePinnedToolRegistry");
    expect(source).toContain("reserveResultPair");
    expect(source).toContain("retainJsonPrimaryOnMarkdownFailure: true");
    expect(source).toContain("createScaleStreamingPageOperations(target.baseUrl)");
    expect(source).not.toContain("parallaxAutomation=runtime");
    expect(source).not.toContain('"--no-sandbox"');
    expect(source).not.toContain("automaticRetry");
    expect(packageDocument).toContain('"harness:scale-streaming"');
  });

  it("constructs pending and terminal reports from the validator-owned identifiers", async () => {
    const source = await readFile(resolve(import.meta.dirname, "scale-streaming-run.ts"), "utf8");
    expect(source).not.toContain('contract: "scale-streaming@1"');
    expect(source).toContain("contract: SCALE_STREAMING_EVIDENCE_CONTRACT");
    expect(source).toContain("schemaVersion: SCALE_STREAMING_EVIDENCE_SCHEMA_VERSION");
    expect(
      validateScaleStreamingPendingReport({
        contract: SCALE_STREAMING_EVIDENCE_CONTRACT,
        inputs: { machineId: "dev-01", tier: "showcase" },
        phase: "reservation",
        schemaVersion: SCALE_STREAMING_EVIDENCE_SCHEMA_VERSION,
        startedAt: "2026-08-02T00:00:00.000Z",
        state: "pending",
      }),
    ).toMatchObject({
      contract: SCALE_STREAMING_EVIDENCE_CONTRACT,
      schemaVersion: SCALE_STREAMING_EVIDENCE_SCHEMA_VERSION,
    });
  });

  it("publishes a sanitized failed JSON and closes both handles when terminal validation fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-scale-invalid-terminal-"));
    try {
      const startedAt = "2026-08-01T02:00:00.000Z";
      const reservation = await reserveResultPair(
        root,
        startedAt,
        validateScaleStreamingPendingReport({
          contract: "scale-streaming@1",
          inputs: { machineId: "dev-01", tier: "showcase" },
          phase: "reservation",
          schemaVersion: 1,
          startedAt,
          state: "pending",
        }),
        {},
        "scale-streaming",
        "Representative scale streaming qualification",
      );
      const authority: ScaleStreamingEvidenceAuthority = {
        artifactDigest: null,
        browser: null,
        corpus: null,
        // Reproduce an environment inspection that returned an object but failed the
        // registered/sandboxed gate. The emergency terminal must not retain it.
        environment: {} as ScaleStreamingEvidenceAuthority["environment"],
        releaseDigest: null,
        source: null,
        target: null,
      };
      const invalid = {
        browser: null,
        build: null,
        cleanup: [{ message: null, operation: "cleanup", state: "passed" }],
        companion: { path: reservation.markdownPath, state: "requested" },
        completedAt: "2026-08-01T02:00:01.000Z",
        contract: "scale-streaming@1",
        corpus: null,
        environment: null,
        evidence: null,
        failure: { message: "C:\\private\\invalid", phase: "validation" },
        inputs: {
          corpusDocumentPath: "unavailable",
          corpusRoot: "unavailable",
          machineId: "dev-01",
          tier: "showcase",
        },
        phase: "complete",
        postvalidation: null,
        progress: {
          cleanup: true,
          environment: false,
          materialization: false,
          postvalidation: false,
          runtime: false,
          validation: false,
        },
        schemaVersion: 1,
        source: null,
        startedAt,
        state: "failed",
        target: null,
      } as const satisfies ScaleStreamingTerminalReport;
      const terminal = await publishScaleStreamingTerminalReport(reservation, invalid, authority);
      expect(terminal).toMatchObject({
        failure: { message: "Scale-streaming result does not match exact current authority" },
        state: "failed",
      });
      expect(reservation.handleState()).toEqual({ jsonClosed: true, markdownClosed: true });
      const persisted = JSON.parse(await readFile(reservation.jsonPath, "utf8")) as unknown;
      expect(
        validateScaleStreamingOwnedReport(persisted, {
          ...authority,
          environment: null,
        }).report,
      ).toMatchObject({
        failure: { message: "Scale-streaming result does not match exact current authority" },
        state: "failed",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("closes both reserved handles when emergency terminal validation also fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-scale-invalid-emergency-"));
    try {
      const startedAt = "2026-08-01T02:00:00.000Z";
      const reservation = await reserveResultPair(
        root,
        startedAt,
        validateScaleStreamingPendingReport({
          contract: "scale-streaming@1",
          inputs: { machineId: "dev-01", tier: "showcase" },
          phase: "reservation",
          schemaVersion: 1,
          startedAt,
          state: "pending",
        }),
        {},
        "scale-streaming",
        "Representative scale streaming qualification",
      );
      const invalid = {
        contract: "forged",
        schemaVersion: 99,
        state: "passed",
      } as unknown as ScaleStreamingTerminalReport;

      await expect(
        publishScaleStreamingTerminalReport(reservation, invalid, {
          artifactDigest: null,
          browser: null,
          corpus: null,
          environment: null,
          releaseDigest: null,
          source: null,
          target: null,
        }),
      ).rejects.toThrow();
      expect(reservation.handleState()).toEqual({ jsonClosed: true, markdownClosed: true });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function assertBrowserExecutableAttemptPlacement(source: string): Readonly<{
  statementEnd: number;
  statementStart: number;
}> {
  const code = maskNonCode(source);
  const mainDeclaration =
    /\basync\s+function\s+main\s*\([^)]*\)\s*:\s*Promise<\s*void\s*>\s*\{/u.exec(code);
  if (mainDeclaration?.index === undefined) {
    throw new Error("Scale-streaming main declaration is absent");
  }
  const mainStart = code.indexOf("{", mainDeclaration.index);
  const mainEnd = matchingBrace(code, mainStart);
  const entrypoint = /\bawait\s+main\s*\(/u.exec(code);
  if (entrypoint?.index === undefined || entrypoint.index > mainDeclaration.index) {
    throw new Error("Scale-streaming top-level await main entrypoint is invalid");
  }

  const factoryPattern =
    /\b(?:const|let)\s+[A-Za-z_$][\w$]*\s*=\s*createScaleStreamingBrowserExecutableState\s*\(\s*\)\s*;/gu;
  const factoryDeclarations = [...code.matchAll(factoryPattern)];
  const factoryDeclaration = factoryDeclarations[0];
  if (factoryDeclarations.length !== 1 || factoryDeclaration?.index === undefined) {
    throw new Error("Browser executable state declaration is not unique");
  }
  const statementStart = factoryDeclaration.index;
  const statementEnd = statementStart + factoryDeclaration[0].length;
  if (statementStart <= mainStart || statementEnd >= mainEnd) {
    throw new Error("Browser executable state must be instantiated inside main");
  }
  const mainCode = code.slice(mainStart, mainEnd);
  const orchestrateCalls = [
    ...mainCode.matchAll(/\borchestrateScaleStreamingAttempt(?:<[^>]+>)?\s*\(/gu),
  ];
  const orchestrateCall = orchestrateCalls[0];
  if (orchestrateCalls.length !== 1 || orchestrateCall?.index === undefined) {
    throw new Error("Scale-streaming attempt orchestration call is not unique");
  }
  if (statementStart > mainStart + orchestrateCall.index) {
    throw new Error("Browser executable state must exist before attempt callbacks");
  }
  return Object.freeze({ statementEnd, statementStart });
}

function matchingBrace(code: string, openingBrace: number): number {
  if (openingBrace < 0) throw new Error("Scale-streaming main body is absent");
  let depth = 0;
  for (let index = openingBrace; index < code.length; index += 1) {
    if (code[index] === "{") depth += 1;
    if (code[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("Scale-streaming main body is unterminated");
}

function maskNonCode(source: string): string {
  const masked = source.split("");
  let state: "block" | "code" | "double" | "line" | "single" | "template" = "code";
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (state === "code" && current === "/" && next === "/") {
      masked[index] = masked[index + 1] = " ";
      state = "line";
      index += 1;
      continue;
    }
    if (state === "code" && current === "/" && next === "*") {
      masked[index] = masked[index + 1] = " ";
      state = "block";
      index += 1;
      continue;
    }
    if (state === "line") {
      if (current === "\n") state = "code";
      else masked[index] = " ";
      continue;
    }
    if (state === "block") {
      masked[index] = current === "\n" ? "\n" : " ";
      if (current === "*" && next === "/") {
        masked[index + 1] = " ";
        state = "code";
        index += 1;
      }
      continue;
    }
    if (state === "code" && (current === '"' || current === "'" || current === "`")) {
      state = current === '"' ? "double" : current === "'" ? "single" : "template";
      masked[index] = " ";
      continue;
    }
    if (state !== "code") {
      masked[index] = current === "\n" ? "\n" : " ";
      if (current === "\\") {
        if (index + 1 < masked.length) masked[index + 1] = " ";
        index += 1;
      } else if (
        (state === "double" && current === '"') ||
        (state === "single" && current === "'") ||
        (state === "template" && current === "`")
      ) {
        state = "code";
      }
    }
  }
  return masked.join("");
}
