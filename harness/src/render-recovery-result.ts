import {
  STREAMING_DECODE_WORKER_MAXIMUM,
  STREAMING_DECODE_WORKER_RESERVED_THREADS,
} from "@parallax/engine";
import { requireGreyboxRenderedOutputEvidence } from "./greybox-rendered-output.js";
import type { MeasuredRenderRecoveryAttempt } from "./render-recovery-evidence.js";
import { validateRenderRecoveryAttempt } from "./render-recovery-evidence.js";
import {
  RENDER_RECOVERY_ATTEMPTS,
  RENDER_RECOVERY_COMPLETION_TIMEOUT_MS,
  RENDER_RECOVERY_MANDATORY_METRIC_SET_VERSION,
  RENDER_RECOVERY_MANDATORY_METRICS,
  RENDER_RECOVERY_REPORT_SCHEMA_VERSION,
  RENDER_RECOVERY_RESIDENT_CELL_COUNT,
  RENDER_RECOVERY_SCENARIO,
  RENDER_RECOVERY_TELEMETRY_SCHEMA_VERSION,
} from "./runs/render-recovery.js";
import { QUALITY_TIER_PROFILES } from "./runs/smoke.js";
import { requireSabRingBufferCompleteAtMeasurementBoundary } from "./sab-ring-buffer.js";
import { requireWorldStreamingSnapshot } from "./streaming-evidence.js";
import { isRecord } from "./value-utils.js";

const HEX_40 = /^[a-f0-9]{40}$/;
const HEX_64 = /^[a-f0-9]{64}$/;

export function validateRenderRecoveryReportContract(value: unknown): void {
  const report = requireRecord(value, "report");
  requireExactKeys(
    report,
    [
      "artifactDigest",
      "attempts",
      "chromePin",
      "environment",
      "facets",
      "generatedAt",
      "harnessRuntime",
      "mandatoryMetricSet",
      "passed",
      "runFailure",
      "scenario",
      "schemaVersion",
      "source",
    ],
    "report",
  );
  if (
    report.scenario !== RENDER_RECOVERY_SCENARIO ||
    report.schemaVersion !== RENDER_RECOVERY_REPORT_SCHEMA_VERSION
  ) {
    throw new Error("Render-recovery report scenario/schema identity is invalid");
  }
  requireHex(report.artifactDigest, HEX_64, "artifact identity");
  validateSource(report.source);
  const chromePin = validateChromePin(report.chromePin);
  validateGeneratedAt(report.generatedAt);
  validateHarnessRuntime(report.harnessRuntime);
  if (report.runFailure !== null && !nonEmptyString(report.runFailure)) {
    throw new Error("Render-recovery run failure is invalid");
  }
  const environment = validateReferenceEnvironment(report.environment);
  if (
    !isRecord(report.mandatoryMetricSet) ||
    report.mandatoryMetricSet.version !== RENDER_RECOVERY_MANDATORY_METRIC_SET_VERSION ||
    JSON.stringify(report.mandatoryMetricSet.metrics) !==
      JSON.stringify(RENDER_RECOVERY_MANDATORY_METRICS)
  ) {
    throw new Error("Render-recovery mandatory metric registry drifted");
  }
  requireExactKeys(report.mandatoryMetricSet, ["metrics", "version"], "mandatory metric set");

  if (
    !Array.isArray(report.attempts) ||
    report.attempts.length !== RENDER_RECOVERY_ATTEMPTS.length
  ) {
    throw new Error("Render-recovery report attempt count is invalid");
  }
  let measuredCount = 0;
  let budgetFailureCount = 0;
  const attemptEnvironments: Record<string, unknown>[] = [];
  for (const [index, expected] of RENDER_RECOVERY_ATTEMPTS.entries()) {
    const attempt = requireRecord(report.attempts[index], `attempt ${index + 1}`);
    validateAttemptIdentity(attempt, expected, index);
    if (attempt.state === "measured") {
      requireExactKeys(
        attempt,
        [
          "browserErrors",
          "environment",
          "failureMessage",
          "id",
          "profileLineage",
          "result",
          "state",
        ],
        `measured attempt ${expected.id}`,
      );
      if (attempt.failureMessage !== null) {
        throw new Error(`${expected.id} measured attempt retained a failure`);
      }
      const browserErrors = requireStringArray(
        attempt.browserErrors,
        `${expected.id} browser errors`,
      );
      const measuredEnvironment = validateMeasuredEnvironment(
        attempt.environment,
        `${expected.id} environment`,
      );
      attemptEnvironments.push(measuredEnvironment);
      validateProfileLineage(attempt.profileLineage, expected.id);
      validateMeasuredAttempt(attempt.result, expected);
      const result = attempt.result as unknown as MeasuredRenderRecoveryAttempt;
      if (JSON.stringify(browserErrors) !== JSON.stringify(result.browserErrors)) {
        throw new Error(`${expected.id} inner and outer browser errors diverged`);
      }
      measuredCount += 1;
      if (result.elapsedMs > RENDER_RECOVERY_COMPLETION_TIMEOUT_MS) budgetFailureCount += 1;
    } else if (attempt.state === "invalid") {
      requireExactKeys(
        attempt,
        [
          "browserErrors",
          "environment",
          "failureMessage",
          "id",
          "partial",
          "profileLineage",
          "result",
          "state",
        ],
        `invalid attempt ${expected.id}`,
      );
      if (attempt.result !== null || !nonEmptyString(attempt.failureMessage)) {
        throw new Error(`${expected.id} invalid attempt state is inconsistent`);
      }
      requireStringArray(attempt.browserErrors, `${expected.id} browser errors`);
      if (attempt.environment !== null) {
        attemptEnvironments.push(
          validateMeasuredEnvironment(attempt.environment, `${expected.id} environment`),
        );
      }
      validateProfileLineage(attempt.profileLineage, expected.id);
      validatePartial(attempt.partial, expected.id);
    } else {
      throw new Error(`Render-recovery report attempt ${index + 1} state is invalid`);
    }
  }

  const facets = validateFacets(report.facets);
  const evidencePassed =
    report.runFailure === null && measuredCount === RENDER_RECOVERY_ATTEMPTS.length;
  const expectedEvidenceStatus = evidencePassed ? "passed" : "failed";
  const expectedBudgetStatus =
    budgetFailureCount > 0 ? "failed" : evidencePassed ? "passed" : "not-evaluated";
  const environmentPassed =
    report.runFailure === null &&
    requireRecord(environment.gateIdentity, "environment gate").state === "measured" &&
    requireRecord(report.harnessRuntime, "harness runtime").eligible === true &&
    attemptEnvironments.length === RENDER_RECOVERY_ATTEMPTS.length &&
    attemptEnvironments.every((attemptEnvironment) =>
      renderRecoveryEnvironmentMatchesReference(attemptEnvironment, environment, chromePin),
    ) &&
    referenceEnvironmentIsEligible(environment, chromePin);
  if (
    facets.evidenceCompleteness.status !== expectedEvidenceStatus ||
    facets.budgetEvaluation.status !== expectedBudgetStatus ||
    facets.budgetEvaluation.evaluatedChecks !== measuredCount ||
    facets.environment.status !== (environmentPassed ? "passed" : "failed")
  ) {
    throw new Error("Render-recovery facets contradict the retained evidence");
  }
  const recomputedPassed = environmentPassed && evidencePassed && expectedBudgetStatus === "passed";
  if (typeof report.passed !== "boolean" || report.passed !== recomputedPassed) {
    throw new Error("Render-recovery report verdict contradicts its evidence");
  }
}

function validateAttemptIdentity(
  attempt: Record<string, unknown>,
  expected: (typeof RENDER_RECOVERY_ATTEMPTS)[number],
  index: number,
): void {
  if (attempt.id !== expected.id) {
    throw new Error(`Render-recovery report attempt ${index + 1} identity is invalid`);
  }
}

function validateMeasuredAttempt(
  value: unknown,
  expected: (typeof RENDER_RECOVERY_ATTEMPTS)[number],
): void {
  const result = requireRecord(value, `${expected.id} result`);
  requireExactKeys(
    result,
    [
      "afterFirstRecovery",
      "afterSecondFault",
      "beforeFault",
      "browserErrors",
      "elapsedMs",
      "firstProbe",
      "frameCountAfterVisibilityWait",
      "id",
      "initial",
      "secondProbe",
      "visibleCanvas",
    ],
    `${expected.id} result`,
  );
  if (
    result.id !== expected.id ||
    result.firstProbe !== expected.firstProbe ||
    result.secondProbe !== expected.secondProbe ||
    !positiveFinite(result.elapsedMs) ||
    !positiveInteger(result.frameCountAfterVisibilityWait)
  ) {
    throw new Error(`${expected.id} measured result identity/timing is invalid`);
  }
  requireStringArray(result.browserErrors, `${expected.id} result browser errors`);
  validateBoundary(result.initial, `${expected.id} initial`);
  validateBoundary(result.beforeFault, `${expected.id} before-fault`);
  validateBoundary(result.afterFirstRecovery, `${expected.id} recovered`);
  if (result.afterSecondFault !== null) {
    validateBoundary(result.afterSecondFault, `${expected.id} terminal`);
  }
  validateVisibleCanvasFields(result.visibleCanvas, `${expected.id} canvas`);
  requireGreyboxRenderedOutputEvidence(result.visibleCanvas);
  try {
    validateRenderRecoveryAttempt(result as unknown as MeasuredRenderRecoveryAttempt);
  } catch (error: unknown) {
    throw new Error(
      `${expected.id} measured evidence is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function validatePartial(value: unknown, id: string): void {
  const partial = requireRecord(value, `${id} partial`);
  requireExactKeys(
    partial,
    [
      "afterFirstRecovery",
      "afterSecondFault",
      "beforeFault",
      "elapsedMs",
      "initial",
      "latestTelemetry",
      "visibleCanvas",
    ],
    `${id} partial`,
  );
  for (const boundaryName of [
    "afterFirstRecovery",
    "afterSecondFault",
    "beforeFault",
    "initial",
  ] as const) {
    if (partial[boundaryName] !== null) {
      validateBoundary(partial[boundaryName], `${id} partial ${boundaryName}`);
    }
  }
  if (partial.elapsedMs !== null && !nonNegativeFinite(partial.elapsedMs)) {
    throw new Error(`${id} partial elapsed time is invalid`);
  }
  if (partial.latestTelemetry !== null) {
    validateLatestTelemetry(partial.latestTelemetry, `${id} partial latest telemetry`);
    validateRecoveryBaselineBinding(partial, id);
  }
  if (partial.visibleCanvas !== null) {
    validateVisibleCanvasFields(partial.visibleCanvas, `${id} partial canvas`);
    requireGreyboxRenderedOutputEvidence(partial.visibleCanvas);
  }
}

function validateRecoveryBaselineBinding(partial: Record<string, unknown>, id: string): void {
  const latestTelemetry = requireRecord(partial.latestTelemetry, `${id} partial latest telemetry`);
  const streaming = requireRecord(
    latestTelemetry.streaming,
    `${id} partial latest telemetry streaming`,
  );
  if (streaming.workerGeneration !== 2 || streaming.settledRecoveryCheckpoint !== null) return;
  if (partial.beforeFault === null) {
    throw new Error(`${id} generation-2 partial telemetry has no authoritative pre-fault baseline`);
  }
  const beforeFault = requireRecord(partial.beforeFault, `${id} partial beforeFault`);
  const baseline = requireRecord(beforeFault.checkpoint, `${id} partial beforeFault checkpoint`);
  if (baseline.workerGeneration !== 1) {
    throw new Error(`${id} generation-2 partial telemetry baseline generation is contradictory`);
  }
  if (streamingHasServiceStartingState(streaming)) return;
  const currentObservers = streaming.currentObservers as readonly unknown[];
  if (
    streaming.flythroughObserverUpdateCount !== baseline.flythroughObserverUpdateCount ||
    streaming.observerUpdateCount !== baseline.observerUpdateCount ||
    streaming.settledObserverUpdateCount !== baseline.observerUpdateCount ||
    (currentObservers.length > 0 &&
      JSON.stringify(currentObservers) !== JSON.stringify(baseline.observers))
  ) {
    throw new Error(`${id} generation-2 partial telemetry diverges from its pre-fault baseline`);
  }
}

function validateLatestTelemetry(value: unknown, label: string): void {
  const telemetry = requireRecord(value, label);
  requireExactKeys(
    telemetry,
    [
      "appOwnedLlmSpike",
      "flythrough",
      "identity",
      "render",
      "schemaVersion",
      "streaming",
      "wasmThreadSpike",
    ],
    label,
  );
  if (telemetry.schemaVersion !== RENDER_RECOVERY_TELEMETRY_SCHEMA_VERSION) {
    throw new Error(`${label} schema is invalid`);
  }
  requireRecord(telemetry.appOwnedLlmSpike, `${label} app-owned LLM`);
  requireRecord(telemetry.identity, `${label} identity`);
  requireRecord(telemetry.wasmThreadSpike, `${label} wasm threads`);
  validatePartialStreaming(telemetry.streaming, `${label} streaming`);
  validatePartialRender(telemetry.render, `${label} render`);
  validateDiagnosticFlythrough(telemetry.flythrough, `${label} flythrough`);
}

function validatePartialRender(value: unknown, label: string): void {
  const render = requireRecord(value, label);
  requireExactKeys(
    render,
    [
      "decoderBootstrap",
      "decoderFixtures",
      "failureMessage",
      "flythrough",
      "frameCount",
      "greyboxWorld",
      "recentFrames",
      "recovery",
      "sabRingBufferSpike",
      "state",
      "workerInitToFirstFrameMs",
      "workerStartupToFirstFrameMs",
    ],
    label,
  );
  const state = String(render.state);
  if (!["disposed", "failed", "idle", "ready", "recovering", "starting"].includes(state)) {
    throw new Error(`${label} state is invalid`);
  }
  if (
    !nonNegativeInteger(render.frameCount) ||
    (render.failureMessage !== null && !nonEmptyString(render.failureMessage)) ||
    (render.workerInitToFirstFrameMs !== null &&
      !nonNegativeFinite(render.workerInitToFirstFrameMs)) ||
    (render.workerStartupToFirstFrameMs !== null &&
      !nonNegativeFinite(render.workerStartupToFirstFrameMs)) ||
    !Array.isArray(render.recentFrames)
  ) {
    throw new Error(`${label} fields are invalid`);
  }
  for (const [index, frameValue] of render.recentFrames.entries()) {
    validateRenderFrame(frameValue, `${label} frame ${index}`);
  }
  if ((render.recentFrames as readonly unknown[]).length > (render.frameCount as number)) {
    throw new Error(`${label} retained frames exceed the published frame count`);
  }
  validateDecoderBootstrap(render.decoderBootstrap, `${label} decoder bootstrap`);
  validateDecoderFixtures(render.decoderFixtures, `${label} decoder fixtures`);
  validateGreybox(render.greyboxWorld, `${label} world`);
  if (render.flythrough !== null) {
    requireRecord(render.flythrough, `${label} worker flythrough`);
  }
  validateSab(render.sabRingBufferSpike, `${label} SAB evidence`);
  const recovery = validatePartialRenderRecovery(render.recovery, `${label} recovery`);
  const cleanWorkerFields = renderHasCleanWorkerFields(render);
  const readyWorkerFields = renderHasReadyWorkerFields(render);

  if (state === "idle") {
    if (
      render.failureMessage !== null ||
      !cleanWorkerFields ||
      recovery.state !== "not-needed" ||
      recovery.workerGeneration !== 0
    ) {
      throw new Error(`${label} idle lifecycle is contradictory`);
    }
  } else if (state === "starting") {
    if (
      render.failureMessage !== null ||
      !cleanWorkerFields ||
      recovery.state !== "not-needed" ||
      (recovery.workerGeneration !== 0 && recovery.workerGeneration !== 1)
    ) {
      throw new Error(`${label} starting lifecycle is contradictory`);
    }
  } else if (state === "recovering") {
    if (render.failureMessage !== null || !cleanWorkerFields || recovery.state !== "restarting") {
      throw new Error(`${label} recovering lifecycle is contradictory`);
    }
  } else if (state === "ready") {
    if (
      render.failureMessage !== null ||
      !readyWorkerFields ||
      !(
        (recovery.state === "not-needed" && recovery.workerGeneration === 1) ||
        (recovery.state === "recovered" && recovery.workerGeneration === 2)
      )
    ) {
      throw new Error(`${label} ready lifecycle is contradictory`);
    }
  } else if (
    state === "failed" &&
    (!nonEmptyString(render.failureMessage) ||
      recovery.state !== "exhausted" ||
      recovery.lastFailureMessage !== render.failureMessage ||
      !renderHasFailedWorkerFields(cleanWorkerFields, readyWorkerFields, recovery))
  ) {
    throw new Error(`${label} failed lifecycle is contradictory`);
  } else if (state === "disposed") {
    const preservedNonTerminalLifecycle =
      render.failureMessage === null &&
      ((recovery.state === "not-needed" &&
        ((recovery.workerGeneration === 0 && cleanWorkerFields) ||
          (recovery.workerGeneration === 1 && (cleanWorkerFields || readyWorkerFields)))) ||
        (recovery.state === "restarting" && cleanWorkerFields) ||
        (recovery.state === "recovered" && recovery.workerGeneration === 2 && readyWorkerFields));
    const preservedFailureLifecycle =
      nonEmptyString(render.failureMessage) &&
      recovery.state === "exhausted" &&
      recovery.lastFailureMessage === render.failureMessage &&
      renderHasFailedWorkerFields(cleanWorkerFields, readyWorkerFields, recovery);
    if (!preservedNonTerminalLifecycle && !preservedFailureLifecycle) {
      throw new Error(`${label} disposed lifecycle is contradictory`);
    }
  }
}

function renderHasCleanWorkerFields(render: Record<string, unknown>): boolean {
  return (
    render.decoderBootstrap === null &&
    render.decoderFixtures === null &&
    render.flythrough === null &&
    render.frameCount === 0 &&
    render.greyboxWorld === null &&
    (render.recentFrames as readonly unknown[]).length === 0 &&
    render.workerInitToFirstFrameMs === null &&
    render.workerStartupToFirstFrameMs === null
  );
}

function renderHasReadyWorkerFields(render: Record<string, unknown>): boolean {
  return (
    render.decoderBootstrap !== null &&
    render.decoderFixtures !== null &&
    render.greyboxWorld !== null &&
    positiveInteger(render.frameCount) &&
    (render.recentFrames as readonly unknown[]).length > 0 &&
    render.workerInitToFirstFrameMs !== null &&
    render.workerStartupToFirstFrameMs !== null
  );
}

function renderHasFailedWorkerFields(
  cleanWorkerFields: boolean,
  readyWorkerFields: boolean,
  recovery: Record<string, unknown>,
): boolean {
  if (recovery.restartCount === 0) {
    return (
      (recovery.workerGeneration === 0 && cleanWorkerFields) ||
      (recovery.workerGeneration === 1 && (cleanWorkerFields || readyWorkerFields))
    );
  }
  return (
    recovery.restartCount === 1 &&
    recovery.workerGeneration === 2 &&
    ((cleanWorkerFields && recovery.lastRestartDurationMs === null) ||
      (readyWorkerFields && positiveFinite(recovery.lastRestartDurationMs)))
  );
}

function validateRenderFrame(value: unknown, label: string): void {
  const frame = requireRecord(value, label);
  requireExactKeys(
    frame,
    ["durationMs", "lightingIntensity", "lightingPhase", "presentIntervalMs"],
    label,
  );
  if (
    !nonNegativeFinite(frame.durationMs) ||
    !nonNegativeFinite(frame.lightingIntensity) ||
    !nonNegativeFinite(frame.lightingPhase) ||
    (frame.presentIntervalMs !== null && !nonNegativeFinite(frame.presentIntervalMs))
  ) {
    throw new Error(`${label} is invalid`);
  }
}

function validateDiagnosticFlythrough(value: unknown, label: string): void {
  const flythrough = requireRecord(value, label);
  requireExactKeys(
    flythrough,
    [
      "checkpointEvidence",
      "failureMessage",
      "preflightElapsedMs",
      "render",
      "scenarioId",
      "schemaVersion",
      "state",
      "streamingAtMeasurementEnd",
      "streamingAtMeasurementStart",
      "validation",
    ],
    label,
  );
  if (
    flythrough.schemaVersion !== 3 ||
    !nonEmptyString(flythrough.scenarioId) ||
    (flythrough.failureMessage !== null && typeof flythrough.failureMessage !== "string") ||
    (flythrough.preflightElapsedMs !== null && !nonNegativeFinite(flythrough.preflightElapsedMs)) ||
    ![
      "completed",
      "disposed",
      "failed",
      "idle",
      "preflighting",
      "prepared",
      "running",
      "stabilizing",
    ].includes(String(flythrough.state)) ||
    !Array.isArray(flythrough.checkpointEvidence)
  ) {
    throw new Error(`${label} is invalid`);
  }
  for (const [index, checkpointValue] of flythrough.checkpointEvidence.entries()) {
    const checkpoint = requireRecord(checkpointValue, `${label} checkpoint ${index}`);
    requireExactKeys(
      checkpoint,
      [
        "cameraPosition",
        "cameraTarget",
        "checkpointId",
        "clearColorDistanceThreshold",
        "clearColorRgb",
        "elapsedMs",
        "environment",
        "environmentPhaseId",
        "height",
        "previewVisibleMeshCount",
        "rgbaSha256",
        "sampledPixelCount",
        "streamedVisibleMeshCount",
        "visiblePixelCount",
        "visiblePixelRatio",
        "width",
      ],
      `${label} checkpoint ${index}`,
    );
    validateVec3(checkpoint.cameraPosition, `${label} checkpoint ${index} camera position`);
    validateVec3(checkpoint.cameraTarget, `${label} checkpoint ${index} camera target`);
    validateVec3(checkpoint.clearColorRgb, `${label} checkpoint ${index} clear color`);
    if (
      !nonEmptyString(checkpoint.checkpointId) ||
      !nonEmptyString(checkpoint.environmentPhaseId) ||
      !isRecord(checkpoint.environment) ||
      !nonNegativeFinite(checkpoint.elapsedMs) ||
      !nonNegativeFinite(checkpoint.clearColorDistanceThreshold) ||
      !nonNegativeInteger(checkpoint.height) ||
      !nonNegativeInteger(checkpoint.previewVisibleMeshCount) ||
      !nonNegativeInteger(checkpoint.sampledPixelCount) ||
      !nonNegativeInteger(checkpoint.streamedVisibleMeshCount) ||
      !nonNegativeInteger(checkpoint.visiblePixelCount) ||
      !nonNegativeFinite(checkpoint.visiblePixelRatio) ||
      !nonNegativeInteger(checkpoint.width)
    ) {
      throw new Error(`${label} checkpoint ${index} fields are invalid`);
    }
    requireHex(checkpoint.rgbaSha256, HEX_64, `${label} checkpoint ${index} RGBA digest`);
  }
}

function validateBoundary(value: unknown, label: string): void {
  const boundary = requireRecord(value, label);
  requireExactKeys(
    boundary,
    [
      "checkpoint",
      "decoderBootstrap",
      "decoderFixtures",
      "frameCount",
      "flythrough",
      "greyboxWorld",
      "observers",
      "renderRecovery",
      "renderState",
      "residentCellIds",
      "sab",
      "streaming",
    ],
    label,
  );
  validateCheckpoint(boundary.checkpoint, `${label} checkpoint`);
  if (!nonNegativeInteger(boundary.frameCount)) throw new Error(`${label} frame count is invalid`);
  validateVec3Array(boundary.observers, `${label} observers`);
  const boundaryResidents = requireStringArray(boundary.residentCellIds, `${label} resident IDs`);
  validateRenderRecovery(boundary.renderRecovery, `${label} render recovery`);
  validateStreaming(boundary.streaming, `${label} streaming`);
  validateSab(boundary.sab, `${label} SAB evidence`);
  validateGreybox(boundary.greyboxWorld, `${label} world`);
  validateDecoderBootstrap(boundary.decoderBootstrap, `${label} decoder bootstrap`);
  validateDecoderFixtures(boundary.decoderFixtures, `${label} decoder fixtures`);
  validateFlythrough(boundary.flythrough, `${label} flythrough`);
  if (
    !["disposed", "failed", "idle", "ready", "recovering", "starting"].includes(
      String(boundary.renderState),
    )
  ) {
    throw new Error(`${label} render state is invalid`);
  }
  const streaming = boundary.streaming as unknown as {
    readonly currentObservers: unknown;
    readonly flythroughObserverUpdateCount: unknown;
    readonly residentCellIds: unknown;
    readonly settledObserverUpdateCount: unknown;
    readonly settledRecoveryCheckpoint: unknown;
    readonly state: unknown;
  };
  const checkpoint = boundary.checkpoint as unknown as Record<string, unknown>;
  if (
    JSON.stringify(boundary.observers) !== JSON.stringify(checkpoint.observers) ||
    JSON.stringify(boundary.residentCellIds) !== JSON.stringify(checkpoint.residentCellIds) ||
    JSON.stringify(checkpoint) !== JSON.stringify(streaming.settledRecoveryCheckpoint) ||
    JSON.stringify(checkpoint.observers) !== JSON.stringify(streaming.currentObservers) ||
    JSON.stringify(checkpoint.residentCellIds) !== JSON.stringify(streaming.residentCellIds) ||
    checkpoint.observerUpdateCount !== streaming.settledObserverUpdateCount ||
    checkpoint.flythroughObserverUpdateCount !== streaming.flythroughObserverUpdateCount ||
    !isSortedUniqueExactNine(boundaryResidents)
  ) {
    throw new Error(`${label} checkpoint is not bound to current settled streaming state`);
  }
  if (streaming.state === "streaming") {
    requireWorldStreamingSnapshot(boundary.streaming, "settled-hydration");
  }
  requireSabRingBufferCompleteAtMeasurementBoundary(
    boundary.sab as Parameters<typeof requireSabRingBufferCompleteAtMeasurementBoundary>[0],
  );
}

function validateCheckpoint(value: unknown, label: string): void {
  const checkpoint = requireRecord(value, label);
  requireExactKeys(
    checkpoint,
    [
      "flythroughObserverUpdateCount",
      "observerUpdateCount",
      "observers",
      "residentCellIds",
      "workerGeneration",
    ],
    label,
  );
  if (
    !nonNegativeInteger(checkpoint.flythroughObserverUpdateCount) ||
    !nonNegativeInteger(checkpoint.observerUpdateCount) ||
    (checkpoint.flythroughObserverUpdateCount as number) >
      (checkpoint.observerUpdateCount as number) ||
    !positiveInteger(checkpoint.workerGeneration)
  ) {
    throw new Error(`${label} counters are invalid`);
  }
  validateVec3Array(checkpoint.observers, `${label} observers`);
  const residents = requireStringArray(checkpoint.residentCellIds, `${label} residents`);
  if (!isSortedUniqueExactNine(residents)) {
    throw new Error(`${label} residents are not the exact sorted recovery residency`);
  }
}

function isSortedUniqueExactNine(value: readonly unknown[]): boolean {
  return (
    value.length === RENDER_RECOVERY_RESIDENT_CELL_COUNT &&
    value.every((entry) => nonEmptyString(entry)) &&
    new Set(value).size === RENDER_RECOVERY_RESIDENT_CELL_COUNT &&
    JSON.stringify(value) === JSON.stringify([...value].sort())
  );
}

function validateRenderRecovery(value: unknown, label: string): void {
  const recovery = validateRenderRecoveryStructure(value, label);
  if (!positiveInteger(recovery.workerGeneration)) {
    throw new Error(`${label} is invalid`);
  }
}

function validatePartialRenderRecovery(value: unknown, label: string): Record<string, unknown> {
  const recovery = validateRenderRecoveryStructure(value, label);
  const state = String(recovery.state);
  const cleanHistory =
    recovery.lastCause === null &&
    recovery.lastFailureMessage === null &&
    recovery.lastRestartDurationMs === null &&
    recovery.restartCount === 0;
  if (
    (state === "not-needed" &&
      (!cleanHistory || (recovery.workerGeneration !== 0 && recovery.workerGeneration !== 1))) ||
    (state === "restarting" &&
      (!nonEmptyString(recovery.lastCause) ||
        !nonEmptyString(recovery.lastFailureMessage) ||
        recovery.lastRestartDurationMs !== null ||
        recovery.restartCount !== 1 ||
        recovery.workerGeneration !== 2)) ||
    (state === "recovered" &&
      (!nonEmptyString(recovery.lastCause) ||
        !nonEmptyString(recovery.lastFailureMessage) ||
        !positiveFinite(recovery.lastRestartDurationMs) ||
        recovery.restartCount !== 1 ||
        recovery.workerGeneration !== 2)) ||
    (state === "exhausted" &&
      (!nonEmptyString(recovery.lastCause) ||
        !nonEmptyString(recovery.lastFailureMessage) ||
        (recovery.restartCount !== 0 && recovery.restartCount !== 1) ||
        (recovery.restartCount === 0 &&
          recovery.workerGeneration !== 0 &&
          recovery.workerGeneration !== 1) ||
        (recovery.restartCount === 1 && recovery.workerGeneration !== 2) ||
        (recovery.restartCount === 0 && recovery.lastRestartDurationMs !== null)))
  ) {
    throw new Error(`${label} lifecycle is contradictory`);
  }
  return recovery;
}

function validateRenderRecoveryStructure(value: unknown, label: string): Record<string, unknown> {
  const recovery = requireRecord(value, label);
  requireExactKeys(
    recovery,
    [
      "lastCause",
      "lastFailureMessage",
      "lastRestartDurationMs",
      "maximumAutomaticRestarts",
      "restartCount",
      "state",
      "workerGeneration",
    ],
    label,
  );
  if (
    (recovery.lastCause !== null &&
      ![
        "device-loss",
        "render-error",
        "startup",
        "worker-crash",
        "worker-error",
        "worker-message",
      ].includes(String(recovery.lastCause))) ||
    (recovery.lastFailureMessage !== null && typeof recovery.lastFailureMessage !== "string") ||
    (recovery.lastRestartDurationMs !== null && !positiveFinite(recovery.lastRestartDurationMs)) ||
    recovery.maximumAutomaticRestarts !== 1 ||
    !nonNegativeInteger(recovery.restartCount) ||
    !["exhausted", "not-needed", "recovered", "restarting"].includes(String(recovery.state)) ||
    !nonNegativeInteger(recovery.workerGeneration)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return recovery;
}

function validateStreaming(value: unknown, label: string): void {
  const streaming = validateStreamingStructure(value, label);
  if (!positiveInteger(streaming.workerGeneration)) {
    throw new Error(`${label} identity is invalid`);
  }
  validateCheckpoint(streaming.settledRecoveryCheckpoint, `${label} checkpoint`);
}

function validatePartialStreaming(value: unknown, label: string): void {
  const streaming = validateStreamingStructure(value, label);
  const state = String(streaming.state);
  const observers = streaming.currentObservers as readonly unknown[];
  const residents = streaming.residentCellIds as readonly string[];
  const samples = streaming.cellLoadSamples as readonly unknown[];
  const checkpoint =
    streaming.settledRecoveryCheckpoint === null
      ? null
      : requireRecord(streaming.settledRecoveryCheckpoint, `${label} checkpoint`);
  const failureMessage = streaming.failureMessage;
  const observerUpdateCount = streaming.observerUpdateCount as number;
  const flythroughObserverUpdateCount = streaming.flythroughObserverUpdateCount as number;
  const settledObserverUpdateCount = streaming.settledObserverUpdateCount as number;
  const residentEncodedBytes = streaming.residentEncodedBytes as number;
  const residentGpuBytes = streaming.residentGpuBytes as number;
  const hasCurrentResidency = residents.length > 0;

  if (
    flythroughObserverUpdateCount > observerUpdateCount ||
    settledObserverUpdateCount > observerUpdateCount ||
    streaming.residentCellCount !== residents.length ||
    residents.length > RENDER_RECOVERY_RESIDENT_CELL_COUNT ||
    residents.some((resident) => !nonEmptyString(resident)) ||
    new Set(residents).size !== residents.length ||
    JSON.stringify(residents) !== JSON.stringify([...residents].sort()) ||
    (streaming.cellLoadSampleCount as number) < samples.length ||
    (samples.length === 0) !== (streaming.cellLoadSampleCount === 0) ||
    residentEncodedBytes > (streaming.residentEncodedBytesHighWater as number) ||
    residentGpuBytes > (streaming.residentGpuBytesHighWater as number) ||
    (hasCurrentResidency &&
      (!positiveInteger(residentEncodedBytes) || !positiveInteger(residentGpuBytes))) ||
    (!hasCurrentResidency && (residentEncodedBytes !== 0 || residentGpuBytes !== 0)) ||
    (streaming.workerGeneration === 0 && streaming.renderRecoveryCount !== 0) ||
    (positiveInteger(streaming.workerGeneration) &&
      streaming.renderRecoveryCount !== 0 &&
      streaming.renderRecoveryCount !== 1) ||
    (positiveInteger(streaming.workerGeneration) &&
      streaming.workerGeneration !== (streaming.renderRecoveryCount as number) + 1)
  ) {
    throw new Error(`${label} counters or residency are contradictory`);
  }
  if (
    checkpoint !== null &&
    (checkpoint.workerGeneration !== streaming.workerGeneration ||
      checkpoint.observerUpdateCount !== settledObserverUpdateCount ||
      (checkpoint.flythroughObserverUpdateCount as number) > flythroughObserverUpdateCount ||
      flythroughObserverUpdateCount - (checkpoint.flythroughObserverUpdateCount as number) >
        observerUpdateCount - (checkpoint.observerUpdateCount as number) ||
      (settledObserverUpdateCount === observerUpdateCount &&
        JSON.stringify(checkpoint.observers) !== JSON.stringify(observers)))
  ) {
    throw new Error(`${label} checkpoint lifecycle is contradictory`);
  }
  if (
    checkpoint === null &&
    streaming.workerGeneration === 1 &&
    observers.length > 0 &&
    observerUpdateCount !== flythroughObserverUpdateCount
  ) {
    throw new Error(`${label} observer lifecycle is contradictory`);
  }
  if (
    checkpoint === null &&
    streamingHasPublishedDecodePoolIdentity(streaming) &&
    (streaming.cellLoadSampleCount !== 0 || samples.length !== 0)
  ) {
    throw new Error(`${label} pre-settlement history is contradictory`);
  }

  if (state === "idle") {
    const serviceInitial =
      streaming.workerGeneration === 0 && streamingHasInitialCounters(streaming);
    const workerStartup =
      positiveInteger(streaming.workerGeneration) && streamingHasWorkerStartupState(streaming);
    if (
      failureMessage !== null ||
      checkpoint !== null ||
      observers.length !== 0 ||
      (!serviceInitial && !workerStartup)
    ) {
      throw new Error(`${label} idle lifecycle is contradictory`);
    }
  } else if (state === "starting") {
    if (
      failureMessage !== null ||
      checkpoint !== null ||
      observers.length !== 0 ||
      !streamingHasServiceStartingState(streaming)
    ) {
      throw new Error(`${label} starting lifecycle is contradictory`);
    }
  } else if (state === "provisioning") {
    if (
      failureMessage !== null ||
      !positiveInteger(streaming.workerGeneration) ||
      checkpoint !== null ||
      observers.length === 0 ||
      !streamingHasWorkerHardwareIdentity(streaming) ||
      !streamingHasProvisioningDecodePoolIdentity(streaming) ||
      streaming.cellLoadSampleCount !== 0 ||
      samples.length !== 0 ||
      streaming.proactiveEvictionCount !== 0
    ) {
      throw new Error(`${label} provisioning lifecycle is contradictory`);
    }
  } else if (state === "streaming") {
    if (
      failureMessage !== null ||
      !positiveInteger(streaming.workerGeneration) ||
      checkpoint === null ||
      observers.length === 0 ||
      !streamingHasWorkerHardwareIdentity(streaming) ||
      !streamingHasPublishedDecodePoolIdentity(streaming)
    ) {
      throw new Error(`${label} streaming lifecycle is contradictory`);
    }
  } else if (state === "failed") {
    const hasNoPublishedObserversOrCheckpoint = observers.length === 0 && checkpoint === null;
    const failedBeforeStartIdentity =
      hasNoPublishedObserversOrCheckpoint &&
      streaming.workerGeneration === 0 &&
      streamingHasInitialCounters(streaming, false, true);
    const failedDuringServiceStart =
      hasNoPublishedObserversOrCheckpoint && streamingHasServiceStartingState(streaming);
    const failedAfterStartIdentityBeforeObservers =
      hasNoPublishedObserversOrCheckpoint && streamingHasWorkerStartupState(streaming);
    const hasProducerValidCheckpointPublication =
      checkpoint !== null ||
      (streaming.workerGeneration === 1
        ? streaming.settledObserverUpdateCount === 0
        : streaming.workerGeneration === 2);
    const failedAfterObserversBeforeDecodePool =
      observers.length > 0 &&
      checkpoint === null &&
      positiveInteger(streaming.workerGeneration) &&
      streamingHasWorkerHardwareIdentity(streaming) &&
      streaming.decodeWorkerCount === 0 &&
      streamingHasProvisioningDecodePoolIdentity(streaming) &&
      hasProducerValidCheckpointPublication;
    const failedAfterDecodePool =
      observers.length > 0 &&
      positiveInteger(streaming.workerGeneration) &&
      streamingHasPublishedDecodePoolIdentity(streaming) &&
      hasProducerValidCheckpointPublication;
    if (
      !nonEmptyString(failureMessage) ||
      (!failedBeforeStartIdentity &&
        !failedDuringServiceStart &&
        !failedAfterStartIdentityBeforeObservers &&
        !failedAfterObserversBeforeDecodePool &&
        !failedAfterDecodePool)
    ) {
      throw new Error(`${label} failed lifecycle is contradictory`);
    }
  } else if (state === "disposed") {
    const emptyCurrentResidency =
      residents.length === 0 &&
      streaming.residentCellCount === 0 &&
      streaming.residentEncodedBytes === 0 &&
      streaming.residentGpuBytes === 0;
    const disposedBeforeSettlement =
      checkpoint === null &&
      streaming.cellLoadSampleCount === 0 &&
      samples.length === 0 &&
      streaming.cpuBudgetRejectionCount === 0 &&
      streaming.decodeQueueDepthHighWater === 0 &&
      streaming.encodedBytesRead === 0 &&
      streaming.proactiveEvictionCount === 0 &&
      streaming.residentEncodedBytesHighWater === 0 &&
      streaming.residentGpuBytesHighWater === 0 &&
      streaming.settledObserverUpdateCount === streaming.observerUpdateCount &&
      (streaming.workerGeneration === 2 ||
        (streaming.observerUpdateCount === 0 && streaming.flythroughObserverUpdateCount === 0));
    const disposedAfterSettlement =
      checkpoint !== null &&
      checkpoint.observerUpdateCount === streaming.observerUpdateCount &&
      checkpoint.flythroughObserverUpdateCount === streaming.flythroughObserverUpdateCount &&
      JSON.stringify(checkpoint.observers) === JSON.stringify(observers) &&
      (streaming.proactiveEvictionCount as number) >= RENDER_RECOVERY_RESIDENT_CELL_COUNT &&
      streaming.cpuBudgetRejectionCount === 0 &&
      positiveInteger(streaming.decodeWorkerCount) &&
      (streaming.decodeQueueDepthHighWater as number) >= (streaming.decodeWorkerCount as number) &&
      (streaming.decodeQueueDepthHighWater as number) <= RENDER_RECOVERY_RESIDENT_CELL_COUNT &&
      positiveInteger(streaming.encodedBytesRead) &&
      positiveInteger(streaming.residentEncodedBytesHighWater) &&
      positiveInteger(streaming.residentGpuBytesHighWater);
    if (
      failureMessage !== null ||
      !positiveInteger(streaming.workerGeneration) ||
      !streamingHasWorkerHardwareIdentity(streaming) ||
      (checkpoint === null
        ? streaming.decodeWorkerCount !== 0
        : !streamingHasPublishedDecodePoolIdentity(streaming)) ||
      observers.length === 0 ||
      !emptyCurrentResidency ||
      (!disposedBeforeSettlement && !disposedAfterSettlement)
    ) {
      throw new Error(`${label} disposed lifecycle is contradictory`);
    }
  }
}

function streamingExpectedDecodeWorkerCount(hardwareConcurrency: number): number {
  return Math.min(
    STREAMING_DECODE_WORKER_MAXIMUM,
    Math.max(1, hardwareConcurrency - STREAMING_DECODE_WORKER_RESERVED_THREADS),
  );
}

function streamingHasWorkerHardwareIdentity(streaming: Record<string, unknown>): boolean {
  return positiveInteger(streaming.hardwareConcurrency);
}

function streamingHasPublishedDecodePoolIdentity(streaming: Record<string, unknown>): boolean {
  return (
    streamingHasWorkerHardwareIdentity(streaming) &&
    streaming.decodeWorkerCount ===
      streamingExpectedDecodeWorkerCount(streaming.hardwareConcurrency as number)
  );
}

function streamingHasProvisioningDecodePoolIdentity(streaming: Record<string, unknown>): boolean {
  return (
    streamingHasPublishedDecodePoolIdentity(streaming) ||
    (streaming.decodeWorkerCount === 0 &&
      streaming.settledRecoveryCheckpoint === null &&
      streaming.cellLoadSampleCount === 0 &&
      (streaming.cellLoadSamples as readonly unknown[]).length === 0 &&
      streaming.cpuBudgetRejectionCount === 0 &&
      streaming.decodeQueueDepthHighWater === 0 &&
      streaming.encodedBytesRead === 0 &&
      streaming.proactiveEvictionCount === 0 &&
      streaming.residentCellCount === 0 &&
      (streaming.residentCellIds as readonly unknown[]).length === 0 &&
      streaming.residentEncodedBytes === 0 &&
      streaming.residentEncodedBytesHighWater === 0 &&
      streaming.residentGpuBytes === 0 &&
      streaming.residentGpuBytesHighWater === 0)
  );
}

function streamingHasServiceStartingState(streaming: Record<string, unknown>): boolean {
  if (!streamingHasInitialCounters(streaming, true)) return false;
  return (
    streaming.decodeWorkerCount === 0 &&
    ((streaming.workerGeneration === 1 &&
      streaming.renderRecoveryCount === 0 &&
      streaming.hardwareConcurrency === 0) ||
      (streaming.workerGeneration === 2 &&
        streaming.renderRecoveryCount === 1 &&
        streamingHasWorkerHardwareIdentity(streaming)))
  );
}

function streamingHasWorkerStartupState(streaming: Record<string, unknown>): boolean {
  const zeroKeys = [
    "cellLoadSampleCount",
    "cpuBudgetRejectionCount",
    "decodeQueueDepthHighWater",
    "decodeWorkerCount",
    "encodedBytesRead",
    "opfsAccessHandleCount",
    "opfsAccessHandleOpenDurationMs",
    "opfsPackageCount",
    "opfsProvisionedBytes",
    "proactiveEvictionCount",
    "residentCellCount",
    "residentEncodedBytes",
    "residentEncodedBytesHighWater",
    "residentGpuBytes",
    "residentGpuBytesHighWater",
  ] as const;
  return (
    positiveInteger(streaming.hardwareConcurrency) &&
    zeroKeys.every((key) => streaming[key] === 0) &&
    (streaming.cellLoadSamples as readonly unknown[]).length === 0 &&
    (streaming.residentCellIds as readonly unknown[]).length === 0 &&
    streaming.settledObserverUpdateCount === streaming.observerUpdateCount &&
    ((streaming.workerGeneration === 1 &&
      streaming.renderRecoveryCount === 0 &&
      streaming.observerUpdateCount === 0 &&
      streaming.flythroughObserverUpdateCount === 0) ||
      (streaming.workerGeneration === 2 && streaming.renderRecoveryCount === 1))
  );
}

function streamingHasInitialCounters(
  streaming: Record<string, unknown>,
  allowLaunchIdentity = false,
  allowWorkerHardwareIdentity = false,
): boolean {
  const zeroKeys = [
    "cellLoadSampleCount",
    "cpuBudgetRejectionCount",
    "decodeQueueDepthHighWater",
    "decodeWorkerCount",
    "encodedBytesRead",
    "flythroughObserverUpdateCount",
    "observerUpdateCount",
    "opfsAccessHandleCount",
    "opfsAccessHandleOpenDurationMs",
    "opfsPackageCount",
    "opfsProvisionedBytes",
    "proactiveEvictionCount",
    "residentCellCount",
    "residentEncodedBytes",
    "residentEncodedBytesHighWater",
    "residentGpuBytes",
    "residentGpuBytesHighWater",
    "settledObserverUpdateCount",
  ] as const;
  return (
    zeroKeys.every((key) => streaming[key] === 0) &&
    (streaming.cellLoadSamples as readonly unknown[]).length === 0 &&
    (streaming.residentCellIds as readonly unknown[]).length === 0 &&
    (!allowLaunchIdentity ||
      ((streaming.renderRecoveryCount === 0 || streaming.renderRecoveryCount === 1) &&
        streaming.workerGeneration === (streaming.renderRecoveryCount as number) + 1)) &&
    (allowLaunchIdentity || streaming.renderRecoveryCount === 0) &&
    (allowLaunchIdentity || allowWorkerHardwareIdentity || streaming.hardwareConcurrency === 0)
  );
}

function validateStreamingStructure(value: unknown, label: string): Record<string, unknown> {
  const streaming = requireRecord(value, label);
  requireExactKeys(
    streaming,
    [
      "cellLoadSampleCount",
      "cellLoadSamples",
      "cpuBudgetRejectionCount",
      "currentObservers",
      "decodeQueueDepthHighWater",
      "decodeWorkerCount",
      "encodedBytesRead",
      "failureMessage",
      "flythroughObserverUpdateCount",
      "hardwareConcurrency",
      "observerUpdateCount",
      "opfsAccessHandleCount",
      "opfsAccessHandleOpenDurationMs",
      "opfsPackageCount",
      "opfsProvisionedBytes",
      "proactiveEvictionCount",
      "renderRecoveryCount",
      "residentCellCount",
      "residentCellIds",
      "residentEncodedBytes",
      "residentEncodedBytesHighWater",
      "residentGpuBytes",
      "residentGpuBytesHighWater",
      "schemaVersion",
      "settledObserverUpdateCount",
      "settledRecoveryCheckpoint",
      "state",
      "workerGeneration",
    ],
    label,
  );
  for (const key of [
    "cellLoadSampleCount",
    "cpuBudgetRejectionCount",
    "decodeQueueDepthHighWater",
    "decodeWorkerCount",
    "encodedBytesRead",
    "flythroughObserverUpdateCount",
    "hardwareConcurrency",
    "observerUpdateCount",
    "opfsAccessHandleCount",
    "opfsPackageCount",
    "opfsProvisionedBytes",
    "proactiveEvictionCount",
    "renderRecoveryCount",
    "residentCellCount",
    "residentEncodedBytes",
    "residentEncodedBytesHighWater",
    "residentGpuBytes",
    "residentGpuBytesHighWater",
    "settledObserverUpdateCount",
  ]) {
    if (!nonNegativeInteger(streaming[key])) throw new Error(`${label} ${key} is invalid`);
  }
  if (
    streaming.schemaVersion !== 7 ||
    !nonNegativeFinite(streaming.opfsAccessHandleOpenDurationMs) ||
    (streaming.opfsAccessHandleCount as number) > (streaming.opfsPackageCount as number) ||
    (streaming.opfsPackageCount === 0 && streaming.opfsAccessHandleOpenDurationMs !== 0) ||
    (streaming.state === "streaming" &&
      (!positiveInteger(streaming.opfsPackageCount) ||
        streaming.opfsAccessHandleCount !== streaming.opfsPackageCount)) ||
    ((streaming.state === "failed" || streaming.state === "disposed") &&
      streaming.opfsAccessHandleCount !== 0) ||
    !nonNegativeInteger(streaming.workerGeneration) ||
    (streaming.failureMessage !== null && !nonEmptyString(streaming.failureMessage)) ||
    !["disposed", "failed", "idle", "provisioning", "starting", "streaming"].includes(
      String(streaming.state),
    )
  ) {
    throw new Error(`${label} identity is invalid`);
  }
  validateVec3ArrayAllowEmpty(streaming.currentObservers, `${label} observers`);
  requireStringArray(streaming.residentCellIds, `${label} residents`);
  if (streaming.settledRecoveryCheckpoint !== null) {
    validateCheckpoint(streaming.settledRecoveryCheckpoint, `${label} checkpoint`);
  }
  if (!Array.isArray(streaming.cellLoadSamples)) throw new Error(`${label} samples are invalid`);
  for (const [index, entry] of streaming.cellLoadSamples.entries()) {
    validateStreamingSample(entry, `${label} sample ${index}`);
  }
  return streaming;
}

function validateStreamingSample(value: unknown, label: string): void {
  const sample = requireRecord(value, label);
  const keys = [
    "batchCellCount",
    "batchCellOrdinal",
    "batchFlythroughObserverSequence",
    "batchObserverUpdateCount",
    "batchOrdinal",
    "cellId",
    "decodeMs",
    "decodeRoundTripMs",
    "decodeWaitMs",
    "encodedBytes",
    "gpuBytes",
    "opfsAccessRoundTripMs",
    "opfsReadMs",
    "opfsWaitMs",
    "renderCommitRoundTripMs",
    "renderUploadRoundTripMs",
    "renderUploadWaitMs",
    "sequence",
    "streamingWorkerRemainderMs",
    "totalMs",
    "uploadMs",
  ] as const;
  requireExactKeys(sample, keys, label);
  if (!nonEmptyString(sample.cellId)) throw new Error(`${label} cell is invalid`);
  for (const key of keys) {
    if (key !== "cellId" && !nonNegativeFinite(sample[key])) {
      throw new Error(`${label} ${key} is invalid`);
    }
  }
}

function validateSab(value: unknown, label: string): void {
  const sab = requireRecord(value, label);
  const keys = [
    "capacityRecords",
    "cooperativeRoundTripsPerSecond",
    "elapsedMs",
    "failureMessage",
    "mainConsumerEmptyPolls",
    "mainProducerStalls",
    "mainPumpMaxDurationMs",
    "messageCount",
    "payloadErrors",
    "recordWords",
    "responsesReceived",
    "state",
    "totalSABBytes",
    "workerConcurrentFrameCount",
    "workerConcurrentFrameIntervalMaxMs",
    "workerConcurrentRenderDurationMaxMs",
    "workerElapsedMs",
    "workerInboundWaits",
    "workerOutboundStalls",
    "workerSequenceErrors",
  ] as const;
  requireExactKeys(sab, keys, label);
  for (const key of keys) {
    if (
      [
        "cooperativeRoundTripsPerSecond",
        "elapsedMs",
        "failureMessage",
        "state",
        "workerConcurrentFrameIntervalMaxMs",
        "workerConcurrentRenderDurationMaxMs",
        "workerElapsedMs",
      ].includes(key)
    )
      continue;
    if (!nonNegativeFinite(sab[key])) throw new Error(`${label} ${key} is invalid`);
  }
  for (const key of [
    "cooperativeRoundTripsPerSecond",
    "elapsedMs",
    "workerConcurrentFrameIntervalMaxMs",
    "workerConcurrentRenderDurationMaxMs",
    "workerElapsedMs",
  ]) {
    if (sab[key] !== null && !nonNegativeFinite(sab[key]))
      throw new Error(`${label} ${key} is invalid`);
  }
  if (
    (sab.failureMessage !== null && typeof sab.failureMessage !== "string") ||
    !["completed", "failed", "pending", "running"].includes(String(sab.state))
  ) {
    throw new Error(`${label} state is invalid`);
  }
}

function validateGreybox(value: unknown, label: string): void {
  if (value === null) return;
  const world = requireRecord(value, label);
  requireExactKeys(
    world,
    [
      "cellCount",
      "clearColor",
      "colliderCount",
      "districtId",
      "dynamicLighting",
      "heightSampleCount",
      "mainThreadScenePostMessageMs",
      "mainThreadWorldGenerationMs",
      "materialCount",
      "materializationMs",
      "renderedFeaturePrimitiveCount",
      "renderedTerrainPatchCount",
      "renderedTriangleCount",
      "selectedLodCellCounts",
      "worldBoundsMeters",
    ],
    label,
  );
  if (
    !nonEmptyString(world.districtId) ||
    world.dynamicLighting !== true ||
    !Array.isArray(world.clearColor) ||
    world.clearColor.length !== 4 ||
    world.clearColor.some((entry) => !nonNegativeFinite(entry)) ||
    !Array.isArray(world.selectedLodCellCounts) ||
    world.selectedLodCellCounts.length !== 3 ||
    world.selectedLodCellCounts.some((entry) => !nonNegativeInteger(entry))
  ) {
    throw new Error(`${label} identity is invalid`);
  }
  for (const key of [
    "cellCount",
    "colliderCount",
    "heightSampleCount",
    "mainThreadScenePostMessageMs",
    "mainThreadWorldGenerationMs",
    "materialCount",
    "materializationMs",
    "renderedFeaturePrimitiveCount",
    "renderedTerrainPatchCount",
    "renderedTriangleCount",
  ]) {
    if (!nonNegativeFinite(world[key])) throw new Error(`${label} ${key} is invalid`);
  }
  const bounds = requireRecord(world.worldBoundsMeters, `${label} bounds`);
  requireExactKeys(bounds, ["maximum", "minimum"], `${label} bounds`);
  validateVec3(bounds.maximum, `${label} maximum`);
  validateVec3(bounds.minimum, `${label} minimum`);
}

function validateDecoderBootstrap(value: unknown, label: string): void {
  if (value === null) return;
  const decoder = requireRecord(value, label);
  requireExactKeys(decoder, ["installedAtMs", "paths", "versions"], label);
  if (!nonNegativeFinite(decoder.installedAtMs)) throw new Error(`${label} time is invalid`);
  const paths = requireRecord(decoder.paths, `${label} paths`);
  const versions = requireRecord(decoder.versions, `${label} versions`);
  requireExactKeys(paths, ["draco", "ktx2", "meshopt"], `${label} paths`);
  requireExactKeys(versions, ["draco", "ktx2", "meshopt"], `${label} versions`);
  if (Object.values(paths).some((entry) => entry !== "preinstalled-global")) {
    throw new Error(`${label} paths are invalid`);
  }
  if (versions.draco !== "1.5.7" || versions.ktx2 !== "9.17.0" || versions.meshopt !== "1.2.0") {
    throw new Error(`${label} versions are invalid`);
  }
}

function validateDecoderFixtures(value: unknown, label: string): void {
  if (value === null) return;
  const fixtures = requireRecord(value, label);
  requireExactKeys(fixtures, ["draco", "ktx2", "meshopt"], label);
  const draco = requireRecord(fixtures.draco, `${label} draco`);
  const ktx2 = requireRecord(fixtures.ktx2, `${label} ktx2`);
  const meshopt = requireRecord(fixtures.meshopt, `${label} meshopt`);
  requireExactKeys(draco, ["durationMs", "faces"], `${label} draco`);
  requireExactKeys(ktx2, ["durationMs", "height", "transcoder", "width"], `${label} ktx2`);
  requireExactKeys(meshopt, ["bytes", "durationMs"], `${label} meshopt`);
  if (
    !nonNegativeFinite(draco.durationMs) ||
    !nonNegativeInteger(draco.faces) ||
    !nonNegativeFinite(ktx2.durationMs) ||
    !positiveInteger(ktx2.height) ||
    !nonEmptyString(ktx2.transcoder) ||
    !positiveInteger(ktx2.width) ||
    !nonNegativeInteger(meshopt.bytes) ||
    !nonNegativeFinite(meshopt.durationMs)
  ) {
    throw new Error(`${label} is invalid`);
  }
}

function validateSource(value: unknown): void {
  const source = requireRecord(value, "source identity");
  requireExactKeys(source, ["commit", "dirtyTreeDigest"], "source identity");
  requireHex(source.commit, HEX_40, "source commit");
  if (source.dirtyTreeDigest !== null) {
    requireHex(source.dirtyTreeDigest, HEX_64, "dirty-tree digest");
  }
}

function validateChromePin(value: unknown): Record<string, unknown> {
  const pin = requireRecord(value, "Chrome pin");
  requireExactKeys(
    pin,
    ["channel", "downloads", "executableSha256", "revision", "version"],
    "Chrome pin",
  );
  if (
    pin.channel !== "stable" ||
    !nonEmptyString(pin.revision) ||
    typeof pin.version !== "string" ||
    !/^\d+\.\d+\.\d+\.\d+$/.test(pin.version)
  ) {
    throw new Error("Render-recovery Chrome pin is invalid");
  }
  requireStringRecord(pin.downloads, "Chrome downloads", false);
  requireStringRecord(pin.executableSha256, "Chrome executable digests", true);
  return pin;
}

function validateGeneratedAt(value: unknown): void {
  if (
    typeof value !== "string" ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error("Render-recovery generated time is invalid");
  }
}

function validateHarnessRuntime(value: unknown): void {
  const runtime = requireRecord(value, "harness runtime");
  requireExactKeys(
    runtime,
    ["eligible", "expectedNodeVersion", "nodeExecutableSha256", "nodeVersion"],
    "harness runtime",
  );
  if (
    typeof runtime.eligible !== "boolean" ||
    !nonEmptyString(runtime.expectedNodeVersion) ||
    !nonEmptyString(runtime.nodeVersion)
  ) {
    throw new Error("Render-recovery harness runtime is invalid");
  }
  requireHex(runtime.nodeExecutableSha256, HEX_64, "Node executable digest");
  if (runtime.eligible !== (runtime.nodeVersion === `v${String(runtime.expectedNodeVersion)}`)) {
    throw new Error("Render-recovery harness runtime eligibility is inconsistent");
  }
}

function validateReferenceEnvironment(value: unknown): Record<string, unknown> {
  const environment = requireRecord(value, "reference environment");
  requireExactKeys(
    environment,
    [
      "adapter",
      "browserDisplay",
      "browserProduct",
      "browserRevision",
      "browserUserAgent",
      "executableSha256",
      "gateIdentity",
      "gpuDevices",
      "host",
      "hostAfterRuns",
      "identityProbeBrowserCommandLine",
      "jsVersion",
      "machineId",
      "requestedTier",
      "sandboxVerified",
      "targetDisplayMode",
    ],
    "reference environment",
  );
  for (const key of [
    "browserProduct",
    "browserRevision",
    "browserUserAgent",
    "identityProbeBrowserCommandLine",
    "jsVersion",
    "machineId",
    "requestedTier",
    "targetDisplayMode",
  ]) {
    if (!nonEmptyString(environment[key])) {
      throw new Error(`Reference environment ${key} is invalid`);
    }
  }
  requireHex(environment.executableSha256, HEX_64, "Chrome executable digest");
  if (typeof environment.sandboxVerified !== "boolean") {
    throw new Error("Reference environment sandbox evidence is invalid");
  }
  validateAdapterOrNull(environment.adapter, "reference adapter");
  validateDisplayOrNull(environment.browserDisplay, "reference display");
  validateHostOrNull(environment.host, "reference host");
  validateHostOrNull(environment.hostAfterRuns, "reference post-run host");
  validateGpuDevices(environment.gpuDevices, "reference GPU devices");
  const gate = requireRecord(environment.gateIdentity, "environment gate");
  requireExactKeys(
    gate,
    gate.state === "invalid" ? ["reasons", "state", "value"] : ["state", "value"],
    "environment gate",
  );
  if (
    (gate.state !== "measured" && gate.state !== "invalid") ||
    typeof gate.value !== "boolean" ||
    (gate.state === "measured" && gate.value !== true) ||
    (gate.state === "invalid" &&
      (gate.value !== false ||
        !Array.isArray(gate.reasons) ||
        gate.reasons.some((reason) => !nonEmptyString(reason))))
  ) {
    throw new Error("Reference environment gate is invalid");
  }
  return environment;
}

function validateMeasuredEnvironment(value: unknown, label: string): Record<string, unknown> {
  const environment = requireRecord(value, label);
  requireExactKeys(
    environment,
    [
      "adapter",
      "browserCommandLine",
      "browserDisplayAfter",
      "browserDisplayBefore",
      "browserProduct",
      "browserRevision",
      "browserUserAgent",
      "gpuDevices",
      "hostAfter",
      "hostBefore",
      "jsVersion",
      "executableSha256",
      "requestedTier",
      "sandboxVerified",
      "targetDisplayMode",
    ],
    label,
  );
  for (const key of [
    "browserCommandLine",
    "browserProduct",
    "browserRevision",
    "browserUserAgent",
    "jsVersion",
    "requestedTier",
    "targetDisplayMode",
  ]) {
    if (!nonEmptyString(environment[key])) throw new Error(`${label} ${key} is invalid`);
  }
  validateAdapter(environment.adapter, `${label} adapter`);
  validateDisplay(environment.browserDisplayBefore, `${label} display`);
  validateHost(environment.hostBefore, `${label} host`);
  validateDisplayOrNull(environment.browserDisplayAfter, `${label} post display`);
  validateHostOrNull(environment.hostAfter, `${label} post host`);
  validateGpuDevices(environment.gpuDevices, `${label} GPU devices`);
  requireHex(environment.executableSha256, HEX_64, `${label} Chrome executable digest`);
  const adapter = requireRecord(environment.adapter, `${label} adapter`);
  const hostBefore = requireRecord(environment.hostBefore, `${label} host`);
  const hostAfter = requireRecord(environment.hostAfter, `${label} post host`);
  if (
    environment.sandboxVerified !== true ||
    adapter.isFallbackAdapter !== false ||
    !validMeasuredChromeCommandLine(String(environment.browserCommandLine)) ||
    !validTierAndDisplay(
      environment.requestedTier,
      environment.targetDisplayMode,
      environment.browserDisplayBefore,
    ) ||
    !validTierAndDisplay(
      environment.requestedTier,
      environment.targetDisplayMode,
      environment.browserDisplayAfter,
    ) ||
    hostBefore.remoteSession !== false ||
    hostAfter.remoteSession !== false
  ) {
    throw new Error(`${label} GPU/sandbox evidence is invalid`);
  }
  return environment;
}

export function renderRecoveryEnvironmentMatchesReference(
  actual: Record<string, unknown>,
  reference: Record<string, unknown>,
  chromePin: Record<string, unknown>,
): boolean {
  const adapter = requireRecord(actual.adapter, "measured adapter");
  const referenceAdapter = isRecord(reference.adapter) ? reference.adapter : null;
  return (
    referenceEnvironmentIsEligible(reference, chromePin) &&
    referenceAdapter !== null &&
    actual.sandboxVerified === true &&
    actual.browserProduct === `Chrome/${String(chromePin.version)}` &&
    actual.executableSha256 === reference.executableSha256 &&
    actual.requestedTier === reference.requestedTier &&
    actual.targetDisplayMode === reference.targetDisplayMode &&
    actual.browserProduct === reference.browserProduct &&
    actual.browserRevision === reference.browserRevision &&
    actual.browserUserAgent === reference.browserUserAgent &&
    actual.jsVersion === reference.jsVersion &&
    same(actual.gpuDevices, reference.gpuDevices) &&
    Array.isArray(actual.gpuDevices) &&
    actual.gpuDevices.length > 0 &&
    same(actual.browserDisplayBefore, reference.browserDisplay) &&
    same(actual.browserDisplayAfter, reference.browserDisplay) &&
    same(actual.hostBefore, reference.host) &&
    same(actual.hostAfter, reference.host) &&
    adapter.architecture === referenceAdapter.architecture &&
    adapter.isFallbackAdapter === referenceAdapter.isFallbackAdapter &&
    adapter.vendor === referenceAdapter.vendor &&
    typeof actual.browserCommandLine === "string" &&
    validMeasuredChromeCommandLine(actual.browserCommandLine) &&
    validTierAndDisplay(
      actual.requestedTier,
      actual.targetDisplayMode,
      actual.browserDisplayBefore,
    ) &&
    validTierAndDisplay(
      actual.requestedTier,
      actual.targetDisplayMode,
      actual.browserDisplayAfter,
    ) &&
    !requireRecord(actual.hostBefore, "measured host").remoteSession &&
    !requireRecord(actual.hostAfter, "measured post-run host").remoteSession
  );
}

function referenceEnvironmentIsEligible(
  reference: Record<string, unknown>,
  chromePin: Record<string, unknown>,
): boolean {
  const digests = requireRecord(chromePin.executableSha256, "Chrome executable digests");
  const adapter = isRecord(reference.adapter) ? reference.adapter : null;
  const host = isRecord(reference.host) ? reference.host : null;
  const hostAfter = isRecord(reference.hostAfterRuns) ? reference.hostAfterRuns : null;
  return (
    reference.browserProduct === `Chrome/${String(chromePin.version)}` &&
    Object.values(digests).includes(reference.executableSha256) &&
    reference.sandboxVerified === true &&
    typeof reference.identityProbeBrowserCommandLine === "string" &&
    validMeasuredChromeCommandLine(reference.identityProbeBrowserCommandLine) &&
    adapter !== null &&
    adapter.isFallbackAdapter === false &&
    Array.isArray(reference.gpuDevices) &&
    reference.gpuDevices.length > 0 &&
    host !== null &&
    hostAfter !== null &&
    host.remoteSession === false &&
    hostAfter.remoteSession === false &&
    same(host, hostAfter) &&
    validTierAndDisplay(
      reference.requestedTier,
      reference.targetDisplayMode,
      reference.browserDisplay,
    )
  );
}

function validateFlythrough(value: unknown, label: string): void {
  const flythrough = requireRecord(value, label);
  requireExactKeys(flythrough, ["failureMessage", "state"], label);
  if (
    (flythrough.failureMessage !== null && typeof flythrough.failureMessage !== "string") ||
    ![
      "completed",
      "disposed",
      "failed",
      "idle",
      "preflighting",
      "prepared",
      "running",
      "stabilizing",
    ].includes(String(flythrough.state))
  ) {
    throw new Error(`${label} is invalid`);
  }
}

function validMeasuredChromeCommandLine(commandLine: string): boolean {
  return (
    commandLine.includes("--start-fullscreen") &&
    !/--(?:no-sandbox|headless|disable-gpu|use-angle=swiftshader)(?:\s|=|$)/i.test(commandLine)
  );
}

function validTierAndDisplay(tier: unknown, targetMode: unknown, display: unknown): boolean {
  if (
    (tier !== "showcase" && tier !== "standard") ||
    targetMode !== QUALITY_TIER_PROFILES[tier].targetDisplayMode ||
    !isRecord(display) ||
    !Array.isArray(display.probeFailures) ||
    display.probeFailures.length !== 0 ||
    !isRecord(display.screen)
  ) {
    return false;
  }
  const profile = QUALITY_TIER_PROFILES[tier];
  const physicalWidth = Number(display.screen.width) * Number(display.screen.devicePixelRatio);
  const physicalHeight = Number(display.screen.height) * Number(display.screen.devicePixelRatio);
  return (
    Math.abs(physicalWidth - profile.renderSurface.width) <= 2 &&
    Math.abs(physicalHeight - profile.renderSurface.height) <= 2 &&
    Array.isArray(display.refreshRatesHz) &&
    display.refreshRatesHz.some(
      (rate) =>
        typeof rate === "number" &&
        Math.abs(rate - profile.refreshRateHz) <= Math.max(1, profile.refreshRateHz * 0.01),
    )
  );
}

function validateFacets(value: unknown): {
  budgetEvaluation: Record<string, unknown>;
  environment: Record<string, unknown>;
  evidenceCompleteness: Record<string, unknown>;
} {
  const facets = requireRecord(value, "facets");
  requireExactKeys(facets, ["budgetEvaluation", "environment", "evidenceCompleteness"], "facets");
  const budget = requireRecord(facets.budgetEvaluation, "budget facet");
  requireExactKeys(budget, ["evaluatedChecks", "reasons", "status"], "budget facet");
  if (
    !nonNegativeInteger(budget.evaluatedChecks) ||
    !["failed", "not-evaluated", "passed"].includes(String(budget.status))
  ) {
    throw new Error("Render-recovery budget facet is invalid");
  }
  const budgetReasons = requireStringArray(budget.reasons, "budget facet reasons");
  if (
    (budget.status === "passed" && budgetReasons.length !== 0) ||
    (budget.status !== "passed" && budgetReasons.length === 0)
  ) {
    throw new Error("Render-recovery budget facet reasons contradict its status");
  }
  const environment = validateBinaryFacet(facets.environment, "environment facet");
  const evidenceCompleteness = validateBinaryFacet(facets.evidenceCompleteness, "evidence facet");
  return { budgetEvaluation: budget, environment, evidenceCompleteness };
}

function validateBinaryFacet(value: unknown, label: string): Record<string, unknown> {
  const facet = requireRecord(value, label);
  requireExactKeys(facet, ["reasons", "status"], label);
  const reasons = requireStringArray(facet.reasons, `${label} reasons`);
  if (facet.status !== "failed" && facet.status !== "passed") {
    throw new Error(`${label} status is invalid`);
  }
  if (
    (facet.status === "passed" && reasons.length !== 0) ||
    (facet.status === "failed" && reasons.length === 0)
  ) {
    throw new Error(`${label} reasons contradict its status`);
  }
  return facet;
}

function validateProfileLineage(value: unknown, id: string): void {
  const lineage = requireRecord(value, `${id} profile lineage`);
  requireExactKeys(lineage, ["history", "id"], `${id} profile lineage`);
  if (
    lineage.id !== `independent-fresh-${id}` ||
    !Array.isArray(lineage.history) ||
    lineage.history.length !== 1 ||
    lineage.history[0] !== "fresh"
  ) {
    throw new Error(`${id} fresh-profile lineage is invalid`);
  }
}

function validateVec3Array(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => !isVec3(entry))) {
    throw new Error(`${label} is invalid`);
  }
}

function validateVec3ArrayAllowEmpty(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.some((entry) => !isVec3(entry))) {
    throw new Error(`${label} is invalid`);
  }
}

function validateVec3(value: unknown, label: string): void {
  if (!isVec3(value)) throw new Error(`${label} is invalid`);
}

function isVec3(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((component) => typeof component === "number" && Number.isFinite(component))
  );
}

function validateVisibleCanvasFields(value: unknown, label: string): void {
  requireExactKeys(
    requireRecord(value, label),
    ["clearColorRgb", "height", "pngSha256", "visiblePixelCount", "visiblePixelRatio", "width"],
    label,
  );
}

function validateAdapterOrNull(value: unknown, label: string): void {
  if (value !== null) validateAdapter(value, label);
}

function validateAdapter(value: unknown, label: string): void {
  const adapter = requireRecord(value, label);
  requireExactKeys(
    adapter,
    [
      "architecture",
      "backend",
      "description",
      "device",
      "driver",
      "isFallbackAdapter",
      "type",
      "vendor",
    ],
    label,
  );
  for (const key of ["architecture", "description", "device", "vendor"]) {
    if (typeof adapter[key] !== "string") throw new Error(`${label} ${key} is invalid`);
  }
  for (const key of ["backend", "driver", "type"]) {
    if (adapter[key] !== null && typeof adapter[key] !== "string") {
      throw new Error(`${label} ${key} is invalid`);
    }
  }
  if (typeof adapter.isFallbackAdapter !== "boolean") {
    throw new Error(`${label} fallback identity is invalid`);
  }
}

function validateDisplayOrNull(value: unknown, label: string): void {
  if (value !== null) validateDisplay(value, label);
}

function validateDisplay(value: unknown, label: string): void {
  const display = requireRecord(value, label);
  requireExactKeys(display, ["probeFailures", "refreshRatesHz", "screen"], label);
  requireStringArray(display.probeFailures, `${label} probe failures`);
  if (
    !Array.isArray(display.refreshRatesHz) ||
    display.refreshRatesHz.some((rate) => !positiveFinite(rate))
  ) {
    throw new Error(`${label} refresh rates are invalid`);
  }
  if (display.screen === null) return;
  const screen = requireRecord(display.screen, `${label} screen`);
  requireExactKeys(
    screen,
    ["availHeight", "availWidth", "colorDepth", "devicePixelRatio", "height", "width"],
    `${label} screen`,
  );
  if (Object.values(screen).some((entry) => !positiveFinite(entry))) {
    throw new Error(`${label} screen dimensions are invalid`);
  }
}

function validateGpuDevices(value: unknown, label: string): void {
  if (!Array.isArray(value)) throw new Error(`${label} are invalid`);
  for (const [index, entry] of value.entries()) {
    const device = requireRecord(entry, `${label} ${index}`);
    requireExactKeys(
      device,
      [
        "deviceId",
        "deviceString",
        "driverVendor",
        "driverVersion",
        "revision",
        "subSysId",
        "vendorId",
        "vendorString",
      ],
      `${label} ${index}`,
    );
    for (const key of ["deviceId", "revision", "subSysId", "vendorId"]) {
      if (!nonNegativeInteger(device[key])) throw new Error(`${label} ${index} ${key} is invalid`);
    }
    for (const key of ["deviceString", "driverVendor", "driverVersion", "vendorString"]) {
      if (typeof device[key] !== "string") throw new Error(`${label} ${index} ${key} is invalid`);
    }
  }
}

function validateHostOrNull(value: unknown, label: string): void {
  if (value !== null) validateHost(value, label);
}

function validateHost(value: unknown, label: string): void {
  const host = requireRecord(value, label);
  requireExactKeys(
    host,
    ["cpu", "os", "physicalMemoryBytes", "power", "remoteSession", "videoControllers"],
    label,
  );
  const cpu = requireRecord(host.cpu, `${label} CPU`);
  requireExactKeys(cpu, ["cores", "logicalProcessors", "name"], `${label} CPU`);
  if (
    !positiveInteger(cpu.cores) ||
    !positiveInteger(cpu.logicalProcessors) ||
    !nonEmptyString(cpu.name)
  ) {
    throw new Error(`${label} CPU is invalid`);
  }
  const os = requireRecord(host.os, `${label} OS`);
  requireExactKeys(os, ["build", "caption"], `${label} OS`);
  if (!nonEmptyString(os.build) || !nonEmptyString(os.caption))
    throw new Error(`${label} OS is invalid`);
  const power = requireRecord(host.power, `${label} power`);
  requireExactKeys(power, ["guid", "name"], `${label} power`);
  if (!nonEmptyString(power.guid) || (power.name !== null && typeof power.name !== "string")) {
    throw new Error(`${label} power identity is invalid`);
  }
  if (!positiveFinite(host.physicalMemoryBytes) || typeof host.remoteSession !== "boolean") {
    throw new Error(`${label} memory/session identity is invalid`);
  }
  if (!Array.isArray(host.videoControllers))
    throw new Error(`${label} video controllers are invalid`);
  for (const [index, entry] of host.videoControllers.entries()) {
    const controller = requireRecord(entry, `${label} video controller ${index}`);
    requireExactKeys(
      controller,
      ["driverVersion", "height", "name", "pnpDeviceId", "refreshRateHz", "width"],
      `${label} video controller ${index}`,
    );
    for (const key of ["driverVersion", "name", "pnpDeviceId"]) {
      if (typeof controller[key] !== "string") {
        throw new Error(`${label} video controller ${index} ${key} is invalid`);
      }
    }
    for (const key of ["height", "refreshRateHz", "width"]) {
      if (controller[key] !== null && !positiveFinite(controller[key])) {
        throw new Error(`${label} video controller ${index} ${key} is invalid`);
      }
    }
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Render-recovery ${label} is missing`);
  return value;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw new Error(`Render-recovery ${label} fields are invalid`);
  }
}

function requireStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Render-recovery ${label} is invalid`);
  }
  return value;
}

function requireStringRecord(value: unknown, label: string, hexValues: boolean): void {
  const record = requireRecord(value, label);
  if (
    Object.keys(record).length === 0 ||
    Object.values(record).some(
      (entry) =>
        typeof entry !== "string" || entry.length === 0 || (hexValues && !HEX_64.test(entry)),
    )
  ) {
    throw new Error(`Render-recovery ${label} is invalid`);
  }
}

function requireHex(value: unknown, expression: RegExp, label: string): void {
  if (typeof value !== "string" || !expression.test(value)) {
    throw new Error(`Render-recovery ${label} is invalid`);
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function nonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
