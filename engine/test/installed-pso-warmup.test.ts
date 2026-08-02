import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import {
  createEmbeddedPsoWarmupTrace,
  createPsoWarmupRegistry,
  type InstalledReleaseBinding,
  type InstallResource,
  loadInstalledPsoWarmupTrace,
  PSO_WARMUP_RESOURCE_ID,
  serializePsoWarmupTrace,
} from "../src/index";

describe("installed PSO warmup trace", () => {
  it("loads only the exact release-bound OPFS object", async () => {
    const embedded = createEmbeddedPsoWarmupTrace();
    const bytes = serializePsoWarmupTrace();
    const binding = fakeBinding(resource(embedded.sha256, bytes.byteLength));
    await expect(loadInstalledPsoWarmupTrace(binding, async () => bytes)).resolves.toEqual({
      ...embedded,
      releaseDigest: "b".repeat(64),
      source: "installed-release",
    });
  });

  it("carries missing, corrupt, and misplaced objects to typed render-worker failure", async () => {
    const embedded = createEmbeddedPsoWarmupTrace();
    const bytes = serializePsoWarmupTrace();
    const binding = fakeBinding(resource(embedded.sha256, bytes.byteLength));
    const missing = await loadInstalledPsoWarmupTrace(binding, async () => null);
    const corrupt = await loadInstalledPsoWarmupTrace(
      binding,
      async () => new Uint8Array(bytes.byteLength),
    );
    const misplacedResource = {
      ...resource(embedded.sha256, bytes.byteLength),
      target: "shell",
    } as const;
    const misplaced = await loadInstalledPsoWarmupTrace(
      fakeBinding(misplacedResource),
      async () => bytes,
    );
    for (const failed of [missing, corrupt, misplaced]) {
      expect(failed).toMatchObject({
        failure: { class: "incompatibility", phase: "trace-load" },
        source: "installed-release",
        trace: null,
      });
      expect(() => createPsoWarmupRegistry(failed)).toThrow(/incompatibility failure/);
    }
  });

  it("carries installed parse failure into the worker telemetry boundary", async () => {
    const malformed = new TextEncoder().encode("{invalid}\n");
    const digest = bytesToHex(sha256(malformed));
    const failed = await loadInstalledPsoWarmupTrace(
      fakeBinding(resource(digest, malformed.byteLength)),
      async () => malformed,
    );
    expect(failed).toMatchObject({
      failure: { class: "parse", phase: "trace-parse" },
      releaseDigest: "b".repeat(64),
      source: "installed-release",
      trace: null,
    });
    expect(() => createPsoWarmupRegistry(failed)).toThrow(/parse failure/);
  });
});

function resource(sha256: string, bytes: number): InstallResource {
  return Object.freeze({
    bytes,
    id: PSO_WARMUP_RESOURCE_ID,
    kind: "asset-pack",
    scope: "game-specific",
    sha256,
    source: `immutable/pso-warmup-trace-${sha256}.json`,
    target: "opfs",
  });
}

function fakeBinding(manifest: InstallResource): InstalledReleaseBinding {
  const releaseDigest = "b".repeat(64);
  return {
    getResource: async () => ({
      manifest,
      reference: {
        bytes: manifest.bytes,
        path: `objects/game/${manifest.sha256}`,
        releaseDigest,
        resourceId: manifest.id,
        scope: "game-specific",
        sha256: manifest.sha256,
      },
    }),
    getResources: async () => [],
    manifest: { gameId: "parallax", resources: [manifest], schemaVersion: 1 },
    releaseDigest,
    snapshot: () => ({
      failureMessage: null,
      networkFallbackCount: 0,
      referencedBytes: manifest.bytes,
      referencedResourceCount: 1,
      releaseDigest,
      schemaVersion: 1,
      state: "ready",
    }),
  };
}
