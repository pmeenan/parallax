import { isRuntimeIdentifier } from "../core/runtime-identifier";
import {
  type AudioVector3,
  SPATIAL_AUDIO_TELEMETRY_SCHEMA_VERSION,
  type SpatialAudioClip,
  type SpatialAudioLimits,
  type SpatialAudioListenerPose,
  type SpatialAudioRequest,
  type SpatialAudioService,
  type SpatialAudioTelemetrySnapshot,
} from "./spatial-audio-contract";

interface Voice {
  readonly gain: GainNode;
  readonly panner: PannerNode;
  source: AudioBufferSourceNode | null;
  id: number;
  clipId: string | null;
  emitterId: number | null;
}

export interface SpatialAudioPlatform {
  createContext(): AudioContext;
  now(): number;
  yieldPreparation(): Promise<void>;
}

const browserPlatform: SpatialAudioPlatform = {
  createContext: () => new AudioContext({ latencyHint: "interactive" }),
  now: () => performance.now(),
  yieldPreparation: () => new Promise((resolve) => setTimeout(resolve, 0)),
};

export function createSpatialAudioService(
  requestedLimits: SpatialAudioLimits,
  platform: SpatialAudioPlatform = browserPlatform,
): SpatialAudioService {
  for (const key of ["maximumVoices", "maximumClips", "maximumPcmBytes"] as const) {
    const value = requestedLimits[key];
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid audio limit: ${key}`);
  }
  const limits = Object.freeze({ ...requestedLimits });
  const clips = new Map<string, AudioBuffer>();
  const preparing = new Set<string>();
  const voices: Voice[] = [];
  let context: AudioContext | null = null;
  let disposal: Promise<void> | null = null;
  let contextClosing: Promise<void> | null = null;
  let nextVoiceId = 1;
  let resumePending = false;
  let listener: SpatialAudioListenerPose | null = null;
  let telemetry = initialTelemetry(limits);

  const record = (patch: Partial<SpatialAudioTelemetrySnapshot>): void => {
    telemetry = { ...telemetry, ...patch };
  };
  const assertLive = (): void => {
    if (telemetry.state === "disposed" || telemetry.state === "failed") {
      throw new Error(`Spatial audio is ${telemetry.state}`);
    }
  };
  const finishVoice = (voice: Voice, stopped: boolean): void => {
    const source = voice.source;
    if (source === null) return;
    voice.source = null;
    voice.clipId = null;
    voice.emitterId = null;
    source.onended = null;
    if (stopped) source.stop();
    source.disconnect();
    record({
      activeVoices: telemetry.activeVoices - 1,
      endedCount: telemetry.endedCount + Number(!stopped),
      stoppedCount: telemetry.stoppedCount + Number(stopped),
    });
  };
  const reset = (): void => {
    for (const voice of voices) finishVoice(voice, true);
    record({ resetCount: telemetry.resetCount + 1 });
  };
  const closeContext = (): Promise<void> => {
    if (contextClosing !== null) return contextClosing;
    for (const voice of voices) {
      voice.gain.disconnect();
      voice.panner.disconnect();
    }
    voices.length = 0;
    if (context === null) return Promise.resolve();
    context.onstatechange = null;
    contextClosing = context.state === "closed" ? Promise.resolve() : context.close();
    return contextClosing;
  };
  const fail = (error: unknown): void => {
    reset();
    clips.clear();
    record({
      failureMessage: error instanceof Error ? error.message : String(error),
      clipCount: 0,
      pcmBytes: 0,
      state: "failed",
    });
    void closeContext().catch((closeError: unknown) => {
      record({
        failureMessage: `${telemetry.failureMessage}; context cleanup: ${String(closeError)}`,
      });
    });
  };
  const applyListener = (active: AudioContext, pose: SpatialAudioListenerPose): void => {
    setVector(
      active.listener.positionX,
      active.listener.positionY,
      active.listener.positionZ,
      pose.position,
    );
    setVector(
      active.listener.forwardX,
      active.listener.forwardY,
      active.listener.forwardZ,
      pose.forward,
    );
    setVector(active.listener.upX, active.listener.upY, active.listener.upZ, pose.up);
  };
  const ensureContext = (): AudioContext => {
    assertLive();
    if (context !== null) return context;
    try {
      const active = platform.createContext();
      context = active;
      for (let index = 0; index < limits.maximumVoices; index += 1) {
        const panner = active.createPanner();
        panner.panningModel = "equalpower";
        panner.distanceModel = "inverse";
        panner.rolloffFactor = 1;
        const gain = active.createGain();
        gain.connect(panner);
        panner.connect(active.destination);
        voices.push({ clipId: null, emitterId: null, gain, id: 0, panner, source: null });
      }
      active.onstatechange = () => {
        if (telemetry.state === "disposed" || telemetry.state === "failed") return;
        // Suspended/interrupted one-shots must never burst out on a later gesture.
        if (active.state !== "running") reset();
        if (active.state === "closed") fail(new Error("Audio context closed unexpectedly"));
        else record({ state: active.state === "running" ? "running" : "suspended" });
      };
      record({
        baseLatencySeconds: active.baseLatency,
        outputLatencySeconds: active.outputLatency,
        sampleRate: active.sampleRate,
        state: active.state === "running" ? "running" : "suspended",
      });
      if (listener !== null) applyListener(active, listener);
      return active;
    } catch (error: unknown) {
      fail(error);
      throw error;
    }
  };
  const measureControl = (startedAt: number): void => {
    record({
      controlDurationHighWaterMs: Math.max(
        telemetry.controlDurationHighWaterMs,
        platform.now() - startedAt,
      ),
    });
  };

  return Object.freeze({
    activate(): void {
      assertLive();
      if (!telemetry.enabled) return;
      const active = ensureContext();
      if (active.state === "running" || resumePending) return;
      resumePending = true;
      record({ resumeAttemptCount: telemetry.resumeAttemptCount + 1 });
      // Do not await activation at boot or keep a playback backlog while Chrome waits.
      void active
        .resume()
        .then(() => {
          if (telemetry.state !== "disposed" && telemetry.state !== "failed") {
            record({ state: active.state === "running" ? "running" : "suspended" });
          }
        })
        .catch((error: unknown) => {
          if (telemetry.state !== "disposed") fail(error);
        })
        .finally(() => {
          resumePending = false;
        });
    },
    async prepareClip({ id, sampleRate, samples }: SpatialAudioClip): Promise<void> {
      assertLive();
      if (!isRuntimeIdentifier(id) || clips.has(id) || preparing.has(id)) {
        throw new Error("Audio clip ID is invalid or already prepared");
      }
      if (
        !(samples instanceof Float32Array) ||
        !(samples.buffer instanceof ArrayBuffer) ||
        !Number.isInteger(sampleRate) ||
        sampleRate < 8_000 ||
        sampleRate > 96_000 ||
        samples.length === 0
      )
        throw new Error("Audio requires finite mono PCM at 8–96 kHz");
      const frames = samples.length;
      const bytes = samples.byteLength;
      if (
        clips.size + preparing.size >= limits.maximumClips ||
        telemetry.pcmBytes + telemetry.pendingPcmBytes + bytes > limits.maximumPcmBytes
      ) {
        throw new Error("Audio clip capacity exceeded");
      }
      const active = ensureContext();
      const startedAt = platform.now();
      preparing.add(id);
      record({ pendingPcmBytes: telemetry.pendingPcmBytes + bytes });
      record({
        pcmBytesHighWater: Math.max(
          telemetry.pcmBytesHighWater,
          telemetry.pcmBytes + telemetry.pendingPcmBytes,
        ),
      });
      try {
        const buffer = active.createBuffer(1, frames, sampleRate);
        // Bounded copies yield between chunks; no PCM decoding or scanning in gameplay.
        for (let offset = 0; offset < frames; offset += 16_384) {
          assertLive();
          if (samples.length !== frames || samples.byteLength !== bytes)
            throw new Error("Audio PCM changed size during preparation");
          const chunk = samples.subarray(offset, offset + 16_384);
          for (const sample of chunk) {
            if (!Number.isFinite(sample) || Math.abs(sample) > 1)
              throw new Error("Audio PCM is outside [-1, 1]");
          }
          buffer.copyToChannel(chunk, 0, offset);
          if (offset + 16_384 < frames) await platform.yieldPreparation();
        }
        assertLive();
        clips.set(id, buffer);
        record({
          pcmBytes: telemetry.pcmBytes + bytes,
          clipCount: clips.size,
          prepareCount: telemetry.prepareCount + 1,
        });
      } finally {
        preparing.delete(id);
        record({
          pendingPcmBytes: telemetry.pendingPcmBytes - bytes,
          prepareDurationHighWaterMs: Math.max(
            telemetry.prepareDurationHighWaterMs,
            platform.now() - startedAt,
          ),
        });
      }
    },
    releaseClip(id: string): void {
      assertLive();
      if (preparing.has(id)) throw new Error("Audio clip is still preparing");
      const buffer = clips.get(id);
      if (buffer === undefined) return;
      for (const voice of voices) if (voice.clipId === id) finishVoice(voice, true);
      clips.delete(id);
      record({
        clipCount: clips.size,
        pcmBytes: telemetry.pcmBytes - buffer.length * Float32Array.BYTES_PER_ELEMENT,
      });
    },
    play(request: SpatialAudioRequest): number | null {
      assertLive();
      validateRequest(request);
      const startedAt = platform.now();
      if (
        !telemetry.enabled ||
        request.sceneId !== telemetry.sceneId ||
        context?.state !== "running" ||
        listener === null
      ) {
        record({ inactiveDropCount: telemetry.inactiveDropCount + 1 });
        return null;
      }
      const buffer = clips.get(request.clipId);
      if (buffer === undefined) {
        record({ cacheMissCount: telemetry.cacheMissCount + 1 });
        return null;
      }
      record({ cacheHitCount: telemetry.cacheHitCount + 1 });
      const voice = voices.find((candidate) => candidate.source === null);
      if (voice === undefined) {
        record({ capacityDropCount: telemetry.capacityDropCount + 1 });
        return null;
      }
      try {
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = request.loop ?? false;
        voice.gain.gain.value = request.gain;
        voice.panner.refDistance = request.referenceDistance;
        voice.panner.maxDistance = request.maximumDistance;
        setVector(
          voice.panner.positionX,
          voice.panner.positionY,
          voice.panner.positionZ,
          request.position,
        );
        source.connect(voice.gain);
        voice.id = nextVoiceId++;
        voice.clipId = request.clipId;
        voice.emitterId = request.emitterId ?? null;
        voice.source = source;
        source.onended = () => {
          if (voice.source === source) finishVoice(voice, false);
        };
        record({ activeVoices: telemetry.activeVoices + 1 });
        try {
          source.start();
        } catch (error: unknown) {
          finishVoice(voice, false);
          throw error;
        }
        record({
          playCount: telemetry.playCount + 1,
          voicesHighWater: Math.max(telemetry.voicesHighWater, telemetry.activeVoices),
        });
        measureControl(startedAt);
        return voice.id;
      } catch (error: unknown) {
        fail(error);
        return null;
      }
    },
    stop(voiceId: number): void {
      const voice = voices.find(
        (candidate) => candidate.source !== null && candidate.id === voiceId,
      );
      if (voice !== undefined) finishVoice(voice, true);
    },
    reset,
    setScene(sceneId: string | null): void {
      assertLive();
      if (sceneId !== null && !isRuntimeIdentifier(sceneId))
        throw new Error("Audio scene ID is invalid");
      if (sceneId === telemetry.sceneId) return;
      reset();
      listener = null;
      record({ sceneId });
    },
    setEnabled(enabled: boolean): void {
      assertLive();
      if (enabled === telemetry.enabled) return;
      if (!enabled) reset();
      record({ enabled });
    },
    setListener(pose: SpatialAudioListenerPose): void {
      assertLive();
      for (const vector of [pose.position, pose.forward, pose.up]) assertVector(vector);
      if (
        Math.abs(Math.hypot(...pose.forward) - 1) > 0.001 ||
        Math.abs(Math.hypot(...pose.up) - 1) > 0.001 ||
        Math.abs(
          pose.forward.reduce(
            (sum, component, index) => sum + component * (pose.up[index] ?? 0),
            0,
          ),
        ) > 0.001
      ) {
        throw new Error("Audio listener orientation must be orthonormal");
      }
      if (
        listener !== null &&
        sameVector(listener.position, pose.position) &&
        sameVector(listener.forward, pose.forward) &&
        sameVector(listener.up, pose.up)
      )
        return;
      const startedAt = platform.now();
      listener = { position: [...pose.position], forward: [...pose.forward], up: [...pose.up] };
      if (context !== null) applyListener(context, listener);
      record({ listenerUpdateCount: telemetry.listenerUpdateCount + 1 });
      measureControl(startedAt);
    },
    updateEmitters(
      emitters: readonly { readonly id: number; readonly position: AudioVector3 }[],
    ): void {
      assertLive();
      if (telemetry.activeVoices === 0) return;
      const startedAt = platform.now();
      for (const voice of voices) {
        if (voice.source === null || voice.emitterId === null) continue;
        const emitter = emitters.find((candidate) => candidate.id === voice.emitterId);
        if (emitter === undefined) {
          finishVoice(voice, true);
          continue;
        }
        assertVector(emitter.position);
        setVector(
          voice.panner.positionX,
          voice.panner.positionY,
          voice.panner.positionZ,
          emitter.position,
        );
        record({ emitterUpdateCount: telemetry.emitterUpdateCount + 1 });
      }
      measureControl(startedAt);
    },
    snapshot(): SpatialAudioTelemetrySnapshot {
      return Object.freeze({ ...telemetry });
    },
    dispose(): Promise<void> {
      if (disposal !== null) return disposal;
      reset();
      record({ state: "disposed", enabled: false, sceneId: null, pcmBytes: 0, clipCount: 0 });
      clips.clear();
      listener = null;
      disposal = closeContext();
      return disposal;
    },
  });
}

function assertVector(vector: AudioVector3): void {
  if (vector.length !== 3 || !vector.every(Number.isFinite))
    throw new Error("Audio vector is invalid");
}

function sameVector(a: AudioVector3, b: AudioVector3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function setVector(x: AudioParam, y: AudioParam, z: AudioParam, value: AudioVector3): void {
  // Web Audio uses right-handed coordinates; Parallax uses Babylon's left-handed world.
  x.value = value[0];
  y.value = value[1];
  z.value = -value[2];
}

function validateRequest(request: SpatialAudioRequest): void {
  assertVector(request.position);
  if (
    !isRuntimeIdentifier(request.clipId) ||
    !isRuntimeIdentifier(request.sceneId) ||
    !Number.isFinite(request.gain) ||
    request.gain < 0 ||
    request.gain > 1 ||
    !Number.isFinite(request.referenceDistance) ||
    request.referenceDistance <= 0 ||
    !Number.isFinite(request.maximumDistance) ||
    request.maximumDistance < request.referenceDistance ||
    (request.emitterId !== undefined &&
      (!Number.isSafeInteger(request.emitterId) || request.emitterId < 0))
  ) {
    throw new Error("Audio playback request is invalid");
  }
}

function initialTelemetry(limits: SpatialAudioLimits): SpatialAudioTelemetrySnapshot {
  return {
    schemaVersion: SPATIAL_AUDIO_TELEMETRY_SCHEMA_VERSION,
    state: "idle",
    failureMessage: null,
    sceneId: null,
    enabled: true,
    sampleRate: null,
    baseLatencySeconds: null,
    outputLatencySeconds: null,
    limits,
    clipCount: 0,
    pcmBytes: 0,
    pendingPcmBytes: 0,
    pcmBytesHighWater: 0,
    activeVoices: 0,
    voicesHighWater: 0,
    playCount: 0,
    endedCount: 0,
    stoppedCount: 0,
    capacityDropCount: 0,
    inactiveDropCount: 0,
    cacheHitCount: 0,
    cacheMissCount: 0,
    resetCount: 0,
    resumeAttemptCount: 0,
    listenerUpdateCount: 0,
    emitterUpdateCount: 0,
    prepareCount: 0,
    prepareDurationHighWaterMs: 0,
    controlDurationHighWaterMs: 0,
  };
}
