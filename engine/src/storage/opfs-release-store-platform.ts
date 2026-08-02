import { INSTALL_STORE_ROOT } from "./opfs-release-store-contract";

export interface InstallStorePlatformEntry {
  readonly kind: "directory" | "file";
  readonly path: string;
  readonly size: number;
}

export interface InstallStoreListOptions {
  readonly recursive?: boolean;
}

export class InstallStorePathNotFoundError extends Error {
  public constructor(path: string) {
    super(`Install-store path does not exist: ${path}`);
    this.name = "InstallStorePathNotFoundError";
  }
}

export class InstallStorePathChangedError extends Error {
  public constructor(path: string) {
    super(`Install-store path changed during stable read: ${path}`);
    this.name = "InstallStorePathChangedError";
  }
}

export interface InstallStorePlatform {
  append(path: string, expectedOffset: number, bytes: Uint8Array): Promise<number>;
  flush(path: string): Promise<void>;
  list(
    directory: string,
    options?: InstallStoreListOptions,
  ): Promise<readonly InstallStorePlatformEntry[]>;
  now(): number;
  probe(bytes: Uint8Array): Promise<void>;
  read(path: string): Promise<Uint8Array | null>;
  readChunks(path: string, chunkBytes: number): AsyncIterable<Uint8Array>;
  remove(path: string, recursive?: boolean): Promise<void>;
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
  size(path: string): Promise<number | null>;
  truncate(path: string, bytes: number): Promise<void>;
  writeRecord(path: string, bytes: Uint8Array): Promise<void>;
}

export interface MemoryInstallStoreFault {
  readonly kind: "fail-after" | "fail-before" | "quota" | "short-append" | "torn-record";
  readonly operation: number;
}

interface MemoryState {
  active: boolean;
  readonly directories: Set<string>;
  readonly directoryPersistent: boolean;
  readonly files: Map<string, Uint8Array>;
  readonly logicalSizes: Map<string, number>;
  readonly queue: Array<() => Promise<void>>;
}

export interface MemoryInstallStorePlatform extends InstallStorePlatform {
  readonly operationLog: readonly string[];
  clearFault(): void;
  forkContender(): MemoryInstallStorePlatform;
  hasSeededFile(path: string): boolean;
  reconstruct(): MemoryInstallStorePlatform;
  seedExternalDirectory(path: string): void;
  seedExternalFile(path: string, bytes: Uint8Array): void;
  seedSparseFile(path: string, size: number): void;
  setFault(fault: MemoryInstallStoreFault | null): void;
}

export function createMemoryInstallStorePlatform(): MemoryInstallStorePlatform {
  return memoryPlatform({
    active: false,
    directories: new Set(),
    directoryPersistent: false,
    files: new Map(),
    logicalSizes: new Map(),
    queue: [],
  });
}

export function createDirectoryPersistentMemoryInstallStorePlatform(): MemoryInstallStorePlatform {
  return memoryPlatform({
    active: false,
    directories: new Set(),
    directoryPersistent: true,
    files: new Map(),
    logicalSizes: new Map(),
    queue: [],
  });
}

export function assertInstallStorePath(path: string): void {
  if (
    path !== INSTALL_STORE_ROOT &&
    (!path.startsWith(`${INSTALL_STORE_ROOT}/`) ||
      path.includes("\\") ||
      path.split("/").some((segment) => segment === "" || segment === "." || segment === ".."))
  ) {
    throw new Error(`Path is outside the ${INSTALL_STORE_ROOT} capability: ${path}`);
  }
}

function memoryPlatform(state: MemoryState): MemoryInstallStorePlatform {
  const log: string[] = [];
  let fault: MemoryInstallStoreFault | null = null;
  let operation = 0;

  const mutate = async <T>(name: string, action: () => T): Promise<T> => {
    operation += 1;
    log.push(name);
    if (fault?.operation === operation && fault.kind === "fail-before") {
      throw new Error(`Injected failure before ${name}`);
    }
    if (fault?.operation === operation && fault.kind === "quota") {
      throw new DOMException(`Injected quota failure at ${name}`, "QuotaExceededError");
    }
    const result = action();
    if (fault?.operation === operation && fault.kind === "fail-after") {
      throw new Error(`Injected failure after ${name}`);
    }
    return result;
  };

  const api: MemoryInstallStorePlatform = {
    append: (path, expectedOffset, bytes) => {
      assertInstallStorePath(path);
      retainParentDirectories(state, path);
      return mutate(`append:${path}`, () => {
        const current = state.files.get(path) ?? new Uint8Array();
        if (current.byteLength !== expectedOffset) throw new Error("Append offset mismatch");
        const written =
          fault?.operation === operation && fault.kind === "short-append"
            ? Math.max(0, bytes.byteLength - 1)
            : bytes.byteLength;
        const next = new Uint8Array(current.byteLength + written);
        next.set(current);
        next.set(bytes.subarray(0, written), current.byteLength);
        state.files.set(path, next);
        state.logicalSizes.delete(path);
        return written;
      });
    },
    clearFault() {
      fault = null;
    },
    flush: (path) => {
      assertInstallStorePath(path);
      return mutate(`flush:${path}`, () => {
        if (!state.files.has(path)) throw new InstallStorePathNotFoundError(path);
      });
    },
    forkContender: () => memoryPlatform(state),
    hasSeededFile: (path) => state.files.has(path),
    list: async (directory, options) => {
      assertInstallStorePath(directory);
      log.push(`list:${directory}:${options?.recursive === true ? "recursive" : "direct"}`);
      return memoryEntries(state, directory, options?.recursive === true);
    },
    now: () => 0,
    operationLog: log,
    async probe(bytes) {
      const path = `${INSTALL_STORE_ROOT}/quota-probe.bin`;
      await api.remove(path);
      let failure: unknown;
      try {
        const written = await api.append(path, 0, bytes);
        if (written !== bytes.byteLength) {
          throw new Error(
            `Short quota-probe write: expected ${bytes.byteLength}, wrote ${written}`,
          );
        }
        await api.flush(path);
      } catch (error: unknown) {
        failure = error;
      }
      try {
        await api.remove(path);
      } catch (error: unknown) {
        if (failure === undefined) failure = error;
      }
      if (failure !== undefined) throw failure;
    },
    read: async (path) => {
      assertInstallStorePath(path);
      log.push(`read:${path}`);
      return state.files.get(path)?.slice() ?? null;
    },
    async *readChunks(path, chunkBytes) {
      assertInstallStorePath(path);
      log.push(`readChunks:${path}`);
      const bytes = state.files.get(path);
      if (bytes === undefined) throw new InstallStorePathNotFoundError(path);
      for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) {
        yield bytes.slice(offset, Math.min(bytes.byteLength, offset + chunkBytes));
        if (state.files.get(path) !== bytes) {
          throw new InstallStorePathChangedError(path);
        }
      }
    },
    reconstruct: () => memoryPlatform(state),
    remove: (path, recursive = false) => {
      assertInstallStorePath(path);
      return mutate(`remove:${path}`, () => {
        if (recursive) {
          for (const candidate of [...state.files.keys()]) {
            if (candidate === path || candidate.startsWith(`${path}/`)) {
              state.files.delete(candidate);
              state.logicalSizes.delete(candidate);
            }
          }
          for (const candidate of [...state.directories]) {
            if (candidate === path || candidate.startsWith(`${path}/`)) {
              state.directories.delete(candidate);
            }
          }
        } else {
          if (
            state.directories.has(path) &&
            ([...state.files.keys()].some((candidate) => candidate.startsWith(`${path}/`)) ||
              [...state.directories].some((candidate) => candidate.startsWith(`${path}/`)))
          ) {
            throw new DOMException(`Directory is not empty: ${path}`, "InvalidModificationError");
          }
          state.files.delete(path);
          state.logicalSizes.delete(path);
          state.directories.delete(path);
        }
      });
    },
    runExclusive<T>(callback: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        state.queue.push(async () => {
          try {
            resolve(await callback());
          } catch (error: unknown) {
            reject(error);
          }
        });
        drainMemoryQueue(state);
      });
    },
    seedExternalDirectory(path) {
      assertInstallStorePath(path);
      if (!state.directoryPersistent) {
        throw new Error("Memory install-store platform does not retain empty directories");
      }
      retainParentDirectories(state, `${path}/placeholder`);
      state.directories.add(path);
    },
    seedExternalFile(path, bytes) {
      retainParentDirectories(state, path);
      state.files.set(path, bytes.slice());
      state.logicalSizes.delete(path);
    },
    seedSparseFile(path, size) {
      assertInstallStorePath(path);
      if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid sparse file size");
      retainParentDirectories(state, path);
      state.files.set(path, new Uint8Array());
      state.logicalSizes.set(path, size);
    },
    setFault(next) {
      fault = next;
      operation = 0;
    },
    size: async (path) => {
      assertInstallStorePath(path);
      log.push(`size:${path}`);
      return state.files.has(path)
        ? (state.logicalSizes.get(path) ?? state.files.get(path)?.byteLength ?? null)
        : null;
    },
    truncate: (path, bytes) => {
      assertInstallStorePath(path);
      return mutate(`truncate:${path}`, () => {
        const current = state.files.get(path);
        if (current === undefined || !Number.isSafeInteger(bytes) || bytes < 0) {
          throw new Error("Invalid truncate");
        }
        state.files.set(path, current.slice(0, bytes));
        state.logicalSizes.delete(path);
      });
    },
    writeRecord: (path, bytes) => {
      assertInstallStorePath(path);
      retainParentDirectories(state, path);
      return mutate(`writeRecord:${path}`, () => {
        const written =
          fault?.operation === operation && fault.kind === "torn-record"
            ? Math.max(0, bytes.byteLength - 1)
            : bytes.byteLength;
        state.files.set(path, bytes.slice(0, written));
        state.logicalSizes.delete(path);
      });
    },
  };
  return Object.freeze(api);
}

function drainMemoryQueue(state: MemoryState): void {
  if (state.active) return;
  const next = state.queue.shift();
  if (next === undefined) return;
  state.active = true;
  void next().finally(() => {
    state.active = false;
    drainMemoryQueue(state);
  });
}

function memoryEntries(
  state: MemoryState,
  directory: string,
  recursive: boolean,
): readonly InstallStorePlatformEntry[] {
  const entries = new Map<string, InstallStorePlatformEntry>();
  const prefix = `${directory}/`;
  for (const path of state.directories) {
    if (!path.startsWith(prefix)) continue;
    const remainder = path.slice(prefix.length);
    const segments = remainder.split("/");
    const directoryPath = recursive ? path : `${directory}/${segments[0]}`;
    entries.set(directoryPath, { kind: "directory", path: directoryPath, size: 0 });
  }
  for (const [path, bytes] of state.files) {
    if (!path.startsWith(prefix)) continue;
    const remainder = path.slice(prefix.length);
    const segments = remainder.split("/");
    const filePath = recursive ? path : `${directory}/${segments[0]}`;
    if (!recursive && segments.length > 1) {
      entries.set(filePath, { kind: "directory", path: filePath, size: 0 });
      continue;
    }
    if (recursive) {
      for (let depth = 1; depth < segments.length; depth += 1) {
        const directoryPath = `${directory}/${segments.slice(0, depth).join("/")}`;
        entries.set(directoryPath, { kind: "directory", path: directoryPath, size: 0 });
      }
    }
    entries.set(filePath, {
      kind: "file",
      path: filePath,
      size: state.logicalSizes.get(path) ?? bytes.byteLength,
    });
  }
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function retainParentDirectories(state: MemoryState, path: string): void {
  if (!state.directoryPersistent) return;
  const segments = path.split("/");
  for (let depth = 2; depth < segments.length; depth += 1) {
    state.directories.add(segments.slice(0, depth).join("/"));
  }
}
