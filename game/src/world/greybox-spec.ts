import type { GreyboxMaterial, WorldBounds, WorldVec3 } from "@parallax/engine";

export type SpatialExpression =
  | Readonly<{ axis: "x" | "z"; kind: "axis-range"; maximum?: number; minimum?: number }>
  | Readonly<{
      axis: "x" | "z";
      kind: "absolute-axis-range";
      maximum?: number;
      minimum?: number;
    }>
  | Readonly<{ kind: "manhattan-range"; maximum?: number; minimum?: number }>
  | Readonly<{ conditions: readonly SpatialExpression[]; kind: "all" }>
  | Readonly<{ conditions: readonly SpatialExpression[]; kind: "any" }>
  | Readonly<{ condition: SpatialExpression; kind: "not" }>;

export type TerrainLayerSpec =
  | Readonly<{
      afterHeight: number;
      axis: "x" | "z";
      beforeHeight: number;
      from: number;
      fromHeight: number;
      kind: "axis-gradient";
      to: number;
      toHeight: number;
    }>
  | Readonly<{
      center: readonly [number, number];
      kind: "radial-falloff";
      peakHeight: number;
      radius: number;
    }>
  | Readonly<{
      amplitude: number;
      gridSizeMeters: number;
      kind: "value-noise";
      salt: number;
    }>;

export interface ZoneRuleSpec {
  readonly match: SpatialExpression;
  readonly tag: string;
}

export interface CellBoxPlacementSpec {
  readonly collision: boolean;
  readonly id: string;
  readonly materialId: string;
  readonly offset: WorldVec3;
  readonly rotationYRadians?: number;
  readonly size: WorldVec3;
}

interface TaggedFeatureRuleSpec {
  readonly tag: string;
}

export type FeatureRuleSpec =
  | (TaggedFeatureRuleSpec &
      Readonly<{
        collision: boolean;
        count: number;
        depth: Readonly<{ base: number; hashSalt: number; step: number; variants: number }>;
        height: Readonly<{ base: number; hashSalt: number; step: number; variants: number }>;
        kind: "building-cluster";
        materialId: string;
        offsetRangeMeters: number;
        offsetSaltX: number;
        offsetSaltZ: number;
        prefix: string;
        rotationSteps: number;
        rotationSalt: number;
        width: Readonly<{ base: number; hashSalt: number; step: number; variants: number }>;
      }>)
  | (TaggedFeatureRuleSpec &
      Readonly<{
        boxes: readonly CellBoxPlacementSpec[];
        kind: "cell-boxes";
      }>)
  | (TaggedFeatureRuleSpec &
      Readonly<{
        collision: false;
        fixedY?: number;
        kind: "surface";
        materialId: string;
        size: WorldVec3;
        terrainOffsetY?: number;
      }>)
  | (TaggedFeatureRuleSpec &
      Readonly<{
        collision: false;
        kind: "oriented-path";
        materialId: string;
        northSouthWhen: SpatialExpression;
        thicknessMeters: number;
        widthMeters: number;
      }>)
  | (TaggedFeatureRuleSpec &
      Readonly<{
        collision: false;
        count: number;
        kind: "parallel-stripes";
        materialId: string;
        size: WorldVec3;
        spacingMeters: number;
        startOffsetMeters: number;
        terrainOffsetY: number;
      }>)
  | (TaggedFeatureRuleSpec &
      Readonly<{
        collision: true;
        count: number;
        foliageMaterialId: string;
        foliageSize: WorldVec3;
        height: Readonly<{ base: number; hashSalt: number; variants: number }>;
        kind: "tree-cluster";
        offsetRangeMeters: number;
        offsetSaltX: number;
        offsetSaltZ: number;
        prefix: string;
        trunkMaterialId: string;
        trunkWidthMeters: number;
      }>);

export type FeatureSelectionSpec =
  | Readonly<{ kind: "all" }>
  | Readonly<{ kind: "every-nth"; offset: number; step: number }>
  | Readonly<{ kind: "first-for-tags"; tags: readonly string[] }>;

export interface LodTierSpec {
  readonly featureSelection: FeatureSelectionSpec;
  readonly maxDistanceMeters: number;
  readonly sampleStride: 1 | 2 | 4 | 8 | 16;
  readonly tier: 0 | 1 | 2;
}

export interface WorldMarkerSpec {
  readonly fixedY?: number;
  readonly id: string;
  readonly kind: "path" | "transition" | "vista";
  readonly position: readonly [number, number];
  readonly tags: readonly string[];
}

export interface GreyboxDistrictSpec {
  readonly assetPlacements?: readonly {
    readonly id: string;
    readonly assetId: string;
    readonly variantId?: string;
    readonly baseColorFactor?: readonly [number, number, number];
    readonly scale?: number;
    readonly center: readonly [number, number];
    readonly heightOffset: number;
    /** Shared terrain sample for adjoining modules; defaults to each center. */
    readonly heightAnchor?: readonly [number, number];
    readonly rotationYRadians: number;
    readonly rotationXRadians?: number;
    readonly rotationZRadians?: number;
    readonly lodDistancesMeters: readonly [number, number];
  }[];
  readonly descriptorVersion: 1;
  readonly features: readonly FeatureRuleSpec[];
  readonly generator: Readonly<{ seed: number; version: number }>;
  readonly lodTiers: readonly [LodTierSpec, LodTierSpec, LodTierSpec];
  readonly markers: readonly WorldMarkerSpec[];
  readonly materials: readonly GreyboxMaterial[];
  readonly scene: Readonly<{
    camera: Readonly<{
      alpha: number;
      beta: number;
      minZ: number;
      radius: number;
      target: WorldVec3;
    }>;
    clearColor: readonly [number, number, number, number];
    lighting: Readonly<{
      cycleSeconds: number;
      initialPhase: number;
      weather: "clear" | "overcast" | "storm";
    }>;
    lodObservers: readonly WorldVec3[];
  }>;
  readonly terrain: Readonly<{
    layers: readonly TerrainLayerSpec[];
    /** Rectangular level ground with a smooth surrounding grading transition.
     * Intersecting cells retain collision-grid resolution in every terrain LOD.
     */
    levelPads?: readonly Readonly<{
      minimum: readonly [number, number];
      maximum: readonly [number, number];
      height: number;
      transitionMeters: number;
    }>[];
    materialId: string;
    roundingDecimalPlaces: number;
  }>;
  readonly world: Readonly<{
    bounds: WorldBounds;
    cellSizeMeters: number;
    collisionSampleSpacingMeters: number;
    fallbackTag: string;
    id: string;
    lodHysteresisMeters: number;
    standardTraversalMetersPerSecond: number;
    zones: readonly ZoneRuleSpec[];
  }>;
}

export function freezeGreyboxData<const T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeGreyboxData(nested);
  return Object.freeze(value);
}
