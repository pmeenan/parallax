import { access, mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFreshPromptApiProfile,
  PROMPT_API_PROFILE_REMOVE_OPTIONS,
  pruneStalePromptApiProfiles,
} from "./prompt-api-profile.js";

describe("Prompt API evidence profiles", () => {
  it("retries transient recursive-removal failures", () => {
    expect(PROMPT_API_PROFILE_REMOVE_OPTIONS).toEqual({
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 200,
    });
  });

  it("creates a distinct fresh profile for every execution and removes each one", async () => {
    const testRoot = await mkdtemp(join(tmpdir(), "parallax-prompt-profile-test-"));
    try {
      const first = await createFreshPromptApiProfile(testRoot);
      const second = await createFreshPromptApiProfile(testRoot);

      expect(first.root).not.toBe(second.root);
      expect(first.lineage).toMatchObject({ history: ["fresh"], profile: "fresh" });
      expect(second.lineage).toMatchObject({ history: ["fresh"], profile: "fresh" });

      await first.remove();
      await second.remove();
      await expect(access(first.root)).rejects.toThrow();
      await expect(access(second.root)).rejects.toThrow();
    } finally {
      await rm(testRoot, { force: true, recursive: true });
    }
  });

  it("prunes only stale run-profile children", async () => {
    const testRoot = await mkdtemp(join(tmpdir(), "parallax-prompt-profile-prune-test-"));
    try {
      const stale = join(testRoot, "run-stale");
      const recent = join(testRoot, "run-recent");
      const unrelated = join(testRoot, "keep-me");
      await Promise.all([
        mkdir(stale, { recursive: true }),
        mkdir(recent, { recursive: true }),
        mkdir(unrelated, { recursive: true }),
      ]);
      await utimes(stale, new Date(0), new Date(0));

      const removed = await pruneStalePromptApiProfiles(testRoot, {
        maxAgeMs: 1_000,
        now: () => 2_000,
      });

      expect(removed).toEqual(["run-stale"]);
      await expect(access(stale)).rejects.toThrow();
      await expect(access(recent)).resolves.toBeUndefined();
      await expect(access(unrelated)).resolves.toBeUndefined();
    } finally {
      await rm(testRoot, { force: true, recursive: true });
    }
  });
});
