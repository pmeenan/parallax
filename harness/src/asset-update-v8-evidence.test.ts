import { createHash } from "node:crypto";
import {
  idleInstallerTransferTelemetrySnapshot,
  STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
} from "@parallax/engine";
import { describe, expect, expectTypeOf, it } from "vitest";
import { analyzeAssetOnlyReleaseUpdate } from "./asset-only-release-update.js";
import {
  ASSET_UPDATE_V8_CONTRACT,
  ASSET_UPDATE_V8_SCHEMA_VERSION,
  type AssetUpdateExpectedAuthority,
  type AssetUpdateLifecycleResult,
  type AssetUpdateReleaseAuthority,
  type AssetUpdateRunAuthority,
  type AssetUpdateTargetObservation,
  type AssetUpdateV8Diagnostics,
  type AssetUpdateV8Evidence,
  type AssetUpdateV8LaunchEvidence,
  assetUpdateJsonEqual,
  formatAssetUpdateV8Markdown,
  type LaunchToInteractiveEvidence,
  type LegacyAssetUpdateV8Evidence,
  type LegacyV3AssetUpdateV8Evidence,
  validateAssetUpdateV8Evidence,
  WARM_LAUNCH_BUDGET_MS,
} from "./asset-update-v8-evidence.js";
import { createAssetUpdateV8FailedEvidence } from "./asset-update-v8-failure.js";
import {
  buildInitialInstallExitEvidence,
  installControlIdentities,
} from "./asset-update-v8-install-exit.js";
import type { BuildManifest } from "./build-manifest.js";
import type { GateEnvironmentObservation, MachineDescriptor } from "./environment.js";
import type { InstallManifest, InstallResource } from "./install-manifest.js";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_ORIGIN = "http://127.0.0.1:4173";
const STARTED_AT = "2026-07-30T12:00:00.000Z";
const COMPLETED_AT = "2026-07-30T12:05:00.000Z";
const MIB = 1024 * 1024;
const MACHINE_DESCRIPTOR: MachineDescriptor = {
  arch: "x64",
  cpu: { cores: 24, logicalProcessors: 32, name: "Reference CPU" },
  display: {
    dimensionTolerancePixels: 2,
    height: 2_160,
    refreshRateHz: 60,
    refreshRateToleranceHz: 1,
    width: 3_840,
  },
  gateTiers: ["showcase"],
  gpu: {
    architecture: "lovelace",
    backend: "D3D12",
    deviceId: 0x2702,
    driverVersion: "32.0.15.9649",
    name: "Reference GPU",
    subSysId: 0x41441458,
    vendor: "nvidia",
    vendorId: 0x10de,
  },
  id: "dev-01",
  minimumPhysicalMemoryBytes: 128_000_000_000,
  osBuild: "26200.8655",
  platform: "win32",
  powerSchemeGuid: "381b4222-f694-41f0-9685-ff5bb260df2e",
  schemaVersion: 1,
};
const MACHINE_OBSERVATION: GateEnvironmentObservation = {
  adapter: {
    architecture: "lovelace",
    backend: "D3D12",
    description: "Reference GPU",
    device: "0x2702",
    driver: "D3D12 driver version 32.0.15.9649",
    isFallbackAdapter: false,
    type: "discrete GPU",
    vendor: "nvidia",
  },
  arch: "x64",
  browserDisplay: {
    probeFailures: [],
    refreshRatesHz: [60],
    screen: {
      availHeight: 1_400,
      availWidth: 2_560,
      colorDepth: 24,
      devicePixelRatio: 1.5,
      height: 1_440,
      width: 2_560,
    },
  },
  host: {
    cpu: { cores: 24, logicalProcessors: 32, name: "Reference CPU" },
    os: { build: "26200.8655", caption: "Microsoft Windows 11 Pro" },
    physicalMemoryBytes: 137_277_173_760,
    power: { guid: "381b4222-f694-41f0-9685-ff5bb260df2e", name: "Balanced" },
    remoteSession: false,
    videoControllers: [
      {
        driverVersion: "32.0.15.9649",
        height: 2_160,
        name: "Reference GPU",
        pnpDeviceId: "PCI\\VEN_10DE&DEV_2702",
        refreshRateHz: 59,
        width: 3_840,
      },
    ],
  },
  platform: "win32",
  primaryGpu: {
    deviceId: 0x2702,
    deviceString: "Reference GPU",
    driverVendor: "NVIDIA",
    driverVersion: "32.0.15.9649",
    revision: 161,
    subSysId: 0x41441458,
    vendorId: 0x10de,
    vendorString: "",
  },
  requestedTier: "showcase",
};

type PassedEvidence = Extract<AssetUpdateV8Evidence, { readonly state: "passed" }>;
type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;
type MutablePassedEvidence = Mutable<PassedEvidence>;

describe("asset-only update V8 lifecycle evidence", () => {
  it("rejects an invalid timestamp with the evidence contract error", () => {
    const evidence = mutableClone(passedEvidence());
    evidence.startedAt = "not-a-date";

    expect(() => validateAssetUpdateV8Evidence(evidence)).toThrow(
      "Asset-update V8 evidence start time is invalid",
    );
  });

  it("keeps retained identities discriminated from current lifecycle-v4", () => {
    type LegacyPassedEvidence = Extract<LegacyAssetUpdateV8Evidence, { readonly state: "passed" }>;
    type LegacyV3PassedEvidence = Extract<
      LegacyV3AssetUpdateV8Evidence,
      { readonly state: "passed" }
    >;
    expectTypeOf<
      LegacyAssetUpdateV8Evidence["contract"]
    >().toEqualTypeOf<"asset-update-v8-lifecycle@2">();
    expectTypeOf<LegacyAssetUpdateV8Evidence["schemaVersion"]>().toEqualTypeOf<2>();
    expectTypeOf<
      LegacyPassedEvidence["result"]["publication"]["preTransfer"]["schemaVersion"]
    >().toEqualTypeOf<3>();
    expectTypeOf<
      "initialInstall" extends keyof LegacyPassedEvidence["result"] ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      AssetUpdateV8Evidence["contract"]
    >().toEqualTypeOf<"asset-update-v8-lifecycle@4">();
    expectTypeOf<AssetUpdateV8Evidence["schemaVersion"]>().toEqualTypeOf<4>();
    expectTypeOf<
      LegacyV3AssetUpdateV8Evidence["contract"]
    >().toEqualTypeOf<"asset-update-v8-lifecycle@3">();
    expectTypeOf<LegacyV3AssetUpdateV8Evidence["schemaVersion"]>().toEqualTypeOf<3>();
    expectTypeOf<
      LegacyV3PassedEvidence["result"]["launches"]["pre"]["lifecycle"]["contract"]
    >().toEqualTypeOf<"launch-to-interactive@2">();
    expectTypeOf<
      LegacyPassedEvidence["result"]["v8"]["pre"]["wasmStreaming"]["api"]
    >().toEqualTypeOf<"instantiateStreaming">();
    expectTypeOf<
      PassedEvidence["result"]["v8"]["pre"]["wasmStreaming"]["api"]
    >().toEqualTypeOf<"compileStreaming">();
  });

  it("accepts retained lifecycle-v3 evidence only with exact launch-v2 shape", () => {
    const evidence = retainedV3PassedEvidence();

    expect(validateAssetUpdateV8Evidence(evidence)).toEqual(evidence);

    const relabeledCurrent = mutableClone(evidence);
    Reflect.set(relabeledCurrent, "contract", ASSET_UPDATE_V8_CONTRACT);
    Reflect.set(relabeledCurrent, "schemaVersion", ASSET_UPDATE_V8_SCHEMA_VERSION);
    relabeledCurrent.companion.path = "asset-update-v8-v4-2026-07-30T12-00-00-000Z.md";
    expect(() => validateAssetUpdateV8Evidence(relabeledCurrent)).toThrow(
      "pre release embedded build manifest arrays are invalid",
    );

    const forged = mutableClone(evidence);
    Reflect.set(forged.result.launches.pre.lifecycle, "simulationReadyAtMs", 1_250);
    expect(() => validateAssetUpdateV8Evidence(forged)).toThrow(
      "launch lifecycle has unsupported or missing keys",
    );
  });

  it("rejects the retained instantiateStreaming API under the current lifecycle contract", () => {
    const evidence = mutableClone(passedEvidence());
    Reflect.set(evidence.result.v8.pre.wasmStreaming, "api", "instantiateStreaming");

    expect(() => validateAssetUpdateV8Evidence(evidence)).toThrow(
      "pre-warm threaded-Wasm streaming evidence is malformed",
    );
  });

  it("compares canonical semantic structures independent of property insertion order", () => {
    const evidence = passedEvidence();
    const canonical = canonicalRoundTrip(evidence);
    const expected = expectedAuthority(evidence);

    expect(JSON.stringify(canonical)).not.toBe(JSON.stringify(evidence));
    expect(assetUpdateJsonEqual(canonical, evidence)).toBe(true);
    expect(validateAssetUpdateV8Evidence(canonical, expected).state).toBe("passed");
  });

  it("accepts both warm Launch-to-interactive measurements at the exact 10 s boundary", () => {
    const evidence = passedEvidence({
      postDurationMs: WARM_LAUNCH_BUDGET_MS,
      preDurationMs: WARM_LAUNCH_BUDGET_MS,
    });

    const validated = validateAssetUpdateV8Evidence(evidence, expectedAuthority(evidence));

    expect(validated.state).toBe("passed");
    if (validated.state !== "passed") throw new Error("validated evidence lost passed state");
    expect(validated.result.launches.pre.lifecycle.durationMs).toBe(10_000);
    expect(validated.result.launches.post.lifecycle.durationMs).toBe(10_000);
    expect(validated.result.deltaMs).toBe(0);
    expect(validated.result.relativeRegressionThreshold).toBeNull();
  });

  it.each([
    ["pre-warm", { preDurationMs: WARM_LAUNCH_BUDGET_MS + 1 }],
    ["post-warm", { postDurationMs: WARM_LAUNCH_BUDGET_MS + 1 }],
  ] as const)("rejects a %s Launch-to-interactive result over 10 s", (_phase, options) => {
    const evidence = passedEvidence(options);

    expect(() => validateAssetUpdateV8Evidence(evidence, expectedAuthority(evidence))).toThrow(
      /exceeds 10000 ms/,
    );
  });

  it("accepts fresh installed Launch at 30 s and rejects an over-budget launch", () => {
    const boundary = mutableClone(passedEvidence());
    boundary.result.launches.fresh = mutableClone(
      launch("fresh", 1, boundary.result.preRelease.releaseDigest, 30_000),
    );
    expect(
      validateAssetUpdateV8Evidence(boundary, expectedAuthorityFromMutable(boundary)).state,
    ).toBe("passed");

    boundary.result.launches.fresh = mutableClone(
      launch("fresh", 1, boundary.result.preRelease.releaseDigest, 30_001),
    );
    expect(() =>
      validateAssetUpdateV8Evidence(boundary, expectedAuthorityFromMutable(boundary)),
    ).toThrow("exceeds 30000 ms");
  });

  it("rejects forged launch preflight, simulation, and streaming startup ordering", () => {
    const preflightDrift = mutableClone(passedEvidence());
    preflightDrift.result.launches.post.lifecycle.preflightTiming.modelSourceReadyAtMs =
      preflightDrift.result.launches.post.lifecycle.preflightTiming.initialReleaseAdmissionAtMs - 1;
    expect(() =>
      validateAssetUpdateV8Evidence(preflightDrift, expectedAuthorityFromMutable(preflightDrift)),
    ).toThrow("milestone ordering");

    const workerDrift = mutableClone(passedEvidence());
    workerDrift.result.launches.post.lifecycle.streamingStartupTiming.decodePoolCreatedAtMs =
      (workerDrift.result.launches.post.lifecycle.streamingStartupTiming
        .finalAdmissionCompletedAtMs as number) - 1;
    expect(() =>
      validateAssetUpdateV8Evidence(workerDrift, expectedAuthorityFromMutable(workerDrift)),
    ).toThrow("Streaming startup timing identity or ordering is invalid");

    const simulationDrift = mutableClone(passedEvidence());
    simulationDrift.result.launches.post.lifecycle.simulationReadyAtMs =
      simulationDrift.result.launches.post.lifecycle.simulationWorkerRequestedAtMs - 1;
    expect(() =>
      validateAssetUpdateV8Evidence(simulationDrift, expectedAuthorityFromMutable(simulationDrift)),
    ).toThrow("milestone ordering");

    const impossibleWorkerSpan = mutableClone(passedEvidence());
    impossibleWorkerSpan.result.launches.post.lifecycle.streamingStartupTiming.initialResidencyReadyAtMs = 500;
    expect(() =>
      validateAssetUpdateV8Evidence(
        impossibleWorkerSpan,
        expectedAuthorityFromMutable(impossibleWorkerSpan),
      ),
    ).toThrow("milestone ordering");
  });

  it("requires the exact signed post-minus-pre delta and forbids a relative threshold", () => {
    const wrongDelta = mutableClone(
      passedEvidence({ postDurationMs: 8_750, preDurationMs: 9_000 }),
    );
    wrongDelta.result.deltaMs = 251;
    expect(() =>
      validateAssetUpdateV8Evidence(wrongDelta, expectedAuthorityFromMutable(wrongDelta)),
    ).toThrow("signed launch delta is inconsistent");

    const inventedThreshold = mutableClone(passedEvidence());
    record(inventedThreshold.result).relativeRegressionThreshold = 0.05;
    expect(() =>
      validateAssetUpdateV8Evidence(
        inventedThreshold,
        expectedAuthorityFromMutable(inventedThreshold),
      ),
    ).toThrow("invented a relative threshold");
  });

  it("requires one persistent profile across the exact ordered nine-boundary lifecycle", () => {
    const lifecycleProfileDrift = mutableClone(passedEvidence());
    requireItem(lifecycleProfileDrift.result.lifecycle, 4).persistentProfileId = OTHER_PROFILE_ID;
    expect(() =>
      validateAssetUpdateV8Evidence(
        lifecycleProfileDrift,
        expectedAuthorityFromMutable(lifecycleProfileDrift),
      ),
    ).toThrow("lifecycle ordering or persistent-profile identity drifted");

    const outOfOrder = mutableClone(passedEvidence());
    const fourth = requireItem(outOfOrder.result.lifecycle, 3);
    const fifth = requireItem(outOfOrder.result.lifecycle, 4);
    const fourthName = fourth.name;
    fourth.name = fifth.name;
    fifth.name = fourthName;
    expect(() =>
      validateAssetUpdateV8Evidence(outOfOrder, expectedAuthorityFromMutable(outOfOrder)),
    ).toThrow("lifecycle ordering or persistent-profile identity drifted");

    const missingBoundary = mutableClone(passedEvidence());
    missingBoundary.result.lifecycle.pop();
    expect(() =>
      validateAssetUpdateV8Evidence(missingBoundary, expectedAuthorityFromMutable(missingBoundary)),
    ).toThrow("exact nine ordered boundaries");

    const launchProfileDrift = mutableClone(passedEvidence());
    launchProfileDrift.result.launches.post.persistentProfileId = OTHER_PROFILE_ID;
    expect(() =>
      validateAssetUpdateV8Evidence(
        launchProfileDrift,
        expectedAuthorityFromMutable(launchProfileDrift),
      ),
    ).toThrow("persistent-profile lineage is invalid");
  });

  it("binds Ready to exact active/previous publication and offline-shell authority", () => {
    const wrongPrevious = mutableClone(passedEvidence());
    wrongPrevious.result.publication.postReady.installStore.previousReleaseDigest = null;
    expect(() =>
      validateAssetUpdateV8Evidence(wrongPrevious, expectedAuthorityFromMutable(wrongPrevious)),
    ).toThrow("exact publication/offline-shell selection");

    const wrongShell = mutableClone(passedEvidence());
    wrongShell.result.publication.postReady.offlineShell.activeArtifactDigest = digest("f");
    expect(() =>
      validateAssetUpdateV8Evidence(wrongShell, expectedAuthorityFromMutable(wrongShell)),
    ).toThrow("exact publication/offline-shell selection");

    const wrongDiscovery = mutableClone(passedEvidence());
    record(wrongDiscovery.result.publication.updateDiscovery).recovery = "reload";
    expect(() =>
      validateAssetUpdateV8Evidence(wrongDiscovery, expectedAuthorityFromMutable(wrongDiscovery)),
    ).toThrow("ordinary mismatch-to-retry discovery");
  });

  it("binds operation transfer totals to the OPFS population, excluding shell resources", () => {
    const valid = passedEvidence();
    expect(validateAssetUpdateV8Evidence(valid, expectedAuthority(valid)).state).toBe("passed");

    const allResources = mutableClone(valid);
    const resources = changedResources();
    allResources.result.publication.postTransfer.totalBytes = resources.reduce(
      (total, resource) => total + resource.bytes,
      0,
    );
    allResources.result.publication.postTransfer.reusedBytes =
      allResources.result.publication.postTransfer.totalBytes -
      allResources.result.publication.postTransfer.plannedDownloadBytes;
    allResources.result.publication.postTransfer.resourceCount = resources.length;
    expect(() =>
      validateAssetUpdateV8Evidence(allResources, expectedAuthorityFromMutable(allResources)),
    ).toThrow("exact completed publication");
  });

  it("requires the exact current atomic quota schema and rejects prior runtime schemas", () => {
    const current = passedEvidence();
    expect(validateAssetUpdateV8Evidence(current, expectedAuthority(current)).state).toBe("passed");

    for (const phase of ["preTransfer", "postTransfer"] as const) {
      const forged = mutableClone(current);
      forged.result.publication[phase].quotaRequiredPeakBytes += 1;
      expect(() =>
        validateAssetUpdateV8Evidence(forged, expectedAuthorityFromMutable(forged)),
      ).toThrow("transfer quota evidence is inconsistent");
    }

    for (const schemaVersion of [6, 7] as const) {
      const stale = mutableClone(current);
      stale.result.publication.preTransfer.schemaVersion = schemaVersion as 9;
      expect(() =>
        validateAssetUpdateV8Evidence(stale, expectedAuthorityFromMutable(stale)),
      ).toThrow("installerTransfer schema is unsupported");
    }

    const currentSchema3 = mutableClone(current);
    currentSchema3.result.publication.preTransfer.schemaVersion = 3 as 9;
    expect(() =>
      validateAssetUpdateV8Evidence(currentSchema3, expectedAuthorityFromMutable(currentSchema3)),
    ).toThrow("installerTransfer schema is unsupported");
  });

  it("requires exact changed-only transfer counters and a complete bounded response journal", () => {
    const realShape = passedEvidence();
    expect(realShape.result.analysis.changedResources).toHaveLength(2);
    expect(realShape.result.publication.updateServerJournal.entries).toHaveLength(2);
    expect(realShape.result.publication.postTransfer).toMatchObject({
      checkpointedBytes: 72,
      completedResourceCount: 3,
      downloadedBytes: 72,
      hashedBytes: 92,
      httpRequestCount: 2,
      plannedDownloadBytes: 72,
      rangeRequestCount: 2,
      resourceCount: 3,
      reusedBytes: 20,
      totalBytes: 92,
      verifiedBytes: 92,
    });

    const transportLeak = mutableClone(passedEvidence());
    const leakedEntry = record(
      requireItem(transportLeak.result.publication.updateServerJournal.entries, 0),
    );
    Object.assign(leakedEntry, {
      clearSiteData: null,
      completion: "completed",
      contentRange: "bytes 0-10/11",
      headersSent: true,
      intendedStatus: 206,
    });
    expect(() =>
      validateAssetUpdateV8Evidence(transportLeak, expectedAuthorityFromMutable(transportLeak)),
    ).toThrow("update server journal entry 1 has unsupported or missing keys");

    const unchangedTransfer = mutableClone(passedEvidence());
    const entry = requireItem(unchangedTransfer.result.publication.updateServerJournal.entries, 0);
    entry.path = `/immutable/app-${digest("2")}.js`;
    entry.etag = `"sha256-${digest("2")}"`;
    expect(() =>
      validateAssetUpdateV8Evidence(
        unchangedTransfer,
        expectedAuthorityFromMutable(unchangedTransfer),
      ),
    ).toThrow("non-changed or invalid transfer response");

    const missingJournal = mutableClone(passedEvidence());
    missingJournal.result.publication.updateServerJournal.entries = [];
    expect(() =>
      validateAssetUpdateV8Evidence(missingJournal, expectedAuthorityFromMutable(missingJournal)),
    ).toThrow("absent, truncated, or unbounded");

    const counterDrift = mutableClone(passedEvidence());
    counterDrift.result.publication.postTransfer.downloadedBytes += 1;
    counterDrift.result.publication.postTransfer.checkpointedBytes += 1;
    expect(() =>
      validateAssetUpdateV8Evidence(counterDrift, expectedAuthorityFromMutable(counterDrift)),
    ).toThrow("changed-only transfer");

    const changedOnlyVerification = mutableClone(passedEvidence());
    changedOnlyVerification.result.publication.postTransfer.verifiedBytes =
      changedOnlyVerification.result.publication.postTransfer.downloadedBytes;
    changedOnlyVerification.result.publication.postTransfer.hashedBytes =
      changedOnlyVerification.result.publication.postTransfer.downloadedBytes;
    changedOnlyVerification.result.publication.postTransfer.completedResourceCount =
      changedOnlyVerification.result.analysis.changedResources.length;
    expect(() =>
      validateAssetUpdateV8Evidence(
        changedOnlyVerification,
        expectedAuthorityFromMutable(changedOnlyVerification),
      ),
    ).toThrow(/changed-only transfer|state\/progress/);

    const duplicateTransfer = mutableClone(passedEvidence());
    const duplicateEntry = mutableClone(
      requireItem(duplicateTransfer.result.publication.updateServerJournal.entries, 0),
    );
    duplicateEntry.sequence = 3;
    duplicateTransfer.result.publication.updateServerJournal.entries.push(duplicateEntry);
    duplicateTransfer.result.publication.postTransfer.httpRequestCount = 3;
    duplicateTransfer.result.publication.postTransfer.rangeRequestCount = 3;
    expect(() =>
      validateAssetUpdateV8Evidence(
        duplicateTransfer,
        expectedAuthorityFromMutable(duplicateTransfer),
      ),
    ).toThrow("changed-only transfer");
  });

  it("requires complete document, stable worker, asset, module, worker, and Wasm transport", () => {
    const missingStableWorker = mutableClone(passedEvidence());
    missingStableWorker.result.target.post.resourceRepresentations =
      missingStableWorker.result.target.post.resourceRepresentations.filter(
        ({ source }) => source !== "service-worker.js",
      );
    expect(() =>
      validateAssetUpdateV8Evidence(
        missingStableWorker,
        expectedAuthorityFromMutable(missingStableWorker),
      ),
    ).toThrow("incomplete resource representation inventory");

    const documentDrift = mutableClone(passedEvidence());
    const document = documentDrift.result.target.post.resourceRepresentations.find(
      ({ source }) => source === "index.html",
    );
    if (document === undefined) throw new Error("synthetic document representation is absent");
    document.cacheControl = "public, max-age=31536000, immutable";
    expect(() =>
      validateAssetUpdateV8Evidence(documentDrift, expectedAuthorityFromMutable(documentDrift)),
    ).toThrow("exact bytes/transport authority");
  });

  it("requires exact immutable executable transport and conditional 304 evidence", () => {
    const evidence = mutableClone(passedEvidence());
    requireItem(evidence.result.target.post.resourceRepresentations, 0).conditionalStatus =
      200 as 304;

    expect(() =>
      validateAssetUpdateV8Evidence(evidence, expectedAuthorityFromMutable(evidence)),
    ).toThrow("exact bytes/transport authority");
  });

  it("rejects executable and non-asset classification drift despite self-consistent manifests", () => {
    const executableDrift = changedResources().map((resource) =>
      resource.id === "app-shell-module-app"
        ? {
            ...resource,
            bytes: resource.bytes + 1,
            sha256: "01".repeat(32),
            source: `immutable/app-${"01".repeat(32)}.js`,
          }
        : resource,
    );
    const executableEvidence = passedEvidence({ postResources: executableDrift });
    expect(() =>
      validateAssetUpdateV8Evidence(executableEvidence, expectedAuthority(executableEvidence)),
    ).toThrow("Executable install resource drifted");

    const classificationDrift = changedResources().map((resource) =>
      resource.kind === "world-cell" ? { ...resource, target: "shell" as const } : resource,
    );
    const classificationEvidence = passedEvidence({ postResources: classificationDrift });
    expect(() =>
      validateAssetUpdateV8Evidence(
        classificationEvidence,
        expectedAuthority(classificationEvidence),
      ),
    ).toThrow("classification drifted");
  });

  it("rejects arbitrary embedded, target, and machine identity/hash forgery", () => {
    const embeddedForgery = mutableClone(passedEvidence());
    embeddedForgery.result.preRelease.artifactDigest = digest("f");
    expect(() =>
      validateAssetUpdateV8Evidence(embeddedForgery, expectedAuthorityFromMutable(embeddedForgery)),
    ).toThrow("manifest bytes do not match their exact digests");

    const targetForgery = mutableClone(passedEvidence());
    targetForgery.result.target.post.buildManifestSha256 = digest("f");
    expect(() =>
      validateAssetUpdateV8Evidence(targetForgery, expectedAuthorityFromMutable(targetForgery)),
    ).toThrow("exact same-origin release identity");

    const machineForgery = mutableClone(passedEvidence());
    machineForgery.authority.machine.descriptorSha256 = digest("f");
    expect(() =>
      validateAssetUpdateV8Evidence(machineForgery, expectedAuthorityFromMutable(machineForgery)),
    ).toThrow("Machine authority descriptor identity is inconsistent");

    const nestedMachineForgery = mutableClone(passedEvidence());
    record(nestedMachineForgery.authority.machine.preObservation.adapter).unexpected = true;
    expect(() =>
      validateAssetUpdateV8Evidence(
        nestedMachineForgery,
        expectedAuthorityFromMutable(nestedMachineForgery),
      ),
    ).toThrow("unsupported or missing keys");
  });

  it.each([
    "preRelease",
    "postRelease",
  ] as const)("rejects an internally rebound content-addressed path in current %s evidence", (boundary) => {
    const evidence = mutableClone(passedEvidence());
    forgeEmbeddedContentAddressedPath(evidence.result[boundary]);
    expect(() =>
      validateAssetUpdateV8Evidence(evidence, expectedAuthorityFromMutable(evidence)),
    ).toThrow("Content-addressed JavaScript path does not bind its artifact SHA-256");
  });

  it("requires exact current authority records and omits hostile authority from fallback", () => {
    for (const section of ["baseBuild", "browser", "source"] as const) {
      const evidence = mutableClone(passedEvidence());
      record(evidence.authority[section]).unknown = "private-value";
      expect(() =>
        validateAssetUpdateV8Evidence(evidence, expectedAuthorityFromMutable(evidence)),
      ).toThrow("unsupported or missing keys");
    }

    const currentProtocol = mutableClone(passedEvidence());
    record(currentProtocol.authority.browser).protocolVersion = "1.4";
    expect(() =>
      validateAssetUpdateV8Evidence(currentProtocol, expectedAuthorityFromMutable(currentProtocol)),
    ).toThrow("Browser authority protocolVersion is invalid");

    for (const section of ["baseBuild", "browser", "source"] as const) {
      const hostile = mutableClone(passedEvidence());
      record(hostile.authority[section]).authorization = "private-value";
      hostile.result.initialInstall.networkIdleLocalCriticalPathMs += 1;
      const failed = createAssetUpdateV8FailedEvidence({
        authority: hostile.authority,
        companionPath: "asset-update-v8-v4-2026-07-30T12-00-00-000Z.md",
        completedAt: COMPLETED_AT,
        error: new Error("synthetic lifecycle failure"),
        partialResult: hostile.result,
        phase: "initial-install",
        postValidationPerformed: false,
        reservationId: "33333333-3333-4333-8333-333333333333",
        startedAt: STARTED_AT,
      });
      expect(validateAssetUpdateV8Evidence(failed).state).toBe("failed");
      if (failed.state !== "failed") throw new Error("fallback lost failed state");
      expect(failed.authority).toBeNull();
      expect(JSON.stringify(failed)).not.toContain("private-value");
      expect(JSON.stringify(failed)).not.toContain("authorization");
    }
  });

  it("retains typed failure evidence but rejects malformed or unsanitized failures", () => {
    const valid = failedEvidence();
    expect(validateAssetUpdateV8Evidence(valid).state).toBe("failed");

    const overBudget = passedEvidence({ postDurationMs: WARM_LAUNCH_BUDGET_MS + 1 });
    const retainedBudgetFailure: AssetUpdateV8Evidence = {
      ...failedEvidence(),
      authority: overBudget.authority,
      failure: {
        message: "post-warm Launch-to-interactive duration 10001 exceeds 10000 ms",
        name: "LifecycleMeasurementError",
        phase: "post-warm",
      },
      partialResult: overBudget.result,
    };
    const retained = validateAssetUpdateV8Evidence(retainedBudgetFailure);
    expect(retained.state).toBe("failed");
    if (retained.state !== "failed") throw new Error("budget failure lost failed state");
    expect(retained.failure.phase).toBe("post-warm");
    expect(retained.partialResult?.deltaMs).toBe(1_001);

    const installOverBudget = mutableClone(passedEvidence());
    installOverBudget.result.initialInstall.installWall.durationMs = 100_000;
    installOverBudget.result.initialInstall.installWall.readyAtMs = 100_000;
    installOverBudget.result.initialInstall.networkIdleLocalCriticalPathMs =
      100_000 - installOverBudget.result.initialInstall.network.activeIntervalUnionMs;
    expect(() =>
      validateAssetUpdateV8Evidence(
        installOverBudget,
        expectedAuthorityFromMutable(installOverBudget),
      ),
    ).toThrow("exceeds 90000 ms");
    const retainedInstallFailure = {
      ...failedEvidence(),
      authority: installOverBudget.authority,
      failure: {
        message: "initial-install residual exceeds 90000 ms",
        name: "LifecycleMeasurementError",
        phase: "initial-install",
      },
      partialResult: installOverBudget.result,
    } as const;
    expect(validateAssetUpdateV8Evidence(retainedInstallFailure).state).toBe("failed");

    const freshOverBudget = mutableClone(passedEvidence());
    freshOverBudget.result.launches.fresh = mutableClone(
      launch("fresh", 1, freshOverBudget.result.preRelease.releaseDigest, 30_001),
    );
    const retainedFreshFailure = {
      ...failedEvidence(),
      authority: freshOverBudget.authority,
      failure: {
        message: "fresh Launch-to-interactive duration exceeds 30000 ms",
        name: "LifecycleMeasurementError",
        phase: "fresh",
      },
      partialResult: freshOverBudget.result,
    } as const;
    expect(validateAssetUpdateV8Evidence(retainedFreshFailure).state).toBe("failed");

    const malformed = mutableClone(valid);
    malformed.failure.phase = "unknown-phase";
    expect(() => validateAssetUpdateV8Evidence(malformed)).toThrow(
      "failure evidence is malformed or unsanitized",
    );

    const unsanitized = mutableClone(valid);
    unsanitized.failure.message = "C:\\Users\\operator\\secret.txt password=hunter2";
    expect(() => validateAssetUpdateV8Evidence(unsanitized)).toThrow(
      "failure evidence is malformed or unsanitized",
    );

    const forwardSlashPath = mutableClone(valid);
    forwardSlashPath.failure.message =
      "failed at C:/Users/operator/private.txt path=/home/operator/private.txt authorization = credential";
    expect(() => validateAssetUpdateV8Evidence(forwardSlashPath)).toThrow(
      "failure evidence is malformed or unsanitized",
    );

    const secretName = mutableClone(valid);
    secretName.failure.name = "secret=credential-in-name";
    expect(() => validateAssetUpdateV8Evidence(secretName)).toThrow(
      "failure evidence is malformed or unsanitized",
    );
  });

  it("keeps a complete valid lifecycle on a budget failure", () => {
    const overBudget = mutableClone(passedEvidence());
    overBudget.result.initialInstall.installWall.durationMs = 100_000;
    overBudget.result.initialInstall.installWall.readyAtMs = 100_000;
    overBudget.result.initialInstall.networkIdleLocalCriticalPathMs =
      100_000 - overBudget.result.initialInstall.network.activeIntervalUnionMs;

    const failed = createAssetUpdateV8FailedEvidence({
      authority: overBudget.authority,
      companionPath: "asset-update-v8-v4-2026-07-30T12-00-00-000Z.md",
      completedAt: COMPLETED_AT,
      error: new Error("initial-install residual exceeds 90000 ms"),
      partialResult: overBudget.result,
      phase: "initial-install",
      postValidationPerformed: false,
      reservationId: "33333333-3333-4333-8333-333333333333",
      startedAt: STARTED_AT,
    });

    expect(validateAssetUpdateV8Evidence(failed).state).toBe("failed");
    if (failed.state !== "failed") throw new Error("budget failure lost failed state");
    expect(failed.authority).toEqual(overBudget.authority);
    expect(failed.partialResult).toEqual(overBudget.result);
    expect(failed.failureContext?.state).toBe("unvalidated-lifecycle-snapshot");
  });

  it("retains rejected-partial cause, valid authority, and an independent install breakdown", () => {
    const malformed = mutableClone(passedEvidence());
    const expectedResidual = 110_194.908_800_045_76;
    malformed.result.initialInstall.installWall.durationMs =
      malformed.result.initialInstall.network.activeIntervalUnionMs + expectedResidual;
    malformed.result.initialInstall.installWall.readyAtMs =
      malformed.result.initialInstall.installWall.durationMs;
    malformed.result.initialInstall.networkIdleLocalCriticalPathMs = expectedResidual;
    Object.defineProperty(malformed.result, "analysis", {
      configurable: true,
      enumerable: true,
      get() {
        throw new Error(
          "validator rejected C:/Users/operator/private.json authorization = private-value",
        );
      },
    });

    const failed = createAssetUpdateV8FailedEvidence({
      authority: malformed.authority,
      companionPath: "asset-update-v8-v4-2026-07-30T12-00-00-000Z.md",
      completedAt: COMPLETED_AT,
      error: new Error(
        "initial-install network-idle/local-critical-path residual 110194.90880004576 exceeds 90000 ms",
      ),
      partialResult: malformed.result,
      phase: "initial-install",
      postValidationPerformed: false,
      reservationId: "33333333-3333-4333-8333-333333333333",
      startedAt: STARTED_AT,
    });

    expect(validateAssetUpdateV8Evidence(failed).state).toBe("failed");
    if (failed.state !== "failed") throw new Error("fallback lost failed state");
    expect(failed.authority).toEqual(malformed.authority);
    expect(failed.partialResult).toBeNull();
    expect(failed.failureContext?.state).toBe("rejected-lifecycle-snapshot");
    if (failed.failureContext?.state !== "rejected-lifecycle-snapshot") {
      throw new Error("fallback lost rejected-partial context");
    }
    expect(failed.failureContext.partialValidation).toEqual({
      message: "validator rejected <local-path> authorization=<redacted>",
      name: "Error",
      state: "rejected",
    });
    expect(failed.failureContext.initialInstall).toMatchObject({
      finalVerificationObservation: {
        observedSpanMs: 50,
        pollIntervalMs: 20,
      },
      installWall: { durationMs: expect.any(Number) },
      network: {
        activeIntervalUnionMs: malformed.result.initialInstall.network.activeIntervalUnionMs,
        resourceBodyBytes: malformed.result.initialInstall.network.resourceBodyBytes,
      },
      networkIdleLocalCriticalPathBudgetMs: 90_000,
      networkIdleLocalCriticalPathMs: expectedResidual,
      state: "independently-validated",
    });
    expect(JSON.stringify(failed.failureContext)).not.toContain("operator");
    expect(JSON.stringify(failed.failureContext)).not.toContain("private-value");
  });

  it("omits malformed initial-install fallback data and rejects forged breakdowns", () => {
    const malformed = mutableClone(passedEvidence());
    malformed.result.initialInstall.networkIdleLocalCriticalPathMs += 1;

    const failed = createAssetUpdateV8FailedEvidence({
      authority: malformed.authority,
      companionPath: "asset-update-v8-v4-2026-07-30T12-00-00-000Z.md",
      completedAt: COMPLETED_AT,
      error: new Error("synthetic initial-install failure"),
      partialResult: malformed.result,
      phase: "initial-install",
      postValidationPerformed: false,
      reservationId: "33333333-3333-4333-8333-333333333333",
      startedAt: STARTED_AT,
    });

    expect(validateAssetUpdateV8Evidence(failed).state).toBe("failed");
    if (
      failed.state !== "failed" ||
      failed.failureContext?.state !== "rejected-lifecycle-snapshot"
    ) {
      throw new Error("fallback lost rejected-partial context");
    }
    expect(failed.failureContext.initialInstall).toBeNull();
    expect(failed.failureContext.partialValidation.message).toBe(
      "Initial-install network-idle wall-clock critical-path residual is inconsistent",
    );

    const forged = mutableClone(failed);
    if (forged.failureContext?.state !== "rejected-lifecycle-snapshot") {
      throw new Error("forged fixture lost rejected-partial context");
    }
    forged.failureContext.initialInstall = {
      contract: "installed-lifecycle-exit@1",
      finalVerificationObservation: {
        firstObservedCompleteAtMs: 950,
        firstObservedVerifyingAtMs: 900,
        observedSpanMs: 50,
        pollIntervalMs: 20,
      },
      installWall: { durationMs: 1_000, readyAtMs: 1_000, startedAtMs: 0 },
      network: {
        activeIntervalUnionMs: 2_000,
        controlBodyBytes: 2,
        controlRequestCount: 2,
        resourceBodyBytes: 1,
        resourceCount: 1,
        resourceRequestCount: 1,
        source: "cdp-installer-worker-network@1",
        workerSource: "immutable/installer.js",
      },
      networkIdleLocalCriticalPathBudgetMs: 90_000,
      networkIdleLocalCriticalPathMs: 0,
      state: "independently-validated",
    };
    expect(() => validateAssetUpdateV8Evidence(forged)).toThrow(
      "initial-install failure breakdown is malformed",
    );
  });

  it("requires post-validation to retain the exact initial run authority", () => {
    const missing = mutableClone(passedEvidence());
    missing.postValidation.authority = null;
    expect(() =>
      validateAssetUpdateV8Evidence(missing, expectedAuthorityFromMutable(missing)),
    ).toThrow("lacks exact post-validation authority");

    const drifted = mutableClone(passedEvidence());
    drifted.postValidation.authority = mutableClone(drifted.authority);
    if (drifted.postValidation.authority === null) {
      throw new Error("synthetic passed report unexpectedly lacks post-validation authority");
    }
    drifted.postValidation.authority.persistentProfileId = OTHER_PROFILE_ID;
    expect(() =>
      validateAssetUpdateV8Evidence(drifted, expectedAuthorityFromMutable(drifted)),
    ).toThrow("lacks exact post-validation authority");

    const staleReady = mutableClone(passedEvidence());
    if (staleReady.postValidation.ready === null) {
      throw new Error("synthetic passed post-validation Ready is absent");
    }
    staleReady.postValidation.ready = mutableClone(staleReady.postValidation.ready);
    staleReady.postValidation.ready.offlineShell.activeGenerationId = "stale-generation";
    expect(() =>
      validateAssetUpdateV8Evidence(staleReady, expectedAuthorityFromMutable(staleReady)),
    ).toThrow("exact publication/offline-shell selection");

    const staleTarget = mutableClone(passedEvidence());
    if (staleTarget.postValidation.target === null) {
      throw new Error("synthetic passed post-validation target is absent");
    }
    staleTarget.postValidation.target = mutableClone(staleTarget.postValidation.target);
    requireItem(staleTarget.postValidation.target.resourceRepresentations, 0).status = 206;
    expect(() =>
      validateAssetUpdateV8Evidence(staleTarget, expectedAuthorityFromMutable(staleTarget)),
    ).toThrow("exact bytes/transport authority");
  });

  it("rejects extra ownership and companion keys", () => {
    const ownership = mutableClone(passedEvidence());
    record(ownership.resultOwnership).copiedToken = true;
    expect(() =>
      validateAssetUpdateV8Evidence(ownership, expectedAuthorityFromMutable(ownership)),
    ).toThrow("resultOwnership has unsupported or missing keys");

    const companion = mutableClone(passedEvidence());
    record(companion.companion).arbitraryPath = "other.md";
    expect(() =>
      validateAssetUpdateV8Evidence(companion, expectedAuthorityFromMutable(companion)),
    ).toThrow("companion has unsupported or missing keys");
  });

  it("keeps V8 cache rejection, re-production, and trace anomalies informational", () => {
    const evidence = passedEvidence();
    expect(evidence.result.v8.pre.cache.state).toBe("invalid");
    expect(evidence.result.v8.post.production.state).toBe("invalid");
    expect(evidence.result.v8.post.trace.state).toBe("invalid");

    expect(validateAssetUpdateV8Evidence(evidence, expectedAuthority(evidence)).state).toBe(
      "passed",
    );

    const improvedProduceAttribution = mutableClone(evidence);
    improvedProduceAttribution.result.v8.produce.trace = {
      dataLossOccurred: false,
      eventCount: 7,
      state: "measured",
    };
    improvedProduceAttribution.result.v8.produce.cache = mutableClone(
      nonConsumingCache(improvedProduceAttribution.result.v8.produce.scriptArtifacts, "produce"),
    );
    improvedProduceAttribution.result.v8.produce.production = mutableClone(
      measuredProduction(improvedProduceAttribution.result.v8.produce.scriptArtifacts),
    );
    improvedProduceAttribution.result.v8.fresh.production = mutableClone(
      freshProductionWithoutEvents(improvedProduceAttribution.result.v8.fresh.scriptArtifacts),
    );
    improvedProduceAttribution.result.v8.fresh.trace = {
      dataLossOccurred: false,
      eventCount: 7,
      state: "measured",
    };
    improvedProduceAttribution.result.v8.fresh.cache = mutableClone(
      nonConsumingCache(improvedProduceAttribution.result.v8.fresh.scriptArtifacts, "fresh"),
    );
    expect(
      validateAssetUpdateV8Evidence(
        improvedProduceAttribution,
        expectedAuthorityFromMutable(improvedProduceAttribution),
      ).state,
    ).toBe("passed");
  });

  it.each([
    "fresh",
    "produce",
  ] as const)("rejects extractor-impossible all-script cache consumption in the %s profile", (phase) => {
    const evidence = mutableClone(passedEvidence());
    evidence.result.v8[phase].cache = mutableClone(
      measuredCache(evidence.result.v8[phase].scriptArtifacts),
    );
    expect(() =>
      validateAssetUpdateV8Evidence(evidence, expectedAuthorityFromMutable(evidence)),
    ).toThrow(`${phase} cache compilation outcome is not extractor-reachable`);
  });

  it("rejects zero, missing, or byte-impossible source code unit inventories", () => {
    for (const units of [0, undefined, Number.MAX_SAFE_INTEGER]) {
      const evidence = mutableClone(passedEvidence());
      const artifact = evidence.result.v8.fresh.scriptArtifacts[0] as unknown as Record<
        string,
        unknown
      >;
      if (units === undefined) delete artifact.sourceCodeUnits;
      else artifact.sourceCodeUnits = units;
      const validation = () =>
        validateAssetUpdateV8Evidence(evidence, expectedAuthorityFromMutable(evidence));
      if (units === undefined) expect(validation).toThrow("unsupported or missing keys");
      else expect(validation).toThrow("script artifact identity is invalid");
    }
  });

  it("binds null V8 evidence state to the executable script inventory", () => {
    const wrongCacheState = mutableClone(passedEvidence());
    wrongCacheState.result.v8.pre.cache.state = "not-applicable";
    expect(() =>
      validateAssetUpdateV8Evidence(wrongCacheState, expectedAuthorityFromMutable(wrongCacheState)),
    ).toThrow("cache metric state is not an exact script-inventory projection");

    const wrongProductionState = mutableClone(passedEvidence());
    wrongProductionState.result.v8.pre.production.state = "not-applicable";
    expect(() =>
      validateAssetUpdateV8Evidence(
        wrongProductionState,
        expectedAuthorityFromMutable(wrongProductionState),
      ),
    ).toThrow("production metric state is not an exact script-inventory projection");
  });

  it("formats each V8 trace, cache, and production result without implying an aggregate pass", () => {
    const evidence = mutableClone(passedEvidence());
    evidence.result.v8.pre.trace = {
      dataLossOccurred: false,
      eventCount: 7,
      state: "measured",
    };
    evidence.result.v8.pre.cache = mutableClone(
      measuredCache(evidence.result.v8.pre.scriptArtifacts),
    );
    evidence.result.v8.pre.production = {
      evidence: null,
      reason: "Pre-warm production observation was invalid",
      state: "invalid",
    };
    evidence.result.v8.post.trace = {
      dataLossOccurred: false,
      eventCount: 7,
      state: "measured",
    };
    evidence.result.v8.post.cache = {
      evidence: null,
      reason: "Post-warm cache observation was invalid",
      state: "invalid",
    };
    evidence.result.v8.post.production = mutableClone(
      measuredProduction(evidence.result.v8.post.scriptArtifacts),
    );
    validateAssetUpdateV8Evidence(evidence, expectedAuthorityFromMutable(evidence));

    const markdown = formatAssetUpdateV8Markdown(evidence);
    expect(markdown.split("\n").filter((line) => line.startsWith("- V8 "))).toEqual([
      "- V8 produce trace: `invalid`",
      "- V8 produce cache: `invalid`",
      "- V8 produce production: `invalid`",
      "- V8 fresh trace: `invalid`",
      "- V8 fresh cache: `invalid`",
      "- V8 fresh production: `invalid`",
      "- V8 pre-warm trace: `measured`",
      "- V8 pre-warm cache: `measured`",
      "- V8 pre-warm production: `invalid`",
      "- V8 post-warm trace: `measured`",
      "- V8 post-warm cache: `invalid`",
      "- V8 post-warm production: `measured`",
    ]);
    expect(markdown).not.toContain(" diagnostic:");
  });

  it("rejects duplicate V8 artifacts, inconsistent counters, nested drift, and trace data loss", () => {
    const valid = mutableClone(passedEvidence());
    valid.result.v8.pre.cache = mutableClone(measuredCache(valid.result.v8.pre.scriptArtifacts));
    valid.result.v8.pre.production = mutableClone(
      measuredProduction(valid.result.v8.pre.scriptArtifacts),
    );
    valid.result.v8.pre.trace = {
      dataLossOccurred: false,
      eventCount: 7,
      state: "measured",
    };
    expect(validateAssetUpdateV8Evidence(valid, expectedAuthorityFromMutable(valid)).state).toBe(
      "passed",
    );

    const duplicate = mutableClone(valid);
    const duplicateEvidence = record(duplicate.result.v8.pre.cache.evidence as object);
    const duplicateArtifacts = duplicateEvidence.artifacts as Mutable<
      NonNullable<typeof valid.result.v8.pre.cache.evidence>
    >["artifacts"];
    duplicateArtifacts[1] = structuredClone(requireItem(duplicateArtifacts, 0));
    expect(() =>
      validateAssetUpdateV8Evidence(duplicate, expectedAuthorityFromMutable(duplicate)),
    ).toThrow("does not match its executable inventory");

    const counterDrift = mutableClone(valid);
    record(counterDrift.result.v8.pre.cache.evidence as object).consumedArtifactCount = 0;
    expect(() =>
      validateAssetUpdateV8Evidence(counterDrift, expectedAuthorityFromMutable(counterDrift)),
    ).toThrow("counters are not exact event projections");

    const productionDrift = mutableClone(valid);
    const productionEvidence = record(productionDrift.result.v8.pre.production.evidence as object);
    const productionArtifacts = productionEvidence.artifacts as object[];
    const firstProductionArtifact = record(requireItem(productionArtifacts, 0));
    firstProductionArtifact.state = "invalid";
    firstProductionArtifact.reason = "forged re-production classification";
    expect(() =>
      validateAssetUpdateV8Evidence(productionDrift, expectedAuthorityFromMutable(productionDrift)),
    ).toThrow("not an exact event/profile projection");

    const nestedDrift = mutableClone(valid);
    const nestedEvidence = record(nestedDrift.result.v8.pre.cache.evidence as object);
    const nestedArtifacts = nestedEvidence.artifacts as object[];
    const firstArtifact = record(requireItem(nestedArtifacts, 0));
    const compilations = firstArtifact.compilations as object[];
    record(requireItem(compilations, 0)).unexpected = true;
    expect(() =>
      validateAssetUpdateV8Evidence(nestedDrift, expectedAuthorityFromMutable(nestedDrift)),
    ).toThrow("has unsupported or missing keys");

    const dataLoss = mutableClone(passedEvidence());
    dataLoss.result.v8.pre.trace = {
      dataLossOccurred: true,
      eventCount: 7,
      state: "measured",
    };
    expect(() =>
      validateAssetUpdateV8Evidence(dataLoss, expectedAuthorityFromMutable(dataLoss)),
    ).toThrow("trace evidence is malformed");

    const invalidPrefixAttribution = mutableClone(valid);
    invalidPrefixAttribution.result.v8.pre.trace = {
      dataLossOccurred: true,
      eventCount: 7,
      reason: "trace overflow retained only a prefix",
      state: "invalid",
    };
    expect(() =>
      validateAssetUpdateV8Evidence(
        invalidPrefixAttribution,
        expectedAuthorityFromMutable(invalidPrefixAttribution),
      ),
    ).toThrow("must invalidate cache and production metrics");

    const unsanitizedNestedReason = mutableClone(passedEvidence());
    unsanitizedNestedReason.result.v8.pre.trace.reason =
      "\u0000 Authorization: Bearer abc.def.ghi api_key=private-value " +
      String.raw`\\corp-server\private-share\operator`;
    expect(() =>
      validateAssetUpdateV8Evidence(
        unsanitizedNestedReason,
        expectedAuthorityFromMutable(unsanitizedNestedReason),
      ),
    ).toThrow("trace evidence is malformed");
  });
});

interface PassedEvidenceOptions {
  readonly legacyReleaseTopology?: boolean;
  readonly postDurationMs?: number;
  readonly postResources?: readonly InstallResource[];
  readonly preDurationMs?: number;
}

interface SyntheticRelease {
  readonly authority: AssetUpdateReleaseAuthority;
  readonly installManifest: InstallManifest;
  readonly manifest: BuildManifest;
}

function passedEvidence(options: PassedEvidenceOptions = {}): PassedEvidence {
  const releaseResources = (resources: readonly InstallResource[]) =>
    options.legacyReleaseTopology === true ? withoutSimulationResources(resources) : resources;
  const pre = release(releaseResources(defaultResources()), options.legacyReleaseTopology);
  const validPost = release(releaseResources(changedResources()), options.legacyReleaseTopology);
  const post = release(
    releaseResources(options.postResources ?? changedResources()),
    options.legacyReleaseTopology,
  );
  const authority = runAuthority(pre.authority);
  const preDurationMs = options.preDurationMs ?? 9_000;
  const postDurationMs = options.postDurationMs ?? 8_750;
  const result: AssetUpdateLifecycleResult = {
    analysis: analyzeAssetOnlyReleaseUpdate(releaseProjection(pre), releaseProjection(validPost)),
    deltaMs: postDurationMs - preDurationMs,
    initialInstall: initialInstallEvidence(pre),
    launches: {
      fresh: launch("fresh", 1, pre.authority.releaseDigest, 12_000),
      post: launch("post-warm", 5, post.authority.releaseDigest, postDurationMs),
      pre: launch("pre-warm", 4, pre.authority.releaseDigest, preDurationMs),
    },
    lifecycle: [
      lifecycleEvent(1, "initial-install-ready", pre.authority.releaseDigest),
      lifecycleEvent(2, "fresh-launch-interactive", pre.authority.releaseDigest),
      lifecycleEvent(3, "produce-diagnostic-complete", pre.authority.releaseDigest),
      lifecycleEvent(4, "pre-diagnostic-complete", pre.authority.releaseDigest),
      lifecycleEvent(5, "pre-warm-launch-interactive", pre.authority.releaseDigest),
      lifecycleEvent(6, "asset-update-published", post.authority.releaseDigest),
      lifecycleEvent(7, "update-ready", post.authority.releaseDigest),
      lifecycleEvent(8, "post-warm-launch-interactive", post.authority.releaseDigest),
      lifecycleEvent(9, "post-diagnostic-complete", post.authority.releaseDigest),
    ],
    postRelease: post.authority,
    preRelease: pre.authority,
    publication: {
      postReady: readyAuthority(post.authority, pre.authority.releaseDigest),
      postTransfer: transferAuthority(post.authority, pre.authority.releaseDigest),
      preReady: readyAuthority(pre.authority, null),
      preTransfer: transferAuthority(pre.authority, null),
      updateServerJournal: {
        entries: [
          {
            bodyBytes: 11,
            cacheControl: "no-cache",
            coep: "require-corp",
            contentType: "application/json; charset=utf-8",
            coop: "same-origin",
            etag: `"sha256-${digest("e")}"`,
            ifNoneMatch: null,
            ifRange: null,
            method: "GET",
            nosniff: "nosniff",
            path: `/immutable/cell-${digest("e")}.json`,
            range: "bytes=0-",
            sequence: 1,
            status: 206,
          },
          {
            bodyBytes: 61,
            cacheControl: "no-cache",
            coep: "require-corp",
            contentType: "application/json; charset=utf-8",
            coop: "same-origin",
            etag: `"sha256-${digest("d")}"`,
            ifNoneMatch: null,
            ifRange: null,
            method: "GET",
            nosniff: "nosniff",
            path: `/immutable/district-${digest("d")}.json`,
            range: "bytes=0-",
            sequence: 2,
            status: 206,
          },
        ],
        maximumEntries: 4096,
        overflowed: false,
      },
      updateDiscovery: {
        code: "shell-release-mismatch",
        recovery: "retry",
        state: "failed",
      },
    },
    relativeRegressionThreshold: null,
    target: {
      post: targetObservation(post),
      pre: targetObservation(pre),
    },
    v8: {
      fresh: diagnostics("fresh", options.legacyReleaseTopology),
      post: diagnostics("post-warm", options.legacyReleaseTopology),
      pre: diagnostics("pre-warm", options.legacyReleaseTopology),
      produce: diagnostics("produce", options.legacyReleaseTopology),
    },
    warmLaunchBudgetMs: WARM_LAUNCH_BUDGET_MS,
  };
  return {
    authority,
    companion: {
      path: "asset-update-v8-v4-2026-07-30T12-00-00-000Z.md",
      state: "passed",
    },
    completedAt: COMPLETED_AT,
    contract: ASSET_UPDATE_V8_CONTRACT,
    postValidation: {
      authority,
      passed: true,
      performed: true,
      ready: result.publication.postReady,
      target: result.target.post,
    },
    result,
    resultOwnership: {
      publicationState: "passed",
      reservationId: "33333333-3333-4333-8333-333333333333",
    },
    schemaVersion: ASSET_UPDATE_V8_SCHEMA_VERSION,
    startedAt: STARTED_AT,
    state: "passed",
  };
}

function retainedV3PassedEvidence(): MutablePassedEvidence {
  const evidence = mutableClone(passedEvidence({ legacyReleaseTopology: true }));
  Reflect.set(evidence, "contract", "asset-update-v8-lifecycle@3");
  Reflect.set(evidence, "schemaVersion", 3);
  evidence.companion.path = "asset-update-v8-v3-2026-07-30T12-00-00-000Z.md";
  for (const launch of [
    evidence.result.launches.fresh,
    evidence.result.launches.post,
    evidence.result.launches.pre,
  ]) {
    Reflect.set(launch.lifecycle, "contract", "launch-to-interactive@2");
    Reflect.set(launch.lifecycle, "schemaVersion", 2);
    Reflect.deleteProperty(launch.lifecycle, "simulationReadyAtMs");
    Reflect.deleteProperty(launch.lifecycle, "simulationWorkerRequestedAtMs");
  }
  return evidence;
}

function initialInstallEvidence(release: SyntheticRelease) {
  const installerWorkerSource = release.manifest.workerEntrypoints.find(
    ({ role }) => role === "installer",
  )?.path;
  if (installerWorkerSource === undefined) throw new Error("Synthetic installer worker is absent");
  const controls = installControlIdentities(release.authority);
  return buildInitialInstallExitEvidence({
    controlRequests: controls.map((control, index) => ({
      bodyBytes: control.bodyBytes,
      endedAtMs: 20 + index * 20,
      etag: control.etag,
      range: null,
      requestId: `control-${index + 1}`,
      source: control.source,
      startedAtMs: 10 + index * 20,
      status: 200 as const,
    })),
    controls,
    finalVerificationFirstObservedCompleteAtMs: 950,
    finalVerificationFirstObservedVerifyingAtMs: 900,
    installReadyAtMs: 1_000,
    installStartedAtMs: 0,
    installerWorkerSource,
    manifest: release.installManifest,
    resourceRequests: release.installManifest.resources
      .filter(({ target }) => target === "opfs")
      .map((resource, index) => ({
        bodyBytes: resource.bytes,
        contentRange: `bytes 0-${resource.bytes - 1}/${resource.bytes}`,
        endedAtMs: 200,
        etag: `"sha256-${resource.sha256}"`,
        range: "bytes=0-",
        requestId: `request-${index + 1}`,
        source: resource.source,
        startedAtMs: 100,
        status: 206 as const,
      })),
  });
}

function failedEvidence(): Extract<AssetUpdateV8Evidence, { readonly state: "failed" }> {
  const passed = passedEvidence();
  return {
    authority: passed.authority,
    companion: {
      path: "asset-update-v8-v4-2026-07-30T12-00-00-000Z.md",
      state: "failed",
    },
    completedAt: COMPLETED_AT,
    contract: ASSET_UPDATE_V8_CONTRACT,
    failure: {
      message: "Synthetic companion write failed",
      name: "Error",
      phase: "companion-write",
    },
    failureContext: null,
    partialResult: null,
    postValidation: {
      authority: null,
      passed: false,
      performed: false,
      ready: null,
      target: null,
    },
    resultOwnership: {
      publicationState: "failed",
      reservationId: "33333333-3333-4333-8333-333333333333",
    },
    schemaVersion: ASSET_UPDATE_V8_SCHEMA_VERSION,
    startedAt: STARTED_AT,
    state: "failed",
  };
}

function release(
  resources: readonly InstallResource[],
  legacyReleaseTopology = false,
): SyntheticRelease {
  const districtIndex = resources.find((resource) => resource.kind === "district-index");
  if (districtIndex === undefined) throw new Error("Synthetic release lacks a district index");
  const installManifest: InstallManifest = {
    gameId: "parallax",
    resources,
    schemaVersion: 1,
  };
  const installBytes = Buffer.from(`${JSON.stringify(installManifest)}\n`);
  const releaseDigest = sha256(installBytes);
  const artifacts = [
    ...resources.map(({ bytes, sha256, source }) => ({
      bytes,
      path: source,
      sha256,
    })),
    {
      bytes: installBytes.byteLength,
      path: "install-manifest.json",
      sha256: releaseDigest,
    },
  ];
  const manifest: BuildManifest = {
    artifacts,
    gameContentEntrypoints: [
      {
        districtId: "district-1",
        path: districtIndex.source,
        schemaVersion: STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
        scope: "game-specific",
        targetType: "district",
      },
    ],
    installManifestEntrypoint: {
      path: "install-manifest.json",
      schemaVersion: 1,
    },
    offlineShell: {
      generationSchemaVersion: 1,
      saveSchemaVersion: 1,
      serviceWorkerPath: "service-worker.js",
    },
    schemaVersion: 16,
    workerEntrypoints: [
      {
        path: `immutable/decode-${digest("7")}.js`,
        role: "decode",
        targetType: "worker",
      },
      {
        path: `immutable/installer-${digest("8")}.js`,
        role: "installer",
        targetType: "worker",
      },
      {
        path: `immutable/render-${digest("9")}.js`,
        role: "render",
        targetType: "worker",
      },
      ...(legacyReleaseTopology
        ? []
        : [
            {
              path: `immutable/sim-${"cd".repeat(32)}.js`,
              role: "sim" as const,
              targetType: "worker" as const,
            },
          ]),
      {
        path: `immutable/streaming-${digest("a")}.js`,
        role: "streaming",
        targetType: "worker",
      },
      {
        path: `immutable/wasm-thread-${digest("b")}.js`,
        role: "wasm-thread",
        targetType: "worker",
      },
    ],
  };
  if (legacyReleaseTopology) {
    const gameContentEntrypoint = manifest.gameContentEntrypoints[0];
    if (gameContentEntrypoint === undefined) {
      throw new Error("Synthetic release lacks its game-content entrypoint");
    }
    Reflect.set(manifest, "schemaVersion", 15);
    Reflect.set(gameContentEntrypoint, "schemaVersion", 1);
  }
  const buildBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  return {
    authority: {
      artifactDigest: sha256(buildBytes),
      buildManifestBase64: buildBytes.toString("base64"),
      buildManifestSchemaVersion: legacyReleaseTopology ? 15 : 16,
      installManifestBase64: installBytes.toString("base64"),
      releaseDigest,
    },
    installManifest,
    manifest,
  };
}

function releaseProjection(releaseIdentity: SyntheticRelease) {
  return {
    artifactDigest: releaseIdentity.authority.artifactDigest,
    installManifest: releaseIdentity.installManifest,
    manifest: releaseIdentity.manifest,
    releaseDigest: releaseIdentity.authority.releaseDigest,
  };
}

function forgeEmbeddedContentAddressedPath(releaseAuthority: {
  artifactDigest: string;
  buildManifestBase64: string;
  installManifestBase64: string;
  releaseDigest: string;
}): void {
  const manifest = JSON.parse(
    Buffer.from(releaseAuthority.buildManifestBase64, "base64").toString("utf8"),
  ) as BuildManifest;
  const installManifest = JSON.parse(
    Buffer.from(releaseAuthority.installManifestBase64, "base64").toString("utf8"),
  ) as InstallManifest;
  const artifact = manifest.artifacts.find(({ path }) => path.startsWith("immutable/app-"));
  if (artifact === undefined) throw new Error("Synthetic release omitted its app module");
  const mutableArtifact = artifact as { path: string; sha256: string };
  const originalPath = mutableArtifact.path;
  const forgedDigest = mutableArtifact.sha256 === digest("f") ? digest("0") : digest("f");
  mutableArtifact.path = `immutable/app-${forgedDigest}.js`;
  const resource = installManifest.resources.find(({ source }) => source === originalPath);
  if (resource === undefined) throw new Error("Synthetic release omitted its app resource");
  (resource as { source: string }).source = mutableArtifact.path;
  const installBytes = Buffer.from(`${JSON.stringify(installManifest)}\n`);
  releaseAuthority.installManifestBase64 = installBytes.toString("base64");
  releaseAuthority.releaseDigest = sha256(installBytes);
  const installArtifact = manifest.artifacts.find(({ path }) => path === "install-manifest.json");
  if (installArtifact === undefined)
    throw new Error("Synthetic release omitted its install manifest");
  (installArtifact as { bytes: number; sha256: string }).bytes = installBytes.byteLength;
  (installArtifact as { bytes: number; sha256: string }).sha256 = releaseAuthority.releaseDigest;
  const buildBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  releaseAuthority.buildManifestBase64 = buildBytes.toString("base64");
  releaseAuthority.artifactDigest = sha256(buildBytes);
}

function defaultResources(): readonly InstallResource[] {
  return [
    {
      bytes: 100,
      id: "app-shell-document-index",
      kind: "document",
      scope: "app-shell",
      sha256: digest("1"),
      source: "index.html",
      target: "shell",
    },
    {
      bytes: 2_048,
      id: "app-shell-module-app",
      kind: "module",
      scope: "app-shell",
      sha256: digest("2"),
      source: `immutable/app-${digest("2")}.js`,
      target: "shell",
    },
    {
      bytes: 3_072,
      id: "common-module-engine",
      kind: "module",
      scope: "common",
      sha256: digest("0"),
      source: `immutable/engine-${digest("0")}.js`,
      target: "shell",
    },
    {
      bytes: 3_584,
      id: "game-specific-module-game",
      kind: "module",
      scope: "game-specific",
      sha256: digest("f"),
      source: `immutable/game-${digest("f")}.js`,
      target: "shell",
    },
    {
      bytes: 1_536,
      id: "game-specific-module-simulation",
      kind: "module",
      scope: "game-specific",
      sha256: "de".repeat(32),
      source: `immutable/game-simulation-${"de".repeat(32)}.js`,
      target: "shell",
    },
    {
      bytes: 300,
      id: "common-wasm-thread-spike",
      kind: "wasm",
      scope: "common",
      sha256: digest("3"),
      source: `immutable/wasm-thread-spike-${digest("3")}.wasm`,
      target: "shell",
    },
    {
      bytes: 400,
      id: "common-worker-service",
      kind: "worker",
      scope: "common",
      sha256: digest("4"),
      source: "service-worker.js",
      target: "shell",
    },
    {
      bytes: 10,
      id: "game-specific-world-cell-district-1-surface-00-00",
      kind: "world-cell",
      scope: "game-specific",
      sha256: digest("5"),
      source: `immutable/cell-${digest("5")}.json`,
      target: "opfs",
    },
    {
      bytes: 60,
      id: "game-specific-district-index-district-1",
      kind: "district-index",
      scope: "game-specific",
      sha256: digest("6"),
      source: `immutable/district-${digest("6")}.json`,
      target: "opfs",
    },
    {
      bytes: 20,
      id: "common-asset-pack-pso-warmup-trace",
      kind: "asset-pack",
      scope: "common",
      sha256: digest("c"),
      source: `immutable/pso-warmup-${digest("c")}.json`,
      target: "opfs",
    },
    {
      bytes: 500,
      id: "common-worker-decode",
      kind: "worker",
      scope: "common",
      sha256: digest("7"),
      source: `immutable/decode-${digest("7")}.js`,
      target: "shell",
    },
    {
      bytes: 4_096,
      id: "common-worker-installer",
      kind: "worker",
      scope: "common",
      sha256: digest("8"),
      source: `immutable/installer-${digest("8")}.js`,
      target: "shell",
    },
    {
      bytes: 8_192,
      id: "common-worker-render",
      kind: "worker",
      scope: "common",
      sha256: digest("9"),
      source: `immutable/render-${digest("9")}.js`,
      target: "shell",
    },
    {
      bytes: 1_024,
      id: "common-worker-sim",
      kind: "worker",
      scope: "common",
      sha256: "cd".repeat(32),
      source: `immutable/sim-${"cd".repeat(32)}.js`,
      target: "shell",
    },
    {
      bytes: 16_384,
      id: "common-worker-streaming",
      kind: "worker",
      scope: "common",
      sha256: digest("a"),
      source: `immutable/streaming-${digest("a")}.js`,
      target: "shell",
    },
    {
      bytes: 540,
      id: "common-worker-wasm-thread",
      kind: "worker",
      scope: "common",
      sha256: digest("b"),
      source: `immutable/wasm-thread-${digest("b")}.js`,
      target: "shell",
    },
  ];
}

function changedResources(): readonly InstallResource[] {
  return defaultResources().map((resource) => {
    if (resource.kind === "world-cell") {
      return {
        ...resource,
        bytes: 11,
        sha256: digest("e"),
        source: `immutable/cell-${digest("e")}.json`,
      };
    }
    if (resource.kind === "district-index") {
      return {
        ...resource,
        bytes: 61,
        sha256: digest("d"),
        source: `immutable/district-${digest("d")}.json`,
      };
    }
    return resource;
  });
}

function withoutSimulationResources(
  resources: readonly InstallResource[],
): readonly InstallResource[] {
  return resources.filter(
    ({ id }) => id !== "common-worker-sim" && id !== "game-specific-module-simulation",
  );
}

function runAuthority(pre: AssetUpdateReleaseAuthority): AssetUpdateRunAuthority {
  const descriptorBytes = Buffer.from(JSON.stringify(MACHINE_DESCRIPTOR));
  return {
    baseBuild: {
      artifactDigest: pre.artifactDigest,
      releaseDigest: pre.releaseDigest,
    },
    browser: {
      executableSha256: digest("7"),
      jsVersion: "15.1.1",
      product: "Chrome/151.0.8000.1",
      protocolVersion: "1.3",
      revision: "revision-1",
      userAgent: "Mozilla/5.0 Chrome/151.0.8000.1",
      version: "151.0.8000.1",
    },
    machine: {
      descriptorBase64: descriptorBytes.toString("base64"),
      descriptorSha256: sha256(descriptorBytes),
      gate: {
        post: { state: "measured", value: true },
        pre: { state: "measured", value: true },
      },
      id: "dev-01",
      postObservation: MACHINE_OBSERVATION,
      preObservation: MACHINE_OBSERVATION,
    },
    persistentProfileId: PROFILE_ID,
    source: {
      commit: "8".repeat(40),
      dirtyTreeDigest: digest("9"),
    },
    targetOrigin: TARGET_ORIGIN,
  };
}

function launch(
  phase: AssetUpdateV8LaunchEvidence["phase"],
  ordinal: AssetUpdateV8LaunchEvidence["ordinal"],
  releaseDigest: string,
  durationMs: number,
): AssetUpdateV8LaunchEvidence {
  return {
    cacheState: phase === "fresh" ? "setup" : "stable-consume",
    lifecycle: launchLifecycle(releaseDigest, durationMs),
    ordinal,
    persistentProfileId: PROFILE_ID,
    phase,
    releaseDigest,
  };
}

function launchLifecycle(releaseDigest: string, durationMs: number): LaunchToInteractiveEvidence {
  const startedAtMs = 1_000;
  return {
    attempt: 1,
    contract: "launch-to-interactive@3",
    durationMs,
    failureMessage: null,
    interactiveAtMs: startedAtMs + durationMs,
    preflightTiming: {
      finalReleaseAdmissionAtMs: startedAtMs + 50,
      initialReleaseAdmissionAtMs: startedAtMs + 10,
      modelSourceReadyAtMs: startedAtMs + 20,
      psoTraceReadyAtMs: startedAtMs + 40,
      streamingReferencesReadyAtMs: startedAtMs + 30,
    },
    releaseDigest,
    renderFirstFrameAtMs: startedAtMs + 200,
    schemaVersion: 3,
    shellAdmissionAtMs: startedAtMs + 60,
    simulationReadyAtMs: startedAtMs + 250,
    simulationWorkerRequestedAtMs: startedAtMs + 80,
    startedAtMs,
    state: "interactive",
    streamingStartupTiming: {
      accessHandlesOpenedAtMs: 5,
      contract: "streaming-startup-timing@1",
      decodePoolCreatedAtMs: 7,
      finalAdmissionCompletedAtMs: 6,
      initialResidencyReadyAtMs: 8,
      provisioningStartedAtMs: 2,
      releaseBindingCompletedAtMs: 3,
      releaseResolutionCompletedAtMs: 4,
      schemaVersion: 1,
      sourceKind: "installed-release",
      workerStartedAtMs: 1,
    },
    streamingWorkerRequestedAtMs: startedAtMs + 70,
    streamingReadyAtMs: startedAtMs + 300,
  };
}

function lifecycleEvent(
  sequence: number,
  name: AssetUpdateLifecycleResult["lifecycle"][number]["name"],
  releaseDigest: string,
): AssetUpdateLifecycleResult["lifecycle"][number] {
  return {
    completedAtMs: sequence * 1_000,
    name,
    persistentProfileId: PROFILE_ID,
    releaseDigest,
    sequence,
  };
}

function readyAuthority(
  releaseIdentity: AssetUpdateReleaseAuthority,
  previousReleaseDigest: string | null,
) {
  const generationId = `${releaseIdentity.artifactDigest}:${releaseIdentity.releaseDigest}`;
  return {
    artifactDigest: releaseIdentity.artifactDigest,
    generationId,
    installStore: {
      activeReleaseDigest: releaseIdentity.releaseDigest,
      previousReleaseDigest,
      state: "ready" as const,
    },
    launchEnabled: true as const,
    offlineShell: {
      activeArtifactDigest: releaseIdentity.artifactDigest,
      activeGenerationId: generationId,
      activeReleaseDigest: releaseIdentity.releaseDigest,
      state: "active" as const,
    },
    releaseDigest: releaseIdentity.releaseDigest,
    uiState: "ready" as const,
  };
}

function transferAuthority(
  releaseIdentity: AssetUpdateReleaseAuthority,
  previousReleaseDigest: string | null,
) {
  const resources = (
    previousReleaseDigest === null ? defaultResources() : changedResources()
  ).filter((resource) => resource.target === "opfs");
  const totalBytes = resources.reduce((total, resource) => total + resource.bytes, 0);
  const changed = resources.filter(
    (resource) => resource.kind === "world-cell" || resource.kind === "district-index",
  );
  const transferredBytes =
    previousReleaseDigest === null
      ? totalBytes
      : changed.reduce((total, resource) => total + resource.bytes, 0);
  const transferredResources = previousReleaseDigest === null ? resources.length : changed.length;
  const largestUnverifiedBytes = Math.max(
    0,
    ...(previousReleaseDigest === null ? resources : changed).map((resource) => resource.bytes),
  );
  return {
    ...idleInstallerTransferTelemetrySnapshot(1, 8 * 1024 * 1024),
    activeReleaseDigest: releaseIdentity.releaseDigest,
    completedResourceCount: resources.length,
    checkpointedBytes: transferredBytes,
    downloadedBytes: transferredBytes,
    finalVerificationBytes: totalBytes,
    finalVerificationPhase: "complete" as const,
    finalVerificationResourceCount: resources.length,
    finalVerificationTotalBytes: totalBytes,
    finalVerificationTotalResourceCount: resources.length,
    hashedBytes: totalBytes,
    httpRequestCount: transferredResources,
    plannedDownloadBytes: transferredBytes,
    quotaProbeBytes: 1024 * 1024,
    quotaProbeCompleted: true,
    quotaRequiredPeakBytes: Math.max(largestUnverifiedBytes, MIB) + 16 * MIB,
    rangeRequestCount: transferredResources,
    resourceCount: resources.length,
    reusedBytes: totalBytes - transferredBytes,
    state: "ready" as const,
    totalBytes,
    verifiedBytes: totalBytes,
  };
}

function targetObservation(releaseIdentity: SyntheticRelease): AssetUpdateTargetObservation {
  const resourceRepresentations = releaseIdentity.installManifest.resources
    .map((resource) => ({
      bytes: resource.bytes,
      cacheControl: resource.source.startsWith("immutable/")
        ? ("public, max-age=31536000, immutable" as const)
        : ("no-cache" as const),
      conditionalStatus: 304 as const,
      contentType:
        resource.kind === "wasm"
          ? ("application/wasm" as const)
          : resource.kind === "module" || resource.kind === "worker"
            ? ("application/javascript" as const)
            : resource.kind === "document"
              ? ("text/html; charset=utf-8" as const)
              : resource.kind === "district-index" ||
                  resource.kind === "world-cell" ||
                  resource.source.endsWith(".json")
                ? ("application/json; charset=utf-8" as const)
                : ("application/octet-stream" as const),
      etag: `"sha256-${resource.sha256}"`,
      kind: resource.kind,
      sha256: resource.sha256,
      source: resource.source,
      status: 200 as const,
      validation: "full-body-sha256" as const,
    }))
    .sort((left, right) => left.source.localeCompare(right.source));
  return {
    artifactDigest: releaseIdentity.authority.artifactDigest,
    buildManifestEtag: `"sha256-${releaseIdentity.authority.artifactDigest}"`,
    buildManifestSha256: releaseIdentity.authority.artifactDigest,
    resourceRepresentations,
    installManifestEtag: `"sha256-${releaseIdentity.authority.releaseDigest}"`,
    installManifestSha256: releaseIdentity.authority.releaseDigest,
    origin: TARGET_ORIGIN,
    releaseDigest: releaseIdentity.authority.releaseDigest,
  };
}

function diagnostics(
  phase: AssetUpdateV8Diagnostics["phase"],
  legacyReleaseTopology = false,
): AssetUpdateV8Diagnostics {
  const wasmArtifact = {
    bytes: 300,
    path: `immutable/wasm-thread-spike-${digest("3")}.wasm`,
    sha256: digest("3"),
  };
  return {
    cache: {
      evidence: null,
      reason: `${phase} observed a cache rejection anomaly`,
      state: "invalid",
    },
    phase,
    persistentProfileId: PROFILE_ID,
    production: {
      evidence: null,
      reason: `${phase} observed a code-cache re-production anomaly`,
      state: "invalid",
    },
    profile: phase === "fresh" ? "fresh" : phase === "produce" ? "produce" : "warm",
    runtimeOrdinal: phase === "fresh" ? 1 : phase === "produce" ? 2 : phase === "pre-warm" ? 3 : 6,
    scriptArtifacts: [
      {
        bytes: 2_048,
        path: `immutable/app-${digest("2")}.js`,
        sourceCodeUnits: 2_048,
      },
      {
        bytes: 3_072,
        path: `immutable/engine-${digest("0")}.js`,
        sourceCodeUnits: 3_072,
      },
      {
        bytes: 3_584,
        path: `immutable/game-${digest("f")}.js`,
        sourceCodeUnits: 3_584,
      },
      ...(legacyReleaseTopology
        ? []
        : [
            {
              bytes: 1_536,
              path: `immutable/game-simulation-${"de".repeat(32)}.js`,
              sourceCodeUnits: 1_536,
            },
          ]),
      {
        bytes: 4_096,
        path: `immutable/installer-${digest("8")}.js`,
        sourceCodeUnits: 4_096,
      },
      {
        bytes: 8_192,
        path: `immutable/render-${digest("9")}.js`,
        sourceCodeUnits: 8_192,
      },
      ...(legacyReleaseTopology
        ? []
        : [
            {
              bytes: 1_024,
              path: `immutable/sim-${"cd".repeat(32)}.js`,
              sourceCodeUnits: 1_024,
            },
          ]),
      {
        bytes: 16_384,
        path: `immutable/streaming-${digest("a")}.js`,
        sourceCodeUnits: 16_384,
      },
    ],
    trace: {
      dataLossOccurred: false,
      eventCount: 7,
      reason: `${phase} trace anomaly is diagnostic-only`,
      state: "invalid",
    },
    wasmStreaming:
      phase === "fresh"
        ? {
            api: "compileStreaming",
            artifact: wasmArtifact,
            durationMs: null,
            reason: "Fresh installer boundary does not launch threaded Wasm",
            state: "not-applicable",
          }
        : {
            api: "compileStreaming",
            artifact: wasmArtifact,
            durationMs: null,
            reason: `${phase} threaded-Wasm diagnostic was unavailable`,
            state: "invalid",
          },
    workerStartupToFirstFrameMs: 12.5,
  };
}

function measuredCache(
  scripts: readonly AssetUpdateV8Diagnostics["scriptArtifacts"][number][],
): AssetUpdateV8Diagnostics["cache"] {
  return {
    evidence: {
      artifacts: scripts.map((script, index) => ({
        artifact: script.path,
        bytes: script.bytes,
        cache: {
          consumedBytes: 64 + index,
          outcome: "consumed" as const,
          state: "measured" as const,
        },
        compileDurationUs: 10 + index,
        compilations: [
          {
            cache: {
              consumedBytes: 64 + index,
              outcome: "consumed" as const,
              state: "measured" as const,
            },
            compilation: "module" as const,
            compileDurationUs: 10 + index,
            processId: 1,
            streamed: true,
            threadId: index + 1,
          },
        ],
        sourceCodeUnits: script.sourceCodeUnits,
      })),
      cacheableArtifactCount: scripts.length,
      consumedArtifactCount: scripts.length,
      rejectedArtifactCount: 0,
    },
    state: "measured",
  };
}

function nonConsumingCache(
  scripts: readonly AssetUpdateV8Diagnostics["scriptArtifacts"][number][],
  profile: "fresh" | "produce",
): AssetUpdateV8Diagnostics["cache"] {
  const reason =
    profile === "fresh"
      ? "fresh profile has no prior persistent V8 code cache to consume"
      : "produce profile has only a prior hot timestamp and no code cache to consume";
  return {
    evidence: {
      artifacts: scripts.map((script, index) => ({
        artifact: script.path,
        bytes: script.bytes,
        cache: { reason, state: "not-applicable" as const },
        compileDurationUs: 10 + index,
        compilations: [
          {
            cache: { reason, state: "not-applicable" as const },
            compilation: "module" as const,
            compileDurationUs: 10 + index,
            processId: 1,
            streamed: true,
            threadId: index + 1,
          },
        ],
        sourceCodeUnits: script.sourceCodeUnits,
      })),
      cacheableArtifactCount: scripts.length,
      consumedArtifactCount: 0,
      rejectedArtifactCount: 0,
    },
    state: "measured",
  };
}

function measuredProduction(
  scripts: readonly AssetUpdateV8Diagnostics["scriptArtifacts"][number][],
): AssetUpdateV8Diagnostics["production"] {
  const artifacts = scripts.map((script, index) => ({
    artifact: script.path,
    bytes: script.bytes,
    productions: [
      {
        processId: 1,
        producedBytes: 100 + index,
        state: "measured" as const,
        threadId: index + 1,
      },
    ],
    sourceCodeUnits: script.sourceCodeUnits,
    state: "measured" as const,
  }));
  return {
    evidence: {
      artifacts,
      cacheableArtifactCount: scripts.length,
      producedArtifactCount: scripts.length,
      producedBytes: artifacts.reduce(
        (total, artifact) => total + requireItem(artifact.productions, 0).producedBytes,
        0,
      ),
    },
    state: "measured",
  };
}

function freshProductionWithoutEvents(
  scripts: readonly AssetUpdateV8Diagnostics["scriptArtifacts"][number][],
): AssetUpdateV8Diagnostics["production"] {
  return {
    evidence: {
      artifacts: scripts.map((script) => ({
        artifact: script.path,
        bytes: script.bytes,
        productions: [],
        reason: "fresh launch emitted no unexpected URL-attributed code-cache production event",
        sourceCodeUnits: script.sourceCodeUnits,
        state: "not-applicable" as const,
      })),
      cacheableArtifactCount: scripts.length,
      producedArtifactCount: 0,
      producedBytes: 0,
    },
    state: "measured",
  };
}

function expectedAuthority(evidence: PassedEvidence): AssetUpdateExpectedAuthority {
  return {
    authority: evidence.authority,
    postArtifactDigest: evidence.result.postRelease.artifactDigest,
    postReleaseDigest: evidence.result.postRelease.releaseDigest,
  };
}

function expectedAuthorityFromMutable(
  evidence: MutablePassedEvidence,
): AssetUpdateExpectedAuthority {
  return expectedAuthority(evidence as unknown as PassedEvidence);
}

function mutableClone<T>(value: T): Mutable<T> {
  return structuredClone(value) as Mutable<T>;
}

function canonicalRoundTrip<T>(input: T): T {
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  };
  return JSON.parse(JSON.stringify(canonicalize(input))) as T;
}

function record(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function requireItem<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`Synthetic fixture item ${index} is unavailable`);
  return value;
}

function digest(character: string): string {
  return character.repeat(64);
}

function sha256(value: NodeJS.ArrayBufferView): string {
  return createHash("sha256").update(value).digest("hex");
}
