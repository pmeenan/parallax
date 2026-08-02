import { describe, expect, it, vi } from "vitest";
import {
  durablyAppendSyncAccessHandle,
  INSTALL_STORE_LOCK_ACQUISITION_TIMEOUT_MS,
  type InstallStoreLockPlatform,
  runWithBrowserInstallStoreLock,
} from "../src/storage/opfs-release-store-browser";
import {
  INSTALL_STORE_LOCK_NAME,
  InstallStoreLockTimeoutError,
} from "../src/storage/opfs-release-store-contract";
import type { OpfsSyncAccessHandle } from "../src/storage/opfs-sync-access-handle";

describe("browser install-store durable append", () => {
  it("flushes the same sync access handle after its write", () => {
    const operations: string[] = [];
    const access: OpfsSyncAccessHandle = {
      close: () => operations.push("close"),
      flush: () => operations.push("flush"),
      getSize: () => {
        operations.push("size");
        return 8;
      },
      read: () => 0,
      truncate: () => undefined,
      write: (bytes, options) => {
        operations.push(`write:${options.at}`);
        return bytes.byteLength;
      },
    };

    expect(durablyAppendSyncAccessHandle(access, 8, Uint8Array.of(1, 2, 3))).toBe(3);
    expect(operations).toEqual(["size", "write:8", "flush"]);
  });

  it("does not write or flush after an offset mismatch", () => {
    const access: OpfsSyncAccessHandle = {
      close: vi.fn(),
      flush: vi.fn(),
      getSize: () => 7,
      read: () => 0,
      truncate: vi.fn(),
      write: vi.fn(() => 0),
    };

    expect(() => durablyAppendSyncAccessHandle(access, 8, Uint8Array.of(1))).toThrow(
      "Append offset mismatch",
    );
    expect(access.write).not.toHaveBeenCalled();
    expect(access.flush).not.toHaveBeenCalled();
  });
});

describe("browser install-store lock", () => {
  it("aborts a queued exclusive acquisition at its typed deadline", async () => {
    let fireDeadline!: () => void;
    let requestedSignal: AbortSignal | undefined;
    const operation = vi.fn(async () => "unreachable");
    const clearTimeout = vi.fn();
    const platform: InstallStoreLockPlatform = {
      clearTimeout,
      request: (name, options) => {
        expect(name).toBe(INSTALL_STORE_LOCK_NAME);
        expect(options.mode).toBe("exclusive");
        requestedSignal = options.signal;
        return new Promise<never>((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(options.signal.reason), {
            once: true,
          });
        });
      },
      setTimeout(callback, milliseconds) {
        expect(milliseconds).toBe(INSTALL_STORE_LOCK_ACQUISITION_TIMEOUT_MS);
        fireDeadline = callback;
        return 17;
      },
    };
    const result = runWithBrowserInstallStoreLock(operation, platform);
    await Promise.resolve();

    fireDeadline();

    await expect(result).rejects.toBeInstanceOf(InstallStoreLockTimeoutError);
    expect(requestedSignal?.aborted).toBe(true);
    expect(requestedSignal?.reason).toBeInstanceOf(InstallStoreLockTimeoutError);
    expect(operation).not.toHaveBeenCalled();
    expect(clearTimeout).toHaveBeenCalledWith(17);
  });

  it("clears the acquisition deadline on grant without bounding operation duration", async () => {
    let fireDeadline!: () => void;
    let finish!: (value: string) => void;
    const platform: InstallStoreLockPlatform = {
      clearTimeout: vi.fn(),
      request: (_name, _options, operation) => operation(),
      setTimeout(callback) {
        fireDeadline = callback;
        return 23;
      },
    };
    const result = runWithBrowserInstallStoreLock(
      () => new Promise<string>((resolve) => (finish = resolve)),
      platform,
    );
    await Promise.resolve();
    await Promise.resolve();

    fireDeadline();
    finish("complete");

    await expect(result).resolves.toBe("complete");
    expect(platform.clearTimeout).toHaveBeenCalledWith(23);
  });
});
