import { type ChromeTraceEvent, uniqueGpuProcessId } from "./presentation-trace.js";
import { errorMessage, isRecord } from "./value-utils.js";

export const MEMORY_INFRA_TRACE_CATEGORY = "disabled-by-default-memory-infra";

export interface MemoryDumpRequest {
  readonly dumpGuid: string;
  readonly requestDurationMs: number;
  readonly success: boolean;
}

export interface GpuProcessMemoryDumpEvidence {
  readonly allocatorCount: number;
  readonly allocatorNames: readonly string[];
  readonly exportedDumpId: number | string | null;
  readonly exportedDumpName: string;
  readonly gpuProcessId: number;
  readonly webGpuRelatedAllocatorNames: readonly string[];
}

export type GpuProcessMemoryDumpDiagnostic =
  | Readonly<{
      readonly evidence: null;
      readonly reason: string;
      readonly request: MemoryDumpRequest | null;
      readonly state: "invalid";
    }>
  | Readonly<{
      readonly evidence: GpuProcessMemoryDumpEvidence;
      readonly request: MemoryDumpRequest;
      readonly state: "measured";
    }>;

export interface AttributableGpuMemoryEvidence {
  readonly envelopePeakBytes: number;
  readonly residentBytes: number;
  readonly transientPeakBytes: number;
}

export interface ChromeMemoryInfraDiagnostic {
  readonly provider: "chrome-memory-infra";
  readonly result: GpuProcessMemoryDumpDiagnostic;
}

export type GpuMemoryMetric =
  | Readonly<{
      readonly diagnostic: ChromeMemoryInfraDiagnostic | null;
      readonly state: "measured";
      readonly value: AttributableGpuMemoryEvidence;
    }>
  | Readonly<{
      readonly diagnostic: ChromeMemoryInfraDiagnostic | null;
      readonly reason: string;
      readonly state: "invalid" | "not-applicable" | "unsupported";
    }>;

export function resolveGpuMemoryMetric(
  traceEvents: Readonly<
    | { readonly state: "measured"; readonly value: readonly ChromeTraceEvent[] }
    | { readonly reason: string; readonly state: "invalid" }
  >,
  request: Readonly<
    | { readonly state: "measured"; readonly value: MemoryDumpRequest }
    | { readonly reason: string; readonly state: "invalid" }
  >,
): GpuMemoryMetric {
  const diagnostic = resolveGpuProcessMemoryDumpDiagnostic(traceEvents, request);
  return Object.freeze({
    diagnostic: Object.freeze({ provider: "chrome-memory-infra", result: diagnostic }),
    reason:
      "Chrome exposes no page-attributed resident GPU-memory total; the GPU envelope cannot be evaluated",
    state: "unsupported",
  });
}

function resolveGpuProcessMemoryDumpDiagnostic(
  traceEvents: Readonly<
    | { readonly state: "measured"; readonly value: readonly ChromeTraceEvent[] }
    | { readonly reason: string; readonly state: "invalid" }
  >,
  request: Readonly<
    | { readonly state: "measured"; readonly value: MemoryDumpRequest }
    | { readonly reason: string; readonly state: "invalid" }
  >,
): GpuProcessMemoryDumpDiagnostic {
  if (request.state === "invalid") {
    return Object.freeze({
      evidence: null,
      reason: request.reason,
      request: null,
      state: "invalid",
    });
  }
  if (!request.value.success) {
    return Object.freeze({
      evidence: null,
      reason: `Chrome rejected global memory dump ${request.value.dumpGuid}`,
      request: request.value,
      state: "invalid",
    });
  }
  if (traceEvents.state === "invalid") {
    return Object.freeze({
      evidence: null,
      reason: traceEvents.reason,
      request: request.value,
      state: "invalid",
    });
  }
  try {
    return Object.freeze({
      evidence: extractGpuProcessMemoryDumpEvidence(traceEvents.value),
      request: request.value,
      state: "measured",
    });
  } catch (error) {
    return Object.freeze({
      evidence: null,
      reason: `GPU-process memory-infra diagnostic failed: ${errorMessage(error)}`,
      request: request.value,
      state: "invalid",
    });
  }
}

export function extractGpuProcessMemoryDumpEvidence(
  events: readonly ChromeTraceEvent[],
): GpuProcessMemoryDumpEvidence {
  const gpuProcessId = uniqueGpuProcessId(events);
  const allocatorDumps = events.filter(
    (event) =>
      event.cat === MEMORY_INFRA_TRACE_CATEGORY &&
      event.ph === "v" &&
      event.pid === gpuProcessId &&
      isRecord(event.args?.dumps) &&
      isRecord(event.args.dumps.allocators),
  );
  if (allocatorDumps.length !== 1) {
    throw new Error(
      `Expected one allocator-bearing GPU-process memory dump; received ${allocatorDumps.length}`,
    );
  }
  const event = allocatorDumps[0];
  if (event === undefined) throw new Error("GPU-process allocator dump disappeared");
  const dumps = requireRecord(event.args?.dumps, "memory dump payload");
  const allocators = requireRecord(dumps.allocators, "memory dump allocators");
  const allocatorNames = Object.keys(allocators).sort();
  return Object.freeze({
    allocatorCount: allocatorNames.length,
    allocatorNames: Object.freeze(allocatorNames),
    exportedDumpId: typeof event.id === "number" || typeof event.id === "string" ? event.id : null,
    exportedDumpName: event.name,
    gpuProcessId,
    webGpuRelatedAllocatorNames: Object.freeze(
      allocatorNames.filter((name) => /dawn|webgpu/i.test(name)),
    ),
  });
}

function requireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error(`${label} is missing or malformed`);
  return value;
}
