import assert from "node:assert/strict";

export interface AnimationImportProfile {
  schemaVersion: 1;
  assetId: string;
  rootNode: string;
  expectedRigSha256?: string;
  clips: { name: string; role: string; loop: boolean; rootMotion: "in-place" | "authored" }[];
  provenance: {
    sourceSha256: string;
    author: string;
    license: string;
    rightsReviewed: boolean;
    references: string[];
    lineage: string;
  };
}

export const ANIMATION_IMPORT_POLICY = Object.freeze({
  id: "skeletal-source@1",
  maximumSourceBytes: 64 * 1024 * 1024,
  maximumAccessorComponents: 8_000_000,
  maximumNodes: 256,
  maximumJoints: 128,
  maximumClips: 32,
  maximumDurationSeconds: 120,
  maximumKeyframes: 200_000,
  maximumTriangles: 250_000,
  weightSumTolerance: 0.0001,
  translationToleranceMetres: 0.001,
  rotationToleranceRadians: 0.001,
  scaleTolerance: 0.0001,
});

export function parseAnimationImportProfile(value: unknown): AnimationImportProfile {
  assertRecord(value, "Animation profile");
  assert.equal(value.schemaVersion, 1, "Unsupported animation profile version");
  assertText(value.assetId, "assetId");
  assert(/^[a-z0-9][a-z0-9-]{0,79}$/u.test(value.assetId), "Invalid assetId");
  assertText(value.rootNode, "rootNode");
  if (value.expectedRigSha256 !== undefined) assertDigest(value.expectedRigSha256);
  assert(
    Array.isArray(value.clips) &&
      value.clips.length > 0 &&
      value.clips.length <= ANIMATION_IMPORT_POLICY.maximumClips,
    "Profile requires 1–32 explicit clips",
  );
  const names = new Set<string>();
  const roles = new Set<string>();
  for (const clip of value.clips) {
    assertRecord(clip, "Clip profile");
    assertText(clip.name, "Clip name");
    assertText(clip.role, "Clip role");
    assert(!names.has(clip.name) && !roles.has(clip.role), "Clip names and roles must be unique");
    names.add(clip.name);
    roles.add(clip.role);
    assert(typeof clip.loop === "boolean", "Clip loop must be explicit");
    assert(
      clip.rootMotion === "in-place" || clip.rootMotion === "authored",
      "Root-motion policy must be explicit",
    );
    assert(
      !(clip.loop && clip.rootMotion === "authored"),
      "Travelling loops need an explicit cycle-offset contract; not supported in source profile v1",
    );
  }
  assertRecord(value.provenance, "Provenance");
  assertDigest(value.provenance.sourceSha256);
  for (const key of ["author", "license", "lineage"] as const)
    assertText(value.provenance[key], `Provenance ${key}`);
  assert(
    typeof value.provenance.rightsReviewed === "boolean",
    "Rights-review state must be explicit",
  );
  assert(
    Array.isArray(value.provenance.references) && value.provenance.references.length > 0,
    "Reference IDs are required",
  );
  for (const reference of value.provenance.references) assertText(reference, "Reference");
  // All fields used below were checked above; extra provenance remains in the original profile bytes.
  return value as unknown as AnimationImportProfile;
}

export function assertRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
}

function assertText(value: unknown, label: string): asserts value is string {
  assert(
    typeof value === "string" && value.trim().length > 0 && value.length <= 2048,
    `${label} is required`,
  );
}

function assertDigest(value: unknown): asserts value is string {
  assert(typeof value === "string" && /^[a-f0-9]{64}$/u.test(value), "Expected SHA-256 digest");
}
