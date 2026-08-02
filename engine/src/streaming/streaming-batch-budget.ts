export interface StreamingBatchBudgetReservation {
  readonly projectedBytes: number;
  release(): void;
}

export interface StreamingBatchBudget {
  readonly reservedBytes: number;
  reserve(
    residentBytes: number,
    batchBytes: number,
    budgetBytes: number,
  ): StreamingBatchBudgetReservation | null;
}

export function createStreamingBatchBudget(): StreamingBatchBudget {
  let reservedBytes = 0;
  return {
    get reservedBytes(): number {
      return reservedBytes;
    },
    reserve(
      residentBytes: number,
      batchBytes: number,
      budgetBytes: number,
    ): StreamingBatchBudgetReservation | null {
      if (
        !nonNegativeSafeInteger(residentBytes) ||
        !positiveSafeInteger(batchBytes) ||
        !positiveSafeInteger(budgetBytes)
      ) {
        throw new Error("Streaming batch budget inputs are invalid");
      }
      const projectedBytes = residentBytes + reservedBytes + batchBytes;
      if (!Number.isSafeInteger(projectedBytes) || projectedBytes > budgetBytes) return null;
      reservedBytes += batchBytes;
      let active = true;
      return Object.freeze({
        projectedBytes,
        release(): void {
          if (!active) throw new Error("Streaming batch budget reservation was already released");
          active = false;
          reservedBytes -= batchBytes;
        },
      });
    },
  };
}

function nonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
