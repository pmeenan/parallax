import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalMeshoptLayoutErrors } from "@parallax/engine/meshopt-layout";
import { validateBytes, version } from "gltf-validator";
import {
  type AnimationGlb,
  readAccessor,
  readAnimationGlb,
  rotationDistance,
  vectorDistance,
} from "./animation-glb.ts";
import {
  assertRecord,
  parseAnimationImportProfile,
  ANIMATION_IMPORT_POLICY as policy,
} from "./animation-policy.ts";

export const GLTF_VALIDATOR_VERSION = "2.0.0-dev.3.10";

export async function validateAnimationSource(source: Uint8Array, profileInput: unknown) {
  const startedAt = performance.now();
  const profile = parseAnimationImportProfile(profileInput);
  assert(source.byteLength <= policy.maximumSourceBytes, "Animation source byte budget exceeded");
  const sourceSha256 = sha256(source);
  assert.equal(sourceSha256, profile.provenance.sourceSha256, "Source provenance hash mismatch");
  const { json, binary } = readAnimationGlb(source);
  assertRecord(json, "GLB document");
  assert(Array.isArray(json.accessors), "Animation accessors are required");
  let accessorComponents = 0;
  for (const accessor of json.accessors) {
    assertRecord(accessor, "Accessor");
    assert(
      typeof accessor.count === "number" &&
        Number.isSafeInteger(accessor.count) &&
        accessor.count > 0,
      "Invalid accessor count",
    );
    const width = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<string, number>)[
      String(accessor.type)
    ];
    assert(width, "Source profile supports scalar, vector and MAT4 accessors");
    accessorComponents += accessor.count * width;
    assert(
      accessorComponents <= policy.maximumAccessorComponents,
      "Decoded accessor budget exceeded",
    );
    assert(accessor.sparse === undefined, "Bake sparse accessors before source import");
  }
  assert.equal(version(), GLTF_VALIDATOR_VERSION, "Khronos validator pin drifted");
  const khronos = await validateBytes(source, {
    format: "glb",
    writeTimestamp: false,
    maxIssues: 1000,
    externalResourceFunction: async () => {
      throw new Error("External resources are forbidden in source candidates");
    },
  });
  assertRecord(khronos, "Khronos report");
  assertRecord(khronos.issues, "Khronos issues");
  assert.equal(
    khronos.issues.numErrors,
    0,
    `Khronos glTF validation failed: ${JSON.stringify(khronos.issues)}`,
  );
  assert.equal(khronos.issues.truncated, false, "Khronos report was truncated");
  // Schema, references and binary encoding were checked by Khronos. Narrow to our supported source subset.
  const document = json as unknown as AnimationGlb;
  assert.deepEqual(canonicalMeshoptLayoutErrors(document), [], "Noncanonical GLB buffer layout");
  assert(
    document.buffers[0]?.uri === undefined &&
      !document.images?.some((image) => image.uri !== undefined),
    "Only embedded GLB resources are supported",
  );
  assert(
    (document.extensionsUsed?.length ?? 0) === 0,
    "Source profile v1 requires core glTF; export without extensions/compression",
  );
  assert(
    document.nodes?.length > 0 && document.nodes.length <= policy.maximumNodes,
    "Node budget exceeded or no nodes",
  );
  assert(document.skins?.length === 1, "Source profile requires exactly one skin");
  assert(
    document.animations?.length === profile.clips.length,
    "Clip set differs from the explicit profile",
  );
  assert(
    document.scenes?.length === 1 && (document.scene ?? 0) === 0,
    "Source profile requires one default scene",
  );
  const cache = new Map<number, number[][]>();
  const read = (index: number): number[][] => {
    let values = cache.get(index);
    if (values === undefined) {
      values = readAccessor(document, binary, index);
      cache.set(index, values);
    }
    return values;
  };
  const names = new Set<string>();
  const parents = new Map<number, number>();
  for (const [index, node] of document.nodes.entries()) {
    assert(
      typeof node.name === "string" && node.name.trim().length > 0 && !names.has(node.name),
      "Every source node needs a unique, nonempty name",
    );
    names.add(node.name);
    assert(node.matrix === undefined, `Node ${node.name}: export rest transforms as TRS`);
    assert(
      vectorDistance(node.scale ?? [1, 1, 1], [1, 1, 1]) <= policy.scaleTolerance,
      `Node ${node.name}: apply scale in the authoring tool before export`,
    );
    for (const child of node.children ?? []) {
      assert(!parents.has(child), "Node has multiple parents");
      parents.set(child, index);
    }
  }
  const reachable = new Set<number>();
  const visit = (index: number): void => {
    assert(!reachable.has(index), "Node hierarchy is cyclic or duplicated");
    reachable.add(index);
    for (const child of document.nodes[index]?.children ?? []) visit(child);
  };
  for (const index of document.scenes[0]?.nodes ?? []) visit(index);
  assert.equal(
    reachable.size,
    document.nodes.length,
    "All source nodes must belong to the selected scene",
  );
  const skin = document.skins[0];
  assert(
    skin && skin.joints.length > 0 && skin.joints.length <= policy.maximumJoints,
    "Bone budget exceeded or empty skin",
  );
  assert.equal(new Set(skin.joints).size, skin.joints.length, "Skin repeats a joint");
  assert(skin.inverseBindMatrices !== undefined, "Explicit inverse-bind matrices are required");
  const root = document.nodes.findIndex((node) => node.name === profile.rootNode);
  assert(root >= 0, "Authored root node is missing");
  const rigNodes = new Set<number>();
  for (const joint of skin.joints) {
    let current: number | undefined = joint;
    let containsRoot = false;
    while (current !== undefined) {
      rigNodes.add(current);
      if (current === root) containsRoot = true;
      current = parents.get(current);
    }
    assert(containsRoot, "Root node must be an ancestor of every joint");
  }
  if (skin.skeleton !== undefined)
    assert(rigNodes.has(skin.skeleton), "Skeleton root is outside the rig");
  const inverseBind = read(skin.inverseBindMatrices);
  const worldMatrices = new Map<number, number[]>();
  const worldMatrix = (index: number): number[] => {
    let matrix = worldMatrices.get(index);
    if (matrix !== undefined) return matrix;
    const node = document.nodes[index];
    assert(node);
    matrix = trs(
      node.translation ?? [0, 0, 0],
      node.rotation ?? [0, 0, 0, 1],
      node.scale ?? [1, 1, 1],
    );
    const parent = parents.get(index);
    if (parent !== undefined) matrix = multiply(worldMatrix(parent), matrix);
    worldMatrices.set(index, matrix);
    return matrix;
  };
  const rig = [...rigNodes]
    .map((index) => {
      const node = document.nodes[index];
      assert(node);
      const jointIndex = skin.joints.indexOf(index);
      const inverse = jointIndex === -1 ? null : inverseBind[jointIndex];
      if (jointIndex !== -1) {
        assert(inverse, "Inverse-bind count differs from joints");
        const bind = multiply(worldMatrix(index), inverse);
        assert(
          bind.every((value, i) => Math.abs(value - element(IDENTITY, i)) <= 0.0001),
          `Joint ${node.name}: inverse bind does not match the exported rest pose`,
        );
      }
      return {
        name: node.name,
        parent: document.nodes[parents.get(index) ?? -1]?.name ?? null,
        translation: node.translation ?? [0, 0, 0],
        rotation: canonicalQuaternion(node.rotation ?? [0, 0, 0, 1]),
        scale: node.scale ?? [1, 1, 1],
        inverseBindMatrix: inverse ?? null,
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const rigSha256 = sha256(JSON.stringify(rig));
  if (profile.expectedRigSha256 !== undefined)
    assert.equal(
      rigSha256,
      profile.expectedRigSha256,
      "Rig compatibility hash mismatch; retarget explicitly in the authoring tool",
    );
  let triangles = 0,
    skinnedVertices = 0,
    maximumWeightError = 0;
  let skinnedMeshNodes = 0;
  const boundsMin = [Infinity, Infinity, Infinity],
    boundsMax = [-Infinity, -Infinity, -Infinity];
  for (const [nodeIndex, node] of document.nodes.entries()) {
    if (node.mesh === undefined) continue;
    assert.equal(node.skin, 0, "Source character meshes must use the single validated skin");
    assert(
      worldMatrix(nodeIndex).every((value, i) => Math.abs(value - element(IDENTITY, i)) <= 0.0001),
      `Skinned mesh ${node.name}: apply its object and parent transforms before export`,
    );
    skinnedMeshNodes += 1;
    const mesh = document.meshes[node.mesh];
    assert(mesh);
    for (const primitive of mesh.primitives) {
      assert((primitive.mode ?? 4) === 4, "Only triangle primitives are supported");
      assert(
        (primitive.targets?.length ?? 0) === 0,
        "Morph targets need a separately qualified profile",
      );
      assert(
        primitive.attributes.JOINTS_1 === undefined && primitive.attributes.WEIGHTS_1 === undefined,
        "Source profile supports four influences per vertex",
      );
      const jointsId = primitive.attributes.JOINTS_0,
        weightsId = primitive.attributes.WEIGHTS_0,
        positionsId = primitive.attributes.POSITION;
      assert(
        jointsId !== undefined && weightsId !== undefined && positionsId !== undefined,
        "Skinned attributes are incomplete",
      );
      const joints = read(jointsId),
        weights = read(weightsId),
        positions = read(positionsId);
      assert.equal(joints.length, positions.length);
      assert.equal(weights.length, positions.length);
      skinnedVertices += positions.length;
      for (const position of positions)
        for (let axis = 0; axis < 3; axis++) {
          boundsMin[axis] = Math.min(boundsMin[axis] ?? Infinity, position[axis] ?? Infinity);
          boundsMax[axis] = Math.max(boundsMax[axis] ?? -Infinity, position[axis] ?? -Infinity);
        }
      triangles +=
        (primitive.indices === undefined ? positions.length : read(primitive.indices).length) / 3;
      for (const [vertex, influences] of weights.entries()) {
        const error = Math.abs(influences.reduce((sum, weight) => sum + weight, 0) - 1);
        maximumWeightError = Math.max(maximumWeightError, error);
        assert(
          error <= policy.weightSumTolerance &&
            influences.every((weight) => weight >= 0 && weight <= 1),
          "Skin weights are not normalized",
        );
        assert(
          joints[vertex]?.every(
            (joint) => Number.isInteger(joint) && joint >= 0 && joint < skin.joints.length,
          ),
          "Skin joint index is out of range",
        );
      }
    }
  }
  assert(
    skinnedMeshNodes > 0 && skinnedVertices > 0 && triangles <= policy.maximumTriangles,
    "Skinned geometry missing or triangle budget exceeded",
  );
  const clipNames = new Set<string>();
  let keyframes = 0;
  const clips = document.animations.map((animation) => {
    assert(!clipNames.has(animation.name), "Duplicate animation name");
    clipNames.add(animation.name);
    const authored = profile.clips.find((clip) => clip.name === animation.name);
    assert(authored, `Animation ${animation.name} has no explicit clip profile`);
    const samples = animation.samplers.map((sampler) => {
      assert(
        sampler.interpolation === undefined ||
          sampler.interpolation === "LINEAR" ||
          sampler.interpolation === "STEP",
        `Animation ${animation.name}: bake CUBICSPLINE to LINEAR for profile v1`,
      );
      const times = read(sampler.input).map((row) => element(row, 0));
      const values = read(sampler.output);
      assert(
        times.length >= 2 &&
          times[0] === 0 &&
          times.every((time, index) => index === 0 || time > element(times, index - 1)),
        `Animation ${animation.name}: timelines must start at zero with increasing keys`,
      );
      keyframes += times.length;
      assert(keyframes <= policy.maximumKeyframes, "Animation keyframe budget exceeded");
      return { times, values };
    });
    const duration = samples.reduce(
      (maximum, sampler) => Math.max(maximum, element(sampler.times, sampler.times.length - 1)),
      0,
    );
    assert(
      duration > 0 && duration <= policy.maximumDurationSeconds,
      "Clip duration exceeds source policy",
    );
    let maximumLoopTranslationErrorMetres = 0,
      maximumLoopRotationErrorRadians = 0,
      maximumRootTravelMetres = 0;
    for (const channel of animation.channels) {
      assert(rigNodes.has(channel.target.node), "Animation target is outside the rig hierarchy");
      assert(
        ["translation", "rotation", "scale"].includes(channel.target.path),
        "Only skeletal TRS channels are supported",
      );
      const sampler = samples[channel.sampler];
      assert(sampler);
      assert.equal(
        sampler.times.at(-1),
        duration,
        "Every clip channel must cover the complete clip duration",
      );
      const first = element(sampler.values, 0),
        last = element(sampler.values, sampler.values.length - 1);
      if (channel.target.path === "scale")
        assert(
          sampler.values.every(
            (value) => vectorDistance(value, [1, 1, 1]) <= policy.scaleTolerance,
          ),
          "Animated scale needs a separately qualified profile",
        );
      const rotation = channel.target.path === "rotation";
      const tolerance = rotation
        ? policy.rotationToleranceRadians
        : channel.target.path === "translation"
          ? policy.translationToleranceMetres
          : policy.scaleTolerance;
      const distance = rotation ? rotationDistance : vectorDistance;
      if (authored.loop) {
        const error = distance(first, last);
        assert(error <= tolerance, `Animation ${animation.name}: loop endpoint discontinuity`);
        if (rotation)
          maximumLoopRotationErrorRadians = Math.max(maximumLoopRotationErrorRadians, error);
        else if (channel.target.path === "translation")
          maximumLoopTranslationErrorMetres = Math.max(maximumLoopTranslationErrorMetres, error);
      }
      // Include ancestors: travelling an armature above the nominated root is root motion too.
      let rootAncestor: number | undefined = root;
      const ancestors = new Set<number>();
      while (rootAncestor !== undefined) {
        ancestors.add(rootAncestor);
        rootAncestor = parents.get(rootAncestor);
      }
      if (ancestors.has(channel.target.node)) {
        const travel = sampler.values.reduce(
          (maximum, value) => Math.max(maximum, distance(first, value)),
          0,
        );
        if (channel.target.path === "translation")
          maximumRootTravelMetres = Math.max(maximumRootTravelMetres, travel);
        if (authored.rootMotion === "in-place") {
          const node = element(document.nodes, channel.target.node);
          const rest = rotation
            ? (node.rotation ?? [0, 0, 0, 1])
            : channel.target.path === "translation"
              ? (node.translation ?? [0, 0, 0])
              : [1, 1, 1];
          assert(
            travel <= tolerance && distance(first, rest) <= tolerance,
            `Animation ${animation.name}: in-place root moves, turns or offsets its rest pose`,
          );
        }
      }
    }
    return {
      ...authored,
      durationSeconds: duration,
      channels: animation.channels.length,
      keyframes: samples.reduce((sum, sampler) => sum + sampler.times.length, 0),
      maximumLoopTranslationErrorMetres,
      maximumLoopRotationErrorRadians,
      maximumRootTravelMetres,
    };
  });
  return {
    schemaVersion: 1 as const,
    status: "source-validated-admission-pending" as const,
    assetId: profile.assetId,
    sourceSha256,
    sourceBytes: source.byteLength,
    policy,
    provenance: profile.provenance,
    rigSha256,
    rig,
    clips,
    statistics: {
      nodes: document.nodes.length,
      joints: skin.joints.length,
      skinnedMeshNodes,
      skinnedVertices,
      triangles,
      accessorComponents,
      keyframes,
      maximumWeightError,
      restBounds: { minimum: boundsMin, maximum: boundsMax },
    },
    khronos,
    validationDurationMs: performance.now() - startedAt,
  };
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a: number[], b: number[]): number[] {
  return Array.from({ length: 16 }, (_, index) => {
    const row = index % 4,
      column = Math.floor(index / 4);
    return [0, 1, 2, 3].reduce(
      (sum, k) => sum + element(a, k * 4 + row) * element(b, column * 4 + k),
      0,
    );
  });
}
function canonicalQuaternion(q: number[]): number[] {
  const sign = (q.findLast((value) => Math.abs(value) > 1e-12) ?? 1) < 0 ? -1 : 1;
  return q.map((value) => value * sign);
}
function trs(t: number[], q: number[], scale: number[]): number[] {
  const [x = 0, y = 0, z = 0, w = 1] = q;
  const matrix = [
    1 - 2 * (y * y + z * z),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
    0,
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
    0,
    2 * (x * z + y * w),
    2 * (y * z - x * w),
    1 - 2 * (x * x + y * y),
    0,
    element(t, 0),
    element(t, 1),
    element(t, 2),
    1,
  ];
  for (let column = 0; column < 3; column++)
    for (let row = 0; row < 3; row++) {
      const index = column * 4 + row;
      matrix[index] = (matrix[index] ?? 0) * (scale[column] ?? 1);
    }
  return matrix;
}

function element<T>(values: readonly T[], index: number): T {
  const value = values[index];
  assert(value !== undefined, "Missing validated array component");
  return value;
}
