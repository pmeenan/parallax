export interface DestructiveLifecycleGate {
  isLocked(): boolean;
  lock(): void;
  subscribe(listener: (locked: boolean) => void): () => void;
}

export function createDestructiveLifecycleGate(): DestructiveLifecycleGate {
  let locked = false;
  const listeners = new Set<(locked: boolean) => void>();
  return Object.freeze({
    isLocked: () => locked,
    lock: () => {
      if (locked) return;
      locked = true;
      for (const listener of listeners) listener(true);
    },
    subscribe: (listener: (locked: boolean) => void) => {
      listeners.add(listener);
      listener(locked);
      return () => listeners.delete(listener);
    },
  });
}
