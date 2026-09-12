import { sha256 } from "./animation-validation.ts";

/** Original mathematical test data: a skinned quad and two joints, never library content. */
export function createAnimationFixture() {
  const binaryParts: Buffer[] = [];
  const bufferViews: { buffer: number; byteOffset: number; byteLength: number }[] = [];
  const accessors: {
    bufferView: number;
    componentType: number;
    count: number;
    type: string;
    min?: number[];
    max?: number[];
  }[] = [];
  let binaryLength = 0;
  const accessor = (
    values: number[],
    width: number,
    type: string,
    componentType = 5126,
    bounds = false,
  ): number => {
    const padding = (4 - (binaryLength % 4)) % 4;
    if (padding > 0) {
      binaryParts.push(Buffer.alloc(padding));
      binaryLength += padding;
    }
    const data = Buffer.alloc(values.length * (componentType === 5126 ? 4 : 2));
    values.forEach((value, i) => {
      if (componentType === 5126) data.writeFloatLE(value, i * 4);
      else data.writeUInt16LE(value, i * 2);
    });
    const view = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: data.length });
    binaryParts.push(data);
    binaryLength += data.length;
    const descriptor = {
      bufferView: view,
      componentType,
      count: values.length / width,
      type,
      ...(bounds
        ? {
            min: Array.from({ length: width }, (_, k) =>
              Math.min(...values.filter((_, i) => i % width === k)),
            ),
            max: Array.from({ length: width }, (_, k) =>
              Math.max(...values.filter((_, i) => i % width === k)),
            ),
          }
        : {}),
    };
    accessors.push(descriptor);
    return accessors.length - 1;
  };
  const position = accessor(
    [-0.25, 0, 0, 0.25, 0, 0, -0.25, 1, 0, 0.25, 1, 0],
    3,
    "VEC3",
    5126,
    true,
  );
  const normal = accessor([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3, "VEC3");
  const joints = accessor([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4, "VEC4", 5123);
  const weights = accessor([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4, "VEC4");
  const indices = accessor([0, 1, 2, 2, 1, 3], 1, "SCALAR", 5123);
  const bind = accessor(
    [
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -0.5,
      0, 1,
    ],
    16,
    "MAT4",
  );
  const times = accessor([0, 0.5, 1], 1, "SCALAR", 5126, true);
  const rotations = accessor(
    [0, 0, 0, 1, 0, 0, Math.sin(0.3), Math.cos(0.3), 0, 0, 0, 1],
    4,
    "VEC4",
  );
  const idle = accessor([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], 4, "VEC4");
  const json = {
    asset: { version: "2.0", generator: "Parallax original animation QA fixture v1" },
    scene: 0,
    scenes: [{ nodes: [0, 2] }],
    nodes: [
      { name: "Root", children: [1] },
      { name: "Tip", translation: [0, 0.5, 0] },
      { name: "Body", mesh: 0, skin: 0 },
    ],
    skins: [{ name: "TestRig", joints: [0, 1], skeleton: 0, inverseBindMatrices: bind }],
    materials: [
      {
        name: "Diagnostic matte",
        pbrMetallicRoughness: {
          baseColorFactor: [0.8, 0.5, 0.2, 1],
          metallicFactor: 0,
          roughnessFactor: 1,
        },
        doubleSided: true,
      },
    ],
    meshes: [
      {
        primitives: [
          {
            material: 0,
            attributes: {
              POSITION: position,
              NORMAL: normal,
              JOINTS_0: joints,
              WEIGHTS_0: weights,
            },
            indices,
          },
        ],
      },
    ],
    animations: [
      {
        name: "Idle",
        samplers: [{ input: times, output: idle, interpolation: "LINEAR" }],
        channels: [{ sampler: 0, target: { node: 1, path: "rotation" } }],
      },
      {
        name: "Walk",
        samplers: [{ input: times, output: rotations, interpolation: "LINEAR" }],
        channels: [{ sampler: 0, target: { node: 1, path: "rotation" } }],
      },
      {
        name: "Attack",
        samplers: [{ input: times, output: rotations, interpolation: "STEP" }],
        channels: [{ sampler: 0, target: { node: 1, path: "rotation" } }],
      },
    ],
    buffers: [{ byteLength: binaryLength }],
    bufferViews,
    accessors,
  };
  const binary = Buffer.concat(binaryParts);
  const profile = {
    schemaVersion: 1,
    assetId: "animation-qa-fixture",
    rootNode: "Root",
    clips: [
      { name: "Idle", role: "idle", loop: true, rootMotion: "in-place" },
      { name: "Walk", role: "locomotion", loop: true, rootMotion: "in-place" },
      { name: "Attack", role: "combat", loop: false, rootMotion: "in-place" },
    ],
    provenance: {
      sourceSha256: sha256(encodeFixtureGlb(json, binary)),
      author: "Parallax test fixture",
      license: "Apache-2.0",
      rightsReviewed: true,
      references: ["mathematical two-joint QA specification"],
      lineage: "Original procedural test geometry and motion; no provider or third-party artwork.",
    },
  };
  return {
    json,
    binary,
    profile,
    positionsId: position,
    weightsId: weights,
    timesId: times,
    rotationsId: rotations,
    bindId: bind,
  };
}

export function encodeFixtureGlb(json: unknown, binary: Uint8Array): Buffer {
  const source = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.alloc(Math.ceil(source.length / 4) * 4, 0x20);
  source.copy(jsonChunk);
  const binChunk = Buffer.alloc(Math.ceil(binary.length / 4) * 4);
  binChunk.set(binary);
  const bytes = Buffer.alloc(28 + jsonChunk.length + binChunk.length);
  bytes.writeUInt32LE(0x46546c67, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(jsonChunk.length, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(bytes, 20);
  bytes.writeUInt32LE(binChunk.length, 20 + jsonChunk.length);
  bytes.writeUInt32LE(0x004e4942, 24 + jsonChunk.length);
  binChunk.copy(bytes, 28 + jsonChunk.length);
  return bytes;
}
