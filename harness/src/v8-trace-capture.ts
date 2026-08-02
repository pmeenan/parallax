import type { BrowserContext } from "playwright-core";
import type { AssetUpdateV8TraceEvidence } from "./asset-update-v8-evidence.js";
import { sanitizeAssetUpdateDiagnostic } from "./asset-update-v8-sanitization.js";
import type { ChromeTraceEvent } from "./presentation-trace.js";

const TRACE_COMPLETION_TIMEOUT_MS = 15_000;
const MAX_TRACE_EVENTS = 250_000;
const MAX_SERIALIZED_EVENT_BYTES = 64 * 1024 * 1024;

export interface V8TraceCaptureResult {
  readonly events: readonly ChromeTraceEvent[];
  readonly trace: AssetUpdateV8TraceEvidence;
}

export interface V8TraceCapture {
  readonly discard: () => Promise<void>;
  readonly finish: () => Promise<V8TraceCaptureResult>;
}

export async function finishV8TraceAfterOperation(
  capture: V8TraceCapture,
  operation: () => Promise<void>,
): Promise<V8TraceCaptureResult> {
  let finished = false;
  try {
    await operation();
    const result = await capture.finish();
    finished = true;
    return result;
  } finally {
    if (!finished) await capture.discard();
  }
}

export async function beginV8TraceCapture(context: BrowserContext): Promise<V8TraceCapture> {
  const browser = context.browser();
  if (browser === null) throw new Error("Playwright did not expose the launched browser");
  const session = await browser.newBrowserCDPSession();
  const events: ChromeTraceEvent[] = [];
  let active = true;
  let eventCount = 0;
  let overflowReason: string | null = null;
  let serializedEventBytes = 0;
  session.on("Tracing.dataCollected", ({ value }) => {
    const chunk = value as unknown as readonly ChromeTraceEvent[];
    eventCount += chunk.length;
    if (overflowReason !== null) return;
    const chunkBytes = Buffer.byteLength(JSON.stringify(chunk), "utf8");
    if (
      eventCount > MAX_TRACE_EVENTS ||
      serializedEventBytes + chunkBytes > MAX_SERIALIZED_EVENT_BYTES
    ) {
      overflowReason = `V8 trace exceeded the bounded ${MAX_TRACE_EVENTS}-event/${MAX_SERIALIZED_EVENT_BYTES}-byte capture`;
      return;
    }
    serializedEventBytes += chunkBytes;
    events.push(...chunk);
  });
  const completion = new Promise<unknown>((resolve, reject) => {
    session.once("Tracing.tracingComplete", resolve);
    session.once("close", () => reject(new Error("V8 trace CDP session closed before completion")));
  });
  void completion.catch(() => undefined);
  try {
    await session.send("Tracing.start", {
      traceConfig: {
        includedCategories: ["v8"],
        recordMode: "recordAsMuchAsPossible",
      },
      transferMode: "ReportEvents",
    });
  } catch (error: unknown) {
    await session.detach().catch(() => undefined);
    throw error;
  }

  const stop = async (): Promise<unknown> => {
    if (!active) throw new Error("V8 trace capture was already stopped");
    active = false;
    try {
      await session.send("Tracing.end");
      return await withTimeout(completion, TRACE_COMPLETION_TIMEOUT_MS, "V8 trace completion");
    } finally {
      await session.detach().catch(() => undefined);
    }
  };
  return Object.freeze({
    async discard(): Promise<void> {
      await stop().catch(() => undefined);
    },
    async finish(): Promise<V8TraceCaptureResult> {
      const completed = await stop();
      const dataLossOccurred = resolveV8TraceCompletionDataLoss(completed);
      const reason =
        overflowReason ??
        (dataLossOccurred === null
          ? "Chrome omitted a boolean V8 trace data-loss result"
          : dataLossOccurred
            ? "Chrome reported V8 trace data loss"
            : null);
      return Object.freeze({
        events: Object.freeze([...events]),
        trace:
          reason === null
            ? Object.freeze({
                dataLossOccurred: false,
                eventCount,
                state: "measured" as const,
              })
            : Object.freeze({
                dataLossOccurred,
                eventCount,
                reason,
                state: "invalid" as const,
              }),
      });
    },
  });
}

export function resolveV8TraceCompletionDataLoss(completed: unknown): boolean | null {
  if (typeof completed !== "object" || completed === null || Array.isArray(completed)) return null;
  const value = (completed as Readonly<Record<string, unknown>>).dataLossOccurred;
  return typeof value === "boolean" ? value : null;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} exceeded ${timeoutMs} ms`)),
          timeoutMs,
        );
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}

export function invalidV8Trace(reason: string): V8TraceCaptureResult {
  return Object.freeze({
    events: Object.freeze([]),
    trace: Object.freeze({
      dataLossOccurred: null,
      eventCount: 0,
      reason: sanitizeAssetUpdateDiagnostic(reason),
      state: "invalid" as const,
    }),
  });
}
