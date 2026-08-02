import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { requireAssetUpdateDiagnosticLaunch } from "./asset-update-v8-diagnostic-launch.js";
import { assetUpdateResourceContentType } from "./asset-update-v8-target-representation.js";

describe("asset-update target representations", () => {
  it("uses the exact KTX2 serving MIME for a KTX2 asset pack", () => {
    expect(
      assetUpdateResourceContentType(
        "asset-pack",
        "immutable/streaming-texture-0123456789abcdef.ktx2",
      ),
    ).toBe("image/ktx2");
  });

  it.each([
    "immutable/streaming-texture-0123456789abcdef.ktx2x",
    "immutable/streaming-texture-0123456789abcdef.KTX2",
    "immutable/streaming-texture-0123456789abcdef.basis",
    "immutable/streaming-geometry-0123456789abcdef.meshopt",
  ])("does not assign the KTX2 MIME to nearby or unknown asset-pack extension %s", (source) => {
    expect(assetUpdateResourceContentType("asset-pack", source)).toBe("application/octet-stream");
  });

  it("does not assign the KTX2 MIME based on extension without the asset-pack kind", () => {
    expect(assetUpdateResourceContentType("module", "immutable/app.ktx2")).toBe(
      "application/javascript",
    );
  });
});

describe("asset-update V8 runner isolation audit", () => {
  it("projects the raw CDP primary GPU before constructing machine evidence", async () => {
    const source = await readFile(new URL("./asset-update-v8-run.ts", import.meta.url), "utf8");
    const start = source.indexOf("async function inspectMachineEnvironment");
    const end = source.indexOf("function requireMeasuredMachineGate", start);
    if (start < 0 || end <= start) {
      throw new Error("Runner source does not contain the machine-environment projection boundary");
    }
    const inspect = source.slice(start, end);

    expect(inspect).toContain("projectCdpGpuDevice(rawPrimaryGpu)");
    expect(inspect).not.toContain('GateEnvironmentObservation["primaryGpu"][]');
    expect(inspect).not.toContain("primaryGpu: rawPrimaryGpu");
  });

  it("projects the exact realistic Browser.getVersion identity including CDP protocol", async () => {
    const source = await readFile(new URL("./asset-update-v8-run.ts", import.meta.url), "utf8");
    const inspect = functionSource(source, "inspectBrowser", "inspectMachineEnvironment");
    const realisticCdpResponse = {
      jsVersion: "15.1.206.8",
      product: "Chrome/151.0.7922.34",
      protocolVersion: "1.3",
      revision: "@782af9cb30a53f54487e5d2e44738645a8ec457c",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36",
    };

    expect(Object.keys(realisticCdpResponse).sort()).toEqual([
      "jsVersion",
      "product",
      "protocolVersion",
      "revision",
      "userAgent",
    ]);
    for (const key of Object.keys(realisticCdpResponse)) {
      expect(inspect).toContain(`${key}: version.${key}`);
    }
    expect(inspect).toContain('version.protocolVersion !== "1.3"');
    expect(inspect).not.toContain("...version");
  });

  it("projects only evidence fields from a realistic detailed update-server entry", async () => {
    const source = await readFile(new URL("./asset-update-v8-run.ts", import.meta.url), "utf8");
    const start = source.indexOf("updateReady: async () =>");
    const end = source.indexOf("const { fresh, initial", start);
    if (start < 0 || end <= start) throw new Error("Runner source does not contain updateReady");
    const updateReady = source.slice(start, end);
    const realisticServerEntry = {
      bodyBytes: 11,
      cacheControl: "no-cache",
      clearSiteData: null,
      coep: "require-corp",
      completion: "completed",
      contentRange: "bytes 0-10/11",
      contentType: "application/json; charset=utf-8",
      coop: "same-origin",
      etag: '"sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
      headersSent: true,
      ifNoneMatch: null,
      ifRange: null,
      intendedStatus: 206,
      method: "GET",
      nosniff: "nosniff",
      path: "/immutable/cell.json",
      range: "bytes=0-",
      status: 206,
    };
    const evidenceFields = [
      "bodyBytes",
      "cacheControl",
      "coep",
      "contentType",
      "coop",
      "etag",
      "ifNoneMatch",
      "ifRange",
      "method",
      "nosniff",
      "path",
      "range",
      "status",
    ];
    const transportOnlyFields = [
      "clearSiteData",
      "completion",
      "contentRange",
      "headersSent",
      "intendedStatus",
    ];

    expect(Object.keys(realisticServerEntry).sort()).toEqual(
      [...evidenceFields, ...transportOnlyFields].sort(),
    );
    for (const key of evidenceFields) expect(updateReady).toContain(`${key}: entry.${key}`);
    expect(updateReady).toContain("sequence: index + 1");
    for (const key of transportOnlyFields) {
      expect(updateReady).not.toContain(`${key}: entry.${key}`);
    }
    expect(updateReady).not.toContain("...entry");
  });

  it("keeps mandatory Launch-to-interactive captures free of tracing and telemetry reads", async () => {
    const source = await readFile(new URL("./asset-update-v8-run.ts", import.meta.url), "utf8");
    const measured = functionSource(source, "captureMeasuredLaunch", "captureFreshLaunch");

    expect(measured).toContain("const lifecycle = await clickLaunchAndWait(page)");
    expect(measured).toContain("lifecycle.durationMs > WARM_LAUNCH_BUDGET_MS");
    expect(measured).not.toContain("beginV8TraceCapture");
    expect(measured).not.toContain("tryBeginTrace");
    expect(measured).not.toContain("readTelemetry");
    expect(measured).not.toContain("waitForWasmStreamingDiagnostic");
  });

  it("traces the first runtime launch but rejects uniform attribution for preloaded scripts", async () => {
    const source = await readFile(new URL("./asset-update-v8-run.ts", import.meta.url), "utf8");
    const initial = source.slice(
      source.indexOf("initialInstall: () =>"),
      source.indexOf("freshLaunch: async () =>"),
    );
    const fresh = functionSource(source, "captureFreshLaunch", "captureDiagnosticLaunch");

    expect(initial).not.toContain("tryBeginTrace");
    expect(initial).not.toContain("diagnostics(");
    expect(fresh).toContain("const trace = await tryBeginTrace(context)");
    expect(fresh).toContain("const lifecycle = await clickLaunchAndWait(page)");
    expect(fresh).toContain('"fresh"');
    expect(fresh).toContain("await finishTrace(trace)");

    const diagnosticProjection = source.slice(
      source.indexOf("function diagnostics("),
      source.indexOf("function invalidDiagnostics("),
    );
    expect(diagnosticProjection).toContain("mixed per-artifact cache lineages");
    expect(diagnosticProjection).toContain("no uniform D-040");
  });

  it("keeps telemetry anomalies diagnostic but makes launch-lineage failures terminal", async () => {
    const source = await readFile(new URL("./asset-update-v8-run.ts", import.meta.url), "utf8");
    const diagnostic = functionSource(source, "captureDiagnosticLaunch", "capturePostUpdateReady");

    expect(diagnostic).toContain("telemetryFailure = boundedMessage(error)");
    expect(diagnostic).toContain("requireAssetUpdateDiagnosticLaunch(input.phase");
    expect(diagnostic).toContain("Diagnostic navigation failed");
    expect(diagnostic).not.toContain("invalidDiagnostics(");
  });

  it("fails the produce phase when its required browser launch never occurs", async () => {
    await expect(
      requireAssetUpdateDiagnosticLaunch("produce", async () => {
        throw new Error("forced launch failure");
      }),
    ).rejects.toThrow(/Required produce diagnostic launch failed: forced launch failure/);
  });

  it("separates durable reload Ready authority from operation-scoped transfer telemetry", async () => {
    const source = await readFile(new URL("./asset-update-v8-run.ts", import.meta.url), "utf8");
    const collector = functionSource(source, "collectReadyAuthority", "waitForCheckingToSettle");

    expect(collector).toContain("parseInstallerTransferTelemetry(transfer)");
    expect(collector).toContain("installerTransfer: parsedTransfer");
    expect(collector).not.toContain('parsedTransfer.state !== "ready"');
    expect(collector).not.toContain("parsedTransfer.activeReleaseDigest !== release.releaseDigest");
  });

  it("does not settle the installer UI wait when the shell element is absent", async () => {
    const source = await readFile(new URL("./asset-update-v8-run.ts", import.meta.url), "utf8");
    const wait = functionSource(source, "waitForCheckingToSettle", "waitForReady");

    expect(wait).toContain("state !== undefined && state !== null");
    expect(wait).not.toContain('return state !== null && state !== "checking"');
  });

  it("observes final verification in-page and protects every CDP attachment boundary", async () => {
    const source = await readFile(new URL("./asset-update-v8-run.ts", import.meta.url), "utf8");
    const start = source.indexOf("async function captureInitialInstallExit(");
    const end = source.indexOf("interface FinalVerificationObservation", start);
    const capture = source.slice(start, end);
    const observerStart = source.indexOf("async function beginFinalVerificationObservation(");
    const observerEnd = source.indexOf("interface InstallerWorkerNetworkAttachment", observerStart);
    const observer = source.slice(observerStart, observerEnd);

    expect(capture).toContain("verification = await beginFinalVerificationObservation(page)");
    expect(capture).not.toContain("while (observing)");
    expect(capture).not.toContain("await page.evaluate(() =>");
    expect(observer).toContain("const pageResult = page.evaluate(");
    expect(observer).toContain("while (performance.now() < deadline)");
    expect(observer).toContain("FINAL_VERIFICATION_POLL_INTERVAL_MS");
    expect(capture.indexOf("try {")).toBeLessThan(capture.indexOf("context.newCDPSession(page)"));
    expect(capture.indexOf("try {")).toBeLessThan(capture.indexOf("attachInstallerWorkerNetwork("));
    expect(capture).toContain("worker === null ? [] : [worker.close()]");
    expect(capture).toContain("session === null ? [] : [session.detach()]");
  });

  it("uses a bounded one-byte model probe supported by the exact-Range server", async () => {
    const source = await readFile(new URL("./asset-update-v8-run.ts", import.meta.url), "utf8");
    const target = source.slice(
      source.indexOf("async function observeTarget("),
      source.indexOf("async function releaseAuthority("),
    );

    expect(target).toContain('Range: "bytes=0-0"');
    expect(target).toContain("const expectedStatus = boundedRange ? 206 : 200");
    expect(target).toContain("const expectedBodyBytes = boundedRange ? 1 : resource.bytes");
    expect(target).toContain("bytes 0-0/");
  });

  it("cannot exit successfully from a substituted or non-passed retained pair", async () => {
    const source = await readFile(new URL("./asset-update-v8-run.ts", import.meta.url), "utf8");

    expect(source).toContain("reservation.retainedIdentity");
    expect(source).toContain('retained.state !== "passed"');
    expect(source).toContain('terminal.state !== "passed"');
    expect(source).toContain("!sameJson(retained, terminal)");
    expect(source).toContain("!sameJson(retained.authority, capture.expected.authority)");
    expect(source.indexOf("terminalPublished = true")).toBeGreaterThan(
      source.indexOf("!sameJson(retained, terminal)"),
    );
  });

  it("binds install, target transport, command timeout, and close failure to exact lifecycle state", async () => {
    const source = await readFile(new URL("./asset-update-v8-run.ts", import.meta.url), "utf8");
    const initialInstall = source.slice(
      source.indexOf("initialInstall: () =>"),
      source.indexOf("freshLaunch: async () =>"),
    );
    expect(initialInstall).toContain('input.onPhase("initial-install")');
    expect(initialInstall).not.toContain('input.onPhase("pre-install")');

    const postTarget = source.indexOf(
      "const targetPost = await observeTarget(origin, postRelease, fixture.post, servingRoot)",
    );
    const targetPhase = source.lastIndexOf('input.onPhase("target")', postTarget);
    const postDiagnosticPhase = source.lastIndexOf('input.onPhase("post-diagnostic")', postTarget);
    expect(postDiagnosticPhase).toBeLessThan(targetPhase);
    expect(targetPhase).toBeLessThan(postTarget);

    const commands = functionSource(source, "attachInstallerWorkerNetwork", "withBoundedCdpWait");
    expect(commands).toContain("await waitForAssetUpdateV8WorkerCommand({");
    expect(commands).toContain("commandResults.delete(id)");
    expect(commands).toContain("fail(error)");

    const main = source.slice(
      source.indexOf("async function main()"),
      source.indexOf("async function runLifecycle"),
    );
    expect(main).toContain("await closeAssetUpdateV8ResultAfterFailure(");
    expect(main).not.toContain("} finally {");
  });
});

function functionSource(source: string, startName: string, endName: string): string {
  const start = source.indexOf(`async function ${startName}`);
  const end = source.indexOf(`async function ${endName}`, start + 1);
  if (start < 0 || end <= start) {
    throw new Error(`Runner source does not contain ${startName} before ${endName}`);
  }
  return source.slice(start, end);
}
