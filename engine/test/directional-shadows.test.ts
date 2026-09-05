import type { DirectionalLight, EngineContext, Mesh, ShadowGenerator } from "@babylonjs/lite";
import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ set: vi.fn(), create: vi.fn(() => ({})) }));
vi.mock("@babylonjs/lite", () => ({
  createCsmDirectionalShadowGenerator: calls.create,
  setShadowTaskCasterMeshes: calls.set,
}));

import {
  createDirectionalShadows,
  DIRECTIONAL_SHADOW_CONFIG,
  pruneRetiredCasterMaterials,
} from "../src/render/directional-shadows";

describe("directional shadow residency", () => {
  it("releases retired material cache references without removing live shared materials", () => {
    const live = {} as Mesh["material"];
    const retired = {} as Mesh["material"];
    const views = new Map([
      [live, {}],
      [retired, {}],
    ]);
    const gens = new Map([
      [live, 0],
      [retired, 0],
    ]);
    const generator = {
      _shadowTaskState: { _materialViews: views, _casterMatGens: gens },
    } as unknown as ShadowGenerator;
    pruneRetiredCasterMaterials(generator, [
      { material: live } as Mesh,
      { material: live } as Mesh,
    ]);
    expect([...views.keys()]).toEqual([live]);
    expect([...gens.keys()]).toEqual([live]);
    expect(() =>
      pruneRetiredCasterMaterials({ _shadowTaskState: {} } as unknown as ShadowGenerator, []),
    ).toThrow(/changed shape/);
  });
  it("replaces caster identity on eviction and presentation changes, excluding hidden and UI meshes", () => {
    calls.set.mockClear();
    const sun = {} as DirectionalLight;
    const shadow = createDirectionalShadows({} as EngineContext, sun);
    // Lite treats an absent visibility override as visible.
    const preview = {} as Mesh;
    const streamed = { visible: false } as Mesh;
    const ui = { visible: true } as Mesh;
    const excluded = new Set([ui]);
    shadow.synchronize([preview, streamed, ui], excluded);
    const first = calls.set.mock.calls[0]?.[1];
    expect(first).toEqual([preview]);
    shadow.synchronize([preview, streamed, ui], excluded);
    expect(calls.set).toHaveBeenCalledTimes(1);
    preview.visible = false;
    streamed.visible = true;
    shadow.synchronize([preview, streamed, ui], excluded);
    expect(calls.set.mock.calls[1]?.[1]).toEqual([streamed]);
    expect(first).toEqual([preview]);
    shadow.synchronize([preview, ui], excluded);
    expect(calls.set.mock.calls[2]?.[1]).toEqual([]);
    expect(shadow.snapshot()).toMatchObject({
      casterCount: 0,
      membershipUpdates: 3,
      depthArrayBytes: 16_777_216,
    });
    expect(calls.create).toHaveBeenLastCalledWith({}, sun, DIRECTIONAL_SHADOW_CONFIG);
  });
});
