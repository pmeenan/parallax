import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectedInstallResource, readBuildIdentity } from "../src/benchmark/benchmark-environment";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const buildManifestBytes = readFileSync(resolve(repositoryRoot, "dist/build-manifest.json"));
const installManifestBytes = readFileSync(resolve(repositoryRoot, "dist/install-manifest.json"));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("page benchmark build identity", () => {
  it("measures the exact current build and release identities", async () => {
    installManifestFetches(buildManifestBytes, installManifestBytes);

    await expect(readBuildIdentity()).resolves.toEqual({
      artifactDigest: {
        state: "measured",
        value: createHash("sha256").update(buildManifestBytes).digest("hex"),
      },
      releaseDigest: {
        state: "measured",
        value: createHash("sha256").update(installManifestBytes).digest("hex"),
      },
    });
  });

  it("classifies every exact asset-pack family emitted by the build", () => {
    const sha256 = "a".repeat(64);
    const cases = [
      {
        id: "game-specific-pso-warmup-trace",
        path: `immutable/pso-warmup-trace-${sha256}.json`,
      },
      {
        id: "game-specific-streaming-00-texture",
        path: `immutable/representative-streaming-ktx2-${sha256}.ktx2`,
      },
      {
        id: "game-specific-streaming-01-mesh",
        path: `immutable/representative-streaming-meshopt-${sha256}.meshopt`,
      },
      {
        id: `game-specific-scale-streaming-00-texture-${sha256}`,
        path: `immutable/streaming-texture-${sha256}.ktx2`,
      },
      {
        id: `game-specific-scale-streaming-01-vertices-${sha256}`,
        path: `immutable/streaming-vertices-${sha256}.meshopt`,
      },
      {
        id: `game-specific-scale-streaming-02-indices-${sha256}`,
        path: `immutable/streaming-indices-${sha256}.meshopt`,
      },
    ] as const;

    for (const candidate of cases) {
      expect(expectedInstallResource({ bytes: 1, path: candidate.path, sha256 }, [], [])).toEqual({
        bytes: 1,
        id: candidate.id,
        kind: "asset-pack",
        scope: "game-specific",
        sha256,
        source: candidate.path,
        target: "opfs",
      });
    }
  });

  it("keeps genuinely unknown build artifacts fail closed", async () => {
    const parsed = JSON.parse(buildManifestBytes.toString("utf8")) as {
      artifacts: unknown[];
    };
    const unknownBuild = Buffer.from(
      `${JSON.stringify({
        ...parsed,
        artifacts: [
          ...parsed.artifacts,
          {
            bytes: 1,
            path: `immutable/unknown-${"f".repeat(64)}.bin`,
            sha256: "f".repeat(64),
          },
        ],
      })}\n`,
    );
    installManifestFetches(unknownBuild, installManifestBytes);

    const identity = await readBuildIdentity();
    expect(identity.artifactDigest).toMatchObject({
      reason: expect.stringMatching(/no exact install classification/),
      state: "invalid",
    });
    expect(identity.releaseDigest).toEqual(identity.artifactDigest);
  });
});

function installManifestFetches(buildBytes: Uint8Array, installBytes: Uint8Array): void {
  vi.stubGlobal("location", { href: "https://parallax.test/benchmark" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
      if (path === "/build-manifest.json")
        return new Response(responseBody(buildBytes), { status: 200 });
      if (path === "/install-manifest.json")
        return new Response(responseBody(installBytes), { status: 200 });
      return new Response(null, { status: 404 });
    }),
  );
}

function responseBody(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
