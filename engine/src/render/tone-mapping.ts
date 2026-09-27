import type { ToneMapping } from "@babylonjs/lite";

/**
 * AgX fitted to Blender's "AgX - High Contrast" view, the approved paving source's colour
 * management (engine package 5). The minimal-AgX inset/outset matrices and 6th-order sigmoid
 * run over a log2 range and display power that were fitted to the Cycles tone curve measured by
 * `assets/source/d1-paving/proof-2026-09-24/lighting/calibrate.py`: rms 0.0062 and at most 0.014
 * display units from 2⁻⁸·0.18 to 2⁵·0.18. The inset and outset matrices were refitted to Blender's
 * colour handling on 402 coloured patches, minimising CIELAB error weighted toward the game's
 * palette, with the neutral axis pinned (engine package 7,
 * `assets/source/d1-walls/proof-2026-09-27/lighting/fit.py`): earth tones ΔE ≤ 2.5 (3.6 before),
 * plaster, oak, stone and sky patches ≤ 2.9; mid grass stays at 5.9 and saturated primaries worse
 * (the matrices cannot bend hue per region). The minimal-AgX matrices had kept warm colours too
 * saturated. Lite bakes this into the PBR shaders and then applies its own 1/2.2 encode, so the
 * call returns linear values (display^2.2).
 */
export const PARALLAX_AGX_LOG2_MINIMUM = -13.65;
export const PARALLAX_AGX_LOG2_MAXIMUM = 1.75;
export const PARALLAX_AGX_DISPLAY_POWER = 2.55;

// Column-major, as WGSL's mat3x3 constructor takes them.
const INSET_COLUMNS = [
  [0.62127833, 0.09959861, 0.07681333],
  [0.23343154, 0.69430019, 0.20178747],
  [0.14540347, 0.206641, 0.72120687],
] as const;
const OUTSET_COLUMNS = [
  [1.52460694, -0.15384115, -0.06663283],
  [-0.31184546, 1.38032555, -0.53608733],
  [-0.21290588, -0.22668132, 1.60292909],
] as const;
const wgslMatrix = (columns: readonly (readonly number[])[]) =>
  `mat3x3<f32>(${columns.map((c) => `vec3<f32>(${c.join(",")})`).join(",")})`;

const HELPERS_WGSL = [
  `const parallaxAgxInset=${wgslMatrix(INSET_COLUMNS)};`,
  `const parallaxAgxOutset=${wgslMatrix(OUTSET_COLUMNS)};`,
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

/** The sigmoid and display power on one channel's normalised log2 exposure. */
function agxCurve(linear: number): number {
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

const multiply = (columns: readonly (readonly number[])[], v: readonly number[]) =>
  [0, 1, 2].map((row) =>
    columns.reduce((sum, column, i) => sum + (column[row] ?? 0) * (v[i] ?? 0), 0),
  );

/** CPU mirror of the neutral curve, for tests and calibration reports: linear in, display out. */
export function parallaxAgxNeutralDisplay(linear: number): number {
  return agxCurve(linear);
}

/**
 * CPU mirror of the full colour transform (exposure already applied): linear RGB in, display RGB
 * out (before Lite's 1/2.2 encode undoes the shader's final 2.2 power, so these are the display
 * values an 8-bit capture stores, divided by 255).
 */
export function parallaxAgxDisplay(linear: readonly number[]): number[] {
  const inset = multiply(
    INSET_COLUMNS,
    linear.map((v) => Math.max(0, v)),
  );
  return multiply(OUTSET_COLUMNS, inset.map(agxCurve)).map((v) => Math.max(0, v));
}
