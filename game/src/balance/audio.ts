import type { SpatialAudioLimits } from "@parallax/engine";

// Initial bounded service capacities, not calibrated performance budgets. No bank is
// shipped until audio asset QA/installed loading and human audition are complete.
export const GAMEPLAY_AUDIO_LIMITS: SpatialAudioLimits = Object.freeze({
  maximumClips: 32,
  maximumPcmBytes: 16 * 1_024 * 1_024,
  maximumVoices: 32,
});

// These bindings consume the existing event payloads; they do not create sim events.
// Clip IDs reserve the first route's hooks and intentionally have no placeholder assets.
export const GAMEPLAY_AUDIO_CUES = Object.freeze([
  {
    eventKind: "combat.attack-started",
    clipId: "combat-attack",
    payloadBytes: 16,
    entityByteOffset: 0,
    gain: 0.15,
    referenceDistance: 2,
    maximumDistance: 60,
  },
  {
    eventKind: "combat.hit",
    clipId: "combat-hit",
    payloadBytes: 16,
    entityByteOffset: 4,
    gain: 0.2,
    referenceDistance: 2,
    maximumDistance: 60,
  },
  {
    eventKind: "combat.defeated",
    clipId: "combat-defeated",
    payloadBytes: 16,
    entityByteOffset: 0,
    gain: 0.15,
    referenceDistance: 2,
    maximumDistance: 60,
  },
  {
    eventKind: "npc.interaction-activated",
    clipId: "npc-interaction",
    payloadBytes: 4,
    entityByteOffset: 0,
    gain: 0.1,
    referenceDistance: 2,
    maximumDistance: 30,
  },
]);
