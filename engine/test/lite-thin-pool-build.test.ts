import { type Mesh, setThinInstanceCount, setThinInstances } from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import { buildThinPoolInBuiltGroup } from "../src/render/lite-thin-pool-build";

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

describe("buildThinPoolInBuiltGroup", () => {
  it("clears the runtime thin-instance hook the pinned Lite installs", () => {
    // A bare object carries only what the thin-instance setters touch.
    const mesh = {} as Mesh;
    setThinInstances(mesh, new Float32Array(IDENTITY), 1);
    setThinInstanceCount(mesh, 1);
    expect(typeof (mesh as unknown as { _runtimeThinBuild?: unknown })._runtimeThinBuild).toBe(
      "function",
    );
    buildThinPoolInBuiltGroup(mesh);
    expect("_runtimeThinBuild" in mesh).toBe(false);
    expect(mesh.thinInstances?.count).toBe(1);
  });

  it("fails loudly when Lite no longer installs the hook", () => {
    expect(() => buildThinPoolInBuiltGroup({} as Mesh)).toThrow(/runtime thin-instance build hook/);
  });
});
