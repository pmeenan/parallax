import type { MaterialPlugin } from "@babylonjs/lite";
import type { WorldVec3 } from "../world/world-contract";
import type { PbrAmbientState } from "./pbr-ambient";

/**
 * Sun micro-shadowing for streamed PBR surfaces (engine package 6). CSM cannot resolve relief a
 * few centimetres deep: its caster bias is 0.12 m and its texels are centimetres wide. A surface
 * that ships its height in ORM.B marches that height field toward the sun in texture space and
 * scales only the direct light, so ambient and AO are untouched. The only direct light on PBR
 * surfaces is the sun (the greybox hemispheric light excludes them), so `directDiffuse` and
 * `directSpecular` are exactly the sunlight here; a future local light would need its own term.
 *
 * Every streamed PBR material carries the plugin, so they share one pipeline variant. Surfaces
 * without a height range write a zero range and skip the march on a uniform branch.
 */
export const PBR_SUN_MICROSHADOW_PLUGIN_NAME = "parallax-pbr-sun-microshadow";

/** The march, fixed at compile time so every material shares one shader. */
export const PBR_SUN_MICROSHADOW_STEPS = 12;

/** A placement group's height field and its world-space texture-coordinate gradients. */
export interface PbrMicroShadowSurface {
  /** Metres spanned by ORM.B from 0 to 1. */
  readonly heightRangeMeters: number;
  /** World-space gradients of u and v (texture units per metre) on the module's plane. */
  readonly gradientU: WorldVec3;
  readonly gradientV: WorldVec3;
}

// Lite's PBR shader has already sampled `orm`, built `N_geom` and summed the direct light into
// `color` at this hook; the ambient plugin adds its term after this one (lower priority first).
// The ray leaves the fragment's own height and rises at the sun's elevation over the local tangent
// plane. Each step's clearance below the field becomes shadow through a penumbra that widens with
// distance (a soft cone), and the march ends once the ray clears the top of the field.
/** Penumbra width per metre of march: a cone about 4.6° wide, softer than the 0.53° sun disc, so
 * the 3.9 mm height texels do not alias into stair steps. */
const MICROSHADOW_PENUMBRA_SLOPE = "0.03";
const MICROSHADOW_FRAGMENT_WGSL = [
  "{",
  // Derivatives first, while control flow is still uniform.
  "let msSize=vec2<f32>(textureDimensions(ormTexture,0));",
  "let msFootprint=max(length(dpdx(input.uv)*msSize),length(dpdy(input.uv)*msSize));",
  "let msLod=max(log2(max(msFootprint,1.0)),0.0);",
  // Relief finer than the sampled mip averages out; fade the term out over two further levels.
  "let msFade=1.0-smoothstep(material.microShadowHeight.y,material.microShadowHeight.y+2.0,msLod);",
  "let msRange=material.microShadowHeight.x;",
  "let msDirect=directDiffuse+directSpecular;",
  "let msToSun=material.microShadowSun.xyz;",
  "let msSunUp=dot(msToSun,N_geom);",
  "if(msRange>0.0&&msFade>0.0&&msSunUp>0.0&&max(msDirect.r,max(msDirect.g,msDirect.b))>0.0){",
  "let msAlong=msToSun-N_geom*msSunUp;",
  "let msAlongLength=length(msAlong);",
  "let msRise=msSunUp/max(msAlongLength,0.0001);",
  "let msDir=msAlong/max(msAlongLength,0.0001);",
  "let msUvPerMeter=vec2<f32>(dot(msDir,material.microShadowU.xyz),dot(msDir,material.microShadowV.xyz));",
  "let msStart=textureSampleLevel(ormTexture,ormSampler,input.uv,msLod).b*msRange;",
  "let msLength=min((msRange-msStart)/max(msRise,0.0001),material.microShadowHeight.z);",
  "var msLit=1.0;",
  `for(var msStep=1u;msStep<=${PBR_SUN_MICROSHADOW_STEPS}u;msStep++){`,
  `let msFraction=f32(msStep)/${PBR_SUN_MICROSHADOW_STEPS}.0;`,
  "let msT=msLength*msFraction*msFraction;",
  "let msField=textureSampleLevel(ormTexture,ormSampler,input.uv+msUvPerMeter*msT,msLod).b*msRange;",
  "let msClearance=msStart+msT*msRise-msField;",
  // The penumbra grows with distance (a cone), so it is scale free; the bias absorbs BC7 noise.
  `msLit=min(msLit,saturate(0.5+(msClearance+material.microShadowHeight.w)/(msT*${MICROSHADOW_PENUMBRA_SLOPE})));`,
  "}",
  "color-=msDirect*(1.0-msLit)*msFade;",
  "}",
  "}",
].join("");

/** Texels of relief at the base mip before the fade begins, the longest march in metres and
 * the clearance bias in metres (about two BC7 height steps). */
const MICROSHADOW_FADE_START_LOD = 2.5;
const MICROSHADOW_MAX_MARCH_METERS = 0.25;
const MICROSHADOW_BIAS_METERS = 0.0003;

export const NO_PBR_MICROSHADOW_SURFACE: PbrMicroShadowSurface = Object.freeze({
  heightRangeMeters: 0,
  gradientU: Object.freeze([0, 0, 0]) as WorldVec3,
  gradientV: Object.freeze([0, 0, 0]) as WorldVec3,
});

/** World gradients of the module's planar tile UVs (u = local X / tile, v = local Z / tile) from
 * a placement's column-major matrix: rows X and Z of its inverse, divided by the tile size. */
export function pbrMicroShadowSurfaceFromMatrix(
  matrix: ArrayLike<number>,
  heightRangeMeters: number,
  tileMeters: number,
): PbrMicroShadowSurface {
  const m = (column: number, row: number) => matrix[column * 4 + row] ?? 0;
  const a = [
    [m(0, 0), m(1, 0), m(2, 0)],
    [m(0, 1), m(1, 1), m(2, 1)],
    [m(0, 2), m(1, 2), m(2, 2)],
  ] as const;
  const [r0, r1, r2] = a;
  const cofactor = (i: number, j: number) => {
    const rows = [r0, r1, r2].filter((_, index) => index !== i);
    const cols = [0, 1, 2].filter((index) => index !== j);
    const [p, q] = rows;
    const [c0, c1] = cols as [number, number];
    const value = (p?.[c0] ?? 0) * (q?.[c1] ?? 0) - (p?.[c1] ?? 0) * (q?.[c0] ?? 0);
    return (i + j) % 2 === 0 ? value : -value;
  };
  const determinant = r0[0] * cofactor(0, 0) + r0[1] * cofactor(0, 1) + r0[2] * cofactor(0, 2);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-9)
    throw new Error("PBR micro-shadow placement matrix is singular");
  // Row k of the inverse is the k-th column of the cofactor matrix over the determinant.
  const inverseRow = (k: number): WorldVec3 => [
    cofactor(0, k) / determinant / tileMeters,
    cofactor(1, k) / determinant / tileMeters,
    cofactor(2, k) / determinant / tileMeters,
  ];
  return Object.freeze({
    heightRangeMeters,
    gradientU: inverseRow(0),
    gradientV: inverseRow(2),
  });
}

export function createPbrSunMicroShadowPlugin(
  lighting: PbrAmbientState,
  surface: PbrMicroShadowSurface,
): MaterialPlugin {
  return {
    name: PBR_SUN_MICROSHADOW_PLUGIN_NAME,
    // Before the ambient plugin (default 500), which adds its term to `color` after this one.
    priority: 400,
    getCustomCode: (shaderType) =>
      shaderType === "fragment"
        ? { CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: MICROSHADOW_FRAGMENT_WGSL }
        : null,
    getUniforms: () => ({
      ubo: [
        { name: "microShadowSun", type: "vec4<f32>" },
        { name: "microShadowHeight", type: "vec4<f32>" },
        { name: "microShadowU", type: "vec4<f32>" },
        { name: "microShadowV", type: "vec4<f32>" },
      ],
    }),
    writeUbo: (data, offsets) => {
      const sun = (offsets.get("microShadowSun") ?? 0) / 4;
      const height = (offsets.get("microShadowHeight") ?? 0) / 4;
      const u = (offsets.get("microShadowU") ?? 0) / 4;
      const v = (offsets.get("microShadowV") ?? 0) / 4;
      for (let axis = 0; axis < 3; axis++) {
        data[sun + axis] = lighting.toSun[axis] ?? 0;
        data[u + axis] = surface.gradientU[axis] ?? 0;
        data[v + axis] = surface.gradientV[axis] ?? 0;
      }
      data[sun + 3] = 0;
      data[u + 3] = 0;
      data[v + 3] = 0;
      data[height] = surface.heightRangeMeters;
      data[height + 1] = MICROSHADOW_FADE_START_LOD;
      data[height + 2] = MICROSHADOW_MAX_MARCH_METERS;
      data[height + 3] = MICROSHADOW_BIAS_METERS;
    },
  };
}
