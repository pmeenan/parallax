import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { PROMPT_API_SPIKE_PROFILE_LINEAGE_SCHEMA_VERSION } from "./runs/prompt-api-spike.js";

export interface PromptApiProfileLineage {
  readonly history: readonly ["fresh"];
  readonly id: string;
  readonly profile: "fresh";
  readonly schemaVersion: typeof PROMPT_API_SPIKE_PROFILE_LINEAGE_SCHEMA_VERSION;
}

export interface FreshPromptApiProfile {
  readonly lineage: PromptApiProfileLineage;
  remove(): Promise<void>;
  readonly root: string;
}

export const PROMPT_API_PROFILE_REMOVE_OPTIONS = Object.freeze({
  force: true,
  maxRetries: 5,
  recursive: true,
  retryDelay: 200,
});

export const PROMPT_API_STALE_PROFILE_AGE_MS = 24 * 60 * 60 * 1_000;

export async function createFreshPromptApiProfile(parent: string): Promise<FreshPromptApiProfile> {
  const resolvedParent = resolve(parent);
  await mkdir(resolvedParent, { recursive: true });
  const root = await mkdtemp(join(resolvedParent, "run-"));
  const lineage = Object.freeze({
    history: Object.freeze(["fresh"] as const),
    id: basename(root),
    profile: "fresh" as const,
    schemaVersion: PROMPT_API_SPIKE_PROFILE_LINEAGE_SCHEMA_VERSION,
  });
  return Object.freeze({
    lineage,
    async remove(): Promise<void> {
      assertChildPath(resolvedParent, root);
      await rm(root, PROMPT_API_PROFILE_REMOVE_OPTIONS);
    },
    root,
  });
}

export async function pruneStalePromptApiProfiles(
  parent: string,
  options: Readonly<{
    maxAgeMs?: number;
    now?: () => number;
    warn?: (message: string) => void;
  }> = {},
): Promise<readonly string[]> {
  const resolvedParent = resolve(parent);
  const maxAgeMs = options.maxAgeMs ?? PROMPT_API_STALE_PROFILE_AGE_MS;
  const now = options.now ?? Date.now;
  const warn = options.warn ?? console.warn;
  await mkdir(resolvedParent, { recursive: true });
  const removed: string[] = [];
  for (const entry of await readdir(resolvedParent, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("run-")) continue;
    const candidate = join(resolvedParent, entry.name);
    assertChildPath(resolvedParent, candidate);
    try {
      const identity = await stat(candidate);
      if (now() - identity.mtimeMs < maxAgeMs) continue;
      await rm(candidate, PROMPT_API_PROFILE_REMOVE_OPTIONS);
      removed.push(entry.name);
    } catch (error: unknown) {
      warn(`Prompt API stale-profile cleanup failed for ${candidate}: ${String(error)}`);
    }
  }
  return Object.freeze(removed);
}

function assertChildPath(parent: string, child: string): void {
  const relation = relative(parent, child);
  if (
    relation === "" ||
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new Error(`Refusing to remove Prompt API profile outside ${parent}: ${child}`);
  }
}
