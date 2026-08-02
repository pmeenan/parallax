import type { RmOptions } from "node:fs";

export const RETRYING_RECURSIVE_REMOVE_OPTIONS: Readonly<RmOptions & { readonly recursive: true }> =
  Object.freeze({
    force: true,
    maxRetries: 5,
    recursive: true,
    retryDelay: 100,
  });

export interface CleanupOperation {
  readonly label: string;
  readonly run: () => Promise<void>;
}

export async function finalizeCleanup(
  primaryFailure: unknown | null,
  operations: readonly CleanupOperation[],
  message: string,
): Promise<void> {
  const failures: unknown[] = [];
  for (const operation of operations) {
    try {
      await operation.run();
    } catch (error: unknown) {
      failures.push(new Error(`${operation.label} cleanup failed`, { cause: error }));
    }
  }
  if (failures.length === 0) return;
  throw new AggregateError(
    primaryFailure === null ? failures : [primaryFailure, ...failures],
    message,
  );
}
