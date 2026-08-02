import {
  INSTALL_STORE_LOCK_NAME,
  INSTALL_STORE_ROOT,
  InstallStoreLockTimeoutError,
} from "./opfs-release-store-contract";
import {
  assertInstallStorePath,
  InstallStorePathChangedError,
  InstallStorePathNotFoundError,
  type InstallStorePlatform,
  type InstallStorePlatformEntry,
} from "./opfs-release-store-platform";
import type { OpfsSyncAccessHandle } from "./opfs-sync-access-handle";

interface SyncFileHandle extends FileSystemFileHandle {
  createSyncAccessHandle(): Promise<OpfsSyncAccessHandle>;
}

interface IterableDirectory {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}

export const INSTALL_STORE_LOCK_ACQUISITION_TIMEOUT_MS = 30_000;

export interface InstallStoreLockPlatform {
  clearTimeout(handle: unknown): void;
  request<T>(
    name: string,
    options: Readonly<{ mode: "exclusive"; signal: AbortSignal }>,
    operation: () => Promise<T>,
  ): Promise<T>;
  setTimeout(callback: () => void, milliseconds: number): unknown;
}

export function runWithBrowserInstallStoreLock<T>(
  operation: () => Promise<T>,
  platform: InstallStoreLockPlatform = browserInstallStoreLockPlatform(),
): Promise<T> {
  const abort = new AbortController();
  let acquired = false;
  let timeout: unknown;
  const acquisitionDeadline = new Promise<never>((_resolve, reject) => {
    timeout = platform.setTimeout(() => {
      if (acquired) return;
      const failure = new InstallStoreLockTimeoutError();
      abort.abort(failure);
      reject(failure);
    }, INSTALL_STORE_LOCK_ACQUISITION_TIMEOUT_MS);
  });
  const lockRequest = Promise.resolve().then(() =>
    platform.request(INSTALL_STORE_LOCK_NAME, { mode: "exclusive", signal: abort.signal }, () => {
      acquired = true;
      platform.clearTimeout(timeout);
      return operation();
    }),
  );
  return Promise.race([lockRequest, acquisitionDeadline]).finally(() => {
    platform.clearTimeout(timeout);
  });
}

export function createBrowserInstallStorePlatform(): InstallStorePlatform {
  const root = (): Promise<FileSystemDirectoryHandle> => navigator.storage.getDirectory();
  const platform: InstallStorePlatform = {
    async append(path: string, expectedOffset: number, bytes: Uint8Array) {
      assertInstallStorePath(path);
      const handle = (await fileHandle(await root(), path, true)) as SyncFileHandle;
      if (typeof handle.createSyncAccessHandle !== "function") {
        throw new Error("OPFS sync access handles are unavailable in this worker");
      }
      const access = await handle.createSyncAccessHandle();
      try {
        return durablyAppendSyncAccessHandle(access, expectedOffset, bytes);
      } finally {
        access.close();
      }
    },
    async flush(path: string) {
      assertInstallStorePath(path);
      // Browser appends flush their own exclusive access handle before it closes. Keep
      // this platform barrier handle-free so store orchestration and fault platforms
      // retain one contract without reopening a different OPFS access handle.
    },
    async list(directory: string, options) {
      assertInstallStorePath(directory);
      let handle: FileSystemDirectoryHandle;
      try {
        handle = await directoryHandle(await root(), directory, false);
      } catch (error: unknown) {
        if (isNotFound(error)) return [];
        throw error;
      }
      const entries: InstallStorePlatformEntry[] = [];
      await walk(handle, directory, entries, options?.recursive === true);
      return entries.sort((left, right) => left.path.localeCompare(right.path));
    },
    now: () => performance.now(),
    async probe(bytes) {
      const path = `${INSTALL_STORE_ROOT}/quota-probe.bin`;
      await platform.remove(path);
      let failure: unknown;
      try {
        const written = await platform.append(path, 0, bytes);
        if (written !== bytes.byteLength) {
          throw new Error(
            `Short quota-probe write: expected ${bytes.byteLength}, wrote ${written}`,
          );
        }
        await platform.flush(path);
      } catch (error: unknown) {
        failure = error;
      }
      try {
        await platform.remove(path);
      } catch (error: unknown) {
        if (failure === undefined) failure = error;
      }
      if (failure !== undefined) throw failure;
    },
    async read(path: string) {
      assertInstallStorePath(path);
      try {
        const file = await (await fileHandle(await root(), path, false)).getFile();
        return new Uint8Array(await file.arrayBuffer());
      } catch (error: unknown) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async *readChunks(path: string, chunkBytes: number) {
      assertInstallStorePath(path);
      let handle: FileSystemFileHandle;
      let file: File;
      try {
        handle = await fileHandle(await root(), path, false);
        file = await handle.getFile();
      } catch (error: unknown) {
        if (isNotFound(error)) throw new InstallStorePathNotFoundError(path);
        throw error;
      }
      for (let offset = 0; offset < file.size; offset += chunkBytes) {
        const end = Math.min(file.size, offset + chunkBytes);
        const chunk = new Uint8Array(await file.slice(offset, end).arrayBuffer());
        yield chunk;
        const current = await handle.getFile();
        if (
          current.size !== file.size ||
          current.lastModified !== file.lastModified ||
          !(await hasExactBoundaryBytes(current, offset, end, chunk))
        ) {
          throw new InstallStorePathChangedError(path);
        }
      }
    },
    async remove(path: string, recursive = false) {
      assertInstallStorePath(path);
      try {
        const { directory, name } = await parentDirectory(await root(), path, false);
        await directory.removeEntry(name, { recursive });
      } catch (error: unknown) {
        if (!isNotFound(error)) throw error;
      }
    },
    async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
      if (navigator.locks === undefined) {
        throw new Error("Web Locks are required by the OPFS release store");
      }
      return runWithBrowserInstallStoreLock(operation);
    },
    async size(path: string) {
      assertInstallStorePath(path);
      try {
        return (await (await fileHandle(await root(), path, false)).getFile()).size;
      } catch (error: unknown) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async truncate(path: string, bytes: number) {
      assertInstallStorePath(path);
      const handle = (await fileHandle(await root(), path, false)) as SyncFileHandle;
      if (typeof handle.createSyncAccessHandle !== "function") {
        throw new Error("OPFS sync access handles are unavailable in this worker");
      }
      const access = await handle.createSyncAccessHandle();
      try {
        access.truncate(bytes);
        access.flush();
      } finally {
        access.close();
      }
    },
    async writeRecord(path: string, bytes: Uint8Array) {
      assertInstallStorePath(path);
      const writable = await (await fileHandle(await root(), path, true)).createWritable({
        keepExistingData: false,
      });
      try {
        await writable.write(new Uint8Array(bytes));
        await writable.close();
      } catch (error: unknown) {
        try {
          await writable.abort();
        } catch (cleanupError: unknown) {
          throw new AggregateError(
            [error, cleanupError],
            "Install-store record write/close and abort cleanup both failed",
          );
        }
        throw error;
      }
    },
  };
  return Object.freeze(platform);
}

export function durablyAppendSyncAccessHandle(
  access: OpfsSyncAccessHandle,
  expectedOffset: number,
  bytes: Uint8Array,
): number {
  if (access.getSize() !== expectedOffset) throw new Error("Append offset mismatch");
  const written = access.write(bytes, { at: expectedOffset });
  access.flush();
  return written;
}

function browserInstallStoreLockPlatform(): InstallStoreLockPlatform {
  return Object.freeze({
    clearTimeout: (handle: unknown) => globalThis.clearTimeout(handle as number),
    request: <T>(
      name: string,
      options: Readonly<{ mode: "exclusive"; signal: AbortSignal }>,
      operation: () => Promise<T>,
    ) => navigator.locks.request(name, options, operation),
    setTimeout: (callback: () => void, milliseconds: number) =>
      globalThis.setTimeout(callback, milliseconds),
  });
}

async function hasExactBoundaryBytes(
  file: File,
  start: number,
  end: number,
  expected: Uint8Array,
): Promise<boolean> {
  if (expected.byteLength !== end - start || expected.byteLength === 0) {
    return expected.byteLength === 0 && end === start;
  }
  const first = new Uint8Array(await file.slice(start, start + 1).arrayBuffer());
  const last =
    expected.byteLength === 1
      ? first
      : new Uint8Array(await file.slice(end - 1, end).arrayBuffer());
  return first[0] === expected[0] && last[0] === expected[expected.byteLength - 1];
}

export async function openBrowserInstallStoreFile(path: string): Promise<FileSystemFileHandle> {
  assertInstallStorePath(path);
  return fileHandle(await navigator.storage.getDirectory(), path, false);
}

async function fileHandle(
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<FileSystemFileHandle> {
  const { directory, name } = await parentDirectory(root, path, create);
  return directory.getFileHandle(name, { create });
}

async function parentDirectory(
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<{ directory: FileSystemDirectoryHandle; name: string }> {
  const segments = safeSegments(path);
  const name = segments.pop();
  if (name === undefined) throw new Error("A file path is required");
  let directory = root;
  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment, { create });
  }
  return { directory, name };
}

async function directoryHandle(
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  let directory = root;
  for (const segment of safeSegments(path)) {
    directory = await directory.getDirectoryHandle(segment, { create });
  }
  return directory;
}

function safeSegments(path: string): string[] {
  assertInstallStorePath(path);
  return path.split("/");
}

async function walk(
  directory: FileSystemDirectoryHandle,
  prefix: string,
  output: InstallStorePlatformEntry[],
  recursive: boolean,
): Promise<void> {
  const iterable = directory as unknown as IterableDirectory;
  for await (const [name, handle] of iterable.entries()) {
    const path = `${prefix}/${name}`;
    if (handle.kind === "directory") {
      output.push({ kind: "directory", path, size: 0 });
      if (recursive) await walk(handle as FileSystemDirectoryHandle, path, output, true);
    } else {
      const size = (await (handle as FileSystemFileHandle).getFile()).size;
      output.push({ kind: "file", path, size });
    }
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}
