export function districtSwapPresentIntervalInsideWindow(
  frameCount: number,
  presentIntervalMs: number | null,
  frameTimestampMs: number,
  windowOpenedAtMs: number,
): number {
  if (presentIntervalMs === null) return 0;
  if (frameCount > 0) return presentIntervalMs;
  return Math.min(presentIntervalMs, Math.max(0, frameTimestampMs - windowOpenedAtMs));
}
