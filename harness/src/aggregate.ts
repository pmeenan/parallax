export interface Distribution {
  readonly max: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99_9: number;
}

export type VarianceMetric =
  | Readonly<{ relativeRange: number; state: "measured" }>
  | Readonly<{ reason: string; relativeRange: number | null; state: "invalid" }>;

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

// Returns null when the minimum is 0 while the maximum is positive: the ratio is
// unbounded, and JSON.stringify would silently turn Infinity into null anyway — store
// the null explicitly so the JSON artifact and the reason text agree.
export function relativeRange(values: readonly number[]): number | null {
  if (values.length === 0) throw new Error("Cannot calculate variance for no values");
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return minimum === 0 ? (maximum === 0 ? 0 : null) : (maximum - minimum) / minimum;
}

// Variance is only meaningful across the full repeat set (budgets require >= 3
// repeats): a partial set — including a single value, whose range is trivially 0 —
// must read as invalid, never as a measured low-variance result.
export function evaluateP95Variance(
  values: readonly number[],
  expectedSamples: number,
): VarianceMetric {
  return evaluateRelativeVariance(values, expectedSamples, "p95");
}

export function evaluateRelativeVariance(
  values: readonly number[],
  expectedSamples: number,
  metricLabel: string,
): VarianceMetric {
  if (!Number.isInteger(expectedSamples) || expectedSamples <= 0) {
    throw new Error(
      `Expected repeat count must be a positive integer; received ${expectedSamples}`,
    );
  }
  if (values.length !== expectedSamples) {
    return Object.freeze({
      reason: `${metricLabel} variance requires all ${expectedSamples} expected repeats; received ${values.length}`,
      relativeRange: null,
      state: "invalid",
    });
  }
  const range = relativeRange(values);
  if (range === null) {
    return Object.freeze({
      reason: `${metricLabel} relative range is unbounded: the minimum repeat ${metricLabel} is 0 while the maximum is positive`,
      relativeRange: null,
      state: "invalid",
    });
  }
  return range > 0.1
    ? Object.freeze({
        reason: `${metricLabel} relative range ${range} exceeds the 0.1 variance limit`,
        relativeRange: range,
        state: "invalid",
      })
    : Object.freeze({ relativeRange: range, state: "measured" });
}
