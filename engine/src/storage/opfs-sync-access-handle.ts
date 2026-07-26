// TypeScript's ES2024 DOM library does not yet declare the worker-only OPFS sync
// access-handle surface. Keep the local declaration minimal and structurally cast at
// the platform boundary so the missing library type cannot spread through the engine.
export interface OpfsSyncAccessHandle {
  close(): void;
  flush(): void;
  getSize(): number;
  read(buffer: Uint8Array, options: Readonly<{ at: number }>): number;
  truncate(newSize: number): void;
  write(buffer: Uint8Array, options: Readonly<{ at: number }>): number;
}

export interface OpfsSyncAccessHandleCache {
  readonly size: number;
  closeAll(): readonly unknown[];
  open(
    key: string,
    expectedBytes: number,
    create: () => Promise<OpfsSyncAccessHandle>,
  ): Promise<void>;
  require(key: string): OpfsSyncAccessHandle;
}

export function createOpfsSyncAccessHandleCache(): OpfsSyncAccessHandleCache {
  const handles = new Map<string, OpfsSyncAccessHandle>();
  return Object.freeze({
    get size(): number {
      return handles.size;
    },
    closeAll(): readonly unknown[] {
      const failures: unknown[] = [];
      for (const handle of handles.values()) {
        try {
          handle.close();
        } catch (error: unknown) {
          failures.push(error);
        }
      }
      handles.clear();
      return Object.freeze(failures);
    },
    async open(
      key: string,
      expectedBytes: number,
      create: () => Promise<OpfsSyncAccessHandle>,
    ): Promise<void> {
      if (handles.has(key)) throw new Error(`OPFS access handle ${key} is already open`);
      const handle = await create();
      let size: number;
      try {
        size = handle.getSize();
      } catch (error: unknown) {
        try {
          handle.close();
        } catch (closeError: unknown) {
          throw new AggregateError(
            [error, closeError],
            `OPFS access handle ${key} size validation and cleanup failed`,
          );
        }
        throw error;
      }
      if (size !== expectedBytes) {
        const mismatch = new Error(
          `OPFS access handle ${key} has ${size} bytes; expected ${expectedBytes}`,
        );
        try {
          handle.close();
        } catch (closeError: unknown) {
          throw new AggregateError(
            [mismatch, closeError],
            `OPFS access handle ${key} size validation and cleanup failed`,
          );
        }
        throw mismatch;
      }
      handles.set(key, handle);
    },
    require(key: string): OpfsSyncAccessHandle {
      const handle = handles.get(key);
      if (handle === undefined) throw new Error(`OPFS access handle ${key} is unavailable`);
      return handle;
    },
  });
}
