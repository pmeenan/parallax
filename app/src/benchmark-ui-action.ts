export interface BenchmarkActionSnapshot {
  readonly state: string;
}

export interface BenchmarkUiActionOptions<TSnapshot extends BenchmarkActionSnapshot> {
  readonly action: () => void | Promise<void>;
  readonly announce: (message: string) => void;
  readonly failurePrefix: string;
  readonly formatStatus: (snapshot: TSnapshot) => string;
  readonly snapshot: () => TSnapshot;
}

export function runBenchmarkUiAction<TSnapshot extends BenchmarkActionSnapshot>(
  options: BenchmarkUiActionOptions<TSnapshot>,
): void {
  const initialSnapshot = options.snapshot();
  const announceFailure = (error: unknown): void => {
    const currentSnapshot = options.snapshot();
    const message =
      currentSnapshot !== initialSnapshot && currentSnapshot.state === "failed"
        ? options.formatStatus(currentSnapshot)
        : `${options.failurePrefix}: ${errorMessage(error)}`;
    options.announce(message);
  };

  try {
    const completion = options.action();
    if (completion !== undefined) void completion.catch(announceFailure);
  } catch (error: unknown) {
    announceFailure(error);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
