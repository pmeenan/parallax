import type {
  BrowserDisplayIdentity,
  CdpGpuDevice,
  WebGpuAdapterIdentity,
  WindowsHostIdentity,
} from "./environment.js";
import { type JsHeapEvidence, type JsHeapMetric, JsHeapValidationError } from "./js-heap.js";

export interface FlythroughTraceDrainEvidence {
  readonly categories: readonly string[];
  readonly completionAfterEndCommandMs: number | null;
  readonly completionDeadlineExceeded: boolean | null;
  readonly completionObservationTimeoutMs: number;
  readonly completionTimeoutMs: number;
  readonly dataChunkCount: number;
  readonly dataLossOccurred: boolean | null;
  readonly endWaitMs: number | null;
  readonly endCommandMs: number | null;
  readonly eventCount: number;
  readonly recordingDurationBeforeEndMs: number | null;
  readonly serializedEventBytes: number;
}

export interface MeasuredFlythroughEnvironment {
  readonly adapter: WebGpuAdapterIdentity;
  readonly browserCommandLine: string;
  readonly browserDisplayAfter: BrowserDisplayIdentity | null;
  readonly browserDisplayBefore: BrowserDisplayIdentity;
  readonly browserProduct: string;
  readonly browserRevision: string;
  readonly browserUserAgent: string;
  readonly gpuDevices: readonly CdpGpuDevice[];
  readonly hostAfter: WindowsHostIdentity | null;
  readonly hostBefore: WindowsHostIdentity;
  readonly jsVersion: string;
  readonly sandboxVerified: true;
}

export interface FlythroughAttempt<T> {
  readonly browserErrors: readonly string[];
  readonly environment: MeasuredFlythroughEnvironment | null;
  readonly failureMessage: string | null;
  readonly jsHeap: JsHeapMetric | null;
  readonly profileLineage: Readonly<{
    readonly history: readonly ["fresh"];
    readonly id: string;
  }>;
  readonly repeat: number;
  readonly result: T | null;
  readonly state: "invalid" | "measured";
  readonly traceDrain: FlythroughTraceDrainEvidence | null;
}

export function assembleFlythroughAttempt<T>(input: {
  readonly browserErrors: readonly string[];
  readonly environment: MeasuredFlythroughEnvironment | null;
  readonly error: unknown | null;
  readonly jsHeap: JsHeapMetric | null;
  readonly repeat: number;
  readonly result: T | null;
  readonly traceDrain: FlythroughTraceDrainEvidence | null;
}): FlythroughAttempt<T> {
  let jsHeap = input.jsHeap;
  if (input.error instanceof JsHeapValidationError) {
    jsHeap = Object.freeze({
      evidence: input.error.evidence,
      reason: input.error.message,
      state: "invalid",
    });
  }
  const failureMessage =
    input.error === null
      ? input.browserErrors.length === 0
        ? null
        : `Browser errors: ${input.browserErrors.join(" | ")}`
      : input.error instanceof Error
        ? input.error.message
        : String(input.error);
  const measured =
    failureMessage === null &&
    input.result !== null &&
    jsHeap?.state === "measured" &&
    input.environment !== null &&
    input.traceDrain !== null;
  return Object.freeze({
    browserErrors: Object.freeze([...input.browserErrors]),
    environment: input.environment,
    failureMessage: measured
      ? null
      : (failureMessage ?? "Flythrough attempt evidence is incomplete"),
    jsHeap,
    profileLineage: Object.freeze({
      history: Object.freeze(["fresh"] as const),
      id: `independent-fresh-${input.repeat}`,
    }),
    repeat: input.repeat,
    result: measured ? input.result : null,
    state: measured ? "measured" : "invalid",
    traceDrain: input.traceDrain,
  });
}

export function measuredFlythroughEnvironmentFailures(input: {
  readonly attempts: readonly FlythroughAttempt<unknown>[];
  readonly chromePinVersion: string;
  readonly expectedNodeVersion: string;
  readonly nodeVersion: string;
  readonly reference: Readonly<{
    readonly adapter: WebGpuAdapterIdentity | null;
    readonly browserDisplay: BrowserDisplayIdentity | null;
    readonly browserProduct: string;
    readonly browserRevision: string;
    readonly browserUserAgent: string;
    readonly gpuDevices: readonly CdpGpuDevice[];
    readonly host: WindowsHostIdentity | null;
    readonly jsVersion: string;
  }>;
}): readonly string[] {
  const failures: string[] = [];
  if (input.nodeVersion !== `v${input.expectedNodeVersion}`) {
    failures.push(
      `Node collector version ${input.nodeVersion} does not match ${input.expectedNodeVersion}`,
    );
  }
  for (const attempt of input.attempts) {
    const actual = attempt.environment;
    if (actual === null) {
      failures.push(`Repeat ${attempt.repeat} measured browser environment is unavailable`);
      continue;
    }
    const actualVersion = actual.browserProduct.replace(/^Chrome\//, "");
    if (actualVersion !== input.chromePinVersion) {
      failures.push(
        `Repeat ${attempt.repeat} browser ${actualVersion} does not match CfT ${input.chromePinVersion}`,
      );
    }
    if (
      !actual.sandboxVerified ||
      actual.browserCommandLine.trim() === "" ||
      !actual.browserCommandLine.includes("--start-fullscreen") ||
      /--(?:headless|disable-gpu|use-angle=swiftshader)(?:\s|=|$)/i.test(
        actual.browserCommandLine,
      ) ||
      input.reference.adapter === null ||
      input.reference.browserDisplay === null ||
      input.reference.host === null ||
      !sameStableWebGpuAdapterIdentity(actual.adapter, input.reference.adapter) ||
      !same(actual.gpuDevices, input.reference.gpuDevices) ||
      !same(actual.browserDisplayBefore, input.reference.browserDisplay) ||
      !same(actual.browserDisplayAfter, input.reference.browserDisplay) ||
      !same(actual.hostBefore, input.reference.host) ||
      !same(actual.hostAfter, input.reference.host) ||
      actual.browserProduct !== input.reference.browserProduct ||
      actual.browserRevision !== input.reference.browserRevision ||
      actual.browserUserAgent !== input.reference.browserUserAgent ||
      actual.jsVersion !== input.reference.jsVersion
    ) {
      failures.push(`Repeat ${attempt.repeat} measured browser environment drifted`);
    }
  }
  return Object.freeze(failures);
}

export function measuredJsHeap(evidence: JsHeapEvidence): JsHeapMetric {
  return Object.freeze({ state: "measured", value: evidence });
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameStableWebGpuAdapterIdentity(
  measured: WebGpuAdapterIdentity,
  reference: WebGpuAdapterIdentity,
): boolean {
  return (
    measured.architecture === reference.architecture &&
    measured.isFallbackAdapter === reference.isFallbackAdapter &&
    measured.vendor === reference.vendor
  );
}
