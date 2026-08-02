import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createExactRangeResources } from "./exact-range-resources";

describe("exact-range install resources", () => {
  it("preserves exact resource identities without rewriting the release manifest", () => {
    const manifest = {
      gameId: "parallax",
      resources: [
        {
          bytes: 10,
          id: "app-shell",
          kind: "module",
          scope: "app-shell",
          sha256: "a".repeat(64),
          source: `immutable/app-${"a".repeat(64)}.js`,
          target: "shell",
        },
        {
          bytes: 20,
          id: "model-01",
          kind: "model",
          scope: "common",
          sha256: "b".repeat(64),
          source: `immutable/model-${"b".repeat(64)}.gguf`,
          target: "opfs",
        },
      ],
      schemaVersion: 1,
    } as const;
    const beforeBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
    const beforeDigest = createHash("sha256").update(beforeBytes).digest("hex");

    const transport = createExactRangeResources(manifest.resources);

    expect(transport).toEqual(
      manifest.resources.map(({ bytes, sha256, source }) => ({ bytes, sha256, source })),
    );
    const afterBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
    expect(afterBytes).toEqual(beforeBytes);
    expect(createHash("sha256").update(afterBytes).digest("hex")).toBe(beforeDigest);
  });

  it("rejects a source rewrite or remote source", () => {
    for (const source of [
      "https://example.invalid/model.gguf",
      "/model.gguf",
      "immutable/model.gguf?rewrite=1",
    ]) {
      expect(() =>
        createExactRangeResources([{ bytes: 1, sha256: "a".repeat(64), source }]),
      ).toThrow(/same-origin install source/);
    }
  });
});
