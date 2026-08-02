import { describe, expect, it } from "vitest";
import type { BuildManifest, ManifestWorkerEntrypoint } from "./build-manifest.js";
import { resolveHeapWorkerTargetUrls } from "./heap-worker-topology.js";

const workerEntrypoints = Object.freeze([
  worker("decode", "immutable/decode-worker-hash.js"),
  worker("installer", "immutable/installer-worker-hash.js"),
  worker("render", "immutable/render-worker-hash.js"),
  worker("streaming", "immutable/streaming-worker-hash.js"),
  worker("wasm-thread", "immutable/wasm-thread-worker-hash.js"),
]);

describe("all-realm JS heap worker topology", () => {
  it("resolves installer, render, streaming, and the exact decode multiplicity", () => {
    expect(resolve(workerEntrypoints, 3)).toEqual([
      "https://example.test/immutable/installer-worker-hash.js",
      "https://example.test/immutable/render-worker-hash.js",
      "https://example.test/immutable/streaming-worker-hash.js",
      "https://example.test/immutable/decode-worker-hash.js",
      "https://example.test/immutable/decode-worker-hash.js",
      "https://example.test/immutable/decode-worker-hash.js",
    ]);
  });

  it("accepts the exact build-manifest v13 five-role topology", () => {
    expect(resolve(workerEntrypoints, 1)).toHaveLength(4);
  });

  it("rejects a missing installer role", () => {
    expect(() =>
      resolve(
        workerEntrypoints.filter((entrypoint) => entrypoint.role !== "installer"),
        1,
      ),
    ).toThrow("Expected exactly 5 worker entrypoints; received 4");
  });

  it("rejects a duplicate installer role", () => {
    const duplicate = workerEntrypoints.map((entrypoint) =>
      entrypoint.role === "render"
        ? worker("installer", "immutable/other-installer-worker-hash.js")
        : entrypoint,
    );
    expect(() => resolve(duplicate, 1)).toThrow("Duplicate installer worker entrypoint");
  });

  it("rejects unexpected role drift", () => {
    const drifted = workerEntrypoints.map((entrypoint) =>
      entrypoint.role === "wasm-thread"
        ? ({
            ...entrypoint,
            role: "audio",
          } as unknown as ManifestWorkerEntrypoint)
        : entrypoint,
    );
    expect(() => resolve(drifted, 1)).toThrow('Unexpected worker topology entry "audio"/"worker"');
  });

  it.each([
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid decode multiplicity %s", (decodeWorkerCount) => {
    expect(() => resolve(workerEntrypoints, decodeWorkerCount)).toThrow(
      "Decode worker count must be a positive safe integer",
    );
  });
});

function resolve(
  entrypoints: readonly ManifestWorkerEntrypoint[],
  decodeWorkerCount: number,
): readonly string[] {
  return resolveHeapWorkerTargetUrls({
    baseUrl: "https://example.test/app/ignored",
    decodeWorkerCount,
    manifest: { workerEntrypoints: entrypoints } as BuildManifest,
  });
}

function worker(role: ManifestWorkerEntrypoint["role"], path: string): ManifestWorkerEntrypoint {
  return Object.freeze({ path, role, targetType: "worker" });
}
