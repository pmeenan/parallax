import { bindActiveInstalledRelease } from "../storage/installed-release";
import { createOpfsReleaseStore } from "../storage/opfs-release-store";
import {
  createBrowserInstallStorePlatform,
  openBrowserInstallStoreFile,
} from "../storage/opfs-release-store-browser";
import {
  createOpfsSyncAccessHandleCache,
  type OpfsSyncAccessHandle,
} from "../storage/opfs-sync-access-handle";
import { createFlythroughObserverProtocol } from "../streaming/flythrough-observer-protocol";
import { openAndAdmitInstalledStreamingRelease } from "../streaming/installed-streaming-admission";
import {
  type InstalledStreamingRelease,
  resolveInstalledStreamingRelease,
} from "../streaming/installed-streaming-release";
import { parsePrivilegedStreamingProvisionPlan } from "../streaming/privileged-streaming-provision";
import { createStreamingBatchBudget } from "../streaming/streaming-batch-budget";
import {
  executeStreamingBatchCacheTransaction,
  planStreamingBatch,
  type StreamingBatchPreparedCell,
  streamingBatchDemandEncodedBytes,
  streamingBatchDemandStagingBytes,
} from "../streaming/streaming-batch-cache-transaction";
import { validateStreamingBuildManifest } from "../streaming/streaming-build-manifest";
import {
  compatibleStreamingCacheSnapshots,
  projectStreamingCacheReleases,
  requireExactStreamingEvictionFreedGpuBytes,
} from "../streaming/streaming-cache-correlation";
import { validateDecodedCellResponseAccounting } from "../streaming/streaming-dependency-contract";
import {
  type DecodeDependencyRequest,
  type DecodedStreamingDependency,
  type DecodeWorkerRequest,
  type DecodeWorkerResponse,
  type RenderStreamingRequest,
  type RenderStreamingResponse,
  type RenderToStreamingMessage,
  STREAMING_BATCH_STAGING_BUDGET_BYTES,
  STREAMING_DECODE_PROTOCOL_VERSION,
  STREAMING_DISTRICT_SWAP_SAMPLE_LIMIT,
  STREAMING_RESIDENT_CELL_LIMIT,
  STREAMING_RESIDENT_ENCODED_BUDGET_BYTES,
  STREAMING_TELEMETRY_SCHEMA_VERSION,
  type StreamingCellIndexEntry,
  type StreamingCellLoadTelemetry,
  type StreamingDependencyIndexEntry,
  type StreamingDistrictIndex,
  type StreamingRecoveryCheckpoint,
  type StreamingWorkerRequest,
  type StreamingWorkerResponse,
  type WorldStreamingTelemetrySnapshot,
} from "../streaming/streaming-protocol";
import { createStreamingResourceCache } from "../streaming/streaming-resource-cache";
import {
  scheduleStreamingCells,
  streamingDecodeWorkerCount,
} from "../streaming/streaming-scheduler";
import {
  createStreamingStartupTimingTracker,
  type StreamingStartupTimingTracker,
} from "../streaming/streaming-startup-telemetry";
import { createStreamingWorkerLifecycle } from "../streaming/streaming-worker-lifecycle";
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

interface DecodeResult {
  readonly cell: GreyboxCell;
  readonly decodeMs: number;
  readonly dependencies: readonly DecodedStreamingDependency[];
  readonly encodedBytes: number;
}

interface DecodeTask {
  readonly bytes: ArrayBuffer;
  readonly cellId: string;
  readonly districtId: string;
  readonly dependencies: readonly DecodeDependencyRequest[];
  readonly dependencyDescriptors: readonly StreamingDependencyIndexEntry[];
  readonly cellEncodedBytes: number;
  readonly reject: (error: Error) => void;
  readonly resolve: (result: DecodeResult) => void;
  readonly schemaVersion: 1;
  readonly taskId: number;
}

interface LoadBatchIdentity {
  readonly cellCount: number;
  readonly flythroughObserverSequence: number;
  readonly observerUpdateCount: number;
  readonly ordinal: number;
}

interface DecodeSlot {
  busy: boolean;
  readonly worker: Worker;
}

interface ResidentCell {
  readonly dependencyKeys: readonly string[];
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
    districtId: null,
    districtSwapCount: 0,
    districtSwapInProgress: false,
    districtSwapSamples: Object.freeze([]),
    decodeQueueDepthHighWater: 0,
    decodeWorkerCount: 0,
    dependencyDecodeFailureCount: 0,
    dependencyDecodedBytes: 0,
    dependencyEncodedBytesRead: 0,
    dependencyReadCount: 0,
    dependencyUploadBytes: 0,
    dependencyUploadCount: 0,
    dependencyCache: Object.freeze({
      acquireCount: 0,
      hitCount: 0,
      liveDecodedBytes: 0,
      liveEncodedBytes: 0,
      liveRefCount: 0,
      liveResourceCount: 0,
      missCount: 0,
      releaseCount: 0,
      resources: Object.freeze([]),
    }),
    dependencyGpuCache: Object.freeze({
      acquireCount: 0,
      hitCount: 0,
      liveDecodedBytes: 0,
      liveEncodedBytes: 0,
      liveRefCount: 0,
      liveResourceCount: 0,
      missCount: 0,
      releaseCount: 0,
      resources: Object.freeze([]),
    }),
    encodedBytesRead: 0,
    failureMessage: null,
    hardwareConcurrency: navigator.hardwareConcurrency,
    installedReleaseDigest: null,
    installedResourceBytes: 0,
    installedResourceCount: 0,
    legacyNetworkRequestCount: 0,
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
    renderBatchCellCountHighWater: 0,
    renderBatchDirectUploadMsHighWater: 0,
    renderBatchRequestCount: 0,
    renderBatchTransactionCount: 0,
    psoWarmupGameplayOverlapCount: 0,
    schemaVersion: STREAMING_TELEMETRY_SCHEMA_VERSION,
    settledRecoveryCheckpoint: null,
    settledObserverUpdateCount: 0,
    state: "idle",
    startupTiming: null,
    workerGeneration: 0,
  });
}

function startStreamingWorker(): void {
  const scope = globalThis as unknown as StreamingWorkerScope;
  let telemetry = initialTelemetry();
  const lifecycle = createStreamingWorkerLifecycle();
  let started = false;
  let index: StreamingDistrictIndex | null = null;
  let observers: readonly WorldVec3[] = Object.freeze([]);
  let renderPort: MessagePort | null = null;
  let rootDirectory: FileSystemDirectoryHandle | null = null;
  const installedCellPaths = new Map<string, string>();
  const installedDependencyPaths = new Map<string, string>();
  let scheduleRequested = false;
  let scheduling = false;
  let ready = false;
  const encodedBatchBudget = createStreamingBatchBudget();
  const stagingBatchBudget = createStreamingBatchBudget();
  const dependencyCache = createStreamingResourceCache<DecodedStreamingDependency>();
  let nextTaskId = 1;
  let nextRenderRequestId = 1;
  let nextLoadBatchOrdinal = 1;
  let recordCellLoadSamples = false;
  let prepareDistrict:
    | ((districtId: string, resolved?: () => void) => Promise<StreamingDistrictIndex>)
    | null = null;
  let districtSwapRunning = false;
  let districtSwapLogicalGpuBytesHighWater: number | null = null;
  let recoveryTarget: StreamingRecoveryCheckpoint | null = null;
  let startupTiming: StreamingStartupTimingTracker | null = null;
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
      readonly request: RenderStreamingRequest;
      readonly resolve: (response: RenderStreamingResponse) => void;
      readonly timeout: ReturnType<typeof setTimeout>;
    }
  >();

  const publish = (patch: Partial<WorldStreamingTelemetrySnapshot> = {}): void => {
    const checkpoint = patch.settledRecoveryCheckpoint ?? telemetry.settledRecoveryCheckpoint;
    const residentGpuBytes =
      [...residents.values()].reduce((sum, resident) => sum + resident.gpuBytes, 0) +
      ((patch.dependencyGpuCache ?? telemetry.dependencyGpuCache)?.liveDecodedBytes ?? 0);
    if (districtSwapLogicalGpuBytesHighWater !== null) {
      districtSwapLogicalGpuBytesHighWater = Math.max(
        districtSwapLogicalGpuBytesHighWater,
        residentGpuBytes,
      );
    }
    telemetry = Object.freeze({
      ...telemetry,
      ...patch,
      cellLoadSamples:
        patch.cellLoadSamples === undefined
          ? telemetry.cellLoadSamples
          : Object.freeze(patch.cellLoadSamples.slice(-LOAD_SAMPLE_LIMIT)),
      currentObservers: Object.freeze(
        observers.map((observer) => Object.freeze([...observer]) as WorldVec3),
      ),
      districtSwapSamples:
        patch.districtSwapSamples === undefined
          ? telemetry.districtSwapSamples
          : Object.freeze(
              patch.districtSwapSamples.map((sample) =>
                Object.freeze({
                  ...sample,
                  destinationResidentCellIds: Object.freeze([...sample.destinationResidentCellIds]),
                  sourceResidentCellIds: Object.freeze([...sample.sourceResidentCellIds]),
                }),
              ),
            ),
      opfsAccessHandleCount: opfsAccessHandles.size,
      residentCellCount: residents.size,
      residentCellIds: Object.freeze([...residents.keys()].sort()),
      residentEncodedBytes:
        [...residents.values()].reduce((sum, resident) => sum + resident.encodedBytes, 0) +
        dependencyCache.snapshot().liveEncodedBytes,
      residentGpuBytes,
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

  const markStartup = (mark: (tracker: StreamingStartupTimingTracker) => void): void => {
    if (startupTiming === null) throw new Error("Streaming startup timing tracker is unavailable");
    mark(startupTiming);
    publish({ startupTiming: startupTiming.snapshot() });
  };

  const fail = (error: unknown): void => {
    if (!lifecycle.tryFail()) return;
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
          dependencies: task.dependencies,
          districtId: task.districtId,
          kind: "decode-cell",
          protocolVersion: STREAMING_DECODE_PROTOCOL_VERSION,
          schemaVersion: task.schemaVersion,
          taskId: task.taskId,
        } satisfies DecodeWorkerRequest,
        [task.bytes, ...task.dependencies.map((dependency) => dependency.bytes)],
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
          if (task.dependencies.length > 0) {
            publish({
              dependencyDecodeFailureCount: (telemetry.dependencyDecodeFailureCount ?? 0) + 1,
            });
          }
          task.reject(new Error(response.message));
        } else if (response.protocolVersion === STREAMING_DECODE_PROTOCOL_VERSION) {
          try {
            validateDecodedCellResponseAccounting(
              task.cellId,
              task.cellEncodedBytes,
              task.dependencyDescriptors,
              response,
            );
            task.resolve(response);
          } catch (error: unknown) {
            task.reject(new Error(errorMessage(error)));
          }
        } else {
          task.reject(new Error(`Decode worker returned protocol drift for task ${task.taskId}`));
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

  const decode = (
    entry: StreamingCellIndexEntry,
    bytes: ArrayBuffer,
    dependencies: readonly DecodeDependencyRequest[],
  ): Promise<DecodeResult> =>
    new Promise((resolve, reject) => {
      const task: DecodeTask = {
        bytes,
        cellId: entry.cellId,
        dependencies,
        dependencyDescriptors: Object.freeze(dependencies.map(({ descriptor }) => descriptor)),
        districtId: index?.districtId ?? "",
        cellEncodedBytes: entry.bytes,
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
      renderRequests.set(request.requestId, { reject, request, resolve, timeout });
      const transfer =
        request.kind === "render-batch-transaction"
          ? [
              ...new Set(
                request.members.flatMap((member) =>
                  member.dependencies.flatMap((dependency) =>
                    "kind" in dependency && dependency.kind === "cached-dependency-reference"
                      ? []
                      : dependency.format === "ktx2"
                        ? (dependency.mipmaps?.map((mip) => mip.rgba) ?? [dependency.rgba])
                        : [
                            dependency.kind !== "legacy-positions"
                              ? dependency.kind === "indices"
                                ? dependency.indices
                                : dependency.attributes
                              : dependency.positions,
                          ],
                  ),
                ),
              ),
            ]
          : [];
      renderPort.postMessage(request, transfer);
    });

  const openResourceFile = async (
    entry: Pick<StreamingCellIndexEntry, "bytes" | "sha256">,
  ): Promise<FileSystemFileHandle> => {
    const installedPath =
      installedCellPaths.get(entry.sha256) ?? installedDependencyPaths.get(entry.sha256);
    if (installedPath !== undefined) return openBrowserInstallStoreFile(installedPath);
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

  const readDependencies = (
    descriptors: readonly StreamingDependencyIndexEntry[],
  ): Readonly<{
    dependencies: readonly DecodeDependencyRequest[];
    encodedBytes: number;
    readMs: number;
  }> => {
    let readMs = 0;
    let encodedBytes = 0;
    const dependencies = descriptors.map((descriptor) => {
      const access = opfsAccessHandles.require(descriptor.sha256);
      const bytes = new Uint8Array(descriptor.bytes);
      const startedAt = performance.now();
      const readBytes = access.read(bytes, { at: 0 });
      readMs += performance.now() - startedAt;
      if (readBytes !== descriptor.bytes) {
        throw new Error(
          `OPFS dependency ${descriptor.resourceId} read ${readBytes} of ${descriptor.bytes} bytes`,
        );
      }
      encodedBytes += bytes.byteLength;
      return Object.freeze({ bytes: bytes.buffer, descriptor });
    });
    return Object.freeze({ dependencies: Object.freeze(dependencies), encodedBytes, readMs });
  };

  const prepareCell = async (
    entry: StreamingCellIndexEntry,
    descriptors: readonly StreamingDependencyIndexEntry[],
    dependencyDescriptors: readonly StreamingDependencyIndexEntry[],
    dependencyKeys: readonly string[],
  ): Promise<StreamingBatchPreparedCell> => {
    if (residents.has(entry.cellId)) {
      throw new Error(`Streaming batch selected resident cell ${entry.cellId}`);
    }
    const totalStartedAt = performance.now();
    const { bytes, readMs } = readCell(entry);
    const dependencyRead = readDependencies(descriptors);
    const opfsCompletedAt = performance.now();
    const decoded = await decode(entry, bytes, dependencyRead.dependencies);
    const decodeCompletedAt = performance.now();
    if (
      decoded.cell.id !== entry.cellId ||
      decoded.encodedBytes !== entry.bytes + dependencyRead.encodedBytes ||
      decoded.dependencies.length !== dependencyRead.dependencies.length
    ) {
      throw new Error(`Decoded streaming cell ${entry.cellId} identity is invalid`);
    }
    return Object.freeze({
      decodeCompletedAt,
      decoded,
      entry,
      opfsCompletedAt,
      readMs,
      dependencyEncodedBytes: dependencyRead.encodedBytes,
      dependencyDescriptors,
      dependencyKeys,
      dependencyReadMs: dependencyRead.readMs,
      renderDependencies: Object.freeze([]),
      totalStartedAt,
    });
  };

  const loadBatch = async (
    entries: readonly StreamingCellIndexEntry[],
    batch: LoadBatchIdentity,
  ): Promise<void> => {
    if (entries.length !== batch.cellCount) {
      throw new Error(`Streaming load batch ${batch.ordinal} membership is invalid`);
    }
    const resources = index?.resources ?? [];
    const plans = planStreamingBatch(entries, resources, batch.ordinal);
    const aggregateDemandEncodedBytes = streamingBatchDemandEncodedBytes(plans, dependencyCache);
    const aggregateStagingBytes = streamingBatchDemandStagingBytes(plans, dependencyCache);
    const reservation = encodedBatchBudget.reserve(
      [...residents.values()].reduce((sum, resident) => sum + resident.encodedBytes, 0) +
        dependencyCache.snapshot().liveEncodedBytes,
      aggregateDemandEncodedBytes,
      STREAMING_RESIDENT_ENCODED_BUDGET_BYTES,
    );
    if (reservation === null) {
      publish({ cpuBudgetRejectionCount: telemetry.cpuBudgetRejectionCount + 1 });
      throw new Error(
        `Streaming encoded residency exceeds ${STREAMING_RESIDENT_ENCODED_BUDGET_BYTES}`,
      );
    }
    publish({
      residentEncodedBytesHighWater: Math.max(
        telemetry.residentEncodedBytesHighWater,
        reservation.projectedBytes,
      ),
    });
    const stagingReservation = stagingBatchBudget.reserve(
      0,
      aggregateStagingBytes,
      STREAMING_BATCH_STAGING_BUDGET_BYTES,
    );
    if (stagingReservation === null) {
      reservation.release();
      publish({ cpuBudgetRejectionCount: telemetry.cpuBudgetRejectionCount + 1 });
      throw new Error(
        `Streaming staging demand ${aggregateStagingBytes} exceeds ${STREAMING_BATCH_STAGING_BUDGET_BYTES}`,
      );
    }
    const batchTransactionId = [
      telemetry.workerGeneration,
      batch.ordinal,
      batch.observerUpdateCount,
      batch.flythroughObserverSequence,
    ].join(":");
    const transactionRequestId = nextRenderRequestId;
    nextRenderRequestId += 1;
    publish({
      renderBatchCellCountHighWater: Math.max(
        telemetry.renderBatchCellCountHighWater,
        entries.length,
      ),
      renderBatchRequestCount: telemetry.renderBatchRequestCount + 1,
    });
    try {
      await executeStreamingBatchCacheTransaction({
        afterCommit: ({ physicalEncodedBytes, prepared, response, transactionCompletedAt }) => {
          const residentEncodedBytes =
            [...residents.values()].reduce((sum, resident) => sum + resident.encodedBytes, 0) +
            dependencyCache.snapshot().liveEncodedBytes;
          const residentGpuBytes =
            [...residents.values()].reduce((sum, resident) => sum + resident.gpuBytes, 0) +
            response.dependencyGpuCache.liveDecodedBytes;
          const totalCompletedAt = performance.now();
          const samples = prepared.map((cell, index): StreamingCellLoadTelemetry => {
            const member = response.members[index];
            if (member === undefined) throw new Error("Render batch response member is absent");
            const opfsAccessRoundTripMs = cell.opfsCompletedAt - cell.totalStartedAt;
            const decodeRoundTripMs = cell.decodeCompletedAt - cell.opfsCompletedAt;
            const renderTransactionRoundTripMs = transactionCompletedAt - cell.decodeCompletedAt;
            const streamingWorkerRemainderMs = totalCompletedAt - transactionCompletedAt;
            return Object.freeze({
              batchCellCount: batch.cellCount,
              batchCellOrdinal: index + 1,
              batchDirectUploadMs: response.batchDirectUploadMs,
              batchFlythroughObserverSequence: batch.flythroughObserverSequence,
              batchObserverUpdateCount: batch.observerUpdateCount,
              batchOrdinal: batch.ordinal,
              batchTransactionId,
              cellId: cell.entry.cellId,
              decodeMs: cell.decoded.decodeMs,
              decodeRoundTripMs,
              decodeWaitMs: Math.max(0, decodeRoundTripMs - cell.decoded.decodeMs),
              dependencyCount: cell.dependencyDescriptors.length,
              dependencyDecodeMs: cell.decoded.dependencies.reduce(
                (sum, dependency) => sum + dependency.decodeMs,
                0,
              ),
              dependencyDecodedBytes: cell.decoded.dependencies.reduce(
                (sum, dependency) => sum + dependency.decodedBytes,
                0,
              ),
              dependencyEncodedBytes: cell.dependencyEncodedBytes,
              dependencyReadMs: cell.dependencyReadMs,
              dependencyUploadBytes: member.dependencyUploadBytes,
              dependencyUploadMs: member.dependencyUploadMs,
              encodedBytes: cell.decoded.encodedBytes,
              gpuBytes: member.gpuBytes,
              opfsAccessRoundTripMs,
              opfsReadMs: cell.readMs + cell.dependencyReadMs,
              opfsWaitMs: Math.max(0, opfsAccessRoundTripMs - cell.readMs - cell.dependencyReadMs),
              renderTransactionRoundTripMs,
              renderTransactionWaitMs: Math.max(0, renderTransactionRoundTripMs - member.uploadMs),
              sequence: telemetry.cellLoadSampleCount + index + 1,
              streamingWorkerRemainderMs,
              totalMs: totalCompletedAt - cell.totalStartedAt,
              uploadMs: member.uploadMs,
            });
          });
          publish({
            cellLoadSamples: recordCellLoadSamples
              ? Object.freeze([...telemetry.cellLoadSamples, ...samples])
              : telemetry.cellLoadSamples,
            cellLoadSampleCount: recordCellLoadSamples
              ? telemetry.cellLoadSampleCount + samples.length
              : telemetry.cellLoadSampleCount,
            dependencyCache: dependencyCache.snapshot(),
            dependencyGpuCache: response.dependencyGpuCache,
            encodedBytesRead: telemetry.encodedBytesRead + physicalEncodedBytes,
            dependencyDecodedBytes:
              (telemetry.dependencyDecodedBytes ?? 0) +
              prepared.reduce(
                (sum, cell) =>
                  sum +
                  cell.decoded.dependencies.reduce(
                    (dependencySum, dependency) => dependencySum + dependency.decodedBytes,
                    0,
                  ),
                0,
              ),
            dependencyEncodedBytesRead:
              (telemetry.dependencyEncodedBytesRead ?? 0) +
              prepared.reduce((sum, cell) => sum + cell.dependencyEncodedBytes, 0),
            dependencyReadCount:
              (telemetry.dependencyReadCount ?? 0) +
              prepared.reduce((sum, cell) => sum + cell.decoded.dependencies.length, 0),
            dependencyUploadBytes:
              (telemetry.dependencyUploadBytes ?? 0) +
              response.members.reduce((sum, member) => sum + member.dependencyUploadBytes, 0),
            dependencyUploadCount:
              (telemetry.dependencyUploadCount ?? 0) +
              response.members.reduce((sum, member) => sum + member.dependencyUploadCount, 0),
            psoWarmupGameplayOverlapCount:
              (telemetry.psoWarmupGameplayOverlapCount ?? 0) +
              response.members.filter((member) => member.psoWarmupGameplayOverlap).length,
            renderBatchDirectUploadMsHighWater: Math.max(
              telemetry.renderBatchDirectUploadMsHighWater,
              response.batchDirectUploadMs,
            ),
            renderBatchTransactionCount: telemetry.renderBatchTransactionCount + 1,
            residentEncodedBytesHighWater: Math.max(
              telemetry.residentEncodedBytesHighWater,
              residentEncodedBytes,
            ),
            residentGpuBytesHighWater: Math.max(
              telemetry.residentGpuBytesHighWater,
              residentGpuBytes,
            ),
          });
        },
        batchOrdinal: batch.ordinal,
        batchTransactionId,
        commitResident: (cell, member) => {
          residents.set(cell.entry.cellId, {
            dependencyKeys: cell.dependencyKeys,
            encodedBytes: cell.entry.bytes,
            gpuBytes: member.cellGpuBytes,
          });
        },
        dependencyCache,
        now: () => performance.now(),
        plans,
        prepareCell,
        requestId: transactionRequestId,
        requestRender,
        resources,
        rollbackRenderResident: async (cellId) => {
          const requestId = nextRenderRequestId;
          nextRenderRequestId += 1;
          const rollback = await requestRender({ cellId, kind: "evict-cell", requestId });
          if (rollback.kind !== "evict-cell-complete") {
            throw new Error(`Render rollback for ${cellId} was not acknowledged`);
          }
        },
        rollbackResident: (cellId) => residents.delete(cellId),
      });
    } finally {
      stagingReservation.release();
      reservation.release();
    }
  };
  const evictCell = async (entry: StreamingCellIndexEntry): Promise<void> => {
    const resident = residents.get(entry.cellId);
    if (resident === undefined) return;
    const dependencyCacheBeforeEviction = dependencyCache.snapshot();
    const dependencyGpuCacheBeforeEviction = telemetry.dependencyGpuCache;
    if (
      dependencyGpuCacheBeforeEviction === null ||
      dependencyGpuCacheBeforeEviction === undefined ||
      !compatibleStreamingCacheSnapshots(
        dependencyCacheBeforeEviction,
        dependencyGpuCacheBeforeEviction,
        index?.resources ?? [],
      )
    ) {
      throw new Error(`Resident dependency cache accounting mismatch for ${entry.cellId}`);
    }
    const projectedDependencyCache = projectStreamingCacheReleases(
      dependencyCacheBeforeEviction,
      [...resident.dependencyKeys].reverse(),
    );
    const requestId = nextRenderRequestId;
    nextRenderRequestId += 1;
    const response = await requestRender({
      cellId: entry.cellId,
      kind: "evict-cell",
      requestId,
    });
    if (
      response.kind !== "evict-cell-complete" ||
      response.freedCellGpuBytes !== resident.gpuBytes
    ) {
      throw new Error(`Render eviction accounting mismatch for ${entry.cellId}`);
    }
    if (
      !compatibleStreamingCacheSnapshots(
        projectedDependencyCache,
        response.dependencyGpuCache,
        index?.resources ?? [],
      )
    ) {
      throw new Error(`Render dependency cache accounting mismatch for ${entry.cellId}`);
    }
    try {
      requireExactStreamingEvictionFreedGpuBytes(
        response.freedGpuBytes,
        resident.gpuBytes,
        dependencyGpuCacheBeforeEviction,
        response.dependencyGpuCache,
      );
    } catch (error: unknown) {
      throw new Error(`Render eviction accounting mismatch for ${entry.cellId}`, { cause: error });
    }
    for (let index = resident.dependencyKeys.length - 1; index >= 0; index -= 1) {
      const key = resident.dependencyKeys[index];
      if (key !== undefined) dependencyCache.release(key);
    }
    residents.delete(entry.cellId);
    publish({
      dependencyCache: dependencyCache.snapshot(),
      dependencyGpuCache: response.dependencyGpuCache,
      proactiveEvictionCount: telemetry.proactiveEvictionCount + 1,
    });
  };

  const runSchedule = async (): Promise<void> => {
    if (
      scheduling ||
      !ready ||
      index === null ||
      observers.length === 0 ||
      lifecycle.disposalRequested
    )
      return;
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
          await loadBatch(schedule.load, batch);
        }
      } while (scheduleRequested && !lifecycle.disposalRequested);
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
      if (startupTiming !== null && startupTiming.snapshot().initialResidencyReadyAtMs === null) {
        startupTiming.markInitialResidencyReady();
      }
      publish({
        settledObserverUpdateCount: telemetry.observerUpdateCount,
        settledRecoveryCheckpoint,
        state: "streaming",
        startupTiming: startupTiming?.snapshot() ?? telemetry.startupTiming,
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

  const fetchLegacy = async (input: URL | string): Promise<Response> => {
    publish({ legacyNetworkRequestCount: telemetry.legacyNetworkRequestCount + 1 });
    return fetch(input);
  };

  const provision = async (
    entry: Pick<StreamingCellIndexEntry, "bytes" | "path" | "sha256">,
    baseUrl: URL,
  ): Promise<number> => {
    if (rootDirectory === null) throw new Error("Streaming OPFS directory is unavailable");
    const handle = await rootDirectory.getFileHandle(`${entry.sha256}.cell`, { create: true });
    const existing = await handle.getFile();
    if (
      existing.size === entry.bytes &&
      (await sha256Hex(await existing.arrayBuffer())) === entry.sha256
    ) {
      return 0;
    }
    const response = await fetchLegacy(new URL(entry.path, baseUrl));
    if (!response.ok) throw new Error(`Package fetch failed (${response.status}): ${entry.path}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== entry.bytes) {
      throw new Error(
        `Fetched package ${entry.path} has ${bytes.byteLength} bytes; expected ${entry.bytes}`,
      );
    }
    const digest = await sha256Hex(bytes);
    if (digest !== entry.sha256) throw new Error(`Fetched package ${entry.path} failed SHA-256`);
    const access = await (handle as OpfsFileHandle).createSyncAccessHandle();
    try {
      access.truncate(0);
      const written = access.write(new Uint8Array(bytes), { at: 0 });
      if (written !== bytes.byteLength) {
        throw new Error(`OPFS package ${entry.path} wrote ${written} of ${bytes.byteLength} bytes`);
      }
      access.flush();
    } finally {
      access.close();
    }
    return bytes.byteLength;
  };

  const removeStalePackages = async (
    entries: readonly Pick<StreamingCellIndexEntry, "sha256">[],
  ) => {
    if (rootDirectory === null) throw new Error("Streaming OPFS directory is unavailable");
    const expectedNames = new Set(entries.map((entry) => `${entry.sha256}.cell`));
    for await (const name of rootDirectory.keys()) {
      if (!expectedNames.has(name)) await rootDirectory.removeEntry(name);
    }
  };

  const openAccessHandlesWithoutCleanup = async (
    entries: readonly Pick<StreamingCellIndexEntry, "bytes" | "sha256">[],
  ): Promise<void> => {
    const uniqueEntries = [
      ...new Map(entries.map((entry) => [entry.sha256, entry] as const)).values(),
    ];
    const startedAt = performance.now();
    publish({ opfsPackageCount: uniqueEntries.length });
    for (let offset = 0; offset < uniqueEntries.length; offset += 8) {
      const batch = uniqueEntries.slice(offset, offset + 8);
      const results = await Promise.allSettled(
        batch.map(async (entry) => {
          if (opfsAccessHandles.has(entry.sha256)) return;
          const handle = await openResourceFile(entry);
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
    publish({
      opfsAccessHandleOpenDurationMs: performance.now() - startedAt,
    });
  };

  const performDistrictSwap = async (
    request: Extract<StreamingWorkerRequest, { kind: "swap-district" }>,
  ): Promise<void> => {
    if (
      !ready ||
      districtSwapRunning ||
      index === null ||
      prepareDistrict === null ||
      !Number.isSafeInteger(request.requestId) ||
      request.requestId <= 0 ||
      request.destinationDistrictId.trim() === "" ||
      request.destinationDistrictId === index.districtId ||
      request.entranceId.trim() === "" ||
      !validObservers(request.initialObservers)
    ) {
      throw new Error("Streaming district swap request is invalid");
    }
    districtSwapRunning = true;
    ready = false;
    scheduleRequested = false;
    const startedAtMs = performance.now();
    districtSwapLogicalGpuBytesHighWater = telemetry.residentGpuBytes;
    publish({ districtSwapInProgress: true });
    try {
      const beginBoundaryRequestId = nextRenderRequestId++;
      const beginBoundary = await requestRender({
        destinationDistrictId: request.destinationDistrictId,
        destinationMaterials: Object.freeze([]),
        districtSwapRequestId: request.requestId,
        kind: "district-swap-boundary",
        phase: "begin",
        requestId: beginBoundaryRequestId,
      });
      if (
        beginBoundary.kind !== "district-swap-boundary-complete" ||
        beginBoundary.phase !== "begin" ||
        beginBoundary.destinationDistrictId !== request.destinationDistrictId ||
        beginBoundary.districtSwapRequestId !== request.requestId ||
        beginBoundary.frameCount !== 0 ||
        beginBoundary.maxHitchMs !== 0
      ) {
        throw new Error("Renderer did not establish an empty district-swap frame window");
      }
      const drainDeadline = performance.now() + DISPOSAL_DRAIN_TIMEOUT_MS;
      while (scheduling && performance.now() < drainDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (scheduling) throw new Error("Streaming scheduling did not drain before district swap");

      const sourceIndex = index;
      const sourceLogicalGpuBytes = telemetry.residentGpuBytes;
      const proactiveEvictionCountAtStart = telemetry.proactiveEvictionCount;
      const sourceResidentCellIds = Object.freeze([...residents.keys()].sort());
      if (
        sourceResidentCellIds.length !== STREAMING_RESIDENT_CELL_LIMIT ||
        sourceResidentCellIds.some(
          (cellId) => !sourceIndex.cells.some((entry) => entry.cellId === cellId),
        )
      ) {
        throw new Error("Streaming district swap requires a complete source resident set");
      }

      const destinationIndex = await prepareDistrict(request.destinationDistrictId);
      const materialBoundaryRequestId = nextRenderRequestId++;
      const materialBoundary = await requestRender({
        destinationDistrictId: destinationIndex.districtId,
        destinationMaterials: destinationIndex.materials,
        districtSwapRequestId: request.requestId,
        kind: "district-swap-boundary",
        phase: "materials",
        requestId: materialBoundaryRequestId,
      });
      if (
        materialBoundary.kind !== "district-swap-boundary-complete" ||
        materialBoundary.phase !== "materials" ||
        materialBoundary.destinationDistrictId !== destinationIndex.districtId ||
        materialBoundary.districtSwapRequestId !== request.requestId
      ) {
        throw new Error("Renderer did not install destination district materials");
      }
      const sourceEntries = new Map(sourceIndex.cells.map((entry) => [entry.cellId, entry]));
      // Keep eviction acknowledgements sequential: each response validates the exact
      // dependency-cache projection produced by the preceding release.
      for (const cellId of sourceResidentCellIds) {
        const entry = sourceEntries.get(cellId);
        if (entry === undefined) throw new Error(`Source resident ${cellId} is absent from index`);
        await evictCell(entry);
      }
      if (residents.size !== 0 || dependencyCache.snapshot().liveResourceCount !== 0) {
        throw new Error("Streaming district swap did not fully release source residency");
      }

      index = destinationIndex;
      observers = Object.freeze(
        request.initialObservers.map((observer) => Object.freeze([...observer]) as WorldVec3),
      );
      ready = true;
      publish({
        districtId: destinationIndex.districtId,
        observerUpdateCount: telemetry.observerUpdateCount + 1,
        settledRecoveryCheckpoint: null,
      });
      await runSchedule();
      const destinationResidentCellIds = Object.freeze([...residents.keys()].sort());
      if (
        destinationResidentCellIds.length !== STREAMING_RESIDENT_CELL_LIMIT ||
        destinationResidentCellIds.some(
          (cellId) => !destinationIndex.cells.some((entry) => entry.cellId === cellId),
        ) ||
        destinationResidentCellIds.some((cellId) => sourceResidentCellIds.includes(cellId))
      ) {
        throw new Error("Streaming district swap did not establish an exclusive destination set");
      }
      const retainedHandleKeys = new Set([
        ...destinationIndex.cells.map(({ sha256 }) => sha256),
        ...(destinationIndex.resources ?? []).map(({ sha256 }) => sha256),
      ]);
      const closeFailures = opfsAccessHandles.closeExcept(retainedHandleKeys);
      if (closeFailures.length > 0) {
        throw new Error(
          appendCloseFailures("District source-handle cleanup failed", closeFailures),
        );
      }
      const endBoundaryRequestId = nextRenderRequestId++;
      const endBoundary = await requestRender({
        destinationDistrictId: destinationIndex.districtId,
        destinationMaterials: Object.freeze([]),
        districtSwapRequestId: request.requestId,
        kind: "district-swap-boundary",
        phase: "end",
        requestId: endBoundaryRequestId,
      });
      if (
        endBoundary.kind !== "district-swap-boundary-complete" ||
        endBoundary.phase !== "end" ||
        endBoundary.destinationDistrictId !== destinationIndex.districtId ||
        endBoundary.districtSwapRequestId !== request.requestId ||
        !Number.isSafeInteger(endBoundary.frameCount) ||
        endBoundary.frameCount < 0 ||
        !Number.isFinite(endBoundary.maxHitchMs) ||
        endBoundary.maxHitchMs < 0
      ) {
        throw new Error("Renderer returned invalid district-swap frame evidence");
      }
      const completedAtMs = performance.now();
      const destinationLogicalGpuBytes = telemetry.residentGpuBytes;
      const logicalGpuBytesHighWater = districtSwapLogicalGpuBytesHighWater;
      if (logicalGpuBytesHighWater === null) {
        throw new Error("Streaming district swap lost its logical GPU high-water tracker");
      }
      const sample = Object.freeze({
        completedAtMs,
        destinationLogicalGpuBytes,
        destinationDistrictId: destinationIndex.districtId,
        destinationResidentCellIds,
        entranceId: request.entranceId,
        logicalGpuBytesHighWater,
        maxHitchMs: endBoundary.maxHitchMs,
        proactiveEvictionCount: telemetry.proactiveEvictionCount - proactiveEvictionCountAtStart,
        renderFrameCount: endBoundary.frameCount,
        sourceDistrictId: sourceIndex.districtId,
        sourceLogicalGpuBytes,
        sourceResidentCellIds,
        startedAtMs,
        totalMs: completedAtMs - startedAtMs,
      });
      publish({
        districtSwapCount: telemetry.districtSwapCount + 1,
        districtSwapInProgress: false,
        districtSwapSamples: Object.freeze(
          [...telemetry.districtSwapSamples, sample].slice(-STREAMING_DISTRICT_SWAP_SAMPLE_LIMIT),
        ),
      });
      scope.postMessage({
        kind: "district-swap-complete",
        requestId: request.requestId,
        sample,
      });
    } finally {
      districtSwapLogicalGpuBytesHighWater = null;
      districtSwapRunning = false;
      ready = lifecycle.state === "active";
    }
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
      if (typeof event.data !== "object" || event.data === null) {
        fail("Render worker returned malformed streaming response");
        return;
      }
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
        const expectedTransactionId =
          "batchTransactionId" in pending.request ? pending.request.batchTransactionId : null;
        if (
          response.batchTransactionId !== expectedTransactionId ||
          typeof response.message !== "string" ||
          response.message === ""
        ) {
          fail(`Render worker failure correlation is invalid for ${response.requestId}`);
          return;
        }
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
    startupTiming = createStreamingStartupTimingTracker(
      request.contentSource.kind,
      () => performance.now(),
      // Retain the whole worker-clock span before initialize, including module loading
      // and message dispatch, instead of starting at initialize request handling.
      0,
    );
    startupTiming.markProvisioningStarted();
    publish({ state: "provisioning", startupTiming: startupTiming.snapshot() });
    if (request.contentSource.kind === "installed-release") {
      const platform = createBrowserInstallStorePlatform();
      const store = createOpfsReleaseStore(platform);
      const binding = await bindActiveInstalledRelease(request.contentSource.releaseDigest, store);
      markStartup((tracker) => tracker.markReleaseBindingCompleted());
      const releaseTelemetry = binding.snapshot();
      publish({
        installedReleaseDigest: binding.releaseDigest,
        installedResourceBytes: releaseTelemetry.referencedBytes,
        installedResourceCount: releaseTelemetry.referencedResourceCount,
      });
      // The admitted release and its content-addressed references are immutable for this
      // worker generation. Cache resolution metadata, while reopening closed handles on
      // every revisit.
      const preparedInstalledDistricts = new Map<string, InstalledStreamingRelease>();
      prepareDistrict = async (districtId, resolved) => {
        let installed = preparedInstalledDistricts.get(districtId);
        if (installed === undefined) {
          installed = await resolveInstalledStreamingRelease(binding, districtId, async (path) => {
            const bytes = await platform.read(path);
            if (bytes === null) throw new Error(`Installed streaming object is missing: ${path}`);
            return bytes;
          });
          preparedInstalledDistricts.set(districtId, installed);
        }
        resolved?.();
        for (const cell of installed.cells) installedCellPaths.set(cell.entry.sha256, cell.path);
        for (const dependency of installed.dependencies) {
          installedDependencyPaths.set(dependency.descriptor.sha256, dependency.path);
        }
        await openAccessHandlesWithoutCleanup([
          ...installed.index.cells,
          ...(installed.index.resources ?? []),
        ]);
        return installed.index;
      };
      await openAndAdmitInstalledStreamingRelease({
        admit: async () => {
          await store.admitActiveRelease(binding.releaseDigest);
          markStartup((tracker) => tracker.markFinalAdmissionCompleted());
        },
        closeHandles: () => opfsAccessHandles.closeAll(),
        openHandles: async () => {
          // This helper owns cleanup across partial handle opening and final admission.
          index =
            (await prepareDistrict?.(request.districtId, () =>
              markStartup((tracker) => tracker.markReleaseResolutionCompleted()),
            )) ?? null;
          markStartup((tracker) => tracker.markAccessHandlesOpened());
        },
      });
    } else {
      const manifestResponse = await fetchLegacy(request.contentSource.buildManifestUrl);
      if (!manifestResponse.ok)
        throw new Error(`Build manifest fetch failed (${manifestResponse.status})`);
      const manifest = validateStreamingBuildManifest(await manifestResponse.json());
      const opfsRoot = await navigator.storage.getDirectory();
      const streamingRoot = await opfsRoot.getDirectoryHandle(OPFS_DIRECTORY, {
        create: true,
      });
      for await (const [name, handle] of streamingRoot.entries()) {
        if (handle.kind === "file" && name.endsWith(".cell")) {
          await streamingRoot.removeEntry(name);
        }
      }
      // Legacy provisioning verifies each package once per worker generation. A revisit
      // reopens its handles without rereading and hashing the same immutable packages.
      const preparedLegacyDistricts = new Map<
        string,
        Readonly<{
          readonly directory: FileSystemDirectoryHandle;
          readonly index: StreamingDistrictIndex;
        }>
      >();
      prepareDistrict = async (districtId, resolved) => {
        const prepared = preparedLegacyDistricts.get(districtId);
        if (prepared !== undefined) {
          rootDirectory = prepared.directory;
          resolved?.();
          await openAccessHandlesWithoutCleanup([
            ...prepared.index.cells,
            ...(prepared.index.resources ?? []),
          ]);
          return prepared.index;
        }
        const entrypoint = manifest.gameContentEntrypoints.find(
          (candidate) => candidate.districtId === districtId,
        );
        if (entrypoint === undefined)
          throw new Error(`District ${districtId} is not in the build manifest`);
        const indexResponse = await fetchLegacy(new URL(entrypoint.path, manifestResponse.url));
        if (!indexResponse.ok)
          throw new Error(`District index fetch failed (${indexResponse.status})`);
        const { index: nextIndex, packages } = parsePrivilegedStreamingProvisionPlan(
          await indexResponse.json(),
          districtId,
        );
        resolved?.();
        rootDirectory = await streamingRoot.getDirectoryHandle(
          await districtDirectoryName(nextIndex.districtId),
          { create: true },
        );
        const previouslyProvisionedBytes = telemetry.opfsProvisionedBytes;
        let provisionedBytes = 0;
        for (let offset = 0; offset < packages.length; offset += 8) {
          const batch = packages.slice(offset, offset + 8);
          const written = await Promise.all(
            batch.map((entry) => provision(entry, new URL(manifestResponse.url))),
          );
          provisionedBytes += written.reduce((sum, value) => sum + value, 0);
          publish({
            opfsProvisionedBytes: previouslyProvisionedBytes + provisionedBytes,
          });
        }
        await removeStalePackages(packages);
        await openAccessHandlesWithoutCleanup(packages);
        preparedLegacyDistricts.set(
          districtId,
          Object.freeze({ directory: rootDirectory, index: nextIndex }),
        );
        return nextIndex;
      };
      index = await prepareDistrict(request.districtId, () =>
        markStartup((tracker) => tracker.markReleaseResolutionCompleted()),
      );
      markStartup((tracker) => tracker.markAccessHandlesOpened());
    }
    if (index === null) throw new Error("Streaming district preparation produced no index");
    publish({ districtId: index.districtId });
    createDecodePool();
    markStartup((tracker) => tracker.markDecodePoolCreated());
    ready = true;
    // Record launch hydration so the settled pre-traversal snapshot can conserve its
    // OPFS/decode/GPU dependency work. Measurement consumers exclude this prefix by
    // the captured start sample count and sequence boundary.
    recordCellLoadSamples = true;
    await runSchedule();
  };

  scope.onmessage = (event): void => {
    const request = event.data;
    if (request.kind === "dispose") {
      if (!lifecycle.beginDisposal()) return;
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
        if (lifecycle.state === "failed") return;
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
        if (!lifecycle.finishDisposal()) return;
        telemetry = Object.freeze({
          ...telemetry,
          opfsAccessHandleCount: 0,
          state: "disposed",
        });
        scope.postMessage({ kind: "disposed", snapshot: telemetry });
        renderPort?.close();
        renderPort = null;
      })().catch((error: unknown) => {
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
    if (request.kind === "swap-district") {
      void performDistrictSwap(request).catch(fail);
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
