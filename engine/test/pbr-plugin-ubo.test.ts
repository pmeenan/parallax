import type { Texture2D } from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import { createPbrAmbientPlugin, createPbrAmbientState } from "../src/render/pbr-ambient";
import { createTerrainDrapePlugin } from "../src/render/terrain-drape";

describe("PBR plugin UBO writes", () => {
  it("writes the ambient's sky and ground radiance in place, padding the fourth lane", () => {
    const state = createPbrAmbientState();
    state.sky.splice(0, 3, 0.085, 0.133, 0.211);
    state.ground.splice(0, 3, 0.16, 0.14, 0.11);
    const data = new Float32Array(16).fill(9);
    createPbrAmbientPlugin(state).writeUbo?.(
      data,
      new Map([
        ["ambientSky", 16],
        ["ambientGround", 32],
      ]),
    );
    expect([...data.subarray(4, 12)].map((v) => +v.toFixed(3))).toEqual([
      0.085, 0.133, 0.211, 0, 0.16, 0.14, 0.11, 0,
    ]);
    // Untouched lanes keep their contents.
    expect(data[0]).toBe(9);
    expect(data[12]).toBe(9);
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
