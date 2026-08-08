import {
  APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS,
  APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
  createInstalledModelSource,
  createSimulationService,
  idleInstallerTransferTelemetrySnapshot,
  unavailableInstallStoreTelemetrySnapshot,
  unavailableOfflineShellTelemetrySnapshot,
} from "@parallax/engine";
import { describe, expect, it } from "vitest";
import {
  validateInstalledModelSourceTelemetry,
  validateInstallerTelemetrySelection,
  validateOfflineShellTelemetry,
  validateSimulationTelemetry,
} from "./telemetry.js";

describe("simulation public telemetry", () => {
  it("rejects primitive and array game-counter containers", () => {
    const snapshot = createSimulationService().snapshot();
    for (const gameCounters of [42, true, "counter", [], null]) {
      expect(() => validateSimulationTelemetry({ ...snapshot, gameCounters })).toThrow(
        /invalid game counters/,
      );
    }
  });
});

describe("offline-shell public telemetry", () => {
  it("rejects non-object input without a caller-side assertion", () => {
    expect(() => validateOfflineShellTelemetry("not telemetry")).toThrow(/unsupported identity/);
  });

  it("requires telemetry v2 verification bytes and timing relationships", () => {
    const unavailable = unavailableOfflineShellTelemetrySnapshot();
    expect(() => validateOfflineShellTelemetry(unavailable)).not.toThrow();
    expect(() =>
      validateOfflineShellTelemetry({
        ...unavailable,
        mixedGenerationCount: 1,
        verifiedBytes: 10,
        verifyCount: 1,
        verifyDurationMs: 2,
        verifyHighWaterMs: 2,
      }),
    ).not.toThrow();
    expect(() =>
      validateOfflineShellTelemetry({
        ...unavailable,
        verifyDurationMs: 1,
        verifyHighWaterMs: 2,
      }),
    ).toThrow(/verification timing/);
    expect(() =>
      validateOfflineShellTelemetry({
        ...unavailable,
        verifiedBytes: 0.5,
      }),
    ).toThrow(/invalid counter/);
  });
});

describe("public installer telemetry relationship", () => {
  it("requires terminal ready to name the exact active store selection", () => {
    const digest = "a".repeat(64);
    const installStore = {
      ...unavailableInstallStoreTelemetrySnapshot(),
      activeReleaseDigest: digest,
      state: "idle" as const,
    };
    const installerTransfer = {
      ...idleInstallerTransferTelemetrySnapshot(),
      activeReleaseDigest: digest,
      state: "ready" as const,
    };

    expect(() =>
      validateInstallerTelemetrySelection({ installStore, installerTransfer }),
    ).not.toThrow();
    expect(() =>
      validateInstallerTelemetrySelection({
        installStore: { ...installStore, activeReleaseDigest: "b".repeat(64) },
        installerTransfer,
      }),
    ).toThrow(/exact active/);
    expect(() =>
      validateInstallerTelemetrySelection({
        installStore,
        installerTransfer: { ...installerTransfer, activeReleaseDigest: null },
      }),
    ).toThrow(/exact active/);
  });
});

describe("installed model-source public telemetry", () => {
  it("rejects non-object input without a caller-side assertion", () => {
    expect(() => validateInstalledModelSourceTelemetry(null)).toThrow(
      /unsupported or missing keys/,
    );
  });

  it("accepts unavailable privileged mode and exact ordinary ready identity", () => {
    expect(() =>
      validateInstalledModelSourceTelemetry(createInstalledModelSource(null).snapshot()),
    ).not.toThrow();
    const ready = {
      expectedArtifactBytes: APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
      expectedArtifactCount: APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.length,
      failureMessage: null,
      networkFallbackCount: 0 as const,
      releaseDigest: "a".repeat(64),
      resolvedArtifactBytes: APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
      resolvedArtifactCount: APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.length,
      schemaVersion: 1 as const,
      state: "ready" as const,
    };
    expect(() => validateInstalledModelSourceTelemetry(ready)).not.toThrow();
    expect(() =>
      validateInstalledModelSourceTelemetry({ ...ready, networkFallbackCount: 1 } as never),
    ).toThrow(/unsupported identity/);
    expect(() =>
      validateInstalledModelSourceTelemetry({ ...ready, resolvedArtifactCount: 4 }),
    ).toThrow(/state is inconsistent/);
    expect(() => validateInstalledModelSourceTelemetry({ ...ready, extra: true } as never)).toThrow(
      /unsupported or missing keys/,
    );
  });
});
