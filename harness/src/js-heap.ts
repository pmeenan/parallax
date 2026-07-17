import type { CDPSession } from "playwright-core";
import { withTimeout } from "./presentation-trace.js";
import { errorMessage } from "./value-utils.js";

export interface JsHeapUsage {
  readonly backingStorageSizeBytes: number | null;
  readonly embedderHeapUsedSizeBytes: number | null;
  readonly totalSizeBytes: number;
  readonly usedSizeBytes: number;
}

export interface JsHeapSample {
  readonly aggregateUsedSizeBytes: number;
  readonly capturedAfterMeasurementStartMs: number;
  readonly collectionDurationMs: number;
  readonly phase: "measurement-end" | "periodic";
  readonly realmResponseCompletionSkewMs: number;
  readonly realms: readonly Readonly<{
    completedAfterCollectionStartMs: number;
    kind: "dedicated-worker" | "window";
    url: string;
    usage: JsHeapUsage;
  }>[];
  readonly scheduledAfterMeasurementStartMs: number;
  readonly samplingStartDelayMs: number;
}

export interface JsHeapEvidence {
  readonly highWaterUsedSizeBytes: number;
  readonly maximumCollectionDurationMs: number;
  readonly maximumRealmResponseCompletionSkewMs: number;
  readonly maximumSamplingStartDelayMs: number;
  readonly missedSampleDeadlines: number;
  readonly periodicSamplingDurationMs: number;
  readonly sampleIntervalMs: number;
  readonly samples: readonly JsHeapSample[];
}

export type JsHeapMetric =
  | Readonly<{ readonly state: "measured"; readonly value: JsHeapEvidence }>
  | Readonly<{
      readonly evidence: JsHeapEvidence | null;
      readonly reason: string;
      readonly state: "invalid";
    }>;

export interface JsHeapSampler {
  discard(): Promise<void>;
  finish(): Promise<JsHeapEvidence>;
  start(): void;
}

export class JsHeapValidationError extends Error {
  readonly evidence: JsHeapEvidence;

  constructor(message: string, evidence: JsHeapEvidence) {
    super(message);
    this.name = "JsHeapValidationError";
    this.evidence = evidence;
  }
}

interface TargetInfo {
  readonly browserContextId?: string;
  readonly targetId: string;
  readonly type: string;
  readonly url: string;
}

interface NestedResponse {
  readonly error?: Readonly<{ code: number; message: string }>;
  readonly id?: number;
  readonly result?: unknown;
}

const HEAP_COMMAND_TIMEOUT_MS = 1_000;
export async function prepareJsHeapSampler(
  browserSession: CDPSession,
  pageSession: CDPSession,
  pageUrl: string,
  expectedWorkerUrls: string | readonly string[],
  sampleIntervalMs: number,
): Promise<JsHeapSampler> {
  if (!Number.isFinite(sampleIntervalMs) || sampleIntervalMs <= 0) {
    throw new Error(`JS heap sample interval must be positive; received ${sampleIntervalMs}`);
  }
  const workerUrls = normalizeExpectedWorkerUrls(expectedWorkerUrls);
  const pageTarget = await readPageTarget(pageSession, pageUrl);
  const workerTargets = await requireExpectedWorkerTopology(browserSession, pageTarget, workerUrls);
  const attachments = await attachWorkers(browserSession, workerTargets);
  try {
    return createSampler(
      browserSession,
      pageSession,
      pageUrl,
      pageTarget,
      attachments,
      sampleIntervalMs,
    );
  } catch (error) {
    await detachWorkerSessions(
      browserSession,
      attachments.map((attachment) => attachment.sessionId),
    );
    throw error;
  }
}

function normalizeExpectedWorkerUrls(
  expectedWorkerUrls: string | readonly string[],
): readonly string[] {
  const urls = typeof expectedWorkerUrls === "string" ? [expectedWorkerUrls] : expectedWorkerUrls;
  if (urls.length === 0)
    throw new Error("JS heap sampler requires at least one expected worker URL");
  if (urls.some((url) => typeof url !== "string" || url.length === 0)) {
    throw new Error("JS heap sampler expected worker URLs must be non-empty strings");
  }
  if (new Set(urls).size !== urls.length) {
    throw new Error("JS heap sampler expected worker URLs must be unique");
  }
  return Object.freeze([...urls]);
}

async function readPageTarget(pageSession: CDPSession, pageUrl: string): Promise<TargetInfo> {
  const response = (await withTimeout(
    pageSession.send("Target.getTargetInfo"),
    HEAP_COMMAND_TIMEOUT_MS,
    "Page Target.getTargetInfo",
  )) as { targetInfo?: TargetInfo };
  const target = response.targetInfo;
  if (
    target === undefined ||
    target.type !== "page" ||
    target.url !== pageUrl ||
    target.browserContextId === undefined
  ) {
    throw new Error(`Page target identity did not match ${pageUrl}`);
  }
  return target;
}

async function requireExpectedWorkerTopology(
  browserSession: CDPSession,
  pageTarget: TargetInfo,
  expectedWorkerUrls: readonly string[],
  expectedWorkerTargetIds?: ReadonlyMap<string, string>,
): Promise<readonly TargetInfo[]> {
  const targets = (await withTimeout(
    browserSession.send("Target.getTargets"),
    HEAP_COMMAND_TIMEOUT_MS,
    "Target.getTargets",
  )) as {
    targetInfos: readonly TargetInfo[];
  };
  const contextTargets = targets.targetInfos.filter(
    (target) => target.browserContextId === pageTarget.browserContextId,
  );
  const expectedPageTargets = contextTargets.filter(
    (target) =>
      target.targetId === pageTarget.targetId &&
      target.type === pageTarget.type &&
      target.url === pageTarget.url,
  );
  const expectedWorkerTargets = expectedWorkerUrls.map((expectedWorkerUrl) =>
    contextTargets.filter(
      (target) =>
        target.type === "worker" &&
        target.url === expectedWorkerUrl &&
        (expectedWorkerTargetIds === undefined ||
          target.targetId === expectedWorkerTargetIds.get(expectedWorkerUrl)),
    ),
  );
  if (
    expectedPageTargets.length !== 1 ||
    expectedWorkerTargets.some((targets) => targets.length !== 1) ||
    contextTargets.length !== expectedWorkerUrls.length + 1
  ) {
    throw new Error(
      `Expected the app context to contain only page ${pageTarget.url} and dedicated worker(s) ${expectedWorkerUrls.join(", ")}; received ${contextTargets.length} target(s): ${contextTargets.map((target) => `${target.type}:${target.url}`).join(", ") || "none"}`,
    );
  }
  const workerTargets = expectedWorkerTargets.map((targets) => targets[0]);
  if (workerTargets.some((target) => target === undefined)) {
    throw new Error("Expected dedicated-worker target disappeared");
  }
  return workerTargets as readonly TargetInfo[];
}

interface WorkerAttachment {
  readonly sessionId: string;
  readonly target: TargetInfo;
}

async function attachWorkers(
  browserSession: CDPSession,
  workerTargets: readonly TargetInfo[],
): Promise<readonly WorkerAttachment[]> {
  const results = await Promise.allSettled(
    workerTargets.map(async (target): Promise<WorkerAttachment> => {
      const attachment = (await withTimeout(
        browserSession.send("Target.attachToTarget", { flatten: false, targetId: target.targetId }),
        HEAP_COMMAND_TIMEOUT_MS,
        "Target.attachToTarget",
      )) as { sessionId?: unknown };
      if (typeof attachment.sessionId !== "string" || attachment.sessionId.length === 0) {
        throw new Error("Target.attachToTarget omitted its session ID");
      }
      return Object.freeze({ sessionId: attachment.sessionId, target });
    }),
  );
  const attachments = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure !== undefined) {
    await detachWorkerSessions(
      browserSession,
      attachments.map((attachment) => attachment.sessionId),
    );
    throw failure.reason;
  }
  return Object.freeze(attachments);
}

async function detachWorkerSessions(
  browserSession: CDPSession,
  sessionIds: readonly string[],
): Promise<void> {
  await Promise.all(
    sessionIds.map((sessionId) =>
      withTimeout(
        browserSession.send("Target.detachFromTarget", { sessionId }),
        HEAP_COMMAND_TIMEOUT_MS,
        "Target.detachFromTarget",
      ).catch(() => undefined),
    ),
  );
}

export function invalidateJsHeapMetric(metric: JsHeapMetric, reason: string): JsHeapMetric {
  return Object.freeze({
    evidence: metric.state === "measured" ? metric.value : metric.evidence,
    reason: metric.state === "measured" ? reason : `${metric.reason}; ${reason}`,
    state: "invalid",
  });
}

export function summarizeJsHeapSamples(
  samples: readonly JsHeapSample[],
  sampleIntervalMs: number,
  periodicSamplingDurationMs: number,
): JsHeapEvidence {
  if (samples.length < 2) {
    throw new Error(`JS heap sampler requires at least two samples; received ${samples.length}`);
  }
  const periodicSamples = samples.filter((sample) => sample.phase === "periodic");
  if (periodicSamples.length === 0) {
    throw new Error("JS heap sampler requires at least one periodic sample");
  }
  const maximumCollectionDurationMs = Math.max(
    ...samples.map((sample) => sample.collectionDurationMs),
  );
  const maximumRealmResponseCompletionSkewMs = Math.max(
    ...samples.map((sample) => sample.realmResponseCompletionSkewMs),
  );
  const maximumSamplingStartDelayMs = Math.max(
    ...periodicSamples.map((sample) => sample.samplingStartDelayMs),
  );
  // The forced measurement-end sample substitutes for the most recent deadline.
  // Earlier due deadlines must still have produced periodic samples.
  const expectedPeriodicSamples = Math.max(
    1,
    Math.floor(periodicSamplingDurationMs / sampleIntervalMs),
  );
  const missedSampleDeadlines = Math.max(0, expectedPeriodicSamples - periodicSamples.length);
  const evidence = Object.freeze({
    highWaterUsedSizeBytes: Math.max(...samples.map((sample) => sample.aggregateUsedSizeBytes)),
    maximumCollectionDurationMs,
    maximumRealmResponseCompletionSkewMs,
    maximumSamplingStartDelayMs,
    missedSampleDeadlines,
    periodicSamplingDurationMs,
    sampleIntervalMs,
    samples: Object.freeze([...samples]),
  });
  if (maximumRealmResponseCompletionSkewMs >= sampleIntervalMs) {
    throw new JsHeapValidationError(
      `JS heap realm response-completion skew ${maximumRealmResponseCompletionSkewMs.toFixed(1)} ms reached the ${sampleIntervalMs} ms sample interval`,
      evidence,
    );
  }
  if (maximumCollectionDurationMs >= sampleIntervalMs) {
    throw new JsHeapValidationError(
      `JS heap collection duration ${maximumCollectionDurationMs.toFixed(1)} ms reached the ${sampleIntervalMs} ms sample interval`,
      evidence,
    );
  }
  if (maximumSamplingStartDelayMs >= sampleIntervalMs || missedSampleDeadlines > 0) {
    throw new JsHeapValidationError(
      `JS heap sampling cadence was incomplete: maximum start delay ${maximumSamplingStartDelayMs.toFixed(1)} ms; missed deadlines ${missedSampleDeadlines}`,
      evidence,
    );
  }
  return evidence;
}

function createSampler(
  browserSession: CDPSession,
  pageSession: CDPSession,
  pageUrl: string,
  pageTarget: TargetInfo,
  workerAttachments: readonly WorkerAttachment[],
  sampleIntervalMs: number,
): JsHeapSampler {
  let state: "finished" | "prepared" | "running" = "prepared";
  let measurementStartedAtMs = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingCapture: Promise<void> | null = null;
  let captureFailure: unknown = null;
  let detached = false;
  let nextCommandId = 1;
  const samples: JsHeapSample[] = [];

  const detach = async (): Promise<void> => {
    if (detached) return;
    detached = true;
    await detachWorkerSessions(
      browserSession,
      workerAttachments.map((attachment) => attachment.sessionId),
    );
  };

  const workerHeapUsage = async (workerSessionId: string): Promise<unknown> => {
    const commandId = nextCommandId;
    nextCommandId += 1;
    let listener: ((payload: unknown) => void) | null = null;
    const response = new Promise<unknown>((resolve, reject) => {
      listener = (payload: unknown): void => {
        const event = payload as { message?: unknown; sessionId?: unknown };
        if (event.sessionId !== workerSessionId || typeof event.message !== "string") return;
        let message: NestedResponse;
        try {
          message = JSON.parse(event.message) as NestedResponse;
        } catch (error) {
          reject(new Error(`Worker CDP response was not JSON: ${errorMessage(error)}`));
          return;
        }
        if (message.id !== commandId) return;
        if (message.error !== undefined) {
          reject(
            new Error(
              `Worker Runtime.getHeapUsage failed (${message.error.code}): ${message.error.message}`,
            ),
          );
          return;
        }
        if (message.result === undefined) {
          reject(new Error("Worker Runtime.getHeapUsage response omitted its result"));
          return;
        }
        resolve(message.result);
      };
      browserSession.on("Target.receivedMessageFromTarget", listener);
    });
    const guardedResponse = withTimeout(
      response,
      HEAP_COMMAND_TIMEOUT_MS,
      "Worker Runtime.getHeapUsage",
    );
    void guardedResponse.catch(() => undefined);
    try {
      await withTimeout(
        browserSession.send("Target.sendMessageToTarget", {
          message: JSON.stringify({ id: commandId, method: "Runtime.getHeapUsage" }),
          sessionId: workerSessionId,
        }),
        HEAP_COMMAND_TIMEOUT_MS,
        "Target.sendMessageToTarget",
      );
      return await guardedResponse;
    } finally {
      if (listener !== null) browserSession.off("Target.receivedMessageFromTarget", listener);
    }
  };

  const capture = async (
    phase: JsHeapSample["phase"],
    scheduledAfterMeasurementStartMs: number,
  ): Promise<void> => {
    const collectionStartedAtMs = performance.now();
    const realmResults = await Promise.all([
      withTimeout(
        pageSession.send("Runtime.getHeapUsage"),
        HEAP_COMMAND_TIMEOUT_MS,
        "Window Runtime.getHeapUsage",
      ).then((usage) => ({ completedAtMs: performance.now(), usage })),
      ...workerAttachments.map((attachment) =>
        workerHeapUsage(attachment.sessionId).then((usage) => ({
          completedAtMs: performance.now(),
          usage,
        })),
      ),
    ]);
    const pageResult = realmResults[0];
    if (pageResult === undefined) throw new Error("Window heap usage response disappeared");
    const workerResults = realmResults.slice(1);
    const realms = Object.freeze([
      Object.freeze({
        completedAfterCollectionStartMs: pageResult.completedAtMs - collectionStartedAtMs,
        kind: "window" as const,
        url: pageUrl,
        usage: normalize(pageResult.usage),
      }),
      ...workerResults.map((workerResult, index) => {
        const attachment = workerAttachments[index];
        if (attachment === undefined) throw new Error("Worker heap usage response was unpaired");
        return Object.freeze({
          completedAfterCollectionStartMs: workerResult.completedAtMs - collectionStartedAtMs,
          kind: "dedicated-worker" as const,
          url: attachment.target.url,
          usage: normalize(workerResult.usage),
        });
      }),
    ]);
    const capturedAfterMeasurementStartMs = collectionStartedAtMs - measurementStartedAtMs;
    samples.push(
      Object.freeze({
        aggregateUsedSizeBytes: realms.reduce(
          (total, realm) => total + realm.usage.usedSizeBytes,
          0,
        ),
        capturedAfterMeasurementStartMs,
        collectionDurationMs: performance.now() - collectionStartedAtMs,
        phase,
        realmResponseCompletionSkewMs:
          Math.max(...realmResults.map((result) => result.completedAtMs)) -
          Math.min(...realmResults.map((result) => result.completedAtMs)),
        realms,
        scheduledAfterMeasurementStartMs,
        samplingStartDelayMs: capturedAfterMeasurementStartMs - scheduledAfterMeasurementStartMs,
      }),
    );
  };

  const runPeriodicCapture = (scheduledAfterMeasurementStartMs: number): void => {
    pendingCapture = capture("periodic", scheduledAfterMeasurementStartMs)
      .catch((error: unknown) => {
        captureFailure = error;
      })
      .finally(() => {
        pendingCapture = null;
        if (state === "running" && captureFailure === null) {
          const elapsedMs = performance.now() - measurementStartedAtMs;
          const nextDeadlineMs = (Math.floor(elapsedMs / sampleIntervalMs) + 1) * sampleIntervalMs;
          timer = setTimeout(
            () => {
              timer = null;
              runPeriodicCapture(nextDeadlineMs);
            },
            Math.max(0, measurementStartedAtMs + nextDeadlineMs - performance.now()),
          );
        }
      });
  };

  return Object.freeze({
    async discard(): Promise<void> {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      state = "finished";
      await pendingCapture;
      await detach();
    },
    async finish(): Promise<JsHeapEvidence> {
      if (state !== "running") throw new Error(`Cannot finish JS heap sampler in ${state} state`);
      state = "finished";
      if (timer !== null) clearTimeout(timer);
      timer = null;
      try {
        await pendingCapture;
        if (captureFailure !== null) throw captureFailure;
        const periodicSamplingDurationMs = performance.now() - measurementStartedAtMs;
        await capture("measurement-end", periodicSamplingDurationMs);
        let topologyFailure: unknown = null;
        try {
          await requireExpectedWorkerTopology(
            browserSession,
            pageTarget,
            workerAttachments.map((attachment) => attachment.target.url),
            new Map(
              workerAttachments.map((attachment) => [
                attachment.target.url,
                attachment.target.targetId,
              ]),
            ),
          );
        } catch (error) {
          topologyFailure = error;
        }
        let evidence: JsHeapEvidence;
        try {
          evidence = summarizeJsHeapSamples(samples, sampleIntervalMs, periodicSamplingDurationMs);
        } catch (error) {
          if (error instanceof JsHeapValidationError && topologyFailure !== null) {
            throw new JsHeapValidationError(
              `${errorMessage(topologyFailure)}; ${error.message}`,
              error.evidence,
            );
          }
          throw error;
        }
        if (topologyFailure !== null) {
          throw new JsHeapValidationError(errorMessage(topologyFailure), evidence);
        }
        return evidence;
      } finally {
        await detach();
      }
    },
    start(): void {
      if (state !== "prepared") throw new Error(`Cannot start JS heap sampler in ${state} state`);
      state = "running";
      measurementStartedAtMs = performance.now();
      runPeriodicCapture(0);
    },
  });
}

function normalize(usage: unknown): JsHeapUsage {
  if (typeof usage !== "object" || usage === null) {
    throw new Error("Runtime.getHeapUsage did not return an object result");
  }
  const backingStorageSize = Reflect.get(usage, "backingStorageSize") as unknown;
  const embedderHeapUsedSize = Reflect.get(usage, "embedderHeapUsedSize") as unknown;
  const totalSize = Reflect.get(usage, "totalSize") as unknown;
  const usedSize = Reflect.get(usage, "usedSize") as unknown;
  const requiredValues = [totalSize, usedSize];
  if (requiredValues.some((value) => !isNonNegativeFiniteNumber(value))) {
    throw new Error(
      `Runtime.getHeapUsage returned invalid required sizes: totalSize=${String(totalSize)}, usedSize=${String(usedSize)}`,
    );
  }
  return Object.freeze({
    backingStorageSizeBytes: optionalSize(backingStorageSize, "backingStorageSize"),
    embedderHeapUsedSizeBytes: optionalSize(embedderHeapUsedSize, "embedderHeapUsedSize"),
    totalSizeBytes: totalSize as number,
    usedSizeBytes: usedSize as number,
  });
}

function optionalSize(value: unknown, name: string): number | null {
  if (value === undefined) return null;
  if (!isNonNegativeFiniteNumber(value)) {
    throw new Error(`Runtime.getHeapUsage returned invalid optional ${name}: ${String(value)}`);
  }
  return value;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
