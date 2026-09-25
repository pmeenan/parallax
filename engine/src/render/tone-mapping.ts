import type { ToneMapping } from "@babylonjs/lite";

/**
 * AgX fitted to Blender's "AgX - High Contrast" view, the approved paving source's colour
 * management (engine package 5). The minimal-AgX inset/outset matrices and 6th-order sigmoid
 * run over a log2 range and display power that were fitted to the Cycles tone curve measured by
 * `assets/source/d1-paving/proof-2026-09-24/lighting/calibrate.py`: rms 0.0062 and at most 0.014
 * display units from 2⁻⁸·0.18 to 2⁵·0.18. Lite bakes this into the PBR shaders and then applies
 * its own 1/2.2 encode, so the call returns linear values (display^2.2).
 */
export const PARALLAX_AGX_LOG2_MINIMUM = -13.65;
export const PARALLAX_AGX_LOG2_MAXIMUM = 1.75;
export const PARALLAX_AGX_DISPLAY_POWER = 2.55;

const HELPERS_WGSL = [
  "const parallaxAgxInset=mat3x3<f32>(vec3<f32>(0.842479062253094,0.0423282422610123,0.0423756549057051),vec3<f32>(0.0784335999999992,0.878468636469772,0.0784336),vec3<f32>(0.0792237451477643,0.0791661274605434,0.879142973793104));",
  "const parallaxAgxOutset=mat3x3<f32>(vec3<f32>(1.19687900512017,-0.0528968517574562,-0.0529716355144438),vec3<f32>(-0.0980208811401368,1.15190312990417,-0.0980434501171241),vec3<f32>(-0.0990297440797205,-0.0989611768448433,1.15107367264116));",
  "fn parallaxAgx(linear:vec3<f32>)->vec3<f32>{",
  `var x=clamp(log2(max(parallaxAgxInset*max(linear,vec3<f32>(0.0)),vec3<f32>(1e-10))),vec3<f32>(${PARALLAX_AGX_LOG2_MINIMUM}),vec3<f32>(${PARALLAX_AGX_LOG2_MAXIMUM}));`,
  `x=(x-vec3<f32>(${PARALLAX_AGX_LOG2_MINIMUM}))/${PARALLAX_AGX_LOG2_MAXIMUM - PARALLAX_AGX_LOG2_MINIMUM};`,
  "let x2=x*x;let x4=x2*x2;",
  "var display=15.5*x4*x2-40.14*x4*x+31.96*x4-6.868*x2*x+0.4298*x2+0.1191*x-0.00232;",
  `display=pow(clamp(display,vec3<f32>(0.0),vec3<f32>(1.0)),vec3<f32>(${PARALLAX_AGX_DISPLAY_POWER}));`,
  "return pow(max(parallaxAgxOutset*display,vec3<f32>(0.0)),vec3<f32>(2.2));}",
].join("");

export const PARALLAX_AGX_TONE_MAPPING: ToneMapping = Object.freeze({
  id: "parallax-agx-high-contrast-1",
  helpersWGSL: HELPERS_WGSL,
  callWGSL: "color*=scene.vImageInfos.x;color=parallaxAgx(color);",
});

/** CPU mirror of the neutral curve, for tests and calibration reports: linear in, display out. */
export function parallaxAgxNeutralDisplay(linear: number): number {
  const log = Math.min(
    PARALLAX_AGX_LOG2_MAXIMUM,
    Math.max(PARALLAX_AGX_LOG2_MINIMUM, Math.log2(Math.max(linear, 1e-10))),
  );
  const x =
    (log - PARALLAX_AGX_LOG2_MINIMUM) / (PARALLAX_AGX_LOG2_MAXIMUM - PARALLAX_AGX_LOG2_MINIMUM);
  const x2 = x * x;
  const x4 = x2 * x2;
  const sigmoid =
    15.5 * x4 * x2 -
    40.14 * x4 * x +
    31.96 * x4 -
    6.868 * x2 * x +
    0.4298 * x2 +
    0.1191 * x -
    0.00232;
  return Math.min(1, Math.max(0, sigmoid)) ** PARALLAX_AGX_DISPLAY_POWER;
}
