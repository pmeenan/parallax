// Dependency-free so the Node-side build packaging can import it directly.
import type { GreyboxCollisionPayload, GreyboxHeightfieldCollider } from "./world-contract";

/** Bilinear height of a collision heightfield, clamped to its extent. */
export function sampleHeightfieldBilinear(
  field: GreyboxHeightfieldCollider,
  x: number,
  z: number,
): number {
  const column = Math.min(
    Math.max((x - field.origin[0]) / field.sampleSpacingMeters, 0),
    field.columns - 1,
  );
  const row = Math.min(
    Math.max((z - field.origin[2]) / field.sampleSpacingMeters, 0),
    field.rows - 1,
  );
  const column0 = Math.floor(column);
  const row0 = Math.floor(row);
  const column1 = Math.min(field.columns - 1, column0 + 1);
  const row1 = Math.min(field.rows - 1, row0 + 1);
  const sample = (sampleColumn: number, sampleRow: number): number =>
    field.heights[sampleRow * field.columns + sampleColumn] ?? 0;
  const lerp = (from: number, to: number, amount: number): number => from + (to - from) * amount;
  const south = lerp(sample(column0, row0), sample(column1, row0), column - column0);
  const north = lerp(sample(column0, row1), sample(column1, row1), column - column0);
  return lerp(south, north, row - row0);
}

/** True when (x, z) lies inside the cell's terrain detail field, edges included. */
export function terrainDetailContains(
  detail: GreyboxHeightfieldCollider,
  x: number,
  z: number,
): boolean {
  return (
    x >= detail.origin[0] &&
    z >= detail.origin[2] &&
    x <= detail.origin[0] + (detail.columns - 1) * detail.sampleSpacingMeters &&
    z <= detail.origin[2] + (detail.rows - 1) * detail.sampleSpacingMeters
  );
}

/** The walkable ground: the detail field where the cell has one, else the coarse field. */
export function sampleCellGroundHeight(
  collision: GreyboxCollisionPayload,
  x: number,
  z: number,
): number {
  const detail = collision.detail;
  return detail !== undefined && terrainDetailContains(detail, x, z)
    ? sampleHeightfieldBilinear(detail, x, z)
    : sampleHeightfieldBilinear(collision.heightfield, x, z);
}
