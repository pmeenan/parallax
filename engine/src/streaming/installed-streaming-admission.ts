export interface InstalledStreamingAdmissionInput {
  readonly admit: () => Promise<void>;
  readonly closeHandles: () => readonly unknown[];
  readonly openHandles: () => Promise<void>;
}

export async function openAndAdmitInstalledStreamingRelease(
  input: InstalledStreamingAdmissionInput,
): Promise<void> {
  try {
    await input.openHandles();
    await input.admit();
  } catch (error: unknown) {
    const closeFailures = input.closeHandles();
    const message = error instanceof Error && error.message !== "" ? error.message : String(error);
    if (closeFailures.length === 0) throw error;
    throw new Error(
      `${message}; OPFS access-handle cleanup failed: ${closeFailures
        .map((failure) =>
          failure instanceof Error && failure.message !== "" ? failure.message : String(failure),
        )
        .join("; ")}`,
      error instanceof Error ? { cause: error } : undefined,
    );
  }
}
