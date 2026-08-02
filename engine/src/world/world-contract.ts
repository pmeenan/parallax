export type WorldVec3 = readonly [number, number, number];

export interface WorldBounds {
  readonly maximum: WorldVec3;
  readonly minimum: WorldVec3;
}

export interface GreyboxMaterial {
  readonly color: readonly [number, number, number];
  readonly id: string;
}

export interface GreyboxPrimitive {
  readonly center: WorldVec3;
  readonly materialId: string;
  readonly rotationYRadians: number;
  readonly size: WorldVec3;
}

export interface GreyboxTriangleBoxPayload {
  readonly kind: "triangle-boxes";
  readonly primitives: readonly GreyboxPrimitive[];
}

export interface GreyboxHeightfieldGridPayload {
  readonly kind: "heightfield-grid";
  readonly materialId: string;
  readonly sampleStride: 1 | 2 | 4 | 8 | 16;
}

export interface GreyboxMeshletPayload {
  readonly artifactId: string;
  readonly elementCount: number;
  readonly kind: "meshlets";
}

export interface GreyboxGaussianSplatPayload {
  readonly artifactId: string;
  readonly elementCount: number;
  readonly kind: "gaussian-splats";
}

export type GreyboxRepresentationPayload =
  | GreyboxGaussianSplatPayload
  | GreyboxHeightfieldGridPayload
  | GreyboxMeshletPayload
  | GreyboxTriangleBoxPayload;

export interface GreyboxLodTier {
  readonly complexityScore: number;
  readonly maxDistanceMeters: number;
  readonly representations: readonly GreyboxRepresentationPayload[];
  readonly tier: 0 | 1 | 2;
}

export interface GreyboxHeightfieldCollider {
  readonly columns: number;
  readonly heights: readonly number[];
  readonly kind: "heightfield";
  readonly origin: WorldVec3;
  readonly rows: number;
  readonly sampleSpacingMeters: number;
}

export interface GreyboxAabbCollider {
  readonly center: WorldVec3;
  readonly id: string;
  readonly kind: "aabb";
  readonly size: WorldVec3;
}

export interface GreyboxCollisionPayload {
  readonly heightfield: GreyboxHeightfieldCollider;
  readonly obstacles: readonly GreyboxAabbCollider[];
}

export interface GreyboxCell {
  readonly bounds: WorldBounds;
  readonly collision: GreyboxCollisionPayload;
  readonly coordinate: readonly [number, number];
  readonly id: string;
  readonly lods: readonly [GreyboxLodTier, GreyboxLodTier, GreyboxLodTier];
  readonly neighbors: readonly string[];
  readonly tags: readonly string[];
}

export interface GreyboxWorldMarker {
  readonly id: string;
  readonly kind: "path" | "transition" | "vista";
  readonly position: WorldVec3;
  readonly tags: readonly string[];
}

export interface GreyboxDistrict {
  readonly bounds: WorldBounds;
  readonly cellSizeMeters: number;
  readonly cells: readonly GreyboxCell[];
  readonly generator: Readonly<{
    seed: number;
    version: number;
  }>;
  readonly id: string;
  readonly lodHysteresisMeters: number;
  readonly markers: readonly GreyboxWorldMarker[];
  readonly materials: readonly GreyboxMaterial[];
  readonly schemaVersion: 1;
  readonly standardTraversalMetersPerSecond: number;
  readonly units: "meters";
}

export interface GreyboxSceneConfig {
  readonly camera: Readonly<{
    alpha: number;
    beta: number;
    minZ: number;
    radius: number;
    target: WorldVec3;
  }>;
  readonly clearColor: readonly [number, number, number, number];
  readonly lighting: Readonly<{
    cycleSeconds: number;
    initialPhase: number;
    weather: "clear" | "overcast" | "storm";
  }>;
  readonly lodObservers: readonly WorldVec3[];
  readonly world: GreyboxDistrict;
}

export interface GreyboxWorldValidationSummary {
  readonly cellCount: number;
  readonly colliderCount: number;
  readonly heightSampleCount: number;
  readonly lodPrimitiveCounts: readonly [number, number, number];
  readonly markerCount: number;
}

export interface SelectedGreyboxCellLod {
  readonly distanceMeters: number;
  readonly lod: GreyboxLodTier | null;
}

export interface GreyboxLodSelectionOptions {
  readonly hysteresisMeters?: number;
  readonly previousTier?: 0 | 1 | 2;
}

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function validateVec3(value: WorldVec3, label: string, positive = false): void {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} must be a vec3`);
  for (const [component, current] of value.entries()) {
    finite(current, `${label}[${component}]`);
    if (positive && current <= 0) throw new Error(`${label}[${component}] must be positive`);
  }
}

function assertUnique(id: string, ids: Set<string>, label: string): void {
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(`${label} id must not be empty`);
  }
  if (ids.has(id)) throw new Error(`${label} id is duplicated: ${id}`);
  ids.add(id);
}

export function parseGreyboxMaterials(input: unknown): readonly GreyboxMaterial[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("Greybox district requires materials");
  }
  const materialIds = new Set<string>();
  const materials = input.map((candidate, index): GreyboxMaterial => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate) ||
      Object.keys(candidate).sort().join(",") !== "color,id"
    ) {
      throw new Error(`material ${index} requires exact color and id keys`);
    }
    const material = candidate as Record<string, unknown>;
    if (typeof material.id !== "string" || material.id.trim() === "") {
      throw new Error("material id must not be empty");
    }
    assertUnique(material.id, materialIds, "material");
    if (
      !Array.isArray(material.color) ||
      material.color.length !== 3 ||
      material.color.some(
        (component) =>
          typeof component !== "number" ||
          !Number.isFinite(component) ||
          component < 0 ||
          component > 1,
      )
    ) {
      throw new Error(`material ${material.id} color must be a normalized finite vec3`);
    }
    return Object.freeze({
      color: Object.freeze([...material.color]) as readonly [number, number, number],
      id: material.id,
    });
  });
  return Object.freeze(materials);
}

export function validateGreyboxDistrict(district: GreyboxDistrict): GreyboxWorldValidationSummary {
  if (district.schemaVersion !== 1) throw new Error("Unsupported greybox district schema");
  if (district.units !== "meters") throw new Error("Greybox district units must be meters");
  if (typeof district.id !== "string" || district.id.trim() === "") {
    throw new Error("Greybox district id must not be empty");
  }
  if (
    !Number.isInteger(district.generator.seed) ||
    !Number.isInteger(district.generator.version) ||
    district.generator.version <= 0
  ) {
    throw new Error("Greybox district generator identity is invalid");
  }
  finite(district.cellSizeMeters, "cellSizeMeters");
  finite(district.lodHysteresisMeters, "lodHysteresisMeters");
  finite(district.standardTraversalMetersPerSecond, "standardTraversalMetersPerSecond");
  if (district.cellSizeMeters <= 0) throw new Error("cellSizeMeters must be positive");
  if (district.lodHysteresisMeters < 0) throw new Error("lodHysteresisMeters must be non-negative");
  if (district.standardTraversalMetersPerSecond <= 0) {
    throw new Error("standardTraversalMetersPerSecond must be positive");
  }
  validateVec3(district.bounds.minimum, "district.bounds.minimum");
  validateVec3(district.bounds.maximum, "district.bounds.maximum");
  if (
    district.bounds.minimum.some(
      (minimum, component) => minimum >= (district.bounds.maximum[component] ?? minimum),
    )
  ) {
    throw new Error("Greybox district bounds must have positive extents");
  }

  const materialIds = new Set(parseGreyboxMaterials(district.materials).map(({ id }) => id));

  const cellIds = new Set<string>();
  const cellCoordinates = new Set<string>();
  const cellsById = new Map<string, GreyboxCell>();
  const lodPrimitiveCounts: [number, number, number] = [0, 0, 0];
  let colliderCount = 0;
  let heightSampleCount = 0;
  for (const cell of district.cells) {
    assertUnique(cell.id, cellIds, "cell");
    cellsById.set(cell.id, cell);
    validateVec3(cell.bounds.minimum, `cell ${cell.id} bounds.minimum`);
    validateVec3(cell.bounds.maximum, `cell ${cell.id} bounds.maximum`);
    if (
      cell.bounds.minimum.some(
        (minimum, component) => minimum >= (cell.bounds.maximum[component] ?? minimum),
      ) ||
      cell.bounds.minimum.some(
        (minimum, component) => minimum < (district.bounds.minimum[component] ?? minimum),
      ) ||
      cell.bounds.maximum.some(
        (maximum, component) => maximum > (district.bounds.maximum[component] ?? maximum),
      )
    ) {
      throw new Error(`cell ${cell.id} bounds are invalid or outside the district`);
    }
    if (
      !Array.isArray(cell.coordinate) ||
      cell.coordinate.length !== 2 ||
      cell.coordinate.some((component) => !Number.isInteger(component))
    ) {
      throw new Error(`cell ${cell.id} coordinate is invalid`);
    }
    const coordinateKey = `${cell.coordinate[0]},${cell.coordinate[1]}`;
    if (cellCoordinates.has(coordinateKey)) {
      throw new Error(`cell coordinate is duplicated: ${coordinateKey}`);
    }
    cellCoordinates.add(coordinateKey);
    if (
      !Array.isArray(cell.tags) ||
      cell.tags.some((tag) => typeof tag !== "string" || tag.trim() === "")
    ) {
      throw new Error(`cell ${cell.id} tags are invalid`);
    }
    if (cell.lods.length !== 3) throw new Error(`cell ${cell.id} requires exactly three LOD tiers`);
    let previousDistance = 0;
    let previousComplexityScore = Number.POSITIVE_INFINITY;
    for (const [tier, lod] of cell.lods.entries()) {
      if (lod.tier !== tier) throw new Error(`cell ${cell.id} LOD tiers must be ordered`);
      finite(lod.maxDistanceMeters, `cell ${cell.id} LOD ${tier} maxDistanceMeters`);
      finite(lod.complexityScore, `cell ${cell.id} LOD ${tier} complexityScore`);
      if (lod.maxDistanceMeters <= previousDistance) {
        throw new Error(`cell ${cell.id} LOD distances must increase`);
      }
      if (lod.complexityScore <= 0 || lod.complexityScore > previousComplexityScore) {
        throw new Error(`cell ${cell.id} LOD complexity scores must be positive and not increase`);
      }
      if (lod.representations.length === 0) {
        throw new Error(`cell ${cell.id} LOD ${tier} requires a representation`);
      }
      previousDistance = lod.maxDistanceMeters;
      previousComplexityScore = lod.complexityScore;
      for (const representation of lod.representations) {
        switch (representation.kind) {
          case "triangle-boxes":
            lodPrimitiveCounts[tier] += representation.primitives.length;
            for (const [index, primitive] of representation.primitives.entries()) {
              validateVec3(
                primitive.center,
                `cell ${cell.id} LOD ${tier} primitive ${index} center`,
              );
              validateVec3(
                primitive.size,
                `cell ${cell.id} LOD ${tier} primitive ${index} size`,
                true,
              );
              finite(
                primitive.rotationYRadians,
                `cell ${cell.id} LOD ${tier} primitive ${index} rotationYRadians`,
              );
              if (!materialIds.has(primitive.materialId)) {
                throw new Error(
                  `cell ${cell.id} references unknown material ${primitive.materialId}`,
                );
              }
            }
            break;
          case "heightfield-grid":
            if (!materialIds.has(representation.materialId)) {
              throw new Error(
                `cell ${cell.id} references unknown material ${representation.materialId}`,
              );
            }
            if (![1, 2, 4, 8, 16].includes(representation.sampleStride)) {
              throw new Error(`cell ${cell.id} has an invalid heightfield-grid stride`);
            }
            break;
          case "gaussian-splats":
          case "meshlets":
            if (representation.artifactId === "") {
              throw new Error(`cell ${cell.id} LOD ${tier} has an empty artifact id`);
            }
            finite(representation.elementCount, `cell ${cell.id} LOD ${tier} elementCount`);
            if (
              !Number.isInteger(representation.elementCount) ||
              representation.elementCount <= 0
            ) {
              throw new Error(`cell ${cell.id} LOD ${tier} has an invalid element count`);
            }
            break;
          default:
            throw new Error(`cell ${cell.id} LOD ${tier} has an unsupported representation`);
        }
      }
    }

    const heightfield = cell.collision.heightfield;
    if (
      heightfield.kind !== "heightfield" ||
      heightfield.columns < 2 ||
      heightfield.rows < 2 ||
      !Number.isInteger(heightfield.columns) ||
      !Number.isInteger(heightfield.rows) ||
      heightfield.heights.length !== heightfield.columns * heightfield.rows
    ) {
      throw new Error(`cell ${cell.id} has an invalid collision heightfield`);
    }
    validateVec3(heightfield.origin, `cell ${cell.id} collision heightfield origin`);
    finite(heightfield.sampleSpacingMeters, `cell ${cell.id} collision sample spacing`);
    if (heightfield.sampleSpacingMeters <= 0) {
      throw new Error(`cell ${cell.id} collision sample spacing must be positive`);
    }
    if (
      heightfield.origin[0] !== cell.bounds.minimum[0] ||
      heightfield.origin[2] !== cell.bounds.minimum[2] ||
      (heightfield.columns - 1) * heightfield.sampleSpacingMeters !==
        cell.bounds.maximum[0] - cell.bounds.minimum[0] ||
      (heightfield.rows - 1) * heightfield.sampleSpacingMeters !==
        cell.bounds.maximum[2] - cell.bounds.minimum[2]
    ) {
      throw new Error(`cell ${cell.id} collision heightfield does not cover its bounds`);
    }
    for (const lod of cell.lods) {
      for (const representation of lod.representations) {
        if (
          representation.kind === "heightfield-grid" &&
          ((heightfield.columns - 1) % representation.sampleStride !== 0 ||
            (heightfield.rows - 1) % representation.sampleStride !== 0)
        ) {
          throw new Error(`cell ${cell.id} heightfield-grid stride does not divide its intervals`);
        }
      }
    }
    for (const height of heightfield.heights) finite(height, `cell ${cell.id} collision height`);
    heightSampleCount += heightfield.heights.length;
    const obstacleIds = new Set<string>();
    for (const obstacle of cell.collision.obstacles) {
      if (obstacle.kind !== "aabb") throw new Error(`cell ${cell.id} has an invalid collider kind`);
      assertUnique(obstacle.id, obstacleIds, `cell ${cell.id} collider`);
      validateVec3(obstacle.center, `collider ${obstacle.id} center`);
      validateVec3(obstacle.size, `collider ${obstacle.id} size`, true);
    }
    colliderCount += cell.collision.obstacles.length;
  }
  if (cellIds.size === 0) throw new Error("Greybox district requires cells");
  for (const cell of district.cells) {
    const neighbors = new Set<string>();
    for (const neighbor of cell.neighbors) {
      if (typeof neighbor !== "string") throw new Error(`cell ${cell.id} has an invalid neighbor`);
      if (neighbor === cell.id || neighbors.has(neighbor)) {
        throw new Error(`cell ${cell.id} has a duplicate or self neighbor ${neighbor}`);
      }
      neighbors.add(neighbor);
      if (!cellIds.has(neighbor))
        throw new Error(`cell ${cell.id} has unknown neighbor ${neighbor}`);
      if (!cellsById.get(neighbor)?.neighbors.includes(cell.id)) {
        throw new Error(`cell ${cell.id} neighbor ${neighbor} is not reciprocal`);
      }
    }
  }

  const markerIds = new Set<string>();
  for (const marker of district.markers) {
    assertUnique(marker.id, markerIds, "marker");
    if (marker.kind !== "path" && marker.kind !== "transition" && marker.kind !== "vista") {
      throw new Error(`marker ${marker.id} has an invalid kind`);
    }
    if (
      !Array.isArray(marker.tags) ||
      marker.tags.some((tag) => typeof tag !== "string" || tag.trim() === "")
    ) {
      throw new Error(`marker ${marker.id} tags are invalid`);
    }
    validateVec3(marker.position, `marker ${marker.id} position`);
  }

  return Object.freeze({
    cellCount: district.cells.length,
    colliderCount,
    heightSampleCount,
    lodPrimitiveCounts: Object.freeze(lodPrimitiveCounts),
    markerCount: district.markers.length,
  });
}

export function selectGreyboxCellLod(
  cell: GreyboxCell,
  observers: readonly WorldVec3[],
  options: GreyboxLodSelectionOptions = {},
): SelectedGreyboxCellLod {
  if (observers.length === 0) throw new Error("LOD selection requires at least one observer");
  const distanceMeters = Math.min(
    ...observers.map((observer) => {
      validateVec3(observer, "LOD observer");
      const nearestX = Math.max(
        cell.bounds.minimum[0],
        Math.min(observer[0], cell.bounds.maximum[0]),
      );
      const nearestZ = Math.max(
        cell.bounds.minimum[2],
        Math.min(observer[2], cell.bounds.maximum[2]),
      );
      return Math.hypot(observer[0] - nearestX, observer[2] - nearestZ);
    }),
  );
  const nominal = cell.lods.find((candidate) => distanceMeters <= candidate.maxDistanceMeters);
  const previousTier = options.previousTier;
  const hysteresisMeters = options.hysteresisMeters ?? 0;
  finite(hysteresisMeters, "LOD hysteresisMeters");
  if (hysteresisMeters < 0) throw new Error("LOD hysteresisMeters must be non-negative");

  if (previousTier !== undefined) {
    const previous = cell.lods[previousTier];
    if (nominal === undefined || nominal.tier > previousTier) {
      if (distanceMeters <= previous.maxDistanceMeters + hysteresisMeters) {
        return Object.freeze({ distanceMeters, lod: previous });
      }
    } else if (nominal.tier < previousTier) {
      const finerBoundary = cell.lods[previousTier - 1]?.maxDistanceMeters ?? 0;
      if (distanceMeters >= finerBoundary - hysteresisMeters) {
        return Object.freeze({ distanceMeters, lod: previous });
      }
    }
  }
  return Object.freeze({ distanceMeters, lod: nominal ?? null });
}
