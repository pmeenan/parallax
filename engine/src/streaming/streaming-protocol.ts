import type { GreyboxCell, GreyboxMaterial, WorldVec3 } from "../world/world-contract";
import type { StreamingStartupTimingSnapshot } from "./streaming-startup-telemetry";

export const STREAMING_TELEMETRY_SCHEMA_VERSION = 13;
export const STREAMING_DECODE_PROTOCOL_VERSION = 2;
export const STREAMING_TIMING_ATTRIBUTION_TOLERANCE_MS = 0.1;
export const STREAMING_CELL_LOAD_BUDGET_MS = 250;
export const STREAMING_DECODE_WORKER_MAXIMUM = 4;
export const STREAMING_DECODE_WORKER_RESERVED_THREADS = 2;
export const STREAMING_RESIDENT_CELL_LIMIT = 9;
export const STREAMING_RESIDENT_ENCODED_BUDGET_BYTES = 16 * 1024 * 1024;
export const STREAMING_DEPENDENCY_ENCODED_MAX_BYTES = 8 * 1024 * 1024;
export const STREAMING_DEPENDENCY_DECODED_MAX_BYTES = 32 * 1024 * 1024;
export const STREAMING_BATCH_STAGING_BUDGET_BYTES = 128 * 1024 * 1024;
export const STREAMING_DISTRICT_SWAP_MAX_HITCH_BUDGET_MS = 100;
export const STREAMING_DISTRICT_SWAP_TOTAL_BUDGET_MS = 4_000;
export const STREAMING_DISTRICT_SWAP_LOGICAL_GPU_OVERLAP_RATIO = 1.25;
export const STREAMING_DISTRICT_SWAP_SAMPLE_LIMIT = 32;
export const STREAMING_DISTRICT_INDEX_SCHEMA_VERSION = 2;

export interface StreamingCellIndexEntry {
  readonly bytes: number;
  readonly cellId: string;
  readonly coordinate: readonly [number, number];
  readonly path: string;
  readonly sha256: string;
  readonly dependencies?: readonly string[];
}

export interface StreamingKtx2DependencyIndexEntry {
  readonly bytes: number;
  readonly decode: Readonly<{
    readonly colorSpace: "srgb";
    readonly format: "rgba8";
    readonly height: number;
    readonly version?: 1;
    readonly width: number;
  }>;
  readonly dependencies: readonly string[];
  readonly format: "ktx2";
  readonly path: string;
  readonly resourceId: string;
  readonly sha256: string;
}

export interface StreamingLegacyMeshoptDependencyIndexEntry {
  readonly bytes: number;
  readonly decode: Readonly<{
    readonly count: number;
    readonly mode: "ATTRIBUTES";
    readonly stride: 12;
  }>;
  readonly dependencies: readonly string[];
  readonly format: "meshopt";
  readonly path: string;
  readonly resourceId: string;
  readonly sha256: string;
}

export interface StreamingMeshoptVertexDependencyIndexEntry {
  readonly bytes: number;
  readonly decode: Readonly<{
    readonly count: number;
    readonly layout: "position-normal-uv-f32";
    readonly mode: "ATTRIBUTES";
    readonly stride: 32;
    readonly version: 1;
  }>;
  readonly dependencies: readonly [string];
  readonly format: "meshopt";
  readonly path: string;
  readonly resourceId: string;
  readonly sha256: string;
}

export interface StreamingMeshoptIndexDependencyIndexEntry {
  readonly bytes: number;
  readonly decode: Readonly<{
    readonly count: number;
    readonly indexFormat: "uint32";
    readonly mode: "TRIANGLES";
    readonly stride: 4;
    readonly version: 1;
    readonly vertexCount: number;
  }>;
  readonly dependencies: readonly [string, string];
  readonly format: "meshopt";
  readonly path: string;
  readonly resourceId: string;
  readonly sha256: string;
}

export type StreamingMeshoptDependencyIndexEntry =
  | StreamingLegacyMeshoptDependencyIndexEntry
  | StreamingMeshoptVertexDependencyIndexEntry
  | StreamingMeshoptIndexDependencyIndexEntry;

export type StreamingDependencyIndexEntry =
  | StreamingKtx2DependencyIndexEntry
  | StreamingMeshoptDependencyIndexEntry;

export interface StreamingDistrictIndex {
  readonly bounds: Readonly<{ maximum: WorldVec3; minimum: WorldVec3 }>;
  readonly cellSizeMeters: number;
  readonly cells: readonly StreamingCellIndexEntry[];
  readonly districtId: string;
  readonly materials: readonly GreyboxMaterial[];
  readonly resources?: readonly StreamingDependencyIndexEntry[];
  readonly schemaVersion: 1 | typeof STREAMING_DISTRICT_INDEX_SCHEMA_VERSION;
}

export interface StreamingCellLoadTelemetry {
  readonly batchDirectUploadMs: number;
  readonly batchCellCount: number;
  readonly batchCellOrdinal: number;
  readonly batchFlythroughObserverSequence: number;
  readonly batchObserverUpdateCount: number;
  readonly batchOrdinal: number;
  readonly batchTransactionId: string;
  readonly cellId: string;
  readonly decodeMs: number;
  readonly decodeRoundTripMs: number;
  readonly decodeWaitMs: number;
  readonly dependencyCount?: number;
  readonly dependencyDecodeMs?: number;
  readonly dependencyDecodedBytes?: number;
  readonly dependencyEncodedBytes?: number;
  readonly dependencyReadMs?: number;
  readonly dependencyUploadBytes?: number;
  readonly dependencyUploadMs?: number;
  readonly encodedBytes: number;
  readonly gpuBytes: number;
  readonly opfsAccessRoundTripMs: number;
  readonly opfsReadMs: number;
  readonly opfsWaitMs: number;
  readonly renderTransactionRoundTripMs: number;
  readonly renderTransactionWaitMs: number;
  readonly sequence: number;
  readonly streamingWorkerRemainderMs: number;
  readonly totalMs: number;
  readonly uploadMs: number;
}

export interface StreamingRecoveryCheckpoint {
  readonly flythroughObserverUpdateCount: number;
  readonly observerUpdateCount: number;
  readonly observers: readonly WorldVec3[];
  readonly residentCellIds: readonly string[];
  readonly workerGeneration: number;
}

export interface StreamingDistrictSwapTelemetry {
  readonly completedAtMs: number;
  readonly destinationLogicalGpuBytes: number;
  readonly destinationDistrictId: string;
  readonly destinationResidentCellIds: readonly string[];
  readonly entranceId: string;
  readonly logicalGpuBytesHighWater: number;
  readonly maxHitchMs: number;
  readonly renderFrameCount: number;
  readonly proactiveEvictionCount: number;
  readonly sourceDistrictId: string;
  readonly sourceLogicalGpuBytes: number;
  readonly sourceResidentCellIds: readonly string[];
  readonly startedAtMs: number;
  readonly totalMs: number;
}

export interface WorldStreamingTelemetrySnapshot {
  readonly cellLoadSamples: readonly StreamingCellLoadTelemetry[];
  readonly cellLoadSampleCount: number;
  readonly cpuBudgetRejectionCount: number;
  readonly currentObservers: readonly WorldVec3[];
  readonly districtId: string | null;
  readonly districtSwapCount: number;
  readonly districtSwapInProgress: boolean;
  readonly districtSwapSamples: readonly StreamingDistrictSwapTelemetry[];
  readonly decodeQueueDepthHighWater: number;
  readonly decodeWorkerCount: number;
  readonly dependencyDecodeFailureCount?: number;
  readonly dependencyDecodedBytes?: number;
  readonly dependencyEncodedBytesRead?: number;
  readonly dependencyReadCount?: number;
  readonly dependencyUploadBytes?: number;
  readonly dependencyUploadCount?: number;
  readonly dependencyCache?: StreamingResourceCacheTelemetry;
  readonly dependencyGpuCache?: StreamingResourceCacheTelemetry;
  readonly encodedBytesRead: number;
  readonly failureMessage: string | null;
  readonly hardwareConcurrency: number;
  readonly installedReleaseDigest: string | null;
  readonly installedResourceBytes: number;
  readonly installedResourceCount: number;
  readonly legacyNetworkRequestCount: number;
  readonly flythroughObserverUpdateCount: number;
  readonly observerUpdateCount: number;
  readonly opfsAccessHandleCount: number;
  readonly opfsAccessHandleOpenDurationMs: number;
  readonly opfsPackageCount: number;
  readonly opfsProvisionedBytes: number;
  readonly proactiveEvictionCount: number;
  readonly residentCellCount: number;
  readonly residentCellIds: readonly string[];
  readonly residentEncodedBytes: number;
  readonly residentEncodedBytesHighWater: number;
  readonly residentGpuBytes: number;
  readonly residentGpuBytesHighWater: number;
  readonly renderRecoveryCount: number;
  readonly renderBatchCellCountHighWater: number;
  readonly renderBatchDirectUploadMsHighWater: number;
  readonly renderBatchRequestCount: number;
  readonly renderBatchTransactionCount: number;
  readonly psoWarmupGameplayOverlapCount?: number;
  readonly schemaVersion: typeof STREAMING_TELEMETRY_SCHEMA_VERSION;
  readonly settledRecoveryCheckpoint: StreamingRecoveryCheckpoint | null;
  readonly settledObserverUpdateCount: number;
  readonly state: "idle" | "starting" | "provisioning" | "streaming" | "failed" | "disposed";
  readonly startupTiming: StreamingStartupTimingSnapshot | null;
  readonly workerGeneration: number;
}

export type StreamingContentSource =
  | Readonly<{
      readonly kind: "installed-release";
      readonly releaseDigest: string;
    }>
  | Readonly<{
      readonly buildManifestUrl: string;
      readonly kind: "privileged-legacy-network";
    }>;

export interface StreamingStartRequest {
  readonly contentSource: StreamingContentSource;
  readonly districtId: string;
  readonly initialObservers: readonly WorldVec3[];
  readonly kind: "start";
  readonly recoveryCheckpoint: StreamingRecoveryCheckpoint | null;
  readonly renderRecoveryCount: number;
  readonly renderPort: MessagePort;
  readonly workerGeneration: number;
}

export interface StreamingObserversRequest {
  readonly kind: "observers";
  readonly observers: readonly WorldVec3[];
}

export interface StreamingDistrictSwapRequest {
  readonly destinationDistrictId: string;
  readonly entranceId: string;
  readonly initialObservers: readonly WorldVec3[];
  readonly kind: "swap-district";
  readonly requestId: number;
}

export interface StreamingDisposeRequest {
  readonly kind: "dispose";
}

export type StreamingWorkerRequest =
  | StreamingDisposeRequest
  | StreamingDistrictSwapRequest
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

export interface StreamingDistrictSwapCompleteResponse {
  readonly kind: "district-swap-complete";
  readonly requestId: number;
  readonly sample: StreamingDistrictSwapTelemetry;
}

export type StreamingWorkerResponse =
  | StreamingDisposedResponse
  | StreamingDistrictSwapCompleteResponse
  | StreamingFailureResponse
  | StreamingTelemetryResponse;

export interface DecodeCellRequest {
  readonly bytes: ArrayBuffer;
  readonly cellId: string;
  readonly dependencies: readonly DecodeDependencyRequest[];
  readonly districtId: string;
  readonly kind: "decode-cell";
  readonly protocolVersion: typeof STREAMING_DECODE_PROTOCOL_VERSION;
  readonly schemaVersion: 1;
  readonly taskId: number;
}

export interface DecodeDependencyRequest {
  readonly bytes: ArrayBuffer;
  readonly descriptor: StreamingDependencyIndexEntry;
}

export interface DecodedKtx2Dependency {
  readonly cacheKey: string;
  readonly descriptor: StreamingKtx2DependencyIndexEntry;
  readonly decodeMs: number;
  readonly decodedBytes: number;
  readonly encodedBytes: number;
  readonly format: "ktx2";
  readonly height: number;
  readonly resourceId: string;
  readonly rgba: ArrayBuffer;
  readonly width: number;
}

export interface DecodedMeshoptDependency {
  readonly cacheKey: string;
  readonly descriptor: StreamingMeshoptDependencyIndexEntry;
  readonly decodeMs: number;
  readonly decodedBytes: number;
  readonly encodedBytes: number;
  readonly format: "meshopt";
  readonly kind: "legacy-positions";
  readonly positions: ArrayBuffer;
  readonly resourceId: string;
  readonly vertexCount: number;
}

export interface DecodedMeshoptVertexDependency {
  readonly attributes: ArrayBuffer;
  readonly cacheKey: string;
  readonly descriptor: StreamingMeshoptVertexDependencyIndexEntry;
  readonly decodeMs: number;
  readonly decodedBytes: number;
  readonly encodedBytes: number;
  readonly format: "meshopt";
  readonly kind: "vertex-attributes";
  readonly resourceId: string;
  readonly vertexCount: number;
}

export interface DecodedMeshoptIndexDependency {
  readonly cacheKey: string;
  readonly descriptor: StreamingMeshoptIndexDependencyIndexEntry;
  readonly decodeMs: number;
  readonly decodedBytes: number;
  readonly encodedBytes: number;
  readonly format: "meshopt";
  readonly indexCount: number;
  readonly indices: ArrayBuffer;
  readonly kind: "indices";
  readonly resourceId: string;
}

export type DecodedStreamingDependency =
  | DecodedKtx2Dependency
  | DecodedMeshoptDependency
  | DecodedMeshoptVertexDependency
  | DecodedMeshoptIndexDependency;

export interface CachedStreamingDependencyReference {
  readonly cacheKey: string;
  readonly descriptor: StreamingDependencyIndexEntry;
  readonly format: "ktx2" | "meshopt";
  readonly kind: "cached-dependency-reference";
  readonly resourceId: string;
}

export type RenderStreamingDependency =
  | CachedStreamingDependencyReference
  | DecodedStreamingDependency;

export interface StreamingResourceCacheTelemetry {
  readonly acquireCount: number;
  readonly hitCount: number;
  readonly liveDecodedBytes: number;
  readonly liveEncodedBytes: number;
  readonly liveRefCount: number;
  readonly liveResourceCount: number;
  readonly missCount: number;
  readonly releaseCount: number;
  readonly resources: readonly Readonly<{
    readonly cacheKey: string;
    readonly format: "ktx2" | "meshopt";
    readonly ownedBytes: number;
    readonly refCount: number;
    readonly resourceId: string;
  }>[];
}

export interface DecodeCellResponse {
  readonly cell: GreyboxCell;
  readonly decodeMs: number;
  readonly dependencies: readonly DecodedStreamingDependency[];
  readonly encodedBytes: number;
  readonly kind: "decoded-cell";
  readonly protocolVersion: typeof STREAMING_DECODE_PROTOCOL_VERSION;
  readonly taskId: number;
}

export interface DecodeFailureResponse {
  readonly kind: "decode-failure";
  readonly message: string;
  readonly taskId: number;
}

export type DecodeWorkerRequest = DecodeCellRequest;
export type DecodeWorkerResponse = DecodeCellResponse | DecodeFailureResponse;

export interface RenderBatchTransactionMember {
  readonly batchCellOrdinal: number;
  readonly cellId: string;
  readonly cell: GreyboxCell;
  readonly dependencies: readonly RenderStreamingDependency[];
  readonly encodedBytes: number;
}

export interface RenderBatchTransactionRequest {
  readonly batchCellCount: number;
  readonly batchDemandEncodedBytes: number;
  readonly batchOrdinal: number;
  readonly batchTransactionId: string;
  readonly kind: "render-batch-transaction";
  readonly members: readonly RenderBatchTransactionMember[];
  readonly requestId: number;
}

export interface RenderEvictCellRequest {
  readonly cellId: string;
  readonly kind: "evict-cell";
  readonly requestId: number;
}

export interface RenderDistrictSwapBoundaryRequest {
  readonly destinationDistrictId: string;
  readonly destinationMaterials: readonly GreyboxMaterial[];
  readonly districtSwapRequestId: number;
  readonly kind: "district-swap-boundary";
  readonly phase: "begin" | "materials" | "end";
  readonly requestId: number;
}

export type RenderStreamingRequest =
  | RenderBatchTransactionRequest
  | RenderDistrictSwapBoundaryRequest
  | RenderEvictCellRequest;

export interface RenderBatchTransactionMemberResponse {
  readonly batchCellOrdinal: number;
  readonly cellGpuBytes: number;
  readonly cellId: string;
  readonly gpuBytes: number;
  readonly dependencyUploadBytes: number;
  readonly dependencyUploadCount: number;
  readonly dependencyUploadMs: number;
  readonly psoWarmupGameplayOverlap: boolean;
  readonly uploadMs: number;
}

export interface RenderBatchTransactionResponse {
  readonly batchCellCount: number;
  readonly batchDirectUploadMs: number;
  readonly batchDemandEncodedBytes: number;
  readonly batchEncodedBytes: number;
  readonly batchGpuBytes: number;
  readonly batchOrdinal: number;
  readonly batchTransactionId: string;
  readonly kind: "render-batch-transaction-complete";
  readonly members: readonly RenderBatchTransactionMemberResponse[];
  readonly dependencyGpuCache: StreamingResourceCacheTelemetry;
  readonly requestId: number;
}

export interface RenderEvictCellResponse {
  readonly cellId: string;
  readonly freedGpuBytes: number;
  readonly freedCellGpuBytes: number;
  readonly dependencyGpuCache: StreamingResourceCacheTelemetry;
  readonly kind: "evict-cell-complete";
  readonly requestId: number;
}

export interface RenderDistrictSwapBoundaryResponse {
  readonly destinationDistrictId: string;
  readonly districtSwapRequestId: number;
  readonly frameCount: number;
  readonly kind: "district-swap-boundary-complete";
  readonly maxHitchMs: number;
  readonly phase: "begin" | "materials" | "end";
  readonly requestId: number;
}

export interface RenderStreamingFailureResponse {
  readonly batchTransactionId: string | null;
  readonly kind: "streaming-render-failure";
  readonly message: string;
  readonly requestId: number;
}

export type RenderStreamingResponse =
  | RenderBatchTransactionResponse
  | RenderDistrictSwapBoundaryResponse
  | RenderEvictCellResponse
  | RenderStreamingFailureResponse;

export interface RenderStreamingFlythroughObservers {
  readonly flythroughGeneration: number;
  readonly kind: "flythrough-observers";
  readonly observers: readonly WorldVec3[];
  readonly sequence: number;
  readonly transportSequence: number;
}

export interface RenderStreamingFlythroughResetRequest {
  readonly completedFlythroughGeneration: number;
  readonly completedRunSequence: number | null;
  readonly flythroughObserverUpdateCount: number | null;
  readonly kind: "reset-flythrough-boundary";
  readonly nextFlythroughGeneration: number;
  readonly requestId: number;
}

export interface RenderStreamingFaultBoundaryRequest {
  readonly flythroughObserverUpdateCount: number;
  readonly kind: "quiesce-fault-boundary";
  readonly requestId: number;
}

export interface StreamingRenderFaultBoundaryResponse {
  readonly checkpoint: StreamingRecoveryCheckpoint;
  readonly kind: "fault-boundary-settled";
  readonly requestId: number;
}

export interface StreamingRenderFlythroughResetResponse {
  readonly flythroughObserverUpdateCount: number;
  readonly kind: "flythrough-reset-settled";
  readonly nextFlythroughGeneration: number;
  readonly requestId: number;
}

export type RenderToStreamingMessage =
  | RenderStreamingFaultBoundaryRequest
  | RenderStreamingFlythroughObservers
  | RenderStreamingFlythroughResetRequest
  | RenderStreamingResponse;

export type StreamingToRenderMessage =
  | RenderStreamingRequest
  | StreamingRenderFlythroughResetResponse
  | StreamingRenderFaultBoundaryResponse;
