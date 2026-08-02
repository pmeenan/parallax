import { describe, expect, it } from "vitest";
import { isSanitizedDiagnosticCause, sanitizeDiagnosticCause } from "./diagnostic-redaction.js";
import {
  createProgressLivenessMonitor,
  DEGRADED_DURABILITY_WARNING,
  PROGRESS_LIVENESS_STALL_TIMEOUT_MS,
  ProgressLivenessError,
  type ProgressLivenessObservation,
  type ProgressState,
  waitForProgressLiveness,
  zeroProgressState,
} from "./progress-liveness.js";

describe("bounded progress liveness", () => {
  it("continues beyond the former 600-second wait while monotonic progress remains live", () => {
    const monitor = createProgressLivenessMonitor(0);
    for (let timestamp = 100_000; timestamp <= 700_000; timestamp += 100_000) {
      expect(
        monitor.observe(timestamp, observation(progress({ downloadedBytes: timestamp }))),
      ).toBe("continue");
    }
    expect(
      monitor.observe(
        701_000,
        observation(
          progress({
            downloadedBytes: 700_000,
            finalVerificationBytes: 1,
            finalVerificationPhase: "complete",
            finalVerificationResourceCount: 1,
            finalVerificationTotalBytes: 1,
            finalVerificationTotalResourceCount: 1,
          }),
          "ready",
        ),
      ),
    ).toBe("ready");
    expect(monitor.snapshot(701_000)).toMatchObject({
      lastProgressGapMs: 0,
      maxProgressGapMs: 100_000,
      timeoutClassification: null,
    });
  });

  it("fails a strict 120-second stall and duplicate, churn, or regression never resets it", () => {
    const monitor = createProgressLivenessMonitor(0);
    monitor.observe(1_000, observation(progress({ downloadedBytes: 10 })));
    monitor.observe(60_000, observation(progress({ downloadedBytes: 10 }), "checking"));
    monitor.observe(90_000, observation(progress({ downloadedBytes: 9 }), "installing"));
    expect(() => monitor.observe(121_000, observation(progress({ downloadedBytes: 10 })))).toThrow(
      ProgressLivenessError,
    );
    expect(monitor.snapshot(121_000)).toMatchObject({
      lastProgressAtMs: 1_000,
      lastProgressGapMs: 120_000,
      maxProgressGapMs: 120_000,
      timeoutClassification: "stall",
    });
  });

  it("fails the 30-minute absolute bound even when the terminal observation progresses", () => {
    const monitor = createProgressLivenessMonitor(0);
    for (let timestamp = 100_000; timestamp < 1_800_000; timestamp += 100_000) {
      monitor.observe(timestamp, observation(progress({ downloadedBytes: timestamp })));
    }
    expect(() =>
      monitor.observe(
        1_800_000,
        observation(
          progress({
            downloadedBytes: 1_800_000,
            finalVerificationBytes: 1,
            finalVerificationPhase: "complete",
            finalVerificationResourceCount: 1,
            finalVerificationTotalBytes: 1,
            finalVerificationTotalResourceCount: 1,
          }),
          "ready",
        ),
      ),
    ).toThrow(ProgressLivenessError);
    expect(monitor.snapshot(1_800_000).timeoutClassification).toBe("absolute");
  });

  it("fails terminal UI state immediately and sanitizes its app cause", () => {
    const monitor = createProgressLivenessMonitor(0);
    expect(() =>
      monitor.observe(1, {
        ...observation(),
        state: "failed",
        terminalCause: new Error("C:\\Users\\person\\secret ".repeat(100)),
      }),
    ).toThrow(ProgressLivenessError);
    const snapshot = monitor.snapshot(1);
    expect(snapshot.timeoutClassification).toBe("terminal");
    expect(snapshot.terminalCause?.message.length).toBeLessThanOrEqual(500);
  });

  it("retains a terminal liveness snapshot when an injected monotonic clock regresses", () => {
    const monitor = createProgressLivenessMonitor(100);
    monitor.observe(200, observation(progress({ downloadedBytes: 1 })));
    expect(() => monitor.observe(150, observation(progress({ downloadedBytes: 2 })))).toThrow(
      ProgressLivenessError,
    );
    expect(monitor.snapshot(200)).toMatchObject({
      lastProgressAtMs: 200,
      lastProgressGapMs: 0,
      timeoutClassification: "terminal",
      terminalCause: { message: "Ready liveness monotonic clock regressed" },
    });
  });

  it("redacts paths, URL credentials and queries, users, tokens, and controls", () => {
    const cause = sanitizeDiagnosticCause(
      new Error(
        [
          "C:\\Users\\alice\\private\\model.gguf",
          "/home/alice/private/model.gguf",
          "\\\\server\\share\\alice\\private.txt",
          "https://alice:password@example.test/install?token=abc&user=alice",
          "authorization=Bearer-secret token=plain username=alice",
          "Bearer eyJhbGciOiJIUzI1NiJ9.secret.signature",
          "\u0000",
        ].join(" "),
      ),
    );
    expect(cause.message).not.toMatch(
      /alice|password|Bearer-secret|eyJhbGci|private|token=abc|C:\\|\/home\/|\\\\server/i,
    );
    expect(cause.message).toContain("<local-path>");
    expect(cause.message).toContain("<redacted-query>");
    expect(isSanitizedDiagnosticCause(cause)).toBe(true);
    expect(
      isSanitizedDiagnosticCause({
        ...cause,
        message: `${cause.message} token=leaked`,
      }),
    ).toBe(false);
  });

  it("retains structured installer failure fields through shared cause redaction", () => {
    const cause = sanitizeDiagnosticCause({
      code: "quota",
      failureClass: "quota",
      failureEvidence: "quota-exceeded",
      message: "C:\\Users\\person\\private quota failure",
      operation: "install",
      recovery: "retry",
      resourceId: "common-model-shard-1",
    });
    expect(cause.message).toContain("code=quota");
    expect(cause.message).toContain("failureClass=quota");
    expect(cause.message).toContain("failureEvidence=quota-exceeded");
    expect(cause.message).toContain("operation=install");
    expect(cause.message).toContain("recovery=retry");
    expect(cause.message).toContain("resourceId=common-model-shard-1");
    expect(cause.message).not.toContain("C:\\Users\\person");
    expect(isSanitizedDiagnosticCause(cause)).toBe(true);
  });

  it("reserves the complete allowed-max installer tuple ahead of freeform evidence", () => {
    const resourceId = `r${"x".repeat(126)}z`;
    const message = "C:\\Users\\alice\\private\\model.gguf token=hunter2 ".padEnd(256, "m");
    expect(resourceId).toHaveLength(128);
    expect(message).toHaveLength(256);

    const cause = sanitizeDiagnosticCause({
      code: "store",
      failureClass: "installer-store",
      failureEvidence: "store-selection-restore",
      message,
      operation: "repair",
      recovery: "retry",
      resourceId,
    });

    expect(cause.message).toContain("code=store");
    expect(cause.message).toContain("failureClass=installer-store");
    expect(cause.message).toContain("failureEvidence=store-selection-restore");
    expect(cause.message).toContain("operation=repair");
    expect(cause.message).toContain("recovery=retry");
    expect(cause.message).toContain(`resourceId=${resourceId}`);
    const structuredPrefix = [
      "code=store",
      "failureClass=installer-store",
      "failureEvidence=store-selection-restore",
      "operation=repair",
      "recovery=retry",
      `resourceId=${resourceId}`,
    ].join("; ");
    expect(cause.message.startsWith(`${structuredPrefix}; message=`)).toBe(true);
    expect(cause.message).toContain("message=<local-path> token=<redacted>");
    expect(cause.message).toHaveLength(500);
    expect(cause.message).not.toMatch(/alice|hunter2|C:\\/i);
    expect(isSanitizedDiagnosticCause(cause)).toBe(true);
    expect(sanitizeDiagnosticCause(cause)).toEqual(cause);
  });

  it("replaces structured-field delimiter injections with one unambiguous marker", () => {
    const validFailure = {
      code: "store",
      failureClass: "installer-store",
      failureEvidence: "store-selection-restore",
      message: "installer failure",
      operation: "repair",
      recovery: "retry",
      resourceId: "common-model-shard-1",
    } as const;
    const keys = [
      "code",
      "failureClass",
      "failureEvidence",
      "operation",
      "recovery",
      "resourceId",
    ] as const;
    const injectionSuffixes = [
      "; message=forged",
      "=forged",
      "\r\nrecovery=forged",
      "\u0000",
      " recovery=forged",
      "; recovery=forged",
    ] as const;

    for (const key of keys) {
      for (const suffix of injectionSuffixes) {
        const context = `${key}: ${JSON.stringify(suffix)}`;
        const cause = sanitizeDiagnosticCause({
          ...validFailure,
          [key]: `${validFailure[key]}${suffix}`,
        });
        expect(cause.message, context).toContain(`${key}=<redacted-invalid>`);
        expect(cause.message.match(/message=/g), context).toHaveLength(1);
        expect(cause.message.match(/recovery=/g), context).toHaveLength(1);
        expect(cause.message, context).not.toContain("forged");
        expect(cause.message, context).not.toContain("\r");
        expect(cause.message, context).not.toContain("\n");
        expect(cause.message, context).not.toContain("\u0000");
        expect(cause.message.length, context).toBeLessThanOrEqual(500);
        expect(isSanitizedDiagnosticCause(cause), context).toBe(true);
        expect(sanitizeDiagnosticCause(cause), context).toEqual(cause);
      }
    }
  });

  it("permits persistence denial only with the exact degraded warning and no durability claim", () => {
    const allowed = createProgressLivenessMonitor(0);
    expect(
      allowed.observe(1, {
        ...observation(),
        durabilityClaimed: false,
        persistence: "denied",
        persistenceWarning: DEGRADED_DURABILITY_WARNING,
      }),
    ).toBe("continue");
    for (const invalid of [
      { durabilityClaimed: false, persistenceWarning: "Nearly the warning" },
      { durabilityClaimed: true, persistenceWarning: DEGRADED_DURABILITY_WARNING },
    ]) {
      const monitor = createProgressLivenessMonitor(0);
      expect(() =>
        monitor.observe(1, {
          ...observation(),
          ...invalid,
          persistence: "denied",
        }),
      ).toThrow(ProgressLivenessError);
    }
  });

  it("cleans the polling timer and returns the exact final snapshot", async () => {
    const clock = new FakeReadyClock();
    let reads = 0;
    const pending = waitForProgressLiveness(async () => {
      reads += 1;
      return {
        observation: observation(
          progress({
            downloadedBytes: reads,
            ...(reads === 3
              ? {
                  finalVerificationBytes: 1,
                  finalVerificationPhase: "complete" as const,
                  finalVerificationResourceCount: 1,
                  finalVerificationTotalBytes: 1,
                  finalVerificationTotalResourceCount: 1,
                }
              : {}),
          }),
          reads === 3 ? "ready" : "installing",
        ),
        value: reads,
      };
    }, clock.platform);
    await clock.runUntil(() => reads === 3);
    const result = await pending;
    expect(result.value).toBe(3);
    expect(result.liveness.lastProgressTuple.downloadedBytes).toBe(3);
    expect(clock.activeTimerCount).toBe(0);
  });

  it("fails a nonsettling read at the exact earliest deadline and aborts it", async () => {
    const clock = new FakeReadyClock();
    let aborted = false;
    const pending = waitForProgressLiveness(
      (signal) =>
        new Promise<never>(() => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
        }),
      clock.platform,
    );
    await clock.flush();
    clock.advanceTo(PROGRESS_LIVENESS_STALL_TIMEOUT_MS);
    await expect(pending).rejects.toMatchObject({
      liveness: {
        lastProgressAtMs: 0,
        lastProgressGapMs: PROGRESS_LIVENESS_STALL_TIMEOUT_MS,
        timeoutClassification: "stall",
      },
    });
    expect(aborted).toBe(true);
    expect(clock.now).toBe(PROGRESS_LIVENESS_STALL_TIMEOUT_MS);
    expect(clock.activeTimerCount).toBe(0);
  });

  it("lets the deadline win an observation resolving on the exact boundary", async () => {
    const clock = new FakeReadyClock();
    const deferred = deferredValue({
      observation: observation(progress({ downloadedBytes: 1 })),
      value: 1,
    });
    clock.platform.setTimeout(() => deferred.resolve(), PROGRESS_LIVENESS_STALL_TIMEOUT_MS);
    const pending = waitForProgressLiveness(() => deferred.promise, clock.platform);
    await clock.flush();
    clock.advanceTo(PROGRESS_LIVENESS_STALL_TIMEOUT_MS);
    await expect(pending).rejects.toMatchObject({
      liveness: {
        timeoutClassification: "stall",
      },
    });
    expect(clock.activeTimerCount).toBe(0);
  });

  it("ignores a read that resolves after timeout without leaking timers", async () => {
    const clock = new FakeReadyClock();
    const deferred = deferredValue({
      observation: observation(progress({ downloadedBytes: 1 })),
      value: 1,
    });
    let signal: AbortSignal | null = null;
    const pending = waitForProgressLiveness((currentSignal) => {
      signal = currentSignal;
      return deferred.promise;
    }, clock.platform);
    await clock.flush();
    clock.advanceTo(PROGRESS_LIVENESS_STALL_TIMEOUT_MS);
    await expect(pending).rejects.toBeInstanceOf(ProgressLivenessError);
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    deferred.resolve();
    await clock.flush();
    expect(clock.activeTimerCount).toBe(0);
  });
});

function observation(
  current: ProgressState = zeroProgressState(),
  state = "installing",
): ProgressLivenessObservation {
  return {
    durabilityClaimed: false,
    persistence: "granted",
    persistenceWarning: null,
    progress: current,
    state,
    terminalCause: null,
  };
}

function progress(value: Partial<ProgressState> = {}): ProgressState {
  return { ...zeroProgressState(), ...value };
}

function deferredValue<T>(value: T): Readonly<{ promise: Promise<T>; resolve: () => void }> {
  let resolvePromise: ((current: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => {
      if (resolvePromise === null) throw new Error("Deferred value was not initialized");
      resolvePromise(value);
    },
  };
}

class FakeReadyClock {
  public now = 0;
  readonly #timers = new Map<
    number,
    Readonly<{ atMs: number; callback: () => void; ordinal: number }>
  >();
  #nextHandle = 0;

  public readonly platform = Object.freeze({
    clearTimeout: (handle: unknown): void => {
      this.#timers.delete(handle as number);
    },
    now: (): number => this.now,
    setTimeout: (callback: () => void, milliseconds: number): number => {
      const handle = ++this.#nextHandle;
      this.#timers.set(handle, {
        atMs: this.now + milliseconds,
        callback,
        ordinal: handle,
      });
      return handle;
    },
  });

  public get activeTimerCount(): number {
    return this.#timers.size;
  }

  public advanceTo(atMs: number): void {
    if (atMs < this.now) throw new Error("Fake clock cannot regress");
    this.now = atMs;
    const due = [...this.#timers.entries()]
      .filter(([, timer]) => timer.atMs <= atMs)
      .sort((left, right) => left[1].atMs - right[1].atMs || left[1].ordinal - right[1].ordinal);
    for (const [handle, timer] of due) {
      if (!this.#timers.delete(handle)) continue;
      timer.callback();
    }
  }

  public async flush(): Promise<void> {
    for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
  }

  public async runUntil(predicate: () => boolean): Promise<void> {
    for (let step = 0; step < 20 && !predicate(); step += 1) {
      await this.flush();
      const next = [...this.#timers.values()].sort(
        (left, right) => left.atMs - right.atMs || left.ordinal - right.ordinal,
      )[0];
      if (next !== undefined) this.advanceTo(next.atMs);
    }
    await this.flush();
    if (!predicate()) throw new Error("Fake clock predicate did not settle");
  }
}
