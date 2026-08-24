import { describe, expect, it } from "vitest";
import {
  quantizeAnimatedEnvironmentLightingPhase,
  sampleEnvironmentLighting,
} from "../src/render/environment-lighting";

describe("environment lighting", () => {
  it("maps the authored phase convention to stable solar states", () => {
    const dawn = sampleEnvironmentLighting(0, "clear");
    const noon = sampleEnvironmentLighting(0.25, "clear");
    const dusk = sampleEnvironmentLighting(0.5, "clear");
    const midnight = sampleEnvironmentLighting(0.75, "clear");

    expect(dawn.sunElevation).toBe(0);
    expect(noon.sunElevation).toBe(1);
    expect(dusk.sunElevation).toBeCloseTo(0, 12);
    expect(midnight.sunElevation).toBe(-1);
    expect(noon.sunIntensity).toBeGreaterThan(dawn.sunIntensity);
    expect(dawn.sunIntensity).toBe(0);
    expect(dusk.sunIntensity).toBe(0);
    expect(midnight.sunIntensity).toBe(0);
    expect(noon.ambientIntensity).toBeGreaterThan(midnight.ambientIntensity);
    expect(dawn.sunDirection[0]).toBeCloseTo(-1, 12);
    expect(dawn.sunDirection[1]).toBeCloseTo(0, 12);
    expect(noon.sunDirection[1]).toBeCloseTo(-1, 12);
    expect(dusk.sunDirection[0]).toBeCloseTo(1, 12);
  });

  it("keeps twilight ambient while direct sunlight is below the horizon", () => {
    const afterDusk = sampleEnvironmentLighting(0.51, "clear");
    const beforeDawn = sampleEnvironmentLighting(0.99, "clear");

    expect(afterDusk.sunElevation).toBeLessThan(0);
    expect(beforeDawn.sunElevation).toBeLessThan(0);
    expect(afterDusk.sunIntensity).toBe(0);
    expect(beforeDawn.sunIntensity).toBe(0);
    expect(afterDusk.ambientIntensity).toBeGreaterThan(0);
    expect(beforeDawn.ambientIntensity).toBeGreaterThan(0);
  });

  it("fades direct sunlight continuously to zero at the horizon", () => {
    const phaseEpsilon = 1e-7;
    const beforeDawn = sampleEnvironmentLighting(1 - phaseEpsilon, "clear");
    const dawn = sampleEnvironmentLighting(0, "clear");
    const afterDawn = sampleEnvironmentLighting(phaseEpsilon, "clear");

    expect(beforeDawn.sunIntensity).toBe(0);
    expect(dawn.sunIntensity).toBe(0);
    expect(afterDawn.sunIntensity).toBeGreaterThan(0);
    expect(afterDawn.sunIntensity).toBeLessThan(1e-9);
  });

  it("retains ambient readability while weather suppresses direct light", () => {
    const clear = sampleEnvironmentLighting(0.25, "clear");
    const overcast = sampleEnvironmentLighting(0.25, "overcast");
    const storm = sampleEnvironmentLighting(0.25, "storm");

    expect(clear.sunIntensity).toBeGreaterThan(overcast.sunIntensity);
    expect(overcast.sunIntensity).toBeGreaterThan(storm.sunIntensity);
    expect(overcast.ambientIntensity).toBeLessThan(clear.ambientIntensity);
    expect(storm.ambientIntensity).toBeGreaterThan(0);
    expect(storm.skyColor[2] - storm.skyColor[0]).toBeLessThan(
      clear.skyColor[2] - clear.skyColor[0],
    );
  });

  it("returns normalized directions and bounded display intensity for the full matrix", () => {
    for (const weather of ["clear", "overcast", "storm"] as const) {
      for (let index = 0; index < 96; index += 1) {
        const sample = sampleEnvironmentLighting(index / 96, weather);
        expect(sample.weather).toBe(weather);
        expect(Math.hypot(...sample.sunDirection)).toBeCloseTo(1, 12);
        expect(sample.perceivedIntensity).toBeGreaterThan(0);
        expect(sample.perceivedIntensity).toBeLessThanOrEqual(1);
        for (const channel of [
          ...sample.clearColor,
          ...sample.skyColor,
          ...sample.groundColor,
          ...sample.sunColor,
        ]) {
          expect(Number.isFinite(channel)).toBe(true);
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("rejects phases that would make environment evidence ambiguous", () => {
    for (const phase of [-0.01, 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => sampleEnvironmentLighting(phase, "clear")).toThrow("Environment lighting phase");
      expect(() => quantizeAnimatedEnvironmentLightingPhase(phase)).toThrow(
        "Environment lighting phase",
      );
    }
  });

  it("owns the autonomous-cycle quantization while preserving exact authored phases", () => {
    const rawPhase = 0.250_2;
    const quantizedPhase = quantizeAnimatedEnvironmentLightingPhase(rawPhase);
    const animated = sampleEnvironmentLighting(quantizedPhase, "clear");
    const authored = sampleEnvironmentLighting(rawPhase, "clear");

    expect(quantizedPhase).toBe(0.25);
    expect(animated.phase).toBe(quantizedPhase);
    expect(authored.phase).toBe(rawPhase);
    expect(quantizedPhase).not.toBe(rawPhase);
  });
});
