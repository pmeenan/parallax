export function withRenderRecoveryBoundaryTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error("Render-recovery boundary timeout must be positive"));
  }
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Render-recovery fault boundary timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    void operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export function renderRecoveryElapsedMs(startedAt: number | null, now: number): number | null {
  if (startedAt === null) return null;
  return Math.max(0, now - startedAt);
}
