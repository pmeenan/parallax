import {
  STREAMING_RESIDENT_CELL_LIMIT,
  type StreamingCellLoadTelemetry,
  type WorldStreamingTelemetrySnapshot,
} from "@parallax/engine";

export type StreamingDashboardMetricState =
  | "error"
  | "healthy"
  | "neutral"
  | "unavailable"
  | "warning";

export interface StreamingDashboardMetric {
  readonly detail: string | null;
  readonly id: string;
  readonly label: string;
  readonly state: StreamingDashboardMetricState;
  readonly value: string;
}

export interface StreamingDashboardSection {
  readonly id: string;
  readonly metrics: readonly StreamingDashboardMetric[];
  readonly title: string;
}

export interface StreamingDashboardModel {
  readonly announcement: string;
  readonly observerTargets: readonly string[];
  readonly residentCellIds: readonly string[];
  readonly schemaVersion: number;
  readonly sections: readonly StreamingDashboardSection[];
  readonly state: WorldStreamingTelemetrySnapshot["state"];
  readonly title: string;
}

export const STREAMING_DASHBOARD_TITLE = "World streaming";

export function createStreamingDashboardModel(
  snapshot: WorldStreamingTelemetrySnapshot,
): StreamingDashboardModel {
  const loadSamples = snapshot.cellLoadSamples;
  const loadP95 = p95(loadSamples, ({ totalMs }) => totalMs);
  const loadMaximum = maximum(loadSamples, ({ totalMs }) => totalMs);
  const observerBacklog = Math.max(
    0,
    snapshot.observerUpdateCount - snapshot.settledObserverUpdateCount,
  );
  const queueWithinContract =
    Number.isSafeInteger(snapshot.decodeQueueDepthHighWater) &&
    snapshot.decodeQueueDepthHighWater >= 0 &&
    snapshot.decodeQueueDepthHighWater <= STREAMING_RESIDENT_CELL_LIMIT;
  const stateTone: StreamingDashboardMetricState =
    snapshot.state === "failed"
      ? "error"
      : snapshot.state === "streaming"
        ? "healthy"
        : snapshot.state === "disposed"
          ? "unavailable"
          : "neutral";
  const failure = snapshot.failureMessage;
  const handleSetOpen =
    snapshot.opfsPackageCount > 0 &&
    snapshot.opfsAccessHandleCount === snapshot.opfsPackageCount &&
    snapshot.state !== "failed" &&
    snapshot.state !== "disposed";

  return Object.freeze({
    announcement:
      failure === null
        ? `Streaming ${snapshot.state}, generation ${snapshot.workerGeneration}, ${snapshot.residentCellCount} of ${STREAMING_RESIDENT_CELL_LIMIT} resident cells.`
        : `Streaming failed in generation ${snapshot.workerGeneration}: ${failure}`,
    observerTargets: Object.freeze(
      snapshot.currentObservers.map(
        ([x, y, z], index) =>
          `Observer ${index + 1}: ${formatCoordinate(x)}, ${formatCoordinate(y)}, ${formatCoordinate(z)}`,
      ),
    ),
    residentCellIds: Object.freeze([...snapshot.residentCellIds]),
    schemaVersion: snapshot.schemaVersion,
    sections: Object.freeze([
      section("cohort", "Cohort and residency", [
        metric("state", "State", snapshot.state, stateTone, failure),
        metric(
          "generation",
          "Worker cohort",
          `generation ${snapshot.workerGeneration} · ${snapshot.renderRecoveryCount} ${
            snapshot.renderRecoveryCount === 1 ? "recovery" : "recoveries"
          }`,
          snapshot.renderRecoveryCount === 0 ? "neutral" : "warning",
        ),
        metric(
          "residency",
          "Resident cells",
          `${snapshot.residentCellCount} / ${STREAMING_RESIDENT_CELL_LIMIT}`,
          snapshot.state === "failed"
            ? "error"
            : snapshot.state === "streaming"
              ? snapshot.residentCellCount === STREAMING_RESIDENT_CELL_LIMIT
                ? "healthy"
                : "warning"
              : "neutral",
          `${snapshot.residentCellIds.length} public resident identities; ${STREAMING_RESIDENT_CELL_LIMIT} is the M1 target capacity.`,
        ),
        metric(
          "observer-targets",
          "Observer targets",
          snapshot.currentObservers.length.toLocaleString(),
          snapshot.currentObservers.length > 0 ? "neutral" : "unavailable",
          snapshot.currentObservers.length > 0
            ? null
            : "No observer target is available in the current public snapshot.",
        ),
        metric(
          "observer-settlement",
          "Observer settlement",
          `${snapshot.settledObserverUpdateCount.toLocaleString()} / ${snapshot.observerUpdateCount.toLocaleString()}`,
          observerBacklog === 0 ? "healthy" : "warning",
          `${observerBacklog.toLocaleString()} update${observerBacklog === 1 ? "" : "s"} awaiting settlement.`,
        ),
      ]),
      section("storage", "Storage and memory", [
        metric(
          "opfs-handles",
          "OPFS handles",
          handleSetValue(snapshot),
          snapshot.opfsPackageCount === 0
            ? "unavailable"
            : handleSetOpen
              ? "healthy"
              : snapshot.state === "failed"
                ? "error"
                : snapshot.state === "disposed"
                  ? "unavailable"
                  : "neutral",
          handleSetDetail(snapshot, handleSetOpen),
        ),
        metric(
          "provisioned-bytes",
          "Provisioned package bytes",
          formatBytes(snapshot.opfsProvisionedBytes),
          snapshot.opfsPackageCount > 0 ? "neutral" : "unavailable",
        ),
        metric(
          "encoded-memory",
          "Encoded residency / reservation high-water",
          `${formatBytes(snapshot.residentEncodedBytes)} · high ${formatBytes(
            snapshot.residentEncodedBytesHighWater,
          )}`,
          "neutral",
          "Current bytes are resident encoded packages; high-water is the peak resident bytes plus accepted in-flight encoded batch reservations.",
        ),
        metric(
          "gpu-memory",
          "Streamed GPU buffers",
          `${formatBytes(snapshot.residentGpuBytes)} · high ${formatBytes(
            snapshot.residentGpuBytesHighWater,
          )}`,
          "neutral",
          "Logical created-buffer bytes reported by the renderer, not physical resident GPU memory.",
        ),
        metric(
          "encoded-read",
          "Encoded bytes read",
          formatBytes(snapshot.encodedBytesRead),
          "neutral",
        ),
      ]),
      section("loads", "Cell-load latency", [
        timingMetric(
          "load-total",
          "Retained load p95",
          loadP95,
          loadSamples.length,
          `${loadSamples.length.toLocaleString()} retained / ${snapshot.cellLoadSampleCount.toLocaleString()} cumulative samples${
            loadMaximum === null ? "" : ` · max ${formatMilliseconds(loadMaximum)}`
          } · live retained history, not a budget verdict.`,
        ),
        stageMetric(
          "stage-opfs",
          "OPFS access p95",
          loadSamples,
          ({ opfsAccessRoundTripMs }) => opfsAccessRoundTripMs,
          ({ opfsReadMs }) => opfsReadMs,
          ({ opfsWaitMs }) => opfsWaitMs,
        ),
        stageMetric(
          "stage-decode",
          "Decode round trip p95",
          loadSamples,
          ({ decodeRoundTripMs }) => decodeRoundTripMs,
          ({ decodeMs }) => decodeMs,
          ({ decodeWaitMs }) => decodeWaitMs,
        ),
        stageMetric(
          "stage-transaction",
          "Render transaction p95",
          loadSamples,
          ({ renderTransactionRoundTripMs }) => renderTransactionRoundTripMs,
          ({ uploadMs }) => uploadMs,
          ({ renderTransactionWaitMs }) => renderTransactionWaitMs,
        ),
        timingMetric(
          "stage-remainder",
          "Worker bookkeeping p95",
          p95(loadSamples, ({ streamingWorkerRemainderMs }) => streamingWorkerRemainderMs),
          loadSamples.length,
        ),
      ]),
      section("pressure", "Queues and pressure", [
        metric(
          "decode-workers",
          "Decode workers",
          snapshot.decodeWorkerCount.toLocaleString(),
          snapshot.decodeWorkerCount > 0 ? "neutral" : "unavailable",
          `Hardware concurrency ${snapshot.hardwareConcurrency.toLocaleString()}.`,
        ),
        metric(
          "decode-queue",
          "Decode queue high-water",
          snapshot.decodeQueueDepthHighWater.toLocaleString(),
          snapshot.state !== "streaming" ? "neutral" : queueWithinContract ? "healthy" : "warning",
          `${snapshot.decodeWorkerCount.toLocaleString()} workers · ${STREAMING_RESIDENT_CELL_LIMIT} resident-cell capacity.`,
        ),
        metric(
          "encoded-budget-rejections",
          "Encoded-residency rejections",
          snapshot.cpuBudgetRejectionCount.toLocaleString(),
          snapshot.cpuBudgetRejectionCount > 0 ? "error" : "healthy",
          "A rejection is terminal; it is not a scheduling deferral.",
        ),
        unavailableMetric(
          "worker-stalls",
          "Worker stall count",
          `Public streaming telemetry exposes encoded-residency rejections (${snapshot.cpuBudgetRejectionCount.toLocaleString()}), not a worker-stall counter.`,
        ),
        metric(
          "proactive-evictions",
          "Proactive evictions",
          snapshot.proactiveEvictionCount.toLocaleString(),
          "neutral",
        ),
        unavailableMetric(
          "emergency-evictions",
          "Emergency evictions",
          "The M1 streamer has a proactive-only eviction policy and does not expose an emergency-eviction counter.",
        ),
      ]),
    ]),
    state: snapshot.state,
    title: STREAMING_DASHBOARD_TITLE,
  });
}

function section(
  id: string,
  title: string,
  metrics: readonly StreamingDashboardMetric[],
): StreamingDashboardSection {
  return Object.freeze({ id, metrics: Object.freeze(metrics), title });
}

function metric(
  id: string,
  label: string,
  value: string,
  state: StreamingDashboardMetricState,
  detail: string | null = null,
): StreamingDashboardMetric {
  return Object.freeze({ detail, id, label, state, value });
}

function unavailableMetric(id: string, label: string, detail: string): StreamingDashboardMetric {
  return metric(id, label, "Unavailable", "unavailable", detail);
}

function handleSetDetail(
  snapshot: WorldStreamingTelemetrySnapshot,
  handleSetOpen: boolean,
): string {
  if (snapshot.state === "failed" || snapshot.state === "disposed") {
    const priorCount =
      snapshot.opfsAccessHandleCount > 0
        ? ` The last worker snapshot reported ${snapshot.opfsAccessHandleCount.toLocaleString()} open before termination.`
        : "";
    return snapshot.opfsAccessHandleOpenDurationMs > 0
      ? `Handles are closed.${priorCount} The last startup-open pass took ${formatMilliseconds(
          snapshot.opfsAccessHandleOpenDurationMs,
        )}.`
      : `Handles are closed.${priorCount} No completed startup-open duration is available.`;
  }
  if (snapshot.opfsPackageCount === 0) {
    return "Package and open-handle identity is published during provisioning.";
  }
  if (handleSetOpen) {
    return `Fixed handle set opened in ${formatMilliseconds(
      snapshot.opfsAccessHandleOpenDurationMs,
    )}.`;
  }
  return "Fixed handle set is still opening.";
}

function handleSetValue(snapshot: WorldStreamingTelemetrySnapshot): string {
  if (snapshot.state === "failed" || snapshot.state === "disposed") {
    return snapshot.opfsPackageCount > 0
      ? `Closed / ${snapshot.opfsPackageCount.toLocaleString()} packages`
      : "Closed / no package set";
  }
  return snapshot.opfsPackageCount > 0
    ? `${snapshot.opfsAccessHandleCount.toLocaleString()} / ${snapshot.opfsPackageCount.toLocaleString()} packages`
    : "Unavailable";
}

function timingMetric(
  id: string,
  label: string,
  value: number | null,
  sampleCount: number,
  detail: string | null = null,
  state: StreamingDashboardMetricState = "neutral",
): StreamingDashboardMetric {
  return value === null
    ? unavailableMetric(
        id,
        label,
        sampleCount === 0 ? "No cell-load samples are available yet." : "No finite samples exist.",
      )
    : metric(id, label, formatMilliseconds(value), state, detail);
}

function stageMetric(
  id: string,
  label: string,
  samples: readonly StreamingCellLoadTelemetry[],
  total: (sample: StreamingCellLoadTelemetry) => number,
  work: (sample: StreamingCellLoadTelemetry) => number,
  wait: (sample: StreamingCellLoadTelemetry) => number,
): StreamingDashboardMetric {
  const totalP95 = p95(samples, total);
  if (totalP95 === null) return timingMetric(id, label, null, samples.length);
  const workP95 = p95(samples, work);
  const waitP95 = p95(samples, wait);
  return metric(
    id,
    label,
    formatMilliseconds(totalP95),
    "neutral",
    `Nested work p95 ${formatOptionalMilliseconds(workP95)} · derived wait p95 ${formatOptionalMilliseconds(waitP95)}.`,
  );
}

function p95<T>(values: readonly T[], select: (value: T) => number): number | null {
  const finite = values
    .map(select)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (finite.length === 0) return null;
  return finite[Math.max(0, Math.ceil(finite.length * 0.95) - 1)] ?? null;
}

function maximum<T>(values: readonly T[], select: (value: T) => number): number | null {
  const finite = values.map(select).filter((value) => Number.isFinite(value));
  return finite.length === 0 ? null : Math.max(...finite);
}

function formatMilliseconds(value: number): string {
  return `${value.toFixed(3)} ms`;
}

function formatOptionalMilliseconds(value: number | null): string {
  return value === null ? "unavailable" : formatMilliseconds(value);
}

function formatCoordinate(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "unavailable";
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "Unavailable";
  if (value < 1_024) return `${value.toLocaleString()} B`;
  if (value < 1_024 ** 2) return `${(value / 1_024).toFixed(1)} KiB`;
  if (value < 1_024 ** 3) return `${(value / 1_024 ** 2).toFixed(1)} MiB`;
  return `${(value / 1_024 ** 3).toFixed(2)} GiB`;
}
