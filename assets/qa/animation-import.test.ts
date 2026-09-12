import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importAnimationCandidate } from "./animation-candidate.ts";
import { createAnimationFixture, encodeFixtureGlb } from "./animation-fixture.ts";
import { type AnimationGlb, readAccessor, readAnimationGlb } from "./animation-glb.ts";
import { ANIMATION_IMPORT_POLICY, parseAnimationImportProfile } from "./animation-policy.ts";
import { sha256, validateAnimationSource } from "./animation-validation.ts";

function encode(fixture: ReturnType<typeof createAnimationFixture>): Buffer {
  const source = encodeFixtureGlb(fixture.json, fixture.binary);
  fixture.profile.provenance.sourceSha256 = sha256(source);
  return source;
}

function floatAt(
  fixture: ReturnType<typeof createAnimationFixture>,
  accessorId: number,
  component: number,
  value: number,
): void {
  const accessor = fixture.json.accessors[accessorId];
  const view = fixture.json.bufferViews[accessor?.bufferView ?? -1];
  if (view === undefined) throw new Error("Invalid test accessor");
  fixture.binary.writeFloatLE(value, view.byteOffset + component * 4);
}

describe("animation source import gate", () => {
  it("validates a complete skinned source and records bounded, deterministic identities", async () => {
    const fixture = createAnimationFixture();
    const result = await validateAnimationSource(encode(fixture), fixture.profile);
    expect(result.statistics).toMatchObject({
      joints: 2,
      skinnedVertices: 4,
      triangles: 2,
      keyframes: 9,
    });
    expect(result.clips.map((clip) => [clip.role, clip.durationSeconds])).toEqual([
      ["idle", 1],
      ["locomotion", 1],
      ["combat", 1],
    ]);
    expect(result.rigSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.validationDurationMs).toBeGreaterThan(0);
    const again = await validateAnimationSource(encode(fixture), {
      ...fixture.profile,
      expectedRigSha256: result.rigSha256,
    });
    expect(again.rigSha256).toBe(result.rigSha256);
    await expect(
      validateAnimationSource(encode(fixture), {
        ...fixture.profile,
        expectedRigSha256: "0".repeat(64),
      }),
    ).rejects.toThrow("Rig compatibility");
  });

  it("preserves unreviewed rights as pending rather than inventing approval", async () => {
    const fixture = createAnimationFixture();
    fixture.profile.provenance.rightsReviewed = false;
    expect(
      (await validateAnimationSource(encode(fixture), fixture.profile)).provenance.rightsReviewed,
    ).toBe(false);
  });

  it("fingerprints named hierarchy independently of glTF joint array ordering", async () => {
    const fixture = createAnimationFixture();
    const first = await validateAnimationSource(encode(fixture), fixture.profile);
    fixture.json.skins[0]?.joints.reverse();
    const bindView =
      fixture.json.bufferViews[fixture.json.accessors[fixture.bindId]?.bufferView ?? -1];
    if (!bindView) throw new Error("Missing bind view");
    const before = Buffer.from(
      fixture.binary.subarray(bindView.byteOffset, bindView.byteOffset + 128),
    );
    fixture.binary.set(before.subarray(64), bindView.byteOffset);
    fixture.binary.set(before.subarray(0, 64), bindView.byteOffset + 64);
    const attributes = fixture.json.meshes[0]?.primitives[0]?.attributes;
    const jointsView =
      fixture.json.bufferViews[
        fixture.json.accessors[attributes?.JOINTS_0 ?? -1]?.bufferView ?? -1
      ];
    if (!jointsView) throw new Error("Missing joints view");
    for (let i = 0; i < jointsView.byteLength; i += 2) {
      fixture.binary.writeUInt16LE(
        1 - fixture.binary.readUInt16LE(jointsView.byteOffset + i),
        jointsView.byteOffset + i,
      );
    }
    expect((await validateAnimationSource(encode(fixture), fixture.profile)).rigSha256).toBe(
      first.rigSha256,
    );
  });

  it("recognizes opposite quaternion signs as the same loop endpoint", async () => {
    const fixture = createAnimationFixture();
    floatAt(fixture, fixture.rotationsId, 11, -1);
    expect(
      (await validateAnimationSource(encode(fixture), fixture.profile)).clips[1]
        ?.maximumLoopRotationErrorRadians,
    ).toBe(0);
  });

  it.each([
    [
      "bad weights",
      (f: ReturnType<typeof createAnimationFixture>) => floatAt(f, f.weightsId, 0, 0.4),
      /Khronos|weights/u,
    ],
    [
      "NaN key",
      (f: ReturnType<typeof createAnimationFixture>) => floatAt(f, f.rotationsId, 4, Number.NaN),
      /Khronos/u,
    ],
    [
      "duplicate times",
      (f: ReturnType<typeof createAnimationFixture>) => floatAt(f, f.timesId, 1, 0),
      /Khronos|increasing/u,
    ],
    [
      "wrong inverse bind",
      (f: ReturnType<typeof createAnimationFixture>) => floatAt(f, f.bindId, 29, 0),
      /inverse bind/u,
    ],
    [
      "broken loop",
      (f: ReturnType<typeof createAnimationFixture>) => {
        floatAt(f, f.rotationsId, 10, Math.sin(0.3));
        floatAt(f, f.rotationsId, 11, Math.cos(0.3));
      },
      /loop endpoint/u,
    ],
    [
      "missing role",
      (f: ReturnType<typeof createAnimationFixture>) => {
        f.profile.clips.pop();
      },
      /Clip set/u,
    ],
    [
      "duplicate clip",
      (f: ReturnType<typeof createAnimationFixture>) => {
        const clip = f.json.animations[1];
        if (clip) clip.name = "Idle";
      },
      /Duplicate animation/u,
    ],
    [
      "root travel",
      (f: ReturnType<typeof createAnimationFixture>) => {
        const target = f.json.animations[1]?.channels[0]?.target;
        if (target) target.node = 0;
      },
      /in-place root/u,
    ],
    [
      "node naming collision",
      (f: ReturnType<typeof createAnimationFixture>) => {
        const node = f.json.nodes[1];
        if (node) node.name = "Root";
      },
      /unique/u,
    ],
    [
      "missing root",
      (f: ReturnType<typeof createAnimationFixture>) => {
        f.profile.rootNode = "Missing";
      },
      /root node/u,
    ],
    [
      "huge allocation",
      (f: ReturnType<typeof createAnimationFixture>) => {
        const acc = f.json.accessors[0];
        if (acc) acc.count = 2 ** 31;
      },
      /accessor budget/u,
    ],
    [
      "source digest",
      (f: ReturnType<typeof createAnimationFixture>) => {
        f.profile.provenance.sourceSha256 = "0".repeat(64);
      },
      /hash mismatch/u,
    ],
  ] as const)("rejects %s", async (label, mutate, expected) => {
    const fixture = createAnimationFixture();
    mutate(fixture);
    const bytes =
      label === "source digest" ? encodeFixtureGlb(fixture.json, fixture.binary) : encode(fixture);
    await expect(validateAnimationSource(bytes, fixture.profile)).rejects.toThrow(expected);
  });

  it("fails closed on unsupported source features and malformed containers", async () => {
    const fixture = createAnimationFixture();
    const source = encode(fixture);
    expect(() => readAnimationGlb(source.subarray(0, source.length - 1))).toThrow(
      "length mismatch",
    );
    source.writeUInt32LE(0xfffffff0, 12);
    expect(() => readAnimationGlb(source)).toThrow("chunk range");
    const sparse = createAnimationFixture();
    const first = sparse.json.accessors[0];
    if (first) Object.assign(first, { sparse: {} });
    await expect(validateAnimationSource(encode(sparse), sparse.profile)).rejects.toThrow("sparse");
    const external = createAnimationFixture();
    Object.assign(external.json.buffers[0] ?? {}, { uri: "https://example.invalid/private.bin" });
    await expect(validateAnimationSource(encode(external), external.profile)).rejects.toThrow(
      "Khronos",
    );
    const extension = createAnimationFixture();
    Object.assign(extension.json, { extensionsUsed: ["KHR_materials_unlit"] });
    await expect(validateAnimationSource(encode(extension), extension.profile)).rejects.toThrow(
      "core glTF",
    );
  });

  it("reads valid strided and normalized source data without interpreting padding as samples", () => {
    const f = createAnimationFixture();
    const document = f.json as AnimationGlb;
    const view = document.bufferViews[0];
    const acc = document.accessors[0];
    if (!view || !acc) throw new Error("Missing fixture accessor");
    view.byteStride = 16;
    view.byteOffset = 0;
    view.byteLength = 64;
    const bytes = new Uint8Array(64);
    const data = new DataView(bytes.buffer);
    for (let i = 0; i < 4; i++) {
      data.setFloat32(i * 16, i, true);
      data.setUint32(i * 16 + 12, 0xffffffff, true);
    }
    expect(readAccessor(document, bytes, 0).map((row) => row[0])).toEqual([0, 1, 2, 3]);
    acc.componentType = 5121;
    acc.type = "VEC4";
    acc.normalized = true;
    acc.count = 1;
    bytes.set([0, 255, 128, 64]);
    expect(readAccessor(document, bytes, 0)[0]).toEqual([0, 1, 128 / 255, 64 / 255]);
  });

  it("requires explicit roles, root-motion rules and lineage", () => {
    const f = createAnimationFixture();
    expect(() => parseAnimationImportProfile({ ...f.profile, provenance: {} })).toThrow();
    expect(() =>
      parseAnimationImportProfile({
        ...f.profile,
        clips: [f.profile.clips[0], f.profile.clips[0]],
      }),
    ).toThrow("unique");
    expect(() =>
      parseAnimationImportProfile({
        ...f.profile,
        clips: [{ name: "Walk", role: "locomotion", loop: true, rootMotion: "authored" }],
      }),
    ).toThrow("cycle-offset");
    expect(ANIMATION_IMPORT_POLICY.maximumJoints).toBe(128);
  });

  it("writes immutable source/profile evidence and no candidate on failed QA", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-animation-import-test-"));
    const fixture = createAnimationFixture();
    const bytes = encode(fixture);
    const sourcePath = join(root, "source.glb"),
      profilePath = join(root, "profile.json");
    await writeFile(sourcePath, bytes);
    await writeFile(profilePath, JSON.stringify(fixture.profile));
    const output = join(root, "candidate");
    const candidate = await importAnimationCandidate(sourcePath, profilePath, output, root);
    expect(await readFile(join(output, candidate.source.file))).toEqual(bytes);
    expect(sha256(await readFile(join(output, candidate.validation.file)))).toBe(
      candidate.validation.sha256,
    );
    expect(await readFile(sourcePath)).toEqual(bytes);
    await expect(importAnimationCandidate(sourcePath, profilePath, output, root)).rejects.toThrow();
    await expect(
      importAnimationCandidate(sourcePath, profilePath, join(root, "..", "outside"), root),
    ).rejects.toThrow("harness/results");
    fixture.profile.provenance.sourceSha256 = "0".repeat(64);
    await writeFile(profilePath, JSON.stringify(fixture.profile));
    const failed = join(root, "failed");
    await expect(importAnimationCandidate(sourcePath, profilePath, failed, root)).rejects.toThrow(
      "hash mismatch",
    );
    expect(JSON.parse(await readFile(join(failed, "validation.json"), "utf8")).status).toBe(
      "failed",
    );
    await expect(stat(join(failed, "candidate.json"))).rejects.toThrow();
  });
});
