export interface StreamingWarmupArrivalGate<T> {
  activate(consumer: (message: T) => void): void;
  arrivedDuringWarmup(message: T): boolean;
  receive(message: T): void;
}

export function createStreamingWarmupArrivalGate<T>(): StreamingWarmupArrivalGate<T> {
  const buffered: T[] = [];
  const warmupArrivals = new Set<T>();
  let activeConsumer: ((message: T) => void) | null = null;
  return Object.freeze({
    activate(consumer: (message: T) => void): void {
      if (activeConsumer !== null)
        throw new Error("Streaming warmup arrival gate is already active");
      activeConsumer = consumer;
      for (const message of buffered.splice(0)) {
        consumer(message);
        warmupArrivals.delete(message);
      }
    },
    arrivedDuringWarmup: (message: T): boolean => warmupArrivals.has(message),
    receive(message: T): void {
      if (activeConsumer === null) {
        warmupArrivals.add(message);
        buffered.push(message);
        return;
      }
      activeConsumer(message);
    },
  });
}
