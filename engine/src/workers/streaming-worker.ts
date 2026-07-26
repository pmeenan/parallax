import {
  createOpfsSyncAccessHandleCache,
  type OpfsSyncAccessHandle,
} from "../storage/opfs-sync-access-handle";
import { createFlythroughObserverProtocol } from "../streaming/flythrough-observer-protocol";
import {
  type DecodeWorkerRequest,
  type DecodeWorkerResponse,
  type RenderStreamingRequest,
  type RenderStreamingResponse,
  type RenderToStreamingMessage,
  STREAMING_RESIDENT_CELL_LIMIT,
  STREAMING_RESIDENT_ENCODED_BUDGET_BYTES,
  STREAMING_TELEMETRY_SCHEMA_VERSION,
  type StreamingCellIndexEntry,
  type StreamingCellLoadTelemetry,
  type StreamingDistrictIndex,
  type StreamingRecoveryCheckpoint,
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

interface LoadBatchIdentity {
  readonly cellCount: number;
  readonly cellOrdinal: number;
  readonly flythroughObserverSequence: number;
  readonly observerUpdateCount: number;
  readonly ordinal: number;
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

function appendCloseFailures(message: string, failures: readonly unknown[]): string {
  return failures.length === 0
    ? message
    : `${message}; OPFS access-handle cleanup failed: ${failures.map(errorMessage).join("; ")}`;
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
    currentObservers: Object.freeze([]),
    decodeQueueDepthHighWater: 0,
    decodeWorkerCount: 0,
    encodedBytesRead: 0,
    failureMessage: null,
    hardwareConcurrency: navigator.hardwareConcurrency,
    flythroughObserverUpdateCount: 0,
    observerUpdateCount: 0,
    opfsAccessHandleCount: 0,
    opfsAccessHandleOpenDurationMs: 0,
    opfsPackageCount: 0,
    opfsProvisionedBytes: 0,
    proactiveEvictionCount: 0,
    residentCellCount: 0,
    residentCellIds: Object.freeze([]),
    residentEncodedBytes: 0,
    residentEncodedBytesHighWater: 0,
    residentGpuBytes: 0,
    residentGpuBytesHighWater: 0,
    renderRecoveryCount: 0,
    schemaVersion: STREAMING_TELEMETRY_SCHEMA_VERSION,
    settledRecoveryCheckpoint: null,
    settledObserverUpdateCount: 0,
    state: "idle",
    workerGeneration: 0,
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
  let nextLoadBatchOrdinal = 1;
  let recordCellLoadSamples = false;
  let recoveryTarget: StreamingRecoveryCheckpoint | null = null;
  let flythroughObserverProtocol = createFlythroughObserverProtocol(0);
  const opfsAccessHandles = createOpfsSyncAccessHandleCache();
  const faultBoundaryRequests: {
    readonly flythroughObserverUpdateCount: number;
    readonly requestId: number;
  }[] = [];
  const flythroughResetBoundaryRequests: {
    readonly completedFlythroughGeneration: number;
    readonly completedRunSequence: number | null;
    readonly flythroughObserverUpdateCount: number | null;
    readonly kind: "reset-flythrough-boundary";
    readonly nextFlythroughGeneration: number;
    readonly requestId: number;
  }[] = [];
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
    const checkpoint = patch.settledRecoveryCheckpoint ?? telemetry.settledRecoveryCheckpoint;
    telemetry = Object.freeze({
      ...telemetry,
      ...patch,
      cellLoadSamples: Object.freeze(
        (patch.cellLoadSamples ?? telemetry.cellLoadSamples).slice(-LOAD_SAMPLE_LIMIT),
      ),
      currentObservers: Object.freeze(
        observers.map((observer) => Object.freeze([...observer]) as WorldVec3),
      ),
      opfsAccessHandleCount: opfsAccessHandles.size,
      residentCellCount: residents.size,
      residentCellIds: Object.freeze([...residents.keys()].sort()),
      residentEncodedBytes: [...residents.values()].reduce(
        (sum, resident) => sum + resident.encodedBytes,
        0,
      ),
      residentGpuBytes: [...residents.values()].reduce(
        (sum, resident) => sum + resident.gpuBytes,
        0,
      ),
      settledRecoveryCheckpoint:
        checkpoint === null
          ? null
          : Object.freeze({
              ...checkpoint,
              observers: Object.freeze(
                checkpoint.observers.map((observer) => Object.freeze([...observer]) as WorldVec3),
              ),
              residentCellIds: Object.freeze([...checkpoint.residentCellIds]),
            }),
    });
    scope.postMessage({ kind: "telemetry", snapshot: telemetry });
  };

  const fail = (error: unknown): void => {
    if (disposed || telemetry.state === "failed") return;
    const message = appendCloseFailures(errorMessage(error), opfsAccessHandles.closeAll());
    telemetry = Object.freeze({
      ...telemetry,
      failureMessage: message,
      opfsAccessHandleCount: 0,
      state: "failed",
    });
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

  const readCell = (
    entry: StreamingCellIndexEntry,
  ): Readonly<{
    bytes: ArrayBuffer;
    readMs: number;
  }> => {
    const access = opfsAccessHandles.require(entry.sha256);
    const bytes = new Uint8Array(entry.bytes);
    const startedAt = performance.now();
    const readBytes = access.read(bytes, { at: 0 });
    const readMs = performance.now() - startedAt;
    if (readBytes !== entry.bytes) {
      throw new Error(`OPFS cell ${entry.cellId} read ${readBytes} of ${entry.bytes} bytes`);
    }
    return Object.freeze({ bytes: bytes.buffer, readMs });
  };

  const loadCell = async (
    entry: StreamingCellIndexEntry,
    batch: LoadBatchIdentity,
  ): Promise<void> => {
    if (residents.has(entry.cellId)) return;
    const totalStartedAt = performance.now();
    const { bytes, readMs } = readCell(entry);
    const opfsCompletedAt = performance.now();
    const decoded = await decode(entry, bytes);
    const decodeCompletedAt = performance.now();
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
    let uploadCompletedAt: number;
    let commitCompletedAt: number;
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
      uploadCompletedAt = performance.now();
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
      commitCompletedAt = performance.now();
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
    const totalCompletedAt = performance.now();
    const opfsAccessRoundTripMs = opfsCompletedAt - totalStartedAt;
    const decodeRoundTripMs = decodeCompletedAt - opfsCompletedAt;
    const renderUploadRoundTripMs = uploadCompletedAt - decodeCompletedAt;
    const renderCommitRoundTripMs = commitCompletedAt - uploadCompletedAt;
    const streamingWorkerRemainderMs = totalCompletedAt - commitCompletedAt;
    const sample: StreamingCellLoadTelemetry = Object.freeze({
      batchCellCount: batch.cellCount,
      batchCellOrdinal: batch.cellOrdinal,
      batchFlythroughObserverSequence: batch.flythroughObserverSequence,
      batchObserverUpdateCount: batch.observerUpdateCount,
      batchOrdinal: batch.ordinal,
      cellId: entry.cellId,
      decodeMs: decoded.decodeMs,
      decodeRoundTripMs,
      decodeWaitMs: Math.max(0, decodeRoundTripMs - decoded.decodeMs),
      encodedBytes: decoded.encodedBytes,
      gpuBytes: response.gpuBytes,
      opfsAccessRoundTripMs,
      opfsReadMs: readMs,
      opfsWaitMs: Math.max(0, opfsAccessRoundTripMs - readMs),
      renderCommitRoundTripMs,
      renderUploadRoundTripMs,
      renderUploadWaitMs: Math.max(0, renderUploadRoundTripMs - response.uploadMs),
      sequence: telemetry.cellLoadSampleCount + 1,
      streamingWorkerRemainderMs,
      totalMs: totalCompletedAt - totalStartedAt,
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
        const batchObserverUpdateCount = telemetry.observerUpdateCount;
        const batchFlythroughObserverSequence = telemetry.flythroughObserverUpdateCount;
        const schedule = scheduleStreamingCells(
          index,
          observers,
          new Set(residents.keys()),
          STREAMING_RESIDENT_CELL_LIMIT,
        );
        for (const entry of schedule.evict) await evictCell(entry);
        if (schedule.load.length > 0) {
          const batch = Object.freeze({
            cellCount: schedule.load.length,
            flythroughObserverSequence: batchFlythroughObserverSequence,
            observerUpdateCount: batchObserverUpdateCount,
            ordinal: nextLoadBatchOrdinal,
          });
          nextLoadBatchOrdinal += 1;
          await Promise.all(
            schedule.load.map((entry, index) =>
              loadCell(entry, {
                ...batch,
                cellOrdinal: index + 1,
              }),
            ),
          );
        }
      } while (scheduleRequested && !disposed);
      const settledRecoveryCheckpoint: StreamingRecoveryCheckpoint = Object.freeze({
        flythroughObserverUpdateCount: telemetry.flythroughObserverUpdateCount,
        observerUpdateCount: telemetry.observerUpdateCount,
        observers: Object.freeze(
          observers.map((observer) => Object.freeze([...observer]) as WorldVec3),
        ),
        residentCellIds: Object.freeze([...residents.keys()].sort()),
        workerGeneration: telemetry.workerGeneration,
      });
      if (recoveryTarget !== null) {
        if (
          settledRecoveryCheckpoint.observerUpdateCount !== recoveryTarget.observerUpdateCount ||
          settledRecoveryCheckpoint.flythroughObserverUpdateCount !==
            recoveryTarget.flythroughObserverUpdateCount ||
          JSON.stringify(settledRecoveryCheckpoint.observers) !==
            JSON.stringify(recoveryTarget.observers) ||
          JSON.stringify(settledRecoveryCheckpoint.residentCellIds) !==
            JSON.stringify(recoveryTarget.residentCellIds)
        ) {
          throw new Error("Recovered streaming residency did not match its settled checkpoint");
        }
        recoveryTarget = null;
      }
      publish({
        settledObserverUpdateCount: telemetry.observerUpdateCount,
        settledRecoveryCheckpoint,
        state: "streaming",
      });
      for (const request of faultBoundaryRequests.splice(0)) {
        if (
          request.flythroughObserverUpdateCount !==
          settledRecoveryCheckpoint.flythroughObserverUpdateCount
        ) {
          throw new Error("Fault-boundary observer sequence did not settle exactly");
        }
        renderPort?.postMessage({
          checkpoint: settledRecoveryCheckpoint,
          kind: "fault-boundary-settled",
          requestId: request.requestId,
        });
      }
      for (const request of flythroughResetBoundaryRequests.splice(0)) {
        renderPort?.postMessage(flythroughObserverProtocol.settleReset(request));
      }
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

  const openAccessHandles = async (entries: readonly StreamingCellIndexEntry[]): Promise<void> => {
    const uniqueEntries = [
      ...new Map(entries.map((entry) => [entry.sha256, entry] as const)).values(),
    ];
    const startedAt = performance.now();
    publish({ opfsPackageCount: uniqueEntries.length });
    try {
      for (let offset = 0; offset < uniqueEntries.length; offset += 8) {
        const batch = uniqueEntries.slice(offset, offset + 8);
        const results = await Promise.allSettled(
          batch.map(async (entry) => {
            const handle = await openCellFile(entry);
            await opfsAccessHandles.open(entry.sha256, entry.bytes, () =>
              (handle as OpfsFileHandle).createSyncAccessHandle(),
            );
          }),
        );
        const rejected = results.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (rejected !== undefined) throw new Error(errorMessage(rejected.reason));
      }
    } catch (error: unknown) {
      throw new Error(
        appendCloseFailures(errorMessage(error), opfsAccessHandles.closeAll()),
        error instanceof Error ? { cause: error } : undefined,
      );
    }
    publish({
      opfsAccessHandleOpenDurationMs: performance.now() - startedAt,
    });
  };

  const initialize = async (request: Extract<StreamingWorkerRequest, { kind: "start" }>) => {
    if (!validObservers(request.initialObservers)) {
      throw new Error("Initial streaming observers are invalid");
    }
    recoveryTarget = request.recoveryCheckpoint;
    publish({
      flythroughObserverUpdateCount: request.recoveryCheckpoint?.flythroughObserverUpdateCount ?? 0,
      observerUpdateCount: request.recoveryCheckpoint?.observerUpdateCount ?? 0,
      renderRecoveryCount: request.renderRecoveryCount,
      settledObserverUpdateCount: request.recoveryCheckpoint?.observerUpdateCount ?? 0,
      workerGeneration: request.workerGeneration,
    });
    flythroughObserverProtocol = createFlythroughObserverProtocol(
      telemetry.flythroughObserverUpdateCount,
    );
    renderPort = request.renderPort;
    renderPort.onmessage = (event: MessageEvent<RenderToStreamingMessage>): void => {
      const response = event.data;
      if (response.kind === "flythrough-observers") {
        if (flythroughResetBoundaryRequests.length > 0 || !validObservers(response.observers)) {
          fail("Render worker flythrough observer sequence is invalid");
          return;
        }
        let nextFlythroughObserverUpdateCount: number;
        try {
          nextFlythroughObserverUpdateCount = flythroughObserverProtocol.acceptObserver(response);
        } catch (error: unknown) {
          fail(error);
          return;
        }
        observers = Object.freeze(
          response.observers.map((observer) => Object.freeze([...observer]) as WorldVec3),
        );
        publish({
          flythroughObserverUpdateCount: nextFlythroughObserverUpdateCount,
          observerUpdateCount: telemetry.observerUpdateCount + 1,
        });
        scheduleRequested = true;
        void runSchedule().catch(fail);
        return;
      }
      if (response.kind === "reset-flythrough-boundary") {
        if (
          !Number.isInteger(response.requestId) ||
          response.requestId <= 0 ||
          flythroughResetBoundaryRequests.length > 0
        ) {
          fail("Render worker flythrough reset boundary is invalid");
          return;
        }
        flythroughResetBoundaryRequests.push(response);
        scheduleRequested = true;
        void runSchedule().catch(fail);
        return;
      }
      if (response.kind === "quiesce-fault-boundary") {
        if (
          !Number.isInteger(response.requestId) ||
          response.requestId <= 0 ||
          !Number.isInteger(response.flythroughObserverUpdateCount) ||
          response.flythroughObserverUpdateCount !== telemetry.flythroughObserverUpdateCount
        ) {
          fail("Render worker fault-boundary request is invalid");
          return;
        }
        faultBoundaryRequests.push({
          flythroughObserverUpdateCount: response.flythroughObserverUpdateCount,
          requestId: response.requestId,
        });
        scheduleRequested = true;
        void runSchedule().catch(fail);
        return;
      }
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
    await openAccessHandles(index.cells);
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
        const closeFailures = opfsAccessHandles.closeAll();
        if (closeFailures.length > 0) {
          throw new Error(appendCloseFailures("Streaming disposal failed", closeFailures));
        }
        telemetry = Object.freeze({
          ...telemetry,
          opfsAccessHandleCount: 0,
          state: "disposed",
        });
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
      if (!validObservers(request.observers)) {
        fail("Streaming observer update is invalid");
        return;
      }
      observers = Object.freeze(
        request.observers.map((observer) => Object.freeze([...observer]) as WorldVec3),
      );
      publish({ observerUpdateCount: telemetry.observerUpdateCount + 1 });
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

function validObservers(observers: readonly WorldVec3[]): boolean {
  return (
    observers.length > 0 &&
    observers.every(
      (observer) =>
        observer.length === 3 && observer.every((component) => Number.isFinite(component)),
    )
  );
}
