import type { AnimationGroup, AssetContainer, EngineContext } from "@babylonjs/lite";
import { beforeEach, expect, it, vi } from "vitest";
import { importAnimationForQa } from "../src/assets/lite-animation-import";

const native = vi.hoisted(() => ({
  loadGltf: vi.fn(),
  enableBoneControl: vi.fn(),
  stopAnimation: vi.fn(),
}));
vi.mock("@babylonjs/lite", () => native);
beforeEach(() => vi.clearAllMocks());

const engine = {} as EngineContext; // Only an identity token is passed to the mocked native loader.
const bytes = new Uint8Array([1, 2, 3]).buffer;
const expected = {
  sourceSha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
  jointNames: ["Root"],
  clips: [{ name: "Idle", durationSeconds: 1 }],
};
function container(): AssetContainer {
  const group: AnimationGroup = {
    name: "Idle",
    duration: 1,
    isPlaying: true,
    currentTime: 0,
    targetedAnimations: [],
    speedRatio: 1,
    loopAnimation: true,
    weight: 1,
  };
  return { entities: [], skeletons: [{ bones: [{ name: "Root" }] }], animationGroups: [group] };
}

it("stops imported automatic playback and checks native skeleton/clip identity", async () => {
  const asset = container();
  native.loadGltf.mockResolvedValue(asset);
  const result = await importAnimationForQa(engine, bytes, expected);
  expect(result.container).toBe(asset);
  expect(native.loadGltf).toHaveBeenCalledWith(engine, bytes);
  expect(native.stopAnimation).toHaveBeenCalledWith(asset.animationGroups?.[0]);
  expect(result.importDurationMs).toBeGreaterThanOrEqual(0);
});

it("rejects source-byte drift before loading GPU resources", async () => {
  await expect(
    importAnimationForQa(engine, bytes, { ...expected, sourceSha256: "0".repeat(64) }),
  ).rejects.toThrow("source bytes changed");
  expect(native.loadGltf).not.toHaveBeenCalled();
});

it("rejects a missing rig and changed native clip duration", async () => {
  native.loadGltf.mockResolvedValue({ ...container(), skeletons: [] });
  await expect(importAnimationForQa(engine, bytes, expected)).rejects.toThrow("skeleton differs");
  native.loadGltf.mockResolvedValue(container());
  await expect(
    importAnimationForQa(engine, bytes, {
      ...expected,
      clips: [{ name: "Idle", durationSeconds: 2 }],
    }),
  ).rejects.toThrow("clip Idle differs");
});
