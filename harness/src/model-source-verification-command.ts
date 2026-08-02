import { sanitizeModelSourceFailureText } from "./model-source-failure-sanitization.js";

export async function runModelSourceVerificationCommand(
  operation: () => Promise<void>,
  stderr: Pick<NodeJS.WriteStream, "write"> = process.stderr,
): Promise<void> {
  try {
    await operation();
  } catch (error: unknown) {
    stderr.write(`Model-source verification failed: ${sanitizeModelSourceFailure(error)}\n`);
    process.exitCode = 1;
  }
}

export function sanitizeModelSourceFailure(error: unknown): string {
  return sanitizeModelSourceFailureText(error);
}
