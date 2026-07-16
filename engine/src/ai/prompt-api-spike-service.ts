export const PROMPT_API_SPIKE_CONCURRENT_SESSION_TARGET = 8;
export const PROMPT_API_SPIKE_TELEMETRY_SCHEMA_VERSION = 3;
export const PROMPT_API_WORKER_PROBE_TIMEOUT_MS = 5_000;

export interface PromptApiSpikeFixture {
  readonly offlinePrompt: string;
  readonly prompt: string;
}

export type PromptApiAvailability = "unavailable" | "downloadable" | "downloading" | "available";

export type PromptApiSpikeState =
  | "idle"
  | "probing"
  | "awaiting-user-activation"
  | "creating"
  | "running-inference"
  | "probing-sessions"
  | "completed"
  | "unavailable"
  | "failed"
  | "disposed";

export interface PromptApiInferenceTelemetry {
  readonly chunks: number;
  readonly contextUsageAfter: number;
  readonly contextUsageBefore: number;
  readonly contextWindow: number;
  readonly firstChunkLatencyMs: number;
  readonly fixtureContextUsage: number;
  readonly outputCharacters: number;
  readonly totalLatencyMs: number;
}

export interface PromptApiConcurrentSessionTelemetry {
  readonly attempted: number;
  readonly created: number;
  readonly failureMessage: string | null;
  readonly target: number;
}

export interface PromptApiDownloadTelemetry {
  readonly eventsObserved: number;
  readonly invalidEventsObserved: number;
  readonly invalidSamples: readonly PromptApiInvalidDownloadSample[];
  readonly longestProgressGapMs: number;
  readonly maxProgress: number | null;
  readonly regressiveEventsObserved: number;
  readonly samples: readonly PromptApiDownloadProgressSample[];
}

export interface PromptApiDownloadProgressSample {
  readonly elapsedMs: number;
  readonly loaded: number;
}

export interface PromptApiInvalidDownloadSample {
  readonly type: string;
  readonly value: string;
}

export interface PromptApiExecutionContextTelemetry {
  readonly dedicatedWorker: Readonly<{
    readonly exposed: boolean | null;
    readonly failureMessage: string | null;
    readonly state: "pending" | "measured" | "invalid";
  }>;
  readonly windowExposed: boolean;
}

export interface PromptApiOfflineTelemetry {
  readonly availability: PromptApiAvailability | null;
  readonly failureMessage: string | null;
  readonly promptSucceeded: boolean | null;
  readonly state: "not-run" | "running" | "measured" | "failed";
}

export interface PromptApiSpikeTelemetrySnapshot {
  readonly concurrentSessions: PromptApiConcurrentSessionTelemetry | null;
  readonly download: PromptApiDownloadTelemetry;
  readonly executionContexts: PromptApiExecutionContextTelemetry;
  readonly failureMessage: string | null;
  readonly inference: PromptApiInferenceTelemetry | null;
  readonly initialAvailability: PromptApiAvailability | null;
  readonly offline: PromptApiOfflineTelemetry;
  readonly schemaVersion: typeof PROMPT_API_SPIKE_TELEMETRY_SCHEMA_VERSION;
  readonly state: PromptApiSpikeState;
  readonly userActivationAtCreate: boolean | null;
}

export type PromptApiSpikeListener = (snapshot: PromptApiSpikeTelemetrySnapshot) => void;

export interface PromptApiSpikeService {
  dispose(): void;
  probe(): Promise<void>;
  runFromUserActivation(): void;
  runOfflineProbeFromUserActivation(): void;
  snapshot(): PromptApiSpikeTelemetrySnapshot;
  subscribe(listener: PromptApiSpikeListener): () => void;
}

export interface PromptApiSessionAdapter {
  readonly contextUsage: number;
  readonly contextWindow: number;
  clone(): Promise<PromptApiSessionAdapter>;
  destroy(): void;
  measureContextUsage(input: string): Promise<number>;
  promptStreaming(input: string): ReadableStream<string>;
}

export interface PromptApiFactoryAdapter {
  availability(): Promise<PromptApiAvailability>;
  create(options?: {
    readonly monitor?: (monitor: EventTarget) => void;
  }): Promise<PromptApiSessionAdapter>;
}

export interface PromptApiSpikePlatform {
  readonly languageModel: PromptApiFactoryAdapter | null;
  now(): number;
  probeDedicatedWorkerExposure(): Promise<boolean>;
  userActivationIsActive(): boolean;
}

export interface PromptApiWorkerProbePlatform {
  createObjectUrl(source: string): string;
  createWorker(url: string): Worker;
  revokeObjectUrl(url: string): void;
}

export function createPromptApiSpikeService(
  fixture: PromptApiSpikeFixture,
  platform: PromptApiSpikePlatform = browserPlatform(),
): PromptApiSpikeService {
  let telemetry = initialTelemetry();
  let primarySession: PromptApiSessionAdapter | null = null;
  const retainedSessions: PromptApiSessionAdapter[] = [];
  const listeners = new Set<PromptApiSpikeListener>();

  const publish = (next: PromptApiSpikeTelemetrySnapshot): void => {
    telemetry = freezeTelemetry(next);
    for (const listener of listeners) {
      try {
        listener(telemetry);
      } catch (error: unknown) {
        console.error("Prompt API spike telemetry listener failed", error);
      }
    }
  };

  const destroySessions = (): void => {
    primarySession?.destroy();
    primarySession = null;
    for (const session of retainedSessions.splice(0)) session.destroy();
  };

  const fail = (error: unknown): void => {
    destroySessions();
    if (isDisposed(telemetry)) return;
    publish({ ...telemetry, failureMessage: describeError(error), state: "failed" });
  };

  const runSessionProbe = async (session: PromptApiSessionAdapter): Promise<void> => {
    if (isDisposed(telemetry)) {
      session.destroy();
      return;
    }
    primarySession = session;
    let concurrentSessions: PromptApiConcurrentSessionTelemetry | null = null;
    try {
      publish({ ...telemetry, state: "running-inference" });
      const contextUsageBefore = session.contextUsage;
      const fixtureContextUsage = await session.measureContextUsage(fixture.prompt);
      if (isDisposed(telemetry)) return;
      const startedAt = platform.now();
      let firstChunkAt: number | null = null;
      let chunks = 0;
      let outputCharacters = 0;
      const reader = session.promptStreaming(fixture.prompt).getReader();
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          if (firstChunkAt === null) firstChunkAt = platform.now();
          chunks += 1;
          outputCharacters += next.value.length;
        }
      } catch (error: unknown) {
        await reader.cancel().catch(() => undefined);
        throw error;
      } finally {
        reader.releaseLock();
      }
      const completedAt = platform.now();
      if (firstChunkAt === null) throw new Error("Prompt stream completed without yielding output");
      if (isDisposed(telemetry)) return;
      publish({
        ...telemetry,
        inference: Object.freeze({
          chunks,
          contextUsageAfter: session.contextUsage,
          contextUsageBefore,
          contextWindow: session.contextWindow,
          firstChunkLatencyMs: firstChunkAt - startedAt,
          fixtureContextUsage,
          outputCharacters,
          totalLatencyMs: completedAt - startedAt,
        }),
        state: "probing-sessions",
      });

      let attempted = 0;
      let cloneFailure: string | null = null;
      for (let index = 0; index < PROMPT_API_SPIKE_CONCURRENT_SESSION_TARGET; index += 1) {
        attempted += 1;
        try {
          const clone = await session.clone();
          if (isDisposed(telemetry)) {
            clone.destroy();
            return;
          }
          retainedSessions.push(clone);
        } catch (error: unknown) {
          cloneFailure = describeError(error);
          break;
        }
      }
      concurrentSessions = Object.freeze({
        attempted,
        created: retainedSessions.length,
        failureMessage: cloneFailure,
        target: PROMPT_API_SPIKE_CONCURRENT_SESSION_TARGET,
      });
    } finally {
      destroySessions();
    }
    if (isDisposed(telemetry) || concurrentSessions === null) return;
    publish({
      ...telemetry,
      concurrentSessions,
      failureMessage: null,
      state: "completed",
    });
  };

  return Object.freeze({
    dispose(): void {
      if (isDisposed(telemetry)) return;
      destroySessions();
      publish({ ...telemetry, state: "disposed" });
    },

    async probe(): Promise<void> {
      if (telemetry.state !== "idle") throw new Error("Prompt API spike can only be probed once");
      const languageModel = platform.languageModel;
      publish({
        ...telemetry,
        executionContexts: Object.freeze({
          ...telemetry.executionContexts,
          windowExposed: languageModel !== null,
        }),
        state: "probing",
      });
      // Enter both adapter calls through a promise boundary so a non-WebIDL test
      // adapter (or an implementation defect) cannot strand the public state by
      // throwing before allSettled owns the outcome.
      const workerProbe = Promise.resolve().then(() => platform.probeDedicatedWorkerExposure());
      const availabilityProbe = Promise.resolve().then(() => languageModel?.availability() ?? null);
      const [workerResult, availabilityResult] = await Promise.allSettled([
        workerProbe,
        availabilityProbe,
      ]);
      if (isDisposed(telemetry)) return;
      const dedicatedWorker =
        workerResult.status === "fulfilled"
          ? Object.freeze({
              exposed: workerResult.value,
              failureMessage: null,
              state: "measured" as const,
            })
          : Object.freeze({
              exposed: null,
              failureMessage: describeError(workerResult.reason),
              state: "invalid" as const,
            });
      if (availabilityResult.status === "rejected") {
        publish({
          ...telemetry,
          executionContexts: Object.freeze({
            ...telemetry.executionContexts,
            dedicatedWorker,
          }),
        });
        fail(availabilityResult.reason);
        return;
      }
      const availability = availabilityResult.value;
      publish({
        ...telemetry,
        executionContexts: Object.freeze({
          ...telemetry.executionContexts,
          dedicatedWorker,
        }),
        initialAvailability: availability,
        state:
          languageModel === null || availability === "unavailable"
            ? "unavailable"
            : "awaiting-user-activation",
      });
    },

    runFromUserActivation(): void {
      if (telemetry.state !== "awaiting-user-activation") {
        throw new Error("Prompt API creation requires a successful availability probe");
      }
      const languageModel = platform.languageModel;
      if (languageModel === null) throw new Error("Prompt API is not exposed in this window");
      const userActivationAtCreate = platform.userActivationIsActive();
      const progress = createDownloadProgressRecorder(
        () => telemetry,
        publish,
        () => platform.now(),
      );
      publish({ ...telemetry, state: "creating", userActivationAtCreate });
      try {
        // Do not await before create(): downloadable models require this call to occur in
        // the transient user-activation handler (D-017).
        const creation = languageModel.create({ monitor: progress.monitor });
        void creation
          .then(async (session) => {
            progress.flush();
            await runSessionProbe(session);
          })
          .catch((error: unknown) => {
            progress.flush();
            fail(error);
          });
      } catch (error: unknown) {
        fail(error);
      }
    },

    runOfflineProbeFromUserActivation(): void {
      if (telemetry.state !== "completed" || telemetry.offline.state !== "not-run") {
        throw new Error("Offline probe requires one completed online session probe");
      }
      const languageModel = platform.languageModel;
      if (languageModel === null) throw new Error("Prompt API is not exposed in this window");
      publish({
        ...telemetry,
        offline: Object.freeze({
          availability: null,
          failureMessage: null,
          promptSucceeded: null,
          state: "running",
        }),
      });
      try {
        // This method is invoked directly from a click. Start both operations without
        // awaiting so an evicted model receives fresh activation while both outcomes
        // remain independently observable.
        const creation = languageModel.create();
        const availability = Promise.resolve().then(() => languageModel.availability());
        void runOfflineProbe(
          creation,
          availability,
          fixture.offlinePrompt,
          () => telemetry,
          publish,
        );
      } catch (error: unknown) {
        publishOfflineFailure(error, () => telemetry, publish);
      }
    },

    snapshot(): PromptApiSpikeTelemetrySnapshot {
      return telemetry;
    },

    subscribe(listener: PromptApiSpikeListener): () => void {
      listeners.add(listener);
      try {
        listener(telemetry);
      } catch (error: unknown) {
        console.error("Prompt API spike telemetry listener failed", error);
      }
      return () => listeners.delete(listener);
    },
  });
}

function createDownloadProgressRecorder(
  current: () => PromptApiSpikeTelemetrySnapshot,
  publish: (next: PromptApiSpikeTelemetrySnapshot) => void,
  now: () => number,
): Readonly<{ flush(): void; monitor(monitor: EventTarget): void }> {
  const startedAt = now();
  let eventsObserved = 0;
  let invalidEventsObserved = 0;
  const invalidSamples: PromptApiInvalidDownloadSample[] = [];
  let longestProgressGapMs = 0;
  let maxProgress: number | null = null;
  let lastObservedAt = startedAt;
  let lastProgressAt = startedAt;
  let lastRetainedProgress = Number.NEGATIVE_INFINITY;
  let lastTelemetryPublishedAt = startedAt;
  let regressiveEventsObserved = 0;
  const samples: PromptApiDownloadProgressSample[] = [];
  let dirty = false;
  const publishProgress = (): void => {
    if (!dirty) return;
    const telemetry = current();
    if (isDisposed(telemetry)) return;
    dirty = false;
    publish({
      ...telemetry,
      download: freezeDownload({
        eventsObserved,
        invalidEventsObserved,
        invalidSamples,
        longestProgressGapMs,
        maxProgress,
        regressiveEventsObserved,
        samples,
      }),
    });
    lastTelemetryPublishedAt = lastObservedAt;
  };
  return Object.freeze({
    flush: publishProgress,
    monitor(monitor): void {
      monitor.addEventListener("downloadprogress", (event) => {
        eventsObserved += 1;
        dirty = true;
        const observedAt = now();
        lastObservedAt = observedAt;
        const elapsedMs = Math.max(0, observedAt - startedAt);
        const rawLoaded = Reflect.get(event, "loaded");
        if (
          typeof rawLoaded !== "number" ||
          !Number.isFinite(rawLoaded) ||
          rawLoaded < 0 ||
          rawLoaded > 1
        ) {
          invalidEventsObserved += 1;
          if (invalidSamples.length < 8) {
            invalidSamples.push(describeInvalidProgressValue(rawLoaded));
          }
          // Keep the UI observable without recreating the event storm being
          // diagnosed. flush() publishes the exact final count at settlement.
          if (invalidEventsObserved === 1 || invalidEventsObserved % 1_000 === 0) {
            publishProgress();
          }
          return;
        }
        if (maxProgress !== null && rawLoaded < maxProgress) {
          regressiveEventsObserved += 1;
          if (regressiveEventsObserved === 1 || regressiveEventsObserved % 1_000 === 0) {
            publishProgress();
          }
          return;
        }
        if (maxProgress === null || rawLoaded > maxProgress) {
          longestProgressGapMs = Math.max(
            longestProgressGapMs,
            Math.max(0, observedAt - lastProgressAt),
          );
          lastProgressAt = observedAt;
          maxProgress = rawLoaded;
        }
        const shouldRetain =
          samples.length === 0 ||
          (rawLoaded === 1 && lastRetainedProgress !== 1) ||
          rawLoaded - lastRetainedProgress >= 0.01;
        if (shouldRetain) {
          samples.push(Object.freeze({ elapsedMs, loaded: rawLoaded }));
          lastRetainedProgress = rawLoaded;
        }
        if (shouldRetain || observedAt - lastTelemetryPublishedAt >= 1_000) {
          publishProgress();
        }
      });
    },
  });
}

async function runOfflineProbe(
  creation: Promise<PromptApiSessionAdapter>,
  availability: Promise<PromptApiAvailability>,
  prompt: string,
  current: () => PromptApiSpikeTelemetrySnapshot,
  publish: (next: PromptApiSpikeTelemetrySnapshot) => void,
): Promise<void> {
  const [creationResult, availabilityResult] = await Promise.allSettled([creation, availability]);
  const session = creationResult.status === "fulfilled" ? creationResult.value : null;
  try {
    if (creationResult.status === "rejected") throw creationResult.reason;
    if (availabilityResult.status === "rejected") throw availabilityResult.reason;
    const reader = creationResult.value.promptStreaming(prompt).getReader();
    let output = "";
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        output += next.value;
      }
    } catch (error: unknown) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
    const telemetry = current();
    if (isDisposed(telemetry)) return;
    publish({
      ...telemetry,
      offline: Object.freeze({
        availability: availabilityResult.value,
        failureMessage: null,
        promptSucceeded: output.trim().length > 0,
        state: "measured",
      }),
    });
  } catch (error: unknown) {
    publishOfflineFailure(error, current, publish);
  } finally {
    session?.destroy();
  }
}

function publishOfflineFailure(
  error: unknown,
  current: () => PromptApiSpikeTelemetrySnapshot,
  publish: (next: PromptApiSpikeTelemetrySnapshot) => void,
): void {
  const telemetry = current();
  if (isDisposed(telemetry)) return;
  publish({
    ...telemetry,
    offline: Object.freeze({
      availability: null,
      failureMessage: describeError(error),
      promptSucceeded: false,
      state: "failed",
    }),
  });
}

function browserPlatform(): PromptApiSpikePlatform {
  return Object.freeze({
    languageModel: typeof LanguageModel === "function" ? LanguageModel : null,
    now: () => performance.now(),
    probeDedicatedWorkerExposure,
    userActivationIsActive: () => navigator.userActivation.isActive,
  });
}

export function probeDedicatedWorkerExposure(
  platform: PromptApiWorkerProbePlatform = browserWorkerProbePlatform(),
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const source = "postMessage({ exposed: typeof LanguageModel === 'function' });";
    const url = platform.createObjectUrl(source);
    let worker: Worker;
    try {
      worker = platform.createWorker(url);
    } catch (error: unknown) {
      platform.revokeObjectUrl(url);
      reject(error);
      return;
    }
    let settled = false;
    const cleanup = (): void => {
      worker.terminate();
      platform.revokeObjectUrl(url);
    };
    const settle = (result: Readonly<{ error?: Error; exposed?: boolean }>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanup();
      if (result.error !== undefined) reject(result.error);
      else resolve(result.exposed === true);
    };
    const timeout = setTimeout(
      () => settle({ error: new Error("Prompt API worker-context probe timed out") }),
      PROMPT_API_WORKER_PROBE_TIMEOUT_MS,
    );
    worker.onmessage = (event: MessageEvent<unknown>): void => {
      settle({
        exposed:
          typeof event.data === "object" &&
          event.data !== null &&
          Reflect.get(event.data, "exposed") === true,
      });
    };
    worker.onmessageerror = (): void => {
      settle({ error: new Error("Prompt API worker-context response could not be deserialized") });
    };
    worker.onerror = (event): void => {
      settle({ error: new Error(event.message || "Prompt API worker-context probe failed") });
    };
  });
}

function browserWorkerProbePlatform(): PromptApiWorkerProbePlatform {
  return Object.freeze({
    createObjectUrl: (source: string) =>
      URL.createObjectURL(new Blob([source], { type: "text/javascript" })),
    createWorker: (url: string) => new Worker(url, { name: "parallax-prompt-api-context-probe" }),
    revokeObjectUrl: (url: string) => URL.revokeObjectURL(url),
  });
}

function initialTelemetry(): PromptApiSpikeTelemetrySnapshot {
  return freezeTelemetry({
    concurrentSessions: null,
    download: freezeDownload({
      eventsObserved: 0,
      invalidEventsObserved: 0,
      invalidSamples: [],
      longestProgressGapMs: 0,
      maxProgress: null,
      regressiveEventsObserved: 0,
      samples: [],
    }),
    executionContexts: Object.freeze({
      dedicatedWorker: Object.freeze({
        exposed: null,
        failureMessage: null,
        state: "pending",
      }),
      windowExposed: false,
    }),
    failureMessage: null,
    inference: null,
    initialAvailability: null,
    offline: Object.freeze({
      availability: null,
      failureMessage: null,
      promptSucceeded: null,
      state: "not-run",
    }),
    schemaVersion: PROMPT_API_SPIKE_TELEMETRY_SCHEMA_VERSION,
    state: "idle",
    userActivationAtCreate: null,
  });
}

function freezeDownload(value: {
  readonly eventsObserved: number;
  readonly invalidEventsObserved: number;
  readonly invalidSamples: readonly PromptApiInvalidDownloadSample[];
  readonly longestProgressGapMs: number;
  readonly maxProgress: number | null;
  readonly regressiveEventsObserved: number;
  readonly samples: readonly PromptApiDownloadProgressSample[];
}): PromptApiDownloadTelemetry {
  return Object.freeze({
    eventsObserved: value.eventsObserved,
    invalidEventsObserved: value.invalidEventsObserved,
    invalidSamples: Object.freeze(
      value.invalidSamples.map((sample) => Object.freeze({ ...sample })),
    ),
    longestProgressGapMs: value.longestProgressGapMs,
    maxProgress: value.maxProgress,
    regressiveEventsObserved: value.regressiveEventsObserved,
    samples: Object.freeze(value.samples.map((sample) => Object.freeze({ ...sample }))),
  });
}

function describeInvalidProgressValue(value: unknown): PromptApiInvalidDownloadSample {
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  let display: string;
  try {
    display =
      typeof value === "number" && !Number.isFinite(value)
        ? String(value)
        : typeof value === "string"
          ? value
          : (JSON.stringify(value) ?? String(value));
  } catch {
    display = String(value);
  }
  return Object.freeze({ type, value: display });
}

function freezeTelemetry(value: PromptApiSpikeTelemetrySnapshot): PromptApiSpikeTelemetrySnapshot {
  return Object.freeze(value);
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function isDisposed(telemetry: PromptApiSpikeTelemetrySnapshot): boolean {
  return telemetry.state === "disposed";
}
