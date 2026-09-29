import type { MaterialPlugin } from "@babylonjs/lite";

/**
 * Per-element tint carried in the UV's integer part (K2 delivery, house kit GPU memory round).
 * Many small elements (roof tiles) share a variant atlas, and each needs its own kiln and
 * weathering tint. The streamed vertex layout has no colour stream, and a unique texture per
 * element costs texels. Instead, the build adds whole numbers to an element's atlas UVs:
 * - `floor(u)` is the tint's brightness step;
 * - `floor(v)` is its cast step.
 *
 * The material samples its maps with repeat addressing, so the offset selects the same texels.
 * The integer part stays constant across each element's triangles, so UV derivatives and mip
 * selection are unchanged. At |uv| < 128, float32 keeps 2^-17 of fraction: under 1/30 texel of a
 * 4096 atlas.
 *
 * tint = t · (1 + b · cast), with t = t0 + floor(u) · tStep and b = b0 + floor(v) · bStep.
 * `enabled` 0 gives tint 1, so every streamed PBR material shares one pipeline variant.
 */
export const PBR_TINT_PLUGIN_NAME = "parallax-pbr-tint";

/** The largest integer step either axis may carry. */
export const PBR_TINT_MAX_STEP = 127;

export interface PbrUvTint {
  /** Brightness at step 0 and per step. */
  readonly brightness: readonly [number, number];
  /** Cast weight at step 0 and per step. */
  readonly cast: readonly [number, number];
  /** Linear RGB direction the cast weight scales. */
  readonly castVector: readonly [number, number, number];
}

const TINT_FRAGMENT_WGSL = [
  "{",
  "let tnStep=floor(input.uv);",
  "let tnT=material.tintSteps.x+tnStep.x*material.tintSteps.y;",
  "let tnB=material.tintSteps.z+tnStep.y*material.tintSteps.w;",
  "baseColor=baseColor*mix(vec3<f32>(1.0),tnT*(vec3<f32>(1.0)+tnB*material.tintCast.rgb),material.tintCast.w);",
  "}",
].join("");

export function createPbrTintPlugin(tint: PbrUvTint | null): MaterialPlugin {
  return {
    name: PBR_TINT_PLUGIN_NAME,
    getCustomCode: (shaderType) =>
      shaderType === "fragment" ? { CUSTOM_FRAGMENT_UPDATE_DIFFUSE: TINT_FRAGMENT_WGSL } : null,
    getUniforms: () => ({
      ubo: [
        { name: "tintSteps", type: "vec4<f32>" },
        { name: "tintCast", type: "vec4<f32>" },
      ],
    }),
    writeUbo: (data, offsets) => {
      const steps = (offsets.get("tintSteps") ?? 0) / 4;
      const cast = (offsets.get("tintCast") ?? 0) / 4;
      data[steps] = tint?.brightness[0] ?? 1;
      data[steps + 1] = tint?.brightness[1] ?? 0;
      data[steps + 2] = tint?.cast[0] ?? 0;
      data[steps + 3] = tint?.cast[1] ?? 0;
      data[cast] = tint?.castVector[0] ?? 0;
      data[cast + 1] = tint?.castVector[1] ?? 0;
      data[cast + 2] = tint?.castVector[2] ?? 0;
      data[cast + 3] = tint === null ? 0 : 1;
    },
  };
}
