import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import type {
  ParallaxTelemetryExport,
  ParallaxTelemetrySnapshot,
  StreamingRecoveryCheckpoint,
} from "@parallax/engine";
import { describe, expect, it, vi } from "vitest";
import {
  evaluateRenderRecoveryPage,
  evaluateRenderRecoveryWait,
  type RenderRecoveryActionRequest,
  type RenderRecoveryPageResult,
  type RenderRecoveryWaitRequest,
} from "./render-recovery-page.js";

describe("render-recovery page-realm operations", () => {
  it("serializes without lexical dependencies and exercises every operation", async () => {
    const prepareFlythrough = vi.fn();
    const startFlythrough = vi.fn();
    const exerciseRenderRecovery = vi.fn();
    const checkpoint = Object.freeze({
      flythroughObserverUpdateCount: 4,
      observerUpdateCount: 4,
      observers: Object.freeze([Object.freeze([128, 12, 0] as const)]),
      residentCellIds: Object.freeze(["moved"]),
      workerGeneration: 1,
    }) as StreamingRecoveryCheckpoint;
    let snapshot = recoverySnapshot();
    const telemetry = {
      exerciseRenderRecovery,
      exerciseRenderRecoveryAtBoundary: vi.fn().mockResolvedValue(checkpoint),
      prepareFlythrough,
      snapshot: () => snapshot,
      startFlythrough,
    } as unknown as ParallaxTelemetryExport;
    const detachedAction = detachedPageOperation(telemetry);
    const detachedWait = detachedWaitOperation(telemetry);

    expect(detachedWait({ kind: "wait-for-prepared", residentCount: 9 })).toBe(true);
    expect(
      detachedWait({
        initialObservers: [[0, 12, 0]],
        initialResidentCellIds: ["boot"],
        kind: "wait-for-movement",
        minimumMovement: 96,
        residentCount: 9,
      }),
    ).toBe(true);
    expect(detachedWait({ kind: "wait-for-recovery", residentCount: 9 })).toBe(true);
    expect(
      detachedWait({ frameCount: snapshot.render.frameCount - 1, kind: "wait-for-frame" }),
    ).toBe(true);
    expect(
      detachedWait({
        kind: "wait-for-initial-cohort",
        residentCount: 9,
        schemaVersion: snapshot.schemaVersion,
      }),
    ).toBe(false);

    await detachedAction({ action: "prepare", kind: "invoke" });
    await detachedAction({ action: "start", kind: "invoke" });
    await detachedAction({ kind: "exercise", probe: "worker-crash" });
    await expect(
      detachedAction({ kind: "exercise-at-boundary", probe: "device-loss" }),
    ).resolves.toEqual({ checkpoint, snapshot });
    expect(prepareFlythrough).toHaveBeenCalledOnce();
    expect(startFlythrough).toHaveBeenCalledOnce();
    expect(exerciseRenderRecovery).toHaveBeenCalledWith("worker-crash");

    snapshot = {
      ...snapshot,
      render: {
        ...snapshot.render,
        recovery: { ...snapshot.render.recovery, state: "exhausted" },
        state: "failed",
      },
      streaming: { ...snapshot.streaming, state: "failed" },
    };
    expect(detachedWait({ kind: "wait-for-exhaustion", residentCount: 9 })).toBe(true);
  });

  it("fails explicitly when the page telemetry surface is absent", async () => {
    const detachedAction = detachedPageOperation(null);
    const detachedWait = detachedWaitOperation(null);
    expect(() => detachedWait({ kind: "wait-for-prepared", residentCount: 9 })).toThrow(
      /telemetry is unavailable/,
    );
    await expect(detachedAction({ action: "prepare", kind: "invoke" })).rejects.toThrow(
      /telemetry is unavailable/,
    );
  });

  it("keeps boundary waits pending for missing or stale settled checkpoints", async () => {
    let snapshot = initialCohortSnapshot();
    const telemetry = {
      exerciseRenderRecovery: vi.fn(),
      exerciseRenderRecoveryAtBoundary: vi.fn(),
      prepareFlythrough: vi.fn(),
      snapshot: () => snapshot,
      startFlythrough: vi.fn(),
    } as unknown as ParallaxTelemetryExport;
    const detachedWait = detachedWaitOperation(telemetry);
    const initialRequest = {
      kind: "wait-for-initial-cohort",
      residentCount: 9,
      schemaVersion: snapshot.schemaVersion,
    } as const;

    expect(detachedWait(initialRequest)).toBe(true);
    snapshot = withCheckpoint(snapshot, null);
    expect(detachedWait(initialRequest)).toBe(false);
    snapshot = withCheckpoint(initialCohortSnapshot(), {
      ...requiredCheckpoint(initialCohortSnapshot()),
      observerUpdateCount: 1,
    });
    expect(detachedWait(initialRequest)).toBe(false);

    const recovery = recoverySnapshot();
    const boundaryRequests = [
      { kind: "wait-for-prepared", residentCount: 9 },
      {
        initialObservers: [[0, 12, 0]],
        initialResidentCellIds: initialResidents(),
        kind: "wait-for-movement",
        minimumMovement: 96,
        residentCount: 9,
      },
      { kind: "wait-for-recovery", residentCount: 9 },
    ] as const satisfies readonly RenderRecoveryWaitRequest[];
    snapshot = withCheckpoint(recovery, null);
    for (const request of boundaryRequests) {
      expect(detachedWait(request)).toBe(false);
    }
    snapshot = withCheckpoint(recovery, {
      ...requiredCheckpoint(recovery),
      residentCellIds: initialResidents(),
    });
    for (const request of boundaryRequests) {
      expect(detachedWait(request)).toBe(false);
    }

    snapshot = {
      ...recovery,
      render: {
        ...recovery.render,
        recovery: { ...recovery.render.recovery, state: "exhausted" },
        state: "failed",
      },
      streaming: {
        ...recovery.streaming,
        settledRecoveryCheckpoint: null,
        state: "failed",
      },
    };
    expect(detachedWait({ kind: "wait-for-exhaustion", residentCount: 9 })).toBe(false);
  });

  it("returns primitive booleans rather than thenables from every wait predicate", () => {
    const snapshot = withCheckpoint(initialCohortSnapshot(), null);
    const detachedWait = detachedWaitOperation({
      exerciseRenderRecovery: vi.fn(),
      exerciseRenderRecoveryAtBoundary: vi.fn(),
      prepareFlythrough: vi.fn(),
      snapshot: () => snapshot,
      startFlythrough: vi.fn(),
    } as unknown as ParallaxTelemetryExport);
    const requests = [
      { kind: "wait-for-prepared", residentCount: 9 },
      {
        initialObservers: [[0, 12, 0]],
        initialResidentCellIds: initialResidents(),
        kind: "wait-for-movement",
        minimumMovement: 96,
        residentCount: 9,
      },
      { kind: "wait-for-recovery", residentCount: 9 },
      { frameCount: snapshot.render.frameCount, kind: "wait-for-frame" },
      { kind: "wait-for-exhaustion", residentCount: 9 },
      {
        kind: "wait-for-initial-cohort",
        residentCount: 9,
        schemaVersion: snapshot.schemaVersion,
      },
    ] as const satisfies readonly RenderRecoveryWaitRequest[];

    for (const request of requests) {
      const result: unknown = detachedWait(request);
      expect(result).toBe(false);
      expect(typeof result).toBe("boolean");
      expect(Reflect.get(Object(result), "then")).toBeUndefined();
    }
  });

  it("routes waits through the synchronous dispatcher and actions through the async dispatcher", () => {
    const sourceText = readFileSync(new URL("./render-recovery-run.ts", import.meta.url), "utf8");
    const waitCalls = sourceText.match(/\.waitForFunction(?=[<(])/g) ?? [];
    const synchronousWaitCalls =
      sourceText.match(/\.waitForFunction(?:<[^>]+>)?\(\s*evaluateRenderRecoveryWait/g) ?? [];
    const evaluateCalls = sourceText.match(/\.evaluate(?=[<(])/g) ?? [];
    const detachedActionCalls =
      sourceText.match(/\.evaluate(?:<[^>]+>)?\(\s*evaluateRenderRecoveryPage/g) ?? [];

    expect(waitCalls).toHaveLength(6);
    expect(synchronousWaitCalls).toHaveLength(waitCalls.length);
    expect(evaluateCalls).toHaveLength(3);
    expect(detachedActionCalls).toHaveLength(evaluateCalls.length);
  });
});

type DetachedPageOperation = (
  request: RenderRecoveryActionRequest,
) => Promise<RenderRecoveryPageResult>;

function detachedPageOperation(telemetry: ParallaxTelemetryExport | null): DetachedPageOperation {
  return runInNewContext(`(${evaluateRenderRecoveryPage.toString()})`, {
    __PARALLAX_TELEMETRY__: telemetry,
  }) as unknown as DetachedPageOperation;
}

type DetachedWaitOperation = (request: RenderRecoveryWaitRequest) => boolean;

function detachedWaitOperation(telemetry: ParallaxTelemetryExport | null): DetachedWaitOperation {
  return runInNewContext(`(${evaluateRenderRecoveryWait.toString()})`, {
    __PARALLAX_TELEMETRY__: telemetry,
  }) as unknown as DetachedWaitOperation;
}

function recoverySnapshot(): ParallaxTelemetrySnapshot {
  const residentCellIds = movedResidents();
  return {
    flythrough: { state: "prepared" },
    render: {
      frameCount: 100,
      recovery: {
        restartCount: 1,
        state: "recovered",
        workerGeneration: 2,
      },
      sabRingBufferSpike: { state: "completed" },
      state: "ready",
    },
    schemaVersion: 36,
    streaming: {
      currentObservers: [[128, 12, 0]],
      flythroughObserverUpdateCount: 4,
      observerUpdateCount: 4,
      renderRecoveryCount: 1,
      residentCellCount: 9,
      residentCellIds,
      settledRecoveryCheckpoint: {
        flythroughObserverUpdateCount: 4,
        observerUpdateCount: 4,
        observers: [[128, 12, 0]],
        residentCellIds,
        workerGeneration: 2,
      },
      settledObserverUpdateCount: 4,
      state: "streaming",
      workerGeneration: 2,
    },
  } as unknown as ParallaxTelemetrySnapshot;
}

function initialCohortSnapshot(): ParallaxTelemetrySnapshot {
  const snapshot = recoverySnapshot();
  return {
    ...snapshot,
    render: {
      ...snapshot.render,
      recovery: {
        ...snapshot.render.recovery,
        restartCount: 0,
        state: "not-needed",
        workerGeneration: 1,
      },
    },
    streaming: {
      ...snapshot.streaming,
      renderRecoveryCount: 0,
      settledRecoveryCheckpoint: {
        ...requiredCheckpoint(snapshot),
        workerGeneration: 1,
      },
      workerGeneration: 1,
    },
  } as ParallaxTelemetrySnapshot;
}

function withCheckpoint(
  snapshot: ParallaxTelemetrySnapshot,
  checkpoint: StreamingRecoveryCheckpoint | null,
): ParallaxTelemetrySnapshot {
  return {
    ...snapshot,
    streaming: {
      ...snapshot.streaming,
      settledRecoveryCheckpoint: checkpoint,
    },
  };
}

function requiredCheckpoint(snapshot: ParallaxTelemetrySnapshot): StreamingRecoveryCheckpoint {
  const checkpoint = snapshot.streaming.settledRecoveryCheckpoint;
  if (checkpoint === null) throw new Error("Test fixture lost its settled checkpoint");
  return checkpoint;
}

function initialResidents(): readonly string[] {
  return Object.freeze(["a", "b", "c", "d", "e", "f", "g", "h", "i"]);
}

function movedResidents(): readonly string[] {
  return Object.freeze(["j", "k", "l", "m", "n", "o", "p", "q", "r"]);
}
