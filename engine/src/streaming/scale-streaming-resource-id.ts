export const SCALE_STREAMING_DEPENDENCY_ROLES = Object.freeze([
  "texture",
  "vertices",
  "indices",
] as const);

export type ScaleStreamingDependencyRole = (typeof SCALE_STREAMING_DEPENDENCY_ROLES)[number];

const ROLE_ORDINAL: Readonly<Record<ScaleStreamingDependencyRole, string>> = Object.freeze({
  indices: "02",
  texture: "00",
  vertices: "01",
});
const SHA256 = /^[a-f0-9]{64}$/u;

export function scaleStreamingDependencyResourceId(
  role: ScaleStreamingDependencyRole,
  sha256: string,
): string {
  const ordinal = ROLE_ORDINAL[role];
  if (ordinal === undefined || !SHA256.test(sha256)) {
    throw new Error("Scale-streaming dependency resource identity is invalid");
  }
  return `game-specific-scale-streaming-${ordinal}-${role}-${sha256}`;
}
