import { sanitizeAssetUpdateDiagnostic } from "./asset-update-v8-sanitization.js";
import type { ChromeTraceEvent } from "./presentation-trace.js";
import { errorMessage } from "./value-utils.js";

export const V8_CODE_CACHE_TRACE_CATEGORY = "v8";
export const V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS = 1_024;

export interface V8ScriptArtifact {
  readonly bytes: number;
  readonly path: string;
  readonly sourceCodeUnits: number;
}

type V8CodeCacheOutcome =
  | Readonly<{
      readonly consumedBytes: number | null;
      readonly outcome: "consumed" | "rejected";
      readonly state: "measured";
    }>
  | Readonly<{ readonly reason: string; readonly state: "invalid" | "not-applicable" }>;

export interface V8CodeCacheCompilationEvidence {
  readonly cache: V8CodeCacheOutcome;
  readonly compilation: "classic" | "module";
  readonly compileDurationUs: number;
  readonly processId: number;
  readonly streamed: boolean;
  readonly threadId: number;
}

export interface V8CodeCacheArtifactEvidence {
  readonly artifact: string;
  readonly bytes: number;
  readonly cache: V8CodeCacheOutcome;
  readonly compileDurationUs: number;
  readonly compilations: readonly V8CodeCacheCompilationEvidence[];
  readonly sourceCodeUnits: number;
}

export interface V8CodeCacheEvidence {
  readonly artifacts: readonly V8CodeCacheArtifactEvidence[];
  readonly cacheableArtifactCount: number;
  readonly consumedArtifactCount: number;
  readonly rejectedArtifactCount: number;
}

interface V8CodeCacheProductionArtifactBase {
  readonly artifact: string;
  readonly bytes: number;
  readonly sourceCodeUnits: number;
}

type V8CodeCacheProductionMeasuredEventEvidence = Readonly<{
  readonly processId: number;
  readonly producedBytes: number;
  readonly state: "measured";
  readonly threadId: number;
}>;

type V8CodeCacheProductionEventEvidence =
  | V8CodeCacheProductionMeasuredEventEvidence
  | Readonly<{
      readonly processId: number;
      readonly reason: string;
      readonly state: "invalid";
      readonly threadId: number;
    }>;

export type V8CodeCacheProductionArtifactEvidence =
  | Readonly<
      V8CodeCacheProductionArtifactBase & {
        readonly productions: readonly V8CodeCacheProductionMeasuredEventEvidence[];
        readonly state: "measured";
      }
    >
  | Readonly<
      V8CodeCacheProductionArtifactBase & {
        readonly productions: readonly V8CodeCacheProductionEventEvidence[];
        readonly reason: string;
        readonly state: "invalid" | "not-applicable";
      }
    >;

export interface V8CodeCacheProductionEvidence {
  readonly artifacts: readonly V8CodeCacheProductionArtifactEvidence[];
  readonly cacheableArtifactCount: number;
  readonly producedArtifactCount: number;
  readonly producedBytes: number;
}

export type V8CodeCacheProductionMetric =
  | Readonly<{ readonly evidence: V8CodeCacheProductionEvidence; readonly state: "measured" }>
  | Readonly<{
      readonly evidence: V8CodeCacheProductionEvidence | null;
      readonly reason: string;
      readonly state: "invalid";
    }>
  | Readonly<{
      readonly evidence: V8CodeCacheProductionEvidence | null;
      readonly reason: string;
      readonly state: "not-applicable";
    }>;

export type V8CodeCacheMetric =
  | Readonly<{ readonly evidence: V8CodeCacheEvidence; readonly state: "measured" }>
  | Readonly<{
      readonly evidence: V8CodeCacheEvidence | null;
      readonly reason: string;
      readonly state: "invalid";
    }>
  | Readonly<{
      readonly evidence: V8CodeCacheEvidence;
      readonly reason: string;
      readonly state: "not-applicable";
    }>;

export function resolveV8CodeCacheEvidence(
  events: readonly ChromeTraceEvent[],
  baseUrl: string,
  artifacts: readonly V8ScriptArtifact[],
  profile: "fresh" | "produce" | "warm",
): V8CodeCacheMetric {
  try {
    const evidence = extractV8CodeCacheEvidence(events, baseUrl, artifacts, profile);
    if (evidence.cacheableArtifactCount === 0) {
      return Object.freeze({
        evidence,
        reason: "no immutable JavaScript artifact meets Chrome 150's cacheability threshold",
        state: "not-applicable",
      });
    }
    const invalidReasons = evidence.artifacts.flatMap((artifact) =>
      artifact.cache.state === "invalid" ? [`${artifact.artifact}: ${artifact.cache.reason}`] : [],
    );
    if (invalidReasons.length > 0) {
      return Object.freeze({
        evidence,
        reason: sanitizeAssetUpdateDiagnostic(invalidReasons.join(" | ")),
        state: "invalid",
      });
    }
    return Object.freeze({ evidence, state: "measured" });
  } catch (error) {
    return Object.freeze({
      evidence: null,
      reason: sanitizeAssetUpdateDiagnostic(
        `V8 code-cache trace probe failed: ${errorMessage(error)}`,
      ),
      state: "invalid",
    });
  }
}

export function resolveV8CodeCacheProductionEvidence(
  events: readonly ChromeTraceEvent[],
  baseUrl: string,
  artifacts: readonly V8ScriptArtifact[],
  profile: "fresh" | "produce" | "warm",
): V8CodeCacheProductionMetric {
  try {
    const evidence = extractV8CodeCacheProductionEvidence(events, baseUrl, artifacts, profile);
    if (evidence.cacheableArtifactCount === 0) {
      return Object.freeze({
        evidence,
        reason: "no immutable JavaScript artifact meets Chrome 150's cacheability threshold",
        state: "not-applicable",
      });
    }
    const invalidReasons = evidence.artifacts.flatMap((artifact) =>
      artifact.state === "invalid" ? [`${artifact.artifact}: ${artifact.reason}`] : [],
    );
    return invalidReasons.length === 0
      ? Object.freeze({ evidence, state: "measured" })
      : Object.freeze({
          evidence,
          reason: sanitizeAssetUpdateDiagnostic(invalidReasons.join(" | ")),
          state: "invalid",
        });
  } catch (error) {
    return Object.freeze({
      evidence: null,
      reason: sanitizeAssetUpdateDiagnostic(
        `V8 code-cache production trace probe failed: ${errorMessage(error)}`,
      ),
      state: "invalid",
    });
  }
}

export function extractV8CodeCacheEvidence(
  events: readonly ChromeTraceEvent[],
  baseUrl: string,
  artifacts: readonly V8ScriptArtifact[],
  profile: "fresh" | "produce" | "warm",
): V8CodeCacheEvidence {
  if (artifacts.length === 0) {
    throw new Error("build contains no immutable JavaScript artifacts");
  }

  const compileEventsByUrl = indexCompileEvents(events);
  const attributionFailures: string[] = [];
  const eventsByArtifact = new Map<V8ScriptArtifact, readonly ChromeTraceEvent[]>();
  for (const artifact of artifacts) {
    const url = new URL(artifact.path, `${baseUrl}/`).href;
    const matches = compileEventsByUrl.get(url) ?? [];
    if (matches.length === 0) {
      attributionFailures.push(`expected a compilation event for ${artifact.path}; received 0`);
      continue;
    }
    for (const event of matches) {
      const data = traceData(event);
      if (data === undefined) {
        attributionFailures.push(
          `compilation event ${event.pid}:${event.tid} has no data for ${artifact.path}`,
        );
      } else if (typeof data.streamed !== "boolean") {
        attributionFailures.push(
          `compilation event ${event.pid}:${event.tid} has no streaming state for ${artifact.path}`,
        );
      }
      if (!nonnegativeNumber(event.dur)) {
        attributionFailures.push(
          `compilation event ${event.pid}:${event.tid} has no finite nonnegative duration for ${artifact.path}`,
        );
      }
    }
    eventsByArtifact.set(artifact, matches);
  }
  if (attributionFailures.length > 0) {
    throw new Error(`artifact attribution failed: ${attributionFailures.join(" | ")}`);
  }

  const evidence = artifacts.map((artifact) => {
    const matches = eventsByArtifact.get(artifact);
    if (matches === undefined)
      throw new Error(`validated attribution vanished for ${artifact.path}`);
    const compilations = matches.map((event) => compilationEvidence(event, artifact, profile));
    return Object.freeze({
      artifact: artifact.path,
      bytes: artifact.bytes,
      cache: aggregateCompilationOutcomes(compilations, artifact, profile),
      compileDurationUs: compilations.reduce(
        (total, compilation) => total + compilation.compileDurationUs,
        0,
      ),
      compilations: Object.freeze(compilations),
      sourceCodeUnits: artifact.sourceCodeUnits,
    });
  });

  const counts = evidence.reduce(
    (result, artifact) => ({
      cacheableArtifactCount:
        result.cacheableArtifactCount +
        (artifact.sourceCodeUnits >= V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS ? 1 : 0),
      consumedArtifactCount:
        result.consumedArtifactCount +
        (artifact.cache.state === "measured" && artifact.cache.outcome === "consumed" ? 1 : 0),
      rejectedArtifactCount:
        result.rejectedArtifactCount +
        (artifact.compilations.some(
          (compilation) =>
            compilation.cache.state === "measured" && compilation.cache.outcome === "rejected",
        )
          ? 1
          : 0),
    }),
    { cacheableArtifactCount: 0, consumedArtifactCount: 0, rejectedArtifactCount: 0 },
  );
  return Object.freeze({ artifacts: Object.freeze(evidence), ...counts });
}

export function extractV8CodeCacheProductionEvidence(
  events: readonly ChromeTraceEvent[],
  baseUrl: string,
  artifacts: readonly V8ScriptArtifact[],
  profile: "fresh" | "produce" | "warm",
): V8CodeCacheProductionEvidence {
  if (artifacts.length === 0) {
    throw new Error("build contains no immutable JavaScript artifacts");
  }
  const productionEventsByUrl = indexProductionEvents(events);
  const evidence = artifacts.map((artifact): V8CodeCacheProductionArtifactEvidence => {
    const base = {
      artifact: artifact.path,
      bytes: artifact.bytes,
      sourceCodeUnits: artifact.sourceCodeUnits,
    };
    const url = new URL(artifact.path, `${baseUrl}/`).href;
    const matches = productionEventsByUrl.get(url) ?? [];
    const productions = matches.map(productionEvidence);
    const measuredProductions = productions.filter(
      (production): production is V8CodeCacheProductionMeasuredEventEvidence =>
        production.state === "measured",
    );
    if (measuredProductions.length !== productions.length) {
      return Object.freeze({
        ...base,
        productions: Object.freeze(productions),
        reason: `${productions.length - measuredProductions.length}/${matches.length} production events lack a positive producedCacheSize`,
        state: "invalid",
      });
    }
    if (artifact.sourceCodeUnits < V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS) {
      return matches.length === 0
        ? Object.freeze({
            ...base,
            productions: Object.freeze([]),
            reason: `artifact source is smaller than Chrome 150's ${V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS}-code-unit external-script cache threshold`,
            state: "not-applicable",
          })
        : Object.freeze({
            ...base,
            productions: Object.freeze(measuredProductions),
            reason: `artifact below Chrome 150's cacheability threshold unexpectedly emitted ${matches.length} production event${matches.length === 1 ? "" : "s"}`,
            state: "invalid",
          });
    }
    if (matches.length === 0) {
      return Object.freeze({
        ...base,
        productions: Object.freeze([]),
        reason:
          profile === "fresh"
            ? "fresh launch emitted no unexpected URL-attributed code-cache production event"
            : profile === "warm"
              ? "warm launch emitted no URL-attributed code-cache re-production event"
              : "no URL-attributed code-cache production event was observed",
        state: profile === "produce" ? "invalid" : "not-applicable",
      });
    }
    if (profile === "fresh") {
      return Object.freeze({
        ...base,
        productions: Object.freeze(measuredProductions),
        reason: `fresh launch unexpectedly emitted ${measuredProductions.length} URL-attributed code-cache production event${measuredProductions.length === 1 ? "" : "s"}`,
        state: "invalid",
      });
    }
    return Object.freeze({
      ...base,
      productions: Object.freeze(measuredProductions),
      state: "measured",
    });
  });
  const counts = evidence.reduce(
    (result, artifact) => ({
      cacheableArtifactCount:
        result.cacheableArtifactCount +
        (artifact.sourceCodeUnits >= V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS ? 1 : 0),
      producedArtifactCount: result.producedArtifactCount + (artifact.state === "measured" ? 1 : 0),
      producedBytes:
        result.producedBytes +
        artifact.productions.reduce(
          (total, production) =>
            total + (production.state === "measured" ? production.producedBytes : 0),
          0,
        ),
    }),
    { cacheableArtifactCount: 0, producedArtifactCount: 0, producedBytes: 0 },
  );
  return Object.freeze({ artifacts: Object.freeze(evidence), ...counts });
}

export function decodedSourceCodeUnits(source: string): number {
  return source.charCodeAt(0) === 0xfeff ? source.length - 1 : source.length;
}

function indexCompileEvents(
  events: readonly ChromeTraceEvent[],
): ReadonlyMap<string, readonly ChromeTraceEvent[]> {
  const indexed = new Map<string, ChromeTraceEvent[]>();
  for (const event of events) {
    if ((event.name !== "v8.compile" && event.name !== "v8.compileModule") || event.ph !== "X") {
      continue;
    }
    const url = traceData(event)?.url;
    if (typeof url !== "string") continue;
    const matches = indexed.get(url) ?? [];
    matches.push(event);
    indexed.set(url, matches);
  }
  return indexed;
}

function indexProductionEvents(
  events: readonly ChromeTraceEvent[],
): ReadonlyMap<string, readonly ChromeTraceEvent[]> {
  const indexed = new Map<string, ChromeTraceEvent[]>();
  for (const event of events) {
    if (
      (event.name !== "v8.produceCache" && event.name !== "v8.produceModuleCache") ||
      event.ph !== "X"
    ) {
      continue;
    }
    const url = traceData(event)?.url;
    if (typeof url !== "string") continue;
    const matches = indexed.get(url) ?? [];
    matches.push(event);
    indexed.set(url, matches);
  }
  return indexed;
}

function productionEvidence(event: ChromeTraceEvent): V8CodeCacheProductionEventEvidence {
  const producedBytes = traceData(event)?.producedCacheSize;
  if (!positiveNumber(producedBytes)) {
    return Object.freeze({
      processId: event.pid,
      reason: "production event lacks a positive producedCacheSize",
      state: "invalid",
      threadId: event.tid,
    });
  }
  return Object.freeze({
    processId: event.pid,
    producedBytes,
    state: "measured",
    threadId: event.tid,
  });
}

function compilationEvidence(
  event: ChromeTraceEvent,
  artifact: V8ScriptArtifact,
  profile: "fresh" | "produce" | "warm",
): V8CodeCacheCompilationEvidence {
  const data = traceData(event);
  if (data === undefined || typeof data.streamed !== "boolean" || !nonnegativeNumber(event.dur)) {
    throw new Error(`validated compilation data vanished for ${artifact.path}`);
  }
  return Object.freeze({
    cache: compilationOutcome(data, artifact, profile),
    compilation: event.name === "v8.compileModule" ? "module" : "classic",
    compileDurationUs: event.dur,
    processId: event.pid,
    streamed: data.streamed,
    threadId: event.tid,
  });
}

function compilationOutcome(
  data: Readonly<Record<string, unknown>>,
  artifact: V8ScriptArtifact,
  profile: "fresh" | "produce" | "warm",
): V8CodeCacheOutcome {
  if (artifact.sourceCodeUnits < V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS) {
    return Object.freeze({
      reason: `artifact source is smaller than Chrome 150's ${V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS}-code-unit external-script cache threshold`,
      state: "not-applicable",
    });
  }
  if (profile !== "warm") {
    return data.cacheRejected !== undefined || data.consumedCacheSize !== undefined
      ? Object.freeze({
          reason: `${profile} profile unexpectedly reported a V8 cache-consumption result`,
          state: "invalid",
        })
      : Object.freeze({
          reason:
            profile === "fresh"
              ? "fresh profile has no prior persistent V8 code cache to consume"
              : "produce profile has only a prior hot timestamp and no code cache to consume",
          state: "not-applicable",
        });
  }

  if (data.cacheRejected === true) {
    return Object.freeze({
      consumedBytes: nonnegativeNumber(data.consumedCacheSize) ? data.consumedCacheSize : null,
      outcome: "rejected",
      state: "measured",
    });
  }
  if (data.cacheRejected === false && positiveNumber(data.consumedCacheSize)) {
    return Object.freeze({
      consumedBytes: data.consumedCacheSize,
      outcome: "consumed",
      state: "measured",
    });
  }
  return Object.freeze({
    reason:
      "compilation event omits a usable consumedCacheSize/cacheRejected result; V8 cache hit or rejection is unobservable",
    state: "invalid",
  });
}

function aggregateCompilationOutcomes(
  compilations: readonly V8CodeCacheCompilationEvidence[],
  artifact: V8ScriptArtifact,
  profile: "fresh" | "produce" | "warm",
): V8CodeCacheOutcome {
  if (artifact.sourceCodeUnits < V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS) {
    return compilations[0]?.cache ?? missingCompilationOutcome(artifact);
  }
  const invalidReasons = compilations.flatMap((compilation) =>
    compilation.cache.state === "invalid" ? [compilation.cache.reason] : [],
  );
  if (invalidReasons.length > 0) {
    const distinctReasons = [...new Set(invalidReasons)];
    return Object.freeze({
      reason: `${invalidReasons.length}/${compilations.length} compilation events lack trustworthy cache evidence: ${distinctReasons.join("; ")}`,
      state: "invalid",
    });
  }
  if (profile !== "warm") {
    return compilations[0]?.cache ?? missingCompilationOutcome(artifact);
  }
  const rejected = compilations.filter(
    (compilation) =>
      compilation.cache.state === "measured" && compilation.cache.outcome === "rejected",
  );
  if (rejected.length > 0) {
    return Object.freeze({
      consumedBytes: sumKnownBytes(rejected),
      outcome: "rejected",
      state: "measured",
    });
  }
  return Object.freeze({
    consumedBytes: sumKnownBytes(compilations),
    outcome: "consumed",
    state: "measured",
  });
}

function sumKnownBytes(compilations: readonly V8CodeCacheCompilationEvidence[]): number | null {
  let total = 0;
  for (const compilation of compilations) {
    if (compilation.cache.state !== "measured" || compilation.cache.consumedBytes === null) {
      return null;
    }
    total += compilation.cache.consumedBytes;
  }
  return total;
}

function missingCompilationOutcome(artifact: V8ScriptArtifact): V8CodeCacheOutcome {
  return Object.freeze({
    reason: `compilation evidence disappeared for ${artifact.path}`,
    state: "invalid",
  });
}

function traceData(event: ChromeTraceEvent): Readonly<Record<string, unknown>> | undefined {
  const data = event.args?.data;
  return typeof data === "object" && data !== null
    ? (data as Readonly<Record<string, unknown>>)
    : undefined;
}

function positiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function nonnegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
