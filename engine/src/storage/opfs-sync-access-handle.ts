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
