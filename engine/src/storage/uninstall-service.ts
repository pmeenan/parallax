import {
  OFFLINE_SHELL_LOCK_NAME,
  OFFLINE_SHELL_PREPARE_LOCK_NAME,
  OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION,
} from "../offline-shell/shell-generation-contract";
import { INSTALL_STORE_LOCK_NAME } from "./opfs-release-store-contract";

export const UNINSTALL_TELEMETRY_CONTRACT = "uninstall-telemetry@1" as const;
export const UNINSTALL_TELEMETRY_SCHEMA_VERSION = 1 as const;

export type UninstallState = "failed" | "idle" | "running" | "succeeded";
export type UninstallSurface = "cache-storage" | "indexed-db" | "opfs" | "service-workers";

export interface UninstallSurfaceObservation {
  readonly after: readonly string[];
  readonly attempted: readonly string[];
  readonly before: readonly string[];
  readonly removed: readonly string[];
  readonly surface: UninstallSurface;
}

export interface UninstallFailure {
  readonly message: string;
  readonly phase:
    | "after"
    | "before"
    | "delete"
    | "prepare"
    | "quiescence"
    | "quota-after"
    | "quota-before";
  readonly surface: UninstallSurface | "quota" | "runtime";
}

export interface UninstallTelemetrySnapshot {
  readonly attempt: number;
  readonly contract: typeof UNINSTALL_TELEMETRY_CONTRACT;
  readonly coverage: Readonly<{
    readonly cacheStorage: "observed";
    readonly dawnGpuCache: "not-observable-from-page";
    readonly httpCache: "not-observable-from-page";
    readonly indexedDb: "observed";
    readonly opfs: "observed";
    readonly serviceWorkers: "observed";
    readonly v8CodeCache: "not-observable-from-page";
  }>;
  readonly failures: readonly UninstallFailure[];
  readonly quota: Readonly<{
    readonly afterQuota: number | null;
    readonly afterUsage: number | null;
    readonly beforeQuota: number | null;
    readonly beforeUsage: number | null;
    readonly releasedBytes: number | null;
    readonly teardownKind: "idempotent-empty" | "nonempty" | "unverified";
  }>;
  readonly quiescence: Readonly<{
    readonly clientCount: number | null;
    readonly exclusiveLocksHeld: boolean;
    readonly stableInventoryPasses: number;
  }>;
  readonly schemaVersion: typeof UNINSTALL_TELEMETRY_SCHEMA_VERSION;
  readonly state: UninstallState;
  readonly surfaces: readonly UninstallSurfaceObservation[];
}

export interface UninstallPlatform {
  readonly cacheStorage: Readonly<{
    delete(name: string): Promise<boolean>;
    keys(): Promise<readonly string[]>;
  }>;
  readonly indexedDb: Readonly<{
    delete(name: string): Promise<void>;
    names(): Promise<readonly string[]>;
  }>;
  readonly opfs: Readonly<{
    names(): Promise<readonly string[]>;
    remove(name: string): Promise<void>;
  }>;
  readonly serviceWorkers: Readonly<{
    registrations(): Promise<
      readonly Readonly<{ scope: string; unregister(): Promise<boolean> }>[]
    >;
  }>;
  estimate(): Promise<Readonly<{ quota?: number; usage?: number }>>;
  exclusiveClientCount(): Promise<number>;
  taskTurn(): Promise<void>;
  withDeletionAuthority<T>(operation: () => Promise<T>): Promise<T>;
}

export interface UninstallService {
  snapshot(): UninstallTelemetrySnapshot;
  subscribe(listener: (snapshot: UninstallTelemetrySnapshot) => void): () => void;
  uninstall(): Promise<UninstallTelemetrySnapshot>;
}

const MAX_ENTRIES = 4_096;
const MAX_NAME_LENGTH = 1_024;
const COVERAGE = Object.freeze({
  cacheStorage: "observed" as const,
  dawnGpuCache: "not-observable-from-page" as const,
  httpCache: "not-observable-from-page" as const,
  indexedDb: "observed" as const,
  opfs: "observed" as const,
  serviceWorkers: "observed" as const,
  v8CodeCache: "not-observable-from-page" as const,
});

export function createUninstallService(
  platform: UninstallPlatform = createBrowserUninstallPlatform(),
  prepare: () => Promise<void> = async () => undefined,
): UninstallService {
  const listeners = new Set<(snapshot: UninstallTelemetrySnapshot) => void>();
  let attempt = 0;
  let state: UninstallState = "idle";
  let failures: UninstallFailure[] = [];
  let surfaces: UninstallSurfaceObservation[] = [];
  let quota: UninstallTelemetrySnapshot["quota"] = emptyQuota();
  let quiescence = emptyQuiescence();

  const current = (): UninstallTelemetrySnapshot =>
    Object.freeze({
      attempt,
      contract: UNINSTALL_TELEMETRY_CONTRACT,
      coverage: COVERAGE,
      failures: Object.freeze(failures.map((failure) => Object.freeze({ ...failure }))),
      quota: Object.freeze({ ...quota }),
      quiescence: Object.freeze({ ...quiescence }),
      schemaVersion: UNINSTALL_TELEMETRY_SCHEMA_VERSION,
      state,
      surfaces: Object.freeze(surfaces.map((surface) => freezeSurface(surface))),
    });
  const publish = (): void => {
    const snapshot = current();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        // Observability cannot interrupt or strand destructive lifecycle state.
      }
    }
  };
  const fail = (
    surface: UninstallFailure["surface"],
    phase: UninstallFailure["phase"],
    error: unknown,
  ): void => {
    failures.push(Object.freeze({ message: sanitizeError(error), phase, surface }));
  };

  return Object.freeze({
    snapshot: current,
    subscribe(listener: (snapshot: UninstallTelemetrySnapshot) => void) {
      listeners.add(listener);
      try {
        listener(current());
      } catch {
        // A broken observer remains isolated from uninstall authority and other observers.
      }
      return () => listeners.delete(listener);
    },
    async uninstall() {
      if (state === "running") throw new Error("Uninstall is already running");
      attempt += 1;
      state = "running";
      failures = [];
      surfaces = [];
      quota = emptyQuota();
      quiescence = emptyQuiescence();
      publish();

      try {
        await platform.withDeletionAuthority(async () => {
          const clientCount = await platform.exclusiveClientCount();
          quiescence = { ...quiescence, clientCount, exclusiveLocksHeld: true };
          if (clientCount !== 1) {
            throw new Error(
              `Uninstall requires exactly one controlled window client; observed ${clientCount}`,
            );
          }
          try {
            await prepare();
          } catch (error: unknown) {
            fail("runtime", "prepare", error);
            state = "failed";
            publish();
            return current();
          }

          try {
            const before = normalizeEstimate(await platform.estimate());
            quota = {
              ...quota,
              beforeQuota: before.quota,
              beforeUsage: before.usage,
              teardownKind: "unverified",
            };
            if (before.usage === null) {
              fail(
                "quota",
                "quota-before",
                new Error("Storage estimate omitted finite usage evidence"),
              );
            }
          } catch (error: unknown) {
            fail("quota", "quota-before", error);
          }

          surfaces.push(
            await teardownSurface(
              "service-workers",
              async () => {
                const registrations = await platform.serviceWorkers.registrations();
                const scopes = boundedNames(
                  registrations.map(({ scope }) => scope),
                  "service-workers",
                );
                const byScope = new Map(
                  registrations.map((registration) => [registration.scope, registration]),
                );
                return {
                  names: scopes,
                  remove: async (scope: string) => {
                    const registration = byScope.get(scope);
                    if (registration === undefined || !(await registration.unregister())) {
                      throw new Error(`Service worker did not unregister: ${scope}`);
                    }
                  },
                  remaining: async () =>
                    boundedNames(
                      (await platform.serviceWorkers.registrations()).map(({ scope }) => scope),
                      "service-workers",
                    ),
                };
              },
              fail,
              platform.taskTurn,
            ),
          );
          surfaces.push(
            await teardownSurface(
              "cache-storage",
              async () => ({
                names: boundedNames(await platform.cacheStorage.keys(), "cache-storage"),
                remove: async (name) => {
                  if (!(await platform.cacheStorage.delete(name))) {
                    throw new Error(`Cache Storage entry did not delete: ${name}`);
                  }
                },
                remaining: async () =>
                  boundedNames(await platform.cacheStorage.keys(), "cache-storage"),
              }),
              fail,
              platform.taskTurn,
            ),
          );
          surfaces.push(
            await teardownSurface(
              "indexed-db",
              async () => ({
                names: boundedNames(await platform.indexedDb.names(), "indexed-db"),
                remove: (name) => platform.indexedDb.delete(name),
                remaining: async () => boundedNames(await platform.indexedDb.names(), "indexed-db"),
              }),
              fail,
              platform.taskTurn,
            ),
          );
          surfaces.push(
            await teardownSurface(
              "opfs",
              async () => ({
                names: boundedNames(await platform.opfs.names(), "opfs"),
                remove: (name) => platform.opfs.remove(name),
                remaining: async () => boundedNames(await platform.opfs.names(), "opfs"),
              }),
              fail,
              platform.taskTurn,
            ),
          );

          quota = {
            ...quota,
            teardownKind: failures.some(
              ({ phase, surface }) =>
                phase === "before" && surface !== "quota" && surface !== "runtime",
            )
              ? "unverified"
              : surfaces.every(({ before }) => before.length === 0)
                ? "idempotent-empty"
                : "nonempty",
          };

          try {
            const after = normalizeEstimate(await platform.estimate());
            quota = {
              ...quota,
              afterQuota: after.quota,
              afterUsage: after.usage,
              releasedBytes:
                quota.beforeUsage === null || after.usage === null
                  ? null
                  : quota.beforeUsage - after.usage,
            };
          } catch (error: unknown) {
            fail("quota", "quota-after", error);
          }
          if (quota.afterUsage === null) {
            fail(
              "quota",
              "quota-after",
              new Error("Storage estimate omitted finite usage evidence"),
            );
          } else if (
            quota.beforeUsage !== null &&
            quota.teardownKind === "nonempty" &&
            (quota.releasedBytes === null || quota.releasedBytes <= 0)
          ) {
            fail(
              "quota",
              "quota-after",
              new Error("Storage usage did not report a positive release after nonempty teardown"),
            );
          }
          quiescence = { ...quiescence, stableInventoryPasses: 2 };
        });
      } catch (error: unknown) {
        fail("runtime", "quiescence", error);
      }
      state = failures.length === 0 ? "succeeded" : "failed";
      publish();
      return current();
    },
  });
}

async function teardownSurface(
  surface: UninstallSurface,
  open: () => Promise<
    Readonly<{
      names: readonly string[];
      remaining(): Promise<readonly string[]>;
      remove(name: string): Promise<void>;
    }>
  >,
  fail: (surface: UninstallSurface, phase: UninstallFailure["phase"], error: unknown) => void,
  taskTurn: () => Promise<void>,
): Promise<UninstallSurfaceObservation> {
  let names: readonly string[] = [];
  let remaining: readonly string[] = [];
  const attempted: string[] = [];
  const removed: string[] = [];
  let opened: Awaited<ReturnType<typeof open>> | null = null;
  try {
    opened = await open();
    names = opened.names;
  } catch (error: unknown) {
    fail(surface, "before", error);
  }
  if (opened !== null) {
    for (const name of names) {
      attempted.push(name);
      try {
        await opened.remove(name);
        removed.push(name);
      } catch (error: unknown) {
        fail(surface, "delete", error);
      }
    }
    try {
      const firstRemaining = await opened.remaining();
      await taskTurn();
      const secondRemaining = await opened.remaining();
      remaining = secondRemaining;
      if (
        firstRemaining.length !== secondRemaining.length ||
        firstRemaining.some((name, index) => name !== secondRemaining[index])
      ) {
        fail(surface, "after", new Error(`${surface} inventory changed between stable checks`));
      }
      if (secondRemaining.length !== 0) {
        fail(surface, "after", new Error(`${surface} retained ${secondRemaining.length} entries`));
      }
    } catch (error: unknown) {
      fail(surface, "after", error);
    }
  }
  return { after: remaining, attempted, before: names, removed, surface };
}

export function createBrowserUninstallPlatform(): UninstallPlatform {
  const root = (): Promise<FileSystemDirectoryHandle> => navigator.storage.getDirectory();
  return Object.freeze({
    cacheStorage: Object.freeze({
      delete: (name: string) => caches.delete(name),
      keys: () => caches.keys(),
    }),
    estimate: () => navigator.storage.estimate(),
    exclusiveClientCount: queryControlledWindowClientCount,
    indexedDb: Object.freeze({
      delete: (name: string) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.addEventListener("success", () => resolve(), { once: true });
          request.addEventListener(
            "error",
            () => reject(request.error ?? new Error("IndexedDB deletion failed")),
            { once: true },
          );
          request.addEventListener(
            "blocked",
            () => reject(new Error(`IndexedDB deletion was blocked: ${name}`)),
            { once: true },
          );
        }),
      names: async () => {
        const databases = await indexedDB.databases();
        return databases.map(({ name }) => {
          if (name === undefined || name === "")
            throw new Error("IndexedDB inventory contained an unnamed database");
          return name;
        });
      },
    }),
    opfs: Object.freeze({
      names: async () => {
        const names: string[] = [];
        for await (const name of (await root()).keys()) names.push(name);
        return names;
      },
      remove: async (name: string) => (await root()).removeEntry(name, { recursive: true }),
    }),
    serviceWorkers: Object.freeze({
      registrations: async () =>
        (await navigator.serviceWorker.getRegistrations()).map((registration) => ({
          scope: registration.scope,
          unregister: () => registration.unregister(),
        })),
    }),
    taskTurn: () => new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0)),
    withDeletionAuthority: withBrowserDeletionAuthority,
  });
}

export type UninstallLockRequest = <T>(name: string, operation: () => Promise<T>) => Promise<T>;

export function withUninstallDeletionAuthority<T>(
  request: UninstallLockRequest,
  operation: () => Promise<T>,
): Promise<T> {
  return request(INSTALL_STORE_LOCK_NAME, () =>
    request(OFFLINE_SHELL_PREPARE_LOCK_NAME, () => request(OFFLINE_SHELL_LOCK_NAME, operation)),
  );
}

function withBrowserDeletionAuthority<T>(operation: () => Promise<T>): Promise<T> {
  return withUninstallDeletionAuthority(
    (name, lockedOperation) =>
      navigator.locks.request(name, { mode: "exclusive" }, lockedOperation),
    operation,
  );
}

async function queryControlledWindowClientCount(): Promise<number> {
  const controller = navigator.serviceWorker.controller;
  if (controller === null) {
    throw new Error(
      "Uninstall cannot prove cross-tab quiescence without a controlling service worker",
    );
  }
  const channel = new MessageChannel();
  return new Promise<number>((resolve, reject) => {
    const timeout = globalThis.setTimeout(
      () => reject(new Error("Service-worker client inventory timed out")),
      2_000,
    );
    channel.port1.addEventListener(
      "message",
      (event: MessageEvent<unknown>) => {
        globalThis.clearTimeout(timeout);
        try {
          resolve(parseUninstallClientCountResponse(event.data));
        } catch {
          reject(new Error("Service-worker client inventory response is invalid"));
        }
      },
      { once: true },
    );
    channel.port1.start();
    controller.postMessage(
      {
        kind: "uninstall-client-count",
        protocolVersion: OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION,
      },
      [channel.port2],
    );
  });
}

export function parseUninstallClientCountResponse(value: unknown): number {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Service-worker client inventory response is invalid");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "clientCount,kind,protocolVersion" ||
    record.kind !== "uninstall-client-count" ||
    record.protocolVersion !== OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION ||
    !Number.isSafeInteger(record.clientCount) ||
    (record.clientCount as number) < 0
  ) {
    throw new Error("Service-worker client inventory response is invalid");
  }
  return record.clientCount as number;
}

function boundedNames(values: readonly string[], surface: UninstallSurface): readonly string[] {
  if (values.length > MAX_ENTRIES)
    throw new Error(`${surface} inventory exceeds ${MAX_ENTRIES} entries`);
  const names = values.map((value) => {
    if (value === "" || value.length > MAX_NAME_LENGTH)
      throw new Error(`${surface} inventory contains an invalid name`);
    return value;
  });
  if (new Set(names).size !== names.length)
    throw new Error(`${surface} inventory contains duplicates`);
  return Object.freeze([...names].sort());
}

function normalizeEstimate(
  value: Readonly<{ quota?: number; usage?: number }>,
): Readonly<{ quota: number | null; usage: number | null }> {
  const normalize = (candidate: number | undefined): number | null =>
    candidate === undefined || !Number.isFinite(candidate) || candidate < 0 ? null : candidate;
  return Object.freeze({ quota: normalize(value.quota), usage: normalize(value.usage) });
}

function emptyQuota(): UninstallTelemetrySnapshot["quota"] {
  return {
    afterQuota: null,
    afterUsage: null,
    beforeQuota: null,
    beforeUsage: null,
    releasedBytes: null,
    teardownKind: "unverified",
  };
}

function emptyQuiescence(): UninstallTelemetrySnapshot["quiescence"] {
  return { clientCount: null, exclusiveLocksHeld: false, stableInventoryPasses: 0 };
}

function freezeSurface(value: UninstallSurfaceObservation): UninstallSurfaceObservation {
  return Object.freeze({
    ...value,
    after: Object.freeze([...value.after]),
    attempted: Object.freeze([...value.attempted]),
    before: Object.freeze([...value.before]),
    removed: Object.freeze([...value.removed]),
  });
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (
    Array.from(message, (character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127 ? character : " ";
    })
      .join("")
      .trim()
      .slice(0, 500) || "Unknown uninstall failure"
  );
}
