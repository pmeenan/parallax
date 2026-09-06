import {
  canonicalStreamingCellId,
  type GreyboxCell,
  type GreyboxDistrict,
  type GreyboxLodTier,
  type GreyboxPrimitive,
  type GreyboxSceneConfig,
  type WorldVec3,
} from "@parallax/engine";
import type {
  FeatureRuleSpec,
  FeatureSelectionSpec,
  GreyboxDistrictSpec,
  SpatialExpression,
  TerrainLayerSpec,
} from "./greybox-spec";

interface FeaturePrimitive {
  readonly collisionId?: string;
  readonly primitive: GreyboxPrimitive;
}

interface FeatureGroup {
  readonly primitives: readonly FeaturePrimitive[];
  readonly tag: string;
}

function vec3(x: number, y: number, z: number): WorldVec3 {
  return Object.freeze([x, y, z]);
}

function primitive(
  center: WorldVec3,
  size: WorldVec3,
  materialId: string,
  rotationYRadians = 0,
): GreyboxPrimitive {
  return Object.freeze({ center, materialId, rotationYRadians, size });
}

function coordinateValue(axis: "x" | "z", x: number, z: number): number {
  return axis === "x" ? x : z;
}

function matches(expression: SpatialExpression, x: number, z: number): boolean {
  switch (expression.kind) {
    case "axis-range": {
      const value = coordinateValue(expression.axis, x, z);
      return (
        value >= (expression.minimum ?? Number.NEGATIVE_INFINITY) &&
        value <= (expression.maximum ?? Number.POSITIVE_INFINITY)
      );
    }
    case "absolute-axis-range": {
      const value = Math.abs(coordinateValue(expression.axis, x, z));
      return (
        value >= (expression.minimum ?? 0) &&
        value <= (expression.maximum ?? Number.POSITIVE_INFINITY)
      );
    }
    case "manhattan-range": {
      const value = Math.abs(x) + Math.abs(z);
      return (
        value >= (expression.minimum ?? Number.NEGATIVE_INFINITY) &&
        value <= (expression.maximum ?? Number.POSITIVE_INFINITY)
      );
    }
    case "all":
      return expression.conditions.every((condition) => matches(condition, x, z));
    case "any":
      return expression.conditions.some((condition) => matches(condition, x, z));
    case "not":
      return !matches(expression.condition, x, z);
  }
}

function mix32(seed: number, x: number, z: number, salt: number): number {
  let value = Math.imul(x ^ seed, 0x45d9f3b);
  value ^= Math.imul(z ^ salt, 0x119de1f3);
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 16;
  return value >>> 0;
}

function layerHeight(layer: TerrainLayerSpec, seed: number, x: number, z: number): number {
  switch (layer.kind) {
    case "axis-gradient": {
      const value = coordinateValue(layer.axis, x, z);
      if (value <= layer.from) return layer.beforeHeight;
      if (value >= layer.to) return layer.afterHeight;
      const fraction = (value - layer.from) / (layer.to - layer.from);
      return layer.fromHeight * (1 - fraction) + layer.toHeight * fraction;
    }
    case "radial-falloff": {
      const distanceSquared = (x - layer.center[0]) ** 2 + (z - layer.center[1]) ** 2;
      return Math.max(0, layer.peakHeight * (1 - distanceSquared / layer.radius ** 2));
    }
    case "value-noise": {
      const gridX = Math.floor(x / layer.gridSizeMeters);
      const gridZ = Math.floor(z / layer.gridSizeMeters);
      const fractionX = (x - gridX * layer.gridSizeMeters) / layer.gridSizeMeters;
      const fractionZ = (z - gridZ * layer.gridSizeMeters) / layer.gridSizeMeters;
      const sample = (sampleX: number, sampleZ: number): number =>
        ((mix32(seed, sampleX, sampleZ, layer.salt) & 0x3ff) / 0x3ff) * 2 - 1;
      const south = sample(gridX, gridZ) * (1 - fractionX) + sample(gridX + 1, gridZ) * fractionX;
      const north =
        sample(gridX, gridZ + 1) * (1 - fractionX) + sample(gridX + 1, gridZ + 1) * fractionX;
      return (south * (1 - fractionZ) + north * fractionZ) * layer.amplitude;
    }
  }
}

export function sampleGreyboxTerrain(spec: GreyboxDistrictSpec, x: number, z: number): number {
  const height = spec.terrain.layers.reduce(
    (total, layer) => total + layerHeight(layer, spec.generator.seed, x, z),
    0,
  );
  const scale = 10 ** spec.terrain.roundingDecimalPlaces;
  let result = Math.round(height * scale) / scale;
  for (const pad of spec.terrain.levelPads ?? []) {
    const distance = Math.max(
      pad.minimum[0] - x,
      x - pad.maximum[0],
      pad.minimum[1] - z,
      z - pad.maximum[1],
      0,
    );
    if (distance >= pad.transitionMeters) continue;
    const t = distance / pad.transitionMeters;
    const blend = 1 - t * t * (3 - 2 * t);
    result += (pad.height - result) * blend;
  }
  return result;
}

function cellId(spec: GreyboxDistrictSpec, x: number, z: number): string {
  return canonicalStreamingCellId(spec.world.id, [x, z]);
}

function featureOffset(
  spec: GreyboxDistrictSpec,
  cellX: number,
  cellZ: number,
  index: number,
  salt: number,
  range: number,
): number {
  return (
    (mix32(spec.generator.seed, cellX + index * 17, cellZ - index * 11, salt) % (range * 2 + 1)) -
    range
  );
}

function hashedDimension(
  spec: GreyboxDistrictSpec,
  cellX: number,
  cellZ: number,
  index: number,
  dimension: Readonly<{ base: number; hashSalt: number; step: number; variants: number }>,
): number {
  return (
    dimension.base +
    (mix32(spec.generator.seed, cellX, cellZ, index + dimension.hashSalt) % dimension.variants) *
      dimension.step
  );
}

function createRuleFeatures(
  spec: GreyboxDistrictSpec,
  rule: FeatureRuleSpec,
  cellX: number,
  cellZ: number,
  centerX: number,
  centerZ: number,
): readonly FeatureGroup[] {
  switch (rule.kind) {
    case "cell-boxes": {
      const ground = sampleGreyboxTerrain(spec, centerX, centerZ);
      return Object.freeze([
        Object.freeze({
          primitives: Object.freeze(
            rule.boxes.map((box) =>
              Object.freeze({
                ...(box.collision
                  ? { collisionId: `${cellId(spec, cellX, cellZ)}-${box.id}` }
                  : {}),
                primitive: primitive(
                  vec3(centerX + box.offset[0], ground + box.offset[1], centerZ + box.offset[2]),
                  box.size,
                  box.materialId,
                  box.rotationYRadians,
                ),
              }),
            ),
          ),
          tag: rule.tag,
        }),
      ]);
    }
    case "oriented-path": {
      const northSouth = matches(rule.northSouthWhen, centerX, centerZ);
      return Object.freeze([
        Object.freeze({
          primitives: Object.freeze([
            Object.freeze({
              primitive: primitive(
                vec3(
                  centerX,
                  sampleGreyboxTerrain(spec, centerX, centerZ) + rule.thicknessMeters / 2,
                  centerZ,
                ),
                northSouth
                  ? vec3(rule.widthMeters, rule.thicknessMeters, spec.world.cellSizeMeters)
                  : vec3(spec.world.cellSizeMeters, rule.thicknessMeters, rule.widthMeters),
                rule.materialId,
              ),
            }),
          ]),
          tag: rule.tag,
        }),
      ]);
    }
    case "surface":
      return Object.freeze([
        Object.freeze({
          primitives: Object.freeze([
            Object.freeze({
              primitive: primitive(
                vec3(
                  centerX,
                  rule.fixedY ??
                    sampleGreyboxTerrain(spec, centerX, centerZ) + (rule.terrainOffsetY ?? 0),
                  centerZ,
                ),
                rule.size,
                rule.materialId,
              ),
            }),
          ]),
          tag: rule.tag,
        }),
      ]);
    case "building-cluster": {
      const groups: FeatureGroup[] = [];
      for (let index = 0; index < rule.count; index += 1) {
        const x =
          centerX +
          featureOffset(spec, cellX, cellZ, index, rule.offsetSaltX, rule.offsetRangeMeters);
        const z =
          centerZ +
          featureOffset(spec, cellX, cellZ, index, rule.offsetSaltZ, rule.offsetRangeMeters);
        const width = hashedDimension(spec, cellX, cellZ, index, rule.width);
        const depth = hashedDimension(spec, cellX, cellZ, index, rule.depth);
        const height = hashedDimension(spec, cellX, cellZ, index, rule.height);
        const definition = primitive(
          vec3(x, sampleGreyboxTerrain(spec, x, z) + height / 2, z),
          vec3(width, height, depth),
          rule.materialId,
          ((mix32(spec.generator.seed, cellX, cellZ, index + rule.rotationSalt) %
            rule.rotationSteps) *
            Math.PI *
            2) /
            rule.rotationSteps,
        );
        groups.push(
          Object.freeze({
            primitives: Object.freeze([
              Object.freeze({
                ...(rule.collision
                  ? {
                      collisionId: `${cellId(spec, cellX, cellZ)}-${rule.prefix}-${String(index).padStart(2, "0")}`,
                    }
                  : {}),
                primitive: definition,
              }),
            ]),
            tag: rule.tag,
          }),
        );
      }
      return Object.freeze(groups);
    }
    case "parallel-stripes": {
      const groups: FeatureGroup[] = [];
      for (let index = 0; index < rule.count; index += 1) {
        const z = centerZ + rule.startOffsetMeters + index * rule.spacingMeters;
        groups.push(
          Object.freeze({
            primitives: Object.freeze([
              Object.freeze({
                primitive: primitive(
                  vec3(centerX, sampleGreyboxTerrain(spec, centerX, z) + rule.terrainOffsetY, z),
                  rule.size,
                  rule.materialId,
                ),
              }),
            ]),
            tag: rule.tag,
          }),
        );
      }
      return Object.freeze(groups);
    }
    case "tree-cluster": {
      const groups: FeatureGroup[] = [];
      for (let index = 0; index < rule.count; index += 1) {
        const x =
          centerX +
          featureOffset(spec, cellX, cellZ, index, rule.offsetSaltX, rule.offsetRangeMeters);
        const z =
          centerZ +
          featureOffset(spec, cellX, cellZ, index, rule.offsetSaltZ, rule.offsetRangeMeters);
        const trunkHeight =
          rule.height.base +
          (mix32(spec.generator.seed, cellX, cellZ, index + rule.height.hashSalt) %
            rule.height.variants);
        const ground = sampleGreyboxTerrain(spec, x, z);
        groups.push(
          Object.freeze({
            primitives: Object.freeze([
              Object.freeze({
                collisionId: `${cellId(spec, cellX, cellZ)}-${rule.prefix}-${String(index).padStart(2, "0")}`,
                primitive: primitive(
                  vec3(x, ground + trunkHeight / 2, z),
                  vec3(rule.trunkWidthMeters, trunkHeight, rule.trunkWidthMeters),
                  rule.trunkMaterialId,
                ),
              }),
              Object.freeze({
                primitive: primitive(
                  vec3(x, ground + trunkHeight + rule.foliageSize[1] / 2, z),
                  rule.foliageSize,
                  rule.foliageMaterialId,
                ),
              }),
            ]),
            tag: rule.tag,
          }),
        );
      }
      return Object.freeze(groups);
    }
  }
}

function axisAlignedSize(definition: GreyboxPrimitive): WorldVec3 {
  const quarterTurns = definition.rotationYRadians / (Math.PI / 2);
  if (Number.isInteger(quarterTurns)) {
    return Math.abs(quarterTurns % 2) === 1
      ? vec3(definition.size[2], definition.size[1], definition.size[0])
      : definition.size;
  }
  const sine = Math.abs(Math.sin(definition.rotationYRadians));
  const cosine = Math.abs(Math.cos(definition.rotationYRadians));
  return vec3(
    definition.size[0] * cosine + definition.size[2] * sine,
    definition.size[1],
    definition.size[0] * sine + definition.size[2] * cosine,
  );
}

function selectFeatures(
  groups: readonly FeatureGroup[],
  selection: FeatureSelectionSpec,
): readonly GreyboxPrimitive[] {
  const flatten = (selected: readonly FeatureGroup[]): readonly GreyboxPrimitive[] =>
    Object.freeze(
      selected.flatMap(({ primitives }) =>
        primitives.map(({ primitive: definition }) => definition),
      ),
    );
  switch (selection.kind) {
    case "all":
      return flatten(groups);
    case "every-nth":
      return flatten(groups.filter((_, index) => index % selection.step === selection.offset));
    case "first-for-tags": {
      const first = groups.find(({ tag }) => selection.tags.includes(tag));
      return flatten(first === undefined ? [] : [first]);
    }
  }
}

function createCell(
  spec: GreyboxDistrictSpec,
  x: number,
  z: number,
  cellsX: number,
  cellsZ: number,
): GreyboxCell {
  const minimumX = spec.world.bounds.minimum[0] + x * spec.world.cellSizeMeters;
  const minimumZ = spec.world.bounds.minimum[2] + z * spec.world.cellSizeMeters;
  const centerX = minimumX + spec.world.cellSizeMeters / 2;
  const centerZ = minimumZ + spec.world.cellSizeMeters / 2;
  const matchingTags = spec.world.zones
    .filter(({ match }) => matches(match, centerX, centerZ))
    .map(({ tag }) => tag);
  const tags = Object.freeze(matchingTags.length === 0 ? [spec.world.fallbackTag] : matchingTags);
  const featureGroups = Object.freeze(
    spec.features.flatMap((rule) =>
      tags.includes(rule.tag) ? createRuleFeatures(spec, rule, x, z, centerX, centerZ) : [],
    ),
  );
  const features = Object.freeze(featureGroups.flatMap(({ primitives }) => primitives));
  const intervals = spec.world.cellSizeMeters / spec.world.collisionSampleSpacingMeters;
  if (!Number.isInteger(intervals) || intervals < 1) {
    throw new Error("Greybox collision sample spacing must divide the cell size");
  }
  const samplesPerAxis = intervals + 1;
  const heights = Object.freeze(
    Array.from({ length: samplesPerAxis * samplesPerAxis }, (_, index) => {
      const row = Math.floor(index / samplesPerAxis);
      const column = index % samplesPerAxis;
      return sampleGreyboxTerrain(
        spec,
        minimumX + column * spec.world.collisionSampleSpacingMeters,
        minimumZ + row * spec.world.collisionSampleSpacingMeters,
      );
    }),
  );
  // Coarse strides would discard a small authored pad's defining vertices.
  // Retain its existing collision lattice; surrounding cells keep normal LODs.
  const retainsLevelPad = (spec.terrain.levelPads ?? []).some(
    (pad) =>
      minimumX < pad.maximum[0] + pad.transitionMeters &&
      minimumX + spec.world.cellSizeMeters > pad.minimum[0] - pad.transitionMeters &&
      minimumZ < pad.maximum[1] + pad.transitionMeters &&
      minimumZ + spec.world.cellSizeMeters > pad.minimum[1] - pad.transitionMeters,
  );
  const lods = spec.lodTiers.map((tier): GreyboxLodTier => {
    const sampleStride = retainsLevelPad ? 1 : tier.sampleStride;
    const primitives = selectFeatures(featureGroups, tier.featureSelection);
    const terrainVertices = (intervals / sampleStride + 1) ** 2;
    return Object.freeze({
      complexityScore: terrainVertices + primitives.length * 8,
      maxDistanceMeters: tier.maxDistanceMeters,
      representations: Object.freeze([
        Object.freeze({
          kind: "heightfield-grid" as const,
          materialId: spec.terrain.materialId,
          sampleStride,
        }),
        Object.freeze({ kind: "triangle-boxes" as const, primitives }),
      ]),
      tier: tier.tier,
    });
  }) as [GreyboxLodTier, GreyboxLodTier, GreyboxLodTier];
  const neighbors: string[] = [];
  if (x > 0) neighbors.push(cellId(spec, x - 1, z));
  if (x + 1 < cellsX) neighbors.push(cellId(spec, x + 1, z));
  if (z > 0) neighbors.push(cellId(spec, x, z - 1));
  if (z + 1 < cellsZ) neighbors.push(cellId(spec, x, z + 1));

  return Object.freeze({
    bounds: Object.freeze({
      maximum: vec3(
        minimumX + spec.world.cellSizeMeters,
        spec.world.bounds.maximum[1],
        minimumZ + spec.world.cellSizeMeters,
      ),
      minimum: vec3(minimumX, spec.world.bounds.minimum[1], minimumZ),
    }),
    collision: Object.freeze({
      heightfield: Object.freeze({
        columns: samplesPerAxis,
        heights,
        kind: "heightfield" as const,
        origin: vec3(minimumX, 0, minimumZ),
        rows: samplesPerAxis,
        sampleSpacingMeters: spec.world.collisionSampleSpacingMeters,
      }),
      obstacles: Object.freeze(
        features.flatMap(({ collisionId, primitive: definition }) =>
          collisionId === undefined
            ? []
            : [
                Object.freeze({
                  center: definition.center,
                  id: collisionId,
                  kind: "aabb" as const,
                  size: axisAlignedSize(definition),
                }),
              ],
        ),
      ),
    }),
    coordinate: Object.freeze([x, z] as const),
    id: cellId(spec, x, z),
    lods: Object.freeze(lods),
    neighbors: Object.freeze(neighbors),
    tags,
  });
}

function createDistrict(spec: GreyboxDistrictSpec): GreyboxDistrict {
  const sizeX = spec.world.bounds.maximum[0] - spec.world.bounds.minimum[0];
  const sizeZ = spec.world.bounds.maximum[2] - spec.world.bounds.minimum[2];
  const cellsX = sizeX / spec.world.cellSizeMeters;
  const cellsZ = sizeZ / spec.world.cellSizeMeters;
  if (!Number.isInteger(cellsX) || !Number.isInteger(cellsZ) || cellsX < 1 || cellsZ < 1) {
    throw new Error("Greybox district bounds must contain whole cells");
  }
  const cells: GreyboxCell[] = [];
  for (let z = 0; z < cellsZ; z += 1) {
    for (let x = 0; x < cellsX; x += 1) {
      cells.push(createCell(spec, x, z, cellsX, cellsZ));
    }
  }

  return Object.freeze({
    bounds: spec.world.bounds,
    cellSizeMeters: spec.world.cellSizeMeters,
    cells: Object.freeze(cells),
    generator: spec.generator,
    id: spec.world.id,
    lodHysteresisMeters: spec.world.lodHysteresisMeters,
    markers: Object.freeze(
      spec.markers.map((marker) =>
        Object.freeze({
          id: marker.id,
          kind: marker.kind,
          position: vec3(
            marker.position[0],
            marker.fixedY ?? sampleGreyboxTerrain(spec, marker.position[0], marker.position[1]),
            marker.position[1],
          ),
          tags: marker.tags,
        }),
      ),
    ),
    materials: spec.materials,
    schemaVersion: 1,
    standardTraversalMetersPerSecond: spec.world.standardTraversalMetersPerSecond,
    units: "meters",
  });
}

export function createGreyboxScene(spec: GreyboxDistrictSpec): GreyboxSceneConfig {
  return Object.freeze({
    camera: spec.scene.camera,
    clearColor: spec.scene.clearColor,
    lighting: spec.scene.lighting,
    lodObservers: spec.scene.lodObservers,
    world: createDistrict(spec),
  });
}
