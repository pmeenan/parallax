import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { PsoWarmupTelemetrySnapshot } from "@parallax/engine";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readAndValidateBuildManifest, type ValidatedBuildManifest } from "./build-manifest.js";
import { type ChromePin, loadChromePin } from "./chrome-pin.js";
import { loadMachineDescriptor, type MachineDescriptor } from "./environment.js";
import { qualifyPsoWarmupLaunchPairs } from "./pso-warmup-qualification.js";
import { completePsoQualificationSmokeReport } from "./pso-warmup-qualification.test-fixture.js";
import { readPsoWarmupQualificationPreflight } from "./pso-warmup-qualification-preflight.js";
import { readSourceIdentity, type SourceIdentity } from "./source-identity.js";

const repositoryRoot = resolve(process.cwd());
let build: ValidatedBuildManifest;
let chromeExecutableSha256: string;
let chromePin: ChromePin;
let machineDescriptor: MachineDescriptor;
let source: SourceIdentity;
const cleanup: string[] = [];

beforeAll(async () => {
  build = await readAndValidateBuildManifest(resolve(repositoryRoot, "dist"));
  chromePin = await loadChromePin(resolve(repositoryRoot, "harness/chrome/stable.json"));
  chromeExecutableSha256 = chromePin.executableSha256.win64 ?? "";
  machineDescriptor = await loadMachineDescriptor(
    resolve(repositoryRoot, "harness/machines"),
    "dev-01",
  );
  source = await readSourceIdentity(repositoryRoot);
});

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("PSO warmup launch-pair qualification", () => {
  it("binds a complete finalized report to the real built release and trace", () => {
    const report = validReport();
    expect(qualify(report)).toMatchObject({
      artifactDigest: build.artifactDigest,
      contract: "pso-warmup-launch-pair@1",
      pairs: [
        { lineageId: "lineage-1", repeat: 1 },
        { lineageId: "lineage-2", repeat: 2 },
        { lineageId: "lineage-3", repeat: 3 },
      ],
      passed: true,
      releaseDigest: build.releaseDigest,
      schemaVersion: 1,
      traceSha256: build.psoWarmupTrace.sha256,
    });
  });

  it("accepts the registered render-surface dimension tolerance at its exact boundary", () => {
    const report = validReport();
    for (const candidate of report.runs) {
      candidate.renderSurfaceBefore = { height: 2162, width: 3838 };
      candidate.renderSurfaceAfter = { height: 2162, width: 3838 };
    }
    expect(qualify(report).passed).toBe(true);
  });

  it.each([
    ["width below", { height: 2160, width: 3837 }],
    ["width above", { height: 2160, width: 3843 }],
    ["height below", { height: 2157, width: 3840 }],
    ["height above", { height: 2163, width: 3840 }],
  ] as const)("rejects a render surface outside registered tolerance: %s", (_label, surface) => {
    const report = validReport();
    run(report, 0).renderSurfaceBefore = surface;
    run(report, 0).renderSurfaceAfter = surface;
    expect(() => qualify(report)).toThrow(/render-surface presentation identity drifted/);
  });

  it.each([
    [
      "omitted finalized field",
      (report: Record<string, unknown>) => delete report.reportPersistence,
    ],
    [
      "failed facet",
      (report: Record<string, unknown>) => {
        const facets = report.facets as Record<string, Record<string, unknown>>;
        const environmentFacet = facets.environment;
        if (environmentFacet === undefined) throw new Error("Fixture environment facet is missing");
        environmentFacet.status = "failed";
      },
    ],
    [
      "unevaluated budget facet",
      (report: Record<string, unknown>) => {
        const facets = report.facets as Record<string, Record<string, unknown>>;
        const budgetFacet = facets.budgetEvaluation;
        if (budgetFacet === undefined) throw new Error("Fixture budget facet is missing");
        budgetFacet.status = "not-evaluated";
      },
    ],
    [
      "facet reason despite passed status",
      (report: Record<string, unknown>) => {
        const facets = report.facets as Record<string, Record<string, unknown>>;
        const evidenceFacet = facets.evidenceCompleteness;
        if (evidenceFacet === undefined) throw new Error("Fixture evidence facet is missing");
        evidenceFacet.reasons = ["withheld"];
      },
    ],
    [
      "wrong smoke schema",
      (report: Record<string, unknown>) => {
        report.schemaVersion = 59;
      },
    ],
    [
      "wrong mandatory metric set",
      (report: Record<string, unknown>) => {
        (report.mandatoryMetricSet as Record<string, unknown>).version = 27;
      },
    ],
    [
      "unregistered physical environment",
      (report: Record<string, unknown>) => {
        environment(report).gateIdentity = {
          reasons: ["unregistered"],
          state: "invalid",
          value: false,
        };
      },
    ],
    [
      "registered machine descriptor drift",
      (report: Record<string, unknown>) => {
        (environment(report).machine as Record<string, unknown>).osBuild = "forged";
      },
    ],
    [
      "remote session",
      (report: Record<string, unknown>) => {
        (environment(report).host as Record<string, unknown>).remoteSession = true;
        (environment(report).hostAfterRuns as Record<string, unknown>).remoteSession = true;
      },
    ],
    [
      "power identity drift",
      (report: Record<string, unknown>) => {
        const host = environment(report).host as Record<string, unknown>;
        (host.power as Record<string, unknown>).guid = "00000000-0000-0000-0000-000000000000";
      },
    ],
    [
      "host identity drift after runs",
      (report: Record<string, unknown>) => {
        const host = environment(report).hostAfterRuns as Record<string, unknown>;
        (host.cpu as Record<string, unknown>).cores = 23;
      },
    ],
    [
      "browser display drift",
      (report: Record<string, unknown>) => {
        const display = environment(report).browserDisplay as Record<string, unknown>;
        (display.screen as Record<string, unknown>).width = 100;
      },
    ],
    [
      "presentation display drift",
      (report: Record<string, unknown>) => {
        const display = run(report as ReturnType<typeof validReport>, 0)
          .browserDisplayAfter as Record<string, unknown>;
        (display.screen as Record<string, unknown>).width = 100;
      },
    ],
    [
      "presentation surface drift",
      (report: Record<string, unknown>) => {
        const surface = run(report as ReturnType<typeof validReport>, 0)
          .renderSurfaceAfter as Record<string, unknown>;
        surface.width = 100;
      },
    ],
    [
      "unverified sandbox",
      (report: Record<string, unknown>) => {
        environment(report).sandboxVerified = false;
      },
    ],
    [
      "browser identity drift",
      (report: Record<string, unknown>) => {
        environment(report).browserProduct = "Chrome/0.0.0.0";
      },
    ],
    [
      "browser revision drift",
      (report: Record<string, unknown>) => {
        environment(report).browserRevision = `@${"f".repeat(40)}`;
      },
    ],
    [
      "executable identity drift",
      (report: Record<string, unknown>) => {
        environment(report).executableSha256 = "f".repeat(64);
      },
    ],
    [
      "target postflight failure",
      (report: Record<string, unknown>) => {
        environment(report).targetPostflight = { reason: "failed", state: "failed" };
      },
    ],
    [
      "target identity drift",
      (report: Record<string, unknown>) => {
        const reportEnvironment = environment(report);
        reportEnvironment.targetPreflight = structuredClone(reportEnvironment.targetPreflight);
        reportEnvironment.targetPostflight = structuredClone(reportEnvironment.targetPostflight);
        const target = reportEnvironment.target as Record<string, unknown>;
        target.origin = "http://127.0.0.1:9999";
      },
    ],
    [
      "target preflight drift",
      (report: Record<string, unknown>) => {
        const preflight = environment(report).targetPreflight as Record<string, unknown>;
        const identity = structuredClone(preflight.identity) as Record<string, unknown>;
        identity.origin = "http://127.0.0.1:9999";
        preflight.identity = identity;
      },
    ],
    [
      "target postflight drift",
      (report: Record<string, unknown>) => {
        const postflight = environment(report).targetPostflight as Record<string, unknown>;
        const identity = structuredClone(postflight.identity) as Record<string, unknown>;
        identity.origin = "http://127.0.0.1:9999";
        postflight.identity = identity;
      },
    ],
  ] as const)("rejects %s", (_label, mutate) => {
    const report = validReport();
    mutate(report);
    expect(() => qualify(report)).toThrow();
  });

  it.each([
    ["artifact", "artifactDigest", "a".repeat(64)],
    ["release", "releaseDigest", "b".repeat(64)],
    ["source", "source", { commit: "c".repeat(40), dirtyTreeDigest: null }],
  ] as const)("rejects arbitrary %s authority", (_label, key, forged) => {
    const report = validReport();
    report[key] = forged;
    if (key === "artifactDigest" || key === "releaseDigest") {
      const target = environment(report).target as Record<string, unknown>;
      target[key] = forged;
      const preflight = environment(report).targetPreflight as Record<string, unknown>;
      const postflight = environment(report).targetPostflight as Record<string, unknown>;
      preflight.identity = structuredClone(target);
      postflight.identity = structuredClone(target);
    }
    expect(() => qualify(report)).toThrow(/validated build|source identity/);
  });

  it("rejects telemetry whose trace identity differs from the actual built bytes", () => {
    const report = validReport();
    for (const run of report.runs) {
      const pso = (run.psoWarmup as { value: Record<string, unknown> }).value;
      pso.traceSha256 = "d".repeat(64);
    }
    expect(() => qualify(report)).toThrow(/exact trace identity|validated build trace/);
  });

  it("rejects telemetry whose build compatibility identity differs from the build", () => {
    const report = validReport();
    for (const run of report.runs) {
      const pso = (run.psoWarmup as { value: Record<string, unknown> }).value;
      pso.buildCompatibilityDigest = "d".repeat(64);
    }
    expect(() => qualify(report)).toThrow(/trace identity|validated build trace/);
  });

  it("rejects smoke evidence invalidated by a retained prior-generation PSO failure", () => {
    const report = validReport();
    const firstRun = report.runs[0];
    if (firstRun === undefined) throw new Error("Qualification fixture has no first run");
    firstRun.psoWarmup = {
      reason: "PSO warmup retained a failed prior worker generation 1",
      state: "invalid",
    };
    expect(() => qualify(report)).toThrow(/psoWarmup\.state must be measured/);
  });

  it("rejects incomplete facets and launch populations before launch-pair extraction", () => {
    const report = validReport();
    report.runs.pop();
    expect(() => qualify(report)).toThrow(/repeats 1 through|six core launches/);
  });

  it.each([
    [
      "reordered launches",
      (report: ReturnType<typeof validReport>) => {
        const second = run(report, 1);
        const third = run(report, 2);
        report.runs[1] = third;
        report.runs[2] = second;
      },
    ],
    [
      "ordinal drift",
      (report: ReturnType<typeof validReport>) => {
        run(report, 2).launchOrdinal = 2;
      },
    ],
    [
      "repeat drift",
      (report: ReturnType<typeof validReport>) => {
        run(report, 2).repeat = 1;
      },
    ],
    [
      "lineage duplication",
      (report: ReturnType<typeof validReport>) => {
        lineage(report, 2).id = "lineage-1";
        lineage(report, 3).id = "lineage-1";
      },
    ],
    [
      "profile duplication",
      (report: ReturnType<typeof validReport>) => {
        run(report, 1).profile = "fresh";
      },
    ],
    [
      "within-pair persistent-profile drift",
      (report: ReturnType<typeof validReport>) => {
        lineage(report, 1).id = "lineage-2";
      },
    ],
    [
      "history drift",
      (report: ReturnType<typeof validReport>) => {
        lineage(report, 1).history = ["warm"];
      },
    ],
    [
      "nonmonotonic launch chronology",
      (report: ReturnType<typeof validReport>) => {
        run(report, 3).launchStartedAfterSequenceMs = run(report, 2).launchStartedAfterSequenceMs;
      },
    ],
    [
      "coordinated relabel with stale chronology",
      (report: ReturnType<typeof validReport>) => {
        const second = structuredClone(run(report, 1));
        const third = structuredClone(run(report, 2));
        report.runs[1] = third;
        report.runs[2] = second;
        relabelRun(report, 1, "warm", 1);
        relabelRun(report, 2, "fresh", 2);
      },
    ],
  ] as const)("rejects %s without regrouping or sorting", (_label, mutate) => {
    const report = validReport();
    mutate(report);
    expect(() => qualify(report)).toThrow();
  });

  it.each([
    [
      "render pair count mismatch",
      (report: ReturnType<typeof validReport>) => {
        renderCache(report, 1).hitCount = 2;
      },
    ],
    [
      "shader pair count mismatch",
      (report: ReturnType<typeof validReport>) => {
        shaderCache(report, 1).hitCount = 5;
        shaderCache(report, 1).requestCount = 5;
      },
    ],
    [
      "cross-lineage count drift",
      (report: ReturnType<typeof validReport>) => {
        renderCache(report, 2).missCount = 4;
        renderCache(report, 3).hitCount = 4;
      },
    ],
    [
      "pipeline overlap",
      (report: ReturnType<typeof validReport>) => {
        pipelineActivity(report, 0).overlappingMeasurement = 1;
      },
    ],
    [
      "shader overlap",
      (report: ReturnType<typeof validReport>) => {
        shaderCache(report, 1).missesOverlappingMeasurement = 1;
      },
    ],
    [
      "compute cache activity",
      (report: ReturnType<typeof validReport>) => {
        dawn(report, 0).pipelineCache = {
          ...(dawn(report, 0).pipelineCache as Record<string, unknown>),
          compute: {
            state: "measured",
            value: { hitCount: 0, missCount: 1 },
          },
        };
      },
    ],
    [
      "shader request-count mismatch",
      (report: ReturnType<typeof validReport>) => {
        shaderCache(report, 0).requestCount = 7;
      },
    ],
  ] as const)("rejects %s", (_label, mutate) => {
    const report = validReport();
    mutate(report);
    expect(() => qualify(report)).toThrow();
  });

  it("binds the result source hash to the exact report bytes", () => {
    const first = bytes(validReport());
    const secondReport = validReport();
    secondReport.generatedAt = "2026-07-29T00:00:01.000Z";
    const second = bytes(secondReport);
    expect(
      qualifyPsoWarmupLaunchPairs(first, {
        build,
        chromeExecutableSha256,
        chromePin,
        machineDescriptor,
        repositorySource: source,
        smokeReportPath: "smoke.json",
      }).smokeReport.sha256,
    ).not.toBe(
      qualifyPsoWarmupLaunchPairs(second, {
        build,
        chromeExecutableSha256,
        chromePin,
        machineDescriptor,
        repositorySource: source,
        smokeReportPath: "smoke.json",
      }).smokeReport.sha256,
    );
  });

  it("rejects a coordinated Chrome identity forgery through the production preflight path", async () => {
    const report = validReport();
    const forgedPin = {
      ...chromePin,
      downloads: { win64: "https://example.invalid/forged.zip" },
      executableSha256: { win64: "f".repeat(64) },
      revision: "9999999",
      version: "999.0.0.0",
    };
    report.chromePin = forgedPin;
    const reportEnvironment = environment(report);
    reportEnvironment.browserProduct = `Chrome/${forgedPin.version}`;
    reportEnvironment.browserRevision = `@${"f".repeat(40)}`;
    reportEnvironment.browserUserAgent = `Chrome/${forgedPin.version}`;
    reportEnvironment.executableSha256 = forgedPin.executableSha256.win64;
    const root = await mkdtemp(join(tmpdir(), "parallax-pso-qualification-"));
    cleanup.push(root);
    const reportPath = join(root, "forged-smoke.json");
    await writeFile(reportPath, bytes(report));
    const preflight = await readPsoWarmupQualificationPreflight({
      buildRoot: resolve(repositoryRoot, "dist"),
      repositoryRoot,
      smokeReportPath: reportPath,
    });
    expect(preflight.authority.machineDescriptor).toEqual(machineDescriptor);
    expect(() => qualifyPsoWarmupLaunchPairs(preflight.inputBytes, preflight.authority)).toThrow(
      /checked-in Chrome pin/,
    );
  });

  it("rejects an unregistered or unsafe machine ID during production preflight", async () => {
    const report = validReport();
    environment(report).machineId = "../forged";
    const root = await mkdtemp(join(tmpdir(), "parallax-pso-machine-"));
    cleanup.push(root);
    const reportPath = join(root, "forged-machine-smoke.json");
    await writeFile(reportPath, bytes(report));
    await expect(
      readPsoWarmupQualificationPreflight({
        buildRoot: resolve(repositoryRoot, "dist"),
        repositoryRoot,
        smokeReportPath: reportPath,
      }),
    ).rejects.toThrow(/Invalid machine ID/);
  });
});

function validReport(): ReturnType<typeof completePsoQualificationSmokeReport> {
  return completePsoQualificationSmokeReport({
    artifactDigest: build.artifactDigest,
    chromePin,
    executableSha256: chromeExecutableSha256,
    psoWarmup: exactPsoSnapshot(),
    releaseDigest: build.releaseDigest,
    source,
  });
}

function qualify(report: Record<string, unknown>): ReturnType<typeof qualifyPsoWarmupLaunchPairs> {
  return qualifyPsoWarmupLaunchPairs(bytes(report), {
    build,
    chromeExecutableSha256,
    chromePin,
    machineDescriptor,
    repositorySource: source,
    smokeReportPath: "smoke.json",
  });
}

function bytes(report: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(report, null, 2)}\n`);
}

function environment(report: Record<string, unknown>): Record<string, unknown> {
  return report.environment as Record<string, unknown>;
}

function lineage(report: ReturnType<typeof validReport>, index: number): Record<string, unknown> {
  return run(report, index).profileLineage as Record<string, unknown>;
}

function dawn(report: ReturnType<typeof validReport>, index: number): Record<string, unknown> {
  return (run(report, index).dawnPipeline as { value: Record<string, unknown> }).value;
}

function renderCache(
  report: ReturnType<typeof validReport>,
  index: number,
): Record<string, unknown> {
  const pipelineCache = dawn(report, index).pipelineCache as Record<string, unknown>;
  return (pipelineCache.render as { value: Record<string, unknown> }).value;
}

function shaderCache(
  report: ReturnType<typeof validReport>,
  index: number,
): Record<string, unknown> {
  return dawn(report, index).shaderCache as Record<string, unknown>;
}

function pipelineActivity(
  report: ReturnType<typeof validReport>,
  index: number,
): Record<string, unknown> {
  return dawn(report, index).pipelineActivity as Record<string, unknown>;
}

function run(report: ReturnType<typeof validReport>, index: number): Record<string, unknown> {
  const value = report.runs[index];
  if (value === undefined) throw new Error(`Fixture run ${index} is missing`);
  return value;
}

function relabelRun(
  report: ReturnType<typeof validReport>,
  index: number,
  profile: "fresh" | "warm",
  repeat: number,
): void {
  const value = run(report, index);
  value.launchOrdinal = index + 1;
  value.profile = profile;
  value.profileLineage = {
    history: profile === "fresh" ? ["fresh"] : ["fresh", "warm"],
    id: `lineage-${repeat}`,
  };
  value.repeat = repeat;
}

function exactPsoSnapshot(): PsoWarmupTelemetrySnapshot {
  const identity = build.psoWarmupTrace;
  return {
    buildCompatibilityDigest: identity.buildCompatibilityDigest,
    cacheHitCount: 1,
    cacheMissCount: identity.entries.length,
    compiledCount: identity.entries.length,
    contract: "pso-warmup-telemetry@1",
    deferredCount: identity.entries.length,
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
    queueHighWater: identity.entries.length,
    releaseDigest: null,
    requestedCount: identity.entries.length + 1,
    schemaVersion: 1,
    source: "privileged-embedded",
    state: "ready",
    totalDurationMs: 2,
    traceEntryCount: identity.entries.length,
    traceSha256: identity.sha256,
  };
}
