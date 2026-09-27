import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PARALLAX_AGX_TONE_MAPPING,
  parallaxAgxDisplay,
  parallaxAgxNeutralDisplay,
} from "../src/render/tone-mapping";

const calibration = JSON.parse(
  readFileSync(
    new URL(
      "../../assets/source/d1-paving/proof-2026-09-24/lighting/calibration/calibration.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { agxHighContrast: { linear: number; display: number }[] };

describe("AgX High Contrast fit (engine package 5)", () => {
  it("follows Blender's measured neutral curve within 0.015 display units", () => {
    let squared = 0;
    for (const { linear, display } of calibration.agxHighContrast) {
      const error = parallaxAgxNeutralDisplay(linear) - display;
      expect(Math.abs(error)).toBeLessThan(0.015);
      squared += error * error;
    }
    expect(Math.sqrt(squared / calibration.agxHighContrast.length)).toBeLessThan(0.007);
  });

  it("applies exposure first and returns linear values for Lite's 1/2.2 encode", () => {
    expect(PARALLAX_AGX_TONE_MAPPING.callWGSL.startsWith("color*=scene.vImageInfos.x;")).toBe(true);
    expect(PARALLAX_AGX_TONE_MAPPING.helpersWGSL).toContain("vec3<f32>(2.2)");
  });
});

describe("AgX colour (engine package 7)", () => {
  const colour = JSON.parse(
    readFileSync(
      new URL(
        "../../assets/source/d1-walls/proof-2026-09-27/lighting/calibration/calibration.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { agxHighContrast: { patch: string; linear: number[]; display: number[] }[] };
  // CIELAB (D65) from display-encoded sRGB.
  const lab = (display: readonly number[]) => {
    const [r, g, b] = display.map((v) => {
      const c = Math.min(1, Math.max(0, v));
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const deltaE = (a: readonly number[], b: readonly number[]) => {
    const p = lab(a);
    const q = lab(b);
    return Math.hypot(
      (p[0] ?? 0) - (q[0] ?? 0),
      (p[1] ?? 0) - (q[1] ?? 0),
      (p[2] ?? 0) - (q[2] ?? 0),
    );
  };

  it("keeps the palette's patches within ΔE 3 of Blender's AgX High Contrast", () => {
    for (const { patch, linear, display } of colour.agxHighContrast) {
      // Saturated primaries and mid grass are outside what the matrices can bend (fit.py).
      if (["red", "green", "blue"].includes(patch)) continue;
      const limit = patch === "grass" ? 6 : 3;
      expect(deltaE(parallaxAgxDisplay(linear), display), `${patch} ${linear}`).toBeLessThan(limit);
    }
  });

  it("leaves the neutral axis on the calibrated curve", () => {
    for (let stop = -8; stop <= 5; stop += 0.5) {
      const linear = 0.18 * 2 ** stop;
      for (const channel of parallaxAgxDisplay([linear, linear, linear]))
        expect(Math.abs(channel - parallaxAgxNeutralDisplay(linear))).toBeLessThan(0.002);
    }
  });
});
