import {
  type AssetContainer,
  type EngineContext,
  enableBoneControl,
  loadGltf,
  stopAnimation,
} from "@babylonjs/lite";

export interface AnimationImportExpectation {
  readonly sourceSha256: string;
  readonly jointNames: readonly string[];
  readonly clips: readonly { readonly name: string; readonly durationSeconds: number }[];
}

/** Worker-side import for QA candidates. Caller owns the engine and destroys it on failure.
 * This receipt does not admit source bytes to the runtime library or install manifest. */
export async function importAnimationForQa(
  engine: EngineContext,
  bytes: ArrayBuffer,
  expected: AnimationImportExpectation,
): Promise<{ container: AssetContainer; importDurationMs: number }> {
  const startedAt = performance.now();
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (digest !== expected.sourceSha256)
    throw new Error("Animation source bytes changed before GPU import");
  enableBoneControl();
  const container = await loadGltf(engine, bytes);
  for (const group of container.animationGroups ?? []) stopAnimation(group);
  const actualJoints = container.skeletons
    ?.flatMap((skeleton) => skeleton.bones.map((bone) => bone.name))
    .sort();
  if (
    container.skeletons?.length !== 1 ||
    JSON.stringify(actualJoints) !== JSON.stringify([...expected.jointNames].sort())
  )
    throw new Error("Imported skeleton differs from validated source");
  const groups = container.animationGroups ?? [];
  if (groups.length !== expected.clips.length)
    throw new Error("Imported clip count differs from validated source");
  for (const clip of expected.clips) {
    const group = groups.find((candidate) => candidate.name === clip.name);
    if (
      group === undefined ||
      !Number.isFinite(group.duration) ||
      Math.abs(group.duration - clip.durationSeconds) > 0.00001
    )
      throw new Error(`Imported clip ${clip.name} differs from validated source`);
  }
  return { container, importDurationMs: performance.now() - startedAt };
}
