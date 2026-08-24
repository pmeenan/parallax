import {
  type GreyboxRenderTelemetry,
  RENDER_LIGHTING_MODEL,
  type RenderFrameSample,
} from "@parallax/engine";
import { describe, expect, it } from "vitest";
import type { GreyboxRenderedOutputEvidence } from "./greybox-rendered-output.js";
import { requireGreyboxWorld, requireGreyboxWorldTelemetry } from "./greybox-world-evidence.js";

const renderedOutput = Object.freeze({
  clearColorRgb: Object.freeze([82, 163, 235] as const),
  height: 720,
  pngSha256: "a".repeat(64),
  visiblePixelCount: 500_000,
  visiblePixelRatio: 500_000 / (1_280 * 720),
  width: 1_280,
}) satisfies GreyboxRenderedOutputEvidence;

function validTelemetry(): GreyboxRenderTelemetry {
  return {
    cellCount: 256,
    clearColor: [0.32, 0.64, 0.92, 1],
    colliderCount: 708,
    districtId: "district-1-surface",
    dynamicLighting: true,
    heightSampleCount: 256 * 17 * 17,
    lightingModel: RENDER_LIGHTING_MODEL,
    materialCount: 8,
    mainThreadWorldGenerationMs: 20,
    mainThreadScenePostMessageMs: 4,
    materializationMs: 12.5,
    renderedFeaturePrimitiveCount: 318,
    renderedTerrainPatchCount: 256,
    renderedTriangleCount: 10_000,
    selectedLodCellCounts: [12, 48, 196],
    worldBoundsMeters: {
      maximum: [2_048, 256, 2_048],
      minimum: [-2_048, -32, -2_048],
    },
  };
}

function validFrames(): readonly RenderFrameSample[] {
  return [
    {
      durationMs: 8,
      lightingIntensity: 0.55,
      lightingPhase: 0.2,
      presentIntervalMs: null,
      sunDirection: [0, -1, 0],
      sunIntensity: 0.8,
    },
    {
      durationMs: 8,
      lightingIntensity: 0.57,
      lightingPhase: 0.201,
      presentIntervalMs: 16.67,
      sunDirection: [0.01, -Math.sqrt(1 - 0.01 ** 2), 0],
      sunIntensity: 0.79,
    },
  ];
}

describe("D-090 greybox smoke evidence", () => {
  it("accepts the complete v1 contract", () => {
    const telemetry = validTelemetry();
    expect(requireGreyboxWorld(telemetry, validFrames(), renderedOutput)).toMatchObject(telemetry);
  });

  it("round-trips durable directional-sun evidence and rejects contradictory exports", () => {
    const evidence = requireGreyboxWorld(validTelemetry(), validFrames(), renderedOutput);
    expect(requireGreyboxWorldTelemetry(evidence)).toEqual(evidence);
    expect(() =>
      requireGreyboxWorldTelemetry({
        ...evidence,
        observedLighting: {
          ...evidence.observedLighting,
          sunDirectionAngularChangeRadians: 0,
        },
      }),
    ).toThrow("Greybox observed-lighting evidence is invalid");
    expect(() =>
      requireGreyboxWorldTelemetry({
        ...evidence,
        observedLighting: {
          ...evidence.observedLighting,
          sunIntensityMinimum: 0,
          sunIntensityRange: evidence.observedLighting.sunIntensityMaximum,
        },
      }),
    ).toThrow("Greybox observed-lighting evidence is invalid");
    expect(() =>
      requireGreyboxWorldTelemetry({
        ...evidence,
        observedLighting: {
          ...evidence.observedLighting,
          sunIntensityRange: evidence.observedLighting.sunIntensityRange + 0.1,
        },
      }),
    ).toThrow("Greybox observed-lighting evidence is invalid");
  });

  it.each([
    ["missing telemetry", null],
    ["wrong district", { ...validTelemetry(), districtId: "other" }],
    ["wrong lighting model", { ...validTelemetry(), lightingModel: "hemispheric-only@1" }],
    ["partial cell set", { ...validTelemetry(), cellCount: 1 }],
    ["missing collision", { ...validTelemetry(), colliderCount: 0 }],
    ["partial heightfields", { ...validTelemetry(), heightSampleCount: 17 * 17 }],
    ["unexercised LOD", { ...validTelemetry(), selectedLodCellCounts: [0, 60, 196] }],
    ["non-finite materialization", { ...validTelemetry(), materializationMs: Number.NaN }],
    ["non-finite generation", { ...validTelemetry(), mainThreadWorldGenerationMs: Number.NaN }],
    [
      "non-finite scene postMessage",
      { ...validTelemetry(), mainThreadScenePostMessageMs: Number.NaN },
    ],
    ["wrong clear color", { ...validTelemetry(), clearColor: [0.1, 0.2, 0.3, 1] }],
    [
      "wrong bounds",
      {
        ...validTelemetry(),
        worldBoundsMeters: { ...validTelemetry().worldBoundsMeters, maximum: [1, 2, 3] },
      },
    ],
  ])("rejects %s", (_label, telemetry) => {
    expect(() =>
      requireGreyboxWorld(
        telemetry as GreyboxRenderTelemetry | null,
        validFrames(),
        renderedOutput,
      ),
    ).toThrow();
  });

  it.each([
    ["too few samples", validFrames().slice(0, 1)],
    ["static phase", validFrames().map((frame) => ({ ...frame, lightingPhase: 0.2 }))],
    ["static intensity", validFrames().map((frame) => ({ ...frame, lightingIntensity: 0.55 }))],
    ["static sun intensity", validFrames().map((frame) => ({ ...frame, sunIntensity: 0.8 }))],
    [
      "zero sun intensity",
      validFrames().map((frame, index) => (index === 0 ? { ...frame, sunIntensity: 0 } : frame)),
    ],
    [
      "static sun direction",
      validFrames().map((frame) => ({ ...frame, sunDirection: [0, -1, 0] as const })),
    ],
    [
      "non-unit sun direction",
      validFrames().map((frame, index) =>
        index === 0 ? { ...frame, sunDirection: [0, -2, 0] as const } : frame,
      ),
    ],
    [
      "non-finite intensity",
      validFrames().map((frame, index) =>
        index === 0 ? { ...frame, lightingIntensity: Number.NaN } : frame,
      ),
    ],
  ])("rejects %s lighting evidence", (_label, frames) => {
    expect(() => requireGreyboxWorld(validTelemetry(), frames, renderedOutput)).toThrow();
  });

  it("reports the failed lighting boundary precisely", () => {
    const frames = validFrames();
    const first = frames[0];
    const second = frames[1];
    if (first === undefined || second === undefined) throw new Error("Test fixture is incomplete");
    expect(() => requireGreyboxWorld(validTelemetry(), frames.slice(0, 1), renderedOutput)).toThrow(
      "Greybox lighting telemetry requires at least two frame samples",
    );
    expect(() =>
      requireGreyboxWorld(
        validTelemetry(),
        validFrames().map((frame, index) =>
          index === 0 ? { ...frame, lightingIntensity: Number.NaN } : frame,
        ),
        renderedOutput,
      ),
    ).toThrow("Greybox lighting telemetry contains an invalid phase or perceived intensity");
    for (const invalidFrame of [
      { ...first, sunDirection: [0, -2, 0] as const },
      { ...first, sunDirection: [-1, -0, 0] as const, sunIntensity: 0 },
    ]) {
      expect(() =>
        requireGreyboxWorld(validTelemetry(), [invalidFrame, second], renderedOutput),
      ).toThrow("Greybox directional-sun telemetry is invalid");
    }
  });
});
