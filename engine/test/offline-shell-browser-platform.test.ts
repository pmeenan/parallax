import { describe, expect, it, vi } from "vitest";
import {
  collectOfflineShellGenerationCaches,
  createBrowserOfflineShellStorePlatform,
  openOfflineShellDatabase,
  withClosedDatabase,
} from "../src/offline-shell/shell-generation-browser-platform";

const GENERATION_ID = `${"a".repeat(64)}:${"b".repeat(64)}`;

describe("offline-shell browser database lifetime", () => {
  it("closes the database after successful work", async () => {
    const close = vi.fn();
    const database = { close } as unknown as IDBDatabase;

    await expect(
      withClosedDatabase(
        async () => database,
        async () => "done",
      ),
    ).resolves.toBe("done");
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes the database after failed work", async () => {
    const close = vi.fn();
    const database = { close } as unknown as IDBDatabase;

    await expect(
      withClosedDatabase(
        async () => database,
        async () => {
          throw new Error("bounded failure");
        },
      ),
    ).rejects.toThrow("bounded failure");
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes an opened connection when deletion or upgrade requests a version change", async () => {
    const close = vi.fn();
    const database = { close, onversionchange: null } as unknown as IDBDatabase;
    const request = {} as IDBOpenDBRequest;
    Object.defineProperty(request, "result", { value: database });
    const indexedDb = {
      open() {
        queueMicrotask(() => request.onsuccess?.(new Event("success")));
        return request;
      },
    } as unknown as IDBFactory;

    await expect(openOfflineShellDatabase(indexedDb)).resolves.toBe(database);
    expect(database.onversionchange).toBeTypeOf("function");
    database.onversionchange?.(new Event("versionchange") as IDBVersionChangeEvent);
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("offline-shell browser cache collection", () => {
  it("deletes only unreferenced generation caches and preserves unrelated caches", async () => {
    const retained = `${"a".repeat(64)}:${"b".repeat(64)}`;
    const orphan = `${"c".repeat(64)}:${"d".repeat(64)}`;
    const retainedName = `parallax-offline-shell-v1-${retained.replace(":", "-")}`;
    const orphanName = `parallax-offline-shell-v1-${orphan.replace(":", "-")}`;
    const deleted: string[] = [];
    const cacheStorage = {
      async delete(name: string) {
        deleted.push(name);
        return true;
      },
      keys: async () => [retainedName, orphanName, "unrelated-cache"],
    } as unknown as CacheStorage;

    await collectOfflineShellGenerationCaches(cacheStorage, new Set([retained]));
    expect(deleted).toEqual([orphanName]);
  });

  it("reports a failed orphan deletion so a later prepare can retry it", async () => {
    const orphanName = `parallax-offline-shell-v1-${"e".repeat(128)}`;
    const cacheStorage = {
      delete: async () => false,
      keys: async () => [orphanName],
    } as unknown as CacheStorage;

    await expect(collectOfflineShellGenerationCaches(cacheStorage, new Set())).rejects.toThrow(
      /deletion failed/,
    );
  });
});

describe("offline-shell browser cache reads", () => {
  it("uses a named read-only match and does not open a missing generation cache", async () => {
    const open = vi.fn();
    const match = vi.fn(async () => undefined);
    const cacheStorage = { match, open } as unknown as CacheStorage;
    const platform = createBrowserOfflineShellStorePlatform({
      cacheStorage,
      indexedDb: {} as IDBFactory,
      lockManager: {} as LockManager,
      origin: "https://parallax.test",
    });

    await expect(platform.match(GENERATION_ID, "index.html")).resolves.toBeNull();
    expect(match).toHaveBeenCalledWith("https://parallax.test/index.html", {
      cacheName: `parallax-offline-shell-v1-${GENERATION_ID.replace(":", "-")}`,
    });
    expect(open).not.toHaveBeenCalled();
  });
});
