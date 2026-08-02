import {
  OFFLINE_SHELL_LOCK_NAME,
  OFFLINE_SHELL_PREPARE_LOCK_NAME,
  type OfflineShellStoreRecord,
  parseOfflineShellStoreRecord,
} from "./shell-generation-contract";
import {
  initialOfflineShellStoreRecord,
  type OfflineShellFetchedResource,
  type OfflineShellStorePlatform,
} from "./shell-generation-store";

const DATABASE_NAME = "parallax-offline-shell-v1";
const DATABASE_VERSION = 1;
const OBJECT_STORE = "state";
const RECORD_KEY = "selection";
const CACHE_PREFIX = "parallax-offline-shell-v1-";

export interface OfflineShellBrowserPlatformInput {
  readonly cacheStorage?: CacheStorage;
  readonly fetch?: typeof globalThis.fetch;
  readonly indexedDb?: IDBFactory;
  readonly lockManager?: LockManager;
  readonly origin?: string;
}

export function createBrowserOfflineShellStorePlatform(
  input: OfflineShellBrowserPlatformInput = {},
): OfflineShellStorePlatform {
  const cacheStorage = input.cacheStorage ?? caches;
  const fetchImplementation = input.fetch ?? globalThis.fetch.bind(globalThis);
  const indexedDb = input.indexedDb ?? indexedDB;
  const lockManager = input.lockManager ?? navigator.locks;
  const origin = new URL(input.origin ?? location.origin).origin;

  const readRecord = async (): Promise<OfflineShellStoreRecord> =>
    withClosedDatabase(
      () => openOfflineShellDatabase(indexedDb),
      async (db) => {
        const transaction = db.transaction(OBJECT_STORE, "readonly");
        const value = await requestResult(transaction.objectStore(OBJECT_STORE).get(RECORD_KEY));
        await transactionDone(transaction);
        return value === undefined
          ? initialOfflineShellStoreRecord()
          : parseOfflineShellStoreRecord(value);
      },
    );

  const writeRecord = async (record: OfflineShellStoreRecord): Promise<void> =>
    withClosedDatabase(
      () => openOfflineShellDatabase(indexedDb),
      async (db) => {
        const validated = parseOfflineShellStoreRecord(record);
        const transaction = db.transaction(OBJECT_STORE, "readwrite", { durability: "strict" });
        transaction.objectStore(OBJECT_STORE).put(validated, RECORD_KEY);
        await transactionDone(transaction);
      },
    );

  return Object.freeze({
    origin,
    async collectGenerations(retainedGenerationIds: ReadonlySet<string>): Promise<void> {
      await collectOfflineShellGenerationCaches(cacheStorage, retainedGenerationIds);
    },
    async deleteGeneration(generationId: string): Promise<void> {
      await cacheStorage.delete(cacheName(generationId));
    },
    async fetch(path: string): Promise<OfflineShellFetchedResource> {
      const url = exactUrl(origin, path);
      const response = await fetchImplementation(url, {
        cache: "reload",
        credentials: "same-origin",
        redirect: "error",
      });
      return responseRecord(response, response.url);
    },
    async match(generationId: string, path: string): Promise<OfflineShellFetchedResource | null> {
      const url = exactUrl(origin, path);
      const response = await cacheStorage.match(url, { cacheName: cacheName(generationId) });
      return response === undefined ? null : responseRecord(response, url);
    },
    now: () => performance.now(),
    async put(
      generationId: string,
      path: string,
      response: OfflineShellFetchedResource,
    ): Promise<void> {
      const cache = await cacheStorage.open(cacheName(generationId));
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) headers.set(name, value);
      await cache.put(
        exactUrl(origin, path),
        new Response(response.bytes.slice().buffer, {
          headers,
          status: response.status,
        }),
      );
    },
    readRecord,
    async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
      return lockManager.request(OFFLINE_SHELL_LOCK_NAME, { mode: "exclusive" }, operation);
    },
    async runPrepareExclusive<T>(operation: () => Promise<T>): Promise<T> {
      return lockManager.request(OFFLINE_SHELL_PREPARE_LOCK_NAME, { mode: "exclusive" }, operation);
    },
    async updateRecord(
      update: (record: OfflineShellStoreRecord) => OfflineShellStoreRecord,
    ): Promise<OfflineShellStoreRecord> {
      return withClosedDatabase(
        () => openOfflineShellDatabase(indexedDb),
        async (db) => {
          const transaction = db.transaction(OBJECT_STORE, "readwrite", { durability: "strict" });
          const store = transaction.objectStore(OBJECT_STORE);
          const currentValue = await requestResult(store.get(RECORD_KEY));
          const current =
            currentValue === undefined
              ? initialOfflineShellStoreRecord()
              : parseOfflineShellStoreRecord(currentValue);
          const next = parseOfflineShellStoreRecord(update(current));
          store.put(next, RECORD_KEY);
          await transactionDone(transaction);
          return next;
        },
      );
    },
    writeRecord,
  });
}

export async function withClosedDatabase<T>(
  open: () => Promise<IDBDatabase>,
  operation: (database: IDBDatabase) => Promise<T>,
): Promise<T> {
  const database = await open();
  try {
    return await operation(database);
  } finally {
    database.close();
  }
}

export async function collectOfflineShellGenerationCaches(
  cacheStorage: CacheStorage,
  retainedGenerationIds: ReadonlySet<string>,
): Promise<void> {
  const retainedNames = new Set(
    [...retainedGenerationIds].map((generationId) => cacheName(generationId)),
  );
  for (const name of await cacheStorage.keys()) {
    if (!name.startsWith(CACHE_PREFIX) || retainedNames.has(name)) continue;
    if (!(await cacheStorage.delete(name))) {
      throw new Error(`Offline-shell cache deletion failed: ${name}`);
    }
  }
}

async function responseRecord(
  response: Response,
  url: string,
): Promise<OfflineShellFetchedResource> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });
  return Object.freeze({
    bytes: new Uint8Array(await response.arrayBuffer()),
    headers: Object.freeze(headers),
    status: response.status,
    url,
  });
}

export function openOfflineShellDatabase(indexedDb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OBJECT_STORE)) {
        database.createObjectStore(OBJECT_STORE);
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () =>
      reject(request.error ?? new Error("Offline-shell IndexedDB open failed"));
    request.onblocked = () => reject(new Error("Offline-shell IndexedDB upgrade is blocked"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Offline-shell IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Offline-shell IndexedDB transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Offline-shell IndexedDB transaction failed"));
  });
}

function cacheName(generationId: string): string {
  if (!/^[a-f0-9]{64}:[a-f0-9]{64}$/.test(generationId)) {
    throw new Error("Offline-shell cache generation identity is invalid");
  }
  return `${CACHE_PREFIX}${generationId.replace(":", "-")}`;
}

function exactUrl(origin: string, path: string): string {
  const url = new URL(`/${path}`, origin);
  if (
    url.origin !== origin ||
    url.pathname !== `/${path}` ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`Offline-shell path is not exact: ${path}`);
  }
  return url.href;
}
