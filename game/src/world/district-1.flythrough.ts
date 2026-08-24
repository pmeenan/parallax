import type { FlythroughScenario } from "@parallax/engine";
import { STANDARD_TRAVERSAL_SPEED_METERS_PER_SECOND } from "../balance/exploration";

export const DISTRICT_1_FLYTHROUGH = Object.freeze({
  camera: Object.freeze({
    beta: Math.PI / 3,
    heightMeters: 28,
    radiusMeters: 120,
  }),
  durationMs: 600_000,
  environmentPhases: Object.freeze([
    Object.freeze({
      endMs: 100_000,
      id: "clear-daylight-start",
      startMs: 0,
      timeOfDay: "daylight",
      timeOfDayPhase: 0.25,
      weather: "clear",
    }),
    Object.freeze({
      endMs: 200_000,
      id: "overcast-daylight",
      startMs: 100_000,
      timeOfDay: "daylight",
      timeOfDayPhase: 0.25,
      weather: "overcast",
    }),
    Object.freeze({
      endMs: 300_000,
      id: "storm-dusk",
      startMs: 200_000,
      timeOfDay: "dusk",
      timeOfDayPhase: 0.48,
      weather: "storm",
    }),
    Object.freeze({
      endMs: 400_000,
      id: "storm-night",
      startMs: 300_000,
      timeOfDay: "night",
      timeOfDayPhase: 0.75,
      weather: "storm",
    }),
    Object.freeze({
      endMs: 500_000,
      id: "overcast-dawn",
      startMs: 400_000,
      timeOfDay: "dawn",
      timeOfDayPhase: 0.02,
      weather: "overcast",
    }),
    Object.freeze({
      endMs: 600_000,
      id: "clear-daylight-finish",
      startMs: 500_000,
      timeOfDay: "daylight",
      timeOfDayPhase: 0.25,
      weather: "clear",
    }),
  ]),
  id: "flythrough-d1@1",
  path: Object.freeze([
    Object.freeze([0, 12, -1_800] as const),
    Object.freeze([0, 12, 0] as const),
    Object.freeze([1_200, 12, 0] as const),
    Object.freeze([1_200, 12, 1_200] as const),
    Object.freeze([-1_200, 12, 1_200] as const),
    Object.freeze([-1_200, 12, 600] as const),
  ]),
  schemaVersion: 1,
  speedMetersPerSecond: STANDARD_TRAVERSAL_SPEED_METERS_PER_SECOND,
}) satisfies FlythroughScenario;
