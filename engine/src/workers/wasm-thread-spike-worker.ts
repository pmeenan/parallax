import {
  checksum,
  completed_tasks as completedTasks,
  initSync,
  reference_checksum as referenceChecksum,
  reset,
  run,
  worker_mask as workerMask,
} from "../../wasm/thread-spike/pkg/thread_spike.js";
import type {
  WasmThreadSpikeWorkerPhase,
  WasmThreadSpikeWorkerRequest,
  WasmThreadSpikeWorkerResponse,
} from "../wasm/wasm-thread-spike-protocol";

interface WasmThreadWorkerScope {
  onmessage: ((event: MessageEvent<WasmThreadSpikeWorkerRequest>) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: WasmThreadSpikeWorkerResponse): void;
}

const workerScope = globalThis as unknown as WasmThreadWorkerScope;
let initialized = false;
let workerIndex: number | null = null;
let workerCount: number | null = null;

workerScope.postMessage({ kind: "phase", phase: "script-evaluated", workerIndex });

function postFailure(error: unknown): void {
  workerScope.postMessage({
    kind: "failure",
    message: error instanceof Error ? error.message : String(error),
    workerIndex,
  });
}

workerScope.onmessageerror = (): void => {
  postFailure("WASM thread-spike worker message failed to deserialize");
};

workerScope.onmessage = (event): void => {
  const message = event.data;
  try {
    switch (message.kind) {
      case "initialize":
        if (initialized) throw new Error("WASM thread-spike worker initialized more than once");
        workerIndex = message.workerIndex;
        workerCount = message.workerCount;
        workerScope.postMessage({ kind: "phase", phase: "initialize-received", workerIndex });
        initSync({
          memory: message.memory,
          module: message.module,
          on_phase: postInitializationPhase,
          thread_stack_size: message.threadStackBytes,
        });
        initialized = true;
        workerScope.postMessage({ kind: "ready", workerIndex });
        break;
      case "reset":
        requireInitialized();
        reset(message.taskCount);
        workerScope.postMessage({ kind: "reset-complete" });
        break;
      case "run": {
        requireInitialized();
        const index = workerIndex;
        const count = workerCount;
        if (index === null || count === null) throw new Error("Worker identity is unavailable");
        const claimedTasks = run(index, count);
        workerScope.postMessage({ claimedTasks, kind: "run-complete", workerIndex: index });
        break;
      }
      case "snapshot":
        requireInitialized();
        workerScope.postMessage({
          checksum: checksum(),
          completedTasks: completedTasks(),
          kind: "snapshot",
          referenceChecksum: referenceChecksum(message.taskCount),
          workerMask: workerMask(),
        });
        break;
    }
  } catch (error: unknown) {
    postFailure(error);
  }
};

function postInitializationPhase(phase: string): void {
  if (!isInitializationPhase(phase)) {
    throw new Error(`WASM thread-spike binding reported unknown initialization phase ${phase}`);
  }
  workerScope.postMessage({ kind: "phase", phase, workerIndex });
}

function isInitializationPhase(phase: string): phase is WasmThreadSpikeWorkerPhase {
  return (
    phase === "module-instantiation-started" ||
    phase === "module-instantiated" ||
    phase === "runtime-startup-started" ||
    phase === "runtime-started"
  );
}

function requireInitialized(): void {
  if (!initialized) throw new Error("WASM thread-spike worker received work before initialization");
}
