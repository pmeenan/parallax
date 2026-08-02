import type { GreyboxCell } from "../world/world-contract";
import { compatibleStreamingCacheSnapshots } from "./streaming-cache-correlation";
import { planStreamingCellMemoryReservation } from "./streaming-dependency-contract";
import type {
  DecodedStreamingDependency,
  RenderStreamingDependency,
  RenderStreamingRequest,
  RenderStreamingResponse,
  StreamingCellIndexEntry,
  StreamingDependencyIndexEntry,
} from "./streaming-protocol";
import { STREAMING_TIMING_ATTRIBUTION_TOLERANCE_MS } from "./streaming-protocol";
import type { StreamingResourceCache } from "./streaming-resource-cache";
import { streamingResourceCacheKey } from "./streaming-resource-key";

export interface StreamingBatchPlan {
  readonly descriptors: readonly StreamingDependencyIndexEntry[];
  readonly entry: StreamingCellIndexEntry;
  readonly memory: ReturnType<typeof planStreamingCellMemoryReservation>;
}

export interface StreamingBatchPreparedCell {
  readonly decodeCompletedAt: number;
  readonly decoded: Readonly<{
    readonly cell: GreyboxCell;
    readonly decodeMs: number;
    readonly dependencies: readonly DecodedStreamingDependency[];
    readonly encodedBytes: number;
  }>;
  readonly dependencyDescriptors: readonly StreamingDependencyIndexEntry[];
  readonly dependencyEncodedBytes: number;
  readonly dependencyKeys: readonly string[];
  readonly dependencyReadMs: number;
  readonly entry: StreamingCellIndexEntry;
  readonly opfsCompletedAt: number;
  readonly readMs: number;
  readonly renderDependencies: readonly RenderStreamingDependency[];
  readonly totalStartedAt: number;
}

export interface StreamingBatchCacheTransactionResult {
  readonly aggregateDemandEncodedBytes: number;
  readonly physicalEncodedBytes: number;
  readonly prepared: readonly StreamingBatchPreparedCell[];
  readonly response: Extract<
    RenderStreamingResponse,
    { kind: "render-batch-transaction-complete" }
  >;
  readonly transactionCompletedAt: number;
}

export function streamingBatchDemandEncodedBytes(
  plans: readonly StreamingBatchPlan[],
  dependencyCache: StreamingResourceCache<DecodedStreamingDependency>,
): number {
  const residentKeys = new Set(
    dependencyCache.snapshot().resources.map((resource) => resource.cacheKey),
  );
  const countedKeys = new Set<string>();
  let demand = 0;
  for (const plan of plans) {
    demand += plan.entry.bytes;
    for (const descriptor of plan.descriptors) {
      const key = streamingResourceCacheKey(descriptor);
      if (residentKeys.has(key) || countedKeys.has(key)) continue;
      countedKeys.add(key);
      demand += descriptor.bytes;
    }
    if (!Number.isSafeInteger(demand) || demand <= 0) {
      throw new Error("Streaming batch encoded demand is invalid");
    }
  }
  return demand;
}

export function planStreamingBatch(
  entries: readonly StreamingCellIndexEntry[],
  resources: readonly StreamingDependencyIndexEntry[],
  batchOrdinal: number,
): readonly StreamingBatchPlan[] {
  if (
    entries.length === 0 ||
    new Set(entries.map((entry) => entry.cellId)).size !== entries.length
  ) {
    throw new Error(`Streaming load batch ${batchOrdinal} membership is invalid`);
  }
  return Object.freeze(
    entries.map((entry) => {
      const descriptors = dependencyClosure(entry, resources);
      return Object.freeze({
        descriptors,
        entry,
        memory: planStreamingCellMemoryReservation(entry, descriptors),
      });
    }),
  );
}

export async function executeStreamingBatchCacheTransaction(
  options: Readonly<{
    afterCommit: (result: StreamingBatchCacheTransactionResult) => void | Promise<void>;
    batchOrdinal: number;
    batchTransactionId: string;
    commitResident: (
      cell: StreamingBatchPreparedCell,
      member: Extract<
        RenderStreamingResponse,
        { kind: "render-batch-transaction-complete" }
      >["members"][number],
    ) => void;
    dependencyCache: StreamingResourceCache<DecodedStreamingDependency>;
    now: () => number;
    plans: readonly StreamingBatchPlan[];
    prepareCell: (
      entry: StreamingCellIndexEntry,
      misses: readonly StreamingDependencyIndexEntry[],
      descriptors: readonly StreamingDependencyIndexEntry[],
      keys: readonly string[],
    ) => Promise<StreamingBatchPreparedCell>;
    requestId: number;
    requestRender: (request: RenderStreamingRequest) => Promise<RenderStreamingResponse>;
    resources: readonly StreamingDependencyIndexEntry[];
    rollbackRenderResident: (cellId: string) => Promise<void>;
    rollbackResident: (cellId: string) => void;
  }>,
): Promise<StreamingBatchCacheTransactionResult> {
  const aggregateDemandEncodedBytes = streamingBatchDemandEncodedBytes(
    options.plans,
    options.dependencyCache,
  );
  const acquiredKeys: string[] = [];
  let dependencyReferencesCommitted = false;
  let renderResidencyCreated = false;
  try {
    const newKeys = new Set<string>();
    const acquiredPlans = options.plans.map((plan) => {
      const misses: StreamingDependencyIndexEntry[] = [];
      const keys = plan.descriptors.map((descriptor) => {
        const acquired = options.dependencyCache.acquire(descriptor);
        acquiredKeys.push(acquired.key);
        if (acquired.miss) {
          newKeys.add(acquired.key);
          misses.push(descriptor);
        }
        return acquired.key;
      });
      return Object.freeze({
        ...plan,
        keys: Object.freeze(keys),
        missKeys: Object.freeze(misses.map(streamingResourceCacheKey)),
        misses: Object.freeze(misses),
      });
    });
    const decodedCells = await Promise.all(
      acquiredPlans.map(({ descriptors, entry, keys, misses }) =>
        options.prepareCell(entry, misses, descriptors, keys),
      ),
    );
    for (const cell of decodedCells) {
      for (const dependency of cell.decoded.dependencies) {
        options.dependencyCache.fulfill(dependency.cacheKey, dependency);
        options.dependencyCache.setOwnedBytes(dependency.cacheKey, 0, dependency.decodedBytes);
      }
    }
    const prepared = Object.freeze(
      decodedCells.map((cell, cellIndex) => {
        const payloadKeys = new Set(acquiredPlans[cellIndex]?.missKeys ?? []);
        return Object.freeze({
          ...cell,
          renderDependencies: Object.freeze(
            cell.dependencyKeys.map((key): RenderStreamingDependency => {
              const cached = options.dependencyCache.require(key);
              if (cached.value === null) {
                throw new Error(`Streaming dependency ${cached.descriptor.resourceId} is pending`);
              }
              return payloadKeys.has(key)
                ? cached.value
                : Object.freeze({
                    cacheKey: key,
                    descriptor: cached.descriptor,
                    format: cached.descriptor.format,
                    kind: "cached-dependency-reference" as const,
                    resourceId: cached.descriptor.resourceId,
                  });
            }),
          ),
        });
      }),
    );
    const physicalEncodedBytes = prepared.reduce((sum, cell) => sum + cell.decoded.encodedBytes, 0);
    const transactionPromise = options.requestRender({
      batchCellCount: options.plans.length,
      batchDemandEncodedBytes: aggregateDemandEncodedBytes,
      batchOrdinal: options.batchOrdinal,
      batchTransactionId: options.batchTransactionId,
      kind: "render-batch-transaction",
      members: prepared.map((cell, index) =>
        Object.freeze({
          batchCellOrdinal: index + 1,
          cell: cell.decoded.cell,
          cellId: cell.entry.cellId,
          dependencies: cell.renderDependencies,
          encodedBytes: cell.decoded.encodedBytes,
        }),
      ),
      requestId: options.requestId,
    });
    for (const key of newKeys) options.dependencyCache.setOwnedBytes(key, 0, 0);
    const transactionResponse = await transactionPromise;
    renderResidencyCreated = transactionResponse.kind === "render-batch-transaction-complete";
    const transactionCompletedAt = options.now();
    if (
      transactionResponse.kind !== "render-batch-transaction-complete" ||
      transactionResponse.requestId !== options.requestId ||
      transactionResponse.batchTransactionId !== options.batchTransactionId ||
      transactionResponse.batchOrdinal !== options.batchOrdinal ||
      transactionResponse.batchCellCount !== options.plans.length ||
      transactionResponse.batchEncodedBytes !== physicalEncodedBytes ||
      transactionResponse.batchDemandEncodedBytes !== aggregateDemandEncodedBytes ||
      !positiveSafeInteger(transactionResponse.batchGpuBytes) ||
      transactionResponse.batchGpuBytes !==
        transactionResponse.members.reduce((sum, member) => sum + member.gpuBytes, 0) ||
      !Number.isFinite(transactionResponse.batchDirectUploadMs) ||
      transactionResponse.batchDirectUploadMs < 0 ||
      transactionResponse.batchDirectUploadMs + STREAMING_TIMING_ATTRIBUTION_TOLERANCE_MS <
        transactionResponse.members.reduce((sum, member) => sum + member.uploadMs, 0) ||
      !compatibleStreamingCacheSnapshots(
        options.dependencyCache.snapshot(),
        transactionResponse.dependencyGpuCache,
        options.resources,
      ) ||
      !validTransactionMembers(transactionResponse.members, prepared)
    ) {
      throw new Error(
        `Render transaction response for batch ${options.batchTransactionId} is invalid`,
      );
    }
    for (const [index, cell] of prepared.entries()) {
      const member = transactionResponse.members[index];
      if (member === undefined) throw new Error("Render batch response member is absent");
      options.commitResident(cell, member);
    }
    const result = Object.freeze({
      aggregateDemandEncodedBytes,
      physicalEncodedBytes,
      prepared,
      response: transactionResponse,
      transactionCompletedAt,
    });
    await options.afterCommit(result);
    dependencyReferencesCommitted = true;
    return result;
  } catch (error: unknown) {
    const rollbackFailures: unknown[] = [];
    if (renderResidencyCreated) {
      for (let index = options.plans.length - 1; index >= 0; index -= 1) {
        const plan = options.plans[index];
        if (plan === undefined) continue;
        try {
          await options.rollbackRenderResident(plan.entry.cellId);
        } catch (rollbackError: unknown) {
          rollbackFailures.push(rollbackError);
        }
        options.rollbackResident(plan.entry.cellId);
      }
    }
    if (rollbackFailures.length > 0) {
      throw new Error(
        `${errorMessage(error)}; render residency rollback failed: ${rollbackFailures.map(errorMessage).join("; ")}`,
        error instanceof Error ? { cause: error } : undefined,
      );
    }
    throw error;
  } finally {
    if (!dependencyReferencesCommitted) {
      for (let index = acquiredKeys.length - 1; index >= 0; index -= 1) {
        const key = acquiredKeys[index];
        if (key !== undefined) options.dependencyCache.release(key);
      }
    }
  }
}

function dependencyClosure(
  entry: StreamingCellIndexEntry,
  resources: readonly StreamingDependencyIndexEntry[],
): readonly StreamingDependencyIndexEntry[] {
  if (entry.dependencies === undefined) return [];
  const required = new Set<string>();
  const visit = (resourceId: string): void => {
    if (required.has(resourceId)) return;
    const descriptor = resources.find((candidate) => candidate.resourceId === resourceId);
    if (descriptor === undefined) {
      throw new Error(`Streaming dependency ${resourceId} is absent for ${entry.cellId}`);
    }
    for (const dependencyId of descriptor.dependencies) visit(dependencyId);
    required.add(resourceId);
  };
  for (const resourceId of entry.dependencies) visit(resourceId);
  return Object.freeze(resources.filter((resource) => required.has(resource.resourceId)));
}

function validTransactionMembers(
  members: Extract<
    RenderStreamingResponse,
    { kind: "render-batch-transaction-complete" }
  >["members"],
  prepared: readonly StreamingBatchPreparedCell[],
): boolean {
  return (
    Array.isArray(members) &&
    members.length === prepared.length &&
    members.every(
      (member, index) =>
        member.batchCellOrdinal === index + 1 &&
        member.cellId === prepared[index]?.entry.cellId &&
        Number.isSafeInteger(member.gpuBytes) &&
        member.gpuBytes > 0 &&
        Number.isSafeInteger(member.cellGpuBytes) &&
        member.cellGpuBytes >= 0 &&
        member.gpuBytes === member.cellGpuBytes + member.dependencyUploadBytes &&
        Number.isSafeInteger(member.dependencyUploadBytes) &&
        member.dependencyUploadBytes >= 0 &&
        Number.isSafeInteger(member.dependencyUploadCount) &&
        member.dependencyUploadCount >= 0 &&
        member.dependencyUploadCount <= (prepared[index]?.renderDependencies.length ?? -1) &&
        (member.dependencyUploadCount === 0) === (member.dependencyUploadBytes === 0) &&
        Number.isFinite(member.dependencyUploadMs) &&
        member.dependencyUploadMs >= 0 &&
        typeof member.psoWarmupGameplayOverlap === "boolean" &&
        Number.isFinite(member.uploadMs) &&
        member.uploadMs >= 0,
    )
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : String(error);
}

function positiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
