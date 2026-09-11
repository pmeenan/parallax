export const SPATIAL_AUDIO_TELEMETRY_SCHEMA_VERSION = 1;

/** Metres in the game's left-handed, Y-up world. The browser boundary flips Z. */
export type AudioVector3 = readonly [number, number, number];

export interface SpatialAudioListenerPose {
  readonly position: AudioVector3;
  readonly forward: AudioVector3;
  readonly up: AudioVector3;
}

export interface SpatialAudioLimits {
  readonly maximumVoices: number;
  readonly maximumClips: number;
  readonly maximumPcmBytes: number;
}

/** Already decoded mono PCM. Content admission and installed-byte loading own provenance. */
export interface SpatialAudioClip {
  readonly id: string;
  readonly sampleRate: number;
  readonly samples: Float32Array<ArrayBuffer>;
}

export interface SpatialAudioRequest {
  readonly clipId: string;
  readonly sceneId: string;
  readonly position: AudioVector3;
  readonly emitterId?: number;
  readonly gain: number;
  readonly referenceDistance: number;
  readonly maximumDistance: number;
  readonly loop?: boolean;
}

export interface SpatialAudioTelemetrySnapshot {
  readonly schemaVersion: typeof SPATIAL_AUDIO_TELEMETRY_SCHEMA_VERSION;
  readonly state: "idle" | "suspended" | "running" | "failed" | "disposed";
  readonly failureMessage: string | null;
  readonly sceneId: string | null;
  readonly enabled: boolean;
  readonly sampleRate: number | null;
  readonly baseLatencySeconds: number | null;
  readonly outputLatencySeconds: number | null;
  readonly limits: SpatialAudioLimits;
  readonly clipCount: number;
  readonly pcmBytes: number;
  readonly pendingPcmBytes: number;
  readonly pcmBytesHighWater: number;
  readonly activeVoices: number;
  readonly voicesHighWater: number;
  readonly playCount: number;
  readonly endedCount: number;
  readonly stoppedCount: number;
  readonly capacityDropCount: number;
  readonly inactiveDropCount: number;
  readonly cacheHitCount: number;
  readonly cacheMissCount: number;
  readonly resetCount: number;
  readonly resumeAttemptCount: number;
  readonly listenerUpdateCount: number;
  readonly emitterUpdateCount: number;
  readonly prepareCount: number;
  readonly prepareDurationHighWaterMs: number;
  readonly controlDurationHighWaterMs: number;
}

export interface SpatialAudioService {
  /** Call synchronously from a user gesture; blocked activation never queues sounds. */
  activate(): void;
  prepareClip(clip: SpatialAudioClip): Promise<void>;
  releaseClip(id: string): void;
  play(request: SpatialAudioRequest): number | null;
  stop(voiceId: number): void;
  reset(): void;
  setScene(sceneId: string | null): void;
  setEnabled(enabled: boolean): void;
  setListener(pose: SpatialAudioListenerPose): void;
  updateEmitters(
    emitters: readonly { readonly id: number; readonly position: AudioVector3 }[],
  ): void;
  snapshot(): SpatialAudioTelemetrySnapshot;
  dispose(): Promise<void>;
}
