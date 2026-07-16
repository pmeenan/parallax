import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
