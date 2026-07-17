import { spawn } from "node:child_process";

const SAMPLE_INTERVAL_MS = 1_000;
const SAMPLE_COMPLETION_TIMEOUT_MS = 2_500;
const COUNTERS = Object.freeze([
  "\\PhysicalDisk(_Total)\\Disk Read Bytes/sec",
  "\\PhysicalDisk(_Total)\\Disk Write Bytes/sec",
  "\\PhysicalDisk(_Total)\\Avg. Disk sec/Read",
  "\\PhysicalDisk(_Total)\\Current Disk Queue Length",
]);

export interface WindowsStorageActivitySample {
  readonly averageReadLatencySeconds: number;
  readonly currentQueueLength: number;
  readonly diskReadBytesPerSecond: number;
  readonly diskWriteBytesPerSecond: number;
  readonly intervalEndedAtEpochMs: number;
  readonly intervalMs: number;
}

export type WindowsStorageActivityMetric =
  | Readonly<{
      readonly reason: string;
      readonly state: "invalid" | "unsupported";
    }>
  | Readonly<{
      readonly measurementWindow: Readonly<{
        readonly completedAtEpochMs: number;
        readonly startedAtEpochMs: number;
      }>;
      readonly samples: readonly WindowsStorageActivitySample[];
      readonly state: "measured";
    }>;

export async function withWindowsStorageActivity<T>(
  operation: () => Promise<T>,
): Promise<Readonly<{ readonly activity: WindowsStorageActivityMetric; readonly value: T }>> {
  if (process.platform !== "win32") {
    return Object.freeze({
      activity: Object.freeze({
        reason: "Physical-disk activity sampling is currently implemented only on Windows",
        state: "unsupported" as const,
      }),
      value: await operation(),
    });
  }

  const sampler = startTypeperf();
  const readiness = await sampler.ready;
  const startedAtEpochMs = Date.now();
  try {
    const value = await operation();
    const completedAtEpochMs = Date.now();
    if (readiness !== null) {
      return Object.freeze({
        activity: Object.freeze({ reason: readiness, state: "invalid" as const }),
        value,
      });
    }
    const completionFailure = await sampler.waitForSampleAtOrAfter(completedAtEpochMs);
    if (completionFailure !== null) {
      return Object.freeze({
        activity: Object.freeze({ reason: completionFailure, state: "invalid" as const }),
        value,
      });
    }
    const samples = sampler.samples.filter(
      (sample) =>
        sample.intervalEndedAtEpochMs >= startedAtEpochMs &&
        sample.intervalEndedAtEpochMs - sample.intervalMs <= completedAtEpochMs,
    );
    return Object.freeze({
      activity:
        samples.length === 0
          ? Object.freeze({
              reason: "typeperf returned no physical-disk sample overlapping the OPFS window",
              state: "invalid" as const,
            })
          : Object.freeze({
              measurementWindow: Object.freeze({ completedAtEpochMs, startedAtEpochMs }),
              samples: Object.freeze([...samples]),
              state: "measured" as const,
            }),
      value,
    });
  } finally {
    await sampler.dispose();
  }
}

export function parseTypeperfSample(
  line: string,
  intervalEndedAtEpochMs: number,
): WindowsStorageActivitySample | null {
  const fields = parseQuotedCsv(line);
  if (fields.length !== 5 || fields[0]?.startsWith("(PDH-CSV") === true) return null;
  const values = fields.slice(1).map((field) => Number(field));
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value) || value < 0)) {
    return null;
  }
  const [
    diskReadBytesPerSecond,
    diskWriteBytesPerSecond,
    averageReadLatencySeconds,
    currentQueueLength,
  ] = values;
  if (
    diskReadBytesPerSecond === undefined ||
    diskWriteBytesPerSecond === undefined ||
    averageReadLatencySeconds === undefined ||
    currentQueueLength === undefined
  ) {
    return null;
  }
  return Object.freeze({
    averageReadLatencySeconds,
    currentQueueLength,
    diskReadBytesPerSecond,
    diskWriteBytesPerSecond,
    intervalEndedAtEpochMs,
    intervalMs: SAMPLE_INTERVAL_MS,
  });
}

interface TypeperfSampler {
  readonly dispose: () => Promise<void>;
  readonly ready: Promise<string | null>;
  readonly samples: WindowsStorageActivitySample[];
  readonly waitForSampleAtOrAfter: (epochMs: number) => Promise<string | null>;
}

function startTypeperf(): TypeperfSampler {
  const child = spawn("typeperf", [...COUNTERS, "-si", "1"], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const samples: WindowsStorageActivitySample[] = [];
  const waiters = new Set<() => void>();
  let outputBuffer = "";
  let errorOutput = "";
  let spawnFailure: string | null = null;
  let headerObserved = false;
  let closed = false;
  const closedPromise = new Promise<void>((resolve) => {
    child.once("close", () => {
      closed = true;
      resolve();
    });
  });
  child.on("error", (error) => {
    spawnFailure = error.message;
    notify(waiters);
  });
  child.stderr.on("data", (chunk: string) => {
    errorOutput += chunk;
  });
  child.stdout.on("data", (chunk: string) => {
    outputBuffer += chunk;
    const lines = outputBuffer.split(/\r?\n/u);
    outputBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.includes("(PDH-CSV")) headerObserved = true;
      const sample = parseTypeperfSample(line.trim(), Date.now());
      if (sample !== null) samples.push(sample);
    }
    notify(waiters);
  });

  return Object.freeze({
    async dispose(): Promise<void> {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      if (!closed) await closedPromise;
    },
    ready: waitUntil(
      () => headerObserved || spawnFailure !== null || child.exitCode !== null,
      waiters,
      SAMPLE_COMPLETION_TIMEOUT_MS,
    ).then((timedOut) => {
      if (headerObserved) return null;
      if (spawnFailure !== null) return `typeperf failed to start: ${spawnFailure}`;
      const detail = errorOutput.trim();
      if (timedOut) return "typeperf did not publish its counter header before the timeout";
      return `typeperf exited before sampling${detail === "" ? "" : `: ${detail}`}`;
    }),
    samples,
    async waitForSampleAtOrAfter(epochMs: number): Promise<string | null> {
      const timedOut = await waitUntil(
        () =>
          samples.some((sample) => sample.intervalEndedAtEpochMs >= epochMs) ||
          spawnFailure !== null ||
          child.exitCode !== null,
        waiters,
        SAMPLE_COMPLETION_TIMEOUT_MS,
      );
      if (samples.some((sample) => sample.intervalEndedAtEpochMs >= epochMs)) return null;
      if (spawnFailure !== null) return `typeperf sampling failed: ${spawnFailure}`;
      const detail = errorOutput.trim();
      if (timedOut) return "typeperf did not publish a sample covering the OPFS window";
      return `typeperf exited before covering the OPFS window${detail === "" ? "" : `: ${detail}`}`;
    },
  });
}

function parseQuotedCsv(line: string): string[] {
  const fields: string[] = [];
  const pattern = /"((?:[^"]|"")*)"(?:,|$)/gu;
  for (const match of line.matchAll(pattern)) fields.push((match[1] ?? "").replaceAll('""', '"'));
  return fields;
}

async function waitUntil(
  predicate: () => boolean,
  waiters: Set<() => void>,
  timeoutMs: number,
): Promise<boolean> {
  if (predicate()) return false;
  return await new Promise<boolean>((resolve) => {
    const finish = (timedOut: boolean): void => {
      clearTimeout(timeout);
      waiters.delete(onUpdate);
      resolve(timedOut);
    };
    const onUpdate = (): void => {
      if (predicate()) finish(false);
    };
    const timeout = setTimeout(() => finish(true), timeoutMs);
    waiters.add(onUpdate);
  });
}

function notify(waiters: Set<() => void>): void {
  for (const waiter of [...waiters]) waiter();
}
