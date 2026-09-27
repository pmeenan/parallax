import type { MaterialPlugin } from "@babylonjs/lite";
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

/** The march's step bounds, fixed at compile time so every material shares one shader; the count
 * between them follows the march length in texels. */
export const PBR_SUN_MICROSHADOW_MIN_STEPS = 4;
export const PBR_SUN_MICROSHADOW_MAX_STEPS = 64;
const MICROSHADOW_TEXELS_PER_STEP = "1.5";

/** A surface's occluding height field. */
export interface PbrMicroShadowSurface {
  /** Metres spanned by ORM.B from 0 to 1. */
  readonly heightRangeMeters: number;
}

// Lite's PBR shader has already sampled `orm`, built `N_geom` and summed the direct light into
// `color` at this hook; the ambient plugin adds its term after this one (lower priority first).
// The ray leaves the fragment's own height and rises at the sun's elevation over the local tangent
// plane. Its texture-space direction comes from the fragment's own screen-space derivatives: the
// world gradients of u and v on the triangle's plane, so atlas-mapped, vertical, rotated and
// mirrored surfaces march correctly (the K1 wall delivery), not only planar ground tiles. Each step's clearance below the field becomes shadow through a penumbra that widens with
// distance (a soft cone), and the march ends once the ray clears the top of the field.
/** Penumbra width per metre of march: a cone about 4.6° wide, softer than the 0.53° sun disc, so
 * the 3.9 mm height texels do not alias into stair steps. */
const MICROSHADOW_PENUMBRA_SLOPE = "0.03";
const MICROSHADOW_FRAGMENT_WGSL = [
  "{",
  // Derivatives first, while control flow is still uniform.
  "let msSize=vec2<f32>(textureDimensions(ormTexture,0));",
  "let msDuvX=dpdx(input.uv);",
  "let msDuvY=dpdy(input.uv);",
  "let msDpX=dpdx(input.worldPos);",
  "let msDpY=dpdy(input.worldPos);",
  "let msFootprint=max(length(msDuvX*msSize),length(msDuvY*msSize));",
  "let msLod=max(log2(max(msFootprint,1.0)),0.0);",
  // Relief finer than the sampled mip averages out; fade the term out over two further levels.
  "let msFade=1.0-smoothstep(material.microShadowHeight.y,material.microShadowHeight.y+2.0,msLod);",
  "let msRange=material.microShadowHeight.x;",
  "let msDirect=directDiffuse+directSpecular;",
  "let msToSun=material.microShadowSun.xyz;",
  "let msSunUp=dot(msToSun,N_geom);",
  // grad u = (perpY du/dx + perpX du/dy) / det satisfies grad u . dp/dx = du/dx and . dp/dy = du/dy.
  "let msPerpY=cross(msDpY,N_geom);",
  "let msPerpX=cross(N_geom,msDpX);",
  "let msDet=dot(msDpX,msPerpY);",
  "if(msRange>0.0&&msFade>0.0&&msSunUp>0.0&&abs(msDet)>1e-30&&max(msDirect.r,max(msDirect.g,msDirect.b))>0.0){",
  "let msAlong=msToSun-N_geom*msSunUp;",
  "let msAlongLength=length(msAlong);",
  "let msRise=msSunUp/max(msAlongLength,0.0001);",
  "let msDir=msAlong/max(msAlongLength,0.0001);",
  "let msUvPerMeter=(dot(msDir,msPerpY)*msDuvX+dot(msDir,msPerpX)*msDuvY)/msDet;",
  "let msStart=textureSampleLevel(ormTexture,ormSampler,input.uv,msLod).b*msRange;",
  "let msLength=min((msRange-msStart)/max(msRise,0.0001),material.microShadowHeight.z);",
  // Even steps about 1.5 texels of the sampled mip apart: a fixed count skipped a tall occluder
  // at the far end of a long march (the wall's window sills), stair-stepping its shadow edge.
  "let msTexels=msLength*length(msUvPerMeter*msSize)/exp2(msLod);",
  `let msSteps=u32(clamp(ceil(msTexels/${MICROSHADOW_TEXELS_PER_STEP}),${PBR_SUN_MICROSHADOW_MIN_STEPS}.0,${PBR_SUN_MICROSHADOW_MAX_STEPS}.0));`,
  "var msLit=1.0;",
  "for(var msStep=1u;msStep<=msSteps;msStep++){",
  "let msT=msLength*f32(msStep)/f32(msSteps);",
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
});

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
      ],
    }),
    writeUbo: (data, offsets) => {
      const sun = (offsets.get("microShadowSun") ?? 0) / 4;
      const height = (offsets.get("microShadowHeight") ?? 0) / 4;
      for (let axis = 0; axis < 3; axis++) data[sun + axis] = lighting.toSun[axis] ?? 0;
      data[sun + 3] = 0;
      data[height] = surface.heightRangeMeters;
      data[height + 1] = MICROSHADOW_FADE_START_LOD;
      data[height + 2] = MICROSHADOW_MAX_MARCH_METERS;
      data[height + 3] = MICROSHADOW_BIAS_METERS;
    },
  };
}
