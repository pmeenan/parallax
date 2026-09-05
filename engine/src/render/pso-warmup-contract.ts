import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const PSO_WARMUP_TRACE_SCHEMA_VERSION = 1;
export const PSO_WARMUP_TELEMETRY_SCHEMA_VERSION = 1;
export const PSO_WARMUP_TELEMETRY_CONTRACT = "pso-warmup-telemetry@1";
export const PSO_WARMUP_RESOURCE_ID = "game-specific-pso-warmup-trace";
export const PSO_WARMUP_RENDERER = "@babylonjs/lite@1.12.0";
export const PSO_WARMUP_STANDARD_OPAQUE_ENTRY_ID = "babylon-lite.standard-opaque-msaa4";

const WEBGPU_ALL_BITS = 0xffff_ffff;
const WEBGPU_COLOR_WRITE_ALL = 0xf;
const STENCIL_FACE_DEFAULT = Object.freeze({
  compare: "always" as const,
  depthFailOp: "keep" as const,
  failOp: "keep" as const,
  passOp: "keep" as const,
});
const STANDARD_OPAQUE_STATE = deepFreeze({
  colorTarget: {
    blend: null,
    format: "bgra8unorm",
    writeMask: WEBGPU_COLOR_WRITE_ALL,
  },
  depthStencil: {
    depthBias: 0,
    depthBiasClamp: 0,
    depthBiasSlopeScale: 0,
    depthCompare: "greater-equal",
    depthWriteEnabled: true,
    format: "depth24plus-stencil8",
    stencilBack: STENCIL_FACE_DEFAULT,
    stencilFront: STENCIL_FACE_DEFAULT,
    stencilReadMask: WEBGPU_ALL_BITS,
    stencilWriteMask: WEBGPU_ALL_BITS,
  },
  layout: {
    bindGroups: [
      {
        entries: [
          {
            binding: 0,
            resource: {
              hasDynamicOffset: false,
              kind: "buffer",
              minBindingSize: 0,
              type: "uniform",
            },
            visibility: 3,
          },
          {
            binding: 1,
            resource: {
              hasDynamicOffset: false,
              kind: "buffer",
              minBindingSize: 0,
              type: "uniform",
            },
            visibility: 2,
          },
        ],
        index: 0,
      },
      {
        entries: [
          {
            binding: 0,
            resource: {
              hasDynamicOffset: false,
              kind: "buffer",
              minBindingSize: 0,
              type: "uniform",
            },
            visibility: 3,
          },
          {
            binding: 1,
            resource: {
              hasDynamicOffset: false,
              kind: "buffer",
              minBindingSize: 0,
              type: "uniform",
            },
            visibility: 2,
          },
        ],
        index: 1,
      },
    ],
    mode: "explicit",
  },
  multisample: {
    alphaToCoverageEnabled: false,
    count: 4,
    mask: WEBGPU_ALL_BITS,
  },
  primitive: {
    cullMode: "back",
    frontFace: "ccw",
    stripIndexFormat: null,
    topology: "triangle-list",
    unclippedDepth: false,
  },
  shader: {
    family: "standard",
    fragmentEntryPoint: "main",
    materialFeatureKey: 0,
    meshFeatureKey: 0,
    variantKey: "",
    vertexEntryPoint: "main",
  },
  vertexBuffers: [
    {
      arrayStride: 12,
      attributes: [{ format: "float32x3", offset: 0, shaderLocation: 0 }],
      stepMode: "vertex",
    },
    {
      arrayStride: 12,
      attributes: [{ format: "float32x3", offset: 0, shaderLocation: 1 }],
      stepMode: "vertex",
    },
  ],
} as const);

export const CSM_RECEIVER_STATE = deepFreeze({
  ...STANDARD_OPAQUE_STATE,
  layout: {
    ...STANDARD_OPAQUE_STATE.layout,
    bindGroups: [
      ...STANDARD_OPAQUE_STATE.layout.bindGroups,
      {
        entries: [
          {
            binding: 0,
            resource: {
              kind: "texture",
              multisampled: false,
              sampleType: "depth",
              viewDimension: "2d-array",
            },
            visibility: 2,
          },
          { binding: 1, resource: { kind: "sampler", type: "comparison" }, visibility: 2 },
          {
            binding: 2,
            resource: {
              hasDynamicOffset: false,
              kind: "buffer",
              minBindingSize: 0,
              type: "uniform",
            },
            visibility: 2,
          },
        ],
        index: 2,
      },
    ],
  },
  shader: { ...STANDARD_OPAQUE_STATE.shader, meshFeatureKey: 256, variantKey: "1e" },
} as const);
export const CSM_DEPTH_STATE = deepFreeze({
  ...STANDARD_OPAQUE_STATE,
  colorTarget: null,
  depthStencil: {
    ...STANDARD_OPAQUE_STATE.depthStencil,
    depthCompare: "less-equal",
    format: "depth32float",
  },
  multisample: { ...STANDARD_OPAQUE_STATE.multisample, count: 1 },
  shader: { ...STANDARD_OPAQUE_STATE.shader, materialFeatureKey: 262144 },
} as const);

export type PsoWarmupEffectivePipelineState =
  | typeof STANDARD_OPAQUE_STATE
  | typeof CSM_RECEIVER_STATE
  | typeof CSM_DEPTH_STATE;

export const PSO_WARMUP_STANDARD_OPAQUE_STATE_DIGEST = digestCanonical(STANDARD_OPAQUE_STATE);
export const PSO_WARMUP_PIPELINES = Object.freeze([
  Object.freeze({
    id: PSO_WARMUP_STANDARD_OPAQUE_ENTRY_ID,
    state: STANDARD_OPAQUE_STATE,
    stateDigest: PSO_WARMUP_STANDARD_OPAQUE_STATE_DIGEST,
  }),
  Object.freeze({
    id: "babylon-lite.standard-csm-receiver-msaa4",
    state: CSM_RECEIVER_STATE,
    stateDigest: digestCanonical(CSM_RECEIVER_STATE),
  }),
  Object.freeze({
    id: "babylon-lite.standard-csm-depth",
    state: CSM_DEPTH_STATE,
    stateDigest: digestCanonical(CSM_DEPTH_STATE),
  }),
]);
export const PSO_WARMUP_BUILD_COMPATIBILITY_DIGEST = digestCanonical({
  entries: PSO_WARMUP_PIPELINES.map(({ id, stateDigest }) => ({ id, stateDigest })),
  renderer: PSO_WARMUP_RENDERER,
  schemaVersion: PSO_WARMUP_TRACE_SCHEMA_VERSION,
});

export interface PsoWarmupTraceEntry {
  readonly id: string;
  readonly kind: "render";
  readonly priority: number;
  readonly state: PsoWarmupEffectivePipelineState;
  readonly stateDigest: string;
}

export interface PsoWarmupTrace {
  readonly buildCompatibilityDigest: string;
  readonly entries: readonly PsoWarmupTraceEntry[];
  readonly renderer: typeof PSO_WARMUP_RENDERER;
  readonly schemaVersion: typeof PSO_WARMUP_TRACE_SCHEMA_VERSION;
}

export type PsoWarmupTraceSource = "installed-release" | "privileged-embedded";

export type PsoWarmupTraceBundle = PsoWarmupTraceBundleReady | PsoWarmupTraceBundleFailed;

export interface PsoWarmupTraceBundleReady {
  readonly bytes: number;
  readonly failure: null;
  readonly releaseDigest: string | null;
  readonly sha256: string;
  readonly source: PsoWarmupTraceSource;
  readonly trace: PsoWarmupTrace;
}

export interface PsoWarmupTraceBundleFailed {
  readonly bytes: number | null;
  readonly failure: PsoWarmupFailure;
  readonly releaseDigest: string | null;
  readonly sha256: string | null;
  readonly source: PsoWarmupTraceSource;
  readonly trace: null;
}

export interface PsoWarmupEntryTelemetry {
  readonly compileAttemptCount: number;
  readonly compileDurationMs: number;
  readonly compiled: boolean;
  readonly id: string;
  readonly requestCount: number;
  readonly stateDigest: string;
}

export type PsoWarmupFailure =
  | Readonly<{
      readonly class: "parse";
      readonly detail: string;
      readonly entryId: null;
      readonly phase: "trace-parse";
      readonly requestIndex: null;
      readonly traceIndex: null;
    }>
  | Readonly<{
      readonly class: "incompatibility";
      readonly detail: string;
      readonly entryId: string | null;
      readonly phase: "trace-load" | "trace-validation" | "request-validation" | "completion";
      readonly requestIndex: number | null;
      readonly traceIndex: number | null;
    }>
  | Readonly<{
      readonly class: "unknown-entry";
      readonly detail: string;
      readonly entryId: string;
      readonly phase: "request-validation";
      readonly requestIndex: number;
      readonly traceIndex: null;
    }>
  | Readonly<{
      readonly class: "compile";
      readonly detail: string;
      readonly entryId: string;
      readonly phase: "compile";
      readonly requestIndex: number;
      readonly traceIndex: number;
    }>;

export interface PsoWarmupTelemetrySnapshot {
  readonly buildCompatibilityDigest: string | null;
  readonly cacheHitCount: number;
  readonly cacheMissCount: number;
  readonly compiledCount: number;
  readonly contract: typeof PSO_WARMUP_TELEMETRY_CONTRACT;
  readonly deferredCount: number;
  readonly entries: readonly PsoWarmupEntryTelemetry[];
  readonly failure: PsoWarmupFailure | null;
  readonly failureCount: number;
  readonly maximumCompileDurationMs: number;
  readonly queueHighWater: number;
  readonly releaseDigest: string | null;
  readonly requestedCount: number;
  readonly schemaVersion: typeof PSO_WARMUP_TELEMETRY_SCHEMA_VERSION;
  readonly source: PsoWarmupTraceSource | null;
  readonly state: "idle" | "warming" | "ready" | "failed";
  readonly totalDurationMs: number;
  readonly traceEntryCount: number;
  readonly traceSha256: string | null;
}

const SHA256 = /^[a-f0-9]{64}$/;
const ENTRY_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const TRACE_KEYS = Object.freeze([
  "buildCompatibilityDigest",
  "entries",
  "renderer",
  "schemaVersion",
]);
const ENTRY_KEYS = Object.freeze(["id", "kind", "priority", "state", "stateDigest"]);
const FAILURE_KEYS = Object.freeze([
  "class",
  "detail",
  "entryId",
  "phase",
  "requestIndex",
  "traceIndex",
]);
const BUNDLE_KEYS = Object.freeze([
  "bytes",
  "failure",
  "releaseDigest",
  "sha256",
  "source",
  "trace",
]);

export function createPsoWarmupTrace(): PsoWarmupTrace {
  return Object.freeze({
    buildCompatibilityDigest: PSO_WARMUP_BUILD_COMPATIBILITY_DIGEST,
    entries: Object.freeze(
      PSO_WARMUP_PIPELINES.map((entry, priority) =>
        Object.freeze({
          id: entry.id,
          kind: "render" as const,
          priority,
          state: entry.state,
          stateDigest: entry.stateDigest,
        }),
      ),
    ),
    renderer: PSO_WARMUP_RENDERER,
    schemaVersion: PSO_WARMUP_TRACE_SCHEMA_VERSION,
  });
}

export function serializePsoWarmupTrace(
  trace: PsoWarmupTrace = createPsoWarmupTrace(),
): Uint8Array {
  const validated = parsePsoWarmupTrace(trace);
  return new TextEncoder().encode(`${JSON.stringify(validated, null, 2)}\n`);
}

export function parsePsoWarmupTraceBytes(bytes: Uint8Array): PsoWarmupTrace {
  if (bytes.byteLength === 0) {
    throw psoWarmupFailureError(parseFailure("PSO warmup trace is empty"));
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error: unknown) {
    throw psoWarmupFailureError(parseFailure("PSO warmup trace is not valid UTF-8"), error);
  }
  if (!text.endsWith("\n")) {
    throw psoWarmupFailureError(parseFailure("PSO warmup trace must end with a newline"));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    throw psoWarmupFailureError(parseFailure("PSO warmup trace is not valid JSON"), error);
  }
  return parsePsoWarmupTrace(parsed);
}

export function parsePsoWarmupTrace(input: unknown): PsoWarmupTrace {
  let record: Record<string, unknown>;
  try {
    record = exact(input, TRACE_KEYS, "PSO warmup trace");
  } catch (error: unknown) {
    throw psoWarmupFailureError(
      incompatibilityFailure("trace-validation", "PSO warmup trace shape is incompatible"),
      error,
    );
  }
  if (
    record.schemaVersion !== PSO_WARMUP_TRACE_SCHEMA_VERSION ||
    record.renderer !== PSO_WARMUP_RENDERER ||
    record.buildCompatibilityDigest !== PSO_WARMUP_BUILD_COMPATIBILITY_DIGEST ||
    !Array.isArray(record.entries) ||
    record.entries.length === 0
  ) {
    throw psoWarmupFailureError(
      incompatibilityFailure(
        "trace-validation",
        "PSO warmup trace schema, renderer, or build state is incompatible",
      ),
    );
  }
  const entries = record.entries.map((entry, traceIndex) => parseEntry(entry, traceIndex));
  let previous: PsoWarmupTraceEntry | null = null;
  for (const entry of entries) {
    if (
      previous !== null &&
      (previous.priority > entry.priority ||
        (previous.priority === entry.priority && previous.id >= entry.id))
    ) {
      throw psoWarmupFailureError(
        incompatibilityFailure(
          "trace-validation",
          "PSO warmup entries are not ordered by priority then id",
          entry.id,
          null,
          entries.indexOf(entry),
        ),
      );
    }
    previous = entry;
  }
  if (
    entries.length !== PSO_WARMUP_PIPELINES.length ||
    entries.some(
      (entry, index) =>
        entry.id !== PSO_WARMUP_PIPELINES[index]?.id ||
        entry.stateDigest !== PSO_WARMUP_PIPELINES[index]?.stateDigest,
    )
  ) {
    throw psoWarmupFailureError(
      incompatibilityFailure(
        "trace-validation",
        "PSO warmup trace does not exactly cover the current render-state registry",
      ),
    );
  }
  return Object.freeze({
    buildCompatibilityDigest: PSO_WARMUP_BUILD_COMPATIBILITY_DIGEST,
    entries: Object.freeze(entries),
    renderer: PSO_WARMUP_RENDERER,
    schemaVersion: PSO_WARMUP_TRACE_SCHEMA_VERSION,
  });
}

export function parsePsoWarmupTraceBundle(input: unknown): PsoWarmupTraceBundleReady {
  let record: Record<string, unknown>;
  try {
    record = exact(input, BUNDLE_KEYS, "PSO warmup trace bundle");
  } catch (error: unknown) {
    throw psoWarmupFailureError(
      incompatibilityFailure("trace-validation", "PSO warmup trace bundle shape is incompatible"),
      error,
    );
  }
  if (record.failure !== null) {
    const failure = parsePsoWarmupFailure(record.failure);
    const sourceValid =
      record.source === "installed-release" || record.source === "privileged-embedded";
    const releaseValid =
      (record.source === "installed-release" &&
        typeof record.releaseDigest === "string" &&
        SHA256.test(record.releaseDigest)) ||
      (record.source === "privileged-embedded" && record.releaseDigest === null);
    const identityValid =
      (record.bytes === null && record.sha256 === null) ||
      (Number.isSafeInteger(record.bytes) &&
        (record.bytes as number) >= 0 &&
        typeof record.sha256 === "string" &&
        SHA256.test(record.sha256));
    if (!sourceValid || !releaseValid || !identityValid || record.trace !== null) {
      throw psoWarmupFailureError(
        incompatibilityFailure(
          "trace-validation",
          "PSO warmup failed bundle identity is incompatible",
        ),
      );
    }
    throw psoWarmupFailureError(failure);
  }
  const trace = parsePsoWarmupTrace(record.trace);
  const canonicalBytes = serializePsoWarmupTrace(trace);
  const canonicalSha256 = bytesToHex(sha256(canonicalBytes));
  if (
    !Number.isSafeInteger(record.bytes) ||
    record.bytes !== canonicalBytes.byteLength ||
    typeof record.sha256 !== "string" ||
    record.sha256 !== canonicalSha256 ||
    (record.source !== "installed-release" && record.source !== "privileged-embedded") ||
    (record.source === "installed-release"
      ? typeof record.releaseDigest !== "string" || !SHA256.test(record.releaseDigest)
      : record.releaseDigest !== null)
  ) {
    throw psoWarmupFailureError(
      incompatibilityFailure(
        "trace-validation",
        "PSO warmup trace bundle identity or provenance is incompatible",
      ),
    );
  }
  return Object.freeze({
    bytes: canonicalBytes.byteLength,
    failure: null,
    releaseDigest: record.releaseDigest as string | null,
    sha256: canonicalSha256,
    source: record.source,
    trace,
  });
}

export function idlePsoWarmupTelemetrySnapshot(): PsoWarmupTelemetrySnapshot {
  return Object.freeze({
    buildCompatibilityDigest: null,
    cacheHitCount: 0,
    cacheMissCount: 0,
    compiledCount: 0,
    contract: PSO_WARMUP_TELEMETRY_CONTRACT,
    deferredCount: 0,
    entries: Object.freeze([]),
    failure: null,
    failureCount: 0,
    maximumCompileDurationMs: 0,
    queueHighWater: 0,
    releaseDigest: null,
    requestedCount: 0,
    schemaVersion: PSO_WARMUP_TELEMETRY_SCHEMA_VERSION,
    source: null,
    state: "idle",
    totalDurationMs: 0,
    traceEntryCount: 0,
    traceSha256: null,
  });
}

function parseEntry(input: unknown, traceIndex: number): PsoWarmupTraceEntry {
  let record: Record<string, unknown>;
  try {
    record = exact(input, ENTRY_KEYS, "PSO warmup trace entry");
  } catch (error: unknown) {
    throw psoWarmupFailureError(
      incompatibilityFailure(
        "trace-validation",
        "PSO warmup trace entry shape is incompatible",
        null,
        null,
        traceIndex,
      ),
      error,
    );
  }
  const expected = PSO_WARMUP_PIPELINES.find((entry) => entry.id === record.id);
  if (
    typeof record.id !== "string" ||
    !ENTRY_ID.test(record.id) ||
    record.kind !== "render" ||
    !Number.isSafeInteger(record.priority) ||
    (record.priority as number) < 0 ||
    typeof record.stateDigest !== "string" ||
    !SHA256.test(record.stateDigest) ||
    expected === undefined ||
    !canonicalEqual(record.state, expected.state)
  ) {
    throw psoWarmupFailureError(
      incompatibilityFailure(
        "trace-validation",
        "PSO warmup trace entry is incompatible",
        typeof record.id === "string" && ENTRY_ID.test(record.id) ? record.id : null,
        null,
        traceIndex,
      ),
    );
  }
  return Object.freeze({
    id: record.id,
    kind: "render",
    priority: record.priority as number,
    state: expected.state,
    stateDigest: record.stateDigest,
  });
}

export class PsoWarmupFailureError extends Error {
  readonly failure: PsoWarmupFailure;

  constructor(failure: PsoWarmupFailure, options?: ErrorOptions) {
    super(`PSO warmup ${failure.class} failure: ${failure.detail}`, options);
    this.name = "PsoWarmupFailureError";
    this.failure = failure;
  }
}

export function isPsoWarmupFailureError(error: unknown): error is PsoWarmupFailureError {
  return error instanceof PsoWarmupFailureError;
}

export function sanitizePsoWarmupFailureDetail(input: unknown): string {
  const raw = input instanceof Error && input.message !== "" ? input.message : String(input);
  const withoutControlCharacters = Array.from(raw, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159) ? " " : character;
  }).join("");
  const normalized = withoutControlCharacters
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\b[A-Za-z]:[\\/][^\s]+/g, "[path]")
    .replace(/(?:^|\s)\/(?:[^/\s]+\/)*[^/\s]*/g, " [path]")
    .replace(/\s+/g, " ")
    .trim();
  const bounded = normalized.slice(0, 240).trim();
  return bounded === "" ? "No additional detail" : bounded;
}

export function parseFailure(detail: unknown): PsoWarmupFailure {
  return Object.freeze({
    class: "parse",
    detail: sanitizePsoWarmupFailureDetail(detail),
    entryId: null,
    phase: "trace-parse",
    requestIndex: null,
    traceIndex: null,
  });
}

export function incompatibilityFailure(
  phase: Extract<PsoWarmupFailure, { class: "incompatibility" }>["phase"],
  detail: unknown,
  entryId: string | null = null,
  requestIndex: number | null = null,
  traceIndex: number | null = null,
): PsoWarmupFailure {
  return Object.freeze({
    class: "incompatibility",
    detail: sanitizePsoWarmupFailureDetail(detail),
    entryId,
    phase,
    requestIndex,
    traceIndex,
  });
}

export function failedPsoWarmupTraceBundle(
  source: PsoWarmupTraceSource,
  releaseDigest: string | null,
  failure: PsoWarmupFailure,
  identity: Readonly<{ bytes: number | null; sha256: string | null }> = Object.freeze({
    bytes: null,
    sha256: null,
  }),
): PsoWarmupTraceBundleFailed {
  return Object.freeze({
    bytes: identity.bytes,
    failure,
    releaseDigest,
    sha256: identity.sha256,
    source,
    trace: null,
  });
}

export function psoWarmupFailureError(
  failure: PsoWarmupFailure,
  cause?: unknown,
): PsoWarmupFailureError {
  return new PsoWarmupFailureError(failure, cause === undefined ? undefined : { cause });
}

function parsePsoWarmupFailure(input: unknown): PsoWarmupFailure {
  let record: Record<string, unknown>;
  try {
    record = exact(input, FAILURE_KEYS, "PSO warmup failure");
  } catch {
    return incompatibilityFailure(
      "trace-validation",
      "PSO warmup failure bundle classification is incompatible",
    );
  }
  if (
    typeof record.class !== "string" ||
    typeof record.detail !== "string" ||
    record.detail.length === 0 ||
    record.detail.length > 240 ||
    sanitizePsoWarmupFailureDetail(record.detail) !== record.detail
  ) {
    return incompatibilityFailure(
      "trace-validation",
      "PSO warmup failure bundle classification is incompatible",
    );
  }
  if (
    record.class === "parse" &&
    record.phase === "trace-parse" &&
    record.entryId === null &&
    record.requestIndex === null &&
    record.traceIndex === null
  ) {
    return Object.freeze({ ...record }) as PsoWarmupFailure;
  }
  const validEntryId = typeof record.entryId === "string" && ENTRY_ID.test(record.entryId);
  const validRequestIndex =
    Number.isSafeInteger(record.requestIndex) && (record.requestIndex as number) > 0;
  const validTraceIndex =
    Number.isSafeInteger(record.traceIndex) && (record.traceIndex as number) >= 0;
  if (
    record.class === "unknown-entry" &&
    record.phase === "request-validation" &&
    validEntryId &&
    validRequestIndex &&
    record.traceIndex === null
  ) {
    return Object.freeze({ ...record }) as PsoWarmupFailure;
  }
  if (
    record.class === "compile" &&
    record.phase === "compile" &&
    validEntryId &&
    validRequestIndex &&
    validTraceIndex
  ) {
    return Object.freeze({ ...record }) as PsoWarmupFailure;
  }
  if (
    record.class === "incompatibility" &&
    ["trace-load", "trace-validation", "request-validation", "completion"].includes(
      record.phase as string,
    ) &&
    (record.entryId === null || validEntryId) &&
    (record.requestIndex === null || validRequestIndex) &&
    (record.traceIndex === null || validTraceIndex)
  ) {
    return Object.freeze({ ...record }) as PsoWarmupFailure;
  }
  return incompatibilityFailure(
    "trace-validation",
    "PSO warmup failure bundle classification is incompatible",
  );
}

function digestCanonical(input: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(input))));
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function deepFreeze<T>(input: T): Readonly<T> {
  if (typeof input === "object" && input !== null) {
    Object.freeze(input);
    for (const value of Object.values(input)) deepFreeze(value);
  }
  return input;
}

function exact(input: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`${label} must be an object`);
  }
  const record = input as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has unsupported or missing keys`);
  }
  return record;
}
