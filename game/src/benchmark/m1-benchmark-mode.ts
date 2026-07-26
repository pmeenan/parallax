import type {
  BenchmarkDefinition,
  BenchmarkMetric,
  BenchmarkQualityPreset,
  BenchmarkReport,
  BenchmarkTelemetrySnapshot,
} from "@parallax/engine";
import { DISTRICT_1_GREYBOX_SPEC } from "../world/district-1.data";
import { DISTRICT_1_FLYTHROUGH } from "../world/district-1.flythrough";

export interface M1BenchmarkUiCopy {
  readonly actionFailed: string;
  readonly copyFailed: string;
  readonly copySucceeded: string;
  readonly copySummary: string;
  readonly downloadJson: string;
  readonly downloadText: string;
  readonly idleStatus: string;
  readonly presetLabel: string;
  readonly progressLabel: string;
  readonly resultDetails: string;
  readonly runAgain: string;
  readonly start: string;
  readonly summary: string;
  readonly title: string;
  readonly waitingStatus: string;
}

const STANDARD_PRESET = Object.freeze({
  expectedReferenceMachineId: null,
  id: "standard-1440p120@1",
  qualityVersion: "m1-greybox-fixed@1",
  renderSize: Object.freeze({ height: 1_440, width: 2_560 }),
  targetRefreshRateHz: 120,
  tier: "standard",
}) satisfies BenchmarkQualityPreset;

const SHOWCASE_PRESET = Object.freeze({
  expectedReferenceMachineId: "dev-01",
  id: "showcase-4k60@1",
  qualityVersion: "m1-greybox-fixed@1",
  renderSize: Object.freeze({ height: 2_160, width: 3_840 }),
  targetRefreshRateHz: 60,
  tier: "showcase",
}) satisfies BenchmarkQualityPreset;

export const M1_BENCHMARK_DEFINITION = Object.freeze({
  id: "m1-benchmark@1",
  qualityPresets: Object.freeze([SHOWCASE_PRESET, STANDARD_PRESET]),
  repeatCount: 3,
  scenario: DISTRICT_1_FLYTHROUGH,
  worldSeed: DISTRICT_1_GREYBOX_SPEC.generator.seed,
}) satisfies BenchmarkDefinition;

export const M1_BENCHMARK_UI_COPY = Object.freeze({
  actionFailed: "Benchmark action failed",
  copyFailed: "Copy failed",
  copySucceeded: "Benchmark report copied to the clipboard.",
  copySummary: "Copy summary",
  downloadJson: "Download JSON",
  downloadText: "Download report",
  idleStatus: "Ready for three measured ten-minute repeats.",
  presetLabel: "Fixed benchmark preset",
  progressLabel: "Benchmark progress",
  resultDetails: "Result details",
  runAgain: "Run benchmark again",
  start: "Run M1 benchmark",
  summary:
    "Runs the canonical D1 route three times. Each repeat performs six rendered checkpoint warm-ups and a fixed ten-second stabilization before measurement.",
  title: "M1 Benchmark",
  waitingStatus: "Waiting for render, streaming, and WASM-thread readiness.",
}) satisfies M1BenchmarkUiCopy;

export function formatM1BenchmarkReport(report: BenchmarkReport): string {
  const attemptLines = report.attempts.map((attempt) => {
    const render = attempt.flythrough?.render;
    const streaming = metricText(attempt.metrics.streamingCellLoadP95Ms, " ms");
    const longTasks = metricText(attempt.metrics.mainThreadLongTasksOver50Ms, "");
    return attempt.state === "measured" && render !== null && render !== undefined
      ? `- Repeat ${attempt.repeat}: ${render.frameCount.toLocaleString("en-US")} frames; callback p95 ${render.callbackIntervalMs.p95.toFixed(3)} ms; render p95 ${render.renderDurationMs.p95.toFixed(3)} ms; streaming p95 ${streaming}; main-thread long tasks ${longTasks}.`
      : `- Repeat ${attempt.repeat}: invalid — ${attempt.failureMessage ?? "unknown failure"}.`;
  });
  const unsupported = Object.entries(report.metricStates)
    .filter(([, state]) => state === "unsupported")
    .map(([metric]) => `- ${metric}: unsupported`);
  const reasons =
    report.verdict.reasons.length === 0
      ? ["- None"]
      : report.verdict.reasons.map((reason) => `- ${reason}`);
  const checks = report.checks.map((check) => {
    const outcome =
      check.state === "measured" ? (check.passed === true ? "passed" : "failed") : check.state;
    const actual = check.actual === null ? "unavailable" : check.actual.toFixed(6);
    return `- ${check.metric}: **${outcome}** (actual ${actual}; limit ${check.limit})`;
  });
  const facetFailures = Object.entries(report.facets).flatMap(([name, facet]) =>
    facet.reasons.map((reason) => `- ${name}: ${reason}`),
  );
  return `${[
    `# ${report.definitionId}`,
    "",
    `- Verdict: **${report.verdict.label}**`,
    `- Result contract: \`${report.resultContract}\` schema ${report.schemaVersion}`,
    `- Scenario: \`${report.scenario}\``,
    `- Preset: \`${report.preset.id}\` (${report.preset.renderSize.width}×${report.preset.renderSize.height} @ ${report.preset.targetRefreshRateHz} Hz target)`,
    `- World seed: \`0x${report.worldSeed.toString(16)}\``,
    `- Artifact: ${metricText(report.artifactDigest, "")}`,
    `- Generated: ${report.generatedAt}`,
    `- Measurement owner: ${report.provenance.measurementOwner}; launcher timings: ${report.provenance.launcherCollectorTimings}`,
    `- Repeats: ${report.attempts.filter((attempt) => attempt.state === "measured").length}/${report.repeatPolicy.count} (${report.repeatPolicy.lineage})`,
    `- Environment captures: ${report.environmentCaptures.length}`,
    `- Environment comparison: \`${report.environmentComparisonPolicy.id}\`; recorded diagnostic excluded from equality: \`${report.environmentComparisonPolicy.excludedRecordedFields.join("`, `")}\``,
    `- Warm-up: ${report.warmupPolicy.checkpointCount} checkpoints + ${report.warmupPolicy.stabilizationMs} ms stabilization per repeat`,
    "",
    "## Repeats",
    "",
    ...(attemptLines.length === 0 ? ["- None started"] : attemptLines),
    "",
    "## Facets",
    "",
    `- Scenario evidence: **${report.facets.scenarioEvidence.status}**`,
    `- Reference eligibility: **${report.facets.referenceEligibility.status}**`,
    `- Budget evaluation: **${report.facets.budgetEvaluation.status}**`,
    "",
    "## Checks",
    "",
    ...(checks.length === 0 ? ["- None evaluated"] : checks),
    "",
    "## Evidence failures and exclusions",
    "",
    ...(facetFailures.length === 0 ? ["- None"] : facetFailures),
    "",
    "## Explicitly unavailable metrics",
    "",
    ...(unsupported.length === 0 ? ["- None"] : unsupported),
    "",
    "## Verdict reasons",
    "",
    ...reasons,
    "",
  ].join("\n")}\n`;
}

export function formatM1BenchmarkStatus(snapshot: BenchmarkTelemetrySnapshot): string {
  if (snapshot.state === "idle") return M1_BENCHMARK_UI_COPY.idleStatus;
  if (snapshot.state === "completed" && snapshot.report !== null) {
    return `${snapshot.report.verdict.label}. ${snapshot.completedRepeats}/${snapshot.report.repeatPolicy.count} repeats completed.`;
  }
  if (snapshot.state === "failed") {
    const verdict = snapshot.report?.verdict.label ?? "Benchmark failed";
    return `${verdict}: ${snapshot.failureMessage ?? "unknown failure"}`;
  }
  const repeat = snapshot.activeRepeat === null ? "" : ` Repeat ${snapshot.activeRepeat}/3.`;
  return `${snapshot.state.replace("-", " ")}.${repeat} ${(snapshot.progress * 100).toFixed(1)}%.`;
}

export function formatM1BenchmarkPreset(preset: BenchmarkQualityPreset): string {
  const tier = preset.tier === "showcase" ? "Showcase" : "Standard";
  return `${tier} · ${preset.renderSize.width}×${preset.renderSize.height} · ${preset.targetRefreshRateHz} Hz target`;
}

function metricText(metric: BenchmarkMetric<number | string>, suffix: string): string {
  if (metric.state !== "measured") return `${metric.state} (${metric.reason})`;
  return typeof metric.value === "number"
    ? `${metric.value.toFixed(3)}${suffix}`
    : `\`${metric.value}\``;
}
