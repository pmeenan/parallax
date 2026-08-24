import type {
  EnvironmentTimeOfDayPhase,
  EnvironmentWeatherState,
  WorldBounds,
  WorldVec3,
} from "../world/world-contract";

export type FlythroughWeatherState = EnvironmentWeatherState;

export interface FlythroughEnvironmentPhase {
  readonly endMs: number;
  readonly id: string;
  readonly startMs: number;
  readonly timeOfDay: "dawn" | "daylight" | "dusk" | "night";
  readonly timeOfDayPhase: EnvironmentTimeOfDayPhase;
  readonly weather: FlythroughWeatherState;
}

export interface FlythroughScenario {
  readonly camera: Readonly<{
    readonly beta: number;
    readonly heightMeters: number;
    readonly radiusMeters: number;
  }>;
  readonly durationMs: number;
  readonly environmentPhases: readonly FlythroughEnvironmentPhase[];
  readonly id: string;
  readonly path: readonly WorldVec3[];
  readonly schemaVersion: 1;
  readonly speedMetersPerSecond: number;
}

export interface FlythroughScenarioSample {
  readonly distanceMeters: number;
  readonly elapsedMs: number;
  readonly environment: FlythroughEnvironmentPhase;
  readonly headingRadians: number;
  readonly observer: WorldVec3;
  readonly progress: number;
}

export interface FlythroughScenarioValidation {
  readonly distanceMeters: number;
  readonly durationMs: number;
  readonly environmentPhaseIds: readonly string[];
  readonly scenarioId: string;
}

export interface FlythroughCameraPose {
  readonly position: WorldVec3;
  readonly target: WorldVec3;
}

export type FlythroughRouteSpanMinimum = readonly [number, number, number];

const DISTANCE_TOLERANCE_METERS = 1e-6;
const WEATHER_STATES: ReadonlySet<unknown> = new Set(["clear", "overcast", "storm"]);
const TIME_OF_DAY_STATES: ReadonlySet<unknown> = new Set(["dawn", "daylight", "dusk", "night"]);

export function validateFlythroughScenario(
  scenario: FlythroughScenario,
  bounds: WorldBounds,
): FlythroughScenarioValidation {
  if (
    scenario.schemaVersion !== 1 ||
    scenario.id === "" ||
    !positiveFinite(scenario.durationMs) ||
    !positiveFinite(scenario.speedMetersPerSecond) ||
    scenario.path.length < 2 ||
    !positiveFinite(scenario.camera.radiusMeters) ||
    !positiveFinite(scenario.camera.heightMeters) ||
    !Number.isFinite(scenario.camera.beta) ||
    scenario.camera.beta <= 0 ||
    scenario.camera.beta >= Math.PI
  ) {
    throw new Error("Flythrough scenario header is invalid");
  }
  if (!orderedFiniteWorldBounds(bounds)) {
    throw new Error("Flythrough district bounds are invalid");
  }
  const [minimumX, minimumY, minimumZ] = bounds.minimum;
  const [maximumX, maximumY, maximumZ] = bounds.maximum;
  for (const point of scenario.path) {
    const [x, y, z] = point;
    if (
      point.length !== 3 ||
      point.some((component) => !Number.isFinite(component)) ||
      x < minimumX ||
      x > maximumX ||
      y < minimumY ||
      y > maximumY ||
      z < minimumZ ||
      z > maximumZ
    ) {
      throw new Error("Flythrough path leaves the district bounds");
    }
  }
  const segmentLengths = scenario.path.slice(1).map((point, index) => {
    const previous = pathPoint(scenario.path, index);
    const length = Math.hypot(
      point[0] - previous[0],
      point[1] - previous[1],
      point[2] - previous[2],
    );
    if (!positiveFinite(length)) throw new Error("Flythrough path contains an empty segment");
    return length;
  });
  const distanceMeters = segmentLengths.reduce((sum, length) => sum + length, 0);
  const expectedDistanceMeters = (scenario.durationMs / 1_000) * scenario.speedMetersPerSecond;
  if (Math.abs(distanceMeters - expectedDistanceMeters) > DISTANCE_TOLERANCE_METERS) {
    throw new Error(
      `Flythrough path distance ${distanceMeters} does not match ${expectedDistanceMeters}`,
    );
  }

  const phaseIds = new Set<string>();
  const weatherStates = new Set<FlythroughWeatherState>();
  const timeOfDayStates = new Set<FlythroughEnvironmentPhase["timeOfDay"]>();
  let nextStartMs = 0;
  for (const phase of scenario.environmentPhases) {
    if (
      phase.id === "" ||
      phaseIds.has(phase.id) ||
      phase.startMs !== nextStartMs ||
      !Number.isFinite(phase.endMs) ||
      phase.endMs <= phase.startMs ||
      !WEATHER_STATES.has(phase.weather) ||
      !TIME_OF_DAY_STATES.has(phase.timeOfDay) ||
      !Number.isFinite(phase.timeOfDayPhase) ||
      phase.timeOfDayPhase < 0 ||
      phase.timeOfDayPhase >= 1
    ) {
      throw new Error("Flythrough environment phases are not contiguous and valid");
    }
    phaseIds.add(phase.id);
    weatherStates.add(phase.weather);
    timeOfDayStates.add(phase.timeOfDay);
    nextStartMs = phase.endMs;
  }
  if (
    nextStartMs !== scenario.durationMs ||
    weatherStates.size !== 3 ||
    !(["dawn", "daylight", "dusk", "night"] as const).every((state) => timeOfDayStates.has(state))
  ) {
    throw new Error("Flythrough environment schedule does not cover the binding state sweep");
  }
  return Object.freeze({
    distanceMeters,
    durationMs: scenario.durationMs,
    environmentPhaseIds: Object.freeze([...phaseIds]),
    scenarioId: scenario.id,
  });
}

export function sampleFlythroughScenario(
  scenario: FlythroughScenario,
  elapsedMs: number,
): FlythroughScenarioSample {
  if (!Number.isFinite(elapsedMs)) throw new Error("Flythrough elapsed time must be finite");
  const clampedElapsedMs = Math.min(scenario.durationMs, Math.max(0, elapsedMs));
  const distanceMeters = Math.min(
    (clampedElapsedMs / 1_000) * scenario.speedMetersPerSecond,
    pathDistance(scenario.path),
  );
  let remaining = distanceMeters;
  let observer = pathPoint(scenario.path, 0);
  let headingRadians = 0;
  for (let index = 1; index < scenario.path.length; index += 1) {
    const start = pathPoint(scenario.path, index - 1);
    const end = pathPoint(scenario.path, index);
    const segmentLength = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
    headingRadians = Math.atan2(end[0] - start[0], end[2] - start[2]);
    if (remaining <= segmentLength || index === scenario.path.length - 1) {
      const fraction = Math.min(1, remaining / segmentLength);
      observer = Object.freeze([
        start[0] + (end[0] - start[0]) * fraction,
        start[1] + (end[1] - start[1]) * fraction,
        start[2] + (end[2] - start[2]) * fraction,
      ]);
      break;
    }
    remaining -= segmentLength;
  }
  const environment =
    scenario.environmentPhases.find(
      (phase) =>
        clampedElapsedMs >= phase.startMs &&
        (clampedElapsedMs < phase.endMs ||
          (clampedElapsedMs === scenario.durationMs && phase.endMs === scenario.durationMs)),
    ) ?? scenario.environmentPhases.at(-1);
  if (environment === undefined) throw new Error("Flythrough environment schedule is empty");
  return Object.freeze({
    distanceMeters,
    elapsedMs: clampedElapsedMs,
    environment,
    headingRadians,
    observer,
    progress: clampedElapsedMs / scenario.durationMs,
  });
}

export function flythroughCameraPose(
  sample: FlythroughScenarioSample,
  camera: FlythroughScenario["camera"],
): FlythroughCameraPose {
  const target = Object.freeze([
    sample.observer[0],
    sample.observer[1] + camera.heightMeters,
    sample.observer[2],
  ]) satisfies WorldVec3;
  const alpha = sample.headingRadians + Math.PI;
  const horizontalRadius = camera.radiusMeters * Math.sin(camera.beta);
  return Object.freeze({
    position: Object.freeze([
      target[0] + horizontalRadius * Math.cos(alpha),
      target[1] + camera.radiusMeters * Math.cos(camera.beta),
      target[2] + horizontalRadius * Math.sin(alpha),
    ]) satisfies WorldVec3,
    target,
  });
}

/**
 * Derives the minimum observed camera/target coverage from the route itself. An axis
 * that retraces can miss a bounded part of an extremum between sampled frames, so the
 * contract tolerates one third of that retraced distance (or up to 100 ms of route
 * travel, capped at one percent of the axis span). For D1 this reproduces the authoritative 2,000 m X and
 * 2,800 m Z gates without embedding district-specific constants in a validator.
 */
export function minimumObservedFlythroughRouteSpan(
  scenario: FlythroughScenario,
): FlythroughRouteSpanMinimum {
  return Object.freeze(
    ([0, 1, 2] as const).map((axis) => {
      const values = scenario.path.map((point) => point[axis]);
      const minimum = Math.min(...values);
      const maximum = Math.max(...values);
      const span = maximum - minimum;
      const samplingToleranceMeters = Math.min(scenario.speedMetersPerSecond / 10, span / 100);
      const travel = scenario.path.slice(1).reduce((sum, point, index) => {
        const previous = pathPoint(scenario.path, index);
        return sum + Math.abs(point[axis] - previous[axis]);
      }, 0);
      return Math.max(0, span - Math.max((travel - span) / 3, samplingToleranceMeters));
    }),
  ) as FlythroughRouteSpanMinimum;
}

function pathDistance(path: readonly WorldVec3[]): number {
  return path.slice(1).reduce((sum, point, index) => {
    const previous = pathPoint(path, index);
    return sum + Math.hypot(point[0] - previous[0], point[1] - previous[1], point[2] - previous[2]);
  }, 0);
}

function pathPoint(path: readonly WorldVec3[], index: number): WorldVec3 {
  const point = path[index];
  if (point === undefined) throw new Error(`Flythrough path point ${index} is missing`);
  return point;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function orderedFiniteWorldBounds(bounds: WorldBounds): boolean {
  return bounds.minimum.every((component, index) => {
    const maximum = bounds.maximum[index];
    return (
      maximum !== undefined &&
      Number.isFinite(component) &&
      Number.isFinite(maximum) &&
      component <= maximum
    );
  });
}
