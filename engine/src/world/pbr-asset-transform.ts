import type { PbrAssetPlacement } from "./pbr-asset";

export type PbrAssetTransform = Pick<
  PbrAssetPlacement,
  "position" | "scale" | "rotationXRadians" | "rotationYRadians" | "rotationZRadians"
>;

/** Column-major T * Rx * Ry * Rz * Scale * ReflectX, matching Lite 1.12's
 * Euler XYZ proxy and canonical glTF-to-left-handed root conversion. Shared by
 * packaging bounds/terrain fitting and render-worker instance matrices.
 */
export function writePbrAssetMatrix(
  out: Float32Array | Float64Array,
  offset: number,
  transform: PbrAssetTransform,
): void {
  const x = (transform.rotationXRadians ?? 0) / 2;
  const y = transform.rotationYRadians / 2;
  const z = (transform.rotationZRadians ?? 0) / 2;
  const cx = Math.cos(x),
    sx = Math.sin(x),
    cy = Math.cos(y),
    sy = Math.sin(y),
    cz = Math.cos(z),
    sz = Math.sin(z);
  const qx = sx * cy * cz + cx * sy * sz;
  const qy = cx * sy * cz - sx * cy * sz;
  const qz = cx * cy * sz + sx * sy * cz;
  const qw = cx * cy * cz - sx * sy * sz;
  const scaleX = -transform.scale[0],
    scaleY = transform.scale[1],
    scaleZ = transform.scale[2];
  out[offset] = (1 - 2 * (qy * qy + qz * qz)) * scaleX;
  out[offset + 1] = 2 * (qx * qy + qw * qz) * scaleX;
  out[offset + 2] = 2 * (qx * qz - qw * qy) * scaleX;
  out[offset + 3] = 0;
  out[offset + 4] = 2 * (qx * qy - qw * qz) * scaleY;
  out[offset + 5] = (1 - 2 * (qx * qx + qz * qz)) * scaleY;
  out[offset + 6] = 2 * (qy * qz + qw * qx) * scaleY;
  out[offset + 7] = 0;
  out[offset + 8] = 2 * (qx * qz + qw * qy) * scaleZ;
  out[offset + 9] = 2 * (qy * qz - qw * qx) * scaleZ;
  out[offset + 10] = (1 - 2 * (qx * qx + qy * qy)) * scaleZ;
  out[offset + 11] = 0;
  out[offset + 12] = transform.position[0];
  out[offset + 13] = transform.position[1];
  out[offset + 14] = transform.position[2];
  out[offset + 15] = 1;
}
