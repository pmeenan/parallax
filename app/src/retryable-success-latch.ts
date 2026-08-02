export interface RetryableSuccessLatch {
  run(operation: () => Promise<void>): Promise<void>;
}

export function createRetryableSuccessLatch(alreadyStartedMessage: string): RetryableSuccessLatch {
  let state: "idle" | "running" | "succeeded" = "idle";
  return Object.freeze({
    async run(operation: () => Promise<void>): Promise<void> {
      if (state !== "idle") throw new Error(alreadyStartedMessage);
      state = "running";
      try {
        await operation();
        state = "succeeded";
      } catch (error: unknown) {
        state = "idle";
        throw error;
      }
    },
  });
}
