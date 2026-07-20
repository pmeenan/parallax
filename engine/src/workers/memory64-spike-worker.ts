import {
  MEMORY64_SPIKE_COLD_SAMPLE_COUNT,
  MEMORY64_SPIKE_COMPILE_BATCH_ITERATIONS,
  MEMORY64_SPIKE_HIGH_ADDRESS,
  MEMORY64_SPIKE_HIGH_PAGES,
  MEMORY64_SPIKE_HIGH_SENTINEL,
  MEMORY64_SPIKE_INSTANTIATE_BATCH_ITERATIONS,
  MEMORY64_SPIKE_KERNEL_ROUNDS,
  MEMORY64_SPIKE_MEASURED_SAMPLE_COUNT,
  MEMORY64_SPIKE_PREPARED_PAGES,
  MEMORY64_SPIKE_WARMUP_SAMPLE_COUNT,
  type Memory64SpikeHighAddressTelemetry,
  type Memory64SpikeRunRequest,
  type Memory64SpikeSample,
  type Memory64SpikeSamplePhase,
  type Memory64SpikeVariant,
  type Memory64SpikeVariantTelemetry,
  type Memory64SpikeWorkerResponse,
} from "../wasm/memory64-spike-protocol";

interface SpikeExports extends WebAssembly.Exports {
  readonly memory: WebAssembly.Memory;
  readonly prepare: () => bigint | number;
  readonly run: (rounds: number) => number;
  readonly grow_and_touch_high?: () => number;
}

interface LoadedVariant {
  readonly bytes: ArrayBuffer;
  readonly fetchElapsedMs: number;
  readonly variant: Memory64SpikeVariant;
}

interface VariantAccumulator {
  readonly fetchElapsedMs: number;
  readonly moduleBytes: number;
  readonly samples: Memory64SpikeSample[];
  readonly variant: Memory64SpikeVariant;
}

interface LoadBatchRequest {
  readonly kind: "measure-load";
  readonly order: readonly Readonly<{
    readonly bytes: ArrayBuffer;
    readonly variant: Memory64SpikeVariant;
  }>[];
  readonly phase: Memory64SpikeSamplePhase;
}

interface LoadTiming {
  readonly compileElapsedMs: number;
  readonly instantiateElapsedMs: number;
}

type LoadBatchResponse =
  | Readonly<{
      readonly kind: "load-completed";
      readonly timings: Readonly<Record<Memory64SpikeVariant, LoadTiming>>;
    }>
  | Readonly<{ readonly failureMessage: string; readonly kind: "load-failure" }>;

type WorkerRequest = LoadBatchRequest | Memory64SpikeRunRequest;

interface Memory64WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: LoadBatchResponse | Memory64SpikeWorkerResponse): void;
}

const workerScope = globalThis as unknown as Memory64WorkerScope;

workerScope.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  if (event.data.kind === "measure-load") {
    try {
      workerScope.postMessage(measureLoadBatch(event.data));
    } catch (error: unknown) {
      workerScope.postMessage({
        failureMessage: error instanceof Error ? error.message : String(error),
        kind: "load-failure",
      });
    }
    return;
  }
  void run(event.data).then(
    (response) => workerScope.postMessage(response),
    (error: unknown) =>
      workerScope.postMessage({
        failureMessage: error instanceof Error ? error.message : String(error),
        kind: "failure",
      } satisfies Memory64SpikeWorkerResponse),
  );
};

async function run(request: Memory64SpikeRunRequest): Promise<Memory64SpikeWorkerResponse> {
  const startedAt = performance.now();
  const [memory32, memory64] = await Promise.all([
    fetchVariant("memory32", request.memory32Url),
    fetchVariant("memory64", request.memory64Url),
  ]);
  const accumulators: Record<Memory64SpikeVariant, VariantAccumulator> = {
    memory32: accumulator(memory32),
    memory64: accumulator(memory64),
  };
  let lastMemory64Instance: WebAssembly.Instance | null = null;
  const totalSamples =
    MEMORY64_SPIKE_COLD_SAMPLE_COUNT +
    MEMORY64_SPIKE_WARMUP_SAMPLE_COUNT +
    MEMORY64_SPIKE_MEASURED_SAMPLE_COUNT;
  for (let ordinal = 0; ordinal < totalSamples; ordinal += 1) {
    const order: readonly LoadedVariant[] =
      ordinal % 2 === 0 ? [memory32, memory64] : [memory64, memory32];
    const phase = phaseForOrdinal(ordinal);
    const loadTimings = await measureLoadInIsolate(request.workerUrl, order, phase);
    for (const loaded of order) {
      const result = measureKernelSample(loaded, loadTimings[loaded.variant], ordinal, phase);
      accumulators[loaded.variant].samples.push(result.sample);
      if (loaded.variant === "memory64") lastMemory64Instance = result.instance;
    }
  }
  if (lastMemory64Instance === null) throw new Error("Memory64 instance was not retained");
  const highAddress = proveHighAddress(lastMemory64Instance);
  return Object.freeze({
    highAddress,
    kind: "completed",
    memory32: freezeVariant(accumulators.memory32),
    memory64: freezeVariant(accumulators.memory64),
    totalElapsedMs: performance.now() - startedAt,
  });
}

async function fetchVariant(variant: Memory64SpikeVariant, url: string): Promise<LoadedVariant> {
  const startedAt = performance.now();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${variant} fetch failed with ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) throw new Error(`${variant} artifact was empty`);
  return Object.freeze({ bytes, fetchElapsedMs: performance.now() - startedAt, variant });
}

function accumulator(loaded: LoadedVariant): VariantAccumulator {
  return {
    fetchElapsedMs: loaded.fetchElapsedMs,
    moduleBytes: loaded.bytes.byteLength,
    samples: [],
    variant: loaded.variant,
  };
}

function measureKernelSample(
  loaded: LoadedVariant,
  loadTiming: LoadTiming,
  ordinal: number,
  phase: Memory64SpikeSamplePhase,
): Readonly<{ instance: WebAssembly.Instance; sample: Memory64SpikeSample }> {
  const module = new WebAssembly.Module(loaded.bytes);
  const memory = createMemory(loaded.variant);
  const instance = new WebAssembly.Instance(module, { env: { memory } });
  const exports = requireSpikeExports(instance, loaded.variant);
  let startedAt = performance.now();
  const preparedPages = exports.prepare();
  const prepareElapsedMs = performance.now() - startedAt;
  if (Number(preparedPages) !== MEMORY64_SPIKE_PREPARED_PAGES) {
    throw new Error(
      `${loaded.variant} prepared ${String(preparedPages)} pages, expected ${MEMORY64_SPIKE_PREPARED_PAGES}`,
    );
  }
  const logicalMemoryBytes = exports.memory.buffer.byteLength;
  if (logicalMemoryBytes !== MEMORY64_SPIKE_PREPARED_PAGES * 65_536) {
    throw new Error(`${loaded.variant} exposed ${logicalMemoryBytes} bytes after prepare`);
  }
  startedAt = performance.now();
  const checksum = exports.run(MEMORY64_SPIKE_KERNEL_ROUNDS);
  const kernelElapsedMs = performance.now() - startedAt;
  return Object.freeze({
    instance,
    sample: Object.freeze({
      checksum,
      compileElapsedMs: loadTiming.compileElapsedMs,
      instantiateElapsedMs: loadTiming.instantiateElapsedMs,
      kernelElapsedMs,
      logicalMemoryBytes,
      ordinal,
      phase,
      prepareElapsedMs,
    }),
  });
}

function measureLoadBatch(
  request: LoadBatchRequest,
): Extract<LoadBatchResponse, { kind: "load-completed" }> {
  const timings = {} as Record<Memory64SpikeVariant, LoadTiming>;
  for (const loaded of request.order) {
    const compileIterations =
      request.phase === "cold" ? 1 : MEMORY64_SPIKE_COMPILE_BATCH_ITERATIONS;
    let startedAt = performance.now();
    let module: WebAssembly.Module | null = null;
    for (let iteration = 0; iteration < compileIterations; iteration += 1) {
      module = new WebAssembly.Module(loaded.bytes);
    }
    const compileElapsedMs = performance.now() - startedAt;
    if (module === null) throw new Error(`${loaded.variant} compile batch produced no module`);
    const memory = createMemory(loaded.variant);
    const instantiateIterations =
      request.phase === "cold" ? 1 : MEMORY64_SPIKE_INSTANTIATE_BATCH_ITERATIONS;
    startedAt = performance.now();
    let instance: WebAssembly.Instance | null = null;
    for (let iteration = 0; iteration < instantiateIterations; iteration += 1) {
      instance = new WebAssembly.Instance(module, { env: { memory } });
    }
    const instantiateElapsedMs = performance.now() - startedAt;
    if (instance === null) {
      throw new Error(`${loaded.variant} instantiate batch produced no instance`);
    }
    requireSpikeExports(instance, loaded.variant);
    timings[loaded.variant] = Object.freeze({ compileElapsedMs, instantiateElapsedMs });
  }
  if (timings.memory32 === undefined || timings.memory64 === undefined) {
    throw new Error("Load batch omitted one variant");
  }
  return Object.freeze({ kind: "load-completed", timings: Object.freeze(timings) });
}

function measureLoadInIsolate(
  workerUrl: string,
  order: readonly LoadedVariant[],
  phase: Memory64SpikeSamplePhase,
): Promise<Readonly<Record<Memory64SpikeVariant, LoadTiming>>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, { name: "parallax-memory64-load-sample", type: "module" });
    const cleanup = (): void => worker.terminate();
    worker.onmessage = (event: MessageEvent<LoadBatchResponse>): void => {
      cleanup();
      if (event.data.kind === "load-failure") reject(new Error(event.data.failureMessage));
      else resolve(event.data.timings);
    };
    worker.onmessageerror = (): void => {
      cleanup();
      reject(new Error("Memory64 load-sample worker response was unreadable"));
    };
    worker.onerror = (event): void => {
      cleanup();
      reject(new Error(event.message || "Memory64 load-sample worker failed"));
    };
    worker.postMessage({
      kind: "measure-load",
      order: order.map((loaded) => ({ bytes: loaded.bytes, variant: loaded.variant })),
      phase,
    } satisfies LoadBatchRequest);
  });
}

function createMemory(variant: Memory64SpikeVariant): WebAssembly.Memory {
  // TypeScript 7's DOM library still models only Number-valued memory32 descriptors;
  // Chrome 150's standardized memory64 descriptor requires BigInt initial/maximum values.
  return variant === "memory64"
    ? new WebAssembly.Memory({
        address: "i64",
        initial: 1n,
        maximum: 65_537n,
      } as unknown as WebAssembly.MemoryDescriptor)
    : new WebAssembly.Memory({ initial: 1, maximum: 65_536 });
}

function proveHighAddress(instance: WebAssembly.Instance): Memory64SpikeHighAddressTelemetry {
  const exports = requireSpikeExports(instance, "memory64");
  if (exports.grow_and_touch_high === undefined) {
    throw new Error("Memory64 high-address proof export is missing");
  }
  const startedAt = performance.now();
  const sentinelReturned = exports.grow_and_touch_high();
  const growAndTouchElapsedMs = performance.now() - startedAt;
  const logicalMemoryBytes = exports.memory.buffer.byteLength;
  if (sentinelReturned !== MEMORY64_SPIKE_HIGH_SENTINEL) {
    throw new Error(`Memory64 high-address export returned ${sentinelReturned}`);
  }
  if (logicalMemoryBytes !== MEMORY64_SPIKE_HIGH_PAGES * 65_536) {
    throw new Error(`Memory64 high-address proof exposed ${logicalMemoryBytes} bytes`);
  }
  const sentinelRead = new DataView(
    exports.memory.buffer,
    MEMORY64_SPIKE_HIGH_ADDRESS,
    Uint32Array.BYTES_PER_ELEMENT,
  ).getUint32(0, true);
  if (sentinelRead !== MEMORY64_SPIKE_HIGH_SENTINEL) {
    throw new Error(`Memory64 byte at the exact high address was ${sentinelRead}`);
  }
  return Object.freeze({
    address: MEMORY64_SPIKE_HIGH_ADDRESS,
    growAndTouchElapsedMs,
    logicalMemoryBytes,
    pages: MEMORY64_SPIKE_HIGH_PAGES,
    sentinelRead,
    sentinelReturned,
    sentinelWritten: MEMORY64_SPIKE_HIGH_SENTINEL,
  });
}

function requireSpikeExports(
  instance: WebAssembly.Instance,
  variant: Memory64SpikeVariant,
): SpikeExports {
  const exports = instance.exports as Partial<SpikeExports>;
  if (
    !(exports.memory instanceof WebAssembly.Memory) ||
    typeof exports.prepare !== "function" ||
    typeof exports.run !== "function" ||
    (variant === "memory64" && typeof exports.grow_and_touch_high !== "function")
  ) {
    throw new Error(`${variant} exports do not match the spike contract`);
  }
  return exports as SpikeExports;
}

function phaseForOrdinal(ordinal: number): Memory64SpikeSamplePhase {
  if (ordinal < MEMORY64_SPIKE_COLD_SAMPLE_COUNT) return "cold";
  if (ordinal < MEMORY64_SPIKE_COLD_SAMPLE_COUNT + MEMORY64_SPIKE_WARMUP_SAMPLE_COUNT) {
    return "warmup";
  }
  return "measured";
}

function freezeVariant(accumulator: VariantAccumulator): Memory64SpikeVariantTelemetry {
  return Object.freeze({
    fetchElapsedMs: accumulator.fetchElapsedMs,
    moduleBytes: accumulator.moduleBytes,
    samples: Object.freeze([...accumulator.samples]),
    variant: accumulator.variant,
  });
}
