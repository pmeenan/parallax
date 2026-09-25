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
  vi.stubGlobal("GPUBufferUsage", {
    INDEX: 16,
    VERTEX: 32,
    COPY_SRC: 4,
    COPY_DST: 8,
    STORAGE: 128,
    INDIRECT: 256,
  });
});

import {
  createStreamedPbrGeometry,
  disposeStreamedPbrGeometry,
  groupPbrAssetPlacements,
  selectPbrAssetLod,
  uploadStreamedPbrTexture,
  withPbrTextureAddressMode,
} from "../src/render/streamed-pbr-asset";
import type { PbrAssetPlacement } from "../src/world/pbr-asset";
import { writePbrAssetMatrix } from "../src/world/pbr-asset-transform";

function fixture(features: readonly string[] = ["texture-compression-bc"]) {
  const texture = { createView: vi.fn(() => ({})), destroy: vi.fn() };
  const device = {
    features: new Set(features),
    createTexture: vi.fn((_descriptor: unknown) => texture),
    createSampler: vi.fn((_descriptor: unknown) => ({})),
    queue: { writeTexture: vi.fn((..._args: unknown[]) => {}) },
  };
  return { texture, device, engine: { _device: device } as unknown as EngineContext };
}

function geometryFixture() {
  const buffers: {
    descriptor: GPUBufferDescriptor;
    bytes: Uint8Array;
    destroy: ReturnType<typeof vi.fn>;
  }[] = [];
  const device = {
    limits: { maxBufferSize: 1 << 30, maxVertexBufferArrayStride: 2048 },
    createBuffer: vi.fn((descriptor: GPUBufferDescriptor) => {
      const bytes = new Uint8Array(descriptor.size);
      const buffer = {
        descriptor,
        bytes,
        destroy: vi.fn(),
        getMappedRange: () => bytes.buffer,
        unmap: vi.fn(),
      };
      buffers.push(buffer);
      return buffer;
    }),
  };
  return { buffers, device, engine: { _device: device } as unknown as EngineContext };
}

describe("streamed PBR geometry", () => {
  const attributes = new Float32Array([
    0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, 0, 1, 0, 0, 1,
  ]);
  const vertices = {
    attributes: attributes.buffer,
    vertexCount: 3,
    boundMin: [0, 0, 0] as const,
    boundMax: [1, 2, 1] as const,
  };
  const indices = { indices: new Uint32Array([0, 1, 2]).buffer, indexCount: 3 };

  it("draws the decoded slab in place with decode-worker bounds and no CPU copies", () => {
    const { buffers, engine } = geometryFixture();
    const geometry = createStreamedPbrGeometry(engine, "slab", vertices, indices);
    const [vertexBuffer, indexBuffer] = buffers;
    expect(buffers).toHaveLength(2);
    expect(vertexBuffer?.descriptor).toMatchObject({ size: 96, usage: 128 | 32 | 8 });
    expect(indexBuffer?.descriptor).toMatchObject({ size: 12, usage: 128 | 16 | 8 });
    expect(Array.from(new Float32Array(vertexBuffer?.bytes.buffer ?? new ArrayBuffer(0)))).toEqual(
      Array.from(attributes),
    );
    expect(Array.from(new Uint32Array(indexBuffer?.bytes.buffer ?? new ArrayBuffer(0)))).toEqual([
      0, 1, 2,
    ]);
    const gpu = (geometry.mesh as unknown as { _gpu: Record<string, unknown> })._gpu;
    expect(gpu).toMatchObject({
      positionBuffer: vertexBuffer,
      normalBuffer: vertexBuffer,
      uvBuffer: vertexBuffer,
      indexBuffer,
      indexCount: 3,
      indexFormat: "uint32",
      _vbKey: "sb32.0.12.24.-.-.-",
    });
    expect(geometry.mesh.boundMin).toEqual([0, 0, 0]);
    expect(geometry.mesh.boundMax).toEqual([1, 2, 1]);
    expect(geometry.gpuBytes).toBe(108);
    expect("_cpuPositions" in geometry.mesh).toBe(false);

    disposeStreamedPbrGeometry(geometry);
    expect(vertexBuffer?.destroy).toHaveBeenCalledOnce();
    expect(indexBuffer?.destroy).toHaveBeenCalledOnce();
  });
  it("rejects mismatched payload shapes before allocating GPU memory", () => {
    const { device, engine } = geometryFixture();
    for (const [v, i] of [
      [{ ...vertices, vertexCount: 4 }, indices],
      [vertices, { ...indices, indexCount: 6 }],
      [vertices, { indices: new Uint32Array([0, 1]).buffer, indexCount: 2 }],
    ] as const) {
      expect(() => createStreamedPbrGeometry(engine, "bad", v, i)).toThrow(/is invalid/);
    }
    expect(device.createBuffer).not.toHaveBeenCalled();
  });
});

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
      [{ width: 1, height: 1, data: new Uint8Array(4) }],
      "rgba8",
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
      data: new Uint8Array(width * width * 4),
    }));
    const uploaded = uploadStreamedPbrTexture(engine, levels, "rgba8", true);
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
    uploadStreamedPbrTexture(linear.engine, levels, "rgba8", false);
    expect(linear.device.createTexture.mock.calls[0]?.[0]).toMatchObject({ format: "rgba8unorm" });
  });
  it("uploads BC7 mip chains as whole block rows and requires the BC feature", () => {
    const { engine, device } = fixture();
    const levels = [8, 4, 2, 1].map((width) => ({
      width,
      height: width,
      data: new Uint8Array(Math.ceil(width / 4) ** 2 * 16),
    }));
    const uploaded = uploadStreamedPbrTexture(engine, levels, "bc7", true);
    expect(uploaded.gpuBytes).toBe(64 + 16 + 16 + 16);
    expect(device.createTexture.mock.calls[0]?.[0]).toMatchObject({
      format: "bc7-rgba-unorm-srgb",
      mipLevelCount: 4,
      size: { width: 8, height: 8 },
    });
    expect(device.queue.writeTexture.mock.calls.map((call) => [call[2], call[3]])).toEqual([
      [
        { bytesPerRow: 32, rowsPerImage: 2 },
        { width: 8, height: 8 },
      ],
      ...[4, 2, 1].map(() => [
        { bytesPerRow: 16, rowsPerImage: 1 },
        { width: 4, height: 4 },
      ]),
    ]);
    const linear = fixture();
    uploadStreamedPbrTexture(linear.engine, levels, "bc7", false);
    expect(linear.device.createTexture.mock.calls[0]?.[0]).toMatchObject({
      format: "bc7-rgba-unorm",
    });
    const rgbaSized = levels.map((level) => ({
      ...level,
      data: new Uint8Array(level.width * level.width * 4),
    }));
    expect(() => uploadStreamedPbrTexture(engine, rgbaSized, "bc7", true)).toThrow(
      "mip dimensions or byte length",
    );
    const noBc = fixture([]);
    expect(() => uploadStreamedPbrTexture(noBc.engine, levels, "bc7", true)).toThrow(
      "texture-compression-bc",
    );
    expect(noBc.device.createTexture).not.toHaveBeenCalled();
  });
  it("uploads pre-encoded BC1 chains as 8-byte block rows", () => {
    const { engine, device } = fixture();
    const levels = [8, 4, 2, 1].map((width) => ({
      width,
      height: width,
      data: new Uint8Array(Math.ceil(width / 4) ** 2 * 8),
    }));
    const uploaded = uploadStreamedPbrTexture(engine, levels, "bc1", true);
    expect(uploaded.gpuBytes).toBe(32 + 8 + 8 + 8);
    expect(device.createTexture.mock.calls[0]?.[0]).toMatchObject({
      format: "bc1-rgba-unorm-srgb",
      mipLevelCount: 4,
    });
    expect(device.queue.writeTexture.mock.calls.map((call) => call[2])).toEqual([
      { bytesPerRow: 16, rowsPerImage: 2 },
      { bytesPerRow: 8, rowsPerImage: 1 },
      { bytesPerRow: 8, rowsPerImage: 1 },
      { bytesPerRow: 8, rowsPerImage: 1 },
    ]);
    expect(() => uploadStreamedPbrTexture(fixture([]).engine, levels, "bc1", true)).toThrow(
      "texture-compression-bc",
    );
  });
  it("rejects a missing final mip before allocating GPU memory", () => {
    const { engine, device } = fixture();
    expect(() =>
      uploadStreamedPbrTexture(
        engine,
        [{ width: 2, height: 2, data: new Uint8Array(16) }],
        "rgba8",
        false,
      ),
    ).toThrow("complete authored mip chain");
    expect(device.createTexture).not.toHaveBeenCalled();
  });
  it("destroys a texture whose upload fails before cache ownership transfers", () => {
    const { engine, device, texture } = fixture();
    device.queue.writeTexture.mockImplementation(() => {
      throw new Error("upload failed");
    });
    expect(() =>
      uploadStreamedPbrTexture(
        engine,
        [{ width: 1, height: 1, data: new Uint8Array(4) }],
        "rgba8",
        false,
      ),
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
