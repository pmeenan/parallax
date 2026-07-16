import type { OpfsReadPhaseTelemetry, OpfsReadSpikeConfig } from "./opfs-read-spike-protocol";

// TypeScript's ES2024 DOM library does not yet declare the worker-only OPFS sync
// access handle surface. Keep the local declaration minimal and structurally cast at
// the platform boundary so the missing library type cannot spread through the engine.
export interface OpfsSyncAccessHandle {
  close(): void;
  flush(): void;
  getSize(): number;
  read(buffer: Uint8Array, options: Readonly<{ at: number }>): number;
  truncate(newSize: number): void;
  write(buffer: Uint8Array, options: Readonly<{ at: number }>): number;
}

type DeadlineGuard = (deadline: number) => void;
type Now = () => number;

export function measureSequentialReads(
  accessHandle: OpfsSyncAccessHandle,
  config: OpfsReadSpikeConfig,
  deadline: number,
  now: Now = defaultNow,
  guardDeadline: DeadlineGuard = ensureBeforeDeadline,
): OpfsReadPhaseTelemetry {
  const buffer = new Uint8Array(config.sequentialReadBytes);
  let preflightValidationErrors = 0;
  // This spike measures the warm-cache API path. Exercise the exact sequential
  // read/validation loop once before timing so one-time worker and read-path startup
  // cannot contaminate only the first fresh-profile cohort.
  for (let offset = 0; offset < config.fileBytes; offset += buffer.byteLength) {
    guardDeadline(deadline);
    const read = accessHandle.read(buffer, { at: offset });
    if (read !== buffer.byteLength) {
      throw new Error(
        `OPFS sequential preflight short read at ${offset}: expected ${buffer.byteLength}, read ${read}`,
      );
    }
    preflightValidationErrors += validatePositionPattern(buffer, offset);
  }
  if (preflightValidationErrors !== 0) {
    throw new Error(`OPFS sequential preflight found ${preflightValidationErrors} data errors`);
  }

  let bytesRead = 0;
  let operations = 0;
  let readCallElapsedMs = 0;
  let validationErrors = 0;
  const wallStartedAt = now();
  for (let pass = 0; pass < config.sequentialPasses; pass += 1) {
    for (let offset = 0; offset < config.fileBytes; offset += buffer.byteLength) {
      guardDeadline(deadline);
      const readStartedAt = now();
      const read = accessHandle.read(buffer, { at: offset });
      readCallElapsedMs += now() - readStartedAt;
      if (read !== buffer.byteLength) {
        throw new Error(
          `OPFS sequential short read at ${offset}: expected ${buffer.byteLength}, read ${read}`,
        );
      }
      validationErrors += validatePositionPattern(buffer, offset);
      bytesRead += read;
      operations += 1;
    }
  }
  return readPhase(
    bytesRead,
    operations,
    readCallElapsedMs,
    now() - wallStartedAt,
    validationErrors,
  );
}

export function validatePositionPattern(buffer: Uint8Array, offset: number): number {
  const words = new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
  const firstWord = offset / Uint32Array.BYTES_PER_ELEMENT;
  for (let index = 0; index < words.length; index += 1) {
    if (words[index] !== firstWord + index) return 1;
  }
  return 0;
}

function readPhase(
  bytesRead: number,
  operations: number,
  readCallElapsedMs: number,
  wallElapsedMs: number,
  validationErrors: number,
): OpfsReadPhaseTelemetry {
  if (readCallElapsedMs <= 0 || wallElapsedMs <= 0) {
    throw new Error(
      `OPFS timing resolution was insufficient: read calls ${readCallElapsedMs} ms, wall ${wallElapsedMs} ms`,
    );
  }
  return Object.freeze({
    bytesRead,
    operations,
    readCallElapsedMs,
    readCallThroughputBytesPerSecond: (bytesRead * 1_000) / readCallElapsedMs,
    validationErrors,
    wallElapsedMs,
    wallThroughputBytesPerSecond: (bytesRead * 1_000) / wallElapsedMs,
  });
}

function defaultNow(): number {
  return performance.now();
}

function ensureBeforeDeadline(deadline: number): void {
  if (performance.now() > deadline) {
    throw new Error("OPFS sequential read exceeded its worker deadline");
  }
}
