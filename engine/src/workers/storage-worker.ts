import {
  OPFS_SPIKE_TIMEOUT_MS,
  type OpfsReadPhaseTelemetry,
  type OpfsReadSpikeConfig,
  type OpfsReadSpikeWorkerResponse,
  type OpfsReadSpikeWorkerResult,
} from "../storage/opfs-read-spike-protocol";
import {
  measureSequentialReads,
  type OpfsSyncAccessHandle,
  validatePositionPattern,
} from "../storage/opfs-read-spike-worker-core";

interface StorageWorkerStartMessage {
  readonly config: OpfsReadSpikeConfig;
  readonly kind: "start";
}

interface StorageWorkerScope {
  onmessage: ((event: MessageEvent<StorageWorkerStartMessage>) => void) | null;
  postMessage(message: OpfsReadSpikeWorkerResponse): void;
}

const SPIKE_FILE_NAME = "m0-opfs-sync-access-handle-v2.bin";
const workerScope = globalThis as unknown as StorageWorkerScope;
let started = false;

interface OpfsFileHandle extends FileSystemFileHandle {
  createSyncAccessHandle(): Promise<OpfsSyncAccessHandle>;
}

workerScope.onmessage = (event): void => {
  if (started) {
    postFailure("Storage worker received more than one start message");
    return;
  }
  started = true;
  void runSpike(event.data.config).catch((error: unknown) => {
    postFailure(error instanceof Error ? error.message : String(error));
  });
};

async function runSpike(config: OpfsReadSpikeConfig): Promise<void> {
  validateConfig(config);
  const deadline = performance.now() + OPFS_SPIKE_TIMEOUT_MS;
  const root = await navigator.storage.getDirectory();
  const file = await root.getFileHandle(SPIKE_FILE_NAME, { create: true });
  const accessHandle = await (file as OpfsFileHandle).createSyncAccessHandle();
  let result: OpfsReadSpikeWorkerResult | null = null;
  let primaryFailure: Readonly<{ error: unknown }> | null = null;
  try {
    const fileReused = accessHandle.getSize() === config.fileBytes;
    const provisioning = fileReused
      ? Object.freeze({ bytesWritten: 0, elapsedMs: 0 })
      : provisionFile(accessHandle, config, deadline);
    const sequential = measureSequentialReads(accessHandle, config, deadline);
    const random = measureRandomReads(accessHandle, config, deadline);
    const validationErrors = sequential.validationErrors + random.validationErrors;
    if (validationErrors !== 0) {
      throw new Error(`OPFS read validation found ${validationErrors} data errors`);
    }
    result = {
      fileBytes: config.fileBytes,
      fileReused,
      kind: "opfs-read-spike-result",
      provisioningBytesWritten: provisioning.bytesWritten,
      provisioningElapsedMs: provisioning.elapsedMs,
      random,
      sequential,
    };
  } catch (error: unknown) {
    primaryFailure = Object.freeze({ error });
  }
  let closeFailure: Readonly<{ error: unknown }> | null = null;
  try {
    accessHandle.close();
  } catch (error: unknown) {
    closeFailure = Object.freeze({ error });
  }
  // Preserve the operation failure when both work and cleanup fail; it is the
  // actionable root cause. A close-only failure still invalidates the lifecycle.
  if (primaryFailure !== null) throw primaryFailure.error;
  if (closeFailure !== null) throw closeFailure.error;
  if (result === null) throw new Error("OPFS read spike produced no result");
  // Cleanup is part of successful lifecycle evidence: publish only after close()
  // returns, so a close failure produces one failure response and never a prior green.
  workerScope.postMessage(result);
}

function provisionFile(
  accessHandle: OpfsSyncAccessHandle,
  config: OpfsReadSpikeConfig,
  deadline: number,
): Readonly<{ bytesWritten: number; elapsedMs: number }> {
  accessHandle.truncate(0);
  const buffer = new Uint8Array(config.sequentialReadBytes);
  let bytesWritten = 0;
  const startedAt = performance.now();
  while (bytesWritten < config.fileBytes) {
    ensureBeforeDeadline(deadline);
    fillPositionPattern(buffer, bytesWritten);
    const written = accessHandle.write(buffer, { at: bytesWritten });
    if (written !== buffer.byteLength) {
      throw new Error(
        `OPFS provisioning short write: expected ${buffer.byteLength}, wrote ${written}`,
      );
    }
    bytesWritten += written;
  }
  accessHandle.flush();
  return Object.freeze({ bytesWritten, elapsedMs: performance.now() - startedAt });
}

function measureRandomReads(
  accessHandle: OpfsSyncAccessHandle,
  config: OpfsReadSpikeConfig,
  deadline: number,
): OpfsReadPhaseTelemetry {
  const buffer = new Uint8Array(config.randomReadBytes);
  const slots = config.fileBytes / config.randomReadBytes;
  let randomState = 0x6d2b_79f5;
  let bytesRead = 0;
  let readCallElapsedMs = 0;
  let validationErrors = 0;
  const wallStartedAt = performance.now();
  for (let operation = 0; operation < config.randomReads; operation += 1) {
    ensureBeforeDeadline(deadline);
    randomState = xorshift32(randomState);
    const offset = (randomState % slots) * config.randomReadBytes;
    const readStartedAt = performance.now();
    const read = accessHandle.read(buffer, { at: offset });
    readCallElapsedMs += performance.now() - readStartedAt;
    if (read !== buffer.byteLength) {
      throw new Error(
        `OPFS random short read at ${offset}: expected ${buffer.byteLength}, read ${read}`,
      );
    }
    validationErrors += validatePositionPattern(buffer, offset);
    bytesRead += read;
  }
  return readPhase(
    bytesRead,
    config.randomReads,
    readCallElapsedMs,
    performance.now() - wallStartedAt,
    validationErrors,
  );
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

function validateConfig(config: OpfsReadSpikeConfig): void {
  const values = [
    config.fileBytes,
    config.randomReadBytes,
    config.randomReads,
    config.sequentialPasses,
    config.sequentialReadBytes,
  ];
  if (!values.every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error("OPFS spike config values must be positive safe integers");
  }
  if (
    config.fileBytes % config.sequentialReadBytes !== 0 ||
    config.sequentialReadBytes % config.randomReadBytes !== 0 ||
    config.fileBytes % Uint32Array.BYTES_PER_ELEMENT !== 0 ||
    config.randomReadBytes % Uint32Array.BYTES_PER_ELEMENT !== 0 ||
    config.sequentialReadBytes % Uint32Array.BYTES_PER_ELEMENT !== 0 ||
    config.fileBytes / Uint32Array.BYTES_PER_ELEMENT > 2 ** 32
  ) {
    throw new Error(
      "OPFS spike sizes must divide exactly, remain 32-bit-word aligned, and fit the position pattern",
    );
  }
}

function fillPositionPattern(buffer: Uint8Array, offset: number): void {
  const words = new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
  const firstWord = offset / Uint32Array.BYTES_PER_ELEMENT;
  for (let index = 0; index < words.length; index += 1) {
    words[index] = firstWord + index;
  }
}

function xorshift32(value: number): number {
  let next = value | 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  return next >>> 0;
}

function ensureBeforeDeadline(deadline: number): void {
  if (performance.now() > deadline) {
    throw new Error(`OPFS read spike exceeded ${OPFS_SPIKE_TIMEOUT_MS} ms`);
  }
}

function postFailure(message: string): void {
  workerScope.postMessage({ kind: "opfs-read-spike-failure", message });
}
