import type { WorldVec3 } from "../world/world-contract";
import {
  STREAMING_DECODE_WORKER_MAXIMUM,
  STREAMING_DECODE_WORKER_RESERVED_THREADS,
  type StreamingCellIndexEntry,
  type StreamingDistrictIndex,
} from "./streaming-protocol";

export interface StreamingSchedule {
  readonly evict: readonly StreamingCellIndexEntry[];
  readonly load: readonly StreamingCellIndexEntry[];
  readonly target: readonly StreamingCellIndexEntry[];
}

function distanceToCell(
  entry: StreamingCellIndexEntry,
  index: StreamingDistrictIndex,
  observers: readonly WorldVec3[],
): number {
  const minimumX = index.bounds.minimum[0] + entry.coordinate[0] * index.cellSizeMeters;
  const minimumZ = index.bounds.minimum[2] + entry.coordinate[1] * index.cellSizeMeters;
  const maximumX = minimumX + index.cellSizeMeters;
  const maximumZ = minimumZ + index.cellSizeMeters;
  return Math.min(
    ...observers.map((observer) => {
      const nearestX = Math.max(minimumX, Math.min(observer[0], maximumX));
      const nearestZ = Math.max(minimumZ, Math.min(observer[2], maximumZ));
      return Math.hypot(observer[0] - nearestX, observer[2] - nearestZ);
    }),
  );
}

export function scheduleStreamingCells(
  index: StreamingDistrictIndex,
  observers: readonly WorldVec3[],
  residentCellIds: ReadonlySet<string>,
  residentCellLimit: number,
): StreamingSchedule {
  if (observers.length === 0) throw new Error("Streaming requires at least one observer");
  if (!Number.isInteger(residentCellLimit) || residentCellLimit < 1) {
    throw new Error("Streaming resident-cell limit must be a positive integer");
  }
  for (const observer of observers) {
    if (observer.length !== 3 || observer.some((component) => !Number.isFinite(component))) {
      throw new Error("Streaming observer must be a finite vec3");
    }
  }
  const ranked = index.cells
    .map((entry) => Object.freeze({ distance: distanceToCell(entry, index, observers), entry }))
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.entry.coordinate[1] - right.entry.coordinate[1] ||
        left.entry.coordinate[0] - right.entry.coordinate[0],
    );
  const target = ranked.slice(0, residentCellLimit).map(({ entry }) => entry);
  const targetIds = new Set(target.map(({ cellId }) => cellId));
  const load = target.filter(({ cellId }) => !residentCellIds.has(cellId));
  const evict = ranked
    .filter(({ entry }) => residentCellIds.has(entry.cellId) && !targetIds.has(entry.cellId))
    .sort((left, right) => right.distance - left.distance)
    .map(({ entry }) => entry);
  return Object.freeze({
    evict: Object.freeze(evict),
    load: Object.freeze(load),
    target: Object.freeze(target),
  });
}

export function streamingDecodeWorkerCount(hardwareConcurrency: number): number {
  const available = Number.isFinite(hardwareConcurrency)
    ? Math.max(1, Math.floor(hardwareConcurrency) - STREAMING_DECODE_WORKER_RESERVED_THREADS)
    : 1;
  return Math.min(STREAMING_DECODE_WORKER_MAXIMUM, available);
}
