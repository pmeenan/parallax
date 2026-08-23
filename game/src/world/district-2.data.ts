import { DISTRICT_2_ID } from "./district-identity";
import type { CellBoxPlacementSpec, GreyboxDistrictSpec, SpatialExpression } from "./greybox-spec";
import { freezeGreyboxData } from "./greybox-spec";

const axisRange = (axis: "x" | "z", minimum?: number, maximum?: number) =>
  ({
    axis,
    kind: "axis-range",
    ...(maximum === undefined ? {} : { maximum }),
    ...(minimum === undefined ? {} : { minimum }),
  }) as const;
const all = (...conditions: readonly SpatialExpression[]) => ({ conditions, kind: "all" }) as const;

const ceiling = Object.freeze({
  collision: false,
  id: "ceiling",
  materialId: "ceiling-stone",
  offset: [0, 12, 0],
  size: [128, 2, 128],
} satisfies CellBoxPlacementSpec);
const northSouthPassage = freezeGreyboxData([
  ceiling,
  {
    collision: true,
    id: "west-wall",
    materialId: "wall-stone",
    offset: [-60, 6, 0],
    size: [8, 12, 128],
  },
  {
    collision: true,
    id: "east-wall",
    materialId: "wall-stone",
    offset: [60, 6, 0],
    size: [8, 12, 128],
  },
] satisfies readonly CellBoxPlacementSpec[]);
const eastWestPassage = freezeGreyboxData([
  ceiling,
  {
    collision: true,
    id: "south-wall",
    materialId: "wall-stone",
    offset: [0, 6, -60],
    size: [128, 12, 8],
  },
  {
    collision: true,
    id: "north-wall",
    materialId: "wall-stone",
    offset: [0, 6, 60],
    size: [128, 12, 8],
  },
] satisfies readonly CellBoxPlacementSpec[]);

export const DISTRICT_2_GREYBOX_SPEC = freezeGreyboxData({
  descriptorVersion: 1,
  features: [
    {
      boxes: [
        {
          collision: true,
          id: "sealed-rock",
          materialId: "unworked-rock",
          offset: [0, 8, 0],
          size: [128, 16, 128],
        },
      ],
      kind: "cell-boxes",
      tag: "sealed-rock",
    },
    { boxes: northSouthPassage, kind: "cell-boxes", tag: "north-south-passage" },
    { boxes: eastWestPassage, kind: "cell-boxes", tag: "east-west-passage" },
    {
      boxes: [
        ceiling,
        {
          collision: true,
          id: "south-east-wall",
          materialId: "wall-stone",
          offset: [0, 6, -60],
          size: [128, 12, 8],
        },
        {
          collision: true,
          id: "north-east-wall",
          materialId: "wall-stone",
          offset: [60, 6, 0],
          size: [8, 12, 128],
        },
      ],
      kind: "cell-boxes",
      tag: "forest-turn",
    },
    {
      boxes: [
        ceiling,
        {
          collision: true,
          id: "pillar-north-west",
          materialId: "carved-stone",
          offset: [-40, 6, 40],
          size: [8, 12, 8],
        },
        {
          collision: true,
          id: "pillar-north-east",
          materialId: "carved-stone",
          offset: [40, 6, 40],
          size: [8, 12, 8],
        },
        {
          collision: true,
          id: "pillar-south-west",
          materialId: "carved-stone",
          offset: [-40, 6, -40],
          size: [8, 12, 8],
        },
        {
          collision: true,
          id: "pillar-south-east",
          materialId: "carved-stone",
          offset: [40, 6, -40],
          size: [8, 12, 8],
        },
      ],
      kind: "cell-boxes",
      tag: "warden-arena",
    },
  ],
  generator: { seed: 0x5e_ed_d2_01, version: 1 },
  lodTiers: [
    { featureSelection: { kind: "all" }, maxDistanceMeters: 256, sampleStride: 1, tier: 0 },
    { featureSelection: { kind: "all" }, maxDistanceMeters: 640, sampleStride: 2, tier: 1 },
    { featureSelection: { kind: "all" }, maxDistanceMeters: 1_024, sampleStride: 4, tier: 2 },
  ],
  markers: [
    {
      fixedY: 0,
      id: "d2-transition-castle-undercroft",
      kind: "transition",
      position: [64, -448],
      tags: ["d1", "entrance", "castle", "waystone"],
    },
    {
      fixedY: 0,
      id: "d2-transition-village-well",
      kind: "transition",
      position: [-448, 64],
      tags: ["d1", "entrance", "village", "waystone"],
    },
    {
      fixedY: 0,
      id: "d2-transition-forest-ruin",
      kind: "transition",
      position: [448, 448],
      tags: ["d1", "entrance", "forest", "waystone"],
    },
    {
      fixedY: 0,
      id: "d2-landmark-warden-arena",
      kind: "path",
      position: [64, 64],
      tags: ["boss-arena", "landmark", "warden-arena"],
    },
  ],
  materials: [
    { color: [0.16, 0.14, 0.13], id: "floor-stone" },
    { color: [0.21, 0.2, 0.19], id: "wall-stone" },
    { color: [0.11, 0.1, 0.1], id: "ceiling-stone" },
    { color: [0.27, 0.24, 0.2], id: "carved-stone" },
    { color: [0.08, 0.07, 0.07], id: "unworked-rock" },
  ],
  scene: {
    camera: {
      alpha: -Math.PI / 2,
      beta: Math.PI / 2.65,
      minZ: 1,
      radius: 780,
      target: [0, 4, 0],
    },
    clearColor: [0.015, 0.012, 0.01, 1],
    lighting: { cycleSeconds: 900, initialPhase: 0.78, weather: "overcast" },
    lodObservers: [[64, 2, -448]],
  },
  terrain: {
    layers: [],
    materialId: "floor-stone",
    roundingDecimalPlaces: 2,
  },
  world: {
    bounds: { maximum: [512, 32, 512], minimum: [-512, -16, -512] },
    cellSizeMeters: 128,
    collisionSampleSpacingMeters: 8,
    fallbackTag: "sealed-rock",
    id: DISTRICT_2_ID,
    lodHysteresisMeters: 32,
    standardTraversalMetersPerSecond: 12,
    zones: [
      {
        match: all(axisRange("x", -64, 64), axisRange("z", -64, 64)),
        tag: "warden-arena",
      },
      {
        match: all(axisRange("x", 64, 64), axisRange("z", -448, -192)),
        tag: "north-south-passage",
      },
      {
        match: all(axisRange("x", -448, -192), axisRange("z", 64, 64)),
        tag: "east-west-passage",
      },
      {
        match: all(axisRange("x", 192, 320), axisRange("z", 64, 64)),
        tag: "east-west-passage",
      },
      {
        match: all(axisRange("x", 448, 448), axisRange("z", 64, 64)),
        tag: "forest-turn",
      },
      {
        match: all(axisRange("x", 448, 448), axisRange("z", 192, 448)),
        tag: "north-south-passage",
      },
    ],
  },
} satisfies GreyboxDistrictSpec);
