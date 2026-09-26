import type { DirectionalLight, EngineContext, Mesh } from "@babylonjs/lite";
import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ set: vi.fn(), create: vi.fn(() => ({})) }));
vi.mock("@babylonjs/lite", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@babylonjs/lite")>()),
  createCsmDirectionalShadowGenerator: calls.create,
  setShadowTaskCasterMeshes: calls.set,
}));

import {
  getCsmPbrReceiverFactory,
  getCsmStdReceiverFactory,
  // @ts-expect-error The pinned package does not export or declare its receiver registry.
} from "../node_modules/@babylonjs/lite/lib/shadow/csm-receiver-registry.js";
import {
  CSM_NORMAL_OFFSET_TEXELS,
  createPbrNormalOffsetCsmFragment,
  createStdNormalOffsetCsmFragment,
} from "../src/render/csm-normal-offset-receiver";
import { createDirectionalShadows, excludeFromCsmCasters } from "../src/render/directional-shadows";
import { createPbrAmbientState } from "../src/render/pbr-ambient";
import {
  createPbrSunMicroShadowPlugin,
  NO_PBR_MICROSHADOW_SURFACE,
  PBR_SUN_MICROSHADOW_PLUGIN_NAME,
  pbrMicroShadowSurfaceFromMatrix,
} from "../src/render/pbr-sun-microshadow";
import { groupPbrAssetPlacements } from "../src/render/streamed-pbr-asset";
import { type PbrAssetPlacement, validatePbrAssetPlacements } from "../src/world/pbr-asset";
import { writePbrAssetMatrix } from "../src/world/pbr-asset-transform";

const placement: PbrAssetPlacement = {
  schemaVersion: 1,
  lodDistancesMeters: [12, 32],
  id: "ground",
  position: [6, 19, 6],
  rotationYRadians: 0,
  scale: [1, 1, 1],
  material: {
    baseColorResourceId: "base",
    normalResourceId: "normal",
    ormResourceId: "orm",
    baseColorFactor: [1, 1, 1],
    roughnessFactor: 1,
    metallicFactor: 0,
    normalScale: 1,
    ormHeight: { rangeMeters: [-0.0205, 0.0116], tileMeters: 4 },
  },
  lods: [
    { vertexResourceId: "vertex", indexResourceId: "index" },
    { vertexResourceId: "vertex", indexResourceId: "index" },
    { vertexResourceId: "vertex", indexResourceId: "index" },
  ],
};

function matrixOf(transform: Partial<PbrAssetPlacement>): Float64Array {
  const matrix = new Float64Array(16);
  writePbrAssetMatrix(matrix, 0, { ...placement, ...transform });
  return matrix;
}

function transform(matrix: Float64Array, local: readonly number[]): number[] {
  return [0, 1, 2].map(
    (row) =>
      (matrix[row] ?? 0) * (local[0] ?? 0) +
      (matrix[4 + row] ?? 0) * (local[1] ?? 0) +
      (matrix[8 + row] ?? 0) * (local[2] ?? 0) +
      (matrix[12 + row] ?? 0),
  );
}

describe("sun micro-shadowing (engine package 6)", () => {
  it("maps world displacements to the module's planar u = X/tile, v = Z/tile", () => {
    for (const pose of [
      { rotationYRadians: 0 },
      { rotationYRadians: Math.PI / 2 },
      { rotationYRadians: 0.7, scale: [2, 1, 2] as [number, number, number] },
    ]) {
      const matrix = matrixOf(pose);
      const surface = pbrMicroShadowSurfaceFromMatrix(matrix, 0.032, 4);
      const a = [0.3, 0.01, -1.1];
      const b = [-0.9, 0.02, 0.4];
      const [wa, wb] = [transform(matrix, a), transform(matrix, b)];
      const d = [0, 1, 2].map((axis) => (wb[axis] ?? 0) - (wa[axis] ?? 0));
      const dot = (g: readonly number[]) => d.reduce((sum, v, axis) => sum + v * (g[axis] ?? 0), 0);
      expect(dot(surface.gradientU)).toBeCloseTo(((b[0] ?? 0) - (a[0] ?? 0)) / 4, 9);
      expect(dot(surface.gradientV)).toBeCloseTo(((b[2] ?? 0) - (a[2] ?? 0)) / 4, 9);
    }
    // The canonical glTF-to-left-handed mirror: world +X runs toward -u at rotation 0.
    const surface = pbrMicroShadowSurfaceFromMatrix(matrixOf({}), 0.032, 4);
    expect([...surface.gradientU].map((v) => +v.toFixed(6))).toEqual([-0.25, 0, 0]);
    expect([...surface.gradientV].map((v) => +v.toFixed(6))).toEqual([0, 0, 0.25]);
    expect(() => pbrMicroShadowSurfaceFromMatrix(new Float64Array(16), 0.032, 4)).toThrow(
      /singular/,
    );
  });

  it("writes the sun, height range and gradients, and a zero range for surfaces without height", () => {
    const lighting = createPbrAmbientState();
    lighting.toSun.splice(0, 3, 0.866, 0.5, 0);
    const offsets = new Map([
      ["microShadowSun", 0],
      ["microShadowHeight", 16],
      ["microShadowU", 32],
      ["microShadowV", 48],
    ]);
    const data = new Float32Array(16).fill(9);
    const surface = pbrMicroShadowSurfaceFromMatrix(matrixOf({}), 0.032, 4);
    createPbrSunMicroShadowPlugin(lighting, surface).writeUbo?.(data, offsets);
    expect([...data.subarray(0, 4)].map((v) => +v.toFixed(3))).toEqual([0.866, 0.5, 0, 0]);
    expect(data[4]).toBeCloseTo(0.032, 6);
    expect([...data.subarray(8, 16)].map((v) => +v.toFixed(3))).toEqual([
      -0.25, 0, 0, 0, 0, 0, 0.25, 0,
    ]);
    createPbrSunMicroShadowPlugin(lighting, NO_PBR_MICROSHADOW_SURFACE).writeUbo?.(data, offsets);
    expect(data[4]).toBe(0);
  });

  it("takes derivatives in uniform control flow and shadows only the direct light", () => {
    const plugin = createPbrSunMicroShadowPlugin(
      createPbrAmbientState(),
      NO_PBR_MICROSHADOW_SURFACE,
    );
    expect(plugin.name).toBe(PBR_SUN_MICROSHADOW_PLUGIN_NAME);
    // Before the ambient plugin (default 500), which adds its own term afterwards.
    expect(plugin.priority).toBeLessThan(500);
    const code = plugin.getCustomCode?.("fragment")?.CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION;
    expect(code).toBeTypeOf("string");
    const wgsl = code ?? "";
    expect(wgsl.lastIndexOf("dpdx")).toBeLessThan(wgsl.indexOf("if("));
    expect(wgsl.lastIndexOf("dpdy")).toBeLessThan(wgsl.indexOf("if("));
    expect(wgsl).toContain("let msDirect=directDiffuse+directSpecular;");
    expect(wgsl).toContain("color-=msDirect*(1.0-msLit)*msFade;");
    expect(plugin.getCustomCode?.("vertex")).toBeNull();
  });
});

describe("CSM receiver normal offset and caster set (engine package 6)", () => {
  it("replaces Lite's stock receivers when the generator is created", () => {
    createDirectionalShadows({} as EngineContext, {} as DirectionalLight);
    expect(getCsmStdReceiverFactory()).toBe(createStdNormalOffsetCsmFragment);
    expect(getCsmPbrReceiverFactory()).toBe(createPbrNormalOffsetCsmFragment);
  });

  it("offsets each cascade lookup along the family's geometric normal", () => {
    const pbr = createPbrNormalOffsetCsmFragment([{ lightIndex: 1 }]);
    const std = createStdNormalOffsetCsmFragment([{ lightIndex: 1 }]);
    expect(Object.keys(pbr._fragmentSlots)).toEqual(["AS"]);
    expect(Object.keys(std._fragmentSlots)).toEqual(["AD"]);
    expect(pbr._fragmentSlots.AS).toContain("input.worldPos,1.0");
    expect(pbr._fragmentSlots.AS).toContain("normalize(N_geom)");
    expect(std._fragmentSlots.AD).toContain("normalize(normalW)");
    expect(pbr._helperFunctions).toContain(
      `texelWorld*${CSM_NORMAL_OFFSET_TEXELS.toFixed(3)}*sqrt(1.0-cosine*cosine)`,
    );
    // Both the selected cascade and its blend neighbour receive the normal.
    expect(pbr._helperFunctions).toContain("csmSample_1(idx,worldPos,normal)");
    expect(pbr._helperFunctions).toContain("csmSample_1(idx+1,worldPos,normal)");
    expect(pbr._bindings).toHaveLength(3);
  });

  it("leaves excluded relief out of the casters without mutating the caller's set", () => {
    calls.set.mockClear();
    const shadows = createDirectionalShadows({} as EngineContext, {} as DirectionalLight);
    const wall = { material: {} } as Mesh;
    const paving = { material: {} } as Mesh;
    const excluded = new Set<Mesh>();
    excludeFromCsmCasters(paving);
    shadows.synchronize([wall, paving], excluded);
    expect(calls.set.mock.calls[0]?.[1]).toEqual([wall]);
    expect(excluded.size).toBe(0);
    shadows.synchronize([wall, paving], excluded);
    expect(calls.set).toHaveBeenCalledTimes(1);
  });
});

describe("PBR placement contract for small-scale shadows", () => {
  it("accepts an ORM height range and rejects malformed ones or a read metallic channel", () => {
    expect(() => validatePbrAssetPlacements([placement])).not.toThrow();
    for (const ormHeight of [
      null,
      { rangeMeters: [0.01, 0.01], tileMeters: 4 },
      { rangeMeters: [0, 2], tileMeters: 4 },
      { rangeMeters: [0, Number.NaN], tileMeters: 4 },
      { rangeMeters: [0, 0.03], tileMeters: 0 },
      { rangeMeters: [0, 0.03] },
      { rangeMeters: [0, 0.03], tileMeters: 4, extra: 1 },
    ])
      expect(() =>
        validatePbrAssetPlacements([
          { ...placement, material: { ...placement.material, ormHeight } } as never,
        ]),
      ).toThrow(/ORM height/);
    expect(() =>
      validatePbrAssetPlacements([
        { ...placement, material: { ...placement.material, metallicFactor: 1 } },
      ]),
    ).toThrow(/ORM height/);
  });

  it("accepts only an explicit false CSM caster flag", () => {
    expect(() =>
      validatePbrAssetPlacements([{ ...placement, castsCsmShadows: false }]),
    ).not.toThrow();
    for (const castsCsmShadows of [true, 0, "false"])
      expect(() =>
        validatePbrAssetPlacements([{ ...placement, castsCsmShadows } as never]),
      ).toThrow(/CSM caster/);
  });

  it("groups height surfaces by orientation and every placement by its caster flag", () => {
    const groups = groupPbrAssetPlacements([
      placement,
      { ...placement, id: "b", position: [10, 19, 6] },
      { ...placement, id: "c", rotationYRadians: Math.PI / 2 },
      { ...placement, id: "d", castsCsmShadows: false },
    ]);
    expect(groups.map((group) => group.map(({ id }) => id))).toEqual([
      ["ground", "b"],
      ["c"],
      ["d"],
    ]);
  });
});
