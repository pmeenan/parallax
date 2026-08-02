import { createHash } from "node:crypto";
import { parseInstallManifestDocument } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import {
  createScaleLifecycleCorpus,
  SCALE_LIFECYCLE_CONTRACT,
  SCALE_LIFECYCLE_FLOOR_BYTES,
  SCALE_LIFECYCLE_RESOURCE_COUNT,
  type ScaleReleaseCorpus,
} from "./scale-lifecycle-corpus.js";

describe(SCALE_LIFECYCLE_CONTRACT, () => {
  it("models distinct initial, one-resource update, and source-rotation releases", () => {
    const corpus = createScaleLifecycleCorpus({
      baseResourceBytes: 31,
      lifecycleFloorBytes: 130,
      resourceCount: 4,
    });
    expect(corpus.initial.bytes).toBe(130);
    expect(corpus.update.bytes).toBe(131);
    expect(corpus.cleanupRotation.bytes).toBe(corpus.update.bytes);
    expect(corpus.sourceMaterializedBytes).toBe(0);
    expect(new Set(corpus.initial.manifest.resources.map(({ sha256 }) => sha256)).size).toBe(4);
    expect(corpus.update.releaseDigest).not.toBe(corpus.initial.releaseDigest);
    expect(corpus.cleanupRotation.releaseDigest).not.toBe(corpus.update.releaseDigest);
    expect(
      corpus.update.manifest.resources.filter(
        (resource, index) => resource.sha256 !== corpus.initial.manifest.resources[index]?.sha256,
      ),
    ).toHaveLength(1);
    expect(
      corpus.cleanupRotation.manifest.resources.filter(
        (resource, index) => resource.source !== corpus.update.manifest.resources[index]?.source,
      ),
    ).toHaveLength(1);
    expect(
      corpus.cleanupRotation.manifest.resources.map(({ bytes, id, sha256 }) => ({
        bytes,
        id,
        sha256,
      })),
    ).toEqual(
      corpus.update.manifest.resources.map(({ bytes, id, sha256 }) => ({ bytes, id, sha256 })),
    );
    for (const release of [corpus.initial, corpus.update, corpus.cleanupRotation]) {
      expectExactReleaseAccounting(release);
    }
  });

  it("models at least 100 GiB without materializing resource bodies", () => {
    const corpus = createScaleLifecycleCorpus();
    expect(corpus.lifecycleFloorBytes).toBe(SCALE_LIFECYCLE_FLOOR_BYTES);
    for (const release of [corpus.initial, corpus.update, corpus.cleanupRotation]) {
      expect(release.bytes).toBeGreaterThanOrEqual(SCALE_LIFECYCLE_FLOOR_BYTES);
    }
    expect(corpus.initial.resourceCount).toBe(SCALE_LIFECYCLE_RESOURCE_COUNT);
    expect(corpus.sourceMaterializedBytes).toBe(0);
    expect(corpus.update.bytes).toBe(corpus.initial.bytes + 1);
    expect(corpus.cleanupRotation.bytes).toBe(corpus.update.bytes);
    expect(corpus.updateChangedResourceId).toBe("scale-asset-00399");
    for (const release of [corpus.initial, corpus.update, corpus.cleanupRotation]) {
      expectExactReleaseAccounting(release);
    }
  });

  it("fails closed through the production parser on forged identity and accounting", () => {
    const corpus = createScaleLifecycleCorpus({
      baseResourceBytes: 31,
      lifecycleFloorBytes: 63,
      resourceCount: 2,
    });
    const duplicateHash = decodeMutableManifest(corpus.initial.manifestBytes);
    mutableResource(duplicateHash, 1).sha256 = mutableResource(duplicateHash, 0).sha256;
    expect(() => parseInstallManifestDocument(duplicateHash)).toThrow(
      /Duplicate install resource sha256/u,
    );

    const forgedSummary = {
      ...decodeMutableManifest(corpus.initial.manifestBytes),
      resourceBytes: corpus.initial.bytes + 1,
    };
    expect(() => parseInstallManifestDocument(forgedSummary)).toThrow(
      /requires exact gameId, resources, and schemaVersion keys/u,
    );

    const unsafeAggregate = decodeMutableManifest(corpus.initial.manifestBytes);
    mutableResource(unsafeAggregate, 0).bytes = Number.MAX_SAFE_INTEGER;
    expect(() => parseInstallManifestDocument(unsafeAggregate)).toThrow(
      /Install manifest byte aggregate is unsafe/u,
    );
  });
});

function expectExactReleaseAccounting(release: ScaleReleaseCorpus): void {
  const parsed = parseInstallManifestDocument(
    JSON.parse(new TextDecoder().decode(release.manifestBytes)),
  );
  expect(release.manifest).toEqual(parsed.manifest);
  expect(release.summary).toEqual(parsed.summary);
  expect(release.resourceCount).toBe(release.manifest.resources.length);
  expect(release.resourceCount).toBe(parsed.summary.resourceCount);
  expect(release.bytes).toBe(
    release.manifest.resources.reduce((total, resource) => total + resource.bytes, 0),
  );
  expect(release.bytes).toBe(parsed.summary.resourceBytes);
  expect(parsed.summary.bytesByScope).toEqual({
    "app-shell": 0,
    common: 0,
    "game-specific": release.bytes,
  });
  expect(parsed.summary.bytesByTarget).toEqual({ opfs: release.bytes, shell: 0 });
  expect(parsed.summary.countByScope).toEqual({
    "app-shell": 0,
    common: 0,
    "game-specific": release.resourceCount,
  });
  expect(parsed.summary.countByTarget).toEqual({ opfs: release.resourceCount, shell: 0 });
  expect(new Set(release.manifest.resources.map(({ id }) => id)).size).toBe(release.resourceCount);
  expect(release.releaseDigest).toBe(
    createHash("sha256").update(release.manifestBytes).digest("hex"),
  );
  expect(new TextDecoder().decode(release.manifestBytes)).toBe(
    `${JSON.stringify(release.manifest)}\n`,
  );
}

function decodeMutableManifest(bytes: Uint8Array): {
  gameId: string;
  resources: Array<Record<string, unknown>>;
  schemaVersion: number;
} {
  return JSON.parse(new TextDecoder().decode(bytes)) as {
    gameId: string;
    resources: Array<Record<string, unknown>>;
    schemaVersion: number;
  };
}

function mutableResource(
  manifest: ReturnType<typeof decodeMutableManifest>,
  index: number,
): Record<string, unknown> {
  const resource = manifest.resources[index];
  if (resource === undefined) throw new Error(`Missing test resource ${index}`);
  return resource;
}
