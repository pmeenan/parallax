import { describe, expect, it } from "vitest";
import { runAssetUpdateV8ProfileSequence } from "./asset-update-v8-orchestration.js";

describe("asset-update V8 persistent-profile orchestration", () => {
  it("runs the exact lifecycle and starts post-warm navigation only after update Ready", async () => {
    const phases: string[] = [];
    let resolveUpdate: (value: "updated") => void = () => {
      throw new Error("Synthetic update resolver was not initialized");
    };
    const updateReady = new Promise<"updated">((resolve) => {
      resolveUpdate = resolve;
    });
    const running = runAssetUpdateV8ProfileSequence({
      initialInstall: async () => {
        phases.push("initial-install");
        return "initial" as const;
      },
      freshLaunch: async () => {
        phases.push("fresh-runtime-launch");
        return "fresh" as const;
      },
      postDiagnosticLaunch: async () => {
        phases.push("post-diagnostic-navigation");
        return "post-diagnostic" as const;
      },
      postWarmLaunch: async () => {
        phases.push("post-warm-navigation");
        return "post" as const;
      },
      preDiagnosticLaunch: async () => {
        phases.push("pre-diagnostic-navigation");
        return "pre-diagnostic" as const;
      },
      preWarmLaunch: async () => {
        phases.push("pre-warm-navigation");
        return "pre" as const;
      },
      produceLaunch: async () => {
        phases.push("produce-navigation");
        return "produce" as const;
      },
      publishAssetUpdate: async () => {
        phases.push("asset-update-published");
        return "published" as const;
      },
      updateReady: async () => {
        phases.push("update-started");
        const value = await updateReady;
        phases.push("update-ready");
        return value;
      },
    });

    await waitFor(() => phases.includes("update-started"));
    expect(phases).toEqual([
      "initial-install",
      "fresh-runtime-launch",
      "produce-navigation",
      "pre-diagnostic-navigation",
      "pre-warm-navigation",
      "asset-update-published",
      "update-started",
    ]);
    resolveUpdate("updated");
    const result = await running;

    expect(phases).toEqual([
      "initial-install",
      "fresh-runtime-launch",
      "produce-navigation",
      "pre-diagnostic-navigation",
      "pre-warm-navigation",
      "asset-update-published",
      "update-started",
      "update-ready",
      "post-warm-navigation",
      "post-diagnostic-navigation",
    ]);
    expect(result).toEqual({
      fresh: "fresh",
      initial: "initial",
      post: "post",
      postDiagnostic: "post-diagnostic",
      pre: "pre",
      preDiagnostic: "pre-diagnostic",
      produce: "produce",
      published: "published",
      update: "updated",
    });
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Synthetic asset-update sequence did not reach its update boundary");
}
