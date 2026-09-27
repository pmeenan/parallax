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
} from "../src/render/pbr-sun-microshadow";
import { groupPbrAssetPlacements } from "../src/render/streamed-pbr-asset";
import { type PbrAssetPlacement, validatePbrAssetPlacements } from "../src/world/pbr-asset";

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
    ormHeight: { rangeMeters: [-0.0205, 0.0116] },
  },
  lods: [
    { vertexResourceId: "vertex", indexResourceId: "index" },
    { vertexResourceId: "vertex", indexResourceId: "index" },
    { vertexResourceId: "vertex", indexResourceId: "index" },
  ],
};

describe("sun micro-shadowing (engine package 6)", () => {
  it("recovers the texture gradient per fragment on any plane, UV layout and handedness", () => {
    // The WGSL: grad = (cross(dpY,N) duv/dx + cross(N,dpX) duv/dy) / dot(dpX, cross(dpY,N)).
    const cross = (a: number[], b: number[]) => [
      (a[1] ?? 0) * (b[2] ?? 0) - (a[2] ?? 0) * (b[1] ?? 0),
      (a[2] ?? 0) * (b[0] ?? 0) - (a[0] ?? 0) * (b[2] ?? 0),
      (a[0] ?? 0) * (b[1] ?? 0) - (a[1] ?? 0) * (b[0] ?? 0),
    ];
    const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);
    const normalize = (a: number[]) => a.map((v) => v / Math.hypot(...a));
    // A vertical wall (u along +X at 1/2 per metre, v down its face) and a mirrored, rotated
    // atlas island on a tilted plane; screen derivatives are arbitrary independent steps.
    for (const [tangent, bitangent, uPerMeter, vPerMeter] of [
      [[1, 0, 0], [0, -1, 0], 0.5, 1 / 2.58],
      [normalize([0.3, 0.2, -0.9]), normalize([0.95, 0, 0.3167]), -1 / 12.3, 1 / 6.7],
    ] as const) {
      const normal = normalize(cross([...tangent], [...bitangent]));
      const uvAt = (p: number[]) => [
        dot(p, [...tangent]) * uPerMeter,
        dot(p, [...bitangent]) * vPerMeter,
      ];
      const dpX = [0.0003, 0.0001, -0.0002].map((v, i) => v + 0.0004 * (tangent[i] ?? 0));
      const dpY = [0.0001, -0.0002, 0.0003].map((v, i) => v + 0.0003 * (bitangent[i] ?? 0));
      // Keep the steps in the plane, as screen derivatives of a planar triangle are.
      const inPlane = (d: number[]) => d.map((v, i) => v - dot(d, normal) * (normal[i] ?? 0));
      const [x, y] = [inPlane(dpX), inPlane(dpY)];
      const [duvX, duvY] = [uvAt(x), uvAt(y)];
      const perpY = cross(y, normal);
      const perpX = cross(normal, x);
      const det = dot(x, perpY);
      const direction = normalize(inPlane([0.7, -0.1, 0.4]));
      const uvPerMeter = [0, 1].map(
        (k) =>
          (dot(direction, perpY) * (duvX[k] ?? 0) + dot(direction, perpX) * (duvY[k] ?? 0)) / det,
      );
      const expected = uvAt(direction);
      expect(uvPerMeter[0]).toBeCloseTo(expected[0] ?? 0, 9);
      expect(uvPerMeter[1]).toBeCloseTo(expected[1] ?? 0, 9);
    }
    const wgsl =
      createPbrSunMicroShadowPlugin(
        createPbrAmbientState(),
        NO_PBR_MICROSHADOW_SURFACE,
      ).getCustomCode?.("fragment")?.CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION ?? "";
    expect(wgsl).toContain("let msPerpY=cross(msDpY,N_geom);");
    expect(wgsl).toContain("let msPerpX=cross(N_geom,msDpX);");
    expect(wgsl).toContain("let msDet=dot(msDpX,msPerpY);");
    expect(wgsl).toContain(
      "let msUvPerMeter=(dot(msDir,msPerpY)*msDuvX+dot(msDir,msPerpX)*msDuvY)/msDet;",
    );
  });

  it("writes the sun and height range, and a zero range for surfaces without height", () => {
    const lighting = createPbrAmbientState();
    lighting.toSun.splice(0, 3, 0.866, 0.5, 0);
    const offsets = new Map([
      ["microShadowSun", 0],
      ["microShadowHeight", 16],
    ]);
    const data = new Float32Array(8).fill(9);
    createPbrSunMicroShadowPlugin(lighting, { heightRangeMeters: 0.032 }).writeUbo?.(data, offsets);
    expect([...data.subarray(0, 4)].map((v) => +v.toFixed(3))).toEqual([0.866, 0.5, 0, 0]);
    expect(data[4]).toBeCloseTo(0.032, 6);
    createPbrSunMicroShadowPlugin(lighting, NO_PBR_MICROSHADOW_SURFACE).writeUbo?.(data, offsets);
    expect(data[4]).toBe(0);
    expect(
      createPbrSunMicroShadowPlugin(lighting, NO_PBR_MICROSHADOW_SURFACE)
        .getUniforms?.()
        ?.ubo?.map((u) => u.name),
    ).toEqual(["microShadowSun", "microShadowHeight"]);
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
      { rangeMeters: [0.01, 0.01] },
      { rangeMeters: [0, 2] },
      { rangeMeters: [0, Number.NaN] },
      { rangeMeters: [0, 0.03], tileMeters: 4 },
      { rangeMeters: [0, 0.03], extra: 1 },
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

  it("groups height surfaces by range, not orientation, and every placement by its caster flag", () => {
    const groups = groupPbrAssetPlacements([
      placement,
      { ...placement, id: "b", position: [10, 19, 6] },
      { ...placement, id: "c", rotationYRadians: Math.PI / 2 },
      { ...placement, id: "d", castsCsmShadows: false },
      {
        ...placement,
        id: "e",
        material: { ...placement.material, ormHeight: { rangeMeters: [-0.01, 0.03] } },
      },
    ]);
    expect(groups.map((group) => group.map(({ id }) => id))).toEqual([
      ["ground", "b", "c"],
      ["d"],
      ["e"],
    ]);
  });
});
