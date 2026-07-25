// wasm-bindgen 0.2.126 raises the linker's fixed 32-page shared-memory import by one
// page for its thread transform. Browser instantiation and the gate fail loudly if that changes.
export const WASM_THREAD_SPIKE_MEMORY_PAGES = 33;
export const WASM_THREAD_SPIKE_TASK_COUNT = 262_144;
export const WASM_THREAD_SPIKE_THREAD_STACK_BYTES = 65_536;
export const WASM_THREAD_SPIKE_TIMEOUT_MS = 10_000;
export const WASM_THREAD_SPIKE_WORKER_COUNT = 2;
// These are exact relocated offsets in the pinned nightly-2026-07-16 /
// wasm-bindgen 0.2.126 fixture, not a general wasm-bindgen ABI. build-wasm.mjs
// disassembles every generated and optimized output and fails if the runtime layout
// or the dlmalloc/thread-scratch separation drifts.
export const WASM_THREAD_SPIKE_RUNTIME_STATE_OFFSETS = Object.freeze({
  allocatorLock: 2_097_156,
  initializedInstanceCount: 2_097_152,
  sharedInitializationState: 1_050_040,
});

export interface WasmThreadSpikeInitializeRequest {
  readonly kind: "initialize";
  readonly memory: WebAssembly.Memory;
  readonly module: WebAssembly.Module;
  readonly threadStackBytes: number;
  readonly workerCount: number;
  readonly workerIndex: number;
}

export interface WasmThreadSpikeResetRequest {
  readonly kind: "reset";
  readonly taskCount: number;
}

export interface WasmThreadSpikeRunRequest {
  readonly kind: "run";
}

export interface WasmThreadSpikeSnapshotRequest {
  readonly kind: "snapshot";
  readonly taskCount: number;
}

export type WasmThreadSpikeWorkerRequest =
  | WasmThreadSpikeInitializeRequest
  | WasmThreadSpikeResetRequest
  | WasmThreadSpikeRunRequest
  | WasmThreadSpikeSnapshotRequest;

export interface WasmThreadSpikeReadyResponse {
  readonly kind: "ready";
  readonly workerIndex: number;
}

export type WasmThreadSpikeWorkerPhase =
  | "script-evaluated"
  | "initialize-received"
  | "module-instantiation-started"
  | "module-instantiated"
  | "runtime-startup-started"
  | "runtime-started";

export type WasmThreadSpikeWorkerLifecyclePhase =
  | "not-created"
  | "created"
  | WasmThreadSpikeWorkerPhase
  | "ready";

export interface WasmThreadSpikeRuntimeState {
  readonly allocatorLock: number;
  readonly initializedInstanceCount: number;
  readonly sharedInitializationState: number;
}

export interface WasmThreadSpikePhaseResponse {
  readonly kind: "phase";
  readonly phase: WasmThreadSpikeWorkerPhase;
  readonly workerIndex: number | null;
}

export interface WasmThreadSpikeResetResponse {
  readonly kind: "reset-complete";
}

export interface WasmThreadSpikeRunResponse {
  readonly claimedTasks: number;
  readonly kind: "run-complete";
  readonly workerIndex: number;
}

export interface WasmThreadSpikeSnapshotResponse {
  readonly checksum: number;
  readonly completedTasks: number;
  readonly kind: "snapshot";
  readonly referenceChecksum: number;
  readonly workerMask: number;
}

export interface WasmThreadSpikeFailureResponse {
  readonly kind: "failure";
  readonly message: string;
  readonly workerIndex: number | null;
}

export type WasmThreadSpikeWorkerResponse =
  | WasmThreadSpikeFailureResponse
  | WasmThreadSpikePhaseResponse
  | WasmThreadSpikeReadyResponse
  | WasmThreadSpikeResetResponse
  | WasmThreadSpikeRunResponse
  | WasmThreadSpikeSnapshotResponse;

export interface WasmThreadSpikeTelemetrySnapshot {
  readonly checksum: number | null;
  readonly completedTasks: number;
  readonly elapsedMs: number | null;
  readonly failureMessage: string | null;
  readonly memoryBytes: number;
  readonly moduleLoadAndCompileElapsedMs: number | null;
  readonly moduleBytes: number | null;
  readonly parallelExecutionElapsedMs: number | null;
  readonly processedTasksByWorker: readonly number[];
  readonly referenceChecksum: number | null;
  readonly runtimeStateAfterInitialization: WasmThreadSpikeRuntimeState | null;
  readonly runtimeStateAtFailure: WasmThreadSpikeRuntimeState | null;
  readonly state: "idle" | "running" | "completed" | "failed";
  readonly taskCount: number;
  readonly workerCount: number;
  readonly workerPhases: readonly WasmThreadSpikeWorkerLifecyclePhase[];
  readonly workerMask: number;
  readonly workerInitializationElapsedMs: number | null;
}
