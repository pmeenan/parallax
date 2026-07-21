// wasm-bindgen 0.2.126 raises the linker's fixed 32-page shared-memory import by one
// page for its thread transform. Browser instantiation and the gate fail loudly if that changes.
export const WASM_THREAD_SPIKE_MEMORY_PAGES = 33;
export const WASM_THREAD_SPIKE_TASK_COUNT = 262_144;
export const WASM_THREAD_SPIKE_THREAD_STACK_BYTES = 65_536;
export const WASM_THREAD_SPIKE_TIMEOUT_MS = 10_000;
export const WASM_THREAD_SPIKE_WORKER_COUNT = 2;

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
  | "module-instantiated";

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
  readonly state: "idle" | "running" | "completed" | "failed";
  readonly taskCount: number;
  readonly workerCount: number;
  readonly workerMask: number;
  readonly workerInitializationElapsedMs: number | null;
}
