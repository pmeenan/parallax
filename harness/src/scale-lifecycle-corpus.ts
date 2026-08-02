import { createHash } from "node:crypto";
import {
  type InstallManifest,
  type InstallManifestSummary,
  type InstallResource,
  parseInstallManifestDocument,
} from "@parallax/engine";

export const SCALE_LIFECYCLE_CONTRACT = "scale-lifecycle-model@1" as const;
export const SCALE_LIFECYCLE_FLOOR_BYTES = 100 * 1024 * 1024 * 1024;
export const SCALE_LIFECYCLE_RESOURCE_COUNT = 400;
export const SCALE_LIFECYCLE_BASE_RESOURCE_BYTES = 256 * 1024 * 1024;

export type ScaleInstallResource = InstallResource;
export type ScaleManifestDocument = InstallManifest;

export interface ScaleReleaseCorpus {
  readonly bytes: number;
  readonly manifest: ScaleManifestDocument;
  readonly manifestBytes: Uint8Array;
  readonly releaseDigest: string;
  readonly resourceCount: number;
  readonly summary: InstallManifestSummary;
}

export interface ScaleLifecycleCorpus {
  readonly cleanupRotation: ScaleReleaseCorpus;
  readonly initial: ScaleReleaseCorpus;
  readonly lifecycleFloorBytes: number;
  readonly sourceMaterializedBytes: 0;
  readonly update: ScaleReleaseCorpus;
  readonly updateChangedResourceId: string;
}

interface ModeledSource {
  readonly bytes: number;
  readonly sha256: string;
  readonly source: string;
}

export function createScaleLifecycleCorpus(
  input: Readonly<{
    baseResourceBytes?: number;
    lifecycleFloorBytes?: number;
    resourceCount?: number;
  }> = {},
): ScaleLifecycleCorpus {
  const baseResourceBytes = input.baseResourceBytes ?? SCALE_LIFECYCLE_BASE_RESOURCE_BYTES;
  const lifecycleFloorBytes = input.lifecycleFloorBytes ?? SCALE_LIFECYCLE_FLOOR_BYTES;
  const resourceCount = input.resourceCount ?? SCALE_LIFECYCLE_RESOURCE_COUNT;
  if (
    !Number.isSafeInteger(baseResourceBytes) ||
    baseResourceBytes <= 0 ||
    !Number.isSafeInteger(lifecycleFloorBytes) ||
    lifecycleFloorBytes <= 0 ||
    !Number.isSafeInteger(resourceCount) ||
    resourceCount < 1 ||
    resourceCount > 10_000
  ) {
    throw new Error("Scale lifecycle model dimensions are invalid");
  }

  const sizes = Array.from({ length: resourceCount + 1 }, (_, index) => baseResourceBytes + index);
  const hashes = zeroPrefixSha256(sizes);
  const sources = sizes.map((bytes, index) =>
    Object.freeze({
      bytes,
      sha256: requireValue(hashes.get(bytes), `zero digest for ${bytes} bytes`),
      source: sourceFor(index),
    }),
  );
  const initialResources = sources
    .slice(0, resourceCount)
    .map((source, index) => installResource(source, index));
  const updateChangedIndex = resourceCount - 1;
  const updateResources = initialResources.map((resource, index) =>
    index === updateChangedIndex
      ? installResource(requireValue(sources[resourceCount], "update resource"), index)
      : resource,
  );
  const cleanupResources = updateResources.map((resource, index) =>
    index === 0
      ? Object.freeze({ ...resource, source: `${resource.source.slice(0, -4)}-alias.bin` })
      : resource,
  );
  const initial = releaseCorpus(initialResources);
  const update = releaseCorpus(updateResources);
  const cleanupRotation = releaseCorpus(cleanupResources);
  for (const [name, release] of [
    ["initial", initial],
    ["update", update],
    ["cleanup rotation", cleanupRotation],
  ] as const) {
    if (release.bytes < lifecycleFloorBytes) {
      throw new Error(
        `Scale lifecycle ${name} model is ${release.bytes} bytes, below floor ${lifecycleFloorBytes}`,
      );
    }
  }
  return Object.freeze({
    cleanupRotation,
    initial,
    lifecycleFloorBytes,
    sourceMaterializedBytes: 0,
    update,
    updateChangedResourceId: requireValue(
      initialResources[updateChangedIndex],
      "update resource identity",
    ).id,
  });
}

function releaseCorpus(resources: readonly ScaleInstallResource[]): ScaleReleaseCorpus {
  const generated = Object.freeze({
    gameId: "parallax" as const,
    resources: Object.freeze([...resources]),
    schemaVersion: 1 as const,
  });
  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(generated)}\n`);
  const parsed = parseInstallManifestDocument(JSON.parse(new TextDecoder().decode(manifestBytes)));
  return Object.freeze({
    bytes: parsed.summary.resourceBytes,
    manifest: parsed.manifest,
    manifestBytes,
    releaseDigest: createHash("sha256").update(manifestBytes).digest("hex"),
    resourceCount: parsed.summary.resourceCount,
    summary: parsed.summary,
  });
}

function installResource(source: ModeledSource, index: number): ScaleInstallResource {
  return Object.freeze({
    bytes: source.bytes,
    id: `scale-asset-${index.toString().padStart(5, "0")}`,
    kind: "asset-pack",
    scope: "game-specific",
    sha256: source.sha256,
    source: source.source,
    target: "opfs",
  });
}

function sourceFor(index: number): string {
  return `__parallax/scale-lifecycle-model/zero-${index.toString().padStart(5, "0")}.bin`;
}

function zeroPrefixSha256(sizes: readonly number[]): ReadonlyMap<number, string> {
  const unique = [...new Set(sizes)].sort((left, right) => left - right);
  const digests = new Map<number, string>();
  const hash = createHash("sha256");
  const chunk = Buffer.alloc(1024 * 1024);
  let offset = 0;
  for (const size of unique) {
    if (!Number.isSafeInteger(size) || size <= offset) {
      throw new Error("Scale lifecycle model sizes must be unique positive safe integers");
    }
    while (offset < size) {
      const bytes = Math.min(chunk.byteLength, size - offset);
      hash.update(bytes === chunk.byteLength ? chunk : chunk.subarray(0, bytes));
      offset += bytes;
    }
    digests.set(size, hash.copy().digest("hex"));
  }
  return digests;
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing ${label}`);
  return value;
}
