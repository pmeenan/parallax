import type { MaterialPlugin } from "@babylonjs/lite";

/**
 * Occluded sky/ground ambient for streamed PBR surfaces (engine package 5). The hemispheric
 * light no longer reaches PBR meshes: Lite applies ORM occlusion only to image-based lighting,
 * and the game has none. This term uses the environment sample's radiance-on-white sky and
 * ground-bounce values in Lite light units:
 * - Diffuse: sky-dome irradiance shaped by the normal in the sun's frame (engine package 7:
 *   calibrated against Cycles for every orientation, not only up), plus the ground bounce's exact
 *   (1 - n.y) / 2 share, × albedo × ORM occlusion.
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
  /** Unit world direction toward the sun, for the sun micro-shadow plugin (engine package 6) and
   * the sky shape's frame. */
  readonly toSun: [number, number, number];
  /** The environment sample's `pbrSkyShape`: 9 coefficients × RGB, coefficient-major. */
  readonly skyShape: number[];
}

/** Terms of the sky-dome shape: 1, y, y², h, h·y, s², h²·y², s⁴, h³·y (sun frame). */
export const PBR_SKY_SHAPE_TERMS = 9;
const SHAPE_INDICES = Array.from({ length: PBR_SKY_SHAPE_TERMS }, (_, k) => k);

const AMBIENT_FRAGMENT_WGSL = [
  "{",
  // Sun frame: y up, h toward the sun's horizontal direction, s across it (only even powers of s).
  "let ambientH=material.ambientSunH.xy;",
  "let ambientY=N.y;",
  "let ambientHh=N.x*ambientH.x+N.z*ambientH.y;",
  "let ambientS=N.x*ambientH.y-N.z*ambientH.x;",
  "let ambientY2=ambientY*ambientY;",
  "let ambientS2=ambientS*ambientS;",
  "let ambientHy=ambientHh*ambientY;",
  "let ambientDome=max(material.ambientShape0.rgb+material.ambientShape1.rgb*ambientY+material.ambientShape2.rgb*ambientY2+material.ambientShape3.rgb*ambientHh+material.ambientShape4.rgb*ambientHy+material.ambientShape5.rgb*ambientS2+material.ambientShape6.rgb*ambientHy*ambientHy+material.ambientShape7.rgb*ambientS2*ambientS2+material.ambientShape8.rgb*ambientHy*ambientHh*ambientHh,vec3<f32>(0.0));",
  "let ambientIrradiance=material.ambientSky.rgb*ambientDome+material.ambientGround.rgb*clamp(0.5-0.5*ambientY,0.0,1.0);",
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
  return {
    sky: [0, 0, 0],
    ground: [0, 0, 0],
    toSun: [0, 1, 0],
    // A uniform dome until the first lighting sample: (1 + y) / 2.
    skyShape: [
      0.5,
      0.5,
      0.5,
      0.5,
      0.5,
      0.5,
      ...Array<number>(3 * (PBR_SKY_SHAPE_TERMS - 2)).fill(0),
    ],
  };
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
        { name: "ambientSunH", type: "vec4<f32>" },
        ...SHAPE_INDICES.map((k) => ({ name: `ambientShape${k}`, type: "vec4<f32>" })),
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
      // The sun's horizontal direction (x, z), normalised; straight overhead any axis serves,
      // since the shape's h terms vanish there.
      const sunH = (offsets.get("ambientSunH") ?? 0) / 4;
      const hx = state.toSun[0] ?? 0;
      const hz = state.toSun[2] ?? 0;
      const hl = Math.hypot(hx, hz);
      data[sunH] = hl > 1e-6 ? hx / hl : 1;
      data[sunH + 1] = hl > 1e-6 ? hz / hl : 0;
      data[sunH + 2] = 0;
      data[sunH + 3] = 0;
      for (const k of SHAPE_INDICES) {
        const at = (offsets.get(`ambientShape${k}`) ?? 0) / 4;
        for (let channel = 0; channel < 3; channel++)
          data[at + channel] = state.skyShape[k * 3 + channel] ?? 0;
        data[at + 3] = 0;
      }
    },
  };
}
