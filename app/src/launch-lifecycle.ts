import {
  LAUNCH_LIFECYCLE_CONTRACT,
  LAUNCH_LIFECYCLE_SCHEMA_VERSION,
  STREAMING_STARTUP_TIMING_CONTRACT,
  STREAMING_STARTUP_TIMING_SCHEMA_VERSION,
  type StreamingStartupTimingSnapshot,
} from "@parallax/engine";

export { LAUNCH_LIFECYCLE_CONTRACT, LAUNCH_LIFECYCLE_SCHEMA_VERSION };

export type InstalledRuntimePreflightPhase =
  | "initial-release-admission"
  | "model-source-ready"
  | "streaming-references-ready"
  | "pso-trace-ready"
  | "final-release-admission";

export interface InstalledRuntimePreflightTimingSnapshot {
  readonly finalReleaseAdmissionAtMs: number | null;
  readonly initialReleaseAdmissionAtMs: number | null;
  readonly modelSourceReadyAtMs: number | null;
  readonly psoTraceReadyAtMs: number | null;
  readonly streamingReferencesReadyAtMs: number | null;
}

export type LaunchLifecycleState = "failed" | "idle" | "interactive" | "launching";

export interface LaunchLifecycleSnapshot {
  readonly attempt: number;
  readonly contract: typeof LAUNCH_LIFECYCLE_CONTRACT;
  readonly durationMs: number | null;
  readonly failureMessage: string | null;
  readonly interactiveAtMs: number | null;
  readonly preflightTiming: InstalledRuntimePreflightTimingSnapshot;
  readonly releaseDigest: string | null;
  readonly renderFirstFrameAtMs: number | null;
  readonly schemaVersion: typeof LAUNCH_LIFECYCLE_SCHEMA_VERSION;
  readonly shellAdmissionAtMs: number | null;
  readonly startedAtMs: number | null;
  readonly state: LaunchLifecycleState;
  readonly streamingStartupTiming: StreamingStartupTimingSnapshot | null;
  readonly streamingWorkerRequestedAtMs: number | null;
  readonly streamingReadyAtMs: number | null;
}

export interface LaunchLifecycleTracker {
  begin(releaseDigest: string): void;
  fail(error: unknown): void;
  markInstalledPreflightPhase(phase: InstalledRuntimePreflightPhase): void;
  markRenderFirstFrame(): void;
  markShellAdmission(): void;
  markStreamingReady(startupTiming: StreamingStartupTimingSnapshot): void;
  markStreamingWorkerRequested(): void;
  snapshot(): LaunchLifecycleSnapshot;
}

export function createLaunchLifecycleTracker(
  now: () => number = () => performance.now(),
): LaunchLifecycleTracker {
  let attempt = 0;
  let durationMs: number | null = null;
  let failureMessage: string | null = null;
  let interactiveAtMs: number | null = null;
  let finalReleaseAdmissionAtMs: number | null = null;
  let initialReleaseAdmissionAtMs: number | null = null;
  let modelSourceReadyAtMs: number | null = null;
  let psoTraceReadyAtMs: number | null = null;
  let releaseDigest: string | null = null;
  let renderFirstFrameAtMs: number | null = null;
  let shellAdmissionAtMs: number | null = null;
  let startedAtMs: number | null = null;
  let state: LaunchLifecycleState = "idle";
  let streamingReferencesReadyAtMs: number | null = null;
  let streamingStartupTiming: StreamingStartupTimingSnapshot | null = null;
  let streamingWorkerRequestedAtMs: number | null = null;
  let streamingReadyAtMs: number | null = null;

  const requireLaunching = (milestone: string): number => {
    if (state !== "launching" || startedAtMs === null) {
      throw new Error(`${milestone} requires an active Launch-to-interactive attempt`);
    }
    return startedAtMs;
  };
  const finishIfInteractive = (): void => {
    if (
      state !== "launching" ||
      startedAtMs === null ||
      shellAdmissionAtMs === null ||
      renderFirstFrameAtMs === null ||
      streamingReadyAtMs === null
    ) {
      return;
    }
    const completedAt = now();
    const latestMilestone = Math.max(shellAdmissionAtMs, renderFirstFrameAtMs, streamingReadyAtMs);
    if (
      completedAt < startedAtMs ||
      completedAt < latestMilestone ||
      shellAdmissionAtMs < startedAtMs ||
      streamingWorkerRequestedAtMs === null ||
      renderFirstFrameAtMs < streamingWorkerRequestedAtMs ||
      streamingReadyAtMs < streamingWorkerRequestedAtMs
    ) {
      throw new Error("Launch-to-interactive milestone clock moved backwards");
    }
    interactiveAtMs = completedAt;
    durationMs = completedAt - startedAtMs;
    state = "interactive";
  };
  const mark = (
    milestone: string,
    current: number | null,
    assign: (value: number) => void,
  ): void => {
    if (current !== null) return;
    const started = requireLaunching(milestone);
    const observed = now();
    if (!Number.isFinite(observed) || observed < started) {
      throw new Error(`Launch-to-interactive ${milestone} timestamp is invalid`);
    }
    assign(observed);
    finishIfInteractive();
  };

  return Object.freeze({
    begin(nextReleaseDigest: string): void {
      if (!/^[a-f0-9]{64}$/.test(nextReleaseDigest)) {
        throw new Error("Launch-to-interactive requires an exact release digest");
      }
      if (state !== "idle") {
        throw new Error("Launch-to-interactive attempt has already started on this page");
      }
      const observed = now();
      if (!Number.isFinite(observed) || observed < 0) {
        throw new Error("Launch-to-interactive start timestamp is invalid");
      }
      attempt += 1;
      durationMs = null;
      failureMessage = null;
      interactiveAtMs = null;
      finalReleaseAdmissionAtMs = null;
      initialReleaseAdmissionAtMs = null;
      modelSourceReadyAtMs = null;
      psoTraceReadyAtMs = null;
      releaseDigest = nextReleaseDigest;
      renderFirstFrameAtMs = null;
      shellAdmissionAtMs = null;
      startedAtMs = observed;
      state = "launching";
      streamingReferencesReadyAtMs = null;
      streamingStartupTiming = null;
      streamingWorkerRequestedAtMs = null;
      streamingReadyAtMs = null;
    },
    fail(error: unknown): void {
      if (state === "interactive" || state === "failed") return;
      if (state === "idle") {
        const observed = now();
        if (!Number.isFinite(observed) || observed < 0) {
          throw new Error("Launch-to-interactive failure timestamp is invalid");
        }
        attempt += 1;
        startedAtMs = observed;
      }
      failureMessage =
        error instanceof Error && error.message !== "" ? error.message : String(error);
      state = "failed";
    },
    markInstalledPreflightPhase(phase: InstalledRuntimePreflightPhase): void {
      const phases: ReadonlyArray<
        readonly [InstalledRuntimePreflightPhase, number | null, (value: number) => void]
      > = [
        [
          "initial-release-admission",
          initialReleaseAdmissionAtMs,
          (value) => {
            initialReleaseAdmissionAtMs = value;
          },
        ],
        [
          "model-source-ready",
          modelSourceReadyAtMs,
          (value) => {
            modelSourceReadyAtMs = value;
          },
        ],
        [
          "streaming-references-ready",
          streamingReferencesReadyAtMs,
          (value) => {
            streamingReferencesReadyAtMs = value;
          },
        ],
        [
          "pso-trace-ready",
          psoTraceReadyAtMs,
          (value) => {
            psoTraceReadyAtMs = value;
          },
        ],
        [
          "final-release-admission",
          finalReleaseAdmissionAtMs,
          (value) => {
            finalReleaseAdmissionAtMs = value;
          },
        ],
      ];
      const index = phases.findIndex(([candidate]) => candidate === phase);
      const selected = phases[index];
      if (selected === undefined) throw new Error(`Unknown installed preflight phase ${phase}`);
      if (selected[1] !== null) {
        throw new Error(`Installed preflight phase ${phase} was already recorded`);
      }
      if (index > 0 && phases[index - 1]?.[1] === null) {
        throw new Error(`Installed preflight phase ${phase} was recorded before its prerequisite`);
      }
      mark(`installed-${phase}`, selected[1], selected[2]);
    },
    markRenderFirstFrame(): void {
      if (streamingWorkerRequestedAtMs === null) {
        throw new Error("render-first-frame requires a streaming worker request");
      }
      mark("render-first-frame", renderFirstFrameAtMs, (value) => {
        renderFirstFrameAtMs = value;
      });
    },
    markShellAdmission(): void {
      if (finalReleaseAdmissionAtMs === null) {
        throw new Error("shell-admission requires completed installed runtime preflight");
      }
      mark("shell-admission", shellAdmissionAtMs, (value) => {
        shellAdmissionAtMs = value;
      });
    },
    markStreamingReady(nextStartupTiming: StreamingStartupTimingSnapshot): void {
      if (
        streamingWorkerRequestedAtMs === null ||
        !completeInstalledStreamingStartupTiming(nextStartupTiming)
      ) {
        throw new Error("streaming-ready requires complete worker startup timing");
      }
      mark("streaming-ready", streamingReadyAtMs, (value) => {
        streamingStartupTiming = Object.freeze({ ...nextStartupTiming });
        streamingReadyAtMs = value;
      });
    },
    markStreamingWorkerRequested(): void {
      if (shellAdmissionAtMs === null) {
        throw new Error("streaming-worker-requested requires shell admission");
      }
      mark("streaming-worker-requested", streamingWorkerRequestedAtMs, (value) => {
        streamingWorkerRequestedAtMs = value;
      });
    },
    snapshot(): LaunchLifecycleSnapshot {
      return Object.freeze({
        attempt,
        contract: LAUNCH_LIFECYCLE_CONTRACT,
        durationMs,
        failureMessage,
        interactiveAtMs,
        preflightTiming: Object.freeze({
          finalReleaseAdmissionAtMs,
          initialReleaseAdmissionAtMs,
          modelSourceReadyAtMs,
          psoTraceReadyAtMs,
          streamingReferencesReadyAtMs,
        }),
        releaseDigest,
        renderFirstFrameAtMs,
        schemaVersion: LAUNCH_LIFECYCLE_SCHEMA_VERSION,
        shellAdmissionAtMs,
        startedAtMs,
        state,
        streamingStartupTiming,
        streamingWorkerRequestedAtMs,
        streamingReadyAtMs,
      });
    },
  });
}

function completeInstalledStreamingStartupTiming(timing: StreamingStartupTimingSnapshot): boolean {
  const ordered = [
    timing.workerStartedAtMs,
    timing.provisioningStartedAtMs,
    timing.releaseBindingCompletedAtMs,
    timing.releaseResolutionCompletedAtMs,
    timing.accessHandlesOpenedAtMs,
    timing.finalAdmissionCompletedAtMs,
    timing.decodePoolCreatedAtMs,
    timing.initialResidencyReadyAtMs,
  ];
  return (
    timing.contract === STREAMING_STARTUP_TIMING_CONTRACT &&
    timing.schemaVersion === STREAMING_STARTUP_TIMING_SCHEMA_VERSION &&
    timing.sourceKind === "installed-release" &&
    ordered.every((value): value is number => value !== null && Number.isFinite(value)) &&
    ordered.every((value, index) => index === 0 || value >= (ordered[index - 1] as number))
  );
}
