import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PARALLAX_AGX_TONE_MAPPING, parallaxAgxNeutralDisplay } from "../src/render/tone-mapping";

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
