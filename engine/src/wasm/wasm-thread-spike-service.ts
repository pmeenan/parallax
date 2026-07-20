import {
  WASM_THREAD_SPIKE_MEMORY_PAGES,
  WASM_THREAD_SPIKE_TASK_COUNT,
  WASM_THREAD_SPIKE_THREAD_STACK_BYTES,
  WASM_THREAD_SPIKE_TIMEOUT_MS,
  WASM_THREAD_SPIKE_WORKER_COUNT,
  type WasmThreadSpikeTelemetrySnapshot,
  type WasmThreadSpikeWorkerRequest,
  type WasmThreadSpikeWorkerResponse,
} from "./wasm-thread-spike-protocol";

export type WasmThreadSpikeListener = (snapshot: WasmThreadSpikeTelemetrySnapshot) => void;

export interface WasmThreadSpikeService {
  dispose(): void;
  snapshot(): WasmThreadSpikeTelemetrySnapshot;
  start(): void;
  subscribe(listener: WasmThreadSpikeListener): () => void;
}

const WORKER_ARTIFACT = "./__WASM_THREAD_WORKER_ARTIFACT__";
const WASM_ARTIFACT = "./__WASM_THREAD_SPIKE_ARTIFACT__";

interface DevelopmentImportMeta extends ImportMeta {
  readonly env?: { readonly DEV?: boolean };
}

export function createWasmThreadSpikeService(): WasmThreadSpikeService {
  const listeners = new Set<WasmThreadSpikeListener>();
  const workers: Worker[] = [];
  let disposed = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let startedAt: number | null = null;
  let readyWorkers = 0;
  let completedWorkers = 0;
  let workerInitializationStartedAt: number | null = null;
  let executionStartedAt: number | null = null;
  let telemetry = freezeTelemetry({
    checksum: null,
    completedTasks: 0,
    elapsedMs: null,
    failureMessage: null,
    memoryBytes: WASM_THREAD_SPIKE_MEMORY_PAGES * 65_536,
    moduleLoadAndCompileElapsedMs: null,
    moduleBytes: null,
    parallelExecutionElapsedMs: null,
    processedTasksByWorker: Array.from({ length: WASM_THREAD_SPIKE_WORKER_COUNT }, () => 0),
    referenceChecksum: null,
    state: "idle",
    taskCount: WASM_THREAD_SPIKE_TASK_COUNT,
    workerCount: WASM_THREAD_SPIKE_WORKER_COUNT,
    workerMask: 0,
    workerInitializationElapsedMs: null,
  });

  const publish = (next: WasmThreadSpikeTelemetrySnapshot): void => {
    telemetry = freezeTelemetry(next);
    for (const listener of listeners) {
      try {
        listener(telemetry);
      } catch (error: unknown) {
        console.error("WASM thread-spike telemetry listener failed", error);
      }
    }
  };

  const cleanup = (): void => {
    if (timeout !== null) clearTimeout(timeout);
    timeout = null;
    for (const worker of workers) worker.terminate();
    workers.length = 0;
  };

  const fail = (message: string): void => {
    if (disposed || telemetry.state === "completed" || telemetry.state === "failed") return;
    cleanup();
    publish({ ...telemetry, failureMessage: message, state: "failed" });
  };

  const post = (worker: Worker, message: WasmThreadSpikeWorkerRequest): void => {
    worker.postMessage(message);
  };

  const handleMessage = (workerIndex: number, message: WasmThreadSpikeWorkerResponse): void => {
    if (disposed || telemetry.state !== "running") return;
    switch (message.kind) {
      case "failure":
        fail(`worker ${String(message.workerIndex ?? workerIndex)}: ${message.message}`);
        break;
      case "ready":
        readyWorkers += 1;
        if (readyWorkers === WASM_THREAD_SPIKE_WORKER_COUNT) {
          if (workerInitializationStartedAt === null) {
            throw new Error("WASM worker initialization timing is unavailable");
          }
          publish({
            ...telemetry,
            workerInitializationElapsedMs: performance.now() - workerInitializationStartedAt,
          });
          const coordinator = workers[0];
          if (coordinator === undefined) throw new Error("WASM thread coordinator is missing");
          post(coordinator, { kind: "reset", taskCount: WASM_THREAD_SPIKE_TASK_COUNT });
        }
        break;
      case "reset-complete":
        executionStartedAt = performance.now();
        for (const worker of workers) post(worker, { kind: "run" });
        break;
      case "run-complete": {
        const processedTasksByWorker = [...telemetry.processedTasksByWorker];
        processedTasksByWorker[message.workerIndex] = message.claimedTasks;
        completedWorkers += 1;
        if (completedWorkers === WASM_THREAD_SPIKE_WORKER_COUNT) {
          if (executionStartedAt === null) {
            throw new Error("WASM parallel execution completed before timing started");
          }
          publish({
            ...telemetry,
            parallelExecutionElapsedMs: performance.now() - executionStartedAt,
            processedTasksByWorker,
          });
          const coordinator = workers[0];
          if (coordinator === undefined) throw new Error("WASM thread coordinator is missing");
          post(coordinator, { kind: "snapshot", taskCount: WASM_THREAD_SPIKE_TASK_COUNT });
        } else {
          publish({ ...telemetry, processedTasksByWorker });
        }
        break;
      }
      case "snapshot": {
        if (startedAt === null || executionStartedAt === null) {
          throw new Error("WASM thread spike completed before timing started");
        }
        const expectedMask = (1 << WASM_THREAD_SPIKE_WORKER_COUNT) - 1;
        const claimedTotal = telemetry.processedTasksByWorker.reduce(
          (total, count) => total + count,
          0,
        );
        const failure =
          message.completedTasks !== WASM_THREAD_SPIKE_TASK_COUNT ||
          claimedTotal !== WASM_THREAD_SPIKE_TASK_COUNT ||
          message.checksum !== message.referenceChecksum ||
          message.workerMask !== expectedMask ||
          telemetry.processedTasksByWorker.some((count) => count === 0);
        cleanup();
        publish({
          ...telemetry,
          checksum: message.checksum,
          completedTasks: message.completedTasks,
          elapsedMs: performance.now() - startedAt,
          failureMessage: failure
            ? "WASM thread spike failed correctness or participation checks"
            : null,
          referenceChecksum: message.referenceChecksum,
          state: failure ? "failed" : "completed",
          workerMask: message.workerMask,
        });
        break;
      }
    }
  };

  return Object.freeze({
    dispose(): void {
      disposed = true;
      cleanup();
    },

    snapshot(): WasmThreadSpikeTelemetrySnapshot {
      return telemetry;
    },

    start(): void {
      if (disposed || telemetry.state !== "idle") return;
      startedAt = performance.now();
      publish({ ...telemetry, state: "running" });
      timeout = setTimeout(
        () => fail(`WASM thread spike exceeded ${WASM_THREAD_SPIKE_TIMEOUT_MS} ms`),
        WASM_THREAD_SPIKE_TIMEOUT_MS,
      );
      void (async (): Promise<void> => {
        const moduleLoadStartedAt = performance.now();
        const response = await fetch(wasmArtifactUrl());
        if (disposed || telemetry.state !== "running") return;
        if (!response.ok) throw new Error(`WASM artifact fetch failed with ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (disposed || telemetry.state !== "running") return;
        const module = await WebAssembly.compile(bytes);
        if (disposed || telemetry.state !== "running") return;
        const memory = new WebAssembly.Memory({
          initial: WASM_THREAD_SPIKE_MEMORY_PAGES,
          maximum: WASM_THREAD_SPIKE_MEMORY_PAGES,
          shared: true,
        });
        if (!(memory.buffer instanceof SharedArrayBuffer)) {
          throw new Error("WASM shared memory did not produce a SharedArrayBuffer");
        }
        publish({
          ...telemetry,
          moduleBytes: bytes.byteLength,
          moduleLoadAndCompileElapsedMs: performance.now() - moduleLoadStartedAt,
        });
        if (disposed || telemetry.state !== "running") return;
        workerInitializationStartedAt = performance.now();
        for (let workerIndex = 0; workerIndex < WASM_THREAD_SPIKE_WORKER_COUNT; workerIndex += 1) {
          const worker = new Worker(workerArtifactUrl(), {
            name: `parallax-wasm-thread-${workerIndex}`,
            type: "module",
          });
          workers.push(worker);
          worker.onmessage = (event: MessageEvent<WasmThreadSpikeWorkerResponse>): void => {
            try {
              handleMessage(workerIndex, event.data);
            } catch (error: unknown) {
              fail(error instanceof Error ? error.message : String(error));
            }
          };
          worker.onmessageerror = (): void => fail(`worker ${workerIndex} response was unreadable`);
          worker.onerror = (event): void =>
            fail(
              event instanceof ErrorEvent && event.message !== ""
                ? event.message
                : `worker ${workerIndex} failed`,
            );
          post(worker, {
            kind: "initialize",
            memory,
            module,
            threadStackBytes: WASM_THREAD_SPIKE_THREAD_STACK_BYTES,
            workerCount: WASM_THREAD_SPIKE_WORKER_COUNT,
            workerIndex,
          });
        }
      })().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
    },

    subscribe(listener: WasmThreadSpikeListener): () => void {
      listeners.add(listener);
      listener(telemetry);
      return () => listeners.delete(listener);
    },
  });
}

function workerArtifactUrl(): URL {
  const development = (import.meta as DevelopmentImportMeta).env?.DEV === true;
  return development
    ? new URL("../workers/wasm-thread-spike-worker.ts", import.meta.url)
    : new URL(WORKER_ARTIFACT, import.meta.url);
}

function wasmArtifactUrl(): URL {
  const development = (import.meta as DevelopmentImportMeta).env?.DEV === true;
  return development
    ? new URL("../../wasm/thread-spike/pkg/thread_spike_bg.wasm", import.meta.url)
    : new URL(WASM_ARTIFACT, import.meta.url);
}

function freezeTelemetry(
  telemetry: WasmThreadSpikeTelemetrySnapshot,
): WasmThreadSpikeTelemetrySnapshot {
  return Object.freeze({
    ...telemetry,
    processedTasksByWorker: Object.freeze([...telemetry.processedTasksByWorker]),
  });
}
