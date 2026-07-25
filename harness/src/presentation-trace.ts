export const PRESENTATION_TRACE_START_MARKER = "parallax-presentation-window-start";
export const PRESENTATION_TRACE_END_MARKER = "parallax-presentation-window-end";
export const PRESENTATION_TRACE_CATEGORY = "disabled-by-default-display.framedisplayed";
export const PRESENTATION_TRACE_EVENT = "Display::FrameDisplayed";

export interface ChromeTraceEvent {
  readonly args?: Readonly<Record<string, unknown>>;
  readonly cat?: string;
  readonly dur?: number;
  readonly id?: number | string;
  readonly name: string;
  readonly ph: string;
  readonly pid: number;
  readonly tid: number;
  readonly ts: number;
}

export interface DeadlineObservation<T> {
  readonly elapsedMs: number;
  readonly exceededDeadline: boolean;
  readonly value: T;
}

export function uniqueGpuProcessId(events: readonly ChromeTraceEvent[]): number {
  const processIds = new Set(
    events
      .filter(
        (event) =>
          event.name === "process_name" && event.ph === "M" && event.args?.name === "GPU Process",
      )
      .map((event) => event.pid),
  );
  if (processIds.size !== 1) {
    throw new Error(`Expected one traced GPU process; received ${processIds.size}`);
  }
  const processId = processIds.values().next().value;
  if (processId === undefined) throw new Error("Traced GPU process ID is missing");
  return processId;
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs} ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export function observeThroughLateCompletionWindow<T>(
  promise: Promise<T>,
  deadlineMs: number,
  lateObservationMs: number,
  label: string,
): Promise<DeadlineObservation<T>> {
  if (!(deadlineMs > 0) || !(lateObservationMs > 0)) {
    throw new Error("Completion deadline and late-observation window must both be positive");
  }
  const startedAtMs = performance.now();
  const observationTimeoutMs = deadlineMs + lateObservationMs;
  return new Promise<DeadlineObservation<T>>((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new Error(
            `${label} did not complete during the ${observationTimeoutMs} ms observation bound (${deadlineMs} ms validity deadline plus ${lateObservationMs} ms late window)`,
          ),
        ),
      observationTimeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timeout);
        const elapsedMs = performance.now() - startedAtMs;
        resolve(
          Object.freeze({
            elapsedMs,
            exceededDeadline: elapsedMs > deadlineMs,
            value,
          }),
        );
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export function extractVizPresentationFeedbackCallbackIntervalsMs(
  events: readonly ChromeTraceEvent[],
): readonly number[] {
  const start = uniqueEvent(events, PRESENTATION_TRACE_START_MARKER);
  const end = uniqueEvent(events, PRESENTATION_TRACE_END_MARKER);
  if (start.pid !== end.pid) {
    throw new Error("Viz callback-window markers came from different renderer processes");
  }
  if (end.ts <= start.ts) throw new Error("Viz callback-window markers are out of order");

  const gpuProcessId = uniqueGpuProcessId(events);

  const presentations = events
    .filter((event) => event.name === PRESENTATION_TRACE_EVENT && event.pid === gpuProcessId)
    .sort((left, right) => left.ts - right.ts);
  const tracks = new Set(presentations.map((event) => `${event.pid}:${event.tid}`));
  if (tracks.size !== 1) {
    throw new Error(
      `Expected one Viz presentation-feedback callback track; received ${tracks.size}`,
    );
  }
  const firstInsideIndex = presentations.findIndex((event) => event.ts >= start.ts);
  if (firstInsideIndex < 1) {
    throw new Error("Viz callback trace is missing the interval crossing the start marker");
  }
  const endBoundaryIndex = presentations.findIndex((event) => event.ts >= end.ts);
  if (endBoundaryIndex <= firstInsideIndex) {
    throw new Error("Viz callback trace is missing the interval crossing the end marker");
  }
  const boundedPresentations = presentations.slice(firstInsideIndex - 1, endBoundaryIndex + 1);

  const intervals = boundedPresentations.slice(1).map((event, index) => {
    const previous = boundedPresentations[index];
    if (previous === undefined) throw new Error("Viz callback trace lost its preceding event");
    const intervalMs = (event.ts - previous.ts) / 1_000;
    if (!Number.isFinite(intervalMs) || intervalMs < 0) {
      throw new Error(`Invalid Viz presentation-feedback callback interval ${intervalMs}`);
    }
    return intervalMs;
  });
  return Object.freeze(intervals);
}

function uniqueEvent(events: readonly ChromeTraceEvent[], name: string): ChromeTraceEvent {
  const matches = events.filter((event) => event.name === name && event.ph === "I");
  if (matches.length !== 1) {
    throw new Error(`Expected one ${name} trace marker; received ${matches.length}`);
  }
  const event = matches[0];
  if (event === undefined || !Number.isFinite(event.ts)) {
    throw new Error(`${name} trace marker has an invalid timestamp`);
  }
  return event;
}
