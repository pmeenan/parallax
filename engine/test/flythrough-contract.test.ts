import { describe, expect, it } from "vitest";
import type { FlythroughScenario } from "../src/flythrough/flythrough-contract";
import {
  flythroughCameraPose,
  sampleFlythroughScenario,
  validateFlythroughScenario,
} from "../src/flythrough/flythrough-contract";

const bounds = Object.freeze({
  maximum: Object.freeze([2_048, 256, 2_048] as const),
  minimum: Object.freeze([-2_048, -32, -2_048] as const),
});

function scenario(): FlythroughScenario {
  return {
    camera: { beta: 1, heightMeters: 20, radiusMeters: 100 },
    durationMs: 1_000,
    environmentPhases: [
      {
        endMs: 250,
        id: "clear-day",
        startMs: 0,
        timeOfDay: "daylight",
        timeOfDayPhase: 0.25,
        weather: "clear",
      },
      {
        endMs: 500,
        id: "overcast-dawn",
        startMs: 250,
        timeOfDay: "dawn",
        timeOfDayPhase: 0,
        weather: "overcast",
      },
      {
        endMs: 750,
        id: "storm-dusk",
        startMs: 500,
        timeOfDay: "dusk",
        timeOfDayPhase: 0.5,
        weather: "storm",
      },
      {
        endMs: 1_000,
        id: "storm-night",
        startMs: 750,
        timeOfDay: "night",
        timeOfDayPhase: 0.75,
        weather: "storm",
      },
    ],
    id: "test@1",
    path: [
      [0, 0, 0],
      [0, 0, 12],
    ],
    schemaVersion: 1,
    speedMetersPerSecond: 12,
  };
}

describe("flythrough scenario contract", () => {
  it("validates and samples the exact distance-based path", () => {
    expect(validateFlythroughScenario(scenario(), bounds)).toMatchObject({
      distanceMeters: 12,
      durationMs: 1_000,
      scenarioId: "test@1",
    });
    expect(sampleFlythroughScenario(scenario(), 500)).toMatchObject({
      distanceMeters: 6,
      elapsedMs: 500,
      observer: [0, 0, 6],
      progress: 0.5,
    });
    expect(sampleFlythroughScenario(scenario(), 1_000)).toMatchObject({
      distanceMeters: 12,
      observer: [0, 0, 12],
    });
    const midpoint = sampleFlythroughScenario(scenario(), 500);
    const pose = flythroughCameraPose(midpoint, scenario().camera);
    expect(pose).toMatchObject({
      target: [0, 20, 6],
    });
    expect(
      Math.hypot(
        pose.position[0] - pose.target[0],
        pose.position[1] - pose.target[1],
        pose.position[2] - pose.target[2],
      ),
    ).toBeCloseTo(100);
  });

  it("rejects distance drift and incomplete environment coverage", () => {
    expect(() =>
      validateFlythroughScenario({ ...scenario(), speedMetersPerSecond: 11 }, bounds),
    ).toThrow("path distance");
    expect(() =>
      validateFlythroughScenario(
        {
          ...scenario(),
          environmentPhases: scenario().environmentPhases.filter(
            (phase) => phase.weather !== "overcast",
          ),
        },
        bounds,
      ),
    ).toThrow();
  });

  it("rejects non-finite or inverted district bounds before path containment", () => {
    expect(() =>
      validateFlythroughScenario(scenario(), {
        maximum: [Number.POSITIVE_INFINITY, 256, 2_048],
        minimum: [-2_048, -32, -2_048],
      }),
    ).toThrow("district bounds");
    expect(() =>
      validateFlythroughScenario(scenario(), {
        maximum: [-2_049, 256, 2_048],
        minimum: [-2_048, -32, -2_048],
      }),
    ).toThrow("district bounds");
  });

  it("rejects unknown runtime weather and time-of-day strings", () => {
    const base = scenario();
    expect(() =>
      validateFlythroughScenario(
        {
          ...base,
          environmentPhases: base.environmentPhases.map((phase, index) =>
            index === 0 ? { ...phase, weather: "hail" } : phase,
          ),
        } as FlythroughScenario,
        bounds,
      ),
    ).toThrow();
    expect(() =>
      validateFlythroughScenario(
        {
          ...base,
          environmentPhases: base.environmentPhases.map((phase, index) =>
            index === 0 ? { ...phase, timeOfDay: "noon" } : phase,
          ),
        } as FlythroughScenario,
        bounds,
      ),
    ).toThrow();
  });
});
