import { describe, expect, it, vi } from "vitest";
import {
  createPromptApiSpikeService,
  PROMPT_API_SPIKE_CONCURRENT_SESSION_TARGET,
  PROMPT_API_WORKER_PROBE_TIMEOUT_MS,
  type PromptApiFactoryAdapter,
  type PromptApiSessionAdapter,
  type PromptApiSpikeFixture,
  type PromptApiSpikePlatform,
  type PromptApiWorkerProbePlatform,
  probeDedicatedWorkerExposure,
} from "../src/ai/prompt-api-spike-service";

const FIXTURE = Object.freeze({
  offlinePrompt: "offline",
  prompt: "online",
}) satisfies PromptApiSpikeFixture;

describe("Prompt API spike service", () => {
  it("probes real worker exposure and cleans up exactly once", async () => {
    vi.useFakeTimers();
    try {
      const worker = new StubWorker();
      const probePlatform = fakeWorkerProbePlatform(worker);
      const result = probeDedicatedWorkerExposure(probePlatform.platform);

      expect(vi.getTimerCount()).toBe(1);
      worker.emitMessage({ exposed: true });

      await expect(result).resolves.toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      expect(probePlatform.revokeObjectUrl).toHaveBeenCalledWith("blob:prompt-probe");
      worker.emitError("late error");
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      expect(probePlatform.revokeObjectUrl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects worker message and runtime errors with cleanup", async () => {
    const messageWorker = new StubWorker();
    const messagePlatform = fakeWorkerProbePlatform(messageWorker);
    const messageResult = probeDedicatedWorkerExposure(messagePlatform.platform);
    messageWorker.emitMessageError();
    await expect(messageResult).rejects.toThrow("could not be deserialized");
    expect(messageWorker.terminate).toHaveBeenCalledTimes(1);

    const errorWorker = new StubWorker();
    const errorPlatform = fakeWorkerProbePlatform(errorWorker);
    const errorResult = probeDedicatedWorkerExposure(errorPlatform.platform);
    errorWorker.emitError("worker failed");
    await expect(errorResult).rejects.toThrow("worker failed");
    expect(errorWorker.terminate).toHaveBeenCalledTimes(1);
  });

  it("times out and cleans up a silent worker probe", async () => {
    vi.useFakeTimers();
    try {
      const worker = new StubWorker();
      const probePlatform = fakeWorkerProbePlatform(worker);
      const result = probeDedicatedWorkerExposure(probePlatform.platform);
      let outcome: "pending" | "rejected" = "pending";
      void result.catch(() => {
        outcome = "rejected";
      });

      await vi.advanceTimersByTimeAsync(4_999);
      expect(outcome).toBe("pending");
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);

      expect(outcome).toBe("rejected");
      await expect(result).rejects.toThrow("timed out");
      expect(PROMPT_API_WORKER_PROBE_TIMEOUT_MS).toBe(5_000);
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      expect(probePlatform.revokeObjectUrl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("revokes the worker URL when construction throws", async () => {
    const revokeObjectUrl = vi.fn<PromptApiWorkerProbePlatform["revokeObjectUrl"]>();
    const platform: PromptApiWorkerProbePlatform = {
      createObjectUrl: () => "blob:prompt-probe",
      createWorker: () => {
        throw new DOMException("worker blocked", "SecurityError");
      },
      revokeObjectUrl,
    };

    await expect(probeDedicatedWorkerExposure(platform)).rejects.toThrow("worker blocked");
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:prompt-probe");
  });

  it("reports window and worker exposure without creating a session", async () => {
    const create = vi.fn<PromptApiFactoryAdapter["create"]>();
    const service = createPromptApiSpikeService(
      FIXTURE,
      platform({ availability: async () => "unavailable", create }),
    );

    await service.probe();

    expect(service.snapshot()).toMatchObject({
      executionContexts: {
        dedicatedWorker: { exposed: false, state: "measured" },
        windowExposed: true,
      },
      initialAvailability: "unavailable",
      state: "unavailable",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps a failed worker diagnostic separate from primary availability", async () => {
    const service = createPromptApiSpikeService(
      FIXTURE,
      platform(factory(fakeSession([])), [0], async () => {
        throw new Error("worker blocked");
      }),
    );

    await service.probe();

    expect(service.snapshot()).toMatchObject({
      executionContexts: {
        dedicatedWorker: {
          exposed: null,
          failureMessage: "Error: worker blocked",
          state: "invalid",
        },
      },
      initialAvailability: "available",
      state: "awaiting-user-activation",
    });
  });

  it("records a synchronously thrown worker diagnostic without blocking availability", async () => {
    const service = createPromptApiSpikeService(
      FIXTURE,
      platform(factory(fakeSession([])), [0], () => {
        throw new Error("worker constructor blocked");
      }),
    );

    await service.probe();

    expect(service.snapshot()).toMatchObject({
      executionContexts: {
        dedicatedWorker: {
          failureMessage: "Error: worker constructor blocked",
          state: "invalid",
        },
      },
      initialAvailability: "available",
      state: "awaiting-user-activation",
    });
  });

  it("calls create synchronously, measures inference, and releases every session", async () => {
    const session = fakeSession(["east gate ", "secure"]);
    const create = vi.fn<PromptApiFactoryAdapter["create"]>(() => Promise.resolve(session));
    const service = createPromptApiSpikeService(
      FIXTURE,
      platform({ availability: async () => "available", create }, [0, 10, 35, 90]),
    );
    await service.probe();
    let observedReleasedCompletion = false;
    service.subscribe((snapshot) => {
      if (snapshot.state !== "completed") return;
      expect(session.destroy).toHaveBeenCalledTimes(1);
      expect(session.clones).toHaveLength(8);
      expect(session.clones.every((clone) => clone.destroy.mock.calls.length === 1)).toBe(true);
      observedReleasedCompletion = true;
    });

    service.runFromUserActivation();

    expect(create).toHaveBeenCalledTimes(1);
    expect(service.snapshot()).toMatchObject({
      state: "creating",
      userActivationAtCreate: true,
    });
    await vi.waitFor(() => expect(service.snapshot().state).toBe("completed"));
    expect(observedReleasedCompletion).toBe(true);
    expect(service.snapshot().inference).toMatchObject({
      chunks: 2,
      contextUsageAfter: 18,
      contextUsageBefore: 4,
      contextWindow: 4096,
      firstChunkLatencyMs: 25,
      fixtureContextUsage: 14,
      outputCharacters: 16,
      totalLatencyMs: 80,
    });
    expect(service.snapshot().concurrentSessions).toEqual({
      attempted: PROMPT_API_SPIKE_CONCURRENT_SESSION_TARGET,
      created: PROMPT_API_SPIKE_CONCURRENT_SESSION_TARGET,
      failureMessage: null,
      target: PROMPT_API_SPIKE_CONCURRENT_SESSION_TARGET,
    });
    expect(PROMPT_API_SPIKE_CONCURRENT_SESSION_TARGET).toBe(8);
    expect(session.clone).toHaveBeenCalledTimes(8);
    expect(session.measureContextUsage).toHaveBeenCalledWith(FIXTURE.prompt);
    expect(session.promptStreaming).toHaveBeenCalledWith(FIXTURE.prompt);
    expect(session.destroy).toHaveBeenCalledTimes(1);
    for (const clone of session.clones) expect(clone.destroy).toHaveBeenCalledTimes(1);
  });

  it("reports the actual attempt count when bounded cloning fails", async () => {
    const session = fakeSession(["ok"], 1);
    const service = createPromptApiSpikeService(FIXTURE, platform(factory(session), [0, 1, 2]));
    await service.probe();
    service.runFromUserActivation();
    await vi.waitFor(() => expect(service.snapshot().state).toBe("completed"));

    expect(service.snapshot().concurrentSessions).toEqual({
      attempted: 2,
      created: 1,
      failureMessage: "NotSupportedError: resource pressure",
      target: PROMPT_API_SPIKE_CONCURRENT_SESSION_TARGET,
    });
  });

  it("releases the online cohort before measuring offline reavailability", async () => {
    const online = fakeSession(["online"]);
    const offline = fakeSession(["offline-ready"]);
    const model = factory(online);
    model.create = vi
      .fn<PromptApiFactoryAdapter["create"]>()
      .mockResolvedValueOnce(online)
      .mockImplementationOnce(async () => {
        expect(online.destroy).toHaveBeenCalledTimes(1);
        expect(online.clones.every((clone) => clone.destroy.mock.calls.length === 1)).toBe(true);
        return offline;
      });
    const service = createPromptApiSpikeService(FIXTURE, platform(model, [0, 1, 2]));
    await service.probe();
    service.runFromUserActivation();
    await vi.waitFor(() => expect(service.snapshot().state).toBe("completed"));

    service.runOfflineProbeFromUserActivation();
    expect(() => service.runOfflineProbeFromUserActivation()).toThrow("one completed");
    await vi.waitFor(() => expect(service.snapshot().offline.state).toBe("measured"));

    expect(service.snapshot().offline).toEqual({
      availability: "available",
      failureMessage: null,
      promptSucceeded: true,
      state: "measured",
    });
    expect(offline.promptStreaming).toHaveBeenCalledWith(FIXTURE.offlinePrompt);
    expect(offline.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys an offline session when the parallel availability check rejects", async () => {
    const online = fakeSession(["online"]);
    const offline = fakeSession(["offline"]);
    const model = factory(online);
    model.create = vi
      .fn<PromptApiFactoryAdapter["create"]>()
      .mockResolvedValueOnce(online)
      .mockResolvedValueOnce(offline);
    model.availability = vi
      .fn<PromptApiFactoryAdapter["availability"]>()
      .mockResolvedValueOnce("available")
      .mockRejectedValueOnce(new DOMException("network unavailable", "NetworkError"));
    const service = createPromptApiSpikeService(FIXTURE, platform(model, [0, 1, 2]));
    await service.probe();
    service.runFromUserActivation();
    await vi.waitFor(() => expect(service.snapshot().state).toBe("completed"));

    service.runOfflineProbeFromUserActivation();
    await vi.waitFor(() => expect(service.snapshot().offline.state).toBe("failed"));

    expect(offline.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys an offline session when availability throws synchronously", async () => {
    const online = fakeSession(["online"]);
    const offline = fakeSession(["offline"]);
    const model = factory(online);
    model.create = vi
      .fn<PromptApiFactoryAdapter["create"]>()
      .mockResolvedValueOnce(online)
      .mockResolvedValueOnce(offline);
    model.availability = vi
      .fn<PromptApiFactoryAdapter["availability"]>()
      .mockResolvedValueOnce("available")
      .mockImplementationOnce(() => {
        throw new DOMException("offline availability failed", "NotSupportedError");
      });
    const service = createPromptApiSpikeService(FIXTURE, platform(model, [0, 1, 2]));
    await service.probe();
    service.runFromUserActivation();
    await vi.waitFor(() => expect(service.snapshot().state).toBe("completed"));

    service.runOfflineProbeFromUserActivation();
    await vi.waitFor(() => expect(service.snapshot().offline.state).toBe("failed"));

    expect(offline.destroy).toHaveBeenCalledTimes(1);
  });

  it("stays disposed when disposal races an in-flight clone", async () => {
    const pendingClone = deferred<PromptApiSessionAdapter>();
    const session = fakeSession(["online"]);
    session.clone.mockImplementationOnce(() => pendingClone.promise);
    const service = createPromptApiSpikeService(FIXTURE, platform(factory(session), [0, 1, 2]));
    await service.probe();
    service.runFromUserActivation();
    await vi.waitFor(() => expect(service.snapshot().state).toBe("probing-sessions"));

    service.dispose();
    const lateClone = fakeSession([]);
    pendingClone.resolve(lateClone);
    await vi.waitFor(() => expect(lateClone.destroy).toHaveBeenCalledTimes(1));

    expect(service.snapshot().state).toBe("disposed");
  });

  it("destroys the primary session when streaming fails", async () => {
    const session = fakeSession([]);
    session.promptStreaming.mockReturnValue(
      new ReadableStream({
        pull() {
          throw new Error("stream failed");
        },
      }),
    );
    const service = createPromptApiSpikeService(FIXTURE, platform(factory(session), [0]));
    await service.probe();
    service.runFromUserActivation();
    await vi.waitFor(() => expect(service.snapshot().state).toBe("failed"));

    expect(session.destroy).toHaveBeenCalledTimes(1);
  });

  it("rejects coerced progress values and bounds retained valid samples", async () => {
    const session = fakeSession(["ok"]);
    const model = factory(session);
    model.create = vi.fn<PromptApiFactoryAdapter["create"]>((options) => {
      const monitor = new EventTarget();
      options?.monitor?.(monitor);
      for (let index = 0; index <= 1_000; index += 1) {
        monitor.dispatchEvent(downloadProgressEvent(index / 1_000));
      }
      for (const invalid of [
        null,
        "",
        false,
        [],
        true,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
      ]) {
        monitor.dispatchEvent(downloadProgressEvent(invalid));
      }
      return Promise.resolve(session);
    });
    const service = createPromptApiSpikeService(FIXTURE, platform(model, [0, 1, 2]));
    await service.probe();
    service.runFromUserActivation();
    await vi.waitFor(() => expect(service.snapshot().state).toBe("completed"));

    expect(service.snapshot().download.eventsObserved).toBe(1_009);
    expect(service.snapshot().download.invalidEventsObserved).toBe(8);
    expect(service.snapshot().download.invalidSamples.map((sample) => sample.type)).toEqual([
      "null",
      "string",
      "boolean",
      "array",
      "boolean",
      "number",
      "number",
      "number",
    ]);
    expect(
      service
        .snapshot()
        .download.invalidSamples.slice(-3)
        .map((sample) => sample.value),
    ).toEqual(["NaN", "Infinity", "-Infinity"]);
    expect(service.snapshot().download.samples[0]?.loaded).toBe(0);
    expect(service.snapshot().download.samples.at(-1)?.loaded).toBe(1);
    expect(service.snapshot().download.samples.length).toBeLessThanOrEqual(102);
    expect(service.snapshot().download.maxProgress).toBe(1);
    expect(service.snapshot().download.regressiveEventsObserved).toBe(0);
  });

  it("deduplicates repeated completion progress without quadratic publication", async () => {
    const session = fakeSession(["ok"]);
    const model = factory(session);
    model.create = vi.fn<PromptApiFactoryAdapter["create"]>((options) => {
      const monitor = new EventTarget();
      options?.monitor?.(monitor);
      monitor.dispatchEvent(downloadProgressEvent(0));
      for (let index = 0; index < 10_000; index += 1) {
        monitor.dispatchEvent(downloadProgressEvent(1));
      }
      return Promise.resolve(session);
    });
    const service = createPromptApiSpikeService(FIXTURE, platform(model, [0, 1, 2]));
    let deliveries = 0;
    service.subscribe(() => {
      deliveries += 1;
    });
    await service.probe();
    service.runFromUserActivation();
    await vi.waitFor(() => expect(service.snapshot().state).toBe("completed"));

    expect(service.snapshot().download.eventsObserved).toBe(10_001);
    expect(service.snapshot().download.samples).toEqual([
      { elapsedMs: 1, loaded: 0 },
      { elapsedMs: 2, loaded: 1 },
    ]);
    expect(deliveries).toBeLessThan(30);
  });

  it("publishes sub-percent forward progress as a bounded liveness heartbeat", async () => {
    const creation = deferred<PromptApiSessionAdapter>();
    const model = factory(fakeSession([]));
    model.create = vi.fn<PromptApiFactoryAdapter["create"]>((options) => {
      const monitor = new EventTarget();
      options?.monitor?.(monitor);
      monitor.dispatchEvent(downloadProgressEvent(0));
      monitor.dispatchEvent(downloadProgressEvent(0.001));
      monitor.dispatchEvent(downloadProgressEvent(0.002));
      return creation.promise;
    });
    const service = createPromptApiSpikeService(FIXTURE, platform(model, [0, 0, 500, 1_001]));
    await service.probe();
    service.runFromUserActivation();

    expect(service.snapshot().state).toBe("creating");
    expect(service.snapshot().download.maxProgress).toBe(0.002);
    expect(service.snapshot().download.samples).toEqual([{ elapsedMs: 0, loaded: 0 }]);
    service.dispose();
  });

  it("times forward progress and records regressions without treating them as activity", async () => {
    const session = fakeSession(["ok"]);
    const model = factory(session);
    model.create = vi.fn<PromptApiFactoryAdapter["create"]>((options) => {
      const monitor = new EventTarget();
      options?.monitor?.(monitor);
      for (const loaded of [0, 0.4, 0.2, 0.6, 1]) {
        monitor.dispatchEvent(downloadProgressEvent(loaded));
      }
      return Promise.resolve(session);
    });
    const service = createPromptApiSpikeService(
      FIXTURE,
      platform(model, [10, 20, 30, 80, 90, 100]),
    );
    await service.probe();
    service.runFromUserActivation();
    await vi.waitFor(() => expect(service.snapshot().state).toBe("completed"));

    expect(service.snapshot().download).toMatchObject({
      longestProgressGapMs: 60,
      maxProgress: 1,
      regressiveEventsObserved: 1,
      samples: [
        { elapsedMs: 10, loaded: 0 },
        { elapsedMs: 20, loaded: 0.4 },
        { elapsedMs: 80, loaded: 0.6 },
        { elapsedMs: 90, loaded: 1 },
      ],
    });
  });

  it("coalesces an invalid-progress event storm while retaining its exact final count", async () => {
    const session = fakeSession(["ok"]);
    const model = factory(session);
    model.create = vi.fn<PromptApiFactoryAdapter["create"]>((options) => {
      const monitor = new EventTarget();
      options?.monitor?.(monitor);
      for (let index = 0; index < 60_000; index += 1) {
        monitor.dispatchEvent(downloadProgressEvent(index + 2));
      }
      return Promise.resolve(session);
    });
    const service = createPromptApiSpikeService(FIXTURE, platform(model, [0, 1, 2]));
    let deliveries = 0;
    service.subscribe(() => {
      deliveries += 1;
    });
    await service.probe();
    service.runFromUserActivation();
    await vi.waitFor(() => expect(service.snapshot().state).toBe("completed"));

    expect(service.snapshot().download.invalidEventsObserved).toBe(60_000);
    expect(service.snapshot().download.eventsObserved).toBe(60_000);
    expect(service.snapshot().download.invalidSamples).toHaveLength(8);
    expect(deliveries).toBeLessThan(100);
  });

  it("records a synchronous create failure instead of stranding the activation state", async () => {
    const model = factory(fakeSession([]));
    model.create = vi.fn<PromptApiFactoryAdapter["create"]>(() => {
      throw new DOMException("creation failed", "NotSupportedError");
    });
    const service = createPromptApiSpikeService(FIXTURE, platform(model));
    await service.probe();

    service.runFromUserActivation();

    expect(service.snapshot()).toMatchObject({
      failureMessage: "NotSupportedError: creation failed",
      state: "failed",
    });
  });
});

function platform(
  languageModel: PromptApiFactoryAdapter,
  times: number[] = [0],
  probeDedicatedWorkerExposure: PromptApiSpikePlatform["probeDedicatedWorkerExposure"] = async () =>
    false,
): PromptApiSpikePlatform {
  let timeIndex = 0;
  return {
    languageModel,
    now: () => times[Math.min(timeIndex++, times.length - 1)] ?? 0,
    probeDedicatedWorkerExposure,
    userActivationIsActive: () => true,
  };
}

function factory(session: PromptApiSessionAdapter): PromptApiFactoryAdapter {
  return {
    availability: vi.fn(async () => "available" as const),
    create: vi.fn(async () => session),
  };
}

function fakeSession(chunks: string[], cloneSuccesses = Number.POSITIVE_INFINITY) {
  let contextUsage = 4;
  const clones: Array<ReturnType<typeof fakeSession>> = [];
  const session: PromptApiSessionAdapter & {
    clone: ReturnType<typeof vi.fn<PromptApiSessionAdapter["clone"]>>;
    clones: typeof clones;
    destroy: ReturnType<typeof vi.fn<PromptApiSessionAdapter["destroy"]>>;
    promptStreaming: ReturnType<typeof vi.fn<PromptApiSessionAdapter["promptStreaming"]>>;
  } = {
    get contextUsage() {
      return contextUsage;
    },
    contextWindow: 4096,
    clone: vi.fn<PromptApiSessionAdapter["clone"]>(async () => {
      if (clones.length >= cloneSuccesses) {
        throw new DOMException("resource pressure", "NotSupportedError");
      }
      const clone = fakeSession([]);
      clones.push(clone);
      return clone;
    }),
    clones,
    destroy: vi.fn<PromptApiSessionAdapter["destroy"]>(),
    measureContextUsage: vi.fn(async () => 14),
    promptStreaming: vi.fn<PromptApiSessionAdapter["promptStreaming"]>(() => {
      contextUsage = 18;
      return stream(chunks);
    }),
  };
  return session;
}

function downloadProgressEvent(loaded: unknown): Event {
  const event = new Event("downloadprogress");
  Object.defineProperty(event, "loaded", { value: loaded });
  return event;
}

function stream(chunks: string[]): ReadableStream<string> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function deferred<T>(): Readonly<{ promise: Promise<T>; resolve(value: T): void }> {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return Object.freeze({ promise, resolve: resolvePromise });
}

class StubWorker {
  onerror: Worker["onerror"] = null;
  onmessage: Worker["onmessage"] = null;
  onmessageerror: Worker["onmessageerror"] = null;
  readonly terminate = vi.fn<Worker["terminate"]>();

  emitError(message: string): void {
    const listener = this.onerror as ((event: ErrorEvent) => void) | null;
    listener?.({ message } as ErrorEvent);
  }

  emitMessage(data: unknown): void {
    const listener = this.onmessage as ((event: MessageEvent<unknown>) => void) | null;
    listener?.({ data } as MessageEvent<unknown>);
  }

  emitMessageError(): void {
    const listener = this.onmessageerror as ((event: MessageEvent<unknown>) => void) | null;
    listener?.({ data: null } as MessageEvent<unknown>);
  }
}

function fakeWorkerProbePlatform(worker: StubWorker): Readonly<{
  platform: PromptApiWorkerProbePlatform;
  revokeObjectUrl: ReturnType<typeof vi.fn<PromptApiWorkerProbePlatform["revokeObjectUrl"]>>;
}> {
  const revokeObjectUrl = vi.fn<PromptApiWorkerProbePlatform["revokeObjectUrl"]>();
  return Object.freeze({
    platform: {
      createObjectUrl: (source) => {
        expect(source).toContain("LanguageModel");
        return "blob:prompt-probe";
      },
      createWorker: () => worker as unknown as Worker,
      revokeObjectUrl,
    },
    revokeObjectUrl,
  });
}
