import type { Texture2D } from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import { createPbrAmbientPlugin, createPbrAmbientState } from "../src/render/pbr-ambient";
import { createTerrainDrapePlugin } from "../src/render/terrain-drape";

describe("PBR plugin UBO writes", () => {
  it("writes the ambient's sky, ground, sun frame and sky shape in place, padding the fourth lane", () => {
    const state = createPbrAmbientState();
    state.sky.splice(0, 3, 0.085, 0.133, 0.211);
    state.ground.splice(0, 3, 0.16, 0.14, 0.11);
    state.toSun.splice(0, 3, 0.6, 0.64, -0.48);
    state.skyShape.splice(0, 27, ...Array.from({ length: 27 }, (_, i) => i / 10));
    const offsets = new Map([
      ["ambientSky", 16],
      ["ambientGround", 32],
      ["ambientSunH", 48],
      ...Array.from({ length: 9 }, (_, k) => [`ambientShape${k}`, 64 + k * 16] as [string, number]),
    ]);
    const data = new Float32Array(56).fill(9);
    createPbrAmbientPlugin(state).writeUbo?.(data, offsets);
    expect([...data.subarray(4, 12)].map((v) => +v.toFixed(3))).toEqual([
      0.085, 0.133, 0.211, 0, 0.16, 0.14, 0.11, 0,
    ]);
    // The sun's horizontal direction (x, z) normalised: (0.6, -0.48) / 0.768.
    expect([...data.subarray(12, 16)].map((v) => +v.toFixed(4))).toEqual([0.7809, -0.6247, 0, 0]);
    // Coefficient k's (r, g, b), then a zero pad.
    expect([...data.subarray(16, 20)].map((v) => +v.toFixed(3))).toEqual([0, 0.1, 0.2, 0]);
    expect([...data.subarray(48, 52)].map((v) => +v.toFixed(3))).toEqual([2.4, 2.5, 2.6, 0]);
    // Untouched lanes keep their contents.
    expect(data[0]).toBe(9);
    expect(data[52]).toBe(9);
    expect(
      createPbrAmbientPlugin(state)
        .getUniforms?.()
        ?.ubo?.map((u) => u.name),
    ).toEqual([
      "ambientSky",
      "ambientGround",
      "ambientSunH",
      "ambientShape0",
      "ambientShape1",
      "ambientShape2",
      "ambientShape3",
      "ambientShape4",
      "ambientShape5",
      "ambientShape6",
      "ambientShape7",
      "ambientShape8",
    ]);
  });

  it("writes the drape field's origin and extent in place", () => {
    const data = new Float32Array(12).fill(9);
    createTerrainDrapePlugin({
      texture: {} as Texture2D,
      originX: -16,
      originZ: 32,
      inverseSpacing: 2,
      maximumColumn: 64,
      maximumRow: 32,
      gpuBytes: 0,
    }).writeUbo?.(
      data,
      new Map([
        ["terrainDrapeOrigin", 0],
        ["terrainDrapeExtent", 16],
      ]),
    );
    expect([...data.subarray(0, 8)]).toEqual([-16, 32, 2, 0, 64, 32, 0, 0]);
    expect(data[8]).toBe(9);
  });
});
