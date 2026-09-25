import { validateGreyboxDistrict } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import { sampleEnvironmentLighting } from "../../engine/src/render/environment-lighting";
import type { RenderFrameSample } from "../../engine/src/render/render-protocol";
import { RENDER_LIGHTING_MODEL } from "../../engine/src/render/render-protocol";
import {
  requireGreyboxWorld,
  requireGreyboxWorldTelemetry,
} from "../../harness/src/greybox-world-evidence";
import { DISTRICT_1_GREYBOX_SPEC } from "../src/world/district-1.data";
import { createGreyboxScene } from "../src/world/greybox-generator";

const scene = createGreyboxScene(DISTRICT_1_GREYBOX_SPEC);
const telemetry = {
  ...validateGreyboxDistrict(scene.world),
  clearColor: scene.clearColor,
  districtId: scene.world.id,
  materialCount: scene.world.materials.length,
  dynamicLighting: true,
  lightingModel: RENDER_LIGHTING_MODEL,
  mainThreadWorldGenerationMs: 1,
  mainThreadScenePostMessageMs: 1,
  materializationMs: 1,
  renderedFeaturePrimitiveCount: 1,
  renderedTerrainPatchCount: scene.world.cells.length,
  renderedTriangleCount: 1,
  selectedLodCellCounts: [1, 1, scene.world.cells.length - 2],
  worldBoundsMeters: scene.world.bounds,
};
const output = {
  clearColorRgb: [
    Math.round(scene.clearColor[0] * 255),
    Math.round(scene.clearColor[1] * 255),
    Math.round(scene.clearColor[2] * 255),
  ] as const,
  width: 1280,
  height: 720,
  pngSha256: "a".repeat(64),
  visiblePixelCount: 500_000,
  visiblePixelRatio: 500_000 / (1280 * 720),
};
const frames = [0, 10, 30].map((seconds) => {
  const lighting = sampleEnvironmentLighting(
    scene.lighting.initialPhase + seconds / scene.lighting.cycleSeconds,
    scene.lighting.weather,
  );
  // The evidence validator consumes these four fields; no GPU timing is claimed here.
  return {
    lightingIntensity: lighting.perceivedIntensity,
    lightingPhase: lighting.phase,
    sunIntensity: lighting.sunIntensity,
    sunDirection: lighting.sunDirection,
  } as RenderFrameSample;
});

describe("D1 calibrated daylight and terrain smoke contract", () => {
  it("accepts the real world's coarse and detail sample count", () => {
    expect(telemetry.heightSampleCount).toBe(83_588);
    const evidence = requireGreyboxWorld(telemetry, frames, output);
    expect(requireGreyboxWorldTelemetry(evidence)).toEqual(evidence);
    expect(() =>
      requireGreyboxWorld({ ...telemetry, heightSampleCount: 73_984 }, frames, output),
    ).toThrow(/D-090/);
  });

  it("accepts constant daylight strength while the real sun direction advances", () => {
    const evidence = requireGreyboxWorld(telemetry, frames, output);
    expect(evidence.observedLighting.sunIntensityRange).toBe(0);
    expect(evidence.observedLighting.intensityRange).toBe(0);
    expect(evidence.observedLighting.sunDirectionAngularChangeRadians).toBeGreaterThan(0.1);
    expect(requireGreyboxWorldTelemetry(evidence)).toEqual(evidence);
    expect(() =>
      requireGreyboxWorld(
        telemetry,
        frames.map((frame) => ({ ...frame, sunDirection: [0, -1, 0] as const })),
        output,
      ),
    ).toThrow(/lighting did not change/);
  });
});
