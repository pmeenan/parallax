import { describe, expect, it } from "vitest";
import {
  clearFlythroughPresentation,
  gameplayCameraAlpha,
  gameplayCameraBeta,
  type LiteGreyboxWorld,
} from "../src/render/lite-greybox-world";

describe("gameplay presentation", () => {
  it.each([
    0,
    Math.PI / 2,
    Math.PI,
    -Math.PI / 2,
  ])("places the camera behind controller forward at yaw %s", (yawRadians) => {
    const alpha = gameplayCameraAlpha(yawRadians);
    const cameraOffset = [Math.cos(alpha), Math.sin(alpha)] as const;
    const controllerForward = [Math.sin(yawRadians), Math.cos(yawRadians)] as const;
    expect(
      cameraOffset[0] * controllerForward[0] + cameraOffset[1] * controllerForward[1],
    ).toBeCloseTo(-1, 12);
  });

  it("clears scenario environment ownership at the reset boundary", () => {
    const renderer = { flythroughSample: { elapsedMs: 1 } } as unknown as LiteGreyboxWorld;
    clearFlythroughPresentation(renderer);
    expect(renderer.flythroughSample).toBeNull();
  });

  it("keeps the neutral gameplay view slightly above the horizon", () => {
    expect(gameplayCameraBeta(0)).toBeCloseTo(Math.PI / 2 - 0.08, 12);
    expect(gameplayCameraBeta(-10)).toBe(0.35);
    expect(gameplayCameraBeta(10)).toBeCloseTo(Math.PI - 0.35, 12);
  });
});
