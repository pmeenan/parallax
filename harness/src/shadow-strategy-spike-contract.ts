export const SHADOW_STRATEGY_SPIKE_SCHEMA_VERSION = 1 as const;
export const SHADOW_STRATEGY_SPIKE_ID = "m45-directional-shadow-strategies@1" as const;
export const SHADOW_STRATEGY_RENDERER_ID = "@babylonjs/lite@1.12.0" as const;
export const SHADOW_STRATEGY_ARMS = Object.freeze([
  "no-shadow",
  "pcf-2048",
  "esm-2048",
  "csm-4x1024",
] as const);

export type ShadowStrategyArm = (typeof SHADOW_STRATEGY_ARMS)[number];

export interface ShadowStrategySampleSummary {
  readonly count: number;
  readonly maximum: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
}

export interface ShadowStrategyPageResult {
  readonly arm: ShadowStrategyArm;
  readonly configuration: Readonly<Record<string, boolean | number | string>>;
  readonly configuredShadowMapTexels: number;
  readonly cpuRenderCallMs: ShadowStrategySampleSummary;
  readonly drawCalls: ShadowStrategySampleSummary;
  readonly droppedGpuTaskSamples: number;
  readonly gpuFrameTimeMs: ShadowStrategySampleSummary;
  readonly gpuTimingSupported: boolean;
  readonly measuredFrames: number;
  readonly renderer: typeof SHADOW_STRATEGY_RENDERER_ID;
  readonly scenarioId: typeof SHADOW_STRATEGY_SPIKE_ID;
  readonly sceneTaskGpuMs: ShadowStrategySampleSummary;
  readonly schemaVersion: typeof SHADOW_STRATEGY_SPIKE_SCHEMA_VERSION;
  readonly shadowTaskGpuMs: ShadowStrategySampleSummary | null;
  readonly warmupFrames: number;
}

export interface ShadowStrategyCapture {
  readonly checkpointId: string;
  readonly dataBase64: string;
  readonly height: number;
  readonly width: number;
}

export interface ShadowStrategyRepeatability {
  readonly maximum: number;
  readonly minimum: number;
  readonly relativeRange: number;
  readonly state: "invalid" | "valid";
  readonly values: readonly number[];
}

export function isShadowStrategyArm(value: unknown): value is ShadowStrategyArm {
  return SHADOW_STRATEGY_ARMS.some((arm) => arm === value);
}

export function assertShadowStrategyRendererPackage(name: unknown, version: unknown): void {
  if (typeof name !== "string" || typeof version !== "string") {
    throw new Error("Shadow strategy renderer package identity is unreadable");
  }
  const installed = `${name}@${version}`;
  if (installed !== SHADOW_STRATEGY_RENDERER_ID) {
    throw new Error(
      `Shadow strategy renderer contract is ${SHADOW_STRATEGY_RENDERER_ID} but the installed renderer is ${installed}`,
    );
  }
}

export function finalizeShadowTaskSummary(
  arm: ShadowStrategyArm,
  samples: readonly number[],
): ShadowStrategySampleSummary | null {
  if (arm === "no-shadow") {
    if (samples.length > 0) {
      throw new Error("No-shadow control collected shadow-task GPU samples");
    }
    return null;
  }
  return summarizeShadowStrategySamples(samples);
}

export function summarizeShadowStrategySamples(
  samples: readonly number[],
): ShadowStrategySampleSummary {
  if (samples.length === 0 || samples.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Shadow strategy samples must contain finite non-negative values");
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const quantile = (fraction: number): number => {
    const rank = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
    const value = sorted[rank];
    if (value === undefined) throw new Error("Shadow strategy quantile is unavailable");
    return value;
  };
  return Object.freeze({
    count: sorted.length,
    maximum: sorted.at(-1) ?? 0,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p50: quantile(0.5),
    p95: quantile(0.95),
  });
}

export function evaluateShadowStrategyRepeatability(
  values: readonly number[],
): ShadowStrategyRepeatability {
  if (values.length < 3 || values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("Shadow strategy repeatability requires at least three positive finite values");
  }
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const relativeRange = (maximum - minimum) / minimum;
  return Object.freeze({
    maximum,
    minimum,
    relativeRange,
    state: relativeRange <= 0.1 ? "valid" : "invalid",
    values: Object.freeze([...values]),
  });
}

export function assertShadowStrategyPageResult(
  value: unknown,
  expectedArm: ShadowStrategyArm,
): asserts value is ShadowStrategyPageResult {
  if (typeof value !== "object" || value === null) {
    throw new Error("Shadow strategy page result must be an object");
  }
  if (
    Reflect.get(value, "schemaVersion") !== SHADOW_STRATEGY_SPIKE_SCHEMA_VERSION ||
    Reflect.get(value, "scenarioId") !== SHADOW_STRATEGY_SPIKE_ID ||
    Reflect.get(value, "arm") !== expectedArm ||
    Reflect.get(value, "renderer") !== SHADOW_STRATEGY_RENDERER_ID
  ) {
    throw new Error("Shadow strategy page result identity is invalid");
  }
  for (const field of ["warmupFrames", "measuredFrames", "configuredShadowMapTexels"] as const) {
    const fieldValue = Reflect.get(value, field);
    if (!Number.isSafeInteger(fieldValue) || fieldValue < 0) {
      throw new Error(`Shadow strategy page result ${field} is invalid`);
    }
  }
  if (typeof Reflect.get(value, "gpuTimingSupported") !== "boolean") {
    throw new Error("Shadow strategy GPU timing support state is invalid");
  }
  const configuration = Reflect.get(value, "configuration");
  if (typeof configuration !== "object" || configuration === null) {
    throw new Error("Shadow strategy configuration is invalid");
  }
  for (const setting of Object.values(configuration)) {
    if (
      typeof setting !== "boolean" &&
      typeof setting !== "string" &&
      (typeof setting !== "number" || !Number.isFinite(setting))
    ) {
      throw new Error("Shadow strategy configuration setting is invalid");
    }
  }
  for (const field of [
    "cpuRenderCallMs",
    "drawCalls",
    "gpuFrameTimeMs",
    "sceneTaskGpuMs",
  ] as const) {
    assertSummary(Reflect.get(value, field), field);
  }
  const shadowSummary = Reflect.get(value, "shadowTaskGpuMs");
  if (expectedArm === "no-shadow") {
    if (shadowSummary !== null) throw new Error("No-shadow control reported a shadow task");
  } else {
    assertSummary(shadowSummary, "shadowTaskGpuMs");
  }
}

function assertSummary(value: unknown, label: string): void {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Shadow strategy ${label} summary is invalid`);
  }
  for (const field of ["count", "maximum", "mean", "p50", "p95"] as const) {
    const sample = Reflect.get(value, field);
    if (typeof sample !== "number" || !Number.isFinite(sample) || sample < 0) {
      throw new Error(`Shadow strategy ${label}.${field} is invalid`);
    }
  }
}
