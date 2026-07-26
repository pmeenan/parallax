import type {
  ParallaxTelemetryExport,
  ParallaxTelemetrySnapshot,
  RenderRecoveryProbeKind,
  StreamingRecoveryCheckpoint,
} from "@parallax/engine";

export type RenderRecoveryWaitRequest =
  | Readonly<{
      readonly kind: "wait-for-prepared";
      readonly residentCount: number;
    }>
  | Readonly<{
      readonly initialObservers: readonly (readonly [number, number, number])[];
      readonly initialResidentCellIds: readonly string[];
      readonly kind: "wait-for-movement";
      readonly minimumMovement: number;
      readonly residentCount: number;
    }>
  | Readonly<{
      readonly kind: "wait-for-recovery";
      readonly residentCount: number;
    }>
  | Readonly<{
      readonly frameCount: number;
      readonly kind: "wait-for-frame";
    }>
  | Readonly<{
      readonly kind: "wait-for-exhaustion";
      readonly residentCount: number;
    }>
  | Readonly<{
      readonly kind: "wait-for-initial-cohort";
      readonly residentCount: number;
      readonly schemaVersion: number;
    }>;

export type RenderRecoveryActionRequest =
  | Readonly<{
      readonly action: "prepare" | "start";
      readonly kind: "invoke";
    }>
  | Readonly<{
      readonly kind: "exercise";
      readonly probe: RenderRecoveryProbeKind;
    }>
  | Readonly<{
      readonly kind: "exercise-at-boundary";
      readonly probe: RenderRecoveryProbeKind;
    }>;

export type RenderRecoveryPageResult =
  | undefined
  | Readonly<{
      readonly checkpoint: StreamingRecoveryCheckpoint;
      readonly snapshot: ParallaxTelemetrySnapshot;
    }>;

/**
 * Playwright serializes this function and executes it in the page realm. Playwright
 * 1.61.1 tests the immediate predicate result for truthiness, so this must stay
 * synchronous and boolean-returning; a Promise<boolean> ends the wait immediately.
 * Keep the implementation self-contained: no imported values or module-scope helpers.
 */
export function evaluateRenderRecoveryWait(request: RenderRecoveryWaitRequest): boolean {
  const candidate: unknown = Reflect.get(globalThis, "__PARALLAX_TELEMETRY__");
  if (typeof candidate !== "object" || candidate === null) {
    throw new Error("Parallax telemetry is unavailable in the page realm");
  }
  if (typeof Reflect.get(candidate, "snapshot") !== "function") {
    throw new Error("Parallax telemetry page method snapshot is unavailable");
  }
  const telemetry = candidate as ParallaxTelemetryExport;
  const hasExactSettledCheckpoint = (
    snapshot: ParallaxTelemetrySnapshot,
    residentCount: number,
  ): boolean => {
    const streaming = snapshot.streaming;
    const checkpoint = streaming.settledRecoveryCheckpoint;
    return (
      checkpoint !== null &&
      checkpoint.workerGeneration === streaming.workerGeneration &&
      checkpoint.observerUpdateCount === streaming.settledObserverUpdateCount &&
      streaming.settledObserverUpdateCount === streaming.observerUpdateCount &&
      checkpoint.flythroughObserverUpdateCount === streaming.flythroughObserverUpdateCount &&
      checkpoint.flythroughObserverUpdateCount <= checkpoint.observerUpdateCount &&
      checkpoint.observers.length > 0 &&
      checkpoint.observers.every(
        (observer) =>
          observer.length === 3 && observer.every((component) => Number.isFinite(component)),
      ) &&
      streaming.residentCellCount === residentCount &&
      streaming.residentCellIds.length === residentCount &&
      checkpoint.residentCellIds.length === residentCount &&
      checkpoint.residentCellIds.every((cellId) => cellId.length > 0) &&
      new Set(checkpoint.residentCellIds).size === residentCount &&
      JSON.stringify(checkpoint.residentCellIds) ===
        JSON.stringify([...checkpoint.residentCellIds].sort()) &&
      JSON.stringify(checkpoint.observers) === JSON.stringify(streaming.currentObservers) &&
      JSON.stringify(checkpoint.residentCellIds) === JSON.stringify(streaming.residentCellIds)
    );
  };

  switch (request.kind) {
    case "wait-for-prepared": {
      const snapshot = telemetry.snapshot();
      return (
        ["prepared", "failed"].includes(snapshot.flythrough.state) &&
        hasExactSettledCheckpoint(snapshot, request.residentCount)
      );
    }
    case "wait-for-movement": {
      const snapshot = telemetry.snapshot();
      const from = request.initialObservers[0];
      const to = snapshot.streaming.currentObservers[0];
      const distance =
        from === undefined || to === undefined
          ? 0
          : Math.hypot(from[0] - to[0], from[1] - to[1], from[2] - to[2]);
      return (
        snapshot.render.state === "ready" &&
        snapshot.streaming.state === "streaming" &&
        snapshot.streaming.flythroughObserverUpdateCount > 0 &&
        hasExactSettledCheckpoint(snapshot, request.residentCount) &&
        distance >= request.minimumMovement &&
        JSON.stringify(snapshot.streaming.residentCellIds) !==
          JSON.stringify(request.initialResidentCellIds)
      );
    }
    case "wait-for-recovery": {
      const snapshot = telemetry.snapshot();
      return (
        snapshot.render.state === "ready" &&
        snapshot.render.recovery.state === "recovered" &&
        snapshot.render.recovery.restartCount === 1 &&
        snapshot.render.recovery.workerGeneration === 2 &&
        snapshot.render.sabRingBufferSpike.state === "completed" &&
        snapshot.streaming.state === "streaming" &&
        snapshot.streaming.workerGeneration === 2 &&
        snapshot.streaming.renderRecoveryCount === 1 &&
        hasExactSettledCheckpoint(snapshot, request.residentCount)
      );
    }
    case "wait-for-frame":
      return telemetry.snapshot().render.frameCount > request.frameCount;
    case "wait-for-exhaustion": {
      const snapshot = telemetry.snapshot();
      return (
        snapshot.render.state === "failed" &&
        snapshot.render.recovery.state === "exhausted" &&
        snapshot.streaming.state === "failed" &&
        hasExactSettledCheckpoint(snapshot, request.residentCount)
      );
    }
    case "wait-for-initial-cohort": {
      const snapshot = telemetry.snapshot();
      return (
        snapshot.schemaVersion === request.schemaVersion &&
        snapshot.render.state === "ready" &&
        snapshot.render.recovery.workerGeneration === 1 &&
        snapshot.render.sabRingBufferSpike.state === "completed" &&
        snapshot.streaming.state === "streaming" &&
        snapshot.streaming.workerGeneration === 1 &&
        hasExactSettledCheckpoint(snapshot, request.residentCount)
      );
    }
  }
}

/**
 * Playwright serializes this function and executes it in the page realm. Keep its
 * implementation self-contained: no imported values or module-scope helpers.
 */
export async function evaluateRenderRecoveryPage(
  request: RenderRecoveryActionRequest,
): Promise<RenderRecoveryPageResult> {
  const candidate: unknown = Reflect.get(globalThis, "__PARALLAX_TELEMETRY__");
  if (typeof candidate !== "object" || candidate === null) {
    throw new Error("Parallax telemetry is unavailable in the page realm");
  }
  for (const method of [
    "snapshot",
    "prepareFlythrough",
    "startFlythrough",
    "exerciseRenderRecovery",
    "exerciseRenderRecoveryAtBoundary",
  ]) {
    if (typeof Reflect.get(candidate, method) !== "function") {
      throw new Error(`Parallax telemetry page method ${method} is unavailable`);
    }
  }
  const telemetry = candidate as ParallaxTelemetryExport;

  switch (request.kind) {
    case "invoke":
      if (request.action === "prepare") telemetry.prepareFlythrough();
      else telemetry.startFlythrough();
      return;
    case "exercise":
      telemetry.exerciseRenderRecovery(request.probe);
      return;
    case "exercise-at-boundary": {
      const checkpoint = await telemetry.exerciseRenderRecoveryAtBoundary(request.probe);
      return { checkpoint, snapshot: telemetry.snapshot() };
    }
  }
}
