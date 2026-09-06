import { type PbrAssetTransform, writePbrAssetMatrix } from "@parallax/engine";
import { sampleGreyboxTerrain } from "./greybox-generator";
import type { GreyboxDistrictSpec } from "./greybox-spec";

/** Same two triangles and sampled heights as the generated collision lattice. */
export function sampleStoneCollisionSurface(spec: GreyboxDistrictSpec, x: number, z: number) {
  const spacing = spec.world.collisionSampleSpacingMeters;
  const x0 =
    spec.world.bounds.minimum[0] +
    Math.floor((x - spec.world.bounds.minimum[0]) / spacing) * spacing;
  const z0 =
    spec.world.bounds.minimum[2] +
    Math.floor((z - spec.world.bounds.minimum[2]) / spacing) * spacing;
  const u = (x - x0) / spacing,
    v = (z - z0) / spacing;
  const a = sampleGreyboxTerrain(spec, x0, z0),
    b = sampleGreyboxTerrain(spec, x0 + spacing, z0),
    c = sampleGreyboxTerrain(spec, x0, z0 + spacing),
    d = sampleGreyboxTerrain(spec, x0 + spacing, z0 + spacing);
  return u + v <= 1
    ? {
        height: a + u * (b - a) + v * (c - a),
        gradientX: (b - a) / spacing,
        gradientZ: (c - a) / spacing,
      }
    : {
        height: d + (1 - u) * (c - d) + (1 - v) * (b - d),
        gradientX: (d - c) / spacing,
        gradientZ: (d - b) / spacing,
      };
}

/** Build-time content fitting only: rigid stone shape stays unchanged. The exact
 * projected bottom polygon is sampled, with explicit burial into existing dirt.
 * This does not change the rendered/collision ground or create stone colliders.
 */
export function fitRigidStoneToCollision(
  spec: GreyboxDistrictSpec,
  authored: PbrAssetTransform,
  bottomFootprint: readonly (readonly [number, number])[],
  burialDepth: number,
) {
  if (bottomFootprint.length < 3 || !Number.isFinite(burialDepth) || burialDepth < 0)
    throw new Error("Stone support footprint and burial depth are invalid");
  const [x, , z] = authored.position;
  const ground = sampleStoneCollisionSurface(spec, x, z);
  const tilt = new Float64Array(16),
    original = new Float64Array(16);
  writePbrAssetMatrix(tilt, 0, {
    position: [0, 0, 0],
    scale: [1, 1, 1],
    rotationYRadians: 0,
    rotationXRadians: -Math.atan(ground.gradientZ),
    rotationZRadians: Math.asin(
      ground.gradientX / Math.hypot(ground.gradientX, 1, ground.gradientZ),
    ),
  });
  // Remove the coordinate reflection from the terrain frame; the authored matrix
  // carries exactly one RH-to-LH reflection, as every runtime instance does.
  for (let row = 0; row < 3; row += 1) tilt[row] = -(tilt[row] ?? 0);
  writePbrAssetMatrix(original, 0, { ...authored, position: [0, 0, 0], scale: [1, 1, 1] });
  const combined = new Float64Array(16);
  for (let column = 0; column < 3; column += 1)
    for (let row = 0; row < 3; row += 1)
      for (let k = 0; k < 3; k += 1)
        combined[column * 4 + row] =
          (combined[column * 4 + row] ?? 0) +
          (tilt[k * 4 + row] ?? 0) * (original[column * 4 + k] ?? 0);
  const rotationYRadians = Math.asin(Math.max(-1, Math.min(1, combined[8] ?? 0)));
  const rotationXRadians = Math.atan2(-(combined[9] ?? 0), combined[10] ?? 0);
  const rotationZRadians = Math.atan2(-(combined[4] ?? 0), -(combined[0] ?? 0));
  const fitted = {
    ...authored,
    position: [x, 0, z] as readonly [number, number, number],
    rotationXRadians,
    rotationYRadians,
    rotationZRadians,
  };
  const matrix = new Float64Array(16);
  writePbrAssetMatrix(matrix, 0, fitted);
  const support = bottomFootprint.map(([px, pz]) => {
    const worldX = x + (matrix[0] ?? 0) * px + (matrix[8] ?? 0) * pz;
    const worldZ = z + (matrix[2] ?? 0) * px + (matrix[10] ?? 0) * pz;
    return {
      x: worldX,
      z: worldZ,
      localY: (matrix[1] ?? 0) * px + (matrix[9] ?? 0) * pz,
      terrainY: sampleStoneCollisionSurface(spec, worldX, worldZ).height,
    };
  });
  const y =
    Math.max(...support.map((point) => point.terrainY - point.localY), ground.height) - burialDepth;
  return {
    transform: { ...fitted, position: [x, y, z] as const },
    heightOffset: y - ground.height,
    support: support.map((point) => ({
      ...point,
      bottomY: y + point.localY,
      clearance: y + point.localY - point.terrainY,
    })),
    terrainGradient: [ground.gradientX, ground.gradientZ] as const,
  };
}
