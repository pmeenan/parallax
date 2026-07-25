import type { WasmThreadSpikeTelemetrySnapshot } from "@parallax/engine";
import {
  SMOKE_WASM_THREAD_MEMORY_PAGES,
  SMOKE_WASM_THREAD_TASK_COUNT,
  SMOKE_WASM_THREAD_WORKER_COUNT,
} from "./runs/smoke.js";

export type WasmThreadSpikeMetric =
  | Readonly<{ readonly state: "measured"; readonly value: WasmThreadSpikeTelemetrySnapshot }>
  | Readonly<{ readonly reason: string; readonly state: "invalid" }>;

export function resolveWasmThreadSpikeMetric(
  snapshot: WasmThreadSpikeTelemetrySnapshot,
): WasmThreadSpikeMetric {
  const expectedMask = (1 << SMOKE_WASM_THREAD_WORKER_COUNT) - 1;
  if (snapshot.state !== "completed") {
    const failure =
      snapshot.failureMessage ?? `WASM thread spike did not complete; observed ${snapshot.state}`;
    return invalid(`${failure}; terminal phase evidence: ${formatTerminalPhaseEvidence(snapshot)}`);
  }
  if (
    snapshot.failureMessage !== null ||
    snapshot.taskCount !== SMOKE_WASM_THREAD_TASK_COUNT ||
    snapshot.workerCount !== SMOKE_WASM_THREAD_WORKER_COUNT ||
    snapshot.memoryBytes !== SMOKE_WASM_THREAD_MEMORY_PAGES * 65_536 ||
    snapshot.completedTasks !== SMOKE_WASM_THREAD_TASK_COUNT ||
    snapshot.processedTasksByWorker.length !== SMOKE_WASM_THREAD_WORKER_COUNT ||
    snapshot.processedTasksByWorker.some((count) => !Number.isSafeInteger(count) || count <= 0) ||
    snapshot.processedTasksByWorker.reduce((total, count) => total + count, 0) !==
      SMOKE_WASM_THREAD_TASK_COUNT ||
    snapshot.workerMask !== expectedMask ||
    snapshot.checksum === null ||
    snapshot.checksum !== snapshot.referenceChecksum ||
    snapshot.runtimeStateAfterInitialization === null ||
    snapshot.runtimeStateAfterInitialization.sharedInitializationState !== 2 ||
    snapshot.runtimeStateAfterInitialization.initializedInstanceCount !==
      SMOKE_WASM_THREAD_WORKER_COUNT ||
    snapshot.runtimeStateAfterInitialization.allocatorLock !== 0 ||
    snapshot.runtimeStateAtFailure !== null ||
    snapshot.workerPhases.length !== SMOKE_WASM_THREAD_WORKER_COUNT ||
    snapshot.workerPhases.some((phase) => phase !== "ready") ||
    !positiveFinite(snapshot.elapsedMs) ||
    !positiveFinite(snapshot.moduleLoadAndCompileElapsedMs) ||
    !positiveFinite(snapshot.workerInitializationElapsedMs) ||
    !positiveFinite(snapshot.parallelExecutionElapsedMs) ||
    !Number.isSafeInteger(snapshot.moduleBytes) ||
    (snapshot.moduleBytes ?? 0) <= 0
  ) {
    return invalid("WASM thread spike completed with missing or contract-drifted evidence");
  }
  return Object.freeze({ state: "measured", value: Object.freeze({ ...snapshot }) });
}

export function requireWasmThreadSpikeCompleteAtMeasurementBoundary(
  snapshot: WasmThreadSpikeTelemetrySnapshot,
): WasmThreadSpikeMetric & Readonly<{ readonly state: "measured" }> {
  const metric = resolveWasmThreadSpikeMetric(snapshot);
  if (metric.state !== "measured") {
    throw new Error(`WASM thread spike was not complete at the boundary: ${metric.reason}`);
  }
  return metric;
}

function positiveFinite(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function invalid(reason: string): WasmThreadSpikeMetric {
  return Object.freeze({ reason, state: "invalid" });
}

function formatTerminalPhaseEvidence(snapshot: WasmThreadSpikeTelemetrySnapshot): string {
  const phase =
    snapshot.moduleLoadAndCompileElapsedMs === null
      ? "module-fetch-or-compile"
      : snapshot.workerInitializationElapsedMs === null
        ? "worker-initialization"
        : snapshot.parallelExecutionElapsedMs === null
          ? "reset-or-parallel-execution"
          : "final-snapshot";
  return [
    `phase=${phase}`,
    `moduleBytes=${formatNullable(snapshot.moduleBytes)}`,
    `moduleLoadAndCompileMs=${formatNullable(snapshot.moduleLoadAndCompileElapsedMs)}`,
    `workerInitializationMs=${formatNullable(snapshot.workerInitializationElapsedMs)}`,
    `parallelExecutionMs=${formatNullable(snapshot.parallelExecutionElapsedMs)}`,
    `completedTasks=${snapshot.completedTasks}`,
    `processedTasksByWorker=[${snapshot.processedTasksByWorker.join(",")}]`,
    `workerMask=0x${snapshot.workerMask.toString(16)}`,
    `workerPhases=[${snapshot.workerPhases.join(",")}]`,
    `runtimeStateAfterInitialization=${formatRuntimeState(snapshot.runtimeStateAfterInitialization)}`,
    `runtimeStateAtFailure=${formatRuntimeState(snapshot.runtimeStateAtFailure)}`,
  ].join(", ");
}

function formatNullable(value: number | null): string {
  return value === null ? "null" : value.toFixed(3);
}

function formatRuntimeState(
  value: WasmThreadSpikeTelemetrySnapshot["runtimeStateAfterInitialization"],
): string {
  return value === null
    ? "null"
    : `{sharedInitializationState=${value.sharedInitializationState},initializedInstanceCount=${value.initializedInstanceCount},allocatorLock=${value.allocatorLock}}`;
}
