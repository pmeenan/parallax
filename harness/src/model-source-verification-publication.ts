import { readFile, rename, rm, writeFile } from "node:fs/promises";
import {
  type ModelSourceVerificationResult,
  validateModelSourceVerificationResult,
} from "./model-source-verification-result.js";

export async function publishModelSourceVerificationResult(
  input: Readonly<{
    jsonPath: string;
    jsonTemporaryPath: string;
    markdown: string;
    markdownPath: string;
    markdownTemporaryPath: string;
    report: ModelSourceVerificationResult;
  }>,
): Promise<void> {
  await replaceJson(input.jsonTemporaryPath, input.jsonPath, input.report);
  await validatePersistedModelSourceVerificationResult(input.jsonPath, input.report.state);
  await replaceText(input.markdownTemporaryPath, input.markdownPath, input.markdown);
}

export async function validatePersistedModelSourceVerificationResult(
  path: string,
  expectedState: ModelSourceVerificationResult["state"],
): Promise<void> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  validateModelSourceVerificationResult(parsed);
  if (parsed.state !== expectedState) {
    throw new Error(
      `Persisted model-source result state is ${parsed.state}, expected ${expectedState}`,
    );
  }
}

async function replaceJson(temporaryPath: string, destinationPath: string, value: unknown) {
  await rm(temporaryPath, { force: true });
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  await rename(temporaryPath, destinationPath);
}

async function replaceText(temporaryPath: string, destinationPath: string, value: string) {
  await rm(temporaryPath, { force: true });
  await writeFile(temporaryPath, value, { flag: "wx" });
  await rename(temporaryPath, destinationPath);
}
