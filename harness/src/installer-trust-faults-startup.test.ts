import { describe, expect, it } from "vitest";
import {
  classifyInstallerTrustStartupObservation,
  type InstallerTrustStartupDeadlineScheduler,
  type InstallerTrustStartupExpectedAuthority,
  type InstallerTrustStartupObservation,
  InstallerTrustStartupTimeoutError,
  waitForInstallerTrustStartupAdmission,
} from "./installer-trust-faults-startup.js";

const EXPECTED: InstallerTrustStartupExpectedAuthority = Object.freeze({
  allowedUiState: "idle",
  artifactDigest: "artifact",
  controllerScriptUrl: "http://127.0.0.1:8080/service-worker.js",
  generationId: "artifact:release",
  releaseDigest: "release",
});

function observation(
  input: Partial<InstallerTrustStartupObservation> = {},
): InstallerTrustStartupObservation {
  return Object.freeze({
    controller: Object.freeze({
      scriptUrl: EXPECTED.controllerScriptUrl,
      state: "activated",
    }),
    controls: Object.freeze({
      launchDisabled: true,
      repairDisabled: true,
      startDisabled: false,
    }),
    diagnosticsAvailable: true,
    installStore: Object.freeze({
      activeReleaseDigest: null,
      failureMessage: null,
      state: "idle",
    }),
    installerTransfer: Object.freeze({
      activeReleaseDigest: null,
      failureCode: null,
      failureMessage: null,
      state: "idle",
    }),
    installerWorkerObserved: true,
    offlineShell: Object.freeze({
      activeArtifactDigest: EXPECTED.artifactDigest,
      activeGenerationId: EXPECTED.generationId,
      activeReleaseDigest: EXPECTED.releaseDigest,
      failureCode: null,
      failureMessage: null,
      state: "active",
    }),
    panel: Object.freeze({
      failureCode: null,
      releaseDigest: null,
      shellGenerationId: null,
      state: "idle",
      storeState: "idle",
      transferState: "idle",
    }),
    ui: Object.freeze({
      failure: null,
      releaseDigest: null,
      shellGenerationId: null,
      state: "idle",
      storeState: "idle",
      transferState: "idle",
    }),
    ...input,
  });
}

function checkingObservation(): InstallerTrustStartupObservation {
  return observation({
    controller: null,
    controls: Object.freeze({
      launchDisabled: true,
      repairDisabled: true,
      startDisabled: true,
    }),
    installStore: Object.freeze({
      activeReleaseDigest: null,
      failureMessage: null,
      state: "unavailable",
    }),
    offlineShell: Object.freeze({
      activeArtifactDigest: null,
      activeGenerationId: null,
      activeReleaseDigest: null,
      failureCode: null,
      failureMessage: null,
      state: "preparing",
    }),
    panel: Object.freeze({
      failureCode: null,
      releaseDigest: null,
      shellGenerationId: null,
      state: "checking",
      storeState: "unavailable",
      transferState: "idle",
    }),
    ui: Object.freeze({
      failure: null,
      releaseDigest: null,
      shellGenerationId: null,
      state: "checking",
      storeState: "unavailable",
      transferState: "idle",
    }),
  });
}

function deadlineHarness(clock: { value: number }): Readonly<{
  active: () => number;
  schedule: InstallerTrustStartupDeadlineScheduler;
}> {
  let active = 0;
  return Object.freeze({
    active: () => active,
    schedule: (milliseconds, expire) => {
      let pending = true;
      active += 1;
      queueMicrotask(() => {
        if (!pending) return;
        pending = false;
        active -= 1;
        clock.value += milliseconds;
        expire();
      });
      return Object.freeze({
        cancel: () => {
          if (!pending) return;
          pending = false;
          active -= 1;
        },
      });
    },
  });
}

describe("installer trust-fault startup admission", () => {
  it("waits through checking and admits only the exact ordinary idle action", async () => {
    const observations = [checkingObservation(), observation()];
    let index = 0;
    const clock = { value: 0 };
    const scheduler = deadlineHarness(clock);
    const admitted = await waitForInstallerTrustStartupAdmission({
      delay: async (milliseconds) => {
        clock.value += milliseconds;
      },
      expected: EXPECTED,
      now: () => clock.value,
      observe: async () => {
        const next = observations[Math.min(index++, observations.length - 1)];
        if (next === undefined) throw new Error("Test omitted a startup observation");
        return next;
      },
      pollIntervalMs: 1,
      scheduleDeadline: scheduler.schedule,
      timeoutMs: 10,
    });

    expect(admitted.ui?.state).toBe("idle");
    expect(classifyInstallerTrustStartupObservation(admitted, EXPECTED)).toBe("ready");
    expect(scheduler.active()).toBe(0);
  });

  it("accepts an exact already-installed ready target when that state is required", () => {
    const readyExpected = Object.freeze({ ...EXPECTED, allowedUiState: "ready" as const });
    const ready = observation({
      controls: Object.freeze({
        launchDisabled: false,
        repairDisabled: false,
        startDisabled: true,
      }),
      installStore: Object.freeze({
        activeReleaseDigest: EXPECTED.releaseDigest,
        failureMessage: null,
        state: "ready",
      }),
      installerTransfer: Object.freeze({
        activeReleaseDigest: EXPECTED.releaseDigest,
        failureCode: null,
        failureMessage: null,
        state: "ready",
      }),
      panel: Object.freeze({
        failureCode: null,
        releaseDigest: EXPECTED.releaseDigest,
        shellGenerationId: EXPECTED.generationId,
        state: "ready",
        storeState: "ready",
        transferState: "ready",
      }),
      ui: Object.freeze({
        failure: null,
        releaseDigest: EXPECTED.releaseDigest,
        shellGenerationId: EXPECTED.generationId,
        state: "ready",
        storeState: "ready",
        transferState: "ready",
      }),
    });

    expect(classifyInstallerTrustStartupObservation(ready, readyExpected)).toBe("ready");
  });

  it("times out a target refresh that remains checking", async () => {
    let now = 0;
    const failure = await waitForInstallerTrustStartupAdmission({
      delay: async (milliseconds) => {
        now += milliseconds;
      },
      expected: EXPECTED,
      now: () => now,
      observe: async () => checkingObservation(),
      pollIntervalMs: 1,
      timeoutMs: 3,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(InstallerTrustStartupTimeoutError);
    expect(failure).toMatchObject({
      stage: "observe",
      timeoutMs: 3,
      uiState: "checking",
    });
  });

  it("times out and releases its deadline when observation never settles", async () => {
    const clock = { value: 0 };
    const scheduler = deadlineHarness(clock);
    const failure = await waitForInstallerTrustStartupAdmission({
      delay: async () => undefined,
      expected: EXPECTED,
      now: () => clock.value,
      observe: () => new Promise<InstallerTrustStartupObservation>(() => undefined),
      scheduleDeadline: scheduler.schedule,
      timeoutMs: 5,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      name: "InstallerTrustStartupTimeoutError",
      stage: "observe",
      timeoutMs: 5,
      uiState: "unavailable",
    });
    expect(scheduler.active()).toBe(0);
  });

  it("times out and releases its deadline when polling delay never settles", async () => {
    const clock = { value: 0 };
    const scheduler = deadlineHarness(clock);
    const failure = await waitForInstallerTrustStartupAdmission({
      delay: () => new Promise<void>(() => undefined),
      expected: EXPECTED,
      now: () => clock.value,
      observe: async () => checkingObservation(),
      scheduleDeadline: scheduler.schedule,
      timeoutMs: 5,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      name: "InstallerTrustStartupTimeoutError",
      stage: "delay",
      timeoutMs: 5,
      uiState: "checking",
    });
    expect(scheduler.active()).toBe(0);
  });

  it("observes a late operation rejection after timeout without leaking it", async () => {
    const clock = { value: 0 };
    const scheduler = deadlineHarness(clock);
    const late = Promise.withResolvers<InstallerTrustStartupObservation>();
    const failure = await waitForInstallerTrustStartupAdmission({
      delay: async () => undefined,
      expected: EXPECTED,
      now: () => clock.value,
      observe: () => late.promise,
      scheduleDeadline: scheduler.schedule,
      timeoutMs: 5,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(InstallerTrustStartupTimeoutError);
    late.reject(new Error("late observation rejection"));
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(scheduler.active()).toBe(0);
  });

  it("fails closed on startup failure before any ordinary action", () => {
    const failed = observation({
      panel: Object.freeze({
        failureCode: "protocol",
        releaseDigest: null,
        shellGenerationId: null,
        state: "failed",
        storeState: "failed",
        transferState: "failed",
      }),
      ui: Object.freeze({
        failure: Object.freeze({ code: "protocol" }),
        releaseDigest: null,
        shellGenerationId: null,
        state: "failed",
        storeState: "failed",
        transferState: "failed",
      }),
    });

    expect(() => classifyInstallerTrustStartupObservation(failed, EXPECTED)).toThrow(
      "Installer startup admission observed a terminal failure",
    );
  });

  it.each([
    [
      "panel-only",
      observation({
        controls: null,
        diagnosticsAvailable: false,
        installStore: null,
        installerTransfer: null,
        offlineShell: null,
        panel: Object.freeze({
          failureCode: "protocol",
          releaseDigest: null,
          shellGenerationId: null,
          state: "failed",
          storeState: null,
          transferState: null,
        }),
        ui: null,
      }),
    ],
    [
      "store-only",
      observation({
        controls: null,
        diagnosticsAvailable: false,
        installStore: Object.freeze({
          activeReleaseDigest: null,
          failureMessage: "OPFS initialization failed",
          state: "failed",
        }),
        installerTransfer: null,
        offlineShell: null,
        panel: null,
        ui: null,
      }),
    ],
    [
      "transfer-only",
      observation({
        controls: null,
        diagnosticsAvailable: false,
        installStore: null,
        installerTransfer: Object.freeze({
          activeReleaseDigest: null,
          failureCode: "protocol",
          failureMessage: "Worker initialization failed",
          state: "failed",
        }),
        offlineShell: null,
        panel: null,
        ui: null,
      }),
    ],
  ])("does not downgrade %s terminal evidence to waiting", (_name, observed) => {
    expect(() => classifyInstallerTrustStartupObservation(observed, EXPECTED)).toThrow(
      "Installer startup admission observed a terminal failure",
    );
  });

  it("rejects contradictory partial diagnostics before waiting for ancillary surfaces", () => {
    const contradictory = observation({
      controls: null,
      diagnosticsAvailable: false,
      installStore: null,
      installerTransfer: null,
      offlineShell: null,
      panel: Object.freeze({
        failureCode: null,
        releaseDigest: null,
        shellGenerationId: null,
        state: "idle",
        storeState: "idle",
        transferState: "idle",
      }),
      ui: Object.freeze({
        failure: null,
        releaseDigest: null,
        shellGenerationId: null,
        state: "checking",
        storeState: "idle",
        transferState: "idle",
      }),
    });

    expect(() => classifyInstallerTrustStartupObservation(contradictory, EXPECTED)).toThrow(
      "Installer startup panel and diagnostics authority contradict",
    );
  });

  it.each([
    [
      "target release",
      observation({
        offlineShell: Object.freeze({
          activeArtifactDigest: EXPECTED.artifactDigest,
          activeGenerationId: "artifact:other",
          activeReleaseDigest: "other",
          failureCode: null,
          failureMessage: null,
          state: "active",
        }),
      }),
      "Installer startup shell authority mismatches the current manifest",
    ],
    [
      "controller",
      observation({
        controller: Object.freeze({
          scriptUrl: "http://127.0.0.1:8080/wrong-worker.js",
          state: "activated",
        }),
      }),
      "Installer startup controller authority mismatches the current manifest",
    ],
  ])("fails closed on %s mismatch", (_name, observed, message) => {
    expect(() => classifyInstallerTrustStartupObservation(observed, EXPECTED)).toThrow(message);
  });
});
