import {
  APP_OWNED_LLM_MODEL_ARTIFACTS,
  APP_OWNED_LLM_MODEL_DTYPE,
  APP_OWNED_LLM_MODEL_ID,
  APP_OWNED_LLM_MODEL_INSTALL_BYTES,
  APP_OWNED_LLM_MODEL_REVISION,
  APP_OWNED_LLM_SPIKE_TELEMETRY_SCHEMA_VERSION,
  APP_OWNED_LLM_WASM_MODEL_ARTIFACTS,
  APP_OWNED_LLM_WASM_MODEL_DTYPE,
  APP_OWNED_LLM_WASM_MODEL_ID,
  APP_OWNED_LLM_WASM_MODEL_INSTALL_BYTES,
  APP_OWNED_LLM_WASM_MODEL_REVISION,
  type AppOwnedLlmSpikeTelemetrySnapshot,
  type RenderFrameSample,
} from "@parallax/engine";
import { describe, expect, it } from "vitest";
import {
  APP_OWNED_LLM_SPIKE_SCENARIO,
  evaluateAppOwnedLlmRun,
  evaluateAppOwnedLlmRunPass,
  waitForAppOwnedLlmCompletion,
} from "./app-owned-llm-spike.js";

describe("app-owned-llm-spike@1 contract", () => {
  it("requires a full 20-sample warm TTFT distribution and exact OPFS byte evidence", () => {
    const cold = telemetry(
      "remote-install",
      APP_OWNED_LLM_MODEL_ARTIFACTS.length,
      0,
      APP_OWNED_LLM_MODEL_INSTALL_BYTES,
      0,
    );
    const warm = telemetry(
      "opfs",
      0,
      APP_OWNED_LLM_MODEL_ARTIFACTS.length,
      0,
      APP_OWNED_LLM_MODEL_INSTALL_BYTES,
    );
    const metrics = evaluateAppOwnedLlmRun({ cold, generationFrames: frames(30), warm });

    expect(APP_OWNED_LLM_SPIKE_SCENARIO).toBe("app-owned-llm-spike@1");
    expect(metrics.ttft).toMatchObject({ state: "measured", value: { p95: 1_400 } });
    expect(metrics.warmOpfs.state).toBe("measured");
    expect(metrics.coldInstall.state).toBe("measured");
    expect(
      evaluateAppOwnedLlmRunPass({
        environmentMeasured: true,
        errors: [],
        metrics,
        telemetryCompleted: true,
      }),
    ).toBe(true);
  });

  it("fails closed for a missing TTFT sample or a p95 over the fixed 1500 ms limit", () => {
    const cold = telemetry(
      "remote-install",
      APP_OWNED_LLM_MODEL_ARTIFACTS.length,
      0,
      APP_OWNED_LLM_MODEL_INSTALL_BYTES,
      0,
    );
    const warmForShort = telemetry(
      "opfs",
      0,
      APP_OWNED_LLM_MODEL_ARTIFACTS.length,
      0,
      APP_OWNED_LLM_MODEL_INSTALL_BYTES,
    );
    const shortWarm = { ...warmForShort, generations: warmForShort.generations.slice(1) };
    expect(
      evaluateAppOwnedLlmRun({ cold, generationFrames: frames(30), warm: shortWarm }).ttft.state,
    ).toBe("invalid");

    const warmForSlow = telemetry(
      "opfs",
      0,
      APP_OWNED_LLM_MODEL_ARTIFACTS.length,
      0,
      APP_OWNED_LLM_MODEL_INSTALL_BYTES,
    );
    const slowWarm = {
      ...warmForSlow,
      generations: warmForSlow.generations.map((generation, index) =>
        index >= 18 ? { ...generation, firstTokenLatencyMs: 1_501 } : generation,
      ),
    };
    const metrics = evaluateAppOwnedLlmRun({ cold, generationFrames: frames(30), warm: slowWarm });
    expect(metrics.budgetChecks[0]).toMatchObject({ passed: false });
  });

  it("stops on terminal failure rather than treating absent telemetry as a pass", async () => {
    const failed = {
      ...telemetry(
        "opfs",
        0,
        APP_OWNED_LLM_MODEL_ARTIFACTS.length,
        0,
        APP_OWNED_LLM_MODEL_INSTALL_BYTES,
      ),
      failureMessage: "model failed",
      state: "failed" as const,
    };
    const result = await waitForAppOwnedLlmCompletion(async () => failed);
    expect(result.failureMessage).toBe("model failed");
  });

  it("fast-fails a model load that makes no forward progress", async () => {
    let clock = 0;
    let reads = 0;
    const loading = {
      ...telemetry(
        "opfs",
        0,
        APP_OWNED_LLM_MODEL_ARTIFACTS.length,
        0,
        APP_OWNED_LLM_MODEL_INSTALL_BYTES,
      ),
      progress: 0.25,
      state: "loading-model" as const,
    };
    const result = await waitForAppOwnedLlmCompletion(
      async () => {
        reads += 1;
        return loading;
      },
      {
        completionTimeoutMs: 10_000,
        loadStallTimeoutMs: 2_000,
        now: () => clock,
        pollIntervalMs: 1_000,
        sleep: async (delayMs) => {
          clock += delayMs;
        },
      },
    );

    expect(reads).toBe(3);
    expect(result.loadStalled).toBe(true);
    expect(result.failureMessage).toContain("model load made no forward progress for 2000 ms");
    expect(result.failureMessage).toContain("last observed progress 0.2500");
  });

  it("resets the model-load stall clock only when progress advances", async () => {
    let clock = 0;
    let index = 0;
    const base = telemetry(
      "opfs",
      0,
      APP_OWNED_LLM_MODEL_ARTIFACTS.length,
      0,
      APP_OWNED_LLM_MODEL_INSTALL_BYTES,
    );
    const snapshots = [
      { ...base, progress: 0, state: "loading-model" as const },
      { ...base, progress: 0.25, state: "loading-model" as const },
      { ...base, progress: 0.25, state: "loading-model" as const },
      { ...base, progress: 0.5, state: "loading-model" as const },
      { ...base, progress: 1, state: "warming-up" as const },
      { ...base, progress: 1, state: "completed" as const },
    ];
    const result = await waitForAppOwnedLlmCompletion(
      async () => {
        const snapshot = snapshots[Math.min(index++, snapshots.length - 1)];
        if (snapshot === undefined) throw new Error("Model-load snapshot fixture is empty");
        return snapshot;
      },
      {
        completionTimeoutMs: 10_000,
        loadStallTimeoutMs: 2_000,
        now: () => clock,
        pollIntervalMs: 1_000,
        sleep: async (delayMs) => {
          clock += delayMs;
        },
      },
    );

    expect(result.failureMessage).toBeNull();
    expect(result.loadStalled).toBe(false);
    expect(result.snapshot.state).toBe("completed");
  });

  it("retains completed cache evidence when a later generation fails", () => {
    const cold = {
      ...telemetry(
        "remote-install",
        APP_OWNED_LLM_MODEL_ARTIFACTS.length,
        0,
        APP_OWNED_LLM_MODEL_INSTALL_BYTES,
        0,
      ),
      failureMessage: "later generation failed",
      state: "failed" as const,
    };
    const warm = {
      ...telemetry(
        "opfs",
        0,
        APP_OWNED_LLM_MODEL_ARTIFACTS.length,
        0,
        APP_OWNED_LLM_MODEL_INSTALL_BYTES,
      ),
      failureMessage: "later generation failed",
      state: "failed" as const,
    };
    const metrics = evaluateAppOwnedLlmRun({ cold, generationFrames: frames(30), warm });

    expect(metrics.coldInstall.state).toBe("measured");
    expect(metrics.warmOpfs.state).toBe("measured");
  });

  it("validates the independently pinned WASM model identity and cache bytes", () => {
    const cold = wasmTelemetry("remote-install");
    const warm = wasmTelemetry("opfs");
    const metrics = evaluateAppOwnedLlmRun({ cold, generationFrames: frames(30), warm });

    expect(metrics.modelIdentity).toMatchObject({
      state: "measured",
      value: {
        artifacts: APP_OWNED_LLM_WASM_MODEL_ARTIFACTS.length,
        bytes: APP_OWNED_LLM_WASM_MODEL_INSTALL_BYTES,
      },
    });
    expect(metrics.coldInstall.state).toBe("measured");
    expect(metrics.warmOpfs.state).toBe("measured");
  });
});

function wasmTelemetry(loadSource: "opfs" | "remote-install"): AppOwnedLlmSpikeTelemetrySnapshot {
  const expectedArtifacts = APP_OWNED_LLM_WASM_MODEL_ARTIFACTS.length;
  return {
    ...telemetry(
      loadSource,
      loadSource === "remote-install" ? expectedArtifacts : 0,
      loadSource === "opfs" ? expectedArtifacts : 0,
      loadSource === "remote-install" ? APP_OWNED_LLM_WASM_MODEL_INSTALL_BYTES : 0,
      loadSource === "opfs" ? APP_OWNED_LLM_WASM_MODEL_INSTALL_BYTES : 0,
    ),
    cache: {
      expectedArtifacts,
      hitArtifacts: loadSource === "opfs" ? expectedArtifacts : 0,
      integrityFailures: 0,
      missArtifacts: loadSource === "remote-install" ? expectedArtifacts : 0,
      readBytes: loadSource === "opfs" ? APP_OWNED_LLM_WASM_MODEL_INSTALL_BYTES : 0,
      readElapsedMs: 1,
      verifiedArtifacts: expectedArtifacts,
      writeBytes: loadSource === "remote-install" ? APP_OWNED_LLM_WASM_MODEL_INSTALL_BYTES : 0,
      writeElapsedMs: 1,
    },
    deviceTopology: {
      inferenceDevice: "dedicated-worker-wasm-cpu",
      renderDevice: "render-worker-own-device",
      sharedDevice: { reason: "unsupported", state: "unsupported" },
    },
    modelDtype: APP_OWNED_LLM_WASM_MODEL_DTYPE,
    modelId: APP_OWNED_LLM_WASM_MODEL_ID,
    modelInstallBytes: APP_OWNED_LLM_WASM_MODEL_INSTALL_BYTES,
    modelRevision: APP_OWNED_LLM_WASM_MODEL_REVISION,
  };
}

function telemetry(
  loadSource: "opfs" | "remote-install",
  misses: number,
  hits: number,
  writeBytes: number,
  readBytes: number,
): AppOwnedLlmSpikeTelemetrySnapshot {
  const generations = Array.from({ length: 20 }, (_, repetition) =>
    generation("gate-watch-latency", "latency", repetition, 1_400),
  );
  generations.push(generation("retrieved-fact-grounding", "context", 0, 100));
  for (let repetition = 0; repetition < 5; repetition += 1)
    generations.push({
      ...generation("state-intent-json", "structured", repetition, 100),
      schemaValid: true,
    });
  generations.push(generation("context-short", "context", 0, 100, 10));
  generations.push(generation("context-medium", "context", 0, 100, 20));
  generations.push(generation("context-large", "context", 0, 100, 30));
  generations.push(generation("quality-conversation", "quality", 0, 100));
  return {
    activeFixtureId: null,
    cache: {
      expectedArtifacts: APP_OWNED_LLM_MODEL_ARTIFACTS.length,
      hitArtifacts: hits,
      integrityFailures: 0,
      missArtifacts: misses,
      readBytes,
      readElapsedMs: 1,
      verifiedArtifacts: APP_OWNED_LLM_MODEL_ARTIFACTS.length,
      writeBytes,
      writeElapsedMs: 1,
    },
    deviceTopology: {
      inferenceDevice: "dedicated-worker-own-webgpu-device",
      renderDevice: "render-worker-own-device",
      sharedDevice: { reason: "unsupported", state: "unsupported" },
    },
    failureMessage: null,
    fixtureSetId: "test",
    generations,
    loadElapsedMs: 1,
    loadSource,
    modelDtype: APP_OWNED_LLM_MODEL_DTYPE,
    modelId: APP_OWNED_LLM_MODEL_ID,
    modelInstallBytes: APP_OWNED_LLM_MODEL_INSTALL_BYTES,
    modelRevision: APP_OWNED_LLM_MODEL_REVISION,
    progress: 1,
    runtime: "transformers.js-onnx-runtime",
    schemaVersion: APP_OWNED_LLM_SPIKE_TELEMETRY_SCHEMA_VERSION,
    state: "completed",
    warmupElapsedMs: 1,
  };
}

function generation(
  fixtureId: string,
  kind: "context" | "latency" | "quality" | "structured",
  repetition: number,
  firstTokenLatencyMs: number,
  inputTokens = 5,
): AppOwnedLlmSpikeTelemetrySnapshot["generations"][number] {
  return {
    firstTokenLatencyMs,
    fixtureId,
    inputTokens,
    kind,
    longestTokenGapMs: 1,
    output: "closed",
    outputTokens: 2,
    repetition,
    schemaValid: null,
    semanticValidationFailures: [],
    tokensPerSecond: 10,
    totalLatencyMs: firstTokenLatencyMs + 10,
  };
}

function frames(count: number): RenderFrameSample[] {
  return Array.from({ length: count }, () => ({
    durationMs: 16,
    lightingIntensity: 1,
    lightingPhase: 0.25,
    presentIntervalMs: 16,
  }));
}
