import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("D-025 in-game benchmark ownership", () => {
  it("keeps browser-driver APIs out of the benchmark measurement implementation", async () => {
    const sources = await Promise.all(
      [
        "engine/src/benchmark/benchmark-environment.ts",
        "engine/src/benchmark/benchmark-service.ts",
        "game/src/benchmark/m1-benchmark-mode.ts",
      ].map((path) => readFile(resolve(path), "utf8")),
    );
    const combined = sources.join("\n").toLowerCase();

    for (const forbidden of [
      "cdpsession",
      "page.evaluate",
      "playwright",
      "puppeteer",
      "tracing.start",
      "webdriver",
    ]) {
      expect(combined, `unexpected external-driver ownership token: ${forbidden}`).not.toContain(
        forbidden,
      );
    }
    expect(combined).toContain('measurementowner: "in-game"');
    expect(combined).toContain('launchercollectortimings: "not-applicable"');
  });

  it("exposes automation through the same public start and result methods used by the UI", async () => {
    const [app, telemetry] = await Promise.all([
      readFile(resolve("app/src/runtime.ts"), "utf8"),
      readFile(resolve("engine/src/telemetry/telemetry-export.ts"), "utf8"),
    ]);

    expect(app).toContain("telemetryExport.startBenchmark()");
    expect(app).toContain("performBenchmarkUiAction(async () =>");
    expect(app).toContain("performBenchmarkUiAction(() =>");
    expect(app).toContain("telemetryExport.benchmarkResultJson()");
    expect(telemetry).toContain("startBenchmark(): void");
    expect(telemetry).toContain("benchmarkResultJson(): string | null");
    expect(telemetry).toContain("assertBenchmarkDoesNotOwnScenario");
    expect(app).toContain("await navigator.clipboard.writeText(contents)");
    expect(app).toContain("M1_BENCHMARK_UI_COPY.copySucceeded");
    expect(app).toContain("M1_BENCHMARK_UI_COPY.copyFailed");
  });
});
