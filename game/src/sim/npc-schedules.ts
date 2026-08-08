import type { SimulationWorldDefinition } from "@parallax/engine";
import type { DeterministicNavigationMesh, NavigationPath } from "./deterministic-navigation";

const SCHEDULE_TAG_PREFIX = "npc-schedule:";
const STOP_TAG_PREFIX = "npc-stop:";

export interface NpcScheduleRoute {
  readonly id: string;
  readonly segments: readonly NavigationPath[];
  readonly stops: readonly (readonly [number, number, number])[];
}

export interface NpcScheduleSet {
  readonly expandedNodeCount: number;
  readonly pathNodeCount: number;
  readonly pathQueryCount: number;
  readonly routes: readonly NpcScheduleRoute[];
}

interface AuthoredStop {
  readonly id: string;
  readonly order: number;
  readonly position: readonly [number, number, number];
}

export function buildNpcScheduleSet(
  world: SimulationWorldDefinition,
  navigation: DeterministicNavigationMesh,
): NpcScheduleSet {
  const stopsBySchedule = new Map<string, AuthoredStop[]>();
  for (const marker of world.markers) {
    if (marker.kind !== "path") continue;
    const scheduleTags = marker.tags.filter((tag) => tag.startsWith(SCHEDULE_TAG_PREFIX));
    const stopTags = marker.tags.filter((tag) => tag.startsWith(STOP_TAG_PREFIX));
    if (scheduleTags.length === 0 && stopTags.length === 0) continue;
    if (scheduleTags.length !== 1 || stopTags.length !== 1) {
      throw new Error(`NPC schedule marker ${marker.id} requires one schedule and one stop tag`);
    }
    const scheduleId = scheduleTags[0]?.slice(SCHEDULE_TAG_PREFIX.length) ?? "";
    const orderText = stopTags[0]?.slice(STOP_TAG_PREFIX.length) ?? "";
    const order = Number(orderText);
    if (
      scheduleId === "" ||
      !/^(?:0|[1-9][0-9]*)$/u.test(orderText) ||
      !Number.isSafeInteger(order)
    ) {
      throw new Error(`NPC schedule marker ${marker.id} has invalid authored tags`);
    }
    const stops = stopsBySchedule.get(scheduleId) ?? [];
    stops.push(Object.freeze({ id: marker.id, order, position: marker.position }));
    stopsBySchedule.set(scheduleId, stops);
  }
  const routes: NpcScheduleRoute[] = [];
  let expandedNodeCount = 0;
  let pathNodeCount = 0;
  let pathQueryCount = 0;
  for (const scheduleId of [...stopsBySchedule.keys()].sort()) {
    const authoredStops = (stopsBySchedule.get(scheduleId) ?? []).toSorted(
      (left, right) =>
        left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
    if (authoredStops.length < 2) {
      throw new Error(`NPC schedule ${scheduleId} requires at least two authored stops`);
    }
    for (const [index, stop] of authoredStops.entries()) {
      if (stop.order !== index) {
        throw new Error(`NPC schedule ${scheduleId} stop order must be contiguous from zero`);
      }
    }
    const segments = authoredStops.map((stop, index) => {
      const previous = authoredStops[(index + authoredStops.length - 1) % authoredStops.length];
      if (previous === undefined) throw new Error(`NPC schedule ${scheduleId} lost a stop`);
      const path = navigation.findPath(previous.position, stop.position);
      expandedNodeCount += path.expandedNodeCount;
      pathNodeCount += path.nodes.length;
      pathQueryCount += 1;
      return path;
    });
    routes.push(
      Object.freeze({
        id: scheduleId,
        segments: Object.freeze(segments),
        stops: Object.freeze(authoredStops.map((stop) => stop.position)),
      }),
    );
  }
  if (routes.length === 0) throw new Error("The simulation world has no authored NPC schedules");
  return Object.freeze({
    expandedNodeCount,
    pathNodeCount,
    pathQueryCount,
    routes: Object.freeze(routes),
  });
}
