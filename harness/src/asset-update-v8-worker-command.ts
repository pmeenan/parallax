export async function waitForAssetUpdateV8WorkerCommand(input: {
  readonly completion: Promise<void>;
  readonly fail: (error: unknown) => void;
  readonly label: string;
  readonly removeWaiter: () => void;
  readonly timeoutMs: number;
}): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      input.completion,
      new Promise<never>((_resolvePromise, rejectPromise) => {
        timeout = setTimeout(
          () => rejectPromise(new Error(`${input.label} timed out`)),
          input.timeoutMs,
        );
      }),
    ]);
  } catch (error: unknown) {
    input.fail(error);
    throw error;
  } finally {
    if (timeout !== null) clearTimeout(timeout);
    input.removeWaiter();
  }
}
