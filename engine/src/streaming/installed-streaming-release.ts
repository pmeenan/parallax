import type { InstalledReleaseBinding } from "../storage/installed-release";
import type { WorldVec3 } from "../world/world-contract";
import { parseGreyboxMaterials } from "../world/world-contract";
import {
  canonicalStreamingCellArtifactIdentity,
  canonicalStreamingDistrictIndexResourceId,
} from "./streaming-cell-identity";
import { expectedStreamingDependencyDecodedBytes } from "./streaming-dependency-contract";
import type {
  StreamingCellIndexEntry,
  StreamingDependencyIndexEntry,
  StreamingDistrictIndex,
  StreamingKtx2DependencyIndexEntry,
  StreamingMeshoptIndexDependencyIndexEntry,
  StreamingMeshoptVertexDependencyIndexEntry,
} from "./streaming-protocol";
import {
  STREAMING_DEPENDENCY_DECODED_MAX_BYTES,
  STREAMING_DEPENDENCY_ENCODED_MAX_BYTES,
  STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
} from "./streaming-protocol";

export interface InstalledStreamingCell {
  readonly entry: StreamingCellIndexEntry;
  readonly path: string;
  readonly resourceId: string;
}

export interface InstalledStreamingRelease {
  readonly cells: readonly InstalledStreamingCell[];
  readonly dependencies: readonly Readonly<{
    readonly descriptor: StreamingDependencyIndexEntry;
    readonly path: string;
  }>[];
  readonly index: StreamingDistrictIndex;
  readonly indexPath: string;
  readonly indexResourceId: string;
  readonly releaseDigest: string;
}

export type InstalledResourceReader = (path: string) => Promise<Uint8Array>;

export async function resolveInstalledStreamingRelease(
  binding: InstalledReleaseBinding,
  districtId: string,
  read: InstalledResourceReader,
): Promise<InstalledStreamingRelease> {
  const indexResourceId = canonicalStreamingDistrictIndexResourceId(districtId);
  const indexResource = binding.manifest.resources.find(
    (resource) => resource.id === indexResourceId,
  );
  if (
    indexResource === undefined ||
    indexResource.kind !== "district-index" ||
    indexResource.scope !== "game-specific" ||
    indexResource.target !== "opfs"
  ) {
    throw new Error(`Installed release omits exact district index ${indexResourceId}`);
  }
  const resolvedIndex = await binding.getResource(indexResourceId);
  const indexBytes = await read(resolvedIndex.reference.path);
  if (indexBytes.byteLength !== indexResource.bytes) {
    throw new Error(`Installed district index ${districtId} has the wrong byte length`);
  }
  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(indexBytes));
  } catch (error: unknown) {
    throw new Error(
      `Installed district index ${districtId} is not valid UTF-8 JSON`,
      error instanceof Error ? { cause: error } : undefined,
    );
  }
  const index = parseStreamingDistrictIndex(document, districtId);
  const resourcesBySource = new Map(
    binding.manifest.resources
      .filter(
        (resource) =>
          resource.kind === "world-cell" &&
          resource.scope === "game-specific" &&
          resource.target === "opfs",
      )
      .map((resource) => [resource.source, resource] as const),
  );
  const dependencyResourcesById = new Map(
    binding.manifest.resources
      .filter(
        (resource) =>
          resource.kind === "asset-pack" &&
          resource.scope === "game-specific" &&
          resource.target === "opfs",
      )
      .map((resource) => [resource.id, resource] as const),
  );
  const cellResources = index.cells.map((entry) => {
    const identity = canonicalStreamingCellArtifactIdentity(
      districtId,
      entry.coordinate,
      entry.sha256,
    );
    if (entry.cellId !== identity.cellId || entry.path !== identity.source) {
      throw new Error(`Installed cell ${entry.cellId} has noncanonical semantic identity`);
    }
    const resource = resourcesBySource.get(entry.path);
    if (
      resource === undefined ||
      resource.id !== identity.resourceId ||
      resource.bytes !== entry.bytes ||
      resource.sha256 !== entry.sha256
    ) {
      throw new Error(`Installed cell ${entry.cellId} is not bound exactly by the release`);
    }
    return resource;
  });
  if (new Set(cellResources.map((resource) => resource.id)).size !== cellResources.length) {
    throw new Error(`Installed district ${districtId} aliases world-cell resources`);
  }
  const references = await binding.getResources(cellResources.map((resource) => resource.id));
  const cells = index.cells.map((entry, indexPosition) => {
    const resolved = references[indexPosition];
    const resource = cellResources[indexPosition];
    if (
      resolved === undefined ||
      resource === undefined ||
      resolved.manifest.id !== resource.id ||
      resolved.reference.path === ""
    ) {
      throw new Error(`Installed cell ${entry.cellId} resolved out of order`);
    }
    return Object.freeze({
      entry,
      path: resolved.reference.path,
      resourceId: resource.id,
    });
  });
  const dependencyDescriptors = index.resources ?? [];
  const dependencyResources = dependencyDescriptors.map((descriptor) => {
    const resource = dependencyResourcesById.get(descriptor.resourceId);
    if (
      resource === undefined ||
      resource.bytes !== descriptor.bytes ||
      resource.source !== descriptor.path ||
      resource.sha256 !== descriptor.sha256
    ) {
      throw new Error(
        `Installed dependency ${descriptor.resourceId} is not bound exactly by the release`,
      );
    }
    return resource;
  });
  const dependencyReferences =
    dependencyResources.length === 0
      ? []
      : await binding.getResources(dependencyResources.map((resource) => resource.id));
  const dependencies = dependencyDescriptors.map((descriptor, position) => {
    const resource = dependencyResources[position];
    const resolved = dependencyReferences[position];
    if (
      resource === undefined ||
      resolved === undefined ||
      resolved.manifest.id !== resource.id ||
      resolved.reference.path === ""
    ) {
      throw new Error(`Installed dependency ${descriptor.resourceId} resolved out of order`);
    }
    return Object.freeze({ descriptor, path: resolved.reference.path });
  });
  return Object.freeze({
    cells: Object.freeze(cells),
    dependencies: Object.freeze(dependencies),
    index,
    indexPath: resolvedIndex.reference.path,
    indexResourceId,
    releaseDigest: binding.releaseDigest,
  });
}

export function parseStreamingDistrictIndex(
  input: unknown,
  expectedDistrictId: string,
): StreamingDistrictIndex {
  if (!record(input)) throw new Error("District index must be an object");
  const schemaVersion = input.schemaVersion;
  const inputKeys = Object.keys(input).sort().join(",");
  if (
    inputKeys !== "bounds,cellSizeMeters,cells,districtId,materials,resources,schemaVersion" ||
    schemaVersion !== STREAMING_DISTRICT_INDEX_SCHEMA_VERSION ||
    input.districtId !== expectedDistrictId ||
    !positiveFinite(input.cellSizeMeters) ||
    !record(input.bounds) ||
    Object.keys(input.bounds).sort().join(",") !== "maximum,minimum" ||
    !worldVec3(input.bounds.minimum) ||
    !worldVec3(input.bounds.maximum) ||
    !orderedBounds(input.bounds.minimum, input.bounds.maximum) ||
    !Array.isArray(input.cells) ||
    input.cells.length === 0
  ) {
    throw new Error(`District index identity is invalid for ${expectedDistrictId}`);
  }
  const materials = parseGreyboxMaterials(input.materials);
  const bounds = Object.freeze({
    maximum: Object.freeze([...input.bounds.maximum]) as WorldVec3,
    minimum: Object.freeze([...input.bounds.minimum]) as WorldVec3,
  });
  const cellSizeMeters = input.cellSizeMeters;
  const ids = new Set<string>();
  const coordinates = new Set<string>();
  const paths = new Set<string>();
  const hashes = new Set<string>();
  const resources = parseDependencyResources(input.resources);
  const resourceIds = new Set(resources.map((resource) => resource.resourceId));
  const referencedResourceIds = new Set<string>();
  const indexResourceIdByVertexResourceId = new Map<string, string>();
  const cells = input.cells.map((candidate): StreamingCellIndexEntry => {
    const candidateKeys = record(candidate) ? Object.keys(candidate).sort().join(",") : "";
    if (
      !record(candidate) ||
      candidateKeys !== "bytes,cellId,coordinate,dependencies,path,sha256" ||
      !positiveSafeInteger(candidate.bytes) ||
      typeof candidate.cellId !== "string" ||
      candidate.cellId.trim() === "" ||
      !coordinate(candidate.coordinate) ||
      typeof candidate.path !== "string" ||
      !safeRelativePath(candidate.path) ||
      typeof candidate.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(candidate.sha256)
    ) {
      throw new Error(`District ${expectedDistrictId} has an invalid cell index entry`);
    }
    const dependencies = candidate.dependencies;
    if (
      !Array.isArray(dependencies) ||
      dependencies.length === 0 ||
      new Set(dependencies).size !== dependencies.length ||
      dependencies.some(
        (resourceId) =>
          typeof resourceId !== "string" ||
          !resourceIds.has(resourceId) ||
          !(
            isVersionedIndexResource(
              resources.find((resource) => resource.resourceId === resourceId),
            ) ||
            isLinearTextureRoot(resources.find((resource) => resource.resourceId === resourceId))
          ),
      )
    ) {
      throw new Error(`District ${expectedDistrictId} has an invalid cell dependency graph`);
    }
    const cellDependencies = dependencies as string[];
    validateCellDependencyTopology(
      candidate.cellId,
      cellDependencies,
      resources,
      indexResourceIdByVertexResourceId,
    );
    for (const resourceId of cellDependencies) {
      referencedResourceIds.add(`${candidate.cellId}:${resourceId}`);
      collectDependencyClosure(resourceId, resources, referencedResourceIds);
    }
    const cellCoordinate = candidate.coordinate;
    const identity = canonicalStreamingCellArtifactIdentity(
      expectedDistrictId,
      cellCoordinate,
      candidate.sha256,
    );
    if (candidate.cellId !== identity.cellId || candidate.path !== identity.source) {
      throw new Error(`District ${expectedDistrictId} has noncanonical cell identity`);
    }
    const minimumX = bounds.minimum[0] + cellCoordinate[0] * cellSizeMeters;
    const minimumZ = bounds.minimum[2] + cellCoordinate[1] * cellSizeMeters;
    const maximumX = minimumX + cellSizeMeters;
    const maximumZ = minimumZ + cellSizeMeters;
    if (
      !Number.isFinite(minimumX) ||
      !Number.isFinite(minimumZ) ||
      !Number.isFinite(maximumX) ||
      !Number.isFinite(maximumZ) ||
      minimumX < bounds.minimum[0] ||
      minimumZ < bounds.minimum[2] ||
      maximumX > bounds.maximum[0] ||
      maximumZ > bounds.maximum[2]
    ) {
      throw new Error(`District ${expectedDistrictId} cell coordinate is outside its bounds`);
    }
    const coordinateKey = cellCoordinate.join(",");
    if (
      ids.has(candidate.cellId) ||
      coordinates.has(coordinateKey) ||
      paths.has(candidate.path) ||
      hashes.has(candidate.sha256)
    ) {
      throw new Error(`District ${expectedDistrictId} has duplicate cell identity`);
    }
    ids.add(candidate.cellId);
    coordinates.add(coordinateKey);
    paths.add(candidate.path);
    hashes.add(candidate.sha256);
    return Object.freeze({
      bytes: candidate.bytes,
      cellId: candidate.cellId,
      coordinate: Object.freeze([...cellCoordinate]) as readonly [number, number],
      ...(cellDependencies === undefined
        ? {}
        : { dependencies: Object.freeze([...cellDependencies]) as readonly string[] }),
      path: candidate.path,
      sha256: candidate.sha256,
    });
  });
  if (
    resources.length > 0 &&
    resources.some(
      (resource) =>
        ![...referencedResourceIds].some((reference) =>
          reference.endsWith(`:${resource.resourceId}`),
        ),
    )
  ) {
    throw new Error(`District ${expectedDistrictId} has an unreachable dependency resource`);
  }
  return Object.freeze({
    bounds,
    cellSizeMeters,
    cells: Object.freeze(cells),
    districtId: expectedDistrictId,
    materials,
    ...(resources.length === 0 ? {} : { resources: Object.freeze(resources) }),
    schemaVersion,
  });
}

function parseDependencyResources(input: unknown): StreamingDependencyIndexEntry[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("District dependency resources must be a non-empty array");
  }
  const resources: StreamingDependencyIndexEntry[] = [];
  const ids = new Set<string>();
  const paths = new Set<string>();
  const hashes = new Set<string>();
  let previousId: string | null = null;
  for (const candidate of input) {
    if (!record(candidate)) throw new Error("District dependency resource must be an object");
    const commonValid =
      positiveSafeInteger(candidate.bytes) &&
      candidate.bytes <= STREAMING_DEPENDENCY_ENCODED_MAX_BYTES &&
      Array.isArray(candidate.dependencies) &&
      new Set(candidate.dependencies).size === candidate.dependencies.length &&
      candidate.dependencies.every((value) => typeof value === "string" && ids.has(value)) &&
      typeof candidate.path === "string" &&
      safeRelativePath(candidate.path) &&
      typeof candidate.resourceId === "string" &&
      /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/.test(candidate.resourceId) &&
      typeof candidate.sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(candidate.sha256) &&
      (previousId === null || previousId < candidate.resourceId) &&
      !ids.has(candidate.resourceId) &&
      !paths.has(candidate.path) &&
      !hashes.has(candidate.sha256);
    if (!commonValid) throw new Error("District dependency resource identity is invalid");
    const dependencyIds = candidate.dependencies as string[];
    let resource: StreamingDependencyIndexEntry;
    if (
      candidate.format === "ktx2" &&
      Object.keys(candidate).sort().join(",") ===
        "bytes,decode,dependencies,format,path,resourceId,sha256" &&
      dependencyIds.length === 0 &&
      record(candidate.decode) &&
      (Object.keys(candidate.decode).sort().join(",") === "colorSpace,format,height,width" ||
        (Object.keys(candidate.decode).sort().join(",") ===
          "colorSpace,format,height,version,width" &&
          candidate.decode.version === 1) ||
        (Object.keys(candidate.decode).sort().join(",") ===
          "colorSpace,format,height,mipLevelCount,version,width" &&
          candidate.decode.version === 2 &&
          positiveSafeInteger(candidate.decode.mipLevelCount) &&
          candidate.decode.mipLevelCount ===
            Math.floor(
              Math.log2(
                Math.max(candidate.decode.width as number, candidate.decode.height as number),
              ),
            ) +
              1)) &&
      (candidate.decode.colorSpace === "srgb" ||
        (candidate.decode.version !== undefined && candidate.decode.colorSpace === "linear")) &&
      candidate.decode.format === "rgba8" &&
      positiveSafeInteger(candidate.decode.height) &&
      positiveSafeInteger(candidate.decode.width) &&
      safeProduct(candidate.decode.width, candidate.decode.height, 4) !== null &&
      (safeProduct(candidate.decode.width, candidate.decode.height, 4) as number) <=
        STREAMING_DEPENDENCY_DECODED_MAX_BYTES &&
      (candidate.path ===
        `immutable/representative-streaming-ktx2-${candidate.sha256 as string}.ktx2` ||
        ((candidate.decode.version === 1 || candidate.decode.version === 2) &&
          candidate.path === `immutable/streaming-texture-${candidate.sha256 as string}.ktx2`))
    ) {
      resource = Object.freeze({
        bytes: candidate.bytes as number,
        decode: Object.freeze({
          colorSpace: candidate.decode.colorSpace as "srgb" | "linear",
          format: "rgba8",
          height: candidate.decode.height as number,
          ...(candidate.decode.version === 1
            ? { version: 1 as const }
            : candidate.decode.version === 2
              ? { version: 2 as const, mipLevelCount: candidate.decode.mipLevelCount as number }
              : {}),
          width: candidate.decode.width as number,
        }),
        dependencies: Object.freeze([...dependencyIds]),
        format: "ktx2",
        path: candidate.path as string,
        resourceId: candidate.resourceId as string,
        sha256: candidate.sha256 as string,
      });
    } else if (
      candidate.format === "meshopt" &&
      Object.keys(candidate).sort().join(",") ===
        "bytes,decode,dependencies,format,path,resourceId,sha256" &&
      record(candidate.decode) &&
      Object.keys(candidate.decode).sort().join(",") === "count,layout,mode,stride,version" &&
      candidate.decode.version === 1 &&
      candidate.decode.mode === "ATTRIBUTES" &&
      candidate.decode.layout === "position-normal-uv-f32" &&
      candidate.decode.stride === 32 &&
      positiveSafeInteger(candidate.decode.count) &&
      safeProduct(candidate.decode.count, 32) !== null &&
      (safeProduct(candidate.decode.count, 32) as number) <=
        STREAMING_DEPENDENCY_DECODED_MAX_BYTES &&
      dependencyIds.length === 1 &&
      resources.find((resource) => resource.resourceId === dependencyIds[0])?.format === "ktx2" &&
      candidate.path === `immutable/streaming-vertices-${candidate.sha256 as string}.meshopt`
    ) {
      resource = Object.freeze({
        bytes: candidate.bytes as number,
        decode: Object.freeze({
          count: candidate.decode.count as number,
          layout: "position-normal-uv-f32",
          mode: "ATTRIBUTES",
          stride: 32,
          version: 1,
        }),
        dependencies: Object.freeze([...dependencyIds]) as readonly [string],
        format: "meshopt",
        path: candidate.path as string,
        resourceId: candidate.resourceId as string,
        sha256: candidate.sha256 as string,
      });
    } else if (
      candidate.format === "meshopt" &&
      Object.keys(candidate).sort().join(",") ===
        "bytes,decode,dependencies,format,path,resourceId,sha256" &&
      record(candidate.decode) &&
      Object.keys(candidate.decode).sort().join(",") ===
        "count,indexFormat,mode,stride,version,vertexCount" &&
      candidate.decode.version === 1 &&
      candidate.decode.mode === "TRIANGLES" &&
      candidate.decode.indexFormat === "uint32" &&
      candidate.decode.stride === 4 &&
      positiveSafeInteger(candidate.decode.count) &&
      positiveSafeInteger(candidate.decode.vertexCount) &&
      candidate.decode.count % 3 === 0 &&
      safeProduct(candidate.decode.count, 4) !== null &&
      (safeProduct(candidate.decode.count, 4) as number) <=
        STREAMING_DEPENDENCY_DECODED_MAX_BYTES &&
      dependencyIds.length === 2 &&
      resources.find((resource) => resource.resourceId === dependencyIds[0])?.format === "ktx2" &&
      versionedVertexMatchesIndex(
        resources.find((resource) => resource.resourceId === dependencyIds[1]),
        dependencyIds[0],
        candidate.decode.vertexCount,
      ) &&
      candidate.path === `immutable/streaming-indices-${candidate.sha256 as string}.meshopt`
    ) {
      resource = Object.freeze({
        bytes: candidate.bytes as number,
        decode: Object.freeze({
          count: candidate.decode.count as number,
          indexFormat: "uint32",
          mode: "TRIANGLES",
          stride: 4,
          version: 1,
          vertexCount: candidate.decode.vertexCount as number,
        }),
        dependencies: Object.freeze([...dependencyIds]) as readonly [string, string],
        format: "meshopt",
        path: candidate.path as string,
        resourceId: candidate.resourceId as string,
        sha256: candidate.sha256 as string,
      });
    } else if (
      candidate.format === "meshopt" &&
      Object.keys(candidate).sort().join(",") ===
        "bytes,decode,dependencies,format,path,resourceId,sha256" &&
      record(candidate.decode) &&
      Object.keys(candidate.decode).sort().join(",") === "count,mode,stride" &&
      positiveSafeInteger(candidate.decode.count) &&
      candidate.decode.mode === "ATTRIBUTES" &&
      candidate.decode.stride === 12 &&
      candidate.decode.count === 3 &&
      safeProduct(candidate.decode.count, candidate.decode.stride) !== null &&
      (safeProduct(candidate.decode.count, candidate.decode.stride) as number) <=
        STREAMING_DEPENDENCY_DECODED_MAX_BYTES &&
      dependencyIds.length === 1 &&
      resources.find((resource) => resource.resourceId === dependencyIds[0])?.format === "ktx2" &&
      candidate.path ===
        `immutable/representative-streaming-meshopt-${candidate.sha256 as string}.meshopt`
    ) {
      resource = Object.freeze({
        bytes: candidate.bytes as number,
        decode: Object.freeze({
          count: candidate.decode.count as number,
          mode: "ATTRIBUTES",
          stride: 12,
        }),
        dependencies: Object.freeze([...dependencyIds]),
        format: "meshopt",
        path: candidate.path as string,
        resourceId: candidate.resourceId as string,
        sha256: candidate.sha256 as string,
      });
    } else {
      throw new Error("District dependency resource format is invalid");
    }
    expectedStreamingDependencyDecodedBytes(resource);
    ids.add(resource.resourceId);
    paths.add(resource.path);
    hashes.add(resource.sha256);
    previousId = resource.resourceId;
    resources.push(resource);
  }
  return resources;
}

function isVersionedVertexResource(
  resource: StreamingDependencyIndexEntry | undefined,
): resource is StreamingMeshoptVertexDependencyIndexEntry {
  return (
    resource?.format === "meshopt" &&
    "version" in resource.decode &&
    resource.decode.version === 1 &&
    resource.decode.mode === "ATTRIBUTES"
  );
}

function isVersionedIndexResource(
  resource: StreamingDependencyIndexEntry | undefined,
): resource is StreamingMeshoptIndexDependencyIndexEntry {
  return (
    resource?.format === "meshopt" &&
    "version" in resource.decode &&
    resource.decode.version === 1 &&
    resource.decode.mode === "TRIANGLES"
  );
}

function versionedVertexMatchesIndex(
  resource: StreamingDependencyIndexEntry | undefined,
  textureId: string | undefined,
  vertexCount: unknown,
): boolean {
  return (
    textureId !== undefined &&
    positiveSafeInteger(vertexCount) &&
    isVersionedVertexResource(resource) &&
    resource.decode.count === vertexCount &&
    resource.dependencies[0] === textureId
  );
}

function isVersionedTextureResource(
  resource: StreamingDependencyIndexEntry | undefined,
): resource is StreamingKtx2DependencyIndexEntry {
  return (
    resource?.format === "ktx2" && (resource.decode.version === 1 || resource.decode.version === 2)
  );
}

function isLinearTextureRoot(resource: StreamingDependencyIndexEntry | undefined): boolean {
  return (
    resource?.format === "ktx2" &&
    resource.decode.version !== undefined &&
    resource.decode.colorSpace === "linear"
  );
}

function validateCellDependencyTopology(
  cellId: unknown,
  roots: readonly string[],
  resources: readonly StreamingDependencyIndexEntry[],
  indexResourceIdByVertexResourceId: Map<string, string>,
): void {
  for (const rootId of roots) {
    const index = resources.find((resource) => resource.resourceId === rootId);
    if (isLinearTextureRoot(index)) continue;
    if (!isVersionedIndexResource(index)) {
      throw new Error(`District cell ${String(cellId)} dependency root is not an index resource`);
    }
    const [textureId, vertexId] = index.dependencies;
    const texture = resources.find((resource) => resource.resourceId === textureId);
    const vertex = resources.find((resource) => resource.resourceId === vertexId);
    if (
      textureId === undefined ||
      vertexId === undefined ||
      !isVersionedTextureResource(texture) ||
      !isVersionedVertexResource(vertex) ||
      vertex.dependencies.length !== 1 ||
      vertex.dependencies[0] !== textureId ||
      index.decode.vertexCount !== vertex.decode.count ||
      (indexResourceIdByVertexResourceId.has(vertexId) &&
        indexResourceIdByVertexResourceId.get(vertexId) !== index.resourceId)
    ) {
      throw new Error(`District cell ${String(cellId)} has an ambiguous mesh dependency graph`);
    }
    indexResourceIdByVertexResourceId.set(vertexId, index.resourceId);
  }
}

function collectDependencyClosure(
  resourceId: string,
  resources: readonly StreamingDependencyIndexEntry[],
  referenced: Set<string>,
): void {
  const resource = resources.find((candidate) => candidate.resourceId === resourceId);
  if (resource === undefined) throw new Error(`Dependency resource ${resourceId} is absent`);
  for (const dependencyId of resource.dependencies) {
    referenced.add(`closure:${dependencyId}`);
    collectDependencyClosure(dependencyId, resources, referenced);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function safeProduct(...factors: readonly unknown[]): number | null {
  let product = 1;
  for (const factor of factors) {
    if (!positiveSafeInteger(factor) || product > Number.MAX_SAFE_INTEGER / factor) return null;
    product *= factor;
  }
  return Number.isSafeInteger(product) ? product : null;
}

function worldVec3(value: unknown): value is readonly [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
  );
}

function coordinate(value: unknown): value is readonly [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((coordinate) => Number.isSafeInteger(coordinate) && coordinate >= 0)
  );
}

function orderedBounds(
  minimum: readonly [number, number, number],
  maximum: readonly [number, number, number],
): boolean {
  return minimum[0] < maximum[0] && minimum[1] < maximum[1] && minimum[2] < maximum[2];
}

function safeRelativePath(path: string): boolean {
  return (
    path !== "" &&
    !path.startsWith("/") &&
    !path.startsWith("\\") &&
    !path.includes("\\") &&
    !path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  );
}
