import type { MaterialPlugin } from "@babylonjs/lite";

/**
 * Occluded sky/ground ambient for streamed PBR surfaces (engine package 5). The hemispheric
 * light no longer reaches PBR meshes: Lite applies ORM occlusion only to image-based lighting,
 * and the game has none. This term uses the environment sample's radiance-on-white sky and
 * ground-bounce values in Lite light units:
 * - Diffuse: hemispheric irradiance × albedo × ORM occlusion.
 * - Specular: the sky/ground colour in the reflected direction, blurred toward the irradiance by
 *   roughness. It is weighted by an analytic environment BRDF (Karis) with Lagarde specular
 *   occlusion and geometric-normal horizon occlusion.
 * One shared state object feeds every material; the owner marks the materials' UBOs dirty when
 * the lighting changes.
 */
export const PBR_AMBIENT_PLUGIN_NAME = "parallax-pbr-ambient";

/** PBR placement meshes carry this id so the greybox hemispheric light can exclude them. */
export const PBR_AMBIENT_MESH_ID = "parallax-pbr-surface";

export interface PbrAmbientState {
  /** Linear RGB radiance of an unoccluded, upward-facing white Lambert surface under the sky. */
  readonly sky: [number, number, number];
  /** The same for a downward-facing surface: light bounced from the ground. */
  readonly ground: [number, number, number];
  /** Unit world direction toward the sun, for the sun micro-shadow plugin (engine package 6). */
  readonly toSun: [number, number, number];
}

const AMBIENT_FRAGMENT_WGSL = [
  "{",
  "let ambientIrradiance=mix(material.ambientGround.rgb,material.ambientSky.rgb,clamp(N.y*0.5+0.5,0.0,1.0));",
  "let ambientReflection=reflect(-V,N);",
  "let ambientReflected=mix(mix(material.ambientGround.rgb,material.ambientSky.rgb,clamp(ambientReflection.y*0.5+0.5,0.0,1.0)),ambientIrradiance,roughness*roughness);",
  "let ambientRough=roughness*vec4<f32>(-1.0,-0.0275,-0.572,0.022)+vec4<f32>(1.0,0.0425,1.04,-0.04);",
  "let ambientA004=min(ambientRough.x*ambientRough.x,exp2(-9.28*NdotV))*ambientRough.x+ambientRough.y;",
  "let ambientBrdf=vec2<f32>(-1.04,1.04)*ambientA004+ambientRough.zw;",
  "let ambientSpecularOcclusion=saturate(pow(NdotV+occlusion,exp2(-16.0*roughness-1.0))-1.0+occlusion);",
  "let ambientHorizon=saturate(1.0+1.1*dot(ambientReflection,N_geom));",
  "color+=ambientIrradiance*surfaceAlbedo*occlusion+ambientReflected*(colorF0*ambientBrdf.x+colorF90*ambientBrdf.y)*ambientSpecularOcclusion*ambientHorizon*ambientHorizon;",
  "}",
].join("");

export function createPbrAmbientState(): PbrAmbientState {
  return { sky: [0, 0, 0], ground: [0, 0, 0], toSun: [0, 1, 0] };
}

export function createPbrAmbientPlugin(state: PbrAmbientState): MaterialPlugin {
  return {
    name: PBR_AMBIENT_PLUGIN_NAME,
    getCustomCode: (shaderType) =>
      shaderType === "fragment"
        ? { CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: AMBIENT_FRAGMENT_WGSL }
        : null,
    getUniforms: () => ({
      ubo: [
        { name: "ambientSky", type: "vec4<f32>" },
        { name: "ambientGround", type: "vec4<f32>" },
      ],
    }),
    writeUbo: (data, offsets) => {
      const sky = (offsets.get("ambientSky") ?? 0) / 4;
      const ground = (offsets.get("ambientGround") ?? 0) / 4;
      for (let channel = 0; channel < 3; channel++) {
        data[sky + channel] = state.sky[channel] ?? 0;
        data[ground + channel] = state.ground[channel] ?? 0;
      }
      data[sky + 3] = 0;
      data[ground + 3] = 0;
    },
  };
}
