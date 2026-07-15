// Converts a telemetry frameCount observed *after* a measurement start marker was
// placed into a window start that provably follows the marker. Telemetry publishes
// frame samples once per batch of `batchFrames` rendered frames, so the observed count
// can trail the true rendered count by up to batchFrames - 1 frames. Invariant: because
// the marker precedes the read, the true rendered count at the marker is at most
// observedFrameCount + batchFrames - 1, so every frame with index greater than the
// returned window start (the frames selectMeasurementFrameWindow selects) was rendered
// strictly after the marker.
export function markerAlignedWindowStart(observedFrameCount: number, batchFrames: number): number {
  if (!Number.isInteger(observedFrameCount) || observedFrameCount < 0) {
    throw new Error(
      `Observed frame count must be a non-negative integer; received ${observedFrameCount}`,
    );
  }
  if (!Number.isInteger(batchFrames) || batchFrames <= 0) {
    throw new Error(
      `Telemetry frame batch size must be a positive integer; received ${batchFrames}`,
    );
  }
  return observedFrameCount + batchFrames;
}

export interface FrameWindowSelectionOptions<T> {
  readonly measurementFrames: number;
  readonly recentFrames: readonly T[];
  readonly snapshotFrameCount: number;
  readonly startFrameCount: number;
}

// Selects the measurement window (startFrameCount, startFrameCount + measurementFrames]
// from a telemetry ring buffer whose last element is frame #snapshotFrameCount. The
// snapshot is read after the window ends, so `drop` trailing frames rendered between the
// end of the window and the snapshot read must be discarded deterministically instead of
// letting the analyzed window slide with CDP latency.
export function selectMeasurementFrameWindow<T>(
  options: FrameWindowSelectionOptions<T>,
): readonly T[] {
  const { measurementFrames, recentFrames, snapshotFrameCount, startFrameCount } = options;
  if (!Number.isInteger(measurementFrames) || measurementFrames <= 0) {
    throw new Error(
      `Measurement window size must be a positive integer; received ${measurementFrames}`,
    );
  }
  const drop = snapshotFrameCount - (startFrameCount + measurementFrames);
  if (drop < 0) {
    throw new Error(
      `Snapshot frame count ${snapshotFrameCount} precedes the end of the measurement window (frame ${startFrameCount + measurementFrames})`,
    );
  }
  const required = measurementFrames + drop;
  if (recentFrames.length < required) {
    throw new Error(
      `Measurement window frames were evicted from telemetry retention; the measurement is invalid: required the trailing ${required} frames (${measurementFrames} window + ${drop} after the end marker) but only ${recentFrames.length} are retained`,
    );
  }
  return Object.freeze(
    recentFrames.slice(recentFrames.length - required, recentFrames.length - drop),
  );
}
