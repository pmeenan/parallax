export interface InstallerTimeoutPlatform {
  clearTimeout(handle: unknown): void;
  setTimeout(callback: () => void, milliseconds: number): unknown;
}

export function runInstallerRequestWithTimeout<T>(
  milliseconds: number,
  diagnostic: string,
  operation: (signal: AbortSignal) => Promise<T>,
  platform: InstallerTimeoutPlatform = browserTimeoutPlatform(),
  parentSignal?: AbortSignal,
): Promise<T> {
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    return Promise.reject(new Error("Installer timeout must be a positive safe integer"));
  }
  const abort = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      platform.clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
      action();
    };
    const abortFromParent = (): void => {
      if (settled) return;
      const failure =
        parentSignal === undefined
          ? new DOMException("Installer request was aborted", "AbortError")
          : parentSignal.reason;
      abort.abort(failure);
      settle(() => reject(failure));
    };
    const timeout = platform.setTimeout(() => {
      if (settled) return;
      const failure = new DOMException(diagnostic, "TimeoutError");
      abort.abort(failure);
      settle(() => reject(failure));
    }, milliseconds);
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
    if (parentSignal?.aborted === true) {
      abortFromParent();
      return;
    }
    Promise.resolve()
      .then(() => operation(abort.signal))
      .then(
        (value) => settle(() => resolve(value)),
        (error: unknown) => settle(() => reject(error)),
      );
  });
}

function browserTimeoutPlatform(): InstallerTimeoutPlatform {
  return Object.freeze({
    clearTimeout: (handle: unknown) => globalThis.clearTimeout(handle as number),
    setTimeout: (callback: () => void, milliseconds: number) =>
      globalThis.setTimeout(callback, milliseconds),
  });
}
