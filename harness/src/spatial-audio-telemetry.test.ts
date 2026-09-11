import { createSpatialAudioService } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import { validateSpatialAudioTelemetry } from "./spatial-audio-telemetry.js";

describe("spatial audio telemetry", () => {
  it("accepts the dormant service and rejects missing, non-finite and over-capacity evidence", () => {
    const snapshot = createSpatialAudioService({
      maximumClips: 2,
      maximumPcmBytes: 1_024,
      maximumVoices: 2,
    }).snapshot();
    expect(() => validateSpatialAudioTelemetry(snapshot)).not.toThrow();
    for (const candidate of [
      null,
      {},
      { ...snapshot, playCount: Number.NaN },
      { ...snapshot, pcmBytesHighWater: 2_048 },
      { ...snapshot, activeVoices: 3 },
      { ...snapshot, limits: {} },
      { ...snapshot, outputLatencySeconds: -1 },
    ]) {
      expect(() => validateSpatialAudioTelemetry(candidate)).toThrow();
    }
  });
});
