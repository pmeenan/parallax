import { DISTRICT_1_STONES } from "./district-1-stones.data";
import { DISTRICT_1_ID } from "./district-identity";
import type { GreyboxDistrictSpec } from "./greybox-spec";
import { freezeGreyboxData } from "./greybox-spec";
import { createStoneAssemblyPlacements } from "./stone-assembly";

const absRange = (axis: "x" | "z", minimum?: number, maximum?: number) =>
  ({
    axis,
    kind: "absolute-axis-range",
    ...(maximum === undefined ? {} : { maximum }),
    ...(minimum === undefined ? {} : { minimum }),
  }) as const;
const axisRange = (axis: "x" | "z", minimum?: number, maximum?: number) =>
  ({
    axis,
    kind: "axis-range",
    ...(maximum === undefined ? {} : { maximum }),
    ...(minimum === undefined ? {} : { minimum }),
  }) as const;
const all = (...conditions: GreyboxDistrictSpec["world"]["zones"][number]["match"][]) =>
  ({ conditions, kind: "all" }) as const;

const DISTRICT_1_BASE_SPEC = freezeGreyboxData({
  descriptorVersion: 1,
  features: [
    {
      collision: false,
      kind: "oriented-path",
      materialId: "path",
      northSouthWhen: absRange("x", 0, 128),
      tag: "path",
      thicknessMeters: 0.2,
      widthMeters: 18,
    },
    {
      collision: true,
      count: 7,
      depth: { base: 12, hashSalt: 37, step: 4, variants: 3 },
      height: { base: 8, hashSalt: 53, step: 3, variants: 3 },
      kind: "building-cluster",
      materialId: "stone",
      offsetRangeMeters: 80,
      offsetSaltX: 0x97d3,
      offsetSaltZ: 0x63ab,
      prefix: "keep",
      rotationSalt: 71,
      rotationSteps: 4,
      tag: "castle",
      width: { base: 12, hashSalt: 19, step: 4, variants: 4 },
    },
    {
      collision: false,
      kind: "surface",
      materialId: "water",
      size: [220, 0.5, 220],
      tag: "moat",
      terrainOffsetY: -0.35,
    },
    {
      collision: true,
      count: 5,
      depth: { base: 12, hashSalt: 37, step: 4, variants: 3 },
      height: { base: 8, hashSalt: 53, step: 3, variants: 3 },
      kind: "building-cluster",
      materialId: "wood",
      offsetRangeMeters: 80,
      offsetSaltX: 0x97d3,
      offsetSaltZ: 0x63ab,
      prefix: "house",
      rotationSalt: 71,
      rotationSteps: 4,
      tag: "village",
      width: { base: 12, hashSalt: 19, step: 4, variants: 4 },
    },
    {
      collision: false,
      count: 6,
      kind: "parallel-stripes",
      materialId: "field",
      size: [220, 0.7, 12],
      spacingMeters: 36,
      startOffsetMeters: -90,
      tag: "fields",
      terrainOffsetY: 0.35,
    },
    {
      collision: true,
      count: 7,
      foliageMaterialId: "foliage",
      foliageSize: [10, 10, 10],
      height: { base: 10, hashSalt: 101, variants: 5 },
      kind: "tree-cluster",
      offsetRangeMeters: 80,
      offsetSaltX: 0x1d7b,
      offsetSaltZ: 0xc33f,
      prefix: "tree",
      tag: "forest",
      trunkMaterialId: "wood",
      trunkWidthMeters: 2.5,
    },
    {
      collision: false,
      fixedY: -2.25,
      kind: "surface",
      materialId: "water",
      size: [256, 0.5, 256],
      tag: "shoreline",
    },
  ],
  generator: { seed: 0x5e_ed_d1_01, version: 1 },
  lodTiers: [
    { featureSelection: { kind: "all" }, maxDistanceMeters: 320, sampleStride: 1, tier: 0 },
    {
      featureSelection: { kind: "every-nth", offset: 0, step: 2 },
      maxDistanceMeters: 960,
      sampleStride: 2,
      tier: 1,
    },
    {
      featureSelection: {
        kind: "first-for-tags",
        tags: ["castle", "forest", "shoreline"],
      },
      maxDistanceMeters: 4_096,
      sampleStride: 4,
      tier: 2,
    },
  ],
  markers: [
    {
      id: "d1-player-spawn-waystone",
      kind: "path",
      position: [0, 0],
      tags: ["castle", "landmark", "player-spawn", "waystone"],
    },
    {
      id: "d1-landmark-village-square",
      kind: "path",
      position: [-640, -96],
      tags: ["landmark", "village", "waystone"],
    },
    {
      id: "d1-landmark-forest-edge",
      kind: "path",
      position: [0, 768],
      tags: ["forest", "landmark", "waystone"],
    },
    {
      id: "d1-path-castle-to-shore",
      kind: "path",
      position: [0, -1_024],
      tags: ["castle", "shoreline"],
    },
    {
      id: "d1-path-castle-to-forest",
      kind: "path",
      position: [0, 1_024],
      tags: ["castle", "forest"],
    },
    {
      id: "d1-path-village-to-fields",
      kind: "path",
      position: [-640, -768],
      tags: ["village", "fields"],
    },
    {
      id: "d1-schedule-west-forge",
      kind: "path",
      position: [-752, -96],
      tags: ["village", "forge", "npc-schedule:west-craft", "npc-stop:0"],
    },
    {
      id: "d1-schedule-west-market",
      kind: "path",
      position: [-640, -96],
      tags: ["village", "market", "npc-schedule:west-craft", "npc-stop:1"],
    },
    {
      id: "d1-schedule-west-hearth",
      kind: "path",
      position: [-528, -96],
      tags: ["village", "hearth", "npc-schedule:west-craft", "npc-stop:2"],
    },
    {
      id: "d1-schedule-west-gate",
      kind: "path",
      position: [-416, -96],
      tags: ["village", "gate", "npc-schedule:west-craft", "npc-stop:3"],
    },
    {
      id: "d1-schedule-east-gate",
      kind: "path",
      position: [416, 96],
      tags: ["village", "gate", "npc-schedule:east-craft", "npc-stop:0"],
    },
    {
      id: "d1-schedule-east-hearth",
      kind: "path",
      position: [528, 96],
      tags: ["village", "hearth", "npc-schedule:east-craft", "npc-stop:1"],
    },
    {
      id: "d1-schedule-east-market",
      kind: "path",
      position: [640, 96],
      tags: ["village", "market", "npc-schedule:east-craft", "npc-stop:2"],
    },
    {
      id: "d1-schedule-east-alembic",
      kind: "path",
      position: [752, 96],
      tags: ["village", "alembic", "npc-schedule:east-craft", "npc-stop:3"],
    },
    {
      id: "d1-transition-castle-catacomb",
      kind: "transition",
      position: [32, 32],
      tags: ["d2", "entrance", "castle", "landmark"],
    },
    {
      id: "d1-transition-village-well",
      kind: "transition",
      position: [-512, -128],
      tags: ["d2", "entrance", "village", "landmark"],
    },
    {
      id: "d1-transition-forest-ruin",
      kind: "transition",
      position: [640, 1_280],
      tags: ["d2", "entrance", "forest", "landmark"],
    },
    {
      fixedY: 120,
      id: "d1-vista-northern-mountains",
      kind: "vista",
      position: [0, 2_560],
      tags: ["mountains", "non-playable"],
    },
  ],
  materials: [
    { color: [0.31, 0.52, 0.24], id: "ground" },
    { color: [0.62, 0.65, 0.68], id: "stone" },
    { color: [0.48, 0.28, 0.12], id: "wood" },
    { color: [0.72, 0.19, 0.1], id: "roof" },
    { color: [0.08, 0.43, 0.68], id: "water" },
    { color: [0.82, 0.68, 0.19], id: "field" },
    { color: [0.12, 0.42, 0.16], id: "foliage" },
    { color: [0.58, 0.43, 0.27], id: "path" },
  ],
  scene: {
    camera: {
      alpha: -Math.PI / 2,
      beta: Math.PI / 2.8,
      minZ: 5,
      radius: 1_100,
      target: [0, 12, 0],
    },
    clearColor: [0.32, 0.64, 0.92, 1],
    lighting: { cycleSeconds: 900, initialPhase: 0.25, weather: "clear" },
    lodObservers: [[0, 12, -900]],
  },
  terrain: {
    // Finished courtyard: exact level 16m grid square, smoothly graded over
    // 32m outside it. Render and collision share this world-coordinate field.
    levelPads: [{ minimum: [0, 0], maximum: [16, 16], height: 18.97375, transitionMeters: 32 }],
    layers: [
      {
        afterHeight: 2,
        axis: "z",
        beforeHeight: -2,
        from: -2_048,
        fromHeight: -2,
        kind: "axis-gradient",
        to: -1_536,
        toHeight: 2,
      },
      { center: [0, 0], kind: "radial-falloff", peakHeight: 18, radius: 480 },
      {
        afterHeight: 14,
        axis: "z",
        beforeHeight: 0,
        from: 768,
        fromHeight: 0,
        kind: "axis-gradient",
        to: 2_048,
        toHeight: 14,
      },
      { amplitude: 2.25, gridSizeMeters: 128, kind: "value-noise", salt: 0x52a9 },
    ],
    materialId: "ground",
    roundingDecimalPlaces: 2,
  },
  world: {
    bounds: { maximum: [2_048, 256, 2_048], minimum: [-2_048, -32, -2_048] },
    cellSizeMeters: 256,
    collisionSampleSpacingMeters: 16,
    fallbackTag: "grassland",
    id: DISTRICT_1_ID,
    lodHysteresisMeters: 64,
    standardTraversalMetersPerSecond: 12,
    zones: [
      { match: all(absRange("x", 0, 128), absRange("z", 0, 128)), tag: "castle" },
      {
        match: all(absRange("x", 0, 384), absRange("z", 0, 384), {
          condition: all(absRange("x", 0, 128), absRange("z", 0, 128)),
          kind: "not",
        }),
        tag: "moat",
      },
      {
        match: all(
          absRange("x", 0, 768),
          axisRange("z", -768, 640),
          {
            kind: "manhattan-range",
            minimum: 512,
          },
          {
            condition: all(absRange("x", 0, 384), absRange("z", 0, 384)),
            kind: "not",
          },
        ),
        tag: "village",
      },
      { match: axisRange("z", -1_536, -640), tag: "fields" },
      { match: axisRange("z", 768), tag: "forest" },
      { match: axisRange("z", undefined, -1_536), tag: "shoreline" },
      {
        match: {
          conditions: [absRange("x", 0, 128), all(absRange("z", 0, 128), absRange("x", 0, 1_280))],
          kind: "any",
        },
        tag: "path",
      },
    ],
  },
} satisfies GreyboxDistrictSpec);

export const DISTRICT_1_STONE_ASSEMBLY = createStoneAssemblyPlacements(
  DISTRICT_1_BASE_SPEC,
  DISTRICT_1_STONES,
  [6, 6],
  [198, 198],
  24,
);
export const DISTRICT_1_GREYBOX_SPEC = freezeGreyboxData({
  ...DISTRICT_1_BASE_SPEC,
  assetPlacements: DISTRICT_1_STONE_ASSEMBLY.placements,
} satisfies GreyboxDistrictSpec);
