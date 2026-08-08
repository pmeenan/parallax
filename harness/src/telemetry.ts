import {
  APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS,
  APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
  GAMEPLAY_INPUT_TELEMETRY_SCHEMA_VERSION,
  INSTALLED_MODEL_SOURCE_TELEMETRY_SCHEMA_VERSION,
  OFFLINE_SHELL_TELEMETRY_SCHEMA_VERSION,
  type ParallaxTelemetryExport,
  type ParallaxTelemetrySnapshot,
  SIMULATION_TELEMETRY_SCHEMA_VERSION,
  simulationSnapshotBufferBytes,
  TELEMETRY_GLOBAL_NAME,
} from "@parallax/engine";
import type { Page } from "playwright-core";
import { validateInstallerSnapshotTelemetry } from "./installer-transfer-telemetry.js";
import { validatePsoWarmupRenderTelemetryRelationship } from "./pso-warmup-telemetry.js";

export async function readTelemetry(page: Page): Promise<ParallaxTelemetrySnapshot> {
  const snapshot = await page.evaluate((globalName) => {
    const telemetry = Reflect.get(globalThis, globalName) as ParallaxTelemetryExport;
    return telemetry.snapshot();
  }, TELEMETRY_GLOBAL_NAME);
  validateInstallerSnapshotTelemetry(snapshot);
  validateInstalledModelSourceTelemetry(snapshot.installedModelSource);
  validateOfflineShellTelemetry(snapshot.offlineShell);
  validateSimulationTelemetry(snapshot.simulation);
  validateGameplayInputTelemetry(snapshot.gameplayInput);
  validatePsoWarmupRenderTelemetryRelationship(snapshot.render);
  validateInstallerTelemetrySelection(snapshot);
  return snapshot;
}

export function validateSimulationTelemetry(
  input: unknown,
): asserts input is ParallaxTelemetrySnapshot["simulation"] {
  const keys = [
    "appliedCommandCount",
    "droppedCatchUpTickCount",
    "emittedEventCount",
    "failureMessage",
    "gameCounters",
    "highestAcceptedCommandSequence",
    "latestStateHash",
    "loadCount",
    "queuedCommandCount",
    "queuedCommandCountHighWater",
    "rejectedCommandCount",
    "saveCount",
    "schedulerLagHighWaterMs",
    "schemaVersion",
    "snapshotCount",
    "snapshotEntityCapacity",
    "snapshotSharedBytes",
    "state",
    "stepDurationHighWaterMs",
    "tick",
    "timestepHz",
    "workerGeneration",
  ].sort();
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("simulation telemetry has an unsupported identity");
  }
  const telemetry = input as ParallaxTelemetrySnapshot["simulation"];
  if (
    JSON.stringify(Object.keys(telemetry).sort()) !== JSON.stringify(keys) ||
    telemetry.schemaVersion !== SIMULATION_TELEMETRY_SCHEMA_VERSION ||
    !["disposed", "failed", "idle", "running", "starting"].includes(telemetry.state)
  ) {
    throw new Error("simulation telemetry has an unsupported identity");
  }
  for (const counter of [
    telemetry.appliedCommandCount,
    telemetry.droppedCatchUpTickCount,
    telemetry.emittedEventCount,
    telemetry.loadCount,
    telemetry.queuedCommandCount,
    telemetry.queuedCommandCountHighWater,
    telemetry.rejectedCommandCount,
    telemetry.saveCount,
    telemetry.snapshotCount,
    telemetry.snapshotEntityCapacity,
    telemetry.snapshotSharedBytes,
    telemetry.tick,
    telemetry.timestepHz,
    telemetry.workerGeneration,
  ]) {
    if (!Number.isSafeInteger(counter) || counter < 0) {
      throw new Error("simulation telemetry has an invalid counter");
    }
  }
  if (
    !Number.isFinite(telemetry.schedulerLagHighWaterMs) ||
    telemetry.schedulerLagHighWaterMs < 0 ||
    !Number.isFinite(telemetry.stepDurationHighWaterMs) ||
    telemetry.stepDurationHighWaterMs < 0 ||
    !Number.isSafeInteger(telemetry.highestAcceptedCommandSequence) ||
    telemetry.highestAcceptedCommandSequence < -1 ||
    telemetry.queuedCommandCount > telemetry.queuedCommandCountHighWater ||
    (telemetry.snapshotEntityCapacity > 0 &&
      telemetry.snapshotSharedBytes !==
        simulationSnapshotBufferBytes(telemetry.snapshotEntityCapacity)) ||
    (telemetry.latestStateHash !== null && !/^[a-f0-9]{64}$/.test(telemetry.latestStateHash)) ||
    (telemetry.failureMessage !== null && telemetry.failureMessage === "") ||
    (telemetry.state === "failed") !== (telemetry.failureMessage !== null) ||
    (telemetry.state === "running" &&
      (telemetry.timestepHz === 0 ||
        telemetry.workerGeneration === 0 ||
        telemetry.snapshotEntityCapacity === 0 ||
        telemetry.snapshotSharedBytes === 0 ||
        telemetry.snapshotCount === 0 ||
        telemetry.latestStateHash === null))
  ) {
    throw new Error("simulation telemetry values are inconsistent");
  }
  if (
    typeof telemetry.gameCounters !== "object" ||
    telemetry.gameCounters === null ||
    Array.isArray(telemetry.gameCounters)
  ) {
    throw new Error("simulation telemetry has invalid game counters");
  }
  for (const [key, value] of Object.entries(telemetry.gameCounters)) {
    if (!/^[a-z][a-zA-Z0-9]*$/u.test(key) || !Number.isFinite(value) || value < 0) {
      throw new Error("simulation telemetry has invalid game counters");
    }
  }
}

export function validateGameplayInputTelemetry(
  input: unknown,
): asserts input is ParallaxTelemetrySnapshot["gameplayInput"] {
  const keys = [
    "emittedFrameCount",
    "failureMessage",
    "interactionPressCount",
    "pointerLockAcquisitionCount",
    "pointerLockFailureCount",
    "pointerLocked",
    "schemaVersion",
    "state",
  ].sort();
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("gameplay input telemetry has an unsupported identity");
  }
  const telemetry = input as ParallaxTelemetrySnapshot["gameplayInput"];
  if (
    JSON.stringify(Object.keys(telemetry).sort()) !== JSON.stringify(keys) ||
    telemetry.schemaVersion !== GAMEPLAY_INPUT_TELEMETRY_SCHEMA_VERSION ||
    !["disposed", "failed", "idle", "running"].includes(telemetry.state) ||
    (telemetry.state === "failed") !== (telemetry.failureMessage !== null) ||
    typeof telemetry.pointerLocked !== "boolean"
  ) {
    throw new Error("gameplay input telemetry has an unsupported identity");
  }
  for (const counter of [
    telemetry.emittedFrameCount,
    telemetry.interactionPressCount,
    telemetry.pointerLockAcquisitionCount,
    telemetry.pointerLockFailureCount,
  ]) {
    if (!Number.isSafeInteger(counter) || counter < 0) {
      throw new Error("gameplay input telemetry has an invalid counter");
    }
  }
}

export function validateOfflineShellTelemetry(
  input: unknown,
): asserts input is ParallaxTelemetrySnapshot["offlineShell"] {
  const keys = [
    "activateCount",
    "activeArtifactDigest",
    "activeGenerationId",
    "activeReleaseDigest",
    "cacheHitCount",
    "cacheMissCount",
    "candidateGenerationId",
    "failureCode",
    "failureCount",
    "failureMessage",
    "mixedGenerationCount",
    "prepareCount",
    "previousGenerationId",
    "rollbackCount",
    "schemaVersion",
    "state",
    "verifiedBytes",
    "verifyCount",
    "verifyDurationMs",
    "verifyHighWaterMs",
  ].sort();
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("offlineShell telemetry has an unsupported identity");
  }
  const telemetry = input as ParallaxTelemetrySnapshot["offlineShell"];
  if (
    JSON.stringify(Object.keys(telemetry).sort()) !== JSON.stringify(keys) ||
    telemetry.schemaVersion !== OFFLINE_SHELL_TELEMETRY_SCHEMA_VERSION ||
    !["active", "failed", "idle", "preparing", "rolling-back", "unavailable", "verifying"].includes(
      telemetry.state,
    )
  ) {
    throw new Error("offlineShell telemetry has an unsupported identity");
  }
  for (const counter of [
    telemetry.activateCount,
    telemetry.cacheHitCount,
    telemetry.cacheMissCount,
    telemetry.failureCount,
    telemetry.mixedGenerationCount,
    telemetry.prepareCount,
    telemetry.rollbackCount,
    telemetry.verifiedBytes,
    telemetry.verifyCount,
  ]) {
    if (!Number.isSafeInteger(counter) || counter < 0) {
      throw new Error("offlineShell telemetry has an invalid counter");
    }
  }
  if (
    !Number.isFinite(telemetry.verifyDurationMs) ||
    telemetry.verifyDurationMs < 0 ||
    !Number.isFinite(telemetry.verifyHighWaterMs) ||
    telemetry.verifyHighWaterMs < 0 ||
    telemetry.verifyHighWaterMs > telemetry.verifyDurationMs ||
    (telemetry.verifyCount === 0 &&
      (telemetry.verifiedBytes !== 0 ||
        telemetry.verifyDurationMs !== 0 ||
        telemetry.verifyHighWaterMs !== 0))
  ) {
    throw new Error("offlineShell telemetry has invalid verification timing");
  }
  const digest = (value: string | null): boolean => value === null || /^[a-f0-9]{64}$/.test(value);
  const generation = (value: string | null): boolean =>
    value === null || /^[a-f0-9]{64}:[a-f0-9]{64}$/.test(value);
  if (
    !digest(telemetry.activeArtifactDigest) ||
    !digest(telemetry.activeReleaseDigest) ||
    !generation(telemetry.activeGenerationId) ||
    !generation(telemetry.candidateGenerationId) ||
    !generation(telemetry.previousGenerationId) ||
    (telemetry.failureCode === null) !== (telemetry.failureMessage === null) ||
    (telemetry.state === "failed") !== (telemetry.failureCode !== null) ||
    (telemetry.activeGenerationId === null) !== (telemetry.activeArtifactDigest === null) ||
    (telemetry.activeGenerationId === null) !== (telemetry.activeReleaseDigest === null)
  ) {
    throw new Error("offlineShell telemetry state is inconsistent");
  }
}

export function validateInstalledModelSourceTelemetry(
  input: unknown,
): asserts input is ParallaxTelemetrySnapshot["installedModelSource"] {
  const keys = [
    "expectedArtifactBytes",
    "expectedArtifactCount",
    "failureMessage",
    "networkFallbackCount",
    "releaseDigest",
    "resolvedArtifactBytes",
    "resolvedArtifactCount",
    "schemaVersion",
    "state",
  ].sort();
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("installedModelSource telemetry has unsupported or missing keys");
  }
  const telemetry = input as ParallaxTelemetrySnapshot["installedModelSource"];
  if (JSON.stringify(Object.keys(telemetry).sort()) !== JSON.stringify(keys)) {
    throw new Error("installedModelSource telemetry has unsupported or missing keys");
  }
  if (
    telemetry.schemaVersion !== INSTALLED_MODEL_SOURCE_TELEMETRY_SCHEMA_VERSION ||
    telemetry.expectedArtifactCount !== APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.length ||
    telemetry.expectedArtifactBytes !== APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES ||
    telemetry.networkFallbackCount !== 0 ||
    !["idle", "resolving", "ready", "failed", "unavailable"].includes(telemetry.state)
  ) {
    throw new Error("installedModelSource telemetry has an unsupported identity");
  }
  const releaseDigestValid =
    telemetry.releaseDigest === null || /^[a-f0-9]{64}$/.test(telemetry.releaseDigest);
  if (
    !releaseDigestValid ||
    !Number.isSafeInteger(telemetry.resolvedArtifactBytes) ||
    telemetry.resolvedArtifactBytes < 0 ||
    !Number.isSafeInteger(telemetry.resolvedArtifactCount) ||
    telemetry.resolvedArtifactCount < 0 ||
    (telemetry.failureMessage !== null &&
      (typeof telemetry.failureMessage !== "string" || telemetry.failureMessage === ""))
  ) {
    throw new Error("installedModelSource telemetry has malformed values");
  }
  if (
    (telemetry.state === "unavailable" &&
      (telemetry.releaseDigest !== null ||
        telemetry.resolvedArtifactBytes !== 0 ||
        telemetry.resolvedArtifactCount !== 0 ||
        telemetry.failureMessage !== null)) ||
    (telemetry.state !== "unavailable" && telemetry.releaseDigest === null) ||
    (telemetry.state === "failed") !== (telemetry.failureMessage !== null) ||
    (telemetry.state === "ready" &&
      (telemetry.resolvedArtifactBytes !== telemetry.expectedArtifactBytes ||
        telemetry.resolvedArtifactCount !== telemetry.expectedArtifactCount)) ||
    (telemetry.state !== "ready" &&
      (telemetry.resolvedArtifactBytes !== 0 || telemetry.resolvedArtifactCount !== 0))
  ) {
    throw new Error("installedModelSource telemetry state is inconsistent");
  }
}

export function validateInstallerTelemetrySelection(
  snapshot: Pick<ParallaxTelemetrySnapshot, "installStore" | "installerTransfer">,
): void {
  if (
    snapshot.installerTransfer.state === "ready" &&
    (snapshot.installerTransfer.activeReleaseDigest === null ||
      snapshot.installStore.activeReleaseDigest !== snapshot.installerTransfer.activeReleaseDigest)
  ) {
    throw new Error(
      "installerTransfer ready telemetry requires the exact active installStore selection",
    );
  }
}
