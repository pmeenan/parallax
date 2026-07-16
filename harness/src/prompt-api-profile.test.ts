import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFreshPromptApiProfile,
  PROMPT_API_PROFILE_REMOVE_OPTIONS,
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
});
