import type { AudioVector3, SpatialAudioListenerPose } from "../audio/spatial-audio-contract";

export function gameplayCameraAlpha(playerYawRadians: number): number {
  // Simulation yaw zero faces +Z; the orbit camera sits behind that vector.
  return -playerYawRadians - Math.PI / 2;
}

export function gameplayCameraBeta(cameraPitchRadians: number): number {
  return Math.max(0.35, Math.min(Math.PI - 0.35, Math.PI / 2 - 0.08 + cameraPitchRadians));
}

export const GAMEPLAY_CAMERA_RADIUS = 9;
export const GAMEPLAY_CAMERA_TARGET_HEIGHT = 0.55;

/** The same orbit pose drives both the render camera and the audio listener. */
export function gameplayCameraPose(
  playerPosition: AudioVector3,
  playerYawRadians: number,
  cameraPitchRadians: number,
): SpatialAudioListenerPose {
  const alpha = gameplayCameraAlpha(playerYawRadians);
  const beta = gameplayCameraBeta(cameraPitchRadians);
  const x = Math.cos(alpha);
  const z = Math.sin(alpha);
  const horizontal = Math.sin(beta);
  const vertical = Math.cos(beta);
  return {
    position: [
      playerPosition[0] + GAMEPLAY_CAMERA_RADIUS * x * horizontal,
      playerPosition[1] + GAMEPLAY_CAMERA_TARGET_HEIGHT + GAMEPLAY_CAMERA_RADIUS * vertical,
      playerPosition[2] + GAMEPLAY_CAMERA_RADIUS * z * horizontal,
    ],
    forward: [-x * horizontal, -vertical, -z * horizontal],
    up: [-x * vertical, horizontal, -z * vertical],
  };
}
