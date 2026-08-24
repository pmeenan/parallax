import { describe, expect, it, vi } from "vitest";
import {
  createOpfsSyncAccessHandleCache,
  type OpfsSyncAccessHandle,
} from "../src/storage/opfs-sync-access-handle";

function handle(size: number): Readonly<{
  access: OpfsSyncAccessHandle;
  close: ReturnType<typeof vi.fn>;
}> {
  const close = vi.fn();
  return {
    access: {
      close,
      flush: vi.fn(),
      getSize: () => size,
      read: vi.fn(),
      truncate: vi.fn(),
      write: vi.fn(),
    },
    close,
  };
}

describe("OPFS sync access-handle cache", () => {
  it("retains validated handles for synchronous reuse and closes the complete set", async () => {
    const first = handle(4_096);
    const second = handle(8_192);
    const cache = createOpfsSyncAccessHandleCache();

    await cache.open("first", 4_096, async () => first.access);
    await cache.open("second", 8_192, async () => second.access);

    expect(cache.size).toBe(2);
    expect(cache.require("first")).toBe(first.access);
    expect(cache.require("second")).toBe(second.access);

    cache.closeAll();
    expect(cache.size).toBe(0);
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
    expect(() => cache.require("first")).toThrow(/unavailable/);
  });

  it("closes a size-mismatched handle without retaining it", async () => {
    const wrong = handle(4_095);
    const cache = createOpfsSyncAccessHandleCache();

    await expect(cache.open("wrong", 4_096, async () => wrong.access)).rejects.toThrow(
      /has 4095 bytes; expected 4096/,
    );
    expect(wrong.close).toHaveBeenCalledOnce();
    expect(cache.size).toBe(0);
  });

  it("rejects duplicate keys without opening a second handle", async () => {
    const first = handle(4_096);
    const duplicate = vi.fn(async () => handle(4_096).access);
    const cache = createOpfsSyncAccessHandleCache();
    await cache.open("cell", 4_096, async () => first.access);

    await expect(cache.open("cell", 4_096, duplicate)).rejects.toThrow(/already open/);
    expect(duplicate).not.toHaveBeenCalled();
  });

  it("closes source-only handles while retaining destination-shared handles", async () => {
    const sourceOnly = handle(4_096);
    const shared = handle(8_192);
    const cache = createOpfsSyncAccessHandleCache();
    await cache.open("source", 4_096, async () => sourceOnly.access);
    await cache.open("shared", 8_192, async () => shared.access);

    expect(cache.has("source")).toBe(true);
    expect(cache.closeExcept(new Set(["shared"]))).toEqual([]);
    expect(sourceOnly.close).toHaveBeenCalledOnce();
    expect(shared.close).not.toHaveBeenCalled();
    expect(cache.size).toBe(1);
    expect(cache.require("shared")).toBe(shared.access);
  });

  it("attempts every close and clears the cache when a handle close fails", async () => {
    const first = handle(4_096);
    const second = handle(8_192);
    first.close.mockImplementationOnce(() => {
      throw new Error("close failed");
    });
    const cache = createOpfsSyncAccessHandleCache();
    await cache.open("first", 4_096, async () => first.access);
    await cache.open("second", 8_192, async () => second.access);

    const failures = cache.closeAll();

    expect(failures).toHaveLength(1);
    expect(failures[0]).toEqual(new Error("close failed"));
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
    expect(cache.size).toBe(0);
  });

  it("attempts cleanup when size validation throws", async () => {
    const broken = handle(4_096);
    broken.access.getSize = () => {
      throw new Error("size failed");
    };
    const cache = createOpfsSyncAccessHandleCache();

    await expect(cache.open("broken", 4_096, async () => broken.access)).rejects.toThrow(
      /size failed/,
    );
    expect(broken.close).toHaveBeenCalledOnce();
    expect(cache.size).toBe(0);
  });
});
