import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type InstallManifest,
  parseInstallManifestDocument,
  parseStreamingDistrictIndex,
  SCALE_STREAMING_DEPENDENCY_ROLES,
  STREAMING_DEPENDENCY_DECODED_MAX_BYTES,
  STREAMING_DEPENDENCY_ENCODED_MAX_BYTES,
  STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
  scaleStreamingDependencyResourceId,
} from "@parallax/engine";
import type { BuildManifest } from "./build-manifest.js";

export const SCALE_STREAMING_CLASS_FLOOR_BYTES = 100 * 1024 * 1024 * 1024;
export const SCALE_STREAMING_CELL_COUNT = 65_536;
export const SCALE_STREAMING_DEPENDENCY_GRAPH_COUNT = 2_048;
const DEPENDENCY_REUSE_PER_GRAPH =
  SCALE_STREAMING_CELL_COUNT / SCALE_STREAMING_DEPENDENCY_GRAPH_COUNT;
if (
  !Number.isSafeInteger(DEPENDENCY_REUSE_PER_GRAPH) ||
  DEPENDENCY_REUSE_PER_GRAPH * SCALE_STREAMING_DEPENDENCY_GRAPH_COUNT !== SCALE_STREAMING_CELL_COUNT
) {
  throw new Error("Scale-streaming cells must divide exactly across dependency graphs");
}
const MINIMUM_REPRESENTATIVE_CORPUS_BYTES = 1024 * 1024;
const EXPECTED_GRAPHS = Object.freeze([
  Object.freeze({
    height: 64,
    id: "compact",
    indexCount: 1_536,
    texturePattern: "checker",
    topology: "uniform-diagonal",
    vertexCount: 289,
    width: 64,
  }),
  Object.freeze({
    height: 64,
    id: "courtyard",
    indexCount: 3_072,
    texturePattern: "brick",
    topology: "alternating-diagonal",
    vertexCount: 561,
    width: 128,
  }),
  Object.freeze({
    height: 128,
    id: "streetscape",
    indexCount: 6_144,
    texturePattern: "road-markings",
    topology: "row-diagonal",
    vertexCount: 1_089,
    width: 128,
  }),
  Object.freeze({
    height: 128,
    id: "woodland",
    indexCount: 12_288,
    texturePattern: "foliage",
    topology: "hashed-diagonal",
    vertexCount: 2_145,
    width: 256,
  }),
  Object.freeze({
    height: 256,
    id: "district",
    indexCount: 24_576,
    texturePattern: "facade",
    topology: "block-diagonal",
    vertexCount: 4_225,
    width: 256,
  }),
  Object.freeze({
    height: 1_024,
    id: "hero",
    indexCount: 221_184,
    texturePattern: "terrain-noise",
    topology: "radial-diagonal",
    vertexCount: 37_249,
    width: 1_024,
  }),
]);
const EXPECTED_ENCODER = Object.freeze({
  ktxArchiveSha256: "1d4598a290ccb654d6a33c074c4ca96f0c5ccef99e042323eaa4d1230d4de63d",
  ktxJsSha256: "96422b4d0d0de173b9796711379b1525585aa03f8f662ad7794f2dd088da32c7",
  ktxVersion: "4.4.2" as const,
  ktxWasmSha256: "839d8f70377b03e41a73f18ffc3839f87418079792cef4d82aae824a8241c7f0",
  meshoptVersion: "1.2.0" as const,
  policy: "uastc-one-thread-no-sse-no-rdo" as const,
});

interface GeneratedResource {
  readonly bytes: number;
  readonly resourceId: string;
  readonly role: "indices" | "texture" | "vertices";
  readonly sha256: string;
  readonly source: string;
}

interface GeneratedGraph {
  readonly entropy: Readonly<{ rgbaDistinctByteCount: number; transitionRatio: number }>;
  readonly id: string;
  readonly indexCount: number;
  readonly resources: readonly [GeneratedResource, GeneratedResource, GeneratedResource];
  readonly texture: Readonly<{ height: number; width: number }>;
  readonly texturePattern: string;
  readonly topology: string;
  readonly vertexCount: number;
}

export interface GeneratedScaleStreamingCorpus {
  readonly encoder: Readonly<{
    readonly ktxArchiveSha256: string;
    readonly ktxJsSha256: string;
    readonly ktxVersion: "4.4.2";
    readonly ktxWasmSha256: string;
    readonly meshoptVersion: "1.2.0";
    readonly policy: "uastc-one-thread-no-sse-no-rdo";
  }>;
  readonly graphs: readonly GeneratedGraph[];
  readonly schemaVersion: 1;
  readonly totals: Readonly<{ readonly encodedBytes: number; readonly resourceCount: number }>;
}

export interface ScaleStreamingManifestModel {
  readonly cellIdentitySha256: string;
  readonly cellModeledBytes: number;
  readonly cellModeledResourceCount: typeof SCALE_STREAMING_CELL_COUNT;
  readonly cellCount: typeof SCALE_STREAMING_CELL_COUNT;
  readonly dependencyAssignmentSha256: string;
  readonly dependencyIdentitySha256: string;
  readonly dependencyModeledBytes: number;
  readonly dependencyModeledResourceCount: number;
  readonly dependencyGraphCount: typeof SCALE_STREAMING_DEPENDENCY_GRAPH_COUNT;
  readonly dependencyReusePerGraph: number;
  readonly exactModeledBytes: number;
  readonly exactModeledResourceCount: number;
  readonly manifestIdentitySha256: string;
  readonly materializedBytes: 0;
  readonly materializedResources: 0;
  readonly minimumClassBytes: typeof SCALE_STREAMING_CLASS_FLOOR_BYTES;
  readonly sizeBuckets: readonly Readonly<{ bytes: number; count: number }>[];
}

export interface ScaleStreamingTargetDocuments {
  readonly buildManifest: BuildManifest;
  readonly buildManifestBytes: Buffer;
  readonly buildManifestDigest: string;
  readonly dependencyBytes: number;
  readonly dependencyCount: number;
  readonly districtIndexBytes: Buffer;
  readonly districtIndexPath: string;
  readonly graphCount: number;
  readonly installManifest: InstallManifest;
  readonly installManifestBytes: Buffer;
  readonly materializedSampleBytes: number;
  readonly materializedSampleResourceCount: number;
  readonly releaseDigest: string;
}

export function parseGeneratedScaleStreamingCorpus(input: unknown): GeneratedScaleStreamingCorpus {
  if (
    !record(input) ||
    !exactKeys(input, ["encoder", "graphs", "schemaVersion", "totals"]) ||
    input.schemaVersion !== 1 ||
    !record(input.encoder) ||
    !record(input.totals)
  ) {
    throw new Error("Generated scale-streaming corpus identity is invalid");
  }
  const encoder = input.encoder;
  if (
    exactKeys(encoder, [
      "ktxArchiveSha256",
      "ktxJsSha256",
      "ktxVersion",
      "ktxWasmSha256",
      "meshoptVersion",
      "policy",
    ]) === false ||
    JSON.stringify(encoder) !== JSON.stringify(EXPECTED_ENCODER)
  ) {
    throw new Error("Generated scale-streaming encoder identity is invalid");
  }
  if (!Array.isArray(input.graphs) || input.graphs.length !== EXPECTED_GRAPHS.length) {
    throw new Error("Generated scale-streaming graph count is not representative");
  }
  const ids = new Set<string>();
  const hashes = new Set<string>();
  const graphs = input.graphs.map((candidate, ordinal): GeneratedGraph => {
    const expectedGraph = EXPECTED_GRAPHS[ordinal];
    if (
      expectedGraph === undefined ||
      !record(candidate) ||
      !exactKeys(candidate, [
        "entropy",
        "id",
        "indexCount",
        "resources",
        "texture",
        "texturePattern",
        "topology",
        "vertexCount",
      ]) ||
      !record(candidate.entropy) ||
      !exactKeys(candidate.entropy, ["rgbaDistinctByteCount", "transitionRatio"]) ||
      !record(candidate.texture) ||
      !exactKeys(candidate.texture, ["height", "width"]) ||
      candidate.id !== expectedGraph.id ||
      !positiveInteger(candidate.vertexCount) ||
      candidate.vertexCount !== expectedGraph.vertexCount ||
      !positiveInteger(candidate.indexCount) ||
      candidate.indexCount !== expectedGraph.indexCount ||
      candidate.indexCount % 3 !== 0 ||
      !positiveInteger(candidate.texture.width) ||
      candidate.texture.width !== expectedGraph.width ||
      !positiveInteger(candidate.texture.height) ||
      candidate.texture.height !== expectedGraph.height ||
      !positiveInteger(candidate.entropy.rgbaDistinctByteCount) ||
      candidate.entropy.rgbaDistinctByteCount > 256 ||
      typeof candidate.entropy.transitionRatio !== "number" ||
      !Number.isFinite(candidate.entropy.transitionRatio) ||
      candidate.entropy.transitionRatio < 0 ||
      candidate.entropy.transitionRatio > 1 ||
      candidate.texturePattern !== expectedGraph.texturePattern ||
      candidate.topology !== expectedGraph.topology ||
      !Array.isArray(candidate.resources) ||
      candidate.resources.length !== 3 ||
      ids.has(expectedGraph.id)
    ) {
      throw new Error(`Generated scale-streaming graph ${ordinal} is invalid`);
    }
    ids.add(expectedGraph.id);
    const resources = candidate.resources.map((resource, resourceOrdinal): GeneratedResource => {
      const expectedRole = SCALE_STREAMING_DEPENDENCY_ROLES[resourceOrdinal];
      if (
        expectedRole === undefined ||
        !record(resource) ||
        !exactKeys(resource, ["bytes", "resourceId", "role", "sha256", "source"]) ||
        !positiveInteger(resource.bytes) ||
        resource.bytes > STREAMING_DEPENDENCY_ENCODED_MAX_BYTES ||
        typeof resource.resourceId !== "string" ||
        resource.resourceId === "" ||
        resource.role !== expectedRole ||
        typeof resource.source !== "string" ||
        resource.source !==
          `immutable/streaming-${expectedRole}-${String(resource.sha256)}.${expectedRole === "texture" ? "ktx2" : "meshopt"}` ||
        resource.resourceId !==
          scaleStreamingDependencyResourceId(expectedRole, String(resource.sha256)) ||
        !sha256(resource.sha256) ||
        !resource.source.includes(resource.sha256) ||
        hashes.has(resource.sha256)
      ) {
        throw new Error(
          `Generated scale-streaming resource ${ordinal}:${resourceOrdinal} is invalid`,
        );
      }
      hashes.add(resource.sha256);
      return Object.freeze({
        bytes: resource.bytes,
        resourceId: resource.resourceId,
        role: resource.role,
        sha256: resource.sha256,
        source: resource.source,
      }) as GeneratedResource;
    });
    if (
      candidate.texture.width * candidate.texture.height * 4 >
        STREAMING_DEPENDENCY_DECODED_MAX_BYTES ||
      candidate.vertexCount * 32 > STREAMING_DEPENDENCY_DECODED_MAX_BYTES ||
      candidate.indexCount * 4 > STREAMING_DEPENDENCY_DECODED_MAX_BYTES
    ) {
      throw new Error(`Generated scale-streaming graph ${ordinal} exceeds product decode caps`);
    }
    return Object.freeze({
      entropy: Object.freeze({
        rgbaDistinctByteCount: candidate.entropy.rgbaDistinctByteCount,
        transitionRatio: candidate.entropy.transitionRatio,
      }),
      id: expectedGraph.id,
      indexCount: candidate.indexCount,
      resources: Object.freeze(resources) as unknown as GeneratedGraph["resources"],
      texture: Object.freeze({
        height: candidate.texture.height,
        width: candidate.texture.width,
      }),
      texturePattern: expectedGraph.texturePattern,
      topology: expectedGraph.topology,
      vertexCount: candidate.vertexCount,
    });
  });
  const encodedSizes = graphs.flatMap(({ resources }) => resources.map(({ bytes }) => bytes));
  if (Math.max(...encodedSizes) < Math.min(...encodedSizes) * 16) {
    throw new Error("Generated scale-streaming corpus lacks encoded-size variation");
  }
  const encodedBytes = encodedSizes.reduce((sum, bytes) => sum + bytes, 0);
  if (
    !exactKeys(input.totals, ["encodedBytes", "resourceCount"]) ||
    encodedBytes < MINIMUM_REPRESENTATIVE_CORPUS_BYTES ||
    input.totals.encodedBytes !== encodedBytes ||
    input.totals.resourceCount !== graphs.length * 3
  ) {
    throw new Error("Generated scale-streaming totals are invalid");
  }
  return Object.freeze({
    encoder: EXPECTED_ENCODER,
    graphs: Object.freeze(graphs),
    schemaVersion: 1,
    totals: Object.freeze({ encodedBytes, resourceCount: graphs.length * 3 }),
  });
}

export async function readGeneratedScaleStreamingCorpus(
  root: string,
  input: unknown,
): Promise<GeneratedScaleStreamingCorpus> {
  const corpus = parseGeneratedScaleStreamingCorpus(input);
  const resolvedRoot = resolve(root);
  const topologyHashes = new Set<string>();
  const geometryRanges = new Set<number>();
  const textureTransitions: number[] = [];
  for (const graph of corpus.graphs) {
    const payloads: Buffer[] = [];
    for (const resource of graph.resources) {
      const path = resolve(resolvedRoot, resource.source);
      if (path !== resolvedRoot && !path.startsWith(`${resolvedRoot}${sep}`)) {
        throw new Error(`Generated scale-streaming resource escapes its root: ${resource.source}`);
      }
      const [metadata, bytes] = await Promise.all([stat(path), readFile(path)]);
      if (
        !metadata.isFile() ||
        metadata.size !== resource.bytes ||
        digest(bytes) !== resource.sha256
      ) {
        throw new Error(`Generated scale-streaming resource bytes drifted: ${resource.resourceId}`);
      }
      payloads.push(bytes);
    }
    const semantics = await validateGraphCodecSemantics(graph, payloads);
    topologyHashes.add(semantics.topologySha256);
    geometryRanges.add(Math.round(semantics.geometryYRange * 1000));
    textureTransitions.push(semantics.textureTransitionRatio);
  }
  if (
    topologyHashes.size !== EXPECTED_GRAPHS.length ||
    geometryRanges.size !== EXPECTED_GRAPHS.length ||
    Math.max(...textureTransitions) - Math.min(...textureTransitions) < 0.4
  ) {
    throw new Error("Generated scale-streaming decoded content lacks material variation");
  }
  return corpus;
}

export function createScaleStreamingManifestModel(
  generated: GeneratedScaleStreamingCorpus,
): ScaleStreamingManifestModel {
  const validatedGenerated = parseGeneratedScaleStreamingCorpus(generated);
  const sizes = [768 * 1024, 1280 * 1024, 2 * 1024 * 1024, 3 * 1024 * 1024, 5 * 1024 * 1024];
  const counts = sizes.map(() => 0);
  const cellHash = createHash("sha256");
  const dependencyIdentityHash = createHash("sha256");
  const manifestHash = createHash("sha256");
  const dependencyHash = createHash("sha256");
  let cellModeledBytes = 0;
  for (let cell = 0; cell < SCALE_STREAMING_CELL_COUNT; cell += 1) {
    const bucket = mix32(cell ^ 0x5eed145) % sizes.length;
    const bytes = sizes[bucket];
    if (bytes === undefined) throw new Error("Scale-streaming size bucket is absent");
    counts[bucket] = (counts[bucket] ?? 0) + 1;
    cellModeledBytes += bytes;
    const graphOrdinal = cell % SCALE_STREAMING_DEPENDENCY_GRAPH_COUNT;
    const identity = `cell:${cell.toString().padStart(5, "0")}:${bytes}:${graphOrdinal}\n`;
    cellHash.update(identity);
    manifestHash.update(identity);
    dependencyHash.update(`${cell.toString().padStart(5, "0")}:${graphOrdinal}\n`);
  }
  let dependencyModeledBytes = 0;
  for (
    let dependencyGraph = 0;
    dependencyGraph < SCALE_STREAMING_DEPENDENCY_GRAPH_COUNT;
    dependencyGraph += 1
  ) {
    const sourceGraph =
      validatedGenerated.graphs[dependencyGraph % validatedGenerated.graphs.length];
    if (sourceGraph === undefined)
      throw new Error("Scale-streaming dependency source graph is absent");
    for (const resource of sourceGraph.resources) {
      const identity = `dependency:${dependencyGraph.toString().padStart(4, "0")}:${resource.role}:${resource.resourceId}:${resource.sha256}:${resource.bytes}\n`;
      dependencyModeledBytes += resource.bytes;
      dependencyIdentityHash.update(identity);
      manifestHash.update(identity);
    }
  }
  const exactModeledBytes = cellModeledBytes + dependencyModeledBytes;
  const dependencyModeledResourceCount = SCALE_STREAMING_DEPENDENCY_GRAPH_COUNT * 3;
  const exactModeledResourceCount = SCALE_STREAMING_CELL_COUNT + dependencyModeledResourceCount;
  if (
    !Number.isSafeInteger(exactModeledBytes) ||
    exactModeledBytes < SCALE_STREAMING_CLASS_FLOOR_BYTES
  ) {
    throw new Error("Scale-streaming manifest model is below the 100 GiB class floor");
  }
  return Object.freeze({
    cellCount: SCALE_STREAMING_CELL_COUNT,
    cellIdentitySha256: cellHash.digest("hex"),
    cellModeledBytes,
    cellModeledResourceCount: SCALE_STREAMING_CELL_COUNT,
    dependencyAssignmentSha256: dependencyHash.digest("hex"),
    dependencyGraphCount: SCALE_STREAMING_DEPENDENCY_GRAPH_COUNT,
    dependencyIdentitySha256: dependencyIdentityHash.digest("hex"),
    dependencyModeledBytes,
    dependencyModeledResourceCount,
    dependencyReusePerGraph: DEPENDENCY_REUSE_PER_GRAPH,
    exactModeledBytes,
    exactModeledResourceCount,
    manifestIdentitySha256: manifestHash.digest("hex"),
    materializedBytes: 0,
    materializedResources: 0,
    minimumClassBytes: SCALE_STREAMING_CLASS_FLOOR_BYTES,
    sizeBuckets: Object.freeze(
      sizes.map((bytes, index) => Object.freeze({ bytes, count: counts[index] ?? 0 })),
    ),
  });
}

export function createScaleStreamingTargetDocuments(
  current: BuildManifest,
  currentInstallManifest: InstallManifest,
  currentDistrictIndex: unknown,
  generated: GeneratedScaleStreamingCorpus,
): ScaleStreamingTargetDocuments {
  const validatedCurrentManifest = parseInstallManifestDocument(currentInstallManifest).manifest;
  const validatedGenerated = parseGeneratedScaleStreamingCorpus(generated);
  if (!record(currentDistrictIndex) || !Array.isArray(currentDistrictIndex.cells)) {
    throw new Error("Production district index is unavailable for scale-streaming composition");
  }
  const resources = validatedGenerated.graphs
    .flatMap((graph) => {
      const [texture, vertices, indices] = graph.resources;
      if (texture === undefined || vertices === undefined || indices === undefined) {
        throw new Error(`Scale-streaming graph ${graph.id} is incomplete`);
      }
      return [
        descriptor(texture, graph, []),
        descriptor(vertices, graph, [texture.resourceId]),
        descriptor(indices, graph, [texture.resourceId, vertices.resourceId]),
      ];
    })
    .sort((left, right) => compare(left.resourceId, right.resourceId));
  const indexDocument = {
    ...currentDistrictIndex,
    cells: currentDistrictIndex.cells.map((cell, index) => {
      if (!record(cell)) throw new Error(`Production cell ${index} is invalid`);
      const graph = validatedGenerated.graphs[index % validatedGenerated.graphs.length];
      const root = graph?.resources[2];
      if (root === undefined)
        throw new Error(`Scale-streaming cell ${index} has no dependency graph`);
      return { ...cell, dependencies: [root.resourceId] };
    }),
    resources,
    schemaVersion: STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
  };
  parseStreamingDistrictIndex(indexDocument, "district-1-surface");
  const districtIndexBytes = Buffer.from(`${JSON.stringify(indexDocument)}\n`);
  const districtIndexSha256 = digest(districtIndexBytes);
  const districtIndexPath = `immutable/district-1-surface-index-${districtIndexSha256}.json`;
  const indexResource = validatedCurrentManifest.resources.find(
    (resource) => resource.id === "game-specific-district-index-district-1-surface",
  );
  if (indexResource === undefined) throw new Error("Production D1 index resource is absent");
  const districtEntrypoint = current.gameContentEntrypoints.find(
    (entrypoint) => entrypoint.districtId === "district-1-surface",
  );
  if (
    districtEntrypoint === undefined ||
    districtEntrypoint.path !== indexResource.source ||
    districtEntrypoint.schemaVersion !== STREAMING_DISTRICT_INDEX_SCHEMA_VERSION ||
    districtEntrypoint.scope !== "game-specific" ||
    districtEntrypoint.targetType !== "district" ||
    indexResource.kind !== "district-index" ||
    indexResource.scope !== "game-specific" ||
    indexResource.target !== "opfs"
  ) {
    throw new Error("Production D1 index identity is invalid");
  }
  const districtArtifact = current.artifacts.find(
    (artifact) => artifact.path === districtEntrypoint.path,
  );
  if (
    districtArtifact === undefined ||
    districtArtifact.bytes !== indexResource.bytes ||
    districtArtifact.sha256 !== indexResource.sha256
  ) {
    throw new Error("Production D1 index artifact is invalid");
  }
  if (
    validatedCurrentManifest.resources.some(
      (resource) => resource.id !== indexResource.id && resource.source === districtIndexPath,
    ) ||
    current.artifacts.some(
      (artifact) => artifact.path !== districtArtifact.path && artifact.path === districtIndexPath,
    )
  ) {
    throw new Error(
      `Scale-streaming district index collides with production: ${districtIndexPath}`,
    );
  }
  const dependencyInstallResources = validatedGenerated.graphs.flatMap(
    ({ resources: graphResources }) =>
      graphResources.map((resource) => ({
        bytes: resource.bytes,
        id: resource.resourceId,
        kind: "asset-pack" as const,
        scope: "game-specific" as const,
        sha256: resource.sha256,
        source: resource.source,
        target: "opfs" as const,
      })),
  );
  const productionIds = new Set(validatedCurrentManifest.resources.map(({ id }) => id));
  const collidingDependency = dependencyInstallResources.find(({ id }) => productionIds.has(id));
  if (collidingDependency !== undefined) {
    throw new Error(
      `Scale-streaming dependency collides with production: ${collidingDependency.id}`,
    );
  }
  const parsed = parseInstallManifestDocument({
    gameId: "parallax",
    resources: [
      ...validatedCurrentManifest.resources.map((resource) =>
        resource.id === indexResource.id
          ? {
              ...resource,
              bytes: districtIndexBytes.byteLength,
              sha256: districtIndexSha256,
              source: districtIndexPath,
            }
          : resource,
      ),
      ...dependencyInstallResources,
    ].sort((left, right) => compare(left.id, right.id)),
    schemaVersion: 1,
  });
  assertCompositionPreservesResources(
    validatedCurrentManifest,
    parsed.manifest,
    indexResource.id,
    districtIndexPath,
    districtIndexBytes.byteLength,
    districtIndexSha256,
    dependencyInstallResources,
  );
  const installManifestBytes = Buffer.from(`${JSON.stringify(parsed.manifest)}\n`);
  const releaseDigest = digest(installManifestBytes);
  const installManifestPath = current.installManifestEntrypoint.path;
  if (current.artifacts.filter(({ path }) => path === installManifestPath).length !== 1) {
    throw new Error("Production build has no unique install-manifest artifact");
  }
  const artifacts = [
    ...current.artifacts.map((artifact) => {
      if (artifact.path === installManifestPath) {
        return { ...artifact, bytes: installManifestBytes.byteLength, sha256: releaseDigest };
      }
      if (artifact.path === districtArtifact.path) {
        return {
          ...artifact,
          bytes: districtIndexBytes.byteLength,
          path: districtIndexPath,
          sha256: districtIndexSha256,
        };
      }
      return artifact;
    }),
    ...dependencyInstallResources.map((resource) => ({
      bytes: resource.bytes,
      path: resource.source,
      sha256: resource.sha256,
    })),
  ].sort((left, right) => compare(left.path, right.path));
  assertCompositionPreservesArtifacts(
    current,
    artifacts,
    districtArtifact.path,
    districtIndexPath,
    districtIndexBytes.byteLength,
    districtIndexSha256,
    installManifestPath,
    installManifestBytes.byteLength,
    releaseDigest,
    dependencyInstallResources,
  );
  const gameContentEntrypoints = current.gameContentEntrypoints.map((entrypoint) =>
    entrypoint.districtId === districtEntrypoint.districtId
      ? Object.freeze({
          ...entrypoint,
          path: districtIndexPath,
          schemaVersion: STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
        })
      : entrypoint,
  );
  const buildManifest = Object.freeze({
    ...current,
    artifacts: Object.freeze(artifacts),
    gameContentEntrypoints: Object.freeze(gameContentEntrypoints),
  });
  const buildManifestBytes = Buffer.from(`${JSON.stringify(buildManifest)}\n`);
  const cellResources = parsed.manifest.resources.filter(
    (resource) => resource.kind === "world-cell",
  );
  const dependencyBytes = dependencyInstallResources.reduce(
    (sum, resource) => sum + resource.bytes,
    0,
  );
  return Object.freeze({
    buildManifest,
    buildManifestBytes,
    buildManifestDigest: digest(buildManifestBytes),
    dependencyBytes,
    dependencyCount: dependencyInstallResources.length,
    districtIndexBytes,
    districtIndexPath,
    graphCount: validatedGenerated.graphs.length,
    installManifest: parsed.manifest,
    installManifestBytes,
    materializedSampleBytes:
      dependencyBytes +
      districtIndexBytes.byteLength +
      cellResources.reduce((sum, item) => sum + item.bytes, 0),
    materializedSampleResourceCount: dependencyInstallResources.length + cellResources.length + 1,
    releaseDigest,
  });
}

function assertCompositionPreservesArtifacts(
  original: BuildManifest,
  composed: BuildManifest["artifacts"],
  originalIndexPath: string,
  composedIndexPath: string,
  indexBytes: number,
  indexSha256: string,
  installPath: string,
  installBytes: number,
  installSha256: string,
  dependencies: readonly InstallManifest["resources"][number][],
): void {
  const expected = new Map<string, BuildManifest["artifacts"][number]>();
  for (const artifact of original.artifacts) {
    const expectedArtifact =
      artifact.path === originalIndexPath
        ? { ...artifact, bytes: indexBytes, path: composedIndexPath, sha256: indexSha256 }
        : artifact.path === installPath
          ? { ...artifact, bytes: installBytes, sha256: installSha256 }
          : artifact;
    if (expected.has(expectedArtifact.path)) {
      throw new Error(
        `Scale-streaming artifact collides with production: ${expectedArtifact.path}`,
      );
    }
    expected.set(expectedArtifact.path, expectedArtifact);
  }
  for (const dependency of dependencies) {
    if (expected.has(dependency.source)) {
      throw new Error(`Scale-streaming artifact collides with production: ${dependency.source}`);
    }
    expected.set(dependency.source, {
      bytes: dependency.bytes,
      path: dependency.source,
      sha256: dependency.sha256,
    });
  }
  if (composed.length !== expected.size) {
    throw new Error("Scale-streaming build composition omitted or duplicated an artifact");
  }
  for (const artifact of composed) {
    const match = expected.get(artifact.path);
    if (match === undefined || canonicalJson(match) !== canonicalJson(artifact)) {
      throw new Error(`Scale-streaming build composition mutated artifact: ${artifact.path}`);
    }
    expected.delete(artifact.path);
  }
  if (expected.size !== 0) {
    throw new Error(
      `Scale-streaming build composition omitted artifact: ${[...expected.keys()][0]}`,
    );
  }
}

function assertCompositionPreservesResources(
  original: InstallManifest,
  composed: InstallManifest,
  indexResourceId: string,
  indexSource: string,
  indexBytes: number,
  indexSha256: string,
  dependencies: readonly InstallManifest["resources"][number][],
): void {
  const expected = new Map<string, InstallManifest["resources"][number]>();
  for (const resource of original.resources) {
    expected.set(
      resource.id,
      resource.id === indexResourceId
        ? { ...resource, bytes: indexBytes, sha256: indexSha256, source: indexSource }
        : resource,
    );
  }
  for (const resource of dependencies) {
    if (expected.has(resource.id)) {
      throw new Error(`Scale-streaming dependency collides with production: ${resource.id}`);
    }
    expected.set(resource.id, resource);
  }
  if (composed.resources.length !== expected.size) {
    throw new Error("Scale-streaming composition omitted or duplicated a resource");
  }
  for (const resource of composed.resources) {
    const expectedResource = expected.get(resource.id);
    if (
      expectedResource === undefined ||
      canonicalJson(resource) !== canonicalJson(expectedResource)
    ) {
      throw new Error(`Scale-streaming composition mutated resource: ${resource.id}`);
    }
    expected.delete(resource.id);
  }
  if (expected.size !== 0) {
    throw new Error(`Scale-streaming composition omitted resource: ${[...expected.keys()][0]}`);
  }
}

function descriptor(
  resource: GeneratedResource,
  graph: GeneratedGraph,
  dependencies: readonly string[],
) {
  const decode =
    resource.role === "texture"
      ? {
          colorSpace: "srgb",
          format: "rgba8",
          height: graph.texture.height,
          version: 1,
          width: graph.texture.width,
        }
      : resource.role === "vertices"
        ? {
            count: graph.vertexCount,
            layout: "position-normal-uv-f32",
            mode: "ATTRIBUTES",
            stride: 32,
            version: 1,
          }
        : {
            count: graph.indexCount,
            indexFormat: "uint32",
            mode: "TRIANGLES",
            stride: 4,
            version: 1,
            vertexCount: graph.vertexCount,
          };
  return {
    bytes: resource.bytes,
    decode,
    dependencies,
    format: resource.role === "texture" ? "ktx2" : "meshopt",
    path: resource.source,
    resourceId: resource.resourceId,
    sha256: resource.sha256,
  };
}

let ktxDecoderReady: Promise<void> | undefined;
interface KtxCodecModule {
  readonly KTX2Decoder: new () => {
    decode(
      bytes: Uint8Array,
      capabilities: Readonly<Record<string, boolean>>,
      options: Readonly<{ forceRGBA: boolean }>,
    ): Promise<{
      errors?: string;
      hasAlpha: boolean;
      height: number;
      isInGammaSpace: boolean;
      mipmaps: readonly Readonly<{
        data: Uint8Array | null;
        height: number;
        width: number;
      }>[];
      width: number;
    }>;
  };
  readonly MSCTranscoder: { WasmBinary: ArrayBufferLike };
}
interface MeshoptCodecModule {
  readonly MeshoptDecoder: {
    decodeGltfBuffer(
      target: Uint8Array,
      count: number,
      stride: number,
      source: Uint8Array,
      mode: string,
    ): void;
    readonly ready: Promise<void>;
  };
}
let codecModules:
  | Promise<{ readonly ktx: KtxCodecModule; readonly meshopt: MeshoptCodecModule }>
  | undefined;

async function validateGraphCodecSemantics(
  graph: GeneratedGraph,
  payloads: readonly Buffer[],
): Promise<
  Readonly<{ geometryYRange: number; textureTransitionRatio: number; topologySha256: string }>
> {
  const [textureBytes, vertexBytes, indexBytes] = payloads;
  if (textureBytes === undefined || vertexBytes === undefined || indexBytes === undefined) {
    throw new Error(`Generated scale-streaming graph ${graph.id} payload set is incomplete`);
  }
  try {
    const codecPaths = resolveScaleStreamingCodecPaths(import.meta.dirname);
    codecModules ??= Promise.all([
      import(pathToFileURL(codecPaths.ktxDecoderJs).href),
      import(pathToFileURL(codecPaths.meshoptDecoderJs).href),
    ]).then(([ktx, meshopt]) => ({
      ktx: ktx as unknown as KtxCodecModule,
      meshopt: meshopt as unknown as MeshoptCodecModule,
    }));
    const { ktx, meshopt } = await codecModules;
    ktxDecoderReady ??= readFile(codecPaths.ktxDecoderWasm).then((wasm) => {
      ktx.MSCTranscoder.WasmBinary = wasm.buffer.slice(
        wasm.byteOffset,
        wasm.byteOffset + wasm.byteLength,
      );
    });
    await ktxDecoderReady;
    const decodedTexture = await new ktx.KTX2Decoder().decode(
      textureBytes,
      { astc: false, bptc: false, etc1: false, etc2: false, pvrtc: false, s3tc: false },
      { forceRGBA: true },
    );
    const base = decodedTexture.mipmaps[0];
    const expectedTextureBytes = graph.texture.width * graph.texture.height * 4;
    if (
      base === undefined ||
      base.data === null ||
      decodedTexture.errors !== undefined ||
      decodedTexture.isInGammaSpace !== true ||
      decodedTexture.mipmaps.length !== 1 ||
      decodedTexture.width !== graph.texture.width ||
      decodedTexture.height !== graph.texture.height ||
      base.width !== graph.texture.width ||
      base.height !== graph.texture.height ||
      base.data.byteLength !== expectedTextureBytes
    ) {
      throw new Error("KTX2 decoded dimensions or RGBA8 payload disagree with the declaration");
    }
    await meshopt.MeshoptDecoder.ready;
    const decodedVertices = new Uint8Array(graph.vertexCount * 32);
    meshopt.MeshoptDecoder.decodeGltfBuffer(
      decodedVertices,
      graph.vertexCount,
      32,
      vertexBytes,
      "ATTRIBUTES",
    );
    const attributes = new Float32Array(decodedVertices.buffer);
    let minimumY = Number.POSITIVE_INFINITY;
    let maximumY = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < attributes.length; index += 1) {
      const value = attributes[index];
      if (value === undefined || !Number.isFinite(value)) {
        throw new Error("Meshopt attributes decoded a non-finite value");
      }
      if (index % 8 === 1) {
        minimumY = Math.min(minimumY, value);
        maximumY = Math.max(maximumY, value);
      }
    }
    const decodedIndices = new Uint8Array(graph.indexCount * 4);
    meshopt.MeshoptDecoder.decodeGltfBuffer(
      decodedIndices,
      graph.indexCount,
      4,
      indexBytes,
      "TRIANGLES",
    );
    for (const value of new Uint32Array(decodedIndices.buffer)) {
      if (value >= graph.vertexCount) {
        throw new Error("Meshopt indices decoded an out-of-range vertex index");
      }
    }
    let meaningfulTransitions = 0;
    const rgba = base.data;
    for (let offset = 4; offset < rgba.byteLength; offset += 4) {
      const distance =
        Math.abs((rgba[offset] ?? 0) - (rgba[offset - 4] ?? 0)) +
        Math.abs((rgba[offset + 1] ?? 0) - (rgba[offset - 3] ?? 0)) +
        Math.abs((rgba[offset + 2] ?? 0) - (rgba[offset - 2] ?? 0));
      if (distance >= 48) meaningfulTransitions += 1;
    }
    return Object.freeze({
      geometryYRange: maximumY - minimumY,
      textureTransitionRatio:
        meaningfulTransitions / (graph.texture.width * graph.texture.height - 1),
      topologySha256: digest(Buffer.from(decodedIndices)),
    });
  } catch (error) {
    throw new Error(`Generated scale-streaming graph ${graph.id} codec payload is invalid`, {
      cause: error,
    });
  }
}

function resolveScaleStreamingCodecPaths(moduleDirectory: string): Readonly<{
  ktxDecoderJs: string;
  ktxDecoderWasm: string;
  meshoptDecoderJs: string;
}> {
  const directory = resolve(moduleDirectory);
  const sourceRepositoryRoot = resolve(directory, "../..");
  const emittedRepositoryRoot = resolve(directory, "../../..");
  const repositoryRoot =
    directory === resolve(sourceRepositoryRoot, "harness/src")
      ? sourceRepositoryRoot
      : directory === resolve(emittedRepositoryRoot, "harness/dist/types")
        ? emittedRepositoryRoot
        : undefined;
  if (repositoryRoot === undefined) {
    throw new Error(`Scale-streaming codec module layout is unsupported: ${directory}`);
  }
  return Object.freeze({
    ktxDecoderJs: resolve(repositoryRoot, "engine/node_modules/@babylonjs/ktx2decoder/index.js"),
    ktxDecoderWasm: resolve(
      repositoryRoot,
      "engine/node_modules/@babylonjs/ktx2decoder/wasm/msc_basis_transcoder.wasm",
    ),
    meshoptDecoderJs: resolve(
      repositoryRoot,
      "engine/node_modules/meshoptimizer/meshopt_decoder.mjs",
    ),
  });
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
function mix32(value: number): number {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}
function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (record(value)) {
    return `{${Object.keys(value)
      .sort(compare)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
