import { access, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { listFilesRecursively } from "./build-manifest.js";
import { errorMessage } from "./value-utils.js";

export interface PromptApiModelComponentValue {
  readonly bytes: number;
  readonly files: number;
  readonly versions: readonly string[];
}

export type PromptApiEvidence<T> =
  | Readonly<{ readonly state: "measured"; readonly value: T }>
  | Readonly<{
      readonly reason: string;
      readonly state: "invalid" | "unsupported";
    }>;

export type PromptApiModelComponentMetric = PromptApiEvidence<PromptApiModelComponentValue>;

export async function measurePromptApiModelComponent(
  profileRoot: string,
): Promise<PromptApiModelComponentMetric> {
  const root = join(profileRoot, "OptGuideOnDeviceModel");
  try {
    await access(root);
  } catch {
    return Object.freeze({
      reason: "No OptGuideOnDeviceModel component exists in the dedicated browser data root",
      state: "unsupported",
    });
  }
  try {
    const paths = (await listFilesRecursively(root)).map((path) => join(root, path));
    const sizes = await Promise.all(paths.map(async (path) => (await stat(path)).size));
    const entries = await readdir(root, { withFileTypes: true });
    return Object.freeze({
      state: "measured",
      value: Object.freeze({
        bytes: sizes.reduce((sum, size) => sum + size, 0),
        files: paths.length,
        versions: Object.freeze(
          entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort(),
        ),
      }),
    });
  } catch (error: unknown) {
    return Object.freeze({
      reason: `Model-component inspection failed after browser shutdown: ${errorMessage(error)}`,
      state: "invalid",
    });
  }
}
