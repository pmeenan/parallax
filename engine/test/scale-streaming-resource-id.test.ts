import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SCALE_STREAMING_DEPENDENCY_ROLES,
  scaleStreamingDependencyResourceId,
} from "../src/streaming/scale-streaming-resource-id.js";

describe("scale-streaming dependency resource identity", () => {
  const digest = "a".repeat(64);

  it("owns the exact role-to-ordinal mapping", () => {
    expect(SCALE_STREAMING_DEPENDENCY_ROLES).toEqual(["texture", "vertices", "indices"]);
    expect(scaleStreamingDependencyResourceId("texture", digest)).toBe(
      `game-specific-scale-streaming-00-texture-${digest}`,
    );
    expect(scaleStreamingDependencyResourceId("vertices", digest)).toBe(
      `game-specific-scale-streaming-01-vertices-${digest}`,
    );
    expect(scaleStreamingDependencyResourceId("indices", digest)).toBe(
      `game-specific-scale-streaming-02-indices-${digest}`,
    );
  });

  it.each([
    ["texture!", digest],
    ["texture", `${"a".repeat(63)}!`],
    ["texture", "A".repeat(64)],
    ["indices", `${digest}-suffix`],
  ])("rejects punctuated or noncanonical role/digest identity %s", (role, sha256) => {
    expect(() => scaleStreamingDependencyResourceId(role as "texture", sha256)).toThrow(
      /identity is invalid/u,
    );
  });

  it("keeps every scale-streaming producer and validator on the authoritative builder", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../..");
    const consumers = [
      "harness/scripts/generate-scale-streaming-corpus.mjs",
      "harness/scripts/build.mjs",
      "harness/src/build-manifest.ts",
      "engine/src/benchmark/benchmark-environment.ts",
      "harness/src/scale-streaming-corpus.ts",
    ];
    for (const consumer of consumers) {
      const source = await readFile(resolve(repositoryRoot, consumer), "utf8");
      expect(source, consumer).toContain("scaleStreamingDependencyResourceId");
      expect(source, consumer).not.toContain("game-specific-scale-streaming-");
    }
  });
});
