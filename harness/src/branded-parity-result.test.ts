import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { InstalledBrandedChromeIdentity } from "./branded-chrome.js";
import {
  assembleBrandedParityReport,
  type BrandedParityPreRunIdentity,
  type BrandedParityReport,
  type BrandedParityReservation,
  failedBrandedParityReport,
  pendingBrandedParityReport,
  publishEarlyBrandedParityFailure,
  reserveBrandedParityResult,
  sanitizeBrandedParityEvidence,
  sanitizeBrandedParityFailure,
} from "./branded-parity-result.js";
import type { ChromePin } from "./chrome-pin.js";
import {
  invalidFinalizationEvidence,
  measuredFinalizationEvidence,
} from "./report-finalization.js";
import {
  SMOKE_MANDATORY_METRIC_SET_VERSION,
  SMOKE_METRICS,
  SMOKE_REPORT_SCHEMA_VERSION,
  SMOKE_SCENARIO,
} from "./runs/smoke.js";
import type { SmokeEvidenceReport } from "./smoke-run.js";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

const source = Object.freeze({ commit: "a".repeat(40), dirtyTreeDigest: "b".repeat(64) });
const artifactDigest = "c".repeat(64);
const releaseDigest = "d".repeat(64);
const target = Object.freeze({
  artifactDigest,
  artifactDigestVerified: true,
  kind: "production",
  localServerStarted: false,
  origin: "https://parallax-web.com",
  releaseDigest,
  releaseDigestVerified: true,
  servingContract: Object.freeze({}),
});
const expected = Object.freeze({
  artifactDigest,
  releaseDigest,
  source,
  target,
}) as unknown as BrandedParityPreRunIdentity;
const pin = Object.freeze({
  browserRevision: `@${"e".repeat(40)}`,
  channel: "stable",
  downloads: Object.freeze({}),
  executableSha256: Object.freeze({ win64: "f".repeat(64) }),
  revision: "1654411",
  version: "151.0.7922.71",
}) satisfies ChromePin;
const branded = Object.freeze({
  executablePath: resolve("C:/Program Files/Google/Chrome/Application/chrome.exe"),
  executableSha256: "1".repeat(64),
  fileDescription: "Google Chrome",
  fileVersion: "151.0.7922.68",
  originalFilename: "chrome.exe",
  productName: "Google Chrome",
  registryPath:
    "Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe",
  signatureStatus: "Valid",
  signerSubject: "CN=Google LLC, O=Google LLC",
}) satisfies InstalledBrandedChromeIdentity;
const observedBrowserVersion = Object.freeze({
  jsVersion: "15.1",
  product: `Chrome/${branded.fileVersion}`,
  protocolVersion: "1.3",
  revision: `@${"2".repeat(40)}`,
  userAgent: "Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36",
});

function smoke(overrides: Record<string, unknown> = {}): SmokeEvidenceReport {
  const base = {
    artifactDigest: expected.artifactDigest,
    build: {},
    callbackPacingVariance: [],
    chromePin: pin,
    coreRunFailure: null,
    environment: {
      adapter: {},
      browserCommandLine: "chrome.exe --type=browser",
      browserChannel: "chrome",
      browserDisplay: {},
      browserProduct: `Chrome/${branded.fileVersion}`,
      browserProtocolVersion: "1.3",
      browserRevision: `@${"2".repeat(40)}`,
      browserUserAgent: observedBrowserVersion.userAgent,
      executablePath: branded.executablePath,
      executableSha256: branded.executableSha256,
      gateIdentity: { state: "measured", value: true },
      gpuDevices: [{}],
      host: { remoteSession: false },
      hostAfterRuns: { remoteSession: false },
      jsVersion: "15.1",
      machine: { id: "dev-01" },
      machineId: "dev-01",
      requestedTier: "showcase",
      sandboxVerified: true,
      target,
      targetDisplayMode: "3840x2160@60",
      targetPostflight: { identity: target, state: "verified" },
      targetPreflight: { identity: target, state: "verified" },
    },
    facets: {
      budgetEvaluation: { evaluatedChecks: 30, reasons: [], status: "passed" },
      environment: { reasons: [], status: "passed" },
      evidenceCompleteness: { reasons: [], status: "passed" },
    },
    finalizationFailure: null,
    generatedAt: "2026-08-01T12:00:00.000Z",
    harnessRuntime: {},
    incompleteMetrics: [],
    informationalFailures: [],
    mandatoryMetricSet: {
      metrics: SMOKE_METRICS.filter((metric) => metric.mandatoryForHarnessV1).map(
        (metric) => metric.name,
      ),
      version: SMOKE_MANDATORY_METRIC_SET_VERSION,
    },
    passed: true,
    postRunIdentity: measuredFinalizationEvidence(),
    releaseDigest: expected.releaseDigest,
    reportPersistence: measuredFinalizationEvidence(),
    runs: Array.from({ length: 6 }, () => ({
      greyboxWorld: {
        state: "measured",
        value: { renderedOutput: { pngSha256: "3".repeat(64), visiblePixelRatio: 0.5 } },
      },
    })),
    scenario: SMOKE_SCENARIO,
    schemaVersion: SMOKE_REPORT_SCHEMA_VERSION,
    source,
    streamingCellLoadP95Variance: [],
    v8CodeCacheDiagnostics: [],
    v8CodeCacheDiagnosticsRequested: false,
    vizPresentationFeedbackCallbackVariance: [],
    ...overrides,
  };
  return base as unknown as SmokeEvidenceReport;
}

function assemble(evidence = smoke()): BrandedParityReport {
  return assembleBrandedParityReport({
    brandedBrowser: branded,
    comparisonReference: pin,
    expectedIdentity: expected,
    observedBrowserVersion,
    reportPersistence: measuredFinalizationEvidence(),
    smoke: evidence,
    startedAt: "2026-08-01T12:00:00.000Z",
  });
}

describe("branded-parity@1 evidence", () => {
  it("passes only the exact six-launch smoke facets/rendered-output and is baseline-ineligible", () => {
    const report = assemble();
    expect(report.state).toBe("passed");
    expect(report.authority).toMatchObject({
      baselineComparison: "ineligible",
      baselinePromotionAllowed: false,
      budgetAuthority: false,
      pinnedSmoke: false,
    });
  });

  it.each([
    ["unexpected raw CDP key", { ...observedBrowserVersion, unexpected: "field" }],
    ["oversized raw CDP field", { ...observedBrowserVersion, jsVersion: "x".repeat(1_025) }],
  ])("fails assembly for %s", (_label, invalidObservation) => {
    const report = assembleBrandedParityReport({
      brandedBrowser: branded,
      comparisonReference: pin,
      expectedIdentity: expected,
      observedBrowserVersion: invalidObservation,
      reportPersistence: measuredFinalizationEvidence(),
      smoke: smoke(),
      startedAt: "2026-08-01T12:00:00.000Z",
    });
    expect(report.state).toBe("failed");
    expect(report.postValidation.state).toBe("invalid");
  });

  it.each([
    [
      "missing facets",
      {
        facets: {
          budgetEvaluation: { evaluatedChecks: 0, reasons: [], status: "not-evaluated" },
          environment: { reasons: [], status: "passed" },
          evidenceCompleteness: { reasons: ["missing"], status: "failed" },
        },
        passed: false,
      },
    ],
    ["missing launch", { runs: smoke().runs.slice(0, 5) }],
    [
      "missing rendered output",
      {
        runs: smoke().runs.map((run, index) =>
          index === 0
            ? { ...run, greyboxWorld: { state: "measured", value: { renderedOutput: null } } }
            : run,
        ),
      },
    ],
    ["source mismatch", { source: { ...source, dirtyTreeDigest: "9".repeat(64) } }],
    ["artifact mismatch", { artifactDigest: "8".repeat(64) }],
  ])("fails adversarial %s evidence", (_label, overrides) => {
    expect(assemble(smoke(overrides)).state).toBe("failed");
  });

  it.each([
    ["sandbox", { sandboxVerified: false }],
    ["remote", { host: { remoteSession: true } }],
    [
      "unregistered",
      { machineId: "other", gateIdentity: { reasons: ["bad"], state: "invalid", value: false } },
    ],
    ["hash injection", { executableSha256: "0".repeat(64) }],
    ["path injection", { executablePath: resolve("C:/arbitrary/chrome.exe") }],
    ["missing branded channel", { browserChannel: undefined }],
  ])("fails %s environment substitution", (_label, environmentOverride) => {
    const base = smoke();
    expect(
      assemble(smoke({ environment: { ...base.environment, ...environmentOverride } })).state,
    ).toBe("failed");
  });

  it("fails local/changed target and exact postvalidation", () => {
    const base = smoke();
    const localTarget = { ...base.environment.target, kind: "local", origin: "http://127.0.0.1" };
    expect(
      assemble(smoke({ environment: { ...base.environment, target: localTarget } })).state,
    ).toBe("failed");
    expect(
      assemble(
        smoke({
          environment: {
            ...base.environment,
            targetPostflight: {
              identity: { ...base.environment.target, artifactDigest: "7".repeat(64) },
              state: "verified",
            },
          },
        }),
      ).state,
    ).toBe("failed");
    expect(assemble(smoke({ postRunIdentity: invalidFinalizationEvidence("drift") })).state).toBe(
      "failed",
    );
  });

  it("cross-binds the CfT descriptor and all three target identities", () => {
    const base = smoke();
    expect(assemble(smoke({ chromePin: { ...pin, revision: "1654412" } })).state).toBe("failed");
    expect(
      assemble(
        smoke({
          environment: {
            ...base.environment,
            targetPreflight: {
              identity: {
                ...base.environment.target,
                servingContract: { forged: true },
              },
              state: "verified",
            },
          },
        }),
      ).state,
    ).toBe("failed");
    expect(
      assembleBrandedParityReport({
        brandedBrowser: branded,
        comparisonReference: pin,
        expectedIdentity: {
          ...expected,
          target: { ...expected.target, releaseDigest: "6".repeat(64) },
        },
        observedBrowserVersion,
        reportPersistence: measuredFinalizationEvidence(),
        smoke: base,
        startedAt: "2026-08-01T12:00:00.000Z",
      }).state,
    ).toBe("failed");
  });

  it("represents pending and explicit failure without claiming parity", () => {
    expect(pendingBrandedParityReport("2026-08-01T12:00:00.000Z").state).toBe("pending");
    expect(
      failedBrandedParityReport({
        error: "installed Chrome 150 is behind selected 151",
        reportPersistence: measuredFinalizationEvidence(),
        startedAt: "2026-08-01T12:00:00.000Z",
      }),
    ).toMatchObject({ passed: false, state: "failed" });
    expect(
      assembleBrandedParityReport({
        brandedBrowser: branded,
        comparisonReference: pin,
        expectedIdentity: expected,
        observedBrowserVersion,
        reportPersistence: invalidFinalizationEvidence(
          "Human-readable report persistence has not completed",
        ),
        smoke: smoke({
          reportPersistence: invalidFinalizationEvidence(
            "Human-readable report persistence has not completed",
          ),
        }),
        startedAt: "2026-08-01T12:00:00.000Z",
      }).state,
    ).toBe("pending");
  });

  it("cannot assemble installed Chrome 150 as passing parity against CfT 151", () => {
    expect(
      assembleBrandedParityReport({
        brandedBrowser: { ...branded, fileVersion: "150.0.7871.115" },
        comparisonReference: pin,
        expectedIdentity: expected,
        observedBrowserVersion,
        reportPersistence: measuredFinalizationEvidence(),
        smoke: smoke(),
        startedAt: "2026-08-01T12:00:00.000Z",
      }).state,
    ).toBe("failed");
  });

  it("retains installed and raw CDP identity when their relationship fails", () => {
    const invalidObservation = {
      ...observedBrowserVersion,
      product: "Chrome/151.0.7922.67",
      userAgent: "Mozilla/5.0 Chrome/151.0.7922.67 Safari/537.36",
    };
    expect(
      failedBrandedParityReport({
        brandedBrowser: branded,
        comparisonReference: pin,
        error: "Browser.getVersion product mismatch",
        observedBrowserVersion: invalidObservation,
        reportPersistence: measuredFinalizationEvidence(),
        startedAt: "2026-08-01T12:00:00.000Z",
      }),
    ).toMatchObject({
      brandedBrowser: branded,
      observedBrowserVersion: invalidObservation,
      passed: false,
      state: "failed",
    });
  });

  it("reserves a collision-safe result directory without touching the collision", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-branded-parity-"));
    temporaryRoots.push(root);
    const startedAt = "2026-08-01T12:00:00.000Z";
    const collision = join(root, "branded-parity-v2-2026-08-01T12-00-00-000Z");
    await mkdir(collision);
    const marker = join(collision, "owned.txt");
    await writeFile(marker, "unrelated");
    const reserved = await reserveBrandedParityResult(
      root,
      startedAt,
      pendingBrandedParityReport(startedAt),
    );
    expect(reserved.stem).toBe("branded-parity-v2-2026-08-01T12-00-00-000Z-1");
    expect(await readFile(marker, "utf8")).toBe("unrelated");
  });

  it("retains failed JSON when companion publication fails", async () => {
    const writes = new Map<string, string>();
    const reservation = {
      directory: "result",
      jsonPath: "result/result.json",
      markdownPath: "result/result.md",
      persistenceDependencies: {
        publishMarkdown: async () => {
          throw new Error("companion publish failed");
        },
        removePendingMarkdown: async () => undefined,
        writeJson: async (path: string, value: string) => {
          writes.set(path, value);
        },
        writePendingMarkdown: async () => undefined,
      },
      stem: "result",
    } satisfies BrandedParityReservation;
    const report = failedBrandedParityReport({
      error: "version lag",
      reportPersistence: measuredFinalizationEvidence(),
      startedAt: "2026-08-01T12:00:00.000Z",
    });
    const persisted = await publishEarlyBrandedParityFailure(reservation, report);
    expect(persisted.state).toBe("failed");
    expect(persisted.reportPersistence.state).toBe("invalid");
    expect(writes.get(reservation.jsonPath)).toContain("companion publish failed");
  });

  it("sanitizes and bounds every failure/finalization message before JSON", () => {
    const hostile =
      "\u0000Bearer super-secret token=abc https://user:pass@example.test/path?token=abc C:\\Users\\name\\secret.txt \\\\server\\share\\secret /home/name/secret file:///C:/private/secret " +
      '"C:\\Program Files\\Google\\Chrome\\secret.txt" ' +
      "x".repeat(2_000);
    const sanitized = sanitizeBrandedParityFailure(hostile);
    expect(sanitized.length).toBeLessThanOrEqual(512);
    expect(sanitized).not.toMatch(
      /super-secret|abc|user:pass|Users|server|home|private|Program Files/u,
    );
    expect(sanitized).not.toContain("\u0000");
    expect(sanitized).toContain("<redacted>");
    expect(sanitized).toContain("<path>");
    expect(sanitized).toContain("<url>");

    const sanitizedEvidence = sanitizeBrandedParityEvidence({
      coreRunFailure: { message: hostile },
      facets: { environment: { reasons: [hostile] } },
      finalizationFailure: hostile,
      requiredExecutablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    });
    const serialized = JSON.stringify(sanitizedEvidence);
    expect(serialized).not.toMatch(/super-secret|user:pass|Users\\\\name|server\\\\share/u);
    expect(sanitizedEvidence.requiredExecutablePath).toContain("Program Files");

    const failed = failedBrandedParityReport({
      error: hostile,
      reportPersistence: invalidFinalizationEvidence(hostile),
      smoke: smoke({
        coreRunFailure: { message: hostile },
        finalizationFailure: hostile,
        informationalFailures: [hostile],
      }),
      startedAt: "2026-08-01T12:00:00.000Z",
    });
    const json = JSON.stringify(failed);
    expect(json).not.toMatch(/super-secret|user:pass|Users\\\\name|server\\\\share/u);
    expect(failed.failure?.length).toBeLessThanOrEqual(512);
    expect(failed.reportPersistence.reason?.length).toBeLessThanOrEqual(512);
  });

  it("redacts credential-key variants recursively without consuming neighboring prose", () => {
    const reviewerVariants = [
      "credential : cred-value-01",
      "ACCESS_TOKEN=access-value-02",
      "access-token : access-value-03",
      "accessToken = access-value-04",
      "refresh_token=refresh-value-05",
      "refresh-token : refresh-value-06",
      "refreshToken = refresh-value-07",
      "client_secret=client-value-08",
      "client-secret : client-value-09",
      "clientSecret = client-value-10",
      "Cookie: cookie-value-11",
      "set-cookie = cookie-value-12",
      "session: session-value-13",
      "session_id=session-value-14",
      "session-id : session-value-15",
      "sessionId = session-value-16",
      "api_key=api-value-17",
      "api-key : api-value-18",
      "apiKey = api-value-19",
      "password=password-value-20",
      "passwd : passwd-value-21",
      "secret = secret-value-22",
      "token:token-value-23",
      "auth = auth-value-24",
      "authorization: Basic authorization-value-25",
    ];
    const retained = sanitizeBrandedParityEvidence({
      failure: `neighboring prose remains intact | ${reviewerVariants.join(" | ")}`,
      nested: {
        message: reviewerVariants.join(" | "),
        reasons: reviewerVariants,
      },
    });
    const json = JSON.stringify(retained);
    for (let index = 1; index <= reviewerVariants.length; index += 1) {
      expect(json).not.toContain(`value-${String(index).padStart(2, "0")}`);
    }
    expect(retained.failure).toContain("neighboring prose remains intact");
  });

  it.each([
    "session expired while renderer continued",
    "token acquisition failed before retry",
    "authorization failed during CDP setup",
    "secret retrieval returned unavailable",
  ])("preserves non-assignment credential-key prose exactly: %s", (prose) => {
    expect(sanitizeBrandedParityFailure(prose)).toBe(prose);
  });

  it("redacts explicit quoted assignments and authentication schemes without leakage", () => {
    const input = [
      'credential "quoted-credential-value"',
      "accessToken 'quoted-access-value'",
      "refresh_token: unquoted-refresh-value",
      "client-secret=unquoted-client-value",
      "Authorization: Bearer bearer-value",
      "Basic basic-value",
      "Digest digest-value",
    ].join(" | ");
    const sanitized = sanitizeBrandedParityFailure(input);
    expect(sanitized).not.toMatch(
      /quoted-credential-value|quoted-access-value|unquoted-refresh-value|unquoted-client-value|bearer-value|basic-value|digest-value/u,
    );
    expect(sanitized.match(/<redacted>/gu)?.length).toBe(7);
  });
});
