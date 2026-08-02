import type {
  RenderBatchTransactionMember,
  RenderBatchTransactionMemberResponse,
  RenderBatchTransactionRequest,
  RenderBatchTransactionResponse,
} from "../streaming/streaming-protocol";
import { STREAMING_RESIDENT_CELL_LIMIT } from "../streaming/streaming-protocol";

export interface RenderStreamingBatchTransactionManager {
  dispose(): void;
  transact(
    request: RenderBatchTransactionRequest,
    acknowledge: (response: RenderBatchTransactionResponse) => void,
  ): void;
}

export interface RenderStreamingBatchTransactionOptions {
  readonly evict: (cellId: string) => unknown;
  readonly now?: () => number;
  readonly onRollbackFailure?: (error: unknown) => void;
  /** A throw must leave the member non-resident; a return means the member is resident. */
  readonly upload: (member: RenderBatchTransactionRequest["members"][number]) => Readonly<{
    dependencyUploadBytes: number;
    dependencyUploadCount: number;
    dependencyUploadMs: number;
    cellGpuBytes: number;
    dependencyGpuCache: RenderBatchTransactionResponse["dependencyGpuCache"];
    gpuBytes: number;
    psoWarmupGameplayOverlap?: boolean;
  }>;
}

export function createRenderStreamingBatchTransactionManager(
  options: RenderStreamingBatchTransactionOptions,
): RenderStreamingBatchTransactionManager {
  let lastBatchOrdinal = 0;
  let lastRequestId = 0;
  let disposed = false;
  const now = options.now ?? (() => performance.now());

  const rollbackMember = (
    member: Pick<RenderBatchTransactionMember, "cellId">,
    failures: unknown[],
  ): void => {
    try {
      options.evict(member.cellId);
    } catch (error: unknown) {
      failures.push(error);
      try {
        options.onRollbackFailure?.(error);
      } catch (diagnosticError: unknown) {
        failures.push(diagnosticError);
      }
    }
  };
  const rollbackMembers = (
    members: readonly Pick<RenderBatchTransactionMember, "cellId">[],
  ): readonly unknown[] => {
    const failures: unknown[] = [];
    for (let index = members.length - 1; index >= 0; index -= 1) {
      const member = members[index];
      if (member !== undefined) rollbackMember(member, failures);
    }
    return failures;
  };
  const errorAfterRollback = (
    primary: unknown,
    members: readonly Pick<RenderBatchTransactionMember, "cellId">[],
  ): unknown => {
    const failures = rollbackMembers(members);
    if (failures.length === 0) return primary;
    return new AggregateError(
      [primary, ...failures],
      `${errorMessage(primary)}; streaming rollback cleanup failed`,
      { cause: primary },
    );
  };

  return Object.freeze({
    dispose(): void {
      disposed = true;
    },
    transact(
      request: RenderBatchTransactionRequest,
      acknowledge: (response: RenderBatchTransactionResponse) => void,
    ): void {
      if (disposed) throw new Error("Streaming render batch transaction manager is disposed");
      requireValidTransactionRequest(request);
      if (request.requestId <= lastRequestId || request.batchOrdinal <= lastBatchOrdinal) {
        throw new Error(`Streaming batch ${request.batchTransactionId} is duplicate`);
      }
      lastRequestId = request.requestId;
      lastBatchOrdinal = request.batchOrdinal;

      const uploadedMembers: RenderBatchTransactionMember[] = [];
      const responses: RenderBatchTransactionMemberResponse[] = [];
      let batchGpuBytes = 0;
      let dependencyGpuCache: RenderBatchTransactionResponse["dependencyGpuCache"] | null = null;
      const batchStartedAt = now();
      for (const member of request.members) {
        const memberStartedAt = now();
        let result: Readonly<{
          dependencyUploadBytes: number;
          dependencyUploadCount: number;
          dependencyUploadMs: number;
          cellGpuBytes: number;
          dependencyGpuCache: RenderBatchTransactionResponse["dependencyGpuCache"];
          gpuBytes: number;
          psoWarmupGameplayOverlap?: boolean;
        }> | null = null;
        try {
          result = options.upload(member);
        } catch (error: unknown) {
          throw errorAfterRollback(error, uploadedMembers);
        }
        if (result === null) throw new Error("Streaming upload did not return a result");
        const uploadMs = now() - memberStartedAt;
        if (
          !nonNegativeSafeInteger(result.gpuBytes) ||
          !nonNegativeSafeInteger(result.cellGpuBytes) ||
          result.gpuBytes !== result.cellGpuBytes + result.dependencyUploadBytes ||
          !nonNegativeSafeInteger(result.dependencyUploadBytes) ||
          !nonNegativeSafeInteger(result.dependencyUploadCount) ||
          result.dependencyUploadCount > member.dependencies.length ||
          !Number.isFinite(result.dependencyUploadMs) ||
          result.dependencyUploadMs < 0 ||
          result.dependencyUploadMs > uploadMs + 0.1 ||
          !Number.isFinite(uploadMs) ||
          uploadMs < 0 ||
          !Number.isSafeInteger(batchGpuBytes + result.gpuBytes)
        ) {
          throw errorAfterRollback(
            new Error(`Streaming batch ${request.batchTransactionId} upload is invalid`),
            [...uploadedMembers, member],
          );
        }
        batchGpuBytes += result.gpuBytes;
        dependencyGpuCache = result.dependencyGpuCache;
        uploadedMembers.push(member);
        responses.push(
          Object.freeze({
            batchCellOrdinal: member.batchCellOrdinal,
            cellGpuBytes: result.cellGpuBytes,
            cellId: member.cellId,
            dependencyUploadBytes: result.dependencyUploadBytes,
            dependencyUploadCount: result.dependencyUploadCount,
            dependencyUploadMs: result.dependencyUploadMs,
            gpuBytes: result.gpuBytes,
            psoWarmupGameplayOverlap: result.psoWarmupGameplayOverlap ?? false,
            uploadMs,
          }),
        );
      }

      const batchDirectUploadMs = now() - batchStartedAt;
      if (
        !Number.isFinite(batchDirectUploadMs) ||
        batchDirectUploadMs < 0 ||
        !positiveSafeInteger(batchGpuBytes)
      ) {
        throw errorAfterRollback(
          new Error(`Streaming batch ${request.batchTransactionId} timing is invalid`),
          uploadedMembers,
        );
      }
      if (dependencyGpuCache === null) {
        throw errorAfterRollback(
          new Error(`Streaming batch ${request.batchTransactionId} cache state is invalid`),
          uploadedMembers,
        );
      }
      const response = Object.freeze({
        batchCellCount: request.batchCellCount,
        batchDirectUploadMs,
        batchDemandEncodedBytes: request.batchDemandEncodedBytes,
        batchEncodedBytes: request.members.reduce((sum, member) => sum + member.encodedBytes, 0),
        batchGpuBytes,
        batchOrdinal: request.batchOrdinal,
        batchTransactionId: request.batchTransactionId,
        kind: "render-batch-transaction-complete" as const,
        members: Object.freeze(responses),
        dependencyGpuCache,
        requestId: request.requestId,
      });
      try {
        acknowledge(response);
      } catch (error: unknown) {
        throw errorAfterRollback(error, uploadedMembers);
      }
    },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function requireValidTransactionRequest(request: RenderBatchTransactionRequest): void {
  if (
    !positiveSafeInteger(request.requestId) ||
    !positiveSafeInteger(request.batchOrdinal) ||
    !positiveSafeInteger(request.batchCellCount) ||
    !positiveSafeInteger(request.batchDemandEncodedBytes) ||
    request.batchCellCount > STREAMING_RESIDENT_CELL_LIMIT ||
    request.batchTransactionId === "" ||
    transactionBatchOrdinal(request.batchTransactionId) !== request.batchOrdinal ||
    !Array.isArray(request.members) ||
    request.members.length !== request.batchCellCount ||
    request.members.some(
      (member, index) =>
        member.batchCellOrdinal !== index + 1 ||
        member.cellId === "" ||
        member.cell.id !== member.cellId ||
        !Array.isArray(member.dependencies) ||
        !positiveSafeInteger(member.encodedBytes),
    ) ||
    new Set(request.members.map((member) => member.cellId)).size !== request.members.length ||
    !positiveSafeInteger(request.members.reduce((sum, member) => sum + member.encodedBytes, 0)) ||
    request.batchDemandEncodedBytes <
      request.members.reduce((sum, member) => sum + member.encodedBytes, 0)
  ) {
    throw new Error("Streaming render batch transaction membership is invalid");
  }
}

function positiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function nonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function transactionBatchOrdinal(transactionId: string): number | null {
  const parts = transactionId.split(":");
  if (parts.length !== 4 || parts.some((part) => part === "" || !/^\d+$/.test(part))) {
    return null;
  }
  const values = parts.map(Number);
  return values.every((value) => Number.isSafeInteger(value) && value >= 0) &&
    positiveSafeInteger(values[0] ?? 0) &&
    positiveSafeInteger(values[1] ?? 0)
    ? (values[1] ?? null)
    : null;
}
