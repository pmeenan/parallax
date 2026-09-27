import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GROUND_BOUNCE_ALBEDO,
  quantizeAnimatedEnvironmentLightingPhase,
  SUN_LIGHT_SCALE,
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

describe("calibrated lighting (engine package 5)", () => {
  const luminance = (rgb: readonly number[]) =>
    0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);

  it("reproduces the paving source's Cycles sun and sky at 30° in clear weather", () => {
    const day = sampleEnvironmentLighting(30 / 360, "clear");
    // lighting/calibrate.py: white Lambert plane radiance under sun only and sky only.
    const sunOnWhite = day.sunColor.map(
      (channel) => channel * day.sunLightIntensity * day.sunElevation,
    );
    const cyclesSun = [0.7268, 0.6396, 0.5233];
    const cyclesSky = [0.0854, 0.133, 0.2107];
    // Within 1%: Cycles samples the 0.6° sun disc.
    for (const [index, value] of sunOnWhite.entries())
      expect(Math.abs(value / (cyclesSun[index] ?? 1) - 1)).toBeLessThan(0.01);
    for (const [index, value] of day.pbrSky.entries())
      expect(value).toBeCloseTo(cyclesSky[index] ?? 0, 2);
    expect(day.sunLightIntensity).toBeCloseTo(SUN_LIGHT_SCALE, 12);
    expect(day.exposure).toBeCloseTo(1, 2);
  });

  it("keeps states ordered: clear > overcast > storm > night in exposed key", () => {
    const exposedKey = (phase: number, weather: "clear" | "overcast" | "storm") => {
      const sample = sampleEnvironmentLighting(phase, weather);
      const sun = sample.sunColor.map(
        (channel) => channel * sample.sunLightIntensity * Math.max(0, sample.sunElevation),
      );
      return (luminance(sun) + luminance(sample.pbrSky)) * sample.exposure;
    };
    const clear = exposedKey(30 / 360, "clear");
    const overcast = exposedKey(30 / 360, "overcast");
    const storm = exposedKey(30 / 360, "storm");
    const night = exposedKey(0.75, "clear");
    expect(clear).toBeGreaterThan(overcast);
    expect(overcast).toBeGreaterThan(storm);
    expect(storm).toBeGreaterThan(night);
    // Night stays readable: at least a tenth of the daylight key after adaptation.
    expect(night).toBeGreaterThan(clear * 0.1);
  });

  it("bounds exposure and the ambient for every state", () => {
    for (const weather of ["clear", "overcast", "storm"] as const)
      for (let index = 0; index < 96; index += 1) {
        const sample = sampleEnvironmentLighting(index / 96, weather);
        expect(sample.exposure).toBeGreaterThanOrEqual(0.6);
        expect(sample.exposure).toBeLessThanOrEqual(16);
        for (const channel of [...sample.pbrSky, ...sample.pbrGround]) {
          expect(Number.isFinite(channel)).toBe(true);
          expect(channel).toBeGreaterThan(0);
        }
        expect(sample.sunLightIntensity).toBeCloseTo(sample.sunIntensity * SUN_LIGHT_SCALE, 12);
      }
  });
});

describe("lighting on every orientation (engine package 7)", () => {
  const calibration = JSON.parse(
    readFileSync(
      new URL(
        "../../assets/source/d1-walls/proof-2026-09-27/lighting/calibration/calibration.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    probes: {
      case: string;
      elevationDeg: number;
      orientation: string;
      normal: [number, number, number];
      toSun: [number, number, number];
      skyOnlyRadiance: [number, number, number];
    }[];
  };

  // The ambient plugin's diffuse term for a sky-only probe (source frame, z up), relative to the
  // up-facing sky: the shaped dome plus the ground's bounce of that sky.
  const skyOnly = (
    shape: readonly number[],
    normal: readonly number[],
    toSun: readonly number[],
    channel: number,
  ) => {
    const hl = Math.hypot(toSun[0] ?? 0, toSun[1] ?? 0);
    const hx = (toSun[0] ?? 0) / hl;
    const hy = (toSun[1] ?? 0) / hl;
    const y = normal[2] ?? 0;
    const h = (normal[0] ?? 0) * hx + (normal[1] ?? 0) * hy;
    const s = (normal[0] ?? 0) * hy - (normal[1] ?? 0) * hx;
    const terms = [1, y, y * y, h, h * y, s * s, h * h * y * y, s ** 4, h ** 3 * y];
    const dome = terms.reduce((sum, term, k) => sum + term * (shape[k * 3 + channel] ?? 0), 0);
    return Math.max(0, dome) + (GROUND_BOUNCE_ALBEDO[channel] ?? 0) * (1 - y) * 0.5;
  };

  it("follows the source's clear Cycles sky at every measured sun elevation", () => {
    const sweep = (
      calibration as unknown as {
        sweep: { elevationDeg: number; orientation: string; skyOnlyRadiance: number[] }[];
      }
    ).sweep
      // Below 12° the game's twilight fade (daylight < 1) dims the sky by design.
      .filter((p) => p.orientation === "up" && p.elevationDeg >= 12);
    expect(sweep.length).toBe(7);
    for (const probe of sweep) {
      const { pbrSky } = sampleEnvironmentLighting(probe.elevationDeg / 360, "clear");
      for (const channel of [0, 1, 2])
        expect(
          Math.abs((pbrSky[channel] ?? 0) / (probe.skyOnlyRadiance[channel] ?? 1) - 1),
          `${probe.elevationDeg}°`,
        ).toBeLessThan(0.01);
    }
  });

  it("keeps an upward surface's sky exactly: the paving's calibrated look", () => {
    for (let degrees = 1; degrees < 90; degrees += 1) {
      const shape = sampleEnvironmentLighting(degrees / 360, "clear").pbrSkyShape;
      for (const channel of [0, 1, 2])
        expect(skyOnly(shape, [0, 0, 1], [1, 0, 0], channel)).toBeCloseTo(1, 3);
    }
  });

  it("matches the source's Cycles sky on every probe orientation within 3%", () => {
    const cases = ["wall-key-38", "paving-day-30", "wall-low-12"];
    for (const name of cases) {
      const probes = calibration.probes.filter((p) => p.case === name);
      const up = probes.find((p) => p.orientation === "up");
      if (up === undefined) throw new Error(`No up probe for ${name}`);
      const { pbrSkyShape } = sampleEnvironmentLighting(up.elevationDeg / 360, "clear");
      for (const probe of probes)
        for (const channel of [0, 1, 2]) {
          const cycles = (probe.skyOnlyRadiance[channel] ?? 0) / (up.skyOnlyRadiance[channel] ?? 1);
          const model = skyOnly(pbrSkyShape, probe.normal, probe.toSun, channel);
          expect(Math.abs(model / cycles - 1), `${name} ${probe.orientation}`).toBeLessThan(0.03);
        }
    }
  });

  it("flattens toward a uniform dome as weather hides the sun", () => {
    const clear = sampleEnvironmentLighting(30 / 360, "clear").pbrSkyShape;
    const storm = sampleEnvironmentLighting(30 / 360, "storm").pbrSkyShape;
    const sunward = [1, 0, 0];
    const antisun = [-1, 0, 0];
    const contrast = (shape: readonly number[]) =>
      skyOnly(shape, sunward, [1, 0, 0], 1) / skyOnly(shape, antisun, [1, 0, 0], 1);
    expect(contrast(clear)).toBeGreaterThan(1.3);
    expect(contrast(storm)).toBeLessThan(contrast(clear));
  });
});
