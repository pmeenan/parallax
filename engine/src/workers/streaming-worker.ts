import type { OpfsSyncAccessHandle } from "../storage/opfs-read-spike-worker-core";
import {
  type DecodeWorkerRequest,
  type DecodeWorkerResponse,
  type RenderStreamingRequest,
  type RenderStreamingResponse,
  STREAMING_RESIDENT_CELL_LIMIT,
  STREAMING_RESIDENT_ENCODED_BUDGET_BYTES,
  STREAMING_TELEMETRY_SCHEMA_VERSION,
  type StreamingCellIndexEntry,
  type StreamingCellLoadTelemetry,
  type StreamingDistrictIndex,
  type StreamingWorkerRequest,
  type StreamingWorkerResponse,
  type WorldStreamingTelemetrySnapshot,
} from "../streaming/streaming-protocol";
import {
  scheduleStreamingCells,
  streamingDecodeWorkerCount,
} from "../streaming/streaming-scheduler";
import type { GreyboxCell, WorldVec3 } from "../world/world-contract";

const DECODE_WORKER_ARTIFACT = "./__DECODE_WORKER_ARTIFACT__";
const OPFS_DIRECTORY = "parallax-streaming-v1";
const LOAD_SAMPLE_LIMIT = 256;
const RENDER_REQUEST_TIMEOUT_MS = 5_000;
const DISPOSAL_DRAIN_TIMEOUT_MS = 5_000;

interface DevelopmentImportMeta extends ImportMeta {
  readonly env?: { readonly DEV?: boolean };
}

interface StreamingWorkerScope {
  onmessage: ((event: MessageEvent<StreamingWorkerRequest>) => void) | null;
  postMessage(message: StreamingWorkerResponse): void;
}

interface BuildManifestShape {
  readonly gameContentEntrypoints: readonly Readonly<{
    districtId: string;
    path: string;
    schemaVersion: number;
  }>[];
  readonly schemaVersion: number;
}

interface DecodeResult {
  readonly cell: GreyboxCell;
  readonly decodeMs: number;
  readonly encodedBytes: number;
}

interface DecodeTask {
  readonly bytes: ArrayBuffer;
  readonly cellId: string;
  readonly districtId: string;
  readonly reject: (error: Error) => void;
  readonly resolve: (result: DecodeResult) => void;
  readonly schemaVersion: 1;
  readonly taskId: number;
}

interface DecodeSlot {
  busy: boolean;
  readonly worker: Worker;
}

interface ResidentCell {
  readonly encodedBytes: number;
  readonly gpuBytes: number;
}

interface OpfsFileHandle extends FileSystemFileHandle {
  createSyncAccessHandle(): Promise<OpfsSyncAccessHandle>;
}

function decodeWorkerUrl(): URL {
  return (import.meta as DevelopmentImportMeta).env?.DEV === true
    ? new URL("./decode-worker.ts", import.meta.url)
    : new URL(DECODE_WORKER_ARTIFACT, import.meta.url);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : String(error);
}

async function sha256Hex(bytes: BufferSource): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function districtDirectoryName(districtId: string): Promise<string> {
  return `district-${await sha256Hex(new TextEncoder().encode(districtId))}`;
}

function initialTelemetry(): WorldStreamingTelemetrySnapshot {
  return Object.freeze({
    cellLoadSamples: Object.freeze([]),
    cellLoadSampleCount: 0,
    cpuBudgetRejectionCount: 0,
    decodeQueueDepthHighWater: 0,
    decodeWorkerCount: 0,
    encodedBytesRead: 0,
    failureMessage: null,
    hardwareConcurrency: navigator.hardwareConcurrency,
    opfsProvisionedBytes: 0,
    proactiveEvictionCount: 0,
    residentCellCount: 0,
    residentEncodedBytes: 0,
    residentEncodedBytesHighWater: 0,
    residentGpuBytes: 0,
    residentGpuBytesHighWater: 0,
    schemaVersion: STREAMING_TELEMETRY_SCHEMA_VERSION,
    state: "idle",
  });
}

function startStreamingWorker(): void {
  const scope = globalThis as unknown as StreamingWorkerScope;
  let telemetry = initialTelemetry();
  let disposed = false;
  let started = false;
  let index: StreamingDistrictIndex | null = null;
  let observers: readonly WorldVec3[] = Object.freeze([]);
  let renderPort: MessagePort | null = null;
  let rootDirectory: FileSystemDirectoryHandle | null = null;
  let scheduleRequested = false;
  let scheduling = false;
  let ready = false;
  let reservedEncodedBytes = 0;
  let nextTaskId = 1;
  let nextRenderRequestId = 1;
  let recordCellLoadSamples = false;
  const residents = new Map<string, ResidentCell>();
  const decodeSlots: DecodeSlot[] = [];
  const decodeQueue: DecodeTask[] = [];
  const decodeTasks = new Map<number, DecodeTask>();
  const renderRequests = new Map<
    number,
    {
      readonly reject: (error: Error) => void;
      readonly resolve: (response: RenderStreamingResponse) => void;
      readonly timeout: ReturnType<typeof setTimeout>;
    }
  >();

  const publish = (patch: Partial<WorldStreamingTelemetrySnapshot> = {}): void => {
    telemetry = Object.freeze({
      ...telemetry,
      ...patch,
      cellLoadSamples: Object.freeze(
        (patch.cellLoadSamples ?? telemetry.cellLoadSamples).slice(-LOAD_SAMPLE_LIMIT),
      ),
      residentCellCount: residents.size,
      residentEncodedBytes: [...residents.values()].reduce(
        (sum, resident) => sum + resident.encodedBytes,
        0,
      ),
      residentGpuBytes: [...residents.values()].reduce(
        (sum, resident) => sum + resident.gpuBytes,
        0,
      ),
    });
    scope.postMessage({ kind: "telemetry", snapshot: telemetry });
  };

  const fail = (error: unknown): void => {
    if (disposed || telemetry.state === "failed") return;
    const message = errorMessage(error);
    telemetry = Object.freeze({ ...telemetry, failureMessage: message, state: "failed" });
    scope.postMessage({ kind: "failure", message, snapshot: telemetry });
    for (const slot of decodeSlots) slot.worker.terminate();
    decodeSlots.length = 0;
    for (const task of decodeQueue.splice(0)) {
      task.reject(new Error(`Queued decode ${task.taskId} cancelled: ${message}`));
    }
    for (const [taskId, task] of decodeTasks) {
      task.reject(new Error(`Active decode ${taskId} cancelled: ${message}`));
    }
    decodeTasks.clear();
    for (const [requestId, pending] of renderRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Render streaming request ${requestId} cancelled: ${message}`));
    }
    renderRequests.clear();
    renderPort?.close();
    renderPort = null;
  };

  const pumpDecodeQueue = (): void => {
    for (const slot of decodeSlots) {
      if (slot.busy) continue;
      const task = decodeQueue.shift();
      if (task === undefined) break;
      slot.busy = true;
      decodeTasks.set(task.taskId, task);
      slot.worker.postMessage(
        {
          bytes: task.bytes,
          cellId: task.cellId,
          districtId: task.districtId,
          kind: "decode-cell",
          schemaVersion: task.schemaVersion,
          taskId: task.taskId,
        } satisfies DecodeWorkerRequest,
        [task.bytes],
      );
    }
  };

  const createDecodePool = (): void => {
    const workerCount = streamingDecodeWorkerCount(navigator.hardwareConcurrency);
    for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
      const worker = new Worker(decodeWorkerUrl(), {
        name: `parallax-decode-${workerIndex}`,
        type: "module",
      });
      const slot: DecodeSlot = { busy: false, worker };
      worker.onmessage = (event: MessageEvent<DecodeWorkerResponse>): void => {
        const response = event.data;
        const task = decodeTasks.get(response.taskId);
        if (task === undefined) {
          fail(`Decode worker returned unknown task ${response.taskId}`);
          return;
        }
        decodeTasks.delete(response.taskId);
        slot.busy = false;
        if (response.kind === "decode-failure") {
          task.reject(new Error(response.message));
        } else {
          task.resolve(response);
        }
        pumpDecodeQueue();
      };
      worker.onmessageerror = (): void =>
        fail(`Decode worker ${workerIndex} response was unreadable`);
      worker.onerror = (event): void =>
        fail(event.message || `Decode worker ${workerIndex} failed to load`);
      decodeSlots.push(slot);
    }
    publish({ decodeWorkerCount: workerCount });
  };

  const decode = (entry: StreamingCellIndexEntry, bytes: ArrayBuffer): Promise<DecodeResult> =>
    new Promise((resolve, reject) => {
      const task: DecodeTask = {
        bytes,
        cellId: entry.cellId,
        districtId: index?.districtId ?? "",
        reject,
        resolve,
        schemaVersion: 1,
        taskId: nextTaskId,
      };
      nextTaskId += 1;
      decodeQueue.push(task);
      publish({
        decodeQueueDepthHighWater: Math.max(
          telemetry.decodeQueueDepthHighWater,
          decodeQueue.length + decodeTasks.size,
        ),
      });
      pumpDecodeQueue();
    });

  const requestRender = (request: RenderStreamingRequest): Promise<RenderStreamingResponse> =>
    new Promise((resolve, reject) => {
      if (renderPort === null) {
        reject(new Error("Render streaming port is unavailable"));
        return;
      }
      const timeout = setTimeout(() => {
        renderRequests.delete(request.requestId);
        reject(
          new Error(
            `Render streaming request ${request.requestId} timed out after ${RENDER_REQUEST_TIMEOUT_MS} ms`,
          ),
        );
      }, RENDER_REQUEST_TIMEOUT_MS);
      renderRequests.set(request.requestId, { reject, resolve, timeout });
      renderPort.postMessage(request);
    });

  const openCellFile = async (entry: StreamingCellIndexEntry): Promise<FileSystemFileHandle> => {
    if (rootDirectory === null) throw new Error("Streaming OPFS directory is unavailable");
    return rootDirectory.getFileHandle(`${entry.sha256}.cell`, { create: false });
  };

  const readCell = async (
    entry: StreamingCellIndexEntry,
  ): Promise<
    Readonly<{
      bytes: ArrayBuffer;
      readMs: number;
    }>
  > => {
    const handle = await openCellFile(entry);
    const access = await (handle as OpfsFileHandle).createSyncAccessHandle();
    try {
      const size = access.getSize();
      if (size !== entry.bytes) {
        throw new Error(`OPFS cell ${entry.cellId} has ${size} bytes; expected ${entry.bytes}`);
      }
      const bytes = new Uint8Array(size);
      const startedAt = performance.now();
      const readBytes = access.read(bytes, { at: 0 });
      const readMs = performance.now() - startedAt;
      if (readBytes !== size) {
        throw new Error(`OPFS cell ${entry.cellId} read ${readBytes} of ${size} bytes`);
      }
      return Object.freeze({ bytes: bytes.buffer, readMs });
    } finally {
      access.close();
    }
  };

  const loadCell = async (entry: StreamingCellIndexEntry): Promise<void> => {
    if (residents.has(entry.cellId)) return;
    const totalStartedAt = performance.now();
    const { bytes, readMs } = await readCell(entry);
    const decoded = await decode(entry, bytes);
    const projectedEncodedBytes =
      [...residents.values()].reduce((sum, resident) => sum + resident.encodedBytes, 0) +
      reservedEncodedBytes +
      decoded.encodedBytes;
    if (projectedEncodedBytes > STREAMING_RESIDENT_ENCODED_BUDGET_BYTES) {
      publish({ cpuBudgetRejectionCount: telemetry.cpuBudgetRejectionCount + 1 });
      throw new Error(
        `Streaming encoded residency ${projectedEncodedBytes} exceeds ${STREAMING_RESIDENT_ENCODED_BUDGET_BYTES}`,
      );
    }
    reservedEncodedBytes += decoded.encodedBytes;
    let response: Extract<RenderStreamingResponse, { kind: "stream-cell-complete" }>;
    try {
      const uploadRequestId = nextRenderRequestId;
      nextRenderRequestId += 1;
      const uploadResponse = await requestRender({
        cell: decoded.cell,
        cellId: entry.cellId,
        encodedBytes: decoded.encodedBytes,
        kind: "stream-cell",
        requestId: uploadRequestId,
      });
      if (uploadResponse.kind !== "stream-cell-complete") {
        throw new Error(`Unexpected render response while loading ${entry.cellId}`);
      }
      const commitRequestId = nextRenderRequestId;
      nextRenderRequestId += 1;
      const commitResponse = await requestRender({
        cellId: entry.cellId,
        kind: "commit-cell",
        requestId: commitRequestId,
        uploadRequestId,
      });
      if (commitResponse.kind !== "commit-cell-complete") {
        throw new Error(`Unexpected render commit response while loading ${entry.cellId}`);
      }
      response = uploadResponse;
      residents.set(entry.cellId, {
        encodedBytes: decoded.encodedBytes,
        gpuBytes: response.gpuBytes,
      });
    } finally {
      reservedEncodedBytes -= decoded.encodedBytes;
    }
    const residentEncodedBytes = [...residents.values()].reduce(
      (sum, resident) => sum + resident.encodedBytes,
      0,
    );
    const residentGpuBytes = [...residents.values()].reduce(
      (sum, resident) => sum + resident.gpuBytes,
      0,
    );
    const sample: StreamingCellLoadTelemetry = Object.freeze({
      cellId: entry.cellId,
      decodeMs: decoded.decodeMs,
      encodedBytes: decoded.encodedBytes,
      gpuBytes: response.gpuBytes,
      opfsReadMs: readMs,
      sequence: telemetry.cellLoadSampleCount + 1,
      totalMs: performance.now() - totalStartedAt,
      uploadMs: response.uploadMs,
    });
    publish({
      cellLoadSamples: recordCellLoadSamples
        ? Object.freeze([...telemetry.cellLoadSamples, sample])
        : telemetry.cellLoadSamples,
      cellLoadSampleCount: recordCellLoadSamples
        ? telemetry.cellLoadSampleCount + 1
        : telemetry.cellLoadSampleCount,
      encodedBytesRead: telemetry.encodedBytesRead + decoded.encodedBytes,
      residentEncodedBytesHighWater: Math.max(
        telemetry.residentEncodedBytesHighWater,
        projectedEncodedBytes,
        residentEncodedBytes,
      ),
      residentGpuBytesHighWater: Math.max(telemetry.residentGpuBytesHighWater, residentGpuBytes),
    });
  };

  const evictCell = async (entry: StreamingCellIndexEntry): Promise<void> => {
    const resident = residents.get(entry.cellId);
    if (resident === undefined) return;
    const requestId = nextRenderRequestId;
    nextRenderRequestId += 1;
    const response = await requestRender({
      cellId: entry.cellId,
      kind: "evict-cell",
      requestId,
    });
    if (response.kind !== "evict-cell-complete" || response.freedGpuBytes !== resident.gpuBytes) {
      throw new Error(`Render eviction accounting mismatch for ${entry.cellId}`);
    }
    residents.delete(entry.cellId);
    publish({ proactiveEvictionCount: telemetry.proactiveEvictionCount + 1 });
  };

  const runSchedule = async (): Promise<void> => {
    if (scheduling || !ready || index === null || observers.length === 0 || disposed) return;
    scheduling = true;
    try {
      do {
        scheduleRequested = false;
        const schedule = scheduleStreamingCells(
          index,
          observers,
          new Set(residents.keys()),
          STREAMING_RESIDENT_CELL_LIMIT,
        );
        for (const entry of schedule.evict) await evictCell(entry);
        await Promise.all(schedule.load.map((entry) => loadCell(entry)));
      } while (scheduleRequested && !disposed);
      publish({ state: "streaming" });
    } finally {
      scheduling = false;
    }
  };

  const provision = async (entry: StreamingCellIndexEntry, baseUrl: URL): Promise<number> => {
    if (rootDirectory === null) throw new Error("Streaming OPFS directory is unavailable");
    const handle = await rootDirectory.getFileHandle(`${entry.sha256}.cell`, { create: true });
    const existing = await handle.getFile();
    if (
      existing.size === entry.bytes &&
      (await sha256Hex(await existing.arrayBuffer())) === entry.sha256
    ) {
      return 0;
    }
    const response = await fetch(new URL(entry.path, baseUrl));
    if (!response.ok) throw new Error(`Cell fetch failed (${response.status}): ${entry.path}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== entry.bytes) {
      throw new Error(
        `Fetched cell ${entry.cellId} has ${bytes.byteLength} bytes; expected ${entry.bytes}`,
      );
    }
    const digest = await sha256Hex(bytes);
    if (digest !== entry.sha256) throw new Error(`Fetched cell ${entry.cellId} failed SHA-256`);
    const access = await (handle as OpfsFileHandle).createSyncAccessHandle();
    try {
      access.truncate(0);
      const written = access.write(new Uint8Array(bytes), { at: 0 });
      if (written !== bytes.byteLength) {
        throw new Error(`OPFS cell ${entry.cellId} wrote ${written} of ${bytes.byteLength} bytes`);
      }
      access.flush();
    } finally {
      access.close();
    }
    return bytes.byteLength;
  };

  const removeStalePackages = async (entries: readonly StreamingCellIndexEntry[]) => {
    if (rootDirectory === null) throw new Error("Streaming OPFS directory is unavailable");
    const expectedNames = new Set(entries.map((entry) => `${entry.sha256}.cell`));
    for await (const name of rootDirectory.keys()) {
      if (!expectedNames.has(name)) await rootDirectory.removeEntry(name);
    }
  };

  const initialize = async (request: Extract<StreamingWorkerRequest, { kind: "start" }>) => {
    renderPort = request.renderPort;
    renderPort.onmessage = (event: MessageEvent<RenderStreamingResponse>): void => {
      const response = event.data;
      const pending = renderRequests.get(response.requestId);
      if (pending === undefined) {
        fail(`Render worker returned unknown streaming request ${response.requestId}`);
        return;
      }
      renderRequests.delete(response.requestId);
      clearTimeout(pending.timeout);
      if (response.kind === "streaming-render-failure") {
        pending.reject(new Error(response.message));
      } else {
        pending.resolve(response);
      }
    };
    renderPort.onmessageerror = (): void => fail("Render streaming response was unreadable");
    renderPort.start();
    observers = Object.freeze(
      request.initialObservers.map((observer) => Object.freeze([...observer]) as WorldVec3),
    );
    publish({ state: "provisioning" });
    const manifestResponse = await fetch(request.buildManifestUrl);
    if (!manifestResponse.ok)
      throw new Error(`Build manifest fetch failed (${manifestResponse.status})`);
    const manifest = (await manifestResponse.json()) as BuildManifestShape;
    const entrypoint = manifest.gameContentEntrypoints.find(
      (candidate) => candidate.districtId === request.districtId,
    );
    if (entrypoint === undefined)
      throw new Error(`District ${request.districtId} is not in the build manifest`);
    const indexUrl = new URL(entrypoint.path, manifestResponse.url);
    const indexResponse = await fetch(indexUrl);
    if (!indexResponse.ok) throw new Error(`District index fetch failed (${indexResponse.status})`);
    index = (await indexResponse.json()) as StreamingDistrictIndex;
    if (
      index.districtId !== request.districtId ||
      index.schemaVersion !== 1 ||
      index.cells.length === 0
    ) {
      throw new Error(`District index identity is invalid for ${request.districtId}`);
    }
    const opfsRoot = await navigator.storage.getDirectory();
    const streamingRoot = await opfsRoot.getDirectoryHandle(OPFS_DIRECTORY, {
      create: true,
    });
    for await (const [name, handle] of streamingRoot.entries()) {
      if (handle.kind === "file" && name.endsWith(".cell")) {
        await streamingRoot.removeEntry(name);
      }
    }
    rootDirectory = await streamingRoot.getDirectoryHandle(
      await districtDirectoryName(index.districtId),
      { create: true },
    );
    let provisionedBytes = 0;
    for (let offset = 0; offset < index.cells.length; offset += 8) {
      const batch = index.cells.slice(offset, offset + 8);
      const written = await Promise.all(
        batch.map((entry) => provision(entry, new URL(manifestResponse.url))),
      );
      provisionedBytes += written.reduce((sum, value) => sum + value, 0);
      publish({ opfsProvisionedBytes: provisionedBytes });
    }
    await removeStalePackages(index.cells);
    createDecodePool();
    ready = true;
    await runSchedule();
    // Initial residency is launch hydration, not a movement-triggered streaming
    // observation. The smoke contract measures subsequent player-driven replacements.
    recordCellLoadSamples = true;
  };

  scope.onmessage = (event): void => {
    const request = event.data;
    if (request.kind === "dispose") {
      disposed = true;
      ready = false;
      scheduleRequested = false;
      void (async () => {
        const drainDeadline = performance.now() + DISPOSAL_DRAIN_TIMEOUT_MS;
        while (scheduling && performance.now() < drainDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (scheduling) {
          throw new Error(
            `Streaming scheduling did not drain within ${DISPOSAL_DRAIN_TIMEOUT_MS} ms`,
          );
        }
        if (index !== null) {
          const byId = new Map(index.cells.map((entry) => [entry.cellId, entry]));
          for (const cellId of [...residents.keys()]) {
            const entry = byId.get(cellId);
            if (entry === undefined)
              throw new Error(`Resident cell ${cellId} is absent from index`);
            await evictCell(entry);
          }
        }
        for (const slot of decodeSlots) slot.worker.terminate();
        decodeSlots.length = 0;
        telemetry = Object.freeze({ ...telemetry, state: "disposed" });
        scope.postMessage({ kind: "disposed", snapshot: telemetry });
        renderPort?.close();
        renderPort = null;
      })().catch((error: unknown) => {
        disposed = false;
        fail(error);
      });
      return;
    }
    if (request.kind === "observers") {
      observers = Object.freeze(
        request.observers.map((observer) => Object.freeze([...observer]) as WorldVec3),
      );
      scheduleRequested = true;
      void runSchedule().catch(fail);
      return;
    }
    if (started) {
      fail("Streaming worker received more than one start request");
      return;
    }
    started = true;
    void initialize(request).catch(fail);
  };
}

startStreamingWorker();
