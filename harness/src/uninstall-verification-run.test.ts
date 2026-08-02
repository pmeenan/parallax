import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reserveResultPair } from "./result-pair";
import {
  type ClearSiteDataCdpObservation,
  removeTrackedUninstallMechanismProfile,
  resolveClearSiteDataResponse,
  validateProductUninstallUiReadiness,
  validateSetupProgress,
  validateUninstallInertProbeAttestation,
  validateUninstallTerminalReport,
} from "./uninstall-verification-run";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true });
});

describe("uninstall verification result adapter", () => {
  it("removes and untracks only the profile owned by each mechanism", async () => {
    const clientProfile = await mkdtemp(join(tmpdir(), "parallax-client-profile-test-"));
    const clearSiteDataProfile = await mkdtemp(join(tmpdir(), "parallax-clear-profile-test-"));
    roots.push(clientProfile, clearSiteDataProfile);
    const trackedProfiles = [clientProfile, clearSiteDataProfile];

    await removeTrackedUninstallMechanismProfile("client-side", clientProfile, trackedProfiles);
    await expect(stat(clientProfile)).rejects.toThrow();
    await expect(stat(clearSiteDataProfile)).resolves.toBeDefined();
    expect(trackedProfiles).toEqual([clearSiteDataProfile]);

    await removeTrackedUninstallMechanismProfile(
      "clear-site-data",
      clearSiteDataProfile,
      trackedProfiles,
    );
    await expect(stat(clearSiteDataProfile)).rejects.toThrow();
    expect(trackedProfiles).toEqual([]);
  });

  it("uses the shared owned-pair adapter for pending and terminal evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-uninstall-adapter-test-"));
    roots.push(root);
    const pending = {
      contract: "uninstall-verification@1",
      postValidation: { passed: false, performed: false },
      schemaVersion: 3,
      setupAuthority: null,
      setupProgress: { browser: null, build: null, environment: null, source: null, target: null },
      startedAt: "2026-07-31T20:00:00.000Z",
      state: "pending",
    } as const;
    const reservation = await reserveResultPair(
      root,
      pending.startedAt,
      pending,
      {},
      "uninstall-verification",
      "Uninstall verification",
    );
    const authority = { artifactDigest: "a".repeat(64), releaseDigest: "b".repeat(64) };
    await reservation.publishPendingJson({ ...pending, setupAuthority: authority });
    await reservation.publishPair(
      {
        ...pending,
        completedAt: "2026-07-31T20:01:00.000Z",
        failure: { message: "bounded", phase: "mechanism" },
        postValidation: { passed: false, performed: true },
        setupAuthority: authority,
        state: "failed",
      },
      "# Uninstall verification\n\n- State: `failed`\n",
      "failed",
      { retainJsonPrimaryOnMarkdownFailure: true },
    );
    const retained = JSON.parse(await readFile(reservation.jsonPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(retained).toMatchObject({ setupAuthority: authority, state: "failed" });
  });

  it("contains no duplicate owned-file implementation", async () => {
    const source = await readFile(
      join(import.meta.dirname, "uninstall-verification-run.ts"),
      "utf8",
    );
    expect(source).toContain("reserveResultPair");
    expect(source).not.toContain('open(path, "wx+")');
    expect(source).not.toContain("writeOwned(");
    expect(source).toContain("--physical-console-confirmed");
    expect(source).toContain('type: "module"');
    expect(source).toContain("uninstallSentinelWorkerPath(prefix)");
    expect(source).toContain('worker?.state === "redundant"');
    expect(source).toContain("click({ noWaitAfter: true })");
    expect(source).not.toContain("waitForURL(");
    const cacheProbe = source.indexOf("const cacheBefore = await attemptCacheProbes");
    const baseline = source.indexOf("const beforeSeedUsage = await estimate(page)");
    const seed = source.indexOf("await seedSentinels(page, sentinelPrefix");
    const inventory = source.indexOf("const before = await inspectStorage(page)");
    const postSeedQuota = source.indexOf("const beforeUsage = await estimate(page)");
    expect(
      [cacheProbe, baseline, seed, inventory, postSeedQuota].every((index) => index >= 0),
    ).toBe(true);
    expect(cacheProbe).toBeLessThan(baseline);
    expect(baseline).toBeLessThan(seed);
    expect(seed).toBeLessThan(inventory);
    expect(inventory).toBeLessThan(postSeedQuota);
    const observationWindow = source.slice(baseline, postSeedQuota);
    expect(observationWindow).not.toContain(".reload(");
    expect(observationWindow).not.toContain("attemptCacheProbes");
    expect(source).toContain("await prepareInertUninstallProbe({");
    expect(source).toContain("const capture = await captureUninstallBeforeObservation(");
    const captureReturn = source.indexOf(
      "const { before, beforeSeedUsage, beforeUsage } = capture",
    );
    const productReady = source.indexOf("await reopenAndAttestProductUninstallUi(");
    const mechanismBranch = source.indexOf('if (input.mechanism === "client-side")', productReady);
    expect(captureReturn).toBeGreaterThanOrEqual(0);
    expect(captureReturn).toBeLessThan(productReady);
    expect(productReady).toBeLessThan(mechanismBranch);
    expect(source.match(/await reopenAndAttestProductUninstallUi\(/gu)).toHaveLength(1);
    expect(source.slice(productReady, mechanismBranch)).toContain(
      "page, input.origin, input.mechanism",
    );
    expect(
      source.slice(mechanismBranch, source.indexOf("const inspectionPage", mechanismBranch)),
    ).not.toContain("page.goto(input.origin");
    expect(source).toContain('await input.page.goto(input.probeUrl, { waitUntil: "load" })');
    expect(source).toContain('session.send("Target.getTargets")');
    expect(source).not.toContain("unregister()");
  });

  it("attests ready product uninstall selectors for both mechanisms", () => {
    const origin = "http://127.0.0.1:1234";
    const availableSelectors = [
      "#uninstall-open",
      "#uninstall-client-confirm",
      "#uninstall-site-data-confirm",
    ];
    for (const [mechanism, selectedConfirmationSelector] of [
      ["client-side", "#uninstall-client-confirm"],
      ["clear-site-data", "#uninstall-site-data-confirm"],
    ] as const) {
      const attestation = {
        availableSelectors,
        location: `${origin}/`,
        readyState: "complete" as const,
        selectedConfirmationSelector,
      };
      expect(() =>
        validateProductUninstallUiReadiness(attestation, origin, mechanism),
      ).not.toThrow();
      expect(() =>
        validateProductUninstallUiReadiness(
          { ...attestation, availableSelectors: availableSelectors.slice(0, -1) },
          origin,
          mechanism,
        ),
      ).toThrow(/readiness attestation/u);
      expect(() =>
        validateProductUninstallUiReadiness(
          { ...attestation, selectedConfirmationSelector: "#not-product-uninstall" },
          origin,
          mechanism,
        ),
      ).toThrow(/readiness attestation/u);
    }
  });

  it("requires exact inert-probe content, controller, registration, and runtime absence", () => {
    const location = "http://127.0.0.1:1234/__parallax/identity";
    const controllerScriptUrl = "http://127.0.0.1:1234/service-worker.js";
    const expected = {
      controllerScriptUrl,
      location,
      registrationScope: "http://127.0.0.1:1234/",
    };
    const attestation = {
      controllerScriptUrl,
      location,
      marker: "parallax-harness-inert-v1",
      registrationScopes: [expected.registrationScope],
      registrationScriptUrls: [controllerScriptUrl],
      runtimeGlobalsAbsent: true,
      scriptCount: 0,
      title: "Parallax harness identity probe",
    };
    expect(() => validateUninstallInertProbeAttestation(attestation, expected)).not.toThrow();
    for (const forged of [
      { ...attestation, controllerScriptUrl: null },
      { ...attestation, marker: null },
      { ...attestation, registrationScopes: [] },
      { ...attestation, runtimeGlobalsAbsent: false },
      { ...attestation, scriptCount: 1 },
    ]) {
      expect(() =>
        validateUninstallInertProbeAttestation(
          forged as Parameters<typeof validateUninstallInertProbeAttestation>[0],
          expected,
        ),
      ).toThrow(/attestation/u);
    }
  });

  it("rejects terminal failed evidence rebound away from setup authority", () => {
    const authority = authorityFixture();
    const report = {
      cleanupFailures: [],
      completedAt: "2026-07-31T20:01:00.000Z",
      contract: "uninstall-verification@1" as const,
      evidence: null,
      failure: { message: "bounded", phase: "mechanism" },
      mechanismDiagnostics: [],
      postValidation: { passed: false, performed: true },
      schemaVersion: 3 as const,
      setupAuthority: { ...authority, releaseDigest: "9".repeat(64) },
      setupProgress: {
        browser: authority.browser,
        build: { artifactDigest: authority.artifactDigest, releaseDigest: authority.releaseDigest },
        environment: authority.environment,
        source: authority.source,
        target: authority.target,
      },
      startedAt: "2026-07-31T20:00:00.000Z",
      state: "failed" as const,
    };
    expect(() => validateUninstallTerminalReport(report, authority)).toThrow(/authority/);
  });

  it("rejects vacuous passed evidence and forged terminal contract identities", () => {
    const authority = authorityFixture();
    const report = {
      cleanupFailures: [],
      completedAt: "2026-07-31T20:01:00.000Z",
      contract: "uninstall-verification@1" as const,
      evidence: {
        contract: "uninstall-verification@1" as const,
        mechanisms: [],
        passed: true,
        schemaVersion: 3 as const,
      },
      failure: null,
      mechanismDiagnostics: [
        {
          attempt: 1,
          failures: [],
          mechanism: "client-side" as const,
          state: "succeeded" as const,
        },
      ],
      postValidation: { passed: true, performed: true },
      schemaVersion: 3 as const,
      setupAuthority: authority,
      setupProgress: {
        browser: authority.browser,
        build: { artifactDigest: authority.artifactDigest, releaseDigest: authority.releaseDigest },
        environment: authority.environment,
        source: authority.source,
        target: authority.target,
      },
      startedAt: "2026-07-31T20:00:00.000Z",
      state: "passed" as const,
    };
    expect(() => validateUninstallTerminalReport(report, authority)).toThrow(/evidence authority/u);
    expect(() =>
      validateUninstallTerminalReport(
        { ...report, contract: "forged" } as unknown as Parameters<
          typeof validateUninstallTerminalReport
        >[0],
        authority,
      ),
    ).toThrow(/contradicts/u);
    expect(() =>
      validateUninstallTerminalReport(
        { ...report, schemaVersion: 99 } as unknown as Parameters<
          typeof validateUninstallTerminalReport
        >[0],
        authority,
      ),
    ).toThrow(/contradicts/u);
  });

  it("accepts exact early-failure provenance without inventing environment authority", () => {
    expect(() =>
      validateSetupProgress(
        {
          browser: { executableSha256: null, product: "Chrome/151", revision: "r" },
          build: { artifactDigest: "a".repeat(64), releaseDigest: "b".repeat(64) },
          environment: null,
          source: { commit: "c".repeat(40), dirtyTreeDigest: null },
          target: null,
        },
        null,
      ),
    ).not.toThrow();
  });

  it("rejects a measured environment before target/browser prerequisites", () => {
    expect(() =>
      validateSetupProgress(
        {
          browser: { executableSha256: null, product: "Chrome/151", revision: "r" },
          build: { artifactDigest: "a".repeat(64), releaseDigest: "b".repeat(64) },
          environment: { gateState: "measured", machineId: "dev-01", tier: "showcase" },
          source: { commit: "c".repeat(40), dirtyTreeDigest: null },
          target: null,
        },
        null,
      ),
    ).toThrow(/prematurely/);
  });

  it("retains a canonical failed client terminal diagnostic", () => {
    const authority = authorityFixture();
    const diagnostic = {
      attempt: 1,
      failures: [{ message: "client count was 2", phase: "quiescence", surface: "runtime" }],
      mechanism: "client-side" as const,
      state: "failed" as const,
    };
    const report = {
      cleanupFailures: [],
      completedAt: "2026-07-31T20:01:00.000Z",
      contract: "uninstall-verification@1" as const,
      evidence: null,
      failure: { message: "bounded", phase: "client-side-profile" },
      mechanismDiagnostics: [diagnostic],
      postValidation: { passed: false, performed: false },
      schemaVersion: 3 as const,
      setupAuthority: authority,
      setupProgress: {
        browser: authority.browser,
        build: { artifactDigest: authority.artifactDigest, releaseDigest: authority.releaseDigest },
        environment: authority.environment,
        source: authority.source,
        target: authority.target,
      },
      startedAt: "2026-07-31T20:00:00.000Z",
      state: "failed" as const,
    };
    expect(() => validateUninstallTerminalReport(report, authority)).not.toThrow();
    expect(() =>
      validateUninstallTerminalReport(
        { ...report, postValidation: { passed: true, performed: true } },
        authority,
      ),
    ).not.toThrow();
    expect(() =>
      validateUninstallTerminalReport(
        { ...report, postValidation: { passed: true, performed: false } },
        authority,
      ),
    ).toThrow(/contradicts/u);
    expect(() =>
      validateUninstallTerminalReport(
        {
          ...report,
          postValidation: { passed: false, performed: false, surprise: true },
        } as unknown as Parameters<typeof validateUninstallTerminalReport>[0],
        authority,
      ),
    ).toThrow(/contradicts/u);
    expect(() =>
      validateUninstallTerminalReport(
        { ...report, mechanismDiagnostics: [{ ...diagnostic, state: "succeeded" }] },
        authority,
      ),
    ).toThrow(/contradicts/u);
  });

  it("requires one exact direct-network CDP observation plus one guarded server record", () => {
    const entry = {
      cacheControl: "no-store",
      clearSiteData: '"storage", "cache"',
      completion: "completed",
      contentType: "text/html; charset=utf-8",
      coop: "same-origin",
      coep: "require-corp",
      ifRange: null,
      intendedStatus: 200,
      method: "POST",
      nosniff: "nosniff",
      path: "/uninstall",
      range: null,
      headersSent: true,
      status: 200,
    } as const;
    const direct = clearSiteDataCdpObservation();
    expect(resolveClearSiteDataResponse([entry], "http://127.0.0.1:1234", [direct])).toEqual({
      clearSiteData: '"storage", "cache"',
      fromServiceWorker: false,
      method: "POST",
      requestId: "cdp-uninstall-1",
      status: 200,
      transport: "completed",
      url: "http://127.0.0.1:1234/uninstall",
    });
    expect(
      resolveClearSiteDataResponse(
        [{ ...entry, completion: "client-closed", status: 499 }],
        "http://127.0.0.1:1234",
        [direct],
      ).transport,
    ).toBe("client-closed-after-headers");
    expect(() =>
      resolveClearSiteDataResponse([entry, entry], "http://127.0.0.1:1234", [direct]),
    ).toThrow(/one exact/u);
    expect(() =>
      resolveClearSiteDataResponse([{ ...entry, clearSiteData: null }], "http://127.0.0.1:1234", [
        direct,
      ]),
    ).toThrow(/one exact/u);
    expect(() =>
      resolveClearSiteDataResponse(
        [{ ...entry, completion: "client-closed", headersSent: false, status: 499 }],
        "http://127.0.0.1:1234",
        [direct],
      ),
    ).toThrow(/one exact/u);
    expect(() => resolveClearSiteDataResponse([entry], "http://127.0.0.1:1234", [])).toThrow(
      /exactly one URL-scoped CDP/u,
    );
    for (const nonmatch of [
      { ...direct, clearSiteData: null },
      { ...direct, method: "GET" },
      { ...direct, requestId: "" },
      { ...direct, status: 204 },
      { ...direct, url: "http://127.0.0.1:1234/not-uninstall" },
    ]) {
      expect(() =>
        resolveClearSiteDataResponse([entry], "http://127.0.0.1:1234", [nonmatch]),
      ).toThrow(/exact request\/response/u);
    }
    expect(() =>
      resolveClearSiteDataResponse([entry], "http://127.0.0.1:1234", [
        direct,
        { ...direct, requestId: "cdp-uninstall-2" },
      ]),
    ).toThrow(/exactly one URL-scoped CDP/u);
    for (const ambiguous of [
      [direct, { ...direct, fromServiceWorker: "false" }],
      [direct, { ...direct, method: "GET" }],
      [
        { ...direct, clearSiteData: null },
        { ...direct, requestId: "" },
      ],
    ]) {
      expect(() =>
        resolveClearSiteDataResponse([entry], "http://127.0.0.1:1234", ambiguous),
      ).toThrow(/exactly one URL-scoped CDP/u);
    }

    const passThroughFetch = { ...direct, fromServiceWorker: true };
    const { fromServiceWorker: _missing, ...missingProvenance } = direct;
    const malformedProvenance = { ...direct, fromServiceWorker: "false" };
    for (const observation of [passThroughFetch, missingProvenance, malformedProvenance]) {
      expect(() =>
        resolveClearSiteDataResponse([entry], "http://127.0.0.1:1234", [observation]),
      ).toThrow(/direct network provenance/u);
    }
  });
});

function clearSiteDataCdpObservation(): ClearSiteDataCdpObservation {
  return {
    clearSiteData: '"storage", "cache"',
    fromServiceWorker: false,
    method: "POST",
    requestId: "cdp-uninstall-1",
    status: 200,
    url: "http://127.0.0.1:1234/uninstall",
  };
}

function authorityFixture() {
  return {
    artifactDigest: "a".repeat(64),
    browser: { executableSha256: "b".repeat(64), product: "Chrome/151", revision: "r" },
    environment: { gateState: "measured" as const, machineId: "dev-01", tier: "showcase" as const },
    origin: "http://127.0.0.1:1234",
    releaseDigest: "c".repeat(64),
    source: { commit: "d".repeat(40), dirtyTreeDigest: "e".repeat(64) },
    target: { origin: "http://127.0.0.1:1234" },
  };
}
