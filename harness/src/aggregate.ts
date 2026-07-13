export interface Distribution {
  readonly max: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99_9: number;
}

export type VarianceMetric =
  | Readonly<{ relativeRange: number; state: "measured" }>
  | Readonly<{ reason: string; relativeRange: number; state: "invalid" }>;

export function distribution(values: readonly number[]): Distribution {
  if (values.length === 0) throw new Error("Cannot aggregate an empty sample set");
  const sorted = [...values].sort((left, right) => left - right);
  return Object.freeze({
    max: sorted.at(-1) ?? 0,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99_9: percentile(sorted, 0.999),
  });
}

function percentile(sorted: readonly number[], fraction: number): number {
  const rank = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.max(0, rank)] ?? 0;
}

export function relativeRange(values: readonly number[]): number {
  if (values.length === 0) throw new Error("Cannot calculate variance for no values");
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return minimum === 0
    ? maximum === 0
      ? 0
      : Number.POSITIVE_INFINITY
    : (maximum - minimum) / minimum;
}

export function evaluateP95Variance(values: readonly number[]): VarianceMetric {
  const range = relativeRange(values);
  return range > 0.1
    ? Object.freeze({
        reason: `p95 relative range ${range} exceeds the 0.1 variance limit`,
        relativeRange: range,
        state: "invalid",
      })
    : Object.freeze({ relativeRange: range, state: "measured" });
}
