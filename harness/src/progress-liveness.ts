import { sanitizeDiagnosticCause } from "./diagnostic-redaction.js";

export const PROGRESS_LIVENESS_STALL_TIMEOUT_MS = 120_000;
export const PROGRESS_LIVENESS_ABSOLUTE_TIMEOUT_MS = 1_800_000;
export const PROGRESS_LIVENESS_POLL_INTERVAL_MS = 1_000;
export const DEGRADED_DURABILITY_WARNING =
  "Persistent storage was not granted. Installation can continue, but Chrome may evict the game under storage pressure.";

export type ProgressLivenessTimeoutClassification = "absolute" | "stall" | "terminal";
export type ProgressVerificationPhase = "complete" | "idle" | "verifying";

export interface ProgressState {
  readonly checkpointedBytes: number;
  readonly completedResourceCount: number;
  readonly downloadedBytes: number;
  readonly finalVerificationBytes: number;
  readonly finalVerificationPhase: ProgressVerificationPhase;
  readonly finalVerificationResourceCount: number;
  readonly finalVerificationTotalBytes: number;
  readonly finalVerificationTotalResourceCount: number;
  readonly verifiedBytes: number;
}

export interface ProgressLivenessObservation {
  readonly durabilityClaimed: boolean;
  readonly persistence: string | null;
  readonly persistenceWarning: string | null;
  readonly progress: ProgressState;
  readonly state: string | null;
  readonly terminalCause: unknown;
}

export interface ProgressLivenessSnapshot {
  readonly absoluteTimeoutMs: number;
  readonly lastProgressAtMs: number;
  readonly lastProgressGapMs: number;
  readonly lastProgressTuple: ProgressState;
  readonly maxProgressGapMs: number;
  readonly pollIntervalMs: number;
  readonly stallTimeoutMs: number;
  readonly startedAtMs: number;
  readonly terminalCause: Readonly<{ message: string; name: string }> | null;
  readonly timeoutClassification: ProgressLivenessTimeoutClassification | null;
}

export interface ProgressLivenessMonitor {
  deadline(): Readonly<{
    atMs: number;
    classification: Extract<ProgressLivenessTimeoutClassification, "absolute" | "stall">;
  }>;
  observe(now: number, observation: ProgressLivenessObservation): "continue" | "ready";
  failTerminal(now: number, cause: unknown): never;
  failTimeout(
    atMs: number,
    classification: Extract<ProgressLivenessTimeoutClassification, "absolute" | "stall">,
  ): never;
  snapshot(now: number): ProgressLivenessSnapshot;
}

export interface ProgressLivenessWaitPlatform {
  clearTimeout(handle: unknown): void;
  now(): number;
  setTimeout(callback: () => void, milliseconds: number): unknown;
}

export class ProgressLivenessError extends Error {
  public constructor(
    message: string,
    public readonly liveness: ProgressLivenessSnapshot,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProgressLivenessError";
  }
}

export function createProgressLivenessMonitor(
  startedAtMs: number,
  initialProgress: ProgressState = zeroProgressState(),
): ProgressLivenessMonitor {
  timestamp(startedAtMs);
  validateProgress(initialProgress);
  let lastProgress = freezeProgress(initialProgress);
  let lastProgressAtMs = startedAtMs;
  let lastObservedAtMs = startedAtMs;
  let maxProgressGapMs = 0;
  let timeoutClassification: ProgressLivenessTimeoutClassification | null = null;
  let terminalCause: Readonly<{ message: string; name: string }> | null = null;

  const currentSnapshot = (now: number): ProgressLivenessSnapshot => {
    timestamp(now);
    const boundedNow = Math.max(lastObservedAtMs, now);
    return Object.freeze({
      absoluteTimeoutMs: PROGRESS_LIVENESS_ABSOLUTE_TIMEOUT_MS,
      lastProgressAtMs,
      lastProgressGapMs: boundedNow - lastProgressAtMs,
      lastProgressTuple: lastProgress,
      maxProgressGapMs: Math.max(maxProgressGapMs, boundedNow - lastProgressAtMs),
      pollIntervalMs: PROGRESS_LIVENESS_POLL_INTERVAL_MS,
      stallTimeoutMs: PROGRESS_LIVENESS_STALL_TIMEOUT_MS,
      startedAtMs,
      terminalCause,
      timeoutClassification,
    });
  };
  const fail = (
    now: number,
    classification: ProgressLivenessTimeoutClassification,
    cause: unknown,
  ): never => {
    lastObservedAtMs = Math.max(lastObservedAtMs, now);
    maxProgressGapMs = Math.max(maxProgressGapMs, lastObservedAtMs - lastProgressAtMs);
    timeoutClassification = classification;
    terminalCause = sanitizeDiagnosticCause(cause);
    throw new ProgressLivenessError(
      `Progress liveness failed (${classification})`,
      currentSnapshot(lastObservedAtMs),
      { cause },
    );
  };

  return Object.freeze({
    deadline() {
      return nextDeadline(startedAtMs, lastProgressAtMs);
    },
    failTerminal(now: number, cause: unknown): never {
      return fail(now, "terminal", cause);
    },
    failTimeout(
      atMs: number,
      classification: Extract<ProgressLivenessTimeoutClassification, "absolute" | "stall">,
    ): never {
      const deadline = nextDeadline(startedAtMs, lastProgressAtMs);
      if (deadline.atMs !== atMs || deadline.classification !== classification) {
        throw new Error("Ready liveness timeout did not match the current earliest deadline");
      }
      return fail(atMs, classification, `${classification} Ready deadline expired`);
    },
    observe(now: number, observation: ProgressLivenessObservation): "continue" | "ready" {
      timestamp(now);
      if (now < lastObservedAtMs) {
        return fail(lastObservedAtMs, "terminal", "Ready liveness monotonic clock regressed");
      }
      lastObservedAtMs = now;
      validateObservation(observation);
      const gap = now - lastProgressAtMs;
      maxProgressGapMs = Math.max(maxProgressGapMs, gap);
      const deadline = nextDeadline(startedAtMs, lastProgressAtMs);
      if (now >= deadline.atMs) {
        return fail(
          deadline.atMs,
          deadline.classification,
          `${deadline.classification} Ready deadline expired`,
        );
      }
      if (observation.state === "failed") {
        return fail(now, "terminal", observation.terminalCause ?? "Installer entered failed state");
      }
      if (
        observation.persistence === "denied" &&
        (observation.persistenceWarning !== DEGRADED_DURABILITY_WARNING ||
          observation.durabilityClaimed)
      ) {
        return fail(now, "terminal", "Persistence denial lacked the exact degraded warning");
      }
      if (
        observation.state === "ready" &&
        observation.progress.finalVerificationPhase !== "complete"
      ) {
        return fail(now, "terminal", "Ready preceded complete final-release verification");
      }
      if (progresses(lastProgress, observation.progress)) {
        lastProgress = freezeProgress(observation.progress);
        lastProgressAtMs = now;
      }
      return observation.state === "ready" ? "ready" : "continue";
    },
    snapshot: currentSnapshot,
  });
}

export async function waitForProgressLiveness<T>(
  read: (
    signal: AbortSignal,
  ) => Promise<Readonly<{ observation: ProgressLivenessObservation; value: T }>>,
  platform: ProgressLivenessWaitPlatform = defaultProgressWaitPlatform(),
): Promise<Readonly<{ liveness: ProgressLivenessSnapshot; value: T }>> {
  const startedAt = platform.now();
  const monitor = createProgressLivenessMonitor(startedAt);
  while (true) {
    const beforeRead = platform.now();
    const deadline = monitor.deadline();
    if (beforeRead >= deadline.atMs) {
      monitor.failTimeout(deadline.atMs, deadline.classification);
    }
    const controller = new AbortController();
    const timerHandles: unknown[] = [];
    const readOutcome = Promise.resolve()
      .then(() => read(controller.signal))
      .then<ProgressReadOutcome<T>, ProgressReadOutcome<T>>(
        (current) => ({ current, kind: "read" }),
        (error: unknown) => ({ error, kind: "read-error" }),
      );
    const absoluteAtMs = startedAt + PROGRESS_LIVENESS_ABSOLUTE_TIMEOUT_MS;
    const stallAtMs =
      monitor.snapshot(beforeRead).lastProgressAtMs + PROGRESS_LIVENESS_STALL_TIMEOUT_MS;
    const timeout = (
      classification: Extract<ProgressLivenessTimeoutClassification, "absolute" | "stall">,
      atMs: number,
    ): Promise<ProgressTimeoutOutcome> =>
      new Promise((resolve) => {
        timerHandles.push(
          platform.setTimeout(
            () => resolve({ atMs, classification, kind: "timeout" }),
            Math.max(0, atMs - beforeRead),
          ),
        );
      });
    let outcome: ProgressReadOutcome<T> | ProgressTimeoutOutcome;
    try {
      outcome = await Promise.race([
        readOutcome,
        timeout("stall", stallAtMs),
        timeout("absolute", absoluteAtMs),
      ]);
    } finally {
      for (const handle of timerHandles) platform.clearTimeout(handle);
    }
    if (outcome.kind === "timeout") {
      controller.abort();
      const currentDeadline = monitor.deadline();
      monitor.failTimeout(currentDeadline.atMs, currentDeadline.classification);
    }
    const completedAt = platform.now();
    const currentDeadline = monitor.deadline();
    if (completedAt >= currentDeadline.atMs) {
      controller.abort();
      monitor.failTimeout(currentDeadline.atMs, currentDeadline.classification);
    }
    if (outcome.kind === "read-error") {
      controller.abort();
      monitor.failTerminal(completedAt, outcome.error);
    }
    if (outcome.kind !== "read") {
      throw new Error("Ready liveness produced an unreachable read outcome");
    }
    const observedAt = completedAt;
    if (monitor.observe(observedAt, outcome.current.observation) === "ready") {
      return Object.freeze({
        liveness: monitor.snapshot(observedAt),
        value: outcome.current.value,
      });
    }
    await waitForPollInterval(platform, monitor);
  }
}

export function zeroProgressState(): ProgressState {
  return Object.freeze({
    checkpointedBytes: 0,
    completedResourceCount: 0,
    downloadedBytes: 0,
    finalVerificationBytes: 0,
    finalVerificationPhase: "idle",
    finalVerificationResourceCount: 0,
    finalVerificationTotalBytes: 0,
    finalVerificationTotalResourceCount: 0,
    verifiedBytes: 0,
  });
}

function defaultProgressWaitPlatform(): ProgressLivenessWaitPlatform {
  return Object.freeze({
    clearTimeout: (handle: unknown) => globalThis.clearTimeout(handle as number),
    now: () => performance.now(),
    setTimeout: (callback: () => void, milliseconds: number) =>
      globalThis.setTimeout(callback, milliseconds),
  });
}

function progresses(previous: ProgressState, candidate: ProgressState): boolean {
  const previousValues = numericProgress(previous);
  const candidateValues = numericProgress(candidate);
  const phase = phaseRank(candidate.finalVerificationPhase);
  const previousPhase = phaseRank(previous.finalVerificationPhase);
  return (
    phase >= previousPhase &&
    candidateValues.every((value, index) => value >= (previousValues[index] ?? 0)) &&
    (phase > previousPhase ||
      candidateValues.some((value, index) => value > (previousValues[index] ?? 0)))
  );
}

function numericProgress(value: ProgressState): readonly number[] {
  return [
    value.downloadedBytes,
    value.checkpointedBytes,
    value.verifiedBytes,
    value.completedResourceCount,
    value.finalVerificationBytes,
    value.finalVerificationResourceCount,
    value.finalVerificationTotalBytes,
    value.finalVerificationTotalResourceCount,
  ];
}

function phaseRank(value: ProgressVerificationPhase): number {
  return value === "idle" ? 0 : value === "verifying" ? 1 : 2;
}

function validateObservation(value: ProgressLivenessObservation): void {
  validateProgress(value.progress);
  if (
    (value.state !== null && typeof value.state !== "string") ||
    (value.persistence !== null && typeof value.persistence !== "string") ||
    (value.persistenceWarning !== null && typeof value.persistenceWarning !== "string") ||
    typeof value.durabilityClaimed !== "boolean"
  ) {
    throw new Error("Ready liveness observation is invalid");
  }
}

function validateProgress(value: ProgressState): void {
  for (const entry of numericProgress(value)) {
    if (!Number.isSafeInteger(entry) || entry < 0) {
      throw new Error("Ready liveness progress must contain non-negative safe integers");
    }
  }
  if (
    value.finalVerificationPhase !== "idle" &&
    value.finalVerificationPhase !== "verifying" &&
    value.finalVerificationPhase !== "complete"
  ) {
    throw new Error("Ready liveness final verification phase is invalid");
  }
}

function freezeProgress(value: ProgressState): ProgressState {
  return Object.freeze({ ...value });
}

function timestamp(value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new Error("Ready liveness timestamp is invalid");
}

type ProgressReadOutcome<T> =
  | Readonly<{
      current: Readonly<{ observation: ProgressLivenessObservation; value: T }>;
      kind: "read";
    }>
  | Readonly<{ error: unknown; kind: "read-error" }>;

interface ProgressTimeoutOutcome {
  readonly atMs: number;
  readonly classification: Extract<ProgressLivenessTimeoutClassification, "absolute" | "stall">;
  readonly kind: "timeout";
}

function nextDeadline(
  startedAtMs: number,
  lastProgressAtMs: number,
): Readonly<{
  atMs: number;
  classification: Extract<ProgressLivenessTimeoutClassification, "absolute" | "stall">;
}> {
  const absoluteAtMs = startedAtMs + PROGRESS_LIVENESS_ABSOLUTE_TIMEOUT_MS;
  const stallAtMs = lastProgressAtMs + PROGRESS_LIVENESS_STALL_TIMEOUT_MS;
  return stallAtMs < absoluteAtMs
    ? Object.freeze({ atMs: stallAtMs, classification: "stall" })
    : Object.freeze({ atMs: absoluteAtMs, classification: "absolute" });
}

async function waitForPollInterval(
  platform: ProgressLivenessWaitPlatform,
  monitor: ProgressLivenessMonitor,
): Promise<void> {
  const beforePoll = platform.now();
  const deadline = monitor.deadline();
  if (beforePoll >= deadline.atMs) {
    monitor.failTimeout(deadline.atMs, deadline.classification);
  }
  const delay = Math.min(PROGRESS_LIVENESS_POLL_INTERVAL_MS, deadline.atMs - beforePoll);
  let handle: unknown = null;
  try {
    await new Promise<void>((resolve) => {
      handle = platform.setTimeout(resolve, delay);
    });
  } finally {
    if (handle !== null) platform.clearTimeout(handle);
  }
}
