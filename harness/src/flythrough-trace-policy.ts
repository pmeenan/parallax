import type { DeadlineObservation } from "./presentation-trace.js";
import { FLYTHROUGH_D1_TRACE_COMPLETION_TIMEOUT_MS } from "./runs/flythrough-d1.js";

export interface FlythroughTraceCompletion {
  readonly dataLossOccurred: boolean;
}

export function requireValidFlythroughTraceCompletion(
  observation: DeadlineObservation<FlythroughTraceCompletion>,
): void {
  if (observation.exceededDeadline) {
    throw new Error(
      `Flythrough trace end/completion exceeded the ${FLYTHROUGH_D1_TRACE_COMPLETION_TIMEOUT_MS} ms validity deadline but completed after ${observation.elapsedMs.toFixed(1)} ms`,
    );
  }
  if (observation.value.dataLossOccurred) {
    throw new Error("Chrome reported flythrough trace data loss");
  }
}
