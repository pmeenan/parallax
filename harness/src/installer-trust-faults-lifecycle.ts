export interface InstallerTrustFaultOwnedCleanup {
  readonly operation: string;
  readonly run: () => Promise<void>;
}

export interface InstallerTrustFaultOwnership {
  readonly add: (cleanup: InstallerTrustFaultOwnedCleanup) => void;
  readonly finish: (
    primary: Readonly<{ error: unknown; operation: string }> | null,
  ) => Promise<void>;
}

export class InstallerTrustFaultOperationError extends Error {
  readonly operation: string;
  readonly stage: "cleanup" | "primary";

  constructor(operation: string, stage: "cleanup" | "primary", cause: unknown) {
    super(`Installer trust-fault ${operation} ${stage === "cleanup" ? "cleanup " : ""}failed`, {
      cause,
    });
    this.name = "InstallerTrustFaultOperationError";
    this.operation = operation;
    this.stage = stage;
  }
}

export class InstallerTrustFaultLifecycleAggregateError extends AggregateError {
  constructor(failures: readonly InstallerTrustFaultOperationError[]) {
    super(failures, `Installer trust-fault lifecycle retained ${failures.length} failure(s)`);
    this.name = "InstallerTrustFaultLifecycleAggregateError";
  }
}

export function createInstallerTrustFaultOwnership(): InstallerTrustFaultOwnership {
  const cleanups: InstallerTrustFaultOwnedCleanup[] = [];
  let finished = false;
  return Object.freeze({
    add(cleanup: InstallerTrustFaultOwnedCleanup): void {
      if (finished) throw new Error("Installer trust-fault ownership is already finalized");
      cleanups.push(cleanup);
    },
    async finish(primary: Readonly<{ error: unknown; operation: string }> | null): Promise<void> {
      if (finished) throw new Error("Installer trust-fault ownership was finalized twice");
      finished = true;
      const failures: InstallerTrustFaultOperationError[] = [];
      if (primary !== null) {
        failures.push(
          new InstallerTrustFaultOperationError(primary.operation, "primary", primary.error),
        );
      }
      for (const cleanup of [...cleanups].reverse()) {
        try {
          await cleanup.run();
        } catch (error: unknown) {
          failures.push(new InstallerTrustFaultOperationError(cleanup.operation, "cleanup", error));
        }
      }
      if (failures.length !== 0) {
        throw new InstallerTrustFaultLifecycleAggregateError(failures);
      }
    },
  });
}
