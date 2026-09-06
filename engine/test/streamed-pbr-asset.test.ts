import {
  acquireTexture,
  createTransformNode,
  type EngineContext,
  enableThinInstanceDynamicDrawCount,
  type Mesh,
  releaseTexture,
  setThinInstanceCount,
  setThinInstances,
} from "@babylonjs/lite";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // WebGPU enum values for the native buffer helper under Node's fake device.
  vi.stubGlobal("GPUBufferUsage", { VERTEX: 32, COPY_DST: 8, STORAGE: 128, INDIRECT: 256 });
});

import {
  groupPbrAssetPlacements,
  selectPbrAssetLod,
  uploadStreamedPbrTexture,
  withPbrTextureAddressMode,
} from "../src/render/streamed-pbr-asset";
import type { PbrAssetPlacement } from "../src/world/pbr-asset";
import { writePbrAssetMatrix } from "../src/world/pbr-asset-transform";

function fixture() {
  const texture = { createView: vi.fn(() => ({})), destroy: vi.fn() };
  const device = {
    createTexture: vi.fn((_descriptor: unknown) => texture),
    createSampler: vi.fn((_descriptor: unknown) => ({})),
    queue: { writeTexture: vi.fn((..._args: unknown[]) => {}) },
  };
  return { texture, device, engine: { _device: device } as unknown as EngineContext };
}

describe("installed PBR surface upload", () => {
  it("matches Lite's rigid tilted transform for packaging bounds and native instance matrices", () => {
    const placement = {
      position: [6, 19, 8],
      scale: [1.04, 1.04, 1.04],
      rotationXRadians: 0.12,
      rotationYRadians: 1.7,
      rotationZRadians: -0.08,
    } as const;
    const node = createTransformNode("tilted");
    node.position.set(...placement.position);
    node.rotation.set(
      placement.rotationXRadians,
      placement.rotationYRadians,
      placement.rotationZRadians,
    );
    node.scaling.set(-placement.scale[0], placement.scale[1], placement.scale[2]);
    const matrix = new Float32Array(16);
    writePbrAssetMatrix(matrix, 0, placement);
    for (let i = 0; i < 16; i += 1) expect(matrix[i]).toBeCloseTo(node.worldMatrix[i] ?? 0, 5);
    expect(Array.from(matrix.slice(12, 15))).toEqual([6, 19, 8]);
  });
  it("groups compatible stone instances while preserving variant and material boundaries", () => {
    const a: PbrAssetPlacement = {
      schemaVersion: 1,
      id: "a",
      position: [0, 0, 0],
      scale: [1, 1, 1],
      rotationYRadians: 0,
      material: {
        baseColorResourceId: "base",
        normalResourceId: "normal",
        ormResourceId: "orm",
        baseColorFactor: [1, 1, 1],
        roughnessFactor: 1,
        metallicFactor: 0,
        normalScale: 1,
      },
      lodDistancesMeters: [12, 32],
      lods: [0, 1, 2].map((i) => ({
        vertexResourceId: `v${i}`,
        indexResourceId: `i${i}`,
      })) as unknown as PbrAssetPlacement["lods"],
    };
    const b = { ...a, id: "b", rotationXRadians: 0.1, position: [2, 0, 0] as const };
    const c = {
      ...a,
      id: "c",
      material: { ...a.material, baseColorFactor: [0.8, 0.8, 0.8] as const },
    };
    const groups = groupPbrAssetPlacements([a, b, c]);
    expect(groups.map((g) => g.map((p) => p.id))).toEqual([["a", "b"], ["c"]]);
  });
  it("uses fixed-capacity native indirect draws when LOD bucket counts change", async () => {
    // Exact-pin native helper verifies buffer writes behind cached render bundles.
    // @ts-expect-error Lite private implementation does not ship declarations.
    const native = await import("../node_modules/@babylonjs/lite/lib/mesh/thin-instance-gpu.js");
    const buffers: { size: number; destroy: ReturnType<typeof vi.fn> }[] = [];
    const writes: number[][] = [];
    const engine = {
      _device: {
        createBuffer: ({ size }: { size: number }) => {
          const b = { size, destroy: vi.fn() };
          buffers.push(b);
          return b;
        },
        queue: {
          writeBuffer: (
            buffer: { size: number },
            _offset: number,
            data: ArrayBuffer,
            byteOffset: number,
            bytes: number,
          ) => {
            if (buffer.size === 20)
              writes.push(Array.from(new Uint32Array(data, byteOffset, bytes / 4)));
          },
        },
      },
    } as unknown as EngineContext;
    const mesh = createTransformNode("pool") as Mesh;
    setThinInstances(mesh, new Float32Array(3 * 16), 3);
    enableThinInstanceDynamicDrawCount(mesh);
    const first = native.syncThinInstanceForDraw(engine, mesh.thinInstances, false, 90);
    setThinInstanceCount(mesh, 1);
    expect(native.syncThinInstanceForDraw(engine, mesh.thinInstances, false, 90)).toBe(first);
    setThinInstanceCount(mesh, 0);
    native.syncThinInstanceForDraw(engine, mesh.thinInstances, false, 90);
    expect(buffers.map((b) => b.size)).toEqual([192, 20]);
    expect(writes.map((args) => args[1])).toEqual([3, 1, 0]);
  });
  it("shares GPU bytes across finite and periodic bindings with independent renderable references", () => {
    const { engine, device, texture } = fixture();
    const base = uploadStreamedPbrTexture(
      engine,
      [{ width: 1, height: 1, rgba: new ArrayBuffer(4) }],
      false,
    ).texture;
    const periodic = withPbrTextureAddressMode(engine, base, "repeat");
    expect(withPbrTextureAddressMode(engine, base)).toBe(base);
    expect(periodic.texture).toBe(base.texture);
    expect(periodic.view).toBe(base.view);
    expect(periodic.sampler).not.toBe(base.sampler);
    expect(device.createTexture).toHaveBeenCalledOnce();
    expect(device.createSampler).toHaveBeenLastCalledWith(
      expect.objectContaining({ addressModeU: "repeat", addressModeV: "repeat" }),
    );
    // Reproduce Lite PBR renderable's acquired texture lifetime for both bindings.
    acquireTexture(base);
    acquireTexture(periodic);
    releaseTexture(base);
    releaseTexture(base);
    expect(texture.destroy).not.toHaveBeenCalled();
    releaseTexture(periodic);
    expect(texture.destroy).toHaveBeenCalledOnce();
  });
  it("converts canonical RH surface winding to Lite LH before rotating and placing it", () => {
    const matrix = new Float32Array(16);
    writePbrAssetMatrix(matrix, 0, {
      position: [6, 19, 6],
      scale: [2, 1, 3],
      rotationYRadians: Math.PI / 2,
    });
    const m = (index: number) => matrix[index] ?? 0;
    const transform = ([x, y, z]: readonly [number, number, number]): [number, number, number] => [
      m(0) * x + m(4) * y + m(8) * z + m(12),
      m(1) * x + m(5) * y + m(9) * z + m(13),
      m(2) * x + m(6) * y + m(10) * z + m(14),
    ];
    // glTF's upward CCW face has +Y geometric cross product. Lite's left-handed
    // view requires the reflected face's negative cross product, with +Y normals.
    const a = transform([0, 0, 0]),
      b = transform([0, 0, 1]),
      c = transform([1, 0, 0]);
    const crossY = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    expect(a).toEqual([6, 19, 6]);
    expect(crossY).toBeCloseTo(-6);
    expect(matrix[5]).toBe(1);
  });
  it("preserves all authored mips, color-space role and cache-owned texture lifetime", () => {
    const { engine, device, texture } = fixture();
    const levels = [4, 2, 1].map((width) => ({
      width,
      height: width,
      rgba: new ArrayBuffer(width * width * 4),
    }));
    const uploaded = uploadStreamedPbrTexture(engine, levels, true);
    expect(uploaded.gpuBytes).toBe(84);
    expect(device.createTexture.mock.calls[0]?.[0]).toMatchObject({
      format: "rgba8unorm-srgb",
      mipLevelCount: 3,
    });
    expect(device.queue.writeTexture).toHaveBeenCalledTimes(3);
    expect(device.createSampler).toHaveBeenCalledWith({
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      minFilter: "linear",
      magFilter: "linear",
      mipmapFilter: "linear",
      maxAnisotropy: 8,
    });
    expect(device.queue.writeTexture.mock.calls.map((call) => call[0])).toEqual(
      [0, 1, 2].map((mipLevel) => ({ texture, mipLevel })),
    );
    expect(texture.destroy).not.toHaveBeenCalled();
    releaseTexture(uploaded.texture);
    expect(texture.destroy).toHaveBeenCalledOnce();
    const linear = fixture();
    uploadStreamedPbrTexture(linear.engine, levels, false);
    expect(linear.device.createTexture.mock.calls[0]?.[0]).toMatchObject({ format: "rgba8unorm" });
  });
  it("rejects a missing final mip before allocating GPU memory", () => {
    const { engine, device } = fixture();
    expect(() =>
      uploadStreamedPbrTexture(engine, [{ width: 2, height: 2, rgba: new ArrayBuffer(16) }], false),
    ).toThrow("complete authored mip chain");
    expect(device.createTexture).not.toHaveBeenCalled();
  });
  it("destroys a texture whose upload fails before cache ownership transfers", () => {
    const { engine, device, texture } = fixture();
    device.queue.writeTexture.mockImplementation(() => {
      throw new Error("upload failed");
    });
    expect(() =>
      uploadStreamedPbrTexture(engine, [{ width: 1, height: 1, rgba: new ArrayBuffer(4) }], false),
    ).toThrow("upload failed");
    expect(texture.destroy).toHaveBeenCalledOnce();
  });
  it("holds LOD around each boundary while allowing large observer jumps", () => {
    expect(selectPbrAssetLod(12.5, [12, 32], 0)).toBe(0);
    expect(selectPbrAssetLod(11.5, [12, 32], 1)).toBe(1);
    expect(selectPbrAssetLod(10, [12, 32], 1)).toBe(0);
    expect(selectPbrAssetLod(31, [12, 32], 2)).toBe(2);
    expect(selectPbrAssetLod(50, [12, 32], 0)).toBe(2);
    expect(selectPbrAssetLod(2, [12, 32], 2)).toBe(0);
  });
});
