import type { GreyboxCell, GreyboxMaterial, WorldVec3 } from "../world/world-contract";

export const STREAMING_TELEMETRY_SCHEMA_VERSION = 1;
export const STREAMING_CELL_LOAD_BUDGET_MS = 250;
export const STREAMING_DECODE_WORKER_MAXIMUM = 4;
export const STREAMING_DECODE_WORKER_RESERVED_THREADS = 2;
export const STREAMING_RESIDENT_CELL_LIMIT = 9;
export const STREAMING_RESIDENT_ENCODED_BUDGET_BYTES = 16 * 1024 * 1024;

export interface StreamingCellIndexEntry {
  readonly bytes: number;
  readonly cellId: string;
  readonly coordinate: readonly [number, number];
  readonly path: string;
  readonly sha256: string;
}

export interface StreamingDistrictIndex {
  readonly bounds: Readonly<{ maximum: WorldVec3; minimum: WorldVec3 }>;
  readonly cellSizeMeters: number;
  readonly cells: readonly StreamingCellIndexEntry[];
  readonly districtId: string;
  readonly materials: readonly GreyboxMaterial[];
  readonly schemaVersion: 1;
}

export interface StreamingCellLoadTelemetry {
  readonly cellId: string;
  readonly decodeMs: number;
  readonly encodedBytes: number;
  readonly gpuBytes: number;
  readonly opfsReadMs: number;
  readonly sequence: number;
  readonly totalMs: number;
  readonly uploadMs: number;
}

export interface WorldStreamingTelemetrySnapshot {
  readonly cellLoadSamples: readonly StreamingCellLoadTelemetry[];
  readonly cellLoadSampleCount: number;
  readonly cpuBudgetRejectionCount: number;
  readonly decodeQueueDepthHighWater: number;
  readonly decodeWorkerCount: number;
  readonly encodedBytesRead: number;
  readonly failureMessage: string | null;
  readonly hardwareConcurrency: number;
  readonly opfsProvisionedBytes: number;
  readonly proactiveEvictionCount: number;
  readonly residentCellCount: number;
  readonly residentEncodedBytes: number;
  readonly residentEncodedBytesHighWater: number;
  readonly residentGpuBytes: number;
  readonly residentGpuBytesHighWater: number;
  readonly schemaVersion: typeof STREAMING_TELEMETRY_SCHEMA_VERSION;
  readonly state: "idle" | "starting" | "provisioning" | "streaming" | "failed" | "disposed";
}

export interface StreamingStartRequest {
  readonly buildManifestUrl: string;
  readonly districtId: string;
  readonly initialObservers: readonly WorldVec3[];
  readonly kind: "start";
  readonly renderPort: MessagePort;
}

export interface StreamingObserversRequest {
  readonly kind: "observers";
  readonly observers: readonly WorldVec3[];
}

export interface StreamingDisposeRequest {
  readonly kind: "dispose";
}

export type StreamingWorkerRequest =
  | StreamingDisposeRequest
  | StreamingObserversRequest
  | StreamingStartRequest;

export interface StreamingTelemetryResponse {
  readonly kind: "telemetry";
  readonly snapshot: WorldStreamingTelemetrySnapshot;
}

export interface StreamingFailureResponse {
  readonly kind: "failure";
  readonly message: string;
  readonly snapshot: WorldStreamingTelemetrySnapshot;
}

export interface StreamingDisposedResponse {
  readonly kind: "disposed";
  readonly snapshot: WorldStreamingTelemetrySnapshot;
}

export type StreamingWorkerResponse =
  | StreamingDisposedResponse
  | StreamingFailureResponse
  | StreamingTelemetryResponse;

export interface DecodeCellRequest {
  readonly bytes: ArrayBuffer;
  readonly cellId: string;
  readonly districtId: string;
  readonly kind: "decode-cell";
  readonly schemaVersion: 1;
  readonly taskId: number;
}

export interface DecodeCellResponse {
  readonly cell: GreyboxCell;
  readonly decodeMs: number;
  readonly encodedBytes: number;
  readonly kind: "decoded-cell";
  readonly taskId: number;
}

export interface DecodeFailureResponse {
  readonly kind: "decode-failure";
  readonly message: string;
  readonly taskId: number;
}

export type DecodeWorkerRequest = DecodeCellRequest;
export type DecodeWorkerResponse = DecodeCellResponse | DecodeFailureResponse;

export interface RenderStreamCellRequest {
  readonly cell: GreyboxCell;
  readonly cellId: string;
  readonly encodedBytes: number;
  readonly kind: "stream-cell";
  readonly requestId: number;
}

export interface RenderEvictCellRequest {
  readonly cellId: string;
  readonly kind: "evict-cell";
  readonly requestId: number;
}

export interface RenderCommitCellRequest {
  readonly cellId: string;
  readonly kind: "commit-cell";
  readonly requestId: number;
  readonly uploadRequestId: number;
}

export type RenderStreamingRequest =
  | RenderCommitCellRequest
  | RenderEvictCellRequest
  | RenderStreamCellRequest;

export interface RenderStreamCellResponse {
  readonly cellId: string;
  readonly gpuBytes: number;
  readonly kind: "stream-cell-complete";
  readonly requestId: number;
  readonly uploadMs: number;
}

export interface RenderEvictCellResponse {
  readonly cellId: string;
  readonly freedGpuBytes: number;
  readonly kind: "evict-cell-complete";
  readonly requestId: number;
}

export interface RenderCommitCellResponse {
  readonly cellId: string;
  readonly kind: "commit-cell-complete";
  readonly requestId: number;
}

export interface RenderStreamingFailureResponse {
  readonly kind: "streaming-render-failure";
  readonly message: string;
  readonly requestId: number;
}

export type RenderStreamingResponse =
  | RenderCommitCellResponse
  | RenderEvictCellResponse
  | RenderStreamCellResponse
  | RenderStreamingFailureResponse;
