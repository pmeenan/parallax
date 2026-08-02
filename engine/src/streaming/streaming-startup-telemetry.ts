export const STREAMING_STARTUP_TIMING_CONTRACT = "streaming-startup-timing@1";
export const STREAMING_STARTUP_TIMING_SCHEMA_VERSION = 1;

export type StreamingStartupSourceKind = "installed-release" | "privileged-legacy-network";

export interface StreamingStartupTimingSnapshot {
  readonly accessHandlesOpenedAtMs: number | null;
  readonly contract: typeof STREAMING_STARTUP_TIMING_CONTRACT;
  readonly decodePoolCreatedAtMs: number | null;
  readonly finalAdmissionCompletedAtMs: number | null;
  readonly initialResidencyReadyAtMs: number | null;
  readonly provisioningStartedAtMs: number | null;
  readonly releaseBindingCompletedAtMs: number | null;
  readonly releaseResolutionCompletedAtMs: number | null;
  readonly schemaVersion: typeof STREAMING_STARTUP_TIMING_SCHEMA_VERSION;
  readonly sourceKind: StreamingStartupSourceKind;
  readonly workerStartedAtMs: number;
}

export interface StreamingStartupTimingTracker {
  markAccessHandlesOpened(): void;
  markDecodePoolCreated(): void;
  markFinalAdmissionCompleted(): void;
  markInitialResidencyReady(): void;
  markProvisioningStarted(): void;
  markReleaseBindingCompleted(): void;
  markReleaseResolutionCompleted(): void;
  snapshot(): StreamingStartupTimingSnapshot;
}

export function createStreamingStartupTimingTracker(
  sourceKind: StreamingStartupSourceKind,
  now: () => number = () => performance.now(),
  workerStartedAtMs: number | null = null,
): StreamingStartupTimingTracker {
  const workerStart =
    workerStartedAtMs === null
      ? readClock(now, 0, "worker start")
      : validateTimestamp(workerStartedAtMs, 0, "worker start");
  let provisioningStartedAtMs: number | null = null;
  let releaseBindingCompletedAtMs: number | null = null;
  let releaseResolutionCompletedAtMs: number | null = null;
  let accessHandlesOpenedAtMs: number | null = null;
  let finalAdmissionCompletedAtMs: number | null = null;
  let decodePoolCreatedAtMs: number | null = null;
  let initialResidencyReadyAtMs: number | null = null;

  const mark = (
    label: string,
    current: number | null,
    earliest: number | null,
    assign: (value: number) => void,
  ): void => {
    if (current !== null) throw new Error(`Streaming startup ${label} was already recorded`);
    if (earliest === null) {
      throw new Error(`Streaming startup ${label} was recorded before its prerequisite`);
    }
    assign(readClock(now, earliest, label));
  };

  return Object.freeze({
    markAccessHandlesOpened(): void {
      mark(
        "access handles opened",
        accessHandlesOpenedAtMs,
        releaseResolutionCompletedAtMs,
        (value) => {
          accessHandlesOpenedAtMs = value;
        },
      );
    },
    markDecodePoolCreated(): void {
      const prerequisite =
        sourceKind === "installed-release" ? finalAdmissionCompletedAtMs : accessHandlesOpenedAtMs;
      mark("decode pool created", decodePoolCreatedAtMs, prerequisite, (value) => {
        decodePoolCreatedAtMs = value;
      });
    },
    markFinalAdmissionCompleted(): void {
      if (sourceKind !== "installed-release") {
        throw new Error("Legacy streaming startup cannot record installed-release admission");
      }
      mark(
        "final admission completed",
        finalAdmissionCompletedAtMs,
        accessHandlesOpenedAtMs,
        (value) => {
          finalAdmissionCompletedAtMs = value;
        },
      );
    },
    markInitialResidencyReady(): void {
      mark("initial residency ready", initialResidencyReadyAtMs, decodePoolCreatedAtMs, (value) => {
        initialResidencyReadyAtMs = value;
      });
    },
    markProvisioningStarted(): void {
      mark("provisioning started", provisioningStartedAtMs, workerStart, (value) => {
        provisioningStartedAtMs = value;
      });
    },
    markReleaseBindingCompleted(): void {
      if (sourceKind !== "installed-release") {
        throw new Error("Legacy streaming startup cannot record installed-release binding");
      }
      mark(
        "release binding completed",
        releaseBindingCompletedAtMs,
        provisioningStartedAtMs,
        (value) => {
          releaseBindingCompletedAtMs = value;
        },
      );
    },
    markReleaseResolutionCompleted(): void {
      const prerequisite =
        sourceKind === "installed-release" ? releaseBindingCompletedAtMs : provisioningStartedAtMs;
      mark(
        "release resolution completed",
        releaseResolutionCompletedAtMs,
        prerequisite,
        (value) => {
          releaseResolutionCompletedAtMs = value;
        },
      );
    },
    snapshot(): StreamingStartupTimingSnapshot {
      return Object.freeze({
        accessHandlesOpenedAtMs,
        contract: STREAMING_STARTUP_TIMING_CONTRACT,
        decodePoolCreatedAtMs,
        finalAdmissionCompletedAtMs,
        initialResidencyReadyAtMs,
        provisioningStartedAtMs,
        releaseBindingCompletedAtMs,
        releaseResolutionCompletedAtMs,
        schemaVersion: STREAMING_STARTUP_TIMING_SCHEMA_VERSION,
        sourceKind,
        workerStartedAtMs: workerStart,
      });
    },
  });
}

function readClock(now: () => number, earliest: number, label: string): number {
  return validateTimestamp(now(), earliest, label);
}

function validateTimestamp(value: number, earliest: number, label: string): number {
  if (!Number.isFinite(value) || value < earliest) {
    throw new Error(`Streaming startup ${label} timestamp is invalid`);
  }
  return value;
}
