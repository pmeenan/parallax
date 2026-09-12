import assert from "node:assert/strict";

// These are the supported source subset, checked only AFTER Khronos schema/binary QA.
export interface AnimationGlb {
  asset: { version: string };
  buffers: { byteLength: number; uri?: string }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  accessors: {
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
    normalized?: boolean;
    sparse?: unknown;
  }[];
  nodes: {
    name: string;
    children?: number[];
    mesh?: number;
    skin?: number;
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    matrix?: number[];
  }[];
  skins: { joints: number[]; skeleton?: number; inverseBindMatrices?: number }[];
  meshes: {
    primitives: {
      attributes: Record<string, number>;
      indices?: number;
      mode?: number;
      targets?: unknown[];
    }[];
  }[];
  scenes: { nodes: number[] }[];
  scene?: number;
  animations: {
    name: string;
    channels: { sampler: number; target: { node: number; path: string } }[];
    samplers: { input: number; output: number; interpolation?: string }[];
  }[];
  images?: { uri?: string }[];
  extensionsUsed?: string[];
}

export function readAnimationGlb(bytes: Uint8Array): { json: unknown; binary: Uint8Array } {
  assert(bytes.byteLength >= 28, "GLB header is truncated");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67, "Expected a GLB source");
  assert.equal(view.getUint32(4, true), 2, "Expected GLB v2");
  assert.equal(view.getUint32(8, true), bytes.byteLength, "GLB byte length mismatch");
  const chunks: { type: number; bytes: Uint8Array }[] = [];
  for (let offset = 12; offset < bytes.byteLength; ) {
    assert(offset + 8 <= bytes.byteLength, "Truncated GLB chunk header");
    const size = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    assert(size % 4 === 0 && offset + 8 + size <= bytes.byteLength, "Invalid GLB chunk range");
    chunks.push({ type, bytes: bytes.subarray(offset + 8, offset + 8 + size) });
    offset += 8 + size;
  }
  assert(
    chunks.length === 2 && chunks[0]?.type === 0x4e4f534a && chunks[1]?.type === 0x004e4942,
    "Source GLB requires one JSON chunk and one embedded BIN chunk",
  );
  return {
    json: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(chunks[0].bytes)) as unknown,
    binary: chunks[1].bytes,
  };
}

export function readAccessor(
  document: AnimationGlb,
  binary: Uint8Array,
  index: number,
): number[][] {
  const accessor = document.accessors[index];
  assert(
    accessor && accessor.bufferView !== undefined && accessor.sparse === undefined,
    `Accessor ${index}: source profile requires dense, backed accessors`,
  );
  const bufferView = document.bufferViews[accessor.bufferView];
  assert(bufferView && bufferView.buffer === 0, `Accessor ${index}: invalid buffer view`);
  const componentBytes = ({ 5121: 1, 5123: 2, 5125: 4, 5126: 4 } as Record<number, number>)[
    accessor.componentType
  ];
  const components = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<string, number>)[
    accessor.type
  ];
  assert(componentBytes && components, `Accessor ${index}: unsupported component layout`);
  const stride = bufferView.byteStride ?? componentBytes * components;
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const end = start + (accessor.count - 1) * stride + componentBytes * components;
  assert(
    end <= binary.byteLength && end <= (bufferView.byteOffset ?? 0) + bufferView.byteLength,
    `Accessor ${index}: binary range overflow`,
  );
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  return Array.from({ length: accessor.count }, (_, row) =>
    Array.from({ length: components }, (_, column) => {
      const offset = start + row * stride + column * componentBytes;
      let value =
        accessor.componentType === 5126
          ? view.getFloat32(offset, true)
          : accessor.componentType === 5125
            ? view.getUint32(offset, true)
            : accessor.componentType === 5123
              ? view.getUint16(offset, true)
              : view.getUint8(offset);
      if (accessor.normalized) value /= accessor.componentType === 5121 ? 255 : 65535;
      assert(Number.isFinite(value), `Accessor ${index}: non-finite sample`);
      return value;
    }),
  );
}

export function vectorDistance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(...a.map((value, index) => value - (b[index] ?? 0)));
}

export function rotationDistance(a: readonly number[], b: readonly number[]): number {
  // q and -q denote the same orientation; normalization avoids float-roundoff bias.
  const dot = a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
  return 2 * Math.acos(Math.min(1, Math.abs(dot) / (Math.hypot(...a) * Math.hypot(...b))));
}
